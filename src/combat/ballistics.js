// Ballistics: a small, self-contained engine for unguided projectiles — shells, bullets, railgun
// slugs — fired between moving vessels, in orbit or in the air. It knows nothing of the game: give
// it a projectile, a gun, a muzzle and an aim, and it flies the round; give it a shooter and a
// target track, and its fire control works out where to aim and how likely a hit is.
//
//   The flight: the round is integrated in an inertial frame (Heun / velocity-Verlet with
//   sub-steps) under the planet's gravity — central field, optionally the J2 term of its
//   oblateness — and, inside the atmosphere, aerodynamic drag against the air turning with the
//   planet, with a drag coefficient that changes with the Mach number (a G7-type curve; the
//   speed of sound and the density follow a standard atmosphere). In orbit the round and its
//   target fall together: over a long flight what matters is the difference in gravity along the
//   way (a few metres at 30 km), which the integration carries without any special treatment.
//
//   The gun: every round leaves with the barrel's own scatter and the ammunition's (round to
//   round, normally distributed, in milliradians), with its muzzle velocity a little off (the
//   propellant lot, its temperature), a barrel that scatters more as it heats in a long burst, and
//   the turret's servo jitter. A round runs out at its self-destruct time.
//
//   The fire control: it tracks the target (position, velocity, and its acceleration through a
//   filter: what the target is doing now, not what it will do), then solves the shot by
//   simulation — the shooting method: aim, fly the round and the predicted target together with
//   the same physics, measure the miss at the closest approach, correct the aim, repeat. Its
//   odds of a hit come from the error budget at the target — round-to-round dispersion and
//   muzzle-velocity spread (independent from round to round), tracking errors and the target's
//   unpredictable manoeuvring over the time of flight (shared by a whole burst) — against the
//   size the target presents (Carlton's diffuse-Gaussian model, summed over a burst).
//
// Everything random comes from seeded generators (xoshiro128**): the same seed, the same inputs
// give the same rounds — runs can be replayed exactly. Vectors are three.js Vector3 (metres,
// seconds, kilograms).
import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// the planet
/** Earth (the polar axis is +Y, as in this game's inertial frame) */
export const EARTH = { mu: 3.986004418e14, R: 6371000, Req: 6378137, J2: 1.08262668e-3, omega: 7.2921159e-5, atmTop: 1.0e6 };

// a standard atmosphere, piecewise exponential (US 1976 to 86 km, then the thermosphere)
const ATM = [
  [0, 1.225, 7249], [25000, 3.899e-2, 6349], [30000, 1.774e-2, 6682], [40000, 3.972e-3, 7554],
  [50000, 1.057e-3, 8382], [60000, 3.206e-4, 7714], [70000, 8.770e-5, 6549], [80000, 1.905e-5, 5799],
  [90000, 3.396e-6, 5382], [100000, 5.297e-7, 5877], [110000, 9.661e-8, 7263], [120000, 2.438e-8, 9473],
  [130000, 8.484e-9, 12636], [140000, 3.845e-9, 16149], [150000, 2.070e-9, 22523], [180000, 5.464e-10, 29740],
  [200000, 2.789e-10, 37105], [250000, 7.248e-11, 45546], [300000, 2.418e-11, 53628], [350000, 9.518e-12, 53298],
  [400000, 3.725e-12, 58515], [450000, 1.585e-12, 60828], [500000, 6.967e-13, 63822], [600000, 1.454e-13, 71835],
  [700000, 3.614e-14, 88667], [800000, 1.170e-14, 124640], [900000, 5.245e-15, 181050], [1000000, 3.019e-15, 268000],
];

/** air density (kg/m^3) at an altitude (m) */
export function airDensity(h) {
  if (h > 1.0e6) return 0;
  if (h < 0) h = 0;
  let i = ATM.length - 1;
  while (i > 0 && ATM[i][0] > h) i--;
  return ATM[i][1] * Math.exp(-(h - ATM[i][0]) / ATM[i][2]);
}

/** the speed of sound (m/s) at an altitude (m) */
export function speedOfSound(h) {
  if (h < 11000) return 340.3 - 0.0039 * h;
  if (h < 20000) return 295.1;
  if (h < 47000) return 295.1 + (h - 20000) * 0.00148;
  if (h < 71000) return 335.1 - (h - 47000) * 0.0011;
  return 290;
}

/** drag coefficient against the Mach number: a G7-type curve (boat-tailed, pointed projectiles) */
export function dragCoef(M) {
  if (M < 0.8) return 0.12;
  if (M < 1.0) return 0.12 + (M - 0.8) * 1.0;          // the transonic rise
  if (M < 1.2) return 0.32 + (M - 1.0) * 0.2;          // the peak
  return Math.max(0.16, 0.36 - (M - 1.2) * 0.045);      // falling away, supersonic
}

// ---------------------------------------------------------------------------------------------
// random numbers that can be replayed
const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** xoshiro128** seeded through splitmix32; normal() by the polar method */
export class Rng {
  constructor(seed = 1) {
    let s = seed >>> 0;
    const sm = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = sm(); this.b = sm(); this.c = sm(); this.d = sm();
    this.spare = null;
  }

  u32() {
    const r = Math.imul(rotl(Math.imul(this.b, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.b << 9) >>> 0;
    this.c = (this.c ^ this.a) >>> 0; this.d = (this.d ^ this.b) >>> 0;
    this.b = (this.b ^ this.c) >>> 0; this.a = (this.a ^ this.d) >>> 0;
    this.c = (this.c ^ t) >>> 0; this.d = rotl(this.d, 11);
    return r;
  }

  /** uniform in [0, 1) */
  next() { return this.u32() / 4294967296; }

  /** standard normal */
  normal() {
    if (this.spare !== null) { const s = this.spare; this.spare = null; return s; }
    let u, v, s;
    do { u = this.next() * 2 - 1; v = this.next() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    this.spare = v * m;
    return u * m;
  }
}

/** a 32-bit seed from a name (and a number): stable between runs */
export function seedOf(name, n = 0) {
  let h = 2166136261 ^ n;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------------------------------------
// projectiles and guns
/**
 * Ammunition: mass (kg), cal (calibre, m), v0 (muzzle velocity, m/s), vSigma (its spread, m/s),
 * sigma (the round's own scatter, mrad, 1 sd), cdK (drag scale against the G7 curve), life (s:
 * self-destruct), tracer (s: how long its tracer burns), maxRange (m: what the fire control will
 * engage at)
 */
export const AMMO = {
  // H8's twin 25 mm cannon: high-explosive / tracer, long-barrel high-velocity
  c25: { name: '25mm HEI-T', mass: 0.22, cal: 0.025, v0: 1900, vSigma: 3.5, sigma: 0.42, cdK: 1.0, life: 17, tracer: 5.5, maxRange: 30000 },
  // B-29's old debris-defence gun and the stations' point-defence guns
  p30: { name: '30mm PD', mass: 0.36, cal: 0.030, v0: 1500, vSigma: 4.5, sigma: 0.7, cdK: 1.05, life: 9, tracer: 4, maxRange: 6000 },
  // the hunter drones' 20 mm cannon
  d20: { name: '20mm', mass: 0.1, cal: 0.020, v0: 1650, vSigma: 5, sigma: 0.9, cdK: 1.1, life: 6, tracer: 3, maxRange: 4000 },
  // H8's railgun: a 1.2 kg tungsten slug at 9 km/s (it glows from the launch for the first moments)
  rail: { name: 'レール弾', mass: 1.2, cal: 0.03, v0: 9000, vSigma: 18, sigma: 0.05, cdK: 0.9, life: 4.2, tracer: 1.4, maxRange: 30000 },
};

/**
 * Guns: rof (rounds/s), sigma (barrel scatter, mrad), heatK (extra scatter per round still warm in
 * the barrel, mrad), coolT (s: how fast it cools), jitter (servo jitter of the mount, mrad),
 * slew (rad/s)
 */
export const GUNS = {
  twin25: { name: '25mm 連装機関砲', rof: 12, sigma: 0.32, heatK: 0.012, coolT: 6, jitter: 0.08, slew: 2.2 },
  rail: { name: 'レールガン', rof: 0.3, sigma: 0.04, heatK: 0.02, coolT: 10, jitter: 0.03, slew: 1.2 },
  pd30: { name: '30mm 防衛機銃', rof: 8, sigma: 0.55, heatK: 0.02, coolT: 5, jitter: 0.15, slew: 1.8 },
  drone20: { name: '20mm 機関砲', rof: 9, sigma: 0.8, heatK: 0.03, coolT: 4, jitter: 0.3, slew: 2.6 },
};

// ---------------------------------------------------------------------------------------------
// the environment: what pushes a round about
const _a = new THREE.Vector3(), _a0 = new THREE.Vector3(), _a1 = new THREE.Vector3(), _vt = new THREE.Vector3(), _va = new THREE.Vector3();

export class Env {
  /** body: the planet; j2: its oblateness too; drag: the air */
  constructor({ body = EARTH, j2 = false, drag = true } = {}) {
    this.body = body; this.j2 = j2; this.drag = drag;
  }

  /** gravity at p (out) */
  gravity(p, out) {
    const B = this.body;
    const r2 = p.x * p.x + p.y * p.y + p.z * p.z, r = Math.sqrt(r2);
    const k = -B.mu / (r2 * r);
    out.set(p.x * k, p.y * k, p.z * k);
    if (this.j2) {
      // the planet's flattening (polar axis +Y)
      const f = -1.5 * B.J2 * B.mu * B.Req * B.Req / (r2 * r2 * r), q = (p.y * p.y) / r2;
      out.x += f * p.x * (1 - 5 * q);
      out.z += f * p.z * (1 - 5 * q);
      out.y += f * p.y * (3 - 5 * q);
    }
    return out;
  }

  /** the air's density where p is (0 above the atmosphere) */
  density(p) {
    if (!this.drag) return 0;
    const h = p.length() - this.body.R;
    return h > this.body.atmTop ? 0 : airDensity(h);
  }

  /** the acceleration of a round of ammunition `am` at p with velocity v (out) */
  accel(p, v, am, out) {
    this.gravity(p, out);
    if (!this.drag || !am) return out;
    const h = p.length() - this.body.R;
    if (h > 2.0e5) return out;                        // above ~200 km the air no longer matters
    const rho = airDensity(h);
    // through the air, which turns with the planet
    const w = this.body.omega;
    _va.set(v.x - w * p.z, v.y, v.z + w * p.x);
    const s = _va.length();
    if (s < 1e-6) return out;
    const A = Math.PI * am.cal * am.cal / 4;
    const k = -0.5 * rho * dragCoef(s / speedOfSound(h)) * am.cdK * A / am.mass * s;
    out.x += k * _va.x; out.y += k * _va.y; out.z += k * _va.z;
    return out;
  }

  /** the step the integration needs where p is (s): in vacuum gravity alone changes slowly
   * enough for long steps; in the air the drag needs short ones */
  maxStep(p) {
    const h = p.length() - this.body.R;
    if (!this.drag || h > 2.0e5) return 0.25;
    return h > 1.0e5 ? 1 / 30 : h > 4.0e4 ? 1 / 90 : 1 / 240;
  }
}

/** the default environment: central gravity and the air (no J2 — as the rest of this game) */
export const ENV = new Env();

// ---------------------------------------------------------------------------------------------
// a round in flight
/**
 * Fire a round. am: ammunition, gun: the gun (or null), muzzle (pos), baseVel (the gun's own
 * velocity), dir (where it is aimed, unit), rng: the gun's generator, o: { heat (rounds still
 * warm in the barrel), disp (a multiplier on the scatter: a damaged fire control) }
 */
export function launch(am, gun, muzzle, baseVel, dir, rng, o = {}) {
  const heat = o.heat || 0;
  const g = gun || { sigma: 0, heatK: 0, jitter: 0 };
  const sig = Math.sqrt(am.sigma * am.sigma + g.sigma * g.sigma + g.jitter * g.jitter) * 1e-3 * (o.disp || 1) + g.heatK * 1e-3 * heat;
  const u = _vt.copy(Math.abs(dir.y) < 0.9 ? Y : X).cross(dir).normalize();
  const w = _va.crossVectors(dir, u);
  const d = dir.clone().addScaledVector(u, rng.normal() * sig).addScaledVector(w, rng.normal() * sig).normalize();
  const v0 = am.v0 + rng.normal() * am.vSigma;
  return { am, pos: muzzle.clone(), prev: muzzle.clone(), vel: baseVel.clone().addScaledVector(d, v0), dir: d, t: 0, life: am.life };
}
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

/** fly a round on by dt (Heun / velocity-Verlet, in sub-steps as fine as the air needs) */
export function step(r, dt, env = ENV) {
  r.prev.copy(r.pos);
  advance(r.pos, r.vel, dt, r.am, env);
  r.t += dt;
  return r;
}

/** move a body (p, v) on by dt under env's forces (am: its ammunition for the drag, or null; acc:
 * a constant acceleration of its own, or null) */
export function advance(p, v, dt, am, env = ENV, acc = null) {
  const n = Math.max(1, Math.ceil(dt / env.maxStep(p) - 1e-9));
  const h = dt / n;
  for (let k = 0; k < n; k++) {
    env.accel(p, v, am, _a0);
    if (acc) _a0.add(acc);
    p.x += v.x * h + 0.5 * _a0.x * h * h; p.y += v.y * h + 0.5 * _a0.y * h * h; p.z += v.z * h + 0.5 * _a0.z * h * h;
    _vt.copy(v).addScaledVector(_a0, h);
    env.accel(p, _vt, am, _a1);
    if (acc) _a1.add(acc);
    v.x += 0.5 * (_a0.x + _a1.x) * h; v.y += 0.5 * (_a0.y + _a1.y) * h; v.z += 0.5 * (_a0.z + _a1.z) * h;
  }
}

// ---------------------------------------------------------------------------------------------
// fire control
const _rp = new THREE.Vector3(), _rv = new THREE.Vector3(), _tp = new THREE.Vector3(), _tv = new THREE.Vector3(), _rel = new THREE.Vector3(), _prevRel = new THREE.Vector3();

/**
 * Straight-line lead: where to aim a round of speed s from (P0, V0) at (P, V) with acceleration A
 * (in the frame moving with the shooter; gravity left out). The direction (unit, with .t: the
 * time of flight), or null
 */
export function leadDir(P0, V0, P, V, s, out = new THREE.Vector3(), A = null) {
  const rx = P.x - P0.x, ry = P.y - P0.y, rz = P.z - P0.z;
  const vx = V.x - V0.x, vy = V.y - V0.y, vz = V.z - V0.z;
  const a = vx * vx + vy * vy + vz * vz - s * s, b = 2 * (rx * vx + ry * vy + rz * vz), c = rx * rx + ry * ry + rz * rz;
  let t;
  if (Math.abs(a) < 1e-6) t = -c / Math.min(-1e-6, b);
  else {
    const D = b * b - 4 * a * c;
    if (D < 0) return null;
    const sq = Math.sqrt(D);
    const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
    t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  }
  if (!(t > 0)) return null;
  if (A && (A.x * A.x + A.y * A.y + A.z * A.z) > 1e-6) {
    for (let k = 0; k < 6; k++) {
      const h = 0.5 * t * t;
      t = Math.hypot(rx + vx * t + A.x * h, ry + vy * t + A.y * h, rz + vz * t + A.z * h) / s;
    }
    const h = 0.5 * t * t;
    out.set(rx + vx * t + A.x * h, ry + vy * t + A.y * h, rz + vz * t + A.z * h).normalize();
  } else out.set(rx + vx * t, ry + vy * t, rz + vz * t).normalize();
  out.t = t;
  return out;
}

/**
 * Fly a round (no scatter) and the predicted target together until the round has passed it:
 * { t (closest approach), miss (vector: round - target there), dist (the round's path length) }
 */
export function flyout(from, fromVel, dir, am, tPos, tVel, tAcc, env = ENV, maxT = am.life) {
  _rp.copy(from); _rv.copy(fromVel).addScaledVector(dir, am.v0);
  _tp.copy(tPos); _tv.copy(tVel);
  // the step: some 60 over the expected flight (never more than ~600 for the longest)
  const guess = Math.max(0.05, tPos.distanceTo(from) / am.v0);
  const h = Math.min(0.1, Math.max(0.004, guess / 60, maxT / 600));
  let t = 0, best = Infinity, bestT = 0;
  const miss = new THREE.Vector3(), atBest = new THREE.Vector3(), beforeBest = new THREE.Vector3();
  _prevRel.copy(_rp).sub(_tp);
  // the closest approach on a stretch between two samples (the relative motion is all but straight
  // over one step)
  const refine = (P0, P1, t0) => {
    const seg = _vt.copy(P1).sub(P0), L2 = seg.lengthSq();
    if (L2 < 1e-12) return;
    const s = Math.max(0, Math.min(1, -P0.dot(seg) / L2));
    const mx = P0.x + seg.x * s, my = P0.y + seg.y * s, mz = P0.z + seg.z * s;
    const m = Math.sqrt(mx * mx + my * my + mz * mz);
    if (m < best) { best = m; bestT = t0 + s * h; miss.set(mx, my, mz); }
  };
  while (t < maxT) {
    advance(_rp, _rv, h, am, env);
    advance(_tp, _tv, h, null, env, tAcc);
    t += h;
    _rel.copy(_rp).sub(_tp);
    const d = _rel.length();
    if (d < best) { best = d; bestT = t; miss.copy(_rel); atBest.copy(_rel); beforeBest.copy(_prevRel); }
    else if (t > guess * 0.5) {
      // passed it: the closest approach lies on one of the two stretches either side of the
      // nearest sample
      const tb = bestT;
      refine(beforeBest, atBest, tb - h);
      refine(atBest, _rel, tb);
      break;
    }
    _prevRel.copy(_rel);
  }
  // (the length of its path relative to the shooter: what an aim correction turns through)
  return { t: bestT, miss, dist: am.v0 * bestT };
}

/**
 * Solve a shot by simulation. o: { from, fromVel, tPos, tVel, tAcc (the target's own
 * acceleration, as tracked), am, env, dir0 (a guess: the last solution), iters, tol (m) }
 * Returns { dir, tof, miss (m left after the iterations), ok } or null (out of reach)
 */
export function solveAim(o) {
  const am = o.am, env = o.env || ENV;
  let dir = o.dir0 ? o.dir0.clone() : leadDir(o.from, o.fromVel, o.tPos, o.tVel, am.v0, new THREE.Vector3(), o.tAcc);
  if (!dir) return null;
  dir = dir.clone ? dir.clone() : dir;
  const tol = o.tol || 0.05;
  let f = null;
  for (let it = 0; it < (o.iters || 4); it++) {
    f = flyout(o.from, o.fromVel, dir, am, o.tPos, o.tVel, o.tAcc, env, am.life);
    const m = f.miss.length();
    if (m < tol) break;
    // aim the other way by what it missed by, across the line of fire
    const L = Math.max(1, f.dist);
    dir.multiplyScalar(L).sub(f.miss).normalize();
  }
  if (!f) return null;
  const miss = f.miss.length();
  return { dir, tof: f.t, miss, ok: f.t < am.life && miss < Math.max(1, f.dist * 1e-4) };
}

/**
 * The odds of a hit. o: { am, gun, range (m), tof (s), vCross (m/s: the target's motion across
 * the line of fire, relative to the shooter), radius (m: the size it presents), agility (m/s^2:
 * how hard it can manoeuvre unpredictably over the flight), track: { ang (rad), range (m), vel
 * (m/s) } (the tracking errors, 1 sd), disp (scatter multiplier), heat, rounds (in the burst) }
 * Returns { pRound, pBurst, sigRound, sigBias } (sigmas in metres at the target)
 */
export function hitProbability(o) {
  const am = o.am, g = o.gun || { sigma: 0, jitter: 0, heatK: 0 };
  const R = Math.max(1, o.range), T = Math.max(0, o.tof);
  const vc = Math.abs(o.vCross || 0);
  // round to round: the gun's and the ammunition's scatter, the muzzle velocity's spread (it
  // arrives a little early or late, while the target crosses)
  const mrad = (Math.sqrt(am.sigma * am.sigma + g.sigma * g.sigma + g.jitter * g.jitter) * (o.disp || 1) + g.heatK * (o.heat || 0)) * 1e-3;
  const sDisp = mrad * R;
  const sMv = T * (am.vSigma / am.v0) * vc;
  const sigRound = Math.hypot(sDisp, sMv);
  // shared by a burst: the track's errors, and what the target does that cannot be foreseen
  const tr = o.track || { ang: 1e-4, range: 1, vel: 0.05 };
  const sTrack = Math.hypot(tr.ang * R, (tr.range / am.v0) * vc, (tr.vel || 0) * T);
  const sMan = 0.5 * 0.5 * (o.agility || 0) * T * T;
  const sigBias = Math.hypot(sTrack, sMan);
  // Carlton: a target of radius r against a Gaussian of sd s: (r^2/2) / (r^2/2 + s^2), and
  // exp(-b^2 / 2(r^2/2 + s^2)) for an offset b
  const r2 = 0.5 * Math.max(0.01, o.radius) * Math.max(0.01, o.radius);
  const S = r2 + sigRound * sigRound;
  const pRound = r2 / (S + sigBias * sigBias);
  // a burst: over the bias the burst shares (Rayleigh quantiles)
  const n = Math.max(1, o.rounds || 1);
  let pBurst = 0;
  const N = 16;
  for (let i = 0; i < N; i++) {
    const b = sigBias * Math.sqrt(-2 * Math.log(1 - (i + 0.5) / N));
    const p = (r2 / S) * Math.exp(-b * b / (2 * S));
    pBurst += 1 - Math.pow(1 - p, n);
  }
  pBurst /= N;
  return { pRound: Math.min(1, pRound), pBurst: Math.min(1, pBurst), sigRound, sigBias };
}

/**
 * A gun's fire control: a track on each target (its acceleration through a filter), the solution
 * kept warm between frames, the barrel's heat, the slowly wandering aim error of its sensors, and
 * the gun's own generator.
 */
export class FireControl {
  /** o: { am, gun, env, seed, sensor: { ang (rad), range (m), vel (m/s) } (1 sd), accT (s: the
   * track filter's time constant) } */
  constructor(o) {
    this.am = o.am; this.gun = o.gun; this.env = o.env || ENV;
    this.rng = new Rng(o.seed || 1);
    this.sensor = o.sensor || { ang: 1.0e-4, range: 1, vel: 0.05 };
    this.accT = o.accT || 0.6;
    this.tracks = new Map();
    this.sol = null;
    this.solAge = 0;
    this.every = o.every || 1 / 15;       // how often the full solution is worked out (s)
    this.heat = 0;
    this.err = new THREE.Vector3();       // the aim error of the moment (rad, across the line)
    this.fired = 0;
  }

  /** keep the track on a target up to date (dt since the last look) */
  observe(id, pos, vel, acc, dt) {
    let T = this.tracks.get(id);
    if (!T) { T = { pos: pos.clone(), vel: vel.clone(), acc: acc ? acc.clone() : new THREE.Vector3(), t: 0 }; this.tracks.set(id, T); }
    T.pos.copy(pos); T.vel.copy(vel);
    const k = 1 - Math.exp(-Math.max(0, dt) / this.accT);
    if (acc) T.acc.lerp(acc, k); else T.acc.multiplyScalar(1 - k);
    T.t = 0;
    return T;
  }

  /** forget the targets not seen for a while */
  tick(dt) {
    this.solAge += dt;
    this.heat *= Math.exp(-dt / (this.gun ? this.gun.coolT : 5));
    for (const [id, T] of this.tracks) { T.t += dt; if (T.t > 3) this.tracks.delete(id); }
    // the sensors' error wanders slowly (it is the same for rounds fired close together)
    const tau = 0.4, a = Math.exp(-dt / tau), b = Math.sqrt(Math.max(0, 1 - a * a)) * this.sensor.ang;
    this.err.multiplyScalar(a).add(_vt.set(this.rng.normal() * b, this.rng.normal() * b, this.rng.normal() * b));
  }

  /**
   * The shot at a tracked target from a muzzle (from, moving with fromVel): the solution, kept
   * for a moment and refined from the last one. aim: the point on the target to hit (ECI; its
   * track's position when omitted); aimDv: how much faster that point moves than the target's
   * middle (its turning carries it round)
   */
  solve(id, from, fromVel, aim, aimDv = null) {
    const T = this.tracks.get(id);
    if (!T) return null;
    const S = this.sol && this.sol.id === id ? this.sol : null;
    const P = aim || T.pos;
    const V = aimDv ? T.vel.clone().add(aimDv) : T.vel;
    // the full solution (by flying the shot) a dozen or so times a second; in between, the
    // straight-line lead of the moment with the correction the last full solution found (it
    // changes slowly: the differences of gravity and drag along the way)
    const lead = leadDir(from, fromVel, P, V, this.am.v0, new THREE.Vector3(), T.acc);
    if (!lead) { this.sol = null; return null; }
    let sol;
    if (S && this.solAge < this.every) {
      sol = { id, dir: lead.clone().add(S.corr).normalize(), tof: lead.t + S.dTof, miss: S.miss, ok: S.ok, corr: S.corr, dTof: S.dTof };
    } else {
      sol = solveAim({ from, fromVel, tPos: P, tVel: V, tAcc: T.acc, am: this.am, env: this.env, dir0: S ? lead.clone().add(S.corr).normalize() : lead, iters: S ? 2 : 4 });
      if (!sol) { this.sol = null; return null; }
      sol.corr = sol.dir.clone().sub(lead);
      sol.dTof = sol.tof - lead.t;
      this.solAge = 0;
    }
    sol.id = id;
    // what the sensors get wrong goes into the aim
    const e = _vt.copy(this.err).addScaledVector(sol.dir, -this.err.dot(sol.dir));
    sol.aimDir = sol.dir.clone().add(e).normalize();
    this.sol = sol;
    return sol;
  }

  /** fire one round along dir from the muzzle (with the gun's scatter): the round */
  fire(muzzle, fromVel, dir, disp = 1) {
    const r = launch(this.am, this.gun, muzzle, fromVel, dir, this.rng, { heat: this.heat, disp });
    this.heat += 1;
    this.fired++;
    return r;
  }

  /** the odds of a hit on a tracked target from a muzzle: { pRound, pBurst, tof, range } or null */
  odds(id, from, fromVel, radius, agility, rounds, disp = 1, aim = null) {
    const T = this.tracks.get(id);
    if (!T) return null;
    const P = aim || T.pos;
    const range = P.distanceTo(from);
    if (range > this.am.maxRange) return { pRound: 0, pBurst: 0, tof: range / this.am.v0, range, out: true };
    const los = _rel.copy(P).sub(from).divideScalar(Math.max(1, range));
    const vr = _rv.copy(T.vel).sub(fromVel);
    const closing = -vr.dot(los);
    const vCross = vr.addScaledVector(los, -vr.dot(los)).length();
    const S = this.sol && this.sol.id === id ? this.sol : null;
    const tof = S ? S.tof : range / Math.max(50, this.am.v0 + closing);
    const p = hitProbability({ am: this.am, gun: this.gun, range, tof, vCross, radius, agility, track: this.sensor, disp, heat: this.heat, rounds });
    return Object.assign(p, { tof, range });
  }
}
