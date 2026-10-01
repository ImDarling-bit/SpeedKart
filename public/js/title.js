// Scène 3D de l'écran titre : le véhicule du joueur sur un plateau lumineux, deux autres
// garés de part et d'autre, des traînées de vitesse au fond, caméra en lente orbite.

import * as THREE from './three.js';
import { instance } from './assets.js';
import { vehicleById } from './data/vehicles.js';
import { getSettings } from './settings.js';
import { paintVehicle } from './paint.js';
import { applyEnvironment, STUDIO_ENV } from './envmap.js';

const ACCENT = '#2fd0ff';

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#0d1016';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(47,208,255,0.12)';
  g.lineWidth = 2;
  for (let i = 0; i <= 512; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 8);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createTitleScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, getSettings().quality === 'low' ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#07090d');
  scene.fog = new THREE.Fog('#07090d', 25, 70);
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

  scene.add(new THREE.HemisphereLight('#8fb8ff', '#101018', 0.6));
  const key = new THREE.SpotLight('#ffffff', 120, 40, 0.5, 0.6, 1.4);
  key.position.set(4, 12, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key, key.target);
  const rim = new THREE.PointLight(ACCENT, 60, 18, 1.6);
  rim.position.set(-5, 3, -4);
  scene.add(rim);
  const warm = new THREE.PointLight('#ff8a3d', 40, 16, 1.6);
  warm.position.set(6, 2, -3);
  scene.add(warm);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ map: floorTexture(), metalness: 0.6, roughness: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.2, 64), new THREE.MeshStandardMaterial({ color: '#141922', metalness: 0.7, roughness: 0.3 }));
  disc.position.y = 0.1;
  disc.receiveShadow = true;
  scene.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.05, 8, 96), new THREE.MeshBasicMaterial({ color: ACCENT }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.21;
  scene.add(ring);

  // Traînées de vitesse au fond.
  const streaks = [];
  const streakMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6 + Math.random() * 10, 0.06), streakMat);
    m.position.set((Math.random() - 0.5) * 60, 0.5 + Math.random() * 8, -18 - Math.random() * 20);
    m.userData.v = 10 + Math.random() * 25;
    scene.add(m);
    streaks.push(m);
  }

  applyEnvironment(renderer, scene, STUDIO_ENV, { intensity: 0.8, hemiScale: 0.6 });

  const hero = new THREE.Group();
  hero.position.y = 0.2;
  scene.add(hero);
  const side = new THREE.Group();
  scene.add(side);

  let running = false;
  let current = null;
  let token = 0;
  let t0 = performance.now();

  async function placeSide() {
    for (const [id, x, yaw] of [['police', -6.2, 0.7], ['race-future', 6.2, -0.7]]) {
      const o = await instance(vehicleById(id).model, { length: 4, cloneMaterials: true });
      paintVehicle(o, vehicleById(id).model, null);
      o.position.set(x, 0, -2.5);
      o.rotation.y = yaw;
      o.traverse((m) => { if (m.isMesh) m.castShadow = true; });
      side.add(o);
    }
  }
  placeSide();

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    // Sur écran étroit (téléphone), on recule pour garder la voiture entière.
    cam.fov = w / h < 1 ? 55 : 38;
    cam.updateProjectionMatrix();
  }

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const t = (performance.now() - t0) / 1000;
    resize();
    hero.rotation.y = t * 0.35;
    const a = Math.sin(t * 0.12) * 0.5 + 0.6;
    const r = 14;
    cam.position.set(Math.sin(a) * r, 3.6 + Math.sin(t * 0.3) * 0.3, Math.cos(a) * r);
    // La voiture se place à droite du menu sur grand écran.
    const wide = cam.aspect > 1.2;
    cam.lookAt(wide ? -2.5 : 0, 1, 0);
    for (const s of streaks) {
      s.position.x += s.userData.v * 0.016;
      if (s.position.x > 40) s.position.x = -40;
    }
    ring.material.color.setHSL(0.53, 1, 0.5 + Math.sin(t * 2) * 0.08);
    renderer.render(scene, cam);
  }

  return {
    async show(vehicleId, color) {
      const key2 = `${vehicleId}|${color}`;
      if (current === key2) return;
      current = key2;
      const my = ++token;
      const v = vehicleById(vehicleId);
      const obj = await instance(v.model, { length: 4.4, cloneMaterials: true });
      if (my !== token) return;
      paintVehicle(obj, v.model, color);
      obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      hero.clear();
      hero.add(obj);
    },
    start() {
      if (running) return;
      running = true;
      t0 = performance.now() - 2000;
      loop();
    },
    stop() { running = false; },
  };
}
