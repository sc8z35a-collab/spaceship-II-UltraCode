// AKAMO's foot on Shirasagi seen from outside, and the station grown round it (station-local:
// y up, -z the way it flies). Everything here is drawn single-sided and outward, with real holes
// where the inside passes through it, so that from within (the atrium, the skybridge, the transit
// tube, the lift, the berth's platform) nothing of the outside is seen across a passage.
//  - the core's skin: the old sphere with the skybridge's mouth, the transit tube's pole and the
//    lift's way out cut from it, flat lit panes over the atrium's windows (the old glow boxes stood
//    in front of the windows and across the bridge)
//  - the aft node module, hollow round the transit tube
//  - the lift's tower: a tinted glass tube in an open lattice, up from the core's shoulder
//  - the berth drum on it: windows all round, the shaft open to the sky down the middle, the ribbon
//    leaving through a gold rim in its roof; struts down to the core
//  - the station grown round it: the spine run out to +-210 m, a cargo yard forward, a power block
//    aft, a second habitat ring turning the other way, more solar wings
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';
import { AK_SITE, AK_POD_DEG } from './akamoSite.js';
import { TERM, band, level, ellipse } from './akamoTerminal.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const O = [0, 0, 0];

/** the site in station-local terms (dock: DOCK_AT, ship-local to station-local) */
function site(dock) {
  const L = AK_SITE.lift, B = AK_SITE.berth;
  return {
    lx: L.x + dock.x, lz: L.z + dock.z, bx: B.x + dock.x, bz: B.z + dock.z,
    floor: TERM.floor + dock.y, ceil: TERM.ceil + dock.y, pit: TERM.shaft.pit + dock.y,
    collar: 10.45 + dock.y,                    // the top of the lift's collar on the core
    bridge: { z0: dock.z, z1: 2.6 + dock.z, y0: 0.17 + dock.y, y1: 3.05 + dock.y },
  };
}

/**
 * Shirasagi's core skin, into the hub's own builder (in place of its plain sphere and the glow
 * boxes): holes for the skybridge, the transit tube and the lift; lit panes over the windows;
 * collars where the tube and the lift come out
 */
export function shirasagiCore(b, coreR, dock) {
  const s = site(dock), B = s.bridge;
  const hole = (p) =>
    (p.x < -4 && p.z > B.z0 - 0.12 && p.z < B.z1 + 0.12 && p.y > B.y0 - 0.12 && p.y < B.y1 + 0.12) ||
    (p.z > 4 && Math.hypot(p.x, p.y) < 1.62) ||
    (p.y > 0 && Math.hypot(p.x - s.lx, p.z - s.lz) < 1.95);
  {
    const g0 = new THREE.SphereGeometry(coreR, 160, 120).toNonIndexed();
    const a = g0.attributes.position.array, n = g0.attributes.normal.array, u = g0.attributes.uv.array;
    const P = [], N = [], U = [], c = V(0, 0, 0);
    for (let i = 0; i < a.length; i += 9) {
      c.set((a[i] + a[i + 3] + a[i + 6]) / 3, (a[i + 1] + a[i + 4] + a[i + 7]) / 3, (a[i + 2] + a[i + 5] + a[i + 8]) / 3);
      if (hole(c)) continue;
      for (let k = 0; k < 9; k++) { P.push(a[i + k]); N.push(n[i + k]); }
      const j = (i / 3) * 2;
      for (let k = 0; k < 6; k++) U.push(u[j + k]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    b.add(g, 'hull', O, O);
  }
  // lit panes over the atrium's windows (two bands, every other cell of 48), facing out only
  const tmp = new THREE.Object3D();
  for (const [la, lb] of [[4, 13], [-13, -4]]) for (let j = 0; j < 48; j += 2) {
    const lon = -Math.PI + TAU * (j + 0.5) / 48, lat = (la + lb) / 2 * Math.PI / 180;
    const p = V(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).multiplyScalar(coreR + 0.02);
    if (hole(p)) continue;
    tmp.position.copy(p); tmp.lookAt(p.clone().multiplyScalar(2));
    b.add(new THREE.PlaneGeometry(0.95, 1.15), 'lobbyGlow', p.toArray(), [tmp.rotation.x, tmp.rotation.y, tmp.rotation.z]);
  }
  // the transit tube's collar at the aft pole
  b.cyl(1.85, 1.85, 1.2, 'hullDark', [0, 0, 8.85], [Math.PI / 2, 0, 0], 32, true);
  b.add(new THREE.RingGeometry(1.55, 1.85, 32), 'hullDark', [0, 0, 9.45], O);
  // the lift's collar, its foot cut to the core's skin, its top a ring round the tube
  {
    const R = 2.15, n = 48, P = [], N = [];
    const yS = (x, z) => Math.sqrt(Math.max(0, coreR * coreR - x * x - z * z)) - 0.05;
    for (let i = 0; i < n; i++) {
      const pa = i / n * TAU, pb = (i + 1) / n * TAU;
      const A = [s.lx + R * Math.cos(pa), 0, s.lz + R * Math.sin(pa)], Bq = [s.lx + R * Math.cos(pb), 0, s.lz + R * Math.sin(pb)];
      A[1] = yS(A[0], A[2]); Bq[1] = yS(Bq[0], Bq[2]);
      const C = [Bq[0], s.collar, Bq[2]], D = [A[0], s.collar, A[2]];
      const na = [Math.cos(pa), 0, Math.sin(pa)], nb = [Math.cos(pb), 0, Math.sin(pb)];
      for (const [p, q] of [[A, na], [D, na], [C, nb], [A, na], [C, nb], [Bq, nb]]) { P.push(...p); N.push(...q); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    b.add(g, 'hullDark', O, O);
    const r = new THREE.RingGeometry(1.44, R, 48); r.rotateX(-Math.PI / 2);
    b.add(r, 'gold', [s.lx, s.collar, s.lz], O);
  }
  // the aft node module, hollow round the transit tube (its ends rings, not discs)
  b.cyl(4.2, 4.2, 18, 'hull', [0, 0, 22], [Math.PI / 2, 0, 0], 40, true);
  b.add(new THREE.RingGeometry(1.6, 4.2, 40), 'hull', [0, 0, 13], [0, Math.PI, 0]);
  b.add(new THREE.RingGeometry(1.6, 4.2, 40), 'hull', [0, 0, 31], O);
  for (let z = 14.5; z < 31; z += 4) b.torus(4.25, 0.12, 'gold', [0, 0, z], O, 40);
  tmp.up.set(0, 0, 1);
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * TAU;
    for (const z of [16.5, 20.5, 24.5, 28.5]) {
      const p = V(Math.cos(a) * 4.22, Math.sin(a) * 4.22, z);
      tmp.position.copy(p); tmp.lookAt(p.x * 2, p.y * 2, z);
      b.add(new THREE.PlaneGeometry(0.8, 1.2), 'windowLit', p.toArray(), [tmp.rotation.x, tmp.rotation.y, tmp.rotation.z]);
    }
  }
}

/**
 * The tower, the berth drum and the station grown round them. M: the stations' materials; dock:
 * DOCK_AT; P: the hub's proxy helpers { cap, sph, box }.
 * Returns { group, ring2 (turns the other way), band (the shaft's middle: hidden while docked,
 * when the platform inside is there instead) }
 */
export function buildAkamoExterior(M, dock, P) {
  if (!M.akTubeOut) M.akTubeOut = new THREE.MeshStandardMaterial({ color: 0x8aa3b2, roughness: 0.05, metalness: 0.85, transparent: true, opacity: 0.36, depthWrite: false });
  const s = site(dock), S = TERM.shaft;
  const b = new Builder(), bb = new Builder();
  const yS = (x, z) => Math.sqrt(Math.max(0, 72.25 - x * x - z * z));     // the core's skin over (x, z)

  // ===================================================================== the lift's tower
  b.add(band(s.lx, s.lz, 1.44, 1.44, 0, TAU, 48, s.collar, s.pit, 8, false), 'akTubeOut', O, O);
  const RT = 2.35, cols = [];
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * TAU + Math.PI / 6, x = s.lx + RT * Math.cos(a), z = s.lz + RT * Math.sin(a), y0 = yS(x, z) - 0.25;
    cols.push([x, z]);
    b.pipe([x, y0, z], [x, s.pit + 0.2, z], 0.16, 'hullDark', 10);
    b.sphere(0.32, 'hullDark', [x, y0 + 0.12, z], 10);
  }
  for (let y = 11, n = 0; y + 4 <= s.pit; y += 4, n++) {
    b.torus(RT, 0.07, 'hullDark', [s.lx, y, s.lz], [Math.PI / 2, 0, 0], 36);
    if (n % 3 === 0) b.torus(RT + 0.06, 0.035, 'gold', [s.lx, y + 0.13, s.lz], [Math.PI / 2, 0, 0], 36);
    for (let k = 0; k < 6; k++) {
      const [xa, za] = cols[k], [xb, zb] = cols[(k + 1) % 6], up = (n + k) % 2;
      b.pipe([xa, y + (up ? 0 : 4), za], [xb, y + (up ? 4 : 0), zb], 0.05, 'hullDark', 6);
    }
  }
  for (const y of [26, s.pit - 1.2]) for (const k of [0, 3]) b.sphere(0.18, 'strobe', [cols[k][0], y, cols[k][1]], 8);
  P.cap([s.lx, 7, s.lz], [s.lx, s.pit, s.lz], 2.8);

  // ===================================================================== the berth drum
  const R = 13.4, D0 = s.pit, D1 = s.ceil + 1.4;
  {
    const sh = new THREE.Shape(); sh.absarc(0, 0, R, 0, TAU, false);
    const h = new THREE.Path(); h.absarc(s.lx - s.bx, s.lz - s.bz, 1.46, 0, TAU, true); sh.holes.push(h);
    b.add(level(sh, s.bx, D0, s.bz, false), 'hullDark', O, O);
  }
  b.add(band(s.bx, s.bz, R, R, 0, TAU, 128, D0, D1, 2, false), 'hull', O, O);
  b.add(band(s.bx, s.bz, R + 0.06, R + 0.06, 0, TAU, 128, D0, D0 + 0.8, 1, false), 'hullDark', O, O);
  b.add(band(s.bx, s.bz, R + 0.06, R + 0.06, 0, TAU, 128, D1 - 0.5, D1 + 0.4, 1, false), 'hullDark', O, O);
  for (const y of [D0 + 0.85, D1 - 0.55]) b.torus(R + 0.07, 0.05, 'gold', [s.bx, y, s.bz], [Math.PI / 2, 0, 0], 128);
  // the platform's windows, lit from inside
  for (let k = 0; k < 24; k++) {
    const c = (k + 0.5) * TAU / 24;
    b.add(new THREE.PlaneGeometry(1.95, 4.1), 'windowLit', [s.bx + (R + 0.03) * Math.cos(c), s.floor + 2.55, s.bz + (R + 0.03) * Math.sin(c)], [0, Math.PI / 2 - c, 0]);
  }
  // the roof, open over the shaft; the shaft's walls above the platform's ceiling; a gold rim
  {
    const sh = new THREE.Shape(); sh.absarc(0, 0, R, 0, TAU, false); sh.holes.push(ellipse(S.a, S.b, true));
    b.add(level(sh, s.bx, D1, s.bz, true), 'hull', O, O);
  }
  b.add(band(s.bx, s.bz, S.a, S.b, 0, TAU, 96, s.ceil, D1, 1, true), 'hullDark', O, O);
  {
    const pts = [];
    for (let i = 0; i < 96; i++) { const a = i / 96 * TAU; pts.push(V(s.bx + (S.a + 0.16) * Math.cos(a), D1 + 0.1, s.bz + (S.b + 0.16) * Math.sin(a))); }
    b.tube(pts, 0.16, 'gold', { closed: true, seg: 192 });
  }
  for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; b.sphere(0.24, 'strobe', [s.bx + (S.a + 0.6) * Math.cos(a), D1 + 0.25, s.bz + (S.b + 0.6) * Math.sin(a)], 8); }
  for (let k = 0; k < 12; k++) { const a = (k + 0.5) / 12 * TAU; b.box(0.15, 5.5, 3.2, 'radiatorPanel', [s.bx + (R + 0.32) * Math.cos(a), D0 + 2.9, s.bz + (R + 0.32) * Math.sin(a)], [0, -a, 0], 0.02);
      for (const yy of [0.8, 2.9, 5.0]) b.box(0.32, 0.12, 0.5, 'radiatorPanel', [s.bx + (R + 0.16) * Math.cos(a), D0 + yy, s.bz + (R + 0.16) * Math.sin(a)], [0, -a, 0], 0.01); }
  // the station's antenna, moved up here off the core's top
  { const x = s.bx - 10.4, z = s.bz + 3.2; b.cyl(0.18, 0.32, 7, 'hull', [x, D1 + 3.5, z], O, 12); b.box(4.5, 1.6, 0.12, 'solarPanel', [x, D1 + 5.4, z], O, 0); P.cap([x, D1, z], [x, D1 + 7.5, z], 2.4); }
  // struts from the core's shoulder to the drum's underside
  for (const [bp, a] of [[[6.31, 4.92, -2.87], 20], [[-0.27, 5.81, -6.2], 200], [[5.67, 2.83, -5.67], 300]]) {
    const t = [s.bx + 8.5 * Math.cos(a * Math.PI / 180), D0, s.bz + 8.5 * Math.sin(a * Math.PI / 180)];
    b.pipe(bp, t, 0.34, 'hullDark', 12);
    for (const f of [0.08, 0.92]) b.sphere(0.5, 'gold', [bp[0] + (t[0] - bp[0]) * f, bp[1] + (t[1] - bp[1]) * f, bp[2] + (t[2] - bp[2]) * f], 10);
    P.cap(bp, t, 0.8);
  }
  P.box([s.bx, (D0 + D1) / 2, s.bz], [R + 0.3, (D1 - D0) / 2 + 0.5, R + 0.3]);
  // the shaft's middle and the pit (inside, when B-29 is in, the platform's own are there instead)
  bb.add(level(ellipse(S.a, S.b), s.bx, s.pit, s.bz, true), 'hullDark', O, O);
  bb.add(band(s.bx, s.bz, S.a, S.b, 0, TAU, 96, s.pit, s.floor + 0.16, 1, true), 'hullDark', O, O);
  bb.add(band(s.bx, s.bz, S.a, S.b, 0, TAU, 96, s.floor + 0.16, s.ceil - 0.32, 1, true), 'windowLit', O, O);
  bb.add(band(s.bx, s.bz, S.a, S.b, 0, TAU, 96, s.ceil - 0.32, s.ceil, 1, true), 'hullDark', O, O);
  bb.box(1.5, 0.3, 0.9, 'metalDark', [s.bx, s.pit + 0.15, s.bz], O, 0.03);
  // the escape pods on the drum's wall, their hatches inside (gone once the station's pods are away)
  const pb = new Builder();
  for (const deg of AK_POD_DEG) {
    const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), y = s.floor + 1.15;
    const at = (r) => [s.bx + r * ca, y, s.bz + r * sa];
    pb.torus(0.86, 0.08, 'hullDark', at(R + 0.05), [0, Math.PI / 2 - a, 0], 32);
    pb.cyl(0.75, 0.75, 1.3, 'hull', at(R + 0.75), [0, -a, -Math.PI / 2], 24);
    pb.torus(0.77, 0.06, 'hullOrange', at(R + 0.95), [0, Math.PI / 2 - a, 0], 32);
    pb.sphere(0.75, 'hull', at(R + 1.4), 20);
    pb.sphere(0.12, 'strobe', [s.bx + (R + 0.6) * ca, y + 0.8, s.bz + (R + 0.6) * sa], 8);
  }
  const group = b.build(M, { castShadow: false });
  group.name = 'akamoBase';
  const pods = pb.build(M, { castShadow: false });
  pods.name = 'akamoPods';
  group.add(pods);
  const shaftBand = bb.build(M, { castShadow: false });
  shaftBand.name = 'akamoShaftBand';
  group.add(shaftBand);

  // ===================================================================== the station grown
  const x = buildExpansion(M, P);
  group.add(x.group);
  return { group, ring2: x.ring2, band: shaftBand, pods };
}

function buildExpansion(M, P) {
  const b = new Builder();
  // the spine run out fore and aft (four longerons, frames every 6 m)
  for (const s of [-1, 1]) {
    for (const x of [-2.2, 2.2]) for (const y of [-2.2, 2.2]) b.cyl(0.22, 0.22, 95, 'hullDark', [x, y, s * 162], [Math.PI / 2, 0, 0], 8);
    for (let z = 118; z < 210; z += 6) {
      for (const y of [-2.2, 2.2]) b.box(4.6, 0.18, 0.18, 'hullDark', [0, y, s * z], O, 0);
      for (const x of [-2.2, 2.2]) b.box(0.18, 4.6, 0.18, 'hullDark', [x, 0, s * z], O, 0);
    }
    P.cap([0, 0, s * 115], [0, 0, s * 210], 3.4);
  }
  // forward: the cargo and maintenance yard: a long pressurised module with berths on its flanks,
  // two gantry cranes, containers stacked under them
  b.cyl(5.2, 5.2, 34, 'hull', [0, 0, -150], [Math.PI / 2, 0, 0], 32);
  for (const z of [-167, -133]) b.sphere(5.2, 'hull', [0, 0, z], 24, [1, 1, 0.55]);
  for (let z = -164; z <= -136; z += 4) b.torus(5.25, 0.14, 'gold', [0, 0, z], O, 32);
  for (let k = 0; k < 24; k++) { const z = -164 + k * 1.2; for (const s of [-1, 1]) b.box(0.7, 0.5, 0.1, 'windowLit', [s * 5.22, 1.2, z], [0, Math.PI / 2, 0], 0); }
  for (const s of [-1, 1]) {
    for (const z of [-158, -142]) { b.cyl(1.6, 1.6, 2.4, 'hullDark', [s * 6.4, 0, z], [0, 0, Math.PI / 2], 20); b.torus(1.7, 0.12, 'hullOrange', [s * 7.5, 0, z], [0, Math.PI / 2, 0], 20); }
    b.box(0.6, 16, 0.6, 'metalDark', [s * 9, 6, -176], O, 0);
    b.box(0.6, 16, 0.6, 'metalDark', [s * 9, 6, -196], O, 0);
    b.box(0.6, 0.6, 20.6, 'metalDark', [s * 9, 14, -186], O, 0);
  }
  b.box(18.6, 0.8, 0.8, 'plasticY', [0, 14, -182], O, 0);
  b.box(1.2, 1.0, 1.2, 'plasticY', [0, 13.1, -182], O, 0.05);
  const cont = ['hull', 'hullOrange', 'hullDark', 'plasticY'];
  for (let i = 0; i < 18; i++) {
    const x = -6 + (i % 3) * 6, z = -182 - (Math.floor(i / 3) % 3) * 6.5, y = -1.5 + Math.floor(i / 9) * 2.7;
    b.box(5.4, 2.5, 6.0, cont[(i * 7) % 4], [x, y, z], O, 0.05);
  }
  for (const s of [-1, 1]) b.box(0.5, 0.5, 0.5, 'flood', [s * 9, 15, -172], O, 0.05);
  P.cap([0, 0, -168], [0, 0, -132], 5.8);
  P.box([0, 6, -186], [11, 10, 12]);
  // aft: the power block: the reactor drum, its shadow shield, radiators spread wide
  b.cyl(6.5, 6.5, 22, 'hull', [0, 0, 178], [Math.PI / 2, 0, 0], 32);
  b.cyl(7.5, 7.5, 2.0, 'hullDark', [0, 0, 166], [Math.PI / 2, 0, 0], 32);
  b.cyl(4.0, 6.5, 6, 'hullDark', [0, 0, 192], [Math.PI / 2, 0, 0], 32);
  for (let z = 170; z <= 186; z += 4) b.torus(6.55, 0.12, 'gold', [0, 0, z], O, 32);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    b.box(36, 0.25, 9, 'radiatorPanel', [s * 26, 0, 172 + k * 10], O, 0.02);
    for (let j = 0; j < 9; j++) b.box(0.12, 0.32, 8.6, 'metalDark', [s * (10 + j * 4), 0, 172 + k * 10], O, 0);
    P.box([s * 26, 0, 172 + k * 10], [18.2, 0.6, 4.7]);
  }
  P.cap([0, 0, 165], [0, 0, 195], 7.8);
  // more solar wings, fore and aft of the new blocks
  for (const z of [-205, 205]) for (const s of [-1, 1]) {
    b.box(1.0, 1.0, 1.0, 'hullDark', [s * 4, 0, z], O, 0);
    b.box(46, 0.15, 13, 'solarPanel', [s * 28, 0, z], O, 0);
    for (let j = 0; j < 6; j++) b.box(0.25, 0.25, 13.2, 'metalDark', [s * (8 + j * 8), 0.1, z], O, 0);
    P.box([s * 28, 0, z], [23.4, 0.5, 6.8]);
  }
  b.sphere(0.4, 'strobe', [0, 6, -210], 8);
  b.sphere(0.4, 'strobe', [0, 8, 210], 8);
  const group = b.build(M, { castShadow: false });
  group.name = 'shirasagiExpansion';
  // the second habitat ring, like the first, beyond the aft solar booms; it turns the other way
  // (the two rings' spins cancel)
  const rb = new Builder();
  rb.torus(58, 3.6, 'hull', O, O, 128);
  for (const z of [-2.2, 2.2]) rb.torus(58, 3.7, 'gold', [0, 0, z], O, 128);
  for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + Math.PI / 6; rb.cyl(1.0, 1.0, 50, 'hullDark', [Math.cos(a) * 29, Math.sin(a) * 29, 0], [0, 0, a - Math.PI / 2], 12); }
  rb.cyl(5.2, 5.2, 8, 'hull', O, [Math.PI / 2, 0, 0], 32);
  for (let k = 0; k < 180; k++) { const a = k / 180 * TAU; rb.box(0.6, 1.4, 0.8, 'windowLit', [Math.cos(a) * 54.35, Math.sin(a) * 54.35, (k % 2 ? 1 : -1) * 1.0], [0, 0, a], 0.05); }
  for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + 1.2; rb.sphere(0.5, 'strobe', [Math.cos(a) * 61.8, Math.sin(a) * 61.8, 0], 10); }
  const ring2 = rb.build(M, { castShadow: false });
  ring2.name = 'shirasagiRing2';
  ring2.position.set(0, 0, 140);
  ring2.updateMatrix();
  group.add(ring2);
  for (let k = 0; k < 28; k++) { const a = k / 28 * TAU; P.sph([Math.cos(a) * 58, Math.sin(a) * 58, 140], 4.3); }
  P.cap([0, 0, 135], [0, 0, 145], 6);
  return { group, ring2 };
}
