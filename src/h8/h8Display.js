// The cockpit's all-round display: what H8's four outside cameras see, stitched in real time and
// shown on every surface round Kaito — the whole inside of the cockpit sphere and the floor under
// his feet (the floor is a sheet of display glass; the hatch in it slides away under the glass).
// While he is inside, H8's own hull is left out of the picture (the cameras look past it), so the
// world shows as if there were no walls at all — through faint panel seams. On top, drawn by the
// display itself: the horizon and pitch ladder (always sharp). The markers, lock boxes and the
// focus frame are drawn by h8Hud.js; the information tabs (h8Tabs.js) sit on the glass.
//
// Damage, as the glass shows it:
//   - a hurt camera: its sector of the picture goes grainy, tears, drops blocks, slips its colours;
//   - a camera that dies: its sector breaks down — a white flash, a few frames of chaos (tearing,
//     colour slips, blocks of garbage, whole frames dropping out), then the picture folds into a
//     bright line like an old tube, the line shrinks to a dot, the dot glows out — and that part
//     of the display is black. Nothing shows there any more: no world, no markers, no tabs;
//   - a hard knock through the armour can kill single display panels: black, with the crack star
//     of the broken glass and backlight bleeding at its edges, or flickering, discoloured, striped.
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

/**
 * The display's damage at a point of the glass, shared by the display itself and the tabs on it.
 * displayFx(P (H8-local point on the glass), d (line of sight through it), sp (screen pixel), ui (1:
 * for something drawn on the glass, which a hurt camera's noise does not touch)) gives the colour
 * laid over the picture there, how opaque it is, and whether the display is dead there (1: black —
 * nothing drawn on it shows).
 */
export const DISPLAY_FX = /* glsl */`
uniform vec3 uCam[4];
uniform float uCamH[4];     // camera health (1 fine .. 0 gone)
uniform float uCamFail[4];  // seconds since that camera died (-1: alive)
uniform sampler2D tPanel;   // the sphere's 30 x 15 panels (r: health, g: seed)
uniform sampler2D tFloorP;  // the floor's 0.24 m tiles (16 x 16)
uniform vec3 uC;            // cockpit centre
uniform float uFloorY;
uniform float uTime;
float dhs(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void displayFx(vec3 P, vec3 d, vec2 sp, float ui, out vec3 fc, out float fa, out float dead){
  fc = vec3(0.0); fa = 0.0; dead = 0.0;
  float tt = floor(uTime * 24.0);
  // ---- which camera's picture this is (nearest axis), its health and its own sector coordinates
  float b1 = -2.0, b2 = -2.0, h = 1.0, f = -1.0;
  vec3 ax = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < 4; i++){
    float k = dot(d, uCam[i]);
    if (k > b1){ b2 = b1; b1 = k; h = uCamH[i]; f = uCamFail[i]; ax = uCam[i]; } else if (k > b2){ b2 = k; }
  }
  vec3 rgt = normalize(cross(ax, abs(ax.y) > 0.9 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 1.0, 0.0)));
  vec3 upv = cross(rgt, ax);
  vec2 sc = vec2(dot(d, rgt), dot(d, upv)) / 0.85;
  // ---- the display panel here (sphere: by direction from the centre; floor: square tiles)
  float ph = 1.0, pseed = 0.0; vec2 pf;
  if (P.y < uFloorY + 0.004){
    vec2 g = P.xz / 0.24; vec2 pan = floor(g); pf = fract(g);
    vec4 t = texture2D(tFloorP, (pan + 8.5) / 16.0); ph = t.r; pseed = t.g;
  } else {
    vec3 dC = normalize(P - uC);
    vec2 g = vec2(atan(dC.x, -dC.z) / 6.28318 * 30.0, asin(clamp(dC.y, -1.0, 1.0)) / 3.14159 * 15.0);
    vec2 pan = floor(g); pf = fract(g);
    vec4 t = texture2D(tPanel, (pan + vec2(16.5, 8.5)) / vec2(32.0, 16.0)); ph = t.r; pseed = t.g;
  }
  // ---- a camera that died: its sector breaks down, then stays black
  if (f >= 0.0){
    if (f < 0.09){ fc = vec3(1.3, 1.26, 1.2); fa = 0.93; return; }
    if (f < 0.95){
      float k = (f - 0.09) / 0.86;
      float rh = 3.0 + 14.0 * dhs(vec2(tt, 3.1));
      float row = floor(sp.y / rh);
      float tear = step(0.62 - 0.35 * k, dhs(vec2(row, tt)));
      vec2 blkP = floor(sp / (10.0 + 34.0 * dhs(vec2(tt, 5.0))));
      float blk = step(1.0 - 0.8 * k, dhs(blkP + tt * 0.37));
      float n = dhs(floor(sp / 2.0) + vec2(tt * 1.3, tt * 0.7));
      vec3 c = vec3(0.15 + 0.7 * n);
      c = mix(c, vec3(0.75, 0.05, 0.6), step(0.86, dhs(vec2(row * 1.7, tt))));
      c = mix(c, vec3(0.05, 0.75, 0.3), step(0.9, dhs(vec2(row * 2.3, tt + 1.0))));
      c = mix(c, vec3(0.02), blk);
      float drop = step(0.82, dhs(vec2(tt, 9.0)));            // whole frames drop out
      fc = mix(c, vec3(0.0), drop);
      fa = max(max(tear * (0.55 + 0.4 * k), blk), drop);
      fa = max(fa, 0.25 + 0.6 * k);
      return;
    }
    dead = 1.0; fa = 1.0;
    if (f < 1.35){
      // the picture folds up into a line, like an old tube: what is left of it squeezes into a
      // narrowing band that grows brighter as it narrows (streaks of the last frame in it)
      float s = (f - 0.95) / 0.4;
      float band = mix(0.9, 0.006, smoothstep(0.0, 1.0, s));
      float inBand = 1.0 - smoothstep(band, band + 0.012, abs(sc.y));
      float streak = 0.55 + 0.45 * dhs(vec2(floor(sp.y / 2.0), tt));
      float lum = min(3.0, 0.07 / max(band, 0.02));
      fc = vec3(0.85, 0.92, 1.0) * lum * streak * inBand;
      return;
    }
    if (f < 1.75){
      // the line shrinks to a dot
      float s = (f - 1.35) / 0.4;
      float w = mix(1.0, 0.004, s);
      float line = (1.0 - smoothstep(0.004, 0.014, abs(sc.y))) * (1.0 - smoothstep(w * 0.85, w, abs(sc.x)));
      fc = vec3(0.95, 0.97, 1.0) * line * (3.2 - 1.6 * s);
      return;
    }
    if (f < 2.9){
      // the dot glows out; a few pixels spark as the panels let go
      float s = (f - 1.75) / 1.15;
      float dotg = exp(-dot(sc, sc) * 1400.0) * (1.0 - s) * 2.5;
      float spark = step(0.9994, dhs(floor(sp / 2.0) + floor(uTime * 9.0))) * (1.0 - s);
      fc = vec3(0.7, 0.8, 1.0) * (dotg + spark);
      return;
    }
    return;
  }
  // ---- a dead or broken panel
  if (ph < 0.35){
    dead = 1.0; fa = 1.0;
    // the crack star of the broken glass, backlight bleeding at the edges, a few stuck pixels
    vec2 c0 = vec2(0.3 + 0.4 * fract(pseed * 7.13), 0.3 + 0.4 * fract(pseed * 3.71));
    vec2 q = pf - c0;
    float a = atan(q.y, q.x), r = length(q);
    float rays = 0.0;
    for (int k = 0; k < 6; k++){
      float ak = fract(pseed * (13.0 + float(k) * 5.0)) * 6.28318;
      float da = abs(mod(a - ak + 3.14159, 6.28318) - 3.14159);
      rays = max(rays, (1.0 - smoothstep(0.0, 0.02 + 0.03 * r, da * r)) * step(r, 0.25 + 0.5 * fract(pseed * float(k + 3) * 1.9)));
    }
    float ring = 1.0 - smoothstep(0.0, 0.012, abs(r - 0.08 - 0.06 * fract(pseed * 2.3)));
    float bleed = smoothstep(0.42, 0.5, max(abs(pf.x - 0.5), abs(pf.y - 0.5)));
    float stuck = step(0.9985, dhs(floor(sp / 1.5) + pseed * 100.0));
    fc = vec3(0.32, 0.34, 0.36) * max(rays, ring * 0.7) + vec3(0.1, 0.25, 0.45) * bleed * 0.45 + vec3(0.8, 0.2, 0.9) * stuck;
    return;
  }
  // ---- a hurt camera: grain, tearing, dropped blocks, slipping colours (screen pixels: stays
  // fine when zoomed)
  // (not over what the display draws itself — the tabs: they are not in the camera's picture)
  float dmg = smoothstep(0.995, 0.3, h) * (1.0 - ui);
  if (dmg > 0.01){
    float px = 1.0 + floor(dmg * 3.5);
    float n = dhs(floor(sp / px) + vec2(tt * 1.37, tt * 0.71));
    float snow = smoothstep(0.08, 1.0, dmg) * (0.2 + 0.8 * dmg);
    float row = floor(sp.y / (2.0 + 7.0 * dmg));
    float tear = step(1.0 - 0.22 * dmg * dmg, dhs(vec2(row, tt)));
    float blk = step(1.0 - dmg * dmg * 0.6, dhs(floor(sp / 22.0) * 1.7 + floor(uTime * (1.5 + 5.0 * dmg)) * 0.37));
    float murk = smoothstep(0.25, 0.85, dmg) * 0.55;
    vec3 c = mix(vec3(0.03, 0.035, 0.04), vec3(0.08 + 0.6 * n), snow);
    float a = max(murk, snow * (0.3 + 0.45 * n));
    c += vec3(0.35, 0.0, 0.25) * step(0.985 - 0.04 * dmg, dhs(vec2(floor(sp.y / 3.0), tt + 7.0))) * dmg;
    if (tear > 0.5){ c = mix(c, vec3(0.65, 0.7, 0.75) * dhs(vec2(row, tt + 3.0)), 0.85); a = max(a, 0.45 + 0.45 * dmg); }
    if (blk > 0.5 && dmg > 0.3){ c = vec3(0.012) + vec3(0.07 * n); a = max(a, 0.94); }
    // now and then the sector drops out for a few frames
    if (dmg > 0.5 && dhs(vec2(floor(uTime * 6.0), ax.x * 13.0 + ax.z * 7.0)) > 1.08 - dmg * 0.25){ c = vec3(0.0); a = 1.0; }
    fc = c; fa = a;
  }
  // ---- a panel that took a knock: flickering, a colour cast, a stripe of dead pixels
  if (ph < 0.95){
    float k = (0.95 - ph) / 0.6;
    float flick = step(0.75 - 0.3 * k, dhs(vec2(floor(uTime * (4.0 + 10.0 * pseed)), pseed * 50.0)));
    vec3 tint = mix(vec3(0.25, 0.0, 0.3), vec3(0.0, 0.25, 0.1), step(0.5, pseed));
    float stripe = 1.0 - smoothstep(0.0, 0.015, abs(pf.x - fract(pseed * 3.3)));
    fc = mix(fc, tint + vec3(0.6) * stripe, 0.6);
    fa = max(fa, max(flick * (0.4 + 0.5 * k), stripe * 0.9) * k + 0.12 * k);
  }
}`;

const FRAG = /* glsl */`
uniform float uPower;     // 0 off .. 1 on (the boot sweeps through it)
uniform vec3 uEye;        // Kaito's eye (H8-local)
uniform vec3 uUp;         // local vertical (H8-local), for the horizon
uniform float uLadder;    // 0..1 horizon / ladder brightness
uniform float uZoom;      // view magnification (the fine lines fade while zoomed)
uniform float uGlitch;    // the whole display stutters (power dips after hits)
varying vec3 vP;
${DISPLAY_FX}
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
  float bootK = uPower * 1.15 - dhs(pan) * 0.9;
  float on = smoothstep(0.0, 0.08, bootK);
  vec3 col = vec3(0.0);
  float alpha = mix(1.0, 0.035, on);
  // ---- damage over the picture (a dead part is black: no ladder, no seams)
  vec3 fc; float fa, dead;
  displayFx(vP, d, gl_FragCoord.xy, 0.0, fc, fa, dead);
  if (dead > 0.5 && on > 0.5){ gl_FragColor = vec4(fc, 1.0); return; }
  col = mix(col, fc, fa);
  alpha = max(alpha, fa * on);
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
  lad *= uLadder * mix(0.35, 1.0, zoomFade) * (1.0 - fa);
  // the whole display stutters
  vec2 sp = gl_FragCoord.xy;
  float tt = floor(uTime * 24.0);
  if (uGlitch > 0.0){
    float gb = step(1.0 - 0.35 * uGlitch, dhs(vec2(floor(sp.y / 4.0), tt)));
    col = mix(col, vec3(0.75), gb * 0.7);
    alpha = max(alpha, gb * 0.65 * uGlitch);
  }
  col += vec3(0.5, 0.9, 1.0) * lad * on;
  alpha = max(alpha, lad * 0.8 * on);
  alpha = max(alpha, bez * (0.45 * on + 0.75 * (1.0 - on)));
  col = mix(col, vec3(0.012), bez * 0.85);
  // a booting panel: a brief edge glow as it comes up
  col += vec3(0.4, 0.7, 1.0) * smoothstep(0.08, 0.0, abs(bootK - 0.04)) * (1.0 - step(0.999, uPower)) * 0.6;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`;

export const HUD_COL = { cyan: 'rgba(130,232,255,0.95)', dim: 'rgba(150,215,245,0.62)', red: 'rgba(255,92,64,0.98)', amber: 'rgba(255,190,90,0.97)', green: 'rgba(120,255,170,0.95)', white: 'rgba(225,242,255,0.96)' };

/** a short readable distance */
export function fmtDist(m) {
  if (m > 9.5e5) return (m / 1000).toFixed(0) + ' km';
  if (m > 9500) return (m / 1000).toFixed(1) + ' km';
  return m.toFixed(0) + ' m';
}

export function altOf(pos) { return pos.length() - R_EARTH; }

/** the camera health below which a camera is gone (its part of the display goes black) */
export const CAM_DEAD = 0.3;

/** the floor: a disc of display glass at H8.floorY with the round hatch opening behind the seat */
export const FLOOR = (() => {
  const Cc = H8.cockpitC, R = H8.cockpitR;
  const r = Math.sqrt(R * R - (Cc.y - H8.floorY) ** 2);
  return { y: H8.floorY, r, c: new THREE.Vector3(Cc.x, H8.floorY, Cc.z), hatch: new THREE.Vector3(0, H8.floorY, H8.shaftZ), hatchR: H8.shaftR + 0.02 };
})();

const inLocker = (az, el) => {
  const L = H8.locker;
  let d = az - L.az;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) < L.hw && el > L.el0 && el < L.el1;
};

const inShelterDoor = (az, el) => {
  const S = H8.shelter;
  let d = az - S.az;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) < S.hw && el > S.el0 && el < S.el1;
};

/** the inside of the cockpit sphere above the floor (facing in), less the suit locker's and the
 * shelter's panels */
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
      if (inLocker(az, el) || inShelterDoor(az, el)) continue;
      const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** a patch of the sphere (a panel that slides along it to open): az +- hw, el0..el1 */
function patchGeometry(az0, hw, el0, el1) {
  const Cc = H8.cockpitC, R = H8.cockpitR - 0.006;
  const pos = [], idx = [];
  const NA = 12, NE = 16;
  for (let j = 0; j <= NE; j++) {
    const el = el0 + (el1 - el0) * j / NE;
    for (let i = 0; i <= NA; i++) {
      const az = az0 - hw + 2 * hw * i / NA;
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

function panelTexture(w, h) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 255; data[i * 4 + 1] = Math.floor(Math.random() * 255); data[i * 4 + 2] = 0; data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export class H8Display {
  constructor() {
    this.panelTex = panelTexture(32, 16);
    this.floorTex = panelTexture(16, 16);
    const uniforms = {
      uPower: { value: 0 },
      uCam: { value: CAMERAS.map((c) => c.dir.clone()) }, uCamH: { value: [1, 1, 1, 1] }, uCamFail: { value: [-1, -1, -1, -1] },
      tPanel: { value: this.panelTex }, tFloorP: { value: this.floorTex }, uFloorY: { value: H8.floorY },
      uC: { value: H8.cockpitC.clone() }, uEye: { value: H8.cockpitC.clone() },
      uUp: { value: new THREE.Vector3(0, 1, 0) }, uLadder: { value: 1 },
      uTime: { value: 0 }, uZoom: { value: 1 }, uGlitch: { value: 0 }, uDoorM: { value: new THREE.Matrix4() },
    };
    this.uniforms = uniforms;
    // (a piece that moves — a sliding panel, the hatch cover — has its own placement: uDoorM)
    const mk = (defines, own) => new THREE.ShaderMaterial({
      uniforms: own ? Object.assign({}, uniforms, { uDoorM: { value: new THREE.Matrix4() } }) : uniforms,
      defines: own ? Object.assign({ DOOR: 1 }, defines) : defines,
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mat = mk({});
    this.matFloor = mk({ FLOOR: 1 });
    this.mk = mk;
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
    const hg = new THREE.CircleGeometry(FLOOR.hatchR + 0.002, 48);
    hg.rotateX(-Math.PI / 2);
    this.matHatch = mk({ FLOOR: 1 }, true);
    this.hatchMesh = add(hg, this.matHatch, 19);
    this.hatchOpen = 0;
    this.setHatch(0);
    // the suit locker's panel and the shelter's: pieces of the display that slide aside along the
    // sphere (each with its own placement)
    const slider = (az, hw, el0, el1) => {
      const pivot = new THREE.Group();
      pivot.position.set(H8.cockpitC.x, 0, H8.cockpitC.z);
      this.mesh.add(pivot);
      const mat = mk({}, true);
      const door = new THREE.Mesh(patchGeometry(az, hw, el0, el1), mat);
      door.renderOrder = 19; door.frustumCulled = false; door.layers.set(LAYER_NEAR);
      pivot.add(door);
      const eg = new THREE.EdgesGeometry(patchGeometry(az, hw, el0, el1), 30);
      const edge = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      edge.layers.set(LAYER_NEAR); edge.renderOrder = 21;
      pivot.add(edge);
      return { pivot, door, edge, mat, hw };
    };
    const L = H8.locker, S = H8.shelter;
    this.lockerS = slider(L.az, L.hw, L.el0, L.el1);
    this.shelterS = slider(S.az, S.hw, S.el0, S.el1);
    this.power = 0;
    this.t = 0;
    this.glitch = 0;
    this.zoom = 1;
    this.camH = [1, 1, 1, 1];
    this.failT = [null, null, null, null];
    this.panelHP = new Float32Array(32 * 16).fill(1);
    this.floorHP = new Float32Array(16 * 16).fill(1);
    this.eye = H8.cockpitC.clone();
  }

  /** the floor hatch: 0 shut .. 1 open (slid aside under the glass) */
  setHatch(e) {
    this.hatchOpen = e;
    const k = e * e * (3 - 2 * e);
    this.hatchMesh.position.set(FLOOR.hatch.x + k * (FLOOR.hatchR * 2 + 0.06), FLOOR.y - 0.012 * Math.min(1, e * 6), FLOOR.hatch.z);
    this.hatchMesh.updateMatrix();
    this.matHatch.uniforms.uDoorM.value.copy(this.hatchMesh.matrix);
    this.hatchMesh.visible = e < 0.999;
  }

  slide(S, e, dir) {
    const k = e * e * (3 - 2 * e);
    S.pivot.rotation.y = dir * k * (S.hw * 2 + 0.06);
    S.pivot.updateMatrix();
    S.mat.uniforms.uDoorM.value.copy(S.pivot.matrix);
    S.edge.material.opacity = Math.min(1, Math.sin(Math.min(1, e) * Math.PI) * 1.5 + (e > 0.01 && e < 0.99 ? 0.3 : 0));
    S.edge.visible = S.edge.material.opacity > 0.01;
    S.door.visible = e < 0.999;
  }

  /** the suit locker's panel: 0 shut .. 1 slid aside (toward the bow, over the display next to it) */
  setLocker(e) { this.slide(this.lockerS, e, -1); }

  /** the shelter's panel (at the back of the cockpit): 0 shut .. 1 slid aside */
  setShelter(e) { this.slide(this.shelterS, e, 1); }

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

  /** where Kaito's eye is (H8-local) */
  setEye(camLocal) {
    this.uniforms.uEye.value.copy(camLocal);
    this.eye.copy(camLocal);
  }

  /** camera health from the hull's record: a camera that has just died starts its breakdown */
  setCameras(health, restoring = false) {
    for (let i = 0; i < 4; i++) {
      const h = health[i];
      const was = this.camH[i];
      this.uniforms.uCamH.value[i] = h;
      this.camH[i] = h;
      if (h < CAM_DEAD && this.failT[i] === null) this.failT[i] = restoring || was < CAM_DEAD ? -1e6 : this.t;
      else if (h >= CAM_DEAD) this.failT[i] = null;
    }
  }

  /**
   * Is the display dead along this line of sight (H8-local, from the eye): its camera gone (its
   * breakdown included once it is past the first flash), or — with P, the point of the glass there
   * — that panel broken
   */
  deadAt(dir, P) {
    let best = -2, h = 1, i0 = 0;
    for (let i = 0; i < 4; i++) { const k = dir.dot(CAMERAS[i].dir); if (k > best) { best = k; h = this.camH[i]; i0 = i; } }
    if (h < CAM_DEAD && this.failT[i0] !== null && this.t - this.failT[i0] > 0.95) return true;
    if (P) return this.panelAt(P) < 0.35;
    return false;
  }

  /** the health of the display panel at a point of the glass (H8-local) */
  panelAt(P) {
    if (P.y < FLOOR.y + 0.004) {
      const ix = Math.floor(P.x / 0.24) + 8, iz = Math.floor(P.z / 0.24) + 8;
      return ix >= 0 && ix < 16 && iz >= 0 && iz < 16 ? this.floorHP[iz * 16 + ix] : 1;
    }
    const C = H8.cockpitC;
    const dx = P.x - C.x, dy = P.y - C.y, dz = P.z - C.z, l = Math.hypot(dx, dy, dz) || 1;
    const ia = Math.floor(Math.atan2(dx / l, -dz / l) / (Math.PI * 2) * 30) + 16;
    const ie = Math.floor(Math.asin(Math.max(-1, Math.min(1, dy / l))) / Math.PI * 15) + 8;
    return ia >= 0 && ia < 32 && ie >= 0 && ie < 16 ? this.panelHP[ie * 32 + ia] : 1;
  }

  /** how far a direction's camera is hurt (0 fine .. 1 gone) */
  damageAt(dir) {
    let best = -2, h = 1;
    for (let i = 0; i < 4; i++) { const k = dir.dot(CAMERAS[i].dir); if (k > best) { best = k; h = this.camH[i]; } }
    return Math.max(0, Math.min(1, (0.995 - h) / (0.995 - CAM_DEAD)));
  }

  setZoom(z) { this.zoom = z; this.uniforms.uZoom.value = z; }

  /** a hard knock: the picture stutters for a moment */
  stutter(k) { this.glitch = Math.min(1, Math.max(this.glitch, k)); }

  /**
   * A blow through the armour shakes the display panels on that side (dirLocal: H8-local, toward
   * the blow): some flicker, some go dark with their glass cracked
   */
  panelHit(dirLocal, E) {
    if (E < 6e5) return;
    const n = Math.min(9, Math.floor(1 + E / 2.5e6));
    const d = dirLocal.clone().normalize();
    for (let k = 0; k < n; k++) {
      const j = d.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.35)).normalize();
      const hurt = Math.min(1, 0.25 + Math.random() * 0.5 + E / 3e7);
      if (j.y < -0.55) {
        // the floor: where that line meets it
        const t = (FLOOR.y - H8.cockpitC.y) / j.y;
        const x = H8.cockpitC.x + j.x * t, z = H8.cockpitC.z + j.z * t;
        const ix = Math.floor(x / 0.24) + 8, iz = Math.floor(z / 0.24) + 8;
        if (ix >= 0 && ix < 16 && iz >= 0 && iz < 16) this.floorHP[iz * 16 + ix] = Math.max(0, this.floorHP[iz * 16 + ix] - hurt);
      } else {
        const ia = Math.floor(Math.atan2(j.x, -j.z) / (Math.PI * 2) * 30) + 16;
        const ie = Math.floor(Math.asin(Math.max(-1, Math.min(1, j.y))) / Math.PI * 15) + 8;
        if (ia >= 0 && ia < 32 && ie >= 0 && ie < 16) this.panelHP[ie * 32 + ia] = Math.max(0, this.panelHP[ie * 32 + ia] - hurt);
      }
    }
    this.syncPanels();
  }

  syncPanels() {
    const P = this.panelTex.image.data, F = this.floorTex.image.data;
    for (let i = 0; i < this.panelHP.length; i++) P[i * 4] = Math.round(this.panelHP[i] * 255);
    for (let i = 0; i < this.floorHP.length; i++) F[i * 4] = Math.round(this.floorHP[i] * 255);
    this.panelTex.needsUpdate = true;
    this.floorTex.needsUpdate = true;
  }

  /** the repair dock replaces the broken panels */
  repairPanels() { this.panelHP.fill(1); this.floorHP.fill(1); this.syncPanels(); }

  /** broken panels for the save: [[i, hp], ...] (floor indices offset by 1000) */
  serializePanels() {
    const out = [];
    this.panelHP.forEach((h, i) => { if (h < 0.999) out.push([i, +h.toFixed(3)]); });
    this.floorHP.forEach((h, i) => { if (h < 0.999) out.push([1000 + i, +h.toFixed(3)]); });
    return out;
  }

  restorePanels(list) {
    this.panelHP.fill(1); this.floorHP.fill(1);
    for (const [i, h] of list || []) { if (i >= 1000) { if (i - 1000 < this.floorHP.length) this.floorHP[i - 1000] = h; } else if (i < this.panelHP.length) this.panelHP[i] = h; }
    this.syncPanels();
  }

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
    for (let i = 0; i < 4; i++) U.uCamFail.value[i] = this.failT[i] === null ? -1 : Math.min(1e5, this.t - this.failT[i]);
  }
}
