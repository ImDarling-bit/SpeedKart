// Particules (étincelles de dérapage, poussière, flammes de turbo, explosions)
// et modèles des objets posés ou lancés sur la piste.

import * as THREE from './three.js';
import { softDot } from './textures.js';

export class Particles {
  constructor(scene, max = 500) {
    this.scene = scene;
    this.pool = [];
    this.live = [];
    const tex = softDot();
    for (let i = 0; i < max; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.visible = false;
      scene.add(s);
      this.pool.push({ s, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 1, s1: 0, g: 0, drag: 0 });
    }
    this.free = [...this.pool];
  }

  emit(x, y, z, o = {}) {
    const p = this.free.pop();
    if (!p) return;
    p.s.position.set(x, y, z);
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = 0;
    p.max = o.life || 0.5;
    p.s0 = o.size ?? 0.6;
    p.s1 = o.size1 ?? 0;
    p.g = o.gravity || 0;
    p.drag = o.drag || 0;
    p.s.material.color.set(o.color || '#ffffff');
    p.s.material.blending = o.normal ? THREE.NormalBlending : THREE.AdditiveBlending;
    p.a0 = o.alpha ?? 1;
    p.s.material.opacity = p.a0;
    p.s.scale.setScalar(p.s0);
    p.s.visible = true;
    this.live.push(p);
  }

  burst(x, y, z, n, o = {}) {
    const sp = o.speed || 8;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - u * u);
      this.emit(x, y, z, { ...o, vx: Math.cos(a) * r * sp, vy: Math.abs(u) * sp * (o.up ?? 1), vz: Math.sin(a) * r * sp, life: (o.life || 0.6) * (0.6 + Math.random() * 0.8) });
    }
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life += dt;
      if (p.life >= p.max) {
        p.s.visible = false;
        this.live.splice(i, 1);
        this.free.push(p);
        continue;
      }
      const k = p.life / p.max;
      p.vy -= p.g * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += p.vz * dt;
      p.s.scale.setScalar(p.s0 + (p.s1 - p.s0) * k);
      p.s.material.opacity = p.a0 * (1 - k);
    }
  }
}

// ------------------------------------------------------------ objets sur la piste

const mats = {};
function mat(key, opts) {
  if (!mats[key]) mats[key] = new THREE.MeshStandardMaterial(opts);
  return mats[key];
}

export function entityMesh(type) {
  const g = new THREE.Group();
  if (type === 'banana') {
    const peel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.2, 8, 16, Math.PI * 1.1), mat('banana', { color: '#ffd92e', roughness: 0.5 }));
    peel.rotation.set(0, 0, Math.PI * 0.95);
    peel.position.y = 0.6;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat('bananaTip', { color: '#5a3d1a' }));
    tip.position.set(0.55, 0.62, 0);
    g.add(peel, tip);
  } else if (type === 'green' || type === 'red') {
    const color = type === 'green' ? '#2ecc40' : '#e8352e';
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.8), mat(type, { color, roughness: 0.35 }));
    shell.position.y = 0.2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.14, 8, 20), mat('shellRim', { color: '#fff7e0', roughness: 0.4 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.22;
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.5, 0.2, 16), mat('shellBottom', { color: '#fff1c2' }));
    bottom.position.y = 0.1;
    g.add(shell, rim, bottom);
    g.userData.spin = true;
  } else if (type === 'crate') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), mat('crate', { color: '#b07a3a', roughness: 0.8 }));
    box.position.y = 1.2;
    const band = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.4, 2.46), mat('crateBand', { color: '#6b4420' }));
    band.position.y = 1.2;
    g.add(box, band);
  } else if (type === 'comet') {
    const core = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), mat('comet', { color: '#ffd27a', emissive: '#ff7a1f', emissiveIntensity: 2 }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: '#ff9a3a', blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(7);
    g.add(core, glow);
  } else if (type === 'bomb') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), mat('bomb', { color: '#1b1b22', roughness: 0.3, metalness: 0.3 }));
    body.position.y = 0.75;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.25, 10), mat('bombCap', { color: '#999' }));
    cap.position.y = 1.55;
    const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: '#ffaa33', blending: THREE.AdditiveBlending, depthWrite: false }));
    spark.scale.setScalar(0.9);
    spark.position.y = 1.8;
    g.add(body, cap, spark);
    g.userData.spark = spark;
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
