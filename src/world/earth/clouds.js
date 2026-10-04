// Cloud layer: proxy sphere with exact per-pixel ray/sphere intersection (no tessellation sag),
// lit with atmospheric transmittance, procedural detail close up, lightning on the night side.
import * as THREE from 'three';
import { NOISE_GLSL } from '../../shaders/noise.glsl.js';
import { ATMO_GLSL } from '../atmosphere.js';
import { EARTH_COMMON_GLSL } from './terrainMaterial.js';

export const CLOUD_ALT = 9000;

const VERT = /* glsl */`
varying vec3 vWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = NOISE_GLSL + ATMO_GLSL + EARTH_COMMON_GLSL + /* glsl */`
uniform mat3 uWorldToEcef;
uniform float uCloudR;     // km
uniform float uFlash;
uniform vec3 uFlashDir;    // ecef unit
uniform vec3 uDetailOriginKm; // ecef km (snapped)
uniform vec4 uMoonLight; // xyz world dir, w intensity
varying vec3 vWorld;
void main(){
  vec3 ro = cameraPosition * 0.001 - uEarthCenterKm;
  vec3 rd = normalize(vWorld - cameraPosition);
  vec2 tc = raySphere(ro, rd, uCloudR);
  if (tc.y < 0.0) discard;
  float rc = length(ro);
  float t = rc > uCloudR ? tc.x : tc.y;
  if (t < 0.0) discard;
  // planet occludes?
  vec2 tg = raySphere(ro, rd, Rg);
  if (tg.x > 0.0 && tg.x < t) discard;
  vec3 pKm = ro + rd * t;
  vec3 up = normalize(pKm);
  vec3 dE = normalize(uWorldToEcef * up);
  vec2 uv = dirToUv(dE);
  vec2 gx, gy; seamGrad(uv, gx, gy);
  // derivative-based gradient breaks on analytic hits far away; clamp lod by distance instead
  float dens = cloudDensityAt(dE, gx, gy);
  float distKm = t;
  // procedural structure, band-limited by the pixel footprint (km)
  float fp = distKm * 0.0016 + 0.02;
  vec3 q = dE * uCloudR;
  float n = 0.0, wsum = 0.0, lam = 64.0, amp = 1.0;
  for (int i = 0; i < 6; i++){
    float w = smoothstep(fp * 2.0, fp * 5.0, lam) * amp;
    n += w * pnoise3(q / lam + vec3(uTime * 0.0006 * float(i), 0.0, 0.0), vec3(256.0));
    wsum += amp;
    lam *= 0.38; amp *= 0.62;
  }
  n = n / wsum; // ~[-0.5,0.5]
  float cov = dens;
  float d2 = clamp((cov * 1.2 - 0.24 + n * 1.0) / 0.6, 0.0, 1.0);
  dens = mix(cov, d2 * d2 * (3.0 - 2.0 * d2), 0.85);
  if (dens < 0.01) discard;
  float muS = dot(up, uSunDir);
  vec3 sunT = sunTransmittance(uCloudR, muS);
  float below = rc < uCloudR ? 1.0 : 0.0;
  // fake relief: compare coverage a little toward the sun -> lit / shadowed flanks
  vec3 sunTan = normalize(uSunDirEcef - dE * dot(uSunDirEcef, dE));
  float dSun = cloudDensityAt(normalize(dE + sunTan * (6.0 / 6371.0)), gx, gy);
  float relief = clamp(0.75 + (dens - dSun) * 1.6, 0.35, 1.25);
  float lowSun = 1.0 - smoothstep(0.0, 0.5, muS);
  relief = mix(1.0, relief, 0.35 + 0.65 * lowSun);
  float thick = dens;
  float lit = mix(relief, 0.22 + 0.45 * (1.0 - thick), below);
  float phase = 0.65 + 0.7 * pow(max(dot(rd, uSunDir), 0.0), 8.0);
  vec3 ms = getMultiScat(uCloudR, muS);
  vec3 col = uSunIllum * (sunT * max(muS + 0.1, 0.0) / 1.1 * (0.8 / 3.14159) * 1.25 * lit * phase + ms * 3.0 * (0.6 + 0.4 * dens));
  col += uMoonLight.w * max(dot(up, uMoonLight.xyz), 0.0) * vec3(0.55, 0.62, 0.8) * dens;
  // lightning
  float fl = uFlash * smoothstep(0.99997, 0.999998, dot(dE, uFlashDir)) * dens;
  col += vec3(0.7, 0.75, 1.0) * fl * 2.5;
  // aerial perspective between camera and cloud
  vec3 ins, tr;
  aerialPerspective(ro, pKm, ins, tr);
  vec3 outc = col * tr + ins * dens;
  float a = clamp(pow(dens, 1.05) * 0.94, 0.0, 1.0);
  gl_FragColor = vec4(outc * a, a);
}
`;

export function createClouds(assets, atmo, shared) {
  const R = (6371000 + CLOUD_ALT) / 1000;
  const geo = new THREE.SphereGeometry(R * 1000 + 2500, 256, 128);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: assets.color },
      tData: { value: assets.data },
      tTransmittance: { value: atmo.transmittance.texture },
      tMultiScat: { value: atmo.multiScat.texture },
      uSunDir: shared.uSunDir,
      uSunDirEcef: shared.uSunDirEcef,
      uEarthCenterKm: shared.uEarthCenterKm,
      uSunIllum: shared.uSunIllum,
      uCloudRot: shared.uCloudRot,
      uTime: shared.uTime,
      uWorldToEcef: shared.uWorldToEcef,
      uCloudR: { value: R },
      uFlash: { value: 0 },
      uFlashDir: { value: new THREE.Vector3(1, 0, 0) },
      uDetailOriginKm: { value: new THREE.Vector3() },
      uMoonLight: shared.uMoonLight,
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  return mesh;
}
