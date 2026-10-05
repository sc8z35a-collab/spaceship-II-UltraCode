// The cockpit's all-round display: what H8's four outside cameras see, stitched in real time and
// shown on every surface round Kaito — the whole inside of the cockpit sphere and the floor under
// his feet (the floor is a sheet of display glass; the hatch in it slides away under the glass).
// While he is inside, H8's own hull is left out of the picture (the cameras look past it), so the
// world shows as if there were no walls at all — through faint panel seams and the thin line where
// one camera hands over to the next. On top:
//   - the horizon and pitch ladder, drawn by the display itself (always sharp, every frame);
//   - small markers on everything trackable, placed along the line from Kaito's eye so they sit
//     exactly on the object behind them (on the floor too);
//   - lock-on: whatever he keeps looking at for a moment is locked (several at once; rocks on a
//     collision course and hostile drones lock themselves), each with its bracket, name, range and
//     closing speed;
//   - the information tabs (h8Tabs.js), which he can fold and move anywhere on the sphere.
// A damaged camera shows: its quarter of the picture goes grainy, tears, drops blocks, turns murky
// and, when the camera is gone, dead grey static with "NO SIGNAL" — blended across the seams.
// Big hits make the whole display stutter. Dark when H8 is powered down; the panels come up one
// by one.
import * as THREE from 'three';
import { H8, CAMERAS } from './h8Spec.js';
import { R_EARTH } from '../core/astro.js';
import { LAYER_NEAR } from '../core/layers.js';

const VERT = /* glsl */`
varying vec3 vP;
#ifdef DOOR
uniform mat4 uDoorM;     // the sliding panel's own placement in the cockpit
#endif
void main(){
#ifdef DOOR
  vP = (uDoorM * vec4(position, 1.0)).xyz;
#else
  vP = position;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */`
uniform float uPower;     // 0 off .. 1 on (the boot sweeps through it)
uniform vec3 uCam[4];
uniform float uCamH[4];   // camera health (1 fine .. 0 gone)
uniform vec3 uC;          // cockpit centre
uniform vec3 uEye;        // Kaito's eye (H8-local)
uniform vec3 uUp;         // local vertical (H8-local), for the horizon
uniform float uLadder;    // 0..1 horizon / ladder brightness
uniform float uTime;
uniform float uZoom;      // view magnification (the fine lines fade while zoomed)
uniform float uGlitch;    // the whole display stutters (power dips after hits)
varying vec3 vP;
float hsh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// a line where x == 0, w pixels wide, antialiased by its size on screen (no shimmer when moving)
float aline(float x, float w){ float fw = max(fwidth(x), 1e-6); return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0, abs(x) / fw); }
void main(){
  // the line of sight through this point: what is seen here lies that way
  vec3 d = normalize(vP - uEye);
  float zoomFade = 1.0 - smoothstep(1.4, 3.0, uZoom);
  // the panel grid: on the sphere by direction from its centre, on the floor square tiles
#ifdef FLOOR
  vec2 g = vP.xz / 0.24;
#else
  vec3 dC = normalize(vP - uC);
  vec2 g = vec2(atan(dC.x, -dC.z) / 6.28318 * 30.0, asin(clamp(dC.y, -1.0, 1.0)) / 3.14159 * 15.0);
#endif
  vec2 pan = floor(g);
  vec2 fg = fract(g) - 0.5;
  float bez = max(aline(fg.x, 1.3), aline(fg.y, 1.3)) * zoomFade;
  float bootK = uPower * 1.15 - hsh(pan) * 0.9;
  float on = smoothstep(0.0, 0.08, bootK);
  // which camera sees this way; the damage of its sector, blended across the seam
  float b1 = -2.0, b2 = -2.0, h1 = 1.0, h2 = 1.0;
  for (int i = 0; i < 4; i++){
    float k = dot(d, uCam[i]);
    if (k > b1){ b2 = b1; h2 = h1; b1 = k; h1 = uCamH[i]; } else if (k > b2){ b2 = k; h2 = uCamH[i]; }
  }
  float hl = mix(0.5 * (h1 + h2), h1, smoothstep(0.0, 0.07, b1 - b2));
  float seam = aline(b1 - b2, 1.2) * zoomFade;
  float dmg = 1.0 - hl;
  // horizon and pitch ladder, seen from the eye
  float s = dot(d, uUp);
  vec3 e1 = normalize(cross(uUp, abs(uUp.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(uUp, e1);
  float az = atan(dot(d, e2), dot(d, e1));
  float el = asin(clamp(s, -1.0, 1.0)) * 57.2958;
  float lad = aline(el, 1.6) * 0.75;
  for (int k = 1; k <= 3; k++){
    float a = k == 1 ? 10.0 : k == 2 ? 30.0 : 60.0;
    float up = aline(el - a, 1.0);
    float dn = aline(el + a, 1.0) * step(0.5, fract(az * 18.0 / 3.14159));
    lad = max(lad, (up + dn) * 0.38);
  }
  lad *= uLadder * mix(0.35, 1.0, zoomFade);
  vec3 col = vec3(0.0);
  float alpha = mix(1.0, 0.035, on);
  // ---- a damaged camera's sector (noise in screen pixels: it stays fine when zoomed)
  vec2 sp = gl_FragCoord.xy;
  float tt = floor(uTime * 24.0);
  if (dmg > 0.04){
    float px = 1.0 + floor(dmg * 3.5);
    float n = hsh(floor(sp / px) + vec2(tt * 1.37, tt * 0.71));
    float snow = smoothstep(0.08, 1.0, dmg) * (0.2 + 0.8 * dmg);
    float row = floor(sp.y / (2.0 + 7.0 * dmg));
    float tear = step(1.0 - 0.22 * dmg * dmg, hsh(vec2(row, tt)));
    float blk = step(1.0 - dmg * dmg * 0.75, hsh(pan * 1.7 + floor(uTime * (1.5 + 5.0 * dmg)) * 0.37));
    float murk = smoothstep(0.25, 0.85, dmg) * 0.6;
    vec3 c = mix(vec3(0.03, 0.035, 0.04), vec3(0.08 + 0.6 * n), snow);
    float aa = max(murk, snow * (0.3 + 0.45 * n));
    // colour fringes: the picture's channels slip apart
    c += vec3(0.35, 0.0, 0.25) * step(0.985 - 0.04 * dmg, hsh(vec2(floor(sp.y / 3.0), tt + 7.0))) * dmg;
    if (tear > 0.5){ c = mix(c, vec3(0.65, 0.7, 0.75) * hsh(vec2(row, tt + 3.0)), 0.85); aa = max(aa, 0.45 + 0.45 * dmg); }
    if (blk > 0.5 && dmg > 0.3){ c = vec3(0.012) + vec3(0.07 * n); aa = max(aa, 0.94); }
    // the camera is gone: dead grey static, rolling
    if (hl < 0.15){
      float roll = fract(sp.y / 220.0 - uTime * 0.6);
      c = vec3(0.035, 0.04, 0.045) + vec3(0.14 * n) + vec3(0.05) * smoothstep(0.96, 1.0, roll);
      aa = 0.97;
    }
    col = c;
    alpha = max(alpha, aa * on);
  }
  // the whole display stutters
  if (uGlitch > 0.0){
    float gb = step(1.0 - 0.35 * uGlitch, hsh(vec2(floor(sp.y / 4.0), tt)));
    col = mix(col, vec3(0.75), gb * 0.7);
    alpha = max(alpha, gb * 0.65 * uGlitch);
  }
  col += vec3(0.25, 0.45, 0.6) * seam * 0.05 * on;
  col += vec3(0.5, 0.9, 1.0) * lad * on;
  alpha = max(alpha, lad * 0.8 * on);
  alpha = max(alpha, bez * (0.45 * on + 0.75 * (1.0 - on)));
  col = mix(col, vec3(0.012), bez * 0.85);
  // a booting panel: a brief edge glow as it comes up
  col += vec3(0.4, 0.7, 1.0) * smoothstep(0.08, 0.0, abs(bootK - 0.04)) * (1.0 - step(0.999, uPower)) * 0.6;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`;

export const HUD_COL = { cyan: 'rgba(130,232,255,0.95)', dim: 'rgba(150,215,245,0.62)', red: 'rgba(255,92,64,0.98)', amber: 'rgba(255,190,90,0.97)', green: 'rgba(120,255,170,0.95)', white: 'rgba(225,242,255,0.96)' };
const C = HUD_COL;
const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",system-ui,sans-serif';
const MONO = '"SF Mono","Menlo","Consolas","Noto Sans Mono",monospace';
const DEG = Math.PI / 180;

/** a short readable distance */
export function fmtDist(m) {
  if (m > 9.5e5) return (m / 1000).toFixed(0) + ' km';
  if (m > 9500) return (m / 1000).toFixed(1) + ' km';
  return m.toFixed(0) + ' m';
}

export function altOf(pos) { return pos.length() - R_EARTH; }

const MARK_R = 0.9;        // sprite sizes are set for this distance (they are moved onto the display)
const LOCK_MAX = 8;
const FOCUS = 6.5 * DEG;   // the focus cone round the line of sight
const DWELL = 0.4;         // s of looking before a lock

/** the floor: a disc of display glass at H8.floorY with the round hatch opening behind the seat */
export const FLOOR = (() => {
  const Cc = H8.cockpitC, R = H8.cockpitR;
  const r = Math.sqrt(R * R - (Cc.y - H8.floorY) ** 2);
  return { y: H8.floorY, r, c: new THREE.Vector3(Cc.x, H8.floorY, Cc.z), hatch: new THREE.Vector3(0, H8.floorY, H8.shaftZ), hatchR: H8.shaftR + 0.02 };
})();

function canvasTex(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return { c, g: c.getContext('2d'), tex };
}

function sprite(w, h, angW, center) {
  const t = canvasTex(w, h);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.tex, transparent: true, depthWrite: false, toneMapped: false }));
  const sw = 2 * MARK_R * Math.tan(angW * DEG / 2);
  sp.scale.set(sw, sw * h / w, 1);
  if (center) sp.center.set(center[0], center[1]);
  sp.layers.set(LAYER_NEAR);
  sp.renderOrder = 25;
  sp.visible = false;
  return Object.assign(t, { sp });
}

const inLocker = (az, el) => {
  const L = H8.locker;
  let d = az - L.az;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) < L.hw && el > L.el0 && el < L.el1;
};

/** the inside of the cockpit sphere above the floor (facing in), less the suit locker's panel */
function sphereGeometry() {
  const Cc = H8.cockpitC, R = H8.cockpitR;
  const pos = [], idx = [];
  const NA = 120, NE = 60;
  for (let j = 0; j <= NE; j++) {
    const el = -Math.PI / 2 + Math.PI * j / NE;
    for (let i = 0; i <= NA; i++) {
      const az = -Math.PI + i / NA * Math.PI * 2;
      pos.push(Cc.x + Math.sin(az) * Math.cos(el) * R, Cc.y + Math.sin(el) * R, Cc.z - Math.cos(az) * Math.cos(el) * R);
    }
  }
  for (let j = 0; j < NE; j++) {
    const elTop = -Math.PI / 2 + Math.PI * (j + 1) / NE;
    if (Cc.y + Math.sin(elTop) * R < H8.floorY - 0.005) continue;      // under the floor
    for (let i = 0; i < NA; i++) {
      const az = -Math.PI + (i + 0.5) / NA * Math.PI * 2, el = -Math.PI / 2 + Math.PI * (j + 0.5) / NE;
      if (inLocker(az, el)) continue;
      const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** the locker's panel: the patch of the sphere it covers (it slides along the sphere to open) */
function lockerGeometry() {
  const Cc = H8.cockpitC, R = H8.cockpitR - 0.006, L = H8.locker;
  const pos = [], idx = [];
  const NA = 12, NE = 16;
  const a0 = -L.hw, a1 = L.hw;
  for (let j = 0; j <= NE; j++) {
    const el = L.el0 + (L.el1 - L.el0) * j / NE;
    for (let i = 0; i <= NA; i++) {
      const az = L.az + a0 + (a1 - a0) * i / NA;
      pos.push(Cc.x + Math.sin(az) * Math.cos(el) * R, Cc.y + Math.sin(el) * R, Cc.z - Math.cos(az) * Math.cos(el) * R);
    }
  }
  for (let j = 0; j < NE; j++) for (let i = 0; i < NA; i++) {
    const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // about the cockpit's middle (it turns round the vertical through it)
  g.translate(-Cc.x, 0, -Cc.z);
  return g;
}

/** the floor glass with the hatch opening */
function floorGeometry() {
  const sh = new THREE.Shape();
  sh.absarc(0, 0, FLOOR.r, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(FLOOR.hatch.x - FLOOR.c.x, -(FLOOR.hatch.z - FLOOR.c.z), FLOOR.hatchR, 0, Math.PI * 2, true);
  sh.holes.push(hole);
  const g = new THREE.ShapeGeometry(sh, 64);
  g.rotateX(-Math.PI / 2);
  g.translate(FLOOR.c.x, FLOOR.y, FLOOR.c.z);
  return g;
}

export class H8Display {
  constructor() {
    const uniforms = {
      uPower: { value: 0 },
      uCam: { value: CAMERAS.map((c) => c.dir.clone()) }, uCamH: { value: [1, 1, 1, 1] },
      uC: { value: H8.cockpitC.clone() }, uEye: { value: H8.cockpitC.clone() },
      uUp: { value: new THREE.Vector3(0, 1, 0) }, uLadder: { value: 1 },
      uTime: { value: 0 }, uZoom: { value: 1 }, uGlitch: { value: 0 }, uDoorM: { value: new THREE.Matrix4() },
    };
    this.uniforms = uniforms;
    const mk = (defines) => new THREE.ShaderMaterial({ uniforms, defines, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.mat = mk({});
    this.matFloor = mk({ FLOOR: 1 });
    this.matDoor = mk({ DOOR: 1 });
    this.mesh = new THREE.Group();
    this.mesh.name = 'h8Display';
    const add = (geo, mat, order) => {
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = order;
      m.frustumCulled = false;
      m.layers.set(LAYER_NEAR);
      this.mesh.add(m);
      return m;
    };
    this.sphere = add(sphereGeometry(), this.mat, 20);
    this.floor = add(floorGeometry(), this.matFloor, 20);
    // the hatch cover: a disc of the same glass; it slides away sideways under the floor
    const hg = new THREE.CircleGeometry(FLOOR.hatchR + 0.03, 48);
    hg.rotateX(-Math.PI / 2);
    this.hatchMesh = add(hg, this.matFloor, 19);
    this.hatchOpen = 0;
    this.setHatch(0);
    // the suit locker's panel: a piece of the display that slides aside along the sphere
    this.lockerPivot = new THREE.Group();
    this.lockerPivot.position.set(H8.cockpitC.x, 0, H8.cockpitC.z);
    this.mesh.add(this.lockerPivot);
    this.lockerDoor = new THREE.Mesh(lockerGeometry(), this.matDoor);
    this.lockerDoor.renderOrder = 19;
    this.lockerDoor.frustumCulled = false;
    this.lockerDoor.layers.set(LAYER_NEAR);
    this.lockerPivot.add(this.lockerDoor);
    // its edge glows while it moves
    const eg = new THREE.EdgesGeometry(lockerGeometry(), 30);
    this.lockerEdge = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    this.lockerEdge.layers.set(LAYER_NEAR);
    this.lockerEdge.renderOrder = 21;
    this.lockerPivot.add(this.lockerEdge);
    this.power = 0;
    this.t = 0;
    this.glitch = 0;
    this.zoom = 1;
    // the markers sit on the display along the lines from the eye
    this.marks = new THREE.Group();
    this.mesh.add(this.marks);
    this.orbit = {};
    for (const k of ['pro', 'retro', 'zen', 'nad']) {
      const s = sprite(128, 104, 5.2, [0.5, 64 / 104]);
      this.drawOrbitMark(s, k);
      this.marks.add(s.sp);
      this.orbit[k] = s;
    }
    this.pips = [];
    for (let i = 0; i < 28; i++) { const s = sprite(256, 64, 9, [24 / 256, 0.5]); s.key = ''; this.marks.add(s.sp); this.pips.push(s); }
    this.lockSlots = [];
    for (let i = 0; i < LOCK_MAX + 4; i++) { const s = sprite(512, 192, 18, [96 / 512, 0.5]); s.used = false; this.marks.add(s.sp); this.lockSlots.push(s); }
    this.focus = sprite(128, 128, 2 * FOCUS / DEG * 1.05);
    this.marks.add(this.focus.sp);
    // what a damaged camera's sector says about itself
    this.camLabels = CAMERAS.map(() => { const s = sprite(320, 72, 13); s.key = ''; this.marks.add(s.sp); return s; });
    this.camH = [1, 1, 1, 1];
    this.locks = [];          // { id, c (candidate), slot, t, redraw }
    this.dwell = new Map();   // id -> s looked at
    this.lastFocus = -1;
    this.eye = H8.cockpitC.clone();
  }

  /** the floor hatch: 0 shut .. 1 open (slid aside under the glass) */
  setHatch(e) {
    this.hatchOpen = e;
    const k = e * e * (3 - 2 * e);
    this.hatchMesh.position.set(FLOOR.hatch.x + k * (FLOOR.hatchR * 2 + 0.06), FLOOR.y - 0.012 * Math.min(1, e * 6), FLOOR.hatch.z);
    this.hatchMesh.visible = e < 0.999;
  }

  /** the suit locker's panel: 0 shut .. 1 slid aside (toward the bow, over the display next to it) */
  setLocker(e) {
    const k = e * e * (3 - 2 * e);
    this.lockerPivot.rotation.y = -k * (H8.locker.hw * 2 + 0.06);
    this.lockerPivot.updateMatrix();
    this.uniforms.uDoorM.value.copy(this.lockerPivot.matrix);
    this.lockerEdge.material.opacity = Math.min(1, Math.sin(Math.min(1, e) * Math.PI) * 1.5 + (e > 0.01 && e < 0.99 ? 0.3 : 0));
    this.lockerEdge.visible = this.lockerEdge.material.opacity > 0.01;
  }

  /**
   * How far the display is from the eye E (H8-local) along dir: the sphere above the floor, or the
   * floor glass (the hatch included). Always > 0 inside the cockpit.
   */
  surface(E, dir) {
    const Cc = H8.cockpitC, R = H8.cockpitR;
    const ox = E.x - Cc.x, oy = E.y - Cc.y, oz = E.z - Cc.z;
    const b = ox * dir.x + oy * dir.y + oz * dir.z;
    const disc = b * b - (ox * ox + oy * oy + oz * oz - R * R);
    let t = disc > 0 ? -b + Math.sqrt(disc) : 1;
    if (dir.y < -1e-4) {
      const tf = (FLOOR.y - E.y) / dir.y;
      if (tf > 0 && tf < t) t = tf;
    }
    return Math.max(0.05, t);
  }

  /** where Kaito's eye is (H8-local): the markers hang along the lines from it */
  setEye(camLocal) {
    this.marks.position.copy(camLocal);
    this.uniforms.uEye.value.copy(camLocal);
    this.eye.copy(camLocal);
  }

  /** a marker (sprite) placed on the display along dir from the eye */
  place(sp, dir) {
    const t = this.surface(this.eye, dir);
    const r = t - 0.03;
    sp.position.copy(dir).multiplyScalar(r);
    if (!sp.userData.s0) sp.userData.s0 = sp.scale.clone();
    // the same angular size at any zoom (the view narrows, the markers must not grow)
    sp.scale.copy(sp.userData.s0).multiplyScalar(r / MARK_R / this.zoom);
    sp.visible = true;
    return true;
  }

  setCameras(health) { for (let i = 0; i < 4; i++) { this.uniforms.uCamH.value[i] = health[i]; this.camH[i] = health[i]; } }

  setZoom(z) { this.zoom = z; this.uniforms.uZoom.value = z; }

  /** a hard knock: the picture stutters for a moment */
  stutter(k) { this.glitch = Math.min(1, Math.max(this.glitch, k)); }

  update(dt, on) {
    // boot: the panels come up over ~2 s; switching off is quicker
    this.power += ((on ? 1 : 0) > this.power ? 1 / 2.0 : -1 / 0.8) * dt;
    this.power = Math.max(0, Math.min(1, this.power));
    this.t += dt;
    this.glitch = Math.max(0, this.glitch - dt * 1.6);
    const U = this.uniforms;
    U.uPower.value = this.power;
    U.uTime.value = this.t % 600;
    U.uGlitch.value = this.glitch;
    this.marks.visible = this.power > 0.3;
    if (this.power <= 0 && this.locks.length) this.clearLocks();
  }

  // ------------------------------------------------------------------ markers
  drawOrbitMark(s, kind) {
    const g = s.g;
    g.clearRect(0, 0, 128, 104);
    const col = kind === 'pro' || kind === 'retro' ? 'rgba(140,255,175,0.9)' : 'rgba(150,215,245,0.7)';
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 3;
    g.beginPath(); g.arc(64, 64, 13, 0, Math.PI * 2); g.stroke();
    if (kind === 'pro') for (const a of [0, Math.PI / 2, Math.PI]) { g.beginPath(); g.moveTo(64 + Math.cos(a + Math.PI) * 13, 64 + Math.sin(a + Math.PI) * 13); g.lineTo(64 + Math.cos(a + Math.PI) * 25, 64 + Math.sin(a + Math.PI) * 25); g.stroke(); }
    if (kind === 'retro') { g.beginPath(); g.moveTo(55, 55); g.lineTo(73, 73); g.moveTo(73, 55); g.lineTo(55, 73); g.stroke(); }
    if (kind === 'zen') { g.beginPath(); g.moveTo(64, 51); g.lineTo(64, 40); g.stroke(); }
    if (kind === 'nad') { g.beginPath(); g.arc(64, 64, 4, 0, Math.PI * 2); g.fill(); }
    g.font = `500 22px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText({ pro: '進行', retro: '逆行', zen: '天頂', nad: '天底' }[kind], 64, 18);
    s.tex.needsUpdate = true;
  }

  drawPip(s, c) {
    const g = s.g, key = (c.threat ? 'T' : '') + c.kind + '|' + (c.short || c.name);
    if (s.key === key) return;
    s.key = key;
    g.clearRect(0, 0, 256, 64);
    const col = c.threat ? C.red : c.kind === 'b29' ? C.amber : c.kind === 'body' ? C.white : C.dim;
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 3;
    g.beginPath(); g.moveTo(24, 20); g.lineTo(36, 32); g.lineTo(24, 44); g.lineTo(12, 32); g.closePath(); g.stroke();
    g.font = `500 24px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(c.short || c.name, 46, 33);
    s.tex.needsUpdate = true;
  }

  /** a damaged camera labels its sector (centred on where it looks) */
  updateCamLabels() {
    for (let i = 0; i < 4; i++) {
      const s = this.camLabels[i], h = this.camH[i];
      if (h > 0.8) { s.sp.visible = false; continue; }
      const dead = h < 0.15;
      const key = dead ? 'dead' : 'w' + Math.round(h * 20);
      const blink = dead ? (Math.floor(this.t * 1.5) % 2) : 1;
      this.place(s.sp, CAMERAS[i].dir);
      s.sp.material.opacity = dead ? 0.55 + 0.45 * blink : 0.85;
      if (s.key === key) continue;
      s.key = key;
      const g = s.g;
      g.clearRect(0, 0, 320, 72);
      g.fillStyle = dead ? 'rgba(40,6,4,0.55)' : 'rgba(30,18,4,0.45)';
      g.fillRect(4, 8, 312, 56);
      g.strokeStyle = dead ? C.red : C.amber; g.lineWidth = 2; g.strokeRect(4, 8, 312, 56);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `700 24px ${MONO}`; g.fillStyle = dead ? C.red : C.amber;
      g.fillText(dead ? `${CAMERAS[i].name.split(' ')[0]}  NO SIGNAL` : `${CAMERAS[i].name.split(' ')[0]}  映像劣化 ${Math.round(h * 100)}%`, 160, 37);
      s.tex.needsUpdate = true;
    }
  }

  /**
   * Per frame. cands: [{ id, kind, name, short, dir (H8-local unit), dist, closing, threat, extra }],
   * gaze: line of sight (H8-local unit, or null), orbit: { pro, retro, zen, nad } (H8-local units),
   * up: the local vertical (H8-local); onLock(c): a new lock
   */
  updateMarks(dt, cands, gaze, orbit, up, onLock) {
    if (up) this.uniforms.uUp.value.copy(up);
    if (!this.marks.visible) return;
    const live = this.power > 0.5;
    const byId = new Map(cands.map((c) => [c.id, c]));
    // locks: drop what is gone, refresh the rest
    this.locks = this.locks.filter((l) => { const c = byId.get(l.id); if (!c) { this.freeLock(l); return false; } l.c = c; return true; });
    // focus dwell on what lies in the cone round the line of sight (narrower when zoomed)
    let focusK = 0;
    const inFocus = new Set();
    const cone = FOCUS / Math.max(1, Math.sqrt(this.zoom));
    if (gaze && live) {
      for (const c of cands) {
        if (c.dir.angleTo(gaze) > cone) continue;
        inFocus.add(c.id);
        if (this.locks.some((l) => l.id === c.id)) continue;
        const d = (this.dwell.get(c.id) || 0) + dt;
        this.dwell.set(c.id, d);
        focusK = Math.max(focusK, d / DWELL);
        if (d >= DWELL && this.lock(c)) onLock && onLock(c);
      }
    }
    for (const id of [...this.dwell.keys()]) if (!inFocus.has(id)) this.dwell.delete(id);
    // threats lock themselves
    if (live) for (const c of cands) if (c.threat && !this.locks.some((l) => l.id === c.id) && this.lock(c)) onLock && onLock(c);
    // pips for the rest
    let pi = 0;
    for (const c of cands) {
      if (pi >= this.pips.length) break;
      if (this.locks.some((l) => l.id === c.id)) continue;
      const s = this.pips[pi];
      this.place(s.sp, c.dir);
      pi++;
      this.drawPip(s, c);
    }
    for (; pi < this.pips.length; pi++) this.pips[pi].sp.visible = false;
    // lock markers
    for (const l of this.locks) {
      l.t += dt;
      this.place(l.slot.sp, l.c.dir);
      l.redraw -= dt;
      if (l.redraw <= 0 || l.t < 0.9) { l.redraw = 0.25; this.drawLock(l); }
    }
    // orbit markers
    for (const k of ['pro', 'retro', 'zen', 'nad']) {
      const s = this.orbit[k], d = orbit && orbit[k];
      if (d) this.place(s.sp, d); else s.sp.visible = false;
    }
    this.updateCamLabels();
    // the focus ring rides the line of sight (with a dwell arc while something is being locked)
    const F = this.focus;
    if (gaze && live) this.place(F.sp, gaze); else F.sp.visible = false;
    const fk = Math.round(Math.min(1, focusK) * 20);
    if (fk !== this.lastFocus) {
      this.lastFocus = fk;
      const g = F.g;
      g.clearRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(150,230,255,0.3)'; g.lineWidth = 2;
      for (let a = 0; a < 4; a++) { g.beginPath(); g.arc(64, 64, 58, a * Math.PI / 2 + Math.PI / 4 - 0.22, a * Math.PI / 2 + Math.PI / 4 + 0.22); g.stroke(); }
      if (fk > 0) { g.strokeStyle = 'rgba(160,240,255,0.9)'; g.lineWidth = 4; g.beginPath(); g.arc(64, 64, 52, -Math.PI / 2, -Math.PI / 2 + fk / 20 * Math.PI * 2); g.stroke(); }
      F.tex.needsUpdate = true;
    }
  }

  lock(c) {
    if (this.locks.length >= LOCK_MAX) {
      // make room: the oldest lock that is not a threat
      const i = this.locks.findIndex((l) => !l.c.threat);
      if (i < 0) return false;
      this.freeLock(this.locks[i]);
      this.locks.splice(i, 1);
    }
    const slot = this.lockSlots.find((x) => !x.used);
    if (!slot) return false;
    slot.used = true;
    slot.sp.visible = true;
    this.locks.push({ id: c.id, c, slot, t: 0, redraw: 0 });
    this.dwell.delete(c.id);
    return true;
  }

  freeLock(l) { l.slot.used = false; l.slot.sp.visible = false; }

  clearLocks() { for (const l of this.locks) this.freeLock(l); this.locks.length = 0; }

  drawLock(l) {
    const { g, tex } = l.slot, c = l.c;
    g.clearRect(0, 0, 512, 192);
    const col = c.threat ? C.red : c.kind === 'b29' ? C.amber : c.kind === 'body' ? C.white : C.cyan;
    const x = 96, y = 96;
    // acquisition: the brackets close in and square up, LOCK flashes
    const k = Math.min(1, l.t / 0.5);
    const s = 74 - 30 * k, rot = (1 - k) * Math.PI / 4;
    g.save(); g.translate(x, y); g.rotate(rot);
    g.strokeStyle = col; g.lineWidth = c.threat ? 5 : 4;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.beginPath(); g.moveTo(sx * s, sy * (s - 15)); g.lineTo(sx * s, sy * s); g.lineTo(sx * (s - 15), sy * s); g.stroke(); }
    g.restore();
    if (c.threat) { g.fillStyle = col; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); }
    if (l.follow) { g.strokeStyle = C.green; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 58, 0, Math.PI * 2); g.stroke(); }
    g.textBaseline = 'middle'; g.textAlign = 'left';
    if (l.t < 0.8 && Math.floor(l.t * 8) % 2 === 0) { g.font = `700 26px ${MONO}`; g.fillStyle = col; g.fillText('LOCK', x - 34, 178); }
    g.font = `700 30px ${FONT}`; g.fillStyle = col;
    g.fillText(c.name, 180, 46);
    g.font = `500 27px ${MONO}`; g.fillStyle = C.white;
    g.fillText(fmtDist(c.dist), 180, 86);
    const cl = c.closing;
    g.font = `400 24px ${FONT}`;
    g.fillStyle = cl > 0.5 ? (c.threat ? C.red : 'rgba(255,215,140,0.95)') : C.dim;
    g.fillText(Math.abs(cl) < 0.05 ? '相対 0 m/s' : (cl > 0 ? '接近 ' : '離隔 ') + Math.abs(cl).toFixed(Math.abs(cl) > 100 ? 0 : 1) + ' m/s', 180, 122);
    if (c.extra) { g.font = `500 23px ${FONT}`; g.fillStyle = c.threat ? C.red : C.dim; g.fillText(c.extra, 180, 156); }
    tex.needsUpdate = true;
  }
}
