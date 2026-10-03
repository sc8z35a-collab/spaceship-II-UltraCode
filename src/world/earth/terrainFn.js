// Shared Earth surface height function (main thread + terrain workers).
// Global data: 4096x2048 equirectangular elevation (sqrt-encoded, 0..6600 m) and water mask.
import { Simplex3 } from '../../core/noise.js';

export const EARTH_R = 6371000.0;
export const DATA_W = 4096;
export const DATA_H = 2048;

export class TerrainFn {
  constructor(elev, water) {
    this.elev = elev;   // Uint8Array W*H
    this.water = water; // Uint8Array W*H (255 = water)
    this.n1 = new Simplex3(1337);
    this.n2 = new Simplex3(4242);
    this.n3 = new Simplex3(9001);
  }

  _elevAt(ix, iy) {
    ix = ((ix % DATA_W) + DATA_W) % DATA_W;
    iy = iy < 0 ? 0 : (iy >= DATA_H ? DATA_H - 1 : iy);
    const e = this.elev[iy * DATA_W + ix] / 255;
    return e * e * 6600.0;
  }

  _waterAt(ix, iy) {
    ix = ((ix % DATA_W) + DATA_W) % DATA_W;
    iy = iy < 0 ? 0 : (iy >= DATA_H ? DATA_H - 1 : iy);
    return this.water[iy * DATA_W + ix] / 255;
  }

  /** bicubic (Catmull-Rom) elevation in metres */
  elevation(fx, fy) {
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const wx = cr(tx), wy = cr(ty);
    let s = 0;
    for (let j = 0; j < 4; j++) {
      let row = 0;
      for (let i = 0; i < 4; i++) row += wx[i] * this._elevAt(x0 - 1 + i, y0 - 1 + j);
      s += wy[j] * row;
    }
    return s < 0 ? 0 : s;
  }

  waterFrac(fx, fy) {
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const a = this._waterAt(x0, y0), b = this._waterAt(x0 + 1, y0);
    const c = this._waterAt(x0, y0 + 1), d = this._waterAt(x0 + 1, y0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  /**
   * Height of the surface (m above sea level) for unit direction (x,y,z) in Earth-fixed frame.
   * detail: max octave detail (0 = global data only, 1..3 adds procedural relief)
   * Returns height; writes water flag into out[0] when out is given (1 = water surface).
   */
  height(x, y, z, detail = 3, out = null) {
    const lat = Math.asin(Math.max(-1, Math.min(1, y)));
    const lon = Math.atan2(-z, x);
    const fx = (lon / (2 * Math.PI) + 0.5) * DATA_W - 0.5;
    const fy = (0.5 - lat / Math.PI) * DATA_H - 0.5;
    const h0 = this.elevation(fx, fy);
    let w = this.waterFrac(fx, fy);
    // positions in metres for procedural noise (float64 precision)
    const px = x * EARTH_R, py = y * EARTH_R, pz = z * EARTH_R;
    // fractal coastline
    if (w > 0.02 && w < 0.98 && detail > 0) {
      const c = this.n1.noise(px / 9000, py / 9000, pz / 9000) * 0.28
        + this.n1.noise(px / 2600, py / 2600, pz / 2600) * 0.14
        + (detail > 1 ? this.n1.noise(px / 700, py / 700, pz / 700) * 0.07 : 0);
      w += c;
    }
    const land = smooth(0.62, 0.38, w); // 1 on land, 0 on water
    let h = h0;
    if (detail > 0 && land > 0) {
      const rough = Math.min(1, Math.max(0.06, h0 / 1800));
      let d = (this.n2.ridged(px / 26000, py / 26000, pz / 26000, 4) - 0.45) * 900 * rough;
      if (detail > 1) d += this.n3.fbm(px / 3200, py / 3200, pz / 3200, 4) * (120 * rough + 25);
      if (detail > 2) d += this.n3.fbm(px / 260, py / 260, pz / 260, 3) * (14 + 30 * rough) + this.n2.noise(px / 40, py / 40, pz / 40) * 2.0;
      h = h0 + d;
      // coast: rise gently from the sea
      const coast = smooth(0.0, 1.0, land);
      h = 2.0 + Math.max(h, 1.0) * coast;
      if (h < 1.5) h = 1.5;
    }
    let isWater = land < 0.5 ? 1 : 0;
    if (isWater) h = h0 > 30 ? h0 : 0; // lakes keep their elevation
    if (out) out[0] = isWater;
    return h;
  }
}

function smooth(a, b, x) {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

function cr(t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1,
    -1.5 * t3 + 2 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2,
  ];
}

// ---------- cube-sphere helpers ----------
export const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

/** cube face coords (u,v in [-1,1]) -> unit sphere direction written to out[off..off+2] */
export function faceToDir(face, u, v, out, off = 0) {
  const F = FACES[face];
  const tu = Math.tan(u * Math.PI / 4), tv = Math.tan(v * Math.PI / 4);
  const x = F.n[0] + tu * F.u[0] + tv * F.v[0];
  const y = F.n[1] + tu * F.u[1] + tv * F.v[1];
  const z = F.n[2] + tu * F.u[2] + tv * F.v[2];
  const l = Math.sqrt(x * x + y * y + z * z);
  out[off] = x / l; out[off + 1] = y / l; out[off + 2] = z / l;
  return out;
}

/** node arc size in metres for a level */
export function nodeSize(level) {
  return EARTH_R * (Math.PI / 2) / Math.pow(2, level);
}

export const GRID_N = 32;

/** grid vertex indices around the patch boundary, CCW seen from outside */
export function boundaryLoop(N) {
  const loop = [];
  for (let i = 0; i < N; i++) loop.push(0 * (N + 1) + i);          // bottom, left->right
  for (let j = 0; j < N; j++) loop.push(j * (N + 1) + N);          // right, bottom->top
  for (let i = N; i > 0; i--) loop.push(N * (N + 1) + i);          // top, right->left
  for (let j = N; j > 0; j--) loop.push(j * (N + 1) + 0);          // left, top->bottom
  return loop;
}
