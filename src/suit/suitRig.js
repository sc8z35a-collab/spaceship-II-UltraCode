// The suit's limbs on their joints, moved by physics. Each joint is a stiff, damped spring: a
// pressurised suit holds its shape and the man inside holds his limbs, but not rigidly. With
// nothing pushing on him, in free fall, he settles into the neutral posture of weightlessness
// (hips and knees bent, the arms floating up in front, elbows bent); standing in gravity, nearly
// straight. What his body does swings them about that: a booster's push throws them back and
// they sway until it settles; stopping (or striking something) throws them forward; turning
// flings them outward and makes them lag behind the turn. The pull on each piece of a limb is
// worked out where its mass is (the body's acceleration, its turning, and the swing of the piece
// it hangs from), as a torque on its joint; the joints stop at their limits.
import * as THREE from 'three';

// the postures (rad, from the standing pose the suit is built in): [thigh flex, out], shin bend,
// [upper arm raise, out], forearm bend; per side where they differ
const POSES = {
  float: { thigh: [0.62, 0.12], shin: 0.92, upper: [0.62, 0.3], fore: 0.95 },
  boost: { thigh: [0.24, 0.05], shin: 0.34, upper: [0.85, 0.16], fore: 1.32 },
  stand: { thigh: [0.03, 0.03], shin: 0.06, upper: [0.06, 0.15], fore: 0.28 },
  // a hand on a rail: the right arm reaching for it
  rail: { thigh: [0.48, 0.1], shin: 0.78, upper: [0.6, 0.28], fore: 0.9, upperR: [1.35, 0.06], foreR: 0.22 },
};
const LIMB = {
  //        lever (m, to the mass it swings), natural frequency (rad/s), damping ratio, limits
  thigh: { lever: 0.36, w0: 7.5, zeta: 0.3, lim: [[-0.35, 1.7], [-0.12, 0.7]] },
  shin: { lever: 0.24, w0: 9, zeta: 0.3, lim: [0, 2.1] },
  upper: { lever: 0.26, w0: 7, zeta: 0.28, lim: [[-0.5, 2.9], [-0.15, 1.5]] },
  fore: { lever: 0.17, w0: 10, zeta: 0.28, lim: [0.05, 2.25] },
};
// (the man inside works against the pull too: only part of it moves his limbs)
const GIVE = 0.6;
const CENTRE = new THREE.Vector3(0, 0.95, 0);   // where the body turns about (its middle)

const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _ax = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qP = new THREE.Quaternion();
const _gc = new THREE.Vector3(), _tq = new THREE.Vector3(), _wp = new THREE.Vector3(), _ap = new THREE.Vector3();

export class SuitRig {
  /** api: the suit model's (joints, J) */
  constructor(api) {
    this.A = api;
    const J = api.J;
    this.limbs = [];
    for (const k of ['L', 'R']) {
      const s = k === 'L' ? -1 : 1;
      const hip = this.limb('thigh', k, s, J['hip' + k], J['knee' + k], null);
      this.limb('shin', k, s, J['knee' + k], J['ankle' + k].clone().add(new THREE.Vector3(0, -0.06, -0.05)), hip);
      const sh = this.limb('upper', k, s, J['shoulder' + k], J['elbow' + k], null);
      this.limb('fore', k, s, J['elbow' + k], J['wrist' + k].clone().add(new THREE.Vector3(0, -0.04, -0.03)), sh);
    }
    this.pose = 'stand';
    this.mix = copyPose(POSES.stand);
    this.t = Math.random() * 10;
    this.reset();
  }

  limb(kind, k, s, at, to, parent) {
    const L = LIMB[kind];
    const two = Array.isArray(L.lim[0]);
    const o = {
      kind, k, s, two, parent, L,
      pivot: this.A.joints[kind + k],
      at: at.clone(),                                   // the joint (as built, the suit's frame)
      u0: to.clone().sub(at).normalize(),               // toward the mass it swings (as built)
      a: [0, 0], v: [0, 0], acc: [0, 0],                // its angles, their rates, accelerations
      // (each step: its turn, where its joint is, its angular velocity and acceleration, all in
      // the suit's frame)
      q: new THREE.Quaternion(), p: at.clone(), w: new THREE.Vector3(), al: new THREE.Vector3(),
    };
    this.limbs.push(o);
    return o;
  }

  /** straight into the posture it is in (no swing): when it is first seen, after a jump */
  reset(pose = this.pose) {
    this.pose = pose;
    const P = POSES[pose];
    this.mix = copyPose(P);
    for (const o of this.limbs) {
      const r = this.rest(P, o);
      o.a[0] = r[0]; o.a[1] = r[1]; o.v[0] = o.v[1] = 0;
    }
    this.fresh = true;
    this.apply();
  }

  /** the posture's angles for a limb */
  rest(P, o) {
    const key = o.kind + o.k;
    const r = P[key] !== undefined ? P[key] : P[o.kind];
    return Array.isArray(r) ? r : [r, 0];
  }

  /**
   * one drawn frame: dt (s), the body's proper acceleration (what pushes it: thrust, a knock, a
   * floor holding it up; the suit's frame, m/s^2), its angular velocity and acceleration (the
   * suit's frame, rad/s, rad/s^2), the posture it tends to ('float' | 'boost' | 'stand' | 'rail')
   */
  step(dt, acc, w, al, pose) {
    if (pose !== this.pose) this.pose = pose;
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    this.t += dt;
    // the posture moves over gradually (he takes it up; it is not a jump)
    const P = POSES[this.pose], M = this.mix, kk = 1 - Math.exp(-dt * 3);
    for (const key of new Set([...Object.keys(M), ...Object.keys(P)])) {
      const want = P[key] !== undefined ? P[key] : P[key.slice(0, -1)];
      if (want === undefined) continue;
      if (M[key] === undefined) M[key] = Array.isArray(want) ? [...want] : want;
      if (Array.isArray(want)) { M[key][0] += (want[0] - M[key][0]) * kk; M[key][1] += (want[1] - M[key][1]) * kk; }
      else M[key] += (want - M[key]) * kk;
    }
    // (breathing, small shifts of the body inside: never quite still)
    const t = this.t;
    const n = Math.ceil(dt / (1 / 120));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.sub(h, acc, w, al, t + i * h);
    this.apply();
    this.fresh = false;
  }

  sub(h, acc, w, al, t) {
    for (const o of this.limbs) {
      const L = o.L, par = o.parent;
      // this limb's turn in the suit's frame, and where its joint is now
      _qP.copy(par ? par.q : _q.identity());
      const rot = this.rotOf(o, _q2);
      o.q.copy(_qP).multiply(rot);
      if (par) o.p.copy(o.at).sub(par.at).applyQuaternion(par.q).add(par.p);
      else o.p.copy(o.at);
      // the mass it swings, and the pull on it there: the body's acceleration and turning (and,
      // for a forearm or a shin, the swing of the piece it hangs from)
      const u = _v.copy(o.u0).applyQuaternion(o.q);
      const m = _v2.copy(o.p).addScaledVector(u, L.lever);
      const r = m.sub(CENTRE);
      _gc.copy(acc).negate();
      _gc.sub(_v3.copy(al).cross(r));
      _gc.sub(_v3.copy(w).cross(_ax.copy(w).cross(r)));
      if (par) {
        const rp = _v3.copy(o.p).sub(par.p);
        _gc.sub(_ax.copy(par.al).cross(rp));
        _gc.sub(_ap.copy(par.w).cross(_wp.copy(par.w).cross(rp)));
      }
      // its torque on the joint (per its inertia): about the hinge, and (hips, shoulders) out to
      // the side
      _tq.copy(u).cross(_gc).multiplyScalar(GIVE / L.lever);
      const axA = _ax.copy(X).applyQuaternion(_qP);
      const sgn = o.kind === 'shin' ? -1 : 1;
      const tA = sgn * _tq.dot(axA);
      const tB = o.two ? o.s * _tq.dot(_wp.copy(Z).applyQuaternion(_q.copy(_qP).multiply(_q2.setFromAxisAngle(X, o.a[0])))) : 0;
      // the springs toward the posture (with a little life in it), the damping, the limits
      const rest = this.rest(this.mix, o);
      const life = 0.025 * Math.sin(t * 0.9 + o.s * 1.3 + o.u0.y * 4) + 0.015 * Math.sin(t * 2.3 + o.at.x * 9);
      const w0 = L.w0, c = 2 * L.zeta * w0;
      for (let d = 0; d < (o.two ? 2 : 1); d++) {
        const lim = o.two ? L.lim[d] : L.lim;
        let a = (d === 0 ? tA : tB) - w0 * w0 * (o.a[d] - rest[d] - (d === 0 ? life : 0)) - c * o.v[d];
        // (past a limit the suit's stops push back hard)
        if (o.a[d] < lim[0]) a += (lim[0] - o.a[d]) * w0 * w0 * 6;
        else if (o.a[d] > lim[1]) a -= (o.a[d] - lim[1]) * w0 * w0 * 6;
        o.acc[d] = a;
        o.v[d] += a * h;
        o.a[d] += o.v[d] * h;
        if (o.a[d] < lim[0] - 0.08) { o.a[d] = lim[0] - 0.08; if (o.v[d] < 0) o.v[d] *= -0.2; }
        else if (o.a[d] > lim[1] + 0.08) { o.a[d] = lim[1] + 0.08; if (o.v[d] > 0) o.v[d] *= -0.2; }
      }
      // its angular velocity and acceleration in the suit's frame (for what hangs from it)
      const hinge = _v3.copy(X).applyQuaternion(_qP);
      o.w.copy(hinge).multiplyScalar(sgn * o.v[0]);
      o.al.copy(hinge).multiplyScalar(sgn * o.acc[0]);
      if (o.two) {
        const side = _ax.copy(Z).applyQuaternion(_q.copy(_qP).multiply(_q2.setFromAxisAngle(X, o.a[0])));
        o.w.addScaledVector(side, o.s * o.v[1]);
        o.al.addScaledVector(side, o.s * o.acc[1]);
      }
      if (par) { o.w.add(par.w); o.al.add(par.al); }
    }
  }

  /** a limb's own turn on its joint (as its pivot is set: Euler XYZ) */
  rotOf(o, out) {
    if (o.kind === 'shin') return out.setFromAxisAngle(X, -o.a[0]);
    if (o.kind === 'fore') return out.setFromAxisAngle(X, o.a[0]);
    return out.setFromEuler(_eu.set(o.a[0], 0, o.s * o.a[1], 'XYZ'));
  }

  apply() {
    const P = {};
    for (const o of this.limbs) P[o.kind + o.k] = o.two ? o.a : o.a[0];
    this.A.setPose(P);
  }
}

const _eu = new THREE.Euler();
const copyPose = (P) => Object.fromEntries(Object.entries(P).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
