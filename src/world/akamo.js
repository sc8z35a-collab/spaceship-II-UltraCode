// AKAMO — Shirasagi station's space elevator (akamoProfile.js has the ride itself).
//
// The cabin shuttles between the bottom berth over Shirasagi's core and the top terminal 2,500 km
// up, waiting at each end with its doors open while people get off and on. Kaito boards like
// anyone else: at the bottom from the station (B-29 lying at Shirasagi), walking in through a door.
// Once the doors are shut he rides in the cabin's own frame — the physics of the cabin's room set
// apart from everything else (AK_OFF), the view and the light riding with it, what he feels the
// cabin's push less what the inertial dampers take off it — and at the top he walks out into the
// terminal's hall, the Earth hanging over his head through its glass dome.
//
// The passengers are people (humanModel.js): they wait in the halls, walk in through the doors
// and take hold of a loop or a rail, brace at the launch, sway with the cabin, look out; at the
// other end some walk out and others come in.
import * as THREE from 'three';
import { AK_SITE } from './akamoSite.js';
import { AKAMO, thePlan, at as runAt, standPull } from './akamoProfile.js';
import { buildCabin, setDoors, CABIN, ovalAt } from './akamoCabin.js';
import { AkamoTether } from './akamoTether.js';
import { buildTopHall, TOP } from './akamoTop.js';
import { buildPerson, randomLook } from './humanModel.js';
import { assignLayers, LAYER_NEAR } from '../core/layers.js';
import { DOCK_AT } from './stations.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** where the cabin's own room sits in the physics frame (far from everything else there) */
export const AK_OFF = V(0, 3000, 0);
const DWELL = { bottom: 75, top: 60 };   // s the doors stay open at each end (shorter with Kaito aboard)
const DOOR_T = 2.6;                       // s for the doors to open or shut
const G0 = 9.80665;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _flipAxis = V(1, 0, 0);

/** the spots in the cabin where people stand and hold on (cabin-local, with what they hold) */
function spots() {
  const out = [];
  // round the core's rail
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2; out.push({ p: V(Math.cos(a) * (CABIN.coreR + 0.62), 0, Math.sin(a) * (CABIN.coreR + 0.62)), face: a + Math.PI, hold: 'rail' }); }
  // under the loops of the inner ring
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + 0.45; const p = ovalAt(a, 0.42); out.push({ p, face: a + Math.PI / 2, hold: 'loop' }); }
  // along the glass (looking out)
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.12;
    if (Math.abs(Math.cos(a)) > 0.93) continue;           // (not in front of the doors)
    const p = ovalAt(a, 1 - 0.55 / CABIN.B);
    out.push({ p, face: Math.atan2(-p.x / (CABIN.A * CABIN.A), -p.z / (CABIN.B * CABIN.B)) + Math.PI, hold: 'glass' });
  }
  return out;
}

export class Akamo {
  constructor(game) {
    this.g = game;
    this.plan = thePlan();
    this.L = AKAMO.L;
    this.st = null;                       // Shirasagi (found once the stations exist)
    // the bottom berth: the cabin's floor's middle, station-local (the ribbon goes up from it);
    // set by the terminal's builder (akamoTerminal.js)
    // the berth over Shirasagi's core (akamoSite.js: the terminal's platform is round it)
    this.baseLocal = V(AK_SITE.berth.x, AK_SITE.berth.y, AK_SITE.berth.z).add(DOCK_AT);
    // ---- the cabin
    this.cab = buildCabin();
    this.cab.group.matrixAutoUpdate = false;
    game.engine.scene.add(this.cab.group);
    this.tether = new AkamoTether(game.engine);
    // ---- the top terminal's hall (its own frame is the cabin's while the cabin lies there)
    this.top = buildTopHall();
    this.top.group.matrixAutoUpdate = false;
    game.engine.scene.add(this.top.group);
    this.topHall = { contains: this.top.contains };
    // the cabin's own lamps (its ceiling's light rings), cabin-local
    this.cabLamps = [];
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const p = ovalAt(a, 0.62); this.cabLamps.push({ local: V(p.x, CABIN.H - 0.1, p.z), color: 0xfff4e6, intensity: 1.6, room: 'akamo' }); }
    this.lampsIn = false;
    // ---- where it is
    this.state = 'dwell';                 // dwell | closing | run
    this.end = 'bottom';                  // the end it is at (dwell / closing)
    this.tState = DWELL.bottom * 0.4;
    this.dir = 1;                         // the run's way: +1 up, -1 down
    this.runT = 0;
    this.s = 0;                           // m up the ribbon from the bottom berth
    this.v = 0;                           // m/s along it (+ up)
    this.flip = 0;                        // 0 floor toward the Earth .. 1 turned over
    this.felt = 0;                        // g toward the floor
    this.shake = 0;
    this.stage = 'dwell';
    this.doors = 1;
    setDoors(this.cab, 1);
    // ---- the ride frame (game.ride while Kaito rides in the cabin's frame)
    this.rideObj = {
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), properAcc: new THREE.Vector3(),
      off: AK_OFF.clone(), gLocal: new THREE.Vector3(), source: 'cabin',
      contains: (p) => this.containsRide(p),
    };
    this.topPull = standPull(this.L, 6.791e6);
    // ---- the people
    this.people = [];
    this.spots = spots();
    this.peopleOn = false;
    // ---- the info display round the core
    this.disp = this.makeDisplay();
    // ---- physics (made once the world exists: init)
    this.cols = null;
    this.t = 0;
    this.said = {};
    // ---- H8 and B-29 called along the ribbon (only from aboard AKAMO)
    this.follow = { h8: false, b29: false };
    this.makePanel();
  }

  // ------------------------------------------------------------------ calling H8 / B-29 along
  /** the escort's place beside the ribbon at the cabin (or the top terminal when it lies there):
   * a little off to the side, moving as the cabin does */
  escortPoint(who, pos, vel) {
    const P = this._ep || (this._ep = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion() });
    this.cabinPose(this.s, this.flip, this.v, P);
    const side = who === 'h8' ? 70 : 160;
    const S = this.stationPose();
    const ax = _v.set(0, 0, who === 'h8' ? 1 : -1).applyQuaternion(S.quat);
    pos.copy(P.pos).addScaledVector(ax, side);
    if (vel) vel.copy(P.vel);
    return pos;
  }

  /** the buttons (shown only while Kaito rides AKAMO or waits in its top hall) */
  makePanel() {
    if (typeof document === 'undefined') return;
    const el = this.panel = document.createElement('div');
    el.id = 'ak-panel';
    el.innerHTML = '<div class="ak-t">AKAMO から呼ぶ</div><button data-w="h8">H8 を追従させる</button><button data-w="b29">B-29 を追従させる</button><div class="ak-t">護衛機から見る</div><button data-v="h8">H8 から見る</button><button data-v="b29">B-29 から見る</button>';
    el.addEventListener('click', (e) => { const d = e.target && e.target.dataset; if (d && d.w) this.toggleFollow(d.w); else if (d && d.v) this.toggleView(d.v); });
    for (const ev of ['pointerdown', 'touchstart']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    (document.getElementById('hud') || document.body).appendChild(el);
    this.btn = { h8: el.querySelector('[data-w="h8"]'), b29: el.querySelector('[data-w="b29"]') };
    this.vbtn = { h8: el.querySelector('[data-v="h8"]'), b29: el.querySelector('[data-v="b29"]') };
  }

  toggleFollow(who) {
    const g = this.g, on = !this.follow[who];
    if (who === 'h8') {
      const h = g.h8;
      if (!h || h.mode === 'lost' || h.mode === 'pod') { this.say('suit_call_noh8'); return; }
      this.follow.h8 = on;
      h.followAkamo(on);
    } else {
      const ap = g.autopilot;
      if (g.damage && g.damage.broken) { this.say('suit_b29_dead'); return; }
      this.follow.b29 = on;
      if (on) {
        const me = this;
        this.b29Target = { id: 'akamo', name: 'AKAMO', kind: 'target', tether: false, standoff: 20, pos: new THREE.Vector3(), vel: new THREE.Vector3(), posOf(t, pos, vel) { return me.escortPoint('b29', pos, vel || _v2); } };
        this.escortPoint('b29', this.b29Target.pos, this.b29Target.vel);
        if (!ap.engageObj(this.b29Target)) this.follow.b29 = false;
        else this.say('ak_b29_follow');
      } else if (ap.target === this.b29Target) ap.disengage(true);
    }
    if (!this.follow[who] && this.viewFrom === who) this.closeView();
    this.g.audio && this.g.audio.beep(1320, 0.05, 0.05, { direct: true });
  }

  // ------------------------------------------------------------------ watching from the escorts
  /** Kaito riding: the view from H8 or B-29 while it escorts the cabin (the external-camera mode;
   * the exit or camera button, or the panel again, brings him back to the cabin) */
  toggleView(who) {
    const g = this.g;
    if (this.viewFrom === who && g.mode === 'camera') { this.closeView(); return; }
    if (!this.follow[who] || g.ride !== this.rideObj || g.mode === 'dead') return;
    if (who === 'h8' && !(g.h8 && g.h8.flight)) return;
    this.viewFrom = who;
    g.extCam = 0;
    g.mode = 'camera'; g.input.setMode('camera');
    if (g.systems && g.systems.emit) g.systems.emit('camOn');
    g.audio && g.audio.beep(1320, 0.05, 0.05, { direct: true });
  }

  closeView() {
    const g = this.g;
    this.viewFrom = null;
    if (g.mode === 'camera') { g.mode = 'walk'; g.input.setMode('walk'); if (g.systems && g.systems.emit) g.systems.emit('camOff'); }
  }

  /** the escort's view in the cabin's frame (game.updateRender): camera 0 watches the cabin from
   * just behind the ship (a drag swings it round the cabin), the rest are the ship's own outside
   * cameras. Returns { pos, quat } or null */
  remoteView(idx, dt, origin, ride) {
    const g = this.g, who = this.viewFrom;
    if (!who || !ride || g.ride !== this.rideObj) return null;
    const h8 = who === 'h8' ? g.h8 : null, F = h8 ? h8.flight : g.flight;
    if (!F || (who === 'h8' && !h8)) return null;
    const T = this._rvT || (this._rvT = { q: new THREE.Quaternion(), a: new THREE.Vector3(), b: new THREE.Vector3(), m: new THREE.Matrix4(), Y: new THREE.Vector3(0, 1, 0) });
    const N = 1 + (h8 ? 4 : 5), i = ((idx % N) + N) % N;
    const qi = T.q.copy(ride.quat).invert();
    if (i === 0) {
      const P = T.a.copy(F.pos).sub(origin).applyQuaternion(qi).add(ride.off);       // the ship, in the cabin's frame
      const tgt = ride.off.clone().add(T.b.set(0, 1.2, 0));                             // the cabin's middle
      const away = P.clone().sub(tgt).normalize();
      // (between the ship and the cabin, a little up: the ship's own hull out of the way)
      const dist = P.distanceTo(tgt);
      const pos = tgt.clone().addScaledVector(away, Math.min(dist * 0.6, h8 ? 32 : 45)).add(T.b.set(0, h8 ? 4 : 7, 0));
      const quat = new THREE.Quaternion().setFromRotationMatrix(T.m.lookAt(pos, tgt, T.Y));
      return g.lookExternal({ pos, quat, orbit: tgt }, dt);
    }
    const c = h8 ? h8.externalCamera(i - 1) : g.systems.externalCamera(i - 1);
    const v = g.lookExternal(c, dt);
    // the ship's frame into render coordinates (the cabin is the origin), then into the cabin's frame
    const pr = v.pos.clone();
    if (h8) pr.applyMatrix4(h8.frameMatrix(T.m)).add(T.a.copy(F.pos).sub(origin));
    else pr.applyQuaternion(F.quat).add(T.a.copy(F.pos).sub(origin));
    const qr = F.quat.clone().multiply(v.quat);
    return { pos: pr.applyQuaternion(qi).add(ride.off), quat: qi.clone().multiply(qr) };
  }

  /**
   * The escorts in formation with the cabin. No thruster of theirs could match its run (80 km/s in a
   * couple of minutes), so once called along they lock on to the tower's guide field like the cabin
   * itself: each closes on its place beside it (at most 8 km/s while catching up) and then moves
   * exactly as the cabin does. Their own flight computers go on steering on top of that.
   */
  holdEscorts(dt) {
    const g = this.g;
    const T = this._he || (this._he = { p: new THREE.Vector3(), v: new THREE.Vector3(), d: new THREE.Vector3() });
    const hold = (who, F) => {
      if (!this.follow[who] || !F) { if (this._heRel) this._heRel[who] = null; return; }
      this.escortPoint(who, T.p, T.v);
      T.d.copy(T.p).sub(F.pos);
      const gap = T.d.length(), close = Math.min(gap / 1.5, 8000);
      // (carried exactly with the cabin's own motion, however hard it boosts; only its speed against
      // the cabin eases toward the closing speed it wants, at no more than 1200 m/s², so a late
      // join never jumps)
      // (its speed against the cabin is kept here, so the cabin's own boost between steps is carried
      // in full and never read as the escort falling behind)
      const RS = this._heRel || (this._heRel = {});
      if (!RS[who] || RS[who].F !== F) RS[who] = { F, v: new THREE.Vector3().copy(F.vel).sub(T.v) };
      const rel = RS[who].v;
      const dv = gap > 1e-3 ? T.d.multiplyScalar(close / gap).sub(rel) : T.d.copy(rel).negate();
      const n = dv.length(), lim = 1200 * Math.max(dt, 1e-3);
      if (n > lim) rel.addScaledVector(dv, lim / n); else rel.add(dv);
      F.vel.copy(T.v).add(rel);
    };
    hold('b29', g.docking && g.docking.state === 'free' ? g.flight : null);
    hold('h8', g.h8 && g.h8.flight && g.h8.mode === 'free' ? g.h8.flight : null);
  }

  /** the cabin back at the bottom with Kaito: H8 goes home to B-29, B-29 back to its berth */
  followHome() {
    const g = this.g;
    if (this.follow.h8 && g.h8 && g.h8.call) g.h8.call();
    if (this.follow.b29) {
      const ap = g.autopilot;
      if (ap.target === this.b29Target) ap.disengage(true);
      if (this.st) ap.engage(this.st.id);
      this.b29Return = true;
    }
    this.follow.h8 = this.follow.b29 = false;
  }

  updatePanel(show) {
    if (!this.panel) return;
    if (this._panelShown !== show) { this._panelShown = show; this.panel.classList.toggle('on', show); }
    if (!show) return;
    for (const w of ['h8', 'b29']) {
      const on = this.follow[w];
      const b = this.btn[w];
      const txt = (w === 'h8' ? 'H8' : 'B-29') + (on ? ' 追従中（解除）' : ' を追従させる');
      if (b.textContent !== txt) b.textContent = txt;
      b.classList.toggle('on', on);
    }
    for (const w of ['h8', 'b29']) {
      const b = this.vbtn && this.vbtn[w];
      if (!b) continue;
      const on = this.viewFrom === w && this.g.mode === 'camera';
      const txt = on ? '車内の視点に戻る' : (w === 'h8' ? 'H8' : 'B-29') + ' から見る';
      if (b.textContent !== txt) b.textContent = txt;
      b.classList.toggle('on', on);
      b.style.opacity = this.follow[w] || on ? '' : '0.45';
      b.disabled = !(this.follow[w] || on);
    }
  }

  /** once the stations and physics exist */
  init() {
    const g = this.g;
    this.st = g.stations && g.stations.byId ? g.stations.byId('shirasagi') : null;
    // the cabin's room in its own frame
    const C = this.cab;
    const off = new THREE.Matrix4().makeTranslation(AK_OFF.x, AK_OFF.y, AK_OFF.z);
    const toDesc = (b) => (b.cyl
      ? { type: 'cyl', hh: b.h / 2, r: b.r, m: off.clone().multiply(new THREE.Matrix4().makeTranslation(b.pos.x, b.pos.y, b.pos.z)) }
      : { type: 'box', hx: b.half.x, hy: b.half.y, hz: b.half.z, m: off.clone().multiply(new THREE.Matrix4().compose(b.pos, b.quat, V(1, 1, 1))) });
    this.cols = g.phys.addColliders(C.boxes.map(toDesc));
    this.doorCols = g.phys.addColliders(C.doorBoxes.map(toDesc));
    this.setDoorCols(false);
    this.topCols = g.phys.addColliders(this.top.colliders.map((d) => Object.assign({}, d, { m: off.clone().multiply(d.m) })));
    this.colsOn = { cab: true, top: true };
    // the same room at the bottom berth, in B-29's frame (walked into from the terminal's platform)
    const bo = this.berthShip(new THREE.Vector3());
    const offB = new THREE.Matrix4().makeTranslation(bo.x, bo.y, bo.z), offI = off.clone().invert();
    const atB = (d) => Object.assign(d, { m: offB.clone().multiply(offI.clone().multiply(d.m)) });
    this.colsB = g.phys.addColliders(C.boxes.map((x) => atB(toDesc(x))));
    this.doorColsB = g.phys.addColliders(C.doorBoxes.map((x) => atB(toDesc(x))));
    for (const c of [...this.colsB, ...this.doorColsB]) c.setEnabled(false);
    this.berthOn = false;
    this.setCols(false, false);
    // the lamps' places in the physics frame
    for (const l of [...this.cabLamps, ...this.top.lamps]) { l.pos = l.local.clone().add(AK_OFF); l.base = l.intensity; }
    if (g.engine.crisp) g.engine.crisp.add(C.display);
  }

  /** the cabin's room and the top hall in the ride frame: there only where they are */
  setCols(cab, top) {
    if (this.colsOn.cab !== cab) { this.colsOn.cab = cab; for (const c of this.cols) c.setEnabled(cab); if (!cab) for (const c of this.doorCols) c.setEnabled(false); else this._doorShut = undefined; }
    if (this.colsOn.top !== top) { this.colsOn.top = top; for (const c of this.topCols) c.setEnabled(top); }
  }

  /** the cabin's and the hall's lamps in the light pool while Kaito is in the ride frame */
  setLamps(on) {
    if (on === this.lampsIn) return;
    this.lampsIn = on;
    const S = this.g.systems, list = [...this.cabLamps, ...this.top.lamps];
    if (on) S.lamps.push(...list);
    else {
      S.lamps = S.lamps.filter((l) => !list.includes(l));
      for (const slot of S.pool) if (slot.lamp && list.includes(slot.lamp)) { slot.lamp = null; slot.out = false; slot.light.intensity = 0; }
    }
  }

  setDoorCols(shut) {
    if (this._doorShut === shut) return;
    this._doorShut = shut;
    for (const c of this.doorCols || []) c.setEnabled(shut);
    for (const c of this.doorColsB || []) c.setEnabled(shut && !!this.berthOn);
  }

  // ------------------------------------------------------------------ where things are
  /** Shirasagi's pose at time t: { pos, vel, quat } */
  stationPose(t = this.g.time) { return this.g.docking.stationPose(this.st, t); }

  /** the cabin's pose (ECI) for s (m up) and flip (0..1); into out { pos, vel, quat } */
  cabinPose(s, flip, v, out, t = this.g.time) {
    const P = this.stationPose(t);
    const local = _v.copy(this.baseLocal).add(_v2.set(0, s, 0));
    out.pos.copy(local).applyQuaternion(P.quat).add(P.pos);
    // its motion: the station's, the frame's turn at that height, its run along the ribbon
    const w = _v2.copy(P.pos).cross(P.vel).divideScalar(P.pos.lengthSq());
    const arm = local.applyQuaternion(P.quat);
    out.vel.copy(P.vel).add(w.cross(arm)).addScaledVector(_v.set(0, 1, 0).applyQuaternion(P.quat), v);
    out.quat.copy(P.quat).multiply(_q.setFromAxisAngle(_flipAxis, Math.PI * flip));
    return out;
  }

  /** the berth at the bottom, ship-local (B-29 lying at Shirasagi: ship = station - DOCK_AT) */
  berthShip(out = new THREE.Vector3()) {
    return out.copy(this.baseLocal).sub(DOCK_AT);
  }

  /** a physics-frame point inside the ride frame's room (the cabin, or the top hall) */
  containsRide(p) {
    const x = p.x - AK_OFF.x, y = p.y - AK_OFF.y, z = p.z - AK_OFF.z;
    if (y > -0.3 && y < CABIN.H + CABIN.dome + 0.2 && (x / CABIN.A) ** 2 + (z / CABIN.B) ** 2 < 1.06) return true;
    if (this.topHall && this.topHall.contains(x, y, z)) return true;
    return false;
  }

  /** a B-29-frame point (lying at Shirasagi) inside the cabin at the bottom berth */
  inCabinShip(p) {
    if (!(this.state !== 'run' && this.end === 'bottom')) return false;
    const b = this.berthShip(_v);
    const x = p.x - b.x, y = p.y - b.y, z = p.z - b.z;
    return y > -0.3 && y < CABIN.H + 0.4 && (x / (CABIN.A - 0.15)) ** 2 + (z / (CABIN.B - 0.15)) ** 2 < 1;
  }

  // ------------------------------------------------------------------ per step
  update(dt) {
    const g = this.g;
    if (!this.st || !g.docking) return;
    this.t += dt;
    this.tState += dt;
    const pl = g.player;
    const aboardRide = !!g.ride && g.ride === this.rideObj;
    const aboardBottom = !aboardRide && this.isDockedHere() && this.inCabinShip(pl.pos);
    const aboard = aboardRide ? this.containsRideCabin(pl.pos) : aboardBottom;
    // ---- the timetable
    if (this.state === 'dwell') {
      // (back at the bottom with Kaito aboard but B-29 not at its berth yet: the doors stay shut —
      // the station's side of them is reached only through B-29 — until it docks again)
      const waitB29 = this.end === 'bottom' && aboardRide && !this.isDockedHere();
      if (waitB29) { this.doors = Math.max(0, this.doors - dt / DOOR_T); this.tState = 0; this.holding = true; }
      else if (this.holding && aboardRide) { this.holding = false; this.leaveRide(); }
      else this.holding = false;
      if (!waitB29) this.doors = Math.min(1, this.doors + dt / DOOR_T);
      let wait = DWELL[this.end];
      // (Kaito aboard: it goes soon; a countdown on the display)
      if (aboard) { if (this.boardT === undefined) this.boardT = this.tState; wait = Math.min(wait, this.boardT + 22); }
      else this.boardT = undefined;
      this.countdown = Math.max(0, wait - this.tState);
      if (this.tState > wait) { this.state = 'closing'; this.tState = 0; this.chime(); if (aboard) this.say('ak_board'); }
    } else if (this.state === 'closing') {
      this.doors = Math.max(0, this.doors - dt / DOOR_T);
      if (this.tState > DOOR_T + 1.2) {
        this.state = 'run'; this.tState = 0; this.runT = 0;
        this.dir = this.end === 'bottom' ? 1 : -1;
        this.end = null;
        this.boardT = undefined;
        // Kaito in the cabin at the bottom: from now on he rides in its frame
        if (aboardBottom) this.enterRide();
        this.said = {};
        if (aboard || aboardBottom) this.say('ak_launch');
      }
    } else if (this.state === 'run') {
      this.runT += dt;
      if (this.runT >= this.plan.total) {
        this.end = this.dir > 0 ? 'top' : 'bottom';
        this.state = 'dwell'; this.tState = 0;
        this.chime();
        if (aboard) this.say(this.end === 'top' ? 'ak_arrive_top' : 'ak_arrive_bottom');
        // back at the bottom: Kaito steps back into the station's (B-29's) frame (B-29 there)
        if (this.end === 'bottom' && aboardRide) { this.followHome(); if (this.isDockedHere()) this.leaveRide(); else this.say('ak_wait_b29'); }
      }
    }
    setDoors(this.cab, this.doors);
    // ---- the ride frame's room: the cabin's (riding in it, or it lying at the top), the top hall's
    // (it lying there, or Kaito left in the hall while it is away)
    const riding = g.ride === this.rideObj;
    const atTop = this.end === 'top' && this.state !== 'run';
    if (riding) this.rideObj.source = atTop || this.containsRideCabin(pl.pos) ? 'cabin' : 'top';
    const srcTop = riding && this.rideObj.source === 'top';
    this.setCols(!srcTop || atTop, atTop || srcTop);
    if (this.colsOn.cab) this.setDoorCols(this.doors < 0.6);
    this.setLamps(riding);
    // ---- the run: where it is, what is felt
    this.motion();
    // ---- the ride frame: its pose and the felt pull
    if (g.ride === this.rideObj) this.updateRide(dt);
    // ---- the escorts called along keep their places beside the cabin through its whole run
    if (g.ride === this.rideObj) this.holdEscorts(dt);
    // ---- H8 / B-29 called along (the buttons only while Kaito rides AKAMO)
    // (the escort's view closed with the ride, or once the camera mode was left another way)
    if (this.viewFrom && (g.mode !== 'camera' || g.ride !== this.rideObj || !this.follow[this.viewFrom] || (this.viewFrom === 'h8' && !(g.h8 && g.h8.flight)))) {
      if (g.mode === 'camera') this.closeView(); else this.viewFrom = null;
    }
    this.updatePanel(g.ride === this.rideObj);
    // ---- the cabin's room at the bottom berth (walkable while it is in and B-29 is docked)
    this.setBerth(this.state !== 'run' && this.end === 'bottom' && this.isDockedHere());
    // B-29 sent back to its berth: once it holds at Shirasagi, it docks again
    if (this.b29Return && g.autopilot.state === 'hold' && g.autopilot.target === this.st && g.docking.state === 'free') { this.b29Return = false; g.docking.request(); }
    // ---- the people
    this.updatePeople(dt, aboard || aboardRide);
    // ---- what Kaito hears and feels aboard
    this.feel(dt, aboard || aboardRide);
  }

  /** s, v, flip, felt for this moment */
  motion() {
    const top = this.topPull / G0;
    if (this.state === 'run') {
      const up = this.dir > 0;
      const a = runAt(this.runT, this.plan, { start: up ? 0 : top, end: up ? top : 0 });
      this.s = up ? a.s : this.L - a.s;
      this.v = up ? a.v : -a.v;
      this.flip = up ? a.flip : 1 - a.flip;
      this.felt = a.felt;
      this.shake = a.shake;
      this.stage = a.stage;
      this.k = a.k;
      // (the announcements on the way)
      if (a.stage === 'cruise' && !this.said.flip) { this.said.flip = true; this.say('ak_flip'); }
      if (a.stage === 'brake' && !this.said.brake) { this.said.brake = true; this.say('ak_brake'); }
    } else {
      const atTop = this.end === 'top';
      this.s = atTop ? this.L : 0;
      this.v = 0;
      this.flip = atTop ? 1 : 0;
      this.felt = atTop ? top : 0.0;
      this.shake = 0;
      this.stage = this.state;
      this.k = atTop ? 1 : 0;
    }
  }

  isDockedHere() { const D = this.g.docking; return !!(D && D.state === 'docked' && D.station === this.st); }

  containsRideCabin(p) {
    const x = p.x - AK_OFF.x, y = p.y - AK_OFF.y, z = p.z - AK_OFF.z;
    return y > -0.3 && y < CABIN.H + CABIN.dome + 0.2 && (x / CABIN.A) ** 2 + (z / CABIN.B) ** 2 < 1.02;
  }

  // ------------------------------------------------------------------ riding in the cabin's frame
  /** Kaito, in the cabin at the bottom berth (B-29's frame), goes over into the cabin's frame */
  enterRide() {
    const g = this.g, pl = g.player;
    const b = this.berthShip(new THREE.Vector3());
    // (the cabin at the bottom lies square with the station, and B-29 with it: the axes agree)
    const p = pl.pos.clone().sub(b).add(AK_OFF);
    g.ride = this.rideObj;
    this.updateRide(0);
    pl.teleport(p);
    if (g.suits) g.suits.eva = null;
  }

  /** back at the bottom: from the cabin's frame into B-29's */
  leaveRide() {
    const g = this.g, pl = g.player;
    const b = this.berthShip(new THREE.Vector3());
    const p = pl.pos.clone().sub(AK_OFF).add(b);
    g.ride = null;
    pl.teleport(p);
  }

  updateRide(dt) {
    const R = this.rideObj;
    // (left in the top hall while the cabin is away: the hall's own frame, its own pull)
    if (R.source === 'top') {
      this.cabinPose(this.L, 1, 0, R);
      R.gLocal.set(0, -this.topPull, 0);
      R.properAcc.copy(R.gLocal).negate().applyQuaternion(R.quat);
      return;
    }
    this.cabinPose(this.s, this.flip, this.v, R);
    // what is felt (cabin axes): toward the floor, the cabin's sway with the drive's shake
    const sh = this.shake;
    const t = this.t;
    R.gLocal.set(Math.sin(t * 7.1) * sh * 0.5 + Math.sin(t * 2.3) * sh * 0.3, -this.felt * G0, Math.sin(t * 5.3 + 1) * sh * 0.45);
    // (for those that ask how the vessel Kaito is in is pushed: the felt pull, in space's axes)
    R.properAcc.copy(R.gLocal).negate().applyQuaternion(R.quat);
  }

  // ------------------------------------------------------------------ aboard: sound, shake
  feel(dt, aboard) {
    const g = this.g, A = g.audio;
    if (!A || !A.ready) return;
    const near = aboard || this.nearCam;
    if (!near) { if (this._snd) { A.stopLoop('akDrive'); A.stopLoop('akRush'); this._snd = false; } return; }
    this._snd = true;
    const at = g.ride === this.rideObj ? AK_OFF.clone().add(V(0, 1.6, 0)) : this.berthShip(new THREE.Vector3()).add(V(0, 1.6, 0));
    const v = Math.abs(this.v);
    const running = this.state === 'run';
    // the linear drive: a deep thrum rising with the speed; the rush of the rollers on the ribbon
    A.humLoop('akDrive', { pos: at, freq: running ? 38 + Math.min(70, v / 900) : 30, gain: running ? 0.05 + this.shake * 0.08 : 0.012 });
    A.noiseLoop('akRush', { pos: at, type: 'brown', freq: 120 + Math.min(900, v / 60), q: 0.7, gain: running ? 0.02 + this.shake * 0.12 : 0.0 });
    if (aboard && running) {
      g.shake = Math.max(g.shake || 0, this.shake * 0.9 + Math.max(0, this.felt - 1.2) * 0.6);
      // the launch: the kick through the floor
      if (this.stage === 'launch' && !this._kick) { this._kick = true; A.impact(at, 0.55); A.mech(at, 'clamp', { open: true }); }
    }
    if (this.stage !== 'launch') this._kick = false;
  }

  chime() {
    const A = this.g.audio;
    if (!A || !A.ready || !(this.nearCam || this.g.ride === this.rideObj)) return;
    A.beep(784, 0.35, 0.05, { direct: true }); A.beep(988, 0.35, 0.05, { direct: true, when: 0.32 }); A.beep(1175, 0.6, 0.05, { direct: true, when: 0.64 });
  }

  say(key) { if (this.g.asphalt) this.g.asphalt.say(key, {}, { force: true }); }

  // ------------------------------------------------------------------ the people aboard
  updatePeople(dt, aboard) {
    // made only while the cabin is near the eye (they are many triangles)
    const want = aboard || this.nearCam;
    if (want && !this.peopleOn) this.spawnPeople();
    if (!want && this.peopleOn && !aboard) this.clearPeople();
    if (!this.peopleOn) return;
    this.paxFlow(dt);
    const t = this.t;
    const braced = Math.max(0, Math.min(1, (this.felt - 1.15) / 1.0));
    for (let i = this.people.length - 1; i >= 0; i--) {
      const P = this.people[i];
      const p = P.pose;
      if (P.leaving && !P.walk && this.paxUnseen(P)) { this.dropPerson(i); continue; }
      if (P.walk) {
        // walking in or out along its path
        const W = P.walk;
        const tgt = W.path[W.i];
        const d = _v.set(tgt.x - P.x, 0, tgt.z - P.z);
        const L = d.length();
        if (L < 0.08) { W.i++; if (W.i >= W.path.length) { P.walk = null; if (W.done) W.done(P); continue; } }
        else {
          const sp = Math.min(L / dt, 1.25);
          P.x += d.x / L * sp * dt; P.z += d.z / L * sp * dt;
          P.face = Math.atan2(-d.x, -d.z);
          p.mode = (this.felt ?? 1) < 0.15 ? 'float' : 'walk'; p.speed = 1; p.phase = (p.phase || 0) + sp * dt * 5.2;
        }
      } else if (P.out) {
        // off the cabin, standing about on the platform (let go once nobody is looking)
        p.mode = (this.felt ?? 1) < 0.15 ? 'float' : 'stand'; p.brace = 0; p.lean = 0; p.lookPitch = 0;
        p.lookYaw = Math.sin(t * 0.3 + P.seed) * 0.6;
      } else {
        const floating = (this.felt ?? 1) < 0.15;
        p.mode = P.spot.hold === 'loop' || (P.spot.hold === 'rail' && (braced > 0.2 || floating)) ? 'hold' : floating ? 'float' : 'stand';
        p.holdY = P.spot.hold === 'loop' ? 0.95 : 0.55;
        p.brace = braced;
        p.lean = 0;
        // looking out (the glass ones), round about (the others)
        p.lookYaw = Math.sin(t * 0.13 + P.seed) * 0.5;
        p.lookPitch = this.state === 'run' ? -0.1 + Math.sin(t * 0.2 + P.seed) * 0.2 : 0;
      }
      P.person.root.position.set(P.x, p.mode === 'float' ? 0.22 + 0.04 * Math.sin(t * 0.8 + P.seed) : 0, P.z);
      P.person.root.rotation.set(0, P.face, 0);
      P.person.pose(p, t);
    }
  }

  spawnPeople() {
    this.peopleOn = true;
    const n = 11;
    const used = new Set();
    for (let i = 0; i < n; i++) {
      let k = Math.floor(Math.random() * this.spots.length);
      for (let j = 0; j < 20 && used.has(k); j++) k = Math.floor(Math.random() * this.spots.length);
      used.add(k);
      const spot = this.spots[k];
      const seed = 1000 + i * 37 + Math.floor(this.t);
      const person = buildPerson(randomLook(seed, 'passenger'));
      person.root.traverse((o) => { if (o.isMesh) o.layers.set(LAYER_NEAR); });
      this.cab.group.add(person.root);
      this.people.push({ person, spot, x: spot.p.x, z: spot.p.z, face: spot.face, pose: { mode: 'stand' }, seed: seed * 0.37, walk: null });
    }
  }

  clearPeople() {
    for (const P of this.people) { P.person.root.removeFromParent(); P.person.dispose(); }
    this.people.length = 0;
    this.peopleOn = false;
  }

  // ---- passengers: off at each end, new ones on through the dwell, all settled when it goes. Their
  // paths are in the cabin's frame, out through the nearer door, the gangway, onto the platform
  // (the bottom) or the apex hall's floor
  paxFlow(dt) {
    const key = this.state === 'dwell' ? 'dwell:' + this.end : this.state;
    if (key !== this.paxKey) {
      const prev = this.paxKey;
      this.paxKey = key;
      if (this.state === 'dwell' && prev === 'run') this.paxAlight();
      if (this.state === 'run') this.paxSettle();
      this.paxT = 0;
    }
    if (this.state !== 'dwell' || this.doors < 0.95) return;
    if (this.end === 'bottom' && !this.berthOn) return;      // (the platform is there only with B-29 in)
    this.paxT += dt;
    if (this.paxT < 8 || (this.countdown || 0) < 9) return;
    this.paxNext = (this.paxNext || 0) - dt;
    if (this.paxNext > 0) return;
    this.paxNext = 1.4 + Math.random() * 2.6;
    if (this.people.filter((P) => !P.out).length < 12) this.paxBoardOne();
  }
  paxAlight() {
    const A = CABIN.A;
    for (const P of this.people) {
      if (P.out || Math.random() > 0.85) continue;
      const sx = P.x >= 0 ? 1 : -1, side = Math.random() < 0.5 ? -1 : 1;
      P.out = true;
      P.walk = { i: 0, path: [V(sx * (A - 0.7), 0, Math.max(-0.4, Math.min(0.4, P.z))), V(sx * (A + 0.3), 0, 0), V(sx * (A + 1.7), 0, side * 0.5), V(sx * (A + 3.4), 0, side * (2.2 + Math.random() * 2.2))], done: (Q) => { Q.leaving = true; Q.face = Math.atan2(-sx, 0); } };
    }
  }
  paxBoardOne() {
    const free = this.spots.filter((s) => !this.people.some((P) => !P.out && P.spot === s));
    if (!free.length) return;
    const spot = free[Math.floor(Math.random() * free.length)];
    const A = CABIN.A, sx = spot.p.x >= 0 ? 1 : -1, side = Math.random() < 0.5 ? -1 : 1;
    const P = this.addPerson(spot, sx * (A + 3.6), side * (2.0 + Math.random() * 2.4), Math.atan2(sx, 0));
    P.walk = { i: 0, path: [V(sx * (A + 1.7), 0, side * 0.3), V(sx * (A + 0.3), 0, 0), V(sx * (A - 0.8), 0, 0), spot.p.clone()], done: (Q) => { Q.face = Q.spot.face; } };
  }
  paxSettle() {
    for (let i = this.people.length - 1; i >= 0; i--) {
      const P = this.people[i];
      if (P.out) { this.dropPerson(i); continue; }
      if (P.walk) { P.walk = null; P.x = P.spot.p.x; P.z = P.spot.p.z; P.face = P.spot.face; }
    }
  }
  /** someone who has walked off is let go once nobody is looking (or far off) */
  paxUnseen(P) {
    const m = this._pm || (this._pm = new THREE.Matrix4()), e = this._pe || (this._pe = new THREE.Vector3()), d = this._pd || (this._pd = new THREE.Vector3());
    const cam = this.g.engine.camera;
    m.copy(this.cab.group.matrixWorld).invert();
    cam.getWorldPosition(e).applyMatrix4(m);
    cam.getWorldDirection(d).transformDirection(m);
    const dx = P.x - e.x, dy = 1 - e.y, dz = P.z - e.z, L = Math.hypot(dx, dy, dz);
    return L > 16 || (dx * d.x + dy * d.y + dz * d.z) / L < 0.25;
  }
  addPerson(spot, x, z, face) {
    const seed = 2000 + Math.floor(Math.random() * 1e6);
    const person = buildPerson(randomLook(seed, 'passenger'));
    person.root.traverse((o) => { if (o.isMesh) o.layers.set(LAYER_NEAR); });
    this.cab.group.add(person.root);
    const P = { person, spot, x, z, face, pose: { mode: 'stand' }, seed: seed * 0.37, walk: null };
    this.people.push(P);
    return P;
  }
  dropPerson(i) {
    const P = this.people[i];
    P.person.root.removeFromParent(); P.person.dispose();
    this.people.splice(i, 1);
  }

  /** the cabin's room at the bottom berth: on while it is in there with B-29 docked */
  setBerth(on) {
    if (this.berthOn === on) return;
    this.berthOn = on;
    for (const c of this.colsB || []) c.setEnabled(on);
    for (const c of this.doorColsB || []) c.setEnabled(on && this._doorShut !== false);
  }
  /** the cabin's own air (riding it, in the apex hall, or in it at the bottom berth), or null */
  airAt(p) {
    const g = this.g;
    const inside = (g.ride === this.rideObj && this.rideObj.contains && this.rideObj.contains(p)) || (this.berthOn && this.inCabinShip(p));
    return inside ? (this._air || (this._air = { p: 101.3, o2: 21.2, co2: 0.04 })) : null;
  }
  /** the platform's screen doors open with the cabin's own (only when it is in at the bottom) */
  platformDoorK() { return this.end === 'bottom' && this.state !== 'run' && this.berthOn ? this.doors : 0; }
  /** the departure boards on the platform */
  boardInfo() {
    const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    const T = this.plan.total, turn = DOOR_T + 1.2;
    if (this.state === 'dwell' && this.end === 'bottom') return { text: 'ご乗車いただけます', sub: '発車まで ' + fmt(this.countdown || 0), tone: 'go' };
    if (this.state === 'closing' && this.end === 'bottom') return { text: 'まもなく発車します', sub: 'ドアが閉まります。ご注意ください', tone: 'wait' };
    if (this.state === 'run' && this.dir > 0) return { text: '頂上へ運行中', sub: '次の到着まで ' + fmt(T - this.runT + DWELL.top + turn + T), tone: 'run' };
    if (this.state === 'run') return { text: 'まもなく到着します', sub: '到着まで ' + fmt(T - this.runT), tone: 'run' };
    const left = this.state === 'dwell' ? Math.max(0, DWELL.top - this.tState) + turn : Math.max(0, turn - this.tState);
    return { text: '頂上ステーションに停車中', sub: '次の到着まで ' + fmt(left + T), tone: 'wait' };
  }

  // ------------------------------------------------------------------ the info display
  makeDisplay() {
    const W = 2048, H = 256;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.wrapS = THREE.RepeatWrapping;
    // (four copies round the core: whoever stands where sees one)
    tex.repeat.set(4, 1);
    this.cab.display.material.map = tex;
    this.cab.display.material.needsUpdate = true;
    return { c, g: c.getContext('2d'), tex, W, H, t: 0 };
  }

  drawDisplay(dt) {
    const D = this.disp;
    D.t += dt;
    if (D.t < 0.2) return;
    D.t = 0;
    const g = D.g, W = D.W / 4, H = D.H;
    g.fillStyle = '#04070b'; g.fillRect(0, 0, D.W, H);
    const v = Math.abs(this.v), alt = (6.791e6 + this.s - 6.371e6) / 1000;
    const font = (px, w = 600, mono = false) => `${w} ${px}px ${mono ? '"SF Mono","Menlo",monospace' : '"Hiragino Sans","Noto Sans JP",sans-serif'}`;
    g.textBaseline = 'middle';
    // (one panel, drawn into the first quarter, then copied round)
    g.fillStyle = 'rgba(255,170,80,0.95)'; g.font = font(26, 800); g.textAlign = 'left';
    g.fillText('AKAMO', 18, 36);
    g.fillStyle = 'rgba(220,232,245,0.75)'; g.font = font(20, 600);
    const st = this.state === 'dwell' ? (this.end === 'top' ? '上端駅 停車中' : 'シラサギ駅 停車中') : this.state === 'closing' ? 'ドアが閉まります' : { creep: '発車', launch: '加速', boost: '加速中', cruise: '最高速度・反転', brake: '減速中', slow: '到着前', dock: '到着' }[this.stage] || '';
    g.fillText(st, 130, 36);
    // speed
    g.textAlign = 'right';
    g.fillStyle = '#f4f8fc'; g.font = font(64, 300, true);
    g.fillText(v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) : v.toFixed(0), 300, 118);
    g.fillStyle = 'rgba(220,232,245,0.6)'; g.font = font(20, 600); g.textAlign = 'left';
    g.fillText(v >= 1000 ? 'km/s' : 'm/s', 308, 128);
    // height, felt pull
    g.textAlign = 'left'; g.fillStyle = 'rgba(220,232,245,0.6)'; g.font = font(18, 600);
    g.fillText('高度', 380, 86); g.fillText('体感', 380, 150);
    g.fillStyle = '#f4f8fc'; g.font = font(34, 400, true);
    g.fillText(`${alt.toFixed(alt < 1000 ? 1 : 0)} km`, 380, 116);
    g.fillStyle = this.felt > 1.5 ? '#ff8a6a' : '#f4f8fc';
    g.fillText(`${this.felt.toFixed(2)} G`, 380, 180);
    // the line: bottom to top, where the cabin is
    const x0 = 24, x1 = W - 24, y = 222;
    g.strokeStyle = 'rgba(220,232,245,0.25)'; g.lineWidth = 4; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
    const k = this.s / this.L;
    g.strokeStyle = 'rgba(255,170,80,0.9)'; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + (x1 - x0) * k, y); g.stroke();
    g.fillStyle = '#ffb347'; g.beginPath(); g.arc(x0 + (x1 - x0) * k, y, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(220,232,245,0.6)'; g.font = font(15, 600);
    g.textAlign = 'left'; g.fillText('シラサギ', x0, y - 18);
    g.textAlign = 'right'; g.fillText('上端駅 2,500 km', x1, y - 18);
    // time to go / the countdown
    g.textAlign = 'right'; g.font = font(18, 600); g.fillStyle = 'rgba(220,232,245,0.75)';
    if (this.state === 'dwell' && this.countdown !== undefined) g.fillText(`発車まで ${Math.ceil(this.countdown)} 秒`, x1, 36);
    else if (this.state === 'run') g.fillText(`到着まで ${Math.max(0, Math.ceil(this.plan.total - this.runT))} 秒`, x1, 36);
    // copy the panel round
    for (let i = 1; i < 4; i++) g.drawImage(D.c, 0, 0, W, H, i * W, 0, W, H);
    D.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ per drawn frame
  updateVisual(dt, origin, camWorld) {
    const g = this.g;
    if (!this.st) return;
    const P = this._pose || (this._pose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion() });
    this.cabinPose(this.s, this.flip, this.v, P);
    const rel = _v.copy(P.pos).sub(origin);
    const G = this.cab.group;
    G.matrix.compose(rel, P.quat, V(1, 1, 1));
    G.matrixWorld.copy(G.matrix);
    G.updateMatrixWorld(true);
    const d = rel.distanceTo(camWorld);
    this.nearCam = d < 400;
    // (its layers by distance; the people inside are near ones)
    if (Math.abs((this._layD || 1e9) - d) > 20 || d < 60) {
      this._layD = d;
      G.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) assignLayers(o, Math.max(0, d - 12), d + 12); });
    }
    G.visible = d < 2.0e6;
    // ---- the top hall, at the top
    const TP = this._tp || (this._tp = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion() });
    this.cabinPose(this.L, 1, 0, TP);
    const relT = TP.pos.clone().sub(origin);
    const TG = this.top.group;
    TG.matrix.compose(relT, TP.quat, V(1, 1, 1));
    TG.matrixWorld.copy(TG.matrix);
    TG.updateMatrixWorld(true);
    const dT = relT.distanceTo(camWorld);
    if (Math.abs((this._layT || 1e9) - dT) > 20 || dT < 80) { this._layT = dT; TG.traverse((o) => { if (o.isMesh) assignLayers(o, Math.max(0, dT - 30), dT + 30); }); }
    TG.visible = dT < 3.0e6;
    // the strobes
    const ph = (performance.now() / 1300) % 1;
    this.cab.M.strobe.emissiveIntensity = ph < 0.05 || (ph > 0.13 && ph < 0.18) ? 9 : 0;
    // ---- the ribbon
    const S = this._sp || (this._sp = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion() });
    const base = this.cabinPose(0, 0, 0, S).pos;
    const up = _v2.set(0, 1, 0).applyQuaternion(S.quat).clone();
    const across = V(1, 0, 0).applyQuaternion(S.quat);
    const sun = g.space && g.space.sunDir ? { dir: g.space.sunDir, lit: 1 } : { dir: V(1, 0, 0), lit: 1 };
    // (the ribbon's lights smear over what the cabin runs in a frame's exposure, seen from it)
    const riding = g.ride === this.rideObj;
    const streak = riding ? Math.abs(this.v) / 60 : 0;
    this.tether.update(base, up, across, this.L, origin, camWorld, sun, streak, performance.now() / 1000);
    // the display
    if (this.nearCam || riding) this.drawDisplay(dt);
  }

  serialize() { return { state: this.state, end: this.end, tState: +this.tState.toFixed(1), runT: +this.runT.toFixed(2), dir: this.dir }; }
  restore(s) {
    if (!s) return;
    this.state = s.state === 'run' ? 'run' : 'dwell';
    this.end = s.end || 'bottom';
    this.tState = s.tState || 0; this.runT = s.runT || 0; this.dir = s.dir || 1;
    if (this.state === 'run' && !s.end) this.end = null;
  }
}
