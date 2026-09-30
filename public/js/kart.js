// Physique arcade d'un kart. Même code chez chaque joueur (son propre kart) et chez l'hôte (bots).

import { clamp, wrapAngle, lerpAngle } from './util.js';

export const KART_RADIUS = 1.3;
const GRAVITY = 34;
const DRIFT_LEVELS = [1.0, 2.1, 3.3]; // secondes de charge pour bleu, orange, violet
const DRIFT_BOOST = [0.7, 1.1, 1.6];

// Drapeaux d'état envoyés sur le réseau (pour l'affichage chez les autres).
export const F = {
  DRIFT: 1, DRIFT_R: 2, BOOST: 4, SPIN: 8, STAR: 16, SHIELD: 32, SMALL: 64,
  AIR: 128, FALL: 256, TRICK: 512, BLINK: 1024, LV1: 2048, LV2: 4096, BACK: 8192,
};

export class Kart {
  constructor(track, params) {
    this.track = track;
    this.p = params;
    this.q = {};
    this.reset();
  }

  reset() {
    this.x = 0; this.y = 0; this.z = 0;
    this.yaw = 0; this.moveYaw = 0; this.visYaw = 0;
    this.speed = 0; this.vy = 0; this.vyGround = 0;
    this.ex = 0; this.ez = 0; // poussée externe (chocs)
    this.grounded = true;
    this.idx = -1;
    this.s = 0; this.prog = 0; this.lastSafeS = 0;
    this.drifting = false; this.driftDir = 0; this.driftCharge = 0; this.prevDrift = false;
    this.boostTime = 0; this.starTime = 0; this.smallTime = 0; this.spinTime = 0; this.spinKind = 0;
    this.invuln = 0; this.shield = false; this.shieldTime = 0;
    this.airTime = 0; this.fromRamp = false; this.trick = false; this.trickTime = 0;
    this.falling = false; this.fallTime = 0;
    this.surface = 'road';
    this.bumped = 0; this.landed = 0; this.miniTurbo = 0; this.boostPad = false;
    this.wrongWay = 0;
    this.locked = true; // bloqué pendant le compte à rebours
    this.onEvent = null; // (type, data) -> sons et effets
  }

  place(slot) {
    const T = this.track;
    this.reset();
    this.x = slot.x; this.y = slot.y; this.z = slot.z;
    this.yaw = this.moveYaw = this.visYaw = slot.yaw;
    const q = T.query(this.x, this.y, this.z, -1, this.q);
    this.idx = q.i;
    this.s = q.s;
    this.lastSafeS = q.s;
    // Progression négative : on démarre derrière la ligne.
    this.prog = T.deltaS(0, q.s);
    if (this.prog > 0) this.prog -= T.length;
  }

  emit(type, data) { if (this.onEvent) this.onEvent(type, data); }

  get level() {
    if (!this.drifting) return 0;
    let l = 0;
    for (const t of DRIFT_LEVELS) if (this.driftCharge >= t) l++;
    return l;
  }

  get flags() {
    let f = 0;
    if (this.drifting) { f |= F.DRIFT; if (this.driftDir > 0) f |= F.DRIFT_R; }
    const lv = this.level;
    if (lv & 1) f |= F.LV1;
    if (lv & 2) f |= F.LV2;
    if (this.boostTime > 0) f |= F.BOOST;
    if (this.spinTime > 0) f |= F.SPIN;
    if (this.starTime > 0) f |= F.STAR;
    if (this.shield) f |= F.SHIELD;
    if (this.smallTime > 0) f |= F.SMALL;
    if (!this.grounded) f |= F.AIR;
    if (this.falling) f |= F.FALL;
    if (this.trickTime > 0) f |= F.TRICK;
    if (this.invuln > 0) f |= F.BLINK;
    return f;
  }

  boost(t) {
    this.boostTime = Math.max(this.boostTime, t);
    this.emit('boost');
  }

  // Touché par un objet. kind : 'spin' (banane, carapace), 'tumble' (bombe), 'zap' (éclair).
  // Renvoie false si le coup est encaissé par l'étoile, le bouclier ou l'invulnérabilité.
  hit(kind = 'spin') {
    if (this.starTime > 0 || this.invuln > 0 || this.falling) return false;
    if (this.shield && kind !== 'zap') {
      this.shield = false;
      this.shieldTime = 0;
      this.invuln = 0.6;
      this.emit('shieldBreak');
      return false;
    }
    if (kind === 'zap') {
      this.smallTime = 5;
      this.shield = false;
    }
    this.drifting = false;
    this.boostTime = 0;
    this.spinKind = kind === 'tumble' ? 1 : 0;
    this.spinTime = kind === 'tumble' ? 1.6 : kind === 'zap' ? 0.9 : 1.2;
    this.invuln = this.spinTime + 0.8;
    if (kind === 'tumble' && this.grounded) {
      this.vy = 9;
      this.grounded = false;
    }
    this.emit('hit', kind);
    return true;
  }

  step(dt, inp) {
    const T = this.track;
    const P = this.p;
    const q = this.q;
    this.bumped = 0;
    this.landed = 0;
    this.miniTurbo = 0;

    for (const k of ['boostTime', 'starTime', 'smallTime', 'spinTime', 'invuln', 'trickTime']) {
      if (this[k] > 0) this[k] = Math.max(0, this[k] - dt);
    }
    if (this.shield && (this.shieldTime -= dt) <= 0) this.shield = false;

    if (this.falling) return this.stepFalling(dt);

    const canDrive = !this.locked && this.spinTime <= 0;
    const steer = canDrive ? clamp(inp.steer || 0, -1, 1) : 0;
    const throttle = canDrive && inp.throttle;
    const brake = canDrive && inp.brake;

    // Vitesse de pointe selon l'état.
    let top = P.maxSpeed;
    if (this.smallTime > 0) top *= 0.72;
    if (this.starTime > 0) top *= 1.15;
    if (this.surface === 'off' && this.boostTime <= 0 && this.starTime <= 0) top *= P.offroad;
    if (this.boostTime > 0) top = Math.max(top, P.maxSpeed * 1.4);

    // Longitudinal.
    if (this.spinTime > 0) {
      this.speed *= Math.exp(-3.2 * dt);
    } else if (throttle || this.boostTime > 0) {
      if (this.speed < 0) this.speed += 40 * dt;
      else if (this.speed < top) {
        const a = P.accel * (1 - 0.6 * (this.speed / top)) * (this.boostTime > 0 ? 3 : 1);
        this.speed = Math.min(top, this.speed + a * dt);
      }
    } else if (brake) {
      if (this.speed > 0.5) this.speed -= 36 * dt;
      else this.speed = Math.max(-top * 0.35, this.speed - P.accel * 0.7 * dt);
    } else {
      this.speed *= Math.exp(-0.8 * dt);
      if (Math.abs(this.speed) < 0.3) this.speed = 0;
    }
    if (this.speed > top) this.speed = Math.max(top, this.speed - 22 * dt);

    // Dérapage : appui + direction, petit saut, charge du mini-turbo.
    const driftPressed = !!inp.drift;
    if (canDrive && driftPressed && !this.prevDrift) {
      if (!this.grounded && this.fromRamp && this.airTime < 0.5 && !this.trick) {
        this.trick = true;
        this.trickTime = 0.5;
        this.emit('trick');
      } else if (this.grounded && !this.drifting && this.speed > 12 && Math.abs(steer) > 0.2) {
        this.drifting = true;
        this.driftDir = Math.sign(steer);
        this.driftCharge = 0;
        this.vy = 3.6;
        this.grounded = false;
        this.emit('hop');
      }
    }
    this.prevDrift = driftPressed;

    if (this.drifting && (!driftPressed || this.speed < 9 || this.spinTime > 0 || this.surface === 'off' && this.boostTime <= 0 && this.speed < 14)) {
      const lv = this.level;
      this.drifting = false;
      if (lv > 0 && this.spinTime <= 0) {
        this.boost(DRIFT_BOOST[lv - 1]);
        this.miniTurbo = lv;
      }
    }

    // Rotation.
    const sf = clamp(Math.abs(this.speed) / 9, 0, 1) * (this.speed < 0 ? -1 : 1);
    let yawRate;
    if (this.drifting) {
      const into = steer * this.driftDir; // -1 : on élargit, +1 : on serre
      yawRate = P.turn * this.driftDir * (0.62 + 0.42 * into);
      if (this.grounded) this.driftCharge += dt * (into > 0.3 ? 1.35 : 1);
    } else {
      yawRate = P.turn * steer * (1 - 0.22 * clamp(this.speed / P.maxSpeed, 0, 1));
    }
    if (!this.grounded) yawRate *= 0.6;
    if (this.spinTime <= 0) this.yaw = wrapAngle(this.yaw - yawRate * sf * dt);

    // Adhérence : la trajectoire rattrape le cap plus ou moins vite.
    const grip = this.drifting ? 2.6 : this.grounded ? 11 : 1.2;
    this.moveYaw = lerpAngle(this.moveYaw, this.yaw, 1 - Math.exp(-grip * dt));

    // Rendu : pivot visuel en dérapage, toupie quand on est touché.
    if (this.spinTime > 0) this.visYaw = wrapAngle(this.visYaw + dt * (this.spinKind ? 9 : 13));
    else this.visYaw = lerpAngle(this.visYaw, this.yaw + (this.drifting ? -this.driftDir * 0.42 : 0), 1 - Math.exp(-12 * dt));

    // Déplacement horizontal.
    const decay = Math.exp(-3.5 * dt);
    this.ex *= decay;
    this.ez *= decay;
    const vx = Math.sin(this.moveYaw) * this.speed + this.ex;
    const vz = Math.cos(this.moveYaw) * this.speed + this.ez;
    this.x += vx * dt;
    this.z += vz * dt;

    // Position sur la piste.
    const wasRamp = this.q.ramp || 0;
    T.query(this.x, this.y, this.z, this.idx, q);
    this.idx = q.i;
    const lim = q.hw + T.margin;
    const ad = Math.abs(q.d);

    if (ad > lim - KART_RADIUS) {
      if (T.edge === 'wall') {
        // Mur : on replace le kart et on renvoie la vitesse vers la piste.
        const side = Math.sign(q.d);
        const excess = ad - (lim - KART_RADIUS);
        this.x -= q.rx * side * excess;
        this.z -= q.rz * side * excess;
        const vn = vx * q.rx * side + vz * q.rz * side;
        if (vn > 0) {
          const hard = vn / Math.max(8, Math.abs(this.speed));
          this.speed *= 1 - 0.55 * clamp(hard, 0, 1);
          this.ex -= q.rx * side * vn * 0.7;
          this.ez -= q.rz * side * vn * 0.7;
          const trackYaw = Math.atan2(q.fx, q.fz);
          const back = Math.cos(wrapAngle(this.yaw - trackYaw)) < 0;
          this.yaw = lerpAngle(this.yaw, back ? trackYaw + Math.PI : trackYaw, 0.25);
          this.moveYaw = lerpAngle(this.moveYaw, this.yaw, 0.5);
          if (vn > 4) { this.bumped = vn; this.emit('wall', vn); }
          if (this.drifting && hard > 0.5) this.drifting = false;
        }
      } else if (ad > lim + 0.3 && this.grounded) {
        this.startFall();
        return;
      }
    }
    this.surface = ad <= q.hw ? 'road' : 'off';

    // Vertical.
    const groundY = q.y;
    if (this.grounded) {
      if (groundY < this.y - 0.7) {
        // Le sol se dérobe (bosse, fin de tremplin) : on décolle.
        this.grounded = false;
        this.vy = this.vyGround + (wasRamp > 0.6 ? 5 + this.speed * 0.12 : 0);
        this.fromRamp = wasRamp > 0.6;
        this.airTime = 0;
        this.trick = false;
        if (this.fromRamp) this.emit('jump');
      } else {
        this.vyGround = clamp((groundY - this.y) / dt, -30, 30);
        this.y = groundY;
      }
    }
    if (!this.grounded) {
      this.airTime += dt;
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= groundY && ad <= lim + 0.3) {
        this.y = groundY;
        this.landed = Math.max(0.01, -this.vy);
        this.vy = 0;
        this.vyGround = 0;
        this.grounded = true;
        if (this.trick) this.boost(1.0);
        this.trick = false;
        this.fromRamp = false;
        this.emit('land', this.landed);
      } else if (T.edge === 'void' && ad > lim + 0.3 && this.y < groundY - 1.5) {
        this.startFall();
        return;
      }
    }

    if (this.grounded && this.surface === 'road') this.lastSafeS = q.s;

    // Tapis de vitesse.
    const pad = this.grounded && T.onBoost(q);
    if (pad && !this.boostPad) this.boost(1.3);
    this.boostPad = pad;

    // Progression (tours).
    this.prog += T.deltaS(this.s, q.s);
    this.s = q.s;

    // Mauvais sens.
    const dir = Math.sin(this.yaw) * q.fx + Math.cos(this.yaw) * q.fz;
    if (dir < -0.3 && !this.locked) this.wrongWay += dt;
    else this.wrongWay = Math.max(0, this.wrongWay - dt * 2);
  }

  startFall() {
    this.falling = true;
    this.fallTime = 0;
    this.drifting = false;
    this.grounded = false;
    this.emit('fall');
  }

  stepFalling(dt) {
    this.fallTime += dt;
    this.vy -= GRAVITY * dt;
    this.y += this.vy * dt;
    this.x += Math.sin(this.moveYaw) * this.speed * dt * 0.6;
    this.z += Math.cos(this.moveYaw) * this.speed * dt * 0.6;
    if (this.fallTime > 1.4) this.respawn();
  }

  // Retour sur la piste (après une chute), un peu avant le dernier point sûr.
  respawn() {
    const T = this.track;
    const s = this.lastSafeS - 6;
    const p = T.pointAt(s, 0);
    this.x = p.x; this.y = p.y + 0.5; this.z = p.z;
    this.yaw = this.moveYaw = this.visYaw = p.yaw;
    this.speed = 0; this.vy = 0; this.ex = 0; this.ez = 0;
    this.falling = false;
    this.grounded = false;
    this.invuln = 2;
    this.boostTime = 0;
    const q = T.query(this.x, this.y, this.z, -1, this.q);
    this.idx = q.i;
    this.prog += T.deltaS(this.s, q.s);
    this.s = q.s;
    this.emit('respawn');
  }

  // Heurte les autres karts (positions affichées). others : [{x, y, z, weight, star}]
  collide(others) {
    for (const o of others) {
      const dx = this.x - o.x;
      const dz = this.z - o.z;
      if (Math.abs(this.y - o.y) > 2.2) continue;
      const d = Math.hypot(dx, dz);
      const min = KART_RADIUS * 2 * (this.smallTime > 0 ? 0.75 : 1);
      if (d >= min || d < 1e-3) continue;
      const nx = dx / d;
      const nz = dz / d;
      const push = min - d;
      let share = o.weight / (o.weight + this.p.weight);
      if (this.starTime > 0) share = 0.05;
      else if (o.star) share = 1;
      this.x += nx * push * share;
      this.z += nz * push * share;
      const kick = (4 + push * 10) * share * 1.6;
      this.ex += nx * kick;
      this.ez += nz * kick;
      if (share > 0.4) this.speed *= 0.97;
      this.emit('bump', o);
    }
  }
}
