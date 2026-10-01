// Rendu 3D d'une ville du mode police contre voleurs, d'après le plan logique (city.js).

import * as THREE from './three.js';
import * as TX from './textures.js';
import { models, instanceSync } from './assets.js';
import { makeRng, hashString } from './util.js';

const LOOKS = {
  city: {
    sky: ['#5fa8ff', '#dcebff'], fog: ['#cfe0f2', 220, 700], sun: 1.6, hemi: ['#ffffff', '#7a8494', 1.1],
    asphalt: '#3a3d44', sidewalk: '#a9adb5', lot: '#5b5f68', grass: '#5fae4a', plaza: '#c9c2b2', yard: '#6e6a62',
    buildings: ['commercial/building-a', 'commercial/building-b', 'commercial/building-c', 'commercial/building-d', 'commercial/building-e', 'commercial/building-f', 'commercial/building-g', 'commercial/building-h', 'commercial/building-i', 'commercial/building-j', 'commercial/building-k', 'commercial/building-l', 'commercial/building-skyscraper-a', 'commercial/building-skyscraper-b', 'commercial/building-skyscraper-c'],
  },
  industrial: {
    sky: ['#8aa6c0', '#e4ddd0'], fog: ['#d9d2c4', 200, 650], sun: 1.4, hemi: ['#fff6e8', '#6d6a60', 1.1],
    asphalt: '#3e4046', sidewalk: '#9a978d', lot: '#5f5c55', grass: '#7c9a52', plaza: '#b3ab98', yard: '#77726a',
    buildings: ['industrial/building-a', 'industrial/building-b', 'industrial/building-c', 'industrial/building-d', 'industrial/building-e', 'industrial/building-f', 'industrial/building-g', 'industrial/building-h', 'industrial/building-i', 'industrial/building-j', 'industrial/building-k', 'industrial/building-l'],
  },
  port: {
    sky: ['#ff8f6a', '#ffe0c0'], fog: ['#f4cfb4', 200, 650], sun: 1.4, hemi: ['#fff0e0', '#5a6a8a', 1.1],
    asphalt: '#3b3f47', sidewalk: '#a39d93', lot: '#5d5a56', grass: '#6a9a4c', plaza: '#bdb3a0', yard: '#706b64',
    buildings: ['industrial/building-m', 'industrial/building-n', 'industrial/building-o', 'industrial/building-p', 'industrial/building-q', 'industrial/building-r', 'industrial/building-s', 'industrial/building-t', 'industrial/building-a', 'industrial/building-b'],
  },
};

function skyDome(top, bottom) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float t = clamp(vP.y*1.6+0.25,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, t),1.0); }',
  });
  return new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
}

// Sol de toute la ville peint dans une seule texture : rues, marquage, trottoirs, parcs...
function groundTexture(city, L) {
  const { W, D, S, B, blocks, cols, rows, streetX, streetZ } = city;
  const size = 2048;
  const k = size / Math.max(W, D);
  const c = document.createElement('canvas');
  c.width = Math.round(W * k);
  c.height = Math.round(D * k);
  const g = c.getContext('2d');
  const X = (x) => (x + W / 2) * k;
  const Z = (z) => (z + D / 2) * k;
  g.fillStyle = L.sidewalk;
  g.fillRect(0, 0, c.width, c.height);
  // Rues.
  g.fillStyle = L.asphalt;
  for (let i = 0; i <= cols; i++) g.fillRect(X(streetX(i) - S / 2), 0, S * k, c.height);
  for (let j = 0; j <= rows; j++) g.fillRect(0, Z(streetZ(j) - S / 2), c.width, S * k);
  // Pâtés.
  const SW = city.sidewalk;
  for (const b of blocks) {
    const x0 = X(b.cx - B / 2 + SW);
    const z0 = Z(b.cz - B / 2 + SW);
    const w = (B - 2 * SW) * k;
    if (b.type === 'W') { g.clearRect(X(b.cx - B / 2 - S / 2 + 0.5), Z(b.cz - B / 2), (B + S - 1) * k, B * k); continue; }
    g.fillStyle = b.type === 'B' ? L.lot : b.type === 'P' || b.type === 'J' ? L.grass : b.type === 'Q' ? L.plaza : L.yard;
    g.fillRect(x0, z0, w, w);
  }
  // Marquage : lignes centrales en pointillés, passages piétons aux carrefours.
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = Math.max(1.5, 0.3 * k);
  g.setLineDash([3 * k, 3 * k]);
  for (let i = 0; i <= cols; i++) { g.beginPath(); g.moveTo(X(streetX(i)), 0); g.lineTo(X(streetX(i)), c.height); g.stroke(); }
  for (let j = 0; j <= rows; j++) { g.beginPath(); g.moveTo(0, Z(streetZ(j))); g.lineTo(c.width, Z(streetZ(j))); g.stroke(); }
  g.setLineDash([]);
  g.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j <= rows; j++) {
      const x = streetX(i);
      const z = streetZ(j);
      for (let s = -S / 2 + 1.5; s < S / 2 - 1; s += 2.2) {
        g.fillRect(X(x + s), Z(z - S / 2 - 3), 1.1 * k, 2.4 * k);
        g.fillRect(X(x + s), Z(z + S / 2 + 0.6), 1.1 * k, 2.4 * k);
        g.fillRect(X(x - S / 2 - 3), Z(z + s), 2.4 * k, 1.1 * k);
        g.fillRect(X(x + S / 2 + 0.6), Z(z + s), 2.4 * k, 1.1 * k);
      }
      // Le carrefour lui-même reste uni.
      g.fillStyle = L.asphalt;
      g.fillRect(X(x - S / 2), Z(z - S / 2), S * k, S * k);
      g.fillStyle = 'rgba(255,255,255,0.8)';
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function labelSprite(text, color = '#ffffff', bg = 'rgba(10,12,18,0.75)') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(8, 8, 496, 112, 24);
  g.fill();
  g.fillStyle = color;
  g.font = '800 64px "Barlow Condensed", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(12, 3, 1);
  return s;
}

export async function buildCityView(city) {
  const def = city.def;
  const L = LOOKS[def.theme] || LOOKS.city;
  const group = new THREE.Group();
  const animated = [];
  const rand = makeRng(hashString(def.id) + 7);
  const { W, D, B, S, blocks } = city;

  const sky = skyDome(L.sky[0], L.sky[1]);
  group.add(sky);
  group.add(new THREE.HemisphereLight(L.hemi[0], L.hemi[1], L.hemi[2]));
  const sun = new THREE.DirectionalLight('#fff1dd', L.sun);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 10; sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  group.add(sun, sun.target);
  const sunDir = new THREE.Vector3(-0.45, 1, 0.3).normalize();

  // Sol.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: groundTexture(city, L), roughness: 0.95, alphaTest: 0.5 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: def.theme === 'port' ? '#2d7fb8' : L.lot, roughness: 1 }));
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = def.theme === 'port' ? -1.2 : -0.08;
  group.add(outside);
  if (blocks.some((b) => b.type === 'W')) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.5, D * 1.5), new THREE.MeshStandardMaterial({ color: '#2d86c4', roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.9 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -1.2;
    group.add(water);
    animated.push((dt, t) => { water.position.y = -1.2 + Math.sin(t * 0.8) * 0.12; });
  }

  // Enceinte.
  const wallTex = TX.wallTexture('#d8d8de', '#2f6bff');
  wallTex.repeat.set(40, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7 });
  for (const [x, z, w, d] of [[0, -D / 2 - 1, W + 4, 2], [0, D / 2 + 1, W + 4, 2], [-W / 2 - 1, 0, 2, D], [W / 2 + 1, 0, 2, D]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 6, d), wallMat);
    m.position.set(x, 3, z);
    m.receiveShadow = true;
    group.add(m);
  }

  // Modèles Kenney utilisés.
  const lib = await models([...L.buildings, 'industrial/shipping-container-a', 'industrial/shipping-container-b', 'industrial/shipping-container-c',
    'roads/light-curved', 'racing/pitsGarage', 'platformer/flowers', 'platformer/flowers-tall', 'commercial/building-skyscraper-d', 'commercial/building-skyscraper-e']);

  // Immeubles : quatre bâtiments par pâté, sur un socle sombre qui bouche les interstices.
  const baseMat = new THREE.MeshStandardMaterial({ color: '#2e3138', roughness: 0.9 });
  const SW = city.sidewalk;
  const f = B - 2 * SW;
  for (const b of blocks) {
    if (b.type === 'B') {
      const base = new THREE.Mesh(new THREE.BoxGeometry(f, 4, f), baseMat);
      base.position.set(b.cx, 2, b.cz);
      base.castShadow = true;
      base.receiveShadow = true;
      group.add(base);
      const q = f / 2;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const m = lib.get(L.buildings[Math.floor(rand() * L.buildings.length)]);
        const k = (q * 0.98) / Math.max(m.size.x, m.size.z);
        const o = instanceSync(m, { scale: k });
        o.position.set(b.cx + (dx * q) / 2, 0, b.cz + (dz * q) / 2);
        // Façade tournée vers la rue la plus proche.
        o.rotation.y = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : dz > 0 ? 0 : Math.PI;
        if (rand() < 0.5) o.rotation.y = dx > 0 ? Math.PI / 2 : -Math.PI / 2;
        group.add(o);
      }
    } else if (b.type === 'Y') {
      for (const bx of b.boxes) {
        const stacked = bx.h[1] > 2;
        for (let level = 0; level < (stacked ? 2 : 1); level++) {
          const m = lib.get(`industrial/shipping-container-${'abc'[Math.floor(rand() * 3)]}`);
          const o = instanceSync(m, {});
          const longX = bx.h[0] > bx.h[2];
          const modelLongX = m.size.x > m.size.z;
          if (longX !== modelLongX) o.rotation.y = Math.PI / 2;
          const sx = (longX === modelLongX ? bx.h[0] * 2 : bx.h[2] * 2) / m.size.x;
          const sz = (longX === modelLongX ? bx.h[2] * 2 : bx.h[0] * 2) / m.size.z;
          o.scale.set(sx, 2.6 / m.size.y, sz);
          o.position.set(bx.c[0], level * 2.6, bx.c[2]);
          group.add(o);
        }
      }
    } else if (b.type === 'P' || b.type === 'Q') {
      for (let k = 0; k < 10; k++) {
        const o = instanceSync(lib.get(rand() < 0.5 ? 'platformer/flowers' : 'platformer/flowers-tall'), { height: 1.2 + rand() });
        o.position.set(b.cx + (rand() - 0.5) * (f - 6), 0, b.cz + (rand() - 0.5) * (f - 6));
        group.add(o);
      }
    }
    // Lampadaires aux coins des trottoirs.
    if (b.type !== 'W') {
      for (const [dx, dz] of [[-1, -1], [1, 1]]) {
        const o = instanceSync(lib.get('roads/light-curved'), { height: 8 });
        o.position.set(b.cx + dx * (B / 2 - 1), 0, b.cz + dz * (B / 2 - 1));
        o.rotation.y = dx > 0 ? Math.PI : 0;
        group.add(o);
      }
    }
  }

  // Silhouette de ville au loin, derrière l'enceinte.
  const sky1 = lib.get('commercial/building-skyscraper-d');
  const sky2 = lib.get('commercial/building-skyscraper-e');
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    const r = Math.max(W, D) * 0.75 + rand() * 120;
    const o = instanceSync(rand() < 0.5 ? sky1 : sky2, { height: 40 + rand() * 60 });
    o.position.set(Math.cos(a) * r, def.theme === 'port' ? -1 : 0, Math.sin(a) * r);
    if (def.theme === 'port' && o.position.z > D / 2) continue;
    group.add(o);
  }

  // Tremplins.
  const rampMat = new THREE.MeshStandardMaterial({ map: TX.rampTexture(), roughness: 0.6 });
  for (const r of city.ramps) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(r.h[0] * 2, r.h[1] * 2, r.h[2] * 2), rampMat);
    m.position.set(...r.c);
    m.rotation.set(r.pitch, r.yaw, 0, 'YXZ');
    m.receiveShadow = true;
    group.add(m);
  }

  // Prison : murs, enseigne, bouton de libération.
  if (city.prison) {
    const pr = city.prison;
    const fence = new THREE.MeshStandardMaterial({ map: TX.wallTexture('#9aa0aa', '#30343c'), roughness: 0.6 });
    const block = blocks.find((b) => b.type === 'J');
    for (const bx of block.boxes) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bx.h[0] * 2, bx.h[1] * 2, bx.h[2] * 2), fence);
      m.position.set(...bx.c);
      m.castShadow = true;
      group.add(m);
    }
    const sign = labelSprite('PRISON', '#ff5a5a');
    sign.position.set(pr.c[0], 8, pr.c[2]);
    group.add(sign);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.2, 32), new THREE.MeshStandardMaterial({ color: '#ff3b3b', emissive: '#ff3b3b', emissiveIntensity: 0.8 }));
    pad.position.set(pr.button[0], 0.1, pr.button[2]);
    group.add(pad);
    const key = labelSprite('🔓 LIBÉRER', '#ffffff', 'rgba(200,30,30,0.85)');
    key.position.set(pr.button[0], 4, pr.button[2]);
    group.add(key);
    animated.push((dt, t) => { pad.material.emissiveIntensity = 0.5 + Math.sin(t * 5) * 0.4; });
  }

  // Planques.
  for (const h of city.hideouts) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(h.r, 0.3, 8, 48), new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#ffb000', emissiveIntensity: 1.4 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(h.p[0], 0.2, h.p[2]);
    group.add(ring);
    const s = labelSprite('$ PLANQUE', '#1a1200', 'rgba(255,210,63,0.92)');
    s.position.set(h.p[0], 5, h.p[2]);
    group.add(s);
    animated.push((dt, t) => { ring.rotation.z += dt * 0.5; s.position.y = 5 + Math.sin(t * 2) * 0.3; });
  }

  // Sorties (fermées en rouge, ouvertes en vert).
  const exitMats = [];
  for (const e of city.exits) {
    const mat = new THREE.MeshStandardMaterial({ color: '#ff3b3b', emissive: '#ff3b3b', emissiveIntensity: 1 });
    exitMats.push(mat);
    const arch = new THREE.Group();
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1, 7, 1), mat);
      post.position.set(s * e.r, 3.5, 0);
      arch.add(post);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(e.r * 2 + 1, 1, 1), mat);
    top.position.y = 7;
    arch.add(top);
    arch.position.set(e.p[0], 0, e.p[2]);
    // L'arche fait face au centre de la ville.
    arch.rotation.y = Math.abs(e.p[0]) > Math.abs(e.p[2]) ? Math.PI / 2 : 0;
    group.add(arch);
    const s = labelSprite('SORTIE', '#ffffff', 'rgba(20,120,60,0.9)');
    s.position.set(e.p[0], 9.5, e.p[2]);
    group.add(s);
  }

  // Sacs d'argent.
  const sackMat = new THREE.MeshStandardMaterial({ color: '#8a6a3a', roughness: 0.8 });
  const bagMeshes = city.bagSpots.map((p, i) => {
    const g2 = new THREE.Group();
    const sack = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10), sackMat);
    sack.scale.y = 1.2;
    sack.position.y = 1;
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 0.5, 8), sackMat);
    tie.position.y = 2.1;
    const dollar = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.emoteTexture('💰'), transparent: true, depthWrite: false }));
    dollar.scale.set(2, 2, 1);
    dollar.position.y = 3.3;
    g2.add(sack, tie, dollar);
    g2.position.set(p[0], 0, p[2]);
    g2.userData.ph = i;
    group.add(g2);
    return g2;
  });
  animated.push((dt, t) => bagMeshes.forEach((m) => { m.rotation.y += dt; m.position.y = 0.3 + Math.sin(t * 2.5 + m.userData.ph) * 0.25; }));

  const focus = new THREE.Vector3();
  return {
    group,
    sky,
    fog: new THREE.Fog(L.fog[0], L.fog[1], L.fog[2]),
    background: new THREE.Color(L.fog[0]),
    setBags(mask) { bagMeshes.forEach((m, i) => { m.visible = mask[i] === '1'; }); },
    setExits(open) { for (const m of exitMats) { m.color.set(open ? '#38d96b' : '#ff3b3b'); m.emissive.set(open ? '#38d96b' : '#ff3b3b'); } },
    update(dt, t, camPos, target) {
      for (const fn of animated) fn(dt, t);
      sky.position.copy(camPos);
      if (target) {
        focus.copy(target);
        sun.position.copy(focus).addScaledVector(sunDir, 160);
        sun.target.position.copy(focus);
      }
    },
  };
}
