// H8's emergency shelter. Right behind the cockpit, behind the aft panel of the all-round display,
// a sealed box just big enough for the pilot's seat and nothing else — the knees nearly against
// the door, the headrest a hand's breadth from the back wall. Kaito does not walk into it: the seat
// takes him. Under the left hand, at the back of the armrest, a red button under a clear guard
// (the first press lifts the guard, the second sends him):
//   - the seat swings round to face the bow and its carriage lifts it off the floor;
//   - the two leaves of floor display under it slide apart, the aft panel slides aside down to the
//     floor, and a telescoping rail rises out of the slot and runs out over the floor to the
//     shelter's sill;
//   - the carriage fires him back along it, seat and all, hard, into the box, where it stops on
//     the shelter's own rail and latches;
//   - the panel closes in front of him (sealed: its own oxygen bottles and scrubber, ten hours for
//     one person, a battery for a dim lamp, a console that runs everything H8 — and, over the link
//     or the cable, B-29 — can do, one small screen for the view out), the rail runs back into
//     the floor and the leaves close over it: the cockpit is left empty.
// The same button takes him back. In the box with him, behind a shutter in the starboard wall,
// H8's suit. It has no drive and makes no power of its own. Built into H8's strongest frame, it is
// the one part that comes through if H8 is destroyed: it drifts on alone, keeping Kaito alive until
// B-29 comes for it or the oxygen runs out. H8-local coordinates.
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';
import { H8 } from './h8Spec.js';
import { SEAT } from './h8Seat.js';
import { FLOOR } from './h8Display.js';
import { LAYER_NEAR } from '../core/layers.js';
import { LAYER_PROXY } from '../player/interact.js';
import { buildSuit } from '../suit/suitModel.js';
import { SUITS } from '../suit/suitSystem.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Cc = H8.cockpitC, R = H8.cockpitR;
const DOCK = H8.dockAt;
const FY = H8.floorY;

/**
 * The box: x within +-X, y0..y1 (its floor level with the cockpit's), from the sphere's surface back
 * to z1. zIn: where the seat's gimbal centre stands in it; ride: how far the carriage takes it;
 * lift: how far the carriage lifts it to ride (the rails' tops); eye: Kaito's eye there.
 */
export const SHELTER = (() => {
  const zIn = 1.48;
  return {
    X: 0.46, y0: FY, y1: 1.12, z1: 1.97, zIn, ride: zIn - SEAT.G.z, lift: 0.06,
    eye: SEAT.G.clone().add(SEAT.eye).add(V(0, 0, zIn - SEAT.G.z)),
    center: V(0, 0.3, 1.5),
    // the rail: the shelter's own from its sill back; the telescoping one in the cockpit from the
    // slot under the seat to just short of the door's line (the door shuts between the two)
    sill: 0.72, tip: 0.655,
    // the suit's niche in the starboard wall
    niche: { z0: 0.97, z1: 1.66, y0: FY - 0.13, y1: 1.1, d: 0.58 },
  };
})();
const BREATH = 7.4e-4;                // kPa*m^3/s of O2 one person uses (the ship's own air model)
const FULL = 10 * 3600 * BREATH;      // ten hours' worth in the bottles
const AREA = 0.9;                     // the opening (m^2)
const GUARD_OPEN = 6;                 // s the guard stays up waiting for the second press

/** the front of the box: where the sphere's surface is at (x, y), behind the cockpit */
const zFront = (y, x = 0) => Cc.z + Math.sqrt(Math.max(0, R * R - (y - Cc.y) ** 2 - x * x));
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
/** 0 before a, 1 after b, eased between */
const span = (t, a, b) => ease((t - a) / (b - a));

/**
 * A run along the rail as a fraction of the way (tau 0..1 of the run's time): up to speed over the
 * first a of it, steady, braking over the last b. Also the acceleration (per unit distance and
 * T^2: times D / T^2 for m/s^2).
 */
function run(tau, a, b) {
  tau = clamp01(tau);
  const tot = 1 - a / 2 - b / 2;
  let s, acc;
  if (tau < a) { s = tau * tau / (2 * a); acc = 1 / a; }
  else if (tau < 1 - b) { s = a / 2 + (tau - a); acc = 0; }
  else { const r = 1 - tau; s = a / 2 + (1 - a - b) + b / 2 - r * r / (2 * b); acc = -1 / b; }
  return { s: s / tot, acc: acc / tot };
}

/** the sequences (seconds from the press): when each part moves */
const OUT = {
  lift: [0.1, 0.4], leaves: [0.15, 0.55], door: [0.25, 0.75], rise: [0.45, 0.7], ext: [0.65, 1.05],
  ride: [1.1, 1.75], shut: [1.78, 2.28], retract: [1.85, 2.25], sink: [2.25, 2.45], close: [2.45, 2.85], end: 2.9,
};
const BACK = {
  leaves: [0, 0.4], rise: [0.25, 0.45], ext: [0.4, 0.8], door: [0.3, 0.8],
  ride: [0.95, 1.95], retract: [2.0, 2.4], shut: [2.0, 2.5], sink: [2.4, 2.55], close: [2.55, 2.95], drop: [2.95, 3.15], end: 3.2,
};

export function shelterMaterials(M) {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  M.shelterPad = S({ color: 0x3d434b, roughness: 0.9, metalness: 0.02 });
  M.shelterO2 = S({ color: 0x2f7d4a, roughness: 0.45, metalness: 0.35 });
  M.shelterLamp = S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.58, 0.22), emissiveIntensity: 0 });
  M.shelterRed = S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.08, 0.04), emissiveIntensity: 0 });
  M.shelterGauge = S({ color: 0x000000, emissive: new THREE.Color(0.35, 1.0, 0.55), emissiveIntensity: 0 });
  M.shelterStrobe = S({ color: 0x000000, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 });
  M.podShell = S({ color: 0x8d949b, roughness: 0.55, metalness: 0.6 });
  M.podTorn = S({ color: 0x2c2724, roughness: 0.9, metalness: 0.3, side: THREE.DoubleSide });
  // the rails and the slot under the seat
  M.railSteel = S({ color: 0x8e959d, roughness: 0.28, metalness: 0.92 });
  M.railDark = S({ color: 0x1d2024, roughness: 0.55, metalness: 0.6 });
  M.railLamp = S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.5, 0.12), emissiveIntensity: 0 });
  M.nicheLamp = S({ color: 0x000000, emissive: new THREE.Color(0.75, 0.88, 1.0), emissiveIntensity: 0 });
  M.shutter = S({ color: 0x4a5059, roughness: 0.7, metalness: 0.25 });
  return M;
}

/** a wall of the box as a strip between the sphere's surface and z (one-sided: it faces into the
 * shelter only, so from the cockpit nothing of the box shows past the opening). Between y0 and y1 */
function sideWall(x, inward, z1 = SHELTER.z1, y0 = SHELTER.y0, y1 = SHELTER.y1, zMin = -Infinity) {
  const pos = [], idx = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const y = y0 + (y1 - y0) * i / N;
    pos.push(x, y, Math.max(zMin, zFront(y, Math.abs(x)) - 0.01), x, y, z1);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    if (inward > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** the floor or the ceiling (y), the same way */
function capWall(y, up) {
  const pos = [], idx = [];
  const N = 12, { X, z1 } = SHELTER;
  for (let i = 0; i <= N; i++) {
    const x = -X + 2 * X * i / N;
    pos.push(x, y, zFront(y, Math.abs(x)) - 0.01, x, y, z1);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    if (up > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** a flat quad facing n (for the niche, the walls round its opening) */
function quad(a, b, c, d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

/** the front of the box round the door: the sphere's back between the door's edges and the walls
 * (from inside, the display's own back would show there; adrift, open space) */
function frontFrame() {
  const S = H8.shelter, Rf = R + 0.035, { X, y0, y1 } = SHELTER;
  const grid = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
  const AZ = [...grid(-0.6, -S.hw, 6), ...grid(-S.hw, S.hw, 12).slice(1), ...grid(S.hw, 0.6, 6).slice(1)];
  const elB = Math.asin((y0 - Cc.y) / R) - 0.02, elT = Math.asin(Math.min(1, (y1 + 0.03 - Cc.y) / R));
  const EL = [...grid(elB, S.el0, 1), ...grid(S.el0, S.el1, 14).slice(1), ...grid(S.el1, elT, 3).slice(1)];
  const pos = [], idx = [];
  const NA = AZ.length;
  const P = (az, el) => [Cc.x + Math.sin(S.az + az) * Math.cos(el) * Rf, Cc.y + Math.sin(el) * Rf, Cc.z - Math.cos(S.az + az) * Math.cos(el) * Rf];
  for (const el of EL) for (const a of AZ) pos.push(...P(a, el));
  for (let j = 0; j < EL.length - 1; j++) for (let i = 0; i < NA - 1; i++) {
    const am = (AZ[i] + AZ[i + 1]) / 2, em = (EL[j] + EL[j + 1]) / 2;
    if (Math.abs(am) < S.hw && em > S.el0 && em < S.el1) continue;
    const c = P(am, em);
    if (Math.abs(c[0]) > X + 0.05 || c[1] < y0 - 0.03 || c[1] > y1 + 0.05) continue;
    const a = j * NA + i, b = a + 1, cc = a + NA, d = cc + 1;
    idx.push(a, cc, b, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class H8Shelter {
  constructor(vessel, M) {
    this.v = vessel;
    this.M = M;
    // the sequence: home (the seat in the cockpit) | out (on its way in) | in | back
    this.state = 'home';
    this.t = 0;                 // s into the sequence
    this.guard = 0;             // the guard over the red button: 0 down .. 1 up
    this.guardT = -1;           // s left before it drops again (-1: down)
    this.door = 0;              // the aft panel: 0 shut .. 1 slid aside
    this.leaves = 0;            // the floor's leaves over the slot: 0 shut .. 1 apart
    this.rise = 0;              // the telescoping rail: 0 down in the slot .. 1 up at the floor
    this.ext = 0;               // .. and run out: 0 nested .. 1 out to the sill
    this.ride = 0;              // the seat along the rails: 0 home .. 1 in the shelter
    this.lift = 0;              // the carriage holding the seat up on the rails: 0 .. 1
    this.acc = 0;               // the carriage's acceleration now (m/s^2, + aft)
    this.bounce = 0;            // the stop's rebound (s since it)
    this.o2 = FULL;             // kPa*m^3 of O2 in its bottles
    this.lioh = 1;              // the scrubber's canister left
    this.battery = 1;           // lamp, console, camera (no power plant of its own)
    this.occupied = false;
    this.saidO2 = 99;
    this.locker = { open: 0, target: 0 };    // the shutter over the suit's niche
    this.group = new THREE.Group();
    this.group.name = 'h8Shelter';
    this.rail = new THREE.Group();           // the slot and the telescoping rail (in the cockpit)
    this.rail.name = 'h8SeatRail';
    this.build();
    this.buildRail();
    this.buildPod();
    // the seat's record in the shelter: H8's own seat, held facing forward (the sticks fly H8, the
    // console runs it all). Its eye is the seat's (h8.js keeps it in step with the seat's motion)
    this.seat = {
      id: 'h8shelter', kind: 'pilot', shelter: true, h8: true, gimbal: true, lockAim: true, yawSeat: 0, pitchSeat: 0,
      eye: SHELTER.eye.clone().add(DOCK), eyeLocal: SHELTER.eye.clone(), dock: DOCK.clone(), fwd: V(0, -0.08, -1).normalize(),
      exit: V(0, FY + 0.02, 0.42).add(DOCK), dynQ: new THREE.Quaternion(),
    };
  }

  // ------------------------------------------------------------------ the box
  build() {
    const M = this.M, { X, y0, y1, z1, niche: N } = SHELTER;
    const add = (geo, key) => { const m = new THREE.Mesh(geo, M[key]); this.group.add(m); return m; };
    // port wall whole; the starboard one round the niche's opening
    add(sideWall(-X, 1), 'shelterPad');
    add(sideWall(X, -1, N.z0, y0, y1), 'shelterPad');
    add(sideWall(X, -1, z1, y0, y1, N.z1), 'shelterPad');
    add(quad([X, N.y1, N.z0], [X, N.y1, N.z1], [X, y1, N.z1], [X, y1, N.z0]), 'shelterPad');
    add(capWall(y0, 1), 'panelInDark');
    add(capWall(y1, -1), 'shelterPad');
    add(frontFrame(), 'shelterPad');
    const back = new THREE.PlaneGeometry(2 * X, y1 - y0);
    back.rotateY(Math.PI);
    back.translate(0, (y0 + y1) / 2, z1);
    add(back, 'padDark');
    const b = new Builder();
    // the shelter's rail: an I-beam down the middle of its floor from the sill back, amber guide
    // lights along it, rubber stops at the back, the latches that take the seat's carriage
    const L = z1 - 0.04 - SHELTER.sill, zc = (z1 - 0.04 + SHELTER.sill) / 2, top = FY + SHELTER.lift;
    b.box(0.12, 0.012, L, 'railSteel', [0, top - 0.006, zc], null, 0.003);
    b.box(0.03, SHELTER.lift - 0.012, L, 'railDark', [0, FY + (SHELTER.lift - 0.012) / 2, zc], null, 0.004);
    b.box(0.16, 0.008, L, 'railDark', [0, FY + 0.004, zc], null, 0.002);
    for (const s of [-1, 1]) b.box(0.006, 0.005, L - 0.06, 'railLamp', [s * 0.066, top - 0.009, zc], null, 0.001);
    for (const s of [-1, 1]) b.box(0.05, 0.07, 0.05, 'rubber', [s * 0.13, FY + 0.035, z1 - 0.06], null, 0.012);
    for (const s of [-1, 1]) {
      b.box(0.035, 0.05, 0.12, 'railDark', [s * 0.09, FY + 0.03, SHELTER.zIn], null, 0.006);
      b.box(0.008, 0.008, 0.06, 'railLamp', [s * 0.108, FY + 0.05, SHELTER.zIn], null, 0.002);
    }
    // two oxygen bottles behind the seat in the back corners, the scrubber canister low behind it,
    // a gauge
    for (const s of [-1, 1]) {
      b.cyl(0.052, 0.052, 0.62, 'shelterO2', [s * 0.36, 0.52, z1 - 0.075], null, 14);
      b.cyl(0.026, 0.026, 0.05, 'steel', [s * 0.36, 0.86, z1 - 0.075], null, 10);
      b.box(0.11, 0.018, 0.02, 'frameIn', [s * 0.36, 0.3, z1 - 0.012], null, 0.004);
      b.box(0.11, 0.018, 0.02, 'frameIn', [s * 0.36, 0.72, z1 - 0.012], null, 0.004);
    }
    b.box(0.2, 0.2, 0.09, 'rack', [-(X - 0.13), FY + 0.12, z1 - 0.05], null, 0.01);
    b.box(0.13, 0.03, 0.005, 'labelIn', [-(X - 0.13), FY + 0.19, z1 - 0.097], null, 0.002);
    b.cyl(0.035, 0.035, 0.012, 'shelterGauge', [-(X - 0.012), 0.95, 1.45], [0, 0, Math.PI / 2], 16);
    // the lamp in the ceiling, red strips along the floor's edges, the placards
    b.box(0.2, 0.015, 0.07, 'shelterLamp', [0, y1 - 0.012, 1.25], null, 0.004);
    for (const s of [-1, 1]) b.box(0.01, 0.01, z1 - 0.8, 'shelterRed', [s * (X - 0.01), y0 + 0.012, (0.8 + z1) / 2], null, 0.002);
    b.box(0.26, 0.05, 0.004, 'labelIn', [0, y1 - 0.08, z1 - 0.004], null, 0.002);
    // ---- the suit's niche behind the starboard wall: lined, lit along its edges, the suit
    // standing in it facing the seat
    const xo = X, xi = X + N.d;
    const nb = new Builder();
    nb.add(quad([xi, N.y0, N.z0], [xi, N.y0, N.z1], [xi, N.y1, N.z1], [xi, N.y1, N.z0]), 'padDark');
    nb.add(quad([xo, N.y0, N.z0], [xi, N.y0, N.z0], [xi, N.y1, N.z0], [xo, N.y1, N.z0]), 'padDark');
    nb.add(quad([xi, N.y0, N.z1], [xo, N.y0, N.z1], [xo, N.y1, N.z1], [xi, N.y1, N.z1]), 'padDark');
    nb.add(quad([xo, N.y0, N.z1], [xi, N.y0, N.z1], [xi, N.y0, N.z0], [xo, N.y0, N.z0]), 'panelInDark');
    nb.add(quad([xo, N.y1, N.z0], [xi, N.y1, N.z0], [xi, N.y1, N.z1], [xo, N.y1, N.z1]), 'padDark');
    // its sill (the step down into it), the light strips in its front corners, the suit's rack
    nb.box(N.d, 0.13, 0.012, 'frameIn', [xo + N.d / 2, FY - 0.065, N.z0 + 0.006], null, 0.003);
    for (const z of [N.z0 + 0.02, N.z1 - 0.02]) nb.box(0.012, N.y1 - N.y0 - 0.1, 0.012, 'nicheLamp', [xo + 0.05, (N.y0 + N.y1) / 2, z], null, 0.003);
    nb.box(0.04, 0.03, N.z1 - N.z0 - 0.06, 'steel', [xi - 0.06, N.y1 - 0.12, (N.z0 + N.z1) / 2], null, 0.006);
    nb.box(0.03, 0.5, 0.05, 'frameIn', [xi - 0.03, 0.62, (N.z0 + N.z1) / 2], null, 0.008);
    const niche = nb.build(M, { castShadow: false });
    niche.name = 'h8SuitNiche';
    this.niche = new THREE.Group();
    this.niche.add(niche);
    // H8's own suit (racked: no one in it), facing the seat, on the niche's carriage (it runs out
    // toward the seat and turns the suit round to be climbed into: suits.js)
    try {
      this.suit = buildSuit(SUITS.h8, { wearer: false });
      this.suitPivot = new THREE.Group();
      this.suitPivot.position.set(xo + 0.24, N.y0, (N.z0 + N.z1) / 2);
      this.suitX0 = xo + 0.24;
      this.suitPivot.rotation.y = Math.PI / 2;
      this.suitPivot.add(this.suit.root);
      this.niche.add(this.suitPivot);
    } catch (e) { console.warn('suit model', e); this.suit = null; }
    this.niche.visible = false;
    this.group.add(this.niche);
    // the shutter over the niche: slats, a grip; it rides up into the space over the ceiling
    const sb = new Builder();
    const sh = N.y1 - FY, sw = N.z1 - N.z0;
    sb.box(0.014, sh, sw, 'shutter', [0, sh / 2, 0], null, 0.004);
    for (let k = 1; k < 14; k++) sb.box(0.004, 0.006, sw - 0.02, 'frameIn', [-0.008, k * sh / 14, 0], null, 0.001);
    sb.box(0.03, 0.02, 0.18, 'steel', [-0.02, 0.35, 0], null, 0.006);
    sb.box(0.006, 0.03, 0.2, 'labelIn', [-0.008, 0.62, 0], null, 0.002);
    this.shutter = sb.build(M, { castShadow: false });
    this.shutter.position.set(X - 0.004, FY, (N.z0 + N.z1) / 2);
    this.group.add(this.shutter);
    this.group.add(b.build(M, { castShadow: false }));
    this.group.traverse((o) => { if (o.isMesh) o.layers.set(LAYER_NEAR); });
    this.group.visible = false;
  }

  /** in the cockpit: the slot under the seat (seen while its leaves are apart), the socket the
   * seat's column stands in, the telescoping rail */
  buildRail() {
    const M = this.M, S = FLOOR.slot;
    const pit = new Builder();
    const D = 0.17, zc = (S.z0 + S.z1) / 2, L = S.z1 - S.z0;
    // its lining (facing in), the amber lights down its sides, the carriage's track in its floor
    pit.add(quad([-S.x, FY - D, S.z0], [S.x, FY - D, S.z0], [S.x, FY - D, S.z1], [-S.x, FY - D, S.z1]), 'railDark');
    pit.add(quad([-S.x, FY - D, S.z1], [S.x, FY - D, S.z1], [S.x, FY, S.z1], [-S.x, FY, S.z1]), 'panelInDark');
    pit.add(quad([S.x, FY - D, S.z0], [-S.x, FY - D, S.z0], [-S.x, FY, S.z0], [S.x, FY, S.z0]), 'panelInDark');
    pit.add(quad([-S.x, FY - D, S.z0], [-S.x, FY - D, S.z1], [-S.x, FY, S.z1], [-S.x, FY, S.z0]), 'panelInDark');
    pit.add(quad([S.x, FY - D, S.z1], [S.x, FY - D, S.z0], [S.x, FY, S.z0], [S.x, FY, S.z1]), 'panelInDark');
    for (const s of [-1, 1]) pit.box(0.008, 0.008, L - 0.04, 'railLamp', [s * (S.x - 0.012), FY - 0.03, zc], null, 0.002);
    for (const s of [-1, 1]) pit.box(0.02, 0.02, L - 0.02, 'railSteel', [s * 0.1, FY - D + 0.01, zc], null, 0.004);
    pit.box(0.1, 0.05, 0.1, 'railDark', [0, FY - D + 0.025, S.cz], null, 0.01);
    this.pit = pit.build(M, { castShadow: false });
    this.pit.visible = false;
    this.rail.add(this.pit);
    // the socket: what fills the notch round the column when the seat has gone
    const sk = new Builder();
    sk.cyl(S.r, S.r, 0.004, 'frameIn', [0, FY - 0.003, S.cz], null, 28);
    sk.torus(S.r - 0.012, 0.0035, 'railLamp', [0, FY - 0.0005, S.cz], [Math.PI / 2, 0, 0], 28);
    this.socket = sk.build(M, { castShadow: false });
    this.socket.visible = false;
    this.rail.add(this.socket);
    // the telescoping rail: four sections nested in the slot, each run out of the one behind it
    this.beam = new THREE.Group();
    this.sections = [];
    const W = [0.13, 0.115, 0.1, 0.085], H = [0.05, 0.045, 0.04, 0.035], SL = 0.36;
    for (let k = 0; k < 4; k++) {
      const bb = new Builder();
      const top = SHELTER.lift;
      bb.box(W[k], H[k], SL, 'railSteel', [0, top - H[k] / 2, SL / 2], null, 0.004);
      bb.box(W[k] + 0.004, 0.006, 0.02, 'railDark', [0, top - 0.003, SL - 0.01], null, 0.002);
      for (const s of [-1, 1]) bb.box(0.004, 0.004, SL - 0.05, 'railLamp', [s * (W[k] / 2 - 0.006), top + 0.001, SL / 2], null, 0.001);
      const sec = bb.build(M, { castShadow: false });
      this.beam.add(sec);
      this.sections.push(sec);
    }
    this.beam.visible = false;
    this.rail.add(this.beam);
    this.SL = SL;
    this.rail.traverse((o) => { if (o.isMesh) o.layers.set(LAYER_NEAR); });
  }

  /** what is left when H8 is gone: the box in its frame, torn edges where the cockpit was cut away,
   * a strobe and the little emergency camera */
  buildPod() {
    const M = this.M, { X, y0, y1, z1 } = SHELTER;
    const b = new Builder();
    const cz = (0.62 + z1) / 2, d = z1 - 0.58;
    b.box(2 * X + 0.14, y1 - y0 + 0.14, d + 0.08, 'podShell', [0, (y0 + y1) / 2, cz + 0.02], null, 0.05);
    // ribs and armour plates riveted round it
    for (let i = 0; i < 4; i++) b.box(2 * X + 0.2, 0.06, d + 0.12, 'frameIn', [0, y0 + 0.12 + i * 0.5, cz + 0.02], null, 0.01);
    for (const s of [-1, 1]) b.box(0.05, y1 - y0 + 0.1, d * 0.8, 'armorPlain', [s * (X + 0.1), (y0 + y1) / 2, cz + 0.05], null, 0.02);
    b.box(2 * X + 0.1, y1 - y0 + 0.05, 0.08, 'armorPlain', [0, (y0 + y1) / 2, z1 + 0.1], null, 0.02);
    // the torn front: jagged plates bent outward round where the cockpit was
    for (let k = 0; k < 14; k++) {
      const a = k / 14 * Math.PI * 2;
      const r = 0.55 + 0.12 * Math.sin(k * 2.7);
      b.box(0.22 + 0.1 * Math.sin(k * 1.3), 0.03, 0.18 + 0.12 * Math.cos(k * 1.9), 'podTorn', [Math.cos(a) * r * 0.9, 0.25 + Math.sin(a) * r * 1.4, 0.6 - 0.05 * Math.sin(k)], [0.4 * Math.sin(k * 3.1), a, 0.6 * Math.cos(k * 2.3)], 0.005);
    }
    b.cyl(0.05, 0.05, 0.08, 'shelterStrobe', [0, y1 + 0.12, cz], null, 10);
    b.cyl(0.035, 0.035, 0.1, 'steel', [X + 0.12, y1 - 0.1, z1], [Math.PI / 2, 0, 0], 10);
    this.pod = b.build(M, { castShadow: false });
    this.pod.name = 'h8Pod';
    this.pod.traverse((o) => { if (o.isMesh) o.layers.set(LAYER_NEAR); });
    this.pod.visible = false;
  }

  /** the door's inner lining, riding on the display's sliding panel */
  buildDoorLiner(pivot) {
    const S = H8.shelter, Rl = R + 0.03;
    const pos = [], idx = [];
    const NA = 12, NE = 16;
    for (let j = 0; j <= NE; j++) {
      const el = S.el0 + (S.el1 - S.el0) * j / NE;
      for (let i = 0; i <= NA; i++) {
        const az = S.az - S.hw + 2 * S.hw * i / NA;
        pos.push(Math.sin(az) * Math.cos(el) * Rl, Cc.y + Math.sin(el) * Rl, -Math.cos(az) * Math.cos(el) * Rl);
      }
    }
    // facing outward (into the shelter): from the cockpit only its back shows, and is not drawn
    for (let j = 0; j < NE; j++) for (let i = 0; i < NA; i++) {
      const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const liner = new THREE.Mesh(g, this.M.shelterPad);
    liner.layers.set(LAYER_NEAR);
    // its placards and a red line down each edge (what Kaito faces, sealed in) — flat, facing into
    // the shelter only: from the cockpit, through the display, nothing of them shows
    const hb = new Builder();
    const at = (el, az, r) => [Math.sin(az) * Math.cos(el) * r, Cc.y + Math.sin(el) * r, -Math.cos(az) * Math.cos(el) * r];
    const flat = (w, h, key, el, az) => {
      const pg = new THREE.PlaneGeometry(w, h);
      // (a plane faces +z; turned to face away from the cockpit's middle at that azimuth)
      hb.add(pg, key, at(el, az, R + 0.036), [-el, Math.PI - az, 0]);
    };
    flat(0.26, 0.07, 'labelIn', 0.38, S.az);
    flat(0.16, 0.05, 'labelIn', -0.12, S.az);
    for (const s of [-1, 1]) for (let k = 0; k < 6; k++) {
      const el = S.el0 + 0.06 + (S.el1 - S.el0 - 0.12) * (k + 0.5) / 6;
      flat(0.01, (S.el1 - S.el0 - 0.12) / 6 * R + 0.01, 'shelterRed', el, S.az + s * (S.hw - 0.025));
    }
    const h = hb.build(this.M, { castShadow: false });
    h.traverse((o) => { if (o.isMesh) o.layers.set(LAYER_NEAR); });
    pivot.add(liner, h);
    this.liner = [liner, h];
    // adrift the display (and its sliding panel) is gone: the shelter keeps the door's inside as
    // its own front wall
    const front = new THREE.Group();
    front.position.set(Cc.x, 0, Cc.z);
    front.add(liner.clone(), h.clone());
    front.visible = false;
    this.group.add(front);
    this.podDoor = front;
  }

  /** the seat (h8.js: its record, its parts with the rig that carries it) */
  attachSeat(seat, parts) {
    this.pilotSeat = seat;
    this.parts = parts;
  }

  /** the screens (once the monitors exist): the console — every page of H8's, B-29's over the
   * link — and the small outside view; the shutter over the suit */
  init(g) {
    const { X } = SHELTER;
    const eye = SHELTER.eye;
    const face = (p) => eye.clone().sub(p).setY(0).normalize();
    const pC = V(-(X - 0.035), 0.5, 1.17), pS = V(-(X - 0.035), 0.86, 1.22);
    this.console = g.monitors.addSlot({ id: 'h8sys', pos: pC, n: face(pC), up: V(0, 1, 0), w: 0.3, h: 0.19, res: 640, h8: true }, this.group, DOCK);
    this.screen = g.monitors.addSlot({ id: 'h8shcam', pos: pS, n: face(pS), up: V(0, 1, 0), w: 0.2, h: 0.1125, res: 360, h8: true }, this.group, DOCK);
    for (const m of [this.console, this.screen]) if (m && m.mesh) m.mesh.layers.set(LAYER_NEAR);
    // the shutter over the suit: a tap from the seat opens it, the next puts the suit on
    const C = g.interact, N = SHELTER.niche;
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.2, N.y1 - FY - 0.1, N.z1 - N.z0 - 0.04), C.proxyMat);
    proxy.position.set(X - 0.02, (FY + N.y1) / 2, (N.z0 + N.z1) / 2);
    proxy.layers.set(LAYER_PROXY);
    this.group.add(proxy);
    C.addMesh(proxy, () => this.v.lockerTapped(), { maxDist: 1.6, enabled: () => this.occupied && this.state === 'in' });
    this.lockerProxy = proxy;
  }

  // ------------------------------------------------------------------ use
  get sealed() { return this.door < 0.02; }
  /** the panel in front of the shelter (0 shut .. 1 open) */
  get open() { return this.door; }
  get atHome() { return this.state === 'home'; }
  get busy() { return this.state === 'out' || this.state === 'back'; }

  /** a point of the physics frame inside the box */
  containsPF(p) {
    const x = p.x - DOCK.x, y = p.y - DOCK.y, z = p.z - DOCK.z;
    const { X, y0, y1, z1 } = SHELTER;
    return Math.abs(x) < X && y > y0 - 0.02 && y < y1 + 0.02 && z < z1 && z > zFront(y, Math.abs(x)) - 0.05;
  }

  /** the opening between the cockpit and the shelter (m^2) */
  flowArea() { return this.v.mode === 'pod' ? 0 : this.door * AREA; }

  o2Hours() { return this.o2 / (BREATH * 3600); }
  o2Text() { const h = this.o2Hours(); return h >= 1 ? `${h.toFixed(1)} 時間` : `${Math.round(h * 60)} 分`; }

  /** the red button on the armrest was pressed: the guard first, then the run */
  button() {
    const v = this.v;
    if (this.busy) return;
    if (this.guard < 0.5 || this.guardT < 0) {
      this.guardT = GUARD_OPEN;
      this.sfx('guard');
      v.say(this.state === 'in' ? 'hachi_shelter_arm_back' : 'hachi_shelter_arm', {}, { minGap: 4 });
      return;
    }
    this.guardT = -1;
    this.sfx('press');
    if (this.state === 'in') this.goBack(); else this.go();
  }

  /** into the shelter (Kaito in H8's seat) */
  go() {
    const v = this.v, g = v.g, pl = g.player;
    if (this.state !== 'home' || v.mode === 'pod' || v.mode === 'lost') return false;
    if (!(pl.state === 'seated' && pl.seat === this.pilotSeat)) return false;
    this.state = 'out';
    this.t = 0;
    this.guardT = -1;
    this.pilotSeat.lockAim = true;
    // the floor hatch behind the seat shut (the rail runs over it)
    v.floorHatchT = 0;
    // the zoom off: the display is no longer his to look at
    if (v.zoom) { v.zoom.z = 1; v.zoom.zT = 1; if (v.zoom.follow) v.zoom.toggleFollow && v.zoom.toggleFollow(); }
    v.say('hachi_shelter_going', {}, { force: true });
    return true;
  }

  /** back to the cockpit (Kaito in the shelter, H8 whole) */
  goBack() {
    const v = this.v, g = v.g, pl = g.player;
    if (this.state !== 'in') return false;
    if (v.mode === 'pod' || v.mode === 'lost') { v.say('hachi_shelter_nohome', {}, { minGap: 5 }); return false; }
    this.state = 'back';
    this.t = 0;
    this.guardT = -1;
    this.locker.target = 0;
    // H8's seat is his again: the eye rides it all the way
    if (pl.state === 'seated' && pl.seat === this.seat) { pl.seat = this.pilotSeat; this.pilotSeat.lockAim = true; }
    this.parts && this.v.int.group.add(this.parts.rig);
    v.say('hachi_shelter_back', {}, { force: true });
    return true;
  }

  /** H8 destroyed: whatever was under way snaps shut (the emergency closure) — true if Kaito ends
   * up sealed in the shelter */
  slam() {
    const pl = this.v.g.player;
    const riding = pl.state === 'seated' && pl.seat === this.pilotSeat;
    // (on the rail, most of the way in either direction: the carriage throws him the rest)
    const inside = (pl.state === 'seated' && pl.seat === this.seat) || (riding && this.busy && this.ride > 0.5);
    if (inside) this.snapIn();
    this.door = 0;
    this.locker.target = 0;
    return inside;
  }

  /** straight to sealed in (a restored game, the emergency closure) */
  snapIn() {
    const pl = this.v.g.player;
    this.state = 'in';
    this.t = OUT.end;
    this.ride = 1; this.lift = 1; this.door = 0; this.leaves = 0; this.rise = 0; this.ext = 0; this.acc = 0;
    if (this.pilotSeat) this.pilotSeat.lockAim = true;
    if (this.parts) this.group.add(this.parts.rig);
    if (pl.state === 'seated' && (pl.seat === this.pilotSeat || pl.seat === this.seat)) {
      pl.seat = this.seat;
      pl.teleport(SHELTER.center.clone().add(DOCK));
    }
  }

  /** straight home (a new H8, an empty shelter) */
  snapHome() {
    this.state = 'home';
    this.t = 0;
    this.ride = 0; this.lift = 0; this.door = 0; this.leaves = 0; this.rise = 0; this.ext = 0; this.acc = 0;
    if (this.pilotSeat) this.pilotSeat.lockAim = false;
    if (this.parts) this.v.int.group.add(this.parts.rig);
  }

  // ------------------------------------------------------------------ sound
  /** the run's sounds, in the ship's one family of mechanism sounds (audio.mech); open: the part
   * opening (or running out) rather than closing */
  sfx(kind, open = true) {
    const A = this.v.g.audio;
    if (!A || !A.ready) return;
    const seatP = V(0, 0.1, SEAT.G.z + this.ride * SHELTER.ride).add(DOCK);
    const doorP = V(0, 0.2, 1.0).add(DOCK), floorP = V(0, FY, -0.3).add(DOCK);
    switch (kind) {
      case 'guard': A.mech(seatP, 'latch', { open, gain: 0.45, pitch: 1.6 }); break;
      case 'press':
        A._burst(seatP, { dur: 0.16, freq: 160, q: 0.8, gain: 0.45, type: 'brown', filter: 'lowpass' });
        A.beep(880, 0.11, 0.07, { pos: seatP, type: 'square' });
        A.beep(660, 0.11, 0.07, { pos: seatP, type: 'square', when: 0.13 });
        A.beep(880, 0.11, 0.07, { pos: seatP, type: 'square', when: 0.26 });
        break;
      case 'leaves': A.mech(floorP, 'door', { open, dur: 0.4, pitch: 1.35 }); break;
      case 'door': A.mech(doorP, 'hatch', { open, dur: 0.5, pitch: 1.2 }); break;
      case 'rail':
        A.mech(floorP, 'servo', { open, dur: 0.4, pitch: 0.8 });
        for (let i = 0; i < 5; i++) setTimeout(() => A.click(floorP, 0.12), 70 + i * 70);
        break;
      case 'shove':
        A._burst(seatP, { dur: 0.22, freq: 110, q: 0.7, gain: 0.75, type: 'brown', filter: 'lowpass' });
        A._burst(seatP, { dur: 0.6, freq: 1400, q: 0.5, gain: 0.22, type: 'white', sweep: 0.2 });
        break;
      case 'glide': A.mech(seatP, 'heavy', { open: false, dur: 1.0, pitch: 1.7 }); break;
      case 'stop':
        A._burst(seatP, { dur: 0.3, freq: 90, q: 0.8, gain: 0.7, type: 'brown', filter: 'lowpass' });
        A.mech(seatP, 'latch', { open: false, gain: 0.9 });
        break;
      case 'shutter': A.mech(V(SHELTER.X, 0.3, 1.3).add(DOCK), 'servo', { open, dur: 0.7, pitch: 0.7 }); break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ per step
  update(dt) {
    const v = this.v, g = v.g, pl = g.player, ls = g.lifeSupport;
    this.occupied = pl.state === 'seated' && pl.seat === this.seat;
    // the guard drops again if the second press does not come
    if (this.guardT >= 0) { this.guardT -= dt; if (this.guardT < 0) this.sfx('guard', false); }
    this.guard = clamp01(this.guard + (this.guardT >= 0 ? 1 : -1) * dt / 0.18);
    this.sequence(dt);
    // the shutter over the suit
    const L = this.locker;
    L.open = clamp01(L.open + (L.target > L.open ? 1 : L.target < L.open ? -1 : 0) * dt / 0.7);
    // nobody in the shelter, the seat in it and H8 whole: it goes home by itself
    if (this.state === 'in' && !this.occupied && v.mode !== 'pod' && v.mode !== 'lost' && !(pl.state === 'seated' && pl.seat === this.pilotSeat)) {
      this.idleT = (this.idleT || 0) + dt;
      if (this.idleT > 2) { this.idleT = 0; this.state = 'back'; this.t = 0; this.parts && v.int.group.add(this.parts.rig); }
    } else this.idleT = 0;
    // its air: sealed, its own bottles keep it breathable (and scrub it); open, it shares the
    // cockpit's while the bottles are topped up from H8
    const z = ls.z.h8shelter;
    if (z) {
      const intact = v.mode !== 'pod' && v.mode !== 'lost';
      if (this.sealed || !intact) {
        const want = Math.max(0, 21.3 - z.o2);
        const dO = Math.min(want, 0.02 * dt, this.o2 / z.vol);
        if (dO > 0) { z.o2 += dO; this.o2 -= dO * z.vol; }
        // (it holds its pressure: what leaks is made up from the same bottles)
        const p = z.n2 + z.o2 + z.co2;
        if (p < 97 && this.o2 > 0) { const dn = Math.min(97 - p, 0.05 * dt); z.n2 += dn; this.o2 -= dn * z.vol * 0.25; }
        if (this.lioh > 0) {
          const s = Math.min(1, dt * 0.02) * (z.co2 > 0.05 ? 1 : 0);
          z.co2 -= (z.co2 - 0.04) * s;
          if (this.occupied) this.lioh = Math.max(0, this.lioh - dt / (10.5 * 3600));
        }
      }
      if (intact && v.awake > 0.3) {
        this.o2 = Math.min(FULL, this.o2 + FULL * dt / 1800);
        if (!this.occupied) this.lioh = Math.min(1, this.lioh + dt / 3600);
      }
      this.o2 = Math.max(0, this.o2);
    }
    // the battery: only while adrift does it run down (some 30 hours of lamp and screens)
    if (v.mode === 'pod') this.battery = Math.max(0, this.battery - dt / (30 * 3600));
    else this.battery = Math.min(1, this.battery + dt / 600);
    // the oxygen left, said as it runs low
    if (this.occupied && (this.sealed || v.mode === 'pod')) {
      const h = this.o2Hours();
      const mark = h < 0.5 ? 0.5 : h < 1 ? 1 : h < 3 ? 3 : h < 6 ? 6 : 99;
      if (mark < this.saidO2) { this.saidO2 = mark; v.say('hachi_shelter_o2', { t: this.o2Text() }, { force: true }); }
    } else if (this.o2Hours() > 9) this.saidO2 = 99;
  }

  /** the run in or out: where every part is at this moment */
  sequence(dt) {
    if (!this.busy) { this.acc = 0; if (this.bounce >= 0) this.bounce += dt; return; }
    const v = this.v, g = v.g, pl = g.player;
    const t0 = this.t;
    this.t += dt;
    const t = this.t;
    const hit = (x) => t0 < x && t >= x;
    const D = SHELTER.ride;
    if (this.state === 'out') {
      const T = OUT;
      this.lift = span(t, ...T.lift);
      this.leaves = t < T.close[0] ? span(t, ...T.leaves) : 1 - span(t, ...T.close);
      this.door = t < T.shut[0] ? span(t, ...T.door) : 1 - span(t, ...T.shut);
      this.rise = t < T.sink[0] ? span(t, ...T.rise) : 1 - span(t, ...T.sink);
      this.ext = t < T.retract[0] ? span(t, ...T.ext) : 1 - span(t, ...T.retract);
      const dur = T.ride[1] - T.ride[0];
      const r = run((t - T.ride[0]) / dur, 0.2, 0.2);
      this.ride = t < T.ride[0] ? 0 : r.s;
      this.acc = t > T.ride[0] && t < T.ride[1] ? r.acc * D / (dur * dur) : 0;
      if (hit(T.leaves[0])) this.sfx('leaves');
      if (hit(T.door[0])) this.sfx('door');
      if (hit(T.ext[0])) this.sfx('rail');
      if (hit(T.ride[0])) { this.sfx('shove'); v.seatMotion && v.seatMotion.jolt(1.6); }
      if (hit(T.shut[0])) this.sfx('door', false);
      if (hit(T.ride[1])) {
        // in: stopped hard on the shelter's rail and latched; Kaito's seat is the shelter's now
        this.sfx('stop');
        this.bounce = 0;
        v.seatMotion && v.seatMotion.jolt(2.2);
        g.shake = Math.max(g.shake || 0, 0.5);
        if (this.parts) this.group.add(this.parts.rig);
        if (pl.state === 'seated' && pl.seat === this.pilotSeat) {
          pl.seat = this.seat;
          pl.teleport(SHELTER.center.clone().add(DOCK));
        }
      }
      if (hit(T.shut[1])) setTimeout(() => this.occupied && v.say('hachi_shelter_in', { t: this.o2Text() }, { force: true }), 700);
      if (hit(T.retract[0])) this.sfx('rail', false);
      if (hit(T.close[0])) this.sfx('leaves', false);
      if (t >= T.end) { this.state = 'in'; this.t = T.end; }
    } else {
      const T = BACK;
      this.leaves = t < T.close[0] ? span(t, ...T.leaves) : 1 - span(t, ...T.close);
      this.door = t < T.shut[0] ? span(t, ...T.door) : 1 - span(t, ...T.shut);
      this.rise = t < T.sink[0] ? span(t, ...T.rise) : 1 - span(t, ...T.sink);
      this.ext = t < T.retract[0] ? span(t, ...T.ext) : 1 - span(t, ...T.retract);
      this.lift = 1 - span(t, ...T.drop);
      const dur = T.ride[1] - T.ride[0];
      const r = run((t - T.ride[0]) / dur, 0.4, 0.4);
      this.ride = t < T.ride[0] ? 1 : 1 - r.s;
      this.acc = t > T.ride[0] && t < T.ride[1] ? -r.acc * D / (dur * dur) : 0;
      if (hit(T.leaves[0] + 0.001)) this.sfx('leaves');
      if (hit(T.door[0])) this.sfx('door');
      if (hit(T.ext[0])) this.sfx('rail');
      if (hit(T.ride[0])) this.sfx('glide');
      if (hit(T.ride[1])) { this.sfx('stop'); v.seatMotion && v.seatMotion.jolt(0.8); }
      if (hit(T.retract[0])) this.sfx('rail', false);
      if (hit(T.shut[0])) this.sfx('door', false);
      if (hit(T.close[0])) this.sfx('leaves', false);
      if (t >= T.end) {
        this.state = 'home'; this.t = 0;
        if (this.pilotSeat) this.pilotSeat.lockAim = false;
        if (pl.state === 'seated' && pl.seat === this.pilotSeat) pl.teleport(V(0, FY + 0.95, SEAT.G.z).add(DOCK));
      }
    }
  }

  /** the carriage's offset of the seat now (H8-local) and its acceleration (for the seat's springs) */
  seatOffset(out) {
    // (the stop's rebound: a few centimetres, damped in a third of a second)
    const b = this.state === 'in' && this.bounce >= 0 && this.bounce < 0.5 ? 0.014 * Math.exp(-this.bounce / 0.08) * Math.sin(this.bounce * 52) : 0;
    return out.set(0, this.lift * SHELTER.lift, this.ride * SHELTER.ride - b);
  }

  // ------------------------------------------------------------------ per drawn frame
  /** what shows, the lamps, the rail and the leaves */
  updateVisual(eyePF) {
    const v = this.v, M = this.M;
    const pod = v.mode === 'pod';
    const inside = !!(eyePF && this.containsPF(eyePF));
    const intVis = v.int.group.visible;
    // (from the cockpit the box shows only through the open panel: the display in front of it shows
    // the world beyond, not what is behind the glass)
    this.group.visible = pod ? inside : intVis && (this.door > 0.002 || inside);
    this.pod.visible = pod && !inside;
    if (this.liner) for (const l of this.liner) l.visible = !pod;
    if (this.podDoor) this.podDoor.visible = pod;
    const lit = this.battery > 0 && (this.occupied || this.door > 0.01 || pod || this.state !== 'home');
    M.shelterLamp.emissiveIntensity = lit ? 0.9 : 0;
    M.shelterRed.emissiveIntensity = lit ? 1.4 + (pod ? 0.8 * Math.sin(performance.now() / 300) : 0) : 0;
    M.shelterGauge.emissiveIntensity = lit ? 0.8 : 0;
    // the rails' amber guide lights: running while anything moves, a glow while it waits
    const moving = this.busy;
    M.railLamp.emissiveIntensity = moving ? 2.2 + 1.2 * Math.sin(performance.now() / 70) : lit ? 0.6 : 0.25;
    // the drifting shelter's strobe: a double flash every two seconds
    const ph = (performance.now() / 2000) % 1;
    M.shelterStrobe.emissiveIntensity = pod && this.battery > 0 ? 9 * (Math.max(0, 1 - Math.abs(ph - 0.02) / 0.02) + Math.max(0, 1 - Math.abs(ph - 0.14) / 0.02)) : 0;
    // the button's guard and its glow (it pulses while the guard is up)
    if (this.parts && this.parts.red) {
      const e = ease(this.guard);
      this.parts.red.guard.rotation.x = 1.85 * e;
      this.parts.red.guard.updateMatrix();
      M.redBtn.emissiveIntensity = this.guardT >= 0 ? 2.2 + 1.6 * Math.sin(performance.now() / 110) : moving ? 2.5 : 0.6;
    }
    // the cockpit's side: the leaves, the slot under them, the rail and the socket
    v.display.setFloorSlot(this.leaves);
    this.pit.visible = intVis && this.leaves > 0.002;
    const seatAway = this.ride > 0.02 || this.state === 'in';
    this.socket.visible = intVis && seatAway && this.leaves < 0.02;
    const showBeam = intVis && (this.rise > 0.001 || this.leaves > 0.002);
    this.beam.visible = showBeam;
    if (showBeam) {
      const S = FLOOR.slot, SL = this.SL;
      const y = FY - 0.16 + (0.16) * ease(this.rise);
      const z0 = S.z0 + 0.03, tip = SHELTER.tip;
      const reach = z0 + SL + (tip - z0 - SL) * ease(this.ext);
      // each section's start: the first stays, the others share the reach
      for (let k = 0; k < 4; k++) {
        const start = z0 + (reach - z0 - SL) * k / 3;
        this.sections[k].position.set(0, y, start);
        this.sections[k].updateMatrix();
      }
    }
    // the suit's shutter, its niche, the suit (gone while it is worn)
    const L = this.locker, N = SHELTER.niche;
    const lo = ease(L.open);
    this.shutter.position.y = FY + lo * (N.y1 - FY + 0.05);
    this.shutter.visible = lo < 0.995;
    this.niche.visible = this.group.visible && L.open > 0.002;
    M.nicheLamp.emissiveIntensity = 2.0 * lo;
    const pl = v.g.player, SU = v.g.suits;
    const seq = SU && SU.seq && SU.seq.kind === 'h8';
    if (this.suit) this.suit.root.visible = !(pl.suit && pl.suitH8) || !!seq;
    // (while it goes on or comes off the niche stays lit and open)
    if (seq) this.niche.visible = this.group.visible;
  }

  /** the niche as the suit's rack (suits.js): the carriage runs out 0.25 m toward the seat; the
   * shutter opens for it and closes again after */
  suitRack(suits) {
    if (!this.suit) return;
    const v = this.v;
    suits.setRack('h8', this.suit, this.suitPivot, Math.PI / 2, {
      slide: (k) => { this.suitPivot.position.x = this.suitX0 - 0.25 * k; },
      onStart: () => v.setSuitShutter(true),
      onEnd: () => setTimeout(() => v.setSuitShutter(false), 600),
    });
  }

  /** the lamp in the light pool (dim; nothing more in here) */
  lampIntensity() { return this.battery > 0 && (this.occupied || this.door > 0.02 || this.v.mode === 'pod' || this.state !== 'home') ? 0.22 : 0; }

  // ------------------------------------------------------------------ save
  serialize() { return { o2: +this.o2.toFixed(3), lioh: +this.lioh.toFixed(4), bat: +this.battery.toFixed(4), in: this.state === 'in' || (this.state === 'out' && this.ride > 0.5) || (this.state === 'back' && this.ride > 0.5) }; }
  restore(s) {
    if (!s) return;
    this.o2 = s.o2 ?? FULL; this.lioh = s.lioh ?? 1; this.battery = s.bat ?? 1;
    if (s.in) this.snapIn(); else this.snapHome();
  }
}
