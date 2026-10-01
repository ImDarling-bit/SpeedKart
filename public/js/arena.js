// Arènes des modes tamponneuse, foot et bataille. Chaque arène est décrite par une fonction de
// distance signée (SDF) : dist(p) > 0 dans l'espace libre, < 0 dans la matière. La physique des
// voitures, du ballon et des objets ne connaît que cette fonction : murs incurvés, buts, plateformes
// et obstacles mobiles sont ainsi gérés de la même façon.

import { len, sub, norm } from './vec.js';

// ------------------------------------------------------------ primitives SDF

function sdBox(x, y, z, hx, hy, hz) {
  const qx = Math.abs(x) - hx;
  const qy = Math.abs(y) - hy;
  const qz = Math.abs(z) - hz;
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  return out + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
}

function sdRoundBox(x, y, z, hx, hy, hz, r) {
  return sdBox(x, y, z, hx - r, hy - r, hz - r) - r;
}

// Cylindre vertical plein : rayon r, de y0 à y1.
function sdCyl(x, y, z, r, y0, y1) {
  const dr = Math.hypot(x, z) - r;
  const hy = (y1 - y0) / 2;
  const dy = Math.abs(y - (y0 + hy)) - hy;
  return Math.min(Math.max(dr, dy), 0) + Math.hypot(Math.max(dr, 0), Math.max(dy, 0));
}

// Boîte orientée : centre c, demi-tailles h, cap (autour de Y) puis inclinaison (autour de X local).
function sdOBox(x, y, z, c, h, yaw = 0, pitch = 0) {
  let px = x - c[0];
  let py = y - c[1];
  let pz = z - c[2];
  const cy = Math.cos(-yaw);
  const sy = Math.sin(-yaw);
  const rx = px * cy + pz * sy;
  const rz = -px * sy + pz * cy;
  px = rx; pz = rz;
  const cp = Math.cos(-pitch);
  const sp = Math.sin(-pitch);
  const ry = py * cp - pz * sp;
  const rz2 = py * sp + pz * cp;
  return sdBox(px, ry, rz2, h[0], h[1], h[2]);
}

// ------------------------------------------------------------ définitions

// Taille des arènes de foot et de tamponneuse selon le nombre de véhicules :
// 1× pour 2 véhicules, jusqu'à 2× pour 8.
export function arenaScale(kind, count) {
  if (kind !== 'rocket' && kind !== 'bumper') return 1;
  return Math.max(1, Math.min(2, 1 + (count - 2) / 6));
}

// Définition d'une arène à l'échelle s.
export function arenaDef(kind, s = 1) {
  if (kind === 'rocket') {
    // Terrain de foot motorisé : boîte aux arêtes arrondies (on roule sur les murs), deux buts.
    const k = (f) => 1 + (s - 1) * f; // grandit moins vite que le terrain
    return {
      kind, name: 'Stade Turbo', scale: s,
      X: 52 * s, Z: 72 * s, H: 30 * k(0.5), R: 11 * k(0.3),
      goal: { w: 11 * k(0.45), h: 8.5 * k(0.25), d: 9 },
      ballR: 2.4 * k(0.15),
      gravity: [0, -16, 0],
    };
  }
  if (kind === 'bumper') {
    // Plateforme flottante circulaire, plots rebondissants et barre tournante.
    return {
      kind, name: 'Plateau Tamponneur', scale: s,
      radius: 38 * s,
      bumpers: [[18, 0], [-18, 0], [0, 18], [0, -18], [22, 22], [-22, -22]].map(([x, z]) => ({ x: x * s, z: z * s, r: 2.6 })),
      sweeper: { len: 30 * s, w: 1.6, h: 1.5, speed: 0.55 / Math.sqrt(s) },
    };
  }
  // Arène de bataille : enceinte murée, plateau central avec rampes, piliers et murets.
  return {
    kind: 'battle', name: 'Arène des Ballons', scale: 1,
    half: 56, wallH: 6,
    plateau: { c: [0, 1.6, 0], h: [11, 1.6, 11] },
    ramps: [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((yaw) => ({ yaw })),
    pillars: [[-34, -34], [34, -34], [-34, 34], [34, 34]].map(([x, z]) => ({ x, z, r: 3 })),
    walls: [
      { c: [0, 1.2, -36], h: [10, 1.2, 0.8], yaw: 0 },
      { c: [0, 1.2, 36], h: [10, 1.2, 0.8], yaw: 0 },
      { c: [-36, 1.2, 0], h: [0.8, 1.2, 10], yaw: 0 },
      { c: [36, 1.2, 0], h: [0.8, 1.2, 10], yaw: 0 },
    ],
  };
}

// Phases de gravité de l'arène tamponneuse (toutes les 14 s) : même calcul chez tout le monde.
export const BUMPER_PHASES = [
  { id: 'normale', name: 'Gravité normale' },
  { id: 'lune', name: 'Gravité lunaire !' },
  { id: 'lourde', name: 'Gravité écrasante !' },
  { id: 'penchee', name: 'Le monde penche !' },
  { id: 'yoyo', name: 'Gravité folle !' },
];
export const PHASE_LEN = 14;

export function bumperGravity(t) {
  const ph = BUMPER_PHASES[Math.floor(t / PHASE_LEN) % BUMPER_PHASES.length].id;
  switch (ph) {
    case 'lune': return { g: [0, -5, 0], phase: ph };
    case 'lourde': return { g: [0, -34, 0], phase: ph };
    case 'penchee': { const a = t * 0.6; return { g: [Math.sin(a) * 8, -16, Math.cos(a) * 8], phase: ph }; }
    case 'yoyo': return { g: [0, -18 * (0.55 + 0.75 * Math.sin(t * 2.2)), 0], phase: ph };
    default: return { g: [0, -18, 0], phase: ph };
  }
}

// ------------------------------------------------------------ mondes physiques

// Monde physique d'une arène. Pour une ville (police contre voleurs), voir city.js.
export function makeWorld(kind, scale = 1) {
  const A = arenaDef(kind, scale);
  let dist;
  let bounce = () => 0;
  let gravity = () => [0, -18, 0];

  if (kind === 'rocket') {
    const { X, Z, H, R, goal } = A;
    const gz = (goal.d + R) / 2;
    dist = (x, y, z) => {
      const field = -sdRoundBox(x, y - H / 2, z, X, H / 2, Z, R);
      let d = field;
      for (const s of [-1, 1]) {
        const cz = s * (Z + (goal.d - R) / 2);
        const g = -sdRoundBox(x, y - goal.h / 2, z - cz, goal.w, goal.h / 2, gz, 1.2);
        if (g > d) d = g; // union des espaces libres
      }
      return d;
    };
    gravity = () => A.gravity;
  } else if (kind === 'bumper') {
    const { radius, bumpers, sweeper } = A;
    dist = (x, y, z, t = 0) => {
      let d = sdCyl(x, y, z, radius, -4, 0);
      for (const b of bumpers) d = Math.min(d, sdCyl(x - b.x, y, z - b.z, b.r, 0, 2.2));
      const a = t * sweeper.speed;
      d = Math.min(d, sdOBox(x, y, z, [0, sweeper.h / 2, 0], [sweeper.len / 2, sweeper.h / 2, sweeper.w / 2], a, 0));
      d = Math.min(d, sdCyl(x, y, z, 2.2, 0, 2.6)); // pivot central
      return d;
    };
    // Les plots rebondissent très fort.
    bounce = (x, y, z) => {
      for (const b of bumpers) if (Math.hypot(x - b.x, z - b.z) < b.r + 0.6 && y < 2.8) return 1.6;
      return 0;
    };
    gravity = (t) => bumperGravity(t).g;
  } else {
    const { half, plateau, pillars, walls } = A;
    const rampLen = 13;
    const rampAngle = Math.atan2(plateau.h[1] * 2, rampLen);
    const ramps = A.ramps.map(({ yaw }) => {
      const dir = [Math.sin(yaw), 0, Math.cos(yaw)];
      const mid = plateau.h[0] + (rampLen / 2) * Math.cos(rampAngle);
      return { yaw, c: [dir[0] * mid, plateau.h[1] - 0.3, dir[2] * mid], h: [5, 0.35, rampLen / 2 + 0.3], pitch: rampAngle };
    });
    A.rampsResolved = ramps;
    dist = (x, y, z) => {
      let d = -sdBox(x, y - 30, z, half, 30, half); // enceinte (sol + murs)
      d = Math.min(d, sdBox(x - plateau.c[0], y - plateau.c[1], z - plateau.c[2], ...plateau.h));
      for (const r of ramps) d = Math.min(d, sdOBox(x, y, z, r.c, r.h, r.yaw, r.pitch));
      for (const p of pillars) d = Math.min(d, sdCyl(x - p.x, y, z - p.z, p.r, 0, 9));
      for (const w of walls) d = Math.min(d, sdOBox(x, y, z, w.c, w.h, w.yaw, 0));
      return d;
    };
    gravity = () => [0, -24, 0];
  }

  return finishWorld(kind, A, dist, bounce, gravity);
}

// Ajoute à une fonction de distance les outils communs (normale, rayon, sol).
export function finishWorld(kind, def, dist, bounce = () => 0, gravity = () => [0, -18, 0]) {
  const world = {
    kind,
    def,
    dist,
    bounce,
    gravity,
    normal(x, y, z, t = 0) {
      const e = 0.04;
      return norm([
        dist(x + e, y, z, t) - dist(x - e, y, z, t),
        dist(x, y + e, z, t) - dist(x, y - e, z, t),
        dist(x, y, z + e, t) - dist(x, y, z - e, t),
      ]);
    },
    // Lancer de rayon par « sphere tracing ». Renvoie la distance de l'impact, ou Infinity.
    ray(o, d, maxLen, t = 0) {
      let s = 0;
      for (let i = 0; i < 32 && s <= maxLen; i++) {
        const h = dist(o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s, t);
        if (h < 0.01) return s;
        s += Math.max(h, 0.02);
      }
      return Infinity;
    },
    // Point de réapparition sûr le plus proche de (x, z) sur le sol.
    groundY(x, z, t = 0) {
      const top = kind === 'bumper' || kind === 'rocket' ? 4 : 12;
      const h = world.ray([x, top, z], [0, -1, 0], 40, t);
      return h === Infinity ? null : top - h;
    },
  };
  return world;
}

// Le ballon est-il entré dans un but ? +1 : but côté +Z, -1 : côté -Z, 0 sinon.
export function goalScored(ball, A) {
  if (Math.abs(ball.p[0]) > A.goal.w || ball.p[1] > A.goal.h) return 0;
  if (ball.p[2] > A.Z + A.ballR * 0.8) return 1;
  if (ball.p[2] < -A.Z - A.ballR * 0.8) return -1;
  return 0;
}

export function distTo(a, b) {
  return len(sub(a, b));
}
