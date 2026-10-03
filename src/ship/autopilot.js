// Autopilot: flies B-29 to a station (works with ULTRA), slews the nose toward the target,
// decelerates for arrival and then holds station; the repair dock can be docked with.
import * as THREE from 'three';
import { MU_EARTH, R_EARTH } from '../core/astro.js';

export class Autopilot {
  constructor(game) {
    this.g = game;
    this.target = null;
    this.state = 'off';   // off | cruise | approach | hold | docked
    this.eta = 0;
    this.dist = 0;
  }

  engage(stationId) {
    const s = this.g.stations.byId(stationId);
    if (!s) return false;
    if (this.g.systems.serversHealth !== undefined && this.g.systems.serversHealth < 0.25) { this.g.asphalt && this.g.asphalt.say('autopilot_fail'); return false; }
    this.target = s;
    this.state = 'cruise';
    this.g.flight.autopilot = { vRel: new THREE.Vector3(), wDes: new THREE.Vector3() };
    this.g.asphalt && this.g.asphalt.say('autopilot_on', { name: s.name });
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
    this.g.stations.orbitPos(s.r, s.n, s.phi0, 0, tShip, s.pos, s.vel);
    const rel = s.pos.clone().sub(f.pos);
    const dist = rel.length();
    this.dist = dist;
    const dir = rel.clone().divideScalar(Math.max(dist, 1e-6));
    const vmax = Math.min(f.ultra ? 300 : 60, f.speedLimit);
    const standoff = s.kind === 'dock' ? 120 : 320;
    const a = 0.55;
    const vRefHere = f.refVelocity(f.pos, new THREE.Vector3());
    let v, moveDir;
    if (dist < 40000) {
      // close in: match the target's real motion and close straight in
      v = Math.min(vmax, Math.sqrt(Math.max(0, 2 * a * (dist - standoff))));
      if (this.state === 'hold' && dist < standoff + 300) v = 0;            // keep station (hysteresis)
      else if (dist < standoff + 5) { v = 0; this.state = 'hold'; this.g.asphalt && this.g.asphalt.say('arrived', { name: s.name }); this.g.systems.emit('arrived', s); }
      else this.state = 'approach';
      f.autopilot.vRel.copy(s.vel).addScaledVector(dir, v).sub(vRefHere);
      moveDir = dir;
      this.eta = v > 0.5 ? (dist - standoff) / Math.max(v, 1) : 0;
    } else {
      // far: travel through the orbital field (around the planet, never through it) —
      // close the phase gap along the orbit first, climb / descend with what is left of the
      // speed budget, and ride at the target's angular rate so the gap does not drift
      this.state = 'cruise';
      const r = f.pos.length();
      const er = f.pos.clone().divideScalar(r);
      const eh = f.hRef.clone().addScaledVector(er, -f.hRef.dot(er)).normalize();
      const et = new THREE.Vector3().crossVectors(eh, er).normalize();
      const rT = s.pos.length();
      const tp = s.pos.clone().divideScalar(rT);
      const dphi = Math.atan2(tp.dot(et), tp.dot(er));
      const n = Math.sqrt(MU_EARTH / (r * r * r)), nT = Math.sqrt(MU_EARTH / (rT * rT * rT));
      const arc = r * dphi, dr = rT - r, dz = s.pos.dot(eh);
      const vt = Math.sign(arc) * Math.min(vmax, Math.sqrt(2 * a * Math.abs(arc)));
      const budget = Math.sqrt(Math.max(0, vmax * vmax - vt * vt));
      const lenRZ = Math.hypot(dr, dz);
      const vrz = lenRZ > 1 ? Math.min(budget, Math.sqrt(2 * a * lenRZ)) : 0;
      const close = et.clone().multiplyScalar(vt);
      if (lenRZ > 1) close.addScaledVector(er, dr / lenRZ * vrz).addScaledVector(eh, dz / lenRZ * vrz);
      f.autopilot.vRel.copy(close).addScaledVector(et, r * (nT - n));
      v = close.length();
      moveDir = v > 1e-3 ? close.clone().divideScalar(v) : dir;
      this.eta = (Math.abs(arc) + lenRZ) / Math.max(vmax, 1);
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
