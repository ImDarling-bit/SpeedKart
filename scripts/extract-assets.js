'use strict';

// Extrait les modèles GLB des packs Kenney (PACK_3d/*.zip) vers public/assets/<kit>/.
// Seuls le format GLB et ses textures sont gardés : c'est ce que charge le jeu.

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const root = path.join(__dirname, '..');
const packDir = path.join(root, 'PACK_3d');
const outDir = path.join(root, 'public', 'assets');

// zip -> dossier de sortie
const KITS = {
  'kenney_car-kit.zip': 'cars',
  'kenney_racing-kit.zip': 'racing',
  'kenney_city-kit-commercial_2.1.zip': 'commercial',
  'kenney_city-kit-industrial_2.0.zip': 'industrial',
  'kenney_city-kit-roads.zip': 'roads',
  'kenney_marble-kit.zip': 'marble',
  'kenney_platformer-kit.zip': 'platformer',
  'kenney_brick-kit.zip': 'brick',
};

const MODEL_DIR = /^Models\/(GLB|GLTF) format\//;

let count = 0;
for (const [zipName, kit] of Object.entries(KITS)) {
  const zipPath = path.join(packDir, zipName);
  if (!fs.existsSync(zipPath)) {
    console.warn(`absent : ${zipName}`);
    continue;
  }
  const zip = new AdmZip(zipPath);
  const names = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !MODEL_DIR.test(entry.entryName)) continue;
    const rel = entry.entryName.replace(MODEL_DIR, '');
    if (!/\.(glb|png)$/i.test(rel)) continue;
    const dest = path.join(outDir, kit, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
    if (rel.endsWith('.glb')) names.push(rel.replace(/\.glb$/, ''));
    count++;
  }
  fs.writeFileSync(path.join(outDir, kit, 'index.json'), JSON.stringify(names.sort()));
  console.log(`${kit}: ${names.length} modèles`);
}
// Vignettes des véhicules pour le salon : public/assets/previews/<id>.png
const VEHICLES_PREVIEWS = {
  'kenney_car-kit.zip': (name) => `Previews/${name}.png`,
  'kenney_racing-kit.zip': (name) => `Isometric/${name}_SE.png`,
};
const previewDir = path.join(outDir, 'previews');
fs.mkdirSync(previewDir, { recursive: true });
const vehicles = fs.readFileSync(path.join(root, 'public', 'js', 'data', 'vehicles.js'), 'utf8');
const models = [...vehicles.matchAll(/V\('([^']+)', '[^']+', '(cars|racing)\/([^']+)'/g)];
const zips = {};
for (const [, id, kit, name] of models) {
  const zipName = kit === 'cars' ? 'kenney_car-kit.zip' : 'kenney_racing-kit.zip';
  zips[zipName] = zips[zipName] || new AdmZip(path.join(packDir, zipName));
  const entry = zips[zipName].getEntry(VEHICLES_PREVIEWS[zipName](name));
  if (entry) fs.writeFileSync(path.join(previewDir, `${id}.png`), entry.getData());
  else console.warn(`vignette absente : ${id}`);
}
console.log(`${models.length} vignettes de véhicules`);
console.log(`${count} fichiers extraits dans public/assets`);
