// Game orchestrator: owns the simulation (flight, interior physics, player, ship systems) and
// drives rendering with a floating origin at the ship.
import * as THREE from 'three';
import { Space } from './world/space.js';
import { R_EARTH, latLonToUnit, ecefToEci, eciToEcef, gmst } from './core/astro.js';
import { ShipVisual } from './ship/shipVisual.js';
import { createLayout, buildAllRooms } from './ship/rooms.js';
import { buildUnderfloor } from './ship/underfloor.js';
import { createNoiseVolume } from './core/noiseTex.js';
import { initRapier, LocalPhysics } from './physics/localPhysics.js';
import { Flight } from './ship/flight.js';
import { Player } from './player/player.js';
import { Input } from './core/input.js';
import { Interactions } from './player/interact.js';
import { createDoors, OuterHatch } from './ship/doors.js';
import { ShipSystems } from './ship/systems.js';
import { Hud } from './ui/hud.js';
import { AudioEngine } from './core/audio.js';
import { Asphalt } from './ship/asphalt.js';
import { LifeSupport } from './ship/lifeSupport.js';
import { Damage } from './ship/damage.js';
import { Stations } from './world/stations.js';
import { SpaceElevator } from './world/elevator.js';
import { Akamo } from './world/akamo.js';
import { LightShafts } from './ship/lightShafts.js';
import { Autopilot } from './ship/autopilot.js';
import { Docking } from './world/docking.js';
import { Asteroids } from './world/asteroids.js';
import { Monitors } from './ui/monitors.js';
import { Machines } from './ship/machines.js';
import { Particles } from './fx/particles.js';
import { SaveSystem } from './ship/save.js';
import { Gameplay } from './ship/gameplay.js';
import { createLooseProps } from './ship/loose.js';
import { Breakup } from './ship/breakup.js';
import { WorldDamage } from './world/worldDamage.js';
import { H8Vessel } from './h8/h8.js';
import { QUALITY, saveQuality } from './core/quality.js';
import { Combat } from './combat/combat.js';
import { Drones } from './combat/drones.js';
import { Weapons } from './combat/weapons.js';
import { springVec, springQuat } from './core/spring.js';
import { setFineVisible } from './ship/geom.js';
import { shipUniforms } from './ship/materials.js';
import { setSkyQuality } from './world/atmosphere.js';
import { HULL, halfWidthAt, heightRangeAt, OPENINGS } from './ship/hullShape.js';
import { B29Display } from './ship/b29Display.js';
import { Suits } from './suit/suits.js';
import { glassUniforms } from './ship/glass.js';
import { StatusLine } from './ui/statusLine.js';
import { ExtMarkers } from './ui/extMarkers.js';
import { Photos } from './ui/photos.js';
import { EscapePods } from './world/escapePods.js';
import { PlumeHeat } from './fx/plumeHeat.js';
import { AimPilot } from './ship/aimPilot.js';

export const START_TIME = Date.UTC(2041, 5, 1, 0, 30, 0); // 2041-06-01 09:30 JST

const FAR_SURFACE = { h: 0, water: false };

const _hjQ = new THREE.Quaternion(), _hjE = new THREE.Euler(), _hjM = new THREE.Matrix4();

const _qHead = new THREE.Quaternion();

export class Game {
  constructor(engine, earth, params) {
    this.engine = engine;
    this.earth = earth;
    this.params = params;
    this.time = START_TIME;
    this.camWorld = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
    // the outside's view: the head's (camQuat) — or, through H8's zoom, the cameras' stabilised
    // gimbal following it (what the magnified picture and the marks over it are drawn with)
    this.viewQuat = new THREE.Quaternion();
    this.running = false;
    this.mode = 'walk';         // walk | pilot | seated | camera | dead
    this.extCam = 0;
    // free look for the external cameras: drag to swing round (chase) or pan / tilt (mounted)
    this.extLook = { yaw: 0, pitch: 0, sy: 0, sp: 0, cam: 0, lastTap: 0 };
    this.shake = 0;
    this.timeScale = 1;
    this.gLocal = new THREE.Vector3();
    this.airlockMode = 'idle';
    this.audio = new AudioEngine();
    this.save = new SaveSystem(this);
    this._tmp = new THREE.Vector3();
  }

  async init(progress) {
    const P = (x) => progress && progress(x);
    createNoiseVolume(this.engine.renderer);
    this.space = new Space(this.engine, this.earth);
    P(0.1);
    await initRapier();
    this.phys = new LocalPhysics();
    this.layout = createLayout();
    this.shipVis = new ShipVisual(this.engine);
    const extra = [(b) => buildAllRooms(b, this.layout), (b) => buildUnderfloor(b, this.layout)];
    if (this.params.has('noRooms')) extra.length = 0;
    this.shipVis.build(extra);
    this.engine.scene.add(this.shipVis.root);
    // the frame the view, the light pool and the sounds live in: B-29's, or H8's while Kaito flies
    // H8 away from B-29 (see H8Vessel.frameMatrix)
    this.frameRoot = new THREE.Group();
    this.frameRoot.name = 'frame';
    this.frameRoot.matrixAutoUpdate = false;
    this.engine.scene.add(this.frameRoot);
    this.origin = new THREE.Vector3();
    P(0.35);
    // B-29's own walls and hull (switched off while Kaito is away with H8: the physics frame then
    // rides with H8, and B-29 is not really there)
    this.b29Static = [...this.phys.addColliders(this.shipVis.colliders), ...this.phys.addColliders(this.shipVis.extColliders)];
    this.flight = new Flight();
    this.player = new Player(this.phys);
    this.input = new Input(this.engine.renderer.domElement);
    this.interact = new Interactions(this.shipVis.root);
    this.interact.addOccluders(this.shipVis.interior);
    this.fx = new Particles(this.shipVis.root);
    // doors
    this.doors = createDoors(this.shipVis.M, this.phys);
    for (const d of Object.values(this.doors)) {
      this.shipVis.root.add(d.group);
      this.interact.addBox(new THREE.Vector3(0, d.h / 2, 0).applyMatrix4(d.group.matrixWorld), new THREE.Vector3(d.w, d.h, 0.3), d.group.quaternion, () => this.systems.doorTapped(d), { maxDist: 2.2 });
      d.onSound = (kind) => { if (kind === 'open' || kind === 'close') this.audio.doorMotor(d.group.position.clone().add(new THREE.Vector3(0, 1.9, 0)), kind === 'open'); else if (kind === 'denied') this.audio.denied(d.group.position); };
    }
    this.hatch = new OuterHatch(this.shipVis.M, this.phys);
    this.shipVis.root.add(this.hatch.group);
    P(0.45);
    // ship simulation
    this.lifeSupport = new LifeSupport(this);
    this.damage = new Damage(this);
    this.stations = new Stations(this.engine, this.shipVis.M, START_TIME);
    this.elevator = new SpaceElevator(this.engine, this.stations.M, this.stations, this);
    this.shafts = new LightShafts(this.shipVis.root);
    this.autopilot = new Autopilot(this);
    this.aim = new AimPilot(this);
    this.docking = new Docking(this);
    this.asteroids = new Asteroids(this);
    this.asteroids.setHull(this.shipVis.exterior.children.filter((m) => m.isMesh && !m.material.transparent));
    this.asphalt = new Asphalt(this);
    this.systems = new ShipSystems(this);
    this.machines = new Machines(this);
    this.monitors = new Monitors(this);
    this.gameplay = new Gameplay(this);
    this.systems.add(this.machines);
    this.systems.add(this.gameplay);
    this.systems.add({ init: () => this.monitors.init(), update: (dt) => this.monitors.update(dt) });
    await this.systems.init(P);
    this.loose = createLooseProps(this);
    this.breakup = new Breakup(this);
    this.worldDamage = new WorldDamage(this);
    this.hud = new Hud(this);
    this.statusLine = new StatusLine(this);
    this.extMarkers = new ExtMarkers(this);
    this.photos = new Photos(this);
    this.initWorldState();
    // H8 — Kaito's old sub-base (parked on its orbit until called)
    if (!this.params.has('noH8')) {
      this.h8 = new H8Vessel(this);
      this.h8.init();
      this.systems.add({ env: (env) => this.h8env(env) });
    }
    // combat: rounds in flight, the hunter drones, the guns of B-29 and H8
    this.combat = new Combat(this);
    if (!this.params.has('noDrones')) this.drones = new Drones(this, this.combat);
    this.weapons = new Weapons(this, this.combat);
    // the stations' escape pods (their bays, the pods in flight, breaking into one)
    this.pods = new EscapePods(this);
    // engine flames burn what is in them and dazzle the cameras near them
    this.plumeHeat = new PlumeHeat(this);
    // (riding AKAMO's cabin in its own frame: the cabin is the vessel he is in)
    this.ride = null;
    this.playerVessel = () => (this.ride ? this.ride : this.h8 && this.h8.solo ? this.h8.flight : this.flight);
    // Shirasagi's space elevator
    this.akamo = new Akamo(this);
    this.akamo.init();
    // the spacesuits: B-29's on its rack in the airlock, H8's in the shelter's niche
    this.suits = new Suits(this);
    if (this.machines.suitApi) this.suits.setRack('b29', this.machines.suitApi, this.machines.suitPivot, this.machines.suitIdle);
    if (this.h8 && this.h8.shelter && this.h8.shelter.suitRack) this.h8.shelter.suitRack(this.suits);
    // the cockpit's big screen: every material of B-29's learns to drop what lies behind it
    this.b29Display = new B29Display(this);
    this.b29Display.init();
    P(0.6);
    // graphics quality chosen earlier in this browser (the engine already started at its resolution)
    if (QUALITY.level !== 'high') this.applyQuality(QUALITY.level);
    // warm-up: stream terrain, compile shaders, capture environment maps
    for (let i = 0; i < 30; i++) {
      this.updateRender(0.016);
      if (i === 2) this.engine.render(0.016);
      if (i === 20) this.captureEnv();
      await new Promise((r) => setTimeout(r, 20));
      P(0.6 + 0.4 * (i / 30));
    }
  }

  /** start state: circular LEO, 420 km, over Japan heading north-east */
  initWorldState() {
    const p = this.params;
    const lat = (parseFloat(p.get('lat') || '34.5')) * Math.PI / 180;
    const lon = (parseFloat(p.get('lon') || '137.5')) * Math.PI / 180;
    const alt = parseFloat(p.get('alt') || '420000');
    if (p.get('t')) this.time = Date.parse(p.get('t'));
    const th = gmst(this.time);
    const up = ecefToEci(latLonToUnit(lat, lon), th);
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
    const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
    const head = parseFloat(p.get('head') || '55') * Math.PI / 180; // ISS-like ascending track
    const prograde = north.multiplyScalar(Math.cos(head)).add(east.multiplyScalar(Math.sin(head)));
    this.flight.initOrbit(up.clone().multiplyScalar(R_EARTH + alt), prograde);
    if (alt < 60000) {
      // debug start inside the atmosphere: hover with the air
      this.flight.refVelocity(this.flight.pos, this.flight.vel);
    }
    const view = p.get('spawn') || 'cockpit';
    const spawns = { cockpit: [0.8, 0.95, -9.4], living: [-1.5, 0.95, -5.6], corridor: [0, 0.95, -1.5], eng: [0, 0.95, 7.0], under: [0, -0.7, 0], airlock: [1.7, 0.95, -1.0], store: [-1.5, 0.95, 3.0], outside: [4.5, 1.2, -1.0] };
    this.player.teleport(new THREE.Vector3(...(spawns[view] || spawns.cockpit)));
    this.player.yaw = 0;
  }

  captureEnv() {
    this.shipVis.captureEnv(this.engine.scene, new THREE.Vector3(0, 0, 0), false);
    this.shipVis.captureEnv(this.engine.scene, new THREE.Vector3(-1.5, 1.4, -5.8).applyQuaternion(this.flight.quat), true);
    this.envT = 0;
  }

  // ------------------------------------------------------------------ main loop
  startIdle() {
    const loop = (t) => {
      requestAnimationFrame(loop);
      const now = t / 1000;
      let dt = this.last ? now - this.last : 0.016;
      this.last = now;
      dt = Math.min(dt, 0.1);
      if (this.running) this.update(dt);
      else this.idleUpdate(dt);
      this.updateRender(dt);
      this.engine.render(dt);
      this.engine.adapt(dt, now);
    };
    requestAnimationFrame(loop);
  }

  idleUpdate(dt) {
    // title screen: slow orbit, exterior beauty shot
    this.time += dt * 1000;
    this.flight.step(dt, null, (pos) => this.terrainAt(pos));
    this.titleCamT = (this.titleCamT || 0) + dt * 0.03;
  }

  begin(cont) {
    if (cont && this.save.hasSave()) this.save.load();
    this.running = true;
    this.input.enabled = true;
    this.systems.onBegin(cont);
    if (this.audio.musicOn) this.audio.setMusic(true);
  }

  terrainAt(pos) {
    const r = pos.length();
    if (r - R_EARTH > 25000) return FAR_SURFACE;   // far above any terrain: skip the sampling
    const th = gmst(this.time);
    const ecef = eciToEcef(pos, th, this._tmp).normalize();
    const out = [0];
    const h = this.space.terrain.heightAt(ecef, out);
    return { h, water: out[0] === 1 };
  }

  update(dt) {
    const sdt = dt * this.timeScale;
    this.time += sdt * 1000;
    const inp = this.input.poll();
    this.lastInput = inp;
    const pl = this.player;
    const dead = pl.state === 'dead';
    // (out cold — vacuum on the skin, no air — he does nothing at all)
    const limp = dead || !!(this.gameplay && this.gameplay.unconscious);
    // ---- mode routing
    let flightIn = null;
    // (the lean-in itself is animated per drawn frame: focusPose)
    const F = this.focus;
    const focused = !!(F && !F.out) || !!this.cine;
    if (!limp && !focused && (this.mode === 'pilot' || (this.mode === 'camera' && !(this.akamo && this.akamo.viewFrom)))) {
      flightIn = { throttle: inp.moveY, yaw: inp.moveX, pitch: inp.ry, roll: inp.rx };
    }
    // flying a stolen escape pod from H8's seat: the sticks are the pod's, H8 holds as it is
    const remote = !!(this.pods && this.pods.remote);
    // flying where he looks (aimPilot.js): at the controls, the drag aims the vessel he is in
    const seatNow = pl.state === 'seated' ? pl.seat : null;
    const h8Solo = !!(this.h8 && this.h8.mode === 'free' && this.h8.crew && this.h8.isH8Seat(seatNow));
    const ctlFlight = h8Solo ? this.h8.flight : this.flight;
    const h8Busy = h8Solo && (this.h8.pilot.goal || this.h8.pilot.state === 'dock' || this.h8.pilot.state === 'undock' || this.h8.berthAt);
    const canAim = !limp && !focused && !remote && this.mode === 'pilot' && this.aim.on && !h8Busy && !(this.h8 && this.h8.mode === 'pod') &&
      !(seatNow && seatNow.lockAim) && !(!h8Solo && this.docking.state === 'docked');
    let aiming = false;
    if (canAim) {
      const fi = this.aim.input(sdt, inp, ctlFlight, seatNow, this.h8 && seatNow === this.h8.seat ? this.h8.zoom.z : 1);
      if (fi) { flightIn = fi; aiming = true; }
    } else this.aim.active = false;
    // (B-29 swings round quicker after the look than on the sticks: it is told where to point)
    this.flight.followTurn = aiming && ctlFlight === this.flight && (this.flight.turnK || 1) < 2.2 ? 2.2 / (this.flight.turnK || 1) : 1;
    if (this.h8) this.h8.flight.followTurn = 1;
    this.lastFlightIn = flightIn;
    if (remote) { this.pods.remoteInput(limp ? null : flightIn, limp ? null : inp); flightIn = null; }
    if (!limp) {
      if (inp.pressed['b-exit']) { if (remote) this.pods.release(); else if (focused) this.exitFocus(); else this.systems.exitPressed(); }
      if (inp.pressed['b-cam'] && !focused) this.systems.cameraPressed();
      if (inp.pressed['b-follow']) {
        this.aim.setOn(!this.aim.on);
        if (this.statusLine) this.statusLine.note(this.aim.on ? '視点追従 ON：見た方向へ機体が向く・左スティックで前進と横移動' : '視点追従 OFF：右スティックで操縦', 4);
        if (this.audio.ready) this.audio.beep(this.aim.on ? 1320 : 880, 0.06, 0.05, { direct: true });
      }
      if (inp.pressed['b-cam-next']) this.extCam++;
      if (inp.pressed['b-cam-prev']) this.extCam--;
      if (this.mode === 'camera' && !focused) {
        // drag in the middle / top of the screen: look round with the external camera
        // (more sensitive than it was: a short drag swings the view a long way round)
        const L = this.extLook;
        L.zoom = Math.max(0.25, Math.min(6, (L.zoom || 1) * Math.pow(inp.pinch || 1, 1.6)));
        L.yaw -= inp.lookDX * 0.011;
        L.pitch = Math.max(-1.5, Math.min(1.5, L.pitch - inp.lookDY * 0.011));
        // a tap on something out there: focus on it (twice: go there); a double tap anywhere
        // else puts the view back
        for (const tap of inp.taps) {
          // (the viewfinder's strip of cameras along the bottom: a tap picks one)
          const ci = this.extMarkers ? this.extMarkers.stripAt(tap) : -1;
          if (ci >= 0) { this.extCam = ci; L.lastTap = 0; continue; }
          if (this.h8 && this.h8.hudTap(tap)) { L.lastTap = 0; continue; }
          const now = performance.now();
          if (now - L.lastTap < 380) { L.yaw = 0; L.pitch = 0; L.zoom = 1; L.lastTap = 0; } else L.lastTap = now;
        }
      }
      if (inp.pressed['b-drop']) this.systems.dropPressed();
      if (inp.pressed['b-shot'] && this.photos) this.photos.shoot();
    }
    // ---- flight
    this.autopilot.update(sdt);
    if (this.h8) flightIn = this.h8.preStep(sdt, flightIn);
    if (!this.docking.preStep(sdt)) this.flight.step(sdt, flightIn, (pos) => this.terrainAt(pos));
    this.docking.postStep(sdt);
    if (this.h8) this.h8.update(sdt, dt);
    // (the head looks along the aim, the cockpit having turned under it)
    if (aiming) this.aim.head(pl, ctlFlight, seatNow, sdt);
    // apparent gravity in the ship frame
    const qInv = this.flight.quat.clone().invert();
    this.gLocal.copy(this.flight.properAcc).negate().applyQuaternion(qInv);
    // ULTRA burns are compensated by the drive's inertial damper (otherwise the 0.27 g push and
    // the 0.7 g braking pulled everybody onto the bulkheads)
    if (this.flight.damp > 0.001) this.gLocal.multiplyScalar(1 - 0.985 * this.flight.damp);
    // riding H8 alone: its own manoeuvres are what Kaito feels
    if (this.h8 && this.h8.solo) this.gLocal.copy(this.h8.gLocal);
    // AKAMO: the cabin's run (and, riding in its frame, what is felt in it)
    if (this.akamo) this.akamo.update(sdt);
    if (this.ride) this.gLocal.copy(this.ride.gLocal);
    this.phys.setGravity(this.gLocal);
    this.fx.gravity.copy(this.gLocal);
    this.phys.step(sdt);
    // ---- ship
    this.lifeSupport.step(sdt);
    this.damage.update(sdt);
    this.asteroids.update(sdt, dt);
    if (this.drones) this.drones.update(sdt);
    if (this.weapons) this.weapons.update(sdt, limp || remote ? null : inp);
    if (this.combat) this.combat.update(sdt);
    if (this.pods) this.pods.update(sdt);
    // ---- player (inside the habitat ring he walks in the ring's own turning frame)
    const inRing = this.docking.inRing;
    let env, gPl = this.gLocal;
    if (inRing) {
      this.docking.restoreRingState();
      gPl = this.docking.ringGravity(pl.pos, pl.vel, this._gRing || (this._gRing = new THREE.Vector3()));
      const rlEnv = this.docking.lobby && this.docking.lobby.ring && this.docking.lobby.ring.lift;
      env = { nearRail: false, lowCeiling: false, liftDelta: rlEnv ? rlEnv.liftDelta(pl.pos) : null };
    } else {
      env = this.systems.playerEnv();
      this.docking.envFor(env, pl);
    }
    // out in a suit: its own thrusters and boosters fly him
    env.suit = this.suits && pl.suit ? this.suits : null;
    let lookInp = this.mode === 'camera' || focused || aiming || remote ? Object.assign({}, inp, { lookDX: 0, lookDY: 0 }) : inp;
    // through H8's zoom the head turns slower (the view is magnified)
    const zm = this.h8 && pl.seat === this.h8.seat ? this.h8.zoom.z : 1;
    if (zm > 1.01) lookInp = Object.assign({}, lookInp, { lookDX: lookInp.lookDX / zm, lookDY: lookInp.lookDY / zm });
    if (limp && !dead) lookInp = Object.assign({}, lookInp, { lookDX: 0, lookDY: 0, moveX: 0, moveY: 0, up: 0, rx: 0, ry: 0 });
    // (out in space in a suit he keeps his own motion: the frame is worked out round him)
    // (AKAMO's lift at Shirasagi moves before the player's step, so its car carries him exactly)
    const akLift = this.docking && this.docking.state === 'docked' && this.docking.lobby && this.docking.lobby.terminal;
    if (akLift) akLift.preStep(Math.min(sdt, 0.05), this);
    const rlPre = this.docking && this.docking.state === 'docked' && this.docking.lobby && this.docking.lobby.ring && this.docking.lobby.ring.lift;
    if (rlPre) rlPre.preStep(Math.min(sdt, 0.05), this);
    if (this.suits) this.suits.preStep(pl, sdt);
    pl.update(Math.min(sdt, 0.05), this.mode === 'walk' && !focused ? lookInp : Object.assign({}, lookInp, { moveX: 0, moveY: 0, up: 0 }), gPl, env);
    if (this.suits) this.suits.afterMove(pl);
    if (inRing && this.docking.inRing) { this.docking.storeRingState(); this.docking.toRenderSpace(); }
    if (this.suits) this.suits.update(sdt, Math.min(dt, 0.1));
    // ---- taps
    if (this.h8 && !limp) this.h8.hudHolds(inp.holds);
    for (const tap of inp.taps) {
      if (remote) { this.pods.remoteTap(tap); continue; }
      if (this.mode === 'camera' || limp || this.cine) continue;
      if (focused) { this.monitors.focusTap(F.m, tap, this.engine.camera); continue; }
      // H8's display: a tap in a lock's box (focus, aim point; twice: go there)
      if (this.h8 && this.h8.hudTap(tap)) continue;
      const hit = this.interact.tap(tap, this.engine.camera);
      if (!hit) this.systems.tapNothing(tap);
    }
    this.systems.update(sdt, inp);
    this.breakup.update(Math.min(sdt, 0.1));
    this.docking.updateInterior(Math.min(sdt, 0.1));
    this.worldDamage.update(sdt);
    this.save.update(dt);
    this.hud.update(dt);
    this.statusLine.update(dt);
  }

  /**
   * B-29's cabin (rooms, machines, loose things, doors: most of the ship's triangles) is drawn only
   * when it can be seen: from inside the hull, or from in front of a window or an open hatch / port
   * not too far off. Otherwise the outer panes show a dim inside of their own.
   */
  updateCabinVisibility() {
    const S = this.shipVis;
    if (!this._cabin) this._cabin = [S.interior, this.machines && this.machines.root, this.loose && this.loose.group, ...Object.values(this.doors || {}).map((d) => d.group)].filter(Boolean);
    const c = this._cabC || (this._cabC = new THREE.Vector3());
    const inv = this._cabM || (this._cabM = new THREE.Matrix4());
    c.copy(this.camWorld).applyMatrix4(inv.copy(S.root.matrixWorld).invert());
    let vis = false;
    if (c.z > HULL.zTip - 0.1 && c.z < HULL.zTail1 + 0.2) {
      const [bot, top] = heightRangeAt(c.z, c.x, 0);
      vis = c.y > bot - 0.05 && c.y < top + 0.05 && Math.abs(c.x) < halfWidthAt(c.z, c.y, 0) + 0.05;
    }
    this._cabInside = vis;
    if (!vis) {
      const d = this._cabD || (this._cabD = new THREE.Vector3());
      for (const o of OPENINGS) {
        if (vis) break;
        if (o.kind === 'hatch' && !(this.hatch && this.hatch.open > 0.01)) continue;
        if (o.kind === 'port' && !(this.h8 && this.h8.hatch && this.h8.hatch.open > 0.01)) continue;
        d.copy(c).sub(o.center);
        if (d.dot(o.normal) > -0.05 && d.lengthSq() < 14 * 14) vis = true;
      }
    }
    // (inside the station's lobby or ring while docked the cabin is just through the hatch)
    if (!vis && this.docking && this.docking.state === 'docked' && this.hatch && this.hatch.open > 0.01) vis = c.length() < 40;
    if (vis !== this._cabVis) {
      this._cabVis = vis;
      for (const gr of this._cabin) gr.visible = vis;
      glassUniforms.uHollow.value = vis ? 0 : 1;
    }
  }

  /**
   * LOW II, the eye in B-29's cabin: what lies outside (the Earth, the sky, stations...) shows only
   * through the windows, the cockpit's screen, a hatch or a breach, so the far and middle passes are drawn
   * only inside the box on the picture those cover (with none in view, not at all). They used to be
   * shaded over the whole picture and then painted over by the cabin.
   */
  updateFarRect() {
    const P = this.engine.mfPass;
    P.farRect = null;
    if (!this.engine.low2 || !this._cabInside || this.debugCam || this.mode === 'camera' || (this.h8 && this.h8.solo)) return;
    const cam = this.engine.camera;
    const M = this._frM || (this._frM = new THREE.Matrix4());
    M.copy(cam.matrix).invert().premultiply(cam.projectionMatrix).multiply(this.shipVis.root.matrixWorld);
    const C = this._frC || (this._frC = Array.from({ length: 8 }, () => new THREE.Vector4()));
    const e = this._frE || (this._frE = new THREE.Vector3());
    let x0 = 1, y0 = 1, x1 = -1, y1 = -1, any = false;
    const EPS = 1e-3;
    // a box (centre, three half axes) on the picture; the part of it behind the eye is cut off at
    // the eye's plane (its edges clipped there), so a window beside the eye still counts right
    const box = (c, a, b, n) => {
      let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9, front = 0;
      const add = (x, y, w) => { const px = x / w, py = y / w; bx0 = Math.min(bx0, px); bx1 = Math.max(bx1, px); by0 = Math.min(by0, py); by1 = Math.max(by1, py); };
      for (let i = 0; i < 8; i++) {
        e.copy(c).addScaledVector(a, i & 1 ? 1 : -1).addScaledVector(b, i & 2 ? 1 : -1).addScaledVector(n, i & 4 ? 1 : -1);
        C[i].set(e.x, e.y, e.z, 1).applyMatrix4(M);
        if (C[i].w > EPS) { front++; add(C[i].x, C[i].y, C[i].w); }
      }
      if (front === 0) return;                      // wholly behind the eye
      if (front < 8) {
        for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) {
          if (i & bit) continue;
          const p = C[i], q = C[i | bit];
          if ((p.w > EPS) === (q.w > EPS)) continue;
          const t = (EPS - p.w) / (q.w - p.w);
          add(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, EPS);
        }
      }
      if (bx1 < -1 || bx0 > 1 || by1 < -1 || by0 > 1) return;
      any = true;
      x0 = Math.min(x0, bx0); x1 = Math.max(x1, bx1); y0 = Math.min(y0, by0); y1 = Math.max(y1, by1);
    };
    const A = this._frA || (this._frA = { a: new THREE.Vector3(), b: new THREE.Vector3(), n: new THREE.Vector3(), c: new THREE.Vector3() });
    for (const o of OPENINGS) box(o.center, A.a.copy(o.u).multiplyScalar(o.halfW + 0.06), A.b.copy(o.v).multiplyScalar(o.halfH + 0.06), A.n.copy(o.normal).multiplyScalar(0.62));
    // the cockpit's big screen (the outside shows through it)
    box(A.c.set(0, 1.12, -10.95), A.a.set(1.2, 0, 0), A.b.set(0, 0.92, 0), A.n.set(0, 0, 0.62));
    // breaches in the hull
    const BR = shipUniforms.uBreach.value;
    for (let i = 0; i < BR.length; i++) {
      const B = BR[i];
      if (B.w <= 0) continue;
      const r = B.w * 1.8 + 0.45;
      box(A.c.set(B.x, B.y, B.z), A.a.set(r, 0, 0), A.b.set(0, r, 0), A.n.set(0, 0, r));
    }
    if (!any) { P.farRect = 'none'; return; }
    const W = this.engine.composer.inputBuffer.width, H = this.engine.composer.inputBuffer.height;
    const px0 = Math.max(0, Math.floor((Math.max(-1, x0) + 1) / 2 * W) - 2), px1 = Math.min(W, Math.ceil((Math.min(1, x1) + 1) / 2 * W) + 2);
    const py0 = Math.max(0, Math.floor((Math.max(-1, y0) + 1) / 2 * H) - 2), py1 = Math.min(H, Math.ceil((Math.min(1, y1) + 1) / 2 * H) + 2);
    P.farRect = { x: px0, y: py0, w: Math.max(1, px1 - px0), h: Math.max(1, py1 - py0) };
  }

  /** lean in to a monitor so it fills the view (taps then go to its buttons) */
  enterFocus(m) {
    if (this.mode === 'camera' || this.player.state === 'dead') return;
    const slot = m.slot, cam = this.engine.camera;
    const vf = cam.fov * Math.PI / 180;
    const hf = Math.atan(Math.tan(vf / 2) * cam.aspect);
    const d = Math.max(slot.h / (2 * Math.tan(vf / 2) * 0.86), slot.w / (2 * Math.tan(hf) * 0.9), 0.18);
    const pos = slot.pos.clone().addScaledVector(slot.n, d);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, slot.pos, slot.up));
    const old = this.focus;
    const prev = old && !old.out ? old : null;
    if (prev && prev.m !== m) this.monitors.setFocus(prev.m, false);
    // the camera's spring carries on from wherever it is (another screen, or on the way back out);
    // the sharp, fast-refreshing picture comes once it has arrived (no hitch during the move)
    this.focus = { m, out: false, pos, q, input: prev ? prev.input : this.input.mode, s: old ? old.s : null, amt: old ? old.amt : 0, hi: false };
    this.input.setMode('focus');
    this.audio.click(slot.pos, 0.16);
  }

  exitFocus() {
    const F = this.focus;
    if (!F || F.out) return;
    F.out = true;
    F.hi = false;
    this.input.setMode(F.input);
    this.monitors.setFocus(F.m, false);
  }

  /**
   * The lean-in to a screen and back, per drawn frame: the eye rides a critically damped spring to
   * the screen (the look turns slightly ahead of the move), settles without a wobble and is then
   * held exactly there; leaving, it springs back to wherever Kaito's head is now. Returns the pose
   * ({ pos, q }, ship frame), or null once back.
   */
  focusPose(F, eye, q, dt) {
    if (!F.s) F.s = { pos: eye.clone(), v: new THREE.Vector3(), q: q.clone(), w: new THREE.Vector3() };
    const S = F.s;
    if (S.m !== F.m) { S.m = F.m; S.d0 = Math.max(0.05, S.pos.distanceTo(F.pos)); }
    const gp = F.out ? eye : F.pos, gq = F.out ? q : F.q;
    const h = Math.min(dt, 0.05);
    springVec(S.pos, S.v, gp, 10, h);
    const ang = springQuat(S.q, S.w, gq, 12.5, h);
    const err = S.pos.distanceTo(gp);
    const amt = Math.max(0, 1 - S.pos.distanceTo(F.pos) / S.d0);
    if (!F.out) {
      F.amt = amt;
      // arrived: pinned to the screen exactly (no drift, no shake)
      if (err < 2e-4 && ang < 2e-4 && S.v.lengthSq() < 1e-6 && S.w.lengthSq() < 1e-6) { S.pos.copy(gp); S.q.copy(gq); S.v.set(0, 0, 0); S.w.set(0, 0, 0); F.amt = 1; }
      if (!F.hi && F.amt > 0.96) { F.hi = true; this.monitors.setFocus(F.m, true); }
    } else {
      F.amt = Math.min(F.amt, amt);
      if (err < 1e-3 && ang < 1e-3) { this.focus = null; return null; }
    }
    return S;
  }

  /** climbing B-29's dorsal well and H8's shaft under thrust: hand over hand */
  h8env(env) {
    const h = this.h8, pl = this.player;
    if (!h || !(h.docked || h.crew)) return;
    if (this.gLocal.length() > 2 && h.inColumn(pl.pos)) env.climb = true;
    // inside H8 the ceiling is low (crouch in the shaft only when gravity pulls)
    if (h.containsPF(pl.pos) && !h.inCockpit(pl.pos)) env.lowCeiling = false;
  }

  /** the external camera with the player's free look applied (smoothed) */
  lookExternal(c, dt) {
    const L = this.extLook;
    if (L.cam !== this.extCam) { L.cam = this.extCam; L.yaw = L.pitch = L.sy = L.sp = 0; L.zoom = L.sz = 1; }
    const k = 1 - Math.exp(-dt * 20);
    L.sy += (L.yaw - L.sy) * k; L.sp += (L.pitch - L.sp) * k;
    L.sz = (L.sz || 1) + ((L.zoom || 1) - (L.sz || 1)) * k;
    if (Math.abs(L.sy) < 1e-4 && Math.abs(L.sp) < 1e-4 && Math.abs(L.sz - 1) < 1e-3) return c;
    const Y = new THREE.Vector3(0, 1, 0);
    if (c.orbit) {
      // swing round the point the camera watches (azimuth about the ship's up, elevation over it)
      const off = c.pos.clone().sub(c.orbit);
      const r = off.length() * L.sz;          // pinch / wheel: closer or further
      const az = Math.atan2(off.x, off.z) + L.sy;
      const el = Math.max(-1.45, Math.min(1.45, Math.asin(off.y / off.length()) - L.sp));   // drag up: look up
      const pos = c.orbit.clone().add(new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(r));
      const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, c.orbit, Y));
      return { pos, quat };
    }
    // a mounted camera turns on its head: pan about the ship's up, tilt about its own right
    const yawQ = new THREE.Quaternion().setFromAxisAngle(Y, L.sy);
    const q = yawQ.multiply(c.quat.clone());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const quat = new THREE.Quaternion().setFromAxisAngle(right, L.sp).multiply(q);
    return { pos: c.pos, quat };
  }

  /**
   * Graphics quality, 'high', 'low' or 'low2' (LOW II), applied at once and remembered in this
   * browser. Low is about half the GPU work: ~0.72x pixel ratio, light anti-aliasing and bloom, 8 of
   * the 16 cabin lights, a quarter-size sun shadow map and no earthshine shadow, coarser terrain,
   * one-projection surface detail on the ship, stations drawn out to 160 km instead of 400 km,
   * slower camera feeds and screen redraws, no light shafts. LOW II: 0.45x pixel ratio, no
   * anti-aliasing pass, 4 cabin lights, a small shadow map redrawn every eighth frame, plain ship
   * surfaces, lighter sky, clouds and ground, far passes only where the cabin's windows are,
   * stations out to 80 km, feeds and screens slower again (its coarser, sectioned ship and sky
   * come with a start on LOW II). Shaders recompile once when it changes.
   */
  applyQuality(level) {
    const q = saveQuality(level), low = q !== 'high', low2 = q === 'low2';
    this.engine.setQuality(q);
    this.space.setQuality(low, low2);
    if (this.systems && this.systems.setLightPool) this.systems.setLightPool(low2 ? 4 : low ? 8 : 16);
    if (this.shafts) this.shafts.enabled = !low;
    if (this.stations) this.stations.visRange = low2 ? 8e4 : low ? 1.6e5 : 4.0e5;
    if (this.monitors && this.monitors.setQuality) this.monitors.setQuality(low, low2);
    if (this.drones) this.drones.setQuality(low);
    setSkyQuality(q);
    // the small surface detail (bolts, greebles, clamps...) goes at once; built only on a high start
    setFineVisible(this.engine.scene, !low);
    this.engine.scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.userData && m.userData.shipPatched) m.needsUpdate = true;
    });
    this.engine.renderer.shadowMap.needsUpdate = true;
    return QUALITY.level;
  }

  updateRender(dt) {
    const f = this.flight;
    const root = this.shipVis.root;
    // render origin: B-29, or H8 while Kaito flies it away from B-29
    const solo = !!(this.h8 && this.h8.solo);
    const ride = this.ride;
    this.origin.copy(ride ? ride.pos : solo ? this.h8.flight.pos : f.pos);
    const one = new THREE.Vector3(1, 1, 1);
    root.matrix.compose(f.pos.clone().sub(this.origin), f.quat, one);
    root.matrixWorld.copy(root.matrix);
    const fr = this.frameRoot;
    // (riding AKAMO: the cabin's pose, the physics frame shifted so its room's origin sits at it)
    if (ride) fr.matrix.compose(ride.off.clone().applyQuaternion(ride.quat).negate(), ride.quat, one);
    else if (solo) this.h8.frameMatrix(fr.matrix); else fr.matrix.copy(root.matrix);
    fr.matrixWorld.copy(fr.matrix);
    fr.updateMatrixWorld(true);
    // re-entry: the hull itself shudders under the eye (the frame the eye rides holds still)
    const hj = this.hullJitter || 0;
    if (hj > 0.01 && !solo) {
      const t = performance.now() / 1000, n = (a, b, c) => Math.sin(t * a + b) * 0.6 + Math.sin(t * c + b * 1.7) * 0.4;
      const r = 0.0065 * hj, d = 0.035 * hj;
      _hjQ.setFromEuler(_hjE.set(n(41, 0.3, 67) * r, n(37, 1.1, 59) * r * 0.6, n(53, 2.2, 31) * r));
      _hjM.makeRotationFromQuaternion(_hjQ).setPosition(n(47, 0.7, 71) * d, n(43, 1.9, 61) * d, n(29, 2.8, 83) * d * 0.5);
      root.matrix.multiply(_hjM);
      root.matrixWorld.copy(root.matrix);
    }
    const frameQ = new THREE.Quaternion().setFromRotationMatrix(fr.matrix);
    const frameP = new THREE.Vector3().setFromMatrixPosition(fr.matrix);
    // the docked station's habitat ring turns (and Kaito with it, if he is inside)
    this.docking.updateRingFrame(dt * this.timeScale);
    // camera
    const pl = this.player;
    let eyeLocal, viewQ;
    const wreck = this.breakup && this.breakup.camera();
    if (this.debugCam || wreck) {
      // test hook: free camera in ship space { pos, look } (also the view of a breaking ship)
      const c = this.debugCam || wreck;
      eyeLocal = c.pos;
      viewQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(c.pos, c.look, new THREE.Vector3(0, 1, 0)));
    } else if (this.mode === 'camera' && this.systems) {
      // (riding AKAMO: the view from H8 or B-29 escorting the cabin, given in the cabin's frame)
      const rv = ride && this.akamo && this.akamo.viewFrom ? this.akamo.remoteView(this.extCam, dt, this.origin, ride) : null;
      const c = rv ? null : solo ? this.h8.externalCamera(this.extCam) : this.systems.externalCamera(this.extCam);
      const v = rv || this.lookExternal(c, dt);
      eyeLocal = v.pos; viewQ = v.quat;
    } else if (!this.running && !this.params.has('view')) {
      // title: slow cinematic around the ship
      const a = (this.titleCamT || 0) * 2 + 0.6;
      eyeLocal = new THREE.Vector3(Math.sin(a) * 26, 6 + Math.sin(a * 0.7) * 3, Math.cos(a) * 26 - 2);
      viewQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eyeLocal, new THREE.Vector3(0, 0, -2), new THREE.Vector3(0, 1, 0)));
    } else {
      // H8's auto-follow turns the head now, on this frame's positions (no frame of lag behind a
      // fast target: at x42 that would be half the view)
      if (this.h8 && pl.state === 'seated' && pl.seat === this.h8.seat && this.h8.zoom.aim(dt, pl)) pl.viewQuat(pl.lookQuat);
      eyeLocal = pl.eyeLocal; viewQ = pl.lookQuat;
      const F = this.focus;
      if (F) {
        const P = this.focusPose(F, eyeLocal, viewQ, dt);
        if (P) { eyeLocal = P.pos; viewQ = P.q; }
      }
      // a suit going on or coming off: the eye follows the climb in (or out)
      if (this.cine) { const P = this.cine.pose(); if (P) { eyeLocal = P.pos; viewQ = P.q; } }
    }
    // shake
    const sh = this.shake;
    const shakeQ = new THREE.Quaternion();
    if (sh > 0.001) {
      const t = performance.now() / 1000;
      // (none at all once the eye is on a screen: the picture holds still; through H8's zoom a
      // jolt moves the magnified picture only as far as it moves the head, and a followed target
      // is held by the stabiliser)
      let k = this.focus ? 1 - (this.focus.amt || 0) : 1;
      // (through H8's zoom the jolt shakes the cockpit; the cameras' picture is stabilised)
      shakeQ.setFromEuler(new THREE.Euler(Math.sin(t * 47) * sh * 0.02 * k, Math.sin(t * 39 + 1) * sh * 0.02 * k, Math.sin(t * 31 + 2) * sh * 0.03 * k));
      this.shake *= Math.exp(-dt * 2.2);
    }
    this.camWorld.copy(eyeLocal).applyQuaternion(frameQ).add(frameP);
    this.camQuat.copy(frameQ).multiply(viewQ).multiply(shakeQ);
    // flying a stolen escape pod: the view is its cabin camera's (Kaito is still in H8's seat)
    const podCam = this.pods && this.pods.remote ? this.pods.remoteCamera(this._podCam || (this._podCam = {})) : null;
    if (podCam) { this.camWorld.copy(podCam.pos).sub(this.origin); this.camQuat.copy(podCam.quat); }
    // H8's zoom: the magnified picture is the outside cameras', on their stabilised gimbal — it
    // follows the head smoothly, the slower the further in it is zoomed (auto-follow holds it on
    // the target exactly), and no jolt shakes it; the cockpit is seen with the head as it is
    const Zm = this.h8 && pl.state === 'seated' && pl.seat === this.h8.seat && this.mode !== 'camera' && !this.debugCam && !podCam ? this.h8.zoom : null;
    const zoomed = !!(Zm && Zm.z > 1.02);
    if (zoomed) {
      const head = _qHead.copy(frameQ).multiply(viewQ);
      if (this._gimbal && !Zm.follow) this.viewQuat.slerp(head, 1 - Math.exp(-16 / (1 + 1.1 * Math.log10(Zm.z)) * dt));
      else this.viewQuat.copy(head);
    } else this.viewQuat.copy(this.camQuat);
    this._gimbal = zoomed;
    this.updateCabinVisibility();
    if (this.b29Display) this.b29Display.update(dt);
    // the suit seen from outside (another camera looking at him out on a walk)
    if (this.suits) this.suits.updateAvatar(dt, this.mode === 'camera' || !!this.debugCam || !!podCam);
    const cam = this.engine.camera;
    cam.matrix.compose(this.camWorld, this.viewQuat, new THREE.Vector3(1, 1, 1));
    // world
    const origin = this.origin;
    this.space.update(origin, this.camWorld, this.time, dt, new THREE.Vector3(0, 0, 0));
    // inside the docked station's lobby its outer shell is hidden so the windows look out
    // the docked station's shells are hidden from within where they would stand in front of its
    // windows: the lobby's from the lobby and the promenade (at Shirasagi; from anywhere inside at the
    // others), the skybridge's from the lobby, the bridge and the core. From AKAMO's tower and
    // platform both are seen from outside, through the windows.
    const lob = this.docking && this.docking.lobby, sid = lob && this.docking.station ? this.docking.station.id : null;
    const inside = !!(lob && lob.contains(eyeLocal));
    let sec = inside && lob.sectionAt ? lob.sectionAt(eyeLocal) : null;
    if (sec === 'akamo' && !lob.terminal.showsShell(eyeLocal)) sec = 'atrium';
    this.stations.shellHiddenFor = inside && (!lob.terminal || sec === 'lobby' || sec === 'promenade') ? sid : null;
    this.stations.bridgeHiddenFor = inside && sec !== 'akamo' ? sid : null;
    this.stations.update(this.time, origin, this.camWorld, dt);
    this.stations.setPixelScale(this.engine.pr);
    this.elevator.update(this.time, origin, this.camWorld, this.space.sunDir, dt, this.space);
    if (this.asteroids) this.asteroids.updateVisual(origin, this.camWorld);
    if (this.combat) this.combat.updateVisual(dt, origin, this.camWorld);
    if (this.drones) this.drones.updateVisual(dt, origin, this.camWorld);
    const eyePF = this.debugCam || wreck || podCam || this.mode === 'camera' || (!this.running && !this.params.has('view')) ? null : eyeLocal;
    if (this.h8) this.h8.updateVisual(dt, origin, this.camWorld, eyePF);
    if (this.suits && this.suits.rescuer) this.suits.rescuer.updateVisual(dt, origin, this.camWorld);
    if (this.akamo) this.akamo.updateVisual(dt, origin, this.camWorld);
    if (this.weapons) this.weapons.updateVisual(dt, origin, this.camWorld);
    if (this.pods) this.pods.updateVisual(dt, origin, this.camWorld);
    if (this.worldDamage) this.worldDamage.updateVisual(dt, this.camWorld);
    // the engines' flames and what is in them: worked out here, with every vessel and every plume
    // where it is drawn this frame (during the step the plumes are still where they were drawn the
    // frame before — at orbital speed a hundred metres behind the ships carrying them)
    if (this.plumeHeat && this.running) this.plumeHeat.update(dt * this.timeScale);
    if (this.extMarkers) this.extMarkers.update();
    {
      const sunLocal = this.space.sunDir.clone().applyQuaternion(f.quat.clone().invert());
      const ls = this.lifeSupport;
      const zid = ls ? ls.zoneAt(this.player.pos) : null;
      const air = zid && ls.z[zid] ? ls.pressure(zid) / 101.3 : (ls ? 0 : 1);
      this.shafts.update(sunLocal, this.space.sunColor, performance.now() / 1000, air);
    }
    this.shipVis.update(dt, this.time / 1000);
    // particles: point size scale from the projection
    const sc = this.engine.pxPerRad(cam);
    this.fx.add.pts.material.uniforms.uScale.value = sc;
    this.fx.alpha.pts.material.uniforms.uScale.value = sc;
    this.fx.update(Math.min(dt * this.timeScale, 0.1));
    if (this.systems) this.systems.updateVisual(dt, this.camWorld.length());
    this.updateFarRect();
    // listener at the player's head (also while watching an external camera); while Kaito is away
    // in H8, B-29's own machinery is far behind him
    this.audio.mutePred = solo ? (p) => this.h8.muteB29Sound(p) : null;
    this.audio.setListener(pl.eyeLocal, pl.lookQuat);
    // refresh the space reflection when the lighting really changed (sunrise / sunset, the ship
    // turned): a recapture swaps every reflection at once, so it must not happen on a timer
    this.envT = (this.envT || 0) + dt;
    if (this.envT > 30 && this.running) {
      this.envT = 0;
      const sunL = this.space.sunDir.clone().applyQuaternion(f.quat.clone().invert());
      const lum = this.space.sunColor.r + this.space.sunColor.g + this.space.sunColor.b;
      const last = this._envState;
      // only for big changes (in / out of the Earth's shadow, the ship turned well round), and
      // never more often than every 30 s: each recapture swaps every reflection at once
      if (!last || sunL.angleTo(last.sun) > 0.7 || lum > 2.2 * Math.max(0.05, last.lum) || lum < 0.45 * last.lum) {
        this._envState = { sun: sunL, lum };
        this.shipVis.captureEnv(this.engine.scene, new THREE.Vector3(0, 0, 0), false);
      }
    }
  }
}
