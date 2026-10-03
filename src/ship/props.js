// Reusable clutter / prop builders (static props go through a Builder and get merged).
import * as THREE from 'three';
import { RoundedBoxGeometry } from './geom.js';

const BOOKS = ['book1', 'book2', 'book3', 'book4', 'paper'];

export function bookRow(b, R, x, y, z, len, dirX = 1, depth = 0.17, rotY = 0) {
  b.push([x, y, z], [0, rotY, 0]);
  let s = 0;
  while (s < len) {
    const t = 0.02 + R() * 0.035, h = 0.16 + R() * 0.09, d = depth * (0.8 + R() * 0.2);
    const lean = s > len - 0.12 ? (R() - 0.5) * 0.3 : (R() - 0.5) * 0.04;
    b.box(t, h, d, BOOKS[Math.floor(R() * BOOKS.length)], [s + t / 2, h / 2, 0], [0, 0, lean], 0.004, 1);
    s += t + 0.002;
  }
  b.pop();
}

export function plantPot(b, R, pos, size = 1) {
  const [x, y, z] = pos;
  b.cyl(0.07 * size, 0.055 * size, 0.11 * size, R() > 0.5 ? 'ceramic' : 'plasticR', [x, y + 0.055 * size, z], null, 14);
  b.cyl(0.065 * size, 0.065 * size, 0.01, 'soil', [x, y + 0.105 * size, z], null, 12);
  const n = 7 + Math.floor(R() * 6);
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, tilt = 0.3 + R() * 0.8, l = (0.12 + R() * 0.14) * size;
    b.push([x, y + 0.11 * size, z], [0, a, tilt]);
    b.add(leaf(l, 0.035 * size), R() > 0.4 ? 'plant' : 'plant2', [0, l / 2, 0]);
    b.pop();
  }
}

function leaf(l, w) {
  const s = new THREE.Shape();
  s.moveTo(0, -l / 2);
  s.quadraticCurveTo(w, 0, 0, l / 2);
  s.quadraticCurveTo(-w, 0, 0, -l / 2);
  const g = new THREE.ShapeGeometry(s, 4);
  return g;
}

export function hangingPlant(b, R, pos) {
  const [x, y, z] = pos;
  b.cyl(0.08, 0.06, 0.1, 'ceramic', [x, y, z], null, 12);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const pts = [];
    const L = 0.25 + R() * 0.35;
    for (let k = 0; k <= 6; k++) pts.push([x + Math.cos(a) * (0.06 + k * 0.02), y - k * L / 6, z + Math.sin(a) * (0.06 + k * 0.02)]);
    b.tube(pts, 0.004, 'plant', { radial: 4 });
    for (let k = 1; k <= 6; k++) b.add(leaf(0.05, 0.025), 'plant2', pts[k], [R() * 3, a, R() * 3]);
  }
}

export function mugGeo() {
  const g = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.038, 0), new THREE.Vector2(0.04, 0.005), new THREE.Vector2(0.041, 0.095), new THREE.Vector2(0.036, 0.095), new THREE.Vector2(0.035, 0.008), new THREE.Vector2(0, 0.008)], 18);
  return g;
}

export function mug(b, pos, rotY = 0, key = 'ceramic') {
  b.push(pos, [0, rotY, 0]);
  b.add(mugGeo(), key);
  b.torus(0.022, 0.006, key, [0.045, 0.05, 0], [0, 0, Math.PI / 2], 10, Math.PI * 1.3);
  b.pop();
}

export function boxStack(b, R, pos, n = 3, keys = ['plasticW', 'plasticK', 'panelDark', 'plasticB']) {
  let y = pos[1];
  for (let i = 0; i < n; i++) {
    const w = 0.25 + R() * 0.2, h = 0.12 + R() * 0.15, d = 0.2 + R() * 0.15;
    b.box(w, h, d, keys[Math.floor(R() * keys.length)], [pos[0] + (R() - 0.5) * 0.04, y + h / 2, pos[2] + (R() - 0.5) * 0.04], [0, (R() - 0.5) * 0.3, 0], 0.012, 2, true);
    y += h;
  }
}

export function cargoBag(b, R, pos, size = [0.4, 0.25, 0.3], key = 'fabricBlue') {
  const [w, h, d] = size;
  b.box(w, h, d, key, pos, [0, (R() - 0.5) * 0.4, (R() - 0.5) * 0.2], Math.min(w, h, d) * 0.4, 3);
  // straps
  b.box(w + 0.01, h * 0.15, 0.03, 'rubber', [pos[0], pos[1], pos[2] + d * 0.2], null, 0.01);
  b.box(w + 0.01, h * 0.15, 0.03, 'rubber', [pos[0], pos[1], pos[2] - d * 0.2], null, 0.01);
}

export function cableBundle(b, pts, n = 4, spread = 0.025) {
  const keys = ['cable', 'cableR', 'cableB', 'cableY'];
  for (let i = 0; i < n; i++) {
    const off = [(Math.cos(i * 2.4) * spread), (Math.sin(i * 2.4) * spread), (Math.sin(i * 1.7) * spread)];
    b.tube(pts.map((p) => [p[0] + off[0], p[1] + off[1], p[2] + off[2]]), 0.007 + (i % 2) * 0.003, keys[i % 4], { radial: 5 });
  }
}

export function switchPanel(b, R, pos, rot, cols = 6, rows = 3, sp = 0.05) {
  b.push(pos, rot);
  b.box(cols * sp + 0.04, rows * sp + 0.04, 0.025, 'panelDark', [0, 0, 0], null, 0.006);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = (i - (cols - 1) / 2) * sp, y = (j - (rows - 1) / 2) * sp;
    const k = R();
    if (k < 0.5) {
      b.cyl(0.008, 0.008, 0.012, 'steel', [x, y, 0.016], [Math.PI / 2, 0, 0], 8);
      b.cyl(0.003, 0.003, 0.025, 'steel', [x, y + 0.006, 0.03], [Math.PI / 2 - 0.5, 0, 0], 6);
    } else if (k < 0.8) {
      b.box(0.022, 0.022, 0.012, R() > 0.5 ? 'plasticK' : 'plasticW', [x, y, 0.016], null, 0.003);
    } else {
      b.cyl(0.011, 0.011, 0.016, 'plasticK', [x, y, 0.02], [Math.PI / 2, 0, 0], 12);
    }
    if (R() < 0.35) b.box(0.006, 0.006, 0.004, R() > 0.5 ? 'ledGreen' : 'ledAmber', [x + 0.016, y + 0.016, 0.015], null, 0);
  }
  b.pop();
}

export function gauge(b, pos, rot, r = 0.05) {
  b.push(pos, rot);
  b.cyl(r, r, 0.03, 'steel', [0, 0, 0], [Math.PI / 2, 0, 0], 20);
  b.cyl(r * 0.88, r * 0.88, 0.005, 'paper', [0, 0, 0.016], [Math.PI / 2, 0, 0], 20);
  b.box(r * 0.08, r * 0.8, 0.004, 'plasticR', [0, r * 0.3, 0.02], [0, 0, 0.6], 0);
  b.pop();
}

export function valveWheel(b, pos, rot, r = 0.08, key = 'pipeRed') {
  b.push(pos, rot);
  b.torus(r, r * 0.12, key, [0, 0, 0], [0, 0, 0], 20);
  for (let k = 0; k < 4; k++) b.box(r * 2, r * 0.12, r * 0.12, key, [0, 0, 0], [0, 0, (k * Math.PI) / 4], 0);
  b.cyl(r * 0.25, r * 0.25, r * 0.4, 'steel', [0, 0, 0], [Math.PI / 2, 0, 0], 10);
  b.pop();
}

export function sticker(b, pos, rot, w = 0.08, h = 0.05) {
  b.add(new THREE.PlaneGeometry(w, h), 'labels', pos, rot);
}

export function stringLights(b, pts, every = 0.22) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  b.add(new THREE.TubeGeometry(curve, 80, 0.003, 4), 'cable');
  const L = curve.getLength();
  const n = Math.floor(L / every);
  const lamps = [];
  for (let i = 1; i < n; i++) {
    const p = curve.getPointAt(i / n);
    b.sphere(0.012, 'stringLight', [p.x, p.y - 0.012, p.z], 6);
    lamps.push(p);
  }
  return lamps;
}

export function toolWall(b, R, pos, rot) {
  b.push(pos, rot);
  b.box(1.1, 0.7, 0.02, 'panel', [0, 0, 0], null, 0.005);
  // pegboard holes not modelled; tools
  for (let i = 0; i < 9; i++) {
    const x = -0.45 + i * 0.11, y = 0.15 - (i % 3) * 0.08;
    const k = i % 3;
    if (k === 0) { // wrench
      b.box(0.018, 0.22, 0.008, 'steel', [x, y - 0.05, 0.02], [0, 0, 0.05], 0.003);
      b.torus(0.022, 0.007, 'steel', [x, y + 0.08, 0.02], [0, 0, 0], 10, Math.PI * 1.5);
    } else if (k === 1) { // screwdriver
      b.cyl(0.012, 0.012, 0.09, i % 2 ? 'plasticR' : 'plasticY', [x, y + 0.03, 0.025], null, 8);
      b.cyl(0.003, 0.003, 0.12, 'steel', [x, y - 0.07, 0.025], null, 6);
    } else { // pliers
      b.box(0.014, 0.16, 0.01, 'plasticB', [x - 0.01, y - 0.02, 0.022], [0, 0, 0.12], 0.003);
      b.box(0.014, 0.16, 0.01, 'plasticB', [x + 0.01, y - 0.02, 0.022], [0, 0, -0.12], 0.003);
    }
  }
  // tape rolls and spools on the lower part
  b.torus(0.04, 0.018, 'plasticK', [0.3, -0.24, 0.03], [0, 0, 0], 12);
  b.torus(0.04, 0.018, 'insul', [0.42, -0.24, 0.03], [0, 0, 0], 12);
  b.cyl(0.06, 0.06, 0.05, 'cableR', [-0.35, -0.24, 0.04], [Math.PI / 2, 0, 0], 16);
  b.pop();
}

export function photoFrame(b, pos, rot, key = 'poster1', w = 0.12, h = 0.09) {
  b.push(pos, rot);
  b.box(w + 0.02, h + 0.02, 0.012, 'wood', [0, 0, 0], null, 0.003);
  b.add(new THREE.PlaneGeometry(w, h), key, [0, 0, 0.0065]);
  b.pop();
}

export function locker(b, pos, rot, w = 0.5, h = 1.8, d = 0.45, key = 'panel') {
  b.push(pos, rot);
  b.box(w, h, d, key, [0, h / 2, 0], null, 0.015, 2, true);
  b.box(w - 0.04, h - 0.06, 0.01, 'panelDark', [0, h / 2, d / 2 + 0.003], null, 0.004);
  b.box(0.02, 0.15, 0.02, 'steel', [w / 2 - 0.06, h / 2, d / 2 + 0.015], null, 0.005);
  for (let i = 0; i < 4; i++) b.box(w * 0.5, 0.008, 0.004, 'black', [0, h * 0.75 + i * 0.02, d / 2 + 0.01], null, 0);
  b.pop();
}
