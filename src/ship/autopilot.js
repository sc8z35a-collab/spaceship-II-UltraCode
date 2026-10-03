// Autopilot: flies B-29 to a station (works with ULTRA), slews the nose toward the target,
// decelerates for arrival and then holds station; the repair dock can be docked with.
import * as THREE from 'three';

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

  update(dt) {
    const f = this.g.flight;
    if (this.state === 'off' || !this.target) return;
    if (!f.autopilot) { this.state = 'off'; this.target = null; return; }
    if (f.landed) { this.disengage(true); return; }
    const s = this.target;
    const rel = s.pos.clone().sub(f.pos);
    const dist = rel.length();
    this.dist = dist;
    const dir = rel.clone().divideScalar(Math.max(dist, 1e-6));
    const vmax = Math.min(f.ultra ? 300 : 60, f.speedLimit);
    const standoff = s.kind === 'dock' ? 120 : 320;
    const a = 0.55;
    let v = Math.min(vmax, Math.sqrt(Math.max(0, 2 * a * (dist - standoff))));
    if (dist < standoff + 5) { v = 0; if (this.state !== 'hold' && this.state !== 'docked') { this.state = 'hold'; this.g.asphalt && this.g.asphalt.say('arrived', { name: s.name }); this.g.systems.emit('arrived', s); } }
    else if (dist < 20000) this.state = 'approach';
    // relative velocity command: chase the target while matching its motion
    const vRefHere = f.refVelocity(f.pos, new THREE.Vector3());
    const vMatch = s.vel.clone().sub(vRefHere);
    // only match target motion when reasonably close (far away the field difference is huge)
    const matchW = Math.max(0, Math.min(1, 1 - dist / 3e5));
    f.autopilot.vRel.copy(dir).multiplyScalar(v).addScaledVector(vMatch, matchW);
    if (f.autopilot.vRel.length() > f.speedLimit * 1.05) f.autopilot.vRel.setLength(f.speedLimit * 1.05);
    // attitude: nose toward the target (or along velocity when holding)
    const want = v > 1 ? dir : null;
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
    this.eta = v > 0.5 ? (dist - standoff) / Math.max(v, 1) : 0;
  }
}
