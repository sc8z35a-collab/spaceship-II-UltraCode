// HACHI — H8's pilot AI. It flies H8 with all the drive H8 has: the long legs with the same
// planet-aware guidance B-29's autopilot uses (around the Earth in the target's plane, never
// through it; elevator stations in the Earth-turning frame; descend first to a low target, climb
// out to a high one) but with H8's speed and braking; on top of that it looks ahead: rocks on a
// closing course are side-stepped well before they arrive, stations that are not the destination
// are given a wide berth, and a moving target (B-29) is met where it will be. At the end it flies
// the docking itself: down the corridor above B-29's back, attitude matched, onto the dorsal port
// to the centimetre.
import * as THREE from 'three';
import { MU_EARTH, R_EARTH, OMEGA_EARTH } from '../core/astro.js';
import { H8 } from './h8Spec.js';

const V = () => new THREE.Vector3();

/**
 * Long-range guidance toward a target { pos, vel, tether, kind } for flight f.
 * Returns { vRel (relative to f's reference field), moveDir, v, state, eta }.
 */
export function guidance(f, s, { vmax, a, standoff }) {
  const rel = s.pos.clone().sub(f.pos);
  const dist = rel.length();
  const dir = rel.clone().divideScalar(Math.max(dist, 1e-6));
  const vRefHere = f.refVelocity(f.pos, V());
  const rShip = f.pos.length(), rTgt = s.pos.length();
  const tc = -f.pos.dot(rel) / Math.max(1, rel.lengthSq());
  const blocked = tc > 0 && f.pos.clone().addScaledVector(rel, Math.min(1, tc)).length() < R_EARTH + 3.0e5;
  const out = { vRel: V(), moveDir: dir.clone(), v: 0, state: 'cruise', eta: 0, dist };
  if (dist < 40000) {
    const v = Math.min(vmax, Math.sqrt(Math.max(0, 2 * a * (dist - standoff))));
    out.v = dist < standoff + 3 ? 0 : v;
    out.state = dist < standoff + 3 ? 'hold' : 'approach';
    out.vRel.copy(s.vel).addScaledVector(dir, out.v).sub(vRefHere);
    out.eta = out.v > 0.5 ? (dist - standoff) / Math.max(out.v, 1) : 0;
    return out;
  }
  if (s.tether && rShip < rTgt * 1.5 + 2.0e6) {
    const up = f.pos.clone().divideScalar(rShip);
    const tdir = s.pos.clone().divideScalar(rTgt);
    const hdir = tdir.clone().addScaledVector(up, -tdir.dot(up));
    if (hdir.lengthSq() < 1e-12) hdir.set(0, 0, 0); else hdir.normalize();
    const arc = Math.acos(Math.max(-1, Math.min(1, up.dot(tdir)))) * rShip;
    const dr = rTgt - rShip;
    const len = Math.max(1, Math.hypot(arc, dr));
    const v = Math.min(vmax, Math.sqrt(2 * a * Math.max(0, len - standoff)) + 5);
    const base = new THREE.Vector3(OMEGA_EARTH * f.pos.z, 0, -OMEGA_EARTH * f.pos.x);
    const close = hdir.multiplyScalar(v * arc / len).addScaledVector(up, v * dr / len);
    out.vRel.copy(base).add(close).sub(vRefHere);
    out.moveDir = close.clone().normalize();
    out.v = v; out.eta = len / Math.max(v, 1);
    return out;
  }
  if (!s.tether && rTgt > 3 * R_EARTH) {
    const v = Math.min(vmax, Math.sqrt(2 * a * Math.max(0, dist - standoff)) + 5);
    const u = s.vel.clone().addScaledVector(dir, v);
    const tu = Math.min(dist / Math.max(v, 1), -f.pos.dot(u) / Math.max(1, u.lengthSq()));
    const dips = tu > 0 && f.pos.clone().addScaledVector(u, tu).length() < R_EARTH + 1.5e6;
    const climb = rShip < 2.5 * R_EARTH || dips || blocked;
    out.moveDir = climb ? f.pos.clone().normalize() : dir;
    if (climb) out.vRel.copy(out.moveDir).multiplyScalar(v);
    else out.vRel.copy(u).sub(vRefHere);
    out.v = v; out.eta = dist / Math.max(v, 1) + (climb ? 600 : 0);
    return out;
  }
  if (rShip > rTgt * 1.5 + 2.0e6) {
    out.moveDir = f.pos.clone().normalize().negate();
    const v = Math.min(vmax, Math.sqrt(2 * a * (rShip - rTgt)) + 5);
    out.vRel.copy(out.moveDir).multiplyScalar(v);
    out.v = v; out.eta = (rShip - rTgt) / Math.max(v, 1) + 1800;
    return out;
  }
  // comparable heights: round the planet in the target's plane, riding at its angular rate
  const hT = new THREE.Vector3().crossVectors(s.pos, s.vel);
  if (hT.lengthSq() < 1e-6) hT.crossVectors(s.pos, f.vel);
  hT.normalize();
  const z = f.pos.dot(hT);
  const pp = f.pos.clone().addScaledVector(hT, -z);
  const rp = Math.max(1, pp.length());
  const erp = pp.divideScalar(rp);
  const et = new THREE.Vector3().crossVectors(hT, erp).normalize();
  const er = f.pos.clone().divideScalar(rShip);
  const tp = s.pos.clone().divideScalar(rTgt);
  const dphi = Math.atan2(tp.dot(et), tp.dot(erp));
  const nT = Math.sqrt(MU_EARTH / (rTgt * rTgt * rTgt));
  const arc = rp * dphi, dr = rTgt - rShip, dz = -z;
  const len = Math.max(1, Math.hypot(arc, dr, dz));
  const v = Math.min(vmax, Math.sqrt(2 * a * Math.max(0, len - standoff)) + 5);
  const close = et.clone().multiplyScalar(v * arc / len).addScaledVector(er, v * dr / len).addScaledVector(hT, v * dz / len);
  const ride = et.clone().multiplyScalar(rp * nT).sub(vRefHere);
  const rideMax = Math.max(2500, 3 * vmax);
  if (ride.length() > rideMax) ride.setLength(rideMax);
  out.vRel.copy(close).add(ride);
  out.moveDir = close.clone().divideScalar(Math.max(v, 1e-6));
  out.v = v; out.eta = len / Math.max(v, 1);
  return out;
}

/** body rates (ship axes) that turn the attitude q toward qT (both ECI), capped */
export function ratesToward(q, qT, maxRate, gain = 0.7, out = new THREE.Vector3()) {
  const qErr = qT.clone().multiply(q.clone().invert());
  if (qErr.w < 0) { qErr.x = -qErr.x; qErr.y = -qErr.y; qErr.z = -qErr.z; qErr.w = -qErr.w; }
  const ang = 2 * Math.acos(Math.min(1, qErr.w));
  const ax = new THREE.Vector3(qErr.x, qErr.y, qErr.z);
  if (ax.lengthSq() < 1e-12) return { w: out.set(0, 0, 0), ang };
  ax.normalize().applyQuaternion(q.clone().invert());
  return { w: out.copy(ax).multiplyScalar(Math.min(maxRate, ang * gain)), ang };
}

/** rates that point the nose (-z) along dir (ECI) */
export function ratesNose(q, dir, maxRate, out = new THREE.Vector3()) {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const axisW = new THREE.Vector3().crossVectors(fwd, dir);
  const s = Math.min(1, axisW.length());
  const ang = fwd.dot(dir) < 0 ? Math.PI - Math.asin(s) : Math.asin(s);
  if (axisW.lengthSq() < 1e-10) return out.set(0, 0, 0);
  axisW.normalize().applyQuaternion(q.clone().invert());
  return out.copy(axisW).multiplyScalar(Math.min(maxRate, ang * 0.35));
}

export class HachiPilot {
  constructor(vessel) {
    this.v = vessel;
    this.goal = null;          // { kind, name, posOf(t, pos, vel), standoff, onArrive }
    this.state = 'idle';       // idle | transit | approach | hold | dock
    this.dock = null;          // proximity-ops state
    this.dodge = new THREE.Vector3();
    this.dodgeT = 0;
    this.eta = 0;
    this.dist = 0;
    this.notes = [];           // what HACHI is doing right now (for the displays)
    this._tgt = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), tether: false };
  }

  setGoal(goal) {
    this.goal = goal;
    this.state = goal ? 'transit' : 'idle';
    this.dock = null;
    const f = this.v.flight;
    if (goal) f.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null, fast: true };
    else f.autopilot = null;
  }

  /** look ahead along the planned velocity for rocks and stations; returns a lateral velocity */
  avoidance(vDesEci) {
    const g = this.v.g, f = this.v.flight;
    const out = new THREE.Vector3();
    const notes = [];
    // rocks (they are aimed at B-29, but H8 may be on the way)
    for (const a of g.asteroids.list) {
      if (a.hit || a.dead) continue;
      const rel = a.pos.clone().sub(f.pos);
      const vr = a.vel.clone().sub(vDesEci);
      const tca = -rel.dot(vr) / Math.max(1e-6, vr.lengthSq());
      if (tca < 0 || tca > 90) continue;
      const miss = rel.clone().addScaledVector(vr, tca);
      const m = miss.length();
      const safe = 220 + a.radius * 40;
      if (m < safe) {
        // step out of the rock's path: away from the closest-approach point, across its motion
        const side = miss.lengthSq() > 1e-6 ? miss.clone().negate().normalize() : new THREE.Vector3().randomDirection().projectOnPlane(vr).normalize();
        out.addScaledVector(side, Math.min(60, (safe - m) / Math.max(4, tca) * 1.6));
        notes.push({ kind: 'rock', dist: rel.length() });
      }
    }
    // stations that are not the destination: keep 250 m off their centres
    for (const s of g.stations.list) {
      if (this.goal && this.goal.station === s) continue;
      const rel = s.pos.clone().sub(f.pos);
      const vr = s.vel.clone().sub(vDesEci);
      const tca = -rel.dot(vr) / Math.max(1e-6, vr.lengthSq());
      if (tca < 0 || tca > 120) continue;
      const miss = rel.clone().addScaledVector(vr, tca);
      const R = (s.model && s.model.userData.radius) || 150;
      const safe = R + 250;
      if (miss.length() < safe) {
        const side = miss.lengthSq() > 1e-6 ? miss.clone().negate().normalize() : f.pos.clone().normalize();
        out.addScaledVector(side, Math.min(120, (safe - miss.length()) / Math.max(5, tca) * 1.4));
        notes.push({ kind: 'station', name: s.name });
      }
    }
    this.notes = notes;
    return out;
  }

  update(dt, tNow) {
    const f = this.v.flight;
    if (this.state === 'dock' || this.state === 'undock') { this.steerB29(dt); return; }
    if (!this.goal || !f.autopilot) return;
    const goal = this.goal;
    goal.posOf(tNow, this._tgt.pos, this._tgt.vel);
    this._tgt.tether = !!goal.tether;
    const vmax = this.v.maxSpeed();
    const a = this.v.brakeAccel();
    const gd = guidance(f, this._tgt, { vmax, a, standoff: goal.standoff || 120 });
    this.eta = gd.eta; this.dist = gd.dist;
    // meet a moving target where it will be: lead by the closing time (close in only)
    const vRef = f.refVelocity(f.pos, new THREE.Vector3());
    const vDes = gd.vRel.clone().add(vRef);
    const av = this.avoidance(vDes);
    if (av.lengthSq() > 0.01) { this.dodge.lerp(av, Math.min(1, dt * 2)); this.dodgeT = 3; }
    else if (this.dodgeT > 0) { this.dodgeT -= dt; this.dodge.multiplyScalar(Math.exp(-dt * 0.8)); }
    else this.dodge.set(0, 0, 0);
    f.autopilot.vRel.copy(gd.vRel).add(this.dodge);
    f.autopilot.aff = null;
    f.autopilot.fast = true;
    // attitude: nose along the way (or the target when holding)
    const want = gd.v > 2 ? gd.moveDir.clone().add(this.dodge.clone().multiplyScalar(0.02)).normalize() : this._tgt.pos.clone().sub(f.pos).normalize();
    ratesNose(f.quat, want, 12 * Math.PI / 180, f.autopilot.wDes);
    f.setSpeed = gd.v;
    this.state = gd.state === 'hold' ? 'hold' : gd.dist < 40000 ? 'approach' : 'transit';
    if (this.state === 'hold' && goal.onArrive) { const cb = goal.onArrive; goal.onArrive = null; cb(); }
  }

  // ---------------------------------------------------------------- docking onto B-29
  startDock() {
    const f = this.v.flight;
    this.state = 'dock';
    const at = H8.dockAt;
    this.dock = {
      wp: [
        { p: new THREE.Vector3(at.x, at.y + 60, at.z), v: 35, tol: 4 },
        { p: new THREE.Vector3(at.x, at.y + 16, at.z), v: 10, tol: 0.8 },
        { p: new THREE.Vector3(at.x, at.y + 1.2, at.z), v: 1.6, tol: 0.08 },
        { p: at.clone(), v: 0.35, tol: 0.03, final: true },
      ],
      t: 0,
    };
    // the first waypoint is skipped when H8 already comes in from above
    const rel = f.pos.clone().sub(this.v.g.flight.pos).applyQuaternion(this.v.g.flight.quat.clone().invert());
    if (rel.y > at.y + 30 && Math.hypot(rel.x - at.x, rel.z - at.z) < 25) this.dock.wp.shift();
    f.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null, fast: true };
  }

  /** back off B-29's port, straight up, then hand over */
  startUndock(after) {
    const f = this.v.flight;
    const at = H8.dockAt;
    this.state = 'undock';
    this.after = after;
    this.dock = {
      wp: [
        { p: new THREE.Vector3(at.x, at.y + 2.5, at.z), v: 0.6, tol: 0.25 },
        { p: new THREE.Vector3(at.x, at.y + 30, at.z), v: 4, tol: 2, last: true },
      ],
      t: 0,
    };
    f.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null, fast: true };
  }

  /** proximity operations in B-29's frame: fly the waypoint list, matching B-29's attitude */
  steerB29(dt) {
    const g = this.v.g, f = this.v.flight, fb = g.flight;
    const d = this.dock;
    const w = d && d.wp[0];
    if (!w) return;
    if (!f.autopilot) f.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null, fast: true };
    d.t += dt;
    // B-29's port in ECI (B-29 keeps flying: aim at where it is now, with its velocity)
    const tgt = w.p.clone().applyQuaternion(fb.quat).add(fb.pos);
    const err = tgt.clone().sub(f.pos);
    const dist = err.length();
    this.dist = dist;
    const a = w.final ? 0.25 : 4.0;
    const v = Math.min(w.v, Math.sqrt(2 * a * Math.max(0, dist - w.tol * 0.4)), dist * (w.final ? 0.9 : 1.2));
    const vDes = fb.vel.clone().addScaledVector(err.divideScalar(Math.max(dist, 1e-6)), v);
    f.autopilot.vRel.copy(vDes).sub(f.refVelocity(f.pos, new THREE.Vector3()));
    f.autopilot.aff = null;
    f.autopilot.fast = true;
    f.setSpeed = v;
    // attitude: B-29's own (H8 sits on its back in the same orientation)
    const r = ratesToward(f.quat, fb.quat, 15 * Math.PI / 180, 0.8, f.autopilot.wDes);
    const relV = f.vel.clone().sub(fb.vel).length();
    if (w.final) {
      if ((dist < w.tol && relV < 0.08 && r.ang < 0.03) || (dist < 0.25 && d.t > 25)) {
        d.wp.length = 0;
        this.state = 'idle';
        this.v.latch();
      }
      return;
    }
    if (dist < w.tol && (w.v > 5 || r.ang < 0.12 || this.state === 'undock')) {
      d.wp.shift(); d.t = 0;
      if (w.last) {
        this.state = 'idle';
        f.autopilot = null;
        f.setSpeed = 0;
        this.v.afterUndock(this.after);
      }
    }
  }
}
