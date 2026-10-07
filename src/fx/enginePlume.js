// Engine plumes for every vessel: the exhaust is a glowing volume, ray-marched through in the
// fragment shader (a cone frustum round each nozzle is all that is drawn):
//  - a white-hot core straight out of the nozzle, pinched and swollen by its shock cells, with the
//    bright knots of the Mach disks at the pinches;
//  - the flame round it: in vacuum it spreads into a wide, thinning cone, in air it stays narrow
//    and long with hard shock diamonds; its edge torn into tongues by turbulence that streams aft;
//  - colour running from the core through the flame to a dim tail (per engine type);
//  - a flash as the engine lights, flicker while it burns, a sputter as it dies away.
// Several nozzles pointing the same way share one draw.
import * as THREE from 'three';
import { noiseTex } from '../core/noiseTex.js';
import { QUALITY } from '../core/quality.js';
import { LAYER_NEAR, LAYER_MID, assignLayers } from '../core/layers.js';

const STYLES = {
  // B-29's fusion drive: a blinding white-blue core, blue flame spreading into violet
  fusion: { core: [1.0, 0.9, 0.82], hot: [0.55, 0.72, 1.0], mant: [0.26, 0.42, 1.0], tail: [0.42, 0.2, 0.95] },
  // H8's magnetic nozzle: plasma, violet-blue
  plasma: { core: [0.92, 0.88, 1.0], hot: [0.62, 0.58, 1.0], mant: [0.34, 0.36, 1.0], tail: [0.5, 0.16, 0.9] },
  // chemical thrusters: white-yellow core, orange flame, red tail
  chem: { core: [1.0, 0.9, 0.72], hot: [1.0, 0.62, 0.24], mant: [1.0, 0.38, 0.1], tail: [0.62, 0.12, 0.04] },
  // the stations' craft (methalox): a blue core, pale blue flame
  blue: { core: [0.85, 0.92, 1.0], hot: [0.42, 0.66, 1.0], mant: [0.3, 0.52, 1.0], tail: [0.22, 0.3, 0.8] },
  // solid rocket motor (missiles): white-hot, orange, a smoky red tail
  solid: { core: [1.0, 0.95, 0.85], hot: [1.0, 0.72, 0.36], mant: [1.0, 0.48, 0.16], tail: [0.55, 0.22, 0.1] },
};
// pushed past its rating (ULTRA / MAX): whiter core, the flame towards violet
const BOOST = { core: [1.0, 1.0, 1.0], hot: [0.75, 0.7, 1.0], mant: [0.5, 0.36, 1.0], tail: [0.6, 0.2, 1.0] };

const steps = () => (QUALITY.level === 'low2' ? 5 : QUALITY.level === 'low' ? 8 : 14);

const VERT = /* glsl */`
attribute vec3 aExit;
uniform float uA; uniform float uB; uniform float uH;
varying vec3 vO; varying vec3 vD;
void main(){
  // the bounding frustum round this nozzle (unit model: z 0..1, radius 1 outside the polygon)
  vec3 q = vec3(position.xy * (uA + uB * position.z * uH), position.z * uH);
  vec4 w = modelMatrix * vec4(q + aExit, 1.0);
  gl_Position = projectionMatrix * viewMatrix * w;
  // the view ray in the nozzle's own frame
  vec3 c = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - aExit;
  vO = c; vD = q - c;
}`;

const FRAG = /* glsl */`
uniform float uA; uniform float uB; uniform float uH;
uniform float uCa; uniform float uCb; uniform float uHc; uniform float uCoreL;
uniform float uR0; uniform float uL; uniform float uTan; uniform float uLam; uniform float uDia;
uniform float uI; uniform float uPh; uniform float uNf; uniform vec3 uSeed;
uniform vec3 uCore; uniform vec3 uHot; uniform vec3 uMant; uniform vec3 uTail;
uniform highp sampler3D tNoise3D;
varying vec3 vO; varying vec3 vD;

// where the ray runs inside the frustum z 0..H, radius a + b z
vec2 span(vec3 o, vec3 d, float a, float b, float H){
  float t0 = -1e6, t1 = 1e6;
  if (abs(d.z) > 1e-6) { float ta = -o.z / d.z, tb = (H - o.z) / d.z; t0 = min(ta, tb); t1 = max(ta, tb); }
  else if (o.z < 0.0 || o.z > H) return vec2(1.0, 0.0);
  float k = a + b * o.z, kd = b * d.z;
  float A = dot(d.xy, d.xy) - kd * kd;
  float B = 2.0 * (dot(o.xy, d.xy) - k * kd);
  float C = dot(o.xy, o.xy) - k * k;
  if (abs(A) < 1e-7) {
    if (abs(B) > 1e-9) { float r = -C / B; if (B > 0.0) t1 = min(t1, r); else t0 = max(t0, r); }
    else if (C > 0.0) return vec2(1.0, 0.0);
  } else {
    float disc = B * B - 4.0 * A * C;
    if (A > 0.0) {
      if (disc <= 0.0) return vec2(1.0, 0.0);
      float s = sqrt(disc);
      t0 = max(t0, (-B - s) / (2.0 * A)); t1 = min(t1, (-B + s) / (2.0 * A));
    } else if (disc > 0.0) {
      // looking down the axis: inside outside the two roots (the far nappe lies outside the slab)
      float s = sqrt(disc);
      float r1 = (-B + s) / (2.0 * A), r2 = (-B - s) / (2.0 * A);
      if (t0 < r1) t1 = min(t1, r1); else t0 = max(t0, r2);
    }
  }
  return vec2(max(t0, 0.0), t1);
}

// the flame: spreading (wide in vacuum), thinning as it spreads, its edge torn into tongues by
// turbulence streaming aft
vec3 flame(vec3 p){
  float z = p.z, zn = z / uL;
  float r = length(p.xy);
  vec3 q = vec3(p.xy * (0.2 / uR0), z * (0.08 / uR0) - uPh) * uNf + uSeed;
  float n = texture(tNoise3D, q).r;
#if OCT > 1
  n = n * 0.65 + texture(tNoise3D, q * vec3(2.3, 2.3, 1.7) + vec3(0.31, 0.77, -uPh * 0.9)).g * 0.5 - 0.06;
#endif
  float rm = uR0 * 1.02 + z * uTan;
  float x = r / rm;
  float m = exp(-x * x * 1.9) * (uR0 * uR0) / (rm * rm);
  m *= smoothstep(0.2, 0.75, n + 0.3 * (1.0 - zn) - 0.22 * x) * (1.0 - zn) * (1.0 - zn);
  vec3 c = mix(uHot, mix(uMant, uTail, smoothstep(0.3, 1.0, zn)), smoothstep(0.0, 0.3, zn));
  c = mix(c, uTail, smoothstep(0.5, 1.4, x) * 0.6);
  return c * m * 1.3;
}

// the core: white-hot out of the nozzle, pinched and swollen by its shock cells, the Mach disks
// bright at the pinches
vec3 core(vec3 p){
  float z = p.z, r = length(p.xy);
  float ph = z / uLam;
  float cell = cos(6.2831853 * ph);
  float rc = uR0 * 0.5 * (1.0 + 0.22 * uDia * cell) * (1.0 + 0.15 * z / uCoreL);
  float y = r / rc;
  float pinch = 0.5 - 0.5 * cell;
  float end = 1.0 - smoothstep(0.6 * uHc, uHc, z);
  float c = exp(-y * y * 2.3) * exp(-z / uCoreL) * (1.0 - 0.3 * uDia + 0.3 * uDia * pinch) * end;
  float disk = pinch * pinch * pinch * pinch * pinch * pinch * exp(-y * y * 3.0) * uDia * exp(-z / (uCoreL * 1.1)) * end;
  // white-hot out of the nozzle, the engine's own colour further down
  return mix(uCore, uHot, smoothstep(0.0, 2.5 * uCoreL, z)) * (c * 3.0 + disk * 4.0);
}

void main(){
  vec3 d = normalize(vD), o = vO;
  vec2 s = span(o, d, uA, uB, uH);
  if (s.y <= s.x) discard;
  // per-pixel offset of the samples (no banding)
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float ds = (s.y - s.x) / float(STEPS);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < STEPS; i++) acc += flame(o + d * (s.x + (float(i) + j) * ds));
  acc *= ds;
  // the core is narrow: sampled on its own, only where the ray passes it
  vec2 sc = span(o, d, uCa, uCb, uHc);
  if (sc.y > sc.x) {
    float dc = (sc.y - sc.x) / float(CSTEPS);
    vec3 k = vec3(0.0);
    for (int i = 0; i < CSTEPS; i++) k += core(o + d * (sc.x + (float(i) + j) * dc));
    acc += k * dc;
  }
  vec3 c = acc / uR0 * uI;
  gl_FragColor = vec4(min(c, vec3(24.0)), 1.0);
}`;

/** a closed unit frustum (z 0..1, the polygon round the unit circle) per nozzle, merged */
function frustumGeo(exits, seg) {
  const base = new THREE.CylinderGeometry(1, 1, 1, seg, 1, false);
  base.rotateX(Math.PI / 2);
  base.translate(0, 0, 0.5);
  const k = 1 / Math.cos(Math.PI / seg);
  base.scale(k, k, 1);
  const pos = base.attributes.position.array, idx = base.index.array;
  const nv = pos.length / 3;
  const P = new Float32Array(pos.length * exits.length), E = new Float32Array(pos.length * exits.length);
  const I = [];
  exits.forEach((e, j) => {
    P.set(pos, j * pos.length);
    for (let i = 0; i < nv; i++) { E[(j * nv + i) * 3] = e.x; E[(j * nv + i) * 3 + 1] = e.y; E[(j * nv + i) * 3 + 2] = e.z; }
    for (let i = 0; i < idx.length; i++) I.push(idx[i] + j * nv);
  });
  base.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('aExit', new THREE.BufferAttribute(E, 3));
  g.setIndex(I);
  return g;
}

const lerp = (a, b, k) => a + (b - a) * k;

/**
 * One engine (or a cluster of nozzles pointing the same way). opts:
 *  exits: [Vector3] nozzle exit centres (parent frame), dir: Vector3 exhaust direction (parent
 *  frame, default +z), r0: exit radius (m), len: plume length at full thrust in vacuum (m),
 *  style: STYLES key, spread: tan of the vacuum spread angle, dia: shock-cell strength in vacuum,
 *  gain: brightness, seed, layers: [render layers] (default near + mid)
 */
export class EnginePlume {
  constructor(parent, opts) {
    this.o = Object.assign({ dir: new THREE.Vector3(0, 0, 1), style: 'fusion', spread: 0.3, dia: 0.4, gain: 1, seed: Math.random() * 10, layers: [LAYER_NEAR, LAYER_MID] }, opts);
    const o = this.o, st = STYLES[o.style] || STYLES.fusion;
    this.style = st;
    const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    this.u = {
      uA: { value: 1 }, uB: { value: 0.3 }, uH: { value: 1 },
      uCa: { value: 1 }, uCb: { value: 0 }, uHc: { value: 1 }, uCoreL: { value: o.r0 * 6 },
      uR0: { value: o.r0 }, uL: { value: o.len }, uTan: { value: o.spread }, uLam: { value: o.r0 * 3 }, uDia: { value: o.dia },
      uI: { value: 0 }, uPh: { value: 0 }, uNf: { value: 1 }, uSeed: { value: new THREE.Vector3(o.seed * 0.137, o.seed * 0.291, o.seed * 0.053) },
      uCore: { value: v3(st.core) }, uHot: { value: v3(st.hot) }, uMant: { value: v3(st.mant) }, uTail: { value: v3(st.tail) },
      tNoise3D: noiseTex,
    };
    const lowQ = QUALITY.level === 'low' || QUALITY.level === 'low2';
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG,
      defines: { STEPS: steps(), CSTEPS: QUALITY.level === 'low2' ? 4 : lowQ ? 6 : 10, OCT: lowQ ? 1 : 2 },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    });
    // the plume's frame: +z along the exhaust (the nozzle exits stay where they are)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), o.dir.clone().normalize());
    const qi = q.clone().invert();
    this.mesh = new THREE.Mesh(frustumGeo(o.exits.map((e) => e.clone().applyQuaternion(qi)), lowQ ? 12 : 20), this.mat);
    this.mesh.quaternion.copy(q);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.layers.mask = 0;
    for (const l of o.layers) this.mesh.layers.enable(l);
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.k = 0;        // smoothed thrust
    this.ign = 0;      // ignition flash
    this.t = 0;
    this.ph = 0;
    this.L = o.len;
  }

  /**
   * per drawn frame. k: thrust 0..1 (a little over for ULTRA), air: 0 (vacuum) .. 1 (sea level),
   * boost: 0 (rated) .. 1 (ULTRA) .. 2 (MAX)
   */
  update(dt, k, air = 0, boost = 0) {
    const o = this.o, U = this.u;
    if (k > 0.1 && this.k < 0.03) this.ign = 1;
    this.k += (k - this.k) * Math.min(1, dt * (k > this.k ? 10 : 5));
    this.ign = Math.max(0, this.ign - dt * 3.2);
    const K = Math.min(1.4, this.k);
    const on = K > 0.006 || this.ign > 0.02;
    this.mesh.visible = on;
    if (!on) return;
    this.t = (this.t + dt) % 1000;
    const r0 = o.r0;
    const L = (o.len * (0.25 + 0.75 * Math.min(1.2, K)) * (1 + 0.45 * boost) * (1 - 0.4 * air) + r0 * 2) * (1 + 0.25 * this.ign);
    this.L = L;
    const tan = lerp(o.spread, 0.035, air) * (0.55 + 0.45 * Math.min(1, K)) * (1 + 0.6 * this.ign);
    U.uL.value = L;
    U.uTan.value = tan;
    // the white-hot core: a few nozzle widths in vacuum, longer in air and pushed harder
    const coreL = r0 * lerp(4.2, 12, air) * (0.6 + 0.4 * Math.min(1.2, K)) * (1 + 0.35 * boost);
    U.uCoreL.value = coreL;
    U.uDia.value = lerp(o.dia, 1.0, air) * (1 + 0.25 * boost);
    U.uLam.value = r0 * lerp(3.4, 2.3, air) * (1 + 0.15 * boost);
    // turbulence streams aft at a couple of plume lengths a second
    this.ph += dt * 2.2 * L * 0.08 / r0;
    U.uPh.value = this.ph % 512;
    // flicker; a stutter as it dies away
    const fl = 0.93 + 0.045 * Math.sin(this.t * 53 + o.seed) + 0.035 * Math.sin(this.t * 31.7 + 2 * o.seed) + (K < 0.12 ? (Math.random() - 0.5) * 0.6 : 0);
    U.uI.value = o.gain * Math.max(K, 0.25 * this.ign) * fl * (1 + 1.6 * this.ign) * (1 + 0.45 * boost);
    // the bounding frustum (the flame fades out well inside it)
    U.uA.value = r0 * 1.7;
    U.uB.value = tan * 1.7 + 0.01;
    U.uH.value = L;
    U.uCa.value = r0 * 0.95;
    U.uCb.value = r0 * 0.14 / coreL;
    U.uHc.value = Math.min(L, coreL * 4);
    // colours: pushed past its rating, the core goes white and the flame violet
    const b = Math.min(1, boost * 0.6), st = this.style;
    U.uCore.value.set(lerp(st.core[0], BOOST.core[0], b), lerp(st.core[1], BOOST.core[1], b), lerp(st.core[2], BOOST.core[2], b));
    U.uHot.value.set(lerp(st.hot[0], BOOST.hot[0], b), lerp(st.hot[1], BOOST.hot[1], b), lerp(st.hot[2], BOOST.hot[2], b));
    U.uMant.value.set(lerp(st.mant[0], BOOST.mant[0], b), lerp(st.mant[1], BOOST.mant[1], b), lerp(st.mant[2], BOOST.mant[2], b));
    U.uTail.value.set(lerp(st.tail[0], BOOST.tail[0], b), lerp(st.tail[1], BOOST.tail[1], b), lerp(st.tail[2], BOOST.tail[2], b));
  }

  /** passes from the camera's distance to the plume's root */
  setDistance(d) {
    const ext = this.o.r0 * 2 + 2;
    assignLayers(this.mesh, Math.max(0, d - ext), d + this.L + ext);
  }

  get visible() { return this.mesh.visible; }

  dispose() {
    this.mesh.parent && this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** air density (kg/m^3) to the plume's 0 (vacuum) .. 1 (sea level) */
export function plumeAir(rho) {
  return rho > 0 ? Math.min(1, Math.pow(rho / 1.225, 0.3)) : 0;
}
