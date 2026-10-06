// Autopilot: flies B-29 to a station (works with ULTRA), slews the nose toward the target,
// decelerates for arrival and then holds station; the repair dock can be docked with.
import * as THREE from 'three';
import { MU_EARTH, R_EARTH, OMEGA_EARTH } from '../core/astro.js';

export class Autopilot {
  constructor(game) {
    this.g = game;
    this.target = null;
    this.state = 'off';   // off | cruise | approach | hold | docked
    this.eta = 0;
    this.dist = 0;
  }

  engage(stationId) {
    const s = stationId === 'h8' && this.g.h8 ? this.g.h8.navTarget() : this.g.stations.byId(stationId);
    if (!s) return false;
    if (this.g.docking && this.g.docking.state !== 'free') { this.g.asphalt && this.g.asphalt.say('st_docked_ap', {}, { force: true }); return false; }
    if (this.g.systems.serversHealth !== undefined && this.g.systems.serversHealth < 0.25) { this.g.asphalt && this.g.asphalt.say('autopilot_fail'); return false; }
    this.target = s;
    this.state = 'cruise';
    this.g.flight.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3() };
    const A = this.g.asphalt;
    const st = s.dmg ? s.dmg.status : 'ok';
    if (A) {
      if (st === 'destroyed') A.say('ap_wreck', { name: s.name }, { force: true });
      else if (st === 'failed') A.say('ap_dark', { name: s.name }, { force: true });
      else A.say('autopilot_on', { name: s.name });
    }
    return true;
  }

  disengage(silent) {
    if (this.state === 'off') return;
    this.state = 'off';
    this.target = null;
    this.g.flight.autopilot = null;
    this.g.flight.setSpeed = 0;
    if (!silent && this.g.asphalt) this.g.asphalt.say('autopilot_off');
  }

  /** dt: step about to be flown; tShip: the clock time the ship's current state belongs to */
  update(dt, tShip = this.g.time - dt * 1000) {
    const f = this.g.flight;
    if (this.state === 'off' || !this.target) return;
    if (!f.autopilot) { this.state = 'off'; this.target = null; return; }
    if (f.landed) { this.disengage(true); return; }
    const s = this.target;
    // keep the target's orbit current with the simulation clock (also while time is accelerated)
    if (s.posOf) s.posOf(tShip, s.pos, s.vel); else this.g.stations.posOf(s, tShip, s.pos, s.vel);
    const rel = s.pos.clone().sub(f.pos);
    const dist = rel.length();
    this.dist = dist;
    const dir = rel.clone().divideScalar(Math.max(dist, 1e-6));
    const vmax = Math.min(f.ultra ? f.vUltra : f.vNormal, f.speedLimit);
    // (a wreck is surrounded by a field of flying debris: hold well clear of it)
    const standoff = s.dmg && s.dmg.destroyed ? 1800 : s.standoff || (s.kind === 'dock' ? 120 : 320);
    // braking profile (the ULTRA drive can shed speed much faster; with H8 pushing, faster still)
    const a = (f.ultra ? 2.2 : 0.55) * Math.min(8, f.mul) * (f.ultra ? f.aK : 1);
    const vRefHere = f.refVelocity(f.pos, new THREE.Vector3());
    let v, moveDir;
    const rShip = f.pos.length(), rTgt = s.pos.length();
    // the straight line to the target: does it pass through (or skim) the planet?
    const tc = -f.pos.dot(rel) / Math.max(1, rel.lengthSq());
    const blocked = tc > 0 && f.pos.clone().addScaledVector(rel, Math.min(1, tc)).length() < R_EARTH + 3.0e5;
    if (dist < 40000) {
      // close in: match the target's real motion and close straight in
      v = Math.min(vmax, Math.sqrt(Math.max(0, 2 * a * (dist - standoff))));
      if (this.state === 'hold' && dist < standoff + 300) v = 0;            // keep station (hysteresis)
      else if (dist < standoff + 5) { v = 0; this.state = 'hold'; this.g.asphalt && this.g.asphalt.say('arrived', { name: s.name }); this.g.systems.emit('arrived', s); }
      else this.state = 'approach';
      f.autopilot.vRel.copy(s.vel).addScaledVector(dir, v).sub(vRefHere);
      moveDir = dir;
      this.eta = v > 0.5 ? (dist - standoff) / Math.max(v, 1) : 0;
    } else if (s.tether && rShip < rTgt * 1.5 + 2.0e6) {
      // stations on the space elevator turn with the Earth: fly the great circle in the
      // Earth-turning frame (the orbital speed is shed on the way). The climb / descent to the
      // station's height (Amaterasu sits at GEO) shares the speed budget: a straight line in
      // (ground track, radius), so the path never dips below the lower of the two heights
      this.state = 'cruise';
      const up = f.pos.clone().divideScalar(rShip);
      const tdir = s.pos.clone().divideScalar(rTgt);
      const hdir = tdir.clone().addScaledVector(up, -tdir.dot(up));
      if (hdir.lengthSq() < 1e-12) hdir.set(0, 0, 0); else hdir.normalize();
      const arc = Math.acos(Math.max(-1, Math.min(1, up.dot(tdir)))) * rShip;
      const dr = rTgt - rShip;
      const len = Math.max(1, Math.hypot(arc, dr));
      v = Math.min(vmax, Math.sqrt(2 * a * Math.max(0, len - standoff)) + 5);
      const base = new THREE.Vector3(OMEGA_EARTH * f.pos.z, 0, -OMEGA_EARTH * f.pos.x);
      const close = hdir.multiplyScalar(v * arc / len).addScaledVector(up, v * dr / len);
      f.autopilot.vRel.copy(base).add(close).sub(vRefHere);
      moveDir = close.clone().normalize();
      this.eta = len / Math.max(v, 1);
    } else if (!s.tether && rTgt > 3 * R_EARTH) {
      // a high target (the dock out at the Moon's distance): fly straight at it while matching
      // its motion. From low down, climb out first (in the local orbit), and keep climbing
      // while the course we would fly — the target's motion plus the approach — would bring
      // the planet close before we get there
      this.state = 'cruise';
      v = Math.min(vmax, Math.sqrt(2 * a * Math.max(0, dist - standoff)) + 5);
      const u = s.vel.clone().addScaledVector(dir, v);
      const tu = Math.min(dist / Math.max(v, 1), -f.pos.dot(u) / Math.max(1, u.lengthSq()));
      const dips = tu > 0 && f.pos.clone().addScaledVector(u, tu).length() < R_EARTH + 1.5e6;
      const climb = rShip < 2.5 * R_EARTH || dips || blocked;
      moveDir = climb ? f.pos.clone().normalize() : dir;
      if (climb) f.autopilot.vRel.copy(moveDir).multiplyScalar(v);
      else f.autopilot.vRel.copy(u).sub(vRefHere);
      this.eta = dist / Math.max(v, 1) + (climb ? 1800 : 0);
    } else if (rShip > rTgt * 1.5 + 2.0e6) {
      // far above a low target: descend first — down there the orbit is short and the phase
      // gap is closed cheaply (an elevator station is then reached on the Earth-turning leg)
      this.state = 'cruise';
      moveDir = f.pos.clone().normalize().negate();
      v = Math.min(vmax, Math.sqrt(2 * a * (rShip - rTgt)) + 5);
      f.autopilot.vRel.copy(moveDir).multiplyScalar(v);
      this.eta = (rShip - rTgt) / Math.max(v, 1) + 3 * 3600;
    } else {
      // comparable heights: travel around the planet (never through it) in the target's own
      // orbital plane — the phase gap, the climb / descent and the way back into that plane
      // share the speed budget (a straight line in (phase, radius, plane), never below the
      // lower of the two radii), riding at the target's angular rate so the gap does not drift
      // (the ride is capped: it is held against the local orbit)
      this.state = 'cruise';
      const hT = new THREE.Vector3().crossVectors(s.pos, s.vel).normalize();
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
      v = Math.min(vmax, Math.sqrt(2 * a * Math.max(0, len - standoff)) + 5);
      const close = et.clone().multiplyScalar(v * arc / len).addScaledVector(er, v * dr / len).addScaledVector(hT, v * dz / len);
      // inertial velocity that keeps the phase with the target, relative to the local field
      const ride = et.clone().multiplyScalar(rp * nT).sub(vRefHere);
      const rideMax = Math.max(2500, 3 * vmax);
      if (ride.length() > rideMax) ride.setLength(rideMax);
      f.autopilot.vRel.copy(close).add(ride);
      moveDir = close.clone().divideScalar(Math.max(v, 1e-6));
      this.eta = len / Math.max(v, 1);
    }
    f.autopilot.aff = null;
    // attitude: nose along the direction of travel (or hold when stationary)
    const want = v > 1 ? moveDir : null;
    const w = f.autopilot.wDes;
    w.set(0, 0, 0);
    if (want) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(f.quat);
      const axisW = new THREE.Vector3().crossVectors(fwd, want);
      const ang = Math.asin(Math.min(1, axisW.length()));
      const angFull = fwd.dot(want) < 0 ? Math.PI - ang : ang;
      if (axisW.lengthSq() > 1e-10) {
        axisW.normalize();
        const axisL = axisW.applyQuaternion(f.quat.clone().invert());
        const rate = Math.min(6 * Math.PI / 180, angFull * 0.25);
        w.copy(axisL).multiplyScalar(rate);
      }
    }
    // display speed along nose for gauges
    f.setSpeed = v;
  }
}
