// High-resolution elevation streamed on demand: Terrain Tiles (Mapzen / AWS open data; SRTM,
// GMTED2010, ETOPO1, 3DEP...) in the "terrarium" encoding, Web Mercator 256 px tiles. Used by the
// terrain workers (patch meshes) and by the main thread (ground contact), so both agree on the
// surface. Tiles that cannot be fetched (offline) simply leave the coarse global data in charge.

const URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const TS = 256;
const MAX_LAT = 85.0 * Math.PI / 180;
export const HI_MAX_ZOOM = 13;

/** Web Mercator tile coordinates (fractional) of a latitude / longitude (radians) */
export function mercXY(lat, lon, z) {
  const n = 2 ** z;
  const x = (lon / (2 * Math.PI) + 0.5) * n;
  const y = (0.5 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / (2 * Math.PI)) * n;
  return [x, y];
}

/** elevation zoom that matches a terrain patch level (pixel ~ grid spacing), or -1 */
export function zoomForLevel(level) {
  if (level < 6) return -1;
  return Math.min(HI_MAX_ZOOM, level - 1);
}

export class HiElev {
  constructor(maxTiles = 110) {
    this.tiles = new Map();     // key -> { h: Int16Array | null, p: Promise, used }
    this.maxTiles = maxTiles;
    this.offlineUntil = 0;
    this.active = 0;
    this.waiting = [];
    this.tick = 0;
  }

  key(z, x, y) { return z + '/' + x + '/' + y; }

  /** height data of one tile (Int16Array metres) or null when unavailable */
  get(z, x, y) {
    const n = 2 ** z;
    x = ((x % n) + n) % n;
    if (y < 0 || y >= n) return Promise.resolve(null);
    const k = this.key(z, x, y);
    let t = this.tiles.get(k);
    if (t) { t.used = ++this.tick; return t.p; }
    if (Date.now() < this.offlineUntil) return Promise.resolve(null);
    t = { h: null, used: ++this.tick, done: false };
    t.p = this._throttle(() => this._load(z, x, y)).then((h) => { t.h = h; t.done = true; if (!h) this.tiles.delete(k); return h; });
    this.tiles.set(k, t);
    if (this.tiles.size > this.maxTiles) this._evict();
    return t.p;
  }

  async _throttle(fn) {
    if (this.active >= 6) await new Promise((r) => this.waiting.push(r));
    this.active++;
    try { return await fn(); } finally { this.active--; const w = this.waiting.shift(); if (w) w(); }
  }

  async _load(z, x, y) {
    try {
      const res = await fetch(URL(z, x, y));
      if (!res.ok) return null;
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(TS, TS) : Object.assign(document.createElement('canvas'), { width: TS, height: TS });
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      bmp.close && bmp.close();
      const d = g.getImageData(0, 0, TS, TS).data;
      const h = new Int16Array(TS * TS);
      for (let i = 0, j = 0; i < h.length; i++, j += 4) {
        const v = d[j] * 256 + d[j + 1] + d[j + 2] / 256 - 32768;
        h[i] = v < -12000 ? -12000 : v > 9000 ? 9000 : Math.round(v);
      }
      return h;
    } catch (e) {
      // offline or blocked: stop asking for a while
      this.offlineUntil = Date.now() + 60000;
      return null;
    }
  }

  _evict() {
    const list = [...this.tiles.entries()].filter(([, t]) => t.done).sort((a, b) => a[1].used - b[1].used);
    for (const [k] of list) { if (this.tiles.size <= this.maxTiles * 0.8) break; this.tiles.delete(k); }
  }

  /** load every tile at zoom z covering a lat/lon box (radians); resolves when all settled */
  ensure(z, lat0, lat1, lon0, lon1) {
    if (z < 0) return Promise.resolve();
    lat0 = Math.max(-MAX_LAT, lat0); lat1 = Math.min(MAX_LAT, lat1);
    if (lat1 <= lat0) return Promise.resolve();
    const [xa, ya] = mercXY(lat1, lon0, z), [xb, yb] = mercXY(lat0, lon1, z);
    const x0 = Math.floor(xa - 0.02), x1 = Math.floor(xb + 0.02), y0 = Math.floor(ya - 0.02), y1 = Math.floor(yb + 0.02);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 12) return Promise.resolve();
    const ps = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ps.push(this.get(z, x, y));
    return Promise.all(ps);
  }

  _pix(z, X, Y) {
    const n = 2 ** z;
    const tx = Math.floor(X / TS), ty = Math.floor(Y / TS);
    if (ty < 0 || ty >= n) return NaN;
    const t = this.tiles.get(this.key(z, ((tx % n) + n) % n, ty));
    if (!t || !t.h) return NaN;
    return t.h[(Y - ty * TS) * TS + (X - tx * TS)];
  }

  /** bilinear height (m) at lat/lon (radians) from the finest loaded zoom <= z, or NaN */
  sample(lat, lon, z) {
    if (z < 0 || lat > MAX_LAT || lat < -MAX_LAT) return NaN;
    for (let zz = z; zz >= Math.max(4, z - 3); zz--) {
      const [x, y] = mercXY(lat, lon, zz);
      const X = x * TS - 0.5, Y = y * TS - 0.5;
      const X0 = Math.floor(X), Y0 = Math.floor(Y), fx = X - X0, fy = Y - Y0;
      const a = this._pix(zz, X0, Y0), b = this._pix(zz, X0 + 1, Y0), c = this._pix(zz, X0, Y0 + 1), d = this._pix(zz, X0 + 1, Y0 + 1);
      if (a !== a || b !== b || c !== c || d !== d) continue;
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
    return NaN;
  }
}
