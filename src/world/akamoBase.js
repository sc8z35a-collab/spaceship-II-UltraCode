// AKAMO's bottom terminal on Shirasagi, seen from outside: a tower standing straight up off the
// top of the station's core (station-local +y, away from the Earth), the berth drum on top of it
// where the cabin lies between its runs, the ribbon going on up out of the drum's roof — and the
// station grown round it: a second habitat ring turning the other way (the two rings' spins
// cancel), the spine run out further fore and aft with new modules on it (a cargo and
// maintenance yard forward, a power block with its radiators aft), more solar wings.
// Station-local coordinates (y up, -z the way it flies), built in the station's own materials.
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';
import { CABIN } from './akamoCabin.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const BASE = {
  floorY: 46,           // the cabin's floor (and the berth hall's) over the core's middle
  tower: { y0: 7.0, y1: 41.5, r0: 3.4, r1: 2.7 },
  drum: { y0: 41.5, y1: 53.5, R: 13.4 },
};

/** the tower and its berth drum: { group, ring2 (the second ring: it turns), lights } */
export function buildBaseExterior(M) {
  const b = new Builder();
  const T = BASE.tower, D = BASE.drum;
  // ---- the tower: a tapered shaft, gold bands, lit window slits up it (the shaft inside)
  b.cyl(T.r1, T.r0, T.y1 - T.y0, 'hull', [0, (T.y0 + T.y1) / 2, 0], null, 32);
  for (let y = T.y0 + 4; y < T.y1 - 1; y += 6) b.cyl(T.r0 - (T.r0 - T.r1) * (y - T.y0) / (T.y1 - T.y0) + 0.08, T.r0 - (T.r0 - T.r1) * (y - T.y0) / (T.y1 - T.y0) + 0.08, 0.35, 'gold', [0, y, 0], null, 32);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    for (let y = T.y0 + 2; y < T.y1 - 2; y += 1.6) {
      const r = T.r0 - (T.r0 - T.r1) * (y - T.y0) / (T.y1 - T.y0) + 0.02;
      b.box(0.5, 0.9, 0.1, 'windowLit', [Math.cos(a) * r, y, Math.sin(a) * r], [0, -a + Math.PI / 2, 0], 0);
    }
  }
  // buttresses where it stands on the core
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    b.pipe(V(Math.cos(a) * 6.2, 5.6, Math.sin(a) * 6.2), V(Math.cos(a) * 3.1, 14, Math.sin(a) * 3.1), 0.45, 'hullDark', 8);
  }
  // ---- the berth drum: its wall with a ring of windows (the hall inside), its roof, the collar
  // the ribbon leaves through, the docking lights
  b.cyl(D.R, D.R - 1.2, 2.0, 'hullDark', [0, D.y0 + 1.0, 0], null, 64);
  b.cyl(D.R, D.R, D.y1 - D.y0 - 2.0, 'hull', [0, (D.y0 + 2.0 + D.y1) / 2, 0], null, 64);
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    b.box(1.3, 2.4, 0.12, 'windowLit', [Math.cos(a) * (D.R + 0.02), BASE.floorY + 2.4, Math.sin(a) * (D.R + 0.02)], [0, -a + Math.PI / 2, 0], 0);
  }
  b.cyl(D.R - 0.6, D.R, 1.2, 'hull', [0, D.y1 + 0.6, 0], null, 64);
  b.cyl(3.2, 4.4, 2.2, 'hullDark', [0, D.y1 + 2.3, 0], null, 32);
  b.torus(3.4, 0.22, 'gold', [0, D.y1 + 3.4, 0], [Math.PI / 2, 0, 0], 32);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.sphere(0.3, 'strobe', [Math.cos(a) * (D.R + 0.3), D.y1 + 0.2, Math.sin(a) * (D.R + 0.3)], 8);
  }
  // radiator fins round the drum's foot
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.13;
    b.box(0.15, 6.0, 3.5, 'hullDark', [Math.cos(a) * (D.R + 2.0), D.y0 + 3.5, Math.sin(a) * (D.R + 2.0)], [0, -a, 0], 0.02);
  }
  const group = b.build(M, { castShadow: false });
  group.name = 'akamoBase';
  return { group };
}

/**
 * The station grown round its elevator: a second habitat ring turning the other way (forward of
 * the core), the spine run out to +-210 m, a cargo yard forward and a power block aft, more solar
 * wings. Returns { group, ring2 } (ring2 turns: the caller spins it)
 */
export function buildExpansion(M) {
  const b = new Builder();
  // ---- the spine run out fore and aft (two parallel trusses with cross members)
  for (const s of [-1, 1]) {
    for (const x of [-2.2, 2.2]) for (const y of [-2.2, 2.2]) b.cyl(0.22, 0.22, 95, 'hullDark', [x, y, s * 162], [Math.PI / 2, 0, 0], 8);
    for (let z = 118; z < 210; z += 6) {
      b.box(4.6, 0.18, 0.18, 'hullDark', [0, 2.2, s * z], null, 0);
      b.box(4.6, 0.18, 0.18, 'hullDark', [0, -2.2, s * z], null, 0);
      b.box(0.18, 4.6, 0.18, 'hullDark', [2.2, 0, s * z], null, 0);
      b.box(0.18, 4.6, 0.18, 'hullDark', [-2.2, 0, s * z], null, 0);
    }
  }
  // ---- forward: the cargo and maintenance yard (a long pressurised module with berths, two
  // gantry cranes, stacked containers, floodlights)
  b.cyl(5.2, 5.2, 34, 'hull', [0, 0, -150], [Math.PI / 2, 0, 0], 32);
  for (const z of [-167, -133]) b.sphere(5.2, 'hull', [0, 0, z], 24, [1, 1, 0.55]);
  for (let z = -164; z <= -136; z += 4) b.torus(5.25, 0.14, 'gold', [0, 0, z], null, 32);
  for (let k = 0; k < 24; k++) { const z = -164 + k * 1.2; b.box(0.7, 0.5, 0.1, 'windowLit', [5.22, 1.2, z], [0, Math.PI / 2, 0], 0); b.box(0.7, 0.5, 0.1, 'windowLit', [-5.22, 1.2, z], [0, Math.PI / 2, 0], 0); }
  for (const s of [-1, 1]) {
    // berths for cargo craft: docking collars on its flanks
    for (const z of [-158, -142]) { b.cyl(1.6, 1.6, 2.4, 'hullDark', [s * 6.4, 0, z], [0, 0, Math.PI / 2], 20); b.torus(1.7, 0.12, 'gold', [s * 7.5, 0, z], [0, Math.PI / 2, 0], 20); }
    // gantries
    b.box(0.6, 16, 0.6, 'hullDark', [s * 9, 6, -176], null, 0);
    b.box(0.6, 16, 0.6, 'hullDark', [s * 9, 6, -196], null, 0);
    b.box(0.6, 0.6, 20.6, 'hullDark', [s * 9, 14, -186], null, 0);
  }
  b.box(18.6, 0.8, 0.8, 'hullDark', [0, 14, -178], null, 0);
  // containers in the yard
  const cont = ['hull', 'gold', 'hullDark'];
  for (let i = 0; i < 18; i++) {
    const x = -6 + (i % 3) * 6, z = -182 - Math.floor(i / 3) % 3 * 6.5, y = -1.5 + Math.floor(i / 9) * 2.7;
    b.box(5.4, 2.5, 6.0, cont[i % 3], [x, y, z], null, 0.05);
  }
  // ---- aft: the power block (a reactor drum, its radiator panels spread wide, a shadow shield)
  b.cyl(6.5, 6.5, 22, 'hull', [0, 0, 178], [Math.PI / 2, 0, 0], 32);
  b.cyl(7.5, 7.5, 2.0, 'hullDark', [0, 0, 166], [Math.PI / 2, 0, 0], 32);
  b.cyl(4.0, 6.5, 6, 'hullDark', [0, 0, 192], [Math.PI / 2, 0, 0], 32);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    b.box(36, 0.25, 9, 'hull', [s * 26, 0, 172 + k * 10], null, 0.02);
    for (let j = 0; j < 9; j++) b.box(0.12, 0.3, 8.6, 'hullDark', [s * (10 + j * 4), 0, 172 + k * 10], null, 0);
  }
  // ---- more solar wings (two pairs, fore and aft of the new blocks)
  for (const z of [-205, 205]) for (const s of [-1, 1]) {
    b.box(1.0, 1.0, 1.0, 'hullDark', [s * 4, 0, z], null, 0);
    b.box(46, 0.15, 13, 'solar', [s * 28, 0, z], null, 0);
    for (let j = 0; j < 6; j++) b.box(0.25, 0.25, 13.2, 'hullDark', [s * (8 + j * 8), 0.1, z], null, 0);
  }
  // nav lights at the ends
  b.sphere(0.4, 'strobe', [0, 6, -210], 8);
  b.sphere(0.4, 'strobe', [0, 8, 210], 8);
  const group = b.build(M, { castShadow: false });
  group.name = 'shirasagiExpansion';
  // ---- the second ring: like the first (58 m, six spokes, windows), forward of the core
  const rb = new Builder();
  rb.torus(58, 3.6, 'hull', [0, 0, 0], null, 96);
  for (const z of [-2.2, 2.2]) rb.torus(58, 3.7, 'gold', [0, 0, z], null, 96, 0.035);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + Math.PI / 6; rb.cyl(1.0, 1.0, 50, 'hullDark', [Math.cos(a) * 29, Math.sin(a) * 29, 0], [0, 0, a - Math.PI / 2], 12); }
  rb.cyl(5.2, 5.2, 8, 'hull', [0, 0, 0], [Math.PI / 2, 0, 0], 32);
  for (let k = 0; k < 180; k++) { const a = (k / 180) * Math.PI * 2; rb.box(0.9, 0.55, 0.16, 'windowLit', [Math.cos(a) * 54.35, Math.sin(a) * 54.35, 0], [0, 0, a + Math.PI / 2], 0); }
  const ring2 = rb.build(M, { castShadow: false });
  ring2.name = 'shirasagiRing2';
  ring2.position.set(0, 0, -64);
  group.add(ring2);
  return { group, ring2 };
}

/** the cabin's berth over the core (station-local): where the cabin's floor's middle lies */
export const BERTH_LOCAL = V(0, BASE.floorY, 0);
export const HALL = { R: 12.6, H: 6.0, floorY: BASE.floorY, cabinGap: 0.18, cabinA: CABIN.A, cabinB: CABIN.B };
