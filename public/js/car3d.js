// Voiture en physique 3D (corps rigide) pour les arènes : tamponneuse, foot, bataille.
// Les roues sondent le sol par des rayons ; tant qu'au moins 3 touchent, la voiture colle à la
// surface (sol, mur, plafond) et se pilote comme une voiture. Sinon elle vole : contrôle en l'air,
// et sa coque rebondit sur l'arène. Les chocs donnent de la rotation : on peut se retourner.

import { dot, cross, add, sub, scale, norm, len, addScaled, qRot, qRotInv, qMul, qNorm, qIntegrate, qFromTo, qSlerp, qYaw, yawOf } from './vec.js';

export const CAR_HALF = [0.95, 0.5, 1.55];
const WHEELS = [[0.8, -0.3, 1.05], [-0.8, -0.3, 1.05], [0.8, -0.3, -1.05], [-0.8, -0.3, -1.05]];
const RIDE = 0.55; // distance roue -> sol au repos
const RAY = 0.85;
const HULL = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) HULL.push([x * CAR_HALF[0], y * CAR_HALF[1], z * CAR_HALF[2]]);
HULL.push([0, CAR_HALF[1], 0], [0, CAR_HALF[1], CAR_HALF[2]], [0, CAR_HALF[1], -CAR_HALF[2]], [0, 0, CAR_HALF[2] + 0.1], [0, 0, -CAR_HALF[2] - 0.1]);
// Inertie d'une boîte (masse 1).
const I_INV = [
  12 / ((2 * CAR_HALF[1]) ** 2 + (2 * CAR_HALF[2]) ** 2),
  12 / ((2 * CAR_HALF[0]) ** 2 + (2 * CAR_HALF[2]) ** 2),
  12 / ((2 * CAR_HALF[0]) ** 2 + (2 * CAR_HALF[1]) ** 2),
];

// Réglages par mode. Le foot reprend les sensations de Rocket League (gravité basse,
// turbo, double saut, figures) ; la tamponneuse est rebondissante et instable.
export const CAR_MODES = {
  rocket: {
    maxSpeed: 30, boostSpeed: 46, accel: 22, brake: 34, boostAccel: 26, turnLow: 2.9, turnHigh: 1.6,
    grip: 9, slideGrip: 1.6, jump: 6.4, jumpHold: 22, jumpHoldTime: 0.2, dbl: 6.4, dodge: 12, dodgeSpin: 6.5,
    airPitch: 10, airYaw: 7, airRoll: 18, maxAng: 5.5, stick: 6, rest: 0.25, boostUse: 33, boostRegen: 0,
    carCarE: 0.3, lift: 0.15, mass: 1,
  },
  bumper: {
    maxSpeed: 22, boostSpeed: 36, accel: 18, brake: 26, boostAccel: 34, turnLow: 2.8, turnHigh: 2,
    grip: 7, slideGrip: 1.4, jump: 5.5, jumpHold: 10, jumpHoldTime: 0.15, dbl: 0, dodge: 0, dodgeSpin: 0,
    airPitch: 3, airYaw: 3, airRoll: 3, maxAng: 9, stick: 0, rest: 0.45, boostUse: 60, boostRegen: 18,
    carCarE: 1.5, lift: 0.6, mass: 1,
  },
  // Poursuites en ville : rapide, adhérent, turbo qui se recharge.
  cops: {
    maxSpeed: 31, boostSpeed: 44, accel: 22, brake: 34, boostAccel: 28, turnLow: 3.0, turnHigh: 1.9,
    grip: 11, slideGrip: 2, jump: 5.5, jumpHold: 10, jumpHoldTime: 0.15, dbl: 0, dodge: 0, dodgeSpin: 0,
    airPitch: 4, airYaw: 4, airRoll: 4, maxAng: 6, stick: 2, rest: 0.25, boostUse: 45, boostRegen: 9,
    carCarE: 0.5, lift: 0.1, mass: 1,
  },
  battle: {
    maxSpeed: 25, boostSpeed: 38, accel: 21, brake: 30, boostAccel: 30, turnLow: 3.1, turnHigh: 2.1,
    grip: 12, slideGrip: 2.5, jump: 5, jumpHold: 8, jumpHoldTime: 0.12, dbl: 0, dodge: 0, dodgeSpin: 0,
    airPitch: 4, airYaw: 4, airRoll: 4, maxAng: 6, stick: 3, rest: 0.2, boostUse: 0, boostRegen: 0,
    carCarE: 0.6, lift: 0.1, mass: 1,
  },
};

export const CF = {
  BOOST: 1, AIR: 2, DODGE: 4, DOWN: 8, STAR: 16, SHIELD: 32, GHOST: 64, GIANT: 128,
  SPIN: 256, BLINK: 512, OUT: 1024, FROZEN: 2048, SMALL: 4096, SLIDE: 8192,
};

const EFFECTS = ['star', 'giant', 'ghost', 'freeze', 'invert', 'slow', 'lowGrav', 'turbo', 'small', 'spin', 'invuln'];

export class Car3D {
  constructor(world, mode = 'rocket', weight = 3) {
    this.world = world;
    this.mode = mode;
    this.P = CAR_MODES[mode];
    this.weight = weight; // 1..5 : pèse dans les chocs
    this.p = [0, 2, 0];
    this.v = [0, 0, 0];
    this.q = [0, 0, 0, 1];
    this.w = [0, 0, 0];
    this.boost = mode === 'rocket' ? 33 : 100;
    this.grounded = false;
    this.contacts = 0;
    this.n = [0, 1, 0];
    this.prevJump = false;
    this.jumpTime = 99;
    this.airTime = 0;
    this.dblUsed = false;
    this.dodgeTime = 0;
    this.boosting = false;
    this.slide = false;
    this.locked = false;
    this.downTime = 0; // temps passé sur le toit / le flanc
    this.shield = 0; // coups encaissables
    this.fx = {};
    for (const e of EFFECTS) this.fx[e] = 0;
    this.onEvent = null;
  }

  emit(type, data) { if (this.onEvent) this.onEvent(type, data); }

  place(x, y, z, yaw) {
    this.p = [x, y, z];
    this.v = [0, 0, 0];
    this.w = [0, 0, 0];
    this.q = qYaw(yaw);
    this.grounded = false;
    this.dblUsed = false;
    this.downTime = 0;
  }

  get up() { return qRot(this.q, [0, 1, 0]); }
  get fwd() { return qRot(this.q, [0, 0, 1]); }
  get left() { return qRot(this.q, [1, 0, 0]); }
  get yaw() { return yawOf(this.q); }
  get speed() { return len(this.v); }

  get flags() {
    let f = 0;
    if (this.boosting || this.fx.turbo > 0) f |= CF.BOOST;
    if (!this.grounded) f |= CF.AIR;
    if (this.dodgeTime > 0) f |= CF.DODGE;
    if (this.downTime > 0.4) f |= CF.DOWN;
    if (this.fx.star > 0) f |= CF.STAR;
    if (this.shield > 0) f |= CF.SHIELD;
    if (this.fx.ghost > 0) f |= CF.GHOST;
    if (this.fx.giant > 0) f |= CF.GIANT;
    if (this.fx.spin > 0) f |= CF.SPIN;
    if (this.fx.invuln > 0 && this.fx.ghost <= 0) f |= CF.BLINK;
    if (this.fx.freeze > 0) f |= CF.FROZEN;
    if (this.fx.small > 0) f |= CF.SMALL;
    if (this.slide) f |= CF.SLIDE;
    return f;
  }

  effect(name, t) {
    if (name in this.fx) this.fx[name] = Math.max(this.fx[name], t);
  }

  // Vitesse angulaire : applique I^-1 (repère monde).
  invInertia(v) {
    const l = qRotInv(this.q, v);
    const k = this.fx.giant > 0 ? 0.3 : 1;
    return qRot(this.q, [l[0] * I_INV[0] * k, l[1] * I_INV[1] * k, l[2] * I_INV[2] * k]);
  }

  applyImpulse(point, J) {
    const m = this.mass;
    addScaled(this.v, J, 1 / m);
    const r = sub(point, this.p);
    const dw = this.invInertia(cross(r, J));
    addScaled(this.w, dw, 1 / m);
  }

  get mass() { return this.P.mass * (0.75 + this.weight * 0.1) * (this.fx.giant > 0 ? 4 : 1); }

  // inp : { throttle -1..1, steer -1..1, pitch -1..1, jump, boost, slide }
  step(dt, inp, t = 0) {
    const P = this.P;
    const W = this.world;
    for (const e of EFFECTS) if (this.fx[e] > 0) this.fx[e] = Math.max(0, this.fx[e] - dt);
    if (this.dodgeTime > 0) this.dodgeTime -= dt;
    this.jumpTime += dt;

    const stunned = this.locked || this.fx.freeze > 0 || this.fx.spin > 0;
    let steer = stunned ? 0 : inp.steer || 0;
    if (this.fx.invert > 0) steer = -steer;
    const throttle = stunned ? 0 : inp.throttle || 0;
    const up = this.up;
    const fwd = this.fwd;
    const left = this.left;

    // 1. Roues : contact avec le sol (n'importe quelle surface).
    let contacts = 0;
    const nSum = [0, 0, 0];
    let tSum = 0;
    const down = scale(up, -1);
    for (const o of WHEELS) {
      const origin = add(this.p, qRot(this.q, o));
      const h = W.ray(origin, down, RAY, t);
      if (h < RAY) {
        contacts++;
        tSum += h;
        const hp = addScaled([...origin], down, h);
        const n = W.normal(hp[0], hp[1], hp[2], t);
        addScaled(nSum, n, 1);
      }
    }
    this.contacts = contacts;
    const wasGrounded = this.grounded;
    let nGround = contacts ? norm(nSum) : null;
    // Trop lent sur un mur ou au plafond : les roues décrochent.
    const speedNow = len(this.v);
    if (nGround && nGround[1] < 0.5 && speedNow < 9 + (nGround[1] < -0.3 ? 6 : 0)) nGround = null;
    this.grounded = contacts >= 3 && this.jumpTime > 0.12 && !!nGround;

    if (this.grounded) {
      const n = nGround;
      this.n = n;
      this.airTime = 0;
      this.dblUsed = false;
      this.dodgeTime = 0;
      if (!wasGrounded) this.emit('land', -dot(this.v, n));
      // Se pose sur la surface : redresse l'orientation, garde la bonne hauteur.
      const align = qFromTo(up, n);
      const target = qMul(align, this.q);
      this.q = qNorm(qSlerp(this.q, target, Math.min(1, 16 * dt)));
      // Hauteur de caisse : on repousse si comprimé ; on ne plaque que sur un sol (pas mur/plafond).
      const tAvg = tSum / contacts;
      const gap = RIDE - tAvg;
      if (gap > 0 || n[1] > 0.7) addScaled(this.p, n, gap * Math.min(1, 25 * dt));
      const vn = dot(this.v, n);
      if (vn < 0) addScaled(this.v, n, -vn);
      // Adhérence aux murs et au plafond.
      if (P.stick) addScaled(this.v, n, -P.stick * dt * (n[1] < 0.7 ? 2 : 1));

      // Conduite dans le plan de la surface.
      const f = norm(sub(fwd, scale(n, dot(fwd, n))));
      const side = norm(cross(n, f)); // vers la gauche
      const vf = dot(this.v, f);
      const vs = dot(this.v, side);
      let max = P.maxSpeed * (this.fx.slow > 0 ? 0.65 : 1) * (this.fx.star > 0 ? 1.15 : 1) * (this.fx.small > 0 ? 0.75 : 1) * (this.speedMul ?? 1);
      if (throttle > 0) {
        if (vf < 0) addScaled(this.v, f, P.brake * dt);
        else if (vf < max) addScaled(this.v, f, P.accel * throttle * (1 - 0.65 * (vf / max)) * dt);
      } else if (throttle < 0) {
        if (vf > 0.5) addScaled(this.v, f, -P.brake * dt);
        else if (vf > -max * 0.6) addScaled(this.v, f, P.accel * throttle * 0.8 * dt);
      } else {
        addScaled(this.v, f, -vf * Math.min(1, 1.2 * dt));
      }
      // Pas d'accélération au-delà de la vitesse max sans turbo.
      const vf2 = dot(this.v, f);
      if (vf2 > max && !this.boosting && this.fx.turbo <= 0) addScaled(this.v, f, (max - vf2) * Math.min(1, 3 * dt));
      // Adhérence latérale (glisse si frein à main).
      this.slide = !!inp.slide && !stunned;
      const grip = this.slide ? P.slideGrip : P.grip;
      addScaled(this.v, side, -vs * Math.min(1, grip * dt));
      // Braquage : rotation autour de la normale.
      const sp = Math.abs(vf);
      const turn = (P.turnLow + (P.turnHigh - P.turnLow) * Math.min(1, sp / P.maxSpeed)) * Math.min(1, sp / 4) * (this.slide ? 1.4 : 1);
      const targetYaw = -steer * turn * Math.sign(vf || 1);
      const wn = dot(this.w, n);
      const newWn = wn + (targetYaw - wn) * Math.min(1, 14 * dt);
      this.w = scale(n, newWn);
    } else {
      this.airTime += dt;
      this.slide = false;
      // Contrôle en l'air (sauf pendant une figure).
      if (this.dodgeTime <= 0 && !stunned) {
        const pitchIn = inp.pitch ?? throttle;
        const rollMode = !!inp.slide;
        const wl = qRotInv(this.q, this.w);
        const ax = P.airPitch * pitchIn; // + : nez vers le bas
        const ay = rollMode ? 0 : -P.airYaw * steer;
        const az = rollMode ? P.airRoll * steer : 0;
        wl[0] += ax * dt;
        wl[1] += ay * dt;
        wl[2] += az * dt;
        // Amortissement des axes sans commande.
        if (!pitchIn) wl[0] *= Math.exp(-3 * dt);
        if (!ay) wl[1] *= Math.exp(-3 * dt);
        if (!az) wl[2] *= Math.exp(-3 * dt);
        this.w = qRot(this.q, wl);
      }
    }

    // 2. Saut, double saut, figure, remise sur roues.
    const jumpPressed = !!inp.jump && !stunned;
    if (jumpPressed && !this.prevJump) {
      if (this.grounded) {
        addScaled(this.v, up, P.jump);
        this.jumpTime = 0;
        this.grounded = false;
        this.emit('jump');
      } else if (this.downTime > 0.3 && this.contacts < 3 && this.touchN && this.touchN[1] > 0.5) {
        // Sur le toit ou le flanc : on se remet sur ses roues.
        addScaled(this.v, [0, 1, 0], 5);
        addScaled(this.w, fwd, 6 * (dot(left, [0, 1, 0]) > 0 ? -1 : 1));
        this.emit('flip');
      } else if (P.dbl && !this.dblUsed && this.airTime < 1.4) {
        this.dblUsed = true;
        const fIn = inp.throttle || 0;
        const sIn = steer;
        if (Math.hypot(fIn, sIn) > 0.4) {
          // Figure : impulsion dans la direction choisie et rotation rapide.
          const h = norm([fwd[0] * fIn - left[0] * sIn, 0, fwd[2] * fIn - left[2] * sIn]);
          addScaled(this.v, h, P.dodge);
          if (this.v[1] < 0) this.v[1] *= 0.3;
          this.w = add(scale(left, P.dodgeSpin * fIn), scale(fwd, P.dodgeSpin * sIn));
          this.dodgeTime = 0.6;
          this.emit('dodge');
        } else {
          addScaled(this.v, up, P.dbl);
          this.emit('jump');
        }
      }
    }
    if (inp.jump && this.jumpTime < P.jumpHoldTime && !this.grounded) addScaled(this.v, up, P.jumpHold * dt);
    this.prevJump = jumpPressed;

    // 3. Turbo.
    const wantBoost = !!inp.boost && !stunned && P.boostUse > 0 && this.boost > 0;
    this.boosting = wantBoost;
    if (wantBoost) {
      addScaled(this.v, fwd, P.boostAccel * dt);
      this.boost = Math.max(0, this.boost - P.boostUse * dt);
    } else if (P.boostRegen) {
      this.boost = Math.min(100, this.boost + P.boostRegen * dt);
    }
    if (this.fx.turbo > 0 && !stunned) addScaled(this.v, fwd, P.boostAccel * dt);
    const cap = Math.max(P.boostSpeed, 30) * (this.fx.turbo > 0 ? 1.1 : 1);
    const sp = len(this.v);
    if (sp > cap) this.v = scale(this.v, cap / sp);

    // 4. Gravité, intégration.
    const g = W.gravity(t);
    const gk = this.fx.lowGrav > 0 ? 0.3 : 1;
    addScaled(this.v, g, dt * gk);
    if (this.fx.freeze > 0) { this.v = scale(this.v, Math.exp(-6 * dt)); this.w = scale(this.w, Math.exp(-6 * dt)); }
    if (this.fx.spin > 0) this.w = add(scale(this.w, 0.9), scale(up, 1.2));
    addScaled(this.p, this.v, dt);
    const wl = len(this.w);
    if (wl > P.maxAng && this.dodgeTime <= 0 && !this.grounded) this.w = scale(this.w, P.maxAng / wl);
    qIntegrate(this.q, this.w, dt);

    // 5. Coque contre l'arène (rebonds, frottements).
    this.collideWorld(t);

    // Posé sur le toit / le flanc, sur un sol ?
    const upY = this.up[1];
    const onFloor = this.touchN && this.touchN[1] > 0.5;
    if (!this.grounded && this.contacts < 2 && upY < 0.35 && len(this.v) < 6 && onFloor) this.downTime += dt;
    else if (this.grounded || !onFloor) this.downTime = Math.max(0, this.downTime - dt * 2);
  }

  collideWorld(t) {
    const W = this.world;
    let deepest = 0;
    let deepN = null;
    for (const lp of HULL) {
      const pw = add(this.p, qRot(this.q, lp));
      const d = W.dist(pw[0], pw[1], pw[2], t);
      if (d >= 0) continue;
      const n = W.normal(pw[0], pw[1], pw[2], t);
      if (d < deepest) { deepest = d; deepN = n; }
      const r = sub(pw, this.p);
      const vp = add(this.v, cross(this.w, r));
      const vn = dot(vp, n);
      if (vn >= 0) continue;
      const e = W.bounce(pw[0], pw[1], pw[2]) || this.P.rest;
      const rn = cross(r, n);
      const k = 1 / this.mass + dot(n, cross(this.invInertia(rn), r)) / this.mass;
      const j = (-(1 + e) * vn) / k;
      this.applyImpulse(pw, scale(n, j));
      // Frottement.
      const vt = sub(vp, scale(n, vn));
      const vtl = len(vt);
      if (vtl > 1e-3) {
        const jt = Math.min(j * 0.4, vtl / k);
        this.applyImpulse(pw, scale(vt, -jt / vtl));
      }
      if (e > 1) this.emit('bumper', -vn);
      else if (-vn > 6) this.emit('crash', -vn);
    }
    if (deepN) addScaled(this.p, deepN, -deepest * 0.9);
    this.touchN = deepN;
  }

  // Coup reçu (objet en bataille, tornade...) : toupie et grosse perte de vitesse.
  spinOut() {
    if (this.fx.star > 0 || this.fx.ghost > 0 || this.fx.invuln > 0) return false;
    if (this.shield > 0) { this.shield--; this.fx.invuln = 0.6; this.emit('shieldBreak'); return false; }
    this.effect('spin', 1.1);
    this.effect('invuln', 2);
    this.v = scale(this.v, 0.3);
    addScaled(this.v, [0, 1, 0], 5);
    this.emit('hit');
    return true;
  }
}

// Spheres approchant la carrosserie (avant, arrière) pour les chocs entre voitures.
const SPHERES = [[0, 0, 0.75], [0, 0, -0.75]];
const SR = 1.05;

// Choc entre la voiture `me` (simulée ici) et une autre (état reçu : p, q, v, mass).
// N'agit que sur `me` ; renvoie la force du choc (0 si aucun).
export function collideCars(me, o, mode) {
  if (me.fx.ghost > 0 || o.ghost) return 0;
  const P = CAR_MODES[mode];
  const k1 = me.fx.giant > 0 ? 2 : me.fx.small > 0 ? 0.7 : 1;
  const k2 = o.giant ? 2 : o.small ? 0.7 : 1;
  let best = null;
  for (const a of SPHERES) {
    const pa = add(me.p, qRot(me.q, scale(a, k1)));
    for (const b of SPHERES) {
      const pb = add(o.p, qRot(o.q, scale(b, k2)));
      const d = len(sub(pa, pb));
      const min = SR * (k1 + k2);
      if (d < min && (!best || d < best.d)) best = { pa, pb, d, min };
    }
  }
  if (!best) return 0;
  let n = best.d > 1e-4 ? norm(sub(best.pa, best.pb)) : [0, 1, 0];
  const overlap = best.min - best.d;
  const mo = (o.mass || 1) * (o.giant ? 4 : 1);
  const share = mo / (mo + me.mass);
  addScaled(me.p, n, overlap * share);
  const c = scale(add(best.pa, best.pb), 0.5);
  const r = sub(c, me.p);
  const vme = add(me.v, cross(me.w, r));
  const rel = sub(vme, o.v || [0, 0, 0]);
  const vn = dot(rel, n);
  if (vn >= 0) return 0;
  let e = P.carCarE;
  if (o.star) e = 2.2;
  // Tamponneuse : on soulève la victime, d'où les tonneaux.
  if (P.lift) n = norm(add(n, [0, P.lift, 0]));
  const j = (-(1 + e) * vn) / (1 / me.mass + 1 / mo);
  me.applyImpulse(add(me.p, scale(r, mode === 'bumper' ? 1.3 : 0.6)), scale(n, j));
  return -vn;
}

// Frappe du ballon par une voiture. Renvoie la force du contact, 0 sinon. Ne modifie que le ballon
// (la voiture n'est presque pas freinée).
export function hitBall(car, ball) {
  const local = qRotInv(car.q, sub(ball.p, car.p));
  const c = [
    Math.max(-CAR_HALF[0], Math.min(CAR_HALF[0], local[0])),
    Math.max(-CAR_HALF[1], Math.min(CAR_HALF[1] + 0.15, local[1])),
    Math.max(-CAR_HALF[2], Math.min(CAR_HALF[2] + 0.1, local[2])),
  ];
  const cw = add(car.p, qRot(car.q, c));
  const diff = sub(ball.p, cw);
  const d = len(diff);
  if (d >= ball.r) return 0;
  const n = d > 1e-4 ? scale(diff, 1 / d) : car.fwd;
  ball.p = add(cw, scale(n, ball.r + 0.01));
  const vcar = add(car.v, cross(car.w, sub(cw, car.p)));
  const rel = sub(ball.v, vcar);
  const vn = dot(rel, n);
  if (vn >= 0) return 0;
  addScaled(ball.v, n, -1.6 * vn * 0.78);
  // Coup de pouce « à la Rocket League » : envoie le ballon dans l'axe voiture -> ballon.
  const dir = sub(ball.p, car.p);
  dir[1] *= 0.35;
  addScaled(ball.v, norm(dir), Math.min(len(rel), 30) * 0.32);
  return -vn;
}

// Ballon de foot : gravité, rebonds sur l'arène, frottement, effet de roulement pour l'affichage.
export class Ball {
  constructor(world, r) {
    this.world = world;
    this.r = r;
    this.p = [0, r + 4, 0];
    this.v = [0, 0, 0];
    this.spin = [0, 0, 0];
  }

  reset() {
    this.p = [0, this.r + 4, 0];
    this.v = [0, 0, 0];
    this.spin = [0, 0, 0];
  }

  step(dt, t = 0) {
    const W = this.world;
    addScaled(this.v, W.gravity(t), dt);
    this.v = scale(this.v, Math.exp(-0.03 * dt));
    const sp = len(this.v);
    if (sp > 80) this.v = scale(this.v, 80 / sp);
    addScaled(this.p, this.v, dt);
    const d = W.dist(this.p[0], this.p[1], this.p[2], t) - this.r;
    let bounced = 0;
    if (d < 0) {
      const n = W.normal(this.p[0], this.p[1], this.p[2], t);
      addScaled(this.p, n, -d);
      const vn = dot(this.v, n);
      if (vn < 0) {
        addScaled(this.v, n, -1.6 * vn);
        const vt = sub(this.v, scale(n, dot(this.v, n)));
        addScaled(this.v, vt, -Math.min(1, 0.25 * dt * 60) * 0.05);
        this.spin = scale(cross(n, this.v), 1 / this.r);
        bounced = -vn;
      }
    }
    return bounced;
  }
}
