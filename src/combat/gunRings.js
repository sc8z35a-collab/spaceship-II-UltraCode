// H8's gun rings. Two rails run right round the sphere, one on each hemisphere, raised on pylons
// above the armour; the turrets ride round them on motorised carriages, so the guns are brought
// to bear in any direction without H8 having to turn:
//   the upper ring (30° north): the port twin 25 mm — from it, everything from straight up to
//     well below the equator can be reached;
//   the lower ring (45° south): a tandem carriage with the starboard twin 25 mm and the railgun —
//     everything from straight down to well above the equator.
// A carriage runs to the bearing of what its guns are on (the turret's own yaw takes the rest, its
// cradle elevates from well below its own horizon to past the vertical), at up to 80°/s.
// The rail is an I-section with a toothed rack and a lit guide strip; the carriages are sleds
// that wrap the rail on rollers, driven by a motor through a pinion on the rack.
//
// Everything here is in H8's own frame (+Y up, -Z forward, +X starboard; azimuth 0 = forward,
// + = starboard).
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';
import { H8 } from '../h8/h8Spec.js';

const DEG = Math.PI / 180;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** the rings: latitude, the rail centre's height above the armour (m), where the carriage waits
 * (azimuth, rad) */
export const RINGS = [
  { lat: 30 * DEG, h: 0.34, park: -50 * DEG },
  { lat: -45 * DEG, h: 0.34, park: 50 * DEG },
];
/** a carriage's top speed (rad/s) and acceleration (rad/s^2) along its ring */
export const CARRIAGE = { vMax: 80 * DEG, aMax: 190 * DEG };
/** where a turret's base sits above the rail centre (the carriage's deck) */
export const DECK = 0.11;

const RAIL = { hw: 0.075, hh: 0.045, fl: 0.016, web: 0.012 };   // I-section: half width, half height, flange, half web

/** the ring's radius about H8's axis and its height (rail centre) */
export function ringCircle(ring) {
  const r = H8.R + ring.h;
  return { rad: r * Math.cos(ring.lat), y: r * Math.sin(ring.lat) };
}

/**
 * The frame on a ring at azimuth th: p (the rail centre), n (out from H8's centre), t (along the
 * ring, toward + azimuth), b (across it: n x t) and the turret frame f { x, y, z } (up = n, the
 * barrels at rest along the ring)
 */
export function ringFrame(ring, th, o = {}) {
  const cl = Math.cos(ring.lat), sl = Math.sin(ring.lat), s = Math.sin(th), c = Math.cos(th);
  const n = (o.n || (o.n = new THREE.Vector3())).set(cl * s, sl, -cl * c);
  const t = (o.t || (o.t = new THREE.Vector3())).set(c, 0, s);
  const b = (o.b || (o.b = new THREE.Vector3())).crossVectors(n, t);
  (o.p || (o.p = new THREE.Vector3())).copy(n).multiplyScalar(H8.R + ring.h);
  const f = o.f || (o.f = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() });
  f.x.copy(b).negate(); f.y.copy(n); f.z.copy(t).negate();
  return o;
}

/** the shortest signed angle from a to b */
export function dAng(a, b) { let d = b - a; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; return d; }

/** a basis matrix at p */
function basis(f, p) { return new THREE.Matrix4().makeBasis(f.x, f.y, f.z).setPosition(p); }

/** a box along a segment p0 -> p1 (w across, d deep) */
function strut(b, p0, p1, w, d, key) {
  const dir = p1.clone().sub(p0), L = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.normalize());
  b.pushM(new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), q, V(1, 1, 1)));
  b.box(w, L, d, key, [0, 0, 0], null, Math.min(w, d) * 0.2);
  b.pop();
}

/**
 * A ring: the rail (an I-section turned round H8's axis, face by face so its edges stay crisp),
 * the rack's teeth, the lit guide strip and the pylons down to the armour. avoid: azimuths (rad)
 * kept clear of pylons
 */
export function buildRing(M, ring, { lowq = false, avoid = [] } = {}) {
  const b = new Builder();
  const { rad, y } = ringCircle(ring);
  const cl = Math.cos(ring.lat), sl = Math.sin(ring.lat);
  // (radius, height) of a point of the section: u out along n, v across along b
  const nr = [cl, sl], br = [sl, -cl];
  const at = (u, v) => new THREE.Vector2(rad + u * nr[0] + v * br[0], y + u * nr[1] + v * br[1]);
  const seg = lowq ? 120 : 240;
  const face = (pts, key) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const g = new THREE.LatheGeometry([at(...pts[i]), at(...pts[i + 1])], seg);
      b.add(g, key);
    }
  };
  const { hw, hh, fl, web } = RAIL;
  // the I: top flange, web, bottom flange (outline, each edge its own strip)
  face([[hh, -hw], [hh, hw]], 'ringRail');
  face([[hh, hw], [hh - fl, hw]], 'ringRail');
  face([[hh - fl, hw], [hh - fl, web]], 'ringRail');
  face([[hh - fl, web], [-hh + fl, web]], 'gunDark');
  face([[-hh + fl, web], [-hh + fl, hw]], 'ringRail');
  face([[-hh + fl, hw], [-hh, hw]], 'ringRail');
  face([[-hh, hw], [-hh, -hw]], 'ringRail');
  face([[-hh, -hw], [-hh + fl, -hw]], 'ringRail');
  face([[-hh + fl, -hw], [-hh + fl, -web]], 'ringRail');
  face([[-hh + fl, -web], [hh - fl, -web]], 'gunDark');
  face([[hh - fl, -web], [hh - fl, -hw]], 'ringRail');
  face([[hh - fl, -hw], [hh, -hw]], 'ringRail');
  // the lit guide strip down the top of the rail (and its twin under the bottom flange)
  face([[hh + 0.0015, -0.008], [hh + 0.0015, 0.008]], 'ringGlow');
  face([[-hh - 0.0015, 0.008], [-hh - 0.0015, -0.008]], 'ringGlow');
  // the rack: teeth along the outer edge of the top flange (the pinion runs on them)
  const fr = {};
  if (!lowq) {
    const n = Math.round(2 * Math.PI * rad / 0.05);
    for (let k = 0; k < n; k++) {
      const th = k / n * Math.PI * 2;
      ringFrame(ring, th, fr);
      b.pushM(basis(fr.f, fr.p));
      b.box(0.034, 0.012, 0.018, 'ringRail', [-(hw - 0.02), hh + 0.006, 0], null, 0.002);
      b.pop();
    }
  }
  // pylons: a post and a pair of braces down to a foot on the armour, every 15° or so
  const np = 24;
  for (let k = 0; k < np; k++) {
    const th = (k + 0.5) / np * Math.PI * 2;
    if (avoid.some((a) => Math.abs(dAng(a, th)) < 6 * DEG)) continue;
    ringFrame(ring, th, fr);
    const { p, n, b: bb } = fr;
    const top = p.clone().addScaledVector(n, -hh);
    const foot = n.clone().multiplyScalar(H8.R - 0.01);
    strut(b, foot, top, 0.07, 0.11, 'gunDark');
    for (const s of [-1, 1]) strut(b, foot.clone().addScaledVector(bb, s * 0.2), top.clone().addScaledVector(bb, s * 0.05), 0.035, 0.05, 'gunMetal');
    b.pushM(basis(fr.f, foot));
    b.box(0.46, 0.025, 0.2, 'gunDark', [0, 0.0125, 0], null, 0.008);
    if (!lowq) for (const sx of [-0.19, 0.19]) for (const sz of [-0.07, 0.07]) b.cyl(0.012, 0.014, 0.016, 'gunMetal', [sx, 0.03, sz], null, 6);
    b.pop();
  }
  const g = b.build(M, { castShadow: false });
  g.name = 'gunRing';
  return g;
}

/**
 * A carriage sled for one turret (its own frame: up out of the rail, z along it): a deck over
 * the rail, cheeks down its sides with rollers above and below the flanges, the drive motor with
 * its pinion on the rack, bumpers striped at both ends, a lamp. The turret stands on the deck
 * (DECK above the rail centre)
 */
export function buildSled(M, { lowq = false } = {}) {
  const b = new Builder();
  const { hw, hh } = RAIL;
  b.box(0.42, 0.05, 0.62, 'gunMetal', [0, DECK - 0.025, 0], null, 0.012);
  for (const s of [-1, 1]) {
    b.box(0.03, 0.22, 0.54, 'gunDark', [s * (hw + 0.03), -0.0, 0], null, 0.006);
    // rollers on the flanges, above and below
    for (const z of [-0.19, 0.19]) {
      b.cyl(0.026, 0.026, 0.05, 'steel', [s * (hw - 0.025), hh + 0.026, z], [0, 0, Math.PI / 2], lowq ? 8 : 14);
      b.cyl(0.026, 0.026, 0.05, 'steel', [s * (hw - 0.025), -hh - 0.026, z], [0, 0, Math.PI / 2], lowq ? 8 : 14);
    }
    // bumpers, striped
    b.box(0.44, 0.06, 0.03, 'hazard', [0, DECK - 0.03, s * 0.325], null, 0.008);
  }
  // the drive: motor can on the outer cheek, its gearbox and the pinion down on the rack
  b.cyl(0.055, 0.055, 0.16, 'gunDark', [-(hw + 0.11), 0.02, 0.08], [Math.PI / 2, 0, 0], lowq ? 10 : 18);
  b.box(0.08, 0.1, 0.1, 'gunMetal', [-(hw + 0.1), 0.02, -0.04], null, 0.01);
  b.cyl(0.03, 0.03, 0.025, 'steel', [-(hw - 0.02), hh + 0.03, -0.04], [0, 0, Math.PI / 2], 12);
  // power and data: a cable loop into the deck
  if (!lowq) b.tube([[-(hw + 0.11), 0.07, 0.16], [-(hw + 0.09), 0.12, 0.2], [-(hw + 0.02), DECK + 0.005, 0.22]], 0.012, 'cable', { radial: 6 });
  b.sphere(0.022, 'sledLamp', [hw + 0.06, DECK + 0.01, -0.26], 8);
  const g = b.build(M, { castShadow: false });
  g.name = 'gunSled';
  return g;
}

/** the bar that ties the lower ring's two sleds together (length along z) */
export function buildLink(M, len) {
  const b = new Builder();
  b.box(0.16, 0.05, len, 'gunDark', [0, DECK - 0.03, 0], null, 0.01);
  b.box(0.12, 0.012, len - 0.1, 'hazard', [0, DECK - 0.004, 0], null, 0.003);
  const g = b.build(M, { castShadow: false });
  g.name = 'gunLink';
  return g;
}

/** a carriage's run along its ring: toward a bearing, at its top speed, braking in time */
export class Carriage {
  constructor(ring, th = ring.park) {
    this.ring = ring;
    this.th = th;
    this.w = 0;              // rad/s
    this.want = th;
  }

  /** dt seconds toward azimuth `want` (null: back to its parking place); lim: [from, to] arc it
   * must keep to (or null) */
  step(dt, want, lim = null) {
    let w = want == null ? this.ring.park : want;
    if (lim) w = clampArc(w, lim);
    this.want = w;
    const d = dAng(this.th, w);
    const C = CARRIAGE;
    // the speed that still stops on the bearing, then the drive's acceleration toward it
    const vDes = Math.sign(d) * Math.min(C.vMax, Math.sqrt(2 * C.aMax * Math.abs(d)));
    const dv = Math.max(-C.aMax * dt, Math.min(C.aMax * dt, vDes - this.w));
    this.w += dv;
    if (Math.abs(d) < 1e-4 && Math.abs(this.w) < 0.02) { this.w = 0; this.th = w; }
    else this.th += this.w * dt;
    if (lim) this.th = clampArc(this.th, lim);
    this.th -= Math.round(this.th / (2 * Math.PI)) * 2 * Math.PI;
  }
}

/** an azimuth kept inside an arc [a, b] (going + from a): the nearer end if outside */
function clampArc(x, [a, b]) {
  const span = dAng(a, b) < 0 ? dAng(a, b) + 2 * Math.PI : dAng(a, b);
  let off = x - a;
  off -= Math.floor(off / (2 * Math.PI)) * 2 * Math.PI;
  if (off <= span) return x;
  return off - span < 2 * Math.PI - off ? b : a;
}
