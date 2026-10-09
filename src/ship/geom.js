// Geometry building helpers: a Builder that collects transformed geometry per material key,
// merges them into few draw calls, and records simple collider descriptions for Rapier.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { QUALITY } from '../core/quality.js';

// low graphics quality (chosen before start-up): coarser tessellation everywhere the Builder is
// used (rounded boxes keep a single chamfer, round shapes get about half the segments); LOW II:
// a third of the segments, small roundings become plain boxes
const lowQ = () => QUALITY.level !== 'high';
const low2 = () => QUALITY.level === 'low2';
const half = (n, min) => (lowQ() ? Math.max(min, Math.ceil(n * (low2() ? 0.34 : 0.5))) : n);

// small surface detail (bolts, greebles, clamps, cooling tubes...) goes into meshes of its own,
// marked userData.fine: hidden at once when the quality is turned down, and not built at all
// when the game starts on low
const FINE = '~fine';

/** show / hide the fine detail under root (the quality switch) */
export function setFineVisible(root, on) {
  root.traverse((o) => { if (o.userData && o.userData.fine) o.visible = on; });
}

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

/** normalise attributes so geometries can be merged (position, normal, uv; vertex colours are
 * kept when present — geometries sharing a material key must then all carry them) */
export function clean(g) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
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

  /** push an arbitrary local transform (Matrix4) */
  pushM(m) {
    this.stack.push(this.top.clone().multiply(m));
    return this;
  }

  pop() { this.stack.pop(); return this; }

  /**
   * Detail nobody looks at closely: built inside fn into meshes of their own (marked fine);
   * skipped altogether on low quality
   */
  fine(fn) {
    if (lowQ()) return this;
    this.fineN = (this.fineN || 0) + 1;
    try { fn(); } finally { this.fineN--; }
    return this;
  }

  add(geo, key, pos, rot, scl) {
    if (this.fineN > 0) key += FINE;
    let g = clean(geo);
    const m = this.top.clone();
    if (pos || rot || scl) m.multiply(mat4(pos, rot, scl));
    g.applyMatrix4(m);
    // (a part of something mounted on a surface: which one, so it can be found in the merged mesh)
    if (this.mount !== undefined && this.mount !== null) g.userData.mount = this.mount;
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return g;
  }

  /** rounded box centred at pos (with autoRound, chunky boxes get soft, well-rounded edges) */
  box(w, h, d, key, pos = [0, 0, 0], rot, r = 0.02, seg = 2, col = false) {
    // (a builder can ask for plain boxes below some rounding: bulk props, far structures)
    if (this.plainUpTo !== undefined && r <= this.plainUpTo && seg < 3) r = 0;
    const m = Math.min(w, h, d);
    if (this.autoRound && m > 0.12) { r = Math.max(r, Math.min(0.075, m * 0.17)); seg = Math.max(seg, 3); }
    if (lowQ()) seg = 1;
    if (low2() && r < 0.08) r = 0;
    const geo = r > 0.0005 ? new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)) : new THREE.BoxGeometry(w, h, d);
    this.add(geo, key, pos, rot);
    if (col) this.colBox(w, h, d, pos, rot);
    return this;
  }

  cyl(rt, rb, h, key, pos = [0, 0, 0], rot, seg = 16, open = false, col = false) {
    this.add(new THREE.CylinderGeometry(rt, rb, h, half(seg, 6), 1, open), key, pos, rot);
    if (col) this.colCyl(Math.max(rt, rb), h, pos, rot);
    return this;
  }

  sphere(r, key, pos = [0, 0, 0], seg = 16, scl) {
    seg = half(seg, 8);
    this.add(new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)), key, pos, [0, 0, 0], scl);
    return this;
  }

  torus(R, r, key, pos = [0, 0, 0], rot, seg = 24, arc = Math.PI * 2) {
    this.add(new THREE.TorusGeometry(R, r, low2() ? 4 : lowQ() ? 5 : 8, half(seg, 8), arc), key, pos, rot);
    return this;
  }

  /** tube along points (ship-local, transformed by stack) */
  tube(points, r, key, { seg, radial = 8, closed = false, tension = 0.5, col = false } = {}) {
    const pts = points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(...p)));
    const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', tension);
    const len = curve.getLength();
    const g = new THREE.TubeGeometry(curve, half(seg || Math.max(4, Math.ceil(len / 0.08)), 3), r, half(radial, 5), closed);
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
    const g = new THREE.CylinderGeometry(r, r, len, half(radial, 5), 1, true);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(A.clone().lerp(B, 0.5), q, _s);
    g.applyMatrix4(m);
    this.add(g, key);
    if (col) this.colCapsuleAB(A, B, r);
    return this;
  }

  lathe(profile, key, pos, rot, seg = 24) {
    const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
    this.add(new THREE.LatheGeometry(pts, half(seg, 8)), key, pos, rot);
    return this;
  }

  extrude(shape, depth, key, pos, rot, bevel = 0.01, curveSegments = 8) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0 && !low2(), bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: low2() ? Math.max(3, Math.ceil(curveSegments * 0.5)) : curveSegments });
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

  /**
   * merge into meshes; materials: map key -> material. chunks: z values to cut the parts at (each
   * part goes by its middle; long ones in a chunk of their own) so the camera's frustum can leave
   * out what is behind the viewer
   */
  build(materials, { castShadow = true, receiveShadow = true, chunks = null } = {}) {
    const group = new THREE.Group();
    for (const [key, list] of this.parts) {
      if (!list.length) continue;
      const fine = key.endsWith(FINE);
      const base = fine ? key.slice(0, -FINE.length) : key;
      const mat = materials[base];
      if (!mat) { console.warn('missing material', base); continue; }
      for (const part of chunks ? splitByZ(list, chunks) : [list]) {
        if (!part.length) continue;
        const merged = mergeGeometries(part, false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, mat);
        // where each mounted thing's vertices ended up (the parts are laid end to end, in order)
        let off = 0;
        for (const g of part) {
          const n = g.attributes.position.count;
          if (g.userData && g.userData.mount !== undefined) (mesh.userData.mounts || (mesh.userData.mounts = [])).push([g.userData.mount, off, n]);
          off += n;
        }
        mesh.name = base;
        if (fine) { mesh.userData.fine = true; mesh.visible = !lowQ(); }
        mesh.castShadow = castShadow && !mat.transparent;
        mesh.receiveShadow = receiveShadow;
        if (mat.userData && mat.userData.depthMat) mesh.customDepthMaterial = mat.userData.depthMat;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
    }
    return group;
  }
}

/**
 * parts into z sections (by their middle); a long part (a hull skin, a floor, a pipe down the
 * ship) is cut up, each triangle going to the section it lies in (normals untouched: no seams)
 */
function splitByZ(list, cuts) {
  const nb = cuts.length + 1;
  const out = Array.from({ length: nb }, () => []);
  const span = (cuts[cuts.length - 1] - cuts[0]) / Math.max(1, cuts.length - 1);
  const at = (z) => { let i = 0; while (i < cuts.length && z > cuts[i]) i++; return i; };
  for (const g of list) {
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (g.index || bb.max.z - bb.min.z <= span * 0.75) { out[at((bb.min.z + bb.max.z) / 2)].push(g); continue; }
    const P = g.attributes.position.array, n = P.length / 9;
    const tris = Array.from({ length: nb }, () => []);
    for (let t = 0; t < n; t++) tris[at((P[t * 9 + 2] + P[t * 9 + 5] + P[t * 9 + 8]) / 3)].push(t);
    tris.forEach((ts, k) => { if (ts.length) out[k].push(pickTris(g, ts)); });
  }
  return out;
}

/** the listed triangles of a non-indexed geometry, as a geometry of their own */
function pickTris(g, ts) {
  const ng = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) {
    const w = a.itemSize * 3, src = a.array, dst = new src.constructor(ts.length * w);
    ts.forEach((t, i) => dst.set(src.subarray(t * w, t * w + w), i * w));
    ng.setAttribute(k, new THREE.BufferAttribute(dst, a.itemSize, a.normalized));
  }
  return ng;
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
