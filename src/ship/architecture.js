// Rounded interior architecture of B-29: the corridor becomes a ribbed vault with cove lighting,
// every floor / wall / ceiling junction is filleted, door openings get chunky rounded frames with
// light strips. Everything is generated from the hull shape so it follows the curved pressure hull.
import * as THREE from 'three';
import { halfWidthAt, heightRangeAt, DECK_Y } from './hullShape.js';
import { loft, roundPolygon, roundRect, planarFrames, closedPlanarFrames, sweepProfile, zStrip, zPrism, cushionGeometry } from './sweep.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** hex bolt head standing on a surface at p with outward normal n */
export function boltAt(b, p, n, r = 0.011, h = 0.01, key = 'steel') {
  const g = new THREE.CylinderGeometry(r, r * 1.08, h, 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n));
  g.translate(p.x + n.x * h / 2, p.y + n.y * h / 2, p.z + n.z * h / 2);
  b.add(g, key);
}

// corridor cross-section: vertical walls (face at |x| = 0.655) up to the springing, then an
// elliptical vault. CX sits 5 mm inside the wall faces so nothing shows a seam.
export const CORR = { CX: 0.66, VY: 2.05, VR: 0.48, Z0: -8.36, Z1: 5.56, FACE: 0.655 };
const SKY = { z: -0.9, r: 0.3 };

function vaultXY(th) { return [CORR.CX * Math.cos(th), CORR.VY + CORR.VR * Math.sin(th)]; }

/** z-intervals on each corridor wall that are open (doors, alcoves), padded */
export function corridorOpenings(doors, alcoves) {
  const op = { 1: [], [-1]: [] };
  for (const d of Object.values(doors)) if (d.axis === 'x') op[Math.sign(d.at)].push([d.c - d.w / 2 - 0.25, d.c + d.w / 2 + 0.25]);
  for (const a of alcoves) op[a.side].push([a.c - a.w / 2 - 0.2, a.c + a.w / 2 + 0.2]);
  for (const k of [1, -1]) op[k].sort((a, b) => a[0] - b[0]);
  return op;
}
const blocked = (list, z0, z1) => list.some(([a, b]) => z1 > a && z0 < b);
function freeIntervals(list, z0, z1) {
  const out = [];
  let cur = z0;
  for (const [a, b] of list) {
    if (b <= cur) continue;
    if (a > cur) out.push([cur, Math.min(a, z1)]);
    cur = Math.max(cur, b);
    if (cur >= z1) break;
  }
  if (cur < z1) out.push([cur, z1]);
  return out.filter(([a, b]) => b - a > 0.05);
}

/**
 * The corridor: vault (with the skylight well cut through), ribs every 1.2 m, cove ledges with
 * LED lines, floor coves with amber guide lights, padded wall panels, handrails on brackets.
 * Returns the lamp positions for the light pool.
 */
export function buildCorridor(b, { doors, alcoves }) {
  const { CX, VY, VR, Z0, Z1, FACE } = CORR;
  const op = corridorOpenings(doors, alcoves);
  // ---- vault (three z-segments; the middle one is finer and has the skylight hole)
  const K = 32;
  const prof = (k) => () => { const pts = []; for (let i = 0; i <= k; i++) pts.push(vaultXY((i / k) * Math.PI)); return pts; };
  const below = (p) => V(-p.x * 0.2, 1.2 - p.y, 0);   // faces look down into the corridor
  const zA = SKY.z - 0.42, zB = SKY.z + 0.42;
  b.add(zStrip(prof(K), Z0, zA, Math.ceil((zA - Z0) / 0.3), below), 'vault');
  b.add(zStrip(prof(K * 2), zA, zB, 42, below, (s, i, c) => Math.hypot(c.x, c.z - SKY.z) < SKY.r + 0.012), 'vault');
  b.add(zStrip(prof(K), zB, Z1, Math.ceil((Z1 - zB) / 0.3), below), 'vault');
  // skylight well up to the hull window + rounded collar
  const ring = (y) => { const pts = []; for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; pts.push(V(Math.cos(a) * SKY.r, y, SKY.z + Math.sin(a) * SKY.r)); } return pts; };
  b.add(loft([ring(2.455), ring(2.86)], { ring: true, caps: false, invert: true }), 'panel');
  b.torus(SKY.r + 0.012, 0.022, 'steel', [0, 2.455, SKY.z], [Math.PI / 2, 0, 0], 40);
  b.torus(SKY.r + 0.03, 0.006, 'ledStrip', [0, 2.47, SKY.z], [Math.PI / 2, 0, 0], 40);

  // ---- cove ledges with LED lines at the springing (both sides, full length)
  for (const side of [1, -1]) {
    const s = side;
    const ledge = roundPolygon([[s * (CX + 0.006), VY - 0.028], [s * (CX - 0.052), VY - 0.016], [s * (CX - 0.062), VY], [s * (CX - 0.052), VY + 0.012], [s * (CX + 0.006), VY + 0.02]], 0.006, 2);
    b.add(zPrism(ledge, Z0, Z1), 'panel');
    b.pipe([s * (CX - 0.05), VY + 0.018, Z0 + 0.02], [s * (CX - 0.05), VY + 0.018, Z1 - 0.02], 0.0048, 'ledStrip', 6);
  }

  // ---- ribs
  const ribZ = [];
  for (let z = -7.85; z < Z1 - 0.3; z += 1.2) ribZ.push(z);
  // heavy frames: 17 cm wide, standing 10.5 cm off the lining, chamfered flanges, bolted
  const ribProfile = roundPolygon([[-0.012, -0.085], [0.07, -0.085], [0.105, -0.052], [0.105, 0.052], [0.07, 0.085], [-0.012, 0.085]], 0.007, 2);
  for (const zr of ribZ) {
    const floorR = !blocked(op[1], zr - 0.06, zr + 0.06);
    const floorL = !blocked(op[-1], zr - 0.06, zr + 0.06);
    const path = [];
    if (floorR) for (let y = 0; y < VY - 0.01; y += 0.25) path.push(V(CX, y, zr));
    for (let i = 0; i <= K; i++) { const [x, y] = vaultXY((i / K) * Math.PI); path.push(V(x, y, zr)); }
    if (floorL) for (let y = VY - 0.25; y > -0.01; y -= 0.25) path.push(V(-CX, Math.max(0, y), zr));
    if (floorL) path[path.length - 1].y = 0;
    const frames = planarFrames(path, V(0, 0, 1), (p) => V(-p.x, 1.25 - p.y, 0));
    b.add(sweepProfile(path, frames, ribProfile, { caps: true }), 'frameHeavy');
    // two rows of bolt heads along the face of the frame
    let acc = 0.12;
    for (let i = 1; i < path.length; i++) {
      const A = path[i - 1], C = path[i], L = A.distanceTo(C);
      while (acc < L) {
        const t = acc / L, P = A.clone().lerp(C, t), n = frames[i - 1].n.clone().lerp(frames[i].n, t).normalize();
        for (const bz of [-0.034, 0.034]) boltAt(b, P.clone().addScaledVector(n, 0.105).add(V(0, 0, bz)), n, 0.0095, 0.009, 'steel');
        acc += 0.3;
      }
      acc -= L;
    }
  }

  // ---- floor coves (quarter round) with amber guide lights, padded panels, handrails
  const fr = 0.08;
  const lamps = [];
  for (const side of [1, -1]) {
    const free = freeIntervals(op[side], Z0, Z1);
    for (const [a, c] of free) {
      const coveProf = () => { const pts = []; for (let k = 0; k <= 8; k++) { const ph = -Math.PI / 2 + (k / 8) * (Math.PI / 2); pts.push([side * (CX - fr + fr * Math.cos(ph)), fr + fr * Math.sin(ph) + 0.0015]); } return pts; };
      b.add(zStrip(coveProf, a, c, Math.max(1, Math.ceil((c - a) / 0.5)), (p) => V(side * (CX - fr) - p.x, fr - p.y, 0)), 'panelDark');
      for (let z = a + 0.25; z < c - 0.15; z += 0.6) b.sphere(0.008, 'ledAmber', [side * (CX - fr * 0.3), fr * 0.3, z], 6);
      // handrail on brackets where the wall run is long enough
      if (c - a > 1.1) {
        const xr = side * (FACE - 0.135);
        b.pipe([xr, 1.0, a + 0.18], [xr, 1.0, c - 0.18], 0.017, 'handrail', 10);
        for (const z of [a + 0.18, c - 0.18]) b.sphere(0.017, 'handrail', [xr, 1.0, z], 8);
        const nB = Math.max(2, Math.round((c - a - 0.36) / 0.9) + 1);
        for (let i = 0; i < nB; i++) {
          const z = a + 0.25 + (c - a - 0.5) * (i / (nB - 1));
          b.pipe([side * (FACE + 0.004), 1.0, z], [xr, 1.0, z], 0.011, 'steel', 8);
          b.cyl(0.024, 0.024, 0.01, 'steel', [side * (FACE - 0.004), 1.0, z], [0, 0, Math.PI / 2], 12);
        }
      }
    }
    // soft wall panels between ribs (only on closed wall)
    for (let i = -1; i < ribZ.length; i++) {
      const z0 = i < 0 ? Z0 + 0.05 : ribZ[i] + 0.06, z1 = i + 1 < ribZ.length ? ribZ[i + 1] - 0.06 : Z1 - 0.05;
      if (z1 - z0 < 0.4 || blocked(op[side], z0, z1)) continue;
      b.add(cushionGeometry(z1 - z0 - 0.06, 0.84, 0.034, 0.07), 'wallPad', [side * (FACE - 0.012), 1.45, (z0 + z1) / 2], [0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0]);
    }
    // armoured kick plates below the handrail line, between the frames (wherever the wall is closed)
    const kick = [];
    for (let i = -1; i < ribZ.length; i++) {
      const a0 = i < 0 ? Z0 + 0.04 : ribZ[i] + 0.09, a1 = i + 1 < ribZ.length ? ribZ[i + 1] - 0.09 : Z1 - 0.04;
      for (const [u0, u1] of freeIntervals(op[side], a0, a1)) if (u1 - u0 > 0.3) kick.push([u0, u1]);
    }
    for (const [u0, u1] of kick) {
      const zc = (u0 + u1) / 2, w = u1 - u0 - 0.03, x = side * (FACE - 0.016);
      b.add(cushionGeometry(w, 0.7, 0.03, 0.03, 0.008), 'armor', [x, 0.5, zc], [0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0]);
      const nIn = V(-side, 0, 0);
      for (const [dz, y] of [[-w / 2 + 0.05, 0.2], [w / 2 - 0.05, 0.2], [-w / 2 + 0.05, 0.8], [w / 2 - 0.05, 0.8]]) boltAt(b, V(side * (FACE - 0.031), y, zc + dz), nIn, 0.011, 0.008, 'steel');
    }
  }
  // lamps: cove lights alternating sides along the corridor
  let k = 0;
  for (let z = -7.6; z <= 5.1; z += 1.55) lamps.push({ pos: V((k++ % 2 ? -1 : 1) * 0.45, VY + 0.1, z), color: 0xdde9ff, intensity: 3.2 });
  return { lamps };
}

/**
 * Floor-to-hull fillets along the whole deck and big ceiling coves where the corridor walls meet
 * the curved hull inside the side rooms.
 */
export function buildRoomCoves(b, inset) {
  // floor / hull fillet
  const r = 0.11;
  for (const side of [1, -1]) {
    const W = (z) => halfWidthAt(z, 0.05, inset) + 0.003;
    const prof = (z) => { const w = W(z); const pts = []; for (let k = 0; k <= 8; k++) { const ph = -Math.PI / 2 + (k / 8) * (Math.PI / 2); pts.push([side * (w - r + r * Math.cos(ph)), r + r * Math.sin(ph) + 0.0015]); } return pts; };
    b.add(zStrip(prof, -11.93, 9.57, 110, (p) => V(side * (W(p.z) - r) - p.x, r - p.y, 0)), 'wall');
  }
  // ceiling coves in the side rooms (room faces of the corridor walls at |x| = 0.745)
  const R = 0.42, X0 = 0.742, KC = 12;
  for (const side of [1, -1]) {
    const prof = (z) => {
      const Xc = X0 + R;
      let yc = Infinity, Xs = Xc;
      for (let i = 0; i <= 48; i++) {
        const X = Xc - R + 2 * R * (i / 48);
        const H = heightRangeAt(z, X, inset)[1];
        const y = H - Math.sqrt(Math.max(0, R * R - (X - Xc) * (X - Xc)));
        if (y < yc) { yc = y; Xs = X; }
      }
      const phE = Math.atan2(heightRangeAt(z, Xs, inset)[1] - yc, Xs - Xc);
      const pts = [];
      for (let k = 0; k <= KC; k++) { const ph = Math.PI + (phE - Math.PI) * (k / KC); pts.push([side * (Xc + R * Math.cos(ph)), yc + R * Math.sin(ph) - 0.002]); }
      return pts;
    };
    b.add(zStrip(prof, -8.36, 5.56, 64, () => V(side * 0.7, -0.7, 0)), 'wall');
  }
}

/**
 * Chunky rounded frame (both wall faces) around a door opening, with an LED line. With
 * d.collar the wall is built out around the opening into a thick bolted surround on both faces
 * (the walls read as heavy armour rather than sheet): d.wallHalf is the half thickness of the
 * bare wall, the surround runs from there out to the frame.
 */
export function doorFrame(b, d, faceHalf, key = 'frame', ledKey = 'ledStrip') {
  const rr = d.r ?? 0.22;
  const outline = roundRect(d.w, d.h, rr, 0, 0, 7);
  const y0 = d.y0 ?? DECK_Y;
  const yC = y0 + d.h / 2 + 0.005;
  const profile = d.heavy
    ? roundPolygon([[-0.02, -0.008], [0.115, -0.008], [0.115, 0.045], [0.075, 0.07], [-0.02, 0.07]], 0.01, 2)
    : roundPolygon([[-0.016, -0.006], [0.075, -0.006], [0.075, 0.04], [-0.016, 0.04]], 0.014, 3);
  const prot = d.heavy ? 0.07 : 0.04;
  // deep reveal: the opening is lined from face to face (thick walls), split by the slot the
  // sliding door panel runs in
  if (d.reveal) {
    const inner = roundRect(d.w - 0.004, d.h - 0.004, Math.max(0.02, rr - 0.002), 0, 0, 7);
    const at = (u, v, off) => (d.axis === 'z' ? V(d.c + u, yC + v, d.at + off) : V(d.at + off, yC + v, d.c + u));
    for (const [a, c] of [[-d.reveal, -0.036], [0.036, d.reveal]]) {
      b.add(loft([inner.map(([u, v]) => at(u, v, a)), inner.map(([u, v]) => at(u, v, c))], { ring: true, caps: false, invert: true }), d.revealKey || 'panel');
    }
  }
  if (d.collar) {
    const cw = d.collar, wh = d.wallHalf ?? 0.035, depth = faceHalf - wh;
    const W = d.w / 2 + cw, vb = y0 - yC, top = d.h / 2 + cw;
    const rc = rr + cw * 0.75;
    const outer = roundPolygon([[-W, vb], [W, vb], [W, top], [-W, top]], [0, 0, rc, rc], 8);
    const shape = new THREE.Shape(outer.map(([u, v]) => new THREE.Vector2(u, v)));
    shape.holes.push(new THREE.Path(outline.map(([u, v]) => new THREE.Vector2(u, v))));
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
    for (const s of [-1, 1]) {
      // local (u, v, w): u across the opening, v up, w out of the wall face
      const ex = d.axis === 'z' ? V(s, 0, 0) : V(0, 0, -s), ez = d.axis === 'z' ? V(0, 0, s) : V(s, 0, 0);
      const org = d.axis === 'z' ? V(d.c, yC, d.at + s * wh) : V(d.at + s * wh, yC, d.c);
      const m = new THREE.Matrix4().makeBasis(ex, V(0, 1, 0), ez).setPosition(org);
      b.add(geo.clone().applyMatrix4(m), d.collarKey || 'armor');
      // bolts around the surround, outside the frame
      const off = 0.145, face = org.clone().addScaledVector(ez, depth);
      const P = (u, v) => face.clone().addScaledVector(ex, u).add(V(0, v, 0));
      const ub = d.w / 2 + off;
      for (let v = vb + 0.16; v < d.h / 2 - rr; v += 0.28) for (const u of [-ub, ub]) boltAt(b, P(u, v), ez, 0.013, 0.011, 'steel');
      const rB = rr + off;
      for (let k = 0; k <= 4; k++) {
        const a = (k / 4) * (Math.PI / 2);
        for (const sg of [-1, 1]) boltAt(b, P(sg * (d.w / 2 - rr + Math.cos(a) * rB), d.h / 2 - rr + Math.sin(a) * rB), ez, 0.013, 0.011, 'steel');
      }
      for (let u = -(d.w / 2 - rr) + 0.2; u < d.w / 2 - rr - 0.1; u += 0.28) boltAt(b, P(u, d.h / 2 + off), ez, 0.013, 0.011, 'steel');
      // colliders: two jambs and the header, from the wall face out to the frame's front
      const D = depth + prot, Ht = top - vb;
      const cpos = (u, v, len) => (d.axis === 'z' ? [d.c + u, yC + v, d.at + s * (wh + len / 2)] : [d.at + s * (wh + len / 2), yC + v, d.c + u]);
      const csize = (wu, hv, len) => (d.axis === 'z' ? [wu, hv, len] : [len, hv, wu]);
      for (const sg of [-1, 1]) { const [sx, sy, sz] = csize(cw, Ht, D); b.colBox(sx, sy, sz, cpos(sg * (d.w / 2 + cw / 2), vb + Ht / 2, D)); }
      { const [sx, sy, sz] = csize(2 * W, cw, D); b.colBox(sx, sy, sz, cpos(0, d.h / 2 + cw / 2, D)); }
    }
  }
  for (const s of [-1, 1]) {
    const face = d.at + s * faceHalf;
    const toW = (u, v) => (d.axis === 'z' ? V(d.c + u, yC + v, face) : V(face, yC + v, d.c + u));
    const nrm = d.axis === 'z' ? V(0, 0, s) : V(s, 0, 0);
    const path = outline.map(([u, v]) => toW(u, v));
    const centre = toW(0, 0);
    const frames = closedPlanarFrames(path, nrm, centre);
    b.add(sweepProfile(path, frames, profile, { caps: false, wrap: true }), key);
    // LED line just outside the opening edge
    const lo = d.heavy ? 0.03 : 0.06;
    const led = roundRect(d.w + lo, d.h + lo, rr + lo / 2, 0, 0, 7).map(([u, v]) => toW(u, v).addScaledVector(nrm, prot + 0.005));
    b.tube(led, 0.0042, ledKey, { closed: true, radial: 5, seg: 160 });
  }
}
