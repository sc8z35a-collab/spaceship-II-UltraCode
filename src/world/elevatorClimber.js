// Climber vehicles of the space elevator. Local frame: +y up the ribbon, the ribbon runs through
// the vehicle's axis with its width along x and its faces toward +-z.
//  - passenger climber "Hagoromo": a two-deck white cabin with a panoramic upper deck, drive
//    modules top and bottom whose roller pairs pinch the ribbon (they spin with the speed and part
//    when the climber is shifted across at a terminal), a laser-power receiver ring underneath that
//    glows while it is fed, four radiator fins that fold in at the berth, a sliding door, strobes,
//    nav lights, headlamps and the line livery;
//  - cargo climber: an open frame with four containers round the ribbon, the same drives.
// Every instance owns its light materials, so its windows, strobe and receiver run on their own.
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';

const R = 2.6;

function liveryTexture(kind, id) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 256);
  g.textBaseline = 'middle';
  // line stripe
  const stripe = id.startsWith('G') ? '#e8792a' : id.startsWith('S') ? '#3a8fd9' : '#8a5cc9';
  g.fillStyle = stripe; g.fillRect(0, 196, 1024, 20);
  g.fillStyle = '#c9a04c'; g.fillRect(0, 222, 1024, 6);
  g.fillStyle = '#1b2230';
  g.font = '600 112px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';
  g.textAlign = 'left';
  g.fillText('天の御柱', 24, 96);
  g.font = '300 54px "Helvetica Neue", Helvetica, Arial, sans-serif';
  g.fillStyle = '#2a3446';
  g.fillText(kind === 'C' ? 'MIHASHIRA CARGO' : 'MIHASHIRA LINE', 500, 70);
  g.font = '700 66px "Helvetica Neue", Helvetica, Arial, sans-serif';
  g.fillStyle = stripe;
  g.textAlign = 'right';
  g.fillText(id, 1000, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** one drive module (housing halves either side of the ribbon, motors, guide wheels) */
function driveModule(b, y) {
  for (const sz of [-1, 1]) {
    b.box(2.7, 1.9, 1.05, 'hullDark', [0, y, sz * 0.86], null, 0.12);
    b.box(2.2, 1.5, 0.08, 'metal', [0, y, sz * 1.4], null, 0.02);
    for (const sx of [-1, 1]) {
      b.cyl(0.33, 0.33, 0.72, 'metalDark', [sx * 0.86, y, sz * 1.72], [Math.PI / 2, 0, 0], 20);
      b.cyl(0.36, 0.36, 0.08, 'gold', [sx * 0.86, y, sz * 2.08], [Math.PI / 2, 0, 0], 20);
      for (let k = 0; k < 4; k++) b.box(0.06, 0.62, 0.62, 'metal', [sx * 0.86 + (k - 1.5) * 0.09, y, sz * 1.72], null, 0);
    }
  }
  // side plates tying the halves together around the ribbon slot
  for (const sx of [-1, 1]) b.box(0.18, 1.9, 2.75, 'hullDark', [sx * 1.36, y, 0], null, 0.05);
  // guide wheels at the ends of the slot
  for (const dy of [-1.02, 1.02]) for (const sx of [-1, 1]) b.cyl(0.11, 0.11, 0.5, 'steel', [sx * 0.95, y + dy, 0], [Math.PI / 2, 0, 0], 12);
}

function addRollers(g, y, M, list) {
  for (const sz of [-1, 1]) for (const dy of [-0.56, 0, 0.56]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 2.0, 22), M.steel);
    r.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.04, 0.07), M.hullOrange);
    hub.position.set(0.215, 0, 0);
    r.add(hub);
    r.position.set(0, y + dy, sz * 0.27);
    r.userData = { sz, y: y + dy };
    g.add(r);
    list.push(r);
  }
}

let PV = null;
/** photovoltaic receiver cells: dark blue squares on a silver grid */
function pvTexture() {
  if (PV) return PV;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#9aa6bb'; g.fillRect(0, 0, 512, 128);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) {
    const k = ((x * 7 + y * 3) % 5) / 5;
    g.fillStyle = `rgb(${14 + k * 8},${24 + k * 10},${58 + k * 22})`;
    g.fillRect(x * 32 + 2, y * 32 + 2, 28, 28);
    g.fillStyle = 'rgba(160,180,230,0.18)';
    g.fillRect(x * 32 + 2, y * 32 + 15, 28, 1);
  }
  PV = new THREE.CanvasTexture(c);
  PV.colorSpace = THREE.SRGBColorSpace;
  PV.wrapS = PV.wrapT = THREE.RepeatWrapping;
  PV.repeat.set(6, 2);
  PV.anisotropy = 8;
  return PV;
}

function lights(M) {
  const em = (c, k) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(...c), emissiveIntensity: k });
  return {
    clWin: new THREE.MeshStandardMaterial({ color: 0x0e1014, emissive: new THREE.Color(1.0, 0.82, 0.58), emissiveIntensity: 3.2, roughness: 0.18, metalness: 0.2 }),
    clStrobe: em([1, 1, 1], 0),
    clFlood: em([1, 0.95, 0.86], 6),
    clStatus: em([1, 0.6, 0.12], 0),
    clRecv: new THREE.MeshStandardMaterial({ color: 0xffffff, map: pvTexture(), roughness: 0.28, metalness: 0.45, emissive: new THREE.Color(0.35, 0.55, 1.0), emissiveMap: pvTexture(), emissiveIntensity: 0, side: THREE.DoubleSide }),
  };
}

export class ClimberModel {
  constructor(kind, M) {
    this.kind = kind;
    this.L = lights(M);
    const MM = Object.assign({}, M, this.L);
    this.livery = new THREE.MeshStandardMaterial({ map: null, transparent: true, roughness: 0.5, metalness: 0.0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    MM.livery = this.livery;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.rollers = [];
    this.fins = [];
    const b = new Builder();
    if (kind === 'C') this.buildCargo(b, MM); else this.buildPassenger(b, MM);
    const body = b.build(MM, { castShadow: false });
    this.group.add(body);
    for (const o of this.group.children) o.matrixAutoUpdate = true;
    this.group.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    this.spin = 0;
    this.id = '';
  }

  buildPassenger(b, M) {
    // hull: one lathe from the lower neck to the upper neck
    const prof = [[1.15, -3.95], [1.6, -3.7], [2.15, -3.35], [2.48, -2.95], [2.6, -2.55], [2.6, 2.55], [2.48, 2.95], [2.15, 3.35], [1.6, 3.7], [1.15, 3.95]];
    b.lathe(prof, 'whitePanel', [0, 0, 0], null, 56);
    // window bands: lower deck and the tall panoramic upper deck
    b.cyl(R + 0.006, R + 0.006, 1.1, 'hullDark', [0, -1.25, 0], null, 56, true);
    b.cyl(R + 0.006, R + 0.006, 1.6, 'hullDark', [0, 1.05, 0], null, 56, true);
    for (let k = 0; k < 24; k++) {
      const a = (k + 0.5) / 24 * Math.PI * 2;
      const off = (x) => Math.abs(Math.atan2(Math.sin(a - x), Math.cos(a - x)));
      if (off(Math.PI / 2) < 0.2) continue;                                        // the door
      if ([1, 3, 5, 7].some((q) => off(q * Math.PI / 4) < 0.14)) continue;        // fin pillars
      const c = Math.cos(a), s = Math.sin(a);
      b.box(0.5, 0.78, 0.08, 'clWin', [c * (R + 0.02), -1.25, s * (R + 0.02)], [0, -a + Math.PI / 2, 0], 0.08);
      b.box(0.56, 1.32, 0.08, 'clWin', [c * (R + 0.02), 1.05, s * (R + 0.02)], [0, -a + Math.PI / 2, 0], 0.1);
    }
    for (const y of [-2.58, 2.58]) b.torus(R - 0.02, 0.085, 'gold', [0, y, 0], [Math.PI / 2, 0, 0], 56);
    b.torus(R + 0.01, 0.05, 'metal', [0, -0.1, 0], [Math.PI / 2, 0, 0], 56);
    // livery between the decks on both flanks (+x / -x)
    for (const [t0, side] of [[-0.62, 1], [Math.PI - 0.62, -1]]) {
      const lg = new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.62, 24, 1, true, t0 + Math.PI / 2, 1.24);
      b.add(lg, 'livery', [0, -0.12, 0]);
      void side;
    }
    // panel seams, RCS quads at the equator, grab rails along the flanks
    for (const y of [-2.2, -0.62, 0.42, 2.12]) b.torus(R + 0.004, 0.016, 'metalDark', [0, y, 0], [Math.PI / 2, 0, 0], 56);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4 + 0.3;
      const c = Math.cos(a), s = Math.sin(a);
      b.box(0.34, 0.34, 0.26, 'metalDark', [c * (R + 0.1), -0.1, s * (R + 0.1)], [0, -a + Math.PI / 2, 0], 0.04);
      for (const [dy, dz] of [[0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]]) b.cyl(0.035, 0.06, 0.12, 'nozzle', [c * (R + 0.1) - s * dz, -0.1 + dy, s * (R + 0.1) + c * dz], dy ? [0, 0, dy > 0 ? 0 : Math.PI] : [Math.PI / 2, -a, 0], 8);
    }
    for (const sx of [-1, 1]) for (const y of [-2.0, 2.0]) b.pipe([sx * (R + 0.14), y, -0.5], [sx * (R + 0.14), y, 0.5], 0.025, 'hullOrange', 6);
    // antenna mast and a small dish on the top drive
    b.pipe([0.9, 6.3, -0.9], [0.9, 7.7, -0.9], 0.03, 'metal', 6);
    b.sphere(0.07, 'navR', [0.9, 7.75, -0.9], 8);
    b.lathe([[0.02, 0], [0.25, 0.05], [0.42, 0.14]], 'dish', [-0.9, 6.38, -0.9], [0.3, 0, 0], 20);
    // door frame on +z (the door leaf slides, see below)
    b.box(1.34, 2.08, 0.07, 'hullDark', [0, -1.0, R + 0.02], null, 0.04);
    b.box(0.08, 2.1, 0.12, 'hullOrange', [-0.7, -1.0, R + 0.04], null, 0.02);
    b.box(0.08, 2.1, 0.12, 'hullOrange', [0.7, -1.0, R + 0.04], null, 0.02);
    // necks and drive modules
    b.cyl(1.0, 1.15, 0.6, 'metalDark', [0, 4.15, 0], null, 32);
    b.cyl(1.15, 1.0, 0.6, 'metalDark', [0, -4.15, 0], null, 32);
    driveModule(b, 5.35);
    driveModule(b, -5.35);
    addRollers(this.group, 5.35, M, this.rollers);
    addRollers(this.group, -5.35, M, this.rollers);
    // laser-power receiver ring under the lower drive (concave, facing the ground)
    const ring = [];
    for (let i = 0; i <= 12; i++) { const r = 1.7 + 3.2 * i / 12; ring.push(new THREE.Vector2(r, -6.55 + 0.11 * Math.pow(i / 12 * 3.2, 2))); }
    for (let i = 12; i >= 0; i--) { const r = 1.7 + 3.2 * i / 12; ring.push(new THREE.Vector2(r, -6.45 + 0.11 * Math.pow(i / 12 * 3.2, 2))); }
    b.add(new THREE.LatheGeometry(ring, 64), 'clRecv');
    b.torus(4.9, 0.07, 'gold', [0, -6.5 + 0.11 * 10.24, 0], [Math.PI / 2, 0, 0], 64);
    b.torus(1.72, 0.09, 'metal', [0, -6.5, 0], [Math.PI / 2, 0, 0], 32);
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2 + 0.26;
      b.pipe([Math.cos(a) * 3.6, -6.1, Math.sin(a) * 3.6], [Math.cos(a) * 1.4, -4.3, Math.sin(a) * 1.4], 0.06, 'metal', 8);
    }
    // radiator fins (hinged at the shoulder, swing out in flight)
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      const piv = new THREE.Group();
      piv.position.set(Math.cos(a) * (R + 0.06), 2.75, Math.sin(a) * (R + 0.06));
      piv.rotation.y = -a;
      const fb = new Builder();
      fb.box(0.06, 4.6, 1.7, 'radiatorPanel', [0.08, -2.3, 0], null, 0.01);
      fb.box(0.1, 4.7, 0.08, 'metal', [0.08, -2.3, 0.85], null, 0);
      fb.box(0.1, 4.7, 0.08, 'metal', [0.08, -2.3, -0.85], null, 0);
      for (let j = 0; j < 9; j++) fb.box(0.09, 0.04, 1.7, 'metal', [0.08, -0.2 - j * 0.52, 0], null, 0);
      fb.cyl(0.09, 0.09, 1.8, 'gold', [0.02, 0, 0], [Math.PI / 2, 0, 0], 10);
      const fin = fb.build(M, { castShadow: false });
      fin.children.forEach((m) => { m.matrixAutoUpdate = true; });
      const holder = new THREE.Group();
      holder.add(fin);
      piv.add(holder);
      this.group.add(piv);
      this.fins.push(holder);
    }
    // the door leaf
    this.door = new THREE.Mesh(new THREE.BoxGeometry(1.18, 1.95, 0.06), M.whitePanel);
    this.door.position.set(0, -1.0, R + 0.06);
    const dw = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.02), this.L.clWin);
    dw.position.set(0, 0.42, 0.035);
    this.door.add(dw);
    this.group.add(this.door);
    this.lightsCommon(b, 6.45, -6.75);
  }

  buildCargo(b, M) {
    // open frame round the ribbon: four corner posts, ring frames, braces
    for (const [x, z] of [[-1.9, -1.9], [1.9, -1.9], [1.9, 1.9], [-1.9, 1.9]]) b.box(0.24, 8.2, 0.24, 'metal', [x, 0, z], null, 0.02);
    for (const y of [-3.35, 0, 3.35]) {
      b.box(4.05, 0.22, 0.22, 'metalDark', [0, y, 1.9], null, 0); b.box(4.05, 0.22, 0.22, 'metalDark', [0, y, -1.9], null, 0);
      b.box(0.22, 0.22, 4.05, 'metalDark', [1.9, y, 0], null, 0); b.box(0.22, 0.22, 4.05, 'metalDark', [-1.9, y, 0], null, 0);
    }
    // containers: front / back long ones, two short ones on the flanks
    const cont = (w, h, d, key, pos) => {
      b.box(w, h, d, key, pos, null, 0.04);
      const n = Math.floor(w / 0.3);
      const face = pos[2] > 0 ? 1 : pos[2] < 0 ? -1 : 0;
      if (face) for (let i = 0; i < n; i++) b.box(0.07, h * 0.94, 0.05, key, [pos[0] - w / 2 + (i + 0.5) * w / n, pos[1], pos[2] + face * (d / 2 + 0.02)], null, 0);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) b.box(0.2, 0.2, d + 0.04, 'metalDark', [pos[0] + sx * (w / 2 - 0.1), pos[1] + sy * (h / 2 - 0.1), pos[2]], null, 0.01);
    };
    cont(3.5, 6.1, 1.35, 'hullOrange', [0, 0, 1.12]);
    cont(3.5, 6.1, 1.35, 'whitePanel', [0, 0, -1.12]);
    cont(1.2, 6.1, 2.3, 'plasticB', [2.55, 0, 0]);
    cont(1.2, 6.1, 2.3, 'plasticR', [-2.55, 0, 0]);
    // livery panel on the front container
    b.add(new THREE.PlaneGeometry(3.2, 0.8), 'livery', [0, 2.2, 1.12 + 0.69]);
    b.cyl(0.95, 1.1, 0.5, 'metalDark', [0, 4.35, 0], null, 28);
    b.cyl(1.1, 0.95, 0.5, 'metalDark', [0, -4.35, 0], null, 28);
    driveModule(b, 5.4);
    driveModule(b, -5.4);
    addRollers(this.group, 5.4, M, this.rollers);
    addRollers(this.group, -5.4, M, this.rollers);
    const ring = [];
    for (let i = 0; i <= 10; i++) { const r = 1.6 + 2.2 * i / 10; ring.push(new THREE.Vector2(r, -6.55 + 0.1 * Math.pow(i / 10 * 2.2, 2))); }
    for (let i = 10; i >= 0; i--) { const r = 1.6 + 2.2 * i / 10; ring.push(new THREE.Vector2(r, -6.45 + 0.1 * Math.pow(i / 10 * 2.2, 2))); }
    b.add(new THREE.LatheGeometry(ring, 48), 'clRecv');
    b.torus(3.8, 0.06, 'gold', [0, -6.5 + 0.1 * 4.84, 0], [Math.PI / 2, 0, 0], 48);
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * Math.PI * 2 + 0.5;
      b.pipe([Math.cos(a) * 2.9, -6.15, Math.sin(a) * 2.9], [Math.cos(a) * 1.3, -4.4, Math.sin(a) * 1.3], 0.06, 'metal', 8);
    }
    // two big radiator fins on the flanks
    for (const sx of [-1, 1]) {
      const piv = new THREE.Group();
      piv.position.set(sx * 3.2, 3.2, 0);
      piv.rotation.y = sx > 0 ? 0 : Math.PI;
      const fb = new Builder();
      fb.box(0.06, 5.6, 2.2, 'radiatorPanel', [0.06, -2.8, 0], null, 0.01);
      for (let j = 0; j < 11; j++) fb.box(0.09, 0.04, 2.2, 'metal', [0.06, -0.25 - j * 0.52, 0], null, 0);
      fb.cyl(0.1, 0.1, 2.3, 'gold', [0.02, 0, 0], [Math.PI / 2, 0, 0], 10);
      const fin = fb.build(M, { castShadow: false });
      fin.children.forEach((m) => { m.matrixAutoUpdate = true; });
      const holder = new THREE.Group();
      holder.add(fin);
      piv.add(holder);
      this.group.add(piv);
      this.fins.push(holder);
    }
    this.door = null;
    this.lightsCommon(b, 6.5, -6.8);
  }

  lightsCommon(b, yTop, yBot) {
    // strobe on top, nav lights on the flanks, headlamps on both drive modules, a status ring
    b.sphere(0.2, 'clStrobe', [0, yTop, 0.9], 12);
    b.sphere(0.2, 'clStrobe', [0, yBot + 0.2, -0.9], 12);
    b.sphere(0.16, 'navR', [-1.5, 5.4, 0], 10);
    b.sphere(0.16, 'navG', [1.5, 5.4, 0], 10);
    b.sphere(0.16, 'navR', [-1.5, -5.4, 0], 10);
    b.sphere(0.16, 'navG', [1.5, -5.4, 0], 10);
    for (const y of [6.32, -6.32]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.cyl(0.17, 0.17, 0.08, 'clFlood', [sx * 0.62, y, sz * 0.95], null, 14);
      b.cyl(0.21, 0.21, 0.06, 'metalDark', [sx * 0.62, y - Math.sign(y) * 0.06, sz * 0.95], null, 14);
    }
    b.torus(1.2, 0.06, 'clStatus', [0, 4.45, 0], [Math.PI / 2, 0, 0], 32);
    b.torus(1.2, 0.06, 'clStatus', [0, -4.45, 0], [Math.PI / 2, 0, 0], 32);
  }

  setId(id) {
    if (this.id === id) return;
    this.id = id;
    if (this.livery.map) this.livery.map.dispose();
    this.livery.map = liveryTexture(this.kind, id);
    this.livery.needsUpdate = true;
  }

  /**
   * st: { v (m/s along +y), dt, grip (0 open .. 1 on the ribbon), fins (0 folded .. 1 out),
   *       door (0..1), lights (0..1), windows (0..1), recv (0..1), status ([r,g,b], k), strobe (0..1) }
   */
  animate(st) {
    this.spin += (st.v / 0.24) * st.dt;
    for (const r of this.rollers) {
      // the two rows turn opposite ways; parted rollers stand still
      r.rotation.x = this.spin * r.userData.sz * (st.grip > 0.5 ? 1 : 0);
      r.position.z = r.userData.sz * (0.27 + 0.22 * (1 - st.grip));
    }
    const fa = (this.kind === 'C' ? 1.05 : 1.15) * st.fins;
    for (const f of this.fins) f.rotation.z = fa;
    if (this.door) this.door.position.x = 1.15 * st.door;
    const L = this.L;
    L.clStrobe.emissiveIntensity = 14 * st.strobe;
    L.clFlood.emissiveIntensity = 7 * st.lights;
    L.clWin.emissiveIntensity = 3.2 * st.windows;
    L.clRecv.emissiveIntensity = 0.55 * st.recv;
    L.clStatus.emissive.setRGB(st.status[0], st.status[1], st.status[2]);
    L.clStatus.emissiveIntensity = st.statusK;
  }
}
