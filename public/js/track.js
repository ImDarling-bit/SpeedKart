// Géométrie logique d'un circuit : une boucle fermée de points de contrôle lissée en Catmull-Rom,
// rééchantillonnée à pas constant. Sert à la physique, à l'IA, aux objets et au rendu.
// Les loopings sont insérés dans le tracé : la route s'enroule à 360° (avec un décalage latéral
// pour que l'entrée et la sortie ne se chevauchent pas).
// Aucune dépendance : tourne aussi bien dans le navigateur que dans les tests Node.

import { clamp } from './util.js';

const STEP = 2; // mètres entre deux échantillons
const SUB = 48; // sous-pas par segment de contrôle avant rééchantillonnage
const WINDOW = 24; // recherche locale autour du dernier échantillon connu
const LOOP_FADE = 90; // longueur du décalage latéral avant et après un looping

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

const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

function cumulative(dense) {
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  return cum;
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
    let dense = [];
    const tmp = {};
    for (let i = 0; i < n0; i++) {
      const p0 = cps[(i - 1 + n0) % n0];
      const p1 = cps[i];
      const p2 = cps[(i + 1) % n0];
      const p3 = cps[(i + 2) % n0];
      for (let j = 0; j < SUB; j++) {
        catmull(p0, p1, p2, p3, j / SUB, tmp);
        dense.push({ x: tmp.x, y: tmp.y, z: tmp.z, w: tmp.w, lp: -1, th: 0 });
      }
    }
    let cum = cumulative(dense);

    // 2. Loopings, du dernier au premier pour garder les indices valides.
    this.loopDefs = [];
    const inserted = [];
    const L0 = cum[dense.length];
    const loops = (def.loops || []).map(([at, R = 12], idx) => ({ at, R, idx })).sort((a, b) => b.at - a.at);
    for (const lo of loops) {
      const target = lo.at * L0;
      let k = 0;
      while (k < dense.length - 1 && cum[k + 1] <= target) k++;
      const N = dense.length;
      const a = dense[(k - 3 + N) % N];
      const b = dense[(k + 3) % N];
      let fx = b.x - a.x;
      let fz = b.z - a.z;
      const fh = Math.hypot(fx, fz) || 1;
      fx /= fh;
      fz /= fh;
      const rx = -fz;
      const rz = fx;
      const hw = dense[k].w / 2;
      const shift = 2 * (hw + this.margin + 0.6) + 2.5;
      const Ltot = cum[N];
      // Décalage latéral progressif : -shift/2 avant, +shift/2 après, retour au tracé ensuite.
      for (let j = 0; j < N; j++) {
        let ds = (cum[j] - cum[k]) % Ltot;
        if (ds > Ltot / 2) ds -= Ltot;
        if (ds < -Ltot / 2) ds += Ltot;
        let o = 0;
        if (j === k) o = -shift / 2;
        else if (ds < 0 && ds >= -LOOP_FADE) o = (-shift / 2) * smooth((ds + LOOP_FADE) / LOOP_FADE);
        else if (ds > 0 && ds <= LOOP_FADE) o = (shift / 2) * (1 - smooth(ds / LOOP_FADE));
        dense[j].x += rx * o;
        dense[j].z += rz * o;
      }
      const base = { ...dense[k] };
      const R = lo.R;
      const n = Math.ceil((2 * Math.PI * R) / 1.0);
      const pts = [];
      for (let j = 1; j < n; j++) {
        const th = (2 * Math.PI * j) / n;
        const lat = (shift * j) / n;
        pts.push({
          x: base.x + fx * R * Math.sin(th) + rx * lat,
          y: base.y + R * (1 - Math.cos(th)),
          z: base.z + fz * R * Math.sin(th) + rz * lat,
          w: base.w,
          lp: lo.idx,
          th,
        });
      }
      const before = cum[dense.length];
      dense.splice(k + 1, 0, ...pts);
      cum = cumulative(dense);
      inserted.push({ at: target, add: cum[dense.length] - before });
      this.loopDefs[lo.idx] = { R, fx, fz, rx, rz, yaw: Math.atan2(fx, fz), shift };
    }

    const L = cum[dense.length];
    // Les positions des éléments (tapis, tremplins, boîtes) sont données sur le tracé d'origine :
    // on les décale de la longueur des loopings insérés avant elles.
    const mapAt = (f) => {
      const s0 = f * L0;
      let s = s0;
      for (const ins of inserted) if (ins.at < s0) s += ins.add;
      return s;
    };
    const n = Math.max(16, Math.round(L / STEP));
    this.n = n;
    this.length = L;
    this.ds = L / n;

    // 3. Rééchantillonnage à pas constant.
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.hw = new Float32Array(n);
    this.lp = new Int16Array(n); // n° de looping, -1 sinon
    this.th = new Float32Array(n); // angle dans le looping
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
      const inLoop = a.lp >= 0 && b.lp >= 0;
      this.lp[i] = inLoop ? a.lp : -1;
      this.th[i] = inLoop ? a.th + (b.th - a.th) * t : 0;
    }

    // 4. Repères locaux : avant horizontal (fx, fz), droite (rx, rz), haut (u), pente.
    this.fx = new Float32Array(n);
    this.fz = new Float32Array(n);
    this.slope = new Float32Array(n);
    this.yaw = new Float32Array(n);
    this.ux = new Float32Array(n);
    this.uy = new Float32Array(n);
    this.uz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (this.lp[i] >= 0) {
        // Dans un looping : cap constant, « haut » tourné vers le centre de la boucle.
        const L2 = this.loopDefs[this.lp[i]];
        const th = this.th[i];
        this.fx[i] = L2.fx;
        this.fz[i] = L2.fz;
        this.yaw[i] = L2.yaw;
        this.ux[i] = -L2.fx * Math.sin(th);
        this.uy[i] = Math.cos(th);
        this.uz[i] = -L2.fz * Math.sin(th);
        continue;
      }
      const a = this.prevNL(i);
      const b = this.nextNL(i);
      let dx = this.px[b] - this.px[a];
      let dz = this.pz[b] - this.pz[a];
      // Pas de raccourci à travers un looping : on prend le voisin direct dans ce cas.
      if (this.gap(a, i)) { dx = this.px[b] - this.px[i]; dz = this.pz[b] - this.pz[i]; }
      if (this.gap(i, b)) { dx = this.px[i] - this.px[a]; dz = this.pz[i] - this.pz[a]; }
      const h = Math.hypot(dx, dz) || 1;
      dx /= h;
      dz /= h;
      this.fx[i] = dx;
      this.fz[i] = dz;
      this.slope[i] = this.gap(a, i) || this.gap(i, b) ? 0 : (this.py[b] - this.py[a]) / h;
      this.yaw[i] = Math.atan2(dx, dz);
      this.uy[i] = 1;
    }

    // Plages de looping : dernier échantillon avant (i0), premier après (i1).
    this.loops = [];
    for (let i = 0; i < n; i++) {
      if (this.lp[i] >= 0 && this.lp[(i - 1 + n) % n] < 0) {
        let e = i;
        while (this.lp[(e + 1) % n] >= 0) e = (e + 1) % n;
        const i0 = (i - 1 + n) % n;
        const i1 = (e + 1) % n;
        const L2 = this.loopDefs[this.lp[i]];
        this.loops.push({ ...L2, i0, i1, s0: i0 * this.ds, s1: i0 * this.ds + this.deltaS(i0 * this.ds, i1 * this.ds), id: this.loops.length });
      }
    }

    // 5. Éléments le long de la piste (positions données en fraction du tour).
    this.ramps = (def.ramps || []).map(([at, len = 10, h = 2.2]) => {
      const s0 = mapAt(at);
      return { s0, s1: s0 + len, h };
    });
    this.boosts = (def.boosts || []).map(([at, lane = 0, len = 8]) => {
      const s0 = mapAt(at);
      return { s0, s1: s0 + len, lane, half: 2.6 };
    });
    this.itemRows = (def.items || []).map((at) => mapAt(at));
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

  // Voisins en sautant les échantillons d'un looping.
  nextNL(i) {
    let k = (i + 1) % this.n;
    while (this.lp[k] >= 0) k = (k + 1) % this.n;
    return k;
  }

  prevNL(i) {
    let k = (i - 1 + this.n) % this.n;
    while (this.lp[k] >= 0) k = (k - 1 + this.n) % this.n;
    return k;
  }

  // Vrai si deux échantillons non-looping consécutifs sont séparés par un looping.
  gap(a, b) {
    return (a + 1) % this.n !== b;
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
    let ux = this.ux[i] + (this.ux[k] - this.ux[i]) * t;
    let uy = this.uy[i] + (this.uy[k] - this.uy[i]) * t;
    let uz = this.uz[i] + (this.uz[k] - this.uz[i]) * t;
    const uh = Math.hypot(ux, uy, uz) || 1;
    out.ux = ux / uh;
    out.uy = uy / uh;
    out.uz = uz / uh;
    out.yaw = Math.atan2(out.fx, out.fz);
    out.loop = this.lp[i] >= 0 || this.lp[k] >= 0;
    out.i = i;
    return out;
  }

  // Projette une position sur la piste (hors loopings). hint : dernier indice connu (-1 : global).
  query(x, y, z, hint = -1, out = {}) {
    const n = this.n;
    let best = -1;
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
    if (hint < 0 || this.lp[hint] >= 0) {
      for (let i = 0; i < n; i++) if (this.lp[i] < 0) scan(i);
    } else {
      scan(hint);
      let a = hint;
      let b = hint;
      for (let k = 0; k < WINDOW; k++) {
        a = this.prevNL(a);
        b = this.nextNL(b);
        scan(a);
        scan(b);
      }
    }

    // Affinage sur le segment voisin le plus proche (sauf à travers un looping).
    const prev = this.prevNL(best);
    const next = this.nextNL(best);
    const proj = (a, b) => {
      const ex = this.px[b] - this.px[a];
      const ez = this.pz[b] - this.pz[a];
      const u = clamp(((x - this.px[a]) * ex + (z - this.pz[a]) * ez) / (ex * ex + ez * ez || 1), 0, 1);
      const cx = this.px[a] + ex * u;
      const cz = this.pz[a] + ez * u;
      return { a, b, u, d2: (x - cx) ** 2 + (z - cz) ** 2 };
    };
    const cands = [];
    if (!this.gap(prev, best)) cands.push(proj(prev, best));
    if (!this.gap(best, next)) cands.push(proj(best, next));
    if (!cands.length) cands.push({ a: best, b: best, u: 0, d2: 0 });
    const seg = cands.length > 1 && cands[1].d2 < cands[0].d2 ? cands[1] : cands[0];
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

  // Looping dont l'entrée vient d'être franchie (avancée positive depuis i0), sinon null.
  loopEntered(q, x, y, z) {
    for (const L of this.loops) {
      const near = q.i === L.i0 || q.i === this.prevNL(L.i0) || q.i === this.prevNL(this.prevNL(L.i0));
      if (!near) continue;
      const along = (x - this.px[L.i0]) * L.fx + (z - this.pz[L.i0]) * L.fz;
      if (along >= 0 && Math.abs(y - this.py[L.i0]) < 2.5) return { loop: L, along };
    }
    return null;
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
