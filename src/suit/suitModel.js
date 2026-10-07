// The spacesuits' 3D model (any suit in SUITS: the build follows its spec). Standing, feet at the
// origin, facing -z (the way everything in the game faces forward).
//  - hard upper torso with the chest display and control module, waist and hip bearings;
//  - soft arms and legs in a woven outer layer with bellows at the joints, bearings at shoulders,
//    wrists and ankles, gloves with fingers, boots with soles;
//  - the helmet: hard shell, a wide glass visor (a tinted inner layer and an outer layer that
//    reflects the surroundings, brighter at grazing angles), a gold sun visor on a pivot, the
//    padded liner inside, lamps at the temples and the suit camera on top;
//  - inside: the wearer's head (face, eyes, brows, nose, comms cap with earcups and microphone),
//    seen through the visor as the eye moves round it; an empty liner when the suit is racked;
//  - the backpack: a rear-entry door (the wearer climbs in through the back), batteries (the
//    spare in its own bay), oxygen bottles, RCS quads at its corners and the boosters (two on the
//    top grade, one on the civilian suit) with their plumes;
//  - damage drawn onto the visor (scratches, cracks) from the suit's state.
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';
import { EnginePlume } from '../fx/enginePlume.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

/** the outer layer's weave as a normal map (rip-stop: a fine twill with a heavier square grid) */
let WEAVE = null;
function weaveNormal() {
  if (WEAVE) return WEAVE;
  const N = 256;
  const c = canvas(N, N, (g) => {
    const img = g.createImageData(N, N), d = img.data;
    const h = (x, y) => {
      const tw = Math.sin((x + y) * Math.PI / 2) * 0.5 + 0.5;               // twill diagonals
      const gx = Math.abs(((x % 32) + 32) % 32 - 16) < 1.2 ? 1 : 0;          // rip-stop grid
      const gy = Math.abs(((y % 32) + 32) % 32 - 16) < 1.2 ? 1 : 0;
      return tw * 0.35 + Math.max(gx, gy) * 0.8;
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
      const nx = -dx * 0.6, ny = -dy * 0.6, nz = 1;
      const l = Math.hypot(nx, ny, nz), i = (y * N + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (nz / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  WEAVE = new THREE.CanvasTexture(c);
  WEAVE.wrapS = WEAVE.wrapT = THREE.RepeatWrapping;
  WEAVE.repeat.set(10, 10);
  WEAVE.anisotropy = 4;
  return WEAVE;
}

const PALETTE = {
  // the top grade: pale grey shell, graphite panels, orange like H8's trim
  h8: { shell: 0xd5d9de, shell2: 0x3b4048, soft: 0xc8ccd1, accent: 0xe8641e, cap: 0x26292e },
  // civilian: white, light grey, blue
  b29: { shell: 0xf1f1ee, shell2: 0x99a2ac, soft: 0xebebe6, accent: 0x2f6fd0, cap: 0xf0f0f0 },
};

/** the materials of one suit (each suit its own: its visor carries its own damage) */
export function suitMaterials(spec) {
  const P = PALETTE[spec.color] || PALETTE.b29;
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const weave = weaveNormal();
  const M = {
    shell: S({ color: P.shell, roughness: 0.42, metalness: 0.08 }),
    shell2: S({ color: P.shell2, roughness: 0.5, metalness: 0.2 }),
    soft: S({ color: P.soft, roughness: 0.88, metalness: 0, normalMap: weave, normalScale: new THREE.Vector2(0.55, 0.55) }),
    joint: S({ color: 0x2c3036, roughness: 0.72, metalness: 0.05, normalMap: weave, normalScale: new THREE.Vector2(0.3, 0.3) }),
    metal: S({ color: 0xb9bec4, roughness: 0.28, metalness: 0.9 }),
    accent: S({ color: P.accent, roughness: 0.5, metalness: 0.05 }),
    black: S({ color: 0x121417, roughness: 0.55, metalness: 0.2 }),
    rubber: S({ color: 0x1b1d20, roughness: 0.9, metalness: 0 }),
    liner: S({ color: 0x24272c, roughness: 0.95, metalness: 0, side: THREE.BackSide }),
    pad: S({ color: 0x3a3d44, roughness: 0.95, metalness: 0 }),
    skin: S({ color: 0xd8a585, roughness: 0.62, metalness: 0 }),
    cap: S({ color: P.cap, roughness: 0.85, metalness: 0 }),
    eye: S({ color: 0x18120e, roughness: 0.15, metalness: 0 }),
    sclera: S({ color: 0xe9e4dc, roughness: 0.3, metalness: 0 }),
    brow: S({ color: 0x2a1d14, roughness: 0.9, metalness: 0 }),
    lens: S({ color: 0x0a0f14, roughness: 0.06, metalness: 0.6 }),
    nozzle: S({ color: 0x3d3833, roughness: 0.34, metalness: 0.88 }),
    gold: S({ color: 0xd8a640, roughness: 0.14, metalness: 1 }),
    lamp: S({ color: 0x000000, emissive: new THREE.Color(1, 0.97, 0.9), emissiveIntensity: 0 }),
    ledG: S({ color: 0x000000, emissive: new THREE.Color(0.2, 1, 0.45), emissiveIntensity: 2 }),
    ledA: S({ color: 0x000000, emissive: new THREE.Color(1, 0.55, 0.1), emissiveIntensity: 2 }),
    screen: S({ color: 0x000000, emissive: new THREE.Color(0.35, 0.8, 1.0), emissiveIntensity: 1.2 }),
    decal: S({ color: P.accent, roughness: 0.55, metalness: 0, emissive: new THREE.Color(P.accent), emissiveIntensity: 0.06 }),
  };
  // the visor: a tinted inner layer (it carries the damage) and an outer layer that only reflects
  M.visorTint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  M.visorRefl = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.03, metalness: 0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, envMapIntensity: 1.35 });
  M.visorTint.map = visorDamageTexture(M);
  return M;
}

/** the visor's tint and marks: drawn into a canvas the tint layer wears */
function visorDamageTexture(M) {
  const c = canvas(256, 256, () => {});
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  M._visorCanvas = c;
  M._visorTex = t;
  drawVisor(M, []);
  return t;
}

/** redraw the visor's marks (from SuitState.parts.visor.marks) */
export function drawVisor(M, marks, hp = 1) {
  const c = M._visorCanvas, g = c.getContext('2d'), N = c.width;
  g.clearRect(0, 0, N, N);
  g.fillStyle = 'rgba(12,16,22,0.24)';
  g.fillRect(0, 0, N, N);
  let rs = 1;
  const R = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  for (const m of marks) {
    const x = m.u * N, y = m.v * N;
    if (m.kind === 'scratch') {
      g.strokeStyle = 'rgba(225,232,240,0.55)';
      g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(x, y);
      let px = x, py = y, a = m.a;
      for (let k = 0; k < 5; k++) { a += (R() - 0.5) * 0.2; px += Math.cos(a) * m.l * N / 5; py += Math.sin(a) * m.l * N / 5; g.lineTo(px, py); }
      g.stroke();
    } else {
      // a crack: a star of jagged lines from the point that took the blow, a ring round it
      g.strokeStyle = 'rgba(235,240,245,0.8)';
      g.lineWidth = 1.1;
      const arms = 5 + Math.floor(m.l * 8);
      for (let k = 0; k < arms; k++) {
        let a = m.a + k / arms * Math.PI * 2 + (R() - 0.5) * 0.4, px = x, py = y;
        g.beginPath(); g.moveTo(px, py);
        const L = m.l * N * (0.4 + R() * 0.6);
        for (let s = 0; s < 6; s++) { a += (R() - 0.5) * 0.5; px += Math.cos(a) * L / 6; py += Math.sin(a) * L / 6; g.lineTo(px, py); }
        g.stroke();
      }
      g.beginPath(); g.arc(x, y, m.l * N * 0.12, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(230,236,242,0.35)';
      g.beginPath(); g.arc(x, y, m.l * N * 0.05, 0, Math.PI * 2); g.fill();
    }
  }
  // given way: frosted, opaque
  if (hp <= 0) { g.fillStyle = 'rgba(200,210,220,0.55)'; g.fillRect(0, 0, N, N); }
  M._visorTex.needsUpdate = true;
}

// ------------------------------------------------------------------ geometry helpers
/** a tapered segment from a (radius ra) to b (radius rb) */
function seg(b, a, c, ra, rc, key, n = 16) {
  const d = c.clone().sub(a), L = d.length();
  const g = new THREE.CylinderGeometry(rc, ra, L, n, 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  g.applyQuaternion(q);
  const m = a.clone().lerp(c, 0.5);
  g.translate(m.x, m.y, m.z);
  b.add(g, key);
}

/** a ring (bearing, cuff) round the axis a->c at t along it */
function ring(b, a, c, t, R, r, key, n = 20) {
  const d = c.clone().sub(a).normalize();
  const g = new THREE.TorusGeometry(R, r, 8, n);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d));
  const p = a.clone().lerp(c, t);
  g.translate(p.x, p.y, p.z);
  b.add(g, key);
}

/** a bellows joint: rings close together round a bend */
function bellows(b, a, c, R, key, n = 4) {
  for (let i = 0; i < n; i++) ring(b, a, c, (i + 0.5) / n, R, R * 0.22, key, 18);
}

/** a glove: cuff, back of the hand, palm, fingers bent a little, the thumb */
function glove(b, wrist, dir, side, M) {
  const d = dir.clone().normalize();
  const right = V(side, 0, 0);
  const fwd = d.clone();
  const cuffEnd = wrist.clone().addScaledVector(fwd, 0.05);
  seg(b, wrist, cuffEnd, 0.052, 0.05, 'shell2', 16);
  ring(b, wrist, cuffEnd, 0.1, 0.053, 0.009, 'metal', 20);
  const palmC = cuffEnd.clone().addScaledVector(fwd, 0.055);
  const g = new THREE.BoxGeometry(0.085, 0.1, 0.034);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, fwd));
  g.translate(palmC.x, palmC.y, palmC.z);
  b.add(g, 'soft');
  // fingers: four, curled a little toward the palm (the palm faces in)
  const inward = V(-side, 0, 0);
  for (let k = 0; k < 4; k++) {
    const off = (k - 1.5) * 0.021;
    const base = palmC.clone().addScaledVector(fwd, 0.05).addScaledVector(V(0, 0, 1).cross(fwd).normalize(), off);
    const mid = base.clone().addScaledVector(fwd, 0.035 - Math.abs(k - 1.5) * 0.004).addScaledVector(inward, 0.008);
    const tip = mid.clone().addScaledVector(fwd, 0.028).addScaledVector(inward, 0.016);
    seg(b, base, mid, 0.0105, 0.0098, 'soft', 8);
    seg(b, mid, tip, 0.0098, 0.0085, 'soft', 8);
    b.sphere(0.0088, 'soft', tip.toArray(), 8);
  }
  const tb = palmC.clone().addScaledVector(inward, 0.035).addScaledVector(fwd, -0.01);
  const tt = tb.clone().addScaledVector(fwd, 0.04).addScaledVector(inward, 0.012).addScaledVector(V(0, 0, -1), 0.012);
  seg(b, tb, tt, 0.012, 0.0105, 'soft', 8);
  b.sphere(0.0105, 'soft', tt.toArray(), 8);
  void right; void M;
}

/** the sphere segment of the helmet between the given phi / theta ranges (three's convention:
 *  phi = 3pi/2 faces -z) */
function cap(r, phi0, phiL, th0, thL, w = 40, h = 20) {
  return new THREE.SphereGeometry(r, w, h, phi0, phiL, th0, thL);
}

// ------------------------------------------------------------------ the suit
/**
 * spec: SUITS entry. opts: { wearer: true (a head inside) | false (an empty suit on its rack) }.
 * Returns { root, M, parts: { helmet, sunVisor, packDoor, boosters: [plume...], lamps } , api }
 */
export function buildSuit(spec, opts = {}) {
  const M = suitMaterials(spec);
  const top = spec.grade === 'top';
  const b = new Builder();
  b.plainUpTo = 0.004;
  const root = new THREE.Group();
  root.name = 'suit:' + spec.id;
  // ---- the skeleton (feet on the floor, facing -z)
  const J = {};
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    J['ankle' + k] = V(s * 0.12, 0.13, 0.005);
    J['knee' + k] = V(s * 0.122, 0.5, -0.03);
    J['hip' + k] = V(s * 0.105, 0.9, 0.0);
    J['shoulder' + k] = V(s * 0.255, 1.425, 0.0);
    J['elbow' + k] = V(s * 0.325, 1.15, -0.045);
    J['wrist' + k] = V(s * 0.335, 0.92, -0.14);
  }
  const HC = V(0, 1.665, -0.01);          // helmet centre
  const HR = top ? 0.168 : 0.18;          // helmet radius (the civilian bubble is rounder)
  // ---- boots, legs
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    const A = J['ankle' + k], K = J['knee' + k], H = J['hip' + k];
    b.box(0.115, 0.1, 0.29, 'shell2', [A.x, 0.065, -0.045], null, 0.035, 2);
    b.box(0.122, 0.028, 0.3, 'rubber', [A.x, 0.014, -0.045], null, 0.01, 2);
    b.box(0.1, 0.05, 0.06, 'shell', [A.x, 0.09, -0.17], [0.35, 0, 0], 0.02, 2);       // toe cap
    for (let i = 0; i < 3; i++) b.box(0.125, 0.008, 0.02, 'black', [A.x, 0.03, -0.16 + i * 0.1], null, 0, 1);
    ring(b, A, K, 0.02, 0.085, 0.012, 'metal');
    seg(b, A, K, 0.076, 0.086, 'soft');
    ring(b, A, K, 0.55, 0.088, 0.006, 'accent');
    bellows(b, K.clone().add(V(0, -0.035, 0)), K.clone().add(V(0, 0.045, 0)), 0.092, 'joint', 4);
    seg(b, K.clone().add(V(0, 0.04, 0)), H, 0.093, 0.108, 'soft');
    ring(b, K, H, 0.62, 0.109, 0.007, 'accent');
    // thigh pocket
    b.box(0.03, 0.12, 0.1, 'shell2', [A.x + s * 0.1, 0.72, -0.01], null, 0.01, 1);
  }
  // ---- hips, waist bearing, hard upper torso
  b.push([0, 0, 0], [0, 0, 0], [1, 1, 0.8]);
  b.lathe([[0.0, 0.84], [0.165, 0.845], [0.19, 0.88], [0.2, 0.95], [0.188, 1.01], [0.172, 1.045], [0.0, 1.05]], 'soft', [0, 0, 0], null, 28);
  b.pop();
  b.torus(0.176, 0.016, 'metal', [0, 1.045, 0], [Math.PI / 2, 0, 0], 32);
  b.torus(0.18, 0.006, 'black', [0, 1.06, 0], [Math.PI / 2, 0, 0], 32);
  b.push([0, 0, 0], [0, 0, 0], [1, 1, 0.78]);
  b.lathe([[0.0, 1.05], [0.17, 1.055], [0.2, 1.09], [0.215, 1.16], [0.228, 1.28], [0.236, 1.37], [0.22, 1.44], [0.17, 1.5], [0.13, 1.515], [0.0, 1.52]], 'shell', [0, 0, 0], null, 32);
  b.pop();
  // panel lines and the side panels
  for (const s of [-1, 1]) b.box(0.012, 0.3, 0.16, 'shell2', [s * 0.218, 1.27, 0.02], [0, 0, s * -0.05], 0.004, 1);
  b.box(0.42, 0.008, 0.012, 'shell2', [0, 1.33, -0.18], null, 0, 1);
  // the chest display and control module
  b.box(0.23, 0.13, 0.07, 'shell2', [0, 1.215, -0.2], [0.18, 0, 0], 0.018, 2);
  b.box(0.12, 0.05, 0.01, 'screen', [-0.035, 1.235, -0.237], [0.18, 0, 0], 0.004, 1);
  for (let i = 0; i < 3; i++) b.cyl(0.011, 0.011, 0.02, 'metal', [0.06 + (i % 2) * 0.03, 1.25 - i * 0.025, -0.238], [Math.PI / 2 + 0.18, 0, 0], 10);
  b.box(0.022, 0.012, 0.01, 'ledG', [0.065, 1.195, -0.236], [0.18, 0, 0], 0, 1);
  b.box(0.022, 0.012, 0.01, 'ledA', [0.095, 1.195, -0.236], [0.18, 0, 0], 0, 1);
  // hoses from the backpack to the chest (cooling, oxygen)
  for (const s of [-1, 1]) b.tube([V(s * 0.17, 1.42, 0.12), V(s * 0.21, 1.33, -0.06), V(s * 0.12, 1.2, -0.19)], 0.012, s < 0 ? 'accent' : 'black', { radial: 8, seg: 12 });
  // name tag / grade badge
  b.box(0.08, 0.025, 0.006, 'decal', [0.1, 1.4, -0.175], [0.1, 0.25, 0], 0.003, 1);
  // ---- shoulders, arms, gloves
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    const Sh = J['shoulder' + k], E = J['elbow' + k], W = J['wrist' + k];
    const out = V(s, 0, 0);
    b.add(new THREE.SphereGeometry(0.09, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), 'shell', [Sh.x, Sh.y + 0.005, Sh.z], [0, 0, -s * 0.5]);
    ring(b, Sh.clone().addScaledVector(out, -0.05), Sh.clone().addScaledVector(out, 0.05), 0.5, 0.074, 0.013, 'metal');
    const ua = Sh.clone().addScaledVector(out, 0.02).add(V(0, -0.04, 0));
    seg(b, ua, E, 0.068, 0.06, 'soft');
    ring(b, ua, E, 0.35, 0.069, 0.007, 'accent');
    if (top) b.box(0.05, 0.05, 0.006, 'decal', [Sh.x + s * 0.035, Sh.y - 0.1, -0.06], [0, s * 0.35, 0], 0.004, 1);
    bellows(b, E.clone().add(V(0, 0.035, 0.01)), E.clone().add(V(0, -0.04, -0.02)), 0.062, 'joint', 4);
    seg(b, E.clone().add(V(0, -0.03, -0.012)), W, 0.058, 0.05, 'soft');
    ring(b, E, W, 0.8, 0.054, 0.012, 'metal');
    // wrist checklist on the left, a small display on the right
    if (s < 0) b.box(0.07, 0.012, 0.09, 'shell2', [W.x, W.y + 0.1, W.z + 0.03], [0.4, 0, 0.1], 0.006, 1);
    else b.box(0.05, 0.012, 0.06, 'screen', [W.x - 0.01, W.y + 0.1, W.z + 0.03], [0.4, 0, -0.1], 0.004, 1);
    glove(b, W, W.clone().sub(E), s, M);
  }
  // ---- neck ring and the helmet
  b.torus(0.135, 0.018, 'metal', [0, 1.515, -0.01], [Math.PI / 2, 0, 0], 36);
  b.torus(0.14, 0.008, 'accent', [0, 1.53, -0.01], [Math.PI / 2, 0, 0], 36);
  const W0 = Math.PI * 1.5, WH = top ? 1.12 : 1.35;          // visor window: half width (phi)
  const T0 = top ? 0.6 : 0.42, T1 = top ? 1.98 : 2.12;       // and its top / bottom (theta)
  const NECK = 2.42;                                           // the neck opening (theta)
  const hs = top ? [1, 1.08, 1.05] : [1, 1, 1];
  b.push(HC.toArray(), [0, 0, 0], hs);
  b.add(cap(HR, 0, Math.PI * 2, 0, T0, 40, 8), 'shell');
  b.add(cap(HR, W0 + WH, Math.PI * 2 - 2 * WH, T0, T1 - T0, 40, 16), 'shell');
  b.add(cap(HR, 0, Math.PI * 2, T1, NECK - T1, 40, 6), 'shell');
  // the liner inside (its inner face), a little in
  b.add(cap(HR * 0.965, 0, Math.PI * 2, 0, NECK, 32, 16), 'liner');
  // the visor's frame: a lip round the window
  {
    const pts = [];
    const P = (ph, th) => V(-HR * 1.01 * Math.cos(ph) * Math.sin(th), HR * 1.01 * Math.cos(th), HR * 1.01 * Math.sin(ph) * Math.sin(th));
    for (let i = 0; i <= 10; i++) pts.push(P(W0 - WH + 2 * WH * i / 10, T0));
    for (let i = 1; i <= 6; i++) pts.push(P(W0 + WH, T0 + (T1 - T0) * i / 6));
    for (let i = 1; i <= 10; i++) pts.push(P(W0 + WH - 2 * WH * i / 10, T1));
    for (let i = 1; i < 6; i++) pts.push(P(W0 - WH, T1 - (T1 - T0) * i / 6));
    b.tube(pts, top ? 0.011 : 0.009, 'shell2', { radial: 6, seg: 64, closed: true, tension: 0 });
  }
  // lamps at the temples, the camera on top, an antenna stub
  for (const s of [-1, 1]) {
    const ph = W0 + s * (WH + 0.28);
    const p = V(-HR * Math.cos(ph) * Math.sin(1.2), HR * Math.cos(1.2), HR * Math.sin(ph) * Math.sin(1.2));
    b.box(0.045, 0.04, 0.07, 'shell2', [p.x + s * 0.012, p.y, p.z - 0.01], [0, -s * 0.5, 0], 0.01, 2);
    b.cyl(0.014, 0.014, 0.008, 'lamp', [p.x + s * 0.004, p.y, p.z - 0.048], [Math.PI / 2, 0, 0], 12);
  }
  b.box(0.05, 0.04, 0.075, 'shell2', [0.07, HR * 0.97, -0.03], null, 0.01, 2);
  b.cyl(0.016, 0.018, 0.03, 'black', [0.07, HR * 0.97, -0.078], [Math.PI / 2, 0, 0], 16);
  b.cyl(0.011, 0.011, 0.004, 'lens', [0.07, HR * 0.97, -0.094], [Math.PI / 2, 0, 0], 14);
  b.cyl(0.004, 0.004, 0.09, 'black', [-0.09, HR * 0.9, 0.06], [-0.3, 0, 0], 6);
  b.pop();
  // ---- the wearer's head (or the empty liner's padding)
  if (opts.wearer !== false) {
    const HCx = HC.clone().add(V(0, -0.012, 0.012));
    b.push(HCx.toArray());
    b.sphere(1, 'skin', [0, 0, 0], 28, [0.079, 0.104, 0.092]);
    // comms cap: over the top and the back, the face left open
    b.add(new THREE.SphereGeometry(1, 28, 16, W0 + 0.95, Math.PI * 2 - 1.9, 0, 2.3), 'cap', [0, 0.004, 0.004], [0, 0, 0], [0.086, 0.112, 0.1]);
    b.add(new THREE.SphereGeometry(1, 28, 6, 0, Math.PI * 2, 0, 0.95), 'cap', [0, 0.004, 0.004], [0, 0, 0], [0.086, 0.112, 0.1]);
    for (const s of [-1, 1]) {
      b.cyl(0.03, 0.03, 0.022, 'black', [s * 0.087, -0.01, 0.006], [0, 0, Math.PI / 2], 16);
      // eyes, brows
      b.sphere(0.0125, 'sclera', [s * 0.03, 0.012, -0.079], 12);
      b.sphere(0.0072, 'eye', [s * 0.03, 0.012, -0.0905], 10);
      b.box(0.026, 0.0045, 0.008, 'brow', [s * 0.031, 0.031, -0.085], [0, 0, s * -0.12], 0.002, 1);
    }
    b.sphere(1, 'skin', [0, -0.008, -0.091], 12, [0.011, 0.019, 0.014]);           // nose
    b.box(0.024, 0.0035, 0.004, 'brow', [0, -0.042, -0.085], null, 0.0015, 1);        // mouth
    b.sphere(1, 'skin', [0, -0.068, -0.062], 14, [0.045, 0.028, 0.04]);              // chin
    // microphone on its boom from the left earcup
    b.tube([V(-0.088, -0.02, -0.004), V(-0.075, -0.05, -0.06), V(-0.025, -0.06, -0.09)], 0.0025, 'black', { radial: 5, seg: 8 });
    b.sphere(0.008, 'black', [-0.022, -0.06, -0.092], 8);
    b.pop();
    // the neck
    b.cyl(0.046, 0.05, 0.1, 'skin', [0, 1.54, 0.01], null, 14);
  } else {
    b.sphere(1, 'pad', HC.clone().add(V(0, 0.02, 0.06)).toArray(), 20, [0.12, 0.12, 0.08]);
  }
  // ---- the backpack (fixed part: the frame on the suit's back)
  const PZ = 0.165;
  b.box(0.42, 0.56, 0.035, 'shell2', [0, 1.29, PZ + 0.0175], null, 0.012, 2);
  const group = b.build(M, { castShadow: true });
  group.name = 'suitBody';
  root.add(group);
  // ---- the helmet visor (glass) and the sun visor on its pivot
  const helm = new THREE.Group();
  helm.position.copy(HC);
  helm.scale.set(...hs);
  root.add(helm);
  const visG = cap(HR * 1.004, W0 - WH, 2 * WH, T0, T1 - T0, 40, 20);
  const tint = new THREE.Mesh(visG, M.visorTint);
  tint.renderOrder = 6;
  const refl = new THREE.Mesh(visG, M.visorRefl);
  refl.renderOrder = 7;
  helm.add(tint, refl);
  const sun = new THREE.Group();
  helm.add(sun);
  const sunM = new THREE.Mesh(cap(HR * 1.03, W0 - WH * 0.94, 2 * WH * 0.94, T0 - 0.05, (T1 - T0) * 0.62, 32, 12), M.gold);
  sunM.castShadow = false;
  sun.add(sunM);
  sun.rotation.x = -0.95;                 // raised over the top of the helmet
  // ---- the rear-entry door: the backpack itself, hinged on its right edge
  const door = new THREE.Group();
  door.position.set(0.23, 1.29, PZ + 0.035);
  root.add(door);
  const bd = new Builder();
  bd.plainUpTo = 0.004;
  const P0 = V(-0.23, 0, 0);               // the door's frame relative to the hinge
  bd.push(P0.toArray());
  bd.box(0.46, 0.62, 0.2, 'shell', [0, 0, 0.1], null, 0.04, 3);
  bd.box(0.44, 0.6, 0.012, 'shell2', [0, 0, 0.205], null, 0.01, 1);
  // ribs, grab handles, the battery bays (the spare in the lower one), oxygen bottle covers
  for (const y of [-0.2, 0.2]) bd.box(0.47, 0.03, 0.18, 'shell2', [0, y, 0.1], null, 0.008, 1);
  bd.tube([V(-0.15, 0.31, 0.12), V(-0.1, 0.36, 0.13), V(0.1, 0.36, 0.13), V(0.15, 0.31, 0.12)], 0.012, 'black', { radial: 8, seg: 12 });
  bd.box(0.3, 0.085, 0.03, 'black', [0, -0.255, 0.215], null, 0.006, 1);
  bd.box(0.3, 0.085, 0.03, 'black', [0, -0.15, 0.215], null, 0.006, 1);
  for (let i = 0; i < 5; i++) bd.box(0.03, 0.01, 0.006, i < 4 ? 'ledG' : 'ledA', [-0.1 + i * 0.05, -0.255, 0.232], null, 0, 1);
  for (let i = 0; i < 5; i++) bd.box(0.03, 0.01, 0.006, 'ledG', [-0.1 + i * 0.05, -0.15, 0.232], null, 0, 1);
  for (const s of [-1, 1]) bd.cyl(0.045, 0.045, 0.3, 'metal', [s * 0.17, 0.08, 0.12], null, 16);
  for (const s of [-1, 1]) bd.box(0.07, 0.34, 0.02, 'shell2', [s * 0.17, 0.08, 0.205], null, 0.008, 1);
  bd.box(0.1, 0.035, 0.006, 'decal', [0, 0.25, 0.214], null, 0.003, 1);
  // RCS quads at the corners
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const c = V(sx * 0.235, sy * 0.3, 0.17);
    bd.box(0.04, 0.04, 0.04, 'shell2', c.toArray(), null, 0.006, 1);
    for (const [dx, dy, dz] of [[sx, 0, 0], [0, sy, 0], [0, 0, 1]]) bd.cyl(0.006, 0.01, 0.018, 'nozzle', [c.x + dx * 0.026, c.y + dy * 0.026, c.z + dz * 0.026], [dz ? Math.PI / 2 : 0, 0, dx ? Math.PI / 2 * dx : 0], 8, true);
  }
  // the boosters: two pods on the sides (the top grade) or one under the pack (civilian)
  const boosterAt = [];
  const pods = top ? [[-0.29, -0.02, 0.1], [0.29, -0.02, 0.1]] : [[0, -0.36, 0.1]];
  for (const [x, y, z] of pods) {
    const len = top ? 0.38 : 0.16, r = top ? 0.07 : 0.06;
    if (top) {
      bd.cyl(r, r * 0.92, len, 'shell2', [x, y, z], null, 20);
      bd.cyl(r * 1.02, r * 1.02, 0.03, 'accent', [x, y + len * 0.32, z], null, 20);
      bd.torus(r * 0.75, 0.01, 'metal', [x, y + len / 2 + 0.004, z], [Math.PI / 2, 0, 0], 20);
      bd.cyl(r * 0.62, r * 0.62, 0.012, 'black', [x, y + len / 2 + 0.005, z], null, 18);   // intake grille
      bd.box(0.05, 0.05, 0.08, 'shell2', [x * 0.82, y, z - 0.02], null, 0.01, 1);          // mount
    } else bd.box(0.16, len, 0.12, 'shell2', [x, y + 0.02, z], null, 0.02, 2);
    const bell = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; bell.push([r * (0.45 + 0.45 * Math.pow(t, 0.7)), -t * (top ? 0.11 : 0.08)]); }
    const ny = y - (top ? len / 2 : len / 2 - 0.02);
    bd.push([x, ny, z], [-0.35, 0, 0]);
    bd.lathe(bell, 'nozzle', [0, 0, 0], null, 20);
    bd.lathe(bell.map(([rr, yy]) => [rr - 0.004, yy]).reverse(), 'nozzle', [0, 0, 0], null, 20);
    bd.pop();
    boosterAt.push({ p: V(x, ny - (top ? 0.11 : 0.08) * Math.cos(0.35), z + (top ? 0.11 : 0.08) * Math.sin(0.35)), r: r * 0.85 });
  }
  bd.pop();
  const doorG = bd.build(M, { castShadow: true });
  door.add(doorG);
  // booster plumes (in the door's frame: the boosters ride on it)
  const plumes = boosterAt.map((B, i) => {
    const dir = V(0, -Math.cos(0.35), Math.sin(0.35));
    const pos = B.p.clone().add(P0);
    return new EnginePlume(door, { exits: [pos], dir, r0: B.r, len: top ? 4.5 : 2.2, style: top ? 'plasma' : 'blue', spread: 0.3, dia: 0.5, seed: 3.3 + i });
  });
  const lamps = [];
  root.traverse((o) => { if (o.isMesh) { o.castShadow = o.material !== M.visorTint && o.material !== M.visorRefl; o.receiveShadow = true; } });
  // ---- the API
  const api = {
    root, M, spec, helm, sun, door, plumes, lamps,
    /** the gold sun visor: 0 raised .. 1 down over the glass */
    setSunVisor(k) { sun.rotation.x = -0.95 * (1 - k); },
    /** the rear-entry door: 0 shut .. 1 open */
    setDoor(k) { door.rotation.y = k * 1.9; },
    /** helmet lamps on / off */
    setLamps(on) { M.lamp.emissiveIntensity = on ? 6 : 0; },
    /** boosters: their thrust (0..1 each) */
    setBoost(dt, l, r = l, air = 0) { plumes.forEach((p, i) => p.update(dt, i === 0 ? l : r, air, 0)); },
    /** reflections of the surroundings in the visor and on the shell */
    setEnv(env) {
      for (const k of ['visorRefl', 'shell', 'shell2', 'metal', 'gold', 'nozzle', 'lens', 'accent']) {
        const m = M[k];
        if (m.envMap !== env) { const first = !m.envMap; m.envMap = env; if (first) m.needsUpdate = true; }
      }
    },
    /** the visor's marks from the suit's state */
    setDamage(state) {
      const v = state.parts.visor;
      const key = v.marks.length + ':' + v.hp.toFixed(2);
      if (key === api._dmgKey) return;
      api._dmgKey = key;
      drawVisor(M, v.marks, v.hp);
    },
    /** the indicator lights blink */
    tick(t) {
      M.ledA.emissiveIntensity = (t * 1.3) % 1 < 0.5 ? 2.5 : 0.3;
      M.screen.emissiveIntensity = 1.0 + 0.15 * Math.sin(t * 3);
    },
    dispose() { root.parent && root.parent.remove(root); for (const p of plumes) p.dispose(); },
  };
  api.setLamps(false);
  return api;
}
