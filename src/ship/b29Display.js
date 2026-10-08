// B-29's cockpit display: the desk, its monitors and the glazed canopy are gone; in front of the
// pilot one wide curved screen wraps round the seat (160 degrees across, from near the deck to
// above the head), set into a dark front bulkhead. Like H8's, it shows the outside as if the nose
// were not there — the picture of the cameras in the nose, drawn from where the pilot's eyes are —
// and the ship's pages lie on it as panels of its own pixels, touched where they are.
//
// The see-through: every material of B-29's own (hull, linings, fittings) drops what lies behind
// the screen as seen from the eye, so whatever is outside shows through it — the Earth, a station,
// H8 — and nothing of the nose. The screen itself is a film over it: a faint tint and the pixel
// grid, a lit bezel; damaged, red tearing spreads from where the nose was hit and dead areas go
// black; with the power or the nose cameras gone it is a dark pane.
import * as THREE from 'three';
import { halfWidthAt, heightRangeAt } from './hullShape.js';
import { INSET } from './interior.js';
import { shipUniforms } from './materials.js';
import { LAYER_NEAR } from '../core/layers.js';

const DEG = Math.PI / 180;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const B29D = {
  C: V(0, 1.17, -10.42),           // the pilot's eye: the screen's centre of curvature
  R: 1.15,
  az: [-80 * DEG, 80 * DEG],
  el: [-50 * DEG, 45 * DEG],
  brow: 74 * DEG,                   // the cowl above it, up to here
  wingZ: -10.6,                     // the bulkhead's side wings out to the walls
};

/** a direction from the centre at azimuth az (0 ahead, + to starboard) and elevation el */
export function dispDir(az, el, out = new THREE.Vector3()) {
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** a section of the sphere round the eye (ship frame), its face toward the eye */
export function sphereSection(az0, az1, el0, el1, R, NU = 48, NV = 24) {
  const pos = [], uv = [], idx = [];
  const d = new THREE.Vector3();
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    dispDir(az0 + (az1 - az0) * i / NU, el0 + (el1 - el0) * j / NV, d);
    pos.push(B29D.C.x + d.x * R, B29D.C.y + d.y * R, B29D.C.z + d.z * R);
    uv.push(i / NU, j / NV);
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, e = c + 1;
    idx.push(a, b, c, b, e, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** the skirt under the screen: from its bottom edge straight down to the deck */
export function skirtGeometry() {
  const D = B29D, N = 40, pos = [], idx = [];
  const d = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    dispDir(D.az[0] + (D.az[1] - D.az[0]) * i / N, D.el[0], d);
    const x = D.C.x + d.x * D.R, y = D.C.y + d.y * D.R, z = D.C.z + d.z * D.R;
    pos.push(x, y, z, x, 0.0, z);
  }
  for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * The bulkhead round the screen: on each side a wing from the screen's edge out to the hull wall,
 * deck to ceiling, and over the cowl's top edge a band right across (the nose behind is closed)
 */
export function bulkheadGeometry() {
  const D = B29D, z = D.wingZ, pos = [], idx = [];
  const d = new THREE.Vector3();
  const quad = (a, b, c, e) => { const i = pos.length / 3; pos.push(...a, ...b, ...c, ...e); idx.push(i, i + 1, i + 2, i, i + 2, i + 3); };
  // the screen's (and cowl's, skirt's) outline at the side, by height
  const yTop = D.C.y + Math.sin(D.brow) * D.R;
  const yBot = D.C.y + Math.sin(D.el[0]) * D.R;
  const innerX = (y) => {
    if (y <= yBot) return Math.sin(D.az[1]) * Math.cos(D.el[0]) * D.R;
    const el = Math.asin(Math.max(-1, Math.min(1, (y - D.C.y) / D.R)));
    return Math.sin(D.az[1]) * Math.cos(el) * D.R;
  };
  const [, ceil] = heightRangeAt(z, 0, INSET);
  const yC = Number.isFinite(ceil) ? ceil + 0.02 : 2.5;
  const N = 24;
  for (const s of [-1, 1]) {
    for (let k = 0; k < N; k++) {
      const y0 = Math.min(yTop, yC) * k / N, y1 = Math.min(yTop, yC) * (k + 1) / N;
      const w0 = halfWidthAt(z, Math.max(0.01, y0), INSET) + 0.02, w1 = halfWidthAt(z, Math.max(0.01, y1), INSET) + 0.02;
      const a = [s * innerX(y0), y0, z], b = [s * w0, y0, z], c = [s * w1, y1, z], e = [s * innerX(y1), y1, z];
      if (s > 0) quad(a, b, c, e); else quad(b, a, e, c);
    }
  }
  // over the top: from the cowl's top edge to the ceiling, right across
  if (yC > yTop) {
    for (let k = 0; k < 6; k++) {
      const y0 = yTop + (yC - yTop) * k / 6, y1 = yTop + (yC - yTop) * (k + 1) / 6;
      const w0 = halfWidthAt(z, y0, INSET) + 0.02, w1 = halfWidthAt(z, y1, INSET) + 0.02;
      quad([-w0, y0, z], [w0, y0, z], [w1, y1, z], [-w1, y1, z]);
    }
  }
  // the cowl's top edge back to the bulkhead (a lid over the gap between them)
  for (let i = 0; i < 24; i++) {
    const a0 = D.az[0] + (D.az[1] - D.az[0]) * i / 24, a1 = D.az[0] + (D.az[1] - D.az[0]) * (i + 1) / 24;
    const p0 = dispDir(a0, D.brow, d).clone().multiplyScalar(D.R).add(D.C), p1 = dispDir(a1, D.brow, d).clone().multiplyScalar(D.R).add(D.C);
    quad([p0.x, yTop, p0.z], [p1.x, yTop, p1.z], [p1.x, yTop, z], [p0.x, yTop, z]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** the screen's outline (a closed loop just in front of it) */
export function borderPoints(R) {
  const D = B29D, pts = [], N = 32;
  const P = (az, el) => dispDir(az, el).multiplyScalar(R).add(D.C);
  for (let i = 0; i < N; i++) pts.push(P(D.az[0] + (D.az[1] - D.az[0]) * i / N, D.el[0]));
  for (let i = 0; i < N / 2; i++) pts.push(P(D.az[1], D.el[0] + (D.el[1] - D.el[0]) * i / (N / 2)));
  for (let i = 0; i < N; i++) pts.push(P(D.az[1] - (D.az[1] - D.az[0]) * i / N, D.el[1]));
  for (let i = 0; i < N / 2; i++) pts.push(P(D.az[0], D.el[1] - (D.el[1] - D.el[0]) * i / (N / 2)));
  return pts;
}

// the ship's pages on the screen: panels of its own pixels, each with a row of tabs on top
const PANELS = [
  { id: 'sys', pages: [['sys', '船体・系統'], ['life', '生命維持'], ['comms', '通信']], az: -50, el: -6, w: 36, h: 27, res: 768 },
  { id: 'nav', pages: [['nav', '航法'], ['status', '状況']], az: 0, el: -25, w: 46, h: 25, res: 896 },
  { id: 'cam', pages: [['cam', 'カメラ']], az: 50, el: -6, w: 36, h: 27, res: 768 },
];

/** the panels as monitor slots (curved onto the screen, a few millimetres in front of it) */
export function displayPanels(L) {
  const D = B29D, R = D.R - 0.006;
  for (const p of PANELS) {
    const az = p.az * DEG, el = p.el * DEG;
    const az0 = az - p.w / 2 * DEG, az1 = az + p.w / 2 * DEG, el0 = el - p.h / 2 * DEG, el1 = el + p.h / 2 * DEG;
    const d = dispDir(az, el);
    const pos = d.clone().multiplyScalar(R).add(D.C);
    const up = V(-Math.sin(az) * Math.sin(el), Math.cos(el), Math.cos(az) * Math.sin(el)).normalize();
    const w = R * p.w * DEG * Math.cos(el), h = R * p.h * DEG;
    L.monitors.push({ id: p.id, pos, n: d.clone().negate(), up, w, h, room: 'cockpit', res: p.res, pages: p.pages, curve: { c: D.C.clone(), R, az0, az1, el0, el1 } });
  }
}

// ---------------------------------------------------------------------------- the see-through cut
export const CUT = {
  uCutOn: { value: 0 },
  uCutW: shipUniforms.uWorldToShip,             // world -> ship (the ship materials' own matrix)
  uCutC: { value: B29D.C.clone() },
  uCutR: { value: B29D.R },
  uCutAz: { value: new THREE.Vector2(B29D.az[0], B29D.az[1]) },
  uCutEl: { value: new THREE.Vector2(B29D.el[0], B29D.el[1]) },
};

const CUT_FRAG = /* glsl */`
uniform float uCutOn; uniform mat4 uCutW; uniform vec3 uCutC; uniform float uCutR; uniform vec2 uCutAz; uniform vec2 uCutEl;
varying vec3 vCutP;
// does the line from the eye to p cross the screen on the way (the screen is in front of p)?
bool behindScreen(vec3 p){
  if (uCutOn < 0.5) return false;
  if (length(p - uCutC) > 5.5) return false;
  vec3 O = (uCutW * vec4(cameraPosition, 1.0)).xyz;
  vec3 dv = p - O; float L = length(dv); dv /= max(L, 1e-5);
  vec3 oc = O - uCutC;
  float b = dot(oc, dv), c = dot(oc, oc) - uCutR * uCutR;
  float disc = b * b - c;
  if (disc <= 0.0) return false;
  float sq = sqrt(disc);
  for (int k = 0; k < 2; k++){
    float t = k == 0 ? -b - sq : -b + sq;
    if (t <= 0.0 || t >= L - 0.002) continue;
    vec3 X = (O + dv * t - uCutC) / uCutR;
    float az = atan(X.x, -X.z), el = asin(clamp(X.y, -1.0, 1.0));
    if (az > uCutAz.x && az < uCutAz.y && el > uCutEl.x && el < uCutEl.y) return true;
  }
  return false;
}`;

/** give a material of the ship's the cut (chained after whatever patches it has already) */
export function addDisplayCut(mat) {
  if (!mat || mat.userData.dispCut || mat.isShaderMaterial || mat.isRawShaderMaterial) return mat;
  mat.userData.dispCut = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    if (!sh.vertexShader.includes('#include <begin_vertex>') || !sh.fragmentShader.includes('#include <clipping_planes_fragment>')) return;
    Object.assign(sh.uniforms, CUT);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uCutW;\nvarying vec3 vCutP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          mat4 _cm = modelMatrix;
          #ifdef USE_INSTANCING
          _cm = _cm * instanceMatrix;
          #endif
          vCutP = (uCutW * _cm * vec4(transformed, 1.0)).xyz;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CUT_FRAG)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  if (behindScreen(vCutP)) discard;');
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|dispCut';
  mat.needsUpdate = true;
  return mat;
}

/** the cut on everything under these roots (a material shared by many meshes is patched once) */
export function cutAll(...roots) {
  for (const root of roots) {
    if (!root) continue;
    root.traverse((o) => {
      if (!o.material || o.userData.noCut) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) addDisplayCut(m);
    });
  }
}

// ---------------------------------------------------------------------------- the screen itself
const MAX_IMP = 8;

const FILM_VERT = /* glsl */`
varying vec3 vDir;
varying vec2 vUv;
uniform vec3 uC;
void main(){
  vDir = position - uC;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FILM_FRAG = /* glsl */`
uniform float uOn;        // picture on (power, boot, the nose cameras)
uniform float uBoot;
uniform float uTime;
uniform float uFlick;
uniform float uCamHealth;
uniform vec4 uImp[${MAX_IMP}];   // dir.xyz, angular radius
uniform vec4 uImpK[${MAX_IMP}];  // strength, seed, age, -
uniform vec2 uAz; uniform vec2 uEl;
varying vec3 vDir;
varying vec2 vUv;
float h21(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main(){
  vec3 d = normalize(vDir);
  float az = atan(d.x, -d.z), el = asin(clamp(d.y, -1.0, 1.0));
  vec2 px = vec2(az, el) * 900.0;                // the screen's pixels (about 0.06 deg)
  float edge = min(min(az - uAz.x, uAz.y - az), min(el - uEl.x, uEl.y - el));
  // the film over the picture: a faint tint, the pixel grid where it is resolved, the edge darkening
  float gk = 1.0 - smoothstep(0.3, 0.6, max(fwidth(px.x), fwidth(px.y)));
  vec2 pf = fract(px);
  float grid = gk * (1.0 - smoothstep(0.0, 0.2, min(pf.x, pf.y))) * 0.18;
  vec3 col = vec3(0.004, 0.008, 0.014);
  float a = 0.05 + grid * 0.3 + (1.0 - smoothstep(0.0, 0.05, edge)) * 0.5;
  // damage: torn red bands and noise spreading from where the nose was hit, dead areas black at the
  // worst (the impacts lie in direction space, so they run across the whole screen continuously)
  float dmg = 0.0, dead = 0.0;
  for (int i = 0; i < ${MAX_IMP}; i++){
    vec4 I = uImp[i];
    if (I.w <= 0.0) continue;
    vec4 K = uImpK[i];
    float ang = acos(clamp(dot(d, I.xyz), -1.0, 1.0));
    float s = ang / I.w;
    float wob = 0.75 + 0.5 * vn(vec2(az, el) * 9.0 + K.y * 13.0);
    dmg = max(dmg, K.x * (1.0 - smoothstep(0.3, 1.3, s * wob)));
    dead = max(dead, step(0.6, K.x) * (1.0 - smoothstep(0.15, 0.45, s * wob)));
  }
  // the cameras themselves failing: grain and drop-outs over everything
  float camBad = 1.0 - uCamHealth;
  if (dmg > 0.0 || camBad > 0.05) {
    float band = floor(px.y / 6.0);
    float tear = step(0.7, h21(vec2(band, floor(uTime * 9.0)))) * dmg;
    float blk = step(0.55, h21(floor(px / vec2(48.0, 5.0)) + floor(uTime * 7.0)));
    vec3 red = vec3(0.9, 0.06, 0.05) * (0.35 + 0.65 * h21(floor(px / vec2(3.0, 1.0)) + uTime));
    col = mix(col, red, dmg * (0.35 + 0.5 * blk));
    a = max(a, dmg * (0.3 + 0.55 * blk) + tear * 0.5);
    float grain = h21(px + fract(uTime * 37.0) * 91.0);
    col = mix(col, vec3(grain * 0.6), camBad * 0.5);
    a = max(a, camBad * camBad * (0.25 + 0.5 * step(0.8, h21(vec2(floor(px.y / 3.0), floor(uTime * 15.0))))));
  }
  col = mix(col, vec3(0.0), dead);
  a = max(a, dead);
  // flicker of the supply, the boot sweep
  float on = uOn * uBoot;
  float sweep = smoothstep(uBoot * 1.3 - 0.25, uBoot * 1.3, vUv.y);
  col += vec3(0.2, 0.55, 0.9) * (1.0 - smoothstep(0.0, 0.04, abs(vUv.y - uBoot * 1.3 + 0.1))) * step(uBoot, 0.99) * 0.6 * uOn;
  float off = max(1.0 - on, sweep * step(uBoot, 0.99));
  // off: a dark glass pane with a little sheen
  vec3 offCol = vec3(0.012, 0.014, 0.018) + vec3(0.02, 0.025, 0.03) * smoothstep(0.4, 1.0, vUv.y);
  col = mix(col, offCol, off);
  a = mix(a, 0.985, off);
  a = min(1.0, a + uFlick * 0.6);
  gl_FragColor = vec4(col, a);
}`;

export class B29Display {
  constructor(game) {
    this.g = game;
    this.power = 1;
    this.boot = 1;
    this.flick = 0;
    this.imps = [];        // { dir (ship frame, from the eye), r (rad), k, seed, age }
    const D = B29D;
    this.U = {
      uOn: { value: 1 }, uBoot: { value: 1 }, uTime: { value: 0 }, uFlick: { value: 0 }, uCamHealth: { value: 1 },
      uImp: { value: Array.from({ length: MAX_IMP }, () => new THREE.Vector4()) },
      uImpK: { value: Array.from({ length: MAX_IMP }, () => new THREE.Vector4()) },
      uAz: { value: new THREE.Vector2(D.az[0], D.az[1]) }, uEl: { value: new THREE.Vector2(D.el[0], D.el[1]) },
      uC: { value: D.C.clone() },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: FILM_VERT, fragmentShader: FILM_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(sphereSection(D.az[0], D.az[1], D.el[0], D.el[1], D.R, 64, 32), mat);
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    this.mesh.userData.noCut = true;
    game.shipVis.root.add(this.mesh);
    this.mesh.layers.set(LAYER_NEAR);
  }

  /** after the ship's meshes are all there: the cut on every material of B-29's */
  init() {
    const g = this.g;
    cutAll(g.shipVis.root, g.machines && g.machines.root, g.loose && g.loose.group, ...Object.values(g.doors || {}).map((d) => d.group));
  }

  /** a blow on the nose: the picture tears where it struck (dirLocal: ship frame, from the eye) */
  hit(pLocal, E) {
    const dir = pLocal.clone().sub(B29D.C).normalize();
    const k = Math.min(1, 0.2 + E / 2.5e6);
    const r = Math.min(0.7, 0.08 + 0.18 * Math.cbrt(E / 1e6));
    const ex = this.imps.find((x) => x.dir.angleTo(dir) < Math.max(x.r, r) * 0.7);
    if (ex) { ex.k = Math.min(1, ex.k + k * 0.6); ex.r = Math.min(0.9, Math.max(ex.r, r) * 1.06); ex.age = 0; }
    else {
      if (this.imps.length >= MAX_IMP) { let iMin = 0; this.imps.forEach((x, i) => { if (x.k * x.r < this.imps[iMin].k * this.imps[iMin].r) iMin = i; }); this.imps.splice(iMin, 1); }
      this.imps.push({ dir, r, k, seed: Math.random(), age: 0 });
    }
    this.flick = Math.min(1, this.flick + 0.6 + E / 4e6);
    this.sync();
  }

  repair() { this.imps.length = 0; this.sync(); }

  sync() {
    const U = this.U;
    for (let i = 0; i < MAX_IMP; i++) {
      const m = this.imps[i];
      if (m) { U.uImp.value[i].set(m.dir.x, m.dir.y, m.dir.z, m.r); U.uImpK.value[i].set(m.k, m.seed, m.age, 0); }
      else U.uImp.value[i].set(0, 0, 0, 0);
    }
  }

  /** per frame: power and boot, the nose cameras' health, the cut on while the eye is aboard */
  update(dt) {
    const g = this.g;
    const power = g.systems.power ?? 1;
    const wasOn = this.power > 0.5;
    this.power = power < 0.15 ? 0 : 1;
    if (this.power > 0.5 && !wasOn) this.boot = 0;
    this.boot = Math.min(1, this.boot + dt / 1.4);
    this.flick = Math.max(0, this.flick - dt * 2.5);
    const camH = g.damage ? g.damage.health.cameras[1] : 1;
    const U = this.U;
    const on = this.power > 0.5 && camH > 0.12 && !(g.damage && g.damage.broken);
    U.uOn.value = on ? 1 : 0;
    U.uBoot.value = this.boot;
    U.uTime.value = (U.uTime.value + dt) % 1000;
    U.uFlick.value = this.flick + (g.systems.flicker || 0) * 0.5;
    U.uCamHealth.value = Math.max(0, Math.min(1, (camH - 0.12) / 0.6));
    for (const m of this.imps) m.age += dt;
    // the outside shows through only while the picture is up and the eye is aboard
    CUT.uCutOn.value = on && this.boot > 0.6 && g._cabInside && g.mode !== 'camera' ? 1 : 0;
  }

  serialize() { return { i: this.imps.map((m) => [m.dir.x, m.dir.y, m.dir.z, m.r, m.k, m.seed].map((x) => +x.toFixed(4))) }; }
  restore(s) {
    this.imps = ((s && s.i) || []).slice(0, MAX_IMP).map((r) => ({ dir: V(r[0], r[1], r[2]).normalize(), r: r[3], k: r[4], seed: r[5], age: 99 }));
    this.sync();
  }
}
