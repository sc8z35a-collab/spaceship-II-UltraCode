// The cockpit's all-round display: what H8's four outside cameras see, stitched in real time and
// shown on every surface round Kaito — the whole inside of the cockpit sphere and the floor under
// his feet (the floor is a sheet of display glass; the hatch in it slides away under the glass).
// While he is inside, H8's own hull is left out of the picture (the cameras look past it), so the
// world shows as if there were no walls at all — through faint panel seams. On top, drawn by the
// display itself: the horizon and pitch ladder (always sharp), and the information tabs (h8Tabs.js
// lays them out and draws their pictures; the display shows them in its own pixels, on the glass —
// behind the seat and the hands, under the panels' seams and faults). The markers, lock boxes and
// the focus frame are drawn by h8Hud.js.
//
// Damage, as the glass shows it:
//   - a hurt camera: its sector of the picture goes grainy, tears, drops blocks, slips its colours;
//   - a camera that dies: its sector breaks down — a white flash, a few frames of chaos (tearing,
//     colour slips, blocks of garbage, whole frames dropping out), then the picture folds into a
//     bright line like an old tube, the line shrinks to a dot, the dot glows out — and that part
//     of the display is black. Nothing shows there any more: no world, no markers, no tabs;
//   - a hard knock through the armour hurts the glass round the point it came through — not panel
//     by panel but as one wound that runs on across the seams: the liquid crystal bleeds dark from
//     it, its edge glowing red (hot and bright when fresh), red all round it, pulsing; the backlight
//     dims in bursts; the cover glass cracks — runs that wander out and fork, broken rings round the
//     point — the cracks carrying the red light out along them; lines from the drivers, mostly red,
//     run on far across the display. The shock runs through the whole frame, so lighter hurts come
//     up all round too;
//   - and the worse H8 is hurt overall, the more of the display all round is worn: hurts come up
//     in every direction in proportion, the whole picture clouds, its backlight unsteady, red
//     creeping in all round and pulsing, a red line slipping round it now and then.
// Big hits make the whole display stutter. Dark when H8 is powered down; the panels come up one
// by one.
import * as THREE from 'three';
import { H8, CAMERAS } from './h8Spec.js';
import { R_EARTH } from '../core/astro.js';
import { LAYER_NEAR } from '../core/layers.js';
import { SEAT } from './h8Seat.js';

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
 * What the display draws at a point of its glass, back to front: its own dark film; the cameras'
 * picture as it reaches it (a hurt camera's corrupted, a dead one's broken down and black); the
 * horizon and pitch ladder; the tabs (h8Tabs.js hands it their pictures: the display draws them in
 * its own pixels — the cockpit's fittings stand in front of them, the zoom does not touch them);
 * then what is wrong with the panel itself — a dark bleed through its liquid-crystal layer, stuck
 * lines from its drivers, an unsteady backlight leaking at its edges, cracks in its cover glass —
 * over everything it shows; the seams between the panels last.
 */
const FRAG = /* glsl */`
uniform float uPower;     // 0 off .. 1 on (the boot sweeps through it)
uniform vec3 uEye;        // Kaito's eye (H8-local)
uniform vec3 uUp;         // local vertical (H8-local), for the horizon
uniform float uLadder;    // 0..1 horizon / ladder brightness
uniform float uZoom;      // view magnification (the fine lines fade while zoomed)
uniform float uGlitch;    // the whole display stutters (power dips after hits)
uniform vec3 uCam[4];
uniform float uCamH[4];     // camera health (1 fine .. 0 gone)
uniform float uCamFail[4];  // seconds since that camera died (-1: alive)
uniform float uCamHeat[4];  // how hot it is (an engine's flame on it): 0 .. 1 washing out; past 1 no signal
uniform vec4 uImp[16];      // hits on the display: the direction from the cockpit's middle (xyz), how
                            // far round it the hurt reaches (w, rad; 0: none)
uniform vec4 uImpK[16];     // each hit's severity (x, 0..1), its seed (y), seconds since it (z)
uniform vec3 uC;            // cockpit centre
uniform float uFloorY;
uniform float uTime;
uniform float uWear;        // how worn the whole display is by H8's damage (0 .. 1)
// the tabs: up to four surfaces (headers and bodies), each a rectangle of the plane square to uTabC
// at unit distance from the eye point uTabE (x0, x1, y0, y1 along uTabX, uTabY); later over earlier
uniform sampler2D tTab0; uniform sampler2D tTab1; uniform sampler2D tTab2; uniform sampler2D tTab3;
uniform vec3 uTabC[4]; uniform vec3 uTabX[4]; uniform vec3 uTabY[4];
uniform vec4 uTabR[4];
uniform float uTabA[4];
uniform vec3 uTabE;
uniform float uTabK;        // how bright the display draws its own things (as the eye sees them)
uniform sampler2D tLum;     // the eye's adaptation: the picture's mean luminance (engine.js)
uniform float uExpBias;
varying vec3 vP;

float dhs(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dhs(i), dhs(i + vec2(1.0, 0.0)), f.x), mix(dhs(i + vec2(0.0, 1.0)), dhs(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vn(p); p = p * 2.07 + 5.3; a *= 0.5; } return s; }
// a line where x == 0, w pixels wide, antialiased by its size on screen (no shimmer when moving)
float aline(float x, float w){ float fw = max(fwidth(x), 1e-6); return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0, abs(x) / fw); }
// layers, premultiplied: (P, A) <- c with alpha a over it; or a premultiplied layer (Q, B) over it
void over(inout vec3 P, inout float A, vec3 c, float a){ a = clamp(a, 0.0, 1.0); P = c * a + P * (1.0 - a); A = a + A * (1.0 - a); }
void overP(inout vec3 P, inout float A, vec3 Q, float B){ B = clamp(B, 0.0, 1.0); P = Q + P * (1.0 - B); A = B + A * (1.0 - B); }

// ---- the camera whose picture this is (nearest axis): hurt, its picture corrupts in its own
// pixels — blocks that smear into a wrong colour or drop out, torn lines, sensor noise, the sector
// dropping out for a moment; dead, a white flash, a few frames of chaos, the picture folding into a
// line like an old tube, the line to a dot, the dot glowing out — then black (dead = 1)
// ---- a camera too hot (an engine's flame on it): its picture washes out toward a hot white, its
// rows tear, hot pixels speckle; past its limit its sector's signal is lost (snow, a frame now and
// then) until it cools. Laid over (fc, fa)
void camHeat(float hk, vec2 px, vec3 ax, float tt, inout vec3 fc, inout float fa){
  if (hk <= 0.0) return;
  float hc = clamp(hk, 0.0, 1.0);
  float row = floor(px.y / 3.0);
  float tear = step(1.0 - 0.3 * hc, dhs(vec2(row, tt + 7.0)));
  float sp = step(1.0 - 0.03 * hc, dhs(floor(px / 2.0) + vec2(tt * 0.9, tt * 1.7)));
  vec3 c = vec3(1.0, 0.92, 0.78) * (0.8 + 0.4 * dhs(vec2(row, tt)));
  float a = hc * hc * 0.8 + tear * 0.5 * hc + sp * hc;
  float lost = smoothstep(1.0, 1.12, hk);
  if (lost > 0.0){
    float snow = dhs(floor(px / 2.0) + vec2(tt * 1.3, tt * 0.7));
    float through = step(0.93, dhs(vec2(floor(uTime * 6.0), ax.x * 7.0 + ax.z * 3.0)));
    c = mix(c, vec3(snow * 0.3), lost);
    a = mix(a, 1.0 - 0.6 * through, lost);
  }
  a = clamp(a, 0.0, 1.0);
  fc = mix(fc, c, a); fa = max(fa, a);
}

void camFx(vec3 d, out vec3 fc, out float fa, out float dead){
  fc = vec3(0.0); fa = 0.0; dead = 0.0;
  float tt = floor(uTime * 24.0);
  float b1 = -2.0, h = 1.0, f = -1.0, hk = 0.0;
  vec3 ax = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < 4; i++){ float k = dot(d, uCam[i]); if (k > b1){ b1 = k; h = uCamH[i]; f = uCamFail[i]; ax = uCam[i]; hk = uCamHeat[i]; } }
  vec3 rgt = normalize(cross(ax, abs(ax.y) > 0.9 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 1.0, 0.0)));
  vec3 upv = cross(rgt, ax);
  vec2 sc = vec2(dot(d, rgt), dot(d, upv)) / 0.85;
  vec2 px = sc * 640.0;                                   // that camera's own pixels
  if (f >= 0.0){
    if (f < 0.09){ fc = vec3(1.5, 0.7, 0.6); fa = 0.93; return; }
    if (f < 0.95){
      float k = (f - 0.09) / 0.86;
      float rh = 3.0 + 14.0 * dhs(vec2(tt, 3.1));
      float row = floor(px.y / rh);
      float tear = step(0.62 - 0.35 * k, dhs(vec2(row, tt)));
      vec2 blkP = floor(px / (10.0 + 34.0 * dhs(vec2(tt, 5.0))));
      float blk = step(1.0 - 0.8 * k, dhs(blkP + tt * 0.37));
      float n = dhs(floor(px / 2.0) + vec2(tt * 1.3, tt * 0.7));
      vec3 c = vec3(0.15 + 0.7 * n) * vec3(1.0, 0.45, 0.4);
      c = mix(c, vec3(0.95, 0.05, 0.03), step(0.8, dhs(vec2(row * 1.7, tt))));
      c = mix(c, vec3(0.8, 0.05, 0.45), step(0.9, dhs(vec2(row * 2.3, tt + 1.0))));
      c = mix(c, vec3(0.02), blk);
      float drop = step(0.82, dhs(vec2(tt, 9.0)));
      fc = mix(c, vec3(0.0), drop);
      fa = max(max(max(tear * (0.55 + 0.4 * k), blk), drop), 0.25 + 0.6 * k);
      return;
    }
    dead = 1.0; fa = 1.0;
    if (f < 1.35){
      float s = (f - 0.95) / 0.4;
      float band = mix(0.9, 0.006, smoothstep(0.0, 1.0, s));
      float inBand = 1.0 - smoothstep(band, band + 0.012, abs(sc.y));
      float streak = 0.55 + 0.45 * dhs(vec2(floor(px.y / 2.0), tt));
      fc = vec3(1.0, 0.22, 0.12) * min(3.0, 0.07 / max(band, 0.02)) * streak * inBand;
      return;
    }
    if (f < 1.75){
      float s = (f - 1.35) / 0.4;
      float w = mix(1.0, 0.004, s);
      float line = (1.0 - smoothstep(0.004, 0.014, abs(sc.y))) * (1.0 - smoothstep(w * 0.85, w, abs(sc.x)));
      fc = vec3(1.0, 0.3, 0.18) * line * (3.2 - 1.6 * s);
      return;
    }
    if (f < 2.9){
      float s = (f - 1.75) / 1.15;
      float dotg = exp(-dot(sc, sc) * 1400.0) * (1.0 - s) * 2.5;
      float spark = step(0.9994, dhs(floor(px / 2.0) + floor(uTime * 9.0))) * (1.0 - s);
      fc = vec3(1.0, 0.25, 0.15) * (dotg + spark);
    }
    return;
  }
  float dmg = smoothstep(0.995, 0.3, h);
  if (dmg < 0.01){ camHeat(hk, px, ax, tt, fc, fa); return; }
  vec2 mb = floor(px / vec2(56.0, 5.0));                   // the picture smears in long strips
  float tq = floor(uTime * (3.0 + 9.0 * dmg));             // the corruption changes a few times a second
  float n = dhs(floor(px / (1.0 + floor(dmg * 2.0))) + vec2(tt * 1.37, tt * 0.71));
  vec3 c = vec3(0.5 * n) * vec3(1.0, 0.5, 0.45);
  float a = (0.04 + 0.3 * n) * smoothstep(0.1, 1.0, dmg);
  // smeared blocks: a flat wash of a wrong colour, what was left of the block going off
  if (dhs(mb * 1.37 + tq * 0.71) > 1.0 - 0.45 * dmg * dmg){
    vec3 hue = mix(vec3(1.0, 0.07, 0.04), vec3(0.9, 0.12, 0.5), dhs(mb + tq));
    c = mix(vec3(0.3, 0.1, 0.1), hue * 0.8, 0.75 * dmg) * (0.45 + 0.55 * dhs(mb * 3.1 + tq));
    a = max(a, 0.5 + 0.4 * dmg);
  }
  // dropped blocks: black, or a decoder's green
  if (dhs(mb * 2.11 + tq * 1.3 + 4.0) > 1.0 - 0.2 * dmg * dmg){ c = mix(vec3(0.0), vec3(0.3, 0.0, 0.0), step(0.6, dhs(mb + tq * 0.3))); a = 0.97; }
  // a torn line
  float row = floor(px.y / 3.0);
  if (dhs(vec2(row, tt)) > 1.0 - 0.05 * dmg){ c = vec3(1.0, 0.3, 0.22) * dhs(vec2(row, tt + 3.0)); a = max(a, 0.5 + 0.4 * dmg); }
  // the whole sector drops out now and then
  if (dmg > 0.5 && dhs(vec2(floor(uTime * 6.0), ax.x * 13.0 + ax.z * 7.0)) > 1.08 - dmg * 0.25){ c = vec3(0.0); a = 1.0; }
  fc = c; fa = a;
  camHeat(hk, px, ax, tt, fc, fa);
}

// ---- a crack pattern round a hit (q: round it, in units of the hit's size; px: a screen pixel
// there, in the same units): runs that wander out and fork, broken arcs round the point, the
// crushed spot in the middle. It is in the glass, not in one panel: it runs on across the seams
float cracksQ(vec2 q, float seed, float size, float px){
  float a = atan(q.y, q.x), r = length(q);
  float c = 0.0;
  for (int k = 0; k < 7; k++){
    float fk = float(k);
    float ak = fract(seed * (13.1 + fk * 5.7)) * 6.28318;
    float len = size * (0.35 + 0.65 * fract(seed * (fk + 3.0) * 1.93));
    float wig = (vn(vec2(r * 3.0 + fk * 3.1, seed * 17.0 + fk)) - 0.5) * 0.5 + (vn(vec2(r * 14.0, fk * 7.3)) - 0.5) * 0.07;
    float da = abs(mod(a - ak - wig + 3.14159, 6.28318) - 3.14159) * r;
    c = max(c, (1.0 - smoothstep(px * 0.4, px * 1.2, da)) * (1.0 - smoothstep(len * 0.7, len, r)));
    if (fract(seed * (fk + 11.0)) > 0.5){
      float af = ak + (fract(seed * (fk + 13.0)) - 0.5) * 0.9;
      float rf = len * (0.2 + 0.35 * fract(seed * (fk + 5.0)));
      float daf = abs(mod(a - af - wig * 0.8 + 3.14159, 6.28318) - 3.14159) * r;
      c = max(c, (1.0 - smoothstep(px * 0.4, px * 1.2, daf)) * step(rf, r) * (1.0 - smoothstep(len * 0.45, len * 0.7, r)) * 0.85);
    }
  }
  for (int k = 0; k < 2; k++){
    float fk = float(k);
    float rk = size * (0.12 + 0.16 * fk + 0.05 * fract(seed * (fk + 7.0)));
    float arc = smoothstep(0.48, 0.56, vn(vec2(a * 1.8 + fk * 4.0, seed * 9.0 + fk)));
    float wig = (vn(vec2(a * 6.0, fk + seed * 5.0)) - 0.5) * 0.05;
    c = max(c, (1.0 - smoothstep(px * 0.4, px * 1.2, abs(r - rk + wig))) * arc * 0.85);
  }
  c = max(c, (1.0 - smoothstep(0.04, 0.09, r)) * (0.5 + 0.5 * vn(q * 160.0)));
  return c;
}

// ---- the damage, as one field over the whole glass (n: the direction from the cockpit's middle;
// pxa: a screen pixel's angle; gain: how bright the display draws its own light): round each hit
// the liquid crystal bleeds dark, glowing red at its edge (hot and bright when fresh) and red all
// round it, pulsing; the backlight dims in bursts; the cover glass cracks, the cracks carrying the
// red light out along them; lines from the drivers — mostly red — run on far across the panels.
// Nothing of it stops at a panel's edge. The crystal layer as a premultiplied layer (lP, lA), the
// glass as another (gP, gA)
void damageFx(vec3 n, float pxa, vec3 d, float gain, out vec3 lP, out float lA, out vec3 gP, out float gA){
  lP = vec3(0.0); lA = 0.0; gP = vec3(0.0); gA = 0.0;
  float az = atan(n.x, -n.z), el = asin(clamp(n.y, -1.0, 1.0));
  float cel = max(0.05, sqrt(max(0.0, 1.0 - n.y * n.y)));
  // the drivers' lines: from each hit a column or two (now and then a row) of the display stuck on
  for (int i = 0; i < 16; i++){
    vec4 I = uImp[i];
    if (I.w <= 0.0) continue;
    vec4 K = uImpK[i];
    float iaz = atan(I.x, -I.z), iel = asin(clamp(I.y, -1.0, 1.0));
    float nl = 1.0 + floor(K.x * 1.6);
    for (int j = 0; j < 3; j++){
      float fj = float(j);
      if (fj >= nl) break;
      float s = fract(K.y * (17.3 + fj * 7.9));
      float off = (fract(s * 31.0) - 0.5) * 1.6 * I.w;
      float span = I.w * 2.0 + (0.3 + 0.9 * fract(s * 13.0)) * K.x;
      float dl, along;
      if (fract(s * 5.0) > 0.25){ dl = abs(mod(az - iaz - off / cel + 3.14159, 6.28318) - 3.14159) * cel; along = abs(el - iel); }
      else { dl = abs(el - iel - off); along = abs(mod(az - iaz + 3.14159, 6.28318) - 3.14159) * cel; }
      float on = (1.0 - smoothstep(pxa * 0.5, pxa * 1.4, dl)) * (1.0 - smoothstep(span * 0.6, span, along));
      float hue = fract(s * 23.0);
      vec3 col = hue < 0.65 ? vec3(1.0, 0.06, 0.03) : hue < 0.85 ? vec3(0.95, 0.08, 0.55) : vec3(1.0, 0.85, 0.8);
      float fl = step(0.2, dhs(vec2(floor(uTime * (4.0 + 7.0 * s)), fj + K.y * 10.0)));
      over(lP, lA, col * gain * 1.25, on * (0.5 + 0.3 * fl));
    }
  }
  // round each hit
  for (int i = 0; i < 16; i++){
    vec4 I = uImp[i];
    if (I.w <= 0.0) continue;
    float c = dot(n, I.xyz);
    if (c < cos(min(1.35, I.w * 3.6))) continue;
    vec4 K = uImpK[i];
    float k = K.x, seed = K.y;
    vec3 t1 = normalize(cross(I.xyz, abs(I.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
    vec3 t2 = cross(I.xyz, t1);
    vec2 qs = vec2(dot(n, t1), dot(n, t2)) / max(c, 0.2) / I.w;      // round the hit, in its size
    float px = pxa / (max(c * c, 0.04) * I.w);
    float r = length(qs);
    float Rb = 0.3 + 0.7 * k;                                          // the bleed
    float e = r * (1.0 + 0.65 * (fbm(qs * 1.5 + seed * 31.0) - 0.5)) + (fbm(qs * 4.5 + seed * 7.0) - 0.5) * 0.22;
    float blot = 1.0 - smoothstep(Rb * 0.86, Rb, e);
    float rim = smoothstep(Rb * 0.7, Rb, e) * (1.0 - smoothstep(Rb, Rb * 1.3, e));
    float halo = 1.0 - smoothstep(Rb, Rb * 1.8 + 0.3, e);
    float hot = exp(-K.z / 5.0);
    float pulse = 0.7 + 0.3 * sin(uTime * (2.6 + 2.0 * seed) + seed * 20.0);
    float burst = step(0.8 - 0.25 * k, dhs(vec2(floor(uTime * (3.0 + 9.0 * seed)), seed * 50.0)));
    // (red pixels flickering in it: fine, many, changing)
    float spk = step(0.9, dhs(floor(qs * 110.0) + floor(uTime * 11.0) * 0.37)) * halo;
    over(lP, lA, vec3(0.0), halo * (0.08 + 0.18 * burst) * k);
    over(lP, lA, vec3(1.0, 0.04, 0.02) * gain * (0.9 + 1.2 * hot), halo * (0.08 + 0.16 * k) * pulse);
    over(lP, lA, vec3(1.0, 0.06, 0.03) * gain * 1.3, spk * 0.45);
    over(lP, lA, vec3(1.0, 0.14, 0.05) * gain * (1.2 + 2.0 * hot), rim * 0.8);
    over(lP, lA, vec3(0.025, 0.0, 0.0), blot * 0.97);
    // the glass
    if (k > 0.25){
      float cr = cracksQ(qs, seed, 1.2 + 2.2 * k, px);
      float glint = smoothstep(0.62, 0.9, vn(qs * 7.0 + d.xy * 30.0 + d.z * 17.0));
      float near = 1.0 - smoothstep(Rb, Rb * 3.2, r);
      vec3 col = mix(vec3(1.0, 0.09, 0.04) * gain * (0.45 + 0.9 * near + 1.2 * hot), vec3(1.1, 0.75, 0.7) * gain * 1.1, glint * 0.3);
      over(gP, gA, col, cr * (0.32 + 0.25 * near + 0.25 * glint));
    }
  }
}

// ---- the tabs: one surface (its picture tex, its rectangle) seen along u from their eye point
vec4 tabOne(sampler2D tex, vec3 u, vec3 c, vec3 ex, vec3 ey, vec4 R, float a){
  if (a < 0.004) return vec4(0.0);
  float dd = dot(u, c);
  if (dd < 0.2) return vec4(0.0);
  vec2 xy = vec2(dot(u, ex), dot(u, ey)) / dd;
  vec2 uv = (xy - R.xz) / (R.yw - R.xz);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  vec4 s = textureLod(tex, uv, 0.0);
  return vec4(s.rgb, s.a * a);
}

void main(){
  // the line of sight through this point: what is seen here lies that way
  vec3 d = normalize(vP - uEye);
  // (the glass is not magnified with the cameras' picture: its seams stay, a little fainter over a
  // magnified picture)
  float zoomFade = 1.0 - 0.5 * smoothstep(1.4, 3.0, uZoom);
  // the panel grid: on the sphere by direction from its centre, on the floor square tiles
  vec3 n = normalize(vP - uC);
#ifdef FLOOR
  vec2 g = vP.xz / 0.24;
#else
  vec2 g = vec2(atan(n.x, -n.z) / 6.28318 * 30.0, asin(clamp(n.y, -1.0, 1.0)) / 3.14159 * 15.0);
#endif
  vec2 pan = floor(g);
  vec2 fg = fract(g) - 0.5;
  float bez = max(aline(fg.x, 1.3), aline(fg.y, 1.3)) * zoomFade;
  // a screen pixel's angle as seen from the cockpit's middle (what a fine line is drawn at)
  float pxa = clamp(length(fwidth(n)), 1e-5, 0.02);
  float bootK = uPower * 1.15 - dhs(pan) * 0.9;
  float on = smoothstep(0.0, 0.08, bootK);
  // how bright the display draws its own things: steady to the eye whatever it has adapted to
  // (bright text against the sun, not blinding in the dark)
  float lum = texture2D(tLum, vec2(0.5)).r;
  float gain = uTabK * clamp(lum, 0.05, 3.0) / max(0.02, uExpBias * 0.34);
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
  // the parts
  vec3 cc; float ca, cdead;
  camFx(d, cc, ca, cdead);
  vec3 lP, gP; float lA, gA;
  damageFx(n, pxa, d, gain, lP, lA, gP, gA);
  // ---- back to front
  vec3 P = vec3(0.0); float A = 0.0;
  over(P, A, vec3(0.0), mix(1.0, 0.035, on));            // its own film (black while off)
  if (cdead > 0.5) over(P, A, cc, on);                   // the camera gone: black (its breakdown)
  else {
    over(P, A, cc, ca * on);
    over(P, A, vec3(0.5, 0.9, 1.0) * gain * 0.6, lad * 0.8 * on * (1.0 - ca));
    // the tabs, in the display's own pixels
    vec3 u = normalize(vP - uTabE);
    vec4 t0 = tabOne(tTab0, u, uTabC[0], uTabX[0], uTabY[0], uTabR[0], uTabA[0]);
    vec4 t1 = tabOne(tTab1, u, uTabC[1], uTabX[1], uTabY[1], uTabR[1], uTabA[1]);
    vec4 t2 = tabOne(tTab2, u, uTabC[2], uTabX[2], uTabY[2], uTabR[2], uTabA[2]);
    vec4 t3 = tabOne(tTab3, u, uTabC[3], uTabX[3], uTabY[3], uTabR[3], uTabA[3]);
    vec3 TP = vec3(0.0); float TA = 0.0;
    over(TP, TA, t0.rgb, t0.a); over(TP, TA, t1.rgb, t1.a); over(TP, TA, t2.rgb, t2.a); over(TP, TA, t3.rgb, t3.a);
    if (TA > 0.002) over(P, A, min(TP / TA * gain, vec3(0.97)), TA * on);
  }
  // the damage over all it shows
  overP(P, A, lP * on, lA * on);
  // the whole display worn by H8's damage: clouded, unsteady, red creeping in all round (pulsing
  // slowly the worse it gets), a red line slipping round it now and then
  if (uWear > 0.01){
    float w = uWear;
    float tt = floor(uTime * 24.0);
    float eln = asin(clamp(n.y, -1.0, 1.0)), azm = atan(n.x, -n.z);
    float cloud = max(0.0, fbm(vec2(azm * 2.2, eln * 2.6) + floor(uTime * 0.5) * 0.37) - 0.5) * 0.7 * w;
    float dip = step(1.0 - 0.05 * w * w, dhs(vec2(floor(uTime * 7.0), floor(eln * 5.0))));
    float slip = step(1.0 - 0.035 * w, dhs(vec2(floor(eln * 300.0), tt + 11.0)));
    float red = smoothstep(0.2, 0.9, w) * (0.55 + 0.45 * sin(uTime * 2.1)) * (0.06 + 0.12 * vn(vec2(azm * 1.5, eln * 1.5) + uTime * 0.05));
    over(P, A, vec3(0.0), (cloud + dip * 0.5 * w) * on);
    over(P, A, vec3(1.0, 0.06, 0.03) * gain, red * on);
    over(P, A, vec3(1.0, 0.2, 0.12) * gain * (0.5 + 0.5 * dhs(vec2(floor(eln * 300.0), tt + 5.0))), slip * 0.55 * w * on);
  }
  // the whole display stutters (in bands round it), red
  if (uGlitch > 0.0){
    float gb = step(1.0 - 0.35 * uGlitch, dhs(vec2(floor(asin(clamp(n.y, -1.0, 1.0)) * 120.0), floor(uTime * 24.0))));
    over(P, A, vec3(0.9, 0.18, 0.12) * gain, gb * 0.6 * uGlitch);
  }
  // the seams between the panels, the cracked glass over all of it
  over(P, A, vec3(0.012), bez * mix(0.75, 0.45, on));
  overP(P, A, gP, gA);
  // a booting panel: a brief edge glow as it comes up
  P += vec3(0.4, 0.7, 1.0) * smoothstep(0.08, 0.0, abs(bootK - 0.04)) * (1.0 - step(0.999, uPower)) * 0.6;
  gl_FragColor = vec4(P / max(A, 1e-4), clamp(A, 0.0, 1.0));
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

/** the floor: a disc of display glass at H8.floorY with the round hatch opening behind the seat;
 * under the seat the seat carriage's slot (x +- slot.x, z slot.z0 .. slot.z1), covered by two
 * leaves of the same glass that slide apart (round the seat's column: a notch of radius slot.r) */
export const FLOOR = (() => {
  const Cc = H8.cockpitC, R = H8.cockpitR;
  const r = Math.sqrt(R * R - (Cc.y - H8.floorY) ** 2);
  return {
    y: H8.floorY, r, c: new THREE.Vector3(Cc.x, H8.floorY, Cc.z), hatch: new THREE.Vector3(0, H8.floorY, H8.shaftZ), hatchR: H8.shaftR + 0.02,
    slot: { x: 0.3, z0: -0.56, z1: -0.145, cz: SEAT.G.z, r: 0.085, open: 0.33 },
  };
})();

const inShelterDoor = (az, el) => {
  const S = H8.shelter;
  let d = az - S.az;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) < S.hw && el > S.el0 && el < S.el1;
};

/** the inside of the cockpit sphere above the floor (facing in), less the shelter's panel */
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
      if (inShelterDoor(az, el)) continue;
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

/** the floor glass with the hatch opening and the carriage's slot */
function floorGeometry() {
  const sh = new THREE.Shape();
  sh.absarc(0, 0, FLOOR.r, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(FLOOR.hatch.x - FLOOR.c.x, -(FLOOR.hatch.z - FLOOR.c.z), FLOOR.hatchR, 0, Math.PI * 2, true);
  sh.holes.push(hole);
  const S = FLOOR.slot, sy = (z) => -(z - FLOOR.c.z);
  const slot = new THREE.Path();
  slot.moveTo(-S.x, sy(S.z0)); slot.lineTo(-S.x, sy(S.z1)); slot.lineTo(S.x, sy(S.z1)); slot.lineTo(S.x, sy(S.z0)); slot.lineTo(-S.x, sy(S.z0));
  sh.holes.push(slot);
  const g = new THREE.ShapeGeometry(sh, 64);
  g.rotateX(-Math.PI / 2);
  g.translate(FLOOR.c.x, FLOOR.y, FLOOR.c.z);
  return g;
}

/** one leaf of the slot's cover (side: -1 port, +1 starboard), in place (H8-local) */
function leafGeometry(side) {
  const S = FLOOR.slot, sh = new THREE.Shape();
  // (shape coordinates: x, -z; the notch round the column on the inner edge)
  sh.moveTo(0, -S.z0); sh.lineTo(side * S.x, -S.z0); sh.lineTo(side * S.x, -S.z1); sh.lineTo(0, -S.z1);
  for (let i = 0; i <= 12; i++) { const a = Math.PI * i / 12; sh.lineTo(side * S.r * Math.sin(a), -(S.cz + S.r * Math.cos(a))); }
  sh.lineTo(0, -S.z0);
  const g = new THREE.ShapeGeometry(sh, 12);
  g.rotateX(-Math.PI / 2);
  g.translate(0, FLOOR.y + 0.0015, 0);
  return g;
}

/** how many hits the display keeps track of (more merge into the nearest, or push out the least) */
const MAX_IMP = 16;

/** a direction from the cockpit's middle: the middle of a sphere panel (ia 0..31, ie 0..15) */
function panelDir(ia, ie, out) {
  const az = (ia - 16 + 0.5) / 30 * Math.PI * 2, el = (ie - 8 + 0.5) / 15 * Math.PI;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

export class H8Display {
  constructor() {
    const uniforms = {
      uPower: { value: 0 },
      uCam: { value: CAMERAS.map((c) => c.dir.clone()) }, uCamH: { value: [1, 1, 1, 1] }, uCamFail: { value: [-1, -1, -1, -1] }, uCamHeat: { value: [0, 0, 0, 0] },
      uImp: { value: Array.from({ length: MAX_IMP }, () => new THREE.Vector4()) },
      uImpK: { value: Array.from({ length: MAX_IMP }, () => new THREE.Vector4()) },
      uFloorY: { value: H8.floorY },
      uC: { value: H8.cockpitC.clone() }, uEye: { value: H8.cockpitC.clone() },
      uUp: { value: new THREE.Vector3(0, 1, 0) }, uLadder: { value: 1 },
      uTime: { value: 0 }, uZoom: { value: 1 }, uGlitch: { value: 0 }, uDoorM: { value: new THREE.Matrix4() },
      uWear: { value: 0 },
      // the tabs the display draws (h8Tabs.js fills these in), and how bright it draws its own things
      tTab0: { value: null }, tTab1: { value: null }, tTab2: { value: null }, tTab3: { value: null },
      uTabC: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, 0, -1)) },
      uTabX: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(1, 0, 0)) },
      uTabY: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, 1, 0)) },
      uTabR: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(-1, 1, -1, 1)) },
      uTabA: { value: [0, 0, 0, 0] },
      uTabE: { value: SEAT.G.clone().add(SEAT.eye) },
      uTabK: { value: 1.75 },
      tLum: { value: null }, uExpBias: { value: 1 },
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
    // the leaves over the carriage's slot under the seat: they slide apart, out over the floor
    this.leaves = [-1, 1].map((side) => {
      const mat = mk({ FLOOR: 1 }, true);
      const m = add(leafGeometry(side), mat, 19);
      return { m, mat, side };
    });
    this.setFloorSlot(0);
    // the shelter's panel: a piece of the display that slides aside along the sphere (with its own
    // placement)
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
    const S = H8.shelter;
    this.shelterS = slider(S.az, S.hw, S.el0, S.el1);
    this.power = 0;
    this.t = 0;
    this.glitch = 0;
    this.zoom = 1;
    this.camH = [1, 1, 1, 1];
    this.camHeat = [0, 0, 0, 0];  // each camera's heat (plumeHeat.js): past 1 its signal is lost
    this.failT = [null, null, null, null];
    // the damage: hits on the glass (each spreads over as many panels as it reaches), and from them
    // each panel's health (what can still be touched there, what the hull tab counts)
    this.impacts = [];          // { dir (from the cockpit's middle), R (rad), k (0..1), seed, t, wear }
    this.panelHP = new Float32Array(32 * 16).fill(1);
    this.floorHP = new Float32Array(16 * 16).fill(1);
    this.wornTo = 0;            // the wear the display has been hurt for so far
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

  /** the leaves over the seat carriage's slot: 0 shut .. 1 slid apart */
  setFloorSlot(e) {
    this.slotOpen = e;
    const k = e * e * (3 - 2 * e);
    for (const L of this.leaves) {
      L.m.position.set(L.side * k * FLOOR.slot.open, 0.0012 * Math.min(1, e * 8), 0);
      L.m.updateMatrix();
      L.mat.uniforms.uDoorM.value.copy(L.m.matrix);
    }
  }

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
    // (too hot: no picture there for now)
    if (this.camHeat[i0] > 1.1) return true;
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

  /** each camera's heat (an engine's flame on it: plumeHeat.js) */
  setCameraHeat(h) {
    for (let i = 0; i < 4; i++) { this.camHeat[i] = h[i]; this.uniforms.uCamHeat.value[i] = h[i]; }
  }

  /** a hard knock: the picture stutters for a moment */
  stutter(k) { this.glitch = Math.min(1, Math.max(this.glitch, k)); }

  /**
   * A hit on the glass: dir (from the cockpit's middle), R (how far round it the hurt reaches, rad),
   * k (how bad, 0..1). Near one already there, that one grows instead
   */
  addImpact(dir, R, k, wear = false) {
    const d = dir.clone().normalize();
    let near = null, best = Infinity;
    for (const I of this.impacts) { const a = I.dir.angleTo(d); if (a < Math.max(I.R, R) * 0.9 && a < best) { best = a; near = I; } }
    if (near) {
      near.k = Math.min(1, near.k + k * 0.6);
      near.R = Math.min(0.34, Math.max(near.R, R) * 1.08);
      if (!wear) { near.t = this.t; near.wear = false; }
      return near;
    }
    const I = { dir: d, R: Math.min(0.34, R), k: Math.min(1, k), seed: Math.random(), t: wear ? this.t - 60 : this.t, wear };
    if (this.impacts.length >= MAX_IMP) {
      // the least of them gives way
      let wi = 0;
      for (let i = 1; i < this.impacts.length; i++) if (this.impacts[i].k * this.impacts[i].R < this.impacts[wi].k * this.impacts[wi].R) wi = i;
      this.impacts[wi] = I;
    } else this.impacts.push(I);
    return I;
  }

  /**
   * A blow through the armour shakes the display (dirLocal: H8-local, toward the blow): the glass
   * on that side is hurt, and the shock runs through the whole frame — lighter hurts all round
   */
  panelHit(dirLocal, E) {
    if (E < 6e5) return;
    const s = Math.min(1, E / 3e7);
    this.addImpact(dirLocal, 0.06 + 0.14 * s, 0.35 + 0.65 * Math.min(1, E / 2.5e7));
    const m = Math.min(4, Math.floor(E / 6e6 + Math.random() * 1.2));
    for (let k = 0; k < m; k++) this.addImpact(new THREE.Vector3().randomDirection(), 0.035 + 0.05 * Math.random(), 0.15 + 0.3 * Math.random() * (0.5 + s));
    this.syncImpacts();
  }

  /**
   * The display worn as far as H8 is hurt (0 .. 1), all the way round: hurts anywhere on the glass,
   * more and worse the worse H8 is — and the whole picture wears with it (uWear). Damage only adds
   * up (the repair dock clears it).
   */
  setWear(level) {
    const w = Math.max(0, Math.min(1, level));
    this.uniforms.uWear.value = w;
    if (w <= this.wornTo + 0.004) return;
    this.wornTo = w;
    const want = Math.round(w * 10);
    let have = this.impacts.filter((I) => I.wear).length, guard = 0;
    while (have < want && guard++ < 30) {
      const d = new THREE.Vector3().randomDirection();
      if (d.y < -0.6 && Math.random() < 0.6) continue;
      const I = this.addImpact(d, 0.04 + 0.1 * Math.random(), 0.2 + 0.6 * w * Math.random(), true);
      if (I.wear) have++;
    }
    this.syncImpacts();
  }

  /** the hits to the shader, and each panel's health from them (dark where a bleed covers its
   * middle, hurt round it) */
  syncImpacts() {
    const U = this.uniforms;
    for (let i = 0; i < MAX_IMP; i++) {
      const I = this.impacts[i];
      if (!I) { U.uImp.value[i].set(0, 0, 0, 0); U.uImpK.value[i].set(0, 0, 0, 0); continue; }
      U.uImp.value[i].set(I.dir.x, I.dir.y, I.dir.z, I.R);
      U.uImpK.value[i].set(I.k, I.seed, Math.max(0, this.t - I.t), 0);
    }
    const health = (dir) => {
      let h = 1;
      for (const I of this.impacts) {
        const a = dir.angleTo(I.dir), core = I.R * (0.3 + 0.7 * I.k) * 0.8;
        if (a < core) h = Math.min(h, 0.2);
        else if (a < core * 2.4) h = Math.min(h, 0.95 - 0.5 * I.k);
      }
      return h;
    };
    const v = new THREE.Vector3(), C = H8.cockpitC;
    for (let ie = 0; ie < 16; ie++) for (let ia = 0; ia < 32; ia++) this.panelHP[ie * 32 + ia] = health(panelDir(ia, ie, v));
    for (let iz = 0; iz < 16; iz++) for (let ix = 0; ix < 16; ix++) {
      v.set((ix - 8 + 0.5) * 0.24 - C.x, FLOOR.y - C.y, (iz - 8 + 0.5) * 0.24 - C.z).normalize();
      this.floorHP[iz * 16 + ix] = health(v);
    }
  }

  /** the repair dock replaces the hurt panels */
  repairPanels() { this.impacts.length = 0; this.wornTo = 0; this.uniforms.uWear.value = 0; this.syncImpacts(); }

  /** the hits for the save */
  serializePanels() {
    return { imp: this.impacts.map((I) => [+I.dir.x.toFixed(4), +I.dir.y.toFixed(4), +I.dir.z.toFixed(4), +I.R.toFixed(4), +I.k.toFixed(3), +I.seed.toFixed(4), I.wear ? 1 : 0]) };
  }

  restorePanels(saved, wear = 0) {
    this.impacts.length = 0;
    // (the saved hits already carry the wear)
    this.wornTo = wear; this.uniforms.uWear.value = wear;
    if (saved && Array.isArray(saved.imp)) {
      for (const [x, y, z, R, k, seed, w] of saved.imp) {
        const d = new THREE.Vector3(x, y, z);
        if (!(d.lengthSq() > 0.5)) continue;
        this.impacts.push({ dir: d.normalize(), R, k, seed, t: this.t - 60, wear: !!w });
      }
    } else if (Array.isArray(saved)) {
      // an older save: hurt panels, each a hit at its middle
      const v = new THREE.Vector3(), C = H8.cockpitC;
      for (const [i, h] of saved) {
        if (h >= 0.95 || this.impacts.length >= MAX_IMP) continue;
        if (i >= 1000) { const j = i - 1000, ix = j % 16, iz = Math.floor(j / 16); v.set((ix - 8 + 0.5) * 0.24 - C.x, FLOOR.y - C.y, (iz - 8 + 0.5) * 0.24 - C.z).normalize(); }
        else panelDir(i % 32, Math.floor(i / 32), v);
        this.addImpact(v, 0.07, Math.min(1, (0.95 - h) / 0.6), true);
      }
    }
    this.syncImpacts();
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
    for (let i = 0; i < this.impacts.length; i++) U.uImpK.value[i].z = Math.min(600, Math.max(0, this.t - this.impacts[i].t));
  }
}
