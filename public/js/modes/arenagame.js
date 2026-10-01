// Modes en arène, côté hôte : tamponneuse (bumper), foot motorisé (rocket), bataille de ballons (battle).
// Chaque joueur simule sa propre voiture et envoie sa position ; l'hôte simule les bots, le ballon,
// les objets, arbitre les buts, les éjections et les ballons crevés.

import { makeWorld, ARENAS, goalScored, bumperGravity, BUMPER_PHASES, PHASE_LEN } from '../arena.js';
import { Car3D, Ball, collideCars, hitBall, CF } from '../car3d.js';
import { ArenaBot } from '../ai3d.js';
import { ArenaEntities, rollArenaItem, ARENA_BOMB_RADIUS } from '../arenaitems.js';
import { VEHICLES, vehicleById } from '../data/vehicles.js';
import { ITEMS } from '../items.js';
import { POWER_COOLDOWN, drawPower, powerById, applyPowerToCar } from '../powers.js';
import { add, sub, len, norm, scale, qYaw, yawOf } from '../vec.js';
import { makeRng } from '../util.js';

export const ARENA_MODES = ['bumper', 'rocket', 'battle'];
const MAX_CARS = 8;
const SUB = 1 / 120;
const GOAL_PAUSE = 3500;
const KICKOFF = 3000;
const BOX_RESPAWN = 3000;

// Emplacements de départ.
export function spawnPoints(mode, count) {
  if (mode === 'bumper') {
    const R = ARENAS.bumper.radius * 0.62;
    return Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + 0.3;
      return { p: [Math.cos(a) * R, 1.2, Math.sin(a) * R], yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) };
    });
  }
  if (mode === 'battle') {
    const h = ARENAS.battle.half - 8;
    const spots = [[-h, -h], [h, h], [h, -h], [-h, h], [0, -h], [0, h], [-h, 0], [h, 0]];
    return spots.slice(0, count).map(([x, z]) => ({ p: [x, 1.2, z], yaw: Math.atan2(-x, -z) }));
  }
  return [];
}

// Engagement du foot (équipe bleue côté -Z, attaque vers +Z).
export function kickoffSpots(team, n) {
  const s = team === 'blue' ? -1 : 1;
  const base = [[-22, 34], [22, 34], [-3, 52], [3, 52], [0, 62]];
  return base.slice(0, n).map(([x, z]) => {
    const p = [x * -s, 1.2, z * s];
    return { p, yaw: Math.atan2(-p[0], -p[2]) };
  });
}

// Pastilles de turbo du foot : 6 grosses (100 %), 18 petites (+12).
export function boostPads() {
  const A = ARENAS.rocket;
  const pads = [];
  for (const sx of [-1, 1]) {
    pads.push({ p: [sx * (A.X - 7), 0, 0], big: true });
    for (const sz of [-1, 1]) pads.push({ p: [sx * (A.X - 8), 0, sz * (A.Z - 10)], big: true });
  }
  for (const [x, z] of [[0, -30], [0, 30], [-18, -18], [18, -18], [-18, 18], [18, 18], [-30, 0], [30, 0], [0, -52], [0, 52],
    [-24, -46], [24, -46], [-24, 46], [24, 46], [-38, -30], [38, -30], [-38, 30], [38, 30]]) pads.push({ p: [x, 0, z], big: false });
  return pads;
}

export function battleBoxes() {
  const pts = [[0, 4.6, 0], [-20, 1, -20], [20, 1, 20], [-20, 1, 20], [20, 1, -20], [-44, 1, 0], [44, 1, 0], [0, 1, -44], [0, 1, 44], [-44, 1, -44], [44, 1, 44]];
  return pts.map((p) => ({ p }));
}

export function createArenaGame(ctx, id, mode) {
  const { now, rand } = ctx;
  const settings = { ...ctx.settings };
  const world = makeWorld(mode);
  const A = world.def;

  // ------------------------------------------------------------ participants
  const humans = ctx.humans();
  const roster = humans.map((p) => ({ id: p.id, name: p.name, vehicle: p.vehicle, color: p.color, horn: p.horn, isBot: false, pref: p.team }));
  if (mode === 'rocket') {
    // Équipes : on respecte les choix, puis on équilibre.
    const blue = roster.filter((r) => r.pref === 'blue');
    const orange = roster.filter((r) => r.pref === 'orange');
    for (const r of roster.filter((x) => x.pref !== 'blue' && x.pref !== 'orange')) (blue.length <= orange.length ? blue : orange).push(r);
    blue.forEach((r) => { r.team = 'blue'; });
    orange.forEach((r) => { r.team = 'orange'; });
    const size = Math.max(settings.teamSize, blue.length, orange.length);
    if (settings.bots) {
      let bi = 0;
      for (const team of ['blue', 'orange']) {
        const cur = roster.filter((r) => r.team === team).length;
        for (let i = cur; i < size && bi < ctx.bots.length; i++) {
          const b = ctx.bots[bi++];
          roster.push({ id: b.id, name: b.name, vehicle: b.vehicle, color: b.color, horn: b.horn, isBot: true, team });
        }
      }
    }
  } else if (settings.bots) {
    for (const b of ctx.bots.slice(0, Math.max(0, MAX_CARS - roster.length))) {
      if (rand() < 0.5) b.vehicle = VEHICLES[Math.floor(rand() * VEHICLES.length)].id;
      roster.push({ id: b.id, name: b.name, vehicle: b.vehicle, color: b.color, horn: b.horn, isBot: true });
    }
  }

  const cars = new Map();
  const starts = spawnPoints(mode, roster.length);
  const teamIndex = { blue: 0, orange: 0 };
  roster.forEach((r, i) => {
    let spot = starts[i];
    if (mode === 'rocket') {
      const n = roster.filter((x) => x.team === r.team).length;
      spot = kickoffSpots(r.team, n)[teamIndex[r.team]++];
    }
    r.spawn = spot;
    const weight = vehicleById(r.vehicle).stats.weight;
    const e = {
      ...r, p: [...spot.p], q: qYaw(spot.yaw), v: [0, 0, 0], f: 0, weight,
      score: 0, goals: 0, touches: 0, balloons: mode === 'battle' ? settings.balloons : 0, pops: 0, out: false,
      item: null, count: 0, lastHitBy: null, lastHitAt: 0, invulnUntil: 0, respawnAt: 0, gone: false,
      power: null, powerReadyAt: Infinity, powerBag: null,
    };
    if (mode === 'battle' && settings.powers) e.power = drawPower(e, 'battle', rand);
    if (r.isBot) {
      const car = new Car3D(world, mode, weight);
      car.place(spot.p[0], spot.p[1], spot.p[2], spot.yaw);
      e.car = car;
      e.brain = new ArenaBot(car, mode, makeRng(Math.floor(rand() * 1e9)), ctx.skill);
    }
    cars.set(r.id, e);
  });

  const ball = mode === 'rocket' ? new Ball(world, A.ballR) : null;
  const pads = mode === 'rocket' ? boostPads().map((p) => ({ ...p, at: 0 })) : [];
  const boxes = mode === 'battle' ? battleBoxes().map((b) => ({ ...b, at: 0 })) : [];
  const entities = mode === 'battle' ? new ArenaEntities(world) : null;
  const score = [0, 0]; // bleu, orange
  let phase = 'play'; // play | goal | kickoff
  let phaseUntil = 0;
  let timeLeft = settings.matchTime * 60000;
  let overtime = false;
  let overtimeStart = 0;
  let lastTouch = null;
  let ballHits = 0;
  let gravPhase = null;
  let endAt = null;
  const outOrder = [];
  let acc = 0;
  let lastT = null;

  const game = {
    id,
    mode,
    loaded: new Set(),
    startAt: null,
    results: null,
    humanIds: () => roster.filter((r) => !r.isBot).map((r) => r.id),
    info: () => ({
      id, mode, arena: A.name, grid: roster.map((r) => ({ id: r.id, name: r.name, vehicle: r.vehicle, color: r.color, horn: r.horn, isBot: r.isBot, team: r.team || null, spawn: r.spawn })),
      matchTime: settings.matchTime, balloons: settings.balloons, powers: mode === 'battle' && settings.powers, items: true,
    }),
    handlers: {},
    tick,
    snapshot,
    kart: humanState,
    disconnect(pid) { if (cars.has(pid)) cars.get(pid).gone = true; },
    forceEnd: end,
  };

  const alive = () => [...cars.values()].filter((c) => !c.gone);
  const gameTime = (t) => (game.startAt != null ? (t - game.startAt) / 1000 : -1);

  // Voiture vue comme obstacle (pour les chocs).
  function obstacle(c) {
    return { id: c.id, p: c.p, q: c.q, v: c.v, mass: 0.75 + c.weight * 0.1, ghost: !!(c.f & CF.GHOST) || c.out, giant: !!(c.f & CF.GIANT), star: !!(c.f & CF.STAR), small: !!(c.f & CF.SMALL) };
  }

  // ------------------------------------------------------------ foot

  function placeKickoff() {
    ball.reset();
    lastTouch = null;
    const poses = {};
    const idx = { blue: 0, orange: 0 };
    const counts = { blue: roster.filter((r) => r.team === 'blue').length, orange: roster.filter((r) => r.team === 'orange').length };
    for (const c of alive()) {
      const spot = kickoffSpots(c.team, counts[c.team])[idx[c.team]++];
      poses[c.id] = spot;
      c.p = [...spot.p];
      c.q = qYaw(spot.yaw);
      c.v = [0, 0, 0];
      if (c.car) { c.car.place(spot.p[0], spot.p[1], spot.p[2], spot.yaw); c.car.boost = 33; }
    }
    return poses;
  }

  function goal(side) {
    const team = side > 0 ? 'blue' : 'orange'; // but côté +Z : marqué par les bleus
    score[team === 'blue' ? 0 : 1]++;
    let scorer = null;
    if (lastTouch && cars.has(lastTouch)) {
      const c = cars.get(lastTouch);
      if (c.team === team) { c.goals++; c.score += 100; scorer = c.id; }
    }
    ctx.event({ type: 'goal', team, scorer, score: [...score], x: ball.p[0], y: ball.p[1], z: ball.p[2] });
    phase = 'goal';
    phaseUntil = now() + GOAL_PAUSE;
    if (overtime) endAt = now() + GOAL_PAUSE;
  }

  // ------------------------------------------------------------ bataille

  // Un ballon crevé. Les protections (étoile, fantôme, bouclier) sont vérifiées ici : sur la
  // voiture pour les bots, sur les drapeaux envoyés par le pilote pour les humains.
  function popBalloon(c, by) {
    const t = now();
    if (c.out || t < c.invulnUntil) return false;
    if (c.car) {
      if (!c.car.spinOut()) return false;
    } else {
      if (c.f & (CF.STAR | CF.GHOST)) return false;
      if (c.f & CF.SHIELD) {
        c.invulnUntil = t + 600;
        ctx.event({ type: 'shieldHit', target: c.id });
        return false;
      }
    }
    c.balloons--;
    c.invulnUntil = t + 2000;
    if (by && by !== c.id && cars.has(by)) { cars.get(by).pops++; cars.get(by).score++; }
    ctx.event({ type: 'pop', target: c.id, by: by || null, left: c.balloons });
    if (c.balloons <= 0) {
      c.out = true;
      outOrder.push(c.id);
      ctx.event({ type: 'out', id: c.id });
    }
    return true;
  }

  function useItem(c, item, from, back) {
    if (!c.item || c.item !== item) return false;
    if (--c.count <= 0) { c.item = null; c.count = 0; }
    switch (item) {
      case 'banana': entities.spawn('banana', c.id, from, { back: back !== false }); break;
      case 'green': entities.spawn('green', c.id, from, { back }); break;
      case 'red': {
        let target = null;
        let bd = Infinity;
        for (const o of alive()) {
          if (o.id === c.id || o.out) continue;
          const d = len(sub(o.p, c.p));
          if (d < bd) { bd = d; target = o.id; }
        }
        entities.spawn(target && !back ? 'red' : 'green', c.id, from, { back, target });
        break;
      }
      case 'bomb': entities.spawn('bomb', c.id, from, { back }); break;
      default:
        if (c.car) {
          if (item === 'mushroom') c.car.effect('turbo', 1.3);
          if (item === 'star') c.car.effect('star', 7);
          if (item === 'shield') c.car.shield = 1;
        }
    }
    ctx.event({ type: 'use', id: c.id, item });
    return true;
  }

  function usePower(c, origin) {
    const id2 = c.power;
    const P = powerById(id2);
    if (!P || now() < c.powerReadyAt) return null;
    c.power = drawPower(c, 'battle', rand);
    c.powerReadyAt = now() + POWER_COOLDOWN * 1000;
    const o = origin || c.p;
    const others = alive().filter((x) => x.id !== c.id && !x.out);
    let targets = [];
    const extra = {};
    if (P.target === 'self') {
      if (c.car) applyPowerToCar(c.car, id2, 'self');
      const fwd = norm([Math.sin(yawOf(c.q)), 0, Math.cos(yawOf(c.q))]);
      if (id2 === 'pluie') for (let i = 0; i < 5; i++) entities.spawn('banana', c.id, { p: c.p, fwd, speed: 0 }, { back: true, offset: [fwd[2] * (i - 2) * 2, 0, -fwd[0] * (i - 2) * 2] });
      if (id2 === 'caisses') for (let i = -1; i <= 1; i++) entities.spawn('crate', c.id, { p: add(c.p, scale(fwd, -10)), fwd, speed: 0 }, { back: true, offset: [fwd[2] * i * 3.5, 0, -fwd[0] * i * 3.5] });
    } else if (P.target === 'near') {
      targets = others.filter((x) => len(sub(x.p, o)) < P.range).map((x) => x.id);
    } else if (P.target === 'ahead' && id2 === 'voleur') {
      const v = others.filter((x) => x.item).sort((a, b) => len(sub(a.p, o)) - len(sub(b.p, o)))[0];
      if (v) {
        targets = [v.id];
        extra.item = v.item;
        extra.count = v.count;
        c.item = v.item; c.count = v.count;
        v.item = null; v.count = 0;
        ctx.event({ type: 'stolen', target: v.id, by: c.id });
      }
    } else {
      targets = others.map((x) => x.id);
    }
    if (id2 !== 'voleur') {
      for (const tid of targets) {
        const t2 = cars.get(tid);
        if (!t2 || !t2.car) continue;
        const r = applyPowerToCar(t2.car, id2, 'target');
        if (r === 'push') {
          const d = norm(sub(t2.p, o));
          t2.car.v = add(t2.car.v, add(scale(d, 26), [0, 9, 0]));
        }
      }
    }
    ctx.event({ type: 'power', id: c.id, power: id2, targets, x: o[0], y: o[1], z: o[2] });
    return { ok: true, power: id2, next: c.power, readyIn: POWER_COOLDOWN * 1000, ...extra };
  }

  // ------------------------------------------------------------ tamponneuse

  function down(c, kind, by) {
    const t = now();
    if (t < c.respawnAt) return;
    const credit = by && cars.has(by) && by !== c.id ? by : c.lastHitBy && t - c.lastHitAt < 4500 ? c.lastHitBy : null;
    if (credit && cars.has(credit)) cars.get(credit).score += kind === 'fall' ? 2 : 1;
    else if (kind === 'fall') c.score = Math.max(0, c.score - 1);
    ctx.event({ type: 'down', id: c.id, kind, by: credit });
    c.respawnAt = t + 1500;
    c.lastHitBy = null;
  }

  // ------------------------------------------------------------ boucle

  function end() {
    if (game.results) return;
    let list = alive();
    if (mode === 'rocket') {
      const win = score[0] === score[1] ? null : score[0] > score[1] ? 'blue' : 'orange';
      list.sort((a, b) => ((b.team === win) - (a.team === win)) || b.score + b.touches * 2 - (a.score + a.touches * 2));
      ctx.event({ type: 'final', winner: win, score: [...score] });
      ctx.finish(list.map((c) => ({ id: c.id, name: c.name, vehicle: c.vehicle, isBot: c.isBot, team: c.team, score: c.score, goals: c.goals, win: c.team === win })));
    } else if (mode === 'battle') {
      const survivors = list.filter((c) => !c.out).sort((a, b) => b.balloons - a.balloons || b.pops - a.pops);
      const outs = outOrder.slice().reverse().map((id2) => cars.get(id2)).filter(Boolean);
      list = [...survivors, ...outs, ...list.filter((c) => c.out && !outOrder.includes(c.id))];
      ctx.finish(list.map((c) => ({ id: c.id, name: c.name, vehicle: c.vehicle, isBot: c.isBot, balloons: Math.max(0, c.balloons), pops: c.pops, score: c.pops })));
    } else {
      list.sort((a, b) => b.score - a.score);
      ctx.finish(list.map((c) => ({ id: c.id, name: c.name, vehicle: c.vehicle, isBot: c.isBot, score: c.score })));
    }
  }

  function tick(t, dt) {
    const gt = gameTime(t);
    if (lastT == null) lastT = t;
    lastT = t;
    if (game.results) return;
    const locked = gt < 0 || phase === 'kickoff' || phase === 'goal';

    if (gt >= 0 && mode === 'battle' && settings.powers) {
      for (const c of cars.values()) if (c.powerReadyAt === Infinity) c.powerReadyAt = game.startAt + 5000;
    }

    // Phases du foot.
    if (mode === 'rocket' && phase !== 'play' && t >= phaseUntil) {
      if (endAt != null) return end();
      if (phase === 'goal') {
        const poses = placeKickoff();
        phase = 'kickoff';
        phaseUntil = t + KICKOFF;
        ctx.event({ type: 'kickoff', poses, startIn: KICKOFF });
      } else if (phase === 'kickoff') {
        phase = 'play';
      }
    }

    // Gravité de la tamponneuse : annonce des changements.
    if (mode === 'bumper' && gt >= 0) {
      const gp = bumperGravity(gt).phase;
      if (gp !== gravPhase) {
        gravPhase = gp;
        if (gt > 1) ctx.event({ type: 'gravity', phase: gp, name: BUMPER_PHASES.find((p) => p.id === gp).name });
      }
    }

    acc += dt;
    const list = alive();
    while (acc >= SUB) {
      acc -= SUB;
      const wt = Math.max(0, gameTime(t) - acc);
      const obstacles = list.map(obstacle);
      for (const c of list) {
        if (!c.isBot || c.out) continue;
        const car = c.car;
        car.locked = locked;
        if (mode === 'bumper' && t < c.respawnAt) continue;
        const others = list.filter((o) => o !== c && !o.out);
        const team = c.team === 'blue' ? 1 : -1;
        let role = 'attack';
        if (mode === 'rocket') {
          // Le plus proche du ballon attaque ; les autres soutiennent ou gardent le but.
          const mates = list.filter((o) => o.team === c.team).sort((a, b) => len(sub(a.p, ball.p)) - len(sub(b.p, ball.p)));
          const rank = mates.indexOf(c);
          role = rank === 0 ? 'attack' : rank === mates.length - 1 && mates.length > 1 ? 'goal' : 'support';
        }
        const inp = c.brain.think(SUB, {
          ball, team, role, kickoff: phase === 'kickoff' || (mode === 'rocket' && gt < 1.5),
          others: others.map((o) => ({ id: o.id, p: o.p })),
          boxes: boxes.map((b) => ({ p: b.p, on: b.at === 0 })),
          item: c.item,
          useItem: (back) => useItem(c, c.item, { p: car.p, fwd: norm([car.fwd[0], 0, car.fwd[2]]), speed: car.speed }, back),
          powerReady: mode === 'battle' && settings.powers && gt > 0 && t >= c.powerReadyAt,
          usePower: () => usePower(c, null),
        });
        car.step(SUB, inp, wt);
        for (const o of obstacles) {
          if (o.id === c.id) continue;
          const f = collideCars(car, o, mode);
          if (f > 4) {
            c.lastHitBy = o.id;
            c.lastHitAt = t;
            if (mode === 'battle' && o.star) popBalloon(c, o.id);
          }
        }
        c.p = car.p; c.q = car.q; c.v = car.v; c.f = car.flags;
        if (mode === 'battle' && t < c.invulnUntil) c.f |= CF.BLINK;

        if (mode === 'rocket' && phase !== 'goal') {
          const hitF = hitBall(car, ball);
          if (hitF > 0) { lastTouch = c.id; c.touches++; ballHits++; }
          for (const pad of pads) {
            if (pad.at === 0 && len(sub(pad.p, [car.p[0], 0, car.p[2]])) < (pad.big ? 3 : 2.2) && car.p[1] < 3) {
              pad.at = t + (pad.big ? 10000 : 4000);
              car.boost = Math.min(100, car.boost + (pad.big ? 100 : 12));
            }
          }
        }
        if (mode === 'bumper') {
          if (car.p[1] < -14) {
            down(c, 'fall');
            const s = spawnPoints('bumper', 8)[Math.floor(rand() * 8)];
            car.place(s.p[0], s.p[1] + 2, s.p[2], s.yaw);
          } else if (car.downTime > 1.6) {
            down(c, 'flip');
            car.place(car.p[0] * 0.8, 2, car.p[2] * 0.8, yawOf(car.q));
          }
        }
        if (mode === 'battle') {
          for (const b of boxes) {
            if (b.at === 0 && len(sub(b.p, car.p)) < 2.6) {
              b.at = t + BOX_RESPAWN;
              if (!c.item) { c.item = rollArenaItem(rand); c.count = ITEMS[c.item].count || 1; }
            }
          }
          const e = entities.touching(car.p, c.id);
          if (e && car.fx.ghost <= 0) {
            entities.remove(e.id);
            popBalloon(c, e.owner);
          }
        }
      }
      if (ball && phase !== 'goal' && !locked) {
        const b = ball.step(SUB, wt);
        if (b > 6) ballHits++;
        const side = goalScored(ball);
        if (side) goal(side);
      }
      if (entities) entities.update(SUB, list.filter((c) => !c.out).map((c) => ({ id: c.id, p: c.p })), wt);
    }

    // Explosions.
    if (entities) {
      for (const ev of entities.events) {
        if (ev.type !== 'boom') continue;
        ctx.event({ type: 'boom', x: ev.x, y: ev.y, z: ev.z });
        for (const c of list) if (!c.out && len(sub(c.p, [ev.x, ev.y, ev.z])) < ARENA_BOMB_RADIUS) popBalloon(c, ev.owner);
      }
      entities.events.length = 0;
    }
    for (const p of pads) if (p.at && t >= p.at) p.at = 0;
    for (const b of boxes) if (b.at && t >= b.at) b.at = 0;

    // Temps et fin.
    if (gt > 0 && (mode !== 'rocket' || phase === 'play')) {
      timeLeft = Math.max(0, timeLeft - dt * 1000);
      if (timeLeft <= 0 && endAt == null) {
        if (mode === 'rocket' && score[0] === score[1]) {
          if (!overtime) { overtime = true; overtimeStart = t; ctx.event({ type: 'overtime' }); }
          else if (t - overtimeStart > 120000) endAt = t; // match nul après 2 min de prolongation
        } else endAt = t + 1500;
      }
    }
    if (mode === 'battle' && endAt == null && gt > 2) {
      const left = list.filter((c) => !c.out);
      if (left.length <= 1 && list.length > 1) endAt = t + 2500;
    }
    if (list.every((c) => c.isBot)) end();
    if (endAt != null && t >= endAt && phase !== 'goal') end();
  }

  const r2 = (v) => Math.round(v * 100) / 100;
  const r4 = (v) => Math.round(v * 10000) / 10000;

  function snapshot(t) {
    const gt = gameTime(t);
    return {
      gt,
      tl: Math.round(timeLeft),
      ph: phase,
      ot: overtime ? 1 : 0,
      sc: score,
      k: alive().map((c) => [
        c.id, r2(c.p[0]), r2(c.p[1]), r2(c.p[2]), r4(c.q[0]), r4(c.q[1]), r4(c.q[2]), r4(c.q[3]),
        r2(c.v[0]), r2(c.v[1]), r2(c.v[2]), c.f | (c.out ? CF.OUT : 0) | (t < c.invulnUntil ? CF.BLINK : 0),
        mode === 'battle' ? c.balloons : c.car ? Math.round(c.car.boost) : 0, c.score,
        c.power || 0, c.power ? Math.max(0, Math.round((c.powerReadyAt - t) / 100) / 10) : 0,
      ]),
      b: ball ? [r2(ball.p[0]), r2(ball.p[1]), r2(ball.p[2]), r2(ball.v[0]), r2(ball.v[1]), r2(ball.v[2]), ballHits] : null,
      pads: pads.map((p) => (p.at ? 0 : 1)).join(''),
      bx: boxes.map((b) => (b.at ? 0 : 1)).join(''),
      e: entities ? entities.snapshot() : [],
    };
  }

  function humanState(pid, st) {
    const c = cars.get(pid);
    if (!c || c.isBot) return;
    const num = (a, n) => (Array.isArray(a) && a.length === n && a.every((x) => typeof x === 'number' && isFinite(x)) ? a : null);
    c.p = num(st.p, 3) || c.p;
    c.q = num(st.q, 4) || c.q;
    c.v = num(st.v, 3) || c.v;
    c.f = st.f | 0;
  }

  // ------------------------------------------------------------ requêtes propres aux arènes

  Object.assign(game.handlers, {
    // Foot : le joueur a frappé le ballon chez lui ; on reprend son résultat s'il est plausible.
    touch(pid, p) {
      if (!ball || phase !== 'play') return { ok: false };
      const c = cars.get(pid);
      const bp = p?.p;
      const bv = p?.v;
      if (!c || !Array.isArray(bp) || !Array.isArray(bv)) return { ok: false };
      if (len(sub(bp, ball.p)) > 12) return { ok: false };
      ball.p = bp.map(Number);
      ball.v = bv.map(Number);
      lastTouch = pid;
      c.touches++;
      ballHits++;
      return { ok: true };
    },

    pad(pid, p) {
      const pad = pads[p?.i | 0];
      const c = cars.get(pid);
      if (!pad || !c || pad.at !== 0 || len(sub(pad.p, [c.p[0], 0, c.p[2]])) > 7) return { amount: 0 };
      pad.at = now() + (pad.big ? 10000 : 4000);
      return { amount: pad.big ? 100 : 12 };
    },

    // Tamponneuse : le joueur s'est retourné ou est tombé (by : dernier qui l'a percuté).
    down(pid, p) {
      const c = cars.get(pid);
      if (!c || mode !== 'bumper') return { ok: false };
      down(c, p?.kind === 'fall' ? 'fall' : 'flip', p?.by);
      return { ok: true };
    },

    box(pid, p) {
      const b = boxes[p?.i | 0];
      const c = cars.get(pid);
      if (!b || !c || c.out || b.at !== 0) return { item: null };
      b.at = now() + BOX_RESPAWN;
      if (c.item) return { item: null };
      c.item = rollArenaItem(rand);
      c.count = ITEMS[c.item].count || 1;
      return { item: c.item };
    },

    use(pid, p) {
      const c = cars.get(pid);
      const f = p?.from;
      if (!c || !f || !entities) return { ok: false };
      return { ok: useItem(c, p.item, { p: (f.p || c.p).map(Number), fwd: (f.fwd || [0, 0, 1]).map(Number), speed: +f.speed || 0 }, p.back) };
    },

    hit(pid, p) {
      const c = cars.get(pid);
      const e = entities && entities.list.get(p?.e);
      if (!c || !e) return { ok: false };
      entities.remove(e.id);
      popBalloon(c, e.owner);
      return { ok: true };
    },

    bump(pid, p) {
      const me = cars.get(pid);
      const o = cars.get(p?.target);
      if (!me || !o || mode !== 'battle' || !(me.f & (CF.STAR | CF.GIANT)) || len(sub(me.p, o.p)) > 8) return { ok: false };
      popBalloon(o, me.id);
      return { ok: true };
    },

    power(pid, p) {
      const c = cars.get(pid);
      if (!c || mode !== 'battle' || !settings.powers || c.out) return { ok: false };
      return usePower(c, Array.isArray(p?.p) ? p.p.map(Number) : null) || { ok: false };
    },
  });

  return game;
}
