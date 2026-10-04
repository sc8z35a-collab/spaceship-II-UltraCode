// Torn metal: the geometry of a hole punched through a skin — the jagged opening (the same outline
// the hull shaders cut out of the wall), the petals of torn plating bent away in the direction the
// projectile travelled and crumpled, scorched and bare at their torn edges, the insulation layers
// between two skins bulging into the hole, and severed cables hanging out of it.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const fract = (x) => x - Math.floor(x);

/** per-petal pseudo random (same formula as the GLSL bHash) */
export function bHash(i, s) { return fract(Math.sin(i * 12.9898 + s * 78.233) * 43758.5453); }

export function petalCount(s) { return 7 + Math.floor(fract(s * 0.618) * 6); }

/** smooth part of the outline (relative to the nominal radius) */
export function outlineBase(th, s) {
  return 1 + 0.16 * Math.sin(2 * th + s) + 0.1 * Math.sin(3 * th + 2.1 * s) + 0.05 * Math.sin(7 * th + 3.7 * s);
}

/** the opening's radius factor at angle th: smooth base + narrow tear slits between the petals */
export function outlineF(th, s) {
  const P = petalCount(s);
  const x = th * P / TAU + fract(s * 0.37);
  const i = Math.floor(x), f = x - i;
  const e = Math.min(f, 1 - f);
  const ib = ((f < 0.5 ? i : i + 1) % P + P) % P;
  const slit = (0.1 + 0.32 * bHash(ib, s)) * Math.max(0, 1 - e / 0.028);
  return outlineBase(th, s) + slit;
}

/** GLSL twins of the functions above (keep in sync) */
export const OUTLINE_GLSL = /* glsl */`
float bHash(float i, float s){ return fract(sin(i * 12.9898 + s * 78.233) * 43758.5453); }
float bPetals(float s){ return 7.0 + floor(fract(s * 0.618) * 6.0); }
float breachOutline(float th, float s){
  float P = bPetals(s);
  float x = th * P / 6.2831853 + fract(s * 0.37);
  float i = floor(x), f = x - i;
  float e = min(f, 1.0 - f);
  float ib = mod(f < 0.5 ? i : i + 1.0, P);
  float slit = (0.1 + 0.32 * bHash(ib, s)) * max(0.0, 1.0 - e / 0.028);
  return 1.0 + 0.16 * sin(2.0 * th + s) + 0.1 * sin(3.0 * th + 2.1 * s) + 0.05 * sin(7.0 * th + 3.7 * s) + slit;
}
vec3 bTangent(vec3 n){ return normalize(abs(n.y) < 0.9 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0))); }
`;

/** tangent frame of a hole with outward normal n (matches bTangent in GLSL) */
export function holeFrame(n) {
  const u = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  return { u, v };
}

const C = (r, g, b) => new THREE.Color(r, g, b);
const PAINT = { outer: C(0.78, 0.79, 0.77), inner: C(0.6, 0.63, 0.66), station: C(0.82, 0.82, 0.8) };
const SOOT = C(0.06, 0.055, 0.05), BARE = C(0.72, 0.71, 0.69), HEAT = C(0.42, 0.36, 0.5);

/**
 * Petals of torn plating around a hole.
 * o: { c: centre (Vector3), n: outward normal, R: nominal radius, seed, travel: direction the
 *      petals bend toward (unit), paint: 'outer' | 'inner' | 'station', lenK (petal length
 *      factor), bend (mean bend angle, rad) }
 * returns a BufferGeometry with vertex colours (double-sided metal)
 */
export function petalGeometry(o) {
  const { c, n, R, seed: s } = o;
  const { u, v } = holeFrame(n);
  const travel = o.travel || n.clone().negate();
  const paint = PAINT[o.paint || 'outer'];
  const P = petalCount(s), off = fract(s * 0.37);
  const NU = 5, NW = 7;
  const pos = [], col = [], idx = [];
  const dir = (th) => u.clone().multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th));
  const tmp = new THREE.Color();
  for (let i = 0; i < P; i++) {
    if (bHash(i + 3, s) < 0.12) continue;                 // this one tore off entirely
    const beta = (o.bend ?? 1.75) * (0.65 + 0.7 * bHash(i + 17, s));
    const lenK = (o.lenK ?? 0.85) * (0.7 + 0.45 * bHash(i + 31, s));
    const thMid = ((i + 0.5 - off) * TAU) / P;
    const rootMid = R * outlineBase(thMid, s);
    const tip = dir(thMid + (bHash(i + 41, s) - 0.5) * 0.4).multiplyScalar(rootMid * Math.max(0.04, 1 - lenK));
    const base = pos.length / 3;
    for (let a = 0; a <= NU; a++) {
      const x = i + 0.07 + 0.86 * (a / NU);
      const th = ((x - off) * TAU) / P;
      const root = dir(th).multiplyScalar(R * outlineBase(th, s) * 1.002);
      const toTip = tip.clone().sub(root);
      const L = toTip.length() * (a === 0 || a === NU ? 0.86 : 1) * (1 - 0.12 * bHash(i * 7 + a, s + 1));
      const fd = toTip.normalize();
      const p = root.clone();
      for (let w = 0; w <= NW; w++) {
        if (w > 0) {
          const t = (w - 0.5) / NW;
          const phi = beta * Math.pow(t, 0.55);
          p.addScaledVector(fd, Math.cos(phi) * L / NW).addScaledVector(travel, Math.sin(phi) * L / NW);
        }
        // crumpling grows toward the torn tip
        const k = w / NW;
        const cr = (bHash(i * 31 + a * 7 + w, s + 2) - 0.5) * R * 0.12 * k;
        const q = p.clone().addScaledVector(n, cr * 0.6).addScaledVector(fd, cr * 0.4);
        pos.push(c.x + q.x, c.y + q.y, c.z + q.z);
        // paint near the root, soot, then bare torn metal (tinted by the heat) at the edges
        const edge = Math.max(k, (a === 0 || a === NU) ? 0.75 : 0);
        if (edge < 0.3) tmp.copy(paint).lerp(SOOT, edge / 0.3 * 0.7);
        else if (edge < 0.62) tmp.copy(paint).lerp(SOOT, 0.7).lerp(SOOT, (edge - 0.3) / 0.32);
        else tmp.copy(SOOT).lerp(BARE, Math.min(1, (edge - 0.62) / 0.25)).lerp(HEAT, 0.25 * bHash(i + w, s + 5));
        col.push(tmp.r, tmp.g, tmp.b);
      }
    }
    for (let a = 0; a < NU; a++) for (let w = 0; w < NW; w++) {
      const i0 = base + a * (NW + 1) + w, i1 = i0 + NW + 1;
      idx.push(i0, i1, i0 + 1, i1, i1 + 1, i0 + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * The cut through the wall between two skins: insulation blankets (foil and batting) bulging into
 * the hole, from the outer outline (depth 0) to the inner one (depth -gap along n).
 * o: { c, n, R, seed, gap, innerK }
 */
export function linerGeometry(o) {
  const { c, n, R, seed: s, gap } = o;
  const innerK = o.innerK ?? 1.12;
  const { u, v } = holeFrame(n);
  const NA = 56, NK = 5;
  const pos = [], col = [], idx = [];
  const foil = C(0.86, 0.66, 0.26), silver = C(0.78, 0.8, 0.82), batt = C(0.83, 0.8, 0.68), char = C(0.09, 0.08, 0.07);
  const tmp = new THREE.Color();
  for (let k = 0; k < NK; k++) {
    const t = k / (NK - 1);
    for (let a = 0; a <= NA; a++) {
      const th = (a % NA) / NA * TAU;
      const r0 = R * outlineBase(th, s), r1 = R * innerK * outlineBase(th, s + 7.3);
      // the batting puffs inward in the middle of the wall, scorched near the outer skin
      const fluff = Math.sin(t * Math.PI) * (0.08 + 0.22 * bHash(Math.floor(a / 3) + k * 61, s + 9));
      const r = (r0 + (r1 - r0) * t) * (1 - fluff);
      const p = c.clone().addScaledVector(u, Math.cos(th) * r).addScaledVector(v, Math.sin(th) * r).addScaledVector(n, -gap * t);
      pos.push(p.x, p.y, p.z);
      const band = bHash(Math.floor(a / 4) + 13 * k, s + 11);
      tmp.copy(band < 0.4 ? foil : band < 0.6 ? silver : batt).lerp(char, Math.max(0, 0.75 - t * 1.5) * (0.5 + 0.5 * band));
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let k = 0; k < NK - 1; k++) for (let a = 0; a < NA; a++) {
    const i0 = k * (NA + 1) + a, i1 = i0 + NA + 1;
    idx.push(i0, i0 + 1, i1, i1, i0 + 1, i1 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Severed cables hanging out of a hole into the room: an array of { geo (tube), tip (Vector3),
 * dir } (the bare copper ends spark now and then).
 * o: { c (point on the inner skin), n (outward), R, seed, down (gravity direction or null), count }
 */
export function cableCurves(o) {
  const { c, n, R, seed: s } = o;
  const { u, v } = holeFrame(n);
  const down = o.down || new THREE.Vector3(0, -1, 0);
  const out = [];
  const count = o.count ?? 3;
  for (let i = 0; i < count; i++) {
    const th = bHash(i + 71, s) * TAU;
    const rr = R * (0.5 + 0.4 * bHash(i + 73, s));
    const p0 = c.clone().addScaledVector(u, Math.cos(th) * rr).addScaledVector(v, Math.sin(th) * rr).addScaledVector(n, 0.08);
    const p1 = c.clone().addScaledVector(u, Math.cos(th) * rr * 0.6).addScaledVector(v, Math.sin(th) * rr * 0.6).addScaledVector(n, -0.04);
    const hang = 0.12 + 0.3 * bHash(i + 79, s);
    const side = u.clone().multiplyScalar((bHash(i + 83, s) - 0.5) * 0.2).addScaledVector(v, (bHash(i + 89, s) - 0.5) * 0.2);
    const p2 = p1.clone().addScaledVector(n, -0.1).add(side).addScaledVector(down, hang * 0.45);
    const p3 = p2.clone().addScaledVector(n, -0.05).add(side.clone().multiplyScalar(0.5)).addScaledVector(down, hang * 0.55);
    const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
    const rad = 0.005 + 0.006 * bHash(i + 97, s);
    out.push({ geo: new THREE.TubeGeometry(curve, 16, rad, 6, false), tip: p3.clone(), dir: curve.getTangent(1), rad, color: [0x1a1a1c, 0x8c1c14, 0xc9a21a, 0x1b3f7a][i % 4] });
  }
  return out;
}

/**
 * A patch plate conforming to a wall: rounded plate with bolts and a sealant bead. surf(x, y) maps
 * plate coordinates to a point on the wall (already offset off it); returns { plate, bolts[], bead }
 */
export function patchPlate(surf, nrm, size, seed) {
  const N = 14;
  const pos = [], idx = [];
  const pts = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = (i / N - 0.5) * 2, y = (j / N - 0.5) * 2;
    // superellipse corner rounding: squeeze the grid into the rounded square
    const m = Math.max(Math.abs(x), Math.abs(y));
    const rr = m > 0 ? Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(y), 4), 0.25) : 1;
    const k = m > 0 ? m / rr : 1;
    const p = surf(x * k * size * (1 + 0.04 * Math.sin(seed + j)), y * k * size);
    pts.push(p);
    pos.push(p.x, p.y, p.z);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i;
    idx.push(a, a + 1, a + N + 1, a + 1, a + N + 2, a + N + 1);
  }
  const plate = new THREE.BufferGeometry();
  plate.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  plate.setIndex(idx);
  plate.computeVertexNormals();
  // keep the plate facing the room
  const nn = plate.attributes.normal;
  if (nn.getX(0) * nrm.x + nn.getY(0) * nrm.y + nn.getZ(0) * nrm.z < 0) { plate.setIndex(idx.map((_, i) => idx[i - (i % 3) + 2 - (i % 3)])); plate.computeVertexNormals(); }
  const bolts = [];
  const nb = 10;
  for (let i = 0; i < nb; i++) {
    const a = i / nb * TAU;
    const x = Math.cos(a), y = Math.sin(a);
    const m = Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(y), 4), 0.25);
    bolts.push(surf(x / m * size * 0.82, y / m * size * 0.82));
  }
  const ring = [];
  for (let i = 0; i <= 48; i++) {
    const a = i / 48 * TAU;
    const x = Math.cos(a), y = Math.sin(a);
    const m = Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(y), 4), 0.25);
    ring.push(surf(x / m * size * 1.01, y / m * size * 1.01));
  }
  const bead = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 96, 0.009, 5, true);
  return { plate, bolts, bead };
}

/**
 * A torn-off fragment of plating: a jagged, crumpled sheet (unit size, centred), vertex coloured
 * paint on one part, soot and bare metal toward the torn edges.
 */
export function shardGeometry(seed, paint = 'station') {
  const n = 5 + Math.floor(bHash(1, seed) * 4);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i + 0.3 * bHash(i + 2, seed)) / n * TAU;
    const r = 0.25 + 0.3 * bHash(i + 9, seed);
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r * (0.5 + 0.5 * bHash(3, seed))));
  }
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts), 1);
  // subdivide a little by tessellating: ShapeGeometry is a fan; crumple its vertices out of plane
  const pos = g.attributes.position;
  const col = [];
  const base = PAINT[paint] || PAINT.station;
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const r = Math.hypot(x, y);
    pos.setZ(i, (bHash(i + 17, seed) - 0.5) * 0.12 + Math.sin(x * 9 + seed) * 0.04 + r * r * 0.3 * (bHash(5, seed) - 0.5));
    const edge = Math.min(1, r / 0.5);
    tmp.copy(base).lerp(SOOT, 0.3 + 0.5 * edge * bHash(i + 23, seed)).lerp(BARE, edge > 0.85 ? 0.5 : 0);
    col.push(tmp.r, tmp.g, tmp.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
