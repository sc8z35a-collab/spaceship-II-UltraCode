// K3: H8's three repair robots. They live in a bay behind the red hexagon on H8's port quarter (the
// one plate that is never knocked off): a lift under the hatch and a magazine round it, a charging
// cradle each. When H8 is hurt HACHI sends out as many as the work needs (Kaito can send them or
// call them back from the K3 page of the ship tab). Each one:
//  - is a 40 cm cube with a camera in front and three arms (left, right, below); no gun;
//  - flies on its 24 thrusters, up to 200 m/s against the frame it set out in (no faster: if H8
//    runs away from it faster than that, it cannot catch up), 22 m/s^2;
//  - charges full in 30 minutes in its cradle and works an hour outside on a charge (harder
//    flying drains it faster); it comes home while it still has the charge to;
//  - flies to the work on H8's hull and grips on there: it mends what Kaito cannot — a blinded
//    camera, the cut circuits under the plates, the craters (stage by stage, down to bare
//    plate), a plate knocked off (refitted from the bay's spares), dents — and, with all three at
//    it, brings H8's armour back by 4% every five minutes;
//  - is torn off the hull if H8 accelerates harder than its grip (20 m/s^2), and then chases it;
//  - is a target the drones see and shoot at: a few rounds break it up;
//  - left behind with its battery flat, it goes dead, drifts, and is given up (gone from the
//    picture); the repair dock builds new ones.
import * as THREE from 'three';
import { H8, CAMERAS } from './h8Spec.js';
import { HEX, hexOutline, hexPoint } from './h8Hex.js';
import { armourTileGeometry } from './h8Exterior.js';
import { buildK3, K3_SIZE } from './k3Model.js';
import { QUALITY } from '../core/quality.js';
import { MU_EARTH } from '../core/astro.js';
import { RANGES, LAYER_NEAR, LAYER_MID, LAYER_FAR } from '../core/layers.js';
import { Builder } from '../ship/geom.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const grav = (p, out) => { const r = p.length(); return out.copy(p).multiplyScalar(-MU_EARTH / (r * r * r)); };

export const K3_SPEC = {
  vMax: 200,                // m/s against the frame it set out in
  accel: 22,                // m/s^2
  turn: 2.4,                // rad/s
  evaSec: 3600,             // an hour out on a charge
  chargeSec: 1800,          // full in half an hour
  grip: 20,                 // m/s^2 before it is torn off the hull
  spares: 20,               // armour plates in the bay for refitting
};
// how long each job takes one robot (s)
const WORK = { cam: 50, circuit: 70, patch: 32, tile: 45, dent: 28 };
const JUNCTION_DIRS = {
  drive: V(0.32, -0.2, 0.93).normalize(), power: V(0.48, -0.6, 0.64).normalize(), sensor: V(-0.3, 0.78, -0.55).normalize(),
  comms: V(0.66, 0.6, -0.45).normalize(), fire: V(-0.55, -0.08, -0.83).normalize(),
};
const NAMES_JP = { drive: '推進制御回路', power: '電力バス', sensor: 'センサー回路', comms: '通信回路', fire: '射撃管制回路' };
const STATE_JP = { stowed: '格納・充電', launch: '発進準備', out: '移動中', work: '修理中', home: '帰還中', dock: '収容中', dead: '電池切れ', lost: '喪失' };

const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** the render passes for a whole model at a distance (set on every mesh in it, only on change) */
function layerTree(root, dmin, dmax) {
  let mask = 0;
  if (dmin < RANGES.near[1]) mask |= 1 << LAYER_NEAR;
  if (dmax > RANGES.mid[0] && dmin < RANGES.mid[1]) mask |= 1 << LAYER_MID;
  if (dmax > RANGES.far[0]) mask |= 1 << LAYER_FAR;
  if (root.userData.lm === mask) return;
  root.userData.lm = mask;
  root.traverse((o) => { o.layers.mask = mask; });
}

export class K3Fleet {
  constructor(vessel) {
    this.v = vessel;
    this.g = vessel.g;
    this.auto = true;
    this.spares = K3_SPEC.spares;
    this.tileId = HEX.red;
    this.tile = HEX.tiles[HEX.red];
    this.level = QUALITY.level;
    this.buildBay();
    this.units = [0, 1, 2].map((i) => this.makeUnit(i));
    this.bayQ = [];             // what the bay is doing: { kind: 'launch' | 'recover', u }
    this.bay = { hatch: 0, hatchT: 0, lift: 0, liftT: 0, step: 'idle', t: 0, carry: null };
    this.evalT = 3;
    this.restoreRate = 0;
  }

  // ================================================================== the bay
  /** the bay's frame (H8-local): its origin on the hatch's middle at the surface, +y out */
  buildBay() {
    const t = this.tile, R = H8.R;
    const o = hexOutline(t, 0);
    const X = o.ax.clone(), Y = t.c.clone(), Z = o.ay.clone().negate();
    this.bayM = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(t.c.clone().multiplyScalar(R));
    this.bayInv = this.bayM.clone().invert();
    this.bayQ0 = new THREE.Quaternion().setFromRotationMatrix(this.bayM);
    const anchor = this.anchor = new THREE.Group();
    anchor.name = 'K3bay';
    anchor.matrixAutoUpdate = false;
    anchor.matrix.copy(this.bayM);
    this.v.ext.group.add(anchor);
    // a point of the tile's outline (tangent-plane units) in the bay's own frame (m)
    const local = (u, vv, r) => hexPoint(o, u, vv, r).applyMatrix4(this.bayInv);
    const mats = {
      wall: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.62, metalness: 0.55, side: THREE.DoubleSide }),
      floor: new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.7, metalness: 0.4 }),
      rail: new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.3, metalness: 0.92 }),
      led: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.45, 0.85, 1.0), emissiveIntensity: 0 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.2, metalness: 1 }),
      warn: new THREE.MeshStandardMaterial({ color: 0xe6b422, roughness: 0.5, metalness: 0.1 }),
      red: new THREE.MeshStandardMaterial({ color: 0x9a0c0a, roughness: 0.45, metalness: 0.2, vertexColors: true }),
    };
    this.mats = mats;
    // the well under the hatch: six walls from the plates' underside down to its floor
    const inset = hexOutline(t, 0.03 / R);
    const n = inset.pts.length;
    const b = new Builder();
    const yTop = -0.04, yBot = -0.62;
    const pos = [];
    for (let k = 0; k < n; k++) {
      const [x0, y0] = inset.pts[k], [x1, y1] = inset.pts[(k + 1) % n];
      const A = local(x0, y0, R), B = local(x1, y1, R);
      const a0 = V(A.x, yTop + Math.min(0, A.y), A.z), b0 = V(B.x, yTop + Math.min(0, B.y), B.z);
      const a1 = V(A.x * 0.97, yBot, A.z * 0.97), b1 = V(B.x * 0.97, yBot, B.z * 0.97);
      pos.push(a0, a1, b1, a0, b1, b0);
    }
    const wg = new THREE.BufferGeometry().setFromPoints(pos);
    wg.computeVertexNormals();
    b.add(wg, 'wall');
    // the floor, the lift's guide rails, the light strips round the top
    const fl = [];
    const c0 = V(0, yBot, 0);
    for (let k = 0; k < n; k++) {
      const [x0, y0] = inset.pts[k], [x1, y1] = inset.pts[(k + 1) % n];
      const A = local(x0, y0, R), B = local(x1, y1, R);
      fl.push(c0, V(B.x * 0.97, yBot, B.z * 0.97), V(A.x * 0.97, yBot, A.z * 0.97));
    }
    const fg = new THREE.BufferGeometry().setFromPoints(fl);
    fg.computeVertexNormals();
    b.add(fg, 'floor');
    for (const s of [-1, 1]) b.box(0.03, 0.56, 0.03, 'rail', [s * 0.27, (yTop + yBot) / 2, 0], null, 0, 1);
    for (let k = 0; k < n; k += 2) {
      const [x0, y0] = inset.pts[k], [x1, y1] = inset.pts[(k + 1) % n];
      const A = local(x0, y0, R).multiplyScalar(0.93), B = local(x1, y1, R).multiplyScalar(0.93);
      const mid = A.clone().add(B).multiplyScalar(0.5);
      const len = A.distanceTo(B) * 0.8;
      const g = new THREE.BoxGeometry(len, 0.012, 0.012);
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.atan2(B.z - A.z, B.x - A.x)));
      g.translate(mid.x, -0.12, mid.z);
      b.add(g, 'led');
    }
    // hazard chevrons on the floor round the lift
    b.box(0.52, 0.004, 0.06, 'warn', [0, yBot + 0.003, 0.28], null, 0, 1);
    b.box(0.52, 0.004, 0.06, 'warn', [0, yBot + 0.003, -0.28], null, 0, 1);
    const well = b.build(mats, { castShadow: false });
    well.traverse((m) => { if (m.isMesh) m.layers.set(LAYER_NEAR); });
    anchor.add(well);
    // the lift: a cradle with its charging contacts and latch post
    const lift = this.liftGrp = new THREE.Group();
    const lb = new Builder();
    lb.box(0.5, 0.03, 0.5, 'floor', [0, -0.015, 0], null, 0.006, 1);
    lb.box(0.46, 0.012, 0.46, 'rail', [0, 0.004, 0], null, 0.004, 1);
    for (const s of [-1, 1]) lb.box(0.04, 0.006, 0.08, 'gold', [s * 0.05, 0.012, 0.18], null, 0.002, 1);
    lb.cyl(0.018, 0.022, 0.06, 'rail', [0, 0.03, 0.2], null, 12);
    const lm = lb.build(mats, { castShadow: false });
    lm.traverse((m) => { if (m.isMesh) m.layers.set(LAYER_NEAR); });
    lift.add(lm);
    anchor.add(lift);
    this.liftY = [-0.6, 0.0];   // down (in the bay) .. up (the cradle at the surface)
    lift.position.y = this.liftY[0];
    // the hatch: the red plate itself, hinged along its uppermost edge, swinging out
    const red = new THREE.Color(0.62, 0.05, 0.035);
    const hg = armourTileGeometry({ id: t.id, tile: t }, red, true);
    hg.applyMatrix4(this.bayInv);
    let hk = 0, best = -9;
    const upB = V(0, 1, 0).applyMatrix4(_m.copy(this.bayInv).setPosition(0, 0, 0)).normalize();
    for (let k = 0; k < n; k++) {
      const [x0, y0] = inset.pts[k], [x1, y1] = inset.pts[(k + 1) % n];
      const mid = local((x0 + x1) / 2, (y0 + y1) / 2, R);
      const s = mid.dot(upB);
      if (s > best) { best = s; hk = k; }
    }
    const [hx0, hy0] = inset.pts[hk], [hx1, hy1] = inset.pts[(hk + 1) % n];
    const H0 = local(hx0, hy0, R), H1 = local(hx1, hy1, R);
    const hingeP = H0.clone().add(H1).multiplyScalar(0.5);
    hingeP.y = -0.035;
    const hingeAx = H1.clone().sub(H0).setY(0).normalize();
    // (opens outward: the side away from the middle goes up)
    if (hingeAx.clone().cross(V(0, 1, 0)).dot(hingeP) > 0) hingeAx.negate();
    const hingeBase = new THREE.Group();
    hingeBase.position.copy(hingeP);
    hingeBase.quaternion.setFromUnitVectors(V(1, 0, 0), hingeAx);
    anchor.add(hingeBase);
    const hinge = this.hinge = new THREE.Group();
    hingeBase.add(hinge);
    hg.translate(-hingeP.x, -hingeP.y, -hingeP.z);
    hg.applyMatrix4(_m.makeRotationFromQuaternion(_q.copy(hingeBase.quaternion).invert()));
    // (its markings: the hexagon's K3 sign, a warning stripe; its underside dark)
    const hm = new THREE.Mesh(hg, mats.red);
    hm.layers.set(LAYER_NEAR);
    hinge.add(hm);
    // the hatch's own hinge pins
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 12), mats.rail);
    pin.rotation.z = Math.PI / 2;
    pin.layers.set(LAYER_NEAR);
    hinge.add(pin);
    this.hatchMesh = hm;
    // where the magazine keeps the others (under the plates round the well), and the lift's place
    this.slots = [0, 1, 2].map((i) => (i === 0 ? V(0, -0.38, 0) : V(Math.cos(i * 2.1) * 0.66, -0.4, Math.sin(i * 2.1) * 0.66)));
    // the bay's work light (on while the hatch is open)
    this.mats.led.emissiveIntensity = 0;
  }

  /** the hatch's angle (0 shut .. 1 open: 115 degrees out) */
  setHatch(k) { this.hinge.rotation.x = -k * 2.0; }

  // ================================================================== the robots
  makeUnit(i) {
    const u = {
      i, name: `K3-${i + 1}`, state: 'stowed', slot: i, battery: 1, hp: 1,
      pos: V(0, 0, 0), vel: V(0, 0, 0), q: new THREE.Quaternion(), w: V(0, 0, 0), refVel: V(0, 0, 0),
      local: V(0, 0, 0), localQ: new THREE.Quaternion(),   // pose in H8's frame while attached
      job: null, prog: 0, thrust: V(0, 0, 0), tq: V(0, 0, 0), deadT: 0, arms: 0, workT: 0, sparkT: 0,
      model: null, attached: true,
    };
    this.buildModel(u);
    this.placeInSlot(u);
    return u;
  }

  buildModel(u) {
    if (u.model) u.model.dispose();
    u.model = buildK3(QUALITY.level, u.i);
    u.model.root.matrixAutoUpdate = false;
    this.attach(u);
  }

  /** a robot in its slot in the magazine (or on the lift) */
  placeInSlot(u) {
    const s = this.slots[u.slot] || this.slots[0];
    u.local.copy(s).applyMatrix4(this.bayM);
    u.localQ.copy(this.bayQ0);
    u.attached = true;
    this.attach(u);
  }

  /** riding with H8 (in the bay, on the lift, gripping the hull): drawn in H8's frame */
  attach(u) {
    const r = u.model.root;
    if (r.parent !== this.v.ext.group) { if (r.parent) r.parent.remove(r); this.v.ext.group.add(r); }
    u.attached = true;
  }

  /** flying free: drawn in space (relative to the render origin) */
  detach(u) {
    const r = u.model.root;
    if (r.parent !== this.g.engine.scene) { if (r.parent) r.parent.remove(r); this.g.engine.scene.add(r); }
    u.attached = false;
  }

  /** H8's pose now (ECI), and its velocity and non-gravitational acceleration */
  h8Pose() {
    const v = this.v, g = this.g, f = v.flight, docked = v.mode === 'docked';
    return { pos: f.pos, quat: f.quat, vel: docked ? g.flight.vel : f.vel, acc: docked ? g.flight.properAcc : f.properAcc || f.thrustAcc };
  }

  toEci(pL, out) { const P = this.h8Pose(); return out.copy(pL).applyQuaternion(P.quat).add(P.pos); }
  toLocal(pE, out) { const P = this.h8Pose(); return out.copy(pE).sub(P.pos).applyQuaternion(_q2.copy(P.quat).invert()); }

  // ================================================================== the work
  /** what wants mending, nearest the worst first: { kind, dir (H8-local), name, ... } */
  jobs() {
    const v = this.v, H = v.hull, out = [];
    if (!H) return out;
    H.cams.forEach((c, i) => { if (c < 0.97) out.push({ kind: 'cam', i, dir: CAMERAS[i].dir, name: CAMERAS[i].name.split(' ')[0] + ' カメラ', pri: 5 - c }); });
    if (v.circuits) for (const [k, val] of Object.entries(v.circuits)) if (val < 0.97 && JUNCTION_DIRS[k]) out.push({ kind: 'circuit', k, dir: JUNCTION_DIRS[k], name: NAMES_JP[k], pri: 4 - val });
    for (const s of H.strikes.sites) if (s.stage >= 1) out.push({ kind: 'patch', site: s, dir: s.n.clone().normalize(), name: `損傷部 ${Math.ceil(s.stage)}段`, pri: 1 + s.stage * 0.4 });
    for (const t of H.tiles) {
      const T = HEX.tiles[t.id];
      if (!T || this.spares <= 0) continue;
      // (a plate goes back once the spot under it is mended)
      if (H.strikes.sites.some((s) => s.n.angleTo(T.c) < 0.16 && s.stage >= 1)) continue;
      out.push({ kind: 'tile', id: t.id, dir: T.c, name: '装甲板', pri: 1.2 });
    }
    for (const d of H.dents) if (d.depth > 0.004 && !d.hole) out.push({ kind: 'dent', dent: d, dir: d.dir, name: 'へこみ', pri: 0.5 + d.depth * 4 });
    return out.sort((a, b) => b.pri - a.pri);
  }

  /** how much is wrong, 0..1: how many of them go out */
  needOut(jobs) {
    const v = this.v;
    const armour = 1 - (v.armour.outer * 0.6 + v.armour.inner * 0.4);
    const n = jobs.length;
    let want = n ? 1 : armour > 0.02 ? 1 : 0;
    if (n > 3 || armour > 0.2) want = 2;
    if (n > 7 || armour > 0.45 || jobs.some((j) => j.kind === 'cam' || j.kind === 'circuit') && n > 2) want = 3;
    return want;
  }

  /** whether it is safe to go out now (H8 not burning hard, not in the air, not being taken) */
  canLaunch() {
    const v = this.v, g = this.g, P = this.h8Pose();
    if (v.mode === 'parked' || v.mode === 'pod' || v.mode === 'lost') return false;
    if ((v.awake || 0) < 0.5) return false;
    if (P.acc && P.acc.length() > K3_SPEC.grip * 0.6) return false;
    if (g.flight && g.flight.alt < 120000 && v.mode === 'docked') return false;
    if (v.mode !== 'docked' && v.flight.alt < 120000) return false;
    return true;
  }

  // ================================================================== per step
  update(dt) {
    const v = this.v;
    if (this.level !== QUALITY.level) { this.level = QUALITY.level; for (const u of this.units) if (u.state !== 'lost') this.buildModel(u); }
    // ---- HACHI: who goes out, and when they come home
    this.evalT -= dt;
    if (this.evalT <= 0) {
      this.evalT = 2;
      const jobs = this.jobs();
      const out = this.units.filter((u) => u.state === 'out' || u.state === 'work' || u.state === 'launch');
      if (this.auto && this.canLaunch()) {
        const want = this.needOut(jobs);
        const ready = this.units.filter((u) => u.state === 'stowed' && u.battery > 0.45 && u.hp > 0.3);
        for (let k = out.length; k < want && ready.length; k++) this.send(ready.shift(), true);
      }
      // nothing left to do: home
      if (!jobs.length && (v.armour.outer > 0.995 || this.restoreDone())) for (const u of this.units) if ((u.state === 'out' || u.state === 'work') && !u.job) this.recall(u, true);
    }
    // ---- the bay's machinery
    this.updateBay(dt);
    // ---- each robot
    const P = this.h8Pose();
    let working = 0;
    for (const u of this.units) {
      if (u.state === 'lost') continue;
      if (u.state === 'stowed') {
        // charging (from H8's power)
        if ((v.power && v.power.smes > 1) || v.mode === 'docked') u.battery = Math.min(1, u.battery + dt / K3_SPEC.chargeSec);
        continue;
      }
      if (u.state === 'launch' || u.state === 'dock') continue;      // the bay moves it
      if (u.state === 'dead') { this.fly(u, dt, null); u.deadT += dt; if (u.deadT > 20) this.giveUp(u); continue; }
      // the battery: an hour of light flying and working, harder thrust drains it faster
      const load = 1 + 0.7 * Math.min(1, u.thrust.length()) + (u.state === 'work' ? 0.25 : 0);
      u.battery = Math.max(0, u.battery - dt * load / K3_SPEC.evaSec);
      if (u.battery <= 0) { this.die(u); continue; }
      if (u.state === 'work') {
        // gripping the hull: torn off when H8 pulls harder than its grip
        if (P.acc && P.acc.length() > K3_SPEC.grip) { this.tearOff(u, P); continue; }
        working++;
        this.work(u, dt);
        // enough left to get home? (from the hull it is a short hop: a few percent)
        if (u.battery < 0.06) this.recall(u, true);
        continue;
      }
      // out or coming home: fly
      if (u.state === 'out') {
        if (!u.job) { const j = this.pickJob(u); if (j) u.job = j; else { this.recall(u, true); } }
        if (u.job) {
          const goal = this.workPose(u.job);
          const dist = this.fly(u, dt, goal);
          if (dist < 0.06 && u.vrel < 0.08) this.grip(u, goal);
        }
      } else if (u.state === 'home') {
        const dist = this.fly(u, dt, this.dockPose());
        if (dist < 1.6 && !this.bayQ.some((x) => x.u === u) && this.bay.carry !== u) this.bayQ.push({ kind: 'recover', u });
      }
      // the charge to get home: the distance at its speed, and some
      if (u.state === 'out') {
        const d = this.toLocal(u.pos, _v).distanceTo(this.dockPose().p);
        const need = (d / Math.max(30, K3_SPEC.vMax * 0.6)) * 1.8 / K3_SPEC.evaSec + 0.05;
        if (u.battery < need) this.recall(u, true);
      }
    }
    // ---- three of them at it bring the armour back 4% in five minutes (each a third of that)
    this.restoreRate = working * (0.04 / 300) / 3;
    if (working) this.mendArmour(dt * this.restoreRate);
  }

  restoreDone() { const v = this.v; return v.armour.outer >= 0.999 && v.armour.inner >= 0.999 && (v.structure ?? 1) >= 0.999; }

  /** the armour comes back a little: the outer plates first, then the inner, then the frame */
  mendArmour(k) {
    const A = this.v.armour;
    if (A.outer < 1) { A.outer = Math.min(1, A.outer + k); return; }
    if (A.inner < 1) { A.inner = Math.min(1, A.inner + k); return; }
    if (this.v.structure < 1) this.v.structure = Math.min(1, this.v.structure + k);
  }

  /** a job not already being done by another */
  pickJob(u) {
    const taken = new Set(this.units.filter((x) => x !== u && x.job).map((x) => x.job.kind + ':' + (x.job.i ?? x.job.k ?? x.job.id ?? (x.job.site && x.job.site.seed) ?? (x.job.dent && x.job.dent.seed))));
    for (const j of this.jobs()) {
      const key = j.kind + ':' + (j.i ?? j.k ?? j.id ?? (j.site && j.site.seed) ?? (j.dent && j.dent.seed));
      if (!taken.has(key)) return j;
    }
    return null;
  }

  /** where it sits to do a job: over the spot, its underside (the tool arm) to the hull */
  workPose(job) {
    const n = job.dir.clone().normalize();
    const p = n.clone().multiplyScalar(H8.R + 0.36);
    // (facing along the hull, its camera on the spot below and ahead)
    const t = V(0, 1, 0).cross(n);
    if (t.lengthSq() < 1e-4) t.set(1, 0, 0);
    t.normalize();
    const zAxis = t.clone().negate();              // its -z (the camera) faces along +t
    const xAxis = n.clone().cross(zAxis).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(xAxis, n, zAxis));
    return { p, q };
  }

  /** where it lines up to be taken in: a metre out over the open hatch */
  dockPose() {
    return { p: V(0, 1.0, 0).applyMatrix4(this.bayM), q: this.bayQ0.clone(), final: V(0, this.liftY[1] + K3_SIZE / 2 + 0.01, 0).applyMatrix4(this.bayM) };
  }

  /**
   * flying free: toward a goal (H8-local {p, q}) matching H8's motion, or (null) adrift. Its
   * velocity is held to 200 m/s against the frame it set out in. Returns the distance to the goal.
   */
  fly(u, dt, goal) {
    const P = this.h8Pose();
    const acc = _v3.set(0, 0, 0);
    let dist = 0;
    u.vrel = 0;
    if (goal && u.state !== 'dead') {
      const gE = this.toEci(goal.p, _v);
      const rel = gE.sub(u.pos);
      dist = rel.length();
      const vRel = _v2.copy(u.vel).sub(P.vel);
      u.vrel = vRel.length();
      const aMax = K3_SPEC.accel * (u.hp < 0.4 ? 0.6 : 1);
      // close in at a speed it can brake from, the last metres slow
      const want = Math.min(K3_SPEC.vMax, Math.sqrt(2 * 0.55 * aMax * dist), dist * 0.9 + 0.02);
      const vDes = dist > 1e-4 ? rel.multiplyScalar(want / dist) : rel.set(0, 0, 0);
      acc.copy(vDes.sub(vRel)).multiplyScalar(2.2);
      // (and H8's own push, so it keeps up while H8 burns)
      if (P.acc) acc.add(P.acc);
      if (acc.length() > aMax) acc.setLength(aMax);
    }
    // the second-order step under gravity
    const gg = grav(u.pos, _v2).add(acc);
    u.pos.addScaledVector(u.vel, dt).addScaledVector(gg, 0.5 * dt * dt);
    u.vel.addScaledVector(gg, dt);
    // (the frame it set out in falls with it)
    u.refVel.addScaledVector(grav(u.pos, _v2), dt);
    const rv = _v2.copy(u.vel).sub(u.refVel), sp = rv.length();
    if (sp > K3_SPEC.vMax) u.vel.copy(u.refVel).addScaledVector(rv, K3_SPEC.vMax / sp);
    // its attitude: toward the goal's (close in), else its camera along its motion against H8
    const qWant = _q;
    if (goal && dist < 3) qWant.copy(P.quat).multiply(goal.q);
    else if (goal) {
      const fwd = this.toEci(goal.p, _v).sub(u.pos).normalize();
      qWant.setFromUnitVectors(V(0, 0, -1), fwd);
    } else qWant.copy(u.q);
    if (u.state === 'dead') {
      const wl = u.w.length();
      if (wl > 1e-6) u.q.multiply(_q2.setFromAxisAngle(_v.copy(u.w).divideScalar(wl), wl * dt));
    } else {
      const ang = u.q.angleTo(qWant);
      const maxT = K3_SPEC.turn * dt;
      u.q.slerp(qWant, ang > maxT ? maxT / ang : 1);
    }
    // what its thrusters do, in its own frame (for the puffs)
    u.thrust.copy(acc).applyQuaternion(_q2.copy(u.q).invert()).divideScalar(K3_SPEC.accel);
    return dist;
  }

  /** H8 pulled away harder than its grip: off the hull, adrift with what H8 had, then chasing */
  tearOff(u, P) {
    const pE = this.toEci(u.local, _v);
    u.pos.copy(pE);
    u.vel.copy(P.vel);
    u.refVel.copy(P.vel);
    u.q.copy(P.quat).multiply(u.localQ);
    u.state = 'out';
    this.detach(u);
    this.v.say('hachi_k3_torn', { n: u.name }, { minGap: 8 });
  }

  /** onto the hull at its job: from here it rides with H8 */
  grip(u, goal) {
    u.local.copy(goal.p);
    u.localQ.copy(goal.q);
    u.state = 'work';
    u.prog = 0;
    u.workT = 0;
    this.attach(u);
    const A = this.g.audio;
    if (A.ready && (this.v.crew || this.v.mode === 'docked')) A.mech(goal.p.clone().multiplyScalar(0.9).add(H8.dockAt), 'latch', { open: false, gain: 0.4 });
  }

  /** a robot at its job: progress, sparks, the result */
  work(u, dt) {
    const j = u.job;
    if (!j) { u.state = 'out'; return; }
    // (the job may have gone meanwhile: done by another, or the dock mended it)
    if (!this.stillNeeded(j)) { u.job = null; this.release(u); return; }
    u.workT += dt;
    u.prog += dt / (WORK[j.kind] || 40);
    const H = this.v.hull, v = this.v;
    if (u.prog >= 1) {
      u.prog = 0;
      if (j.kind === 'cam') { H.cams[j.i] = 1; H.sync(); v.say('hachi_k3_fixed', { n: u.name, what: j.name }, { minGap: 4 }); }
      else if (j.kind === 'circuit') { v.circuits[j.k] = 1; v.say('hachi_k3_fixed', { n: u.name, what: j.name }, { minGap: 4 }); }
      else if (j.kind === 'patch') {
        // one stage of the crater filled and welded over; the last, the plate under it whole again
        const s = j.site, SP = H.strikes.P;
        s.stage = Math.max(0, Math.round(s.stage) - 1);
        s.shown = Math.min(s.shown, s.stage);
        if (s.stage <= 0) { const k = H.strikes.sites.indexOf(s); if (k >= 0) H.strikes.sites.splice(k, 1); }
        else s.Rt = SP.R[s.stage - 1];
        s.ember = 0; s.heat = 0;
        H.strikes.sync();
        // (the torn petals round a hole go with the hole)
        H.petals = H.petals.filter((pt) => {
          if (pt.site !== s || s.stage >= H.strikes.stages) return true;
          H.v.ext.group.remove(pt.grp);
          pt.grp.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); const i = H.v.extMeshes.indexOf(o); if (i >= 0) H.v.extMeshes.splice(i, 1); } });
          return false;
        });
        if (s.stage > 0) return;                  // more of it to do
      } else if (j.kind === 'tile') {
        const k = H.tiles.findIndex((t) => t.id === j.id);
        if (k >= 0 && this.spares > 0) { H.tiles.splice(k, 1); this.spares--; H.sync(); }
      } else if (j.kind === 'dent') {
        const d = j.dent;
        d.depth *= 0.4; d.soot *= 0.5;
        if (d.depth < 0.004) { const k = H.dents.indexOf(d); if (k >= 0) H.dents.splice(k, 1); }
        H.sync(true);
      }
      u.job = null;
      this.release(u);
      return;
    }
    // the welding: the tool tip glowing and sparks off the spot now and then
    u.sparkT -= dt;
    if (u.sparkT <= 0 && v.fx) {
      u.sparkT = 0.12 + Math.random() * 0.25;
      const n = j.dir.clone().normalize();
      const p = n.clone().multiplyScalar(H8.R + 0.02);
      v.fx.burst('spark', p, n, 4 + Math.floor(Math.random() * 7), { speed: 1.8, spread: 1.2, size: 4 });
    }
  }

  stillNeeded(j) {
    const v = this.v, H = v.hull;
    if (j.kind === 'cam') return H.cams[j.i] < 0.97;
    if (j.kind === 'circuit') return v.circuits[j.k] < 0.97;
    if (j.kind === 'patch') return H.strikes.sites.includes(j.site) && j.site.stage >= 1;
    if (j.kind === 'tile') return H.tiles.some((t) => t.id === j.id) && this.spares > 0;
    if (j.kind === 'dent') return H.dents.includes(j.dent);
    return false;
  }

  /** off the hull again (to the next job or home) */
  release(u) {
    const P = this.h8Pose();
    u.pos.copy(this.toEci(u.local, _v));
    u.vel.copy(P.vel);
    u.refVel.copy(P.vel);
    u.q.copy(P.quat).multiply(u.localQ);
    u.state = 'out';
    this.detach(u);
  }

  // ================================================================== orders
  /** out it goes (auto: HACHI's call) */
  send(u, auto = false) {
    if (!u || u.state !== 'stowed') return false;
    if (!this.canLaunch()) { if (!auto) this.v.say('hachi_k3_cant', {}, { minGap: 4 }); return false; }
    u.state = 'launch';
    this.bayQ.push({ kind: 'launch', u });
    if (!auto || !this._saidOut) { this.v.say('hachi_k3_out', { n: u.name }, { minGap: 6 }); this._saidOut = true; }
    return true;
  }

  /** come home */
  recall(u, auto = false) {
    if (!u) return;
    if (u.state === 'work') { u.job = null; this.release(u); }
    if (u.state === 'out') { u.state = 'home'; u.job = null; if (!auto) this.v.say('hachi_k3_home', { n: u.name }, { minGap: 4 }); }
  }

  sendAll() { let n = 0; for (const u of this.units) if (u.state === 'stowed' && u.battery > 0.2 && u.hp > 0.3 && this.send(u)) n++; return n; }
  recallAll() { for (const u of this.units) this.recall(u); this.auto = false; }

  /** flat battery out there: dead, adrift, tumbling slowly */
  die(u) {
    u.state = 'dead';
    u.deadT = 0;
    u.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.8);
    u.thrust.set(0, 0, 0);
    if (u.attached) { this.release(u); u.state = 'dead'; }
    this.v.say('hachi_k3_dead', { n: u.name }, { force: true });
  }

  /** given up: it is out of the picture altogether */
  giveUp(u) {
    u.state = 'lost';
    u.job = null;
    if (u.model) { u.model.root.parent && u.model.root.parent.remove(u.model.root); u.model.dispose(); u.model = null; }
  }

  /** a drone's round found it */
  hit(u, E, hitPt) {
    if (u.state === 'lost') return;
    u.hp -= E / 6e5;
    const g = this.g;
    if (g.combat) g.combat.flash(u.pos.clone(), [1, 0.75, 0.4], 0.5, 0.1, u.vel);
    if (u.hp > 0) { if (u.hp < 0.4) this.recall(u, true); return; }
    // broken up: a flash, the pieces
    if (g.combat) {
      g.combat.explode(u.pos.clone(), u.vel.clone(), 0.18, false);
      if (u.model) {
        const body = u.model.root;
        body.parent && body.parent.remove(body);
        body.matrixAutoUpdate = false;
        g.combat.addWreck(body, u.pos.clone(), u.vel.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(4)), 30, 0.4);
        u.model = null;
      }
    }
    u.state = 'lost';
    u.job = null;
    this.v.say('hachi_k3_killed', { n: u.name }, { force: true });
  }

  /** the repair dock: new ones for those lost, all charged, the bay's spare plates topped up */
  restock() {
    this.spares = K3_SPEC.spares;
    this.bayQ.length = 0;
    this.bay.carry = null;
    for (const u of this.units) {
      if (u.model && !u.attached) this.attach(u);
      u.state = 'stowed'; u.battery = 1; u.hp = 1; u.job = null; u.slot = u.i;
      if (!u.model) this.buildModel(u);
      this.placeInSlot(u);
    }
    this.bay.step = 'idle'; this.bay.hatchT = 0; this.bay.liftT = 0;
  }

  // ================================================================== the bay's machinery
  updateBay(dt) {
    const B = this.bay, A = this.g.audio, v = this.v;
    const heard = A.ready && (v.crew || v.mode === 'docked');
    const at = V(0, -0.2, 0).applyMatrix4(this.bayM).add(H8.dockAt);
    const move = (key, target, rate) => {
      const was = B[key];
      B[key] += Math.sign(target - B[key]) * Math.min(Math.abs(target - B[key]), rate * dt);
      if (heard && was !== B[key] && (was === 0 || was === 1)) A.mech(at, key === 'hatch' ? 'hatch' : 'heavy', { open: target > was, dur: 1 / rate, gain: 0.5 });
      return Math.abs(B[key] - target) < 1e-4;
    };
    B.t += dt;
    const job = this.bayQ[0];
    if (B.step === 'idle') {
      if (job) { B.step = 'open'; B.t = 0; }
      else { move('hatch', 0, 0.9); move('lift', 0, 0.8); }
    }
    if (B.step === 'open') {
      if (move('hatch', 1, 0.85)) {
        if (!job) B.step = 'close';
        else if (job.kind === 'launch') { B.step = 'feed'; B.t = 0; }
        else { B.step = 'raiseEmpty'; B.t = 0; }
      }
    } else if (B.step === 'feed') {
      // the magazine turns the robot round under the hatch, onto the lift
      const u = job.u;
      const from = this.slots[u.slot], to = this.slots[0];
      const k = Math.min(1, B.t / 0.9);
      u.local.copy(from).lerp(to, sm(0, 1, k)).applyMatrix4(this.bayM);
      if (k >= 1) { B.carry = u; B.step = 'raise'; B.t = 0; }
    } else if (B.step === 'raise') {
      const u = B.carry;
      const done = move('lift', 1, 0.65);
      u.local.set(0, this.lerpLift() + K3_SIZE / 2 + 0.012, 0).applyMatrix4(this.bayM);
      u.arms = Math.min(1, B.lift);
      if (done) { B.step = 'release'; B.t = 0; }
    } else if (B.step === 'release') {
      const u = B.carry;
      u.arms = Math.min(1, B.t / 0.8);
      if (B.t > 0.9) {
        // off the cradle: a gentle push straight out
        const P = this.h8Pose();
        u.pos.copy(this.toEci(u.local, _v));
        u.vel.copy(P.vel).addScaledVector(this.tile.c.clone().applyQuaternion(P.quat), 0.8);
        u.refVel.copy(P.vel);
        u.q.copy(P.quat).multiply(this.bayQ0);
        u.state = 'out';
        u.job = null;
        u.slot = -1;
        this.detach(u);
        B.carry = null;
        this.bayQ.shift();
        B.step = 'lower'; B.t = 0;
      }
    } else if (B.step === 'raiseEmpty') {
      // the lift up and waiting for the robot coming home
      move('lift', 1, 0.65);
      const u = job.u;
      if (u.state === 'lost' || u.state === 'dead') { this.bayQ.shift(); B.step = 'lower'; return; }
      // close enough to the cradle: the latch takes it
      if (u.state === 'home' && B.lift > 0.99) {
        const D = this.dockPose();
        const fin = this.toEci(D.final, _v);
        const d = u.pos.distanceTo(fin);
        if (d > 0.03) {
          // the last metre straight down onto the cradle
          const P = this.h8Pose();
          const step = Math.min(d, dt * 0.6);
          u.pos.addScaledVector(fin.sub(u.pos).normalize(), step);
          u.vel.copy(P.vel);
          u.q.slerp(_q.copy(P.quat).multiply(this.bayQ0), Math.min(1, dt * 3));
        } else {
          u.state = 'dock';
          u.local.copy(D.final);
          u.localQ.copy(this.bayQ0);
          this.attach(u);
          B.carry = u;
          B.step = 'take'; B.t = 0;
          if (heard) A.mech(at, 'latch', { open: false, gain: 0.5 });
        }
      }
    } else if (B.step === 'take') {
      const u = B.carry;
      u.arms = Math.max(0, 1 - B.t / 0.8);
      if (B.t > 0.9) {
        const done = move('lift', 0, 0.6);
        u.local.set(0, this.lerpLift() + K3_SIZE / 2 + 0.012, 0).applyMatrix4(this.bayM);
        if (done) {
          // into a free slot of the magazine
          const used = new Set(this.units.filter((x) => x !== u && x.state !== 'lost' && x.slot >= 0).map((x) => x.slot));
          u.slot = [1, 2, 0].find((s) => !used.has(s)) ?? 0;
          B.step = 'store'; B.t = 0;
        }
      }
    } else if (B.step === 'store') {
      const u = B.carry;
      const k = Math.min(1, B.t / 0.9);
      u.local.copy(this.slots[0]).lerp(this.slots[u.slot], sm(0, 1, k)).applyMatrix4(this.bayM);
      if (k >= 1) { u.state = 'stowed'; B.carry = null; this.bayQ.shift(); B.step = this.bayQ.length ? 'open' : 'close'; B.t = 0; }
    } else if (B.step === 'lower') {
      if (move('lift', 0, 0.8)) B.step = this.bayQ.length ? 'open' : 'close';
    } else if (B.step === 'close') {
      if (this.bayQ.length) B.step = 'open';
      else if (move('hatch', 0, 0.9)) B.step = 'idle';
    }
  }

  lerpLift() { return this.liftY[0] + (this.liftY[1] - this.liftY[0]) * sm(0, 1, this.bay.lift); }

  // ================================================================== drawing
  updateVisual(dt, origin, camWorld) {
    const v = this.v;
    this.setHatch(sm(0, 1, this.bay.hatch));
    this.liftGrp.position.y = this.lerpLift();
    this.mats.led.emissiveIntensity = this.bay.hatch > 0.05 ? 2.2 * this.bay.hatch : 0;
    const t = performance.now() / 1000;
    const env = this.g.shipVis && this.g.shipVis.envSpace;
    for (const u of this.units) {
      const M = u.model;
      if (!M) continue;
      if (env) M.setEnv(env, 0.9);
      const r = M.root;
      if (u.attached) {
        r.matrix.compose(u.local, u.localQ, _v2.set(1, 1, 1));
        r.matrixWorldNeedsUpdate = true;
        r.visible = v.ext.group.visible !== false;
        const d = this.toEci(u.local, _v).sub(origin).distanceTo(camWorld);
        layerTree(r, Math.max(0, d - 1), d + 1);
      } else {
        r.matrix.compose(_v.copy(u.pos).sub(origin), u.q, _v2.set(1, 1, 1));
        r.matrixWorldNeedsUpdate = true;
        const d = _v.distanceTo(camWorld);
        r.visible = d < 25000;
        layerTree(r, Math.max(0, d - 1), d + 1);
      }
      // the arms: folded in the bay, out and gripping at a job, reaching while flying
      const W = u.state === 'work';
      const k = u.state === 'stowed' ? 0 : u.state === 'launch' || u.state === 'dock' ? u.arms : 1;
      const wob = W ? Math.sin(t * 5.3 + u.i) * 0.08 : 0;
      const fold = (a, b) => a + (b - a) * k;
      M.setArm('L', 0, fold(-1.45, W ? 0.55 : 0.25), fold(2.95, W ? 1.5 : 1.0), 0, W ? 0.95 : 0.4);
      M.setArm('R', 0, fold(-1.45, W ? 0.55 : 0.25), fold(2.95, W ? 1.5 : 1.0), 0, W ? 0.95 : 0.4);
      M.setArm('B', 0, fold(-1.45, W ? 0.95 + wob : 0.6), fold(2.95, W ? 1.75 - wob : 1.3), W ? t * 2 : 0, 0.5);
      // the lights: the ring bright while it works, amber low battery, red hurt; dead: dark
      const status = u.state === 'dead' ? 'off' : u.hp < 0.4 ? 'fault' : u.battery < 0.15 ? 'low' : 'ok';
      M.setLights({ ring: u.state === 'stowed' ? 0.3 : W ? 2.6 : 1.4, beacon: u.state !== 'stowed', status, lamp: W ? 1 : u.state === 'out' || u.state === 'home' ? 0.4 : 0, weld: W ? 1 : 0 });
      M.tick(dt, t);
      // the thrusters' puffs (in its own frame)
      if (u.attached || u.state === 'dead') M.setThrust(_v.set(0, 0, 0), _v2.set(0, 0, 0));
      else M.setThrust(u.thrust, _v2.set(0, 0, 0));
    }
  }

  /** a robot's ECI position while attached (for the HUD and the drones) */
  posOf(u, out) { return u.attached ? this.toEci(u.local, out) : out.copy(u.pos); }

  /** the robots flying free (the drones' targets and what H8's display tracks) */
  free() { return this.units.filter((u) => !u.attached && (u.state === 'out' || u.state === 'home' || u.state === 'dead')); }

  /** the K3 page's header line */
  line() {
    const n = this.units.filter((u) => u.state !== 'lost').length;
    const out = this.units.filter((u) => u.state === 'out' || u.state === 'work' || u.state === 'home' || u.state === 'launch').length;
    return `${n} 機${out ? `  出動 ${out}` : '  全機格納'}  予備装甲板 ${this.spares}${this.restoreRate > 0 ? `  装甲回復 ${(this.restoreRate * 300 * 100).toFixed(1)}%/5分` : ''}`;
  }

  /** the K3 page */
  drawTab(K, H, tabs) {
    const COL = { text: '#e8f2ff', dim: '#8aa0b8', red: '#ff5a4a', green: '#5fe08f', cyan: '#5fd0ff', amber: '#ffb347' };
    K.text('K3 修理ロボット', 14, 26, { size: 18, color: '#d7e7f7', weight: 700 });
    K.text(`自動出動 ${this.auto ? 'ON' : 'OFF'}`, 498, 26, { size: 14, color: this.auto ? COL.green : COL.dim, align: 'right' });
    let y = 40;
    for (const u of this.units) {
      const lost = u.state === 'lost';
      const st = STATE_JP[u.state] + (u.job && (u.state === 'work' || u.state === 'out') ? `・${u.job.name}` : '');
      K.rect(10, y, 492, 46, { fill: lost ? 'rgba(255,77,61,0.12)' : 'rgba(255,255,255,0.04)', stroke: lost ? COL.red : 'rgba(150,190,230,0.22)', r: 6 });
      K.text(u.name, 22, y + 20, { size: 16, color: lost ? COL.red : COL.text, weight: 700 });
      K.text(st, 96, y + 20, { size: 14, color: lost ? COL.red : u.state === 'work' ? COL.green : COL.dim });
      if (!lost) {
        K.bar(96, y + 30, 230, 6, u.battery, u.battery < 0.2 ? COL.red : u.battery < 0.4 ? COL.amber : COL.cyan);
        K.text(`電池 ${Math.round(u.battery * 100)}%`, 334, y + 36, { size: 12.5, color: COL.dim, mono: true });
        K.text(u.state === 'work' ? `${Math.round(u.prog * 100)}%` : u.hp < 1 ? `損傷 ${Math.round((1 - u.hp) * 100)}%` : '', 492, y + 22, { size: 13, color: u.hp < 0.5 ? COL.red : COL.dim, align: 'right', mono: true });
      }
      y += 52;
    }
    const jobs = this.jobs();
    if (y < H - 70) K.text(jobs.length ? `修理待ち ${jobs.length} 件：${jobs.slice(0, 3).map((j) => j.name).join('・')}` : '修理の必要なし', 14, y + 14, { size: 14, color: jobs.length ? COL.amber : COL.dim });
    tabs.buttons(K, H, [
      ['出動', () => { this.auto = true; if (!this.sendAll()) this.v.say('hachi_k3_none', {}, { minGap: 4 }); }],
      ['全機帰還', () => this.recallAll()],
      [this.auto ? '自動 OFF' : '自動 ON', () => { this.auto = !this.auto; }, this.auto ? 'on' : 'normal'],
    ]);
  }

  // ================================================================== save
  serialize() { return { u: this.units.map((u) => [u.state === 'lost' ? 0 : 1, +u.battery.toFixed(3), +u.hp.toFixed(3)]), s: this.spares, a: this.auto ? 1 : 0 }; }

  restore(d) {
    if (!d) return;
    this.spares = d.s ?? K3_SPEC.spares;
    this.auto = d.a !== 0;
    this.bayQ.length = 0;
    this.bay = { hatch: 0, hatchT: 0, lift: 0, liftT: 0, step: 'idle', t: 0, carry: null };
    (d.u || []).forEach((r, i) => {
      const u = this.units[i];
      if (!u) return;
      if (!r[0]) { this.giveUp(u); return; }
      if (!u.model) this.buildModel(u);
      u.state = 'stowed'; u.battery = r[1] ?? 1; u.hp = r[2] ?? 1; u.job = null; u.slot = i;
      this.placeInSlot(u);
    });
  }
}
