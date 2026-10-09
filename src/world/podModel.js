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

const CREW = new Map();
/** one seated crew member: { root, torso, head, armL, armR, foreL, foreR } (+z behind them); the
 * four looks (suit colour, headset) are built once per level and copied (their shapes shared) */
function crewMember(M, level, k) {
  const key = `${level}:${k % 3 === 2 ? 1 : 0}:${k % 2 === 0 ? 1 : 0}`;
  if (!CREW.has(key)) CREW.set(key, crewShape(M, level, k).root);
  const root = CREW.get(key).clone(true);
  const by = (n) => root.getObjectByName(n);
  return { root, torso: by('torso'), head: by('head'), armL: by('armL'), armR: by('armR'), foreL: by('foreL'), foreR: by('foreR'), k, ph: Math.random() * 10, pilot: false };
}

function crewShape(M, level, k) {
  const lo2 = level === 'low2';
  if (!lo2) return crewShapeFull(M, level, k);
  const suit = k % 3 === 2 ? 'suit2' : 'suit';
  const root = new THREE.Group();
  const mk = (b) => { const g = b.build(M, { castShadow: false, receiveShadow: false }); return g; };
  // the seat's frame: hips at the origin, thighs forward (-z), shins down
  const legs = new Builder();
  legs.box(0.36, 0.14, 0.44, suit, [0, 0, -0.2], null, lo2 ? 0 : 0.05, 1);
  legs.box(0.3, 0.42, 0.13, suit, [0, -0.22, -0.42], null, lo2 ? 0 : 0.05, 1);
  root.add(mk(legs));
  const torso = new THREE.Group(); torso.name = 'torso'; root.add(torso);
  const tb = new Builder();
  tb.box(0.38, 0.5, 0.22, suit, [0, 0.27, 0.0], null, lo2 ? 0 : 0.08, lo2 ? 1 : 2);
  if (!lo2) tb.box(0.3, 0.06, 0.02, 'strip', [0, 0.42, -0.115], null, 0, 1);      // a reflective band
  torso.add(mk(tb));
  const head = new THREE.Group(); head.name = 'head'; head.position.y = 0.56; torso.add(head);
  const hb = new Builder();
  hb.sphere(1, 'skin', [0, 0.11, 0], lo2 ? 8 : 14, [0.095, 0.115, 0.105]);
  if (!lo2) {
    hb.add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, 1.6), 'hair', [0, 0.125, 0.01], [-0.25, 0, 0], [0.1, 0.11, 0.11]);
    if (k % 2 === 0) { hb.torus(0.105, 0.012, 'headset', [0, 0.14, 0], [0, 0, Math.PI / 2], 16, Math.PI); hb.cyl(0.03, 0.03, 0.03, 'headset', [0.1, 0.1, 0], [0, 0, Math.PI / 2], 10); }
    hb.box(0.04, 0.012, 0.01, 'hair', [-0.035, 0.14, -0.095], null, 0, 1);
    hb.box(0.04, 0.012, 0.01, 'hair', [0.035, 0.14, -0.095], null, 0, 1);
  }
  head.add(mk(hb));
  const arms = {};
  for (const s of [-1, 1]) {
    const k2 = s < 0 ? 'L' : 'R';
    const sh = new THREE.Group(); sh.name = 'arm' + k2; sh.position.set(s * 0.23, 0.48, 0); torso.add(sh);
    const ub = new Builder();
    ub.box(0.1, 0.3, 0.1, suit, [0, -0.15, 0], null, lo2 ? 0 : 0.04, 1);
    sh.add(mk(ub));
    const fo = new THREE.Group(); fo.name = 'fore' + k2; fo.position.y = -0.3; sh.add(fo);
    const fb = new Builder();
    fb.box(0.085, 0.27, 0.085, suit, [0, -0.135, 0], null, lo2 ? 0 : 0.035, 1);
    fb.sphere(0.05, 'skin', [0, -0.29, 0], lo2 ? 6 : 10);
    fo.add(mk(fb));
    arms[k2] = { sh, fo };
  }
  return { root };
}

/** a capsule from a to b (radius r) into a builder */
function capsule(b, a, c, r, key, seg = 10) {
  const A = V(...a), B = V(...c), d = B.clone().sub(A);
  const g = new THREE.CapsuleGeometry(r, Math.max(1e-3, d.length()), 3, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().lerp(B, 0.5), q, V(1, 1, 1)));
  b.add(g, key);
}

/**
 * a crew member as seen close up (a stolen pod's camera turned round to them, or through the glass
 * from near by): a flight suit with its collar and the seat's harness over it, rounded limbs,
 * hands, boots; a face — eyes wide, brows up, the mouth open — ears, hair, and on some a headset
 * with its boom mic. Same joints as the plain one: hips at the origin, the torso, the head, each
 * arm's shoulder and elbow (+z behind them)
 */
function crewShapeFull(M, level, k) {
  const lo = level !== 'high';
  const suit = k % 3 === 2 ? 'suit2' : 'suit';
  const sg = lo ? 7 : 12;
  const root = new THREE.Group();
  const mk = (b) => b.build(M, { castShadow: false, receiveShadow: false });
  // legs: thighs forward along the seat, shins down, boots
  const legs = new Builder();
  for (const s of [-1, 1]) {
    const x = s * 0.095;
    capsule(legs, [x, 0.0, -0.02], [x, 0.01, -0.4], 0.078, suit, sg);
    capsule(legs, [x, 0.0, -0.42], [x, -0.36, -0.45], 0.06, suit, sg);
    legs.box(0.1, 0.085, 0.21, 'boot', [x, -0.43, -0.5], null, 0.03, 2);
  }
  // (the lap belt across the hips)
  legs.box(0.36, 0.05, 0.03, 'strap', [0, 0.06, -0.1], null, 0.01, 1);
  root.add(mk(legs));
  const torso = new THREE.Group(); torso.name = 'torso'; root.add(torso);
  const tb = new Builder();
  tb.push([0, 0, 0], [0, 0, 0], [1, 1, 0.64]);
  tb.lathe([[0.0, 0.0], [0.15, 0.01], [0.168, 0.1], [0.182, 0.26], [0.192, 0.4], [0.17, 0.48], [0.11, 0.53], [0.0, 0.545]], suit, [0, 0, 0], null, lo ? 12 : 20);
  tb.pop();
  // the collar, the reflective band, the harness's shoulder straps down to its buckle
  tb.torus(0.058, 0.016, suit, [0, 0.53, 0], [Math.PI / 2, 0, 0], 14);
  tb.box(0.3, 0.045, 0.02, 'strip', [0, 0.42, -0.118], null, 0, 1);
  for (const s of [-1, 1]) tb.tube([V(s * 0.1, 0.52, 0.06), V(s * 0.1, 0.5, -0.09), V(s * 0.075, 0.36, -0.125), V(s * 0.02, 0.17, -0.13)], 0.017, 'strap', { radial: 5, seg: 10 });
  tb.cyl(0.036, 0.036, 0.014, 'metal', [0, 0.16, -0.132], [Math.PI / 2, 0, 0], 14);
  tb.cyl(0.042, 0.048, 0.08, 'skin', [0, 0.56, 0], null, 10);
  torso.add(mk(tb));
  const head = new THREE.Group(); head.name = 'head'; head.position.y = 0.56; torso.add(head);
  const hb = new Builder();
  hb.sphere(1, 'skin', [0, 0.11, 0], lo ? 12 : 18, [0.09, 0.112, 0.102]);
  hb.add(new THREE.SphereGeometry(1, lo ? 10 : 16, 8, 0, Math.PI * 2, 0, 1.55), 'hair', [0, 0.126, 0.012], [-0.3, 0, 0], [0.096, 0.108, 0.106]);
  for (const s of [-1, 1]) {
    hb.sphere(0.024, 'skin', [s * 0.088, 0.105, 0.006], 8, [0.45, 1, 0.75]);                    // ears
    hb.sphere(0.0145, 'eye', [s * 0.033, 0.127, -0.087], 10);                                    // eyes, wide
    hb.sphere(0.0072, 'hair', [s * 0.033, 0.127, -0.1005], 8);
    hb.box(0.036, 0.009, 0.01, 'hair', [s * 0.035, 0.153, -0.094], [0, 0, s * 0.28], 0, 1);      // brows up
  }
  hb.sphere(0.017, 'skin', [0, 0.1, -0.103], 8, [0.75, 1, 1.15]);                                 // nose
  hb.sphere(0.021, 'mouth', [0, 0.062, -0.091], 10, [1.15, 0.85, 0.45]);                          // open
  if (k % 2 === 0) {
    hb.torus(0.103, 0.011, 'headset', [0, 0.13, 0.0], [0, 0, Math.PI / 2], 16, Math.PI);
    for (const s of [-1, 1]) hb.cyl(0.032, 0.032, 0.03, 'headset', [s * 0.1, 0.1, 0], [0, 0, Math.PI / 2], 12);
    hb.tube([V(0.11, 0.09, -0.01), V(0.095, 0.06, -0.07), V(0.035, 0.055, -0.105)], 0.005, 'headset', { radial: 4, seg: 8 });
    hb.sphere(0.011, 'headset', [0.03, 0.055, -0.106], 6);
  }
  head.add(mk(hb));
  for (const s of [-1, 1]) {
    const k2 = s < 0 ? 'L' : 'R';
    const sh = new THREE.Group(); sh.name = 'arm' + k2; sh.position.set(s * 0.2, 0.47, 0); torso.add(sh);
    const ub = new Builder();
    capsule(ub, [0, 0.0, 0], [0, -0.27, 0], 0.055, suit, sg);
    sh.add(mk(ub));
    const fo = new THREE.Group(); fo.name = 'fore' + k2; fo.position.y = -0.29; sh.add(fo);
    const fb = new Builder();
    capsule(fb, [0, 0.0, 0], [0, -0.23, 0], 0.046, suit, sg);
    fb.sphere(0.042, 'skin', [0, -0.3, 0], 10, [0.85, 1.25, 0.62]);
    fb.box(0.03, 0.06, 0.03, 'skin', [s * -0.035, -0.29, -0.02], [0, 0, s * 0.5], 0.012, 1);      // thumb
    fo.add(mk(fb));
  }
  return { root };
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
    // (the cockpit camera: on top of the console, between the pilots' hands, looking out through
    // the canopy; turned round, it looks back at the crew)
    group, seats, zFront, fy, gunAt, cam: V(0, fy + 0.92, zFront - 0.02), exit: V(0, 0, L / 2 + 0.1), R, L,
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
  // the crew in their seats (the front two at the controls)
  const crew = [];
  T.seats.forEach((p, i) => {
    const c = crewMember(M, level, i);
    c.root.position.copy(p);
    c.pilot = i < 2;
    root.add(c.root);
    crew.push(c);
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
      for (const c of crew) {
        const p = c.ph + t * (1 + panic * 1.8);
        const n = (a, b) => Math.sin(p * a + b) * 0.6 + Math.sin(p * a * 1.7 + b * 2.3) * 0.4;
        c.torso.rotation.x = -0.1 + Math.max(-0.3, Math.min(0.45, -az * 0.012)) + panic * 0.12 * n(1.3, c.k);
        c.torso.rotation.z = Math.max(-0.35, Math.min(0.35, ax * 0.01)) + panic * 0.1 * n(0.9, c.k + 1);
        c.head.rotation.y = panic * 0.85 * n(2.1, c.k * 3) + (c.pilot ? 0 : 0.2 * Math.sin(p * 0.4));
        c.head.rotation.x = -0.08 + panic * 0.3 * n(1.7, c.k + 4);
        if (c.pilot && !dead) {
          // hands out on the console, jerking at it
          c.armL.rotation.x = 1.0 + 0.22 * panic * n(3.1, 1); c.foreL.rotation.x = 0.35 + 0.3 * panic * n(4.3, 2);
          c.armR.rotation.x = 0.95 + 0.22 * panic * n(2.7, 3); c.foreR.rotation.x = 0.4 + 0.3 * panic * n(3.9, 4);
          c.armL.rotation.z = 0.12; c.armR.rotation.z = -0.12;
        } else {
          // passengers: hands clutching the harness at their chests, now and then an arm flung up
          const fling = panic > 0.4 ? Math.max(0, Math.sin(p * 0.7 + c.k)) ** 6 : 0;
          const fL = fling * (c.k % 2 ? 1 : 0.3), fR = fling * (c.k % 2 ? 0.3 : 1);
          c.armL.rotation.x = 0.05 + 2.6 * fL + 0.15 * panic * n(2.3, 5);
          c.armR.rotation.x = 0.05 + 2.6 * fR + 0.15 * panic * n(2.9, 6);
          c.foreL.rotation.x = 2.15 * (1 - fL) + 0.25 * panic * n(3.3, 7); c.foreR.rotation.x = 2.15 * (1 - fR) + 0.25 * panic * n(3.7, 8);
          c.armL.rotation.z = 0.32 - 0.6 * fL; c.armR.rotation.z = -0.32 + 0.6 * fR;
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
      root.parent && root.parent.remove(root);
      mark.map.dispose(); mark.dispose();
      for (const m of Object.values(L)) m.dispose();
      for (const g of geos) g.dispose();
    },
  };
  return api;
}
