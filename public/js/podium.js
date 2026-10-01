// Podium 3D de fin de partie : les trois premiers sur des marches or / argent / bronze avec leur
// place et leur nom, dans une petite arène de fête (tribunes, écrans lumineux, guirlande de
// fanions, projecteurs qui balaient le ciel, feux d'artifice et confettis).

import * as THREE from './three.js';
import { RoundedBoxGeometry } from './three.js';
import { KartView } from './kartview.js';
import { Particles } from './fx.js';
import { vehicleById } from './data/vehicles.js';
import { colorHex } from './data/colors.js';
import { models, instanceSync } from './assets.js';
import { applyEnvironment } from './envmap.js';

const CONFETTI = ['#ff4d6d', '#ffd23f', '#2fd0ff', '#4dff88', '#c44dff', '#ffffff', '#ff8a1f'];
const PLACES = {
  1: { color: '#f5c542', dark: '#a8781a', h: 2.8, x: 0 },
  2: { color: '#cfd9e6', dark: '#7d8899', h: 2.0, x: -4.4 },
  3: { color: '#e0915a', dark: '#93512a', h: 1.5, x: 4.4 },
};

async function fontReady() {
  try { await document.fonts.load('800 200px "Barlow Condensed"'); await document.fonts.load('700 80px "Inter"'); } catch { /* police système */ }
}

// Étiquette de la face avant : grand numéro net (canvas haute définition) et nom du joueur.
function labelTexture(place, name, w, h) {
  const PX = 256; // pixels par mètre
  const c = document.createElement('canvas');
  c.width = Math.round(w * PX);
  c.height = Math.round(h * PX);
  const g = c.getContext('2d');
  const P = PLACES[place];
  const nameH = Math.min(0.42, h * 0.24) * PX;
  const numH = c.height - nameH - 0.2 * PX;
  // Numéro.
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 ${Math.round(numH * 0.95)}px "Barlow Condensed", Impact, sans-serif`;
  g.lineJoin = 'round';
  g.lineWidth = numH * 0.07;
  g.strokeStyle = P.dark;
  const ny = 0.08 * PX + numH / 2;
  g.strokeText(String(place), c.width / 2, ny);
  g.fillStyle = '#ffffff';
  g.fillText(String(place), c.width / 2, ny);
  // Bandeau du nom.
  const by = c.height - nameH - 0.08 * PX;
  g.fillStyle = 'rgba(10,12,20,0.82)';
  const r = nameH * 0.3;
  const bx = 0.12 * PX; const bw = c.width - 0.24 * PX;
  g.beginPath();
  g.roundRect(bx, by, bw, nameH, r);
  g.fill();
  let size = nameH * 0.62;
  g.font = `700 ${Math.round(size)}px "Inter", Arial, sans-serif`;
  const label = name || '';
  while (g.measureText(label).width > bw * 0.9 && size > 10) {
    size -= 2;
    g.font = `700 ${Math.round(size)}px "Inter", Arial, sans-serif`;
  }
  g.fillStyle = '#ffffff';
  g.fillText(label, c.width / 2, by + nameH / 2 + 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Écran lumineux du fond : bandes de couleur qui défilent.
function screenTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 512, 0);
  ['#ff3d8b', '#ffb13d', '#ffe23d', '#3dffa0', '#3dc8ff', '#8b5cff', '#ff3d8b'].forEach((col, i, a) => grad.addColorStop(i / (a.length - 1), col));
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let x = 0; x < 512; x += 8) g.fillRect(x, 0, 2, 128);
  for (let y = 0; y < 128; y += 8) g.fillRect(0, y, 512, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function skyDome() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(120, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; void main(){
        float y = clamp(vP.y, -0.2, 1.0);
        vec3 a = vec3(0.98, 0.42, 0.36); vec3 b = vec3(0.62, 0.20, 0.62); vec3 c = vec3(0.10, 0.07, 0.28);
        vec3 col = y < 0.12 ? mix(a, b, smoothstep(-0.05, 0.12, y)) : mix(b, c, smoothstep(0.12, 0.7, y));
        gl_FragColor = vec4(col, 1.0); }`,
    }),
  );
}

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1430';
  g.fillRect(0, 0, 1024, 1024);
  const cols = ['#ff3d8b', '#ffb13d', '#3dc8ff', '#8b5cff'];
  for (let i = 12; i > 0; i--) {
    g.beginPath();
    g.arc(512, 512, i * 40, 0, Math.PI * 2);
    g.strokeStyle = cols[i % cols.length];
    g.globalAlpha = 0.5;
    g.lineWidth = 6;
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export async function showPodium(renderer, results, colors = {}) {
  await fontReady();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2a1240');
  scene.fog = new THREE.Fog('#3a1850', 40, 110);
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
  const sky = skyDome();
  scene.add(sky);

  // Lumières : clé blanche sur le podium, contre-jours colorés.
  scene.add(new THREE.HemisphereLight('#ffd6f0', '#2a1a40', 1.2));
  const key = new THREE.SpotLight('#ffffff', 520, 50, 0.55, 0.45, 1.2);
  key.position.set(2, 18, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0003;
  scene.add(key, key.target);
  for (const [x, color] of [[-9, '#3dc8ff'], [9, '#ff8a3d'], [0, '#ff3d8b']]) {
    const l = new THREE.PointLight(color, 140, 26, 1.5);
    l.position.set(x, 5, x === 0 ? -6 : 1);
    scene.add(l);
  }
  applyEnvironment(renderer, scene, { top: '#2a1a60', horizon: '#ff6a7a', ground: '#1b1430', sun: '#fff0e0', sunPower: 6, sunDir: [0.3, 1, 0.8] }, { intensity: 0.7, hemiScale: 0.7 });

  // Sol à anneaux colorés.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ map: floorTexture(), metalness: 0.3, roughness: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Marches.
  const views = [];
  for (const place of [1, 2, 3]) {
    const P = PLACES[place];
    const r = results[place - 1];
    const mat = new THREE.MeshStandardMaterial({ color: P.color, metalness: 0.55, roughness: 0.28 });
    const box = new THREE.Mesh(new RoundedBoxGeometry(4, P.h, 4, 4, 0.18), mat);
    box.position.set(P.x, P.h / 2, 0);
    box.castShadow = true;
    box.receiveShadow = true;
    scene.add(box);
    // Liseré lumineux en haut de la marche.
    const rim = new THREE.Mesh(new THREE.BoxGeometry(4.04, 0.08, 4.04), new THREE.MeshBasicMaterial({ color: P.color }));
    rim.position.set(P.x, P.h - 0.12, 0);
    scene.add(rim);
    // Étiquette (numéro + nom) collée sur la face avant.
    const lw = 3.6; const lh = P.h - 0.25;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(lw, lh), new THREE.MeshBasicMaterial({ map: labelTexture(place, r ? r.name : '', lw, lh), transparent: true, toneMapped: false }));
    label.position.set(P.x, lh / 2 + 0.06, 2.01);
    label.userData.ownMap = true;
    scene.add(label);
    if (!r) continue;
    const view = new KartView(vehicleById(r.vehicle), { color: colorHex(colors[r.id]) });
    await view.load();
    view.root.position.set(P.x, P.h, 0);
    view.root.rotation.y = P.x === 0 ? 0 : P.x > 0 ? -0.4 : 0.4;
    view.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(view.root);
    views.push(view);
  }

  // Fond : écran géant incurvé, tribunes, tours à bannières, drapeaux.
  const scr = screenTexture();
  const screen = new THREE.Mesh(
    new THREE.CylinderGeometry(26, 26, 7, 48, 1, true, -0.75, 1.5),
    new THREE.MeshBasicMaterial({ map: scr, side: THREE.BackSide, toneMapped: false }),
  );
  screen.rotation.y = Math.PI;
  screen.position.set(0, 9, 4);
  scene.add(screen);
  try {
    const lib = await models(['racing/grandStandRound', 'racing/bannerTowerRed', 'racing/bannerTowerGreen', 'racing/flagCheckers', 'racing/lightColored']);
    for (const s of [-1, 1]) {
      const stand = instanceSync(lib.get('racing/grandStandRound'), { height: 6 });
      stand.position.set(s * 21, 0, -15);
      stand.rotation.y = s * 0.6;
      scene.add(stand);
      const tower = instanceSync(lib.get(s < 0 ? 'racing/bannerTowerRed' : 'racing/bannerTowerGreen'), { height: 10 });
      tower.position.set(s * 13.5, 0, -9);
      scene.add(tower);
      const flag = instanceSync(lib.get('racing/flagCheckers'), { height: 5 });
      flag.position.set(s * 7.5, 0, 3);
      flag.rotation.y = -s * 0.4;
      scene.add(flag);
      const lamp = instanceSync(lib.get('racing/lightColored'), { height: 7 });
      lamp.position.set(s * 10, 0, -4);
      scene.add(lamp);
    }
  } catch { /* décor facultatif */ }

  // Guirlande de fanions au-dessus du podium.
  const bunting = new THREE.Group();
  const pts = [];
  const sag = (x) => 8.8 - (1 - (x / 11) ** 2) * 1.4;
  for (let i = 0; i <= 24; i++) {
    const x = -11 + (i / 24) * 22;
    pts.push(new THREE.Vector3(x, sag(x), -1.5));
  }
  bunting.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#ffffff' })));
  const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.35, 0, 0), new THREE.Vector3(0.35, 0, 0), new THREE.Vector3(0, -0.8, 0)]);
  tri.computeVertexNormals();
  const flags = [];
  for (let i = 0; i < 23; i++) {
    const x = -10.5 + i * (21 / 22);
    const f = new THREE.Mesh(tri, new THREE.MeshBasicMaterial({ color: CONFETTI[i % CONFETTI.length], side: THREE.DoubleSide, toneMapped: false }));
    f.position.set(x, sag(x), -1.5);
    f.userData.ph = i * 0.7;
    bunting.add(f);
    flags.push(f);
  }
  scene.add(bunting);

  // Projecteurs qui balaient le ciel.
  const beams = [];
  const beamGeo = new THREE.ConeGeometry(2.2, 40, 24, 1, true);
  beamGeo.translate(0, -20, 0);
  for (const [x, col] of [[-14, '#3dc8ff'], [-5, '#ff3d8b'], [5, '#ffd23f'], [14, '#8b5cff']]) {
    const b = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    b.position.set(x, 0, -14);
    b.rotation.x = Math.PI; // cône pointé vers le haut, sommet au sol
    b.userData.ph = x * 0.3;
    scene.add(b);
    beams.push(b);
  }

  const own = [scr, floor.material.map];
  scene.traverse((o) => { if (o.userData.ownMap) own.push(o.material.map); });
  const fx = new Particles(scene, 900);
  let running = true;
  let confettiT = 0;
  let fireT = 0.6;
  const t0 = performance.now();
  let last = t0;
  const canvas = renderer.domElement;

  function firework() {
    const x = (Math.random() - 0.5) * 30;
    const y = 13 + Math.random() * 7;
    const z = -12 - Math.random() * 6;
    const col = CONFETTI[Math.floor(Math.random() * CONFETTI.length)];
    for (let i = 0; i < 60; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = 6 + Math.random() * 2;
      fx.emit(x, y, z, { vx: Math.cos(th) * r * sp, vy: u * sp, vz: Math.sin(th) * r * sp, gravity: 3, drag: 1.2, color: col, size: 0.7, size1: 0.1, life: 1.6 });
    }
  }

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - t0) / 1000;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.fov = w / h < 1 ? 60 : 40;
    cam.updateProjectionMatrix();
    const a = Math.sin(t * 0.25) * 0.35;
    const r = w / h < 1 ? 22 : 16.5;
    cam.position.set(Math.sin(a) * r, 5.2, Math.cos(a) * r);
    // Sur grand écran, le podium se place à gauche du tableau des résultats.
    cam.lookAt(w / h > 1.2 ? 3.2 : 0, 3, 0);

    scr.offset.x = (t * 0.05) % 1;
    for (const b of beams) {
      b.rotation.z = Math.sin(t * 0.6 + b.userData.ph) * 0.45;
      b.rotation.x = Math.PI + Math.sin(t * 0.4 + b.userData.ph) * 0.2;
    }
    for (const f of flags) f.rotation.x = Math.sin(t * 3 + f.userData.ph) * 0.3;

    confettiT -= dt;
    if (confettiT <= 0) {
      confettiT = 0.025;
      fx.emit((Math.random() - 0.5) * 20, 11, (Math.random() - 0.5) * 8, {
        vx: (Math.random() - 0.5) * 2, vy: -2, vz: (Math.random() - 0.5) * 2, gravity: 1.5, drag: 0.6,
        color: CONFETTI[Math.floor(Math.random() * CONFETTI.length)], size: 0.45, size1: 0.4, life: 5, normal: true,
      });
    }
    fireT -= dt;
    if (fireT <= 0) { fireT = 0.7 + Math.random() * 0.9; firework(); }
    fx.update(dt);
    for (const v of views) v.update(dt, { x: v.root.position.x, y: v.root.position.y, z: 0, yaw: v.root.rotation.y, spd: 0, vis: {} });
    renderer.render(scene, cam);
  }
  loop();

  return {
    dispose() {
      running = false;
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      for (const t of own) t.dispose();
    },
  };
}
