// Tileable 64^3 RGBA noise volume generated once on the GPU.
// R: fbm (periods 4/8/16)  G: perlin period 8  B: perlin period 32  A: cellular F1 period 8
import * as THREE from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';

export const noiseTex = { value: null };

export function createNoiseVolume(renderer, size = 64) {
  const rt = new THREE.WebGL3DRenderTarget(size, size, size, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
  });
  rt.texture.wrapS = rt.texture.wrapT = rt.texture.wrapR = THREE.RepeatWrapping;
  rt.texture.minFilter = THREE.LinearFilter;
  rt.texture.magFilter = THREE.LinearFilter;
  rt.texture.generateMipmaps = false;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uZ: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: NOISE_GLSL + /* glsl */`
      uniform float uZ; varying vec2 vUv;
      float cell(vec3 p, float per){
        vec3 b = floor(p); vec3 f = fract(p); float d1 = 8.0;
        for(int k=-1;k<=1;k++) for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
          vec3 g = vec3(float(i),float(j),float(k));
          vec3 o = hash33(mod(b + g, per));
          vec3 r = g + o - f; d1 = min(d1, dot(r,r));
        }
        return sqrt(d1);
      }
      void main(){
        vec3 p = vec3(vUv, uZ);
        float f = 0.5 * pnoise3(p * 4.0, vec3(4.0)) + 0.25 * pnoise3(p * 8.0, vec3(8.0)) + 0.125 * pnoise3(p * 16.0, vec3(16.0));
        float a = pnoise3(p * 8.0 + 3.7, vec3(8.0));
        float b = pnoise3(p * 32.0 + 1.3, vec3(32.0));
        float c = cell(p * 8.0, 8.0);
        gl_FragColor = vec4(f * 0.75 + 0.5, a * 0.5 + 0.5, b * 0.5 + 0.5, clamp(c, 0.0, 1.0));
      }`,
    depthTest: false, depthWrite: false,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  for (let z = 0; z < size; z++) {
    mat.uniforms.uZ.value = (z + 0.5) / size;
    renderer.setRenderTarget(rt, z);
    renderer.render(scene, cam);
  }
  renderer.setRenderTarget(prev);
  mat.dispose(); quad.geometry.dispose();
  noiseTex.value = rt.texture;
  return rt.texture;
}
