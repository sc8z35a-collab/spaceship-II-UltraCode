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

  update(dt) {
    const g = this.g;
    const st = g.player.state;
    const floating = st === 'float' || st === 'eva';
    const climb = !!g.player.canClimb;
    this.show('up', g.mode === 'walk' && (floating || climb));
    this.show('down', g.mode === 'walk' && (floating || climb));
    this.show('exit', st === 'seated' || g.mode === 'camera');
    this.show('cam', g.mode === 'pilot' || g.mode === 'camera');
    this.show('drop', !!(g.systems && g.systems.held) && g.mode === 'walk');
    this.show('camUi', g.mode === 'camera');
    this.fade += (this.fadeTarget - this.fade) * Math.min(1, dt * 2.5);
    this.el.fade.style.opacity = this.fade.toFixed(3);
    // idle stick hints in pilot mode
    const pil = g.mode === 'pilot' || g.mode === 'camera';
    if (pil !== this.last.pil) {
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
    this.el.alarm.style.opacity = (pulse * 0.42).toFixed(3);
    gr.set('uTime', t % 1000);
  }
}
