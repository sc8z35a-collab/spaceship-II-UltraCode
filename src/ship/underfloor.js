// The pipe layer under the main deck: a cramped maze of insulated pipes, ducts, cable trays,
// tanks, pumps and isolation valves. Pipe runs are split into damageable segments.
import * as THREE from 'three';
import { rng } from './geom.js';
import { heightRangeAt, halfWidthAt, DECK_Y, LOWER_Y } from './hullShape.js';
import { INSET, LIFT, ENG_HATCH } from './interior.js';
import { valveWheel, gauge, cableBundle, sticker } from './props.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const PIPE_SYSTEMS = {
  coolant: { name: '冷却材', key: 'pipeOrange', r: 0.065, leak: 'steam' },
  water: { name: '水', key: 'pipeBlue', r: 0.04, leak: 'water' },
  air: { name: '空調ダクト', key: 'insul', r: 0.13, leak: 'mist' },
  o2: { name: '酸素', key: 'pipeGreen', r: 0.026, leak: 'mist' },
  n2: { name: '窒素', key: 'pipeYellow', r: 0.026, leak: 'mist' },
  rcs: { name: '推進剤', key: 'pipeRed', r: 0.03, leak: 'steam' },
  waste: { name: '排水', key: 'pipeWhite', r: 0.045, leak: 'water' },
};

export function buildUnderfloor(b, L) {
  const R = rng(909);
  const zA = -8.6, zB = 9.3;
  // ---- central walkway (grating) at LOWER_Y, plus branches
  const walk = [[-0.45, 0.45, zA, zB], [0.45, LIFT.x1, LIFT.z0 - 0.1, LIFT.z1 + 0.1], [ENG_HATCH.x0 - 0.1, -0.45, ENG_HATCH.z0 - 0.2, ENG_HATCH.z1 + 0.2], [-1.4, -0.45, -5.0, -4.2], [0.45, 1.4, 5.6, 6.4]];
  for (const [x0, x1, z0, z1] of walk) {
    const w = x1 - x0, d = z1 - z0;
    b.add(new THREE.PlaneGeometry(w, d), 'grate', [(x0 + x1) / 2, LOWER_Y, (z0 + z1) / 2], [-Math.PI / 2, 0, 0]);
    for (const x of [x0, x1]) b.box(0.04, 0.05, d, 'frame', [x, LOWER_Y - 0.02, (z0 + z1) / 2], null, 0.004);
    b.colBox(w, 0.04, d, [(x0 + x1) / 2, LOWER_Y - 0.02, (z0 + z1) / 2]);
  }
  // walkway supports down to the hull
  for (let z = zA + 0.5; z < zB; z += 1.2) {
    const [bot] = heightRangeAt(z, 0, INSET);
    for (const x of [-0.4, 0.4]) b.pipe([x, bot + 0.05, z], [x, LOWER_Y - 0.02, z], 0.02, 'metalDark', 6);
  }
  // handrails on the walkway sides at hip height
  for (const x of [-0.42, 0.42]) {
    for (let z = zA + 0.6; z < zB - 0.6; z += 3.6) {
      if (x > 0 && z > LIFT.z0 - 1 && z < LIFT.z1 + 1) continue;
      b.pipe([x, LOWER_Y + 0.75, z], [x, LOWER_Y + 0.75, Math.min(z + 3.0, zB - 0.4)], 0.016, 'handrail', 6);
    }
  }
  L.rails = L.rails || [];
  // ---- pipe runs
  const runs = [
    { sys: 'coolant', pts: [V(1.1, -0.55, zA + 0.2), V(1.1, -0.55, 4.0), V(1.0, -0.8, 5.2), V(0.9, -1.1, 6.0), V(0.9, -1.1, zB)] },
    { sys: 'coolant', pts: [V(1.32, -0.62, zA + 0.2), V(1.32, -0.62, 4.0), V(1.25, -0.95, 5.2), V(1.15, -1.25, 6.0), V(1.15, -1.25, zB)] },
    { sys: 'air', pts: [V(0.75, -0.36, zA), V(0.75, -0.36, -2.0), V(0.95, -0.38, 0.0), V(0.75, -0.36, 2.5), V(0.75, -0.36, 5.4)] },
    { sys: 'water', pts: [V(-0.78, -0.32, -7.6), V(-0.78, -0.32, 6.0)] },
    { sys: 'waste', pts: [V(-0.95, -0.95, -7.8), V(-0.95, -1.0, -2.0), V(-0.9, -1.05, 4.5)] },
    { sys: 'o2', pts: [V(-1.35, -0.72, -7.8), V(-1.35, -0.72, 4.2)] },
    { sys: 'n2', pts: [V(-1.48, -0.86, -7.8), V(-1.48, -0.86, 4.2)] },
    { sys: 'rcs', pts: [V(1.55, -0.9, -9.4), V(1.55, -0.9, -4.6), V(1.7, -1.05, -2.0), V(1.55, -0.9, 9.2)] },
    { sys: 'rcs', pts: [V(-1.62, -1.02, -9.4), V(-1.62, -1.02, 9.2)] },
  ];
  // risers through the deck (to galley, bath, LS, cockpit)
  const risers = [
    { sys: 'water', pts: [V(-0.78, -0.32, -3.3), V(-1.6, -0.2, -3.3), V(-1.6, DECK_Y + 0.4, -3.3)] },
    { sys: 'water', pts: [V(-0.78, -0.32, -6.7), V(1.6, -0.25, -6.7), V(2.2, -0.15, -6.7), V(2.25, DECK_Y + 0.35, -6.7)] },
    { sys: 'o2', pts: [V(-1.35, -0.72, 3.2), V(1.9, -0.3, 3.2), V(2.3, -0.12, 3.0), V(2.3, DECK_Y + 0.22, 3.0)] },
    { sys: 'coolant', pts: [V(1.1, -0.55, -9.0), V(0.75, -0.32, -9.7), V(0.45, -0.3, -10.6), V(0.2, -0.3, -11.2)] },
    { sys: 'air', pts: [V(0.75, -0.36, -6.5), V(0.4, -0.2, -6.5)] },
  ];
  const segs = [];
  let segId = 0;
  for (const run of [...runs, ...risers]) {
    const S = PIPE_SYSTEMS[run.sys];
    const curve = new THREE.CatmullRomCurve3(run.pts, false, 'catmullrom', 0.2);
    const len = curve.getLength();
    b.add(new THREE.TubeGeometry(curve, Math.max(8, Math.ceil(len / 0.1)), S.r, run.sys === 'air' ? 14 : 10, false), S.key);
    // flanges / clamps every ~0.9 m
    const nC = Math.floor(len / 0.9);
    for (let i = 1; i < nC; i++) {
      const t = i / nC;
      const p = curve.getPointAt(t), tg = curve.getTangentAt(t);
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), tg);
      const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      b.cyl(S.r * 1.25, S.r * 1.25, 0.03, run.sys === 'air' ? 'metal' : 'steel', p.toArray(), [e.x, e.y, e.z], 12);
    }
    // collision: capsules along the run
    const nCap = Math.max(1, Math.ceil(len / 0.6));
    for (let i = 0; i < nCap; i++) b.colCapsuleAB(curve.getPointAt(i / nCap), curve.getPointAt((i + 1) / nCap), S.r);
    // damage segments ~1.1 m
    const nS = Math.max(1, Math.round(len / 1.1));
    for (let i = 0; i < nS; i++) {
      const a = curve.getPointAt(i / nS), c = curve.getPointAt((i + 1) / nS);
      segs.push({ id: segId++, sys: run.sys, a, b: c, mid: a.clone().lerp(c, 0.5), r: S.r, leak: 0, patched: false, curve, t0: i / nS, t1: (i + 1) / nS });
    }
  }
  L.pipes.push(...segs);
  // ---- cable trays under the deck
  for (const x of [-0.5, 0.5]) {
    b.box(0.22, 0.03, zB - zA, 'metalDark', [x, -0.28, (zA + zB) / 2], null, 0.005);
    cableBundle(b, [[x - 0.05, -0.25, zA], [x - 0.04, -0.26, -2], [x - 0.06, -0.25, 3], [x - 0.05, -0.25, zB]], 5, 0.02);
  }
  // ---- tanks
  const tanks = [];
  for (const [z0, z1, key, name] of [[-6.2, -3.6, 'pipeGreen', 'O2'], [-2.6, 0.2, 'pipeYellow', 'N2']]) {
    const zc = (z0 + z1) / 2, len = z1 - z0;
    b.cyl(0.3, 0.3, len - 0.3, 'steel', [-1.75, -1.25, zc], [Math.PI / 2, 0, 0], 24);
    b.sphere(0.3, 'steel', [-1.75, -1.25, z0 + 0.15], 20, [1, 1, 0.5]);
    b.sphere(0.3, 'steel', [-1.75, -1.25, z1 - 0.15], 20, [1, 1, 0.5]);
    b.torus(0.305, 0.025, key, [-1.75, -1.25, zc], [0, 0, 0], 24);
    for (const z of [z0 + 0.4, z1 - 0.4]) b.box(0.7, 0.06, 0.08, 'metalDark', [-1.75, -1.57, z], null, 0.01);
    gauge(b, [-1.42, -1.05, zc], [0, Math.PI / 2, 0], 0.04);
    sticker(b, [-1.44, -1.25, zc + 0.3], [0, Math.PI / 2, 0], 0.12, 0.06);
    b.colCyl(0.3, len, [-1.75, -1.25, zc], [Math.PI / 2, 0, 0]);
    tanks.push({ name, pos: V(-1.75, -1.25, zc) });
  }
  // water bladder (starboard)
  b.box(0.75, 0.42, 2.2, 'pipeBlue', [1.7, -1.32, -5.0], null, 0.18, 3, true);
  b.box(0.8, 0.04, 2.3, 'cargo' in b ? 'fabric' : 'rubber', [1.7, -1.1, -5.0], null, 0.01);
  // coolant pumps (with fan motors, animated elsewhere)
  L.spots.pumps = [];
  for (const z of [5.8, 6.9]) {
    b.cyl(0.16, 0.16, 0.36, 'pipeOrange', [1.55, -1.25, z], [0, 0, Math.PI / 2], 18);
    b.cyl(0.13, 0.13, 0.3, 'metalDark', [1.25, -1.25, z], [0, 0, Math.PI / 2], 18);
    b.box(0.5, 0.06, 0.4, 'metalDark', [1.45, -1.45, z], null, 0.01);
    L.spots.pumps.push(V(1.08, -1.25, z));
    b.colBox(0.6, 0.4, 0.45, [1.45, -1.25, z]);
  }
  // heat exchanger
  b.box(0.6, 0.55, 1.0, 'panel', [1.75, -1.1, 2.0], null, 0.03, 2, true);
  for (let i = 0; i < 8; i++) b.box(0.62, 0.02, 0.02, 'metal', [1.75, -0.95 - i * 0.05, 2.0], null, 0);
  // filters
  for (const z of [-1.0, 1.0]) b.cyl(0.1, 0.1, 0.45, 'plasticW', [1.15, -1.25, z], null, 14);
  // isolation valves on main runs (interactive)
  L.valves = [];
  const valvePos = [
    ['coolant', V(1.1, -0.42, -4.0)], ['coolant', V(1.1, -0.42, 2.4)],
    ['water', V(-0.78, -0.2, -5.0)], ['water', V(-0.78, -0.2, 1.5)],
    ['o2', V(-1.35, -0.58, -2.0)], ['n2', V(-1.48, -0.7, 1.0)], ['rcs', V(1.55, -0.76, 0.5)],
  ];
  for (const [sys, p] of valvePos) {
    const key = PIPE_SYSTEMS[sys].key === 'insul' ? 'pipeRed' : 'pipeRed';
    valveWheel(b, p.toArray(), [-Math.PI / 2, 0, 0], 0.075, key);
    b.pipe([p.x, p.y - 0.02, p.z], [p.x, p.y - 0.14, p.z], 0.015, 'steel', 6);
    L.valves.push({ sys, pos: p, open: true });
  }
  // caged lamps along the walkway
  for (let z = -7.6; z < 9; z += 2.6) {
    const p = V(0, -0.24, z);
    b.cyl(0.05, 0.05, 0.06, 'lampWarm', p.toArray(), null, 10);
    b.torus(0.055, 0.006, 'metalDark', [p.x, p.y - 0.01, p.z], [Math.PI / 2, 0, 0], 12);
    L.lamps.push({ pos: p.clone().add(V(0, -0.1, 0)), color: 0xffb36b, intensity: 2.6, room: 'under' });
  }
  // junction boxes & labels
  for (let z = -7; z < 8; z += 3.1) {
    b.box(0.25, 0.2, 0.12, 'panelDark', [0.32, -0.42, z], null, 0.01);
    b.box(0.03, 0.03, 0.01, R() > 0.5 ? 'ledGreen' : 'ledAmber', [0.32, -0.36, z + 0.065], null, 0);
  }
  return { segs };
}
