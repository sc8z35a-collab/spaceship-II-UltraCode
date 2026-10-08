// The suit's own display, projected on the inside of the visor: it follows the glass's curve
// (everything lies on a wide arc round the view, the edges bending away), drawn in the suit's
// colour (H8's amber, B-29's blue). What it shows:
//  - oxygen: the main tank and the emergency bottle, the time they last at this rate (leaks too);
//  - power: the battery in use, the spare, the flight time left at full use, the boosters each;
//  - flight: the speed against the ship (or what was picked), the fine thrusters / boosters, the
//    flight computer's hold; markers on B-29, H8 and the nearest station with their distances;
//  - the suit itself: a figure with each part's state, the systems that are out, what just
//    happened; cracks in the visor drawn where they are on the glass;
//  - the camera (24-70 mm, then a crop up to 5x): its frame, the focal length, the shutter;
//  - calls for help: B-29, H8, the nearest station.
// The buttons along the bottom: lamp, sun visor, camera, call, boosters, hold.
import * as THREE from 'three';
import { PARTS, SYSTEMS_JP } from './suitSystem.js';
import { FOCAL, DIGITAL_MAX } from './suitCamera.js';

const _v = new THREE.Vector3(), _m = new THREE.Matrix4();
const EV_JP = {
  scratch: '擦り傷', crack: 'ひび', breach: '破損・漏れ', systems: '機能低下', battery_swap: '予備バッテリーに交換中', battery_swapped: '予備バッテリーに切替完了',
  battery_dead: 'バッテリー切れ', shutdown: 'システム停止', o2_reserve: '非常用酸素に切替', radio_dead: '通信機が故障',
};

function hms(s) {
  if (!Number.isFinite(s)) return '--:--';
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
function fmtD(m) { return m >= 10000 ? (m / 1000).toFixed(0) + ' km' : m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; }

export class VisorHud {
  constructor(g, suits) {
    this.g = g;
    this.s = suits;
    this.on = 0;           // 0 off .. 1 up (the boot / shutdown fade)
    this.bootT = 0;
    this.events = [];
    this.t = 0;
    this.camMode = false;
    const host = document.getElementById('hud') || document.body;
    const el = this.el = document.createElement('div');
    el.id = 'visor';
    el.innerHTML = `<canvas></canvas>
      <div class="vz-bar">
        <button data-k="lamp">ライト</button><button data-k="visor">サンバイザー</button><button data-k="cam">カメラ</button>
        <button data-k="call" class="red">救助要請</button><button data-k="boost">ブースター</button><button data-k="hold">自動停止</button>
      </div>
      <button class="vz-hatch">ハッチに入る</button>
      <div class="vz-call">
        <div class="vz-t">救助を呼ぶ</div>
        <button data-c="b29">B-29 を呼ぶ</button><button data-c="h8">H8 を呼ぶ</button><button data-c="station">最寄りのステーション</button><button data-c="x" class="dim">閉じる</button>
      </div>
      <div class="vz-cam">
        <button data-z="in">＋</button><div class="vz-slider"><div class="vz-knob"></div></div><button data-z="out">−</button>
        <button data-z="shoot" class="shoot"></button><button data-z="exit" class="dim">戻る</button>
      </div>`;
    host.appendChild(el);
    this.cv = el.querySelector('canvas');
    this.ctx = this.cv.getContext('2d');
    const stop = (e) => e.stopPropagation();
    for (const b of el.querySelectorAll('button')) { b.addEventListener('pointerdown', stop); b.addEventListener('touchstart', stop, { passive: true }); }
    el.querySelector('.vz-bar').addEventListener('click', (e) => { const k = e.target && e.target.dataset && e.target.dataset.k; if (k) this.press(k); });
    el.querySelector('.vz-hatch').addEventListener('click', () => { if (this.s.hatchNear) this.s.evaEnter(this.s.hatchNear); });
    el.querySelector('.vz-call').addEventListener('click', (e) => { const c = e.target && e.target.dataset && e.target.dataset.c; if (!c) return; this.callOpen(false); if (c !== 'x') this.s.call(c); });
    const camEl = el.querySelector('.vz-cam');
    camEl.addEventListener('click', (e) => {
      const z = e.target && e.target.dataset && e.target.dataset.z;
      if (z === 'in') this.s.cam.step(1); else if (z === 'out') this.s.cam.step(-1);
      else if (z === 'shoot') this.shoot();
      else if (z === 'exit') this.camera(false);
    });
    // the zoom slider: drag along it (logarithmic, bottom = 24 mm, top = 70 mm x5)
    const sl = el.querySelector('.vz-slider');
    const drag = (e) => {
      const r = sl.getBoundingClientRect();
      const y = (e.touches ? e.touches[0].clientY : e.clientY);
      this.s.cam.setFraction(1 - (y - r.top) / r.height);
      e.stopPropagation(); e.preventDefault();
    };
    sl.addEventListener('pointerdown', (e) => { sl.setPointerCapture(e.pointerId); drag(e); });
    sl.addEventListener('pointermove', (e) => { if (e.buttons) drag(e); });
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.W = Math.round(window.innerWidth * dpr); this.H = Math.round(window.innerHeight * dpr);
    this.cv.width = this.W; this.cv.height = this.H;
    this.dpr = dpr;
  }

  boot() { this.bootT = 0.001; }
  shutdown() { this.bootT = -1; this.camera(false); this.callOpen(false); }

  event(kind, info = '') {
    let txt = EV_JP[kind] || kind;
    if (info && PARTS[info]) txt = `${PARTS[info].jp}：${txt}`;
    else if (kind === 'systems' && info) txt = `${info.split(',').map((s) => SYSTEMS_JP[s] || s).join('・')} ${txt}`;
    this.events.push({ txt, t: 0, red: ['breach', 'battery_dead', 'shutdown', 'radio_dead', 'crack'].includes(kind) });
    if (this.events.length > 4) this.events.shift();
  }

  press(k) {
    const s = this.s, g = this.g;
    const A = g.audio;
    A.beep(1500, 0.03, 0.04, { direct: true });
    if (k === 'lamp') s.lamp = !s.lamp;
    else if (k === 'visor') s.sunVisor = s.sunVisor > 0.5 ? 0 : 1;
    else if (k === 'cam') this.camera(!this.camMode);
    else if (k === 'call') this.callOpen(!this.el.classList.contains('calling'));
    else if (k === 'boost') { s.boost = !s.boost; if (s.boost) A.mech(null, 'servo', { open: true, direct: true, gain: 0.6, pitch: 0.8 }); }
    else if (k === 'hold') s.hold = !s.hold;
  }

  callOpen(on) { this.el.classList.toggle('calling', on); }

  /** the camera on the helmet: its picture on the visor (the view through the glass is replaced) */
  camera(on) {
    const g = this.g, s = this.s;
    if (on && (!s.state || s.state.sys.camera < 0.15)) { this.event('systems', 'camera'); return; }
    this.camMode = on;
    s.cam.on = on;
    this.el.classList.toggle('cam', on);
    if (!on) { g.engine.setZoom(1); g.engine.grade.set('uPixel', 1); s.cam.crispScreens(this.screenTextures(), false); }
  }

  screenTextures() { return (this.g.monitors ? this.g.monitors.list : []).map((m) => m.tex); }

  shoot() {
    const g = this.g, s = this.s;
    s.cam.flash = 1;
    if (g.photos) g.photos.shoot();
    else g.audio.beep(2000, 0.02, 0.05, { direct: true });
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const g = this.g, s = this.s, pl = g.player, S = s.state;
    const wearing = !!S && (pl.suit || (s.seq && s.seq.on));
    // boot / shutdown
    if (this.bootT > 0) { this.bootT += dt; this.on = Math.min(1, this.bootT / 2.2); if (this.bootT > 2.2) this.bootT = 0; }
    else if (this.bootT < 0) { this.on = Math.max(0, this.on - dt * 2); if (this.on <= 0) this.bootT = 0; }
    else if (pl.suit && !s.seq && this.on < 1) this.on = Math.min(1, this.on + dt * 2);
    if (!pl.suit && !s.seq) this.on = 0;
    const show = wearing && this.on > 0.01 && g.mode !== 'camera' && pl.state !== 'dead';
    this.el.classList.toggle('on', show);
    this.el.classList.toggle('busy', !!s.seq);
    this.el.classList.toggle('hatch', !!s.hatchNear);
    for (const e of this.events) e.t += dt;
    this.events = this.events.filter((e) => e.t < 8);
    // the camera's view: the lens narrows the field, the crop coarsens the picture
    if (this.camMode) {
      if (!show || !S || S.sys.camera < 0.15 || S.shutdown) this.camera(false);
      else {
        const base = g.engine.hfov || 92;
        const z = Math.tan(base * Math.PI / 360) / Math.tan(s.cam.hfov() * Math.PI / 360);
        g.engine.setZoom(Math.max(1, z));
        g.engine.grade.set('uPixel', s.cam.d > 1.01 ? s.cam.d : 1);
        // the screens aboard: their own pixels, as they are (no smoothing up past them)
        s.cam.crispScreens(this.screenTextures(), s.cam.zoom > 1.4);
      }
    }
    if (!show) return;
    this.t += dt;
    if ((this._acc = (this._acc || 0) + dt) < 1 / 20) return;
    this._acc = 0;
    this.draw();
  }

  draw() {
    const g = this.g, s = this.s, S = s.state, pl = g.player, x = this.ctx;
    const W = this.W, H = this.H, k = this.dpr;
    x.clearRect(0, 0, W, H);
    if (!S) return;
    const top = S.spec.grade === 'top';
    const C = top ? [255, 178, 80] : [110, 200, 255];
    const col = (a) => `rgba(${C[0]},${C[1]},${C[2]},${a})`;
    const red = (a) => `rgba(255,90,70,${a})`;
    // a dead HUD flickers, a shut-down suit shows only that it is down
    const hudK = S.sys.hud;
    const flick = hudK < 0.6 && Math.random() > hudK + 0.25;
    x.globalAlpha = this.on * (flick ? 0.25 : 1) * (S.shutdown ? 0.85 : 1);
    const f = Math.min(W, H * 1.9);
    const font = (px, w = 600) => `${w} ${Math.round(px * f / 900)}px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    x.textBaseline = 'middle';
    if (S.shutdown) {
      x.font = font(26, 700); x.fillStyle = red(0.5 + 0.5 * Math.sin(this.t * 5)); x.textAlign = 'center';
      x.fillText('システム停止 — 受動生命維持のみ', W / 2, H * 0.3);
      this.cracks(x, S, W, H);
      return;
    }
    // the visor's curve: a block placed on the arc round the view, turned to lie along it
    const cx = W / 2, cy = H * 0.56, rx = W * 0.47, ry = H * 0.5;
    const place = (ang, fn) => {
      const a = ang * Math.PI / 180;
      const px = cx + Math.cos(a) * rx, py = cy - Math.sin(a) * ry;
      // (leaning in toward the middle at the sides, as the glass curves round)
      x.save(); x.translate(px, py); x.rotate(-Math.cos(a) * 0.12); fn(); x.restore();
    };
    // ---- the boot sequence's lines
    if (this.on < 1) {
      x.font = font(16, 600); x.fillStyle = col(0.9); x.textAlign = 'left';
      const L = ['POWER ON', 'LIFE SUPPORT  ……  OK', `O₂ ${Math.round(S.o2 * 100)}%  …  OK`, 'SUIT PRESSURE 29.6 kPa  …  OK', 'BOOSTERS  …  ' + (S.thrustK() > 0 ? 'READY' : 'FAULT'), 'HUD READY'];
      const n = Math.floor(this.on * L.length * 1.2);
      L.slice(0, n).forEach((l, i) => x.fillText(l, W * 0.3, H * 0.3 + i * 22 * f / 900));
    }
    // ---- left: oxygen
    const o2Left = S.o2Left(pl.state === 'evaWalk' ? 0.4 : 0.15);
    place(196, () => {
      x.textAlign = 'left';
      x.font = font(13); x.fillStyle = col(0.7); x.fillText('O₂', 0, -46 * f / 900);
      x.font = font(30, 700); x.fillStyle = S.o2 < 0.15 ? red(0.95) : col(0.95); x.fillText(`${Math.round(S.o2 * 100)}%`, 0, -18 * f / 900);
      x.font = font(13); x.fillStyle = col(0.8); x.fillText(`残り ${hms(o2Left)}`, 0, 10 * f / 900);
      x.fillText(`非常用 ${Math.round(S.reserve * 100)}%   スーツ内 29.6 kPa`, 0, 30 * f / 900);
      if (S.leakK > 0.01) { x.fillStyle = red(0.95); x.fillText(`漏れ ×${S.leakK.toFixed(0)}`, 0, 50 * f / 900); }
      this.bar(x, 0, -66 * f / 900, 150 * f / 900, 6 * f / 900, S.o2, S.o2 < 0.15 ? red(0.9) : col(0.9), col(0.15));
    });
    // ---- right: power and the boosters
    const B = S.spec.battery;
    place(-16, () => {
      x.textAlign = 'right';
      x.font = font(13); x.fillStyle = col(0.7); x.fillText('バッテリー', 0, -46 * f / 900);
      x.font = font(30, 700); x.fillStyle = S.battery < 0.15 ? red(0.95) : col(0.95); x.fillText(`${Math.round(S.battery * 100)}%`, 0, -18 * f / 900);
      x.font = font(13); x.fillStyle = col(0.8);
      x.fillText(`飛行可能 ${hms(S.flightLeft())}   予備 ${S.spares.length ? S.spares.map((b) => Math.round(b * 100) + '%').join(' ') : 'なし'}`, 0, 10 * f / 900);
      const P = S.spec.propulsion;
      const bst = P.boosters > 1 ? `L ${S.boosterL > 0.5 ? '●' : '×'}  R ${S.boosterR > 0.5 ? '●' : '×'}` : `${S.boosterL > 0.5 ? '●' : '×'}`;
      x.fillText(`ブースター ${bst}   ${s.boost ? '起動中' : '待機'}  最大 ${P.vMax} m/s`, 0, 30 * f / 900);
      if (S.swapT > 0) { x.fillStyle = col(0.5 + 0.5 * Math.sin(this.t * 8)); x.fillText(`予備バッテリーに交換中 ${S.swapT.toFixed(0)} 秒`, 0, 50 * f / 900); }
      this.bar(x, -150 * f / 900, -66 * f / 900, 150 * f / 900, 6 * f / 900, S.battery, S.battery < 0.15 ? red(0.9) : col(0.9), col(0.15));
    });
    // ---- top: the suit, the time
    place(90, () => {
      x.textAlign = 'center';
      x.font = font(12); x.fillStyle = col(0.6);
      const d = new Date(g.time);
      x.fillText(`${S.spec.name}  ${S.spec.gradeJP}   ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`, 0, 52 * f / 900);
    });
    // ---- bottom: speed, mode, the distances
    const ref = this.refVel();
    place(270, () => {
      x.textAlign = 'center';
      x.font = font(26, 700); x.fillStyle = col(0.95);
      x.fillText(`${ref.v < 10 ? ref.v.toFixed(2) : ref.v.toFixed(0)} m/s`, 0, -112 * f / 900);
      x.font = font(12); x.fillStyle = col(0.75);
      x.fillText(`${ref.name}に対する速度   ${s.boost ? 'ブースター' : '微調整スラスター'}   ${s.hold ? '自動停止 ON' : '自動停止 OFF'}`, 0, -88 * f / 900);
      if (s.rescue) { x.fillStyle = col(0.6 + 0.4 * Math.sin(this.t * 4)); x.fillText(this.rescueText(), 0, -68 * f / 900); }
    });
    // ---- markers: B-29, H8, the nearest station
    this.markers(x, col, f);
    // ---- the suit's figure and the systems that are out
    this.figure(x, S, W * 0.06, H * 0.62, f, col, red);
    // ---- what just happened
    x.textAlign = 'center';
    this.events.forEach((e, i) => {
      x.font = font(15, 700);
      x.fillStyle = e.red ? red(Math.min(1, 2 - e.t / 4)) : col(Math.min(1, 2 - e.t / 4));
      x.fillText(e.txt, W / 2, H * 0.17 + i * 24 * f / 900);
    });
    // ---- the camera's frame
    if (this.camMode) this.viewfinder(x, W, H, f, col, font);
    // ---- cracks in the visor
    this.cracks(x, S, W, H);
    x.globalAlpha = 1;
  }

  bar(x, X, Y, w, h, v, c, bg) { x.fillStyle = bg; x.fillRect(X, Y, w, h); x.fillStyle = c; x.fillRect(X, Y, w * Math.max(0, Math.min(1, v)), h); }

  /** the velocity against the ship (B-29, or H8 when out from it alone) */
  refVel() {
    const g = this.g, pl = g.player;
    const h8 = g.h8 && g.h8.solo;
    return { v: pl.vel.length(), name: h8 ? 'H8' : 'B-29' };
  }

  rescueText() {
    const R = this.s.rescue;
    if (!R) return '';
    if (R.who === 'b29') return 'B-29 が接近中';
    if (R.who === 'h8') return 'H8 が向かっています';
    if (R.towing) return `${R.station.st.name} のタグが曳航中`;
    return `${R.station.st.name} のタグが向かっています（あと ${hms(R.eta - R.t)}）`;
  }

  markers(x, col, f) {
    const g = this.g, cam = g.engine.camera, W = this.W, H = this.H;
    const items = [];
    const pv = g.shipVis.root.matrixWorld;
    items.push({ name: 'B-29', p: _v.set(0, 0.5, -1).applyMatrix4(pv).clone(), d: g.player.pos.length() });
    if (g.h8 && !g.h8.docked && g.h8.mode !== 'lost' && g.h8.root) items.push({ name: 'H8', p: g.h8.root.getWorldPosition(new THREE.Vector3()), d: g.h8.root.getWorldPosition(new THREE.Vector3()).distanceTo(g.engine.camera.position) });
    cam.updateMatrixWorld();
    _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    x.font = `600 ${Math.round(12 * f / 900)}px -apple-system, "Hiragino Sans", sans-serif`;
    for (const it of items) {
      if (it.d < 6) continue;
      const q = it.p.clone().applyMatrix4(_m);
      const inFront = it.p.clone().sub(cam.position).dot(_v.set(0, 0, -1).applyQuaternion(cam.quaternion)) > 0;
      let sx = (q.x * 0.5 + 0.5) * W, sy = (-q.y * 0.5 + 0.5) * H;
      const on = inFront && sx > 0 && sx < W && sy > 0 && sy < H;
      if (!on) {
        // off the view: an arrow at the edge toward it
        let dx = q.x, dy = -q.y;
        if (!inFront) { dx = -dx; dy = -dy; }
        const a = Math.atan2(dy, dx);
        sx = W / 2 + Math.cos(a) * W * 0.42; sy = H / 2 + Math.sin(a) * H * 0.38;
        x.save(); x.translate(sx, sy); x.rotate(a);
        x.fillStyle = col(0.8); x.beginPath(); x.moveTo(12, 0); x.lineTo(-6, -7); x.lineTo(-6, 7); x.closePath(); x.fill();
        x.restore();
      } else {
        const r = 14 * f / 900;
        x.strokeStyle = col(0.85); x.lineWidth = 1.5;
        for (const [ax, ay] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { x.beginPath(); x.moveTo(sx + ax * r, sy + ay * r * 0.4); x.lineTo(sx + ax * r, sy + ay * r); x.lineTo(sx + ax * r * 0.4, sy + ay * r); x.stroke(); }
      }
      x.fillStyle = col(0.9); x.textAlign = 'center';
      x.fillText(`${it.name}  ${fmtD(it.d)}`, sx, sy + 26 * f / 900);
    }
  }

  /** the suit as a little figure, each part coloured by its state; the systems that are out */
  figure(x, S, X, Y, f, col, red) {
    const sc = f / 900;
    const c = (k) => { const hp = S.parts[k].hp; return hp > 0.75 ? col(0.75) : hp > 0.35 ? 'rgba(255,200,80,0.9)' : red(0.95); };
    x.save(); x.translate(X, Y); x.scale(sc, sc);
    x.lineWidth = 3;
    x.strokeStyle = c('helmet'); x.beginPath(); x.arc(30, 0, 12, 0, Math.PI * 2); x.stroke();
    x.fillStyle = c('visor'); x.fillRect(22, -4, 16, 7);
    x.strokeStyle = c('torso'); x.strokeRect(18, 15, 24, 34);
    x.strokeStyle = c('pack'); x.strokeRect(44, 15, 9, 28);
    x.strokeStyle = c('arms'); x.beginPath(); x.moveTo(18, 18); x.lineTo(8, 46); x.moveTo(42, 18); x.lineTo(52, 46); x.stroke();
    x.strokeStyle = c('legs'); x.beginPath(); x.moveTo(24, 50); x.lineTo(22, 88); x.moveTo(36, 50); x.lineTo(38, 88); x.stroke();
    x.font = '600 12px -apple-system, "Hiragino Sans", sans-serif'; x.textAlign = 'left';
    let y = 104;
    for (const [k, v] of Object.entries(S.sys)) if (v < 0.5) { x.fillStyle = v < 0.15 ? red(0.95) : 'rgba(255,200,80,0.9)'; x.fillText(`${SYSTEMS_JP[k] || k} ${v < 0.15 ? '故障' : '低下'}`, 0, y); y += 16; }
    if (S.injury > 0.15) { x.fillStyle = red(0.9); x.fillText(`負傷 ${Math.round(S.injury * 100)}%`, 0, y); }
    x.restore();
  }

  viewfinder(x, W, H, f, col, font) {
    const s = this.s, cam = s.cam;
    const m = Math.min(W, H) * 0.08;
    x.strokeStyle = col(0.85); x.lineWidth = 2;
    for (const [ax, ay] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const X = ax ? W - m : m, Y = ay ? H - m * 1.6 : m;
      x.beginPath(); x.moveTo(X, Y + (ay ? -1 : 1) * m * 0.5); x.lineTo(X, Y); x.lineTo(X + (ax ? -1 : 1) * m * 0.5, Y); x.stroke();
    }
    x.beginPath(); x.moveTo(W / 2 - 14, H / 2); x.lineTo(W / 2 + 14, H / 2); x.moveTo(W / 2, H / 2 - 14); x.lineTo(W / 2, H / 2 + 14); x.stroke();
    x.font = font(17, 700); x.fillStyle = col(0.95); x.textAlign = 'left';
    x.fillText(`${Math.round(cam.f)} mm${cam.d > 1.01 ? `  デジタル ×${cam.d.toFixed(1)}` : ''}`, m * 1.2, m * 1.25);
    x.font = font(12); x.fillStyle = col(0.7);
    x.fillText(`光学 ${FOCAL[0]}–${FOCAL[1]} mm ・ デジタル ×${DIGITAL_MAX}   画角 ${cam.hfov().toFixed(1)}°`, m * 1.2, m * 1.25 + 22 * f / 900);
    const knob = this.el.querySelector('.vz-knob');
    if (knob) knob.style.bottom = `${cam.fraction() * 100}%`;
    if (cam.flash > 0) { x.fillStyle = `rgba(255,255,255,${cam.flash * 0.6})`; x.fillRect(0, 0, W, H); }
  }

  /** the visor's own cracks and scratches, seen from inside */
  cracks(x, S, W, H) {
    const v = S.parts.visor;
    if (!v.marks.length) return;
    x.save();
    for (const mk of v.marks) {
      const X = W * (0.2 + 0.6 * mk.u), Y = H * (0.15 + 0.7 * mk.v);
      let s = (mk.u * 9301 + mk.v * 49297) % 1;
      const rnd = () => { s = (s * 9301 + 49297) % 233280 / 233280; return s; };
      if (mk.kind === 'crack') {
        x.strokeStyle = 'rgba(235,245,255,0.75)'; x.lineWidth = 1.4;
        const n = 5 + Math.floor(rnd() * 4);
        for (let i = 0; i < n; i++) {
          let a = (i / n) * Math.PI * 2 + rnd() * 0.5, px = X, py = Y;
          x.beginPath(); x.moveTo(px, py);
          const L = Math.min(W, H) * (0.08 + 0.25 * mk.l) * (0.5 + rnd());
          for (let k = 0; k < 7; k++) { a += (rnd() - 0.5) * 0.6; px += Math.cos(a) * L / 7; py += Math.sin(a) * L / 7; x.lineTo(px, py); }
          x.stroke();
        }
        x.fillStyle = 'rgba(235,245,255,0.35)'; x.beginPath(); x.arc(X, Y, 4 + 10 * mk.l, 0, Math.PI * 2); x.fill();
      } else {
        x.strokeStyle = 'rgba(220,230,240,0.18)'; x.lineWidth = 1;
        const L = Math.min(W, H) * 0.12 * mk.l;
        x.beginPath(); x.moveTo(X - Math.cos(mk.a) * L, Y - Math.sin(mk.a) * L); x.lineTo(X + Math.cos(mk.a) * L, Y + Math.sin(mk.a) * L); x.stroke();
      }
    }
    if (v.hp <= 0) { x.fillStyle = 'rgba(200,220,240,0.12)'; x.fillRect(0, 0, W, H); }
    x.restore();
  }
}
