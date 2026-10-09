// A station's rescue craft (救助艇), sent out for H8's drifting shelter when B-29 cannot come. A
// stubby white-and-orange tug with a capture collar on its nose and two capture arms: it leaves
// the station's H8 port, flies out on the same planet-aware guidance HACHI uses (at a rescue
// craft's pace), swings round behind the shelter, steadies its tumble with the arms and latches
// its collar onto the shelter's back plate. Then it holds the shelter fast.
import * as THREE from 'three';
import { Flight } from '../ship/flight.js';
import { Builder } from '../ship/geom.js';
import { guidance, ratesNose, ratesToward } from './h8Pilot.js';
import { assignLayers } from '../core/layers.js';
import { SHELTER } from './h8Shelter.js';
import { EnginePlume, plumeAir } from '../fx/enginePlume.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _tl = new THREE.Vector3(), _tq = new THREE.Quaternion();
const NOSE = 5.5;                                    // tug origin to the face of its collar
export const TUG_NOSE = NOSE;
// latched: the tug's origin in the shelter's (H8's) frame, the tug in the same attitude, its nose
// (-z) against the back plate
const LATCH = V(0, SHELTER.center.y, SHELTER.z1 + 0.14 + NOSE);

let MATS = null;
function mats() {
  if (MATS) return MATS;
  const S = (o) => new THREE.MeshStandardMaterial(o);
  MATS = {
    white: S({ color: 0xeef0ee, roughness: 0.45, metalness: 0.15 }),
    orange: S({ color: 0xe8641e, roughness: 0.5, metalness: 0.1 }),
    dark: S({ color: 0x2a2e33, roughness: 0.5, metalness: 0.5 }),
    steel: S({ color: 0xb8bec4, roughness: 0.3, metalness: 0.9 }),
    solar: S({ color: 0x1a2a55, roughness: 0.3, metalness: 0.6 }),
    glass: S({ color: 0x10202c, roughness: 0.1, metalness: 0.4, emissive: new THREE.Color(0.4, 0.7, 1.0), emissiveIntensity: 0.6 }),
    strobe: S({ color: 0x000000, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 }),
    navR: S({ color: 0x000000, emissive: new THREE.Color(1, 0.08, 0.04), emissiveIntensity: 5 }),
    navG: S({ color: 0x000000, emissive: new THREE.Color(0.1, 1, 0.25), emissiveIntensity: 5 }),
    flood: S({ color: 0x000000, emissive: new THREE.Color(0.95, 0.97, 1), emissiveIntensity: 4 }),
  };
  return MATS;
}

export function tugModel() {
  const M = mats();
  const b = new Builder();
  b.plainUpTo = 0.06;
  // body, a band of orange, the cockpit windows (it flies itself), the collar on its nose
  b.cyl(1.7, 1.7, 7.0, 'white', [0, 0, 0.2], [Math.PI / 2, 0, 0], 20);
  b.cyl(1.72, 1.72, 1.2, 'orange', [0, 0, -1.6], [Math.PI / 2, 0, 0], 20);
  b.cyl(1.72, 1.72, 0.5, 'orange', [0, 0, 2.6], [Math.PI / 2, 0, 0], 20);
  b.cyl(1.0, 1.7, 1.3, 'white', [0, 0, -3.95], [Math.PI / 2, 0, 0], 20);
  b.cyl(1.0, 1.0, 0.9, 'dark', [0, 0, -5.05], [Math.PI / 2, 0, 0], 18);
  b.torus(1.0, 0.09, 'orange', [0, 0, -5.45], [0, 0, 0], 18);
  for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + Math.PI / 4; b.box(0.3, 0.3, 0.25, 'steel', [Math.cos(a) * 0.85, Math.sin(a) * 0.85, -5.4], null, 0); }
  for (const s of [-1, 1]) b.box(0.5, 0.28, 0.06, 'glass', [s * 0.55, 1.35, -3.6], [-0.55, 0, 0], 0);
  // the capture arms, folded forward along the collar
  for (const s of [-1, 1]) {
    b.pipe(V(s * 1.5, 0.6, -2.6), V(s * 1.6, 0.4, -6.4), 0.07, 'steel', 6);
    b.box(0.22, 0.22, 0.4, 'orange', [s * 1.6, 0.4, -6.5], null, 0);
  }
  // the main engine and its bell, RCS quads, two small solar wings, lights
  b.cyl(1.2, 0.6, 1.4, 'dark', [0, 0, 4.4], [Math.PI / 2, 0, 0], 16, true);
  for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2; b.box(0.35, 0.35, 0.35, 'dark', [Math.cos(a) * 1.75, Math.sin(a) * 1.75, -2.6], null, 0); b.box(0.35, 0.35, 0.35, 'dark', [Math.cos(a) * 1.75, Math.sin(a) * 1.75, 2.2], null, 0); }
  for (const s of [-1, 1]) { b.box(4.2, 0.06, 1.4, 'solar', [s * 3.9, 0, 1.2], null, 0); b.box(0.4, 0.1, 0.2, 'steel', [s * 1.9, 0, 1.2], null, 0); }
  b.sphere(0.18, 'strobe', [0, 1.8, 0.6], 8);
  b.sphere(0.14, 'navR', [-1.75, 0, -1.6], 8);
  b.sphere(0.14, 'navG', [1.75, 0, -1.6], 8);
  for (const s of [-1, 1]) b.cyl(0.16, 0.16, 0.08, 'flood', [s * 0.6, 0.9, -4.7], [Math.PI / 2, 0, 0], 10);
  const g = b.build(M, { castShadow: false });
  // the drive's plume (shown while it burns)
  g.userData.plume = new EnginePlume(g, { exits: [V(0, 0, 5.1)], r0: 1.0, len: 26, style: 'blue', spread: 0.32, dia: 0.45, seed: 6.2, owner: 'tug' });
  g.matrixAutoUpdate = false;
  return g;
}

export class RescueTug {
  /** vessel: H8 (its flight is the shelter's while it drifts); s: the station sending it */
  constructor(vessel, s) {
    this.v = vessel;
    this.g = vessel.g;
    this.s = s;
    const g = this.g;
    this.f = new Flight({ normalMax: 600, ultraMax: 6000, aMax: 32, mass: 18000, CdA: 8, comfortK: 4, rampK: 6, turnK: 5, tank: { cap: 1e7, ve: 6e4 } });
    // out of the station's H8 port, with the station's motion and attitude
    const pose = g.docking.stationPose(s, g.time);
    const p0 = g.stations.h8PortOf(s).clone().add(V(0, 15, 0)).applyQuaternion(pose.quat).add(pose.pos);
    const f = this.f;
    f.pos.copy(p0);
    g.docking.frameVel(s, pose, p0, f.vel);
    f.hRef.crossVectors(pose.pos, pose.vel).normalize();
    f.qRel.copy(f.lvlhQuat(f.pos, new THREE.Quaternion()).invert().multiply(pose.quat));
    f.updateAttitude();
    f.autopilot = { vRel: V(0, 0, 0), wDes: V(0, 0, 0), aff: null, fast: true };
    this.state = 'out';            // out | swing | dock | latched
    this.wp = [];
    this.t = 0;
    this.eta = 0;
    this.dist = p0.distanceTo(vessel.flight.pos);
    this.mesh = tugModel();
    g.engine.scene.add(this.mesh);
  }

  /** the shelter's frame right now */
  podPose() { const f = this.v.flight; return { pos: f.pos, vel: f.vel, quat: f.quat }; }

  /** per simulation step (after the shelter's own step) */
  step(dt) {
    const g = this.g, f = this.f, P = this.podPose();
    this.t += dt;
    if (this.state === 'latched') { this.holdPod(); return; }
    // the tug's own step first (on last step's command): the shelter has already made its own,
    // the two must be compared at the same instant (they part 770 m a tenth of a second otherwise)
    f.step(dt, null, (pos) => g.terrainAt(pos));
    const rel = P.pos.clone().sub(f.pos);
    this.dist = rel.length();
    if (this.state === 'out') {
      // the long leg: straight for the shelter at a rescue craft's pace (and round the planet if
      // it has to be)
      const gd = guidance(f, { pos: P.pos, vel: P.vel, tether: false }, { vmax: 6000, a: 24, standoff: 120 });
      f.autopilot.vRel.copy(gd.vRel);
      f.autopilot.tau = undefined;
      const want = gd.v > 2 ? gd.moveDir : rel.clone().normalize();
      ratesNose(f.quat, want, 40 * Math.PI / 180, f.autopilot.wDes, 1.2);
      this.eta = gd.eta;
      if (this.dist < 400) this.planDock();
    } else this.steerDock(dt, P);
    // close by: its arms steady the shelter's slow tumble
    if (this.dist < 220) this.v.flight.wRel.multiplyScalar(Math.exp(-dt * 0.35));
  }

  /** behind the shelter (its +z, the back plate), then in along its axis */
  planDock() {
    const P = this.podPose(), f = this.f;
    const loc = f.pos.clone().sub(P.pos).applyQuaternion(P.quat.clone().invert());
    this.wp = [];
    if (loc.z < 40) this.wp.push({ p: V(loc.x >= 0 ? 60 : -60, LATCH.y, 40), v: 60, a: 12, tol: 8, pass: true });
    this.wp.push({ p: V(0, LATCH.y, 45), v: 40, a: 10, tol: 4, pass: true });
    this.wp.push({ p: LATCH.clone().add(V(0, 0, 8)), v: 6, a: 4, tol: 0.5, pass: true });
    this.wp.push({ p: LATCH.clone().add(V(0, 0, 0.8)), v: 1.2, a: 1.5, tol: 0.12, pass: true });
    this.wp.push({ p: LATCH.clone(), v: 0.4, a: 0.6, tol: 0.06, final: true });
    this.state = 'dock';
  }

  /** proximity operations in the shelter's frame, matching its attitude (as HACHI docks) */
  steerDock(dt, P) {
    const f = this.f;
    const w = this.wp[0];
    if (!w) return;
    const tgt = w.p.clone().applyQuaternion(P.quat).add(P.pos);
    const err = tgt.sub(f.pos);
    const dist = err.length();
    const dir = err.divideScalar(Math.max(dist, 1e-6));
    let v = Math.min(w.v, Math.sqrt(2 * w.a * Math.max(0, dist - w.tol * 0.4)));
    if (w.pass) {
      const n = this.wp[1];
      if (n) v = Math.max(v, Math.min(w.v, n.v));
    } else v = Math.min(v, Math.max(0.05, dist * 1.5));
    f.autopilot.vRel.copy(P.vel).addScaledVector(dir, v).sub(f.refVelocity(f.pos, new THREE.Vector3()));
    f.autopilot.tau = 0.4;
    const r = ratesToward(f.quat, P.quat, 30 * Math.PI / 180, 1.6, f.autopilot.wDes);
    const relV = f.vel.clone().sub(P.vel).length();
    if (w.final) {
      if ((dist < w.tol && relV < 0.12 && r.ang < 0.05) || (dist < 0.2 && this.t > 600)) {
        this.state = 'latched'; this.latchedAt = this.t; this.holdPod();
        this.v.asphalt('pod_station_capture', { name: this.s.name });
        if (this.v.crew) { this.g.shake = Math.max(this.g.shake, 0.5); this.g.audio.impact(new THREE.Vector3(0, 8.2, 2.6), 0.14); this.g.audio.mech(new THREE.Vector3(0, 8.2, 2.6), 'clamp', { open: false }); }
      }
      return;
    }
    if (dist < w.tol && (w.pass || r.ang < 0.1)) this.wp.shift();
  }

  /** latched: the shelter rides on the tug's nose (one rigid body; the tug keeps still) */
  holdPod() {
    const P = this.v.flight, f = this.f;
    P.wRel.set(0, 0, 0);
    f.quat.copy(P.quat);
    f.pos.copy(LATCH).applyQuaternion(P.quat).add(P.pos);
    f.vel.copy(P.vel);
  }

  /** per drawn frame */
  updateVisual(dt, origin, camWorld) {
    const f = this.f, m = this.mesh;
    const rel = f.pos.clone().sub(origin);
    m.matrix.compose(rel, f.quat, V(1, 1, 1));
    m.matrixWorld.copy(m.matrix);
    m.updateMatrixWorld(true);
    const d = rel.distanceTo(camWorld);
    m.traverse((o) => { if (o.isMesh) assignLayers(o, Math.max(0, d - 12), d + 12); });
    const M = mats();
    const ph = (performance.now() / 1400) % 1;
    M.strobe.emissiveIntensity = ph < 0.05 || (ph > 0.14 && ph < 0.19) ? 8 : 0;
    // the main engine burns for what it pushes forward (the RCS does the fine work)
    const thr = _tl.copy(f.thrustAcc).applyQuaternion(_tq.copy(f.quat).invert());
    const burn = this.state === 'latched' ? 0 : Math.min(1.2, Math.max(0, -thr.z) / 14 + thr.length() / 60);
    const P = m.userData.plume;
    P.update(dt, burn, plumeAir(f.rho || 0), 0);
    P.setDistance(d);
  }

  dispose() {
    this.g.engine.scene.remove(this.mesh);
    this.mesh.userData.plume.dispose();
  }
}
