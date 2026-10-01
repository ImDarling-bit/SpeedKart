// Villes du mode police contre voleurs. Une ville est une grille de pâtés de maisons séparés
// par des rues. Ce module produit tout ce dont la logique a besoin : géométrie de collision
// (fonction de distance, comme les arènes), prison, planques, sorties, sacs d'argent,
// points de départ, et le graphe des carrefours pour la navigation des bots.

import { finishWorld } from './arena.js';
import { makeRng, hashString } from './util.js';

// Types de pâtés : B immeuble, P parc, Q place, Y cour (conteneurs), J prison (parc clôturé), W eau.
export const CITIES = [
  {
    id: 'centre', name: 'Centre-Ville', theme: 'city', desc: 'Grands immeubles, parcs et places. Idéal pour semer la police.',
    block: 46, street: 22,
    map: ['BBBBB', 'BPBQB', 'BBJBB', 'BQBPB', 'BBBBB'],
  },
  {
    id: 'usine', name: 'Zone Industrielle', theme: 'industrial', desc: 'Usines, cours remplies de conteneurs et longues avenues.',
    block: 52, street: 24,
    map: ['BYBBYB', 'BBJYBB', 'YBBBQY', 'BBYBBB'],
  },
  {
    id: 'port', name: 'Le Port', theme: 'port', desc: 'Entrepôts et quais : attention à ne pas finir dans l’eau.',
    block: 44, street: 22,
    map: ['BBBBBB', 'BYBJBY', 'BBYBBB', 'YQBYBQ', 'WWWWWW'],
  },
];

export const cityById = (id) => CITIES.find((c) => c.id === id) || CITIES[0];

// ------------------------------------------------------------ primitives SDF

function sdBox(x, y, z, hx, hy, hz) {
  const qx = Math.abs(x) - hx;
  const qy = Math.abs(y) - hy;
  const qz = Math.abs(z) - hz;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
}

function sdOBox(x, y, z, c, h, yaw, pitch) {
  let px = x - c[0];
  const py = y - c[1];
  let pz = z - c[2];
  const cy = Math.cos(-yaw);
  const sy = Math.sin(-yaw);
  const rx = px * cy + pz * sy;
  const rz = -px * sy + pz * cy;
  px = rx; pz = rz;
  const cp = Math.cos(-pitch);
  const sp = Math.sin(-pitch);
  return sdBox(px, py * cp - pz * sp, py * sp + pz * cp, h[0], h[1], h[2]);
}

// ------------------------------------------------------------ plan de la ville

export function buildCity(def) {
  const rand = makeRng(hashString(def.id));
  const rows = def.map.length;
  const cols = def.map[0].length;
  const B = def.block;
  const S = def.street;
  const W = cols * B + (cols + 1) * S;
  const D = rows * B + (rows + 1) * S;
  const step = B + S;
  const streetX = (i) => -W / 2 + S / 2 + i * step; // i = 0..cols
  const streetZ = (j) => -D / 2 + S / 2 + j * step; // j = 0..rows
  const SIDEWALK = 3;

  const blocks = [];
  let prison = null;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const type = def.map[j][i];
      const cx = -W / 2 + S + B / 2 + i * step;
      const cz = -D / 2 + S + B / 2 + j * step;
      const b = { i, j, type, cx, cz, half: B / 2, boxes: [] };
      if (type === 'B') {
        b.boxes.push({ c: [cx, 20, cz], h: [B / 2 - SIDEWALK, 20, B / 2 - SIDEWALK] });
      } else if (type === 'Y') {
        // Conteneurs, parfois empilés.
        for (let k = 0; k < 5; k++) {
          const along = rand() < 0.5;
          const hx = along ? 6 : 1.3;
          const hz = along ? 1.3 : 6;
          const x = cx + (rand() - 0.5) * (B - 18);
          const z = cz + (rand() - 0.5) * (B - 18);
          const hy = rand() < 0.35 ? 2.6 : 1.3;
          b.boxes.push({ c: [x, hy, z], h: [hx, hy, hz], container: true });
        }
      } else if (type === 'J') {
        // Prison : enclos fermé de 26 m de côté.
        const s = 13;
        const t = 0.8;
        const hy = 2.2;
        b.boxes.push({ c: [cx, hy, cz - s], h: [s + t, hy, t], wall: true });
        b.boxes.push({ c: [cx, hy, cz + s], h: [s + t, hy, t], wall: true });
        b.boxes.push({ c: [cx - s, hy, cz], h: [t, hy, s], wall: true });
        b.boxes.push({ c: [cx + s, hy, cz], h: [t, hy, s], wall: true });
        prison = {
          c: [cx, 0, cz], half: s - 2,
          // Bouton de libération : sur la rue, au sud de la prison.
          button: [cx, 0, cz + B / 2 + S / 2],
          cells: [[-6, -6], [6, -6], [-6, 6], [6, 6], [0, 0], [-6, 0], [6, 0], [0, -6]].map(([x, z]) => [cx + x, 1.2, cz + z]),
        };
      }
      blocks.push(b);
    }
  }
  const blockAt = (i, j) => (i >= 0 && j >= 0 && i < cols && j < rows ? blocks[j * cols + i] : null);

  // Carrefours et graphe de navigation (toutes les rues sont praticables).
  const nodes = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) nodes.push({ id: nodes.length, i, j, x: streetX(i), z: streetZ(j), links: [] });
  }
  const nodeAt = (i, j) => nodes[j * (cols + 1) + i];
  for (const n of nodes) {
    if (n.i < cols) { n.links.push(nodeAt(n.i + 1, n.j).id); nodeAt(n.i + 1, n.j).links.push(n.id); }
    if (n.j < rows) { n.links.push(nodeAt(n.i, n.j + 1).id); nodeAt(n.i, n.j + 1).links.push(n.id); }
  }

  // Tremplins en dos d'âne au milieu de quelques rues.
  const ramps = [];
  const segs = [];
  for (const n of nodes) {
    if (n.i < cols && n.j > 0 && n.j < rows) segs.push({ x: (n.x + nodeAt(n.i + 1, n.j).x) / 2, z: n.z, yaw: Math.PI / 2 });
    if (n.j < rows && n.i > 0 && n.i < cols) segs.push({ x: n.x, z: (n.z + nodeAt(n.i, n.j + 1).z) / 2, yaw: 0 });
  }
  for (let k = 0; k < 5 && segs.length; k++) {
    const s = segs.splice(Math.floor(rand() * segs.length), 1)[0];
    const len = 7;
    const hgt = 1.8;
    const pitch = Math.atan2(hgt, len);
    for (const dir of [-1, 1]) {
      const off = (len / 2) * Math.cos(pitch);
      ramps.push({
        c: [s.x + Math.sin(s.yaw) * off * dir, hgt / 2 - 0.35, s.z + Math.cos(s.yaw) * off * dir],
        // Chaque pente descend en s'éloignant du sommet (le +Z local pointe vers l'extérieur).
        h: [S * 0.32, 0.35, len / 2 + 0.2], yaw: s.yaw + (dir > 0 ? 0 : Math.PI), pitch,
      });
    }
  }

  // Planques (braquage) : deux coins opposés.
  const hideouts = [
    { p: [streetX(0), 0, streetZ(0)], r: 9 },
    { p: [streetX(cols), 0, streetZ(rows - (def.map[rows - 1].includes('W') ? 1 : 0))], r: 9 },
  ];
  // Sorties (évasion) : au bout de trois rues, contre l'enceinte.
  const exits = [
    { p: [streetX(Math.floor(cols / 2)), 0, -D / 2 + 6], r: 8 },
    { p: [-W / 2 + 6, 0, streetZ(Math.floor(rows / 2))], r: 8 },
    { p: [W / 2 - 6, 0, streetZ(Math.max(1, Math.floor(rows / 2) - 1))], r: 8 },
  ];
  // Emplacements des sacs : places, parcs, cours, et quelques carrefours.
  const bagSpots = [];
  for (const b of blocks) if (b.type === 'P' || b.type === 'Q') bagSpots.push([b.cx, 1, b.cz]);
  for (const b of blocks) if (b.type === 'Y') bagSpots.push([b.cx + B / 2 - 4, 1, b.cz]);
  for (let k = 0; k < 8; k++) {
    const n = nodes[Math.floor(rand() * nodes.length)];
    bagSpots.push([n.x, 1, n.z]);
  }

  // Eau : pâtés « W » sans sol.
  const isWater = (x, z) => {
    const u = (x + W / 2 - S) / step;
    const v = (z + D / 2 - S) / step;
    const i = Math.floor(u);
    const j = Math.floor(v);
    if (u - i > B / step || v - j > B / step) return false; // dans une rue
    const b = blockAt(i, j);
    return !!b && b.type === 'W';
  };

  return { def, rows, cols, B, S, W, D, step, blocks, blockAt, nodes, nodeAt, ramps, prison, hideouts, exits, bagSpots, isWater, streetX, streetZ, sidewalk: SIDEWALK };
}

// ------------------------------------------------------------ monde physique

export function makeCityWorld(city) {
  const { W, D, B, S, step, blockAt, ramps, isWater } = city;
  const dist = (x, y, z) => {
    let d = isWater(x, z) ? y + 30 : y; // sol (ou eau profonde)
    d = Math.min(d, -sdBox(x, y - 50, z, W / 2, 50, D / 2)); // enceinte
    const i0 = Math.floor((x + W / 2 - S) / step);
    const j0 = Math.floor((z + D / 2 - S) / step);
    for (let j = j0 - 1; j <= j0 + 1; j++) {
      for (let i = i0 - 1; i <= i0 + 1; i++) {
        const b = blockAt(i, j);
        if (!b) continue;
        for (const bx of b.boxes) d = Math.min(d, sdBox(x - bx.c[0], y - bx.c[1], z - bx.c[2], bx.h[0], bx.h[1], bx.h[2]));
      }
    }
    for (const r of ramps) d = Math.min(d, sdOBox(x, y, z, r.c, r.h, r.yaw, r.pitch));
    return d;
  };
  const world = finishWorld('cops', { kind: 'cops', name: city.def.name, city, scale: 1 }, dist, () => 0, () => [0, -24, 0]);
  return world;
}

// ------------------------------------------------------------ navigation

export function nearestNode(city, p) {
  let best = null;
  let bd = Infinity;
  for (const n of city.nodes) {
    const d = (n.x - p[0]) ** 2 + (n.z - p[2]) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

// Plus court chemin (A*) entre deux carrefours ; renvoie la liste des carrefours.
export function findPath(city, from, to) {
  if (from === to) return [from];
  const open = new Set([from.id]);
  const g = new Map([[from.id, 0]]);
  const came = new Map();
  const h = (n) => Math.abs(n.x - to.x) + Math.abs(n.z - to.z);
  const f = new Map([[from.id, h(from)]]);
  while (open.size) {
    let cur = null;
    for (const id of open) if (cur == null || f.get(id) < f.get(cur)) cur = id;
    if (cur === to.id) break;
    open.delete(cur);
    const n = city.nodes[cur];
    for (const l of n.links) {
      const m = city.nodes[l];
      const ng = g.get(cur) + Math.abs(m.x - n.x) + Math.abs(m.z - n.z);
      if (ng < (g.get(l) ?? Infinity)) {
        came.set(l, cur);
        g.set(l, ng);
        f.set(l, ng + h(m));
        open.add(l);
      }
    }
  }
  const path = [to];
  let c = to.id;
  while (came.has(c)) { c = came.get(c); path.unshift(city.nodes[c]); }
  return path[0] === from ? path : [from, to];
}
