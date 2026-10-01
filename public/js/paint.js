// Peinture des véhicules. Les modèles Kenney prennent leurs couleurs dans un atlas de nuanciers
// (8 × 4 cases dégradées). Plutôt que de teinter tout le modèle (vitres, phares et pneus compris),
// on repère la ou les cases de la carrosserie et on ne repeint qu'elles, dans une copie de l'atlas,
// en gardant leur dégradé. Les matériaux reçoivent aussi un fini plus brillant (reflets de l'environnement).

import * as THREE from './three.js';

const COLS = 8;
const ROWS = 4;
const analyses = new Map(); // modèle -> { cells: [{ i, ratio }] } | null
const textures = new Map(); // modèle|couleur -> CanvasTexture
const imageStats = new WeakMap(); // image -> stats des cases

const isPart = (o) => {
  for (let p = o; p; p = p.parent) if (/wheel|character/i.test(p.name)) return true;
  return false;
};

function cellStats(image) {
  if (imageStats.has(image)) return imageStats.get(image);
  const c = document.createElement('canvas');
  c.width = image.width;
  c.height = image.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0);
  const cw = c.width / COLS;
  const ch = c.height / ROWS;
  const stats = [];
  for (let r = 0; r < ROWS; r++) {
    for (let col = 0; col < COLS; col++) {
      const d = g.getImageData(col * cw + cw * 0.25, r * ch + ch * 0.1, cw * 0.5, ch * 0.8).data;
      let R = 0; let G = 0; let B = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
      const col3 = new THREE.Color(R / n / 255, G / n / 255, B / n / 255);
      const hsl = col3.getHSL({});
      stats.push({ color: col3, h: hsl.h, s: hsl.s, l: hsl.l, lum: 0.3 * col3.r + 0.59 * col3.g + 0.11 * col3.b });
    }
  }
  const out = { canvas: c, ctx: g, cw, ch, stats };
  imageStats.set(image, out);
  return out;
}

// Aire de chaque case de l'atlas couverte par la carrosserie (hors roues et pilote).
function analyse(key, model) {
  if (analyses.has(key)) return analyses.get(key);
  const area = new Float64Array(COLS * ROWS);
  let image = null;
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const hy = Math.max(0.01, box.max.y - box.min.y);
  model.traverse((o) => {
    if (!o.isMesh || isPart(o)) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m.map || !m.map.image) return;
    image = image || m.map.image;
    const pos = o.geometry.attributes.position;
    const uv = o.geometry.attributes.uv;
    if (!uv) return;
    const idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      const i0 = idx ? idx.getX(t) : t; const i1 = idx ? idx.getX(t + 1) : t + 1; const i2 = idx ? idx.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
      const cy0 = (a.y + b.y + c.y) / 3;
      nrm.copy(b.sub(a)).cross(c.sub(a));
      const len = nrm.length();
      // Ce qui se voit : surfaces tournées vers le haut (toit, capot) et hautes plutôt que dessous et pare-chocs.
      const s = len * (0.2 + Math.max(0, nrm.y / Math.max(1e-9, len))) * (0.3 + (cy0 - box.min.y) / hy);
      const u = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3;
      const v = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3;
      const cx = Math.min(COLS - 1, Math.max(0, Math.floor(u * COLS)));
      const cy = Math.min(ROWS - 1, Math.max(0, Math.floor(v * ROWS)));
      area[cy * COLS + cx] += s;
    }
  });
  if (!image) {
    const res = analyseMaterials(model);
    analyses.set(key, res);
    return res;
  }
  const { stats } = cellStats(image);
  // Case principale : grande surface, colorée et claire de préférence (les garnitures grises,
  // pare-chocs et dessous, couvrent souvent plus de surface que la carrosserie elle-même).
  const glass = (i) => i === 0 || i === 24;
  const score = (i) => area[i] * (stats[i].s > 0.25 ? 1.5 : 1) * (0.5 + stats[i].lum);
  let best = -1;
  for (let i = 0; i < area.length; i++) {
    if (glass(i) || stats[i].lum < 0.3 || area[i] <= 0) continue;
    if (best < 0 || score(i) > score(best)) best = i;
  }
  if (best < 0) { analyses.set(key, null); return null; }
  const ref = stats[best];
  const cells = [{ i: best, ratio: 1 }];
  // Cases voisines de la même teinte (partie basse plus foncée, ailerons...).
  for (let i = 0; i < area.length; i++) {
    if (i === best || glass(i) || area[i] < area[best] * 0.08) continue;
    const st = stats[i];
    const sameHue = Math.min(Math.abs(st.h - ref.h), 1 - Math.abs(st.h - ref.h)) < 0.09 && st.s > 0.2 && ref.s > 0.2;
    const sameGrey = ref.s < 0.15 && st.s < 0.15 && Math.abs(st.lum - ref.lum) < 0.15 && st.lum >= 0.3;
    if (sameHue || sameGrey) cells.push({ i, ratio: st.lum / Math.max(0.05, ref.lum) });
  }
  const res = { cells, image };
  analyses.set(key, res);
  return res;
}

// Modèles sans atlas (kit course) : une couleur par matériau nommé. On retient le matériau de
// carrosserie (le plus présent, hors vitres, pneus et garnitures) et ceux de la même teinte.
const NOT_BODY = /glass|window|tire|tyre|wheel|black|dark|metal|grey|gray|light|chrome/i;
const NEVER_BODY = /glass|window|tire|tyre|wheel/i;
function analyseMaterials(model, skip = NOT_BODY) {
  const area = new Map(); // nom -> { area, color }
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isMesh || isPart(o)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (skip.test(m.name) || !m.color) continue;
      const pos = o.geometry.attributes.position;
      const idx = o.geometry.index;
      const n = idx ? idx.count : pos.count;
      let s = 0;
      for (let t = 0; t < n; t += 3) {
        a.fromBufferAttribute(pos, idx ? idx.getX(t) : t);
        b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1);
        c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2);
        s += b.sub(a).cross(c.sub(a)).length();
      }
      const e = area.get(m.name) || { area: 0, color: m.color.clone() };
      e.area += s;
      area.set(m.name, e);
    }
  });
  let best = null;
  for (const [name, e] of area) {
    const hsl = e.color.getHSL({});
    e.s = hsl.s; e.h = hsl.h; e.lum = 0.3 * e.color.r + 0.59 * e.color.g + 0.11 * e.color.b;
    e.score = e.area * (e.s > 0.25 ? 4 : 1) * (0.3 + e.lum);
    if (!best || e.score > area.get(best).score) best = name;
  }
  if (!best) return skip === NEVER_BODY ? null : analyseMaterials(model, NEVER_BODY);
  const ref = area.get(best);
  const names = new Map([[best, 1]]);
  for (const [name, e] of area) {
    if (name === best) continue;
    const dh = Math.min(Math.abs(e.h - ref.h), 1 - Math.abs(e.h - ref.h));
    if (dh < 0.09 && e.s > 0.2 && ref.s > 0.2) names.set(name, e.lum / Math.max(0.05, ref.lum));
  }
  return { materials: names };
}

function paintedTexture(key, res, hex, baseMap) {
  const k = `${key}|${hex}`;
  if (textures.has(k)) return textures.get(k);
  const { canvas: src, cw, ch, stats } = cellStats(res.image);
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const target = new THREE.Color(hex);
  const ref = stats[res.cells[0].i].lum || 0.5;
  for (const { i } of res.cells) {
    const x0 = (i % COLS) * cw; const y0 = Math.floor(i / COLS) * ch;
    const img = g.getImageData(x0, y0, cw, ch);
    const d = img.data;
    for (let p = 0; p < d.length; p += 4) {
      const lum = (0.3 * d[p] + 0.59 * d[p + 1] + 0.11 * d[p + 2]) / 255;
      // Dégradé conservé : la luminance relative module la teinte choisie, avec un peu de brillance.
      const f = lum / ref;
      const hi = Math.max(0, f - 1) * 0.6;
      d[p] = Math.min(255, (target.r * f + hi) * 255);
      d[p + 1] = Math.min(255, (target.g * f + hi) * 255);
      d[p + 2] = Math.min(255, (target.b * f + hi) * 255);
    }
    g.putImageData(img, x0, y0);
  }
  const tex = baseMap.clone();
  tex.source = new THREE.Source(c);
  tex.needsUpdate = true;
  textures.set(k, tex);
  return tex;
}

// Applique peinture et finition à une copie de modèle (matériaux déjà clonés).
// key : identifiant du modèle (chemin), hex : couleur choisie ou null pour garder l'origine.
export function paintVehicle(model, key, hex) {
  const res = hex ? analyse(key, model) : null;
  model.traverse((o) => {
    if (!o.isMesh) return;
    const part = isPart(o);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (res && !part && m.map && res.cells) m.map = paintedTexture(key, res, hex, m.map);
      if (res && !part && res.materials && res.materials.has(m.name)) {
        m.color.set(hex).multiplyScalar(Math.min(1.6, res.materials.get(m.name)));
      }
      if ('roughness' in m) {
        m.roughness = part ? 0.75 : 0.32;
        m.metalness = part ? 0.05 : 0.18;
        m.envMapIntensity = part ? 0.6 : 1.25;
      }
      m.needsUpdate = true;
    }
  });
}
