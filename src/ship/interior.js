// Interior shell of B-29: inner pressure-hull wall, ribs, deck, partitions with door openings,
// corridor, ceiling trays and light fixtures. Rooms' furniture is added by rooms.js.
import * as THREE from 'three';
import { Builder, roundedRectPath, panelGeometry, rng } from './geom.js';
import { HULL, hullAt, sectionPoint, halfWidthAt, heightRangeAt, DECK_Y, LOWER_Y, Z_COCKPIT_BULK, Z_ENG_BULK, Z_REACTOR_BULK, CORRIDOR_X } from './hullShape.js';
import { loftGeometry, cutOpeningTris } from './exterior.js';
import { OPENINGS } from './hullShape.js';
import { buildCorridor, buildRoomCoves, doorFrame } from './architecture.js';

export const INSET = HULL.inset;
export const Z_FRONT = -12.9;  // inner nose (approx)
export const LIFT = { x0: 0.95, x1: 2.05, z0: -4.3, z1: -3.2 };
export const ENG_HATCH = { x0: -1.7, x1: -0.9, z0: 7.3, z1: 8.1 };

// doors: id -> definition (opening in a partition). axis: 'x' = wall plane normal along X, 'z' = along Z
export const DOORS = {
  cockpit: { axis: 'z', at: Z_COCKPIT_BULK, c: 0, w: 0.86, h: 1.92, zones: ['cockpit', 'corridor'] },
  living: { axis: 'x', at: -CORRIDOR_X, c: -3.62, w: 0.82, h: 1.9, zones: ['living', 'corridor'] },
  store: { axis: 'x', at: -CORRIDOR_X, c: 2.4, w: 0.8, h: 1.88, zones: ['store', 'corridor'] },
  bath: { axis: 'x', at: CORRIDOR_X, c: -7.55, w: 0.76, h: 1.88, zones: ['bath', 'corridor'] },
  airlock: { axis: 'x', at: CORRIDOR_X, c: -1.05, w: 0.8, h: 1.86, zones: ['airlock', 'corridor'], hatch: true },
  ls: { axis: 'x', at: CORRIDOR_X, c: 3.0, w: 0.78, h: 1.88, zones: ['ls', 'corridor'] },
  eng: { axis: 'z', at: Z_ENG_BULK, c: 0, w: 0.86, h: 1.92, zones: ['eng', 'corridor'] },
};

// open alcoves in the corridor walls (no door): bunk (port) and the lift landing (starboard)
export const ALCOVES = [
  { side: -1, c: -1.3, w: 2.4, h: 1.7, y0: DECK_Y + 0.1, r: 0.3 },
  { side: 1, c: -3.75, w: 1.25, h: 1.94, y0: DECK_Y + 0.008, r: 0.24 },
];

/** inner section outline points above a given y (for partition shapes), returned as [x,y] */
export function sectionAbove(z, yMin, inset = INSET, n = 96) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI; // starboard (0) over the top to port (PI)
    const p = sectionPoint(z, t, inset);
    if (p.y >= yMin) pts.push([p.x, p.y]);
  }
  const xr = halfWidthAt(z, yMin, inset);
  return [[xr, yMin], ...pts, [-xr, yMin]];
}

/** sweep a rectangular profile along a polyline lying in a z-plane (inward offset d, width w) */
function ribGeometry(points, w, d, z) {
  const pos = [];
  const N = points.length;
  const corners = [];
  for (let i = 0; i < N; i++) {
    const p = points[i];
    const pa = points[Math.max(0, i - 1)], pb = points[Math.min(N - 1, i + 1)];
    const tx = pb[0] - pa[0], ty = pb[1] - pa[1];
    const l = Math.hypot(tx, ty) || 1;
    // inward normal (toward section centre): rotate tangent
    let nx = -ty / l, ny = tx / l;
    const cx = 0, cy = 0.5;
    if ((cx - p[0]) * nx + (cy - p[1]) * ny < 0) { nx = -nx; ny = -ny; }
    corners.push([
      [p[0], p[1], z - w / 2], [p[0], p[1], z + w / 2],
      [p[0] + nx * d, p[1] + ny * d, z + w / 2], [p[0] + nx * d, p[1] + ny * d, z - w / 2],
    ]);
  }
  for (let i = 0; i < N - 1; i++) {
    const A = corners[i], B = corners[i + 1];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      const a = A[k], b = A[k2], c = B[k2], e = B[k];
      pos.push(...a, ...e, ...c, ...a, ...c, ...b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function shapeFromPts(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

/** door opening path (rounded rectangle) in partition-local 2D coords */
function doorPath(cx, w, h, y0 = DECK_Y) {
  return roundedRectPath(w, h, 0.22, cx, y0 + h / 2 + 0.005);
}

export function buildInteriorShell(M) {
  const b = new Builder();
  b.autoRound = true;   // nothing in the cabin has hard square edges
  const R = rng(29);
  // ---------- inner hull wall (whole cabin + underfloor) ----------
  const z0 = HULL.zTip + 0.02, z1 = Z_REACTOR_BULK + 0.02;
  const inner = loftGeometry(z0, z1, 230, 140, INSET, true);
  b.add(inner, 'wall');
  // collision shell: lower resolution, open at the airlock hatch so EVA is possible
  b.colMesh(cutOpeningTris(loftGeometry(z0, z1, 120, 72, INSET, true), OPENINGS.find((o) => o.kind === 'hatch'), 0.06));
  // nose cap closure inside (small dome) — the loft already closes near the tip
  // ---------- ribs (frames) every 0.8 m, underfloor ----------
  for (let z = -11.6; z <= 9.2; z += 0.8) {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const t = -Math.PI / 2 + (i / 64) * Math.PI * 2;
      const p = sectionPoint(z, t, INSET - 0.005);
      pts.push([p.x, p.y]);
    }
    // only the part below the deck: above it the frames are hidden behind the cabin lining (bare
    // dark arcs standing off the curved walls read as floating bars)
    const lo = pts.filter((p) => p[1] < DECK_Y - 0.08);
    if (lo.length > 3) {
      // lower part is split around the bottom (t=-PI/2); reorder from starboard to port going down
      const left = lo.filter((p) => p[0] < 0).sort((a, c) => c[1] - a[1]);
      const right = lo.filter((p) => p[0] >= 0).sort((a, c) => a[1] - c[1]);
      const loop = [...right.reverse(), ...left];
      if (loop.length > 3) b.add(ribGeometry(loop, 0.07, 0.06, z), 'frame');
    }
  }

  // ---------- main deck ----------
  const deckPts = [];
  const zA = -11.95, zB = Z_REACTOR_BULK - 0.01;
  const NZ = 60;
  for (let i = 0; i <= NZ; i++) { const z = zA + (zB - zA) * (i / NZ); deckPts.push([halfWidthAt(z, DECK_Y, INSET) - 0.005, -z]); }
  for (let i = NZ; i >= 0; i--) { const z = zA + (zB - zA) * (i / NZ); deckPts.push([-(halfWidthAt(z, DECK_Y, INSET) - 0.005), -z]); }
  const deckShape = shapeFromPts(deckPts);
  // holes: lift shaft, engineering hatch, corridor grates
  const holeRect = (x0, x1, z0_, z1_) => {
    const p = new THREE.Path();
    p.moveTo(x0, -z0_); p.lineTo(x0, -z1_); p.lineTo(x1, -z1_); p.lineTo(x1, -z0_); p.closePath();
    return p;
  };
  deckShape.holes.push(holeRect(LIFT.x0, LIFT.x1, LIFT.z0, LIFT.z1));
  deckShape.holes.push(holeRect(ENG_HATCH.x0, ENG_HATCH.x1, ENG_HATCH.z0, ENG_HATCH.z1));
  const GRATES = [[-0.45, 0.45, -6.6, -5.2], [-0.45, 0.45, 0.6, 2.0], [-0.45, 0.45, 3.6, 4.6]];
  for (const g of GRATES) deckShape.holes.push(holeRect(g[0], g[1], g[2], g[3]));
  const deck = new THREE.ExtrudeGeometry(deckShape, { depth: 0.05, bevelEnabled: false, curveSegments: 4 });
  deck.rotateX(-Math.PI / 2);
  deck.translate(0, DECK_Y - 0.05, 0);
  b.add(deck, 'floor');
  b.colMesh(deck);
  // grates
  for (const g of GRATES) {
    const w = g[1] - g[0], d = g[3] - g[2];
    b.add(new THREE.PlaneGeometry(w, d), 'grate', [(g[0] + g[1]) / 2, DECK_Y - 0.02, (g[2] + g[3]) / 2], [-Math.PI / 2, 0, 0]);
    b.box(w + 0.04, 0.04, 0.04, 'frame', [(g[0] + g[1]) / 2, DECK_Y - 0.03, g[2]], null, 0.005);
    b.box(w + 0.04, 0.04, 0.04, 'frame', [(g[0] + g[1]) / 2, DECK_Y - 0.03, g[3]], null, 0.005);
    b.colBox(w, 0.03, d, [(g[0] + g[1]) / 2, DECK_Y - 0.025, (g[2] + g[3]) / 2]);
  }
  // deck support beams below the floor, interrupted at the lift shaft and the engineering hatch
  const HOLES = [LIFT, ENG_HATCH].map((h) => ({ x0: h.x0 - 0.06, x1: h.x1 + 0.06, z0: h.z0 - 0.06, z1: h.z1 + 0.06 }));
  const beamX = (z, xa, xb) => {   // transverse beam from xa to xb at z, minus the holes
    let segs = [[xa, xb]];
    for (const h of HOLES) {
      if (z < h.z0 || z > h.z1) continue;
      segs = segs.flatMap(([a, c]) => (c <= h.x0 || a >= h.x1 ? [[a, c]] : [[a, Math.min(c, h.x0)], [Math.max(a, h.x1), c]].filter(([u, v]) => v - u > 0.05)));
    }
    for (const [a, c] of segs) b.box(c - a, 0.12, 0.08, 'metalDark', [(a + c) / 2, DECK_Y - 0.11, z], null, 0.01);
  };
  const beamZ = (x, za, zb) => {   // longitudinal beam along z at x, minus the holes
    let segs = [[za, zb]];
    for (const h of HOLES) {
      if (x < h.x0 || x > h.x1) continue;
      segs = segs.flatMap(([a, c]) => (c <= h.z0 || a >= h.z1 ? [[a, c]] : [[a, Math.min(c, h.z0)], [Math.max(a, h.z1), c]].filter(([u, v]) => v - u > 0.05)));
    }
    for (const [a, c] of segs) b.box(0.08, 0.12, c - a, 'metalDark', [x, DECK_Y - 0.11, (a + c) / 2], null, 0.01);
  };
  for (let z = -10.8; z < 9.4; z += 1.2) {
    const hw = halfWidthAt(z, DECK_Y - 0.12, INSET) - 0.02;
    beamX(z, -hw, hw);
  }
  for (const x of [-1.3, 1.3]) beamZ(x, -10.8, 8.2);

  // ---------- partitions (bulkheads) ----------
  // P1: cockpit bulkhead
  partitionZ(b, Z_COCKPIT_BULK, [DOORS.cockpit], M);
  // P2: engineering bulkhead
  partitionZ(b, Z_ENG_BULK, [DOORS.eng], M);
  // P3: reactor shield bulkhead (full section) with viewport
  {
    const z = Z_REACTOR_BULK;
    const pts = [];
    for (let i = 0; i <= 96; i++) { const p = sectionPoint(z, (i / 96) * Math.PI * 2, INSET - 0.01); pts.push([p.x, p.y]); }
    const sh = shapeFromPts(pts);
    // round shielded viewport onto the reactor core (lead-glass plug in a thick ring)
    const vp = new THREE.Path(); vp.absarc(0, 1.3, 0.42, 0, Math.PI * 2, true); sh.holes.push(vp);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.18, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, z - 0.09);
    b.add(g, 'panelDark');
    b.colMesh(g);
    // viewport: deep steel collar, bolted flange, hazard ring, glass
    b.cyl(0.47, 0.47, 0.34, 'steel', [0, 1.3, z - 0.05], [Math.PI / 2, 0, 0], 48, true);
    b.torus(0.46, 0.05, 'steel', [0, 1.3, z - 0.22], [0, 0, 0], 48);
    b.torus(0.6, 0.035, 'metalDark', [0, 1.3, z - 0.1], [0, 0, 0], 48);
    b.add(new THREE.RingGeometry(0.51, 0.6, 48, 1), 'hazard', [0, 1.3, z - 0.095]);
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; b.cyl(0.016, 0.016, 0.03, 'steel', [Math.cos(a) * 0.555, 1.3 + Math.sin(a) * 0.555, z - 0.105], [Math.PI / 2, 0, 0], 8); }
    b.add(new THREE.CircleGeometry(0.43, 48), 'glassProp', [0, 1.3, z + 0.02]);
    b.colCyl(0.46, 0.2, [0, 1.3, z], [Math.PI / 2, 0, 0]);
  }
  // corridor walls x = +/- CORRIDOR_X between the bulkheads
  const zc0 = Z_COCKPIT_BULK + 0.03, zc1 = Z_ENG_BULK - 0.03;
  for (const side of [-1, 1]) {
    const x = side * CORRIDOR_X;
    const pts = [];
    const N = 70;
    for (let i = 0; i <= N; i++) { const z = zc0 + (zc1 - zc0) * (i / N); const [, top] = heightRangeAt(z, x, INSET); pts.push([z, top - 0.02]); }
    const outline = [[zc0, DECK_Y], ...pts, [zc1, DECK_Y]];
    const sh = shapeFromPts(outline);
    // openings on this wall
    for (const d of Object.values(DOORS)) {
      if (d.axis === 'x' && Math.sign(d.at) === side) sh.holes.push(doorPath(d.c, d.w, d.h));
    }
    if (side < 0) sh.holes.push(roundedRectPath(ALCOVES[0].w, ALCOVES[0].h, ALCOVES[0].r, ALCOVES[0].c, ALCOVES[0].y0 + ALCOVES[0].h / 2)); // bunk alcove opening
    else sh.holes.push(roundedRectPath(ALCOVES[1].w, ALCOVES[1].h, ALCOVES[1].r, ALCOVES[1].c, ALCOVES[1].y0 + ALCOVES[1].h / 2)); // lift alcove opening
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1, curveSegments: 8 });
    // shape is in (z,y); map to world: x = const, shape.x -> z, shape.y -> y
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2)); // shape x -> world z, extrusion -> -x
    g.translate(x + 0.035, 0, 0);
    b.add(g, 'panel');
    b.colMesh(g);
  }
  // side cross walls (z planes, from corridor wall to hull)
  const cross = [
    { z: -3.0, side: -1 }, { z: 0.4, side: -1 },             // living|bunk, bunk|storage
    { z: -4.6, side: 1 }, { z: -2.6, side: 1 }, { z: 0.6, side: 1 }, // bath|lift, lift|airlock, airlock|ls
  ];
  for (const c of cross) crossWall(b, c.z, c.side);

  // ---------- chunky rounded door / alcove frames with LED lines ----------
  for (const d of Object.values(DOORS)) doorFrame(b, d, d.axis === 'z' ? 0.05 : 0.045, d.hatch ? 'hullOrange' : 'frame', d.hatch ? 'ledAmber' : 'ledStrip');
  for (const a of ALCOVES) doorFrame(b, { axis: 'x', at: a.side * CORRIDOR_X, c: a.c, w: a.w, h: a.h, y0: a.y0, r: a.r }, 0.045, 'frame', 'ledStrip');

  // ---------- corridor vault, ribs, coves, padding; fillets in every room ----------
  const corr = buildCorridor(b, { doors: DOORS, alcoves: ALCOVES });
  buildRoomCoves(b, INSET);
  return { builder: b, lampsCorridor: corr.lamps };
}

function partitionZ(b, z, doors, M) {
  const outline = sectionAbove(z, DECK_Y, INSET - 0.01);
  const sh = shapeFromPts(outline);
  for (const d of doors) sh.holes.push(doorPath(d.c, d.w, d.h));
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1, curveSegments: 8 });
  g.translate(0, 0, z - 0.04);
  b.add(g, 'panel');
  b.colMesh(g);
}

function crossWall(b, z, side) {
  const xin = side * CORRIDOR_X;
  const pts = [];
  // from corridor wall outward along the floor, up the hull, back along the top to the corridor wall
  const xr = halfWidthAt(z, DECK_Y, INSET);
  const N = 40;
  const out = [];
  for (let i = 0; i <= N; i++) {
    const t = side > 0 ? (i / N) * (Math.PI / 2) : Math.PI - (i / N) * (Math.PI / 2);
    const p = sectionPoint(z, t, INSET - 0.01);
    if (p.y >= DECK_Y && Math.abs(p.x) >= CORRIDOR_X) out.push([p.x, p.y]);
  }
  const [, topIn] = heightRangeAt(z, xin, INSET);
  const poly = [[xin, DECK_Y], [side * xr, DECK_Y], ...out, [xin, topIn - 0.02]];
  const sh = shapeFromPts(poly);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, z - 0.03);
  b.add(g, 'panel');
  b.colMesh(g);
}
