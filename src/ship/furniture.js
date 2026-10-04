// Built-in furniture that follows the curved pressure hull (no square boxes against round walls):
// hull-hugging cabinets with rounded fronts and pillowed ends, door seams, handles and labels.
import * as THREE from 'three';
import { halfWidthAt } from './hullShape.js';
import { HULL } from './hullShape.js';
import { loft, roundPolygon } from './sweep.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Cabinet whose back follows the inner hull between heights yB..yT and whose front is the hull
 * curve brought inward by `depth`. Front edges are rounded with radius r, the two ends with endR.
 * doors: number of door leaves along z (seams + handles); shelves: horizontal seams.
 */
export function hullCabinet(b, o) {
  const { side, z0, z1, yB = 0, yT, depth, key = 'panel', r = 0.07, endR = 0.045, inset = HULL.inset, doors = 0, rows = 1, handleKey = 'steel', col = true } = o;
  const N = 12;
  const section = (z, dep, y0, y1) => {
    const back = [], front = [];
    for (let i = 0; i <= N; i++) {
      const y = y0 + (y1 - y0) * (i / N);
      const xb = halfWidthAt(z, y, inset) + 0.012;
      back.push([side * xb, y]);
      front.push([side * (xb - dep), y]);
    }
    const poly = [...front, ...back.reverse()];
    const radii = poly.map((p, i) => (i === 0 || i === N ? r : 0));
    return roundPolygon(poly, radii, 4);
  };
  // the count of points must match between sections: corners always produce seg+1 points
  const sections = [];
  const steps = 4;
  const len = z1 - z0;
  const pillow = (k) => { const ph = (Math.PI / 2) * (k / steps); return { dz: endR * (1 - Math.sin(ph)), sh: endR * (1 - Math.cos(ph)) }; };
  const push = (z, sh) => sections.push(section(z, depth - sh, yB + (yB > 0.005 ? sh : 0), yT - sh).map(([x, y]) => V(x, y, z)));
  // sections must run monotonically in z: from the rounded z0 end (shrunk) to full size, along the
  // middle, then back down to the rounded z1 end (pillow(k) goes from full size at k=0 to shrunk)
  for (let k = steps; k >= 0; k--) { const { dz, sh } = pillow(k); push(z0 + dz, sh); }
  const nMid = Math.max(1, Math.ceil((len - 2 * endR) / 0.3));
  for (let j = 1; j < nMid; j++) push(z0 + endR + (len - 2 * endR) * (j / nMid), 0);
  for (let k = 0; k <= steps; k++) { const { dz, sh } = pillow(k); push(z1 - dz, sh); }
  b.add(loft(sections, { ring: true, caps: true }), key);
  // door seams, shelves and handles on the curved front
  const frontAt = (z, y) => V(side * (halfWidthAt(z, y, inset) + 0.012 - depth - 0.002), y, z);
  const yA = yB + 0.06, yZ = yT - 0.06;
  const seamCurve = (z) => { const pts = []; for (let i = 0; i <= 10; i++) pts.push(frontAt(z, yA + (yZ - yA) * (i / 10))); return pts; };
  if (doors > 1) for (let i = 1; i < doors; i++) b.tube(seamCurve(z0 + len * (i / doors)), 0.0045, 'black', { radial: 4, seg: 12 });
  for (let j = 1; j < rows; j++) {
    // shelf seam: follows the curved front along z (a straight chord would float off it)
    const y = yB + (yT - yB) * (j / rows), n = Math.max(2, Math.ceil(len / 0.15)), pts = [];
    for (let i = 0; i <= n; i++) pts.push(frontAt(z0 + endR + (len - 2 * endR) * (i / n), y));
    b.tube(pts, 0.0045, 'black', { radial: 4, seg: n * 2 });
  }
  if (doors > 0) {
    for (let i = 0; i < doors; i++) for (let j = 0; j < rows; j++) {
      const zc = z0 + len * ((i + (i % 2 ? 0.25 : 0.75)) / doors);
      const yc = yB + (yT - yB) * ((j + 0.5) / rows);
      const p = frontAt(zc, yc);
      const n = V(-side, 0, 0);
      b.pipe(p.clone().addScaledVector(n, 0.025).add(V(0, -0.07, 0)), p.clone().addScaledVector(n, 0.025).add(V(0, 0.07, 0)), 0.008, handleKey, 8);
      for (const dy of [-0.07, 0.07]) b.pipe(p.clone().add(V(0, dy, 0)), p.clone().addScaledVector(n, 0.026).add(V(0, dy, 0)), 0.006, handleKey, 6);
    }
  }
  if (col) {
    const xb = halfWidthAt((z0 + z1) / 2, (yB + yT) / 2, inset);
    const xf = xb - depth;
    b.colBox(depth, yT - yB, len, [side * (xf + depth / 2), (yB + yT) / 2, (z0 + z1) / 2]);
  }
  return { frontAt };
}

/** padded wall cushions laid on the curved hull (rows x cols), facing into the room */
export function hullPadding(b, { side, z0, z1, yB, yT, cols = 2, rows = 2, key = 'wallPad', inset = HULL.inset, gap = 0.04, thick = 0.045 }) {
  const w = (z1 - z0) / cols, h = (yT - yB) / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const zc = z0 + w * (i + 0.5), yc = yB + h * (j + 0.5);
    // tangent frame of the hull at the cushion centre
    const x0 = halfWidthAt(zc, yc - 0.05, inset), x1 = halfWidthAt(zc, yc + 0.05, inset);
    const tilt = Math.atan2(x0 - x1, 0.1);   // how much the wall leans inward
    const x = side * (halfWidthAt(zc, yc, inset) - thick / 2 + 0.006);
    b.push([x, yc, zc], [0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0]);
    b.push([0, 0, 0], [tilt, 0, 0]);
    b.add(cushionShape(w - gap, h - gap, thick), key);
    b.pop(); b.pop();
  }
}

function cushionShape(w, h, t) {
  const bv = Math.min(t * 0.45, 0.022);
  const s = new THREE.Shape();
  const pts = roundPolygon([[-w / 2 + bv, -h / 2 + bv], [w / 2 - bv, -h / 2 + bv], [w / 2 - bv, h / 2 - bv], [-w / 2 + bv, h / 2 - bv]], 0.05, 4);
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.002, t - 2 * bv), bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -(t - 2 * bv) / 2);
  return g;
}
