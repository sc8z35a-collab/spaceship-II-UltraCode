// Critically damped springs, stepped exactly (the same motion at 30, 60 or 120 frames a second,
// and a moving goal is followed without overshoot). w: stiffness in rad/s (95 % of the way in
// about 4.7 / w seconds).
import * as THREE from 'three';

/** one coordinate: state { x, v } toward goal (vg: the goal's own speed — it is then at
 * goal + vg * dt at the end of the step) */
export function spring1(s, goal, w, dt, vg = 0) {
  const x0 = s.x - goal, v0 = s.v - vg;
  const e = Math.exp(-w * dt);
  const a = (v0 + w * x0) * dt;
  s.x = goal + vg * dt + (x0 + a) * e;
  s.v = vg + (v0 - w * a) * e;
  return s.x;
}

/** a point: x, v (Vector3) toward goal (Vector3) */
export function springVec(x, v, goal, w, dt) {
  const e = Math.exp(-w * dt);
  for (const k of ['x', 'y', 'z']) {
    const x0 = x[k] - goal[k], v0 = v[k];
    const a = (v0 + w * x0) * dt;
    x[k] = goal[k] + (x0 + a) * e;
    v[k] = (v0 - w * a) * e;
  }
}

const _qe = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _d = new THREE.Vector3(), _Z = new THREE.Vector3();

/** an orientation: q (Quaternion) with angular velocity w3 (Vector3, rad/s) toward goal */
export function springQuat(q, w3, goal, w, dt) {
  // the error as a rotation vector: q = exp(d) * goal
  _qe.copy(q).multiply(_qi.copy(goal).invert());
  if (_qe.w < 0) { _qe.x = -_qe.x; _qe.y = -_qe.y; _qe.z = -_qe.z; _qe.w = -_qe.w; }
  const s = Math.sqrt(Math.max(0, 1 - _qe.w * _qe.w));
  const ang = 2 * Math.atan2(s, _qe.w);
  if (s > 1e-9) _d.set(_qe.x / s, _qe.y / s, _qe.z / s).multiplyScalar(ang); else _d.set(0, 0, 0);
  springVec(_d, w3, _Z, w, dt);
  const a = _d.length();
  if (a > 1e-9) q.setFromAxisAngle(_d.divideScalar(a), a).multiply(goal);
  else q.copy(goal);
  return ang;
}
