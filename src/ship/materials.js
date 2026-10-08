// Ship materials: MeshStandardMaterial with injected procedural detail in ship space
// (grime, wear, panel seams), hull dents (vertex displacement), openings/breaches (discard),
// heat glow, plus glass and emissive helpers.
import { QUALITY } from '../core/quality.js';
import * as THREE from 'three';
import { noiseTex } from '../core/noiseTex.js';
import { detailTextures, DETAIL_TILE } from './detailTex.js';
import { OUTLINE_GLSL } from './tornMetal.js';
import { strikeGLSL, B29_STRIKE_U } from '../combat/strikes.js';

export const MAX_DENTS = 48;
export const MAX_PEEL = 24;
export const MAX_OPEN = 16;
export const MAX_BREACH = 10;

// Dents and torn-off skin panels live in a small float texture rather than uniform arrays (far
// more of them than a small GPU's uniform space would take). One column per dent / panel:
//   row 0  dent centre xyz, radius          row 3  panel rect in its projection: u0 u1 v0 v1
//   row 1  dent push dir xyz, depth         row 4  axis (0 x 1 y 2 z), side (+-1), plane, style
//   row 2  heat, seed, sharpness, -         row 5  heat, seed, recess depth, cluster radius
export const DENT_ROWS = 6;
export const dentData = new Float32Array(MAX_DENTS * DENT_ROWS * 4);
const dentTex = new THREE.DataTexture(dentData, MAX_DENTS, DENT_ROWS, THREE.RGBAFormat, THREE.FloatType);
dentTex.minFilter = dentTex.magFilter = THREE.NearestFilter;
dentTex.generateMipmaps = false;
dentTex.needsUpdate = true;

// uniforms shared by every ship material (updated by the damage system)
export const shipUniforms = {
  uWorldToShip: { value: new THREE.Matrix4() },
  tDents: { value: dentTex },
  uDentN: { value: 0 },
  uPeelN: { value: 0 },
  uOpen: { value: Array.from({ length: MAX_OPEN }, () => new THREE.Matrix4()) },
  uOpenCount: { value: 0 },
  uBreach: { value: Array.from({ length: MAX_BREACH }, () => new THREE.Vector4(0, 0, 0, 0)) }, // xyz, w radius
  uBreachN: { value: Array.from({ length: MAX_BREACH }, () => new THREE.Vector4(0, 1, 0, 0)) }, // surface normal, w seed
  uBreachS: { value: Array.from({ length: MAX_BREACH }, () => new THREE.Vector4(0, 1.12, 0, 0)) }, // frost, inner scale, patched
  uHeat: { value: 0 },
  uHeatDir: { value: new THREE.Vector3(0, 0, -1) },
  uTime: { value: 0 },
  uScorch: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0)) },
  tNoise3D: noiseTex,
  uCanopy: { value: new THREE.Vector4(0, 0, 0, -1e9) },
};

// a dent's depth profile at s = distance / radius: a smooth bowl for a broad blow (sharp 0) with
// crumpled ripples toward the rim; a crater with a raised lip round it for a punch (sharp 1)
const DENT_PROFILE = /* glsl */`
float dentProfile(float s, float sharp, float seed){
  if (s >= 1.4) return 0.0;
  float f = 1.0 - smoothstep(0.0, 1.0, s);
  f = f * f * (3.0 - 2.0 * f);
  float broad = f * (1.0 + 0.18 * sin(s * 18.0 + seed) * f);
  float q = max(0.0, 1.0 - s * s);
  float lx = (s - 1.08) / 0.16;
  float punch = q * q - 0.24 * exp(-lx * lx);
  return mix(broad, punch, sharp);
}
vec4 dentTexel(int i, int row){ return texelFetch(tDents, ivec2(i, row), 0); }
`;

const COMMON_VERT_PARS = /* glsl */`
uniform mat4 uWorldToShip;
uniform highp sampler2D tDents;
uniform int uDentN;
varying vec3 vShipPos;
varying vec3 vShipNrm;
#ifdef DENTABLE
${DENT_PROFILE}
vec3 dentOffset(vec3 p, out float dsum){
  vec3 off = vec3(0.0); dsum = 0.0;
  for (int i = 0; i < ${MAX_DENTS}; i++){
    if (i >= uDentN) break;
    vec4 D = dentTexel(i, 0);
    vec3 dp = p - D.xyz;
    float reach = D.w * 1.4;
    if (D.w <= 0.0 || dot(dp, dp) > reach * reach) continue;
    vec4 E = dentTexel(i, 1), X = dentTexel(i, 2);
    float h = dentProfile(length(dp) / D.w, X.z, X.y);
    off += E.xyz * E.w * h;
    dsum += max(h, 0.0) * E.w;
  }
  return off;
}
#endif
`;

const COMMON_FRAG_PARS = /* glsl */`
uniform mat4 uOpen[${MAX_OPEN}];
uniform int uOpenCount;
uniform vec4 uBreach[${MAX_BREACH}];
uniform vec4 uBreachN[${MAX_BREACH}];
uniform vec4 uBreachS[${MAX_BREACH}];
uniform float uHeat;
uniform vec3 uHeatDir;
uniform float uTime;
uniform vec4 uScorch[8];
uniform mat4 uWorldToShip;
varying vec3 vShipPos;
varying vec3 vShipNrm;
varying float vDent;
uniform highp sampler3D tNoise3D;
vec4 nz(vec3 p){ return texture(tNoise3D, p); }
float sn(vec3 p){ return texture(tNoise3D, p).g * 2.0 - 1.0; }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// opening: mat4 columns = (centre, halfW), (u, halfH), (v, radius), (n, depthTol)
float openingMask(vec3 p){
  for (int i = 0; i < ${MAX_OPEN}; i++){
    if (i >= uOpenCount) break;
    mat4 O = uOpen[i];
    vec3 d = p - O[0].xyz;
    float dn = dot(d, O[3].xyz);
    if (abs(dn) > O[3].w) continue;
    vec2 q = vec2(dot(d, O[1].xyz), dot(d, O[2].xyz));
    vec2 hs = vec2(O[0].w, O[1].w);
    float r = O[2].w;
    vec2 k = abs(q) - hs + r;
    float sd = length(max(k, 0.0)) + min(max(k.x, k.y), 0.0) - r;
    if (sd < 0.0) return 1.0;
  }
  return 0.0;
}
uniform vec4 uCanopy; // xyz normal, w = -dot(N, P0)
float canopyMask(vec3 p){
  if (p.z > -9.3 || p.z < -14.0 || abs(p.x) > 3.3 || p.y < -2.6 || p.y > 3.3) return 0.0;
  if (dot(p, uCanopy.xyz) + uCanopy.w <= 0.0) return 0.0;
  if (abs(p.x + 0.62) < 0.04 || abs(p.x - 0.62) < 0.04 || abs(p.y - 1.78) < 0.04) return 0.0;
  return 1.0;
}
${OUTLINE_GLSL}
// torn holes through the skin and the inner wall (the outline matches the torn-metal geometry);
// rim: scorched / bare zone around the tear, cr: hairline paint cracks running on from the tear
// slits, fr: frost where escaping air freezes on the inner wall
float breachMask(vec3 p, out float rim, out float cr, out float fr){
  rim = 0.0; cr = 0.0; fr = 0.0;
  float m = 0.0;
  float pw = length(fwidth(p));      // pixel footprint (m), taken in uniform control flow
  for (int i = 0; i < ${MAX_BREACH}; i++){
    vec4 B = uBreach[i];
    if (B.w <= 0.0) continue;
    vec4 Nn = uBreachN[i];
    vec3 d = p - B.xyz;
    float dn = dot(d, Nn.xyz);
    if (dn > 0.25 || dn < -0.42) continue;
    vec3 t1 = bTangent(Nn.xyz);
    vec3 t2 = cross(Nn.xyz, t1);
    vec2 q = vec2(dot(d, t1), dot(d, t2));
    float r = length(q);
    if (r > B.w * 5.0 + 0.35) continue;
    float th = atan(q.y, q.x);
    float inner = step(dn, -0.1);
    float s = Nn.w + inner * 7.3;
    float R = B.w * mix(1.0, uBreachS[i].y, inner);
    float rr = R * breachOutline(th, s);
    if (r < rr) m = 1.0;
    rim = max(rim, 1.0 - smoothstep(rr, rr + 0.025 + R * 0.7, r));
    // paint cracks: continue the tear slits outward as wandering hairlines
    float P = bPetals(s);
    float x = th * P / 6.2831853 + fract(s * 0.37);
    float k = floor(x + 0.5);
    float e = (x - k) * 6.2831853 / P * r + sn(p * 7.0 + B.xyz) * 0.018 + sn(p * 21.0) * 0.005;
    float len = R * (0.9 + 2.2 * bHash(mod(k, P), s + 2.0)) + 0.04;
    float w = max(0.0016, pw * 0.8);
    cr = max(cr, smoothstep(w, 0.0, abs(e)) * step(rr, r) * (1.0 - smoothstep(rr, rr + len, r)));
    fr = max(fr, uBreachS[i].x * inner * (1.0 - smoothstep(rr, rr + R * 1.6 + 0.1, r)));
  }
  return m;
}
// inner linings below the hull (corridor vault): the hole is the breach above projected straight down
float breachMaskUp(vec3 p, out float rim, out float cr, out float fr){
  rim = 0.0; cr = 0.0; fr = 0.0;
  float m = 0.0;
  for (int i = 0; i < ${MAX_BREACH}; i++){
    vec4 B = uBreach[i];
    if (B.w <= 0.0) continue;
    float dy = B.y - p.y;
    if (dy < -0.1 || dy > 1.0) continue;
    float d = length(p.xz - B.xz);
    float jag = (B.w * 1.2 + 0.015) * (1.0 + 0.45 * sn(p * 1.1 + B.xyz) + 0.2 * sn(p * 3.9));
    if (d < jag) m = 1.0;
    rim = max(rim, 1.0 - smoothstep(jag, jag + 0.1 + B.w * 0.6, d));
  }
  return m;
}
vec2 panelAt(vec2 pg, float size){
  vec2 cell = pg / size;
  vec2 off = vec2(0.5 * floor(cell.y), 0.0);
  vec2 f = abs(fract(cell + off) - 0.5);
  float seam = smoothstep(0.012, 0.0, min(0.5 - f.x, 0.5 - f.y) * size);
  return vec2(seam, hash12(floor(cell + off)));
}
// inner pressure-hull half width at (z, y) - mirrors hullShape.js (inset 0.22)
float hullHalfWidth(float z, float y){
  float a = 3.05, b = 2.55, c = 0.4, n = 2.8;
  if (z < -9.0){
    float u = min(1.0, (-9.0 - z) / 4.4);
    float k = sqrt(max(1e-4, 1.0 - u * u));
    a = 3.05 * pow(k, 0.92); b = 2.55 * pow(k, 0.98); c = 0.4 + 0.42 * u * u; n = 2.8 - 0.75 * u;
  } else if (z > 4.6){
    float u = min(1.0, (z - 4.6) / 6.1);
    float s = u * u * (3.0 - 2.0 * u);
    a = 3.05 - 1.32 * s; b = 2.55 - 0.82 * s; n = 2.8 - 0.55 * s;
  }
  a = max(0.001, a - 0.22); b = max(0.001, b - 0.22);
  float v = abs((y - c) / b);
  if (v >= 1.0) return 0.0;
  return a * pow(max(1e-5, 1.0 - pow(v, n)), 1.0 / n);
}
// analytic ambient occlusion for the cabin: contact darkening where things meet the decks,
// soft corners where the deck meets the hull, the corridor walls and the bulkheads
float shipAO(vec3 p, vec3 n){
  if (p.z < -12.2 || p.z > 9.7) return 1.0;
  float W = hullHalfWidth(p.z, clamp(p.y, -1.9, 2.6));
  if (abs(p.x) > W + 0.03) return 1.0;                       // outside the pressure hull
  float ao = 1.0;
  float up = max(n.y, 0.0);
  // surfaces standing on the main deck / the underfloor walkway
  float yd = p.y;
  if (yd > -0.03 && yd < 0.7) ao *= 1.0 - 0.42 * exp(-max(yd, 0.0) / 0.13) * (1.0 - up);
  float yw = p.y + 1.55;
  if (abs(p.x) < 0.75 && yw > -0.03 && yw < 0.6) ao *= 1.0 - 0.35 * exp(-max(yw, 0.0) / 0.12) * (1.0 - up);
  // floors near walls
  if (n.y > 0.5 && abs(p.y) < 0.08) {
    float d = W - abs(p.x);
    if (p.z > -8.4 && p.z < 5.6) d = min(d, abs(abs(p.x) - 0.7) - 0.045);
    float dz = min(abs(p.z + 8.4), min(abs(p.z - 5.6), abs(p.z - 9.6))) - 0.05;
    if (p.x < -0.7) dz = min(dz, min(abs(p.z + 3.0), abs(p.z - 0.4)) - 0.03);
    if (p.x > 0.7) dz = min(dz, min(abs(p.z + 4.6), min(abs(p.z + 2.6), abs(p.z - 0.6))) - 0.03);
    d = min(d, dz);
    ao *= 1.0 - 0.4 * exp(-max(d, 0.0) / 0.2) * n.y;
  }
  // upper corners: the vault / ceiling coves get a soft falloff toward the hull top
  if (n.y < -0.3) ao *= 1.0 - 0.18 * smoothstep(1.9, 2.7, p.y) * (-n.y);
  return ao;
}
float scorchAt(vec3 p){
  float s = 0.0;
  for (int i = 0; i < 8; i++){
    vec4 S = uScorch[i];
    if (S.w <= 0.0) continue;
    float d = length(p - S.xyz);
    s = max(s, 1.0 - smoothstep(0.0, S.w, d));
  }
  return s * (0.7 + 0.3 * sn(p * 0.6));
}
#ifdef DENTABLE
uniform highp sampler2D tDents;
uniform int uDentN;
${DENT_PROFILE}
// the dents at this pixel: the relief the vertices are too far apart to carry (the small ones
// whole, the creases of the crumpled metal in every one) and the glow of a fresh hit
void dentFrag(vec3 p, out float bump, out float heat, out float depth){
  bump = 0.0; heat = 0.0; depth = 0.0;
  for (int i = 0; i < ${MAX_DENTS}; i++){
    if (i >= uDentN) break;
    vec4 D = dentTexel(i, 0);
    vec3 dp = p - D.xyz;
    float reach = D.w * 1.4;
    if (D.w <= 0.0 || dot(dp, dp) > reach * reach) continue;
    vec4 E = dentTexel(i, 1), X = dentTexel(i, 2);
    float s = length(dp) / D.w;
    float h = dentProfile(s, X.z, X.y);
    float fine = 1.0 - smoothstep(0.1, 0.32, D.w);
    float crease = sn(p * 9.0 + X.y) * 0.5 + sn(p * 23.0 + X.y * 1.7) * 0.25;
    bump -= h * E.w * fine + E.w * max(0.0, 1.0 - s) * crease * 0.16;
    depth += max(h, 0.0) * E.w;
    heat = max(heat, X.x * (1.0 - smoothstep(0.0, 0.55, s)));
  }
}
#endif
#ifdef PEEL
uniform int uPeelN;
// Skin panels torn off the hull. Where one was, the bay under it shows as a real recess: the view
// ray is followed down into it to its floor (stringers and frames over the gold insulation
// blanket, a bare flange round the edge with the rivets sheared off), or it meets the side of the
// hole on the way (the cut edge of the skin). style 0: the panel ripped off along its seams;
// 1: a jagged hole torn in it; 2: heat-shield tiles knocked off the belly (white silica showing
// in the broken neighbours, the felt pad they sat on)
float peelSd(int style, vec2 q, vec2 hs, float seed, vec2 uv){
  if (style == 0) return max(abs(q.x) - hs.x, abs(q.y) - hs.y);
  vec2 e = q / (hs * 0.92);
  float a = atan(e.y, e.x);
  float rad = 0.68 + 0.18 * sin(a * 3.0 + seed) + 0.09 * sin(a * 7.0 + seed * 2.3) + 0.05 * sin(a * 23.0 + seed * 5.1) + 0.06 * sn(vec3(uv * 5.0, seed));
  return (length(e) - rad) * min(hs.x, hs.y);
}
float tileGone(vec2 xz, vec2 c, float R, float seed){
  float zi = floor(xz.y / 0.16);
  float xj = floor(xz.x / 0.16 + zi * 0.5);
  vec2 tc = vec2((xj + 0.5 - zi * 0.5) * 0.16, (zi + 0.5) * 0.16);
  return step(length(tc - c), R * (0.5 + 0.5 * hash12(vec2(zi, xj) + seed)));
}
// the bay's floor at l (m from the panel's corner; size: the panel)
void bayFloor(vec2 l, vec2 size, float seed, out vec3 col, out float rough, out float metal, out float h){
  // gold insulation blanket, crinkled, quilted
  float cr = sn(vec3(l * 30.0, seed)) * 0.6 + sn(vec3(l * 75.0, seed + 3.0)) * 0.4;
  vec2 qf = abs(fract(l / 0.15 + 0.5) - 0.5) * 0.15;
  float stitch = smoothstep(0.003, 0.0, min(qf.x, qf.y)) * step(0.5, fract((l.x + l.y) * 60.0));
  col = vec3(0.6, 0.41, 0.13) * (0.72 + 0.5 * cr) * (1.0 - 0.6 * stitch);
  rough = 0.3 + 0.15 * cr; metal = 0.75; h = cr * 0.002;
  // torn open toward the middle: the silver inner layers
  float torn = smoothstep(0.6, 0.7, nz(vec3(l * 3.0, seed * 0.1)).r) * (1.0 - smoothstep(0.15, 0.5, length(l - size * 0.5)));
  col = mix(col, vec3(0.62, 0.64, 0.66) * (0.8 + 0.3 * cr), torn);
  // a cable bundle along it
  float cb = 1.0 - smoothstep(0.012, 0.016, abs(l.y - 0.41));
  float band = step(0.82, fract(l.x * 5.0 + seed));
  col = mix(col, mix(vec3(0.03), vec3(0.5, 0.06, 0.04), band), cb); rough = mix(rough, 0.55, cb); metal = mix(metal, 0.05, cb); h += cb * 0.012;
  // stringers along the panel, frames across it (primer green-grey, worn bright on the edges)
  float ds = abs(fract((l.y - 0.1) / 0.2 + 0.5) - 0.5) * 0.2;
  float st = 1.0 - smoothstep(0.009, 0.012, ds);
  float df = abs(fract(l.x / 0.6 + 0.5) - 0.5) * 0.6;
  float fr = 1.0 - smoothstep(0.016, 0.02, df);
  float sf = max(st, fr);
  vec3 primer = vec3(0.34, 0.38, 0.31) * (0.85 + 0.25 * sn(vec3(l * 11.0, seed)));
  col = mix(col, mix(primer, vec3(0.55), smoothstep(0.007, 0.011, ds) * st), sf);
  rough = mix(rough, 0.62, sf); metal = mix(metal, 0.3, sf); h = mix(h, 0.016 + 0.01 * fr, sf);
  // the flange round the edge the panel was fastened to: bare, with the sheared rivets
  vec2 de = min(l, size - l);
  float edge = min(de.x, de.y);
  float fl = 1.0 - smoothstep(0.028, 0.032, edge);
  float along = de.x < de.y ? l.y : l.x;
  float rv = 1.0 - smoothstep(0.0035, 0.005, length(vec2((fract(along / 0.04) - 0.5) * 0.04, edge - 0.016)));
  col = mix(col, vec3(0.58, 0.59, 0.61) * (0.9 + 0.2 * sn(vec3(l * 40.0, seed))), fl);
  col = mix(col, vec3(0.78, 0.78, 0.8), rv * fl);
  rough = mix(rough, 0.34, fl); metal = mix(metal, 0.85, fl); h = mix(h, 0.026 + rv * 0.003, fl);
}
void peelFrag(vec3 p, vec3 nrm, inout float bumpH, out float on, out vec3 col, out float rough, out float metal, out float ao, out vec3 em, out float rimK, out vec3 rimCol){
  on = 0.0; col = vec3(0.0); rough = 0.5; metal = 0.0; ao = 1.0; em = vec3(0.0); rimK = 0.0; rimCol = vec3(0.0);
  for (int j = 0; j < ${MAX_PEEL}; j++){
    if (j >= uPeelN) break;
    vec4 Ax = dentTexel(j, 4);
    int ax = int(Ax.x + 0.5);
    float pa = ax == 0 ? p.x : (ax == 1 ? p.y : p.z);
    float na = ax == 0 ? nrm.x : (ax == 1 ? nrm.y : nrm.z);
    if (na * Ax.y < 0.3 || abs(pa - Ax.z) > 0.75) continue;
    vec4 Rr = dentTexel(j, 3), St = dentTexel(j, 5);
    vec2 uv = ax == 0 ? p.zy : (ax == 1 ? p.xz : p.xy);
    int style = int(Ax.w + 0.5);
    vec2 c = vec2(Rr.x + Rr.y, Rr.z + Rr.w) * 0.5, hs = vec2(Rr.y - Rr.x, Rr.w - Rr.z) * 0.5;
    if (any(greaterThan(abs(uv - c), hs + 0.05))) continue;
    float seed = St.y, D = St.z;
    vec3 camS = (uWorldToShip * vec4(cameraPosition, 1.0)).xyz;
    vec3 vd = normalize(p - camS);
    vec3 nA = vec3(ax == 0 ? Ax.y : 0.0, ax == 1 ? Ax.y : 0.0, ax == 2 ? Ax.y : 0.0);
    float cosA = max(0.08, -dot(vd, nA));
    vec2 vuv = (ax == 0 ? vd.zy : (ax == 1 ? vd.xz : vd.xy)) / cosA;
    if (style == 2) {
      vec2 tc = vec2(c.x, c.y);
      if (tileGone(uv, tc, St.w, seed) < 0.5) {
        // a tile left at the edge of the gap: chipped, the white silica showing in the chips
        float near = tileGone(uv + vec2(0.05, 0.0), tc, St.w, seed) + tileGone(uv - vec2(0.05, 0.0), tc, St.w, seed) + tileGone(uv + vec2(0.0, 0.05), tc, St.w, seed) + tileGone(uv - vec2(0.0, 0.05), tc, St.w, seed);
        float chip = step(0.5, near) * smoothstep(0.55, 0.62, nz(vec3(uv * 9.0, seed)).r);
        rimK = max(rimK, chip); rimCol = vec3(0.86, 0.85, 0.82);
        continue;
      }
      on = 1.0;
      float dw = -1.0;
      for (int k = 1; k <= 6; k++){
        float t = float(k) / 6.0;
        if (tileGone(uv + vuv * D * t, tc, St.w, seed) < 0.5) { dw = D * t; break; }
      }
      if (dw < 0.0) {
        // the felt pad the tile sat on (torn off in places down to the primed skin), glue traces
        vec2 lf = uv + vuv * D;
        float glue = smoothstep(0.55, 0.65, nz(vec3(lf * 6.0, seed)).g);
        float bare = step(0.72, hash12(floor(lf / 0.16) + seed * 3.0));
        col = mix(vec3(0.8, 0.78, 0.72), vec3(0.47, 0.41, 0.31), glue);
        col = mix(col, vec3(0.42, 0.47, 0.36), bare);
        rough = 0.95 - bare * 0.35; metal = bare * 0.4; ao = 0.6;
        bumpH = -D + glue * 0.002;
      } else {
        // the side of the next tile: a skin of black coating over the white silica
        col = dw < 0.004 ? vec3(0.05) : vec3(0.84, 0.84, 0.8) * (0.85 + 0.15 * sn(vec3(uv * 30.0, dw * 40.0)));
        rough = 0.95; metal = 0.0; ao = 0.45 + 0.5 * (1.0 - dw / D);
        bumpH = -dw;
      }
      em = vec3(1.0, 0.4, 0.1) * St.x * 2.0;
      return;
    }
    float sd = peelSd(style, uv - c, hs, seed, uv);
    if (sd > 0.035) continue;
    if (sd > 0.0) {
      // the skin that stays round it: a torn edge bent in, bare at the very edge, sooty beyond;
      // a clean rip along the seams leaves a strip of torn sealant
      float e = 1.0 - sd / 0.035;
      if (style == 1) {
        bumpH -= 0.012 * e * e;
        rimK = max(rimK, e * 0.9);
        rimCol = sd < 0.005 ? vec3(0.66, 0.66, 0.68) : vec3(0.05, 0.045, 0.04);
      } else {
        rimK = max(rimK, (1.0 - smoothstep(0.0, 0.01, sd)) * 0.75);
        rimCol = vec3(0.24, 0.24, 0.23);
      }
      em = max(em, vec3(1.0, 0.42, 0.1) * St.x * e * e * 2.5);
      continue;
    }
    on = 1.0;
    // follow the ray down: does it reach the floor, or the side of the hole first?
    float dw = -1.0;
    for (int k = 1; k <= 6; k++){
      float t = float(k) / 6.0;
      vec2 u2 = uv + vuv * D * t;
      if (peelSd(style, u2 - c, hs, seed, u2) > 0.0) { dw = D * (t - 0.5 / 6.0); break; }
    }
    if (dw < 0.0) {
      vec2 uf = uv + vuv * D;
      float hF;
      bayFloor(uf - vec2(Rr.x, Rr.z), hs * 2.0, seed, col, rough, metal, hF);
      ao = mix(0.32, 1.0, smoothstep(0.0, 0.08, -peelSd(style, uf - c, hs, seed, uf)));
      bumpH = -D + hF;
    } else {
      // the cut edge of the skin, then the dark of the bay's side under it
      float lip = 1.0 - smoothstep(0.002, 0.005, dw);
      col = mix(vec3(0.07, 0.075, 0.08), vec3(0.64, 0.65, 0.67), lip);
      rough = mix(0.6, 0.3, lip); metal = mix(0.3, 0.9, lip);
      ao = 0.25 + 0.6 * (1.0 - dw / D);
      bumpH = -dw;
      em = vec3(1.0, 0.42, 0.1) * St.x * lip * 3.0;
    }
    return;
  }
}
#endif
`;

// shadow-map pass for surfaces with windows / canopy / breaches: the light gets through the holes
const DEPTH_FRAG_PARS = /* glsl */`
uniform mat4 uOpen[${MAX_OPEN}];
uniform int uOpenCount;
uniform vec4 uBreach[${MAX_BREACH}];
uniform vec4 uBreachN[${MAX_BREACH}];
uniform vec4 uBreachS[${MAX_BREACH}];
uniform vec4 uCanopy;
uniform highp sampler3D tNoise3D;
varying vec3 vShipPos;
float sn(vec3 p){ return texture(tNoise3D, p).g * 2.0 - 1.0; }
${OUTLINE_GLSL}
bool holeAt(vec3 p){
  for (int i = 0; i < ${MAX_OPEN}; i++){
    if (i >= uOpenCount) break;
    mat4 O = uOpen[i];
    vec3 d = p - O[0].xyz;
    if (abs(dot(d, O[3].xyz)) > O[3].w) continue;
    vec2 q = vec2(dot(d, O[1].xyz), dot(d, O[2].xyz));
    vec2 k = abs(q) - vec2(O[0].w, O[1].w) + O[2].w;
    if (length(max(k, 0.0)) + min(max(k.x, k.y), 0.0) - O[2].w < 0.0) return true;
  }
  if (p.z < -9.3 && p.z > -14.0 && abs(p.x) < 3.3 && p.y > -2.6 && p.y < 3.3 && dot(p, uCanopy.xyz) + uCanopy.w > 0.0
      && !(abs(p.x + 0.62) < 0.04 || abs(p.x - 0.62) < 0.04 || abs(p.y - 1.78) < 0.04)) return true;
  for (int i = 0; i < ${MAX_BREACH}; i++){
    vec4 B = uBreach[i];
    if (B.w <= 0.0) continue;
    vec4 Nn = uBreachN[i];
    vec3 d = p - B.xyz;
    float dn = dot(d, Nn.xyz);
    if (dn > 0.25 || dn < -0.42) continue;
    vec3 t1 = bTangent(Nn.xyz);
    vec2 q = vec2(dot(d, t1), dot(d, cross(Nn.xyz, t1)));
    float inner = step(dn, -0.1);
    if (length(q) < B.w * mix(1.0, uBreachS[i].y, inner) * breachOutline(atan(q.y, q.x), Nn.w + inner * 7.3)) return true;
  }
  return false;
}
`;

/** something lying on the ship's skin (bullet pits, decals) sinks with the dents under it */
export function followDents(mat) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uWorldToShip = shipUniforms.uWorldToShip;
    sh.uniforms.tDents = shipUniforms.tDents;
    sh.uniforms.uDentN = shipUniforms.uDentN;
    sh.defines = Object.assign(sh.defines || {}, { DENTABLE: '' });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON_VERT_PARS)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          mat4 _m = modelMatrix;
          #ifdef USE_INSTANCING
          _m = _m * instanceMatrix;
          #endif
          mat4 _toShip = uWorldToShip * _m;
          float _ds;
          vec3 _off = dentOffset((_toShip * vec4(transformed, 1.0)).xyz, _ds);
          transformed += (inverse(_toShip) * vec4(_off, 0.0)).xyz;
        }`);
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|shipDents';
  mat.needsUpdate = true;
  return mat;
}

/**
 * decals and bullet pits on the skin: gone where the strike engine has taken off what they lie on
 * (minLayer 1: the paint — the lettering goes with it; 2: the skin — the pits go with it)
 */
export function strikeCut(mat, minLayer = 1) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, { tStrike: B29_STRIKE_U.tStrike, uStrikeN: B29_STRIKE_U.uStrikeN, uStrikeTime: B29_STRIKE_U.uStrikeTime, uWorldToShip: shipUniforms.uWorldToShip });
    const decl = sh.vertexShader.includes('uniform mat4 uWorldToShip;') ? '' : 'uniform mat4 uWorldToShip;\n';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + decl + 'varying vec3 vStP; varying vec3 vStN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          mat4 _m2 = modelMatrix;
          #ifdef USE_INSTANCING
          _m2 = _m2 * instanceMatrix;
          #endif
          vStP = (uWorldToShip * _m2 * vec4(transformed, 1.0)).xyz;
          vStN = normalize(mat3(uWorldToShip * _m2) * objectNormal);
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStP; varying vec3 vStN;\n' + strikeGLSL('b29', 'cut'))
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        { StOut _sc = strikeAt(vStP, normalize(vStN), vec3(0.0), 0.0); if (_sc.layer >= ${minLayer.toFixed(1)}) discard; }`);
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|strikeCut' + minLayer;
  mat.needsUpdate = true;
  return mat;
}

function openingDepthMaterial() {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shipUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uWorldToShip;\nvarying vec3 vShipPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShipPos = (uWorldToShip * modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + DEPTH_FRAG_PARS)
      .replace('void main() {', 'void main() {\n  if (holeAt(vShipPos)) discard;');
  };
  m.customProgramCacheKey = () => 'shipHoleDepth';
  return m;
}

/**
 * opts: { dentable, openings (discard windows/breaches), wear (0..1), panels (scale or 0),
 *         grime (0..1), heat (bool), triScale }
 */
export function patchShipMaterial(mat, opts = {}) {
  const o = Object.assign({ dentable: false, openings: false, wear: 0.3, panels: 0, grime: 0.3, heat: false, triScale: 1, rough: 0.0, edge: 0.0, ao: true, detail: null, detailDepth: 0.004, belly: false, wainscot: false, peel: false, strike: null }, opts);
  if (o.peel) o.dentable = true;
  mat.userData.shipPatched = true;
  if (o.openings) mat.userData.depthMat = openingDepthMaterial();
  mat.customProgramCacheKey = () => JSON.stringify(o) + mat.type + QUALITY.level;
  mat.onBeforeCompile = (sh) => {
    // LOW II: plain surfaces (no detail texture, panel seams, grime or roughness noise)
    const L2 = QUALITY.level === 'low2';
    const detail = L2 ? null : o.detail, panels = L2 ? 0 : o.panels;
    Object.assign(sh.uniforms, shipUniforms);
    if (o.dentable) sh.defines = Object.assign(sh.defines || {}, { DENTABLE: '' });
    // (LOW II: no torn-off panels drawn; the dents and holes stay)
    if (o.peel && !L2) sh.defines = Object.assign(sh.defines || {}, { PEEL: '' });
    // the strike engine's craters (the skin: down into it; fittings: burned and sooted)
    if (o.strike) { sh.defines = Object.assign(sh.defines || {}, { STRIKE: '' }); Object.assign(sh.uniforms, { tStrike: B29_STRIKE_U.tStrike, uStrikeN: B29_STRIKE_U.uStrikeN, uStrikeTime: B29_STRIKE_U.uStrikeTime }); }
    // low quality: surface detail from one projection instead of three
    if (QUALITY.level !== 'high') sh.defines = Object.assign(sh.defines || {}, { LOWQ: '' });
    if (L2) sh.defines = Object.assign(sh.defines || {}, { LOW2: '' });
    if (detail) { sh.uniforms.tDetail = { value: detailTextures()[o.detail] }; sh.uniforms.uDetailScale = { value: 1 / DETAIL_TILE[o.detail] }; }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON_VERT_PARS + '\nvarying float vDent;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 _sp = uWorldToShip * modelMatrix * vec4(position, 1.0);
        vShipPos = _sp.xyz;
        vShipNrm = normalize((uWorldToShip * modelMatrix * vec4(normal, 0.0)).xyz);
        vDent = 0.0;
        #ifdef DENTABLE
          float _ds;
          vec3 _off = dentOffset(_sp.xyz, _ds);
          // offset is in ship space; convert back to object space (assumes rigid transforms)
          mat4 _toObj = inverse(uWorldToShip * modelMatrix);
          transformed += (_toObj * vec4(_off, 0.0)).xyz;
          vShipPos += _off;
          vDent = _ds;
        #endif`);
    if (o.dentable) {
      // perturb normal using finite differences of the dent field
      sh.vertexShader = sh.vertexShader.replace('#include <defaultnormal_vertex>', `
        #ifdef DENTABLE
        {
          vec4 _p0 = uWorldToShip * modelMatrix * vec4(position, 1.0);
          vec3 _n0 = normalize((uWorldToShip * modelMatrix * vec4(objectNormal, 0.0)).xyz);
          vec3 _t1 = normalize(abs(_n0.y) < 0.9 ? cross(_n0, vec3(0.0, 1.0, 0.0)) : cross(_n0, vec3(1.0, 0.0, 0.0)));
          vec3 _t2 = cross(_n0, _t1);
          float _e = 0.04, _dd;
          vec3 a0 = _p0.xyz + dentOffset(_p0.xyz, _dd);
          vec3 a1 = _p0.xyz + _t1 * _e + dentOffset(_p0.xyz + _t1 * _e, _dd);
          vec3 a2 = _p0.xyz + _t2 * _e + dentOffset(_p0.xyz + _t2 * _e, _dd);
          vec3 _nn = normalize(cross(a1 - a0, a2 - a0));
          if (dot(_nn, _n0) < 0.0) _nn = -_nn;
          mat4 _toObj2 = inverse(uWorldToShip * modelMatrix);
          objectNormal = normalize((_toObj2 * vec4(_nn, 0.0)).xyz);
        }
        #endif
        #include <defaultnormal_vertex>`);
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON_FRAG_PARS + (detail ? '\nuniform sampler2D tDetail;\nuniform float uDetailScale;' : '') + (o.strike ? '\n' + strikeGLSL('b29', L2 && o.strike === 'deep' ? 'surface' : o.strike) : ''))
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float _bumpH = 0.0;
        float _detailRough = 0.0;
        float _dHeat = 0.0;
        float _peelOn = 0.0, _peelRough = 0.5, _peelMetal = 0.0, _peelAO = 1.0, _rimK = 0.0;
        vec3 _peelCol = vec3(0.0), _peelEm = vec3(0.0), _rimCol = vec3(0.0);
        ${o.openings ? `
        if (openingMask(vShipPos) > 0.5) discard;
        if (canopyMask(vShipPos) > 0.5) discard;
        float _rim, _bcr, _bfr; if (breachMask(vShipPos, _rim, _bcr, _bfr) > 0.5) discard;` : o.breaches ? `
        float _rim, _bcr, _bfr; if (breachMaskUp(vShipPos, _rim, _bcr, _bfr) > 0.5) discard;` : 'float _rim = 0.0, _bcr = 0.0, _bfr = 0.0;'}
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 P = vShipPos * ${o.triScale.toFixed(3)};
          vec3 N = abs(vShipNrm);
          #ifdef LOW2
          float g2 = 0.0;
          diffuseColor.rgb *= mix(1.0, 0.81, ${o.grime.toFixed(3)});
          #else
          vec4 n1 = nz(P * 0.21);
          vec4 n2 = nz(P * 0.9 + 0.37);
          float g1 = n1.r * 2.0 - 1.0;
          float g2 = n2.b * 2.0 - 1.0;
          float streak = sn(vec3(P.x * 0.25, P.y * 1.8, P.z * 0.25));
          float grime = clamp(0.5 + 0.5 * g1 + 0.25 * streak, 0.0, 1.0);
          diffuseColor.rgb *= mix(1.0, 0.62 + 0.38 * (1.0 - grime), ${o.grime.toFixed(3)});
          diffuseColor.rgb *= 1.0 + 0.06 * g2 * ${o.wear.toFixed(3)};
          #endif
          ${detail ? `
          {
            // high-res surface detail, triplanar in ship space (seams, screws, vents, labels...)
            vec3 Pd = vShipPos * uDetailScale;
            #ifdef LOWQ
            vec4 D = N.x > N.y && N.x > N.z ? texture2D(tDetail, Pd.zy) : N.y > N.z ? texture2D(tDetail, Pd.xz) : texture2D(tDetail, Pd.xy);
            #else
            vec3 bwd = N * N * N * N; bwd /= (bwd.x + bwd.y + bwd.z + 1e-5);
            vec4 D = texture2D(tDetail, Pd.zy) * bwd.x + texture2D(tDetail, Pd.xz) * bwd.y + texture2D(tDetail, Pd.xy) * bwd.z;
            #endif
            _bumpH += (D.r - 0.5) * ${o.detailDepth.toFixed(4)};
            diffuseColor.rgb *= 0.5 + D.g;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.085, 0.09), (1.0 - D.a) * 0.6);
            _detailRough = (D.b - 0.5) * 0.55;
          }` : ''}
          ${o.wainscot ? `
          {
            // two-tone lining on the main deck: a dark gunmetal dado below the handrail line with
            // a recessed amber pinstripe along its top edge
            float wy = vShipPos.y;
            float onDeck = step(0.0, wy) * (1.0 - step(9.62, vShipPos.z));
            float low = 1.0 - smoothstep(0.893, 0.899, wy);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.29, 0.315, 0.35), low * onDeck);
            float stripe = smoothstep(0.903, 0.906, wy) * (1.0 - smoothstep(0.925, 0.928, wy));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.27, 0.05), stripe * onDeck);
            _bumpH -= (smoothstep(0.896, 0.901, wy) - smoothstep(0.93, 0.935, wy)) * 0.0018 * onDeck;
            _detailRough -= 0.1 * low * onDeck;
          }` : ''}
          ${o.belly ? `
          {
            // re-entry heat shield: dark ceramic tiles over the belly
            float bel = smoothstep(-0.75, -1.45, vShipPos.y) * smoothstep(-13.6, -12.6, vShipPos.z) * (1.0 - smoothstep(10.2, 10.8, vShipPos.z));
            vec2 tp = vec2(vShipPos.z, vShipPos.x) / 0.16 + vec2(0.0, floor(vShipPos.z / 0.16) * 0.5);
            vec2 tf = abs(fract(tp) - 0.5);
            float tseam = smoothstep(0.455, 0.49, max(tf.x, tf.y));
            float tid = hash12(floor(tp));
            vec3 tileCol = vec3(0.075, 0.075, 0.08) * (0.7 + 0.6 * tid) + vec3(0.03, 0.02, 0.01) * step(0.93, tid);
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(tileCol, vec3(0.2, 0.2, 0.21), tseam), bel);
            _bumpH -= tseam * 0.002 * bel;
            _detailRough += bel * (0.35 + 0.1 * tid);
          }` : ''}
          ${panels > 0 ? `
          // panel seams (grid in ship space), blended across the three projections so curved
          // surfaces do not get jagged seams where the dominant axis flips
          vec3 bw = N * N * N * N; bw /= (bw.x + bw.y + bw.z + 1e-5);
          vec2 pa = panelAt(P.yz, ${panels.toFixed(3)}), pb = panelAt(P.xz, ${panels.toFixed(3)}), pc = panelAt(P.xy, ${panels.toFixed(3)});
          float seam = pa.x * bw.x + pb.x * bw.y + pc.x * bw.z;
          float tint = pa.y * bw.x + pb.y * bw.y + pc.y * bw.z;
          diffuseColor.rgb *= 1.0 - 0.45 * seam;
          diffuseColor.rgb *= 0.93 + 0.1 * tint;
          _bumpH = -seam * 0.0016 + g2 * 0.00035;` : ''}
          float sc = scorchAt(vShipPos);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.025, 0.02), sc * 0.85 * (0.75 + 0.25 * sn(vShipPos * 3.1)));
          // around a tear: soot fading out, scraped bare metal right at the torn edge, paint
          // crazing running on from the slits, frost where the escaping air freezes
          if (_rim > 0.0) {
            float _sootN = 0.65 + 0.35 * sn(vShipPos * 4.3 + 1.7);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.04, 0.035), clamp(_rim * 1.1 * _sootN, 0.0, 0.92));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.56, 0.56, 0.58), smoothstep(0.88, 0.99, _rim) * 0.85);
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.015), _bcr * 0.9);
          if (_bfr > 0.0) {
            float _frN = smoothstep(0.35, 0.75, nz(vShipPos * 2.7).r + _bfr * 0.5);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), clamp(_bfr * _frN * 1.4, 0.0, 0.95));
          }
          // the dents at this pixel: fine relief, the glow of a fresh one
          float _dDepth = vDent;
          #ifdef DENTABLE
          {
            float _dB, _dD;
            dentFrag(vShipPos, _dB, _dHeat, _dD);
            _bumpH += _dB;
            _dDepth = max(vDent, _dD);
          }
          #endif
          // stretched / scraped metal inside dents, the paint crazed and flaking off the deepest
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.72 + vec3(0.04), clamp(_dDepth * 4.0, 0.0, 0.7));
          float _dz = smoothstep(0.012, 0.07, _dDepth);
          if (_dz > 0.0) {
            float _craze = smoothstep(0.05, 0.0, abs(sn(vShipPos * 5.5 + 3.1))) + smoothstep(0.035, 0.0, abs(sn(vShipPos * 13.0 + 7.7))) * 0.7;
            float _flake = smoothstep(0.58, 0.66, nz(vShipPos * 3.3 + 0.4).r) * smoothstep(0.03, 0.12, _dDepth);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), clamp(_craze, 0.0, 1.0) * _dz * 0.8);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.3, 0.25), _flake * 0.85);   // primer under flaked paint
          }
          // a fresh strike: the metal blackened round the glowing middle
          diffuseColor.rgb *= 1.0 - 0.6 * smoothstep(0.0, 0.4, _dHeat);
          #ifdef PEEL
          peelFrag(vShipPos, normalize(vShipNrm), _bumpH, _peelOn, _peelCol, _peelRough, _peelMetal, _peelAO, _peelEm, _rimK, _rimCol);
          diffuseColor.rgb = mix(diffuseColor.rgb, _rimCol, _rimK);
          if (_peelOn > 0.5) diffuseColor.rgb = _peelCol;
          #endif
          #ifdef STRIKE
          {
            // the strike engine: soot and chipped paint round a crater, the crater itself
            StOut _st = strikeAt(vShipPos, normalize(vShipNrm), (uWorldToShip * vec4(cameraPosition, 1.0)).xyz, length(fwidth(vShipPos)));
            diffuseColor.rgb = mix(diffuseColor.rgb, ST_SOOT, _st.soot * 0.9);
            diffuseColor.rgb = mix(diffuseColor.rgb, _st.kind > 0.5 ? ST_CHIP_B : ST_CHIP, _st.chip * 0.85);
            if (_st.on > 0.5) { diffuseColor.rgb = _st.col; _peelOn = 1.0; _peelRough = _st.rough; _peelMetal = _st.metal; _peelAO = min(_peelAO, _st.ao); }
            _bumpH += _st.bump;
            _peelEm += _st.em;
          }
          #endif
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${panels > 0 || detail || o.belly || o.dentable ? `
        {
          // relief: recessed panel seams + faint waviness (derivative bump, view space). It fades
          // where a pixel spans several millimetres of wall (far away, low resolution): there the
          // per-pixel slope only made highlights sparkle as the view moved
          vec2 dH = vec2(dFdx(_bumpH), dFdy(_bumpH));
          dH *= 1.0 - 0.75 * smoothstep(0.0025, 0.009, length(fwidth(vShipPos)));
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1) * faceDirection;
          vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
          vec3 nb = normalize(abs(det) * normal - grad);
          if (abs(det) > 1e-12) normal = nb;
        }` : ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          vec3 P = vShipPos * ${o.triScale.toFixed(3)};
          #ifdef LOW2
          float rn = 0.0;
          #else
          float rn = nz(P * 0.43 + 0.7).r * 2.0 - 1.0;
          #endif
          roughnessFactor = clamp(roughnessFactor + rn * 0.18 * ${o.wear.toFixed(3)} + ${o.rough.toFixed(3)} + vDent * 0.8 + _detailRough, 0.04, 1.0);
          roughnessFactor = mix(roughnessFactor, 0.3, smoothstep(0.88, 0.99, _rim) * 0.8);
          roughnessFactor = mix(roughnessFactor, 0.95, clamp(_bfr * 1.3, 0.0, 1.0));
          #ifndef LOW2
          float scr = nz(vec3(P.x * 1.3, P.y * 0.1, P.z * 1.3)).b * 2.0 - 1.0;
          roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.55, smoothstep(0.82, 0.95, scr) * ${o.wear.toFixed(3)});
          #endif
          if (_peelOn > 0.5) roughnessFactor = _peelRough;
        }`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        if (_peelOn > 0.5) metalnessFactor = _peelMetal;`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        #if defined(PEEL) || defined(STRIKE)
        reflectedLight.indirectDiffuse *= _peelAO;
        reflectedLight.indirectSpecular *= _peelAO;
        reflectedLight.directDiffuse *= mix(1.0, _peelAO, 0.7);
        reflectedLight.directSpecular *= _peelAO;
        #endif
        ${o.ao ? `
        {
          float _ao = shipAO(vShipPos, normalize(vShipNrm));
          reflectedLight.indirectDiffuse *= _ao;
          reflectedLight.indirectSpecular *= mix(1.0, _ao, 0.75);
          reflectedLight.directDiffuse *= mix(1.0, _ao, 0.6);
          reflectedLight.directSpecular *= mix(1.0, _ao, 0.45);
        }` : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${o.heat ? `
        {
          float facing = clamp(dot(normalize(vShipNrm), -uHeatDir) * 0.5 + 0.5, 0.0, 1.0);
          float h = uHeat * pow(facing, 2.2) * (0.75 + 0.25 * sn(vShipPos * 0.17 + vec3(0.0, uTime * 0.25, 0.0)));
          vec3 hc = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.75, 0.35), clamp(h * 0.9, 0.0, 1.0));
          totalEmissiveRadiance += hc * h * h * 18.0;
        }` : ''}
        totalEmissiveRadiance += vec3(1.0, 0.45, 0.12) * _rim * _rim * 0.0;
        // a fresh strike glows: white-hot in the middle, orange to dull red outward, cooling
        totalEmissiveRadiance += _peelEm + mix(vec3(0.9, 0.16, 0.02), vec3(1.0, 0.78, 0.5), _dHeat * _dHeat) * _dHeat * _dHeat * 4.0;`);
  };
  return mat;
}

function std(color, rough, metal, extra = {}) {
  return new THREE.MeshStandardMaterial(Object.assign({ color: new THREE.Color(color), roughness: rough, metalness: metal }, extra));
}

/** canvas based tiling textures (generated once) */
function canvasTex(size, draw, repeat = 1, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

export function createMaterials() {
  const M = {};
  // ---- exterior ----
  M.hull = patchShipMaterial(std(0xdcdeda, 0.5, 0.18), { dentable: true, openings: true, wear: 0.8, grime: 0.55, heat: true, ao: false, detail: 'hull', detailDepth: 0.006, belly: true, strike: 'surface' });
  // the skin itself (not the fittings on it): its panels can be torn off
  M.hullSkin = patchShipMaterial(std(0xdcdeda, 0.5, 0.18), { dentable: true, openings: true, wear: 0.8, grime: 0.55, heat: true, ao: false, detail: 'hull', detailDepth: 0.006, belly: true, peel: true, strike: 'deep' });
  // the outer hatch leaf sits inside the hull's hatch opening, which the hull material cuts away:
  // it needs the same look without the opening cut (it rendered invisible when closed)
  M.hatchLeaf = patchShipMaterial(std(0xdcdeda, 0.5, 0.18), { dentable: false, openings: false, wear: 0.8, grime: 0.55, heat: true, ao: false, detail: 'hull', detailDepth: 0.006 });
  M.hullDark = patchShipMaterial(std(0x4a4e55, 0.5, 0.35), { dentable: true, wear: 0.7, panels: 0.8, grime: 0.4, heat: true, ao: false, strike: 'surface' });
  M.hullOrange = patchShipMaterial(std(0xd2691e, 0.5, 0.1), { dentable: true, wear: 0.9, grime: 0.5, heat: true, ao: false, strike: 'surface' });
  M.metal = patchShipMaterial(std(0xa8adb3, 0.32, 0.9), { wear: 0.6, grime: 0.3 });
  M.metalDark = patchShipMaterial(std(0x3a3d42, 0.45, 0.8), { wear: 0.5, grime: 0.3 });
  M.gold = patchShipMaterial(std(0xc8a24a, 0.28, 1.0), { wear: 0.8, grime: 0.15, heat: true });
  M.mli = patchShipMaterial(std(0xd8c27a, 0.38, 0.85), { wear: 0.9, grime: 0.2, detail: 'mli', detailDepth: 0.012, ao: false }); // insulation blanket foil (quilted)
  M.radiator = patchShipMaterial(std(0xe2e5e8, 0.32, 0.25, { emissive: new THREE.Color(0.9, 0.18, 0.05), emissiveIntensity: 0.0 }), { wear: 0.5, grime: 0.4, detail: 'rad', detailDepth: 0.004, ao: false });
  M.nozzle = patchShipMaterial(std(0x55504a, 0.4, 0.95, { emissive: new THREE.Color(1.0, 0.35, 0.1), emissiveIntensity: 0.0 }), { wear: 0.9, grime: 0.6, heat: true });
  M.solar = std(0x1a2a55, 0.25, 0.6);
  // the nose's sensor band (where the canopy was): dark armoured glass, a hard clear coat
  M.sensorGlass = new THREE.MeshPhysicalMaterial({ color: 0x06090d, roughness: 0.12, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 });
  if (!M.lens) M.lens = new THREE.MeshPhysicalMaterial({ color: 0x0a1018, roughness: 0.04, metalness: 0.6, clearcoat: 1, iridescence: 0.6 });
  // ---- interior ----
  M.wall = patchShipMaterial(std(0xb4b9bc, 0.62, 0.12), { dentable: true, openings: true, wear: 0.55, grime: 0.4, detail: 'panel', detailDepth: 0.005, wainscot: true });
  // bulkheads and corridor walls: the same armoured lining (kept apart from 'panel', which the
  // furniture and consoles use)
  M.bulk = patchShipMaterial(std(0xa4a9ae, 0.56, 0.22), { wear: 0.6, grime: 0.38, detail: 'panel', detailDepth: 0.005, wainscot: true });
  // heavy structure: dark gunmetal frames, kick plates and hatch collars
  M.armor = patchShipMaterial(std(0x3e434a, 0.44, 0.62), { wear: 0.85, grime: 0.42, detail: 'panel', detailDepth: 0.004 });
  M.frameHeavy = patchShipMaterial(std(0x30343a, 0.38, 0.78), { dentable: true, wear: 0.9, grime: 0.35 });
  M.wallPad = patchShipMaterial(std(0x6f7a87, 0.78, 0.0), { dentable: true, openings: true, wear: 0.3, grime: 0.22, triScale: 2.0, detail: 'pad', detailDepth: 0.007 });
  M.panel = patchShipMaterial(std(0xadb1b4, 0.56, 0.18), { wear: 0.6, grime: 0.3, detail: 'panel' });
  M.panelDark = patchShipMaterial(std(0x5a5f66, 0.52, 0.32), { wear: 0.5, grime: 0.25, detail: 'panel', detailDepth: 0.003 });
  M.vault = patchShipMaterial(std(0xadb1b4, 0.56, 0.18), { wear: 0.6, grime: 0.3, breaches: true, detail: 'panel' });   // corridor vault: torn open by breaches above it
  M.floor = patchShipMaterial(std(0x70757b, 0.7, 0.45), { wear: 0.9, grime: 0.6, detail: 'floor', detailDepth: 0.005 });
  M.frame = patchShipMaterial(std(0x8a8f95, 0.4, 0.75), { dentable: true, wear: 0.7, grime: 0.35 });
  M.rubber = std(0x1d1e20, 0.85, 0.0);
  M.handrail = patchShipMaterial(std(0xc9a227, 0.5, 0.2), { wear: 0.8, grime: 0.3 });
  M.fabric = patchShipMaterial(std(0x6e6258, 0.95, 0.0), { wear: 0.4, grime: 0.25, triScale: 3.0 });
  M.fabricBlue = patchShipMaterial(std(0x3e4d63, 0.95, 0.0), { wear: 0.4, grime: 0.2, triScale: 3.0 });
  M.fabricRed = patchShipMaterial(std(0x7a3a34, 0.95, 0.0), { wear: 0.4, grime: 0.2, triScale: 3.0 });
  M.cushion = patchShipMaterial(std(0x8b7d6b, 0.92, 0.0), { wear: 0.3, grime: 0.15 });
  M.suit = patchShipMaterial(std(0xe8eae4, 0.86, 0.0), { wear: 0.35, grime: 0.22, triScale: 3.0 });   // EVA suit outer layer
  M.visorGold = new THREE.MeshStandardMaterial({ color: 0xd0a648, metalness: 1, roughness: 0.06 });
  M.wood = patchShipMaterial(std(0x8a5a33, 0.6, 0.0, { map: woodTexture() }), { wear: 0.4, grime: 0.15 });
  M.plasticW = patchShipMaterial(std(0xe9e7e1, 0.45, 0.0), { wear: 0.4, grime: 0.25 });
  M.plasticK = patchShipMaterial(std(0x222428, 0.5, 0.0), { wear: 0.3, grime: 0.1 });
  M.plasticY = patchShipMaterial(std(0xe0b21f, 0.45, 0.0), { wear: 0.5, grime: 0.3 });
  M.plasticR = patchShipMaterial(std(0xb3261e, 0.45, 0.0), { wear: 0.5, grime: 0.3 });
  M.plasticB = patchShipMaterial(std(0x2a6fb0, 0.45, 0.0), { wear: 0.5, grime: 0.3 });
  M.plasticG = patchShipMaterial(std(0x3f7d4a, 0.5, 0.0), { wear: 0.5, grime: 0.3 });
  M.cable = std(0x161616, 0.6, 0.0);
  M.cableR = std(0x8c1a14, 0.55, 0.0);
  M.cableB = std(0x173f7a, 0.55, 0.0);
  M.cableY = std(0xb08a14, 0.55, 0.0);
  M.copper = patchShipMaterial(std(0xb87333, 0.35, 1.0), { wear: 0.7, grime: 0.35 });
  M.brass = patchShipMaterial(std(0xb5a642, 0.3, 1.0), { wear: 0.6, grime: 0.25 });
  M.steel = patchShipMaterial(std(0xc0c4c8, 0.25, 1.0), { wear: 0.5, grime: 0.2 });
  M.pipeOrange = patchShipMaterial(std(0xc8641e, 0.55, 0.1), { wear: 0.6, grime: 0.45 });
  M.pipeBlue = patchShipMaterial(std(0x2b5d9c, 0.55, 0.1), { wear: 0.6, grime: 0.45 });
  M.pipeGreen = patchShipMaterial(std(0x3a7a4a, 0.55, 0.1), { wear: 0.6, grime: 0.45 });
  M.pipeYellow = patchShipMaterial(std(0xcaa21c, 0.55, 0.1), { wear: 0.6, grime: 0.45 });
  M.pipeWhite = patchShipMaterial(std(0xd8d8d2, 0.7, 0.0), { wear: 0.5, grime: 0.5 });
  M.pipeRed = patchShipMaterial(std(0xa52a22, 0.55, 0.1), { wear: 0.6, grime: 0.45 });
  M.insul = patchShipMaterial(std(0xcfcab8, 0.95, 0.0), { wear: 0.5, grime: 0.5, triScale: 4.0 });
  M.grate = std(0x55595e, 0.55, 0.8, { alphaMap: grateTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
  // underfloor machinery: glass, glowing process fluids, hazard striping
  M.glassProp = new THREE.MeshStandardMaterial({ color: 0xcfe3ee, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.22, depthWrite: false });
  M.fluidBlue = new THREE.MeshStandardMaterial({ color: 0x0a2a3a, emissive: new THREE.Color(0.15, 0.6, 1.0), emissiveIntensity: 2.2, roughness: 0.1 });
  M.fluidGreen = new THREE.MeshStandardMaterial({ color: 0x0a2a10, emissive: new THREE.Color(0.25, 1.0, 0.3), emissiveIntensity: 1.8, roughness: 0.15 });
  M.uvLamp = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.55, 0.3, 1.0), emissiveIntensity: 6.0 });
  M.hazard = patchShipMaterial(std(0xffffff, 0.6, 0.1, { map: hazardTexture() }), { wear: 0.8, grime: 0.5 });
  M.rubberHose = patchShipMaterial(std(0x26282b, 0.8, 0.0), { wear: 0.3, grime: 0.3 });
  // (leaves are single sheets: lit and seen from both faces, else half of every plant vanished
  // depending on the side it was looked at from)
  M.plant = std(0x3e7a2e, 0.7, 0.0, { side: THREE.DoubleSide });
  M.plant2 = std(0x5c9a3a, 0.7, 0.0, { side: THREE.DoubleSide });
  M.soil = std(0x3a2a1c, 0.95, 0.0);
  M.paper = std(0xe8e2d0, 0.9, 0.0);
  M.book1 = std(0x7a2f2f, 0.8, 0.0); M.book2 = std(0x2f4a7a, 0.8, 0.0); M.book3 = std(0x4f6a3a, 0.8, 0.0); M.book4 = std(0x8a7a4a, 0.8, 0.0);
  M.ceramic = std(0xece8e0, 0.25, 0.0);
  M.mirror = std(0xffffff, 0.02, 1.0);
  M.black = std(0x050505, 0.5, 0.0);
  M.screenOff = std(0x06080b, 0.18, 0.2);
  // emissive light fixtures
  M.lampWarm = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.0, 0.78, 0.52), emissiveIntensity: 3.0, roughness: 0.4 });
  M.lampCool = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.82, 0.9, 1.0), emissiveIntensity: 3.0, roughness: 0.4 });
  M.lampRed = new THREE.MeshStandardMaterial({ color: 0x110000, emissive: new THREE.Color(1.0, 0.08, 0.04), emissiveIntensity: 0.4, roughness: 0.4 });
  // red warning lamps in every room / on the hull: dark until the ship is in danger
  M.dangerLamp = new THREE.MeshStandardMaterial({ color: 0x2a0303, emissive: new THREE.Color(1.0, 0.06, 0.03), emissiveIntensity: 0, roughness: 0.35 });
  M.navDanger = new THREE.MeshStandardMaterial({ color: 0x200000, emissive: new THREE.Color(1.0, 0.05, 0.02), emissiveIntensity: 0 });
  M.ledGreen = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.2, 1.0, 0.35), emissiveIntensity: 4.0 });
  M.ledAmber = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.0, 0.6, 0.1), emissiveIntensity: 4.0 });
  M.ledBlue = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.25, 0.55, 1.0), emissiveIntensity: 4.0 });
  M.ledRed = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.0, 0.1, 0.06), emissiveIntensity: 4.0 });
  // architectural LED lines (cove lights, door frames) - bright enough to bloom
  M.ledStrip = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.72, 0.88, 1.0), emissiveIntensity: 7.0 });
  M.ledStripWarm = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.0, 0.7, 0.42), emissiveIntensity: 6.0 });
  M.ledCyan = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.2, 0.85, 1.0), emissiveIntensity: 6.0 });
  M.cherenkov = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.25, 0.55, 1.0), emissiveIntensity: 9.0 });
  M.navRed = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 0.05, 0.02), emissiveIntensity: 0 });
  M.navGreen = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.05, 1, 0.2), emissiveIntensity: 0 });
  M.navWhite = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 });
  M.stringLight = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.0, 0.7, 0.35), emissiveIntensity: 5.0 });
  M.decal = new THREE.MeshStandardMaterial({ map: shipLettering(), transparent: true, roughness: 0.6, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
  // (the lettering is paint: it sinks with the dents, and goes where the paint is blasted off)
  strikeCut(followDents(M.decal), 1);
  M.poster1 = new THREE.MeshStandardMaterial({ map: posterTexture(1), roughness: 0.8 });
  M.poster2 = new THREE.MeshStandardMaterial({ map: posterTexture(2), roughness: 0.8 });
  M.poster3 = new THREE.MeshStandardMaterial({ map: posterTexture(3), roughness: 0.8 });
  M.labels = new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.6, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
  { const t = roomSignTexture(); M.roomSigns = new THREE.MeshStandardMaterial({ color: 0x000000, map: t, emissiveMap: t, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.1, roughness: 0.4 }); }
  return M;
}

let SIGN_TEX = null;
const SIGNS = [['COCKPIT', '操縦室'], ['LIVING', '居住区'], ['STORAGE', '倉庫'], ['BATH', '浴室'], ['AIRLOCK', 'エアロック'], ['LIFE SUPPORT', '生命維持'], ['ENGINEERING', '機関室'], ['BUNK', '寝台']];
function roomSignTexture() {
  if (SIGN_TEX) return SIGN_TEX;
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0d12'; g.fillRect(0, 0, 1024, 1024);
  SIGNS.forEach(([en, jp], i) => {
    const y = i * 128;
    g.strokeStyle = 'rgba(120,200,255,0.55)'; g.lineWidth = 3; g.strokeRect(8, y + 8, 1008, 112);
    g.fillStyle = '#dff3ff'; g.font = '600 54px "Helvetica Neue", Arial, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText(en, 40, y + 66);
    g.fillStyle = '#ffd38a'; g.font = '500 52px "Hiragino Sans", "Noto Sans JP", sans-serif'; g.textAlign = 'right';
    g.fillText(jp, 984, y + 66);
  });
  SIGN_TEX = new THREE.CanvasTexture(c);
  SIGN_TEX.colorSpace = THREE.SRGBColorSpace;
  SIGN_TEX.anisotropy = 8;
  return SIGN_TEX;
}


function woodTexture() {
  return canvasTex(512, (g, s) => {
    g.fillStyle = '#8a5a33'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 140; i++) {
      const y = Math.random() * s;
      g.strokeStyle = `rgba(${60 + Math.random() * 40},${35 + Math.random() * 20},${15 + Math.random() * 10},${0.15 + Math.random() * 0.25})`;
      g.lineWidth = 1 + Math.random() * 3;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= s; x += 16) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 4 + Math.sin(x * 0.003 + i * 0.7) * 10);
      g.stroke();
    }
  }, 1);
}

function hazardTexture() {
  return canvasTex(128, (g, s) => {
    g.fillStyle = '#d9a514'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#16171a';
    for (let i = -2; i < 4; i++) { g.beginPath(); g.moveTo(i * s / 2, 0); g.lineTo(i * s / 2 + s / 4, 0); g.lineTo(i * s / 2 + s / 4 + s, s); g.lineTo(i * s / 2 + s, s); g.closePath(); g.fill(); }
  }, 1);
}

function grateTexture() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#fff';
    const n = 8, w = s / n;
    for (let i = 0; i <= n; i++) { g.fillRect(i * w - 3, 0, 6, s); g.fillRect(0, i * w - 3, s, 6); }
  }, 6, false);
}

function shipLettering() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 512);
  g.fillStyle = 'rgba(38,42,50,0.93)';
  g.font = 'bold 250px "Helvetica Neue", Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('B-29', 60, 200);
  g.font = 'bold 54px "Helvetica Neue", Arial, sans-serif';
  g.fillText('JA-2941', 70, 380);
  g.fillStyle = '#f2f2ee'; g.fillRect(800, 330, 150, 100);
  g.fillStyle = '#c0242c'; g.beginPath(); g.arc(875, 380, 30, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#d9a21a' : '#222'; g.fillRect(380 + i * 46, 360, 46, 30); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function posterTexture(kind) {
  return canvasTex(512, (g, s) => {
    if (kind === 1) {
      // Earth photo poster
      const gr = g.createRadialGradient(256, 330, 30, 256, 330, 250);
      gr.addColorStop(0, '#2c6fb5'); gr.addColorStop(0.7, '#0c2a55'); gr.addColorStop(1, '#02060e');
      g.fillStyle = '#02040a'; g.fillRect(0, 0, s, s);
      g.fillStyle = gr; g.beginPath(); g.arc(256, 330, 190, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(80,140,60,0.8)'; g.beginPath(); g.ellipse(220, 300, 70, 40, 0.4, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 40; i++) { g.beginPath(); g.ellipse(120 + Math.random() * 280, 200 + Math.random() * 260, 10 + Math.random() * 40, 4 + Math.random() * 10, Math.random(), 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#e8e8e8'; g.font = 'bold 44px sans-serif'; g.fillText('HOME', 40, 70);
    } else if (kind === 2) {
      // childhood crayon drawing of a spaceship
      g.fillStyle = '#f4efe2'; g.fillRect(0, 0, s, s);
      g.lineWidth = 9; g.lineCap = 'round';
      g.strokeStyle = '#3b6fd6'; g.beginPath(); g.ellipse(250, 250, 160, 70, -0.2, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#e04a3a'; g.beginPath(); g.moveTo(100, 290); g.lineTo(40, 340); g.lineTo(120, 320); g.stroke();
      g.strokeStyle = '#f0a020'; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(90 - i * 8, 300 + i * 6); g.lineTo(30 - i * 12, 330 + i * 14); g.stroke(); }
      g.fillStyle = '#4fb0e0'; g.beginPath(); g.arc(320, 225, 28, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e0c020'; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(Math.random() * s, Math.random() * 120, 6, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#333'; g.font = '38px sans-serif'; g.fillText('うちゅうせん かいと 7さい', 40, 470);
    } else {
      // vintage rocket poster
      g.fillStyle = '#1d2b3a'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#e0d2b0'; g.beginPath(); g.moveTo(256, 60); g.quadraticCurveTo(330, 200, 300, 380); g.lineTo(212, 380); g.quadraticCurveTo(182, 200, 256, 60); g.fill();
      g.fillStyle = '#c0392b'; g.beginPath(); g.moveTo(212, 330); g.lineTo(160, 420); g.lineTo(220, 390); g.fill(); g.beginPath(); g.moveTo(300, 330); g.lineTo(352, 420); g.lineTo(292, 390); g.fill();
      g.fillStyle = '#f39c12'; g.beginPath(); g.moveTo(230, 385); g.lineTo(256, 470); g.lineTo(282, 385); g.fill();
      g.fillStyle = '#e0d2b0'; g.font = 'bold 40px serif'; g.fillText('TO THE STARS', 120, 40 + 470);
    }
  }, 1);
}

function labelTexture() {
  return canvasTex(512, (g, s) => {
    g.clearRect(0, 0, s, s);
    const labels = ['O2', 'N2', 'H2O', 'CO2', 'PWR', 'COOLANT', '注意', '高電圧', 'VALVE', 'FIRE', '非常口', 'EVA'];
    labels.forEach((t, i) => {
      const x = (i % 3) * 170 + 5, y = Math.floor(i / 3) * 128 + 10;
      g.fillStyle = i % 4 === 0 ? '#d8b020' : i % 4 === 1 ? '#e8e8e8' : i % 4 === 2 ? '#c0302a' : '#2a6aa8';
      g.fillRect(x, y, 160, 100);
      g.fillStyle = i % 4 === 1 ? '#111' : '#fff';
      g.font = 'bold 40px sans-serif';
      g.fillText(t, x + 12, y + 64);
    });
  }, 1);
}
