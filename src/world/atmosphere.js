// Physically based atmosphere (Rayleigh + Mie + ozone) with precomputed transmittance and
// multiple-scattering LUTs (Bruneton 2017 parametrisation, Hillaire 2020 multi-scattering).
import * as THREE from 'three';

export const ATMO_CONST = /* glsl */`
#ifndef B29_ATMO_CONST
#define B29_ATMO_CONST
#define PI_A 3.14159265359
const float Rg = 6371.0;
const float Rt = 6471.0;
const vec3 rayleighScat = vec3(5.802, 13.558, 33.1) * 1e-3;
const float rayleighH = 8.0;
const float mieScat = 3.996e-3;
const float mieExt = 4.40e-3;
const float mieH = 1.2;
const vec3 ozoneAbs = vec3(0.650, 1.881, 0.085) * 1e-3;
const float mieG = 0.8;

vec3 atmoDensities(float h){
  return vec3(exp(-h / rayleighH), exp(-h / mieH), max(0.0, 1.0 - abs(h - 25.0) / 15.0));
}
vec3 atmoExtinction(vec3 d){
  return rayleighScat * d.x + vec3(mieExt) * d.y + ozoneAbs * d.z;
}
// returns (near, far) distances; far < 0 => miss
vec2 raySphere(vec3 ro, vec3 rd, float R){
  float b = dot(ro, rd);
  float c = dot(ro, ro) - R * R;
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
float distToTop(float r, float mu){
  float disc = r * r * (mu * mu - 1.0) + Rt * Rt;
  return max(0.0, -r * mu + sqrt(max(disc, 0.0)));
}
vec2 transmittanceUV(float r, float mu){
  float H = sqrt(Rt * Rt - Rg * Rg);
  float rho = sqrt(max(r * r - Rg * Rg, 0.0));
  float d = distToTop(r, mu);
  float dmin = Rt - r;
  float dmax = rho + H;
  float xmu = (d - dmin) / max(dmax - dmin, 1e-4);
  float xr = rho / H;
  return vec2(0.5 / 256.0 + xmu * (1.0 - 1.0 / 256.0), 0.5 / 64.0 + xr * (1.0 - 1.0 / 64.0));
}
float phaseRayleigh(float c){ return 3.0 / (16.0 * PI_A) * (1.0 + c * c); }
float phaseMie(float c){
  float g = mieG; float g2 = g * g;
  return 3.0 / (8.0 * PI_A) * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
#endif
`;

export const ATMO_GLSL = ATMO_CONST + /* glsl */`
#ifndef B29_ATMO
#define B29_ATMO
uniform sampler2D tTransmittance;
uniform sampler2D tMultiScat;
uniform vec3 uSunDir;          // world-space unit vector toward the sun
uniform vec3 uEarthCenterKm;   // earth centre in world space (km, camera-relative frame)
uniform float uSunIllum;

vec3 getTransmittance(float r, float mu){
  return texture2D(tTransmittance, transmittanceUV(r, mu)).rgb;
}
// sun transmittance with smooth planet shadow (penumbra)
vec3 sunTransmittance(float r, float muS){
  float muHor = -sqrt(max(1.0 - (Rg * Rg) / (r * r), 0.0));
  float vis = smoothstep(muHor - 0.006, muHor + 0.006, muS);
  return getTransmittance(r, max(muS, muHor)) * vis;
}
vec3 getMultiScat(float r, float muS){
  vec2 uv = vec2(clamp(muS * 0.5 + 0.5, 0.0, 1.0), clamp((r - Rg) / (Rt - Rg), 0.0, 1.0));
  uv = uv * (31.0 / 32.0) + 0.5 / 32.0;
  return texture2D(tMultiScat, uv).rgb;
}

// Integrate single + multiple scattering along ro + rd*t, t in [tStart, tEnd] (km, earth-centred)
void integrateAtmo(vec3 ro, vec3 rd, float tStart, float tEnd, const int STEPS, out vec3 L, out vec3 T){
  L = vec3(0.0); T = vec3(1.0);
  float cosT = dot(rd, uSunDir);
  float pR = phaseRayleigh(cosT);
  float pM = phaseMie(cosT);
  float segLen = max(tEnd - tStart, 0.0);
  float tPrev = tStart;
  for (int i = 0; i < 24; i++){
    if (i >= STEPS) break;
    // non-uniform sample distribution (denser near start)
    float f1 = (float(i) + 1.0) / float(STEPS);
    float tNew = tStart + segLen * f1 * f1;
    float dt = tNew - tPrev;
    float tm = (tPrev + tNew) * 0.5;
    tPrev = tNew;
    vec3 p = ro + rd * tm;
    float r = length(p);
    vec3 up = p / r;
    float h = r - Rg;
    vec3 d = atmoDensities(h);
    vec3 sR = rayleighScat * d.x;
    vec3 sM = vec3(mieScat * d.y);
    vec3 ext = atmoExtinction(d);
    float muS = dot(up, uSunDir);
    vec3 sunT = sunTransmittance(r, muS);
    vec3 ms = getMultiScat(r, muS);
    vec3 S = uSunIllum * (sunT * (sR * pR + sM * pM) + ms * (sR + sM));
    vec3 stepT = exp(-ext * dt);
    vec3 Sint = (S - S * stepT) / max(ext, vec3(1e-7));
    L += T * Sint;
    T *= stepT;
  }
}

// (steps through the air: fewer on LOW II)
#ifndef SKY_STEPS
#define SKY_STEPS 16
#endif
#ifndef AP_STEPS
#define AP_STEPS 8
#endif

// Full sky radiance for a view ray (camera at roKm, earth centred). Returns rgb + avg transmittance.
vec4 skyRadiance(vec3 roKm, vec3 rd, float maxDist){
  vec2 ta = raySphere(roKm, rd, Rt);
  if (ta.y < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float t0 = max(ta.x, 0.0);
  float t1 = ta.y;
  vec2 tg = raySphere(roKm, rd, Rg);
  if (tg.x > 0.0) t1 = min(t1, tg.x);
  t1 = min(t1, maxDist);
  vec3 L, T;
  integrateAtmo(roKm, rd, t0, t1, SKY_STEPS, L, T);
  return vec4(L, dot(T, vec3(0.3333)));
}

// Aerial perspective between the camera and a surface point (both earth centred, km).
void aerialPerspective(vec3 roKm, vec3 pKm, out vec3 inscatter, out vec3 trans){
  vec3 dv = pKm - roKm;
  float dist = length(dv);
  vec3 rd = dv / max(dist, 1e-6);
  vec2 ta = raySphere(roKm, rd, Rt);
  inscatter = vec3(0.0); trans = vec3(1.0);
  if (ta.y < 0.0) return;
  float t0 = max(ta.x, 0.0);
  float t1 = min(ta.y, dist);
  if (t1 <= t0) return;
  integrateAtmo(roKm, rd, t0, t1, AP_STEPS, inscatter, trans);
}

// Irradiance at a surface point from the sun (with atmospheric transmittance) and sky (approx).
void surfaceLight(vec3 pKm, vec3 n, out vec3 sunIrr, out vec3 skyIrr){
  float r = length(pKm);
  vec3 up = pKm / r;
  float muS = dot(up, uSunDir);
  vec3 sunT = sunTransmittance(r, muS);
  sunIrr = uSunIllum * sunT * max(dot(n, uSunDir), 0.0);
  vec3 ms = getMultiScat(r, muS);
  float day = smoothstep(-0.12, 0.25, muS);
  skyIrr = uSunIllum * (ms * 12.0 + vec3(0.010, 0.020, 0.045) * day) * (0.6 + 0.4 * dot(n, up));
}
#endif
`;

const TRANS_FRAG = ATMO_CONST + /* glsl */`
varying vec2 vUv;
void main(){
  float H = sqrt(Rt * Rt - Rg * Rg);
  float xmu = clamp((vUv.x - 0.5 / 256.0) / (1.0 - 1.0 / 256.0), 0.0, 1.0);
  float xr = clamp((vUv.y - 0.5 / 64.0) / (1.0 - 1.0 / 64.0), 0.0, 1.0);
  float rho = H * xr;
  float r = sqrt(rho * rho + Rg * Rg);
  float dmin = Rt - r;
  float dmax = rho + H;
  float d = dmin + xmu * (dmax - dmin);
  float mu = d == 0.0 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
  mu = clamp(mu, -1.0, 1.0);
  vec3 ro = vec3(0.0, r, 0.0);
  vec3 rd = vec3(0.0, mu, sqrt(max(1.0 - mu * mu, 0.0)));
  float len = distToTop(r, mu);
  vec3 od = vec3(0.0);
  const int N = 60;
  float dt = len / float(N);
  for (int i = 0; i < N; i++){
    vec3 p = ro + rd * (float(i) + 0.5) * dt;
    float h = length(p) - Rg;
    od += atmoExtinction(atmoDensities(h)) * dt;
  }
  gl_FragColor = vec4(exp(-od), 1.0);
}
`;

const MS_FRAG = ATMO_CONST + /* glsl */`
varying vec2 vUv;
uniform sampler2D tTransmittance;
vec3 getT(float r, float mu){ return texture2D(tTransmittance, transmittanceUV(r, mu)).rgb; }
vec3 sunT(float r, float muS){
  float muHor = -sqrt(max(1.0 - (Rg * Rg) / (r * r), 0.0));
  return muS < muHor ? vec3(0.0) : getT(r, muS);
}
void main(){
  float muS = (vUv.x - 0.5 / 32.0) / (31.0 / 32.0) * 2.0 - 1.0;
  float hfrac = clamp((vUv.y - 0.5 / 32.0) / (31.0 / 32.0), 0.0, 1.0);
  float r = Rg + max(hfrac, 0.0002) * (Rt - Rg);
  vec3 ro = vec3(0.0, r, 0.0);
  vec3 sunDir = vec3(0.0, muS, sqrt(max(1.0 - muS * muS, 0.0)));
  const int SQ = 8;
  const float isoPhase = 1.0 / (4.0 * PI_A);
  vec3 Lsum = vec3(0.0);
  vec3 fsum = vec3(0.0);
  for (int a = 0; a < SQ; a++){
    for (int b = 0; b < SQ; b++){
      float u = (float(a) + 0.5) / float(SQ);
      float v = (float(b) + 0.5) / float(SQ);
      float th = 2.0 * PI_A * u;
      float ph = acos(1.0 - 2.0 * v);
      vec3 rd = vec3(cos(th) * sin(ph), cos(ph), sin(th) * sin(ph));
      vec2 tAtm = raySphere(ro, rd, Rt);
      vec2 tG = raySphere(ro, rd, Rg);
      float tMax = tAtm.y;
      bool hitG = tG.x > 0.0;
      if (hitG) tMax = tG.x;
      const int N = 20;
      float dt = tMax / float(N);
      vec3 T = vec3(1.0);
      vec3 L = vec3(0.0);
      vec3 F = vec3(0.0);
      for (int i = 0; i < N; i++){
        vec3 p = ro + rd * (float(i) + 0.5) * dt;
        float rr = length(p);
        vec3 up = p / rr;
        vec3 d = atmoDensities(rr - Rg);
        vec3 sS = rayleighScat * d.x + vec3(mieScat * d.y);
        vec3 ext = atmoExtinction(d);
        vec3 st = exp(-ext * dt);
        vec3 S = sunT(rr, dot(up, sunDir)) * sS * isoPhase;
        L += T * (S - S * st) / max(ext, vec3(1e-7));
        F += T * (sS - sS * st) / max(ext, vec3(1e-7));
        T *= st;
      }
      if (hitG){
        vec3 pg = ro + rd * tMax;
        vec3 n = normalize(pg);
        float nl = max(dot(n, sunDir), 0.0);
        L += T * sunT(Rg, dot(n, sunDir)) * nl * 0.3 / PI_A;
      }
      Lsum += L;
      fsum += F;
    }
  }
  float inv = 1.0 / float(SQ * SQ);
  vec3 L2 = Lsum * inv;
  vec3 fms = fsum * inv;
  vec3 psi = L2 / max(1.0 - fms, vec3(0.05));
  gl_FragColor = vec4(psi, 1.0);
}
`;

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class AtmosphereLUTs {
  constructor(renderer) {
    const opts = {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    };
    this.transmittance = new THREE.WebGLRenderTarget(256, 64, opts);
    this.multiScat = new THREE.WebGLRenderTarget(32, 32, opts);
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    scene.add(quad);
    const prevTarget = renderer.getRenderTarget();
    quad.material = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: TRANS_FRAG, depthTest: false, depthWrite: false });
    renderer.setRenderTarget(this.transmittance);
    renderer.render(scene, cam);
    quad.material.dispose();
    quad.material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: MS_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tTransmittance: { value: this.transmittance.texture } },
    });
    renderer.setRenderTarget(this.multiScat);
    renderer.render(scene, cam);
    quad.material.dispose();
    quad.geometry.dispose();
    renderer.setRenderTarget(prevTarget);
  }
}

// ----- CPU helpers (used for light colour of the ship and gameplay) -----
const RS = [5.802e-3, 13.558e-3, 33.1e-3];
const OZ = [0.650e-3, 1.881e-3, 0.085e-3];
/** Transmittance from point at radius rKm along mu (cosine to local zenith) to space; returns [r,g,b] */
export function cpuTransmittance(rKm, mu, out = [1, 1, 1]) {
  const Rg = 6371.0, Rt = 6471.0;
  if (rKm >= Rt && mu >= 0) { out[0] = out[1] = out[2] = 1; return out; }
  const muHor = -Math.sqrt(Math.max(1 - (Rg * Rg) / (rKm * rKm), 0));
  if (mu < muHor - 0.006) { out[0] = out[1] = out[2] = 0; return out; }
  const vis = Math.min(1, Math.max(0, (mu - (muHor - 0.006)) / 0.012));
  const m = Math.max(mu, muHor);
  // distance to top
  let r = rKm;
  let len;
  if (r > Rt) {
    // above atmosphere looking down/through: segment inside atmosphere
    const b = r * m, c = r * r - Rt * Rt, h = b * b - c;
    if (h < 0 || b > 0) { out[0] = out[1] = out[2] = vis; return out; }
    const sq = Math.sqrt(h);
    const t0 = -b - sq, t1 = -b + sq;
    len = t1 - t0;
    // move origin to entry
    const x = 0, y = r;
    const dx = Math.sqrt(Math.max(0, 1 - m * m)), dy = m;
    const ex = x + dx * t0, ey = y + dy * t0;
    r = Math.hypot(ex, ey);
    return integ(ex, ey, dx, dy, len, vis, out);
  }
  const disc = r * r * (m * m - 1) + Rt * Rt;
  len = Math.max(0, -r * m + Math.sqrt(Math.max(disc, 0)));
  const dx = Math.sqrt(Math.max(0, 1 - m * m)), dy = m;
  return integ(0, r, dx, dy, len, vis, out);

  function integ(x0, y0, dx, dy, L, v, o) {
    const N = 24, dt = L / N;
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < N; i++) {
      const px = x0 + dx * (i + 0.5) * dt, py = y0 + dy * (i + 0.5) * dt;
      const h = Math.hypot(px, py) - Rg;
      const dr = Math.exp(-h / 8), dm = Math.exp(-h / 1.2), dO = Math.max(0, 1 - Math.abs(h - 25) / 15);
      a += (RS[0] * dr + 4.4e-3 * dm + OZ[0] * dO) * dt;
      b += (RS[1] * dr + 4.4e-3 * dm + OZ[1] * dO) * dt;
      c += (RS[2] * dr + 4.4e-3 * dm + OZ[2] * dO) * dt;
    }
    o[0] = Math.exp(-a) * v; o[1] = Math.exp(-b) * v; o[2] = Math.exp(-c) * v;
    return o;
  }
}

// ---- quality: LOW II marches the sky, the haze and the clouds' noise in fewer steps, and the
// ground leaves out its kilometre-scale texture from orbit (a lighter close-range one instead)
const SKY_LOW2 = { SKY_STEPS: 8, AP_STEPS: 3, CLOUD_OCT: 3, TERRAIN_LITE: 1 };
const skyMats = new Set();
let skyLevel = 'high';

/** a material using the sky's shader code: it follows the quality setting */
export function skyMaterial(mat) {
  skyMats.add(mat);
  applySky(mat);
  return mat;
}

function applySky(mat) {
  mat.defines = mat.defines || {};
  for (const [k, v] of Object.entries(SKY_LOW2)) { if (skyLevel === 'low2') mat.defines[k] = v; else delete mat.defines[k]; }
}

export function setSkyQuality(level) {
  if (level === skyLevel) return;
  skyLevel = level;
  for (const m of skyMats) { applySky(m); m.needsUpdate = true; }
}
