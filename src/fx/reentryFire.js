// Re-entry fire: the plasma and flames that wrap a ship coming in from orbit. Drawn in the ship's
// own frame, additive, all of it driven by the real heating rate and the real airflow:
//  - the shock layer hugging the hull: white-hot at the stagnation point, yellow and orange round
//    the shoulders, boiling, with tongues of flame peeling off the edges;
//  - a hot core streaming back from the hull;
//  - a long turbulent wake of fire behind the ship (tens to hundreds of metres), fading through
//    orange and red into the dim violet of the ionised trail.
// From inside the cabin the shock layer glows through the windows.
import * as THREE from 'three';
import { LAYER_NEAR, LAYER_MID, setLayersDeep } from '../core/layers.js';
import { QUALITY } from '../core/quality.js';

const lowQ = () => QUALITY.level === 'low' || QUALITY.level === 'low2';

const NOISE = /* glsl */`
float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < OCT; i++) { s += a * n3(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / (1.0 - pow(0.5, float(OCT))); }
// 0 .. 1.4: dark red, red, orange, yellow, white
vec3 fire(float x){
  x = clamp(x, 0.0, 1.4);
  vec3 c = mix(vec3(0.35, 0.02, 0.01), vec3(1.0, 0.16, 0.03), smoothstep(0.0, 0.35, x));
  c = mix(c, vec3(1.0, 0.5, 0.08), smoothstep(0.3, 0.65, x));
  c = mix(c, vec3(1.0, 0.84, 0.42), smoothstep(0.6, 0.95, x));
  return mix(c, vec3(1.0, 0.97, 0.9), smoothstep(0.95, 1.35, x));
}`;

const SHELL_VERT = /* glsl */`
varying vec3 vP; varying vec3 vN; varying vec3 vW; varying vec3 vNw;
void main(){
  vP = position; vN = normal;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vNw = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SHELL_FRAG = /* glsl */`
uniform float uT; uniform float uI; uniform vec3 uFlow;
varying vec3 vP; varying vec3 vN; varying vec3 vW; varying vec3 vNw;
${NOISE}
void main(){
  vec3 N = normalize(vN);
  float facing = dot(N, -uFlow);                         // 1 where the air comes on
  vec3 V = normalize(cameraPosition - vW);
  float ndv = abs(dot(V, normalize(vNw)));
  // boiling, carried downstream
  vec3 q = vP * 2.4 - uFlow * uT * 3.2;
  float n = fbm(q * 1.6 + vec3(0.0, uT * 0.8, 0.0));
  float nf = fbm(q * 4.2 - uFlow * uT * 6.0);
  float stag = pow(max(facing, 0.0), 3.0);
  float front = smoothstep(-0.3, 0.9, facing);
  // tongues of flame peel off the shoulders and run back along the sides
  float side = smoothstep(0.8, 0.0, abs(facing)) * smoothstep(0.42, 0.82, nf);
  float back = smoothstep(0.1, -0.7, facing) * smoothstep(0.5, 0.85, nf) * 0.55;
  float heat = uI * (front * (0.35 + 0.85 * n) + 1.1 * stag + side * 1.0 + back);
  // a glowing layer of gas: denser where the line of sight grazes it, but soft at its very edge
  // (no hard bubble outline)
  float shell = mix(0.45, 1.0, 1.0 - ndv) * smoothstep(0.0, 0.35, ndv);
  float k = min(heat, 1.6);
  vec3 c = fire(k) * pow(k, 1.2) * shell * 1.05;
  gl_FragColor = vec4(c, 1.0);
}`;

const WAKE_VERT = /* glsl */`
uniform float uT; uniform float uI; uniform float uL; uniform float uR0; uniform float uR1;
varying float vZ; varying vec3 vW; varying vec3 vNw; varying vec2 vXY;
${NOISE}
void main(){
  // a unit tube along +z (0..1) widened and lengthened with the heating, wavering
  float z = position.z;
  vec2 dir = normalize(position.xy + 1e-5);
  float r = mix(uR0, uR1, pow(z, 0.55));
  float wob = (fbm(vec3(dir * 1.3, z * 5.0 - uT * 2.2)) - 0.5) * r * 0.55 * (0.3 + z);
  vec2 sway = vec2(sin(z * 9.0 - uT * 4.1), cos(z * 7.0 - uT * 3.3)) * r * 0.18 * z;
  vec3 p = vec3(dir * (r + wob) + sway, z * uL);
  vZ = z; vXY = dir * r;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vNw = normalize(mat3(modelMatrix) * vec3(dir, 0.0));
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const WAKE_FRAG = /* glsl */`
uniform float uT; uniform float uI; uniform float uL; uniform float uHot;
varying float vZ; varying vec3 vW; varying vec3 vNw; varying vec2 vXY;
${NOISE}
void main(){
  vec3 V = normalize(cameraPosition - vW);
  float ndv = abs(dot(V, normalize(vNw)));
  float body = pow(ndv, 0.9);                            // thick seen face-on, thin at its edges
  float z = vZ;
  vec3 q = vec3(vXY * 0.16, z * uL * 0.03 - uT * 2.6);
  float n = fbm(q + vec3(0.0, 0.0, uT * 0.35));
  // tongues of flame: broken up, more so downstream
  float n2 = fbm(q * vec3(2.3, 2.3, 1.4) - vec3(0.0, 0.0, uT * 1.7));
  float tongues = smoothstep(0.34, 0.7, n * 0.65 + n2 * 0.45 + 0.28 * (1.0 - z) * uHot - 0.12 * z);
  float fade = pow(1.0 - z, 1.25) * smoothstep(0.0, 0.05, z);
  float heat = uI * tongues * fade * (1.15 + uHot * 0.35 - 0.8 * z);
  vec3 c = fire(heat * (0.85 + 0.45 * uHot)) * heat * body * (0.75 + 0.55 * uHot);
  // far behind: the ionised trail, dim red and violet
  c += vec3(0.24, 0.035, 0.12) * uI * smoothstep(0.25, 0.85, z) * (1.0 - z) * body * n * (1.0 - uHot) * 0.8;
  gl_FragColor = vec4(c, 1.0);
}`;

/**
 * One ship's fire. opts: { center (ship-local), shell: Vector3 radii, r0, r1 (wake radius at the
 * hull and at its end), len (wake length at full heat, m) }
 */
export class ReentryFire {
  constructor(parent, opts) {
    this.o = opts;
    const defines = { OCT: lowQ() ? 2 : 4 };
    this.uniforms = { uT: { value: 0 }, uI: { value: 0 }, uFlow: { value: new THREE.Vector3(0, 0, 1) } };
    const common = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, defines };
    this.group = new THREE.Group();
    this.group.name = 'reentryFire';
    this.group.position.copy(opts.center);
    // the shock layer
    const shellMat = new THREE.ShaderMaterial(Object.assign({ uniforms: this.uniforms, vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, side: THREE.DoubleSide }, common));
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, lowQ() ? 32 : 56, lowQ() ? 16 : 28), shellMat);
    this.shell.scale.copy(opts.shell);
    this.shell.frustumCulled = false;
    this.group.add(this.shell);
    // the wake: a hot core and the long outer fire, both along the flow
    this.wakeAxis = new THREE.Group();
    this.group.add(this.wakeAxis);
    const tube = new THREE.CylinderGeometry(1, 1, 1, lowQ() ? 20 : 36, lowQ() ? 16 : 40, true);
    tube.rotateX(Math.PI / 2);
    tube.translate(0, 0, 0.5);
    this.wakes = [];
    for (const [hot, k] of [[1, 0.45], [0, 1]]) {
      const u = { uT: this.uniforms.uT, uI: { value: 0 }, uL: { value: 1 }, uR0: { value: opts.r0 * (hot ? 0.7 : 1) }, uR1: { value: opts.r1 * (hot ? 0.45 : 1) }, uHot: { value: hot } };
      const mat = new THREE.ShaderMaterial(Object.assign({ uniforms: u, vertexShader: WAKE_VERT, fragmentShader: WAKE_FRAG, side: THREE.DoubleSide }, common));
      const m = new THREE.Mesh(tube, mat);
      m.frustumCulled = false;
      m.renderOrder = hot ? 3 : 2;
      this.wakeAxis.add(m);
      this.wakes.push({ m, u, k });
    }
    this.group.visible = false;
    setLayersDeep(this.group, LAYER_NEAR, LAYER_MID);
    parent.add(this.group);
    this.level = 0;
  }

  /**
   * level 0..1 (from the heating), flowLocal: the direction the air streams past the ship
   * (ship-local, unit: opposite to the ship's motion through the air)
   */
  update(dt, level, flowLocal) {
    this.level += (level - this.level) * Math.min(1, dt * 2.5);
    const L = this.level;
    this.group.visible = L > 0.01;
    if (!this.group.visible) return;
    const U = this.uniforms;
    U.uT.value = (U.uT.value + dt) % 1000;
    U.uI.value = Math.min(1.25, L * (0.9 + 0.12 * Math.sin(U.uT.value * 31) + 0.08 * Math.sin(U.uT.value * 13.7)));
    U.uFlow.value.copy(flowLocal);
    // the wake trails along the flow, longer the hotter it burns
    this.wakeAxis.quaternion.setFromUnitVectors(_Z, flowLocal);
    for (const w of this.wakes) {
      w.u.uI.value = U.uI.value;
      w.u.uL.value = this.o.len * w.k * (0.3 + 0.7 * L);
    }
  }

  dispose() {
    this.group.parent && this.group.parent.remove(this.group);
  }
}

const _Z = new THREE.Vector3(0, 0, 1);

/** heating rate (W/m^2) to fire level 0..1: a glow from ~15 kW/m^2, full fire past ~350 kW/m^2 */
export function fireLevel(q) {
  const x = Math.max(0, Math.min(1, (q - 1.5e4) / 3.35e5));
  return x * x * (3 - 2 * x);
}
