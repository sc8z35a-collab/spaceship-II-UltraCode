// Orbital infrastructure: named stations (autopilot destinations, one repair dock) and a
// network of 5G relay base stations on circular orbits, rendered as 3D models up close and
// blinking lights far away.
import * as THREE from 'three';
import { MU_EARTH, R_EARTH, gmst, latLonToUnit, ecefToEci } from '../core/astro.js';
import { Builder, rng } from '../ship/geom.js';
import { assignLayers, LAYER_FAR, LAYER_MID, LAYER_NEAR, setLayersDeep } from '../core/layers.js';

/** reference plane defined from the canonical start state (deterministic) */
export function referenceFrame(startTime) {
  const lat = 34.5 * Math.PI / 180, lon = 137.5 * Math.PI / 180;
  const th = gmst(startTime);
  const e1 = ecefToEci(latLonToUnit(lat, lon), th).normalize();
  const north = new THREE.Vector3(0, 1, 0).addScaledVector(e1, -e1.y).normalize();
  const east = new THREE.Vector3(0, 1, 0).cross(e1).normalize();
  const head = 55 * Math.PI / 180;
  const pro = north.multiplyScalar(Math.cos(head)).add(east.multiplyScalar(Math.sin(head))).normalize();
  const h = new THREE.Vector3().crossVectors(e1, pro).normalize();
  const e2 = new THREE.Vector3().crossVectors(h, e1).normalize();
  return { e1, e2, h, t0: startTime };
}

export const STATION_DEFS = [
  { id: 'shirasagi', name: 'シラサギ・ステーション', en: 'SHIRASAGI', alt: 426e3, phase: 2.3, size: 1.0, kind: 'hub' },
  { id: 'nagi', name: 'ナギ中継局', en: 'NAGI RELAY', alt: 515e3, phase: -9, size: 0.7, kind: 'relay' },
  { id: 'kaguya', name: 'カグヤ中継基地', en: 'KAGUYA', alt: 2000e3, phase: 40, size: 1.2, kind: 'relay' },
  { id: 'amaterasu', name: 'アマテラス静止港', en: 'AMATERASU GEO', alt: 35786e3, phase: 120, size: 1.6, kind: 'hub' },
  { id: 'tsukuyomi', name: 'ツクヨミ・ドック（修理基地）', en: 'TSUKUYOMI DOCK', alt: 260000e3, phase: 200, size: 2.2, kind: 'dock' },
];

function stationModel(def, M) {
  const b = new Builder();
  const R = rng(def.id.length * 97 + 13);
  const s = def.size;
  // core modules along Z
  const n = 3 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) {
    const L = 7 + R() * 5;
    b.cyl(2.1 * s, 2.1 * s, L * s, i % 2 ? 'hull' : 'hullDark', [0, 0, (i - n / 2) * 9 * s], [Math.PI / 2, 0, 0], 28);
    b.torus(2.12 * s, 0.12 * s, 'metal', [0, 0, (i - n / 2) * 9 * s + L * s / 2], [0, 0, 0], 28);
  }
  // truss
  const tl = n * 9 * s + 20;
  b.box(1.2 * s, 1.2 * s, tl, 'metalDark', [0, 4 * s, -2], null, 0.05);
  for (let k = -3; k <= 3; k++) b.box(30 * s, 0.4 * s, 0.4 * s, 'metal', [0, 4 * s, k * 6 * s], null, 0.02);
  // solar wings
  for (const side of [-1, 1]) for (let k = -2; k <= 2; k += 2) {
    b.box(12 * s, 0.1, 4.5 * s, 'solar', [side * 22 * s, 4 * s, k * 6 * s], null, 0.01);
    b.box(12 * s, 0.12, 0.15, 'metal', [side * 22 * s, 4 * s, k * 6 * s], null, 0.01);
  }
  // rotating habitat ring for hubs / dock
  let ring = null;
  if (def.kind !== 'relay') {
    const rb = new Builder();
    rb.torus(14 * s, 1.6 * s, 'hull', [0, 0, 0], [0, 0, 0], 64);
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; rb.box(0.5 * s, 14 * s, 0.5 * s, 'metalDark', [Math.cos(a) * 7 * s, Math.sin(a) * 7 * s, 0], [0, 0, a - Math.PI / 2], 0.05); }
    ring = rb.build(M);
    ring.position.set(0, 0, -n * 4.5 * s);
  }
  // docking port with lights
  b.cyl(1.4 * s, 1.4 * s, 2.5 * s, 'hullOrange', [0, 0, n * 4.5 * s + 4], [Math.PI / 2, 0, 0], 24);
  b.sphere(0.25 * s, 'navWhite', [0, 1.6 * s, n * 4.5 * s + 5], 8);
  b.sphere(0.25 * s, 'navRed', [-1.6 * s, 0, n * 4.5 * s + 5], 8);
  b.sphere(0.25 * s, 'navGreen', [1.6 * s, 0, n * 4.5 * s + 5], 8);
  // dock: big repair bay frame
  if (def.kind === 'dock') {
    for (let k = 0; k < 5; k++) b.box(26, 1.2, 1.2, 'plasticY', [0, -12, -20 + k * 10], null, 0.1);
    b.box(1.2, 24, 50, 'metalDark', [-13, 0, 0], null, 0.1);
    b.box(1.2, 24, 50, 'metalDark', [13, 0, 0], null, 0.1);
  }
  const g = b.build(M, { castShadow: false });
  if (ring) g.add(ring);
  g.userData.ring = ring;
  g.userData.portOffset = new THREE.Vector3(0, 0, n * 4.5 * s + 6);
  return g;
}

function relayModel(M) {
  const b = new Builder();
  b.box(1.6, 1.6, 2.4, 'mli', [0, 0, 0], null, 0.08);
  b.box(6, 0.06, 1.6, 'solar', [-4.2, 0, 0], null, 0.01);
  b.box(6, 0.06, 1.6, 'solar', [4.2, 0, 0], null, 0.01);
  b.box(1.1, 1.1, 0.12, 'hullDark', [0, 0, -1.3], null, 0.02); // 5G panel array
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) b.box(0.28, 0.28, 0.04, 'metal', [-0.35 + i * 0.35, -0.35 + j * 0.35, -1.38], null, 0.01);
  b.cyl(0.03, 0.03, 1.4, 'metal', [0, 1.4, 0], null, 6);
  return b;
}

export class Stations {
  constructor(engine, shipM, startTime) {
    this.ref = referenceFrame(startTime);
    this.scene = engine.scene;
    // plain copies of the ship materials (no ship-space dents / window cut-outs)
    const M = {};
    for (const [k, m] of Object.entries(shipM)) M[k] = m.userData && m.userData.shipPatched ? m.clone() : m;
    this.M = M;
    this.list = STATION_DEFS.map((d) => {
      const r = R_EARTH + d.alt;
      return { ...d, r, n: Math.sqrt(MU_EARTH / (r * r * r)), phi0: d.phase * Math.PI / 180, pos: new THREE.Vector3(), vel: new THREE.Vector3(), model: null };
    });
    for (const s of this.list) {
      s.model = stationModel(s, M);
      s.model.matrixAutoUpdate = false;
      s.model.visible = false;
      setLayersDeep(s.model, LAYER_MID);
      this.scene.add(s.model);
    }
    // relay network (5G base stations)
    this.relays = [];
    const shells = [[420e3, 1.6, 0], [395e3, 3, 0.3], [455e3, 3, -0.4], [520e3, 3, 0.8], [640e3, 4, -1.1], [800e3, 5, 1.6], [1100e3, 6, -2.2], [1600e3, 8, 2.8], [3000e3, 10, 0], [8000e3, 15, 0], [20200e3, 20, 0], [35786e3, 18, 0], [100000e3, 30, 0], [200000e3, 45, 0], [380000e3, 60, 0]];
    let seed = 1;
    for (const [alt, spacing, incl] of shells) {
      const r = R_EARTH + alt;
      const n = Math.sqrt(MU_EARTH / (r * r * r));
      const cnt = Math.floor(360 / spacing);
      for (let k = 0; k < cnt; k++) {
        seed = (seed * 16807) % 2147483647;
        this.relays.push({ r, n, phi0: (k * spacing + (seed % 1000) / 1000 * spacing * 0.3) * Math.PI / 180, incl: incl * Math.PI / 180, blink: (seed % 997) / 997, pos: new THREE.Vector3() });
      }
    }
    // far lights: points
    const N = this.relays.length;
    const pg = new THREE.BufferGeometry();
    this.relayPos = new Float32Array(N * 3);
    this.relayPh = new Float32Array(N);
    this.relays.forEach((r, i) => { this.relayPh[i] = r.blink; });
    pg.setAttribute('position', new THREE.BufferAttribute(this.relayPos, 3));
    pg.setAttribute('phase', new THREE.BufferAttribute(this.relayPh, 1));
    this.lightsMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
      vertexShader: /* glsl */`
        attribute float phase; uniform float uTime; uniform float uScale; varying float vB; varying float vRed;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = length(mv.xyz);
          float blink = step(0.86, fract(uTime * 0.5 + phase));
          vRed = step(0.5, fract(phase * 7.0));
          vB = (0.25 + 2.5 * blink) * clamp(3.0e5 / d, 0.05, 1.0);
          gl_PointSize = (1.5 + 2.5 * blink) * uScale;
        }`,
      fragmentShader: /* glsl */`
        varying float vB; varying float vRed;
        void main(){
          vec2 p = gl_PointCoord * 2.0 - 1.0; float g = exp(-dot(p,p) * 3.0);
          vec3 c = mix(vec3(0.75, 0.9, 1.0), vec3(1.0, 0.25, 0.15), vRed);
          gl_FragColor = vec4(c * vB * g * 4.0, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.lights = new THREE.Points(pg, this.lightsMat);
    this.lights.frustumCulled = false;
    this.lights.matrixAutoUpdate = false;
    this.lights.layers.set(LAYER_FAR);
    this.lights.layers.enable(LAYER_MID);
    this.scene.add(this.lights);
    // near relay models (instanced)
    const rb = relayModel(M);
    const rg = rb.build(M, { castShadow: false });
    this.relayInst = [];
    rg.children.forEach((mesh) => {
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, 24);
      im.count = 0;
      im.frustumCulled = false;
      im.layers.set(LAYER_MID); im.layers.enable(LAYER_NEAR);
      this.scene.add(im);
      this.relayInst.push(im);
    });
    this._m = new THREE.Matrix4();
  }

  /** ECI position/velocity of a body on a circular reference orbit */
  orbitPos(r, n, phi0, incl, t, out, vout) {
    const { e1, e2, h, t0 } = this.ref;
    const phi = phi0 + n * (t - t0) / 1000;
    const c = Math.cos(phi), s = Math.sin(phi);
    // inclined plane: rotate e2 about e1 by incl
    const ci = Math.cos(incl), si = Math.sin(incl);
    const e2x = e2.x * ci + h.x * si, e2y = e2.y * ci + h.y * si, e2z = e2.z * ci + h.z * si;
    out.set((e1.x * c + e2x * s) * r, (e1.y * c + e2y * s) * r, (e1.z * c + e2z * s) * r);
    if (vout) vout.set((-e1.x * s + e2x * c) * r * n, (-e1.y * s + e2y * c) * r * n, (-e1.z * s + e2z * c) * r * n);
    return out;
  }

  update(t, origin, camWorld, dt) {
    const camEci = camWorld.clone().add(origin);
    for (const s of this.list) {
      this.orbitPos(s.r, s.n, s.phi0, 0, t, s.pos, s.vel);
      const rel = s.pos.clone().sub(origin);
      const d = rel.distanceTo(camWorld);
      s.dist = s.pos.distanceTo(origin);
      const vis = d < 4.0e5;
      s.model.visible = vis;
      if (vis) {
        // orient: long axis along velocity, up radial
        const up = s.pos.clone().normalize();
        const z = s.vel.clone().normalize().negate();
        const x = new THREE.Vector3().crossVectors(up, z).normalize();
        s.model.matrix.makeBasis(x, up, z).setPosition(rel);
        s.model.matrixWorld.copy(s.model.matrix);
        const ring = s.model.userData.ring;
        if (ring) { ring.rotation.z += dt * 0.12; ring.updateMatrix(); }
        s.model.updateMatrixWorld(true);
        const R = 70 * s.size;
        s.model.traverse((o) => { if (o.isMesh) assignLayers(o, Math.max(0, d - R), d + R); });
      }
    }
    // relays
    let k = 0;
    const near = [];
    const p = new THREE.Vector3();
    const camR = camEci.length();
    for (let i = 0; i < this.relays.length; i++) {
      const r = this.relays[i];
      this.orbitPos(r.r, r.n, r.phi0, r.incl, t, p);
      r.pos.copy(p);
      const rel = p.sub(origin);
      // hide those behind the Earth
      this.relayPos[k * 3] = rel.x; this.relayPos[k * 3 + 1] = rel.y; this.relayPos[k * 3 + 2] = rel.z;
      const d = rel.distanceTo(camWorld);
      if (d < 3.0e4) near.push({ rel: rel.clone(), d, r });
      k++;
    }
    this.lights.geometry.attributes.position.needsUpdate = true;
    this.lightsMat.uniforms.uTime.value = (t / 1000) % 10000;
    this.nearRelays = near;
    // instanced models for the closest relays
    near.sort((a, b) => a.d - b.d);
    const cnt = Math.min(24, near.length);
    for (const im of this.relayInst) im.count = cnt;
    for (let i = 0; i < cnt; i++) {
      const n = near[i];
      const up = n.r.pos.clone().normalize();
      this._m.lookAt(new THREE.Vector3(), up, new THREE.Vector3(0, 1, 0));
      this._m.setPosition(n.rel);
      for (const im of this.relayInst) im.setMatrixAt(i, this._m);
    }
    for (const im of this.relayInst) im.instanceMatrix.needsUpdate = true;
  }

  byId(id) { return this.list.find((s) => s.id === id); }

  /** nearest relay distance (for 5G signal) */
  nearestRelay(shipPos) {
    let best = Infinity;
    for (const r of this.relays) { const d = r.pos.distanceTo(shipPos); if (d < best) best = d; }
    return best;
  }
}
