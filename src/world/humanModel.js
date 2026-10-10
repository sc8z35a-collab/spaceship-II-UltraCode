// People. One person is one skinned mesh on a skeleton of seventeen bones (pelvis, spine, chest,
// neck, head; shoulders, elbows and wrists; hips, knees and ankles): a body of real proportions —
// 1.6 to 1.9 m, the head an eighth of that, shoulders wider than hips, hands and feet their true
// size — built from smooth tapered parts, each bound to its bone (blended across the joints so an
// elbow bends instead of breaking). Clothes are painted on as colours by region: a station crew's
// coverall with its belt and a coloured yoke, a passenger's jacket and trousers, a pod crew's
// flight suit. The face is painted on a canvas — skin tone, eyes with whites, iris, pupil and a
// catch light, brows, the shading of the nose, lips, a little colour in the cheeks — under hair of
// its own colour and length. Two draw calls a person (the body, the face).
//
// pose(p, t): standing, walking (a stride with knee bend, arms swinging against the legs, a bob),
// holding a rail overhead, bracing against a push, seated, floating in weightlessness (the
// neutral posture: arms half raised, knees bent), panicking (hands to the head, looking round).
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// the skeleton (rest pose, metres; the person faces -z, their right side is +x)
const BONES = [
  ['pelvis', -1, [0, 0.95, 0]],
  ['spine', 0, [0, 0.1, 0]],
  ['chest', 1, [0, 0.2, 0]],
  ['neck', 2, [0, 0.26, 0]],
  ['head', 3, [0, 0.1, 0]],
  ['shoulderR', 2, [0.185, 0.21, 0]],
  ['elbowR', 5, [0.02, -0.29, 0]],
  ['wristR', 6, [0.005, -0.255, 0]],
  ['shoulderL', 2, [-0.185, 0.21, 0]],
  ['elbowL', 8, [-0.02, -0.29, 0]],
  ['wristL', 9, [-0.005, -0.255, 0]],
  ['hipR', 0, [0.095, -0.06, 0]],
  ['kneeR', 11, [0.005, -0.44, 0]],
  ['ankleR', 12, [0, -0.42, 0]],
  ['hipL', 0, [-0.095, -0.06, 0]],
  ['kneeL', 14, [-0.005, -0.44, 0]],
  ['ankleL', 15, [0, -0.42, 0]],
];
const B = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
export const BONE = B;

/** where each bone sits in the rest pose (model space) */
const REST = (() => {
  const out = [];
  for (const [, parent, p] of BONES) out.push(parent < 0 ? V(...p) : out[parent].clone().add(V(...p)));
  return out;
})();

// ------------------------------------------------------------------ the parts
/** a tapered tube between a and b (radius ra at a, rb at b; an ellipse: sx across, sz deep),
 * capped round at both ends; bound to bone k, blended into bone kp over its first `blend` */
function limb(P, a, b, ra, rb, k, kp, col, { sx = 1, sz = 1, blend = 0.18, seg = 10, rings = 7 } = {}) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const L = dir.length();
  dir.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir);
  const base = P.pos.length / 3;
  const rows = [];
  // the rounded ends: a few rings of a hemisphere at each end
  const prof = [];
  for (let i = 0; i <= 3; i++) { const a2 = (i / 3) * Math.PI / 2; prof.push([-Math.cos(a2) * ra * 0.9, Math.sin(a2) * ra]); }
  for (let i = 1; i < rings; i++) { const t = i / rings; prof.push([t * L, ra + (rb - ra) * t]); }
  for (let i = 0; i <= 3; i++) { const a2 = (i / 3) * Math.PI / 2; prof.push([L + Math.sin(a2) * rb * 0.9, Math.cos(a2) * rb]); }
  for (const [y, r] of prof) {
    const row = [];
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const v = V(Math.cos(th) * r * sx, y, Math.sin(th) * r * sz).applyQuaternion(q).add(a);
      P.pos.push(v.x, v.y, v.z);
      const n = V(Math.cos(th) * sx, 0, Math.sin(th) * sz).normalize().applyQuaternion(q);
      P.nrm.push(n.x, n.y, n.z);
      P.uv.push(j / seg, 0);
      const t = Math.max(0, Math.min(1, y / L));
      const w = kp >= 0 && t < blend ? 0.5 + 0.5 * (t / blend) : 1;
      P.si.push(k, kp >= 0 ? kp : 0, 0, 0);
      P.sw.push(w, 1 - w, 0, 0);
      const c = typeof col === 'function' ? col(t) : col;
      P.col.push(c.r, c.g, c.b);
      row.push(P.pos.length / 3 - 1);
    }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a1 = rows[i][j], b1 = rows[i][j + 1], c1 = rows[i + 1][j], d1 = rows[i + 1][j + 1];
    P.idx.push(a1, c1, b1, b1, c1, d1);
  }
  return base;
}

/** an ellipsoid (centre c, radii r) bound to bone k; col by height (t 0 bottom .. 1 top) */
function blob(P, c, r, k, col, { seg = 14, rings = 10, k2 = -1, w2 = 0 } = {}) {
  const rows = [];
  for (let i = 0; i <= rings; i++) {
    const ph = (i / rings) * Math.PI;
    const row = [];
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const n = V(Math.sin(ph) * Math.cos(th), -Math.cos(ph), Math.sin(ph) * Math.sin(th));
      const v = V(n.x * r.x, n.y * r.y, n.z * r.z).add(c);
      P.pos.push(v.x, v.y, v.z);
      const nn = V(n.x / r.x, n.y / r.y, n.z / r.z).normalize();
      P.nrm.push(nn.x, nn.y, nn.z);
      P.uv.push(j / seg, i / rings);
      P.si.push(k, k2 >= 0 ? k2 : 0, 0, 0);
      P.sw.push(1 - w2, w2, 0, 0);
      const cc = typeof col === 'function' ? col(i / rings, n) : col;
      P.col.push(cc.r, cc.g, cc.b);
      row.push(P.pos.length / 3 - 1);
    }
    rows.push(row);
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a1 = rows[i][j], b1 = rows[i][j + 1], c1 = rows[i + 1][j], d1 = rows[i + 1][j + 1];
    P.idx.push(a1, b1, c1, b1, d1, c1);
  }
}

/** the torso: a lofted body from the hips to the shoulders (elliptic sections: width, depth,
 * height, bone, blend bone) */
function torso(P, secs, col) {
  const seg = 16, rows = [];
  for (const s of secs) {
    const row = [];
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      // (flatter at the back than the front, the chest fuller forward)
      const zf = Math.sin(th) < 0 ? s.df : s.db;
      const v = V(Math.cos(th) * s.w / 2, s.y, Math.sin(th) * zf / 2 + (s.dz || 0));
      P.pos.push(v.x, v.y, v.z);
      const n = V(Math.cos(th) / s.w, 0, Math.sin(th) / zf).normalize();
      P.nrm.push(n.x, n.y, n.z);
      P.uv.push(j / seg, 0);
      P.si.push(s.k, s.k2 ?? s.k, 0, 0);
      P.sw.push(1 - (s.w2 || 0), s.w2 || 0, 0, 0);
      const c = col(s, th);
      P.col.push(c.r, c.g, c.b);
      row.push(P.pos.length / 3 - 1);
    }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a1 = rows[i][j], b1 = rows[i][j + 1], c1 = rows[i + 1][j], d1 = rows[i + 1][j + 1];
    P.idx.push(a1, b1, c1, b1, d1, c1);
  }
  // the shoulders' top and the crotch closed
  const top = rows[rows.length - 1], bot = rows[0];
  const ct = secs[secs.length - 1], cb = secs[0];
  const addC = (s, k) => { P.pos.push(0, s.y, s.dz || 0); P.nrm.push(0, k, 0); P.uv.push(0.5, 0.5); P.si.push(s.k, s.k, 0, 0); P.sw.push(1, 0, 0, 0); const c = col(s, 0); P.col.push(c.r, c.g, c.b); return P.pos.length / 3 - 1; };
  const it = addC(ct, 1), ib = addC(cb, -1);
  for (let j = 0; j < seg; j++) { P.idx.push(top[j], top[j + 1], it); P.idx.push(bot[j + 1], bot[j], ib); }
}

/** a head with the face's UVs: the front (-z) maps to the middle of the canvas */
function head(P, c, r, k) {
  const seg = 24, rings = 18, rows = [];
  for (let i = 0; i <= rings; i++) {
    const v0 = i / rings, ph = v0 * Math.PI;
    const row = [];
    for (let j = 0; j <= seg; j++) {
      const u0 = j / seg, th = u0 * Math.PI * 2;
      // (angle 0 at the back: the face, at u 0.5, looks along -z)
      let x = Math.sin(ph) * Math.sin(th), y = -Math.cos(ph), z = Math.sin(ph) * Math.cos(th);
      // a jaw narrower than the skull, the chin a little forward, the back of the head fuller
      const low = Math.max(0, -y);
      const sxk = 1 - 0.18 * low * low, szk = (z < 0 ? 1 + 0.06 * low : 1.06 - 0.12 * low);
      const v = V(x * r.x * sxk, y * r.y, z * r.z * szk).add(c);
      P.pos.push(v.x, v.y, v.z);
      const n = V(x / r.x, y / r.y, z / r.z).normalize();
      P.nrm.push(n.x, n.y, n.z);
      P.uv.push(u0, 1 - v0);
      P.si.push(k, 0, 0, 0);
      P.sw.push(1, 0, 0, 0);
      P.col.push(1, 1, 1);
      row.push(P.pos.length / 3 - 1);
    }
    rows.push(row);
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a1 = rows[i][j], b1 = rows[i][j + 1], c1 = rows[i + 1][j], d1 = rows[i + 1][j + 1];
    P.idx.push(a1, b1, c1, b1, d1, c1);
  }
}

// ------------------------------------------------------------------ looks
const SKIN = ['#f1d3bd', '#e8c0a0', '#d9a882', '#c48e68', '#a8704c', '#8a5638', '#6e4129'];
const HAIR = ['#1b1512', '#2b1f17', '#3d2b1f', '#5a3e2a', '#7a5a3a', '#a8865a', '#c9c2b8', '#2a2a2e'];
const IRIS = ['#3b2a1d', '#4a3423', '#2f4a5c', '#4d6b3a', '#5a4630', '#26303a'];
export const OUTFITS = {
  crew: (r) => ({ top: ['#2c3e57', '#33475f', '#3a3f4a'][r(3)], bottom: null, accent: ['#e07a2a', '#d8b23a', '#3aa0d8'][r(3)], shoes: '#1a1c20', belt: '#16181b' }),
  pod: (r) => ({ top: ['#d4652a', '#c95a24'][r(2)], bottom: null, accent: '#e8e8e2', shoes: '#26282c', belt: '#2a2c30' }),
  passenger: (r) => ({ top: ['#e8e4dc', '#2d3a4a', '#6b2a32', '#3d5a45', '#8a7a62', '#4a4f5a', '#c8b89a', '#1f2328'][r(8)], bottom: ['#2a2f38', '#3b3d42', '#6a6152', '#1c1e22', '#4b5262'][r(5)], accent: null, shoes: ['#2a1f18', '#1a1a1c', '#e2e2e0', '#5a4636'][r(4)], belt: '#20201f' }),
};

const FACE = new Map();
/** the face painted on a canvas: skin, eyes, brows, nose, lips, a little colour (cached by look) */
function faceTexture(look) {
  const key = `${look.skin}|${look.iris}|${look.hair}|${look.fem ? 1 : 0}|${Math.round((look.brow || 0) * 4)}`;
  if (FACE.has(key)) return FACE.get(key);
  const N = 256, c = document.createElement('canvas');
  c.width = N; c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = look.skin; g.fillRect(0, 0, N, N);
  // the face occupies the middle of the canvas (u 0.35..0.65); shading at its sides and under the
  // brow, colour in the cheeks and lips
  const cx = N / 2;
  const shade = (x, y, rx, ry, col, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry)); gr.addColorStop(0, col.replace('A', a)); gr.addColorStop(1, col.replace('A', 0)); g.save(); g.translate(x, y); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); g.translate(-x, -y); g.fillStyle = gr; g.beginPath(); g.arc(x, y, Math.max(rx, ry), 0, Math.PI * 2); g.fill(); g.restore(); };
  shade(cx - 22, 150, 12, 9, 'rgba(200,90,80,A)', 0.16);
  shade(cx + 22, 150, 12, 9, 'rgba(200,90,80,A)', 0.16);
  shade(cx, 118, 30, 9, 'rgba(60,30,20,A)', 0.10);                     // under the brow
  shade(cx, 140, 5, 12, 'rgba(70,35,25,A)', 0.10);                      // the nose's side shadow
  // eyes
  const eye = (x) => {
    const y = 125;
    g.fillStyle = 'rgba(70,40,30,0.35)'; g.beginPath(); g.ellipse(x, y - 1, 9.5, 5.2, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f4f0ea'; g.beginPath(); g.ellipse(x, y, 8, 4.2, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = look.iris; g.beginPath(); g.arc(x, y, 3.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0b0807'; g.beginPath(); g.arc(x, y, 1.7, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(x + 1.2, y - 1.2, 0.9, 0, Math.PI * 2); g.fill();
    // the upper lid's line
    g.strokeStyle = 'rgba(35,22,16,0.75)'; g.lineWidth = 1.3; g.beginPath(); g.ellipse(x, y + 0.5, 8.4, 4.8, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
  };
  eye(cx - 17); eye(cx + 17);
  // brows
  g.strokeStyle = look.hairDark; g.lineCap = 'round';
  g.lineWidth = look.fem ? 2.0 : 3.0 + look.brow;
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * 9, 115); g.quadraticCurveTo(cx + s * 17, 111 - look.brow, cx + s * 26, 115); g.stroke(); }
  // the nose: a soft highlight down its ridge, the nostrils
  shade(cx, 136, 3, 10, 'rgba(255,240,225,A)', 0.18);
  g.fillStyle = 'rgba(60,30,22,0.35)';
  g.beginPath(); g.ellipse(cx - 4, 149, 2.2, 1.3, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(cx + 4, 149, 2.2, 1.3, 0, 0, Math.PI * 2); g.fill();
  // lips
  g.fillStyle = look.fem ? 'rgba(170,70,72,0.75)' : 'rgba(150,80,70,0.55)';
  g.beginPath(); g.moveTo(cx - 10, 163); g.quadraticCurveTo(cx, 158, cx + 10, 163); g.quadraticCurveTo(cx, 169, cx - 10, 163); g.fill();
  g.strokeStyle = 'rgba(70,30,25,0.45)'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - 10, 163); g.quadraticCurveTo(cx, 164.5, cx + 10, 163); g.stroke();
  // the hairline over the forehead and round the back (the hair itself is its own shape)
  g.fillStyle = look.hair;
  g.fillRect(0, 0, N, 74);
  for (let x = 0; x < N; x += 2) { const d = Math.abs(x - cx) / 128; g.fillRect(x, 74, 2, 6 + 30 * d * d + Math.sin(x * 0.9) * 2); }
  g.fillRect(0, 0, N * 0.3, N * 0.55);
  g.fillRect(N * 0.7, 0, N * 0.3, N * 0.55);
  // ears' shadow at the sides of the face
  shade(N * 0.3, 135, 8, 16, 'rgba(90,45,30,A)', 0.2);
  shade(N * 0.7, 135, 8, 16, 'rgba(90,45,30,A)', 0.2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  FACE.set(key, t);
  return t;
}

/** random looks from a seed (the same seed, the same person) */
export function randomLook(seed, role = 'passenger') {
  let s = (seed * 9301 + 49297) % 233280;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const r = (n) => Math.floor(rnd() * n);
  const fem = rnd() < 0.45;
  const skin = SKIN[r(SKIN.length)];
  const hair = rnd() < 0.08 ? HAIR[6] : HAIR[r(6)];
  const h = (fem ? 1.6 : 1.7) + (rnd() - 0.4) * 0.16;
  return {
    seed, role, fem, skin, hair, hairDark: new THREE.Color(hair).multiplyScalar(0.7).getStyle(),
    iris: IRIS[r(IRIS.length)], brow: rnd() * 1.5,
    height: h, build: 0.9 + rnd() * 0.25, hairLen: fem ? 0.4 + rnd() * 0.6 : rnd() * 0.25,
    outfit: OUTFITS[role] ? OUTFITS[role](r) : OUTFITS.passenger(r),
    phase: rnd() * 100,
  };
}

const MATS = {};
function bodyMat() { return MATS.body || (MATS.body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 })); }

/**
 * A person: { root (an Object3D standing on the floor at its origin, facing -z), mesh, bones,
 * pose(p, t) }. look: from randomLook()
 */
export function buildPerson(look) {
  const P = { pos: [], nrm: [], uv: [], si: [], sw: [], col: [], idx: [] };
  const o = look.outfit;
  const C = (h) => new THREE.Color(h);
  const top = C(o.top), bot = C(o.bottom || o.top), shoes = C(o.shoes), skin = C(look.skin), hair = C(look.hair), belt = C(o.belt);
  const acc = o.accent ? C(o.accent) : null;
  const fem = look.fem;
  const W = look.build;
  // ---- the torso: hips to shoulders (a yoke of the accent colour across the chest of a coverall)
  const R0 = REST;
  const sec = (y, w, df, db, k, k2, w2, dz = 0) => ({ y, w: w * W, df: df * W, db: db * W, k, k2, w2, dz });
  const hipW = fem ? 0.35 : 0.33, waistW = fem ? 0.27 : 0.3, chestW = fem ? 0.32 : 0.36, shW = fem ? 0.36 : 0.41;
  torso(P, [
    sec(0.80, hipW * 0.9, 0.17, 0.2, B.pelvis),
    sec(0.88, hipW, 0.2, 0.22, B.pelvis),
    sec(0.97, hipW * 0.96, 0.2, 0.2, B.pelvis, B.spine, 0.3),
    sec(1.05, waistW, 0.18, 0.17, B.spine, B.pelvis, 0.2),
    sec(1.13, waistW * 1.02, 0.19, 0.17, B.spine),
    sec(1.22, chestW * 0.97, fem ? 0.25 : 0.22, 0.18, B.chest, B.spine, 0.3, fem ? -0.01 : 0),
    sec(1.31, chestW, fem ? 0.26 : 0.23, 0.19, B.chest, -1, 0, fem ? -0.012 : 0),
    sec(1.39, shW * 0.95, 0.19, 0.18, B.chest),
    sec(1.44, shW * 0.8, 0.15, 0.15, B.chest),
    sec(1.48, 0.15, 0.11, 0.11, B.chest, B.neck, 0.3),
  ], (s, th) => {
    if (acc && o.top && s.y > 1.26 && s.y < 1.36 && Math.sin(th) < 0.2) return acc;
    if (s.y > 0.95 && s.y < 1.0) return belt;
    return s.y < 0.97 ? bot : top;
  });
  // ---- neck and head (the face its own material: a group of its own)
  limb(P, V(0, 1.45, 0.005), V(0, 1.58, 0.01), 0.058, 0.052, B.neck, B.chest, skin, { blend: 0.3 });
  const bodyEnd = P.idx.length;
  const hc = V(0, 1.68, 0.0);
  head(P, hc, V(0.078, 0.112, 0.098), B.head);
  const headEnd = P.idx.length;
  // the hair: a cap over the top and back (longer: down to the shoulders), ears
  blob(P, hc.clone().add(V(0, 0.022, 0.012)), V(0.084, 0.098, 0.104), B.head, (t, n) => (n.y > -0.15 - look.hairLen * 0.5 && (n.z > -0.35 || n.y > 0.55) ? hair : skin), { seg: 18, rings: 12 });
  if (look.hairLen > 0.45) blob(P, hc.clone().add(V(0, -0.08, 0.05)), V(0.09, 0.09 + look.hairLen * 0.06, 0.06), B.head, hair, { seg: 12, rings: 8 });
  for (const s of [-1, 1]) blob(P, hc.clone().add(V(s * 0.079, -0.005, 0.012)), V(0.012, 0.03, 0.02), B.head, skin, { seg: 8, rings: 6 });
  // ---- arms
  for (const [sh, el, wr, s] of [[B.shoulderR, B.elbowR, B.wristR, 1], [B.shoulderL, B.elbowL, B.wristL, -1]]) {
    const a = R0[sh].clone().add(V(-s * 0.012, -0.01, 0)), e = R0[el], w = R0[wr];
    blob(P, a.clone().add(V(0, 0.005, 0)), V(0.06 * W, 0.06, 0.065 * W), sh, top, { seg: 10, rings: 8, k2: B.chest, w2: 0.25 });
    limb(P, a, e, (fem ? 0.046 : 0.054) * W, 0.04 * W, sh, B.chest, top, { blend: 0.12 });
    limb(P, e, w, 0.039 * W, 0.03 * W, el, sh, (t) => (t > 0.86 ? (o.top === o.bottom ? top : top) : top), { blend: 0.2 });
    // the hand: palm and fingers together, the thumb
    const hp = w.clone().add(V(0, -0.075, 0));
    blob(P, hp, V(0.022, 0.07, 0.042), wr, skin, { seg: 10, rings: 8 });
    blob(P, w.clone().add(V(-s * 0.0, -0.045, -0.035)), V(0.013, 0.03, 0.013), wr, skin, { seg: 8, rings: 6 });
    // the sleeve's cuff
    limb(P, w.clone().add(V(0, 0.04, 0)), w.clone().add(V(0, 0.005, 0)), 0.034 * W, 0.033 * W, el, -1, acc && o.top === OUTFITS ? acc : top, { seg: 10, rings: 2 });
  }
  // ---- legs
  for (const [hp, kn, an, s] of [[B.hipR, B.kneeR, B.ankleR, 1], [B.hipL, B.kneeL, B.ankleL, -1]]) {
    const a = R0[hp].clone().add(V(0, 0.04, 0)), k = R0[kn], f = R0[an];
    limb(P, a, k, (fem ? 0.088 : 0.084) * W, 0.054 * W, hp, B.pelvis, bot, { blend: 0.15, sx: 1, sz: 1.05 });
    limb(P, k, f.clone().add(V(0, 0.04, 0)), 0.054 * W, 0.036 * W, kn, hp, bot, { blend: 0.15 });
    // the shoe: heel to toe along -z
    blob(P, f.clone().add(V(0, -0.035, -0.045)), V(0.048, 0.042, 0.13), an, shoes, { seg: 12, rings: 8 });
  }
  // ---- the mesh: the body (vertex colours) and the face
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(P.nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(P.uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(P.col, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(P.si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(P.sw, 4));
  // (indices: the body, then the head, then the rest of the body)
  const idx = P.idx;
  const order = idx.slice(0, bodyEnd).concat(idx.slice(headEnd)).concat(idx.slice(bodyEnd, headEnd));
  geo.setIndex(order);
  const nBody = bodyEnd + (idx.length - headEnd);
  geo.addGroup(0, nBody, 0);
  geo.addGroup(nBody, headEnd - bodyEnd, 1);
  geo.computeBoundingSphere();
  // scaled to the person's height (the rest pose is 1.78 m to the crown)
  const k = look.height / 1.8;
  const bones = [];
  for (let i = 0; i < BONES.length; i++) {
    const bn = new THREE.Bone();
    bn.name = BONES[i][0];
    const parent = BONES[i][1];
    bn.position.fromArray(BONES[i][2]);
    if (parent >= 0) bones[parent].add(bn);
    bones.push(bn);
  }
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTexture(look), roughness: 0.6, metalness: 0 });
  const mesh = new THREE.SkinnedMesh(geo, [bodyMat(), faceMat]);
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  const root = new THREE.Group();
  root.scale.setScalar(k);
  root.add(mesh);
  const rest = bones.map((b) => b.position.clone());
  return {
    root, mesh, bones, look, rest, k,
    /** p: { mode: 'stand'|'walk'|'hold'|'brace'|'sit'|'float'|'panic', phase, speed, lookYaw, lookPitch, lean, holdY, brace } */
    pose(p, t) { posePerson(this, p, t); },
    dispose() { geo.dispose(); faceMat.dispose(); },
  };
}

const _e = new THREE.Euler();
function rot(b, x, y, z) { b.rotation.set(x, y, z, 'XYZ'); }

/**
 * set the bones for a moment of an activity (t: seconds, for breathing and fidgets). The bones'
 * signs (the person facing -z): a +x turn swings a hanging limb forward (hip: the thigh up in
 * front, shoulder: the arm forward and up), a -x turn of a knee folds the shin back, a +x turn of
 * an elbow folds the forearm up; +x leans the spine back, +x tips the head up; a +z turn takes the
 * right arm or leg out to the side, a -z turn the left
 */
export function posePerson(P, p, t) {
  const b = P.bones, ph = (p.phase || 0), L = P.look;
  const tt = t + L.phase;
  const breathe = Math.sin(tt * 1.6) * 0.012;
  for (let i = 0; i < b.length; i++) { b[i].position.copy(P.rest[i]); b[i].rotation.set(0, 0, 0); }
  const look = (yaw, pitch) => { rot(b[B.neck], pitch * 0.4, yaw * 0.4, 0); rot(b[B.head], pitch * 0.6, yaw * 0.6, 0); };
  const mode = p.mode || 'stand';
  if (mode === 'walk') {
    const s = Math.min(1.4, p.speed || 1);
    const a = Math.sin(ph), c = Math.cos(ph);
    const st = 0.42 * s;
    rot(b[B.hipR], -a * st, 0, 0); rot(b[B.hipL], a * st, 0, 0);
    // (the knee of the leg swinging through folds, the one bearing the weight stays nearly straight)
    rot(b[B.kneeR], -(Math.max(0, Math.sin(ph + 1.2)) * 0.95 * s + 0.05), 0, 0);
    rot(b[B.kneeL], -(Math.max(0, -Math.sin(ph + 1.2)) * 0.95 * s + 0.05), 0, 0);
    rot(b[B.ankleR], a * 0.15, 0, 0); rot(b[B.ankleL], -a * 0.15, 0, 0);
    rot(b[B.shoulderR], a * 0.36 * s, 0, 0.06); rot(b[B.shoulderL], -a * 0.36 * s, 0, -0.06);
    rot(b[B.elbowR], 0.25 + Math.max(0, a) * 0.3, 0, 0); rot(b[B.elbowL], 0.25 + Math.max(0, -a) * 0.3, 0, 0);
    rot(b[B.spine], -0.04 * s, a * 0.06, 0); rot(b[B.chest], 0, -a * 0.1, 0);
    b[B.pelvis].position.y = P.rest[B.pelvis].y - 0.02 * s + Math.abs(c) * 0.025 * s;
    rot(b[B.pelvis], 0, a * 0.08, -c * 0.03);
    look(p.lookYaw || 0, (p.lookPitch || 0) - 0.05);
    return;
  }
  if (mode === 'sit') {
    // hips on the seat point (the root is placed so), thighs out in front, shins down
    rot(b[B.hipR], 1.5, 0, 0.07); rot(b[B.hipL], 1.5, 0, -0.07);
    rot(b[B.kneeR], -1.45, 0, 0); rot(b[B.kneeL], -1.45, 0, 0);
    rot(b[B.ankleR], 0.05, 0, 0); rot(b[B.ankleL], 0.05, 0, 0);
    b[B.pelvis].position.y = P.rest[B.pelvis].y;
    const reach = p.reach || 0;           // the hands out on a console (0 .. 1)
    rot(b[B.shoulderR], 0.35 + 0.75 * reach, 0, 0.1); rot(b[B.shoulderL], 0.35 + 0.75 * reach, 0, -0.1);
    rot(b[B.elbowR], 1.25 - 0.75 * reach, 0, 0); rot(b[B.elbowL], 1.25 - 0.75 * reach, 0, 0);
    rot(b[B.chest], breathe - (p.lean || 0) * 0.2, 0, 0);
    rot(b[B.spine], 0.05 - (p.lean || 0) * 0.15, 0, (p.tilt || 0));
    look(p.lookYaw || 0, p.lookPitch || 0);
    return;
  }
  if (mode === 'float') {
    // the neutral posture of weightlessness: arms half up and forward, hips and knees bent
    rot(b[B.shoulderR], 0.75 + Math.sin(tt * 0.5) * 0.08, 0, 0.55); rot(b[B.shoulderL], 0.75 + Math.cos(tt * 0.45) * 0.08, 0, -0.55);
    rot(b[B.elbowR], 0.9, 0, 0); rot(b[B.elbowL], 0.9, 0, 0);
    rot(b[B.hipR], 0.55, 0, 0.08); rot(b[B.hipL], 0.5, 0, -0.08);
    rot(b[B.kneeR], -0.9, 0, 0); rot(b[B.kneeL], -0.95, 0, 0);
    rot(b[B.spine], -0.1, 0, 0);
    look(p.lookYaw || 0, (p.lookPitch || 0) + 0.1);
    return;
  }
  // standing kinds
  const lean = p.lean || 0, brace = p.brace || 0;
  rot(b[B.chest], breathe - lean * 0.15, Math.sin(tt * 0.23) * 0.03, 0);
  rot(b[B.spine], -lean * 0.2 - brace * 0.12, 0, 0);
  // weight from foot to foot now and then
  const shift = Math.sin(tt * 0.17) * 0.02;
  b[B.pelvis].position.x = P.rest[B.pelvis].x + shift;
  b[B.pelvis].position.y = P.rest[B.pelvis].y - brace * 0.12;
  rot(b[B.hipR], brace * 0.5, 0, 0.03 + brace * 0.1); rot(b[B.hipL], brace * 0.5, 0, -0.03 - brace * 0.1);
  rot(b[B.kneeR], -(brace * 0.95 + 0.04), 0, 0); rot(b[B.kneeL], -(brace * 0.95 + 0.04), 0, 0);
  rot(b[B.ankleR], brace * 0.45, 0, 0); rot(b[B.ankleL], brace * 0.45, 0, 0);
  if (mode === 'hold') {
    // one hand up on a loop or rail overhead (holdY: how high, 0..1), the other at the side
    const up = Math.min(1, Math.max(0.3, p.holdY ?? 0.8));
    rot(b[B.shoulderR], 2.7 * up, 0, -0.18); rot(b[B.elbowR], 0.3, 0, 0);
    rot(b[B.shoulderL], 0.05 + brace * 0.6, 0, -0.12 - brace * 0.5); rot(b[B.elbowL], 0.2 + brace * 0.4, 0, 0);
  } else if (mode === 'panic') {
    const k = Math.sin(tt * 7) * 0.15;
    rot(b[B.shoulderR], 2.3 + k, 0, -0.5); rot(b[B.elbowR], 1.9, 0, 0);
    rot(b[B.shoulderL], 2.3 - k, 0, 0.5); rot(b[B.elbowL], 1.9, 0, 0);
    look(Math.sin(tt * 2.3) * 0.8, 0.1);
    return;
  } else {
    // arms at rest (a little out when braced)
    rot(b[B.shoulderR], 0.04 + brace * 0.5, 0, 0.08 + brace * 0.6); rot(b[B.elbowR], 0.15 + brace * 0.5, 0, 0);
    rot(b[B.shoulderL], 0.04 + brace * 0.5, 0, -0.08 - brace * 0.6); rot(b[B.elbowL], 0.15 + brace * 0.5, 0, 0);
  }
  look((p.lookYaw || 0) + Math.sin(tt * 0.31) * 0.15, (p.lookPitch || 0) + Math.sin(tt * 0.19) * 0.05);
}
