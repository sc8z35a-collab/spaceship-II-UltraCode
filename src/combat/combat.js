// Combat: rounds in flight and what they hit. Shells, railgun slugs and missiles fly in ECI with
// gravity, like the ships and the rocks, so a round and its target fall together and only their
// relative motion matters. Every step each round's swept path is tested, in the target's own
// frame, against:
//   B-29 — its real hull meshes (the same BVH ray test the rocks use): a dent, scorch, sometimes a
//          breach, broken equipment, a leaking pipe, the alarm — everything a rock hit does;
//   H8 — its armoured sphere: the plates dent and tear, the armour wears down;
//   drones — their bodies: sparks, smoke, then they blow apart;
//   stations — their hull proxies: pockmarks and holes, venting, fires, failure, wreck;
//   rocks — fragments, or nothing left.
// Rounds are drawn as tracers (screen-space streaks), muzzle and impact flashes as glowing points,
// sparks and debris with the particle system (in the frame of whatever was hit).
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { MU_EARTH } from '../core/astro.js';
import { LAYER_FAR, LAYER_MID, LAYER_NEAR, assignLayers } from '../core/layers.js';
import { EnginePlume } from '../fx/enginePlume.js';
import { Particles } from '../fx/particles.js';
import { H8 } from '../h8/h8Spec.js';
import { AMMO, ENV, Rng, launch, step as flyStep, leadDir as bLead } from './ballistics.js';
import { Builder } from '../ship/geom.js';

/** the missile, nose along -z (1.6 m, 0.2 m across): body, ogive nose with its seeker window,
 * coloured bands, a cruciform of tail fins and body strakes, the motor's nozzle */
function missileModel() {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    mslBody: S({ color: 0xe4e7ea, metalness: 0.45, roughness: 0.38 }),
    mslBand: S({ color: 0xe0a020, metalness: 0.3, roughness: 0.5 }),
    mslRed: S({ color: 0xb8231c, metalness: 0.3, roughness: 0.5 }),
    mslFin: S({ color: 0x8d949b, metalness: 0.7, roughness: 0.35 }),
    mslDark: S({ color: 0x101214, metalness: 0.9, roughness: 0.12 }),
    mslNozzle: S({ color: 0x3a3c40, metalness: 0.85, roughness: 0.45 }),
  };
  const b = new Builder();
  b.cyl(0.1, 0.1, 1.1, 'mslBody', [0, 0, 0.05], [Math.PI / 2, 0, 0], 18);
  b.lathe([[0.1, 0], [0.097, 0.07], [0.086, 0.15], [0.066, 0.22], [0.04, 0.27], [0.012, 0.3], [0, 0.302]], 'mslBody', [0, 0, -0.5], [-Math.PI / 2, 0, 0], 18);
  b.sphere(0.03, 'mslDark', [0, 0, -0.79], 12);
  b.cyl(0.102, 0.102, 0.05, 'mslBand', [0, 0, -0.38], [Math.PI / 2, 0, 0], 18);
  b.cyl(0.102, 0.102, 0.03, 'mslRed', [0, 0, 0.28], [Math.PI / 2, 0, 0], 18);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    b.push([0, 0, 0], [0, 0, a]);
    b.box(0.008, 0.13, 0.24, 'mslFin', [0, 0.16, 0.48], null, 0.002);
    b.box(0.005, 0.045, 0.42, 'mslFin', [0, 0.12, -0.08], null, 0.001);
    b.pop();
  }
  b.cyl(0.075, 0.088, 0.1, 'mslNozzle', [0, 0, 0.65], [Math.PI / 2, 0, 0], 16, true);
  b.cyl(0.092, 0.092, 0.02, 'mslNozzle', [0, 0, 0.6], [Math.PI / 2, 0, 0], 16);
  const g = b.build(M, { castShadow: false });
  g.name = 'missile';
  return g;
}

/** round types: their ammunition (ballistics.js: mass, muzzle velocity, scatter, self-destruct),
 *  effective energy on a hull at the muzzle velocity (J), tracer colour / length, damage to a
 *  drone (0..1 of its health), to a station (health), to a rock */
export const ROUNDS = {
  drone: { am: AMMO.d20, E: 1.25e5, color: [1.0, 0.36, 0.14], len: 24, w: 2.4, drone: 0.06, station: 0.0022, rock: 0.25 },
  cannon: { am: AMMO.c25, E: 1.6e5, color: [1.0, 0.82, 0.32], len: 26, w: 2.6, drone: 0.075, station: 0.003, rock: 0.35 },
  pd: { am: AMMO.p30, E: 7e4, color: [1.0, 0.92, 0.6], len: 18, w: 2.0, drone: 0.045, station: 0.0015, rock: 0.25 },
  rail: { am: AMMO.rail, E: 2.6e7, color: [0.55, 0.85, 1.0], len: 320, w: 3.6, drone: 0.8, station: 0.035, rock: 6 },
  // (a missile: at most 600 m/s faster than the vessel that launched it, 200 s of flight — the
  // 120 km it is launched out to — and six hits from a drone's gun bring it down)
  missile: { speed: 120, E: 3.5e6, life: 200, vMax: 600, hp: 6, color: [1.0, 0.7, 0.4], len: 0, w: 0, drone: 1.3, station: 0.06, rock: 8 },
};
for (const R of Object.values(ROUNDS)) if (R.am) { R.speed = R.am.v0; R.life = R.am.life; }

const MAX_TRACERS = 900;
/** the chance a drone's shell passing close to a missile brings its fuse off on it (by the
 * drone's grade, ★1 .. ★5) */
const FUSE = [0, 0.2, 0.35, 0.52, 0.7, 0.9];
const MAX_FLASH = 160;
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

function grav(p, out) { const r = p.length(); return out.copy(p).multiplyScalar(-MU_EARTH / (r * r * r)); }

/** straight-line lead (the ballistics engine's; for quick estimates — the guns solve their shots
 * by simulation, see ballistics.js) */
export const leadDir = bLead;

let ROCK_SEQ = 0;
/** a rock's id for the sensors and the guns (the same everywhere) */
export function rockId(a) { return a.trackId || (a.trackId = 'rk' + (++ROCK_SEQ)); }

/** first contact of segment p0->p1 with a sphere (centre c, radius R): fraction along it, or -1 */
function segSphere(p0, p1, c, R) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const fx = p0.x - c.x, fy = p0.y - c.y, fz = p0.z - c.z;
  const a = dx * dx + dy * dy + dz * dz, b = 2 * (fx * dx + fy * dy + fz * dz), cc = fx * fx + fy * fy + fz * fz - R * R;
  if (cc <= 0) return 0;
  if (a < 1e-12) return -1;
  const D = b * b - 4 * a * cc;
  if (D < 0) return -1;
  const t = (-b - Math.sqrt(D)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

export class Combat {
  constructor(game) {
    this.g = game;
    this.rounds = [];
    this.flashes = [];
    this.anchors = [];            // particle frames pinned to points in space (drones, rocks)
    this.wrecks = [];             // tumbling pieces
    // tracers
    const geo = new LineSegmentsGeometry();
    this.tPos = new Float32Array(MAX_TRACERS * 6);
    this.tCol = new Float32Array(MAX_TRACERS * 6);
    geo.setPositions(this.tPos);
    geo.setColors(this.tCol);
    geo.instanceCount = 0;
    this.tGeo = geo;
    this.tPosAttr = geo.attributes.instanceStart.data;
    this.tColAttr = geo.attributes.instanceColorStart.data;
    this.tMat = new LineMaterial({ color: 0xffffff, linewidth: 2.4, vertexColors: true, worldUnits: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.tracers = new LineSegments2(geo, this.tMat);
    this.tracers.frustumCulled = false;
    this.tracers.matrixAutoUpdate = false;
    this.tracers.layers.set(LAYER_NEAR); this.tracers.layers.enable(LAYER_MID); this.tracers.layers.enable(LAYER_FAR);
    this.tracers.renderOrder = 22;
    game.engine.scene.add(this.tracers);
    // flashes (muzzle, impact, explosion cores)
    const fg = new THREE.BufferGeometry();
    this.fPos = new Float32Array(MAX_FLASH * 3);
    this.fCol = new Float32Array(MAX_FLASH * 3);
    this.fSize = new Float32Array(MAX_FLASH);
    fg.setAttribute('position', new THREE.BufferAttribute(this.fPos, 3).setUsage(THREE.DynamicDrawUsage));
    fg.setAttribute('color', new THREE.BufferAttribute(this.fCol, 3).setUsage(THREE.DynamicDrawUsage));
    fg.setAttribute('size', new THREE.BufferAttribute(this.fSize, 1).setUsage(THREE.DynamicDrawUsage));
    fg.setDrawRange(0, 0);
    this.fMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */`
        attribute vec3 color; attribute float size; uniform float uScale; varying vec3 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          float d = max(-mv.z, 0.05);
          gl_PointSize = clamp(size * uScale / d, 2.0, 420.0); vC = color * clamp(size * uScale / d / 2.0, 0.25, 1.0); }`,
      fragmentShader: /* glsl */`
        varying vec3 vC;
        void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = dot(p, p); if (r > 1.0) discard;
          float a = exp(-r * 4.0) + 0.35 * exp(-r * 22.0); gl_FragColor = vec4(vC * a, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.flashPts = new THREE.Points(fg, this.fMat);
    this.flashPts.frustumCulled = false;
    this.flashPts.matrixAutoUpdate = false;
    this.flashPts.layers.set(LAYER_NEAR); this.flashPts.layers.enable(LAYER_MID); this.flashPts.layers.enable(LAYER_FAR);
    this.flashPts.renderOrder = 23;
    game.engine.scene.add(this.flashPts);
    this.missileTpl = missileModel();
    this.t = 0;
    this.stats = { fired: 0, hits: 0, on: {} };
    // the scatter of rounds fired without a fire control of their own
    this.rng = new Rng(20410601);
  }

  // ------------------------------------------------------------------ firing
  /**
   * fire a round. o: { kind, pos (ECI), vel (shooter's velocity), dir (unit, ECI), owner,
   *   round (a round launched by a fire control: ballistics.FireControl.fire), disp (scatter
   *   multiplier, without one), target (missiles), byPlayer }
   */
  fire(o) {
    const R = ROUNDS[o.kind];
    let r;
    if (R.am) {
      // a shell: the ballistics engine flies it (scatter, muzzle velocity, gravity, the air)
      const b = o.round || launch(R.am, null, o.pos, o.vel, o.dir, this.rng, { disp: o.disp || 1 });
      r = { kind: o.kind, R, am: R.am, pos: b.pos, prev: b.prev, vel: b.vel, dir: b.dir, t: 0, owner: o.owner || null, age: 0, life: R.am.life, byPlayer: !!o.byPlayer, target: null, done: false, boost: -1, atMsl: o.atMsl || null };
    } else {
      const dir = o.dir.clone();
      r = {
        kind: o.kind, R, pos: o.pos.clone(), prev: o.pos.clone(), vel: o.vel.clone().addScaledVector(dir, R.speed),
        dir, owner: o.owner || null, age: 0, life: R.life, byPlayer: !!o.byPlayer, target: o.target || null, done: false,
        boost: 0,
      };
    }
    if (o.kind === 'missile') {
      // its speed is reckoned against the launcher's (a frame falling along with it)
      r.refVel = o.vel.clone();
      r.hp = R.hp;
      r.mesh = this.missileTpl.clone();
      r.mesh.matrixAutoUpdate = false;
      r.mesh.traverse((o) => { o.frustumCulled = false; });
      // its motor's flame out of the tail; it coasts clear of the launcher before it lights
      r.plume = new EnginePlume(r.mesh, { exits: [new THREE.Vector3(0, 0, 0.72)], r0: 0.08, len: 11, style: 'solid', spread: 0.3, dia: 0.4, gain: 1.4 });
      r.boost = o.coast ? -o.coast : 0;
      this.g.engine.scene.add(r.mesh);
      r.q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), r.dir);
    }
    this.rounds.push(r);
    this.stats.fired++;
    // muzzle flash
    this.flash(o.pos, o.kind === 'rail' ? [0.7, 0.9, 1.0] : [1.0, 0.75, 0.4], o.kind === 'rail' ? 2.6 : o.kind === 'missile' ? 1.4 : 0.7, o.kind === 'rail' ? 0.18 : 0.06, o.vel);
    return r;
  }

  /** a glowing point at an ECI position moving with vel (it falls with whatever made it):
   *  colour, size (m), life (s) */
  flash(pos, color, size, life, vel) {
    if (this.flashes.length >= MAX_FLASH) this.flashes.shift();
    this.flashes.push({ pos: pos.clone(), vel: vel ? vel.clone() : null, color, size, life, t: 0 });
  }

  /** a particle frame pinned to a point in space moving with vel (for things without their own
   *  frame: drones, rocks, warheads) */
  anchorAt(pos, vel) {
    let A = this.anchors.find((a) => a.idle > 6);
    if (!A) {
      if (this.anchors.length >= 8) A = this.anchors.reduce((a, b) => (a.idle > b.idle ? a : b));
      else {
        const grp = new THREE.Group();
        grp.matrixAutoUpdate = false;
        this.g.engine.scene.add(grp);
        A = { grp, P: new Particles(grp), pos: new THREE.Vector3(), vel: new THREE.Vector3(), idle: 0 };
        this.anchors.push(A);
      }
    }
    A.pos.copy(pos);
    if (vel) A.vel.copy(vel); else A.vel.set(0, 0, 0);
    A.idle = 0;
    return A;
  }

  /** move a free point along with the orbit (second-order step, like everything else) */
  static drift(p, v, dt, acc) {
    grav(p, acc);
    p.addScaledVector(v, dt).addScaledVector(acc, 0.5 * dt * dt);
    v.addScaledVector(acc, dt);
  }

  // ------------------------------------------------------------------ targets
  /**
   * everything a round can hit this step: { kind, ref, pos, vel, R, p1 } — pos is where it is now,
   * p1 where it will be a step (dt) on: a round and its target must be compared at the same
   * instants (at 7.7 km/s, one step of 0.05 s apart is almost 400 m)
   */
  targets(dt) {
    const g = this.g, out = [], acc = new THREE.Vector3();
    const add = (kind, ref, pos, vel, R) => {
      const p1 = pos.clone().addScaledVector(vel, dt).addScaledVector(grav(pos, acc), 0.5 * dt * dt);
      out.push({ kind, ref, pos, vel, R, p1 });
    };
    add('b29', g.flight, g.flight.pos, g.flight.vel, 20);
    if (g.h8 && g.h8.mode !== 'parked' && g.h8.mode !== 'pod' && g.h8.mode !== 'lost') add('h8', g.h8, g.h8.flight.pos, g.h8.flight.vel, H8.R);
    if (g.drones) for (const d of g.drones.list) if (d.alive) add('drone', d, d.pos, d.vel, d.R);
    // H8's K3 robots out of their bay (a small cube; on H8's hull they are part of H8)
    if (g.h8 && g.h8.k3) for (const u of g.h8.k3.free()) add('k3', u, u.pos, u.vel, 0.32);
    for (const a of g.asteroids.list) if (!a.dead && !a.hit) add('rock', a, a.pos, a.vel, a.radius);
    // (a missile as the drones' guns see it: their shells carry proximity fuses against missiles —
    // one that goes off within six metres counts; six bring it down)
    for (const m of this.rounds) if (m.kind === 'missile' && !m.done) add('missile', m, m.pos.clone(), m.vel.clone(), 6);
    // stations: their exact pose now and a step on (their drawn position is a frame old)
    for (const s of g.stations.list) {
      if (s.dmg && s.dmg.destroyed) continue;
      const pose = g.docking.stationPose(s, g.time, {});
      const p1 = g.stations.posOf(s, g.time + dt * 1000, new THREE.Vector3());
      out.push({ kind: 'station', ref: s, pos: pose.pos, vel: pose.vel, R: (s.model && s.model.userData.radius) || 150, p1, pose });
    }
    return out;
  }

  // ------------------------------------------------------------------ simulation
  update(sdt) {
    const acc = new THREE.Vector3();
    // fast-forward (sleeping): rounds fly on but hit nothing (their world moved in big jumps)
    const ff = sdt > 0.3;
    const n = ff ? Math.min(40, Math.ceil(sdt / 0.25)) : 1;
    const dt = ff ? sdt / n : sdt;
    for (let k = 0; k < n; k++) this.step(dt, acc, !ff);
  }

  step(dt, acc, test) {
    // particle frames and flashes ride along with whatever made them
    for (const A of this.anchors) if (A.idle < 6) Combat.drift(A.pos, A.vel, dt, acc);
    for (const f of this.flashes) if (f.vel) Combat.drift(f.pos, f.vel, dt, acc);
    if (!this.rounds.length && !this.flashes.length && !this.wrecks.length) return;
    this.t += dt;
    const g = this.g;
    const T = this.rounds.length && test ? this.targets(dt) : [];
    for (const r of this.rounds) {
      if (r.done) continue;
      r.age += dt;
      if (r.am) flyStep(r, dt, ENV);
      else {
        r.prev.copy(r.pos);
        grav(r.pos, acc);
        const gx = acc.x, gy = acc.y, gz = acc.z;
        const vx = r.vel.x, vy = r.vel.y, vz = r.vel.z;
        if (r.kind === 'missile') this.steerMissile(r, dt, acc);
        r.pos.addScaledVector(r.vel, dt).addScaledVector(acc, 0.5 * dt * dt);
        r.vel.addScaledVector(acc, dt);
        if (r.refVel) {
          // no faster than its top speed against the launch frame (which falls as it does)
          r.refVel.x += gx * dt; r.refVel.y += gy * dt; r.refVel.z += gz * dt;
          const rel = _v.copy(r.vel).sub(r.refVel), sp = rel.length();
          if (sp > r.R.vMax) r.vel.copy(r.refVel).addScaledVector(rel, r.R.vMax / sp);
          // what it is actually doing besides falling (a gun tracking it reads this off)
          (r.aAct || (r.aAct = new THREE.Vector3())).set((r.vel.x - vx) / dt - gx, (r.vel.y - vy) / dt - gy, (r.vel.z - vz) / dt - gz);
        }
      }
      // what did it run into on the way (each target in its own moving frame: the round went from
      // prev to pos while the target went from pos to p1)
      let best = null;
      for (const tg of T) {
        if (tg.ref === r.owner || (r.owner && tg.ref === r.owner.ref)) continue;
        // (missiles in flight are only in danger from the drones' guns)
        // (and only the one a drone's gun was laid on: its shells' fuses are set for that one)
        if (tg.kind === 'missile' && (r.kind !== 'drone' || r.atMsl !== tg.ref || tg.ref.done)) continue;
        const c0 = tg.pos, c1 = tg.p1;
        // quick reject: the segment is far from the target
        const dmid = Math.min(c1.distanceTo(r.pos), c0.distanceTo(r.prev));
        const reach = _v.copy(r.vel).sub(tg.vel).length() * dt + tg.R + 30;
        if (dmid > reach) continue;
        const p0 = r.prev.clone().sub(c0), p1 = r.pos.clone().sub(c1);
        const hit = this.hitTest(tg, p0, p1, r);
        // (a drone's shell passing a missile: whether its fuse catches it depends on how good the
        // drone's fire control is at setting it — the better the drone, the surer)
        if (hit && tg.kind === 'missile' && Math.random() > FUSE[(r.owner && r.owner.stars) || 3]) continue;
        if (hit && (!best || hit.f < best.f)) best = Object.assign(hit, { tg });
      }
      // a missile's proximity fuse: the closest it came to its target during the step
      const mt = r.target;
      if (!best && test && r.kind === 'missile' && mt && mt.alive !== false && mt.dead !== true && mt.pos) {
        const tv = mt.vel || r.vel;
        const q0 = r.prev.clone().sub(mt.pos);
        const q1 = r.pos.clone().sub(_v.copy(mt.pos).addScaledVector(tv, dt));
        const seg = q1.sub(q0), L2 = seg.lengthSq();
        const s = L2 > 1e-9 ? Math.max(0, Math.min(1, -q0.dot(seg) / L2)) : 0;
        const cp = q0.addScaledVector(seg, s);
        const R = mt.R || mt.radius || 1;
        if (cp.length() < 5 + R) {
          const tg = T.find((x) => x.ref === mt) || { kind: mt.kind || 'drone', ref: mt, pos: mt.pos, vel: tv, R };
          best = { tg, f: s, point: cp.clone(), n: cp.clone().normalize(), prox: true };
        }
      }
      if (best) { this.onHit(r, best); r.done = true; continue; }
      if (r.age > r.life) {
        r.done = true;
        if (r.kind === 'missile') this.explode(r.pos, r.vel, 0.6, false);
        else if (r.kind === 'cannon' || r.kind === 'pd') {
          // the shell's self-destruct: a puff where it is (seen only from nearby)
          const pv = g.playerVessel ? g.playerVessel() : null;
          if (pv && pv.pos.distanceTo(r.pos) < 6000) this.flash(r.pos, [1, 0.7, 0.4], 2.2, 0.12, r.vel);
        }
      }
    }
    this.rounds = this.rounds.filter((r) => { if (r.done && r.mesh) { g.engine.scene.remove(r.mesh); r.plume.dispose(); } return !r.done; });
    for (const f of this.flashes) f.t += dt;
    this.flashes = this.flashes.filter((f) => f.t < f.life);
    for (const w of this.wrecks) { w.t += dt; w.pos.addScaledVector(w.vel, dt); grav(w.pos, acc); w.pos.addScaledVector(acc, 0.5 * dt * dt); w.vel.addScaledVector(acc, dt); w.q.multiply(_q.setFromAxisAngle(w.axis, w.spin * dt)); }
    this.wrecks = this.wrecks.filter((w) => { if (w.t > w.life) { g.engine.scene.remove(w.mesh); return false; } return true; });
  }

  /** missile guidance: boost, then proportional navigation toward its target */
  steerMissile(r, dt, acc) {
    const tg = r.target;
    const was = r.boost;
    r.boost += dt;
    // the motor lights once it is clear of the launcher: a bright flash
    if (was < 0 && r.boost >= 0) this.flash(r.pos, [1.0, 0.8, 0.5], 3.2, 0.25, r.vel);
    if (r.boost < 0 || !tg || tg.alive === false || !tg.pos) return;
    const rel = tg.pos.clone().sub(r.pos), vrel = (tg.vel || r.vel).clone().sub(r.vel);
    const d = rel.length();
    const los = rel.clone().divideScalar(Math.max(1, d));
    const closing = -vrel.dot(los);
    // line-of-sight rate (PN, N = 4) plus a push along the line of sight
    const omega = rel.clone().cross(vrel).divideScalar(Math.max(1, d * d));
    const aPN = omega.cross(los).multiplyScalar(4 * Math.max(60, closing));
    const aMax = r.boost < 0.6 ? 60 : 140;
    const push = los.clone().multiplyScalar(closing < 900 ? aMax : 40);
    const a = aPN.add(push);
    if (a.length() > aMax) a.setLength(aMax);
    acc.add(a);
    r.dir.copy(r.vel).sub(tg.vel || r.vel).normalize();
    if (r.dir.lengthSq() < 0.5) r.dir.copy(los);
    // exhaust trail
    if (Math.random() < 0.9) this.flash(r.pos, [1.0, 0.62, 0.3], 0.9, 0.12, r.vel.clone().addScaledVector(r.dir, -40));
  }

  /** swept test in the target's frame (p0 -> p1 relative to its centre) */
  hitTest(tg, p0, p1, r) {
    const g = this.g;
    if (tg.kind === 'b29') {
      const f = g.flight, root = g.shipVis.root, A = g.asteroids;
      if (!A.hullMeshes.length) return null;
      const seg = p1.clone().sub(p0), len = seg.length();
      if (len < 1e-6) return null;
      // nowhere near the hull's bounding sphere along the whole step
      const s = Math.max(0, Math.min(1, -p0.dot(seg) / (len * len)));
      if (p0.clone().addScaledVector(seg, s).length() > 26) return null;
      const dir = seg.divideScalar(len);
      const shipW = _v2.setFromMatrixPosition(root.matrixWorld);
      A.ray.set(p0.clone().add(shipW), dir);
      A.ray.far = len;
      const hits = A.ray.intersectObjects(A.hullMeshes, false);
      if (!hits.length) return null;
      const h = hits[0];
      const pLocal = root.worldToLocal(h.point.clone());
      const qi = _q.copy(f.quat).invert();
      const dirLocal = dir.clone().applyQuaternion(qi);
      // the surface there (ship frame), facing the way the round came from
      const nLocal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld).applyQuaternion(qi) : dirLocal.clone().negate();
      if (nLocal.dot(dirLocal) > 0) nLocal.negate();
      return { f: h.distance / len, pLocal, dirLocal, nLocal, point: h.point.clone().sub(shipW) };
    }
    if (tg.kind === 'station') {
      const s = tg.ref, P = s.model && s.model.userData.proxies;
      if (!P) return null;
      const pose = tg.pose || g.docking.stationPose(s, g.time, {});
      const qi = _q.copy(pose.quat).invert();
      const a = p0.clone().applyQuaternion(qi), b = p1.clone().applyQuaternion(qi);
      const len = a.distanceTo(b);
      const n = Math.min(40, Math.max(2, Math.ceil(len / 3)));
      const nrm = new THREE.Vector3();
      for (let k = 0; k <= n; k++) {
        const pl = a.clone().lerp(b, k / n);
        if (pl.length() > tg.R + 20) continue;
        for (const pr of P) {
          if (g.docking.proxyDist(pl, pr, nrm) < 0) return { f: k / n, pStation: pl, nStation: nrm.clone(), point: pl.clone().applyQuaternion(pose.quat) };
        }
      }
      return null;
    }
    // spheres: H8, drones, rocks
    const R = tg.kind === 'h8' ? H8.R : tg.R;
    const f = segSphere(p0, p1, _v.set(0, 0, 0), R);
    if (f < 0) return null;
    const point = p0.clone().lerp(p1, f);
    return { f, point, n: point.clone().normalize() };
  }

  // ------------------------------------------------------------------ consequences
  onHit(r, hit) {
    const g = this.g, R = r.R, tg = hit.tg;
    this.stats.hits++;
    this.stats.on[tg.kind] = (this.stats.on[tg.kind] || 0) + 1;
    const at = tg.pos.clone().add(hit.point);
    const big = r.kind === 'rail' || r.kind === 'missile';
    this.flash(at, big ? [1, 0.85, 0.6] : [1, 0.7, 0.35], big ? 6 : 1.1, big ? 0.5 : 0.14, tg.vel);
    if (r.kind === 'missile') this.explode(at, tg.vel, 1, true);
    const relV = r.vel.clone().sub(tg.vel);
    // (a shell's energy goes with the square of the speed it strikes at)
    const Ek = r.am ? Math.min(2.5, (relV.length() / r.am.v0) ** 2) : 1;
    if (tg.kind === 'b29') {
      const E = r.kind === 'missile' ? R.E : R.E * Ek;
      g.damage.impact(hit.pLocal, hit.dirLocal, E, { shot: true, normal: hit.nLocal });
      g.systems.onImpact(E, hit.pLocal);
      if (g.combatLog) g.combatLog('b29', r);
    } else if (tg.kind === 'h8') {
      const h8 = g.h8;
      const dirLocal = hit.n.clone().applyQuaternion(_q.copy(h8.flight.quat).invert());
      // H8's armour is built for this: shells spend most of their energy on the outer plates
      h8.armourHit(R.E * (big ? 1 : 4) * Ek, dirLocal, { shot: !big });
      if (h8.crew || h8.mode === 'docked') {
        g.audio.impact(dirLocal.clone().multiplyScalar(H8.R * 0.9).add(H8.dockAt), Math.min(1, 0.25 + (big ? 0.6 : 0.1)));
        g.shake = Math.max(g.shake, big ? 1.4 : 0.35);
      }
      if (g.combatLog) g.combatLog('h8', r);
    } else if (tg.kind === 'missile') {
      // a drone's round finds a missile: six of them and it breaks up
      const m = tg.ref;
      m.hp -= 1;
      const A = this.anchorAt(m.pos, m.vel);
      A.P.burst('spark', hit.point.clone(), hit.n, 14, { speed: 14, spread: 1.4, size: 8 });
      if (m.hp <= 0 && !m.done) {
        m.done = true;
        this.explode(m.pos, m.vel, 0.55, false);
        if (g.h8) g.h8.say('hachi_msl_lost', {}, { minGap: 4, force: false });
      }
    } else if (tg.kind === 'drone') {
      g.drones.damage(tg.ref, R.drone * Math.min(1.5, Ek), hit, r);
    } else if (tg.kind === 'k3') {
      if (g.h8 && g.h8.k3) g.h8.k3.hit(tg.ref, R.E * Ek, hit);
    } else if (tg.kind === 'rock') {
      const a = tg.ref;
      a.hp = (a.hp ?? Math.pow(a.radius / 0.5, 3) * 0.6) - R.rock;
      const A = this.anchorAt(a.pos, a.vel);
      A.P.burst('debris', hit.point.clone(), hit.n, big ? 60 : 8, { speed: big ? 12 : 4, spread: 1.4, size: 20, life: 2 });
      A.P.burst('spark', hit.point.clone(), hit.n, big ? 40 : 6, { speed: 30, spread: 1.2, size: 12 });
      if (a.hp <= 0) {
        a.dead = true; a.zapped = true;
        A.P.burst('debris', new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 60 + a.radius * 60, { speed: 6, spread: 3, size: 30 * a.radius, life: 3 });
        A.P.burst('dust', new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 30, { speed: 3, spread: 3, size: 60, life: 2 });
        if (r.byPlayer && g.h8) g.h8.say('hachi_rock_kill', {}, { minGap: 20, force: false });
      }
    } else if (tg.kind === 'station') {
      const s = tg.ref;
      g.worldDamage.shot(s, hit.pStation, hit.nStation, R.station, { byPlayer: r.byPlayer });
      // sparks and spall where it struck (in the station's frame)
      const F = g.worldDamage.fxOf(s);
      F.P.burst('spark', hit.pStation.clone(), hit.nStation, big ? 80 : 14, { speed: big ? 30 : 12, spread: 1.0, size: 10 });
      F.P.burst('debris', hit.pStation.clone(), hit.nStation, big ? 40 : 5, { speed: big ? 12 : 5, spread: 1.2, size: 12 });
      if (big) F.P.burst('ice', hit.pStation.clone(), hit.nStation, 30, { speed: 10, spread: 0.6, size: 30 });
    }
  }

  /** an explosion at an ECI point (missile warhead, a drone blowing apart) */
  explode(pos, vel, k = 1, heard = true) {
    const g = this.g;
    this.flash(pos, [1, 0.9, 0.7], 14 * k, 0.35, vel);
    this.flash(pos, [1, 0.5, 0.2], 8 * k, 1.1, vel);
    const A = this.anchorAt(pos, vel);
    A.P.burst('plasma', new THREE.Vector3(), new THREE.Vector3(0, 1, 0), Math.round(14 * k + 4), { speed: 9 * k, spread: 3, size: 5 * k, life: 1.3 });
    A.P.burst('spark', new THREE.Vector3(), new THREE.Vector3(0, 1, 0), Math.round(90 * k), { speed: 45 * k, spread: 3, size: 16 });
    A.P.burst('debris', new THREE.Vector3(), new THREE.Vector3(0, 1, 0), Math.round(60 * k), { speed: 16 * k, spread: 3, size: 26, life: 4 });
    A.P.burst('smoke', new THREE.Vector3(), new THREE.Vector3(0, 1, 0), Math.round(14 * k), { speed: 3, spread: 3, size: 50 * k, life: 2.5, grow: 2 });
    // felt aboard when it is close to the ship Kaito is in
    if (heard && g.playerVessel) {
      const pv = g.playerVessel();
      const d = pv.pos.distanceTo(pos);
      if (d < 400) {
        g.audio.impact(new THREE.Vector3(0, 0, -20), Math.min(0.7, 0.12 + 0.5 * k * (1 - d / 400)));
        g.shake = Math.max(g.shake, Math.min(1.2, k * (1 - d / 400)));
      }
    }
  }

  /** pieces of something that broke apart (meshes tumbling away) */
  addWreck(mesh, pos, vel, life = 40, r = 3) {
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    this.g.engine.scene.add(mesh);
    this.wrecks.push({ mesh, pos: pos.clone(), vel: vel.clone(), q: new THREE.Quaternion().random(), axis: new THREE.Vector3().randomDirection(), spin: 0.5 + Math.random() * 3, t: 0, life, r });
  }

  // ------------------------------------------------------------------ per render frame
  updateVisual(dt, origin, camWorld) {
    const g = this.g;
    // tracers: a streak behind each shell (railgun slugs: a long thin line)
    let n = 0;
    const P = this.tPos, C = this.tCol;
    for (const r of this.rounds) {
      if (r.kind === 'missile') {
        const rel = r.pos.clone().sub(origin);
        r.q.setFromUnitVectors(_v.set(0, 0, -1), r.dir);
        r.mesh.matrix.compose(rel, r.q, _v2.set(1, 1, 1));
        r.mesh.matrixWorld.copy(r.mesh.matrix);
        r.mesh.updateMatrixWorld(true);
        const d = rel.distanceTo(camWorld);
        r.mesh.traverse((o) => { if (o.isMesh) assignLayers(o, Math.max(0, d - 2), d + 2); });
        // (dark while it coasts out of the tube; it lights, then burns to the end)
        r.plume.update(dt, r.boost < 0 ? 0 : r.boost < 0.6 ? 0.55 + r.boost : 1, 0, 0);
        r.plume.setDistance(d);
        continue;
      }
      if (n >= MAX_TRACERS) break;
      const R = r.R;
      const head = _v.copy(r.pos).sub(origin);
      const d = head.distanceTo(camWorld);
      if (d > 60000) continue;
      // streak along the motion relative to the camera's ship (what the eye sees move)
      const ref = g.playerVessel ? g.playerVessel() : { vel: r.vel };
      const rv = _v2.copy(r.vel).sub(ref.vel);
      // a tracer burns for a few seconds, then the round flies on unseen
      const burn = r.am ? r.am.tracer : 99;
      if (r.age > burn + 0.3) continue;
      const fade = r.age > burn ? 1 - (r.age - burn) / 0.3 : 1;
      const L = Math.min(R.len, rv.length() * 0.03) * (r.age < 0.05 ? r.age / 0.05 : 1);
      const tail = rv.normalize().multiplyScalar(-L).add(head);
      const i = n * 6;
      P[i] = head.x; P[i + 1] = head.y; P[i + 2] = head.z;
      P[i + 3] = tail.x; P[i + 4] = tail.y; P[i + 5] = tail.z;
      const k = (r.kind === 'rail' ? 6 : 3.2) * fade;
      C[i] = R.color[0] * k; C[i + 1] = R.color[1] * k; C[i + 2] = R.color[2] * k;
      C[i + 3] = R.color[0] * 0.15; C[i + 4] = R.color[1] * 0.15; C[i + 5] = R.color[2] * 0.15;
      n++;
    }
    this.tGeo.instanceCount = n;
    this.tPosAttr.needsUpdate = true;
    this.tColAttr.needsUpdate = true;
    this.tracers.visible = n > 0;
    if (n) {
      const size = g.engine.renderer.getDrawingBufferSize(this._size || (this._size = new THREE.Vector2()));
      this.tMat.resolution.set(size.x, size.y);
      this.tMat.linewidth = 2.4 * g.engine.renderer.getPixelRatio();
    }
    // flashes
    let m = 0;
    for (const f of this.flashes) {
      const rel = _v.copy(f.pos).sub(origin);
      const k = Math.max(0, 1 - f.t / f.life);
      this.fPos[m * 3] = rel.x; this.fPos[m * 3 + 1] = rel.y; this.fPos[m * 3 + 2] = rel.z;
      this.fCol[m * 3] = f.color[0] * 6 * k; this.fCol[m * 3 + 1] = f.color[1] * 6 * k; this.fCol[m * 3 + 2] = f.color[2] * 6 * k;
      this.fSize[m] = f.size * (0.6 + 0.4 * k);
      m++;
    }
    const fg = this.flashPts.geometry;
    fg.setDrawRange(0, m);
    fg.attributes.position.needsUpdate = fg.attributes.color.needsUpdate = fg.attributes.size.needsUpdate = true;
    this.flashPts.visible = m > 0;
    const cam = g.engine.camera;
    const sc = g.engine.renderer.domElement.height / (2 * Math.tan(cam.fov * Math.PI / 360));
    this.fMat.uniforms.uScale.value = sc;
    // particle frames pinned in space
    for (const A of this.anchors) {
      const live = A.P.add.p.length || A.P.alpha.p.length;
      A.idle = live ? 0 : A.idle + dt;
      A.grp.visible = !!live;
      if (!live) continue;
      const rel = _v.copy(A.pos).sub(origin);
      A.grp.matrix.makeTranslation(rel.x, rel.y, rel.z);
      A.grp.matrixWorld.copy(A.grp.matrix);
      A.grp.updateMatrixWorld(true);
      A.P.add.pts.material.uniforms.uScale.value = sc;
      A.P.alpha.pts.material.uniforms.uScale.value = sc;
      A.P.update(Math.min(dt, 0.1));
    }
    // tumbling wreckage
    for (const w of this.wrecks) {
      const rel = _v.copy(w.pos).sub(origin);
      w.mesh.matrix.compose(rel, w.q, w.mesh.scale);
      w.mesh.matrixWorld.copy(w.mesh.matrix);
      w.mesh.updateMatrixWorld(true);
      const d = rel.distanceTo(camWorld);
      w.mesh.traverse((o) => { if (o.isMesh) assignLayers(o, Math.max(0, d - w.r), d + w.r); });
    }
  }
}
