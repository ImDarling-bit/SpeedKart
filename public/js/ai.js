// Pilotes contrôlés par l'ordinateur (simulés chez l'hôte).

import { clamp, wrapAngle } from './util.js';

export class BotBrain {
  constructor(kart, rand, skill = 0.8) {
    this.kart = kart;
    this.rand = rand;
    this.skill = skill; // 0..1
    this.lane = (rand() - 0.5) * 0.8; // voie préférée (fraction de la demi-largeur)
    this.laneTimer = 0;
    this.itemDelay = 0;
    this.driftHold = 0;
    this.stuck = 0;
    this.reverse = 0;
    this.input = { steer: 0, throttle: true, brake: false, drift: false };
  }

  // ctx : { leaderHumanProg, karts, item, useItem(kind, back) }
  think(dt, ctx) {
    const k = this.kart;
    const T = k.track;
    const inp = this.input;
    const q = k.q;
    if (q.s === undefined) return inp;

    // Change de voie de temps en temps ; vise les boîtes et les tapis.
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.laneTimer = 1.5 + this.rand() * 3;
      const w = T.edge === 'void' ? 0.4 : 0.7;
      this.lane = clamp(this.lane + (this.rand() - 0.5) * 0.9, -w, w);
      for (const b of T.boosts) {
        const ahead = T.deltaS(q.s, b.s0);
        if (ahead > 0 && ahead < 80 && this.rand() < this.skill) this.lane = b.lane;
      }
    }

    const speed = Math.max(8, k.speed);
    const look = 10 + speed * 0.55;
    const target = T.pointAt(k.s + look, this.lane * T.hw[T.indexAt(k.s + look)]);
    const want = Math.atan2(target.x - k.x, target.z - k.z);
    const err = wrapAngle(want - k.yaw);
    // err > 0 : la cible est à gauche ; tourner à gauche = steer négatif.
    let steer = clamp(-err * 2.4, -1, 1);

    // Vitesse sûre : pour chaque virage à venir, vitesse max tenable (rayon x capacité de braquage),
    // augmentée de ce qu'on peut encore freiner d'ici là.
    const turn = T.turnAhead(k.s + 6, 30 + speed * 0.6);
    const sharp = Math.abs(turn);
    const caution = (T.edge === 'void' ? 0.78 : 0.92) * (0.9 + this.skill * 0.1);
    let safe = Infinity;
    for (let d = 0; d <= 70; d += 5) {
      const curv = Math.abs(T.turnAhead(k.s + d, 10)) / 10; // rad/m
      if (curv < 1e-3) continue;
      const vCurve = (k.p.turn * 0.95 * caution) / curv;
      safe = Math.min(safe, Math.sqrt(vCurve * vCurve + 2 * 28 * d));
    }
    inp.brake = false;
    inp.throttle = k.speed < safe;
    if (k.speed > safe + 4 && !k.drifting) inp.brake = true;

    const wantDrift = sharp > 0.7 && k.speed > 16 && this.rand() < 0.5 + this.skill * 0.5;
    if (k.drifting) {
      this.driftHold += dt;
      const same = Math.sign(-turn) === k.driftDir;
      // Trop tourné (il faudrait braquer dans l'autre sens) : on lâche le dérapage.
      const overturn = steer * k.driftDir < -0.35;
      inp.drift = same && !overturn && sharp > 0.3 && this.driftHold < 4.5;
      if (inp.drift) steer = clamp(steer * 1.2, -1, 1);
    } else {
      this.driftHold = 0;
      inp.drift = wantDrift && Math.abs(steer) > 0.3;
    }

    // Coincé contre un mur ou à contresens : marche arrière.
    if (!k.locked && k.spinTime <= 0 && Math.abs(k.speed) < 2) this.stuck += dt;
    else this.stuck = 0;
    if (this.stuck > 1.2) { this.reverse = 0.9; this.stuck = 0; }
    if (this.reverse > 0) {
      this.reverse -= dt;
      inp.throttle = false;
      inp.brake = true;
      steer = -steer;
      inp.drift = false;
    }

    inp.steer = steer;

    // Objets.
    if (ctx.item) {
      this.itemDelay -= dt;
      if (this.itemDelay <= 0) {
        const it = ctx.item;
        let use = this.rand() < 0.02 + this.skill * 0.03;
        let back = false;
        if (it === 'banana' || it === 'shield') { use = use || ctx.chased; back = true; }
        if ((it === 'green' || it === 'red' || it === 'bomb') && ctx.targetAhead) use = true;
        if (it === 'mushroom' || it === 'triple' || it === 'star') use = use || sharp < 0.3;
        if (use) {
          ctx.useItem(back);
          this.itemDelay = 0.8 + this.rand() * 2.5;
        }
      }
    } else {
      this.itemDelay = 1 + this.rand() * 2;
    }
    return inp;
  }
}

// Élastique : les bots derrière les humains accélèrent un peu, ceux trop devant ralentissent.
export function rubberBand(botProg, leaderHumanProg, trackLength) {
  if (leaderHumanProg == null) return 1;
  const gap = (leaderHumanProg - botProg) / trackLength; // en tours
  return clamp(1 + gap * 0.35, 0.9, 1.1);
}
