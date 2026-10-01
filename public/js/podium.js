// Podium 3D de fin de partie : les trois premiers sur leurs marches, confettis, projecteurs.

import * as THREE from './three.js';
import { KartView } from './kartview.js';
import { Particles } from './fx.js';
import { vehicleById } from './data/vehicles.js';
import { colorHex } from './data/colors.js';

const CONFETTI = ['#ff4d6d', '#ffd23f', '#2fd0ff', '#4dff88', '#c44dff', '#ffffff'];

function numberTexture(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1f2b';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = n === 1 ? '#ffd23f' : n === 2 ? '#dfe6f0' : '#e09a5a';
  g.font = '800 92px "Barlow Condensed", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// results : lignes de résultat triées ; grid : liste des participants (pour les couleurs).
export async function showPodium(renderer, results, colors = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#07090d');
  scene.fog = new THREE.Fog('#07090d', 20, 60);
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  scene.add(new THREE.HemisphereLight('#9fb8ff', '#1a1a26', 1.4));
  const spot = new THREE.SpotLight('#ffffff', 320, 40, 0.6, 0.5, 1.3);
  spot.position.set(0, 14, 6);
  spot.castShadow = true;
  scene.add(spot, spot.target);
  for (const [x, color] of [[-7, '#2fd0ff'], [7, '#ff8a3d']]) {
    const l = new THREE.PointLight(color, 50, 20, 1.5);
    l.position.set(x, 4, 2);
    scene.add(l);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: '#0e1118', metalness: 0.5, roughness: 0.4 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Marches : 2e à gauche, 1er au centre, 3e à droite.
  const steps = [[2, -4.2, 1.6], [1, 0, 2.6], [3, 4.2, 1.0]];
  const views = [];
  for (const [place, x, h] of steps) {
    const r = results[place - 1];
    const top = new THREE.MeshStandardMaterial({ color: '#2a3242', metalness: 0.3, roughness: 0.5 });
    const front = new THREE.MeshStandardMaterial({ map: numberTexture(place), roughness: 0.6 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(4, h, 4), [top, top, top, top, front, top]);
    box.position.set(x, h / 2, 0);
    box.castShadow = true;
    box.receiveShadow = true;
    scene.add(box);
    if (!r) continue;
    const view = new KartView(vehicleById(r.vehicle), { color: colorHex(colors[r.id]) });
    await view.load();
    view.root.position.set(x, h, 0);
    view.root.rotation.y = x === 0 ? 0 : x > 0 ? -0.4 : 0.4;
    view.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(view.root);
    views.push(view);
  }

  const fx = new Particles(scene, 400);
  let running = true;
  let confettiT = 0;
  const t0 = performance.now();
  let last = t0;
  const canvas = renderer.domElement;

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
    const a = Math.sin(t * 0.25) * 0.45;
    const r = w / h < 1 ? 20 : 15;
    cam.position.set(Math.sin(a) * r, 5.5, Math.cos(a) * r);
    // Sur grand écran, le podium se place à gauche du tableau des résultats.
    cam.lookAt(w / h > 1.2 ? 3.5 : 0, 2.2, 0);
    confettiT -= dt;
    if (confettiT <= 0) {
      confettiT = 0.03;
      fx.emit((Math.random() - 0.5) * 18, 9, (Math.random() - 0.5) * 8, {
        vx: (Math.random() - 0.5) * 2, vy: -2, vz: (Math.random() - 0.5) * 2, gravity: 2, drag: 0.4,
        color: CONFETTI[Math.floor(Math.random() * CONFETTI.length)], size: 0.6, size1: 0.5, life: 4, normal: true,
      });
    }
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
    },
  };
}
