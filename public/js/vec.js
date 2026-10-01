// Vecteurs [x, y, z] et quaternions [x, y, z, w] pour la physique 3D des arènes.
// Fonctions simples sur des tableaux : pas de dépendance, utilisables dans les tests Node.

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const addScaled = (a, b, k) => { a[0] += b[0] * k; a[1] += b[1] * k; a[2] += b[2] * k; return a; };
export const set = (a, b) => { a[0] = b[0]; a[1] = b[1]; a[2] = b[2]; return a; };
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Rotation d'un vecteur par un quaternion.
export function qRot(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

export const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
export const qRotInv = (q, v) => qRot(qConj(q), v);

export function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function qNorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
  return q;
}

export function qAxisAngle(axis, angle) {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

export const qYaw = (yaw) => qAxisAngle([0, 1, 0], yaw);

// Intègre une vitesse angulaire (repère monde) sur dt.
export function qIntegrate(q, w, dt) {
  const ang = len(w) * dt;
  if (ang < 1e-9) return q;
  const r = qAxisAngle(scale(w, 1 / len(w)), ang);
  const out = qMul(r, q);
  q[0] = out[0]; q[1] = out[1]; q[2] = out[2]; q[3] = out[3];
  return qNorm(q);
}

// Plus courte rotation qui amène le vecteur unitaire u sur v.
export function qFromTo(u, v) {
  const d = dot(u, v);
  if (d > 0.999999) return [0, 0, 0, 1];
  if (d < -0.999999) {
    let axis = cross([1, 0, 0], u);
    if (len(axis) < 1e-6) axis = cross([0, 0, 1], u);
    return qAxisAngle(norm(axis), Math.PI);
  }
  const c = cross(u, v);
  return qNorm([c[0], c[1], c[2], 1 + d]);
}

export function qSlerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (cos > 0.9995) return qNorm([a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t]);
  const th = Math.acos(cos);
  const s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s;
  const kb = Math.sin(t * th) / s;
  return [a[0] * ka + bx * kb, a[1] * ka + by * kb, a[2] * ka + bz * kb, a[3] * ka + bw * kb];
}

// Cap (angle autour de Y) de l'avant (+Z local) d'une orientation.
export function yawOf(q) {
  const f = qRot(q, [0, 0, 1]);
  return Math.atan2(f[0], f[2]);
}
