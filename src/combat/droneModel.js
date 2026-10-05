// The hunter drone's looks, in three levels of detail (local frame: -z forward, +y up, about
// 2.2 m across the thruster pods):
//   hi  — close up: a faceted hull clad in separate armour plates (seams, rivets), a sensor head
//         with a red main eye, side lenses and a lidar strip, a 20 mm cannon with a ribbed cooling
//         jacket, muzzle brake, gas tube, ammunition drum and feed chute, braced arms with hydraulic
//         lines, four gimballed thruster pods (intake rings, heat shields, nozzle bells with liners,
//         RCS quads), canted fins, a radar blister, antennas, side radiators, hazard markings and
//         nav lights — about 20 k triangles, drawn only within a couple of hundred metres (or
//         through a zoom that brings it that close)
//   mid — the plain model for the middle distance
//   lo  — a few hundred triangles: the low quality setting, and far away
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function droneMaterials() {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  return {
    hull: S({ color: 0x2c3036, metalness: 0.72, roughness: 0.42 }),
    plate: S({ color: 0x3b4048, metalness: 0.6, roughness: 0.5 }),
    plate2: S({ color: 0x4a5059, metalness: 0.55, roughness: 0.46 }),
    dark: S({ color: 0x121417, metalness: 0.5, roughness: 0.55 }),
    steel: S({ color: 0x8d949c, metalness: 0.95, roughness: 0.3 }),
    gun: S({ color: 0x1c1e21, metalness: 0.85, roughness: 0.34 }),
    nozzle: S({ color: 0x3d3833, metalness: 0.88, roughness: 0.32 }),
    heat: S({ color: 0x221f1c, metalness: 0.25, roughness: 0.82 }),
    rubber: S({ color: 0x161616, metalness: 0.0, roughness: 0.9 }),
    radiator: S({ color: 0xb9bec4, metalness: 0.4, roughness: 0.38 }),
    lens: S({ color: 0x040608, metalness: 0.3, roughness: 0.04 }),
    stripe: S({ color: 0xc9a227, metalness: 0.2, roughness: 0.6 }),
    red: S({ color: 0x8a1c14, metalness: 0.25, roughness: 0.55 }),
    eye: S({ color: 0x000000, emissive: new THREE.Color(1, 0.08, 0.04), emissiveIntensity: 6 }),
    jet: S({ color: 0x000000, emissive: new THREE.Color(0.55, 0.75, 1.0), emissiveIntensity: 0 }),
    lamp: S({ color: 0x000000, emissive: new THREE.Color(1, 0.12, 0.05), emissiveIntensity: 0 }),
    navR: S({ color: 0x000000, emissive: new THREE.Color(1, 0.1, 0.06), emissiveIntensity: 2.5 }),
    navG: S({ color: 0x000000, emissive: new THREE.Color(0.1, 1, 0.3), emissiveIntensity: 2.5 }),
  };
}

// the hull's sections: [z, half-width] (the height is 0.7 of the width), nose to tail
const BODY = [[-0.82, 0.1], [-0.66, 0.24], [-0.4, 0.33], [0.0, 0.36], [0.35, 0.33], [0.62, 0.22], [0.76, 0.06]];
const SIDES = 8, ROT0 = Math.PI / 8;
const POD = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

function bodyPoint(s, k) {
  const a = ROT0 + k / SIDES * Math.PI * 2;
  return V(Math.cos(a) * s[1], Math.sin(a) * s[1] * 0.7, s[0]);
}

/** the faceted hull itself (flat facets, closed at both ends) */
function hullGeometry() {
  const pos = [];
  const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < BODY.length - 1; i++) {
    for (let k = 0; k < SIDES; k++) {
      const a = bodyPoint(BODY[i], k), b = bodyPoint(BODY[i], k + 1), c = bodyPoint(BODY[i + 1], k + 1), d = bodyPoint(BODY[i + 1], k);
      tri(a, b, c); tri(a, c, d);
    }
  }
  const n0 = V(0, 0, BODY[0][0]), n1 = V(0, 0, BODY[BODY.length - 1][0]);
  for (let k = 0; k < SIDES; k++) {
    tri(n0, bodyPoint(BODY[0], k + 1), bodyPoint(BODY[0], k));
    const L = BODY[BODY.length - 1];
    tri(n1, bodyPoint(L, k), bodyPoint(L, k + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** a frame on facet k of segment i: origin at its middle, Y out of it, Z along the body */
function facetFrame(i, k, lift = 0) {
  const a = bodyPoint(BODY[i], k), b = bodyPoint(BODY[i], k + 1), c = bodyPoint(BODY[i + 1], k + 1), d = bodyPoint(BODY[i + 1], k);
  const mid0 = a.clone().add(b).multiplyScalar(0.5), mid1 = d.clone().add(c).multiplyScalar(0.5);
  const along = mid1.clone().sub(mid0);
  const len = along.length();
  along.normalize();
  const across = b.clone().sub(a).add(c.clone().sub(d)).multiplyScalar(0.5);
  const wMin = Math.min(b.distanceTo(a), c.distanceTo(d));
  across.normalize();
  const n = new THREE.Vector3().crossVectors(across, along).normalize();
  const centre = a.clone().add(b).add(c).add(d).multiplyScalar(0.25).addScaledVector(n, lift);
  // X across, Y out, Z = X x Y (back along the body)
  const z = new THREE.Vector3().crossVectors(across, n);
  const m = new THREE.Matrix4().makeBasis(across, n, z).setPosition(centre);
  return { m, len, wMin, n };
}

export function droneHi(M) {
  const b = new Builder();
  // ---------------------------------------------------------------- hull and its armour
  b.add(hullGeometry(), 'dark');
  for (let i = 0; i < BODY.length - 1; i++) {
    for (let k = 0; k < SIDES; k++) {
      const F = facetFrame(i, k, 0.007);
      if (F.wMin < 0.08 || F.len < 0.08) continue;
      const key = (i * 3 + k) % 7 === 0 ? 'plate2' : (i + k) % 2 ? 'plate' : 'hull';
      const w = F.wMin - 0.03, d = F.len - 0.03;
      b.pushM(F.m);
      b.box(w, 0.014, d, key, [0, 0, 0], null, 0.004, 1);
      // rivets in the corners of every other plate
      if ((i + k) % 2 === 0) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.cyl(0.008, 0.009, 0.008, 'steel', [sx * (w / 2 - 0.022), 0.009, sz * (d / 2 - 0.022)], null, 6);
      // an access panel with a latch on some
      if (k === 2 && i >= 2 && i <= 3) { b.box(w * 0.5, 0.006, d * 0.4, 'dark', [0, 0.01, 0], null, 0.002, 1); b.box(0.03, 0.008, 0.012, 'steel', [w * 0.18, 0.014, 0], null, 0.002, 1); }
      b.pop();
    }
  }
  // the spine: a raised keel with a cable duct, the belly keel
  b.box(0.08, 0.06, 0.82, 'gun', [0, 0.27, 0.08], [0.03, 0, 0], 0.012);
  b.box(0.05, 0.02, 0.78, 'steel', [0, 0.305, 0.08], [0.03, 0, 0], 0.005);
  b.box(0.12, 0.05, 0.6, 'gun', [0, -0.27, 0.12], [-0.04, 0, 0], 0.012);
  // side radiators: thin finned panels on stand-offs
  for (const sx of [-1, 1]) {
    b.box(0.018, 0.13, 0.34, 'radiator', [sx * 0.39, 0.0, 0.12], [0, 0, sx * 0.08], 0.004, 1);
    for (let f = 0; f < 6; f++) b.box(0.03, 0.006, 0.3, 'steel', [sx * 0.4, -0.05 + f * 0.02, 0.12], [0, 0, sx * 0.08], 0, 1);
    for (const z of [0.0, 0.24]) b.cyl(0.008, 0.008, 0.06, 'steel', [sx * 0.365, 0, z], [0, 0, Math.PI / 2], 6);
  }
  // hazard bands round the waist and a red ID band
  b.box(0.5, 0.004, 0.05, 'stripe', [0, 0.235, -0.46], [0.18, 0, 0], 0);
  for (const sx of [-1, 1]) b.box(0.004, 0.12, 0.2, 'red', [sx * 0.345, 0.04, -0.12], [0, 0, sx * 0.05], 0);

  // ---------------------------------------------------------------- sensor head
  b.cyl(0.13, 0.14, 0.07, 'gun', [0, 0.02, -0.8], [Math.PI / 2, 0, 0], 24);
  b.torus(0.13, 0.014, 'steel', [0, 0.02, -0.836], null, 24);
  b.sphere(0.072, 'eye', [0, 0.02, -0.845], 20, [1, 1, 0.6]);
  b.torus(0.085, 0.008, 'dark', [0, 0.02, -0.85], null, 20);
  for (const sx of [-1, 1]) {
    // side lenses in their own collars
    b.cyl(0.032, 0.036, 0.05, 'gun', [sx * 0.1, 0.075, -0.79], [Math.PI / 2, 0, 0], 14);
    b.cyl(0.024, 0.024, 0.006, 'lens', [sx * 0.1, 0.075, -0.817], [Math.PI / 2, 0, 0], 14);
    b.torus(0.026, 0.004, 'steel', [sx * 0.1, 0.075, -0.818], null, 14);
  }
  // lidar strip over the eye, IR emitters round it
  b.box(0.24, 0.028, 0.02, 'lens', [0, 0.11, -0.73], [0.35, 0, 0], 0.004, 1);
  b.box(0.27, 0.04, 0.03, 'gun', [0, 0.11, -0.722], [0.35, 0, 0], 0.006, 1);
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; b.sphere(0.008, 'navR', [Math.cos(a) * 0.105, 0.02 + Math.sin(a) * 0.105 * 0.8, -0.83], 6); }

  // ---------------------------------------------------------------- the cannon
  b.push([0, -0.27, -0.42]);
  b.box(0.16, 0.13, 0.36, 'gun', [0, 0, 0], null, 0.02);
  for (const sx of [-1, 1]) {
    b.box(0.006, 0.08, 0.26, 'dark', [sx * 0.082, 0, 0], null, 0, 1);
    for (const z of [-0.1, 0, 0.1]) b.cyl(0.007, 0.007, 0.01, 'steel', [sx * 0.085, 0.03, z], [0, 0, Math.PI / 2], 6);
  }
  b.box(0.1, 0.03, 0.2, 'dark', [0, 0.075, 0.02], null, 0.006, 1);           // feed cover
  b.cyl(0.03, 0.03, 0.1, 'steel', [0, -0.03, 0.13], [0, 0, Math.PI / 2], 10);   // trunnion
  b.pop();
  // barrel with its cooling jacket, gas tube and muzzle brake
  b.cyl(0.028, 0.03, 0.64, 'steel', [0, -0.28, -0.9], [Math.PI / 2, 0, 0], 16);
  b.cyl(0.044, 0.044, 0.3, 'gun', [0, -0.28, -0.74], [Math.PI / 2, 0, 0], 18);
  for (let r = 0; r < 9; r++) b.torus(0.046, 0.005, 'steel', [0, -0.28, -0.6 - r * 0.034], null, 18);
  b.cyl(0.011, 0.011, 0.5, 'steel', [0, -0.235, -0.82], [Math.PI / 2, 0, 0], 8);
  b.box(0.022, 0.03, 0.03, 'gun', [0, -0.25, -1.04], null, 0.004, 1);
  b.box(0.085, 0.075, 0.13, 'gun', [0, -0.28, -1.2], null, 0.012);
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) b.box(0.006, 0.05, 0.016, 'dark', [sx * 0.043, -0.28, -1.17 - k * 0.03], null, 0, 1);
  b.cyl(0.02, 0.02, 0.006, 'dark', [0, -0.28, -1.267], [Math.PI / 2, 0, 0], 12);
  // the ammunition drum, ribbed, and the chute that feeds the gun
  b.cyl(0.115, 0.115, 0.17, 'plate2', [0, -0.31, -0.1], [0, 0, Math.PI / 2], 24);
  for (const x of [-0.07, 0, 0.07]) b.torus(0.117, 0.007, 'steel', [x, -0.31, -0.1], [0, Math.PI / 2, 0], 24);
  b.cyl(0.04, 0.04, 0.19, 'gun', [0, -0.31, -0.1], [0, 0, Math.PI / 2], 12);
  b.tube([V(0, -0.22, -0.16), V(0, -0.2, -0.28), V(0, -0.2, -0.36)], 0.028, 'dark', { radial: 8, seg: 10 });
  for (const sx of [-1, 1]) b.box(0.05, 0.05, 0.04, 'stripe', [sx * 0.05, -0.27, -0.62], null, 0.004, 1);

  // ---------------------------------------------------------------- arms and thruster pods
  for (const [sx, sy] of POD) {
    const P = V(sx * 0.82, sy * 0.34, 0.28);
    const root = V(sx * 0.25, sy * 0.08, 0.15);
    // main strut, a brace, the hydraulic lines along it, clamp rings
    b.pipe(root, P.clone().add(V(-sx * 0.1, -sy * 0.04, 0)), 0.045, 'hull', 14);
    b.pipe(V(sx * 0.22, sy * 0.04, -0.06), P.clone().add(V(-sx * 0.08, -sy * 0.02, -0.18)), 0.016, 'steel', 8);
    const off = V(0, sy * 0.05, 0.03);
    b.tube([root.clone().add(off), root.clone().lerp(P, 0.5).add(off.clone().multiplyScalar(1.15)), P.clone().add(V(-sx * 0.12, 0, 0.02)).add(off)], 0.008, 'rubber', { radial: 6, seg: 12 });
    for (const t of [0.3, 0.65]) {
      const c = root.clone().lerp(P, t);
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), P.clone().sub(root).normalize());
      const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      b.cyl(0.052, 0.052, 0.025, 'gun', c.toArray(), [e.x, e.y, e.z], 14);
    }
    const mid = root.clone().lerp(P, 0.5);
    b.box(0.06, 0.012, 0.22, 'stripe', [mid.x, mid.y + sy * 0.045, mid.z + 0.03], null, 0.002, 1);
    // the pod: nacelle (lathed along +z), intake ring, panel seams
    b.push(P.toArray(), [Math.PI / 2, 0, 0]);
    b.lathe([[0.0, -0.27], [0.1, -0.27], [0.125, -0.25], [0.145, -0.18], [0.155, -0.05], [0.155, 0.12], [0.145, 0.22], [0.135, 0.25], [0.0, 0.25]], 'hull', [0, 0, 0], null, 28);
    b.torus(0.112, 0.016, 'steel', [0, -0.265, 0], [Math.PI / 2, 0, 0], 24);
    b.cyl(0.098, 0.098, 0.012, 'dark', [0, -0.262, 0], null, 24);
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; b.box(0.006, 0.01, 0.09, 'steel', [Math.cos(a) * 0.05, -0.258, Math.sin(a) * 0.05], [0, -a, 0], 0, 1); }   // intake stator vanes
    for (const y of [-0.12, 0.04]) b.torus(0.156, 0.004, 'dark', [0, y, 0], [Math.PI / 2, 0, 0], 28);
    // heat shield, gimbal ring, the bell with its liner, the glowing core deep inside
    b.cyl(0.14, 0.142, 0.05, 'heat', [0, 0.27, 0], null, 24);
    b.torus(0.122, 0.018, 'steel', [0, 0.3, 0], [Math.PI / 2, 0, 0], 24);
    for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + Math.PI / 4; b.pipe(V(Math.cos(a) * 0.12, 0.26, Math.sin(a) * 0.12), V(Math.cos(a) * 0.09, 0.36, Math.sin(a) * 0.09), 0.008, 'steel', 6); }
    const bell = [[0.055, 0.3], [0.07, 0.34], [0.095, 0.4], [0.115, 0.46], [0.122, 0.48]];
    b.lathe(bell, 'nozzle', [0, 0, 0], null, 28);
    b.lathe(bell.map(([r, y]) => [r - 0.007, y]).reverse(), 'nozzle', [0, 0, 0], null, 28);
    b.torus(0.122, 0.006, 'heat', [0, 0.48, 0], [Math.PI / 2, 0, 0], 28);
    for (const y of [0.37, 0.43]) b.torus(0.104 + (y - 0.37) * 0.25, 0.004, 'heat', [0, y, 0], [Math.PI / 2, 0, 0], 24);
    b.cyl(0.07, 0.07, 0.01, 'jet', [0, 0.31, 0], null, 20);
    // an RCS quad on the pod's outer side
    b.push([sx * 0.15, 0.0, 0], [0, 0, 0]);
    b.box(0.04, 0.06, 0.06, 'gun', [sx * 0.01, 0, 0], null, 0.006, 1);
    for (const [dy, dz] of [[0.04, 0], [-0.04, 0], [0, 0.04], [0, -0.04]]) b.cyl(0.006, 0.011, 0.025, 'nozzle', [sx * 0.03, dy, dz], [dz ? Math.PI / 2 * Math.sign(dz) : 0, 0, dy ? 0 : 0], 8, true);
    b.pop();
    b.pop();
    // fin on the pod, a nav light at the tip of the outer ones
    b.box(0.016, 0.17, 0.22, 'plate', [P.x, P.y + sy * 0.15, P.z + 0.04], null, 0.004, 1);
    b.box(0.018, 0.02, 0.22, 'stripe', [P.x, P.y + sy * 0.235, P.z + 0.04], null, 0.003, 1);
    b.sphere(0.016, sx < 0 ? 'navR' : 'navG', [P.x + sx * 0.16, P.y, P.z - 0.1], 10);
  }

  // ---------------------------------------------------------------- fins, top gear, tail
  for (const sx of [-1, 1]) {
    // canted outward: the fin is stood up along the body, then leant over about the body's axis
    const sh = new THREE.Shape([new THREE.Vector2(-0.16, 0), new THREE.Vector2(0.16, 0), new THREE.Vector2(0.12, 0.22), new THREE.Vector2(0.0, 0.24)]);
    b.push([sx * 0.17, 0.3, 0.42], [0, 0, -sx * 0.32]);
    b.extrude(sh, 0.016, 'plate', [0, 0, 0], [0, Math.PI / 2, 0], 0.004, 4);
    b.box(0.022, 0.014, 0.2, 'red', [0, 0.225, -0.03], null, 0.003, 1);
    b.pop();
  }
  {
    const sh = new THREE.Shape([new THREE.Vector2(-0.12, 0), new THREE.Vector2(0.12, 0), new THREE.Vector2(0.06, -0.14), new THREE.Vector2(-0.04, -0.15)]);
    b.extrude(sh, 0.014, 'plate', [0, -0.27, 0.45], [0, Math.PI / 2, 0], 0.004, 4);
  }
  // radar blister, its ring; whip and blade antennas; the warning lamp in its cage
  b.add(new THREE.SphereGeometry(0.075, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 'plate2', [0, 0.3, -0.24]);
  b.torus(0.077, 0.008, 'steel', [0, 0.3, -0.24], [Math.PI / 2, 0, 0], 20);
  b.pipe(V(0.06, 0.29, 0.5), V(0.06, 0.66, 0.64), 0.006, 'steel', 6);
  b.sphere(0.012, 'rubber', [0.06, 0.66, 0.64], 8);
  b.box(0.008, 0.11, 0.07, 'gun', [-0.07, 0.35, 0.3], [-0.3, 0, 0], 0.002, 1);
  b.sphere(0.035, 'lamp', [0, 0.355, 0.2], 14);
  b.torus(0.042, 0.004, 'steel', [0, 0.355, 0.2], [Math.PI / 2, 0, 0], 12);
  for (const a of [0, Math.PI / 2]) b.torus(0.042, 0.004, 'steel', [0, 0.36, 0.2], [0, a, 0], 12, Math.PI);
  // tail: vent grille and a service port
  b.box(0.16, 0.1, 0.02, 'gun', [0, 0.02, 0.73], null, 0.008, 1);
  for (let k = 0; k < 5; k++) b.box(0.13, 0.008, 0.012, 'dark', [0, -0.018 + k * 0.019, 0.742], null, 0, 1);
  b.cyl(0.02, 0.02, 0.03, 'steel', [0.1, -0.06, 0.68], [Math.PI / 2, 0, 0], 10);
  return b.build(M, { castShadow: false });
}

/** the plain model (middle distance) */
export function droneMid(M) {
  const b = new Builder();
  const prof = [[0.05, 0.75], [0.22, 0.62], [0.33, 0.35], [0.36, 0.0], [0.33, -0.4], [0.24, -0.66], [0.12, -0.8]];
  b.push([0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 0.7]);
  b.lathe(prof, 'hull', [0, 0, 0], null, 8);
  b.pop();
  b.box(0.42, 0.06, 0.9, 'plate', [0, 0.25, 0.05], [0.04, 0, 0], 0.02);
  b.box(0.36, 0.05, 0.7, 'plate', [0, -0.24, 0.1], [-0.05, 0, 0], 0.02);
  b.box(0.08, 0.1, 0.8, 'dark', [0, 0.3, 0.1], null, 0.02);
  b.cyl(0.13, 0.15, 0.08, 'dark', [0, 0.02, -0.8], [Math.PI / 2, 0, 0], 12);
  b.sphere(0.075, 'eye', [0, 0.02, -0.84], 12, [1, 1, 0.6]);
  b.box(0.3, 0.03, 0.05, 'eye', [0, 0.1, -0.7], null, 0.01);
  b.box(0.14, 0.12, 0.34, 'dark', [0, -0.27, -0.42], null, 0.02);
  b.cyl(0.032, 0.032, 0.62, 'steel', [0, -0.28, -0.86], [Math.PI / 2, 0, 0], 10);
  b.cyl(0.05, 0.05, 0.1, 'dark', [0, -0.28, -1.17], [Math.PI / 2, 0, 0], 10);
  b.cyl(0.11, 0.11, 0.16, 'plate', [0, -0.3, -0.12], [0, 0, Math.PI / 2], 14);
  for (const [sx, sy] of POD) {
    const x = sx * 0.82, y = sy * 0.34;
    b.pipe([sx * 0.25, sy * 0.08, 0.15], [x, y, 0.28], 0.045, 'hull', 8);
    b.box(0.06, 0.04, 0.3, 'stripe', [(sx * 0.25 + x) / 2, (sy * 0.08 + y) / 2 + 0.04, 0.2], null, 0.005);
    b.cyl(0.13, 0.15, 0.5, 'hull', [x, y, 0.28], [Math.PI / 2, 0, 0], 12);
    b.cyl(0.11, 0.13, 0.06, 'dark', [x, y, 0.56], [Math.PI / 2, 0, 0], 12);
    b.cyl(0.085, 0.085, 0.02, 'jet', [x, y, 0.59], [Math.PI / 2, 0, 0], 12);
    b.box(0.02, 0.18, 0.2, 'plate', [x, y + sy * 0.15, 0.3], null, 0.005);
  }
  for (const sx of [-1, 1]) b.box(0.02, 0.22, 0.28, 'plate', [sx * 0.18, 0.36, 0.38], [0, 0, sx * 0.25], 0.005);
  b.pipe([0.06, 0.28, 0.5], [0.06, 0.62, 0.62], 0.008, 'steel', 6);
  b.sphere(0.04, 'lamp', [0, 0.36, 0.2], 8);
  return b.build(M, { castShadow: false });
}

/** a few hundred triangles: low quality, and far away */
export function droneLo(M) {
  const b = new Builder();
  b.push([0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 0.7]);
  b.lathe([[0.05, 0.75], [0.33, 0.35], [0.36, 0.0], [0.24, -0.66], [0.12, -0.8]], 'hull', [0, 0, 0], null, 8);
  b.pop();
  b.box(0.42, 0.06, 0.9, 'plate', [0, 0.25, 0.05], null, 0, 1);
  b.sphere(0.075, 'eye', [0, 0.02, -0.84], 8, [1, 1, 0.6]);
  b.box(0.13, 0.11, 0.32, 'dark', [0, -0.27, -0.42], null, 0, 1);
  b.cyl(0.034, 0.034, 0.62, 'dark', [0, -0.28, -0.86], [Math.PI / 2, 0, 0], 6);
  for (const [sx, sy] of POD) {
    const x = sx * 0.82, y = sy * 0.34;
    b.pipe([sx * 0.25, sy * 0.08, 0.15], [x, y, 0.28], 0.05, 'hull', 5);
    b.cyl(0.13, 0.15, 0.5, 'hull', [x, y, 0.28], [Math.PI / 2, 0, 0], 8);
    b.cyl(0.09, 0.09, 0.02, 'jet', [x, y, 0.54], [Math.PI / 2, 0, 0], 8);
  }
  b.sphere(0.04, 'lamp', [0, 0.34, 0.2], 6);
  return b.build(M, { castShadow: false });
}
