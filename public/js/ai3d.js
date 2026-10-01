// Pilotes ordinateur des arènes (simulés chez l'hôte) : foot, tamponneuse, bataille.

import { sub, len, norm, qRotInv, add, scale } from './vec.js';
import { clamp } from './util.js';

// Commandes pour aller vers une cible (en marche arrière si elle est juste derrière).
function driveTo(car, target, { boostDist = 30, slow = false } = {}) {
  const local = qRotInv(car.q, sub(target, car.p));
  const ang = Math.atan2(local[0], local[2]); // > 0 : cible à gauche
  const dist = Math.hypot(local[0], local[2]);
  const inp = { throttle: 1, steer: clamp(-ang * 2.6, -1, 1), jump: false, boost: false, slide: false, pitch: 0 };
  if (Math.abs(ang) > 2.3 && dist < 14) {
    inp.throttle = -1;
    inp.steer = clamp(ang > 0 ? 1 : -1, -1, 1);
  }
  if (Math.abs(ang) > 1.2 && car.speed > 15) inp.slide = true;
  if (Math.abs(ang) < 0.3 && dist > boostDist) inp.boost = true;
  if (slow && dist < 6) inp.throttle = 0.3;
  return { inp, dist, ang };
}

export class ArenaBot {
  constructor(car, mode, rand, skill = 0.65) {
    this.car = car;
    this.mode = mode;
    this.rand = rand;
    this.skill = skill;
    this.jumpHold = 0;
    this.stuck = 0;
    this.reverse = 0;
    this.itemDelay = 1;
    this.wander = null;
  }

  // ctx (foot) : { ball, team: +1/-1 (sens d'attaque), role: 'attack'|'support'|'goal', kickoff }
  // ctx (tamponneuse) : { others: [{ p, id }] }
  // ctx (bataille) : { others, boxes: [{ p, on }], item, useItem(), powerReady, usePower() }
  think(dt, ctx) {
    const car = this.car;
    let out;
    if (this.mode === 'rocket') out = this.rocket(dt, ctx);
    else if (this.mode === 'bumper') out = this.bumper(dt, ctx);
    else out = this.battle(dt, ctx);

    // Coincé ou sur le toit : marche arrière, puis saut.
    if (car.speed < 1.5 && !car.locked) this.stuck += dt; else this.stuck = 0;
    if (this.stuck > 1.2) { this.reverse = 0.8; this.stuck = 0; }
    if (this.reverse > 0) {
      this.reverse -= dt;
      out.throttle = -1;
      out.steer = -out.steer;
      out.boost = false;
    }
    if (car.downTime > 0.6) out.jump = !out.jump && Math.random() < 0.5;
    if (ctx.powerReady) {
      this.powerDelay = (this.powerDelay ?? 1 + this.rand() * 5) - dt;
      if (this.powerDelay <= 0) { ctx.usePower(); this.powerDelay = null; }
    }
    return out;
  }

  rocket(dt, ctx) {
    const A = this.car.world.def;
    const car = this.car;
    const ball = ctx.ball;
    const s = ctx.team;
    const lead = 0.25 + this.skill * 0.25;
    const bp = add(ball.p, scale(ball.v, lead));
    bp[0] = clamp(bp[0], -A.X + 3, A.X - 3);
    bp[2] = clamp(bp[2], -A.Z + 3, A.Z - 3);
    const oppGoal = [0, 0, s * (A.Z + 4)];
    const ownGoal = [0, 0, -s * (A.Z - 4)];
    const toGoal = norm([oppGoal[0] - bp[0], 0, oppGoal[2] - bp[2]]);

    let target;
    if (ctx.kickoff || ctx.role === 'attack') {
      const rel = sub(car.p, bp);
      const along = rel[0] * toGoal[0] + rel[2] * toGoal[2]; // < 0 : on est derrière le ballon
      const perp = [toGoal[2], 0, -toGoal[0]];
      const side = rel[0] * perp[0] + rel[2] * perp[2];
      if (ctx.kickoff || along < -1.5) {
        // Dans l'axe : on fonce à travers le ballon, vers le but adverse.
        target = [bp[0] + toGoal[0] * 2, 0, bp[2] + toGoal[2] * 2];
        if (along < -1.5 && Math.abs(side) > 3) target = [bp[0] - toGoal[0] * 1.2, 0, bp[2] - toGoal[2] * 1.2];
      } else {
        // Devant le ballon : on le contourne par le côté où l'on est déjà.
        const sgn = side >= 0 ? 1 : -1;
        target = [bp[0] - toGoal[0] * 9 + perp[0] * 7 * sgn, 0, bp[2] - toGoal[2] * 9 + perp[2] * 7 * sgn];
      }
      // Défense d'urgence : ballon tout près de notre but, on le dégage sur le côté.
      if (s * ball.p[2] < -A.Z * 0.65 && along > 0) target = [ball.p[0] + Math.sign(ball.p[0] || 1) * 2, 0, ball.p[2] - s * 3];
    } else if (ctx.role === 'goal') {
      target = [clamp(ball.p[0] * 0.3, -6, 6), 0, ownGoal[2] + s * 3];
      if (len(sub(ball.p, ownGoal)) < 28) target = [ball.p[0], 0, ball.p[2]];
    } else {
      target = [bp[0] * 0.5, 0, bp[2] - s * 22];
    }
    const { inp, dist } = driveTo(car, target, { boostDist: ctx.kickoff ? 0 : 22 });
    if (ctx.role === 'goal' && dist < 4) inp.throttle = 0;
    inp.boost = inp.boost && car.boost > 10;

    // Ballon en l'air et proche : saut (puis double saut si très haut).
    const flat = Math.hypot(ball.p[0] - car.p[0], ball.p[2] - car.p[2]);
    if (car.grounded && flat < 7 + this.skill * 3 && ball.p[1] > 3.2 && ball.p[1] < 11 && ball.v[1] < 4) {
      inp.jump = true;
      this.jumpHold = 0.25;
    }
    if (this.jumpHold > 0) {
      this.jumpHold -= dt;
      inp.jump = this.jumpHold > 0.1 || (ball.p[1] > 7 && this.jumpHold < 0.05 && this.rand() < this.skill);
    }
    // Petite figure vers le ballon au sol, à bout portant.
    if (!car.grounded && flat < 4 && ball.p[1] < 4 && this.rand() < 0.05 * this.skill) {
      inp.jump = true;
      inp.throttle = 1;
    }
    inp.pitch = 0;
    return inp;
  }

  bumper(dt, ctx) {
    const car = this.car;
    const A = this.car.world.def;
    const r = Math.hypot(car.p[0], car.p[2]);
    // Trop près du bord en regardant dehors : retour au centre.
    const f = car.fwd;
    if (r > A.radius * 0.78 && (f[0] * car.p[0] + f[2] * car.p[2]) > 0) {
      const { inp } = driveTo(car, [0, 0, 0]);
      inp.boost = false;
      return inp;
    }
    // Cible : l'adversaire le plus exposé (près du bord) et proche.
    let best = null;
    let bestScore = Infinity;
    for (const o of ctx.others) {
      const d = len(sub(o.p, car.p));
      const edge = A.radius - Math.hypot(o.p[0], o.p[2]);
      const score = d + edge * 0.8;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    if (!best) return driveTo(car, [0, 0, 0]).inp;
    // Viser un peu derrière la cible pour la pousser vers l'extérieur.
    const out = norm([best.p[0], 0, best.p[2]]);
    const aim = [best.p[0] - out[0] * 1.5, 0, best.p[2] - out[2] * 1.5];
    const { inp, dist, ang } = driveTo(car, aim, { boostDist: 0 });
    inp.boost = Math.abs(ang) < 0.35 && dist < 30 && car.boost > 25;
    if (dist < 5 && this.rand() < 0.02) inp.jump = true;
    return inp;
  }

  battle(dt, ctx) {
    const car = this.car;
    let target = null;
    // Pas d'objet : aller chercher une boîte.
    if (!ctx.item) {
      let bd = Infinity;
      for (const b of ctx.boxes) {
        if (!b.on) continue;
        const d = len(sub(b.p, car.p));
        if (d < bd) { bd = d; target = b.p; }
      }
    }
    let enemy = null;
    let ed = Infinity;
    for (const o of ctx.others) {
      const d = len(sub(o.p, car.p));
      if (d < ed) { ed = d; enemy = o; }
    }
    if (!target && enemy) target = enemy.p;
    if (!target) {
      if (!this.wander || len(sub(this.wander, car.p)) < 6) this.wander = [(this.rand() - 0.5) * 80, 0, (this.rand() - 0.5) * 80];
      target = this.wander;
    }
    const { inp } = driveTo(car, target, { boostDist: 999 });
    // Évitement : obstacle droit devant.
    const f = car.fwd;
    const eye = add(car.p, [0, 0.3, 0]);
    const hit = car.world.ray(eye, norm([f[0], 0, f[2]]), 7);
    if (hit < 7) inp.steer = this.avoid = this.avoid || (this.rand() < 0.5 ? -1 : 1);
    else this.avoid = 0;

    // Objets.
    if (ctx.item) {
      this.itemDelay -= dt;
      if (this.itemDelay <= 0 && enemy) {
        const local = qRotInv(car.q, sub(enemy.p, car.p));
        const ang = Math.abs(Math.atan2(local[0], local[2]));
        const it = ctx.item;
        let use = false;
        let back = false;
        if ((it === 'green' || it === 'bomb') && ang < 0.25 && ed < 40) use = true;
        if (it === 'red' && ed < 60) use = true;
        if (it === 'banana' && ang > 2.4 && ed < 20) { use = true; back = true; }
        if (['mushroom', 'triple', 'star', 'shield'].includes(it)) use = this.rand() < 0.02;
        if (use) { ctx.useItem(back); this.itemDelay = 0.6 + this.rand(); }
      }
    }
    return inp;
  }
}
