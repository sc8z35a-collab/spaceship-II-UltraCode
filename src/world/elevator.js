// Space elevator "Ame-no-Mihashira": two carbon-nanotube ribbons anchored to an ocean platform on
// the equator (0°, 146.5°E), through the low terminal Mihashira (420 km) and the geostationary port
// Amaterasu, up to a captured rock at 96,000 km. It turns with the Earth.
//  - the ribbons: a glinting thread from afar, real woven ribbons with lights up close
//    (elevatorRibbon.js);
//  - climber traffic on three lines, every climber on its timetable (elevatorTraffic.js), 3D
//    climbers near the camera (elevatorClimber.js), light points far away;
//  - berths with traversers and boarding bridges at every terminal, the anchor platform with its
//    power-beaming domes and the counterweight station (elevatorPort.js);
//  - effects: the climbers' headlights on the ribbon, approach lights chasing toward a berth, the
//    power beam in the air above the anchor, waves along the ribbon, sparks when something hits
//    it, a severed ribbon whipping as the break opens, the terminal's chime and rumble.
import * as THREE from 'three';
import { R_EARTH, gmst, latLonToUnit, ecefToEci } from '../core/astro.js';
import { assignLayers, LAYER_FAR, LAYER_MID, LAYER_NEAR } from '../core/layers.js';
import { ELEVATOR_H } from './elevatorConst.js';
import { Traffic, LANE_X, berthStage } from './elevatorTraffic.js';
import { NearRibbon, FarRibbon, NEAR_R } from './elevatorRibbon.js';
import { ClimberModel } from './elevatorClimber.js';
import { BerthRig, anchorModel, counterweightModel } from './elevatorPort.js';
import { Particles } from '../fx/particles.js';
import { SUN_E } from './space.js';

export const ELEVATOR = { lat: 0, lon: 146.5 * Math.PI / 180, top: ELEVATOR_H.top, geo: ELEVATOR_H.geo, climberSpeed: 70 };
export { ELEVATOR_H };

/** unit vector (ECI) of the elevator axis at time t (ms) */
export function elevatorAxis(t, out = new THREE.Vector3()) {
  return ecefToEci(latLonToUnit(ELEVATOR.lat, ELEVATOR.lon), gmst(t), out).normalize();
}

/** the terminal stations' frame on the axis: ex across the ribbons (south), ax up, ez = west */
export function elevatorBasis(ax, ex, ez) {
  const n = Math.hypot(ax.x, ax.z) || 1;
  ez.set(-ax.z / n, 0, ax.x / n);
  ex.crossVectors(ax, ez).normalize();
  return ex;
}

const smooth = (a, b, x) => { const q = Math.min(1, Math.max(0, (x - a) / (b - a))); return q * q * (3 - 2 * q); };

const ptVS = /* glsl */`
  attribute float kind; attribute float phase; uniform float uTime; uniform float uScale; varying vec3 vC; varying float vA;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = length(mv.xyz);
    if (kind > 0.5) {
      // red warning beacons along the ribbon
      float blink = step(0.82, fract(uTime * 0.7 + kind * 3.0));
      vC = vec3(1.0, 0.12, 0.06);
      vA = blink * clamp(3.0e6 / d, 0.2, 1.0) * smoothstep(400.0, 2500.0, d);
      gl_PointSize = (2.0 + 3.0 * blink) * uScale;
    } else {
      // climbers: cabin light, with the strobe's double flash; hidden up close (the model shows)
      float f = fract(uTime / 1.5 + phase);
      float strobe = max(step(f, 0.025), step(abs(f - 0.12), 0.012));
      vC = kind > 0.2 ? vec3(1.0, 0.72, 0.42) : vec3(1.0, 0.88, 0.66);
      vC = mix(vC, vec3(1.0), strobe);
      vA = (0.8 + 2.2 * strobe) * clamp(3.0e6 / d, 0.15, 1.0) * smoothstep(900.0, 2600.0, d) * step(0.0, phase);
      gl_PointSize = (2.6 + 1.6 * strobe) * uScale;
    }
  }`;
const ptFS = /* glsl */`
  varying vec3 vC; varying float vA;
  void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float g = exp(-dot(p, p) * 3.0); gl_FragColor = vec4(vC * vA * g * 5.0, 1.0); }`;

const beamVS = /* glsl */`
  varying float vY; varying vec3 vW; varying vec3 vN;
  void main(){ vY = uv.y; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * vec3(position.x, 0.0, position.z));
    gl_Position = projectionMatrix * viewMatrix * w; }`;
const beamFS = /* glsl */`
  uniform float uK; uniform float uLen; varying float vY; varying vec3 vW; varying vec3 vN;
  void main(){
    vec3 V = normalize(cameraPosition - vW);
    float rim = pow(max(0.0, abs(dot(normalize(vN), V))), 1.5);
    // scattering falls off with the air: bright near the sea, gone by ~60 km
    float h = vY * uLen;
    float air = exp(-h / 7500.0);
    gl_FragColor = vec4(vec3(0.35, 1.0, 0.7) * uK * air * rim * 0.9, 1.0);
  }`;

export class SpaceElevator {
  constructor(engine, M, stations = null, game = null) {
    this.engine = engine;
    this.scene = engine.scene;
    this.M = M;
    this.game = game;
    const E = ELEVATOR_H;
    // far line samples: fine near the ground, coarse in deep space
    const N = 380, hs = [];
    for (let k = 0; k <= N; k++) hs.push(E.anchorTop + (k === 0 ? 0 : 25 * Math.pow((E.cwEnd - E.anchorTop) / 25, k / N)));
    hs[N] = E.cwEnd;
    this.far = new FarRibbon(this.scene, hs);
    this.near = new NearRibbon(this.scene);
    this.traffic = new Traffic();
    // far light points: every climber + the red beacons on the axis
    this.beaconH = [];
    for (let h = 2000e3; h < E.top; h *= 1.55) this.beaconH.push(h);
    for (const h of [100e3, 400e3, 1000e3]) this.beaconH.push(h);
    const NC = this.traffic.climbers.length, NP = NC + this.beaconH.length;
    this.ptPos = new Float32Array(NP * 3);
    const kind = new Float32Array(NP), phase = new Float32Array(NP);
    this.traffic.climbers.forEach((c, i) => { kind[i] = c.kind === 'C' ? 0.25 : 0; phase[i] = (i * 0.618) % 1; });
    for (let j = 0; j < this.beaconH.length; j++) kind[NC + j] = 1 + (j % 5) * 0.13;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.ptPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('kind', new THREE.BufferAttribute(kind, 1));
    this.ptPhase = new THREE.BufferAttribute(phase, 1);
    pg.setAttribute('phase', this.ptPhase);
    this.basePhase = phase.slice();
    this.ptMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 } }, vertexShader: ptVS, fragmentShader: ptFS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(pg, this.ptMat);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
    this.points.layers.set(LAYER_FAR); this.points.layers.enable(LAYER_MID);
    this.scene.add(this.points);
    // the anchor platform and the counterweight (3D when close)
    this.anchor = anchorModel(M);
    this.counter = counterweightModel(M);
    for (const o of [this.anchor, this.counter]) { o.matrixAutoUpdate = false; o.visible = false; this.scene.add(o); }
    // berths: anchor top, counterweight keel and both ends of the two terminal towers
    this.berths = [];
    const addBerth = (parent, y, side, line, end, h, label, station = null) => {
      const rig = new BerthRig(M, side, label);
      rig.group.matrix.makeTranslation(0, y, 0);
      parent.add(rig.group);
      const L = this.traffic.lines.find((l) => l.id === line);
      this.berths.push({ rig, parent, y, side, line: L, end, h, station, arrLane: end === 1 ? -1 : 1, depLane: end === 1 ? 1 : -1, near: false, was: null });
    };
    addBerth(this.anchor, E.anchorBerth, 1, 'G', 0, E.anchorBerth, '↑ 地上線  天の御柱 低軌道ステーション');
    addBerth(this.counter, E.cwBerth - E.top, -1, 'O', 1, E.cwBerth, '外縁線 終点  COUNTERWEIGHT');
    if (stations) {
      const mih = stations.list.find((s) => s.id === 'mihashira');
      const ama = stations.list.find((s) => s.id === 'amaterasu');
      if (mih) {
        addBerth(mih.model, -64, -1, 'G', 1, E.mih - 64, '↓ 地上線  ANCHOR', mih);
        addBerth(mih.model, 64, 1, 'S', 0, E.mih + 64, '↑ 静止線  AMATERASU', mih);
      }
      if (ama) {
        addBerth(ama.model, -64, -1, 'S', 1, E.geo - 64, '↓ 静止線  MIHASHIRA', ama);
        addBerth(ama.model, 64, 1, 'O', 0, E.geo + 64, '↑ 外縁線  OUTER', ama);
      }
    }
    // climber models, given to the nearest climbers
    this.pool = [];
    for (let i = 0; i < 4; i++) this.pool.push(new ClimberModel('P', M));
    for (let i = 0; i < 3; i++) this.pool.push(new ClimberModel('C', M));
    for (const m of this.pool) { m.group.visible = false; this.scene.add(m.group); }
    // the power beam above the anchor (seen only where there is air to scatter it)
    const bg = new THREE.CylinderGeometry(3.5, 1.2, 1, 20, 1, true);
    bg.translate(0, 0.5, 0);
    this.beamMat = new THREE.ShaderMaterial({ uniforms: { uK: { value: 0 }, uLen: { value: 1 } }, vertexShader: beamVS, fragmentShader: beamFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(bg, this.beamMat);
    this.beam.matrixAutoUpdate = false;
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    this.scene.add(this.beam);
    // sparks and debris where the ribbon is hit (in a frame pinned to the hit point)
    this.fxGroup = new THREE.Group();
    this.fxGroup.matrixAutoUpdate = false;
    this.scene.add(this.fxGroup);
    this.fx = new Particles(this.fxGroup);
    this.fxH = null;
    this.axis = new THREE.Vector3();
    this.ex = new THREE.Vector3(1, 0, 0);
    this.ez = new THREE.Vector3(0, 0, 1);
    this._ce = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._size = new THREE.Vector2();
    this._m = new THREE.Matrix4();
    this.t = 0;
  }

  /** ECI position of a point h metres above the anchor */
  pointAt(h, t, out = new THREE.Vector3()) {
    return elevatorAxis(t, out).multiplyScalar(R_EARTH + h);
  }

  /** render-frame position of a ribbon point (lane -1 / 1, 0 = axis) */
  rel(h, lane, origin, out) {
    const r = R_EARTH + h, ax = this.axis;
    return out.set(ax.x * r - origin.x + this.ex.x * lane * LANE_X, ax.y * r - origin.y + this.ex.y * lane * LANE_X, ax.z * r - origin.z + this.ex.z * lane * LANE_X);
  }

  /** an asteroid strike at height h (sev 0..1): waves along the ribbon, sparks if we are near */
  impact(h, sev) {
    const lane = Math.random() < 0.5 ? -1 : 1;
    this.near.addWave(h, 1.5 + 9 * sev, lane, 1100, 320, 0.01);
    this.near.addWave(h, 0.6 + 3 * sev, -lane, 900, 420, 0.008);
    this.fxH = { h, lane, sev, t: 0 };
    this.fxPending = true;
  }

  /** "地上線 4分後" etc. for a terminal station's monitor */
  nextInfo(stationId, sec = this.clock / 1000) {
    const out = [];
    for (const B of this.berths) {
      if (!B.station || B.station.id !== stationId) continue;
      const w = this.traffic.nextArrival(B.line.id, B.end, sec);
      out.push({ line: B.line.jp, up: B.side > 0, w });
    }
    return out;
  }

  update(t, origin, camWorld, sunDir, dt, space = null) {
    const E = ELEVATOR_H;
    const ax = elevatorAxis(t, this.axis);
    const ex = this.ex, ez = this.ez;
    elevatorBasis(ax, ex, ez);
    const camEci = this._ce.copy(camWorld).add(origin);
    this.t += dt;
    const D = this.dmg, st = D ? D.status : 'ok';
    // a severed ribbon: the lower part falls back, the upper part flies out, the break opens
    let gap = null, whipAmp = 0;
    if (D && D.destroyed) {
      const age = Math.max(0, (t - (D.destroyedAt ?? t)) / 1000);
      const bh = D.breakH || 5e6;
      gap = [bh - Math.min(bh - E.anchorTop, 40 + 0.8 * age * age), bh + Math.min(4e7, 40 + 0.45 * age * age)];
      whipAmp = 4 + 60 * Math.exp(-age / 600);
    }
    // the climbers run on their own clock: slower when the elevator is damaged, stopped when it fails
    const sp = st === 'ok' ? 1 : st === 'damaged' ? 0.5 : st === 'critical' ? 0.12 : 0;
    if (this.clock === undefined) this.clock = t;
    this.clock += (t - (this.lastT ?? t)) * sp;
    this.lastT = t;
    const sec = this.clock / 1000;
    this.traffic.update(sec);
    // ---- where the camera is along the ribbon
    const along = camEci.dot(ax);
    const hcam = along - R_EARTH;
    const px = camEci.x - ax.x * along, py = camEci.y - ax.y * along, pz = camEci.z - ax.z * along;
    const dperp = Math.hypot(px, py, pz);
    let F = null, cut = null;
    if (dperp < NEAR_R * 0.98 && hcam > E.anchorTop - NEAR_R && hcam < E.cwEnd + NEAR_R) {
      const hc = Math.min(E.cwEnd, Math.max(E.anchorTop, hcam));
      const dc = Math.hypot(dperp, hcam - hc);
      if (dc < NEAR_R * 0.98) {
        const half = Math.sqrt(NEAR_R * NEAR_R - dc * dc);
        const O = new THREE.Vector3(ax.x * (R_EARTH + hc) - origin.x, ax.y * (R_EARTH + hc) - origin.y, ax.z * (R_EARTH + hc) - origin.z);
        F = {
          O, ex, ey: ax, ez, hc, half, sMin: E.anchorTop - hc, sMax: E.cwEnd - hc,
          gap: gap ? [gap[0] - hc, gap[1] - hc] : null,
          whip: gap ? { a: gap[0] - hc, b: gap[1] - hc, amp: whipAmp } : null,
        };
        cut = [hc - half * 0.995, hc + half * 0.995];
      }
    }
    // ---- far line
    this.engine.renderer.getDrawingBufferSize(this._size);
    this.far.update(ax, origin, camWorld, sunDir, cut, gap, this._size);
    // ---- climbers: positions, far points, the nearest get models
    const C = this.traffic.climbers;
    const near = [];
    const p = this._p;
    for (let i = 0; i < C.length; i++) {
      const c = C[i];
      c.hidden = !!(gap && c.h > gap[0] - 20 && c.h < gap[1] + 20) || st === 'destroyed' && !gap;
      this.rel(c.h, c.lane, origin, p);
      c.rel = c.rel || new THREE.Vector3();
      c.rel.copy(p);
      c.d = p.distanceTo(camWorld);
      if (c.hidden) p.set(1e15, 0, 0);
      this.ptPos[i * 3] = p.x; this.ptPos[i * 3 + 1] = p.y; this.ptPos[i * 3 + 2] = p.z;
      if (!c.hidden && c.d < 9000) near.push(c);
    }
    for (let j = 0; j < this.beaconH.length; j++) {
      const h = this.beaconH[j];
      this.rel(h, 0, origin, p);
      if (st === 'failed' || (gap && h > gap[0] && h < gap[1]) || (cut && h > cut[0] && h < cut[1])) p.set(1e15, 0, 0);
      const k = C.length + j;
      this.ptPos[k * 3] = p.x; this.ptPos[k * 3 + 1] = p.y; this.ptPos[k * 3 + 2] = p.z;
    }
    // climbers without power show no strobe (phase < 0 hides their point too when the line is dead)
    const ph = this.ptPhase.array;
    for (let i = 0; i < C.length; i++) ph[i] = st === 'failed' || st === 'destroyed' ? -1 : this.basePhase[i];
    this.ptPhase.needsUpdate = true;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.ptMat.uniforms.uTime.value = (t / 1000 * (st === 'damaged' || st === 'critical' ? 4 : 1)) % 10000;
    this.ptMat.uniforms.uScale.value = this.engine.renderer.getPixelRatio();
    near.sort((a, b) => a.d - b.d);
    const free = { P: this.pool.filter((m) => m.kind === 'P'), C: this.pool.filter((m) => m.kind === 'C') };
    const used = new Set();
    const lights = [];
    const tsec = this.t;
    const power = st === 'ok' || st === 'damaged' ? 1 : st === 'critical' ? (Math.sin(tsec * 17) > 0.2 ? 0.8 : 0.25) : 0.12;
    for (const c of near) {
      // keep a climber's model if it already has one
      let m = this.pool.find((q) => q.owner === c && !used.has(q));
      if (!m) m = free[c.kind].find((q) => !used.has(q) && (!q.owner || !near.includes(q.owner) || q.owner.d > c.d));
      if (!m) continue;
      used.add(m);
      if (m.owner !== c) { m.owner = c; m.setId(c.id); }
      this.placeClimber(m, c, origin, camWorld, dt, power, st, F, lights);
    }
    for (const m of this.pool) if (!used.has(m)) { m.group.visible = false; m.owner = null; }
    // the strike's flash on the ribbon
    if (F && this.fxH && this.fxH.t < 1.5) {
      const q = 1 - this.fxH.t / 1.5;
      lights.push({ s: this.fxH.h - F.hc, lane: 0, dir: 0, range: 220, color: [1, 0.72, 0.45], k: 9 * q * q * (0.3 + this.fxH.sev) });
    }
    // ---- berths
    const berthEnv = [];
    for (const B of this.berths) this.updateBerth(B, F, lights, berthEnv, st, tsec, camWorld);
    // ---- near ribbon
    if (F) {
      const sc = space;
      const sunVis = this.sunVisibility(ax, F.hc, sunDir);
      const sunC = new THREE.Vector3(SUN_E, SUN_E, SUN_E);
      if (sc) sunC.set(sc.sunColor.r * SUN_E, sc.sunColor.g * SUN_E, sc.sunColor.b * SUN_E);
      sunC.multiply(sunVis);
      const earthC = new THREE.Vector3();
      if (sc && sc.earthshine) earthC.set(sc.earthshine.color.r, sc.earthshine.color.g, sc.earthshine.color.b).multiplyScalar(sc.earthshine.intensity);
      const earthL = sc && sc.toEarth ? sc.toEarth : ax.clone().negate();
      const cam = this.engine.camera;
      const pxAngle = 2 * Math.tan(cam.fov * Math.PI / 360) / Math.max(1, this._size.y);
      this.near.update(F, { sunL: sunDir, sunC, earthL, earthC, pxAngle, pixelRatio: this.engine.renderer.getPixelRatio(), time: tsec, lights, berths: berthEnv }, dt);
    } else this.near.update(null);
    // ---- anchor, counterweight, beam
    this.placeBig(this.anchor, E.anchorBerth * 0, origin, camWorld, 175, 3.5e5);
    this.placeBig(this.counter, E.top, origin, camWorld, 300, 6e5);
    this.updateBeam(origin, camWorld, st);
    // ---- impact sparks
    this.updateFx(origin, camWorld, dt);
  }

  /** sunlight reaching the ribbon at height h: Earth's shadow with a reddened penumbra */
  sunVisibility(ax, h, sunDir) {
    const r = R_EARTH + h;
    const sd = ax.dot(sunDir) * r;
    if (sd > 0) return new THREE.Vector3(1, 1, 1);
    const q = Math.sqrt(Math.max(0, r * r - sd * sd));
    const vis = smooth(R_EARTH - 12e3, R_EARTH + 18e3, q);
    const red = smooth(R_EARTH, R_EARTH + 90e3, q);
    return new THREE.Vector3(vis, vis * (0.42 + 0.58 * red), vis * (0.22 + 0.78 * red));
  }

  placeClimber(m, c, origin, camWorld, dt, power, st, F, lights) {
    const g = m.group;
    g.visible = true;
    const p = c.rel;
    g.matrix.makeBasis(this.ex, this.axis, this.ez).setPosition(p);
    g.matrixWorld.copy(g.matrix);
    g.updateMatrixWorld(true);
    g.traverse((o) => { if (o.isMesh) assignLayers(o, Math.max(0, c.d - 9), c.d + 9); });
    // animation state from the timetable
    const L = c.line;
    let grip = 1, fins = 1, door = 0, lightsK = 1, recv = 1, status = [1, 0.55, 0.1], statusK = 1.2, strobe = 0;
    const tt = this.t;
    if (c.stage === 'berth') {
      const s = berthStage(c.dwellF, c.dwell);
      grip = s.rollers; fins = 0; door = s.doors; lightsK = 0.25 + 0.75 * s.depart; recv = 0.12;
      if (s.clamp > 0.95 && s.traverse < 0.01) { status = [0.15, 1, 0.3]; statusK = 2.2; }
      else { status = [1, 0.55, 0.1]; statusK = 1 + 3 * Math.max(0, Math.sin(tt * 6)); }
    } else {
      const fromEnd = Math.min(c.h - L.h0, L.h1 - c.h);
      fins = smooth(40, 120, fromEnd);
      const f = (tt / 1.5 + c.i * 0.618) % 1;
      strobe = f < 0.025 || Math.abs(f - 0.12) < 0.012 ? 1 : 0;
      recv = 0.75 + 0.25 * Math.sin(tt * 2.1 + c.i);
    }
    let windows = 1;
    if (power < 1) { windows = power; lightsK *= power; recv *= power; strobe *= power > 0.5 ? 1 : 0; status = [1, 0.08, 0.04]; statusK = 3 * (Math.sin(tt * 4) > 0 ? 1 : 0.1); }
    m.animate({ v: c.v * (c.stage === 'down' ? 1 : 1), dt, grip, fins, door, lights: lightsK, windows, recv, status, statusK, strobe });
    // its headlamps on the ribbon ahead (and a little behind)
    if (F && lightsK > 0.05) {
      const s = c.h - F.hc;
      if (Math.abs(s) < F.half) {
        const dir = c.stage === 'up' ? 1 : c.stage === 'down' ? -1 : 0;
        if (dir) {
          lights.push({ s: s + dir * 6.4, lane: c.lane, dir, range: 160, color: [1.0, 0.93, 0.8], k: 2.4 * lightsK });
          lights.push({ s: s - dir * 6.4, lane: c.lane, dir: -dir, range: 30, color: [1.0, 0.25, 0.12], k: 0.3 * lightsK });
        } else lights.push({ s, lane: Math.round(c.lane) || 0, dir: 0, range: 18, color: [1.0, 0.85, 0.6], k: 0.6 * lightsK });
      }
    }
  }

  updateBerth(B, F, lights, berthEnv, est, tsec, camWorld) {
    const L = B.line;
    // which climber is in (or coming into / leaving) this berth
    let at = null, inbound = null, outbound = null;
    for (const c of this.traffic.climbers) {
      if (c.line !== L || c.hidden) continue;
      if (c.stage === 'berth' && c.end === B.end) { at = c; continue; }
      const d = Math.abs(c.h - B.h);
      if (d > 3000) continue;
      const towards = B.end === 1 ? c.stage === 'up' : c.stage === 'down';
      if (towards) { if (!inbound || d < Math.abs(inbound.h - B.h)) inbound = c; }
      else if (!outbound || d < Math.abs(outbound.h - B.h)) outbound = c;
    }
    const S = B.station;
    const sst = S && S.dmg ? S.dmg.status : 'ok';
    let power = sst === 'ok' || sst === 'damaged' ? 1 : sst === 'critical' ? (Math.sin(tsec * 13 + B.h) > 0.3 ? 0.9 : 0.2) : 0;
    if (est === 'failed' || est === 'destroyed') power *= 0.3;
    const state = { carX: B.arrLane, clamp: 0, bridge: [0, 0], occupied: [false, false], moving: false, warn: 0, power, t: tsec };
    let chase = null;
    if (at) {
      const s = berthStage(at.dwellF, at.dwell);
      state.carX = at.lane;
      state.clamp = s.clamp;
      const ai = B.arrLane < 0 ? 0 : 1, di = 1 - ai;
      state.bridge[ai] = s.bridgeIn; state.bridge[di] = s.bridgeOut;
      state.occupied[at.lane < 0 ? 0 : 1] = true;
      state.moving = s.traverse > 0.001 && s.traverse < 0.999;
      state.warn = Math.max(s.depart, state.moving ? 1 : 0, 1 - s.clamp);
      if (s.depart > 0.5) chase = { lane: B.depLane, sense: -1 };
    }
    if (inbound) { state.warn = Math.max(state.warn, smooth(3000, 600, Math.abs(inbound.h - B.h))); chase = { lane: inbound.lane, sense: 1 }; }
    if (outbound && Math.abs(outbound.h - B.h) < 1500) { state.warn = Math.max(state.warn, 1 - Math.abs(outbound.h - B.h) / 1500); chase = chase || { lane: outbound.lane, sense: -1 }; }
    B.rig.animate(state);
    B.rig.group.updateMatrixWorld(true);
    // lights for the ribbon shader and the approach chasers
    if (F) {
      const s = B.h - F.hc;
      if (Math.abs(s) < F.half + 2000) {
        if (power > 0.05) lights.push({ s, lane: 0, dir: 0, range: 34, color: [0.85, 0.92, 1.0], k: 1.4 * power });
        berthEnv.push({ h: B.h, side: -B.side, chase: power > 0.05 ? chase : null });
      }
    }
    this.berthSound(B, at, inbound, tsec);
  }

  /** the terminal you are docked at: a chime and the announcement before a climber comes in, the
   *  clamps' thud through the structure, a low rumble as one pulls out */
  berthSound(B, at, inbound, tsec) {
    const g = this.game;
    if (!g || !g.audio || !g.docking || !B.station) return;
    const here = g.docking.state === 'docked' && g.docking.station === B.station;
    if (!here) { if (B.rumble) { g.audio.stopLoop && g.audio.stopLoop('elRumble' + B.h); B.rumble = false; } return; }
    const A = g.audio;
    const ev = (k) => { const was = B.ev || {}; if (was[k]) return false; was[k] = true; B.ev = was; return true; };
    if (inbound && Math.abs(inbound.h - B.h) < 400 && ev('chime' + inbound.id)) {
      A.chime && A.chime();
      if (g.asphalt && Math.random() < 0.5) g.asphalt.say(B.side > 0 ? 'el_climber_down' : 'el_climber_up', { line: B.line.jp, id: inbound.id }, { minGap: 600 });
    }
    if (at) {
      const s = berthStage(at.dwellF, at.dwell);
      if (s.clamp > 0.6 && ev('clamp' + at.id + Math.floor(at.dwellF > 20 ? 1 : 0))) {
        A.beep && A.beep(62, 0.35, 0.22, { direct: true, type: 'sine' });
        A._burst && A._burst(null, { dur: 0.5, freq: 260, q: 0.6, gain: 0.18, type: 'brown', filter: 'lowpass', direct: true });
      }
      if (s.traverse > 0.02 && s.traverse < 0.98) {
        if (!B.rumble && A.humLoop) { A.humLoop('elRumble' + B.h, { freq: 41, gain: 0.0, harm: [1, 0.6, 0.3, 0.15] }); B.rumble = true; }
        A.setLoopGain && A.setLoopGain('elRumble' + B.h, 0.035, 0.6);
      } else if (s.depart > 0.4) {
        if (!B.rumble && A.humLoop) { A.humLoop('elRumble' + B.h, { freq: 33, gain: 0.0, harm: [1, 0.7, 0.4, 0.2] }); B.rumble = true; }
        A.setLoopGain && A.setLoopGain('elRumble' + B.h, 0.05 * s.depart, 0.8);
      } else if (B.rumble) A.setLoopGain && A.setLoopGain('elRumble' + B.h, 0, 1.2);
    } else if (B.rumble) A.setLoopGain && A.setLoopGain('elRumble' + B.h, 0, 1.5);
    if (B.ev && Object.keys(B.ev).length > 40) B.ev = {};
  }

  placeBig(o, h, origin, camWorld, R, maxD) {
    const p = this.rel(h, 0, origin, this._p);
    const d = p.distanceTo(camWorld);
    o.visible = d < maxD;
    if (!o.visible) return;
    o.matrix.makeBasis(this.ex, this.axis, this.ez).setPosition(p);
    o.matrixWorld.copy(o.matrix);
    o.updateMatrixWorld(true);
    o.traverse((m) => { if (m.isMesh) assignLayers(m, Math.max(0, d - R), d + R); });
  }

  /** the anchor's laser lights a ground-line climber on its way up through the air */
  updateBeam(origin, camWorld, st) {
    let target = null;
    for (const c of this.traffic.climbers) if (c.line.id === 'G' && c.stage === 'up' && !c.hidden && c.h < 120e3 && c.h > 400) { if (!target || c.h < target.h) target = c; }
    const on = target && (st === 'ok' || st === 'damaged');
    this.beam.visible = !!on && this.rel(0, 0, origin, this._p).distanceTo(camWorld) < 2.5e6;
    if (!this.beam.visible) return;
    // from one of the three domes (78 m out on the deck) to the receiver ring under the climber
    const a0 = this.rel(0, 0, origin, new THREE.Vector3());
    const ang = (target.i % 3) / 3 * Math.PI * 2 + Math.PI / 6;
    const base = a0.clone().addScaledVector(this.ex, Math.cos(ang) * 78).addScaledVector(this.axis, 35.4).addScaledVector(this.ez, Math.sin(ang) * 78);
    const tgt = this.rel(target.h - 6.6, target.lane, origin, new THREE.Vector3());
    const dir = tgt.sub(base);
    const len = Math.max(10, dir.length());
    dir.divideScalar(len);
    this.beam.matrix.compose(base, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), new THREE.Vector3(1, len, 1));
    this.beam.matrixWorld.copy(this.beam.matrix);
    this.beamMat.uniforms.uLen.value = len;
    this.beamMat.uniforms.uK.value = 2.2 * (0.85 + 0.15 * Math.sin(this.t * 3.1));
    const d = base.distanceTo(camWorld);
    assignLayers(this.beam, Math.max(0, d - len), d + len);
    if (this.anchor.userData.beamGlow) this.anchor.userData.beamGlow.emissiveIntensity = 5 + 3 * Math.sin(this.t * 3.1);
  }

  updateFx(origin, camWorld, dt) {
    const H = this.fxH;
    if (!H) return;
    H.t += dt;
    const p = this.rel(H.h, H.lane, origin, this._p);
    this.fxGroup.matrix.makeBasis(this.ex, this.axis, this.ez).setPosition(p);
    this.fxGroup.matrixWorld.copy(this.fxGroup.matrix);
    this.fxGroup.updateMatrixWorld(true);
    const d = p.distanceTo(camWorld);
    if (this.fxPending) {
      this.fxPending = false;
      if (d < 30000) {
        const O = new THREE.Vector3();
        // the flash, a hot fireball of ribbon fibre and rock, sparks, then tumbling fragments
        this.fx.burst('plasma', O, new THREE.Vector3(0, 0, 1), 3, { spread: 0.3, speed: 2, size: 9 + 10 * H.sev, life: 0.45, grow: 2.5, color: [1, 0.85, 0.6] });
        this.fx.burst('plasma', O, new THREE.Vector3(0, 0, -1), Math.round(8 + 20 * H.sev), { spread: 1.2, speed: 8 + 30 * H.sev, size: 3 + 4 * H.sev, life: 1.4 });
        this.fx.burst('spark', O, new THREE.Vector3(0, 0, 1), Math.round(120 + 300 * H.sev), { spread: 1.6, speed: 60 + 220 * H.sev, size: 22, life: 1.8, drag: 0 });
        this.fx.burst('debris', O, new THREE.Vector3(1, 0, 0), Math.round(30 + 90 * H.sev), { spread: 1.6, speed: 6 + 30 * H.sev, size: 18, drag: 0 });
      }
    }
    const cam = this.engine.camera;
    const sc = this.engine.renderer.domElement.height / (2 * Math.tan(cam.fov * Math.PI / 360));
    this.fx.add.pts.material.uniforms.uScale.value = sc;
    this.fx.alpha.pts.material.uniforms.uScale.value = sc;
    this.fx.update(Math.min(dt, 0.1));
    if (H.t > 12) this.fxH = null;
  }
}
