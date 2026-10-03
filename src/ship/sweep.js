// Generic sweep / loft helpers for the rounded interior: fillet a 2D outline, loft a solid or a
// strip through matching sections, sweep a profile along a path. Faces are oriented
// automatically (solids outward, strips toward a given side) and get smooth normals + uvs.
import * as THREE from 'three';

const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** signed area of a 2D polygon [[x,y],...] (counter-clockwise > 0) */
export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

/**
 * Fillet every corner of a closed 2D polygon with radius r (a number, or one value per corner;
 * 0 keeps the corner sharp). Radii shrink where the neighbouring edges are too short.
 */
export function roundPolygon(pts, r, seg = 4) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], c = pts[(i + 1) % n];
    const rr = Array.isArray(r) ? r[i] : r;
    const v1x = a[0] - p[0], v1y = a[1] - p[1], v2x = c[0] - p[0], v2y = c[1] - p[1];
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    if (!rr || l1 < 1e-6 || l2 < 1e-6) { out.push(p); continue; }
    const u1x = v1x / l1, u1y = v1y / l1, u2x = v2x / l2, u2y = v2y / l2;
    const th = Math.acos(clamp(u1x * u2x + u1y * u2y, -1, 1));   // interior angle at the corner
    if (th < 1e-3 || Math.PI - th < 1e-3) { out.push(p); continue; }
    const tanH = Math.tan(th / 2);
    let d = rr / tanH, R = rr;
    const dMax = Math.min(l1, l2) * 0.5;
    if (d > dMax) { d = dMax; R = d * tanH; }
    const t1 = [p[0] + u1x * d, p[1] + u1y * d], t2 = [p[0] + u2x * d, p[1] + u2y * d];
    const bx = u1x + u2x, by = u1y + u2y, bl = Math.hypot(bx, by);
    const h = R / Math.sin(th / 2);
    const C = [p[0] + bx / bl * h, p[1] + by / bl * h];
    const a1 = Math.atan2(t1[1] - C[1], t1[0] - C[0]), a2 = Math.atan2(t2[1] - C[1], t2[0] - C[0]);
    let da = a2 - a1;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    for (let k = 0; k <= seg; k++) { const ang = a1 + da * k / seg; out.push([C[0] + Math.cos(ang) * R, C[1] + Math.sin(ang) * R]); }
  }
  return out;
}

/** rounded rectangle outline centred at (cx, cy) as [[x,y],...] (counter-clockwise) */
export function roundRect(w, h, r, cx = 0, cy = 0, seg = 4) {
  return roundPolygon([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]], r, seg);
}

function centroid(sec) {
  const c = new V3();
  for (const p of sec) c.add(p);
  return c.divideScalar(sec.length);
}

/**
 * Loft through sections (arrays of Vector3, equal lengths).
 * opts.ring: sections are closed rings (solid / tube); otherwise open polylines (strip surface)
 * opts.caps: close the two ends of a ring loft (flat caps)
 * opts.wrap: connect the last section back to the first (closed path, e.g. a door frame ring)
 * opts.facing: for strips, (p) => direction the face at p should look toward (Vector3)
 * opts.skip: (s, i, centre) => true to leave a quad out (cut holes)
 */
export function loft(sections, opts = {}) {
  const { ring = true, caps = true, wrap = false, facing = null, skip = null } = opts;
  const S = sections.length, N = sections[0].length;
  const pos = [], uv = [];
  // uvs: u along the section (arc length), v along the path (distance between centroids)
  let vAcc = 0;
  let prevC = null;
  for (let s = 0; s < S; s++) {
    const sec = sections[s];
    const c = centroid(sec);
    if (prevC) vAcc += c.distanceTo(prevC);
    prevC = c;
    let uAcc = 0;
    for (let i = 0; i < N; i++) {
      const p = sec[i];
      if (i > 0) uAcc += p.distanceTo(sec[i - 1]);
      pos.push(p.x, p.y, p.z);
      uv.push(uAcc, vAcc);
    }
  }
  const side = [];
  const segs = wrap ? S : S - 1;
  const cols = ring ? N : N - 1;
  const A = new V3(), B = new V3(), C = new V3(), Dv = new V3(), nrm = new V3(), mid = new V3();
  let vote = 0;
  for (let s = 0; s < segs; s++) {
    const s2 = (s + 1) % S;
    const cs = ring ? centroid(sections[s]) : null;
    for (let i = 0; i < cols; i++) {
      const i2 = (i + 1) % N;
      const a = s * N + i, b = s * N + i2, c = s2 * N + i, d = s2 * N + i2;
      A.fromArray(pos, a * 3); B.fromArray(pos, b * 3); C.fromArray(pos, c * 3); Dv.fromArray(pos, d * 3);
      mid.copy(A).add(B).add(C).add(Dv).multiplyScalar(0.25);
      if (skip && skip(s, i, mid)) continue;
      side.push(a, b, c, b, d, c);
      nrm.subVectors(B, A).cross(C.clone().sub(A));
      if (nrm.lengthSq() < 1e-14) nrm.subVectors(Dv, B).cross(C.clone().sub(B));
      let want;
      if (ring) want = mid.clone().sub(cs);
      else if (facing) want = facing(mid);
      else want = null;
      if (want) vote += Math.sign(nrm.dot(want)) * Math.min(1, nrm.length() * 1e4);
    }
  }
  if (opts.invert) vote = -vote;   // rings seen from inside (light wells, ducts)
  if (vote < 0) for (let k = 0; k < side.length; k += 3) { const t = side[k + 1]; side[k + 1] = side[k + 2]; side[k + 2] = t; }
  const idx = side;
  // flat caps (own vertices), each turned to face away from its neighbour section
  if (ring && caps && !wrap) {
    for (const [si, nb] of [[0, 1], [S - 1, S - 2]]) {
      const sec = sections[si];
      const n = new V3();
      for (let i = 0; i < N; i++) {
        const p = sec[i], q = sec[(i + 1) % N];
        n.x += (p.y - q.y) * (p.z + q.z); n.y += (p.z - q.z) * (p.x + q.x); n.z += (p.x - q.x) * (p.y + q.y);
      }
      if (n.lengthSq() < 1e-14) continue;
      n.normalize();
      const u = new V3().crossVectors(Math.abs(n.y) < 0.9 ? new V3(0, 1, 0) : new V3(1, 0, 0), n).normalize();
      const v = new V3().crossVectors(n, u);
      const c2 = sec.map((p) => new THREE.Vector2(p.dot(u), p.dot(v)));
      const tris = THREE.ShapeUtils.triangulateShape(c2, []);
      const base = pos.length / 3;
      for (const p of sec) { pos.push(p.x, p.y, p.z); uv.push(p.dot(u), p.dot(v)); }
      const out = centroid(sec).sub(centroid(sections[nb]));
      for (const t of tris) {
        A.fromArray(pos, (base + t[0]) * 3); B.fromArray(pos, (base + t[1]) * 3); C.fromArray(pos, (base + t[2]) * 3);
        nrm.subVectors(B, A).cross(C.clone().sub(A));
        if (nrm.dot(out) >= 0) idx.push(base + t[0], base + t[1], base + t[2]);
        else idx.push(base + t[0], base + t[2], base + t[1]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Frames along a path lying in a plane with normal `planeN`: n = in-plane normal (turned toward
 * `inward` (p) => Vector3 when given), b = planeN.
 */
export function planarFrames(path, planeN, inward = null) {
  const frames = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)], c = path[Math.min(path.length - 1, i + 1)];
    const t = c.clone().sub(a).normalize();
    const n = new V3().crossVectors(planeN, t).normalize();
    if (inward && n.dot(inward(path[i])) < 0) n.negate();
    frames.push({ n, b: planeN.clone() });
  }
  return frames;
}

/** frames for a closed planar path (wraps around the ends) */
export function closedPlanarFrames(path, planeN, outwardFrom) {
  const frames = [];
  const L = path.length;
  for (let i = 0; i < L; i++) {
    const a = path[(i - 1 + L) % L], c = path[(i + 1) % L];
    const t = c.clone().sub(a).normalize();
    const n = new V3().crossVectors(planeN, t).normalize();
    if (outwardFrom && n.dot(path[i].clone().sub(outwardFrom)) < 0) n.negate();
    frames.push({ n, b: planeN.clone() });
  }
  return frames;
}

/** sweep a closed 2D profile [[a,b],...] (a along frame.n, b along frame.b) along a path */
export function sweepProfile(path, frames, profile, opts = {}) {
  const sections = path.map((P, i) => profile.map(([a, bb]) => P.clone().addScaledVector(frames[i].n, a).addScaledVector(frames[i].b, bb)));
  return loft(sections, Object.assign({ ring: true }, opts));
}

/** strip surface along z: profileAt(z) -> [[x,y],...] (same count for every z) */
export function zStrip(profileAt, z0, z1, nz, facing, skip) {
  const sections = [];
  for (let j = 0; j <= nz; j++) {
    const z = z0 + (z1 - z0) * (j / nz);
    sections.push(profileAt(z).map(([x, y]) => new V3(x, y, z)));
  }
  return loft(sections, { ring: false, facing, skip });
}

/** prism along z from a closed 2D outline (x,y) between z0 and z1 */
export function zPrism(outline, z0, z1) {
  return loft([outline.map(([x, y]) => new V3(x, y, z0)), outline.map(([x, y]) => new V3(x, y, z1))], { ring: true, caps: true });
}

/** soft cushion / padded panel: rounded rectangle with rounded edges, centred, facing +z */
export function cushionGeometry(w, h, depth, r = 0.04, bevel = null) {
  const bv = bevel ?? Math.min(depth * 0.45, 0.025);
  const s = new THREE.Shape();
  const pts = roundRect(Math.max(0.01, w - 2 * bv), Math.max(0.01, h - 2 * bv), Math.max(0, r - bv), 0, 0, 4);
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.002, depth - 2 * bv), bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -(depth - 2 * bv) / 2);
  return g;
}
