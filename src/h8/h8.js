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
import { H8Display, fmtDist, altOf } from './h8Display.js';
import { H8Hull, dentify, DENT_U } from './h8Dents.js';
import { Particles } from '../fx/particles.js';
import { HachiPilot } from './h8Pilot.js';
import { PORT, DorsalHatch, receptacleSocket } from './b29Port.js';
import { H8_PAGES } from './h8Monitors.js';
import { Flight } from '../ship/flight.js';
import { LAYER_NEAR, LAYER_MID, LAYER_FAR, assignLayers } from '../core/layers.js';
import { LAYER_PROXY } from '../player/interact.js';
import { MU_EARTH, R_EARTH } from '../core/astro.js';
import { STATUS_JP } from '../world/worldDamage.js';

function fmtEta(sec) {
  if (!sec || sec < 1) return '';
  if (sec < 60) return Math.round(sec) + '秒';
  if (sec < 3600) return Math.round(sec / 60) + '分';
  return (sec / 3600).toFixed(1) + '時間';
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DOCK = H8.dockAt;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);

/** H8 and B-29 hear each other within this distance (m) */
export const LINK_RANGE = 1.5e6;
// the outer materials that dent (the plates themselves can be torn through); lights, glass and
// the drive's glow do not
const PLATES = new Set(['armor', 'armorPlain', 'trim', 'decal']);
const NO_DENT = new Set(['plume', 'plumeCore', 'auxPlume', 'ledG', 'ledR', 'ledA', 'ledB', 'navR', 'navG', 'strobe', 'flood', 'coil', 'throat', 'dome']);

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
    this.intKeys = new Set(Object.keys(M).filter((k) => !extKeys.has(k)));
    for (const k of extKeys) if (!NO_DENT.has(k) && M[k].isMeshStandardMaterial) dentify(M[k], PLATES.has(k));
    this.ext = buildH8Exterior(M);
    this.int = buildH8Interior(M);
    this.display = new H8Display();
    this.root = new THREE.Group();
    this.root.name = 'H8';
    this.root.matrixAutoUpdate = false;
    this.root.add(this.ext.group, this.ext.far, this.int.group, this.display.mesh);
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
    this.flight = new Flight({ normalMax: 60 * H8.speedMulInternal, ultraMax: 900 * H8.speedMulInternal, aMax: H8.accel, mass: H8.mass, CdA: 18, comfortK: 4, rampK: 6, tank: { cap: H8.propKg, ve: H8.ve } });
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
    this.fuelSaid = 0;
    this.flickT = 0;
    this.cands = [];
    this.rockSeq = 0;
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
    const well = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const m = new THREE.Matrix4().makeRotationY(-a).setPosition(Math.cos(a) * (PORT.r + 0.04), (2.36 + PORT.yCollar) / 2, PORT.z + Math.sin(a) * (PORT.r + 0.04));
      well.push({ type: 'box', hx: 0.03, hy: (PORT.yCollar - 2.36) / 2, hz: 0.1, m });
    }
    g.phys.addColliders(well);
    this.buildUmbilical();
    // ---- H8 interior in the physics frame (enabled while it can be reached)
    const off = new THREE.Matrix4().makeTranslation(DOCK.x, DOCK.y, DOCK.z);
    const cols = this.int.colliders.map((c) => (c.type === 'mesh' ? { type: 'mesh', geo: c.geo.clone().applyMatrix4(off) } : Object.assign({}, c, { m: off.clone().multiply(c.m) })));
    this.cols = g.phys.addColliders(cols);
    this.neckCol = g.phys.addKinematicBox(H8.shaftR * 0.92, 0.04, H8.shaftR * 0.92, NECK_HATCH.clone().add(DOCK));
    this.colsOn = true;
    this.setColliders(false);
    // ---- lamps (physics frame), the seat, taps
    this.lamps = this.int.lamps.map((l) => Object.assign({}, l, { local: l.pos.clone(), pos: l.pos.clone().add(DOCK), base: l.intensity }));
    this.lampsIn = false;
    const s = this.int.seat;
    // standing up puts Kaito over the floor hatch behind the seat (between the seat and the
    // console there is no room for a body: he got wedged there and could not move)
    this.seat = Object.assign({}, s, { eye: s.eye.clone().add(DOCK), exit: V(0, H8.floorY, H8.shaftZ).add(DOCK), axis: s.axis.clone().add(DOCK), h8: true });
    const proxy = (pos, r) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), g.interact.proxyMat);
      m.position.copy(pos); m.layers.set(LAYER_PROXY);
      this.int.group.add(m);
      return m;
    };
    g.interact.addMesh(proxy(V(0, H8.cockpitC.y - 0.42, H8.cockpitC.z - 0.12), 0.34), () => g.systems.sit(this.seat), { maxDist: 2.2, enabled: () => g.player.state !== 'seated' });
    // the port panel in B-29's corridor, and the hatch wheel seen from the shaft in H8
    g.interact.addSphere(PORT.panel.clone().add(V(0.04, 0, 0)), 0.16, () => this.portTapped(), { maxDist: 2.2 });
    g.interact.addMesh(proxy(NECK_HATCH.clone().add(V(0, 0.12, 0)), 0.32), () => this.portTapped(), { maxDist: 2.4 });
    // ---- the three small displays in H8's cockpit
    Object.assign(Object.getPrototypeOf(g.monitors), H8_PAGES);
    this.mfd = this.int.mfd.map((slot) => g.monitors.addSlot(Object.assign({ h8: true }, slot), this.int.group, DOCK));
    // ---- a new game: H8 waits right above B-29, on standby
    if (!this.park) this.initAbove();
    this.placeParked(g.time);
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
    const x = p.x - DOCK.x, y = p.y - DOCK.y, z = p.z - DOCK.z;
    const C = H8.cockpitC;
    if ((x - C.x) ** 2 + (y - C.y) ** 2 + (z - C.z) ** 2 < (H8.cockpitR + 0.1) ** 2 && y > H8.floorY - 0.05) return true;
    if (Math.hypot(x, z - H8.shaftZ) < H8.shaftR + 0.05 && y > H8.neckHatchY - 0.05 && y < H8.floorY + 0.1) return true;
    return false;
  }

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
    if (this.mode === 'docked') return;
    const L = this.linkState();
    if (!L.ok) { this.asphalt(L.why === 'range' ? 'h8_out_of_range' : 'h8_link_down', { d: fmtDist(L.d) }); return; }
    // the flight costs H8 propellant: not enough for the trip, no trip
    const need = this.tripFuel(this.flight, L.d);
    if (this.flight.tank.kg < need) { this.asphalt('h8_no_fuel', { need: Math.ceil(need), kg: Math.floor(this.flight.tank.kg) }); return; }
    const was = this.mode;
    this.wake();
    const d = L.d;
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
    if (d > LINK_RANGE) return { ok: false, d, why: 'range' };
    return { ok: true, d, why: null };
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

  /** H8's screens run on H8's own power */
  screenPower() { return this.awake > 0.15 ? Math.min(1, 0.4 + this.awake * 0.6) : this.mode === 'docked' ? 0.35 : 0; }

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
    g.audio.impact(V(0, 2.6, PORT.z), 0.18);
    g.shake = Math.max(g.shake, 0.3);
    this.say(this.crew ? 'hachi_undock_crew' : 'hachi_undock');
    if (!this.crew) setTimeout(() => this.asphalt('h8_undocked'), 3500);
  }

  /** the pilot's final approach touched down: latches close */
  latch() {
    const g = this.g;
    this.mode = 'docked';
    this.pilot.setGoal(null);
    this.goalKind = null;
    this.attachTo(true);
    this.syncDocked();
    this.latchT = 1.2;
    this.umbTarget = this.power.feedOn ? 1 : 0;
    this.applyBoost(true);
    g.audio.impact(V(0, 3.0, PORT.z), 0.3);
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
    if (after === 'home') { this.goal('home'); this.say('hachi_home'); }
    else if (after === 'free') { this.goal('hold'); this.say('hachi_manual'); }
    else { this.goal('escort'); }
  }

  /** HACHI's speed and braking (H8's drive, on its own reactor or with the storage boost) */
  maxSpeed() { return this.flight.vUltra * Math.max(0.2, this.driveHealth()); }
  brakeAccel() { return 14 * Math.max(0.3, this.driveHealth()) * (this.flight.mul > 1 ? 1.4 : 1); }

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
    if (this.mode !== 'docked') {
      g.audio.denied(PORT.panel);
      this.asphalt('h8_port_none', {}, { minGap: 6, force: false });
      return;
    }
    if (this.pending) return;
    const open = this.hatch.target > 0.5;
    this.hatch.setTarget(open ? 0 : 1);
    this.neckTarget = open ? 0 : 1;
    g.audio.doorMotor && g.audio.doorMotor(V(0, 2.8, PORT.z), !open);
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
    if (!on) { f.mul = 1; f.aExtra = 0; f.boostDamp = false; f.extHealth = 0; f.extTank = null; f.extMass = 0; return; }
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

  driveHealth() { return Math.max(0, Math.min(1, 0.2 + 0.8 * this.armour.inner)) * (this.awake > 0.5 ? 1 : 0); }

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
    if (this.mode !== 'free') return flightIn;
    // Kaito at the controls of a free H8: the sticks fly H8 (B-29 holds its course)
    const seated = g.player.state === 'seated' && g.player.seat === this.seat;
    let input = null;
    if (this.crew && seated && (g.mode === 'pilot' || g.mode === 'camera') && !this.pilot.goal && this.pilot.state !== 'undock' && this.pilot.state !== 'dock') input = flightIn;
    this.flightInput = input;
    this.pilot.update(sdt, g.time - sdt * 1000);
    this.flight.step(sdt, input, (pos) => g.terrainAt(pos));
    this.collide(sdt);
    return this.crew ? null : flightIn;
  }

  /** after B-29's flight step */
  update(sdt, dt) {
    const g = this.g;
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
    // ---- hatches, air, umbilical
    this.updateHatches(sdt);
    this.updateAir(sdt);
    this.umb += (((this.umbTarget || 0) > 0.5 && this.mode === 'docked' ? 1 : 0) - this.umb > 0 ? 1 : -1) * sdt / 3.5;
    this.umb = Math.max(0, Math.min(1, this.umb));
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
      if (d < 420 && steady && !(g.docking && (g.docking.state === 'approach' || g.docking.state === 'leaving'))) {
        this.pilot.startDock();
        this.say('hachi_final');
      }
    }
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
    P.driveMW = thrustFrac * (boosting ? H8.driveMW.boost : H8.driveMW.cruise);
    P.loadMW = (2.5 + 1.5 * this.awake) + P.driveMW + (this.pd.cool > 0 ? 6 : 0);
    // supply: the reactor follows the load, the feed fills in, the SMES buffers the rest
    P.feed = this.feedOK();
    const feedAvail = P.feed ? H8.feedMW : 0;
    const reactorMax = H8.reactorMW * (this.awake > 0.1 ? 1 : 0.15);
    const want = Math.min(reactorMax, Math.max(0, P.loadMW - feedAvail * 0.5));
    P.reactor += (want / H8.reactorMW - P.reactor) * Math.min(1, dt * 0.4);
    P.reactor = Math.max(0.04, P.reactor);
    const supply = P.reactor * H8.reactorMW;
    P.feedMW = P.feed ? Math.min(feedAvail, Math.max(0, P.loadMW - supply) + (P.smes < H8.smesMJ * 0.98 ? 40 : 0)) : 0;
    const net = supply + P.feedMW - P.loadMW;   // MW = MJ/s
    P.smes = Math.max(0, Math.min(H8.smesMJ, P.smes + net * dt));
    // solo boost runs on the storage
    if (this.mode === 'free') this.flight.mul = (this.crew || this.pilot.goal) && P.boost && P.smes > H8.smesMJ * 0.03 ? 2 : 1;
  }

  updateHatches(dt) {
    const docked = this.mode === 'docked';
    if (!docked) { this.hatch.setTarget(0); this.neckTarget = 0; }
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
  }

  /** H8's own life support (cabin air), and the air shared through the open port */
  updateAir(dt) {
    const ls = this.g.lifeSupport;
    const z = ls.z.h8;
    if (!z) return;
    const ok = this.awake > 0.2 || this.mode === 'docked';
    if (ok && !z.leaks.some((l) => l.area > 2e-4)) {
      // regulate: O2 to 21.3, N2 to 79.2, scrub CO2 (its own tanks)
      z.o2 += (21.3 - z.o2) * Math.min(1, dt * 0.03);
      z.n2 += (79.2 - z.n2) * Math.min(1, dt * 0.02);
      z.co2 += (0.03 - z.co2) * Math.min(1, dt * 0.01);
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
          g.damage.impact(pLocal, nE.clone().applyQuaternion(_q.copy(g.flight.quat).invert()), E * 0.3);
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
    // stations
    for (const s of g.stations.list) {
      const P = s.model && s.model.userData.proxies;
      if (!P) continue;
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

  /** armour takes a blow: the outer plates first, then the inner pressure armour. dirLocal: from
   * H8's centre toward the point hit (H8-local) */
  armourHit(E, dirLocal) {
    const A = this.armour, g = this.g;
    const k = E / 4.0e7;
    const outerBefore = A.outer;
    const outer = Math.min(A.outer, k);
    A.outer -= outer;
    const rest = k - outer + (A.outer < 0.3 ? k * 0.3 : 0);
    if (rest > 0) A.inner = Math.max(0, A.inner - rest * 0.6);
    this.hits++;
    // the hull itself: a dent (or a hole) where it was hit, sparks, a blinded camera
    const res = this.hull.hit(dirLocal, E, { outer: outerBefore });
    if (res.blinded >= 0) setTimeout(() => this.say('hachi_cam_lost', { cam: CAMERAS[res.blinded].name }), 1800);
    // inside: the lights stutter, the display drops out for a moment, a console spits sparks
    const inside = this.crew || this.mode === 'docked';
    if (inside && E > 3e5) {
      this.flickT = Math.min(1.5, 0.3 + E / 2e7);
      if (E > 2e6) this.display.power *= 0.45;
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
    // where H8 is this frame, for the dents (they are worked out in H8's own frame)
    const rw = this.mode === 'docked' ? _m.multiplyMatrices(g.shipVis.root.matrixWorld, this.root.matrix) : this.root.matrixWorld;
    DENT_U.uH8Root.value.copy(rw);
    DENT_U.uH8RootInv.value.copy(rw).invert();
    // the seat turns on its column
    this.int.seatPivot.rotation.y = this.seat.yawSeat || 0;
    // ---- level of detail, layers
    const inside = eyePF && (this.containsPF(eyePF) || this.inVestibule(eyePF)) && (this.mode === 'docked' || this.crew);
    const near = this.mode === 'docked' || dCam < 2500;
    const showExt = near && !inside;
    this.ext.group.visible = showExt;
    if (showExt) {
      if (this.mode === 'docked') { for (const m of this.extMeshes) { m.layers.set(LAYER_NEAR); m.layers.enable(LAYER_MID); } }
      else for (const m of this.extMeshes) assignLayers(m, Math.max(0, dCam - 9), dCam + 9);
    }
    this.ext.far.visible = this.mode !== 'docked' && dCam > 1800;
    if (this.ext.far.visible) this.ext.far.traverse((o) => { if (o.isMesh) assignLayers(o, Math.max(0, dCam - 5), dCam + 5); });
    this.int.group.visible = this.mode === 'docked' ? (eyePF ? eyePF.distanceTo(DOCK) < 18 : false) : (this.crew || dCam < 30);
    this.display.mesh.visible = this.int.group.visible;
    this.neckHatch.visible = this.int.group.visible || dCam < 60;
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
    for (const p of this.ext.parts.plumes) {
      const k = p.main ? this.drive : this.aux * 0.6;
      p.group.visible = k > 0.01;
      if (!p.group.visible) continue;
      const flick = 0.9 + 0.1 * Math.sin(t * 61 + (p.main ? 0 : 3));
      p.cones.forEach((c, i) => { c.material.opacity = k * (i === 0 ? 0.32 : 0.14) * flick; c.scale.set(1, 1, 0.6 + 0.4 * k); });
      if (p.core) p.core.material.opacity = k * 0.9 * flick;
    }
    // radiators glow with the waste heat; they fold up while B-29 lies at a station's berth
    const heat = Math.min(1, this.power.reactor * 0.9 + this.drive * 0.6);
    M.radiator.emissiveIntensity = heat * heat * 0.35;
    const fold = this.mode === 'docked' && g.docking && g.docking.state !== 'free' ? 1 : 0;
    this.radFold += (fold - this.radFold) * Math.min(1, dt * 0.35);
    for (const r of this.ext.parts.radiators) r.pivot.rotation.z = r.side * this.radFold * 1.62;
    if (this.ext.parts.radar) this.ext.parts.radar.rotation.y += dt * (aw > 0.3 ? 2.2 : 0);
    // status LEDs blink, fans turn
    if (this.int.group.visible) {
      const L = this.int.leds, base = L.userData.base, rate = L.userData.rate, c = new THREE.Color();
      for (let i = 0; i < base.length; i += 1) {
        const on = aw < 0.15 ? (i % 9 === 0 ? 0.3 : 0) : (Math.sin(t * rate[i] + i * 1.7) > -0.2 ? 1 : 0.15);
        c.copy(base[i]).multiplyScalar(on);
        L.setColorAt(i, c);
      }
      L.instanceColor.needsUpdate = true;
      for (const r of this.int.rotors) r.rotateY(dt * 40 * aw);
    }
    // lamps: dim on standby; they stutter when a hit shakes the wiring
    this.flickT = Math.max(0, this.flickT - dt);
    const stut = this.flickT > 0 ? (Math.random() < 0.35 ? 0.15 : 0.6 + Math.random() * 0.4) : 1;
    for (const l of this.lamps) l.intensity = l.base * (0.25 + 0.75 * aw) * stut;
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
    // ---- the wrap-around display: on with Kaito in the cockpit and the power up
    const inCockpit = eyePF && this.crew && this.inCockpit(eyePF);
    this.display.update(dt, inCockpit && aw > 0.5);
    if (inCockpit && this.display.power > 0.01) this.updateDisplay(dt, rw, camWorld);
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
  /** per frame while Kaito is in the cockpit: where he looks, what is out there, the cards */
  updateDisplay(dt, rw, camWorld) {
    const g = this.g, D = this.display, f = this.flight;
    // the camera and the seat's eye (with its swivel) in H8's frame
    const camL = new THREE.Vector3().copy(camWorld).applyMatrix4(DENT_U.uH8RootInv.value);
    const s = this.int.seat, yaw = this.seat.yawSeat || 0;
    const eyeL = s.eye.clone().sub(s.axis).applyAxisAngle(Y, yaw).add(s.axis);
    D.setEye(eyeL, yaw, camL);
    // the line of sight
    const qv = new THREE.Quaternion().setFromRotationMatrix(rw).invert().multiply(g.camQuat);
    const gaze = new THREE.Vector3(0, 0, -1).applyQuaternion(qv);
    // what is out there (the list a few times a second, the directions every frame)
    this.candT = (this.candT || 0) - dt;
    if (this.candT <= 0) { this.candT = 0.2; this.cands = this.buildCands(); }
    const qInv = _q2.copy(f.quat).invert();
    const rel = new THREE.Vector3(), rv = new THREE.Vector3();
    for (const c of this.cands) {
      rel.copy(c.pos).sub(f.pos);
      c.dist = rel.length();
      c.dir = (c.dir || new THREE.Vector3()).copy(rel).divideScalar(Math.max(1e-6, c.dist)).applyQuaternion(qInv);
      c.closing = c.vel ? -rel.dot(rv.copy(c.vel).sub(f.vel)) / Math.max(1e-6, c.dist) : 0;
    }
    // orbit markers and the horizon's vertical
    const fl = this.mode === 'docked' ? g.flight : f;
    const vRel = fl.vel.clone().sub(fl.refVelocity(fl.pos, new THREE.Vector3()));
    const up = f.pos.clone().normalize().applyQuaternion(qInv);
    const orbit = { zen: up, nad: up.clone().negate() };
    if (vRel.lengthSq() > 1) { orbit.pro = vRel.normalize().applyQuaternion(qInv); orbit.retro = orbit.pro.clone().negate(); }
    D.updateMarks(dt, this.cands, gaze, orbit, up, (c) => this.onLock(c));
    this.cardT = (this.cardT || 0) - dt;
    if (this.cardT <= 0) { this.cardT = 0.25; D.paint(this.cards()); }
  }

  /** everything the display can track: B-29, stations within 3000 km, the Moon, rocks nearby */
  buildCands() {
    const g = this.g, f = this.flight, out = [];
    if (this.mode !== 'docked') out.push({ id: 'b29', kind: 'b29', name: 'B-29', short: 'B-29', pos: g.flight.pos, vel: g.flight.vel, extra: this.link.ok ? 'リンク良好' : '通信圏外' });
    for (const st of g.stations.list) {
      if (st.pos.distanceTo(f.pos) > 3.0e6) continue;
      const ss = st.dmg ? st.dmg.status : 'ok';
      out.push({ id: 'st:' + st.id, kind: 'station', name: st.name.replace('（修理基地）', ''), short: st.en || st.name, pos: st.pos, vel: st.vel, extra: ss !== 'ok' ? STATUS_JP[ss] : null });
    }
    if (g.space.moonPos) out.push({ id: 'moon', kind: 'body', name: '月', short: '月', pos: g.space.moonPos, vel: null });
    // rocks within 8 km; on a collision course they are threats
    const R0 = this.mode === 'docked' ? 16 : H8.R + 4;
    for (const a of g.asteroids.list) {
      if (a.dead || a.hit) continue;
      const rel = a.pos.clone().sub(f.pos);
      const d = rel.length();
      if (d > 8000) continue;
      if (!a.h8id) a.h8id = ++this.rockSeq;
      const rv = a.vel.clone().sub(f.vel);
      const tca = -rel.dot(rv) / Math.max(1e-6, rv.lengthSq());
      const miss = rel.clone().addScaledVector(rv, Math.max(0, tca)).length();
      const threat = tca > 0 && tca < 150 && miss < R0 + a.radius * 2 + 12;
      out.push({
        id: 'rk' + a.h8id, kind: 'rock', name: `岩塊 ${(a.radius * 2).toFixed(1)} m`, short: '岩塊', pos: a.pos, vel: a.vel, threat,
        extra: threat ? `衝突まで ${Math.max(0, tca).toFixed(0)} 秒・${a.radius <= 0.8 ? '迎撃' : '回避'}` : `最接近 ${fmtDist(miss)}`, tca,
      });
    }
    return out;
  }

  /** a lock-on: a short double pip (a threat: three low ones) */
  onLock(c) {
    const A = this.g.audio;
    if (!A.beep) return;
    if (c.threat) { for (let i = 0; i < 3; i++) A.beep(i < 2 ? 880 : 660, 0.07, 0.05, { direct: true, when: i * 0.12 }); }
    else { A.beep(1500, 0.04, 0.035, { direct: true }); A.beep(2000, 0.05, 0.035, { direct: true, when: 0.06 }); }
  }

  /** the three glass cards: H8, B-29 (over the cable or the radio), HACHI / the alert */
  cards() {
    const g = this.g, f = this.flight, P = this.power, docked = this.mode === 'docked';
    const fl = docked ? g.flight : f;
    const vRel = fl.vel.clone().sub(fl.refVelocity(fl.pos, new THREE.Vector3())).length();
    const modeTxt = docked ? 'B-29と結合' : this.pilot.state === 'dock' ? 'ドッキング進入' : this.pilot.state === 'undock' ? '離脱中' : this.pilot.goal ? 'HACHI 自律航行' : '手動操縦';
    const z = g.lifeSupport.z.h8;
    const kPa = z ? z.n2 + z.o2 + z.co2 : 101.3;
    const camsDown = this.hull.cams.map((h, i) => (h < 0.5 ? CAMERAS[i].name.split(' ')[0] : null)).filter(Boolean);
    const left = {
      title: 'H8', titleColor: 'rgba(255,190,90,0.97)', sub: modeTxt,
      warnBg: this.armour.inner < 0.15 || kPa < 70,
      lines: [
        { label: '速度', text: `${vRel.toFixed(vRel < 100 ? 1 : 0)} m/s`, big: true, right: `高度 ${(altOf(fl.pos) / 1000).toFixed(1)} km` },
        { label: '推力', text: `×${docked ? g.flight.mul : 6 * f.mul}${f.ultra && !docked ? '  ULTRA' : ''}`, amber: true, right: P.feed ? `給電 ${Math.round(P.feedMW)} MW` : '内部電源' },
        { label: '推進剤', bar: f.fuel, right: `${Math.round(f.fuel * 100)}%`, warn: f.fuel < 0.15, barColor: 'rgba(255,190,90,0.97)' },
        { label: '蓄電', bar: P.smes / H8.smesMJ, right: `${Math.round(P.smes / H8.smesMJ * 100)}%`, warn: P.smes < H8.smesMJ * 0.1 },
        { label: '装甲', bar: this.armour.outer, right: `外${Math.round(this.armour.outer * 100)} 内${Math.round(this.armour.inner * 100)}`, warn: this.armour.outer < 0.35, barColor: 'rgba(120,255,170,0.95)' },
        { label: '船内', text: `${kPa.toFixed(1)} kPa`, right: z ? `O₂ ${z.o2.toFixed(1)}` : '', warn: kPa < 90 },
      ],
    };
    if (this.pilot.goal) left.lines.push({ label: '目標', text: this.pilot.goal.name, right: fmtDist(this.pilot.dist || 0), dim: false });
    if (camsDown.length) left.lines.push({ label: 'カメラ', text: camsDown.join(' ') + ' 映像なし', warn: true });
    // B-29
    let right;
    const fb = g.flight, ap = g.autopilot;
    const integ = g.damage.integrityNow ?? g.damage.integrity();
    const alarm = g.systems.alarm.active;
    const pw = g.systems.power ?? 1;
    const b29State = g.docking && g.docking.state === 'docked' ? 'ステーション係留中' : ap.state === 'cruise' || ap.state === 'approach' ? `${ap.target ? ap.target.name.replace('（修理基地）', '').replace('（サブ拠点）', '') : ''}へ ${fmtEta(ap.eta)}` : ap.state === 'hold' ? '到着・保持中' : fb.landed ? '着陸中' : '待機';
    const common = [
      { label: '推進剤', bar: fb.fuel, right: `${Math.round(fb.fuel * 100)}%`, warn: fb.fuel < 0.15, barColor: 'rgba(255,190,90,0.97)' },
      { label: '船体', bar: integ, right: `${Math.round(integ * 100)}%`, warn: integ < 0.6, barColor: 'rgba(120,255,170,0.95)' },
      { label: '電力', bar: pw, right: `${Math.round(pw * 100)}%`, warn: pw < 0.4 },
      { label: '警報', text: alarm ? '作動中' : 'なし', warn: alarm, good: !alarm },
    ];
    if (docked) {
      right = { title: 'B-29', sub: '結合中・ケーブル', warnBg: alarm, lines: [{ label: '航法', text: b29State }, ...common] };
      right.lines.push({ label: '移送', text: this.xfer === 'toB29' ? 'H8 → B-29 推進剤' : this.fueling ? 'B-29 → H8 推進剤' : '—', amber: !!(this.xfer || this.fueling), dim: !(this.xfer || this.fueling) });
    } else if (this.link.ok) {
      const d = this.link.d;
      const cl = -g.flight.pos.clone().sub(f.pos).dot(g.flight.vel.clone().sub(f.vel)) / Math.max(1, d);
      right = { title: 'B-29', sub: 'リンク良好', subColor: 'rgba(120,255,170,0.95)', warnBg: alarm, lines: [
        { label: '距離', text: fmtDist(d), big: true, right: `${cl >= 0 ? '接近' : '離隔'} ${Math.abs(cl).toFixed(Math.abs(cl) > 100 ? 0 : 1)} m/s` },
        { label: '状態', text: b29State }, ...common,
      ] };
    } else {
      right = { title: 'B-29', sub: '通信圏外', subColor: 'rgba(255,92,64,0.98)', lines: [
        { label: '距離', text: fmtDist(this.link.d), big: true, warn: true },
        { text: `${(LINK_RANGE / 1000).toFixed(0)} km 以内で通信・呼び出しができます`, dim: true },
      ] };
    }
    // HACHI's words or the alert of the moment
    let alert = null;
    const th = this.cands.filter((c) => c.threat).sort((a, b) => a.tca - b.tca)[0];
    if (th) alert = `衝突コース  ${th.name}  ${fmtDist(th.dist)}・${Math.max(0, th.tca).toFixed(0)}秒`;
    else if (this._leak && kPa < 95) alert = `船内減圧中  ${kPa.toFixed(1)} kPa`;
    else if (f.fuel < 0.05 && !docked) alert = `推進剤 残り ${Math.round(f.tank.kg)} kg`;
    else if (this.armour.outer < 0.2) alert = `外部装甲 限界  ${Math.round(this.armour.outer * 100)}%`;
    const last = g.asphalt.log.filter((e) => e.who === 'hachi').slice(-1)[0];
    const say = last && g.time - last.t < 9000 ? last.text.replace(/^HACHI: /, 'HACHI：') : null;
    const n = this.display.locks.length;
    const foot = `ロック ${n}/8  ・  見つめるとロックオン` + (this.pilot.notes && this.pilot.notes.length ? '  ・  回避中' : docked ? '  ・  B-29 の操作は下のモニターのタブで' : '');
    const center = { alert, say: say && say.length > 36 ? say.slice(0, 35) + '…' : say, foot };
    return { left, right, center };
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
      hull: this.hull.serialize(), leak: !!this._leak, v2: 1,
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
    if (d.leak && !this._leak && this.g.lifeSupport.z.h8) this._leak = this.g.lifeSupport.addLeak('h8', 3e-4, 'h8armour');
    this.awake = this.wakeTarget;
    if (d.flight) this.flight.restore(d.flight);
    this.mode = d.mode === 'docked' ? 'docked' : d.mode === 'free' ? 'free' : 'parked';
    if (this.mode === 'docked') {
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
    this.crew = !!d.crew && this.mode === 'free';
    // saved before H8 waited above B-29 on a new game, and never woken: it does now
    if (!d.v2 && this.mode === 'parked' && !this.metAsphalt) this.relocate = true;
  }

  /** the time away from the game: a parked H8 needs nothing; a free one coasts or parks */
  catchUp(gap) {
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
