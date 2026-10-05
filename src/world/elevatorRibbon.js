// The space elevator's tether: two carbon-nanotube ribbons, 1.6 m wide and 8.4 m apart, from the
// anchor platform to the counterweight. Two renderers share the work:
//  - far: one screen-space line along the axis (the ribbons merge beyond a few km), brightened
//    by a sun glint that slides along it as the viewing angle changes, dark in the Earth's shadow;
//  - near: within 8 km of the camera, the real ribbons — a twill-woven graphite band with an
//    anisotropic sheen along its fibres, titanium straps every 25 m, painted markers every 100 m,
//    km bands, sleeved edge cords that never thin below a pixel, marker LEDs, approach lights that
//    chase toward a berth, climbers' headlights and berth floods glowing on the band, and waves
//    that run along the ribbon after a climber starts or something hits it.
// The near part lives in a moving window frame (origin on the axis at the camera's closest point,
// basis = the terminal stations' frame), so all its numbers stay small.
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { R_EARTH } from '../core/astro.js';
import { LAYER_FAR, LAYER_MID, LAYER_NEAR } from '../core/layers.js';
import { LANE_X } from './elevatorTraffic.js';

export const RIBBON_W = 1.6;
export const NEAR_R = 8000;             // near window reach (m)
const K = 64;                           // near samples on each side of the window centre
const NL = 8;                           // ribbon lights (climber headlights, berth floods)
const NW = 4;                           // travelling wave packets

const nearVS = /* glsl */`
  attribute float aPart; attribute float aSide; attribute float aLane;
  uniform float uPx; uniform vec4 uWave[${NW}]; uniform vec4 uWave2[${NW}]; uniform vec4 uWhip;
  varying vec3 vWorld; varying float vS; varying float vU; varying float vPart; varying float vLane;
  varying vec3 vSideW; varying float vDist;
  vec2 disp(float s, float lane){
    vec2 d = vec2(0.0);
    for (int i = 0; i < ${NW}; i++) {
      vec4 a = uWave[i]; vec4 b = uWave2[i];
      if (a.y <= 0.0) continue;
      if (b.x != 0.0 && abs(b.x - lane) > 0.5) continue;
      float r = abs(s - a.x);
      float q = (r - a.w) / b.y;
      float env = exp(-q * q);
      d += vec2(cos(b.z), sin(b.z)) * a.y * env * sin(a.z * (r - a.w));
    }
    // a severed free end flails: big, slow, decaying toward the intact ribbon
    if (uWhip.z > 0.0) {
      float e = min(abs(s - uWhip.x), abs(s - uWhip.y));
      float k = uWhip.z * exp(-e / 260.0);
      d += k * vec2(sin(uWhip.w * 0.9 + e * 0.011 + lane), cos(uWhip.w * 0.6 + e * 0.008));
    }
    return d;
  }
  void main(){
    vec3 p = position;
    vec2 d = disp(p.y, aLane);
    p.x += d.x; p.z += d.y;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vec3 ax = normalize((modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    vec3 toCam = cameraPosition - wp.xyz;
    float dist = length(toCam);
    vSideW = normalize((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
    if (aPart > 0.5) {
      // edge cord: a camera-facing tube, never thinner than about a pixel
      vec3 side = normalize(cross(ax, toCam));
      float r = max(0.05, dist * uPx * 0.62);
      wp.xyz += side * aSide * r;
      vSideW = side;
    }
    vU = aSide; vS = position.y; vPart = aPart; vLane = aLane; vDist = dist;
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const nearFS = /* glsl */`
  uniform vec3 uSunL; uniform vec3 uSunC; uniform vec3 uEarthL; uniform vec3 uEarthC; uniform vec3 uAmb;
  uniform float uH0; uniform vec2 uGap; uniform vec2 uEnds; uniform float uW;
  uniform vec3 uAx; uniform vec3 uEx; uniform vec3 uEz;
  uniform vec4 uLA[${NL}]; uniform vec4 uLC[${NL}];
  varying vec3 vWorld; varying float vS; varying float vU; varying float vPart; varying float vLane;
  varying vec3 vSideW; varying float vDist;
  // Kajiya-Kay highlight for fibres along t
  float kk(vec3 t, vec3 H, float n){ float th = dot(t, H); return pow(max(0.0, 1.0 - th * th), n * 0.5); }
  void main(){
    if (vS > uGap.x && vS < uGap.y) discard;
    if (vS < uEnds.x || vS > uEnds.y) discard;
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 AX = uAx;
    float h = uH0 + vS;
    vec3 col;
    if (vPart > 0.5) {
      // sleeved edge cord: round shading across the billboard
      float c = vU;
      vec3 N = normalize(vSideW * c + V * sqrt(max(0.0, 1.0 - c * c)));
      float dl = max(0.0, dot(N, uSunL));
      vec3 Hh = normalize(uSunL + V);
      float sp = pow(max(0.0, dot(N, Hh)), 40.0) * 0.6;
      vec3 alb = vec3(0.52, 0.53, 0.55);
      // a reflective tracer thread every 100 m, a dark splice sleeve every 25 m
      float m25 = abs(fract(h / 25.0 + 0.5) - 0.5) * 25.0;
      alb *= mix(1.0, 0.35, step(m25, 0.4));
      col = alb / 3.14159 * (uSunC * dl + uEarthC * max(0.0, dot(N, uEarthL))) + uSunC * sp * 0.25 + alb * uAmb;
    } else {
      // the band: graphite twill with fibres running along the ribbon
      vec3 X = uEx;                                     // across the band
      vec3 N = dot(uEz, V) < 0.0 ? -uEz : uEz;
      float u = vU * uW * 0.5;                          // metres across
      float fw = fwidth(h) + fwidth(u);
      // twill tows at +-45 degrees, 0.125 m period; fades to the average once below a pixel
      float a1 = (u + h) / 0.125, a2 = (u - h) / 0.125;
      float chk = mod(floor(a1) + floor(a2), 2.0);
      float lod = smoothstep(0.08, 0.35, fw / 0.125);
      vec3 t1 = normalize(AX + X), t2 = normalize(AX - X);
      vec3 L = uSunL;
      vec3 Hh = normalize(L + V);
      float dl = max(0.0, dot(N, L));
      float s1 = kk(t1, Hh, 90.0), s2 = kk(t2, Hh, 90.0), s0 = kk(AX, Hh, 160.0);
      float spec = mix(mix(s1, s2, chk), 0.5 * (s1 + s2), lod) * 0.55 + s0 * 0.45;
      vec3 alb = vec3(0.075, 0.08, 0.088) * mix(1.0 + 0.18 * (chk - 0.5), 1.0, lod);
      // straps (titanium, every 25 m), lane markers (every 100 m), km bands
      float m25 = abs(fract(h / 25.0 + 0.5) - 0.5) * 25.0;
      float strap = 1.0 - smoothstep(0.14, 0.14 + fw * 1.5, m25);
      float m100 = abs(fract(h / 100.0 + 0.5) - 0.5) * 100.0;
      float mark = (1.0 - smoothstep(0.55, 0.55 + fw * 1.5, m100)) * step(abs(u), uW * 0.36);
      float m1k = abs(fract(h / 1000.0 + 0.5) - 0.5) * 1000.0;
      float kmb = 1.0 - smoothstep(2.4, 2.4 + fw * 1.5, m1k);
      float kstripe = step(0.5, fract(m1k / 0.6));
      vec3 markCol = vLane < 0.0 ? vec3(0.95, 0.42, 0.08) : vec3(0.85, 0.92, 0.98);
      alb = mix(alb, vec3(0.42, 0.43, 0.45), strap);
      alb = mix(alb, markCol * 0.8, mark);
      alb = mix(alb, mix(vec3(0.9), vec3(0.06), kstripe), kmb * 0.85);
      spec = mix(spec, pow(max(0.0, dot(N, Hh)), 60.0) * 1.4, max(strap, kmb * 0.5));
      // edges catch a little more light (the band is slightly cupped)
      float edge = smoothstep(0.7, 1.0, abs(vU));
      col = alb / 3.14159 * (uSunC * dl + uEarthC * max(0.0, dot(N, uEarthL))) + uSunC * spec * dl * (1.0 + edge) * 0.5 + alb * uAmb;
      // retroreflective markers glow back at a lit viewer
      col += markCol * mark * 0.6 * pow(max(0.0, dot(V, L)), 8.0) * length(uSunC) * 0.2;
      // ribbon lights: climbers' headlights ahead of them, the berth floods, the anchor floods
      for (int i = 0; i < ${NL}; i++) {
        vec4 la = uLA[i]; vec4 lc = uLC[i];
        if (lc.w <= 0.0) continue;
        if (la.y != 0.0 && abs(la.y - vLane) > 0.5) continue;
        float ds = vS - la.x;
        if (la.z * ds < 0.0) continue;
        float q = clamp(abs(ds) / la.w, 0.0, 1.0);
        float f = (1.0 - q) * (1.0 - q) / (1.0 + abs(ds) * 0.08);
        col += lc.rgb * lc.w * f * (alb * 2.0 + 0.04 + spec * 0.6);
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

const ledVS = /* glsl */`
  attribute vec3 color; attribute float size; uniform float uScale; varying vec3 vC;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = -mv.z;
    vC = color * clamp(4000.0 / d, 0.25, 1.0);
    gl_PointSize = clamp(size * uScale * clamp(60.0 / d, 0.35, 3.0), 1.2, 24.0);
  }`;
const ledFS = /* glsl */`
  varying vec3 vC;
  void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float g = exp(-dot(p, p) * 3.5); gl_FragColor = vec4(vC * g, 1.0); }`;

/** near window: twin ribbons + their LEDs, rebuilt along the axis around the camera every frame */
export class NearRibbon {
  constructor(scene) {
    const S = 2 * K + 1;
    this.S = S;
    this.s = new Float32Array(S);
    // vertices: lane (2) x strip (band, cord-, cord+) x sample x 2
    const nV = 2 * 3 * S * 2;
    const pos = new Float32Array(nV * 3), part = new Float32Array(nV), side = new Float32Array(nV), lane = new Float32Array(nV);
    const idx = [];
    let v = 0;
    this.strips = [];
    for (const l of [-1, 1]) for (let st = 0; st < 3; st++) {
      const base = v;
      for (let k = 0; k < S; k++) for (const sd of [-1, 1]) { part[v] = st === 0 ? 0 : 1; side[v] = sd; lane[v] = l; v++; }
      for (let k = 0; k < S - 1; k++) {
        const a = base + k * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, d, a, d, c);
      }
      this.strips.push({ l, st, base });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aLane', new THREE.BufferAttribute(lane, 1));
    g.setIndex(idx);
    this.pos = pos;
    const vec4s = (n) => Array.from({ length: n }, () => new THREE.Vector4());
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uPx: { value: 0.001 }, uWave: { value: vec4s(NW) }, uWave2: { value: vec4s(NW) }, uWhip: { value: new THREE.Vector4() },
        uSunL: { value: new THREE.Vector3(1, 0, 0) }, uSunC: { value: new THREE.Vector3(1, 1, 1) }, uEarthL: { value: new THREE.Vector3(0, -1, 0) },
        uEarthC: { value: new THREE.Vector3() }, uAmb: { value: new THREE.Vector3(0.004, 0.0045, 0.006) },
        uH0: { value: 0 }, uGap: { value: new THREE.Vector2(1e9, 1e9) }, uEnds: { value: new THREE.Vector2(-1e9, 1e9) }, uW: { value: RIBBON_W },
        uAx: { value: new THREE.Vector3(0, 1, 0) }, uEx: { value: new THREE.Vector3(1, 0, 0) }, uEz: { value: new THREE.Vector3(0, 0, 1) },
        uLA: { value: vec4s(NL) }, uLC: { value: vec4s(NL) },
      },
      vertexShader: nearVS, fragmentShader: nearFS, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.layers.set(LAYER_NEAR); this.mesh.layers.enable(LAYER_MID);
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
    // LEDs
    const NLED = 520;
    this.ledMax = NLED;
    const lg = new THREE.BufferGeometry();
    this.ledPos = new Float32Array(NLED * 3);
    this.ledCol = new Float32Array(NLED * 3);
    this.ledSize = new Float32Array(NLED);
    lg.setAttribute('position', new THREE.BufferAttribute(this.ledPos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(this.ledCol, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('size', new THREE.BufferAttribute(this.ledSize, 1).setUsage(THREE.DynamicDrawUsage));
    lg.setDrawRange(0, 0);
    this.ledMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 1 } }, vertexShader: ledVS, fragmentShader: ledFS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.leds = new THREE.Points(lg, this.ledMat);
    this.leds.frustumCulled = false;
    this.leds.matrixAutoUpdate = false;
    this.leds.layers.set(LAYER_NEAR); this.leds.layers.enable(LAYER_MID);
    scene.add(this.leds);
    this.active = false;
    this.waves = [];
  }

  /** a wave packet running both ways along the ribbon from height h (amp m, lane -1/1/0) */
  addWave(h, amp, lane = 0, speed = 900, width = 260, k = 0.012) {
    this.waves.push({ h, amp, lane, speed, width, k, age: 0, dir: Math.random() * Math.PI * 2 });
    if (this.waves.length > NW) this.waves.shift();
  }

  /**
   * frame: { O (Vector3 window origin, render frame), ex, ey, ez, hc (height of O), half (reach),
   *          sMin, sMax (local ribbon ends), gap [a, b] local or null, whip }
   * env: { sunL, sunC, earthL, earthC, pxAngle, pixelRatio, time, lights: [{s, lane, dir, range, color, k}], leds: fn }
   */
  update(F, env, dt) {
    this.active = !!F;
    this.mesh.visible = this.leds.visible = this.active;
    if (!F) return;
    const M = this.mesh.matrix;
    M.makeBasis(F.ex, F.ey, F.ez).setPosition(F.O);
    this.mesh.matrixWorld.copy(M);
    this.leds.matrix.copy(M);
    this.leds.matrixWorld.copy(M);
    // samples: dense around the camera's closest point, sparse toward the window's ends
    const s0 = 1.0;
    const lo = Math.max(-F.half, F.sMin), hi = Math.min(F.half, F.sMax);
    const aHi = Math.log(Math.max(hi, 0) / s0 + 1) / K, aLo = Math.log(Math.max(-lo, 0) / s0 + 1) / K;
    const s = this.s;
    for (let k = -K; k <= K; k++) {
      const v = k < 0 ? -s0 * (Math.exp(aLo * -k) - 1) : s0 * (Math.exp(aHi * k) - 1);
      s[k + K] = Math.min(hi, Math.max(lo, v));
    }
    const w2 = RIBBON_W / 2, P = this.pos;
    for (const st of this.strips) {
      const x0 = st.l * LANE_X + (st.st === 1 ? -w2 : st.st === 2 ? w2 : 0);
      for (let k = 0; k < this.S; k++) for (let j = 0; j < 2; j++) {
        const i = (st.base + k * 2 + j) * 3;
        P[i] = st.st === 0 ? st.l * LANE_X + (j ? w2 : -w2) : x0;
        P[i + 1] = s[k]; P[i + 2] = 0;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    const U = this.mat.uniforms;
    U.uPx.value = env.pxAngle;
    U.uAx.value.copy(F.ey); U.uEx.value.copy(F.ex); U.uEz.value.copy(F.ez);
    U.uSunL.value.copy(env.sunL);
    U.uSunC.value.copy(env.sunC);
    U.uEarthL.value.copy(env.earthL);
    U.uEarthC.value.copy(env.earthC);
    U.uH0.value = ((F.hc % 10000) + 10000) % 10000;
    U.uGap.value.set(F.gap ? F.gap[0] : 1e9, F.gap ? F.gap[1] : 1e9);
    U.uEnds.value.set(F.sMin, F.sMax);
    // waves (in window coordinates)
    for (const w of this.waves) w.age += dt;
    this.waves = this.waves.filter((w) => w.age < 14);
    for (let i = 0; i < NW; i++) {
      const w = this.waves[i];
      if (!w) { U.uWave.value[i].set(0, 0, 0, 0); continue; }
      const amp = w.amp * Math.exp(-w.age / 4);
      U.uWave.value[i].set(w.h - F.hc, amp, w.k, w.age * w.speed);
      U.uWave2.value[i].set(w.lane, w.width, w.dir, 0);
    }
    if (F.whip) U.uWhip.value.set(F.whip.a, F.whip.b, F.whip.amp, env.time);
    else U.uWhip.value.set(0, 0, 0, 0);
    // ribbon lights, nearest first
    const L = env.lights.slice().sort((a, b) => Math.abs(a.s) - Math.abs(b.s));
    for (let i = 0; i < NL; i++) {
      const l = L[i];
      if (!l) { U.uLC.value[i].set(0, 0, 0, 0); continue; }
      U.uLA.value[i].set(l.s, l.lane, l.dir, l.range);
      U.uLC.value[i].set(l.color[0], l.color[1], l.color[2], l.k);
    }
    // LEDs: marker lights on the cords every 250 m, red aviation lights every 2 km, and the
    // approach lights that chase toward a berth for 1.5 km either side of it
    let n = 0;
    const LP = this.ledPos, LC = this.ledCol, LS = this.ledSize;
    const put = (x, y, r, gg, b, size) => {
      if (n >= this.ledMax) return;
      LP[n * 3] = x; LP[n * 3 + 1] = y; LP[n * 3 + 2] = 0;
      LC[n * 3] = r; LC[n * 3 + 1] = gg; LC[n * 3 + 2] = b; LS[n] = size; n++;
    };
    const t = env.time;
    const h0 = F.hc + lo, h1 = F.hc + hi;
    const inGap = (h) => F.gap && h - F.hc > F.gap[0] && h - F.hc < F.gap[1];
    for (const l of [-1, 1]) {
      for (let h = Math.ceil(h0 / 250) * 250; h <= h1; h += 250) {
        if (inGap(h)) continue;
        const j = Math.round(h / 250);
        const red = j % 8 === 0;
        const x = l * LANE_X + (j % 2 ? w2 + 0.06 : -w2 - 0.06);
        if (red) { const on = ((t * 0.8 + j * 0.013) % 1) < 0.18; put(x, h - F.hc, on ? 9 : 0.25, on ? 0.6 : 0.02, on ? 0.3 : 0.01, on ? 3.2 : 1.6); }
        else put(x, h - F.hc, 2.2, 2.5, 3.0, 2.0);
      }
    }
    for (const B of env.berths || []) {
      if (B.h < h0 - 1600 || B.h > h1 + 1600) continue;
      for (const l of [-1, 1]) {
        const active = B.chase && (B.chase.lane === l || B.chase.lane === 0);
        for (let k = 1; k <= 30; k++) {
          const h = B.h + B.side * k * 50;
          if (h < h0 || h > h1 || inGap(h)) continue;
          let r = 1.4, gg = 0.75, b = 0.12, sz = 2.4;
          if (active) {
            // pulses run toward the berth while a climber comes in (away from it when one leaves)
            const ph = ((k / 30) + t * 0.9 * B.chase.sense) % 1;
            const p = Math.pow(Math.max(0, 1 - Math.abs(((ph + 1) % 1) - 0.5) * 2), 10);
            r += 14 * p; gg += 8 * p; b += 1 * p; sz += 4 * p;
          }
          put(l * LANE_X + w2 + 0.06, h - F.hc, r, gg, b, sz);
          put(l * LANE_X - w2 - 0.06, h - F.hc, r, gg, b, sz);
        }
      }
    }
    this.leds.geometry.setDrawRange(0, n);
    for (const a of ['position', 'color', 'size']) this.leds.geometry.attributes[a].needsUpdate = true;
    this.ledMat.uniforms.uScale.value = env.pixelRatio;
  }
}

/** the far tether: one line along the axis with lit / shadowed / glinting colours, cut around
 *  the near window and at a break */
export class FarRibbon {
  constructor(scene, hs) {
    this.h = hs;
    const N = hs.length - 1;
    this.N = N;
    this.cap = N + 3;
    this.seg = new Float32Array(this.cap * 6);
    this.col = new Float32Array(this.cap * 6);
    const geo = new LineSegmentsGeometry();
    geo.setPositions(this.seg);
    geo.setColors(this.col);
    this.segAttr = geo.attributes.instanceStart.data;
    this.colAttr = geo.attributes.instanceColorStart.data;
    this.mat = new LineMaterial({ color: 0xffffff, linewidth: 1.7, vertexColors: true, worldUnits: false });
    this.line = new LineSegments2(geo, this.mat);
    this.line.frustumCulled = false;
    this.line.matrixAutoUpdate = false;
    this.line.layers.set(LAYER_FAR); this.line.layers.enable(LAYER_MID); this.line.layers.enable(LAYER_NEAR);
    scene.add(this.line);
    this._v = new THREE.Vector3();
  }

  /** brightness of the ribbon at height h (lit / glint) */
  shade(h, ax, origin, camWorld, sunDir, sd, perp) {
    const r = R_EARTH + h;
    const lit = !(sd * r < 0 && perp * r < R_EARTH);
    if (!lit) return 0.035;
    const v = this._v.copy(ax).multiplyScalar(r).sub(origin);
    v.set(camWorld.x - v.x, camWorld.y - v.y, camWorld.z - v.z).normalize();
    // anisotropic glint along the fibres: bright where the half-vector is square to the ribbon
    const hx = v.x + sunDir.x, hy = v.y + sunDir.y, hz = v.z + sunDir.z;
    const hl = Math.hypot(hx, hy, hz) || 1;
    const th = (hx * ax.x + hy * ax.y + hz * ax.z) / hl;
    const kk = Math.pow(Math.max(0, 1 - th * th), 70);
    const diff = 0.55 + 0.45 * Math.max(0, 1 - Math.abs(sunDir.dot(ax)));
    // wider (and so brighter) toward the geostationary middle, where the ribbon is thickest
    const taper = 1 + 0.35 * Math.exp(-Math.pow((h - 35786e3) / 2.0e7, 2));
    return (0.9 * diff + 3.2 * kk) * taper;
  }

  update(ax, origin, camWorld, sunDir, cut, gap, size) {
    const N = this.N, h = this.h, seg = this.seg, col = this.col;
    const sd = ax.dot(sunDir), perp = Math.sqrt(Math.max(0, 1 - sd * sd));
    let n = 0;
    const emit = (ha, hb) => {
      if (hb - ha < 1 || n >= this.cap) return;
      const ra = R_EARTH + ha, rb = R_EARTH + hb;
      const i = n * 6;
      seg[i] = ax.x * ra - origin.x; seg[i + 1] = ax.y * ra - origin.y; seg[i + 2] = ax.z * ra - origin.z;
      seg[i + 3] = ax.x * rb - origin.x; seg[i + 4] = ax.y * rb - origin.y; seg[i + 5] = ax.z * rb - origin.z;
      const ba = this.shade(ha, ax, origin, camWorld, sunDir, sd, perp), bb = this.shade(hb, ax, origin, camWorld, sunDir, sd, perp);
      col[i] = ba * 0.92; col[i + 1] = ba * 0.95; col[i + 2] = ba;
      col[i + 3] = bb * 0.92; col[i + 4] = bb * 0.95; col[i + 5] = bb;
      n++;
    };
    const holes = [];
    if (cut) holes.push(cut);
    if (gap) holes.push(gap);
    for (let k = 0; k < N; k++) {
      let a = h[k], b = h[k + 1];
      // subtract the holes from [a, b]
      const parts = [[a, b]];
      for (const [c0, c1] of holes) {
        for (let j = parts.length - 1; j >= 0; j--) {
          const [p0, p1] = parts[j];
          if (c1 <= p0 || c0 >= p1) continue;
          parts.splice(j, 1);
          if (c0 > p0) parts.push([p0, c0]);
          if (c1 < p1) parts.push([c1, p1]);
        }
      }
      for (const [p0, p1] of parts) emit(p0, p1);
    }
    this.line.geometry.instanceCount = n;
    this.segAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.mat.resolution.set(size.x, size.y);
  }
}
