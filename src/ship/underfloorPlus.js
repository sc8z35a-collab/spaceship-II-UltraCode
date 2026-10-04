// Third layer of the pipe deck: it should feel like the engine room of a submarine, not an empty
// crawlspace. Deep web frames that split it into bays, quilted insulation under the deck, dense
// outboard pipe racks with clamps, and a working station in every free bay (hydraulics, water
// processing, fire suppression, spares, CO2 cartridges, a comms rack, a valve manifold, a degasser,
// a little workshop), each with its own caged lamp. The central walkway and the lift / hatch
// openings stay clear.
import * as THREE from 'three';
import { sectionPoint, halfWidthAt, heightRangeAt, DECK_Y, LOWER_Y } from './hullShape.js';
import { INSET, LIFT, ENG_HATCH } from './interior.js';
import { valveWheel, gauge, switchPanel, cableBundle, sticker } from './props.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UNDER = DECK_Y - 0.17;            // underside of the deck beams
const bottom = (z, x) => heightRangeAt(z, x, INSET)[0];
const wallX = (z, y, side, off = 0) => side * (halfWidthAt(z, y, INSET) - off);

/** deep web frame in the plane z, hugging the hull below the deck (a T-section with a flange) */
function webFrame(b, z, depth = 0.2, R) {
  const N = 72, outer = [], inner = [];
  for (let i = 0; i <= N; i++) {
    const t = -Math.PI / 2 - Math.PI * 0.62 + (i / N) * Math.PI * 1.24;
    const p = sectionPoint(z, t, INSET - 0.004), q = sectionPoint(z, t, INSET + depth);
    if (p.y > UNDER - 0.01) continue;
    outer.push(p); inner.push(q);
  }
  const pos = [];
  const quad = (A, B, C, D) => pos.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z, A.x, A.y, A.z, C.x, C.y, C.z, D.x, D.y, D.z);
  const th = 0.025;
  for (let i = 0; i < outer.length - 1; i++) {
    const o0 = outer[i], o1 = outer[i + 1], i0 = inner[i], i1 = inner[i + 1];
    for (const s of [-1, 1]) {
      const a = o0.clone().setZ(z + s * th), bq = o1.clone().setZ(z + s * th), c = i1.clone().setZ(z + s * th), d = i0.clone().setZ(z + s * th);
      if (s > 0) quad(a, bq, c, d); else quad(a, d, c, bq);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  b.add(g, 'frame');
  // flange along the inner edge + bolt rows
  const fl = inner.map((p) => p.clone());
  for (let i = 0; i < fl.length - 1; i++) {
    const a = fl[i], c = fl[i + 1];
    const mid = a.clone().lerp(c, 0.5), len = a.distanceTo(c);
    const ang = Math.atan2(c.y - a.y, c.x - a.x);
    b.box(len + 0.004, 0.012, 0.12, 'frame', mid.toArray(), [0, 0, ang], 0.003);
  }
  for (let i = 2; i < outer.length - 2; i += 3) {
    const p = outer[i].clone().lerp(inner[i], 0.5);
    b.cyl(0.012, 0.012, 0.07, 'steel', [p.x, p.y, z], [Math.PI / 2, 0, 0], 6);
  }
  // lightening holes: dark discs on both faces
  for (let i = 4; i < outer.length - 4; i += 7) {
    const p = outer[i].clone().lerp(inner[i], 0.5);
    for (const s of [-1, 1]) b.cyl(0.055, 0.055, 0.004, 'black', [p.x, p.y, z + s * (th + 0.002)], [Math.PI / 2, 0, 0], 16);
  }
  const lp = sectionPoint(z, -Math.PI / 2 + 0.75, INSET + depth * 0.5);
  sticker(b, [lp.x, lp.y, z - th - 0.004], [0, Math.PI, 0], 0.12, 0.05);
  void R;
}

/** pipes along z hugging the hull at fixed heights, with saddle clamps on struts */
function pipeRack(b, side, z0, z1, ys, keys, radii) {
  const strutEvery = 0.9;
  const xs = ys.map((y) => (z) => wallX(z, y, side, 0.11 + radii[0]));
  ys.forEach((y, k) => {
    const pts = [];
    for (let z = z0; z <= z1 + 1e-6; z += (z1 - z0) / Math.max(2, Math.ceil((z1 - z0) / 0.6))) pts.push(V(xs[k](z), y, z));
    b.tube(pts, radii[k], keys[k], { radial: 8 });
    // elbows up into the deck at both ends
    for (const [ze, dir] of [[z0, -1], [z1, 1]]) {
      const x = xs[k](ze);
      b.tube([V(x, y, ze), V(x, y, ze + dir * 0.06), V(x, y + 0.08, ze + dir * 0.1), V(x, UNDER + 0.05, ze + dir * 0.1)], radii[k], keys[k], { radial: 8 });
    }
    // colour ID bands
    for (let z = z0 + 0.45; z < z1 - 0.2; z += 1.8) b.cyl(radii[k] * 1.08, radii[k] * 1.08, 0.04, 'plasticW', [xs[k](z), y, z], [Math.PI / 2, 0, 0], 12, true);
  });
  for (let z = z0 + 0.3; z < z1 - 0.1; z += strutEvery) {
    // strut channel following the curved hull from the deck down past the lowest pipe
    const yTop = UNDER, yBot = Math.min(...ys) - 0.06;
    b.pipe(V(wallX(z, yTop, side, 0.03), yTop, z), V(wallX(z, yBot, side, 0.03), yBot, z), 0.02, 'metalDark', 4);
    ys.forEach((y, k) => {
      const x = xs[k](z), xw = wallX(z, y - radii[k] - 0.01, side, 0.03);
      b.box(Math.abs(xw - x) + 0.01, 0.018, 0.04, 'metalDark', [(xw + x) / 2, y - radii[k] - 0.01, z], null, 0.003);
      b.torus(radii[k] + 0.006, 0.006, 'steel', [x, y, z], [0, 0, 0], 12, Math.PI);
    });
  }
}

/** caged bulkhead lamp facing `n` (unit vector into the bay) */
function cagedLamp(b, L, p, n, color = 0xffc68a, intensity = 1.6, red = false) {
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n);
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  b.push(p.toArray(), [e.x, e.y, e.z]);
  b.cyl(0.05, 0.055, 0.03, 'metalDark', [0, 0.015, 0], null, 12);
  b.cyl(0.035, 0.04, 0.05, red ? 'lampRed' : 'lampWarm', [0, 0.05, 0], null, 12);
  for (let k = 0; k < 4; k++) b.box(0.005, 0.06, 0.005, 'metalDark', [Math.cos(k * Math.PI / 2) * 0.045, 0.055, Math.sin(k * Math.PI / 2) * 0.045], null, 0);
  b.torus(0.045, 0.004, 'metalDark', [0, 0.085, 0], [Math.PI / 2, 0, 0], 12);
  b.pop();
  L.lamps.push({ pos: p.clone().addScaledVector(n, 0.25), color: red ? 0xff3020 : color, intensity, room: 'under', range: 4.5 });
}

export function buildUnderfloorPlus(b, L, R) {
  // ---------------------------------------------------------------- structure
  for (const z of [-3.0, 0.6]) webFrame(b, z, 0.2, R);

  // quilted insulation under the deck between the transverse beams (not over the openings)
  const holes = [
    [LIFT.x0 - 0.08, LIFT.x1 + 0.08, LIFT.z0 - 0.08, LIFT.z1 + 0.08],
    [ENG_HATCH.x0 - 0.08, ENG_HATCH.x1 + 0.08, ENG_HATCH.z0 - 0.08, ENG_HATCH.z1 + 0.08],
    [-0.5, 0.5, -6.65, -5.15], [-0.5, 0.5, 0.55, 2.05], [-0.5, 0.5, 3.55, 4.65],
  ];
  const clear = (x0, x1, z0, z1) => !holes.some(([a, c, d, e]) => x1 > a && x0 < c && z1 > d && z0 < e);
  for (let z = -10.8; z < 9.2; z += 1.2) {
    const za = z + 0.06, zb = z + 1.14;
    for (const [x0, x1] of [[-2.7, -1.6], [-1.6, -0.5], [-0.5, 0.5], [0.5, 1.6], [1.6, 2.7]]) {
      const zc = (za + zb) / 2;
      const hw = Math.min(halfWidthAt(za, UNDER, INSET), halfWidthAt(zb, UNDER, INSET)) - 0.06;
      const xa = Math.max(x0, -hw) + 0.03, xb = Math.min(x1, hw) - 0.03;
      if (xb - xa < 0.25) continue;
      if (!clear(xa, xb, za, zb)) continue;
      b.box(xb - xa, 0.025, zb - za - 0.04, 'wallPad', [(xa + xb) / 2, DECK_Y - 0.075, zc], null, 0.01);
    }
  }

  // ---------------------------------------------------------------- outboard pipe racks
  pipeRack(b, -1, -7.6, 4.2, [-0.42, -0.56, -0.7, -0.84], ['pipeYellow', 'pipeGreen', 'pipeWhite', 'pipeBlue'], [0.022, 0.026, 0.03, 0.022]);
  pipeRack(b, 1, -7.6, -5.45, [-0.36, -0.86], ['pipeGreen', 'pipeWhite'], [0.024, 0.028]);
  pipeRack(b, 1, -2.25, 4.2, [-0.36, -0.86, -1.0], ['pipeGreen', 'pipeWhite', 'pipeYellow'], [0.024, 0.028, 0.02]);

  // ---------------------------------------------------------------- stations
  // hydraulic power unit (starboard, aft of the algae panels)
  {
    const z = 5.1, x = 1.75, yb = bottom(z, x) + 0.02;
    b.box(0.5, 0.06, 0.8, 'metalDark', [x, yb + 0.03, z], null, 0.01, 2, true);
    b.box(0.36, 0.34, 0.5, 'panelDark', [x + 0.05, yb + 0.23, z - 0.1], null, 0.03, 2, true);       // reservoir
    b.cyl(0.09, 0.09, 0.3, 'pipeOrange', [x - 0.12, yb + 0.16, z + 0.28], [0, 0, Math.PI / 2], 16);  // motor
    b.cyl(0.07, 0.07, 0.14, 'metalDark', [x + 0.08, yb + 0.16, z + 0.28], [0, 0, Math.PI / 2], 14);  // pump
    for (const dz of [-0.28, 0.08]) { b.sphere(0.1, 'steel', [x + 0.05, yb + 0.52, z + dz], 16); b.cyl(0.02, 0.02, 0.08, 'steel', [x + 0.05, yb + 0.42, z + dz], null, 8); }
    gauge(b, [x - 0.135, yb + 0.3, z - 0.2], [0, -Math.PI / 2, 0], 0.035);
    gauge(b, [x - 0.135, yb + 0.3, z - 0.02], [0, -Math.PI / 2, 0], 0.035);
    b.tube([V(x + 0.05, yb + 0.6, z - 0.28), V(x - 0.1, -0.35, z - 0.3), V(x - 0.35, UNDER + 0.02, z - 0.35)], 0.016, 'black', { radial: 6 });
    b.tube([V(x + 0.05, yb + 0.6, z + 0.08), V(x - 0.05, -0.33, z + 0.2), V(x - 0.3, UNDER + 0.02, z + 0.3)], 0.016, 'black', { radial: 6 });
    sticker(b, [x - 0.135, yb + 0.15, z - 0.1], [0, -Math.PI / 2, 0], 0.14, 0.05);
    cagedLamp(b, L, V(x - 0.2, UNDER - 0.01, z), V(0, -1, 0));
  }
  // water processor: three canisters and a manifold (starboard, around the filters)
  {
    const z0 = -1.45;
    for (let k = 0; k < 3; k++) {
      const z = z0 + k * 0.32, x = 1.9, yb = bottom(z, x) + 0.04;
      b.cyl(0.11, 0.11, 0.62, 'plasticW', [x, yb + 0.31, z], null, 18);
      b.cyl(0.115, 0.115, 0.04, 'steel', [x, yb + 0.64, z], null, 18);
      b.cyl(0.115, 0.115, 0.04, 'steel', [x, yb + 0.02, z], null, 18);
      b.cyl(0.112, 0.112, 0.05, k === 1 ? 'pipeBlue' : 'pipeGreen', [x, yb + 0.45, z], null, 18, true);
      b.pipe([x, yb + 0.66, z], [x, -0.42, z], 0.018, 'pipeBlue', 8);
      b.colCyl(0.12, 0.66, [x, yb + 0.33, z]);
    }
    b.tube([V(1.9, -0.42, z0 - 0.15), V(1.9, -0.42, z0 + 0.8)], 0.024, 'pipeBlue', { radial: 8 });
    for (let k = 0; k < 3; k++) valveWheel(b, [1.76, -0.42, z0 + k * 0.32 + 0.16], [0, -Math.PI / 2, 0], 0.045, 'pipeBlue');
    gauge(b, [1.78, -0.6, z0 + 0.32], [0, -Math.PI / 2, 0], 0.04);
    cagedLamp(b, L, V(1.55, UNDER - 0.01, z0 + 0.32), V(0, -1, 0), 0xcfe8ff, 1.3);
  }
  // fire suppression bottles (port, between the N2 tank and the reaction wheel)
  {
    for (let k = 0; k < 4; k++) {
      const z = 0.8 + k * 0.2, x = -1.95, yb = bottom(z, x) + 0.03;
      b.cyl(0.085, 0.085, 0.62, 'plasticR', [x, yb + 0.31, z], null, 16);
      b.sphere(0.085, 'plasticR', [x, yb + 0.62, z], 16, [1, 0.55, 1]);
      b.cyl(0.025, 0.03, 0.06, 'steel', [x, yb + 0.7, z], null, 10);
      b.box(0.04, 0.03, 0.02, 'metalDark', [x + 0.03, yb + 0.74, z], null, 0.005);
      b.add(new THREE.PlaneGeometry(0.1, 0.12), 'labels', [x + 0.086, yb + 0.35, z], [0, Math.PI / 2, 0]);
      b.colCyl(0.09, 0.7, [x, yb + 0.35, z]);
    }
    b.box(0.04, 0.05, 0.85, 'metalDark', [-1.85, bottom(1.1, -1.85) + 0.45, 1.1], null, 0.006);   // retaining band
    b.tube([V(-1.95, bottom(0.8, -1.95) + 0.76, 0.8), V(-1.95, bottom(1.4, -1.95) + 0.78, 1.4), V(-1.75, -0.3, 1.45), V(-1.6, UNDER + 0.03, 1.45)], 0.016, 'pipeRed', { radial: 8 });
    cagedLamp(b, L, V(-1.45, UNDER - 0.01, 1.1), V(0, -1, 0), 0xff3020, 0.9, true);
  }
  // spare parts crates, strapped down (port)
  {
    const z = 2.15, x = -1.75, yb = bottom(z, x) + 0.02;
    b.box(0.42, 0.3, 0.5, 'plasticK', [x, yb + 0.15, z], null, 0.03, 2, true);
    b.box(0.36, 0.22, 0.36, 'panelDark', [x + 0.02, yb + 0.41, z + 0.04], null, 0.03, 2, true);
    b.box(0.2, 0.16, 0.24, 'plasticY', [x + 0.05, yb + 0.6, z - 0.05], null, 0.02);
    for (const dz of [-0.12, 0.12]) b.box(0.46, 0.008, 0.035, 'fabricBlue', [x, yb + 0.31, z + dz], null, 0.002);
    for (const dz of [-0.15, 0.15]) b.box(0.012, 0.62, 0.03, 'fabricBlue', [x + 0.215, yb + 0.31, z + dz], null, 0.002);
    sticker(b, [x + 0.212, yb + 0.15, z], [0, Math.PI / 2, 0], 0.12, 0.07);
  }
  // CO2 cartridge rack (port, forward of the propellant tank)
  {
    const z0 = 4.25, x = -1.85;
    b.box(0.3, 0.04, 0.72, 'metalDark', [x, bottom(4.6, x) + 0.06, 4.6], null, 0.006);
    b.box(0.3, 0.04, 0.72, 'metalDark', [x, bottom(4.6, x) + 0.42, 4.6], null, 0.006);
    for (let k = 0; k < 6; k++) {
      const z = z0 + 0.05 + k * 0.11, yb = bottom(4.6, x) + 0.08;
      b.cyl(0.04, 0.04, 0.32, k % 3 === 2 ? 'steel' : 'plasticB', [x, yb + 0.17, z], null, 12);
      b.cyl(0.015, 0.02, 0.04, 'steel', [x, yb + 0.35, z], null, 8);
    }
    b.colBox(0.3, 0.45, 0.75, [x, bottom(4.6, x) + 0.25, 4.6]);
  }
  // little workshop nook (port, aft)
  {
    const z = 7.2, x = -1.25, yb = bottom(z, x);
    const top = Math.max(yb + 0.42, -0.95);
    b.box(0.5, 0.04, 1.1, 'wood', [x, top, z], null, 0.008, 2, true);
    b.box(0.04, top - yb, 0.04, 'metalDark', [x + 0.2, (top + yb) / 2, z - 0.5], null, 0.004);
    b.box(0.04, top - yb, 0.04, 'metalDark', [x + 0.2, (top + yb) / 2, z + 0.5], null, 0.004);
    b.box(0.18, 0.1, 0.12, 'plasticR', [x - 0.05, top + 0.07, z - 0.3], null, 0.02);
    b.box(0.25, 0.012, 0.18, 'paper', [x + 0.03, top + 0.026, z + 0.1], [0, 0.2, 0], 0.002);
    b.cyl(0.02, 0.02, 0.18, 'plasticY', [x + 0.08, top + 0.03, z + 0.35], [0, 0, Math.PI / 2], 8);
    switchPanel(b, R, [x - 0.2, top + 0.2, z - 0.1], [0, Math.PI / 2, 0], 3, 2, 0.05);
    cagedLamp(b, L, V(x + 0.05, UNDER - 0.01, z), V(0, -1, 0), 0xffe1b0, 1.4);
  }
  // comms rack (port, forward)
  {
    const z = -6.6, x = -1.7, yb = bottom(z, x) + 0.02;
    b.box(0.4, 0.62, 0.55, 'metalDark', [x, yb + 0.31, z], null, 0.02, 2, true);
    for (let k = 0; k < 5; k++) {
      b.box(0.01, 0.08, 0.48, 'plasticK', [x + 0.205, yb + 0.1 + k * 0.105, z], null, 0.004);
      for (let j = 0; j < 6; j++) b.box(0.006, 0.01, 0.012, (k + j) % 3 ? 'ledGreen' : 'ledCyan', [x + 0.212, yb + 0.12 + k * 0.105, z - 0.2 + j * 0.03], null, 0);
    }
    cableBundle(b, [[x, yb + 0.62, z - 0.15], [x + 0.1, -0.5, z - 0.2], [x + 0.3, UNDER + 0.02, z - 0.4]], 4, 0.02);
    cagedLamp(b, L, V(x + 0.35, UNDER - 0.01, z), V(0, -1, 0), 0x9fd8ff, 1.0);
  }
  // valve manifold (starboard, forward)
  {
    const z = -6.75, x = 1.95;
    const yb = bottom(z, x) + 0.05;
    b.pipe([x, yb, z - 0.2], [x, -0.3, z - 0.2], 0.035, 'pipeOrange', 10);
    b.pipe([x, yb, z + 0.2], [x, -0.3, z + 0.2], 0.035, 'pipeBlue', 10);
    for (let k = 0; k < 3; k++) {
      const y = yb + 0.2 + k * 0.2;
      b.pipe([x, y, z - 0.2], [x, y, z + 0.2], 0.022, 'steel', 8);
      b.cyl(0.04, 0.04, 0.08, 'metalDark', [x, y, z], [Math.PI / 2, 0, 0], 12);
      b.pipe([x, y, z], [x - 0.1, y, z], 0.008, 'steel', 6);
      valveWheel(b, [x - 0.1, y, z], [0, -Math.PI / 2, 0], 0.05, k === 1 ? 'pipeYellow' : 'pipeRed');
    }
    gauge(b, [x - 0.04, yb + 0.75, z - 0.2], [0, -Math.PI / 2, 0], 0.035);
    sticker(b, [x - 0.04, yb + 0.1, z], [0, -Math.PI / 2, 0], 0.12, 0.05);
    cagedLamp(b, L, V(x - 0.35, UNDER - 0.01, z), V(0, -1, 0), 0xffc68a, 1.2);
  }
  // coolant degasser drum (starboard, aft)
  {
    const z = 7.9, x = 1.35, y = -0.78;
    b.add(new THREE.CapsuleGeometry(0.2, 0.7, 6, 18), 'steel', [x, y, z], [Math.PI / 2, 0, 0]);
    for (const dz of [-0.25, 0.25]) b.box(0.48, 0.05, 0.06, 'metalDark', [x, y - 0.22, z + dz], null, 0.006);
    b.cyl(0.06, 0.06, 0.012, 'glassProp', [x - 0.2, y, z], [0, 0, Math.PI / 2], 16);       // sight glass
    b.torus(0.062, 0.01, 'steel', [x - 0.205, y, z], [0, Math.PI / 2, 0], 16);
    b.pipe([x, y + 0.2, z - 0.25], [x, UNDER + 0.02, z - 0.25], 0.025, 'pipeOrange', 10);
    b.pipe([x, y + 0.2, z + 0.25], [x, UNDER + 0.02, z + 0.25], 0.025, 'pipeOrange', 10);
    b.colCyl(0.21, 1.1, [x, y, z], [Math.PI / 2, 0, 0]);
    cagedLamp(b, L, V(x - 0.4, UNDER - 0.01, z + 0.5), V(0, -1, 0), 0xffb070, 1.0);
  }

  // ---------------------------------------------------------------- walkway dressing
  // deck markings and bay numbers on the walkway, amber running lights under the deck edge
  for (let k = 0; k < 6; k++) {
    const z = -6.0 + k * 2.4;
    if (z > ENG_HATCH.z0 - 0.4 && z < ENG_HATCH.z1 + 0.4) continue;
    b.add(new THREE.PlaneGeometry(0.3, 0.12), 'labels', [0, LOWER_Y + 0.006, z], [-Math.PI / 2, 0, 0]);
  }
  for (const x of [-0.56, 0.56]) for (let z = -8.0; z < 8.6; z += 1.2) {
    if (z > LIFT.z0 - 0.2 && z < LIFT.z1 + 0.2 && x > 0) continue;
    b.box(0.03, 0.012, 0.08, 'ledAmber', [x, UNDER - 0.02, z], null, 0);
  }
  // emergency red lamps at both ends of the walkway
  cagedLamp(b, L, V(0.3, UNDER - 0.01, -8.3), V(0, -1, 0), 0xff3020, 0.7, true);
  cagedLamp(b, L, V(-0.3, UNDER - 0.01, 8.8), V(0, -1, 0), 0xff3020, 0.7, true);
}
