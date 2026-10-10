// H8's three cockpit displays (mixed into Monitors). Each has a row of tabs on top and can show
// any page: SYS — reactor, storage, propellant, power feed, drive, armour, cabin air; NAV —
// HACHI's destinations, docking and undocking, manual / autonomous, boost; CAM — the four outside
// cameras one at a time. Docked, the tabs also open B-29's own pages (navigation and autopilot,
// systems and doors, life support, reactor, comms), so B-29 can be flown and run from H8's seat;
// apart, the LINK page shows B-29 over the radio (within 1500 km) and calls it over.
// Plus H8's corner on B-29's navigation screen and its box on B-29's comms screen.
import * as THREE from 'three';
import { COL } from '../ui/monitorKit.js';
import { H8, CAMERAS } from './h8Spec.js';
import { fmtDist, altOf } from './h8Display.js';

const AMBER = '#ffb347';

function stateJP(h) {
  if (h.mode === 'docked') return 'B-29 と結合中';
  if (h.mode === 'parked') return '停泊（待機）';
  const P = h.pilot;
  if (h.berthAt) return h.berthAt.name.replace('（修理基地）', '') + ' に係留中';
  if (P.state === 'dock') return 'ドッキング進入';
  if (P.state === 'undock') return '離脱中';
  if (h.goalKind === 'b29') return 'B-29 へ向かう';
  if (h.goalKind === 'escort') return 'B-29 を護衛';
  if (h.goalKind === 'home') return '停泊軌道へ帰還';
  if (P.goal) return P.goal.name + ' へ';
  return h.crew ? '手動操縦' : '待機';
}

function b29StateJP(g) {
  const ap = g.autopilot, f = g.flight;
  if (g.docking && g.docking.state === 'docked') return 'ステーションに係留中';
  if (ap.state === 'cruise' || ap.state === 'approach') return (ap.target ? ap.target.name.replace('（修理基地）', '').replace('（サブ拠点）', '') : '目的地') + ' へ自動航行';
  if (ap.state === 'hold') return '到着・位置保持';
  if (f.landed) return '地上に着陸中';
  return '待機（姿勢保持）';
}

const TABS_H8 = [{ id: 'h8sys', label: 'H8 系統', h8: true }, { id: 'h8nav', label: 'H8 航法', h8: true }, { id: 'h8wpn', label: '兵装', h8: true }, { id: 'h8cam', label: 'カメラ', h8: true }, { id: 'h8shl', label: '退避', h8: true }];
const TABS_B29 = [{ id: 'nav', label: 'B29 航法' }, { id: 'sys', label: 'B29 系統' }, { id: 'life', label: '生命維持' }, { id: 'reactor', label: '原子炉' }, { id: 'comms', label: '通信' }];

export const H8_PAGES = {
  // ------------------------------------------------------------------ tabs
  h8TabList(m) {
    const h = this.g.h8;
    // (the shelter's screen: its own home page first, the way back from any other)
    const home = m && m.slot && m.slot.shelter ? [{ id: 'h8sh', label: '◀ ホーム', h8: true }] : [];
    // adrift in the shelter: its own state and the radio, nothing else is left
    if (h && h.mode === 'pod') return home.concat([{ id: 'h8shl', label: 'シェルター', h8: true }, { id: 'h8link', label: 'B-29 リンク' }]);
    return home.concat(h && h.mode === 'docked' ? TABS_H8.concat(TABS_B29) : TABS_H8.concat([{ id: 'h8link', label: 'B-29 リンク' }]));
  },

  /** the page an H8 screen shows (its own until a tab is picked; B-29's pages only while docked) */
  h8PageOf(m) {
    const tabs = this.h8TabList(m);
    if (!m.page || !tabs.some((t) => t.id === m.page)) {
      if (m.page && m.page !== m.id) this.setFeed(m, false);
      m.page = m.id;
    }
    return m.page;
  },

  h8Tabs(K, m) {
    const tabs = this.h8TabList(m);
    const w = 512 / tabs.length;
    const al = this.g.systems.alarm;
    const blink = al.active && !al.silenced && Math.floor(performance.now() / 450) % 2;
    K.rect(0, 0, 512, 26, { fill: 'rgba(6,12,20,0.96)', stroke: null, r: 0 });
    tabs.forEach((t, i) => {
      const on = m.page === t.id;
      const col = t.h8 ? AMBER : COL.cyan;
      const alarmTab = !t.h8 && t.id !== 'h8link' && blink;
      K.rect(i * w + 1.5, 2, w - 3, 22, { fill: on ? (t.h8 ? 'rgba(255,170,60,0.24)' : 'rgba(95,208,255,0.22)') : alarmTab ? 'rgba(255,77,61,0.3)' : 'rgba(255,255,255,0.03)', stroke: on ? col : 'rgba(150,190,230,0.2)', r: 5 });
      K.text(t.label, i * w + w / 2, 17, { size: tabs.length > 6 ? 9 : 10.5, color: on ? '#fff' : col, align: 'center', weight: on ? 700 : 500 });
      K.buttons.push(Object.assign(K.textBox(t.label, i * w + w / 2, 13, tabs.length > 6 ? 9 : 10.5, on ? 700 : 500), { onTap: () => { if (m.page !== t.id) { m.page = t.id; this.setFeed(m, false); } } }));
    });
  },

  // ------------------------------------------------------------------ SYS
  draw_h8sys(K, m, H) {
    const g = this.g, h = g.h8;
    if (!h) return;
    const P = h.power;
    this.header(K, 'H8  システム', H);
    let y = 34;
    K.text(`HACHI ${h.awake > 0.5 ? 'ONLINE' : 'STANDBY'}   ${stateJP(h)}`, 12, y + 9, { size: 10, color: h.awake > 0.5 ? COL.green : COL.dim });
    y += 16;
    const row = (label, v, txt, col, warn) => {
      K.text(label, 12, y + 8, { size: 10.5, color: COL.dim });
      K.bar(108, y, 270, 8, v, warn ? COL.red : col);
      K.text(txt, 500, y + 9, { size: 10.5, color: warn ? COL.red : COL.text, align: 'right', mono: true });
      y += 20;
    };
    const T = h.flight.tank;
    row('原子炉', P.reactor, `${Math.round(P.reactor * H8.reactorMW)} / ${H8.reactorMW} MW`, COL.green);
    row('超電導蓄電', P.smes / H8.smesMJ, `${(P.smes / 1000).toFixed(1)} GJ`, COL.cyan, P.smes < H8.smesMJ * 0.1);
    row('推進剤', T.kg / T.cap, `${Math.round(T.kg).toLocaleString()} kg`, AMBER, T.kg < T.cap * 0.15);
    row('負荷', Math.min(1, P.loadMW / 360), `${Math.round(P.loadMW)} MW`, AMBER);
    row('ドライブ', Math.min(1, P.driveMW / H8.driveMW.boost), `${Math.round(P.driveMW)} MW`, COL.violet);
    row('外部装甲', h.armour.outer, `${Math.round(h.armour.outer * 100)} %`, COL.green, h.armour.outer < 0.35);
    row('内部装甲', h.armour.inner, `${Math.round(h.armour.inner * 100)} %`, COL.green, h.armour.inner < 0.5);
    // feed and propellant lines
    const docked = h.mode === 'docked';
    K.rect(10, y + 2, 492, 44, { fill: COL.bg2, r: 8 });
    K.text('B-29 との接続（電力・推進剤）', 20, y + 18, { size: 10, color: COL.dim });
    const st = P.feed ? `${Math.round(P.feedMW)} MW 受電` : docked ? (h.umb > 0.02 && h.umb < 0.98 ? 'アンビリカル接続中…' : P.feedOn ? '待機' : '給電 切') : '未接続';
    K.text(st + (h.xfer === 'toB29' ? '・推進剤を B-29 へ' : h.fueling ? '・推進剤 補給中' : ''), 20, y + 37, { size: 12, color: P.feed || h.fueling ? COL.green : COL.text, weight: 600 });
    K.button(262, y + 8, 76, 32, P.feedOn ? '給電 ON' : '給電 OFF', () => h.toggleFeed(), { style: P.feedOn ? 'on' : 'normal', size: 10 });
    K.button(342, y + 8, 76, 32, P.boost ? 'ブースト' : 'ブースト切', () => h.toggleBoost(), { style: P.boost ? 'on' : 'normal', size: 10 });
    K.button(422, y + 8, 76, 32, h.xfer === 'toB29' ? '移送 停止' : '推進剤→B29', () => h.setXfer('toB29'), { style: !docked ? 'disabled' : h.xfer === 'toB29' ? 'warn' : 'normal', size: 9 });
    y += 54;
    // cabin
    const z = g.lifeSupport.z.h8;
    if (z) {
      const p = z.n2 + z.o2 + z.co2;
      K.text(`船内 ${p.toFixed(1)} kPa   O2 ${z.o2.toFixed(1)}   CO2 ${z.co2.toFixed(2)}`, 12, y + 8, { size: 10.5, color: p > 90 ? COL.text : COL.red, mono: true });
    }
    const hopen = h.hatch ? h.hatch.open : 0;
    K.text(`下部ハッチ ${h.neckOpen > 0.98 && hopen > 0.98 ? '開' : h.neckOpen > 0.01 || hopen > 0.01 ? '動作中' : '閉'}`, 330, y + 8, { size: 10.5, color: COL.dim });
    if (docked) K.button(410, H - 30, 92, 24, h.neckTarget > 0.5 ? 'ハッチ 閉' : 'ハッチ 開', () => h.portTapped(), { size: 10 });
    const cams = h.hull.cams.map((c, i) => (c < 0.5 ? CAMERAS[i].name.split(' ')[0] : null)).filter(Boolean);
    const holed = h.hull.dents.some((d) => d.hole);
    K.text(`被弾 ${h.hits} 回   へこみ ${h.hull.dents.length} か所${h.hull.tiles.length ? `   装甲板脱落 ${h.hull.tiles.length} 枚` : ''}${holed ? '（貫通あり）' : ''}${cams.length ? '   映像なし: ' + cams.join(' ') : ''}`, 12, H - 12, { size: 9.5, color: cams.length || holed ? COL.red : COL.dim });
  },

  // ------------------------------------------------------------------ NAV
  draw_h8nav(K, m, H) {
    const g = this.g, h = g.h8;
    if (!h) return;
    const fl = h.mode === 'docked' ? g.flight : h.flight;
    this.header(K, 'H8  ナビ / HACHI', H);
    const vRel = fl.vel.clone().sub(fl.refVelocity(fl.pos, new THREE.Vector3())).length();
    K.rect(10, 32, 240, 62, { fill: COL.bg2, r: 8 });
    K.text('速度', 20, 47, { size: 10, color: COL.dim });
    K.text(vRel.toFixed(1), 20, 80, { size: 26, color: COL.text, weight: 300, mono: true });
    K.text('m/s', 128, 80, { size: 11, color: COL.dim });
    K.text('高度', 176, 47, { size: 10, color: COL.dim });
    K.text((altOf(fl.pos) / 1000).toFixed(1), 240, 70, { size: 15, color: COL.text, align: 'right', mono: true });
    K.text('km', 240, 86, { size: 9, color: COL.dim, align: 'right' });
    const mul = h.mode === 'docked' ? g.flight.mul : 6 * h.flight.mul;
    K.text(`推力 ×${mul}   最高 ${(fl.vUltra / 1000).toFixed(1)} km/s   推進剤 ${Math.round(h.flight.fuel * 100)}%`, 14, 108, { size: 10, color: AMBER, mono: true });
    // B-29 relation
    const L = h.linkState();
    K.text(h.mode === 'docked' ? 'B-29 上部ポートに結合中' : h.berthAt ? `${h.berthAt.name.replace('（修理基地）', '')} に係留中` : `B-29 まで ${fmtDist(L.d)}  ${L.ok ? 'リンク良好' : '通信圏外'}`, 14, 126, { size: 11, color: h.berthAt ? COL.cyan : L.ok ? COL.text : COL.red });
    // HACHI's state line
    const P = h.pilot;
    if (P.goal || P.state === 'dock' || P.state === 'undock') K.text(`HACHI: ${stateJP(h)}  ${fmtDist(P.dist || 0)}${P.eta > 1 ? '  残り ' + fmtEta(P.eta) : ''}`, 14, 144, { size: 10.5, color: COL.cyan });
    if (P.notes && P.notes.length) K.text('回避行動中', 14, 160, { size: 11, color: COL.red, weight: 700 });
    // HACHI's recent words
    const log = g.asphalt.log.filter((e) => e.who === 'hachi').slice(-3).reverse();
    if (log.length) {
      K.rect(10, 168, 240, H - 206, { fill: 'rgba(255,170,60,0.05)', stroke: 'rgba(255,170,80,0.18)', r: 6 });
      K.text('HACHI ログ', 18, 181, { size: 9, color: COL.dim });
      let ly = 196;
      for (const e of log) {
        const t = e.text.replace(/^HACHI: /, '');
        K.text(t.length > 22 ? t.slice(0, 21) + '…' : t, 18, ly, { size: 10, color: COL.text });
        ly += 15;
        if (ly > H - 44) break;
      }
    }
    // commands (right)
    const X = 262;
    let y = 32;
    const btn = (label, fn, style = 'normal', hh = 26) => { K.button(X, y, 240, hh, label, fn, { style, size: 11 }); y += hh + 4; };
    if (h.mode === 'docked') {
      // undocking from B-29, right here
      btn(h.pending ? 'ハッチを閉めて分離中…' : h.crew ? 'B-29 から分離（単独飛行）' : 'H8 を分離（護衛）', () => h.release(h.crew ? 'free' : 'escort'), h.pending ? 'on' : 'danger', 34);
      if (!h.crew) btn('分離して停泊軌道へ', () => h.release('home'));
      btn(h.power.feedOn ? '給電を止める' : '給電する', () => h.toggleFeed(), h.power.feedOn ? 'on' : 'normal');
      btn(h.xfer === 'toB29' ? '推進剤の移送を止める' : '推進剤を B-29 へ送る', () => h.setXfer('toB29'), h.xfer === 'toB29' ? 'warn' : 'normal');
      K.text('上のタブで B-29 の航法・システムも操作できます', X + 120, y + 12, { size: 9, color: COL.dim, align: 'center' });
    } else {
      if (h.mode === 'parked') btn('H8 起動（B-29 へ）', () => h.call(), 'warn');
      else if (h.berthAt) {
        btn(`${h.berthAt.name.replace('（修理基地）', '')} から離脱`, () => h.unberth('free'), 'danger', 34);
        btn('B-29 へ帰還・ドッキング', () => h.call(), 'warn');
      } else {
        btn(h.goalKind === 'b29' ? 'B-29 へ帰還中…（中止）' : 'B-29 へ帰還・ドッキング', () => (h.goalKind === 'b29' ? h.goal('hold') : h.call()), h.goalKind === 'b29' ? 'on' : 'warn');
        const ap = g.autopilot, coming = ap.state !== 'off' && ap.target && ap.target.id === 'h8';
        btn(coming ? 'B-29 が来ます（中止）' : 'B-29 を呼ぶ（ここへ）', () => (coming ? ap.disengage() : h.callB29()), coming ? 'on' : L.ok ? 'normal' : 'disabled');
        btn(h.crew ? (P.goal ? '手動操縦にする' : '手動操縦中') : '待機', () => h.goal('hold'), !P.goal ? 'on' : 'normal');
        btn('停泊軌道へ', () => h.sendHome(), h.goalKind === 'home' ? 'on' : 'normal');
        if (h.crew) {
          const modes = h.driveModes();
          const bw = 240 / modes.length;
          modes.forEach((md, i) => K.button(X + i * bw + 1, y, bw - 2, 26, md.label, () => h.setDriveMode(md.id), { style: md.on ? (md.id === 'max' ? 'danger' : md.id === 'ultra' ? 'warn' : 'on') : md.ok ? 'normal' : 'disabled', size: 10 }));
          y += 30;
        }
      }
      // stations (HACHI flies there and holds; 接続: and docks H8 with it, straight in)
      if (h.crew && y < H - 40) {
        K.text('自律航行先 / 接続でドッキング', X + 4, y + 10, { size: 10, color: COL.dim });
        y += 16;
        for (const s of g.stations.list) {
          if (y > H - 30) break;
          const st = s.dmg ? s.dmg.status : 'ok';
          const dd = s.pos.distanceTo(h.flight.pos);
          const sel = h.goalKind === s.id;
          const here = h.berthAt === s, dg = h.dockGoal === s;
          K.rect(X, y, 186, 20, { fill: sel ? 'rgba(95,208,255,0.14)' : 'rgba(255,255,255,0.02)', stroke: sel ? COL.cyan : 'rgba(120,190,255,0.12)', r: 5 });
          K.text(s.name.replace('（修理基地）', ''), X + 8, y + 14, { size: 10, color: st === 'ok' ? COL.text : COL.dim });
          K.text(fmtDist(dd), X + 180, y + 14, { size: 9, color: COL.dim, align: 'right', mono: true });
          K.buttons.push({ x: X, y, w: 186, h: 20, onTap: () => h.goal(s.id) });
          K.button(X + 190, y, 50, 20, here ? '係留中' : dg ? '接続中' : '接続', () => h.dockWith(s.id), { style: here || dg ? 'on' : st === 'ok' || st === 'damaged' ? 'normal' : 'disabled', size: 9 });
          y += 23;
        }
      }
    }
    K.button(10, H - 30, 120, 24, h.power.boost ? 'ブースト ON' : 'ブースト OFF', () => h.toggleBoost(), { style: h.power.boost ? 'on' : 'normal', size: 10 });
  },

  // ------------------------------------------------------------------ CAM
  draw_h8cam(K, m, H) {
    const g = this.g, h = g.h8;
    if (!h) return;
    K.g.clearRect(0, 0, m.W, m.H);
    K.buttons.length = 0;
    m.camI = m.camI || 0;
    const ci = ((m.camI % 4) + 4) % 4;
    const cam = CAMERAS[ci];
    if (!m.h8Feed) {
      m.h8Feed = () => {
        const c = CAMERAS[((m.camI % 4) + 4) % 4];
        const p = c.dir.clone().multiplyScalar(H8.R + 0.8);
        const up = Math.abs(c.dir.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
        const local = new THREE.Matrix4().lookAt(p, p.clone().add(c.dir), up).setPosition(p);
        return h.root.matrixWorld.clone().multiply(local);
      };
    }
    m.feedSrc = m.h8Feed;
    this.feedHealth = h.hull.cams[ci];
    this.setFeed(m, true, [0, 0.13, 1, 0.74]);
    this.h8Tabs(K, m);
    const dead = h.hull.cams[ci] < 0.5;
    K.rect(0, 26, 512, 16, { fill: 'rgba(23,13,5,0.92)', stroke: null, r: 0 });
    K.text('H8 船外  ' + cam.name + (dead ? '  （映像なし）' : ''), 10, 38, { size: 10, color: dead ? COL.red : AMBER, weight: 700 });
    if (Math.floor(performance.now() / 600) % 2) K.circle(497, 34, 4, { fill: COL.red, stroke: null });
    K.button(10, H - 30, 80, 24, '◀ 前', () => { m.camI--; }, { size: 10 });
    K.button(422, H - 30, 80, 24, '次 ▶', () => { m.camI++; }, { size: 10 });
  },

  // ------------------------------------------------------------------ WEAPONS
  draw_h8wpn(K, m, H) {
    const g = this.g, h = g.h8, W = g.weapons;
    if (!h || !W) return;
    this.header(K, 'H8  兵装', H);
    let y = 34;
    const row = (label, v, txt, col, warn) => {
      K.text(label, 12, y + 8, { size: 10.5, color: COL.dim });
      K.bar(108, y, 270, 8, v, warn ? COL.red : col);
      K.text(txt, 500, y + 9, { size: 10.5, color: warn ? COL.red : COL.text, align: 'right', mono: true });
      y += 20;
    };
    row('25mm 機関砲', W.ammo.cannon / 1600, `${W.ammo.cannon}`, AMBER, W.ammo.cannon < 200);
    row('レールガン', W.railCharge, W.railCharge < 1 ? `充電 ${Math.round(W.railCharge * 100)}%  残 ${W.ammo.rail}` : `発射可  残 ${W.ammo.rail}`, COL.cyan, W.ammo.rail <= 0);
    row('ミサイル', W.ammo.missile / 12, `${W.ammo.missile} / 12`, '#ff8a6a', W.ammo.missile <= 0);
    K.text('目標（命中見込み 25mm / レール）', 12, y + 10, { size: 10, color: COL.dim });
    y += 16;
    const T = W.targets('h8').slice(0, 5);
    if (!T.length) { K.text('目標なし', 14, y + 10, { size: 11, color: COL.dim }); y += 18; }
    const prim = W.lastTarget || W.primary('h8');
    const pc = (p) => (p == null ? '—' : p >= 0.995 ? '99%' : p < 0.005 ? '<1%' : Math.round(p * 100) + '%');
    for (const x of T) {
      const sel = prim && prim.id === x.id;
      K.rect(10, y, 492, 20, { fill: sel ? 'rgba(255,90,60,0.16)' : 'rgba(255,255,255,0.02)', stroke: sel ? COL.red : 'rgba(150,190,230,0.15)', r: 5 });
      K.text(`${sel ? '◆ ' : ''}${x.name}${x.threat ? '  敵' : ''}`, 18, y + 14, { size: 10.5, color: x.threat ? '#ffb3a6' : COL.text });
      K.text(`${fmtDist(x.dist)}   ${pc(W.hitChance(x, 'cannon'))} / ${pc(W.hitChance(x, 'rail'))}`, 494, y + 14, { size: 10, color: COL.dim, align: 'right', mono: true });
      K.buttons.push({ x: 10, y, w: 492, h: 20, onTap: () => { const c = h.cands.find((q) => q.id === x.id); if (c) h.hud.lock(c, true); } });
      y += 23;
    }
    const bw = 160, by = H - 34;
    K.button(10, by, bw, 28, W.auto.hachi ? 'HACHI 自動迎撃' : '手動射撃', () => W.toggleAuto('h8'), { style: W.auto.hachi ? 'on' : 'normal', size: 10.5 });
    K.button(10 + bw + 6, by, bw, 28, 'レールガン', () => W.fireRail(true), { style: W.railCharge >= 1 && W.ammo.rail > 0 ? 'warn' : 'disabled', size: 10.5 });
    K.button(10 + (bw + 6) * 2, by, bw, 28, 'ミサイル', () => W.fireMissile('h8'), { style: W.ammo.missile > 0 ? 'danger' : 'disabled', size: 10.5 });
  },

  // ------------------------------------------------------------------ SHELTER
  draw_h8shl(K, m, H) {
    const g = this.g, h = g.h8;
    if (!h) return;
    const S = h.shelter, pod = h.mode === 'pod';
    this.header(K, 'H8  緊急シェルター', H);
    let y = 34;
    K.text(pod ? 'H8 喪失 — シェルター単独で漂流中' : S.busy ? '座席 移動中' : S.occupied ? (S.sealed ? '密閉・独立酸素で運用中' : '扉 開') : S.door > 0.02 ? '扉 開' : '待機', 12, y + 12, { size: 13, color: pod ? COL.red : COL.text, weight: 700 });
    y += 24;
    const row = (label, v, txt, col, warn) => {
      K.text(label, 12, y + 8, { size: 10.5, color: COL.dim });
      K.bar(108, y, 270, 8, v, warn ? COL.red : col);
      K.text(txt, 500, y + 9, { size: 10.5, color: warn ? COL.red : COL.text, align: 'right', mono: true });
      y += 20;
    };
    const o2h = S.o2Hours();
    row('独立酸素', o2h / 10, S.o2Text(), COL.green, o2h < 1);
    row('CO2 吸収剤', S.lioh, `${Math.round(S.lioh * 100)} %`, COL.cyan, S.lioh < 0.1);
    row('電池', S.battery, `${Math.round(S.battery * 100)} %`, AMBER, S.battery < 0.15);
    const z = g.lifeSupport.z.h8shelter;
    if (z) { const p = z.n2 + z.o2 + z.co2; K.text(`内部 ${p.toFixed(1)} kPa   O2 ${z.o2.toFixed(1)}   CO2 ${z.co2.toFixed(2)}`, 12, y + 10, { size: 10.5, color: p > 90 && z.o2 > 17 ? COL.text : COL.red, mono: true }); y += 20; }
    K.text('推進なし・発電なし。H8 が失われてもここだけは残る。', 12, y + 10, { size: 10, color: COL.dim }); y += 18;
    if (pod) {
      const d = g.flight.pos.distanceTo(h.flight.pos);
      const ap = g.autopilot, coming = ap.state !== 'off' && ap.target && ap.target.id === 'h8';
      const R = h.rescue, can = h.b29Rescue();
      let line, col;
      if (R) {
        const nm = R.s.name.replace('（修理基地）', '');
        line = R.state === 'latched' ? `${nm}の救助艇が確保 — 曳航中` : R.state === 'dock' ? `${nm}の救助艇 ドッキング中  ${fmtDist(R.dist)}` : `${nm}の救助艇 接近中  ${fmtDist(R.dist)}${R.eta > 1 ? '  約' + Math.max(1, Math.round(R.eta / 60)) + '分' : ''}`;
        col = COL.green;
      } else if (coming) { line = `B-29 が回収に向かっています  ${fmtDist(d)}`; col = COL.green; }
      else { line = `B-29 まで ${fmtDist(d)}  ${can.ok ? 'ビーコン受信中' : 'B-29 は' + can.why + '動けない'}`; col = can.ok ? COL.text : COL.amber; }
      K.text(line, 12, y + 12, { size: 12, color: col, weight: 600 });
      const busy = !!R || coming;
      K.button(10, H - 34, 260, 28, R ? '救助艇が向かっています' : coming ? 'B-29 が回収に向かっています' : can.ok ? 'B-29 に回収を要請' : '最寄りのステーションに救助を要請', () => { if (!busy) h.requestRescue(); }, { style: busy ? 'on' : 'warn', size: 11 });
    } else if (S.occupied) {
      K.button(10, H - 34, 200, 28, S.busy ? '移動中…' : 'コックピットへ戻る', () => S.goBack(), { style: S.busy ? 'on' : 'warn', size: 11 });
      const pl = g.player, suitOn = pl.suit && pl.suitH8;
      K.button(220, H - 34, 160, 28, suitOn ? '宇宙服を脱ぐ' : S.locker.target > 0.5 ? '宇宙服を着る' : '宇宙服を出す', () => h.lockerTapped(), { style: 'normal', size: 11 });
    }
  },

  /**
   * The shelter's screen, laminated on the door in front of him: its home page. The view out on the
   * left (H8's cameras in turn; adrift, the shelter's own little camera), on the right what keeps
   * him alive — oxygen in hours, the scrubber, the battery, the air — and who is coming; along the
   * bottom the few things to do from here. Every page of H8's (and B-29's over the link) is one
   * press away (H8 操作), the home page one press back.
   */
  draw_h8sh(K, m, H) {
    const g = this.g, h = g.h8;
    if (!h) return;
    const S = h.shelter, pod = h.mode === 'pod', x = K.g, s = K.s;
    const t = performance.now() / 1000;
    // the page: near-black, warm, a faint glow along the top edge
    x.fillStyle = '#05070a'; x.fillRect(0, 0, m.W, m.H);
    const gl = x.createLinearGradient(0, 0, 0, 60 * s);
    gl.addColorStop(0, 'rgba(255,170,70,0.10)'); gl.addColorStop(1, 'rgba(255,170,70,0)');
    x.fillStyle = gl; x.fillRect(0, 0, m.W, 60 * s);
    // ---- the top line: what state the shelter is in, the time
    const st = pod ? 'H8 喪失 — 単独で漂流中' : S.busy ? '座席 移動中' : S.sealed ? '密閉 ・ 独立酸素で運用中' : '扉 開';
    K.circle(16, 18, 4, { fill: pod ? (Math.floor(t * 2) % 2 ? COL.red : 'rgba(255,77,61,0.3)') : S.sealed ? COL.green : AMBER, stroke: null });
    K.text('SHELTER', 27, 23, { size: 13, color: AMBER, weight: 800 });
    K.text(st, 104, 23, { size: 12.5, color: pod ? '#ffb3a6' : '#eef4fa', weight: 600 });
    const d = new Date(g.time);
    K.text(`${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`, 500, 23, { size: 12, color: 'rgba(220,232,245,0.7)', align: 'right', mono: true });
    K.line(10, 33, 502, 33, 'rgba(255,190,110,0.18)');
    // ---- the view out (left): a window through the page to the live picture
    m.camI = m.camI || 0;
    const ci = ((m.camI % 4) + 4) % 4;
    m.feedSrc = () => {
      // (adrift: the little camera on the shelter's shell, looking back the way it came)
      const dir = pod ? new THREE.Vector3(0.2, 0.1, 1).normalize() : CAMERAS[((m.camI % 4) + 4) % 4].dir;
      const p = pod ? new THREE.Vector3(0.5, 1.0, 1.95) : dir.clone().multiplyScalar(H8.R + 0.8);
      const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
      const local = new THREE.Matrix4().lookAt(p, p.clone().add(dir), up).setPosition(p);
      return h.root.matrixWorld.clone().multiply(local);
    };
    this.feedHealth = pod ? 1 : h.hull.cams[ci];
    const fx = 10, fy = 42, fw = 296, fh = 222;
    this.setFeed(m, true, [fx / 512, 1 - (fy + fh) / H, fw / 512, fh / H]);
    x.save();
    x.globalCompositeOperation = 'destination-out';
    x.beginPath(); x.roundRect ? x.roundRect(fx * s, fy * s, fw * s, fh * s, 10 * s) : x.rect(fx * s, fy * s, fw * s, fh * s); x.fill();
    x.restore();
    K.rect(fx, fy, fw, fh, { fill: null, stroke: 'rgba(255,200,130,0.22)', r: 10, lw: 1 });
    const dead = !pod && h.hull.cams[ci] < 0.3;
    K.rect(fx + 8, fy + fh - 28, 150, 20, { fill: 'rgba(3,5,8,0.62)', stroke: null, r: 10 });
    K.text(pod ? '外部カメラ（後方）' : CAMERAS[ci].name + (dead ? '  映像なし' : ''), fx + 18, fy + fh - 14, { size: 10.5, color: dead ? COL.red : '#f3e6d4', weight: 600 });
    if (Math.floor(t * 1.6) % 2) K.circle(fx + fw - 14, fy + 14, 3.5, { fill: COL.red, stroke: null });
    if (!pod) K.buttons.push({ x: fx, y: fy, w: fw, h: fh, onTap: () => { m.camI++; } });
    // ---- what keeps him alive (right): big numbers, thin bars
    const X = 320, RW = 182;
    let y = 46;
    const gauge = (label, big, unit, v, col, warn, sub) => {
      K.text(label, X, y + 9, { size: 10.5, color: 'rgba(210,222,236,0.72)', weight: 600 });
      if (sub) K.text(sub, X + RW, y + 9, { size: 9.5, color: 'rgba(210,222,236,0.5)', align: 'right' });
      K.text(big, X, y + 36, { size: 25, color: warn ? COL.red : '#f6f9fc', weight: 300, mono: true });
      x.font = `300 ${Math.round(25 * s)}px "SF Mono","Menlo","Consolas",monospace`;
      const bw = x.measureText(big).width / s;
      K.text(unit, X + bw + 5, y + 36, { size: 11, color: 'rgba(210,222,236,0.6)' });
      K.bar(X, y + 43, RW, 3, v, warn ? COL.red : col, 'rgba(255,255,255,0.07)');
      y += 58;
    };
    const o2h = S.o2Hours();
    gauge('酸素', o2h >= 10 ? '10+' : o2h.toFixed(1), '時間', o2h / 10, COL.green, o2h < 1, '独立ボンベ');
    gauge('CO₂ 吸収剤', String(Math.round(S.lioh * 100)), '%', S.lioh, COL.cyan, S.lioh < 0.1);
    gauge('電池', String(Math.round(S.battery * 100)), '%', S.battery, AMBER, S.battery < 0.15, pod ? '照明・画面・カメラ' : 'H8 から充電');
    const z = g.lifeSupport.z.h8shelter;
    if (z) {
      const p = z.n2 + z.o2 + z.co2;
      K.text(`内部 ${p.toFixed(0)} kPa ・ O₂ ${z.o2.toFixed(1)} ・ CO₂ ${z.co2.toFixed(2)}`, X, y + 4, { size: 9.5, color: p > 90 && z.o2 > 17 ? 'rgba(210,222,236,0.6)' : COL.red, mono: true });
    }
    // ---- who is coming (adrift), or the link to B-29
    let line, col = 'rgba(210,222,236,0.75)';
    const L = h.linkState ? h.linkState() : { ok: false, d: 0 };
    if (pod) {
      const ap = g.autopilot, coming = ap.state !== 'off' && ap.target && ap.target.id === 'h8';
      const R = h.rescue;
      if (R) { const nm = R.s.name.replace('（修理基地）', ''); line = R.state === 'latched' ? `${nm}の救助艇が確保 — 曳航中` : `${nm}の救助艇 ${fmtDist(R.dist)}${R.eta > 1 ? ' ・ 約' + Math.max(1, Math.round(R.eta / 60)) + '分' : ''}`; col = COL.green; }
      else if (coming) { line = `B-29 が回収に向かっています ・ ${fmtDist(g.flight.pos.distanceTo(h.flight.pos))}`; col = COL.green; }
      else line = `B-29 まで ${fmtDist(g.flight.pos.distanceTo(h.flight.pos))} ・ ビーコン発信中`;
    } else line = h.mode === 'docked' ? 'B-29 と結合中' : `B-29 ${fmtDist(L.d)} ・ ${L.ok ? 'リンク良好' : '通信圏外'}`;
    K.text(line, fx, fy + fh + 20, { size: 11, color: col, weight: 600 });
    // ---- what can be done from here
    const by = H - 40, bh = 32;
    const pl = g.player, suitOn = pl.suit && pl.suitH8;
    const btns = [];
    if (pod) {
      const R = h.rescue, ap = g.autopilot, coming = ap.state !== 'off' && ap.target && ap.target.id === 'h8';
      const busy = !!R || coming;
      btns.push([busy ? '救助 向かっています' : '救助を要請', () => { if (!busy) h.requestRescue(); }, busy ? 'on' : 'warn']);
      btns.push(['B-29 リンク', () => { m.page = 'h8link'; this.setFeed(m, false); }, 'normal']);
      btns.push([suitOn ? '宇宙服を脱ぐ' : S.locker.target > 0.5 ? '宇宙服を着る' : '宇宙服を出す', () => h.lockerTapped(), 'normal']);
    } else {
      btns.push([S.busy ? '移動中…' : 'コックピットへ戻る', () => S.goBack(), S.busy ? 'on' : 'warn']);
      btns.push([suitOn ? '宇宙服を脱ぐ' : S.locker.target > 0.5 ? '宇宙服を着る' : '宇宙服を出す', () => h.lockerTapped(), 'normal']);
      btns.push(['H8 操作', () => { m.page = 'h8sys'; this.setFeed(m, false); }, 'normal']);
    }
    const gap = 8, bw = (492 - gap * (btns.length - 1)) / btns.length;
    btns.forEach(([label, fn, style], i) => K.button(10 + i * (bw + gap), by, bw, bh, label, fn, { style, size: 12 }));
  },

  /** the shelter's small screen: one view out (H8's cameras in turn; adrift, its own camera) */
  draw_h8shcam(K, m, H) {
    const g = this.g, h = g.h8;
    if (!h) return;
    K.g.clearRect(0, 0, m.W, m.H);
    K.buttons.length = 0;
    const pod = h.mode === 'pod';
    m.camI = m.camI || 0;
    const ci = ((m.camI % 4) + 4) % 4;
    m.feedSrc = () => {
      // (adrift: the little camera on the shelter's shell, looking back the way it came)
      const dir = pod ? new THREE.Vector3(0.2, 0.1, 1).normalize() : CAMERAS[((m.camI % 4) + 4) % 4].dir;
      const p = pod ? new THREE.Vector3(0.5, 1.0, 1.95) : dir.clone().multiplyScalar(H8.R + 0.8);
      const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
      const local = new THREE.Matrix4().lookAt(p, p.clone().add(dir), up).setPosition(p);
      return h.root.matrixWorld.clone().multiply(local);
    };
    this.feedHealth = pod ? 1 : h.hull.cams[ci];
    this.setFeed(m, true, [0, 0, 1, 1]);
    const dead = !pod && h.hull.cams[ci] < 0.3;
    K.text(pod ? 'シェルター外部カメラ' : CAMERAS[ci].name + (dead ? '  映像なし' : ''), 8, 16, { size: 13, color: dead ? COL.red : AMBER, weight: 700 });
    if (!pod) K.buttons.push({ x: 0, y: 0, w: 512, h: H, onTap: () => { m.camI++; } });
  },

  // ------------------------------------------------------------------ LINK (apart: B-29 over the radio)
  draw_h8link(K, m, H) {
    const g = this.g, h = g.h8;
    if (!h) return;
    this.header(K, 'B-29 リンク', H);
    const L = h.linkState(), fb = g.flight, ap = g.autopilot;
    K.rect(10, 32, 492, 44, { fill: COL.bg2, r: 8 });
    K.text('B-29', 22, 50, { size: 13, color: COL.cyan, weight: 700 });
    K.text(L.ok ? 'リンク良好' : L.why === 'range' ? '通信圏外（1500 km 超）' : 'B-29 応答なし', 70, 50, { size: 11, color: L.ok ? COL.green : COL.red, weight: 600 });
    K.text(`距離 ${fmtDist(L.d)}`, 490, 50, { size: 13, color: COL.text, align: 'right', mono: true });
    K.bar(22, 62, 468, 5, 1 - Math.min(1, L.d / 1.5e6), L.ok ? COL.green : COL.red);
    let y = 92;
    if (L.ok) {
      const integ = g.damage.integrityNow ?? g.damage.integrity();
      const pw = g.systems.power ?? 1;
      const row = (label, v, txt, col, warn) => {
        K.text(label, 14, y + 8, { size: 10.5, color: COL.dim });
        K.bar(100, y, 240, 8, v, warn ? COL.red : col);
        K.text(txt, 410, y + 9, { size: 10.5, color: warn ? COL.red : COL.text, align: 'right', mono: true });
        y += 20;
      };
      K.text('状態  ' + b29StateJP(g), 14, y + 4, { size: 11, color: COL.text }); y += 18;
      row('推進剤', fb.fuel, `${Math.round(fb.tank ? fb.tank.kg : 0).toLocaleString()} kg`, AMBER, fb.fuel < 0.15);
      row('船体', integ, `${Math.round(integ * 100)} %`, COL.green, integ < 0.6);
      row('電力', pw, `${Math.round(pw * 100)} %`, COL.cyan, pw < 0.4);
      const al = g.systems.alarm.active;
      K.text('警報  ' + (al ? '作動中' : 'なし'), 14, y + 8, { size: 10.5, color: al ? COL.red : COL.green }); y += 20;
    } else {
      K.text(L.why === 'range' ? '1500 km 以内に近づくと、状況の確認と呼び出しができます。' : 'B-29 のサーバーが損傷しているようです。', 14, y + 8, { size: 10.5, color: COL.dim });
      K.text('B-29 の位置は 360° ディスプレイの B-29 マーカーで追えます。', 14, y + 26, { size: 10, color: COL.dim });
    }
    // buttons (right)
    const X = 420;
    const coming = ap.state !== 'off' && ap.target && ap.target.id === 'h8';
    const need = L.ok ? h.tripFuel(fb, L.d) : 0;
    K.button(X, 88, 82, 40, coming ? '呼出 中止' : 'B-29 を呼ぶ', () => (coming ? ap.disengage() : h.callB29()), { style: !L.ok ? 'disabled' : coming ? 'on' : 'warn', size: 10 });
    K.button(X, 134, 82, 30, '状況報告', () => h.reportB29(), { style: L.ok ? 'normal' : 'disabled', size: 10 });
    K.button(X, 170, 82, 30, 'H8 で迎えに', () => h.call(), { style: L.ok ? 'normal' : 'disabled', size: 9 });
    if (L.ok && !coming) K.text(`B-29 を呼ぶと B-29 の推進剤を 約 ${Math.ceil(need).toLocaleString()} kg 使います`, 14, H - 14, { size: 9.5, color: fb.tank && fb.tank.kg < need ? COL.red : COL.dim });
    if (coming) K.text(`B-29 自動航行中  残り ${fmtDist(ap.dist || 0)}  ${ap.eta > 1 ? fmtEta(ap.eta) : ''}`, 14, H - 14, { size: 10, color: COL.cyan });
  },

  // ------------------------------------------------------------------ B-29 nav: the H8 corner
  drawH8Strip(K, x, y) {
    const g = this.g, h = g.h8;
    if (!h) return;
    const w = 168;
    const L = h.linkState();
    K.rect(x, y, w, 52, { fill: 'rgba(20,12,4,0.86)', stroke: 'rgba(255,170,80,0.5)', r: 6 });
    K.text('H8', x + 8, y + 17, { size: 13, color: AMBER, weight: 700 });
    const s = h.mode === 'lost' ? '喪失' : h.mode === 'pod' ? `シェルター  ${fmtDist(L.d)}` : h.mode === 'docked' ? '結合中' : L.ok ? `${stateJP(h)}  ${fmtDist(L.d)}` : `圏外  ${fmtDist(L.d)}`;
    K.text(s.length > 14 ? s.slice(0, 13) + '…' : s, x + 34, y + 17, { size: 11, color: L.ok && h.mode !== 'lost' ? COL.text : COL.red });
    let label, fn, style = 'normal';
    if (h.mode === 'lost') { label = '修理基地で再建造'; fn = null; style = 'disabled'; }
    else if (h.mode === 'pod') { label = 'シェルターを回収に行く'; fn = () => h.rescuePod(); style = 'danger'; }
    else if (h.mode === 'docked') { label = '分離'; fn = () => h.release('escort'); style = 'warn'; }
    else if (h.goalKind === 'b29' || h.pilot.state === 'dock') { label = '呼び戻し中…（中止）'; fn = () => h.goal('hold'); style = 'on'; }
    else if (!L.ok) { label = '通信圏外（呼べません）'; fn = null; style = 'disabled'; }
    else { label = h.mode === 'parked' ? 'H8 を呼ぶ' : 'H8 を呼ぶ（ドッキング）'; fn = () => h.call(); style = 'warn'; }
    K.button(x + 6, y + 24, w - 12, 24, label, fn, { style, size: 11 });
  },

  /** H8's box on B-29's comms screen: the link, H8's state, call / report */
  drawH8Comms(K, x, y, w, hh) {
    const g = this.g, h = g.h8;
    if (!h) return;
    const L = h.linkState();
    K.rect(x, y, w, hh, { fill: 'rgba(20,12,4,0.82)', stroke: 'rgba(255,170,80,0.45)', r: 6 });
    K.text('H8 リンク', x + 8, y + 15, { size: 10, color: AMBER, weight: 700 });
    K.text(h.mode === 'docked' ? '結合中' : L.ok ? fmtDist(L.d) : '圏外', x + w - 8, y + 15, { size: 9, color: L.ok ? COL.green : COL.red, align: 'right' });
    K.text(stateJP(h), x + 8, y + 31, { size: 9, color: COL.text });
    K.text(`推進剤 ${Math.round(h.flight.fuel * 100)}%  装甲 ${Math.round(h.armour.outer * 100)}%`, x + 8, y + 45, { size: 8.5, color: COL.dim });
    const bw = (w - 20) / 2;
    if (h.mode === 'docked') K.button(x + 6, y + hh - 26, w - 12, 20, '分離', () => h.release('escort'), { style: 'warn', size: 9 });
    else {
      K.button(x + 6, y + hh - 26, bw, 20, '呼ぶ', () => h.call(), { style: L.ok ? 'warn' : 'disabled', size: 9 });
      K.button(x + 14 + bw, y + hh - 26, bw, 20, '報告', () => h.reportH8(), { style: L.ok ? 'normal' : 'disabled', size: 9 });
    }
  },
};

function fmtEta(s) {
  if (s < 60) return Math.round(s) + '秒';
  if (s < 3600) return Math.round(s / 60) + '分';
  return (s / 3600).toFixed(1) + '時間';
}
