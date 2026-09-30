// Géométrie logique d'un circuit : une boucle fermée de points de contrôle lissée en Catmull-Rom,
// rééchantillonnée à pas constant. Sert à la physique, à l'IA, aux objets et au rendu.
// Aucune dépendance : tourne aussi bien dans le navigateur que dans les tests Node.

import { clamp } from './util.js';

const STEP = 2; // mètres entre deux échantillons
const SUB = 48; // sous-pas par segment de contrôle avant rééchantillonnage
const WINDOW = 24; // recherche locale autour du dernier échantillon connu

// Catmull-Rom centripète (Barry-Goldman) sur un segment p1 -> p2.
function catmull(p0, p1, p2, p3, t, out) {
  const d = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)));
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const u = t1 + (t2 - t1) * t;
  for (const k of ['x', 'y', 'z', 'w']) {
    const a1 = ((t1 - u) * p0[k] + (u - t0) * p1[k]) / (t1 - t0);
    const a2 = ((t2 - u) * p1[k] + (u - t1) * p2[k]) / (t2 - t1);
    const a3 = ((t3 - u) * p2[k] + (u - t2) * p3[k]) / (t3 - t2);
    const b1 = ((t2 - u) * a1 + (u - t0) * a2) / (t2 - t0);
    const b2 = ((t3 - u) * a2 + (u - t1) * a3) / (t3 - t1);
    out[k] = ((t2 - u) * b1 + (u - t1) * b2) / (t2 - t1);
  }
  return out;
}

export class TrackPath {
  constructor(def) {
    this.def = def;
    this.margin = def.margin ?? 6; // bande hors-piste (herbe, sable...) avant le mur ou le vide
    this.edge = def.edge || 'wall'; // 'wall' : on rebondit ; 'void' : on tombe
    const width = def.width ?? 18;
    const sc = def.scale ?? 1.25; // agrandit le tracé à plat (pas la largeur ni les hauteurs)
    const cps = def.points.map((p) => ({ x: p[0] * sc, z: p[1] * sc, y: p[2] ?? 0, w: p[3] ?? width }));
    const n0 = cps.length;

    // 1. Polyligne dense.
    const dense = [];
    const tmp = {};
    for (let i = 0; i < n0; i++) {
      const p0 = cps[(i - 1 + n0) % n0];
      const p1 = cps[i];
      const p2 = cps[(i + 1) % n0];
      const p3 = cps[(i + 2) % n0];
      for (let j = 0; j < SUB; j++) {
        catmull(p0, p1, p2, p3, j / SUB, tmp);
        dense.push({ x: tmp.x, y: tmp.y, z: tmp.z, w: tmp.w });
      }
    }
    // Longueurs cumulées (boucle fermée).
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1];
      const b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    const L = cum[dense.length];
    const n = Math.max(16, Math.round(L / STEP));
    this.n = n;
    this.length = L;
    this.ds = L / n;

    // 2. Rééchantillonnage à pas constant.
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.hw = new Float32Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const s = i * this.ds;
      while (cum[j + 1] < s) j++;
      const a = dense[j];
      const b = dense[(j + 1) % dense.length];
      const t = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      this.px[i] = a.x + (b.x - a.x) * t;
      this.py[i] = a.y + (b.y - a.y) * t;
      this.pz[i] = a.z + (b.z - a.z) * t;
      this.hw[i] = (a.w + (b.w - a.w) * t) / 2;
    }

    // 3. Repères locaux : avant horizontal (fx, fz), droite (rx, rz), pente.
    this.fx = new Float32Array(n);
    this.fz = new Float32Array(n);
    this.slope = new Float32Array(n);
    this.yaw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      let dx = this.px[b] - this.px[a];
      let dz = this.pz[b] - this.pz[a];
      const h = Math.hypot(dx, dz) || 1;
      dx /= h;
      dz /= h;
      this.fx[i] = dx;
      this.fz[i] = dz;
      this.slope[i] = (this.py[b] - this.py[a]) / h;
      this.yaw[i] = Math.atan2(dx, dz);
    }

    // 4. Éléments le long de la piste (positions données en fraction du tour).
    this.ramps = (def.ramps || []).map(([at, len = 10, h = 2.2]) => {
      const s0 = at * L;
      return { s0, s1: s0 + len, h };
    });
    this.boosts = (def.boosts || []).map(([at, lane = 0, len = 8]) => {
      const s0 = at * L;
      return { s0, s1: s0 + len, lane, half: 2.6 };
    });
    this.itemRows = (def.items || []).map((at) => at * L);
    this.boxes = [];
    for (const s of this.itemRows) {
      const hw = this.hw[this.indexAt(s)];
      const count = hw > 10 ? 5 : 4;
      for (let k = 0; k < count; k++) {
        const lat = (-1 + (2 * (k + 0.5)) / count) * hw * 0.78;
        const p = this.pointAt(s, lat);
        this.boxes.push({ x: p.x, y: p.y + 1.1, z: p.z, s });
      }
    }
  }

  indexAt(s) {
    const n = this.n;
    return ((Math.floor(this.wrapS(s) / this.ds) % n) + n) % n;
  }

  wrapS(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  // Écart signé de b par rapport à a le long de la boucle, dans [-L/2, L/2].
  deltaS(a, b) {
    const L = this.length;
    let d = (b - a) % L;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  // Point sur la piste à l'abscisse s et au décalage latéral lat (mètres, + à droite).
  pointAt(s, lat = 0, out = {}) {
    s = this.wrapS(s);
    const i = Math.floor(s / this.ds) % this.n;
    const k = (i + 1) % this.n;
    const t = s / this.ds - Math.floor(s / this.ds);
    const fx = this.fx[i] + (this.fx[k] - this.fx[i]) * t;
    const fz = this.fz[i] + (this.fz[k] - this.fz[i]) * t;
    const h = Math.hypot(fx, fz) || 1;
    out.fx = fx / h;
    out.fz = fz / h;
    out.rx = -out.fz;
    out.rz = out.fx;
    out.x = this.px[i] + (this.px[k] - this.px[i]) * t + out.rx * lat;
    out.z = this.pz[i] + (this.pz[k] - this.pz[i]) * t + out.rz * lat;
    out.y = this.py[i] + (this.py[k] - this.py[i]) * t;
    out.hw = this.hw[i] + (this.hw[k] - this.hw[i]) * t;
    out.yaw = Math.atan2(out.fx, out.fz);
    out.i = i;
    return out;
  }

  // Projette une position sur la piste. hint : dernier indice connu (-1 : recherche globale).
  query(x, y, z, hint = -1, out = {}) {
    const n = this.n;
    let best = 0;
    let bd = Infinity;
    const scan = (i) => {
      const dx = this.px[i] - x;
      const dz = this.pz[i] - z;
      const dy = (this.py[i] - y) * 3; // favorise l'étage où se trouve le kart (ponts)
      const d = dx * dx + dz * dz + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    };
    if (hint < 0) for (let i = 0; i < n; i++) scan(i);
    else for (let k = -WINDOW; k <= WINDOW; k++) scan((hint + k + n) % n);

    // Affinage sur le segment voisin le plus proche.
    const prev = (best - 1 + n) % n;
    const next = (best + 1) % n;
    const proj = (a, b) => {
      const ex = this.px[b] - this.px[a];
      const ez = this.pz[b] - this.pz[a];
      const u = clamp(((x - this.px[a]) * ex + (z - this.pz[a]) * ez) / (ex * ex + ez * ez || 1), 0, 1);
      const cx = this.px[a] + ex * u;
      const cz = this.pz[a] + ez * u;
      return { a, b, u, d2: (x - cx) ** 2 + (z - cz) ** 2 };
    };
    const p1 = proj(prev, best);
    const p2 = proj(best, next);
    const seg = p1.d2 < p2.d2 ? p1 : p2;
    const { a, b, u } = seg;

    const cx = this.px[a] + (this.px[b] - this.px[a]) * u;
    const cz = this.pz[a] + (this.pz[b] - this.pz[a]) * u;
    let fx = this.fx[a] + (this.fx[b] - this.fx[a]) * u;
    let fz = this.fz[a] + (this.fz[b] - this.fz[a]) * u;
    const fh = Math.hypot(fx, fz) || 1;
    fx /= fh;
    fz /= fh;
    const rx = -fz;
    const rz = fx;
    const s = this.wrapS(a * this.ds + u * this.ds);
    const d = (x - cx) * rx + (z - cz) * rz;

    out.i = best;
    out.s = s;
    out.d = d;
    out.hw = this.hw[a] + (this.hw[b] - this.hw[a]) * u;
    out.fx = fx;
    out.fz = fz;
    out.rx = rx;
    out.rz = rz;
    out.slope = this.slope[a] + (this.slope[b] - this.slope[a]) * u;
    out.roadY = this.py[a] + (this.py[b] - this.py[a]) * u;
    out.ramp = 0;
    out.y = out.roadY;
    if (Math.abs(d) <= out.hw) {
      for (const r of this.ramps) {
        const k = this.deltaS(r.s0, s);
        if (k >= 0 && k <= r.s1 - r.s0) {
          out.ramp = k / (r.s1 - r.s0);
          out.y += r.h * out.ramp;
        }
      }
    }
    return out;
  }

  // Tapis de vitesse sous la position projetée q ?
  onBoost(q) {
    for (const b of this.boosts) {
      const k = this.deltaS(b.s0, q.s);
      if (k >= 0 && k <= b.s1 - b.s0 && Math.abs(q.d - b.lane * q.hw) <= b.half) return true;
    }
    return false;
  }

  // Emplacement de départ n° slot (0 = pole position), derrière la ligne.
  gridSlot(slot) {
    const row = Math.floor(slot / 2);
    const s = -10 - row * 7 - (slot % 2) * 3.5;
    const hw = this.hw[0];
    const lat = (slot % 2 === 0 ? -1 : 1) * hw * 0.42;
    const p = this.pointAt(s, lat);
    return { s, lat, x: p.x, y: p.y, z: p.z, yaw: p.yaw };
  }

  // Virage à venir : écart d'angle entre la direction en s et celle en s + ahead.
  turnAhead(s, ahead) {
    const i = this.indexAt(s);
    const k = this.indexAt(s + ahead);
    let d = this.yaw[k] - this.yaw[i];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
}
