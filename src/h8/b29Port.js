// B-29's dorsal docking port, where H8 rides: a round opening through the hull above the
// corridor, a heavy androgynous collar on the hull outside (latches, guide petals, seal), a sliding
// pressure hatch inside the hull, the well down through the corridor vault with its trim, LED ring
// and grab handles, a small control panel on the vault, and H8's power receptacle on the hull
// beside it. B-29 ship frame.
import * as THREE from 'three';
import { loft } from '../ship/sweep.js';
import { sectionPoint, sectionNormal, tForPoint } from '../ship/hullShape.js';
import { LAYER_NEAR } from '../core/layers.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const PORT = {
  z: 1.15,         // between the corridor frames at 0.55 and 1.75
  r: 0.47,         // the hole through the hull (clear bore of the well)
  yInner: 2.735,   // the inner pressure wall over the corridor
  yTop: 2.95,      // the outer skin
  yCollar: 3.55,   // top face of the port tunnel's flange (H8's mating ring sits here)
  hatchY: 2.84,    // the sliding hatch, between the two walls
  slide: 1.02,     // how far the hatch slides aft into its pocket
  // the control panel on the corridor wall (port side) under the well
  panel: V(-0.625, 1.62, 1.15),
  // H8's power receptacle on the hull, starboard of the mast
  receptacle: V(1.8, 2.72, 2.2),
};

/** height of the corridor vault at lateral position x (see architecture.js CORR) */
export function vaultY(x) {
  const CX = 0.66, VY = 2.05, VR = 0.48;
  const u = Math.min(1, Math.abs(x) / CX);
  return VY + VR * Math.sqrt(Math.max(0, 1 - u * u));
}

/** is a point (vault centroid) inside the port's hole (for cutting the vault) */
export function inPortHole(c, pad = 0.012) { return Math.hypot(c.x, c.z - PORT.z) < PORT.r + pad; }

function ringAt(r, yFn, n = 48, z = PORT.z) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * r, zz = z + Math.sin(a) * r;
    pts.push(V(x, typeof yFn === 'function' ? yFn(x, zz) : yFn, zz));
  }
  return pts;
}

/**
 * Outside: the collar standing on the hull round the opening, its latches and petals, and the
 * power receptacle. Called from buildExterior (B-29 materials).
 */
export function buildPortExterior(b) {
  const z = PORT.z, r = PORT.r, y0 = PORT.yTop - 0.02, y1 = PORT.yCollar;
  // the port tunnel standing on the hull: flared, bolted foot, a plain armoured barrel (H8's
  // guide petals close round it), and the mating flange on top with its seal land
  b.lathe([[r, y0 - 0.04], [r, y1 - 0.02], [r + 0.02, y1], [r + 0.15, y1], [r + 0.19, y1 - 0.02], [r + 0.19, y1 - 0.07], [r + 0.11, y1 - 0.09], [r + 0.11, y0 + 0.16], [r + 0.16, y0 + 0.1], [r + 0.36, y0 + 0.03], [r + 0.4, y0], [r + 0.42, y0 - 0.05]], 'hullDark', [0, 0, z], null, 64);
  b.torus(r + 0.08, 0.02, 'rubber', [0, y1 + 0.004, z], [Math.PI / 2, 0, 0], 64);
  b.torus(r + 0.165, 0.01, 'steel', [0, y1 - 0.004, z], [Math.PI / 2, 0, 0], 64);
  for (const y of [y0 + 0.24, y0 + 0.38]) b.torus(r + 0.115, 0.012, 'metal', [0, y, z], [Math.PI / 2, 0, 0], 64);
  // bolts round the foot, latch blocks under the flange (they close over H8's ring)
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; b.cyl(0.016, 0.018, 0.02, 'steel', [Math.cos(a) * (r + 0.3), y0 + 0.055, z + Math.sin(a) * (r + 0.3)], null, 6); }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + Math.PI / 12;
    const c = Math.cos(a), s = Math.sin(a);
    b.box(0.06, 0.1, 0.05, 'metal', [c * (r + 0.15), y1 - 0.13, z + s * (r + 0.15)], [0, -a, 0], 0.008);
    b.box(0.04, 0.03, 0.06, 'steel', [c * (r + 0.17), y1 - 0.07, z + s * (r + 0.17)], [0, -a, 0], 0.006);
  }
  // alignment pins on the flange, yellow index marks, a stencilled band on the barrel
  for (const a of [0.3, 0.3 + Math.PI]) b.cyl(0.018, 0.01, 0.07, 'steel', [Math.cos(a) * (r + 0.12), y1 + 0.03, z + Math.sin(a) * (r + 0.12)], null, 10);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    b.box(0.12, 0.012, 0.035, 'plasticY', [Math.cos(a) * (r + 0.32), y0 + 0.05, z + Math.sin(a) * (r + 0.32)], [0, -a, 0], 0.004);
  }
  b.cyl(r + 0.116, r + 0.116, 0.07, 'hullOrange', [0, y0 + 0.31, z], null, 64, true);
  // docking target lamps either side
  for (const s of [-1, 1]) {
    b.cyl(0.04, 0.05, 0.05, 'metalDark', [s * (r + 0.55), PORT.yTop + 0.02, z], null, 12);
    b.sphere(0.03, 'navWhite', [s * (r + 0.55), PORT.yTop + 0.06, z], 10);
  }
  // power receptacle: a low armoured housing on the hull, socket with six pins, a hinged cover
  const R = PORT.receptacle;
  const t = tForPoint(R.z, R.x, R.y, 0);
  const p = sectionPoint(R.z, t, 0), n = sectionNormal(R.z, t, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n);
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  b.push([p.x, p.y, p.z], [e.x, e.y, e.z]);
  b.box(0.5, 0.12, 0.62, 'hullDark', [0, 0.04, 0], null, 0.04);
  b.box(0.44, 0.02, 0.56, 'hazard', [0, 0.1, 0], null, 0.006);
  b.cyl(0.13, 0.15, 0.08, 'metalDark', [0, 0.14, 0], null, 28);
  b.cyl(0.095, 0.095, 0.02, 'black', [0, 0.18, 0], null, 28);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.cyl(0.012, 0.012, 0.04, 'copper', [Math.cos(a) * 0.055, 0.18, Math.sin(a) * 0.055], null, 8); }
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; b.cyl(0.012, 0.014, 0.018, 'steel', [Math.cos(a) * 0.2, 0.11, Math.sin(a) * 0.25], null, 6); }
  b.box(0.04, 0.03, 0.04, 'ledAmber', [0.19, 0.12, -0.24], null, 0.008);
  b.pop();
}

/** where the receptacle's socket face is (B-29 frame), and its outward normal */
export function receptacleSocket() {
  const R = PORT.receptacle;
  const t = tForPoint(R.z, R.x, R.y, 0);
  const p = sectionPoint(R.z, t, 0), n = sectionNormal(R.z, t, 0);
  return { p: p.addScaledVector(n, 0.2), n };
}

/**
 * Inside: the well from the corridor vault up to the inner wall, its trim, LED ring, grab handles
 * and the control panel. Called from buildCorridor (B-29 materials).
 */
export function buildPortWell(b) {
  const z = PORT.z, r = PORT.r;
  // lining: the lower edge follows the curved vault, the upper one meets the inner pressure wall
  const N = 56;
  const bottom = ringAt(r, (x) => vaultY(x) - 0.012, N);
  const mid = ringAt(r, (x) => (vaultY(x) + PORT.yInner) / 2, N);
  const top = ringAt(r, PORT.yInner + 0.01, N);
  b.add(loft([bottom, mid, top], { ring: true, caps: false, invert: true }), 'panel');
  // trim round the lower edge (rolled steel) and a thin LED ring just above it
  const trim = ringAt(r + 0.012, (x) => vaultY(x) - 0.006, N);
  b.tube(trim, 0.024, 'steel', { radial: 8, seg: 120, closed: true });
  const led = ringAt(r - 0.008, (x) => vaultY(x) + 0.05, N);
  b.tube(led, 0.006, 'ledStrip', { radial: 5, seg: 120, closed: true });
  // yellow-black band painted on the lining
  const band0 = ringAt(r - 0.002, (x) => vaultY(x) + 0.11, N), band1 = ringAt(r - 0.002, (x) => vaultY(x) + 0.16, N);
  b.add(loft([band0, band1], { ring: true, caps: false, invert: true }), 'hazard');
  // grab handles on the vault fore and aft of the hole
  for (const s of [-1, 1]) {
    const zc = z + s * (r + 0.13);
    const y = vaultY(0) - 0.05;
    b.pipe(V(-0.16, y, zc), V(0.16, y, zc), 0.016, 'handrail', 10);
    for (const x of [-0.16, 0.16]) b.pipe(V(x, y, zc), V(x, vaultY(x) + 0.01, zc), 0.012, 'handrail', 8);
  }
  // control panel on the corridor wall below the well: housing, face plate, a yellow arrow up
  const P = PORT.panel;
  b.box(0.05, 0.32, 0.22, 'panelDark', [P.x, P.y, P.z], null, 0.012);
  b.box(0.012, 0.28, 0.18, 'plasticK', [P.x + 0.028, P.y, P.z], null, 0.004);
  b.box(0.006, 0.05, 0.12, 'plasticY', [P.x + 0.035, P.y + 0.12, P.z], null, 0.002);
  for (const s of [-1, 1]) b.box(0.006, 0.06, 0.012, 'plasticY', [P.x + 0.035, P.y + 0.125, P.z + s * 0.025], [s * 0.7, 0, 0], 0.002);
}

/**
 * The sliding pressure hatch with its handwheel, latch dogs and viewport, the control panel's
 * button and lamp (runtime objects) and the kinematic collider that closes the well.
 */
export class DorsalHatch {
  constructor(M, phys) {
    this.group = new THREE.Group();
    this.group.name = 'dorsalHatch';
    const disc = new THREE.Group();
    const S = (geo, mat, p, r) => { const m = new THREE.Mesh(geo, mat); if (p) m.position.set(...p); if (r) m.rotation.set(...r); disc.add(m); return m; };
    S(new THREE.CylinderGeometry(PORT.r - 0.004, PORT.r - 0.004, 0.05, 48), M.hullDark);
    S(new THREE.TorusGeometry(PORT.r - 0.03, 0.016, 8, 48), M.steel, [0, -0.028, 0], [Math.PI / 2, 0, 0]);
    S(new THREE.CylinderGeometry(0.31, 0.31, 0.012, 40), M.metalDark, [0, -0.031, 0]);
    // handwheel on the corridor side
    S(new THREE.TorusGeometry(0.15, 0.013, 8, 32), M.steel, [0, -0.085, 0], [Math.PI / 2, 0, 0]);
    for (let k = 0; k < 3; k++) S(new THREE.CylinderGeometry(0.009, 0.009, 0.3, 8), M.steel, [0, -0.085, 0], [Math.PI / 2, (k / 3) * Math.PI, 0]).rotation.order = 'YXZ';
    S(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 16), M.metal, [0, -0.06, 0]);
    // latch dogs round the rim
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; S(new THREE.BoxGeometry(0.05, 0.03, 0.09), M.metal, [Math.cos(a) * (PORT.r - 0.08), -0.035, Math.sin(a) * (PORT.r - 0.08)], [0, -a, 0]); }
    // small viewport (dark glass) and a stencilled stripe
    S(new THREE.CylinderGeometry(0.06, 0.06, 0.056, 24), M.black, [0.2, 0, 0.12]);
    S(new THREE.BoxGeometry(0.5, 0.004, 0.05), M.plasticY, [0, -0.028, -0.3]);
    disc.position.set(0, PORT.hatchY, PORT.z);
    this.disc = disc;
    this.group.add(disc);
    // control panel button + status lamp (on the wall plate, facing into the corridor)
    const P = PORT.panel;
    this.button = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.018, 24), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: new THREE.Color(0.2, 0.8, 1.0), emissiveIntensity: 0.4, roughness: 0.4 }));
    this.button.position.set(P.x + 0.04, P.y - 0.02, P.z);
    this.button.rotation.set(0, 0, -Math.PI / 2);
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), new THREE.MeshStandardMaterial({ color: 0, emissive: new THREE.Color(1, 0.1, 0.05), emissiveIntensity: 2 }));
    this.lamp.position.set(P.x + 0.036, P.y + 0.05, P.z);
    this.group.add(this.button, this.lamp);
    this.group.traverse((o) => { o.layers.set(LAYER_NEAR); o.castShadow = false; });
    // the disc is seen from outside too (looking down into the collar)
    disc.traverse((o) => o.layers.enable(2));
    // collider closing the well while shut
    this.col = phys.addKinematicBox(PORT.r * 0.92, 0.04, PORT.r * 0.92, V(0, PORT.hatchY, PORT.z));
    this.open = 0;
    this.target = 0;
    this.moving = 0;
  }

  get sealed() { return this.open < 0.01 && this.target < 0.5; }

  /** cross-section open to the air (m^2) */
  get flowArea() { return this.open > 0.015 ? Math.PI * PORT.r * PORT.r * Math.min(1, this.open * 1.3) : 0; }

  setTarget(v) { this.target = v; }

  update(dt, lampState) {
    const prev = this.open;
    // the hatch first unlocks (a short pause), then slides at ~0.5 m/s
    const sp = dt / 2.1;
    if (this.target > this.open) this.open = Math.min(this.target, this.open + sp);
    else if (this.target < this.open) this.open = Math.max(this.target, this.open - sp);
    this.moving = Math.abs(this.open - prev) > 1e-6 ? 1 : 0;
    const e = this.open * this.open * (3 - 2 * this.open);
    this.disc.position.z = PORT.z + e * PORT.slide;
    this.disc.rotation.y = e * 0.4;
    const p = this.disc.position;
    this.col.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
    // lamp: green = vessel docked and pressurised, amber = moving, red = vacuum beyond
    const L = this.lamp.material;
    if (lampState === 'ok') L.emissive.setRGB(0.15, 1.0, 0.3);
    else if (lampState === 'busy') L.emissive.setRGB(1.0, 0.6, 0.1);
    else L.emissive.setRGB(1.0, 0.08, 0.04);
    L.emissiveIntensity = lampState === 'busy' ? 1.5 + Math.sin(performance.now() / 120) * 1.2 : 2.2;
    this.button.material.emissiveIntensity = 0.3 + 0.25 * Math.sin(performance.now() / 600);
  }
}
