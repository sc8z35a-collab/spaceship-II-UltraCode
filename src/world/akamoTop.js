// AKAMO's top terminal, 2,500 km over Shirasagi: the end of the ribbon. Here the ribbon's own turn
// pulls outward — 0.73 g toward space — so the floor faces away from the Earth and the Earth
// hangs overhead, through a glass dome, the ribbon running up into it out of sight.
// The hall: a round concourse 26 m across round the cabin's berth (the cabin's floor level with
// its own), boarding bridges at the cabin's doors, benches, planters, the information pillars, a
// low wall with a rail round the glass, the anchor's machinery under the floor and the
// counterweight's drum outside.
// Terminal-local: the same as the cabin's own frame while it lies here (floor y 0, x along the
// cabin's doors); "up" (+y) is toward the Earth.
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';
import { CABIN, ovalAt } from './akamoCabin.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const TOP = { R: 13, wall: 1.15, H: 5.2, dome: 7.5 };

let MATS = null;
function mats() {
  if (MATS) return MATS;
  const S = (o) => new THREE.MeshStandardMaterial(o);
  MATS = {
    floor: S({ color: 0xcfc8bc, roughness: 0.4, metalness: 0.05 }),
    floorInlay: S({ color: 0x2a2f36, roughness: 0.35, metalness: 0.4 }),
    wall: S({ color: 0xe9e6e0, roughness: 0.6, metalness: 0.05 }),
    rail: S({ color: 0xc9a86a, roughness: 0.3, metalness: 0.9 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xcfe2ee, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
    rib: S({ color: 0x9aa3ad, roughness: 0.3, metalness: 0.85 }),
    bench: S({ color: 0x6b4a33, roughness: 0.55, metalness: 0.0 }),
    benchLeg: S({ color: 0x3b4048, roughness: 0.35, metalness: 0.8 }),
    plant: S({ color: 0x3f6b3a, roughness: 0.8, metalness: 0 }),
    pot: S({ color: 0xd9d3c7, roughness: 0.7, metalness: 0 }),
    lamp: S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.92, 0.8), emissiveIntensity: 2.4 }),
    pillar: S({ color: 0x23272d, roughness: 0.4, metalness: 0.5 }),
    screen: S({ color: 0x000000, emissive: new THREE.Color(0.35, 0.6, 0.9), emissiveIntensity: 1.2 }),
    shell: S({ color: 0xdfe3e7, roughness: 0.45, metalness: 0.35 }),
    shellDark: S({ color: 0x30353c, roughness: 0.5, metalness: 0.6 }),
    red: S({ color: 0x000000, emissive: new THREE.Color(1, 0.1, 0.05), emissiveIntensity: 5 }),
  };
  return MATS;
}

/** a flat ring between the cabin's oval (scaled k0) and the circle R, at height y */
function annulus(k0, R, y, n = 96, up = true) {
  const pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p = ovalAt(a, k0);
    pos.push(p.x, y, p.z, Math.cos(a) * R, y, Math.sin(a) * R);
  }
  for (let i = 0; i < n; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; if (up) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** the hall: { group, colliders (terminal-local descriptors), contains(x, y, z), lamps } */
export function buildTopHall() {
  const M = mats();
  const T = TOP, b = new Builder();
  const group = new THREE.Group();
  group.name = 'akamoTop';
  const add = (geo, mat, ro = 0) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = ro; group.add(m); return m; };
  // ---- the floor round the berth, an inlaid ring at its edge, the underside
  add(annulus(1.07, T.R, 0, 120, true), M.floor);
  add(annulus(1.07, 1.12 * 1.0, 0.004, 120, true), M.floorInlay);
  add(annulus(1.0, T.R + 0.4, -1.2, 120, false), M.shellDark);
  // ---- the low wall round the edge, its rail; the glass above it and the dome
  const wall = new THREE.CylinderGeometry(T.R, T.R, T.wall, 96, 1, true);
  wall.scale(-1, 1, 1);
  wall.translate(0, T.wall / 2, 0);
  add(wall, M.wall);
  b.torus(T.R - 0.25, 0.03, 'rail', [0, 1.0, 0], [Math.PI / 2, 0, 0], 96);
  const glass = new THREE.CylinderGeometry(T.R, T.R, T.H - T.wall, 96, 1, true);
  glass.translate(0, T.wall + (T.H - T.wall) / 2, 0);
  add(glass, M.glass, 3);
  const dome = new THREE.SphereGeometry(1, 64, 20, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(T.R, T.dome, T.R);
  dome.translate(0, T.H, 0);
  add(dome, M.glass, 3);
  // the dome's ribs, the ring at its foot, the glass's mullions
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const pts = [];
    for (let i = 0; i <= 12; i++) { const ph = (i / 12) * Math.PI / 2; pts.push(V(Math.cos(a) * Math.cos(ph) * (T.R - 0.05), T.H + Math.sin(ph) * (T.dome - 0.05), Math.sin(a) * Math.cos(ph) * (T.R - 0.05))); }
    b.tube(pts, 0.06, 'rib', { radial: 6, seg: 24 });
    b.box(0.08, T.H - T.wall, 0.08, 'rib', [Math.cos(a) * (T.R - 0.04), T.wall + (T.H - T.wall) / 2, Math.sin(a) * (T.R - 0.04)], [0, -a, 0], 0.01);
  }
  b.torus(T.R - 0.05, 0.1, 'rib', [0, T.H, 0], [Math.PI / 2, 0, 0], 96);
  // ---- the ribbon's way up out of the berth (a collar round it over the cabin's roof)
  b.cyl(1.4, 1.8, 1.2, 'shell', [0, CABIN.H + CABIN.dome + 1.9, 0], null, 32);
  b.cyl(0.5, 0.5, T.dome + T.H - (CABIN.H + CABIN.dome + 2.5), 'shellDark', [0, (CABIN.H + CABIN.dome + 2.5 + T.H + T.dome) / 2, 0], null, 20);
  // ---- the boarding bridges at the cabin's doors (gates with their signs)
  for (const s of [1, -1]) {
    const x = s * (CABIN.A + 0.9);
    b.box(1.6, 0.06, CABIN.door.w + 0.6, 'floorInlay', [x, 0.03, 0], null, 0.01);
    for (const z of [-1, 1]) b.box(1.6, 1.05, 0.06, 'glass', [x, 0.55, z * (CABIN.door.w / 2 + 0.3)], null, 0);
    for (const z of [-1, 1]) b.pipe(V(x - 0.8, 1.05, z * (CABIN.door.w / 2 + 0.3)), V(x + 0.8, 1.05, z * (CABIN.door.w / 2 + 0.3)), 0.025, 'rail', 6);
  }
  // ---- benches in a ring, planters, the information pillars, lamps
  const colliders = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + Math.PI / 10;
    if (Math.abs(Math.cos(a)) > 0.9) continue;
    const r = 10.4;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    b.box(2.4, 0.08, 0.6, 'bench', [x, 0.45, z], [0, -a + Math.PI / 2, 0], 0.02);
    b.box(2.4, 0.5, 0.08, 'bench', [x + Math.cos(a) * 0.3, 0.72, z + Math.sin(a) * 0.3], [0, -a + Math.PI / 2, 0], 0.02);
    for (const t of [-0.95, 0.95]) b.box(0.06, 0.45, 0.5, 'benchLeg', [x - Math.sin(a) * t, 0.22, z + Math.cos(a) * t], [0, -a + Math.PI / 2, 0], 0.01);
    colliders.push({ type: 'box', hx: 1.2, hy: 0.25, hz: 0.32, m: new THREE.Matrix4().compose(V(x, 0.25, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -a + Math.PI / 2), V(1, 1, 1)) });
  }
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const x = Math.cos(a) * 11.6, z = Math.sin(a) * 11.6;
    b.cyl(0.45, 0.38, 0.7, 'pot', [x, 0.35, z], null, 16);
    for (let i = 0; i < 7; i++) b.sphere(0.32 + 0.08 * Math.sin(i * 2.1 + k), 'plant', [x + Math.cos(i * 0.9) * 0.18, 0.95 + i * 0.06, z + Math.sin(i * 0.9) * 0.18], 8);
    colliders.push({ type: 'cyl', hh: 0.6, r: 0.5, m: new THREE.Matrix4().makeTranslation(x, 0.6, z) });
  }
  for (const s of [1, -1]) for (const z of [-1, 1]) {
    const x = s * 9.0, zz = z * 3.6;
    b.box(0.5, 2.2, 0.5, 'pillar', [x, 1.1, zz], null, 0.03);
    b.box(0.02, 1.0, 0.42, 'screen', [x - s * 0.26, 1.5, zz], null, 0);
    colliders.push({ type: 'box', hx: 0.25, hy: 1.1, hz: 0.25, m: new THREE.Matrix4().makeTranslation(x, 1.1, zz) });
  }
  // the lamps: a ring of downlights round the dome's foot (and their places in the light pool)
  const lamps = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.13;
    const p = V(Math.cos(a) * (T.R - 0.6), T.H - 0.15, Math.sin(a) * (T.R - 0.6));
    b.cyl(0.22, 0.22, 0.05, 'lamp', [p.x, p.y, p.z], null, 14);
    if (k % 2 === 0) lamps.push({ local: p.clone().setY(T.H - 0.5), color: 0xfff0dc, intensity: 2.2, room: 'akamoTop' });
  }
  // ---- outside: the anchor's drum under the floor, radiators, a red light
  b.cyl(T.R + 1.0, T.R + 0.6, 3.2, 'shell', [0, -2.8, 0], null, 64);
  b.cyl(5.5, 7.5, 6.0, 'shellDark', [0, -7.4, 0], null, 40);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.box(0.12, 2.0, 9.0, 'rib', [Math.cos(a) * (T.R + 6), -4.0, Math.sin(a) * (T.R + 6)], [0, -a, 0], 0.01);
  }
  b.sphere(0.25, 'red', [T.R + 1.1, -1.5, 0], 8);
  b.sphere(0.25, 'red', [-T.R - 1.1, -1.5, 0], 8);
  group.add(b.build(M, { castShadow: false }));
  // ---- colliders (terminal-local): the floor (a ring of boxes outside the oval), the wall
  const nF = 48;
  for (let i = 0; i < nF; i++) {
    const a0 = (i / nF) * Math.PI * 2, a1 = ((i + 1) / nF) * Math.PI * 2, am = (a0 + a1) / 2;
    const pIn = ovalAt(am, 1.06), rIn = Math.hypot(pIn.x, pIn.z);
    const rOut = T.R + 0.2, rm = (rIn + rOut) / 2, len = rOut - rIn;
    const w = rOut * (a1 - a0) + 0.1;
    colliders.push({ type: 'box', hx: len / 2, hy: 0.1, hz: w / 2, m: new THREE.Matrix4().compose(V(Math.cos(am) * rm, -0.1, Math.sin(am) * rm), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -am), V(1, 1, 1)) });
  }
  const nW = 64;
  for (let i = 0; i < nW; i++) {
    const a = ((i + 0.5) / nW) * Math.PI * 2;
    const w = T.R * (Math.PI * 2 / nW) + 0.12;
    colliders.push({ type: 'box', hx: 0.1, hy: (T.H + 2) / 2, hz: w / 2, m: new THREE.Matrix4().compose(V(Math.cos(a) * (T.R + 0.1), (T.H + 2) / 2, Math.sin(a) * (T.R + 0.1)), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -a), V(1, 1, 1)) });
  }
  // the dome's inside, a cap high over the floor (nothing can reach it in 0.7 g, but in case)
  colliders.push({ type: 'box', hx: T.R, hy: 0.2, hz: T.R, m: new THREE.Matrix4().makeTranslation(0, T.H + T.dome * 0.8, 0) });
  const contains = (x, y, z) => y > -0.3 && y < T.H + T.dome && x * x + z * z < (T.R + 0.2) ** 2;
  return { group, colliders, contains, lamps, M };
}
