import * as THREE from 'three';
import { NOISE_GLSL } from '../../shaders/noise.glsl.js';
import { ATMO_GLSL } from '../atmosphere.js';
import { TILE_GLSL } from './earthTiles.js';

export const EARTH_COMMON_GLSL = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tData;
uniform vec3 uSunDirEcef;
uniform float uCloudRot;
uniform float uTime;
#define TWO_PI 6.28318530718
vec2 dirToUv(vec3 d){
  float lon = atan(-d.z, d.x);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  return vec2(lon / TWO_PI + 0.5, lat / 3.14159265 + 0.5);
}
// seam-safe gradients for equirect lookups
void seamGrad(vec2 uv, out vec2 gx, out vec2 gy){
  vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
  vec2 ax = dFdx(uv), ay = dFdy(uv);
  vec2 bx = dFdx(uv2), by = dFdy(uv2);
  gx = abs(bx.x) < abs(ax.x) ? bx : ax;
  gy = abs(by.x) < abs(ay.x) ? by : ay;
}
float cloudDensityAt(vec3 dEcef, vec2 gx, vec2 gy){
  // rotate clouds slowly about the polar axis
  float c = cos(uCloudRot), s = sin(uCloudRot);
  vec3 d = vec3(c * dEcef.x + s * dEcef.z, dEcef.y, -s * dEcef.x + c * dEcef.z);
  vec2 uv = dirToUv(d);
  float v = textureGrad(tData, uv, gx, gy).b;
  return smoothstep(0.1, 0.8, v);
}
`;

const VERT = /* glsl */`
attribute vec3 dir;
attribute vec2 hw;
attribute vec3 morph;
uniform vec2 uMorph;
uniform vec3 uDetailOffset;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vDir;
varying vec2 vHW;
varying vec3 vDetail;
varying float vViewDist;
void main(){
  vec4 wp0 = modelMatrix * vec4(position, 1.0);
  float d0 = length(wp0.xyz - cameraPosition);
  float mf = clamp((d0 - uMorph.x) / max(uMorph.y - uMorph.x, 1.0), 0.0, 1.0);
  vec3 pos = position + morph * mf;
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vDir = dir;
  vHW = hw;
  vDetail = pos + uDetailOffset;
  vViewDist = length(wp.xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = NOISE_GLSL + ATMO_GLSL + EARTH_COMMON_GLSL + TILE_GLSL + /* glsl */`
uniform mat3 uEcefToWorld;
uniform float uDetailAmt;
uniform float uDebug;
uniform vec4 uMoonLight;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vDir;
varying vec2 vHW;
varying vec3 vDetail;
varying float vViewDist;

float D_GGX(float NoH, float a){ float a2 = a * a; float d = NoH * NoH * (a2 - 1.0) + 1.0; return a2 / (3.14159265 * d * d); }
float V_SmithGGX(float NoV, float NoL, float a){ float a2 = a * a; float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2); float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2); return 0.5 / max(gv + gl, 1e-5); }

void main(){
  vec3 d = normalize(vDir);
  vec2 uv = dirToUv(d);
  vec2 gx, gy; seamGrad(uv, gx, gy);
  vec4 col = textureGrad(tColor, uv, gx, gy);
  vec4 dat = textureGrad(tData, uv, gx, gy);
  float lightsV = dat.g;
  col = sampleSurface(uv, gx, gy, col, lightsV);
  vec3 albedo = col.rgb;
  float near = smoothstep(9000.0, 1200.0, vViewDist);
  float water = mix(col.a, vHW.y, near);
  water = smoothstep(0.35, 0.65, water);
  vec3 n = normalize(vNormalW);
  vec3 up = normalize(uEcefToWorld * d);
  float hgt = vHW.x;

  // ---- procedural ground detail (close range) ----
  float detailF = smoothstep(60000.0, 4000.0, vViewDist) * uDetailAmt;
  if (detailF > 0.001 && water < 0.99){
    float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
    float n1 = pfbm(vDetail, 1.0 / 2048.0, 4);
    float n2 = pfbm(vDetail, 1.0 / 256.0, 3);
    float n3 = pnoise3(vDetail * (1.0 / 32.0), vec3(256.0));
    // fields / forest patchwork
    float green = clamp((albedo.g - albedo.r) * 18.0 + 0.3, 0.0, 1.0);
    vec3 forest = albedo * vec3(0.55, 0.75, 0.55);
    vec3 field = albedo * vec3(1.25, 1.18, 0.85);
    float patchv = smoothstep(-0.15, 0.25, n1 + n2 * 0.5);
    vec3 veg = mix(forest, field, patchv);
    albedo = mix(albedo, veg, green * 0.6 * detailF);
    albedo *= mix(1.0, 0.78 + 0.44 * (n2 * 0.5 + 0.5) + 0.12 * n3, detailF);
    // rock on steep slopes
    float slope = 1.0 - dot(n, up);
    float rock = smoothstep(0.12, 0.35, slope + n2 * 0.08);
    albedo = mix(albedo, vec3(0.16, 0.145, 0.13) * (0.8 + 0.4 * n3), rock * detailF);
    // snow on high flat ground
    float snowLine = 3800.0 - 2200.0 * abs(d.y);
    float snow = smoothstep(snowLine - 300.0, snowLine + 500.0, hgt + n1 * 400.0) * (1.0 - rock * 0.7);
    albedo = mix(albedo, vec3(0.82, 0.85, 0.9), snow * detailF);
    // micro normal detail
    vec3 e1 = normalize(cross(up, vec3(0.0, 1.0, 0.0001)));
    vec3 e2 = cross(up, e1);
    float hx = pnoise3(vDetail * (1.0 / 64.0), vec3(256.0));
    n = normalize(n + (e1 * (n2 - n1) * 0.25 + e2 * (n3 - hx) * 0.18) * detailF * (0.4 + rock));
  }

  vec3 roKm = cameraPosition * 0.001 - uEarthCenterKm;
  vec3 pKm = vWorld * 0.001 - uEarthCenterKm;
  vec3 sunIrr, skyIrr;
  surfaceLight(pKm, n, sunIrr, skyIrr);
  skyIrr += uMoonLight.w * max(dot(n, uMoonLight.xyz), 0.0) * vec3(0.55, 0.62, 0.8);

  // cloud shadows
  float muS = dot(up, uSunDir);
  vec3 sd = normalize(d + uSunDirEcef * (9.0 / 6371.0) / max(dot(d, uSunDirEcef), 0.15));
  float cs = cloudDensityAt(sd, gx, gy);
  sunIrr *= 1.0 - 0.72 * cs;

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 radiance;
  vec3 landRad = albedo / 3.14159265 * (sunIrr + skyIrr);
  // ---- water ----
  vec3 wn = up;
  float waveF = smoothstep(30000.0, 300.0, vViewDist);
  if (waveF > 0.0){
    vec3 wp = vDetail * (1.0 / 32.0) + vec3(uTime * 0.05, 0.0, uTime * 0.035);
    float w1 = pnoise3(wp, vec3(256.0));
    float w2 = pnoise3(wp * 3.1 + vec3(0.0, uTime * 0.11, 0.0), vec3(256.0));
    vec3 e1 = normalize(cross(up, vec3(0.0, 1.0, 0.0001)));
    vec3 e2 = cross(up, e1);
    wn = normalize(up + (e1 * w1 + e2 * w2) * 0.08 * waveF);
  }
  float rough = mix(0.32, 0.07, smoothstep(400000.0, 5000.0, vViewDist));
  vec3 L = uSunDir;
  vec3 H = normalize(L + V);
  float NoL = max(dot(wn, L), 0.0), NoV = max(dot(wn, V), 1e-3), NoH = max(dot(wn, H), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  vec3 sunT = sunTransmittance(length(pKm), muS) * (1.0 - 0.8 * cs);
  vec3 spec = uSunIllum * sunT * D_GGX(NoH, rough) * V_SmithGGX(NoV, NoL, rough) * F * NoL;
  float day = smoothstep(-0.1, 0.25, muS);
  vec3 skyRefl = uSunIllum * vec3(0.022, 0.045, 0.09) * day * F;
  vec3 waterAlb = albedo * 1.3;
  vec3 waterRad = waterAlb / 3.14159265 * (sunIrr + skyIrr) * (1.0 - F) + spec + skyRefl;
  radiance = mix(landRad, waterRad, water);

  // ---- city lights ----
  float night = 1.0 - smoothstep(-0.12, 0.02, muS);
  float lights = lightsV;
  if (near > 0.0 || detailF > 0.0){
    float sp = pnoise3(vDetail * (1.0 / 64.0), vec3(256.0));
    lights *= mix(1.0, smoothstep(0.0, 0.5, sp) * 2.2, max(near, detailF * 0.7));
  }
  radiance += vec3(1.0, 0.72, 0.38) * lights * lights * 0.9 * night * (1.0 - water * 0.9) * (1.0 - cs * 0.6);

  // ---- aerial perspective ----
  vec3 ins, tr;
  aerialPerspective(roKm, pKm, ins, tr);
  vec3 outc = radiance * tr + ins;
  if (uDebug > 0.5) outc = uDebug < 1.5 ? vec3(dat.g) : (uDebug < 2.5 ? vec3(night) : vec3(lights));
  gl_FragColor = vec4(outc, 1.0);
}
`;

export function createTerrainMaterial(assets, atmo, shared, tiles) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: assets.color },
      tData: { value: assets.data },
      tTransmittance: { value: atmo.transmittance.texture },
      tMultiScat: { value: atmo.multiScat.texture },
      uSunDir: shared.uSunDir,
      uSunDirEcef: shared.uSunDirEcef,
      uEarthCenterKm: shared.uEarthCenterKm,
      uSunIllum: shared.uSunIllum,
      uEcefToWorld: shared.uEcefToWorld,
      uCloudRot: shared.uCloudRot,
      uTime: shared.uTime,
      uDetailAmt: { value: 1.0 },
      uDebug: { value: 0 },
      ...tiles.uniforms,
      uMoonLight: shared.uMoonLight,
      uMorph: { value: new THREE.Vector2(1e9, 2e9) },
      uDetailOffset: { value: new THREE.Vector3() },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
  m.extensions = { derivatives: true };
  return m;
}
