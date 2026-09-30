// Sons synthétisés (Web Audio) : aucun fichier audio à fournir.

let ctx = null;
let master = null;
let volume = 0.6;
let engine = null;

try { volume = Math.max(0, Math.min(1, Number(localStorage.getItem('sk-volume') ?? 0.6))); } catch (_) { /* stockage indisponible */ }

// À appeler depuis un geste de l'utilisateur (clic) : les navigateurs bloquent le son avant.
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
  try { localStorage.setItem('sk-volume', String(v)); } catch (_) { /* ignore */ }
}
export const getVolume = () => volume;

function tone({ type = 'square', f0 = 440, f1 = f0, dur = 0.15, gain = 0.2, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.3, gain = 0.3, f = 1200, q = 1, type = 'bandpass', delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
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

export const sfx = {
  count: () => tone({ type: 'square', f0: 520, dur: 0.25, gain: 0.15 }),
  go: () => tone({ type: 'square', f0: 1040, dur: 0.6, gain: 0.18 }),
  box: () => { tone({ type: 'triangle', f0: 700, f1: 1400, dur: 0.12, gain: 0.2 }); noise({ dur: 0.15, gain: 0.15, f: 3000 }); },
  roll: () => tone({ type: 'square', f0: 1200 + Math.random() * 400, dur: 0.04, gain: 0.05 }),
  got: () => { tone({ type: 'triangle', f0: 880, dur: 0.1, gain: 0.18 }); tone({ type: 'triangle', f0: 1320, dur: 0.18, gain: 0.18, delay: 0.08 }); },
  boost: () => { noise({ dur: 0.6, gain: 0.35, f: 900, q: 0.7, type: 'lowpass' }); tone({ type: 'sawtooth', f0: 200, f1: 600, dur: 0.4, gain: 0.08 }); },
  mini: (lv) => tone({ type: 'triangle', f0: 500 + lv * 200, f1: 1200 + lv * 200, dur: 0.25, gain: 0.15 }),
  hop: () => tone({ type: 'sine', f0: 300, f1: 500, dur: 0.08, gain: 0.1 }),
  land: () => noise({ dur: 0.12, gain: 0.2, f: 300, type: 'lowpass' }),
  jump: () => tone({ type: 'triangle', f0: 300, f1: 900, dur: 0.3, gain: 0.15 }),
  trick: () => { tone({ type: 'triangle', f0: 900, f1: 1500, dur: 0.12, gain: 0.15 }); tone({ type: 'triangle', f0: 1500, dur: 0.12, gain: 0.12, delay: 0.1 }); },
  wall: (v) => noise({ dur: 0.18, gain: Math.min(0.4, 0.08 + v * 0.02), f: 250, type: 'lowpass' }),
  bump: () => noise({ dur: 0.1, gain: 0.25, f: 500, q: 2 }),
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
};

// Moteur : deux oscillateurs dont la note suit la vitesse.
export function engineStart() {
  if (!ctx || engine) return;
  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  const filt = ctx.createBiquadFilter();
  const g = ctx.createGain();
  o1.type = 'sawtooth';
  o2.type = 'square';
  filt.type = 'lowpass';
  filt.frequency.value = 900;
  g.gain.value = 0;
  o1.connect(filt);
  o2.connect(filt);
  filt.connect(g).connect(master);
  o1.start();
  o2.start();
  engine = { o1, o2, g, filt };
}

export function engineUpdate(speedRatio, boost, on = true) {
  if (!engine) return;
  const t = ctx.currentTime;
  const f = 55 + Math.abs(speedRatio) * 120 + (boost ? 40 : 0);
  engine.o1.frequency.setTargetAtTime(f, t, 0.05);
  engine.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
  engine.filt.frequency.setTargetAtTime(500 + Math.abs(speedRatio) * 1500, t, 0.1);
  engine.g.gain.setTargetAtTime(on ? 0.045 + Math.abs(speedRatio) * 0.03 : 0, t, 0.1);
}

export function engineStop() {
  if (!engine) return;
  const e = engine;
  engine = null;
  e.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  setTimeout(() => { e.o1.stop(); e.o2.stop(); }, 300);
}
