// H8 in the game: Kaito's old sub-base, now flying again.
//
// Modes: 'parked' — dormant on its parking orbit (analytic, costs nothing); 'free' — its own
// flight model, flown by HACHI (rendezvous, escort, home) or by Kaito from its seat; 'docked' —
// latched onto B-29's dorsal port: the pair fly as one, H8's drive pushing (x6 on its own reactor,
// x12 with B-29's power fed through the umbilical), HACHI watching for rocks (its laser picks off
// the small ones) and the port open between the two cabins.
//
// Frames: B-29's ship frame is the physics frame (PF). H8's interior always sits at H8.dockAt in
// it — while docked that is where it really is; when Kaito flies H8 away ("solo") the view and the
// light pool ride with H8 instead (game.frameRoot), so walking, seats, monitors and lamps keep
// working unchanged.
import * as THREE from 'three';
import { H8, CAMERAS } from './h8Spec.js';
import { createH8Materials, H8_UNIFORMS } from './h8Materials.js';
import { buildH8Exterior } from './h8Exterior.js';
import { buildH8Interior, createH8InteriorMaterials } from './h8Interior.js';
import { H8Display, fmtDist, altOf, FLOOR, CAM_DEAD } from './h8Display.js';
import { H8Tabs } from './h8Tabs.js';
import { H8Zoom, OPT_MAX, DIG_MAX } from './h8Zoom.js';
import { H8Hud } from './h8Hud.js';
import { H8Shelter, shelterMaterials, SHELTER } from './h8Shelter.js';
import { RescueTug } from './rescueTug.js';
import { ReentryFire, fireLevel } from '../fx/reentryFire.js';
import { EnginePlume, plumeAir } from '../fx/enginePlume.js';
import { SeatMotion, SEAT } from './h8Seat.js';
import { HachiMind } from './hachiMind.js';
import { HachiDefence } from './hachiDefence.js';
import { NORMAL_MW } from '../combat/arsenal.js';
import { H8Hull, dentify, DENT_U } from './h8Dents.js';
import { Particles } from '../fx/particles.js';
import { HachiPilot } from './h8Pilot.js';
import { PORT, DorsalHatch, receptacleSocket } from './b29Port.js';
import { H8_PAGES } from './h8Monitors.js';
import { Flight } from '../ship/flight.js';
import { LAYER_NEAR, LAYER_MID, LAYER_FAR, LAYER_CABIN, assignLayers } from '../core/layers.js';
import { LAYER_PROXY } from '../player/interact.js';
import { MU_EARTH, R_EARTH, OMEGA_EARTH } from '../core/astro.js';
import { STATUS_JP } from '../world/worldDamage.js';
import { rockId } from '../combat/combat.js';

function fmtEta(sec) {
  if (!sec || sec < 1) return '';
  if (sec < 60) return Math.round(sec) + '秒';
  if (sec < 3600) return Math.round(sec / 60) + '分';
  return (sec / 3600).toFixed(1) + '時間';
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DOCK = H8.dockAt;
const COL_DIM = 'rgba(150,190,230,0.55)';
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _v3a = new THREE.Vector3(), _v3b = new THREE.Vector3(), _v3c = new THREE.Vector3(), _v3d = new THREE.Vector3(), _m4b = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);

/** H8 and B-29 hear each other within this distance (m) */
export const LINK_RANGE = 1.5e6;

/** junction boxes under the armour (H8-local directions): the circuits hits can cut, and a suit
 * can splice from outside */
export const JUNCTIONS = {
  drive: { name: '推進制御回路', dir: V(0.32, -0.2, 0.93).normalize() },
  power: { name: '電力バス', dir: V(0.48, -0.6, 0.64).normalize() },
  sensor: { name: 'センサー回路', dir: V(-0.3, 0.78, -0.55).normalize() },
  comms: { name: '通信回路', dir: V(0.66, 0.6, -0.45).normalize() },
  fire: { name: '射撃管制回路', dir: V(-0.55, -0.08, -0.83).normalize() },
};
// the outer materials that dent (the plates themselves can be torn through); lights, glass and
// the drive's glow do not
const PLATES = new Set(['armor', 'armorPlain', 'trim', 'decal']);
const NO_DENT = new Set(['ledG', 'ledR', 'ledA', 'ledB', 'navR', 'navG', 'strobe', 'flood', 'coil', 'throat', 'dome']);
// the plates themselves and what lies on them: gone with a plate knocked off
const ON_TILES = new Set(['armor', 'decal', 'bolt']);

// H8-local points of interest
const NECK_HATCH = V(0, H8.neckHatchY, H8.shaftZ);
const LASER_AT = H8.laserDir.clone().multiplyScalar(H8.R + 0.4);
const COUPLING_TIP = H8.couplingAt.clone().normalize().multiplyScalar(H8.R + 0.31);

/** H8's outside camera views for the external-camera mode (H8-local) */
export const H8_EXT_CAMS = [
  { name: 'h8chase', pos: V(0, 4.5, 16), look: V(0, 0, -2), orbit: true },
  { name: 'h8cam2', pos: CAMERAS[1].dir.clone().multiplyScalar(H8.R + 0.75), look: CAMERAS[1].dir.clone().multiplyScalar(60) },
  { name: 'h8top', pos: V(0, H8.R + 1.2, 0), look: V(0, H8.R + 1.0, -40) },
  { name: 'h8side', pos: V(11, 2.5, -4), look: V(0, -0.5, 0.5), orbit: true },
];

export class H8Vessel {
  constructor(game) {
    this.g = game;
    // ---------------------------------------------------------------- visuals
    const M = this.M = createH8Materials();
    const extKeys = new Set(Object.keys(M));
    createH8InteriorMaterials(M);
    shelterMaterials(M);
    this.intKeys = new Set(Object.keys(M).filter((k) => !extKeys.has(k)));
    for (const k of extKeys) if (!NO_DENT.has(k) && M[k].isMeshStandardMaterial) dentify(M[k], PLATES.has(k), ON_TILES.has(k));
    this.ext = buildH8Exterior(M);
    this.int = buildH8Interior(M);
    this.display = new H8Display();
    this.tabs = new H8Tabs(this);
    this.zoom = new H8Zoom(this);
    this.hud = new H8Hud(this);
    this.cands = [];
    this.root = new THREE.Group();
    this.root.name = 'H8';
    this.root.matrixAutoUpdate = false;
    this.root.add(this.ext.group, this.ext.far, this.int.group, this.display.mesh);
    // the emergency shelter behind the aft panel (and what is left of it if H8 is lost); the slot
    // and the rail that send the seat into it are the cockpit's
    this.shelter = new H8Shelter(this, M);
    this.root.add(this.shelter.group, this.shelter.pod);
    this.int.group.add(this.shelter.rail);
    this.shelter.buildDoorLiner(this.display.shelterS.pivot);
    this.structure = 1;          // the frame, once the inner armour is gone (0: H8 breaks up)
    // re-entry fire round the sphere
    this.fire = new ReentryFire(this.root, { center: V(0, -0.4, 0), shell: V(4.9, 5.4, 4.9), r0: 5, r1: 17, len: 240 });
    // the drive's plasma plume out of the magnetic nozzle, the auxiliary engines' flames
    this.plumeMain = new EnginePlume(this.root, { exits: [this.ext.parts.driveExit], r0: 0.9, len: 34, style: 'plasma', spread: 0.15, dia: 0.65, seed: 2.1 });
    this.plumeAux = new EnginePlume(this.root, { exits: this.ext.parts.auxExits, r0: 0.3, len: 7.5, style: 'chem', spread: 0.42, dia: 0.25, gain: 0.9, seed: 4.7 });
    // the display draws its own things (the tabs, the ladder) as bright as the eye needs them, from
    // the picture's adaptation (the engine's auto exposure)
    {
      const E = game.engine, prev = E.exposure.onTexture, U = this.display.uniforms;
      E.exposure.onTexture = (t) => { if (prev) prev(t); U.tLum.value = t; };
    }
    this.extMeshes = [];
    // the outside takes no shadows (B-29 underneath would black out the earthshine on H8's belly);
    // its substrate sphere casts them: the sealed cockpit inside gets no sunlight, and H8 shades
    // B-29's back
    this.ext.group.traverse((o) => {
      if (!o.isMesh) return;
      this.extMeshes.push(o); o.layers.set(LAYER_NEAR);
      o.receiveShadow = false;
      o.castShadow = o.name === 'substrate';
    });
    this.ext.far.traverse((o) => { if (o.isMesh) o.layers.set(LAYER_MID); });
    this.int.group.traverse((o) => o.layers.set(LAYER_NEAR));
    this.display.mesh.layers.set(LAYER_NEAR);
    this.buildNeckHatch();
    this.buildBeacon();
    // ---------------------------------------------------------------- flight & pilot
    // (it stands on the bottom of its neck, 4.3 m under its centre)
    this.flight = new Flight({ normalMax: 60 * H8.speedMulInternal, ultraMax: 900 * H8.speedMulInternal, aMax: H8.accel, mass: H8.mass, CdA: 18, comfortK: 5, rampK: 6, turnK: H8.turnK, tank: { cap: H8.propKg, ve: H8.ve }, hullBottom: -H8.neckBottom });
    this.flight.impactCallback = (speed, vn, water) => this.groundImpact(speed, vn, water);
    this.pilot = new HachiPilot(this);
    // ---------------------------------------------------------------- damage you can see
    this.hull = new H8Hull(this);
    this.fx = new Particles(this.root);
    this.fxIdle = true;
    // ---------------------------------------------------------------- state
    this.mode = 'parked';        // parked | free | docked
    this.crew = false;           // Kaito is aboard H8
    this.park = null;            // parking orbit
    this.awake = 0;              // 0 dormant .. 1 all systems up
    this.wakeTarget = 0;
    this.power = { reactor: 0.12, smes: H8.smesMJ * 0.85, feedOn: true, feed: false, feedMW: 0, loadMW: 2, driveMW: 0, boost: true };
    this.armour = { outer: 1, inner: 1 };
    this.neckOpen = 0;
    this.neckTarget = 0;
    this.radFold = 0;
    this.umb = 0;                // umbilical extension 0..1
    this.latchT = 0;
    this.pending = null;         // queued command waiting for the hatches to close
    this.pd = { cool: 0, beams: [] };
    this.drive = 0;              // drive output 0..1 (visual)
    this.aux = 0;
    this.t = 0;
    this.gLocal = new THREE.Vector3();
    this.flightInput = null;
    this.hits = 0;
    this.link = { ok: false, d: 0, known: false, t: 0 };
    this.xfer = null;            // propellant transfer while docked: 'toH8' (automatic) | 'toB29'
    this.driveMode = 'normal';   // low (less thrust, less power) | normal | ultra (x4 the old ULTRA) | max (x2 that)
    this.fuelSaid = 0;
    this.flickT = 0;
    this.cands = [];
    this.rockSeq = 0;
    this.circuits = { drive: 1, power: 1, sensor: 1, comms: 1, fire: 1 };
    this.airlock = { mode: 'idle' };   // the shaft as an airlock (away from B-29)
    this.issueProxies = new Map();
    this.field = [];
    this.floorHatch = 0;         // the cockpit floor hatch 0 shut .. 1 open
    this.mind = new HachiMind(this);                 // what HACHI works out and acts on
    this.defence = new HachiDefence(this);           // HACHI's watch over a fight: LOW, the ammunition
  }

  // ==================================================================== construction helpers
  buildNeckHatch() {
    const M = this.M;
    const g = new THREE.Group();
    const add = (geo, mat, p, r) => { const m = new THREE.Mesh(geo, mat); if (p) m.position.set(...p); if (r) m.rotation.set(...r); g.add(m); return m; };
    add(new THREE.CylinderGeometry(H8.shaftR - 0.004, H8.shaftR - 0.004, 0.06, 44), M.metalDark);
    add(new THREE.TorusGeometry(H8.shaftR - 0.04, 0.014, 8, 44), M.steel, [0, 0.032, 0], [Math.PI / 2, 0, 0]);
    add(new THREE.TorusGeometry(H8.shaftR - 0.04, 0.014, 8, 44), M.steel, [0, -0.032, 0], [Math.PI / 2, 0, 0]);
    // handwheels both sides, a viewport, stencil
    for (const s of [-1, 1]) {
      add(new THREE.TorusGeometry(0.13, 0.012, 8, 28), M.handrail, [0, s * 0.075, 0], [Math.PI / 2, 0, 0]);
      add(new THREE.CylinderGeometry(0.025, 0.025, 0.05, 12), M.steel, [0, s * 0.05, 0]);
      for (let k = 0; k < 3; k++) { const m = add(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 6), M.steel, [0, s * 0.075, 0], [Math.PI / 2, (k / 3) * Math.PI, 0]); m.rotation.order = 'YXZ'; }
    }
    add(new THREE.CylinderGeometry(0.055, 0.055, 0.065, 20), M.lens, [0.22, 0, 0.1]);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; add(new THREE.BoxGeometry(0.06, 0.07, 0.04), M.metal, [Math.cos(a) * (H8.shaftR - 0.07), 0, Math.sin(a) * (H8.shaftR - 0.07)], [0, -a, 0]); }
    g.position.copy(NECK_HATCH);
    g.traverse((o) => o.layers.set(LAYER_NEAR));
    this.neckHatch = g;
    this.root.add(g);
  }

  buildBeacon() {
    // seen from far away: a small light that double-flashes amber (and the hull's own glints)
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,220,160,0.9)'); gr.addColorStop(0.5, 'rgba(255,160,60,0.25)'); gr.addColorStop(1, 'rgba(255,140,40,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    this.glowTex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffc070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false });
    this.beacon = new THREE.Sprite(mat);
    this.beacon.scale.setScalar(0.012);
    this.beacon.matrixAutoUpdate = false;
    this.beacon.visible = false;
    this.beacon.renderOrder = 30;
  }

  /** after the game's systems exist: B-29's port hardware, physics, interactions, monitors */
  init() {
    const g = this.g;
    const scene = g.engine.scene;
    scene.add(this.root);
    scene.add(this.beacon);
    // ---- B-29 side: the sliding hatch, the well's walls, the umbilical
    this.hatch = new DorsalHatch(g.shipVis.M, g.phys);
    g.shipVis.root.add(this.hatch.group);
    {
      // what the cameras see of the port from H8's cockpit: the mated neck's plate (dark metal)
      const cap = new THREE.Mesh(new THREE.CircleGeometry(PORT.r + 0.2, 40), g.shipVis.M.metalDark || g.shipVis.M.hullDark);
      cap.rotation.x = -Math.PI / 2;
      cap.position.set(0, PORT.yCollar + 0.012, PORT.z);
      cap.layers.set(LAYER_NEAR);
      cap.visible = false;
      g.shipVis.root.add(cap);
      this.collarCap = cap;
    }
    const well = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const m = new THREE.Matrix4().makeRotationY(-a).setPosition(Math.cos(a) * (PORT.r + 0.04), (2.36 + PORT.yCollar) / 2, PORT.z + Math.sin(a) * (PORT.r + 0.04));
      well.push({ type: 'box', hx: 0.03, hy: (PORT.yCollar - 2.36) / 2, hz: 0.1, m });
    }
    const wellCols = g.phys.addColliders(well);
    if (g.b29Static) g.b29Static.push(...wellCols);
    this.buildUmbilical();
    // ---- H8 interior in the physics frame (enabled while it can be reached)
    const off = new THREE.Matrix4().makeTranslation(DOCK.x, DOCK.y, DOCK.z);
    const cols = this.int.colliders.map((c) => (c.type === 'mesh' ? { type: 'mesh', geo: c.geo.clone().applyMatrix4(off) } : Object.assign({}, c, { m: off.clone().multiply(c.m) })));
    this.cols = g.phys.addColliders(cols);
    this.neckCol = g.phys.addKinematicBox(H8.shaftR * 0.92, 0.04, H8.shaftR * 0.92, NECK_HATCH.clone().add(DOCK));
    // ---- the outer hull, for anyone outside: a hollow shell (inside it the cabin's own colliders
    // hold) with the docking neck's tube through its bottom
    {
      // a UV sphere with its pole on the neck's axis, cut off just outside the neck tube (so the
      // shaft stays clear and nothing slips in round the tube)
      const RS = H8.R + 0.05, rt = H8.neckR + 0.03;
      const holeDir = V(0, -Math.sqrt(RS * RS - H8.shaftZ * H8.shaftZ), H8.shaftZ).normalize();
      const shell = new THREE.SphereGeometry(RS, 64, 32, 0, Math.PI * 2, 0, Math.PI - Math.asin((rt + 0.02) / RS));
      shell.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), holeDir));
      shell.translate(DOCK.x, DOCK.y, DOCK.z);
      const nTop = -H8.R * 0.97, nBot = H8.neckBottom;
      const neck = new THREE.CylinderGeometry(H8.neckR + 0.03, H8.neckR + 0.03, nTop - nBot, 24, 1, true);
      neck.translate(DOCK.x, DOCK.y + (nTop + nBot) / 2, DOCK.z + H8.shaftZ);
      this.extCols = g.phys.addColliders([{ type: 'mesh', geo: shell }, { type: 'mesh', geo: neck }]);
      for (const c of this.extCols) c.setEnabled(false);
      this._extOn = false;
    }
    this.buildJunctions();
    this.colsOn = true;
    this.setColliders(false);
    // ---- lamps (physics frame), the seat, taps
    this.lamps = this.int.lamps.map((l) => Object.assign({}, l, { local: l.pos.clone(), pos: l.pos.clone().add(DOCK), base: l.intensity }));
    this.lampsIn = false;
    const s = this.int.seat;
    // standing up puts Kaito over the floor hatch behind the seat; the seat rides on its gimbal
    // (h8Seat.js works out the eye and the motion's tilt every frame)
    this.seat = Object.assign({}, s, { eye: s.eye.clone().add(DOCK), exit: V(0, H8.floorY, H8.shaftZ).add(DOCK), axis: s.axis.clone().add(DOCK), h8: true, dock: DOCK.clone() });
    this.seatMotion = new SeatMotion(this.seat, this.int.seatParts);
    // (the shelter runs the seat back into it on its rail; in there it is the shelter's seat, with
    // the same eye and the same motion)
    this.shelter.attachSeat(this.seat, this.int.seatParts);
    this.shelter.seat.dynQ = this.seat.dynQ;
    // the floor hatch over the shaft: walkable while shut
    this.floorCol = g.phys.addKinematicBox(FLOOR.hatchR + 0.03, 0.03, FLOOR.hatchR + 0.03, V(FLOOR.hatch.x, FLOOR.y - 0.03, FLOOR.hatch.z).add(DOCK));
    this.floorCol.col.setEnabled(this.colsOn);
    const proxy = (pos, r) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), g.interact.proxyMat);
      m.position.copy(pos); m.layers.set(LAYER_PROXY);
      this.int.group.add(m);
      return m;
    };
    g.interact.addMesh(proxy(SEAT.G.clone().add(V(0, -0.12, -0.08)), 0.36), () => g.systems.sit(this.seat), { maxDist: 2.2, enabled: () => g.player.state !== 'seated' && this.shelter.atHome });
    // the floor hatch (from above; it opens by itself for Kaito coming up the shaft)
    g.interact.addMesh(proxy(V(FLOOR.hatch.x, FLOOR.y + 0.12, FLOOR.hatch.z), 0.38), () => this.floorHatchTapped(), { maxDist: 2.2, enabled: () => g.player.state !== 'seated' && g.player.pos.y > FLOOR.y + DOCK.y });
    // the port panel in B-29's corridor, and the hatch wheel seen from the shaft in H8
    g.interact.addSphere(PORT.panel.clone().add(V(0.04, 0, 0)), 0.16, () => this.portTapped(), { maxDist: 2.2 });
    g.interact.addMesh(proxy(NECK_HATCH.clone().add(V(0, 0.12, 0)), 0.32), () => this.portTapped(), { maxDist: 2.4 });
    // ---- H8's corner on B-29's own screens (the cockpit itself has no screens of that kind: all
    // its information is on the tabs of the all-round display)
    Object.assign(Object.getPrototypeOf(g.monitors), H8_PAGES);
    // touches on the display's tabs (tap, fold, drag) are theirs, not the look's
    g.input.capture = (x, y, touches) => this.tabTouch(x, y, touches);
    g.input.captureMove = (t) => this.tabMove(t);
    g.input.captureUp = (t, tap) => this.tabUp(t, tap);
    g.input.captureWheel = (x, y, dy) => this.tabWheel(x, y, dy);
    // the shelter's screens and its door; its lamp in the light pool
    this.shelter.init(g);
    this.lamps.push({ pos: V(0, SHELTER.y1 - 0.05, 1.25).add(DOCK), local: V(0, SHELTER.y1 - 0.05, 1.25), color: 0xffa060, intensity: 0, base: 0, range: 1.5, room: 'h8', shelter: true });
    // ---- a new game: H8 waits right above B-29, on standby
    if (!this.park) this.initAbove();
    this.placeParked(g.time);
  }

  /** the access panels over the junction boxes (a status lamp each: red and blinking when cut) */
  buildJunctions() {
    const M = this.M;
    this.jLamps = {};
    for (const [k, J] of Object.entries(JUNCTIONS)) {
      const f = new THREE.Matrix4().lookAt(V(0, 0, 0), J.dir.clone().negate(), Math.abs(J.dir.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(f);
      const at = J.dir.clone().multiplyScalar(H8.R + 0.035);
      const g = new THREE.Group();
      g.position.copy(at); g.quaternion.copy(q);
      const add = (geo, mat, p) => { const m = new THREE.Mesh(geo, mat); if (p) m.position.set(...p); g.add(m); return m; };
      add(new THREE.BoxGeometry(0.44, 0.3, 0.045), M.metalDark);
      add(new THREE.BoxGeometry(0.4, 0.26, 0.012), M.trim, [0, 0, 0.026]);
      for (const [x, y] of [[-0.17, -0.11], [0.17, -0.11], [-0.17, 0.11], [0.17, 0.11]]) add(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 8), M.steel, [x, y, 0.034]).rotation.x = Math.PI / 2;
      const lampMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.2, 1.0, 0.4), emissiveIntensity: 2 });
      add(new THREE.SphereGeometry(0.018, 10, 8), lampMat, [0.15, 0.1, 0.04]);
      g.updateMatrixWorld(true);
      g.traverse((o) => { if (o.isMesh) { o.layers.set(LAYER_NEAR); this.extMeshes.push(o); } });
      this.ext.group.add(g);
      this.jLamps[k] = lampMat;
    }
  }

  /** park H8 just above B-29's back (60 m up), on the circular orbit through that point */
  initAbove() {
    const fb = this.g.flight;
    const p = fb.pos.clone().addScaledVector(_v.set(0, 1, 0).applyQuaternion(fb.quat), 60);
    const h = new THREE.Vector3().crossVectors(fb.pos, fb.vel).normalize();
    const r = p.length();
    this.park = { r, n: Math.sqrt(MU_EARTH / (r * r * r)), h, e1: p.clone().normalize(), t0: this.g.time };
  }

  buildUmbilical() {
    const g = this.g, M = this.M;
    this.umbMat = M.cableOrange;
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), M.cableOrange);
    mesh.frustumCulled = false;
    mesh.layers.set(LAYER_NEAR); mesh.layers.enable(LAYER_MID);
    this.umbMesh = mesh;
    const head = new THREE.Group();
    const add = (geo, mat, p, r) => { const m = new THREE.Mesh(geo, mat); if (p) m.position.set(...p); if (r) m.rotation.set(...r); head.add(m); return m; };
    add(new THREE.CylinderGeometry(0.09, 0.11, 0.2, 20), M.metalDark);
    add(new THREE.CylinderGeometry(0.115, 0.115, 0.03, 20), M.trim, [0, 0.06, 0]);
    add(new THREE.BoxGeometry(0.05, 0.05, 0.05), M.ledA, [0.1, 0.0, 0]);
    head.traverse((o) => { o.layers.set(LAYER_NEAR); o.layers.enable(LAYER_MID); });
    this.umbHead = head;
    g.shipVis.root.add(mesh, head);
    mesh.visible = head.visible = false;
    const sock = receptacleSocket();
    this.sock = sock;
  }

  /** a fresh parking orbit: 600 km, in B-29's plane, 25 degrees ahead */
  initPark() {
    const f = this.g.flight;
    const h = new THREE.Vector3().crossVectors(f.pos, f.vel).normalize();
    const e1 = f.pos.clone().normalize().applyAxisAngle(h, 25 * Math.PI / 180);
    const r = R_EARTH + 600e3;
    this.park = { r, n: Math.sqrt(MU_EARTH / (r * r * r)), h, e1, t0: this.g.time };
  }

  /** park where it is now (circular orbit through the current position) */
  parkHere() {
    const f = this.flight;
    const h = new THREE.Vector3().crossVectors(f.pos, f.vel);
    if (h.lengthSq() < 1e-6) h.copy(f.hRef); else h.normalize();
    const r = f.pos.length();
    this.park = { r, n: Math.sqrt(MU_EARTH / (r * r * r)), h, e1: f.pos.clone().normalize(), t0: this.g.time };
  }

  parkPos(t, pos, vel) {
    const P = this.park;
    const ang = P.n * (t - P.t0) / 1000;
    pos.copy(P.e1).applyAxisAngle(P.h, ang).multiplyScalar(P.r);
    if (vel) vel.crossVectors(P.h, pos).normalize().multiplyScalar(P.r * P.n);
    return pos;
  }

  placeParked(t) {
    const f = this.flight;
    this.parkPos(t, f.pos, f.vel);
    f.hRef.copy(this.park.h);
    f.updateAttitude();
  }

  // ==================================================================== geometry queries
  /** a physics-frame point inside H8's pressurised volume (cockpit, shaft, neck) */
  containsPF(p) {
    if (this.shelter && this.shelter.containsPF(p)) return true;
    const x = p.x - DOCK.x, y = p.y - DOCK.y, z = p.z - DOCK.z;
    const C = H8.cockpitC;
    if ((x - C.x) ** 2 + (y - C.y) ** 2 + (z - C.z) ** 2 < (H8.cockpitR + 0.1) ** 2 && y > H8.floorY - 0.05) return true;
    if (Math.hypot(x, z - H8.shaftZ) < H8.shaftR + 0.05 && y > H8.neckHatchY - 0.05 && y < H8.floorY + 0.1) return true;
    return false;
  }

  /** in the cockpit's air (above the floor hatch), as opposed to the shaft's */
  inCockpitAir(p) {
    const C = H8.cockpitC;
    const x = p.x - DOCK.x, y = p.y - DOCK.y, z = p.z - DOCK.z;
    return y > H8.floorY - 0.02 && (x - C.x) ** 2 + (y - C.y) ** 2 + (z - C.z) ** 2 < (H8.cockpitR + 0.1) ** 2;
  }

  /** the opening between the shaft and the cockpit (the floor hatch) */
  floorFlowArea() { return this.floorHatch > 0.01 ? Math.PI * H8.shaftR * H8.shaftR * Math.min(1, this.floorHatch * 1.4) : 0; }

  /** the vestibule between B-29's hatch and H8's (the port tunnel) */
  inVestibule(p) {
    return Math.hypot(p.x, p.z - PORT.z) < PORT.r + 0.05 && p.y > PORT.hatchY + 0.03 && p.y < DOCK.y + H8.neckHatchY;
  }

  /** the climbing column: B-29's well, the tunnel and H8's shaft */
  inColumn(p) {
    return Math.hypot(p.x, p.z - PORT.z) < PORT.r + 0.05 && p.y > 1.9 && p.y < DOCK.y + H8.floorY + 0.3;
  }

  get docked() { return this.mode === 'docked'; }

  /** Kaito inside H8, or strapped into its seat (then his body is put there too) */
  kaitoInside() {
    const pl = this.g.player;
    if (pl.state === 'dead') return false;
    if (pl.state === 'seated' && this.shelter && pl.seat === this.shelter.seat) return true;
    if (pl.state === 'seated' && pl.seat === this.seat) {
      if (!this.containsPF(pl.pos)) pl.teleport(this.seat.exit.clone().add(V(0, 0.85, 0)));
      return true;
    }
    return this.containsPF(pl.pos);
  }

  /** Kaito is flying with H8 away from B-29: the view, lamps and sounds ride with H8 */
  get solo() { return this.crew && this.mode !== 'docked'; }

  /** world (ECI) pose */
  pose() { return { pos: this.flight.pos, quat: this.flight.quat, vel: this.flight.vel }; }

  /** speed against the local orbit (m/s) */
  relSpeed() { const f = this.flight; return f.vel.clone().sub(f.refVelocity(f.pos, new THREE.Vector3())).length(); }

  /** HACHI's long-range target for B-29's autopilot (nav entry "H8") */
  navTarget() {
    const self = this;
    if (!this._nav) {
      this._nav = {
        id: 'h8', name: 'H8（サブ拠点）', en: 'H8', kind: 'h8', standoff: 150, tether: false,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        posOf(t, pos, vel) { if (self.mode === 'parked') self.parkPos(t, pos, vel); else { pos.copy(self.flight.pos); vel.copy(self.flight.vel); } return pos; },
      };
    }
    this._nav.posOf(this.g.time, this._nav.pos, this._nav.vel);
    return this._nav;
  }

  // ==================================================================== commands
  say(key, params, opts) { this.g.asphalt.say(key, params || {}, Object.assign({ who: 'hachi', force: true }, opts || {})); }
  asphalt(key, params, opts) { this.g.asphalt.say(key, params || {}, Object.assign({ force: true }, opts || {})); }

  /** wake H8 up (remote link) and bring it to B-29's back */
  call() {
    const g = this.g;
    if (this.mode === 'docked' || this.mode === 'lost' || this.mode === 'pod') return;
    const L = this.linkState();
    if (!L.ok) { this.asphalt(L.why === 'range' ? 'h8_out_of_range' : 'h8_link_down', { d: fmtDist(L.d) }); return; }
    // the flight costs H8 propellant: not enough for the trip, no trip
    const need = this.tripFuel(this.flight, L.d);
    if (this.flight.tank.kg < need) { this.asphalt('h8_no_fuel', { need: Math.ceil(need), kg: Math.floor(this.flight.tank.kg) }); return; }
    const was = this.mode;
    this.wake();
    const d = L.d;
    if (this.berthAt) { this.unberth('b29'); this.say('hachi_coming', { d: fmtDist(d) }); return; }
    this.goal('b29');
    if (was === 'parked') {
      this.asphalt('h8_call', { d: fmtDist(d) });
      setTimeout(() => this.say('hachi_wake', { d: fmtDist(d) }), 2600);
    } else this.say('hachi_coming', { d: fmtDist(d) });
  }

  /** the radio link between the two (always up while docked: a cable runs through the port) */
  linkState() {
    const g = this.g;
    const d = this.flight.pos.distanceTo(g.flight.pos);
    if (this.mode === 'docked') return { ok: true, d: 0, why: null };
    const dm = g.damage ? g.damage.health : null;
    if (dm && dm.servers < 0.2) return { ok: false, d, why: 'b29' };
    if (d > LINK_RANGE * this.circ('comms', 0.25)) return { ok: false, d, why: 'range' };
    return { ok: true, d, why: null };
  }

  /** the data link's quality 0..1 (weaker toward the edge of its range, and with the comms circuit cut) */
  linkQuality() {
    if (this.mode === 'docked') return 1;
    if (!this.link.ok) return 0;
    return Math.max(0.05, (1 - 0.55 * (this.link.d / LINK_RANGE) ** 2) * this.circ('comms', 0.4));
  }

  /**
   * Propellant a ship needs to come over to the other one d metres away (kg): out to cruise speed
   * and back down again, plus what holding a level path at that speed takes against the orbit
   */
  tripFuel(fl, d) {
    if (!fl.tank) return 0;
    // H8 as it flies once awake (boosted from its storage), B-29 on its ULTRA drive
    const own = fl === this.flight;
    const health = Math.max(0.2, 0.2 + 0.8 * this.armour.inner);
    const vmax = own ? fl.spec.ultraMax * (this.power.boost ? 2 : 1) * health : fl.spec.ultraMax * Math.max(0.2, fl.driveHealth);
    const a = own ? 14 * Math.max(0.3, health) * (this.power.boost ? 1.4 : 1) : 2.2;
    const v = Math.max(1, Math.min(vmax, Math.sqrt(a * d)));
    const hold = Math.min(30, (2 * 7700 * v + v * v) / 6.8e6);
    return 1.15 * fl.fuelFor(2 * v + hold * d / v * 0.6 + 25);
  }

  /** H8 calls B-29 over: B-29's autopilot flies it here (on B-29's propellant), then HACHI docks */
  callB29() {
    const g = this.g, ap = g.autopilot, fb = g.flight;
    if (this.mode === 'docked') return;
    const L = this.linkState();
    if (!L.ok) { this.say('hachi_no_link', { d: fmtDist(L.d) }); return; }
    if (fb.landed) { this.say('hachi_b29_landed'); return; }
    if (ap.state !== 'off' && ap.target && ap.target.id === 'h8') { this.say('hachi_b29_coming', { d: fmtDist(L.d) }); return; }
    // (B-29 cannot come into a station's structure: H8 casts off and waits clear of it)
    if (this.berthAt) { this.unberth('callb29'); return; }
    const need = this.tripFuel(fb, L.d);
    if (fb.tank && fb.tank.kg < need) { this.say('hachi_b29_nofuel', { need: Math.ceil(need), kg: Math.floor(fb.tank.kg) }); return; }
    this.wake();
    if (this.goalKind === 'b29' || this.goalKind === 'escort') this.goal('hold');
    this.say('hachi_call_b29', { d: fmtDist(L.d) });
    if (g.docking && g.docking.state === 'docked') {
      // at a station's berth: cast off first, then come
      g.docking.request();
      this.b29Pending = g.time;
      setTimeout(() => this.asphalt('h8_called_undock', { d: fmtDist(L.d) }), 2800);
      return;
    }
    if (g.docking && g.docking.state !== 'free') { this.b29Pending = g.time; return; }
    this.b29Go();
  }

  /** B-29 sets off toward H8 (on the ULTRA drive when it is far) */
  b29Go() {
    const g = this.g, fb = g.flight, d = this.flight.pos.distanceTo(fb.pos);
    if (!g.autopilot.engage('h8')) return;
    if (d > 30000 && !fb.ultra && fb.driveHealth >= 0.45) fb.setUltra(true);
    setTimeout(() => this.asphalt('h8_called', { d: fmtDist(d) }), 2800);
  }

  /** each AI tells the other how its ship is doing (over the link) */
  reportB29() {
    const g = this.g, L = this.linkState();
    if (!L.ok) { this.say('hachi_no_link', { d: fmtDist(L.d) }); return; }
    const ap = g.autopilot, f = g.flight;
    const state = g.docking && g.docking.state === 'docked' ? (g.docking.station ? g.docking.station.name + 'にドッキング中' : 'ドッキング中')
      : ap.state === 'cruise' || ap.state === 'approach' ? (ap.target ? ap.target.name : '目的地') + 'へ自動航行中' : ap.state === 'hold' ? '位置を保持中' : f.landed ? '地上に着陸中' : '待機中';
    const integ = Math.round((g.damage.integrityNow ?? g.damage.integrity()) * 100);
    this.asphalt('b29_report', { state, fuel: Math.round(f.fuel * 100), integ, pw: Math.round((g.systems.power ?? 1) * 100), d: L.d > 0 ? fmtDist(L.d) : '0 m' });
  }

  reportH8() {
    const L = this.linkState();
    if (!L.ok) { this.asphalt(L.why === 'range' ? 'h8_out_of_range' : 'h8_link_down', { d: fmtDist(L.d) }); return; }
    const st = this.mode === 'docked' ? 'B-29と結合中' : this.mode === 'parked' ? '停泊軌道で待機中' : this.pilot.goal ? this.pilot.goal.name + 'へ航行中' : this.crew ? 'カイトが操縦中' : '待機中';
    this.say('hachi_report', { state: st, fuel: Math.round(this.flight.fuel * 100), arm: Math.round(this.armour.outer * 100), smes: Math.round(this.power.smes / H8.smesMJ * 100), d: L.d > 0 ? fmtDist(L.d) : '0 m' });
  }

  /** H8's screens run on H8's own power (adrift, the shelter's on its battery) */
  screenPower() {
    if (this.mode === 'pod') return this.shelter.battery > 0 ? 0.6 : 0;
    if (this.mode === 'lost') return 0;
    return this.awake > 0.15 ? Math.min(1, 0.4 + this.awake * 0.6) : this.mode === 'docked' ? 0.35 : 0;
  }

  /** the shelter's door (0 shut .. 1 open) */
  get shelterOpen() { return this.shelter ? this.shelter.door : 0; }

  /** one of H8's seats: the pilot's in the middle of the cockpit, or the shelter's */
  isH8Seat(seat) { return !!seat && (seat === this.seat || (this.shelter && seat === this.shelter.seat)); }

  /** move propellant between the two through the docking port's lines (docked only) */
  setXfer(mode) {
    if (this.mode !== 'docked') return;
    this.xfer = this.xfer === mode ? null : mode;
    this.say(this.xfer === 'toB29' ? 'hachi_xfer_b29' : this.xfer === 'toH8' ? 'hachi_xfer_h8' : 'hachi_xfer_stop', {}, { minGap: 3 });
  }

  wake() {
    if (this.mode === 'parked') {
      this.mode = 'free';
      this.flight.setSpeed = 0;
      this.flight.autopilot = null;
    }
    this.wakeTarget = 1;
  }

  /** HACHI's goals: 'b29' (rendezvous + dock), 'escort' (hold above B-29), 'home', 'hold',
   * or a station id */
  goal(kind) {
    const g = this.g, P = this.pilot;
    // lying at a station's port: cast off first, then go
    if (this.berthAt && kind && kind !== 'hold') { this.unberth(kind); return; }
    if (kind !== this.goalKind) this.dockGoal = null;
    const b29 = (t, pos, vel) => { pos.copy(g.flight.pos); vel.copy(g.flight.vel); return pos; };
    if (kind === 'b29') {
      P.setGoal({ kind, name: 'B-29', posOf: b29, standoff: 90, onArrive: null });
      this.goalKind = 'b29';
    } else if (kind === 'escort') {
      P.setGoal({ kind, name: 'B-29', posOf: (t, pos, vel) => { b29(t, pos, vel); pos.addScaledVector(_v.set(0, 1, 0).applyQuaternion(g.flight.quat), 70); return pos; }, standoff: 0 });
      this.goalKind = 'escort';
    } else if (kind === 'home') {
      // back to the parking orbit's slot at 600 km (a fresh one if it drifted far)
      if (!this.park || Math.abs(this.park.r - (R_EARTH + 600e3)) > 1e5) this.initParkFrom(this.flight);
      P.setGoal({ kind, name: 'H8 停泊軌道', posOf: (t, pos, vel) => this.parkPos(t, pos, vel), standoff: 0, onArrive: () => this.parkNow() });
      this.goalKind = 'home';
    } else if (kind === 'hold' || !kind) {
      P.setGoal(null);
      this.flight.setSpeed = 0;
      this.goalKind = null;
    } else {
      const s = g.stations.byId(kind);
      if (!s) return;
      P.setGoal({ kind: 'station', station: s, name: s.name, posOf: (t, pos, vel) => g.stations.posOf(s, t, pos, vel), standoff: (s.model && s.model.userData.radius || 150) + 350, tether: !!s.tether, onArrive: () => this.say('hachi_arrived', { name: s.name }) });
      this.goalKind = kind;
    }
  }

  initParkFrom(f) {
    const h = new THREE.Vector3().crossVectors(f.pos, f.vel).normalize();
    const r = R_EARTH + 600e3;
    this.park = { r, n: Math.sqrt(MU_EARTH / (r * r * r)), h, e1: f.pos.clone().normalize().applyAxisAngle(h, 0.02), t0: this.g.time };
  }

  parkNow() {
    this.parkHere();
    this.pilot.setGoal(null);
    this.goalKind = null;
    if (!this.crew) {
      this.mode = 'parked';
      this.wakeTarget = 0;
      this.say('hachi_parked');
    }
  }

  sendHome() {
    if (this.mode === 'docked') { this.release('home'); return; }
    this.wake();
    this.goal('home');
    this.say('hachi_home');
  }

  /** undock: close the hatches, unlatch, back off; then 'escort' (default), 'home' or 'free' */
  release(after = 'escort') {
    const g = this.g;
    if (this.mode !== 'docked') return;
    if (this.pending) return;
    const pl = g.player;
    if (this.inVestibule(pl.pos) && pl.state !== 'dead') { this.say('hachi_vestibule'); return; }
    if (g.docking && g.docking.state === 'approach') { this.say('hachi_busy'); return; }
    this.crew = this.kaitoInside();
    if (this.crew) after = 'free';
    if (this.hatch.open > 0 || this.neckOpen > 0 || this.hatch.target > 0) {
      this.hatch.setTarget(0); this.neckTarget = 0;
      this.pending = { kind: 'release', after };
      this.say('hachi_hatch_closing');
      return;
    }
    this.unlatch(after);
  }

  unlatch(after) {
    const g = this.g;
    this.pending = null;
    this.resetDrive();
    this.mode = 'free';
    this.umbTarget = 0;
    // H8 starts from where it is on B-29's back, with B-29's motion
    const fb = g.flight, f = this.flight;
    f.pos.copy(DOCK).applyQuaternion(fb.quat).add(fb.pos);
    f.vel.copy(fb.vel);
    f.hRef.copy(fb.hRef);
    f.qRel.copy(fb.qRel);
    f.wRel.set(0, 0, 0);
    f.updateAttitude();
    f.setSpeed = 0;
    this.attachTo(false);
    this.applyBoost(false);
    this.pilot.startUndock(after);
    g.audio.mech(V(0, 2.6, PORT.z), 'clamp', { open: true });
    g.shake = Math.max(g.shake, 0.3);
    this.say(this.crew ? 'hachi_undock_crew' : 'hachi_undock');
    if (!this.crew) setTimeout(() => this.asphalt('h8_undocked'), 3500);
  }

  /** the pilot's final approach touched down: latches close */
  latch() {
    const g = this.g;
    this.resetDrive();
    this.mode = 'docked';
    this.pilot.setGoal(null);
    this.goalKind = null;
    this.attachTo(true);
    this.syncDocked();
    this.latchT = 1.2;
    this.umbTarget = this.power.feedOn ? 1 : 0;
    this.applyBoost(true);
    g.audio.impact(V(0, 3.0, PORT.z), 0.16);
    g.audio.mech(V(0, 3.0, PORT.z), 'clamp', { open: false });
    g.shake = Math.max(g.shake, 0.45);
    this.say('hachi_docked');
    if (!this.metAsphalt) {
      this.metAsphalt = true;
      setTimeout(() => this.asphalt('h8_docked'), 4200);
      setTimeout(() => this.say('hachi_reply'), 7600);
    }
  }

  /** a rock heading this way while Kaito flies H8 alone */
  rockWarning(a) {
    const f = this.flight;
    const rel = a.pos.clone().sub(f.pos), rv = a.vel.clone().sub(f.vel);
    const tca = -rel.dot(rv) / Math.max(rv.lengthSq(), 1e-6);
    const miss = rel.clone().addScaledVector(rv, tca).length();
    if (miss < 400) this.say(a.radius <= 0.8 ? 'hachi_rock_small' : 'hachi_rock', { km: (rel.length() / 1000).toFixed(1) }, { minGap: 10, force: false });
  }

  /** clear of B-29 after an undock: HACHI escorts, flies home, or hands the controls to Kaito */
  afterUndock(after) {
    if (after && after.goto) { this.goTo(after.goto); return; }
    if (after === 'home') { this.goal('home'); this.say('hachi_home'); }
    else if (after === 'free') { this.goal('hold'); this.say('hachi_manual'); }
    else if (after === 'callb29') { this.goal('hold'); this.b29Go(); }
    else if (typeof after === 'string' && after.startsWith('dock:')) this.dockWith(after.slice(5));
    else if (after && after !== 'escort') this.goal(after);
    else { this.goal('escort'); }
  }

  // ==================================================================== H8 alone at a station
  /**
   * Dock H8 by itself with a station: HACHI flies there at full pace and, once within reach,
   * goes straight into the docking (no stop at the hold point): round the station to its top and
   * down onto its H8 port. Lying there H8 rides with the station and is charged and refuelled.
   */
  dockWith(id) {
    const g = this.g, s = g.stations.byId(id);
    if (!s || this.mode === 'docked' || this.mode === 'pod' || this.mode === 'lost') return false;
    if (s.dmg && (s.dmg.status === 'destroyed' || s.dmg.status === 'failed')) { this.say('hachi_dock_dead', { name: s.name }, { minGap: 3 }); return false; }
    if (this.berthAt === s) return true;
    if (this.berthAt) { this.unberth('dock:' + id); return true; }
    this.wake();
    this.goal(id);
    this.dockGoal = s;
    this.say('hachi_berth_go', { name: s.name }, { minGap: 2 });
    return true;
  }

  /** the pilot's final approach touched the station's port: latches close */
  berth(s) {
    const g = this.g;
    this.resetDrive();
    this.berthAt = s;
    this.dockGoal = null;
    this.pilot.setGoal(null);
    this.goalKind = null;
    this.holdBerth();
    this.latchT = 1.2;
    if (this.crew) { g.audio.impact(V(0, -3.5, 0.8).add(DOCK), 0.16); g.audio.mech(V(0, -3.5, 0.8).add(DOCK), 'clamp', { open: false }); g.shake = Math.max(g.shake, 0.45); }
    this.say('hachi_berthed', { name: s.name });
  }

  /** cast off from the station's port (then: after, as for an undocking from B-29) */
  unberth(after = 'free') {
    const s = this.berthAt;
    if (!s) return;
    this.berthAt = null;
    this.pilot.startUndockStation(s, this.g.stations.h8PortOf(s), after);
    this.say('hachi_unberth', { name: s.name }, { minGap: 2 });
  }

  /** lying at the port: H8 rides with the station (in place of a flight step) */
  holdBerth() {
    const g = this.g, s = this.berthAt, f = this.flight;
    const pose = g.docking.stationPose(s, g.time, this._bpose || (this._bpose = {}));
    f.pos.copy(g.stations.h8PortOf(s)).applyQuaternion(pose.quat).add(pose.pos);
    g.docking.frameVel(s, pose, f.pos, f.vel);
    f.quat.copy(pose.quat);
    f.qRel.copy(f.lvlhQuat(f.pos, _q2).invert().multiply(pose.quat));
    f.wRel.set(0, 0, 0);
    f.setSpeed = 0;
    f.autopilot = null;
    // what a point riding the station feels: weightless in orbit, ~0.88 g on the elevator
    const r = f.pos.length();
    const grav = _v.copy(f.pos).multiplyScalar(-MU_EARTH / (r * r * r));
    const pr = pose.pos.length();
    const aFrame = s.tether ? _v2.set(-OMEGA_EARTH * OMEGA_EARTH * f.pos.x, 0, -OMEGA_EARTH * OMEGA_EARTH * f.pos.z) : _v2.copy(pose.pos).multiplyScalar(-MU_EARTH / (pr * pr * pr));
    f.properAcc.copy(aFrame).sub(grav);
    f.thrustAcc.set(0, 0, 0);
  }

  /** HACHI's speed and braking (H8's drive, on its own reactor or with the storage boost) */
  maxSpeed() { return this.flight.vUltra * Math.max(0.2, this.driveHealth()); }
  brakeAccel() { return 14 * Math.max(0.3, this.driveHealth()) * (this.flight.mul > 1 ? 1.4 : 1) * this.flight.aK; }

  // ==================================================================== drive modes
  /** the flight H8's drive is pushing: its own, or the pair's while docked */
  driveFlight() { return this.mode === 'docked' ? this.g.flight : this.flight; }

  /** the speed it can reach now (m/s) */
  maxSpeedNow() { const f = this.driveFlight(); return (f.ultra ? f.vUltra : f.vNormal) * Math.max(0.2, f.driveHealth); }

  driveModeName(id = this.driveMode) { return { low: 'LOW', normal: '通常', ultra: 'ULTRA', max: 'MAX' }[id] || '通常'; }

  /** what can be chosen now: [{ id, label, on, ok, why }] */
  driveModes() {
    const f = this.driveFlight(), P = this.power;
    const health = this.driveHealth(), smes = P.smes / H8.smesMJ;
    const fuel = f === this.flight ? f.fuel : Math.max(f.fuel, this.flight.fuel);
    const why = (need) => (this.awake < 0.5 ? 'H8 休止中' : health < 0.45 ? '推進系損傷' : fuel < 0.02 ? '推進剤なし' : smes < need ? '蓄電不足' : null);
    const wU = why(0.1), wM = why(0.2);
    return [
      { id: 'low', label: 'LOW', on: this.driveMode === 'low', ok: true },
      { id: 'normal', label: '通常', on: this.driveMode === 'normal', ok: true },
      { id: 'ultra', label: 'ULTRA ×4', on: this.driveMode === 'ultra', ok: !wU, why: wU },
      { id: 'max', label: 'MAX ×8', on: this.driveMode === 'max', ok: !wM, why: wM },
    ];
  }

  /**
   * low / normal / ultra / max: ULTRA reaches four times the old ULTRA speed, MAX twice that again
   * with the drive pushed to its limit (more thrust, a faster exhaust) — both draw far more power,
   * the storage runs down in minutes and the drive falls back by itself when it is nearly empty.
   * LOW is the other way: the ULTRA field off and half the thrust, the drive drawing well under
   * half its normal power (HACHI uses it to free power for the ammunition in a fight).
   * by: 'hachi' when HACHI does it (its watch over the fight tells the two apart)
   */
  setDriveMode(id, quiet = false, force = false, by = null) {
    const f = this.driveFlight();
    if (id !== 'normal' && id !== 'low' && !force) {
      const m = this.driveModes().find((x) => x.id === id);
      if (m && !m.ok) { if (!quiet) this.say('hachi_drive_denied', { why: m.why }, { minGap: 3 }); return false; }
    }
    const from = this.driveMode;
    const K = { low: [1, 0.5, 1], normal: [1, 1, 1], ultra: [4, 2, 2.4], max: [8, 3.5, 4.8] }[id] || [1, 1, 1];
    [f.ultraK, f.aK, f.veK] = K;
    f.maxMode = id === 'max';
    this.driveMode = id;
    if (id === 'normal' || id === 'low') { if (f.ultra) f.setUltra(false); }
    else if (!f.ultra) f.setUltra(true);
    if (!quiet) {
      const v = f.vUltra * Math.max(0.2, f.driveHealth);
      if (id === 'normal') this.say('hachi_drive_normal', {}, { minGap: 2 });
      else if (id === 'low') this.say('hachi_drive_low', {}, { minGap: 2 });
      else this.say(id === 'max' ? 'hachi_max_on' : 'hachi_ultra_on', { v: v > 9500 ? (v / 1000).toFixed(1) + ' km/s' : Math.round(v) + ' m/s' }, { minGap: 2 });
    }
    if (from !== id && this.defence) this.defence.onDrive(from, id, by === 'hachi');
    return true;
  }

  /** the ammunition fabricator's priority (Kaito's switch; its own function, apart from LOW) */
  toggleAmmoPriority() {
    const W = this.g.weapons, A = W && W.arsenal;
    if (!A) return;
    A.priority = !A.priority;
    this.defence.onPriority(A.priority);
    if (!A.priority) A.by = null;
    this.say(A.priority ? 'hachi_pri_on' : 'hachi_pri_off', {}, { minGap: 1 });
  }

  /** both flights back to their plain drive (docking, undocking); a LOW that HACHI is holding
   * for a fight carries over to the drive that now pushes */
  resetDrive() {
    for (const f of [this.flight, this.g.flight]) { f.ultraK = 1; f.aK = 1; f.veK = 1; f.maxMode = false; }
    const low = this.driveMode === 'low';
    this.driveMode = 'normal';
    if (low) {
      const F = this.driveFlight();
      [F.ultraK, F.aK, F.veK] = [1, 0.5, 1];
      this.driveMode = 'low';
    }
  }

  /** test / restore helper: H8 straight onto B-29's back */
  forceDock() {
    this.wakeTarget = 1; this.awake = 1;
    if (this.mode === 'docked') return;
    this.mode = 'free';
    this.metAsphalt = true;
    this.latch();
    this.umb = this.umbTarget;
  }

  /** test helper: H8 free near B-29 (offset in B-29's frame), awake, holding */
  forceFree(offset) {
    const fb = this.g.flight, f = this.flight;
    if (this.mode === 'docked') { this.attachTo(false); this.applyBoost(false); }
    this.mode = 'free';
    this.wakeTarget = 1; this.awake = 1;
    f.pos.copy(offset).applyQuaternion(fb.quat).add(fb.pos);
    f.vel.copy(fb.vel); f.hRef.copy(fb.hRef); f.qRel.copy(fb.qRel); f.wRel.set(0, 0, 0); f.updateAttitude();
    this.goal('hold');
  }

  /** the port button (B-29's corridor panel or the hatch wheel in H8's shaft) */
  portTapped() {
    const g = this.g;
    if (this.mode !== 'docked' && this.crew) { this.lockTapped(); return; }
    if (this.mode !== 'docked') {
      g.audio.denied(PORT.panel);
      this.asphalt('h8_port_none', {}, { minGap: 6, force: false });
      return;
    }
    if (this.pending) return;
    this.mind.userPort();
    const open = this.hatch.target > 0.5;
    this.hatch.setTarget(open ? 0 : 1);
    this.neckTarget = open ? 0 : 1;
    g.audio.mech(V(0, 2.8, PORT.z), 'hatch', { open: !open });
    g.audio.beep(open ? 660 : 990, 0.08, 0.06, { pos: PORT.panel });
  }

  toggleFeed() {
    this.power.feedOn = !this.power.feedOn;
    if (this.mode === 'docked') this.umbTarget = this.power.feedOn ? 1 : 0;
    this.say(this.power.feedOn ? 'hachi_feed_on' : 'hachi_feed_off', {}, { minGap: 3 });
  }

  toggleBoost() {
    this.power.boost = !this.power.boost;
    this.say(this.power.boost ? 'hachi_boost_on' : 'hachi_boost_off', {}, { minGap: 3 });
  }

  // ==================================================================== lost: the shelter adrift
  /**
   * H8 breaks up: a fireball, its pieces tumbling away (B-29 badly hurt if it is on its back).
   * Kaito sealed in the shelter drifts on in it; anywhere else aboard he goes with H8.
   */
  destroy() {
    const g = this.g, f = this.flight, pl = g.player;
    if (this.mode === 'pod' || this.mode === 'lost') return;
    const docked = this.mode === 'docked';
    // (strapped into the shelter's seat — or on the rail most of the way in — its door slams shut
    // on the emergency closure)
    const inShelter = this.shelter.slam();
    const aboard = !inShelter && pl.state !== 'dead' && (this.crew || (docked && this.kaitoInside()));
    const pos = docked ? DOCK.clone().applyQuaternion(g.flight.quat).add(g.flight.pos) : f.pos.clone();
    const vel = (docked ? g.flight.vel : f.vel).clone();
    if (g.combat) {
      g.combat.explode(pos, vel, 2.8, true);
      // pieces of the armoured sphere
      const parts = this.ext.group.children.filter((m) => m.isMesh).slice(0, 18);
      for (let k = 0; k < 5; k++) {
        const piece = new THREE.Group();
        parts.forEach((m, i) => { if ((i + k) % 5 === 0) { const c = m.clone(); c.material = m.material; piece.add(c); } });
        piece.scale.setScalar(0.35 + 0.15 * k);
        g.combat.addWreck(piece, pos, vel.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(6 + Math.random() * 14)), 90, 3 + 4 * piece.scale.x);
      }
    }
    g.shake = Math.max(g.shake, docked || inShelter ? 3 : 1);
    if (docked) {
      // the blast on B-29's back
      g.damage.impact(V(0, 3.2, PORT.z), V(0, -1, 0), 5.0e6, { normal: V(0, 1, 0), snap: true });
      g.systems.onImpact(5.0e6, V(0, 3.2, PORT.z));
      g.flight.mul = 1; g.flight.aExtra = 0; g.flight.extMass = 0; g.flight.extTank = null; g.flight.extHealth = 0; g.flight.boostDamp = false; g.flight.turnK = g.flight.spec.turnK;
    }
    this.resetDrive();
    this.attachTo(false);
    this.pilot.setGoal(null);
    this.goalKind = null;
    f.autopilot = null; f.ultra = false; f.ultraDown = null; f.setSpeed = 0;
    this.umb = 0; this.umbTarget = 0;
    if (this.hatch) { this.hatch.setTarget(0); this.hatch.open = 0; }
    this.neckTarget = 0; this.neckOpen = 0;
    if (inShelter) {
      // the shelter goes on alone, thrown clear by the blast, turning slowly
      this.mode = 'pod';
      this.crew = true;
      this.podT = 0;
      if (this.rescue) { this.rescue.dispose(); this.rescue = null; }
      f.pos.copy(pos); f.vel.copy(vel).add(new THREE.Vector3().randomDirection().multiplyScalar(1.5 + Math.random() * 1.5));
      f.wRel.set((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12);
      f.updateAttitude();
      this.shelter.door = 0;
      setTimeout(() => this.say('hachi_pod', { t: this.shelter.o2Text() }, { force: true }), 2500);
      if (this.link.ok || docked) setTimeout(() => this.asphalt('h8_lost_pod', {}, { force: true }), 6500);
    } else {
      this.mode = 'lost';
      this.crew = false;
      if (aboard) setTimeout(() => g.gameplay.die(), 2200);
      else setTimeout(() => this.asphalt('h8_lost', {}, { force: true }), 2000);
    }
    this.setColliders(false);
    this.setLamps(this.mode === 'pod');
    for (const id of ['h8hum', 'h8fans', 'h8drive']) g.audio.stopLoop && g.audio.stopLoop(id);
    this._snd = false;
    this.syncAway();
  }

  /** B-29's walls are there for Kaito unless he is away (in H8 or its shelter) */
  syncAway() {
    const g = this.g, away = this.solo;
    if (away !== this._away) { this._away = away; for (const c of g.b29Static || []) c.setEnabled(!away); }
    const extOn = this.mode === 'docked' || (this.crew && this.mode === 'free');
    if (extOn !== this._extOn) { this._extOn = extOn; for (const c of this.extCols) c.setEnabled(extOn); }
  }

  /** per step while H8 is gone: the shelter drifting (gravity only), B-29 coming for it */
  updateWreck(dt) {
    const g = this.g, f = this.flight;
    if (this.mode === 'pod') {
      // coasting: nothing but gravity on it, a slow tumble
      const r = f.pos.length(), k = -MU_EARTH / (r * r * r);
      const ax = f.pos.x * k, ay = f.pos.y * k, az = f.pos.z * k;
      f.pos.x += f.vel.x * dt + 0.5 * ax * dt * dt; f.pos.y += f.vel.y * dt + 0.5 * ay * dt * dt; f.pos.z += f.vel.z * dt + 0.5 * az * dt * dt;
      f.vel.x += ax * dt; f.vel.y += ay * dt; f.vel.z += az * dt;
      const w = f.wRel.length();
      if (w > 1e-6) f.qRel.multiply(_q.setFromAxisAngle(_v.copy(f.wRel).divideScalar(w), w * dt)).normalize();
      f.updateAttitude();
      f.thrustAcc.set(0, 0, 0); f.properAcc.set(0, 0, 0);
      this.gLocal.set(0, 0, 0);
      // down on the ground or the sea: it stays there (a hard fall kills)
      const surf = g.terrainAt ? g.terrainAt(f.pos) : null;
      if (surf) {
        const r = f.pos.length(), floor = R_EARTH + Math.max(0, surf.h) + 1.2;
        if (r < floor) {
          const vAir = _v3.set(OMEGA_EARTH * f.pos.z, 0, -OMEGA_EARTH * f.pos.x);
          const up = _v2.copy(f.pos).divideScalar(r);
          const vn = -_v.copy(f.vel).sub(vAir).dot(up);
          f.pos.multiplyScalar(floor / r);
          f.vel.copy(vAir);
          f.wRel.multiplyScalar(0.2);
          f.properAcc.copy(up).multiplyScalar(MU_EARTH / (r * r));
          if (!this.podDown) {
            this.podDown = true;
            if (this.crew && vn > 30 && g.player.state !== 'dead') { g.shake = 3; setTimeout(() => g.gameplay.die(), 600); }
            else if (this.crew && vn > 3) { g.shake = Math.max(g.shake, Math.min(3, vn / 8)); if (g.audio.ready) g.audio.impact(V(0, 8.2, 2.2), Math.min(1, vn / 25)); }
          }
        } else if (r > floor + 5) this.podDown = false;
      }
      this.shelter.update(dt);
      // who comes for it: B-29 if it can (Asphalt sets off by itself after a little while), else
      // the nearest station's rescue craft
      this.podT = (this.podT || 0) + dt;
      const ap = g.autopilot, b29Coming = ap.state !== 'off' && ap.target && ap.target.id === 'h8';
      if (this.rescue) {
        this.rescue.step(dt);
        if (this.rescue.state === 'latched' && this.rescue.t - this.rescue.latchedAt > 5) { this.finishStationRescue(); return; }
      } else if (b29Coming) {
        // on the way, B-29 may no longer be able to make it
        const can = this.b29Rescue();
        if (!can.ok) { ap.disengage(true); this.startStationRescue(can.why); }
      } else if (this.podT > 20 && this.crew) this.requestRescue();
      // B-29 alongside and matched (its autopilot holds 150 m off), slow: Asphalt takes the
      // shelter in with the manipulator
      const fb = g.flight;
      const d = fb.pos.distanceTo(f.pos), rv = fb.vel.distanceTo(f.vel);
      if (!this.rescue && d < 220 && rv < 4) this.recoverPod();
    } else if (this.mode === 'lost') {
      // the repair base builds another one while B-29 lies at its berth
      const dk = g.docking;
      if (dk && dk.state === 'docked' && dk.station && dk.station.kind === 'dock') {
        this.rebuildT = (this.rebuildT || 0) + dt;
        if (this.rebuildT > 8) this.rebuild();
      } else this.rebuildT = 0;
    }
    this.syncAway();
  }

  /** can B-29 go and fetch the shelter itself? { ok, why } */
  b29Rescue() {
    const g = this.g, f = g.flight;
    if (f.landed) return { ok: false, why: '地上に降りていて' };
    if (f.dry) return { ok: false, why: '推進剤が尽きて' };
    if (f.driveHealth < 0.3) return { ok: false, why: '推進系の損傷で' };
    const integ = g.damage.integrityNow ?? g.damage.integrity();
    if (integ < 0.3) return { ok: false, why: '船体の損傷で' };
    if (g.systems.serversHealth !== undefined && g.systems.serversHealth < 0.25) return { ok: false, why: '自動操縦が壊れて' };
    return { ok: true, why: null };
  }

  /** a call for help from the drifting shelter: B-29 if it can, else the nearest station */
  requestRescue() {
    const g = this.g, ap = g.autopilot;
    if (this.mode !== 'pod' || this.rescue) return;
    if (ap.state !== 'off' && ap.target && ap.target.id === 'h8') return;
    const can = this.b29Rescue();
    if (can.ok) this.rescuePod();
    else this.startStationRescue(can.why);
  }

  /** the nearest working station with a berth sends its rescue craft */
  startStationRescue(why) {
    const g = this.g;
    if (this.rescue) return;
    let best = null;
    const p = new THREE.Vector3();
    for (const s of g.stations.list) {
      if (s.kind !== 'hub') continue;
      if (s.dmg && s.dmg.status !== 'ok' && s.dmg.status !== 'damaged') continue;
      const d = g.stations.posOf(s, g.time, p).distanceTo(this.flight.pos);
      if (!best || d < best.d) best = { s, d };
    }
    if (!best) { this.asphalt('pod_nobody', {}); return; }
    this.rescue = new RescueTug(this, best.s);
    const min = Math.max(1, Math.round((best.d / 2500 + 90) / 60));
    this.asphalt('pod_station', { why: why || '', name: best.s.name, eta: min + ' 分' });
  }

  /** the rescue craft holds the shelter: brought in, and B-29 too (its tugs fetched it), to the
   * station's berth; Kaito comes through B-29's airlock */
  finishStationRescue() {
    const g = this.g, pl = g.player, s = this.rescue.s;
    const withKaito = this.crew && pl.state !== 'dead';
    this.rescue.dispose();
    this.rescue = null;
    this.mode = 'lost';
    this.crew = false;
    if (g.autopilot.state !== 'off') g.autopilot.disengage(true);
    if (g.flight.ultra) { g.flight.ultraAuto = false; g.flight.setUltra(false); }
    this.setLamps(false);
    this.syncAway();
    if (!withKaito) return;
    g.gameplay.fadeAction(() => {
      const dk = g.docking;
      if (dk.state !== 'free') { dk.despawn(); dk.state = 'free'; dk.wp = []; }
      g.flight.autopilot = null;
      dk.redock(s.id);
      pl.seat = null;
      pl.state = 'float';
      pl.colStand.setEnabled(true);
      pl.teleport(V(1.7, 0.95, -1.0));
      g.mode = 'walk';
      g.input.setMode('walk');
    });
    setTimeout(() => this.asphalt('pod_station_done', { name: s.name }), 1800);
  }

  /** from B-29's screens: go and fetch the shelter (B-29's autopilot to it) */
  rescuePod() {
    const g = this.g;
    if (this.mode !== 'pod') return;
    if (g.autopilot.engage('h8')) {
      const d = g.flight.pos.distanceTo(this.flight.pos);
      if (d > 30000 && !g.flight.ultra && g.flight.driveHealth >= 0.45) g.flight.setUltra(true);
      this.asphalt('pod_go', { d: fmtDist(d) }, { force: true });
    }
  }

  /** B-29 has the shelter alongside: Kaito comes through B-29's airlock */
  recoverPod() {
    const g = this.g, pl = g.player;
    const withKaito = this.crew && pl.state !== 'dead';
    if (this.rescue) { this.rescue.dispose(); this.rescue = null; }
    this.mode = 'lost';
    this.crew = false;
    if (g.autopilot.state !== 'off' && g.autopilot.target && g.autopilot.target.id === 'h8') g.autopilot.disengage(true);
    if (g.flight.ultra) { g.flight.ultraAuto = false; g.flight.setUltra(false); }
    this.setLamps(false);
    this.syncAway();
    if (withKaito) {
      g.gameplay.fadeAction(() => {
        pl.seat = null;
        pl.state = 'float';
        pl.colStand.setEnabled(true);
        pl.teleport(V(1.7, 0.95, -1.0));
        g.mode = 'walk';
        g.input.setMode('walk');
      });
      setTimeout(() => this.asphalt('pod_rescue', {}, { force: true }), 1500);
    }
  }

  /** a new H8 from the repair base: as it was on the first day, waiting above B-29 */
  rebuild() {
    const g = this.g;
    this.rebuildT = 0;
    this.mode = 'parked';
    this.crew = false;
    this.structure = 1;
    this.armour.outer = 1; this.armour.inner = 1;
    for (const k of Object.keys(this.circuits)) this.circuits[k] = 1;
    this.hull.repairAll();
    if (this._leak) { g.lifeSupport.removeLeak(this._leak); this._leak = null; }
    this.power.smes = H8.smesMJ * 0.85;
    this.flight.tank.kg = this.flight.tank.cap;
    this.shelter.o2 = 10 * 3600 * 7.4e-4; this.shelter.lioh = 1; this.shelter.battery = 1;
    this.shelter.snapHome();
    this.hits = 0;
    this.awake = 0; this.wakeTarget = 0;
    this.initAbove();
    this.placeParked(g.time);
    this.asphalt('h8_rebuilt', {}, { force: true });
  }

  /** per drawn frame while H8 is gone: only the shelter (adrift) shows */
  wreckVisual(dt, eyePF, dCam) {
    const g = this.g;
    this.ext.group.visible = false;
    this.ext.far.visible = false;
    this.int.group.visible = false;
    this.display.mesh.visible = false;
    this.beacon.visible = false;
    if (this.neckHatch) this.neckHatch.visible = false;
    if (this.umbMesh) this.umbMesh.visible = this.umbHead.visible = false;
    this.tabs.place(dt, false);
    g.engine.uiOn = false;
    if (this.zoom.z !== 1) { this.zoom.z = 1; this.zoom.zT = 1; g.engine.setZoom(1); this.display.setZoom(1); g.engine.grade.set('uPixel', 1); }
    if (this._cabin) { this.setCabinLayer(false); g.engine.setCabinView(null); }
    this.hud.frame(dt, [], null, false, false);
    this.zoom.drawHud(false);
    if (this.mode === 'lost') { this.shelter.group.visible = false; this.shelter.pod.visible = false; return; }
    this.shelter.updateVisual(eyePF);
    const d = Math.max(0, dCam);
    this.shelter.pod.traverse((o) => { if (o.isMesh) assignLayers(o, Math.max(0, d - 3), d + 3); });
    for (const l of this.lamps) l.intensity = l.shelter ? this.shelter.lampIntensity() : 0;
  }

  // ==================================================================== docked: the pair as one
  attachTo(docked) {
    const g = this.g;
    if (docked) {
      g.shipVis.root.add(this.root);
      this.root.matrix.makeTranslation(DOCK.x, DOCK.y, DOCK.z);
    } else {
      g.engine.scene.add(this.root);
    }
  }

  /** B-29's flight model with H8 pushing (or not) */
  applyBoost(on) {
    const f = this.g.flight;
    if (!on) { f.mul = 1; f.aExtra = 0; f.boostDamp = false; f.extHealth = 0; f.extTank = null; f.extMass = 0; f.turnK = f.spec.turnK; return; }
    // H8's thrusters help the pair round
    f.turnK = this.awake > 0.5 ? H8.turnKPair : f.spec.turnK;
    // the pair is 26 t heavier; H8's drive pushes on H8's own propellant
    f.extMass = H8.mass;
    f.extTank = this.flight.tank;
    if (this.flight.tank.kg <= 0) { f.mul = 1; f.aExtra = 0; f.boostDamp = false; f.extHealth = 0; return; }
    const fed = this.feedOK();
    const boost = this.power.boost && (fed || this.power.smes > H8.smesMJ * 0.03);
    f.mul = boost ? H8.speedMulFed : H8.speedMulInternal;
    // H8's drive (1.6 MN) on the pair's 68 t, plus B-29's own engine
    f.aExtra = (boost ? 1 : 0.62) * H8.accel * H8.mass / (H8.mass + 42000) * this.driveHealth();
    f.boostDamp = true;
    f.extHealth = this.driveHealth();
  }

  feedOK() {
    const g = this.g;
    return this.mode === 'docked' && this.power.feedOn && this.umb > 0.98 && (g.systems.power ?? 1) > 0.45;
  }

  driveHealth() { return Math.max(0, Math.min(1, 0.2 + 0.8 * this.armour.inner)) * (this.awake > 0.5 ? 1 : 0) * this.circ('drive', 0.35); }

  syncDocked() {
    const fb = this.g.flight, f = this.flight;
    f.pos.copy(DOCK).applyQuaternion(fb.quat).add(fb.pos);
    f.vel.copy(fb.vel);
    f.quat.copy(fb.quat);
    f.qRel.copy(fb.qRel);
    f.hRef.copy(fb.hRef);
    f.wRel.set(0, 0, 0);
    f.properAcc.copy(fb.properAcc);
    f.thrustAcc.copy(fb.thrustAcc);
    f.setSpeed = 0;
    f.autopilot = null;
  }

  // ==================================================================== per simulation step
  /** before the flight steps: inputs and pilots */
  preStep(sdt, flightIn) {
    const g = this.g;
    this.t += sdt;
    this.lastDt = sdt;
    // adrift in the shelter: nothing to fly with (and B-29 is not his to fly from here)
    if (this.mode === 'pod') return null;
    if (this.mode !== 'free') return flightIn;
    if (this.berthAt) { this.holdBerth(); this.flightInput = null; return this.crew ? null : flightIn; }
    // Kaito at the controls of a free H8: the sticks fly H8 (B-29 holds its course)
    const seated = g.player.state === 'seated' && this.isH8Seat(g.player.seat);
    let input = null;
    if (this.crew && seated && (g.mode === 'pilot' || g.mode === 'camera') && !this.pilot.goal && this.pilot.state !== 'undock' && this.pilot.state !== 'dock') input = flightIn;
    this.flightInput = input;
    this.pilot.update(sdt, g.time - sdt * 1000);
    // (latched onto a station's port this very step: no flight step on top of it)
    if (this.berthAt) { this.holdBerth(); return this.crew ? null : flightIn; }
    this.flight.step(sdt, input, (pos) => g.terrainAt(pos));
    this.collide(sdt);
    return this.crew ? null : flightIn;
  }

  /** after B-29's flight step */
  update(sdt, dt) {
    const g = this.g;
    if (this.mode === 'pod' || this.mode === 'lost') { this.updateWreck(sdt); return; }
    this.shelter.update(sdt);
    // an old save whose H8 was never woken: it now waits right above B-29 like on a new game
    if (this.relocate) { this.relocate = false; this.initAbove(); this.placeParked(g.time); }
    if (this.mode === 'parked') this.placeParked(g.time);
    else if (this.mode === 'docked') {
      this.syncDocked();
      // Kaito is aboard when he is inside (or strapped into H8's seat)
      const was = this.crew;
      this.crew = this.kaitoInside();
      if (this.crew && !was && !this.greeted && this.awake > 0.5) { this.greeted = true; this.say('hachi_enter'); }
      // HACHI keeps the boost figures honest (feed, storage, drive health)
      this.applyBoost(true);
    }
    // ---- wake-up / power
    this.awake += ((this.wakeTarget > 0.5 ? 1 : 0) - this.awake) * Math.min(1, sdt / 4);
    this.updatePower(sdt);
    this.defence.update(sdt);
    // (the display's wear follows the damage: down again as it is mended)
    this._wearT = (this._wearT || 0) - sdt;
    if (this._wearT <= 0) { this._wearT = 1; this.display.setWear(this.displayWear()); }
    // ---- hatches, air, umbilical
    this.updateHatches(sdt);
    this.updateAir(sdt);
    const umb0 = this.umb;
    this.umb += (((this.umbTarget || 0) > 0.5 && this.mode === 'docked' ? 1 : 0) - this.umb > 0 ? 1 : -1) * sdt / 3.5;
    this.umb = Math.max(0, Math.min(1, this.umb));
    // (the umbilical's drive as it sets off)
    if ((umb0 === 0 || umb0 === 1) && this.umb !== umb0 && g.audio.ready) g.audio.mech(V(0.5, 3.0, PORT.z + 0.9), 'fold', { open: this.umb > umb0, dur: 3.5 });
    // ---- pending release (after the hatches shut)
    if (this.pending && this.pending.kind === 'release' && this.hatch.open <= 0 && this.neckOpen <= 0) this.unlatch(this.pending.after);
    // ---- B-29 coming to H8 by its own autopilot: HACHI takes over the last stretch
    const ap = g.autopilot;
    if (this.mode !== 'docked' && ap.state === 'hold' && ap.target && ap.target.id === 'h8' && !this.pilot.goal && this.pilot.state !== 'dock') {
      ap.disengage(true);
      // (an ULTRA run left on would spool B-29 straight back up once the autopilot lets go)
      if (g.flight.ultra) { g.flight.ultraAuto = false; g.flight.setUltra(false); }
      this.wake();
      this.goal('b29');
      this.say('hachi_meet');
    }
    // ---- HACHI: dock when close and B-29 is steady
    if (this.mode === 'free' && this.goalKind === 'b29' && this.pilot.state !== 'dock') {
      const d = this.flight.pos.distanceTo(g.flight.pos);
      const steady = g.flight.thrustAcc.length() < 1.2 || (g.docking && g.docking.state === 'docked');
      if (d < 900 && steady && !(g.docking && (g.docking.state === 'approach' || g.docking.state === 'leaving'))) {
        this.pilot.startDock();
        this.say('hachi_final');
      }
    }
    // ---- docking with a station: straight in once within reach (no stop at the hold point)
    if (this.mode === 'free' && this.dockGoal && !this.berthAt && this.pilot.state !== 'dock' && this.pilot.state !== 'undock') {
      const s = this.dockGoal;
      const sp = g.stations.posOf(s, g.time, _v3);
      const R0 = ((s.model && s.model.userData.radius) || 150) + 200;
      if (sp.distanceTo(this.flight.pos) < R0 + 2500) { this.pilot.startDockStation(s, g.stations.h8PortOf(s)); this.say('hachi_final'); }
    }
    // ---- at a station's port: its power and propellant lines
    if (this.berthAt) {
      const s = this.berthAt, ok = !s.dmg || s.dmg.status === 'ok' || s.dmg.status === 'damaged';
      if (ok) {
        this.power.smes = Math.min(H8.smesMJ, this.power.smes + (s.supply ? 600 : 300) * sdt);
        const T = this.flight.tank;
        T.kg = Math.min(T.cap, T.kg + (s.supply ? 120 : 50) * sdt);
      }
    }
    // ---- radiators fold up while B-29 docks at (or lies at) a station's berth
    const fold = this.mode === 'docked' && g.docking && g.docking.state !== 'free' ? 1 : 0;
    if (this._foldWas !== undefined && fold !== this._foldWas && g.audio.ready) for (const sx of [-1, 1]) g.audio.mech(V(sx * (H8.R + 0.1), 0, 0).add(DOCK), 'fold', { open: !fold, dur: 2.6, pitch: sx > 0 ? 1 : 1.04 });
    this._foldWas = fold;
    this.radFold += (fold - this.radFold) * Math.min(1, sdt * 0.6);
    // ---- point defence (and the pair's evasive step for the big ones)
    this.pointDefence(sdt);
    // ---- the player's apparent gravity while riding H8 alone
    if (this.solo) {
      const f = this.flight;
      this.gLocal.copy(f.properAcc).negate().applyQuaternion(_q.copy(f.quat).invert());
      if (f.damp > 0.001) this.gLocal.multiplyScalar(1 - 0.985 * f.damp);
    }
    // ---- physics colliders & lamps follow reachability
    this.setColliders(this.mode === 'docked' || this.crew);
    this.setLamps(this.mode === 'docked' || this.crew);
    this.updateFuel(sdt);
    this.updateLink(sdt);
    // ---- B-29 called over while it lay at a station: once it is free, it comes
    if (this.b29Pending) {
      const dk = g.docking;
      if (!dk || dk.state === 'free') { this.b29Pending = null; if (this.mode !== 'docked') this.b29Go(); }
      else if (g.time - this.b29Pending > 120000) this.b29Pending = null;
    }
    // ---- outside: the hull to bump into; B-29's walls are not there while Kaito is away with H8
    const extOn = this.mode === 'docked' || (this.crew && this.mode === 'free');
    if (extOn !== this._extOn) { this._extOn = extOn; for (const c of this.extCols) c.setEnabled(extOn); }
    const away = this.solo;
    if (away !== this._away) { this._away = away; for (const c of g.b29Static || []) c.setEnabled(!away); }
    // Kaito outside while away from B-29: HACHI keeps H8 still beside him
    if (this.solo && g.player.outside && this.pilot.goal) { this.goal('hold'); this.say('hachi_eva_hold', {}, { minGap: 30 }); }
    // ---- H8's own airlock (the shaft), the circuits' sparks, first aid from outside
    this.updateAirlock(sdt);
    this.issueT = (this.issueT || 0) - sdt;
    if (this.issueT <= 0) { this.issueT = 0.4; this.updateFieldIssues(); }
    this.mind.update(sdt);
    // a cabin with its hole open to B-29's: Asphalt hears it
    const lsx = g.lifeSupport;
    if (this.mode === 'docked' && this._leak && lsx.leaky.has('corridor') && lsx.leaky.has('h8')) this.asphalt('h8_leak_port', {}, { minGap: 90, force: false });
    // ---- fresh craters cool down
    this.hull.update(sdt);
    // ---- a hole through both armours: the cabin air streams out of it
    const z = g.lifeSupport.z.h8;
    if (this._leak && z) this.hull.vent(true, Math.min(1, (z.n2 + z.o2 + z.co2) / 101.3) + 0.05);
    else this.hull.vent(false);
  }

  /** propellant: the lines through the port while docked, the warnings */
  updateFuel(dt) {
    const g = this.g, T = this.flight.tank, B = g.flight.tank;
    if (this.mode === 'docked' && B) {
      // H8 tops itself up from B-29 (B-29 keeps a fifth for itself) unless told otherwise
      const rate = 30 * dt;
      if (this.xfer === 'toB29') {
        const m = Math.min(rate, T.kg - T.cap * 0.05, B.cap - B.kg);
        if (m > 0) { T.kg -= m; B.kg += m; } else this.xfer = null;
      } else if (this.power.feedOn && this.umb > 0.98) {
        const m = Math.min(rate, T.cap - T.kg, B.kg - B.cap * 0.2);
        if (m > 0) { T.kg += m; B.kg -= m; this.fueling = true; } else this.fueling = false;
      }
    } else { this.fueling = false; if (this.xfer) this.xfer = null; }
    // HACHI watches its own tank
    const fr = this.flight.fuel;
    if (this.awake > 0.5) {
      if (fr < 0.03 && this.fuelSaid < 2) { this.fuelSaid = 2; this.say('hachi_fuel_out'); }
      else if (fr < 0.15 && this.fuelSaid < 1) { this.fuelSaid = 1; this.say('hachi_fuel_low', { pct: Math.round(fr * 100) }); }
      else if (fr > 0.25) this.fuelSaid = 0;
    }
  }

  /** the link coming up / dropping out as the two drift apart */
  updateLink(dt) {
    const L = this.linkState(), K = this.link;
    K.t += dt;
    K.d = L.d;
    if (this.mode === 'docked') { K.ok = true; K.known = true; return; }
    if (!K.known) { K.ok = L.ok; K.known = true; return; }
    // a little hysteresis at the edge of the range
    const ok = L.ok && (K.ok || L.d < LINK_RANGE * 0.98);
    if (ok !== K.ok && K.t > 4) {
      K.ok = ok; K.t = 0;
      if (this.mode !== 'parked' || this.crew) {
        if (ok) this.asphalt('h8_link_up', { d: fmtDist(L.d) }, { force: false, minGap: 30 });
        else this.asphalt(L.why === 'range' ? 'h8_link_lost' : 'h8_link_down', { d: fmtDist(L.d) }, { force: false, minGap: 30 });
      }
    } else if (ok === K.ok) K.t = Math.max(K.t, 5);
  }

  updatePower(dt) {
    const P = this.power, g = this.g;
    // drive demand: how hard the drive is pushing right now
    let thrustFrac = 0;
    if (this.mode === 'docked') {
      const f = g.flight;
      thrustFrac = Math.min(1, f.thrustAcc.length() / Math.max(1, f.spec.aMax + f.aExtra));
    } else if (this.mode === 'free') {
      thrustFrac = Math.min(1, this.flight.thrustAcc.length() / this.flight.spec.aMax);
    }
    const boosting = this.mode === 'docked' ? g.flight.mul > H8.speedMulInternal : this.flight.mul > 1;
    // ULTRA / MAX: the drive pushes harder (thrustFrac goes past 1) and less efficiently, and its
    // field draws power just to be kept up
    // (LOW: half the thrust at most, and the drive's coils run at a fraction of their power)
    const DM = { low: [0.4, 0], normal: [1, 0], ultra: [1.0, 20], max: [1.2, 60] }[this.driveMode] || [1, 0];
    const df = this.driveFlight();
    const fr = this.mode === 'docked' ? Math.min(df.aK, df.thrustAcc.length() / Math.max(1, df.spec.aMax + df.aExtra)) : Math.min(df.aK, this.flight.thrustAcc.length() / this.flight.spec.aMax);
    if (this.driveMode !== 'normal' && this.mode !== 'parked') thrustFrac = fr;
    P.driveMW = thrustFrac * (boosting ? H8.driveMW.boost : H8.driveMW.cruise) * DM[0] + (this.mode !== 'parked' && (this.driveMode === 'ultra' || this.driveMode === 'max') ? DM[1] : 0);
    P.loadMW = (2.5 + 1.5 * this.awake) + P.driveMW + (this.pd.cool > 0 ? 6 : 0);
    // supply: the reactor follows the load, the feed fills in, the SMES buffers the rest
    P.feed = this.feedOK();
    const feedAvail = P.feed ? H8.feedMW : 0;
    // (ULTRA and MAX run the reactor past its rating: 130 / 180 per cent)
    const over = this.driveMode === 'max' ? 1.8 : this.driveMode === 'ultra' ? 1.3 : 1;
    const reactorMax = H8.reactorMW * over * (this.awake > 0.1 ? 1 : 0.15) * this.circ('power', 0.4);
    // the ammunition fabricator: its normal share of the reactor (less when the storage is low),
    // or on priority everything the reactor and the feed can give beyond the rest of the load
    const Ar = g.weapons && g.weapons.arsenal;
    P.ammoMW = 0;
    if (Ar && this.awake > 0.5 && this.mode !== 'parked' && this.mode !== 'pod' && this.mode !== 'lost') {
      const lines = Ar.wantMW();
      const smesK = P.smes / H8.smesMJ;
      const spare = Math.max(0, reactorMax + feedAvail - P.loadMW - 3);
      P.ammoMW = Math.min(lines, Ar.priority ? Math.max(spare, NORMAL_MW) : NORMAL_MW * (smesK > 0.25 ? 1 : smesK > 0.1 ? 0.5 : 0));
      P.loadMW += P.ammoMW;
      Ar.run(dt, P.ammoMW);
    } else if (Ar) Ar.run(dt, 0);
    const want = Math.min(reactorMax, Math.max(0, P.loadMW - feedAvail * 0.5));
    P.reactor += (want / H8.reactorMW - P.reactor) * Math.min(1, dt * 0.4);
    P.reactor = Math.max(0.04, P.reactor);
    const supply = P.reactor * H8.reactorMW;
    P.feedMW = P.feed ? Math.min(feedAvail, Math.max(0, P.loadMW - supply) + (P.smes < H8.smesMJ * 0.98 ? 40 : 0)) : 0;
    const net = supply + P.feedMW - P.loadMW;   // MW = MJ/s
    P.smes = Math.max(0, Math.min(H8.smesMJ, P.smes + net * dt));
    // nearly empty: the drive steps down by itself (MAX to ULTRA to normal)
    if ((this.driveMode === 'ultra' || this.driveMode === 'max') && P.smes < H8.smesMJ * (this.driveMode === 'max' ? 0.06 : 0.03)) {
      const was = this.driveModeName();
      // (MAX steps down to ULTRA only while there is still something to run it on)
      this.setDriveMode(this.driveMode === 'max' && P.smes > H8.smesMJ * 0.04 ? 'ultra' : 'normal', true, true);
      this.say('hachi_drive_power', { mode: was }, { minGap: 5 });
    }
    // solo boost runs on the storage
    if (this.mode === 'free') this.flight.mul = (this.crew || this.pilot.goal) && P.boost && P.smes > H8.smesMJ * 0.03 ? 2 : 1;
  }

  updateHatches(dt) {
    const docked = this.mode === 'docked';
    if (!docked) { this.hatch.setTarget(0); if (this.airlock.mode !== 'open') this.neckTarget = 0; }
    const pv = this.neckOpen;
    const sp = dt / 1.8;
    if (this.neckTarget > this.neckOpen) this.neckOpen = Math.min(this.neckTarget, this.neckOpen + sp);
    else this.neckOpen = Math.max(this.neckTarget, this.neckOpen - sp);
    const e = this.neckOpen * this.neckOpen * (3 - 2 * this.neckOpen);
    this.neckHatch.position.set(NECK_HATCH.x - e * H8.neckHatchSlide, NECK_HATCH.y, NECK_HATCH.z);
    this.neckHatch.rotation.y = -e * 0.5;
    const p = this.neckHatch.position;
    this.neckCol.body.setNextKinematicTranslation({ x: p.x + DOCK.x, y: p.y + DOCK.y, z: p.z + DOCK.z });
    const busy = this.hatch.moving || Math.abs(pv - this.neckOpen) > 1e-6;
    const ok = docked && this.awake > 0.5 ? 'ok' : 'none';
    this.hatch.update(dt, busy ? 'busy' : ok);
    if (Math.abs(pv - this.neckOpen) > 1e-6 && this.g.audio.ready && Math.random() < dt * 2) this.g.audio.rcsPuff && this.g.audio.rcsPuff(NECK_HATCH.clone().add(DOCK), 0.03);
    // ---- the cockpit floor hatch: opened by a tap from above, by itself for Kaito coming up the
    // shaft; it shuts again once nobody is near it
    const pl = this.g.player;
    const hx = FLOOR.hatch.x + DOCK.x, hy = FLOOR.y + DOCK.y, hz = FLOOR.hatch.z + DOCK.z;
    const dxz = Math.hypot(pl.pos.x - hx, pl.pos.z - hz);
    const reach = (this.mode === 'docked' || this.crew) && pl.state !== 'dead' && pl.state !== 'seated';
    const below = reach && dxz < FLOOR.hatchR + 0.2 && pl.pos.y < hy && pl.pos.y > hy - 1.6;
    const near = reach && dxz < FLOOR.hatchR + 0.55 && pl.pos.y > hy - 3.8 && pl.pos.y < hy + 1.9;
    // (1: opened for Kaito, shuts again behind him; 2: opened by hand, stays open until tapped)
    if (below && this.floorHatchT !== 2) this.floorHatchT = 1;
    if (!near && this.floorHatchT === 1) this.floorHatchT = 0;
    // it will not open against a pressure difference, nor while the shaft works as an airlock
    const LSZ = this.g.lifeSupport;
    if (this.floorHatchT && this.floorHatch < 0.02 && (this.airlock.mode !== 'idle' || Math.abs(LSZ.pressure('h8') - LSZ.pressure('h8shaft')) > 8)) {
      this.floorHatchT = 0;
      this.g.audio.denied && this.g.audio.denied(V(FLOOR.hatch.x, FLOOR.y, FLOOR.hatch.z).add(DOCK));
      this.say('hachi_hatch_pressure', {}, { minGap: 8 });
    }
    const want = this.floorHatchT ? 1 : 0;
    const fh0 = this.floorHatch;
    this.floorHatch = Math.max(0, Math.min(1, this.floorHatch + (want > this.floorHatch ? 1 : want < this.floorHatch ? -1 : 0) * dt / 0.9));
    if (this.floorHatch !== fh0) {
      const k = this.floorHatch * this.floorHatch * (3 - 2 * this.floorHatch);
      this.floorCol.body.setNextKinematicTranslation({ x: hx + k * (FLOOR.hatchR * 2 + 0.1), y: hy - 0.03 - 0.06 * Math.min(1, this.floorHatch * 5), z: hz });
      if (fh0 === 0 || fh0 === 1) this.g.audio.mech(V(hx, hy, hz), 'hatch', { open: want > 0.5, dur: 0.9 });
    }
  }

  /** away from B-29 the shaft is an airlock: the neck hatch wheel cycles it (suit required) */
  lockTapped() {
    const g = this.g, pl = g.player, A = this.airlock;
    const at = NECK_HATCH.clone().add(DOCK);
    if (A.mode === 'idle') {
      if (!pl.suit) { g.audio.denied(at); this.say('hachi_eva_nosuit', {}, { minGap: 6 }); return; }
      A.mode = 'dep';
      this.say('hachi_lock_dep', {}, { force: true });
    } else if (A.mode === 'open' || A.mode === 'dep') {
      A.mode = 'rep';
      this.say('hachi_lock_rep', {}, { force: true });
    }
    g.audio.beep(880, 0.08, 0.06, { pos: at });
  }

  /**
   * The shaft as an airlock (away from B-29): the floor hatch shuts, the pumps take the shaft's air
   * into H8's tanks, the neck hatch opens onto space; back in, the neck shuts and the tanks fill the
   * shaft again. With the neck open the shaft vents through it.
   */
  updateAirlock(dt) {
    const A = this.airlock, g = this.g, ls = g.lifeSupport, z = ls.z.h8shaft;
    if (!z) return;
    const docked = this.mode === 'docked';
    const area = !docked && this.neckOpen > 0.02 ? Math.PI * H8.shaftR * H8.shaftR * this.neckOpen : 0;
    if (area > 0 && !this.neckLeak) this.neckLeak = ls.addLeak('h8shaft', area, 'h8neck');
    if (this.neckLeak) { if (area <= 0) { ls.removeLeak(this.neckLeak); this.neckLeak = null; } else this.neckLeak.area = area; }
    if (docked) { A.mode = 'idle'; return; }
    const p = z.n2 + z.o2 + z.co2;
    const T = this.air || (this.air = { o2: 650, n2: 1500 });
    const at = NECK_HATCH.clone().add(DOCK).add(V(0, 0.6, 0));
    if (A.mode === 'dep') {
      this.floorHatchT = 0;
      if (this.floorHatch > 0.01) return;
      if (p > 0.6) {
        const k = Math.min(1, dt * 0.22);
        const dn = z.n2 * k, dO = z.o2 * k;
        z.n2 -= dn; z.o2 -= dO; z.co2 *= 1 - k;
        T.n2 = Math.min(3000, T.n2 + dn * z.vol * 0.9); T.o2 = Math.min(1300, T.o2 + dO * z.vol * 0.9);
        if (g.audio.ready) g.audio.humLoop('h8pump', { pos: at, freq: 72, gain: 0.07 });
      } else {
        z.n2 = z.o2 = z.co2 = 0;
        A.mode = 'open';
        this.neckTarget = 1;
        g.audio.stopLoop && g.audio.stopLoop('h8pump');
        g.audio.beep(660, 0.25, 0.08, { pos: at });
        this.say('hachi_lock_open', {}, { force: true });
      }
    } else if (A.mode === 'rep') {
      this.neckTarget = 0;
      if (this.neckOpen > 0.01) return;
      if (p < 100.3 && T.n2 > 1) {
        const k = Math.min(100.6 - p, dt * 7);
        z.n2 += k * 0.79; z.o2 += k * 0.21;
        T.n2 = Math.max(0, T.n2 - k * 0.79 * z.vol); T.o2 = Math.max(0, T.o2 - k * 0.21 * z.vol);
        if (g.audio.ready) g.audio.noiseLoop('h8rep', { pos: at, type: 'pink', freq: 1500, q: 0.6, gain: 0.08 });
      } else {
        A.mode = 'idle';
        g.audio.stopLoop && g.audio.stopLoop('h8rep');
        g.audio.beep(880, 0.2, 0.08, { pos: at });
        this.say('hachi_lock_closed', {}, { force: true });
      }
    }
  }

  // ==================================================================== first aid from outside
  /** what a suit can patch from outside: holes in the armour, cut circuits, blinded cameras */
  fieldIssues() {
    const out = [];
    for (const [k, J] of Object.entries(JUNCTIONS)) {
      if (this.circuits[k] < 0.9) out.push({ id: 'c:' + k, kind: 'circuit', name: J.name, dir: J.dir, need: 'parts', dur: 6, apply: () => { this.circuits[k] = Math.max(this.circuits[k], 0.8); } });
    }
    CAMERAS.forEach((c, i) => {
      if (this.hull.cams[i] < 0.6) out.push({ id: 'cam' + i, kind: 'camera', name: c.name.split(' ')[0] + ' カメラ回路', dir: c.dir, need: 'parts', dur: 5, apply: () => { this.hull.cams[i] = Math.max(this.hull.cams[i], 0.72); this.hull.sync(); } });
    });
    for (const d of this.hull.dents) {
      if (d.hole && !d.patched) out.push({ id: 'h:' + d.seed.toFixed(5), kind: 'hole', name: '装甲の穴', dir: d.dir, need: 'patches', dur: 7, apply: () => this.patchHole(d) });
    }
    if (this._leak && !this.hull.dents.some((d) => d.hole && !d.patched)) {
      const worst = this.hull.dents.reduce((a, b) => (!a || b.E > a.E ? b : a), null);
      out.push({ id: 'leak', kind: 'hole', name: '内部装甲の亀裂', dir: worst ? worst.dir : V(0.3, -0.2, 0.93).normalize(), need: 'patches', dur: 8, apply: () => this.sealLeak() });
    }
    for (const it of out) { it.h8 = true; it.local = it.dir.clone().multiplyScalar(H8.R + 0.14); it.pos = it.local.clone().add(DOCK); }
    return out;
  }

  /** the spots Kaito can tap from outside (with a suit on) */
  updateFieldIssues() {
    const g = this.g, pl = g.player;
    const want = pl.outside && pl.suit && (this.mode === 'docked' || this.crew) ? this.fieldIssues() : [];
    const ids = new Set(want.map((x) => x.id));
    for (const [id, P] of this.issueProxies) {
      if (ids.has(id)) continue;
      g.interact.remove(P.h);
      P.mesh.removeFromParent();
      this.issueProxies.delete(id);
    }
    for (const it of want) {
      const P = this.issueProxies.get(it.id);
      if (P) { P.it = it; continue; }
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), g.interact.proxyMat);
      mesh.position.copy(it.local);
      mesh.layers.set(LAYER_PROXY);
      this.root.add(mesh);
      mesh.updateMatrixWorld(true);
      const rec = { it, mesh };
      rec.h = g.interact.addMesh(mesh, () => g.gameplay.startRepair(rec.it), { maxDist: 2.6 });
      this.issueProxies.set(it.id, rec);
    }
    this.field = want;
    // HACHI talks Kaito to the nearest one (in its own suit)
    if (want.length && pl.suitH8) {
      const eyeL = pl.eyeLocal.clone().sub(DOCK);
      const n = want.reduce((a, b) => (a.local.distanceTo(eyeL) < b.local.distanceTo(eyeL) ? a : b));
      const d = n.local.distanceTo(eyeL);
      if (d > 3 && (!this._guided || this._guided !== n.id)) { this._guided = n.id; this.say('hachi_guide', { name: n.name, m: d.toFixed(0) }, { minGap: 25, force: false }); }
    }
  }

  /** a patch plate riveted over a torn hole */
  patchHole(d) {
    d.patched = true;
    const at = d.dir.clone().multiplyScalar(H8.R + 0.03);
    const r = Math.max(0.22, d.a * H8.R * (d.hole * 1.15 + 0.12));
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d.dir);
    const g = new THREE.Group();
    g.position.copy(at); g.quaternion.copy(q);
    if (!this.patchMat) {
      this.patchMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.7, roughness: 0.38 });
      this.patchTape = new THREE.MeshStandardMaterial({ color: 0xd8a01c, metalness: 0.1, roughness: 0.7 });
    }
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.02, 0.03, 20).rotateX(Math.PI / 2), this.patchMat);
    const tape = new THREE.Mesh(new THREE.TorusGeometry(r * 0.97, 0.022, 6, 28), this.patchTape);
    g.add(plate, tape);
    for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; const b = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.022, 6).rotateX(Math.PI / 2), this.patchMat); b.position.set(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, 0.02); g.add(b); }
    g.updateMatrixWorld(true);
    g.traverse((o) => { if (o.isMesh) { o.layers.set(LAYER_NEAR); this.extMeshes.push(o); } });
    this.ext.group.add(g);
    (this.patchGroups || (this.patchGroups = [])).push(g);
    // the hole that let the air out is closed (the cracked inner armour behind holds again)
    if (this._leak && !this.hull.dents.some((x) => x.hole && !x.patched)) this.sealLeak();
  }

  sealLeak() {
    if (this._leak) { this.g.lifeSupport.removeLeak(this._leak); this._leak = null; }
    this.armour.inner = Math.max(this.armour.inner, 0.18);
    this.hull.vent(false);
  }

  /** a circuit's health effect (0..1 -> the share of the system that still works) */
  circ(k, floor = 0.3) { return floor + (1 - floor) * (this.circuits ? this.circuits[k] : 1); }
  circuitHealth() { const c = this.circuits; return (c.drive + c.power + c.sensor + c.comms + c.fire) / 5; }

  /** the floor hatch, tapped from the cockpit */
  floorHatchTapped() {
    this.floorHatchT = this.floorHatch > 0.5 || this.floorHatchT ? 0 : 2;
    this.g.audio.beep && this.g.audio.beep(this.floorHatchT ? 990 : 660, 0.06, 0.05, { pos: V(FLOOR.hatch.x, FLOOR.y, FLOOR.hatch.z).add(DOCK) });
  }

  /** the suit's shutter in the shelter (open or shut it: 1 / 0; null: the other way) */
  setSuitShutter(open = null) {
    const LK = this.shelter.locker;
    const want = open === null ? (LK.target > 0.5 ? 0 : 1) : open ? 1 : 0;
    if (want === LK.target) return;
    LK.target = want;
    this.shelter.sfx('shutter', want > 0.5);
  }

  /** the suit in the shelter: open its shutter, put the suit on, or take it off and stow it (from
   * the shelter's seat only: there is no room in there for anything else) */
  lockerTapped() {
    const g = this.g, pl = g.player, LK = this.shelter.locker, GP = g.gameplay;
    if (!(pl.state === 'seated' && pl.seat === this.shelter.seat)) { this.say('hachi_suit_where', {}, { minGap: 6 }); return; }
    const S = g.suits;
    if (!S || S.busy) return;
    void GP;
    if (pl.suit && pl.suitH8) {
      const z = g.lifeSupport.z.h8shelter;
      const kPa = z ? z.n2 + z.o2 + z.co2 : 0;
      if (kPa < 60) { g.audio.denied(pl.eyeLocal); this.say('hachi_suit_keep', {}, { minGap: 6 }); return; }
      pl.suitKit = { patches: 4, parts: 6 };
      S.doff();
      return;
    }
    if (pl.suit) { g.audio.denied(pl.eyeLocal); return; }      // already in B-29's suit
    // (the shutter opens and the carriage brings the suit out to the seat: suits.js runs it)
    S.don('h8');
  }

  /**
   * H8's own life support: CO2 scrubbers, an electrolyser for O2 (on the reactor's power) and a pair
   * of small N2 / O2 tanks that top the cabin up. The tanks do not feed a cabin that is open to a
   * leak (its own hole, or B-29's through the open port); docked with the umbilical on, they fill
   * from B-29's reserves.
   */
  updateAir(dt) {
    const ls = this.g.lifeSupport;
    const T = this.air || (this.air = { o2: 650, n2: 1500 });     // kPa*m^3
    const ok = this.awake > 0.2 || this.mode === 'docked';
    if (!ok) return;
    if (this.mode === 'docked' && this.umb > 0.98) {
      const R = ls.reserve;
      const dn = Math.min(1500 - T.n2, 2 * dt, R.n2 * 0.5), dO = Math.min(650 - T.o2, 1 * dt, R.o2 * 0.5);
      if (dn > 0) { T.n2 += dn; R.n2 -= dn; }
      if (dO > 0) { T.o2 += dO; R.o2 -= dO; }
    }
    for (const id of ['h8', 'h8shaft']) {
      const z = ls.z[id];
      if (!z) continue;
      z.co2 += (0.03 - z.co2) * Math.min(1, dt * 0.01);
      if (this.power.reactor > 0.05 && z.o2 < 21.3) z.o2 += Math.min(21.3 - z.o2, 0.004 * dt);
      if (ls.leaky.has(id) && !(ls.boost > 0)) continue;
      // (the shaft is left alone while it is pumped down for a walk outside)
      if (id === 'h8shaft' && this.airlock && this.airlock.mode !== 'idle') continue;
      const p = z.n2 + z.o2 + z.co2;
      if (p < 99) {
        const dn = Math.min(0.06 * dt, Math.max(0, 79.2 - z.n2) * 0.02 * dt, T.n2 / z.vol);
        if (dn > 0) { z.n2 += dn; T.n2 -= dn * z.vol; }
        const dO = Math.min(0.025 * dt, Math.max(0, 21.3 - z.o2) * 0.02 * dt, T.o2 / z.vol);
        if (dO > 0) { z.o2 += dO; T.o2 -= dO * z.vol; }
      }
    }
  }

  /** the area between B-29's corridor and H8 while both hatches stand open */
  portFlowArea() {
    if (this.mode !== 'docked') return 0;
    return Math.min(this.hatch.flowArea, this.neckOpen > 0.02 ? Math.PI * H8.shaftR * H8.shaftR * Math.min(1, this.neckOpen * 1.3) : 0);
  }

  setColliders(on) {
    if (on === this.colsOn) return;
    this.colsOn = on;
    for (const c of this.cols) c.setEnabled(on);
    this.neckCol.col.setEnabled(on);
    if (this.floorCol) this.floorCol.col.setEnabled(on);
  }

  setLamps(on) {
    const S = this.g.systems;
    if (on === this.lampsIn) return;
    this.lampsIn = on;
    if (on) S.lamps.push(...this.lamps);
    else {
      S.lamps = S.lamps.filter((l) => !this.lamps.includes(l));
      for (const slot of S.pool) if (slot.lamp && this.lamps.includes(slot.lamp)) { slot.lamp = null; slot.out = false; slot.light.intensity = 0; }
    }
  }

  /** free H8 against B-29 and the stations: push out, bounce, armour damage */
  collide(dt) {
    const g = this.g, f = this.flight;
    this.lastHit = (this.lastHit || 0) - dt;
    const hit = (nE, depth, vRel, what) => {
      f.pos.addScaledVector(nE, depth + 0.02);
      const vn = vRel.dot(nE);
      if (vn >= 0) return;
      f.vel.addScaledVector(nE, -1.3 * vn);
      f.wRel.multiplyScalar(0.5);
      if (-vn > 0.3 && this.lastHit <= 0) {
        this.lastHit = 0.6;
        const E = 0.5 * H8.mass * vn * vn;
        this.armourHit(E * 0.5, nE.clone().negate().applyQuaternion(_q2.copy(f.quat).invert()));
        if (what === 'b29') {
          const pLocal = f.pos.clone().addScaledVector(nE, -H8.R).sub(g.flight.pos).applyQuaternion(_q.copy(g.flight.quat).invert());
          g.damage.impact(pLocal, nE.clone().negate().applyQuaternion(_q.copy(g.flight.quat).invert()), E * 0.3, { snap: true });
          g.systems.onImpact(E * 0.3, pLocal);
        }
        if (this.crew) g.shake = Math.max(g.shake, Math.min(3, 0.6 + vn * vn * 0.3));
        if (this.pilot.goal) this.pilot.setGoal(null);
        this.say('hachi_bump', {}, { minGap: 6, force: false });
      }
    };
    // B-29 (hull spheres)
    const fb = g.flight;
    const rel = f.pos.clone().sub(fb.pos);
    if (rel.lengthSq() < 60 * 60) {
      const loc = rel.clone().applyQuaternion(_q.copy(fb.quat).invert());
      for (const sp of g.docking.shipSpheres) {
        const d = loc.distanceTo(sp.c) - (sp.r + H8.R);
        if (d < 0 && this.pilot.state !== 'dock') {
          const nE = loc.clone().sub(sp.c).normalize().applyQuaternion(fb.quat);
          hit(nE, -d, f.vel.clone().sub(fb.vel), 'b29');
          break;
        }
      }
    }
    // stations (not the one H8 is docking with or lies at: the way in is clear by design, and the
    // last metres are the port itself)
    const host = this.pilot.dock && this.pilot.dock.host && this.pilot.dock.host.s;
    for (const s of g.stations.list) {
      const P = s.model && s.model.userData.proxies;
      if (!P) continue;
      if (s === this.berthAt || (s === host && (this.pilot.state === 'dock' || this.pilot.state === 'undock'))) continue;
      const d0 = s.pos.distanceTo(f.pos);
      if (d0 > 600) continue;
      const pose = g.docking.stationPose(s, g.time, this._pose || (this._pose = {}));
      const pl = f.pos.clone().sub(pose.pos).applyQuaternion(_q.copy(pose.quat).invert());
      const n = new THREE.Vector3();
      for (const pr of P) {
        const d = g.docking.proxyDist(pl, pr, n) - H8.R;
        if (d < 0) {
          const nE = n.clone().applyQuaternion(pose.quat);
          hit(nE, -d, f.vel.clone().sub(g.docking.frameVel(s, pose, f.pos, new THREE.Vector3())), 'station');
          break;
        }
      }
    }
  }

  /** H8 comes down on the ground or the sea (its flight model's contact): the armour takes it */
  groundImpact(speed, vn, water) {
    const g = this.g;
    if (this.mode !== 'free') return;
    const lethal = water ? 70 : 45;
    if (this.crew) {
      g.shake = Math.max(g.shake, Math.min(3, 0.5 + speed / 15));
      if (g.audio.ready) { g.audio.impact(V(0, -3.5, 0.8).add(DOCK), Math.min(1, 0.2 + speed / 40)); if (water) g.audio.splash && g.audio.splash(0.5 + speed / 60); }
    }
    const E = 0.5 * H8.mass * speed * speed * (water ? 0.5 : 1);
    if (speed > lethal) {
      // too fast: the armour gives and the frame with it
      this.armour.outer = 0; this.armour.inner = 0; this.structure = Math.min(this.structure, 0.02);
      this.armourHit(Math.max(E, 4e7), V(0, -1, 0));
      return;
    }
    if (speed > 4) this.armourHit(E * 0.35, V(0, -1, 0));
    this.say(water ? 'hachi_splash' : 'hachi_touchdown', {}, { minGap: 5, force: false });
  }

  /** while zoomed the cockpit (its fittings, the display's glass, the shelter) is drawn in a pass
   * of its own at the eye's view, not magnified with the cameras' picture */
  setCabinLayer(on) {
    if (!!this._cabin === on) return;
    this._cabin = on;
    const set = (o) => o.traverse((x) => { if (x.isMesh || x.isPoints || x.isLine || x.isSprite) x.layers.mask = 1 << (on ? LAYER_CABIN : LAYER_NEAR); });
    for (const grp of [this.int.group, this.display.mesh, this.shelter && this.shelter.group]) if (grp) set(grp);
  }

  /** how worn the cockpit display is by everything H8 has taken (0 .. 1) */
  displayWear() {
    const A = this.armour;
    return Math.max(0, Math.min(1, 1 - (0.35 * A.outer + 0.45 * A.inner + 0.2 * (this.structure ?? 1))));
  }

  /** armour takes a blow: the outer plates first, then the inner pressure armour. dirLocal: from
   * H8's centre toward the point hit (H8-local) */
  armourHit(E, dirLocal, opts = {}) {
    const A = this.armour, g = this.g;
    const k = E / 4.0e7;
    const outerBefore = A.outer;
    const outer = Math.min(A.outer, k);
    A.outer -= outer;
    const rest = k - outer + (A.outer < 0.3 ? k * 0.3 : 0);
    const innerBefore = A.inner;
    if (rest > 0) A.inner = Math.max(0, A.inner - rest * 0.6);
    // with the inner armour gone the blows go into the frame itself; when that gives, H8 breaks up
    if (innerBefore <= 0.001 && this.mode !== 'parked') {
      const sb = this.structure;
      this.structure = Math.max(0, this.structure - E / 4.0e7);
      const aboard = this.crew || (this.mode === 'docked' && this.kaitoInside());
      if (sb >= 0.6 && this.structure < 0.6) { this.say('hachi_breakup', {}, { force: true }); if (aboard && !this.shelter.occupied) setTimeout(() => this.say('hachi_shelter_go', {}, { force: true }), 1500); }
      if (this.structure <= 0) { this.destroy(); return; }
    }
    this.hits++;
    // the hull itself: a dent (or a hole) where it was hit, sparks, a blinded camera
    const res = this.hull.hit(dirLocal, E, { outer: outerBefore, shot: !!opts.shot });
    // the circuits under the plates near the blow
    const dl = dirLocal.clone().normalize();
    for (const [k, J] of Object.entries(JUNCTIONS)) {
      const ang = J.dir.angleTo(dl);
      if (ang > 0.65) continue;
      const before = this.circuits[k];
      const dmg = Math.min(1, (E / 1.4e7 + (outerBefore < 0.35 ? 0.12 : 0)) * (1 - ang / 0.65));
      if (dmg < 0.01) continue;
      this.circuits[k] = Math.max(0, before - dmg);
      if (before >= 0.5 && this.circuits[k] < 0.5) setTimeout(() => this.say('hachi_circuit', { name: J.name }, { force: true }), 1400);
    }
    if (res.blinded >= 0) setTimeout(() => this.say('hachi_cam_lost', { cam: CAMERAS[res.blinded].name }), 1800);
    // inside: the lights stutter, the display drops out for a moment, a console spits sparks
    const inside = this.crew || this.mode === 'docked';
    // a blow that comes through the armour knocks out display panels on that side (and the shock
    // some all round); the display as a whole wears with everything H8 has taken
    if (E > 3e5 && (A.outer < 0.6 || E > 2e6)) this.display.panelHit(dirLocal, E * (1.6 - A.outer));
    this.display.setWear(this.displayWear());
    if (inside && E > 3e5) {
      this.flickT = Math.min(1.5, 0.3 + E / 2e7);
      this.display.stutter(Math.min(1, 0.2 + E / 4e6));
      if (this.seatMotion && this.crew) this.seatMotion.jolt(Math.min(2.2, 0.25 + E / 2e6));
      if (E > 1.5e6 && this.fx) {
        const side = dirLocal.x >= 0 ? 1 : -1;
        const p = V(side * 0.9, H8.cockpitC.y - 0.62, H8.cockpitC.z - 0.25);
        this.fx.burst('spark', p, V(-side * 0.5, 0.6, -0.2).normalize(), Math.min(70, 10 + E / 2e5), { speed: 2.5, spread: 0.7 });
        this.fx.burst('smoke', p, V(0, 1, 0), 6, { speed: 0.2, spread: 0.5 });
        g.audio.click && g.audio.click(p.clone().add(DOCK), 0.4);
      }
      g.audio.creak && g.audio.creak(dirLocal.clone().multiplyScalar(H8.R * 0.8).add(DOCK), Math.min(1, 0.3 + E / 1e7));
    }
    if (A.inner < 0.15 && g.lifeSupport.z.h8 && !this._leak) {
      this._leak = g.lifeSupport.addLeak('h8', 3e-4, 'h8armour');
      this.say('hachi_leak');
    } else if (res.dent.hole && !res.dent.holeSaid) {
      res.dent.holeSaid = true;
      this.say('hachi_hole', { pct: Math.round(A.outer * 100) }, { minGap: 6, force: false });
    } else if (E > 2e5) this.say(A.outer > 0.4 ? 'hachi_hit' : 'hachi_hit_hard', { pct: Math.round(A.outer * 100) }, { minGap: 8, force: false });
  }

  /** a rock's swept path against H8's sphere (called by the asteroid field) */
  rockCheck(a, prevPos, dt) {
    if (this.mode === 'lost' || this.mode === 'pod') return false;
    if (a.hit || a.dead || this.mode === 'parked' && this.flight.pos.distanceTo(a.pos) > 5000) return false;
    const f = this.flight;
    // both moved this step (~0.1 km along the orbit): compare at the same instants
    const p0 = prevPos.clone().sub(f.pos).addScaledVector(f.vel, dt), p1 = a.pos.clone().sub(f.pos);
    const seg = p1.clone().sub(p0);
    const L2 = Math.max(1e-9, seg.lengthSq());
    const t = Math.max(0, Math.min(1, -p0.dot(seg) / L2));
    const c = p0.clone().addScaledVector(seg, t);
    if (c.length() > H8.R + a.radius * 0.8) return false;
    a.hit = true;
    const vr = a.vel.clone().sub(f.vel);
    const E = 0.5 * a.mass * vr.lengthSq();
    this.armourHit(E, c.clone().normalize().applyQuaternion(_q.copy(f.quat).invert()));
    if (this.crew || this.mode === 'docked') {
      this.g.shake = Math.max(this.g.shake, Math.min(2.5, 0.4 + E / 4e6));
      this.g.audio.impact(this.mode === 'docked' || this.crew ? c.clone().applyQuaternion(_q.copy(f.quat).invert()).add(DOCK) : V(0, 0, 0), Math.min(1, 0.3 + E / 1e7));
    }
    if (a.mesh.parent) a.mesh.parent.remove(a.mesh);
    return true;
  }

  // ==================================================================== point defence
  /** rocks on a collision course with H8 (or the docked pair) are shot at by the laser */
  pointDefence(dt) {
    const g = this.g, pd = this.pd;
    pd.cool = Math.max(0, pd.cool - dt);
    for (const b of pd.beams) b.t -= dt;
    pd.beams = pd.beams.filter((b) => { if (b.t <= 0 && !b.done) { this.zapEnd(b, dt); return false; } return b.t > 0 || !b.done; });
    if (this.awake < 0.6 || this.mode === 'parked') return;
    const docked = this.mode === 'docked';
    const ref = docked ? g.flight : this.flight;
    const R0 = docked ? 16 : H8.R + 4;
    // the rocks were last moved at the end of the previous step, the ships already at the end of
    // this one: compare them at the same instant (at ~7.7 km/s a step apart is ~400 m)
    const refPos = ref.pos.clone().addScaledVector(ref.vel, -dt);
    for (const a of g.asteroids.list) {
      if (a.hit || a.dead || a.zapping) continue;
      const rel = a.pos.clone().sub(refPos);
      const d = rel.length();
      if (d > 3200) continue;
      const rv = a.vel.clone().sub(ref.vel);
      const tca = -rel.dot(rv) / Math.max(1e-6, rv.lengthSq());
      if (tca < 0) continue;
      const miss = rel.clone().addScaledVector(rv, tca).length();
      if (miss > R0 + a.radius * 2) continue;
      if (a.radius <= 0.8) {
        if (pd.cool > 0 || d > 2600) continue;
        this.zap(a);
        pd.cool = 1.4;
      } else if (!a.pdWarned) {
        a.pdWarned = true;
        this.say('hachi_big_rock', { km: (d / 1000).toFixed(1) });
        // the evasive step: sideways out of its path (the pair, or H8 alone)
        const side = rel.clone().addScaledVector(rv, tca).negate();
        if (side.lengthSq() < 1e-4) side.copy(rv).cross(ref.pos).normalize();
        if (this.dodge) this.dodge.flight.offsetVel.set(0, 0, 0);
        this.dodge = { v: side.normalize().multiplyScalar(Math.min(30, (R0 + a.radius * 3 + 30) / Math.max(2, tca * 0.5))), t: Math.max(3, Math.min(10, tca * 0.8)), flight: ref };
      }
    }
    // the evasive step itself: a sideways velocity on top of the command, ramped in and out
    const D = this.dodge;
    if (D) {
      D.age = (D.age || 0) + dt;
      const env = Math.min(1, D.age / 1.2) * Math.min(1, Math.max(0, D.t - D.age) / 1.5);
      D.flight.offsetVel.copy(D.v).multiplyScalar(env);
      if (D.age >= D.t) { D.flight.offsetVel.set(0, 0, 0); this.dodge = null; }
    }
  }

  zap(a) {
    a.zapping = true;
    const g = this.g;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(0, 0, 0), V(0, 0, 1)]), new THREE.LineBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    line.frustumCulled = false;
    line.matrixAutoUpdate = false;
    line.layers.set(LAYER_NEAR); line.layers.enable(LAYER_MID); line.layers.enable(LAYER_FAR);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xcfeaff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false }));
    flash.scale.setScalar(0.0);
    flash.matrixAutoUpdate = false;
    flash.layers.set(LAYER_NEAR); flash.layers.enable(LAYER_MID); flash.layers.enable(LAYER_FAR);
    g.engine.scene.add(line, flash);
    this.pd.beams.push({ a, line, flash, t: 0.65, T: 0.65 });
    this.say('hachi_zap', { m: Math.round(a.dist || 0) }, { minGap: 12, force: false });
    if (this.crew || this.mode === 'docked') g.audio.beep(2400, 0.25, 0.05, { pos: LASER_AT.clone().add(DOCK), type: 'sawtooth' });
  }

  zapEnd(b, dt = 0) {
    const g = this.g;
    b.done = true;
    g.engine.scene.remove(b.line, b.flash);
    b.line.geometry.dispose(); b.line.material.dispose(); b.flash.material.dispose();
    const a = b.a;
    if (!a.hit) {
      a.dead = true; a.zapped = true;
      // fragments where the rock was (only worth drawing near B-29)
      const rel = a.pos.clone().sub(g.flight.pos).addScaledVector(g.flight.vel, dt);
      if (rel.length() < 400 && g.fx) {
        const pLocal = rel.applyQuaternion(_q.copy(g.flight.quat).invert());
        g.fx.burst('debris', pLocal, V(0, 1, 0), 40, { speed: 4, spread: 2.5, life: 2.5 });
      }
    }
  }

  // ==================================================================== per render frame
  /**
   * origin: the render origin (ECI), camWorld: camera relative to it, eyePF: the eye in the physics
   * frame (null in external views)
   */
  updateVisual(dt, origin, camWorld, eyePF) {
    const g = this.g, f = this.flight;
    // ---- place the root
    const rel = f.pos.clone().sub(origin);
    let dCam;
    if (this.mode === 'docked') {
      this.root.matrix.makeTranslation(DOCK.x, DOCK.y, DOCK.z);
      dCam = 0;
    } else {
      this.root.matrix.compose(rel, f.quat, _v.set(1, 1, 1));
      this.root.matrixWorld.copy(this.root.matrix);
      this.root.updateMatrixWorld(true);
      dCam = rel.distanceTo(camWorld);
    }
    if (this.rescue) this.rescue.updateVisual(dt, origin, camWorld);
    // re-entry fire (on B-29's back: the pair's airflow and heating)
    {
      const fl = this.mode === 'docked' ? g.flight : this.flight;
      const live = this.mode === 'docked' || this.mode === 'free';
      const vAir = _v.set(OMEGA_EARTH * fl.pos.z, 0, -OMEGA_EARTH * fl.pos.x);
      const flow = _v2.copy(fl.vel).sub(vAir).applyQuaternion(_q.copy(fl.quat).invert());
      const sp = flow.length();
      if (sp > 1e-3) flow.divideScalar(-sp); else flow.set(0, 0, 1);
      this.fire.update(dt, live ? fireLevel(fl.heatFlux || 0) : 0, flow);
    }
    if (this.mode === 'pod' || this.mode === 'lost') { this.plumeMain.mesh.visible = this.plumeAux.mesh.visible = false; this.wreckVisual(dt, eyePF, dCam); return; }
    // where H8 is this frame, for the dents (they are worked out in H8's own frame)
    const rw = this.mode === 'docked' ? _m.multiplyMatrices(g.shipVis.root.matrixWorld, this.root.matrix) : this.root.matrixWorld;
    DENT_U.uH8Root.value.copy(rw);
    DENT_U.uH8RootInv.value.copy(rw).invert();
    // the seat on its gimbal: it rides H8's motion on springs and shivers with the guns and hits
    if (this.seatMotion) {
      const fl = this.mode === 'docked' ? g.flight : this.flight;
      const acc = _v2.copy(fl.properAcc).applyQuaternion(_q.copy(fl.quat).invert());
      const thrust = Math.min(1, fl.thrustAcc.length() / Math.max(1, fl.spec.aMax + (fl.aExtra || 0)));
      const inp = this.flightInput || (this.mode === 'docked' && g.player.seat === this.seat ? g.lastFlightIn : null);
      this.seat.input = inp;
      this.seat.occupied = g.player.state === 'seated' && g.player.seat === this.seat;
      // (on its rail into the shelter or back: the carriage's own push in the springs too)
      this.shelter.seatOffset(this.seat.rig);
      this.seatMotion.update(dt, acc, fl.wRel, thrust, this.shelter.acc ? _v3c.set(0, 0, this.shelter.acc) : null);
      this.shelter.seat.eyeLocal.copy(this.seat.eyeLocal);
    }
    // ---- level of detail, layers
    const inside = eyePF && (this.containsPF(eyePF) || this.inVestibule(eyePF)) && (this.mode === 'docked' || this.crew);
    const near = this.mode === 'docked' || dCam < 2500;
    const showExt = near && !inside;
    this.ext.group.visible = showExt;
    if (showExt) {
      if (this.mode === 'docked') { for (const m of this.extMeshes) { m.layers.set(LAYER_NEAR); m.layers.enable(LAYER_MID); } }
      else for (const m of this.extMeshes) assignLayers(m, Math.max(0, dCam - 9), dCam + 9);
    }
    // the guns on their rings: from outside like the rest of the hull; from the cockpit too —
    // the outside cameras see them, so the display shows them turning and firing (H8's own hull
    // is left out of the picture, the guns are not)
    if (this.gunGroup) {
      const gv = near || inside;
      this.gunGroup.visible = gv;
      if (gv) {
        if (inside || this.mode === 'docked') { for (const m of this.gunMeshes) { m.layers.set(LAYER_NEAR); if (!inside) m.layers.enable(LAYER_MID); } }
        else for (const m of this.gunMeshes) assignLayers(m, Math.max(0, dCam - 10), dCam + 10);
      }
    }
    this.ext.far.visible = this.mode !== 'docked' && dCam > 1800;
    if (this.ext.far.visible) this.ext.far.traverse((o) => { if (o.isMesh) assignLayers(o, Math.max(0, dCam - 5), dCam + 5); });
    this.int.group.visible = this.mode === 'docked' ? (eyePF ? eyePF.distanceTo(DOCK) < 18 : false) : (this.crew || dCam < 30);
    this.display.mesh.visible = this.int.group.visible;
    // from the cockpit (floor hatch shut) the outside cameras look past H8's own neck and B-29's
    // port: neither hatch is in the picture (they used to show through the floor glass); a dark
    // mating plate stands in for the port's mouth instead
    const sealedIn = !!(eyePF && this.inCockpit(eyePF) && eyePF.y > FLOOR.y + DOCK.y && this.floorHatch < 0.01);
    this.neckHatch.visible = (this.int.group.visible || dCam < 60) && !sealedIn;
    if (this.hatch) this.hatch.group.visible = !(sealedIn && this.mode === 'docked');
    if (this.collarCap) this.collarCap.visible = sealedIn && this.mode === 'docked';
    // seated with the floor hatch shut, the floor is one sheet of display: its hatch ring is not
    // shown (it comes back when Kaito stands, or the hatch moves)
    this._hatchHidden = sealedIn && g.player.state === 'seated' && g.player.seat === this.seat;
    this.int.hatchRing.visible = !this._hatchHidden;
    // ---- far beacon
    const showBeacon = this.mode !== 'docked' && dCam > 900;
    this.beacon.visible = showBeacon;
    if (showBeacon) {
      const ph = (this.t / 2.0) % 1;
      const fl = Math.min(1, Math.max(0, 1 - Math.abs(ph - 0.03) / 0.03) + Math.max(0, 1 - Math.abs(ph - 0.16) / 0.03));
      this.beacon.material.opacity = 0.55 + 0.45 * fl;
      this.beacon.position.copy(rel);
      this.beacon.scale.setScalar((0.008 + 0.01 * fl) * (this.awake > 0.3 ? 1 : 0.7));
      this.beacon.updateMatrix();
      this.beacon.matrixWorld.copy(this.beacon.matrix);
      assignLayers(this.beacon, dCam, dCam);
    }
    // ---- lights, drive, moving parts
    const t = this.t;
    const aw = this.awake;
    const M = this.M;
    const sp = (t / 1.6) % 1;
    M.strobe.emissiveIntensity = aw > 0.2 ? 8 * Math.max(Math.max(0, 1 - Math.abs(sp - 0.02) / 0.02), Math.max(0, 1 - Math.abs(sp - 0.14) / 0.02)) : 0;
    M.navR.emissiveIntensity = M.navG.emissiveIntensity = 1 + 5 * aw;
    M.flood.emissiveIntensity = (this.pilot.state === 'dock' || this.latchT > 0) ? 6 : 1.5 * aw;
    // drive output (the plume points aft; it pushes the pair or H8 forward)
    const fl = this.mode === 'docked' ? g.flight : this.flight;
    const fwd = _v.set(0, 0, -1).applyQuaternion(fl.quat);
    const along = fl.thrustAcc.dot(fwd) / Math.max(1, fl.spec.aMax + (fl.aExtra || 0));
    const lat = Math.sqrt(Math.max(0, fl.thrustAcc.lengthSq() / Math.max(1, (fl.spec.aMax + (fl.aExtra || 0)) ** 2) - along * along));
    const drive = aw > 0.5 && (this.mode !== 'parked') ? Math.max(0, Math.min(1, along * 1.6)) : 0;
    this.drive += (drive - this.drive) * Math.min(1, dt * 4);
    this.aux += ((aw > 0.5 ? Math.min(1, lat * 2) : 0) - this.aux) * Math.min(1, dt * 6);
    H8_UNIFORMS.uDrive.value = this.drive;
    H8_UNIFORMS.uTime.value = t % 1000;
    M.coil.emissiveIntensity = 0.3 * aw + 6 * this.drive;
    M.throat.emissiveIntensity = 0.2 * aw + 14 * this.drive;
    // the plumes (pushed past its rating, ULTRA / MAX, the drive burns whiter and longer)
    const air = plumeAir(fl.rho || 0);
    const boost = fl.ultra ? (this.driveMode === 'max' ? 2 : this.driveMode === 'ultra' ? 1 : 0) : 0;
    this.plumeMain.update(dt, drive > 0 ? Math.min(1.3, along * 1.6) : 0, air, boost);
    this.plumeAux.update(dt, this.aux * 0.8, air, 0);
    if (this.mode === 'docked') for (const p of [this.plumeMain, this.plumeAux]) { p.mesh.layers.set(LAYER_NEAR); p.mesh.layers.enable(LAYER_MID); }
    else { this.plumeMain.setDistance(dCam); this.plumeAux.setDistance(dCam); }
    // radiators glow with the waste heat; they fold up while B-29 lies at a station's berth
    const heat = Math.min(1, this.power.reactor * 0.9 + this.drive * 0.6);
    M.radiator.emissiveIntensity = heat * heat * 0.35;
    for (const r of this.ext.parts.radiators) r.pivot.rotation.z = r.side * this.radFold * 1.62;
    if (this.ext.parts.radar) this.ext.parts.radar.rotation.y += dt * (aw > 0.3 ? 2.2 : 0);
    // status LEDs blink, fans turn
    if (this.int.group.visible) {
      const L = this.int.leds, base = L.userData.base, rate = L.userData.rate, c = new THREE.Color();
      const [h0, h1] = this.int.hatchLeds;
      for (let i = 0; i < base.length; i += 1) {
        let on = aw < 0.15 ? (i % 9 === 0 ? 0.3 : 0) : (Math.sin(t * rate[i] + i * 1.7) > -0.2 ? 1 : 0.15);
        if (this._hatchHidden && i >= h0 && i < h1) on = 0;
        c.copy(base[i]).multiplyScalar(on);
        L.setColorAt(i, c);
      }
      L.instanceColor.needsUpdate = true;
      for (const r of this.int.rotors || []) r.rotateY(dt * 40 * aw);
    }
    // lamps: dim on standby; they stutter when a hit shakes the wiring
    this.flickT = Math.max(0, this.flickT - dt);
    const stut = this.flickT > 0 ? (Math.random() < 0.35 ? 0.15 : 0.6 + Math.random() * 0.4) : 1;
    for (const l of this.lamps) l.intensity = l.shelter ? this.shelter.lampIntensity() : l.base * (0.25 + 0.75 * aw) * stut;
    // the junction panels: green when sound, red and blinking when cut; a cut one spits sparks
    if (this.jLamps) {
      for (const [k, mat] of Object.entries(this.jLamps)) {
        const c = this.circuits[k];
        if (c > 0.9) { mat.emissive.setRGB(0.2, 1.0, 0.4); mat.emissiveIntensity = 1.6 * aw; continue; }
        mat.emissive.setRGB(1.0, c > 0.5 ? 0.55 : 0.1, 0.05);
        mat.emissiveIntensity = (Math.sin(t * (c > 0.5 ? 4 : 9)) > 0 ? 4 : 0.3) * Math.max(0.3, aw);
        if (c < 0.5 && showExt && Math.random() < dt * (1 - c) * 6) this.fx.burst('spark', JUNCTIONS[k].dir.clone().multiplyScalar(H8.R + 0.06), JUNCTIONS[k].dir, 6, { speed: 2.2, spread: 0.8 });
      }
    }
    // the suit's link with HACHI: the spots to patch, marked in Kaito's visor
    this.drawSuitHud(origin);
    // ---- laser beams: from the terminal to the rock, a flash where it hits
    if (this.pd.beams.length) {
      this.root.updateMatrixWorld(true);
      const from = LASER_AT.clone().applyMatrix4(this.root.matrixWorld);
      for (const b of this.pd.beams) {
        if (b.done) continue;
        const to = b.a.pos.clone().sub(origin);
        const k = Math.max(0, b.t / b.T);
        const pa = b.line.geometry.attributes.position;
        pa.setXYZ(0, from.x, from.y, from.z); pa.setXYZ(1, to.x, to.y, to.z); pa.needsUpdate = true;
        b.line.geometry.computeBoundingSphere();
        b.line.material.opacity = Math.min(1, k * 2.5) * (0.75 + 0.25 * Math.sin(this.t * 90));
        b.flash.position.copy(to);
        b.flash.scale.setScalar(0.01 + 0.035 * Math.sin(Math.min(1, 1 - k) * Math.PI));
        b.flash.updateMatrix(); b.flash.matrixWorld.copy(b.flash.matrix);
        const dd = to.distanceTo(camWorld);
        assignLayers(b.line, 0, Math.max(dd, from.distanceTo(camWorld)));
        assignLayers(b.flash, dd, dd);
      }
    }
    this.updateSound();
    // ---- umbilical (B-29 frame) and latch settle
    this.latchT = Math.max(0, this.latchT - dt);
    this.updateUmbilical();
    // ---- the all-round display: on with Kaito in the cockpit and the power up
    const inCockpit = eyePF && this.crew && this.inCockpit(eyePF);
    this.display.update(dt, inCockpit && aw > 0.5);
    this.display.setHatch(this.floorHatch);
    this.display.setShelter(this.shelterOpen || 0);
    const disp = inCockpit && this.display.power > 0.01;
    if (disp) this.updateDisplay(dt, rw, camWorld);
    else { this.tabs.place(dt, false); this.zoom.update(dt, null, null, false); this.zoom.z = 1; if (this.seat) this.seat.stab = 0; }
    // the zoom is the outside cameras': the picture on the display is magnified (its digital part
    // a crop rebuilt by the cameras' image processor), the cockpit round it stays as the eye sees it
    const z = inCockpit ? this.zoom.z : 1;
    g.engine.setZoom(z);
    this.display.setZoom(z);
    g.engine.grade.set('uPixel', 1);
    const cab = inCockpit && z > 1.0005;
    this.setCabinLayer(cab);
    g.engine.setCabinView(cab ? { pos: g.camWorld, quat: g.camQuat } : null, z > OPT_MAX * 1.005 ? 1 + (Math.min(DIG_MAX, z / OPT_MAX) - 1) * 0.65 : 1);
    g.engine.uiOn = false;
    this.display.uniforms.uExpBias.value = g.engine.grade.get('uExposureBias');
    // the marks over the outside: with this frame's magnification. From the seat only (standing
    // in the cockpit a tap is for the seat); looking out through the external cameras from the
    // seat they are there too (focus, and a double tap to go)
    const seatedHere = this.seatedHere();
    const camLook = seatedHere && g.mode === 'camera' && this.display.power > 0.3;
    if (camLook) this.updateCands(dt);
    this.hudCam = camLook;
    this.hud.frame(dt, this.cands || [], this._orbit, (disp && this.display.power > 0.3 && g.mode !== 'camera' && seatedHere) || camLook, (disp && this.display.power > 0.5) || camLook);
    this.zoom.drawHud(inCockpit && seatedHere && (g.mode === 'pilot' || g.mode === 'camera'));
    // a photograph is taken of the outside alone: the cockpit is out of the cameras' picture
    if (g.photos && g.photos.pending && inCockpit) { this.int.group.visible = false; this.display.mesh.visible = false; }
    this.shelter.updateVisual(eyePF);
    // the shaft below the floor is out of sight (and not drawn) while the hatch is shut
    const eyeUp = eyePF && this.inCockpit(eyePF) && eyePF.y > FLOOR.y + DOCK.y;
    this.int.shaft.visible = !(eyeUp && this.floorHatch < 0.01);
    // ---- sparks, spall, venting air (H8's own particles, in H8's frame)
    const live = this.fx.add.p.length || this.fx.alpha.p.length || this.fx.emitters.length;
    if (live || !this.fxIdle) {
      const sc = g.engine.renderer.domElement.height / (2 * Math.tan(g.engine.camera.fov * Math.PI / 360));
      this.fx.add.pts.material.uniforms.uScale.value = sc;
      this.fx.alpha.pts.material.uniforms.uScale.value = sc;
      this.fx.update(Math.min(dt, 0.1));
      this.fxIdle = !live;
    }
    // ---- reflections from B-29's captures (space outside, B-29's cabin light inside)
    const env = g.shipVis.envSpace, envIn = g.shipVis.envInterior;
    if ((env && env !== this._env) || (envIn && envIn !== this._envIn)) {
      this._env = env; this._envIn = envIn;
      for (const k of Object.keys(M)) {
        const m = M[k];
        if (!m.isMeshStandardMaterial || m.emissive.getHex() || m.transparent) continue;
        const inside = this.intKeys.has(k);
        const e = inside ? envIn : env;
        if (!e) continue;
        const first = !m.envMap;
        m.envMap = e; m.envMapIntensity = inside ? 0.5 : 0.9;
        if (first) m.needsUpdate = true;
      }
    }
  }

  /** in H8's suit outside: HACHI marks the spots to patch on the visor */
  drawSuitHud(origin) {
    const g = this.g, pl = g.player;
    const cv = this._suitCv || (this._suitCv = document.getElementById('hud-suit'));
    if (!cv) return;
    const ctx = this._suitCtx || (this._suitCtx = cv.getContext('2d'));
    // (in B-29's suit Asphalt relays HACHI's list over the link)
    const show = pl.suit && pl.outside && this.field.length && g.mode === 'walk';
    if (!show) { if (this._suitOn) { ctx.clearRect(0, 0, cv.width, cv.height); cv.style.display = 'none'; this._suitOn = false; } return; }
    if (!this._suitOn) { cv.style.display = 'block'; this._suitOn = true; }
    const W = cv.clientWidth, H = cv.clientHeight, pr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * pr) || cv.height !== Math.round(H * pr)) { cv.width = Math.round(W * pr); cv.height = Math.round(H * pr); }
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cam = g.engine.camera;
    const view = new THREE.Matrix4().compose(g.camWorld, g.viewQuat || g.camQuat, _v.set(1, 1, 1)).invert();
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, view);
    const rootW = this.mode === 'docked' ? _m.multiplyMatrices(g.shipVis.root.matrixWorld, this.root.matrix) : this.root.matrixWorld;
    const eyeL = pl.eyeLocal.clone().sub(DOCK);
    ctx.font = '600 12px "Hiragino Sans","Noto Sans JP",sans-serif';
    ctx.textAlign = 'center';
    for (const it of this.field) {
      const w = it.local.clone().applyMatrix4(rootW);
      const v = new THREE.Vector4(w.x, w.y, w.z, 1).applyMatrix4(vp);
      const d = it.local.distanceTo(eyeL);
      let x, y, off = false;
      if (v.w > 0) { x = (v.x / v.w * 0.5 + 0.5) * W; y = (1 - (v.y / v.w * 0.5 + 0.5)) * H; off = x < 20 || x > W - 20 || y < 20 || y > H - 20; }
      else off = true;
      const col = it.kind === 'hole' ? 'rgba(255,120,80,0.95)' : 'rgba(255,200,90,0.95)';
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.6;
      if (off) {
        // at the edge, pointing the way
        const a = Math.atan2(v.w > 0 ? (y - H / 2) : -(y || 0) + H / 2, v.w > 0 ? (x - W / 2) : -(x || 0) + W / 2);
        x = W / 2 + Math.cos(a) * (W / 2 - 30); y = H / 2 + Math.sin(a) * (H / 2 - 30);
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10); ctx.lineTo(x + Math.cos(a + 2.5) * 9, y + Math.sin(a + 2.5) * 9); ctx.lineTo(x + Math.cos(a - 2.5) * 9, y + Math.sin(a - 2.5) * 9); ctx.closePath(); ctx.fill();
        continue;
      }
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 20, y); ctx.lineTo(x - 16, y); ctx.moveTo(x + 16, y); ctx.lineTo(x + 20, y); ctx.moveTo(x, y - 20); ctx.lineTo(x, y - 16); ctx.moveTo(x, y + 16); ctx.lineTo(x, y + 20); ctx.stroke();
      ctx.fillText(`${it.name}  ${d.toFixed(1)} m`, x, y - 24);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,208,140,0.9)';
    const GP = g.gameplay;
    if (GP.held === 'kit') ctx.fillText(`H8 応急処置 ${this.field.length} 件（HACHI→アスファルト中継）  修理キット: パッチ ${GP.kit.patches}  部品 ${GP.kit.parts}`, 16, H - 16);
    else if (pl.suitH8) { const kit = pl.suitKit || { patches: 4, parts: 6 }; ctx.fillText(`HACHI リンク  応急処置 ${this.field.length} 件  パッチ ${kit.patches}  部品 ${kit.parts}`, 16, H - 16); }
    else ctx.fillText(`H8 応急処置 ${this.field.length} 件（HACHI→アスファルト中継）  修理キットを持ってきてください`, 16, H - 16);
  }

  inCockpit(pPF) {
    const C = H8.cockpitC;
    return pPF.distanceTo(_v2.set(C.x + DOCK.x, C.y + DOCK.y, C.z + DOCK.z)) < H8.cockpitR + 0.05;
  }

  updateUmbilical() {
    const show = this.mode === 'docked' && this.umb > 0.01;
    this.umbMesh.visible = this.umbHead.visible = show;
    if (!show) return;
    const A = COUPLING_TIP.clone().add(DOCK);
    const B = this.sock.p.clone();
    // a sagging run: out of the coupling, down and round onto the socket
    const n = A.clone().sub(DOCK).normalize();
    const c1 = A.clone().addScaledVector(n, 0.5);
    const c2 = B.clone().addScaledVector(this.sock.n, 0.6);
    const curve = new THREE.CubicBezierCurve3(A, c1, c2, B);
    const e = this.umb * this.umb * (3 - 2 * this.umb);
    if (!this._umbE || Math.abs(this._umbE - e) > 0.004) {
      this._umbE = e;
      const pts = [];
      for (let i = 0; i <= 40; i++) pts.push(curve.getPoint((i / 40) * e));
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.05, 10, false);
      this.umbMesh.geometry.dispose();
      this.umbMesh.geometry = geo;
    }
    const tip = curve.getPoint(e), tan = curve.getTangent(Math.max(0.001, e));
    this.umbHead.position.copy(tip);
    this.umbHead.quaternion.setFromUnitVectors(V(0, 1, 0), tan.clone().negate());
  }

  // ==================================================================== the display's overlay
  /** per frame while Kaito is in the cockpit: where he looks, what is out there, the tabs */
  updateDisplay(dt, rw, camWorld) {
    const g = this.g, D = this.display, f = this.flight;
    // the eye in H8's frame: the display works out its lines of sight from it
    const camL = new THREE.Vector3().copy(camWorld).applyMatrix4(DENT_U.uH8RootInv.value);
    D.setEye(camL);
    this.updateCands(dt);
    // the horizon's vertical (H8-local) and the orbit directions (ECI)
    const fl = this.mode === 'docked' ? g.flight : f;
    const qInv = _q2.copy(f.quat).invert();
    D.uniforms.uUp.value.copy(f.pos).normalize().applyQuaternion(qInv);
    const up = f.pos.clone().normalize();
    const vRel = fl.vel.clone().sub(fl.refVelocity(fl.pos, new THREE.Vector3()));
    const orbit = this._orbit || (this._orbit = {});
    orbit.zen = up; orbit.nad = up.clone().negate();
    if (vRel.lengthSq() > 1) { orbit.pro = vRel.normalize(); orbit.retro = orbit.pro.clone().negate(); } else { orbit.pro = orbit.retro = null; }
    // the zoom (from the seat) and the tabs
    const pl = g.player;
    const seated = this.seatedHere();
    const z = this.zoom.update(dt, seated ? g.lastInput : null, pl, seated && (g.mode === 'pilot' || g.mode === 'camera'));
    // a magnified (or followed) view is stabilised against the seat's lean and shiver
    // (a tilt of the head moves the magnified picture by the same angle, not z times as much)
    this.seat.stab = this.zoom.follow ? 1 : 1 - 1 / Math.max(1, z);
    this.tabs.place(dt, g.mode !== 'camera');
    this.tabs.draw(dt, D.power);
  }

  /** what is out there (the list a few times a second, the ranges every frame) */
  updateCands(dt) {
    const f = this.flight;
    this.candT = (this.candT || 0) - dt;
    if (this.candT <= 0 || !this.cands) { this.candT = 0.2; this.cands = this.buildCands(); }
    const rel = _v3a, rv = _v3b;
    for (const c of this.cands) {
      rel.copy(c.pos).sub(f.pos);
      c.dist = rel.length();
      c.closing = c.vel ? -rel.dot(rv.copy(c.vel).sub(f.vel)) / Math.max(1e-6, c.dist) : 0;
    }
  }

  /** everything the display can track: B-29, stations within 3000 km, the Moon, rocks nearby */
  buildCands() {
    const g = this.g, f = this.flight, out = [];
    if (this.mode !== 'docked') out.push({ id: 'b29', kind: 'b29', name: 'B-29', short: 'B-29', pos: g.flight.pos, vel: g.flight.vel, ref: g.flight, R: 22, extra: this.link.ok ? 'リンク良好' : '通信圏外' });
    for (const st of g.stations.list) {
      if (st.pos.distanceTo(f.pos) > 3.0e6) continue;
      const ss = st.dmg ? st.dmg.status : 'ok';
      out.push({ id: 'st:' + st.id, kind: 'station', name: st.name.replace('（修理基地）', ''), short: st.en || st.name, pos: st.pos, vel: st.vel, ref: st, extra: ss !== 'ok' ? STATUS_JP[ss] : null });
    }
    if (g.space.moonPos) out.push({ id: 'moon', kind: 'body', name: '月', short: '月', pos: g.space.moonPos, vel: null, R: 1737400 });
    // rocks within 8 km; on a collision course they are threats
    const R0 = this.mode === 'docked' ? 16 : H8.R + 4;
    for (const a of g.asteroids.list) {
      if (a.dead || a.hit) continue;
      const rel = a.pos.clone().sub(f.pos);
      const d = rel.length();
      if (d > 8000 * this.circ('sensor', 0.25)) continue;

      const rv = a.vel.clone().sub(f.vel);
      const tca = -rel.dot(rv) / Math.max(1e-6, rv.lengthSq());
      const miss = rel.clone().addScaledVector(rv, Math.max(0, tca)).length();
      const threat = tca > 0 && tca < 150 && miss < R0 + a.radius * 2 + 12;
      out.push({
        id: rockId(a), kind: 'rock', name: `岩塊 ${(a.radius * 2).toFixed(1)} m`, short: '岩塊', pos: a.pos, vel: a.vel, threat, ref: a, R: a.radius,
        extra: threat ? `衝突まで ${Math.max(0, tca).toFixed(0)} 秒・${a.radius <= 0.8 ? '迎撃' : '回避'}` : `最接近 ${fmtDist(miss)}`, tca,
      });
    }
    // the hunter drones: hostile once they are after Kaito (they lock themselves then)
    if (g.drones) {
      for (const d of g.drones.list) {
        if (!d.alive) continue;
        const dist = d.pos.distanceTo(f.pos);
        // what H8's own sensors see, and over the link what B-29's see
        const own = dist <= 90e3 * this.circ('sensor', 0.15);
        const shared = !own && this.mode !== 'docked' && this.link.ok && d.pos.distanceTo(g.flight.pos) < 80e3;
        if (!own && !shared) continue;
        const hostile = d.state === 'hunt' || d.state === 'attack' || d.state === 'evade';
        out.push({
          id: 'dr:' + d.id, kind: 'drone', name: `無人機 ${d.id} ${'★'.repeat(d.stars || 1)}${'☆'.repeat(5 - (d.stars || 1))}`, short: `${d.id}★${d.stars || 1}`, pos: d.pos, vel: d.vel, threat: hostile, tca: hostile ? dist / 1000 : 1e9, ref: d, R: d.R,
          extra: (d.state === 'evade' ? `損傷 ${Math.round(d.hp * 100)}%・後退中` : d.state === 'attack' ? (d.run ? '攻撃航過中' : '周回・攻撃中') + (d.hp < 1 ? `  損傷${Math.round((1 - d.hp) * 100)}%` : '') : hostile ? '接近中' : '巡回中') + (shared ? '・B-29経由' : ''),
        });
      }
    }
    return out;
  }

  /** a jolt through H8's frame (recoil, the railgun, hits): felt in the seat */
  seatKick(k) {
    this.kick = Math.min(4, (this.kick || 0) + k);
    if (this.seatMotion) this.seatMotion.jolt(k);
    if (this.crew || (this.mode === 'docked' && this.kaitoInside())) this.g.shake = Math.max(this.g.shake, Math.min(0.9, k * 0.5));
  }

  /** the drones have found Kaito: HACHI gets ready, and comes to cover B-29 if it can */
  onThreat(T) {
    const g = this.g;
    if (this.mode === 'lost' || this.mode === 'pod') return;
    this.threatT = g.time;
    if (T.kind !== 'b29' || this.mode === 'docked' || this.crew) return;
    const L = this.linkState();
    if (!L.ok) return;
    const busy = this.goalKind === 'b29' || this.goalKind === 'escort' || this.pilot.state === 'dock';
    if (busy) return;
    if (this.flight.tank.kg < this.tripFuel(this.flight, L.d)) return;
    this.wake();
    this.goal('escort');
    setTimeout(() => this.say(L.d < 3000 ? 'hachi_scramble_near' : 'hachi_scramble', { d: fmtDist(L.d) }), 3200);
  }

  /** a lock-on: a short double pip (a threat: three low ones) */
  onLock(c) {
    const A = this.g.audio;
    if (!A.beep) return;
    if (c.threat) { for (let i = 0; i < 3; i++) A.beep(i < 2 ? 880 : 660, 0.07, 0.05, { direct: true, when: i * 0.12 }); }
    else { A.beep(1500, 0.04, 0.035, { direct: true }); A.beep(2000, 0.05, 0.035, { direct: true, when: 0.06 }); }
  }

  // ==================================================================== touching the tabs
  /** the ray of a screen point through the unmagnified view (the tabs' own), in H8's frame */
  tabRay(x, y) {
    const g = this.g, E = g.engine;
    const P = E.uiProjection(_m);
    const dir = _v.set(x / window.innerWidth * 2 - 1, -(y / window.innerHeight) * 2 + 1, 0.5).applyMatrix4(P.invert()).normalize().applyQuaternion(g.camQuat);
    const inv = _m.copy(this.root.matrixWorld).invert();
    const eye = g.camWorld.clone().applyMatrix4(inv);
    return { eye, dir: dir.clone().transformDirection(inv) };
  }

  /** Kaito in H8's seat: the tabs, the locks and the zoom are worked from there only (standing
   *  in the cockpit a tap goes to the seat and the things round it) */
  seatedHere() { const pl = this.g.player; return pl.state === 'seated' && pl.seat === this.seat && this.shelter.atHome; }

  /**
   * The shelter's red button on the armrest along a ray from the eye (H8-local { eye, dir }, the
   * unmagnified view): the distance to it, or Infinity
   */
  redButtonAt(cam) {
    const P = this.int.seatParts && this.int.seatParts.red;
    const pl = this.g.player;
    if (!P || pl.state !== 'seated' || (pl.seat !== this.seat && pl.seat !== this.shelter.seat)) return Infinity;
    const c = _v3d.setFromMatrixPosition(P.at.matrixWorld).applyMatrix4(_m4b.copy(this.root.matrixWorld).invert());
    const t = c.clone().sub(cam.eye).dot(cam.dir);
    if (t < 0.05 || t > 1.2) return Infinity;
    const miss = cam.eye.clone().addScaledVector(cam.dir, t).distanceTo(c);
    return miss < 0.05 ? t : Infinity;
  }

  tabTouch(x, y, touches) {
    if (!this.tabs.visible || this.g.mode === 'camera' || !this.seatedHere()) return null;
    // (the armrest's red button is in front of the glass: a touch there is the button's)
    if (Number.isFinite(this.redButtonAt(this.tabRay(x, y)))) return null;
    // a second finger while one is on a tab: the two pinch that tab
    if (touches) for (const o of touches.values()) {
      if (o.zone !== 'ui' || !o.cap || !o.cap.tab || o.cap.part === 'pinch') continue;
      if (this.tabs.drag) this.tabs.dragEnd();
      this._pinch = { tab: o.cap.tab, a: o, b: null, d: 0 };
      o.cap.pinched = true;
      return { tab: o.cap.tab, part: 'pinch' };
    }
    return this.tabs.hit(this.tabRay(x, y));
  }

  tabMove(t) {
    const h = t.cap;
    if (!h) return;
    const P = this._pinch;
    if (P && (h.part === 'pinch' || h.pinched)) {
      if (h.part === 'pinch') P.b = t;
      if (!P.b) return;
      const d = Math.hypot(P.a.x - P.b.x, P.a.y - P.b.y);
      if (P.d > 0) this.tabs.scaleBy(P.tab, d / P.d);
      P.d = Math.max(10, d);
      return;
    }
    if (h.part !== 'head') return;
    if (!this.tabs.drag) { if (t.moved < 10) return; this.tabs.dragStart(h); }
    this.tabs.dragMove(this.tabRay(t.x, t.y));
  }

  tabUp(t, tap) {
    const h = t.cap;
    if (this._pinch && h && (h.part === 'pinch' || h.pinched)) { this.tabs.resize(this._pinch.tab); this._pinch = null; return; }
    if (this.tabs.drag) { this.tabs.dragEnd(); return; }
    if (tap && h && h.tab) this.tabs.tap(h);
  }

  /** the mouse wheel over a tab: its size */
  tabWheel(x, y, dy) {
    if (!this.tabs.visible || this.g.mode === 'camera' || !this.seatedHere()) return false;
    const h = this.tabs.hit(this.tabRay(x, y));
    if (!h) return false;
    this.tabs.scaleBy(h.tab, Math.exp(-dy * 0.0012));
    clearTimeout(this._wheelT);
    this._wheelT = setTimeout(() => this.tabs.resize(h.tab), 350);
    return true;
  }

  /** a tap on the view (not on a tab): the locks' boxes take it */
  hudTap(tap) {
    // the red button on the armrest (from H8's seat or in the shelter, zoomed or not)
    if (tap.px !== undefined && this.g.mode !== 'camera' && Number.isFinite(this.redButtonAt(this.tabRay(tap.px, tap.py)))) { this.shelter.button(); return true; }
    if (!this.hud.on || tap.px === undefined || !this.seatedHere()) return false;
    return this.hud.tap(tap.px, tap.py);
  }

  hudHolds(holds) { if (this.hud.on && this.seatedHere()) this.hud.holds(holds); }

  /**
   * a double tap on a lock: go there. Coupled to B-29, B-29's autopilot takes the pair (lying at a
   * station it shuts its outer hatch and casts off first); lying at a station's port H8 casts off
   * first; otherwise HACHI flies
   */
  goTo(c) {
    const g = this.g;
    if (!c) return;
    if (c.kind === 'body') { this.say('hachi_goto_far', { name: c.name }, { minGap: 3 }); return; }
    if (c.kind === 'kaito') { this.callToKaito(); return; }
    if (this.mode === 'docked') {
      const ok = c.kind === 'station' && c.ref ? g.autopilot.engage(c.ref.id) : g.autopilot.engageObj(this.targetObj(c));
      this.say(ok ? 'hachi_goto' : 'hachi_goto_no', { name: c.name }, { minGap: 2 });
      return;
    }
    if (this.berthAt) { this.unberth({ goto: c }); return; }
    if (c.kind === 'b29') { this.call(); return; }
    if (c.kind === 'station' && c.ref) { this.wake(); this.goal(c.ref.id); this.say('hachi_goto', { name: c.name }, { minGap: 2 }); return; }
    // anything else: up to a safe distance from it, then hold there with it
    this.wake();
    const ref = c.ref || c;
    const R = this.hud.radiusOf(c);
    const stand = c.kind === 'drone' ? 1500 : Math.max(120, R * 3 + 80);
    this.pilot.setGoal({ kind: 'target', name: c.name, posOf: (t, pos, vel) => { pos.copy(ref.pos); if (vel) vel.copy(ref.vel || this.flight.vel); return pos; }, standoff: stand, onArrive: () => this.say('hachi_arrived', { name: c.name }, { minGap: 3 }) });
    this.goalKind = 'target';
    this.goalId = c.id;
    this.say('hachi_goto', { name: c.name }, { minGap: 2 });
  }

  /** Kaito out in his suit calls H8 over: it casts off if it must and comes to hold by him */
  callToKaito() {
    const g = this.g;
    if (!g.suits) return;
    const c = { kind: 'kaito', name: 'カイト' };
    if (this.mode === 'docked') { this.release({ goto: c }); return; }
    if (this.berthAt) { this.unberth({ goto: c }); return; }
    this.wake();
    this.pilot.setGoal({ kind: 'target', name: 'カイト', posOf: (t, pos, vel) => { g.suits.playerEci(pos); if (vel) vel.copy(g.flight.vel); return pos; }, standoff: 25, onArrive: () => this.say('hachi_kaito_here', {}, { force: true }) });
    this.goalKind = 'kaito';
  }

  /** a lock as a target B-29's autopilot can fly to (it moves: followed as it goes) */
  targetObj(c) {
    const ref = c.ref || c;
    const R = this.hud.radiusOf(c);
    return {
      id: c.id, name: c.name, kind: 'target', standoff: c.kind === 'drone' ? 1500 : Math.max(150, R * 3 + 120), tether: false,
      pos: new THREE.Vector3().copy(ref.pos), vel: new THREE.Vector3().copy(ref.vel || this.g.flight.vel),
      posOf(t, pos, vel) { pos.copy(ref.pos); vel.copy(ref.vel || vel); return pos; },
    };
  }

  // ==================================================================== what the tabs show
  /** the alert of the moment (the slim tab low ahead), or null */
  alertText() {
    const g = this.g, f = this.flight, docked = this.mode === 'docked';
    const z = g.lifeSupport.z.h8;
    const kPa = z ? z.n2 + z.o2 + z.co2 : 101.3;
    const hostile = this.cands.filter((c) => c.kind === 'drone' && c.threat).sort((a, b) => a.dist - b.dist);
    const th = this.cands.filter((c) => c.threat && c.kind !== 'drone').sort((a, b) => a.tca - b.tca)[0];
    if (th && th.tca < 30) return `衝突コース  ${th.name}  ${fmtDist(th.dist)}・${Math.max(0, th.tca).toFixed(0)}秒`;
    if (hostile.length) return `敵無人機 ${hostile.length}機  最接近 ${hostile[0].short} ${fmtDist(hostile[0].dist)}`;
    if (th) return `衝突コース  ${th.name}  ${fmtDist(th.dist)}・${Math.max(0, th.tca).toFixed(0)}秒`;
    if (this._leak && kPa < 95) return `船内減圧中  ${kPa.toFixed(1)} kPa`;
    if (f.fuel < 0.05 && !docked) return `推進剤 残り ${Math.round(f.tank.kg)} kg`;
    if (this.armour.outer < 0.2) return `外部装甲 限界  ${Math.round(this.armour.outer * 100)}%`;
    const dead = this.hull.cams.filter((c) => c < CAM_DEAD).length;
    if (dead) return `カメラ ${dead} 台 喪失 — その方向の表示なし`;
    return null;
  }

  /** the navigation tab's header */
  navLine() {
    const P = this.pilot;
    if (this.mode === 'docked') return 'B-29 と結合中';
    if (P.state === 'dock') return 'ドッキング進入';
    if (P.state === 'undock') return '離脱中';
    if (P.goal) return `${P.goal.name}  ${fmtDist(P.dist || 0)}${P.eta > 1 ? '  ' + fmtEta(P.eta) : ''}`;
    return this.crew ? '手動操縦' : '待機';
  }

  /** what B-29 is doing (for the B-29 tab and HACHI's reports) */
  b29State() {
    const g = this.g, ap = g.autopilot, fb = g.flight;
    if (g.docking && g.docking.state === 'docked') return 'ステーション係留中';
    if (ap.state === 'cruise' || ap.state === 'approach') return `${ap.target ? ap.target.name.replace('（修理基地）', '').replace('（サブ拠点）', '') : ''}へ ${fmtEta(ap.eta)}`;
    if (ap.state === 'hold') return '到着・保持中';
    if (fb.landed) return '着陸中';
    return '待機';
  }

  /** HACHI's tab header: its newest words, or what it is doing */
  hachiLine() {
    const last = this.g.asphalt.log.filter((e) => e.who === 'hachi').slice(-1)[0];
    if (last && this.g.time - last.t < 20000) { const t = last.text.replace(/^HACHI: /, ''); return t.length > 30 ? t.slice(0, 29) + '…' : t; }
    return this.awake > 0.5 ? '待機中・周辺監視' : '省電力';
  }

  suitLine() {
    const pl = this.g.player;
    if (pl.suit && pl.suitH8) return `着用中  O₂ ${Math.round(pl.suitO2 * 100)}%`;
    return this.shelter.locker.open > 0.5 ? 'シェルター内 収納庫 開' : 'シェルター内に収納';
  }

  /** HACHI's tab: its log, and what it can be asked to do */
  drawHachi(K, H) {
    const g = this.g;
    const log = g.asphalt.log.filter((e) => e.who === 'hachi').slice(-5);
    let y = 8;
    for (const e of log) {
      const t = e.text.replace(/^HACHI: /, '');
      const age = (g.time - e.t) / 1000;
      K.text(t.length > 30 ? t.slice(0, 29) + '…' : t, 14, y + 17, { size: 15, color: age < 15 ? '#ffd9a8' : COL_DIM });
      y += 24;
    }
    if (!log.length) K.text('HACHI からの報告はまだありません', 14, y + 17, { size: 15, color: COL_DIM });
    // what HACHI can be asked (it works the answers out from what it is watching)
    const M = this.mind;
    if (M.learn > 0.05) K.text(`攻撃パターン解析 ${Math.round(M.learn * 100)}%`, 498, H - 102, { size: 13, color: COL_DIM, align: 'right' });
    const bw = 117, by = H - 94;
    K.button(10, by, bw, 38, '状況分析', () => M.ask('sitrep'), { size: 14 });
    K.button(10 + (bw + 8), by, bw, 38, '敵情報', () => M.ask('threat'), { size: 14 });
    K.button(10 + (bw + 8) * 2, by, bw, 38, '帰還計画', () => M.ask('plan'), { size: 14 });
    K.button(10 + (bw + 8) * 3, by, bw, 38, 'どうする？', () => M.ask('advice'), { style: 'warn', size: 14 });
    const bw2 = 158, by2 = H - 48;
    K.button(10, by2, bw2, 40, 'H8 状況報告', () => this.reportH8(), { size: 14 });
    K.button(10 + bw2 + 9, by2, bw2, 40, 'B-29 状況', () => this.reportB29(), { style: this.link.ok ? 'normal' : 'disabled', size: 14 });
    K.button(10 + (bw2 + 9) * 2, by2, bw2, 40, 'ロック 全解除', () => this.hud.clear(), { style: this.hud.locks.length ? 'normal' : 'disabled', size: 14 });
  }

  /** the equipment tab: the shelter, the suit in it (tabs: the tab system, for its button row) */
  drawGear(K, H, tabs) {
    const g = this.g, pl = g.player, S = this.shelter;
    K.text('緊急シェルター（座席ごと後部へ）', 14, 26, { size: 17, color: S.state !== 'home' ? '#ffb347' : '#d7e7f7', weight: 700 });
    let y = 36;
    const o2 = S.o2Hours();
    y = tabs.row(K, y, '独立酸素', o2 / 10, `${o2.toFixed(1)} 時間`, '#5fe08f', o2 < 1);
    y = tabs.row(K, y, 'CO₂ 吸収剤', S.lioh, `${Math.round(S.lioh * 100)}%`, '#5fd0ff', S.lioh < 0.1);
    K.text('肘掛けの赤いボタン：カバーを上げてもう一度押すと、', 14, y + 15, { size: 14, color: COL_DIM });
    K.text('座席ごとレールで後ろのシェルターへ。密閉・独立酸素。', 14, y + 35, { size: 14, color: COL_DIM });
    y += 50;
    const on = pl.suit && pl.suitH8;
    K.text(on ? '宇宙服  着用中' : '宇宙服  シェルター内に収納', 14, y + 18, { size: 17, color: on ? '#7cf0a6' : '#d7e7f7', weight: 700 });
    y += 26;
    if (on) {
      y = tabs.row(K, y, '酸素', pl.suitO2, `${Math.round(pl.suitO2 * 100)}%`, '#5fd0ff', pl.suitO2 < 0.2);
      y = tabs.row(K, y, '推進剤', pl.suitFuel, `${Math.round(pl.suitFuel * 100)}%`, '#ffb347', pl.suitFuel < 0.15);
    } else K.text('シェルターに入ってから、右の壁のシャッターをタップ。', 14, y + 15, { size: 14, color: COL_DIM });
    const list = [[S.state === 'home' ? 'シェルターへ退避' : 'シェルター 作動中', () => S.go(), S.state === 'home' ? 'danger' : 'on']];
    list.push(['タブ配置 初期化', () => tabs.resetLayout()]);
    tabs.buttons(K, H, list);
  }

  /** the equipment tab's header */
  gearLine() {
    const pl = this.g.player, S = this.shelter;
    const suit = pl.suit && pl.suitH8 ? `スーツ O₂ ${Math.round(pl.suitO2 * 100)}%` : 'スーツ シェルター内';
    return S ? `シェルター O₂ ${S.o2Hours().toFixed(1)} 時間${S.occupied ? '（使用中）' : ''}  ・  ${suit}` : suit;
  }

  /** external-camera views around H8 (physics frame, for the camera mode while flying H8) */
  externalCamera(i) {
    const c = H8_EXT_CAMS[((i % H8_EXT_CAMS.length) + H8_EXT_CAMS.length) % H8_EXT_CAMS.length];
    const pos = c.pos.clone().add(DOCK);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(c.pos, c.look, V(0, 1, 0)));
    return { pos, quat: q, name: c.name, orbit: c.orbit ? c.look.clone().add(DOCK) : null };
  }

  /** the frame the view and the lamps live in (world, relative to the render origin) */
  frameMatrix(out) {
    // solo: H8's pose with the physics frame shifted so that H8.dockAt sits at H8's origin
    const q = this.flight.quat;
    return out.compose(DOCK.clone().applyQuaternion(q).negate(), q, _v.set(1, 1, 1));
  }

  /** B-29's own sounds are out of earshot while Kaito is away in H8 (everything below H8's neck) */
  muteB29Sound(p) { return this.solo && p.y < DOCK.y + H8.neckBottom - 0.2; }

  /** H8's machinery: the reactor and computers hum, the drive roars with its output */
  updateSound() {
    const A = this.g.audio;
    if (!A.ready) return;
    const near = this.mode === 'docked' || this.crew;
    const on = near && this.awake > 0.3;
    if (on && !this._snd) {
      this._snd = true;
      A.humLoop('h8hum', { pos: V(0, 0.0, 0.6).add(DOCK), freq: 61, gain: 0.03, harm: [1, 0.35, 0.5, 0.15] });
      A.noiseLoop('h8fans', { pos: V(0, -0.3, -0.5).add(DOCK), type: 'pink', freq: 1300, q: 0.7, gain: 0.025 });
      A.noiseLoop('h8drive', { pos: V(0, 0, 4.2).add(DOCK), type: 'brown', freq: 90, q: 0.6, gain: 0, filter: 'lowpass' });
    } else if (!on && this._snd) {
      this._snd = false;
      for (const id of ['h8hum', 'h8fans', 'h8drive']) A.stopLoop(id);
    }
    if (this._snd) {
      A.setLoopGain('h8drive', 0.02 + 0.22 * this.drive + 0.06 * this.aux, 0.3);
      A.setLoopGain('h8hum', 0.02 + 0.03 * this.power.reactor, 0.5);
    }
  }

  // ==================================================================== save / load
  serialize() {
    const f = this.flight;
    return {
      mode: this.mode, crew: this.crew, goal: this.goalKind || null,
      park: this.park ? { r: this.park.r, h: this.park.h.toArray(), e1: this.park.e1.toArray(), t0: this.park.t0 } : null,
      flight: f.serialize(), awake: this.wakeTarget,
      power: { smes: this.power.smes, feedOn: this.power.feedOn, boost: this.power.boost },
      armour: { outer: this.armour.outer, inner: this.armour.inner },
      hatch: this.hatch ? this.hatch.target : 0,
      met: !!this.metAsphalt, hits: this.hits,
      hull: this.hull.serialize(), leak: !!this._leak, v2: 1, air: this.air || null, panels: this.display.serializePanels(),
      circuits: { ...this.circuits }, patched: this.hull.dents.filter((d) => d.patched).map((d) => +d.seed.toFixed(5)), drive: this.driveMode,
      shelter: this.shelter.serialize(), structure: +this.structure.toFixed(3), berth: this.berthAt ? this.berthAt.id : null,
      learn: +this.mind.learn.toFixed(3), defence: this.defence.serialize(),
    };
  }

  restore(d) {
    if (!d) return;
    if (d.park) {
      const r = d.park.r;
      this.park = { r, n: Math.sqrt(MU_EARTH / (r * r * r)), h: new THREE.Vector3().fromArray(d.park.h), e1: new THREE.Vector3().fromArray(d.park.e1), t0: d.park.t0 };
    }
    Object.assign(this.power, d.power || {});
    Object.assign(this.armour, d.armour || {});
    this.wakeTarget = d.awake || 0;
    this.metAsphalt = !!d.met;
    this.hits = d.hits || 0;
    this.hull.restore(d.hull);
    this.display.restorePanels(d.panels, Math.max(0, Math.min(1, 1 - (0.35 * this.armour.outer + 0.45 * this.armour.inner + 0.2 * (d.structure ?? 1)))));
    if (d.air) this.air = { o2: d.air.o2, n2: d.air.n2 };
    if (d.circuits) Object.assign(this.circuits, d.circuits);
    if (d.learn) this.mind.learn = d.learn;
    if (d.patched) for (const dd of this.hull.dents) if (dd.hole && d.patched.includes(+dd.seed.toFixed(5))) this.patchHole(dd);
    if (d.leak && !this._leak && this.g.lifeSupport.z.h8) this._leak = this.g.lifeSupport.addLeak('h8', 3e-4, 'h8armour');
    this.awake = this.wakeTarget;
    if (d.flight) this.flight.restore(d.flight);
    this.mode = ['docked', 'free', 'pod', 'lost'].includes(d.mode) ? d.mode : 'parked';
    this.shelter.restore(d.shelter);
    this.structure = d.structure ?? 1;
    if (this.mode === 'pod' || this.mode === 'lost') {
      this.attachTo(false);
      this.crew = this.mode === 'pod' && !!d.crew;
      this.setColliders(false);
    } else if (this.mode === 'docked') {
      this.attachTo(true);
      this.syncDocked();
      this.umb = this.power.feedOn ? 1 : 0;
      this.umbTarget = this.umb;
      if (d.hatch > 0.5) { this.hatch.setTarget(1); this.hatch.open = 1; this.neckTarget = 1; this.neckOpen = 1; }
      this.applyBoost(true);
    } else {
      this.attachTo(false);
      if (this.mode === 'parked') this.placeParked(this.g.time);
      else if (d.goal) this.goal(d.goal);
    }
    this.crew = !!d.crew && (this.mode === 'free' || this.mode === 'pod');
    this.berthAt = this.mode === 'free' && d.berth ? this.g.stations.byId(d.berth) || null : null;
    if (this.berthAt) { this.pilot.setGoal(null); this.goalKind = null; this.holdBerth(); }
    if (this.mode === 'pod' || this.mode === 'lost') this.setLamps(this.mode === 'pod');
    this.driveMode = ['ultra', 'max', 'low'].includes(d.drive) ? d.drive : 'normal';
    this.defence.restore(d.defence);
    // saved before H8 waited above B-29 on a new game, and never woken: it does now
    if (!d.v2 && this.mode === 'parked' && !this.metAsphalt) this.relocate = true;
  }

  /** the time away from the game: a parked H8 needs nothing; a free one coasts or parks */
  catchUp(gap) {
    // adrift in the shelter while the game was away: Asphalt fetched it meanwhile
    if (this.mode === 'pod' && gap > 60) { this.recoverPod(); return; }
    if (this.mode === 'free') {
      if (this.crew) {
        // Kaito stayed aboard: HACHI held station (circular coast)
        const f = this.flight, r = f.pos.length(), n = Math.sqrt(MU_EARTH / (r * r * r));
        const h = new THREE.Vector3().crossVectors(f.pos, f.vel).normalize();
        const q = new THREE.Quaternion().setFromAxisAngle(h, n * gap);
        f.pos.applyQuaternion(q); f.vel.applyQuaternion(q); f.updateAttitude();
      } else if (this.goalKind === 'b29' || this.goalKind === 'escort') {
        // HACHI caught up with B-29 meanwhile and waits above it
        const fb = this.g.flight;
        this.flight.pos.copy(fb.pos).addScaledVector(_v.set(0, 1, 0).applyQuaternion(fb.quat), 120);
        this.flight.vel.copy(fb.vel);
        this.flight.updateAttitude();
      } else {
        // went home / parked itself
        this.parkHere();
        this.mode = 'parked';
        this.pilot.setGoal(null);
        this.goalKind = null;
      }
    }
  }
}
