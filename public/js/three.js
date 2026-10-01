// Point d'entrée unique vers three.js (copié dans public/vendor par `npm run vendor`).
export * from '../vendor/three/build/three.module.min.js';
export { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
export { clone as cloneSkinned } from '../vendor/three/addons/utils/SkeletonUtils.js';
export { RoundedBoxGeometry } from '../vendor/three/addons/geometries/RoundedBoxGeometry.js';
