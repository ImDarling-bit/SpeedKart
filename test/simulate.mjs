// Vérifie les circuits et les modes de jeu sans navigateur :
// 1. aucun tracé ne se chevauche (sauf aux ponts) ; loopings bien placés (élan avant, rien dedans) ;
// 2. 8 bots bouclent 3 tours sur chaque circuit (circuits pilotables, loopings franchis) ;
// 3. une course complète avec pouvoirs et option chaos ;
// 4. les modes en arène (tamponneuse, foot, bataille) joués jusqu'au bout par des bots.
// Usage : node test/simulate.mjs [idCircuit | race | arena]

import { TrackPath } from '../public/js/track.js';
import { TRACKS } from '../public/js/data/tracks.js';
import { VEHICLES, vehicleParams } from '../public/js/data/vehicles.js';
import { Kart } from '../public/js/kart.js';
import { BotBrain } from '../public/js/ai.js';
import { createRoom } from '../public/js/room.js';
import { makeWorld } from '../public/js/arena.js';
import { Car3D } from '../public/js/car3d.js';
import { makeRng, formatTime } from '../public/js/util.js';

const only = process.argv[2];
let failures = 0;
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };

function checkGeometry(T) {
  const n = T.n;
  const conflicts = [];
  for (let i = 0; i < n; i += 2) {
    if (T.lp[i] >= 0) continue;
    for (let j = i + 1; j < n; j += 2) {
      if (T.lp[j] >= 0) continue;
      const along = Math.min(j - i, n - (j - i)) * T.ds;
      if (along < 80) continue;
      const dx = T.px[i] - T.px[j];
      const dz = T.pz[i] - T.pz[j];
      const need = T.hw[i] + T.hw[j] + T.margin * 2 + 2;
      const d = Math.hypot(dx, dz);
      if (d < need && Math.abs(T.py[i] - T.py[j]) < 6.5) conflicts.push({ i, j, d: d.toFixed(1), need: need.toFixed(1) });
    }
  }
  return conflicts;
}

function checkLoops(T) {
  for (const L of T.loops) {
    const inside = (s) => T.deltaS(L.s0 - 2, s) >= 0 && T.deltaS(L.s0 - 2, s) <= L.s1 - L.s0 + 4;
    for (const r of T.ramps) if (inside(r.s0) || inside(r.s1)) fail(`tremplin dans le looping ${L.id}`);
    for (const b of T.boosts) if (inside(b.s0)) fail(`tapis dans le looping ${L.id}`);
    for (const s of T.itemRows) if (inside(s)) fail(`boîtes dans le looping ${L.id}`);
    const pad = T.boosts.some((b) => { const d = T.deltaS(b.s0, L.s0); return d > 0 && d < 90; });
    if (!pad) fail(`pas de tapis de vitesse avant le looping ${L.id}`);
  }
}

let fallAt = [];

function simulateBots(def, laps = 3) {
  const T = new TrackPath(def);
  const bots = [];
  fallAt = [];
  let loopFails = 0;
  let loopsDone = 0;
  for (let i = 0; i < 8; i++) {
    const v = VEHICLES[(i * 3) % VEHICLES.length];
    const k = new Kart(T, vehicleParams(v.stats, 1));
    k.place(T.gridSlot(i));
    k.locked = false;
    let falls = 0;
    let walls = 0;
    k.onEvent = (t) => {
      if (t === 'fall') { falls++; fallAt.push(Math.round((k.s / T.length) * 100)); }
      if (t === 'wall') walls++;
      if (t === 'loopFail') loopFails++;
      if (t === 'loop') loopsDone++;
    };
    bots.push({ k, brain: new BotBrain(k, makeRng(i + 1), 0.8), v, stats: () => ({ falls, walls }), time: null });
  }
  const dt = 1 / 60;
  let t = 0;
  while (t < 600 && bots.some((b) => b.time == null)) {
    for (const b of bots) {
      const inp = b.brain.think(dt, { item: null });
      b.k.step(dt, inp);
      b.k.collide(bots.filter((o) => o !== b).map((o) => ({ x: o.k.x, y: o.k.y, z: o.k.z, weight: o.k.p.weight })));
      if (b.time == null && b.k.prog >= laps * T.length) b.time = t;
      if (!isFinite(b.k.x) || !isFinite(b.k.prog)) { fail(`NaN pour ${b.v.name}`); b.time = -1; }
    }
    t += dt;
  }
  return { T, bots, loopFails, loopsDone };
}

if (!only || TRACKS.some((t) => t.id === only)) {
  for (const def of TRACKS) {
    if (only && def.id !== only) continue;
    const T = new TrackPath(def);
    console.log(`\n${def.name} (${def.id}) : ${Math.round(T.length)} m, ${T.boxes.length} boîtes, ${T.loops.length} looping(s)`);
    const c = checkGeometry(T);
    if (c.length) fail(`chevauchements : ${c.slice(0, 4).map((x) => `${x.i}/${x.j} (${x.d} < ${x.need})`).join(', ')}${c.length > 4 ? ` +${c.length - 4}` : ''}`);
    checkLoops(T);

    const { bots, loopFails, loopsDone } = simulateBots(def);
    const done = bots.filter((b) => b.time != null && b.time >= 0);
    const times = done.map((b) => b.time).sort((a, b) => a - b);
    const falls = bots.reduce((s, b) => s + b.stats().falls, 0);
    const walls = bots.reduce((s, b) => s + b.stats().walls, 0);
    console.log(`  bots arrivés : ${done.length}/8, meilleur ${formatTime(times[0] * 1000)}, dernier ${formatTime(times[times.length - 1] * 1000)}, chutes ${falls}, murs ${walls}${T.loops.length ? `, loopings ${loopsDone} (ratés ${loopFails})` : ''}`);
    if (falls) console.log(`  chutes à (% du tour) : ${fallAt.sort((a, b) => a - b).join(' ')}`);
    if (T.loops.length && loopsDone < T.loops.length * 8 * 3 * 0.9) fail(`loopings non franchis (${loopsDone})`);
    if (done.length < 8) {
      fail(`${8 - done.length} bot(s) bloqué(s)`);
      for (const b of bots.filter((x) => x.time == null)) console.log(`    ${b.v.name} bloqué à s=${b.k.s.toFixed(0)} prog=${b.k.prog.toFixed(0)}`);
    }
  }
}

// ------------------------------------------------------------ parties complètes (horloge simulée)

function fakeRoom() {
  let t = 0;
  let tickFn = null;
  const got = new Map();
  const events = [];
  const room = createRoom({
    code: 'TEST',
    now: () => t,
    rand: makeRng(1234),
    ticker: (fn) => { tickFn = fn; return () => { tickFn = null; }; },
    send: (pid, type, p) => { got.set(`${pid}:${type}`, p); if (type === 'ev' && pid === 'host') events.push(p); },
  });
  const run = (seconds, until) => {
    for (let i = 0; i < seconds * 60; i++) {
      t += 1000 / 60;
      if (tickFn) tickFn();
      if (until && until()) break;
    }
  };
  return { room, got, events, run, time: () => t };
}

function startGame(F, settings) {
  F.room.handle('host', 'join', { name: 'Hôte', vehicle: 'kart-oobi' });
  F.room.handle('host', 'settings', settings);
  const r = F.room.handle('host', 'start');
  if (!r.ok) fail(`départ refusé : ${r.error}`);
  const gid = F.got.get('host:state').game.id;
  F.room.handle('host', 'loaded', { game: gid });
}

if (!only || only === 'race') {
  console.log('\nCourse avec pouvoirs et chaos (Grand Huit, 1 tour) :');
  const F = fakeRoom();
  startGame(F, { mode: 'race', track: 'grandhuit', laps: 1, powers: true, chaos: true });
  F.run(5);
  const snap = F.got.get('host:snap');
  if (!snap || snap.k.length !== 8) fail(`instantané incorrect (${snap && snap.k.length} karts)`);
  // L'humain fait du surplace : la course finit 35 s après... il faut qu'il arrive. On le téléporte à l'arrivée.
  F.run(70);
  const L = F.room.game && new TrackPath(TRACKS.find((x) => x.id === 'grandhuit')).length;
  F.room.kart('host', { x: 0, y: 0, z: 0, yaw: 0, spd: 0, f: 0, prog: L + 1 });
  F.room.handle('host', 'finish', { time: 80000 });
  F.run(60, () => F.room.phase === 'results');
  const powers = F.events.filter((e) => e.type === 'power');
  console.log(`  ${powers.length} pouvoirs utilisés (${[...new Set(powers.map((p) => p.power))].length} différents), ${F.events.filter((e) => e.type === 'teleport').length} téléportations vers l'humain`);
  if (powers.length < 5) fail('trop peu de pouvoirs utilisés');
  const st = F.got.get('host:state');
  if (st.phase !== 'results') fail(`phase attendue results, reçu ${st.phase}`);
  else console.log(`  résultats : ${st.game.results.map((x) => `${x.rank}. ${x.name}`).join(', ')}`);
}

if (!only || only === 'arena') {
  // Physique : une voiture sur le terrain de foot accélère, saute et retombe.
  console.log('\nPhysique 3D :');
  {
    const W = makeWorld('rocket');
    const car = new Car3D(W, 'rocket');
    car.place(0, 1.2, -40, 0);
    for (let i = 0; i < 120 * 3; i++) car.step(1 / 120, { throttle: 1, steer: 0 }, i / 120);
    const v = car.speed;
    for (let i = 0; i < 60; i++) car.step(1 / 120, { throttle: 0, steer: 0, jump: i < 20 }, 3 + i / 120);
    const h = car.p[1];
    for (let i = 0; i < 240; i++) car.step(1 / 120, { throttle: 0 }, 4 + i / 120);
    console.log(`  vitesse après 3 s : ${v.toFixed(1)} m/s, hauteur du saut : ${h.toFixed(1)} m, au sol ensuite : ${car.grounded}`);
    if (v < 20 || h < 1.5 || !car.grounded) fail('physique du foot incohérente');
    // Montée sur le mur incurvé.
    car.place(0, 1.2, 0, Math.PI / 2);
    let maxY = 0;
    for (let i = 0; i < 120 * 5; i++) { car.step(1 / 120, { throttle: 1, boost: true }, i / 120); maxY = Math.max(maxY, car.p[1]); }
    console.log(`  hauteur atteinte en roulant sur le mur : ${maxY.toFixed(1)} m`);
    if (maxY < 8) fail('la voiture ne monte pas sur les murs');
  }

  for (const [mode, extra] of [['rocket', { teamSize: 2, matchTime: 1 }], ['bumper', { matchTime: 1 }], ['battle', { matchTime: 3, powers: true }]]) {
    console.log(`\nMode ${mode} (bots) :`);
    const F = fakeRoom();
    startGame(F, { mode, bots: true, ...extra });
    F.run(240, () => F.room.phase === 'results');
    const st = F.got.get('host:state');
    const evs = F.events;
    const count = (type) => evs.filter((e) => e.type === type).length;
    const snap = F.got.get('host:snap');
    const bad = snap && snap.k.some((k) => k.slice(1, 11).some((x) => !isFinite(x)));
    if (bad) fail('positions invalides (NaN)');
    if (mode === 'rocket') {
      console.log(`  buts : ${count('goal')}, score final ${JSON.stringify(evs.find((e) => e.type === 'final')?.score)}, prolongation : ${count('overtime') > 0}`);
      if (!snap?.b || snap.b[6] < 5) fail('le ballon n’est presque jamais touché');
    }
    if (mode === 'bumper') {
      console.log(`  éjections/retournements : ${count('down')}, phases de gravité annoncées : ${count('gravity')}`);
      if (count('down') < 1) fail('personne ne tombe dans l’arène tamponneuse');
    }
    if (mode === 'battle') {
      console.log(`  ballons crevés : ${count('pop')}, éliminés : ${count('out')}, pouvoirs : ${count('power')}, objets : ${count('use')}`);
      if (count('pop') < 3) fail('trop peu de ballons crevés');
    }
    if (st.phase !== 'results') fail(`partie non terminée (phase ${st.phase})`);
    else console.log(`  classement : ${st.game.results.map((x) => `${x.rank}. ${x.name} (${x.score ?? ''})`).join(', ')}`);
    F.room.destroy();
  }
}

console.log(failures ? `\n${failures} problème(s).` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
