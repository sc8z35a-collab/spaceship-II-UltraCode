// AKAMO's cabin: an oval room 14 m by 9 m, glass all round from the floor to the ceiling (thin
// mullions, a band of glass floor along the wall to look straight down past your feet), no seats —
// a rail runs round the glass and another round the drive core in the middle, loops hang from the
// ceiling to hold on to at the launch. The ribbon runs up through the core; the info display wraps
// round it at eye height (speed, height, what is felt, the time to go). Two sliding doors at the
// ends of the oval take the boarding bridges. Outside: the drive units above and below the floor
// gripping the ribbon (their rollers in rings), radiator fins, the lights.
// Cabin-local: the floor at y 0, the oval round the origin (x the long axis), the ribbon along y.
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const CABIN = {
  A: 7.0, B: 4.6,             // the oval's half axes (m)
  H: 3.0,                     // floor to the ceiling's edge
  dome: 0.45,                 // the ceiling's rise in the middle
  coreR: 0.95,                // the drive core round the ribbon
  rail: 1.0,                  // the rails' height
  door: { w: 1.7, h: 2.3 },   // at x = +-A
  glassFloor: 0.8,            // the band of glass floor inside the wall
};

/** a point of the oval at angle a (scaled by k: 1 the wall) */
export function ovalAt(a, k = 1, out = new THREE.Vector3()) { return out.set(Math.cos(a) * CABIN.A * k, 0, Math.sin(a) * CABIN.B * k); }

let MATS = null;
export function cabinMaterials(env = null) {
  if (MATS) return MATS;
  const S = (o) => new THREE.MeshStandardMaterial(o);
  MATS = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0xbfd8e8, roughness: 0.04, metalness: 0, transmission: 0, transparent: true, opacity: 0.12, envMapIntensity: 1.2, side: THREE.DoubleSide, depthWrite: false }),
    glassFloor: new THREE.MeshPhysicalMaterial({ color: 0x9fc4dc, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.18, envMapIntensity: 1.0, depthWrite: false }),
    floor: S({ color: 0x23272d, roughness: 0.55, metalness: 0.25 }),
    floorLine: S({ color: 0x000000, emissive: new THREE.Color(0.55, 0.8, 1.0), emissiveIntensity: 1.2 }),
    mullion: S({ color: 0x3a4048, roughness: 0.35, metalness: 0.8 }),
    ceiling: S({ color: 0xe8ecef, roughness: 0.6, metalness: 0.05 }),
    lightRing: S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.96, 0.9), emissiveIntensity: 3.0 }),
    core: S({ color: 0xb9c0c7, roughness: 0.28, metalness: 0.9 }),
    coreDark: S({ color: 0x1c2025, roughness: 0.45, metalness: 0.6 }),
    rail: S({ color: 0xd8dde2, roughness: 0.2, metalness: 0.95 }),
    strap: S({ color: 0x2b3038, roughness: 0.7, metalness: 0.1 }),
    strapGrip: S({ color: 0xe8b33c, roughness: 0.5, metalness: 0.1 }),
    shell: S({ color: 0xdfe3e7, roughness: 0.45, metalness: 0.35 }),
    shellDark: S({ color: 0x30353c, roughness: 0.5, metalness: 0.6 }),
    roller: S({ color: 0x8f969e, roughness: 0.3, metalness: 0.9 }),
    radiator: S({ color: 0xc8ccd0, roughness: 0.35, metalness: 0.7 }),
    red: S({ color: 0x000000, emissive: new THREE.Color(1, 0.12, 0.06), emissiveIntensity: 4 }),
    green: S({ color: 0x000000, emissive: new THREE.Color(0.15, 1, 0.3), emissiveIntensity: 4 }),
    strobe: S({ color: 0x000000, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 }),
    doorFrame: S({ color: 0x5a616a, roughness: 0.35, metalness: 0.85 }),
    sign: S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.55, 0.2), emissiveIntensity: 1.5 }),
  };
  return MATS;
}

/** an oval band (a ring of quads) from k0 to k1 of the oval at height y (facing up or down) */
function ovalBand(k0, k1, y, up = true, n = 72) {
  const pos = [], idx = [], uv = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p0 = ovalAt(a, k0), p1 = ovalAt(a, k1);
    pos.push(p0.x, y, p0.z, p1.x, y, p1.z);
    uv.push(i / n, 0, i / n, 1);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    if (up) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** the oval's wall from y0 to y1, its openings (angle ranges) left out */
function ovalWall(k, y0, y1, gaps = [], n = 96, inward = true) {
  const pos = [], idx = [], uv = [];
  const inGap = (a) => gaps.some(([g0, g1]) => { const d = Math.atan2(Math.sin(a - (g0 + g1) / 2), Math.cos(a - (g0 + g1) / 2)); return Math.abs(d) < (g1 - g0) / 2; });
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p = ovalAt(a, k);
    pos.push(p.x, y0, p.z, p.x, y1, p.z);
    uv.push(i / n, 0, i / n, 1);
  }
  for (let i = 0; i < n; i++) {
    if (inGap((i + 0.5) / n * Math.PI * 2)) continue;
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    if (inward) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** the ceiling: a shallow oval dome over the room (facing down) */
function ceilingDome(n = 72, m = 8) {
  const pos = [], idx = [];
  for (let j = 0; j <= m; j++) {
    const k = 1 - j / m;
    const y = CABIN.H + CABIN.dome * (1 - k * k);
    for (let i = 0; i <= n; i++) {
      const p = ovalAt((i / n) * Math.PI * 2, Math.max(k, CABIN.coreR / CABIN.B * 1.02));
      pos.push(p.x, y, p.z);
    }
  }
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** the angle ranges of the two doors (at x = +A and x = -A) */
export function doorGaps() {
  const hw = CABIN.door.w / 2 / CABIN.B * 0.85;
  return [[-hw, hw], [Math.PI - hw, Math.PI + hw]];
}

/**
 * The cabin: { group (to be placed by its pose), doors [{ leaf, side }], strobe, display (a mesh
 * for the info screen), boxes (the colliders, cabin-local: { half, pos, quat })}
 */
export function buildCabin() {
  const M = cabinMaterials();
  const C = CABIN, b = new Builder();
  const group = new THREE.Group();
  group.name = 'akamoCabin';
  const add = (geo, mat, ro = 0) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = ro; group.add(m); return m; };
  const gaps = doorGaps();
  // ---- the floor: dark composite in the middle, glass along the wall, light lines between
  const kIn = 1 - C.glassFloor / C.B;
  add(ovalBand(C.coreR / C.B, kIn, 0.0, true), M.floor);
  add(ovalBand(kIn, kIn + 0.012, 0.004, true), M.floorLine);
  add(ovalBand(kIn + 0.012, 1, 0.0, true), M.glassFloor, 2);
  // (seen from below: the floor's underside)
  add(ovalBand(C.coreR / C.B, 1.0, -0.06, false), M.shellDark);
  // ---- the glass wall and its mullions, the doors' frames
  add(ovalWall(1, 0, C.H, gaps, 96, true), M.glass, 3);
  const nM = 28;
  for (let i = 0; i < nM; i++) {
    const a = (i / nM) * Math.PI * 2;
    if (gaps.some(([g0, g1]) => Math.abs(Math.atan2(Math.sin(a - (g0 + g1) / 2), Math.cos(a - (g0 + g1) / 2))) < (g1 - g0) / 2 + 0.05)) continue;
    const p = ovalAt(a, 1.0);
    b.box(0.05, C.H, 0.07, 'mullion', [p.x, C.H / 2, p.z], [0, -a, 0], 0.005);
  }
  // the sill and the head of the glass all round
  add(ovalBand(0.985, 1.01, 0.03, true), M.mullion);
  add(ovalBand(0.975, 1.01, C.H, false), M.mullion);
  // ---- the ceiling, its light ring
  add(ceilingDome(), M.ceiling);
  add(ovalBand(0.55, 0.6, C.H + C.dome * (1 - 0.575 * 0.575) - 0.02, false), M.lightRing);
  add(ovalBand(0.9, 0.93, C.H + C.dome * (1 - 0.915 * 0.915) - 0.02, false), M.lightRing);
  // ---- the core: the drive's column round the ribbon, a dark band where the display wraps
  b.cyl(C.coreR, C.coreR, C.H + C.dome + 0.1, 'core', [0, (C.H + C.dome) / 2, 0], null, 40);
  b.cyl(C.coreR + 0.01, C.coreR + 0.01, 0.06, 'coreDark', [0, 0.03, 0], null, 40);
  // rails: round the core and round the glass (on short posts)
  b.torus(C.coreR + 0.32, 0.025, 'rail', [0, C.rail, 0], [Math.PI / 2, 0, 0], 48);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; b.pipe(V(Math.cos(a) * (C.coreR + 0.02), C.rail, Math.sin(a) * (C.coreR + 0.02)), V(Math.cos(a) * (C.coreR + 0.32), C.rail, Math.sin(a) * (C.coreR + 0.32)), 0.018, 'rail', 6); }
  {
    const n = 120, pts = [];
    for (let i = 0; i <= n; i++) pts.push(ovalAt((i / n) * Math.PI * 2, 1 - 0.22 / C.B).setY(C.rail));
    // (cut at the doors)
    let run = [];
    const flush = () => { if (run.length > 1) for (let i = 0; i < run.length - 1; i++) b.pipe(run[i], run[i + 1], 0.022, 'rail', 6); run = []; };
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const gap = gaps.some(([g0, g1]) => Math.abs(Math.atan2(Math.sin(a - (g0 + g1) / 2), Math.cos(a - (g0 + g1) / 2))) < (g1 - g0) / 2 + 0.08);
      if (gap) flush(); else run.push(pts[i]);
    }
    flush();
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + 0.07;
      if (gaps.some(([g0, g1]) => Math.abs(Math.atan2(Math.sin(a - (g0 + g1) / 2), Math.cos(a - (g0 + g1) / 2))) < (g1 - g0) / 2 + 0.12)) continue;
      const p = ovalAt(a, 1 - 0.22 / C.B), q = ovalAt(a, 0.995);
      b.pipe(V(p.x, C.rail, p.z), V(q.x, C.rail - 0.25, q.z), 0.016, 'rail', 6);
    }
  }
  // the loops hanging from the ceiling (two rings of them), for the launch
  for (const [k, n] of [[0.42, 14], [0.75, 22]]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + k;
      const p = ovalAt(a, k);
      const top = C.H + C.dome * (1 - k * k);
      b.box(0.03, 0.42, 0.012, 'strap', [p.x, top - 0.21, p.z], [0, -a, 0], 0.003);
      b.torus(0.07, 0.014, 'strapGrip', [p.x, top - 0.48, p.z], [0, -a + Math.PI / 2, 0], 14);
    }
  }
  // ---- the doors: frames, and the leaves (each slides along the wall)
  const doors = [];
  for (const s of [1, -1]) {
    const x = s * C.A;
    b.box(0.12, C.door.h + 0.12, 0.08, 'doorFrame', [x, (C.door.h + 0.12) / 2, C.door.w / 2 + 0.04], null, 0.01);
    b.box(0.12, C.door.h + 0.12, 0.08, 'doorFrame', [x, (C.door.h + 0.12) / 2, -C.door.w / 2 - 0.04], null, 0.01);
    b.box(0.12, 0.1, C.door.w + 0.16, 'doorFrame', [x, C.door.h + 0.06, 0], null, 0.01);
    b.box(0.16, 0.04, C.door.w + 0.1, 'sign', [x - s * 0.02, C.door.h + 0.2, 0], null, 0.004);
    const leaf = new THREE.Group();
    leaf.position.set(x, 0, 0);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(0.03, C.door.h, C.door.w), M.glass);
    gl.position.y = C.door.h / 2; gl.renderOrder = 3;
    const fr = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, C.door.w), M.mullion);
    fr.position.y = 0.03;
    const fr2 = fr.clone(); fr2.position.y = C.door.h - 0.03;
    leaf.add(gl, fr, fr2);
    group.add(leaf);
    doors.push({ leaf, side: s, open: 0 });
  }
  // ---- outside: the drive units under the floor and over the ceiling, gripping the ribbon
  for (const s of [-1, 1]) {
    const y = s < 0 ? -0.9 : C.H + C.dome + 0.75;
    b.cyl(2.2, 2.6, 1.4, 'shell', [0, y, 0], null, 40);
    b.cyl(2.7, 2.7, 0.25, 'shellDark', [0, y + s * 0.6, 0], null, 40);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      b.cyl(0.35, 0.35, 0.5, 'roller', [Math.cos(a) * 0.62, y + s * 0.95, Math.sin(a) * 0.62], [0, 0, Math.PI / 2], 16);
    }
    // radiator fins
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.26;
      b.box(0.04, 1.1, 2.6, 'radiator', [Math.cos(a) * 3.9, y, Math.sin(a) * 3.9], [0, -a, 0], 0.005);
    }
  }
  // the skirt round the floor's edge and the eave over the glass
  add(ovalWall(1.02, -0.5, 0.0, [], 96, false), M.shell);
  add(ovalBand(1.0, 1.06, -0.5, false), M.shellDark);
  add(ovalWall(1.03, C.H, C.H + C.dome + 0.1, [], 96, false), M.shell);
  // lights: nav lights at the ends of the oval, strobes on the drive units
  b.sphere(0.08, 'red', [-C.A - 0.05, C.H + 0.2, 0], 8);
  b.sphere(0.08, 'green', [C.A + 0.05, C.H + 0.2, 0], 8);
  b.sphere(0.12, 'strobe', [0, C.H + C.dome + 1.5, 0], 8);
  b.sphere(0.12, 'strobe', [0, -1.7, 0], 8);
  group.add(b.build(M, { castShadow: false }));
  // the info display: a band round the core at eye height (its own mesh, its canvas from akamo.js)
  const dispGeo = new THREE.CylinderGeometry(C.coreR + 0.012, C.coreR + 0.012, 0.42, 64, 1, true, 0, Math.PI * 2);
  dispGeo.translate(0, 1.72, 0);
  const display = new THREE.Mesh(dispGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  group.add(display);
  // ---- colliders (cabin-local): the floor, the wall in panels, the core, the ceiling, the doors
  const boxes = [];
  boxes.push({ half: V(C.A + 0.2, 0.1, C.B + 0.2), pos: V(0, -0.1, 0), quat: new THREE.Quaternion() });
  boxes.push({ half: V(C.A + 0.2, 0.1, C.B + 0.2), pos: V(0, C.H + 0.25, 0), quat: new THREE.Quaternion() });
  const nW = 40;
  for (let i = 0; i < nW; i++) {
    const a0 = (i / nW) * Math.PI * 2, a1 = ((i + 1) / nW) * Math.PI * 2, am = (a0 + a1) / 2;
    if (gaps.some(([g0, g1]) => Math.abs(Math.atan2(Math.sin(am - (g0 + g1) / 2), Math.cos(am - (g0 + g1) / 2))) < (g1 - g0) / 2)) continue;
    const p0 = ovalAt(a0, 1.01), p1 = ovalAt(a1, 1.01);
    const mid = p0.clone().add(p1).multiplyScalar(0.5), len = p0.distanceTo(p1);
    const ang = Math.atan2(p1.z - p0.z, p1.x - p0.x);
    boxes.push({ half: V(len / 2 + 0.02, C.H / 2, 0.06), pos: V(mid.x, C.H / 2, mid.z), quat: new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -ang) });
  }
  boxes.push({ cyl: true, r: C.coreR, h: C.H + C.dome, pos: V(0, (C.H + C.dome) / 2, 0) });
  const doorBoxes = [1, -1].map((s) => ({ half: V(0.05, C.door.h / 2, C.door.w / 2), pos: V(s * C.A, C.door.h / 2, 0), quat: new THREE.Quaternion(), door: s }));
  return { group, doors, display, boxes, doorBoxes, M };
}

/** the doors: open 0..1 (each leaf slides back along the wall, out of the opening) */
export function setDoors(cab, open) {
  for (const d of cab.doors) {
    d.open = open;
    const k = open * open * (3 - 2 * open);
    d.leaf.position.set(d.side * CABIN.A, 0, (CABIN.door.w + 0.05) * k);
  }
}
