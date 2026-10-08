// The information on H8's all-round display, as tabs. The display draws them itself, in its own
// pixels (h8Display.js): each tab lies on the inside of the sphere — curved with it, bent down onto
// the floor glass where it reaches it — and never turns toward Kaito. The seat and his hands stand
// in front of it, the panels' seams run across it, a hurt panel's faults show over it. The display
// lays each one out for the pilot's eye point (where the eye is in the seat): from the seat a tab
// looks flat and square; from anywhere else, like what it is — a picture on curved glass. Two
// tabs, each with its pages:
//   操縦 — 航法, 推進・電力, 兵装, カメラ (its header also carries the alerts);
//   機体 — 機体, B-29, HACHI, 装備.
// Each has a slim header (its name, the page and the figures that matter at a glance) and a body
// with a row of page buttons over the page. Tap a header to fold the tab down to that strip (or
// open it again); drag a
// header to move the tab anywhere on the glass; pinch a tab with two fingers (or turn the mouse
// wheel over it) to make it bigger or smaller. They stay as they are left (kept in the browser).
//
// The zoom magnifies the outside cameras' picture, not the display's own pixels: the tabs stay
// where they are, as large and as opaque, and work while zoomed. Where the display is dead (its
// camera gone) nothing of them shows, a broken panel shows what is left of them, and where a panel
// of the display has slid aside (the shelter's) neither. Their text is drawn large and bright.
import * as THREE from 'three';
import { Kit, COL } from '../ui/monitorKit.js';
import { H8, CAMERAS } from './h8Spec.js';
import { SEAT } from './h8Seat.js';
import { fmtDist, altOf, FLOOR, CAM_DEAD } from './h8Display.js';
import { QUALITY } from '../core/quality.js';

const DEG = Math.PI / 180;
const HEAD = 5.4;                // header height (degrees at scale 1)
const STORE = 'b29.h8tabs.v4';
const AMBER = '#ffb347';
const K_MIN = 0.45, K_MAX = 1.8; // how far a tab can be shrunk / enlarged
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const RT = Math.PI * 2;

/** the tabs and where they start, as seen from the seat (az: 0 = H8's bow, + = starboard; el: up;
 * w, h: size in degrees) */
const DEFS = [
  { id: 'ops', title: '操縦', az: -44, el: 12, w: 56, h: 44, open: true, color: AMBER, pages: [['nav', '航法'], ['drive', '推進・電力'], ['wpn', '兵装'], ['cam', 'カメラ']] },
  { id: 'ship', title: '機体', az: 44, el: 12, w: 56, h: 44, open: false, color: COL.cyan, pages: [['hull', '機体'], ['b29', 'B-29'], ['hachi', 'HACHI'], ['gear', '装備']] },
];
/** the tabs' text: a little larger than the pages ask for, and brighter (the dim greys lifted, the
 * colours lit up) — drawn by the display, it has to read at a glance */
const TEXT_SCALE = 1.07;
const BRIGHT = {
  [COL.dim]: 'rgba(200,226,250,0.9)',
  'rgba(150,190,230,0.55)': 'rgba(200,226,250,0.9)',
  [COL.text]: '#f6fbff',
  'rgba(170,190,210,0.4)': 'rgba(205,218,232,0.6)',
  [COL.cyan]: '#8fe2ff', [COL.green]: '#8af5b2', [COL.amber]: '#ffc870', [COL.red]: '#ff6e5e',
  '#ff8a7a': '#ffa598', '#ffb3a6': '#ffc8bd', '#ffd0c8': '#ffe0da', '#d7e7f7': '#f6fbff',
  '#ffd9a8': '#ffe6c4', '#7cf0a6': '#9cf8be',
};
/** the page row over a tab's body (units of the tab's 512-wide canvas) */
const ROW = 44;

/** the eye point the tabs are laid out for: the pilot's eye in the seat (H8-local) */
const E0 = SEAT.G.clone().add(SEAT.eye);

/** texels per degree (at scale 1): about one per screen pixel on a phone held sideways, a little
 * more where it can be afforded (sharper text) */
function pxDeg() {
  const q = QUALITY.level;
  return q === 'low2' ? 12 : q === 'low' ? 16 : 23;
}

class Tab {
  constructor(sys, def) {
    Object.assign(this, { id: def.id, title: def.title, az: def.az * DEG, el: def.el * DEG, w: def.w, h: def.h, k: 1, open: def.open, color: def.color || COL.cyan, fixedClosed: !!def.fixedClosed });
    this.def = def;
    this.sys = sys;
    this.fade = 0;
    this.t = Math.random();
    this.sub = 0;               // a page's own sub-page (B-29's pages)
    this.page = 0;              // a list's page
    this.pages = def.pages || null;
    this.pg = 0;                // the page on show
    this.order = ++sys.z;
    this.c = V(0, 0, -1); this.ex = V(1, 0, 0); this.ey = V(0, 1, 0);
    this.dirty = true;
    this.head = sys.surface(this, 'head');
    this.body = null;           // made when first opened
    this.resK = 1;              // the scale the canvases were made for
  }

  /** the tab's frame: c (its header's middle, unit from the eye point E0), ex (right), ey (up) —
   * its face is the plane there square to c, projected from E0 onto the glass */
  frame() {
    const ca = Math.cos(this.az), sa = Math.sin(this.az), ce = Math.cos(this.el), se = Math.sin(this.el);
    this.c.set(sa * ce, se, -ca * ce);
    this.ex.set(ca, 0, sa);
    this.ey.crossVectors(this.ex, this.c);
    // extents in the tangent plane
    this.hx = Math.tan(this.k * this.w / 2 * DEG);
    this.hy = Math.tan(this.k * HEAD / 2 * DEG);
    this.by = Math.tan(Math.min(80, this.k * (HEAD / 2 + this.h)) * DEG);
  }

  /** where a direction from the eye point (unit) lands on the tab: null, or { part, u, v } */
  at(u) {
    const d = u.dot(this.c);
    if (d < 0.2) return null;
    const X = u.dot(this.ex) / d, Y = u.dot(this.ey) / d;
    if (Math.abs(X) > this.hx) return null;
    if (Y <= this.hy && Y >= -this.hy) return { part: 'head', u: (X + this.hx) / (2 * this.hx), v: (Y + this.hy) / (2 * this.hy) };
    if (this.open && this.h > 0 && Y < -this.hy && Y >= -this.by) return { part: 'body', u: (X + this.hx) / (2 * this.hx), v: (Y + this.by) / (this.by - this.hy) };
    return null;
  }
}

/** the point of the glass seen from the eye point E0 along u (unit), just inside it */
function onGlass(u, out) {
  const Cc = H8.cockpitC, R = H8.cockpitR - 0.008;
  const ox = E0.x - Cc.x, oy = E0.y - Cc.y, oz = E0.z - Cc.z;
  const b = ox * u.x + oy * u.y + oz * u.z;
  let s = -b + Math.sqrt(Math.max(0, b * b - (ox * ox + oy * oy + oz * oz - R * R)));
  if (u.y < -1e-4) { const tf = (FLOOR.y + 0.004 - E0.y) / u.y; if (tf > 0 && tf < s) s = tf; }
  return out.copy(u).multiplyScalar(s).add(E0);
}

export class H8Tabs {
  constructor(vessel) {
    this.v = vessel;
    this.z = 0;
    this.tabs = DEFS.map((d) => new Tab(this, d));
    this.byId = Object.fromEntries(this.tabs.map((t) => [t.id, t]));
    this.visible = false;
    this.drag = null;
    this.loadLayout();
    for (const t of this.tabs) { t.resK = t.k; this.size(t, t.head); }
  }

  // ------------------------------------------------------------------ surfaces
  /** a canvas and its texture (the display draws it on its glass) */
  surface(t, part) {
    const canvas = document.createElement('canvas');
    canvas.width = 4; canvas.height = 4;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    const kit = new Kit(canvas);
    kit.fs = TEXT_SCALE;
    kit.pal = BRIGHT;
    const S = { canvas, tex, kit, part, W: 4, H: 4 };
    this.size(t, S);
    return S;
  }

  /** the canvas resolution for the tab's present size (its shape on the glass is a rectangle of
   * the tangent plane: the canvas has the same proportions) */
  size(t, S) {
    const px = pxDeg() * 57.2958;
    const head = S.part === 'head';
    const k = t.k;
    const tw = 2 * Math.tan(k * t.w / 2 * DEG);
    const th = head ? 2 * Math.tan(k * HEAD / 2 * DEG) : Math.tan(Math.min(80, k * (HEAD / 2 + t.h)) * DEG) - Math.tan(k * HEAD / 2 * DEG);
    const sc = Math.min(1, 2048 / (tw * px));
    const W = Math.round(tw * px * sc), H = Math.max(8, Math.round(th * px * sc));
    if (W === S.W && H === S.H) return;
    S.canvas.width = W; S.canvas.height = H;
    S.W = W; S.H = H;
    S.kit.resize();
    S.tex.dispose();
    S.tex.image = S.canvas;
    S.tex.needsUpdate = true;
    t.t = 999;
  }

  /** a tab's frame on the glass, after a move or a resize */
  shape(t) {
    t.frame();
    t.dirty = false;
  }

  // ------------------------------------------------------------------ layout (kept)
  layout() { return Object.fromEntries(this.tabs.map((t) => [t.id, { az: +(t.az / DEG).toFixed(1), el: +(t.el / DEG).toFixed(1), open: t.open, k: +t.k.toFixed(3), pg: t.pg }])); }

  applyLayout(L) {
    if (!L) return;
    for (const t of this.tabs) {
      const s = L[t.id];
      if (!s) continue;
      if (Number.isFinite(s.az)) t.az = s.az * DEG;
      if (Number.isFinite(s.el)) t.el = Math.max(-78, Math.min(80, s.el)) * DEG;
      if (Number.isFinite(s.k)) t.k = Math.max(K_MIN, Math.min(K_MAX, s.k));
      if (typeof s.open === 'boolean' && !t.fixedClosed) t.open = s.open;
      if (t.pages && Number.isInteger(s.pg)) t.pg = Math.max(0, Math.min(t.pages.length - 1, s.pg));
      t.dirty = true;
    }
  }

  loadLayout() { try { this.applyLayout(JSON.parse(localStorage.getItem(STORE) || 'null')); } catch (e) { /* none kept */ } }
  saveLayout() { try { localStorage.setItem(STORE, JSON.stringify(this.layout())); } catch (e) { /* storage off */ } }

  /** every tab back where (and as big as) it started */
  resetLayout() {
    for (const t of this.tabs) { t.az = t.def.az * DEG; t.el = t.def.el * DEG; t.open = t.def.open; t.k = 1; t.dirty = true; this.resize(t); }
    this.saveLayout();
  }

  // ------------------------------------------------------------------ per frame
  /** shown: Kaito in the cockpit with the display on. Hands the display what it is to draw: each
   * visible header and body (the front-most tab's last), its picture and its rectangle */
  place(dt, shown) {
    this.visible = shown;
    const U = this.v.display.uniforms;
    if (!shown) { for (let i = 0; i < 4; i++) { U.uTabA.value[i] = 0; U['tTab' + i].value = null; } return; }
    const D = this.v.display;
    const pw = Math.max(0, Math.min(1, (D.power - 0.25) / 0.5));
    const parts = [];
    for (const t of this.tabs) {
      if (t.open && t.h > 0 && !t.body) { t.body = this.surface(t, 'body'); t.dirty = true; }
      if (t.dirty) this.shape(t);
      const target = pw * (this.drag && this.drag.tab === t ? 0.82 : 1);
      t.fade += (target - t.fade) * Math.min(1, dt * 6);
      if (Math.abs(t.fade - target) < 0.002) t.fade = target;
    }
    for (const t of this.tabs.slice().sort((a, b) => a.order - b.order)) {
      if (t.fade < 0.01) continue;
      parts.push({ t, S: t.head, y0: -t.hy, y1: t.hy });
      if (t.body && t.open && t.h > 0) parts.push({ t, S: t.body, y0: -t.by, y1: -t.hy });
    }
    const first = Math.max(0, parts.length - 4);
    for (let i = 0; i < 4; i++) {
      const p = parts[first + i];
      U['tTab' + i].value = p ? p.S.tex : null;
      U.uTabA.value[i] = p ? p.t.fade : 0;
      if (!p) continue;
      U.uTabC.value[i].copy(p.t.c); U.uTabX.value[i].copy(p.t.ex); U.uTabY.value[i].copy(p.t.ey);
      U.uTabR.value[i].set(-p.t.hx, p.t.hx, p.y0, p.y1);
    }
  }

  // ------------------------------------------------------------------ drawing
  /** redraw the tabs a few times a second (open ones more often) */
  draw(dt, power) {
    if (!this.visible) return;
    const q = QUALITY.level;
    for (const t of this.tabs) {
      if (t.fade < 0.02) continue;
      t.t += dt;
      const rate = t.open ? (q === 'low2' ? 2 : q === 'low' ? 3 : 4) : (q === 'low2' ? 1 : q === 'low' ? 1.5 : 2);
      if (t.t < 1 / rate) continue;
      t.t = 0;
      this.drawHead(t, power);
      if (t.open && t.body) this.drawBody(t, power);
    }
  }

  frame(K, S, warn) {
    const g = K.g;
    K.buttons.length = 0;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S.W, S.H);
    const Hk = 512 * S.H / S.W;
    // (dark and nearly opaque: the text reads over anything behind it)
    K.rect(1, 1, 510, Hk - 2, { fill: warn ? 'rgba(48,8,5,0.97)' : 'rgba(3,8,15,0.965)', stroke: warn ? 'rgba(255,110,80,0.85)' : 'rgba(140,220,255,0.5)', r: S.part === 'head' ? 9 : 7, lw: 1.6 });
  }

  drawHead(t, power) {
    const S = t.head, K = S.kit, Hh = 512 * S.H / S.W;
    const info = this.headInfo(t);
    this.frame(K, S, info.warn);
    if (power >= 0.2) {
      // a coloured rule at the left: what kind of tab this is
      K.rect(6, 8, 5, Hh - 16, { fill: info.warn ? COL.red : t.color, stroke: null, r: 2 });
      const title = t.pages ? `${t.title} · ${t.pages[t.pg][1]}` : t.title;
      K.text(title, 18, Hh / 2 + 1, { size: 19, color: info.warn ? '#ffb3a6' : t.color, weight: 700, base: 'middle' });
      const x0 = 18 + Math.max(50, measure(K, title, 19, 700) + 14);
      K.text(fit(K, info.text || '', 472 - x0, 15), x0, Hh / 2 + 1, { size: 15, color: info.warn ? '#ffd0c8' : COL.text, base: 'middle', mono: !!info.mono });
      if (!t.fixedClosed) K.text(t.open ? '▾' : '▸', 502, Hh / 2 + 1, { size: 19, color: COL.dim, align: 'right', base: 'middle' });
    }
    S.tex.needsUpdate = true;
  }

  drawBody(t, power) {
    const S = t.body, K = S.kit, H = 512 * S.H / S.W;
    this.frame(K, S, false);
    if (power >= 0.2) {
      if (t.pages) {
        // the row of pages; the page itself below it (its buttons moved down with it)
        const n = t.pages.length, bw = 492 / n;
        t.pages.forEach(([, label], i) => K.button(10 + i * bw + 2, 7, bw - 4, ROW - 12, label, () => this.setPage(t, i), { style: i === t.pg ? 'on' : 'normal', size: 15 }));
        K.rect(10, ROW - 1, 492, 1.2, { fill: 'rgba(130,215,255,0.25)', stroke: null, r: 0 });
        const fn = this['body_' + t.pages[t.pg][0]];
        const nb = K.buttons.length;
        K.g.save();
        K.g.translate(0, ROW * K.s);
        this._off = ROW;
        try { if (fn) fn.call(this, K, H - ROW, t); } catch (e) { K.text('—', 14, 30, { size: 13, color: COL.dim }); }
        K.g.restore();
        this._off = 0;
        for (let i = nb; i < K.buttons.length; i++) K.buttons[i].y += ROW;
      } else {
        const fn = this['body_' + t.id];
        if (fn) { try { fn.call(this, K, H, t); } catch (e) { K.text('—', 14, 30, { size: 13, color: COL.dim }); } }
      }
    }
    S.tex.needsUpdate = true;
  }

  /** another page of a tab */
  setPage(t, i) {
    if (t.pg === i) return;
    t.pg = i; t.page = 0; t.sub = 0; t.pm = null;
    t.t = 999;
    this.saveLayout();
  }

  /** the strip of figures in each header */
  headInfo(t) {
    if (!t.pages) return this.pageInfo(t.id);
    if (t.id === 'ops') {
      const a = this.v.alertText();
      if (a) return { text: a, warn: true };
    }
    return this.pageInfo(t.pages[t.pg][0]);
  }

  /** a page's figures for the header */
  pageInfo(id) {
    const v = this.v, g = v.g;
    const f = v.flight, docked = v.mode === 'docked';
    switch (id) {
      case 'alert': {
        const a = v.alertText();
        if (a) return { text: a, warn: true };
        const last = g.asphalt.log.filter((e) => e.who === 'hachi').slice(-1)[0];
        const say = last && g.time - last.t < 12000 ? last.text.replace(/^HACHI: /, '') : null;
        const n = v.hud ? v.hud.locks.length : 0;
        return { text: say || `ロック ${n} ・ 中央の枠に収めてロック ・ ロック枠を2回タップでそこへ向かう` };
      }
      case 'hull': {
        const z = g.lifeSupport.z.h8;
        const kPa = z ? z.n2 + z.o2 + z.co2 : 101.3;
        const bad = v.hull.cams.filter((c) => c < CAM_DEAD).length;
        return { text: `外部装甲 ${Math.round(v.armour.outer * 100)}%  内部 ${Math.round(v.armour.inner * 100)}%  気圧 ${kPa.toFixed(0)} kPa${bad ? `  カメラ喪失 ${bad}` : ''}`, warn: v.armour.inner < 0.15 || kPa < 80 || bad > 0 };
      }
      case 'drive': {
        const fl = docked ? g.flight : f;
        const vRel = fl.vel.clone().sub(fl.refVelocity(fl.pos, _v3)).length();
        const mode = v.driveModeName ? v.driveModeName() : (fl.ultra ? 'ULTRA' : '通常');
        return { text: `${vRel.toFixed(vRel < 100 ? 1 : 0)} m/s  ${mode}  推進剤 ${Math.round(f.fuel * 100)}%  蓄電 ${Math.round(v.power.smes / H8.smesMJ * 100)}%`, warn: f.fuel < 0.05 || v.power.smes < H8.smesMJ * 0.05 };
      }
      case 'nav': return { text: v.navLine() };
      case 'wpn': {
        const W = g.weapons;
        if (!W) return { text: '—' };
        const n = v.defence ? v.defence.n : 0;
        const A = W.arsenal;
        return { text: `砲 ${W.ammo.cannon}  レール ${W.ammo.rail}  ミサイル ${W.ammo.missile}  ${W.auto.hachi ? '自動迎撃' : '手動'}${A.mw > 0.5 ? `  生産 ${Math.round(A.mw)} MW` : ''}${n ? `  敵 ${n}（50 km）` : ''}`, warn: n > 0 };
      }
      case 'cam': {
        const Z = v.zoom, z = Z ? Z.z : 1;
        const ok = v.hull.cams.filter((c) => c >= CAM_DEAD).length;
        return { text: `×${z < 10 ? z.toFixed(1) : z.toFixed(0)}${Z && Z.follow && Z.target ? '  追従 ' + (Z.target.short || Z.target.name) : ''}  カメラ ${ok}/4${g.photos ? `  写真 ${g.photos.count}` : ''}`, warn: ok < 4 };
      }
      case 'b29': {
        if (docked) return { text: '結合中・ケーブル接続' };
        const L = v.link;
        return { text: L.ok ? `${fmtDist(L.d)}  リンク ${Math.round(v.linkQuality() * 100)}%  ${v.b29State()}` : `${fmtDist(L.d)}  通信圏外`, warn: !L.ok };
      }
      case 'hachi': return { text: v.hachiLine ? v.hachiLine() : '' };
      case 'gear': return { text: v.gearLine ? v.gearLine() : (v.suitLine ? v.suitLine() : '') };
      default: return { text: '' };
    }
  }

  // ------------------------------------------------------------------ bodies
  // (a body is 512 units wide and about 360 high; text from 14 units up, rows of 27: big enough
  // to read at a glance from the seat)

  /** a labelled bar row; returns the next y */
  row(K, y, label, val, txt, col, warn) {
    K.text(label, 14, y + 14, { size: 15, color: warn ? '#ff8a7a' : COL.dim });
    K.bar(118, y + 6, 250, 10, val, warn ? COL.red : col);
    K.text(txt, 498, y + 15, { size: 15, color: warn ? '#ff8a7a' : COL.text, align: 'right', mono: true });
    return y + 27;
  }

  /** a row of buttons along the bottom: [[label, fn, style], ...] */
  buttons(K, H, list) {
    const n = list.length, gap = 8, bw = (492 - gap * (n - 1)) / n, by = H - 48;
    list.forEach(([label, fn, style], i) => K.button(10 + i * (bw + gap), by, bw, 40, label, fn, { style: style || 'normal', size: 14.5 }));
  }

  /** small boxes side by side: [{ label, val (0..1), txt, bad }] */
  chips(K, y, list, h = 44) {
    const n = list.length, cw = 492 / n;
    list.forEach((c, i) => {
      const x = 10 + i * cw;
      K.rect(x + 2, y, cw - 4, h, { fill: c.bad ? 'rgba(255,77,61,0.18)' : 'rgba(255,255,255,0.04)', stroke: c.bad ? COL.red : 'rgba(150,190,230,0.22)', r: 6 });
      K.text(c.label, x + cw / 2, y + 17, { size: 13, color: c.bad ? '#ff9a8a' : COL.dim, align: 'center' });
      if (c.txt) K.text(c.txt, x + cw / 2, y + 35, { size: 13.5, color: c.bad ? COL.red : COL.text, align: 'center', mono: true });
      else K.bar(x + 12, y + 28, cw - 24, 6, c.val, c.bad ? COL.red : c.val < 0.9 ? AMBER : COL.green);
    });
    return y + h + 8;
  }

  body_hull(K, H) {
    const v = this.v, g = v.g, docked = v.mode === 'docked';
    const holes = v.hull.dents.filter((d) => d.hole && !d.patched).length;
    const integ = Math.round((v.armour.outer * 0.45 + v.armour.inner * 0.4 + (v.circuitHealth ? v.circuitHealth() : 1) * 0.15) * 100);
    K.text(`機体 ${integ}%`, 14, 30, { size: 22, color: integ < 50 ? COL.red : COL.text, weight: 700 });
    K.text(`被弾 ${v.hits}  へこみ ${v.hull.dents.length}  貫通 ${holes}  装甲板脱落 ${v.hull.tiles.length}`, 498, 28, { size: 14, color: holes ? '#ff8a7a' : COL.dim, align: 'right' });
    let y = 42;
    y = this.row(K, y, '外部装甲', v.armour.outer, `${Math.round(v.armour.outer * 100)}%`, COL.green, v.armour.outer < 0.35);
    y = this.row(K, y, '内部装甲', v.armour.inner, `${Math.round(v.armour.inner * 100)}%`, COL.green, v.armour.inner < 0.5);
    const z = g.lifeSupport.z.h8;
    const kPa = z ? z.n2 + z.o2 + z.co2 : 101.3;
    const o2 = z ? z.o2 / Math.max(1, kPa) : 0.21;
    y = this.row(K, y, '船内気圧', kPa / 101.3, `${kPa.toFixed(1)} kPa`, COL.cyan, kPa < 90);
    y = this.row(K, y, '酸素', o2 / 0.21, `${(o2 * 100).toFixed(1)}%${v._leak ? ' 漏洩' : ''}`, COL.cyan, o2 < 0.17 || !!v._leak);
    y += 4;
    if (v.circuits) {
      const names = { drive: '推進制御', power: '電力', sensor: 'センサー', comms: '通信', fire: '射撃管制' };
      y = this.chips(K, y, Object.keys(names).map((k) => ({ label: names[k], val: v.circuits[k] ?? 1, bad: (v.circuits[k] ?? 1) < 0.5 })));
    }
    y = this.chips(K, y, CAMERAS.map((c, i) => { const h = v.hull.cams[i]; return { label: c.name.split(' ')[0], txt: h < CAM_DEAD ? '喪失' : `${Math.round(h * 100)}%`, bad: h < CAM_DEAD }; }));
    const broken = v.display.panelHP.reduce((n, h) => n + (h < 0.35 ? 1 : 0), 0) + v.display.floorHP.reduce((n, h) => n + (h < 0.35 ? 1 : 0), 0);
    if (broken && y < H - 70) K.text(`表示パネル 破損 ${broken} 枚`, 14, y + 12, { size: 14, color: '#ff8a7a' });
    // (undocked, the shaft is the airlock: pumped down, the lower hatch opens to space)
    const A = v.airlock || { mode: 'idle' };
    const lockLabel = A.mode === 'dep' ? '減圧中…' : A.mode === 'open' ? 'エアロック 閉・加圧' : A.mode === 'rep' ? '加圧中…' : 'エアロック 減圧';
    const al = v.alarm;
    this.buttons(K, H, [
      al && al.active && !al.silenced ? ['警報停止', () => v.silenceAlarm(), 'danger'] : ['H8 状況報告', () => v.reportH8()],
      docked ? [v.neckTarget > 0.5 ? '下ハッチ 閉' : '下ハッチ 開', () => v.portTapped(), 'normal']
        : [lockLabel, () => v.lockTapped(), v.crew ? (A.mode === 'open' ? 'warn' : A.mode === 'idle' ? 'normal' : 'on') : 'disabled'],
      ['HACHI 診断', () => v.mind && v.mind.ask('sitrep')],
    ]);
  }

  body_drive(K, H) {
    const v = this.v, g = v.g, f = v.flight, P = v.power, docked = v.mode === 'docked';
    const fl = docked ? g.flight : f;
    const vRel = fl.vel.clone().sub(fl.refVelocity(fl.pos, _v3)).length();
    const sv = vRel < 100 ? vRel.toFixed(1) : vRel < 1e4 ? vRel.toFixed(0) : (vRel / 1000).toFixed(2);
    K.text(sv, 14, 40, { size: 34, color: COL.text, weight: 600, mono: true });
    K.text(vRel < 1e4 ? 'm/s' : 'km/s', 20 + measure(K, sv, 34, 600, true), 40, { size: 15, color: COL.dim });
    K.text(`高度 ${(altOf(fl.pos) / 1000).toFixed(1)} km`, 498, 22, { size: 14.5, color: COL.text, align: 'right', mono: true });
    const vmax = v.maxSpeedNow ? v.maxSpeedNow() : fl.vUltra;
    K.text(`最高 ${vmax > 9500 ? (vmax / 1000).toFixed(1) + ' km/s' : Math.round(vmax) + ' m/s'}`, 498, 42, { size: 14, color: COL.dim, align: 'right', mono: true });
    let y = 54;
    const modes = v.driveModes ? v.driveModes() : null;
    if (modes) {
      const bw = 492 / modes.length;
      modes.forEach((m, i) => K.button(10 + i * bw + 3, y, bw - 6, 36, m.label, () => v.setDriveMode(m.id), { style: m.on ? (m.id === 'max' ? 'danger' : m.id === 'ultra' ? 'warn' : 'on') : m.ok ? 'normal' : 'disabled', size: 15 }));
      y += 44;
    }
    y = this.row(K, y, '推進剤', f.fuel, `${Math.round(f.fuel * 100)}%`, AMBER, f.fuel < 0.15);
    y = this.row(K, y, '蓄電', P.smes / H8.smesMJ, `${Math.round(P.smes / H8.smesMJ * 100)}%`, COL.cyan, P.smes < H8.smesMJ * 0.1);
    y = this.row(K, y, '原子炉', P.reactor, `${Math.round(P.reactor * H8.reactorMW)} MW`, COL.green, P.reactor > 0.97);
    const net = P.reactor * H8.reactorMW + P.feedMW - P.loadMW;
    K.text(`消費 ${Math.round(P.loadMW)} MW   収支 ${net >= 0 ? '+' : ''}${Math.round(net)} MW${P.feed ? `   給電 ${Math.round(P.feedMW)}` : ''}`, 14, y + 15, { size: 14.5, color: net < -1 ? '#ff8a7a' : COL.dim, mono: true });
    y += 25;
    const sm = net < -1 ? P.smes / -net : Infinity;
    if (Number.isFinite(sm) && y < H - 60) K.text(`蓄電が尽きるまで ${sm > 3600 ? (sm / 3600).toFixed(1) + ' 時間' : sm > 60 ? Math.round(sm / 60) + ' 分' : Math.round(sm) + ' 秒'}`, 14, y + 14, { size: 14.5, color: sm < 120 ? COL.red : AMBER });
    this.buttons(K, H, [
      [P.feedOn ? '給電 ON' : '給電 OFF', () => v.toggleFeed(), P.feedOn ? 'on' : 'normal'],
      [P.boost ? 'ブースト ON' : 'ブースト OFF', () => v.toggleBoost(), P.boost ? 'on' : 'normal'],
      [v.xfer === 'toB29' ? '移送 停止' : '推進剤→B-29', () => v.setXfer('toB29'), !docked ? 'disabled' : v.xfer === 'toB29' ? 'warn' : 'normal'],
    ]);
  }

  body_nav(K, H, t) {
    const v = this.v, g = v.g, P = v.pilot, L = v.linkState();
    let y = 8;
    const btn = (label, fn, style, x, w) => K.button(x, y, w, 34, label, fn, { style, size: 14 });
    if (v.mode === 'docked') {
      btn(v.pending ? 'ハッチを閉めて分離中…' : v.crew ? 'B-29 から分離（単独飛行）' : 'H8 を分離（護衛）', () => v.release(v.crew ? 'free' : 'escort'), v.pending ? 'on' : 'danger', 10, 492);
      y += 40;
      if (!v.crew) { btn('分離して停泊軌道へ', () => v.release('home'), 'normal', 10, 492); y += 40; }
    } else {
      const ap = g.autopilot, coming = ap.state !== 'off' && ap.target && ap.target.id === 'h8';
      if (v.berthAt) { btn(`${v.berthAt.name.replace('（修理基地）', '')} から離脱（係留中）`, () => v.unberth('free'), 'danger', 10, 492); y += 40; }
      btn(v.goalKind === 'b29' ? 'B-29 へ帰還中（中止）' : 'B-29 へ帰還・結合', () => (v.goalKind === 'b29' ? v.goal('hold') : v.call()), v.goalKind === 'b29' ? 'on' : 'warn', 10, 243);
      btn(coming ? 'B-29 が来ます（中止）' : 'B-29 を呼ぶ', () => (coming ? ap.disengage() : v.callB29()), coming ? 'on' : L.ok ? 'normal' : 'disabled', 259, 243);
      y += 40;
      btn(v.goalKind === 'escort' ? '護衛中' : 'B-29 を護衛', () => v.goal('escort'), v.goalKind === 'escort' ? 'on' : L.ok ? 'normal' : 'disabled', 10, 160);
      btn(v.crew ? (P.goal ? '手動にする' : '手動操縦中') : '待機', () => v.goal('hold'), !P.goal ? 'on' : 'normal', 176, 160);
      btn('停泊軌道へ', () => v.sendHome(), v.goalKind === 'home' ? 'on' : 'normal', 342, 160);
      y += 40;
      // the focused target: go there (a double tap on its box does the same)
      const F = v.hud && v.hud.primary();
      if (F) { btn(`フォーカス目標へ：${F.c.short || F.c.name}  ${fmtDist(F.c.dist)}`, () => v.goTo(F.c), v.goalKind === 'target' && v.goalId === F.c.id ? 'on' : 'warn', 10, 492); y += 40; }
    }
    if (v.mode !== 'docked' && y < H - 40) {
      const list = g.stations.list;
      const RH = 29, rows = Math.max(1, Math.floor((H - y - 26) / RH));
      const pages = Math.ceil(list.length / rows);
      t.page = Math.min(t.page, pages - 1);
      K.text('自律航行先（右：ドッキング）', 14, y + 15, { size: 13.5, color: COL.dim });
      if (pages > 1) K.button(402, y - 1, 100, 22, `${t.page + 1}/${pages} ▸`, () => { t.page = (t.page + 1) % pages; }, { size: 12 });
      y += 24;
      list.slice(t.page * rows, t.page * rows + rows).forEach((s) => {
        const sel = v.goalKind === s.id, st = s.dmg ? s.dmg.status : 'ok';
        const here = v.berthAt === s, dg = v.dockGoal === s;
        K.rect(10, y, 404, 25, { fill: sel ? 'rgba(95,208,255,0.18)' : 'rgba(255,255,255,0.04)', stroke: sel ? COL.cyan : 'rgba(120,190,255,0.16)', r: 6 });
        K.text(fit(K, s.name.replace('（修理基地）', ''), 270, 15), 20, y + 18, { size: 15, color: st === 'ok' ? COL.text : COL.dim });
        K.text(fmtDist(s.pos.distanceTo(v.flight.pos)), 406, y + 18, { size: 14, color: COL.dim, align: 'right', mono: true });
        K.buttons.push({ x: 10, y, w: 404, h: 25, onTap: () => v.goal(s.id) });
        K.button(418, y, 84, 25, here ? '係留中' : dg ? '接続中' : 'ドッキング', () => v.dockWith(s.id), { style: here || dg ? 'on' : st === 'ok' || st === 'damaged' ? 'normal' : 'disabled', size: 12 });
        y += RH;
      });
    }
  }

  body_wpn(K, H) {
    const v = this.v, g = v.g, W = g.weapons;
    if (!W) return;
    const A = W.arsenal, D = v.defence;
    const nx = (k) => { const t = A.nextIn(k); return Number.isFinite(t) ? ` 次 ${t > 90 ? Math.round(t / 60) + '分' : Math.max(1, Math.round(t)) + '秒'}` : ''; };
    let y = 6;
    y = this.row(K, y, '25mm 砲', W.ammo.cannon / 1600, `${W.ammo.cannon}`, AMBER, W.ammo.cannon < 200);
    y = this.row(K, y, 'レール', W.railCharge, W.railCharge < 1 ? `充電 ${Math.round(W.railCharge * 100)}%  ${W.ammo.rail}` : `発射可 ${W.ammo.rail}`, COL.cyan, W.ammo.rail <= 0);
    y = this.row(K, y, 'ミサイル', W.ammo.missile / 12, `${W.ammo.missile}/12${nx('missile')}`, '#ff8a6a', W.ammo.missile <= 0);
    // the fabricator: what it draws, whether it has priority, the feedstock left
    const pri = A.priority;
    K.text(`弾薬生産 ${Math.round(A.mw)} MW ${pri ? (A.by === 'hachi' ? '優先（HACHI）' : '優先') : '通常'}`, 14, y + 15, { size: 14.5, color: pri ? AMBER : COL.text, weight: pri ? 700 : 400 });
    K.text(`素材 ${(A.feedKg / 1000).toFixed(2)} t`, 498, y + 15, { size: 14, color: A.feedKg < 300 ? COL.red : COL.dim, align: 'right', mono: true });
    y += 22;
    if (D) {
      K.text(fit(K, D.line(), 484, 14), 14, y + 15, { size: 14, color: D.n ? (D.short ? '#ff8a7a' : AMBER) : COL.dim });
      y += 24;
    }
    // what the guns are on: the locks, the focus first, with the fire control's odds of a hit
    K.text('目標      距離   命中見込み 25mm / レール', 14, y + 13, { size: 13, color: COL.dim });
    y += 19;
    const T = W.targets('h8');
    if (!T.length) { K.text('目標なし — 中央の枠に収めてロック', 14, y + 16, { size: 14.5, color: COL.dim }); y += 26; }
    const prim = W.lastTarget, ic = W.intercept;
    for (const x of T) {
      if (y > H - 78) break;
      const sel = prim && prim.id === x.id, auto = ic && ic.id === x.id;
      K.rect(10, y, 492, 25, { fill: sel ? 'rgba(255,90,60,0.18)' : auto ? 'rgba(255,180,80,0.14)' : 'rgba(255,255,255,0.04)', stroke: sel ? COL.red : auto ? AMBER : 'rgba(150,190,230,0.18)', r: 6 });
      K.text(fit(K, `${sel ? '◆ ' : auto ? '◎ ' : ''}${x.name}`, 200, 14.5), 18, y + 17, { size: 14.5, color: x.threat ? '#ffb3a6' : COL.text });
      const pc = W.hitChance ? W.hitChance(x, 'cannon') : null, pr = W.hitChance ? W.hitChance(x, 'rail') : null;
      K.text(`${fmtDist(x.dist)}   ${pc != null ? pct(pc) : '—'} / ${pr != null ? pct(pr) : '—'}`, 494, y + 17, { size: 14, color: COL.text, align: 'right', mono: true });
      K.buttons.push({ x: 10, y, w: 492, h: 25, onTap: () => v.hud && v.hud.setPrimary(x.id) });
      y += 28;
    }
    this.buttons(K, H, [
      [W.auto.hachi ? '自動迎撃 ON' : '自動迎撃 OFF', () => W.toggleAuto('h8'), W.auto.hachi ? 'on' : 'normal'],
      [pri ? '生産優先 ON' : '生産優先 OFF', () => v.toggleAmmoPriority(), pri ? 'warn' : 'normal'],
      ['ミサイル', () => W.fireMissile('h8'), W.ammo.missile > 0 ? 'danger' : 'disabled'],
      ['レール', () => W.fireRail(true), W.railCharge >= 1 && W.ammo.rail > 0 ? 'warn' : 'disabled'],
    ]);
  }

  body_cam(K, H, t) {
    const v = this.v, g = v.g, Z = v.zoom;
    let y = 6;
    y = this.chips(K, y, CAMERAS.map((c, i) => { const h = v.hull.cams[i]; return { label: c.name.split(' ')[0] + ' ' + (c.name.split(' ')[1] || ''), txt: h < CAM_DEAD ? '信号なし' : h > 0.8 ? '正常' : `劣化 ${Math.round(h * 100)}%`, bad: h < CAM_DEAD }; }));
    if (!Z) return;
    const zs = `×${Z.z < 10 ? Z.z.toFixed(1) : Z.z < 100 ? Z.z.toFixed(1) : Z.z.toFixed(0)}`;
    K.text(zs, 14, y + 26, { size: 26, color: COL.text, weight: 600, mono: true });
    K.text(`${Math.round(Z.focal()).toLocaleString()} mm 相当`, 498, y + 12, { size: 13.5, color: COL.dim, align: 'right', mono: true });
    K.text(Z.digital > 1.01 ? `光学 ×${Z.OPT}  デジタル ×${Z.digital.toFixed(1)}` : `光学 ×${Z.optical.toFixed(1)} / ${Z.OPT}`, 498, y + 30, { size: 13.5, color: Z.digital > 1.01 ? AMBER : COL.cyan, align: 'right', mono: true });
    y += 38;
    // the zoom bar: optical then digital — tap along it to set the magnification
    const bx = 14, bw = 484, ow = bw * Math.log(Z.OPT) / Math.log(Z.OPT * Z.DIG);
    K.bar(bx, y, ow - 2, 9, Math.min(1, Math.log(Z.z) / Math.log(Z.OPT)), COL.cyan);
    K.bar(bx + ow + 2, y, bw - ow - 2, 9, Math.max(0, Math.log(Z.digital) / Math.log(Z.DIG)), AMBER);
    K.buttons.push({ x: bx, y: y - 10, w: bw, h: 29, onTap: null, zoomBar: true });
    this._zoomBar = { x: bx, w: bw, tab: t };
    y += 18;
    // what to follow (anything the display tracks)
    const C = (v.cands || []).slice().sort((a, b) => (b.locked ? 1 : 0) - (a.locked ? 1 : 0) || a.dist - b.dist);
    const RH = 27, rows = Math.max(1, Math.floor((H - 56 - y - 22) / RH));
    const pages = Math.max(1, Math.ceil(C.length / rows));
    t.page = Math.min(t.page, pages - 1);
    K.text('自動追従の対象（タップで選択）', 14, y + 14, { size: 13.5, color: COL.dim });
    if (pages > 1) K.button(402, y - 1, 100, 22, `${t.page + 1}/${pages} ▸`, () => { t.page = (t.page + 1) % pages; }, { size: 12 });
    y += 22;
    for (const c of C.slice(t.page * rows, t.page * rows + rows)) {
      const on = Z.follow && Z.target && Z.target.id === c.id;
      K.rect(10, y, 492, 23, { fill: on ? 'rgba(95,224,143,0.18)' : 'rgba(255,255,255,0.04)', stroke: on ? COL.green : 'rgba(150,190,230,0.16)', r: 6 });
      K.text(fit(K, `${on ? '● ' : c.locked ? '◇ ' : ''}${c.name}`, 330, 14.5), 18, y + 17, { size: 14.5, color: c.threat ? '#ffb3a6' : COL.text });
      K.text(fmtDist(c.dist || 0), 494, y + 17, { size: 13.5, color: COL.dim, align: 'right', mono: true });
      K.buttons.push({ x: 10, y, w: 492, h: 23, onTap: () => (on ? Z.toggleFollow() : Z.followTarget(c)) });
      y += RH;
    }
    this.buttons(K, H, [
      ['◉ 撮影', () => g.photos && g.photos.shoot(), 'warn'],
      [`写真 ${g.photos ? g.photos.count : 0}`, () => g.photos && g.photos.openGallery()],
      [Z.follow ? '追従 解除' : '追従', () => Z.toggleFollow(), Z.follow ? 'on' : 'normal'],
      ['等倍', () => Z.reset()],
    ]);
  }

  body_b29(K, H, t) {
    const v = this.v, g = v.g, docked = v.mode === 'docked';
    const mon = g.monitors;
    if (docked && mon) {
      // B-29's own pages, run from here over the cable
      const pages = [['nav', '航法'], ['sys', '系統'], ['life', '生命維持'], ['reactor', '原子炉'], ['comms', '通信']];
      const page = pages[t.sub % pages.length][0];
      if (!t.pm || t.pm.H !== Math.round(1024 * (H - 36) / 512)) {
        const c = document.createElement('canvas');
        c.width = 1024; c.height = Math.round(1024 * (H - 36) / 512);
        t.pm = { id: page, slot: { pos: v.root.position, w: 1, h: (H - 36) / 512, res: 1024 }, canvas: c, kit: new Kit(c), W: c.width, H: c.height, zoom: 1, tab: 0 };
      }
      const pm = t.pm;
      pm.id = page;
      const pk = pm.kit;
      pk.begin();
      const ph = 512 * pm.H / pm.W;
      try { mon._tabs = null; const fn = mon['draw_' + page]; if (fn) fn.call(mon, pk, pm, ph); } catch (e) { /* a page that needs B-29's own screen */ }
      pk.end(0, performance.now(), false);
      K.g.drawImage(pm.canvas, 0, 36 * K.s, K.W, (H - 36) * K.s);
      const w = 512 / pages.length;
      pages.forEach(([id, label], i) => {
        const on = i === t.sub % pages.length;
        K.button(i * w + 3, 4, w - 6, 29, label, () => { t.sub = i; }, { style: on ? 'on' : 'normal', size: 13.5 });
      });
      // taps below the row go to the page
      K.buttons.push({ x: 0, y: 36, w: 512, h: H - 36, onTap: null, page: true });
      const off = this._off || 0;
      this._pageHit = (x, y) => pk.hit(x * pk.s, (y - 36 - off) * pk.s);
      return;
    }
    const L = v.link, fb = g.flight, ap = g.autopilot;
    K.text(L.ok ? 'リンク良好' : L.why === 'range' ? '通信圏外（1500 km 超）' : 'B-29 応答なし', 14, 28, { size: 17, color: L.ok ? COL.green : COL.red, weight: 700 });
    K.text(fmtDist(L.d), 498, 28, { size: 17, color: COL.text, align: 'right', mono: true });
    K.bar(14, 38, 484, 6, 1 - Math.min(1, L.d / 1.5e6), L.ok ? COL.green : COL.red);
    let y = 52;
    if (L.ok) {
      const integ = g.damage.integrityNow ?? g.damage.integrity();
      const pw = g.systems.power ?? 1;
      K.text(fit(K, v.b29State(), 480, 15), 14, y + 15, { size: 15, color: COL.text });
      y += 26;
      y = this.row(K, y, '推進剤', fb.fuel, `${Math.round(fb.fuel * 100)}%`, AMBER, fb.fuel < 0.15);
      y = this.row(K, y, '船体', integ, `${Math.round(integ * 100)}%`, COL.green, integ < 0.6);
      y = this.row(K, y, '電力', pw, `${Math.round(pw * 100)}%`, COL.cyan, pw < 0.4);
      const al = g.systems.alarm.active;
      K.text(`警報 ${al ? '作動中' : 'なし'}   データリンク ${Math.round(v.linkQuality() * 100)}%`, 14, y + 15, { size: 14.5, color: al ? COL.red : COL.dim });
    } else {
      K.text('1500 km 以内に近づくと', 14, y + 16, { size: 15, color: COL.dim });
      K.text('状況の確認と呼び出しができます。', 14, y + 38, { size: 15, color: COL.dim });
    }
    const coming = ap.state !== 'off' && ap.target && ap.target.id === 'h8';
    this.buttons(K, H, [
      [coming ? '呼出 中止' : 'B-29 を呼ぶ', () => (coming ? ap.disengage() : v.callB29()), !L.ok ? 'disabled' : coming ? 'on' : 'warn'],
      ['状況報告', () => v.reportB29(), L.ok ? 'normal' : 'disabled'],
      ['迎えに行く', () => v.call(), L.ok ? 'normal' : 'disabled'],
      [g.weapons && g.weapons.auto.asphalt ? '機銃 自動' : '機銃 手動', () => g.weapons && g.weapons.toggleAuto('b29'), L.ok ? (g.weapons && g.weapons.auto.asphalt ? 'on' : 'normal') : 'disabled'],
    ]);
  }

  body_hachi(K, H) {
    const v = this.v;
    if (v.drawHachi) v.drawHachi(K, H);
  }

  body_gear(K, H) {
    const v = this.v;
    if (v.drawGear) v.drawGear(K, H, this);
  }

  // ------------------------------------------------------------------ touch
  /**
   * What a touch at client pixel (x, y) lands on: { tab, part: 'head' | 'body', x, y (the tab
   * canvas, 512 wide) } or null. cam: { eye, dir } in H8's frame (the ray of that pixel through
   * the unmagnified view)
   */
  hit(cam) {
    if (!this.visible) return null;
    const D = this.v.display;
    const t0 = D.surface(cam.eye, cam.dir);
    const P = _v.copy(cam.eye).addScaledVector(cam.dir, t0);
    // nothing to touch where the display is dead
    if (D.deadAt(cam.dir, P)) return null;
    if (this.inOpenDoor(_v2.copy(P).sub(H8.cockpitC).normalize())) return null;
    const u = _v2.copy(P).sub(E0).normalize();
    let best = null;
    for (const t of this.tabs) {
      if (t.fade < 0.3) continue;
      const a = t.at(u);
      if (!a || (best && best.tab.order > t.order)) continue;
      best = { tab: t, part: a.part, u: a.u, v: a.v };
    }
    if (!best) return null;
    const S = best.part === 'head' ? best.tab.head : best.tab.body;
    best.x = best.u * 512;
    best.y = (1 - best.v) * 512 * S.H / S.W;
    best.eye = cam.eye.clone(); best.dir = cam.dir.clone();
    return best;
  }

  /** the tab covering a line of sight from the eye (H8-local), or null — markers under a tab are
   * not drawn */
  coverAt(eye, dir) {
    if (!this.visible) return null;
    const t0 = this.v.display.surface(eye, dir);
    const u = _v.copy(eye).addScaledVector(dir, t0).sub(E0).normalize();
    let best = null;
    for (const t of this.tabs) if (t.fade > 0.3 && (!best || t.order > best.order) && t.at(u)) best = t;
    return best;
  }

  inOpenDoor(u) {
    const az = Math.atan2(u.x, -u.z), el = Math.asin(Math.max(-1, Math.min(1, u.y)));
    const inside = (D) => { let d = az - D.az; d -= Math.round(d / RT) * RT; return Math.abs(d) < D.hw && el > D.el0 && el < D.el1; };
    return (this.v.shelterOpen || 0) > 0.02 && inside(H8.shelter);
  }

  /**
   * The tabs' outlines on the screen (for the markers to be drawn round them): rootW (H8's world
   * matrix), vp (the unmagnified view-projection), W, H (CSS px). [[x, y], ...] per visible part
   */
  outlines(rootW, vp, W, H) {
    const out = [];
    if (!this.visible) return out;
    _m.multiplyMatrices(vp, rootW);
    for (const t of this.tabs) {
      if (t.fade < 0.3) continue;
      const y1 = t.hy, y0 = t.open && t.body && t.h > 0 ? -t.by : -t.hy;
      const poly = [];
      const push = (X, Y) => {
        _v.copy(t.c).addScaledVector(t.ex, X).addScaledVector(t.ey, Y).normalize();
        onGlass(_v, _v2);
        const p = _v3.copy(_v2).applyMatrix4(_m);
        poly.push([(p.x * 0.5 + 0.5) * W, (0.5 - p.y * 0.5) * H, p.z < 1]);
      };
      const n = 8;
      for (let i = 0; i <= n; i++) push(-t.hx + 2 * t.hx * i / n, y1);
      for (let j = 1; j <= n; j++) push(t.hx, y1 + (y0 - y1) * j / n);
      for (let i = n - 1; i >= 0; i--) push(-t.hx + 2 * t.hx * i / n, y0);
      for (let j = n - 1; j >= 1; j--) push(-t.hx, y1 + (y0 - y1) * j / n);
      if (poly.every((p) => p[2])) out.push(poly);
    }
    return out;
  }

  /** a tap on a tab (from hit()) */
  tap(hit) {
    const t = hit.tab, A = this.v.g.audio;
    this.toFront(t);
    if (hit.part === 'head') {
      if (t.fixedClosed) return;
      t.open = !t.open;
      t.t = 999;
      this.saveLayout();
      A.beep && A.beep(t.open ? 1500 : 1100, 0.04, 0.04, { direct: true });
      return;
    }
    const S = t.body, K = S.kit;
    const x = hit.x, y = hit.y;
    let ok = false;
    // the zoom bar in the camera tab: the magnification where it was tapped
    const zb = this._zoomBar;
    const bar = K.buttons.find((b) => b.zoomBar && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (bar && zb && this.v.zoom) { this.v.zoom.setFraction((x - zb.x) / zb.w); ok = true; }
    else {
      // a page shown inside the body (B-29's own) takes the taps below its tab row
      const pb = K.buttons.find((b) => b.page && y >= b.y);
      if (pb && this._pageHit) ok = this._pageHit(x, y);
      else ok = K.hit(x * K.s, y * K.s);
    }
    t.t = 999;
    A.click && A.click(null, ok ? 0.2 : 0.08);
    if (ok) A.beep && A.beep(1320, 0.04, 0.05, { direct: true });
  }

  toFront(t) { if (t.order !== this.z) t.order = ++this.z; }

  /** start dragging a tab by its header (the point under the finger on the glass) */
  dragStart(hit) {
    const p = this.onSphere(hit.eye, hit.dir);
    if (!p) return;
    this.toFront(hit.tab);
    this.drag = { tab: hit.tab, dAz: hit.tab.az - p.az, dEl: hit.tab.el - p.el };
  }

  /** cam: { eye, dir } (H8-local) of the finger now */
  dragMove(cam) {
    const D = this.drag;
    if (!D) return;
    const p = this.onSphere(cam.eye, cam.dir);
    if (!p) return;
    const t = D.tab;
    let az = p.az + D.dAz;
    az -= Math.round(az / RT) * RT;
    t.az = az;
    t.el = Math.max(-78 * DEG, Math.min(80 * DEG, p.el + D.dEl));
    t.dirty = true;
  }

  dragEnd() {
    if (!this.drag) return;
    this.drag = null;
    this.saveLayout();
  }

  /** two fingers on a tab: f > 1 makes it bigger */
  scaleBy(t, f) {
    const k = Math.max(K_MIN, Math.min(K_MAX, t.k * f));
    if (Math.abs(k - t.k) < 1e-4) return;
    t.k = k;
    t.dirty = true;
    this.toFront(t);
  }

  /** the pinch is over: the canvases are redrawn at the resolution the new size wants */
  resize(t) {
    t.resK = t.k;
    this.size(t, t.head);
    if (t.body) this.size(t, t.body);
    this.saveLayout();
  }

  /** where a ray from the eye (H8-local) meets the glass: (az, el) as seen from the eye point */
  onSphere(eye, dir) {
    const t0 = this.v.display.surface(eye, dir);
    const p = _v.copy(eye).addScaledVector(dir, t0).sub(E0).normalize();
    return { az: Math.atan2(p.x, -p.z), el: Math.asin(Math.max(-1, Math.min(1, p.y))) };
  }
}

function measure(K, str, size, weight = 400, mono = false) {
  K.font(size, weight, mono);
  return K.g.measureText(str).width / K.s;
}

/** the text cut to a width (Kit units), with an ellipsis */
function fit(K, str, w, size) {
  K.font(size);
  if (K.g.measureText(str).width / K.s <= w) return str;
  let s = str;
  while (s.length > 1 && K.g.measureText(s + '…').width / K.s > w) s = s.slice(0, -1);
  return s + '…';
}

function pct(p) { return p >= 0.995 ? '99%' : p < 0.005 ? '<1%' : Math.round(p * 100) + '%'; }
