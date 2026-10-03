// Loads Earth textures (GPU) and global elevation / water arrays (CPU, for terrain + collisions).
import * as THREE from 'three';
import { DATA_W, DATA_H } from './terrainFn.js';

export function assetUrl(rel) {
  // In dev (vite) and in production the public folder is served from the site root.
  return (import.meta.env && import.meta.env.BASE_URL ? import.meta.env.BASE_URL : './') + 'assets/' + rel;
}

async function fetchBitmap(url, flip) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('fetch failed ' + url);
  const blob = await res.blob();
  return createImageBitmap(blob, { imageOrientation: flip ? 'flipY' : 'from-image', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

function bitmapChannel(bmp, ch = 0) {
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
  const out = new Uint8Array(bmp.width * bmp.height);
  for (let i = 0, j = ch; i < out.length; i++, j += 4) out[i] = d[j];
  return out;
}

function texFromBitmap(bmp, srgb) {
  const t = new THREE.Texture(bmp);
  t.flipY = false; // bitmap was flipped at decode time
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export async function loadEarthAssets(renderer, onProgress) {
  const colorUrl = assetUrl('earth/color_4k.webp');
  let done = 0;
  const total = 6;
  const tick = () => { done++; onProgress && onProgress(done / total); };
  const [colorBmp, elevBmpF, lightsBmp, cloudsBmp, elevBmp, waterBmp] = await Promise.all([
    fetchBitmap(colorUrl, true).then((b) => { tick(); return b; }),
    fetchBitmap(assetUrl('earth/elev_4k.png'), true).then((b) => { tick(); return b; }),
    fetchBitmap(assetUrl('earth/lights_4k.jpg'), true).then((b) => { tick(); return b; }),
    fetchBitmap(assetUrl('earth/clouds_4k.jpg'), true).then((b) => { tick(); return b; }),
    fetchBitmap(assetUrl('earth/elev_4k.png'), false).then((b) => { tick(); return b; }),
    fetchBitmap(assetUrl('earth/water_4k.png'), false).then((b) => { tick(); return b; }),
  ]);
  const color = texFromBitmap(colorBmp, true);
  const elevArr = bitmapChannel(elevBmp, 0);
  const waterArr = bitmapChannel(waterBmp, 0);
  elevBmp.close && elevBmp.close();
  waterBmp.close && waterBmp.close();

  // Pack elevation / lights / clouds into one RGBA texture on the GPU.
  const tE = texFromBitmap(elevBmpF, false), tL = texFromBitmap(lightsBmp, false), tC = texFromBitmap(cloudsBmp, false);
  [tE, tL, tC].forEach((t) => { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; });
  const rt = new THREE.WebGLRenderTarget(DATA_W, DATA_H, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, anisotropy: 4,
  });
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { tE: { value: tE }, tL: { value: tL }, tC: { value: tC } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tE, tL, tC; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tE, vUv).r, texture2D(tL, vUv).r, texture2D(tC, vUv).r, 1.0); }',
    depthTest: false, depthWrite: false,
  }));
  scene.add(quad);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose(); quad.material.dispose();
  tE.dispose(); tL.dispose(); tC.dispose();
  elevBmpF.close && elevBmpF.close(); lightsBmp.close && lightsBmp.close(); cloudsBmp.close && cloudsBmp.close();
  rt.texture.colorSpace = THREE.NoColorSpace;
  return { color, data: rt.texture, dataRT: rt, elevArr, waterArr };
}
