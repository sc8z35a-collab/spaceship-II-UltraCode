// Atmosphere shell: draws in-scattered light where view rays miss the ground (limb glow from
// orbit, blue sky / sunsets from the surface). Premultiplied blend dims what is behind.
import * as THREE from 'three';
import { ATMO_GLSL } from '../atmosphere.js';

const VERT = /* glsl */`
varying vec3 vWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = ATMO_GLSL + /* glsl */`
varying vec3 vWorld;
uniform float uSunAngRad;
void main(){
  vec3 ro = cameraPosition * 0.001 - uEarthCenterKm;
  vec3 rd = normalize(vWorld - cameraPosition);
  vec4 s = skyRadiance(ro, rd, 1e9);
  // sun disc seen through the atmosphere (space sun is drawn separately)
  vec3 col = s.rgb;
  float a = 1.0 - s.a;
  gl_FragColor = vec4(col, a);
}
`;

export function createSkyShell(atmo, shared) {
  const R = 6371000 + 100000 + 1500;
  const geo = new THREE.SphereGeometry(R, 192, 96);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tTransmittance: { value: atmo.transmittance.texture },
      tMultiScat: { value: atmo.multiScat.texture },
      uSunDir: shared.uSunDir,
      uEarthCenterKm: shared.uEarthCenterKm,
      uSunIllum: shared.uSunIllum,
      uSunAngRad: { value: 0.00465 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;
  return mesh;
}
