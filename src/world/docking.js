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

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const SHIP_MASS = 42000;
// hull spheres (ship-local): body, nose, tail, reactor, engine, radiators
const SHIP_SPHERES = [
  [0, 0.4, -10.8, 2.3], [0, 0.4, -7.2, 2.95], [0, 0.4, -3.2, 3.0], [0, 0.4, 0.8, 3.0], [0, 0.4, 4.6, 2.9], [0, 0.4, 8.2, 2.3],
  [0, 0.4, 12.0, 1.7], [0, 0.4, 15.4, 1.6], [0, 0.4, 17.6, 1.3],
  [3.1, 0.4, 13.1, 1.7], [5.4, 0.4, 13.1, 1.7], [7.6, 0.4, 13.1, 1.7], [-3.1, 0.4, 13.1, 1.7], [-5.4, 0.4, 13.1, 1.7], [-7.6, 0.4, 13.1, 1.7],
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
  }

  get docked() { return this.state === 'docked'; }

  /** hub station close enough to start a docking */
  candidate() {
    const g = this.g, ap = g.autopilot;
    const open = (s) => !s.dmg || (s.dmg.status !== 'failed' && s.dmg.status !== 'destroyed');
    if (ap.state === 'hold' && ap.target && ap.target.kind === 'hub' && ap.dist < 3000 && open(ap.target)) return ap.target;
    let best = null;
    for (const s of g.stations.list) if (s.kind === 'hub' && open(s) && s.dist < 2000 && (!best || s.dist < best.dist)) best = s;
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
    const R0 = Math.max(280, cur.length());
    const from = cur.clone().normalize(), to = V(-1, 0, 0);
    const qa = new THREE.Quaternion().setFromUnitVectors(from, to);
    const steps = Math.max(1, Math.ceil(from.angleTo(to) / (25 * Math.PI / 180)));
    this.wp = [];
    for (let k = 1; k <= steps; k++) {
      const q = new THREE.Quaternion().slerp(qa, k / steps);
      this.wp.push({ p: from.clone().applyQuaternion(q).multiplyScalar(R0), v: 25, tol: 10 });
    }
    this.wp.push({ p: V(-R0, DOCK_AT.y, DOCK_AT.z), v: 20, tol: 6 });
    this.wp.push({ p: V(DOCK_AT.x - 28, DOCK_AT.y, DOCK_AT.z), v: 10, tol: 1.5 });
    this.wp.push({ p: V(DOCK_AT.x - 6, DOCK_AT.y, DOCK_AT.z), v: 1.5, tol: 0.4 });
    this.wp.push({ p: DOCK_AT.clone(), v: 0.35, tol: 0.06, final: true });
    // the autopilot hands over
    const ap = g.autopilot;
    ap.state = 'off'; ap.target = null;
    g.flight.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null };
    this.state = 'approach';
    this.tFinal = 0;
    g.asphalt.say('st_dock_start', { name: s.name }, { force: true });
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
    this.wp = [{ p: V(DOCK_AT.x - 8, DOCK_AT.y, DOCK_AT.z), v: 0.8, tol: 0.5 }, { p: V(DOCK_AT.x - 90, DOCK_AT.y, DOCK_AT.z), v: 8, tol: 3, last: true }];
    g.flight.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null };
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
      lobby = buildLobby(g.engine.renderer, s);
      if (g.earth && g.earth.color) setGlobeTexture(lobby, g.earth.color);
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
  }

  despawn() {
    const g = this.g;
    if (!this.lobby) return;
    g.shipVis.root.remove(this.lobby.group);
    if (this.cols) for (const c of this.cols) g.phys.world.removeCollider(c, true);
    this.cols = null;
    for (const d of this.lobby.doors || []) d.detach(g.phys);
    g.systems.lamps = g.systems.lamps.filter((l) => !this.lamps.includes(l));
    for (const slot of g.systems.pool) if (slot.lamp && this.lamps.includes(slot.lamp)) { slot.lamp = null; slot.out = false; slot.light.intensity = 0; }
    this.lamps = [];
    this.lobby = null;
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
    if (this.lobby) this.lobby.globe.rotation.y += 0.0015;
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
    if (!f.autopilot) f.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null };
    // the clock already moved on by dt; the ship's state still belongs to the start of the step
    // (an orbiting station travels ~770 m in 0.1 s)
    const pose = this.stationPose(s, g.time - dt * 1000);
    const w = this.wp[0];
    if (!w) return;
    const tgt = this.toEci(pose, w.p);
    const err = tgt.clone().sub(f.pos);
    const dist = err.length();
    const a = w.final ? 0.04 : 0.3;
    let v = Math.min(w.v, Math.sqrt(2 * a * Math.max(0, dist - w.tol * 0.5)), dist * (w.final ? 0.35 : 0.5));
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
      f.autopilot.wDes.copy(ax).multiplyScalar(Math.min(5 * Math.PI / 180, ang * 0.35));
    } else f.autopilot.wDes.set(0, 0, 0);
    const relV = f.vel.clone().sub(this.frameVel(s, pose, f.pos, new THREE.Vector3())).length();
    if (w.final) {
      this.tFinal += dt;
      if ((dist < w.tol && relV < 0.12 && ang < 0.03) || (dist < 0.6 && this.tFinal > 90)) {
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
    if (dist < w.tol) {
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
      if (!P || !(s.dist < 600)) continue;
      const pose = this.stationPose(s, g.time, this._pose || (this._pose = {}));
      const qInv = pose.quat.clone().invert();
      let worst = null;
      const n = new THREE.Vector3(), pl = new THREE.Vector3();
      for (const sp of SHIP_SPHERES) {
        pl.copy(sp.c).applyQuaternion(f.quat).add(f.pos).sub(pose.pos).applyQuaternion(qInv);
        for (const pr of P) {
          const d = proxyDist(pl, pr, n) - sp.r;
          if (d < 0 && (!worst || d < worst.d)) worst = { d, n: n.clone(), sp, pl: pl.clone() };
        }
      }
      if (!worst) continue;
      const nE = worst.n.clone().applyQuaternion(pose.quat);
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
          if (this.state === 'approach') this.abort();
          g.asphalt.say('st_hit', { name: s.name }, { minGap: 8 });
        }
      }
    }
  }

  /** per frame while docked: the station's automatic doors */
  updateInterior(dt) {
    if (this.state !== 'docked' || !this.lobby) return;
    const g = this.g;
    for (const d of this.lobby.doors || []) d.update(dt, g.player.state === 'dead' ? null : g.player.pos, g.audio);
  }

  /** is a ship-local point inside the docked station's walkable space */
  contains(p) { return !!(this.lobby && this.lobby.contains(p)); }
}
