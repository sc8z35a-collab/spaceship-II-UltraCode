// Fracture networks in the window glass. Each cracked pane gets a real crack pattern grown from
// the impact point: radial cracks that wander and branch, concentric arcs between them, a crushed
// core — every crack carries the severity at which its front gets there, so the damage visibly
// creeps across the pane as it worsens. Once the pane gives way the middle is gone and jagged
// shards stay stuck in the frame. Painted into one atlas texture the glass shader reads:
// R = crack lines, G = the milky halo around them, B = glass missing.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const AT = 2048;

function rng(seed) {
  let s = (Math.floor(seed * 9301 + 49297) % 233280 + 233280) % 233280 || 1;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

/** the full network of a pane (metres around the pane centre); t = severity when the front arrives */
export function fractureNetwork(cu, cv, seed, S) {
  const R = rng(seed * 1000 + 7);
  const lines = [];
  const rays = [];
  const nr = 9 + Math.floor(R() * 8);
  const reach = S * 1.5;
  const grow = (pts, a, L, t0, speed, depth) => {
    let x = pts[pts.length - 1][0], y = pts[pts.length - 1][1], len = 0, t = t0;
    while (len < L) {
      // glass cracks run nearly straight, with small kinks
      const st = S * (0.014 + 0.024 * R());
      a += (R() - 0.5) * (R() < 0.12 ? 0.5 : 0.14);
      x += Math.cos(a) * st; y += Math.sin(a) * st; len += st;
      t += st / speed;
      pts.push([x, y, t]);
      if (Math.abs(x) > S * 1.04 || Math.abs(y) > S * 1.04) break;
      // forks: the crack splits and both run on
      if (depth < 2 && R() < 0.03 && len > L * 0.2) {
        const b = [[x, y, t]];
        grow(b, a + (R() < 0.5 ? -1 : 1) * (0.25 + 0.4 * R()), (L - len) * (0.35 + 0.5 * R()), t + 0.02, speed * 0.85, depth + 1);
        lines.push({ pts: b, w: 0.7 });
      }
    }
  };
  for (let i = 0; i < nr; i++) {
    const a = (i + R() * 0.75) / nr * TAU;
    const t0 = 0.01 + Math.pow(R(), 2.2) * 1.3;          // most start at once, some only later
    const pts = [[cu, cv, t0]];
    grow(pts, a, reach * (0.5 + 0.8 * R()), t0, reach / 1.5 * (0.55 + 0.8 * R()), 0);
    rays.push(pts);
    lines.push({ pts, w: 1 });
  }
  // concentric arcs between neighbouring rays (the spider web)
  const at = (ray, d) => {
    let acc = 0;
    for (let k = 1; k < ray.length; k++) {
      const [x0, y0, t0] = ray[k - 1], [x1, y1, t1] = ray[k];
      const l = Math.hypot(x1 - x0, y1 - y0);
      if (acc + l >= d) { const f = (d - acc) / l; return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, t0 + (t1 - t0) * f]; }
      acc += l;
    }
    return null;
  };
  const rings = [];
  for (let j = 0; j < 6; j++) {
    const rr = S * (0.028 + 0.06 * j * (0.75 + 0.5 * R()));
    const tj = 0.2 + j * 0.28 + R() * 0.15;
    const ring = [];
    for (let i = 0; i < nr; i++) {
      const A = at(rays[i], rr), B = at(rays[(i + 1) % nr], rr * (0.82 + 0.36 * R()));
      ring.push(A);
      if (!A || !B || R() > 0.8) continue;
      const t = Math.max(A[2], B[2], tj) + R() * 0.1;
      const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
      const ox = mx - cu, oy = my - cv, ol = Math.hypot(ox, oy) || 1;
      const sag = (R() - 0.3) * 0.25 * Math.hypot(B[0] - A[0], B[1] - A[1]);
      const pts = [[A[0], A[1], t]];
      for (let k = 1; k <= 4; k++) {
        const f = k / 5, bow = Math.sin(f * Math.PI) * sag;
        pts.push([A[0] + (B[0] - A[0]) * f + ox / ol * bow + (R() - 0.5) * S * 0.006, A[1] + (B[1] - A[1]) * f + oy / ol * bow + (R() - 0.5) * S * 0.006, t + 0.01 * k]);
      }
      pts.push([B[0], B[1], t + 0.05]);
      lines.push({ pts, w: 0.8 });
    }
    rings.push(ring);
  }
  // where the pane gives way: inside a ragged loop through the outer web
  const gone = [];
  rays.forEach((ray, i) => {
    const a = Math.atan2(ray[Math.min(3, ray.length - 1)][1] - cv, ray[Math.min(3, ray.length - 1)][0] - cu);
    const d = S * (0.25 + 0.5 * R()) + (i % 2) * S * 0.12;
    const p = at(ray, d);
    const q = p ? [p[0], p[1]] : [cu + Math.cos(a) * d, cv + Math.sin(a) * d];
    gone.push(q);
    // a jagged shard tip sticking in between two rays
    const nx = rays[(i + 1) % nr], a2 = Math.atan2(nx[Math.min(3, nx.length - 1)][1] - cv, nx[Math.min(3, nx.length - 1)][0] - cu);
    let am = (a + a2) / 2; if (Math.abs(a2 - a) > Math.PI) am += Math.PI;
    const dm = d * (0.45 + 0.6 * R());
    gone.push([cu + Math.cos(am) * dm, cv + Math.sin(am) * dm]);
  });
  return { lines, cu, cv, S, gone, seed };
}

/** atlas slot of a window: canopy (15) gets a whole quadrant, the rest 512 px tiles */
function slot(i) {
  if (i === 15) return { x: 1024, y: 0, size: 1024 };
  const k = i % 12;
  const q = Math.floor(k / 4), r = k % 4;
  const qx = q === 1 ? 0 : q === 0 ? 0 : 1024, qy = q === 0 ? 0 : 1024;
  return { x: qx + (r % 2) * 512, y: qy + Math.floor(r / 2) * 512, size: 512 };
}

export class CrackAtlas {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = AT;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, AT, AT);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.generateMipmaps = true;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.anisotropy = 4;
    this.nets = new Map();     // window -> { net, drawn sev, broken }
    // per window: atlas rect (u0, v0, size) in UV + half extent of the pane (m)
    this.uTile = Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, 0, 1));
  }

  /** (re)paint window i for its current crack state; returns true when something changed */
  update(i, c, S) {
    if (!c) {
      if (!this.nets.has(i)) return false;
      this.nets.delete(i);
      this._clear(i);
      this.tex.needsUpdate = true;
      return true;
    }
    let e = this.nets.get(i);
    if (!e || e.seed !== c.seed) { e = { net: fractureNetwork(c.u, c.v, c.seed, S), sev: -1, broken: false, seed: c.seed }; this.nets.set(i, e); }
    if (Math.abs(e.sev - c.sev) < 0.025 && e.broken === !!c.broken) return false;
    const grew = e.sev >= 0 && c.sev > e.sev;
    e.sev = c.sev; e.broken = !!c.broken;
    this._paint(i, e.net, c.sev, e.broken);
    this.tex.needsUpdate = true;
    const sl = slot(i);
    this.uTile[i].set(sl.x / AT, 1 - (sl.y + sl.size) / AT, sl.size / AT, S);
    return grew;
  }

  _clear(i) {
    const sl = slot(i), g = this.ctx;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(sl.x, sl.y, sl.size, sl.size);
  }

  _paint(i, net, sev, broken) {
    const g = this.ctx, sl = slot(i), S = net.S;
    this._clear(i);
    g.save();
    g.beginPath(); g.rect(sl.x, sl.y, sl.size, sl.size); g.clip();
    const px = sl.size / 2 / S;                       // pixels per metre
    g.translate(sl.x + sl.size / 2, sl.y + sl.size / 2);
    g.scale(px, -px);
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.globalCompositeOperation = 'lighter';
    const path = (pts) => {
      // the part of a crack its front has reached by now
      if (pts[0][2] > sev) return false;
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k++) {
        const [x0, y0, t0] = pts[k - 1], [x1, y1, t1] = pts[k];
        if (t1 <= sev) { g.lineTo(x1, y1); continue; }
        const f = Math.max(0, Math.min(1, (sev - t0) / Math.max(1e-6, t1 - t0)));
        g.lineTo(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
        break;
      }
      return true;
    };
    // halo: the glass around a crack turns milky (green channel), wide soft strokes
    for (const [w, a] of [[8, 16], [4.5, 26], [2.4, 44]]) {
      g.strokeStyle = `rgb(0,${a},0)`;
      for (const L of net.lines) { if (!path(L.pts)) continue; g.lineWidth = w * L.w / px; g.stroke(); }
    }
    // the cracks themselves (red channel): a bright core with a soft shoulder
    for (const [w, a] of [[2.4, 70], [1.05, 185]]) {
      g.strokeStyle = `rgb(${a},0,0)`;
      for (const L of net.lines) { if (!path(L.pts)) continue; g.lineWidth = Math.max(0.9, w * L.w) / px; g.stroke(); }
    }
    // the crushed core: powdered glass round the impact point
    const rc = S * (0.006 + 0.022 * Math.min(1.5, sev));
    for (let k = 0; k < 3; k++) {
      const gr = g.createRadialGradient(net.cu, net.cv, 0, net.cu, net.cv, rc * (1 + k * 0.6));
      gr.addColorStop(0, `rgb(${120 - k * 30},${90 - k * 20},0)`);
      gr.addColorStop(1, 'rgb(0,0,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(net.cu, net.cv, rc * (1 + k * 0.6), 0, TAU); g.fill();
    }
    // gone: the middle of a broken pane (blue channel); the rest stays as jagged shards
    if (broken) {
      g.beginPath();
      net.gone.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fillStyle = 'rgb(0,0,255)';
      g.fill();
      // the broken edges of the shards catch the light
      g.strokeStyle = 'rgb(0,60,0)'; g.lineWidth = 5 / px; g.stroke();
      g.strokeStyle = 'rgb(200,0,0)'; g.lineWidth = 1.6 / px; g.stroke();
    }
    g.restore();
  }
}
