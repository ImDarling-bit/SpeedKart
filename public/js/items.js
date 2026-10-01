// Objets : tirage selon la position, et simulation des objets posés/lancés (chez l'hôte).

import { clamp } from './util.js';
import { KART_RADIUS } from './kart.js';

export const ITEMS = {
  mushroom: { name: 'Turbo', icon: 'mushroom' },
  triple: { name: 'Triple turbo', icon: 'mushroom', count: 3 },
  banana: { name: 'Banane', icon: 'banana' },
  green: { name: 'Carapace verte', icon: 'shellGreen' },
  red: { name: 'Carapace rouge', icon: 'shellRed' },
  bomb: { name: 'Bombe', icon: 'bomb' },
  star: { name: 'Étoile', icon: 'star' },
  shield: { name: 'Bouclier', icon: 'shield' },
  lightning: { name: 'Éclair', icon: 'lightning' },
};

// Probabilités selon la place : en tête on reçoit de quoi se défendre, derrière de quoi revenir.
const TABLE = [
  //            1er  milieu  dernier
  ['banana', 32, 10, 0],
  ['green', 30, 16, 4],
  ['shield', 18, 8, 2],
  ['mushroom', 14, 18, 12],
  ['red', 4, 18, 14],
  ['bomb', 2, 12, 10],
  ['triple', 0, 10, 22],
  ['star', 0, 4, 18],
  ['lightning', 0, 2, 8],
];

export function rollItem(rank, total, rand) {
  const p = total > 1 ? (rank - 1) / (total - 1) : 0;
  const w = TABLE.map(([id, a, b, c]) => {
    const v = p < 0.5 ? a + (b - a) * (p / 0.5) : b + (c - b) * ((p - 0.5) / 0.5);
    return { id, w: Math.max(0, v) };
  });
  let r = rand() * w.reduce((t, x) => t + x.w, 0);
  for (const x of w) if ((r -= x.w) <= 0) return x.id;
  return 'mushroom';
}

export const HIT_RADIUS = { banana: 1.3, green: 1.2, red: 1.2, bomb: 1.4, crate: 1.9 };
export const BOMB_RADIUS = 9;

const SHELL_SPEED = 52;
const MAX_BANANAS = 24;

// Objets vivants sur la piste. L'hôte les fait avancer et les diffuse aux joueurs.
export class Entities {
  constructor(track) {
    this.track = track;
    this.list = new Map();
    this.seq = 0;
    this.q = {};
    this.events = []; // { type: 'boom', x, y, z } | { type: 'gone', id }
  }

  // Crée un objet à partir d'une utilisation. from : { x, y, z, yaw, speed }, back : lancer vers l'arrière.
  spawn(type, owner, from, opts = {}) {
    const T = this.track;
    const id = ++this.seq;
    const dir = opts.back ? from.yaw + Math.PI : from.yaw;
    const fx = Math.sin(dir);
    const fz = Math.cos(dir);
    const e = { id, type, owner, age: 0, x: from.x, y: from.y, z: from.z, vx: 0, vz: 0, vy: 0, idx: -1, bounces: 0, target: opts.target || null };
    if (type === 'crate') {
      e.x += (opts.dx || 0);
      e.z += (opts.dz || 0);
    } else if (type === 'comet') {
      e.y += 40; // tombe du ciel
    } else if (type === 'banana') {
      const dist = opts.back === false ? 6 : -3.2; // posée derrière, ou jetée devant
      e.x += opts.dx || 0;
      e.z += opts.dz || 0;
      e.x += Math.sin(from.yaw) * dist;
      e.z += Math.cos(from.yaw) * dist;
      if (opts.back === false) { e.vy = 7; e.vx = fx * (from.speed + 14); e.vz = fz * (from.speed + 14); }
    } else if (type === 'green' || type === 'red') {
      const off = KART_RADIUS * 2.2;
      e.x += fx * off;
      e.z += fz * off;
      const sp = SHELL_SPEED + Math.max(0, from.speed) * (opts.back ? 0 : 0.5);
      e.vx = fx * sp;
      e.vz = fz * sp;
    } else if (type === 'bomb') {
      e.x += fx * 2.5;
      e.z += fz * 2.5;
      const sp = opts.back ? 6 : Math.max(0, from.speed) + 18;
      e.vx = fx * sp;
      e.vz = fz * sp;
      e.vy = opts.back ? 3 : 11;
    }
    const q = T.query(e.x, e.y, e.z, -1, this.q);
    e.idx = q.i;
    e.s = q.s;
    if (e.type !== 'bomb' && e.type !== 'comet' && !e.vy) e.y = q.y + 0.4;
    this.list.set(id, e);

    if (type === 'banana') {
      const bananas = [...this.list.values()].filter((x) => x.type === 'banana');
      if (bananas.length > MAX_BANANAS) this.remove(bananas[0].id);
    }
    return e;
  }

  remove(id) {
    if (this.list.delete(id)) this.events.push({ type: 'gone', id });
  }

  explode(e) {
    this.list.delete(e.id);
    this.events.push({ type: 'boom', id: e.id, x: e.x, y: e.y, z: e.z });
  }

  // karts : [{ id, x, y, z, prog }] pour le guidage des carapaces rouges.
  update(dt, karts) {
    const T = this.track;
    const q = this.q;
    for (const e of [...this.list.values()]) {
      e.age += dt;
      if (e.type === 'banana' || e.type === 'crate') {
        if (e.vy || !e.grounded) this.ballistic(e, dt, 0.4, true);
        if (e.type === 'crate' && e.age > 25) this.remove(e.id);
        continue;
      }
      if (e.type === 'comet') {
        // Fonce sur sa cible, en piqué.
        const t = karts.find((k) => k.id === e.target);
        if (!t || e.age > 8) { this.remove(e.id); continue; }
        const dx = t.x - e.x;
        const dy = t.y + 0.5 - e.y;
        const dz = t.z - e.z;
        const dist = Math.hypot(dx, dy, dz);
        const sp = 75 * dt;
        if (dist < 3 || dist < sp) { e.x = t.x; e.y = t.y; e.z = t.z; this.explode(e); continue; }
        e.x += (dx / dist) * sp;
        e.y += (dy / dist) * sp;
        e.z += (dz / dist) * sp;
        continue;
      }
      if (e.type === 'bomb') {
        this.ballistic(e, dt, 0.4, false);
        if (e.age > 1.6) this.explode(e);
        continue;
      }
      // Carapaces.
      if (e.type === 'red' && e.target) {
        const t = karts.find((k) => k.id === e.target);
        if (t) {
          const dx = t.x - e.x;
          const dz = t.z - e.z;
          const dist = Math.hypot(dx, dz);
          let aimX;
          let aimZ;
          if (dist < 30) {
            aimX = dx / dist;
            aimZ = dz / dist;
          } else {
            // Suit la piste vers la cible.
            const p = T.pointAt(e.s + 14, 0);
            const ax = p.x - e.x;
            const az = p.z - e.z;
            const h = Math.hypot(ax, az) || 1;
            aimX = ax / h;
            aimZ = az / h;
          }
          const sp = Math.hypot(e.vx, e.vz);
          const turn = clamp(dt * 5, 0, 1);
          let nx = e.vx / sp + (aimX - e.vx / sp) * turn;
          let nz = e.vz / sp + (aimZ - e.vz / sp) * turn;
          const h = Math.hypot(nx, nz) || 1;
          e.vx = (nx / h) * sp;
          e.vz = (nz / h) * sp;
        }
      }
      e.x += e.vx * dt;
      e.z += e.vz * dt;
      T.query(e.x, e.y, e.z, e.idx, q);
      e.idx = q.i;
      e.s = q.s;
      e.y = q.y + 0.4;
      const lim = q.hw + T.margin - 0.6;
      if (Math.abs(q.d) > lim) {
        if (T.edge === 'void' && e.type === 'green') {
          this.remove(e.id);
          continue;
        }
        // Rebond contre le mur.
        const side = Math.sign(q.d);
        const nx = q.rx * side;
        const nz = q.rz * side;
        const vn = e.vx * nx + e.vz * nz;
        if (vn > 0) {
          e.vx -= 2 * vn * nx;
          e.vz -= 2 * vn * nz;
        }
        e.x -= nx * (Math.abs(q.d) - lim);
        e.z -= nz * (Math.abs(q.d) - lim);
        if (++e.bounces > (e.type === 'red' ? 2 : 6)) this.remove(e.id);
      }
      if (e.age > (e.type === 'red' ? 12 : 9)) this.remove(e.id);
    }

    // Les carapaces détruisent bananes et autres carapaces.
    const arr = [...this.list.values()];
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (a.type !== 'green' && a.type !== 'red') continue;
      for (let j = 0; j < arr.length; j++) {
        const b = arr[j];
        if (a === b || !this.list.has(a.id) || !this.list.has(b.id) || b.type === 'bomb') continue;
        if (Math.hypot(a.x - b.x, a.z - b.z) < 1.8 && Math.abs(a.y - b.y) < 2) {
          this.remove(a.id);
          this.remove(b.id);
        }
      }
    }
  }

  ballistic(e, dt, lift, stick) {
    const T = this.track;
    const q = this.q;
    e.vy -= 30 * dt;
    e.x += e.vx * dt;
    e.z += e.vz * dt;
    e.y += e.vy * dt;
    T.query(e.x, e.y, e.z, e.idx, q);
    e.idx = q.i;
    e.s = q.s;
    const lim = q.hw + T.margin - 0.6;
    if (Math.abs(q.d) > lim && T.edge === 'wall') {
      const side = Math.sign(q.d);
      e.x -= q.rx * side * (Math.abs(q.d) - lim);
      e.z -= q.rz * side * (Math.abs(q.d) - lim);
      e.vx *= 0.3;
      e.vz *= 0.3;
    }
    if (e.y <= q.y + lift && Math.abs(q.d) <= lim + 0.5) {
      e.y = q.y + lift;
      e.vy = 0;
      e.grounded = true;
      if (stick) { e.vx = 0; e.vz = 0; } else { e.vx *= 0.9; e.vz *= 0.9; }
    } else if (e.y < q.y - 20) {
      this.remove(e.id);
    }
  }

  // Rend un objet touché par le kart k (hôte : bots). Renvoie l'objet ou null.
  touching(k, ownerId) {
    for (const e of this.list.values()) {
      if (e.type === 'bomb' || e.type === 'comet') continue;
      if (e.owner === ownerId && e.age < 0.6) continue;
      const r = (HIT_RADIUS[e.type] || 1.2) + KART_RADIUS * 0.8;
      if (Math.abs(e.x - k.x) < r && Math.abs(e.z - k.z) < r && Math.abs(e.y - k.y - 0.4) < 2.2
        && Math.hypot(e.x - k.x, e.z - k.z) < r) return e;
    }
    return null;
  }

  // Pour la diffusion : [id, type, x, y, z]
  snapshot() {
    const out = [];
    for (const e of this.list.values()) {
      out.push([e.id, e.type, Math.round(e.x * 100) / 100, Math.round(e.y * 100) / 100, Math.round(e.z * 100) / 100, e.owner, Math.round(e.age * 10) / 10]);
    }
    return out;
  }
}

// Place du kart qui précède 'prog' (pour viser avec la carapace rouge).
export function kartAhead(karts, selfId, selfProg) {
  let best = null;
  for (const k of karts) {
    if (k.id === selfId || k.finished) continue;
    if (k.prog > selfProg && (!best || k.prog < best.prog)) best = k;
  }
  return best;
}
