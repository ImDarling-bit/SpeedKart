// Affichage d'un véhicule : modèle teinté, roues, inclinaisons, effets (dérapage, turbo, bouclier,
// étoile, géant, fantôme, glace...), ballons de la bataille, bulles d'emotes. Sert à la course
// (cap + tangage) comme aux arènes (orientation 3D complète).

import * as THREE from './three.js';
import { instance } from './assets.js';
import { paintVehicle } from './paint.js';
import { nameTexture, softDot, emoteTexture } from './textures.js';
import { F } from './kart.js';
import { CF, CAR_HALF } from './car3d.js';

const SPARK_COLORS = ['#ffffff', '#38b6ff', '#ff9a1f', '#c34bff'];

// État visuel commun, à partir des drapeaux de la course ou des arènes.
export function visFromKart(f) {
  return {
    drift: f & F.DRIFT ? (f & F.DRIFT_R ? 1 : -1) : 0,
    lv: (f & F.LV1 ? 1 : 0) + (f & F.LV2 ? 2 : 0),
    boost: !!(f & F.BOOST), spin: !!(f & F.SPIN), flip: !!(f & F.FLIP), air: !!(f & F.AIR), trick: !!(f & F.TRICK),
    star: !!(f & F.STAR), shield: !!(f & F.SHIELD), small: !!(f & F.SMALL), giant: !!(f & F.GIANT),
    ghost: !!(f & F.GHOST), frozen: !!(f & F.FROZEN), wings: !!(f & F.WINGS), blink: !!(f & F.BLINK), lowGrav: !!(f & F.LOWGRAV),
  };
}

export function visFromCar(f) {
  return {
    drift: 0, lv: 0, boost: !!(f & CF.BOOST), spin: false, flip: false, air: !!(f & CF.AIR), trick: false,
    star: !!(f & CF.STAR), shield: !!(f & CF.SHIELD), small: !!(f & CF.SMALL), giant: !!(f & CF.GIANT),
    ghost: !!(f & CF.GHOST), frozen: !!(f & CF.FROZEN), wings: false, blink: !!(f & CF.BLINK), lowGrav: false,
    out: !!(f & CF.OUT), slide: !!(f & CF.SLIDE),
  };
}

export class KartView {
  // opts : { name, showName, fx, color (hex), tagColor, arena (orientation 3D) }
  constructor(vehicle, opts = {}) {
    this.vehicle = vehicle;
    this.fx = opts.fx || null;
    this.color = opts.color || null;
    this.arena = !!opts.arena;
    this.root = new THREE.Group(); // position + cap (ou orientation complète en arène)
    this.body = new THREE.Group(); // tangage, roulis, sauts, toupie, taille
    this.root.add(this.body);
    this.wheels = [];
    this.trickSpin = 0;
    this.tumble = 0;
    this.roll = 0;
    this.sparkTimer = 0;
    this.t = 0;
    this.materials = [];
    this.emoteUntil = 0;

    if (opts.showName && opts.name) {
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(opts.name, opts.tagColor || '#ffffff', opts.tagIcon || null), transparent: true, depthWrite: false, depthTest: false }));
      tag.scale.set(4, 1, 1);
      tag.position.y = 3.2;
      tag.renderOrder = 10;
      this.root.add(tag);
      this.tag = tag;
    }

    // Bulle d'emote.
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
    this.bubble.scale.set(2.6, 2.6, 1);
    this.bubble.position.y = 5;
    this.bubble.renderOrder = 11;
    this.bubble.visible = false;
    this.root.add(this.bubble);

    // Bouclier.
    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.9, 20, 14),
      new THREE.MeshStandardMaterial({ color: '#5fd4ff', emissive: '#2a9fff', emissiveIntensity: 0.6, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.shield.position.y = 0.9;
    this.shield.visible = false;
    this.body.add(this.shield);

    // Bloc de glace (pouvoir Gel).
    this.ice = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 2.2, 3.8),
      new THREE.MeshStandardMaterial({ color: '#bff3ff', emissive: '#4ad8ff', emissiveIntensity: 0.25, transparent: true, opacity: 0.45, roughness: 0.1, depthWrite: false }),
    );
    this.ice.position.y = 1;
    this.ice.visible = false;
    this.body.add(this.ice);

    // Ailes (pouvoir Ailes).
    this.wings = new THREE.Group();
    const wingMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.3, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.9), wingMat);
      w.position.set(s * 1.6, 1.1, -0.2);
      w.rotation.set(-Math.PI / 2, 0, s * 0.25);
      this.wings.add(w);
    }
    this.wings.visible = false;
    this.body.add(this.wings);

    // Flamme de turbo.
    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot('rgba(255,240,200,1)', 'rgba(255,120,0,0)'), color: '#ff9a2a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flame.visible = false;
    this.body.add(this.flame);

    // Ballons (bataille).
    this.balloons = new THREE.Group();
    this.root.add(this.balloons);
    this.balloonCount = 0;
  }

  async load() {
    const v = this.vehicle;
    const len = this.arena ? CAR_HALF[2] * 2.05 : v.len;
    const model = await instance(v.model, { length: len, cloneMaterials: true });
    this.body.add(model);
    this.model = model;
    const size = model.userData.size;
    this.len = size.z;
    this.flame.position.set(0, size.y * 0.35, -size.z / 2 - 0.3);
    paintVehicle(model, v.model, this.color);
    model.traverse((o) => {
      // Nœud de roue le plus haut (ses enfants tournent avec lui).
      if (/wheel/i.test(o.name) && !(o.parent && /wheel/i.test(o.parent.name))) {
        o.rotation.order = 'YXZ';
        this.wheels.push({ o, front: /front/i.test(o.name), base: o.rotation.x, acc: 0 });
      }
      if (o.isMesh) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) {
          this.materials.push(m);
          m.userData.baseEmissive = m.emissive ? m.emissive.clone() : null;
          m.userData.baseOpacity = m.opacity;
        }
      }
    });
    // Rayon des roues pour les faire tourner à la bonne vitesse.
    this.wheelR = Math.max(0.2, size.y * 0.18);
    return this;
  }

  setBalloons(n, color = '#ff4d6d') {
    if (n === this.balloonCount) return;
    this.balloonCount = n;
    this.balloons.clear();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.25, emissive: color, emissiveIntensity: 0.15 });
    const strMat = new THREE.LineBasicMaterial({ color: '#ffffff' });
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * 0.55;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), mat);
      b.scale.y = 1.2;
      const x = Math.sin(a) * 1.2;
      const y = 3.4 + Math.cos(a) * 0.4;
      b.position.set(x, y, -0.8);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1, -0.8), new THREE.Vector3(x, y - 0.6, -0.8)]), strMat);
      this.balloons.add(b, line);
    }
  }

  showEmote(text) {
    this.bubble.material.map = emoteTexture(text);
    this.bubble.material.needsUpdate = true;
    this.bubble.visible = true;
    this.emoteUntil = this.t + 2.6;
  }

  // st : { x, y, z, yaw, pitch | q, spd, vis, steer?, off?, dust? }
  update(dt, st) {
    this.t += dt;
    const vis = st.vis || {};
    if (st.q) {
      // Arène : orientation 3D complète ; le modèle se pose sous le centre de la coque.
      this.root.quaternion.set(st.q[0], st.q[1], st.q[2], st.q[3]);
      const dy = new THREE.Vector3(0, -CAR_HALF[1] - 0.05, 0).applyQuaternion(this.root.quaternion);
      this.root.position.set(st.x + dy.x, st.y + dy.y, st.z + dy.z);
      this.body.rotation.set(0, 0, 0);
    } else {
      this.root.position.set(st.x, st.y, st.z);
      this.root.rotation.set(0, st.yaw, 0);
      // Toupie, culbute, figure, tonneau.
      if (vis.spin) this.tumble += dt * 9; else this.tumble = 0;
      if (vis.trick) this.trickSpin = Math.min(Math.PI * 2, this.trickSpin + dt * 14);
      else if (this.trickSpin > 0 && !vis.air) this.trickSpin = 0;
      if (vis.flip) this.roll += dt * 11; else this.roll = 0;
      this.body.rotation.set(
        -(st.pitch || 0) + (vis.spin && vis.air && !vis.flip ? this.tumble : 0),
        0,
        (vis.drift || 0) * 0.12 + (vis.trick ? this.trickSpin : 0) + this.roll,
      );
    }
    const size = vis.giant ? 2 : vis.small ? 0.6 : 1;
    const sc = this.body.scale.x + (size - this.body.scale.x) * Math.min(1, dt * 6);
    this.body.scale.setScalar(sc);

    // Roues.
    const spd = st.spd || 0;
    for (const w of this.wheels) {
      w.acc = (w.acc + (spd * dt) / this.wheelR) % (Math.PI * 2);
      w.o.rotation.x = w.base + w.acc;
      if (w.front) w.o.rotation.y = (st.steer || 0) * -0.4;
    }

    // Clignotement (invulnérable), éliminé.
    this.root.visible = !vis.out && (!vis.blink || Math.floor(this.t * 14) % 2 === 0);

    this.shield.visible = !!vis.shield;
    if (this.shield.visible) this.shield.material.opacity = 0.22 + Math.sin(this.t * 6) * 0.06;
    this.ice.visible = !!vis.frozen;
    this.wings.visible = !!vis.wings;
    if (vis.wings) this.wings.children.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * (0.25 + Math.sin(this.t * 10) * 0.3); });
    if (this.bubble.visible && this.t > this.emoteUntil) this.bubble.visible = false;

    // Fantôme : translucide.
    const ghost = !!vis.ghost;
    if (ghost !== this.wasGhost) {
      for (const m of this.materials) {
        m.transparent = ghost || m.userData.baseOpacity < 1;
        m.opacity = ghost ? 0.3 : m.userData.baseOpacity;
        m.needsUpdate = true;
      }
      this.wasGhost = ghost;
    }

    // Étoile : couleurs qui défilent.
    const star = !!vis.star;
    if (star || this.wasStar) {
      const c = new THREE.Color().setHSL((this.t * 1.5) % 1, 1, 0.5);
      for (const m of this.materials) {
        if (!m.emissive) continue;
        if (star) { m.emissive.copy(c); m.emissiveIntensity = 0.8; } else if (m.userData.baseEmissive) { m.emissive.copy(m.userData.baseEmissive); m.emissiveIntensity = 1; }
      }
      this.wasStar = star;
    }

    // Turbo.
    this.flame.visible = !!vis.boost;
    if (vis.boost) {
      const s = 1.2 + Math.random() * 0.6;
      this.flame.scale.set(s, s, s);
    }

    // Particules : étincelles de dérapage, poussière, flammes.
    const fx = this.fx;
    if (!fx) return;
    this.sparkTimer -= dt;
    if (this.sparkTimer > 0) return;
    this.sparkTimer = 0.03;
    const back = new THREE.Vector3(0, 0.3, -(this.len || 2.4) / 2 * sc).applyQuaternion(this.root.quaternion).add(this.root.position);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
    if ((vis.drift || vis.slide) && !vis.air) {
      const color = SPARK_COLORS[vis.lv || 0];
      for (const s of [-0.7, 0.7]) {
        fx.emit(back.x + side.x * s, back.y, back.z + side.z * s, {
          vx: (Math.random() - 0.5) * 4 - fwd.x * 3, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 4 - fwd.z * 3,
          color, size: vis.lv ? 0.55 : 0.3, size1: 0.05, life: 0.25, gravity: 14,
        });
      }
    }
    if (vis.boost) {
      fx.emit(back.x - fwd.x * 0.4, back.y + 0.3, back.z - fwd.z * 0.4, {
        vx: -fwd.x * 6, vy: -fwd.y * 6 + 1, vz: -fwd.z * 6, color: '#ff8a1f', size: 1.0, size1: 0.2, life: 0.25,
      });
    }
    if (st.off && Math.abs(spd) > 8 && !vis.air) {
      fx.emit(back.x + side.x * (Math.random() - 0.5) * 1.6, back.y, back.z + side.z * (Math.random() - 0.5) * 1.6, {
        vx: -fwd.x * 2, vy: 2, vz: -fwd.z * 2, color: st.dust || '#c8b38a', size: 0.6, size1: 1.8, life: 0.5, normal: true, alpha: 0.5,
      });
    }
    if (star) {
      const p = this.root.position;
      fx.emit(p.x + (Math.random() - 0.5) * 2, p.y + 1 + Math.random(), p.z + (Math.random() - 0.5) * 2, {
        vy: 2, color: `hsl(${Math.floor(Math.random() * 360)},100%,65%)`, size: 0.5, life: 0.4,
      });
    }
    if (vis.lowGrav && Math.random() < 0.3) {
      const p = this.root.position;
      fx.emit(p.x, p.y + 0.5, p.z, { vy: 3, color: '#c9d4ff', size: 0.4, size1: 1, life: 0.8, normal: true, alpha: 0.5 });
    }
  }

  dispose() {
    this.root.parent?.remove(this.root);
  }
}
