// Orbital infrastructure: named stations (autopilot destinations, one repair dock) and a
// network of 5G relay base stations on circular orbits, rendered as 3D models up close and
// blinking lights far away.
import * as THREE from 'three';
import { MU_EARTH, R_EARTH, OMEGA_EARTH, gmst, latLonToUnit, ecefToEci } from '../core/astro.js';
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
  // Shirasagi is the orbital port B-29 just left: same orbit, a few kilometres ahead at the start
  { id: 'shirasagi', name: 'シラサギ・ステーション', en: 'SHIRASAGI', alt: 420e3, phase: 0.011, size: 1.0, kind: 'hub' },
  { id: 'nagi', name: 'ナギ中継局', en: 'NAGI RELAY', alt: 515e3, phase: -9, size: 0.7, kind: 'relay' },
  { id: 'kaguya', name: 'カグヤ中継基地', en: 'KAGUYA', alt: 2000e3, phase: 40, size: 1.2, kind: 'relay' },
  // the geostationary port hangs on the space elevator's ribbon (turns with the Earth)
  { id: 'amaterasu', name: 'アマテラス静止港', en: 'AMATERASU GEO', alt: 35786e3, phase: 0, size: 1.6, kind: 'hub', geoLon: 146.5 },
  { id: 'tsukuyomi', name: 'ツクヨミ・ドック（修理基地）', en: 'TSUKUYOMI DOCK', alt: 260000e3, phase: 200, size: 2.2, kind: 'dock' },
];

// ---------------------------------------------------------------------------- station models
function solarTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#0d1a3a'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
    const gr = g.createLinearGradient(x * 64, y * 32, x * 64 + 64, y * 32 + 32);
    gr.addColorStop(0, '#1a2f63'); gr.addColorStop(1, '#0e1d45');
    g.fillStyle = gr; g.fillRect(x * 64 + 2, y * 32 + 2, 60, 28);
  }
  g.strokeStyle = 'rgba(200,210,230,0.55)'; g.lineWidth = 1;
  for (let i = 0; i <= 256; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function stationMaterials() {
  const solar = solarTexture();
  solar.repeat.set(3, 10);
  return {
    solarPanel: new THREE.MeshStandardMaterial({ map: solar, roughness: 0.3, metalness: 0.6, color: 0xffffff }),
    windowLit: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(1.0, 0.8, 0.52), emissiveIntensity: 4.0, roughness: 0.3 }),
    strobe: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 }),
    navR: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 0.08, 0.04), emissiveIntensity: 6 }),
    navG: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.1, 1, 0.25), emissiveIntensity: 6 }),
    flood: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.95, 0.97, 1), emissiveIntensity: 5 }),
    dish: new THREE.MeshStandardMaterial({ color: 0xeceee8, roughness: 0.55, metalness: 0.1 }),
    radiatorPanel: new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.42, metalness: 0.05 }),
  };
}

/** square lattice truss along local z (length L, width w), centred at the builder origin */
function truss(b, L, w, t = 0.25, key = 'metal', keyD = 'metalDark') {
  const bays = Math.max(1, Math.round(L / w));
  const bl = L / bays;
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(t, t, L, key, [x * w / 2, y * w / 2, 0], null, 0);
  for (let k = 0; k <= bays; k++) {
    const z = -L / 2 + k * bl;
    b.box(w, t * 0.8, t * 0.8, keyD, [0, w / 2, z], null, 0); b.box(w, t * 0.8, t * 0.8, keyD, [0, -w / 2, z], null, 0);
    b.box(t * 0.8, w, t * 0.8, keyD, [w / 2, 0, z], null, 0); b.box(t * 0.8, w, t * 0.8, keyD, [-w / 2, 0, z], null, 0);
  }
  const dl = Math.hypot(w, bl), ang = Math.atan2(w, bl);
  for (let k = 0; k < bays; k++) {
    const z = -L / 2 + (k + 0.5) * bl, sg = k % 2 ? 1 : -1;
    b.box(t * 0.6, t * 0.6, dl, keyD, [0, w / 2, z], [0, sg * ang, 0], 0);
    b.box(t * 0.6, t * 0.6, dl, keyD, [0, -w / 2, z], [0, -sg * ang, 0], 0);
    b.box(t * 0.6, t * 0.6, dl, keyD, [w / 2, 0, z], [sg * ang, 0, 0], 0);
    b.box(t * 0.6, t * 0.6, dl, keyD, [-w / 2, 0, z], [-sg * ang, 0, 0], 0);
  }
}

/** pressurised module along local z: cylinder with domed ends, insulation bands and lit windows */
function module(b, r, L, key = 'hull', windows = 8) {
  b.cyl(r, r, L, key, [0, 0, 0], [Math.PI / 2, 0, 0], 36);
  b.sphere(r, key, [0, 0, -L / 2], 36, [1, 1, 0.45]);
  b.sphere(r, key, [0, 0, L / 2], 36, [1, 1, 0.45]);
  for (const z of [-L / 2 + 0.6, L / 2 - 0.6]) b.torus(r + 0.04, 0.12, 'gold', [0, 0, z], [0, 0, 0], 36);
  for (let k = 0; k < windows; k++) {
    const z = -L / 2 + 1.5 + (L - 3) * ((k + 0.5) / windows);
    for (const a of [Math.PI * 0.32, Math.PI * 0.68]) b.box(0.55, 0.12, 0.38, 'windowLit', [Math.cos(a) * (r + 0.02), Math.sin(a) * (r + 0.02), z], [0, 0, a - Math.PI / 2], 0.02);
  }
}

function solarWing(b, len, wid, side) {
  b.cyl(0.35, 0.35, 6, 'metal', [side * 3, 0, 0], [0, 0, Math.PI / 2], 10);
  b.box(len, 0.12, wid, 'solarPanel', [side * (6 + len / 2), 0, 0], null, 0);
  b.box(len, 0.2, 0.25, 'metalDark', [side * (6 + len / 2), 0, 0], null, 0);
  for (let k = 0; k <= 4; k++) b.box(0.18, 0.18, wid, 'metalDark', [side * (6 + len * k / 4), 0, 0], null, 0);
}

function dish(b, r, pos, rot) {
  const pts = [];
  for (let i = 0; i <= 12; i++) { const x = r * i / 12; pts.push(new THREE.Vector2(Math.max(0.001, x), (x * x) / (4 * r * 0.6))); }
  b.push(pos, rot);
  b.add(new THREE.LatheGeometry(pts, 32), 'dish');
  b.cyl(0.08, 0.08, r * 0.7, 'metal', [0, r * 0.35, 0], null, 8);
  b.sphere(0.25, 'metalDark', [0, r * 0.7, 0], 10);
  b.pop();
}

function stationModel(def, M) {
  const b = new Builder();
  const s = def.size;
  const strobes = [];
  b.push([0, 0, 0], [0, 0, 0], [s, s, s]);
  const hub = def.kind !== 'relay';
  const spineL = hub ? 150 : 80;
  // spine truss through everything
  truss(b, spineL, 4.2, 0.28);
  // core module cluster around the middle
  b.push([0, 0, 4]); module(b, 3.4, 26, 'hull', 10); b.pop();
  for (const [ax, ay, k] of [[1, 0, 'hull'], [-1, 0, 'hullDark'], [0, 1, 'hull'], [0, -1, 'hull']]) {
    const rot = ax ? [0, ax * Math.PI / 2, 0] : [ay > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0];
    b.push([ax * 10.5, ay * 10.5, 6], rot);
    module(b, 2.4, 13, k, 5);
    b.cyl(1.25, 1.25, 2.2, 'hullOrange', [0, 0, 7.6], [Math.PI / 2, 0, 0], 24);
    b.torus(1.3, 0.1, 'navR', [0, 0, 8.7], [0, 0, 0], 24);
    b.pop();
  }
  b.sphere(3.6, 'hull', [0, 0, -12], 32);
  b.sphere(3.0, 'hullDark', [0, 0, 20], 32);
  // radiators and antennas
  for (const sy of [-1, 1]) b.box(0.22, 24, 8, 'radiatorPanel', [0, sy * 16, 26], null, 0);
  for (const sy of [-1, 1]) b.box(0.6, 6, 0.6, 'metal', [0, sy * 4, 26], null, 0);
  dish(b, 4.2, [7, 6, 40], [0, 0, -0.6]);
  dish(b, 2.6, [-6, 5, 44], [0.3, 0, 0.7]);
  // 5G relay array (this network is what the whole station is about)
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2;
    b.box(3.2, 4.4, 0.25, 'hullDark', [Math.cos(a) * 6.5, Math.sin(a) * 6.5, spineL / 2 - 6], [0, 0, a + Math.PI / 2], 0.05);
  }
  // solar wings at both ends of the spine
  for (const z of [spineL / 2 - 16, -spineL / 2 + 14]) for (const side of [-1, 1]) { b.push([0, 0, z]); solarWing(b, hub ? 44 : 26, hub ? 12 : 9, side); b.pop(); }
  // a docked shuttle on the top port
  b.cyl(1.6, 1.6, 7, 'hull', [0, 22.6, 6], null, 24);
  b.cyl(0.45, 1.6, 2.4, 'hull', [0, 27.3, 6], null, 24);
  b.box(7.5, 2.2, 0.15, 'solarPanel', [0, 22.6, 6], null, 0);
  b.sphere(0.25, 'navG', [3.75, 22.6, 6], 8);
  b.sphere(0.25, 'navR', [-3.75, 22.6, 6], 8);
  // floodlights around the docking face and strobes at the extremities
  for (const [x, y] of [[3, 3], [-3, 3], [3, -3], [-3, -3]]) b.cyl(0.35, 0.35, 0.1, 'flood', [x, y, spineL / 2 + 0.1], [Math.PI / 2, 0, 0], 12);
  for (const z of [spineL / 2, -spineL / 2]) for (const [x, y] of [[2.1, 2.1], [-2.1, -2.1]]) { b.sphere(0.45, 'strobe', [x, y, z], 10); strobes.push([x * s, y * s, z * s]); }
  b.sphere(0.4, 'navR', [-2.1, 2.1, spineL / 2], 10);
  b.sphere(0.4, 'navG', [2.1, -2.1, spineL / 2], 10);
  // repair dock: an open gantry frame big enough to swallow a ship
  if (def.kind === 'dock') {
    b.push([0, -22, 10]);
    for (let k = 0; k < 6; k++) b.box(30, 1.4, 1.4, 'plasticY', [0, -8, -25 + k * 10], null, 0.1);
    for (const x of [-15, 15]) b.box(1.4, 18, 52, 'metalDark', [x, 0, 0], null, 0.1);
    for (const x of [-14, 14]) for (let k = 0; k < 5; k++) b.cyl(0.4, 0.4, 0.15, 'flood', [x * 0.95, 6, -20 + k * 10], [0, 0, Math.PI / 2], 10);
    b.pop();
  }
  b.pop();
  const g = b.build(M, { castShadow: false });
  // rotating habitat ring (hubs and the dock)
  let ring = null;
  if (hub) {
    const rb = new Builder();
    rb.push([0, 0, 0], [0, 0, 0], [s, s, s]);
    rb.torus(46, 3.1, 'hull', [0, 0, 0], [0, 0, 0], 96);
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; rb.cyl(0.9, 0.9, 41, 'hullDark', [Math.cos(a) * 24, Math.sin(a) * 24, 0], [0, 0, a - Math.PI / 2], 12); }
    rb.cyl(4.6, 4.6, 7, 'hull', [0, 0, 0], [Math.PI / 2, 0, 0], 32);
    for (let k = 0; k < 120; k++) {
      const a = k / 120 * Math.PI * 2;
      rb.box(0.5, 1.2, 0.7, 'windowLit', [Math.cos(a) * 42.85, Math.sin(a) * 42.85, (k % 2 ? 1 : -1) * 0.9], [0, 0, a], 0.05);
    }
    for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.4; rb.sphere(0.5, 'strobe', [Math.cos(a) * 49.3, Math.sin(a) * 49.3, 0], 10); }
    rb.pop();
    ring = rb.build(M, { castShadow: false });
    ring.position.set(0, 0, -36 * s);
    g.add(ring);
  }
  g.userData.ring = ring;
  g.userData.strobes = strobes;
  g.userData.portOffset = new THREE.Vector3(0, 0, (spineL / 2 + 8) * s);
  g.userData.radius = (hub ? 95 : 60) * s;
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
    this.SM = stationMaterials();
    Object.assign(M, this.SM);
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
    // station beacons: visible from far away as a strobing white light and a warm window glow,
    // so the stations can be found in the sky long before their structure resolves
    const SN = this.list.length * 2;
    const sg = new THREE.BufferGeometry();
    this.stPos = new Float32Array(SN * 3);
    const stCol = new Float32Array(SN * 3), stKind = new Float32Array(SN);
    for (let i = 0; i < this.list.length; i++) {
      stCol.set([1, 1, 1], i * 6); stKind[i * 2] = 1;
      stCol.set([1, 0.78, 0.5], i * 6 + 3); stKind[i * 2 + 1] = 0;
    }
    sg.setAttribute('position', new THREE.BufferAttribute(this.stPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(stCol, 3));
    sg.setAttribute('kind', new THREE.BufferAttribute(stKind, 1));
    this.stLightsMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
      vertexShader: /* glsl */`
        attribute vec3 color; attribute float kind; uniform float uTime; uniform float uScale;
        varying vec3 vC; varying float vA;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = length(mv.xyz);
          float t = fract(uTime / 1.6);
          float flash = kind > 0.5 ? max(step(t, 0.05), step(0.16, t) * step(t, 0.21)) : 1.0;
          float fadeNear = smoothstep(1500.0, 6000.0, d);      // close up the model's own lamps take over
          vA = flash * fadeNear * (kind > 0.5 ? 1.6 : 0.6) * clamp(4.0e6 / d, 0.12, 1.0);
          gl_PointSize = (kind > 0.5 ? 2.0 + 4.0 * flash : 2.4) * uScale * clamp(2.0e5 / d, 0.6, 1.6);
          vC = color;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC; varying float vA;
        void main(){
          vec2 p = gl_PointCoord * 2.0 - 1.0; float g = exp(-dot(p, p) * 3.0);
          gl_FragColor = vec4(vC * vA * g * 5.0, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.stLights = new THREE.Points(sg, this.stLightsMat);
    this.stLights.frustumCulled = false;
    this.stLights.matrixAutoUpdate = false;
    this.stLights.layers.set(LAYER_FAR);
    this.stLights.layers.enable(LAYER_MID);
    this.scene.add(this.stLights);
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

  /** ECI position / velocity of a named station at time t (ms) */
  posOf(s, t, pos, vel) {
    if (s.geoLon !== undefined) {
      ecefToEci(latLonToUnit(0, s.geoLon * Math.PI / 180), gmst(t), pos).normalize().multiplyScalar(s.r);
      if (vel) vel.set(OMEGA_EARTH * pos.z, 0, -OMEGA_EARTH * pos.x);
      return pos;
    }
    return this.orbitPos(s.r, s.n, s.phi0, 0, t, pos, vel);
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
      this.posOf(s, t, s.pos, s.vel);
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
        const R = s.model.userData.radius || 70 * s.size;
        s.model.traverse((o) => { if (o.isMesh) assignLayers(o, Math.max(0, d - R), d + R); });
      }
    }
    // beacons + strobes (double flash every 1.6 s)
    for (let i = 0; i < this.list.length; i++) {
      const rel = this.list[i].pos.clone().sub(origin);
      this.stPos.set([rel.x, rel.y, rel.z], i * 6);
      this.stPos.set([rel.x, rel.y + 3, rel.z], i * 6 + 3);
    }
    this.stLights.geometry.attributes.position.needsUpdate = true;
    const tt = (t / 1000) % 10000;
    this.stLightsMat.uniforms.uTime.value = tt;
    const ph = (tt / 1.6) % 1;
    // (kept moderate: at 40x the strobes of the station next door bloomed over the whole view and
    // the picture flickered every 1.6 s)
    this.SM.strobe.emissiveIntensity = ph < 0.05 || (ph > 0.16 && ph < 0.21) ? 6 : 0;
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

  setPixelScale(pr) {
    this.lightsMat.uniforms.uScale.value = pr;
    this.stLightsMat.uniforms.uScale.value = pr;
  }

  byId(id) { return this.list.find((s) => s.id === id); }

  /** nearest relay distance (for 5G signal) */
  nearestRelay(shipPos) {
    let best = Infinity;
    for (const r of this.relays) { const d = r.pos.distanceTo(shipPos); if (d < best) best = d; }
    return best;
  }
}
