// Mode course, côté hôte : grille, bots, boîtes à objets, objets lancés, pouvoirs, arrivée.

import { TrackPath } from '../track.js';
import { TRACKS, trackById } from '../data/tracks.js';
import { VEHICLES, vehicleById, vehicleParams, CC_CLASSES } from '../data/vehicles.js';
import { Kart, F } from '../kart.js';
import { BotBrain, rubberBand } from '../ai.js';
import { Entities, rollItem, BOMB_RADIUS, kartAhead, ITEMS } from '../items.js';
import { POWERS, POWER_COOLDOWN, drawPower, powerById, applyPowerToKart } from '../powers.js';
import { makeRng } from '../util.js';

const MAX_KARTS = 8;
const SIM_DT = 1 / 60;
const BOX_RESPAWN = 3000;
const AFTER_FIRST = 35000; // fin forcée après l'arrivée du premier humain
const AFTER_ALL = 3500;
const POWER_FIRST = 6000; // premier pouvoir disponible 6 s après le départ

// Gravité instable de l'option chaos : même formule chez l'hôte et chez les joueurs.
export function chaosGravity(raceTimeMs) {
  const t = raceTimeMs / 1000;
  return 0.75 + 0.35 * Math.sin(t * 0.8) + 0.15 * Math.sin(t * 2.3);
}

export function createRaceGame(ctx, id) {
  const { now, rand } = ctx;
  const settings = { ...ctx.settings };
  const def = settings.track === 'random' ? TRACKS[Math.floor(rand() * TRACKS.length)] : trackById(settings.track);
  const track = new TrackPath(def);
  const T = track;
  const ccMul = CC_CLASSES[settings.cc] || 1;

  // Grille : les humains dans un ordre aléatoire, puis les bots.
  const order = ctx.humans().map((p) => ({ id: p.id, name: p.name, vehicle: p.vehicle, color: p.color, horn: p.horn, isBot: false }));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (settings.bots) {
    for (const b of ctx.bots.slice(0, Math.max(0, MAX_KARTS - order.length))) {
      if (rand() < 0.5) b.vehicle = VEHICLES[Math.floor(rand() * VEHICLES.length)].id;
      order.push({ id: b.id, name: b.name, vehicle: b.vehicle, color: b.color, horn: b.horn, isBot: true });
    }
  }
  order.forEach((g, i) => { g.slot = i; });

  const karts = new Map();
  for (const g of order) {
    const slot = T.gridSlot(g.slot);
    const entry = {
      id: g.id, name: g.name, vehicle: g.vehicle, isBot: g.isBot,
      x: slot.x, y: slot.y, z: slot.z, yaw: slot.yaw, spd: 0, f: 0, vx: 0, vz: 0,
      prog: slot.s, finished: false, time: null, // s négatif : derrière la ligne
      item: null, count: 0, rank: g.slot + 1, gone: false,
      power: null, powerReadyAt: Infinity, powerBag: null,
    };
    if (settings.powers) entry.power = drawPower(entry, 'race', rand);
    if (g.isBot) {
      const v = vehicleById(g.vehicle);
      const params = vehicleParams(v.stats, ccMul);
      const kart = new Kart(T, params);
      kart.place(slot);
      kart.chaos = settings.chaos;
      entry.kart = kart;
      entry.baseMax = params.maxSpeed;
      entry.brain = new BotBrain(kart, makeRng(Math.floor(rand() * 1e9)), ctx.skill + (rand() - 0.5) * 0.2);
      entry.prog = kart.prog;
    }
    karts.set(g.id, entry);
  }

  const entities = new Entities(T);
  const boxes = T.boxes.map(() => 0); // instant de réapparition (0 = présente)
  let acc = 0;
  let firstHumanFinish = null;
  let endAt = null;

  const game = {
    id,
    mode: 'race',
    loaded: new Set(),
    startAt: null,
    results: null,
    humanIds: () => order.filter((g) => !g.isBot).map((g) => g.id),
    info: () => ({
      id, mode: 'race', track: def.id, laps: settings.laps, cc: settings.cc, items: settings.items,
      powers: settings.powers, chaos: settings.chaos, grid: order,
    }),
    handlers: {},
    tick,
    snapshot,
    kart: humanState,
    disconnect(pid) { if (karts.has(pid)) karts.get(pid).gone = true; },
    forceEnd: endRace,
  };

  const raceTime = () => (game.startAt != null ? now() - game.startAt : -1);
  const alive = () => [...karts.values()].filter((k) => !k.gone);

  function ranking() {
    const list = alive();
    list.sort((a, b) => {
      if (a.finished && b.finished) return a.time - b.time;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.prog - a.prog;
    });
    list.forEach((k, i) => { k.rank = i + 1; });
    return list;
  }

  function finishKart(k, time) {
    if (k.finished) return;
    k.finished = true;
    k.time = time;
    ranking();
    ctx.event({ type: 'finish', id: k.id, rank: k.rank, time });
    if (!k.isBot && firstHumanFinish == null) firstHumanFinish = now();
  }

  function endRace() {
    if (game.results) return;
    const list = ranking();
    ctx.finish(list.map((k) => ({ id: k.id, name: k.name, vehicle: k.vehicle, isBot: k.isBot, time: k.finished ? k.time : null })));
  }

  function checkEnd() {
    const humans = alive().filter((k) => !k.isBot);
    const t = now();
    if (humans.length === 0) return endRace();
    if (humans.every((k) => k.finished)) {
      if (endAt == null) endAt = t + AFTER_ALL;
    } else if (firstHumanFinish != null && t - firstHumanFinish > AFTER_FIRST) {
      return endRace();
    }
    if (endAt != null && t >= endAt) endRace();
  }

  // Donne un objet au kart k s'il touche la boîte i encore présente.
  function takeBox(k, i) {
    if (!settings.items || boxes[i] === undefined || boxes[i] !== 0) return null;
    boxes[i] = now() + BOX_RESPAWN;
    if (k.item) return null; // on casse la boîte sans rien gagner
    const item = rollItem(k.rank, alive().length, rand);
    k.item = item;
    k.count = ITEMS[item].count || 1;
    return item;
  }

  function hitKart(k, kind, byEntity) {
    if (k.isBot) k.kart.hit(kind);
    ctx.event({ type: 'hit', target: k.id, kind, e: byEntity || null, bot: k.isBot || undefined });
  }

  // Utilisation d'un objet (humain ou bot). from : { x, y, z, yaw, speed }.
  function useItem(k, item, from, back) {
    if (!k.item || k.item !== item) return false;
    if (--k.count <= 0) { k.item = null; k.count = 0; }
    const list = alive();
    switch (item) {
      case 'banana':
        entities.spawn('banana', k.id, from, { back: back !== false });
        break;
      case 'green':
        entities.spawn('green', k.id, from, { back });
        break;
      case 'red': {
        const target = back ? null : kartAhead(list, k.id, k.prog);
        entities.spawn(target ? 'red' : 'green', k.id, from, { back, target: target && target.id });
        break;
      }
      case 'bomb':
        entities.spawn('bomb', k.id, from, { back });
        break;
      case 'lightning':
        for (const o of list) if (o.id !== k.id && !o.finished) hitKart(o, 'zap');
        ctx.event({ type: 'zap', from: k.id });
        break;
      default:
        // Turbo, étoile, bouclier : effet sur soi, appliqué par le pilote lui-même.
        if (k.isBot) applySelfItem(k.kart, item);
    }
    ctx.event({ type: 'use', id: k.id, item });
    return true;
  }

  function applySelfItem(kart, item) {
    if (item === 'mushroom' || item === 'triple') kart.boost(1.4);
    else if (item === 'star') { kart.starTime = 7; kart.boost(0.5); }
    else if (item === 'shield') { kart.shield = true; kart.shieldHits = 1; kart.shieldTime = 15; }
  }

  // ------------------------------------------------------------ pouvoirs

  const poseOf = (k) => ({ x: k.x, y: k.y, z: k.z, yaw: k.isBot ? k.kart.yaw : k.yaw, prog: k.prog });

  function teleportKart(k, pose) {
    if (k.isBot) k.kart.teleport(pose);
    else ctx.event({ type: 'teleport', id: k.id, pose });
    k.x = pose.x; k.y = pose.y; k.z = pose.z; k.prog = pose.prog;
  }

  // Pose sur la piste à la progression donnée (hors loopings).
  function poseAtProg(prog, lat = 0) {
    let s = T.wrapS(prog);
    let shift = 0;
    while (T.pointAt(s).loop && shift < 200) { s = T.wrapS(s - 10); shift += 10; }
    const p = T.pointAt(s, lat);
    return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, prog: prog - shift };
  }

  function usePower(k, from) {
    const id2 = k.power;
    const P = powerById(id2);
    if (!P || now() < k.powerReadyAt) return null;
    k.power = drawPower(k, 'race', rand);
    k.powerReadyAt = now() + POWER_COOLDOWN * 1000;
    const list = alive().filter((o) => o.id !== k.id && !o.finished);
    const origin = from || poseOf(k);
    let targets = [];
    const extra = {};

    switch (P.target) {
      case 'self':
        if (k.isBot) applyPowerToKart(k.kart, id2, 'self');
        if (id2 === 'teleport' && k.isBot) teleportKart(k, poseAtProg(k.prog + 70));
        if (id2 === 'pluie') {
          for (let i = 0; i < 5; i++) {
            const side = (i - 2) * 2.2;
            entities.spawn('banana', k.id, { ...origin, x: origin.x + Math.cos(origin.yaw) * side, z: origin.z - Math.sin(origin.yaw) * side }, { back: true, dx: -Math.sin(origin.yaw) * i * 3, dz: -Math.cos(origin.yaw) * i * 3 });
          }
        }
        if (id2 === 'caisses') {
          const q = T.query(origin.x, origin.y, origin.z, -1, {});
          for (let i = -1; i <= 1; i++) {
            const p = T.pointAt(q.s - 16, i * q.hw * 0.55);
            entities.spawn('crate', k.id, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: 0 });
          }
        }
        break;
      case 'random': {
        const cands = list.filter((o) => !(o.f & F.LOOP));
        const o = cands[Math.floor(rand() * cands.length)];
        if (o) {
          const a = poseOf(k);
          const b = poseOf(o);
          teleportKart(k, b);
          teleportKart(o, a);
          targets = [o.id];
        }
        break;
      }
      case 'ahead': {
        const o = id2 === 'voleur'
          ? list.filter((x) => x.prog > k.prog && x.item).sort((x, y) => x.prog - y.prog)[0]
          : kartAhead(list, k.id, k.prog);
        if (!o) break;
        targets = [o.id];
        if (id2 === 'bond') teleportKart(k, poseAtProg(o.prog - 7, 0));
        if (id2 === 'voleur') {
          extra.item = o.item;
          extra.count = o.count;
          k.item = o.item;
          k.count = o.count;
          o.item = null;
          o.count = 0;
          ctx.event({ type: 'stolen', target: o.id, by: k.id });
        }
        break;
      }
      case 'leader': {
        const ranked = ranking().filter((o) => !o.finished);
        const leader = ranked.find((o) => o.id !== k.id);
        if (leader) {
          entities.spawn('comet', k.id, { x: leader.x, y: leader.y, z: leader.z, yaw: 0, speed: 0 }, { target: leader.id });
          targets = [leader.id];
        }
        break;
      }
      case 'near':
        targets = list.filter((o) => Math.hypot(o.x - origin.x, o.z - origin.z) < P.range).map((o) => o.id);
        break;
      case 'aheadAll':
        targets = list.filter((o) => o.prog > k.prog).map((o) => o.id);
        break;
      case 'others':
        targets = list.map((o) => o.id);
        break;
      default:
    }

    // Effets sur les bots ciblés (les humains les appliquent eux-mêmes à la réception).
    if (P.target !== 'self' && P.target !== 'random' && id2 !== 'bond' && id2 !== 'voleur' && id2 !== 'comete') {
      for (const tid of targets) {
        const o = karts.get(tid);
        if (!o || !o.isBot) continue;
        const r = applyPowerToKart(o.kart, id2, 'target');
        if (r === 'push') {
          const dx = o.x - origin.x;
          const dz = o.z - origin.z;
          const d = Math.hypot(dx, dz) || 1;
          o.kart.ex += (dx / d) * 30;
          o.kart.ez += (dz / d) * 30;
          o.kart.vy = 7;
          o.kart.grounded = false;
        }
      }
    }
    ctx.event({ type: 'power', id: k.id, power: id2, targets, x: origin.x, y: origin.y, z: origin.z });
    return { ok: true, power: id2, next: k.power, readyIn: POWER_COOLDOWN * 1000, ...extra };
  }

  // ------------------------------------------------------------ boucle

  function tick(t, dt) {
    const rt = raceTime();
    if (rt >= 0 && settings.powers) {
      for (const k of karts.values()) if (k.powerReadyAt === Infinity) k.powerReadyAt = game.startAt + POWER_FIRST;
    }
    acc += dt;
    const all = alive();
    const leaderHuman = all.filter((k) => !k.isBot).reduce((m, k) => Math.max(m, k.prog), -Infinity);
    const grav = settings.chaos ? chaosGravity(Math.max(0, rt)) : 1;
    while (acc >= SIM_DT) {
      acc -= SIM_DT;
      entities.update(SIM_DT, all);
      for (const k of all) {
        if (!k.isBot) continue;
        const kart = k.kart;
        kart.locked = rt < 0;
        kart.gravMul = grav;
        kart.p.maxSpeed = k.finished ? k.baseMax * 0.6 // tour d'honneur au ralenti
          : k.baseMax * rubberBand(kart.prog, isFinite(leaderHuman) ? leaderHuman : null, T.length);
        const ahead = kartAhead(all, k.id, k.prog);
        const inp = k.brain.think(SIM_DT, {
          item: settings.items && !k.finished ? k.item : null,
          chased: all.some((o) => o.id !== k.id && o.prog < k.prog && k.prog - o.prog < 15),
          targetAhead: ahead && ahead.prog - k.prog < 45,
          useItem: (back) => useItem(k, k.item, { x: kart.x, y: kart.y, z: kart.z, yaw: kart.yaw, speed: kart.speed }, back),
          powerReady: settings.powers && !k.finished && rt > 0 && t >= k.powerReadyAt,
          usePower: () => usePower(k, null),
        });
        const px = kart.x;
        const pz = kart.z;
        kart.step(SIM_DT, inp);
        kart.collide(all.filter((o) => o !== k).map((o) => ({
          id: o.id, x: o.x, y: o.y, z: o.z, vx: o.vx, vz: o.vz,
          weight: o.isBot ? o.kart.baseWeight : vehicleById(o.vehicle).stats.weight,
          star: !!(o.f & F.STAR), ghost: !!(o.f & F.GHOST), giant: !!(o.f & F.GIANT), small: !!(o.f & F.SMALL),
        })));
        k.vx = (kart.x - px) / SIM_DT;
        k.vz = (kart.z - pz) / SIM_DT;
        k.x = kart.x; k.y = kart.y; k.z = kart.z; k.yaw = kart.visYaw; k.spd = kart.speed; k.f = kart.flags; k.prog = kart.prog;
        k.pitch = kart.pitch;

        // Boîtes à objets.
        if (settings.items) {
          for (let i = 0; i < T.boxes.length; i++) {
            const b = T.boxes[i];
            if (boxes[i] === 0 && Math.abs(b.x - kart.x) < 2.4 && Math.abs(b.z - kart.z) < 2.4 && Math.abs(b.y - kart.y - 1) < 2.5) takeBox(k, i);
          }
        }
        // Objets au sol.
        const e = entities.touching(kart, k.id);
        if (e && kart.fx.ghost <= 0) {
          entities.remove(e.id);
          hitKart(k, 'spin', e.id);
        }
        if (!k.finished && k.prog >= settings.laps * T.length) finishKart(k, rt);
      }
    }

    // Explosions (bombes, comètes).
    for (const ev of entities.events) {
      if (ev.type === 'boom') {
        ctx.event({ type: 'boom', x: ev.x, y: ev.y, z: ev.z });
        for (const k of all) {
          if (Math.hypot(k.x - ev.x, k.z - ev.z) < BOMB_RADIUS && Math.abs(k.y - ev.y) < 5) hitKart(k, 'tumble');
        }
      }
    }
    entities.events.length = 0;

    // Réapparition des boîtes.
    for (let i = 0; i < boxes.length; i++) if (boxes[i] && t >= boxes[i]) boxes[i] = 0;

    if (rt > 0) checkEnd();
  }

  const r2 = (v) => Math.round(v * 100) / 100;
  const r3 = (v) => Math.round(v * 1000) / 1000;

  function snapshot(t) {
    ranking();
    return {
      rt: raceTime(),
      k: alive().map((k) => [
        k.id, r2(k.x), r2(k.y), r2(k.z), r3(k.yaw), r2(k.spd), k.f | 0, r2(k.prog), k.rank, k.finished ? 1 : 0, r3(k.pitch || 0),
        k.power || 0, k.power ? Math.max(0, Math.round((k.powerReadyAt - t) / 100) / 10) : 0, r2(k.vx || 0), r2(k.vz || 0),
      ]),
      e: entities.snapshot(),
      b: boxes.map((x) => (x ? 0 : 1)).join(''),
    };
  }

  // Position envoyée en continu par un pilote humain.
  function humanState(pid, st) {
    const k = karts.get(pid);
    if (!k || k.isBot) return;
    k.x = +st.x || 0; k.y = +st.y || 0; k.z = +st.z || 0;
    k.yaw = +st.yaw || 0; k.spd = +st.spd || 0; k.f = st.f | 0; k.pitch = +st.pitch || 0;
    k.vx = +st.vx || 0; k.vz = +st.vz || 0;
    if (typeof st.prog === 'number' && isFinite(st.prog)) k.prog = st.prog;
  }

  // ------------------------------------------------------------ requêtes propres à la course

  Object.assign(game.handlers, {
    box(pid, p) {
      const k = karts.get(pid);
      if (!k || k.finished) return { item: null };
      return { item: takeBox(k, p?.i | 0) };
    },

    use(pid, p) {
      const k = karts.get(pid);
      if (!k || !p?.from) return { ok: false };
      const f = p.from;
      const from = { x: +f.x || 0, y: +f.y || 0, z: +f.z || 0, yaw: +f.yaw || 0, speed: +f.speed || 0 };
      return { ok: useItem(k, p.item, from, p.back) };
    },

    power(pid, p) {
      const k = karts.get(pid);
      if (!k || k.finished || !settings.powers) return { ok: false };
      const f = p?.from || {};
      const res = usePower(k, { x: +f.x || k.x, y: +f.y || k.y, z: +f.z || k.z, yaw: +f.yaw || 0, speed: +f.speed || 0 });
      return res || { ok: false, readyIn: Math.max(0, k.powerReadyAt - now()) };
    },

    hit(pid, p) {
      const e = entities.list.get(p?.e);
      if (!e) return { ok: false };
      entities.remove(e.id);
      ctx.event({ type: 'hit', target: pid, kind: 'spin', e: e.id });
      return { ok: true };
    },

    // Choc avec une étoile (ou un géant) : le pilote signale qui il a percuté.
    bump(pid, p) {
      const me = karts.get(pid);
      const o = karts.get(p?.target);
      if (!me || !o || !(me.f & (F.STAR | F.GIANT)) || Math.hypot(me.x - o.x, me.z - o.z) > 9) return { ok: false };
      hitKart(o, 'spin');
      return { ok: true };
    },

    finish(pid, p) {
      const k = karts.get(pid);
      if (!k) return { ok: false };
      if (k.prog < settings.laps * T.length - 30) return { ok: false };
      finishKart(k, Math.max(0, +p?.time || raceTime()));
      return { ok: true, rank: k.rank };
    },
  });

  return game;
}

export { POWERS };
