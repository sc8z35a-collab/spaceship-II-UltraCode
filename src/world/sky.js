// Background sky: real stars (HYG catalogue, positions/magnitudes/colours) as points and a
// procedural Milky Way computed in galactic coordinates, plus the Sun disc/corona.
import * as THREE from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { LAYER_FAR, setLayers } from '../core/layers.js';
import { assetUrl } from './earth/earthAssets.js';

const SKY_R = 1.2e9;

function bvToRgb(bv) {
  // approximate blackbody colour from B-V index (Ballesteros temperature)
  bv = Math.max(-0.4, Math.min(2.0, bv));
  const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  // Tanner Helland blackbody approx
  const t = T / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
  const c = (v) => Math.max(0, Math.min(255, v)) / 255;
  return [c(r), c(g), c(b)];
}

export async function createStars() {
  // catalogue: little-endian float32 x 5 per star (x, y, z, mag, B-V), base64 in JSON
  const res = await fetch(assetUrl('sky/stars.json'));
  const bin = atob((await res.json()).data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const f = new Float32Array(bytes.buffer);
  const n = f.length / 5;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const mag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = f[i * 5] * SKY_R; pos[i * 3 + 1] = f[i * 5 + 1] * SKY_R; pos[i * 3 + 2] = f[i * 5 + 2] * SKY_R;
    const c = bvToRgb(f[i * 5 + 4]);
    // gentle saturation boost so colours read on screen
    const l = (c[0] + c[1] + c[2]) / 3;
    col[i * 3] = l + (c[0] - l) * 1.35; col[i * 3 + 1] = l + (c[1] - l) * 1.35; col[i * 3 + 2] = l + (c[2] - l) * 1.35;
    mag[i] = f[i * 5 + 3];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uPixelScale: { value: 1.0 },
      uBright: { value: 1.0 },
      uTwinkle: { value: 0.0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      attribute float mag;
      attribute vec3 color;
      uniform float uPixelScale;
      uniform float uBright;
      uniform float uTwinkle;
      uniform float uTime;
      varying vec3 vCol;
      varying float vFlux;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w * 0.99999;
        float flux = pow(10.0, -0.4 * (mag - 1.0));
        float tw = 1.0 + uTwinkle * 0.45 * sin(uTime * (7.0 + fract(position.x * 0.0001) * 9.0) + position.y);
        flux *= tw;
        float size = clamp(1.6 + 2.2 * sqrt(flux), 1.6, 9.0) * uPixelScale;
        gl_PointSize = size;
        vFlux = flux * uBright * 3.2 / (size * size * 0.35);
        vCol = color;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol;
      varying float vFlux;
      void main(){
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        float g = exp(-r2 * 4.5);
        if (g < 0.004) discard;
        gl_FragColor = vec4(vCol * vFlux * g, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = -90;
  setLayers(pts, LAYER_FAR);
  return pts;
}

export function createMilkyWay() {
  const geo = new THREE.SphereGeometry(SKY_R * 1.05, 96, 48);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uBright: { value: 1.0 } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        p.z = p.w * 0.99999;
        gl_Position = p;
      }`,
    fragmentShader: NOISE_GLSL + /* glsl */`
      uniform float uBright;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        // engine frame -> J2000 equatorial
        vec3 e = vec3(d.x, -d.z, d.y);
        mat3 M = mat3(
          -0.0548755604, 0.4941094279, -0.8676661490,
          -0.8734370902, -0.4448296300, -0.1980763734,
          -0.4838350155, 0.7469822445, 0.4559837762);
        vec3 g = M * e;
        float l = atan(g.y, g.x);
        float b = asin(clamp(g.z, -1.0, 1.0));
        float lc = cos(l);
        // structure noise in galactic frame
        float n1 = fbm5(g * 3.0);
        float n2 = fbm4(g * 9.0 + 4.0);
        float n3 = snoise(g * 26.0);
        float width = 0.12 + 0.06 * (0.5 + 0.5 * lc) + 0.03 * n1;
        float disk = exp(-abs(b) / width) * (0.55 + 0.45 * (0.5 + 0.5 * lc));
        float bulge = exp(-(l * l * 0.9 + b * b * 2.2) / 0.06);
        float clump = 0.55 + 0.45 * smoothstep(-0.4, 0.6, n1 + 0.5 * n2) + 0.2 * n3;
        float dust = smoothstep(0.08, 0.0, abs(b + 0.015 * n2 - 0.01)) * smoothstep(-0.25, 0.35, n2 + 0.4 * n1) * (0.5 + 0.5 * lc);
        float glow = (disk * clump + bulge * 1.6) * (1.0 - 0.85 * dust);
        vec3 warm = vec3(1.0, 0.82, 0.62);
        vec3 cool = vec3(0.72, 0.82, 1.0);
        vec3 col = mix(cool, warm, clamp(bulge * 2.0 + 0.25 * lc, 0.0, 1.0)) * glow;
        // faint nebular tint along the plane
        col += vec3(0.9, 0.35, 0.45) * smoothstep(0.55, 0.9, n2) * disk * 0.12;
        // unresolved star dust
        vec3 q = d * 900.0;
        float sd = pow(hash13(floor(q)), 60.0) * 0.6 + pow(hash13(floor(q * 2.3)), 90.0) * 0.4;
        col += vec3(sd) * (0.25 + disk * 1.5);
        gl_FragColor = vec4(col * 0.016 * uBright, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  setLayers(mesh, LAYER_FAR);
  return mesh;
}

export function createSun() {
  // HDR disc + corona glow billboard (always faces camera)
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uIntensity: { value: 1 }, uAng: { value: 0.00465 } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){
        vUv = uv * 2.0 - 1.0;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        mv.xy += position.xy * s;
        vec4 p = projectionMatrix * mv;
        p.z = p.w * 0.99998;
        gl_Position = p;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;
      void main(){
        float r = length(vUv); // 1.0 == quad edge (quad = 40 sun radii)
        float rs = r * 40.0;   // in sun radii
        float disc = smoothstep(1.02, 0.96, rs);
        float limb = mix(0.55, 1.0, sqrt(max(0.0, 1.0 - min(rs, 1.0) * min(rs, 1.0))));
        float corona = 0.06 * exp(-(rs - 1.0) * 0.9) + 0.012 * exp(-(rs - 1.0) * 0.18);
        float a = smoothstep(1.0, 0.7, r);
        vec3 c = uColor * (disc * limb * 600.0 + corona * (1.0 - disc) * 8.0) * a * uIntensity;
        gl_FragColor = vec4(c, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -80;
  setLayers(mesh, LAYER_FAR);
  return mesh;
}
