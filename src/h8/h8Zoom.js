// H8's zoom: the outside cameras' superzoom, its picture shown on the all-round display — the
// cockpit round it, the display's own glass and the tabs on it are not magnified (the eye is not
// zooming: the cameras are). Optical up to x100 (the lens drive takes a couple of seconds end to
// end; the picture stays sharp), then a digital zoom up to another x10 (x1000 in all: a crop of
// fewer and fewer sensor pixels, rebuilt by the cameras' image processor — clean edges instead of
// blocks, softer the further in). The cameras sit on a stabilised gimbal that follows the head
// smoothly, the slower the further in they are zoomed. It is worked like a camera: pinch or the
// zoom buttons, the zoom ring at the bottom of the view (drag it like a lens ring), the shutter
// (photos), and auto-follow — which keeps the chosen target (any tracked thing; the focus unless
// Kaito picks another in the camera tab) in the middle of the view and sizes it to fill a good
// part of it, turning Kaito's head (and the seat with it) to stay on it. A drag to look elsewhere
// hands the view back to him.
import * as THREE from 'three';
import { spring1 } from '../core/spring.js';

export const OPT_MAX = 100;
export const DIG_MAX = 10;
export const Z_MAX = OPT_MAX * DIG_MAX;
const WIDE_MM = 24;            // the wide end, as a 35 mm camera's focal length
const NOTCH = [1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 30, 50, 70, 100, 150, 250, 400, 650, 1000];
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4();
const _Y = new THREE.Vector3(0, 1, 0), _O = new THREE.Vector3();
const MONO = '"SF Mono","Menlo","Consolas",monospace';
const FONT = '"Hiragino Sans","Noto Sans JP",sans-serif';

function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

export class H8Zoom {
  constructor(vessel) {
    this.v = vessel;
    this.OPT = OPT_MAX; this.DIG = DIG_MAX;
    this.z = 1;          // current magnification
    this.zT = 1;         // where it is going
    this.follow = false;
    this.target = null;
    this.lz = { x: 0, v: 0 };   // log magnification on its spring
    this.aimS = null;            // the follow's tracking state
    this.hud = document.getElementById('hud-zoom');
    this.ctx = this.hud ? this.hud.getContext('2d') : null;
    this.hudOn = false;
    this.flash = 0;              // the shutter's blink
    this.bindRing();
  }

  get optical() { return Math.min(OPT_MAX, this.z); }
  get digital() { return this.z / this.optical; }

  /** the focal length a 35 mm camera would need for this view (mm) */
  focal() { return WIDE_MM * this.z; }

  /** the lens's aperture: wide open at the wide end, slower toward the long end */
  fNumber() { return 2.8 + (6.3 - 2.8) * Math.min(1, Math.log(this.optical) / Math.log(OPT_MAX)); }

  /** one notch in or out (buttons) */
  step(dir) {
    const cur = this.zT;
    let next = cur;
    if (dir > 0) next = NOTCH.find((n) => n > cur * 1.02) || Z_MAX;
    else next = [...NOTCH].reverse().find((n) => n < cur / 1.02) || 1;
    this.zT = next;
    this.beep(dir > 0 ? 1600 : 1200);
  }

  /** pinch: f > 1 zooms out (fingers together), < 1 in */
  pinch(f) {
    if (Math.abs(f - 1) < 1e-4) return;
    this.zT = Math.max(1, Math.min(Z_MAX, this.zT / f));
  }

  /** a point along the zoom bar (0 wide .. 1 the far end of the digital zoom) */
  setFraction(f) {
    this.zT = Math.max(1, Math.min(Z_MAX, Math.exp(Math.max(0, Math.min(1, f)) * Math.log(Z_MAX))));
    this.beep(1400);
  }

  reset() { this.zT = 1; this.follow = false; this.target = null; this.aimS = null; this.beep(900); }

  /** follow on / off: on, the focus (or else the nearest lock) */
  toggleFollow() {
    const v = this.v;
    if (this.follow) { this.follow = false; this.target = null; this.aimS = null; this.beep(1000); return; }
    const T = this.pickTarget();
    if (!T) { v.say('hachi_follow_none', {}, { minGap: 4, force: false }); return; }
    this.followTarget(T);
  }

  /** follow a particular thing (any of what the display tracks) */
  followTarget(c) {
    if (!c) return;
    this.follow = true;
    this.target = c;
    this.aimS = null;
    this.beep(1800);
  }

  beep(f) { const A = this.v.g.audio; if (A.beep) A.beep(f, 0.035, 0.04, { direct: true }); }

  /** what to follow: the focus, else the nearest locked threat, else the nearest lock */
  pickTarget() {
    const H = this.v.hud;
    if (!H) return null;
    const P = H.primary();
    if (P) return P.c;
    const locks = H.locks.map((l) => l.c);
    return locks.filter((c) => c.threat).sort((a, b) => a.dist - b.dist)[0] || locks.sort((a, b) => a.dist - b.dist)[0] || null;
  }

  /**
   * per frame while Kaito sits in H8: input (pinch, look drags), the player (his look is turned when
   * following). Returns the magnification.
   */
  update(dt, input, pl, active) {
    const v = this.v;
    if (!active) { this.zT = 1; this.follow = false; this.target = null; }
    else if (input) {
      if (input.pinch && input.pinch !== 1) this.pinch(input.pinch);
      const P = input.pressed || {};
      if (P['b-zin']) this.step(1);
      if (P['b-zout']) this.step(-1);
      if (P['b-zfol']) this.toggleFollow();
      if (P['b-zshot'] && v.g.photos) v.g.photos.shoot();
      // looking elsewhere by hand ends the follow
      if (this.follow && Math.abs(input.lookDX) + Math.abs(input.lookDY) > 6) { this.follow = false; this.target = null; this.beep(1000); }
    }
    if (this.ringDZ) { this.zT = Math.max(1, Math.min(Z_MAX, this.zT * Math.exp(this.ringDZ))); this.ringDZ = 0; }
    // follow: the target (re-picked if it is gone) and the framing; the head is turned in aim()
    if (this.follow) {
      const live = this.target && (v.cands || []).find((c) => c.id === this.target.id);
      if (!live || (live.ref && live.ref.alive === false)) {
        const next = this.pickTarget();
        if (!next || !this.target || next.id !== this.target.id) this.aimS = null;
        this.target = next;
        if (!next) { this.follow = false; v.say('hachi_follow_lost', {}, { minGap: 4, force: false }); }
      } else this.target = live;
      const T = this.target;
      if (T && pl && pl.state === 'seated') {
        // sized to fill about a seventh of the view's height (the whole of it: its hull's size)
        const R = v.hud ? v.hud.radiusOf(T) : (T.R || 5);
        const ang = 2 * Math.atan(R / Math.max(1, T.dist));
        const fov = v.g.engine.baseVFov ? v.g.engine.baseVFov() * Math.PI / 180 : 1.0;
        this.zT = Math.max(1.5, Math.min(Z_MAX, fov * 0.16 / Math.max(1e-7, ang)));
      }
    }
    // the magnification on a spring in log space: the optical part is driven by the lens motor
    // (end to end in about 2.5 s), the digital part is quicker
    const L = this.lz, lt = Math.log(this.zT);
    if (!Number.isFinite(L.x) || Math.abs(Math.exp(L.x) - this.z) > 1e-6 * this.z) L.x = Math.log(this.z);
    const x0 = L.x, h = Math.min(dt, 0.05);
    spring1(L, lt, 7, h);
    const vmax = (this.z >= OPT_MAX - 1e-3 && this.zT >= OPT_MAX) ? 9 : 1.75;
    if (Math.abs(L.x - x0) > vmax * h) { L.x = x0 + Math.sign(L.x - x0) * vmax * h; L.v = Math.sign(L.v) * Math.min(Math.abs(L.v), vmax); }
    if (Math.abs(L.x - lt) < 4e-4 && Math.abs(L.v) < 1e-3) { L.x = lt; L.v = 0; }
    const was = this.z;
    this.z = Math.exp(L.x);
    // the lens motor's whine while it drives
    const A = v.g.audio;
    if (A.ready && Math.abs(this.z - was) / was > 1e-3 && this.z < OPT_MAX + 0.01) {
      this.whirT = (this.whirT || 0) - dt;
      if (this.whirT <= 0) { this.whirT = 0.09; A.beep && A.beep(this.z > was ? 2900 : 2500, 0.07, 0.008, { direct: true, type: 'square' }); }
    }
    this.flash = Math.max(0, this.flash - dt * 6);
    return this.z;
  }

  /**
   * Auto-follow, per drawn frame just before the view is set: the target's direction is worked out
   * right now (from the eye, with the parallax). The head's offset from it rides a critically
   * damped spring down to zero — so it swings on smoothly and then sits exactly on the target,
   * however the target moves; once there it is pinned, frame after frame.
   */
  aim(dt, pl) {
    const T = this.follow && this.target;
    if (!T || !pl || pl.state !== 'seated' || !T.pos) { this.aimS = null; return false; }
    const v = this.v, f = v.flight, s = pl.seat;
    // the target (the guns' aim point on it when it is the focus) from the eye, in H8's frame
    const P = v.hud && v.hud.primaryId === T.id ? v.hud.aimPoint(v.hud.primary(), _v2) : _v2.copy(T.pos);
    _v.copy(P).sub(f.pos).applyQuaternion(_q.copy(f.quat).invert());
    _v2.copy(pl.eyeLocal).sub(s.dock || _O);
    _v.sub(_v2).normalize();
    // into the seat's look angles
    _q.setFromRotationMatrix(_m.lookAt(_O, s.fwd, _Y)).invert();
    _v.applyQuaternion(_q);
    const yawT = Math.atan2(-_v.x, -_v.z), pitchT = Math.max(-1.5, Math.min(1.5, Math.asin(Math.max(-1, Math.min(1, _v.y)))));
    const h = Math.max(1e-4, Math.min(dt, 0.05));
    let S = this.aimS;
    if (!S || S.id !== T.id) S = this.aimS = { id: T.id, ry: { x: wrap(pl.yaw - yawT), v: 0 }, rp: { x: pl.pitch - pitchT, v: 0 }, locked: false };
    if (!S.locked) {
      spring1(S.ry, 0, 10, h);
      spring1(S.rp, 0, 10, h);
      if (Math.hypot(S.ry.x, S.rp.x) < 2e-5 && Math.hypot(S.ry.v, S.rp.v) < 2e-4) S.locked = true;
    }
    if (S.locked) { S.ry.x = S.ry.v = S.rp.x = S.rp.v = 0; }
    // (the yaw kept next to the head's own, so the seat does not spin round at +-180 degrees)
    pl.yaw = pl.yaw + wrap(yawT + S.ry.x - pl.yaw);
    pl.pitch = pitchT + S.rp.x;
    return true;
  }

  // ------------------------------------------------------------------ the zoom ring
  /** the strip at the bottom of the view: drag it sideways like a lens's zoom ring */
  bindRing() {
    const el = this.ring = document.getElementById('zoom-ring');
    if (!el) return;
    this.ringDZ = 0;
    let id = null, x = 0;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); id = e.pointerId; x = e.clientX; el.setPointerCapture && el.setPointerCapture(id); el.classList.add('on'); });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      e.preventDefault();
      const dx = e.clientX - x;
      x = e.clientX;
      // a full sweep of the ring (its width) takes the zoom end to end
      this.ringDZ += dx / Math.max(200, el.clientWidth) * Math.log(Z_MAX);
      this.ringPos = (this.ringPos || 0) + dx;
    });
    const up = (e) => { if (e.pointerId !== id) return; id = null; el.classList.remove('on'); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // ------------------------------------------------------------------ the viewfinder
  /** the camera's overlay on the screen while zoomed: frame, read-outs, the zoom bar */
  drawHud(show) {
    const cv = this.hud, ctx = this.ctx;
    const ring = this.ring;
    const on = show && (this.z > 1.03 || this.flash > 0);
    if (ring) { const r = !!show; if (this._ringShown !== r) { this._ringShown = r; ring.classList.toggle('hidden', !r); } }
    if (!cv || !ctx) return;
    if (!on) { if (this.hudOn) { ctx.clearRect(0, 0, cv.width, cv.height); cv.style.display = 'none'; this.hudOn = false; } return; }
    if (!this.hudOn) { cv.style.display = 'block'; this.hudOn = true; }
    const W = cv.clientWidth, H = cv.clientHeight, pr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * pr) || cv.height !== Math.round(H * pr)) { cv.width = Math.round(W * pr); cv.height = Math.round(H * pr); }
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const v = this.v, g = v.g;
    const dig = this.digital > 1.01;
    // (round the tabs: they lie on the glass over the picture)
    ctx.save();
    if (v.hud && v.hud.outl) v.hud.constructor.clipOut(ctx, v.hud.outl, W, H);
    const col = dig ? 'rgba(255,196,110,0.9)' : 'rgba(225,240,255,0.88)';
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.2;
    // the frame's corners and a faint thirds grid
    const m = Math.min(W, H) * 0.05;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = sx < 0 ? m : W - m, y = sy < 0 ? m : H - m;
      ctx.beginPath(); ctx.moveTo(x, y + sy * -22); ctx.lineTo(x, y); ctx.lineTo(x + sx * -22, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(225,240,255,0.12)';
    ctx.beginPath();
    for (const k of [1 / 3, 2 / 3]) { ctx.moveTo(W * k, m); ctx.lineTo(W * k, H - m); ctx.moveTo(m, H * k); ctx.lineTo(W - m, H * k); }
    ctx.stroke();
    // the level: the horizon's tilt in the view
    const up = g.flight.pos.clone().normalize();
    const vq = g.viewQuat || g.camQuat;
    const camUp = _v.set(0, 1, 0).applyQuaternion(vq), camR = _v2.set(1, 0, 0).applyQuaternion(vq);
    const roll = Math.atan2(up.dot(camR), up.dot(camUp));
    const lx = W / 2, ly = m + 26;
    ctx.strokeStyle = Math.abs(roll) < 0.02 ? 'rgba(120,255,170,0.9)' : 'rgba(225,240,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(lx - 34, ly); ctx.lineTo(lx - 14, ly); ctx.moveTo(lx + 14, ly); ctx.lineTo(lx + 34, ly); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx - Math.cos(roll) * 26, ly + Math.sin(roll) * 26); ctx.lineTo(lx + Math.cos(roll) * 26, ly - Math.sin(roll) * 26); ctx.stroke();
    // read-outs, top left: magnification, focal length, optical / digital
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillStyle = col;
    ctx.font = `700 22px ${MONO}`;
    const zs = `×${this.z < 10 ? this.z.toFixed(1) : this.z < 100 ? this.z.toFixed(1) : this.z.toFixed(0)}`;
    ctx.fillText(zs, m + 8, m + 30);
    const zw = ctx.measureText(zs).width;
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = dig ? 'rgba(255,196,110,0.95)' : 'rgba(130,232,255,0.95)';
    ctx.fillText(dig ? 'AIデジタル' : '光学', m + 14 + zw, m + 18);
    ctx.fillStyle = col;
    ctx.font = `500 11px ${MONO}`;
    ctx.fillText(`${Math.round(this.focal()).toLocaleString()} mm`, m + 14 + zw, m + 31);
    ctx.font = `500 11px ${MONO}`;
    ctx.fillText(`光学 ×${this.optical.toFixed(1)}${dig ? `  デジタル ×${this.digital.toFixed(1)}` : ''}`, m + 8, m + 48);
    // exposure, bottom left (sunlit space is "sunny 16"; the night side, earthshine)
    const sc = g.space && g.space.sunColor;
    const lit = sc ? Math.min(1, (sc.r + sc.g + sc.b) / 3) : 1;
    const ev = 8 + 7 * lit;
    const N = this.fNumber();
    const t = (N * N) / Math.pow(2, ev - 2);
    const sh = t >= 1 ? `${t.toFixed(1)}"` : `1/${Math.round(1 / Math.max(1e-5, t))}`;
    ctx.fillText(`${sh}   F${N.toFixed(1)}   ISO ${dig ? 800 : 200}   IS ON`, m + 8, H - m - 34);
    // top right: follow, the target, the photos taken
    ctx.textAlign = 'right';
    const P = g.photos;
    ctx.fillText(`撮影 ${P ? P.count : 0} 枚`, W - m - 8, m + 18);
    const H8h = v.hud, F = H8h && H8h.primary();
    if (this.follow && this.target) {
      ctx.fillStyle = 'rgba(120,255,170,0.95)';
      ctx.fillText(`● 自動追従  ${this.target.short || this.target.name}`, W - m - 8, m + 34);
    }
    if (F) {
      ctx.fillStyle = 'rgba(130,232,255,0.95)';
      ctx.fillText(`AF ● ${F.c.short || F.c.name}  ${F.c.dist < 9500 ? Math.round(F.c.dist) + ' m' : (F.c.dist / 1000).toFixed(1) + ' km'}`, W - m - 8, m + 50);
    } else { ctx.fillStyle = 'rgba(225,240,255,0.55)'; ctx.fillText('AF ○  ∞', W - m - 8, m + 50); }
    // the zoom bar along the bottom: W — optical (white) | digital (amber) — T
    const bx0 = W * 0.26, bx1 = W * 0.74, by = H - m - 8;
    const ox = bx0 + (bx1 - bx0) * Math.log(OPT_MAX) / Math.log(Z_MAX);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(225,240,255,0.55)'; ctx.beginPath(); ctx.moveTo(bx0, by); ctx.lineTo(ox - 2, by); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,196,110,0.55)'; ctx.beginPath(); ctx.moveTo(ox + 2, by); ctx.lineTo(bx1, by); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.font = `600 10px ${MONO}`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(225,240,255,0.7)';
    for (const [zz, lab] of [[1, 'W'], [10, '10'], [OPT_MAX, '100'], [Z_MAX, 'T']]) {
      const x = bx0 + (bx1 - bx0) * Math.log(zz) / Math.log(Z_MAX);
      ctx.beginPath(); ctx.moveTo(x, by - 6); ctx.lineTo(x, by + 6); ctx.strokeStyle = 'rgba(225,240,255,0.6)'; ctx.stroke();
      ctx.fillText(lab, x, by - 10);
    }
    const kx = bx0 + (bx1 - bx0) * Math.log(this.z) / Math.log(Z_MAX);
    ctx.fillStyle = dig ? 'rgba(255,196,110,1)' : 'rgba(255,255,255,1)';
    ctx.beginPath(); ctx.moveTo(kx, by - 3); ctx.lineTo(kx - 6, by - 12); ctx.lineTo(kx + 6, by - 12); ctx.closePath(); ctx.fill();
    // the middle
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W / 2 - 9, H / 2); ctx.lineTo(W / 2 + 9, H / 2); ctx.moveTo(W / 2, H / 2 - 9); ctx.lineTo(W / 2, H / 2 + 9); ctx.stroke();
    ctx.restore();
    // the shutter: the frame goes dark for a blink
    if (this.flash > 0) {
      const k = this.flash;
      ctx.fillStyle = `rgba(0,0,0,${0.85 * Math.sin(Math.min(1, k) * Math.PI)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
}
