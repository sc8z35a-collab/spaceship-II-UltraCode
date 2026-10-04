// Gameplay hub: seats, controls, external cameras, light pool, doors/hatch updates and the
// sub-systems (monitors, life support, damage, audio, AI, saves...) as they come online.
import * as THREE from 'three';
import { LAYER_NEAR, LAYER_MID, assignLayers } from '../core/layers.js';
import { DECK_Y } from './hullShape.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ALARM_RED = new THREE.Color(1, 0.06, 0.03);

export const EXT_CAMS = [
  { name: 'chase', pos: V(0, 7.5, 27), look: V(0, 0.5, -4) },
  { name: 'nose', pos: V(0, -0.6, -13.7), look: V(0, -1.4, -40) },
  { name: 'belly', pos: V(0, -2.55, -3), look: V(0, -40, -8) },
  { name: 'radiator', pos: V(7.6, 0.9, 13.0), look: V(0, 0.4, -3) },
  { name: 'mast', pos: V(0, 3.5, 2.6), look: V(0, 0.6, 16) },
];

export class ShipSystems {
  constructor(game) {
    this.g = game;
    this.lightMode = 'normal';
    this.alarm = { active: false, silenced: false, level: 0, t: 0 };
    this.held = null;
    this.subs = [];
  }

  async init(P) {
    const g = this.g, L = g.layout, M = g.shipVis.M, root = g.shipVis.root;
    // ----- light pool
    this.lamps = [...L.lamps, ...g.shipVis.lampsCorridor.map((l) => (l.pos ? Object.assign({ room: 'corridor' }, l) : { pos: l, color: 0xe6eeff, intensity: 1.4, room: 'corridor' }))];
    this.pool = [];
    for (let i = 0; i < 16; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 7, 1.8);
      l.layers.enableAll();
      (g.frameRoot || root).add(l);
      this.pool.push({ light: l, lamp: null, f: 0 });
    }
    // alarm beacons (red rotating spots)
    this.beacons = [];
    for (const p of [V(0, 2.45, -1.0), V(0, 2.3, -9.6), V(0, 2.3, 7.2), V(-1.7, 2.25, -6.0), V(0, -0.3, -1.0)]) {
      const s = new THREE.SpotLight(0xff1a0a, 0, 9, 0.55, 0.6, 1.4);
      s.position.copy(p);
      s.layers.enableAll();
      root.add(s); root.add(s.target);
      this.beacons.push(s);
    }
    // ----- seats
    for (const seat of L.seats) {
      g.interact.addSphere(seat.eye.clone().add(V(0, -0.45, 0)), 0.45, () => this.sit(seat), { maxDist: 2.4, enabled: () => g.player.state !== 'seated' });
    }
    // ----- cockpit controls (animated meshes)
    this.controls = {};
    if (L.spots.stick) {
      const stick = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.03, 16), M.metalDark);
      const boot = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 12), M.rubber);
      boot.position.y = 0.04;
      const pivot = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.12, 8), M.steel);
      shaft.position.y = 0.06;
      const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.07, 4, 10), M.plasticK);
      grip.position.y = 0.15; grip.rotation.x = 0.15;
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8), M.plasticR);
      btn.position.set(0, 0.2, -0.008);
      pivot.add(shaft, grip, btn);
      pivot.position.y = 0.03;
      stick.add(base, boot, pivot);
      stick.position.copy(L.spots.stick);
      root.add(stick);
      this.controls.stick = pivot;
      const thr = new THREE.Group();
      const tb = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.16), M.metalDark);
      const tp = new THREE.Group();
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.12, 0.014), M.steel);
      lever.position.y = 0.06;
      const knob = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.035), M.plasticK);
      knob.position.y = 0.125;
      tp.add(lever, knob);
      tp.position.y = 0.015;
      thr.add(tb, tp);
      thr.position.copy(L.spots.throttle);
      root.add(thr);
      this.controls.throttle = tp;
      for (const o of [stick, thr]) o.traverse((x) => x.layers.set(LAYER_NEAR));
    }
    // ULTRA guarded switch + alarm silence button
    if (L.spots.ultra) {
      const u = new THREE.Group();
      u.position.copy(L.spots.ultra);
      const rot = L.spots.deskRot(0.06);
      u.rotation.set(rot[0], rot[1], rot[2], 'YXZ');
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.012), M.plasticK);
      const sw = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 8), M.steel);
      sw.rotation.x = Math.PI / 2 - 0.5; sw.position.z = 0.025;
      const cover = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.035), new THREE.MeshStandardMaterial({ color: 0xcc1a10, transparent: true, opacity: 0.75, roughness: 0.2 }));
      const coverPivot = new THREE.Group();
      coverPivot.position.set(0, 0.03, 0.006);
      cover.position.set(0, -0.025, 0.018);
      coverPivot.add(cover);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshStandardMaterial({ color: 0, emissive: new THREE.Color(1, 0.3, 0.1), emissiveIntensity: 0 }));
      lamp.position.set(0.035, 0.028, 0.008);
      u.add(plate, sw, coverPivot, lamp);
      root.add(u);
      u.traverse((x) => x.layers.set(LAYER_NEAR));
      this.controls.ultra = { group: u, sw, coverPivot, lamp };
      g.interact.addSphere(L.spots.ultra, 0.07, () => this.toggleUltra(), { maxDist: 1.6 });
      const s = new THREE.Group();
      s.position.copy(L.spots.silence);
      const rs = L.spots.deskRot(-0.06);
      s.rotation.set(rs[0], rs[1], rs[2], 'YXZ');
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 20), M.plasticY);
      ring.rotation.x = Math.PI / 2;
      const mush = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: new THREE.Color(1, 0.05, 0.02), emissiveIntensity: 0, roughness: 0.3 }));
      mush.rotation.x = Math.PI / 2; mush.position.z = 0.01;
      s.add(ring, mush);
      root.add(s);
      s.traverse((x) => x.layers.set(LAYER_NEAR));
      this.controls.silence = { group: s, mush };
      g.interact.addSphere(L.spots.silence, 0.07, () => this.silenceAlarm(), { maxDist: 1.6 });
    }
    // hatch interaction (from inside the airlock / outside)
    g.interact.addSphere(g.hatch.o.center.clone().addScaledVector(g.hatch.o.normal, -0.3), 0.45, () => this.hatchTapped(), { maxDist: 2.2 });
    g.interact.addSphere(g.hatch.o.center.clone().addScaledVector(g.hatch.o.normal, 0.4), 0.45, () => this.hatchTapped(), { maxDist: 2.6 });
    // sub systems registered later push into this.subs
    for (const s of this.subs) if (s.init) await s.init();
  }

  add(sub) { this.subs.push(sub); return sub; }

  onBegin(cont) {
    for (const s of this.subs) if (s.onBegin) s.onBegin(cont);
  }

  // ----------------------------------------------------------------- seats & modes
  sit(seat) {
    const g = this.g;
    if (g.player.state === 'eva' || g.player.state === 'evaWalk') return;
    g.player.sit(seat);
    if (seat.kind === 'pilot') { g.mode = 'pilot'; g.input.setMode('pilot'); }
    else { g.mode = 'seated'; g.input.setMode('walk'); }
    this.emit('sit', seat);
  }

  exitPressed() {
    const g = this.g;
    if (g.mode === 'camera') { this.cameraPressed(); return; }
    if (g.player.state === 'seated') {
      g.player.stand();
      g.mode = 'walk';
      g.input.setMode('walk');
      this.emit('stand');
    }
  }

  cameraPressed() {
    const g = this.g;
    if (g.mode === 'camera') { g.mode = g.player.state === 'seated' && g.player.seat.kind === 'pilot' ? 'pilot' : 'walk'; g.input.setMode(g.mode === 'pilot' ? 'pilot' : 'walk'); this.emit('camOff'); return; }
    if (g.mode === 'pilot') { g.mode = 'camera'; g.input.setMode('camera'); this.emit('camOn'); }
  }

  externalCamera(i) {
    const c = EXT_CAMS[((i % EXT_CAMS.length) + EXT_CAMS.length) % EXT_CAMS.length];
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(c.pos, c.look, new THREE.Vector3(0, 1, 0)));
    return { pos: c.pos, quat: q, name: c.name };
  }

  dropPressed() { this.emit('drop'); }
  tapNothing(tap) { this.emit('tapNothing', tap); }

  doorTapped(d) {
    this.emit('doorTap', d);
    if (!this.handled) d.toggle();
    this.handled = false;
  }

  hatchTapped() { this.emit('hatchTap'); }

  toggleUltra() {
    const f = this.g.flight;
    if (this.g.docking && this.g.docking.state !== 'free' && !f.ultra) { this.g.asphalt.say('st_docked_ultra', {}, { force: true }); return; }
    f.setUltra(!f.ultra);
  }

  silenceAlarm() {
    if (!this.alarm.active) return;
    this.alarm.silenced = true;
    this.emit('silence');
  }

  // ----------------------------------------------------------------- gameplay hooks
  get gp() { return this.g.gameplay; }
  hold(kind, data) { if (this.gp) this.gp.hold(kind, data); }
  suitTapped() { if (this.gp) this.gp.suitTapped(); }
  airlockCycle(mode) { if (this.gp) this.gp.airlockCycle(mode); }
  valveOpen(seg) { return this.gp ? this.gp.valveOpen(seg) : true; }
  toggleSleep() { if (this.gp) this.gp.toggleSleep(); }
  dockRepair() { if (this.gp) this.gp.dockRepair(); }
  onImpact(E, pLocal, a) { if (this.gp) this.gp.onImpact(E, pLocal, a); this.emit('impact', { E, pLocal }); }
  onAsteroidWarning(a, relLocal) { if (this.gp) this.gp.onAsteroidWarning(a, relLocal); }

  /** door operated from a monitor */
  remoteDoor(d) {
    this.handled = false;
    this.emit('doorTap', d);
    if (!this.handled) d.toggle();
    this.handled = false;
  }

  toggleLockdown() {
    const g = this.g, ls = g.lifeSupport;
    ls.lockdown = !ls.lockdown;
    if (ls.lockdown) {
      for (const d of Object.values(g.doors)) d.setTarget(0, true);
      g.asphalt.say('lockdown', {}, { minGap: 3 });
    }
  }

  cycleLights() {
    const order = ['normal', 'dim', 'night', 'off'];
    this.lightMode = order[(order.indexOf(this.lightMode) + 1) % order.length];
  }

  toggleMusic() {
    const a = this.g.audio;
    if (!a.musicOn && (this.signal ?? 1) < 0.05) { a.denied(); return; }
    a.setMusic(!a.musicOn);
  }

  manualSave() {
    this.g.save.save();
    this.g.asphalt.say('saved', {}, { force: true });
  }

  serializeState() {
    const g = this.g;
    return {
      lightMode: this.lightMode,
      alarm: { active: this.alarm.active, silenced: this.alarm.silenced, level: this.alarm.level },
      music: g.audio.musicOn,
      engHatch: g.engHatch ? g.engHatch.target : 0,
      gp: this.gp ? this.gp.serialize() : null,
      loose: g.loose ? g.loose.items.map((it) => {
        const t = it.body.translation(), r = it.body.rotation();
        return { s: it.stowed, p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] };
      }) : [],
    };
  }

  restoreState(d) {
    const g = this.g;
    if (d.lightMode) this.lightMode = d.lightMode;
    if (d.alarm) Object.assign(this.alarm, d.alarm);
    if (d.music) g.audio.musicOn = true;
    if (g.engHatch && d.engHatch !== undefined) g.engHatch.target = d.engHatch;
    if (d.gp && this.gp) this.gp.restore(d.gp);
    if (d.loose && g.loose) d.loose.forEach((o, i) => {
      const it = g.loose.items[i];
      if (!it || o.s) return;
      g.phys.release(it);
      it.body.setTranslation({ x: o.p[0], y: o.p[1], z: o.p[2] }, true);
      it.body.setRotation({ x: o.q[0], y: o.q[1], z: o.q[2], w: o.q[3] }, true);
    });
  }

  emit(ev, data) {
    for (const s of this.subs) if (s.on) s.on(ev, data);
  }

  playerEnv() {
    const p = this.g.player.pos;
    const env = { nearRail: false, lowCeiling: p.y < DECK_Y - 0.15 && this.g.player.state === 'walk', liftDelta: null };
    for (const s of this.subs) if (s.env) s.env(env);
    return env;
  }

  // ----------------------------------------------------------------- per frame
  update(dt, inp) {
    const g = this.g;
    for (const d of Object.values(g.doors)) d.update(dt);
    g.hatch.update(dt);
    for (const s of this.subs) if (s.update) s.update(dt, inp);
    // controls animation
    const c = this.controls;
    if (c.stick) {
      const pil = g.mode === 'pilot' || g.mode === 'camera';
      const tx = pil ? inp.rx : 0, ty = pil ? inp.ry : 0;
      c.stick.rotation.x += ((-ty * 0.35) - c.stick.rotation.x) * Math.min(1, dt * 12);
      c.stick.rotation.z += ((-tx * 0.35) - c.stick.rotation.z) * Math.min(1, dt * 12);
      const f = g.flight;
      const sp = f.setSpeed / (f.ultra || f.setSpeed > f.vNormal ? f.vUltra : f.vNormal * 2);
      c.throttle.rotation.x += ((-0.6 + sp * 1.2 + (pil ? inp.moveY * 0.15 : 0)) - c.throttle.rotation.x) * Math.min(1, dt * 6);
    }
    if (c.ultra) {
      const on = g.flight.ultra;
      c.ultra.coverPivot.rotation.x += ((on ? -1.9 : 0) - c.ultra.coverPivot.rotation.x) * Math.min(1, dt * 8);
      c.ultra.sw.rotation.x = Math.PI / 2 + (on ? 0.5 : -0.5);
      c.ultra.lamp.material.emissiveIntensity = on ? 6 + Math.sin(performance.now() / 120) * 2 : (g.flight.ultraDown ? 3 : 0);
    }
    if (c.silence) c.silence.mush.material.emissiveIntensity = this.alarm.active && !this.alarm.silenced ? 4 + 4 * Math.sin(performance.now() / 90) : 0;
  }

  updateVisual(dt, camDist) {
    const g = this.g;
    // light pool around the viewer
    const eye = g.mode === 'camera' ? null : g.player.eyeLocal;
    const lamps = this.lamps;
    const dim = this.lightMode === 'dim' ? 0.35 : this.lightMode === 'off' ? 0.0 : this.lightMode === 'night' ? 0.25 : 1;
    if (eye && (!this._selAt || this._selAt.distanceToSquared(eye) > 0.09 || this.pool.some((s) => !s.lamp || (s.out && s.f <= 0.02)))) {
      // the lamps nearest the viewer get the real lights, re-chosen only after the head really
      // moved (30 cm), lamps of the room you are in first, lit lamps favoured (hysteresis), and a
      // lamp that drops out fades away fully before its light is reused (no visible swaps)
      if (!this._selAt) this._selAt = eye.clone(); else this._selAt.copy(eye);
      const ls = g.lifeSupport;
      const here = ls ? ls.zoneAt(g.player.pos) : null;
      const lit = new Set(this.pool.filter((s) => s.lamp && !s.out).map((s) => s.lamp));
      const want = new Set(lamps.map((l) => {
        let d = l.pos.distanceToSquared(eye);
        if (here && l.room && l.room !== here && l.room !== 'corridor' && l.room !== 'station') d *= 2.2;
        if (lit.has(l)) d *= 0.5;
        return { l, d };
      }).sort((a, b) => a.d - b.d).slice(0, this.pool.length).map((x) => x.l));
      for (const slot of this.pool) if (slot.lamp) slot.out = !want.has(slot.lamp);
      for (const l of want) {
        if (this.pool.some((s) => s.lamp === l)) continue;
        let free = this.pool.find((s) => !s.lamp);
        if (!free) free = this.pool.find((s) => s.out && s.f <= 0.02);
        if (free) { free.lamp = l; free.f = 0; free.out = false; }
      }
    }
    const flick = this.flicker || 0;
    const al = this.alarm;
    const t = performance.now() / 1000;
    const on = al.active && !al.silenced;
    const pulse = 0.5 + 0.5 * Math.sin(t * 7.5);
    const power = this.power ?? 1;
    for (const slot of this.pool) {
      const L = slot.lamp;
      if (!L) { slot.light.intensity = 0; continue; }
      slot.f = slot.out ? Math.max(0, slot.f - dt * 1.4) : Math.min(1, slot.f + dt * 1.8);
      if (slot.f <= 0 && slot.out) { slot.lamp = null; slot.out = false; slot.light.intensity = 0; continue; }
      slot.light.position.copy(L.pos);
      slot.light.distance = L.range || 7;
      slot.light.color.set(this.lightMode === 'night' ? 0xff3020 : L.color);
      // master alarm: emergency red wash pulsing with the siren
      if (on) slot.light.color.lerp(ALARM_RED, 0.18 + 0.3 * pulse);
      const f = flick > 0 && Math.random() < flick ? 0.1 : 1;   // impact jolt: lamps stutter for a moment
      // brown-out: lamps sag and stutter when the power bus is weak
      const brown = power < 0.45 && Math.random() < (0.45 - power) * 0.2 ? 0.45 : 1;
      const fe = slot.f * slot.f * (3 - 2 * slot.f);
      slot.light.intensity = L.intensity * (L.room === 'station' ? 1 : 1.3) * fe * Math.max(dim, on ? 0.25 : 0) * f * brown * Math.max(0.15, power) * (on ? 0.75 + 0.45 * pulse : 1);
    }
    // alarm beacons: rotating red spots
    for (let i = 0; i < this.beacons.length; i++) {
      const b = this.beacons[i];
      b.intensity = on ? 26 * Math.max(0.6, al.level) : 0;
      const a = t * 6.5 + i * 2.1;
      b.target.position.set(b.position.x + Math.cos(a) * 2, b.position.y - 1.2, b.position.z + Math.sin(a) * 2);
      b.target.updateMatrixWorld();
    }
    if (this.g.shipVis.M.lampRed) this.g.shipVis.M.lampRed.emissiveIntensity = on ? 2 + 10 * pulse : 0.4;
    // danger state: the red lamps stay lit (faster pulse the worse it is) and the cabin light turns
    // reddish even after the siren has been silenced
    const danger = this.danger || 0;
    const dp = 0.5 + 0.5 * Math.sin(t * (danger >= 3 ? 9 : danger >= 2 ? 5 : 2.4));
    const Mv = this.g.shipVis.M;
    if (Mv.dangerLamp) Mv.dangerLamp.emissiveIntensity = danger > 0 ? (danger >= 2 ? 3 + 9 * dp : 1.2 + 2.5 * dp) * Math.max(0.3, power) : 0;
    if (Mv.navDanger) Mv.navDanger.emissiveIntensity = danger > 0 && dp > 0.55 ? 5 : 0;
    // emergency lighting: the cabin goes red (stronger and pulsing as it gets worse)
    if (danger > 0 && !on) {
      const k = [0, 0.32, 0.52, 0.68][danger] + 0.12 * dp * (danger - 1) / 2;
      for (const slot of this.pool) if (slot.lamp && slot.lamp.room !== 'station') slot.light.color.lerp(ALARM_RED, k);
    }
    // exterior visible in the MID pass when the camera is away from the ship
    const far = camDist > 40;
    for (const s of this.subs) if (s.updateVisual) s.updateVisual(dt, camDist);
  }
}
