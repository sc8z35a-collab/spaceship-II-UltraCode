// K3: H8's little repair robots, as they are drawn. A cube 40 cm on a side (+x its right, +y up,
// the camera on the -z face, like everything else in the game), built three ways:
//  - high: a dark core under six raised white composite panels (a fine grain in their clear coat,
//    seams round them), gunmetal guards along the twelve edges with red inlays on the upright
//    ones, anodized corner blocks each carrying three thruster bells (heat-tinted, 24 in all); the
//    camera: a housing with a knurled focus ring, a coated front element (its coating shows violet
//    and green at an angle) over the iris and the sensor, an LED ring round it, a lidar window and an
//    infrared eye beside it, status lights under it; arms left, right and below — turret, shoulder
//    fork of two machined plates with lightening slots and an actuator on its side, an orange cable
//    harness, an elbow with red caps, a white forearm that folds into the fork, a wrist ring, then a
//    three-fingered gripper (two jointed segments a finger, rubber pads) or, below, the tool head
//    (weld tip, work lamp, a small clamp); a beacon, a whip antenna and a grab handle on top; the
//    charging plate with its gold contacts, the latch socket and cooling fins on the back; its
//    number, the red hexagon and handling marks;
//  - low: the same shapes, plain materials, no slots, bolts, harness, knurling or finger pads;
//  - LOW II: a box with its guards and corner blocks in one piece, the camera, arms of two links and
//    a claw (it still moves the same way).
// Thruster puffs from the bells (one instanced draw), the LED ring and lights, the weld tip's glow.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Builder } from '../ship/geom.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const K3_SIZE = 0.4;
const H = K3_SIZE / 2;
// the arms' links (m)
export const K3_ARM = { turret: 0.036, L1: 0.165, L2: 0.15, wrist: 0.024 };

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

// ------------------------------------------------------------------ textures (shared)
let GRAIN = null;
/** the panels' composite grain under their clear coat, as a normal map */
function grainNormal() {
  if (GRAIN) return GRAIN;
  const N = 256;
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const hgt = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) hgt[i] = rnd();
  // blur a little: a soft orange-peel, not static
  const b = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let a = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) a += hgt[((y + dy + N) % N) * N + ((x + dx + N) % N)];
    b[y * N + x] = a / 9;
  }
  const c = canvas(N, N, (g) => {
    const img = g.createImageData(N, N), d = img.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = b[y * N + (x + 1) % N] - b[y * N + (x - 1 + N) % N];
      const dy = b[((y + 1) % N) * N + x] - b[((y - 1 + N) % N) * N + x];
      const nx = -dx * 1.6, ny = -dy * 1.6, nz = 1, l = Math.hypot(nx, ny, nz), i = (y * N + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (nz / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  GRAIN = new THREE.CanvasTexture(c);
  GRAIN.wrapS = GRAIN.wrapT = THREE.RepeatWrapping;
  GRAIN.repeat.set(3, 3);
  GRAIN.anisotropy = 4;
  return GRAIN;
}

let IRIS = null;
/** behind the front element: the iris's seven blades round a dark aperture, the sensor's glint */
function irisTexture() {
  if (IRIS) return IRIS;
  const N = 256;
  const c = canvas(N, N, (g) => {
    const cx = N / 2;
    g.fillStyle = '#050608'; g.fillRect(0, 0, N, N);
    // the barrel's inner baffles: dark rings
    for (let r = 124; r > 70; r -= 9) { g.strokeStyle = r % 2 ? '#14171c' : '#0b0d10'; g.lineWidth = 4; g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.stroke(); }
    // the blades
    const ap = 46;
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      g.save(); g.translate(cx, cx); g.rotate(a);
      const grd = g.createLinearGradient(0, ap, 0, 96);
      grd.addColorStop(0, '#2a2e36'); grd.addColorStop(1, '#101216');
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(-ap * 0.48, ap * 0.85); g.quadraticCurveTo(0, ap * 0.7, ap * 0.62, ap * 0.95); g.lineTo(70, 96); g.lineTo(-40, 100); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(160,170,190,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-ap * 0.48, ap * 0.85); g.quadraticCurveTo(0, ap * 0.7, ap * 0.62, ap * 0.95); g.stroke();
      g.restore();
    }
    // the sensor deep in the aperture: violet-blue, a bright glint
    const sg = g.createRadialGradient(cx - 6, cx - 8, 2, cx, cx, ap);
    sg.addColorStop(0, '#b9c8ff'); sg.addColorStop(0.18, '#3b3f9a'); sg.addColorStop(0.55, '#141838'); sg.addColorStop(1, '#06070c');
    g.fillStyle = sg; g.beginPath(); g.arc(cx, cx, ap * 0.92, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(40,46,70,0.9)';
    for (let y = -24; y <= 24; y += 6) g.fillRect(cx - 26, cx + y, 52, 1);
  });
  IRIS = new THREE.CanvasTexture(c);
  IRIS.colorSpace = THREE.SRGBColorSpace;
  IRIS.anisotropy = 4;
  return IRIS;
}

const MARKS = new Map();
/** its markings (one sheet per robot, cells 4 x 2): 0 its number, 1 the red hexagon, 2 hazard
 * chevrons, 3 the maker's plate, 4 "HACHI MAINTENANCE", 5 a lift arrow, 6 "ARM SWING", 7 "CHARGE" */
function markTexture(idx) {
  if (MARKS.has(idx)) return MARKS.get(idx);
  const S = 128;
  const c = canvas(S * 4, S * 2, (g) => {
    g.clearRect(0, 0, S * 4, S * 2);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // 0: K3-n
    g.fillStyle = '#16181c'; g.font = 'bold 54px sans-serif'; g.fillText('K3', S / 2, 44);
    g.fillStyle = '#c4161c'; g.font = 'bold 40px sans-serif'; g.fillText('-' + (idx + 1), S / 2, 92);
    // 1: the red hexagon with H8 in it
    g.save(); g.translate(S * 1.5, S / 2);
    const hex = (r) => { g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); };
    g.fillStyle = '#c4161c'; hex(58); g.fill();
    g.strokeStyle = '#f2efe8'; g.lineWidth = 4; hex(50); g.stroke();
    g.fillStyle = '#f2efe8'; g.font = 'bold 34px sans-serif'; g.fillText('H8', 0, 2);
    g.restore();
    // 2: chevrons
    g.save(); g.translate(S * 2, 0); g.beginPath(); g.rect(4, 34, S - 8, 60); g.clip();
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, S, S);
    for (let i = -S; i < S * 2; i += 26) { g.fillStyle = '#e6b422'; g.beginPath(); g.moveTo(i, 34); g.lineTo(i + 13, 34); g.lineTo(i + 13 - 60, 94); g.lineTo(i - 60, 94); g.closePath(); g.fill(); }
    g.restore();
    // 3: the maker's plate: a barcode, the serial
    g.save(); g.translate(S * 3, 0);
    g.fillStyle = '#d9dbdd'; g.fillRect(6, 30, S - 12, 68);
    g.fillStyle = '#1b1d20';
    let x = 14; for (let i = 0; i < 26; i++) { const w = 1 + ((i * 7 + idx * 3) % 4); g.fillRect(x, 38, w, 30); x += w + 2; }
    g.font = '600 13px monospace'; g.fillText('SN K3-' + String(2041 + idx * 17).padStart(5, '0'), S / 2, 84);
    g.restore();
    // 4: HACHI MAINTENANCE
    g.save(); g.translate(0, S);
    g.fillStyle = '#16181c'; g.font = 'bold 22px sans-serif'; g.fillText('HACHI', S / 2, 50); g.font = '600 12px sans-serif'; g.fillText('MAINTENANCE UNIT', S / 2, 74);
    g.fillStyle = '#c4161c'; g.fillRect(14, 88, S - 28, 5);
    // 5: lift arrow
    g.translate(S, 0);
    g.fillStyle = '#16181c'; g.beginPath(); g.moveTo(S / 2, 22); g.lineTo(S / 2 + 26, 56); g.lineTo(S / 2 + 10, 56); g.lineTo(S / 2 + 10, 100); g.lineTo(S / 2 - 10, 100); g.lineTo(S / 2 - 10, 56); g.lineTo(S / 2 - 26, 56); g.closePath(); g.fill();
    // 6: ARM SWING
    g.translate(S, 0);
    g.fillStyle = '#e6b422'; g.fillRect(6, 34, S - 12, 60);
    g.fillStyle = '#111'; g.font = 'bold 17px sans-serif'; g.fillText('ARM', S / 2, 54); g.fillText('SWING', S / 2, 76);
    // 7: CHARGE
    g.translate(S, 0);
    g.fillStyle = '#16181c'; g.fillRect(8, 36, S - 16, 56);
    g.fillStyle = '#e6b422'; g.beginPath(); g.moveTo(34, 40); g.lineTo(22, 66); g.lineTo(34, 66); g.lineTo(26, 88); g.lineTo(46, 58); g.lineTo(34, 58); g.lineTo(42, 40); g.closePath(); g.fill();
    g.fillStyle = '#f2efe8'; g.font = 'bold 18px sans-serif'; g.fillText('CHARGE', S / 2 + 14, 64);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  MARKS.set(idx, t);
  return t;
}

// ------------------------------------------------------------------ materials
const PHYS_ONLY = ['clearcoat', 'clearcoatRoughness', 'iridescence', 'iridescenceIOR', 'iridescenceThicknessRange', 'anisotropy', 'sheen', 'sheenRoughness', 'sheenColor', 'specularIntensity'];

/** one robot's materials at a level (each its own: its lights blink on their own) */
export function k3Materials(level, idx) {
  const hi = level === 'high';
  const P = (o) => {
    if (hi) return new THREE.MeshPhysicalMaterial(o);
    const s = { ...o };
    for (const k of PHYS_ONLY) delete s[k];
    if (level === 'low2') { delete s.normalMap; delete s.normalScale; }
    return new THREE.MeshStandardMaterial(s);
  };
  const grain = hi ? grainNormal() : null;
  const M = {
    shell: P({ color: 0xd2cec5, roughness: 0.4, metalness: 0.0, clearcoat: 0.5, clearcoatRoughness: 0.25, ...(grain ? { normalMap: grain, normalScale: new THREE.Vector2(0.12, 0.12) } : {}) }),
    dark: P({ color: 0x15171b, roughness: 0.62, metalness: 0.35 }),
    frame: P({ color: 0x30353c, roughness: 0.4, metalness: 0.72, clearcoat: 0.25, clearcoatRoughness: 0.4 }),
    frame2: P({ color: 0x23272d, roughness: 0.34, metalness: 0.8, clearcoat: 0.35, clearcoatRoughness: 0.3, sheen: 0.4, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x3a4a66) }),
    red: P({ color: 0xc4161c, roughness: 0.3, metalness: 0.1, clearcoat: 0.9, clearcoatRoughness: 0.12 }),
    metal: P({ color: 0xc4c9d0, roughness: 0.24, metalness: 0.96, anisotropy: 0.65 }),
    metal2: P({ color: 0x8d949c, roughness: 0.3, metalness: 0.92, anisotropy: 0.4 }),
    black: P({ color: 0x0c0d0f, roughness: 0.5, metalness: 0.2 }),
    rubber: P({ color: 0x1b1d20, roughness: 0.92, metalness: 0.0 }),
    gold: P({ color: 0xd9a441, roughness: 0.16, metalness: 1.0 }),
    cable: P({ color: 0xe8641e, roughness: 0.55, metalness: 0.05, clearcoat: 0.3 }),
    cable2: P({ color: 0x2a2d31, roughness: 0.7, metalness: 0.1 }),
    // the thruster bells: titanium, heat-tinted (blue and straw at an angle)
    nozzle: P({ color: 0x7a6a5c, roughness: 0.28, metalness: 0.92, iridescence: 0.85, iridescenceIOR: 1.9, iridescenceThicknessRange: [220, 620], side: THREE.DoubleSide }),
    // the front element: coated glass (violet-green at an angle)
    glass: P({ color: 0x06080b, roughness: 0.03, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 1, iridescenceIOR: 1.55, iridescenceThicknessRange: [320, 520], transparent: true, opacity: 0.55, depthWrite: false }),
    glassRed: P({ color: 0x3a0606, roughness: 0.05, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, emissive: new THREE.Color(0x400404), emissiveIntensity: 0.6 }),
    iris: new THREE.MeshStandardMaterial({ map: irisTexture(), emissiveMap: irisTexture(), emissive: new THREE.Color(0.25, 0.3, 0.55), emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.3 }),
    led: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.6, 0.9, 1.0), emissiveIntensity: 1.2 }),
    ledG: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.2, 1, 0.4), emissiveIntensity: 2 }),
    ledA: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 0.6, 0.1), emissiveIntensity: 0.2 }),
    ledR: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 0.1, 0.06), emissiveIntensity: 0.2 }),
    beacon: P({ color: 0x5a0a08, roughness: 0.2, metalness: 0.0, clearcoat: 1, emissive: new THREE.Color(1, 0.16, 0.08), emissiveIntensity: 0.3, transparent: true, opacity: 0.92 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(1, 0.97, 0.9), emissiveIntensity: 0 }),
    weld: new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.4, metalness: 0.8, emissive: new THREE.Color(1, 0.55, 0.2), emissiveIntensity: 0 }),
    mark: new THREE.MeshStandardMaterial({ map: markTexture(idx), transparent: true, roughness: 0.5, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }),
  };
  return M;
}

// ------------------------------------------------------------------ helpers
/** a decal quad (cell k of the 4 x 2 sheet) at pos facing n */
function decal(b, k, w, h, pos, n, up = V(0, 1, 0)) {
  const g = new THREE.PlaneGeometry(w, h);
  const u0 = (k % 4) / 4, v0 = 1 - (Math.floor(k / 4) + 1) / 2;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) / 4, v0 + uv.getY(i) / 2);
  const z = n.clone().normalize(), x = up.clone().cross(z).normalize(), y = z.clone().cross(x);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z).setPosition(pos));
  b.add(g, 'mark');
}

/** a rounded square plate's outline with round holes */
function plateShape(w, r, holes = []) {
  const s = new THREE.Shape(), a = w / 2;
  s.moveTo(-a + r, -a);
  s.lineTo(a - r, -a); s.quadraticCurveTo(a, -a, a, -a + r);
  s.lineTo(a, a - r); s.quadraticCurveTo(a, a, a - r, a);
  s.lineTo(-a + r, a); s.quadraticCurveTo(-a, a, -a, a - r);
  s.lineTo(-a, -a + r); s.quadraticCurveTo(-a, -a, -a + r, -a);
  for (const h of holes) { const p = new THREE.Path(); p.absarc(h[0], h[1], h[2], 0, Math.PI * 2, true); s.holes.push(p); }
  return s;
}

/** a link's side plate: a capsule from 0 to L along x (end radius r) with slots cut in it */
function linkShape(L, r, slots) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  s.lineTo(L, -r);
  s.absarc(L, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(0, r);
  for (const [x0, x1, h] of slots) {
    const p = new THREE.Path();
    p.absarc(x0, 0, h, Math.PI / 2, Math.PI * 1.5, false);
    p.lineTo(x1, -h);
    p.absarc(x1, 0, h, -Math.PI / 2, Math.PI / 2, false);
    p.lineTo(x0, h);
    s.holes.push(p);
  }
  return s;
}

/** the six faces: outward normal n, in-plane axes u, v (u x v = n) */
const FACES = {
  px: { n: V(1, 0, 0), u: V(0, 0, -1), v: V(0, 1, 0) },
  nx: { n: V(-1, 0, 0), u: V(0, 0, 1), v: V(0, 1, 0) },
  py: { n: V(0, 1, 0), u: V(1, 0, 0), v: V(0, 0, -1) },
  ny: { n: V(0, -1, 0), u: V(1, 0, 0), v: V(0, 0, 1) },
  pz: { n: V(0, 0, 1), u: V(1, 0, 0), v: V(0, 1, 0) },
  nz: { n: V(0, 0, -1), u: V(-1, 0, 0), v: V(0, 1, 0) },
};
const faceM = (F, d) => new THREE.Matrix4().makeBasis(F.u, F.v, F.n).setPosition(F.n.clone().multiplyScalar(d));

// the arms' mounts: where on the body, the way they point out (their turret axis)
export const K3_MOUNTS = {
  L: { p: V(-H, -0.01, -0.02), n: V(-1, 0, 0) },
  R: { p: V(H, -0.01, -0.02), n: V(1, 0, 0) },
  B: { p: V(0, -H, -0.04), n: V(0, -1, 0) },
};

// the 24 thruster bells: a corner's three, each pointing out along one axis
export const K3_NOZZLES = [];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
  const c = V(sx, sy, sz).multiplyScalar(H - 0.0375);
  for (const ax of [V(sx, 0, 0), V(0, sy, 0), V(0, 0, sz)]) K3_NOZZLES.push({ p: c.clone().addScaledVector(ax, 0.0375), d: ax });
}

// ------------------------------------------------------------------ the body
function buildBody(level, M, idx) {
  const hi = level === 'high', lo2 = level === 'low2';
  const b = new Builder();
  if (lo2) {
    b.box(0.4, 0.4, 0.4, 'shell', [0, 0, 0], null, 0, 1);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) b.box(0.08, 0.08, 0.08, 'frame', [sx * 0.165, sy * 0.165, sz * 0.165], null, 0, 1);
    for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
      b.box(0.26, 0.04, 0.04, 'frame', [0, s1 * 0.182, s2 * 0.182], null, 0, 1);
      b.box(0.04, 0.26, 0.04, 'frame', [s1 * 0.182, 0, s2 * 0.182], null, 0, 1);
      b.box(0.04, 0.04, 0.26, 'frame', [s1 * 0.182, s2 * 0.182, 0], null, 0, 1);
    }
  } else {
    // the core, the six raised panels (holes where something goes through them)
    b.add(new RoundedBoxGeometry(0.364, 0.364, 0.364, hi ? 3 : 1, 0.03), 'dark');
    const holes = { nz: [[0, 0.02, 0.09], [0.115, 0.115, 0.026], [-0.115, 0.115, 0.026]], px: [[0.02, -0.01, 0.06]], nx: [[-0.02, -0.01, 0.06]], ny: [[0, 0.04, 0.06]], pz: [], py: [] };
    for (const [k, F] of Object.entries(FACES)) {
      b.pushM(faceM(F, 0.183));
      b.extrude(plateShape(0.29, 0.03, holes[k]), 0.014, 'shell', [0, 0, 0.007], null, hi ? 0.003 : 0.002, hi ? 20 : 8);
      b.pop();
    }
    // the guards along the edges (red inlays on the four upright ones, fore and aft faces)
    for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
      b.box(0.25, 0.044, 0.044, 'frame', [0, s1 * 0.178, s2 * 0.178], null, 0.008, 2);
      b.box(0.044, 0.25, 0.044, 'frame', [s1 * 0.178, 0, s2 * 0.178], null, 0.008, 2);
      b.box(0.044, 0.044, 0.25, 'frame', [s1 * 0.178, s2 * 0.178, 0], null, 0.008, 2);
      if (hi) {
        b.box(0.003, 0.2, 0.012, 'red', [s1 * 0.2012, 0, s2 * 0.172], null, 0, 1);
        b.box(0.012, 0.2, 0.003, 'red', [s1 * 0.172, 0, s2 * 0.2012], null, 0, 1);
      }
    }
    // the corner blocks with their thruster bells
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const c = [sx * (H - 0.0375), sy * (H - 0.0375), sz * (H - 0.0375)];
      b.add(new RoundedBoxGeometry(0.075, 0.075, 0.075, hi ? 3 : 1, 0.012), 'frame2', c);
      if (hi) {
        // bolt heads on its three outer faces
        for (const [ax, u, v] of [[0, 1, 2], [1, 0, 2], [2, 0, 1]]) for (const [a, bb] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          const p = c.slice(); p[ax] += [sx, sy, sz][ax] * 0.0378; p[u] += a * 0.024; p[v] += bb * 0.024;
          const rot = ax === 0 ? [0, 0, Math.PI / 2] : ax === 2 ? [Math.PI / 2, 0, 0] : [0, 0, 0];
          b.cyl(0.004, 0.004, 0.003, 'metal2', p, rot, 6);
        }
      }
    }
    const bell = [];
    if (hi) {
      for (let i = 0; i <= 6; i++) { const t = i / 6; bell.push([0.0065 + 0.0095 * Math.pow(t, 0.75), t * 0.021]); }
      for (let i = 6; i >= 0; i--) { const t = i / 6; bell.push([0.0052 + 0.0088 * Math.pow(t, 0.75), t * 0.0205]); }
    }
    for (const N of K3_NOZZLES) {
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), N.d);
      const m = new THREE.Matrix4().compose(N.p, q, V(1, 1, 1));
      b.pushM(m);
      if (hi) {
        b.cyl(0.011, 0.011, 0.005, 'metal', [0, 0.0025, 0], null, 12);
        b.lathe(bell, 'nozzle', [0, 0.004, 0], null, 14);
      } else b.cyl(0.013, 0.008, 0.016, 'nozzle', [0, 0.008, 0], null, 8, true);
      b.pop();
    }
  }
  // ---- the camera (front)
  const cz = -H;
  if (lo2) {
    b.cyl(0.08, 0.08, 0.04, 'frame', [0, 0.02, cz - 0.015], [Math.PI / 2, 0, 0], 12);
    b.cyl(0.062, 0.062, 0.004, 'iris', [0, 0.02, cz - 0.036], [Math.PI / 2, 0, 0], 12);
  } else {
    b.push([0, 0.02, 0]);
    b.torus(0.086, 0.007, 'frame', [0, 0, cz], null, hi ? 48 : 20);
    b.cyl(0.082, 0.084, 0.05, 'frame', [0, 0, cz - 0.01], [Math.PI / 2, 0, 0], hi ? 48 : 20);
    if (hi) {
      // the knurled focus ring
      b.cyl(0.0775, 0.0775, 0.016, 'black', [0, 0, cz - 0.03], [Math.PI / 2, 0, 0], 48);
      for (let i = 0; i < 44; i++) { const a = i / 44 * Math.PI * 2; b.box(0.0035, 0.0035, 0.015, 'dark', [Math.cos(a) * 0.0785, Math.sin(a) * 0.0785, cz - 0.03], [0, 0, a], 0, 1); }
      b.torus(0.066, 0.0035, 'metal', [0, 0, cz - 0.036], null, 48);
    }
    b.add(new THREE.CircleGeometry(0.064, hi ? 48 : 20), 'iris', [0, 0, cz - 0.032], [0, Math.PI, 0]);
    // (the coated front element: a shallow dome)
    const th = Math.asin(0.064 / 0.11);
    const capG = new THREE.SphereGeometry(0.11, hi ? 48 : 20, hi ? 10 : 5, 0, Math.PI * 2, 0, th);
    b.add(capG, 'glass', [0, 0, cz - 0.036 + 0.11 * Math.cos(th)], [-Math.PI / 2, 0, 0]);
    b.torus(0.075, 0.0028, 'led', [0, 0, cz - 0.0355], null, hi ? 48 : 16);
    b.pop();
    // the lidar window and the infrared eye
    for (const s of [-1, 1]) {
      b.cyl(0.024, 0.026, 0.02, 'frame', [s * 0.115, 0.115, cz - 0.004], [Math.PI / 2, 0, 0], hi ? 24 : 10);
      b.cyl(0.018, 0.018, 0.004, s < 0 ? 'glassRed' : 'iris', [s * 0.115, 0.115, cz - 0.0145], [Math.PI / 2, 0, 0], hi ? 24 : 10);
      if (hi) b.torus(0.0195, 0.002, 'metal', [s * 0.115, 0.115, cz - 0.015], null, 24);
    }
    // status lights under it
    b.box(0.07, 0.016, 0.006, 'black', [0, -0.105, cz - 0.001], null, 0.002, 1);
    b.box(0.012, 0.008, 0.004, 'ledG', [-0.022, -0.105, cz - 0.004], null, 0, 1);
    b.box(0.012, 0.008, 0.004, 'ledA', [0, -0.105, cz - 0.004], null, 0, 1);
    b.box(0.012, 0.008, 0.004, 'ledR', [0.022, -0.105, cz - 0.004], null, 0, 1);
  }
  // ---- on top: the beacon, the whip antenna, the grab handle
  const ty = H;
  b.cyl(0.022, 0.024, 0.012, 'frame', [0.085, ty + 0.006, 0.085], null, lo2 ? 8 : 16);
  b.sphere(0.018, 'beacon', [0.085, ty + 0.012, 0.085], lo2 ? 8 : 16, [1, 0.85, 1]);
  if (!lo2) {
    b.cyl(0.011, 0.013, 0.01, 'metal', [-0.1, ty + 0.005, 0.1], null, 12);
    b.cyl(0.0022, 0.0028, 0.16, 'metal', [-0.1 - 0.012, ty + 0.085, 0.1 + 0.012], [0.15, 0, 0.15], 6);
    b.sphere(0.0055, 'red', [-0.1 - 0.024, ty + 0.163, 0.1 + 0.024], 8);
    b.tube([V(-0.07, ty, -0.03), V(-0.07, ty + 0.034, -0.03), V(0.07, ty + 0.034, -0.03), V(0.07, ty, -0.03)], 0.0075, 'frame', { radial: hi ? 10 : 6, seg: hi ? 24 : 10, tension: 0.05 });
  }
  // ---- the back: the charging plate, its contacts, the latch socket, cooling fins
  const bz = H;
  if (!lo2) {
    b.box(0.15, 0.1, 0.006, 'dark', [0, -0.05, bz + 0.002], null, 0.003, 1);
    for (const s of [-1, 1]) b.box(0.028, 0.05, 0.004, 'gold', [s * 0.045, -0.05, bz + 0.005], null, 0.002, 1);
    b.torus(0.017, 0.004, 'metal', [0, -0.05, bz + 0.006], null, 16);
    b.cyl(0.013, 0.013, 0.004, 'black', [0, -0.05, bz + 0.004], [Math.PI / 2, 0, 0], 16);
    if (hi) for (let i = 0; i < 7; i++) b.box(0.004, 0.09, 0.016, 'metal2', [-0.06 + i * 0.02, 0.075, bz + 0.008], null, 0.001, 1);
  } else b.box(0.12, 0.08, 0.006, 'dark', [0, -0.05, bz + 0.002], null, 0, 1);
  // ---- the markings
  if (!lo2) {
    for (const s of [-1, 1]) {
      decal(b, 0, 0.12, 0.12, V(s * (H + 0.0012), 0.085, 0.07), V(s, 0, 0));
      if (hi) decal(b, 6, 0.06, 0.06, V(s * (H + 0.0012), -0.105, 0.085), V(s, 0, 0));
    }
    decal(b, 1, 0.11, 0.11, V(0, ty + 0.0012, 0.04), V(0, 1, 0), V(0, 0, -1));
    if (hi) {
      decal(b, 3, 0.07, 0.07, V(0.11, -0.11, bz + 0.0012), V(0, 0, 1));
      decal(b, 4, 0.1, 0.1, V(0, 0.155, bz + 0.0012), V(0, 0, 1));
      decal(b, 7, 0.07, 0.07, V(-0.115, -0.11, bz + 0.0012), V(0, 0, 1));
      decal(b, 5, 0.04, 0.04, V(0, ty + 0.0012, -0.11), V(0, 1, 0), V(0, 0, -1));
      decal(b, 2, 0.1, 0.05, V(0, -H - 0.0012, 0.12), V(0, -1, 0), V(0, 0, 1));
    }
  }
  return b.build(M, { castShadow: !lo2, receiveShadow: !lo2 });
}

// ------------------------------------------------------------------ an arm
/**
 * arm k ('L', 'R', 'B'): its joints — j0 the turret (about its own axis, out of the body), j1 the
 * shoulder, j2 the elbow (both about the turret's x), j3 the wrist (about the link) — and its end:
 * a gripper's fingers (side arms) or the tool head (below), with the tip work happens at
 */
function buildArm(level, M, k) {
  const hi = level === 'high', lo2 = level === 'low2';
  const A = K3_ARM;
  const mount = K3_MOUNTS[k];
  const base = new THREE.Group();
  base.position.copy(mount.p);
  base.quaternion.setFromUnitVectors(V(0, 1, 0), mount.n);
  if (k === 'B') base.quaternion.setFromAxisAngle(V(1, 0, 0), Math.PI);
  const j0 = new THREE.Group(), j1 = new THREE.Group(), j2 = new THREE.Group(), j3 = new THREE.Group();
  base.add(j0); j0.add(j1); j1.add(j2); j2.add(j3);
  j1.position.y = A.turret;
  j2.position.y = A.L1;
  j3.position.y = A.L2;
  const opts = { castShadow: !lo2, receiveShadow: !lo2 };
  // the mount ring on the body and the turret
  {
    const b = new Builder();
    b.cyl(0.058, 0.06, 0.012, 'frame', [0, 0.004, 0], null, lo2 ? 10 : hi ? 32 : 16);
    if (hi) for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; b.cyl(0.004, 0.004, 0.004, 'metal2', [Math.cos(a) * 0.05, 0.011, Math.sin(a) * 0.05], null, 6); }
    base.add(b.build(M, opts));
    const t = new Builder();
    t.cyl(0.042, 0.046, A.turret - 0.008, 'metal', [0, 0.008 + (A.turret - 0.008) / 2, 0], null, lo2 ? 10 : hi ? 32 : 16);
    if (!lo2) t.cyl(0.0465, 0.0465, 0.006, 'red', [0, 0.014, 0], null, hi ? 32 : 16);
    // the shoulder's clevis: two cheeks either side of the pin
    for (const s of [-1, 1]) t.box(0.008, 0.05, 0.05, 'frame', [s * 0.026, A.turret - 0.004, 0], null, lo2 ? 0 : 0.004, 1);
    j0.add(t.build(M, opts));
  }
  // the upper link (a fork of two plates; the forearm folds into it)
  {
    const b = new Builder();
    if (lo2) {
      for (const s of [-1, 1]) b.box(0.008, A.L1 + 0.04, 0.04, 'frame', [s * 0.019, A.L1 / 2, 0], null, 0, 1);
      b.cyl(0.012, 0.012, 0.05, 'metal', [0, 0, 0], [0, 0, Math.PI / 2], 6);
    } else {
      const slots = hi ? [[0.035, 0.07, 0.009], [0.095, 0.13, 0.009]] : [];
      for (const s of [-1, 1]) {
        // (the shape is drawn along x: turned so it runs up the link, the plate's face sideways)
        const m = new THREE.Matrix4().makeBasis(V(0, 1, 0), V(0, 0, 1), V(1, 0, 0)).setPosition(s * 0.02, 0, 0);
        b.pushM(m);
        b.extrude(linkShape(A.L1, 0.024, slots), 0.006, 'frame', [0, 0, 0], null, hi ? 0.0015 : 0, hi ? 16 : 8);
        b.pop();
      }
      // the shoulder pin with its red caps
      b.cyl(0.011, 0.011, 0.056, 'metal', [0, 0, 0], [0, 0, Math.PI / 2], 16);
      for (const s of [-1, 1]) b.cyl(0.015, 0.015, 0.004, 'red', [s * 0.03, 0, 0], [0, 0, Math.PI / 2], 16);
      if (hi) {
        // the actuator on the outside of one plate, and the harness down the other
        b.cyl(0.0105, 0.0105, 0.085, 'metal2', [0.034, 0.075, 0.006], null, 16);
        b.cyl(0.0055, 0.0055, 0.05, 'metal', [0.034, 0.14, 0.006], null, 12);
        b.cyl(0.012, 0.012, 0.012, 'frame', [0.034, 0.03, 0.006], null, 16);
        b.tube([V(-0.03, 0.012, -0.012), V(-0.031, A.L1 * 0.5, -0.016), V(-0.03, A.L1 - 0.014, -0.012)], 0.0045, 'cable', { radial: 8, seg: 16 });
        b.tube([V(-0.03, 0.012, 0.004), V(-0.031, A.L1 * 0.5, 0.008), V(-0.03, A.L1 - 0.014, 0.004)], 0.0032, 'cable2', { radial: 6, seg: 16 });
        for (let i = 0; i < 3; i++) b.box(0.012, 0.006, 0.026, 'black', [-0.029, 0.04 + i * 0.045, -0.004], null, 0.002, 1);
      }
    }
    j1.add(b.build(M, opts));
  }
  // the forearm
  {
    const b = new Builder();
    if (lo2) {
      b.box(0.026, A.L2, 0.03, 'shell', [0, A.L2 / 2, 0], null, 0, 1);
    } else {
      b.cyl(0.018, 0.018, 0.032, 'metal', [0, 0, 0], [0, 0, Math.PI / 2], hi ? 20 : 10);
      b.box(0.026, A.L2 - 0.012, 0.032, 'shell', [0, A.L2 / 2, 0], null, hi ? 0.007 : 0.004, hi ? 3 : 1);
      b.box(0.028, A.L2 * 0.72, 0.008, 'frame', [0, A.L2 * 0.5, 0.017], null, 0.003, 1);
      if (hi) {
        for (let i = 0; i < 4; i++) b.box(0.016, 0.004, 0.003, 'black', [0, A.L2 * 0.35 + i * 0.012, -0.0165], null, 0, 1);
        b.box(0.0015, A.L2 * 0.6, 0.006, 'red', [0.0135, A.L2 * 0.5, -0.008], null, 0, 1);
        b.box(0.0015, A.L2 * 0.6, 0.006, 'red', [-0.0135, A.L2 * 0.5, -0.008], null, 0, 1);
      }
    }
    j2.add(b.build(M, opts));
  }
  // the wrist ring and the end
  const fingers = [];
  const tip = new THREE.Object3D();
  {
    const b = new Builder();
    b.cyl(0.018, 0.018, A.wrist, 'metal', [0, A.wrist / 2, 0], null, lo2 ? 8 : hi ? 24 : 12);
    if (!lo2) b.cyl(0.0185, 0.0185, 0.005, 'red', [0, A.wrist * 0.55, 0], null, hi ? 24 : 12);
    if (k === 'B') {
      // the tool head: hex body, weld tip, work lamp
      b.cyl(0.03, 0.03, 0.036, 'frame', [0, A.wrist + 0.018, 0], null, 6);
      b.cyl(0.004, 0.009, 0.03, 'metal', [0, A.wrist + 0.051, 0], null, lo2 ? 6 : 12);
      b.cyl(0.0032, 0.0036, 0.006, 'weld', [0, A.wrist + 0.069, 0], null, 8);
      if (!lo2) {
        b.cyl(0.01, 0.01, 0.014, 'dark', [0.022, A.wrist + 0.04, -0.012], [0.4, 0, 0], 12);
        b.cyl(0.0085, 0.0085, 0.002, 'lamp', [0.022, A.wrist + 0.047, -0.0148], [0.4, 0, 0], 12);
      }
      tip.position.set(0, A.wrist + 0.075, 0);
    } else {
      b.cyl(0.026, 0.024, 0.014, 'frame', [0, A.wrist + 0.007, 0], null, lo2 ? 8 : hi ? 24 : 12);
      tip.position.set(0, A.wrist + 0.06, 0);
    }
    j3.add(b.build(M, opts));
    j3.add(tip);
    // fingers: three round a gripper, two on the tool head's clamp
    const nF = k === 'B' ? 2 : 3;
    const y0 = A.wrist + (k === 'B' ? 0.018 : 0.014);
    const rF = k === 'B' ? 0.026 : 0.017;
    for (let i = 0; i < nF; i++) {
      const a = (k === 'B' ? Math.PI / 2 + i * Math.PI : i / nF * Math.PI * 2) + Math.PI / 2;
      const f1 = new THREE.Group();
      f1.position.set(Math.cos(a) * rF, y0, Math.sin(a) * rF);
      f1.rotation.y = Math.PI / 2 - a;
      const f2 = new THREE.Group();
      f2.position.y = 0.03;
      f1.add(f2);
      const s1 = new Builder(), s2 = new Builder();
      const sz = k === 'B' ? 0.7 : 1;
      s1.box(0.012 * sz, 0.032 * sz, 0.01 * sz, 'metal', [0, 0.015 * sz, 0], null, lo2 ? 0 : 0.003, 1);
      s2.box(0.011 * sz, 0.026 * sz, 0.009 * sz, 'metal', [0, 0.012 * sz, 0], null, lo2 ? 0 : 0.003, 1);
      if (hi) {
        s1.cyl(0.006, 0.006, 0.014, 'metal2', [0, 0, 0], [0, 0, Math.PI / 2], 10);
        s2.cyl(0.0055, 0.0055, 0.013, 'metal2', [0, 0, 0], [0, 0, Math.PI / 2], 10);
        s2.box(0.01, 0.022, 0.003, 'rubber', [0, 0.012, -0.006], null, 0.001, 1);
      }
      f1.add(s1.build(M, opts));
      f2.add(s2.build(M, opts));
      if (k === 'B') f2.position.y = 0.022;
      j3.add(f1);
      fingers.push({ f1, f2 });
    }
  }
  return { base, j: [j0, j1, j2, j3], fingers, tip, k };
}

// ------------------------------------------------------------------ thruster puffs
const PUFF_VERT = /* glsl */`
attribute float aK;
varying float vK; varying vec2 vUv;
void main(){
  vK = aK; vUv = uv;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const PUFF_FRAG = /* glsl */`
varying float vK; varying vec2 vUv;
void main(){
  // bright at the bell, fading out along the puff and toward its edge
  float along = vUv.y;
  float a = pow(1.0 - along, 1.6) * vK;
  vec3 c = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.98, 0.95), pow(1.0 - along, 4.0));
  gl_FragColor = vec4(c * a * 1.6, 1.0);
}`;

function buildPuffs(level) {
  const cone = new THREE.CylinderGeometry(0.004, 0.026, 1, level === 'high' ? 12 : 6, 1, true);
  cone.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({ vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const n = K3_NOZZLES.length;
  const mesh = new THREE.InstancedMesh(cone, mat, n);
  const k = new Float32Array(n);
  cone.setAttribute('aK', new THREE.InstancedBufferAttribute(k, 1));
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.renderOrder = 8;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < n; i++) mesh.setMatrixAt(i, zero);
  return { mesh, k };
}

// ------------------------------------------------------------------ the robot
/**
 * one robot drawn at a quality level ('high' | 'low' | 'low2'); idx: its number (0..2).
 * Returns { root, level, arms, M, setArm, setThrust, setLights, tick, setEnv, dispose }
 */
export function buildK3(level, idx) {
  const M = k3Materials(level, idx);
  const root = new THREE.Group();
  root.name = 'K3-' + (idx + 1);
  const body = buildBody(level, M, idx);
  root.add(body);
  const arms = {};
  for (const k of ['L', 'R', 'B']) { arms[k] = buildArm(level, M, k); root.add(arms[k].base); }
  const puffs = level === 'low2' ? null : buildPuffs(level);
  if (puffs) root.add(puffs.mesh);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  const _f = new THREE.Vector3(), _t = new THREE.Vector3(), _r = new THREE.Vector3();
  const lights = { ring: 1, beacon: true, status: 'ok', lamp: 0, weld: 0 };
  const api = {
    root, level, arms, M, idx,
    /**
     * an arm's pose: turret, shoulder (+ swings it forward, - back along the body), elbow (+ folds
     * the forearm back toward the body), wrist roll; grip 0 open .. 1 closed
     */
    setArm(k, turret, shoulder, elbow, wrist, grip = 0.3) {
      const a = arms[k];
      // (the side arms' shoulders and elbows turn about the body's up/down axis, the lower one's
      // about its left-right axis: the same sign means the same way round on all three)
      const sg = k === 'R' ? -1 : k === 'L' ? 1 : 1;
      a.j[0].rotation.y = turret;
      a.j[1].rotation.x = 0; a.j[1].rotation.z = 0;
      if (k === 'B') { a.j[1].rotation.x = shoulder; a.j[2].rotation.x = -elbow; }
      else { a.j[1].rotation.x = 0; a.j[1].rotation.set(0, 0, 0); a.j[1].rotateX(sg * shoulder); a.j[2].rotation.x = -sg * elbow; }
      a.j[3].rotation.y = wrist;
      for (const F of a.fingers) { F.f1.rotation.x = -(0.15 + 0.75 * grip); F.f2.rotation.x = -(0.25 + 0.7 * grip); }
    },
    /**
     * the thrusters: f the push wanted (body frame, each axis -1..1), tq the turn wanted (body frame,
     * about each axis -1..1); the bells whose push helps fire, puffing in proportion
     */
    setThrust(f, tq) {
      if (!puffs) return;
      for (let i = 0; i < K3_NOZZLES.length; i++) {
        const N = K3_NOZZLES[i];
        _f.copy(N.d).negate();                       // its push on the body
        _t.crossVectors(N.p, _f);                    // and its turn
        let k = Math.max(0, _f.dot(f)) + Math.max(0, _t.dot(tq) * 6);
        k = Math.min(1, k) * (0.85 + 0.3 * Math.random());
        puffs.k[i] = k;
        if (k < 0.02) { puffs.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
        _q.setFromUnitVectors(V(0, 1, 0), N.d);
        _p.copy(N.p).addScaledVector(N.d, 0.024);
        _s.set(0.7 + 0.5 * k, 0.05 + 0.22 * k, 0.7 + 0.5 * k);
        puffs.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      puffs.mesh.instanceMatrix.needsUpdate = true;
      puffs.mesh.geometry.attributes.aK.needsUpdate = true;
    },
    /** ring: the LED ring's brightness (0..3); beacon on/off; status 'ok' | 'low' | 'fault' | 'off';
     * lamp (0..1); weld (0..1) */
    setLights(o) { Object.assign(lights, o); },
    tick(dt, t) {
      const off = lights.status === 'off';
      M.led.emissiveIntensity = off ? 0 : lights.ring;
      // the beacon: a double blink every second and a half
      const ph = (t + idx * 0.37) % 1.5;
      M.beacon.emissiveIntensity = !off && lights.beacon && (ph < 0.08 || (ph > 0.2 && ph < 0.28)) ? 4 : 0.15;
      M.ledG.emissiveIntensity = !off && lights.status === 'ok' ? 2 : 0.1;
      M.ledA.emissiveIntensity = !off && lights.status === 'low' && (t * 2) % 1 < 0.5 ? 2.4 : 0.1;
      M.ledR.emissiveIntensity = !off && lights.status === 'fault' && (t * 3) % 1 < 0.5 ? 2.6 : 0.1;
      M.lamp.emissiveIntensity = off ? 0 : lights.lamp * 5;
      M.weld.emissiveIntensity = lights.weld > 0 ? lights.weld * (3 + 4 * Math.random()) : 0;
      M.iris.emissiveIntensity = off ? 0.05 : 0.3 + 0.08 * Math.sin(t * 2.1 + idx);
    },
    setEnv(env, k = 1) {
      for (const key of ['shell', 'frame', 'frame2', 'red', 'metal', 'metal2', 'gold', 'nozzle', 'glass', 'glassRed', 'beacon', 'cable']) {
        const m = M[key];
        if (!m || m.envMap === env) continue;
        const first = !m.envMap;
        m.envMap = env; m.envMapIntensity = k;
        if (first) m.needsUpdate = true;
      }
    },
    /** the world point of an arm's tip (its working end) */
    tipWorld(k, out) { return arms[k].tip.getWorldPosition(out); },
    dispose() {
      root.parent && root.parent.remove(root);
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const m of Object.values(M)) if (m.dispose && m !== M.iris) m.dispose();
    },
  };
  // stowed to start with: arms folded flat against the body
  api.setArm('L', 0, -1.45, 2.95, 0, 0.9);
  api.setArm('R', 0, -1.45, 2.95, 0, 0.9);
  api.setArm('B', 0, -1.45, 2.95, 0, 0.9);
  root.traverse((o) => { if (o.isMesh && level === 'low2') { o.castShadow = false; o.receiveShadow = false; } });
  return api;
}
