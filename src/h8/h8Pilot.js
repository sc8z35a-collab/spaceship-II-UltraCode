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

/** rates that point the nose (-z) along dir (ECI); gain: rad/s per rad of error */
export function ratesNose(q, dir, maxRate, out = new THREE.Vector3(), gain = 0.35) {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const axisW = new THREE.Vector3().crossVectors(fwd, dir);
  const s = Math.min(1, axisW.length());
  const ang = fwd.dot(dir) < 0 ? Math.PI - Math.asin(s) : Math.asin(s);
  if (axisW.lengthSq() < 1e-10) return out.set(0, 0, 0);
  axisW.normalize().applyQuaternion(q.clone().invert());
  return out.copy(axisW).multiplyScalar(Math.min(maxRate, ang * gain));
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
    if (this.state === 'dock' || this.state === 'undock') { this.steerHost(dt, tNow); return; }
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
    ratesNose(f.quat, want, 48 * Math.PI / 180, f.autopilot.wDes, 1.4);
    f.setSpeed = gd.v;
    this.state = gd.state === 'hold' ? 'hold' : gd.dist < 40000 ? 'approach' : 'transit';
    if (this.state === 'hold' && goal.onArrive) { const cb = goal.onArrive; goal.onArrive = null; cb(); }
  }

  // ---------------------------------------------------------------- docking onto B-29
  startDock() {
    const f = this.v.flight;
    this.state = 'dock';
    const at = H8.dockAt;
    // (more than three times quicker than it used to be: H8 no longer stops at each point on the
    // way in — the path is planned as a whole, braking only in time for the slower stretches
    // ahead — it brakes harder, the fine thrusters run a tight loop, and it swings round to
    // B-29's attitude on the way down). a: the braking allowed on that stretch
    this.dock = {
      wp: [
        { p: new THREE.Vector3(at.x, at.y + 40, at.z), v: 200, a: 45, tol: 6, pass: true },
        { p: new THREE.Vector3(at.x, at.y + 8, at.z), v: 60, a: 28, tol: 1.5, pass: true },
        { p: new THREE.Vector3(at.x, at.y + 0.6, at.z), v: 8, a: 10, tol: 0.15, pass: true },
        { p: at.clone(), v: 1.6, a: 3, tol: 0.05, final: true },
      ],
      t: 0,
      host: { kind: 'b29' },
    };
    // coming in from below or the side: first well clear above B-29's back (the straight line
    // would run through B-29)
    const rel = f.pos.clone().sub(this.v.g.flight.pos).applyQuaternion(this.v.g.flight.quat.clone().invert());
    if (rel.y > at.y + 25 && Math.hypot(rel.x - at.x, rel.z - at.z) < 20) this.dock.wp.shift();
    else if (rel.y < at.y + 10) this.dock.wp.unshift({ p: new THREE.Vector3(rel.x * 0.5, at.y + 45, rel.z * 0.5), v: 200, a: 45, tol: 8, pass: true });
    f.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null, fast: true, tau: 0.3 };
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
      host: { kind: 'b29' },
    };
    f.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null, fast: true };
  }

  // ---------------------------------------------------------------- docking at a station
  /**
   * H8 alone onto a station's H8 port (port: where H8's origin sits once docked, station-local,
   * upright in the station's frame). From wherever it arrives it swings round the station at a
   * safe radius to the top, then comes straight down onto the port — at full pace all the way, the
   * path planned as a whole like the docking onto B-29.
   */
  startDockStation(s, port) {
    const g = this.v.g, f = this.v.flight;
    const R0 = ((s.model && s.model.userData.radius) || 150) + 200;
    const pose = g.docking.stationPose(s, g.time - (this.v.lastDt || 0) * 1000);
    const cur = f.pos.clone().sub(pose.pos).applyQuaternion(pose.quat.clone().invert());
    const Rs = cur.length();
    const from = cur.clone().divideScalar(Math.max(Rs, 1e-6)), to = new THREE.Vector3(0, 1, 0);
    const wp = [];
    const ang = from.angleTo(to);
    if (ang > 0.15) {
      const steps = Math.max(1, Math.ceil(ang / (30 * Math.PI / 180)));
      const qa = new THREE.Quaternion().setFromUnitVectors(from, to);
      for (let k = 1; k <= steps; k++) {
        const q = new THREE.Quaternion().slerp(qa, k / steps);
        wp.push({ p: from.clone().applyQuaternion(q).multiplyScalar(Math.max(R0, Rs + (R0 - Rs) * (k / steps))), v: 300, a: 45, tol: 30, pass: true });
      }
    }
    const top = Math.max(port.y + 60, R0 * 0.6);
    wp.push({ p: new THREE.Vector3(port.x, top, port.z), v: 250, a: 45, tol: 8, pass: true });
    wp.push({ p: new THREE.Vector3(port.x, port.y + 8, port.z), v: 50, a: 28, tol: 1.5, pass: true });
    wp.push({ p: new THREE.Vector3(port.x, port.y + 0.6, port.z), v: 8, a: 10, tol: 0.15, pass: true });
    wp.push({ p: port.clone(), v: 1.6, a: 3, tol: 0.05, final: true });
    this.state = 'dock';
    this.dock = { wp, t: 0, host: { kind: 'station', s } };
    f.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null, fast: true, tau: 0.3 };
  }

  /** off a station's port: straight up, then hand over */
  startUndockStation(s, port, after) {
    const f = this.v.flight;
    this.state = 'undock';
    this.after = after;
    this.dock = {
      wp: [
        { p: new THREE.Vector3(port.x, port.y + 2.5, port.z), v: 0.8, tol: 0.25 },
        { p: new THREE.Vector3(port.x, port.y + 40, port.z), v: 8, tol: 2, last: true },
      ],
      t: 0,
      host: { kind: 'station', s },
    };
    f.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null, fast: true };
  }

  /**
   * the frame H8 docks in: B-29's, or a station's, at time t (the time H8's own state belongs to:
   * an orbiting station moves 770 m in a tenth of a second)
   */
  hostPose(host, t = this.v.g.time) {
    const g = this.v.g, H = this._host || (this._host = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), pose: {} });
    H.s = host && host.kind === 'station' ? host.s : null;
    if (!H.s) { const fb = g.flight; H.pos.copy(fb.pos); H.vel.copy(fb.vel); H.quat.copy(fb.quat); return H; }
    const pose = g.docking.stationPose(H.s, t, H.pose);
    H.pos.copy(pose.pos); H.vel.copy(pose.vel); H.quat.copy(pose.quat);
    return H;
  }

  hostVelAt(H, p, out) { return H.s ? this.v.g.docking.frameVel(H.s, H.pose, p, out) : out.copy(H.vel); }

  /** proximity operations in the host's frame (B-29 or a station): fly the waypoint list, matching
   * the host's attitude */
  steerHost(dt, tNow) {
    const f = this.v.flight;
    const d = this.dock;
    const w = d && d.wp[0];
    if (!w) return;
    const fb = this.hostPose(d.host, tNow);
    if (!f.autopilot) f.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3(), aff: null, fast: true };
    f.autopilot.tau = 0.3;
    d.t += dt;
    // B-29's port in ECI (B-29 keeps flying: aim at where it is now, with its velocity)
    const tgt = w.p.clone().applyQuaternion(fb.quat).add(fb.pos);
    const err = tgt.clone().sub(f.pos);
    const dist = err.length();
    this.dist = dist;
    // the speed: this stretch's limit, and in time for every slower stretch and the stop ahead.
    // (The thrust follows a command with a short lag: the distances are taken as they will be a
    // moment from now, or it would brake late and swing past the corner / onto the latches.)
    const a = w.a || (w.final ? 0.8 : 4.0);
    const dirE = err.clone().divideScalar(Math.max(dist, 1e-6));
    const closing = Math.max(0, f.vel.clone().sub(this.hostVelAt(fb, f.pos, new THREE.Vector3())).dot(dirE));
    const lag = closing * 0.4;
    let v = w.v;
    if (w.pass) {
      // round a sharp corner at this point slowly enough not to swing wide of it
      const n1 = d.wp[1];
      if (n1) {
        const inDir = err.clone().normalize();
        const outDir = n1.p.clone().sub(w.p).applyQuaternion(fb.quat).normalize();
        const turn = Math.acos(Math.max(-1, Math.min(1, inDir.dot(outDir))));
        if (turn > 0.3) v = Math.min(v, Math.sqrt(400 + 2 * a * Math.max(0, dist - w.tol - lag)));
      }
      let along = Math.max(0, dist - lag), prev = w.p;
      for (let i = 1; i < d.wp.length; i++) {
        const n = d.wp[i], seg = n.p.distanceTo(prev);
        // the fastest that stretch can be entered: its own limit, or still stopping at its end
        const vin = n.pass ? n.v : Math.min(n.v, Math.sqrt(2 * (n.a || a) * Math.max(0, seg - n.tol * 0.4)));
        v = Math.min(v, Math.sqrt(vin * vin + 2 * a * along));
        if (!n.pass) break;
        along += seg; prev = n.p;
      }
    } else if (w.final) {
      // the last few decimetres at a steady creep (no slow exponential tail) onto the latches
      v = Math.min(v, Math.max(0.1, Math.min(Math.sqrt(2 * a * Math.max(0, dist - 0.02 - lag)), dist * 3)));
    } else v = Math.min(v, Math.sqrt(2 * a * Math.max(0, dist - w.tol * 0.4 - lag)), dist * 2.2);
    const vDes = this.hostVelAt(fb, f.pos, new THREE.Vector3()).addScaledVector(dirE, v);
    f.autopilot.vRel.copy(vDes).sub(f.refVelocity(f.pos, new THREE.Vector3()));
    f.autopilot.aff = null;
    f.autopilot.fast = true;
    f.setSpeed = v;
    // attitude: B-29's own (H8 sits on its back in the same orientation)
    const r = ratesToward(f.quat, fb.quat, 45 * Math.PI / 180, 2.4, f.autopilot.wDes);
    const relV = f.vel.clone().sub(this.hostVelAt(fb, f.pos, new THREE.Vector3())).length();
    if (w.final) {
      // (soft capture: the latches take up a closing speed of up to 15 cm/s)
      if ((dist < w.tol && relV < 0.15 && r.ang < 0.04) || (dist < 0.25 && d.t > 8)) {
        d.wp.length = 0;
        this.state = 'idle';
        if (d.host && d.host.kind === 'station') this.v.berth(d.host.s);
        else this.v.latch();
      }
      return;
    }
    if (dist < w.tol && (w.pass || w.v > 5 || r.ang < 0.12 || this.state === 'undock')) {
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
