// Mode police contre voleurs, côté hôte. Plusieurs manches : les rôles tournent à chaque manche.
// Quatre règles :
//   heist  (braquage) : les voleurs rapportent des sacs d'argent à leur planque ; arrêtés, ils vont
//                       en prison, d'où un complice peut les libérer.
//   hunt   (chasse)   : la police doit arrêter tous les voleurs avant la fin du temps.
//   infect (contamination) : un voleur arrêté devient policier ; le dernier voleur libre gagne.
//   escape (évasion)  : les voleurs doivent atteindre une sortie de la ville.

import { CITIES, cityById, buildCity, makeCityWorld, nearestNode } from '../city.js';
import { Car3D, collideCars, CF } from '../car3d.js';
import { CopsBot } from '../copsbot.js';
import { ArenaEntities, PERSISTENT, SMOKE_RADIUS } from '../arenaitems.js';
import { VEHICLES, vehicleById } from '../data/vehicles.js';
import { sub, len, norm, qYaw } from '../vec.js';
import { makeRng } from '../util.js';

export const COPS_RULES = {
  heist: { name: 'Braquage', icon: '💰', desc: 'Les voleurs rapportent l’argent à leur planque. Arrêtés : prison, sauf si un complice les libère.' },
  hunt: { name: 'Chasse à l’homme', icon: '🎯', desc: 'La police doit arrêter tous les voleurs avant la fin du temps.' },
  infect: { name: 'Contamination', icon: '🦠', desc: 'Un voleur arrêté devient policier. Le dernier voleur libre gagne.' },
  escape: { name: 'Évasion', icon: '🚪', desc: 'Les voleurs doivent rejoindre une sortie de la ville, ouverte au bout de 20 s.' },
};

// Gadgets (3 par camp) : touches E, R, F (manette LB, croix haut, Y).
export const GADGETS = {
  cop: [
    { id: 'sirene', name: 'Sirène', icon: '🚨', cd: 14, desc: 'Turbo et voleurs révélés sur la carte pendant 5 s.' },
    { id: 'herse', name: 'Herse', icon: '📌', cd: 18, desc: 'Une herse derrière toi : les voleurs qui roulent dessus partent en toupie.' },
    { id: 'cones', name: 'Barrage', icon: '🚧', cd: 20, desc: 'Une rangée de cônes derrière toi.' },
  ],
  thief: [
    { id: 'nitro', name: 'Nitro', icon: '🔥', cd: 10, desc: 'Une grosse accélération.' },
    { id: 'fumee', name: 'Fumigène', icon: '💨', cd: 16, desc: 'Un nuage de fumée qui aveugle les poursuivants.' },
    { id: 'huile', name: 'Huile', icon: '🛢️', cd: 14, desc: 'Une flaque d’huile qui fait déraper.' },
  ],
};

const MAX_CARS = 8;
const SUB = 1 / 120;
const INTRO = 4000; // présentation des rôles
const HEAD_START = 5000; // avance des voleurs
const ROUND_END = 5000;
const EXIT_OPEN = 20000;
const BAG_RESPAWN = 15000;
const ARREST_DIST = 3.6;

export function createCopsGame(ctx, id) {
  const { now, rand } = ctx;
  const settings = { ...ctx.settings };
  const rule = COPS_RULES[settings.copsRule] ? settings.copsRule : 'heist';
  const cityDef = settings.city === 'random' || !settings.city ? CITIES[Math.floor(rand() * CITIES.length)] : cityById(settings.city);
  const city = buildCity(cityDef);
  const world = makeCityWorld(city);

  // ------------------------------------------------------------ participants et manches
  const roster = ctx.humans().map((p) => ({ id: p.id, name: p.name, vehicle: p.vehicle, color: p.color, horn: p.horn, isBot: false }));
  for (let i = roster.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [roster[i], roster[j]] = [roster[j], roster[i]];
  }
  if (settings.bots) {
    for (const b of ctx.bots.slice(0, Math.max(0, MAX_CARS - roster.length))) {
      if (rand() < 0.5) b.vehicle = VEHICLES[Math.floor(rand() * VEHICLES.length)].id;
      roster.push({ id: b.id, name: b.name, vehicle: b.vehicle, color: b.color, horn: b.horn, isBot: true });
    }
  }
  const n = roster.length;
  const copsPer = rule === 'infect' ? (n > 5 ? 2 : 1) : Math.max(1, Math.round(n / 3));
  const rounds = Math.max(2, Math.min(4, Math.ceil(n / copsPer)));

  const cars = new Map();
  for (const r of roster) {
    cars.set(r.id, {
      ...r, weight: vehicleById(r.vehicle).stats.weight, role: 'thief', p: [0, 1, 0], q: [0, 0, 0, 1], v: [0, 0, 0], f: 0,
      score: 0, arrests: 0, bags: 0, deposited: 0, jailed: false, out: false, escaped: false, gone: false,
      gadgetAt: [0, 0, 0], invulnUntil: 0, lockedUntil: 0, car: null, brain: null,
    });
  }

  const entities = new ArenaEntities(world);
  const bagSpots = city.bagSpots.map((p) => ({ p, on: false, at: 0 }));
  let round = -1;
  let phase = 'intro'; // intro | play | end
  let phaseUntil = 0;
  let timeLeft = 0;
  let money = 0;
  let target = 0;
  let roundStart = 0;
  let copsFreeAt = 0;
  let winner = null;
  let acc = 0;
  const smokeHits = new Map(); // fumée -> véhicules déjà aveuglés

  const game = {
    id,
    mode: 'cops',
    loaded: new Set(),
    startAt: null,
    results: null,
    humanIds: () => roster.filter((r) => !r.isBot).map((r) => r.id),
    info: () => ({
      id, mode: 'cops', rule, city: cityDef.id, arena: cityDef.name, rounds, matchTime: settings.matchTime,
      grid: roster.map((r) => ({ id: r.id, name: r.name, vehicle: r.vehicle, color: r.color, horn: r.horn, isBot: r.isBot })),
      roundInfo: roundInfo(),
    }),
    handlers: {},
    tick,
    snapshot,
    kart: humanState,
    disconnect(pid) { if (cars.has(pid)) cars.get(pid).gone = true; },
    forceEnd: finish,
  };

  const alive = () => [...cars.values()].filter((c) => !c.gone);
  const thieves = () => alive().filter((c) => c.role === 'thief');
  const cops = () => alive().filter((c) => c.role === 'cop');
  const free = (c) => !c.jailed && !c.out && !c.escaped;

  // ------------------------------------------------------------ manches

  function spawnSpots() {
    // Police au centre, voleurs dans les carrefours les plus éloignés.
    const center = city.prison ? city.prison.button : [0, 0, 0];
    const byDist = [...city.nodes].sort((a, b) => Math.hypot(b.x - center[0], b.z - center[2]) - Math.hypot(a.x - center[0], a.z - center[2]));
    const near = [...city.nodes].sort((a, b) => Math.hypot(a.x - center[0], a.z - center[2]) - Math.hypot(b.x - center[0], b.z - center[2]));
    return { far: byDist, near };
  }

  function roundInfo() {
    if (round < 0) return null;
    const poses = {};
    const roles = {};
    for (const c of cars.values()) { poses[c.id] = { p: c.p, yaw: c.spawnYaw || 0 }; roles[c.id] = c.role; }
    return { n: round, rounds, roles, poses, target, timeLeft, rule };
  }

  function setupRound() {
    round++;
    const list = roster.filter((r) => cars.has(r.id) && !cars.get(r.id).gone);
    const copIds = new Set();
    for (let k = 0; k < copsPer; k++) copIds.add(list[(round * copsPer + k) % list.length].id);
    const { far, near } = spawnSpots();
    let fi = 0;
    let ni = 0;
    for (const c of alive()) {
      c.role = copIds.has(c.id) ? 'cop' : 'thief';
      c.bags = 0;
      c.jailed = false;
      c.out = false;
      c.escaped = false;
      c.gadgetAt = [0, 0, 0];
      const node = c.role === 'cop' ? near[ni++ % near.length] : far[(fi++ * 3) % far.length];
      const nb = city.nodes[node.links[0]];
      const yaw = Math.atan2(nb.x - node.x, nb.z - node.z);
      c.p = [node.x + (ni % 2) * 3, 1.2, node.z];
      c.q = qYaw(yaw);
      c.v = [0, 0, 0];
      c.spawnYaw = yaw;
      c.invulnUntil = 0;
      // Véhicules imposés : voitures de police pour la police.
      const vid = c.role === 'cop' ? 'police' : c.vehicle;
      if (c.isBot) {
        c.car = new Car3D(world, 'cops', vehicleById(vid).stats.weight);
        c.car.place(c.p[0], c.p[1], c.p[2], yaw);
        if (c.role === 'cop') c.car.speedMul = 1.04;
        c.brain = new CopsBot(c.car, city, makeRng(Math.floor(rand() * 1e9)), ctx.skill);
      }
    }
    for (const b of bagSpots) { b.on = false; b.at = 0; }
    const nThieves = thieves().length;
    if (rule === 'heist') {
      const active = Math.min(bagSpots.length, nThieves * 2 + 2);
      const idx = bagSpots.map((_, i) => i).sort(() => rand() - 0.5).slice(0, active);
      for (const i of idx) bagSpots[i].on = true;
      target = Math.max(4, nThieves * 3);
    } else target = 0;
    money = 0;
    winner = null;
    timeLeft = settings.matchTime * 60000;
    entities.list.clear();
  }

  function startRound(t, withIntro) {
    setupRound();
    roundStart = t + (withIntro ? INTRO : 0);
    copsFreeAt = roundStart + HEAD_START;
    phase = withIntro ? 'intro' : 'play';
    phaseUntil = roundStart;
    ctx.event({ type: 'round', ...roundInfo(), introMs: withIntro ? INTRO : 0, headStart: HEAD_START });
  }

  function endRound(win) {
    if (phase === 'end') return;
    winner = win;
    for (const c of alive()) {
      if (c.role === win) c.score += 10;
      if (win === 'thief' && c.role === 'thief' && free(c)) c.score += 5;
    }
    phase = 'end';
    phaseUntil = now() + ROUND_END;
    ctx.event({
      type: 'roundEnd', winner: win, round, rounds, money, target,
      scores: Object.fromEntries(alive().map((c) => [c.id, c.score])),
    });
  }

  function finish() {
    if (game.results) return;
    const list = alive().sort((a, b) => b.score - a.score);
    ctx.finish(list.map((c) => ({ id: c.id, name: c.name, vehicle: c.vehicle, isBot: c.isBot, score: c.score, arrests: c.arrests, deposited: c.deposited })));
  }

  // ------------------------------------------------------------ actions

  function teleport(c, pose, lock = 0) {
    c.p = [...pose.p];
    c.q = qYaw(pose.yaw || 0);
    c.v = [0, 0, 0];
    if (c.car) c.car.place(pose.p[0], pose.p[1], pose.p[2], pose.yaw || 0);
    if (lock) c.lockedUntil = now() + lock;
  }

  function arrest(thief, cop) {
    const t = now();
    if (!free(thief) || t < thief.invulnUntil || thief.role !== 'thief' || cop.role !== 'cop' || phase !== 'play') return false;
    cop.score += 10;
    cop.arrests++;
    let kind = 'out';
    if (rule === 'heist') {
      kind = 'jail';
      thief.jailed = true;
      // Les sacs transportés retournent dans la ville.
      for (let k = 0; k < thief.bags; k++) {
        const s = bagSpots.filter((b) => !b.on && !b.at)[0];
        if (s) s.at = t + 3000;
      }
      thief.bags = 0;
      const cell = city.prison.cells[thieves().filter((x) => x.jailed).length % city.prison.cells.length];
      teleport(thief, { p: cell, yaw: 0 });
    } else if (rule === 'hunt') {
      thief.out = true;
    } else if (rule === 'infect') {
      kind = 'convert';
      thief.role = 'cop';
      thief.invulnUntil = t + 3000;
      thief.lockedUntil = t + 2000;
      if (thief.car) thief.car.speedMul = 1.04;
    } else {
      kind = 'back';
      const { far } = spawnSpots();
      const node = far[Math.floor(rand() * 4)];
      teleport(thief, { p: [node.x, 1.2, node.z], yaw: 0 }, 4000);
      thief.invulnUntil = t + 6000;
    }
    ctx.event({ type: 'arrest', cop: cop.id, thief: thief.id, kind, pose: kind === 'jail' || kind === 'back' ? { p: thief.p, yaw: 0 } : null });
    return true;
  }

  function freePrisoners(by) {
    const jailed = thieves().filter((c) => c.jailed);
    if (!jailed.length) return false;
    const b = city.prison.button;
    const poses = {};
    jailed.forEach((c, i) => {
      c.jailed = false;
      c.invulnUntil = now() + 3000;
      const pose = { p: [b[0] + (i - jailed.length / 2) * 4, 1.2, b[2] + 6], yaw: 0 };
      teleport(c, pose);
      poses[c.id] = pose;
    });
    by.score += 5 * jailed.length;
    ctx.event({ type: 'freed', by: by.id, poses });
    return true;
  }

  function useGadget(c, slot, origin) {
    const g = GADGETS[c.role][slot];
    const t = now();
    if (!g || t < c.gadgetAt[slot] || !free(c)) return null;
    c.gadgetAt[slot] = t + g.cd * 1000;
    const from = { p: origin?.p || c.p, fwd: origin?.fwd || norm([2 * (c.q[0] * c.q[2] + c.q[3] * c.q[1]), 0, 1 - 2 * (c.q[0] ** 2 + c.q[1] ** 2)]), speed: 0 };
    switch (g.id) {
      case 'sirene':
        if (c.car) c.car.effect('turbo', 2.5);
        ctx.event({ type: 'siren', id: c.id, until: 5000 });
        break;
      case 'nitro':
        if (c.car) c.car.effect('turbo', 1.6);
        break;
      case 'herse':
        entities.spawn('spike', c.id, from, { dist: -6 });
        break;
      case 'cones': {
        const side = [from.fwd[2], 0, -from.fwd[0]];
        for (const k of [-1, 0, 1]) entities.spawn('cone', c.id, from, { dist: -6, offset: [side[0] * k * 3, 0, side[2] * k * 3] });
        break;
      }
      case 'fumee': entities.spawn('smoke', c.id, from, { dist: -6 }); break;
      case 'huile': entities.spawn('oil', c.id, from, { dist: -6 }); break;
      default:
    }
    ctx.event({ type: 'gadget', id: c.id, gadget: g.id, x: from.p[0], y: from.p[1], z: from.p[2] });
    return { ok: true, readyIn: g.cd * 1000, gadget: g.id };
  }

  function hitBy(c, e) {
    if (PERSISTENT[e.type]) e.hits.add(c.id);
    else entities.remove(e.id);
    // La herse ne piège que les voleurs.
    if (e.type === 'spike' && c.role !== 'thief') return;
    if (c.car) c.car.spinOut();
    else ctx.event({ type: 'hit', target: c.id, e: e.id });
  }

  // ------------------------------------------------------------ boucle

  // Première manche préparée dès la création : rôles et positions sont connus au chargement.
  setupRound();
  let started = false;

  function tick(t, dt) {
    if (game.results) return;
    if (!started) {
      started = true;
      roundStart = game.startAt;
      copsFreeAt = roundStart + HEAD_START;
      phase = 'play';
    }
    if (phase === 'intro' && t >= phaseUntil) phase = 'play';
    if (phase === 'end' && t >= phaseUntil) {
      if (round + 1 >= rounds) return finish();
      startRound(t, true);
    }
    const playing = phase === 'play' && t >= roundStart;

    acc += dt;
    const list = alive();
    while (acc >= SUB) {
      acc -= SUB;
      const obstacles = list.map((c) => ({ id: c.id, p: c.p, q: c.q, v: c.v, mass: 0.75 + c.weight * 0.1, ghost: c.jailed || c.out || c.escaped }));
      for (const c of list) {
        if (!c.isBot || c.out || c.escaped) continue;
        const car = c.car;
        car.locked = !playing || t < c.lockedUntil || (c.role === 'cop' && t < copsFreeAt);
        car.speedMul = (c.role === 'cop' ? 1.04 : 1) * (1 - 0.07 * c.bags);
        const inp = c.brain.think(SUB, {
          role: c.role, rule, me: c,
          cops: list.filter((o) => o.role === 'cop').map((o) => ({ id: o.id, p: o.p, v: o.v })),
          thieves: list.filter((o) => o.role === 'thief').map((o) => ({ id: o.id, p: o.p, v: o.v, jailed: o.jailed, out: o.out || o.escaped })),
          bags: bagSpots, hideouts: city.hideouts, prison: city.prison, exits: city.exits,
          exitsOpen: t - roundStart > EXIT_OPEN, prisoners: list.filter((o) => o.jailed).length,
          gadgetReady: (s) => t >= c.gadgetAt[s],
          useGadget: (s) => useGadget(c, s, null),
        });
        car.step(SUB, inp, 0);
        for (const o of obstacles) if (o.id !== c.id && !o.ghost) collideCars(car, o, 'cops');
        c.p = car.p; c.q = car.q; c.v = car.v; c.f = car.flags;
        if (car.p[1] < -6) {
          const nd = nearestNode(city, car.p);
          car.place(nd.x, 1.5, nd.z, 0);
        }
        if (!playing || c.jailed) continue;
        // Arrestations par les policiers bots.
        if (c.role === 'cop') {
          for (const o of list) {
            if (o.role === 'thief' && free(o) && len(sub(o.p, c.p)) < ARREST_DIST) arrest(o, c);
          }
        } else {
          // Voleurs bots : sacs, planque, prison, sortie.
          if (rule === 'heist') {
            bagSpots.forEach((b) => {
              if (b.on && c.bags < 3 && len(sub(b.p, c.p)) < 3.8) { b.on = false; b.at = t + BAG_RESPAWN; c.bags++; ctx.event({ type: 'bag', id: c.id, n: c.bags }); }
            });
            for (const h of city.hideouts) if (c.bags && len(sub(h.p, [c.p[0], 0, c.p[2]])) < h.r) deposit(c);
            if (len(sub(city.prison.button, [c.p[0], 0, c.p[2]])) < 4.5) freePrisoners(c);
          }
          if (rule === 'escape' && t - roundStart > EXIT_OPEN) {
            for (const e of city.exits) if (len(sub(e.p, [c.p[0], 0, c.p[2]])) < e.r) escape(c);
          }
        }
        const e = entities.touching(car.p, c.id, c.id);
        if (e) hitBy(c, e);
      }
      entities.update(SUB, [], 0);
    }

    // Fumée : aveugle les poursuivants qui la traversent.
    for (const e of entities.list.values()) {
      if (e.type !== 'smoke') continue;
      const seen = smokeHits.get(e.id) || new Set();
      smokeHits.set(e.id, seen);
      for (const c of list) {
        if (c.role !== 'cop' || seen.has(c.id) || len(sub(c.p, e.p)) > SMOKE_RADIUS) continue;
        seen.add(c.id);
        if (c.car) c.car.effect('invert', 1.2);
        else ctx.event({ type: 'blind', target: c.id });
      }
    }
    for (const b of bagSpots) if (b.at && t >= b.at && rule === 'heist') { b.at = 0; b.on = true; }

    // Fin de manche.
    if (playing) {
      timeLeft = Math.max(0, timeLeft - dt * 1000);
      const th = thieves();
      const freeT = th.filter(free);
      if (rule === 'heist') {
        if (money >= target) endRound('thief');
        else if (th.length && !freeT.length) endRound('cop');
        else if (timeLeft <= 0) endRound('cop');
      } else if (rule === 'hunt') {
        if (!freeT.length) endRound('cop');
        else if (timeLeft <= 0) endRound('thief');
      } else if (rule === 'infect') {
        if (freeT.length <= 1 && list.length > 2) {
          if (freeT[0]) freeT[0].score += 20;
          endRound(freeT.length ? 'thief' : 'cop');
        } else if (timeLeft <= 0) endRound('thief');
      } else {
        const escaped = th.filter((c) => c.escaped).length;
        if (!th.some((c) => !c.escaped)) endRound('thief');
        else if (timeLeft <= 0) endRound(escaped * 2 >= th.length ? 'thief' : 'cop');
      }
    }
    if (list.every((c) => c.isBot)) finish();
  }

  function deposit(c) {
    if (!c.bags || phase !== 'play') return false;
    money += c.bags;
    c.score += 5 * c.bags;
    c.deposited += c.bags;
    ctx.event({ type: 'deposit', id: c.id, n: c.bags, money, target });
    c.bags = 0;
    return true;
  }

  function escape(c) {
    if (!free(c) || c.role !== 'thief') return false;
    c.escaped = true;
    c.score += 15;
    ctx.event({ type: 'escaped', id: c.id });
    return true;
  }

  const r2 = (v) => Math.round(v * 100) / 100;
  const r4 = (v) => Math.round(v * 10000) / 10000;

  function snapshot(t) {
    return {
      tl: Math.round(timeLeft),
      ph: phase,
      rn: round,
      money,
      target,
      ex: t - roundStart > EXIT_OPEN ? 1 : 0,
      cf: Math.max(0, copsFreeAt - t),
      bags: bagSpots.map((b) => (b.on ? 1 : 0)).join(''),
      k: alive().map((c) => [
        c.id, r2(c.p[0]), r2(c.p[1]), r2(c.p[2]), r4(c.q[0]), r4(c.q[1]), r4(c.q[2]), r4(c.q[3]),
        r2(c.v[0]), r2(c.v[1]), r2(c.v[2]), c.f | ((c.out || c.escaped) ? CF.OUT : 0) | (t < c.invulnUntil ? CF.BLINK : 0),
        (c.role === 'cop' ? 1 : 0) | (c.jailed ? 2 : 0) | (c.out ? 4 : 0) | (c.escaped ? 8 : 0) | (c.bags << 4), c.score, 0, 0,
      ]),
      e: entities.snapshot(),
    };
  }

  function humanState(pid, st) {
    const c = cars.get(pid);
    if (!c || c.isBot) return;
    const num = (a, k) => (Array.isArray(a) && a.length === k && a.every((x) => typeof x === 'number' && isFinite(x)) ? a : null);
    c.p = num(st.p, 3) || c.p;
    c.q = num(st.q, 4) || c.q;
    c.v = num(st.v, 3) || c.v;
    c.f = st.f | 0;
  }

  // ------------------------------------------------------------ requêtes des joueurs

  const near = (c, p, r) => Math.hypot(c.p[0] - p[0], c.p[2] - p[2]) < r;

  Object.assign(game.handlers, {
    arrest(pid, p) {
      const cop = cars.get(pid);
      const thief = cars.get(p?.target);
      if (!cop || !thief || len(sub(cop.p, thief.p)) > ARREST_DIST + 4) return { ok: false };
      return { ok: arrest(thief, cop) };
    },
    bag(pid, p) {
      const c = cars.get(pid);
      const b = bagSpots[p?.i | 0];
      if (!c || !b || !b.on || c.role !== 'thief' || !free(c) || c.bags >= 3 || !near(c, b.p, 7) || phase !== 'play') return { ok: false };
      b.on = false;
      b.at = now() + BAG_RESPAWN;
      c.bags++;
      ctx.event({ type: 'bag', id: c.id, n: c.bags });
      return { ok: true, bags: c.bags };
    },
    deposit(pid) {
      const c = cars.get(pid);
      if (!c || !city.hideouts.some((h) => near(c, h.p, h.r + 4))) return { ok: false };
      return { ok: deposit(c) };
    },
    free(pid) {
      const c = cars.get(pid);
      if (!c || c.role !== 'thief' || !free(c) || !near(c, city.prison.button, 8) || rule !== 'heist') return { ok: false };
      return { ok: freePrisoners(c) };
    },
    escape(pid) {
      const c = cars.get(pid);
      if (!c || now() - roundStart < EXIT_OPEN || !city.exits.some((e) => near(c, e.p, e.r + 4))) return { ok: false };
      return { ok: escape(c) };
    },
    gadget(pid, p) {
      const c = cars.get(pid);
      if (!c || phase !== 'play') return { ok: false };
      const origin = Array.isArray(p?.p) && Array.isArray(p?.fwd) ? { p: p.p.map(Number), fwd: p.fwd.map(Number) } : null;
      return useGadget(c, p?.slot | 0, origin) || { ok: false };
    },
    hit(pid, p) {
      const c = cars.get(pid);
      const e = entities.list.get(p?.e);
      if (!c || !e) return { ok: false };
      if (PERSISTENT[e.type]) e.hits.add(c.id);
      else entities.remove(e.id);
      return { ok: true };
    },
  });

  return game;
}
