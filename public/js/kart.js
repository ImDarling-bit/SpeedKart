// Physique arcade d'un kart. Même code chez chaque joueur (son propre kart) et chez l'hôte (bots).

import { clamp, wrapAngle, lerpAngle } from './util.js';

export const KART_RADIUS = 1.3;
const GRAVITY = 34;
// Gravité « magnétique » dans les loopings : un kart lancé à sa vitesse de pointe passe toujours,
// même en 50cc ; seul un kart vraiment lent (après un choc, en marche arrière...) retombe.
const LOOP_G = 8;
const DRIFT_LEVELS = [1.0, 2.1, 3.3]; // secondes de charge pour bleu, orange, violet
const DRIFT_BOOST = [0.7, 1.1, 1.6];

// Drapeaux d'état envoyés sur le réseau (pour l'affichage chez les autres).
export const F = {
  DRIFT: 1, DRIFT_R: 2, BOOST: 4, SPIN: 8, STAR: 16, SHIELD: 32, SMALL: 64,
  AIR: 128, FALL: 256, TRICK: 512, BLINK: 1024, LV1: 2048, LV2: 4096, BACK: 8192,
  GIANT: 1 << 14, GHOST: 1 << 15, FROZEN: 1 << 16, WINGS: 1 << 17, FLIP: 1 << 18, LOWGRAV: 1 << 19, LOOP: 1 << 20,
};

// Effets temporaires (pouvoirs). Durées en secondes.
const EFFECTS = ['giant', 'ghost', 'freeze', 'invert', 'slow', 'lowGrav', 'wings', 'tires', 'magnet', 'rocket'];

export class Kart {
  constructor(track, params) {
    this.track = track;
    this.p = params;
    this.baseWeight = params.weight;
    this.q = {};
    this.pt = {};
    this.chaos = false; // option « physique tamponneuse »
    this.gravMul = 1;
    this.reset();
  }

  reset() {
    this.x = 0; this.y = 0; this.z = 0;
    this.yaw = 0; this.moveYaw = 0; this.visYaw = 0; this.pitch = 0;
    this.speed = 0; this.vy = 0; this.vyGround = 0;
    this.ex = 0; this.ez = 0; // poussée externe (chocs)
    this.grounded = true;
    this.idx = -1;
    this.s = 0; this.prog = 0; this.lastSafeS = 0;
    this.d = 0; this.loop = null;
    this.drifting = false; this.driftDir = 0; this.driftCharge = 0; this.prevDrift = false;
    this.boostTime = 0; this.starTime = 0; this.smallTime = 0; this.spinTime = 0; this.spinKind = 0;
    this.invuln = 0; this.shield = false; this.shieldTime = 0; this.shieldHits = 0;
    this.airTime = 0; this.fromRamp = false; this.trick = false; this.trickTime = 0;
    this.falling = false; this.fallTime = 0;
    this.surface = 'road';
    this.bumped = 0; this.landed = 0; this.miniTurbo = 0; this.boostPad = false;
    this.wrongWay = 0;
    this.locked = true; // bloqué pendant le compte à rebours
    this.fx = {};
    for (const e of EFFECTS) this.fx[e] = 0;
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

  // Téléportation (pouvoirs) : pose complète, progression comprise.
  teleport({ x, y, z, yaw, prog }) {
    const T = this.track;
    this.loop = null;
    this.x = x; this.y = y + 0.3; this.z = z;
    if (yaw != null) this.yaw = this.moveYaw = this.visYaw = yaw;
    this.vy = 0; this.ex = 0; this.ez = 0;
    this.grounded = false;
    this.falling = false;
    const q = T.query(this.x, this.y, this.z, -1, this.q);
    this.idx = q.i;
    this.s = q.s;
    this.lastSafeS = q.s;
    if (prog != null) this.prog = prog;
    this.invuln = Math.max(this.invuln, 1);
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
    if (this.spinKind === 2 && this.spinTime > 0) f |= F.FLIP;
    if (this.starTime > 0) f |= F.STAR;
    if (this.shield) f |= F.SHIELD;
    if (this.smallTime > 0) f |= F.SMALL;
    if (!this.grounded) f |= F.AIR;
    if (this.falling) f |= F.FALL;
    if (this.trickTime > 0) f |= F.TRICK;
    if (this.invuln > 0 && !this.fx.ghost) f |= F.BLINK;
    if (this.fx.giant > 0) f |= F.GIANT;
    if (this.fx.ghost > 0) f |= F.GHOST;
    if (this.fx.freeze > 0) f |= F.FROZEN;
    if (this.fx.wings > 0) f |= F.WINGS;
    if (this.fx.lowGrav > 0) f |= F.LOWGRAV;
    if (this.loop) f |= F.LOOP;
    return f;
  }

  boost(t) {
    this.boostTime = Math.max(this.boostTime, t);
    this.emit('boost');
  }

  // Touché par un objet. kind : 'spin' (banane, carapace), 'tumble' (bombe), 'zap' (éclair),
  // 'flip' (gros choc en mode tamponneuse : le kart fait un tonneau).
  // Renvoie false si le coup est encaissé par l'étoile, le bouclier, le fantôme ou l'invulnérabilité.
  hit(kind = 'spin') {
    if (this.starTime > 0 || this.invuln > 0 || this.falling || this.fx.ghost > 0) return false;
    if (this.fx.giant > 0 && kind === 'spin') return false; // les géants écrasent les bananes
    if (this.shield && kind !== 'zap') {
      if (--this.shieldHits <= 0) { this.shield = false; this.shieldTime = 0; }
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
    this.spinKind = kind === 'tumble' ? 1 : kind === 'flip' ? 2 : 0;
    this.spinTime = kind === 'tumble' ? 1.6 : kind === 'flip' ? 1.3 : kind === 'zap' ? 0.9 : 1.2;
    this.invuln = this.spinTime + 0.8;
    if ((kind === 'tumble' || kind === 'flip') && !this.loop) {
      this.vy = kind === 'flip' ? 11 : 9;
      this.grounded = false;
    }
    this.emit('hit', kind);
    return true;
  }

  // Applique un effet de pouvoir (ou un objet) au kart.
  effect(name, t) {
    if (name in this.fx) this.fx[name] = Math.max(this.fx[name], t);
    if (name === 'rocket') this.boost(t);
    if (name === 'freeze') { this.speed *= 0.2; this.drifting = false; }
  }

  topSpeed() {
    const P = this.p;
    let top = P.maxSpeed;
    if (this.smallTime > 0) top *= 0.72;
    if (this.starTime > 0) top *= 1.15;
    if (this.fx.slow > 0) top *= 0.65;
    if (this.fx.magnet > 0) top *= 1.3;
    if (this.fx.lowGrav > 0) top *= 0.85;
    if (this.fx.giant > 0) top *= 1.05;
    const offOk = this.boostTime > 0 || this.starTime > 0 || this.fx.tires > 0 || this.fx.wings > 0;
    if (this.surface === 'off' && !offOk) top *= P.offroad;
    if (this.boostTime > 0) top = Math.max(top, P.maxSpeed * (this.fx.rocket > 0 ? 1.65 : 1.4));
    return top;
  }

  step(dt, inp) {
    const P = this.p;
    this.bumped = 0;
    this.landed = 0;
    this.miniTurbo = 0;

    for (const k of ['boostTime', 'starTime', 'smallTime', 'spinTime', 'invuln', 'trickTime']) {
      if (this[k] > 0) this[k] = Math.max(0, this[k] - dt);
    }
    for (const e of EFFECTS) if (this.fx[e] > 0) this.fx[e] = Math.max(0, this.fx[e] - dt);
    if (this.shield && (this.shieldTime -= dt) <= 0) this.shield = false;
    P.weight = this.baseWeight * (this.fx.giant > 0 ? 4 : 1);

    if (this.falling) return this.stepFalling(dt);

    const canDrive = !this.locked && this.spinTime <= 0 && this.fx.freeze <= 0;
    let steer = canDrive ? clamp(inp.steer || 0, -1, 1) : 0;
    if (this.fx.invert > 0) steer = -steer;
    const throttle = canDrive && inp.throttle;
    const brake = canDrive && inp.brake;
    const top = this.topSpeed();

    // Longitudinal.
    if (this.fx.freeze > 0) {
      this.speed *= Math.exp(-8 * dt);
    } else if (this.spinTime > 0) {
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
      } else if (this.grounded && !this.loop && !this.drifting && this.speed > 12 && Math.abs(steer) > 0.2) {
        this.drifting = true;
        this.driftDir = Math.sign(steer);
        this.driftCharge = 0;
        this.vy = 3.6;
        this.grounded = false;
        this.emit('hop');
      }
    }
    this.prevDrift = driftPressed;

    const offSlow = this.surface === 'off' && this.boostTime <= 0 && this.fx.tires <= 0 && this.speed < 14;
    if (this.drifting && (!driftPressed || this.speed < 9 || this.spinTime > 0 || this.fx.freeze > 0 || offSlow)) {
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
      if (this.grounded) this.driftCharge += dt * (into > 0.3 ? 1.35 : 1) * (this.fx.tires > 0 ? 2 : 1);
    } else {
      yawRate = P.turn * steer * (1 - 0.22 * clamp(this.speed / P.maxSpeed, 0, 1));
    }
    if (!this.grounded) yawRate *= 0.6;
    if (this.spinTime <= 0) this.yaw = wrapAngle(this.yaw - yawRate * sf * dt);

    if (this.loop) return this.stepLoop(dt);

    // Adhérence : la trajectoire rattrape le cap plus ou moins vite.
    const grip = this.drifting ? 2.6 : this.grounded ? 11 : 1.2;
    this.moveYaw = lerpAngle(this.moveYaw, this.yaw, 1 - Math.exp(-grip * dt));

    // Rendu : pivot visuel en dérapage, toupie quand on est touché.
    if (this.spinTime > 0) this.visYaw = wrapAngle(this.visYaw + dt * (this.spinKind ? 9 : 13));
    else this.visYaw = lerpAngle(this.visYaw, this.yaw + (this.drifting ? -this.driftDir * 0.42 : 0), 1 - Math.exp(-12 * dt));

    this.stepGround(dt);
  }

  stepGround(dt) {
    const T = this.track;
    const q = this.q;

    // Déplacement horizontal.
    const decay = Math.exp(-(this.chaos ? 2.2 : 3.5) * dt);
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

    // Entrée dans un looping ?
    if (this.speed > 0 && T.loops.length) {
      const hitLoop = T.loopEntered(q, this.x, this.y, this.z);
      if (hitLoop) return this.enterLoop(hitLoop.loop, hitLoop.along, q.d);
    }

    const lim = q.hw + T.margin;
    const ad = Math.abs(q.d);
    const wallLike = T.edge === 'wall' || this.fx.wings > 0;

    if (ad > lim - KART_RADIUS) {
      if (wallLike) {
        // Mur (ou ailes au-dessus du vide) : on replace le kart et on renvoie la vitesse vers la piste.
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

    // Vertical. Gravité : modifiée par l'option chaos et la gravité lunaire.
    const g = GRAVITY * this.gravMul * (this.fx.lowGrav > 0 ? 0.3 : 1) * (this.fx.wings > 0 && this.vy < 0 ? 0.5 : 1);
    const groundY = q.y;
    if (this.grounded) {
      if (groundY < this.y - 0.7) {
        // Le sol se dérobe (bosse, fin de tremplin) : on décolle.
        this.grounded = false;
        this.vy = this.vyGround + (wasRamp > 0.6 ? 5 + this.speed * 0.12 : 0);
        if (this.chaos && wasRamp > 0.6) this.vy += 4;
        this.fromRamp = wasRamp > 0.6;
        this.airTime = 0;
        this.trick = false;
        if (this.fromRamp) this.emit('jump');
      } else {
        this.vyGround = clamp((groundY - this.y) / dt, -30, 30);
        this.y = groundY;
        // Gravité lunaire : petits rebonds incontrôlés.
        if (this.fx.lowGrav > 0 && Math.random() < dt * 1.5) { this.vy = 6; this.grounded = false; }
      }
    }
    if (!this.grounded) {
      this.airTime += dt;
      this.vy -= g * dt;
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
      } else if (!wallLike && ad > lim + 0.3 && this.y < groundY - 1.5) {
        this.startFall();
        return;
      }
    }

    if (this.grounded && this.surface === 'road') this.lastSafeS = q.s;
    this.pitch = this.grounded ? Math.atan(q.slope || 0) : this.pitch * 0.98;

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

  // ------------------------------------------------------------ loopings

  enterLoop(loop, along, d) {
    this.loop = loop;
    this.prog += this.track.deltaS(this.s, loop.s0 + along);
    this.s = loop.s0 + along;
    this.d = clamp(d, -this.track.hw[loop.i0] + 1, this.track.hw[loop.i0] - 1);
    this.grounded = true;
    this.vy = 0;
    this.drifting = false;
    this.emit('loop');
  }

  // Dans le looping, le kart suit la route : la gravité le freine en montée,
  // et s'il n'a plus assez de vitesse en haut, il décroche.
  stepLoop(dt) {
    const T = this.track;
    const L = this.loop;
    const len = L.s1 - L.s0;
    let rel = clamp(wrapAngle(this.yaw - L.yaw), -0.7, 0.7);
    this.yaw = L.yaw + rel;
    this.moveYaw = this.yaw;
    if (this.spinTime > 0) this.visYaw = wrapAngle(this.visYaw + dt * 13);
    else this.visYaw = this.yaw;

    const th = ((this.s - L.s0) / len) * Math.PI * 2;
    this.speed -= LOOP_G * Math.sin(th) * dt;
    // Accrochage : v²/R doit compenser la gravité quand on est la tête en bas.
    const need = LOOP_G * -Math.cos(th) * L.R;
    if (this.speed * this.speed < need || this.speed < 2) return this.loopFail();

    const ds = this.speed * Math.cos(rel) * dt;
    this.s += ds;
    this.d -= this.speed * Math.sin(rel) * dt;
    const hw = T.hw[L.i0] - 1;
    if (Math.abs(this.d) > hw) {
      this.d = Math.sign(this.d) * hw;
      rel *= -0.3;
      this.yaw = L.yaw + rel;
      this.speed *= 0.97;
    }
    this.prog += ds;
    this.pitch = th;
    this.surface = 'road';
    this.grounded = true;

    if (this.s >= L.s1) return this.exitLoop(L.i1, L.s1);
    if (this.s <= L.s0) return this.exitLoop(L.i0, L.s0);
    const p = T.pointAt(this.s, this.d, this.pt);
    this.x = p.x; this.y = p.y; this.z = p.z;
  }

  exitLoop(idx, s) {
    const T = this.track;
    this.loop = null;
    const p = T.pointAt(s, this.d, this.pt);
    this.x = p.x; this.y = p.y; this.z = p.z;
    this.s = s;
    this.idx = idx;
    this.pitch = 0;
    T.query(this.x, this.y, this.z, idx, this.q);
    this.idx = this.q.i;
  }

  loopFail() {
    const T = this.track;
    const L = this.loop;
    this.loop = null;
    const back = L.s0 - 25;
    this.prog += T.deltaS(this.s, back);
    const p = T.pointAt(back, this.d, this.pt);
    this.x = p.x; this.y = p.y + 1; this.z = p.z;
    this.s = T.wrapS(back);
    this.yaw = this.moveYaw = this.visYaw = L.yaw;
    this.speed = 6;
    this.pitch = 0;
    this.grounded = false;
    this.vy = 0;
    this.invuln = 1.5;
    this.idx = -1;
    T.query(this.x, this.y, this.z, -1, this.q);
    this.idx = this.q.i;
    this.emit('loopFail');
  }

  // ------------------------------------------------------------ chutes

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
    let s = this.lastSafeS - 6;
    if (T.pointAt(s).loop) s -= 40;
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

  // Heurte les autres karts (positions affichées). others : [{x, y, z, weight, star, ghost, vx, vz}]
  collide(others) {
    if (this.fx.ghost > 0 || this.loop) return;
    for (const o of others) {
      if (o.ghost) continue;
      const dx = this.x - o.x;
      const dz = this.z - o.z;
      if (Math.abs(this.y - o.y) > 2.2 * (o.giant || this.fx.giant > 0 ? 2 : 1)) continue;
      const d = Math.hypot(dx, dz);
      const sizeMe = this.smallTime > 0 ? 0.75 : this.fx.giant > 0 ? 2 : 1;
      const sizeO = o.giant ? 2 : o.small ? 0.75 : 1;
      const min = KART_RADIUS * (sizeMe + sizeO);
      if (d >= min || d < 1e-3) continue;
      const nx = dx / d;
      const nz = dz / d;
      const push = min - d;
      const ow = o.weight * (o.giant ? 4 : 1);
      let share = ow / (ow + this.p.weight);
      if (this.starTime > 0) share = 0.05;
      else if (o.star) share = 1;
      this.x += nx * push * share;
      this.z += nz * push * share;
      let kick = (4 + push * 10) * share * 1.6;
      // Mode tamponneuse : chocs violents, et les gros impacts envoient en tonneau.
      if (this.chaos) {
        const relV = Math.hypot((o.vx || 0) - Math.sin(this.moveYaw) * this.speed, (o.vz || 0) - Math.cos(this.moveYaw) * this.speed);
        kick = (8 + relV * 0.9) * share * 1.8;
        if (relV * share > 11 && this.spinTime <= 0) this.hit('flip');
        else if (this.grounded) { this.vy = 2 + relV * share * 0.25; this.grounded = false; }
      }
      this.ex += nx * kick;
      this.ez += nz * kick;
      if (share > 0.4) this.speed *= this.chaos ? 0.9 : 0.97;
      this.emit('bump', o);
    }
  }
}
