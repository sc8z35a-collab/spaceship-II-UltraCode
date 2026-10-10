// Flying where you look. At the controls (B-29's pilot seat, or H8's), a drag no longer only turns
// the head: it moves the aim — a direction held steady against the local horizon — and the vessel
// turns after it as fast as its thrusters can swing it, the head leading the way (it looks along
// the aim, the cockpit turning round under it), the wings kept level with the horizon. The left
// stick is the throttle (forward and back) and slides the vessel sideways; the up / down buttons
// lift and lower it. The autopilot, HACHI's flying, a monitor being looked at, the external camera:
// none of these is steered by the head (the aim waits, lined up with the nose).
import * as THREE from 'three';

const D2R = Math.PI / 180;
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
const ORIGIN = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class AimPilot {
  constructor(game) {
    this.g = game;
    this.on = true;               // the player's choice (the follow button)
    this.active = false;          // steering this step
    this.yaw = 0; this.pitch = 0; // the aim, against the local horizon (rad)
    this.f = null;                // the flight it is steering
    this.blend = 1;               // the head easing onto the aim after it is taken up
    try { this.on = localStorage.getItem('b29.aimFollow') !== '0'; } catch (e) { /* (no storage) */ }
  }

  setOn(on) {
    this.on = !!on;
    try { localStorage.setItem('b29.aimFollow', this.on ? '1' : '0'); } catch (e) { /* (no storage) */ }
  }

  /** the seat's own facing in the vessel's frame (as the player's view builds it) */
  seatBase(seat, out) {
    const fwd = seat && seat.fwd ? seat.fwd : _v.set(0, 0, -1);
    return out.setFromRotationMatrix(_m.lookAt(ORIGIN, fwd, UP));
  }

  /** the nose's heading and elevation against the horizon (qRel: attitude against the LVLH frame) */
  noseOf(qRel, seat) {
    _q2.copy(qRel).multiply(this.seatBase(seat, _q3));
    _v.set(0, 0, -1).applyQuaternion(_q2);
    return { yaw: Math.atan2(-_v.x, -_v.z), pitch: Math.asin(Math.max(-1, Math.min(1, _v.y))) };
  }

  /** take the aim up from where the nose points (no jump), the head easing round to it */
  reset(f, seat) {
    const n = this.noseOf(f.qRel, seat);
    this.yaw = n.yaw; this.pitch = Math.max(-1.45, Math.min(1.45, n.pitch));
    this.f = f;
    this.blend = 0;
  }

  /** the head's limits in this seat (how far the aim may lead the nose) */
  limits(seat) {
    if (seat && seat.gimbal) return { yaw: Math.PI, pitch: 1.35 };
    return { yaw: 1.9, pitch: 1.05 };
  }

  /**
   * per step, before the flight: inp (the polled input), f (the flight to steer), seat; zoom (the
   * look's magnification). Returns the flight's input { throttle, pitch, yaw, roll, strafeX,
   * strafeY } or null when it is not steering.
   */
  input(sdt, inp, f, seat, zoom = 1) {
    if (!f || f.autopilot) { this.active = false; this.f = null; return null; }
    if (!this.active || this.f !== f) this.reset(f, seat);
    this.active = true;
    // the drag moves the aim (more finely through a zoom)
    const sens = 0.0062 / Math.max(1, zoom);
    this.yaw = wrap(this.yaw - (inp.lookDX || 0) * sens);
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - (inp.lookDY || 0) * sens));
    // (it may lead the nose no further than the head can turn)
    const n = this.noseOf(f.qRel, seat), L = this.limits(seat);
    const dy = wrap(this.yaw - n.yaw);
    if (Math.abs(dy) > L.yaw) this.yaw = wrap(n.yaw + Math.sign(dy) * L.yaw);
    const dp = this.pitch - n.pitch;
    if (Math.abs(dp) > L.pitch) this.pitch = n.pitch + Math.sign(dp) * L.pitch;
    // the attitude wanted: the seat facing along the aim, level with the horizon
    const aim = _q.setFromEuler(_e.set(this.pitch, this.yaw, 0, 'YXZ'));
    const want = aim.multiply(_q3.copy(this.seatBase(seat, _q2)).invert());
    // the turn still to make (in the vessel's own axes), and how fast to make it without
    // overshooting: no faster than the thrusters can stop it in what is left
    const err = _q2.copy(f.qRel).invert().multiply(want);
    if (err.w < 0) { err.x = -err.x; err.y = -err.y; err.z = -err.z; err.w = -err.w; }
    const ang = 2 * Math.acos(Math.min(1, err.w)), s = Math.sqrt(Math.max(0, 1 - err.w * err.w));
    const tk = (f.turnK || 1) * (f.followTurn || 1);
    const maxRate = (f.ultra ? 9 : 6) * D2R * tk;
    const angAcc = 4.0 * D2R * Math.max(0.15, f.rcsHealth) * (f.mul > 1 ? 2 : 1) * tk;
    const rate = ang < 1e-4 || s < 1e-6 ? 0 : Math.min(maxRate, Math.sqrt(2 * angAcc * ang) * 0.85, ang * 3.2);
    const wx = s > 1e-6 ? err.x / s * rate : 0, wy = s > 1e-6 ? err.y / s * rate : 0, wz = s > 1e-6 ? err.z / s * rate : 0;
    const c = (x) => Math.max(-1, Math.min(1, x / maxRate));
    return {
      throttle: inp.moveY || 0,
      pitch: c(wx), yaw: c(-wy), roll: c(-wz),
      strafeX: inp.moveX || 0, strafeY: inp.up || 0,
    };
  }

  /** after the flight: the head looks along the aim (the cockpit turning round under it) */
  head(pl, f, seat, sdt) {
    if (!this.active || !f) return;
    const aim = _q.setFromEuler(_e.set(this.pitch, this.yaw, 0, 'YXZ'));
    // the head in the seat: base^-1 qRel^-1 aim
    const rel = _q2.copy(f.qRel).invert().multiply(aim);
    rel.premultiply(_q3.copy(this.seatBase(seat, _q3)).invert());
    _e.setFromQuaternion(rel, 'YXZ');
    let yaw = _e.y, pitch = _e.x;
    const L = this.limits(seat);
    yaw = Math.max(-L.yaw, Math.min(L.yaw, yaw));
    pitch = Math.max(-L.pitch - 0.1, Math.min(L.pitch + 0.1, pitch));
    // (taken up: the head eases round to it rather than snapping)
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + sdt * 3);
      const k = this.blend * this.blend * (3 - 2 * this.blend);
      pl.yaw += wrap(yaw - pl.yaw) * k;
      pl.pitch += (pitch - pl.pitch) * k;
    } else { pl.yaw = yaw; pl.pitch = pitch; }
  }
}
