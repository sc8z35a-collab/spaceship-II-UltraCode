// AKAMO's ribbon as it is seen. The whole of it — 2,500 km straight up from Shirasagi — is a fine
// thread of light (lit by the sun, dark in the Earth's shadow, a glint sliding along it); near the
// eye it is the ribbon itself: a band of woven carbon 1.2 m wide, titanium straps across it every
// 50 m, a red marker light every 250 m, a white flasher every kilometre, drawn over three
// kilometres either way from where the eye is closest to it. Seen from a cabin running up it the
// lights do what they do on a camera's frame: past a few hundred metres a second they smear into
// streaks along it, and at full speed the whole ribbon is one long glowing line.
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LAYER_FAR, LAYER_MID, LAYER_NEAR } from '../core/layers.js';

const NEAR = 3000;             // m either side of the closest point
const SEG = 600;               // the band's samples along it
const W = 1.2;                 // its width

const VERT = /* glsl */`
attribute float aU;            // metres along it from the window's middle
varying float vU; varying float vX; varying vec3 vW;
void main(){
  vU = aU; vX = position.x;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */`
uniform float uS0;             // the window's middle, metres from the bottom (mod 10 km)
uniform float uStreak;         // m: how far a light runs during a frame's exposure
uniform float uTime;
uniform vec3 uSun;             // the sun's light on it (colour * how lit)
uniform float uLen;            // the ribbon's whole length
uniform float uSAbs;           // the window's middle, metres from the bottom (whole)
varying float vU; varying float vX; varying vec3 vW;
float hash(float n){ return fract(sin(n) * 43758.5453); }
// a light every 'every' metres (at 'at'), 'size' long, smeared over 'streak'
float lights(float u, float every, float at, float size, float streak){
  float L = max(size, streak);
  float m = mod(u - at, every);
  float k = smoothstep(0.0, size * 0.25, m) * (1.0 - smoothstep(L - size * 0.25, L, m));
  return k * size / L;
}
void main(){
  float u = vU + uS0;
  float sAbs = vU + uSAbs;
  if (sAbs < 0.0 || sAbs > uLen) discard;
  // the weave (fine diagonal twill, finer than a pixel far off: averaged out by fwidth)
  float fw = fwidth(u);
  float tw = fw < 0.05 ? 0.5 + 0.5 * sin((u * 40.0 + vX * 40.0)) * sin((u * 40.0 - vX * 40.0)) : 0.5;
  vec3 c = vec3(0.045, 0.048, 0.055) * (0.85 + 0.3 * tw);
  // the edges a little lighter (the cords along them)
  c += vec3(0.05) * smoothstep(0.52, 0.6, abs(vX));
  // the sun's light on it, a sheen sliding along the weave
  c += uSun * (0.08 + 0.25 * pow(0.5 + 0.5 * sin(u * 0.003 + uTime * 0.2), 8.0));
  // the straps across it every 50 m (their glint)
  float strap = 1.0 - smoothstep(0.08, 0.14, abs(mod(u, 50.0) - 25.0) - 24.86);
  c = mix(c, vec3(0.5, 0.52, 0.55) * (0.3 + uSun), strap * smoothstep(8.0, 1.0, fw * 60.0));
  // the lights: red markers every 250 m (steady), a white flasher every km (a double blink)
  float side = 1.0 - smoothstep(0.1, 0.2, abs(abs(vX) - 0.45));
  float red = lights(u, 250.0, 0.0, 0.35, uStreak) * side;
  float blink = step(0.9, fract(uTime * 0.8 + hash(floor(u / 1000.0)) * 0.3)) ;
  float white = lights(u, 1000.0, 500.0, 0.5, uStreak) * (uStreak > 5.0 ? 0.6 : blink);
  c += vec3(4.0, 0.25, 0.12) * red * 3.0 + vec3(5.0) * white * 3.0;
  gl_FragColor = vec4(c, 1.0);
}`;

export class AkamoTether {
  constructor(engine) {
    this.engine = engine;
    // ---- the near band (local coordinates round the window's middle: x across, y along)
    const pos = new Float32Array((SEG + 1) * 2 * 3), uu = new Float32Array((SEG + 1) * 2), idx = [];
    for (let i = 0; i <= SEG; i++) {
      // (denser near the middle: the closest few hundred metres are where the detail is seen)
      const q = i / SEG * 2 - 1;
      const u = Math.sign(q) * Math.pow(Math.abs(q), 2.2) * NEAR;
      for (let j = 0; j < 2; j++) { const k = (i * 2 + j); pos[k * 3] = (j ? 1 : -1) * W / 2; pos[k * 3 + 1] = u; pos[k * 3 + 2] = 0; uu[k] = u; }
      if (i < SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aU', new THREE.BufferAttribute(uu, 1));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), NEAR + 10);
    this.U = { uS0: { value: 0 }, uStreak: { value: 0 }, uTime: { value: 0 }, uSun: { value: new THREE.Vector3(1, 1, 1) }, uLen: { value: 2.5e6 }, uSAbs: { value: 0 } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide });
    this.near = new THREE.Mesh(g, this.mat);
    this.near.matrixAutoUpdate = false;
    this.near.frustumCulled = false;
    this.near.layers.set(LAYER_NEAR); this.near.layers.enable(LAYER_MID);
    engine.scene.add(this.near);
    // ---- the far thread: two segments (below and above the near window)
    this.farGeo = new LineSegmentsGeometry();
    this.farGeo.setPositions(new Float32Array(12));
    this.farGeo.setColors(new Float32Array(12));
    this.farMat = new LineMaterial({ linewidth: 1.6, vertexColors: true, transparent: true, depthWrite: false, worldUnits: false });
    this.far = new LineSegments2(this.farGeo, this.farMat);
    this.far.frustumCulled = false;
    this.far.layers.set(LAYER_FAR); this.far.layers.enable(LAYER_MID); this.far.layers.enable(LAYER_NEAR);
    engine.scene.add(this.far);
    this._p = new Float32Array(12); this._c = new Float32Array(12);
    this._m = new THREE.Matrix4(); this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
  }

  /**
   * base: the bottom of the ribbon (ECI), up: its direction (unit), across: the band's width
   * direction (unit, square to up); L: its length; origin: the render origin; cam: the camera
   * (render coordinates); sun: { dir (unit), lit 0..1 }; streak: m a light runs in a frame
   */
  update(base, up, across, L, origin, cam, sun, streak, t) {
    // the closest point along it to the eye
    const rel = this._v.copy(base).sub(origin);              // the bottom, in render coordinates
    const sC = Math.max(0, Math.min(L, this._v2.copy(cam).sub(rel).dot(up)));
    // ---- near band: its middle at sC
    const mid = this._v2.copy(rel).addScaledVector(up, sC);
    const nrm = new THREE.Vector3().crossVectors(across, up).normalize();
    this._m.makeBasis(across, up, nrm).setPosition(mid);
    this.near.matrix.copy(this._m);
    this.near.matrixWorld.copy(this._m);
    this.U.uS0.value = sC % 10000;
    this.U.uSAbs.value = sC;
    this.U.uLen.value = L;
    this.U.uStreak.value = streak;
    this.U.uTime.value = t % 1000;
    const k = sun.lit;
    this.U.uSun.value.set(1.0, 0.97, 0.92).multiplyScalar(k * Math.max(0.15, Math.abs(sun.dir.dot(nrm))));
    const dNear = mid.distanceTo(cam);
    this.near.visible = dNear < NEAR * 2;
    // ---- far thread: [0, sC - NEAR] and [sC + NEAR, L] (the near band covers between)
    const P = this._p, C = this._c;
    const put = (i, s) => { const p = this._v.copy(rel).addScaledVector(up, s); P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z; };
    const a0 = 0, a1 = Math.max(0, sC - NEAR * 0.9), b0 = Math.min(L, sC + NEAR * 0.9), b1 = L;
    put(0, a0); put(1, Math.max(a0, a1)); put(2, Math.min(b0, b1)); put(3, b1);
    const lum = 0.08 + 0.55 * k;
    for (let i = 0; i < 4; i++) { C[i * 3] = lum * 1.0; C[i * 3 + 1] = lum * 0.98; C[i * 3 + 2] = lum * 0.95; }
    // (into the buffers it already has: setPositions/setColors make new GPU buffers at every call)
    const ia = this.farGeo.attributes.instanceStart, ic = this.farGeo.attributes.instanceColorStart;
    if (ia && ia.data.array.length === P.length) { ia.data.array.set(P); ia.data.needsUpdate = true; this.farGeo.computeBoundingSphere(); } else this.farGeo.setPositions(P);
    if (ic && ic.data.array.length === C.length) { ic.data.array.set(C); ic.data.needsUpdate = true; } else this.farGeo.setColors(C);
    this.farMat.resolution.set(this.engine.rw, this.engine.rh);
    this.farMat.linewidth = 1.4 * Math.max(1, this.engine.pr);
    this.far.visible = true;
  }

  hide() { this.near.visible = false; this.far.visible = false; }
}
