// Vérifie les circuits et le moteur sans navigateur :
// 1. aucun tracé ne se chevauche (sauf aux ponts, avec assez de hauteur) ;
// 2. 8 bots bouclent 3 tours sur chaque circuit (circuits pilotables, IA correcte) ;
// 3. une partie complète passe par le salon, le départ et les résultats.
// Usage : node test/simulate.mjs [idCircuit]

import { TrackPath } from '../public/js/track.js';
import { TRACKS } from '../public/js/data/tracks.js';
import { VEHICLES, vehicleParams } from '../public/js/data/vehicles.js';
import { Kart } from '../public/js/kart.js';
import { BotBrain } from '../public/js/ai.js';
import { createRoom } from '../public/js/room.js';
import { makeRng, formatTime } from '../public/js/util.js';

const only = process.argv[2];
let failures = 0;
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };

function checkGeometry(T) {
  const n = T.n;
  const conflicts = [];
  for (let i = 0; i < n; i += 2) {
    for (let j = i + 1; j < n; j += 2) {
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

let fallAt = [];

function simulateBots(def, laps = 3) {
  const T = new TrackPath(def);
  const bots = [];
  fallAt = [];
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
    }
    t += dt;
  }
  return { T, bots };
}

for (const def of TRACKS) {
  if (only && def.id !== only) continue;
  const T = new TrackPath(def);
  console.log(`\n${def.name} (${def.id}) : ${Math.round(T.length)} m, ${T.boxes.length} boîtes`);
  const c = checkGeometry(T);
  if (c.length) fail(`chevauchements : ${c.slice(0, 4).map((x) => `${x.i}/${x.j} (${x.d} < ${x.need})`).join(', ')}${c.length > 4 ? ` +${c.length - 4}` : ''}`);

  const { bots } = simulateBots(def);
  const done = bots.filter((b) => b.time != null);
  const times = done.map((b) => b.time).sort((a, b) => a - b);
  const falls = bots.reduce((s, b) => s + b.stats().falls, 0);
  const walls = bots.reduce((s, b) => s + b.stats().walls, 0);
  console.log(`  bots arrivés : ${done.length}/8, meilleur ${formatTime(times[0] * 1000)}, dernier ${formatTime(times[times.length - 1] * 1000)}, chutes ${falls}, murs ${walls}`);
  if (falls) console.log(`  chutes à (% du tour) : ${fallAt.sort((a, b) => a - b).join(' ')}`);
  if (done.length < 8) {
    fail(`${8 - done.length} bot(s) bloqué(s)`);
    for (const b of bots.filter((x) => x.time == null)) console.log(`    ${b.v.name} bloqué à s=${b.k.s.toFixed(0)} prog=${b.k.prog.toFixed(0)}`);
  }
}

// Partie complète via le moteur de l'hôte.
if (!only) {
  console.log('\nPartie via le moteur :');
  const got = new Map();
  const room = createRoom({ code: 'TEST', send: (pid, type, p) => got.set(`${pid}:${type}`, p) });
  room.handle('host', 'join', { name: 'Hôte', vehicle: 'kart-oobi' });
  room.handle('p2', 'join', { name: 'Ami', vehicle: 'taxi' });
  room.handle('host', 'settings', { track: 'prairie', laps: 1 });
  const r = room.handle('host', 'start');
  if (!r.ok) fail('départ refusé');
  const raceId = got.get('host:state').race.id;
  room.handle('host', 'loaded', { race: raceId });
  room.handle('p2', 'loaded', { race: raceId });
  await new Promise((res) => setTimeout(res, 3600));
  const snap = got.get('p2:snap');
  if (!snap || snap.k.length !== 8) fail(`instantané incorrect (${snap && snap.k.length} karts)`);
  else console.log(`  ${snap.k.length} karts dans l'instantané, temps de course ${Math.round(snap.rt)} ms`);
  // Les deux humains « arrivent ».
  const L = room.race.track.length;
  room.kart('host', { x: 0, y: 0, z: 0, yaw: 0, spd: 0, f: 0, prog: L + 1 });
  room.kart('p2', { x: 0, y: 0, z: 0, yaw: 0, spd: 0, f: 0, prog: L + 1 });
  room.handle('host', 'finish', { time: 30000 });
  room.handle('p2', 'finish', { time: 31000 });
  await new Promise((res) => setTimeout(res, 4000));
  const st = got.get('host:state');
  if (st.phase !== 'results') fail(`phase attendue results, reçu ${st.phase}`);
  else console.log(`  résultats : ${st.race.results.map((x) => `${x.rank}. ${x.name} (${x.points} pts)`).join(', ')}`);
  room.destroy();
}

console.log(failures ? `\n${failures} problème(s).` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
