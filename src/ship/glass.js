// Window glass: Fresnel reflections of an environment cube, smudges, condensation,
// procedural impact cracks (spider-web) per window, heat glow during re-entry.
import * as THREE from 'three';
import { noiseTex } from '../core/noiseTex.js';

export const MAX_WIN = 16;
const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
blackTex.needsUpdate = true;
export const glassUniforms = {
  uWinDmg: { value: Array.from({ length: MAX_WIN }, () => new THREE.Vector4(0, 0, 0, 0)) }, // u,v,severity,seed
  uWinTile: { value: Array.from({ length: MAX_WIN }, () => new THREE.Vector4(0, 0, 0, 1)) }, // crack atlas rect + pane half size
  tCracks: { value: blackTex },
  uWinGone: { value: Array.from({ length: MAX_WIN }, () => 0) },
  uFrost: { value: 0 },
  uHeatGlass: { value: 0 },
  uTimeG: { value: 0 },
  uHollow: { value: 0 },   // 1: the cabin behind is not drawn (seen from well outside): dark panes
};

const VERT = /* glsl */`
attribute float winId;
attribute vec2 wuv;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUvW;
varying float vWin;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vUvW = wuv;
  vWin = winId;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */`
uniform samplerCube envMap;
uniform float uEnvIntensity;
uniform highp sampler3D tNoise3D;
uniform vec4 uWinDmg[${MAX_WIN}];
uniform vec4 uWinTile[${MAX_WIN}];
uniform sampler2D tCracks;
uniform float uWinGone[${MAX_WIN}];
uniform float uFrost;
uniform float uHeatGlass;
uniform float uTimeG;
uniform float uInner;
uniform float uHollow;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUvW;
varying float vWin;

float crackField(vec2 q, vec4 D){
  // spider web: radial cracks + concentric arcs, density grows with severity
  vec2 d = q - D.xy;
  float r = length(d);
  float a = atan(d.y, d.x);
  float sev = D.z;
  float n = texture(tNoise3D, vec3(q * 2.3, D.w)).g;
  float spokes = 7.0 + floor(sev * 10.0);
  float sa = abs(fract((a + n * 0.35) / 6.2831853 * spokes + D.w * 3.1) - 0.5);
  float radial = smoothstep(0.012 + 0.006 * sev, 0.0, sa * r * 2.0) * smoothstep(0.08 + sev * 0.9, 0.0, r - 0.02);
  float rings = 0.0;
  for (int i = 1; i < 5; i++){
    float rr = float(i) * (0.035 + 0.02 * n) * (0.6 + sev);
    float w = smoothstep(0.004, 0.0, abs(r - rr - n * 0.01));
    rings += w * step(float(i), sev * 4.0 + 1.0) * step(0.35, fract(a * 1.7 + float(i) * 0.37 + n));
  }
  float shatter = smoothstep(0.6, 1.0, sev) * smoothstep(0.03, 0.0, abs(texture(tNoise3D, vec3(q * 3.0, D.w + 0.5)).a - 0.12));
  return clamp(radial + rings * 0.8 + shatter, 0.0, 1.0);
}

void main(){
  int wi = int(vWin + 0.5);
  float gone = 0.0;
  vec4 D = vec4(0.0);
  vec4 T = vec4(0.0);
  for (int i = 0; i < ${MAX_WIN}; i++){ if (i == wi){ gone = uWinGone[i]; D = uWinDmg[i]; T = uWinTile[i]; } }
  // the pane's fracture network (atlas): R crack lines, G milky halo, B glass gone
  vec3 ck = vec3(0.0);
  if (D.z > 0.0 && T.z > 0.0) {
    ck = texture2D(tCracks, T.xy + T.z * clamp(0.5 + vUvW / (2.0 * T.w), 0.002, 0.998)).rgb;
    if (ck.b > 0.5) discard;              // the middle of a broken pane is gone, shards remain
  } else if (gone > 0.5) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vN);
  // outer pane reflects space only from outside, inner pane reflects the cabin only from inside
  float facing = dot(N, V);
  float sideOK = uInner > 0.5 ? step(facing, 0.0) : step(0.0, facing);
  if (facing < 0.0) N = -N;
  float NoV = max(dot(N, V), 0.0);
  float F = 0.04 + 0.96 * pow(1.0 - NoV, 5.0);
  vec4 nz = texture(tNoise3D, vec3(vUvW * 1.7, vWin * 0.13));
  float smudge = smoothstep(0.55, 0.9, nz.r) * 0.6 + smoothstep(0.7, 0.95, texture(tNoise3D, vec3(vUvW * 6.0, 0.3 + vWin * 0.07)).b) * 0.4;
  vec3 R = reflect(-V, N);
  R += (nz.gba - 0.5) * 0.01;
  // fractured glass bends what it reflects: facets around the cracks tilt the reflection
  R += vec3(dFdx(ck.r + ck.g), dFdy(ck.r + ck.g), 0.0) * 1.2;
  vec3 env = textureLod(envMap, R, 1.5).rgb * uEnvIntensity * sideOK;
  vec3 col = env * F * (1.0 - smudge * 0.3);
  float alpha = F * mix(0.1, 0.85, sideOK) + smudge * 0.05;
  // smudges catch light
  col += env * smudge * 0.05;
  // condensation / frost (cold, depressurising)
  if (uFrost > 0.0 && uInner > 0.5){
    float fr = smoothstep(1.0 - uFrost, 1.0, texture(tNoise3D, vec3(vUvW * 4.0, 0.7)).r + min(length(vUvW), 1.0) * 0.4) * clamp(uFrost * 3.0, 0.0, 1.0);
    col += vec3(0.6, 0.65, 0.7) * fr * 0.08;
    alpha = max(alpha, fr * 0.65);
  }
  // cracks: the fracture faces scatter light (bright lines), the glass round them goes milky
  if (D.z > 0.0){
    float c = T.z > 0.0 ? smoothstep(0.2, 0.7, ck.r) : crackField(vUvW, D);
    float halo = ck.g;
    col += vec3(0.92, 0.96, 1.0) * c * (0.3 + 0.55 * F) + env * c * 0.55 + vec3(0.7, 0.75, 0.8) * halo * 0.16;
    alpha = max(alpha, max(c * 0.9, halo * 0.35));
    // milky laminated layer when heavily damaged
    float milk = smoothstep(0.7, 1.4, D.z) * 0.35 * (0.5 + 0.5 * texture(tNoise3D, vec3(vUvW * 2.0, D.w)).r);
    col += vec3(0.5) * milk * 0.08;
    alpha = max(alpha, milk);
  }
  // re-entry glow on the outer pane
  if (uHeatGlass > 0.0 && uInner < 0.5){
    col += vec3(1.0, 0.45, 0.12) * uHeatGlass * 2.0 * (0.6 + 0.4 * texture(tNoise3D, vec3(vUvW * 3.0, uTimeG * 0.3)).g);
    alpha = max(alpha, uHeatGlass * 0.4);
  }
  // the cabin is not drawn from far outside: the pane shows a dim, faintly lit inside instead of
  // whatever lies behind the ship
  if (uHollow > 0.0 && uInner < 0.5 && sideOK > 0.5){
    col += vec3(0.010, 0.011, 0.013) * (1.0 - F);
    alpha = mix(alpha, 0.93, uHollow);
  }
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

export function createGlassMaterial(envMap, inner) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({
      envMap: { value: envMap },
      uEnvIntensity: { value: 1.0 },
      tNoise3D: noiseTex,
      uInner: { value: inner ? 1 : 0 },
    }, glassUniforms),
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}
