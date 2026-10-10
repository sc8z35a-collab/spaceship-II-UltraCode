// Calling for help from the suit — and help that comes, under its own power, where it can be
// watched coming (a marker on the visor, the distance, the time left):
//  - B-29 flies over on its autopilot with Kaito himself as the target, stops thirty metres off,
//    pumps its airlock down and swings its outer hatch open; the suit's flight computer brings him
//    in when he asks (or as soon as he is at the hatch), the hatch shuts behind him and the airlock
//    fills again;
//  - H8 casts off if it has to and HACHI flies it over; once it holds beside him he flies on in
//    its coordinates (as one gone out of it), its neck hatch opens and the computer takes him up
//    the shaft;
//  - the nearest station launches its rescue craft: it flies out on the same planet-aware guidance
//    as HACHI, swings its collar round to face him, takes him in its arms and carries him — gently,
//    there is a person on its nose — to B-29's hatch (or, B-29 lying at a station, to that
//    station's EVA hatch), lets him go and goes home.
import * as THREE from 'three';
import { Flight } from '../ship/flight.js';
import { guidance, ratesNose } from '../h8/h8Pilot.js';
import { tugModel, TUG_NOSE } from '../h8/rescueTug.js';
import { assignLayers } from '../core/layers.js';
import { plumeAir } from '../fx/enginePlume.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _k = new THREE.Vector3(), _kv = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
// where he is held on the tug's nose: just in front of its collar (the tug's own axes)
const CAP = V(0, 0, -(TUG_NOSE + 0.75));
const BOARD_V = 2.4;          // m/s: the computer's pace bringing him in

/** the way to a point at a pace that comes to rest on it (a: braking, vmax), as a velocity */
function closeIn(err, a, vmax, out) {
  const d = err.length();
  if (d < 1e-4) return out.set(0, 0, 0);
  return out.copy(err).multiplyScalar(Math.min(vmax, Math.sqrt(2 * a * d), d * 0.9) / d);
}

/** the station's rescue craft, sent out for a suit */
class SuitTug {
  constructor(rescue, st) {
    this.r = rescue;
    this.g = rescue.g;
    this.st = st;
    const g = this.g;
    this.f = new Flight({ normalMax: 600, ultraMax: 6000, aMax: 32, mass: 18000, CdA: 8, comfortK: 4, rampK: 6, turnK: 5, tank: { cap: 1e7, ve: 6e4 } });
    // out of the station's H8 port with the station's motion and attitude
    const pose = g.docking.stationPose(st, g.time);
    const p0 = g.stations.h8PortOf(st).clone().add(V(0, 15, 0)).applyQuaternion(pose.quat).add(pose.pos);
    const f = this.f;
    f.pos.copy(p0);
    g.docking.frameVel(st, pose, p0, f.vel);
    f.hRef.crossVectors(pose.pos, pose.vel).normalize();
    f.qRel.copy(f.lvlhQuat(f.pos, new THREE.Quaternion()).invert().multiply(pose.quat));
    f.updateAttitude();
    f.autopilot = { vRel: V(0, 0, 0), wDes: V(0, 0, 0), aff: null, fast: true };
    this.state = 'out';           // out | close | grab | carry | home
    this.t = 0; this.tState = 0;
    this.eta = 0;
    this.dist = Infinity;
    this.mesh = tugModel();
    g.engine.scene.add(this.mesh);
  }

  /** the point he is held at (ECI) */
  capture(out) { return out.copy(CAP).applyQuaternion(this.f.quat).add(this.f.pos); }

  setState(s) { this.state = s; this.tState = 0; }

  /** per simulation step */
  step(dt) {
    const g = this.g, f = this.f, R = this.r;
    this.t += dt; this.tState += dt;
    f.step(dt, null, (pos) => g.terrainAt(pos));
    const K = R.s.kaitoEci(_k, _kv);
    const A = f.autopilot;
    if (this.state === 'out') {
      // the long leg: straight for him at a rescue craft's pace (round the planet if need be)
      const gd = guidance(f, { pos: K, vel: _kv, tether: false }, { vmax: 3000, a: 18, standoff: 80 });
      A.vRel.copy(gd.vRel);
      A.tau = undefined;
      const rel = _a.copy(K).sub(f.pos);
      this.dist = rel.length();
      ratesNose(f.quat, gd.v > 2 ? gd.moveDir : rel.normalize(), 40 * Math.PI / 180, A.wDes, 1.2);
      this.eta = gd.eta + 70 + this.carryEta(K);
      if (this.dist < 160) this.setState('close');
    } else if (this.state === 'close') {
      // its collar round to face him, in to arm's length, matching his drift
      const cap = this.capture(_a);
      const err = _b.copy(K).sub(cap);
      this.dist = err.length();
      const v = closeIn(err, 1.4, 18, _c).add(_kv);
      A.vRel.copy(v).sub(f.refVelocity(f.pos, new THREE.Vector3()));
      A.tau = 0.5;
      ratesNose(f.quat, _a.copy(K).sub(f.pos).normalize(), 30 * Math.PI / 180, A.wDes, 1.6);
      this.eta = this.dist / 4 + 4 + this.carryEta(K);
      const relV = _a.copy(f.vel).sub(_kv).length();
      if (this.dist < 0.55 && relV < 0.4) {
        this.setState('grab');
        R.grabbed(this);
      }
    } else if (this.state === 'grab') {
      // the arms close round him (he rides on its nose from here)
      A.vRel.copy(_kv).sub(f.refVelocity(f.pos, new THREE.Vector3()));
      A.wDes.set(0, 0, 0);
      if (this.tState > 1.4) this.setState('carry');
    } else if (this.state === 'carry') {
      const D = R.tugDest(_c, _kv);
      if (!D) { this.setState('home'); R.released(this, null); return; }
      // (the craft's own point that puts him on the destination)
      const capOff = _b.copy(CAP).applyQuaternion(f.quat);
      const tgt = _a.copy(_c).sub(capOff);
      const err = _b.copy(tgt).sub(f.pos);
      const d = err.length();
      this.dist = d;
      if (d > 400) {
        const gd = guidance(f, { pos: tgt, vel: _kv, tether: false }, { vmax: 450, a: 2.5, standoff: 0 });
        A.vRel.copy(gd.vRel);
        A.tau = undefined;
        ratesNose(f.quat, gd.v > 2 ? gd.moveDir : err.clone().normalize(), 12 * Math.PI / 180, A.wDes, 1.0);
        this.eta = gd.eta + 40;
      } else {
        const v = closeIn(err, 0.8, 12, _a).add(_kv);
        A.vRel.copy(v).sub(f.refVelocity(f.pos, new THREE.Vector3()));
        A.tau = 0.5;
        // (him facing the way in as they come up to it)
        if (D.face) ratesNose(f.quat, D.face, 10 * Math.PI / 180, A.wDes, 1.0); else A.wDes.set(0, 0, 0);
        this.eta = d / 3 + 3;
        const relV = _a.copy(f.vel).sub(_kv).length();
        if (d < 0.5 && relV < 0.3) { this.setState('home'); R.released(this, D); }
      }
    } else if (this.state === 'home') {
      // back off, then away home; gone once well clear
      const away = _a.copy(f.pos).sub(K);
      const d = away.length();
      this.dist = d;
      const v = away.normalize().multiplyScalar(Math.min(40, 2 + this.tState * 2));
      A.vRel.copy(v).add(_kv).sub(f.refVelocity(f.pos, new THREE.Vector3()));
      A.tau = 1.0;
      A.wDes.set(0, 0, 0);
      if (d > 4000 || this.tState > 150) R.tugGone(this);
    }
  }

  /** after the pick-up: how long the carry should take (s) */
  carryEta(K) {
    const D = this.r.tugDest(_c, null);
    if (!D) return 0;
    const L = _c.distanceTo(K);
    return L > 400 ? 2 * Math.sqrt(L / 2.5) + 40 : L / 3 + 20;
  }

  updateVisual(dt, origin, camWorld) {
    const f = this.f, m = this.mesh;
    const rel = _a.copy(f.pos).sub(origin);
    m.matrix.compose(rel, f.quat, V(1, 1, 1));
    m.matrixWorld.copy(m.matrix);
    m.updateMatrixWorld(true);
    const d = rel.distanceTo(camWorld);
    m.traverse((o) => { if (o.isMesh) assignLayers(o, Math.max(0, d - 12), d + 12); });
    const thr = _b.copy(f.thrustAcc).applyQuaternion(_q.copy(f.quat).invert());
    const burn = this.state === 'grab' ? 0 : Math.min(1.2, Math.max(0, -thr.z) / 14 + thr.length() / 60);
    const P = m.userData.plume;
    P.update(dt, burn, plumeAir(f.rho || 0), 0);
    P.setDistance(d);
  }

  dispose() {
    this.g.engine.scene.remove(this.mesh);
    this.mesh.userData.plume.dispose();
  }
}

export class SuitRescue {
  constructor(suits) {
    this.s = suits;
    this.g = suits.g;
    this.tug = null;              // the station's craft while it is out
    this.hold = null;             // the craft holding him: { p, v } each step
  }

  get R() { return this.s.rescue; }
  set R(v) { this.s.rescue = v; }

  say(key, p = {}) { this.g.asphalt.say(key, p, { force: true }); }

  // ------------------------------------------------------------------ calling
  call(who) {
    const g = this.g, S = this.s.state;
    if (!S) return;
    if (S.sys.radio < 0.15 || S.shutdown) { this.s.hud.event('radio_dead'); return; }
    // one call at a time: a new one calls off the last
    this.cancel(true);
    const solo = !!(g.h8 && g.h8.solo);
    if (who === 'b29') this.callB29(solo);
    else if (who === 'h8') this.callH8(solo);
    else if (who === 'station') this.callStation();
  }

  callB29(solo) {
    const g = this.g, ap = g.autopilot, pl = g.player;
    if (g.damage && g.damage.broken) { this.say('suit_b29_dead'); return; }
    if (solo) {
      // out from H8 alone: B-29 is brought over to H8 (and him)
      const h = g.h8;
      if (h.callB29) h.callB29();
      this.R = { who: 'b29', via: 'h8', t: 0, phase: 'coming', dist: g.flight.pos.distanceTo(h.flight.pos), eta: 0 };
      this.say('suit_call_b29_h8');
      return;
    }
    const d = pl.pos.distanceTo(g.hatch.o.center);
    if (d < 32) {
      // B-29 is right here: the hatch is opened for him
      this.R = { who: 'b29', t: 0, phase: 'here', dist: d, eta: 0 };
      this.say('suit_call_near_open');
      return;
    }
    const s = this.s;
    const obj = {
      id: 'kaito', name: 'カイト', kind: 'target', tether: false, standoff: 30,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      posOf(t, pos, vel) { s.kaitoEci(pos, vel || _kv); return pos; },
    };
    s.kaitoEci(obj.pos, obj.vel);
    if (!ap.engageObj(obj)) { this.say('suit_b29_cant'); return; }
    this.b29Target = obj; this.b29Ap = ap;
    this.R = { who: 'b29', t: 0, phase: 'coming', obj, dist: d, eta: 0 };
    this.say('suit_call_b29', { m: Math.round(d) });
  }

  callH8(solo) {
    const g = this.g, h = g.h8;
    if (!h || h.mode === 'lost' || h.mode === 'pod') { this.say('suit_call_noh8'); return; }
    const R = this.R = { who: 'h8', t: 0, phase: 'coming', dist: 0, eta: 0, solo };
    h.callToKaito(16, () => { R.arrived = true; });
    h.say('hachi_suit_call', {}, { force: true });
  }

  callStation() {
    const st = this.s.nearestStation();
    if (!st) { this.say('suit_call_nost'); return; }
    this.tug = new SuitTug(this, st.st);
    this.R = { who: 'station', t: 0, phase: 'coming', station: st, dist: st.dist, eta: 0 };
    this.say('suit_call_station', { name: st.st.name, min: Math.max(1, Math.round((st.dist / 1500 + 120) / 60)) });
  }

  /** called off (a new call, him back aboard, the suit dead) */
  cancel(silent = false) {
    const g = this.g, R = this.R;
    if (R && R.who === 'b29' && R.obj && g.autopilot.target === R.obj) g.autopilot.disengage(true);
    if (this.tug && this.tug.state !== 'home') { this.tug.setState('home'); }
    this.hold = null;
    this.s.autoV = null;
    this.R = null;
    if (!silent && R) this.say('suit_rescue_off');
  }

  // ------------------------------------------------------------------ the tug's hand-offs
  grabbed(tug) {
    const R = this.R;
    this.hold = { tug };
    if (R) { R.phase = 'carried'; R.towing = true; }
    this.g.audio.mech(this.g.player.eyeLocal, 'clamp', { open: false, direct: true });
    this.g.shake = Math.max(this.g.shake || 0, 0.25);
    this.say('suit_tug_grab', { name: R ? R.station.st.name : '' });
  }

  /** where the craft is to take him: B-29's hatch, the EVA hatch of the station B-29 lies at, or
   * nowhere (no B-29 left): the point (ECI) into out, its velocity into vel; { face, kind } */
  tugDest(out, vel) {
    const g = this.g, s = this.s;
    if (g.damage && g.damage.broken) return null;
    const D = g.docking;
    if (D && D.state === 'docked' && D.station && s.evaHatchOf) {
      // (the station's EVA hatch: its point is in the station's own frame, its lid facing up)
      const H = s.evaHatchOf(D.station);
      if (!H || !H.local) return null;
      const pose = D.stationPose(D.station, g.time);
      const n = V(0, 1, 0).applyQuaternion(pose.quat);
      out.copy(H.local).applyQuaternion(pose.quat).add(pose.pos).addScaledVector(n, 1.8);
      if (vel) vel.copy(pose.vel);
      return { kind: 'station', st: D.station, face: n.negate() };
    }
    const o = g.hatch.o;
    const F = { pos: g.flight.pos, vel: g.flight.vel, quat: g.flight.quat, off: _b.set(0, 0, 0) };
    s.toEci(F, _a.copy(o.center).addScaledVector(o.normal, 2.2), out);
    if (vel) vel.copy(g.flight.vel);
    return { kind: 'b29', face: V(0, 0, 0).copy(o.normal).negate().applyQuaternion(g.flight.quat) };
  }

  released(tug, D) {
    this.hold = null;
    const R = this.R;
    if (!R) return;
    R.towing = false;
    if (!D) { this.say('suit_tug_nowhere'); this.R = null; return; }
    if (D.kind === 'station') {
      this.say('suit_tug_lobby', { name: D.st.name });
      this.R = null;
      this.s.evaEnter && this.s.evaEnter(D.st);
      return;
    }
    // at B-29's hatch: in he goes
    this.say('suit_tug_release');
    R.who = 'b29'; R.phase = 'here'; R.fromTug = true;
  }

  tugGone(tug) {
    if (this.tug !== tug) return;
    tug.dispose();
    this.tug = null;
  }

  /** the craft holding him this step: his position and velocity in space, or null */
  /** B-29's autopilot closing on him (the suit then holds its own course) */
  approaching() {
    const ap = this.b29Ap;
    return !!(ap && this.b29Target && ap.target === this.b29Target && ap.state !== 'hold' && ap.state !== 'off');
  }

  heldAt(p, v) {
    if (!this.hold || !this.tug) return null;
    this.tug.capture(p);
    v.copy(this.tug.f.vel);
    return p;
  }

  // ------------------------------------------------------------------ per step
  update(dt) {
    const g = this.g, pl = g.player, s = this.s;
    if (this.tug) this.tug.step(dt);
    const R = this.R;
    if (!R) return;
    R.t += dt;
    // back aboard (or never out): done
    if (!pl.suit || (!pl.outside && R.phase !== 'board' && R.phase !== 'in')) { this.cancel(true); return; }
    if (s.state && (s.state.shutdown || s.state.sys.radio < 0.15) && R.phase === 'coming' && R.who !== 'station') { /* (the ship comes anyway: it was called) */ }
    if (R.who === 'b29') this.updateB29(dt, R);
    else if (R.who === 'h8') this.updateH8(dt, R);
    else if (R.who === 'station') {
      const T = this.tug;
      if (!T) { this.R = null; return; }
      R.dist = T.dist; R.eta = T.eta;
    }
  }

  updateB29(dt, R) {
    const g = this.g, ap = g.autopilot, pl = g.player, s = this.s;
    if (R.via === 'h8') {
      R.dist = g.flight.pos.distanceTo(g.h8.flight.pos);
      R.eta = ap.eta || 0;
      if (ap.state === 'off' && R.t > 2) this.R = null;
      return;
    }
    if (R.phase === 'coming') {
      if (ap.target !== R.obj) { if (R.t > 1) { this.say('suit_rescue_off'); this.R = null; } return; }
      R.dist = ap.dist; R.eta = ap.eta;
      if (ap.state === 'hold' || ap.dist < 48) {
        // here: it stops where it is (the autopilot would back off as he comes) and opens up
        ap.disengage(true);
        R.phase = 'here';
        this.say('suit_b29_here');
      }
      return;
    }
    const o = g.hatch.o;
    R.dist = pl.pos.distanceTo(o.center);
    R.eta = 0;
    if (R.phase === 'here') {
      this.openB29(R);
      R.canBoard = 'B-29';
      // (at the hatch already: the computer takes him in)
      if (R.dist < 2.6 && g.hatch.open > 0.6) this.board();
      return;
    }
    if (R.phase === 'board') {
      this.openB29(R);
      if (this.flyIn(R, g.hatch.open > 0.85)) {
        R.phase = 'in';
        s.autoV = null;
        this.say('suit_b29_in');
      }
      return;
    }
    if (R.phase === 'in') {
      // the hatch shut behind him, the airlock filled
      const h = g.hatch;
      if (h.target > 0.5 && R.t > 0) { h.target = 0; g.audio.mech(o.center, 'hatch', { open: false }); }
      if (h.sealed) {
        if (g.airlockMode !== 'rep' && g.gameplay && g.gameplay.airlockCycle) g.gameplay.airlockCycle('rep');
        this.R = null;
      }
    }
  }

  /** B-29's airlock pumped down and its outer hatch opened for him */
  openB29(R) {
    const g = this.g, h = g.hatch, ls = g.lifeSupport;
    if (h.target > 0.5) return;
    const p = ls.pressure('airlock'), beyond = ls.portAmbient ?? ls.ambient;
    if (Math.abs(p - beyond) <= 4) {
      h.target = 1;
      g.audio.mech(h.o.center, 'hatch', { open: true });
      if (!R.saidOpen) { R.saidOpen = true; this.say('suit_b29_hatch'); }
    } else if (g.airlockMode !== 'dep' && g.gameplay && g.gameplay.airlockCycle && !(g.doors.airlock && g.doors.airlock.open > 0.05)) {
      g.gameplay.airlockCycle('dep');
    }
  }

  updateH8(dt, R) {
    const g = this.g, h = g.h8, s = this.s, pl = g.player;
    if (!h || h.mode === 'lost' || h.mode === 'pod') { this.R = null; return; }
    const K = s.kaitoEci(_k, _kv);
    R.dist = h.flight.pos.distanceTo(K);
    R.eta = h.pilot && h.pilot.eta > 0 ? h.pilot.eta : R.dist / 40;
    if (R.phase === 'coming') {
      if (R.arrived || (R.dist < 34 && R.t > 3)) {
        // beside him: he flies on in H8's coordinates; it holds where it is and opens its neck
        if (!h.solo) s.transferToH8();
        if (h.goal) h.goal('hold');
        R.phase = 'here';
        h.say('hachi_kaito_here', {}, { force: true });
      }
      return;
    }
    if (R.phase === 'here' || R.phase === 'board') {
      // its shaft pumped down and the neck open
      if (h.airlock && h.airlock.mode === 'idle' && h.neckOpen < 0.05) h.airlock.mode = 'dep';
      R.canBoard = 'H8';
      if (R.phase === 'here') {
        const nk = h.neckPF(_a);
        if (pl.pos.distanceTo(nk) < 3.2 && h.neckOpen > 0.9) this.board();
        return;
      }
      if (this.flyIn(R, h.neckOpen > 0.95)) {
        R.phase = 'in';
        s.autoV = null;
        if (h.airlock) h.airlock.mode = 'rep';
        h.say('hachi_kaito_board', {}, { force: true });
        this.R = null;
      }
    }
  }

  // ------------------------------------------------------------------ bringing him in
  /** the visor's button: the computer flies him in */
  board() {
    const g = this.g, R = this.R, pl = g.player;
    if (!R || (R.phase !== 'here')) return;
    R.phase = 'board';
    R.canBoard = null;
    if (R.who === 'b29') {
      const o = g.hatch.o;
      // (out in front of it first if he is round the side, then in along its axis)
      const front = _a.copy(pl.pos).sub(o.center).dot(o.normal);
      R.wp = [];
      if (front < 2) R.wp.push(o.center.clone().addScaledVector(o.normal, 6));
      R.wp.push(o.center.clone().addScaledVector(o.normal, 2.4), o.center.clone().addScaledVector(o.normal, 0.9), o.center.clone().addScaledVector(o.normal, -0.75));
      R.gate = R.wp.length - 2;      // the point that waits for the hatch to be open
    } else {
      const h = g.h8, nk = h.neckPF(new THREE.Vector3()), c = h.centerPF(new THREE.Vector3());
      const side = _a.copy(pl.pos).sub(c).setY(0);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      side.normalize();
      const Rr = h.hullR ? h.hullR() : 4;
      R.wp = [
        c.clone().addScaledVector(side, Rr + 2.5).setY(nk.y - 2.2),
        nk.clone().add(V(0, -2.0, 0)),
        nk.clone().add(V(0, 0.9, 0)),
      ];
      R.gate = 1;
    }
    this.say(R.who === 'b29' ? 'suit_board_b29' : 'suit_board_h8');
  }

  /** along the waypoints at the computer's pace (open: the way in is open); true once in */
  flyIn(R, open) {
    const pl = this.g.player, s = this.s;
    let w = R.wp[0];
    // (the last legs in through B-29's hatch (0.88 m wide) or up H8's neck want him on the axis to
    // the centimetre, tucked up)
    const tight = R.wp.length <= (R.who === 'b29' ? 3 : 2);
    this.tuck = tight;
    while (w && pl.pos.distanceTo(w) < (tight ? 0.3 : 0.4) && (R.wp.length > 1 || open)) {
      if (!w.detour) R.tries = 0;
      R.wp.shift(); R.gate--;
      w = R.wp[0];
    }
    if (!w) { this.tuck = false; return true; }
    // (waiting at the gate for the hatch)
    if (R.gate <= 0 && !open && R.wp.length <= 2) w = R.wp[0];
    // (stuck on something on the way in (a boom, an array, a rim): back off and slip round it, a
    // wider way each time, the other side each time)
    const far = pl.pos.distanceTo(w);
    const waiting = !open && far < 1.2 && (R.gate <= 0 || R.wp.length <= 2);       // (held at the hatch on purpose)
    if (!waiting && R.last && pl.pos.distanceTo(R.last) < 0.003 && far > 0.3) R.stuck = (R.stuck || 0) + 1; else R.stuck = 0;
    R.last = (R.last || new THREE.Vector3()).copy(pl.pos);
    if (R.stuck > 50 && R.wp.length < 14) {
      R.stuck = 0; R.tries = (R.tries || 0) + 1;
      const to = new THREE.Vector3().copy(w).sub(pl.pos).normalize();
      const side = new THREE.Vector3().crossVectors(to, Math.abs(to.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
      if (R.tries % 2 === 0) side.negate();
      const up = new THREE.Vector3().crossVectors(side, to).normalize();
      const k = 1.2 + 0.6 * Math.min(R.tries, 4);
      const dw = pl.pos.clone().addScaledVector(to, -0.8).addScaledVector(side, k).addScaledVector(up, (R.tries % 3 === 0 ? 1 : 0.4) * k);
      dw.detour = true;
      R.wp.unshift(dw);
      R.gate++;
      w = R.wp[0];
    }
    const err = _a.copy(w).sub(pl.pos);
    s.autoV = closeIn(err, 1.6, BOARD_V, s.autoV || new THREE.Vector3());
    return false;
  }

  // ------------------------------------------------------------------ what the visor shows
  /** one line for the visor (or '') */
  text() {
    const R = this.R;
    if (!R) return '';
    const t = (sec) => { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), x = sec % 60; return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m}:${String(x).padStart(2, '0')}`; };
    const dist = (m) => (m >= 10000 ? (m / 1000).toFixed(0) + ' km' : m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m');
    if (R.who === 'b29') {
      if (R.via === 'h8') return `B-29 が H8 へ向かっています ・ ${dist(R.dist)}`;
      if (R.phase === 'coming') return `B-29 接近中 ・ ${dist(R.dist)}${R.eta > 2 ? ' ・ あと ' + t(R.eta) : ''}`;
      if (R.phase === 'here') return this.g.hatch.open > 0.6 ? 'B-29 到着 ・ ハッチ開放 — 乗り込めます' : 'B-29 到着 ・ エアロック減圧中…';
      if (R.phase === 'board') return 'B-29 へ — 自動で乗り込み中';
      return 'B-29 に収容';
    }
    if (R.who === 'h8') {
      if (R.phase === 'coming') return `H8 接近中 ・ ${dist(R.dist)}${R.eta > 2 ? ' ・ あと ' + t(R.eta) : ''}`;
      if (R.phase === 'here') return this.g.h8 && this.g.h8.neckOpen > 0.9 ? 'H8 到着 ・ 下部ハッチ開放 — 乗り込めます' : 'H8 到着 ・ シャフト減圧中…';
      return 'H8 へ — 自動で乗り込み中';
    }
    const T = this.tug, nm = R.station.st.name;
    if (!T) return '';
    if (T.state === 'out') return `${nm} の救助艇 ・ ${dist(T.dist)} ・ あと ${t(T.eta)}`;
    if (T.state === 'close') return `救助艇 接近 ・ ${dist(T.dist)} — 動かないで`;
    if (T.state === 'grab') return '救助艇が確保';
    if (T.state === 'carry') return `救助艇で移送中 ・ あと ${t(T.eta)}`;
    return '';
  }

  /** the rescuer on the visor (beside B-29's and H8's own markers): the craft */
  marker(origin) {
    if (!this.tug || this.tug.state === 'home') return null;
    return { name: '救助艇', p: this.tug.f.pos.clone().sub(origin), d: this.tug.dist };
  }

  updateVisual(dt, origin, camWorld) {
    if (this.tug) this.tug.updateVisual(dt, origin, camWorld);
  }
}
