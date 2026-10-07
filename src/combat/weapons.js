// The guns Kaito (and the two AIs) can use.
//  H8: two twin 25 mm cannon turrets (one high on the port bow, one low on the starboard bow), a
//      railgun turret on the belly and two box launchers with six homing missiles each. Every
//      turret has its own fire control (ballistics.js): it tracks the target, solves the shot by
//      flying it, turns the turret onto the solution at the turret's own slew rate, and fires
//      rounds that scatter as real ones do. A turret only fires where the sphere does not stand in
//      the way, and never with anything friendly in the line of fire (B-29, H8, a station).
//      Targets: whatever the 360 display has locked — the focus first, at the point Kaito picked on
//      it — drones and rocks on their own, out to 30 km for Kaito's own fire.
//  B-29: one old debris-defence gun in a turret under the belly (an older, coarser fire control).
// Kaito fires from the pilot seat (hold the trigger button; railgun and missile salvo buttons in
// H8); HACHI (H8's turrets) and Asphalt (B-29's gun) fire on their own at drones that come close
// while their "auto" is on. Ammunition is limited and refilled at a station berth.
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';
import { sectionPoint, sectionNormal } from '../ship/hullShape.js';
import { H8 } from '../h8/h8Spec.js';
import { frameAt } from '../h8/h8Exterior.js';
import { assignLayers, LAYER_NEAR, LAYER_MID } from '../core/layers.js';
import { leadDir, ROUNDS, rockId } from './combat.js';
import { AMMO, GUNS, FireControl, seedOf } from './ballistics.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();
const Z = V(0, 0, -1);

export const AMMO_MAX = { cannon: 1600, rail: 24, missile: 12, pd: 900 };
/** how far Kaito's own fire reaches (the fire control engages out to here) */
export const MAX_RANGE = 30000;
// the sensors' tracking errors (1 sd): H8's own, B-29's old set
const SENSOR_H8 = { ang: 0.07e-3, range: 0.8, vel: 0.04 };
const SENSOR_B29 = { ang: 0.35e-3, range: 3, vel: 0.2 };

function weaponMaterials() {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  return {
    gunMetal: S({ color: 0x3a3f46, metalness: 0.8, roughness: 0.38 }),
    gunDark: S({ color: 0x1b1d21, metalness: 0.6, roughness: 0.5 }),
    barrel: S({ color: 0x6c737b, metalness: 0.95, roughness: 0.28 }),
    hazard: S({ color: 0xd9a21b, metalness: 0.2, roughness: 0.6 }),
    coil: S({ color: 0xb8742c, metalness: 0.9, roughness: 0.35 }),
    railGlow: S({ color: 0x000000, emissive: new THREE.Color(0.35, 0.7, 1.0), emissiveIntensity: 0 }),
    podLid: S({ color: 0x8c949c, metalness: 0.5, roughness: 0.45 }),
    sensor: S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.25, 0.1), emissiveIntensity: 2 }),
  };
}

/** a turret: base on the hull, a head that turns (yaw) and a cradle that elevates (pitch).
 *  Local frame: +y = the hull normal at the mount. kind: 'twin' | 'rail' | 'pd' */
function turret(M, kind) {
  const base = new Builder(), head = new Builder(), cradle = new Builder();
  const big = kind === 'rail';
  base.cyl(big ? 0.42 : 0.32, big ? 0.48 : 0.36, 0.14, 'gunDark', [0, 0.05, 0], null, 24);
  base.torus(big ? 0.43 : 0.33, 0.025, 'hazard', [0, 0.12, 0], [Math.PI / 2, 0, 0], 32);
  head.cyl(big ? 0.34 : 0.26, big ? 0.38 : 0.3, 0.14, 'gunMetal', [0, 0.2, 0], null, 20);
  head.box(big ? 0.56 : 0.42, big ? 0.26 : 0.22, big ? 0.62 : 0.44, 'gunMetal', [0, 0.36, 0.02], null, 0.05);
  head.box(0.1, 0.08, 0.1, 'gunDark', [big ? 0.22 : 0.17, 0.5, -0.12], null, 0.01);
  head.sphere(0.03, 'sensor', [big ? 0.22 : 0.17, 0.5, -0.18], 8);
  if (kind === 'twin' || kind === 'pd') {
    const n = kind === 'twin' ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const x = n === 2 ? (i ? 0.075 : -0.075) : 0;
      cradle.cyl(0.05, 0.05, 0.22, 'gunDark', [x, 0, -0.18], [Math.PI / 2, 0, 0], 10);
      cradle.cyl(0.028, 0.032, 0.86, 'barrel', [x, 0, -0.68], [Math.PI / 2, 0, 0], 10);
      cradle.cyl(0.042, 0.042, 0.08, 'gunDark', [x, 0, -1.1], [Math.PI / 2, 0, 0], 10);
    }
    cradle.box(0.26, 0.14, 0.3, 'gunDark', [0, 0, 0.02], null, 0.03);
    cradle.box(0.16, 0.1, 0.18, 'gunMetal', [0, -0.12, 0.05], null, 0.02);      // feed chute
  } else {
    // railgun: two rails in a long frame, coil rings, a glow along the bore when charged
    cradle.box(0.32, 0.22, 0.5, 'gunDark', [0, 0, 0.05], null, 0.04);
    for (const s of [-1, 1]) cradle.box(0.05, 0.16, 2.1, 'barrel', [s * 0.07, 0, -1.2], null, 0.01);
    cradle.box(0.2, 0.04, 2.1, 'gunMetal', [0, 0.1, -1.2], null, 0.01);
    cradle.box(0.2, 0.04, 2.1, 'gunMetal', [0, -0.1, -1.2], null, 0.01);
    for (let k = 0; k < 7; k++) cradle.torus(0.15, 0.03, 'coil', [0, 0, -0.45 - k * 0.3], [0, 0, 0], 16);
    cradle.box(0.06, 0.06, 2.0, 'railGlow', [0, 0, -1.2], null, 0.01);
  }
  const g = new THREE.Group();
  const b = base.build(M, { castShadow: false });
  const hYaw = new THREE.Group();
  hYaw.add(head.build(M, { castShadow: false }));
  const hPitch = new THREE.Group();
  hPitch.position.set(0, 0.36, 0);
  const cr = cradle.build(M, { castShadow: false });
  hPitch.add(cr);
  hYaw.add(hPitch);
  g.add(b, hYaw);
  g.userData = { yaw: hYaw, pitch: hPitch, barrels: cr, kind };
  return g;
}

/** missile box launcher: six cells with lids that blow off as they launch */
function pod(M) {
  const b = new Builder();
  b.box(0.62, 0.34, 0.9, 'gunMetal', [0, 0.17, 0], null, 0.04);
  b.box(0.66, 0.06, 0.94, 'hazard', [0, 0.02, 0], null, 0.01);
  const g = b.build(M, { castShadow: false });
  const lids = [];
  for (let i = 0; i < 6; i++) {
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.24), M.podLid);
    lid.position.set(-0.2 + (i % 3) * 0.2, 0.35, -0.18 + Math.floor(i / 3) * 0.36);
    g.add(lid);
    lids.push(lid);
  }
  g.userData = { lids };
  return g;
}

export class Weapons {
  constructor(game, combat) {
    this.g = game;
    this.combat = combat;
    this.M = weaponMaterials();
    this.ammo = { cannon: AMMO_MAX.cannon, rail: AMMO_MAX.rail, missile: AMMO_MAX.missile, pd: AMMO_MAX.pd };
    this.auto = { hachi: true, asphalt: true };
    this.tgtIndex = { h8: 0, b29: 0 };
    this.railCharge = 1;
    this.mslT = 0;
    this.salvo = [];
    this.fireHeld = false;
    this.h8Mounts = [];
    this.b29Mount = null;
    this.buildH8();
    this.buildB29();
    this.hud = document.getElementById('hud-tgt');
    this.hudCtx = this.hud ? this.hud.getContext('2d') : null;
    this.lastTarget = null;
  }

  // ------------------------------------------------------------------ hardware
  buildH8() {
    const h8 = this.g.h8;
    if (!h8) return;
    const R = H8.R;
    const mk = (name, dir, kind) => {
      const t = turret(this.M, kind);
      const f = frameAt(dir.clone().normalize());
      t.matrix.makeBasis(f.x, f.y, f.z).setPosition(dir.clone().normalize().multiplyScalar(R - 0.03));
      t.matrixAutoUpdate = false;
      t.updateMatrixWorld(true);
      h8.ext.group.add(t);
      const m = { name, kind, group: t, dir: dir.clone().normalize(), frame: f, cool: 0, alt: 0, recoil: 0, aim: null, flash: 0, cur: dir.clone().normalize(),
        fc: new FireControl({ am: kind === 'rail' ? AMMO.rail : AMMO.c25, gun: kind === 'rail' ? GUNS.rail : GUNS.twin25, seed: seedOf('h8.' + name), sensor: { ...SENSOR_H8 } }) };
      this.h8Mounts.push(m);
      return m;
    };
    mk('gunA', V(-0.75, 0.2, -0.63), 'twin');
    mk('gunB', V(0.72, -0.35, -0.6), 'twin');
    mk('rail', V(-0.3, -0.8, -0.5), 'rail');
    this.pods = [];
    for (const s of [-1, 1]) {
      const p = pod(this.M);
      const d = V(s * 0.82, 0.3, 0.48).normalize();
      const f = frameAt(d);
      p.matrix.makeBasis(f.x, f.y, f.z).setPosition(d.clone().multiplyScalar(R - 0.04));
      p.matrixAutoUpdate = false;
      h8.ext.group.add(p);
      this.pods.push({ group: p, dir: d, frame: f, side: s });
    }
    // the hull meshes follow H8's own layer handling
    const meshes = [];
    for (const m of this.h8Mounts) m.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const p of this.pods) p.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const o of meshes) { o.layers.set(LAYER_NEAR); o.frustumCulled = false; if (o.parent && o.parent !== h8.ext.group) o.matrixAutoUpdate = true; }
    h8.extMeshes.push(...meshes);
  }

  buildB29() {
    const g = this.g;
    const z = 1.8, t = -Math.PI / 2;
    const p = sectionPoint(z, t, 0), n = sectionNormal(z, t, 0).normalize();
    const tr = turret(this.M, 'pd');
    const f = frameAt(n, V(0, 0, -1));
    tr.matrix.makeBasis(f.x, f.y, f.z).setPosition(p.clone().addScaledVector(n, -0.02));
    tr.matrixAutoUpdate = false;
    g.shipVis.exterior.add(tr);
    tr.traverse((o) => { if (o.isMesh) { o.layers.set(LAYER_NEAR); o.layers.enable(LAYER_MID); o.frustumCulled = false; } });
    this.b29Mount = { name: 'pd', kind: 'pd', group: tr, dir: n, frame: f, local: p.clone(), cool: 0, alt: 0, recoil: 0, aim: null, flash: 0, cur: n.clone(),
      fc: new FireControl({ am: AMMO.p30, gun: GUNS.pd30, seed: seedOf('b29.pd'), sensor: { ...SENSOR_B29 }, accT: 1.0 }) };
  }

  // ------------------------------------------------------------------ who is where
  /** the vessel whose guns Kaito has at hand (in its pilot seat), or null */
  manned() {
    const g = this.g, pl = g.player;
    if (pl.state !== 'seated' || !pl.seat || pl.seat.kind !== 'pilot') return null;
    return pl.seat.h8 ? 'h8' : 'b29';
  }

  /** world pose of a vessel: { pos, vel, quat } */
  pose(which) {
    const g = this.g;
    if (which === 'h8') return { pos: g.h8.flight.pos, vel: g.h8.flight.vel, quat: g.h8.flight.quat };
    return { pos: g.flight.pos, vel: g.flight.vel, quat: g.flight.quat };
  }

  /**
   * What a vessel can shoot at: drones, rocks and (H8) everything its display has locked. Each:
   * { id, kind, ref, pos, vel, acc, aim (the point to hit, ECI; null: its middle), R (the size it
   * presents, m), agility (how hard it can jink, m/s^2), name, dist, threat, locked }; the
   * focus first, then the threats, then the nearest
   */
  targets(which) {
    const g = this.g, P = this.pose(which), out = [];
    const hud = which === 'h8' && g.h8 && g.h8.hud;
    const lockOf = (id) => (hud ? hud.locks.find((l) => l.id === id) : null);
    const add = (o) => {
      const l = lockOf(o.id);
      if (l) { o.locked = true; if (l.aim) o.aim = hud.aimPoint(l); }
      o.dist = (o.aim || o.pos).distanceTo(P.pos);
      out.push(o);
    };
    const reach = which === 'h8' ? MAX_RANGE + 5000 : 12000;
    if (g.drones) for (const d of g.drones.list) if (d.alive && d.pos.distanceTo(P.pos) < reach) {
      add({ id: 'dr:' + d.id, kind: 'drone', ref: d, pos: d.pos, vel: d.vel, acc: d.thrust, R: 1.0, agility: d.state === 'evade' ? 45 : d.state === 'attack' ? 14 : 6, name: d.id, threat: true });
    }
    for (const a of g.asteroids.list) if (!a.dead && !a.hit && a.pos.distanceTo(P.pos) < (which === 'h8' ? 8000 : 4000)) add({ id: rockId(a), kind: 'rock', ref: a, pos: a.pos, vel: a.vel, acc: null, R: a.radius, agility: 0, name: '岩塊' });
    if (hud) {
      for (const l of hud.locks) {
        const c = l.c;
        if (!c || c.kind === 'drone' || c.kind === 'rock' || c.kind === 'body' || !c.pos) continue;
        if (c.pos.distanceTo(P.pos) > reach) continue;
        const ref = c.ref || null;
        // (a station shows less than its whole bounding sphere: trusses, panels, gaps)
        const R = c.kind === 'station' ? hud.radiusOf(c) * 0.55 : c.kind === 'b29' ? 7 : hud.radiusOf(c) * 0.7;
        const acc = c.kind === 'b29' ? g.flight.thrustAcc : null;
        add({ id: c.id, kind: c.kind, ref, pos: c.pos, vel: c.vel || P.vel, acc, R, agility: c.kind === 'b29' ? 3 : 0, name: c.short || c.name, locked: true });
      }
    }
    const prim = hud ? hud.primaryId : null;
    out.sort((a, b) => (b.id === prim ? 1 : 0) - (a.id === prim ? 1 : 0) || (b.threat ? 1 : 0) - (a.threat ? 1 : 0) || a.dist - b.dist);
    return out;
  }

  /** the target the guns are on: H8's focus (else the nearest threat); B-29's: the one cycled to */
  primary(which) {
    const T = this.targets(which);
    if (!T.length) return null;
    if (which === 'h8') {
      const hud = this.g.h8 && this.g.h8.hud;
      return (hud && T.find((x) => x.id === hud.primaryId)) || T.find((x) => x.threat) || T[0];
    }
    return T[this.tgtIndex[which] % T.length];
  }

  /** the next target: H8's display moves its focus on through the locks */
  cycleTarget() {
    const w = this.manned();
    if (!w) return;
    const g = this.g;
    if (w === 'h8' && g.h8 && g.h8.hud) {
      const T = this.targets('h8');
      if (T.length) {
        const i = T.findIndex((x) => x.id === g.h8.hud.primaryId);
        const next = T[(i + 1) % T.length];
        const c = g.h8.cands.find((x) => x.id === next.id);
        if (c) g.h8.hud.lock(c, true);
      }
    } else this.tgtIndex[w] = (this.tgtIndex[w] + 1) % Math.max(1, this.targets(w).length);
    g.audio.beep && g.audio.beep(1700, 0.04, 0.04, { direct: true });
  }

  // ------------------------------------------------------------------ simulation
  update(sdt, inp) {
    const g = this.g;
    const dt = Math.min(sdt, 0.1);
    const w = this.manned();
    // buttons
    if (inp && w) {
      if (inp.pressed['b-tgt']) this.cycleTarget();
      if (inp.pressed['b-auto']) this.toggleAuto(w);
      if (w === 'h8' && inp.pressed['b-rail']) this.fireRail(true);
      if (w === 'h8' && inp.pressed['b-msl']) this.salvoMissiles(true);
      const fb = g.input.btn && g.input.btn['b-fire'];
      this.fireHeld = !!(fb && fb.down) || !!(g.input.keys && g.input.keys.has('KeyF'));
      if (g.input.keys && g.input.keys.has('KeyR')) { g.input.keys.delete('KeyR'); if (w === 'h8') this.fireRail(true); }
      if (g.input.keys && g.input.keys.has('KeyM')) { g.input.keys.delete('KeyM'); if (w === 'h8') this.salvoMissiles(true); }
      if (g.input.keys && g.input.keys.has('KeyT')) { g.input.keys.delete('KeyT'); this.cycleTarget(); }
    } else this.fireHeld = false;
    // H8's guns
    const h8 = g.h8;
    if (h8 && h8.mode !== 'parked' && h8.mode !== 'pod' && h8.mode !== 'lost' && h8.awake > 0.5) {
      this.railCharge = Math.min(1, this.railCharge + dt / 3.5);
      // the sensors: H8's own (worse with the sensor circuit cut); HACHI reads the drones' runs
      const sens = (1 + 6 * (1 - h8.circ('sensor', 0.1))) * (h8.mind ? h8.mind.spread('h8') : 1);
      for (const m of this.h8Mounts) {
        const S = m.fc.sensor;
        S.ang = SENSOR_H8.ang * sens; S.range = SENSOR_H8.range * sens; S.vel = SENSOR_H8.vel * sens;
        m.fc.accT = 0.6 * (h8.mind ? 1 - 0.5 * h8.mind.learn : 1);
        m.fc.tick(dt);
      }
      const auto = this.auto.hachi && !(w === 'h8' && this.fireHeld);
      const tgt = w === 'h8' ? this.primary('h8') : null;
      for (const m of this.h8Mounts) {
        if (m.kind !== 'twin') continue;
        m.cool -= dt;
        let T = null, manual = false;
        if (w === 'h8' && this.fireHeld) { T = tgt; manual = true; }
        else if (auto) T = this.autoTarget('h8', 2800);
        this.aimAndFire(m, 'h8', T, dt, !!T && (this.fireHeld || auto), manual);
      }
      // the railgun's turret follows the focus while it is charged (so a shot can go at once)
      const rail = this.h8Mounts.find((x) => x.kind === 'rail');
      if (rail) { const T = w === 'h8' ? tgt : null; this.aimAndFire(rail, 'h8', T, dt, false, true); }
      // HACHI's missiles: at a drone that keeps coming, one at a time
      if (this.auto.hachi && w !== 'h8' && this.ammo.missile > 0 && g.drones && g.drones.attacking > 0) {
        this.autoMslT = (this.autoMslT || 6) - dt;
        if (this.autoMslT <= 0) {
          this.autoMslT = 9;
          const T = this.targets('h8').find((x) => x.kind === 'drone' && x.dist > 1500 && x.dist < 9000);
          if (T) this.launchMissile(T, false);
        }
      }
      // queued salvo launches
      this.mslT -= dt;
      if (this.salvo.length && this.mslT <= 0) { this.mslT = 0.35; this.launchMissile(this.salvo.shift(), true); }
    }
    // B-29's defence gun (HACHI shares its track over the link: a better solution)
    if (this.b29Mount) {
      const m = this.b29Mount;
      const linked = h8 && h8.mind ? h8.mind.spread('b29') : 1;
      const S = m.fc.sensor;
      S.ang = SENSOR_B29.ang * linked; S.range = SENSOR_B29.range * linked; S.vel = SENSOR_B29.vel * linked;
      m.fc.tick(dt);
      m.cool -= dt;
      const manual = w === 'b29' && this.fireHeld;
      let T = null;
      if (manual) T = this.primary('b29');
      else if (this.auto.asphalt && !(g.h8 && g.h8.solo)) T = this.autoTarget('b29', 2200);
      this.aimAndFire(m, 'b29', T, dt, !!T, manual);
    }
    this.lastTarget = w ? this.primary(w) : null;
  }

  /** for the AIs: the nearest drone within range, or a small rock on a collision course */
  autoTarget(which, range) {
    const T = this.targets(which);
    // HACHI weighs the threats (and shares them out with B-29's gun over the link)
    const M = this.g.h8 && this.g.h8.mind;
    if (M) return M.pickTarget(which, range, T);
    return T.find((x) => x.kind === 'drone' && x.dist < range) || null;
  }

  toggleAuto(which) {
    const k = which === 'h8' ? 'hachi' : 'asphalt';
    this.auto[k] = !this.auto[k];
    const g = this.g;
    if (which === 'h8' && g.h8) g.h8.say(this.auto[k] ? 'hachi_auto_on' : 'hachi_auto_off', {}, { force: true });
    else g.asphalt.say(this.auto[k] ? 'pd_auto_on' : 'pd_auto_off', {}, { force: true });
  }

  /** world position and outward normal of a mount */
  mountWorld(m, which) {
    const P = this.pose(which);
    if (which === 'h8') {
      const pos = m.dir.clone().multiplyScalar(H8.R + 0.5).applyQuaternion(P.quat).add(P.pos);
      return { pos, n: m.dir.clone().applyQuaternion(P.quat), P };
    }
    const pos = m.local.clone().addScaledVector(m.dir, 0.5).applyQuaternion(P.quat).add(P.pos);
    return { pos, n: m.dir.clone().applyQuaternion(P.quat), P };
  }

  /**
   * The fire control on a target: track it, solve the shot, turn the turret onto it at its slew
   * rate; fire when the barrels are on the solution, the target is within reach and nothing
   * friendly is in the line of fire. manual: Kaito's own fire (out to 30 km)
   */
  aimAndFire(m, which, T, dt, wantFire, manual = false) {
    const g = this.g;
    const W = this.mountWorld(m, which);
    const qi = _q.copy(W.P.quat).invert();
    const kind = m.kind === 'twin' ? 'cannon' : m.kind;
    // the turret swings toward where it is told to look (stowed when there is nothing)
    const slew = (want) => {
      const c = m.cur, ang = c.angleTo(want);
      const step = m.fc.gun.slew * dt;
      if (ang <= step) c.copy(want); else c.lerp(want, step / ang).normalize();
    };
    if (!T) { m.aim = null; m.sol = null; slew(m.dir); return; }
    const F = m.fc;
    F.observe(T.id, T.pos, T.vel, T.acc, dt);
    const sol = F.solve(T.id, W.pos, W.P.vel, T.aim || null);
    if (!sol) { m.aim = null; m.sol = null; slew(m.dir); return; }
    const dir = sol.aimDir;
    // below the mount's horizon the hull blocks it
    if (dir.dot(W.n) < -0.12) { m.aim = null; m.sol = null; slew(m.dir); return; }
    m.sol = sol;
    m.aim = dir.clone().applyQuaternion(qi);       // vessel-local, where the turret turns to
    slew(m.aim);
    if (m.kind === 'rail') return;
    const dist = (T.aim || T.pos).distanceTo(W.pos);
    const reach = manual && which === 'h8' ? Math.min(MAX_RANGE, F.am.maxRange) : (kind === 'pd' ? 2600 : 3200);
    if (!wantFire || m.cool > 0 || dist > reach || !sol.ok) return;
    // the barrels on the solution (within a milliradian)?
    if (m.cur.angleTo(m.aim) > 1.2e-3) return;
    // never through anything friendly
    const block = this.blocked(which, W.pos, dir, dist, T, F.am.v0 * F.am.life);
    if (block) { if (manual && which === 'h8' && g.h8) g.h8.say('hachi_friendly', {}, { minGap: 8, force: false }); return; }
    if (kind === 'cannon' && this.ammo.cannon <= 0) { this.dry(which); return; }
    if (kind === 'pd' && this.ammo.pd <= 0) { this.dry(which); return; }
    // H8's fire control circuit cut: the servo cannot hold the guns steady (and once it is gone,
    // they do not fire at all)
    const fcc = which === 'h8' && g.h8 ? g.h8.circuits.fire : 1;
    if (fcc < 0.12) { m.aim = null; return; }
    m.cool = 1 / F.gun.rof;
    m.alt = 1 - m.alt;
    this.ammo[kind]--;
    m.recoil = 1;
    m.flash = 0.05;
    const side = new THREE.Vector3().crossVectors(dir, W.n).normalize().multiplyScalar(m.kind === 'twin' ? (m.alt ? 0.075 : -0.075) : 0);
    const muzzle = W.pos.clone().addScaledVector(dir, 1.1).add(side);
    const round = F.fire(muzzle, W.P.vel, dir, 1 + 5 * (1 - fcc));
    this.combat.fire({ kind, round, pos: muzzle, vel: W.P.vel, dir, owner: which === 'h8' ? g.h8 : g.flight, byPlayer: true });
    this.gunSound(which, kind);
  }

  /**
   * Something friendly in the line of fire from p along dir (ECI): the other ship of the pair,
   * B-29 or H8 nearby, a station (unless it is the target itself) — in front of the target or
   * behind it, as far as a round that misses would fly on (reach, m). Returns what, or null
   */
  blocked(which, p, dir, range, T = null, reach = range) {
    const g = this.g;
    const far = Math.max(range, reach);
    const lineHits = (c, r) => {
      const t = _v.copy(c).sub(p).dot(dir);
      if (t < 0 || t > far + r) return false;
      return _v.copy(p).addScaledVector(dir, t).distanceTo(c) < r;
    };
    // the other ship: close by, its real shape; further off, its size
    const other = which === 'h8' ? { pos: g.flight.pos, quat: g.flight.quat, spheres: g.docking.shipSpheres, R: 24, kind: 'b29' } : g.h8 && g.h8.mode !== 'parked' && g.h8.mode !== 'docked' && g.h8.mode !== 'lost' ? { pos: g.h8.flight.pos, quat: g.h8.flight.quat, spheres: [{ c: V(0, 0, 0), r: H8.R + 0.6 }], R: H8.R + 2, kind: 'h8' } : null;
    if (other && !(T && T.kind === other.kind)) {
      const d0 = other.pos.distanceTo(p);
      if (d0 < 200) {
        const qi = _q2.copy(other.quat).invert();
        const o = p.clone().sub(other.pos).applyQuaternion(qi), d = dir.clone().applyQuaternion(qi);
        for (const s of other.spheres) {
          const t = s.c.clone().sub(o).dot(d);
          if (t < 0 || t > range) continue;
          if (o.clone().addScaledVector(d, t).distanceTo(s.c) < s.r + 0.8) return other.kind;
        }
      } else if (lineHits(other.pos, other.R + 6)) return other.kind;
    }
    // the stations (their bounding spheres: rounds that miss scatter far beyond the target)
    for (const s of g.stations.list) {
      if (T && T.kind === 'station' && T.ref === s) continue;
      if (s.dmg && s.dmg.destroyed) continue;
      const R = (s.model && s.model.userData.radius) || 150;
      if (s.pos.distanceTo(p) > far + R) continue;
      if (lineHits(s.pos, R + 30)) return 'station';
    }
    return null;
  }

  /** the fire control's odds of a hit on a target (from targets()): 'cannon' (a 1 s burst from
   * both turrets) or 'rail' (one slug); null when it cannot tell */
  hitChance(T, kind = 'cannon') {
    const g = this.g;
    if (!T || !g.h8) return null;
    const key = T.id + '|' + kind, now = performance.now();
    this._odds = this._odds || new Map();
    const c = this._odds.get(key);
    if (c && now - c.t < 250) return c.p;
    const m = kind === 'rail' ? this.h8Mounts.find((x) => x.kind === 'rail') : this.h8Mounts.find((x) => x.kind === 'twin');
    if (!m) return null;
    const W = this.mountWorld(m, 'h8');
    if (!m.fc.tracks.has(T.id)) m.fc.observe(T.id, T.pos, T.vel, T.acc, 0);
    const fcc = g.h8.circuits ? g.h8.circuits.fire : 1;
    const o = m.fc.odds(T.id, W.pos, W.P.vel, T.R || 2, T.agility || 0, kind === 'rail' ? 1 : 24, 1 + 5 * (1 - fcc), T.aim || null);
    const p = o ? (fcc < 0.12 ? 0 : o.pBurst) : null;
    this._odds.set(key, { t: now, p });
    if (this._odds.size > 64) this._odds.clear();
    return p;
  }

  dry(which) {
    this.dryT = (this.dryT || 0) - 0.016;
    if (this.dryT > 0) return;
    this.dryT = 8;
    if (which === 'h8' && this.g.h8) this.g.h8.say('hachi_ammo_out', {}, { minGap: 20, force: false });
    else this.g.asphalt.say('pd_ammo_out', {}, { minGap: 20 });
  }

  fireRail(manual) {
    const g = this.g, h8 = g.h8;
    if (!h8 || h8.awake < 0.5) return;
    const m = this.h8Mounts.find((x) => x.kind === 'rail');
    if (this.ammo.rail <= 0) { this.dry('h8'); return; }
    if (this.railCharge < 1) { h8.say('hachi_rail_charging', { pct: Math.round(this.railCharge * 100) }, { minGap: 3, force: false }); return; }
    const T = this.primary('h8');
    if (!T) { h8.say('hachi_no_target', {}, { minGap: 4, force: false }); return; }
    const W = this.mountWorld(m, 'h8');
    const dist = (T.aim || T.pos).distanceTo(W.pos);
    if (dist > MAX_RANGE) { h8.say('hachi_out_of_range', { d: (dist / 1000).toFixed(1) + ' km' }, { minGap: 4, force: false }); return; }
    m.fc.observe(T.id, T.pos, T.vel, T.acc, 0);
    const sol = m.fc.solve(T.id, W.pos, W.P.vel, T.aim || null);
    const dir = sol && sol.aimDir;
    if (!dir || dir.dot(W.n) < -0.12 || this.blocked('h8', W.pos, dir, dist, T, m.fc.am.v0 * m.fc.am.life)) { h8.say('hachi_rail_blocked', {}, { minGap: 4, force: false }); return; }
    m.aim = dir.clone().applyQuaternion(_q.copy(W.P.quat).invert());
    m.cur.copy(m.aim);
    this.railCharge = 0;
    this.ammo.rail--;
    m.recoil = 1;
    m.flash = 0.18;
    h8.power.smes = Math.max(0, h8.power.smes - 900);
    const muzzle = W.pos.clone().addScaledVector(dir, 2.4);
    const fcc = h8.circuits ? h8.circuits.fire : 1;
    this.combat.fire({ kind: 'rail', round: m.fc.fire(muzzle, W.P.vel, dir, 1 + 5 * (1 - fcc)), pos: muzzle, vel: W.P.vel, dir, owner: h8, byPlayer: manual });
    this.gunSound('h8', 'rail');
    // the kick goes through H8 (and B-29 when they are joined)
    g.shake = Math.max(g.shake, h8.crew ? 1.6 : 0.6);
    if (h8.seatKick) h8.seatKick(1.4);
  }

  /** one missile at each locked target (drones first), a beat apart */
  salvoMissiles(manual) {
    const g = this.g, h8 = g.h8;
    if (!h8 || h8.awake < 0.5) return;
    if (this.ammo.missile <= 0) { this.dry('h8'); return; }
    const T = this.targets('h8').filter((x) => x.kind === 'drone' || x.locked);
    if (!T.length) { h8.say('hachi_no_target', {}, { minGap: 4, force: false }); return; }
    const n = Math.min(this.ammo.missile, T.length);
    this.salvo.push(...T.slice(0, n));
    h8.say('hachi_salvo', { n }, { force: true });
  }

  launchMissile(T, manual) {
    const g = this.g, h8 = g.h8;
    if (this.ammo.missile <= 0 || !T || (T.ref && T.ref.alive === false)) return;
    const pod = this.pods[this.ammo.missile % 2];
    const cell = (AMMO_MAX.missile - this.ammo.missile) >> 1;
    this.ammo.missile--;
    const P = this.pose('h8');
    const out = pod.dir.clone().applyQuaternion(P.quat);
    const pos = pod.dir.clone().multiplyScalar(H8.R + 0.6).applyQuaternion(P.quat).add(P.pos);
    const tgt = T.ref && T.ref.pos ? T.ref : { pos: T.pos, vel: T.vel, R: T.R, kind: T.kind };
    if (!tgt.kind) tgt.kind = T.kind;
    this.combat.fire({ kind: 'missile', pos, vel: P.vel.clone().addScaledVector(out, 25), dir: out, owner: h8, target: tgt, byPlayer: manual });
    const lid = pod.group.userData.lids[cell % 6];
    if (lid) lid.visible = false;
    this.gunSound('h8', 'missile');
  }

  /** the gun heard (and felt) from inside the vessel that fires it */
  gunSound(which, kind) {
    const g = this.g, A = g.audio;
    if (!A || !A.ready) return;
    const aboard = which === 'h8' ? (g.h8.crew || (g.h8.mode === 'docked' && g.h8.kaitoInside && g.h8.kaitoInside())) || g.h8.mode === 'docked' : !(g.h8 && g.h8.solo);
    if (!aboard) return;
    if (kind === 'rail') {
      A._burst && A._burst(null, { dur: 0.35, freq: 140, q: 0.7, gain: 0.5, type: 'brown', filter: 'lowpass', direct: true });
      A.beep && A.beep(2400, 0.45, 0.06, { direct: true, type: 'sawtooth' });
      return;
    }
    if (kind === 'missile') { A._burst && A._burst(null, { dur: 0.9, freq: 700, q: 0.5, gain: 0.22, type: 'white', sweep: 0.25, direct: true }); return; }
    // a short hard thud per round through the structure
    A._burst && A._burst(null, { dur: 0.07, freq: kind === 'pd' ? 260 : 200, q: 0.9, gain: kind === 'pd' ? 0.18 : 0.22, type: 'brown', filter: 'lowpass', direct: true });
    if (kind !== 'pd' && g.h8 && g.h8.seatKick) g.h8.seatKick(0.12);
  }

  /** refill at a station berth: B-29's gun, and H8's too while it rides on B-29's back */
  rearm(withH8) {
    this.ammo.pd = AMMO_MAX.pd;
    if (!withH8) return;
    this.ammo.cannon = AMMO_MAX.cannon; this.ammo.rail = AMMO_MAX.rail; this.ammo.missile = AMMO_MAX.missile;
    for (const p of this.pods || []) for (const l of p.group.userData.lids) l.visible = true;
  }

  /** anything to refill (B-29 alone, or the pair) */
  needsRearm(withH8) {
    const A = this.ammo;
    return A.pd < AMMO_MAX.pd || (withH8 && (A.cannon < AMMO_MAX.cannon || A.rail < AMMO_MAX.rail || A.missile < AMMO_MAX.missile));
  }

  // ------------------------------------------------------------------ per render frame
  updateVisual(dt, origin, camWorld) {
    const g = this.g;
    // turrets follow their aim (or settle back to stowed), barrels recoil
    const settle = (m) => {
      const ud = m.group.userData;
      let yawT = 0, pitchT = 0;
      const a = m.cur || m.aim;
      if (a && (m.aim || a.angleTo(m.dir) > 1e-3)) {
        // into the mount's frame: yaw about +y, pitch up from the tangent plane
        const f = m.frame;
        const ax = a.dot(f.x), ay = a.dot(f.y), az = a.dot(f.z);
        yawT = Math.atan2(-ax, -az);
        pitchT = Math.atan2(ay, Math.hypot(ax, az));
      }
      // (the turret's pointing is simulated at its slew rate: the model shows exactly that)
      ud.yaw.rotation.y = yawT;
      ud.pitch.rotation.x = Math.max(-0.12, Math.min(1.45, pitchT));
      m.recoil = Math.max(0, m.recoil - dt * 9);
      ud.barrels.position.z = 0.09 * m.recoil;
      m.flash = Math.max(0, m.flash - dt);
      ud.yaw.updateMatrix(); ud.pitch.updateMatrix(); ud.barrels.updateMatrix();
      m.group.updateMatrixWorld(true);
    };
    for (const m of this.h8Mounts) settle(m);
    if (this.b29Mount) settle(this.b29Mount);
    if (this.M.railGlow) this.M.railGlow.emissiveIntensity = this.railCharge >= 1 ? 2.5 + Math.sin(performance.now() / 160) : this.railCharge * 1.2;
    this.drawHud(origin, camWorld);
  }

  /** a light combat overlay on the screen: brackets on drones in view, the target and its lead */
  drawHud(origin, camWorld) {
    const g = this.g, cv = this.hud, ctx = this.hudCtx;
    if (!cv || !ctx) return;
    const show = (g.mode === 'pilot' || g.mode === 'camera') && this.manned() !== 'h8' && !(g.focus && !g.focus.out) && g.drones && g.drones.list.some((d) => d.alive && d.pos.distanceTo(this.pose(this.manned() || 'b29').pos) < 40000);
    if (!show) { if (this._hudOn) { ctx.clearRect(0, 0, cv.width, cv.height); cv.style.display = 'none'; this._hudOn = false; } return; }
    if (!this._hudOn) { cv.style.display = 'block'; this._hudOn = true; }
    const W = cv.clientWidth, H = cv.clientHeight, pr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * pr) || cv.height !== Math.round(H * pr)) { cv.width = Math.round(W * pr); cv.height = Math.round(H * pr); }
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cam = g.engine.camera;
    // this frame's view (the camera's own matrices are only refreshed when it renders)
    const view = new THREE.Matrix4().compose(g.camWorld, g.camQuat, new THREE.Vector3(1, 1, 1)).invert();
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, view);
    const proj = (p) => {
      const v = new THREE.Vector4(p.x - origin.x, p.y - origin.y, p.z - origin.z, 1).applyMatrix4(vp);
      if (v.w <= 0) return null;
      return [(v.x / v.w * 0.5 + 0.5) * W, (1 - (v.y / v.w * 0.5 + 0.5)) * H];
    };
    const w = this.manned() || 'b29';
    const P = this.pose(w);
    const tgt = this.lastTarget;
    ctx.font = '600 11px "Hiragino Sans","Noto Sans JP",sans-serif';
    ctx.textAlign = 'center';
    for (const d of g.drones.list) {
      if (!d.alive || d.pos.distanceTo(P.pos) > 80e3) continue;
      const s = proj(d.pos);
      if (!s) continue;
      const dist = d.pos.distanceTo(P.pos);
      const on = tgt && tgt.ref === d;
      const r = on ? 16 : 10;
      ctx.strokeStyle = on ? 'rgba(255,80,60,0.95)' : 'rgba(255,120,80,0.7)';
      ctx.lineWidth = on ? 2 : 1.4;
      ctx.beginPath();
      ctx.moveTo(s[0], s[1] - r); ctx.lineTo(s[0] + r, s[1]); ctx.lineTo(s[0], s[1] + r); ctx.lineTo(s[0] - r, s[1]); ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = on ? 'rgba(255,110,90,0.95)' : 'rgba(255,150,120,0.75)';
      ctx.fillText(`${d.id}  ${dist < 9500 ? Math.round(dist) + ' m' : (dist / 1000).toFixed(1) + ' km'}`, s[0], s[1] + r + 13);
      if (on) {
        // the lead point: where to put the rounds
        const ld = leadDir(P.pos, P.vel, d.pos, d.vel, w === 'h8' ? ROUNDS.cannon.speed : ROUNDS.pd.speed, new THREE.Vector3(), d.thrust);
        if (ld && ld.t) {
          const lp = d.pos.clone().addScaledVector(d.vel.clone().sub(P.vel), ld.t).addScaledVector(d.thrust, 0.5 * ld.t * ld.t);
          const sl = proj(lp);
          if (sl) { ctx.beginPath(); ctx.arc(sl[0], sl[1], 5, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(sl[0], sl[1]); ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]); }
        }
      }
    }
    // ammunition, small, bottom right above the buttons
    if (this.manned()) {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(220,235,255,0.8)';
      const line = w === 'h8' ? `砲 ${this.ammo.cannon}  レール ${this.ammo.rail}${this.railCharge < 1 ? ` (${Math.round(this.railCharge * 100)}%)` : ''}  ミサイル ${this.ammo.missile}  ${this.auto.hachi ? 'HACHI自動' : '手動'}` : `防衛機銃 ${this.ammo.pd}  ${this.auto.asphalt ? '自動' : '手動'}`;
      ctx.fillText(line, W - 16, H - 14);
    }
  }

  // ------------------------------------------------------------------ save
  serialize() { return { ammo: { ...this.ammo }, auto: { ...this.auto } }; }
  restore(s) {
    if (!s) return;
    if (s.ammo) Object.assign(this.ammo, s.ammo);
    if (s.auto) Object.assign(this.auto, s.auto);
    const used = AMMO_MAX.missile - this.ammo.missile;
    for (const p of this.pods || []) p.group.userData.lids.forEach((l, i) => { l.visible = i * 2 + (p.side > 0 ? 1 : 0) >= used; });
  }
}

function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
