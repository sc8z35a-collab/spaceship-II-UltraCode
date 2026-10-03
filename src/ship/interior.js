// Interior shell of B-29: inner pressure-hull wall, ribs, deck, partitions with door openings,
// corridor, ceiling trays and light fixtures. Rooms' furniture is added by rooms.js.
import * as THREE from 'three';
import { Builder, roundedRectPath, panelGeometry, rng } from './geom.js';
import { HULL, hullAt, sectionPoint, halfWidthAt, heightRangeAt, DECK_Y, LOWER_Y, Z_COCKPIT_BULK, Z_ENG_BULK, Z_REACTOR_BULK, CORRIDOR_X } from './hullShape.js';
import { loftGeometry, cutOpeningTris } from './exterior.js';
import { OPENINGS, inCanopy } from './hullShape.js';

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
  const R = rng(29);
  // ---------- inner hull wall (whole cabin + underfloor) ----------
  const z0 = HULL.zTip + 0.02, z1 = Z_REACTOR_BULK + 0.02;
  const inner = loftGeometry(z0, z1, 230, 140, INSET, true);
  b.add(inner, 'wall');
  // collision shell: lower resolution, open at the airlock hatch so EVA is possible
  b.colMesh(cutOpeningTris(loftGeometry(z0, z1, 120, 72, INSET, true), OPENINGS.find((o) => o.kind === 'hatch')));
  // nose cap closure inside (small dome) — the loft already closes near the tip
  // ---------- ribs (frames) every 0.8 m ----------
  for (let z = -11.6; z <= 9.2; z += 0.8) {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const t = -Math.PI / 2 + (i / 64) * Math.PI * 2;
      const p = sectionPoint(z, t, INSET - 0.005);
      pts.push([p.x, p.y]);
    }
    // split rib into upper (above deck) and lower parts with a gap at deck level
    const up = pts.filter((p) => p[1] > DECK_Y + 0.03);
    const lo = pts.filter((p) => p[1] < DECK_Y - 0.08);
    // break the upper rib where it would cross a window / the canopy
    const blocked = (p) => {
      const v = new THREE.Vector3(p[0], p[1], z);
      if (inCanopy(v)) return true;
      for (const o of OPENINGS) {
        const d = v.clone().sub(o.center);
        if (Math.abs(d.dot(o.normal)) > 0.5) continue;
        if (Math.abs(d.dot(o.u)) < o.halfW + 0.12 && Math.abs(d.dot(o.v)) < o.halfH + 0.12) return true;
      }
      return false;
    };
    let seg = [];
    for (const p of up) {
      if (blocked(p)) { if (seg.length > 3) b.add(ribGeometry(seg, 0.07, 0.06, z), 'frame'); seg = []; }
      else seg.push(p);
    }
    if (seg.length > 3) b.add(ribGeometry(seg, 0.07, 0.06, z), 'frame');
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
  // deck support beams below the floor
  for (let z = -10.8; z < 9.4; z += 1.2) {
    const hw = halfWidthAt(z, DECK_Y - 0.12, INSET) - 0.02;
    b.box(hw * 2, 0.12, 0.08, 'metalDark', [0, DECK_Y - 0.11, z], null, 0.01);
  }
  for (const x of [-1.3, 1.3]) b.box(0.08, 0.12, 19.0, 'metalDark', [x, DECK_Y - 0.11, -1.3], null, 0.01);

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
    sh.holes.push(roundedRectPath(0.7, 0.42, 0.18, 0, 1.25));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.18, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, z - 0.09);
    b.add(g, 'panelDark');
    b.colMesh(g);
    // viewport rim
    b.torus(0.43, 0.03, 'steel', [0, 1.25, z - 0.1], [0, 0, 0], 32);
    b.add(new THREE.RingGeometry(0.35, 0.5, 4, 1), 'plasticY', [0, 1.25, z - 0.1], [0, 0, Math.PI / 4]);
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
    if (side < 0) sh.holes.push(roundedRectPath(2.4, 1.7, 0.3, -1.3, DECK_Y + 0.95)); // bunk alcove opening
    else sh.holes.push(roundedRectPath(1.25, 2.05, 0.2, -3.75, DECK_Y + 1.03)); // lift alcove opening
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

  // ---------- door frames (trim) ----------
  for (const d of Object.values(DOORS)) doorTrim(b, d);

  // ---------- ceiling cable trays + light strips (corridor) ----------
  for (const side of [-1, 1]) {
    b.box(0.18, 0.05, zc1 - zc0 - 0.4, 'metalDark', [side * 0.42, 2.38, (zc0 + zc1) / 2], null, 0.01);
    for (let k = 0; k < 7; k++) {
      const off = side * 0.42 + (k - 3) * 0.022;
      b.cyl(0.009, 0.009, zc1 - zc0 - 0.5, k % 3 === 0 ? 'cableR' : k % 3 === 1 ? 'cable' : 'cableB', [off, 2.34, (zc0 + zc1) / 2], [Math.PI / 2, 0, 0], 5);
    }
  }
  const lampsC = [];
  for (let z = -7.6; z <= 4.8; z += 2.1) {
    b.box(0.5, 0.03, 0.12, 'lampCool', [0, 2.52, z], null, 0.01);
    b.box(0.56, 0.05, 0.18, 'frame', [0, 2.555, z], null, 0.01);
    lampsC.push(new THREE.Vector3(0, 2.4, z));
  }
  // corridor handrails along both walls
  for (const side of [-1, 1]) {
    b.pipe([side * (CORRIDOR_X - 0.07), 1.05, -8.2], [side * (CORRIDOR_X - 0.07), 1.05, -5.2], 0.018, 'handrail', 8, false);
    b.pipe([side * (CORRIDOR_X - 0.07), 1.05, 3.9], [side * (CORRIDOR_X - 0.07), 1.05, 5.4], 0.018, 'handrail', 8, false);
  }
  return { builder: b, lampsCorridor: lampsC };
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

function doorTrim(b, d) {
  // rounded frame around the opening, both sides
  const w = d.w + 0.06, h = d.h + 0.06;
  const pts = [];
  const r = 0.24;
  const path = roundedRectPath(w, h, r, 0, 0);
  const sp = path.getSpacedPoints(64);
  for (const side of [-1, 1]) {
    const pts3 = sp.map((p) => {
      if (d.axis === 'z') return new THREE.Vector3(d.c + p.x, DECK_Y + d.h / 2 + p.y, d.at + side * 0.055);
      return new THREE.Vector3(d.at + side * 0.06, DECK_Y + d.h / 2 + p.y, d.c + p.x);
    });
    b.tube(pts3, 0.028, d.hatch ? 'hullOrange' : 'frame', { closed: true, seg: 96, radial: 6 });
  }
}
