'use strict';

// Copie les bibliothèques du navigateur (three.js, PeerJS) depuis node_modules vers public/vendor.
// Les fichiers copiés sont versionnés : la page publiée n'a pas besoin de npm.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public', 'vendor');

const files = [
  ['node_modules/peerjs/dist/peerjs.min.js', 'peerjs.min.js'],
  ['node_modules/three/build/three.module.min.js', 'three/build/three.module.min.js'],
  ['node_modules/three/build/three.core.min.js', 'three/build/three.core.min.js'],
  ['node_modules/three/examples/jsm/loaders/GLTFLoader.js', 'three/addons/loaders/GLTFLoader.js'],
  ['node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', 'three/addons/utils/BufferGeometryUtils.js'],
  ['node_modules/three/examples/jsm/utils/SkeletonUtils.js', 'three/addons/utils/SkeletonUtils.js'],
];

for (const [from, to] of files) {
  const dest = path.join(out, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let src = fs.readFileSync(path.join(root, from), 'utf8');
  // Les modules annexes importent 'three' : on remplace par un chemin relatif (pas d'importmap à gérer).
  if (to.startsWith('three/addons/')) src = src.replace(/from\s+['"]three['"]/g, "from '../../build/three.module.min.js'");
  fs.writeFileSync(dest, src);
  console.log(`vendor/${to}`);
}
