// H8's outside, built for close inspection: a sphere of bevelled armour plates (each its own shade,
// some replaced, an orange belt round the equator) over a dark substrate that shows in the gaps,
// thousands of bolt heads, the four camera turrets on their yokes with coated multi-element optics,
// the plasma drive with its magnetic coils and cooling channels, four auxiliary engines, eight RCS
// quads, two radiator wings, the docking neck with its androgynous ring, guide petals and
// latches, the high-voltage power coupling, a radar under its dome, star trackers, a high-gain dish,
// a laser terminal, handrails, lights and stencilled markings — and a simple stand-in for distance.
import * as THREE from 'three';
import { Builder, rng } from '../ship/geom.js';
import { H8, CAMERAS, RCS, exclusions } from './h8Spec.js';
import { decalUV } from './h8Materials.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);

/** a basis with n as +Y (outward), x roughly horizontal */
export function frameAt(n, hint = V(0, 0, -1)) {
  const nn = n.clone().normalize();
  let x = new THREE.Vector3().crossVectors(Math.abs(nn.y) > 0.98 ? hint : Y, nn);
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, nn).normalize();
  return { x, y: nn, z };
}

function mBasis(f, pos) { return new THREE.Matrix4().makeBasis(f.x, f.y, f.z).setPosition(pos); }

/** a decal (sheet cell) laid onto the sphere at direction dir */
function sphereDecal(b, key, dir, w, h, rot = 0, lift = 0.012) {
  const [u0, v0, du, dv] = decalUV(key);
  const g = new THREE.PlaneGeometry(w, h, 12, 12);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * du, v0 + uv.getY(i) * dv);
  const f = frameAt(dir);
  const q = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), rot);
  const pos = g.attributes.position, tmp = V(0, 0, 0);
  for (let i = 0; i < pos.count; i++) {
    tmp.set(pos.getX(i), pos.getY(i), 0).applyQuaternion(q);
    // plane x -> frame x, plane y -> frame z (tangent), then onto the sphere
    const p = f.y.clone().multiplyScalar(H8.R).addScaledVector(f.x, tmp.x).addScaledVector(f.z, -tmp.y);
    p.setLength(H8.R + lift);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  b.add(g, 'decal');
}

// ---------------------------------------------------------------------------- armour plates
/**
 * Bevelled armour tiles on latitude bands with staggered seams. Returns bolt placements.
 */
function armourTiles(b, R0) {
  const R = rng(8);
  const ex = exclusions();
  const bolts = [];
  const bands = 16, latMax = 79 * Math.PI / 180;
  const gap = 0.024, chamfer = 0.016, T = 0.07;
  // B-29's family: light warm-grey armour, a few darker and replaced plates, the orange belt
  const base = new THREE.Color(0.6, 0.61, 0.6);
  const tmpC = new THREE.Color();
  const dirOf = (lat, lon) => V(Math.cos(lat) * Math.sin(lon), Math.sin(lat), -Math.cos(lat) * Math.cos(lon));
  for (let bi = 0; bi < bands; bi++) {
    const la0 = -latMax + (2 * latMax) * bi / bands, la1 = -latMax + (2 * latMax) * (bi + 1) / bands;
    const lam = (la0 + la1) / 2;
    const n = Math.max(6, Math.round(2 * Math.PI * R0 * Math.cos(lam) / 1.05));
    const dl = 2 * Math.PI / n, off = (bi % 2) * dl * 0.5;
    const equator = la0 < 0.02 && la1 > -0.02;
    for (let i = 0; i < n; i++) {
      const lo0 = off + i * dl, lo1 = lo0 + dl;
      const cdir = dirOf(lam, (lo0 + lo1) / 2);
      // only plates centred under a component's footprint are left out (the component's base covers
      // the plates it overlaps: a whole ring of plates round every fitting left the sphere bald)
      if (ex.some((e) => cdir.angleTo(e.dir) < e.ang + 0.03)) continue;
      // inset by the gap (angles), outer face further in by the chamfer
      const gLat = gap / R0, gLon = gap / (R0 * Math.cos(lam));
      const cLat = chamfer / R0, cLon = chamfer / (R0 * Math.cos(lam));
      const A0 = [la0 + gLat, la1 - gLat, lo0 + gLon, lo1 - gLon];
      const A1 = [A0[0] + cLat, A0[1] - cLat, A0[2] + cLon, A0[3] - cLon];
      const NU = 5, NV = 4;
      const pos = [], col = [], idx = [];
      // tile tint: graphite with variation; a few replaced (lighter) plates; the orange belt
      const k = R();
      if (equator) tmpC.setRGB(0.86, 0.42, 0.11).multiplyScalar(0.9 + 0.15 * R());
      else if (k < 0.07) tmpC.copy(base).multiplyScalar(1.22 + 0.1 * R());
      else if (k < 0.14) tmpC.setRGB(0.3, 0.32, 0.35).multiplyScalar(0.95 + 0.2 * R());
      else if (k < 0.18) tmpC.setRGB(0.52, 0.5, 0.45).multiplyScalar(0.95 + 0.15 * R());
      else tmpC.copy(base).multiplyScalar(0.84 + 0.2 * R());
      const push = (p, c) => { pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b); };
      // outer face (pillowed slightly)
      for (let v = 0; v <= NV; v++) for (let u = 0; u <= NU; u++) {
        const la = A1[0] + (A1[1] - A1[0]) * (v / NV), lo = A1[2] + (A1[3] - A1[2]) * (u / NU);
        const pil = 0.006 * Math.sin(Math.PI * u / NU) * Math.sin(Math.PI * v / NV);
        push(dirOf(la, lo).multiplyScalar(R0 + pil), tmpC);
      }
      for (let v = 0; v < NV; v++) for (let u = 0; u < NU; u++) {
        const a = v * (NU + 1) + u, c = a + NU + 1;
        idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
      // bevelled sides: outer face edge down to the base edge (R0 - T, not chamfered)
      const ring = (A, r) => {
        const out = [];
        for (let u = 0; u <= NU; u++) out.push(dirOf(A[0], A[2] + (A[3] - A[2]) * (u / NU)).multiplyScalar(r));
        for (let v = 1; v <= NV; v++) out.push(dirOf(A[0] + (A[1] - A[0]) * (v / NV), A[3]).multiplyScalar(r));
        for (let u = NU - 1; u >= 0; u--) out.push(dirOf(A[1], A[2] + (A[3] - A[2]) * (u / NU)).multiplyScalar(r));
        for (let v = NV - 1; v >= 1; v--) out.push(dirOf(A[0] + (A[1] - A[0]) * (v / NV), A[2]).multiplyScalar(r));
        return out;
      };
      const top = ring(A1, R0), bot = ring(A0, R0 - T);
      const dark = tmpC.clone().multiplyScalar(0.75);
      const s0 = pos.length / 3;
      for (const p of top) push(p, tmpC);
      for (const p of bot) push(p, dark);
      const L = top.length;
      for (let k2 = 0; k2 < L; k2++) {
        const a = s0 + k2, c = s0 + (k2 + 1) % L, a2 = s0 + L + k2, c2 = s0 + L + (k2 + 1) % L;
        idx.push(a, c, a2, c, c2, a2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      b.add(g, 'armor');
      // bolts: corners and edge middles, set in from the bevel
      const bi2 = 0.05 / R0;
      const la_ = [A1[0] + bi2, (A1[0] + A1[1]) / 2, A1[1] - bi2];
      const lo_ = [A1[2] + bi2 / Math.cos(lam), (A1[2] + A1[3]) / 2, A1[3] - bi2 / Math.cos(lam)];
      for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) {
        if (a === 1 && c === 1) continue;
        if ((a === 1 || c === 1) && R() < 0.35) continue;
        const d = dirOf(la_[a], lo_[c]);
        bolts.push({ p: d.clone().multiplyScalar(R0 + 0.003), n: d });
      }
    }
  }
  return bolts;
}

// ---------------------------------------------------------------------------- components
function cameraPod(b, cam, R0) {
  const f = frameAt(cam.dir, V(0, 0, -1));
  b.pushM(mBasis(f, cam.dir.clone().multiplyScalar(R0 - 0.05)));
  // armoured boss let into the plates, a bolt ring
  b.cyl(0.46, 0.52, 0.16, 'metalDark', [0, 0.08, 0], null, 40);
  b.torus(0.47, 0.025, 'metal', [0, 0.165, 0], [Math.PI / 2, 0, 0], 40);
  for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; b.cyl(0.018, 0.02, 0.022, 'bolt', [Math.cos(a) * 0.41, 0.17, Math.sin(a) * 0.41], null, 6); }
  // turntable and yoke
  b.cyl(0.3, 0.32, 0.07, 'metal', [0, 0.2, 0], null, 32);
  for (const s of [-1, 1]) {
    b.box(0.06, 0.42, 0.22, 'armorPlain', [s * 0.27, 0.42, 0], null, 0.02);
    b.cyl(0.07, 0.07, 0.05, 'steel', [s * 0.3, 0.55, 0], [0, 0, Math.PI / 2], 16);     // elevation bearing
    b.cyl(0.03, 0.03, 0.08, 'bolt', [s * 0.335, 0.55, 0], [0, 0, Math.PI / 2], 8);
  }
  // housing on its elevation axis, looking out along +y (the camera's axis)
  b.push([0, 0.55, 0]);
  b.cyl(0.21, 0.21, 0.46, 'armorPlain', [0, 0.06, 0], null, 32);
  for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; b.box(0.012, 0.3, 0.05, 'metalDark', [Math.cos(a) * 0.215, -0.02, Math.sin(a) * 0.215], [0, -a, 0], 0.004); }   // cooling fins
  b.cyl(0.22, 0.22, 0.025, 'trim', [0, 0.22, 0], null, 32);                       // orange ring
  // optics: hood (flared), front rings, a stack of coated elements, aperture iris
  b.lathe([[0.165, 0.29], [0.175, 0.33], [0.2, 0.4], [0.205, 0.405], [0.19, 0.405], [0.185, 0.4], [0.16, 0.33], [0.15, 0.29]], 'lensRing', [0, 0, 0], null, 40);
  b.torus(0.155, 0.014, 'steel', [0, 0.288, 0], [Math.PI / 2, 0, 0], 32);
  b.add(new THREE.SphereGeometry(0.15, 32, 10, 0, Math.PI * 2, 0, 0.55), 'lens', [0, 0.17, 0]);
  b.cyl(0.11, 0.11, 0.005, 'lens', [0, 0.25, 0], null, 32);
  for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; b.box(0.06, 0.004, 0.02, 'lensRing', [Math.cos(a) * 0.12, 0.258, Math.sin(a) * 0.12], [0, -a + 0.6, 0], 0); }
  // IR illuminators round the lens, the tally LED, a wiper arm parked at the side
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + 0.3; b.sphere(0.012, 'ledR', [Math.cos(a) * 0.178, 0.296, Math.sin(a) * 0.178], 8); }
  b.sphere(0.016, 'ledG', [0.14, 0.24, 0.14], 8);
  b.box(0.012, 0.012, 0.2, 'steel', [0.19, 0.31, 0.02], [0.2, 0, 0], 0.003);
  b.pop();
  // cable conduit from the housing into the armour
  b.tube([V(-0.18, 0.5, 0.12), V(-0.36, 0.28, 0.2), V(-0.44, 0.1, 0.24)], 0.022, 'cable', { radial: 6 });
  b.pop();
  // stencilled label beside the boss
  const lab = cam.dir.clone().addScaledVector(f.x, 0.17).normalize();
  sphereDecal(b, 'cam' + cam.id, lab, 0.34, 0.34, 0);
}

function rcsQuad(b, d, R0, spots) {
  const f = frameAt(d);
  b.pushM(mBasis(f, d.clone().multiplyScalar(R0 - 0.02)));
  b.box(0.36, 0.2, 0.36, 'metalDark', [0, 0.08, 0], null, 0.04);
  b.box(0.3, 0.02, 0.3, 'trim', [0, 0.19, 0], null, 0.01);
  for (const [dx, dz, rx, rz] of [[0.22, 0, 0, -Math.PI / 2], [-0.22, 0, 0, Math.PI / 2], [0, 0.22, Math.PI / 2, 0], [0, -0.22, -Math.PI / 2, 0]]) {
    b.cyl(0.028, 0.06, 0.12, 'nozzle', [dx, 0.1, dz], [rx, 0, rz], 12, true);
    b.cyl(0.03, 0.03, 0.02, 'metal', [dx * 0.8, 0.1, dz * 0.8], [rx, 0, rz], 10);
  }
  b.cyl(0.028, 0.065, 0.12, 'nozzle', [0, 0.26, 0], null, 12, true);
  for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + Math.PI / 4; b.cyl(0.012, 0.012, 0.012, 'bolt', [Math.cos(a) * 0.15, 0.2, Math.sin(a) * 0.15], null, 6); }
  b.pop();
  spots.push({ p: d.clone().multiplyScalar(R0 + 0.25), n: d.clone() });
}

function mainDrive(b, parts) {
  const z0 = H8.driveZ;
  // mounting plate and thrust ring welded into the stern, struts to the armour
  b.cyl(1.45, 1.52, 0.16, 'metalDark', [0, 0, z0], [Math.PI / 2, 0, 0], 48);
  b.torus(1.38, 0.08, 'metal', [0, 0, z0 + 0.14], [0, 0, 0], 48);
  for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; b.cyl(0.03, 0.034, 0.03, 'bolt', [Math.cos(a) * 1.3, Math.sin(a) * 1.3, z0 + 0.1], [Math.PI / 2, 0, 0], 6); }
  // magnetic nozzle: outer shell + inner liner (lathed along +y, laid along +z)
  const prof = [];
  for (let i = 0; i <= 22; i++) { const t = i / 22; prof.push([0.3 + 0.68 * Math.pow(t, 0.7), t * 1.75]); }
  b.push([0, 0, z0 + 0.12], [Math.PI / 2, 0, 0]);
  b.lathe(prof, 'nozzle', [0, 0, 0], null, 64);
  b.lathe(prof.map(([r, y]) => [r - 0.03, y]).reverse(), 'nozzle', [0, 0, 0], null, 64);
  // cooling channels running down the bell
  for (let k = 0; k < 56; k++) {
    const a = k / 56 * Math.PI * 2;
    const pts = prof.filter((_, i) => i % 3 === 0).map(([r, y]) => V(Math.cos(a) * (r + 0.012), y, Math.sin(a) * (r + 0.012)));
    b.tube(pts, 0.01, 'nozzle', { radial: 4, seg: 16 });
  }
  // three superconducting coils round the bell (they glow with the drive)
  for (const t of [0.25, 0.55, 0.85]) {
    const r = 0.3 + 0.68 * Math.pow(t, 0.7) + 0.07;
    b.torus(r, 0.075, 'coil', [0, t * 1.75, 0], [Math.PI / 2, 0, 0], 64);
    b.torus(r + 0.06, 0.018, 'metalDark', [0, t * 1.75 + 0.06, 0], [Math.PI / 2, 0, 0], 64);
  }
  // the throat: a glowing ring deep in the bell
  b.cyl(0.28, 0.28, 0.04, 'throat', [0, 0.06, 0], null, 40);
  b.pop();
  // gimbal actuators from the thrust ring to the bell
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * Math.PI * 2 + Math.PI / 4;
    b.pipe(V(Math.cos(a) * 1.25, Math.sin(a) * 1.25, z0 + 0.2), V(Math.cos(a) * 0.62, Math.sin(a) * 0.62, z0 + 1.0), 0.045, 'steel', 10);
    b.cyl(0.07, 0.07, 0.18, 'metalDark', [Math.cos(a) * 1.12, Math.sin(a) * 1.12, z0 + 0.35], [Math.PI / 2, 0, 0], 12);
  }
  // auxiliary engines on short pylons at the diagonals
  parts.auxExits = [];
  for (const [rr, deg] of H8.aux) {
    const a = deg * Math.PI / 180, x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    b.box(0.32, 0.32, 0.5, 'metalDark', [x * 0.92, y * 0.92, z0 - 0.05], null, 0.04);
    b.push([x, y, z0 + 0.15], [Math.PI / 2, 0, 0]);
    const ap = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; ap.push([0.1 + 0.24 * Math.pow(t, 0.65), t * 0.72]); }
    b.lathe(ap, 'nozzle', [0, 0, 0], null, 32);
    b.lathe(ap.map(([r, yy]) => [r - 0.016, yy]).reverse(), 'nozzle', [0, 0, 0], null, 32);
    b.torus(0.26, 0.022, 'metal', [0, 0.45, 0], [Math.PI / 2, 0, 0], 32);
    b.cyl(0.13, 0.15, 0.16, 'steel', [0, -0.05, 0], null, 20);
    b.pop();
    parts.auxExits.push(V(x, y, z0 + 0.87));
  }
  parts.driveExit = V(0, 0, z0 + 1.9);
}

function radiatorWing(side, M) {
  // its own group (it swings out on its hinge): panel 3.1 x 1.5 m with heat pipes and ribs
  const b = new Builder();
  const W = 3.1, D = 1.5;
  b.cyl(0.11, 0.11, D + 0.2, 'steel', [0, 0, 0], [Math.PI / 2, 0, 0], 16);          // hinge
  b.box(0.3, 0.12, 0.3, 'metalDark', [side * 0.18, 0, 0], null, 0.03);
  b.box(W, 0.045, D, 'radiator', [side * (0.35 + W / 2), 0, 0], null, 0.008);
  for (let k = 0; k < 11; k++) {
    const z = -D / 2 + 0.1 + k * (D - 0.2) / 10;
    for (const yy of [0.03, -0.03]) b.cyl(0.018, 0.018, W - 0.1, 'mli', [side * (0.35 + W / 2), yy, z], [0, 0, Math.PI / 2], 6);
  }
  for (let k = 0; k <= 5; k++) b.box(0.05, 0.07, D + 0.02, 'metalDark', [side * (0.35 + k * W / 5), 0, 0], null, 0.01);
  b.box(W, 0.06, 0.05, 'metalDark', [side * (0.35 + W / 2), 0, D / 2], null, 0.01);
  b.box(W, 0.06, 0.05, 'metalDark', [side * (0.35 + W / 2), 0, -D / 2], null, 0.01);
  // coolant manifold along the root, flex hoses into the hinge
  b.cyl(0.05, 0.05, D, 'metal', [side * 0.38, 0.05, 0], [Math.PI / 2, 0, 0], 12);
  for (const z of [-0.5, 0, 0.5]) b.tube([V(side * 0.38, 0.06, z), V(side * 0.22, 0.14, z), V(side * 0.05, 0.08, z)], 0.025, 'cable', { radial: 6 });
  // tip light and the NO STEP warning
  b.sphere(0.035, side < 0 ? 'navR' : 'navG', [side * (0.35 + W + 0.04), 0, -D / 2 + 0.1], 10);
  const grp = b.build(M, { castShadow: false });
  return grp;
}

function sensors(b, parts) {
  const R0 = H8.R;
  // radar under its dome (forward, high): base boss, a slab antenna that turns (own group)
  const dRad = V(0, Math.sin(0.87), -Math.cos(0.87));
  const fr = frameAt(dRad);
  b.pushM(mBasis(fr, dRad.clone().multiplyScalar(R0 - 0.03)));
  b.cyl(0.42, 0.48, 0.14, 'metalDark', [0, 0.07, 0], null, 40);
  b.torus(0.43, 0.03, 'trim', [0, 0.15, 0], [Math.PI / 2, 0, 0], 40);
  b.add(new THREE.SphereGeometry(0.4, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), 'dome', [0, 0.14, 0]);
  b.pop();
  parts.radarAt = mBasis(fr, dRad.clone().multiplyScalar(R0 + 0.16));
  // star trackers (two, aft-high), with stepped sunshades
  for (const s of [-1, 1]) {
    const d = V(s * 0.42, 0.78, 0.46).normalize();
    const f = frameAt(d);
    b.pushM(mBasis(f, d.clone().multiplyScalar(R0 - 0.02)));
    b.box(0.22, 0.18, 0.22, 'metalDark', [0, 0.09, 0], null, 0.02);
    b.lathe([[0.05, 0.17], [0.07, 0.24], [0.085, 0.24], [0.09, 0.32], [0.105, 0.32], [0.11, 0.4], [0.1, 0.4], [0.08, 0.24], [0.045, 0.17]], 'lensRing', [0, 0, 0], [s * 0.3, 0, 0.2], 24);
    b.cyl(0.045, 0.045, 0.004, 'lens', [0, 0.175, 0], null, 20);
    b.pop();
  }
  // high-gain dish on a two-joint arm (aft, high)
  {
    const d = V(0, 0.64, 0.77).normalize();
    const f = frameAt(d);
    b.pushM(mBasis(f, d.clone().multiplyScalar(R0 - 0.02)));
    b.cyl(0.16, 0.2, 0.12, 'metalDark', [0, 0.06, 0], null, 24);
    b.cyl(0.05, 0.05, 0.55, 'steel', [0, 0.38, 0], null, 12);
    b.sphere(0.07, 'metal', [0, 0.66, 0], 12);
    b.push([0, 0.66, 0], [0.9, 0, 0]);
    b.cyl(0.045, 0.045, 0.4, 'steel', [0, 0.2, 0], null, 12);
    b.push([0, 0.42, 0], [-0.6, 0, 0]);
    b.lathe([[0.02, 0], [0.12, 0.012], [0.24, 0.045], [0.35, 0.1], [0.36, 0.105], [0.355, 0.11], [0.235, 0.055], [0.115, 0.022], [0.02, 0.01]], 'radarDish', [0, 0, 0], null, 40);
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2; b.pipe(V(Math.cos(a) * 0.3, 0.09, Math.sin(a) * 0.3), V(0, 0.32, 0), 0.008, 'steel', 6); }
    b.cyl(0.035, 0.03, 0.06, 'metalDark', [0, 0.34, 0], null, 12);
    b.pop(); b.pop(); b.pop();
  }
  // laser comm terminal (starboard, high)
  {
    const d = V(0.86, 0.45, -0.24).normalize();
    const f = frameAt(d);
    b.pushM(mBasis(f, d.clone().multiplyScalar(R0 - 0.02)));
    b.cyl(0.14, 0.18, 0.1, 'metalDark', [0, 0.05, 0], null, 24);
    b.box(0.08, 0.2, 0.2, 'metal', [0, 0.2, 0], null, 0.02);
    b.cyl(0.08, 0.08, 0.32, 'armorPlain', [0, 0.3, 0.05], [Math.PI / 2 - 0.4, 0, 0], 24);
    b.cyl(0.065, 0.065, 0.004, 'lens', [0, 0.36, 0.2], [Math.PI / 2 - 0.4, 0, 0], 24);
    b.pop();
  }
  // whip antennas and sun sensors
  for (const [x, y, z, L] of [[-0.55, 0.8, -0.2, 1.4], [0.3, 0.9, 0.3, 1.0], [-0.9, 0.35, 0.25, 0.9]]) {
    const d = V(x, y, z).normalize();
    const p = d.clone().multiplyScalar(R0);
    b.cyl(0.05, 0.06, 0.06, 'metalDark', p.toArray(), null, 10);
    b.pipe(p, p.clone().addScaledVector(d, L), 0.009, 'steel', 6);
    b.sphere(0.022, 'rubber', p.clone().addScaledVector(d, L).toArray(), 8);
  }
  for (const [x, y, z] of [[0.6, 0.6, -0.5], [-0.6, 0.6, -0.5], [0, 0.2, -0.98]]) {
    const d = V(x, y, z).normalize();
    b.pushM(mBasis(frameAt(d), d.clone().multiplyScalar(R0 + 0.005)));
    b.cyl(0.08, 0.09, 0.03, 'metalDark', [0, 0.015, 0], null, 16);
    b.add(new THREE.SphereGeometry(0.06, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 'lens', [0, 0.03, 0]);
    b.pop();
  }
}

function dockingNeck(b, parts) {
  b.push([0, 0, H8.shaftZ]);
  dockingNeckAt(b, parts);
  b.pop();
  for (const p of parts.dockFloods) p.z += H8.shaftZ;
}

function dockingNeckAt(b, parts) {
  const R0 = H8.R, rN = H8.neckR;
  const yTop = -Math.sqrt(R0 * R0 - (rN + 0.35) ** 2) + 0.05;
  // collar plate on the sphere round the neck, a heavy bolt ring
  b.lathe([[rN, 0], [rN + 0.38, 0.02], [rN + 0.42, 0.06], [rN + 0.4, 0.1], [rN, 0.11]], 'metalDark', [0, yTop - 0.06, 0], [Math.PI, 0, 0], 48);
  for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; b.cyl(0.02, 0.022, 0.025, 'bolt', [Math.cos(a) * (rN + 0.24), yTop - 0.085, Math.sin(a) * (rN + 0.24)], [Math.PI, 0, 0], 6); }
  // the neck (hollow: the access shaft runs through it), ribs, hazard band
  const yB = H8.neckBottom + 0.18;
  b.cyl(rN, rN, yTop - yB, 'armorPlain', [0, (yTop + yB) / 2, 0], null, 48, true);
  b.cyl(H8.shaftR + 0.02, H8.shaftR + 0.02, yTop - yB + 0.2, 'metalDark', [0, (yTop + yB) / 2, 0], null, 40, true);
  for (const y of [yB + 0.12, (yTop + yB) / 2, yTop - 0.1]) b.torus(rN + 0.012, 0.03, 'metal', [0, y, 0], [Math.PI / 2, 0, 0], 48);
  b.cyl(rN + 0.006, rN + 0.006, 0.12, 'trim', [0, yB + 0.3, 0], null, 48, true);
  // androgynous mating ring: base ring, seal, three guide petals, twelve latches, guide pins
  const yR = H8.neckBottom;
  b.cyl(rN + 0.12, rN + 0.12, 0.18, 'metalDark', [0, yR + 0.09, 0], null, 48, true);
  b.add(new THREE.RingGeometry(H8.shaftR + 0.02, rN + 0.12, 48), 'metal', [0, yR + 0.004, 0], [Math.PI / 2, 0, 0]);
  b.torus(rN - 0.05, 0.025, 'rubber', [0, yR, 0], [Math.PI / 2, 0, 0], 48);
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI * 2 + Math.PI / 6;
    const sh = new THREE.Shape([new THREE.Vector2(-0.22, 0), new THREE.Vector2(0.22, 0), new THREE.Vector2(0.12, 0.34), new THREE.Vector2(-0.12, 0.34)]);
    b.push([Math.cos(a) * (rN + 0.08), yR - 0.02, Math.sin(a) * (rN + 0.08)], [0, -a + Math.PI / 2, 0]);
    b.extrude(sh, 0.03, 'metal', [0, 0, 0], [Math.PI + 0.35, 0, 0], 0.006);
    b.pop();
  }
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2;
    b.box(0.07, 0.1, 0.05, 'steel', [Math.cos(a) * (rN + 0.05), yR + 0.06, Math.sin(a) * (rN + 0.05)], [0, -a, 0], 0.01);
    b.box(0.03, 0.05, 0.06, 'metalDark', [Math.cos(a) * (rN - 0.01), yR - 0.01, Math.sin(a) * (rN - 0.01)], [0, -a, 0], 0.005);
  }
  for (const a of [0.3, 0.3 + Math.PI]) b.cyl(0.02, 0.012, 0.12, 'steel', [Math.cos(a) * (rN - 0.12), yR - 0.06, Math.sin(a) * (rN - 0.12)], null, 10);
  // H8's own hatch at the foot of the neck slides sideways into a pocket on the neck's port side
  // (the hatch itself is a separate, moving part); the pocket's armoured fairing, its guide rails
  const yh = H8.neckHatchY;
  b.box(1.08, 0.13, 1.02, 'armorPlain', [-(H8.shaftR + 0.56), yh, 0], null, 0.03);
  b.box(1.0, 0.02, 0.94, 'trim', [-(H8.shaftR + 0.58), yh + 0.07, 0], null, 0.008);
  for (const s of [-1, 1]) b.box(1.0, 0.03, 0.03, 'steel', [-(H8.shaftR + 0.5), yh - 0.075, s * 0.42], null, 0.006);
  for (let k = 0; k < 6; k++) b.cyl(0.016, 0.018, 0.02, 'bolt', [-(H8.shaftR + 0.18 + k * 0.17), yh + 0.075, 0.44], null, 6);
  // docking floods and a target camera round the ring
  parts.dockFloods = [];
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * Math.PI * 2 + Math.PI / 4;
    const p = V(Math.cos(a) * (rN + 0.2), yR + 0.32, Math.sin(a) * (rN + 0.2));
    b.box(0.12, 0.08, 0.1, 'metalDark', p.toArray(), [0, -a, 0], 0.015);
    b.box(0.09, 0.012, 0.07, 'flood', [p.x, p.y - 0.045, p.z], [0, -a, 0], 0.003);
    parts.dockFloods.push(p);
  }
  b.cyl(0.05, 0.05, 0.12, 'armorPlain', [rN + 0.22, yR + 0.5, 0], null, 16);
  b.cyl(0.035, 0.035, 0.004, 'lens', [rN + 0.22, yR + 0.437, 0], null, 16);
  // hazard ring and the docking cross painted round the neck root
  sphereDecal(b, 'warn', V(0.25, -1, 0).normalize(), 0.5, 0.18, 0);
  sphereDecal(b, 'dock', V(-0.25, -1, 0.12).normalize(), 0.42, 0.42, 0.3);
}

function powerCoupling(b, parts) {
  const at = H8.couplingAt.clone();
  const d = at.clone().normalize();
  const f = frameAt(d, V(0, 0, 1));
  b.pushM(mBasis(f, d.clone().multiplyScalar(H8.R - 0.04)));
  b.box(0.62, 0.22, 0.5, 'metalDark', [0, 0.1, 0], null, 0.05);
  b.box(0.56, 0.03, 0.44, 'warnStripe', [0, 0.215, 0], null, 0.008);
  b.cyl(0.16, 0.18, 0.12, 'steel', [0, 0.27, 0], null, 32);
  b.cyl(0.11, 0.11, 0.02, 'metalDark', [0, 0.335, 0], null, 32);
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; b.cyl(0.018, 0.018, 0.03, 'coil', [Math.cos(a) * 0.065, 0.345, Math.sin(a) * 0.065], null, 8); }
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; b.cyl(0.014, 0.016, 0.02, 'bolt', [Math.cos(a) * 0.26 * 1.1, 0.225, Math.sin(a) * 0.2], null, 6); }
  b.box(0.05, 0.05, 0.05, 'ledA', [0.25, 0.23, 0.17], null, 0.01);
  b.pop();
  sphereDecal(b, 'hv', d.clone().addScaledVector(f.z, -0.12).normalize(), 0.3, 0.3, 0);
  parts.couplingTip = d.clone().multiplyScalar(H8.R + 0.31);
}

function railsAndLights(b, parts) {
  const R0 = H8.R;
  // meridian handrails (upper hemisphere, between the components), standoffs every 0.4 m
  for (const lon of [0.55, 1.6, 2.6, 3.7, 4.7, 5.7]) {
    const pts = [];
    for (let la = 0.12; la < 1.05; la += 0.08) pts.push(V(Math.cos(la) * Math.sin(lon), Math.sin(la), -Math.cos(la) * Math.cos(lon)).multiplyScalar(R0 + 0.13));
    b.tube(pts, 0.02, 'handrail', { radial: 8, seg: 40 });
    for (let i = 0; i < pts.length; i += 3) b.pipe(pts[i], pts[i].clone().setLength(R0 - 0.01), 0.013, 'steel', 6);
  }
  // nav lights (equator, forward), strobes top and bottom, two forward floods
  parts.nav = { port: V(-R0 * 0.94, 0.2, -R0 * 0.33), star: V(R0 * 0.94, 0.2, -R0 * 0.33) };
  b.sphere(0.05, 'navR', parts.nav.port.toArray(), 12);
  b.sphere(0.05, 'navG', parts.nav.star.toArray(), 12);
  parts.strobes = [V(0.5, R0 * 0.96, 0.6), V(0.6, -R0 * 0.93, -0.9)];
  for (const s of parts.strobes) { b.cyl(0.06, 0.07, 0.05, 'metalDark', s.toArray(), null, 12); b.sphere(0.045, 'strobe', [s.x, s.y + Math.sign(s.y) * 0.04, s.z], 12); }
  for (const s of [-1, 1]) {
    const d = V(s * 0.35, 0.15, -1).normalize();
    const f = frameAt(d);
    b.pushM(mBasis(f, d.clone().multiplyScalar(R0 - 0.01)));
    b.box(0.26, 0.1, 0.16, 'metalDark', [0, 0.05, 0], null, 0.02);
    b.box(0.22, 0.012, 0.12, 'flood', [0, 0.105, 0], null, 0.003);
    b.pop();
  }
}

function markings(b) {
  // the big H8 on both flanks, serials, the "八" crest forward, warnings at the stern
  sphereDecal(b, 'H8', V(-1, 0.32, 0.1).normalize(), 1.3, 1.3, 0);
  sphereDecal(b, 'H8', V(1, 0.32, 0.1).normalize(), 1.3, 1.3, 0);
  sphereDecal(b, 'HX08', V(-1, -0.06, 0.25).normalize(), 0.9, 0.9, 0);
  sphereDecal(b, 'HX08', V(1, -0.06, 0.25).normalize(), 0.9, 0.9, 0);
  sphereDecal(b, 'hachi', V(0, 0.42, -1).normalize(), 0.75, 0.75, 0);
  for (const s of [-1, 1]) sphereDecal(b, 'exhaust', V(s * 0.62, 0.15, 0.78).normalize(), 0.6, 0.6, 0);
  sphereDecal(b, 'rad', V(0, -0.62, 0.78).normalize(), 0.5, 0.5, 0);
  sphereDecal(b, 'fuel', V(-0.8, -0.45, -0.4).normalize(), 0.45, 0.45, 0);
  sphereDecal(b, 'nostep', V(0.97, 0.1, 0.24).normalize(), 0.4, 0.4, 0);
  sphereDecal(b, 'nostep', V(-0.97, 0.1, 0.24).normalize(), 0.4, 0.4, 0);
  for (const s of [-1, 1]) sphereDecal(b, 'arrow', V(s * 0.3, -0.85, -0.42).normalize(), 0.26, 0.26, Math.PI);
}

function servicePanels(b) {
  // access hatches with quarter-turn latches, a few vents and sensor windows on the plates
  const R = rng(55);
  for (let k = 0; k < 14; k++) {
    const d = V(R() - 0.5, (R() - 0.5) * 1.4, R() - 0.5).normalize();
    if (exclusions().some((e) => d.angleTo(e.dir) < e.ang + 0.2)) continue;
    const f = frameAt(d);
    b.pushM(mBasis(f, d.clone().multiplyScalar(H8.R + 0.002)));
    const w = 0.24 + R() * 0.2, h = 0.18 + R() * 0.16;
    b.box(w, 0.016, h, R() < 0.5 ? 'metalDark' : 'armorPlain', [0, 0.008, 0], null, 0.006);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.cyl(0.012, 0.012, 0.012, 'bolt', [x * (w / 2 - 0.03), 0.02, z * (h / 2 - 0.03)], null, 6);
    if (R() < 0.4) for (let i = 0; i < 5; i++) b.box(w * 0.7, 0.008, 0.012, 'substrate', [0, 0.018, -h / 3 + i * h / 6], null, 0.002);
    b.pop();
  }
}

/**
 * Build H8's exterior. Returns { group, far (low-detail stand-in), parts } — parts are the
 * animated / referenced bits: radiator wings, radar rotor, plume meshes, light positions, RCS
 * spots, the drive exit, the coupling tip.
 */
export function buildH8Exterior(M) {
  const b = new Builder();
  const parts = { rcs: [] };
  // substrate under the plates (shows in the seams), the plates, their bolts
  b.sphere(H8.R - 0.065, 'substrate', [0, 0, 0], 64);
  const bolts = armourTiles(b, H8.R);
  // equatorial belt seam
  b.torus(H8.R + 0.004, 0.03, 'metalDark', [0, 0, 0], [Math.PI / 2, 0, 0], 128);
  for (const c of CAMERAS) cameraPod(b, c, H8.R);
  for (const d of RCS) rcsQuad(b, d, H8.R, parts.rcs);
  mainDrive(b, parts);
  sensors(b, parts);
  dockingNeck(b, parts);
  powerCoupling(b, parts);
  railsAndLights(b, parts);
  markings(b);
  servicePanels(b);
  // radiator hinge fairings at the flanks
  for (const s of [-1, 1]) b.box(0.3, 0.3, 1.8, 'metalDark', [s * (H8.R - 0.02), 0, 0], null, 0.06);
  // a few warning-striped tiles near the coupling are separate (key needs its own material)
  M.warnStripe = M.warnStripe || M.trim;
  const group = b.build(M, { castShadow: false });
  group.name = 'h8Exterior';
  // bolts (instanced)
  const boltGeo = new THREE.CylinderGeometry(0.016, 0.019, 0.016, 6);
  const im = new THREE.InstancedMesh(boltGeo, M.bolt, bolts.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  bolts.forEach((bt, i) => {
    q.setFromUnitVectors(Y, bt.n);
    m.compose(bt.p.clone().addScaledVector(bt.n, 0.008), q, new THREE.Vector3(1, 1, 1));
    im.setMatrixAt(i, m);
  });
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  group.add(im);
  parts.boltCount = bolts.length;
  // radiator wings on their hinges
  parts.radiators = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * (H8.R + 0.12), 0, 0);
    pivot.add(radiatorWing(s, M));
    group.add(pivot);
    parts.radiators.push({ pivot, side: s });
  }
  // the radar slab turning under its dome
  {
    const rb = new Builder();
    rb.box(0.56, 0.12, 0.04, 'radarDish', [0, 0.12, 0.04], [0.25, 0, 0], 0.01);
    rb.cyl(0.04, 0.05, 0.1, 'metal', [0, 0.05, 0], null, 12);
    const rotor = rb.build(M, { castShadow: false });
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(parts.radarAt);
    holder.add(rotor);
    group.add(holder);
    parts.radar = rotor;
  }
  // plumes: main drive (three nested cones + core), aux engines
  parts.plumes = [];
  const cone = (len, r0, r1, mat) => {
    const g = new THREE.CylinderGeometry(r0, r1, len, 32, 1, true);
    g.translate(0, -len / 2, 0);
    g.rotateX(-Math.PI / 2);   // along +z
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    return mesh;
  };
  {
    const pg = new THREE.Group();
    pg.position.copy(parts.driveExit);
    const c1 = cone(9, 0.95, 2.4, M.plume), c2 = cone(16, 0.7, 3.4, M.plume.clone()), core = cone(5, 0.35, 0.05, M.plumeCore);
    pg.add(c1, c2, core);
    group.add(pg);
    parts.plumes.push({ group: pg, cones: [c1, c2], core, main: true });
  }
  for (const e of parts.auxExits) {
    const pg = new THREE.Group();
    pg.position.copy(e);
    const c1 = cone(2.6, 0.33, 0.8, M.auxPlume.clone());
    pg.add(c1);
    group.add(pg);
    parts.plumes.push({ group: pg, cones: [c1], main: false });
  }
  group.traverse((o) => { o.castShadow = false; });
  // ---- low-detail stand-in for distance
  const fb = new Builder();
  fb.sphere(H8.R, 'armorPlain', [0, 0, 0], 24);
  fb.cyl(0.98, 0.3, 1.75, 'nozzle', [0, 0, H8.driveZ + 1.0], [Math.PI / 2, 0, 0], 20, true);
  for (const c of CAMERAS) fb.box(0.5, 0.5, 0.5, 'metalDark', c.dir.clone().multiplyScalar(H8.R + 0.25).toArray(), null, 0);
  for (const s of [-1, 1]) fb.box(3.1, 0.05, 1.5, 'radiator', [s * (H8.R + 1.9), 0, 0], null, 0);
  fb.cyl(0.62, 0.62, 0.8, 'armorPlain', [0, -3.9, H8.shaftZ], null, 16);
  const far = fb.build(M, { castShadow: false });
  far.name = 'h8Far';
  return { group, far, parts };
}
