// Climber traffic on the space elevator "Ame-no-Mihashira". The tether is two parallel ribbons
// 8.4 m apart: climbers go up the north ribbon (lane U, station x = -LANE_X; the stations' x points
// south) and come down the south one (lane D, x = +LANE_X). Three lines, each a loop of climbers
// running a fixed timetable:
//   ground line   anchor platform  <-> Mihashira (lower berth)       every 15 min
//   GEO line      Mihashira (upper berth) <-> Amaterasu (lower berth) every hour
//   outer line    Amaterasu (upper berth) <-> counterweight station  every 6 hours
// A climber creeps out of its berth, ramps up to cruise, ramps down and creeps into the next
// berth, where it is clamped, unloaded, shifted across to the other ribbon by the traverser,
// loaded and sent back. Everything is a function of the line clock (no state), so the traffic
// is the same after a reload, while sleeping, or when the clock is slowed by damage.
import { ELEVATOR_H } from './elevatorConst.js';

export const LANE_X = 4.2;          // ribbon offset from the elevator axis (station x)
export const BERTH_OFF = 64;        // climber berths, metres above / below a terminal's centre
const VC = 0.6, DC = 45;            // creep speed and creep distance in and out of a berth

/** trip profile over distance L: creep out, smooth ramp up to v, cruise, ramp down, creep in */
function profile(L, v, a) {
  const Ta = 1.5 * (v - VC) / a;                       // smoothstep ramp with peak acceleration a
  const ramp = (q) => VC * q * Ta + (v - VC) * Ta * (q * q * q - q * q * q * q / 2);
  const dR = ramp(1);
  const dCr = Math.max(0, L - 2 * DC - 2 * dR);
  const Tc = DC / VC, Tb = dCr / v;
  const tau = 2 * Tc + 2 * Ta + Tb;
  const sm = (q) => q * q * (3 - 2 * q);
  /** distance from the start and speed, u seconds into the trip */
  const at = (u, out) => {
    if (u <= 0) { out.x = 0; out.v = 0; return out; }
    if (u < Tc) { out.x = VC * u; out.v = VC; return out; }
    u -= Tc;
    if (u < Ta) { const q = u / Ta; out.x = DC + ramp(q); out.v = VC + (v - VC) * sm(q); return out; }
    u -= Ta;
    if (u < Tb) { out.x = DC + dR + v * u; out.v = v; return out; }
    u -= Tb;
    if (u < Ta) { const q = 1 - u / Ta; out.x = DC + dR + dCr + dR - ramp(q); out.v = VC + (v - VC) * sm(q); return out; }
    u -= Ta;
    if (u < Tc) { out.x = L - DC + VC * u; out.v = VC; return out; }
    out.x = L; out.v = 0; return out;
  };
  return { tau, at, L, Ta, Tc };
}

// berth heights (climber centre) at each end of each line
const H = ELEVATOR_H;
export const LINES = [
  { id: 'G', jp: '地上線', h0: H.anchorBerth, h1: H.mih - BERTH_OFF, v: 70, a: 0.45, dwell: [420, 420], every: 900, mix: 'PCPPC', ends: ['anchor', 'mihashira'] },
  { id: 'S', jp: '静止線', h0: H.mih + BERTH_OFF, h1: H.geo - BERTH_OFF, v: 140, a: 0.45, dwell: [600, 600], every: 3600, mix: 'PPC', ends: ['mihashira', 'amaterasu'] },
  { id: 'O', jp: '外縁線', h0: H.geo + BERTH_OFF, h1: H.cwBerth, v: 140, a: 0.45, dwell: [900, 900], every: 21600, mix: 'CCP', ends: ['amaterasu', 'counterweight'] },
];

/** the berth timeline (seconds into a dwell of length Dw): clamps, bridges, traverse, departure */
export function berthStage(f, Dw) {
  const sm = (a, b) => { const q = Math.min(1, Math.max(0, (f - a) / (b - a))); return q * q * (3 - 2 * q); };
  const trA = Dw * 0.46, trB = Dw * 0.6;            // traverse window
  return {
    clamp: sm(0, 6) * (1 - sm(Dw - 14, Dw - 8)),                     // grip arms on the climber
    bridgeIn: sm(10, 28) * (1 - sm(trA - 34, trA - 16)),             // arrival-side boarding bridge
    bridgeOut: sm(trB + 12, trB + 30) * (1 - sm(Dw - 46, Dw - 28)),  // departure-side bridge
    rollers: 1 - sm(trA - 12, trA - 4) * (1 - sm(trB + 2, trB + 10)), // drive rollers on the ribbon
    traverse: sm(trA, trB),                                          // 0 = arrival lane, 1 = departure lane
    doors: sm(26, 32) * (1 - sm(trA - 40, trA - 34)) + sm(trB + 30, trB + 36) * (1 - sm(Dw - 50, Dw - 44)),
    depart: sm(Dw - 40, Dw - 30),                                    // departure warning lights
  };
}

export class Traffic {
  constructor() {
    this.lines = LINES.map((L) => {
      const P = profile(L.h1 - L.h0, L.v, L.a);
      const period = 2 * P.tau + L.dwell[0] + L.dwell[1];
      const n = Math.max(1, Math.round(period / L.every));
      return { ...L, P, period, n, gap: period / n };
    });
    this.climbers = [];
    for (const L of this.lines) {
      for (let i = 0; i < L.n; i++) {
        this.climbers.push({
          line: L, i, id: `${L.id}-${String(i + 1).padStart(2, '0')}`, kind: L.mix[i % L.mix.length],
          h: L.h0, lane: -1, v: 0, dir: 1, stage: 'up', dwellF: 0, dwell: 0, end: 0, trip: 0, hidden: false,
        });
      }
    }
    this._o = { x: 0, v: 0 };
  }

  /** advance every climber to line-clock time `sec` (seconds) */
  update(sec) {
    const o = this._o;
    for (const c of this.climbers) {
      const L = c.line, P = L.P;
      let u = (sec - c.i * L.gap) % L.period;
      if (u < 0) u += L.period;
      if (u < P.tau) {                                   // going up the north ribbon
        P.at(u, o);
        c.stage = 'up'; c.h = L.h0 + o.x; c.v = o.v; c.dir = 1; c.lane = -1; c.trip = u / P.tau;
        continue;
      }
      u -= P.tau;
      if (u < L.dwell[1]) {                              // top berth: across to the south ribbon
        const s = berthStage(u, L.dwell[1]);
        c.stage = 'berth'; c.end = 1; c.h = L.h1; c.v = 0; c.dir = 0; c.dwellF = u; c.dwell = L.dwell[1];
        c.lane = -1 + 2 * s.traverse;
        continue;
      }
      u -= L.dwell[1];
      if (u < P.tau) {                                   // coming down the south ribbon
        P.at(u, o);
        c.stage = 'down'; c.h = L.h1 - o.x; c.v = -o.v; c.dir = -1; c.lane = 1; c.trip = u / P.tau;
        continue;
      }
      u -= P.tau;                                        // bottom berth: across to the north ribbon
      const s = berthStage(u, L.dwell[0]);
      c.stage = 'berth'; c.end = 0; c.h = L.h0; c.v = 0; c.dir = 0; c.dwellF = u; c.dwell = L.dwell[0];
      c.lane = 1 - 2 * s.traverse;
    }
  }

  /** seconds until the next climber of `lineId` reaches the berth at end `end` (0 bottom, 1 top) */
  nextArrival(lineId, end, sec) {
    const L = this.lines.find((l) => l.id === lineId);
    if (!L) return Infinity;
    // arrival at the top end happens at u = tau, at the bottom end at u = 2 tau + dwell[1]
    const ua = end === 1 ? L.P.tau : 2 * L.P.tau + L.dwell[1];
    let best = Infinity;
    for (let i = 0; i < L.n; i++) {
      let u = (sec - i * L.gap) % L.period;
      if (u < 0) u += L.period;
      let w = ua - u;
      if (w < 0) w += L.period;
      if (w < best) best = w;
    }
    return best;
  }
}
