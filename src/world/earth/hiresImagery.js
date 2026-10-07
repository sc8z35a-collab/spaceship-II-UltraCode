// Real high-resolution imagery around the camera: Sentinel-2 cloudless (EOX IT Services GmbH,
// CC BY 4.0; contains modified Copernicus Sentinel data) streamed as a clipmap. Each level is a
// Web-Mercator zoom whose 4x4-tile window around the camera's sub-point lives toroidally in one
// 1024x1024 texture (tile (x, y) always sits in slot (x mod 4, y mod 4)), so recentring only loads
// the tiles that newly enter the window. The terrain shader blends the finest loaded level that is
// not minified too far over the global Blue Marble colour.
import * as THREE from 'three';
import { mercXY } from './hiresElevation.js';
import { QUALITY } from '../../core/quality.js';

export const HI_LEVELS = [6, 8, 10, 12, 14];
const WIN = 4, TS = 256;
const URL = (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`;
export const HI_CREDIT = 'Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)';

export const HIRES_GLSL = /* glsl */`
uniform sampler2D tHi0; uniform sampler2D tHi1; uniform sampler2D tHi2; uniform sampler2D tHi3; uniform sampler2D tHi4;
uniform vec4 uHiWin[5];     // window origin tile (x, y), 2^zoom, level on
uniform float uHiFade[80];  // per slot: level * 16 + sy * 4 + sx
vec2 mercUV(vec3 d){
  float lon = atan(-d.z, d.x);
  float lat = asin(clamp(d.y, -0.9999, 0.9999));
  return vec2(lon / 6.28318530718 + 0.5, 0.5 - log(tan(0.78539816 + lat * 0.5)) / 6.28318530718);
}
// one level: returns weight (0 when not usable here), colour in c
float hiLevel(sampler2D tex, int k, vec2 m, vec2 mdx, vec2 mdy, out vec3 c){
  c = vec3(0.0);
  vec4 W = uHiWin[k];
  if (W.w < 0.5) return 0.0;
  vec2 t = m * W.z;
  vec2 ti = floor(t);
  vec2 dxy = vec2(mod(ti.x - W.x + W.z, W.z), ti.y - W.y);
  if (dxy.x < 0.0 || dxy.x > 3.5 || dxy.y < 0.0 || dxy.y > 3.5) return 0.0;
  vec2 slot = mod(ti, 4.0);
  float f = uHiFade[k * 16 + int(slot.y) * 4 + int(slot.x)];
  if (f <= 0.0) return 0.0;
  // texels per screen pixel: hand over to the coarser level before the mips bleed between slots
  vec2 gx = mdx * W.z * 256.0, gy = mdy * W.z * 256.0;
  float fp = max(length(gx), length(gy));
  float res = 1.0 - smoothstep(1.6, 3.2, fp);
  // soft edge half a tile wide along the window border
  vec2 p = dxy + fract(t);
  vec2 e = min(p, 4.0 - p);
  float edge = smoothstep(0.05, 0.6, min(e.x, e.y));
  float w = f * res * edge;
  if (w <= 0.001) return 0.0;
  vec2 fr = clamp(fract(t), 1.2 / 256.0, 1.0 - 1.2 / 256.0);
  c = textureGrad(tex, (slot + fr) * 0.25, mdx * W.z * 0.25, mdy * W.z * 0.25).rgb;
  return w;
}
// blends the streamed imagery over base, coarse to fine; returns the total weight in hw
vec3 hiresColor(vec3 d, vec3 base, out float hw){
  vec2 m = mercUV(d);
  vec2 mdx = dFdx(m), mdy = dFdy(m);
  if (abs(mdx.x) > 0.5) mdx.x -= sign(mdx.x);
  if (abs(mdy.x) > 0.5) mdy.x -= sign(mdy.x);
  vec3 col = base, c;
  hw = 0.0;
  float w;
  w = hiLevel(tHi0, 0, m, mdx, mdy, c); col = mix(col, c, w); hw = max(hw, w);
  w = hiLevel(tHi1, 1, m, mdx, mdy, c); col = mix(col, c, w); hw = max(hw, w);
  w = hiLevel(tHi2, 2, m, mdx, mdy, c); col = mix(col, c, w); hw = max(hw, w);
  w = hiLevel(tHi3, 3, m, mdx, mdy, c); col = mix(col, c, w); hw = max(hw, w);
  w = hiLevel(tHi4, 4, m, mdx, mdy, c); col = mix(col, c, w); hw = max(hw, w);
  return col;
}
`;

export class HiresImagery {
  constructor(renderer) {
    this.renderer = renderer;
    this.on = true;
    this.offlineUntil = 0;
    this.active = 0;
    this.levels = HI_LEVELS.map((z) => {
      const tex = new THREE.DataTexture(new Uint8Array(WIN * TS * WIN * TS * 4), WIN * TS, WIN * TS, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = QUALITY.level === 'low2' ? 1 : 4;   // (LOW II: lighter filtering)
      tex.needsUpdate = true;
      return { z, n: 2 ** z, tex, x0: 0, y0: 0, has: false, slots: Array.from({ length: 16 }, () => ({ key: null, fade: 0, loading: false })) };
    });
    this.uniforms = {
      uHiWin: { value: this.levels.map(() => new THREE.Vector4(0, 0, 1, 0)) },
      uHiFade: { value: new Float32Array(80) },
    };
    this.levels.forEach((L, i) => { this.uniforms['tHi' + i] = { value: L.tex }; });
    this.inited = false;
  }

  setEnabled(on) { this.on = on; }

  /** lat / lon (radians) of the camera sub-point, altitude (m) */
  update(lat, lon, alt, dt) {
    if (!this.inited) { for (const L of this.levels) this.renderer.initTexture(L.tex); this.inited = true; }
    const U = this.uniforms.uHiWin.value, F = this.uniforms.uHiFade.value;
    const far = alt > 2.5e7 || !this.on;
    lat = Math.max(-1.45, Math.min(1.45, lat));
    this.levels.forEach((L, k) => {
      // levels much finer than the view needs stay idle (high orbit: only the coarse ones)
      const tileM = 40075016 * Math.cos(lat) / L.n;
      const useful = !far && tileM * WIN > alt * 0.35;
      const [mx, my] = mercXY(lat, lon, L.z);
      const x0 = Math.floor(mx - WIN / 2 + 0.5), y0 = Math.max(0, Math.min(L.n - WIN, Math.floor(my - WIN / 2 + 0.5)));
      L.x0 = ((x0 % L.n) + L.n) % L.n; L.y0 = y0;
      for (let j = 0; j < WIN; j++) for (let i = 0; i < WIN; i++) {
        const tx = (L.x0 + i) % L.n, ty = L.y0 + j;
        const si = (ty % WIN) * WIN + (tx % WIN), s = L.slots[si];
        const key = tx + '/' + ty;
        if (useful && s.key !== key && !s.loading) this._load(L, s, tx, ty, key);
        // a slot only shows when it holds the tile the window expects there
        const ok = useful && s.key === key && !s.loading;
        if (ok) s.fade = Math.min(1, s.fade + dt * 1.5);
        F[k * 16 + si] = ok ? Math.max(0.0001, s.fade) : 0;
      }
      U[k].set(L.x0, L.y0, L.n, useful ? 1 : 0);
    });
  }

  async _load(L, s, tx, ty, key) {
    if (Date.now() < this.offlineUntil || this.active >= 8) return;
    s.loading = true;
    s.fade = 0;
    s.key = key;
    this.active++;
    try {
      const res = await fetch(URL(L.z, tx, ty));
      if (!res.ok) throw new Error('http ' + res.status);
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      if (s.key !== key) { bmp.close && bmp.close(); return; }
      const src = new THREE.Texture(bmp);
      this.renderer.copyTextureToTexture(src, L.tex, null, new THREE.Vector2((tx % WIN) * TS, (ty % WIN) * TS));
      bmp.close && bmp.close();
    } catch (e) {
      s.key = null;
      this.offlineUntil = Date.now() + 30000;
    } finally {
      this.active--;
      s.loading = false;
    }
  }
}
