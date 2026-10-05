// The space elevator's fixed hardware:
//  - BerthRig: the climber berth at each end of a line (the terminal towers' upper and lower ends,
//    the anchor tower's top, the counterweight station's keel): a gantry round the berth, the
//    traverser that grips the climber and carries it across from one ribbon to the other, two
//    boarding bridges that run out to the climber's door, floodlights, rotating amber beacons
//    and lane status lamps. Local frame: origin at the berth (climber centre), +y along the
//    station's y, ribbons at x = -+LANE_X; side = +1 when the berth is above its deck.
//  - the anchor platform out on the equatorial Pacific (tower, power-beaming domes, port, ships);
//  - the counterweight: a captured rock with its station hanging under it.
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';
import { LANE_X } from './elevatorTraffic.js';

const DECK = 14.4;          // berth centre to deck surface
const RAIL_Y = 2.2;         // the traverser rails grip the climber's upper shoulder

function rigLights() {
  const em = (c, k) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(...c), emissiveIntensity: k });
  return { bnAmber: em([1, 0.55, 0.08], 0), bnRed: em([1, 0.08, 0.04], 0), bnGreen: em([0.1, 1, 0.3], 0), bnFlood: em([0.92, 0.96, 1], 6), bnSign: em([0.6, 0.85, 1], 1.4) };
}

export class BerthRig {
  constructor(M, side, label = '') {
    this.side = side;
    this.L = rigLights();
    const MM = Object.assign({}, M, this.L);
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    const b = new Builder();
    const yd = -side * DECK, yf = side * 12.5;
    const ym = (yd + yf) / 2, H = Math.abs(yf - yd);
    // gantry: four columns from the deck, a frame at the far end, X-braces on every face
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.box(0.8, H, 0.8, 'metal', [sx * 8.6, ym, sz * 4.6], null, 0.04);
      b.box(1.3, 0.6, 1.3, 'metalDark', [sx * 8.6, yd + side * 0.3, sz * 4.6], null, 0.05);
      b.box(0.1, H * 0.86, 0.1, 'bnSign', [sx * 8.6 + sx * 0.42, ym, sz * 4.6], null, 0);
    }
    for (const sz of [-1, 1]) b.box(17.2, 0.7, 0.7, 'metal', [0, yf, sz * 4.6], null, 0.04);
    for (const sx of [-1, 1]) b.box(0.7, 0.7, 9.2, 'metal', [sx * 8.6, yf, 0], null, 0.04);
    const brace = (a, c) => b.pipe(a, c, 0.11, 'metalDark', 8);
    for (const sz of [-1, 1]) for (const [y0, y1] of [[yd, 0], [0, yf]]) { brace([-8.6, y0, sz * 4.6], [0, y1, sz * 4.6]); brace([8.6, y0, sz * 4.6], [0, y1, sz * 4.6]); }
    for (const sx of [-1, 1]) { brace([sx * 8.6, yd, -4.6], [sx * 8.6, yf, 4.6]); brace([sx * 8.6, yd, 4.6], [sx * 8.6, yf, -4.6]); }
    // ribbon guides in the far frame: a roller block either side of each ribbon
    for (const lx of [-LANE_X, LANE_X]) {
      b.box(2.4, 0.5, 0.5, 'metalDark', [lx, yf, 0.62], null, 0.05);
      b.box(2.4, 0.5, 0.5, 'metalDark', [lx, yf, -0.62], null, 0.05);
      b.box(0.3, 0.5, 1.8, 'metal', [lx - 1.25, yf, 0], null, 0.03);
      b.box(0.3, 0.5, 1.8, 'metal', [lx + 1.25, yf, 0], null, 0.03);
      b.box(0.4, 2.4, 9.2, 'metal', [lx + (lx > 0 ? 1.45 : -1.45), yf - side * 0.6, 0], null, 0.04);
    }
    // traverser rails at the climber's shoulder
    for (const sz of [-1, 1]) {
      b.box(17.6, 0.55, 0.42, 'metalDark', [0, RAIL_Y, sz * 3.6], null, 0.04);
      b.box(17.2, 0.1, 0.06, 'plasticY', [0, RAIL_Y + 0.3, sz * 3.38], null, 0);
      for (const sx of [-1, 1]) b.box(0.9, 1.2, 1.2, 'metal', [sx * 8.6, RAIL_Y, sz * 4.1], null, 0.05);
    }
    // boarding towers (one per ribbon) on the +z side, up / down to the door level
    const yb = -1.0;
    const tA = yd, tB = yb + side * 1.4;
    for (const lx of [-LANE_X, LANE_X]) {
      const th = Math.abs(tB - tA);
      b.box(1.5, th, 1.5, 'hullDark', [lx, (tA + tB) / 2, 6.9], null, 0.1);
      for (const sx of [-1, 1]) b.box(0.1, th, 0.1, 'metal', [lx + sx * 0.76, (tA + tB) / 2, 6.14], null, 0);
      for (let k = 0; k < Math.floor(th / 2.4); k++) b.box(1.0, 0.24, 0.06, 'windowLit', [lx, tA + side * (1.4 + k * 2.4), 6.13], null, 0.02);
      b.box(2.3, 2.9, 2.3, 'hullDark', [lx, yb, 6.9], null, 0.12);
      b.box(1.7, 2.5, 0.1, 'metalDark', [lx, yb, 5.73], null, 0.02);
    }
    // floodlights at the far frame, aimed at the berth
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.push([sx * 7.6, yf - side * 0.8, sz * 3.9], [0, 0, 0]);
      b.box(0.9, 0.5, 0.9, 'hullDark', [0, 0, 0], null, 0.06);
      b.box(0.7, 0.06, 0.7, 'bnFlood', [0, -side * 0.27, 0], null, 0.02);
      b.pop();
    }
    // the beacons' housings and lenses (the lenses are this rig's own amber material)
    for (const sx of [-1, 1]) {
      b.cyl(0.32, 0.38, 0.25, 'metalDark', [sx * 8.6, yf + side * 0.48, -4.6], null, 16);
      b.sphere(0.32, 'bnAmber', [sx * 8.6, yf + side * 0.72, -4.6], 14);
    }
    // lane status lamps on the rail ends (green = clear, red = occupied / moving)
    for (const lx of [-LANE_X, LANE_X]) for (const sz of [-1, 1]) {
      b.sphere(0.18, 'bnGreen', [lx, RAIL_Y + 0.55, sz * 3.6], 10);
      b.sphere(0.18, 'bnRed', [lx, RAIL_Y - 0.55, sz * 3.6], 10);
    }
    // a lit sign on the gantry naming the line
    if (label) {
      const c = document.createElement('canvas');
      c.width = 1024; c.height = 160;
      const g = c.getContext('2d');
      g.fillStyle = '#0a0e14'; g.fillRect(0, 0, 1024, 160);
      g.fillStyle = '#cfe6ff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '500 76px "Hiragino Sans", "Noto Sans JP", sans-serif';
      g.fillText(label, 512, 84);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      MM.rigLabel = new THREE.MeshStandardMaterial({ color: 0x000000, map: t, emissiveMap: t, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.6 });
      for (const sz of [-1, 1]) {
        b.push([0, yf + side * 1.1, sz * 4.98], [0, sz > 0 ? 0 : Math.PI, 0]);
        b.add(new THREE.PlaneGeometry(9.6, 1.5), 'rigLabel');
        b.pop();
      }
    }
    const st = b.build(MM, { castShadow: false });
    this.group.add(st);
    // ---- moving parts: the traverser carriages with their grip pads, the boarding bridges
    this.carriages = [];
    for (const sz of [-1, 1]) {
      const cb = new Builder();
      cb.box(2.6, 1.3, 0.8, 'hullOrange', [0, 0, sz * 3.6], null, 0.08);
      cb.box(2.2, 0.16, 0.9, 'hazard', [0, 0.72, sz * 3.6], null, 0.02);
      for (const sx of [-1, 1]) cb.cyl(0.26, 0.26, 0.9, 'steel', [sx * 1.0, -0.65, sz * 3.6], [Math.PI / 2, 0, 0], 14);
      const car = cb.build(MM, { castShadow: false });
      const pb = new Builder();
      pb.box(0.36, 0.36, 0.9, 'metal', [0, 0, sz * 0.45], null, 0.03);
      pb.box(1.5, 1.0, 0.22, 'rubber', [0, 0, 0], null, 0.06);
      const pad = pb.build(MM, { castShadow: false });
      const pg = new THREE.Group(); pg.add(pad);
      car.add(pg);
      car.matrixAutoUpdate = true;
      car.position.y = RAIL_Y;
      pg.userData.sz = sz;
      this.group.add(car);
      this.carriages.push({ car, pad: pg, sz });
    }
    this.bridges = [];
    for (const lx of [-LANE_X, LANE_X]) {
      const bb = new Builder();
      bb.box(1.6, 2.3, 3.4, 'whitePanel', [0, 0, 1.7], null, 0.14);
      bb.box(1.66, 0.35, 2.4, 'windowLit', [0, 0.45, 1.9], null, 0.04);
      bb.box(1.9, 2.6, 0.3, 'rubber', [0, 0, 0.12], null, 0.1);
      bb.box(1.64, 0.12, 3.3, 'hullOrange', [0, -1.12, 1.7], null, 0.02);
      const br = bb.build(MM, { castShadow: false });
      br.matrixAutoUpdate = true;
      br.position.set(lx, yb, 6.0);
      this.group.add(br);
      this.bridges.push(br);
    }
    this.group.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    this.flash = 0;
  }

  /**
   * st: { traverse (carriage x from -1 .. 1 = lane), clamp, bridge [-lane, +lane] (0..1),
   *       occupied [bool, bool], moving, warn (0..1), power (0..1), t (s) }
   */
  animate(st) {
    for (const c of this.carriages) {
      c.car.position.x = st.carX * LANE_X;
      c.pad.position.z = c.sz * (3.15 - 0.42 * st.clamp);
    }
    for (let i = 0; i < 2; i++) this.bridges[i].position.z = 6.0 - 3.3 * st.bridge[i];
    const L = this.L, p = st.power;
    // rotating beacons: a sharp sweep twice a second while anything moves or a climber is near
    const sweep = Math.pow(Math.max(0, Math.cos(st.t * 7.5)), 10);
    L.bnAmber.emissiveIntensity = st.warn * (2 + 22 * sweep) * p;
    L.bnFlood.emissiveIntensity = 6.5 * p;
    L.bnSign.emissiveIntensity = 1.4 * p;
    const occ = st.occupied[0] || st.occupied[1] || st.moving;
    L.bnRed.emissiveIntensity = (occ ? 7 : 0.3) * p;
    L.bnGreen.emissiveIntensity = (occ ? 0.3 : 6) * p;
  }
}

// ------------------------------------------------------------------ anchor platform
export function anchorModel(M) {
  const b = new Builder();
  const MM = Object.assign({}, M);
  MM.deck = new THREE.MeshStandardMaterial({ color: 0x8c9094, roughness: 0.85, metalness: 0.1 });
  MM.beamGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.35, 1.0, 0.7), emissiveIntensity: 5 });
  // pontoons and the hexagonal deck (130 m to a corner)
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2 + Math.PI / 6;
    b.cyl(14, 16, 26, 'hullDark', [Math.cos(a) * 100, -4, Math.sin(a) * 100], null, 32);
    b.torus(15, 0.6, 'hullOrange', [Math.cos(a) * 100, 1.2, Math.sin(a) * 100], [Math.PI / 2, 0, 0], 32);
  }
  const hex = new THREE.Shape();
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; const x = Math.cos(a) * 130, z = Math.sin(a) * 130; if (k === 0) hex.moveTo(x, z); else hex.lineTo(x, z); }
  hex.closePath();
  const deck = new THREE.ExtrudeGeometry(hex, { depth: 7, bevelEnabled: false });
  deck.rotateX(-Math.PI / 2);
  b.add(deck, 'hullDark', [0, 9, 0]);
  const top = new THREE.ShapeGeometry(hex);
  top.rotateX(-Math.PI / 2);
  b.add(top, 'deck', [0, 16.05, 0]);
  // deck markings: a yellow ring road and the lane lines to the tower
  b.torus(58, 0.5, 'plasticY', [0, 16.1, 0], [Math.PI / 2, 0, 0], 96);
  b.torus(96, 0.4, 'plasticY', [0, 16.1, 0], [Math.PI / 2, 0, 0], 96);
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; b.box(36, 0.1, 0.6, 'plasticY', [Math.cos(a) * 77, 16.12, Math.sin(a) * 77], [0, -a, 0], 0); }
  // perimeter lights
  for (let k = 0; k < 60; k++) {
    const e = k / 10 | 0, f = (k % 10) / 10;
    const a0 = e / 6 * Math.PI * 2, a1 = (e + 1) / 6 * Math.PI * 2;
    const x = Math.cos(a0) * 130 * (1 - f) + Math.cos(a1) * 130 * f, z = Math.sin(a0) * 130 * (1 - f) + Math.sin(a1) * 130 * f;
    b.sphere(0.7, k % 5 ? 'windowLit' : 'navR', [x * 0.985, 16.8, z * 0.985], 8);
  }
  // the anchor tower (the two ribbons leave its top) with window spirals and red obstruction lights
  const prof = [[30, 16], [27, 24], [21, 40], [16, 70], [13, 110], [12, 140], [12.5, 146], [10.5, 148.4]];
  const rAt = (y) => {
    for (let i = 1; i < prof.length; i++) if (y <= prof[i][1]) { const [r0, y0] = prof[i - 1], [r1, y1] = prof[i]; return r0 + (r1 - r0) * (y - y0) / (y1 - y0); }
    return prof[prof.length - 1][0];
  };
  b.lathe(prof, 'whitePanel', [0, 0, 0], null, 64);
  for (const y of [24, 56, 92, 128]) b.torus(rAt(y) + 0.3, 0.5, 'hullDark', [0, y, 0], [Math.PI / 2, 0, 0], 64);
  for (let k = 0; k < 160; k++) {
    const y = 20 + k * 0.78;
    const r = rAt(y);
    const a = k * 0.62;
    b.box(1.6, 0.9, 0.2, 'windowLit', [Math.cos(a) * (r + 0.05), y, Math.sin(a) * (r + 0.05)], [0, -a + Math.PI / 2, 0], 0.05);
  }
  for (const y of [40, 80, 120, 146]) for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.4; const r = rAt(y) + 0.4; b.sphere(0.55, 'navR', [Math.cos(a) * r, y, Math.sin(a) * r], 10); }
  // the berth deck on top and the ribbon ports
  b.cyl(10.8, 10.8, 1.6, 'hullDark', [0, 149.2, 0], null, 48);
  b.torus(10.8, 0.18, 'gold', [0, 150, 0], [Math.PI / 2, 0, 0], 48);
  for (const lx of [-LANE_X, LANE_X]) b.torus(1.25, 0.22, 'hullOrange', [lx, 150.15, 0], [Math.PI / 2, 0, 0], 32);
  // power-beaming stations: three domes with an open slit and the laser aperture glowing in it
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 78, z = Math.sin(a) * 78;
    b.cyl(14, 15, 7, 'hullDark', [x, 19.5, z], null, 40);
    b.sphere(14, 'whitePanel', [x, 23, z], 40, [1, 0.85, 1]);
    b.box(4.2, 0.6, 26, 'metalDark', [x, 34.4, z], [0, -a, 0.0], 0.1);
    b.cyl(2.1, 2.1, 0.4, 'beamGlow', [x, 35.2, z], null, 24);
    b.torus(2.3, 0.2, 'gold', [x, 35.3, z], [Math.PI / 2, 0, 0], 24);
  }
  // port buildings, a helipad, two cranes and two moored ships
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * Math.PI * 2 + 0.95;
    const x = Math.cos(a) * 52, z = Math.sin(a) * 52;
    b.box(26, 13, 16, 'whitePanel', [x, 22.5, z], [0, -a, 0], 0.6);
    for (let j = 0; j < 3; j++) b.box(26.2, 0.9, 16.2, 'windowLit', [x, 19 + j * 3.6, z], [0, -a, 0], 0.1);
  }
  b.cyl(15, 15, 0.6, 'hullDark', [0, 16.4, 110], null, 48);
  b.torus(13, 0.35, 'plasticY', [0, 16.8, 110], [Math.PI / 2, 0, 0], 48);
  b.box(1.4, 0.12, 9, 'whitePanel', [-2.6, 16.8, 110], null, 0); b.box(1.4, 0.12, 9, 'whitePanel', [2.6, 16.8, 110], null, 0); b.box(4, 0.12, 1.2, 'whitePanel', [0, 16.8, 110], null, 0);
  for (const [x, z, a] of [[-104, -20, 0.3], [96, 52, -2.1]]) {
    b.box(3, 40, 3, 'plasticY', [x, 36, z], null, 0.1);
    b.box(46, 2.4, 2.4, 'plasticY', [x + Math.cos(a) * 16, 56, z + Math.sin(a) * 16], [0, -a, 0], 0.1);
    b.box(6, 5, 6, 'hullDark', [x, 54, z], null, 0.2);
  }
  for (const [x, z, a] of [[-150, 40, 1.1], [130, -110, -0.6]]) {
    b.push([x, 0, z], [0, a, 0]);
    b.box(22, 12, 120, 'hullOrange', [0, 2, 0], null, 1.5);
    b.box(20, 2, 110, 'hullDark', [0, 8.8, -2], null, 0.5);
    b.box(16, 14, 18, 'whitePanel', [0, 16, 44], null, 0.6);
    b.box(16.2, 1, 18.2, 'windowLit', [0, 19, 44], null, 0.1);
    for (let j = 0; j < 4; j++) b.box(10, 6, 14, j % 2 ? 'plasticB' : 'hullDark', [0, 12.6, -40 + j * 18], null, 0.2);
    b.pop();
  }
  const g = b.build(MM, { castShadow: false });
  g.userData.beamGlow = MM.beamGlow;
  return g;
}

// ------------------------------------------------------------------ counterweight
export function counterweightModel(M) {
  const b = new Builder();
  const MM = Object.assign({}, M);
  MM.rock = new THREE.MeshStandardMaterial({ color: 0x625b53, roughness: 0.96, metalness: 0.02, flatShading: true });
  const rock = new THREE.IcosahedronGeometry(160, 5);
  const p = rock.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 0.021) * Math.sin(v.y * 0.017 + 1.3) * Math.sin(v.z * 0.019 + 0.7);
    const crater = Math.max(0, Math.cos(v.x * 0.05 + 0.4) * Math.cos(v.z * 0.043 - 0.2)) ** 6 * -0.05;
    v.multiplyScalar(1 + 0.18 * n + 0.06 * Math.sin(v.x * 0.07 + v.z * 0.05) + 0.02 * Math.sin(v.y * 0.31 + v.x * 0.27) + crater);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  rock.computeVertexNormals();
  b.add(rock, 'rock');
  // the harness: a girder ring round the rock and four legs down to the station
  b.torus(178, 2.2, 'metal', [0, -40, 0], [Math.PI / 2, 0, 0], 96);
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * Math.PI * 2 + Math.PI / 4;
    b.pipe([Math.cos(a) * 176, -40, Math.sin(a) * 176], [Math.cos(a) * 14, -206, Math.sin(a) * 14], 1.4, 'metal', 10);
    b.box(10, 6, 10, 'hullDark', [Math.cos(a) * 176, -40, Math.sin(a) * 176], [0, -a, 0], 0.5);
  }
  // the station: a drum hanging below the rock, the ribbons enter its keel
  b.cyl(16, 16, 34, 'whitePanel', [0, -224.6, 0], null, 56);
  b.cyl(16.3, 16.3, 1.0, 'hullDark', [0, -214, 0], null, 56);
  b.cyl(16.3, 16.3, 1.0, 'hullDark', [0, -238, 0], null, 56);
  for (let k = 0; k < 40; k++) { const a = k / 40 * Math.PI * 2; for (const y of [-220, -228, -234]) b.box(1.6, 1.1, 0.2, 'windowLit', [Math.cos(a) * 16.05, y, Math.sin(a) * 16.05], [0, -a + Math.PI / 2, 0], 0.05); }
  b.cyl(16, 11, 4, 'hullDark', [0, -243.6, 0], null, 56);
  b.cyl(11, 11, 2, 'hullDark', [0, -246.6, 0], null, 48);
  b.torus(11, 0.18, 'gold', [0, -247.6, 0], [Math.PI / 2, 0, 0], 48);
  for (const lx of [-LANE_X, LANE_X]) b.torus(1.25, 0.22, 'hullOrange', [lx, -247.75, 0], [Math.PI / 2, 0, 0], 32);
  // solar wings and radiators on booms
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * Math.PI * 2;
    b.push([Math.cos(a) * 16, -226, Math.sin(a) * 16], [0, -a, 0]);
    b.box(60, 1.2, 1.2, 'metal', [30, 0, 0], null, 0.1);
    for (const sx of [0, 1]) b.box(26, 0.2, 14, k % 2 ? 'radiatorPanel' : 'solarPanel', [17 + sx * 28, 0, 0], null, 0.02);
    b.pop();
  }
  b.sphere(2.2, 'strobe', [0, 196, 0], 12);
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; b.sphere(0.8, k % 2 ? 'navR' : 'windowLit', [Math.cos(a) * 16.5, -208, Math.sin(a) * 16.5], 8); }
  return b.build(MM, { castShadow: false });
}
