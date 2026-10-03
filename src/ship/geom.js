// Geometry building helpers: a Builder that collects transformed geometry per material key,
// merges them into few draw calls, and records simple collider descriptions for Rapier.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

export function mat4(pos, rot, scl) {
  pos = pos || [0, 0, 0]; rot = rot || [0, 0, 0]; scl = scl || [1, 1, 1];
  _e.set(rot[0], rot[1], rot[2], 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(...pos), _q.clone(), new THREE.Vector3(...scl));
}

/** replace NaN / zero normals (degenerate triangles) */
export function fixNormals(g) {
  const n = g.attributes.normal;
  if (!n) return g;
  const a = n.array;
  for (let i = 0; i < a.length; i += 3) {
    const l = Math.hypot(a[i], a[i + 1], a[i + 2]);
    if (!(l > 1e-6)) { a[i] = 0; a[i + 1] = 1; a[i + 2] = 0; }
  }
  n.needsUpdate = true;
  return g;
}

/** normalise attributes so geometries can be merged (position, normal, uv only) */
export function clean(g) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  fixNormals(g);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}

export class Builder {
  constructor() {
    this.parts = new Map();   // matKey -> [geometry]
    this.colliders = [];      // {type, size/params, matrix}
    this.stack = [new THREE.Matrix4()];
  }

  get top() { return this.stack[this.stack.length - 1]; }

  push(pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) {
    this.stack.push(this.top.clone().multiply(mat4(pos, rot, scl)));
    return this;
  }

  pop() { this.stack.pop(); return this; }

  add(geo, key, pos, rot, scl) {
    let g = clean(geo);
    const m = this.top.clone();
    if (pos || rot || scl) m.multiply(mat4(pos, rot, scl));
    g.applyMatrix4(m);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return g;
  }

  /** rounded box centred at pos */
  box(w, h, d, key, pos = [0, 0, 0], rot, r = 0.02, seg = 2, col = false) {
    const geo = r > 0.0005 ? new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)) : new THREE.BoxGeometry(w, h, d);
    this.add(geo, key, pos, rot);
    if (col) this.colBox(w, h, d, pos, rot);
    return this;
  }

  cyl(rt, rb, h, key, pos = [0, 0, 0], rot, seg = 16, open = false, col = false) {
    this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), key, pos, rot);
    if (col) this.colCyl(Math.max(rt, rb), h, pos, rot);
    return this;
  }

  sphere(r, key, pos = [0, 0, 0], seg = 16, scl) {
    this.add(new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)), key, pos, [0, 0, 0], scl);
    return this;
  }

  torus(R, r, key, pos = [0, 0, 0], rot, seg = 24, arc = Math.PI * 2) {
    this.add(new THREE.TorusGeometry(R, r, 8, seg, arc), key, pos, rot);
    return this;
  }

  /** tube along points (ship-local, transformed by stack) */
  tube(points, r, key, { seg, radial = 8, closed = false, tension = 0.5, col = false } = {}) {
    const pts = points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(...p)));
    const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', tension);
    const len = curve.getLength();
    const g = new THREE.TubeGeometry(curve, seg || Math.max(4, Math.ceil(len / 0.08)), r, radial, closed);
    this.add(g, key);
    if (col) {
      // capsule chain colliders
      const n = Math.max(1, Math.ceil(len / 0.5));
      for (let i = 0; i < n; i++) {
        const a = curve.getPointAt(i / n), b = curve.getPointAt((i + 1) / n);
        this.colCapsuleAB(a, b, r);
      }
    }
    return curve;
  }

  /** straight pipe from a to b */
  pipe(a, b, r, key, radial = 10, col = false) {
    const A = a.isVector3 ? a : new THREE.Vector3(...a);
    const B = b.isVector3 ? b : new THREE.Vector3(...b);
    const d = new THREE.Vector3().subVectors(B, A);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, radial, 1, true);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(A.clone().lerp(B, 0.5), q, _s);
    g.applyMatrix4(m);
    this.add(g, key);
    if (col) this.colCapsuleAB(A, B, r);
    return this;
  }

  lathe(profile, key, pos, rot, seg = 24) {
    const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
    this.add(new THREE.LatheGeometry(pts, seg), key, pos, rot);
    return this;
  }

  extrude(shape, depth, key, pos, rot, bevel = 0.01, curveSegments = 8) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments });
    g.translate(0, 0, -depth / 2);
    this.add(g, key, pos, rot);
    return this;
  }

  // ---- colliders (in builder-local space transformed by stack) ----
  colBox(w, h, d, pos = [0, 0, 0], rot) {
    const m = this.top.clone().multiply(mat4(pos, rot));
    this.colliders.push({ type: 'box', hx: w / 2, hy: h / 2, hz: d / 2, m });
    return this;
  }

  colCyl(r, h, pos = [0, 0, 0], rot) {
    const m = this.top.clone().multiply(mat4(pos, rot));
    this.colliders.push({ type: 'cyl', r, hh: h / 2, m });
    return this;
  }

  colCapsuleAB(a, b, r) {
    const A = a.clone().applyMatrix4(this.top), B = b.clone().applyMatrix4(this.top);
    const d = new THREE.Vector3().subVectors(B, A);
    const len = d.length();
    if (len < 1e-4) return this;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(A.clone().lerp(B, 0.5), q, _s);
    this.colliders.push({ type: 'capsule', r, hh: len / 2, m });
    return this;
  }

  colMesh(geo) {
    const g = geo.clone().applyMatrix4(this.top);
    this.colliders.push({ type: 'mesh', geo: g });
    return this;
  }

  /** merge into meshes; materials: map key -> material */
  build(materials, { castShadow = true, receiveShadow = true } = {}) {
    const group = new THREE.Group();
    for (const [key, list] of this.parts) {
      if (!list.length) continue;
      const mat = materials[key];
      if (!mat) { console.warn('missing material', key); continue; }
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = key;
      mesh.castShadow = castShadow && !mat.transparent;
      mesh.receiveShadow = receiveShadow;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    return group;
  }
}

// ---------------- shape helpers ----------------
export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function roundedRectPath(w, h, r, cx = 0, cy = 0) {
  const p = new THREE.Path();
  const x = cx - w / 2, y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  return p;
}

/** flat panel (in XY plane, normal +Z) with optional holes, thickness t */
export function panelGeometry(outline, holes = [], t = 0.04, bevel = 0.006) {
  const shape = outline instanceof THREE.Shape ? outline : new THREE.Shape(outline);
  for (const h of holes) shape.holes.push(h);
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 10 });
  g.translate(0, 0, -t / 2);
  return g;
}

/** quick seeded random */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { mergeGeometries, mergeVertices, RoundedBoxGeometry };
