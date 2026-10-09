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
  heat: '高温警告 — エンジン噴射の中', burn: '外層が焼けている',
  assist_on: 'アシスト ON — 離すと止まる', assist_off: 'アシスト OFF — 慣性で流れる',
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
        <button data-k="call" class="red">救助要請</button><button data-k="boost">ブースター</button><button data-k="hold">アシスト</button>
      </div>
      <button class="vz-hatch">ハッチに入る</button>
      <button class="vz-board">乗り込む</button>
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
    el.querySelector('.vz-board').addEventListener('click', () => this.s.rescuer.board());
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
    // (the same warning again while it is still up: kept fresh, not repeated)
    const same = this.events.find((e) => e.txt === txt);
    if (same) { same.t = Math.min(same.t, 0.5); return; }
    this.events.push({ txt, t: 0, red: ['breach', 'battery_dead', 'shutdown', 'radio_dead', 'crack', 'heat', 'burn'].includes(kind) });
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
    else if (k === 'hold') { s.hold = !s.hold; this.event(s.hold ? 'assist_on' : 'assist_off'); }
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
    // the inside of the helmet round the glass (and the dark of the suit's body on the way in or
    // out through its back)
    const ins = s.seq ? s.seqInside() : { frame: pl.suit ? 1 : 0, dark: 0 };
    this.frameK = ins.frame; this.darkK = ins.dark;
    this.frameTop = s.seq ? s.seq.kind === 'h8' : !!pl.suitH8;
    // boot / shutdown
    if (this.bootT > 0) { this.bootT += dt; this.on = Math.min(1, this.bootT / 2.2); if (this.bootT > 2.2) this.bootT = 0; }
    else if (this.bootT < 0) { this.on = Math.max(0, this.on - dt * 2); if (this.on <= 0) this.bootT = 0; }
    else if (pl.suit && !s.seq && this.on < 1) this.on = Math.min(1, this.on + dt * 2);
    if (!pl.suit && !s.seq) this.on = 0;
    // the suit's own caution tone in the helmet: oxygen low (on the reserve: faster), battery low
    if (pl.suit && S && this.on > 0.5 && pl.state !== 'dead') {
      const o2low = pl.suitO2 < 0.15, batLow = S.battery < 0.1 && !(S.spares || []).some((x) => x > 0.02);
      this.cwT = (this.cwT || 0) - dt;
      if ((o2low || batLow) && this.cwT <= 0) {
        this.cwT = S.o2 <= 0 ? 1.6 : 3.5;
        g.audio.beep(1250, 0.12, 0.05, { direct: true, type: 'square' });
        g.audio.beep(950, 0.16, 0.05, { direct: true, type: 'square', when: 0.16 });
      }
    }
    const show = (wearing && this.on > 0.01 || this.frameK > 0.01 || this.darkK > 0.01) && g.mode !== 'camera' && pl.state !== 'dead';
    this.el.classList.toggle('on', show);
    this.el.classList.toggle('busy', !!s.seq);
    this.el.classList.toggle('hatch', !!s.hatchNear);
    // the rescuer is here: the computer can take him in
    const R = s.rescue, canBoard = !!(R && R.canBoard && R.phase === 'here');
    this.el.classList.toggle('board', canBoard);
    if (canBoard) { const b = this.boardBtn || (this.boardBtn = this.el.querySelector('.vz-board')); const t = `${R.canBoard} に乗り込む`; if (b.textContent !== t) b.textContent = t; }
    // (the switches lit while they are on)
    if (!this.btns) this.btns = Object.fromEntries([...this.el.querySelectorAll('.vz-bar button')].map((b) => [b.dataset.k, b]));
    const on = { lamp: s.lamp, visor: s.sunVisor > 0.5, boost: s.boost, hold: s.hold, cam: this.camMode };
    for (const [k, v] of Object.entries(on)) if (this.btns[k]) this.btns[k].classList.toggle('act', !!v);
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
    // (the sequence's dark and frame move with the eye: every frame then; the readouts 20 a second)
    if ((this._acc = (this._acc || 0) + dt) < (s.seq ? 0 : 1 / 20)) return;
    this._acc = 0;
    this.draw();
  }

  /**
   * The inside of the helmet seen round the visor: the shell and its padding close to the eye (out
   * of focus, dark, faintly lit by the display), the brow over the glass, the neck ring under it,
   * a faint reflection of the light on the inside of the glass. Drawn once per size into its own
   * canvas.
   */
  helmetFrame(x, W, H, top) {
    const key = W + 'x' + H + (top ? 't' : 'c');
    if (this._frameKey !== key) {
      this._frameKey = key;
      const c = this._frame || (this._frame = document.createElement('canvas'));
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      const cx = W / 2, cy = H * 0.46;
      const A = W * (top ? 0.66 : 0.6), B = H * (top ? 0.78 : 0.72);
      // the shell's inside, all over
      const sh = g.createLinearGradient(0, 0, 0, H);
      sh.addColorStop(0, '#0d0f12'); sh.addColorStop(0.45, '#08090b'); sh.addColorStop(1, '#030304');
      g.fillStyle = sh; g.fillRect(0, 0, W, H);
      // the padding's quilting, barely lit
      g.strokeStyle = 'rgba(70,78,90,0.10)'; g.lineWidth = Math.max(1, W / 500);
      for (let i = -8; i < 30; i++) { g.beginPath(); g.moveTo(i * W / 18, 0); g.lineTo(i * W / 18 - H * 0.5, H); g.stroke(); g.beginPath(); g.moveTo(i * W / 18 - H * 0.5, 0); g.lineTo(i * W / 18, H); g.stroke(); }
      // the glass: cut out with a soft edge (the rim is a few centimetres from the eye: blurred)
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.translate(cx, cy); g.scale(A, B);
      const cut = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      cut.addColorStop(0, 'rgba(0,0,0,1)'); cut.addColorStop(0.84, 'rgba(0,0,0,1)'); cut.addColorStop(0.93, 'rgba(0,0,0,0.6)'); cut.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = cut; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill();
      g.restore();
      // the rim of the visor's frame, catching a little light all round
      g.save();
      g.translate(cx, cy); g.scale(A, B);
      const rim = g.createRadialGradient(0, 0, 0.9, 0, 0, 1.04);
      rim.addColorStop(0, 'rgba(120,130,145,0)'); rim.addColorStop(0.55, 'rgba(120,130,145,0.16)'); rim.addColorStop(1, 'rgba(120,130,145,0)');
      g.fillStyle = rim; g.beginPath(); g.arc(0, 0, 1.04, 0, Math.PI * 2); g.fill();
      g.restore();
      // the neck ring under the glass: a dark curve with a thin bright edge
      g.save();
      g.beginPath(); g.ellipse(cx, H * 1.16, W * 0.62, H * 0.3, 0, Math.PI, 0); g.closePath();
      const nr = g.createLinearGradient(0, H * 0.86, 0, H);
      nr.addColorStop(0, 'rgba(10,11,13,0.0)'); nr.addColorStop(0.25, 'rgba(10,11,13,0.85)'); nr.addColorStop(1, 'rgba(4,4,5,1)');
      g.fillStyle = nr; g.fill();
      g.strokeStyle = 'rgba(160,170,185,0.14)'; g.lineWidth = Math.max(1.5, H / 260);
      g.beginPath(); g.ellipse(cx, H * 1.16, W * 0.62, H * 0.3, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
      g.restore();
      // the inside of the glass: faint streaks of reflected light, the glass darker toward its edge
      g.save();
      g.translate(cx, cy); g.scale(A, B);
      const vg = g.createRadialGradient(0, 0, 0.45, 0, 0, 0.92);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.22)');
      g.fillStyle = vg; g.beginPath(); g.arc(0, 0, 0.92, 0, Math.PI * 2); g.fill();
      g.restore();
      for (const [x0, y0, x1, y1, w, a] of [[0.16, 0.12, 0.34, 0.05, 0.05, 0.05], [0.2, 0.2, 0.3, 0.16, 0.02, 0.04], [0.74, 0.08, 0.86, 0.16, 0.03, 0.03]]) {
        const gr = g.createLinearGradient(x0 * W, y0 * H, x1 * W, y1 * H);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(235,242,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.strokeStyle = gr; g.lineWidth = w * H; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x0 * W, y0 * H); g.quadraticCurveTo((x0 + x1) / 2 * W, Math.min(y0, y1) * H - w * H, x1 * W, y1 * H); g.stroke();
      }
    }
    x.drawImage(this._frame, 0, 0);
  }

  draw() {
    const g = this.g, s = this.s, S = s.state, pl = g.player, x = this.ctx;
    const W = this.W, H = this.H;
    x.clearRect(0, 0, W, H);
    x.globalAlpha = 1;
    // the helmet round the glass, and the dark inside the suit while the eye passes through it
    if (this.frameK > 0.01) { x.globalAlpha = Math.min(1, this.frameK); this.helmetFrame(x, W, H, this.frameTop); x.globalAlpha = 1; }
    if (this.darkK > 0.01) { x.fillStyle = `rgba(2,2,3,${Math.min(1, this.darkK)})`; x.fillRect(0, 0, W, H); }
    if (!S || this.on <= 0.01) return;
    const top = S.spec.grade === 'top';
    const C = top ? [255, 178, 80] : [110, 200, 255];
    const col = (a) => `rgba(${C[0]},${C[1]},${C[2]},${a})`;
    const red = (a) => `rgba(255,90,70,${a})`;
    // a dead HUD flickers, a shut-down suit shows only that it is down
    const hudK = S.sys.hud;
    const flick = hudK < 0.6 && Math.random() > hudK + 0.25;
    const base = this.on * (flick ? 0.25 : 1) * (S.shutdown ? 0.85 : 1);
    x.globalAlpha = base;
    // sizes in units of the view (the CSS size, not the canvas's pixels): small, steady type
    const dpr = this.dpr || 1;
    const f = Math.min(W, H * 1.9);
    const u = dpr * Math.min(1.2, Math.max(0.78, Math.min(W / dpr, H / dpr * 1.9) / 900));
    const font = (px, w = 600) => `${w} ${Math.round(px * u)}px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    x.textBaseline = 'middle';
    // (what has been drawn where: the markers' labels keep out of it)
    const boxes = this._boxes = [];
    const T = (str, X, Y, align = 'left', px = 11) => {
      x.textAlign = align;
      x.fillText(str, X, Y);
      const w = x.measureText(str).width;
      const x0 = align === 'left' ? X : align === 'right' ? X - w : X - w / 2;
      boxes.push([x0 - 4, Y - px * u * 0.7, x0 + w + 4, Y + px * u * 0.7]);
    };
    // the light of the display on the glass: a soft glow round its lines
    x.shadowColor = col(0.4); x.shadowBlur = 3 * u;
    if (S.shutdown) {
      x.font = font(16, 700); x.fillStyle = red(0.5 + 0.5 * Math.sin(this.t * 5));
      T('システム停止 — 受動生命維持のみ', W / 2, H * 0.3, 'center', 16);
      this.cracks(x, S, W, H);
      x.shadowBlur = 0; x.globalAlpha = 1;
      return;
    }
    // ---- the boot sequence's lines (in the top left corner)
    if (this.on < 1) {
      x.font = font(10.5, 600); x.fillStyle = col(0.85);
      const L = ['POWER ON', 'LIFE SUPPORT … OK', `O₂ ${Math.round(S.o2 * 100)}% … OK`, 'SUIT 29.6 kPa … OK', 'BOOSTERS … ' + (S.thrustK() > 0 ? 'READY' : 'FAULT'), 'HUD READY'];
      const n = Math.floor(this.on * L.length * 1.2);
      L.slice(0, n).forEach((l, i) => T(l, W * 0.3, H * 0.3 + i * 15 * u, 'left', 10.5));
    }
    // everything in the four corners of the glass (the middle of the view stays clear); the blocks
    // lean a little, as the glass curves away round the face
    const side = (X, Y, lean, fn) => { x.save(); x.translate(X, Y); x.transform(0.97, lean, 0, 1, 0, 0); fn(); x.restore(); };
    const XL = W * 0.075, XR = W * 0.925, YT = H * 0.115, YB = H * 0.8;
    const BW = 104 * u;
    // ---- top left: oxygen
    const o2Left = S.o2Left(pl.state === 'evaWalk' ? 0.4 : 0.15);
    side(XL, YT, 0.03, () => {
      x.textAlign = 'left';
      x.font = font(9.5); x.fillStyle = col(0.7);
      x.fillText('O₂ 酸素', 0, 0);
      this.bar(x, 0, 8 * u, BW, 2.5 * u, S.o2, S.o2 < 0.15 ? red(0.9) : col(0.85), col(0.15));
      x.font = font(17, 700); x.fillStyle = S.o2 < 0.15 ? red(0.95) : col(0.95);
      x.fillText(`${Math.round(S.o2 * 100)}%`, 0, 24 * u);
      const pw = x.measureText(`${Math.round(S.o2 * 100)}%`).width;
      x.font = font(10); x.fillStyle = col(0.8);
      x.fillText(`残り ${hms(o2Left)}`, pw + 6 * u, 25 * u);
      x.font = font(9); x.fillStyle = col(0.62);
      x.fillText(`非常用 ${Math.round(S.reserve * 100)}%`, 0, 39 * u);
      if (S.leakK > 0.01) { x.fillStyle = red(0.95); x.fillText(`漏れ ×${S.leakK.toFixed(0)}`, 0, 51 * u); }
    });
    boxes.push([XL - 6, YT - 10 * u, XL + BW + 40 * u, YT + 58 * u]);
    // ---- top right: power and the boosters
    const Pp = S.spec.propulsion;
    side(XR, YT, -0.03, () => {
      x.textAlign = 'right';
      x.font = font(9.5); x.fillStyle = col(0.7);
      x.fillText('電力', 0, 0);
      this.bar(x, -BW, 8 * u, BW, 2.5 * u, S.battery, S.battery < 0.15 ? red(0.9) : col(0.85), col(0.15));
      x.font = font(17, 700); x.fillStyle = S.battery < 0.15 ? red(0.95) : col(0.95);
      const bt = `${Math.round(S.battery * 100)}%`;
      x.fillText(bt, 0, 24 * u);
      const bw = x.measureText(bt).width;
      x.font = font(10); x.fillStyle = col(0.8);
      x.fillText(`飛行 ${hms(S.flightLeft())}`, -bw - 6 * u, 25 * u);
      x.font = font(9); x.fillStyle = col(0.62);
      const bst = Pp.boosters > 1 ? `L${S.boosterL > 0.5 ? '●' : '×'} R${S.boosterR > 0.5 ? '●' : '×'}` : `${S.boosterL > 0.5 ? '●' : '×'}`;
      x.fillText(`予備 ${S.spares.length ? S.spares.map((b) => Math.round(b * 100) + '%').join(' ') : 'なし'} ・ ブースター ${bst}`, 0, 39 * u);
      if (S.swapT > 0) { x.fillStyle = col(0.5 + 0.5 * Math.sin(this.t * 8)); x.fillText(`予備に交換中 ${S.swapT.toFixed(0)} 秒`, 0, 51 * u); }
    });
    boxes.push([XR - BW - 60 * u, YT - 10 * u, XR + 6, YT + 58 * u]);
    // ---- bottom right: the speed, how it is flown, the call under way, the time
    const ref = this.refVel();
    side(XR, YB, 0.03, () => {
      x.textAlign = 'right';
      x.font = font(17, 700); x.fillStyle = col(0.95);
      x.fillText(`${ref.v < 10 ? ref.v.toFixed(2) : ref.v.toFixed(0)} m/s`, 0, 0);
      x.font = font(9); x.fillStyle = col(0.7);
      x.fillText(`${ref.name}に対して ・ ${s.boost ? 'ブースター' : '微調整'} ・ ${s.hold ? 'アシスト' : '慣性飛行'}`, 0, 14 * u);
      let yy = 27 * u;
      if (s.rescue) { x.fillStyle = col(0.55 + 0.45 * Math.sin(this.t * 4)); x.fillText(this.rescueText(), 0, yy); yy += 12 * u; }
      const d = new Date(g.time);
      x.fillStyle = col(0.45);
      x.fillText(`${S.spec.name} ・ ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`, 0, yy);
    });
    boxes.push([XR - 190 * u, YB - 14 * u, XR + 6, YB + 44 * u]);
    // ---- what just happened: under the top left block, small (red ones stand out by colour)
    this.events.forEach((e, i) => {
      x.font = font(10.5, 700);
      x.fillStyle = e.red ? red(Math.min(1, 2 - e.t / 4)) : col(Math.min(1, 2 - e.t / 4));
      T(e.txt, XL, YT + (72 + i * 15) * u, 'left', 10.5);
    });
    // ---- bottom left: the suit's figure and the systems that are out
    this.figure(x, S, XL, YB - 40 * u, u * 0.62, col, red);
    boxes.push([XL - 6, YB - 46 * u, XL + 120 * u, YB + 50 * u]);
    // ---- markers: B-29, H8 (their labels keep clear of the rest)
    x.shadowBlur = 2 * u;
    this.markers(x, col, f, u);
    x.shadowBlur = 0;
    // ---- the camera's frame
    if (this.camMode) this.viewfinder(x, W, H, f, col, font, u);
    // ---- cracks in the visor
    this.cracks(x, S, W, H);
    x.globalAlpha = 1;
  }

  bar(x, X, Y, w, h, v, c, bg) { x.fillStyle = bg; x.fillRect(X, Y, w, h); x.fillStyle = c; x.fillRect(X, Y, w * Math.max(0, Math.min(1, v)), h); }

  /** the velocity against the ship (B-29, or H8 when out from it alone) */
  refVel() {
    const g = this.g, pl = g.player;
    const h8 = g.h8 && g.h8.solo;
    return { v: this.s.relSpeed ? this.s.relSpeed() : pl.vel.length(), name: h8 ? 'H8' : 'B-29' };
  }

  rescueText() { return this.s.rescuer ? this.s.rescuer.text() : ''; }

  markers(x, col, f, u = f / 900) {
    const g = this.g, cam = g.engine.camera, W = this.W, H = this.H;
    const items = [];
    const pv = g.shipVis.root.matrixWorld;
    items.push({ name: 'B-29', p: _v.set(0, 0.5, -1).applyMatrix4(pv).clone(), d: g.player.pos.length() });
    if (g.h8 && !g.h8.docked && g.h8.mode !== 'lost' && g.h8.root) items.push({ name: 'H8', p: g.h8.root.getWorldPosition(new THREE.Vector3()), d: g.h8.root.getWorldPosition(new THREE.Vector3()).distanceTo(g.engine.camera.position) });
    // the station's rescue craft on its way
    const tm = this.s.rescuer && this.s.rescuer.marker(g.origin);
    if (tm) items.push(tm);
    cam.updateMatrixWorld();
    _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    x.font = `600 ${Math.round(10 * u)}px -apple-system, "Hiragino Sans", sans-serif`;
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
        sx = W / 2 + Math.cos(a) * W * 0.36; sy = H * 0.46 + Math.sin(a) * H * 0.3;
        x.save(); x.translate(sx, sy); x.rotate(a);
        x.fillStyle = col(0.8); x.beginPath(); x.moveTo(12, 0); x.lineTo(-6, -7); x.lineTo(-6, 7); x.closePath(); x.fill();
        x.restore();
      } else {
        const r = 11 * u;
        x.strokeStyle = col(0.85); x.lineWidth = 1.5;
        for (const [ax, ay] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { x.beginPath(); x.moveTo(sx + ax * r, sy + ay * r * 0.4); x.lineTo(sx + ax * r, sy + ay * r); x.lineTo(sx + ax * r * 0.4, sy + ay * r); x.stroke(); }
      }
      // the label under it, moved on down (or up) until it is clear of what is already there
      x.fillStyle = col(0.9); x.textAlign = 'center';
      const label = `${it.name}  ${fmtD(it.d)}`;
      const w = x.measureText(label).width, lh = 14 * u;
      let ly = sy + 21 * u;
      const hit = (yy) => (this._boxes || []).some((b) => sx + w / 2 > b[0] && sx - w / 2 < b[2] && yy + lh / 2 > b[1] && yy - lh / 2 < b[3]);
      for (let k = 0; k < 4 && hit(ly); k++) ly += (sy < H / 2 ? 1 : -1) * lh * 1.2;
      if (hit(ly)) continue;
      x.fillText(label, sx, ly);
      if (this._boxes) this._boxes.push([sx - w / 2 - 4, ly - lh / 2, sx + w / 2 + 4, ly + lh / 2]);
    }
  }

  /** the suit as a little figure, each part coloured by its state; the systems that are out */
  figure(x, S, X, Y, sc, col, red) {
    const c = (k) => { const hp = S.parts[k].hp; return hp > 0.75 ? col(0.75) : hp > 0.35 ? 'rgba(255,200,80,0.9)' : red(0.95); };
    x.save(); x.translate(X, Y); x.scale(sc, sc);
    x.lineWidth = 3;
    x.strokeStyle = c('helmet'); x.beginPath(); x.arc(30, 0, 12, 0, Math.PI * 2); x.stroke();
    x.fillStyle = c('visor'); x.fillRect(22, -4, 16, 7);
    x.strokeStyle = c('torso'); x.strokeRect(18, 15, 24, 34);
    x.strokeStyle = c('pack'); x.strokeRect(44, 15, 9, 28);
    x.strokeStyle = c('arms'); x.beginPath(); x.moveTo(18, 18); x.lineTo(8, 46); x.moveTo(42, 18); x.lineTo(52, 46); x.stroke();
    x.strokeStyle = c('legs'); x.beginPath(); x.moveTo(24, 50); x.lineTo(22, 88); x.moveTo(36, 50); x.lineTo(38, 88); x.stroke();
    x.font = '600 15px -apple-system, "Hiragino Sans", sans-serif'; x.textAlign = 'left';
    // (the systems that are out, beside the figure)
    let y = 8;
    for (const [k, v] of Object.entries(S.sys)) if (v < 0.5) { x.fillStyle = v < 0.15 ? red(0.95) : 'rgba(255,200,80,0.9)'; x.fillText(`${SYSTEMS_JP[k] || k} ${v < 0.15 ? '故障' : '低下'}`, 66, y); y += 19; }
    if (S.injury > 0.15) { x.fillStyle = red(0.9); x.fillText(`負傷 ${Math.round(S.injury * 100)}%`, 66, y); }
    x.restore();
  }

  viewfinder(x, W, H, f, col, font, u = f / 900) {
    const s = this.s, cam = s.cam;
    const m = Math.min(W, H) * 0.08;
    x.strokeStyle = col(0.85); x.lineWidth = 2;
    for (const [ax, ay] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const X = ax ? W - m : m, Y = ay ? H - m * 1.6 : m;
      x.beginPath(); x.moveTo(X, Y + (ay ? -1 : 1) * m * 0.5); x.lineTo(X, Y); x.lineTo(X + (ax ? -1 : 1) * m * 0.5, Y); x.stroke();
    }
    x.beginPath(); x.moveTo(W / 2 - 14, H / 2); x.lineTo(W / 2 + 14, H / 2); x.moveTo(W / 2, H / 2 - 14); x.lineTo(W / 2, H / 2 + 14); x.stroke();
    x.font = font(14, 700); x.fillStyle = col(0.95); x.textAlign = 'left';
    x.fillText(`${Math.round(cam.f)} mm${cam.d > 1.01 ? `  デジタル ×${cam.d.toFixed(1)}` : ''}`, m * 1.2, m * 1.25);
    x.font = font(9.5); x.fillStyle = col(0.65);
    x.fillText(`光学 ${FOCAL[0]}–${FOCAL[1]} mm ・ デジタル ×${DIGITAL_MAX} ・ 画角 ${cam.hfov().toFixed(1)}°`, m * 1.2, m * 1.25 + 17 * u);
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
