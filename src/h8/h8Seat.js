// H8's pilot seat: one smooth shell on a gimbal in the middle of the all-round display. It turns
// all the way round on its column, tips back to face straight up or forward to look at the floor
// (it follows where Kaito looks, so his body always faces his gaze), and it rides H8's motion on
// springs — leaning into the drive's push and the turns, settling with a soft sway — and shivers
// with the guns, the railgun's kick, the hits and the drive's rumble.
//
// Seat-local frame: origin at the gimbal centre G (the pitch axis through the seat's sides), -z
// forward. H8-local: G is fixed in the cockpit.
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';
import { H8 } from './h8Spec.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3();

/** the gimbal centre (H8-local) and the eye relative to it (seat-local) */
export const SEAT = {
  G: V(0, 0.1, -0.22),
  eye: V(0, 0.63, 0.1),
  baseY: H8.floorY,
  pitchMin: -0.95,         // leaning forward (looking at the floor)
  pitchMax: 1.4,           // lying back (looking straight up)
};

/** materials for the seat (added to H8's set) */
export function seatMaterials(M) {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  M.seatWhite = S({ color: 0xe6e8ea, roughness: 0.32, metalness: 0.08 });
  M.seatGrey = S({ color: 0x2b2f34, roughness: 0.55, metalness: 0.3 });
  M.seatFabric = S({ color: 0x23272c, roughness: 0.95, metalness: 0 });
  M.carbon = S({ color: 0x1a1c1f, roughness: 0.38, metalness: 0.45 });
  M.seatLine = S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.55, 0.18), emissiveIntensity: 1.2 });
  M.seatPad = S({ color: 0x000000, emissive: new THREE.Color(0.35, 0.75, 1.0), emissiveIntensity: 0.9 });
  return M;
}

/**
 * Build the seat. Returns { base (static, H8-local), yaw (turns on the column, at G), pitch (tips,
 * child of yaw), stick, throttle }
 */
export function buildSeat(M) {
  const G = SEAT.G;
  // ---- the base: a low disc on the floor glass and the column (static)
  const bb = new Builder();
  bb.cyl(0.24, 0.27, 0.035, 'seatGrey', [G.x, SEAT.baseY + 0.018, G.z], null, 40);
  bb.torus(0.245, 0.008, 'seatLine', [G.x, SEAT.baseY + 0.037, G.z], [Math.PI / 2, 0, 0], 48);
  bb.cyl(0.06, 0.075, 0.28, 'seatWhite', [G.x, SEAT.baseY + 0.17, G.z], null, 28);
  bb.cyl(0.085, 0.085, 0.03, 'carbon', [G.x, SEAT.baseY + 0.32, G.z], null, 28);   // yaw bearing
  const base = bb.build(M, { castShadow: false });
  // ---- the yoke: a carbon fork from the bearing up to the pitch axis either side
  const yb = new Builder();
  const yBear = SEAT.baseY + 0.34 - G.y;       // the bearing, relative to G
  yb.cyl(0.075, 0.075, 0.05, 'carbon', [0, yBear + 0.02, 0], null, 28);
  for (const s of [-1, 1]) {
    const pts = [V(0, yBear + 0.04, 0.0), V(s * 0.16, yBear + 0.06, 0.1), V(s * 0.31, yBear + 0.2, 0.12), V(s * 0.37, -0.08, 0.05), V(s * 0.37, 0, 0)];
    yb.tube(pts, 0.022, 'carbon', { radial: 10, seg: 24 });
    yb.cyl(0.05, 0.05, 0.04, 'seatGrey', [s * 0.355, 0, 0], [0, 0, Math.PI / 2], 24);      // pitch bearing
    yb.torus(0.05, 0.006, 'seatLine', [s * 0.378, 0, 0], [0, Math.PI / 2, 0], 24);
  }
  const yaw = new THREE.Group();
  yaw.position.copy(G);
  yaw.add(yb.build(M, { castShadow: false }));
  // ---- the seat itself (tips on the pitch axis)
  const sb = new Builder();
  const recl = 0.22;                           // backrest recline (its top goes back)
  // pan: shell and cushion, its front edge rolled down
  sb.box(0.48, 0.05, 0.46, 'seatWhite', [0, -0.19, -0.1], [0.06, 0, 0], 0.024);
  sb.box(0.42, 0.045, 0.4, 'seatFabric', [0, -0.155, -0.11], [0.06, 0, 0], 0.02);
  sb.cyl(0.024, 0.024, 0.46, 'seatWhite', [0, -0.205, -0.33], [0, 0, Math.PI / 2], 16);
  // back: one shell rising into the headrest, side wings, the fabric insert with two seams
  sb.push([0, -0.17, 0.11], [recl, 0, 0]);
  sb.box(0.48, 0.74, 0.05, 'seatWhite', [0, 0.36, 0.02], null, 0.024);
  sb.box(0.4, 0.62, 0.035, 'seatFabric', [0, 0.33, -0.02], null, 0.016);
  for (const y of [0.22, 0.44]) sb.box(0.36, 0.006, 0.006, 'seatGrey', [0, y, -0.04], null, 0.002);
  for (const s of [-1, 1]) {
    sb.box(0.045, 0.6, 0.12, 'seatWhite', [s * 0.235, 0.32, -0.03], [0, s * 0.35, 0], 0.02);
    sb.box(0.006, 0.56, 0.006, 'seatLine', [s * 0.258, 0.32, -0.085], [0, s * 0.35, 0], 0.002);
  }
  sb.box(0.3, 0.2, 0.08, 'seatWhite', [0, 0.82, 0.03], null, 0.035);                    // headrest
  sb.box(0.24, 0.15, 0.03, 'seatFabric', [0, 0.82, -0.02], null, 0.012);
  // the restraint retracts into the shell's shoulders (only its anchors show)
  for (const s of [-1, 1]) sb.box(0.05, 0.02, 0.03, 'harness', [s * 0.12, 0.69, -0.03], null, 0.006);
  sb.pop();
  // slim armrests on the shell, a touch pad at each tip
  for (const s of [-1, 1]) {
    sb.box(0.065, 0.035, 0.34, 'seatWhite', [s * 0.3, -0.03, -0.12], null, 0.016);
    sb.box(0.02, 0.12, 0.05, 'seatGrey', [s * 0.27, -0.1, 0.0], null, 0.006);
    sb.box(0.05, 0.004, 0.07, 'seatPad', [s * 0.3, -0.011, -0.24], null, 0.002);
    sb.box(0.004, 0.006, 0.3, 'seatLine', [s * 0.334, -0.028, -0.12], null, 0.001);
  }
  // footrest on a strut under the pan
  sb.pipe(V(0, -0.21, -0.25), V(0, -0.52, -0.5), 0.016, 'carbon', 10);
  sb.box(0.34, 0.02, 0.16, 'seatGrey', [0, -0.53, -0.52], [0.5, 0, 0], 0.008);
  sb.box(0.3, 0.004, 0.012, 'seatLine', [0, -0.518, -0.47], [0.5, 0, 0], 0.001);
  const pitch = new THREE.Group();
  pitch.add(sb.build(M, { castShadow: false }));
  // side-stick (right) and throttle (left), small and modern
  const stick = new THREE.Group();
  {
    const kb = new Builder();
    kb.cyl(0.022, 0.026, 0.02, 'seatGrey', [0, 0.01, 0], null, 16);
    kb.cyl(0.013, 0.016, 0.075, 'carbon', [0, 0.055, 0], null, 12);
    kb.sphere(0.02, 'carbon', [0, 0.098, -0.004], 12, [1, 0.85, 1.15]);
    kb.box(0.012, 0.004, 0.012, 'seatLine', [0, 0.118, -0.004], null, 0.002);
    stick.add(kb.build(M, { castShadow: false }));
    stick.position.set(0.3, -0.013, -0.17);
    pitch.add(stick);
  }
  const throttle = new THREE.Group();
  {
    const kb = new Builder();
    kb.box(0.016, 0.06, 0.016, 'carbon', [0, 0.03, 0], null, 0.004);
    kb.box(0.04, 0.026, 0.05, 'seatGrey', [0, 0.065, 0], null, 0.008);
    kb.box(0.03, 0.004, 0.004, 'seatLine', [0, 0.079, -0.02], null, 0.001);
    throttle.add(kb.build(M, { castShadow: false }));
    throttle.position.set(-0.3, -0.013, -0.16);
    pitch.add(throttle);
  }
  yaw.add(pitch);
  return { base, yaw, pitch, stick, throttle };
}

/**
 * The seat's motion. seat: the seat record (yawSeat / pitchSeat are set by the player as he looks
 * round); writes seat.eyeLocal (H8-local eye) and seat.dynQ (the motion's tilt of the view, in
 * H8's frame).
 */
export class SeatMotion {
  constructor(seat, parts) {
    this.seat = seat;
    this.parts = parts;
    this.p = 0; this.pv = 0;       // spring pitch (rad) and its rate
    this.r = 0; this.rv = 0;       // spring roll
    this.kick = 0;
    this.t = 0;
    seat.pitchSeat = seat.pitchSeat || 0;
    seat.dynQ = new THREE.Quaternion();
    seat.eyeLocal = SEAT.G.clone().add(SEAT.eye);
  }

  /** a jolt (recoil, hits): the seat bucks a little */
  jolt(k) { this.kick = Math.min(3, this.kick + k); this.pv += (Math.random() - 0.6) * k * 0.8; this.rv += (Math.random() - 0.5) * k * 0.6; }

  /**
   * accLocal: H8's proper acceleration (H8 frame, m/s^2), wLocal: its turn rate (rad/s), thrust
   * 0..1 (the drive's rumble), dt
   */
  update(dt, accLocal, wLocal, thrust) {
    const s = this.seat;
    this.t += dt;
    // empty, it settles back upright
    if (!s.occupied) s.pitchSeat = (s.pitchSeat || 0) * Math.exp(-dt * 1.5);
    // the springs: lean back under forward push, into the turns; soft and a little underdamped
    const yawS = s.yawSeat || 0;
    // the push and the turn as the seat feels them (in its own turned frame)
    const cy = Math.cos(yawS), sy = Math.sin(yawS);
    const aFwd = -(accLocal.z * cy + accLocal.x * sy);         // along where the seat faces
    const aSide = accLocal.x * cy - accLocal.z * sy;
    const pT = Math.max(-0.22, Math.min(0.22, aFwd * 0.012 - accLocal.y * 0.004));
    const rT = Math.max(-0.18, Math.min(0.18, -aSide * 0.012 + (wLocal ? wLocal.y * 0.25 : 0)));
    const k = 26, c = 7.5;
    const h = Math.min(dt, 0.05);
    this.pv += (k * (pT - this.p) - c * this.pv) * h; this.p += this.pv * h;
    this.rv += (k * (rT - this.r) - c * this.rv) * h; this.r += this.rv * h;
    // vibration: the guns and hits, and the drive's rumble
    this.kick = Math.max(0, this.kick - dt * 3.5);
    const amp = this.kick * 0.012 + thrust * 0.0022;
    const t = this.t;
    const vx = amp * (Math.sin(t * 61) * 0.6 + Math.sin(t * 97 + 1.3) * 0.4);
    const vz = amp * (Math.sin(t * 73 + 2.1) * 0.6 + Math.sin(t * 113) * 0.4);
    const vy = amp * 0.6 * Math.sin(t * 89 + 0.7);
    // the seat's pose: yaw on the column, pitch on the yoke (it follows the gaze), then the
    // spring lean and the shiver
    const P = this.parts;
    P.yaw.rotation.set(0, yawS, 0);
    P.pitch.rotation.set((s.pitchSeat || 0) + this.p + vx, 0, this.r + vz, 'YXZ');
    P.pitch.position.set(0, vy, 0);
    P.yaw.updateMatrix(); P.pitch.updateMatrix();
    // the eye rides on the seat
    _e.set((s.pitchSeat || 0) + this.p + vx, yawS, this.r + vz, 'YXZ');
    _q.setFromEuler(_e);
    s.eyeLocal.copy(SEAT.eye).applyQuaternion(_q).add(SEAT.G).add(_v.set(0, vy, 0));
    // the view tilts with the springs and the shiver (not with the seat's own following)
    const qy = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yawS);
    const qd = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.p + vx, 0, this.r + vz, 'YXZ'));
    s.dynQ.copy(qy).multiply(qd).multiply(qy.invert());
    // the controls move with the hands (the flight input, a little)
    if (s.input) {
      P.stick.rotation.set(-s.input.pitch * 0.25, 0, -s.input.roll * 0.25);
      P.throttle.rotation.set(-s.input.throttle * 0.35, 0, 0);
      P.stick.updateMatrix(); P.throttle.updateMatrix();
    }
  }
}
