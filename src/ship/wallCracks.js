// Fatigue cracks in the cabin wall (亀裂): a jagged fracture that starts at a stress point — a
// window corner, the edge of a dent, the rim of a hole — and creeps along the pressure hull
// (cracks in a pressurised hull like to run lengthwise), forking now and then. Every point of the
// path carries the severity at which the crack front reaches it, so the visible crack grows as
// the damage worsens. Drawn as a dark gap with the paint flaking off along both lips.
import * as THREE from 'three';
import { HULL, sectionPoint, sectionNormal, tForPoint } from './hullShape.js';

function rng(seed) {
  let s = (Math.floor(seed * 7919 + 104729) % 233280 + 233280) % 233280 || 1;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

const onWall = (p, inset) => {
  const t = tForPoint(p.z, p.x, p.y, inset);
  return { p: sectionPoint(p.z, t, inset), n: sectionNormal(p.z, t, inset), t };
};

/**
 * paths of a crack starting at p0 (a point on or near the inner wall); each path is an array of
 * { p (on the wall surface), n (outward normal), tv (severity when the front arrives) }
 */
export function crackPaths(p0, seed, opts = {}) {
  const R = rng(seed);
  const inset = HULL.inset;
  const paths = [];
  const len = opts.len ?? (0.5 + R() * 0.9);
  const walk = (start, dir, L, t0, depth) => {
    const path = [];
    let { p, n } = onWall(start, inset);
    let d = dir.clone().addScaledVector(n, -dir.dot(n)).normalize();
    let s = 0, tv = t0;
    path.push({ p: p.clone(), n: n.clone(), tv });
    while (s < L) {
      const st = 0.012 + R() * 0.022;
      // kinks; a gentle pull toward running lengthwise (hoop stress)
      const kink = (R() - 0.5) * (R() < 0.15 ? 1.1 : 0.32);
      d.applyAxisAngle(n, kink);
      const along = new THREE.Vector3(0, 0, Math.sign(d.z) || 1);
      d.lerp(along.addScaledVector(n, -along.dot(n)).normalize(), 0.05).normalize();
      const q = onWall(p.clone().addScaledVector(d, st), inset);
      if (q.p.z < -12.2 || q.p.z > 9.4) break;
      p = q.p; n = q.n;
      d.addScaledVector(n, -d.dot(n)).normalize();
      s += st;
      tv = t0 + s / L * (1 - t0);
      path.push({ p: p.clone(), n: n.clone(), tv });
      if (depth < 2 && R() < 0.05 && s > 0.08) {
        const bd = d.clone().applyAxisAngle(n, (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.6));
        walk(p, bd, (L - s) * (0.3 + 0.5 * R()), tv + 0.03, depth + 1);
      }
    }
    paths.push(path);
  };
  const dir0 = opts.dir || new THREE.Vector3(R() - 0.5, (R() - 0.5) * 0.6, R() < 0.5 ? -1 : 1);
  walk(p0, dir0, len, 0.02, 0);
  // a crack from a stress point usually runs both ways
  if (R() < 0.7) walk(p0, dir0.clone().negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), (R() - 0.5) * 0.6), len * (0.3 + 0.6 * R()), 0.15, 1);
  return paths;
}

const SOOT = new THREE.Color(0.2, 0.18, 0.17), PRIMER = new THREE.Color(0.45, 0.3, 0.24), GAP = new THREE.Color(0.01, 0.01, 0.012), SEAL = new THREE.Color(0.6, 0.61, 0.6);

/**
 * soft-edged ribbon geometry (vertex colours with alpha) of the part of the crack its front has
 * reached (sev): a grimy shadow with chipped paint along the lips, and the dark gap itself;
 * sealed: a bead of grey sealant over it
 */
export function crackGeometry(paths, sev, seed, sealed = false) {
  // stable per-vertex randomness (the geometry is rebuilt as the crack grows)
  let pi = 0;
  const H = (k, j) => { const x = Math.sin(pi * 127.1 + k * 311.7 + j * 74.7 + seed * 13.13) * 43758.5453; return x - Math.floor(x); };
  const pos = [], col = [], idx = [];
  const tmp = new THREE.Color();
  const side = new THREE.Vector3(), tan = new THREE.Vector3();
  // three vertices across (edge, centre, edge): the edges fade out
  const ribbon = (path, widthAt, colorAt, alphaAt, lift) => {
    const base = pos.length / 3;
    let count = 0;
    for (let k = 0; k < path.length; k++) {
      const a = path[k];
      if (a.tv > sev) break;
      const b = path[Math.min(path.length - 1, k + 1)], c = path[Math.max(0, k - 1)];
      tan.subVectors(b.p, c.p).normalize();
      side.crossVectors(tan, a.n).normalize();
      const w = widthAt(k);
      const o = a.p.clone().addScaledVector(a.n, -lift);
      const jl = (H(k, 1) - 0.5) * w * 0.6;
      colorAt(k, tmp);
      const al = alphaAt(k);
      pos.push(o.x + side.x * (w + jl), o.y + side.y * (w + jl), o.z + side.z * (w + jl));
      pos.push(o.x + side.x * jl * 0.3, o.y + side.y * jl * 0.3, o.z + side.z * jl * 0.3);
      pos.push(o.x - side.x * (w - jl), o.y - side.y * (w - jl), o.z - side.z * (w - jl));
      col.push(tmp.r, tmp.g, tmp.b, 0, tmp.r, tmp.g, tmp.b, al, tmp.r, tmp.g, tmp.b, 0);
      count++;
    }
    for (let k = 0; k < count - 1; k++) {
      const i0 = base + k * 3, i1 = i0 + 3;
      idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1, i0 + 1, i1 + 1, i0 + 2, i0 + 2, i1 + 1, i1 + 2);
    }
  };
  for (const path of paths) {
    pi++;
    const L = path.length;
    if (L < 2) continue;
    // the front tapers to a hairline; the crack is widest where it started
    const front = (k) => Math.max(0.12, 1 - k / Math.max(2, L - 1));
    if (sealed) {
      ribbon(path, (k) => 0.008 + 0.004 * front(k), (k, c) => c.copy(SEAL), () => 1, 0.0035);
      continue;
    }
    // grime and chipped paint along the lips (primer showing where flakes came off)
    ribbon(path, (k) => (0.008 + 0.012 * H(k, 2)) * (0.5 + front(k)), (k, c) => c.copy(H(k, 3) < 0.35 ? PRIMER : SOOT), (k) => 0.55 + 0.35 * H(k, 4), 0.0022);
    // the gap: dark, sharp, a few millimetres at its widest
    ribbon(path, (k) => 0.0015 + 0.0036 * front(k) * (0.7 + 0.6 * H(k, 5)), (k, c) => c.copy(GAP), () => 1, 0.0032);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** a stress point on the cabin wall: a window corner, or somewhere along the frames */
export function stressPoint(openings, R = Math.random) {
  const wins = openings.filter((o) => o.kind === 'win' || o.kind === 'hatch');
  if (wins.length && R() < 0.6) {
    const o = wins[Math.floor(R() * wins.length)];
    const su = R() < 0.5 ? -1 : 1, sv = R() < 0.5 ? -1 : 1;
    // just off the corner of the cut-out, on the inner wall
    const p = o.center.clone().addScaledVector(o.u, su * (o.halfW + 0.04)).addScaledVector(o.v, sv * (o.halfH + 0.04));
    const t = tForPoint(p.z, p.x, p.y, 0);
    return { p: sectionPoint(p.z, t, HULL.inset), dir: o.u.clone().multiplyScalar(su).addScaledVector(o.v, sv) };
  }
  const z = -8 + R() * 15, t = (R() < 0.5 ? 0.15 : Math.PI - 0.15) + (R() - 0.5) * 1.6;
  return { p: sectionPoint(z, t, HULL.inset), dir: null };
}
