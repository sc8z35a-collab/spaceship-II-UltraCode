// HACHI's mind: what H8's AI keeps working out in the background, and acts on.
//
//   air      — the cabin's pressure history: how fast it is falling and how long until it is
//              dangerous; a hole draining B-29 through the open port is first called out, then
//              sealed off on H8's side (unless Kaito reopened it); Kaito losing air in H8's cabin
//              gets the time left and the suit locker opened for him
//   threats  — every drone's distance, closing speed, state; an attack run is announced a few
//              seconds before it reaches gun range, with the direction seen from Kaito's eyes;
//              when a drone has its gun on the vessel HACHI is flying, a sideways jink
//   learning — each attack run is remembered (where it came in from, in the target's frame);
//              repeated patterns sharpen HACHI's fire control (tighter bursts)
//   triage   — damage that can be patched from outside is put in order (the leak first, then the
//              drive, the power bus...)
//   the link — with B-29 within range: the guns share the targets out (B-29's gun and H8's go
//              for different drones), B-29's troubles are relayed while Kaito is away in H8
//   asked    — situation report, threat summary, the way home, and what to do next
import * as THREE from 'three';
import { fmtDist } from './h8Display.js';
import { H8 } from './h8Spec.js';
import { ZONES } from '../ship/lifeSupport.js';
import { JUNCTIONS } from './h8.js';
import { ROUNDS } from '../combat/combat.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
const GUN = 2600;                   // the drones' gun range (m)
const STATE_JP = { attack: '攻撃中', hunt: '接近中', evade: '損傷して後退中', patrol: '巡回中' };

function mmss(sec) {
  if (!Number.isFinite(sec)) return '—';
  sec = Math.max(0, Math.round(sec));
  return sec >= 60 ? `${Math.floor(sec / 60)}分${sec % 60 ? (sec % 60) + '秒' : ''}` : `${sec}秒`;
}

export class HachiMind {
  constructor(v) {
    this.v = v;
    this.g = v.g;
    this.acc = 0;
    this.hist = [];              // { t (s), p: { h8, shaft, corr } }
    this.next = {};              // cooldowns: key -> game time (s) from which it may speak again
    this.runs = [];              // attack runs seen: unit vectors (where they came in from)
    this.runSeen = new Map();
    this.warned = new Map();
    this.learn = 0;              // 0..1: how well the drones' pattern has been read
    this.sealAskT = 0;
    this.sealHold = 0;           // Kaito reopened the port: no sealing it again before this time
    this.lastField = '';
    this.lastFieldN = 0;
    this.relayInteg = null;
    this.relayAir = new Set();
    this.jinkT = 0;
    this.h8Target = null;        // the drones the two guns are on (shared over the link)
    this.b29Target = null;
    this.air = { p: 101, rate: 0, tLow: Infinity };
  }

  get now() { return this.g.time / 1000; }

  /** a cooldown per callout */
  can(key, gap) {
    const t = this.now;
    if ((this.next[key] || 0) > t) return false;
    this.next[key] = t + gap;
    return true;
  }

  say(key, params, gap = 20) { if (this.can(key, gap)) this.v.say(key, params || {}, { force: true }); }

  /** Kaito worked the port himself after HACHI's warning (or its sealing): his call, for a while */
  userPort() {
    if (this.sealAskT || this.now - (this.sealedT ?? -1e9) < 600) this.sealHold = this.now + 300;
    this.sealAskT = 0;
  }

  update(dt) {
    const v = this.v;
    if (v.awake < 0.5 && v.mode !== 'docked') return;
    this.jinkT -= dt;
    this.watchDrones(dt);
    this.acc += dt;
    if (this.acc < 1) return;
    this.acc = 0;
    this.watchAir();
    this.watchFuel();
    this.watchField();
    this.watchB29();
  }

  // ------------------------------------------------------------------ air
  watchAir() {
    const g = this.g, v = this.v, ls = g.lifeSupport;
    if (!ls.z.h8) return;
    const t = this.now;
    const p = { h8: ls.pressure('h8'), shaft: ls.pressure('h8shaft'), corr: ls.pressure('corridor') };
    this.hist.push({ t, p });
    while (this.hist.length > 2 && t - this.hist[0].t > 20) this.hist.shift();
    const rate = (k) => {
      const h = this.hist;
      if (h.length < 4) return 0;
      const a = h[0], b = h[h.length - 1];
      return (b.p[k] - a.p[k]) / Math.max(1, b.t - a.t);        // kPa/s
    };
    const r = rate('h8');
    this.air = { p: p.h8, rate: r, tLow: r < -0.004 ? Math.max(0, (p.h8 - 60) / -r) : Infinity, corrRate: rate('corr') };
    const pl = g.player;
    const inH8 = v.containsPF(pl.pos) && (v.mode === 'docked' || v.crew);
    // docked, and H8's hole drains B-29 too through the open port: say so, then seal H8's side
    if (v.mode === 'docked' && v._leak && ls.leaky.has('corridor') && ls.leaky.has('h8')) {
      const inColumn = v.inColumn(pl.pos) || inH8;
      if (!this.sealAskT) {
        this.sealAskT = t;
        this.say('hachi_port_leak', { r: Math.max(0.1, -this.air.corrRate * 60).toFixed(1) }, 40);
      } else if (t - this.sealAskT > 20 && t > this.sealHold && !inColumn && v.neckTarget > 0.5) {
        v.neckTarget = 0;
        this.sealedT = t;
        this.say('hachi_port_seal', {}, 10);
      }
    } else this.sealAskT = 0;
    // Kaito in H8's cabin while it loses air: the time left, and the suit brought out
    if (inH8 && (r < -0.02 || v._leak) && this.air.tLow < 300) {
      if (!pl.suit) {
        if (v.locker.target < 0.5) { v.locker.target = 1; v.lockerSound(); }
        if (p.h8 < 62) this.say('hachi_air_danger', { p: Math.round(p.h8) }, 30);
        else this.say('hachi_air_suit', { t: mmss(this.air.tLow), r: (-r * 60).toFixed(1) }, 30);
      } else this.say('hachi_air_suited', { t: mmss(this.air.tLow) }, 90);
    }
  }

  // ------------------------------------------------------------------ drones
  /** the drones near the vessel they are after, the most dangerous first */
  threats() {
    const g = this.g, D = g.drones;
    if (!D || !D.started) return [];
    const T = D.target();
    const out = [];
    for (const d of D.list) {
      if (!d.alive) continue;
      const rel = _v.copy(d.pos).sub(T.pos);
      const dist = rel.length();
      if (dist > 90e3) continue;
      const closing = -rel.dot(_v2.copy(d.vel).sub(T.vel)) / Math.max(1, dist);
      let s = 1 / (1 + dist / 1500);
      if (d.state === 'attack') s *= 2;
      if (d.run) s *= 1.5;
      if (closing > 0) s *= 1 + closing / 600;
      if (d.ammo <= 0) s *= 0.3;
      s *= 1 + (1 - d.hp) * 0.6;
      out.push({ d, id: d.id, dist, closing, state: d.state, hp: d.hp, ammo: d.ammo, score: s });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** a direction as Kaito sees it (from where his eyes are, the way he is looking) */
  dirWord(posEci) {
    const g = this.g;
    const rel = _v3.copy(posEci).sub(g.origin).sub(g.camWorld).applyQuaternion(_q.copy(g.camQuat).invert());
    const az = Math.atan2(rel.x, -rel.z) * 180 / Math.PI, el = Math.atan2(rel.y, Math.hypot(rel.x, rel.z)) * 180 / Math.PI;
    const a = Math.abs(az), side = az > 0 ? '右' : '左';
    const h = a < 25 ? '正面' : a < 70 ? side + '前方' : a < 115 ? side : a < 160 ? side + '後方' : '真後ろ';
    const vv = el > 35 ? '上' : el < -35 ? '下' : '';
    return vv ? `${h}の${vv}` : h;
  }

  watchDrones(dt) {
    const g = this.g, v = this.v, D = g.drones;
    if (!D || !D.started) return;
    const T = D.target();
    const pl = g.player;
    for (const d of D.list) {
      if (!d.alive) { this.runSeen.delete(d.id); this.warned.delete(d.id); continue; }
      // (H8 and B-29 have already been stepped, the drones not yet: brought to the same instant)
      const rel = _v.copy(d.pos).addScaledVector(d.vel, dt).sub(T.pos);
      const dist = rel.length();
      if (dist > 90e3) continue;
      const closing = -rel.dot(_v2.copy(d.vel).sub(T.vel)) / Math.max(1, dist);
      // a new attack run: where it came in from, in the target's own frame — the same way again?
      if (d.run && this.runSeen.get(d.id) !== d.run) {
        this.runSeen.set(d.id, d.run);
        const q = T.kind === 'h8' ? v.flight.quat : g.flight.quat;
        const from = rel.clone().normalize().applyQuaternion(_q.copy(q).invert());
        const same = this.runs.filter((x) => x.angleTo(from) < 0.6).length;
        this.runs.push(from);
        if (this.runs.length > 12) this.runs.shift();
        this.learn = Math.min(1, this.learn + (same ? 0.18 : 0.07));
        if (same >= 2) this.say('hachi_pattern', { id: d.id, pct: Math.round(this.learn * 100) }, 120);
      }
      // the run announced a few seconds before it reaches gun range
      if (d.state === 'attack' && closing > 60 && dist > GUN) {
        const tGun = (dist - GUN) / closing;
        if (tGun < 9 && !this.warned.get(d.id)) {
          this.warned.set(d.id, true);
          this.say('hachi_incoming', { id: d.id, dir: this.dirWord(d.pos), t: Math.max(1, Math.round(tGun)) }, 5);
        }
      }
      if (dist > GUN * 1.7) this.warned.delete(d.id);
      // its gun on the vessel HACHI is flying: a sideways jink out of the line of fire
      if (this.jinkT <= 0 && dist < GUN + 600 && d.burst > 0 && !v.dodge) {
        // where its rounds go, relative to us: does that line pass through the vessel?
        const rb = _v2.set(0, 0, -1).applyQuaternion(d.q).multiplyScalar(ROUNDS.drone.speed).add(d.vel).sub(T.vel);
        const along = rel.dot(rb);
        const miss = along < 0 ? _v3.crossVectors(rel, rb).length() / Math.max(1, rb.length()) : Infinity;
        const onUs = miss < (T.R || 10) * 2.2;
        const flight = T.kind === 'h8' ? (v.solo ? v.flight : null) : (v.mode === 'docked' ? g.flight : null);
        const seated = pl.state === 'seated';
        const fi = T.kind === 'h8' ? v.flightInput : g.lastFlightIn;
        const hands = !(fi && (Math.abs(fi.throttle || 0) + Math.abs(fi.yaw || 0) + Math.abs(fi.pitch || 0) + Math.abs(fi.roll || 0) > 0.1));
        const free = !(g.docking && g.docking.state !== 'free') && !g.flight.landed;
        if (onUs && flight && seated && hands && free) {
          const side = new THREE.Vector3().crossVectors(rel, flight.pos).normalize();
          if (side.lengthSq() < 0.5) side.set(1, 0, 0);
          if (Math.random() < 0.5) side.negate();
          // (H8 alone is nimble; the pair with B-29 is not)
          v.dodge = { v: side.multiplyScalar(T.kind === 'h8' ? 13 : 8), t: 2.2, flight };
          this.jinkT = T.kind === 'h8' ? 2.6 : 3.5;
          this.say('hachi_jink', {}, 30);
        }
      }
    }
  }

  /**
   * The target for one of the guns on auto: the most dangerous drone in range; over the link the
   * two guns share them out (H8's on one, B-29's on another when there is one)
   */
  pickTarget(which, range, list) {
    const ds = list.filter((x) => x.kind === 'drone' && x.dist < range);
    if (!ds.length) { if (which === 'h8') this.h8Target = null; else this.b29Target = null; return null; }
    const v = this.v, linked = v.mode === 'docked' || v.link.ok;
    const other = which === 'h8' ? this.b29Target : this.h8Target;
    let best = null, bs = -Infinity;
    for (const x of ds) {
      const d = x.ref;
      let s = 1 / (1 + x.dist / 1500);
      if (d.state === 'attack') s *= 2;
      if (d.run) s *= 1.5;
      s *= 1 + (1 - d.hp);
      if (linked && other && d === other && ds.length > 1) s *= 0.3;
      if (s > bs || !best) { bs = s; best = x; }
    }
    const was = which === 'h8' ? this.h8Target : this.b29Target;
    if (which === 'h8') this.h8Target = best.ref; else this.b29Target = best.ref;
    // the split said out loud, once in a while
    if (linked && this.h8Target && this.b29Target && this.h8Target !== this.b29Target && was !== best.ref && this.g.weapons.auto.asphalt && this.g.weapons.auto.hachi && this.can('split', 75)) {
      v.say('hachi_split', { a: this.h8Target.id, b: this.b29Target.id }, { force: true });
      setTimeout(() => this.g.asphalt.say('asp_split', { b: this.b29Target ? this.b29Target.id : '' }, { force: true }), 2600);
    }
    return best;
  }

  /** HACHI's own fire control: tighter as the pattern is read; B-29's gun gets the shared track */
  spread(which) {
    if (which === 'h8') return 1 - 0.4 * this.learn;
    const v = this.v;
    return (v.mode === 'docked' || v.link.ok) && v.awake > 0.5 ? 0.85 : 1;
  }

  // ------------------------------------------------------------------ fuel, damage, B-29
  watchFuel() {
    const g = this.g, v = this.v;
    if (!v.solo || !v.link.ok) return;
    const d = v.flight.pos.distanceTo(g.flight.pos);
    if (d < 3000) return;
    const need = v.tripFuel(v.flight, d), have = v.flight.tank.kg;
    if (have < need * 1.3) this.say('hachi_fuel_plan', { need: Math.round(need), kg: Math.round(have), d: fmtDist(d) }, 300);
  }

  prio(it) {
    if (it.kind === 'hole') return this.v._leak ? 0 : 3;
    if (it.kind === 'circuit') return { 'c:drive': 1, 'c:power': 2, 'c:fire': 4, 'c:sensor': 5, 'c:comms': 6 }[it.id] ?? 6;
    return 7;
  }

  watchField() {
    const v = this.v, g = this.g;
    const F = v.fieldIssues();
    const key = F.map((x) => x.id).sort().join(',');
    if (key === this.lastField) return;
    const added = F.length > this.lastFieldN;
    this.lastField = key; this.lastFieldN = F.length;
    if (added && F.length >= 2 && !(g.drones && g.drones.attacking > 0)) {
      const o = F.slice().sort((a, b) => this.prio(a) - this.prio(b));
      this.say('hachi_triage', { n: F.length, a: o[0].name, b: o[1].name }, 90);
    }
  }

  watchB29() {
    const g = this.g, v = this.v;
    // the other way round: Kaito in B-29, H8 out on its own — Asphalt passes HACHI's news on
    if (!v.crew && v.mode === 'free' && v.link.ok && v.awake > 0.5) {
      const arm = v.armour.outer;
      if (this.relayArm != null && arm < this.relayArm - 0.08 && this.can('aspRelayH8', 30)) g.asphalt.say('asp_relay_h8', { pct: Math.round(arm * 100) }, { force: true });
      this.relayArm = arm;
    } else this.relayArm = null;
    if (!v.solo || !v.link.ok) { this.relayInteg = null; this.relayAir.clear(); return; }
    const integ = g.damage.integrity();
    if (this.relayInteg !== null && integ < this.relayInteg - 0.03) this.say('hachi_relay_hit', { pct: Math.round(integ * 100) }, 30);
    this.relayInteg = integ;
    const ls = g.lifeSupport;
    for (const id of Object.keys(ls.z)) {
      if (id.startsWith('h8') || !ZONES[id]) continue;
      const low = ls.pressure(id) < 75;
      if (low && !this.relayAir.has(id)) { this.relayAir.add(id); this.say('hachi_relay_air', { zone: ZONES[id].name, kpa: Math.round(ls.pressure(id)) }, 45); }
      else if (!low && ls.pressure(id) > 90) this.relayAir.delete(id);
    }
  }

  // ------------------------------------------------------------------ asked
  ask(kind) {
    const text = kind === 'sitrep' ? this.sitrep() : kind === 'threat' ? this.threatReport() : kind === 'plan' ? this.planReport() : this.advice();
    this.v.say('hachi_free', { text }, { force: true });
  }

  sitrep() {
    const v = this.v, g = this.g, A = v.armour, a = this.air;
    const s = [];
    s.push(`船内${Math.round(g.lifeSupport.pressure('h8'))}キロパスカル` + (a.rate < -0.01 ? `、毎分${(-a.rate * 60).toFixed(1)}ずつ低下中` : '、安定'));
    s.push(`外部装甲${Math.round(A.outer * 100)}パーセント、内部${Math.round(A.inner * 100)}パーセント`);
    const cut = Object.entries(v.circuits).filter(([, c]) => c < 0.9).map(([k]) => JUNCTIONS[k].name);
    s.push(cut.length ? `損傷している回路は${cut.join('と')}` : '回路は全部生きている');
    s.push(`推進剤${Math.round(v.flight.fuel * 100)}パーセント、蓄電${Math.round(100 * v.power.smes / H8.smesMJ)}パーセント`);
    const thr = this.threats();
    s.push(thr.length ? `無人機${thr.length}機、一番危ないのは${thr[0].id}で距離${fmtDist(thr[0].dist)}` : '敵影なし');
    if (v.mode !== 'docked') s.push(v.link.ok ? `B-29まで${fmtDist(v.link.d)}、リンク良好` : 'B-29とは通信圏外');
    return s.join('。') + '。';
  }

  threatReport() {
    const thr = this.threats();
    if (!thr.length) return '敵影なし。今は静かだ。';
    const t = thr[0], d = t.d;
    let s = `無人機${thr.length}機。一番危ないのは${t.id}、距離${fmtDist(t.dist)}、${d.run ? '攻撃航過中' : STATE_JP[t.state] || t.state}`;
    if (t.closing > 30) s += `、毎秒${Math.round(t.closing)}メートルで接近`;
    if (t.hp < 1) s += `、損傷${Math.round((1 - t.hp) * 100)}パーセント`;
    const dry = thr.filter((x) => x.ammo <= 0).length;
    if (dry) s += `。弾切れが${dry}機`;
    if (this.learn > 0.25) s += `。攻撃パターンの解析は${Math.round(this.learn * 100)}パーセント`;
    return s + '。';
  }

  planReport() {
    const v = this.v, g = this.g;
    if (v.mode === 'docked') {
      let best = null, bd = Infinity;
      for (const st of g.stations.list) { const d = st.pos.distanceTo(g.flight.pos); if (d < bd) { bd = d; best = st; } }
      const integ = Math.round(g.damage.integrity() * 100);
      return best ? `結合中だ。一番近い補給・修理先は${best.name.replace('（修理基地）', '')}、距離${fmtDist(bd)}。B-29の健全度は${integ}パーセント。` : `結合中だ。B-29の健全度は${integ}パーセント。`;
    }
    if (!v.link.ok) return `B-29とは通信圏外だ。距離${fmtDist(v.link.d)}。1500キロ以内に寄らないと呼べない。`;
    const d = v.link.d, need = v.tripFuel(v.flight, d), have = v.flight.tank.kg;
    const eta = d / Math.max(50, Math.min(v.maxSpeed(), Math.sqrt(v.brakeAccel() * d)));
    return have >= need
      ? `B-29まで${fmtDist(d)}。戻るのに推進剤は約${Math.round(need)}キロ、残りは${Math.round(have)}キロ。足りる。到着まで約${mmss(eta)}。`
      : `B-29まで${fmtDist(d)}。戻るには約${Math.round(need)}キロ要るが、残りは${Math.round(have)}キロだ。B-29に迎えに来てもらう方がいい。`;
  }

  advice() {
    const v = this.v, g = this.g, pl = g.player, a = this.air;
    const inH8 = v.containsPF(pl.pos) && (v.mode === 'docked' || v.crew);
    if (inH8 && a.tLow < 300 && !pl.suit) return `スーツを着ろ。あと${mmss(a.tLow)}で船内が危険な気圧になる。左の収納庫だ。`;
    if (v.mode === 'docked' && v._leak && g.lifeSupport.leaky.has('corridor')) return 'H8の穴からB-29の空気まで抜けている。ポートのハッチを閉めて、外から穴をふさげ。';
    const thr = this.threats();
    const atk = thr.filter((x) => x.state === 'attack');
    if (atk.length) {
      const W = g.weapons;
      if (W && !W.auto.hachi) return `${atk[0].id}が攻撃してくる。自動迎撃を入れておけ。私が撃つ。`;
      if (W && W.ammo.missile > 0 && atk[0].dist > 1500) return `${atk[0].id}は距離${fmtDist(atk[0].dist)}。ミサイルが届く。残り${W.ammo.missile}発だ。`;
      return `${atk[0].id}が${this.dirWord(atk[0].d.pos)}にいる。座席から離れるな。避けるのは私がやる。`;
    }
    const F = v.fieldIssues().sort((x, y) => this.prio(x) - this.prio(y));
    if (F.length) return `船外に出て${F[0].name}を直せ。${F[0].need === 'patches' ? 'パッチ' : '部品'}が要る。場所はバイザーに出す。`;
    if (v.solo && v.flight.fuel < 0.25) return 'B-29に戻って推進剤を入れろ。';
    if (v.armour.outer < 0.5 || g.damage.integrity() < 0.6) return '修理基地で直すべきだ。ステーションに寄れ。';
    return '今は特に問題ない。外でも眺めていろ。';
  }
}
