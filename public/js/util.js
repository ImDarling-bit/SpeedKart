// Petits outils mathématiques partagés par la logique (hôte, invités, tests Node).

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Ramène un angle dans ]-PI, PI].
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;

// Générateur pseudo-aléatoire déterministe (mulberry32) : mêmes décors chez tout le monde.
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function pickWeighted(list, rand, key = 'w') {
  let total = 0;
  for (const it of list) total += it[key] ?? 1;
  let r = rand() * total;
  for (const it of list) {
    r -= it[key] ?? 1;
    if (r <= 0) return it;
  }
  return list[list.length - 1];
}

export function formatTime(ms) {
  if (ms == null || !isFinite(ms)) return '--:--.---';
  const t = Math.max(0, Math.round(ms));
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const r = t % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
