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

export const START_TIME = Date.UTC(2041, 5, 1, 0, 30, 0); // 2041-06-01 09:30 JST

const FAR_SURFACE = { h: 0, water: false };

export class Game {
  constructor(engine, earth, params) {
    this.engine = engine;
    this.earth = earth;
    this.params = params;
    this.time = START_TIME;
    this.camWorld = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
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
    this.phys.addColliders(this.shipVis.colliders);
    this.phys.addColliders(this.shipVis.extColliders);
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
    this.elevator = new SpaceElevator(this.engine, this.stations.M);
    this.shafts = new LightShafts(this.shipVis.root);
    this.autopilot = new Autopilot(this);
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
    this.initWorldState();
    // H8 — Kaito's old sub-base (parked on its orbit until called)
    if (!this.params.has('noH8')) {
      this.h8 = new H8Vessel(this);
      this.h8.init();
      this.systems.add({ env: (env) => this.h8env(env) });
    }
    P(0.6);
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
    // ---- mode routing
    let flightIn = null;
    const F = this.focus;
    const focused = !!(F && !F.out);
    if (F) {
      F.t = Math.max(0, Math.min(1, F.t + (F.out ? -dt : dt) / 0.4));
      if (F.out && F.t <= 0) this.focus = null;
    }
    if (!dead && !focused && (this.mode === 'pilot' || this.mode === 'camera')) {
      flightIn = { throttle: inp.moveY, yaw: inp.moveX, pitch: inp.ry, roll: inp.rx };
    }
    if (!dead) {
      if (inp.pressed['b-exit']) { if (focused) this.exitFocus(); else this.systems.exitPressed(); }
      if (inp.pressed['b-cam'] && !focused) this.systems.cameraPressed();
      if (inp.pressed['b-cam-next']) this.extCam++;
      if (this.mode === 'camera' && !focused) {
        // drag in the middle / top of the screen: look round with the external camera
        const L = this.extLook;
        L.zoom = Math.max(0.35, Math.min(4, (L.zoom || 1) * (inp.pinch || 1)));
        L.yaw -= inp.lookDX * 0.0045;
        L.pitch = Math.max(-1.45, Math.min(1.45, L.pitch - inp.lookDY * 0.0045));
        // a double tap puts it back
        for (const tap of inp.taps) {
          const now = performance.now();
          if (now - L.lastTap < 380) { L.yaw = 0; L.pitch = 0; L.zoom = 1; L.lastTap = 0; } else L.lastTap = now;
        }
      }
      if (inp.pressed['b-drop']) this.systems.dropPressed();
    }
    // ---- flight
    this.autopilot.update(sdt);
    if (this.h8) flightIn = this.h8.preStep(sdt, flightIn);
    if (!this.docking.preStep(sdt)) this.flight.step(sdt, flightIn, (pos) => this.terrainAt(pos));
    this.docking.postStep(sdt);
    if (this.h8) this.h8.update(sdt, dt);
    // apparent gravity in the ship frame
    const qInv = this.flight.quat.clone().invert();
    this.gLocal.copy(this.flight.properAcc).negate().applyQuaternion(qInv);
    // ULTRA burns are compensated by the drive's inertial damper (otherwise the 0.27 g push and
    // the 0.7 g braking pulled everybody onto the bulkheads)
    if (this.flight.damp > 0.001) this.gLocal.multiplyScalar(1 - 0.985 * this.flight.damp);
    // riding H8 alone: its own manoeuvres are what Kaito feels
    if (this.h8 && this.h8.solo) this.gLocal.copy(this.h8.gLocal);
    this.phys.setGravity(this.gLocal);
    this.fx.gravity.copy(this.gLocal);
    this.phys.step(sdt);
    // ---- ship
    this.lifeSupport.step(sdt);
    this.damage.update(sdt);
    this.asteroids.update(sdt, dt);
    // ---- player (inside the habitat ring he walks in the ring's own turning frame)
    const inRing = this.docking.inRing;
    let env, gPl = this.gLocal;
    if (inRing) {
      this.docking.restoreRingState();
      gPl = this.docking.ringGravity(pl.pos, pl.vel, this._gRing || (this._gRing = new THREE.Vector3()));
      env = { nearRail: false, lowCeiling: false, liftDelta: null };
    } else {
      env = this.systems.playerEnv();
      this.docking.envFor(env, pl);
    }
    const lookInp = this.mode === 'camera' || focused ? Object.assign({}, inp, { lookDX: 0, lookDY: 0 }) : inp;
    pl.update(Math.min(sdt, 0.05), this.mode === 'walk' && !focused ? lookInp : Object.assign({}, lookInp, { moveX: 0, moveY: 0, up: 0 }), gPl, env);
    if (inRing && this.docking.inRing) { this.docking.storeRingState(); this.docking.toRenderSpace(); }
    // ---- taps
    for (const tap of inp.taps) {
      if (this.mode === 'camera' || dead) continue;
      if (focused) { this.monitors.focusTap(F.m, tap, this.engine.camera); continue; }
      const hit = this.interact.tap(tap, this.engine.camera);
      if (!hit) this.systems.tapNothing(tap);
    }
    this.systems.update(sdt, inp);
    this.breakup.update(Math.min(sdt, 0.1));
    this.docking.updateInterior(Math.min(sdt, 0.1));
    this.worldDamage.update(sdt);
    this.save.update(dt);
    this.hud.update(dt);
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
    const prev = this.focus && !this.focus.out ? this.focus : null;
    if (prev && prev.m !== m) this.monitors.setFocus(prev.m, false);
    this.focus = { m, t: this.focus ? this.focus.t : 0, out: false, pos, q, input: prev ? prev.input : this.input.mode };
    this.input.setMode('focus');
    this.monitors.setFocus(m, true);
    this.audio.click(slot.pos, 0.16);
  }

  exitFocus() {
    const F = this.focus;
    if (!F || F.out) return;
    F.out = true;
    this.input.setMode(F.input);
    this.monitors.setFocus(F.m, false);
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
    const k = 1 - Math.exp(-dt * 12);
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

  updateRender(dt) {
    const f = this.flight;
    const root = this.shipVis.root;
    // render origin: B-29, or H8 while Kaito flies it away from B-29
    const solo = !!(this.h8 && this.h8.solo);
    this.origin.copy(solo ? this.h8.flight.pos : f.pos);
    const one = new THREE.Vector3(1, 1, 1);
    root.matrix.compose(f.pos.clone().sub(this.origin), f.quat, one);
    root.matrixWorld.copy(root.matrix);
    const fr = this.frameRoot;
    if (solo) this.h8.frameMatrix(fr.matrix); else fr.matrix.copy(root.matrix);
    fr.matrixWorld.copy(fr.matrix);
    fr.updateMatrixWorld(true);
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
      const c = solo ? this.h8.externalCamera(this.extCam) : this.systems.externalCamera(this.extCam);
      const v = this.lookExternal(c, dt);
      eyeLocal = v.pos; viewQ = v.quat;
    } else if (!this.running && !this.params.has('view')) {
      // title: slow cinematic around the ship
      const a = (this.titleCamT || 0) * 2 + 0.6;
      eyeLocal = new THREE.Vector3(Math.sin(a) * 26, 6 + Math.sin(a * 0.7) * 3, Math.cos(a) * 26 - 2);
      viewQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eyeLocal, new THREE.Vector3(0, 0, -2), new THREE.Vector3(0, 1, 0)));
    } else {
      eyeLocal = pl.eyeLocal; viewQ = pl.lookQuat;
      const F = this.focus;
      if (F) {
        const e = F.t * F.t * (3 - 2 * F.t);
        eyeLocal = eyeLocal.clone().lerp(F.pos, e);
        viewQ = viewQ.clone().slerp(F.q, e);
      }
    }
    // shake
    const sh = this.shake;
    const shakeQ = new THREE.Quaternion();
    if (sh > 0.001) {
      const t = performance.now() / 1000;
      const k = this.focus ? 1 - 0.85 * this.focus.t : 1;
      shakeQ.setFromEuler(new THREE.Euler(Math.sin(t * 47) * sh * 0.02 * k, Math.sin(t * 39 + 1) * sh * 0.02 * k, Math.sin(t * 31 + 2) * sh * 0.03 * k));
      this.shake *= Math.exp(-dt * 2.2);
    }
    this.camWorld.copy(eyeLocal).applyQuaternion(frameQ).add(frameP);
    this.camQuat.copy(frameQ).multiply(viewQ).multiply(shakeQ);
    const cam = this.engine.camera;
    cam.matrix.compose(this.camWorld, this.camQuat, new THREE.Vector3(1, 1, 1));
    // world
    const origin = this.origin;
    this.space.update(origin, this.camWorld, this.time, dt, new THREE.Vector3(0, 0, 0));
    // inside the docked station's lobby its outer shell is hidden so the windows look out
    this.stations.shellHiddenFor = this.docking && this.docking.lobby && this.docking.lobby.contains(eyeLocal) ? this.docking.station.id : null;
    this.stations.update(this.time, origin, this.camWorld, dt);
    this.stations.setPixelScale(this.engine.renderer.getPixelRatio());
    this.elevator.update(this.time, origin, this.camWorld, this.space.sunDir, dt);
    if (this.asteroids) this.asteroids.updateVisual(origin, this.camWorld);
    const eyePF = this.debugCam || wreck || this.mode === 'camera' || (!this.running && !this.params.has('view')) ? null : eyeLocal;
    if (this.h8) this.h8.updateVisual(dt, origin, this.camWorld, eyePF);
    if (this.worldDamage) this.worldDamage.updateVisual(dt);
    {
      const sunLocal = this.space.sunDir.clone().applyQuaternion(f.quat.clone().invert());
      const ls = this.lifeSupport;
      const zid = ls ? ls.zoneAt(this.player.pos) : null;
      const air = zid && ls.z[zid] ? ls.pressure(zid) / 101.3 : (ls ? 0 : 1);
      this.shafts.update(sunLocal, this.space.sunColor, performance.now() / 1000, air);
    }
    this.shipVis.update(dt, this.time / 1000);
    // particles: point size scale from the projection
    const sc = this.engine.renderer.domElement.height / (2 * Math.tan(cam.fov * Math.PI / 360));
    this.fx.add.pts.material.uniforms.uScale.value = sc;
    this.fx.alpha.pts.material.uniforms.uScale.value = sc;
    this.fx.update(Math.min(dt * this.timeScale, 0.1));
    if (this.systems) this.systems.updateVisual(dt, this.camWorld.length());
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
