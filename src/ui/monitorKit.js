// Drawing toolkit for in-world monitor UIs (canvas 2D). Buttons are registered per draw for
// hit-testing taps that arrive as canvas pixel coordinates.
export const COL = {
  bg: '#050d17', bg2: '#0a1726', line: 'rgba(120,190,255,0.22)', dim: 'rgba(150,190,230,0.45)',
  text: '#d7e7f7', cyan: '#5fd0ff', amber: '#ffb347', red: '#ff4d3d', green: '#5fe08f', violet: '#b48cff',
};
export const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",system-ui,sans-serif';
export const MONO = '"SF Mono","Menlo","Consolas","Noto Sans Mono",monospace';

export class Kit {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.W = canvas.width; this.H = canvas.height;
    this.buttons = [];
    this.s = this.W / 512; // scale unit
  }

  begin(bg = COL.bg) {
    const g = this.g;
    this.buttons.length = 0;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = bg;
    g.fillRect(0, 0, this.W, this.H);
    // subtle vignette
    const gr = g.createRadialGradient(this.W / 2, this.H / 2, this.H * 0.2, this.W / 2, this.H / 2, this.W * 0.75);
    gr.addColorStop(0, 'rgba(30,70,110,0.10)');
    gr.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = gr;
    g.fillRect(0, 0, this.W, this.H);
  }

  end(glitch = 0, t = 0) {
    const g = this.g;
    // scanlines
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < this.H; y += 3) g.fillRect(0, y, this.W, 1);
    if (glitch > 0) {
      for (let i = 0; i < 6 * glitch; i++) {
        const y = Math.random() * this.H, h = 2 + Math.random() * 18 * glitch;
        const dx = (Math.random() - 0.5) * 60 * glitch;
        try { g.drawImage(this.c, 0, y, this.W, h, dx, y, this.W, h); } catch (e) { /* ignore */ }
      }
      g.fillStyle = `rgba(255,255,255,${0.04 * glitch})`;
      for (let i = 0; i < 300 * glitch; i++) g.fillRect(Math.random() * this.W, Math.random() * this.H, 2, 2);
    }
  }

  font(px, weight = 400, mono = false) {
    this.g.font = `${weight} ${Math.round(px * this.s)}px ${mono ? MONO : FONT}`;
  }

  text(str, x, y, { size = 14, color = COL.text, align = 'left', weight = 400, mono = false, base = 'alphabetic' } = {}) {
    const g = this.g;
    this.font(size, weight, mono);
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = base;
    g.fillText(str, x * this.s, y * this.s);
  }

  rect(x, y, w, h, { fill = null, stroke = COL.line, r = 6, lw = 1 } = {}) {
    const g = this.g, s = this.s;
    g.beginPath();
    rr(g, x * s, y * s, w * s, h * s, r * s);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw * s; g.stroke(); }
  }

  line(x1, y1, x2, y2, color = COL.line, lw = 1) {
    const g = this.g, s = this.s;
    g.strokeStyle = color; g.lineWidth = lw * s;
    g.beginPath(); g.moveTo(x1 * s, y1 * s); g.lineTo(x2 * s, y2 * s); g.stroke();
  }

  circle(x, y, r, { fill = null, stroke = COL.line, lw = 1 } = {}) {
    const g = this.g, s = this.s;
    g.beginPath(); g.arc(x * s, y * s, r * s, 0, Math.PI * 2);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw * s; g.stroke(); }
  }

  /** button: registers a hit rect; style: 'normal' | 'on' | 'warn' | 'danger' | 'disabled' */
  button(x, y, w, h, label, onTap, { style = 'normal', size = 13, icon = null } = {}) {
    const col = style === 'on' ? COL.cyan : style === 'warn' ? COL.amber : style === 'danger' ? COL.red : style === 'disabled' ? 'rgba(140,160,180,0.3)' : COL.dim;
    const fill = style === 'on' ? 'rgba(95,208,255,0.18)' : style === 'danger' ? 'rgba(255,77,61,0.18)' : style === 'warn' ? 'rgba(255,179,71,0.16)' : 'rgba(255,255,255,0.03)';
    this.rect(x, y, w, h, { fill, stroke: col, r: Math.min(10, h / 2), lw: 1.4 });
    this.text(label, x + w / 2, y + h / 2 + 1, { size, color: style === 'disabled' ? 'rgba(170,190,210,0.4)' : COL.text, align: 'center', base: 'middle', weight: 600 });
    if (onTap && style !== 'disabled') this.buttons.push({ x, y, w, h, onTap });
  }

  bar(x, y, w, h, v, color = COL.cyan, bg = 'rgba(255,255,255,0.06)') {
    v = Math.max(0, Math.min(1, v));
    this.rect(x, y, w, h, { fill: bg, stroke: null, r: h / 2 });
    if (v > 0.001) this.rect(x, y, Math.max(h, w * v), h, { fill: color, stroke: null, r: h / 2 });
  }

  /** returns true if a button handled the tap (coords in canvas px) */
  hit(px, py) {
    const x = px / this.s, y = py / this.s;
    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const b = this.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.onTap(); return true; }
    }
    return false;
  }
}

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
