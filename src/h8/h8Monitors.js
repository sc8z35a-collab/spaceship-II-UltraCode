// H8's three cockpit displays (mixed into Monitors): SYS — reactor, storage, power feed, drive,
// armour, cabin air; NAV — HACHI's destinations, docking, manual / autonomous, boost; CAM — the
// four outside cameras one at a time. Plus the H8 strip on B-29's own navigation screen.
import * as THREE from 'three';
import { COL } from '../ui/monitorKit.js';
import { H8, CAMERAS } from './h8Spec.js';
import { fmtDist, altOf } from './h8Display.js';

const AMBER = '#ffb347';

function head(K, title, sub) {
  K.rect(0, 0, 512, 26, { fill: 'rgba(255,170,60,0.09)', stroke: null, r: 0 });
  K.line(0, 26, 512, 26, 'rgba(255,170,80,0.35)');
  K.text(title, 12, 18, { size: 12, color: AMBER, weight: 700 });
  if (sub) K.text(sub, 500, 18, { size: 11, color: COL.dim, align: 'right', mono: true });
}

function stateJP(h) {
  if (h.mode === 'docked') return 'B-29 と結合中';
  if (h.mode === 'parked') return '停泊（休眠）';
  const P = h.pilot;
  if (P.state === 'dock') return 'ドッキング進入';
  if (P.state === 'undock') return '離脱中';
  if (h.goalKind === 'b29') return 'B-29 へ向かう';
  if (h.goalKind === 'escort') return 'B-29 を護衛';
  if (h.goalKind === 'home') return '停泊軌道へ帰還';
  if (P.goal) return P.goal.name + ' へ';
  return h.crew ? '手動操縦' : '待機';
}

export const H8_PAGES = {
  // ------------------------------------------------------------------ SYS
  draw_h8sys(K, m, H) {
    const g = this.g, h = g.h8;
    if (!h) return;
    const P = h.power;
    head(K, 'H8  システム', `HACHI ${h.awake > 0.5 ? 'ONLINE' : 'STANDBY'}`);
    let y = 44;
    const row = (label, v, txt, col, warn) => {
      K.text(label, 12, y + 8, { size: 11, color: COL.dim });
      K.bar(108, y, 270, 9, v, warn ? COL.red : col);
      K.text(txt, 500, y + 9, { size: 11, color: warn ? COL.red : COL.text, align: 'right', mono: true });
      y += 24;
    };
    row('原子炉', P.reactor, `${Math.round(P.reactor * H8.reactorMW)} / ${H8.reactorMW} MW`, COL.green);
    row('超電導蓄電', P.smes / H8.smesMJ, `${(P.smes / 1000).toFixed(1)} GJ`, COL.cyan, P.smes < H8.smesMJ * 0.1);
    row('負荷', Math.min(1, P.loadMW / 360), `${Math.round(P.loadMW)} MW`, AMBER);
    row('ドライブ', Math.min(1, P.driveMW / H8.driveMW.boost), `${Math.round(P.driveMW)} MW`, COL.violet);
    row('外部装甲', h.armour.outer, `${Math.round(h.armour.outer * 100)} %`, COL.green, h.armour.outer < 0.35);
    row('内部装甲', h.armour.inner, `${Math.round(h.armour.inner * 100)} %`, COL.green, h.armour.inner < 0.5);
    // feed
    const docked = h.mode === 'docked';
    K.rect(10, y + 2, 492, 46, { fill: COL.bg2, r: 8 });
    K.text('高速給電（B-29 → H8）', 22, y + 20, { size: 11, color: COL.dim });
    K.text(P.feed ? `${Math.round(P.feedMW)} MW 受電中` : docked ? (h.umb > 0.02 && h.umb < 0.98 ? 'アンビリカル接続中…' : P.feedOn ? '待機' : '切断') : '未接続', 22, y + 40, { size: 14, color: P.feed ? COL.green : COL.text, weight: 600 });
    K.button(300, y + 9, 92, 32, P.feedOn ? '給電 ON' : '給電 OFF', () => h.toggleFeed(), { style: P.feedOn ? 'on' : 'normal', size: 11 });
    K.button(400, y + 9, 92, 32, P.boost ? 'ブースト ON' : 'ブースト OFF', () => h.toggleBoost(), { style: P.boost ? 'on' : 'normal', size: 11 });
    y += 58;
    // cabin
    const z = g.lifeSupport.z.h8;
    if (z) {
      const p = z.n2 + z.o2 + z.co2;
      K.text(`船内 ${p.toFixed(1)} kPa   O2 ${z.o2.toFixed(1)}   CO2 ${z.co2.toFixed(2)}`, 12, y + 10, { size: 11, color: p > 90 ? COL.text : COL.red, mono: true });
    }
    const hopen = h.hatch ? h.hatch.open : 0;
    K.text(`下部ハッチ ${h.neckOpen > 0.98 && hopen > 0.98 ? '開' : h.neckOpen > 0.01 || hopen > 0.01 ? '動作中' : '閉'}`, 330, y + 10, { size: 11, color: COL.dim });
    if (docked) K.button(410, H - 32, 92, 26, h.neckTarget > 0.5 ? 'ハッチ 閉' : 'ハッチ 開', () => h.portTapped(), { size: 10 });
    K.text(`被弾 ${h.hits} 回`, 12, H - 14, { size: 10, color: COL.dim });
  },

  // ------------------------------------------------------------------ NAV
  draw_h8nav(K, m, H) {
    const g = this.g, h = g.h8;
    if (!h) return;
    const fl = h.mode === 'docked' ? g.flight : h.flight;
    head(K, 'H8  ナビ / HACHI', stateJP(h));
    const vRel = fl.vel.clone().sub(fl.refVelocity(fl.pos, new THREE.Vector3())).length();
    K.rect(10, 34, 240, 64, { fill: COL.bg2, r: 8 });
    K.text('速度', 20, 50, { size: 10, color: COL.dim });
    K.text(vRel.toFixed(1), 20, 84, { size: 28, color: COL.text, weight: 300, mono: true });
    K.text('m/s', 134, 84, { size: 11, color: COL.dim });
    K.text('高度', 176, 50, { size: 10, color: COL.dim });
    K.text((altOf(fl.pos) / 1000).toFixed(1), 240, 74, { size: 15, color: COL.text, align: 'right', mono: true });
    K.text('km', 240, 90, { size: 9, color: COL.dim, align: 'right' });
    const mul = h.mode === 'docked' ? g.flight.mul : 6 * h.flight.mul;
    K.text(`推力倍率 ×${mul}   最高 ${(fl.vUltra / 1000).toFixed(1)} km/s`, 20, 112, { size: 11, color: AMBER, mono: true });
    // B-29 relation
    const d = h.flight.pos.distanceTo(g.flight.pos);
    K.text(h.mode === 'docked' ? 'B-29 上部ポートに結合' : `B-29 まで ${fmtDist(d)}`, 20, 132, { size: 12, color: COL.text });
    // HACHI's state line
    const P = h.pilot;
    if (P.goal || P.state === 'dock' || P.state === 'undock') K.text(`HACHI: ${stateJP(h)}  ${fmtDist(P.dist || 0)}${P.eta > 1 ? '  残り ' + fmtEta(P.eta) : ''}`, 20, 152, { size: 11, color: COL.cyan });
    if (P.notes && P.notes.length) K.text('回避行動中', 20, 170, { size: 11, color: COL.red, weight: 700 });
    // HACHI's recent words
    const log = g.asphalt.log.filter((e) => e.who === 'hachi').slice(-3).reverse();
    if (log.length) {
      K.rect(10, 180, 240, H - 222, { fill: 'rgba(255,170,60,0.05)', stroke: 'rgba(255,170,80,0.18)', r: 6 });
      K.text('HACHI ログ', 18, 194, { size: 9, color: COL.dim });
      let ly = 210;
      for (const e of log) {
        const t = e.text.replace(/^HACHI: /, '');
        K.text(t.length > 22 ? t.slice(0, 21) + '…' : t, 18, ly, { size: 10, color: COL.text });
        ly += 16;
        if (ly > H - 46) break;
      }
    }
    // commands (right)
    const X = 262;
    let y = 34;
    const btn = (label, fn, style = 'normal') => { K.button(X, y, 240, 26, label, fn, { style, size: 11 }); y += 30; };
    if (h.mode === 'docked') {
      btn(h.crew ? '分離して単独飛行' : 'H8 を分離（護衛）', () => h.release(h.crew ? 'free' : 'escort'), 'warn');
      if (!h.crew) btn('分離して停泊軌道へ', () => h.release('home'));
      btn(h.power.feedOn ? '給電を止める' : '給電する', () => h.toggleFeed(), h.power.feedOn ? 'on' : 'normal');
    } else {
      if (h.mode === 'parked') btn('H8 起動（B-29 へ）', () => h.call(), 'warn');
      else {
        btn(h.goalKind === 'b29' ? 'B-29 へ帰還中…（中止）' : 'B-29 へ帰還・ドッキング', () => (h.goalKind === 'b29' ? h.goal('hold') : h.call()), h.goalKind === 'b29' ? 'on' : 'warn');
        btn(h.crew ? (P.goal ? '手動操縦にする' : '手動操縦中') : '待機', () => h.goal('hold'), !P.goal ? 'on' : 'normal');
        btn('停泊軌道へ', () => h.sendHome(), h.goalKind === 'home' ? 'on' : 'normal');
        if (h.crew) btn(h.flight.ultra ? 'ULTRA  作動中' : 'ULTRA', () => h.flight.setUltra(!h.flight.ultra), h.flight.ultra ? 'warn' : 'normal');
      }
      // stations (HACHI flies there and holds)
      if (h.crew && y < H - 40) {
        K.text('自律航行先', X + 4, y + 10, { size: 10, color: COL.dim });
        y += 16;
        for (const s of g.stations.list) {
          if (y > H - 30) break;
          const st = s.dmg ? s.dmg.status : 'ok';
          const dd = s.pos.distanceTo(h.flight.pos);
          const sel = h.goalKind === s.id;
          K.rect(X, y, 240, 20, { fill: sel ? 'rgba(95,208,255,0.14)' : 'rgba(255,255,255,0.02)', stroke: sel ? COL.cyan : 'rgba(120,190,255,0.12)', r: 5 });
          K.text(s.name.replace('（修理基地）', ''), X + 8, y + 14, { size: 10, color: st === 'ok' ? COL.text : COL.dim });
          K.text(fmtDist(dd), X + 232, y + 14, { size: 9, color: COL.dim, align: 'right', mono: true });
          K.buttons.push({ x: X, y, w: 240, h: 20, onTap: () => h.goal(s.id) });
          y += 23;
        }
      }
    }
    K.button(10, H - 32, 120, 26, h.power.boost ? 'ブースト ON' : 'ブースト OFF', () => h.toggleBoost(), { style: h.power.boost ? 'on' : 'normal', size: 10 });
  },

  // ------------------------------------------------------------------ CAM
  draw_h8cam(K, m, H) {
    const g = this.g, h = g.h8;
    if (!h) return;
    K.g.clearRect(0, 0, m.W, m.H);
    K.buttons.length = 0;
    m.camI = m.camI || 0;
    const cam = CAMERAS[((m.camI % 4) + 4) % 4];
    if (!m.feedSrc) {
      m.feedSrc = () => {
        const c = CAMERAS[((m.camI % 4) + 4) % 4];
        const p = c.dir.clone().multiplyScalar(H8.R + 0.8);
        const up = Math.abs(c.dir.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
        const local = new THREE.Matrix4().lookAt(p, p.clone().add(c.dir), up).setPosition(p);
        return h.root.matrixWorld.clone().multiply(local);
      };
    }
    this.setFeed(m, true, [0, 0.16, 1, 0.84]);
    K.rect(0, 0, 512, H * 0.16, { fill: 'rgba(23,13,5,0.95)', stroke: null, r: 0 });
    K.text('H8 船外  ' + cam.name, 10, H * 0.11, { size: 11, color: AMBER, weight: 700 });
    const rec = Math.floor(performance.now() / 600) % 2;
    if (rec) K.circle(495, H * 0.08, 4, { fill: COL.red, stroke: null });
    K.button(300, 4, 80, H * 0.16 - 8, '◀ 前', () => { m.camI--; }, { size: 10 });
    K.button(388, 4, 80, H * 0.16 - 8, '次 ▶', () => { m.camI++; }, { size: 10 });
  },

  // ------------------------------------------------------------------ B-29 nav: the H8 strip
  drawH8Strip(K, x, y) {
    const g = this.g, h = g.h8;
    if (!h) return;
    const w = 150;
    K.rect(x, y, w, 46, { fill: 'rgba(20,12,4,0.82)', stroke: 'rgba(255,170,80,0.45)', r: 6 });
    K.text('H8', x + 8, y + 15, { size: 11, color: AMBER, weight: 700 });
    const d = h.flight.pos.distanceTo(g.flight.pos);
    K.text(h.mode === 'docked' ? '結合中' : `${stateJP(h)}  ${fmtDist(d)}`, x + 30, y + 15, { size: 9, color: COL.text });
    let label, fn, style = 'normal';
    if (h.mode === 'docked') { label = '分離'; fn = () => h.release('escort'); style = 'warn'; }
    else if (h.goalKind === 'b29' || h.pilot.state === 'dock') { label = '呼び戻し中…（中止）'; fn = () => h.goal('hold'); style = 'on'; }
    else { label = h.mode === 'parked' ? 'H8 を呼ぶ' : 'H8 を呼ぶ（ドッキング）'; fn = () => h.call(); style = 'warn'; }
    K.button(x + 6, y + 21, w - 12, 20, label, fn, { style, size: 9 });
  },
};

function fmtEta(s) {
  if (s < 60) return Math.round(s) + '秒';
  if (s < 3600) return Math.round(s / 60) + '分';
  return (s / 3600).toFixed(1) + '時間';
}
