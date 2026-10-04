// Equipment stations of the pipe layer, so the crawl under the deck is a sequence of places
// instead of one long tube: water recycler (glowing columns + UV lamps), electrical distribution,
// air handler, reaction-wheel housing with a window, battery bank, algae bioreactor, propellant
// tank. Bolted flanges, ID bands, catenary cable bundles and hazard-striped walkway edges.
import * as THREE from 'three';
import { LOWER_Y } from './hullShape.js';
import { cableBundle, switchPanel, gauge, valveWheel, sticker } from './props.js';
import { loft } from './sweep.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildUnderfloorDetail(b, L, R) {
  L.spots.under = L.spots.under || {};
  const U = L.spots.under;

  // ---------------------------------------------------------- water recycler (starboard, fwd)
  {
    const zs = [-8.05, -7.62, -7.19], x = 1.86, y0 = -1.56, h = 0.52;
    b.box(0.34, 0.06, 1.32, 'metalDark', [x, y0 - 0.03, -7.62], null, 0.02, 2, true);
    U.recycler = [];
    for (const z of zs) {
      b.cyl(0.098, 0.098, 0.045, 'steel', [x, y0 + 0.022, z], null, 20);
      b.cyl(0.098, 0.098, 0.045, 'steel', [x, y0 + h - 0.022, z], null, 20);
      b.cyl(0.087, 0.087, h - 0.04, 'glassProp', [x, y0 + h / 2, z], null, 24, true);
      b.cyl(0.074, 0.074, h - 0.1, 'fluidBlue', [x, y0 + h / 2 - 0.01, z], null, 18);
      b.box(0.012, h - 0.12, 0.012, 'uvLamp', [x - 0.115, y0 + h / 2, z], null, 0);
      b.pipe([x, y0 + h, z], [x, y0 + h + 0.08, z], 0.018, 'pipeBlue', 8);
      U.recycler.push(V(x, y0 + 0.08, z));
    }
    // header pipe across the column tops and a branch over the walkway to the water main
    b.tube([[x, y0 + h + 0.08, -8.2], [x, y0 + h + 0.08, -7.0]], 0.022, 'pipeBlue', { radial: 8 });
    b.tube([[x, y0 + h + 0.08, -7.0], [1.55, -0.78, -6.8], [0.4, -0.36, -6.75], [-0.6, -0.3, -6.75], [-0.78, -0.32, -6.85]], 0.02, 'pipeBlue', { radial: 8 });
    gauge(b, [x - 0.17, y0 + 0.32, -7.62], [0, -Math.PI / 2, 0], 0.04);
    sticker(b, [x - 0.1, y0 + 0.05, -6.98], [0, -Math.PI / 2, 0], 0.1, 0.06);
    L.lamps.push({ pos: V(1.55, -1.1, -7.62), color: 0x5fc8ff, intensity: 1.5, room: 'under' });
  }

  // ---------------------------------------------------------- electrical distribution (port, fwd)
  {
    const x = -1.55, y = -1.27, z = -7.55;
    b.box(0.45, 0.55, 1.2, 'panel', [x, y, z], null, 0.06, 3, true);
    for (const zz of [-7.95, -7.55, -7.15]) switchPanel(b, R, [x + 0.232, y + 0.02, zz], [0, Math.PI / 2, 0], 4, 3, 0.05);
    b.box(0.02, 0.06, 1.0, 'hazard', [x + 0.232, y - 0.2, z], null, 0.004);
    cableBundle(b, [[x + 0.05, y + 0.27, z - 0.4], [x + 0.2, -0.55, z - 0.5], [x + 0.6, -0.22, z - 0.3], [x + 0.9, -0.22, z + 0.6]], 6, 0.03);
    cableBundle(b, [[x - 0.05, y + 0.27, z + 0.4], [x + 0.1, -0.6, z + 0.6], [x + 0.25, -0.2, z + 1.1]], 4, 0.025);
    L.lamps.push({ pos: V(-1.15, -0.9, -7.55), color: 0xcfeaff, intensity: 0.9, room: 'under' });
  }

  // ---------------------------------------------------------- air handling unit (starboard, mid)
  {
    const x = 1.05, y = -1.36, z = -2.2;
    b.box(0.6, 0.4, 1.3, 'panel', [x, y, z], null, 0.07, 3, true);
    b.torus(0.15, 0.022, 'steel', [x - 0.3, y, z - 0.25], [0, Math.PI / 2, 0], 24);
    b.torus(0.15, 0.022, 'steel', [x - 0.3, y, z + 0.25], [0, Math.PI / 2, 0], 24);
    for (const dz of [-0.25, 0.25]) for (let k = 0; k < 4; k++) b.box(0.006, 0.27, 0.008, 'metalDark', [x - 0.305, y, z + dz + (k - 1.5) * 0.06], null, 0);
    U.ahuFans = [V(x - 0.27, y, z - 0.25), V(x - 0.27, y, z + 0.25)];
    // flexible duct (bellows) up to the main air duct
    const pts = [V(x, y + 0.2, z), V(x - 0.05, -0.85, z + 0.05), V(0.8, -0.55, z + 0.1), V(0.75, -0.42, z + 0.1)];
    const curve = new THREE.CatmullRomCurve3(pts);
    b.add(new THREE.TubeGeometry(curve, 30, 0.085, 12), 'insul');
    for (let i = 1; i < 12; i++) { const p = curve.getPointAt(i / 12), t = curve.getTangentAt(i / 12); const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), t); const e = new THREE.Euler().setFromQuaternion(q); b.torus(0.088, 0.008, 'metalDark', p.toArray(), [e.x, e.y, e.z], 14); }
    sticker(b, [x - 0.302, y + 0.12, z + 0.55], [0, -Math.PI / 2, 0], 0.12, 0.07);
    L.lamps.push({ pos: V(0.6, -0.95, -2.2), color: 0xf0f4ff, intensity: 0.8, room: 'under' });
  }

  // ---------------------------------------------------------- reaction wheel housing (port, mid)
  {
    const x = -1.5, y = -1.3, z = 1.45, r = 0.3, len = 0.24;
    // drum walls (open) + back plate; the walkway side is a window onto the spinning wheel
    b.cyl(r, r, len, 'metalDark', [x, y, z], [0, 0, Math.PI / 2], 36, true);
    const ringAt = (xx) => { const pts = []; for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2; pts.push(V(xx, y + Math.cos(a) * (r - 0.004), z + Math.sin(a) * (r - 0.004))); } return pts; };
    b.add(loft([ringAt(x - len / 2), ringAt(x + len / 2)], { ring: true, caps: false, invert: true }), 'panelDark');   // inside liner
    b.cyl(r, r, 0.02, 'metalDark', [x - len / 2, y, z], [0, 0, Math.PI / 2], 36);
    b.torus(r - 0.005, 0.024, 'steel', [x + len / 2, y, z], [0, Math.PI / 2, 0], 36);
    b.torus(r - 0.005, 0.02, 'steel', [x - len / 2, y, z], [0, Math.PI / 2, 0], 36);
    b.add(new THREE.CircleGeometry(r - 0.02, 36), 'glassProp', [x + len / 2 + 0.004, y, z], [0, Math.PI / 2, 0]);
    b.torus(r - 0.05, 0.006, 'ledCyan', [x - len / 2 + 0.03, y, z], [0, Math.PI / 2, 0], 36);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; b.cyl(0.012, 0.012, 0.02, 'steel', [x + len / 2 + 0.01, y + Math.cos(a) * (r + 0.005), z + Math.sin(a) * (r + 0.005)], [0, 0, Math.PI / 2], 8); }
    for (const s of [-1, 1]) b.box(0.3, 0.06, 0.08, 'metalDark', [x - 0.05, y - r + 0.02, z + s * 0.2], null, 0.01);
    b.colCyl(r + 0.02, len + 0.04, [x, y, z], [0, 0, Math.PI / 2]);
    U.wheel = V(x, y, z);
    sticker(b, [x + len / 2 + 0.01, y + r + 0.06, z], [0, Math.PI / 2, 0], 0.14, 0.06);
  }

  // ---------------------------------------------------------- battery bank (port, aft-mid)
  {
    const x = -1.52, y = -1.32, z0 = 2.55, z1 = 4.05;
    b.box(0.52, 0.06, z1 - z0, 'metalDark', [x, y - 0.24, (z0 + z1) / 2], null, 0.02, 2, true);
    b.box(0.04, 0.5, z1 - z0, 'metalDark', [x - 0.25, y, (z0 + z1) / 2], null, 0.01);
    for (let i = 0; i < 7; i++) for (let j = 0; j < 2; j++) {
      const z = z0 + 0.12 + i * 0.205, xx = x - 0.11 + j * 0.22;
      b.box(0.19, 0.3, 0.18, j ? 'plasticK' : 'panelDark', [xx, y - 0.06, z], null, 0.025, 2);
      b.cyl(0.016, 0.016, 0.03, 'copper', [xx - 0.04, y + 0.105, z], null, 10);
      b.cyl(0.016, 0.016, 0.03, 'steel', [xx + 0.04, y + 0.105, z], null, 10);
      b.box(0.02, 0.012, 0.012, R() > 0.25 ? 'ledGreen' : 'ledAmber', [xx + 0.096, y + 0.05, z], null, 0);
    }
    for (const xx of [x - 0.15, x + 0.07]) b.box(0.03, 0.012, z1 - z0 - 0.1, 'copper', [xx, y + 0.125, (z0 + z1) / 2], null, 0.003);
    cableBundle(b, [[x + 0.1, y + 0.13, z1 - 0.1], [x + 0.35, -0.7, z1 + 0.1], [x + 0.6, -0.25, z1 + 0.3], [0.2, -0.22, z1 + 0.6]], 3, 0.02);
    b.add(new THREE.PlaneGeometry(0.16, 0.05), 'labels', [x + 0.26, y + 0.12, z0 + 0.3], [0, Math.PI / 2, 0]);
    U.battery = V(x, y, (z0 + z1) / 2);
    L.lamps.push({ pos: V(-1.05, -0.85, 3.3), color: 0xffd28a, intensity: 0.8, room: 'under' });
  }

  // ---------------------------------------------------------- algae bioreactor (starboard, aft-mid)
  {
    const x = 1.74, z0 = 2.8, z1 = 4.45;
    b.box(0.04, 0.62, z1 - z0 + 0.16, 'panel', [x + 0.12, -1.24, (z0 + z1) / 2], null, 0.015, 2, true);
    const pts = [];
    const rows = 5;
    for (let j = 0; j < rows; j++) {
      const y = -1.48 + j * 0.115;
      const a = j % 2 ? z1 : z0, c = j % 2 ? z0 : z1;
      pts.push(V(x, y, a), V(x, y, a + (c - a) * 0.5), V(x, y, c));
      if (j < rows - 1) pts.push(V(x, y + 0.057, c + (j % 2 ? -0.055 : 0.055)));
    }
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2), 260, 0.034, 10), 'fluidGreen');
    for (let k = 0; k <= 4; k++) b.box(0.05, 0.6, 0.02, 'steel', [x + 0.06, -1.25, z0 + (z1 - z0) * (k / 4)], null, 0.005);
    b.tube([[x, -1.02, z1 + 0.05], [x - 0.2, -0.85, z1 + 0.15], [1.32, -0.68, z1 + 0.2]], 0.016, 'pipeGreen', { radial: 8 });
    U.algae = [V(x, -1.48, z0 + 0.1), V(x, -1.25, z1 - 0.1)];
    L.lamps.push({ pos: V(1.4, -1.15, 3.6), color: 0x7dff8a, intensity: 1.3, room: 'under' });
  }

  // ---------------------------------------------------------- propellant tank (port, aft)
  {
    const x = -1.5, y = -1.2, z = 5.65, r = 0.23, len = 1.3;
    b.add(new THREE.CapsuleGeometry(r, len - 2 * r, 8, 20), 'steel', [x, y, z], [Math.PI / 2, 0, 0]);
    for (const dz of [-0.35, 0.35]) b.cyl(r + 0.006, r + 0.006, 0.07, 'hazard', [x, y, z + dz], [Math.PI / 2, 0, 0], 24, true);
    for (const dz of [-0.45, 0.45]) b.box(0.6, 0.05, 0.07, 'metalDark', [x, y - r - 0.02, z + dz], null, 0.01);
    b.pipe([x + 0.1, y + r - 0.02, z], [x + 0.1, y + r + 0.12, z], 0.02, 'pipeRed', 8);
    valveWheel(b, [x + 0.1, y + r + 0.13, z], [-Math.PI / 2, 0, 0], 0.05, 'pipeRed');
    b.add(new THREE.PlaneGeometry(0.18, 0.08), 'labels', [x + r + 0.005, y, z - 0.1], [0, Math.PI / 2, 0]);
    b.colCyl(r, len, [x, y, z], [Math.PI / 2, 0, 0]);
    L.lamps.push({ pos: V(-1.05, -0.92, 5.65), color: 0xff4a30, intensity: 0.9, room: 'under' });
  }

  // ---------------------------------------------------------- walkway: hazard edges + foot lights
  for (const x of [-0.43, 0.43]) {
    b.box(0.04, 0.006, 15.6, 'hazard', [x, LOWER_Y + 0.004, 0.3], null, 0);
    for (let z = -8.0; z < 8.2; z += 0.8) b.box(0.016, 0.01, 0.03, 'ledBlue', [x * 0.93, LOWER_Y + 0.012, z], null, 0);
  }
  // catenary cable bundles along the deck underside (sagging between hangers)
  for (const [x, n, key] of [[-0.25, 6, 0], [0.22, 5, 1], [-1.0, 4, 2]]) {
    const pts = [];
    for (let z = -8.3; z <= 6.0; z += 0.6) {
      const k = Math.round((z + 8.3) / 0.6);
      pts.push([x + (key === 2 ? Math.sin(z) * 0.03 : 0), -0.16 - (k % 2 ? 0.09 : 0.0), z]);
    }
    cableBundle(b, pts, n, 0.02);
    for (let z = -8.3; z <= 6.0; z += 1.2) b.box(0.12, 0.012, 0.02, 'steel', [x, -0.15, z], null, 0.003);
  }
}

/** bolted flange with an optional white ID band next to it */
export function boltedFlange(b, p, tg, r, band = false) {
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), tg);
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  b.cyl(r * 1.42, r * 1.42, 0.026, 'steel', p.toArray(), [e.x, e.y, e.z], 14);
  const side = new THREE.Vector3(1, 0, 0);
  if (Math.abs(side.dot(tg)) > 0.9) side.set(0, 1, 0);
  const u = side.sub(tg.clone().multiplyScalar(side.dot(tg))).normalize();
  const w = new THREE.Vector3().crossVectors(tg, u);
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2;
    const bp = p.clone().addScaledVector(u, Math.cos(a) * r * 1.22).addScaledVector(w, Math.sin(a) * r * 1.22);
    b.cyl(r * 0.13 + 0.002, r * 0.13 + 0.002, 0.05, 'metalDark', bp.toArray(), [e.x, e.y, e.z], 6);
  }
  if (band) {
    const bp = p.clone().addScaledVector(tg, 0.09);
    b.cyl(r * 1.06, r * 1.06, 0.05, 'plasticW', bp.toArray(), [e.x, e.y, e.z], 14, true);
  }
}
