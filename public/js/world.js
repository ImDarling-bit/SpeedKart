// Construit la scène 3D d'un circuit à partir de sa géométrie (TrackPath) et de son thème.

import * as THREE from './three.js';
import { makeRng, hashString, pickWeighted } from './util.js';
import * as TX from './textures.js';
import { models, instanceSync } from './assets.js';

const UP = 0.05; // la route flotte un peu au-dessus de ses bords

// Balaye un profil (liste de [d, h, u]) le long du tracé. d : décalage latéral, h : hauteur relative.
function sweep(T, sList, profileFn, vLen = 16) {
  const pos = [];
  const uv = [];
  const idx = [];
  const p = {};
  let m = 0;
  sList.forEach((s, i) => {
    T.pointAt(s, 0, p);
    const prof = profileFn(p, s);
    m = prof.length;
    // h se mesure le long du « haut » de la piste (vertical, sauf dans les loopings).
    for (const [d, h, u] of prof) {
      pos.push(p.x + p.rx * d + p.ux * h, p.y + p.uy * h, p.z + p.rz * d + p.uz * h);
      uv.push(u, s / vLen);
    }
    if (i > 0) {
      const a = (i - 1) * m;
      const b = i * m;
      for (let j = 0; j < m - 1; j++) {
        idx.push(a + j, a + j + 1, b + j, a + j + 1, b + j + 1, b + j);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function loopS(T, step = 1) {
  const out = [];
  for (let i = 0; i <= T.n; i += step) out.push(Math.min(i, T.n) * T.ds);
  if (out[out.length - 1] < T.length) out.push(T.length);
  return out;
}

function rangeS(s0, s1, step = 1) {
  const out = [];
  for (let s = s0; s < s1; s += step) out.push(s);
  out.push(s1);
  return out;
}

function inRanges(T, s, ranges) {
  const f = T.wrapS(s) / T.length;
  return (ranges || []).some(([a, b]) => f >= a && f <= b);
}

function skyDome(top, bottom) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float t = clamp(vP.y*1.6+0.25,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, t),1.0); }',
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), mat);
  m.renderOrder = -1;
  return m;
}

// Grille spatiale des échantillons : distance au bord de piste la plus courte.
function trackGrid(T) {
  const cell = 24;
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < T.n; i++) {
    const k = key(T.px[i], T.pz[i]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  // Marge libre (> 0) entre (x, z) et la zone occupée par la piste (talus compris).
  return (x, z, extra = 0) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    let best = Infinity;
    const R = 4;
    for (let a = -R; a <= R; a++) {
      for (let b = -R; b <= R; b++) {
        const list = grid.get(`${cx + a},${cz + b}`);
        if (!list) continue;
        for (const i of list) {
          const occ = T.hw[i] + T.margin + 1 + (T.edge === 'wall' ? Math.max(0, T.py[i]) * 1.2 : 0);
          const d = Math.hypot(T.px[i] - x, T.pz[i] - z) - occ - extra;
          if (d < best) best = d;
        }
      }
    }
    return best;
  };
}

export async function buildWorld(T, def, theme, onProgress) {
  const group = new THREE.Group();
  const rand = makeRng(hashString(def.id));
  const animated = [];
  const W = (hw) => hw + T.margin;
  const hasGround = !!theme.ground;

  // ------------------------------------------------------------ ciel, lumière
  const sky = skyDome(theme.sky[0], theme.sky[1]);
  group.add(sky);
  const fog = new THREE.Fog(theme.fog[0], theme.fog[1], theme.fog[2]);

  const hemi = new THREE.HemisphereLight(theme.hemi[0], theme.hemi[1], theme.hemi[2]);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(theme.night ? '#8fa0ff' : '#fff4e0', theme.sun);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  group.add(sun, sun.target);
  const sunDir = new THREE.Vector3(-0.5, 1, 0.35).normalize();

  if (theme.stars) {
    const n = 1800;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos.set([Math.cos(th) * r * 1500, Math.abs(u) * 1500 - 200, Math.sin(th) * r * 1500], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 3, sizeAttenuation: false, fog: false }));
    group.add(stars);
  }

  // ------------------------------------------------------------ sol
  let cx = 0; let cz = 0;
  for (let i = 0; i < T.n; i++) { cx += T.px[i]; cz += T.pz[i]; }
  cx /= T.n; cz /= T.n;

  if (hasGround) {
    const gt = TX.groundTexture(theme.ground, 5, theme.groundStuds);
    gt.repeat.set(200, 200);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ map: gt, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.06, cz);
    ground.receiveShadow = true;
    group.add(ground);
  }
  if (theme.water) {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000, 1, 1),
      new THREE.MeshStandardMaterial({ color: theme.water.color, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, theme.water.y, cz);
    group.add(water);
    animated.push((dt, t) => { water.position.y = theme.water.y + Math.sin(t * 0.8) * 0.15; });
  }

  // ------------------------------------------------------------ route
  const S = loopS(T);
  const roadMat = new THREE.MeshStandardMaterial({ map: TX.roadTexture(theme.road), roughness: theme.road.ice ? 0.35 : 0.85 });
  if (theme.road.glow) {
    roadMat.emissiveMap = theme.road.rainbow ? roadMat.map : TX.emissiveLines(theme.road);
    roadMat.emissive = new THREE.Color(theme.road.rainbow ? '#ffffff' : theme.road.line);
    roadMat.emissiveIntensity = theme.road.rainbow ? 0.55 : 1.2;
  }
  const road = new THREE.Mesh(sweep(T, S, (p) => [[-p.hw, UP, 0], [p.hw, UP, 1]], 16), roadMat);
  road.receiveShadow = true;
  group.add(road);

  // Bordures (vibreurs).
  const curbMat = new THREE.MeshStandardMaterial({ map: TX.curbTexture(theme.curb), roughness: 0.7 });
  if (theme.road.glow) { curbMat.emissiveMap = curbMat.map; curbMat.emissive = new THREE.Color('#ffffff'); curbMat.emissiveIntensity = 0.5; }
  for (const side of [-1, 1]) {
    const curb = new THREE.Mesh(sweep(T, S, (p) => (side < 0
      ? [[-p.hw - 1.4, UP + 0.03, 0], [-p.hw, UP + 0.03, 1]]
      : [[p.hw, UP + 0.03, 0], [p.hw + 1.4, UP + 0.03, 1]]), 4), curbMat);
    curb.receiveShadow = true;
    group.add(curb);
  }

  // Bas-côtés.
  const offTex = TX.groundTexture(theme.off, 9, theme.groundStuds);
  const offMat = new THREE.MeshStandardMaterial({ map: offTex, roughness: 1 });
  for (const side of [-1, 1]) {
    const off = new THREE.Mesh(sweep(T, S, (p) => {
      const w = W(p.hw);
      return side < 0 ? [[-w, UP * 0.5, -w / 12], [-p.hw, UP * 0.5, -p.hw / 12]] : [[p.hw, UP * 0.5, p.hw / 12], [w, UP * 0.5, w / 12]];
    }, 12), offMat);
    off.receiveShadow = true;
    group.add(off);
  }

  // Murs.
  if (T.edge === 'wall' && theme.wall) {
    const wt = TX.wallTexture(theme.wall.color, theme.wall.stripe);
    const wallMat = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.7, side: THREE.DoubleSide });
    if (theme.wall.glow) { wallMat.emissiveMap = wt; wallMat.emissive = new THREE.Color('#ffffff'); wallMat.emissiveIntensity = 0.35; }
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(sweep(T, S, (p) => {
        const w = W(p.hw) * side;
        const o = w + 0.6 * side;
        return [[w, 0, 0], [w, 1.1, 0.4], [o, 1.1, 0.6], [o, -0.5, 1]];
      }, 5), wallMat);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
    }
  }

  // Dessous : talus plein jusqu'au sol, ou tablier mince (ponts, circuits suspendus).
  const skirtColor = theme.edgeColor || theme.off;
  const skirtMat = new THREE.MeshStandardMaterial({ color: skirtColor, roughness: 0.9, side: THREE.DoubleSide });
  const bankMat = hasGround
    ? new THREE.MeshStandardMaterial({ map: TX.groundTexture(theme.ground, 13, theme.groundStuds), roughness: 1, side: THREE.DoubleSide })
    : null;
  for (const side of [-1, 1]) {
    const edgeOf = (p) => (W(p.hw) + (T.edge === 'wall' ? 0.6 : 0)) * side;
    group.add(new THREE.Mesh(sweep(T, S, (p, s) => {
      const e = edgeOf(p);
      const bridge = !hasGround || p.loop || inRanges(T, s, def.bridges) || p.y < 0.3;
      return bridge ? [[e, UP * 0.5, 0], [e, -1.4, 1]] : [[e, UP * 0.5, 0], [e, -0.05, 1]];
    }, 8), skirtMat));
    if (hasGround) {
      const bank = new THREE.Mesh(sweep(T, S, (p, s) => {
        const e = edgeOf(p);
        if (p.loop || inRanges(T, s, def.bridges) || p.y < 0.3) return [[e, -0.1, 0], [e, -0.1, 0]];
        return [[e, -0.02, 0], [e + side * (p.y * 1.2 + 0.5), -p.y - 0.05, (p.y * 1.2) / 8]];
      }, 8), bankMat);
      bank.receiveShadow = true;
      group.add(bank);
    }
  }
  // Fond du tablier (visible sous les ponts et sur les circuits suspendus).
  group.add(new THREE.Mesh(sweep(T, S, (p) => {
    const e = W(p.hw) + (T.edge === 'wall' ? 0.6 : 0);
    return [[e, -1.4, 0], [-e, -1.4, 1]];
  }, 16), skirtMat));

  // Ligne de départ + portique.
  const hw0 = T.hw[0];
  const chk = TX.checkerTexture(12);
  const line = new THREE.Mesh(sweep(T, rangeS(-1.6, 1.6, 0.8), (p) => [[-p.hw, UP + 0.02, 0], [p.hw, UP + 0.02, 1]], 3.2),
    new THREE.MeshStandardMaterial({ map: chk, roughness: 0.8 }));
  group.add(line);
  {
    const p0 = T.pointAt(0, 0);
    const span = hw0 + (T.edge === 'wall' ? T.margin + 0.3 : 1.5);
    const pillarMat = new THREE.MeshStandardMaterial({ color: '#2a2a33', roughness: 0.6 });
    for (const side of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9, 1.2), pillarMat);
      pil.position.set(p0.x + p0.rx * span * side, p0.y + 4.5, p0.z + p0.rz * span * side);
      pil.castShadow = true;
      group.add(pil);
    }
    const bannerMat = new THREE.MeshStandardMaterial({ map: TX.bannerTexture('SPEEDKART'), roughness: 0.6, side: THREE.DoubleSide });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 + 1.2, 2.6), bannerMat);
    banner.position.set(p0.x, p0.y + 8, p0.z);
    banner.rotation.y = p0.yaw + Math.PI; // lisible par les pilotes qui arrivent
    banner.castShadow = true;
    group.add(banner);
  }

  // Tapis de vitesse.
  const boostTex = TX.boostTexture();
  const boostMat = new THREE.MeshStandardMaterial({ map: boostTex, emissiveMap: boostTex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.7, roughness: 0.4 });
  for (const b of T.boosts) {
    const lane = b.lane;
    group.add(new THREE.Mesh(sweep(T, rangeS(b.s0, b.s1, 1), (p) => {
      const c = lane * p.hw;
      return [[c - b.half, UP + 0.04, 0], [c + b.half, UP + 0.04, 1]];
    }, 4), boostMat));
  }
  animated.push((dt) => { boostTex.offset.y -= dt * 1.6; });

  // Tremplins.
  const rampTex = TX.rampTexture();
  const rampMat = new THREE.MeshStandardMaterial({ map: rampTex, roughness: 0.6, side: THREE.DoubleSide });
  for (const r of T.ramps) {
    const len = r.s1 - r.s0;
    group.add(new THREE.Mesh(sweep(T, rangeS(r.s0, r.s1, 0.5), (p, s) => {
      const h = UP + r.h * ((s - r.s0) / len);
      return [[-p.hw, UP, 0], [-p.hw, h, 0.1], [p.hw, h, 1], [p.hw, UP, 1.1]];
    }, 4), rampMat));
    group.add(new THREE.Mesh(sweep(T, [r.s1, r.s1 + 0.05], (p) => [[-p.hw, UP, 0], [-p.hw, UP + r.h, 0.2], [p.hw, UP + r.h, 0.8], [p.hw, UP, 1]], 1),
      new THREE.MeshStandardMaterial({ color: '#333', side: THREE.DoubleSide })));
  }

  // Boîtes à objets.
  const boxMat = new THREE.MeshStandardMaterial({
    map: TX.itemBoxTexture(), transparent: true, opacity: 0.95, roughness: 0.3,
  });
  boxMat.emissiveMap = boxMat.map;
  boxMat.emissive = new THREE.Color('#ffffff');
  boxMat.emissiveIntensity = 0.55;
  const boxGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
  const boxMeshes = T.boxes.map((b, i) => {
    const m = new THREE.Mesh(boxGeo, boxMat);
    m.position.set(b.x, b.y, b.z);
    m.castShadow = true;
    m.userData.phase = i * 0.7;
    group.add(m);
    return m;
  });
  animated.push((dt, t) => {
    for (const m of boxMeshes) {
      m.rotation.set(t * 0.9 + m.userData.phase, t * 1.3 + m.userData.phase, 0);
      m.position.y = T.boxes[boxMeshes.indexOf(m)].y + Math.sin(t * 2 + m.userData.phase) * 0.15;
      if (m.scale.x < 1) m.scale.setScalar(Math.min(1, m.scale.x + dt * 2.5));
    }
  });

  if (onProgress) onProgress(0.3);

  // ------------------------------------------------------------ décors
  const paths = theme.props.map((p) => p.m);
  if (theme.lamps) paths.push(theme.lamps.m);
  if (theme.pillar) paths.push(theme.pillar);
  const lib = await models(paths);
  if (onProgress) onProgress(0.8);
  const free = trackGrid(T);
  const placed = [];
  const isFree = (x, z, r) => placed.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + r + 1);

  function addProp(spec, x, y, z, yaw) {
    const obj = instanceSync(lib.get(spec.m), { height: spec.h * (0.8 + rand() * 0.4), tint: spec.tint === true ? `hsl(${Math.floor(rand() * 360)},85%,55%)` : spec.tint });
    obj.position.set(x, y, z);
    obj.rotation.y = yaw;
    if (spec.glow) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.softDot(), color: spec.glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      // Le modèle est agrandi : on compense pour garder une lueur en mètres.
      glow.scale.setScalar((spec.h * 1.6) / obj.scale.x);
      glow.position.y = (spec.h * 0.5) / obj.scale.x;
      obj.add(glow);
    }
    if (spec.lit) {
      obj.traverse((o) => {
        if (o.isMesh) {
          o.material = o.material.clone();
          o.material.emissive = new THREE.Color('#ffd98a');
          o.material.emissiveMap = o.material.map;
          o.material.emissiveIntensity = 0.35;
        }
      });
    }
    group.add(obj);
    return obj;
  }

  function radiusOf(spec) {
    const sz = lib.get(spec.m).size;
    const k = spec.h / Math.max(0.01, sz.y);
    return (Math.max(sz.x, sz.z) * k) / 2;
  }

  if (theme.islands) {
    // Îles de sable et d'herbe autour du tracé, avec la végétation dessus.
    const islandMat = new THREE.MeshStandardMaterial({ color: '#e8d59a', roughness: 1 });
    const grassMat = new THREE.MeshStandardMaterial({ color: '#6cc24a', roughness: 1 });
    let tries = 0;
    let count = 0;
    while (count < 40 && tries++ < 800) {
      const i = Math.floor(rand() * T.n);
      const side = rand() < 0.5 ? -1 : 1;
      const r = 12 + rand() * 30;
      const off = T.hw[i] + T.margin + r + 6 + rand() * 120;
      const x = T.px[i] + -T.fz[i] * off * side;
      const z = T.pz[i] + T.fx[i] * off * side;
      if (free(x, z, r + 3) < 0 || !isFree(x, z, r)) continue;
      placed.push({ x, z, r });
      const sand = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, 3, 28), islandMat);
      sand.position.set(x, theme.water.y + 0.6, z);
      sand.receiveShadow = true;
      const grass = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.78, r * 0.8, 3.2, 28), grassMat);
      grass.position.set(x, theme.water.y + 0.8, z);
      grass.receiveShadow = true;
      group.add(sand, grass);
      const nProps = Math.floor(r / 5);
      for (let k = 0; k < nProps; k++) {
        const spec = pickWeighted(theme.props, rand);
        const a = rand() * Math.PI * 2;
        const rr = rand() * r * 0.65;
        addProp(spec, x + Math.cos(a) * rr, theme.water.y + 2.4 + (spec.floatUp || 0), z + Math.sin(a) * rr, rand() * Math.PI * 2);
      }
      count++;
    }
  } else {
    const step = Math.max(1, Math.round(11 / T.ds));
    const rows = theme.rows || 1;
    for (let i = 0; i < T.n; i += step) {
      for (const side of [-1, 1]) {
        for (let row = 0; row < rows; row++) {
          if (rand() > theme.density) continue;
          const spec = pickWeighted(theme.props, rand);
          const r = radiusOf(spec);
          const base = T.hw[i] + T.margin + (T.edge === 'wall' ? 1.5 : 3) + r;
          const off = spec.near && row === 0 ? base + rand() * 5 : base + 4 + row * 30 + rand() * theme.spread;
          const rx = -T.fz[i] * side;
          const rz = T.fx[i] * side;
          const x = T.px[i] + rx * off;
          const z = T.pz[i] + rz * off;
          if (free(x, z, r) < 0 || !isFree(x, z, r)) continue;
          placed.push({ x, z, r });
          let y = hasGround ? 0 : T.py[i];
          if (theme.float) y = T.py[i] - 6 - rand() * 30 + (spec.floatUp ? spec.floatUp + 10 + rand() * 20 : 0);
          const yaw = spec.face ? Math.atan2(-rx, -rz) : rand() * Math.PI * 2;
          const obj = addProp(spec, x, y, z, yaw);
          if (theme.float || spec.floatUp) {
            const baseY = y;
            const ph = rand() * 10;
            animated.push((dt, t) => {
              obj.position.y = baseY + Math.sin(t * 0.7 + ph) * 1.2;
              if (spec.floatUp) obj.rotation.y += dt * 0.6;
            });
          }
        }
      }
    }
  }

  // Lampadaires réguliers.
  if (theme.lamps && T.edge === 'wall') {
    const L = theme.lamps;
    const glowTex = TX.softDot('rgba(255,230,160,1)', 'rgba(255,200,100,0)');
    let side = 1;
    for (let s = L.every / 2; s < T.length; s += L.every) {
      const p = T.pointAt(s, 0);
      if (p.loop) continue;
      const off = (p.hw + T.margin + 1.3) * side;
      const x = p.x + p.rx * off;
      const z = p.z + p.rz * off;
      const obj = instanceSync(lib.get(L.m), { height: L.h });
      obj.position.set(x, p.y, z);
      obj.rotation.y = L.face ? Math.atan2(-p.rx * side, -p.rz * side) : 0;
      group.add(obj);
      if (theme.night) {
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: L.light || '#ffe0a0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.scale.setScalar(9);
        glow.position.set(x - p.rx * side * 2.5, p.y + L.h - 0.5, z - p.rz * side * 2.5);
        group.add(glow);
      }
      side = -side;
    }
  }

  // Piliers sous les ponts (et colonnes des circuits suspendus).
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#b8b2a6', roughness: 0.8 });
  const lowRoad = (x, z, top) => {
    for (let i = 0; i < T.n; i++) {
      if (T.py[i] < top - 3 && Math.hypot(T.px[i] - x, T.pz[i] - z) < T.hw[i] + T.margin + 3) return true;
    }
    return false;
  };
  const pillarAt = (p, top, bottom) => {
    if (top - bottom < 1) return;
    if (lowRoad(p.x, p.z, top)) return;
    let obj;
    if (theme.pillar) {
      obj = instanceSync(lib.get(theme.pillar), { height: top - bottom });
    } else {
      obj = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, top - bottom, 12), pillarMat);
      obj.position.y = (top - bottom) / 2;
      const g = new THREE.Group();
      g.add(obj);
      obj.castShadow = true;
      obj = g;
    }
    obj.position.set(p.x, bottom, p.z);
    obj.rotation.y = p.yaw;
    group.add(obj);
  };
  if (hasGround) {
    for (let s = 0; s < T.length; s += 16) {
      if (!inRanges(T, s, def.bridges)) continue;
      const p = T.pointAt(s, 0);
      pillarAt(p, p.y - 1.4, 0);
    }
  } else if (theme.pillar) {
    for (let s = 20; s < T.length; s += 48) {
      const p = T.pointAt(s, 0);
      pillarAt(p, p.y - 1.4, p.y - 40);
    }
  }

  // Neige qui tombe autour de la caméra.
  let snow = null;
  if (theme.snowfall) {
    const n = 1500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(rand() - 0.5) * 120, rand() * 60, (rand() - 0.5) * 120], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    snow = new THREE.Points(g, new THREE.PointsMaterial({ map: TX.softDot(), color: '#ffffff', size: 0.5, transparent: true, depthWrite: false }));
    snow.frustumCulled = false;
    group.add(snow);
  }

  if (onProgress) onProgress(1);

  const focus = new THREE.Vector3();
  return {
    group,
    fog,
    sun,
    boxMeshes,
    background: new THREE.Color(theme.fog[0]),
    // mask : chaîne de '1' (présente) / '0' (ramassée)
    setBoxes(mask) {
      for (let i = 0; i < boxMeshes.length; i++) {
        const on = mask[i] !== '0';
        const m = boxMeshes[i];
        if (on && !m.visible) m.scale.setScalar(0.05);
        m.visible = on;
      }
    },
    hideBox(i) { if (boxMeshes[i]) boxMeshes[i].visible = false; },
    update(dt, t, camPos, target) {
      for (const fn of animated) fn(dt, t);
      sky.position.copy(camPos);
      focus.copy(target);
      sun.position.copy(focus).addScaledVector(sunDir, 150);
      sun.target.position.copy(focus);
      if (snow) {
        snow.position.set(camPos.x, camPos.y - 20, camPos.z);
        const a = snow.geometry.attributes.position;
        for (let i = 0; i < a.count; i++) {
          let y = a.getY(i) - dt * 6;
          if (y < 0) y += 60;
          a.setY(i, y);
          a.setX(i, a.getX(i) + Math.sin(t + i) * dt * 0.8);
        }
        a.needsUpdate = true;
      }
    },
  };
}
