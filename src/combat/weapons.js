// The guns Kaito (and the two AIs) can use.
//  H8: two twin 25 mm cannon turrets and a railgun turret that run right round the sphere on two
//      gun rings (gunRings.js: the upper ring's carriage carries the port twin, the lower ring's
//      tandem carriage the starboard twin and the railgun) — a carriage runs to the bearing of
//      what its guns are on, so they bear in any direction without H8 turning; the cradles
//      elevate from well below their own horizon to past the vertical — and two box launchers
//      with six homing missiles each. Every
//      turret has its own fire control (ballistics.js): it tracks the target, solves the shot by
//      flying it, turns the turret onto the solution at the turret's own slew rate, and fires
//      rounds that scatter as real ones do. A turret only fires where the sphere does not stand in
//      the way, and never with anything friendly in the line of fire (B-29, H8, a station).
//      Targets: whatever the 360 display has locked — the focus first, at the point Kaito picked on
//      it — drones and rocks on their own, out to 30 km for Kaito's own fire.
//  B-29: one old debris-defence gun in a turret under the belly (an older, coarser fire control).
// Kaito fires from the pilot seat (hold the trigger button; the railgun and the missile button in
// H8 — the missile button also in B-29's seat while H8 rides on its back: H8's launchers fire).
// HACHI's automatic intercept (H8): the turrets on the nearest enemy inside 50 km all the time,
// the cannon firing when its fire control gives the burst a chance, the railgun when a slug has
// one, a missile at a time beyond the guns' reach. Asphalt (B-29's gun) fires at drones that come
// close while its "auto" is on.
// Every round leaves from its own barrel's muzzle (the turret's pointing, the barrel it is, the
// barrel's length), the barrel slams back and runs out again, the cradle kicks, flame and smoke
// leave the muzzle, the empty case spins out of the breech; a missile blows its cell's lid off.
// H8 makes its own ammunition from the power of its reactor (arsenal.js); B-29's gun and the
// fabricator's feedstock are refilled at a station berth.
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';
import { sectionPoint, sectionNormal } from '../ship/hullShape.js';
import { H8 } from '../h8/h8Spec.js';
import { frameAt } from '../h8/h8Exterior.js';
import { assignLayers, LAYER_NEAR, LAYER_MID } from '../core/layers.js';
import { leadDir, ROUNDS, rockId } from './combat.js';
import { AMMO, GUNS, FireControl, seedOf } from './ballistics.js';
import { Arsenal } from './arsenal.js';
import { ZONE } from '../h8/hachiDefence.js';
import { RINGS, DECK, CARRIAGE, ringFrame, ringCircle, buildRing, buildSled, buildLink, Carriage, dAng } from './gunRings.js';
import { QUALITY } from '../core/quality.js';
import { starsText } from './drones.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();
const Z = V(0, 0, -1);

export const AMMO_MAX = { cannon: 1600, rail: 24, missile: 12, pd: 900 };
/** a fixed mount's cradle elevation range (rad from its tangent plane): B-29's gun */
const PITCH_FIXED = [-0.12, 1.45];
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
    // the gun rings: the rail, its lit guide strip, the carriages' bits
    ringRail: S({ color: 0x7f878f, metalness: 0.9, roughness: 0.3 }),
    ringGlow: S({ color: 0x000000, emissive: new THREE.Color(0.35, 0.85, 1.0), emissiveIntensity: 1.6 }),
    sledLamp: S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.6, 0.15), emissiveIntensity: 3 }),
    steel: S({ color: 0x9aa3ab, metalness: 0.9, roughness: 0.25 }),
    cable: S({ color: 0x1b1d20, metalness: 0.1, roughness: 0.7 }),
    // the missile launchers: the tube's dark inside, the ready missile's nose
    tubeIn: S({ color: 0x0b0c0e, metalness: 0.4, roughness: 0.8 }),
    mslWhite: S({ color: 0xe4e7ea, metalness: 0.45, roughness: 0.38 }),
    mslBand: S({ color: 0xe0a020, metalness: 0.3, roughness: 0.5 }),
  };
}

/** a muzzle flash texture: a hot core and four spikes (made once) */
let FLASH_TEX = null;
function flashTex() {
  if (FLASH_TEX) return FLASH_TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,245,1)'); g.addColorStop(0.22, 'rgba(255,214,140,0.9)'); g.addColorStop(0.6, 'rgba(255,140,40,0.25)'); g.addColorStop(1, 'rgba(255,110,20,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  x.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 4; k++) {
    x.save(); x.translate(32, 32); x.rotate(k * Math.PI / 2 + 0.35);
    const lg = x.createLinearGradient(0, 0, 31, 0);
    lg.addColorStop(0, 'rgba(255,236,190,0.95)'); lg.addColorStop(1, 'rgba(255,150,60,0)');
    x.fillStyle = lg; x.beginPath(); x.moveTo(0, -2.6); x.lineTo(31, 0); x.lineTo(0, 2.6); x.fill();
    x.restore();
  }
  FLASH_TEX = new THREE.CanvasTexture(c);
  FLASH_TEX.colorSpace = THREE.SRGBColorSpace;
  return FLASH_TEX;
}

/** a muzzle flash at the end of a barrel (barrel along -z): a star seen from ahead and the cone of
 * fire seen from the side, additive, shown for a frame or two */
function flashMesh(size, color, brake = true) {
  const mat = new THREE.MeshBasicMaterial({ map: flashTex(), color: new THREE.Color(...color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const g = new THREE.Group();
  const star = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  const cone = new THREE.PlaneGeometry(size * 0.6, size * 1.9);
  cone.rotateX(-Math.PI / 2);
  cone.translate(0, 0, -size * 0.8);
  const a = new THREE.Mesh(cone, mat), b = new THREE.Mesh(cone.clone().rotateZ(Math.PI / 2), mat);
  g.add(star, a, b);
  // the muzzle brake throws flame out sideways through its ports (a pair of crossed jets each side)
  if (brake) {
    for (const s of [-1, 1]) {
      const j = new THREE.PlaneGeometry(size * 0.75, size * 0.22);
      j.translate(s * size * 0.42, 0, 0.06);
      g.add(new THREE.Mesh(j, mat), new THREE.Mesh(j.clone().rotateX(Math.PI / 2), mat));
    }
  }
  // and a glow round it whichever way it is seen from
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex(), color: new THREE.Color(...color).multiplyScalar(0.55), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  glow.scale.setScalar(size * 1.7);
  glow.position.z = -size * 0.35;
  g.add(glow);
  g.visible = false;
  g.userData.mat = mat;
  g.userData.glow = glow.material;
  return g;
}

/** a turret: base on the hull, a head that turns (yaw) and a cradle that elevates (pitch), each
 *  barrel on its own slide (it recoils by itself). Local frame: +y = the hull normal at the
 *  mount. kind: 'twin' | 'rail' | 'pd' */
function turret(M, kind) {
  const base = new Builder(), head = new Builder(), cradle = new Builder();
  const big = kind === 'rail';
  base.cyl(big ? 0.42 : 0.32, big ? 0.48 : 0.36, 0.14, 'gunDark', [0, 0.05, 0], null, 24);
  base.torus(big ? 0.43 : 0.33, 0.025, 'hazard', [0, 0.12, 0], [Math.PI / 2, 0, 0], 32);
  head.cyl(big ? 0.34 : 0.26, big ? 0.38 : 0.3, 0.14, 'gunMetal', [0, 0.2, 0], null, 20);
  head.box(big ? 0.56 : 0.42, big ? 0.26 : 0.22, big ? 0.62 : 0.44, 'gunMetal', [0, 0.36, 0.02], null, 0.05);
  head.box(0.1, 0.08, 0.1, 'gunDark', [big ? 0.22 : 0.17, 0.5, -0.12], null, 0.01);
  head.sphere(0.03, 'sensor', [big ? 0.22 : 0.17, 0.5, -0.18], 8);
  // the trunnions the cradle swings on
  for (const sx of [-1, 1]) head.cyl(0.05, 0.05, 0.05, 'gunDark', [sx * (big ? 0.27 : 0.2), 0.36, 0], [0, 0, Math.PI / 2], 12);
  const barrels = [];
  const slides = [];
  if (kind === 'twin' || kind === 'pd') {
    const n = kind === 'twin' ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const x = n === 2 ? (i ? 0.075 : -0.075) : 0;
      // fixed: the breech block and the recoil cylinder the barrel slides in
      cradle.cyl(0.05, 0.05, 0.22, 'gunDark', [x, 0, -0.18], [Math.PI / 2, 0, 0], 10);
      cradle.cyl(0.018, 0.018, 0.3, 'gunMetal', [x, 0.055, -0.3], [Math.PI / 2, 0, 0], 8);
      // the barrel on its slide: tube, a jacket at the breech end, the muzzle brake with its ports
      const b = new Builder();
      b.cyl(0.028, 0.032, 0.86, 'barrel', [0, 0, -0.68], [Math.PI / 2, 0, 0], 10);
      b.cyl(0.038, 0.038, 0.16, 'gunMetal', [0, 0, -0.34], [Math.PI / 2, 0, 0], 10);
      b.cyl(0.042, 0.042, 0.08, 'gunDark', [0, 0, -1.1], [Math.PI / 2, 0, 0], 10);
      for (const z of [-1.08, -1.12]) b.box(0.092, 0.012, 0.014, 'gunDark', [0, 0, z], null, 0);
      const slide = new THREE.Group();
      slide.position.set(x, 0, 0);
      slide.add(b.build(M, { castShadow: false }));
      const fl = flashMesh(kind === 'pd' ? 0.5 : 0.62, [7, 4.6, 2.2]);
      fl.position.set(0, 0, -1.16);
      slide.add(fl);
      slides.push(slide);
      // (tip: where the round leaves, from the pitch pivot, along -z; breech: where the case comes out)
      barrels.push({ slide, x, tip: 1.16, flash: fl, rec: 0, flashT: 0 });
    }
    cradle.box(0.26, 0.14, 0.3, 'gunDark', [0, 0, 0.02], null, 0.03);
    cradle.box(0.16, 0.1, 0.18, 'gunMetal', [0, -0.12, 0.05], null, 0.02);      // feed chute
    // the ejection port on the outboard side
    cradle.box(0.012, 0.05, 0.09, 'gunDark', [0.135, 0.02, -0.05], null, 0);
  } else {
    // railgun: two rails in a long frame, coil rings, a glow along the bore when charged (the
    // whole cradle recoils on its slide)
    const b = new Builder();
    b.box(0.32, 0.22, 0.5, 'gunDark', [0, 0, 0.05], null, 0.04);
    for (const s of [-1, 1]) b.box(0.05, 0.16, 2.1, 'barrel', [s * 0.07, 0, -1.2], null, 0.01);
    b.box(0.2, 0.04, 2.1, 'gunMetal', [0, 0.1, -1.2], null, 0.01);
    b.box(0.2, 0.04, 2.1, 'gunMetal', [0, -0.1, -1.2], null, 0.01);
    for (let k = 0; k < 7; k++) b.torus(0.15, 0.03, 'coil', [0, 0, -0.45 - k * 0.3], [0, 0, 0], 16);
    b.box(0.06, 0.06, 2.0, 'railGlow', [0, 0, -1.2], null, 0.01);
    const slide = new THREE.Group();
    slide.add(b.build(M, { castShadow: false }));
    const fl = flashMesh(1.1, [2.4, 4.2, 7]);
    fl.position.set(0, 0, -2.28);
    slide.add(fl);
    slides.push(slide);
    barrels.push({ slide, x: 0, tip: 2.28, flash: fl, rec: 0, flashT: 0 });
    // the slide's rails (fixed)
    for (const s of [-1, 1]) cradle.box(0.03, 0.03, 0.6, 'gunMetal', [s * 0.18, -0.08, 0.05], null, 0);
  }
  const g = new THREE.Group();
  const bm = base.build(M, { castShadow: false });
  const hYaw = new THREE.Group();
  hYaw.add(head.build(M, { castShadow: false }));
  const hPitch = new THREE.Group();
  hPitch.position.set(0, 0.36, 0);
  const cr = new THREE.Group();
  cr.add(cradle.build(M, { castShadow: false }), ...slides);
  hPitch.add(cr);
  hYaw.add(hPitch);
  g.add(bm, hYaw);
  g.userData = { yaw: hYaw, pitch: hPitch, cradle: cr, barrels, kind };
  return g;
}

/**
 * A missile launcher: an armoured housing round a single launch tube, clamshell doors over its
 * mouth, the next missile's nose rising into the tube as the loader brings it up from the magazine,
 * status lamps (green ready, amber loading, red empty). Local frame: +y out of the hull
 */
function launcher(M) {
  const b = new Builder();
  b.box(0.62, 0.3, 0.74, 'gunMetal', [0, 0.15, 0], null, 0.05);
  b.box(0.66, 0.05, 0.78, 'hazard', [0, 0.025, 0], null, 0.012);
  for (const s of [-1, 1]) b.box(0.05, 0.36, 0.6, 'gunDark', [s * 0.34, 0.18, 0], null, 0.012);
  b.cyl(0.2, 0.21, 0.06, 'gunDark', [0, 0.31, 0], null, 28);
  b.cyl(0.155, 0.155, 0.3, 'tubeIn', [0, 0.18, 0], null, 24, true);
  b.cyl(0.155, 0.155, 0.01, 'tubeIn', [0, 0.04, 0], null, 24);
  // the loader's guide rails down the tube wall
  for (const s of [-1, 1]) b.box(0.012, 0.28, 0.02, 'steel', [s * 0.14, 0.18, 0], null, 0.002);
  const g = b.build(M, { castShadow: false });
  // the doors, hinged at the collar's sides
  const doors = [];
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(s * 0.2, 0.345, 0);
    const db = new Builder();
    db.box(0.2, 0.026, 0.4, 'podLid', [-s * 0.1, 0, 0], null, 0.008);
    db.box(0.16, 0.006, 0.32, 'hazard', [-s * 0.1, 0.015, 0], null, 0.002);
    db.cyl(0.018, 0.018, 0.42, 'steel', [0, 0, 0], [Math.PI / 2, 0, 0], 10);
    hinge.add(db.build(M, { castShadow: false }));
    g.add(hinge);
    doors.push({ hinge, s });
  }
  // the ready missile's nose in the tube
  const nb = new Builder();
  nb.cyl(0.1, 0.1, 0.3, 'mslWhite', [0, -0.15, 0], null, 18);
  nb.lathe([[0.1, 0], [0.097, 0.07], [0.086, 0.15], [0.066, 0.22], [0.04, 0.27], [0.012, 0.3], [0, 0.302]], 'mslWhite', [0, 0, 0], null, 18);
  nb.cyl(0.102, 0.102, 0.05, 'mslBand', [0, 0.06, 0], null, 18);
  nb.sphere(0.03, 'tubeIn', [0, 0.29, 0], 10);
  const nose = nb.build(M, { castShadow: false });
  g.add(nose);
  // its lamps
  const lamp = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.2, 1.0, 0.35), emissiveIntensity: 3 });
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 6), lamp);
    l.position.set(s * 0.25, 0.305, 0.33);
    g.add(l);
  }
  g.userData = { doors, nose, lamp };
  return g;
}

/** missile launch range (m) and the time a launcher takes to reload (s) */
export const MSL_RANGE = 120e3;
const MSL_RELOAD = 1.0;

export class Weapons {
  constructor(game, combat) {
    this.g = game;
    this.combat = combat;
    this.M = weaponMaterials();
    this.ammo = { cannon: AMMO_MAX.cannon, rail: AMMO_MAX.rail, missile: AMMO_MAX.missile, pd: AMMO_MAX.pd };
    // H8's ammunition fabricator (run by H8's power plant: h8.js updatePower)
    this.arsenal = new Arsenal(this.ammo, AMMO_MAX, (made) => this.onMade(made));
    this.auto = { hachi: true, asphalt: true };
    this.tgtIndex = { h8: 0, b29: 0 };
    this.railCharge = 1;
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
    const lowq = QUALITY.level !== 'high';
    // everything of the guns in one group of H8's: it shows from the cockpit too (the outside
    // cameras see the guns: the display shows them turning and firing)
    const G = new THREE.Group();
    G.name = 'h8Guns';
    G.matrixAutoUpdate = false;
    h8.root.add(G);
    this.gunGroup = G;
    // the two rings (pylons kept off the meridian handrails on the upper hemisphere)
    const rails = [0.55, 1.6, 2.6, 3.7, 4.7, 5.7];
    RINGS.forEach((ring, k) => G.add(buildRing(this.M, ring, { lowq, avoid: k === 0 ? rails : [] })));
    this.carriages = RINGS.map((ring) => new Carriage(ring));
    // the lower ring's tandem carriage: its two sleds a metre apart, tied by a bar
    const lower = ringCircle(RINGS[1]);
    const half = 0.52 / lower.rad;
    this.halfL = half;
    this.linkLen = 2 * lower.rad * Math.sin(half) - 0.62;
    this.link = buildLink(this.M, this.linkLen);
    this.link.matrixAutoUpdate = false;
    G.add(this.link);
    const mk = (name, kind, ring, dth) => {
      const t = turret(this.M, kind);
      t.matrixAutoUpdate = false;
      G.add(t);
      const sled = buildSled(this.M, { lowq });
      sled.matrixAutoUpdate = false;
      G.add(sled);
      // its barrels glow as they heat up (its own copy of the barrel material)
      const heat = this.M.barrel.clone();
      heat.emissive = new THREE.Color(1.0, 0.34, 0.07);
      heat.emissiveIntensity = 0;
      t.traverse((o) => { if (o.isMesh && o.material === this.M.barrel) o.material = heat; });
      const m = {
        name, kind, group: t, sled, ring, carriage: this.carriages[ring], dth, heat,
        dir: new THREE.Vector3(), frame: { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() }, origin: new THREE.Vector3(), rest: new THREE.Vector3(),
        // the cradle's elevation range and the lowest line of fire that clears the hull
        pitch: kind === 'rail' ? [-0.42, 1.62] : [-0.6, 1.62], depress: kind === 'rail' ? -0.38 : -0.5,
        cool: 0, alt: 0, recoil: 0, kick: 0, aim: null, flash: 0, cur: new THREE.Vector3(),
        fc: new FireControl({ am: kind === 'rail' ? AMMO.rail : AMMO.c25, gun: kind === 'rail' ? GUNS.rail : GUNS.twin25, seed: seedOf('h8.' + name), sensor: { ...SENSOR_H8 } }),
      };
      this.placeMount(m);
      m.cur.copy(m.rest);
      this.h8Mounts.push(m);
      return m;
    };
    mk('gunA', 'twin', 0, 0);
    mk('gunB', 'twin', 1, -half);
    mk('rail', 'rail', 1, half);
    // the two missile launchers (aft, high on each side): each its own tube, reloaded from the
    // magazine inside in a second
    this.launchers = [];
    for (const s of [-1, 1]) {
      const p = launcher(this.M);
      const d = V(s * 0.82, 0.3, 0.48).normalize();
      const f = frameAt(d);
      const at = d.clone().multiplyScalar(R - 0.04);
      p.matrix.makeBasis(f.x, f.y, f.z).setPosition(at);
      p.matrixAutoUpdate = false;
      G.add(p);
      this.launchers.push({ group: p, dir: d, frame: f, at, side: s, loaded: true, load: 1, reload: 0, door: 0, doorT: 0, kick: 0, queue: null, closeT: 0 });
    }
    // H8 keeps the group's layers (near, or by distance)
    const meshes = [];
    G.traverse((o) => { if (o.isMesh || o.isSprite) meshes.push(o); });
    for (const o of meshes) { o.layers.set(LAYER_NEAR); o.frustumCulled = false; if (o.parent && o.parent !== G) o.matrixAutoUpdate = true; }
    h8.gunGroup = G;
    h8.gunMeshes = meshes;
    this.placeGuns();
  }

  /** a ring turret where its carriage is now: its frame, base, the way it faces at rest */
  placeMount(m) {
    const C = m.carriage;
    const F = ringFrame(RINGS[m.ring], C.th + m.dth, m._rf || (m._rf = {}));
    m.frame.x.copy(F.f.x); m.frame.y.copy(F.f.y); m.frame.z.copy(F.f.z);
    m.dir.copy(F.n);
    m.origin.copy(F.p).addScaledVector(F.n, DECK);
    m.rest.copy(F.t);
    m.railP = F.p;
  }

  /** the sleds, the turrets on them and the link bar where the carriages are (H8's frame) */
  placeGuns() {
    for (const m of this.h8Mounts) {
      if (m.ring == null) continue;
      this.placeMount(m);
      const f = m.frame;
      m.sled.matrix.makeBasis(f.x, f.y, f.z).setPosition(m.railP);
      m.group.matrix.makeBasis(f.x, f.y, f.z).setPosition(m.origin);
    }
    const C = this.carriages && this.carriages[1];
    if (C && this.link) {
      // (on the chord between the two sleds)
      const F = ringFrame(RINGS[1], C.th, this._lf || (this._lf = {}));
      const a = ringFrame(RINGS[1], C.th + this.halfL, this._la || (this._la = {})).p;
      const b = ringFrame(RINGS[1], C.th - this.halfL, this._lb || (this._lb = {})).p;
      this.link.matrix.makeBasis(F.f.x, F.f.y, F.f.z).setPosition(_v.copy(a).add(b).multiplyScalar(0.5));
    }
  }

  /**
   * The carriages run toward what their guns are on: the upper one to the bearing of its twin's
   * aim; the lower one to its twin's while that is firing (else the railgun's, else the twin's);
   * back to their places when there is nothing. While the radiators are folded up the upper
   * carriage keeps to its side of them
   */
  runCarriages(dt) {
    const az = (a) => Math.atan2(a.x, -a.z);
    const [A, B, Rl] = this.h8Mounts;
    const h8 = this.g.h8;
    const C0 = this.carriages[0], C1 = this.carriages[1];
    let lim = null;
    if (h8 && h8.radFold > 0.02) {
      const front = Math.abs(dAng(0, C0.th)) < Math.PI / 2;
      lim = front ? [-70 * Math.PI / 180, 70 * Math.PI / 180] : [110 * Math.PI / 180, 250 * Math.PI / 180];
    }
    const wa = (m) => m && (m.want || m.aim);
    C0.step(dt, wa(A) ? az(wa(A)) : null, lim);
    // (the twin while it is firing, else the railgun, else the twin)
    let w = null;
    if (wa(B) && (B.cool > -0.5 || !wa(Rl))) w = az(wa(B)) - B.dth;
    else if (wa(Rl)) w = az(wa(Rl)) - Rl.dth;
    C1.step(dt, w);
    for (const m of this.h8Mounts) if (m.ring != null) this.placeMount(m);
    this.carriageSound();
  }

  /** the carriages' drives, heard aboard H8: a whine that climbs with the speed round the ring,
   * a quick spin-up as one sets off, the brake biting as it stops on its bearing */
  carriageSound() {
    const g = this.g, A = g.audio, h8 = g.h8;
    const aboard = h8 && (h8.crew || (h8.mode === 'docked' && h8.kaitoInside && h8.kaitoInside()));
    this.carriages.forEach((C, i) => {
      const id = 'ring' + i, k = Math.min(1, Math.abs(C.w) / CARRIAGE.vMax);
      const moving = aboard && A.ready && k > 0.04;
      if (moving) {
        const c = ringCircle(C.ring);
        const pos = new THREE.Vector3(Math.sin(C.th) * c.rad, c.y, -Math.cos(C.th) * c.rad).add(H8.dockAt);
        if (!C.sounding) { C.sounding = true; A.mech(pos, 'slew', { open: true }); A.humLoop(id, { pos, freq: 70, gain: 0, harm: [1, 0.6, 0.45, 0.2] }); }
        A.setLoopPos(id, pos);
        A.setLoopFreq(id, 70 + 120 * k);
        A.setLoopGain(id, 0.012 + 0.03 * k, 0.08);
      } else if (C.sounding) {
        C.sounding = false;
        A.stopLoop(id);
        if (aboard && A.ready) {
          const c = ringCircle(C.ring);
          A.mech(new THREE.Vector3(Math.sin(C.th) * c.rad, c.y, -Math.cos(C.th) * c.rad).add(H8.dockAt), 'latch', { open: false, gain: 0.5 });
        }
      }
    });
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
    this.b29Mount = { name: 'pd', kind: 'pd', group: tr, dir: n, frame: f, local: p.clone(), origin: p.clone().addScaledVector(n, -0.02), rest: f.z.clone().negate(), cool: 0, alt: 0, recoil: 0, kick: 0, aim: null, flash: 0, cur: f.z.clone().negate(),
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
    const dReach = which === 'h8' ? ZONE + 5000 : reach;
    if (g.drones) for (const d of g.drones.list) if (d.alive && d.pos.distanceTo(P.pos) < dReach) {
      add({ id: 'dr:' + d.id, kind: 'drone', ref: d, pos: d.pos, vel: d.vel, acc: d.thrust, R: 1.0, agility: (d.state === 'evade' || d.msl ? 45 : d.state === 'attack' ? 14 : 6) * (d.G ? d.G.a / 76 : 1), name: d.id + ' ' + starsText(d.stars), threat: true });
    }
    for (const a of g.asteroids.list) if (!a.dead && !a.hit && a.pos.distanceTo(P.pos) < (which === 'h8' ? 8000 : 4000)) add({ id: rockId(a), kind: 'rock', ref: a, pos: a.pos, vel: a.vel, acc: null, R: a.radius, agility: 0, name: '岩塊' });
    if (hud) {
      for (const l of hud.locks) {
        const c = l.c;
        if (!c || c.kind === 'drone' || c.kind === 'rock' || c.kind === 'body' || c.kind === 'k3' || !c.pos) continue;
        if (c.pos.distanceTo(P.pos) > reach) continue;
        const ref = c.ref || null;
        // (a station shows less than its whole bounding sphere: trusses, panels, gaps)
        // (an escape pod presents its flank or its end: about its radius and a half; dodging, it
        // jinks at most of its acceleration)
        const pod = c.kind === 'pod' && ref ? ref : null;
        const R = c.kind === 'station' ? hud.radiusOf(c) * 0.55 : c.kind === 'b29' ? 7 : pod ? pod.G.R * 1.5 : hud.radiusOf(c) * 0.7;
        const acc = c.kind === 'b29' ? g.flight.thrustAcc : pod ? pod.thrust : null;
        const agility = c.kind === 'b29' ? 3 : pod ? (pod.evadeT > 0 ? pod.G.accel * 0.8 : 2) : 0;
        add({ id: c.id, kind: c.kind, ref, pos: c.pos, vel: c.vel || P.vel, acc, R, agility, name: c.short || c.name, locked: true, threat: pod ? pod.hostile > 0 : undefined });
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
  /** H8's launchers can be fired from this seat: H8's own, or B-29's while H8 rides on its back */
  missilesAt(w) {
    const h8 = this.g.h8;
    if (!h8 || h8.awake < 0.5) return false;
    return w === 'h8' || (w === 'b29' && h8.mode === 'docked');
  }

  update(sdt, inp) {
    const g = this.g;
    const dt = Math.min(sdt, 0.1);
    const w = this.manned();
    // buttons
    if (inp && w) {
      if (inp.pressed['b-tgt']) this.cycleTarget();
      if (inp.pressed['b-auto']) this.toggleAuto(w);
      if (w === 'h8' && inp.pressed['b-rail']) this.fireRail(true);
      if (inp.pressed['b-msl'] && this.missilesAt(w)) this.fireMissile(w);
      const fb = g.input.btn && g.input.btn['b-fire'];
      this.fireHeld = !!(fb && fb.down) || !!(g.input.keys && g.input.keys.has('KeyF'));
      if (g.input.keys && g.input.keys.has('KeyR')) { g.input.keys.delete('KeyR'); if (w === 'h8') this.fireRail(true); }
      if (g.input.keys && g.input.keys.has('KeyM')) { g.input.keys.delete('KeyM'); if (this.missilesAt(w)) this.fireMissile(w); }
      if (g.input.keys && g.input.keys.has('KeyT')) { g.input.keys.delete('KeyT'); this.cycleTarget(); }
    } else this.fireHeld = false;
    // H8's guns
    const h8 = g.h8;
    this.intercept = null;
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
      // the carriages run round their rings toward what their guns are on
      this.runCarriages(dt);
      const manual = w === 'h8' && this.fireHeld;
      const tgt = w === 'h8' ? this.primary('h8') : null;
      // HACHI's automatic intercept: the nearest enemy inside 50 km, the turrets on it all the time
      const A = this.auto.hachi ? this.autoTarget('h8', ZONE) : null;
      this.intercept = A;
      const fireCannon = !!A && !manual && this.autoShoot(A, 'cannon');
      for (const m of this.h8Mounts) {
        if (m.kind !== 'twin') continue;
        m.cool -= dt;
        if (manual) this.aimAndFire(m, 'h8', tgt, dt, !!tgt, true);
        else this.aimAndFire(m, 'h8', A, dt, fireCannon, false, MAX_RANGE);
      }
      // the railgun's turret: on the intercept target, else on the focus while Kaito is in the
      // seat (so a shot can go at once); HACHI fires it when a slug has a fair chance
      const rail = this.h8Mounts.find((x) => x.kind === 'rail');
      if (rail) {
        const T = A || tgt;
        this.aimAndFire(rail, 'h8', T, dt, false, true);
        if (A && !manual && this.railCharge >= 1 && this.ammo.rail > 0 && h8.power.smes > H8.smesMJ * 0.15 && this.autoShoot(A, 'rail')) this.fireRail(false, A);
      }
      // missiles: HACHI's at the nearest threats beyond the guns' reach (none at a drone that
      // already has one coming); the launchers' doors, loaders and lamps
      if (this.auto.hachi) this.autoMissiles(dt);
      this.runLaunchers(dt);
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

  /** HACHI's call: fire this weapon at the intercept target now (the fire control's odds) */
  autoShoot(T, kind) {
    if (!T || T.dist > MAX_RANGE) return false;
    if (kind === 'cannon') {
      if (T.dist < 2500) return true;
      const p = this.hitChance(T, 'cannon');
      return p != null && p >= 0.06;
    }
    if (T.dist < 5000) return true;
    const p = this.hitChance(T, 'rail');
    return p != null && p >= 0.12;
  }

  /** a missile already on its way to this drone */
  missileOn(ref) {
    if (!ref) return false;
    for (const r of this.combat.rounds) if (r.kind === 'missile' && !r.done && r.target === ref) return true;
    return false;
  }

  /** for the AIs: the nearest drone within range, or a small rock on a collision course */
  autoTarget(which, range) {
    const T = this.targets(which);
    const M = this.g.h8 && this.g.h8.mind;
    if (which === 'h8') {
      // H8's intercept: the nearest enemy inside the zone
      let best = null;
      for (const x of T) if (x.kind === 'drone' && x.dist < range && (!best || x.dist < best.dist)) best = x;
      if (M) M.h8Target = best ? best.ref : null;
      return best;
    }
    // B-29's gun: HACHI weighs the threats (and shares them out with H8's turrets over the link)
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
      const pos = m.origin.clone().addScaledVector(m.dir, 0.4).applyQuaternion(P.quat).add(P.pos);
      return { pos, n: m.dir.clone().applyQuaternion(P.quat), P };
    }
    const pos = m.local.clone().addScaledVector(m.dir, 0.5).applyQuaternion(P.quat).add(P.pos);
    return { pos, n: m.dir.clone().applyQuaternion(P.quat), P };
  }

  /** the turret's yaw and pitch for a pointing (vessel-local), as its model turns */
  static yawPitch(m, a) {
    const f = m.frame, lim = m.pitch || PITCH_FIXED;
    const ax = a.dot(f.x), ay = a.dot(f.y), az = a.dot(f.z);
    return [Math.atan2(-ax, -az), Math.max(lim[0], Math.min(lim[1], Math.atan2(ay, Math.hypot(ax, az))))];
  }

  /**
   * A point on barrel i of a turret as it points now (vessel-local): along the barrel from the
   * cradle's pivot (along > 0 toward the muzzle), up / out from its axis
   */
  barrelPoint(m, i, along, out, up = 0, side = 0) {
    const [yaw, pitch] = Weapons.yawPitch(m, m.cur);
    const B = m.group.userData.barrels[i] || m.group.userData.barrels[0];
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
    // in the cradle: (x, up, -along) -> pitched about x, raised to the pivot, turned about y
    const x = B.x + side, y = up * cp + along * sp + 0.36, z = up * sp - along * cp;
    const X = x * cy + z * sy, Z = -x * sy + z * cy;
    const f = m.frame;
    return out.copy(m.origin).addScaledVector(f.x, X).addScaledVector(f.y, y).addScaledVector(f.z, Z);
  }

  /** the muzzle of barrel i, in ECI */
  muzzleWorld(m, which, i) {
    const P = this.pose(which);
    const B = m.group.userData.barrels[i] || m.group.userData.barrels[0];
    return this.barrelPoint(m, i, B.tip, new THREE.Vector3()).applyQuaternion(P.quat).add(P.pos);
  }

  /** the shot as the turret feels it: the barrel slams back, the cradle kicks, flame and smoke
   * leave the muzzle and the empty case spins out of the breech (in the vessel's own particles) */
  shotFx(m, which, i, kind) {
    const g = this.g;
    const ud = m.group.userData;
    const B = ud.barrels[i] || ud.barrels[0];
    B.rec = 1;
    B.flashT = kind === 'rail' ? 0.07 : 0.045;
    B.flash.children[0].rotation.z = Math.random() * Math.PI * 2;
    B.flash.scale.setScalar(0.8 + Math.random() * 0.5);
    m.kick = Math.min(3, m.kick + (kind === 'rail' ? 2.2 : 1));
    m.flash = 0.05;
    // the particles only where somebody could see them (the vessel close to the eye)
    const fx = which === 'h8' ? g.h8 && g.h8.fx : g.fx;
    const P = this.pose(which);
    if (!fx || !g.camWorld || _v.copy(g.origin).add(g.camWorld).distanceTo(P.pos) > 600) return;
    const tip = this.barrelPoint(m, i, B.tip + 0.05, new THREE.Vector3());
    const ax = this.barrelPoint(m, i, B.tip + 1, new THREE.Vector3()).sub(tip).normalize();
    if (kind === 'rail') {
      fx.burst('plasma', tip, ax, 6, { speed: 9, spread: 0.35, color: [0.45, 0.75, 1.0], size: 0.6 });
      fx.burst('gunsmoke', tip, ax, 4, { speed: 5, spread: 0.6 });
      return;
    }
    fx.burst('gunsmoke', tip, ax, 2, { speed: 7, spread: 0.3 });
    // the case: out of the ejection port on the turret's outboard side, spinning away
    const port = this.barrelPoint(m, i, 0.05, new THREE.Vector3(), 0.02, (B.x >= 0 ? 1 : -1) * 0.06);
    const out = this.barrelPoint(m, i, 0.05, new THREE.Vector3(), 0.3, (B.x >= 0 ? 1 : -1) * 0.8).sub(port).normalize();
    fx.burst('casing', port, out, 1, { speed: 3.2, spread: 0.25 });
  }

  /**
   * The fire control on a target: track it, solve the shot, turn the turret onto it at its slew
   * rate; fire when the barrels are on the solution, the target is within reach and nothing
   * friendly is in the line of fire. manual: Kaito's own fire (out to 30 km); reach: how far the
   * automatic fire goes (default: close defence)
   */
  aimAndFire(m, which, T, dt, wantFire, manual = false, reach = null) {
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
    if (!T) { m.aim = null; m.sol = null; m.want = null; slew(m.rest); return; }
    const F = m.fc;
    F.observe(T.id, T.pos, T.vel, T.acc, dt);
    const sol = F.solve(T.id, W.pos, W.P.vel, T.aim || null);
    if (!sol) { m.aim = null; m.sol = null; m.want = null; slew(m.rest); return; }
    const dir = sol.aimDir;
    // where the guns want to point (vessel-local): a ring carriage runs that way
    m.want = dir.clone().applyQuaternion(qi);
    // below the mount's horizon the hull blocks it: the turret swings as far round as it can while
    // its carriage brings it to the other side
    if (dir.dot(W.n) < (m.depress ?? -0.12)) { m.aim = null; m.sol = null; slew(m.ring != null ? m.want : m.rest); return; }
    m.sol = sol;
    m.aim = m.want.clone();       // vessel-local, where the turret turns to
    slew(m.aim);
    if (m.kind === 'rail') return;
    const dist = (T.aim || T.pos).distanceTo(W.pos);
    const lim = manual && which === 'h8' ? Math.min(MAX_RANGE, F.am.maxRange) : reach ? Math.min(reach, F.am.maxRange) : (kind === 'pd' ? 2600 : 3200);
    if (!wantFire || m.cool > 0 || dist > lim || !sol.ok) return;
    // the barrels on the solution (within a milliradian)?
    if (m.cur.angleTo(m.aim) > 1.2e-3) return;
    // never through anything friendly
    const block = this.blocked(which, W.pos, dir, dist, T, F.am.v0 * F.am.life);
    if (block) { if (manual && which === 'h8' && g.h8 && block !== 'self') g.h8.say('hachi_friendly', {}, { minGap: 8, force: false }); return; }
    if (kind === 'cannon' && this.ammo.cannon <= 0) { this.dry(which); return; }
    if (kind === 'pd' && this.ammo.pd <= 0) { this.dry(which); return; }
    // H8's fire control circuit cut: the servo cannot hold the guns steady (and once it is gone,
    // they do not fire at all)
    const fcc = which === 'h8' && g.h8 ? g.h8.circuits.fire : 1;
    if (fcc < 0.12) { m.aim = null; return; }
    m.cool = 1 / F.gun.rof;
    // the barrels take turns
    const bi = m.alt;
    m.alt = m.group.userData.barrels.length > 1 ? 1 - m.alt : 0;
    this.ammo[kind]--;
    if (which === 'h8') this.arsenal.spent(kind);
    m.recoil = 1;
    // the round leaves its own barrel's muzzle
    const muzzle = this.muzzleWorld(m, which, bi);
    const round = F.fire(muzzle, W.P.vel, dir, 1 + 5 * (1 - fcc));
    this.combat.fire({ kind, round, pos: muzzle, vel: W.P.vel, dir, owner: which === 'h8' ? g.h8 : g.flight, byPlayer: true });
    this.shotFx(m, which, bi, kind);
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
    // H8's own radiator wings (spread at the equator, or folded up against the flanks)
    if (which === 'h8' && g.h8) {
      const h = g.h8, P = this.pose('h8');
      const qi = _q2.copy(P.quat).invert();
      const o = _v.copy(p).sub(P.pos).applyQuaternion(qi);
      const d = dir.clone().applyQuaternion(qi);
      const fold = h.radFold || 0;
      for (const sd of [-1, 1]) {
        // into the wing's own frame: about its hinge, turned back by its fold
        const a = sd * fold * 1.62, c = Math.cos(a), s2 = Math.sin(a);
        const ox = o.x - sd * (H8.R + 0.12), oy = o.y;
        const lx = c * ox + s2 * oy, ly = -s2 * ox + c * oy;
        const dx = c * d.x + s2 * d.y, dy = -s2 * d.x + c * d.y;
        if (Math.abs(dy) < 1e-6) continue;
        const tt = -ly / dy;
        if (tt <= 0 || tt > 12) continue;
        const u = (lx + dx * tt) * sd, w = o.z + d.z * tt;
        if (u > 0.3 && u < 3.5 && Math.abs(w) < 0.8) return 'self';
      }
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

  /** the railgun: at the focus (Kaito), or at T (HACHI's intercept) */
  fireRail(manual, T = null) {
    const g = this.g, h8 = g.h8;
    if (!h8 || h8.awake < 0.5) return;
    const m = this.h8Mounts.find((x) => x.kind === 'rail');
    const say = (k, p) => { if (manual) h8.say(k, p || {}, { minGap: 4, force: false }); };
    if (this.ammo.rail <= 0) { if (manual) this.dry('h8'); return; }
    if (this.railCharge < 1) { if (manual) h8.say('hachi_rail_charging', { pct: Math.round(this.railCharge * 100) }, { minGap: 3, force: false }); return; }
    if (!T) T = this.primary('h8');
    if (!T) { say('hachi_no_target'); return; }
    const W = this.mountWorld(m, 'h8');
    const dist = (T.aim || T.pos).distanceTo(W.pos);
    if (dist > MAX_RANGE) { say('hachi_out_of_range', { d: (dist / 1000).toFixed(1) + ' km' }); return; }
    m.fc.observe(T.id, T.pos, T.vel, T.acc, 0);
    const sol = m.fc.solve(T.id, W.pos, W.P.vel, T.aim || null);
    const dir = sol && sol.aimDir;
    if (!dir || dir.dot(W.n) < m.depress || this.blocked('h8', W.pos, dir, dist, T, m.fc.am.v0 * m.fc.am.life)) { say('hachi_rail_blocked'); return; }
    m.aim = dir.clone().applyQuaternion(_q.copy(W.P.quat).invert());
    m.cur.copy(m.aim);
    this.railCharge = 0;
    this.ammo.rail--;
    this.arsenal.spent('rail');
    m.recoil = 1;
    h8.power.smes = Math.max(0, h8.power.smes - 900);
    const muzzle = this.muzzleWorld(m, 'h8', 0);
    const fcc = h8.circuits ? h8.circuits.fire : 1;
    this.combat.fire({ kind: 'rail', round: m.fc.fire(muzzle, W.P.vel, dir, 1 + 5 * (1 - fcc)), pos: muzzle, vel: W.P.vel, dir, owner: h8, byPlayer: true });
    this.shotFx(m, 'h8', 0, 'rail');
    this.gunSound('h8', 'rail');
    // the kick goes through H8 (and B-29 when they are joined)
    g.shake = Math.max(g.shake, h8.crew ? 1.6 : 0.6);
    if (h8.seatKick) h8.seatKick(1.4);
  }

  /** what H8's display has in focus, at any distance: a target for a missile, or null */
  focusTarget() {
    const h8 = this.g.h8, hud = h8 && h8.hud;
    const F = hud && hud.primary ? hud.primary() : null;
    if (!F || !F.c || !F.c.pos) return null;
    const c = F.c, P = this.pose('h8');
    const R = c.kind === 'drone' ? 1 : hud.radiusOf ? hud.radiusOf(c) * 0.6 : 5;
    return { id: c.id, kind: c.kind, ref: c.ref || null, pos: c.pos, vel: c.vel || P.vel, R, name: c.short || c.name, dist: c.pos.distanceTo(P.pos) };
  }

  /** launchers ready to fire */
  readyLaunchers() { return (this.launchers || []).filter((L) => L.loaded && !L.queue); }

  /**
   * The missile button: the nearest enemies inside 50 km first (one per ready launcher: two at
   * once at most), else what is in focus — out of the missiles' 120 km, Kaito is asked what to do
   */
  fireMissile(w) {
    const g = this.g, h8 = g.h8;
    if (!h8 || h8.awake < 0.5) return;
    if (this.ammo.missile <= 0) { this.dry('h8'); return; }
    const ready = this.readyLaunchers();
    if (!ready.length) { h8.say('hachi_msl_reload', {}, { minGap: 1, force: true }); return; }
    const E = this.targets('h8').filter((x) => x.kind === 'drone' && x.dist < ZONE).sort((a, b) => a.dist - b.dist);
    let T = E.slice(0, ready.length);
    if (!T.length) {
      const F = this.focusTarget();
      if (!F) { h8.say('hachi_no_target', {}, { minGap: 4, force: false }); return; }
      if (F.dist > MSL_RANGE) { this.askRange(F); return; }
      T = [F];
    }
    T.forEach((x, i) => this.launchAt(ready[i], x, true));
    h8.say('hachi_msl', { name: T.map((x) => x.name).join('・') }, { minGap: 1, force: true });
    void w;
  }

  /** a launcher told to fire at T: its doors open, then the missile goes */
  launchAt(L, T, manual) {
    if (!L || !T) return;
    L.queue = { T, manual };
    L.doorT = 1;
  }

  /**
   * The focus is beyond the missiles' reach: Kaito chooses — fire when it comes within range,
   * fire now anyway (it will run out before it gets there unless the target closes), or not at all
   */
  askRange(F) {
    let el = document.getElementById('msl-ask');
    if (!el) {
      el = document.createElement('div');
      el.id = 'msl-ask';
      el.innerHTML = '<div class="ma-t"></div><div class="ma-b"><button data-k="wait">射程に入ったら発射</button><button data-k="now">このまま発射</button><button data-k="no">やめる</button></div>';
      (document.getElementById('hud') || document.body).appendChild(el);
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.querySelectorAll('button').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const A = this._ask;
        el.style.display = 'none';
        this._ask = null;
        if (!A) return;
        const h8 = this.g.h8;
        if (b.dataset.k === 'wait') { this.mslWait = { id: A.id, name: A.name }; h8 && h8.say('hachi_msl_wait', { name: A.name }, { force: true }); }
        else if (b.dataset.k === 'now') {
          const F = this.focusTarget();
          const L = this.readyLaunchers()[0];
          if (F && F.id === A.id && L) { this.launchAt(L, F, true); h8 && h8.say('hachi_msl', { name: F.name }, { force: true }); }
        }
      }));
    }
    this._ask = { id: F.id, name: F.name };
    el.querySelector('.ma-t').textContent = `${F.name} は射程外（${(F.dist / 1000).toFixed(0)} km ／ ミサイル射程 120 km）`;
    el.style.display = 'block';
  }

  /** HACHI's own missiles in an intercept: the nearest threats inside 50 km that have none
   * coming yet, from whichever launcher is ready, a few seconds apart */
  autoMissiles(dt) {
    this.autoMslT = Math.max(0, (this.autoMslT || 0) - dt);
    if (this.autoMslT > 0 || this.ammo.missile <= 0) return;
    const ready = this.readyLaunchers();
    if (!ready.length) return;
    const E = this.targets('h8').filter((x) => x.kind === 'drone' && x.dist > 4000 && x.dist < ZONE && !this.missileOn(x.ref) && !this.launchers.some((L) => L.queue && L.queue.T.ref === x.ref)).sort((a, b) => a.dist - b.dist);
    if (!E.length) return;
    this.launchAt(ready[0], E[0], false);
    this.autoMslT = 4;
  }

  /** the launchers through a step: doors, the launch itself, the loader, the lamps */
  runLaunchers(dt) {
    const g = this.g, h8 = g.h8;
    if (!this.launchers) return;
    // waiting for the focus to come within range
    if (this.mslWait) {
      const F = this.focusTarget();
      if (!F || F.id !== this.mslWait.id) this.mslWait = null;
      else if (F.dist <= MSL_RANGE && this.readyLaunchers().length && this.ammo.missile > 0) {
        this.launchAt(this.readyLaunchers()[0], F, true);
        if (h8) h8.say('hachi_msl', { name: F.name }, { force: true });
        this.mslWait = null;
      }
    }
    let loaded = this.launchers.filter((L) => L.loaded).length;
    const A = g.audio, heard = h8 && A && A.ready && (h8.crew || (h8.mode === 'docked' && h8.kaitoInside && h8.kaitoInside()));
    for (const L of this.launchers) {
      // the doors: they snap open, and close behind the missile
      if (heard && L.doorT !== L.doorWas && L.doorWas !== undefined) A.mech(L.at.clone().add(H8.dockAt), 'servo', { open: L.doorT > 0.5, dur: L.doorT > 0.5 ? 0.13 : 0.22, pitch: 0.8 });
      L.doorWas = L.doorT;
      L.door += Math.max(-dt * 5, Math.min(dt * 9, L.doorT - L.door));
      if (L.queue && L.door > 0.92) {
        const Q = L.queue;
        L.queue = null;
        if (this.ammo.missile > 0 && L.loaded && !(Q.T.ref && Q.T.ref.alive === false)) {
          this.launchFrom(L, Q.T, Q.manual);
          loaded--;
        }
        L.closeT = 0.35;
      }
      if (L.closeT > 0) { L.closeT -= dt; if (L.closeT <= 0) L.doorT = 0; }
      // the loader: the next missile up from the magazine, a second after the last one left
      if (!L.loaded) {
        L.reload = Math.max(0, L.reload - dt);
        const can = this.ammo.missile > loaded;
        // (the loader's ram drives the round up into the tube and locks it)
        if (can && heard && L.reload < 0.45 && !L.ramming) { L.ramming = true; A.mech(L.at.clone().add(H8.dockAt), 'heavy', { open: true, dur: 0.42, pitch: 1.5, gain: 0.7 }); }
        if (can) L.load = Math.min(1, Math.max(L.load, 1 - L.reload / 0.45));
        if (L.reload <= 0 && can) { L.loaded = true; L.load = 1; L.ramming = false; loaded++; }
      }
      L.kick = Math.max(0, L.kick - dt * 4);
    }
  }

  /** the missile leaves its tube: blown out by gas, its motor lights clear of H8 */
  launchFrom(L, T, manual) {
    const g = this.g, h8 = g.h8;
    this.ammo.missile--;
    this.arsenal.spent('missile');
    L.loaded = false; L.load = 0; L.reload = MSL_RELOAD; L.kick = 1;
    const P = this.pose('h8');
    const f = L.frame;
    const out = f.y.clone().applyQuaternion(P.quat);
    const mouth = L.at.clone().addScaledVector(f.y, 0.62);
    const pos = mouth.clone().applyQuaternion(P.quat).add(P.pos);
    const tgt = T.ref && T.ref.pos ? T.ref : { pos: T.pos.clone(), vel: (T.vel || P.vel).clone(), R: T.R, kind: T.kind };
    if (!tgt.kind) tgt.kind = T.kind;
    this.combat.fire({ kind: 'missile', pos, vel: P.vel.clone().addScaledVector(out, 30), dir: out, owner: h8, target: tgt, byPlayer: true, coast: 0.3 });
    // the gas that throws it out, the launcher kicking down on its mounts, the hull shuddering
    if (h8.fx) {
      h8.fx.burst('gunsmoke', L.at.clone().addScaledVector(f.y, 0.4), f.y.clone(), 10, { speed: 9, spread: 0.55, size: 2.2 });
      h8.fx.burst('spark', L.at.clone().addScaledVector(f.y, 0.36), f.y.clone(), 8, { speed: 6, spread: 0.9 });
    }
    this.combat.flash(pos, [0.85, 0.9, 1.0], 1.6, 0.1, P.vel);
    if (h8.seatKick) h8.seatKick(0.55);
    if (h8.crew || h8.mode === 'docked') g.shake = Math.max(g.shake, 0.35);
    this.gunSound('h8', 'missile');
    void manual;
  }

  /** the fabricator finished something */
  onMade(made) {
    if (made.missile) {
      const h8 = this.g.h8;
      if (h8) h8.say('hachi_made_msl', { n: this.ammo.missile }, { minGap: 30, force: false });
    }
  }

  /** the launchers as the magazine allows (after a load, a refill) */
  syncLids() {
    let n = this.ammo.missile;
    for (const L of this.launchers || []) { L.loaded = n > 0; L.load = L.loaded ? 1 : 0; L.reload = 0; L.queue = null; if (n > 0) n--; }
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
    this.arsenal.refill();
    this.syncLids();
  }

  /** anything to refill (B-29 alone, or the pair) */
  needsRearm(withH8) {
    const A = this.ammo;
    return A.pd < AMMO_MAX.pd || (withH8 && (A.cannon < AMMO_MAX.cannon || A.rail < AMMO_MAX.rail || A.missile < AMMO_MAX.missile || this.arsenal.feedKg < 3000));
  }

  // ------------------------------------------------------------------ per render frame
  updateVisual(dt, origin, camWorld) {
    const g = this.g;
    // the carriages where they have run to on their rings
    if (this.gunGroup) { this.placeGuns(); this.gunGroup.updateMatrixWorld(true); }
    // turrets follow their aim (or settle back to stowed), barrels recoil
    const settle = (m) => {
      const ud = m.group.userData;
      const [yawT, pitchT] = Weapons.yawPitch(m, m.cur);
      // (the turret's pointing is simulated at its slew rate: the model shows exactly that; the
      // shots shake it a little on top — the cradle kicks up, the head shivers)
      const kk = m.kick;
      m.kick = Math.max(0, m.kick - dt * (m.kind === 'rail' ? 5 : 14));
      const jit = kk > 0.02 ? (Math.random() - 0.5) * 0.004 * kk : 0;
      ud.yaw.rotation.y = yawT + jit;
      ud.pitch.rotation.x = pitchT + (m.kind === 'rail' ? 0.012 : 0.006) * kk;
      // each barrel: back in a blink, then run out again by its recuperator
      for (const B of ud.barrels) {
        B.rec = Math.max(0, B.rec - dt * (m.kind === 'rail' ? 2.2 : 8.5));
        const r = B.rec, u = r > 0.85 ? (1 - r) / 0.15 : r / 0.85, ease = u * u * (3 - 2 * u);
        B.slide.position.z = (m.kind === 'rail' ? 0.24 : m.kind === 'pd' ? 0.1 : 0.11) * ease;
        B.flashT = Math.max(0, B.flashT - dt);
        B.flash.visible = B.flashT > 0;
        if (B.flash.visible) { const o = Math.min(1, B.flashT * 30); B.flash.userData.mat.opacity = o; B.flash.userData.glow.opacity = o; }
        B.slide.updateMatrix();
      }
      // a long burst heats the barrels: they glow dull red, then orange, and cool again
      if (m.heat) {
        const hk = Math.max(0, Math.min(1, (m.fc.heat - 12) / 60));
        m.heat.emissiveIntensity = hk * hk * 3.2;
      }
      m.recoil = Math.max(0, m.recoil - dt * 9);
      m.flash = Math.max(0, m.flash - dt);
      ud.yaw.updateMatrix(); ud.pitch.updateMatrix(); ud.cradle.updateMatrix();
      m.group.updateMatrixWorld(true);
    };
    for (const m of this.h8Mounts) settle(m);
    // the launchers: doors swinging, the loader bringing the next nose up, a kick at each launch,
    // the lamps (green ready, amber loading, red empty, a white flash as one goes)
    const tt = performance.now() / 1000;
    for (const L of this.launchers || []) {
      const ud = L.group.userData;
      const e = L.door * L.door * (3 - 2 * L.door);
      for (const D of ud.doors) { D.hinge.rotation.z = -D.s * e * 1.95; D.hinge.updateMatrix(); }
      ud.nose.visible = L.load > 0.02;
      ud.nose.position.y = -0.16 * (1 - L.load);
      ud.nose.updateMatrix();
      const k = L.kick * L.kick;
      L.group.matrix.makeBasis(L.frame.x, L.frame.y, L.frame.z).setPosition(_v.copy(L.at).addScaledVector(L.frame.y, -0.05 * k));
      const lm = ud.lamp;
      if (L.kick > 0.6) { lm.emissive.setRGB(1, 1, 1); lm.emissiveIntensity = 8; }
      else if (L.loaded) { lm.emissive.setRGB(0.2, 1.0, 0.35); lm.emissiveIntensity = 3; }
      else if (this.ammo.missile > 0) { lm.emissive.setRGB(1.0, 0.62, 0.1); lm.emissiveIntensity = (tt * 6) % 1 < 0.5 ? 4 : 0.4; }
      else { lm.emissive.setRGB(1.0, 0.12, 0.08); lm.emissiveIntensity = 2.5; }
    }
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
    const view = new THREE.Matrix4().compose(g.camWorld, g.viewQuat || g.camQuat, new THREE.Vector3(1, 1, 1)).invert();
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
      ctx.fillText(`${d.id} ${starsText(d.stars)}  ${dist < 9500 ? Math.round(dist) + ' m' : (dist / 1000).toFixed(1) + ' km'}`, s[0], s[1] + r + 13);
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
      const mk = this.arsenal.mw > 0.5 ? `  生産 ${Math.round(this.arsenal.mw)} MW${this.arsenal.priority ? '（優先）' : ''}` : '';
      const line = w === 'h8' ? `砲 ${this.ammo.cannon}  レール ${this.ammo.rail}${this.railCharge < 1 ? ` (${Math.round(this.railCharge * 100)}%)` : ''}  ミサイル ${this.ammo.missile}${mk}  ${this.auto.hachi ? '自動迎撃' : '手動'}` : `防衛機銃 ${this.ammo.pd}  ${this.auto.asphalt ? '自動' : '手動'}${this.missilesAt('b29') ? `  H8ミサイル ${this.ammo.missile}` : ''}`;
      ctx.fillText(line, W - 16, H - 14);
    }
  }

  // ------------------------------------------------------------------ save
  serialize() { return { ammo: { ...this.ammo }, auto: { ...this.auto }, fab: this.arsenal.serialize() }; }
  restore(s) {
    if (!s) return;
    if (s.ammo) Object.assign(this.ammo, s.ammo);
    if (s.auto) Object.assign(this.auto, s.auto);
    this.arsenal.restore(s.fab);
    this.syncLids();
  }
}

function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
