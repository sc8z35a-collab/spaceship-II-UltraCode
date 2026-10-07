// H8's materials: worn graphite armour with per-plate tints, scratches, micro-impact pits, grime
// and heat staining (triplanar in H8's own frame, so the detail stays put while H8 flies), B-29's
// orange as trim, coated camera optics, a plasma drive whose coils and throat glow with the
// thrust, stencilled markings.
import * as THREE from 'three';

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

function rnd(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** wear map: R height (pits, scratches cut in), G albedo (grime, stains), B roughness, A bare metal */
function wearTexture() {
  const R = rnd(808);
  const N = 1024;
  const c = canvas(N, N, (g) => {
    g.fillStyle = 'rgb(128,150,128)'; g.fillRect(0, 0, N, N);
    // soft stains and grime blotches (G down, B up)
    for (let i = 0; i < 260; i++) {
      const x = R() * N, y = R() * N, r = 20 + R() * 120;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const v = Math.floor(90 + R() * 70), b = Math.floor(120 + R() * 90);
      gr.addColorStop(0, `rgba(128,${v},${b},${0.18 + R() * 0.25})`); gr.addColorStop(1, 'rgba(128,150,128,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // streaks (down-run of outgassing / thruster residue)
    for (let i = 0; i < 70; i++) {
      const x = R() * N, y = R() * N, L = 60 + R() * 260, w = 2 + R() * 7;
      const gr = g.createLinearGradient(x, y, x, y + L);
      gr.addColorStop(0, 'rgba(128,95,160,0.35)'); gr.addColorStop(1, 'rgba(128,150,128,0)');
      g.fillStyle = gr; g.fillRect(x, y, w, L);
    }
    // micro-impact pits: dark centre, raised bright rim
    for (let i = 0; i < 1500; i++) {
      const x = R() * N, y = R() * N, r = 0.8 + Math.pow(R(), 3) * 6;
      g.fillStyle = `rgba(40,100,190,0.9)`; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = `rgba(200,170,110,0.6)`; g.lineWidth = Math.max(0.6, r * 0.35); g.beginPath(); g.arc(x, y, r * 1.25, 0, Math.PI * 2); g.stroke();
    }
    // scratches: thin cuts through the paint to bare metal (alpha marks bare)
    for (let i = 0; i < 420; i++) {
      const x = R() * N, y = R() * N, a = R() * Math.PI, L = 10 + Math.pow(R(), 2) * 180;
      g.strokeStyle = `rgba(70,175,80,${0.5 + R() * 0.5})`; g.lineWidth = 0.6 + R() * 1.6;
      g.beginPath(); g.moveTo(x, y);
      let px = x, py = y, aa = a;
      for (let k = 0; k < 6; k++) { aa += (R() - 0.5) * 0.15; px += Math.cos(aa) * L / 6; py += Math.sin(aa) * L / 6; g.lineTo(px, py); }
      g.stroke();
    }
  });
  // bare-metal mask in alpha: where the scratches went (red channel low)
  const ctx = c.getContext('2d');
  const img = ctx.getImageData(0, 0, N, N), d = img.data;
  for (let i = 0; i < d.length; i += 4) d[i + 3] = d[i] < 90 && d[i + 1] > 160 ? 255 : Math.max(0, 255 - (255 - d[i + 3]) - 200);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

let WEAR = null;
const H8_UNIFORMS = {
  uDrive: { value: 0 },        // drive output 0..1 (coils / throat glow)
  uTime: { value: 0 },
};

/**
 * Armour-type material: triplanar wear in H8's frame + heat staining round the stern and the
 * thrusters. opts: { wear, rough, heatStain, bareTint }
 */
function wearMat(base, opts = {}) {
  if (!WEAR) WEAR = wearTexture();
  const o = Object.assign({ wear: 1, heatStain: 1, scale: 1 / 1.7, bare: 0.65 }, opts);
  base.onBeforeCompile = (sh) => {
    sh.uniforms.tWear = { value: WEAR };
    sh.uniforms.uDrive = H8_UNIFORMS.uDrive;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLP; varying vec3 vLN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 _lp = vec4(position, 1.0);
        vec3 _ln = normal;
        #ifdef USE_INSTANCING
          _lp = instanceMatrix * _lp; _ln = mat3(instanceMatrix) * _ln;
        #endif
        vLP = _lp.xyz; vLN = normalize(_ln);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tWear; uniform float uDrive;
        varying vec3 vLP; varying vec3 vLN;
        vec4 tri(vec3 p, vec3 n){
          vec3 w = abs(n); w = w * w * w; w /= (w.x + w.y + w.z + 1e-5);
          return texture2D(tWear, p.zy) * w.x + texture2D(tWear, p.xz) * w.y + texture2D(tWear, p.xy) * w.z;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec4 _W = tri(vLP * ${o.scale.toFixed(4)}, vLN);
        vec4 _W2 = tri(vLP * ${(o.scale * 3.7).toFixed(4)} + 0.37, vLN);
        float _grime = (0.62 + 0.38 * (_W.g / 0.59)) * (0.85 + 0.15 * (_W2.g / 0.59));
        diffuseColor.rgb *= mix(1.0, clamp(_grime, 0.55, 1.15), ${o.wear.toFixed(3)});
        // heat staining: straw -> blue -> brown toward the stern (the drive) and round the nozzles
        float _aft = smoothstep(1.4, 3.6, vLP.z) * ${o.heatStain.toFixed(3)};
        vec3 _heat = mix(vec3(0.95, 0.78, 0.5), vec3(0.42, 0.45, 0.75), smoothstep(2.2, 3.4, vLP.z));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * _heat * 0.8, _aft * 0.55);
        // bare metal where the paint is scratched through
        float _bare = smoothstep(0.5, 1.0, max(_W.a, _W2.a * 0.8)) * ${o.bare.toFixed(3)} * ${o.wear.toFixed(3)};
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.62, 0.64), _bare);
        float _wearH = (_W.r - 0.5) * 0.003 + (_W2.r - 0.5) * 0.0012;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 dH = vec2(dFdx(_wearH), dFdy(_wearH));
          dH *= 1.0 - 0.8 * smoothstep(0.004, 0.012, length(fwidth(vLP)));
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1) * faceDirection;
          vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
          if (abs(det) > 1e-12) normal = normalize(abs(det) * normal - grad);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (_W.b - 0.5) * 0.35 * ${o.wear.toFixed(3)} - _bare * 0.3, 0.05, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.85, _bare);`);
  };
  base.customProgramCacheKey = () => 'h8wear' + JSON.stringify(o) + (base.vertexColors ? 'vc' : '');
  return base;
}

/** stencilled markings sheet: cells in a 4 x 4 grid (key -> cell) */
const DECALS = {
  H8: 0, HX08: 1, cam1: 2, cam2: 3, cam3: 4, cam4: 5, hv: 6, exhaust: 7, rad: 8, dock: 9, nostep: 10, rescue: 11, hachi: 12, arrow: 13, fuel: 14, warn: 15,
};

function decalTexture() {
  const S = 256, N = 4;
  const c = canvas(S * N, S * N, (g) => {
    g.clearRect(0, 0, S * N, S * N);
    const cell = (k, fn) => { const x = (k % N) * S, y = Math.floor(k / N) * S; g.save(); g.translate(x, y); fn(); g.restore(); };
    const txt = (t, size, y = S / 2, col = 'rgba(236,236,226,0.92)', font = 'bold') => { g.fillStyle = col; g.font = `${font} ${size}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, S / 2, y); };
    cell(DECALS.H8, () => { txt('H8', 190, S / 2 + 10); });
    cell(DECALS.HX08, () => { txt('HX-08', 64, S * 0.38); txt('SUB-BASE  KAITO', 24, S * 0.66, 'rgba(236,236,226,0.75)'); });
    for (const k of [1, 2, 3, 4]) cell(DECALS['cam' + k], () => { g.strokeStyle = 'rgba(236,236,226,0.85)'; g.lineWidth = 8; g.strokeRect(24, 70, S - 48, S - 140); txt('CAM-' + k, 70); });
    cell(DECALS.hv, () => {
      g.fillStyle = 'rgba(232,180,20,0.95)'; g.beginPath(); g.moveTo(S / 2, 18); g.lineTo(S - 18, S - 40); g.lineTo(18, S - 40); g.closePath(); g.fill();
      g.fillStyle = '#111'; g.beginPath(); g.moveTo(S / 2 + 10, 70); g.lineTo(S / 2 - 30, 150); g.lineTo(S / 2, 150); g.lineTo(S / 2 - 18, 205); g.lineTo(S / 2 + 34, 125); g.lineTo(S / 2 + 4, 125); g.closePath(); g.fill();
      txt('高電圧', 26, S - 18, 'rgba(236,236,226,0.95)');
    });
    cell(DECALS.exhaust, () => { g.fillStyle = 'rgba(200,40,30,0.92)'; g.fillRect(10, 70, S - 20, 116); txt('噴射注意', 46, S / 2 - 12, '#fff'); txt('EXHAUST HAZARD', 24, S / 2 + 34, '#fff'); });
    cell(DECALS.rad, () => {
      g.fillStyle = 'rgba(232,190,20,0.95)'; g.beginPath(); g.arc(S / 2, S / 2, 112, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111';
      for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3 - Math.PI / 2; g.beginPath(); g.moveTo(S / 2, S / 2); g.arc(S / 2, S / 2, 96, a - 0.52, a + 0.52); g.closePath(); g.fill(); }
      g.fillStyle = 'rgba(232,190,20,1)'; g.beginPath(); g.arc(S / 2, S / 2, 26, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111'; g.beginPath(); g.arc(S / 2, S / 2, 16, 0, Math.PI * 2); g.fill();
    });
    cell(DECALS.dock, () => { g.strokeStyle = 'rgba(236,236,226,0.9)'; g.lineWidth = 10; g.beginPath(); g.moveTo(S / 2, 20); g.lineTo(S / 2, S - 20); g.moveTo(20, S / 2); g.lineTo(S - 20, S / 2); g.stroke(); g.beginPath(); g.arc(S / 2, S / 2, 70, 0, Math.PI * 2); g.stroke(); });
    cell(DECALS.nostep, () => { txt('NO STEP', 52, S / 2 - 18); txt('踏むな', 40, S / 2 + 34); });
    cell(DECALS.rescue, () => { g.fillStyle = 'rgba(220,90,20,0.95)'; g.fillRect(16, 60, S - 32, 136); txt('RESCUE', 46, S / 2 - 18, '#fff'); txt('救出ハンドル', 30, S / 2 + 30, '#fff'); });
    cell(DECALS.hachi, () => { txt('八', 200, S / 2 + 8, 'rgba(236,236,226,0.9)', 'normal'); });
    cell(DECALS.arrow, () => { g.fillStyle = 'rgba(236,236,226,0.9)'; g.beginPath(); g.moveTo(S / 2, 24); g.lineTo(S - 40, S / 2); g.lineTo(S / 2 + 34, S / 2); g.lineTo(S / 2 + 34, S - 24); g.lineTo(S / 2 - 34, S - 24); g.lineTo(S / 2 - 34, S / 2); g.lineTo(40, S / 2); g.closePath(); g.fill(); });
    cell(DECALS.fuel, () => { txt('推進剤', 52, S / 2 - 20); txt('XENON / LH2', 28, S / 2 + 30); });
    cell(DECALS.warn, () => {
      for (let i = -S; i < S * 2; i += 44) { g.fillStyle = 'rgba(232,190,20,0.95)'; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 22, 0); g.lineTo(i + 22 - S, S); g.lineTo(i - S, S); g.closePath(); g.fill(); }
    });
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** uv rectangle of a decal cell (for PlaneGeometry uv remapping) */
export function decalUV(key) {
  const k = DECALS[key], N = 4;
  const x = (k % N) / N, y = 1 - (Math.floor(k / N) + 1) / N;
  return [x, y, 1 / N, 1 / N];
}

export function createH8Materials() {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const P = (o) => new THREE.MeshPhysicalMaterial(o);
  const M = {};
  // painted armour: mostly diffuse (a glossy metal sphere mirrored black space on its shaded side)
  M.armor = wearMat(S({ color: 0xffffff, vertexColors: true, roughness: 0.72, metalness: 0.06 }));
  M.armorPlain = wearMat(S({ color: 0x6a6f76, roughness: 0.68, metalness: 0.12 }));
  M.substrate = S({ color: 0x2a2d31, roughness: 0.85, metalness: 0.1 });
  M.trim = wearMat(S({ color: 0xd2691e, roughness: 0.55, metalness: 0.12 }), { bare: 0.8 });
  M.metal = wearMat(S({ color: 0x8a8f96, roughness: 0.42, metalness: 0.78 }), { wear: 0.6 });
  M.metalDark = wearMat(S({ color: 0x3a3e45, roughness: 0.55, metalness: 0.45 }), { wear: 0.7 });
  M.steel = S({ color: 0xb9bec4, roughness: 0.3, metalness: 0.9 });
  M.bolt = S({ color: 0x6d7279, roughness: 0.38, metalness: 0.85 });
  M.mli = S({ color: 0xd8b46a, roughness: 0.35, metalness: 0.9 });
  M.mliSilver = S({ color: 0xcfd3d8, roughness: 0.3, metalness: 0.95 });
  M.ceramic = wearMat(S({ color: 0xd9d6cf, roughness: 0.82, metalness: 0.02 }), { bare: 0.0 });
  M.nozzle = wearMat(S({ color: 0x3b3a3c, roughness: 0.4, metalness: 0.85 }), { heatStain: 1.4, bare: 0.2 });
  M.coil = S({ color: 0xc08a45, roughness: 0.3, metalness: 0.95, emissive: new THREE.Color(0.35, 0.55, 1.0), emissiveIntensity: 0 });
  M.throat = S({ color: 0x000000, emissive: new THREE.Color(0.55, 0.75, 1.0), emissiveIntensity: 0 });
  M.lens = P({ color: 0x050608, roughness: 0.04, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 420] });
  M.lensRing = S({ color: 0x0c0d0f, roughness: 0.5, metalness: 0.4 });
  M.dome = P({ color: 0xdfe6ee, roughness: 0.12, metalness: 0.0, transmission: 0.0, transparent: true, opacity: 0.55, clearcoat: 1 });
  M.radarDish = S({ color: 0xe8e8e2, roughness: 0.5, metalness: 0.2 });
  M.rubber = S({ color: 0x141414, roughness: 0.9, metalness: 0 });
  M.cable = S({ color: 0x1b1c1e, roughness: 0.65, metalness: 0.1 });
  M.cableOrange = S({ color: 0xd06a1a, roughness: 0.6, metalness: 0.05 });
  M.cableRed = S({ color: 0x9e1f18, roughness: 0.6, metalness: 0.05 });
  M.handrail = S({ color: 0xe0b81e, roughness: 0.45, metalness: 0.3 });
  M.radiator = S({ color: 0xeaeae4, roughness: 0.4, metalness: 0.05, emissive: new THREE.Color(1.0, 0.32, 0.08), emissiveIntensity: 0 });
  M.solar = S({ color: 0x1b2a55, roughness: 0.25, metalness: 0.6 });
  M.ledG = S({ color: 0x000000, emissive: new THREE.Color(0.2, 1, 0.35), emissiveIntensity: 3 });
  M.ledR = S({ color: 0x000000, emissive: new THREE.Color(1, 0.1, 0.05), emissiveIntensity: 3 });
  M.ledA = S({ color: 0x000000, emissive: new THREE.Color(1, 0.6, 0.1), emissiveIntensity: 3 });
  M.ledB = S({ color: 0x000000, emissive: new THREE.Color(0.25, 0.6, 1.0), emissiveIntensity: 3 });
  M.navR = S({ color: 0x000000, emissive: new THREE.Color(1, 0.06, 0.03), emissiveIntensity: 6 });
  M.navG = S({ color: 0x000000, emissive: new THREE.Color(0.08, 1, 0.22), emissiveIntensity: 6 });
  M.strobe = S({ color: 0x000000, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 });
  M.flood = S({ color: 0x000000, emissive: new THREE.Color(0.95, 0.97, 1), emissiveIntensity: 4 });
  M.decal = S({ map: decalTexture(), transparent: true, roughness: 0.6, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return M;
}

export { H8_UNIFORMS, wearMat };
