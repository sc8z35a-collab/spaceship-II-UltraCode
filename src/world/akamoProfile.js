// AKAMO — the space elevator of Shirasagi station: one ribbon of 2,500 km standing straight up from
// the station (it turns with the station's orbit: its top end, moving faster than an orbit there
// would, pulls outward — 0.73 g toward space at the top terminal, nothing at the bottom).
//
// The ride, as a function of time from the doors closing (pure numbers, no state):
//  - the clamps let go; a second's creep out of the berth;
//  - the LAUNCH: the linear drive kicks in like a launched roller coaster — the push builds in
//    half a second to 2.4 g, the inertial dampers are still coming up, so for three seconds it is
//    really felt (and the cabin shakes with it);
//  - the dampers take over: the drive goes on to 3,200 m/s² (326 g — nobody could live through it
//    undamped) while what is felt eases to a steady 1.1 g toward the floor; in 25 seconds the
//    cabin is doing 80 km/s, a thousand kilometres up;
//  - the FLIP at top speed: the cabin turns over on its gimbals in five seconds, so its floor
//    faces the way it will brake (and, at the top, the way the top terminal's own pull goes);
//  - the braking, the mirror of the run up; the last two kilometres slowly (200 m/s down to a
//    walk), and the creep into the top berth, where the clamps close.
// Going down is the same run the other way round (the flip happens again in the middle).
export const AKAMO = {
  name: 'AKAMO',
  jp: 'シラサギ・ステーション・スペースエレベーター「AKAMO」',
  L: 2.5e6,                 // m: the ribbon's length above the bottom berth
  vMax: 80000,              // m/s
  aMax: 3200,               // m/s²: the drive (damped)
  launchG: 2.4,             // g felt at the launch, before the dampers are up
  cruiseG: 1.1,             // g felt while the dampers hold it
  flipT: 5.0,               // s: the turn over at top speed
  creep: { v: 2, d: 30 },   // the first and last metres, out of and into a berth
  slow: { v: 150, d: 5000 }, // the last five kilometres: 150 m/s down to a walk
  g0: 9.80665,
};

const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

/**
 * The run's plan (one way): times of each stage and the distance it covers. The motion along the
 * ribbon: s(t) (m from the start berth), v, a; what is felt (g, toward the cabin's floor), the
 * flip (0 floor toward the start .. 1 turned over), a shake (0..1), the stage's name.
 */
export function plan(P = AKAMO) {
  const T = {};
  // 1. creep out of the berth (a smooth start over its first 0.6 s)
  T.creep = { t: 4, a: 0 };
  const s1 = P.creep.v * (4 - 0.3);
  // 2. the launch: a jerk up to the launch push (0.5 s), held while the dampers come up (3 s)
  const aL = P.launchG * P.g0;
  T.launch = { t: 3.5, aL };
  // velocity and distance over the launch (a: ramp 0..aL in 0.5 s, then aL)
  const vL = P.creep.v + aL * 0.25 + aL * 3.0;
  const sL = P.creep.v * 3.5 + aL * (0.5 * 0.5 * 0.5 / 3) + aL * 0.25 * 3.0 + 0.5 * aL * 9;
  // 3. the boost: from aL to aMax in 3 s (the dampers taking it), then aMax to vMax
  const jr = 3;
  const vAfterRamp = vL + (aL + P.aMax) / 2 * jr;
  const sAfterRamp = vL * jr + (aL * jr * jr / 2) + (P.aMax - aL) * jr * jr / 6;
  const tHold = Math.max(0, (P.vMax - vAfterRamp) / P.aMax);
  const sHold = vAfterRamp * tHold + 0.5 * P.aMax * tHold * tHold;
  T.boost = { t: jr + tHold, s: sAfterRamp + sHold, ramp: jr };
  // 4. the braking from vMax to the slow approach speed at the drive's full push
  const vS = P.slow.v;
  const tBrake = (P.vMax - vS) / P.aMax;
  const sBrake = (P.vMax * P.vMax - vS * vS) / (2 * P.aMax);
  T.brake = { t: tBrake, s: sBrake };
  // 5. the slow approach: vS down to the creep speed over P.slow.d
  const aS = (vS * vS - P.creep.v * P.creep.v) / (2 * P.slow.d);
  T.slow = { t: (vS - P.creep.v) / aS, s: P.slow.d, a: aS };
  // 6. the creep into the berth
  T.dock = { t: P.creep.d * 0.5 / P.creep.v, s: P.creep.d * 0.5 };
  // 7. the cruise at top speed fills what is left (the flip is in it)
  const used = s1 + sL + T.boost.s + sBrake + P.slow.d + T.dock.s;
  const sCruise = Math.max(0, P.L - used);
  T.cruise = { t: sCruise / P.vMax, s: sCruise };
  // the stages in order, with their start times and distances
  const order = [['creep', T.creep.t, s1], ['launch', T.launch.t, sL], ['boost', T.boost.t, T.boost.s], ['cruise', T.cruise.t, sCruise], ['brake', T.brake.t, sBrake], ['slow', T.slow.t, P.slow.d], ['dock', T.dock.t, T.dock.s]];
  let t0 = 0, s0 = 0;
  const stages = [];
  for (const [name, dt, ds] of order) { stages.push({ name, t0, t1: t0 + dt, s0, s1: s0 + ds }); t0 += dt; s0 += ds; }
  return { P, stages, total: t0, L: s0, vL, aL, aS, flipAt: stages[3].t0 + Math.max(0, (T.cruise.t - P.flipT) / 2) };
}

let PLAN = null;
export function thePlan() { return PLAN || (PLAN = plan()); }

/**
 * where the cabin is at time t of its run (s from the start berth, along its way), its speed and
 * push, what is felt and how: { s, v, a, felt, flip, shake, stage, k (0..1 of the run) }
 */
export function at(t, pl = thePlan(), pulls = { start: 0, end: 0 }) {
  const P = pl.P, g0 = P.g0;
  const st = pl.stages.find((x) => t < x.t1) || pl.stages[pl.stages.length - 1];
  const u = Math.max(0, Math.min(st.t1 - st.t0, t - st.t0));
  let s = st.s0, v = 0, a = 0, felt = 0, shake = 0;
  const S = (name) => pl.stages.find((x) => x.name === name);
  switch (st.name) {
    case 'creep': {
      v = P.creep.v * smooth(u / 0.6);
      s = st.s0 + P.creep.v * Math.max(0, u - 0.3);
      a = 0;
      felt = Math.max(0.02, pulls.start);
      shake = 0.15;
      break;
    }
    case 'launch': {
      const aL = pl.aL;
      const r = Math.min(1, u / 0.5);
      a = aL * r;
      // v, s by the jerk then constant push
      if (u < 0.5) { v = P.creep.v + aL * u * u; s = st.s0 + P.creep.v * u + aL * u * u * u / 3; }
      else { const v5 = P.creep.v + aL * 0.25; v = v5 + aL * (u - 0.5); s = st.s0 + P.creep.v * 0.5 + aL * 0.125 / 3 + v5 * (u - 0.5) + 0.5 * aL * (u - 0.5) * (u - 0.5); }
      // felt: the whole push at first, a jolt of a little more as it bites, the dampers not yet up
      felt = Math.max(pulls.start, (a / g0) * (1 + 0.12 * Math.exp(-((u - 0.55) ** 2) / 0.01)));
      shake = 0.6 + 0.4 * Math.exp(-u / 1.2);
      break;
    }
    case 'boost': {
      const aL = pl.aL, jr = 3;
      const L = S('launch');
      const vL = pl.vL;
      if (u < jr) {
        const q = u / jr;
        a = aL + (P.aMax - aL) * q;
        v = vL + aL * u + (P.aMax - aL) * u * u / (2 * jr);
        s = st.s0 + vL * u + aL * u * u / 2 + (P.aMax - aL) * u * u * u / (6 * jr);
        // the dampers come up: from the full launch push down to the steady pull
        felt = P.launchG + (P.cruiseG - P.launchG) * smooth(q * 1.4);
        shake = 0.5 * (1 - q) + 0.25;
      } else {
        const v3 = vL + aL * jr + (P.aMax - aL) * jr / 2;
        const s3 = vL * jr + aL * jr * jr / 2 + (P.aMax - aL) * jr * jr / 6;
        const w = u - jr;
        a = P.aMax;
        v = Math.min(P.vMax, v3 + P.aMax * w);
        s = st.s0 + s3 + v3 * w + 0.5 * P.aMax * w * w;
        felt = P.cruiseG;
        // (the faster, the finer and steadier the buzz of the drive)
        shake = 0.22 + 0.08 * Math.sin(u * 3.1);
      }
      void L;
      break;
    }
    case 'cruise': {
      v = P.vMax; a = 0;
      s = st.s0 + P.vMax * u;
      // the dampers hold a light pull while it turns over (a moment of lightness in the middle)
      const fk = flipAt(t, pl);
      felt = 0.35 + 0.4 * Math.abs(Math.cos(fk * Math.PI));
      shake = 0.12;
      break;
    }
    case 'brake': {
      a = -P.aMax;
      v = P.vMax - P.aMax * u;
      s = st.s0 + P.vMax * u - 0.5 * P.aMax * u * u;
      felt = P.cruiseG;
      shake = 0.2;
      break;
    }
    case 'slow': {
      const aS = pl.aS;
      v = Math.max(P.creep.v, P.slow.v - aS * u);
      s = st.s0 + P.slow.v * u - 0.5 * aS * u * u;
      a = -aS;
      // the dampers hand over to what is really felt: the end berth's own pull and the braking
      const q = u / (st.t1 - st.t0);
      felt = P.cruiseG + (pulls.end + aS / g0 * 0.5 - P.cruiseG) * smooth(q);
      shake = 0.1;
      break;
    }
    case 'dock': {
      const q = u / (st.t1 - st.t0);
      v = P.creep.v * (1 - smooth(q));
      s = st.s0 + (st.s1 - st.s0) * Math.min(1, q * (2 - q));
      a = 0;
      felt = Math.max(0.02, pulls.end);
      shake = 0.05;
      break;
    }
    default: break;
  }
  s = Math.min(pl.L, Math.max(0, s));
  return { s, v, a, felt, flip: flipAt(t, pl), shake, stage: st.name, k: Math.min(1, t / pl.total) };
}

/** the turn over at top speed: 0 .. 1 */
export function flipAt(t, pl = thePlan()) {
  const P = pl.P;
  return smooth((t - pl.flipAt) / P.flipT);
}

/** the pull a point of the ribbon feels standing still on it, at height s above the bottom berth
 * (r0: the bottom berth's distance from the Earth's centre): outward + , m/s² */
export function standPull(s, r0) {
  const MU = 3.986004418e14;
  const n2 = MU / (r0 * r0 * r0);
  const r = r0 + s;
  return n2 * r - MU / (r * r);
}
