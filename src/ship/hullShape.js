// B-29 hull definition shared by the exterior skin, the inner pressure-hull wall and the
// collision / damage code. Ship frame: +X starboard, +Y up, -Z forward (nose), +Z aft.
import * as THREE from 'three';

export const HULL = {
  zTip: -13.4,
  zNose: -9.0,
  zTail0: 4.6,
  zTail1: 10.7,
  a: 3.05, b: 2.55, c: 0.4, n: 2.8,
  inset: 0.22,
};

export const DECK_Y = 0;          // main deck floor
export const LOWER_Y = -1.55;     // underfloor walkway level
export const Z_COCKPIT_BULK = -8.4;
export const Z_ENG_BULK = 5.6;
export const Z_REACTOR_BULK = 9.6;
export const CORRIDOR_X = 0.7;

/** cross-section parameters at station z (outer skin) */
export function hullAt(z, inset = 0) {
  const H = HULL;
  let a = H.a, b = H.b, c = H.c, n = H.n;
  if (z < H.zNose) {
    const u = Math.min(1, (H.zNose - z) / (H.zNose - H.zTip));
    const k = Math.sqrt(Math.max(0, 1 - u * u));
    a = H.a * Math.pow(k, 0.92);
    b = H.b * Math.pow(k, 0.98);
    c = H.c + 0.42 * u * u;
    n = H.n - 0.75 * u;
  } else if (z > H.zTail0) {
    const u = Math.min(1, (z - H.zTail0) / (H.zTail1 - H.zTail0));
    const s = u * u * (3 - 2 * u);
    a = H.a - 1.32 * s;
    b = H.b - 0.82 * s;
    n = H.n - 0.55 * s;
  }
  a = Math.max(0.001, a - inset);
  b = Math.max(0.001, b - inset);
  return { a, b, c, n };
}

const sgnpow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

/** point on the superellipse section at parameter t (0 = starboard, PI/2 = top) */
export function sectionPoint(z, t, inset = 0, out = new THREE.Vector3()) {
  const { a, b, c, n } = hullAt(z, inset);
  const e = 2 / n;
  return out.set(a * sgnpow(Math.cos(t), e), c + b * sgnpow(Math.sin(t), e), z);
}

/** outward normal (approx) at section parameter t */
export function sectionNormal(z, t, inset = 0, out = new THREE.Vector3()) {
  const dz = 0.02, dt = 0.004;
  const p = sectionPoint(z, t, inset);
  const pt = sectionPoint(z, t + dt, inset).sub(p);
  const pz = sectionPoint(z + dz, t, inset).sub(p);
  return out.crossVectors(pt, pz).normalize();
}

/** half width of the section at height y (0 if outside) */
export function halfWidthAt(z, y, inset = 0) {
  const { a, b, c, n } = hullAt(z, inset);
  const v = Math.abs((y - c) / b);
  if (v >= 1) return 0;
  return a * Math.pow(1 - Math.pow(v, n), 1 / n);
}

/** top / bottom y at lateral position x (NaN if outside) */
export function heightRangeAt(z, x, inset = 0) {
  const { a, b, c, n } = hullAt(z, inset);
  const u = Math.abs(x / a);
  if (u >= 1) return [NaN, NaN];
  const h = b * Math.pow(1 - Math.pow(u, n), 1 / n);
  return [c - h, c + h];
}

/** find section parameter t for a point direction from the section centre */
export function tForPoint(z, x, y, inset = 0) {
  const { a, b, c, n } = hullAt(z, inset);
  // solve for t via angle in normalised space
  const X = x / a, Y = (y - c) / b;
  const ang = Math.atan2(Y, X);
  // invert sgnpow mapping: cos t ~ sign*|X'|^(n/2)
  const cx = Math.cos(ang), sy = Math.sin(ang);
  const r = Math.pow(Math.pow(Math.abs(cx), n) + Math.pow(Math.abs(sy), n), 1 / n);
  const xn = cx / r, yn = sy / r;
  const ct = sgnpow(xn, n / 2), st = sgnpow(yn, n / 2);
  return Math.atan2(st, ct);
}

/**
 * Hull openings (windows / hatches). Each: centre on outer skin, local frame and half sizes.
 * kind: 'win' glass window, 'hatch' airlock door, 'port' the dorsal docking port
 */
export function makeOpening(name, z, t, halfW, halfH, radius, kind = 'win', room = null) {
  const c = sectionPoint(z, t, 0);
  const n = sectionNormal(z, t, 0);
  // v axis along the ship (projected onto tangent plane), u = v x n
  const zAxis = new THREE.Vector3(0, 0, 1);
  const v = zAxis.clone().sub(n.clone().multiplyScalar(zAxis.dot(n))).normalize();
  const u = new THREE.Vector3().crossVectors(n, v).normalize();
  return { name, z, t, center: c, normal: n, u, v, halfW, halfH, radius, kind, room };
}

export const OPENINGS = [
  // living room (port side): big oval + two portholes
  makeOpening('liv_big', -6.2, Math.PI - 0.2, 0.44, 0.68, 0.36, 'win', 'living'),
  makeOpening('liv_p1', -7.75, Math.PI - 0.3, 0.17, 0.17, 0.17, 'win', 'living'),
  makeOpening('liv_p2', -4.55, Math.PI - 0.3, 0.17, 0.17, 0.17, 'win', 'living'),
  // bunk porthole (port)
  makeOpening('bunk_p', -1.4, Math.PI - 0.12, 0.16, 0.16, 0.16, 'win', 'corridor'),
  // bathroom porthole (starboard)
  makeOpening('bath_p', -6.4, 0.42, 0.17, 0.17, 0.17, 'win', 'bath'),
  // corridor skylight
  makeOpening('sky', -0.9, Math.PI / 2, 0.3, 0.3, 0.3, 'win', 'corridor'),
  // engineering porthole (starboard)
  makeOpening('eng_p', 7.2, 0.3, 0.15, 0.15, 0.15, 'win', 'eng'),
  // airlock outer hatch (starboard)
  makeOpening('hatch', -1.05, 0.18, 0.84, 0.44, 0.4, 'hatch', 'airlock'),
  // dorsal docking port over the corridor (H8 rides here); kept last so saved indices hold
  makeOpening('port', 1.15, Math.PI / 2, 0.47, 0.47, 0.47, 'port', 'corridor'),
];

export function openingByName(n) { return OPENINGS.find((o) => o.name === n); }

/**
 * Cockpit canopy: the part of the nose in front of a tilted plane is glazed, split by mullions.
 * plane: points p with dot(p - P0, N) > 0 are canopy.
 */
export const CANOPY = {
  P0: new THREE.Vector3(0, 0.7, -13.45),
  N: new THREE.Vector3(0, 0.807, -0.59).normalize(),
  mullX: [-0.62, 0.62],   // vertical bars (x planes)
  mullY: [1.78],          // horizontal bar (y plane)
  barHalf: 0.04,
};

export function canopyF(p) {
  const C = CANOPY;
  return (p.x - C.P0.x) * C.N.x + (p.y - C.P0.y) * C.N.y + (p.z - C.P0.z) * C.N.z;
}
export function inCanopy(p) { return canopyF(p) > 0; }
/** z where the canopy plane crosses the section line at parameter t (bisection) */
export function canopyZ(t, inset = 0) {
  let lo = HULL.zTip + 0.0005, hi = -9.5;
  const f = (z) => canopyF(sectionPoint(z, t, inset));
  if (f(lo) <= 0) return null;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

export function onMullion(p) {
  const C = CANOPY;
  for (const x of C.mullX) if (Math.abs(p.x - x) < C.barHalf) return true;
  for (const y of C.mullY) if (Math.abs(p.y - y) < C.barHalf) return true;
  return false;
}
