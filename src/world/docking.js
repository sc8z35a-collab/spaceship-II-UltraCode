// Docking with hub stations, the walk-in lobby, and collisions between B-29 and station structures.
//
// Docking: from wherever the autopilot holds, B-29 swings around the station at a safe radius to
// its berth side, closes in along the berth line and mates its airlock to the lobby's docking
// tunnel (ship origin at DOCK_AT, same orientation as the station). Docked, the ship rides with the
// station: weightless at an orbiting station, about 0.88 g at the elevator's station (it turns
// with the Earth instead of orbiting). The lobby (visual, colliders, lamps) is attached to the ship
// while docked; the outer hatch then opens onto breathable station air.
//
// Collisions: the hull is approximated by spheres, stations by capsules / spheres / boxes. On
// contact the ship is pushed out, bounces softly and takes damage from the normal speed.
import * as THREE from 'three';
import { MU_EARTH, OMEGA_EARTH } from '../core/astro.js';
import { DOCK_AT } from './stations.js';
import { buildLobby, setGlobeTexture } from './stationLobby.js';
import { buildOriginInterior } from './originInterior.js';
import { StationAir } from './stationAir.js';
import { RING } from './stationRing.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _Z = new THREE.Vector3(0, 0, 1);
const SHIP_MASS = 42000;
// hull spheres (ship-local): body, nose, tail, reactor, engine, and the two radiator fins (thin
// 6.4 x 3.4 m plates: two rows of small spheres each — the old fat ones stood 1.7 m proud of the
// plates and grazed the promenade module at the berth, which aborted many a docking)
const FIN = [];
for (const sx of [-1, 1]) for (const x of [2.5, 4.1, 5.7, 7.3]) for (const z of [12.3, 13.9]) FIN.push([sx * x, 0.4, z, 0.9]);
const SHIP_SPHERES = [
  [0, 0.4, -10.8, 2.3], [0, 0.4, -7.2, 2.95], [0, 0.4, -3.2, 3.0], [0, 0.4, 0.8, 3.0], [0, 0.4, 4.6, 2.9], [0, 0.4, 8.2, 2.3],
  [0, 0.4, 12.0, 1.7], [0, 0.4, 15.4, 1.6], [0, 0.4, 17.6, 1.3],
  ...FIN,
].map(([x, y, z, r]) => ({ c: V(x, y, z), r }));

function segPoint(p, a, b, out) {
  const ab = out.subVectors(b, a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
  return out.copy(a).addScaledVector(ab, t);
}

/** signed distance from p to a proxy surface and the outward normal (station-local) */
function proxyDist(p, P, n) {
  if (P.type === 'sphere') { n.subVectors(p, P.c); const d = n.length(); n.divideScalar(Math.max(d, 1e-6)); return d - P.r; }
  if (P.type === 'capsule') { const q = segPoint(p, P.a, P.b, new THREE.Vector3()); n.subVectors(p, q); const d = n.length(); n.divideScalar(Math.max(d, 1e-6)); return d - P.r; }
  if (P.type === 'cyl') {
    // flat-ended cylinder a..b, radius r
    const ab = P.b.clone().sub(P.a), L = ab.length(), u = ab.divideScalar(L);
    const w = p.clone().sub(P.a), h = w.dot(u);
    const rad = w.addScaledVector(u, -h), rho = rad.length();
    const rdir = rho > 1e-6 ? rad.divideScalar(rho) : V(1, 0, 0);
    const dR = rho - P.r, dA = h < L / 2 ? -h : h - L, adir = h < L / 2 ? u.clone().negate() : u;
    if (dR > 0 && dA > 0) { const d = Math.hypot(dR, dA); n.copy(rdir).multiplyScalar(dR).addScaledVector(adir, dA).divideScalar(d); return d; }
    if (dR > dA) { n.copy(rdir); return dR; }
    n.copy(adir); return dA;
  }
  // axis-aligned box
  const d = p.clone().sub(P.c);
  const q = V(Math.abs(d.x) - P.h.x, Math.abs(d.y) - P.h.y, Math.abs(d.z) - P.h.z);
  const out = V(Math.max(q.x, 0), Math.max(q.y, 0), Math.max(q.z, 0));
  const lo = out.length();
  if (lo > 0) { n.set(Math.sign(d.x) * out.x, Math.sign(d.y) * out.y, Math.sign(d.z) * out.z).divideScalar(lo); return lo; }
  // inside: nearest face
  const m = Math.max(q.x, q.y, q.z);
  n.set(q.x === m ? Math.sign(d.x) : 0, q.y === m ? Math.sign(d.y) : 0, q.z === m ? Math.sign(d.z) : 0);
  return m;
}

export class Docking {
  constructor(game) {
    this.g = game;
    this.state = 'free';          // free | approach | docked | leaving
    this.station = null;
    this.wp = [];
    this.lobbies = new Map();
    this.lobby = null;
    this.cols = null;
    this.lamps = [];
    this.tFinal = 0;
    this.lastHit = 0;
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._v = new THREE.Vector3();
    // the habitat ring: Kaito inside it walks in the ring's own (turning) frame
    this.inRing = false;
    this.ringState = { pos: new THREE.Vector3(), eye: new THREE.Vector3(), look: new THREE.Quaternion(), up: new THREE.Vector3(), vel: new THREE.Vector3() };
    this.riding = false;
  }

  get docked() { return this.state === 'docked'; }

  /** B-29's hull spheres and the proxy distance (shared with H8's collisions) */
  get shipSpheres() { return SHIP_SPHERES; }
  proxyDist(p, P, n) { return proxyDist(p, P, n); }

  /** hub station close enough to start a docking */
  candidate() {
    const g = this.g, ap = g.autopilot;
    const open = (s) => !s.dmg || (s.dmg.status !== 'failed' && s.dmg.status !== 'destroyed');
    if (ap.state === 'hold' && ap.target && ap.target.kind === 'hub' && ap.dist < 3000 && open(ap.target)) return ap.target;
    let best = null;
    for (const s of g.stations.list) {
      const d = s.pos.distanceTo(g.flight.pos);
      if (s.kind === 'hub' && open(s) && d < 2000 && (!best || d < best.d)) best = { s, d };
    }
    best = best && best.s;
    return best;
  }

  /** station pose at time t: { pos, vel, quat } (ECI) */
  stationPose(s, t, out = {}) {
    out.pos = out.pos || new THREE.Vector3(); out.vel = out.vel || new THREE.Vector3(); out.quat = out.quat || new THREE.Quaternion();
    this.g.stations.posOf(s, t, out.pos, out.vel);
    this.g.stations.frameOf({ pos: out.pos, vel: out.vel }, out.quat);
    return out;
  }

  /** velocity of a point riding with the station */
  frameVel(s, pose, p, out) {
    if (s.tether) return out.set(OMEGA_EARTH * p.z, 0, -OMEGA_EARTH * p.x);
    // orbiting: the station frame turns at the orbital rate about the orbit normal
    const h = new THREE.Vector3().crossVectors(pose.pos, pose.vel);
    const n = h.length() / pose.pos.lengthSq();
    h.normalize().multiplyScalar(n);
    return out.copy(pose.vel).add(new THREE.Vector3().crossVectors(h, p.clone().sub(pose.pos)));
  }

  toLocal(pose, pEci, out = new THREE.Vector3()) {
    return out.copy(pEci).sub(pose.pos).applyQuaternion(pose.quat.clone().invert());
  }

  toEci(pose, pLocal, out = new THREE.Vector3()) {
    return out.copy(pLocal).applyQuaternion(pose.quat).add(pose.pos);
  }

  // ------------------------------------------------------------------ requests (nav monitor)
  request() {
    const g = this.g;
    if (this.state === 'docked') return this.undock();
    if (this.state === 'approach') { this.abort(); return; }
    if (this.state === 'leaving') return;
    const s = this.candidate();
    if (!s) { g.asphalt.say('st_dock_far', {}, { force: true }); return; }
    if (g.flight.landed) return;
    if (g.flight.ultra || g.flight.ultraDown) { g.asphalt.say('st_dock_ultra', {}, { force: true }); return; }
    this.station = s;
    const pose = this.stationPose(s, g.time);
    const cur = this.toLocal(pose, g.flight.pos);
    // swing around at a safe radius to the berth side, then in along the berth line
    // (about four times quicker than it used to be: the drive works harder during the manoeuvre,
    // with the inertial damper on so the cabin stays calm)
    const Rs = cur.length(), R0 = s.berthR || 200;
    const from = cur.clone().normalize(), to = V(-1, 0, 0);
    const qa = new THREE.Quaternion().setFromUnitVectors(from, to);
    const steps = Math.max(1, Math.ceil(from.angleTo(to) / (25 * Math.PI / 180)));
    this.wp = [];
    for (let k = 1; k <= steps; k++) {
      const q = new THREE.Quaternion().slerp(qa, k / steps);
      // spiral in to the berth radius while swinging round
      this.wp.push({ p: from.clone().applyQuaternion(q).multiplyScalar(Math.max(R0, Rs + (R0 - Rs) * (k / steps))), v: 90, tol: 22, pass: true });
    }
    this.wp.push({ p: V(-R0, DOCK_AT.y, DOCK_AT.z), v: 70, tol: 10 });
    this.pushFinal();
    this.retries = 0;
    // the autopilot hands over
    const ap = g.autopilot;
    ap.state = 'off'; ap.target = null;
    g.flight.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null, fast: true };
    this.state = 'approach';
    this.tFinal = 0;
    g.asphalt.say('st_dock_start', { name: s.name }, { force: true });
  }

  /** the last stretch in along the berth line. align: hold there until the ship (and H8 on its back,
   * its radiators folded) lines up with the station — swinging in still turning, H8 sticking up
   * 11 m above B-29's back could brush the lobby module */
  pushFinal() {
    this.wp.push({ p: V(DOCK_AT.x - 22, DOCK_AT.y, DOCK_AT.z), v: 40, tol: 1.5, align: true });
    this.wp.push({ p: V(DOCK_AT.x - 6, DOCK_AT.y, DOCK_AT.z), v: 4, tol: 0.4 });
    this.wp.push({ p: DOCK_AT.clone(), v: 1.2, tol: 0.06, final: true });
  }

  /** a touch on the way in: back off along the berth line and come in again (three goes) */
  retry() {
    const g = this.g;
    this.retries = (this.retries || 0) + 1;
    if (this.retries > 3) { this.abort(); return; }
    this.wp = [{ p: V(DOCK_AT.x - 40, DOCK_AT.y, DOCK_AT.z), v: 8, tol: 3 }];
    this.pushFinal();
    this.tFinal = 0;
    g.asphalt.say('st_dock_retry', {}, { minGap: 10 });
  }

  abort() {
    const g = this.g;
    this.state = 'free';
    this.wp = [];
    g.flight.autopilot = null;
    g.flight.setSpeed = 0;
    g.asphalt.say('st_dock_abort', {}, { force: true });
  }

  undock() {
    const g = this.g;
    if (g.hatch.target > 0.5 || g.hatch.open > 0) { g.asphalt.say('st_dock_hatch', {}, { force: true }); return; }
    if (this.lobby && this.lobby.contains(g.player.pos)) { g.asphalt.say('st_dock_crew', {}, { force: true }); return; }
    this.despawn();
    this.state = 'leaving';
    this.wp = [{ p: V(DOCK_AT.x - 8, DOCK_AT.y, DOCK_AT.z), v: 3, tol: 0.5 }, { p: V(DOCK_AT.x - 90, DOCK_AT.y, DOCK_AT.z), v: 30, tol: 3, last: true }];
    g.flight.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null, fast: true };
    g.asphalt.say('st_undock', { name: this.station.name }, { force: true });
  }

  /** the station gives way (wrecked): let go at once, no checks, drift clear */
  forceRelease() {
    const g = this.g;
    this.despawn();
    if (g.hatch.target > 0.5) g.hatch.target = 0;
    this.state = 'leaving';
    this.wp = [{ p: V(DOCK_AT.x - 60, DOCK_AT.y, DOCK_AT.z), v: 6, tol: 3, last: true }];
    g.flight.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null };
  }

  // ------------------------------------------------------------------ docked state
  spawn() {
    const g = this.g, s = this.station;
    let lobby = this.lobbies.get(s.id);
    if (!lobby) {
      lobby = s.origin ? buildOriginInterior(g.engine.renderer, s) : buildLobby(g.engine.renderer, s);
      if (g.earth && g.earth.color && lobby.globeMat) setGlobeTexture(lobby, g.earth.color);
      this.lobbies.set(s.id, lobby);
    }
    this.lobby = lobby;
    g.shipVis.root.add(lobby.group);
    lobby.group.updateMatrixWorld(true);
    this.cols = g.phys.addColliders(lobby.colliders);
    for (const d of lobby.doors || []) d.attach(g.phys);
    this.lamps = lobby.lamps;
    g.systems.lamps.push(...this.lamps);
    g.stations.dockedId = s.id;
    // the station's air, section by section (kept per station while the game runs)
    this.airs = this.airs || new Map();
    if (!this.airs.has(s.id)) this.airs.set(s.id, new StationAir(lobby, s));
    this.air = this.airs.get(s.id);
    this.air.ringContains = lobby.ring ? (p) => this.inRing && this.ringContainsRender(p) : null;
    if (lobby.ring) this.spawnRing(lobby.ring);
  }

  // ------------------------------------------------------------------ the habitat ring
  /** the ring's centre in the ship frame (docked: the station frame shifted by the berth) */
  ringCenter() {
    const ring = this.station.model.userData.ring;
    return ring.position.clone().sub(DOCK_AT);
  }

  spawnRing(R) {
    const g = this.g, s = this.station;
    const C = this.ringCenter();
    R.center = C;
    R.group.position.copy(C);
    g.shipVis.root.add(R.group);
    // colliders in ring space (= the ring as it stands at angle 0)
    const cols = R.colliders.map((c) => {
      if (c.type === 'mesh') { const geo = c.geo.clone(); geo.translate(C.x, C.y, C.z); return { type: 'mesh', geo }; }
      return Object.assign({}, c, { m: new THREE.Matrix4().makeTranslation(C.x, C.y, C.z).multiply(c.m) });
    });
    this.ringCols = g.phys.addColliders(cols);
    this.ringLamps = R.lamps;
    g.systems.lamps.push(...R.lamps);
    // the call panel at the hub terminal, the call buttons in the ring's elevator halls
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    this.ringTaps = [g.interact.addSphere(R.terminal.button, 0.32, () => this.rideRing(true), { maxDist: 2.4 })];
    for (const h of R.halls) {
      if (!h.proxy) { h.proxy = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), proxyMat); h.proxy.position.copy(h.button.position); R.group.add(h.proxy); }
      this.ringTaps.push(g.interact.addMesh(h.proxy, () => this.rideRing(false), { maxDist: 2.6 }));
    }
    s.ringDriven = true;
  }

  despawnRing() {
    const g = this.g, R = this.lobby && this.lobby.ring;
    if (!R) return;
    if (this.inRing) this.leaveRingFrame();
    g.shipVis.root.remove(R.group);
    if (this.ringCols) for (const c of this.ringCols) g.phys.world.removeCollider(c, true);
    this.ringCols = null;
    g.systems.lamps = g.systems.lamps.filter((l) => !R.lamps.includes(l));
    for (const slot of g.systems.pool) if (slot.lamp && R.lamps.includes(slot.lamp)) { slot.lamp = null; slot.out = false; slot.light.intensity = 0; }
    for (const t of this.ringTaps || []) g.interact.remove(t);
    this.ringTaps = null;
    if (this.station) this.station.ringDriven = false;
    this.setRingDetail(true);
  }

  ringAngle() { return this.station.model.userData.ring.rotation.z; }

  /** a ring-space point (the ring at angle 0) into the ship frame, and back */
  ringToRender(p, out = new THREE.Vector3()) {
    const C = this.lobby.ring.center;
    return out.copy(p).sub(C).applyAxisAngle(_Z, this.ringAngle()).add(C);
  }

  renderToRing(p, out = new THREE.Vector3()) {
    const C = this.lobby.ring.center;
    return out.copy(p).sub(C).applyAxisAngle(_Z, -this.ringAngle()).add(C);
  }

  ringContainsRender(p) {
    const R = this.lobby && this.lobby.ring;
    if (!R) return false;
    return R.contains(this.renderToRing(p, this._p).sub(R.center));
  }

  /** apparent gravity in the ring (ring space): the spin pushes you outward; walking with or
   * against the spin makes you a little heavier or lighter (Coriolis) */
  ringGravity(p, v, out = new THREE.Vector3()) {
    const C = this.lobby.ring.center;
    const w = RING.omega * (this.station.ringK ?? 1);
    out.set(p.x - C.x, p.y - C.y, 0);
    const r = out.length();
    if (r < 1e-3) return out.set(0, 0, 0);
    const rad = out.divideScalar(r);
    // -2 w x v, radial part only (the sideways part would tip the view while walking)
    const cor = 2 * w * (v.y * rad.x - v.x * rad.y);
    return rad.multiplyScalar(w * w * r + cor);
  }

  /** ride the spoke elevator: down into the ring (true) or up to the hub terminal (false) */
  rideRing(down) {
    const g = this.g, R = this.lobby && this.lobby.ring;
    if (!R || this.riding || this.state !== 'docked' || g.player.state === 'dead') return;
    if (down === this.inRing) return;
    const st = this.station.dmg ? this.station.dmg.status : 'ok';
    if (st === 'destroyed') { g.audio.denied(g.player.eyeLocal); return; }
    // no power: the cars stand still — the ladder in the spoke is a long climb
    const dark = st === 'failed';
    if (dark) g.asphalt.say('ring_dark', {}, { minGap: 20, force: true });
    this.riding = true;
    g.audio.beep(880, 0.12, 0.08, { pos: g.player.eyeLocal });
    g.audio.doorMotor && g.audio.doorMotor(g.player.eyeLocal, false);
    g.hud.setFade(1);
    if (g.audio.ready) {
      g.audio._burst(null, { dur: 3.2, freq: 140, q: 0.6, gain: 0.18, type: 'brown', filter: 'lowpass', direct: true, attack: 0.6, sweep: down ? 1.8 : 0.6 });
      g.audio._burst(null, { dur: 2.6, freq: 900, q: 1.2, gain: 0.05, type: 'pink', direct: true, attack: 0.8, sweep: down ? 0.5 : 2 });
    }
    setTimeout(() => {
      const pl = g.player;
      if (this.state !== 'docked' || !this.lobby || this.lobby.ring !== R) { this.riding = false; g.hud.setFade(0); return; }
      if (down) {
        // step out of the car in the first hall, facing along the deck
        const h = R.halls[0];
        this.inRing = true;
        const p = h.out.clone().add(R.center);
        pl.teleport(p);
        pl.up.set(-Math.cos(h.a * Math.PI / 180), -Math.sin(h.a * Math.PI / 180), 0);
        pl.yaw = -Math.PI / 2; pl.pitch = 0; pl.state = 'walk';
        pl.eyeLocal.copy(p).addScaledVector(pl.up, 0.7);
        this.storeRingState();
        this.toRenderSpace();
        g.asphalt.say('ring_arrive', { g: (RING.omega * RING.omega * RING.floor / 9.81 * Math.pow(this.station.ringK ?? 1, 2)).toFixed(2) }, { force: true });
      } else {
        this.leaveRingFrame();
        pl.teleport(R.terminal.out.clone());
        pl.up.set(0, 1, 0);
        pl.yaw = 0; pl.pitch = 0; pl.state = 'float';
        g.asphalt.say('ring_leave', {}, { minGap: 30 });
      }
      g.audio.beep(1320, 0.1, 0.08, { pos: pl.eyeLocal });
      setTimeout(() => { g.hud.setFade(0); this.riding = false; }, 600);
    }, dark ? 7000 : 2400);
  }

  /** stop walking in the ring's frame: Kaito stays where he is in the ship frame */
  leaveRingFrame() {
    if (!this.inRing) return;
    const pl = this.g.player;
    this.inRing = false;
    this.toRenderSpace();
    pl.teleport(pl.pos.clone());
  }

  storeRingState() {
    const pl = this.g.player, s = this.ringState;
    s.pos.copy(pl.pos); s.eye.copy(pl.eyeLocal); s.look.copy(pl.lookQuat); s.up.copy(pl.up); s.vel.copy(pl.vel);
  }

  /** before the player's step: put Kaito back into ring space */
  restoreRingState() {
    const pl = this.g.player, s = this.ringState;
    pl.pos.copy(s.pos); pl.eyeLocal.copy(s.eye); pl.lookQuat.copy(s.look); pl.up.copy(s.up); pl.vel.copy(s.vel);
  }

  /** what everyone else sees of Kaito this frame: ring-space state turned with the ring */
  toRenderSpace() {
    const pl = this.g.player, s = this.ringState;
    const q = this._q.setFromAxisAngle(_Z, this.ringAngle());
    this.ringToRender(s.pos, pl.pos);
    this.ringToRender(s.eye, pl.eyeLocal);
    pl.lookQuat.copy(q).multiply(s.look);
    pl.up.copy(s.up).applyQuaternion(q);
    pl.vel.copy(s.vel).applyQuaternion(q);
  }

  /** per render frame (before the camera): turn the ring, its inside and its lamps together */
  updateRingFrame(dt) {
    const R = this.lobby && this.lobby.ring;
    if (!R || this.state !== 'docked') return;
    const s = this.station, ring = s.model.userData.ring;
    ring.rotation.z += dt * RING.omega * (s.ringK ?? 1);
    ring.updateMatrix();
    const th = ring.rotation.z;
    R.group.rotation.z = th;
    const C = R.center;
    for (const l of R.lamps) l.pos.copy(l.local).applyAxisAngle(_Z, th).add(C);
    if (this.inRing) this.toRenderSpace();
    this.setRingDetail(!this.inRing);
  }

  /** the outer ring's window glows, gold bands and strobes cut through the inside: hidden there */
  setRingDetail(on) {
    const ring = this.station && this.station.model.userData.ring;
    if (!ring || this._ringDetail === on) return;
    this._ringDetail = on;
    const M = this.g.stations.M;
    ring.traverse((o) => { if (o.isMesh && (o.material === M.gold || o.material === M.windowLit || o.material === M.strobe)) o.visible = on; });
  }

  despawn() {
    const g = this.g;
    if (this.klaxon) { this.klaxon = false; g.audio.stopLoop('stKlaxon'); }
    if (!this.lobby) return;
    this.despawnRing();
    g.shipVis.root.remove(this.lobby.group);
    if (this.cols) for (const c of this.cols) g.phys.world.removeCollider(c, true);
    this.cols = null;
    for (const d of this.lobby.doors || []) d.detach(g.phys);
    g.systems.lamps = g.systems.lamps.filter((l) => !this.lamps.includes(l));
    for (const slot of g.systems.pool) if (slot.lamp && this.lamps.includes(slot.lamp)) { slot.lamp = null; slot.out = false; slot.light.intensity = 0; }
    this.lamps = [];
    this.lobby = null;
    this.air = null;
    g.stations.dockedId = null;
  }

  /** while docked: ride with the station (replaces the flight step) */
  hold() {
    const g = this.g, f = g.flight, s = this.station;
    const pose = this.stationPose(s, g.time);
    this.toEci(pose, DOCK_AT, f.pos);
    this.frameVel(s, pose, f.pos, f.vel);
    f.quat.copy(pose.quat);
    f.qRel.copy(f.lvlhQuat(f.pos, new THREE.Quaternion()).invert().multiply(pose.quat));
    f.wRel.set(0, 0, 0);
    f.setSpeed = 0;
    f.autopilot = null;
    // non-gravitational acceleration of a point riding the station: orbit -> ~0, tether -> ~0.88 g up
    const r = f.pos.length();
    const grav = f.pos.clone().multiplyScalar(-MU_EARTH / (r * r * r));
    const aFrame = s.tether ? V(-OMEGA_EARTH * OMEGA_EARTH * f.pos.x, 0, -OMEGA_EARTH * OMEGA_EARTH * f.pos.z) : pose.pos.clone().multiplyScalar(-MU_EARTH / Math.pow(pose.pos.length(), 3));
    f.properAcc.copy(aFrame).sub(grav);
    f.thrustAcc.set(0, 0, 0);
    f.dragAcc.set(0, 0, 0);
    f.heatFlux = 0;
    f.groundAlt = 1e9;
    f.vertSpeed = 0;
    if (this.lobby && this.lobby.globe) this.lobby.globe.rotation.y += 0.0015;
  }

  /** dock instantly (restoring a save) */
  redock(id) {
    const s = this.g.stations.byId(id);
    if (!s) return;
    this.station = s;
    this.state = 'docked';
    this.hold();
    this.spawn();
  }

  serialize() { return this.state === 'docked' && this.station ? this.station.id : null; }

  // ------------------------------------------------------------------ per frame
  /** before the flight step; returns true when the step must be skipped (docked) */
  preStep(dt) {
    if (this.state === 'docked') { this.hold(); return true; }
    if (this.state === 'approach' || this.state === 'leaving') this.steer(dt);
    return false;
  }

  /** after the flight step */
  postStep(dt) {
    if (this.state !== 'docked') this.collide(dt);
  }

  steer(dt) {
    const g = this.g, f = g.flight, s = this.station;
    if (!f.autopilot) f.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null, fast: true };
    // the clock already moved on by dt; the ship's state still belongs to the start of the step
    // (an orbiting station travels ~770 m in 0.1 s)
    const pose = this.stationPose(s, g.time - dt * 1000);
    const w = this.wp[0];
    if (!w) return;
    const tgt = this.toEci(pose, w.p);
    const err = tgt.clone().sub(f.pos);
    const dist = err.length();
    const a = w.final ? 0.3 : 2.6;
    // pass-through waypoints (the swing around the station) are flown through without stopping:
    // brake only for the path left up to the next real stop
    let left = dist;
    if (w.pass) {
      let prev = w.p;
      for (let i = 1; i < this.wp.length; i++) { left += this.wp[i].p.distanceTo(prev); prev = this.wp[i].p; if (!this.wp[i].pass) break; }
    }
    let v = Math.min(w.v, Math.sqrt(2 * a * Math.max(0, left - w.tol * 0.5)), left * (w.final ? 0.8 : 1.0));
    const base = this.frameVel(s, pose, f.pos, new THREE.Vector3());
    const vDes = base.addScaledVector(err.divideScalar(Math.max(dist, 1e-6)), v);
    f.autopilot.vRel.copy(vDes).sub(f.refVelocity(f.pos, new THREE.Vector3()));
    f.autopilot.aff = null;
    f.setSpeed = v;
    // attitude: line up with the station (B-29 docks in the station's own orientation)
    const qErr = pose.quat.clone().multiply(f.quat.clone().invert());
    if (qErr.w < 0) { qErr.x = -qErr.x; qErr.y = -qErr.y; qErr.z = -qErr.z; qErr.w = -qErr.w; }
    const ang = 2 * Math.acos(Math.min(1, qErr.w));
    const ax = V(qErr.x, qErr.y, qErr.z);
    if (ax.lengthSq() > 1e-12) {
      ax.normalize().applyQuaternion(f.quat.clone().invert());
      f.autopilot.wDes.copy(ax).multiplyScalar(Math.min(15 * Math.PI / 180, ang * 0.7));
    } else f.autopilot.wDes.set(0, 0, 0);
    const relV = f.vel.clone().sub(this.frameVel(s, pose, f.pos, new THREE.Vector3())).length();
    if (w.final) {
      this.tFinal += dt;
      if ((dist < w.tol && relV < 0.15 && ang < 0.05) || (dist < 0.6 && this.tFinal > 30)) {
        this.state = 'docked';
        this.wp = [];
        this.hold();
        this.spawn();
        g.audio.impact(V(3.0, 1.2, -1.05), 0.12);
        g.shake = Math.max(g.shake, 0.25);
        g.asphalt.say(s.tether ? 'st_docked_g' : 'st_docked', { name: s.name }, { force: true });
      }
      return;
    }
    // (lined up first: the ship's attitude, and H8's radiators folded away)
    const lined = !w.align || (ang < 0.05 && !(g.h8 && g.h8.docked && g.h8.radFold < 0.92));
    if (dist < w.tol && lined) {
      this.wp.shift();
      if (w.last) {
        this.state = 'free';
        f.autopilot = null;
        f.setSpeed = 0;
        g.asphalt.say('st_undocked', {}, { force: true });
      }
    }
  }

  /** B-29 against station structures */
  collide(dt) {
    const g = this.g, f = g.flight;
    this.lastHit -= dt;
    for (const s of g.stations.list) {
      const P = s.model && s.model.userData.proxies;
      if (!P) continue;
      // (the station's pose at this very step: its drawn position is a frame old)
      const pose = this.stationPose(s, g.time, this._pose || (this._pose = {}));
      if (pose.pos.distanceTo(f.pos) > 600) continue;
      const qInv = pose.quat.clone().invert();
      let worst = null;
      const n = new THREE.Vector3(), pl = new THREE.Vector3();
      // H8 riding on B-29's back is part of the hull here
      const spheres = g.h8 && g.h8.docked ? SHIP_SPHERES.concat(this._h8Sphere || (this._h8Sphere = { c: V(0, 7.85, 0.8), r: 3.7 })) : SHIP_SPHERES;
      for (const sp of spheres) {
        pl.copy(sp.c).applyQuaternion(f.quat).add(f.pos).sub(pose.pos).applyQuaternion(qInv);
        for (const pr of P) {
          const d = proxyDist(pl, pr, n) - sp.r;
          if (d < 0 && (!worst || d < worst.d)) worst = { d, n: n.clone(), sp, pl: pl.clone() };
        }
      }
      if (!worst) continue;
      const nE = worst.n.clone().applyQuaternion(pose.quat);
      // coming in to this station's berth a graze of a few centimetres is taken up by the fenders:
      // eased out, no damage, the approach goes on
      if ((this.state === 'approach' || this.state === 'leaving') && s === this.station && -worst.d < 0.15) {
        f.pos.addScaledVector(nE, -worst.d + 0.01);
        const vRel0 = f.vel.clone().sub(this.frameVel(s, pose, f.pos, new THREE.Vector3()));
        const vn0 = vRel0.dot(nE);
        if (vn0 < 0) f.vel.addScaledVector(nE, -vn0);
        continue;
      }
      f.pos.addScaledVector(nE, -worst.d + 0.02);
      const contactE = worst.pl.clone().addScaledVector(worst.n, -worst.sp.r);
      const contactEci = this.toEci(pose, contactE);
      const vRel = f.vel.clone().sub(this.frameVel(s, pose, contactEci, new THREE.Vector3()));
      const vn = vRel.dot(nE);
      if (vn < 0) {
        f.vel.addScaledVector(nE, -1.3 * vn);
        const vt = vRel.clone().addScaledVector(nE, -vn);
        f.vel.addScaledVector(vt, -0.25);
        f.wRel.multiplyScalar(0.5);
        if (-vn > 0.2 && this.lastHit <= 0) {
          this.lastHit = 0.6;
          const E = 0.5 * SHIP_MASS * vn * vn;
          const pLocal = contactEci.clone().sub(f.pos).applyQuaternion(f.quat.clone().invert());
          const dirLocal = nE.clone().negate().applyQuaternion(f.quat.clone().invert());
          g.damage.impact(pLocal, dirLocal, E * 0.6);
          g.systems.onImpact(E, pLocal);
          g.shake = Math.max(g.shake, Math.min(3, 0.6 + vn * vn * 0.4));
          if (g.autopilot.state !== 'off') g.autopilot.disengage(true);
          if (this.state === 'approach' && s === this.station) this.retry();
          else if (this.state === 'approach') this.abort();
          g.asphalt.say('st_hit', { name: s.name }, { minGap: 8 });
        }
      }
    }
  }

  /** per frame while docked: the station's air and its automatic (pressure) doors */
  updateInterior(dt) {
    if (this.state !== 'docked' || !this.lobby) return;
    const g = this.g, who = g.player.state === 'dead' ? null : g.player.pos;
    const st = this.station.dmg ? this.station.dmg.status : 'ok';
    if (this.air) {
      this.air.update(dt, st, who);
      for (const e of this.air.events.splice(0)) if (e.type === 'recovered') g.asphalt.say('st_air_ok', { sec: this.air.sec[e.sec].name }, { minGap: 20 });
    }
    for (const d of this.lobby.doors || []) d.update(dt, who, g.audio, g.fx);
    if (this.lobby.update) this.lobby.update(dt, g);
    this.emergencyLights(dt, st);
  }

  /** the station's own trouble inside the lobby: failing lights, red emergency lighting, a klaxon */
  emergencyLights(dt, st) {
    const g = this.g;
    const L = this.lamps;
    if (!L.length) return;
    for (const l of L) if (l.base0 === undefined) { l.base0 = l.intensity; l.color0 = new THREE.Color(l.color); }
    this.emT = (this.emT || 0) + dt;
    const t = this.emT;
    const red = new THREE.Color(1, 0.12, 0.06);
    L.forEach((l, i) => {
      let k = 1, col = l.color0;
      // (smooth changes only, and a rare dip: no strobing)
      if (st === 'damaged') k = Math.sin(t * 0.7 + i * 2.3) > 0.996 ? 0.5 : 0.85;
      else if (st === 'critical') {
        // half the lamps are out of power; the emergency lights sweep red
        const sweep = Math.max(0, Math.cos(((t * 0.9 + i * 0.37) % 1) * Math.PI * 2)) ** 6;
        if (i % 2 === 0) { col = red; k = 0.15 + 0.85 * sweep; } else k = Math.sin(t * 0.9 + i * 1.7) > 0.99 ? 0.05 : 0.3;
      } else if (st === 'failed' || st === 'destroyed') { col = red; k = i % 3 === 0 ? 0.22 : 0; }
      l.intensity = l.base0 * k;
      if (typeof l.color === 'number') l.color = col.getHex(); else if (l.color && l.color.copy) l.color.copy(col);
    });
    // the station's klaxon (muffled through the walls)
    const loud = st === 'critical' || st === 'failed';
    if (loud !== !!this.klaxon && g.audio.ready) {
      this.klaxon = loud;
      if (loud) g.audio.humLoop('stKlaxon', { pos: new THREE.Vector3(3.5, 2.4, -2.0), freq: 440, gain: 0.0, harm: [1, 0.5, 0.25, 0.1] });
      else g.audio.stopLoop('stKlaxon');
    }
    if (this.klaxon) {
      const on = (t % 1.4) < 0.7;
      g.audio.setLoopFreq && g.audio.setLoopFreq('stKlaxon', on ? 620 : 470);
      g.audio.setLoopGain('stKlaxon', st === 'critical' ? 0.035 : 0.015, 0.05);
    }
  }

  /** is a ship-local point inside the docked station's walkable space */
  contains(p) { return !!(this.lobby && (this.lobby.contains(p) || (this.inRing && this.ringContainsRender(p)))); }

  /** extra hints for the player's step: the moving handrail band of the transit tube */
  envFor(env, pl) {
    if (!this.lobby || !this.lobby.ring || this.inRing) return;
    const C = this.lobby.ring.terminal.out;
    if (pl.pos.z > 6.5 && pl.pos.z < C.z && Math.hypot(pl.pos.x - C.x, pl.pos.y - (C.y + 0.4)) < 1.35) env.speedK = 3.2;
  }

  /** the station air at a ship-local point inside it */
  airAt(p) { return this.air ? this.air.airAt(p) : { p: 101.3, o2: 21.2, co2: 0.05 }; }

  /** pressure on the far side of B-29's outer hatch while docked (the lobby), else null */
  portPressure() { return this.state === 'docked' && this.air ? this.air.portPressure : null; }
}
