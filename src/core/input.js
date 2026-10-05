// Touch-first input: floating virtual sticks, drag-to-look, taps for in-world interaction,
// HUD buttons. Keyboard + mouse fallback for desktop testing.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Input {
  constructor(el) {
    this.el = el;
    this.moveX = 0; this.moveY = 0;     // left stick (-1..1)
    this.rStickX = 0; this.rStickY = 0; // right stick (piloting)
    this.lookDX = 0; this.lookDY = 0;   // accumulated look delta (pixels)
    this.pinch = 1;                     // accumulated zoom factor (two fingers / mouse wheel)
    this.up = 0;                        // float up/down (-1..1)
    this.taps = [];                     // [{x,y}] normalized device coords for this frame
    this.holds = [];                    // active long-press {x,y,t}
    this.mode = 'walk';                 // 'walk' | 'pilot' | 'camera' | 'locked'
    this.touches = new Map();
    this.keys = new Set();
    this.btn = {};
    this.mouseDown = false;
    this.stickL = document.getElementById('stick-l');
    this.stickR = document.getElementById('stick-r');
    this.enabled = false;
    this._bind();
  }

  _zone(x, y) {
    const w = window.innerWidth, h = window.innerHeight;
    if (this.mode === 'focus') return 'look';   // looking at a monitor: every touch is a tap
    if (this.mode === 'pilot' || this.mode === 'camera') {
      if (x < w * 0.4 && y > h * 0.35) return 'L';
      if (x > w * 0.6 && y > h * 0.35) return 'R';
      return 'look';
    }
    if (x < w * 0.42) return 'L';
    return 'look';
  }

  _bind() {
    const el = this.el;
    const opt = { passive: false };
    el.addEventListener('pointerdown', (e) => this._down(e), opt);
    window.addEventListener('pointermove', (e) => this._move(e), opt);
    window.addEventListener('pointerup', (e) => this._up(e), opt);
    window.addEventListener('pointercancel', (e) => this._up(e, true), opt);
    window.addEventListener('keydown', (e) => { this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.touches.clear(); this._resetSticks(); });
    el.addEventListener('wheel', (e) => { if (!this.enabled) return; e.preventDefault(); this.pinch *= Math.exp(e.deltaY * 0.0012); }, opt);
    // HUD buttons
    for (const id of ['b-up', 'b-down', 'b-exit', 'b-cam', 'b-drop', 'b-cam-next', 'b-fire', 'b-rail', 'b-msl', 'b-tgt', 'b-auto']) {
      const b = document.getElementById(id);
      if (!b) continue;
      this.btn[id] = { down: false, pressed: false };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.btn[id].down = true; this.btn[id].pressed = true; b.classList.add('on'); });
      const up = (e) => { this.btn[id].down = false; b.classList.remove('on'); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
      b.addEventListener('pointercancel', up);
    }
  }

  _down(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const zone = this._zone(e.clientX, e.clientY);
    const t = { id: e.pointerId, zone, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), moved: 0, type: e.pointerType };
    this.touches.set(e.pointerId, t);
    if (zone === 'L') this._placeStick(this.stickL, t);
    if (zone === 'R') this._placeStick(this.stickR, t);
    if (e.pointerType === 'mouse') this.mouseDown = true;
    this.holds.push({ id: e.pointerId, x: e.clientX, y: e.clientY, t0: t.t0, active: true });
  }

  _placeStick(s, t) {
    s.style.left = t.x0 + 'px';
    s.style.top = t.y0 + 'px';
    s.classList.add('on');
    s.querySelector('.knob').style.transform = 'translate(0px,0px)';
  }

  _move(e) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    e.preventDefault();
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    t.moved += Math.abs(dx) + Math.abs(dy);
    t.x = e.clientX; t.y = e.clientY;
    const R = window.innerHeight * 0.11;
    if (t.zone === 'L' || t.zone === 'R') {
      let sx = (t.x - t.x0) / R, sy = (t.y - t.y0) / R;
      const l = Math.hypot(sx, sy);
      if (l > 1) { sx /= l; sy /= l; }
      const s = t.zone === 'L' ? this.stickL : this.stickR;
      s.querySelector('.knob').style.transform = `translate(${sx * R}px,${sy * R}px)`;
      if (t.zone === 'L') { this.moveX = sx; this.moveY = -sy; } else { this.rStickX = sx; this.rStickY = -sy; }
    } else {
      // two fingers in the look area: pinch (zoom) instead of looking
      const looks = [...this.touches.values()].filter((o) => o.zone === 'look');
      if (looks.length >= 2) {
        const [a, b] = looks;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this._pinchD) this.pinch *= this._pinchD / Math.max(20, d);
        this._pinchD = Math.max(20, d);
        t.moved += 20;   // not a tap
      } else {
        this._pinchD = 0;
        this.lookDX += dx; this.lookDY += dy;
      }
    }
    const h = this.holds.find((h) => h.id === e.pointerId);
    if (h && t.moved > 14) h.active = false;
  }

  _up(e, cancel) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    this.touches.delete(e.pointerId);
    const dt = performance.now() - t.t0;
    if (!cancel && t.moved < 14 && dt < 350) {
      this.taps.push({ x: (t.x / window.innerWidth) * 2 - 1, y: -(t.y / window.innerHeight) * 2 + 1, px: t.x, py: t.y });
    }
    this._pinchD = 0;
    if (t.zone === 'L') { this.moveX = this.moveY = 0; this.stickL.classList.remove('on'); }
    if (t.zone === 'R') { this.rStickX = this.rStickY = 0; this.stickR.classList.remove('on'); }
    this.holds = this.holds.filter((h) => h.id !== e.pointerId);
    if (e.pointerType === 'mouse') this.mouseDown = false;
  }

  _resetSticks() {
    this.moveX = this.moveY = this.rStickX = this.rStickY = 0;
    this.stickL.classList.remove('on'); this.stickR.classList.remove('on');
  }

  setMode(m) {
    if (this.mode === m) return;
    this.mode = m;
    this.touches.clear();
    this._resetSticks();
  }

  /** read & clear per-frame values */
  poll() {
    const k = this.keys;
    // keyboard fallbacks
    let mx = this.moveX, my = this.moveY;
    if (k.has('KeyA')) mx -= 1; if (k.has('KeyD')) mx += 1;
    if (k.has('KeyW')) my += 1; if (k.has('KeyS')) my -= 1;
    let rx = this.rStickX, ry = this.rStickY;
    if (k.has('KeyJ')) rx -= 1; if (k.has('KeyL')) rx += 1;
    if (k.has('KeyI')) ry += 1; if (k.has('KeyK')) ry -= 1;
    let up = 0;
    if (k.has('Space') || (this.btn['b-up'] && this.btn['b-up'].down)) up += 1;
    if (k.has('KeyC') || k.has('ShiftLeft') || (this.btn['b-down'] && this.btn['b-down'].down)) up -= 1;
    if (k.has('ArrowLeft')) this.lookDX -= 6; if (k.has('ArrowRight')) this.lookDX += 6;
    if (k.has('ArrowUp')) this.lookDY -= 6; if (k.has('ArrowDown')) this.lookDY += 6;
    const out = {
      moveX: clamp(mx, -1, 1), moveY: clamp(my, -1, 1),
      rx: clamp(rx, -1, 1), ry: clamp(ry, -1, 1),
      lookDX: this.lookDX, lookDY: this.lookDY, pinch: this.pinch,
      up,
      taps: this.taps.splice(0),
      pressed: {},
      holds: this.holds.filter((h) => h.active),
    };
    for (const [id, b] of Object.entries(this.btn)) { out.pressed[id] = b.pressed; b.pressed = false; }
    if (k.has('KeyE')) { out.pressed.key_e = true; k.delete('KeyE'); }
    if (k.has('KeyQ')) { out.pressed['b-exit'] = true; k.delete('KeyQ'); }
    if (k.has('KeyV')) { out.pressed['b-cam'] = true; k.delete('KeyV'); }
    if (k.has('KeyU')) { out.pressed.key_u = true; k.delete('KeyU'); }
    this.lookDX = 0; this.lookDY = 0; this.pinch = 1;
    return out;
  }
}
