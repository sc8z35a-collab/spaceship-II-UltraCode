// Spacesuits: one model every suit is built on. A suit is a spec (what it is: its grade, its
// propulsion, its battery and oxygen, how hard its visor, shell and soft goods are) and a state (how
// much charge and oxygen it has left, what is scratched, cracked, torn or dead). Any new suit is a
// new entry in SUITS; everything below works the same for all of them.
//
// Damage is physics: an impact is the suit's speed relative to what it hits, the contact normal,
// the other body's mass and material. The normal part of the energy (with the effective mass of the
// two bodies) loads the part of the suit that met it (visor, helmet, upper torso, backpack with its
// boosters, battery and tanks, arms, legs); the sliding part scrapes. Each part has the energies it
// scratches, cracks and gives way at (per grade). The deceleration (the speed change over the
// contact time its padding allows) shakes the electronics (HUD, radio, camera, flight computer) and
// the wearer. Breaches leak (the suit feeds oxygen to hold its pressure, so a leak drains the tank
// many times faster); a dead battery or flight computer shuts the suit down to its passive life
// support.

export const G0 = 9.81;

/** the suits there are */
export const SUITS = {
  // HACHI's suit: the best there is (military / exploration grade)
  h8: {
    id: 'h8', name: 'H8 EVA-X', grade: 'top', gradeJP: '最高グレード', home: 'h8',
    mass: 112,                                   // kg with its boosters and batteries
    color: 'h8',
    // two booster engines on the backpack: free flight in every direction
    propulsion: { boosters: 2, vMax: 500, accel: 14, rcs: 5, turn: 2.4, damp: 2.6 },
    // flight time at full use; the spare battery is carried on the backpack
    battery: { flightSec: 3600, idleSec: 96 * 3600, chargeSec: 600, spares: 1, swapSec: 6 },
    // oxygen: a day's worth (and half an hour more from the emergency bottle)
    o2: { hours: 24, reserveMin: 30 },
    // energies (J) each part takes before it scratches / cracks / gives way. The visor is a
    // ballistic laminate (aluminium oxynitride over polycarbonate): it hardly scratches
    visor: { scratchJ: 450, crackJ: 6000, breachJ: 30000, ballistic: true },
    helmet: { scratchJ: 300, crackJ: 9000, breachJ: 40000 },
    shell: { scratchJ: 200, crackJ: 12000, breachJ: 45000 },
    soft: { scratchJ: 240, crackJ: 5000, breachJ: 14000 },
    pack: { scratchJ: 250, crackJ: 8000, breachJ: 30000 },
    // padding: how long a hard contact takes to stop the suit (s); shock the electronics stand
    padT: 0.06, electronicsG: 90,
    camera: { f: [24, 70], digital: 5 },
  },
  // B-29's suits: civilian, mid grade
  b29: {
    id: 'b29', name: 'B-29 CS-2', grade: 'mid', gradeJP: '中級グレード（民間用）', home: 'b29',
    mass: 92,
    color: 'b29',
    propulsion: { boosters: 1, vMax: 100, accel: 4, rcs: 2.2, turn: 1.5, damp: 1.8 },
    battery: { flightSec: 1800, idleSec: 48 * 3600, chargeSec: 1800, spares: 0, swapSec: 10 },
    o2: { hours: 8, reserveMin: 30 },
    visor: { scratchJ: 20, crackJ: 700, breachJ: 3500, ballistic: false },
    helmet: { scratchJ: 30, crackJ: 1500, breachJ: 6000 },
    shell: { scratchJ: 25, crackJ: 2500, breachJ: 9000 },
    soft: { scratchJ: 30, crackJ: 1200, breachJ: 3500 },
    pack: { scratchJ: 30, crackJ: 1800, breachJ: 7000 },
    padT: 0.035, electronicsG: 30,
    camera: { f: [24, 70], digital: 5 },
  },
};

/** the parts of a suit an impact can land on (and what each carries) */
export const PARTS = {
  visor: { jp: 'バイザー', armour: 'visor', leak: true },
  helmet: { jp: 'ヘルメット', armour: 'helmet', leak: true, sys: ['hud', 'radio', 'camera', 'lamp'] },
  torso: { jp: '胴体', armour: 'shell', leak: true, sys: ['computer'] },
  pack: { jp: '背中のパック', armour: 'pack', leak: true, sys: ['boosters', 'battery', 'o2', 'computer'] },
  arms: { jp: '腕', armour: 'soft', leak: true },
  legs: { jp: '脚', armour: 'soft', leak: true },
};

export const SYSTEMS_JP = { hud: 'HUD', radio: '通信', camera: 'カメラ', lamp: 'ライト', computer: '制御', boosters: 'ブースター', battery: 'バッテリー', o2: '酸素系' };

// the wearer (an adult in a liquid-cooled undergarment)
const WEARER = 72;
// oxygen a person uses (kg / s) at rest; working in the suit uses more
const O2_RATE = 0.84 / 86400;

/**
 * where on the suit a contact lands, from the direction it comes from in the suit's own frame
 * (x right, y up, z back: the suit faces -z). n: unit, from the suit toward what it touches
 */
export function partFromDirection(n, rand = Math.random) {
  const up = n.y, back = n.z, side = Math.abs(n.x);
  if (up > 0.55) return back < -0.2 && rand() < 0.75 ? 'visor' : 'helmet';
  if (back > 0.45) return 'pack';
  if (up < -0.55) return 'legs';
  if (back < -0.45 && up > 0.15) return rand() < 0.6 ? 'visor' : 'torso';
  if (side > 0.6) return rand() < 0.55 ? 'arms' : 'torso';
  return rand() < 0.45 ? 'torso' : rand() < 0.5 ? 'arms' : 'legs';
}

/** a suit and what has happened to it */
export class SuitState {
  constructor(spec) {
    this.spec = spec;
    this.battery = 1;                             // the battery in use, 0..1
    this.spares = Array.from({ length: spec.battery.spares }, () => 1);
    this.swapT = 0;
    this.o2 = 1;                                  // main tank, 0..1
    this.reserve = 1;                             // emergency bottle, 0..1
    this.parts = {};
    for (const k of Object.keys(PARTS)) this.parts[k] = { hp: 1, marks: [], leak: 0 };
    this.sys = { hud: 1, radio: 1, camera: 1, lamp: 1, computer: 1, boosters: 1, battery: 1, o2: 1 };
    this.boosterL = 1; this.boosterR = spec.propulsion.boosters > 1 ? 1 : 0;
    this.shutdown = false;                        // dead: passive life support only
    this.log = [];                                // recent events (newest last)
    this.injury = 0;                              // to the wearer, 0..1
    this.flightUse = 0;                           // s of flight-equivalent use (statistics)
  }

  get mass() { return this.spec.mass + WEARER; }

  /** total leak, as a multiple of the oxygen the wearer breathes */
  get leakK() { let k = 0; for (const p of Object.values(this.parts)) k += p.leak; return k; }

  /** the battery left over all packs, in seconds of full-throttle flight */
  flightLeft() {
    const B = this.spec.battery;
    return (this.battery + this.spares.reduce((a, b) => a + b, 0)) * B.flightSec * this.sys.battery;
  }

  /** oxygen left, in seconds at the current use (leaks included) */
  o2Left(work = 0) {
    const use = O2_RATE * (1 + 0.6 * work) * (1 + this.leakK);
    const kg = (this.o2 * this.spec.o2.hours * 3600 + this.reserve * this.spec.o2.reserveMin * 60) * O2_RATE;
    return use > 0 ? kg / use : Infinity;
  }

  /** what can still fly (0..1): the boosters, the computer, a live battery */
  thrustK() {
    if (this.shutdown || this.battery <= 0 || this.swapT > 0) return 0;
    const b = this.spec.propulsion.boosters;
    const n = b > 1 ? (this.boosterL + this.boosterR) / 2 : this.boosterL;
    return n * Math.min(1, this.sys.computer * 1.4) * this.sys.boosters;
  }

  /** with one of two boosters out the push is lopsided: the yaw it puts in (rad/s^2 per unit) */
  asymmetry() { return this.spec.propulsion.boosters > 1 ? (this.boosterR - this.boosterL) * 0.6 : 0; }

  /**
   * per step. o: { flying (boosters armed), throttle 0..1 (the thrust asked of them), work 0..1
   * (how hard the wearer works), charging (at its home ship's rack), inAir (cabin air: no leaks
   * drain the tank) }
   */
  update(dt, o = {}) {
    const S = this.spec, B = S.battery;
    // the battery: flight drains it (more the harder the boosters push), life support slowly
    if (o.charging) {
      const k = dt / B.chargeSec;
      this.battery = Math.min(1, this.battery + k);
      for (let i = 0; i < this.spares.length; i++) if (this.battery >= 1) this.spares[i] = Math.min(1, this.spares[i] + k);
      if (this.battery > 0.02 && this.sys.computer > 0.2 && this.sys.battery > 0.05) this.shutdown = false;
    } else if (!this.shutdown) {
      const fly = o.flying ? (0.3 + 0.7 * Math.min(1, o.throttle || 0)) / B.flightSec : 0;
      const idle = 1 / B.idleSec;
      this.flightUse += o.flying ? dt * (0.3 + 0.7 * Math.min(1, o.throttle || 0)) : 0;
      this.battery = Math.max(0, this.battery - dt * (fly + idle) / Math.max(0.05, this.sys.battery));
      // empty: the spare goes in (a few seconds without power to the boosters)
      if (this.battery <= 0 && this.swapT <= 0) {
        const i = this.spares.findIndex((x) => x > 0.02);
        if (i >= 0) { this.swapT = B.swapSec; this.event('battery_swap'); }
        else { this.shutdown = true; this.event('battery_dead'); }
      }
    }
    if (this.swapT > 0) {
      this.swapT -= dt;
      if (this.swapT <= 0) {
        const i = this.spares.findIndex((x) => x > 0.02);
        if (i >= 0) { this.battery = this.spares[i]; this.spares[i] = 0; this.event('battery_swapped'); }
      }
    }
    // oxygen: breathing, plus whatever leaks out (in the cabin's air the suit loses nothing)
    if (!o.inAir) {
      const use = dt * (1 + 0.6 * (o.work || 0)) * (1 + this.leakK) / (S.o2.hours * 3600);
      if (this.o2 > 0) this.o2 = Math.max(0, this.o2 - use * (this.sys.o2 > 0.1 ? 1 : 2.5));
      else if (this.reserve > 0) this.reserve = Math.max(0, this.reserve - use * S.o2.hours * 60 / S.o2.reserveMin);
      if (this.o2 <= 0 && this.reserve > 0 && !this._resv) { this._resv = true; this.event('o2_reserve'); }
    } else if (o.charging) {
      // racked at home: the tanks are topped up too
      this.o2 = Math.min(1, this.o2 + dt / 300);
      this.reserve = Math.min(1, this.reserve + dt / 300);
      this._resv = false;
    }
  }

  /** refill everything (a new suit, or a full service) */
  service() {
    this.battery = 1; this.spares = this.spares.map(() => 1); this.o2 = 1; this.reserve = 1; this._resv = false;
  }

  /**
   * an impact. ev: { vn (normal approach speed, m/s), vt (sliding speed), n (unit, suit frame,
   * from the suit toward the other body), otherMass (kg; Infinity for a ship or a station),
   * hard (0..1: how hard the other surface is), sharp (0..1: an edge, a broken plate, debris),
   * part (optional: the part that met it) }. Returns what happened.
   */
  impact(ev, rand = Math.random) {
    const S = this.spec;
    const m = this.mass, M = ev.otherMass ?? Infinity;
    const mEff = Number.isFinite(M) ? m * M / (m + M) : m;
    const hard = ev.hard ?? 1, sharp = ev.sharp ?? 0;
    const part = ev.part || partFromDirection(ev.n || { x: 0, y: 0, z: -1 }, rand);
    const P = PARTS[part], A = S[P.armour], st = this.parts[part];
    // the energy the contact puts into the part: the normal impact (minus what bounces back) and
    // the scrape; sharp things concentrate it
    const eN = 0.5 * mEff * ev.vn * ev.vn * (0.55 + 0.45 * hard) * (1 + 1.6 * sharp);
    const eT = 0.5 * mEff * (ev.vt || 0) * (ev.vt || 0) * 0.35 * hard * (1 + 2.0 * sharp);
    const out = { part, eN, eT, marks: 0, crack: false, breach: false, g: 0, systems: [] };
    // scratches: from the scrape and from light knocks
    const sc = (eT + eN * 0.25) / A.scratchJ;
    if (sc > 1) {
      const n = Math.min(6, Math.floor(Math.log2(sc) + 1));
      for (let i = 0; i < n; i++) st.marks.push({ kind: 'scratch', u: rand(), v: rand(), a: rand() * Math.PI, l: 0.2 + 0.5 * rand() * Math.min(1, sc / 20) });
      out.marks = n;
      st.hp = Math.max(0, st.hp - 0.004 * n);
    }
    // cracks and the breach: from the blow
    if (eN > A.crackJ) {
      const k = Math.min(1, (eN - A.crackJ) / Math.max(1, A.breachJ - A.crackJ));
      st.hp = Math.max(0, st.hp - (0.12 + 0.5 * k));
      st.marks.push({ kind: 'crack', u: rand(), v: rand(), a: rand() * Math.PI, l: 0.25 + 0.6 * k });
      out.crack = true;
      // a cracked pressure layer seeps; past the breach energy it gives way
      if (P.leak) st.leak = Math.max(st.leak, part === 'visor' && A.ballistic ? 0 : 2 + 10 * k);
      if (eN > A.breachJ || st.hp <= 0) {
        st.hp = 0;
        if (P.leak) st.leak = Math.max(st.leak, part === 'visor' ? 220 : 60);
        out.breach = true;
      }
    }
    // the deceleration: the speed change over the time the padding lets the contact last
    const dv = ev.vn * (1 + 0.3 * hard) * (Number.isFinite(M) ? M / (m + M) : 1);
    const g = dv / Math.max(0.01, S.padT * (1.2 - 0.5 * hard)) / G0;
    out.g = g;
    // the electronics: every system has a chance to drop out past the shock it is rated for, more
    // so in the part that took the blow
    const over = g / S.electronicsG;
    if (over > 0.6) {
      for (const k of Object.keys(this.sys)) {
        const local = (P.sys || []).includes(k) ? 1.8 : 0.6;
        const p = Math.min(0.9, (over - 0.6) * 0.5 * local);
        if (rand() < p) { const d = 0.2 + 0.8 * rand() * Math.min(1, over); this.sys[k] = Math.max(0, this.sys[k] - d); out.systems.push(k); }
      }
    }
    // a blow straight into the backpack can knock a booster out
    if (part === 'pack' && eN > A.crackJ * 0.6) {
      if (rand() < 0.5) this.boosterL = Math.max(0, this.boosterL - 0.5 - 0.5 * rand());
      else this.boosterR = Math.max(0, this.boosterR - 0.5 - 0.5 * rand());
      out.systems.push('boosters');
    }
    // the systems a part carries suffer with the part itself
    if (P.sys && st.hp < 0.5) for (const k of P.sys) this.sys[k] = Math.min(this.sys[k], st.hp * 1.6);
    // the wearer: bruising from ~10 g, worse fast past 30 g
    if (g > 10) this.injury = Math.min(1, this.injury + Math.pow((g - 10) / 60, 1.6));
    // dead computer or battery: the suit shuts down (passive life support only)
    if (!this.shutdown && (this.sys.computer < 0.08 || this.sys.battery < 0.05)) { this.shutdown = true; this.event('shutdown'); }
    if (st.marks.length > 60) st.marks.splice(0, st.marks.length - 60);
    if (out.breach) this.event('breach', part);
    else if (out.crack) this.event('crack', part);
    else if (out.marks) this.event('scratch', part);
    if (out.systems.length) this.event('systems', out.systems.join(','));
    this.lastImpact = out;
    return out;
  }

  event(kind, info = '') {
    this.log.push({ kind, info, t: performance.now() / 1000 });
    if (this.log.length > 20) this.log.shift();
    if (this.onEvent) this.onEvent(kind, info);
  }

  /** how sound the suit is overall, 0..1 */
  integrity() {
    let s = 0, n = 0;
    for (const p of Object.values(this.parts)) { s += p.hp; n++; }
    return s / n;
  }

  /** the visor's state for drawing it: 0 clear .. 1 shattered, its marks */
  visorState() { const p = this.parts.visor; return { hp: p.hp, marks: p.marks }; }

  serialize() {
    return {
      id: this.spec.id, battery: this.battery, spares: this.spares, o2: this.o2, reserve: this.reserve,
      parts: Object.fromEntries(Object.entries(this.parts).map(([k, p]) => [k, { hp: p.hp, leak: p.leak, marks: p.marks.slice(-30) }])),
      sys: { ...this.sys }, boosterL: this.boosterL, boosterR: this.boosterR, shutdown: this.shutdown, injury: this.injury,
    };
  }

  restore(s) {
    if (!s) return;
    this.battery = s.battery ?? 1; this.spares = s.spares ? s.spares.slice(0, this.spec.battery.spares) : this.spares;
    while (this.spares.length < this.spec.battery.spares) this.spares.push(1);
    this.o2 = s.o2 ?? 1; this.reserve = s.reserve ?? 1;
    if (s.parts) for (const [k, p] of Object.entries(s.parts)) if (this.parts[k]) Object.assign(this.parts[k], { hp: p.hp ?? 1, leak: p.leak ?? 0, marks: p.marks || [] });
    if (s.sys) Object.assign(this.sys, s.sys);
    this.boosterL = s.boosterL ?? 1; this.boosterR = s.boosterR ?? (this.spec.propulsion.boosters > 1 ? 1 : 0);
    this.shutdown = !!s.shutdown; this.injury = s.injury || 0;
  }

  /** repair everything (a workshop, a new suit) */
  repair() {
    for (const p of Object.values(this.parts)) { p.hp = 1; p.marks = []; p.leak = 0; }
    for (const k of Object.keys(this.sys)) this.sys[k] = 1;
    this.boosterL = 1; this.boosterR = this.spec.propulsion.boosters > 1 ? 1 : 0;
    this.shutdown = false;
  }
}

/** a contact's speeds from the suit's velocity relative to the surface and the surface normal
 *  (n: unit, from the surface toward the suit) */
export function contactSpeeds(relVel, n) {
  const vn = Math.max(0, -(relVel.x * n.x + relVel.y * n.y + relVel.z * n.z));
  const tx = relVel.x + n.x * vn, ty = relVel.y + n.y * vn, tz = relVel.z + n.z * vn;
  return { vn, vt: Math.hypot(tx, ty, tz) };
}
