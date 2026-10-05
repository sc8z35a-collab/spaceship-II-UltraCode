// The cockpit's wrap-around display: what H8's four outside cameras see, stitched in real time and
// shown on the inside of the cockpit sphere. While Kaito sits inside, H8's own hull is left out of
// the picture (the cameras look past it), so the display shows the world as if the walls were
// gone — through thin panel bezels and faint seams where one camera hands over to the next. On top:
//   - the horizon and pitch ladder, drawn by the display itself (always sharp, every frame);
//   - small markers on everything trackable, placed along the line from Kaito's eye so they sit
//     exactly on the object behind them;
//   - lock-on: whatever he keeps looking at for a moment is locked (several at once; rocks on a
//     collision course lock themselves), each with its bracket, name, range and closing speed;
//   - three small glass cards ahead of the seat (they turn with it): H8, B-29 / the link, and
//     HACHI's words or the alert of the moment.
// Text is small and crisp (each card and marker is its own sharp texture). Dark when H8 is
// powered down; the panels come up one by one.
import * as THREE from 'three';
import { H8, CAMERAS } from './h8Spec.js';
import { displayGeometry, isDisplay } from './h8Interior.js';
import { R_EARTH } from '../core/astro.js';
import { LAYER_NEAR } from '../core/layers.js';

const VERT = /* glsl */`
varying vec2 vUv; varying vec3 vP;
void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */`
uniform float uPower;     // 0 off .. 1 on (the boot sweeps through it)
uniform vec3 uCam[4];
uniform float uCamOK[4];  // camera health (a dead camera leaves its sector without a picture)
uniform vec3 uC;          // cockpit centre
uniform vec3 uEye;        // Kaito's eye (H8-local)
uniform vec3 uUp;         // local vertical (H8-local), for the horizon
uniform float uLadder;    // 0..1 horizon / ladder brightness
varying vec2 vUv;
varying vec3 vP;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// a line where x == 0, w pixels wide, antialiased by its size on screen (no shimmer when moving)
float aline(float x, float w){ float fw = max(fwidth(x), 1e-6); return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0, abs(x) / fw); }
void main(){
  vec3 dC = normalize(vP - uC);
  // panel grid (24 x 12) and the boot order of the panels
  vec2 pan = vec2(floor(vUv.x * 24.0), floor(vUv.y * 12.0));
  float bootK = uPower * 1.15 - h(pan) * 0.9;
  float on = smoothstep(0.0, 0.08, bootK);
  // which camera fills this part of the picture; a faint static seam where two meet
  float best = -2.0, second = -2.0, ok = 1.0;
  for (int i = 0; i < 4; i++){
    float k = dot(dC, uCam[i]);
    if (k > best){ second = best; best = k; ok = uCamOK[i]; } else if (k > second) second = k;
  }
  float seam = aline(best - second, 1.2);
  // panel bezels: thin dark lines between the display tiles
  vec2 g = vUv * vec2(24.0, 12.0);
  vec2 fg = fract(g + 0.5) - 0.5;
  float bez = max(aline(fg.x, 1.6), aline(fg.y, 1.6));
  // horizon and pitch ladder, seen from the eye
  vec3 d = normalize(vP - uEye);
  float s = dot(d, uUp);
  vec3 e1 = normalize(cross(uUp, abs(uUp.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(uUp, e1);
  float az = atan(dot(d, e2), dot(d, e1));
  float el = asin(clamp(s, -1.0, 1.0)) * 57.2958;
  float lad = aline(el, 1.6) * 0.75;
  for (int k = 1; k <= 3; k++){
    float a = k == 1 ? 10.0 : k == 2 ? 30.0 : 60.0;
    // above: solid; below: dashed
    float up = aline(el - a, 1.0);
    float dn = aline(el + a, 1.0) * step(0.5, fract(az * 18.0 / 3.14159));
    lad = max(lad, (up + dn) * 0.38);
  }
  lad *= uLadder;
  vec3 col = vec3(0.0);
  float a = mix(1.0, 0.06, on);
  // a camera that is gone: its sector stays dark grey, with a static hatch
  if (ok < 0.5){
    float hatch = step(0.82, fract((vUv.x * 160.0 + vUv.y * 80.0)));
    col = vec3(0.035, 0.04, 0.045) + vec3(0.03) * hatch;
    a = max(a, 0.97 * on);
  } else if (ok < 0.95){
    a = max(a, (0.95 - ok) * 0.9 * on);   // a damaged one: a dimmer, murkier picture
    col = vec3(0.02, 0.025, 0.03);
  }
  col += vec3(0.25, 0.45, 0.6) * seam * 0.05 * on;
  col += vec3(0.5, 0.9, 1.0) * lad * on;
  a = max(a, lad * 0.8 * on);
  a = max(a, bez * 0.75);
  col = mix(col, vec3(0.012), bez * 0.85);
  // a booting panel: a brief edge glow as it comes up
  col += vec3(0.4, 0.7, 1.0) * smoothstep(0.08, 0.0, abs(bootK - 0.04)) * (1.0 - step(0.999, uPower)) * 0.6;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

export const HUD_COL = { cyan: 'rgba(130,232,255,0.95)', dim: 'rgba(150,215,245,0.62)', red: 'rgba(255,92,64,0.98)', amber: 'rgba(255,190,90,0.97)', green: 'rgba(120,255,170,0.95)', white: 'rgba(225,242,255,0.96)' };
const C = HUD_COL;
const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",system-ui,sans-serif';
const MONO = '"SF Mono","Menlo","Consolas","Noto Sans Mono",monospace';
const DEG = Math.PI / 180;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** a short readable distance */
export function fmtDist(m) {
  if (m > 9.5e5) return (m / 1000).toFixed(0) + ' km';
  if (m > 9500) return (m / 1000).toFixed(1) + ' km';
  return m.toFixed(0) + ' m';
}

export function altOf(pos) { return pos.length() - R_EARTH; }

const MARK_R = 0.9;        // sprite sizes are set for this distance (they are moved onto the display)
const PANEL_R = 0.95;
const PX_DEG = 24;         // card resolution (texels per degree)
const LOCK_MAX = 8;
const FOCUS = 6.5 * DEG;   // the focus cone round the line of sight
const DWELL = 0.4;         // s of looking before a lock

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

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

export class H8Display {
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uPower: { value: 0 },
        uCam: { value: CAMERAS.map((c) => c.dir.clone()) }, uCamOK: { value: [1, 1, 1, 1] },
        uC: { value: H8.cockpitC.clone() }, uEye: { value: H8.cockpitC.clone() },
        uUp: { value: new THREE.Vector3(0, 1, 0) }, uLadder: { value: 1 },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(displayGeometry(), this.mat);
    this.mesh.renderOrder = 20;
    this.mesh.name = 'h8Display';
    this.mesh.frustumCulled = false;
    this.power = 0;
    this.t = 0;
    // the cards turn with the seat; the markers sit on the display along the lines from the eye
    this.marks = new THREE.Group();
    this.mesh.add(this.marks);
    this.cards = {
      left: this.card(-30, -5, 21, 12.5),
      right: this.card(30, -5, 21, 12.5),
      center: this.card(0, -12.5, 34, 4.4),
    };
    // orbit markers, pips, locks, the focus ring
    this.orbit = {};
    for (const k of ['pro', 'retro', 'zen', 'nad']) {
      const s = sprite(128, 104, 5.2, [0.5, 64 / 104]);
      this.drawOrbitMark(s, k);
      this.marks.add(s.sp);
      this.orbit[k] = s;
    }
    this.pips = [];
    for (let i = 0; i < 24; i++) { const s = sprite(256, 64, 9, [24 / 256, 0.5]); s.key = ''; this.marks.add(s.sp); this.pips.push(s); }
    this.lockSlots = [];
    for (let i = 0; i < LOCK_MAX + 4; i++) { const s = sprite(512, 192, 18, [96 / 512, 0.5]); s.used = false; this.marks.add(s.sp); this.lockSlots.push(s); }
    this.focus = sprite(128, 128, 2 * FOCUS / DEG * 1.05);
    this.marks.add(this.focus.sp);
    this.locks = [];          // { id, c (candidate), slot, t, redraw }
    this.dwell = new Map();   // id -> s looked at
    this.lastFocus = -1;
  }

  /** a flat glass card hanging inside the display, ahead of the seat at (az, el) degrees */
  card(az, el, wDeg, hDeg) {
    const W = Math.round(wDeg * PX_DEG), Hh = Math.round(hDeg * PX_DEG);
    const t = canvasTex(W, Hh);
    const w = 2 * PANEL_R * Math.tan(wDeg * DEG / 2), hh = 2 * PANEL_R * Math.tan(hDeg * DEG / 2);
    const mat = new THREE.MeshBasicMaterial({ map: t.tex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), mat);
    mesh.layers.set(LAYER_NEAR);
    mesh.renderOrder = 22;
    mesh.frustumCulled = false;
    this.mesh.add(mesh);
    return Object.assign(t, { mesh, mat, W, H: Hh, az: az * DEG, el: el * DEG, wDeg, hDeg });
  }

  /**
   * How far the display is from the eye E (H8-local) along dir: >0 the display is there, <0 the
   * equipment below / behind the seat is (no picture), 0 nothing
   */
  surface(E, dir) {
    const C = H8.cockpitC, R = H8.cockpitR;
    const ox = E.x - C.x, oy = E.y - C.y, oz = E.z - C.z;
    const b = ox * dir.x + oy * dir.y + oz * dir.z;
    const disc = b * b - (ox * ox + oy * oy + oz * oz - R * R);
    if (disc < 0) return 0;
    const t = -b + Math.sqrt(disc);
    const px = ox + dir.x * t, py = oy + dir.y * t, pz = oz + dir.z * t;
    return isDisplay(Math.atan2(px, -pz), Math.asin(Math.max(-1, Math.min(1, py / R)))) ? t : -t;
  }

  /**
   * Where Kaito is: the seat's eye and its swivel (the cards turn with the seat, on the display
   * itself — lifted above the equipment where the seat faces aft) and the camera (H8-local; the
   * markers sit where the lines from it meet the display)
   */
  setEye(seatEye, seatYaw, camLocal) {
    this.marks.position.copy(camLocal);
    this.mat.uniforms.uEye.value.copy(camLocal);
    this.eye = camLocal.clone();
    const d = new THREE.Vector3(), q = new THREE.Vector3(), m = new THREE.Matrix4();
    const dirAt = (out, az, el) => out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).applyAxisAngle(Y_AXIS, seatYaw);
    for (const c of Object.values(this.cards)) {
      // the whole card must sit on the display (its lower corners too)
      const hw = c.wDeg * DEG / 2, hh = c.hDeg * DEG / 2;
      let el = c.el, t = 0;
      for (let k = 0; k < 24; k++) {
        t = this.surface(seatEye, dirAt(d, c.az, el));
        if (t > 0 && this.surface(seatEye, dirAt(q, c.az - hw, el - hh)) > 0 && this.surface(seatEye, dirAt(q, c.az + hw, el - hh)) > 0) break;
        t = 0;
        el += 3 * DEG;
      }
      if (t <= 0) { c.mesh.visible = false; continue; }
      c.mesh.visible = true;
      const r = t - 0.025;
      c.mesh.position.copy(seatEye).addScaledVector(d, r);
      c.mesh.quaternion.setFromRotationMatrix(m.lookAt(seatEye, c.mesh.position, Y_AXIS));
      c.mesh.scale.setScalar(r / PANEL_R);
    }
  }

  /** a marker (sprite) placed on the display along dir from the eye; hidden where there is none */
  place(sp, dir) {
    const t = this.eye ? this.surface(this.eye, dir) : MARK_R;
    if (t <= 0) { sp.visible = false; return false; }
    const r = t - 0.03;
    sp.position.copy(dir).multiplyScalar(r);
    const k = r / MARK_R;
    if (!sp.userData.s0) sp.userData.s0 = sp.scale.clone();
    sp.scale.copy(sp.userData.s0).multiplyScalar(k);
    sp.visible = true;
    return true;
  }

  setCameras(health) { for (let i = 0; i < 4; i++) this.mat.uniforms.uCamOK.value[i] = health[i]; }

  update(dt, on) {
    // boot: the panels come up over ~2 s; switching off is quicker
    this.power += ((on ? 1 : 0) > this.power ? 1 / 2.0 : -1 / 0.8) * dt;
    this.power = Math.max(0, Math.min(1, this.power));
    this.t += dt;
    this.mat.uniforms.uPower.value = this.power;
    const ca = Math.max(0, Math.min(1, this.power * 1.25 - 0.25));
    for (const k of Object.keys(this.cards)) this.cards[k].mat.opacity = ca;
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

  /**
   * Per frame. cands: [{ id, kind, name, short, dir (H8-local unit), dist, closing, threat, extra }],
   * gaze: line of sight (H8-local unit, or null), orbit: { pro, retro, zen, nad } (H8-local units),
   * up: the local vertical (H8-local); onLock(c): a new lock
   */
  updateMarks(dt, cands, gaze, orbit, up, onLock) {
    if (up) this.mat.uniforms.uUp.value.copy(up);
    if (!this.marks.visible) return;
    const live = this.power > 0.5;
    const byId = new Map(cands.map((c) => [c.id, c]));
    // locks: drop what is gone, refresh the rest
    this.locks = this.locks.filter((l) => { const c = byId.get(l.id); if (!c) { this.freeLock(l); return false; } l.c = c; return true; });
    // focus dwell on what lies in the cone round the line of sight
    let focusK = 0;
    const inFocus = new Set();
    if (gaze && live) {
      for (const c of cands) {
        if (c.dir.angleTo(gaze) > FOCUS) continue;
        inFocus.add(c.id);
        if (this.locks.some((l) => l.id === c.id)) continue;
        const d = (this.dwell.get(c.id) || 0) + dt;
        this.dwell.set(c.id, d);
        focusK = Math.max(focusK, d / DWELL);
        if (d >= DWELL && this.lock(c)) onLock && onLock(c);
      }
    }
    for (const id of [...this.dwell.keys()]) if (!inFocus.has(id)) this.dwell.delete(id);
    // rocks on a collision course lock themselves
    if (live) for (const c of cands) if (c.threat && !this.locks.some((l) => l.id === c.id) && this.lock(c)) onLock && onLock(c);
    // pips for the rest
    let pi = 0;
    for (const c of cands) {
      if (pi >= this.pips.length) break;
      if (this.locks.some((l) => l.id === c.id)) continue;
      const s = this.pips[pi];
      if (!this.place(s.sp, c.dir)) continue;
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

  // ------------------------------------------------------------------ cards
  /** panels: { left: { title, sub, lines }, right: { ... }, center: { alert, say, foot } } */
  paint(panels) {
    if (this.power <= 0.05) return;
    this.drawCard(this.cards.left, panels.left);
    this.drawCard(this.cards.right, panels.right);
    this.drawCenter(this.cards.center, panels.center);
  }

  drawCard(P, d) {
    const g = P.g, W = P.W, Hh = P.H;
    g.clearRect(0, 0, W, Hh);
    if (!d) { P.tex.needsUpdate = true; return; }
    g.fillStyle = d.warnBg ? 'rgba(40,6,4,0.5)' : 'rgba(3,14,24,0.46)';
    roundRect(g, 2, 2, W - 4, Hh - 4, 12); g.fill();
    g.strokeStyle = d.warnBg ? 'rgba(255,90,60,0.5)' : 'rgba(130,220,255,0.22)'; g.lineWidth = 2; g.stroke();
    g.textBaseline = 'middle';
    g.textAlign = 'left'; g.font = `700 30px ${FONT}`; g.fillStyle = d.titleColor || C.cyan;
    g.fillText(d.title, 16, 26);
    if (d.sub) { g.textAlign = 'right'; g.font = `500 23px ${FONT}`; g.fillStyle = d.subColor || C.dim; g.fillText(d.sub, W - 16, 27); }
    let y = 66;
    for (const ln of d.lines || []) {
      const col = ln.warn ? C.red : ln.good ? C.green : ln.amber ? C.amber : ln.dim ? C.dim : C.white;
      g.textAlign = 'left';
      g.font = `${ln.big ? 600 : 400} ${ln.big ? 30 : 25}px ${FONT}`; g.fillStyle = ln.warn ? C.red : C.dim;
      if (ln.label) g.fillText(ln.label, 16, y);
      g.fillStyle = col;
      if (ln.text) { g.font = `${ln.big ? 600 : 500} ${ln.big ? 30 : 25}px ${ln.mono ? MONO : FONT}`; g.fillText(ln.text, ln.label ? 128 : 16, y); }
      if (ln.right !== undefined) { g.textAlign = 'right'; g.font = `500 25px ${MONO}`; g.fillText(ln.right, W - 16, y); }
      if (ln.bar !== undefined) {
        const bx = 128, bw = W - 16 - 110 - bx;
        g.fillStyle = 'rgba(255,255,255,0.09)'; g.fillRect(bx, y - 4, bw, 8);
        g.fillStyle = ln.warn ? C.red : ln.barColor || C.cyan; g.fillRect(bx, y - 4, bw * Math.max(0, Math.min(1, ln.bar)), 8);
      }
      y += ln.big ? 40 : 33;
      if (y > Hh - 10) break;
    }
    P.tex.needsUpdate = true;
  }

  drawCenter(P, d) {
    const g = P.g, W = P.W, Hh = P.H;
    g.clearRect(0, 0, W, Hh);
    if (d) {
      g.textBaseline = 'middle'; g.textAlign = 'center';
      if (d.alert) {
        const blink = 0.65 + 0.35 * Math.sin(this.t * 7);
        g.fillStyle = `rgba(120,10,6,${0.5 * blink})`; roundRect(g, W * 0.12, 4, W * 0.76, 56, 10); g.fill();
        g.font = `700 32px ${FONT}`; g.fillStyle = C.red; g.fillText(d.alert, W / 2, 33);
      } else if (d.say) {
        g.fillStyle = 'rgba(30,18,4,0.42)'; roundRect(g, W * 0.06, 6, W * 0.88, 52, 10); g.fill();
        g.font = `400 26px ${FONT}`; g.fillStyle = 'rgba(255,208,140,0.95)'; g.fillText(d.say, W / 2, 33);
      }
      if (d.foot) { g.font = `500 22px ${FONT}`; g.fillStyle = C.dim; g.fillText(d.foot, W / 2, Hh - 22); }
    }
    P.tex.needsUpdate = true;
  }
}
