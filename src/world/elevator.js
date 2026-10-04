// Space elevator "Ame-no-Mihashira": a ribbon anchored to an ocean platform on the equator
// (0°, 146.5°E) reaching past geostationary orbit to a counterweight at 96,000 km. It turns with
// the Earth. The ribbon is drawn as a screen-space line (bright where sunlit, so it shows as a thin
// thread rising from the horizon), climbers crawl up and down it, red beacons blink along it, and
// the anchor platform, climbers and counterweight are 3D models when close.
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { R_EARTH, gmst, latLonToUnit, ecefToEci } from '../core/astro.js';
import { Builder } from '../ship/geom.js';
import { assignLayers, LAYER_FAR, LAYER_MID, LAYER_NEAR } from '../core/layers.js';

export const ELEVATOR = { lat: 0, lon: 146.5 * Math.PI / 180, top: 96000e3, geo: 35786e3, climberSpeed: 55 };

/** unit vector (ECI) of the elevator axis at time t (ms) */
export function elevatorAxis(t, out = new THREE.Vector3()) {
  return ecefToEci(latLonToUnit(ELEVATOR.lat, ELEVATOR.lon), gmst(t), out).normalize();
}

function anchorModel(M) {
  const b = new Builder();
  // hexagonal floating platform, 170 m across, with the tether tower in the middle
  const hex = new THREE.Shape();
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; const x = Math.cos(a) * 85, z = Math.sin(a) * 85; if (k === 0) hex.moveTo(x, z); else hex.lineTo(x, z); }
  hex.closePath();
  const deck = new THREE.ExtrudeGeometry(hex, { depth: 6, bevelEnabled: false });
  deck.rotateX(-Math.PI / 2);
  b.add(deck, 'hullDark', [0, -2, 0]);
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + Math.PI / 6; b.cyl(9, 11, 14, 'hull', [Math.cos(a) * 62, -8, Math.sin(a) * 62], null, 24); }
  b.cyl(14, 22, 60, 'hull', [0, 30, 0], null, 32);
  b.cyl(10, 14, 30, 'hullDark', [0, 75, 0], null, 32);
  b.torus(16, 1.2, 'plasticY', [0, 62, 0], [Math.PI / 2, 0, 0], 48);
  for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2; b.box(26, 22, 18, 'hull', [Math.cos(a) * 45, 11, Math.sin(a) * 45], [0, -a, 0], 1.5); }
  for (let k = 0; k < 40; k++) { const a = k / 40 * Math.PI * 2; b.box(1.6, 1.0, 0.4, 'windowLit', [Math.cos(a) * 22.3, 30 + (k % 2) * 8, Math.sin(a) * 22.3], [0, -a + Math.PI / 2, 0], 0.1); }
  b.cyl(14, 14, 0.4, 'plasticY', [55, 4.2, 0], null, 32);
  for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; b.sphere(0.9, 'navR', [Math.cos(a) * 84, 4.6, Math.sin(a) * 84], 8); }
  b.sphere(1.6, 'strobe', [0, 92, 0], 10);
  return b.build(M, { castShadow: false });
}

function counterweightModel(M) {
  const b = new Builder();
  // captured rock as the ballast mass + a small station clamped to it
  const rock = new THREE.IcosahedronGeometry(160, 4);
  const p = rock.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 0.021) * Math.sin(v.y * 0.017 + 1.3) * Math.sin(v.z * 0.019 + 0.7);
    v.multiplyScalar(1 + 0.18 * n + 0.06 * Math.sin(v.x * 0.07 + v.z * 0.05));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  rock.computeVertexNormals();
  b.add(rock, 'metalDark');
  b.cyl(18, 18, 70, 'hull', [0, -190, 0], null, 32);
  for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2; b.box(8, 60, 90, 'solarPanel', [Math.cos(a) * 60, -200, Math.sin(a) * 60], [0, -a, 0], 0); }
  b.sphere(2, 'strobe', [0, -230, 0], 10);
  return b.build(M, { castShadow: false });
}

function climberModel(M) {
  const g = new THREE.Group();
  const b = new Builder();
  // cabin around the ribbon (local +y = up the tether), window ring, drive housings, power receiver
  b.cyl(3.1, 3.1, 4.4, 'hull', [0, 0, 0], null, 36, true);
  b.sphere(3.1, 'hull', [0, 2.2, 0], 36, [1, 0.42, 1]);
  b.sphere(3.1, 'hull', [0, -2.2, 0], 36, [1, 0.42, 1]);
  for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; b.box(0.7, 0.9, 0.2, 'windowLit', [Math.cos(a) * 3.12, 0.5, Math.sin(a) * 3.12], [0, -a + Math.PI / 2, 0], 0.05); }
  for (const y of [3.6, -3.6]) { b.box(2.2, 1.6, 2.2, 'hullDark', [0, y, 0], null, 0.2); b.torus(1.5, 0.12, 'gold', [0, y, 0], [Math.PI / 2, 0, 0], 24); }
  const pts = [];
  for (let i = 0; i <= 10; i++) { const x = 5 * i / 10; pts.push(new THREE.Vector2(Math.max(0.01, x), -(x * x) / 10)); }
  b.push([0, -4.8, 0], [Math.PI, 0, 0]);
  b.add(new THREE.LatheGeometry(pts, 32), 'dish');
  b.pop();
  b.sphere(0.4, 'strobe', [0, 4.7, 0], 8);
  g.add(b.build(M, { castShadow: false }));
  // drive rollers pinching the ribbon (spin while climbing)
  const rollers = [];
  for (const y of [3.6, -3.6]) for (const s of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.2, 20), M.steel);
    r.rotation.z = Math.PI / 2;
    r.position.set(0, y, s * 0.6);
    const hub = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.15, 0.15), M.plasticR);
    r.add(hub);
    g.add(r);
    rollers.push({ m: r, s });
  }
  g.userData.rollers = rollers;
  return g;
}

export class SpaceElevator {
  constructor(engine, M) {
    this.engine = engine;
    this.scene = engine.scene;
    this.M = M;
    // ribbon samples: exponential spacing (fine near the ground, coarse in deep space)
    const N = 380;
    this.N = N;
    this.h = new Float64Array(N + 1);
    for (let k = 0; k <= N; k++) this.h[k] = k === 0 ? 0 : 25 * Math.pow(ELEVATOR.top / 25, k / N);
    this.seg = new Float32Array(N * 6);
    this.col = new Float32Array(N * 6);
    const geo = new LineSegmentsGeometry();
    geo.setPositions(this.seg);
    geo.setColors(this.col);
    this.segAttr = geo.attributes.instanceStart.data;
    this.colAttr = geo.attributes.instanceColorStart.data;
    this.lineMat = new LineMaterial({ color: 0xffffff, linewidth: 1.7, vertexColors: true, worldUnits: false });
    this.line = new LineSegments2(geo, this.lineMat);
    this.line.frustumCulled = false;
    this.line.matrixAutoUpdate = false;
    this.line.layers.set(LAYER_FAR); this.line.layers.enable(LAYER_MID); this.line.layers.enable(LAYER_NEAR);
    this.scene.add(this.line);
    // climbers + beacons as light points
    this.climbers = [];
    for (let i = 0; i < 6; i++) this.climbers.push({ phase: i / 6 + 0.037 * i, h: 0, up: true });
    this.beaconH = [];
    for (let h = 2000e3; h < ELEVATOR.top; h *= 1.55) this.beaconH.push(h);
    for (const h of [100e3, 400e3, 1000e3]) this.beaconH.push(h);
    const NP = this.climbers.length + this.beaconH.length;
    this.ptPos = new Float32Array(NP * 3);
    const kind = new Float32Array(NP);
    for (let i = 0; i < this.climbers.length; i++) kind[i] = 0; // climber: warm steady
    for (let j = 0; j < this.beaconH.length; j++) kind[this.climbers.length + j] = 1 + (j % 5) * 0.13; // beacon: red blink
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.ptPos, 3));
    pg.setAttribute('kind', new THREE.BufferAttribute(kind, 1));
    this.ptMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
      vertexShader: /* glsl */`
        attribute float kind; uniform float uTime; uniform float uScale; varying vec3 vC; varying float vA;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = length(mv.xyz);
          float beacon = step(0.5, kind);
          float blink = beacon > 0.5 ? step(0.82, fract(uTime * 0.7 + kind * 3.0)) : 1.0;
          vC = beacon > 0.5 ? vec3(1.0, 0.12, 0.06) : vec3(1.0, 0.85, 0.6);
          vA = blink * clamp(3.0e6 / d, 0.2, 1.0) * smoothstep(400.0, 2500.0, d);
          gl_PointSize = (beacon > 0.5 ? 2.0 + 3.0 * blink : 3.2) * uScale;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC; varying float vA;
        void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float g = exp(-dot(p, p) * 3.0); gl_FragColor = vec4(vC * vA * g * 5.0, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(pg, this.ptMat);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
    this.points.layers.set(LAYER_FAR); this.points.layers.enable(LAYER_MID);
    this.scene.add(this.points);
    // near models
    this.anchor = anchorModel(M);
    this.counter = counterweightModel(M);
    this.climber = climberModel(M);
    for (const o of [this.anchor, this.counter, this.climber]) { o.matrixAutoUpdate = false; o.visible = false; this.scene.add(o); }
    this.axis = new THREE.Vector3();
    this._t = 0;
    this._shadowT = 0;
  }

  /** ECI position of a point h metres above the anchor */
  pointAt(h, t, out = new THREE.Vector3()) {
    return elevatorAxis(t, out).multiplyScalar(R_EARTH + h);
  }

  update(t, origin, camWorld, sunDir, dt) {
    const ax = elevatorAxis(t, this.axis);
    const camEci = camWorld.clone().add(origin);
    // ribbon geometry relative to the floating origin
    const N = this.N, h = this.h, seg = this.seg;
    const D = this.dmg, st = D ? D.status : 'ok';
    const gap = D && D.destroyed ? [D.breakH * 0.985, D.breakH * 1.015] : null;   // severed ribbon
    for (let k = 0; k < N; k++) {
      let r0 = R_EARTH + h[k], r1 = R_EARTH + h[k + 1];
      if (gap && h[k + 1] > gap[0] && h[k] < gap[1]) r1 = r0;
      seg[k * 6] = ax.x * r0 - origin.x; seg[k * 6 + 1] = ax.y * r0 - origin.y; seg[k * 6 + 2] = ax.z * r0 - origin.z;
      seg[k * 6 + 3] = ax.x * r1 - origin.x; seg[k * 6 + 4] = ax.y * r1 - origin.y; seg[k * 6 + 5] = ax.z * r1 - origin.z;
    }
    this.segAttr.needsUpdate = true;
    // sunlit / shadowed shading (Earth's shadow cylinder), refreshed a few times a second
    this._shadowT -= dt;
    if (this._shadowT <= 0) {
      this._shadowT = 0.25;
      const col = this.col;
      const sd = ax.dot(sunDir);
      const perp = Math.sqrt(Math.max(0, 1 - sd * sd));
      // glint: brighter when the sun is low against the ribbon (grazing reflection toward the viewer)
      const view = camEci.clone().normalize();
      const glint = 0.6 + 0.8 * Math.pow(Math.max(0, 1 - Math.abs(view.dot(ax))), 2);
      for (let k = 0; k <= N; k++) {
        const r = R_EARTH + h[k];
        const lit = !(sd * r < 0 && perp * r < R_EARTH);
        const b = (lit ? 1.6 * glint : 0.05) * (gap && h[k] > gap[0] ? 0.3 : 1);
        const c0 = k < N ? k * 6 : -1, c1 = k > 0 ? (k - 1) * 6 + 3 : -1;
        for (const c of [c0, c1]) if (c >= 0) { col[c] = b * 0.92; col[c + 1] = b * 0.95; col[c + 2] = b; }
      }
      this.colAttr.needsUpdate = true;
    }
    const size = this.engine.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.lineMat.resolution.set(size.x, size.y);
    // climbers move up to GEO and back down; beacons blink along the ribbon
    // the climbers run on their own clock: slower when the elevator is damaged, stopped when it fails
    const sp = st === 'ok' ? 1 : st === 'damaged' ? 0.5 : st === 'critical' ? 0.12 : 0;
    if (this.clock === undefined) this.clock = t;
    this.clock += (t - (this.lastT ?? t)) * sp;
    this.lastT = t;
    const sec = this.clock / 1000;
    const H = ELEVATOR.geo;
    let nearest = null;
    for (let i = 0; i < this.climbers.length; i++) {
      const c = this.climbers[i];
      const u = (sec * ELEVATOR.climberSpeed / (2 * H) + c.phase) % 1;
      c.up = u < 0.5;
      c.h = H * (c.up ? 2 * u : 2 - 2 * u);
      const p = ax.clone().multiplyScalar(R_EARTH + c.h).sub(origin);
      if (st === 'destroyed') p.set(1e15, 0, 0);
      this.ptPos.set([p.x, p.y, p.z], i * 3);
      const d = p.distanceTo(camWorld);
      if (!nearest || d < nearest.d) nearest = { d, p, c };
    }
    for (let j = 0; j < this.beaconH.length; j++) {
      const p = ax.clone().multiplyScalar(R_EARTH + this.beaconH[j]).sub(origin);
      if (st === 'failed' || (gap && this.beaconH[j] > gap[0])) p.set(1e15, 0, 0);
      this.ptPos.set([p.x, p.y, p.z], (this.climbers.length + j) * 3);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    // warning: beacons blink fast while the elevator is in trouble
    this.ptMat.uniforms.uTime.value = (t / 1000 * (st === 'damaged' || st === 'critical' ? 4 : 1)) % 10000;
    this.ptMat.uniforms.uScale.value = this.engine.renderer.getPixelRatio();
    // 3D models when close
    const basis = (o, pos) => {
      const up = ax;
      const ref = Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const x = new THREE.Vector3().crossVectors(ref, up).normalize();
      const z = new THREE.Vector3().crossVectors(x, up).normalize();
      o.matrix.makeBasis(x, up, z).setPosition(pos);
      o.matrixWorld.copy(o.matrix);
      o.updateMatrixWorld(true);
    };
    const place = (o, pos, R, maxD) => {
      const d = pos.distanceTo(camWorld);
      o.visible = d < maxD;
      if (!o.visible) return;
      basis(o, pos);
      o.traverse((m) => { if (m.isMesh) assignLayers(m, Math.max(0, d - R), d + R); });
    };
    place(this.anchor, ax.clone().multiplyScalar(R_EARTH).sub(origin), 120, 3.5e5);
    place(this.counter, ax.clone().multiplyScalar(R_EARTH + ELEVATOR.top).sub(origin), 260, 6e5);
    if (nearest && st !== 'destroyed') {
      place(this.climber, nearest.p, 8, 4e4);
      if (this.climber.visible) for (const r of this.climber.userData.rollers) r.m.rotation.x += dt * (nearest.c.up ? 1 : -1) * r.s * 100 * sp;
    } else this.climber.visible = false;
  }
}
