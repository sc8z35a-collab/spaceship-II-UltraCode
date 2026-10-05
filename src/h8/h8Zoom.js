// H8's zoom: any part of the all-round view can be magnified — the cameras' optical zoom up to
// x10.5 (the lenses drive smoothly; the picture stays sharp), then a digital zoom up to another x4
// (x42 in all: the picture coarsens into blocks and grain, a little oversharpened). Auto-follow
// keeps the locked enemy in the middle of the view and sizes it to fill a good part of it, turning
// Kaito's head (and the seat with it) to stay on it. Pinch in the view or use the buttons; a drag
// to look elsewhere hands the view back to him.
import * as THREE from 'three';
import { spring1 } from '../core/spring.js';

export const OPT_MAX = 10.5;
export const DIG_MAX = 4;
export const Z_MAX = OPT_MAX * DIG_MAX;
const NOTCH = [1, 1.5, 2.2, 3.3, 5, 7.5, 10.5, 15, 21, 30, 42];
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4();
const _Y = new THREE.Vector3(0, 1, 0), _O = new THREE.Vector3();

function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

export class H8Zoom {
  constructor(vessel) {
    this.v = vessel;
    this.z = 1;          // current magnification
    this.zT = 1;         // where it is going
    this.follow = false;
    this.target = null;
    this.lz = { x: 0, v: 0 };   // log magnification on its spring
    this.aimS = null;            // the follow's tracking state
    this.hud = document.getElementById('hud-zoom');
    this.ctx = this.hud ? this.hud.getContext('2d') : null;
    this.hudOn = false;
  }

  get optical() { return Math.min(OPT_MAX, this.z); }
  get digital() { return this.z / this.optical; }

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

  reset() { this.zT = 1; this.follow = false; this.target = null; this.aimS = null; this.beep(900); }

  toggleFollow() {
    this.follow = !this.follow;
    const v = this.v;
    if (this.follow) {
      const T = this.pickTarget();
      if (!T) { this.follow = false; v.say('hachi_follow_none', {}, { minGap: 4, force: false }); return; }
      this.target = T;
      this.aimS = null;
      v.say('hachi_follow_on', { name: T.short || T.name }, { minGap: 3, force: true });
    } else { this.target = null; this.aimS = null; v.say('hachi_follow_off', {}, { minGap: 3, force: false }); }
    this.beep(this.follow ? 1800 : 1000);
  }

  beep(f) { const A = this.v.g.audio; if (A.beep) A.beep(f, 0.035, 0.04, { direct: true }); }

  /** the enemy to follow: the guns' target if it is a hostile drone, else the nearest locked threat,
   *  else anything locked */
  pickTarget() {
    const v = this.v, g = v.g, D = v.display;
    const W = g.weapons;
    const prim = W && W.lastTarget;
    if (prim && prim.kind === 'drone') { const c = v.cands.find((x) => x.ref === prim.ref); if (c) return c; }
    const locks = D.locks.map((l) => l.c);
    const thr = locks.filter((c) => c.threat).sort((a, b) => a.dist - b.dist)[0];
    return thr || locks[0] || null;
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
      // looking elsewhere by hand ends the follow
      if (this.follow && Math.abs(input.lookDX) + Math.abs(input.lookDY) > 6) { this.follow = false; this.target = null; this.beep(1000); }
    }
    // follow: the target (re-picked if it is gone) and the framing; the head is turned in aim()
    if (this.follow) {
      const live = this.target && v.cands.find((c) => c.id === this.target.id);
      if (!live || (live.ref && live.ref.alive === false)) {
        const next = this.pickTarget();
        if (!next || !this.target || next.id !== this.target.id) this.aimS = null;
        this.target = next;
        if (!next) { this.follow = false; v.say('hachi_follow_lost', {}, { minGap: 4, force: false }); }
      } else this.target = live;
      const T = this.target;
      if (T && pl && pl.state === 'seated') {
        // sized to fill about a seventh of the view's height
        const R = T.R || (T.kind === 'drone' ? 1.25 : T.kind === 'station' ? 60 : T.kind === 'b29' ? 15 : 3);
        const ang = 2 * Math.atan(R / Math.max(1, T.dist));
        const fov = v.g.engine.baseVFov ? v.g.engine.baseVFov() * Math.PI / 180 : 1.0;
        this.zT = Math.max(1.5, Math.min(Z_MAX, fov * 0.14 / Math.max(1e-6, ang)));
      }
    }
    // the magnification on a spring in log space (it eases in and settles; the lenses' drive caps
    // its speed at about x2 per 0.4 s, the digital part is quicker)
    const L = this.lz, lt = Math.log(this.zT);
    if (!Number.isFinite(L.x) || Math.abs(Math.exp(L.x) - this.z) > 1e-6 * this.z) L.x = Math.log(this.z);
    const x0 = L.x, h = Math.min(dt, 0.05);
    spring1(L, lt, 7, h);
    const vmax = (this.z >= OPT_MAX - 1e-3 && this.zT >= OPT_MAX) ? 8 : 1.8;
    if (Math.abs(L.x - x0) > vmax * h) { L.x = x0 + Math.sign(L.x - x0) * vmax * h; L.v = Math.sign(L.v) * Math.min(Math.abs(L.v), vmax); }
    if (Math.abs(L.x - lt) < 4e-4 && Math.abs(L.v) < 1e-3) { L.x = lt; L.v = 0; }
    this.z = Math.exp(L.x);
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
    // the target from the eye, in H8's frame
    _v.copy(T.pos).sub(f.pos).applyQuaternion(_q.copy(f.quat).invert());
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
      if (Math.hypot(S.ry.x, S.rp.x) < 2e-4 && Math.hypot(S.ry.v, S.rp.v) < 2e-3) S.locked = true;
    }
    if (S.locked) { S.ry.x = S.ry.v = S.rp.x = S.rp.v = 0; }
    // (the yaw kept next to the head's own, so the seat does not spin round at +-180 degrees)
    pl.yaw = pl.yaw + wrap(yawT + S.ry.x - pl.yaw);
    pl.pitch = pitchT + S.rp.x;
    return true;
  }

  /** the scope's overlay on the screen: reticle, magnification, the followed target */
  drawHud(show, cam) {
    const cv = this.hud, ctx = this.ctx;
    if (!cv || !ctx) return;
    const on = show && this.z > 1.05;
    if (!on) { if (this.hudOn) { ctx.clearRect(0, 0, cv.width, cv.height); cv.style.display = 'none'; this.hudOn = false; } return; }
    if (!this.hudOn) { cv.style.display = 'block'; this.hudOn = true; }
    const W = cv.clientWidth, H = cv.clientHeight, pr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * pr) || cv.height !== Math.round(H * pr)) { cv.width = Math.round(W * pr); cv.height = Math.round(H * pr); }
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, dig = this.digital > 1.01;
    const col = dig ? 'rgba(255,196,110,0.85)' : 'rgba(150,230,255,0.85)';
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.3;
    // corner brackets of the zoomed frame
    const m = Math.min(W, H) * 0.06;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = sx < 0 ? m : W - m, y = sy < 0 ? m : H - m;
      ctx.beginPath(); ctx.moveTo(x, y - sy * -18); ctx.lineTo(x, y); ctx.lineTo(x - sx * -18, y); ctx.stroke();
    }
    // reticle: a fine cross with a gap, mil ticks
    const r = Math.min(W, H) * 0.07;
    ctx.beginPath();
    ctx.moveTo(cx - r * 2.2, cy); ctx.lineTo(cx - r * 0.5, cy); ctx.moveTo(cx + r * 0.5, cy); ctx.lineTo(cx + r * 2.2, cy);
    ctx.moveTo(cx, cy - r * 1.6); ctx.lineTo(cx, cy - r * 0.5); ctx.moveTo(cx, cy + r * 0.5); ctx.lineTo(cx, cy + r * 1.6);
    ctx.stroke();
    for (let k = 1; k <= 4; k++) { const x = r * 0.5 * k; ctx.beginPath(); ctx.moveTo(cx + 0.5 * r + x, cy - 4); ctx.lineTo(cx + 0.5 * r + x, cy + 4); ctx.moveTo(cx - 0.5 * r - x, cy - 4); ctx.lineTo(cx - 0.5 * r - x, cy + 4); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill();
    // the read-out
    ctx.font = '600 13px "SF Mono","Menlo","Consolas",monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`×${this.z < 10 ? this.z.toFixed(1) : this.z.toFixed(0)}`, m + 6, m + 28);
    ctx.font = '500 11px "Hiragino Sans","Noto Sans JP",sans-serif';
    ctx.fillText(`光学 ×${this.optical.toFixed(1)}${dig ? `  デジタル ×${this.digital.toFixed(1)}` : ''}`, m + 6, m + 44);
    if (this.follow && this.target) {
      const T = this.target;
      ctx.fillStyle = 'rgba(120,255,170,0.9)';
      ctx.fillText(`自動追従  ${T.short || T.name}  ${T.dist < 9500 ? Math.round(T.dist) + ' m' : (T.dist / 1000).toFixed(1) + ' km'}`, m + 6, m + 60);
    }
    // the magnification scale on the right edge
    const x0 = W - m - 8, y0 = cy - H * 0.22, y1 = cy + H * 0.22;
    ctx.strokeStyle = 'rgba(200,225,255,0.5)';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();
    const at = (z) => y1 - (Math.log(z) / Math.log(Z_MAX)) * (y1 - y0);
    ctx.strokeStyle = 'rgba(255,196,110,0.7)';
    ctx.beginPath(); ctx.moveTo(x0 - 6, at(OPT_MAX)); ctx.lineTo(x0 + 6, at(OPT_MAX)); ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(x0 - 3, at(this.z)); ctx.lineTo(x0 - 12, at(this.z) - 5); ctx.lineTo(x0 - 12, at(this.z) + 5); ctx.closePath(); ctx.fill();
  }
}
