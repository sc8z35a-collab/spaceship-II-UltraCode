// The information on H8's all-round display, as tabs: small glass panels hanging on the inside
// of the sphere (each turned to face Kaito's eye). Every tab has a slim header — its name and the
// figures that matter at a glance — and a body with the rest and its buttons. Tap a header to
// fold the tab down to just that strip (or open it again); drag a header to move the tab anywhere
// on the sphere, floor included. They stay where they are put (kept in the browser and in the
// save), never turn with the seat, fade away while the view is zoomed, and go see-through when
// something locked lies behind them.
import * as THREE from 'three';
import { Kit, COL } from '../ui/monitorKit.js';
import { H8, CAMERAS } from './h8Spec.js';
import { LAYER_NEAR } from '../core/layers.js';
import { fmtDist, altOf } from './h8Display.js';
import { QUALITY } from '../core/quality.js';

const DEG = Math.PI / 180;
const PX_DEG = 22;              // texels per degree
const HEAD_DEG = 2.7;           // header height (degrees)
const STORE = 'b29.h8tabs';
const AMBER = '#ffb347';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const UP = V(0, 1, 0);

/** the tabs and where they start (az: 0 = H8's bow, + = starboard; el: from the cockpit's middle) */
const DEFS = [
  { id: 'alert', title: '警報', az: 0, el: -19, w: 34, h: 0, open: false, fixedClosed: true },
  { id: 'h8', title: 'H8', az: -33, el: -3, w: 23, h: 14.5, open: true, color: AMBER },
  { id: 'b29', title: 'B-29', az: 33, el: -3, w: 23, h: 14.5, open: true },
  { id: 'wpn', title: '兵装', az: -60, el: 13, w: 21, h: 12.5, open: false, color: '#ff8a6a' },
  { id: 'cam', title: 'カメラ・ズーム', az: 60, el: 13, w: 21, h: 12.5, open: false },
  { id: 'nav', title: '航法', az: -21, el: 24, w: 23, h: 17, open: false },
  { id: 'hachi', title: 'HACHI', az: 21, el: 24, w: 23, h: 15, open: false, color: AMBER },
  { id: 'suit', title: 'スーツ', az: -86, el: -2, w: 20, h: 11.5, open: false },
];

function surfaceTex(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return { canvas, tex, kit: new Kit(canvas) };
}

class Tab {
  constructor(sys, def) {
    Object.assign(this, { id: def.id, title: def.title, az: def.az * DEG, el: def.el * DEG, wDeg: def.w, hDeg: def.h, open: def.open, color: def.color || COL.cyan, fixedClosed: !!def.fixedClosed });
    this.def = def;
    this.sys = sys;
    this.fade = 1;
    this.t = Math.random();
    this.headS = this.surface(def.w, HEAD_DEG, 27);
    if (def.h > 0) this.bodyS = this.surface(def.w, def.h, 26);
    this.sub = 0;               // a tab's own page (B-29's pages)
  }

  surface(wDeg, hDeg, order) {
    // about one texel per screen pixel on a phone held sideways (a little less on Low)
    const k = QUALITY.level === 'low' ? 0.95 : 1.25;
    const W = Math.round(wDeg * PX_DEG * k), H = Math.round(hDeg * PX_DEG * k);
    const s = surfaceTex(W, H);
    const mat = new THREE.MeshBasicMaterial({ map: s.tex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
    // sized for 1 m away; scaled with the distance it hangs at
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * Math.tan(wDeg * DEG / 2), 2 * Math.tan(hDeg * DEG / 2)), mat);
    mesh.layers.set(LAYER_NEAR);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.userData.tab = this;
    this.sys.group.add(mesh);
    return Object.assign(s, { mesh, mat, W, H, wDeg, hDeg });
  }

  /** the unit direction (H8-local, from the cockpit's middle) of the tab's header */
  dir(out) { return out.set(Math.sin(this.az) * Math.cos(this.el), Math.sin(this.el), -Math.cos(this.az) * Math.cos(this.el)); }
}

export class H8Tabs {
  constructor(vessel) {
    this.v = vessel;
    this.group = new THREE.Group();
    this.group.name = 'h8Tabs';
    this.tabs = DEFS.map((d) => new Tab(this, d));
    this.byId = Object.fromEntries(this.tabs.map((t) => [t.id, t]));
    this.visible = false;
    this.drag = null;
    this.ray = new THREE.Raycaster();
    this.ray.layers.enableAll();
    this.loadLayout();
  }

  // ------------------------------------------------------------------ layout (kept)
  layout() { return Object.fromEntries(this.tabs.map((t) => [t.id, { az: +(t.az / DEG).toFixed(1), el: +(t.el / DEG).toFixed(1), open: t.open }])); }

  applyLayout(L) {
    if (!L) return;
    for (const t of this.tabs) {
      const s = L[t.id];
      if (!s) continue;
      if (Number.isFinite(s.az)) t.az = s.az * DEG;
      if (Number.isFinite(s.el)) t.el = Math.max(-78, Math.min(80, s.el)) * DEG;
      if (typeof s.open === 'boolean' && !t.fixedClosed) t.open = s.open;
    }
  }

  loadLayout() { try { this.applyLayout(JSON.parse(localStorage.getItem(STORE) || 'null')); } catch (e) { /* none kept */ } }
  saveLayout() { try { localStorage.setItem(STORE, JSON.stringify(this.layout())); } catch (e) { /* storage off */ } }

  /** put every tab back where it started */
  resetLayout() {
    for (const t of this.tabs) { t.az = t.def.az * DEG; t.el = t.def.el * DEG; t.open = t.def.open; }
    this.saveLayout();
  }

  // ------------------------------------------------------------------ placement
  /**
   * per frame: eye (H8-local), shown, zoom (the tabs fade out while the view is magnified),
   * locks (the display's locks: a tab goes see-through when one lies behind it)
   */
  place(dt, eye, shown, zoom, locks) {
    this.visible = shown;
    this.group.visible = shown;
    if (!shown) return;
    const D = this.v.display, Cc = H8.cockpitC;
    const zf = Math.max(0, Math.min(1, 1 - (zoom - 1.15) / 0.6));
    for (const t of this.tabs) {
      // the header's spot on the sphere, seen from the eye
      t.dir(_v);
      const P = _v2.copy(_v).multiplyScalar(H8.cockpitR - 0.06).add(Cc);
      const toP = P.clone().sub(eye);
      const dist = toP.length();
      const dirE = toP.divideScalar(dist);
      const r = Math.min(dist, D.surface(eye, dirE)) - 0.05;
      // facing the eye, upright to H8's vertical (unless right overhead)
      const head = eye.clone().addScaledVector(dirE, r);
      const up = Math.abs(dirE.y) > 0.96 ? V(-Math.sin(t.az), 0, Math.cos(t.az)).multiplyScalar(dirE.y > 0 ? 1 : -1) : UP;
      _m.lookAt(eye, head, up);
      _q.setFromRotationMatrix(_m);
      const H = t.headS;
      H.mesh.matrix.compose(head, _q, _v.set(r, r, r));
      // something locked behind it: see-through
      let behind = false;
      if (t.open && t.bodyS && locks && locks.length) {
        const bodyC = head.clone().addScaledVector(V(0, -1, 0).applyQuaternion(_q), r * Math.tan((HEAD_DEG + t.hDeg) * DEG / 2));
        const dB = bodyC.sub(eye).normalize();
        const hw = t.wDeg * DEG / 2, hh = t.hDeg * DEG / 2;
        for (const l of locks) { const a = l.c.dir.angleTo(dB); if (a < Math.min(hw, hh) * 1.1) { behind = true; break; } }
      }
      const target = zf * (this.drag && this.drag.tab === t ? 0.85 : 1);
      t.fade += (target - t.fade) * Math.min(1, dt * 6);
      H.mat.opacity = t.fade;
      H.mesh.visible = t.fade > 0.02;
      if (t.bodyS) {
        const B = t.bodyS;
        const bodyOn = t.open && t.fade > 0.02;
        B.mesh.visible = bodyOn;
        if (bodyOn) {
          // hung under the header, in the header's plane
          const off = r * (Math.tan(HEAD_DEG * DEG / 2) + Math.tan(t.hDeg * DEG / 2));
          const bc = head.clone().addScaledVector(V(0, -1, 0).applyQuaternion(_q), off);
          B.mesh.matrix.compose(bc, _q, _v.set(r, r, r));
          t.bodyFade = (t.bodyFade ?? 1) + ((behind ? 0.3 : 1) - (t.bodyFade ?? 1)) * Math.min(1, dt * 5);
          B.mat.opacity = t.fade * t.bodyFade;
        }
      }
    }
    this.group.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------ drawing
  /** redraw the tabs in view a few times a second */
  draw(dt, power) {
    if (!this.visible) return;
    for (const t of this.tabs) {
      if (t.fade < 0.02) continue;
      t.t += dt;
      const low = QUALITY.level === 'low';
      const rate = t.open ? (low ? 3 : 4) : (low ? 1.5 : 2);
      if (t.t < 1 / rate) continue;
      t.t = 0;
      this.drawHead(t, power);
      if (t.open && t.bodyS) this.drawBody(t, power);
    }
  }

  frame(K, W, H, warn) {
    const g = K.g;
    K.buttons.length = 0;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    K.rect(1, 1, 512 - 2, H / K.s - 2, { fill: warn ? 'rgba(46,8,5,0.62)' : 'rgba(4,14,24,0.6)', stroke: warn ? 'rgba(255,90,60,0.55)' : 'rgba(130,220,255,0.25)', r: 9, lw: 1.4 });
  }

  drawHead(t, power) {
    const S = t.headS, K = S.kit, Hh = 512 * S.H / S.W;
    const info = this.headInfo(t);
    this.frame(K, S.W, S.H, info.warn);
    if (power < 0.2) { S.tex.needsUpdate = true; return; }
    K.text(t.title, 12, Hh / 2 + 1, { size: 15, color: info.warn ? COL.red : t.color, weight: 700, base: 'middle' });
    K.text(info.text || '', 12 + Math.max(46, t.title.length * 15 + 14), Hh / 2 + 1, { size: 13, color: info.warn ? '#ffd0c8' : COL.text, base: 'middle', mono: !!info.mono });
    if (!t.fixedClosed) {
      // fold mark (the whole header folds / unfolds; it is also the handle to move the tab)
      K.text(t.open ? '▾' : '▸', 498, Hh / 2 + 1, { size: 15, color: COL.dim, align: 'right', base: 'middle' });
    }
    S.tex.needsUpdate = true;
  }

  drawBody(t, power) {
    const S = t.bodyS, K = S.kit, H = 512 * S.H / S.W;
    this.frame(K, S.W, S.H, false);
    if (power >= 0.2) {
      const fn = this['body_' + t.id];
      if (fn) fn.call(this, K, H, t);
    }
    S.tex.needsUpdate = true;
  }

  /** the strip of figures in each header */
  headInfo(t) {
    const v = this.v, g = v.g;
    const f = v.flight, docked = v.mode === 'docked';
    switch (t.id) {
      case 'alert': {
        const a = v.alertText();
        if (a) return { text: a, warn: true };
        const last = g.asphalt.log.filter((e) => e.who === 'hachi').slice(-1)[0];
        const say = last && g.time - last.t < 12000 ? last.text.replace(/^HACHI: /, '') : null;
        return { text: say ? (say.length > 34 ? say.slice(0, 33) + '…' : say) : `ロック ${v.display.locks.length}/8 ・ 見つめるとロックオン ・ タブは見出しで移動／折りたたみ` };
      }
      case 'h8': {
        const fl = docked ? g.flight : f;
        const vRel = fl.vel.clone().sub(fl.refVelocity(fl.pos, new THREE.Vector3())).length();
        return { text: `${vRel.toFixed(vRel < 100 ? 1 : 0)} m/s  推進剤 ${Math.round(f.fuel * 100)}%  装甲 ${Math.round(v.armour.outer * 100)}%`, warn: v.armour.inner < 0.15 || f.fuel < 0.05, mono: false };
      }
      case 'b29': {
        if (docked) return { text: '結合中・ケーブル接続' };
        const L = v.link;
        return { text: L.ok ? `${fmtDist(L.d)}  リンク ${Math.round(v.linkQuality() * 100)}%` : `${fmtDist(L.d)}  通信圏外`, warn: !L.ok };
      }
      case 'wpn': {
        const W = g.weapons;
        if (!W) return { text: '—' };
        const n = g.drones ? g.drones.list.filter((d) => d.alive && (d.state === 'attack' || d.state === 'hunt') && d.pos.distanceTo(f.pos) < 90e3).length : 0;
        return { text: `砲 ${W.ammo.cannon}  レール ${W.ammo.rail}  弾 ${W.ammo.missile}  ${W.auto.hachi ? '自動' : '手動'}${n ? `  敵 ${n}` : ''}`, warn: n > 0 };
      }
      case 'cam': {
        const z = v.zoom ? v.zoom.z : 1;
        const bad = v.hull.cams.filter((c) => c < 0.5).length;
        return { text: `×${z < 10 ? z.toFixed(1) : z.toFixed(0)}${v.zoom && v.zoom.follow ? ' 追従' : ''}  カメラ ${4 - bad}/4`, warn: bad > 0 };
      }
      case 'nav': return { text: v.navLine() };
      case 'hachi': return { text: v.hachiLine ? v.hachiLine() : '' };
      case 'suit': return { text: v.suitLine ? v.suitLine() : '' };
      default: return { text: '' };
    }
  }

  // ------------------------------------------------------------------ bodies
  body_h8(K, H) {
    const v = this.v, g = v.g, f = v.flight, P = v.power, docked = v.mode === 'docked';
    const fl = docked ? g.flight : f;
    const vRel = fl.vel.clone().sub(fl.refVelocity(fl.pos, new THREE.Vector3())).length();
    const modeTxt = docked ? 'B-29 と結合' : v.pilot.state === 'dock' ? 'ドッキング進入' : v.pilot.state === 'undock' ? '離脱中' : v.pilot.goal ? 'HACHI 自律航行' : '手動操縦';
    K.text(modeTxt, 14, 24, { size: 13, color: COL.dim });
    K.text(`${vRel.toFixed(vRel < 100 ? 1 : 0)} m/s`, 14, 52, { size: 24, color: COL.text, weight: 600, mono: true });
    K.text(`高度 ${(altOf(fl.pos) / 1000).toFixed(1)} km`, 498, 50, { size: 14, color: COL.text, align: 'right', mono: true });
    let y = 68;
    const row = (label, val, txt, col, warn) => {
      K.text(label, 14, y + 10, { size: 13, color: warn ? COL.red : COL.dim });
      K.bar(96, y + 3, 290, 8, val, warn ? COL.red : col);
      K.text(txt, 498, y + 11, { size: 13, color: warn ? COL.red : COL.text, align: 'right', mono: true });
      y += 22;
    };
    row('推進剤', f.fuel, `${Math.round(f.fuel * 100)}%`, AMBER, f.fuel < 0.15);
    row('蓄電', P.smes / H8.smesMJ, `${Math.round(P.smes / H8.smesMJ * 100)}%`, COL.cyan, P.smes < H8.smesMJ * 0.1);
    row('外部装甲', v.armour.outer, `${Math.round(v.armour.outer * 100)}%`, COL.green, v.armour.outer < 0.35);
    row('内部装甲', v.armour.inner, `${Math.round(v.armour.inner * 100)}%`, COL.green, v.armour.inner < 0.5);
    if (v.circuits) row('回路', v.circuitHealth(), `${Math.round(v.circuitHealth() * 100)}%`, COL.violet, v.circuitHealth() < 0.5);
    const z = g.lifeSupport.z.h8;
    const kPa = z ? z.n2 + z.o2 + z.co2 : 101.3;
    K.text(`推力 ×${docked ? g.flight.mul : 6 * f.mul}   ${P.feed ? `給電 ${Math.round(P.feedMW)} MW` : '内部電源'}   船内 ${kPa.toFixed(1)} kPa`, 14, y + 12, { size: 12.5, color: kPa < 90 ? COL.red : COL.dim, mono: true });
    y += 24;
    const bw = 116, by = Math.min(y + 4, H - 40);
    K.button(10, by, bw, 32, P.feedOn ? '給電 ON' : '給電 OFF', () => v.toggleFeed(), { style: P.feedOn ? 'on' : 'normal', size: 12 });
    K.button(10 + (bw + 6), by, bw, 32, P.boost ? 'ブースト' : 'ブースト切', () => v.toggleBoost(), { style: P.boost ? 'on' : 'normal', size: 12 });
    K.button(10 + (bw + 6) * 2, by, bw, 32, v.xfer === 'toB29' ? '移送 停止' : '推進剤→B29', () => v.setXfer('toB29'), { style: !docked ? 'disabled' : v.xfer === 'toB29' ? 'warn' : 'normal', size: 11 });
    K.button(10 + (bw + 6) * 3, by, bw, 32, docked ? (v.neckTarget > 0.5 ? '下ハッチ 閉' : '下ハッチ 開') : 'タブ 初期化', () => (docked ? v.portTapped() : this.resetLayout()), { size: 11 });
  }

  body_b29(K, H, t) {
    const v = this.v, g = v.g, docked = v.mode === 'docked';
    const mon = g.monitors;
    if (docked && mon) {
      // B-29's own pages, run from here over the cable
      const pages = [['nav', '航法'], ['sys', '系統'], ['life', '生命維持'], ['reactor', '原子炉'], ['comms', '通信']];
      const page = pages[t.sub % pages.length][0];
      // the page draws into a monitor of its own size; this body shows it below a row of page tabs
      if (!t.pm) {
        const c = document.createElement('canvas');
        c.width = 512 * 2; c.height = Math.round(512 * 2 * (H - 30) / 512);
        t.pm = { id: page, slot: { pos: v.root.position, w: 1, h: (H - 30) / 512, res: 1024 }, canvas: c, kit: new Kit(c), W: c.width, H: c.height, zoom: 1, tab: 0 };
      }
      const pm = t.pm;
      pm.id = page;
      const pk = pm.kit;
      pk.begin();
      const ph = 512 * pm.H / pm.W;
      try { mon._tabs = null; const fn = mon['draw_' + page]; if (fn) fn.call(mon, pk, pm, ph); } catch (e) { /* a page that needs B-29's own screen */ }
      pk.end(0, performance.now(), false);
      K.g.drawImage(pm.canvas, 0, 30 * K.s, K.W, K.H - 30 * K.s);
      const w = 512 / pages.length;
      pages.forEach(([id, label], i) => {
        const on = i === t.sub % pages.length;
        K.button(i * w + 3, 3, w - 6, 24, label, () => { t.sub = i; }, { style: on ? 'on' : 'normal', size: 11 });
      });
      // taps below the row go to the page
      K.buttons.push({ x: 0, y: 30, w: 512, h: H - 30, onTap: null, page: true });
      this._pageHit = (x, y) => pk.hit(x * pk.s, (y - 30) * pk.s);
      return;
    }
    const L = v.link, fb = g.flight, ap = g.autopilot;
    K.text(L.ok ? 'リンク良好' : L.why === 'range' ? '通信圏外（1500 km 超）' : 'B-29 応答なし', 14, 26, { size: 15, color: L.ok ? COL.green : COL.red, weight: 700 });
    K.text(`距離 ${fmtDist(L.d)}`, 498, 26, { size: 16, color: COL.text, align: 'right', mono: true });
    K.bar(14, 36, 484, 5, 1 - Math.min(1, L.d / 1.5e6), L.ok ? COL.green : COL.red);
    let y = 52;
    if (L.ok) {
      const integ = g.damage.integrityNow ?? g.damage.integrity();
      const pw = g.systems.power ?? 1;
      K.text('状態  ' + v.b29State(), 14, y + 10, { size: 13, color: COL.text });
      K.text(`データリンク ${Math.round(v.linkQuality() * 100)}%  目標共有・射撃連携・警報中継`, 498, y + 10, { size: 11, color: COL.cyan, align: 'right' }); y += 22;
      const row = (label, val, txt, col, warn) => {
        K.text(label, 14, y + 10, { size: 13, color: COL.dim });
        K.bar(96, y + 3, 290, 8, val, warn ? COL.red : col);
        K.text(txt, 498, y + 11, { size: 13, color: warn ? COL.red : COL.text, align: 'right', mono: true });
        y += 21;
      };
      row('推進剤', fb.fuel, `${Math.round(fb.fuel * 100)}%`, AMBER, fb.fuel < 0.15);
      row('船体', integ, `${Math.round(integ * 100)}%`, COL.green, integ < 0.6);
      row('電力', pw, `${Math.round(pw * 100)}%`, COL.cyan, pw < 0.4);
      const al = g.systems.alarm.active;
      K.text('警報  ' + (al ? '作動中' : 'なし') + (g.weapons ? `   防衛機銃 ${g.weapons.ammo.pd} ${g.weapons.auto.asphalt ? '自動' : '手動'}` : ''), 14, y + 10, { size: 12.5, color: al ? COL.red : COL.dim }); y += 20;
    } else {
      K.text('1500 km 以内に近づくと、状況の確認と呼び出しができます。', 14, y + 10, { size: 12.5, color: COL.dim });
      K.text('B-29 の位置は全天周モニターの B-29 マーカーで追えます。', 14, y + 30, { size: 12, color: COL.dim });
    }
    const coming = ap.state !== 'off' && ap.target && ap.target.id === 'h8';
    const bw = 116, by = H - 40;
    K.button(10, by, bw, 32, coming ? '呼出 中止' : 'B-29 を呼ぶ', () => (coming ? ap.disengage() : v.callB29()), { style: !L.ok ? 'disabled' : coming ? 'on' : 'warn', size: 12 });
    K.button(10 + (bw + 6), by, bw, 32, '状況報告', () => v.reportB29(), { style: L.ok ? 'normal' : 'disabled', size: 12 });
    K.button(10 + (bw + 6) * 2, by, bw, 32, 'H8 で迎えに', () => v.call(), { style: L.ok ? 'normal' : 'disabled', size: 12 });
    K.button(10 + (bw + 6) * 3, by, bw, 32, g.weapons && g.weapons.auto.asphalt ? '機銃 自動' : '機銃 手動', () => g.weapons && g.weapons.toggleAuto('b29'), { style: L.ok ? (g.weapons && g.weapons.auto.asphalt ? 'on' : 'normal') : 'disabled', size: 12 });
  }

  body_wpn(K, H) {
    const v = this.v, g = v.g, W = g.weapons;
    if (!W) return;
    let y = 10;
    const row = (label, val, txt, col, warn) => {
      K.text(label, 14, y + 10, { size: 13, color: COL.dim });
      K.bar(100, y + 3, 270, 8, val, warn ? COL.red : col);
      K.text(txt, 498, y + 11, { size: 13, color: warn ? COL.red : COL.text, align: 'right', mono: true });
      y += 22;
    };
    row('25mm 砲', W.ammo.cannon / 1600, `${W.ammo.cannon}`, AMBER, W.ammo.cannon < 200);
    row('レールガン', W.railCharge, W.railCharge < 1 ? `充電 ${Math.round(W.railCharge * 100)}%  残${W.ammo.rail}` : `発射可  残${W.ammo.rail}`, COL.cyan, W.ammo.rail <= 0);
    row('ミサイル', W.ammo.missile / 12, `${W.ammo.missile} / 12`, '#ff8a6a', W.ammo.missile <= 0);
    // what the guns are on
    const T = W.targets('h8').slice(0, 4);
    K.text('目標', 14, y + 12, { size: 12, color: COL.dim });
    y += 18;
    if (!T.length) { K.text('射程内に目標なし', 14, y + 10, { size: 12.5, color: COL.dim }); y += 20; }
    T.forEach((x, i) => {
      const sel = W.lastTarget && W.lastTarget.ref === x.ref;
      K.rect(10, y, 492, 20, { fill: sel ? 'rgba(255,90,60,0.16)' : 'rgba(255,255,255,0.02)', stroke: sel ? COL.red : 'rgba(150,190,230,0.15)', r: 5 });
      K.text(`${x.name}${x.threat ? '  敵' : ''}`, 20, y + 14, { size: 12, color: x.threat ? '#ffb3a6' : COL.text });
      K.text(fmtDist(x.dist), 494, y + 14, { size: 12, color: COL.dim, align: 'right', mono: true });
      K.buttons.push({ x: 10, y, w: 492, h: 20, onTap: () => { W.tgtIndex.h8 = i; } });
      y += 23;
    });
    const bw = 158, by = H - 40;
    K.button(10, by, bw, 32, W.auto.hachi ? 'HACHI 自動迎撃' : '手動射撃', () => W.toggleAuto('h8'), { style: W.auto.hachi ? 'on' : 'normal', size: 12 });
    K.button(10 + bw + 7, by, bw, 32, 'レールガン', () => W.fireRail(true), { style: W.railCharge >= 1 && W.ammo.rail > 0 ? 'warn' : 'disabled', size: 12 });
    K.button(10 + (bw + 7) * 2, by, bw, 32, 'ミサイル斉射', () => W.salvoMissiles(true), { style: W.ammo.missile > 0 ? 'danger' : 'disabled', size: 12 });
  }

  body_cam(K, H) {
    const v = this.v, Z = v.zoom;
    let y = 10;
    CAMERAS.forEach((c, i) => {
      const h = v.hull.cams[i];
      const st = h > 0.8 ? '正常' : h > 0.5 ? '劣化' : h > 0.15 ? '重度の劣化' : '信号なし';
      K.text(c.name, 14, y + 11, { size: 12.5, color: h < 0.5 ? COL.red : COL.dim });
      K.bar(150, y + 4, 220, 8, h, h > 0.8 ? COL.green : h > 0.5 ? AMBER : COL.red);
      K.text(st, 498, y + 12, { size: 12.5, color: h < 0.5 ? COL.red : COL.text, align: 'right' });
      y += 21;
    });
    if (!Z) return;
    y += 6;
    const opt = Math.min(10.5, Z.z), dig = Z.z / opt;
    K.text(`ズーム ×${Z.z < 10 ? Z.z.toFixed(1) : Z.z.toFixed(0)}`, 14, y + 18, { size: 18, color: COL.text, weight: 600, mono: true });
    K.text(`光学 ×${opt.toFixed(1)}${dig > 1.01 ? `  デジタル ×${dig.toFixed(1)}` : ''}`, 498, y + 17, { size: 13, color: dig > 1.01 ? AMBER : COL.dim, align: 'right', mono: true });
    y += 28;
    K.bar(14, y, 484 * 10.5 / 42, 6, Math.min(1, Math.log(Z.z) / Math.log(10.5)), COL.cyan);
    K.bar(14 + 484 * 10.5 / 42 + 4, y, 484 - 484 * 10.5 / 42 - 4, 6, Math.max(0, Math.log(dig) / Math.log(4)), AMBER);
    const bw = 116, by = H - 40;
    K.button(10, by, bw, 32, 'ズーム −', () => Z.step(-1), { size: 12 });
    K.button(10 + (bw + 6), by, bw, 32, 'ズーム ＋', () => Z.step(1), { size: 12 });
    K.button(10 + (bw + 6) * 2, by, bw, 32, Z.follow ? '自動追従 ON' : '自動追従', () => Z.toggleFollow(), { style: Z.follow ? 'on' : 'normal', size: 12 });
    K.button(10 + (bw + 6) * 3, by, bw, 32, '等倍', () => Z.reset(), { size: 12 });
  }

  body_nav(K, H) {
    const v = this.v, g = v.g, P = v.pilot, L = v.linkState();
    let y = 8;
    const btn = (label, fn, style = 'normal', hh = 28) => { K.button(10, y, 492, hh, label, fn, { style, size: 13 }); y += hh + 5; };
    if (v.mode === 'docked') {
      btn(v.pending ? 'ハッチを閉めて分離中…' : v.crew ? 'B-29 から分離（単独飛行）' : 'H8 を分離（護衛）', () => v.release(v.crew ? 'free' : 'escort'), v.pending ? 'on' : 'danger', 32);
      if (!v.crew) btn('分離して停泊軌道へ', () => v.release('home'));
    } else {
      btn(v.goalKind === 'b29' ? 'B-29 へ帰還中…（中止）' : 'B-29 へ帰還・ドッキング', () => (v.goalKind === 'b29' ? v.goal('hold') : v.call()), v.goalKind === 'b29' ? 'on' : 'warn');
      const ap = g.autopilot, coming = ap.state !== 'off' && ap.target && ap.target.id === 'h8';
      btn(coming ? 'B-29 が来ます（中止）' : 'B-29 を呼ぶ（ここへ）', () => (coming ? ap.disengage() : v.callB29()), coming ? 'on' : L.ok ? 'normal' : 'disabled');
      btn(v.goalKind === 'escort' ? 'B-29 を護衛中' : 'B-29 を護衛', () => v.goal('escort'), v.goalKind === 'escort' ? 'on' : L.ok ? 'normal' : 'disabled');
      btn(v.crew ? (P.goal ? '手動操縦にする' : '手動操縦中') : '待機', () => v.goal('hold'), !P.goal ? 'on' : 'normal');
      btn('停泊軌道へ', () => v.sendHome(), v.goalKind === 'home' ? 'on' : 'normal');
      if (v.crew) btn(v.flight.ultra ? 'ULTRA 作動中' : 'ULTRA', () => v.flight.setUltra(!v.flight.ultra), v.flight.ultra ? 'warn' : 'normal');
    }
    if (v.crew && v.mode !== 'docked' && y < H - 30) {
      K.text('自律航行先', 14, y + 12, { size: 12, color: COL.dim });
      y += 18;
      for (const s of g.stations.list) {
        if (y > H - 24) break;
        const sel = v.goalKind === s.id;
        K.rect(10, y, 492, 20, { fill: sel ? 'rgba(95,208,255,0.14)' : 'rgba(255,255,255,0.02)', stroke: sel ? COL.cyan : 'rgba(120,190,255,0.12)', r: 5 });
        K.text(s.name.replace('（修理基地）', ''), 20, y + 14, { size: 12, color: (s.dmg ? s.dmg.status : 'ok') === 'ok' ? COL.text : COL.dim });
        K.text(fmtDist(s.pos.distanceTo(v.flight.pos)), 494, y + 14, { size: 11.5, color: COL.dim, align: 'right', mono: true });
        K.buttons.push({ x: 10, y, w: 492, h: 20, onTap: () => v.goal(s.id) });
        y += 23;
      }
    }
  }

  body_hachi(K, H) {
    const v = this.v;
    if (v.drawHachi) v.drawHachi(K, H);
  }

  body_suit(K, H) {
    const v = this.v;
    if (v.drawSuit) v.drawSuit(K, H);
    else K.text('—', 14, 30, { size: 13, color: COL.dim });
  }

  // ------------------------------------------------------------------ touch
  /**
   * What a touch at ndc (x, y) lands on: { tab, part: 'head' | 'body', uv } or null.
   * cam: { pos (world), quat (world), proj (Matrix4) }
   */
  hit(ndc, cam) {
    if (!this.visible) return null;
    const dir = _v.set(ndc.x, ndc.y, 0.5).applyMatrix4(_m.copy(cam.proj).invert()).normalize().applyQuaternion(cam.quat);
    this.ray.set(cam.pos, dir);
    this.ray.near = 0; this.ray.far = 5;
    const meshes = [];
    for (const t of this.tabs) {
      if (t.fade < 0.3) continue;
      if (t.headS.mesh.visible) meshes.push(t.headS.mesh);
      if (t.bodyS && t.bodyS.mesh.visible) meshes.push(t.bodyS.mesh);
    }
    const h = this.ray.intersectObjects(meshes, false)[0];
    if (!h) return null;
    const tab = h.object.userData.tab;
    return { tab, part: h.object === tab.headS.mesh ? 'head' : 'body', uv: h.uv, dir: dir.clone(), pos: cam.pos.clone() };
  }

  /** a tap on a tab (from hit()) */
  tap(hit) {
    const t = hit.tab, A = this.v.g.audio;
    if (hit.part === 'head') {
      if (t.fixedClosed) return;
      t.open = !t.open;
      t.t = 999;
      this.saveLayout();
      A.beep && A.beep(t.open ? 1500 : 1100, 0.04, 0.04, { direct: true });
      return;
    }
    const S = t.bodyS, K = S.kit;
    const x = hit.uv.x * 512, y = (1 - hit.uv.y) * 512 * S.H / S.W;
    // a page shown inside the body (B-29's own) takes the taps below its tab row
    const pb = K.buttons.find((b) => b.page && y >= b.y);
    let ok = false;
    if (pb && this._pageHit) ok = this._pageHit(x, y);
    else ok = K.hit(x * K.s, y * K.s);
    t.t = 999;
    A.click && A.click(null, ok ? 0.2 : 0.08);
    if (ok) A.beep && A.beep(1320, 0.04, 0.05, { direct: true });
  }

  /** start dragging a tab by its header (the point under the finger on the tabs' sphere) */
  dragStart(hit) {
    const p = this.onSphere(hit.pos, hit.dir);
    if (!p) return;
    this.drag = { tab: hit.tab, dAz: hit.tab.az - p.az, dEl: hit.tab.el - p.el, moved: 0 };
  }

  dragMove(ndc, cam) {
    const D = this.drag;
    if (!D) return;
    const dir = _v.set(ndc.x, ndc.y, 0.5).applyMatrix4(_m.copy(cam.proj).invert()).normalize().applyQuaternion(cam.quat);
    const p = this.onSphere(cam.pos, dir.clone());
    if (!p) return;
    const t = D.tab;
    let az = p.az + D.dAz;
    while (az > Math.PI) az -= Math.PI * 2;
    while (az < -Math.PI) az += Math.PI * 2;
    t.az = az;
    t.el = Math.max(-78 * DEG, Math.min(80 * DEG, p.el + D.dEl));
    D.moved++;
  }

  dragEnd() {
    if (!this.drag) return;
    this.drag = null;
    this.saveLayout();
  }

  /** where a ray from the eye (world) meets the tabs' sphere: (az, el) from the cockpit's middle */
  onSphere(posW, dirW) {
    const v = this.v;
    const inv = this.group.parent ? _m.copy(this.group.parent.matrixWorld).invert() : null;
    if (!inv) return null;
    const o = posW.clone().applyMatrix4(inv);
    const d = dirW.clone().transformDirection(inv);
    const Cc = H8.cockpitC, R = H8.cockpitR - 0.06;
    const oc = o.clone().sub(Cc);
    const b = oc.dot(d), c = oc.lengthSq() - R * R;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b + Math.sqrt(disc);
    const p = oc.addScaledVector(d, t).normalize();
    return { az: Math.atan2(p.x, -p.z), el: Math.asin(Math.max(-1, Math.min(1, p.y))) };
  }
}
