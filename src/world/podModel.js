// A station's escape pod, as it is drawn: a lifeboat-white hull with orange bands, a wide canopy
// over its front, the cabin inside it lit by the console and the red emergency strips, its crew
// strapped into their seats (and, from outside, seen panicking: heads snapping round, hands on the
// controls, arms flung up), nav lights, a strobe and the amber beacon, the hatch's outline, RCS
// quads and a main engine bell at the stern; some carry a twin gun on a small turret.
// Three grades: S (two seats; the fast one), M (four), L (eight; slow and long-lasting). Drawn
// three ways (high: everything; low: fewer segments and less of the cabin; LOW II: plain shapes,
// the crew as blocks), +z aft, -z forward (the nose), +y up.
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';
import { buildPerson, randomLook, BONE } from './humanModel.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const POD_GRADES = {
  // len, radius (m), rows of two seats, top speed (m/s against the station it left), acceleration
  // (m/s^2), turn (rad/s), burn time on a full battery (s), armour (hits), its name
  S: { len: 3.6, R: 0.95, rows: 1, vMax: 1200, accel: 42, turn: 2.6, burn: 110, hp: 3, name: '小型', jp: '小型ポッド' },
  M: { len: 5.0, R: 1.25, rows: 2, vMax: 800, accel: 26, turn: 1.5, burn: 210, hp: 5, name: '中型', jp: '中型ポッド' },
  L: { len: 7.0, R: 1.65, rows: 4, vMax: 400, accel: 13, turn: 0.75, burn: 380, hp: 9, name: '大型', jp: '大型ポッド' },
};

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** the pod's own markings: its number, its station's code, an orange ESCAPE bar with chevrons */
function markTex(label, station) {
  return canvasTex(256, 128, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#16181c'; g.font = 'bold 54px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(label, 8, 32);
    g.font = '600 19px sans-serif'; g.fillStyle = '#c4161c'; g.fillText(station.slice(0, 20), 10, 72);
    g.fillStyle = '#e8641e'; g.fillRect(6, 90, 244, 32);
    g.fillStyle = '#16181c'; g.font = 'bold 21px sans-serif'; g.fillText('ESCAPE', 14, 107);
    for (let i = 0; i < 5; i++) {
      const x = 112 + i * 26;
      g.beginPath(); g.moveTo(x, 94); g.lineTo(x + 12, 106); g.lineTo(x, 118); g.lineTo(x + 8, 118); g.lineTo(x + 20, 106); g.lineTo(x + 8, 94); g.closePath(); g.fill();
    }
  });
}

const MATS = new Map();
/** materials shared by every pod at a level (the per-pod ones: its markings, its lights) */
function podMats(level) {
  if (MATS.has(level)) return MATS.get(level);
  const hi = level === 'high';
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    hull: S({ color: 0xe8e6df, roughness: 0.48, metalness: 0.12 }),
    orange: S({ color: 0xe5621c, roughness: 0.5, metalness: 0.08 }),
    dark: S({ color: 0x2a2d32, roughness: 0.55, metalness: 0.5 }),
    metal: S({ color: 0xa9afb6, roughness: 0.3, metalness: 0.9 }),
    nozzle: S({ color: 0x5b524a, roughness: 0.32, metalness: 0.9, side: THREE.DoubleSide }),
    frame: S({ color: 0x3b3f45, roughness: 0.45, metalness: 0.6 }),
    // the cabin: dark lining, the floor, the seats; lit by the console and the red strips
    liner: S({ color: 0x2c3036, roughness: 0.85, metalness: 0.1, side: THREE.BackSide, emissive: new THREE.Color(0.09, 0.02, 0.02), emissiveIntensity: 1 }),
    floor: S({ color: 0x1d2024, roughness: 0.8, metalness: 0.2 }),
    seat: S({ color: 0x3a4250, roughness: 0.7, metalness: 0.1, emissive: new THREE.Color(0.05, 0.03, 0.03), emissiveIntensity: 1 }),
    console: S({ color: 0x15171b, roughness: 0.5, metalness: 0.4 }),
    screen: S({ color: 0x000000, emissive: new THREE.Color(0.3, 0.8, 1.0), emissiveIntensity: 1.6 }),
    screenR: S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.18, 0.08), emissiveIntensity: 2 }),
    strip: S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.08, 0.03), emissiveIntensity: 2.2 }),
    // the crew (lit a little by the screens and the red strips: they show through the glass)
    suit: S({ color: 0x2f4f8a, roughness: 0.75, metalness: 0, emissive: new THREE.Color(0.05, 0.04, 0.07), emissiveIntensity: 1 }),
    suit2: S({ color: 0xc8571c, roughness: 0.75, metalness: 0, emissive: new THREE.Color(0.08, 0.03, 0.02), emissiveIntensity: 1 }),
    skin: S({ color: 0xd2a07e, roughness: 0.6, metalness: 0, emissive: new THREE.Color(0.12, 0.06, 0.05), emissiveIntensity: 1 }),
    hair: S({ color: 0x1d1612, roughness: 0.85, metalness: 0 }),
    headset: S({ color: 0x151719, roughness: 0.4, metalness: 0.4 }),
    eye: S({ color: 0xeeeee8, roughness: 0.25, metalness: 0, emissive: new THREE.Color(0.08, 0.08, 0.08), emissiveIntensity: 1 }),
    mouth: S({ color: 0x3a0f0e, roughness: 0.8, metalness: 0 }),
    strap: S({ color: 0x23272d, roughness: 0.75, metalness: 0.05, emissive: new THREE.Color(0.02, 0.02, 0.025), emissiveIntensity: 1 }),
    boot: S({ color: 0x1b1c1f, roughness: 0.6, metalness: 0.1 }),
    // the canopy: tinted glass, a little reflective (the cabin shows through)
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fb4c8, roughness: 0.06, metalness: 0.05, transparent: true, opacity: hi ? 0.28 : 0.34, depthWrite: false, side: THREE.DoubleSide, clearcoat: hi ? 1 : 0, envMapIntensity: 1.2 }),
    gun: S({ color: 0x33363b, roughness: 0.42, metalness: 0.75 }),
  };
  MATS.set(level, M);
  return M;
}

/** a hull profile along the pod (lathe points [r, y], y from the stern to the nose) */
function profile(G) {
  const L = G.len, R = G.R, pts = [];
  const y0 = -L / 2, y1 = L / 2;
  // the engine skirt, the body, the nose dome (a half ellipse)
  pts.push([R * 0.55, y0], [R * 0.82, y0 + 0.1], [R * 0.97, y0 + 0.35], [R, y0 + 0.6]);
  pts.push([R, y1 - R * 1.1]);
  for (let i = 1; i <= 10; i++) { const a = i / 10 * Math.PI / 2; pts.push([R * Math.cos(a), y1 - R * 1.1 + R * 1.1 * Math.sin(a)]); }
  return pts;
}


/**
 * a strip of the hull's skin (for the markings): a patch of the cylinder of radius r round the pod's
 * axis, centred on angle phiC (0 the top, +pi/2 starboard), spanning len along it from zc and
 * phiH round it; the texture reads along the pod with its top toward the pod's top, from outside
 */
function flankGeometry(r, zc, len, phiC, phiH) {
  const nz = 8, np = 6;
  const pos = [], uv = [], nrm = [], idx = [];
  const s = Math.sign(Math.sin(phiC)) || 1;
  for (let i = 0; i <= nz; i++) for (let j = 0; j <= np; j++) {
    const u = i / nz, v = j / np;
    // (from starboard the text runs toward the nose, from port toward the stern; its top is up)
    const z = zc + (s > 0 ? 0.5 - u : u - 0.5) * len;
    const phi = phiC + s * (0.5 - v) * phiH;
    pos.push(Math.sin(phi) * r, Math.cos(phi) * r, z);
    nrm.push(Math.sin(phi), Math.cos(phi), 0);
    uv.push(u, v);
  }
  for (let i = 0; i < nz; i++) for (let j = 0; j < np; j++) {
    const a = i * (np + 1) + j, b = a + np + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // (wound to face out on either side)
  const n0 = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  a.fromArray(pos, idx[0] * 3); b.fromArray(pos, idx[1] * 3); c.fromArray(pos, idx[2] * 3);
  n0.crossVectors(b.sub(a), c.sub(a));
  if (n0.dot(new THREE.Vector3().fromArray(nrm, idx[0] * 3)) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); }
  return g;
}

/**
 * where the markings go on each flank: the longest clear stretch of it (under the canopy's flank
 * or between the bands; to port, round the hatch): [{ side, z0, z1 }]
 */
function marksLayout(zDome, zCan, frontBand, zBand2, hz) {
  const spans = [[zDome + 0.15, (frontBand ? zCan + 0.25 : zBand2) - 0.23]];
  if (frontBand) spans.push([zCan + 0.48, zBand2 - 0.23]);
  const out = [];
  for (const side of [1, -1]) {
    let best = null;
    for (const [a, b] of spans) {
      // (the hatch, to port)
      const parts = side < 0 && hz + 0.47 > a && hz - 0.47 < b ? [[a, hz - 0.47], [hz + 0.47, b]] : [[a, b]];
      for (const [z0, z1] of parts) if (z1 - z0 > 0.5 && (!best || z1 - z0 > best.z1 - best.z0)) best = { side, z0, z1 };
    }
    if (best) out.push(best);
  }
  return out;
}

const TPL = new Map();
/** the shared shape of a pod of a grade at a level (armed or not) */
function template(grade, armed, level) {
  const key = grade + (armed ? 'A' : '') + level;
  if (TPL.has(key)) return TPL.get(key);
  const G = POD_GRADES[grade], M = podMats(level);
  const hi = level === 'high', lo2 = level === 'low2';
  const seg = hi ? 40 : lo2 ? 12 : 20;
  const L = G.len, R = G.R;
  const b = new Builder();
  const prof = profile(G).map(([r, y]) => new THREE.Vector2(r, y));
  // (a lathe point (r, y) at angle phi is (r sin phi, y, r cos phi); turned so its axis runs along
  // the pod it lands at (r sin phi, r cos phi, -y): phi 0 is the top)
  const P3 = (r, y, phi, k = 1) => V(r * Math.sin(phi) * k, r * Math.cos(phi) * k, -y);
  const rot = (g) => { g.rotateX(-Math.PI / 2); return g; };
  // the canopy: the nose a glass bubble down to the floor's level (a dark chin under it), and a
  // band of glass over the top from there back over the front rows of seats (the one row of a
  // small pod, the first two of the others): the crew seen from outside, the way ahead seen from
  // the cockpit
  const yDome = L / 2 - R * 1.1;
  const zDome = -yDome, zFront = zDome + 0.1;
  const rowZ = (r) => zFront + 0.85 + r * 0.95;
  const zCan = rowZ(Math.min(G.rows, 2) - 1) + 0.42;
  const yCan0 = -zCan;
  const canPhi0 = -0.95, canPhi = 1.9;
  // (the orange band behind the canopy, the one round the engine section; the port hatch between
  // them where there is room, else under the canopy's flank)
  const zBand2 = L / 2 - 0.75;
  const frontBand = zCan + 0.25 < zBand2 - 0.4;
  const midA = zCan + 0.46, midB = zBand2 - 0.21;
  const hz = midB - midA >= 1.0 ? (midA + midB) / 2 : zCan - 0.55;
  const hh = Math.min(0.45, R * 0.4);
  const split = prof.findIndex((p) => p.y >= yCan0);
  const back = prof.slice(0, split + 1);
  back[back.length - 1] = new THREE.Vector2(back[back.length - 1].x, yCan0);
  b.add(rot(new THREE.LatheGeometry(back, seg)), 'hull');
  // (between the canopy's back edge and the nose: opaque below and round the sides, the glass band
  // over the top; the nose: glass but for its chin)
  const mid = [new THREE.Vector2(R, yCan0), new THREE.Vector2(R, yDome)];
  const dome = prof.filter((q) => q.y >= yDome - 1e-6);
  const chin = Math.acos(Math.max(-0.95, Math.min(0.2, (-R * 0.42) / R)));   // the glass's edge (from the top)
  b.add(rot(new THREE.LatheGeometry(mid, seg, canPhi0 + canPhi, Math.PI * 2 - canPhi)), 'hull');
  b.add(rot(new THREE.LatheGeometry(dome, seg, chin, Math.PI * 2 - chin * 2)), 'hull');
  const sc = (pts) => pts.map((q) => new THREE.Vector2(q.x * 1.002, q.y));
  const glassG = [rot(new THREE.LatheGeometry(sc(mid), seg, canPhi0, canPhi)), rot(new THREE.LatheGeometry(sc(dome), seg * 2, -chin, chin * 2))];
  // the orange bands, the dark engine section
  for (const z of frontBand ? [zBand2, zCan + 0.25] : [zBand2]) b.add(rot(new THREE.CylinderGeometry(R * 1.006, R * 1.006, 0.22, seg, 1, true)), 'orange', [0, 0, z]);
  b.add(rot(new THREE.CylinderGeometry(R * 0.84, R * 0.57, 0.28, seg, 1, true)), 'dark', [0, 0, L / 2 - 0.14]);
  if (!lo2) {
    // the canopy's frame: the band's two side rails and its back edge, the bubble's rim where it
    // meets the body (down each side to the chin), the chin's edges out to the nose's tip
    for (const phi of [canPhi0, canPhi0 + canPhi]) b.tube(mid.map((p) => P3(p.x, p.y, phi, 1.01)), 0.035, 'frame', { radial: 6, seg: 8 });
    const ring = [];
    for (let i = 0; i <= 16; i++) ring.push(P3(R, yCan0, canPhi0 + canPhi * i / 16, 1.01));
    b.tube(ring, 0.035, 'frame', { radial: 6, seg: 24, tension: 0 });
    for (const sgn of [-1, 1]) {
      const rim = [];
      for (let i = 0; i <= 10; i++) rim.push(P3(R, yDome, sgn * (-canPhi0 + (chin + canPhi0) * i / 10), 1.01));
      b.tube(rim, 0.035, 'frame', { radial: 6, seg: 16, tension: 0 });
      b.tube(dome.map((q) => P3(q.x, q.y, sgn * chin, 1.01)), 0.03, 'frame', { radial: 6, seg: 20 });
    }
    // (and the rim across the chin)
    const chinRim = [];
    for (let i = 0; i <= 10; i++) chinRim.push(P3(R, yDome, chin + (Math.PI * 2 - chin * 2) * i / 10, 1.01));
    b.tube(chinRim, 0.03, 'frame', { radial: 6, seg: 16, tension: 0 });
    // the side hatch's outline and its handle (port side)
    const hatch = [];
    for (let i = 0; i < 28; i++) {
      const a = i / 28 * Math.PI * 2, yy = Math.sin(a) * hh;
      const r = Math.sqrt(Math.max(0, R * R - yy * yy));
      hatch.push(V(-r * 1.006, yy, hz + Math.cos(a) * 0.42));
    }
    b.tube(hatch, 0.018, 'frame', { radial: 5, seg: 56, closed: true });
    b.box(0.03, 0.2, 0.04, 'metal', [-R * 0.995, 0, hz], null, 0.01, 1);
    // RCS quads round the stern
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      b.box(0.16, 0.16, 0.16, 'frame', [Math.cos(a) * R * 0.93, Math.sin(a) * R * 0.93, L / 2 - 0.65], [0, 0, a], 0.02, 1);
    }
  }
  const bell = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; bell.push(new THREE.Vector2(R * (0.18 + 0.2 * Math.pow(t, 0.8)), t * R * 0.5)); }
  b.add(new THREE.LatheGeometry(bell, lo2 ? 10 : 20).rotateX(Math.PI / 2), 'nozzle', [0, 0, L / 2 + 0.05]);
  // the cabin: its lining, the floor, the console under the canopy's front, the seats in rows, the
  // red emergency strips along the ceiling
  const fy = -R * 0.42;
  const cabLen = L / 2 - 0.6 - zDome;
  // (under the canopy the lining leaves the glass clear: round the sides and below only)
  const lineA = zCan - zDome, lineB = cabLen - lineA;
  b.add(rot(new THREE.CylinderGeometry(R * 0.93, R * 0.93, lineA, seg, 1, true, canPhi0 + canPhi, Math.PI * 2 - canPhi)), 'liner', [0, 0, zDome + lineA / 2]);
  b.add(rot(new THREE.CylinderGeometry(R * 0.93, R * 0.93, lineB, seg, 1, true)), 'liner', [0, 0, zCan + lineB / 2]);
  // (and the chin's, ahead of the cabin: the hull's skin is only drawn from outside)
  b.add(rot(new THREE.LatheGeometry(dome.map((q) => new THREE.Vector2(q.x * 0.95, q.y)), seg, chin, Math.PI * 2 - chin * 2)), 'liner');
  b.box(R * 1.4, 0.04, cabLen + R * 0.6, 'floor', [0, fy, zDome + cabLen / 2 - R * 0.3], null, 0, 1);
  b.box(R * 1.3, 0.35, 0.3, 'console', [0, fy + 0.55, zFront], [-0.6, 0, 0], lo2 ? 0 : 0.03, 1);
  for (const s of [-1, 1]) {
    b.box(0.32, 0.2, 0.012, 'screen', [s * R * 0.32, fy + 0.62, zFront + 0.12], [-0.6, 0, 0], 0, 1);
    if (!lo2) b.box(0.12, 0.08, 0.012, 'screenR', [s * R * 0.08, fy + 0.62, zFront + 0.11], [-0.6, 0, 0], 0, 1);
  }
  // (the strips along the walls, under the canopy's sills)
  if (!lo2) for (const s of [-1, 1]) b.box(0.03, 0.02, cabLen * 0.8, 'strip', [s * R * 0.8, R * 0.38, zDome + cabLen * 0.5], [0, 0, -s * 0.5], 0, 1);
  const seats = [];
  for (let r = 0; r < G.rows; r++) for (const s of [-1, 1]) {
    const z = rowZ(r), x = s * R * 0.33;
    b.box(0.46, 0.08, 0.46, 'seat', [x, fy + 0.42, z], null, lo2 ? 0 : 0.03, 1);
    b.box(0.46, 0.7, 0.08, 'seat', [x, fy + 0.8, z + 0.22], [0.15, 0, 0], lo2 ? 0 : 0.03, 1);
    seats.push(V(x, fy + 0.5, z));
  }
  // the gun: a turret on the back with a twin barrel
  let gunAt = null;
  if (armed) {
    const ty = R * 0.98, tz = Math.min(L / 2 - 0.5, Math.max(L / 2 - 1.2, zCan + 0.45));
    b.cyl(0.26, 0.3, 0.12, 'gun', [0, ty + 0.06, tz], null, lo2 ? 8 : 18);
    b.box(0.36, 0.22, 0.4, 'gun', [0, ty + 0.22, tz], null, lo2 ? 0 : 0.04, 1);
    for (const s of [-1, 1]) b.cyl(0.035, 0.035, 0.9, 'metal', [s * 0.08, ty + 0.24, tz - 0.62], [Math.PI / 2, 0, 0], 10);
    b.box(0.14, 0.12, 0.2, 'orange', [0.24, ty + 0.18, tz + 0.05], null, 0.02, 1);
    gunAt = V(0, ty + 0.24, tz - 1.1);
  }
  const group = b.build(M, { castShadow: hi, receiveShadow: hi });
  for (const gg of glassG) {
    const glass = new THREE.Mesh(gg, M.glass);
    glass.renderOrder = 6;
    group.add(glass);
  }
  const tpl = {
    // (the cockpit camera: between the two pilots' heads, at their eyes' height, looking out through
    // the canopy past their shoulders; turned round, it looks back down the cabin at the crew)
    group, seats, zFront, fy, gunAt, cam: V(0, seats[0].y + 0.7, seats[0].z - 0.03), exit: V(0, 0, L / 2 + 0.1), R, L,
    marks: marksLayout(zDome, zCan, frontBand, zBand2, hz),
    rcs: [0, 1, 2, 3].map((i) => { const a = Math.PI / 4 + i * Math.PI / 2; return V(Math.cos(a) * R * 1.02, Math.sin(a) * R * 1.02, L / 2 - 0.65); }),
  };
  TPL.set(key, tpl);
  return tpl;
}

/**
 * one pod: { root, crew, setLights, tick(dt, t, panic, thrust), lightsMats, cam (cockpit camera,
 * pod frame), exit (the engine's exit), dispose }
 */
export function buildPod(grade, armed, level, label, station) {
  const T = template(grade, armed, level);
  const M = podMats(level);
  const root = new THREE.Group();
  root.add(T.group.clone(true));
  // its markings on the skin of both flanks, between the orange bands (to port: aft of the hatch)
  const mark = new THREE.MeshStandardMaterial({ map: markTex(label, station), transparent: true, roughness: 0.5, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
  const G = POD_GRADES[grade];
  const geos = [];
  for (const { side: s, z0, z1 } of T.marks) {
    const len = Math.min(G.R * 1.5, (z1 - z0) * 0.94);
    const g = flankGeometry(G.R * 1.004, (z0 + z1) / 2, len, s * (Math.PI / 2 - 0.15), len / 2 / G.R);
    geos.push(g);
    const m = new THREE.Mesh(g, mark);
    m.renderOrder = 1;
    root.add(m);
  }
  // nav lights: red to port, green to starboard, the white strobe and the amber beacon on top
  const L = {
    red: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.1) }),
    green: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 3, 0.4) }),
    strobe: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 5) }),
    beacon: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.4, 0.2) }),
  };
  const lg = new THREE.SphereGeometry(0.06, 8, 6);
  geos.push(lg);
  const nav = (mat, p) => { const m = new THREE.Mesh(lg, mat); m.position.copy(p); root.add(m); return m; };
  nav(L.red, V(-G.R * 1.0, 0, G.len / 2 - 1.0));
  nav(L.green, V(G.R * 1.0, 0, G.len / 2 - 1.0));
  const strobe = nav(L.strobe, V(0, G.R * 1.0, -0.2));
  const beacon = nav(L.beacon, V(0, -G.R * 1.0, 0.4));
  // the crew in their seats (the front two at the controls): real people (humanModel.js), each made
  // the first time the pod is near enough to be seen into
  const crew = [];
  const seed0 = Math.floor(Math.random() * 1e6);
  T.seats.forEach((p, i) => {
    const holder = new THREE.Group();
    holder.position.copy(p);
    root.add(holder);
    crew.push({ root: holder, person: null, seed: seed0 + i * 7919, k: i, ph: Math.random() * 10, pilot: i < 2, seat: p });
  });
  const ph0 = Math.random() * 10;
  const api = {
    root, crew, grade, armed, T, cam: T.cam, exit: T.exit, gunAt: T.gunAt, rcs: T.rcs, L, strobe, beacon,
    /** the strobe's flash this moment (for the far glow): 0 or 1 */
    strobeOn(t) { return (t * 1.1 + ph0) % 1 < 0.06 ? 1 : 0; },
    /**
     * per drawn frame: panic 0 (calm) .. 1 (terrified), thrust (pod frame acceleration, m/s^2,
     * for the crew to sway with), dead (no power: lights out, the crew still), crewToo: the crew
     * is seen (otherwise the lights only)
     */
    tick(dt, t, panic, accel, dead = false, crewToo = true) {
      L.strobe.color.setScalar(!dead && api.strobeOn(t) ? 6 : 0.0);
      L.beacon.color.setRGB(3, 1.4, 0.2).multiplyScalar(dead ? 0 : 0.2 + 0.8 * Math.max(0, Math.sin(t * 6.5 + ph0)) ** 4);
      L.red.color.setRGB(dead ? 0 : 3, dead ? 0 : 0.2, dead ? 0 : 0.1);
      L.green.color.setRGB(dead ? 0 : 0.2, dead ? 0 : 3, dead ? 0 : 0.4);
      if (!crewToo) return;
      // the crew (facing -z): pressed back into their seats by the push (thrown sideways by a turn
      // of it), heads snapping round, the pilots fighting the controls. (A joint's +x turn swings
      // a hanging limb forward; a torso's +x leans it back; +z swings a left arm in, a right out.)
      const ax = accel ? accel.x : 0, az = accel ? accel.z : 0;
      const Rl = T.R * 0.93;
      for (const c of crew) {
        if (!c.person) {
          // (as tall as the cabin allows over that seat: the liner's height there, the head's room)
          c.person = buildPerson(randomLook(c.seed, 'pod'));
          // (the cabin has no lamp: the screens' and strips' glow on them)
          c.person.root.traverse((o) => {
            if (!o.isMesh) return;
            const lit = (m) => { if (!m || !m.emissive) return m; const q = m.clone(); q.emissive.copy(q.color).multiplyScalar(0.32); q.emissiveIntensity = 1; (c.mats || (c.mats = [])).push(q); return q; };
            o.material = Array.isArray(o.material) ? o.material.map(lit) : lit(o.material);
          });
          const room = Math.sqrt(Math.max(0.05, Rl * Rl - c.seat.x * c.seat.x)) - c.seat.y - 0.05;
          const k = Math.min(c.person.k, room / 0.86);
          c.person.root.scale.setScalar(k);
          c.person.root.position.set(0, -0.95 * k, 0.03);
          c.root.add(c.person.root);
        }
        const p = c.ph + t * (1 + panic * 1.6);
        const n = (a, b) => Math.sin(p * a + b) * 0.6 + Math.sin(p * a * 1.7 + b * 2.3) * 0.4;
        const P = c.pose || (c.pose = { mode: 'sit' });
        // pressed back into the seat by the push (thrown sideways by a turn of it), heads turning
        // round, the pilots at the controls; slumped once the pod is dead
        const back = -0.05 + Math.max(-0.3, Math.min(0.45, -az * 0.012)) + panic * 0.08 * n(1.3, c.k);
        P.lean = dead ? 0.35 : -back;
        P.tilt = dead ? 0.15 * Math.sin(c.k * 2.1) : Math.max(-0.3, Math.min(0.3, ax * 0.01)) + panic * 0.06 * n(0.9, c.k + 1);
        P.lookYaw = dead ? 0.4 * Math.sin(c.k * 1.7) : panic * 0.75 * n(2.1, c.k * 3) + (c.pilot ? 0 : 0.2 * Math.sin(p * 0.4));
        P.lookPitch = dead ? -0.6 : -0.05 + panic * 0.2 * n(1.7, c.k + 4);
        P.reach = c.pilot && !dead ? 0.8 + 0.12 * panic * n(3.1, 1) : 0;
        c.person.pose(P, t);
        const b = c.person.bones;
        if (c.pilot && !dead) {
          // hands out on the console, jerking at it
          b[BONE.shoulderR].rotation.x += 0.15 * panic * n(2.7, 3);
          b[BONE.shoulderL].rotation.x += 0.15 * panic * n(3.1, 1);
          b[BONE.elbowR].rotation.x += 0.2 * panic * n(3.9, 4);
          b[BONE.elbowL].rotation.x += 0.2 * panic * n(4.3, 2);
        } else if (!dead) {
          // passengers: hands clutching the harness at the chest, now and then an arm flung up
          const fling = panic > 0.4 ? Math.max(0, Math.sin(p * 0.7 + c.k)) ** 6 : 0;
          const fL = fling * (c.k % 2 ? 1 : 0.3), fR = fling * (c.k % 2 ? 0.3 : 1);
          b[BONE.shoulderR].rotation.x = 0.55 + 2.1 * fR + 0.12 * panic * n(2.9, 6);
          b[BONE.shoulderL].rotation.x = 0.55 + 2.1 * fL + 0.12 * panic * n(2.3, 5);
          b[BONE.elbowR].rotation.x = 2.0 * (1 - fR) + 0.2 * panic * n(3.7, 8);
          b[BONE.elbowL].rotation.x = 2.0 * (1 - fL) + 0.2 * panic * n(3.3, 7);
          b[BONE.shoulderR].rotation.z = -0.25 + 0.5 * fR; b[BONE.shoulderL].rotation.z = 0.25 - 0.5 * fL;
        }
      }
    },
    /** broken open by a hit: the canopy gone, the cabin dark and empty, the lights out */
    wreck() {
      root.traverse((o) => { if (o.isMesh && (o.material === M.glass || o.name === 'screen' || o.name === 'screenR' || o.name === 'strip')) o.visible = false; });
      for (const c of crew) c.root.visible = false;
      api.wrecked = true;
      api.tick(0, 0, 0, null, true, false);
    },
    dispose() {
      for (const c of crew) { if (c.person) { c.person.dispose(); c.person = null; } if (c.mats) { for (const m of c.mats) m.dispose(); c.mats = null; } }
      root.parent && root.parent.remove(root);
      mark.map.dispose(); mark.dispose();
      for (const m of Object.values(L)) m.dispose();
      for (const g of geos) g.dispose();
    },
  };
  return api;
}
