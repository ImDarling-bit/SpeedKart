// Affichage d'un kart : modèle, roues, inclinaisons, et effets (dérapage, turbo, bouclier, étoile...).

import * as THREE from './three.js';
import { instance } from './assets.js';
import { nameTexture, softDot } from './textures.js';
import { F } from './kart.js';

const SPARK_COLORS = ['#ffffff', '#38b6ff', '#ff9a1f', '#c34bff'];

export class KartView {
  constructor(vehicle, { name = '', showName = false, fx = null } = {}) {
    this.vehicle = vehicle;
    this.fx = fx;
    this.root = new THREE.Group(); // position + cap
    this.body = new THREE.Group(); // tangage, roulis, sauts, toupie
    this.root.add(this.body);
    this.wheels = [];
    this.spin = 0;
    this.trickSpin = 0;
    this.tumble = 0;
    this.sparkTimer = 0;
    this.t = 0;
    this.materials = [];

    if (showName && name) {
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(name), transparent: true, depthWrite: false, depthTest: false }));
      tag.scale.set(4, 1, 1);
      tag.position.y = 3.2;
      tag.renderOrder = 10;
      this.root.add(tag);
      this.tag = tag;
    }

    // Bouclier.
    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.9, 20, 14),
      new THREE.MeshStandardMaterial({ color: '#5fd4ff', emissive: '#2a9fff', emissiveIntensity: 0.6, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.shield.position.y = 0.9;
    this.shield.visible = false;
    this.root.add(this.shield);

    // Flamme de turbo.
    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot('rgba(255,240,200,1)', 'rgba(255,120,0,0)'), color: '#ff9a2a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flame.visible = false;
    this.body.add(this.flame);
  }

  async load() {
    const v = this.vehicle;
    const model = await instance(v.model, { length: v.len, cloneMaterials: true });
    model.rotation.y = 0; // les modèles regardent vers +Z, comme la physique
    this.body.add(model);
    this.model = model;
    const size = model.userData.size;
    this.len = size.z;
    this.flame.position.set(0, size.y * 0.35, -size.z / 2 - 0.3);
    model.traverse((o) => {
      // Nœud de roue le plus haut (ses enfants tournent avec lui).
      if (/wheel/i.test(o.name) && !(o.parent && /wheel/i.test(o.parent.name))) {
        o.rotation.order = 'YXZ';
        this.wheels.push({ o, front: /front/i.test(o.name), base: o.rotation.x, acc: 0 });
      }
      if (o.isMesh) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) { this.materials.push(m); m.userData.baseEmissive = m.emissive ? m.emissive.clone() : null; }
      }
    });
    // Rayon des roues pour les faire tourner à la bonne vitesse.
    this.wheelR = Math.max(0.2, size.y * 0.18);
    return this;
  }

  // st : { x, y, z, yaw, pitch, spd, f, steer? }
  update(dt, st) {
    this.t += dt;
    const f = st.f | 0;
    this.root.position.set(st.x, st.y, st.z);
    this.root.rotation.y = st.yaw;

    // Toupie, culbute, figure.
    if (f & F.SPIN) this.tumble += dt * 9;
    else this.tumble = 0;
    if (f & F.TRICK) this.trickSpin = Math.min(Math.PI * 2, this.trickSpin + dt * 14);
    else if (this.trickSpin > 0 && !(f & F.AIR)) this.trickSpin = 0;

    const drift = f & F.DRIFT ? (f & F.DRIFT_R ? 1 : -1) : 0;
    this.body.rotation.set(
      -(st.pitch || 0) + ((f & F.SPIN) && (f & F.AIR) ? this.tumble : 0),
      0,
      drift * 0.12 + (f & F.TRICK ? this.trickSpin : 0),
    );
    const small = f & F.SMALL ? 0.6 : 1;
    const sc = this.body.scale.x + (small - this.body.scale.x) * Math.min(1, dt * 8);
    this.body.scale.setScalar(sc);

    // Roues.
    const spd = st.spd || 0;
    for (const w of this.wheels) {
      w.acc = (w.acc + (spd * dt) / this.wheelR) % (Math.PI * 2);
      w.o.rotation.x = w.base + w.acc;
      if (w.front) w.o.rotation.y = (st.steer || 0) * -0.4;
    }

    // Clignotement (invulnérable) ; masqué quand il tombe très bas.
    this.root.visible = !(f & F.BLINK) || Math.floor(this.t * 14) % 2 === 0;

    this.shield.visible = !!(f & F.SHIELD);
    if (this.shield.visible) this.shield.material.opacity = 0.22 + Math.sin(this.t * 6) * 0.06;

    // Étoile : couleurs qui défilent.
    const star = !!(f & F.STAR);
    if (star || this.wasStar) {
      const c = new THREE.Color().setHSL((this.t * 1.5) % 1, 1, 0.5);
      for (const m of this.materials) {
        if (!m.emissive) continue;
        if (star) { m.emissive.copy(c); m.emissiveIntensity = 0.8; } else if (m.userData.baseEmissive) { m.emissive.copy(m.userData.baseEmissive); m.emissiveIntensity = 1; }
      }
      this.wasStar = star;
    }

    // Turbo.
    const boost = !!(f & F.BOOST);
    this.flame.visible = boost;
    if (boost) {
      const s = 1.2 + Math.random() * 0.6;
      this.flame.scale.set(s, s, s);
    }

    // Particules : étincelles de dérapage, poussière, flammes.
    const fx = this.fx;
    if (!fx) return;
    this.sparkTimer -= dt;
    if (this.sparkTimer > 0) return;
    this.sparkTimer = 0.03;
    const lv = (f & F.LV1 ? 1 : 0) + (f & F.LV2 ? 2 : 0);
    const cy = Math.cos(st.yaw);
    const sy = Math.sin(st.yaw);
    const back = -(this.len || 2.4) / 2;
    const half = 0.7;
    const wx = (lat, lon) => st.x + sy * lon - cy * lat;
    const wz = (lat, lon) => st.z + cy * lon + sy * lat;
    if (drift && !(f & F.AIR)) {
      const color = SPARK_COLORS[lv];
      for (const lat of [-half, half]) {
        fx.emit(wx(lat, back), st.y + 0.25, wz(lat, back), {
          vx: (Math.random() - 0.5) * 4 - sy * 3, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 4 - cy * 3,
          color, size: lv ? 0.55 : 0.3, size1: 0.05, life: 0.25, gravity: 14,
        });
      }
    }
    if (boost) {
      fx.emit(wx(0, back - 0.4), st.y + 0.6, wz(0, back - 0.4), {
        vx: -sy * 6, vy: 1, vz: -cy * 6, color: '#ff8a1f', size: 1.0, size1: 0.2, life: 0.25,
      });
    }
    if (st.off && Math.abs(spd) > 8 && !(f & F.AIR)) {
      fx.emit(wx((Math.random() - 0.5) * 1.6, back), st.y + 0.3, wz(0, back), {
        vx: -sy * 2, vy: 2, vz: -cy * 2, color: st.dust || '#c8b38a', size: 0.6, size1: 1.8, life: 0.5, normal: true, alpha: 0.5,
      });
    }
    if (star) {
      fx.emit(st.x + (Math.random() - 0.5) * 2, st.y + 1 + Math.random(), st.z + (Math.random() - 0.5) * 2, {
        vy: 2, color: `hsl(${Math.floor(Math.random() * 360)},100%,65%)`, size: 0.5, life: 0.4,
      });
    }
  }

  dispose() {
    this.root.parent?.remove(this.root);
  }
}
