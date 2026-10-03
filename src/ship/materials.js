// Ship materials: MeshStandardMaterial with injected procedural detail in ship space
// (grime, wear, panel seams), hull dents (vertex displacement), openings/breaches (discard),
// heat glow, plus glass and emissive helpers.
import * as THREE from 'three';
import { noiseTex } from '../core/noiseTex.js';

export const MAX_DENTS = 24;
export const MAX_OPEN = 16;
export const MAX_BREACH = 10;

// uniforms shared by every ship material (updated by the damage system)
export const shipUniforms = {
  uWorldToShip: { value: new THREE.Matrix4() },
  uDents: { value: Array.from({ length: MAX_DENTS }, () => new THREE.Vector4(0, 0, 0, 0)) },   // xyz centre, w radius
  uDentDir: { value: Array.from({ length: MAX_DENTS }, () => new THREE.Vector4(0, 0, 0, 0)) }, // xyz push dir, w depth
  uOpen: { value: Array.from({ length: MAX_OPEN }, () => new THREE.Matrix4()) },
  uOpenCount: { value: 0 },
  uBreach: { value: Array.from({ length: MAX_BREACH }, () => new THREE.Vector4(0, 0, 0, 0)) }, // xyz, w radius
  uHeat: { value: 0 },
  uHeatDir: { value: new THREE.Vector3(0, 0, -1) },
  uTime: { value: 0 },
  uScorch: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0)) },
  tNoise3D: noiseTex,
  uCanopy: { value: new THREE.Vector4(0, 0, 0, -1e9) },
};

const COMMON_VERT_PARS = /* glsl */`
uniform mat4 uWorldToShip;
uniform vec4 uDents[${MAX_DENTS}];
uniform vec4 uDentDir[${MAX_DENTS}];
varying vec3 vShipPos;
varying vec3 vShipNrm;
#ifdef DENTABLE
vec3 dentOffset(vec3 p, out float dsum){
  vec3 off = vec3(0.0); dsum = 0.0;
  for (int i = 0; i < ${MAX_DENTS}; i++){
    vec4 D = uDents[i];
    if (D.w <= 0.0) continue;
    float d = length(p - D.xyz);
    float f = 1.0 - smoothstep(0.0, D.w, d);
    f = f * f * (3.0 - 2.0 * f);
    // crumple: small ripples near the rim
    float rip = 1.0 + 0.18 * sin(d / max(D.w, 0.01) * 18.0) * f;
    off += uDentDir[i].xyz * uDentDir[i].w * f * rip;
    dsum += f * uDentDir[i].w;
  }
  return off;
}
#endif
`;

const COMMON_FRAG_PARS = /* glsl */`
uniform mat4 uOpen[${MAX_OPEN}];
uniform int uOpenCount;
uniform vec4 uBreach[${MAX_BREACH}];
uniform float uHeat;
uniform vec3 uHeatDir;
uniform float uTime;
uniform vec4 uScorch[8];
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
float breachMask(vec3 p, out float rim){
  rim = 0.0;
  float m = 0.0;
  for (int i = 0; i < ${MAX_BREACH}; i++){
    vec4 B = uBreach[i];
    if (B.w <= 0.0) continue;
    float d = length(p - B.xyz);
    float jag = B.w * (1.0 + 0.45 * sn(p * 1.1 + B.xyz) + 0.2 * sn(p * 3.9));
    if (d < jag) m = 1.0;
    rim = max(rim, 1.0 - smoothstep(jag, jag + 0.12 + B.w * 0.8, d));
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
`;

// shadow-map pass for surfaces with windows / canopy / breaches: the light gets through the holes
const DEPTH_FRAG_PARS = /* glsl */`
uniform mat4 uOpen[${MAX_OPEN}];
uniform int uOpenCount;
uniform vec4 uBreach[${MAX_BREACH}];
uniform vec4 uCanopy;
uniform highp sampler3D tNoise3D;
varying vec3 vShipPos;
float sn(vec3 p){ return texture(tNoise3D, p).g * 2.0 - 1.0; }
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
    if (length(p - B.xyz) < B.w * (1.0 + 0.45 * sn(p * 1.1 + B.xyz) + 0.2 * sn(p * 3.9))) return true;
  }
  return false;
}
`;

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
  const o = Object.assign({ dentable: false, openings: false, wear: 0.3, panels: 0, grime: 0.3, heat: false, triScale: 1, rough: 0.0, edge: 0.0, ao: true }, opts);
  mat.userData.shipPatched = true;
  if (o.openings) mat.userData.depthMat = openingDepthMaterial();
  mat.customProgramCacheKey = () => JSON.stringify(o) + mat.type;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shipUniforms);
    if (o.dentable) sh.defines = Object.assign(sh.defines || {}, { DENTABLE: '' });
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
      .replace('#include <common>', '#include <common>\n' + COMMON_FRAG_PARS)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        ${o.openings ? `
        if (openingMask(vShipPos) > 0.5) discard;
        if (canopyMask(vShipPos) > 0.5) discard;
        float _rim; if (breachMask(vShipPos, _rim) > 0.5) discard;` : 'float _rim = 0.0;'}
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 P = vShipPos * ${o.triScale.toFixed(3)};
          vec3 N = abs(vShipNrm);
          vec4 n1 = nz(P * 0.21);
          vec4 n2 = nz(P * 0.9 + 0.37);
          float g1 = n1.r * 2.0 - 1.0;
          float g2 = n2.b * 2.0 - 1.0;
          float streak = sn(vec3(P.x * 0.25, P.y * 1.8, P.z * 0.25));
          float grime = clamp(0.5 + 0.5 * g1 + 0.25 * streak, 0.0, 1.0);
          diffuseColor.rgb *= mix(1.0, 0.62 + 0.38 * (1.0 - grime), ${o.grime.toFixed(3)});
          diffuseColor.rgb *= 1.0 + 0.06 * g2 * ${o.wear.toFixed(3)};
          ${o.panels > 0 ? `
          // panel seams (grid in ship space), blended across the three projections so curved
          // surfaces do not get jagged seams where the dominant axis flips
          vec3 bw = N * N * N * N; bw /= (bw.x + bw.y + bw.z + 1e-5);
          vec2 pa = panelAt(P.yz, ${o.panels.toFixed(3)}), pb = panelAt(P.xz, ${o.panels.toFixed(3)}), pc = panelAt(P.xy, ${o.panels.toFixed(3)});
          float seam = pa.x * bw.x + pb.x * bw.y + pc.x * bw.z;
          float tint = pa.y * bw.x + pb.y * bw.y + pc.y * bw.z;
          diffuseColor.rgb *= 1.0 - 0.45 * seam;
          diffuseColor.rgb *= 0.93 + 0.1 * tint;` : ''}
          float sc = scorchAt(vShipPos);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.025, 0.02), sc * 0.85);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.045, 0.04), _rim * 0.9);
          // stretched / scraped metal inside dents
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.72 + vec3(0.04), clamp(vDent * 4.0, 0.0, 0.7));
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          vec3 P = vShipPos * ${o.triScale.toFixed(3)};
          float rn = nz(P * 0.43 + 0.7).r * 2.0 - 1.0;
          roughnessFactor = clamp(roughnessFactor + rn * 0.18 * ${o.wear.toFixed(3)} + ${o.rough.toFixed(3)} + vDent * 0.8, 0.04, 1.0);
          float scr = nz(vec3(P.x * 1.3, P.y * 0.1, P.z * 1.3)).b * 2.0 - 1.0;
          roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.55, smoothstep(0.82, 0.95, scr) * ${o.wear.toFixed(3)});
        }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
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
        totalEmissiveRadiance += vec3(1.0, 0.45, 0.12) * _rim * _rim * 0.0;`);
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
  M.hull = patchShipMaterial(std(0xd9dbd7, 0.55, 0.15), { dentable: true, openings: true, wear: 0.8, panels: 1.25, grime: 0.55, heat: true, ao: false });
  M.hullDark = patchShipMaterial(std(0x4a4e55, 0.5, 0.35), { dentable: true, wear: 0.7, panels: 0.8, grime: 0.4, heat: true, ao: false });
  M.hullOrange = patchShipMaterial(std(0xd2691e, 0.5, 0.1), { dentable: true, wear: 0.9, grime: 0.5, heat: true, ao: false });
  M.metal = patchShipMaterial(std(0xa8adb3, 0.32, 0.9), { wear: 0.6, grime: 0.3 });
  M.metalDark = patchShipMaterial(std(0x3a3d42, 0.45, 0.8), { wear: 0.5, grime: 0.3 });
  M.gold = patchShipMaterial(std(0xc8a24a, 0.28, 1.0), { wear: 0.8, grime: 0.15, heat: true });
  M.mli = patchShipMaterial(std(0xd8c27a, 0.42, 0.85), { wear: 0.9, grime: 0.2 }); // insulation blanket foil
  M.radiator = patchShipMaterial(std(0xe6e8ea, 0.35, 0.05, { emissive: new THREE.Color(0.9, 0.18, 0.05), emissiveIntensity: 0.0 }), { wear: 0.5, grime: 0.4, panels: 0.35 });
  M.nozzle = patchShipMaterial(std(0x55504a, 0.4, 0.95, { emissive: new THREE.Color(1.0, 0.35, 0.1), emissiveIntensity: 0.0 }), { wear: 0.9, grime: 0.6, heat: true });
  M.solar = std(0x1a2a55, 0.25, 0.6);
  // ---- interior ----
  M.wall = patchShipMaterial(std(0xbfc3c4, 0.72, 0.05), { dentable: true, openings: true, wear: 0.5, panels: 0.9, grime: 0.35 });
  M.wallPad = patchShipMaterial(std(0x9ea2a6, 0.9, 0.0), { dentable: true, openings: true, wear: 0.3, grime: 0.25, triScale: 2.0 });
  M.panel = patchShipMaterial(std(0xa9adb0, 0.6, 0.15), { wear: 0.6, panels: 0.6, grime: 0.3 });
  M.panelDark = patchShipMaterial(std(0x5a5f66, 0.55, 0.3), { wear: 0.5, grime: 0.25 });
  M.floor = patchShipMaterial(std(0x6d7176, 0.75, 0.4), { wear: 0.9, panels: 0.6, grime: 0.6 });
  M.frame = patchShipMaterial(std(0x8a8f95, 0.4, 0.75), { dentable: true, wear: 0.7, grime: 0.35 });
  M.rubber = std(0x1d1e20, 0.85, 0.0);
  M.handrail = patchShipMaterial(std(0xc9a227, 0.5, 0.2), { wear: 0.8, grime: 0.3 });
  M.fabric = patchShipMaterial(std(0x6e6258, 0.95, 0.0), { wear: 0.4, grime: 0.25, triScale: 3.0 });
  M.fabricBlue = patchShipMaterial(std(0x3e4d63, 0.95, 0.0), { wear: 0.4, grime: 0.2, triScale: 3.0 });
  M.fabricRed = patchShipMaterial(std(0x7a3a34, 0.95, 0.0), { wear: 0.4, grime: 0.2, triScale: 3.0 });
  M.cushion = patchShipMaterial(std(0x8b7d6b, 0.92, 0.0), { wear: 0.3, grime: 0.15 });
  M.suit = patchShipMaterial(std(0xe8eae4, 0.86, 0.0), { wear: 0.35, grime: 0.22, triScale: 3.0 });   // EVA suit outer layer
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
  M.plant = std(0x3e7a2e, 0.7, 0.0);
  M.plant2 = std(0x5c9a3a, 0.7, 0.0);
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
  M.poster1 = new THREE.MeshStandardMaterial({ map: posterTexture(1), roughness: 0.8 });
  M.poster2 = new THREE.MeshStandardMaterial({ map: posterTexture(2), roughness: 0.8 });
  M.poster3 = new THREE.MeshStandardMaterial({ map: posterTexture(3), roughness: 0.8 });
  M.labels = new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.6, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
  return M;
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
