// Rendu 3D des arènes (foot, tamponneuse, bataille), d'après les mêmes dimensions que la physique.

import * as THREE from './three.js';
import { RoundedBoxGeometry } from './three.js';
import { ARENAS } from './arena.js';
import { boostPads, battleBoxes } from './modes/arenagame.js';
import * as TX from './textures.js';
import { models, instanceSync } from './assets.js';
import { makeRng } from './util.js';
import { TEAM_COLORS } from './data/colors.js';

function skyDome(top, bottom) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float t = clamp(vP.y*1.6+0.25,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, t),1.0); }',
  });
  return new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
}

function lights(group, { sun = 1.6, hemi = ['#ffffff', '#556080', 1.1], night = false } = {}) {
  group.add(new THREE.HemisphereLight(hemi[0], hemi[1], hemi[2]));
  const d = new THREE.DirectionalLight(night ? '#c9d4ff' : '#fff1dd', sun);
  d.position.set(-60, 120, 40);
  d.castShadow = true;
  d.shadow.mapSize.set(2048, 2048);
  const sc = d.shadow.camera;
  sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 10; sc.far = 320;
  d.shadow.bias = -0.0004;
  d.shadow.normalBias = 0.04;
  group.add(d, d.target);
  return d;
}

// Murs du stade : translucides, quadrillés, teintés côté bleu / orange, ouverts aux buts.
function arenaWallMaterial(A) {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      Z: { value: A.Z }, R: { value: A.R }, gw: { value: A.goal.w }, gh: { value: A.goal.h },
      blue: { value: new THREE.Color(TEAM_COLORS.blue) }, orange: { value: new THREE.Color(TEAM_COLORS.orange) },
    },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `
      uniform float Z; uniform float R; uniform float gw; uniform float gh; uniform vec3 blue; uniform vec3 orange;
      varying vec3 vW;
      void main(){
        if (abs(vW.x) < gw && vW.y < gh && abs(vW.z) > Z - R - 0.5) discard;
        float low = smoothstep(R * 1.1, 0.0, vW.y);
        vec3 team = vW.z < 0.0 ? blue : orange;
        vec3 base = mix(vec3(0.75, 0.8, 0.95), team, 0.55);
        vec2 g = abs(fract(vec2(vW.x + vW.z, vW.y) / 4.0) - 0.5);
        float line = 1.0 - smoothstep(0.0, 0.04, min(g.x, g.y));
        vec3 col = mix(base * 0.55, base * 1.3, line);
        float a = mix(0.28, 0.85, low) + line * 0.25;
        gl_FragColor = vec4(col, a);
      }`,
  });
}

function netTexture(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = color;
  g.lineWidth = 3;
  for (let i = 0; i <= 64; i += 16) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

async function rocketArena(group, animated) {
  const A = ARENAS.rocket;
  const sky = skyDome('#0b1440', '#3a3a7a');
  group.add(sky);
  lights(group, { sun: 1.4, hemi: ['#dfe6ff', '#304060', 1.2] });

  // Sol (partie plate) avec le marquage.
  const fx = A.X - A.R;
  const fz = A.Z - A.R;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fx * 2, fz * 2), new THREE.MeshStandardMaterial({ map: TX.fieldTexture(fx, fz), roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  floor.receiveShadow = true;
  group.add(floor);

  // Enceinte arrondie.
  const walls = new THREE.Mesh(new RoundedBoxGeometry(A.X * 2, A.H, A.Z * 2, 10, A.R), arenaWallMaterial(A));
  walls.position.y = A.H / 2;
  walls.renderOrder = 2;
  group.add(walls);
  // Partie basse opaque (pelouse qui remonte dans les virages).
  const lower = new THREE.Mesh(new RoundedBoxGeometry(A.X * 2, A.H, A.Z * 2, 10, A.R), new THREE.MeshStandardMaterial({ color: '#3f9a3a', side: THREE.BackSide, roughness: 1 }));
  lower.position.y = A.H / 2;
  lower.material.onBeforeCompile = (sh) => {
    sh.uniforms.Z = { value: A.Z };
    sh.uniforms.gw = { value: A.goal.w };
    sh.uniforms.gh = { value: A.goal.h };
    sh.uniforms.R = { value: A.R };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; uniform float Z; uniform float gw; uniform float gh; uniform float R;')
      .replace('void main() {', 'void main() {\n if (vWp.y > R * 0.55 || (abs(vWp.x) < gw && vWp.y < gh && abs(vWp.z) > Z - R - 0.5)) discard;');
  };
  lower.receiveShadow = true;
  group.add(lower);

  // Buts : cage ouverte côté terrain, filet, poteaux lumineux.
  for (const s of [-1, 1]) {
    const team = s < 0 ? 'blue' : 'orange';
    const color = TEAM_COLORS[team];
    const g = new THREE.Group();
    const netMat = new THREE.MeshStandardMaterial({ map: netTexture('#ffffff'), color, transparent: true, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.25 });
    netMat.map.repeat.set(A.goal.w / 2, A.goal.h / 2);
    const d = A.goal.d;
    const add = (w, h, x, y, z, ry = 0, rx = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), netMat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, 0);
      g.add(m);
    };
    const zc = s * (A.Z + d / 2);
    add(A.goal.w * 2, A.goal.h, 0, A.goal.h / 2, s * (A.Z + d)); // fond
    add(d, A.goal.h, -A.goal.w, A.goal.h / 2, zc, Math.PI / 2);
    add(d, A.goal.h, A.goal.w, A.goal.h / 2, zc, Math.PI / 2);
    add(A.goal.w * 2, d, 0, A.goal.h, zc, 0, Math.PI / 2);
    const gfloor = new THREE.Mesh(new THREE.PlaneGeometry(A.goal.w * 2, d + A.R), new THREE.MeshStandardMaterial({ color: '#2f6f2c', roughness: 1 }));
    gfloor.rotation.x = -Math.PI / 2;
    gfloor.position.set(0, 0.01, s * (A.Z + (d - A.R) / 2));
    g.add(gfloor);
    const postMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2 });
    for (const x of [-A.goal.w, A.goal.w]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, A.goal.h, 12), postMat);
      post.position.set(x, A.goal.h / 2, s * A.Z);
      g.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, A.goal.w * 2, 12), postMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, A.goal.h, s * A.Z);
    g.add(bar);
    group.add(g);
  }

  // Pastilles de turbo.
  const pads = boostPads().map((p) => {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(p.big ? 1.8 : 1.1, p.big ? 2.1 : 1.3, 0.2, 20), new THREE.MeshStandardMaterial({ color: '#333', emissive: '#ff8a1f', emissiveIntensity: 0.4 }));
    base.position.y = 0.1;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(p.big ? 1.2 : 0.55, 16, 12), new THREE.MeshStandardMaterial({ color: '#ffb02e', emissive: '#ff8a1f', emissiveIntensity: 1.4, transparent: true, opacity: 0.85 }));
    orb.position.y = p.big ? 1.6 : 0.7;
    g.add(base, orb);
    g.position.set(p.p[0], 0, p.p[2]);
    group.add(g);
    return { g, orb, big: p.big };
  });
  animated.push((dt, t) => pads.forEach((p, i) => { p.orb.position.y = (p.big ? 1.6 : 0.7) + Math.sin(t * 3 + i) * 0.15; }));

  // Tribunes et projecteurs autour du stade.
  const lib = await models(['racing/grandStandCovered', 'racing/lightPostLarge']);
  const stand = lib.get('racing/grandStandCovered');
  for (const side of [-1, 1]) {
    for (let z = -A.Z + 10; z <= A.Z - 10; z += 22) {
      const o = instanceSync(stand, { height: 16 });
      o.position.set(side * (A.X + 14), 0, z);
      o.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(o);
    }
  }
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const o = instanceSync(lib.get('racing/lightPostLarge'), { height: 40 });
    o.position.set(x * (A.X + 8), 0, z * (A.Z + 8));
    group.add(o);
  }
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: '#1f3a24', roughness: 1 }));
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.3;
  group.add(outside);

  // Ballon.
  const ball = new THREE.Mesh(new THREE.SphereGeometry(A.ballR, 32, 20), new THREE.MeshStandardMaterial({ map: TX.ballTexture(), roughness: 0.4, emissive: '#ffffff', emissiveIntensity: 0.08 }));
  ball.castShadow = true;
  group.add(ball);
  // Repère au sol sous le ballon (pour juger la hauteur).
  const marker = new THREE.Mesh(new THREE.RingGeometry(A.ballR * 0.7, A.ballR, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2;
  group.add(marker);

  return {
    sky, ball, marker, fog: new THREE.Fog('#141a40', 300, 1200), background: new THREE.Color('#141a40'),
    setPads(mask) { pads.forEach((p, i) => { p.orb.visible = mask[i] !== '0'; }); },
  };
}

async function bumperArena(group, animated) {
  const A = ARENAS.bumper;
  const sky = skyDome('#ff6a88', '#ffd8a8');
  group.add(sky);
  lights(group, { sun: 1.6, hemi: ['#fff0f0', '#a46080', 1.15] });

  const top = new THREE.MeshStandardMaterial({ map: TX.stripeTexture('#3b2a6b', '#4c3a85', 10), roughness: 0.7 });
  top.map.repeat.set(6, 6);
  const side = new THREE.MeshStandardMaterial({ color: '#2a1d4a', emissive: '#ff4fa3', emissiveIntensity: 0.35 });
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(A.radius, A.radius * 0.92, 4, 72), [side, top, side]);
  plat.position.y = -2;
  plat.receiveShadow = true;
  group.add(plat);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(A.radius, 0.25, 8, 96), new THREE.MeshStandardMaterial({ color: '#ff8ad0', emissive: '#ff4fa3', emissiveIntensity: 1.6 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.05;
  group.add(rim);

  const bumpers = A.bumpers.map((b) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, 2.2, 28), new THREE.MeshStandardMaterial({ color: '#ffe066', emissive: '#ff9a1f', emissiveIntensity: 0.6, roughness: 0.3 }));
    m.position.set(b.x, 1.1, b.z);
    m.castShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(b.r + 0.05, 0.2, 8, 32), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ff4fa3', emissiveIntensity: 1.4 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.2;
    m.add(ring);
    group.add(m);
    return m;
  });
  animated.push((dt, t) => bumpers.forEach((m, i) => { m.scale.x = m.scale.z = 1 + Math.sin(t * 4 + i) * 0.03; }));

  const pivot = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 2.6, 24), new THREE.MeshStandardMaterial({ color: '#e8e8f0', emissive: '#4ad8ff', emissiveIntensity: 0.4 }));
  pivot.position.y = 1.3;
  group.add(pivot);
  const sw = A.sweeper;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(sw.len, sw.h, sw.w), new THREE.MeshStandardMaterial({ map: TX.wallTexture('#ffffff', '#ff4fa3'), emissive: '#ff4fa3', emissiveIntensity: 0.25 }));
  bar.position.y = sw.h / 2;
  bar.castShadow = true;
  group.add(bar);

  // Îlots flottants au loin.
  const lib = await models(['platformer/block-grass-large', 'platformer/tree', 'platformer/tree-pine']);
  const rand = makeRng(77);
  for (let i = 0; i < 18; i++) {
    const a = rand() * Math.PI * 2;
    const r = 90 + rand() * 160;
    const o = instanceSync(lib.get('platformer/block-grass-large'), { height: 8 + rand() * 10 });
    o.position.set(Math.cos(a) * r, -30 + rand() * 50, Math.sin(a) * r);
    group.add(o);
    const tree = instanceSync(lib.get(rand() < 0.5 ? 'platformer/tree' : 'platformer/tree-pine'), { height: 8 + rand() * 6 });
    tree.position.copy(o.position);
    tree.position.y += o.userData.size.y;
    group.add(tree);
    const base = o.position.y;
    const ph = rand() * 10;
    animated.push((dt, t) => { o.position.y = base + Math.sin(t * 0.4 + ph) * 2; tree.position.y = o.position.y + o.userData.size.y; });
  }

  return {
    sky, fog: new THREE.Fog('#ffc7b0', 200, 700), background: new THREE.Color('#ffc7b0'),
    setTime(t) { bar.rotation.y = t * sw.speed; },
  };
}

async function battleArena(group, animated) {
  const A = ARENAS.battle;
  const sky = skyDome('#56c1ff', '#fff7d6');
  group.add(sky);
  lights(group, { sun: 1.7, hemi: ['#ffffff', '#6a9a3a', 1.1] });

  const ft = TX.stripeTexture('#5aa83a', '#62b442', 16);
  ft.repeat.set(4, 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(A.half * 2, A.half * 2), new THREE.MeshStandardMaterial({ map: ft, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const wallTex = TX.wallTexture('#e23a3a', '#ffd400');
  wallTex.repeat.set(20, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.6 });
  for (const [x, z, w, d] of [[0, -A.half, A.half * 2, 2], [0, A.half, A.half * 2, 2], [-A.half, 0, 2, A.half * 2], [A.half, 0, 2, A.half * 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w + 2, A.wallH, d), wallMat);
    m.position.set(x + Math.sign(x), A.wallH / 2, z + Math.sign(z));
    m.receiveShadow = true;
    m.castShadow = true;
    group.add(m);
  }
  const stoneMat = new THREE.MeshStandardMaterial({ map: TX.groundTexture('#b8a98a', 4), roughness: 0.9 });
  const pl = A.plateau;
  const plateau = new THREE.Mesh(new THREE.BoxGeometry(pl.h[0] * 2, pl.h[1] * 2, pl.h[2] * 2), stoneMat);
  plateau.position.set(...pl.c);
  plateau.castShadow = true;
  plateau.receiveShadow = true;
  group.add(plateau);
  const rampMat = new THREE.MeshStandardMaterial({ map: TX.rampTexture(), roughness: 0.6 });
  for (const r of A.rampsResolved || []) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(r.h[0] * 2, r.h[1] * 2, r.h[2] * 2), rampMat);
    m.position.set(...r.c);
    m.rotation.set(r.pitch, r.yaw, 0, 'YXZ');
    m.receiveShadow = true;
    group.add(m);
  }
  for (const p of A.pillars) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 9, 20), stoneMat);
    m.position.set(p.x, 4.5, p.z);
    m.castShadow = true;
    group.add(m);
  }
  for (const w of A.walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w.h[0] * 2, w.h[1] * 2, w.h[2] * 2), wallMat);
    m.position.set(...w.c);
    m.castShadow = true;
    group.add(m);
  }

  // Boîtes à objets.
  const boxMat = new THREE.MeshStandardMaterial({ map: TX.itemBoxTexture(), transparent: true, opacity: 0.95, roughness: 0.3 });
  boxMat.emissiveMap = boxMat.map;
  boxMat.emissive = new THREE.Color('#ffffff');
  boxMat.emissiveIntensity = 0.55;
  const boxGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
  const boxes = battleBoxes().map((b, i) => {
    const m = new THREE.Mesh(boxGeo, boxMat);
    m.position.set(b.p[0], b.p[1] + 0.6, b.p[2]);
    m.userData.y = b.p[1] + 0.6;
    m.userData.ph = i;
    group.add(m);
    return m;
  });
  animated.push((dt, t) => boxes.forEach((m) => {
    m.rotation.set(t * 0.9 + m.userData.ph, t * 1.3 + m.userData.ph, 0);
    m.position.y = m.userData.y + Math.sin(t * 2 + m.userData.ph) * 0.15;
  }));

  // Décor autour de l'enceinte.
  const lib = await models(['racing/treeLarge', 'racing/tentLong', 'racing/grandStand', 'racing/bannerTowerRed']);
  const rand = makeRng(9);
  const names = ['racing/treeLarge', 'racing/treeLarge', 'racing/tentLong', 'racing/grandStand', 'racing/bannerTowerRed'];
  for (let i = 0; i < 44; i++) {
    const a = rand() * Math.PI * 2;
    const r = A.half + 10 + rand() * 40;
    const name = names[Math.floor(rand() * names.length)];
    const o = instanceSync(lib.get(name), { height: name.includes('tree') ? 14 : 9 });
    o.position.set(Math.cos(a) * r * 1.2, 0, Math.sin(a) * r * 1.2);
    o.rotation.y = Math.atan2(-o.position.x, -o.position.z);
    group.add(o);
  }
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: '#6fbf4a', roughness: 1 }));
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.05;
  group.add(outside);

  return {
    sky, fog: new THREE.Fog('#dff1ff', 180, 700), background: new THREE.Color('#dff1ff'),
    setBoxes(mask) { boxes.forEach((m, i) => { m.visible = mask[i] !== '0'; }); },
    boxes,
  };
}

export async function buildArena(kind) {
  const group = new THREE.Group();
  const animated = [];
  const builder = kind === 'rocket' ? rocketArena : kind === 'bumper' ? bumperArena : battleArena;
  const extra = await builder(group, animated);
  return {
    group,
    ...extra,
    update(dt, t, camPos) {
      for (const fn of animated) fn(dt, t);
      if (extra.sky) extra.sky.position.copy(camPos);
    },
  };
}
