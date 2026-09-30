// Chargement des modèles Kenney : cache, recentrage (pied au sol, centré), mise à l'échelle.

import * as THREE from './three.js';

const loader = new THREE.GLTFLoader();
const cache = new Map(); // chemin -> Promise<{ root, size }>

function prepare(gltf) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // Pivot : centre de la base, pour que tous les modèles se posent pareil.
  scene.position.set(-center.x, -box.min.y, -center.z);
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) {
          m.map.colorSpace = THREE.SRGBColorSpace;
          m.map.anisotropy = 4;
        }
        if ('metalness' in m) m.metalness = Math.min(m.metalness, 0.2);
      }
    }
  });
  const root = new THREE.Group();
  root.add(scene);
  return { root, size };
}

export function loadModel(path) {
  if (!cache.has(path)) {
    const p = new Promise((resolve) => {
      loader.load(
        `assets/${path}.glb`,
        (gltf) => resolve(prepare(gltf)),
        undefined,
        (err) => {
          console.warn('[assets] échec', path, err);
          // Remplacement visible plutôt qu'un plantage.
          const root = new THREE.Group();
          root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff00ff })));
          root.children[0].position.y = 0.5;
          resolve({ root, size: new THREE.Vector3(1, 1, 1) });
        },
      );
    });
    cache.set(path, p);
  }
  return cache.get(path);
}

export function preload(paths, onProgress) {
  const list = [...new Set(paths)];
  let done = 0;
  return Promise.all(list.map((p) => loadModel(p).then((r) => {
    done++;
    if (onProgress) onProgress(done / list.length);
    return r;
  })));
}

// Copie d'un modèle chargé (géométries partagées). opts : { height | length | scale, cloneMaterials }
export async function instance(path, opts = {}) {
  const { root, size } = await loadModel(path);
  return instanceSync({ root, size }, opts);
}

export function instanceSync(model, opts = {}) {
  const { root, size } = model;
  const obj = root.clone(true);
  let k = opts.scale || 1;
  if (opts.height) k = opts.height / Math.max(0.01, size.y);
  else if (opts.length) k = opts.length / Math.max(0.01, size.z);
  obj.scale.setScalar(k);
  obj.userData.size = size.clone().multiplyScalar(k);
  if (opts.cloneMaterials || opts.tint) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      if (opts.tint) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          m.map = null;
          m.color = new THREE.Color(opts.tint);
          m.roughness = 0.45;
          m.needsUpdate = true;
        }
      }
    });
  }
  return obj;
}

// Modèles déjà en cache (sans attendre), pour placer des centaines de décors d'un coup.
export async function models(paths) {
  const out = new Map();
  await Promise.all([...new Set(paths)].map(async (p) => out.set(p, await loadModel(p))));
  return out;
}
