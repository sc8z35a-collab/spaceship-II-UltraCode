// HACHI's watch over a fight: the enemies inside 50 km of H8, and whether the ammunition can keep
// up with them — what is in the magazines and what the fabricator (combat/arsenal.js) will make
// before the fight is over, against what it will take to stop them, and what is being fired now
// against what is being made. When it reckons the ammunition will not keep up (whether the
// automatic intercept is on or not):
//   - the drive goes to LOW (an ULTRA or MAX run is cut first): the drive's power draw falls;
//   - separately, the fabricator gets every megawatt the reactor (and B-29's feed) can spare.
// Kaito can take the drive out of LOW: the fabricator goes back to its normal share with it, and
// HACHI leaves it alone for a minute — if the enemies are still inside and the ammunition is still
// short after that, LOW goes back on. Turning the priority off himself works the same way for the
// priority. Once no enemy is left inside the zone the drive goes back to what it was before HACHI
// stepped in, and the fabricator to its normal share.
export const ZONE = 50e3;          // the enemies HACHI counts (m)
const CLEAR = 60e3;                // every one beyond this: the fight is over (a margin against flicker)
const WAIT = 60;                   // s: Kaito turned it off himself; HACHI waits this long
/** what stopping one drone takes, as HACHI's fire control has found (a jinking drone at a few km
 * takes one 25 mm round in thirty or so to find it, fourteen hits to break it up; a slug that
 * finds it nearly does it alone but most miss; a missile mostly gets there) */
const PER_KILL = { cannon: 400, rail: 7, missile: 1.4 };
const KINDS = ['cannon', 'rail', 'missile'];

export class HachiDefence {
  constructor(vessel) {
    this.v = vessel;
    this.auto = null;          // HACHI put the drive on LOW: { prev: the drive mode to go back to }
    this.autoPri = false;      // HACHI put the fabricator on priority
    this.waitUntil = 0;        // (game s) Kaito took the drive out of LOW: not before then
    this.waitPriUntil = 0;     // (game s) Kaito turned the priority off: not before then
    this.again = false;        // HACHI has stepped in once in this fight already
    this.judgeT = 0;
    this.short = false;
    this.n = 0;                // enemies inside the zone
    this.need = 0;             // what they will take (kills)
    this.have = 0;             // what the magazines and the lines can deliver over the fight (kills)
    this.nearest = null;
    this.releasedAt = -1e9;    // (game s) when HACHI last undid its fight settings
  }

  now() { return this.v.g.time / 1000; }

  /** H8 is up and its guns are there */
  active() {
    const v = this.v;
    return v.mode !== 'parked' && v.mode !== 'pod' && v.mode !== 'lost' && v.awake > 0.5 && !!(v.g.weapons && v.g.weapons.arsenal);
  }

  /** the drones round H8 out to the margin: [{ d, dist }] nearest first */
  threats() {
    const g = this.v.g, out = [];
    if (!g.drones) return out;
    const P = this.v.mode === 'docked' ? g.flight.pos : this.v.flight.pos;
    for (const d of g.drones.list) {
      if (!d.alive) continue;
      const dist = d.pos.distanceTo(P);
      if (dist < CLEAR) out.push({ d, dist, hp: d.hp });
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  /**
   * The judgement: will the ammunition keep up with the enemies inside the zone? In kills: the
   * stock and what the lines make (at the power they get now) over the fight HACHI expects, against
   * what the enemies will take; and any magazine being fired faster than it is made that would run
   * dry before the fight is over
   */
  judge(list) {
    const W = this.v.g.weapons, A = W.arsenal, am = W.ammo;
    const n = list.length;
    const need = list.reduce((s, x) => s + Math.max(0.35, x.hp), 0);
    const horizon = Math.min(400, 60 + 30 * n);
    const r = A.rates();
    // (a magazine holds no more than it holds: what is made beyond that is not there to fire)
    let have = 0;
    for (const k of KINDS) have += Math.min(A.max[k], am[k] + r[k] * horizon) / PER_KILL[k];
    let short = have < need * 1.5;
    for (const k of KINDS) {
      const net = A.use[k] - r[k];
      if (net > 1e-3 && am[k] / net < horizon) short = true;
    }
    this.need = need; this.have = have;
    return short;
  }

  update(dt) {
    const v = this.v;
    if (!this.active()) {
      if (this.auto || this.autoPri) this.release(false);
      this.n = 0; this.short = false; this.nearest = null;
      return;
    }
    const T = this.threats();
    const inside = T.filter((x) => x.dist < ZONE);
    this.n = inside.length;
    this.nearest = inside[0] || null;
    if (!T.length) {
      // the fight is over: the drive back as it was, the lines to their normal share
      if (this.auto || this.autoPri) this.release(true);
      this.short = false; this.again = false;
      return;
    }
    this.judgeT -= dt;
    if (this.judgeT > 0) return;
    this.judgeT = 1;
    if (!inside.length) return;
    this.short = this.judge(inside);
    if (!this.short) return;
    const A = v.g.weapons.arsenal, now = this.now();
    const wantLow = v.driveMode !== 'low' && now >= this.waitUntil;
    const wantPri = !A.priority && now >= this.waitPriUntil;
    if (!wantLow && !wantPri) return;
    const was = v.driveMode;
    if (wantLow && v.setDriveMode('low', true, true, 'hachi')) this.auto = { prev: was };
    if (wantPri) { A.priority = true; A.by = 'hachi'; this.autoPri = true; }
    const cut = wantLow && (was === 'ultra' || was === 'max');
    v.say(this.again ? 'hachi_low_again' : cut ? 'hachi_low_cut' : wantLow ? 'hachi_low_auto' : 'hachi_ammo_pri', { mode: was === 'max' ? 'MAX' : 'ULTRA' }, { force: true });
    this.again = true;
  }

  /** the enemies are gone (or H8 is down): undo what HACHI did */
  release(say) {
    const v = this.v, A = v.g.weapons && v.g.weapons.arsenal;
    const prev = this.auto ? this.auto.prev : null;
    this.auto = null;
    if (prev && v.driveMode === 'low' && this.active()) {
      // (ULTRA or MAX cannot always be had back: the storage may be too low for it now)
      if (!v.setDriveMode(prev, true, false, 'hachi')) v.setDriveMode('normal', true, true, 'hachi');
    }
    if (A && this.autoPri && A.by === 'hachi') { A.priority = false; A.by = null; }
    this.autoPri = false;
    if (say) { v.say(prev ? 'hachi_low_restore' : 'hachi_ammo_normal', { mode: v.driveModeName() }, { force: true }); this.releasedAt = this.now(); }
  }

  /** the drive mode changed (byHachi: HACHI did it) */
  onDrive(from, to, byHachi) {
    if (from !== 'low' || to === 'low') return;
    // out of LOW: the fabricator back to its normal share
    const A = this.v.g.weapons && this.v.g.weapons.arsenal;
    if (A && A.priority) { A.priority = false; A.by = null; }
    this.autoPri = false;
    if (!byHachi && this.auto) {
      // Kaito took it out himself: HACHI stays out of it for a minute
      this.auto = null;
      this.waitUntil = this.waitPriUntil = this.now() + WAIT;
      this.v.say('hachi_low_off_ack', {}, { force: true });
    }
  }

  /** Kaito switched the fabricator's priority himself */
  onPriority(on) {
    const A = this.v.g.weapons.arsenal;
    if (on) { A.by = 'kaito'; this.autoPri = false; return; }
    if (this.autoPri) this.waitPriUntil = this.now() + WAIT;
    this.autoPri = false;
  }

  /** a line for the tab: the zone and the judgement */
  line() {
    if (!this.n) return '50 km 圏内 敵なし';
    const near = this.nearest ? `  最寄り ${(this.nearest.dist / 1000).toFixed(1)} km` : '';
    return `50 km 圏内 敵 ${this.n}${near}  ${this.short ? '弾薬 不足見込み' : '弾薬 足りる見込み'}`;
  }

  serialize() { return { auto: this.auto ? { prev: this.auto.prev } : null, pri: this.autoPri }; }
  restore(s) {
    if (!s) return;
    this.auto = s.auto && ['normal', 'ultra', 'max', 'low'].includes(s.auto.prev) ? { prev: s.auto.prev } : null;
    this.autoPri = !!s.pri;
  }
}
