// Pilotes ordinateur du mode police contre voleurs : naviguent de carrefour en carrefour.

import { sub, len, norm, qRotInv } from './vec.js';
import { nearestNode, findPath } from './city.js';
import { clamp } from './util.js';

function steerTo(car, target, boostDist = 35) {
  const local = qRotInv(car.q, sub(target, car.p));
  const ang = Math.atan2(local[0], local[2]);
  const dist = Math.hypot(local[0], local[2]);
  const inp = { throttle: 1, steer: clamp(-ang * 2.4, -1, 1), jump: false, boost: false, slide: false, pitch: 0 };
  if (Math.abs(ang) > 2.4 && dist < 12) { inp.throttle = -1; inp.steer = ang > 0 ? 1 : -1; }
  if (Math.abs(ang) > 1.1 && car.speed > 16) inp.slide = true;
  if (Math.abs(ang) < 0.25 && dist > boostDist) inp.boost = true;
  return { inp, dist, ang };
}

export class CopsBot {
  constructor(car, city, rand, skill = 0.65) {
    this.car = car;
    this.city = city;
    this.rand = rand;
    this.skill = skill;
    this.path = null;
    this.pathTarget = null;
    this.repath = 0;
    this.stuck = 0;
    this.reverse = 0;
    this.wander = null;
    this.gadgetDelay = 2;
  }

  // Se rendre à une position : tout droit si la voie est libre, sinon par les rues.
  goTo(target, dt, boostDist) {
    const car = this.car;
    const W = car.world;
    const d = len(sub(target, car.p));
    const dir = norm([target[0] - car.p[0], 0, target[2] - car.p[2]]);
    const clear = d < 60 && W.ray([car.p[0], car.p[1] + 0.6, car.p[2]], dir, Math.min(d, 60)) >= Math.min(d, 60) - 0.5;
    if (clear) {
      this.path = null;
      return steerTo(car, target, boostDist);
    }
    this.repath -= dt;
    if (!this.path || this.repath <= 0 || this.pathTarget !== target) {
      this.path = findPath(this.city, nearestNode(this.city, car.p), nearestNode(this.city, target));
      this.pathTarget = target;
      this.repath = 0.8;
    }
    while (this.path.length > 1 && Math.hypot(this.path[0].x - car.p[0], this.path[0].z - car.p[2]) < 10) this.path.shift();
    const wp = this.path[0];
    return steerTo(car, [wp.x, 0, wp.z], boostDist);
  }

  // Carrefour voisin le plus éloigné d'un danger.
  fleeTarget(danger) {
    const n = nearestNode(this.city, this.car.p);
    let best = n;
    let bd = -1;
    for (const l of n.links) {
      const m = this.city.nodes[l];
      for (const l2 of [l, ...m.links]) {
        const k = this.city.nodes[l2];
        const d = Math.hypot(k.x - danger[0], k.z - danger[2]);
        if (d > bd) { bd = d; best = k; }
      }
    }
    return [best.x, 0, best.z];
  }

  randomNode() {
    const n = this.city.nodes[Math.floor(this.rand() * this.city.nodes.length)];
    return [n.x, 0, n.z];
  }

  // ctx : { role, rule, me, cops, thieves, bags, hideouts, prison, exits, exitsOpen, prisoners,
  //         gadgetReady(slot), useGadget(slot) }
  think(dt, ctx) {
    const car = this.car;
    let out;
    if (ctx.me.jailed || ctx.me.out) return { throttle: 0, steer: 0 };
    if (ctx.role === 'cop') out = this.cop(dt, ctx);
    else out = this.thief(dt, ctx);

    if (car.speed < 1.5 && !car.locked) this.stuck += dt; else this.stuck = 0;
    if (this.stuck > 1.3) { this.reverse = 0.9; this.stuck = 0; this.path = null; }
    if (this.reverse > 0) {
      this.reverse -= dt;
      out.throttle = -1;
      out.steer = -out.steer;
      out.boost = false;
    }
    if (car.downTime > 0.6) out.jump = Math.random() < 0.5;
    out.boost = out.boost && car.boost > 15;
    return out;
  }

  cop(dt, ctx) {
    const car = this.car;
    let target = null;
    let td = Infinity;
    for (const t of ctx.thieves) {
      if (t.jailed || t.out) continue;
      const d = len(sub(t.p, car.p));
      if (d < td && d < 170) { td = d; target = t; }
    }
    if (!target) {
      if (!this.wander || len(sub(this.wander, car.p)) < 12) this.wander = this.randomNode();
      return this.goTo(this.wander, dt, 40).inp;
    }
    // Anticipe la trajectoire du voleur.
    const lead = clamp(td / 40, 0, 1) * (0.4 + this.skill * 0.5);
    const aim = [target.p[0] + target.v[0] * lead, 0, target.p[2] + target.v[2] * lead];
    const { inp } = this.goTo(aim, dt, 20);
    this.gadgetDelay -= dt;
    if (this.gadgetDelay <= 0) {
      this.gadgetDelay = 1.5 + this.rand() * 2;
      if (td > 25 && td < 100 && ctx.gadgetReady(0)) ctx.useGadget(0);
      else if (this.rand() < 0.15 && ctx.gadgetReady(1)) ctx.useGadget(1);
      else if (this.rand() < 0.1 && ctx.gadgetReady(2)) ctx.useGadget(2);
    }
    return inp;
  }

  thief(dt, ctx) {
    const car = this.car;
    let danger = null;
    let dd = Infinity;
    for (const c of ctx.cops) {
      const d = len(sub(c.p, car.p));
      if (d < dd) { dd = d; danger = c; }
    }
    const fleeDist = ctx.rule === 'heist' ? 30 : 45;
    this.gadgetDelay -= dt;
    if (danger && dd < fleeDist) {
      if (this.gadgetDelay <= 0) {
        this.gadgetDelay = 1 + this.rand() * 1.5;
        if (ctx.gadgetReady(0)) ctx.useGadget(0);
        else if (dd < 22 && ctx.gadgetReady(1)) ctx.useGadget(1);
        else if (dd < 22 && ctx.gadgetReady(2)) ctx.useGadget(2);
      }
      const { inp } = this.goTo(this.fleeTarget(danger.p), dt, 15);
      return inp;
    }

    let target = null;
    if (ctx.rule === 'heist') {
      const nearest = (list) => {
        let best = null;
        let bd = Infinity;
        for (const p of list) {
          const d = len(sub(p, car.p));
          if (d < bd) { bd = d; best = p; }
        }
        return best;
      };
      if (ctx.prisoners > 0 && ctx.me.bags === 0 && this.rand() < 0.002) this.rescue = 8;
      if (this.rescue > 0) { this.rescue -= dt; target = ctx.prison.button; }
      else if (ctx.me.bags >= 2 || (ctx.me.bags > 0 && !ctx.bags.some((b) => b.on))) target = nearest(ctx.hideouts.map((h) => h.p));
      else target = nearest(ctx.bags.filter((b) => b.on).map((b) => b.p));
    } else if (ctx.rule === 'escape' && ctx.exitsOpen) {
      let bd = Infinity;
      for (const e of ctx.exits) {
        const d = len(sub(e.p, car.p));
        if (d < bd) { bd = d; target = e.p; }
      }
    }
    if (!target) {
      if (!this.wander || len(sub(this.wander, car.p)) < 12) this.wander = this.randomNode();
      target = this.wander;
    }
    return this.goTo(target, dt, 40).inp;
  }
}
