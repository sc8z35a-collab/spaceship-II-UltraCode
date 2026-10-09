// The spacesuits' 3D model (any suit in SUITS: the build follows its spec). Standing, feet at the
// origin, facing -z (the way everything in the game faces forward), +x on its right.
//  - the hard upper torso: a sculpted shell (wide at the chest, narrowing to the waist), the chest
//    display and control module with its knobs and lights, the shoulder bearings, a waist bearing
//    with its quick-release, hoses from the pack, the grade's badge and the suit's name;
//  - soft arms and legs in a woven outer layer that folds into convolutes at every joint, with the
//    restraint cables running down their sides, bearings at the upper arm, the wrist and the thigh,
//    gauntlets with their locks, gloves with jointed fingers and knuckle guards, boots with lugged
//    soles; the top grade adds hard plates on the thighs, shins and forearms;
//  - the helmet: a hard shell round a wide pressure visor (a tinted inner layer and an outer one
//    that reflects the surroundings, brighter at grazing angles), a brow guard, a gold sun visor on
//    its pivot, lamp pods at the temples, the suit camera and a light bar; the padded liner inside;
//  - inside: the wearer's head (face, eyes, brows, nose, comms cap with earcups and microphone),
//    seen through the visor as the eye moves round it; an empty liner when the suit is racked;
//  - the backpack is the rear-entry door (the wearer climbs in through the back): batteries (the
//    spare in its own bay), oxygen bottles under the top, vents, RCS quads at its corners, the
//    boosters (two pods on the top grade, one under the pack on the civilian suit) with their
//    plumes; behind it the entry hatch's sealed frame and the dark padded inside of the suit;
//  - damage drawn onto the visor (scratches, cracks) from the suit's state.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
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

/** the suit's markings: name, badge, flag patch, stripes (one sheet, cells by key) */
function markings(spec, P) {
  const S = 128;
  const c = canvas(S * 4, S * 2, (g) => {
    g.clearRect(0, 0, S * 4, S * 2);
    const acc = '#' + new THREE.Color(P.accent).getHexString();
    // 0: the name tag
    g.fillStyle = '#1b1e22'; g.fillRect(4, 34, S - 8, 60);
    g.fillStyle = '#e9ecef'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('KAITO', S / 2, 56); g.font = '600 15px sans-serif'; g.fillStyle = acc; g.fillText(spec.name, S / 2, 82);
    // 1: the grade badge
    g.save(); g.translate(S * 1.5, S / 2);
    g.fillStyle = acc; g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; g.lineTo(Math.cos(a) * 54, Math.sin(a) * 54); } g.closePath(); g.fill();
    g.fillStyle = '#16181b'; g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; g.lineTo(Math.cos(a) * 44, Math.sin(a) * 44); } g.closePath(); g.fill();
    g.fillStyle = '#f2f2ee'; g.font = 'bold 34px sans-serif'; g.fillText(spec.grade === 'top' ? 'H8' : 'B29', 0, -4);
    g.font = '600 12px sans-serif'; g.fillStyle = acc; g.fillText(spec.grade === 'top' ? 'EVA-X' : 'CS-2', 0, 24);
    g.restore();
    // 2: the flag patch (a rising sun over the ship's orbit line)
    g.save(); g.translate(S * 2.5, S / 2);
    g.fillStyle = '#f4f4f0'; g.fillRect(-56, -38, 112, 76);
    g.fillStyle = '#c8202a'; g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#202428'; g.lineWidth = 3; g.strokeRect(-56, -38, 112, 76);
    g.restore();
    // 3: hazard / handling chevrons
    g.save(); g.translate(S * 3, 0);
    for (let i = -S; i < S * 2; i += 28) { g.fillStyle = acc; g.beginPath(); g.moveTo(i, 30); g.lineTo(i + 14, 30); g.lineTo(i + 14 - 40, 98); g.lineTo(i - 40, 98); g.closePath(); g.fill(); }
    g.restore();
    // 4..7 (second row): the warning label on the pack, the pack's maker plate
    g.save(); g.translate(0, S);
    g.fillStyle = 'rgba(230,180,30,0.95)'; g.fillRect(6, 28, S - 12, 72);
    g.fillStyle = '#111'; g.font = 'bold 18px sans-serif'; g.fillText('BOOSTER', S / 2, 52); g.font = '600 13px sans-serif'; g.fillText('KEEP CLEAR 3 m', S / 2, 78);
    g.translate(S, 0);
    g.fillStyle = '#d8dadc'; g.fillRect(6, 36, S - 12, 56);
    g.fillStyle = '#26292d'; g.font = '600 13px sans-serif'; g.fillText(spec.id === 'h8' ? 'PLSS-X  14 kN·s' : 'PLSS-C  4 kN·s', S / 2, 56); g.fillText('SN 0' + (spec.id === 'h8' ? '08' : '29') + '-2041', S / 2, 76);
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const PALETTE = {
  // the top grade: graphite shell, a pale grey soft layer, orange like H8's trim
  h8: { shell: 0x50565e, shell2: 0x2a2e34, soft: 0xbfc3c8, accent: 0xe8641e, cap: 0x26292e, plate: 0x3d4249 },
  // civilian: white, light grey, blue
  b29: { shell: 0xd8dad6, shell2: 0x7d8792, soft: 0xd2d3ce, accent: 0x2f6fd0, cap: 0xe6e6e2, plate: 0xbcc0bc },
};

/** the materials of one suit (each suit its own: its visor carries its own damage) */
export function suitMaterials(spec) {
  const P = PALETTE[spec.color] || PALETTE.b29;
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const weave = weaveNormal();
  const mk = markings(spec, P);
  const M = {
    shell: S({ color: P.shell, roughness: 0.38, metalness: 0.08 }),
    shell2: S({ color: P.shell2, roughness: 0.48, metalness: 0.22 }),
    plate: S({ color: P.plate, roughness: 0.42, metalness: 0.15 }),
    soft: S({ color: P.soft, roughness: 0.9, metalness: 0, normalMap: weave, normalScale: new THREE.Vector2(0.6, 0.6) }),
    joint: S({ color: P.soft, roughness: 0.92, metalness: 0, normalMap: weave, normalScale: new THREE.Vector2(0.45, 0.45) }),
    cord: S({ color: 0x3a3e44, roughness: 0.7, metalness: 0.1 }),
    metal: S({ color: 0xb9bec4, roughness: 0.26, metalness: 0.92 }),
    anod: S({ color: P.accent, roughness: 0.3, metalness: 0.75 }),
    accent: S({ color: P.accent, roughness: 0.5, metalness: 0.05 }),
    black: S({ color: 0x121417, roughness: 0.55, metalness: 0.2 }),
    rubber: S({ color: 0x1b1d20, roughness: 0.92, metalness: 0 }),
    liner: S({ color: 0x24272c, roughness: 0.95, metalness: 0, side: THREE.BackSide }),
    pad: S({ color: 0x33363c, roughness: 0.95, metalness: 0 }),
    inside: S({ color: 0x0b0c0e, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
    // (the face in there catches a little of the visor display's light: its colour)
    skin: S({ color: 0xd8a585, roughness: 0.62, metalness: 0, emissive: new THREE.Color(spec.grade === 'top' ? 0x3a2408 : 0x0c2236), emissiveIntensity: 1 }),
    cap: S({ color: P.cap, roughness: 0.85, metalness: 0 }),
    eye: S({ color: 0x18120e, roughness: 0.15, metalness: 0 }),
    sclera: S({ color: 0xe9e4dc, roughness: 0.3, metalness: 0, emissive: new THREE.Color(spec.grade === 'top' ? 0x2a1a06 : 0x081a2a), emissiveIntensity: 1 }),
    brow: S({ color: 0x2a1d14, roughness: 0.9, metalness: 0 }),
    lens: S({ color: 0x0a0f14, roughness: 0.05, metalness: 0.6 }),
    nozzle: S({ color: 0x3d3833, roughness: 0.34, metalness: 0.88 }),
    gold: S({ color: 0xd8a640, roughness: 0.12, metalness: 1 }),
    lamp: S({ color: 0x000000, emissive: new THREE.Color(1, 0.97, 0.9), emissiveIntensity: 0 }),
    ledG: S({ color: 0x000000, emissive: new THREE.Color(0.2, 1, 0.45), emissiveIntensity: 2 }),
    ledA: S({ color: 0x000000, emissive: new THREE.Color(1, 0.55, 0.1), emissiveIntensity: 2 }),
    ledC: S({ color: 0x000000, emissive: new THREE.Color(P.accent), emissiveIntensity: 1.2 }),
    screen: S({ color: 0x000000, emissive: new THREE.Color(0.35, 0.8, 1.0), emissiveIntensity: 1.2 }),
    mark: S({ map: mk, transparent: true, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }),
  };
  // the visor: a tinted inner layer (it carries the damage) and an outer layer that only reflects
  M.visorTint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  M.visorRefl = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.03, metalness: 0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, envMapIntensity: 1.35 });
  // (brighter toward the edges, where the glass is seen at a grazing angle)
  M.visorRefl.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
      float _fr = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0);
      outgoingLight *= 0.35 + 1.6 * _fr;
      #include <opaque_fragment>`);
  };
  M.visorRefl.customProgramCacheKey = () => 'suitVisorRefl';
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
  g.fillStyle = 'rgba(12,16,22,0.22)';
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
const _q = new THREE.Quaternion();

/** a geometry built along +y (length L) laid from a to c */
function along(geo, a, c) {
  const d = c.clone().sub(a);
  geo.applyQuaternion(_q.setFromUnitVectors(UP, d.normalize()));
  const m = a.clone().lerp(c, 0.5);
  geo.translate(m.x, m.y, m.z);
  return geo;
}

/**
 * a soft sleeve from a (radius ra) to c (radius rc): the fabric gathers into folds, deep
 * convolutes where it crosses a joint (conv: [from, to] along it, 0..1)
 */
function sleeve(b, a, c, ra, rc, key, o = {}) {
  const L = a.distanceTo(c);
  const radial = o.radial || 20, rows = Math.max(6, Math.ceil(L / 0.01));
  const g = new THREE.CylinderGeometry(1, 1, L, radial, rows, true);
  const P = g.attributes.position;
  const seed = o.seed || 1.7;
  for (let i = 0; i < P.count; i++) {
    const y = P.getY(i), t = y / L + 0.5;             // 0 at a .. 1 at c (cylinder +y = toward c)
    const ang = Math.atan2(P.getZ(i), P.getX(i));
    let r = ra + (rc - ra) * t;
    // loose folds round it, a slight twist of wrinkles
    r *= 1 + 0.012 * Math.sin(t * L / 0.05 * Math.PI * 2 + Math.sin(ang * 2 + seed) * 1.2) + 0.008 * Math.sin(ang * 3 + t * 9 + seed);
    // the convolutes over the joint: deep rounded rings
    if (o.conv) {
      const [c0, c1] = o.conv;
      if (t > c0 && t < c1) {
        const u = (t - c0) / (c1 - c0);
        const env = Math.sin(u * Math.PI);
        r *= 1 + 0.085 * env * Math.pow(Math.abs(Math.sin(u * (o.rings || 5) * Math.PI)), 0.7);
      }
    }
    P.setX(i, Math.cos(ang) * r); P.setZ(i, Math.sin(ang) * r);
  }
  g.computeVertexNormals();
  b.add(along(g, a, c), key);
}

/** a ring (bearing, cuff) round the axis a->c at t along it */
function ring(b, a, c, t, R, r, key, n = 24) {
  const d = c.clone().sub(a).normalize();
  const g = new THREE.TorusGeometry(R, r, 8, n);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d));
  const p = a.clone().lerp(c, t);
  g.translate(p.x, p.y, p.z);
  b.add(g, key);
}

/** a short cylinder band round the axis a->c at t (a bearing's body) */
function band(b, a, c, t, R, w, key, n = 24) {
  const d = c.clone().sub(a).normalize();
  const p = a.clone().lerp(c, t);
  const g = new THREE.CylinderGeometry(R, R, w, n, 1, false);
  b.add(along(g, p.clone().addScaledVector(d, -w / 2), p.clone().addScaledVector(d, w / 2)), key);
}

/** a restraint cable down a limb's side (a, c the limb's ends, side the direction off its axis) */
function cord(b, a, c, R, side) {
  const s = side.clone().normalize().multiplyScalar(R);
  const pts = [0, 0.33, 0.66, 1].map((t) => a.clone().lerp(c, t).add(s.clone().multiplyScalar(1 + 0.04 * Math.sin(t * 6))));
  b.tube(pts, 0.0045, 'cord', { radial: 5, seg: 10 });
}

/** a glove: gauntlet, wrist lock, the palm, jointed fingers curled a little, the thumb, a knuckle guard */
function glove(b, wrist, dir, side, top) {
  const fwd = dir.clone().normalize();
  const inward = V(-side, 0, 0);
  const across = new THREE.Vector3().crossVectors(fwd, inward).normalize();     // back of the hand
  // the gauntlet, flared, and the wrist bearing with its coloured lock
  const g0 = wrist.clone().addScaledVector(fwd, -0.055), g1 = wrist.clone().addScaledVector(fwd, 0.012);
  b.add(along(new THREE.CylinderGeometry(0.052, 0.064, g0.distanceTo(g1), 22, 1, false), g0, g1), top ? 'shell2' : 'plate');
  band(b, wrist, wrist.clone().add(fwd), 0.02, 0.054, 0.018, 'metal', 24);
  ring(b, wrist, wrist.clone().add(fwd), 0.02, 0.055, 0.0045, 'anod', 24);
  const lock = wrist.clone().addScaledVector(fwd, 0.02).addScaledVector(across, 0.056);
  b.box(0.022, 0.012, 0.03, 'anod', lock.toArray(), null, 0.004, 1);
  const palmC = wrist.clone().addScaledVector(fwd, 0.085);
  const pg = new RoundedBoxGeometry(0.085, 0.1, 0.038, 2, 0.016);
  const m = new THREE.Matrix4().makeBasis(inward.clone().cross(fwd).normalize().negate(), fwd, inward).setPosition(palmC);
  pg.applyMatrix4(m);
  b.add(pg, 'soft');
  // knuckle guard across the back of the hand
  const kg = new RoundedBoxGeometry(0.08, 0.022, 0.012, 1, 0.005);
  kg.applyMatrix4(new THREE.Matrix4().makeBasis(inward.clone().cross(fwd).normalize().negate(), fwd, inward).setPosition(palmC.clone().addScaledVector(fwd, 0.034).addScaledVector(across, 0.02)));
  b.add(kg, top ? 'shell2' : 'plate');
  // fingers: three joints each, curled toward the palm
  for (let k = 0; k < 4; k++) {
    const off = (k - 1.5) * 0.021;
    const sideAx = new THREE.Vector3().crossVectors(fwd, inward).normalize();
    let p = palmC.clone().addScaledVector(fwd, 0.05).addScaledVector(sideAx, off);
    let d = fwd.clone();
    const len = [0.03, 0.022, 0.018].map((l) => l * (1 - Math.abs(k - 1.5) * 0.07));
    for (let j = 0; j < 3; j++) {
      d.applyAxisAngle(sideAx, -0.28 * (j + 1) * side * 0 + 0).addScaledVector(inward, 0.18 + 0.08 * j).normalize();
      const q = p.clone().addScaledVector(d, len[j]);
      const r = 0.0105 - j * 0.0012;
      b.add(along(new THREE.CapsuleGeometry(r, len[j], 3, 8), p, q), 'soft');
      p = q;
    }
  }
  // the thumb: across the palm, opposed
  const tb = palmC.clone().addScaledVector(inward, 0.03).addScaledVector(fwd, -0.015);
  const tm = tb.clone().addScaledVector(fwd, 0.03).addScaledVector(inward, 0.012).addScaledVector(across, -0.012);
  const tt = tm.clone().addScaledVector(fwd, 0.026).addScaledVector(inward, 0.006);
  b.add(along(new THREE.CapsuleGeometry(0.012, 0.028, 3, 8), tb, tm), 'soft');
  b.add(along(new THREE.CapsuleGeometry(0.0105, 0.022, 3, 8), tm, tt), 'soft');
}

/** a boot: lugged sole, a rounded toe cap, the upper with its straps, the ankle bearing */
function boot(b, A, s, top) {
  const x = A.x;
  // the sole and its lugs
  b.add(new RoundedBoxGeometry(0.128, 0.034, 0.31, 2, 0.012), 'rubber', [x, 0.017, -0.045]);
  for (let i = 0; i < 6; i++) b.box(0.13, 0.008, 0.018, 'rubber', [x, -0.002, -0.17 + i * 0.05], null, 0.002, 1);
  // the upper: a rounded shell, the toe cap
  b.add(new RoundedBoxGeometry(0.118, 0.12, 0.27, 3, 0.045), top ? 'shell2' : 'plate', [x, 0.09, -0.04]);
  b.add(new RoundedBoxGeometry(0.112, 0.06, 0.08, 2, 0.025), 'rubber', [x, 0.07, -0.16], [0.25, 0, 0]);
  // the shaft up to the ankle, its straps
  b.add(new THREE.CylinderGeometry(0.07, 0.075, 0.12, 20), top ? 'shell2' : 'plate', [x, 0.17, 0.0]);
  for (const y of [0.13, 0.19]) b.add(new THREE.TorusGeometry(0.074, 0.006, 6, 24), 'black', [x, y, 0.0], [Math.PI / 2, 0, 0]);
  b.box(0.03, 0.02, 0.012, 'anod', [x + s * 0.06, 0.16, -0.05], [0, s * 0.6, 0], 0.003, 1);
}

/** a hard plate laid on a limb (the top grade's armour on thighs, shins, forearms) */
function limbPlate(b, a, c, R, face, len = 0.7, w = 1.1) {
  const L = a.distanceTo(c) * len;
  const g = new THREE.CylinderGeometry(R, R, L, 16, 1, true, 0, w);
  // (an arc of shell facing out of the limb)
  const ax = c.clone().sub(a).normalize();
  const mid = a.clone().lerp(c, 0.5);
  g.rotateY(-w / 2);
  const basis = new THREE.Matrix4().makeBasis(face.clone().cross(ax).normalize(), ax, face.clone().normalize());
  g.applyMatrix4(basis);
  g.translate(mid.x, mid.y, mid.z);
  b.add(g, 'plate');
}

/** the hard upper torso: superellipse sections lofted up the body ([y, half width, half depth, z]);
 * hole: the entry hatch cut out of its back ({ w, h, y }) */
function torsoGeometry(levels, n = 2.7, seg = 48, hole = null) {
  const pos = [], idx = [];
  const sp = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
  levels.forEach(([y, hw, hd, z0], j) => {
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      // the chest a little flatter in front, the back fuller
      const dz = s < 0 ? hd * 0.92 : hd;
      pos.push(sp(c, 2 / n) * hw, y, sp(s, 2 / n) * dz + z0);
    }
  });
  const W = seg + 1;
  const inHole = (...vs) => {
    if (!hole) return false;
    let x = 0, y = 0, z = 0;
    for (const v of vs) { x += pos[v * 3]; y += pos[v * 3 + 1]; z += pos[v * 3 + 2]; }
    x /= vs.length; y /= vs.length; z /= vs.length;
    return z > 0.04 && Math.abs(x) < hole.w / 2 && Math.abs(y - hole.y) < hole.h / 2;
  };
  for (let j = 0; j < levels.length - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    if (!inHole(a, c, b)) idx.push(a, c, b);
    if (!inHole(b, c, d)) idx.push(b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** a rounded rectangle path (w x h, corner r) in the xy plane at z, as points */
function roundRectPts(w, h, r, z, n = 6) {
  const pts = [];
  const cs = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, Math.PI * 1.5]];
  for (const [cx, cy, a0] of cs) for (let k = 0; k <= n; k++) { const a = a0 + k / n * Math.PI / 2; pts.push(V(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z)); }
  return pts;
}

/** the sphere segment of the helmet between the given phi / theta ranges (three's convention:
 *  phi = 3pi/2 faces -z) */
function cap(r, phi0, phiL, th0, thL, w = 40, h = 20) {
  return new THREE.SphereGeometry(r, w, h, phi0, phiL, th0, thL);
}

/** a decal quad (cell k of the markings sheet: 4 x 2) at pos, facing n */
function decal(b, k, w, h, pos, n, up = UP) {
  const g = new THREE.PlaneGeometry(w, h);
  const u0 = (k % 4) / 4, v0 = 1 - (Math.floor(k / 4) + 1) / 2;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) / 4, v0 + uv.getY(i) / 2);
  const z = n.clone().normalize(), x = up.clone().cross(z).normalize(), y = z.clone().cross(x);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z).setPosition(pos));
  b.add(g, 'mark');
}

// ------------------------------------------------------------------ the suit
/**
 * spec: SUITS entry. opts: { wearer: true (a head inside) | false (an empty suit on its rack) }.
 * Returns the api: { root, M, spec, helm, sun, door, plumes, lamps, set... }
 */
export function buildSuit(spec, opts = {}) {
  const M = suitMaterials(spec);
  const top = spec.grade === 'top';
  const b = new Builder();
  b.plainUpTo = 0.003;
  const root = new THREE.Group();
  root.name = 'suit:' + spec.id;
  // ---- the skeleton (feet on the floor, facing -z)
  const J = {};
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    J['ankle' + k] = V(s * 0.12, 0.2, 0.0);
    J['knee' + k] = V(s * 0.122, 0.52, -0.035);
    J['hip' + k] = V(s * 0.105, 0.9, 0.0);
    J['shoulder' + k] = V(s * 0.262, 1.415, 0.0);
    J['elbow' + k] = V(s * 0.33, 1.15, -0.045);
    J['wrist' + k] = V(s * 0.338, 0.93, -0.15);
  }
  const HC = V(0, 1.665, -0.01);          // helmet centre
  const HR = top ? 0.168 : 0.18;          // helmet radius (the civilian bubble is rounder)
  // ---- boots, legs: each leg in two pieces on its joints (the thigh on the hip, the shin and the
  // boot on the knee), so that it can move
  const limbB = {};
  const lb = (name) => { const x = new Builder(); x.plainUpTo = 0.003; limbB[name] = x; return x; };
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    const A = J['ankle' + k], K = J['knee' + k], H = J['hip' + k];
    const bt = lb('thigh' + k), bs = lb('shin' + k);
    boot(bs, A, s, top);
    // ankle bearing, the lower leg, the knee's convolutes, the thigh, the thigh bearing
    band(bs, A, K, 0.02, 0.083, 0.03, 'metal', 28);
    ring(bs, A, K, 0.06, 0.085, 0.005, 'anod', 28);
    sleeve(bs, A.clone().add(V(0, 0.02, 0)), K.clone().add(V(0, 0.07, 0)), 0.078, 0.09, 'soft', { conv: [0.72, 1.0], rings: 4, seed: s * 2.1 });
    sleeve(bt, K.clone().add(V(0, 0.06, 0)), H, 0.092, 0.11, 'soft', { conv: [0.0, 0.12], rings: 2, seed: s * 3.7 });
    band(bt, K, H, 0.62, 0.105, 0.03, 'metal', 28);
    ring(bt, K, H, 0.62, 0.107, 0.005, 'anod', 28);
    cord(bs, A.clone().add(V(0, 0.05, 0)), K.clone().add(V(0, 0.03, 0)), 0.095, V(s, 0, 0));
    cord(bt, K.clone().add(V(0, 0.05, 0)), H.clone().add(V(0, -0.06, 0)), 0.099, V(s, 0, 0));
    // a thigh pocket; on the top grade, plates on the thigh and the shin, a knee cap
    bt.add(new RoundedBoxGeometry(0.03, 0.13, 0.1, 1, 0.01), top ? 'shell2' : 'plate', [A.x + s * 0.105, 0.74, -0.01]);
    if (top) {
      limbPlate(bt, K.clone().add(V(0, 0.08, 0)), H.clone().add(V(0, -0.05, 0)), 0.116, V(s * 0.4, 0, -1), 0.75, 1.3);
      limbPlate(bs, A.clone().add(V(0, 0.06, 0)), K.clone().add(V(0, -0.02, 0)), 0.094, V(0, 0, -1), 0.8, 1.2);
      bs.sphere(1, 'shell2', K.clone().add(V(0, 0.01, -0.07)).toArray(), 16, [0.06, 0.06, 0.035]);
    }
  }
  // ---- the brief and the waist bearing
  b.push([0, 0, 0], [0, 0, 0], [1, 1, 0.8]);
  b.lathe([[0.0, 0.82], [0.16, 0.825], [0.19, 0.86], [0.205, 0.93], [0.198, 0.99], [0.186, 1.03], [0.0, 1.035]], 'soft', [0, 0, 0], null, 32);
  b.pop();
  b.add(new THREE.CylinderGeometry(0.188, 0.188, 0.035, 40), 'metal', [0, 1.035, 0], null, [1, 1, 0.8]);
  b.add(new THREE.TorusGeometry(0.19, 0.006, 6, 40), 'anod', [0, 1.05, 0], [Math.PI / 2, 0, 0], [1, 0.8, 1]);
  // tether rings at the hips
  for (const s of [-1, 1]) b.add(new THREE.TorusGeometry(0.022, 0.005, 6, 16), 'metal', [s * 0.19, 0.98, -0.05], [0, s * 0.4, 0]);
  // ---- the hard upper torso
  const PZ = 0.165;                      // the back plane (the entry hatch)
  b.add(torsoGeometry([
    [1.045, 0.178, 0.142, 0.0], [1.1, 0.19, 0.15, -0.004], [1.18, 0.212, 0.163, -0.01], [1.27, 0.232, 0.172, -0.014],
    [1.34, 0.24, 0.172, -0.012], [1.4, 0.236, 0.165, -0.008], [1.45, 0.214, 0.152, -0.004], [1.49, 0.17, 0.138, -0.004], [1.515, 0.142, 0.128, -0.006],
  ], 2.7, 48, { w: 0.33, h: 0.45, y: 1.27 }), 'shell');
  // panel lines, the side panels, the chest plate
  for (const s of [-1, 1]) b.add(new RoundedBoxGeometry(0.014, 0.28, 0.17, 1, 0.006), 'shell2', [s * 0.226, 1.25, 0.01], [0, 0, s * -0.05]);
  b.add(new RoundedBoxGeometry(0.36, 0.2, 0.03, 2, 0.012), top ? 'shell2' : 'plate', [0, 1.36, -0.16], [-0.12, 0, 0]);
  // the chest display and control module: the screen, knobs, a row of lights
  b.add(new RoundedBoxGeometry(0.24, 0.13, 0.075, 3, 0.02), 'shell2', [0, 1.2, -0.205], [0.2, 0, 0]);
  b.box(0.12, 0.052, 0.008, 'screen', [-0.04, 1.215, -0.244], [0.2, 0, 0], 0.003, 1);
  for (let i = 0; i < 3; i++) {
    b.cyl(0.012, 0.012, 0.022, 'metal', [0.055 + (i % 2) * 0.03, 1.235 - i * 0.024, -0.244], [Math.PI / 2 + 0.2, 0, 0], 12);
    b.cyl(0.0125, 0.0125, 0.004, 'anod', [0.055 + (i % 2) * 0.03, 1.235 - i * 0.024, -0.255], [Math.PI / 2 + 0.2, 0, 0], 12);
  }
  for (let i = 0; i < 4; i++) b.box(0.014, 0.008, 0.008, i < 3 ? 'ledG' : 'ledA', [-0.085 + i * 0.022, 1.172, -0.24], [0.2, 0, 0], 0, 1);
  // hoses from the pack round the sides to the module (cooling, oxygen), their connectors
  for (const s of [-1, 1]) {
    b.tube([V(s * 0.17, 1.43, 0.14), V(s * 0.235, 1.33, 0.0), V(s * 0.2, 1.22, -0.15), V(s * 0.11, 1.19, -0.215)], 0.013, s < 0 ? 'accent' : 'black', { radial: 10, seg: 16 });
    b.cyl(0.02, 0.02, 0.03, 'metal', [s * 0.11, 1.19, -0.222], [Math.PI / 2, 0, s * 0.6], 14);
  }
  // the badge, the name tag, the flag
  decal(b, 1, 0.07, 0.07, V(0.11, 1.4, -0.188), V(0.3, 0.15, -1));
  decal(b, 0, 0.11, 0.07, V(-0.11, 1.4, -0.188), V(-0.3, 0.15, -1));
  // the entry hatch's frame on the back: a sealed rim round a dark padded opening (seen when the
  // pack swings open), cooling tubes in there
  {
    const rim = roundRectPts(0.36, 0.48, 0.07, PZ + 0.006);
    b.push([0, 1.27, 0]);
    b.tube(rim, 0.016, 'metal', { radial: 8, seg: 64, closed: true, tension: 0 });
    b.tube(roundRectPts(0.33, 0.45, 0.06, PZ + 0.018), 0.008, 'rubber', { radial: 6, seg: 64, closed: true, tension: 0 });
    b.add(new THREE.PlaneGeometry(0.34, 0.46), 'inside', [0, 0, PZ - 0.06]);
    for (const s of [-1, 1]) b.add(new THREE.PlaneGeometry(0.12, 0.46), 'inside', [s * 0.17, 0, PZ - 0.03], [0, s * Math.PI / 2, 0]);
    b.add(new THREE.PlaneGeometry(0.34, 0.12), 'inside', [0, 0.23, PZ - 0.03], [Math.PI / 2, 0, 0]);
    b.add(new THREE.PlaneGeometry(0.34, 0.12), 'inside', [0, -0.23, PZ - 0.03], [-Math.PI / 2, 0, 0]);
    for (let i = 0; i < 5; i++) b.tube([V(-0.13, -0.18 + i * 0.09, PZ - 0.05), V(0, -0.16 + i * 0.09, PZ - 0.045), V(0.13, -0.18 + i * 0.09, PZ - 0.05)], 0.006, 'pad', { radial: 5, seg: 8 });
    b.pop();
  }
  // ---- shoulders, arms, gloves
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    const Sh = J['shoulder' + k], E = J['elbow' + k], W = J['wrist' + k];
    const out = V(s, 0, 0);
    // the shoulder's hard cap and its bearing
    b.add(new THREE.SphereGeometry(0.094, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), 'shell', [Sh.x, Sh.y + 0.01, Sh.z], [0, 0, -s * 0.55]);
    band(b, Sh.clone().addScaledVector(out, -0.06), Sh.clone().addScaledVector(out, 0.06), 0.62, 0.079, 0.03, 'metal', 28);
    ring(b, Sh.clone().addScaledVector(out, -0.06), Sh.clone().addScaledVector(out, 0.06), 0.66, 0.081, 0.005, 'anod', 28);
    // (the arm in two pieces on its joints: the upper arm on the shoulder bearing, the forearm and
    // the glove on the elbow)
    const bu = lb('upper' + k), bf = lb('fore' + k);
    const ua = Sh.clone().addScaledVector(out, 0.03).add(V(0, -0.05, 0));
    sleeve(bu, ua, E.clone().add(V(0, 0.04, 0.01)), 0.07, 0.063, 'soft', { conv: [0.0, 0.18], rings: 2, seed: s * 1.3 });
    // the upper arm bearing, the elbow's convolutes, the forearm
    band(bu, ua, E, 0.42, 0.069, 0.024, 'metal', 24);
    sleeve(bf, E.clone().add(V(0, 0.045, 0.01)), E.clone().add(V(0, -0.05, -0.022)), 0.063, 0.06, 'joint', { conv: [0.0, 1.0], rings: 5, seed: s * 4.1 });
    sleeve(bf, E.clone().add(V(0, -0.045, -0.02)), W.clone().add(V(0, 0.015, 0.02)), 0.058, 0.052, 'soft', { seed: s * 5.3 });
    cord(bu, ua.clone().add(V(0, -0.03, 0)), E.clone().add(V(0, 0.03, 0.01)), 0.066, V(s, 0, 0.3));
    cord(bf, E.clone().add(V(0, -0.04, -0.02)), W.clone().add(V(0, 0.04, 0.03)), 0.061, V(s, 0, 0.3));
    if (top) limbPlate(bf, E.clone().add(V(0, -0.06, -0.02)), W.clone().add(V(0, 0.04, 0.02)), 0.064, V(s * 0.6, 0.2, -0.7), 0.85, 1.4);
    // a wrist checklist on the left, a small display on the right
    if (s < 0) bf.add(new RoundedBoxGeometry(0.075, 0.014, 0.09, 1, 0.005), 'shell2', [W.x, W.y + 0.1, W.z + 0.04], [0.45, 0, 0.1]);
    else { bf.add(new RoundedBoxGeometry(0.06, 0.016, 0.07, 1, 0.005), 'shell2', [W.x, W.y + 0.1, W.z + 0.04], [0.45, 0, -0.1]); bf.box(0.042, 0.004, 0.05, 'screen', [W.x, W.y + 0.108, W.z + 0.036], [0.45, 0, -0.1], 0.002, 1); }
    if (s > 0) decal(bu, 2, 0.075, 0.05, V(Sh.x + 0.06, Sh.y - 0.1, -0.035), V(1, 0.05, -0.35));
    glove(bf, W, W.clone().sub(E), s, top);
  }
  // ---- neck ring and the helmet
  b.add(new THREE.CylinderGeometry(0.142, 0.15, 0.04, 40), 'metal', [0, 1.52, -0.01]);
  b.torus(0.146, 0.006, 'anod', [0, 1.54, -0.01], [Math.PI / 2, 0, 0], 40);
  const W0 = Math.PI * 1.5, WH = top ? 1.12 : 1.35;          // visor window: half width (phi)
  const T0 = top ? 0.6 : 0.42, T1 = top ? 1.98 : 2.12;       // and its top / bottom (theta)
  const NECK = 2.42;                                           // the neck opening (theta)
  const hs = top ? [1, 1.08, 1.05] : [1, 1, 1];
  b.push(HC.toArray(), [0, 0, 0], hs);
  b.add(cap(HR, 0, Math.PI * 2, 0, T0, 48, 10), 'shell');
  b.add(cap(HR, W0 + WH, Math.PI * 2 - 2 * WH, T0, T1 - T0, 48, 18), 'shell');
  b.add(cap(HR, 0, Math.PI * 2, T1, NECK - T1, 48, 6), 'shell');
  // the liner inside (its inner face), a little in
  b.add(cap(HR * 0.965, 0, Math.PI * 2, 0, NECK, 32, 16), 'liner');
  // the visor's frame: a lip round the window, a heavier brow guard over it
  {
    const pts = [];
    const P = (ph, th, k = 1.01) => V(-HR * k * Math.cos(ph) * Math.sin(th), HR * k * Math.cos(th), HR * k * Math.sin(ph) * Math.sin(th));
    for (let i = 0; i <= 10; i++) pts.push(P(W0 - WH + 2 * WH * i / 10, T0));
    for (let i = 1; i <= 6; i++) pts.push(P(W0 + WH, T0 + (T1 - T0) * i / 6));
    for (let i = 1; i <= 10; i++) pts.push(P(W0 + WH - 2 * WH * i / 10, T1));
    for (let i = 1; i < 6; i++) pts.push(P(W0 - WH, T1 - (T1 - T0) * i / 6));
    b.tube(pts, top ? 0.011 : 0.009, 'shell2', { radial: 6, seg: 64, closed: true, tension: 0 });
    const brow = [];
    for (let i = 0; i <= 12; i++) brow.push(P(W0 - WH * 1.06 + 2.12 * WH * i / 12, T0 - 0.05, 1.035));
    b.tube(brow, 0.016, top ? 'shell2' : 'plate', { radial: 8, seg: 32 });
  }
  // lamp pods at the temples (two lamps each), the camera on the right one, a light bar on top
  for (const s of [-1, 1]) {
    const ph = W0 + s * (WH + 0.26);
    const p = V(-HR * Math.cos(ph) * Math.sin(1.25), HR * Math.cos(1.25), HR * Math.sin(ph) * Math.sin(1.25));
    b.add(new RoundedBoxGeometry(0.045, 0.06, 0.09, 2, 0.014), 'shell2', [p.x + s * 0.016, p.y, p.z - 0.01], [0, -s * 0.45, 0]);
    for (const dy of [-0.014, 0.014]) b.cyl(0.011, 0.011, 0.008, 'lamp', [p.x + s * 0.009, p.y + dy, p.z - 0.056], [Math.PI / 2, 0, 0], 12);
    if (s > 0) {
      b.cyl(0.014, 0.016, 0.03, 'black', [p.x + s * 0.03, p.y - 0.032, p.z - 0.03], [Math.PI / 2, 0, 0], 16);
      b.cyl(0.01, 0.01, 0.004, 'lens', [p.x + s * 0.03, p.y - 0.032, p.z - 0.046], [Math.PI / 2, 0, 0], 14);
    }
  }
  b.add(new RoundedBoxGeometry(0.12, 0.026, 0.07, 2, 0.01), 'shell2', [0, HR * 0.99, -0.02]);
  b.box(0.09, 0.008, 0.01, 'lamp', [0, HR * 0.99, -0.057], null, 0.002, 1);
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
      b.sphere(0.0125, 'sclera', [s * 0.03, 0.012, -0.079], 12);
      b.sphere(0.0072, 'eye', [s * 0.03, 0.012, -0.0905], 10);
      b.box(0.026, 0.0045, 0.008, 'brow', [s * 0.031, 0.031, -0.085], [0, 0, s * -0.12], 0.002, 1);
    }
    b.sphere(1, 'skin', [0, -0.008, -0.091], 12, [0.011, 0.019, 0.014]);           // nose
    b.box(0.024, 0.0035, 0.004, 'brow', [0, -0.042, -0.085], null, 0.0015, 1);        // mouth
    b.sphere(1, 'skin', [0, -0.068, -0.062], 14, [0.045, 0.028, 0.04]);              // chin
    b.tube([V(-0.088, -0.02, -0.004), V(-0.075, -0.05, -0.06), V(-0.025, -0.06, -0.09)], 0.0025, 'black', { radial: 5, seg: 8 });
    b.sphere(0.008, 'black', [-0.022, -0.06, -0.092], 8);
    b.pop();
    b.cyl(0.046, 0.05, 0.1, 'skin', [0, 1.54, 0.01], null, 14);
  } else {
    b.sphere(1, 'pad', HC.clone().add(V(0, 0.02, 0.06)).toArray(), 20, [0.12, 0.12, 0.08]);
  }
  const group = b.build(M, { castShadow: true });
  group.name = 'suitBody';
  root.add(group);
  // ---- the limbs on their joints: hip -> knee, shoulder -> elbow (each piece built where it is
  // standing, hung on a pivot at its joint)
  const joints = {};
  const hang = (name, at, parent, parentAt) => {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.copy(at).sub(parentAt || V(0, 0, 0));
    const g = limbB[name.replace('Joint', '')].build(M, { castShadow: true });
    g.position.copy(at).negate();
    pivot.add(g);
    parent.add(pivot);
    joints[name] = pivot;
    return pivot;
  };
  for (const k of ['L', 'R']) {
    const hip = hang('thigh' + k, J['hip' + k], root, null);
    hang('shin' + k, J['knee' + k], hip, J['hip' + k]);
    const sh = hang('upper' + k, J['shoulder' + k], root, null);
    hang('fore' + k, J['elbow' + k], sh, J['shoulder' + k]);
  }
  // ---- the helmet visor (glass) and the sun visor on its pivot
  const helm = new THREE.Group();
  helm.position.copy(HC);
  helm.scale.set(...hs);
  root.add(helm);
  const visG = cap(HR * 1.004, W0 - WH, 2 * WH, T0, T1 - T0, 48, 22);
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
  door.position.set(0.23, 1.27, PZ + 0.03);
  root.add(door);
  const bd = new Builder();
  bd.plainUpTo = 0.003;
  const P0 = V(-0.23, 0, 0);               // the door's frame relative to the hinge
  bd.push(P0.toArray());
  // the pack: a chamfered shell; the top hump over the oxygen bottles; a recessed back panel
  bd.add(new RoundedBoxGeometry(0.46, 0.62, 0.2, 3, 0.05), 'shell', [0, 0, 0.1]);
  bd.add(new RoundedBoxGeometry(0.38, 0.12, 0.17, 3, 0.04), 'shell', [0, 0.33, 0.095]);
  for (const s of [-1, 1]) {
    bd.cyl(0.042, 0.042, 0.02, 'metal', [s * 0.1, 0.39, 0.1], null, 18);         // the bottles' valves
    bd.cyl(0.016, 0.016, 0.02, 'anod', [s * 0.1, 0.405, 0.1], null, 10);
  }
  bd.add(new RoundedBoxGeometry(0.4, 0.5, 0.02, 2, 0.012), 'shell2', [0, -0.02, 0.205]);
  // the battery bays (the spare in the lower one) with their charge lights
  bd.add(new RoundedBoxGeometry(0.3, 0.085, 0.024, 1, 0.006), 'black', [0, -0.2, 0.218]);
  bd.add(new RoundedBoxGeometry(0.3, 0.085, 0.024, 1, 0.006), 'black', [0, -0.095, 0.218]);
  for (let i = 0; i < 5; i++) bd.box(0.03, 0.01, 0.006, i < 4 ? 'ledG' : 'ledA', [-0.1 + i * 0.05, -0.2, 0.232], null, 0, 1);
  for (let i = 0; i < 5; i++) bd.box(0.03, 0.01, 0.006, 'ledG', [-0.1 + i * 0.05, -0.095, 0.232], null, 0, 1);
  // vents down the sides, a status light bar, the grab handle over the top
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) bd.box(0.006, 0.012, 0.13, 'black', [s * 0.232, 0.12 - i * 0.03, 0.1], null, 0, 1);
  bd.box(0.2, 0.012, 0.006, 'ledC', [0, 0.12, 0.218], null, 0.002, 1);
  bd.tube([V(-0.15, 0.36, 0.17), V(-0.1, 0.42, 0.18), V(0.1, 0.42, 0.18), V(0.15, 0.36, 0.17)], 0.012, 'black', { radial: 8, seg: 12 });
  decal(bd, 4, 0.12, 0.07, V(0, 0.05, 0.217), V(0, 0, 1));
  decal(bd, 5, 0.12, 0.06, V(0, -0.27, 0.217), V(0, 0, 1));
  // the door's inner face: its seal, the padding the wearer's back lies on
  bd.tube(roundRectPts(0.35, 0.47, 0.065, -0.005), 0.011, 'rubber', { radial: 6, seg: 64, closed: true, tension: 0 });
  bd.add(new RoundedBoxGeometry(0.3, 0.42, 0.02, 2, 0.008), 'pad', [0, 0, -0.004]);
  // RCS quads at the corners
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const c = V(sx * 0.235, sy * 0.3, 0.17);
    bd.add(new RoundedBoxGeometry(0.042, 0.042, 0.042, 1, 0.008), 'shell2', c.toArray());
    for (const [dx, dy, dz] of [[sx, 0, 0], [0, sy, 0], [0, 0, 1]]) bd.cyl(0.006, 0.01, 0.018, 'nozzle', [c.x + dx * 0.027, c.y + dy * 0.027, c.z + dz * 0.027], [dz ? Math.PI / 2 : 0, 0, dx ? Math.PI / 2 * dx : 0], 8, true);
  }
  // the boosters: two pods on the sides (the top grade) or one under the pack (civilian)
  const boosterAt = [];
  const pods = top ? [[-0.29, -0.02, 0.1], [0.29, -0.02, 0.1]] : [[0, -0.37, 0.1]];
  for (const [x, y, z] of pods) {
    const len = top ? 0.4 : 0.16, r = top ? 0.07 : 0.06;
    if (top) {
      bd.cyl(r, r * 0.9, len, 'shell2', [x, y, z], null, 24);
      bd.cyl(r * 1.02, r * 1.02, 0.03, 'accent', [x, y + len * 0.32, z], null, 24);
      bd.torus(r * 0.75, 0.01, 'metal', [x, y + len / 2 + 0.004, z], [Math.PI / 2, 0, 0], 24);
      bd.cyl(r * 0.62, r * 0.62, 0.012, 'black', [x, y + len / 2 + 0.005, z], null, 20);   // intake grille
      for (let i = 0; i < 4; i++) bd.box(0.004, 0.18, 0.02, 'black', [x + Math.sign(x) * r * 0.98, y - 0.04, z - 0.03 + i * 0.02], null, 0, 1);
      bd.add(new RoundedBoxGeometry(0.06, 0.06, 0.09, 1, 0.01), 'shell2', [x * 0.82, y, z - 0.02]);
      decal(bd, 3, 0.05, 0.12, V(x + Math.sign(x) * (r + 0.001), y + 0.05, z), V(Math.sign(x), 0, 0), V(0, 1, 0));
    } else bd.add(new RoundedBoxGeometry(0.17, len, 0.13, 2, 0.025), 'shell2', [x, y + 0.02, z]);
    const bell = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; bell.push([r * (0.45 + 0.45 * Math.pow(t, 0.7)), -t * (top ? 0.11 : 0.08)]); }
    const ny = y - (top ? len / 2 : len / 2 - 0.02);
    bd.push([x, ny, z], [-0.35, 0, 0]);
    bd.lathe(bell, 'nozzle', [0, 0, 0], null, 24);
    bd.lathe(bell.map(([rr, yy]) => [rr - 0.004, yy]).reverse(), 'nozzle', [0, 0, 0], null, 24);
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
    return new EnginePlume(door, { exits: [pos], dir, r0: B.r, len: top ? 4.5 : 2.2, style: top ? 'plasma' : 'blue', spread: 0.3, dia: 0.5, seed: 3.3 + i, owner: 'suit' });
  });
  const lamps = [];
  root.traverse((o) => { if (o.isMesh) { o.castShadow = o.material !== M.visorTint && o.material !== M.visorRefl && o.material !== M.mark; o.receiveShadow = true; } });
  // ---- the API
  const api = {
    root, M, spec, helm, sun, door, plumes, lamps, joints, J,
    /**
     * the limbs' angles from the pose they were built in (standing; rad): { thighL: [flex (+ the
     * knee forward), out], shinL: bend (+ the foot back), upperL: [raise (+ the hand forward), out],
     * foreL: bend (+ the hand up), ... } (see suitRig.js)
     */
    setPose(P) {
      for (const k of ['L', 'R']) {
        const s = k === 'L' ? -1 : 1;
        const t = P['thigh' + k], sh = P['shin' + k], u = P['upper' + k], f = P['fore' + k];
        if (t) joints['thigh' + k].rotation.set(t[0], 0, s * t[1]);
        if (sh !== undefined) joints['shin' + k].rotation.set(-sh, 0, 0);
        if (u) joints['upper' + k].rotation.set(u[0], 0, s * u[1]);
        if (f !== undefined) joints['fore' + k].rotation.set(f, 0, 0);
      }
    },
    /** the gold sun visor: 0 raised .. 1 down over the glass */
    setSunVisor(k) { sun.rotation.x = -0.95 * (1 - k); },
    /** the rear-entry door: 0 shut .. 1 open */
    setDoor(k) { door.rotation.y = k * 1.95; },
    /** helmet lamps on / off */
    setLamps(on) { M.lamp.emissiveIntensity = on ? 6 : 0; },
    /** boosters: their thrust (0..1 each) */
    setBoost(dt, l, r = l, air = 0) { plumes.forEach((p, i) => p.update(dt, i === 0 ? l : r, air, 0)); },
    /** reflections of the surroundings in the visor and on the shell */
    setEnv(env, k = 1) {
      for (const key of ['visorRefl', 'shell', 'shell2', 'plate', 'metal', 'anod', 'gold', 'nozzle', 'lens', 'accent']) {
        const m = M[key];
        if (m.envMap !== env) { const first = !m.envMap; m.envMap = env; if (first) m.needsUpdate = true; }
        if (key !== 'visorRefl') m.envMapIntensity = k;
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
      M.ledC.emissiveIntensity = 0.8 + 0.6 * Math.max(0, Math.sin(t * 2.2));
    },
    dispose() { root.parent && root.parent.remove(root); for (const p of plumes) p.dispose(); },
  };
  api.setLamps(false);
  return api;
}
