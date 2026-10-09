// H8 makes its own ammunition. Under the cockpit floor, in the equipment bay, a compact fabricator
// turns a store of feedstock (steel and tungsten powder, the precursors of the explosive fill and
// the propellant, stored seeker and motor kits) into rounds, running on a part of the power its
// small reactor makes. Three lines, each with its own heads:
//   25 mm  — the body sintered, the HE fill and the tracer pressed in, the propellant cast in its
//            case: about 6 MJ a round;
//   レール — the tungsten slugs, sintered and ground: about 40 MJ each (the shot itself is paid for
//            by the storage when it is fired, not here);
//   ミサイル — the airframe printed round a seeker kit, the motor cast: about 2.4 GJ each.
// Normally the lines get a fixed share of the reactor (14 MW, a tenth of its rating) and fill the
// magazines slowly in the background; on priority they get everything the reactor (and B-29's
// feed, when coupled) can spare. The power is split between the lines that are not full by their
// shares; a line takes no more than its heads can use. The feedstock is used up as rounds are
// made and is topped up with everything else at a station berth.
//
// The fabricator knows nothing of the ship: it is given the magazines (counts), their sizes, and
// each step the power it may draw.

/** the lines: energy per unit (MJ), feedstock per unit (kg), the most power the line can use
 * (MW), its share of the power when the others want some too */
export const LINES = {
  cannon: { name: '25mm弾', mj: 6, kg: 0.34, lineMW: 70, share: 0.55 },
  rail: { name: 'レール弾', mj: 40, kg: 1.2, lineMW: 20, share: 0.15 },
  missile: { name: 'ミサイル', mj: 2400, kg: 48, lineMW: 30, share: 0.3 },
};
const KINDS = Object.keys(LINES);
/** feedstock carried (kg): enough to fill the magazines three times over */
export const FEED_KG = 3600;
/** the lines' share of the reactor in normal running (MW) */
export const NORMAL_MW = 14;

export class Arsenal {
  /** ammo: the magazines ({ cannon, rail, missile, ... } counts, changed in place); max: their
   * sizes; onMade(made): called with { kind: n } after a step that finished something */
  constructor(ammo, max, onMade = null) {
    this.ammo = ammo;
    this.max = max;
    this.onMade = onMade;
    this.prog = { cannon: 0, rail: 0, missile: 0 };   // MJ in the unit on each line
    this.lineMW = { cannon: 0, rail: 0, missile: 0 }; // what each line draws now
    this.mw = 0;                                       // the whole draw now
    this.feedKg = FEED_KG;
    this.priority = false;        // everything that can be spared, or the normal share
    this.by = null;               // who put it on priority ('hachi' | 'kaito')
    this.fired = { cannon: 0, rail: 0, missile: 0 };  // since the last step
    this.use = { cannon: 0, rail: 0, missile: 0 };    // what is being fired (units/s, smoothed)
    this.made = { cannon: 0, rail: 0, missile: 0 };   // in all (shown on the tab)
  }

  /** a line that has something to do: its magazine not full, feedstock for one more */
  open(k) { return this.ammo[k] < this.max[k] && this.feedKg >= LINES[k].kg; }

  /** the power the lines could use now (MW): nothing with every magazine full */
  wantMW() {
    let s = 0;
    for (const k of KINDS) if (this.open(k)) s += LINES[k].lineMW;
    return s;
  }

  /** mw split between the open lines by their shares (what a line cannot take goes to the rest) */
  split(mw, out = {}) {
    for (const k of KINDS) out[k] = 0;
    let left = mw;
    const live = KINDS.filter((k) => this.open(k));
    for (let pass = 0; pass < 3 && left > 1e-6 && live.length; pass++) {
      const room = live.filter((k) => out[k] < LINES[k].lineMW - 1e-9);
      if (!room.length) break;
      const tot = room.reduce((s, k) => s + LINES[k].share, 0);
      let used = 0;
      for (const k of room) {
        const give = Math.min(LINES[k].lineMW - out[k], left * LINES[k].share / tot);
        out[k] += give; used += give;
      }
      left -= used;
    }
    return out;
  }

  /** a round (missile) of this kind was fired: counted for the rate it is being used at */
  spent(kind, n = 1) { if (kind in this.fired) this.fired[kind] += n; }

  /** units a second each line turns out on mw (default: what it draws now) */
  rates(mw = this.mw) {
    const sp = this.split(mw);
    const out = {};
    for (const k of KINDS) out[k] = sp[k] / LINES[k].mj;
    return out;
  }

  /** seconds until the next unit of a line (Infinity when it is idle) */
  nextIn(k) {
    const p = this.lineMW[k];
    return p > 1e-6 ? (LINES[k].mj - this.prog[k]) / p : Infinity;
  }

  /** run the lines on mw megawatts for dt seconds */
  run(dt, mw) {
    if (dt <= 0) return;
    // what is being fired, smoothed over about 20 s
    const a = 1 - Math.exp(-dt / 20);
    for (const k of KINDS) { this.use[k] += (this.fired[k] / dt - this.use[k]) * a; this.fired[k] = 0; }
    this.mw = mw;
    const sp = this.split(mw, this.lineMW);
    let any = null;
    for (const k of KINDS) {
      const L = LINES[k];
      if (sp[k] <= 0) continue;
      this.prog[k] += sp[k] * dt;
      while (this.prog[k] >= L.mj && this.open(k)) {
        this.prog[k] -= L.mj;
        this.ammo[k]++;
        this.feedKg = Math.max(0, this.feedKg - L.kg);
        this.made[k]++;
        any = any || {};
        any[k] = (any[k] || 0) + 1;
      }
      // a full magazine: the line stops with its next unit part-made
      if (!this.open(k)) this.prog[k] = Math.min(this.prog[k], L.mj * 0.98);
    }
    if (any && this.onMade) this.onMade(any);
  }

  /** a station berth: the feedstock topped up */
  refill() { this.feedKg = FEED_KG; }

  serialize() { return { prog: { ...this.prog }, feed: Math.round(this.feedKg * 10) / 10, pri: this.priority, by: this.by, made: { ...this.made } }; }

  restore(s) {
    if (!s) return;
    if (s.prog) for (const k of KINDS) this.prog[k] = Math.max(0, Math.min(LINES[k].mj, +s.prog[k] || 0));
    if (Number.isFinite(s.feed)) this.feedKg = Math.max(0, Math.min(FEED_KG, s.feed));
    this.priority = !!s.pri;
    this.by = s.by || null;
    if (s.made) for (const k of KINDS) this.made[k] = +s.made[k] || 0;
  }
}
