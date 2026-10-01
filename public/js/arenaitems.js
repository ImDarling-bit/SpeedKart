// Objets lancés ou posés dans l'arène de bataille (simulés chez l'hôte).

import { add, sub, len, norm, scale, addScaled, dot } from './vec.js';

export const ARENA_HIT = { banana: 1.3, green: 1.2, red: 1.2, crate: 1.9, spike: 3.2, cone: 1.1, oil: 3.4 };
// Objets qui restent en place et piègent chaque véhicule une seule fois (herse, huile).
export const PERSISTENT = { spike: 12, oil: 14, smoke: 7 };
export const SMOKE_RADIUS = 8;
export const ARENA_BOMB_RADIUS = 9;

// Tirage d'objet en bataille (pas d'éclair, ni de triple turbo trop puissant).
const TABLE = [['banana', 22], ['green', 24], ['red', 16], ['bomb', 12], ['mushroom', 10], ['star', 6], ['shield', 10]];
export function rollArenaItem(rand) {
  let r = rand() * TABLE.reduce((t, x) => t + x[1], 0);
  for (const [id, w] of TABLE) if ((r -= w) <= 0) return id;
  return 'green';
}

export class ArenaEntities {
  constructor(world) {
    this.world = world;
    this.list = new Map();
    this.seq = 0;
    this.events = [];
  }

  // from : { p, fwd (horizontal), speed }
  spawn(type, owner, from, opts = {}) {
    const id = ++this.seq;
    const dir = opts.back ? scale(from.fwd, -1) : from.fwd;
    const e = { id, type, owner, age: 0, p: [...from.p], v: [0, 0, 0], bounces: 0, target: opts.target || null, grounded: false, hits: new Set() };
    if (type === 'spike' || type === 'oil' || type === 'smoke' || type === 'cone') {
      addScaled(e.p, from.fwd, opts.dist ?? -5);
      if (opts.offset) addScaled(e.p, opts.offset, 1);
      e.yaw = Math.atan2(from.fwd[0], from.fwd[2]);
    } else if (type === 'banana' || type === 'crate') {
      addScaled(e.p, from.fwd, opts.back === false ? 4 : -3.2);
      if (opts.back === false) e.v = add(scale(from.fwd, from.speed + 14), [0, 7, 0]);
      if (opts.offset) addScaled(e.p, opts.offset, 1);
    } else if (type === 'green' || type === 'red') {
      addScaled(e.p, dir, 3);
      e.p[1] += 0.2;
      e.v = scale(dir, 46 + (opts.back ? 0 : Math.max(0, from.speed) * 0.4));
    } else if (type === 'bomb') {
      addScaled(e.p, dir, 2.5);
      e.v = add(scale(dir, opts.back ? 6 : Math.max(0, from.speed) + 16), [0, opts.back ? 3 : 10, 0]);
    }
    this.list.set(id, e);
    return e;
  }

  remove(id) {
    if (this.list.delete(id)) this.events.push({ type: 'gone', id });
  }

  update(dt, cars, t = 0) {
    const W = this.world;
    const g = W.gravity(t);
    for (const e of [...this.list.values()]) {
      e.age += dt;
      if (PERSISTENT[e.type] && e.age > PERSISTENT[e.type]) { this.remove(e.id); continue; }
      if (e.type === 'banana' || e.type === 'crate' || e.type === 'bomb' || e.type === 'spike' || e.type === 'oil' || e.type === 'smoke' || e.type === 'cone') {
        if (!e.grounded) {
          addScaled(e.v, g, dt);
          addScaled(e.p, e.v, dt);
          const d = W.dist(e.p[0], e.p[1], e.p[2], t) - 0.4;
          if (d < 0) {
            const n = W.normal(e.p[0], e.p[1], e.p[2], t);
            addScaled(e.p, n, -d);
            if (n[1] > 0.6) {
              e.grounded = e.type !== 'bomb';
              e.v = e.type === 'bomb' ? scale(e.v, 0.5) : [0, 0, 0];
              if (e.type === 'bomb') e.v[1] = Math.abs(e.v[1]) * 0.3;
            } else {
              const vn = dot(e.v, n);
              if (vn < 0) addScaled(e.v, n, -1.5 * vn);
            }
          }
        }
        if (e.type === 'bomb' && e.age > 1.6) this.explode(e);
        if (e.p[1] < -30 || (e.type === 'crate' && e.age > 25)) this.remove(e.id);
        continue;
      }
      // Carapaces : glissent au ras du sol, rebondissent sur les murs.
      if (e.type === 'red' && e.target) {
        const c = cars.find((x) => x.id === e.target);
        if (c) {
          const to = norm([c.p[0] - e.p[0], 0, c.p[2] - e.p[2]]);
          const sp = Math.hypot(e.v[0], e.v[2]);
          const cur = [e.v[0] / sp, 0, e.v[2] / sp];
          const k = Math.min(1, dt * 4);
          const nd = norm([cur[0] + (to[0] - cur[0]) * k, 0, cur[2] + (to[2] - cur[2]) * k]);
          e.v = [nd[0] * sp, 0, nd[2] * sp];
        }
      }
      addScaled(e.p, [e.v[0], 0, e.v[2]], dt);
      // Suit le relief (rampes, plateau).
      const h = W.ray([e.p[0], e.p[1] + 1.5, e.p[2]], [0, -1, 0], 6, t);
      if (h < 6) e.p[1] = e.p[1] + 1.5 - h + 0.5;
      else e.p[1] -= 10 * dt;
      const d = W.dist(e.p[0], e.p[1], e.p[2], t);
      if (d < 0.6) {
        const n = W.normal(e.p[0], e.p[1], e.p[2], t);
        const nh = norm([n[0], 0, n[2]]);
        if (Math.abs(n[1]) < 0.8) {
          const vn = e.v[0] * nh[0] + e.v[2] * nh[2];
          if (vn < 0) { e.v[0] -= 2 * vn * nh[0]; e.v[2] -= 2 * vn * nh[2]; }
          addScaled(e.p, nh, 0.6 - d);
          if (++e.bounces > (e.type === 'red' ? 2 : 6)) this.remove(e.id);
        }
      }
      if (e.age > (e.type === 'red' ? 12 : 9) || e.p[1] < -20) this.remove(e.id);
    }

    // Les carapaces détruisent bananes et autres carapaces.
    const arr = [...this.list.values()];
    for (const a of arr) {
      if (a.type !== 'green' && a.type !== 'red') continue;
      for (const b of arr) {
        if (a === b || b.type === 'bomb' || !this.list.has(a.id) || !this.list.has(b.id)) continue;
        if (len(sub(a.p, b.p)) < 1.8) { this.remove(a.id); this.remove(b.id); }
      }
    }
  }

  explode(e) {
    this.list.delete(e.id);
    this.events.push({ type: 'boom', id: e.id, x: e.p[0], y: e.p[1], z: e.p[2], owner: e.owner });
  }

  // Objet touché par le véhicule carId (ownerId : son lanceur, ignoré au début).
  touching(p, ownerId, carId = ownerId) {
    for (const e of this.list.values()) {
      if (e.type === 'bomb' || e.type === 'smoke') continue;
      if (e.owner === ownerId && e.age < (PERSISTENT[e.type] ? 2 : 0.6)) continue;
      if (PERSISTENT[e.type] && e.hits.has(carId)) continue;
      const r = (ARENA_HIT[e.type] || 1.2) + 1.1;
      if (len(sub(e.p, p)) < r) return e;
    }
    return null;
  }

  snapshot() {
    const r = (v) => Math.round(v * 100) / 100;
    return [...this.list.values()].map((e) => [e.id, e.type, r(e.p[0]), r(e.p[1]), r(e.p[2]), e.owner, Math.round(e.age * 10) / 10, r(e.yaw || 0)]);
  }
}
