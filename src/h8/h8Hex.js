// H8's armour tiles: hexagons over the sphere (and the twelve pentagons any ball of hexagons needs),
// the cells round the points of a geodesic sphere — each tile is the part of the surface nearer its
// own point than any other. So the tile under a direction is the point it is nearest, and a tile is
// gone from a pixel wherever its point is nearer than each of its neighbours' (h8Dents.js does that
// on the GPU with the tile's point and its five or six neighbours').
// One tile, high on the port quarter, is red: the hatch of the K3 robots' bay. It is never knocked
// off.
import * as THREE from 'three';
import { exclusions } from './h8Spec.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// subdivisions of each of the icosahedron's edges: 10 f^2 + 2 tiles (252), about 0.9 m across on H8
const FREQ = 5;

function icosphere(f) {
  const t = (1 + Math.sqrt(5)) / 2;
  const base = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => V(...p).normalize());
  const faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const verts = [], key = new Map(), tris = [];
  const id = (p) => {
    const u = p.clone().normalize();
    const k = `${Math.round(u.x * 1e5)},${Math.round(u.y * 1e5)},${Math.round(u.z * 1e5)}`;
    if (!key.has(k)) { key.set(k, verts.length); verts.push(u); }
    return key.get(k);
  };
  for (const [a, b, c] of faces) {
    const A = base[a], B = base[b], C = base[c];
    // the face's grid of points: (i, j) with i + j <= f
    const P = (i, j) => id(A.clone().multiplyScalar(1 - (i + j) / f).addScaledVector(B, i / f).addScaledVector(C, j / f));
    for (let i = 0; i < f; i++) for (let j = 0; j < f - i; j++) {
      tris.push([P(i, j), P(i + 1, j), P(i, j + 1)]);
      if (i + j < f - 1) tris.push([P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)]);
    }
  }
  return { verts, tris };
}

function build() {
  const { verts, tris } = icosphere(FREQ);
  const nb = verts.map(() => new Set()), corners = verts.map(() => []);
  for (const [a, b, c] of tris) {
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
    // the triangle's circumcentre on the sphere: a corner of each of its three cells
    const A = verts[a], B = verts[b], C = verts[c];
    const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A)).normalize();
    if (n.dot(A) < 0) n.negate();
    corners[a].push(n); corners[b].push(n); corners[c].push(n);
  }
  const ex = exclusions();
  const tiles = verts.map((c, i) => {
    // the cell's corners in order round its point
    const ax = new THREE.Vector3().crossVectors(Math.abs(c.y) < 0.95 ? V(0, 1, 0) : V(1, 0, 0), c).normalize();
    const ay = new THREE.Vector3().crossVectors(c, ax);
    const poly = corners[i].slice().sort((p, q) => Math.atan2(p.dot(ay), p.dot(ax)) - Math.atan2(q.dot(ay), q.dot(ax)));
    const lat = Math.asin(Math.max(-1, Math.min(1, c.y)));
    // (a tile centred under a fitting's footprint is left out: its base covers the place)
    const excluded = ex.some((e) => c.angleTo(e.dir) < e.ang + 0.03);
    return { id: i, c, nb: [...nb[i]], poly, lat, excluded, equator: Math.abs(lat) < 0.105, red: false };
  });
  // the K3 bay's red hatch: the free tile nearest a spot high on the port quarter (clear of the
  // gun rails, the handrails, the cameras and thrusters)
  const want = V(-0.617, 0.707, 0.346).normalize();
  let best = null;
  for (const t of tiles) {
    if (t.excluded || ex.some((e) => t.c.angleTo(e.dir) < e.ang + 0.25)) continue;
    if (!best || t.c.dot(want) > best.c.dot(want)) best = t;
  }
  if (best) best.red = true;
  return { tiles, red: best ? best.id : -1 };
}

export const HEX = build();

/** the tile nearest a direction from H8's centre (its index), or -1 */
export function hexAt(dir) {
  let best = -1, bd = -2;
  for (const t of HEX.tiles) { const d = t.c.dot(dir); if (d > bd) { bd = d; best = t.id; } }
  return best;
}

/**
 * the tile's outline pulled in by `inset` metres all round (in its tangent plane at its point): 2D
 * points [u, v] and the frame { c, ax, ay } they are in
 */
export function hexOutline(t, inset) {
  const c = t.c;
  const ax = new THREE.Vector3().crossVectors(Math.abs(c.y) < 0.95 ? V(0, 1, 0) : V(1, 0, 0), c).normalize();
  const ay = new THREE.Vector3().crossVectors(c, ax);
  // the corners projected onto the tangent plane (gnomonic: straight edges stay straight)
  const P = t.poly.map((p) => { const k = 1 / p.dot(c); return [p.dot(ax) * k, p.dot(ay) * k]; });
  if (!inset) return { pts: P, c, ax, ay };
  // each edge moved inward by inset, the new corners where the moved edges meet
  const n = P.length, lines = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % n];
    let nx = -(y1 - y0), ny = x1 - x0;
    const l = Math.hypot(nx, ny);
    nx /= l; ny /= l;
    // (inward: toward the middle, which is the origin of this plane)
    if (nx * -x0 + ny * -y0 < 0) { nx = -nx; ny = -ny; }
    lines.push([x0 + nx * inset, y0 + ny * inset, x1 - x0, y1 - y0]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const [ax0, ay0, adx, ady] = lines[(i + n - 1) % n], [bx0, by0, bdx, bdy] = lines[i];
    const den = adx * bdy - ady * bdx;
    const s = Math.abs(den) < 1e-9 ? 0 : ((bx0 - ax0) * bdy - (by0 - ay0) * bdx) / den;
    out.push([ax0 + adx * s, ay0 + ady * s]);
  }
  return { pts: out, c, ax, ay };
}

/** a point of a tile's tangent plane (u, v) back onto the sphere of radius r */
export function hexPoint(o, u, v, r, out = new THREE.Vector3()) {
  return out.copy(o.c).addScaledVector(o.ax, u).addScaledVector(o.ay, v).normalize().multiplyScalar(r);
}
