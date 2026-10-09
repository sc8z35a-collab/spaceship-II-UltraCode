// The spacesuits aboard and the one Kaito wears: H8's (top grade, in the shelter's niche) and
// B-29's (civilian, on its rack in the airlock). Each keeps its own state (suitSystem.js) — charge,
// oxygen, damage — racked, it charges from its own ship (H8's in 10 minutes, B-29's in 30) and its
// tanks are topped up; worn, it runs down with the flying and the breathing and takes what the
// knocks do to it.
//
//  - putting a suit on is the real thing: B-29's rack turns the suit round on its turntable, the
//    backpack door swings open, Kaito climbs in through the back, the door shuts and seals, the visor
//    display boots, the turntable turns him back round to face the room; in H8's shelter the niche's
//    carriage brings the suit out to the seat the same way. Taking it off runs the other way round;
//  - flying: the fine thrusters by default (a few m/s, steady close to the hull), the boosters once
//    armed (H8's two: 14 m/s^2 up to 500 m/s for an hour; B-29's one: 4 m/s^2 up to 100 m/s for
//    half an hour); a lopsided pack (one booster out) pulls to the side;
//  - out in space Kaito is a body of his own: his position and velocity are kept in space (gravity
//    and his thrusters move him) and the ship's frame is worked out round him — when the ship
//    accelerates, turns or flies off it does so without him, unless he holds on to it or its hull
//    is in his way. Only if asked (自動停止) does the suit's computer brake him to a stop against
//    the ship, on its thrusters and its charge;
//  - knocks: the speed lost against whatever the suit met is an impact on the part that met it;
//  - out on a walk the suit is seen from outside too (another camera, H8's display): the wearer's
//    face behind the visor, the boosters' plumes, the lamps.
import * as THREE from 'three';
import { SuitRescue } from './suitRescue.js';
import { SUITS, SuitState, contactSpeeds, SYSTEMS_JP, PARTS } from './suitSystem.js';
import { SuitCamera } from './suitCamera.js';
import { buildSuit } from './suitModel.js';
import { SuitRig } from './suitRig.js';
import { VisorHud } from './visorHud.js';
import { DOCK_AT } from '../world/stations.js';
import { LOBBY, TUNNEL } from '../world/stationLobby.js';
import { MU_EARTH } from '../core/astro.js';
import { H8 as H8S } from '../h8/h8Spec.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const seg = (t, a, b) => ease((t - a) / (b - a));
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const EYE_IN = V(0, 1.62, -0.035);          // the eye inside the helmet (suit frame)
const FINE = { h8: { acc: 2.6, v: 6 }, b29: { acc: 1.4, v: 4 } };   // the fine thrusters
// the flight computer's assist: how much harder than the bare thrusters it may push to fly what the
// stick asks (both nozzles of a pair together), how quickly it closes on it (s)
const ASSIST = { k: 2.0, tau: 0.22 };
const _ac = new THREE.Vector3(), _av = new THREE.Vector3();

/**
 * The suit's flight computer: the stick asks for a velocity against the vessel — forward and back
 * along the view, sideways, up and down — and the thrusters fly it, quick and firm; let go and it
 * brings him to rest against the vessel (the boosters braking the last of a fast run). With the
 * boosters armed, a push forward asks for their speed. want: the direction asked (unit, the
 * frame's axes), asked 0..1, rel: his velocity against the vessel (same axes), out: the
 * acceleration to make. Returns the throttle (0..1) it takes.
 */
function assistAcc(want, asked, boosting, fwd, rel, S, Fn, tk, autoV, out) {
  const P = S.spec.propulsion;
  const vFine = Fn.v;
  // what is asked: the fine speed along the stick; the boosters' along the view while armed
  const vCmd = _av.set(0, 0, 0);
  if (autoV) vCmd.copy(autoV);
  else if (asked > 0.02) {
    vCmd.copy(want).multiplyScalar(vFine * asked);
    if (boosting) vCmd.addScaledVector(fwd, Math.max(0, P.vMax * asked - vFine * asked));
  }
  const dv = _ac.copy(vCmd).sub(rel);
  const err = dv.length();
  if (err < 0.004) { out.set(0, 0, 0); return 0; }
  // the bare thrusters' push (more for the boosters when the gap is large: fast runs, braking)
  const big = boosting || err > vFine * 1.2;
  const aMax = (big ? Math.max(P.accel, Fn.acc * ASSIST.k) : Fn.acc * ASSIST.k) * tk;
  out.copy(dv).multiplyScalar(1 / ASSIST.tau);
  if (out.length() > aMax) out.setLength(aMax);
  return Math.min(1, out.length() / Math.max(1e-4, aMax)) * (big ? 1 : 0.18);
}
const ZERO = V(0, 0, 0);
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _e3 = new THREE.Vector3(), _qe = new THREE.Quaternion(), _qe2 = new THREE.Quaternion(), _eu = new THREE.Euler();
const gravE = (p, out) => { const r = p.length(); return out.copy(p).multiplyScalar(-MU_EARTH / (r * r * r)); };
// (the avatar's joints: its attitude, what moves it)
const _qAv = new THREE.Quaternion(), _qW = new THREE.Quaternion(), _a1 = new THREE.Vector3(), _a2 = new THREE.Vector3();
const AX_X = V(1, 0, 0), AX_Y = V(0, 1, 0);

export class Suits {
  constructor(g) {
    this.g = g;
    this.st = { h8: new SuitState(SUITS.h8), b29: new SuitState(SUITS.b29) };
    for (const k of Object.keys(this.st)) this.st[k].onEvent = (kind, info) => this.onEvent(k, kind, info);
    this.cam = new SuitCamera();
    this.boost = false;          // the boosters armed (else the fine thrusters)
    this.hold = true;            // the flight computer's assist (on: the stick asks for a velocity,
                                 // let go and it stops him against the ship; off: bare thrusters)
    this.autoV = null;           // a velocity the computer flies on its own (the rescue bringing him in)
    this.eva = null;             // out in space: his own state { p, v (ECI), q (the frame's turn), solo }
    this.throttle = 0;           // what is being asked of the boosters now (0..1)
    this.lamp = false;
    this.sunVisor = 0;
    this.racks = {};             // { b29: { api, pivot, feet, idle }, h8: {...} } set by the ships
    this.seq = null;             // a suit going on or coming off
    this.rescue = null;          // a call for help under way (suitRescue.js keeps it)
    this.rescuer = new SuitRescue(this);
    this.ref = 'b29';            // what speeds are measured against on the visor
    this.hud = new VisorHud(g, this);
    // the helmet's lamps: a pair of LED floods (a narrow-ish beam, soft edge, falling off with the
    // square of the distance)
    this.light = new THREE.SpotLight(0xf4f8ff, 0, 45, 0.38, 0.65, 2);
    this.light.layers.enableAll();
    g.shipVis.root.add(this.light, this.light.target);
  }

  get worn() { const pl = this.g.player; return pl.suit ? (pl.suitH8 ? 'h8' : 'b29') : null; }
  get state() { const w = this.worn; return w ? this.st[w] : null; }
  get spec() { const w = this.worn; return w ? SUITS[w] : null; }
  get busy() { return !!this.seq; }

  // ================================================================== putting it on / off
  /** a rack's suit: its turntable (pivot: the suit stands on it, rotation.y), where its feet are
   * (pivot's origin) and which way it faces when idle (rotation.y) */
  /**
   * frame: the object whose own frame the rack is built in (B-29's root; H8's, whose world
   * placement is managed apart from B-29's), toPF: that frame into the player's (H8 docked: its
   * offset on B-29's back)
   */
  setRack(kind, api, pivot, idle, opts = {}) {
    this.racks[kind] = { api, pivot, idle, slide: opts.slide || null, seatEye: opts.seatEye || null, onStart: opts.onStart || null, onEnd: opts.onEnd || null, frame: opts.frame || null, toPF: opts.toPF || null };
    pivot.rotation.y = idle;
  }

  /**
   * the rack's suit frame in the player's frame: the suit's own transforms up to the rack's frame
   * (their local matrices: a world matrix set apart for drawing — H8's — would throw it out)
   */
  rackMatrix(R, out = new THREE.Matrix4()) {
    const top = R.frame || this.g.shipVis.root;
    out.identity();
    for (let o = R.api.root; o && o !== top; o = o.parent) { if (o.matrixAutoUpdate) o.updateMatrix(); out.premultiply(o.matrix); }
    if (R.toPF) out.premultiply(R.toPF);
    return out;
  }

  /** the PF pose of a point (suit frame) on a rack's suit */
  suitPoint(R, local, out = new THREE.Vector3()) {
    return out.copy(local).applyMatrix4(this.rackMatrix(R, _m));
  }

  /** the direction the rack's suit faces (PF) */
  suitFacing(R, out = new THREE.Vector3()) {
    return out.set(0, 0, -1).transformDirection(this.rackMatrix(R, _m));
  }

  /** start putting a suit on (kind: its rack) */
  don(kind) {
    const g = this.g, pl = g.player, R = this.racks[kind];
    if (!R || this.seq || pl.suit) return false;
    this.seq = { kind, on: true, t: 0, T: kind === 'h8' ? 7.4 : 7.1, from: { pos: pl.eyeLocal.clone(), q: pl.lookQuat.clone() }, said: {} };
    if (R.onStart) R.onStart(true);
    this.lockInput(true);
    return true;
  }

  /** start taking the worn suit off at its own rack */
  doff() {
    const g = this.g, pl = g.player, kind = this.worn, R = kind && this.racks[kind];
    if (!R || this.seq) return false;
    this.seq = { kind, on: false, t: 0, T: kind === 'h8' ? 7.6 : 6.8, from: { pos: pl.eyeLocal.clone(), q: pl.lookQuat.clone() }, said: {} };
    if (R.onStart) R.onStart(false);
    R.api.root.visible = true;
    this.lockInput(true);
    return true;
  }

  lockInput(on) { this.g.cine = on ? this : null; }

  /** the sequence through a step: the turntable, the door, the sounds, and at its end the swap */
  stepSeq(dt) {
    const S = this.seq, g = this.g, A = g.audio, R = this.racks[S.kind];
    S.t += dt;
    const t = S.t, h8 = S.kind === 'h8';
    const once = (k, f) => { if (!S.said[k]) { S.said[k] = true; f(); } };
    const at = this.suitPoint(R, V(0, 1.0, 0));
    // the timeline (seconds): turn to the back, door open, in / out, door shut, turn back
    const L = S.on
      ? (h8 ? { turn0: [0.6, 2.4], open: [2.2, 3.0], move: [2.6, 4.3], shut: [4.2, 4.9], turn1: [4.9, 6.4], sit: [5.8, 7.2] } : { turn0: [0, 1.8], open: [1.5, 2.4], move: [2.1, 3.9], shut: [3.8, 4.5], turn1: [4.6, 6.4], step: [6.4, 7.1] })
      : (h8 ? { stand: [0, 1.2], turn0: [1.2, 2.8], open: [2.8, 3.6], move: [3.5, 5.0], shut: [5.0, 5.8], turn1: [5.8, 7.4] } : { into: [0, 1.0], turn0: [1.0, 2.8], open: [2.6, 3.4], move: [3.4, 4.6], shut: [4.4, 5.2], turn1: [5.0, 6.6] });
    S.L = L;
    // the turntable: idle facing -> its back to the wearer -> idle again
    const back = R.idle + Math.PI;
    const k0 = seg(t, L.turn0[0], L.turn0[1]), k1 = seg(t, L.turn1[0], L.turn1[1]);
    R.pivot.rotation.y = R.idle + (back - R.idle) * k0 + (R.idle - back) * k1;
    if (R.slide) R.slide(Math.min(seg(t, 0, 1.0), 1 - seg(t, S.T - 1.0, S.T)));
    const kOpen = seg(t, L.open[0], L.open[1]) * (1 - seg(t, L.shut[0], L.shut[1]));
    R.api.setDoor(kOpen);
    if (t > L.turn0[0]) once('turn0', () => A.mech(at, 'heavy', { open: true, dur: L.turn0[1] - L.turn0[0], pitch: 1.4, gain: 0.7 }));
    if (t > L.open[0]) once('open', () => { A.mech(at, 'hatch', { open: true, dur: L.open[1] - L.open[0], pitch: 1.7, gain: 0.6 }); });
    if (t > L.shut[0]) once('shut', () => { A.mech(at, 'hatch', { open: false, dur: L.shut[1] - L.shut[0], pitch: 1.7, gain: 0.7 }); });
    if (t > L.turn1[0]) once('turn1', () => A.mech(at, 'heavy', { open: false, dur: L.turn1[1] - L.turn1[0], pitch: 1.4, gain: 0.7 }));
    // the visor display boots as the door seals (or goes out as it opens)
    if (S.on && t > L.shut[1] - 0.2) once('boot', () => { this.hud.boot(); A.beep(880, 0.06, 0.06, { direct: true }); A.beep(1320, 0.06, 0.06, { direct: true, when: 0.12 }); });
    if (!S.on && t > L.open[0] - 0.3) once('down', () => { this.hud.shutdown(); A.beep(660, 0.08, 0.06, { direct: true }); });
    // the suit itself: worn from the moment the door shuts on him, racked again once he is out
    if (S.on && t > L.shut[1]) once('worn', () => {
      const pl = g.player;
      pl.suit = true; pl.suitH8 = h8;
      this.mirror();
    });
    if (!S.on && t > L.open[0]) once('off', () => { const pl = g.player; pl.suit = false; pl.suitH8 = false; this.mirror(); });
    // (the suit is not drawn while the eye is inside it: from in there the visor's frame is enough)
    const mid = (L.move[0] + L.move[1]) / 2;
    R.api.root.visible = S.on ? t < mid : t > mid;
    if (t >= S.T) this.endSeq();
  }

  endSeq() {
    const S = this.seq, g = this.g, pl = g.player, R = this.racks[S.kind];
    const pose = this.seqPose(S.T);
    this.seq = null;
    this.lockInput(false);
    R.pivot.rotation.y = R.idle;
    R.api.setDoor(0);
    if (R.slide) R.slide(0);
    if (S.on) {
      R.api.root.visible = false;
      if (S.kind === 'b29') {
        // stepped off the turntable, facing the room
        const f = this.suitFacing(R);
        const feet = this.suitPoint(R, V(0, 0, 0.0));
        pl.teleport(feet.clone().add(V(0, 0.95, 0)).addScaledVector(f, 0.35));
        pl.yaw = Math.atan2(-f.x, -f.z); pl.pitch = 0;
      }
      if (S.kind === 'h8') this.g.h8 && this.g.h8.say('hachi_suit_on', {}, { force: true });
      else g.asphalt.say('suit_on', {}, { force: true });
    } else {
      R.api.root.visible = true;
      if (S.kind === 'b29') {
        const p = pose.pos;
        pl.teleport(V(p.x, Math.max(0, p.y - 1.62) + 0.95, p.z));
        const f = this.suitFacing(R);
        pl.yaw = Math.atan2(f.x, f.z); pl.pitch = -0.1;
      }
      if (S.kind === 'h8') this.g.h8 && this.g.h8.say('hachi_suit_off', {}, { force: true });
      else g.asphalt.say('suit_off', {}, { force: true });
    }
    // (this very frame's eye and look already where the sequence left them: no flash of the view
    // from before it)
    if (S.kind === 'b29') { pl.eyeLocal.copy(pose.pos); pl.viewQuat(pl.lookQuat); }
    if (R.onEnd) R.onEnd(S.on);
  }

  /** where things are with the suit turned round (its back to the wearer, run out of its niche):
   * the place behind it the wearer climbs in from (far enough back to see the whole of the open
   * back), the hatch's opening, the inside of the torso, and the eye in the helmet then */
  backPoints(R, h8) {
    const p0 = R.pivot.position.clone(), r0 = R.pivot.rotation.y;
    R.pivot.rotation.y = R.idle + Math.PI;
    if (R.slide) R.slide(1);
    // (H8's shelter is under a metre across: there he leans back against its far wall to see it)
    const behind = this.suitPoint(R, V(0, h8 ? 1.66 : 1.74, h8 ? 0.72 : 1.3));
    const look = this.suitPoint(R, V(0, 1.3, 0.1));
    const hatch = this.suitPoint(R, V(0, 1.3, h8 ? 0.3 : 0.42));
    const torso = this.suitPoint(R, V(0, 1.36, 0.02));
    const eye = this.suitPoint(R, EYE_IN);
    R.pivot.position.copy(p0); R.pivot.rotation.y = r0;
    R.api.root.updateWorldMatrix(true, false);
    return { behind, look, hatch, torso, eye };
  }

  /**
   * how far into the suit the eye is during the sequence: the helmet round the view once the head
   * is up in it, the dark of the suit's body on the way through (it hides the suit going)
   */
  seqInside() {
    const S = this.seq;
    if (!S || !S.L) return { frame: 0, dark: 0 };
    const L = S.L;
    const k = Math.max(0, Math.min(1, (S.t - L.move[0]) / (L.move[1] - L.move[0])));
    const inside = S.on ? k : 1 - k;
    const sm = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    return { frame: sm(0.74, 0.94, inside), dark: sm(0.16, 0.34, inside) * (1 - sm(0.8, 0.96, inside)) };
  }

  /** where the eye is during the sequence (PF), at time t */
  seqPose(t) {
    const S = this.seq || this._last, R = this.racks[S.kind], L = S.L;
    const h8 = S.kind === 'h8';
    // the key poses: behind the suit once it has turned its back (fixed), inside the helmet (it
    // rides the turntable with the suit), the seat (H8)
    const eyeIn = this.suitPoint(R, EYE_IN);
    const fwd = this.suitFacing(R);
    const B = S.back || (S.back = this.backPoints(R, h8));
    const behind = B.behind;
    const look = (from, to) => _q2.setFromRotationMatrix(_m.lookAt(from, to, V(0, 1, 0))).clone();
    const qIn = look(eyeIn, eyeIn.clone().add(fwd));
    const qBehind = look(behind, B.look);
    // the climb in: down to the hatch, in through it, up into the helmet (a smooth curve through
    // those points; the eye ducks a little going through)
    const path = (u) => {
      const P = [behind, B.hatch, B.torso, eyeIn];
      const n = P.length - 1, x = Math.max(0, Math.min(0.9999, u)) * n, i = Math.floor(x), f = x - i;
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n, i + 2)];
      const f2 = f * f, f3 = f2 * f;
      return p1.clone().multiplyScalar(2).add(p2.clone().sub(p0).multiplyScalar(f)).add(p0.clone().multiplyScalar(2).sub(p1.clone().multiplyScalar(5)).add(p2.clone().multiplyScalar(4)).sub(p3).multiplyScalar(f2)).add(p0.clone().negate().add(p1.clone().multiplyScalar(3)).sub(p2.clone().multiplyScalar(3)).add(p3).multiplyScalar(f3)).multiplyScalar(0.5);
    };
    const from = S.from;
    let pos, q;
    if (S.on) {
      const k1 = seg(t, 0, L.move[0]), k2 = seg(t, L.move[0], L.move[1]);
      pos = k2 > 0 ? path(k2) : from.pos.clone().lerp(behind, k1);
      // (looking ahead along the way in, then out through the visor)
      q = from.q.clone().slerp(qBehind, k1).slerp(qIn, seg(k2, 0.35, 1.0));
      if (k2 >= 1) pos = eyeIn.clone();
      if (h8 && L.sit) {
        // and back down into the seat, in the suit
        const k3 = seg(t, L.sit[0], L.sit[1]);
        pos.lerp(from.pos, k3); q.slerp(from.q, k3);
      }
      if (L.step) {
        // and off the turntable: a step forward onto the deck (a little dip in it)
        const k4 = seg(t, L.step[0], L.step[1]);
        pos.addScaledVector(fwd, 0.35 * k4).add(V(0, -0.035 * Math.sin(k4 * Math.PI), 0));
      }
    } else {
      const k0 = h8 ? seg(t, L.stand[0], L.stand[1]) : seg(t, L.into[0], L.into[1]);
      const k2 = seg(t, L.move[0], L.move[1]);
      pos = k2 > 0 ? path(1 - k2) : from.pos.clone().lerp(eyeIn, k0);
      q = from.q.clone().slerp(qIn, k0).slerp(qBehind, seg(k2, 0.0, 0.65));
      if (h8) { const k3 = seg(t, S.T - 1.4, S.T); pos.lerp(from.pos, k3); q.slerp(from.q, k3); }
    }
    return { pos, q };
  }

  /** the camera override for the render (game.js): the sequence's eye */
  pose() {
    if (!this.seq) return null;
    this._last = this.seq;
    return this.seqPose(this.seq.t);
  }

  // ================================================================== per step
  /** dt: game time (the suits' charge and oxygen), rdt: real time (the sequence, the display) */
  update(dt, rdt = dt) {
    const g = this.g, pl = g.player;
    if (this.seq) this.stepSeq(rdt);
    const w = this.worn;
    // the racked suits: on their ship's power they charge (and their tanks are topped up)
    const h8 = g.h8;
    for (const k of ['h8', 'b29']) {
      if (k === w) continue;
      const power = k === 'h8' ? !!(h8 && h8.mode !== 'lost' && h8.mode !== 'pod' && h8.screenPower() > 0.3) : (g.systems.power ?? 1) > 0.3 && !(g.damage && g.damage.broken);
      this.st[k].update(dt, { charging: power, inAir: true });
    }
    if (w) {
      const S = this.st[w];
      const here = g.lifeSupport.pressureAt ? g.lifeSupport.pressureAt(pl.pos, pl.outside) : 100;
      const inAir = !pl.outside && here > 60;
      const flying = pl.outside && this.throttle > 0.01;
      S.update(dt, { flying, throttle: this.throttle, work: pl.state === 'evaWalk' || pl.state === 'walk' ? 0.4 : flying ? 0.25 : 0.1, inAir });
      this.mirror();
    } else this.throttle = 0;
    this.cam.update(rdt);
    this.updateLight();
    // the racked suits: the cabin round them in their glass and on their shells
    const env = g.shipVis && g.shipVis.envInterior;
    if (env) for (const R of Object.values(this.racks)) if (R.api && R._env !== env) { R._env = env; R.api.setEnv(env, 0.55); }
    this.stationContacts();
    this.updateHatches();
    this.hud.update(rdt);
    this.updateRescue(dt);
  }

  // ================================================================== stations' EVA hatches
  /**
   * Every station has an EVA hatch on its hull above the lobby (by the berth): a suited visitor
   * comes in through it — the station's own tug brings B-29 to the berth meanwhile (if it is not
   * too far off) — and goes out again through its inner door in the lobby.
   */
  evaHatchOf(s) {
    if (s._eva !== undefined) return s._eva;
    const P = s.model && s.model.userData.proxies;
    if (!P) { s._eva = null; return null; }
    const dk = this.g.docking, n = new THREE.Vector3();
    // over the lobby (docked, the station's frame is the ship's shifted by DOCK_AT), out past the hull
    const p = V(LOBBY.xc, LOBBY.yc + LOBBY.R, 0).add(DOCK_AT);
    for (let k = 0; k < 80; k++) {
      let clear = true;
      for (const pr of P) if (dk.proxyDist(p, pr, n) < 1.4) { clear = false; break; }
      if (clear) break;
      p.y += 0.5;
    }
    s._eva = { local: p };
    // the hatch on the hull: a yellow ring round a dark lid, two lamps that blink
    const grp = new THREE.Group();
    const yel = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.5, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.6, metalness: 0.5 });
    const lamp = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.3, 1, 0.45), emissiveIntensity: 5 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.09, 10, 36), yel); ring.rotation.x = Math.PI / 2;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.72, 0.12, 36), dark);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 8, 24), yel); wheel.rotation.x = Math.PI / 2; wheel.position.y = 0.09;
    grp.add(ring, lid, wheel);
    for (const sx of [-1, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), lamp); l.position.set(sx * 1.05, 0.08, 0); grp.add(l); }
    grp.position.copy(p).add(V(0, -1.0, 0));
    s._eva.lamp = lamp;
    if (s.model) {
      const ref = s.model.getObjectByProperty('isMesh', true);
      grp.traverse((o) => { if (o.isMesh && ref) o.layers.mask = ref.layers.mask; });
      s.model.add(grp);
    }
    return s._eva;
  }

  /** the hatch's place in the ship's frame now (it moves with its station) */
  hatchPF(s, out = new THREE.Vector3()) {
    const g = this.g, H = this.evaHatchOf(s);
    if (!H) return null;
    const pose = g.docking.stationPose(s, g.time, this._pose || (this._pose = {}));
    out.copy(H.local).applyQuaternion(pose.quat).add(pose.pos).sub(g.flight.pos).applyQuaternion(_q.copy(g.flight.quat).invert());
    return out;
  }

  /**
   * out in a suit near a station (or H8 flying free): its hull is solid. The suit is pushed back
   * out of it, and the speed it came in at is an impact on the part that met it
   */
  stationContacts() {
    const g = this.g, pl = g.player;
    if (!pl.suit || !pl.outside || this.seq || (g.h8 && g.h8.solo)) return;
    const dk = g.docking, me = this.playerEci(_v2), n = new THREE.Vector3();
    const qShip = _q.copy(g.flight.quat), qInv = qShip.clone().invert();
    for (const s of g.stations.list) {
      const P = s.model && s.model.userData.proxies;
      if (!P || s.pos.distanceTo(me) > (s.model.userData.radius || 200) + 60) continue;
      const pose = dk.stationPose(s, g.time, this._pc || (this._pc = {}));
      const ps = dk.toLocal(pose, me, new THREE.Vector3());
      for (const pr of P) {
        const d = dk.proxyDist(ps, pr, n) - 0.45;            // (the suit's own size)
        if (d >= 0) continue;
        // the surface's normal into the ship's frame; the station's speed there, in that frame
        const nPF = n.clone().applyQuaternion(pose.quat).applyQuaternion(qInv);
        const vSt = dk.frameVel(s, pose, me, new THREE.Vector3()).sub(g.flight.vel).applyQuaternion(qInv);
        const rel = pl.vel.clone().sub(vSt);
        const vn = rel.dot(nPF);
        pl.pos.addScaledVector(nPF, -d + 0.02);
        pl.body.setNextKinematicTranslation({ x: pl.pos.x, y: pl.pos.y, z: pl.pos.z });
        if (vn < 0) {
          // what it came in with goes into the knock (and it bounces back a little)
          const inward = nPF.clone().multiplyScalar(vn);
          const dv = inward.clone().multiplyScalar(-1.3);
          pl.vel.add(dv);
          this.syncEci(pl, dv);
          this.contact(pl, inward, rel.clone().sub(inward));
        } else this.syncEci(pl);
        break;
      }
    }
  }

  /** suited and out: is a station's EVA hatch within reach? (the visor shows a button) */
  updateHatches() {
    const g = this.g, pl = g.player;
    this.hatchNear = null;
    if (!pl.suit || !pl.outside || this.seq || (g.h8 && g.h8.solo)) return;
    const me = this.playerEci(_v2);
    for (const s of g.stations.list) {
      if (!s.model || s.pos.distanceTo(me) > (s.model.userData.radius || 200) + 400) continue;
      const p = this.hatchPF(s, _v);
      if (p && p.distanceTo(pl.pos) < 3.2) { this.hatchNear = s; break; }
    }
    for (const s of g.stations.list) if (s._eva && s._eva.lamp) s._eva.lamp.emissiveIntensity = (performance.now() / 600) % 1 < 0.5 ? 6 : 0.6;
  }

  /** in through a station's EVA hatch: B-29 is berthed by the station's tug, Kaito is let in */
  evaEnter(s) {
    const g = this.g, pl = g.player, dk = g.docking;
    if (!s) return;
    if (dk.station !== s || dk.state !== 'docked') {
      if (s.pos.distanceTo(g.flight.pos) > 200e3) { g.asphalt.say('st_eva_far', {}, { force: true }); return; }
      if (dk.state !== 'free') { g.asphalt.say('st_busy', { name: s.name }, { force: true }); return; }
    }
    this.lockInput(true);
    g.hud.setFade(1);
    g.audio.mech(pl.eyeLocal, 'hatch', { open: true, direct: true });
    setTimeout(() => {
      if (dk.state !== 'docked' || dk.station !== s) dk.redock(s.id);
      pl.vel.set(0, 0, 0);
      pl.teleport(V(TUNNEL.xEnd + 1.2, LOBBY.floorY + 0.95, TUNNEL.zc));
      pl.yaw = -Math.PI / 2; pl.pitch = 0;
      this.lockInput(false);
      g.hud.setFade(0);
      g.audio.mech(pl.eyeLocal, 'hatch', { open: false, direct: true });
      g.asphalt.say('st_eva_in', { name: s.name }, { force: true });
    }, 1600);
  }

  /** out through the lobby's EVA door: Kaito appears at the station's hatch outside */
  evaExit() {
    const g = this.g, pl = g.player, dk = g.docking, s = dk.station;
    if (!pl.suit || !s) { g.audio.denied(pl.eyeLocal); return; }
    this.lockInput(true);
    g.hud.setFade(1);
    g.asphalt.say('st_eva_out', {}, { force: true });
    g.audio.mech(pl.eyeLocal, 'hatch', { open: true, direct: true });
    setTimeout(() => {
      const p = this.hatchPF(s, new THREE.Vector3());
      if (p) { pl.vel.set(0, 0, 0); pl.teleport(p.add(V(0, 1.2, 0))); }
      this.lockInput(false);
      g.hud.setFade(0);
    }, 1600);
  }

  /** the lobby's inner EVA door (docking.spawn / despawn) */
  lobbyHatch(lobby, on) {
    const g = this.g;
    if (!on) { if (this._lobbyTap) { g.interact.remove(this._lobbyTap); this._lobbyTap = null; } return; }
    if (!lobby || lobby.origin) return;
    if (!lobby.evaDoor) {
      const grp = new THREE.Group();
      const yel = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.5, metalness: 0.2 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x30353d, roughness: 0.55, metalness: 0.5 });
      const lamp = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.3, 1, 0.45), emissiveIntensity: 3 });
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 10, 32), yel);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.08, 32), dark); lid.rotation.x = Math.PI / 2;
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 8, 24), yel); wheel.position.z = -0.06;
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), lamp); l.position.set(0, 0.8, 0);
      grp.add(frame, lid, wheel, l);
      grp.position.set(LOBBY.xc, LOBBY.floorY + 1.05, LOBBY.z1 - 0.12);
      grp.traverse((o) => { if (o.isMesh) o.layers.set(3); });
      lobby.group.add(grp);
      lobby.evaDoor = grp;
    }
    const at = lobby.evaDoor.position.clone();
    this._lobbyTap = g.interact.addSphere(at, 0.7, () => this.evaExit(), { maxDist: 2.4 });
  }

  /** what the rest of the game reads off the worn suit (oxygen, the "propellant" = battery) */
  mirror() {
    const pl = this.g.player, S = this.state;
    if (!S) return;
    pl.suitO2 = S.o2 > 0 ? S.o2 : S.reserve > 0 ? 0.004 + 0.02 * S.reserve : 0;
    const B = S.spec.battery;
    pl.suitFuel = Math.min(1, S.flightLeft() / (B.flightSec * (1 + B.spares)));
  }

  // ================================================================== flying
  /**
   * the suit's flight for a step (called by the player in EVA): input along the view (forward,
   * strafe, up), the boosters when armed, the flight computer holding still when nothing is
   * asked. Returns true while thrusting.
   */
  fly(dt, pl, input, camF, camR, camU, gLocal) {
    const S = this.state;
    const k = this.worn;
    if (!S || !k) return false;
    if (pl.inertial && this.eva) return this.flyFree(dt, pl, input, camF, camR, camU);
    const P = S.spec.propulsion, Fn = FINE[k];
    const tk = S.thrustK();
    const want = _v.set(0, 0, 0).addScaledVector(camF, input.moveY || 0).addScaledVector(camR, input.moveX || 0).addScaledVector(camU, input.up || 0);
    const asked = Math.min(1, want.length());
    let thrusting = false;
    this.throttle = 0;
    if ((this.hold || this.autoV) && tk > 0 && !(pl._nearRail && asked < 0.02)) {
      // the flight computer flies what the stick asks (against the ship's frame: his velocity here)
      if (asked > 0.02) want.normalize();
      const boosting = this.boost && (input.moveY || 0) > 0.2;
      const a = _v2.set(0, 0, 0);
      const th = assistAcc(want, asked, boosting, camF, pl.vel, S, Fn, tk, this.autoV, a);
      pl.vel.addScaledVector(a, dt);
      if (boosting && S.asymmetry()) pl.vel.addScaledVector(camR, S.asymmetry() * a.length() * 0.12 * dt);
      this.throttle = th;
      thrusting = th > 0.02;
    } else if (asked > 0.02 && tk > 0) {
      want.normalize();
      const boosting = this.boost && (input.moveY || 0) > 0.2;
      const acc = (boosting ? P.accel : Fn.acc) * tk * asked;
      const vMax = boosting ? P.vMax : Math.max(Fn.v, Math.min(P.vMax, pl.vel.length()));
      pl.vel.addScaledVector(want, acc * dt);
      if (pl.vel.length() > vMax) pl.vel.setLength(vMax);
      // one booster out: the push pulls to one side
      if (boosting && S.asymmetry()) pl.vel.addScaledVector(camR, S.asymmetry() * acc * 0.12 * dt);
      this.throttle = boosting ? asked * tk : asked * 0.15;
      thrusting = true;
    } else if (this.hold && tk > 0 && !(pl._nearRail)) {
      // the flight computer: hold still against what we are measured against (the ship's frame)
      const v = pl.vel.length();
      if (v > 0.005) {
        const acc = (this.boost && v > Fn.v ? P.accel : P.damp) * tk;
        const dv = Math.min(v, acc * dt);
        pl.vel.addScaledVector(pl.vel.clone().normalize(), -dv);
        this.throttle = Math.min(1, dv / Math.max(1e-4, P.accel * dt)) * (this.boost ? 1 : 0.15);
        thrusting = v > 0.2;
      }
    }
    pl.vel.addScaledVector(gLocal, dt);
    return thrusting;
  }

  // ================================================================== out in space: his own inertia
  /**
   * The frame the player's coordinates are in (B-29's; H8's while it flies alone): its pose and
   * velocity in space, and where its origin sits in those coordinates
   */
  frameOf() {
    const g = this.g, solo = !!(g.h8 && g.h8.solo), f = solo ? g.h8.flight : g.flight;
    return { pos: f.pos, vel: f.vel, quat: f.quat, off: solo ? H8S.dockAt : ZERO, solo };
  }

  toEci(F, local, out) { return out.copy(local).sub(F.off).applyQuaternion(F.quat).add(F.pos); }

  toLocal(F, eci, out) { return out.copy(eci).sub(F.pos).applyQuaternion(_qe.copy(F.quat).invert()).add(F.off); }

  /** free in space in the suit (not in a ring, not being towed, not climbing in or out of it) */
  inertialNow(pl) {
    const g = this.g;
    return !!(pl.suit && pl.outside && !this.seq && pl.state !== 'seated' && pl.state !== 'dead' && !(g.docking && g.docking.inRing));
  }

  /**
   * Before the player's step (sdt: the game's step): out in space his state is his own. The frame
   * turned under him: his body and his look stay pointing where they did in space (unless he has
   * a hand on a rail: then he turns with the hull)
   */
  preStep(pl, sdt) {
    const on = this.inertialNow(pl);
    pl.inertial = on;
    if (!on) { this.eva = null; return; }
    const F = this.frameOf();
    let E = this.eva;
    if (!E || E.solo !== F.solo) {
      // (taken where he is now: the frame has already made this step's move, and so has he)
      this.eva = { p: this.toEci(F, pl.pos, new THREE.Vector3()), v: pl.vel.clone().applyQuaternion(F.quat).add(F.vel), q: F.quat.clone(), solo: F.solo, dt: sdt, vCap: 0, fresh: true };
      return;
    }
    E.dt = sdt;
    // D = q_now^-1 q_before: what the frame's turn does to a direction fixed in space (however
    // slowly it turns: the orbit's own frame goes round once an orbit)
    _qe2.copy(F.quat).invert().multiply(E.q);
    if (!pl._nearRail && Math.abs(_qe2.w) < 1 - 1e-15) {
      const Lq = pl.viewQuat(new THREE.Quaternion()).premultiply(_qe2);
      pl.up.applyQuaternion(_qe2).normalize();
      _qe.copy(pl.frameQuat(new THREE.Quaternion())).invert().multiply(Lq);
      _eu.setFromQuaternion(_qe, 'YXZ');
      pl.pitch = Math.max(-1.5, Math.min(1.5, _eu.x)); pl.yaw = _eu.y; pl.roll = _eu.z;
    }
    E.q.copy(F.quat);
  }

  /** his thrusters in space: the push along his view, gravity, then the step it makes in the frame */
  flyFree(dt, pl, input, camF, camR, camU) {
    const S = this.state, k = this.worn, E = this.eva, F = this.frameOf();
    const P = S.spec.propulsion, Fn = FINE[k], tk = S.thrustK();
    // (the game's step: with time sped up he keeps up with the world)
    const h = Math.max(dt, E.dt || dt);
    // held in the arms of a station's rescue craft: he goes where it goes
    if (this.rescuer.heldAt(E.p, E.v)) {
      E.fresh = false;
      this.throttle = 0;
      // (the tug moves on later in the frame, after him: hold him where its arm will be)
      E.p.addScaledVector(E.v, dt);
      pl.vel.copy(this.toLocal(F, E.p, _e1)).sub(pl.pos).divideScalar(Math.max(1e-4, dt));
      return false;
    }
    const want = _e1.set(0, 0, 0).addScaledVector(camF, input.moveY || 0).addScaledVector(camR, input.moveX || 0).addScaledVector(camU, input.up || 0);
    const asked = Math.min(1, want.length());
    // (against the vessel: the speed of its frame where he is — its slow turn adds next to nothing)
    // (B-29 on its way to him: the suit holds its own course, not the ship's, or the ship could
    // never close on it; once B-29 is here it matches the ship again for the boarding)
    const coming = !!(this.rescuer && this.rescuer.approaching && this.rescuer.approaching());
    if (coming && !this.holdRef) this.holdRef = E.v.clone();
    else if (!coming) this.holdRef = null;
    const rel = _e2.copy(E.v).sub(this.holdRef || F.vel);
    const a = _e3.set(0, 0, 0);
    let thrusting = false;
    this.throttle = 0;
    E.vCap = 0;
    if ((this.hold || this.autoV) && tk > 0 && !(pl._nearRail && asked < 0.02)) {
      // the flight computer flies what the stick asks, against the vessel (its frame's motion here)
      if (asked > 0.02) want.normalize();
      want.applyQuaternion(F.quat);
      const boosting = this.boost && (input.moveY || 0) > 0.2;
      const fwdE = _v2.copy(camF).applyQuaternion(F.quat);
      const autoE = this.autoV ? _v.copy(this.autoV).applyQuaternion(F.quat) : null;
      const th = assistAcc(want, asked, boosting, fwdE, rel, S, Fn, tk, autoE, a);
      if (boosting && S.asymmetry()) a.addScaledVector(_e1.copy(camR).applyQuaternion(F.quat), S.asymmetry() * a.length() * 0.12);
      this.throttle = th;
      thrusting = th > 0.02;
      E.vCap = boosting || rel.length() > Fn.v * 1.2 ? P.vMax : 0;
    } else if (asked > 0.02 && tk > 0) {
      want.normalize().applyQuaternion(F.quat);
      const boosting = this.boost && (input.moveY || 0) > 0.2;
      const acc = (boosting ? P.accel : Fn.acc) * tk * asked;
      a.addScaledVector(want, acc);
      // one booster out: the push pulls to one side
      if (boosting && S.asymmetry()) a.addScaledVector(_e1.copy(camR).applyQuaternion(F.quat), S.asymmetry() * acc * 0.12);
      this.throttle = boosting ? asked * tk : asked * 0.15;
      thrusting = true;
      // (the suit's computer takes him no faster than its top speed against his vessel)
      E.vCap = boosting ? P.vMax : Math.max(Fn.v, Math.min(P.vMax, rel.length()));
    } else if (pl._nearRail) {
      // a hand on a rail: the hull carries him (his grip takes up what he had against it)
      E.v.copy(F.vel).addScaledVector(rel, Math.exp(-h * 2.5));
    } else if (this.hold && tk > 0) {
      // asked to hold still against the vessel: the thrusters brake him, taking the time and the
      // charge it costs
      const v = rel.length();
      if (v > 0.005) {
        const acc = (this.boost && v > Fn.v ? P.accel : P.damp) * tk;
        const dv = Math.min(v, acc * h);
        a.addScaledVector(rel, -dv / (v * h));
        this.throttle = Math.min(1, dv / Math.max(1e-4, P.accel * h)) * (this.boost ? 1 : 0.15);
        thrusting = v > 0.2;
      }
    }
    // gravity (he falls round the Earth as everything else does) and his push
    E.v.addScaledVector(gravE(E.p, _e1).add(a), h);
    if (E.vCap) {
      const r2 = _e2.copy(E.v).sub(F.vel), sp = r2.length();
      if (sp > E.vCap) E.v.copy(F.vel).addScaledVector(r2, E.vCap / sp);
    }
    // (the step he was taken up on was already made with the frame)
    if (E.fresh) E.fresh = false;
    else E.p.addScaledVector(E.v, h);
    // where that is in the frame now: the step his body takes there (what is in the way stops it)
    pl.vel.copy(this.toLocal(F, E.p, _e1)).sub(pl.pos).divideScalar(Math.max(1e-4, dt));
    return thrusting;
  }

  /** after the player's step: where he actually got to (a hull in his way: its push is his now) */
  afterMove(pl) {
    const E = this.eva;
    if (!E || !pl.inertial) return;
    const F = this.frameOf();
    const at = this.toEci(F, pl.pos, _e1);
    const miss = _e2.copy(at).sub(E.p);
    if (miss.lengthSq() > 1e-10) { E.v.addScaledVector(miss, 1 / Math.max(1e-3, E.dt || 0.016)); E.p.copy(at); }
  }

  /** the player was moved in the frame (pushed out of something, a bounce): his state follows */
  syncEci(pl, dvLocal = null) {
    const E = this.eva;
    if (!E) return;
    const F = this.frameOf();
    this.toEci(F, pl.pos, E.p);
    if (dvLocal) E.v.add(_e1.copy(dvLocal).applyQuaternion(F.quat));
  }

  /** his speed against the vessel he is measured against */
  relSpeed() {
    const pl = this.g.player, E = this.eva;
    return E && pl.inertial ? E.v.distanceTo(this.frameOf().vel) : pl.vel.length();
  }

  // ================================================================== heat
  /** an engine's flame on him (q: its heat; toward: the way to its axis, ECI): the suit burns */
  flameOn(q, dt, toward) {
    const S = this.state, pl = this.g.player, g = this.g;
    if (!S || this.seq) return;
    // into the suit's own frame (x right, y up, z back)
    const tl = toward.clone().applyQuaternion(_qe.copy(this.frameOf().quat).invert());
    if (tl.lengthSq() < 1e-8) tl.set(0, 0, -1);
    tl.normalize();
    const f = _v.set(0, 0, -1).applyQuaternion(pl.lookQuat); f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    const r = _v2.crossVectors(f, V(0, 1, 0)).normalize();
    S.heat(q, dt, { x: tl.dot(r), y: tl.y, z: -tl.dot(f) });
    // the glare through the visor (its auto-shade takes the worst of it)
    g.engine.grade.set('uFlash', Math.max(g.engine.grade.get('uFlash'), Math.min(0.5, q * 0.045) * (this.sunVisor > 0.5 ? 0.35 : 1)));
    if (q > 0.25) this.hud.event('heat');
    if (q > 0.8) { const h8 = this.worn === 'h8' && g.h8; if (h8) g.h8.say('hachi_suit_flame', {}, { minGap: 12, force: true }); else g.asphalt.say('suit_flame', {}, { minGap: 12, force: true }); }
  }

  // ================================================================== knocks
  /** the player's collision: lost (the velocity the contact took away), real (what was left) */
  contact(pl, lost, real) {
    const S = this.state;
    if (!S || this.seq) return;
    const L = lost.length();
    if (L < 0.6) return;
    // the contact normal points from the suit into what it met (the way the lost velocity went)
    const n = lost.clone().normalize();
    const relVel = lost.clone().add(real);
    const { vn, vt } = contactSpeeds(relVel, n.clone().negate());
    // into the suit's own frame (x right, y up, z back)
    const f = _v.set(0, 0, -1).applyQuaternion(pl.lookQuat); f.y = 0; f.normalize();
    const r = _v2.crossVectors(f, V(0, 1, 0)).normalize();
    const nS = { x: n.dot(r), y: n.y, z: -n.dot(f) };
    const out = S.impact({ vn: Math.max(vn, L * 0.9), vt, n: nS, otherMass: Infinity, hard: 1, sharp: this.g.damage && this.g.damage.peels.length ? 0.15 : 0 });
    if (out.crack || out.breach || out.systems.length) this.g.shake = Math.max(this.g.shake, Math.min(2, 0.4 + out.g / 20));
    this.g.audio.impact(pl.eyeLocal, Math.min(0.6, 0.1 + out.eN / 4e4));
  }

  onEvent(kind, ev, info) {
    if (kind !== this.worn) return;
    this.hud.event(ev, info);
    const g = this.g, h8 = this.worn === 'h8' && g.h8;
    const say = (k, p) => (h8 ? g.h8.say(k, p || {}, { minGap: 4, force: true }) : g.asphalt.say(k, p || {}, { minGap: 4, force: true }));
    if (ev === 'breach') say('suit_breach', { part: PARTS[info] ? PARTS[info].jp : info });
    else if (ev === 'crack' && info === 'visor') say('suit_visor_crack');
    else if (ev === 'battery_swap') say('suit_batt_swap');
    else if (ev === 'battery_dead' || ev === 'shutdown') say('suit_dead');
    else if (ev === 'o2_reserve') say('suit_o2_reserve');
    else if (ev === 'systems') say('suit_systems', { list: info.split(',').map((s) => SYSTEMS_JP[s] || s).join('・') });
  }

  // ================================================================== the lamps
  updateLight() {
    const g = this.g, pl = g.player, S = this.state;
    const on = !!S && this.lamp && S.sys.lamp > 0.15 && !S.shutdown && S.battery > 0;
    this.light.intensity = on ? 1.3 * Math.min(1, S.sys.lamp * 1.3) : 0;
    if (on) {
      this.light.position.copy(pl.eyeLocal).add(V(0, 0.08, 0));
      this.light.target.position.copy(pl.eyeLocal).add(V(0, 0, -1).applyQuaternion(pl.lookQuat));
      this.light.target.updateMatrixWorld();
    }
  }

  // ================================================================== calling for help
  /** who: 'b29' | 'h8' | 'station' (suitRescue.js: whoever is called really comes) */
  call(who) { this.rescuer.call(who); }

  nearestStation() {
    const g = this.g;
    const me = this.kaitoEci(new THREE.Vector3());
    let best = null;
    for (const s of g.stations.list) {
      if (s.dmg && (s.dmg.status === 'destroyed' || s.dmg.status === 'failed')) continue;
      const d = s.pos.distanceTo(me);
      if (!best || d < best.dist) best = { st: s, dist: d };
    }
    return best;
  }

  /** the player's ECI position (in whichever frame he is: B-29's, or H8's while it flies alone) */
  playerEci(out = new THREE.Vector3()) { return this.kaitoEci(out); }

  /** where he is in space and how he moves (ECI): his own state out in space, else his frame's */
  kaitoEci(pos, vel = null) {
    const pl = this.g.player, F = this.frameOf(), E = this.eva;
    if (E && pl.inertial) { pos.copy(E.p); if (vel) vel.copy(E.v); return pos; }
    this.toEci(F, pl.pos, pos);
    if (vel) vel.copy(pl.vel).applyQuaternion(F.quat).add(F.vel);
    return pos;
  }

  /**
   * H8 came for him: from now on he flies in H8's coordinates (as one gone out of it alone) — the
   * same place in space, the same motion, the same look
   */
  transferToH8() {
    const g = this.g, pl = g.player, h = g.h8;
    if (!h || h.solo) return;
    const F0 = this.frameOf();
    const p = this.kaitoEci(new THREE.Vector3(), _e3);
    const v = _e3.clone();
    const Lq = pl.viewQuat(new THREE.Quaternion());
    h.crew = true;
    const F1 = this.frameOf();
    if (!F1.solo) { h.crew = false; return; }
    const D = new THREE.Quaternion().copy(F1.quat).invert().multiply(F0.quat);
    pl.teleport(this.toLocal(F1, p, new THREE.Vector3()));
    pl.vel.copy(v).sub(F1.vel).applyQuaternion(_qe.copy(F1.quat).invert());
    Lq.premultiply(D);
    pl.up.applyQuaternion(D).normalize();
    _qe.copy(pl.frameQuat(new THREE.Quaternion())).invert().multiply(Lq);
    _eu.setFromQuaternion(_qe, 'YXZ');
    pl.pitch = Math.max(-1.5, Math.min(1.5, _eu.x)); pl.yaw = _eu.y; pl.roll = _eu.z;
    this.eva = null;
  }

  /** a call under way (suitRescue.js) */
  updateRescue(dt) { this.rescuer.update(dt); }

  // ================================================================== the suit seen from outside
  /** out on a walk: the worn suit drawn where Kaito is (seen by another camera) */
  updateAvatar(dt, external) {
    const g = this.g, pl = g.player, k = this.worn;
    const show = !!k && pl.outside && external;
    if (!show) { if (this.avatar) this.avatar.root.visible = false; return; }
    if (!this.avatar || this.avatar.spec.id !== k) {
      if (this.avatar) this.avatar.dispose();
      this.avatar = buildSuit(SUITS[k], { wearer: true, jointed: true });
      this.avatar.root.traverse((o) => { if (o.isMesh) { o.layers.set(3); o.layers.enable(2); } });
      g.shipVis.root.add(this.avatar.root);
    }
    const A = this.avatar;
    A.root.visible = true;
    // his body's attitude: floating free the whole of him turns as he looks round (the helmet is
    // part of the hard torso); on his feet, his heading and a little of the look's pitch
    const free = !!pl.inertial;
    if (free) pl.viewQuat(_qAv);
    else _qAv.setFromAxisAngle(AX_Y, pl.yaw).multiply(_q2.setFromAxisAngle(AX_X, Math.max(-0.6, Math.min(0.6, pl.pitch * 0.5))));
    A.root.quaternion.copy(_qAv);
    // (turned about his middle, not his feet)
    A.root.position.set(0, -0.95, 0).applyQuaternion(_qAv).add(pl.pos);
    this.moveLimbs(dt, free, pl);
    const S = this.state;
    const b = this.throttle;
    A.setBoost(dt, b * (S ? S.boosterL : 1), b * (S ? S.boosterR : 1));
    A.setLamps(this.lamp && S && S.sys.lamp > 0.15);
    A.setSunVisor(this.sunVisor);
    if (S) A.setDamage(S);
    A.tick(performance.now() / 1000);
    if (g.shipVis.envSpace) A.setEnv(g.shipVis.envSpace);
  }

  /**
   * the avatar's arms and legs on their joints (suitRig.js): swung by what his body does — the
   * push of his thrusters, a knock against the hull, his turning (in the suit's frame) — about the
   * posture he holds (floating, flying on the boosters, a hand on a rail, standing)
   */
  moveLimbs(dt, free, pl) {
    const g = this.g, A = this.avatar;
    if (!this.rig || this.rig.A !== A) { this.rig = new SuitRig(A); this.rigM = null; }
    const R = this.rig;
    const h = Math.min(0.1, dt * (g.timeScale || 1));
    if (!(h > 0)) return;
    const F = this.frameOf(), E = this.eva;
    // his attitude in space, and his velocity (free: in space; on his feet: in the ship's frame)
    _qW.copy(F.quat).multiply(_qAv);
    const vNow = free && E ? E.v : pl.vel;
    const pose = !free ? 'stand' : this.throttle > 0.25 && this.boost ? 'boost' : pl._nearRail ? 'rail' : 'float';
    let M = this.rigM;
    const now = g.time;
    // (first seen, or a jump: straight into his posture, nothing swung)
    if (!M || M.free !== free || now - M.at > 400 || M.p.distanceTo(pl.pos) > 3) {
      M = this.rigM = { free, at: now, p: pl.pos.clone(), v: vNow.clone(), q: _qW.clone(), w: V(0, 0, 0), wPrev: V(0, 0, 0), acc: V(0, 0, 0), al: V(0, 0, 0) };
      R.reset(pose);
      return;
    }
    M.at = now; M.p.copy(pl.pos);
    // the push on him (proper acceleration: what changed his velocity besides gravity)
    const a = _a1.copy(vNow).sub(M.v).divideScalar(h);
    if (free && E) a.sub(gravE(E.p, _a2)).applyQuaternion(_q.copy(_qW).invert());
    else a.sub(g.gLocal).applyQuaternion(_q.copy(_qAv).invert());
    M.v.copy(vNow);
    if (a.length() > 60) a.setLength(60);
    M.acc.lerp(a, 1 - Math.exp(-h / 0.05));
    // his turning (smoothed: the look turns at once, a body cannot), and how fast that changes
    _q.copy(M.q).invert().multiply(_qW);
    if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
    const ang = 2 * Math.acos(Math.min(1, _q.w)), sn = Math.sqrt(Math.max(0, 1 - _q.w * _q.w));
    const w = sn > 1e-6 ? _a2.set(_q.x / sn, _q.y / sn, _q.z / sn).multiplyScalar(ang / h) : _a2.set(0, 0, 0);
    if (w.length() > 6) w.setLength(6);
    M.q.copy(_qW);
    M.wPrev.copy(M.w);
    M.w.lerp(w, 1 - Math.exp(-h / 0.12));
    const al = _a1.copy(M.w).sub(M.wPrev).divideScalar(h);
    if (al.length() > 25) al.setLength(25);
    M.al.lerp(al, 1 - Math.exp(-h / 0.05));
    R.step(h, M.acc, M.w, M.al, pose);
  }

  // ================================================================== save
  serialize() {
    return { h8: this.st.h8.serialize(), b29: this.st.b29.serialize(), cam: this.cam.serialize(), boost: this.boost, hold: this.hold, holdV: 3, lamp: this.lamp };
  }

  restore(s) {
    if (!s) return;
    this.st.h8.restore(s.h8); this.st.b29.restore(s.b29);
    this.cam.restore(s.cam);
    // (the automatic stop is off unless it was chosen: older saves had it on by default)
    this.boost = !!s.boost; this.hold = s.holdV === 3 ? s.hold !== false : true; this.lamp = !!s.lamp;
    this.mirror();
  }

  /** the repair dock: both suits as new */
  repairAll() { for (const S of Object.values(this.st)) { S.repair(); S.service(); } this.mirror(); }
}
