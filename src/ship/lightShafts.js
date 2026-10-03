// Sunbeams through the windows and the canopy: an open tube swept from each opening's inner edge
// along the sunlight, drawn additively with drifting dust and soft edges. Only openings that face
// the sun light up, and everything fades out in the Earth's shadow.
import * as THREE from 'three';
import { OPENINGS, HULL } from './hullShape.js';
import { noiseTex } from '../core/noiseTex.js';
import { LAYER_NEAR } from '../core/layers.js';
import { roundRect } from './sweep.js';

export class LightShafts {
  constructor(root) {
    const pos = [], aN = [], aT = [], idx = [];
    const addTube = (pts, n) => {
      const base = pos.length / 3, L = pts.length;
      for (const p of pts) for (const t of [0, 1]) { pos.push(p.x, p.y, p.z); aN.push(n.x, n.y, n.z); aT.push(t); }
      for (let i = 0; i < L; i++) {
        const a = base + i * 2, b = base + ((i + 1) % L) * 2;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    };
    for (const o of OPENINGS) {
      if (o.kind !== 'win') continue;
      const c = o.center.clone().addScaledVector(o.normal, -(HULL.inset + 0.015));
      const pts = roundRect(o.halfW * 2 * 0.96, o.halfH * 2 * 0.96, o.radius * 0.96, 0, 0, 6).map(([x, y]) => c.clone().addScaledVector(o.u, x).addScaledVector(o.v, y));
      addTube(pts, o.normal);
    }
    // canopy: approximated by an ellipse behind the glazing
    {
      const n = new THREE.Vector3(0, 0.42, -1).normalize();
      const c = new THREE.Vector3(0, 1.45, -12.2);
      const u = new THREE.Vector3(1, 0, 0), v = new THREE.Vector3().crossVectors(n, u).normalize();
      const pts = [];
      for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; pts.push(c.clone().addScaledVector(u, Math.cos(a) * 1.45).addScaledVector(v, Math.sin(a) * 0.95)); }
      addTube(pts, n);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aN', new THREE.Float32BufferAttribute(aN, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uLen: { value: 3.2 }, uColor: { value: new THREE.Color(1, 1, 1) }, uI: { value: 0 }, uTime: { value: 0 }, tNoise3D: { value: noiseTex } },
      vertexShader: /* glsl */`
        attribute vec3 aN; attribute float aT; uniform vec3 uSun; uniform float uLen;
        varying float vT; varying float vK; varying vec3 vW; varying vec3 vP;
        void main(){
          float k = max(0.0, dot(aN, uSun));
          vec3 p = position - uSun * aT * uLen * (0.55 + 0.45 * k);
          vT = aT; vK = k; vP = p;
          vec4 w = modelMatrix * vec4(p, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uI; uniform float uTime; uniform highp sampler3D tNoise3D;
        varying float vT; varying float vK; varying vec3 vW; varying vec3 vP;
        void main(){
          vec3 C = cross(dFdx(vW), dFdy(vW));
          vec3 E = cameraPosition - vW;
          float dE = length(E);
          float soft = pow(abs(dot(C, E)) / max(length(C) * dE, 1e-12), 1.5);   // soft beam edges
          float nearEye = smoothstep(0.2, 1.4, dE);                   // standing in the beam: no fog on the lens
          float fade = pow(1.0 - vT, 1.7) * smoothstep(0.0, 0.06, vT + 0.02);
          float dust = 0.55 + 0.45 * texture(tNoise3D, vP * 0.55 + vec3(0.0, uTime * 0.018, uTime * 0.011)).r;
          float motes = smoothstep(0.82, 0.97, texture(tNoise3D, vP * 2.7 + vec3(uTime * 0.01, 0.0, uTime * 0.02)).g);
          float a = uI * sqrt(vK) * fade * soft * nearEye * (dust + motes * 1.5);
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.mesh.layers.set(LAYER_NEAR);
    root.add(this.mesh);
  }

  /** sunLocal: unit sun direction in ship space; sunColor: colour reaching the ship (0 in eclipse) */
  update(sunLocal, sunColor, t, air = 1) {
    const u = this.mat.uniforms;
    u.uSun.value.copy(sunLocal);
    u.uColor.value.copy(sunColor);
    const lum = sunColor.r * 0.2126 + sunColor.g * 0.7152 + sunColor.b * 0.0722;
    // the beams are dust and moisture in the cabin air: they vanish if the cabin is depressurised
    u.uI.value = Math.min(1, lum) * 0.3 * Math.max(0, Math.min(1, air));
    u.uTime.value = t % 1000;
    this.mesh.visible = lum > 0.01;
  }
}
