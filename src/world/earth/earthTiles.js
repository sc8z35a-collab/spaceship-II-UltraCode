// Streams 1.85 km/px Blue Marble tiles (and 3.7 km/px city-light tiles) around the camera's
// sub-point. Four slots form a 2x2 block of 45-degree tiles; they fade in when loaded.
import * as THREE from 'three';
import { assetUrl } from './earthAssets.js';

export const TILE_GLSL = /* glsl */`
uniform sampler2D tTileC0; uniform sampler2D tTileC1; uniform sampler2D tTileC2; uniform sampler2D tTileC3;
uniform sampler2D tTileL0; uniform sampler2D tTileL1; uniform sampler2D tTileL2; uniform sampler2D tTileL3;
uniform vec4 uTile[4]; // col, row, fade, unused
const float TPAD = 8.0 / 2716.0; const float TSC = 2700.0 / 2716.0;
const float LPAD = 4.0 / 1358.0; const float LSC = 1350.0 / 1358.0;
// returns colour (rgb) + water (a); lights in 'lights'
vec4 sampleSurface(vec2 uv, vec2 gx, vec2 gy, vec4 base, inout float lights){
  float col = floor(uv.x * 8.0);
  float row = floor((1.0 - uv.y) * 4.0);
  vec2 luv = vec2(fract(uv.x * 8.0), fract(uv.y * 4.0));
  // inside-tile gradients
  vec2 tgx = gx * vec2(8.0, 4.0), tgy = gy * vec2(8.0, 4.0);
  vec2 cuv = luv * TSC + TPAD;
  vec2 lluv = luv * LSC + LPAD;
  vec4 c = base;
  float l = lights;
  float f = 0.0;
  if (uTile[0].z > 0.0 && col == uTile[0].x && row == uTile[0].y){ c = textureGrad(tTileC0, cuv, tgx * TSC, tgy * TSC); l = textureGrad(tTileL0, lluv, tgx * LSC, tgy * LSC).r; f = uTile[0].z; }
  else if (uTile[1].z > 0.0 && col == uTile[1].x && row == uTile[1].y){ c = textureGrad(tTileC1, cuv, tgx * TSC, tgy * TSC); l = textureGrad(tTileL1, lluv, tgx * LSC, tgy * LSC).r; f = uTile[1].z; }
  else if (uTile[2].z > 0.0 && col == uTile[2].x && row == uTile[2].y){ c = textureGrad(tTileC2, cuv, tgx * TSC, tgy * TSC); l = textureGrad(tTileL2, lluv, tgx * LSC, tgy * LSC).r; f = uTile[2].z; }
  else if (uTile[3].z > 0.0 && col == uTile[3].x && row == uTile[3].y){ c = textureGrad(tTileC3, cuv, tgx * TSC, tgy * TSC); l = textureGrad(tTileL3, lluv, tgx * LSC, tgy * LSC).r; f = uTile[3].z; }
  lights = mix(lights, l, f);
  return mix(base, c, f);
}
`;

function makeTex(bmp, srgb) {
  const t = new THREE.Texture(bmp);
  t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export class EarthTiles {
  constructor() {
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    black.needsUpdate = true;
    this.slots = [0, 1, 2, 3].map(() => ({ key: null, col: -1, row: -1, c: black, l: black, fade: 0, loading: false }));
    this.black = black;
    this.uniforms = {
      tTileC0: { value: black }, tTileC1: { value: black }, tTileC2: { value: black }, tTileC3: { value: black },
      tTileL0: { value: black }, tTileL1: { value: black }, tTileL2: { value: black }, tTileL3: { value: black },
      uTile: { value: [new THREE.Vector4(-9, -9, 0, 0), new THREE.Vector4(-9, -9, 0, 0), new THREE.Vector4(-9, -9, 0, 0), new THREE.Vector4(-9, -9, 0, 0)] },
    };
    this.wanted = [];
    this.renderer = null;
  }

  /** lat/lon (radians) of the camera sub-point */
  update(lat, lon, dt, alt) {
    if (alt > 3.0e7) return; // far away: global texture is enough
    const u = (lon / (2 * Math.PI) + 0.5) * 8;
    const v = (0.5 - lat / Math.PI) * 4;
    // 2x2 block whose centre is the tile corner nearest to the sub-point
    const c0 = Math.round(u) - 1;
    let r0 = Math.round(v) - 1;
    r0 = Math.max(0, Math.min(2, r0));
    const want = [];
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const col = ((c0 + i) % 8 + 8) % 8, row = r0 + j;
      want.push({ col, row, key: col + '_' + row });
    }
    // keep slots already holding wanted tiles
    const free = [];
    for (const s of this.slots) if (!want.some((w) => w.key === s.key)) free.push(s);
    for (const w of want) {
      if (this.slots.some((s) => s.key === w.key)) continue;
      const s = free.shift();
      if (!s || s.loading) continue;
      this._load(s, w);
    }
    // fades
    this.slots.forEach((s, i) => {
      if (s.key && !s.loading) s.fade = Math.min(1, s.fade + dt * 1.2);
      const U = this.uniforms.uTile.value[i];
      U.set(s.col, s.row, s.key && !s.loading ? Math.max(0.0001, s.fade) : 0, 0);
      this.uniforms['tTileC' + i].value = s.c;
      this.uniforms['tTileL' + i].value = s.l;
    });
  }

  async _load(slot, w) {
    slot.loading = true;
    slot.fade = 0;
    const oldC = slot.c, oldL = slot.l;
    slot.key = w.key; slot.col = w.col; slot.row = w.row;
    try {
      const [cb, lb] = await Promise.all([
        fetch(assetUrl(`earth/tiles/c_${w.col}_${w.row}.webp`)).then((r) => r.blob()).then((b) => createImageBitmap(b, { imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' })),
        fetch(assetUrl(`earth/tiles/l_${w.col}_${w.row}.jpg`)).then((r) => r.blob()).then((b) => createImageBitmap(b, { imageOrientation: 'flipY', colorSpaceConversion: 'none' })),
      ]);
      if (slot.key !== w.key) { cb.close(); lb.close(); return; }
      slot.c = makeTex(cb, true);
      slot.l = makeTex(lb, false);
      if (this.renderer) { this.renderer.initTexture(slot.c); this.renderer.initTexture(slot.l); }
    } catch (e) {
      console.warn('tile load failed', w.key, e);
      slot.key = null;
    }
    if (oldC !== this.black) oldC.dispose();
    if (oldL !== this.black) oldL.dispose();
    slot.loading = false;
  }
}
