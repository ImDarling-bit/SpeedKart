// Sons synthétisés (Web Audio) : aucun fichier audio à fournir.

let ctx = null;
let master = null;
let volume = 0.6;
let engineVolume = 0.7;
let engine = null;

try {
  volume = Math.max(0, Math.min(1, Number(localStorage.getItem('sk-volume') ?? 0.6)));
  engineVolume = Math.max(0, Math.min(1, Number(localStorage.getItem('sk-engine') ?? 0.7)));
} catch (_) { /* stockage indisponible */ }

// À appeler depuis un geste de l'utilisateur (clic) : les navigateurs bloquent le son avant.
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    // Compresseur doux : évite que les explosions et klaxons saturent.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
  try { localStorage.setItem('sk-volume', String(v)); } catch (_) { /* ignore */ }
}
export const getVolume = () => volume;

export function setEngineVolume(v) {
  engineVolume = v;
  try { localStorage.setItem('sk-engine', String(v)); } catch (_) { /* ignore */ }
}
export const getEngineVolume = () => engineVolume;

function tone({ type = 'square', f0 = 440, f1 = f0, dur = 0.15, gain = 0.2, delay = 0, attack = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  if (attack) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
  } else g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noiseBuffer(dur, brown = false) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}

function noise({ dur = 0.3, gain = 0.3, f = 1200, q = 1, type = 'bandpass', delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = f;
  filt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t);
}

// Klaxons : à deux tons, comme les vrais. dist : distance au joueur (atténuation).
const HORNS = {
  classique: (g) => { tone({ type: 'sawtooth', f0: 415, dur: 0.45, gain: g, attack: 0.02 }); tone({ type: 'sawtooth', f0: 523, dur: 0.45, gain: g * 0.8, attack: 0.02 }); },
  camion: (g) => { tone({ type: 'sawtooth', f0: 185, dur: 0.8, gain: g, attack: 0.05 }); tone({ type: 'sawtooth', f0: 233, dur: 0.8, gain: g * 0.9, attack: 0.05 }); tone({ type: 'sawtooth', f0: 277, dur: 0.8, gain: g * 0.7, attack: 0.05 }); },
  canard: (g) => { [0, 0.18].forEach((d) => tone({ type: 'square', f0: 620, f1: 380, dur: 0.14, gain: g * 0.7, delay: d })); },
  fanfare: (g) => { [392, 523, 659, 784].forEach((f, i) => tone({ type: 'square', f0: f, dur: i === 3 ? 0.35 : 0.12, gain: g * 0.6, delay: i * 0.11 })); },
  sirene: (g) => { tone({ type: 'sawtooth', f0: 600, f1: 1100, dur: 0.4, gain: g * 0.7 }); tone({ type: 'sawtooth', f0: 1100, f1: 600, dur: 0.4, gain: g * 0.7, delay: 0.4 }); },
};
export const HORN_NAMES = { classique: 'Classique', camion: 'Camion', canard: 'Canard', fanfare: 'Fanfare', sirene: 'Sirène' };

export function horn(kind, dist = 0) {
  if (!ctx) return;
  const g = 0.16 * Math.max(0.08, 1 - dist / 120);
  (HORNS[kind] || HORNS.classique)(g);
}

export const sfx = {
  count: () => tone({ type: 'square', f0: 520, dur: 0.25, gain: 0.15 }),
  go: () => tone({ type: 'square', f0: 1040, dur: 0.6, gain: 0.18 }),
  box: () => { tone({ type: 'triangle', f0: 700, f1: 1400, dur: 0.12, gain: 0.2 }); noise({ dur: 0.15, gain: 0.15, f: 3000 }); },
  roll: () => tone({ type: 'square', f0: 1200 + Math.random() * 400, dur: 0.04, gain: 0.05 }),
  got: () => { tone({ type: 'triangle', f0: 880, dur: 0.1, gain: 0.18 }); tone({ type: 'triangle', f0: 1320, dur: 0.18, gain: 0.18, delay: 0.08 }); },
  boost: () => { noise({ dur: 0.6, gain: 0.3, f: 900, q: 0.7, type: 'lowpass' }); tone({ type: 'sawtooth', f0: 200, f1: 600, dur: 0.4, gain: 0.06 }); },
  mini: (lv) => tone({ type: 'triangle', f0: 500 + lv * 200, f1: 1200 + lv * 200, dur: 0.25, gain: 0.15 }),
  hop: () => tone({ type: 'sine', f0: 300, f1: 500, dur: 0.08, gain: 0.1 }),
  land: () => noise({ dur: 0.12, gain: 0.2, f: 300, type: 'lowpass' }),
  jump: () => tone({ type: 'triangle', f0: 300, f1: 900, dur: 0.3, gain: 0.15 }),
  trick: () => { tone({ type: 'triangle', f0: 900, f1: 1500, dur: 0.12, gain: 0.15 }); tone({ type: 'triangle', f0: 1500, dur: 0.12, gain: 0.12, delay: 0.1 }); },
  wall: (v) => noise({ dur: 0.18, gain: Math.min(0.4, 0.08 + v * 0.02), f: 250, type: 'lowpass' }),
  bump: () => noise({ dur: 0.1, gain: 0.25, f: 500, q: 2 }),
  crash: (v = 10) => { noise({ dur: 0.35, gain: Math.min(0.5, 0.12 + v * 0.015), f: 400, type: 'lowpass' }); noise({ dur: 0.2, gain: 0.15, f: 2500, q: 1.5 }); },
  hit: () => { tone({ type: 'sawtooth', f0: 600, f1: 90, dur: 0.6, gain: 0.15 }); noise({ dur: 0.3, gain: 0.25, f: 1500 }); },
  shield: () => tone({ type: 'sine', f0: 1500, f1: 400, dur: 0.3, gain: 0.15 }),
  throw: () => noise({ dur: 0.2, gain: 0.2, f: 2000, q: 3 }),
  boom: (dist = 0) => { const g = Math.max(0.05, 0.6 - dist / 150); noise({ dur: 0.9, gain: g, f: 180, type: 'lowpass' }); tone({ type: 'sine', f0: 120, f1: 30, dur: 0.7, gain: g * 0.6 }); },
  zap: () => { noise({ dur: 0.5, gain: 0.4, f: 4000, q: 0.5, type: 'highpass' }); tone({ type: 'sawtooth', f0: 1800, f1: 100, dur: 0.5, gain: 0.12 }); },
  star: () => [0, 1, 2, 3].forEach((i) => tone({ type: 'square', f0: 660 * 2 ** (i / 4), dur: 0.1, gain: 0.08, delay: i * 0.08 })),
  fall: () => tone({ type: 'sine', f0: 900, f1: 120, dur: 1.0, gain: 0.15 }),
  lap: () => [0, 0.12, 0.24].forEach((d, i) => tone({ type: 'triangle', f0: [660, 880, 1100][i], dur: 0.14, gain: 0.18, delay: d })),
  final: () => [0, 0.15, 0.3, 0.45].forEach((d, i) => tone({ type: 'square', f0: [523, 659, 784, 1046][i], dur: 0.18, gain: 0.12, delay: d })),
  finish: () => [0, 0.15, 0.3, 0.5, 0.65].forEach((d, i) => tone({ type: 'square', f0: [523, 659, 784, 1046, 1318][i], dur: i === 4 ? 0.6 : 0.18, gain: 0.13, delay: d })),
  click: () => tone({ type: 'triangle', f0: 800, dur: 0.05, gain: 0.08 }),
  loop: () => { tone({ type: 'sine', f0: 300, f1: 1200, dur: 0.9, gain: 0.08 }); noise({ dur: 0.9, gain: 0.12, f: 1200, q: 0.6 }); },
  power: () => { tone({ type: 'triangle', f0: 400, f1: 1600, dur: 0.35, gain: 0.14 }); tone({ type: 'sine', f0: 800, f1: 2400, dur: 0.35, gain: 0.08, delay: 0.05 }); },
  powerReady: () => [0, 0.08].forEach((d, i) => tone({ type: 'sine', f0: [1200, 1600][i], dur: 0.12, gain: 0.08, delay: d })),
  swoosh: () => noise({ dur: 0.5, gain: 0.25, f: 1800, q: 0.8 }),
  freeze: () => { noise({ dur: 0.6, gain: 0.25, f: 6000, type: 'highpass' }); tone({ type: 'sine', f0: 2200, f1: 1600, dur: 0.4, gain: 0.06 }); },
  ball: (v = 10) => { tone({ type: 'sine', f0: 180, f1: 90, dur: 0.12, gain: Math.min(0.35, 0.06 + v * 0.006) }); noise({ dur: 0.08, gain: Math.min(0.3, 0.05 + v * 0.005), f: 900, q: 1 }); },
  goal: () => {
    noise({ dur: 2.2, gain: 0.25, f: 700, q: 0.4 });
    tone({ type: 'sawtooth', f0: 220, dur: 1.6, gain: 0.1, attack: 0.05 });
    tone({ type: 'sawtooth', f0: 277, dur: 1.6, gain: 0.08, attack: 0.05 });
    tone({ type: 'sawtooth', f0: 330, dur: 1.6, gain: 0.07, attack: 0.05 });
  },
  whistle: () => { tone({ type: 'sine', f0: 2600, dur: 0.25, gain: 0.12 }); tone({ type: 'sine', f0: 2600, dur: 0.6, gain: 0.12, delay: 0.32 }); },
  pop: () => { noise({ dur: 0.12, gain: 0.35, f: 2500, q: 0.8 }); tone({ type: 'sine', f0: 900, f1: 200, dur: 0.15, gain: 0.12 }); },
  emote: () => tone({ type: 'sine', f0: 900, f1: 1300, dur: 0.12, gain: 0.08 }),
  pad: () => tone({ type: 'triangle', f0: 600, f1: 1200, dur: 0.15, gain: 0.08 }),
  flip: () => tone({ type: 'triangle', f0: 250, f1: 700, dur: 0.25, gain: 0.1 }),
};

// ------------------------------------------------------------ moteur

// Profils de moteur : nombre de cylindres (fréquence d'allumage), régimes, rapports de boîte,
// et timbre (harmoniques, filtre). Un kart bourdonne, un camion gronde.
const PROFILES = {
  kart: { cyl: 2, idle: 1700, red: 8600, gears: [0.24, 0.45, 0.67, 0.88, 1.5], harm: [1, 0.75, 0.5, 0.36, 0.24, 0.16, 0.1, 0.06], cutoff: [500, 2600], noise: 0.5, sub: 0.15, gain: 0.85 },
  sport: { cyl: 6, idle: 950, red: 7600, gears: [0.17, 0.33, 0.5, 0.67, 0.84, 1.5], harm: [1, 0.6, 0.45, 0.3, 0.22, 0.14, 0.1, 0.07, 0.05], cutoff: [350, 2200], noise: 0.35, sub: 0.35, gain: 1 },
  car: { cyl: 4, idle: 800, red: 6400, gears: [0.16, 0.32, 0.5, 0.7, 0.9, 1.5], harm: [1, 0.55, 0.32, 0.22, 0.12, 0.08, 0.05], cutoff: [260, 1500], noise: 0.3, sub: 0.45, gain: 1 },
  heavy: { cyl: 6, idle: 560, red: 2700, gears: [0.1, 0.2, 0.32, 0.45, 0.6, 0.76, 0.92, 1.5], harm: [1, 0.7, 0.55, 0.4, 0.3, 0.2, 0.12], cutoff: [180, 900], noise: 0.25, sub: 0.7, gain: 1.1 },
};

export function engineProfileFor(vehicle) {
  if (!vehicle) return 'car';
  if (vehicle.cat === 'Kart') return 'kart';
  if (vehicle.cat === 'Course' || vehicle.cat === 'Sport') return 'sport';
  if (vehicle.cat === 'Lourd' || vehicle.id === 'firetruck' || vehicle.id === 'garbage-truck') return 'heavy';
  return 'car';
}

function softClip(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

export function engineStart(profileName = 'car') {
  if (!ctx || engine) return;
  const P = PROFILES[profileName] || PROFILES.car;
  const real = new Float32Array(P.harm.length + 1);
  const imag = new Float32Array(P.harm.length + 1);
  P.harm.forEach((a, i) => { imag[i + 1] = a; });
  const wave = ctx.createPeriodicWave(real, imag);

  const osc = ctx.createOscillator();
  osc.setPeriodicWave(wave);
  const osc2 = ctx.createOscillator(); // légèrement désaccordé : battement « vivant »
  osc2.setPeriodicWave(wave);
  osc2.detune.value = 7;
  const sub = ctx.createOscillator();
  sub.type = 'sine';

  // Irrégularités d'allumage : légère modulation lente de la hauteur.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 9;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 12; // cents
  lfo.connect(lfoGain);
  lfoGain.connect(osc.detune);
  lfoGain.connect(osc2.detune);

  const mix = ctx.createGain();
  const g2 = ctx.createGain();
  g2.gain.value = 0.45;
  const subGain = ctx.createGain();
  subGain.gain.value = P.sub;
  osc.connect(mix);
  osc2.connect(g2).connect(mix);
  sub.connect(subGain).connect(mix);

  const shaper = ctx.createWaveShaper();
  shaper.curve = softClip(1.6);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.8;
  const out = ctx.createGain();
  out.gain.value = 0;
  mix.connect(shaper).connect(lp).connect(out).connect(master);

  // Souffle d'admission (bruit filtré), proportionnel à la charge.
  const nsrc = ctx.createBufferSource();
  nsrc.buffer = noiseBuffer(2, true);
  nsrc.loop = true;
  const nbp = ctx.createBiquadFilter();
  nbp.type = 'bandpass';
  nbp.Q.value = 1.2;
  const ngain = ctx.createGain();
  ngain.gain.value = 0;
  nsrc.connect(nbp).connect(ngain).connect(master);

  [osc, osc2, sub, lfo, nsrc].forEach((n) => n.start());
  engine = { P, osc, osc2, sub, lp, out, nbp, ngain, nodes: [osc, osc2, sub, lfo, nsrc], rpm: P.idle, gear: 0, shiftCut: 0, last: ctx.currentTime };
}

// speedRatio : vitesse / vitesse max ; throttle : accélérateur enfoncé ; air : roues en l'air.
export function engineUpdate(speedRatio, boost, on = true, throttle = true, air = false) {
  if (!engine) return;
  const e = engine;
  const P = e.P;
  const t = ctx.currentTime;
  const dt = Math.min(0.1, t - e.last);
  e.last = t;
  const s = Math.min(1.45, Math.abs(speedRatio));

  // Boîte automatique avec un peu d'hystérésis ; coupure d'accélérateur au passage du rapport.
  const G = P.gears;
  if (e.gear < G.length - 1 && s > G[e.gear]) { e.gear++; e.shiftCut = 0.14; }
  else if (e.gear > 0 && s < G[e.gear - 1] * 0.82) e.gear--;
  if (e.shiftCut > 0) e.shiftCut -= dt;

  const lo = e.gear > 0 ? G[e.gear - 1] * 0.55 : 0;
  const r = Math.max(0, Math.min(1, (s - lo) / (G[e.gear] - lo)));
  let target = P.idle + (P.red - P.idle) * (0.08 + 0.92 * r);
  if (air && throttle) target = P.red * 0.92; // ça s'emballe en l'air
  if (!on) target = P.idle;
  const rate = target > e.rpm ? (throttle ? 7 : 3) : 5;
  e.rpm += (target - e.rpm) * Math.min(1, dt * rate);

  const load = e.shiftCut > 0 ? 0.15 : (throttle ? 1 : 0.3) + (boost ? 0.3 : 0);
  const rn = (e.rpm - P.idle) / (P.red - P.idle);
  const fire = (e.rpm / 60) * (P.cyl / 2);
  e.osc.frequency.setTargetAtTime(fire, t, 0.03);
  e.osc2.frequency.setTargetAtTime(fire, t, 0.03);
  e.sub.frequency.setTargetAtTime(fire / 2, t, 0.03);
  const cut = P.cutoff[0] + (P.cutoff[1] - P.cutoff[0]) * rn * (0.45 + 0.55 * Math.min(1, load));
  e.lp.frequency.setTargetAtTime(cut, t, 0.05);
  const level = on ? engineVolume * 0.05 * P.gain * (0.45 + 0.35 * load + 0.25 * rn) : 0;
  e.out.gain.setTargetAtTime(level, t, 0.06);
  e.nbp.frequency.setTargetAtTime(fire * 4 + 300, t, 0.05);
  e.ngain.gain.setTargetAtTime(on ? engineVolume * 0.035 * P.noise * load * (0.3 + rn) : 0, t, 0.08);
}

export function engineStop() {
  if (!engine) return;
  const e = engine;
  engine = null;
  e.out.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  e.ngain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  setTimeout(() => e.nodes.forEach((n) => { try { n.stop(); } catch (_) { /* déjà arrêté */ } }), 300);
}
