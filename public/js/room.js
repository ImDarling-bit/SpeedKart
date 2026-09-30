// Moteur de la partie, exécuté chez l'hôte : salon, réglages, départ, bots, objets, arrivée, points.
// Chaque joueur pilote son propre kart et envoie sa position ; l'hôte arbitre le reste
// (boîtes à objets, objets lancés, classement) et renvoie à tous un instantané 20 fois par seconde.

import { TrackPath } from './track.js';
import { TRACKS, trackById } from './data/tracks.js';
import { VEHICLES, vehicleById, vehicleParams, CC_CLASSES } from './data/vehicles.js';
import { Kart } from './kart.js';
import { BotBrain, rubberBand } from './ai.js';
import { Entities, rollItem, BOMB_RADIUS, kartAhead, ITEMS } from './items.js';
import { makeRng } from './util.js';

export const MAX_KARTS = 8;
const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];
const BOT_NAMES = ['Turbo Tom', 'Mémé Drift', 'Pilote Pixel', 'Capitaine Pneu', 'Lulu Nitro', 'Bob Bolide', 'Zaza Zoom', 'Gigi Gomme'];
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const SIM_DT = 1 / 60;
const SNAP_EVERY = 50; // ms
const LOAD_TIMEOUT = 20000;
const COUNTDOWN = 3000;
const BOX_RESPAWN = 3000;
const AFTER_FIRST = 35000; // fin forcée après l'arrivée du premier humain
const AFTER_ALL = 3500;

export function makeCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  return c;
}

const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Pilote';

export function createRoom(opts) {
  const { code, send } = opts;
  const now = opts.now || (() => performance.now());
  const rand = opts.rand || Math.random;

  const players = new Map(); // id -> { id, name, vehicle, score, isHost, connected }
  let hostId = null;
  const settings = { track: TRACKS[0].id, laps: 3, cc: 100, bots: true, items: true, difficulty: 2 };
  let phase = 'lobby'; // lobby | race | results
  let race = null;
  let raceSeq = 0;
  const bots = BOT_NAMES.map((name, i) => ({ id: `bot${i}`, name, vehicle: VEHICLES[(i * 5 + 3) % VEHICLES.length].id, score: 0 }));
  let loop = null;
  let lastTick = 0;
  let acc = 0;
  let lastSnap = 0;
  let destroyed = false;

  // ------------------------------------------------------------ état envoyé aux joueurs

  function publicPlayers() {
    return [...players.values()].map((p) => ({ id: p.id, name: p.name, vehicle: p.vehicle, score: p.score, isHost: p.isHost, connected: p.connected }));
  }

  function raceInfo() {
    if (!race) return null;
    return {
      id: race.id,
      track: race.trackId,
      laps: race.laps,
      cc: race.cc,
      items: race.items,
      grid: race.grid,
      startIn: race.startAt == null ? null : race.startAt - now(),
      results: race.results,
      loaded: race.loaded.size,
    };
  }

  function stateFor(pid) {
    return {
      code,
      phase,
      you: pid,
      hostId,
      settings: { ...settings },
      players: publicPlayers(),
      bots: bots.map((b) => ({ id: b.id, name: b.name, vehicle: b.vehicle, score: b.score })),
      race: raceInfo(),
    };
  }

  function broadcast() {
    for (const p of players.values()) if (p.connected) send(p.id, 'state', stateFor(p.id));
  }

  function event(ev) {
    for (const p of players.values()) if (p.connected) send(p.id, 'ev', ev);
  }

  // ------------------------------------------------------------ course

  function startRace() {
    const def = settings.track === 'random' ? TRACKS[Math.floor(rand() * TRACKS.length)] : trackById(settings.track);
    const track = new TrackPath(def);
    const ccMul = CC_CLASSES[settings.cc] || 1;
    const humans = [...players.values()].filter((p) => p.connected);

    // Grille : les humains dans un ordre aléatoire, puis les bots.
    const order = humans.map((p) => ({ id: p.id, name: p.name, vehicle: p.vehicle, isBot: false }));
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (settings.bots) {
      const free = bots.slice(0, Math.max(0, MAX_KARTS - order.length));
      for (const b of free) {
        if (rand() < 0.5) b.vehicle = VEHICLES[Math.floor(rand() * VEHICLES.length)].id;
        order.push({ id: b.id, name: b.name, vehicle: b.vehicle, isBot: true });
      }
    }
    order.forEach((g, i) => { g.slot = i; });

    const karts = new Map();
    const skill = [0.45, 0.65, 0.85][settings.difficulty - 1] ?? 0.65;
    for (const g of order) {
      const slot = track.gridSlot(g.slot);
      const entry = {
        id: g.id, name: g.name, vehicle: g.vehicle, isBot: g.isBot,
        x: slot.x, y: slot.y, z: slot.z, yaw: slot.yaw, spd: 0, f: 0,
        prog: slot.s, finished: false, time: null, // s négatif : derrière la ligne
        item: null, count: 0, rank: g.slot + 1, gone: false,
      };
      if (g.isBot) {
        const v = vehicleById(g.vehicle);
        const params = vehicleParams(v.stats, ccMul);
        const kart = new Kart(track, params);
        kart.place(slot);
        entry.kart = kart;
        entry.baseMax = params.maxSpeed;
        entry.brain = new BotBrain(kart, makeRng(Math.floor(rand() * 1e9)), skill + (rand() - 0.5) * 0.2);
        entry.prog = kart.prog;
      }
      karts.set(g.id, entry);
    }

    race = {
      id: ++raceSeq,
      trackId: def.id,
      laps: settings.laps,
      cc: settings.cc,
      items: settings.items,
      track,
      grid: order,
      karts,
      entities: new Entities(track),
      boxes: track.boxes.map(() => 0), // instant de réapparition (0 = présente)
      loaded: new Set(),
      startAt: null,
      createdAt: now(),
      finishOrder: [],
      firstHumanFinish: null,
      endAt: null,
      results: null,
    };
    phase = 'race';
    startLoop();
    broadcast();
  }

  function raceTime() {
    return race && race.startAt != null ? now() - race.startAt : -1;
  }

  function beginCountdown() {
    if (!race || race.startAt != null) return;
    race.startAt = now() + COUNTDOWN;
    broadcast();
  }

  function ranking() {
    const list = [...race.karts.values()].filter((k) => !k.gone);
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
    race.finishOrder.push(k.id);
    ranking();
    event({ type: 'finish', id: k.id, rank: k.rank, time });
    if (!k.isBot && race.firstHumanFinish == null) race.firstHumanFinish = now();
  }

  function endRace() {
    if (!race || race.results) return;
    const list = ranking();
    race.results = list.map((k, i) => {
      const pts = POINTS[i] || 0;
      let total = 0;
      if (k.isBot) {
        const b = bots.find((x) => x.id === k.id);
        if (b) total = b.score += pts;
      } else {
        const p = players.get(k.id);
        if (p) total = p.score += pts;
      }
      return { id: k.id, name: k.name, vehicle: k.vehicle, isBot: k.isBot, rank: i + 1, time: k.finished ? k.time : null, points: pts, total };
    });
    phase = 'results';
    stopLoop();
    broadcast();
  }

  function checkEnd() {
    const humans = [...race.karts.values()].filter((k) => !k.isBot && !k.gone);
    const t = now();
    if (humans.length === 0) return endRace();
    if (humans.every((k) => k.finished)) {
      if (race.endAt == null) race.endAt = t + AFTER_ALL;
    } else if (race.firstHumanFinish != null && t - race.firstHumanFinish > AFTER_FIRST) {
      return endRace();
    }
    if (race.endAt != null && t >= race.endAt) endRace();
  }

  // Donne un objet au kart k s'il touche la boîte i encore présente.
  function takeBox(k, i) {
    if (!race.items || race.boxes[i] === undefined || race.boxes[i] !== 0) return null;
    race.boxes[i] = now() + BOX_RESPAWN;
    if (k.item) return null; // on casse la boîte sans rien gagner
    const total = [...race.karts.values()].filter((x) => !x.gone).length;
    const item = rollItem(k.rank, total, rand);
    k.item = item;
    k.count = ITEMS[item].count || 1;
    return item;
  }

  function hitKart(k, kind, byEntity) {
    if (k.isBot) {
      k.kart.hit(kind);
      event({ type: 'hit', target: k.id, kind, e: byEntity || null, bot: true });
    } else {
      event({ type: 'hit', target: k.id, kind, e: byEntity || null });
    }
  }

  // Utilisation d'un objet (humain ou bot). from : { x, y, z, yaw, speed }.
  function useItem(k, item, from, back) {
    if (!k.item || k.item !== item) return false;
    if (--k.count <= 0) { k.item = null; k.count = 0; }
    const ents = race.entities;
    const list = [...race.karts.values()].filter((x) => !x.gone);
    switch (item) {
      case 'banana':
        ents.spawn('banana', k.id, from, { back: back !== false });
        break;
      case 'green':
        ents.spawn('green', k.id, from, { back });
        break;
      case 'red': {
        const target = back ? null : kartAhead(list, k.id, k.prog);
        ents.spawn(target ? 'red' : 'green', k.id, from, { back, target: target && target.id });
        break;
      }
      case 'bomb':
        ents.spawn('bomb', k.id, from, { back });
        break;
      case 'lightning':
        for (const o of list) if (o.id !== k.id && !o.finished) hitKart(o, 'zap');
        event({ type: 'zap', from: k.id });
        break;
      default:
        // Turbo, étoile, bouclier : effet sur soi, appliqué par le pilote lui-même.
        if (k.isBot) applySelf(k.kart, item);
    }
    event({ type: 'use', id: k.id, item });
    return true;
  }

  function applySelf(kart, item) {
    if (item === 'mushroom' || item === 'triple') kart.boost(1.4);
    else if (item === 'star') { kart.starTime = 7; kart.boost(0.5); }
    else if (item === 'shield') { kart.shield = true; kart.shieldTime = 15; }
  }

  function tick() {
    if (!race || destroyed) return;
    const t = now();
    let dt = (t - lastTick) / 1000;
    lastTick = t;
    if (dt > 0.25) dt = 0.25;

    // Chargement : tous prêts (ou délai dépassé) -> compte à rebours.
    if (race.startAt == null) {
      const need = race.grid.filter((g) => !g.isBot && players.get(g.id)?.connected);
      if (need.every((g) => race.loaded.has(g.id)) || t - race.createdAt > LOAD_TIMEOUT) beginCountdown();
      return;
    }
    const rt = raceTime();
    const T = race.track;

    acc += dt;
    const all = [...race.karts.values()].filter((k) => !k.gone);
    const leaderHuman = all.filter((k) => !k.isBot).reduce((m, k) => Math.max(m, k.prog), -Infinity);
    while (acc >= SIM_DT) {
      acc -= SIM_DT;
      race.entities.update(SIM_DT, all);
      for (const k of all) {
        if (!k.isBot) continue;
        const kart = k.kart;
        kart.locked = rt < 0;
        if (k.finished) {
          // Tour d'honneur au ralenti.
          kart.p.maxSpeed = k.baseMax * 0.6;
        } else {
          kart.p.maxSpeed = k.baseMax * rubberBand(kart.prog, isFinite(leaderHuman) ? leaderHuman : null, T.length);
        }
        const ahead = kartAhead(all, k.id, k.prog);
        const inp = k.brain.think(SIM_DT, {
          item: race.items && !k.finished ? k.item : null,
          chased: all.some((o) => o.id !== k.id && o.prog < k.prog && k.prog - o.prog < 15),
          targetAhead: ahead && ahead.prog - k.prog < 45,
          useItem: (back) => useItem(k, k.item, { x: kart.x, y: kart.y, z: kart.z, yaw: kart.yaw, speed: kart.speed }, back),
        });
        kart.step(SIM_DT, inp);
        kart.collide(all.filter((o) => o !== k).map((o) => ({ x: o.x, y: o.y, z: o.z, weight: o.isBot ? o.kart.p.weight : vehicleById(o.vehicle).stats.weight, star: !!(o.f & 16) })));
        k.x = kart.x; k.y = kart.y; k.z = kart.z; k.yaw = kart.visYaw; k.spd = kart.speed; k.f = kart.flags; k.prog = kart.prog;
        k.pitch = kart.grounded ? Math.atan(kart.q.slope || 0) : 0;

        // Boîtes à objets.
        if (race.items) {
          for (let i = 0; i < T.boxes.length; i++) {
            const b = T.boxes[i];
            if (race.boxes[i] === 0 && Math.abs(b.x - kart.x) < 2.4 && Math.abs(b.z - kart.z) < 2.4 && Math.abs(b.y - kart.y - 1) < 2.5) {
              takeBox(k, i);
            }
          }
        }
        // Objets au sol.
        const e = race.entities.touching(kart, k.id);
        if (e) {
          race.entities.remove(e.id);
          hitKart(k, 'spin', e.id);
        }
        if (!k.finished && k.prog >= race.laps * T.length) finishKart(k, rt);
      }
    }

    // Explosions de bombes.
    for (const ev of race.entities.events) {
      if (ev.type === 'boom') {
        event({ type: 'boom', x: ev.x, y: ev.y, z: ev.z });
        for (const k of all) {
          if (Math.hypot(k.x - ev.x, k.z - ev.z) < BOMB_RADIUS && Math.abs(k.y - ev.y) < 5) hitKart(k, 'tumble');
        }
      }
    }
    race.entities.events.length = 0;

    // Réapparition des boîtes.
    for (let i = 0; i < race.boxes.length; i++) if (race.boxes[i] && t >= race.boxes[i]) race.boxes[i] = 0;

    if (t - lastSnap >= SNAP_EVERY) {
      lastSnap = t;
      ranking();
      const snap = {
        rt,
        k: all.map((k) => [k.id, r2(k.x), r2(k.y), r2(k.z), r3(k.yaw), r2(k.spd), k.f | 0, r2(k.prog), k.rank, k.finished ? 1 : 0, r3(k.pitch || 0)]),
        e: race.entities.snapshot(),
        b: race.boxes.map((x) => (x ? 0 : 1)).join(''),
      };
      for (const p of players.values()) if (p.connected) send(p.id, 'snap', snap);
    }

    if (rt > 0) checkEnd();
  }

  const r2 = (v) => Math.round(v * 100) / 100;
  const r3 = (v) => Math.round(v * 1000) / 1000;

  // opts.ticker(fn, ms) -> stop() : horloge fournie par l'appelant (worker dans le navigateur).
  const ticker = opts.ticker || ((fn, ms) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  });

  function startLoop() {
    stopLoop();
    lastTick = now();
    acc = 0;
    loop = ticker(tick, 1000 / 60);
  }

  function stopLoop() {
    if (loop) loop();
    loop = null;
  }

  // ------------------------------------------------------------ requêtes

  const handlers = {
    join(pid, p) {
      if (players.has(pid)) {
        players.get(pid).connected = true;
        broadcast();
        return { ok: true, id: pid };
      }
      const connected = [...players.values()].filter((x) => x.connected).length;
      if (connected >= MAX_KARTS) return { error: 'La partie est pleine (8 pilotes).' };
      const isHost = hostId == null;
      if (isHost) hostId = pid;
      const vehicle = VEHICLES.some((v) => v.id === p?.vehicle) ? p.vehicle : VEHICLES[players.size % 5].id;
      players.set(pid, { id: pid, name: cleanName(p?.name), vehicle, score: 0, isHost, connected: true });
      broadcast();
      return { ok: true, id: pid };
    },

    vehicle(pid, p) {
      const pl = players.get(pid);
      if (!pl || !VEHICLES.some((v) => v.id === p?.id)) return { error: 'Véhicule inconnu.' };
      pl.vehicle = p.id;
      broadcast();
      return { ok: true };
    },

    settings(pid, p) {
      if (pid !== hostId) return { error: "Seul l'hôte règle la partie." };
      if (phase === 'race') return { error: 'Course en cours.' };
      if (p.track && (p.track === 'random' || TRACKS.some((t) => t.id === p.track))) settings.track = p.track;
      if (p.laps) settings.laps = Math.max(1, Math.min(7, p.laps | 0));
      if (p.cc && CC_CLASSES[p.cc]) settings.cc = +p.cc;
      if (typeof p.bots === 'boolean') settings.bots = p.bots;
      if (typeof p.items === 'boolean') settings.items = p.items;
      if (p.difficulty) settings.difficulty = Math.max(1, Math.min(3, p.difficulty | 0));
      broadcast();
      return { ok: true };
    },

    start(pid) {
      if (pid !== hostId) return { error: "Seul l'hôte lance la course." };
      if (phase === 'race') return { error: 'Course déjà lancée.' };
      startRace();
      return { ok: true };
    },

    lobby(pid) {
      if (pid !== hostId) return { error: "Seul l'hôte peut faire ça." };
      if (phase === 'race') endRace();
      phase = 'lobby';
      race = null;
      stopLoop();
      broadcast();
      return { ok: true };
    },

    resetScores(pid) {
      if (pid !== hostId) return { error: "Seul l'hôte peut faire ça." };
      for (const p of players.values()) p.score = 0;
      for (const b of bots) b.score = 0;
      broadcast();
      return { ok: true };
    },

    loaded(pid, p) {
      if (!race || p?.race !== race.id) return { ok: false };
      race.loaded.add(pid);
      return { ok: true, startIn: race.startAt == null ? null : race.startAt - now() };
    },

    box(pid, p) {
      if (!race) return { item: null };
      const k = race.karts.get(pid);
      if (!k || k.finished) return { item: null };
      return { item: takeBox(k, p?.i | 0) };
    },

    use(pid, p) {
      if (!race) return { ok: false };
      const k = race.karts.get(pid);
      if (!k || !p?.from) return { ok: false };
      const f = p.from;
      const from = { x: +f.x || 0, y: +f.y || 0, z: +f.z || 0, yaw: +f.yaw || 0, speed: +f.speed || 0 };
      return { ok: useItem(k, p.item, from, p.back) };
    },

    hit(pid, p) {
      if (!race) return { ok: false };
      const e = race.entities.list.get(p?.e);
      if (!e) return { ok: false };
      race.entities.remove(e.id);
      event({ type: 'hit', target: pid, kind: 'spin', e: e.id });
      return { ok: true };
    },

    // Choc avec une étoile : le pilote étoilé signale qui il a percuté.
    bump(pid, p) {
      if (!race) return { ok: false };
      const me = race.karts.get(pid);
      const o = race.karts.get(p?.target);
      if (!me || !o || !(me.f & 16) || Math.hypot(me.x - o.x, me.z - o.z) > 6) return { ok: false };
      hitKart(o, 'spin');
      return { ok: true };
    },

    finish(pid, p) {
      if (!race) return { ok: false };
      const k = race.karts.get(pid);
      if (!k) return { ok: false };
      if (k.prog < race.laps * race.track.length - 30) return { ok: false };
      finishKart(k, Math.max(0, +p?.time || raceTime()));
      return { ok: true, rank: k.rank };
    },

    leave(pid) {
      disconnect(pid, true);
      return { ok: true };
    },
  };

  function handle(pid, ev, payload) {
    if (destroyed) return { error: 'Partie terminée.' };
    const fn = handlers[ev];
    if (!fn) return { error: 'Action inconnue.' };
    if (ev !== 'join' && !players.has(pid)) return { error: 'Rejoins la partie d’abord.' };
    try {
      return fn(pid, payload || {});
    } catch (err) {
      console.error('[room]', ev, err);
      return { error: 'Erreur interne.' };
    }
  }

  // Position envoyée en continu par un pilote humain.
  function kart(pid, st) {
    if (!race || !st) return;
    const k = race.karts.get(pid);
    if (!k || k.isBot) return;
    k.x = +st.x || 0; k.y = +st.y || 0; k.z = +st.z || 0;
    k.yaw = +st.yaw || 0; k.spd = +st.spd || 0; k.f = st.f | 0; k.pitch = +st.pitch || 0;
    if (typeof st.prog === 'number' && isFinite(st.prog)) k.prog = st.prog;
  }

  function disconnect(pid, left) {
    const p = players.get(pid);
    if (!p) return;
    if (race && race.karts.has(pid)) race.karts.get(pid).gone = true;
    if (left || phase === 'lobby') players.delete(pid);
    else p.connected = false;
    broadcast();
  }

  function destroy() {
    destroyed = true;
    stopLoop();
  }

  return {
    code,
    config: { maxPlayers: MAX_KARTS },
    handle,
    kart,
    disconnect,
    destroy,
    // Pour les tests.
    get race() { return race; },
    get phase() { return phase; },
  };
}
