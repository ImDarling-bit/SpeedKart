// Éclairage d'ambiance : une carte d'environnement (ciel en dégradé, soleil, panneaux lumineux)
// préfiltrée par PMREM. Elle donne aux matériaux standard une lumière diffuse plus naturelle que
// la seule lumière hémisphérique, et des reflets sur les carrosseries.

import * as THREE from './three.js';

const cache = new WeakMap(); // renderer -> Map(clé -> texture)

function gradientSphere(top, horizon, ground) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(20, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: new THREE.Color(top) }, horizon: { value: new THREE.Color(horizon) }, ground: { value: new THREE.Color(ground) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vP;
        void main(){
          float y = vP.y;
          vec3 c = y > 0.0 ? mix(horizon, top, pow(clamp(y * 1.4, 0.0, 1.0), 0.7)) : mix(horizon, ground, clamp(-y * 4.0, 0.0, 1.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
}

function glow(color, power, w, h) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }));
  return m;
}

// env : { top, horizon, ground, sun, sunDir: [x, y, z], sunPower, panels }
export function environmentMap(renderer, env = {}) {
  const e = {
    top: '#5c8fd6', horizon: '#dfe9f5', ground: '#45484f', sun: '#fff1dd', sunDir: [-0.5, 1, 0.35], sunPower: 8, panels: true, ...env,
  };
  const key = JSON.stringify(e);
  let map = cache.get(renderer);
  if (!map) { map = new Map(); cache.set(renderer, map); }
  if (map.has(key)) return map.get(key);

  const scene = new THREE.Scene();
  scene.add(gradientSphere(e.top, e.horizon, e.ground));
  const dir = new THREE.Vector3(...e.sunDir).normalize();
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(e.sun).multiplyScalar(e.sunPower) }));
  sun.position.copy(dir).multiplyScalar(16);
  scene.add(sun);
  if (e.panels) {
    // Grandes boîtes à lumière : de beaux reflets allongés sur les carrosseries.
    const top = glow('#ffffff', 1.6, 18, 6);
    top.position.set(0, 15, 0);
    top.rotation.x = Math.PI / 2;
    scene.add(top);
    for (const s of [-1, 1]) {
      const side = glow('#ffffff', 0.9, 10, 3);
      side.position.set(s * 15, 4, 0);
      side.rotation.y = Math.PI / 2;
      scene.add(side);
    }
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.03).texture;
  pm.dispose();
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  map.set(key, tex);
  return tex;
}

// Studio sombre (titre, salon, podium) : peu de ciel, de grandes boîtes à lumière.
export const STUDIO_ENV = { top: '#1b2230', horizon: '#3a4252', ground: '#0c0f15', sun: '#ffffff', sunPower: 3, sunDir: [0.4, 1, 0.6] };

// Pose l'environnement sur la scène et rééquilibre les lumières hémisphériques déjà présentes,
// puisque l'environnement apporte maintenant une bonne part de la lumière ambiante.
export function applyEnvironment(renderer, scene, env = {}, { intensity = 0.55, hemiScale = 0.55 } = {}) {
  scene.environment = environmentMap(renderer, env);
  scene.environmentIntensity = intensity;
  scene.traverse((o) => {
    if (o.isHemisphereLight && !o.userData.envScaled) {
      o.intensity *= hemiScale;
      o.userData.envScaled = true;
    }
  });
}
