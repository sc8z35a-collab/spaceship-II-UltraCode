// Second layer of furnishing: the lived-in clutter that makes each room dense — safety gear,
// storage racks, exercise bike, hydroponic grow rack, workbench, clothes, kitchen appliances,
// laundry, room name plates over the doors. Everything sits on a floor, a wall or a shelf.
import * as THREE from 'three';
import { rng } from './geom.js';
import { halfWidthAt, Z_COCKPIT_BULK, Z_ENG_BULK, OPENINGS, HULL } from './hullShape.js';
import { openingOutline } from './exterior.js';
import { INSET, DOORS } from './interior.js';
import { mug, plantPot, bookRow, sticker, valveWheel, switchPanel, gauge } from './props.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const wallX = (side, z, y, off = 0) => side * (halfWidthAt(z, y, INSET) - off);

// ------------------------------------------------------------------ small props
function extinguisher(b, pos, rotY = 0) {
  b.push(pos, [0, rotY, 0]);
  b.box(0.16, 0.05, 0.04, 'metalDark', [0, 0.42, -0.06], null, 0.01);        // wall bracket
  b.cyl(0.065, 0.065, 0.42, 'plasticR', [0, 0.24, 0], null, 16);
  b.sphere(0.065, 'plasticR', [0, 0.45, 0], 16, [1, 0.6, 1]);
  b.cyl(0.02, 0.025, 0.06, 'metalDark', [0, 0.51, 0], null, 10);
  b.box(0.1, 0.015, 0.03, 'black', [0.03, 0.55, 0], [0, 0, -0.3], 0.004);
  b.tube([V(0, 0.52, 0.02), V(0.06, 0.45, 0.06), V(0.07, 0.25, 0.07)], 0.009, 'rubber', { radial: 6, seg: 10 });
  b.box(0.08, 0.1, 0.004, 'labels', [0, 0.26, 0.066], null, 0);
  b.box(0.13, 0.015, 0.05, 'metalDark', [0, 0.12, -0.02], null, 0.005);
  b.pop();
}

function firstAid(b, pos, rotY = 0) {
  b.push(pos, [0, rotY, 0]);
  b.box(0.34, 0.26, 0.11, 'plasticW', [0, 0, 0], null, 0.02, 2);
  b.box(0.1, 0.03, 0.005, 'plasticR', [0, 0.02, 0.057], null, 0);
  b.box(0.03, 0.1, 0.005, 'plasticR', [0, 0.02, 0.057], null, 0);
  b.box(0.3, 0.012, 0.11, 'plasticK', [0, -0.09, 0.003], null, 0.003);
  b.box(0.06, 0.02, 0.02, 'steel', [0, -0.11, 0.06], null, 0.005);
  b.pop();
}

function binRack(b, R, x0, x1, z0, z1, y0, levels, levelH, bins = true) {
  // open shelving: four uprights, perforated shelves, coloured bins with labels
  const w = x1 - x0, d = z1 - z0, h = levels * levelH + 0.1;
  for (const x of [x0 + 0.02, x1 - 0.02]) for (const z of [z0 + 0.02, z1 - 0.02]) b.box(0.035, h, 0.035, 'metal', [x, y0 + h / 2, z], null, 0.006);
  for (let l = 0; l <= levels; l++) {
    const y = y0 + 0.05 + l * levelH;
    b.box(w, 0.018, d, 'metalDark', [(x0 + x1) / 2, y, (z0 + z1) / 2], null, 0.004);
    b.box(w, 0.04, 0.012, 'metal', [(x0 + x1) / 2, y + 0.02, z0 + 0.006], null, 0.003);
    if (!bins || l === levels) continue;
    let z = z0 + 0.04;
    while (z < z1 - 0.2) {
      const bw = 0.2 + R() * 0.16, bh = levelH * (0.45 + R() * 0.35);
      if (z + bw > z1 - 0.03) break;
      const key = ['plasticB', 'plasticY', 'plasticG', 'plasticW', 'plasticR', 'plasticK'][Math.floor(R() * 6)];
      b.box(w - 0.06, bh, bw, key, [(x0 + x1) / 2, y + 0.01 + bh / 2, z + bw / 2], null, 0.015, 2);
      b.box(0.004, 0.035, bw * 0.6, 'labels', [x1 - 0.028, y + 0.01 + bh * 0.6, z + bw / 2], [0, Math.PI / 2, 0], 0);
      z += bw + 0.03;
    }
  }
  b.colBox(w, h, d, [(x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2]);
}

function exerciseBike(b, x, z, rotY = 0) {
  b.push([x, 0, z], [0, rotY, 0]);
  b.box(0.46, 0.05, 0.9, 'metalDark', [0, 0.025, 0], null, 0.02);                // base plate
  b.box(0.12, 0.6, 0.12, 'metal', [0, 0.35, -0.25], [0.3, 0, 0], 0.03);           // front post
  b.box(0.1, 0.55, 0.1, 'metal', [0, 0.32, 0.25], [-0.25, 0, 0], 0.03);           // seat post
  b.cyl(0.2, 0.2, 0.05, 'steel', [0, 0.26, -0.05], [0, 0, Math.PI / 2], 24);      // flywheel
  b.torus(0.2, 0.02, 'plasticR', [0, 0.26, -0.05], [0, Math.PI / 2, 0], 24);
  b.box(0.26, 0.06, 0.3, 'fabric', [0, 0.62, 0.35], null, 0.03, 3);               // seat
  b.pipe([-0.22, 0.95, -0.42], [0.22, 0.95, -0.42], 0.018, 'rubber', 8);         // handlebar
  b.box(0.18, 0.12, 0.04, 'plasticK', [0, 0.92, -0.4], [-0.6, 0, 0], 0.01);       // display
  b.box(0.12, 0.06, 0.006, 'ledCyan', [0, 0.935, -0.38], [-0.6, 0, 0], 0);
  for (const s of [-1, 1]) {
    b.box(0.04, 0.02, 0.16, 'metalDark', [s * 0.1, 0.26 + s * 0.05, -0.05], [0.8, 0, 0], 0.005);   // cranks
    b.box(0.1, 0.02, 0.06, 'rubber', [s * 0.16, 0.26 + s * 0.11, -0.05 - s * 0.05], null, 0.008);  // pedals with straps
  }
  // bungee harness posts for zero-g
  for (const s of [-1, 1]) b.pipe([s * 0.2, 0.05, 0.42], [s * 0.2, 1.05, 0.5], 0.01, 'rubberHose', 6);
  b.pop();
  b.colBox(0.5, 1.0, 0.95, [x, 0.5, z], [0, rotY, 0]);
}

function growRack(b, R, x0, x1, z0, z1, levels = 3) {
  const w = x1 - x0, d = z1 - z0, lh = 0.48;
  for (const x of [x0 + 0.02, x1 - 0.02]) for (const z of [z0 + 0.02, z1 - 0.02]) b.box(0.03, levels * lh + 0.2, 0.03, 'steel', [x, (levels * lh + 0.2) / 2, z], null, 0.005);
  for (let l = 0; l < levels; l++) {
    const y = 0.28 + l * lh;
    // tray with water channel, plants, grow light above
    b.box(w, 0.06, d, 'plasticW', [(x0 + x1) / 2, y, (z0 + z1) / 2], null, 0.01);
    b.box(w - 0.06, 0.012, d - 0.06, 'fluidBlue', [(x0 + x1) / 2, y + 0.032, (z0 + z1) / 2], null, 0);
    for (let k = 0; k < 7; k++) {
      const zz = z0 + 0.08 + k * (d - 0.16) / 6, xx = (x0 + x1) / 2 + (R() - 0.5) * 0.08;
      const hh = 0.08 + R() * 0.14;
      b.cyl(0.035, 0.03, 0.05, 'plasticK', [xx, y + 0.05, zz], null, 10);
      for (let f = 0; f < 5; f++) { const a = f / 5 * Math.PI * 2 + R(); b.sphere(0.04 + R() * 0.025, R() > 0.4 ? 'plant' : 'plant2', [xx + Math.cos(a) * 0.04, y + 0.06 + hh * (0.5 + R() * 0.5), zz + Math.sin(a) * 0.04], 8, [1, 0.6, 1]); }
      if (l === 1 && k % 2 === 0) b.sphere(0.018, 'plasticR', [xx + 0.03, y + 0.09, zz + 0.02], 8);   // tomatoes
    }
    b.box(w - 0.04, 0.025, d - 0.04, 'metalDark', [(x0 + x1) / 2, y + lh - 0.08, (z0 + z1) / 2], null, 0.005);
    b.box(w - 0.1, 0.008, d - 0.1, 'uvLamp', [(x0 + x1) / 2, y + lh - 0.095, (z0 + z1) / 2], null, 0);
  }
  b.colBox(w, levels * lh + 0.2, d, [(x0 + x1) / 2, (levels * lh + 0.2) / 2, (z0 + z1) / 2]);
}

function beanbag(b, x, z, key = 'fabricBlue') {
  b.sphere(0.42, key, [x, 0.24, z], 20, [1, 0.58, 1]);
  b.sphere(0.3, key, [x + 0.05, 0.42, z + 0.12], 16, [1, 0.6, 0.85]);
  b.colCyl(0.4, 0.5, [x, 0.25, z]);
}

function floorLampShip(b, x, z) {
  b.cyl(0.14, 0.16, 0.025, 'metalDark', [x, 0.012, z], null, 20);
  b.tube([V(x, 0.02, z), V(x, 0.9, z), V(x + 0.05, 1.45, z + 0.02), V(x + 0.18, 1.55, z + 0.05)], 0.012, 'metal', { radial: 6, seg: 16 });
  b.cyl(0.07, 0.12, 0.14, 'fabric', [x + 0.2, 1.5, z + 0.05], null, 16, true);
  b.sphere(0.04, 'lampWarm', [x + 0.2, 1.47, z + 0.05], 10);
  b.colCyl(0.14, 1.5, [x, 0.75, z]);
}

function coffeeTable(b, R, x, z, r = 0.3) {
  b.cyl(r, r, 0.03, 'wood', [x, 0.42, z], null, 32);
  b.cyl(r * 0.85, r * 0.85, 0.02, 'metalDark', [x, 0.06, z], null, 24);
  for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2; b.pipe([x + Math.cos(a) * r * 0.7, 0.07, z + Math.sin(a) * r * 0.7], [x + Math.cos(a) * r * 0.75, 0.41, z + Math.sin(a) * r * 0.75], 0.012, 'metal', 6); }
  // on it: magazines, a mug, a bowl of fruit
  b.box(0.21, 0.008, 0.28, 'poster2', [x - 0.06, 0.44, z + 0.02], [0, 0.4, 0], 0);
  b.box(0.21, 0.008, 0.28, 'poster1', [x - 0.04, 0.448, z + 0.03], [0, 0.1, 0], 0);
  mug(b, [x + 0.12, 0.435, z - 0.1], 0.7, 'plasticY');
  b.cyl(0.09, 0.05, 0.05, 'ceramic', [x + 0.08, 0.46, z + 0.12], null, 16, true);
  for (let k = 0; k < 4; k++) b.sphere(0.028, ['plasticR', 'plasticY', 'plant2', 'plasticR'][k], [x + 0.08 + Math.cos(k * 1.7) * 0.035, 0.475 + (k === 3 ? 0.03 : 0), z + 0.12 + Math.sin(k * 1.7) * 0.035], 8);
  b.colCyl(r, 0.45, [x, 0.22, z]);
}

function hoodie(b, pos, rotY, key = 'fabricBlue') {
  b.push(pos, [0, rotY, 0]);
  b.cyl(0.01, 0.01, 0.06, 'steel', [0, 0, 0.03], [Math.PI / 2, 0, 0], 6);          // hook
  b.sphere(0.09, key, [0, -0.08, 0.05], 12, [1.1, 0.9, 0.6]);                       // hood
  b.box(0.34, 0.5, 0.08, key, [0, -0.38, 0.05], [0.05, 0, 0], 0.04, 3);              // body
  for (const s of [-1, 1]) b.box(0.08, 0.42, 0.07, key, [s * 0.19, -0.4, 0.06], [0, 0, s * 0.1], 0.03, 2);
  b.box(0.16, 0.08, 0.01, 'fabric', [0, -0.48, 0.095], null, 0.005);                // pocket
  b.pop();
}

function o2Bottles(b, x, z, n = 3) {
  for (let k = 0; k < n; k++) {
    const xx = x + k * 0.14;
    b.cyl(0.06, 0.06, 0.62, 'pipeGreen', [xx, 0.36, z], null, 16);
    b.sphere(0.06, 'pipeGreen', [xx, 0.67, z], 12, [1, 0.6, 1]);
    b.cyl(0.018, 0.02, 0.06, 'brass', [xx, 0.74, z], null, 8);
    b.box(0.05, 0.08, 0.003, 'labels', [xx, 0.45, z + 0.061], null, 0);
  }
  for (const y of [0.25, 0.55]) b.box(n * 0.14 + 0.04, 0.03, 0.03, 'plasticY', [x + (n - 1) * 0.07, y, z + 0.06], null, 0.006);
  b.box(n * 0.14 + 0.06, 0.04, 0.16, 'metalDark', [x + (n - 1) * 0.07, 0.02, z], null, 0.01);
  b.colBox(n * 0.14 + 0.06, 0.78, 0.16, [x + (n - 1) * 0.07, 0.39, z]);
}

function helmetShelf(b, x, y, z, rotY = 0) {
  b.push([x, y, z], [0, rotY, 0]);
  b.box(0.7, 0.025, 0.28, 'metalDark', [0, 0, 0], null, 0.006);
  for (const s of [-1, 1]) b.box(0.02, 0.14, 0.24, 'metal', [s * 0.33, -0.07, -0.01], null, 0.004);
  b.sphere(0.15, 'suit', [-0.16, 0.16, 0], 20);
  b.sphere(0.12, 'visorGold', [-0.16, 0.17, 0.05], 20, [1, 0.85, 0.75]);
  b.torus(0.12, 0.02, 'metal', [-0.16, 0.03, 0], [Math.PI / 2, 0, 0], 20);
  b.box(0.22, 0.12, 0.16, 'plasticK', [0.17, 0.07, 0], null, 0.02, 2);               // glove box
  b.box(0.08, 0.05, 0.003, 'labels', [0.17, 0.08, 0.081], null, 0);
  b.pop();
}

function toolChest(b, x, z, rotY = 0) {
  b.push([x, 0, z], [0, rotY, 0]);
  b.box(0.42, 0.78, 0.4, 'plasticR', [0, 0.43, 0], null, 0.02, 2);
  for (let k = 0; k < 5; k++) {
    b.box(0.4, 0.004, 0.36, 'black', [0, 0.16 + k * 0.13, 0.201], [Math.PI / 2, 0, 0], 0);
    b.box(0.2, 0.02, 0.02, 'steel', [0, 0.22 + k * 0.13, 0.215], null, 0.005);
  }
  for (const s of [-1, 1]) for (const t of [-1, 1]) b.cyl(0.03, 0.03, 0.03, 'rubber', [s * 0.17, 0.03, t * 0.15], [0, 0, Math.PI / 2], 10);
  b.box(0.36, 0.06, 0.3, 'metalDark', [0, 0.85, 0], null, 0.01);
  b.pop();
  b.colBox(0.42, 0.9, 0.4, [x, 0.45, z], [0, rotY, 0]);
}

function workbench(b, R, x0, x1, z0, z1) {
  const w = x1 - x0, d = z1 - z0;
  b.box(w, 0.05, d, 'wood', [(x0 + x1) / 2, 0.9, (z0 + z1) / 2], null, 0.01);
  b.box(w - 0.04, 0.82, d - 0.06, 'panelDark', [(x0 + x1) / 2, 0.43, (z0 + z1) / 2 - 0.02], null, 0.02, 2);
  for (let k = 0; k < 3; k++) b.box(0.004, 0.22, d - 0.12, 'black', [x1 - 0.02, 0.2 + k * 0.26, (z0 + z1) / 2], null, 0);
  // vise, parts tray, multimeter, soldering station, a lamp on an arm
  b.box(0.12, 0.1, 0.16, 'metalDark', [x1 - 0.1, 0.98, z0 + 0.15], null, 0.01);
  b.box(0.02, 0.06, 0.14, 'steel', [x1 - 0.17, 1.0, z0 + 0.15], null, 0.004);
  b.box(0.25, 0.04, 0.18, 'plasticY', [(x0 + x1) / 2, 0.945, z0 + 0.35], null, 0.008);
  for (let k = 0; k < 9; k++) b.cyl(0.012, 0.012, 0.012, k % 2 ? 'steel' : 'brass', [(x0 + x1) / 2 - 0.08 + (k % 3) * 0.08, 0.97, z0 + 0.3 + Math.floor(k / 3) * 0.05], null, 6);
  b.box(0.1, 0.035, 0.16, 'plasticK', [(x0 + x1) / 2 + 0.05, 0.945, z1 - 0.2], [0, 0.4, 0], 0.01);
  b.box(0.06, 0.004, 0.04, 'ledAmber', [(x0 + x1) / 2 + 0.05, 0.964, z1 - 0.23], [0, 0.4, 0], 0);
  b.tube([V(x0 + 0.05, 0.93, z1 - 0.08), V(x0 + 0.05, 1.3, z1 - 0.1), V(x0 + 0.25, 1.38, (z0 + z1) / 2), V(x0 + 0.3, 1.25, (z0 + z1) / 2)], 0.012, 'metal', { radial: 6, seg: 14 });
  b.cyl(0.04, 0.08, 0.08, 'metalDark', [x0 + 0.3, 1.21, (z0 + z1) / 2], null, 14);
  b.sphere(0.03, 'lampWarm', [x0 + 0.3, 1.17, (z0 + z1) / 2], 8);
  b.colBox(w, 0.95, d, [(x0 + x1) / 2, 0.47, (z0 + z1) / 2]);
}

function laundryBag(b, x, z) {
  b.cyl(0.17, 0.15, 0.48, 'fabric', [x, 0.24, z], null, 16);
  b.sphere(0.16, 'fabricBlue', [x, 0.5, z], 12, [1, 0.45, 1]);
  b.torus(0.17, 0.012, 'plasticK', [x, 0.47, z], [Math.PI / 2, 0, 0], 16);
  b.colCyl(0.17, 0.5, [x, 0.25, z]);
}

// ------------------------------------------------------------------ room name plates (over doors)
function roomSign(b, idx, pos, rotY) {
  const g = new THREE.PlaneGeometry(0.42, 0.0525);
  const uv = g.attributes.uv;
  const v0 = 1 - (idx + 1) / 8, v1 = 1 - idx / 8;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) > 0.5 ? v1 : v0);
  b.box(0.45, 0.075, 0.02, 'metalDark', pos, [0, rotY, 0], 0.006);
  const off = new THREE.Vector3(0, 0, 0.0105).applyEuler(new THREE.Euler(0, rotY, 0));
  b.add(g, 'roomSigns', [pos[0] + off.x, pos[1], pos[2] + off.z], [0, rotY, 0]);
}

// ------------------------------------------------------------------ per room
/**
 * Portholes read as heavy windows from inside: a broad bolted flange ring on the wall around the
 * deep reveal, a dark gasket and an ID plate (a bare dark ring with a dark disc looked like a ball)
 */
function windowBezels(b) {
  for (const o of OPENINGS) {
    if (o.kind !== 'win') continue;
    const small = o.halfW < 0.2;
    const n = 48, into = o.normal.clone().negate();
    // outline on the inner wall, `off` metres proud of it
    const ring = (grow, off, m = n) => openingOutline(o, HULL.inset, m, grow).map((p) => p.addScaledVector(into, off));
    const ringA = ring(0.03, 0.012), ringB = ring(small ? 0.13 : 0.1, 0.012), ringC = ring(small ? 0.136 : 0.106, -0.006);
    const pos = [];
    const quad = (A, B, C, D) => pos.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z, A.x, A.y, A.z, C.x, C.y, C.z, D.x, D.y, D.z);
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      quad(ringA[k], ringA[k2], ringB[k2], ringB[k]);     // flange face
      quad(ringB[k], ringB[k2], ringC[k2], ringC[k]);     // chamfered outer edge into the wall
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const nr = g.attributes.normal;
    if (nr.getX(0) * into.x + nr.getY(0) * into.y + nr.getZ(0) * into.z < 0) {
      const arr = g.attributes.position.array;
      for (let i = 0; i < arr.length; i += 9) for (let c = 0; c < 3; c++) { const t = arr[i + 3 + c]; arr[i + 3 + c] = arr[i + 6 + c]; arr[i + 6 + c] = t; }
      g.computeVertexNormals();
    }
    b.add(g, 'metal');
    b.tube(ring(0.024, 0.006), 0.007, 'black', { closed: true, radial: 5, seg: n * 2 });   // rubber gasket
    const nb = small ? 10 : 16;
    const bolts = ring(small ? 0.088 : 0.068, 0.019, nb * 4);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), into);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    for (let k = 0; k < bolts.length; k += 4) b.cyl(0.011, 0.011, 0.014, 'metalDark', bolts[k].toArray(), [e.x, e.y, e.z], 6);
    if (small) {
      const qz = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), into);
      const ez = new THREE.Euler().setFromQuaternion(qz, 'YXZ');
      const lp = openingOutline(o, HULL.inset, 4, 0.2).sort((p, q2) => p.y - q2.y)[0].addScaledVector(into, 0.004);   // under the window
      b.add(new THREE.PlaneGeometry(0.1, 0.03), 'labels', lp.toArray(), [ez.x, ez.y, ez.z]);
    }
  }
}

export function buildExtras(b, L) {
  const R = rng(9090);
  windowBezels(b);

  // ---- cockpit: extinguisher + first aid on the aft bulkhead, a duffel by the jump seat, cables
  extinguisher(b, [-1.05, 0.42, Z_COCKPIT_BULK - 0.15], Math.PI);
  firstAid(b, [1.0, 1.55, Z_COCKPIT_BULK - 0.15], Math.PI);
  b.box(0.5, 0.24, 0.26, 'fabricRed', [-1.85, 0.13, -9.2], [0, 0.4, 0], 0.08, 3);
  b.pipe([-2.05, 0.26, -9.15], [-1.65, 0.26, -9.3], 0.012, 'black', 6);

  // ---- living room: coffee table, beanbag, floor lamp, microwave, kettle, clock, jacket, shoes, plant
  coffeeTable(b, R, -1.9, -7.05, 0.3);
  beanbag(b, -2.2, -4.35, 'fabricRed');
  floorLampShip(b, -2.55, -4.95);
  b.box(0.3, 0.19, 0.24, 'plasticW', [-2.66, 1.035, -3.36], null, 0.02, 2);             // microwave on the counter
  b.box(0.18, 0.13, 0.005, 'black', [-2.69, 1.04, -3.478], null, 0.01);
  b.box(0.05, 0.02, 0.005, 'ledGreen', [-2.55, 1.08, -3.479], null, 0);
  b.cyl(0.07, 0.08, 0.18, 'steel', [-2.0, 1.03, -3.35], null, 16);                        // kettle
  b.tube([V(-2.07, 1.08, -3.35), V(-2.12, 1.06, -3.35), V(-2.15, 1.0, -3.35)], 0.012, 'steel', { radial: 6, seg: 6 });
  b.cyl(0.13, 0.13, 0.025, 'plasticW', [-1.0, 1.95, -3.0 - 0.085], [Math.PI / 2, 0, 0], 24); // wall clock
  b.cyl(0.115, 0.115, 0.005, 'paper', [-1.0, 1.95, -3.0 - 0.1], [Math.PI / 2, 0, 0], 24);
  b.box(0.008, 0.08, 0.003, 'black', [-1.0, 1.98, -3.0 - 0.104], [0, 0, 0.6], 0);
  b.box(0.006, 0.06, 0.003, 'black', [-1.0, 1.96, -3.0 - 0.104], [0, 0, -1.2], 0);
  hoodie(b, [-1.15, 1.55, -3.0 - 0.09], Math.PI, 'fabricBlue');
  for (const s of [-1, 1]) b.box(0.1, 0.06, 0.26, 'plasticK', [-1.25 + s * 0.06, 0.03, -3.42], [0, s * 0.15, 0], 0.025, 2);   // shoes
  plantPot(b, R, [-2.55, 0, -6.95], 1.4);
  bookRow(b, R, -2.3, 0.725, -5.9, 0.1, 1, 0.12, Math.PI / 2);

  // ---- bathroom: bath mat, laundry, toilet paper, soap + toothbrushes, towel ring, hair dryer
  b.box(0.6, 0.012, 0.85, 'fabricBlue', [1.4, 0.006, -6.85], null, 0.005);
  laundryBag(b, 1.12, -8.15);
  b.cyl(0.06, 0.06, 0.11, 'plasticW', [2.0, 0.62, -8.23], [0, 0, Math.PI / 2], 16);        // paper roll on the bulkhead
  b.box(0.16, 0.02, 0.04, 'steel', [2.0, 0.69, -8.28], null, 0.005);
  b.cyl(0.03, 0.035, 0.12, 'plasticG', [2.38, 0.95, -6.55], null, 12);                      // soap
  b.cyl(0.035, 0.03, 0.1, 'ceramic', [2.38, 0.94, -6.85], null, 12);                        // cup
  for (let k = 0; k < 2; k++) b.cyl(0.006, 0.006, 0.17, k ? 'plasticB' : 'plasticR', [2.37 + k * 0.015, 1.02, -6.85], [0.15 - k * 0.3, 0, 0.1], 6);
  b.torus(0.1, 0.012, 'steel', [wallX(1, -6.15, 1.1, 0.05), 1.1, -6.15], [0, Math.PI / 2, 0], 20);
  b.box(0.04, 0.32, 0.22, 'fabricRed', [wallX(1, -6.15, 0.9, 0.07), 0.92, -6.15], null, 0.02, 2);
  b.box(0.08, 0.16, 0.05, 'plasticK', [wallX(1, -7.25, 1.3, 0.06), 1.3, -7.25], null, 0.02);   // hair dryer
  b.cyl(0.03, 0.03, 0.12, 'plasticK', [wallX(1, -7.25, 1.38, 0.13), 1.38, -7.25], [0, 0, Math.PI / 2], 10);

  // ---- bunk alcove: hoodie on the head wall, tablet on the bed, slippers, a water bottle
  hoodie(b, [-2.3, 1.62, -2.93 + 0.0], 0, 'fabric');
  b.box(0.22, 0.012, 0.16, 'plasticK', [-2.05, 0.785, -0.7], [0, 0.5, 0], 0.005);
  b.box(0.2, 0.004, 0.14, 'ledBlue', [-2.05, 0.792, -0.7], [0, 0.5, 0], 0);
  for (const s of [-1, 1]) b.box(0.1, 0.05, 0.25, 'fabricRed', [-1.35 + s * 0.07, 0.025, -1.6], [0, 0.2 * s, 0], 0.025, 2);
  b.cyl(0.035, 0.035, 0.22, 'plasticB', [-2.62, 1.05, -2.2], null, 12);
  b.cyl(0.02, 0.02, 0.03, 'plasticK', [-2.62, 1.18, -2.2], null, 10);

  // ---- storage: bin rack along the hull, exercise bike, tool chest
  {
    const xh = -halfWidthAt(3.8, 1.85, INSET) + 0.05;
    binRack(b, R, xh, xh + 0.46, 3.15, 4.45, 0, 4, 0.42);
  }
  exerciseBike(b, -1.5, 3.8, 0);
  toolChest(b, -1.0, 5.25, Math.PI);
  extinguisher(b, [-0.86, 0.42, 4.15], -Math.PI / 2);

  // ---- airlock: O2 bottles, helmet shelf, checklist board
  o2Bottles(b, 0.98, -2.4, 3);
  helmetShelf(b, 1.75, 1.35, 0.6 - 0.07 - 0.15, Math.PI);
  b.box(0.02, 0.42, 0.32, 'plasticW', [0.757, 1.45, 0.05], null, 0.01);
  for (let k = 0; k < 6; k++) b.box(0.003, 0.012, 0.22, 'black', [0.769, 1.6 - k * 0.05, 0.03], null, 0);
  b.box(0.01, 0.06, 0.06, 'ledGreen', [0.77, 1.25, 0.15], null, 0);

  // ---- life support: hydroponic grow rack between the O2 column and the tank, a pump skid
  {
    const xh = halfWidthAt(3.75, 1.7, INSET);
    growRack(b, R, xh - 0.5, xh - 0.06, 3.28, 4.22, 3);
    L.lamps.push({ pos: V(xh - 0.3, 1.2, 3.75), color: 0xd070ff, intensity: 1.4, room: 'ls', range: 4 });
  }
  // pump skid: suction from the deck, discharge over to the water tank through a check valve
  b.box(0.6, 0.06, 0.5, 'metalDark', [1.3, 0.03, 5.05], null, 0.01);
  for (const [x, z] of [[1.04, 4.84], [1.56, 4.84], [1.04, 5.26], [1.56, 5.26]]) b.cyl(0.012, 0.012, 0.02, 'steel', [x, 0.065, z], null, 6);
  b.cyl(0.13, 0.13, 0.36, 'pipeBlue', [1.18, 0.2, 5.05], [0, 0, Math.PI / 2], 18);
  b.cyl(0.1, 0.1, 0.28, 'steel', [1.48, 0.2, 5.05], [0, 0, Math.PI / 2], 16);
  for (let k = 0; k < 6; k++) b.box(0.24, 0.006, 0.012, 'metalDark', [1.48, 0.2 + Math.cos(k / 6 * Math.PI * 2) * 0.1, 5.05 + Math.sin(k / 6 * Math.PI * 2) * 0.1], [k / 6 * Math.PI * 2, 0, 0], 0);
  b.tube([V(1.18, 0.33, 5.05), V(1.18, 0.48, 5.0), V(1.38, 0.52, 4.86), V(1.62, 0.52, 4.7), V(1.82, 0.52, 4.62)], 0.03, 'pipeBlue', { radial: 10 });
  b.cyl(0.05, 0.05, 0.03, 'steel', [1.8, 0.52, 4.62], [0, 0, Math.PI / 2], 16);              // flange at the tank
  b.cyl(0.045, 0.045, 0.1, 'steel', [1.52, 0.52, 4.76], [0, 0, Math.PI / 2], 14);             // check valve body
  b.pipe([1.52, 0.56, 4.76], [1.52, 0.66, 4.76], 0.008, 'steel', 6);
  valveWheel(b, [1.52, 0.665, 4.76], [-Math.PI / 2, 0, 0], 0.055, 'pipeBlue');
  b.tube([V(1.0, 0.2, 5.05), V(0.9, 0.18, 5.05), V(0.86, 0.05, 5.05), V(0.86, -0.12, 5.05)], 0.035, 'pipeBlue', { radial: 10 });
  b.cyl(0.07, 0.075, 0.02, 'steel', [0.86, 0.01, 5.05], null, 16);                            // deck collar
  b.colBox(0.6, 0.4, 0.5, [1.3, 0.2, 5.05]);

  // ---- engineering: workbench aft on the port side, extinguisher, first aid
  workbench(b, R, -1.5, -0.9, 8.45, 9.35);
  extinguisher(b, [0.9, 0.42, Z_ENG_BULK + 0.15], 0);
  firstAid(b, [-0.95, 1.6, Z_ENG_BULK + 0.15], 0);

  // ---- corridor: extinguisher, first aid, name plates over the doors
  extinguisher(b, [-0.6, 0.4, 1.0], Math.PI / 2);
  firstAid(b, [0.6, 1.5, 1.6], -Math.PI / 2);
  const signAt = { cockpit: 0, living: 1, store: 2, bath: 3, airlock: 4, ls: 5, eng: 6 };
  for (const [id, d] of Object.entries(DOORS)) {
    const idx = signAt[id];
    if (idx === undefined) continue;
    const y = d.h + 0.17;
    if (d.axis === 'x') b.push([d.at - Math.sign(d.at) * 0.056, y, d.c], [0, -Math.sign(d.at) * Math.PI / 2, 0]);
    else b.push([d.c, y, d.at + (id === 'cockpit' ? 0.103 : -0.103)], [0, id === 'cockpit' ? 0 : Math.PI, 0]);
    roomSign(b, idx, [0, 0, 0], 0);
    b.pop();
  }
  sticker(b, [0.645, 1.15, -5.0], [0, -Math.PI / 2, 0], 0.16, 0.1);
}
