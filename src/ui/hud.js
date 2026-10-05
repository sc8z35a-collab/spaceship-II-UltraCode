// Minimal HUD: shows only the controls the current mode needs, plus full-screen effects
// (alarm pulse via the grade effect, fades). No text during play.
export class Hud {
  constructor(game) {
    this.g = game;
    this.el = {
      up: document.getElementById('b-up'),
      down: document.getElementById('b-down'),
      exit: document.getElementById('b-exit'),
      cam: document.getElementById('b-cam'),
      drop: document.getElementById('b-drop'),
      camUi: document.getElementById('cam-ui'),
      fade: document.getElementById('fx-fade'),
      ring: document.getElementById('hold-ring'),
      stickL: document.getElementById('stick-l'),
      stickR: document.getElementById('stick-r'),
      wpn: document.getElementById('btns-wpn'),
      rail: document.getElementById('b-rail'),
      msl: document.getElementById('b-msl'),
      auto: document.getElementById('b-auto'),
    };
    this.fade = 0;
    this.fadeTarget = 0;
    this.last = {};
  }

  show(key, on) {
    if (this.last[key] === on) return;
    this.last[key] = on;
    this.el[key].classList.toggle('hidden', !on);
  }

  setFade(v) { this.fadeTarget = v; }

  /** full-screen DOM overlay: only touch the style when the value really changes, and take the
   * element out of compositing entirely while it is invisible */
  setOverlay(key, v) {
    const el = this.el[key];
    const s = v < 0.004 ? 0 : Math.round(v * 200) / 200;
    if (this.last['ov_' + key] === s) return;
    this.last['ov_' + key] = s;
    el.style.display = s > 0 ? 'block' : 'none';
    el.style.opacity = String(s);
  }

  update(dt) {
    const g = this.g;
    const st = g.player.state;
    const floating = st === 'float' || st === 'eva';
    const climb = !!g.player.canClimb;
    const foc = !!(g.focus && !g.focus.out);
    this.show('up', g.mode === 'walk' && !foc && (floating || climb));
    this.show('down', g.mode === 'walk' && !foc && (floating || climb));
    this.show('exit', st === 'seated' || g.mode === 'camera' || foc);
    this.show('cam', (g.mode === 'pilot' || g.mode === 'camera') && !foc);
    this.show('drop', !!(g.systems && g.systems.held) && g.mode === 'walk' && !foc);
    this.show('camUi', g.mode === 'camera');
    // the guns: in a pilot seat (B-29's defence gun, or H8's cannon, railgun and missiles)
    const W = g.weapons, armed = W ? W.manned() : null;
    this.show('wpn', !!armed && (g.mode === 'pilot' || g.mode === 'camera') && !foc);
    if (armed) {
      const h8 = armed === 'h8';
      this.show('rail', h8); this.show('msl', h8);
      const autoOn = h8 ? W.auto.hachi : W.auto.asphalt;
      if (this.last.autoOn !== autoOn) { this.last.autoOn = autoOn; this.el.auto.classList.toggle('active', autoOn); }
      const railDim = h8 && (W.railCharge < 1 || W.ammo.rail <= 0);
      if (this.last.railDim !== railDim) { this.last.railDim = railDim; this.el.rail.classList.toggle('dim', railDim); }
      const mslDim = h8 && W.ammo.missile <= 0;
      if (this.last.mslDim !== mslDim) { this.last.mslDim = mslDim; this.el.msl.classList.toggle('dim', mslDim); }
    }
    this.fade += (this.fadeTarget - this.fade) * Math.min(1, dt * 2.5);
    if (Math.abs(this.fade - this.fadeTarget) < 0.002) this.fade = this.fadeTarget;
    this.setOverlay('fade', this.fade);
    // idle stick hints in pilot mode
    const pil = (g.mode === 'pilot' || g.mode === 'camera') && !foc;
    if (foc !== this.last.foc) {
      this.last.foc = foc;
      this.el.stickL.classList.toggle('hidden', foc); this.el.stickR.classList.toggle('hidden', foc);
      this.last.pil = undefined;
    }
    if (!foc && pil !== this.last.pil) {
      this.last.pil = pil;
      for (const [s, x, y] of [[this.el.stickL, 0.17, 0.72], [this.el.stickR, 0.83, 0.72]]) {
        s.classList.toggle('idle', pil);
        if (pil) { s.style.left = (x * 100) + '%'; s.style.top = (y * 100) + '%'; }
      }
    }
    // grade effect parameters
    const gr = g.engine.grade;
    const al = g.systems.alarm;
    const t = performance.now() / 1000;
    const pulse = al.active && !al.silenced ? (0.55 + 0.45 * Math.sin(t * 7.5)) * al.level : 0;
    gr.set('uAlarm', pulse);
    if (!this.el.alarm) this.el.alarm = document.getElementById('fx-alarm');
    this.setOverlay('alarm', pulse * 0.42);
    gr.set('uTime', t % 1000);
  }
}
