// The grand lobby of a hub station, walkable once B-29 is docked. It is built in ship-local
// coordinates (exactly as it sits next to the docked ship): a docking tunnel from the airlock's
// outer hatch into a long atrium module — marble floor with a glass oval looking straight down at
// the Earth, panoramic windows toward the station, skylights, a chandelier over a turning Earth
// globe, a lounge facing the big forward window, a bar with back-lit bottles and a reception desk
// under the station's name.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Builder, rng } from '../ship/geom.js';
import { OPENINGS } from '../ship/hullShape.js';
import { openingOutline } from '../ship/exterior.js';
import { loft, roundPolygon } from '../ship/sweep.js';
import { LAYER_NEAR } from '../core/layers.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const HATCH = OPENINGS.find((o) => o.kind === 'hatch');

/** atrium cylinder (axis along ship z) and docking tunnel, ship-local metres */
export const LOBBY = { xc: 11.0, yc: 2.25, R: 6.3, z0: -12.0, z1: 8.0, floorY: 0.25 };
export const TUNNEL = { x0: 3.35, xEnd: 5.2, zc: HATCH.center.z, yc: 1.22, hu: 1.0, hv: 0.78, r: 0.45 };
const D2R = Math.PI / 180;
const TH_FLOOR = Math.asin((LOBBY.floorY - LOBBY.yc) / LOBBY.R);       // right-hand floor line (rad)

// ------------------------------------------------------------------ textures
function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function marbleTex(dark, seed) {
  const R = rng(seed);
  return canvasTex(1024, 1024, (g, s) => {
    g.fillStyle = dark ? '#141519' : '#ece7de'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 520; i++) {
      const x = R() * s, y = R() * s, r = 20 + R() * 140;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, dark ? `rgba(70,72,84,${0.06 * R()})` : `rgba(190,178,162,${0.07 * R()})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    for (let v = 0; v < 18; v++) {
      let x = R() * s, y = R() * s, a = R() * Math.PI * 2;
      const w = 0.5 + R() * 2.4;
      g.strokeStyle = dark ? `rgba(214,178,104,${0.25 + 0.4 * R()})` : `rgba(118,110,102,${0.16 + 0.32 * R()})`;
      g.lineWidth = w;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 140; k++) { a += (R() - 0.5) * 0.55; x += Math.cos(a) * 7; y += Math.sin(a) * 7; g.lineTo(x, y); }
      g.stroke();
      // feathered side veins
      g.lineWidth = w * 0.35;
      g.stroke();
    }
    // 2 x 2 tiles with fine grout (the texture edges are grout lines, so tiling never shows)
    g.strokeStyle = dark ? 'rgba(196,160,90,0.85)' : 'rgba(140,132,124,0.7)';
    g.lineWidth = 4;
    for (const p of [0, s / 2, s]) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, s); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(s, p); g.stroke(); }
  }, { repeat: [0.5, 0.5] });
}

function woodTex(seed) {
  const R = rng(seed);
  return canvasTex(512, 1024, (g, w, h) => {
    g.fillStyle = '#4a2c18'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const x = R() * w, a = 0.05 + R() * 0.16, ww = 0.6 + R() * 3.5;
      g.fillStyle = R() > 0.5 ? `rgba(120,74,40,${a})` : `rgba(30,16,8,${a})`;
      const wob = (R() - 0.5) * 12;
      g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + wob, h * 0.33, x - wob, h * 0.66, x + wob * 0.5, h); g.lineTo(x + wob * 0.5 + ww, h); g.bezierCurveTo(x - wob + ww, h * 0.66, x + wob + ww, h * 0.33, x + ww, 0); g.fill();
    }
    for (let k = 0; k < 7; k++) {
      const x = R() * w, y = R() * h;
      for (let r = 26; r > 2; r -= 3) { g.strokeStyle = `rgba(40,20,8,${0.12 + 0.02 * (26 - r) / 3})`; g.lineWidth = 1.2; g.beginPath(); g.ellipse(x, y, r * 0.45, r * 1.6, 0, 0, Math.PI * 2); g.stroke(); }
    }
    g.fillStyle = 'rgba(15,8,4,0.85)';
    for (const x of [0, w / 2]) g.fillRect(x, 0, 2, h);       // plank joints
    for (let k = 0; k < 4; k++) g.fillRect(0, (k / 4) * h + (k % 2) * 60, w / 2, 2);
  }, { repeat: [1, 1] });
}

function fabricTex(seed) {
  const R = rng(seed);
  return canvasTex(512, 512, (g, s) => {
    g.fillStyle = '#efe7d6'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) { g.fillStyle = `rgba(150,130,100,${0.035 + 0.03 * R()})`; g.fillRect(0, y, s, 1); }
    for (let x = 0; x < s; x += 2) { g.fillStyle = `rgba(255,255,255,${0.03 + 0.03 * R()})`; g.fillRect(x, 0, 1, s); }
    // quilted panels with stitch lines
    g.strokeStyle = 'rgba(120,100,70,0.35)'; g.lineWidth = 2; g.setLineDash([6, 5]);
    for (const p of [0, s / 2]) { g.beginPath(); g.moveTo(p + 1, 0); g.lineTo(p + 1, s); g.stroke(); g.beginPath(); g.moveTo(0, p + 1); g.lineTo(s, p + 1); g.stroke(); }
    g.setLineDash([]);
    for (const p of [0, s / 2]) for (const q of [0, s / 2]) { const gr = g.createRadialGradient(p + s / 4, q + s / 4, 10, p + s / 4, q + s / 4, s / 3); gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(90,70,40,0.10)'); g.fillStyle = gr; g.fillRect(p, q, s / 2, s / 2); }
  }, { repeat: [1.6, 1.6] });
}

function carpetTex() {
  return canvasTex(512, 512, (g, s) => {
    g.fillStyle = '#123a44'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`; g.fillRect(Math.random() * s, Math.random() * s, 1, 1); }
    g.strokeStyle = '#c9a25a'; g.lineWidth = 3;
    const c = s / 4;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const x = i * c + c / 2, y = j * c + c / 2;
      g.beginPath(); g.moveTo(x, y - c * 0.38); g.lineTo(x + c * 0.38, y); g.lineTo(x, y + c * 0.38); g.lineTo(x - c * 0.38, y); g.closePath(); g.stroke();
      g.beginPath(); g.arc(x, y, c * 0.12, 0, Math.PI * 2); g.stroke();
    }
    g.strokeStyle = 'rgba(201,162,90,0.5)'; g.lineWidth = 1.5;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * c, 0); g.lineTo(i * c, s); g.stroke(); g.beginPath(); g.moveTo(0, i * c); g.lineTo(s, i * c); g.stroke(); }
  }, { repeat: [1, 1] });
}

function signTex(en, jp) {
  return canvasTex(2048, 512, (g, w, h) => {
    g.fillStyle = '#07080a'; g.fillRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#9c7a3c'); gr.addColorStop(0.5, '#ffe2a0'); gr.addColorStop(1, '#9c7a3c');
    g.fillStyle = gr;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '300 150px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText(en.split('').join(String.fromCharCode(8202)), w / 2, h * 0.38);
    g.font = '500 92px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';
    g.fillText(jp, w / 2, h * 0.76);
    g.fillRect(w * 0.18, h * 0.6, w * 0.64, 3);
  }, { repeat: [1, 1] });
}

function screenTex(name) {
  return canvasTex(1024, 576, (g, w, h) => {
    g.fillStyle = '#04121e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#5fd0ff'; g.font = '600 44px sans-serif'; g.textBaseline = 'top';
    g.fillText(name + '  DEPARTURES / 発着案内', 36, 28);
    g.fillStyle = 'rgba(95,208,255,0.35)'; g.fillRect(36, 92, w - 72, 3);
    const rows = [['08:40', 'TSUKUYOMI DOCK', '月軌道 修理基地', 'BOARDING'], ['09:15', 'AMATERASU GEO', '静止港', 'ON TIME'], ['09:50', 'MIHASHIRA', '天の御柱 低軌道', 'ON TIME'], ['10:30', 'KAGUYA RELAY', 'カグヤ中継基地', 'DELAYED'], ['11:05', 'EARTH PORT', '赤道 海上港', 'ON TIME']];
    rows.forEach((r, i) => {
      const y = 120 + i * 84;
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)'; g.fillRect(36, y - 8, w - 72, 74);
      g.font = '500 38px monospace'; g.fillStyle = '#ffd08a'; g.fillText(r[0], 52, y + 8);
      g.font = '600 34px sans-serif'; g.fillStyle = '#e6f4ff'; g.fillText(r[1], 220, y);
      g.font = '400 26px sans-serif'; g.fillStyle = '#8fb6cc'; g.fillText(r[2], 220, y + 38);
      g.font = '700 30px sans-serif'; g.fillStyle = r[3] === 'DELAYED' ? '#ff6a5a' : r[3] === 'BOARDING' ? '#ffd08a' : '#5fe08f'; g.textAlign = 'right'; g.fillText(r[3], w - 56, y + 10); g.textAlign = 'left';
    });
  }, { repeat: [1, 1] });
}

function bottlesTex(seed) {
  const R = rng(seed);
  return canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#120c08'; g.fillRect(0, 0, w, h);
    const glow = g.createLinearGradient(0, 0, 0, h);
    glow.addColorStop(0, 'rgba(255,190,110,0.15)'); glow.addColorStop(1, 'rgba(255,160,80,0.35)');
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 3; row++) {
      const base = (row + 1) * (h / 3) - 10;
      g.fillStyle = 'rgba(255,214,150,0.8)'; g.fillRect(0, base, w, 4);
      let x = 14;
      while (x < w - 30) {
        const bw = 22 + R() * 22, bh = 70 + R() * 70;
        const hue = [28, 40, 120, 200, 350, 45][Math.floor(R() * 6)];
        const bg = g.createLinearGradient(x, 0, x + bw, 0);
        bg.addColorStop(0, `hsla(${hue},70%,22%,0.95)`); bg.addColorStop(0.35, `hsla(${hue},80%,55%,0.95)`); bg.addColorStop(1, `hsla(${hue},70%,18%,0.95)`);
        g.fillStyle = bg;
        g.beginPath(); g.moveTo(x, base); g.lineTo(x, base - bh * 0.62); g.quadraticCurveTo(x, base - bh * 0.75, x + bw * 0.35, base - bh * 0.8); g.lineTo(x + bw * 0.35, base - bh); g.lineTo(x + bw * 0.65, base - bh); g.lineTo(x + bw * 0.65, base - bh * 0.8); g.quadraticCurveTo(x + bw, base - bh * 0.75, x + bw, base - bh * 0.62); g.lineTo(x + bw, base); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + bw * 0.2, base - bh * 0.6, 2, bh * 0.45);
        g.fillStyle = 'rgba(240,230,210,0.8)'; g.fillRect(x + 3, base - bh * 0.42, bw - 6, bh * 0.16);
        x += bw + 6 + R() * 8;
      }
    }
  }, { repeat: [1, 1] });
}

let ENV = null;
function envMap(renderer) {
  if (ENV || !renderer) return ENV;
  const pm = new THREE.PMREMGenerator(renderer);
  ENV = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  return ENV;
}

function luxMaterials(renderer, def) {
  const env = envMap(renderer);
  const P = (o) => new THREE.MeshPhysicalMaterial(Object.assign({ envMap: env, envMapIntensity: 0.55 }, o));
  const S = (o) => new THREE.MeshStandardMaterial(Object.assign({ envMap: env, envMapIntensity: 0.45 }, o));
  const E = (r, gg, b, i) => S({ color: 0x000000, emissive: new THREE.Color(r, gg, b), emissiveIntensity: i });
  const sign = signTex(def.en || 'STATION', def.name || '');
  const screen = screenTex(def.en || 'STATION');
  const bottles = bottlesTex(77);
  return {
    marble: P({ map: marbleTex(false, 11), roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05 }),
    marbleDark: P({ map: marbleTex(true, 12), roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.08 }),
    wood: P({ map: woodTex(21), roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.18 }),
    cream: S({ map: fabricTex(31), roughness: 0.92, side: THREE.DoubleSide }),
    ceiling: S({ color: 0xf6f1e8, roughness: 0.7, side: THREE.DoubleSide }),
    gold: S({ color: 0xe0b860, roughness: 0.2, metalness: 1.0, envMapIntensity: 1.0 }),
    brass: S({ color: 0xb8925a, roughness: 0.32, metalness: 1.0, envMapIntensity: 0.9 }),
    steel: S({ color: 0xcdd1d6, roughness: 0.22, metalness: 1.0, envMapIntensity: 0.9 }),
    carpet: S({ map: carpetTex(), roughness: 1.0 }),
    leather: P({ color: 0x5c3320, roughness: 0.48, clearcoat: 0.45, clearcoatRoughness: 0.35 }),
    leatherCream: P({ color: 0xe9ddc6, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
    velvet: S({ color: 0x1d4b58, roughness: 0.95 }),
    // near-black body: a window onto space must stay dark (only a faint reflective sheen)
    glass: P({ color: 0x0b1015, roughness: 0.02, transparent: true, opacity: 0.14, depthWrite: false, envMapIntensity: 1.0, side: THREE.DoubleSide }),
    glassFloor: P({ color: 0xbfe6ff, roughness: 0.03, transparent: true, opacity: 0.16, depthWrite: false, clearcoat: 1, envMapIntensity: 1.2 }),
    crystal: P({ color: 0xffffff, roughness: 0.0, transparent: true, opacity: 0.55, envMapIntensity: 2.0, clearcoat: 1 }),
    leaf: S({ color: 0x2e6a33, roughness: 0.65, side: THREE.DoubleSide }),
    leafLight: S({ color: 0x5b9a40, roughness: 0.65, side: THREE.DoubleSide }),
    trunk: S({ color: 0x5a4330, roughness: 0.9 }),
    soil: S({ color: 0x2a1d14, roughness: 1 }),
    ceramic: P({ color: 0xf2efe8, roughness: 0.18, clearcoat: 0.8 }),
    ceramicDark: P({ color: 0x23262b, roughness: 0.2, clearcoat: 0.8 }),
    black: S({ color: 0x0b0c0e, roughness: 0.25, metalness: 0.3 }),
    hullOut: S({ color: 0xe6e8ea, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide }),
    hullInner: S({ color: 0xd9d6cf, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide }),
    well: S({ color: 0x1b2129, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }),
    grate: S({ color: 0x8b9096, roughness: 0.4, metalness: 0.8 }),
    lampWarm: E(1.0, 0.8, 0.55, 3.4),
    lampSoft: E(1.0, 0.86, 0.7, 1.6),
    cove: E(1.0, 0.8, 0.55, 2.4),
    coveBlue: E(0.45, 0.75, 1.0, 2.0),
    led: E(0.85, 0.92, 1.0, 2.6),
    sign: S({ map: sign, emissiveMap: sign, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.7, color: 0x000000 }),
    screen: S({ map: screen, emissiveMap: screen, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.25, color: 0x000000 }),
    bottles: S({ map: bottles, emissiveMap: bottles, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.5, color: 0x101010 }),
  };
}

// ------------------------------------------------------------------ geometry helpers
const shellP = (th, z, r = LOBBY.R) => V(LOBBY.xc + r * Math.cos(th), LOBBY.yc + r * Math.sin(th), z);

/** grid over the cylinder (th0..th1, z0..z1), cells left out where skip(th, z) */
function shellGrid(th0, th1, nT, z0, z1, nZ, r, skip = null, keep = null) {
  const pos = [], uv = [];
  for (let i = 0; i < nT; i++) for (let j = 0; j < nZ; j++) {
    const ta = th0 + (th1 - th0) * (i / nT), tb = th0 + (th1 - th0) * ((i + 1) / nT);
    const za = z0 + (z1 - z0) * (j / nZ), zb = z0 + (z1 - z0) * ((j + 1) / nZ);
    const tm = (ta + tb) / 2, zm = (za + zb) / 2;
    if (skip && skip(tm, zm)) continue;
    if (keep && !keep(tm, zm)) continue;
    const A = shellP(ta, za, r), B = shellP(tb, za, r), C = shellP(tb, zb, r), D = shellP(ta, zb, r);
    pos.push(A.x, A.y, A.z, C.x, C.y, C.z, B.x, B.y, B.z, A.x, A.y, A.z, D.x, D.y, D.z, C.x, C.y, C.z);
    const ua = ta * r * 0.5, ub = tb * r * 0.5;
    uv.push(ua, za * 0.5, ub, zb * 0.5, ub, za * 0.5, ua, za * 0.5, ua, zb * 0.5, ub, zb * 0.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** rounded-rect ring in the plane x = const (u: vertical half size, v: half size along z) */
function tunnelRing(x, hu, hv, r, n = 48) {
  // same parametrisation as openingOutline: (u, v) corners walked counter-clockwise; the hatch's
  // u axis points down the hull, its v axis along +z
  const pts = [];
  const corners = [[hu - r, hv - r], [-(hu - r), hv - r], [-(hu - r), -(hv - r)], [hu - r, -(hv - r)]];
  for (let k = 0; k < 4; k++) {
    const [cu, cv] = corners[k];
    for (let s = 0; s < n / 4; s++) {
      const a = (k * Math.PI) / 2 + (s / (n / 4)) * (Math.PI / 2);
      const u = cu + Math.cos(a) * r, v = cv + Math.sin(a) * r;
      pts.push(V(x, TUNNEL.yc - u, TUNNEL.zc + v));
    }
  }
  return pts;
}

/** arch rib along the shell at z (rectangular section w x d, inside the shell) */
function archRib(b, z, th0, th1, w, d, key, r0 = LOBBY.R - 0.01) {
  const secs = [];
  const n = 72;
  for (let i = 0; i <= n; i++) {
    const th = th0 + (th1 - th0) * (i / n);
    secs.push([shellP(th, z - w / 2, r0), shellP(th, z + w / 2, r0), shellP(th, z + w / 2, r0 - d), shellP(th, z - w / 2, r0 - d)]);
  }
  b.add(loft(secs, { ring: true, caps: true }), key);
}

/** tube along the shell at angle th (z0..z1), radius rr, inset from the wall */
function shellRail(b, th, z0, z1, rr, key, inset = 0.06) {
  b.pipe(shellP(th, z0, LOBBY.R - inset), shellP(th, z1, LOBBY.R - inset), rr, key, 10);
}

function plantPalm(b, R, x, z, h = 2.2, y0 = LOBBY.floorY) {
  b.cyl(0.32, 0.24, 0.55, 'ceramicDark', [x, y0 + 0.275, z], null, 24);
  b.torus(0.31, 0.02, 'gold', [x, y0 + 0.55, z], [Math.PI / 2, 0, 0], 24);
  b.cyl(0.29, 0.29, 0.02, 'soil', [x, y0 + 0.52, z], null, 20);
  // trunk: stacked rings
  for (let k = 0; k < 8; k++) b.cyl(0.075 - k * 0.004, 0.085 - k * 0.004, h / 8, 'trunk', [x + Math.sin(k * 0.6) * 0.03, y0 + 0.55 + (k + 0.5) * h / 8, z], null, 10);
  const top = V(x, y0 + 0.55 + h, z);
  for (let f = 0; f < 11; f++) {
    const a = (f / 11) * Math.PI * 2 + R() * 0.3;
    const len = 0.9 + R() * 0.5, droop = 0.35 + R() * 0.3;
    // frond: a strip of leaflets bending down
    const pts = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(V(top.x + Math.cos(a) * len * t, top.y + 0.25 * t - droop * t * t, top.z + Math.sin(a) * len * t)); }
    b.tube(pts, 0.012, 'trunk', { radial: 5, seg: 12 });
    for (let i = 1; i <= 6; i++) {
      const t = i / 6, p = pts[i];
      for (const s of [-1, 1]) {
        const l = 0.32 * (1 - t * 0.6);
        b.push(p.toArray(), [0, -(a + s * 1.2), 0]);
        b.box(l, 0.004, 0.045, R() > 0.4 ? 'leaf' : 'leafLight', [l / 2, -l * 0.18, 0], [0, 0, -0.35], 0);
        b.pop();
      }
    }
  }
}

function plantBush(b, R, x, z, s = 1, y0 = LOBBY.floorY, pot = 'ceramic') {
  b.cyl(0.24 * s, 0.19 * s, 0.42 * s, pot, [x, y0 + 0.21 * s, z], null, 20);
  b.torus(0.235 * s, 0.015, 'gold', [x, y0 + 0.42 * s, z], [Math.PI / 2, 0, 0], 20);
  for (let k = 0; k < 14; k++) {
    const a = R() * Math.PI * 2, r = R() * 0.22 * s, h = 0.5 * s + R() * 0.45 * s;
    b.sphere(0.13 * s + R() * 0.09 * s, R() > 0.5 ? 'leaf' : 'leafLight', [x + Math.cos(a) * r, y0 + h, z + Math.sin(a) * r], 9, [1, 0.8 + R() * 0.4, 1]);
  }
}

function floorLamp(b, x, z, y0 = LOBBY.floorY) {
  b.cyl(0.2, 0.22, 0.03, 'brass', [x, y0 + 0.015, z], null, 24);
  b.cyl(0.015, 0.015, 1.5, 'brass', [x, y0 + 0.78, z], null, 8);
  b.cyl(0.2, 0.26, 0.32, 'lampSoft', [x, y0 + 1.62, z], null, 24, true);
  b.torus(0.26, 0.008, 'brass', [x, y0 + 1.46, z], [Math.PI / 2, 0, 0], 24);
  b.colCyl(0.15, 1.7, [x, y0 + 0.85, z]);
}

function sofaArc(b, cx, cz, r, a0, a1, key = 'leatherCream', y0 = LOBBY.floorY) {
  // curved sofa: segments around (cx, cz); seat faces the centre
  const n = Math.max(3, Math.round((a1 - a0) / 0.22));
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * ((i + 0.5) / n);
    const segL = r * (a1 - a0) / n + 0.02;
    const px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r;
    const rot = [0, -a + Math.PI / 2, 0];
    b.push([px, y0, pz], rot);
    b.box(segL, 0.36, 0.72, 'wood', [0, 0.18, 0], null, 0.03, 2);
    b.box(segL - 0.01, 0.16, 0.68, key, [0, 0.44, -0.02], null, 0.07, 3);
    b.box(segL - 0.01, 0.5, 0.2, key, [0, 0.66, 0.3], [-0.12, 0, 0], 0.08, 3);
    b.pop();
    b.colBox(segL, 0.6, 0.72, [px, y0 + 0.3, pz], rot);
  }
  // end arms
  for (const a of [a0, a1]) {
    const px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r;
    b.push([px, y0, pz], [0, -a + Math.PI / 2, 0]);
    b.box(0.16, 0.62, 0.78, key, [0, 0.31, 0.02], null, 0.07, 3);
    b.pop();
  }
}

function armchair(b, x, z, rotY, key = 'leather', y0 = LOBBY.floorY) {
  b.push([x, y0, z], [0, rotY, 0]);
  b.box(0.78, 0.3, 0.74, 'wood', [0, 0.17, 0], null, 0.04, 2);
  b.box(0.62, 0.16, 0.62, key, [0, 0.4, -0.02], null, 0.07, 3);
  b.box(0.78, 0.55, 0.18, key, [0, 0.66, 0.29], [-0.15, 0, 0], 0.08, 3);
  for (const s of [-1, 1]) b.box(0.14, 0.4, 0.72, key, [s * 0.34, 0.5, 0], null, 0.06, 3);
  for (const s of [-1, 1]) for (const t of [-1, 1]) b.cyl(0.02, 0.015, 0.06, 'brass', [s * 0.32, 0.03, t * 0.3], null, 8);
  b.pop();
  b.colBox(0.8, 0.95, 0.78, [x, y0 + 0.47, z], [0, rotY, 0]);
}

function roundTable(b, x, z, r, h = 0.42, top = 'marbleDark', y0 = LOBBY.floorY) {
  b.cyl(r, r, 0.04, top, [x, y0 + h, z], null, 40);
  b.torus(r, 0.012, 'gold', [x, y0 + h, z], [Math.PI / 2, 0, 0], 40);
  b.cyl(0.05, 0.08, h - 0.04, 'gold', [x, y0 + (h - 0.04) / 2, z], null, 16);
  b.cyl(r * 0.5, r * 0.55, 0.03, 'gold', [x, y0 + 0.015, z], null, 32);
  b.colCyl(r, h, [x, y0 + h / 2, z]);
}

function column(b, x, z, y0, y1) {
  b.cyl(0.24, 0.24, 0.12, 'marbleDark', [x, y0 + 0.06, z], null, 32);
  b.torus(0.21, 0.025, 'gold', [x, y0 + 0.13, z], [Math.PI / 2, 0, 0], 32);
  b.cyl(0.17, 0.17, y1 - y0 - 0.5, 'marble', [x, (y0 + y1) / 2, z], null, 32);
  for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; b.box(0.012, y1 - y0 - 0.6, 0.02, 'marble', [x + Math.cos(a) * 0.172, (y0 + y1) / 2, z + Math.sin(a) * 0.172], [0, -a, 0], 0); }
  b.torus(0.21, 0.025, 'gold', [x, y1 - 0.32, z], [Math.PI / 2, 0, 0], 32);
  b.cyl(0.32, 0.2, 0.3, 'gold', [x, y1 - 0.15, z], null, 32);
  b.colCyl(0.24, y1 - y0, [x, (y0 + y1) / 2, z]);
}

// ------------------------------------------------------------------ the lobby
/**
 * def: station definition ({ id, name, en, gravity }) — names go on the signs.
 * returns { group, colliders, lamps, globe, contains(p) } in ship-local coordinates.
 */
export function buildLobby(renderer, def) {
  const M = luxMaterials(renderer, def);
  const b = new Builder();
  const R = rng(4242);
  const { xc, yc, R: RR, z0, z1, floorY } = LOBBY;
  const thL = Math.PI - TH_FLOOR;                    // left-hand floor line (> PI)
  const lamps = [];
  const lamp = (x, y, z, color, intensity, range = 9) => lamps.push({ pos: V(x, y, z), color, intensity, range, room: 'station' });

  // ---- windows (angles from the +x axis toward +y, z ranges)
  const WIN_R = { th: [-6 * D2R, 28 * D2R], z: [[-10.9, -6.9], [-6.3, -2.3], [-1.7, 2.3], [2.9, 6.9]] };       // toward the station core
  const WIN_SKY = { th: [76 * D2R, 104 * D2R], z: [[-10.4, -6.8], [-4.4, -0.4], [2.0, 5.6]] };              // skylights
  const WIN_L = { th: [151 * D2R, 171 * D2R], z: [[-10.8, -6.2], [3.0, 7.0]] };                             // toward the ship
  const WIN_B = { th: [253 * D2R, 287 * D2R], z: [[-6.9, -2.3]] };                                          // under the glass floor
  const inWin = (W, th, z) => th > W.th[0] && th < W.th[1] && W.z.some(([a, c]) => z > a && z < c);
  const tunnelHole = (th, z) => z > TUNNEL.zc - TUNNEL.hv - 0.05 && z < TUNNEL.zc + TUNNEL.hv + 0.05 && th > 175 * D2R && th < thL + 0.01;
  const skipUpper = (th, z) => inWin(WIN_R, th, z) || inWin(WIN_SKY, th, z) || inWin(WIN_L, th, z) || tunnelHole(th, z);

  // ---- shell: upper (cabin) + lower (under the floor)
  b.add(shellGrid(TH_FLOOR, thL, 150, z0, z1, 100, RR, skipUpper), 'cream');
  b.add(shellGrid(thL, TH_FLOOR + Math.PI * 2, 60, z0, z1, 100, RR, (th, z) => inWin(WIN_B, th, z)), 'well');
  // glass panes + gold frames for every window
  for (const W of [WIN_R, WIN_SKY, WIN_L, WIN_B]) for (const [za, zb] of W.z) {
    b.add(shellGrid(W.th[0], W.th[1], 24, za, zb, 8, RR + 0.03), 'glass');
    const ring = [];
    for (let i = 0; i <= 24; i++) ring.push(shellP(W.th[0] + (W.th[1] - W.th[0]) * (i / 24), za, RR - 0.03));
    for (let i = 0; i <= 24; i++) ring.push(shellP(W.th[1] - (W.th[1] - W.th[0]) * (i / 24), zb, RR - 0.03));
    b.tube(ring, 0.045, 'gold', { closed: true, radial: 8, seg: 120 });
    // mullion in the middle of the long windows
    if (zb - za > 3) { const zm = (za + zb) / 2; b.pipe(shellP(W.th[0], zm, RR - 0.03), shellP((W.th[0] + W.th[1]) / 2, zm, RR - 0.03), 0.03, 'gold', 8); b.pipe(shellP((W.th[0] + W.th[1]) / 2, zm, RR - 0.03), shellP(W.th[1], zm, RR - 0.03), 0.03, 'gold', 8); }
  }
  // wainscot (wood) up to 1.4 m on both sides, gold rail on top, dark marble skirting
  const thW = Math.asin((1.4 - yc) / RR);
  b.add(shellGrid(TH_FLOOR, thW, 8, z0, z1, 60, RR - 0.025), 'wood');
  b.add(shellGrid(Math.PI - thW, thL, 8, z0, z1, 60, RR - 0.025, tunnelHole), 'wood');
  for (const th of [thW, Math.PI - thW]) {
    if (th > Math.PI / 2) { shellRail(b, th, z0 + 0.1, TUNNEL.zc - TUNNEL.hv - 0.25, 0.022, 'gold'); shellRail(b, th, TUNNEL.zc + TUNNEL.hv + 0.25, z1 - 0.1, 0.022, 'gold'); }
    else shellRail(b, th, z0 + 0.1, z1 - 0.1, 0.022, 'gold');
  }
  // handrails for zero-g (brass, on stand-offs) at 1.1 m
  const thH = Math.asin((1.1 - yc) / RR);
  for (const th of [thH, Math.PI - thH]) {
    const segs = th > Math.PI / 2 ? [[z0 + 0.6, TUNNEL.zc - TUNNEL.hv - 0.4], [TUNNEL.zc + TUNNEL.hv + 0.4, z1 - 0.6]] : [[z0 + 0.6, z1 - 0.6]];
    for (const [a, c] of segs) {
      shellRail(b, th, a, c, 0.018, 'brass', 0.12);
      for (let z = a; z <= c + 0.01; z += 1.5) b.pipe(shellP(th, z, RR - 0.03), shellP(th, z, RR - 0.12), 0.012, 'brass', 8);
    }
  }
  // arches between the windows, cove light lines along both sides
  for (const z of [z0 + 0.25, -6.6, -2.0, 2.6, z1 - 0.25]) archRib(b, z, TH_FLOOR + 0.02, thL - 0.02, 0.34, 0.16, 'wood');
  for (const z of [-6.6, -2.0, 2.6]) for (const th of [WIN_R.th[1] + 0.06, Math.PI - WIN_R.th[1] - 0.06]) b.sphere(0.07, 'lampWarm', shellP(th, z - 0.24, RR - 0.18).toArray(), 10);
  for (const th of [52 * D2R, 128 * D2R]) {
    b.box(0.05, 0.05, z1 - z0 - 0.6, 'cove', shellP(th, (z0 + z1) / 2, RR - 0.12).toArray(), null, 0);
    b.box(0.22, 0.03, z1 - z0 - 0.6, 'gold', shellP(th - Math.sign(Math.cos(th)) * 0.02, (z0 + z1) / 2, RR - 0.08).toArray(), [0, 0, th - Math.PI / 2], 0.01);
  }
  // ceiling medallion rings around the skylights
  for (const [za, zb] of WIN_SKY.z) b.tube([shellP(WIN_SKY.th[0] - 0.05, za - 0.2, RR - 0.05), shellP(Math.PI / 2, za - 0.25, RR - 0.05), shellP(WIN_SKY.th[1] + 0.05, za - 0.2, RR - 0.05), shellP(WIN_SKY.th[1] + 0.05, zb + 0.2, RR - 0.05), shellP(Math.PI / 2, zb + 0.25, RR - 0.05), shellP(WIN_SKY.th[0] - 0.05, zb + 0.2, RR - 0.05)], 0.03, 'cove', { closed: true, radial: 6, seg: 80 });

  // ---- end walls: forward with the big round window, aft solid
  const disk = (z, hole) => {
    const s = new THREE.Shape();
    for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; const x = xc + Math.cos(a) * RR, y = yc + Math.sin(a) * RR; if (i === 0) s.moveTo(x, y); else s.lineTo(x, y); }
    if (hole) { const h = new THREE.Path(); h.absarc(hole[0], hole[1], hole[2], 0, Math.PI * 2, true); s.holes.push(h); }
    const g = new THREE.ShapeGeometry(s, 48);
    g.translate(0, 0, z);
    return g;
  };
  const FW = [xc, 4.2, 3.0];
  b.add(disk(z0, FW), 'cream');
  b.add(disk(z1), 'cream');
  b.add(new THREE.CircleGeometry(FW[2], 64), 'glass', [FW[0], FW[1], z0 - 0.04]);
  b.torus(FW[2] + 0.02, 0.09, 'gold', [FW[0], FW[1], z0 + 0.06], [0, 0, 0], 96);
  b.torus(FW[2] + 0.22, 0.03, 'gold', [FW[0], FW[1], z0 + 0.04], [0, 0, 0], 96);
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; b.pipe([FW[0] + Math.cos(a) * 0.5, FW[1] + Math.sin(a) * 0.5, z0 + 0.04], [FW[0] + Math.cos(a) * FW[2], FW[1] + Math.sin(a) * FW[2], z0 + 0.04], 0.025, 'gold', 8); }
  b.torus(0.5, 0.04, 'gold', [FW[0], FW[1], z0 + 0.05], [0, 0, 0], 32);
  // wood panelling on the aft wall, sign over the reception
  b.box(9.0, 1.15, 0.05, 'wood', [xc, floorY + 0.58, z1 - 0.03], null, 0.01);
  b.box(6.2, 1.55, 0.06, 'black', [xc, 4.15, z1 - 0.05], null, 0.02);
  b.add(new THREE.PlaneGeometry(6.0, 1.5), 'sign', [xc, 4.15, z1 - 0.085], [0, Math.PI, 0]);
  b.box(6.4, 0.06, 0.12, 'gold', [xc, 3.36, z1 - 0.08], null, 0.01);
  b.box(6.4, 0.06, 0.12, 'gold', [xc, 4.94, z1 - 0.08], null, 0.01);
  lamp(xc, 3.0, z1 - 1.2, 0xffe2b0, 3.0, 8);
  // two tall doors in the aft wall (lit frames, closed): hotel wing and observatory
  for (const s of [-1, 1]) {
    const dx = xc + s * 3.6;
    b.box(1.5, 2.5, 0.06, 'wood', [dx, floorY + 1.25, z1 - 0.06], null, 0.02);
    b.box(0.03, 2.3, 0.05, 'gold', [dx, floorY + 1.25, z1 - 0.1], null, 0.005);
    b.add(new THREE.TorusGeometry(0.95, 0.03, 8, 48, Math.PI), 'cove', [dx, floorY + 2.3, z1 - 0.09]);
    for (const t of [-1, 1]) b.box(0.05, 2.4, 0.08, 'cove', [dx + t * 0.8, floorY + 1.2, z1 - 0.09], null, 0.01);
    b.box(0.05, 0.4, 0.05, 'brass', [dx - s * 0.12, floorY + 1.1, z1 - 0.12], null, 0.01);
  }

  // ---- floor: marble deck with a glass oval over the light well
  const halfC = Math.sqrt(RR * RR - (yc - floorY) * (yc - floorY)) - 0.01;
  const OV = { x: xc, z: -4.6, rx: 2.0, rz: 2.4 };
  {
    const s = new THREE.Shape();
    s.moveTo(xc - halfC, -z0); s.lineTo(xc + halfC, -z0); s.lineTo(xc + halfC, -z1); s.lineTo(xc - halfC, -z1); s.closePath();
    const h = new THREE.Path(); h.absellipse(OV.x, -OV.z, OV.rx, OV.rz, 0, Math.PI * 2, true); s.holes.push(h);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false, curveSegments: 48 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, floorY - 0.12, 0);
    b.add(g, 'marble');
    // colliders: floor slab (whole, the glass is walkable) + walls of the module
    b.colBox(halfC * 2, 0.12, z1 - z0, [xc, floorY - 0.06, (z0 + z1) / 2]);
  }
  // inlaid dark marble border bands and a compass rose around the oval
  for (const x of [xc - halfC + 0.5, xc + halfC - 0.5]) b.box(0.12, 0.004, z1 - z0 - 1.0, 'marbleDark', [x, floorY + 0.002, (z0 + z1) / 2], null, 0);
  for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; const r0 = OV.rx + 0.25, r1 = OV.rx + (k % 2 ? 0.55 : 0.85); b.box(0.06, 0.004, r1 - r0, k % 4 ? 'marbleDark' : 'gold', [OV.x + Math.cos(a) * (r0 + r1) / 2 * 1, floorY + 0.003, OV.z + Math.sin(a) * (r0 + r1) / 2 * (OV.rz / OV.rx)], [0, -a + Math.PI / 2, 0], 0); }
  {
    const pts = [];
    for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2; pts.push(V(OV.x + Math.cos(a) * OV.rx, floorY + 0.012, OV.z + Math.sin(a) * OV.rz)); }
    b.tube(pts, 0.035, 'gold', { closed: true, radial: 8, seg: 144 });
    b.add(new THREE.CircleGeometry(1, 64), 'glassFloor', [OV.x, floorY - 0.02, OV.z], [-Math.PI / 2, 0, 0], [OV.rx, OV.rz, 1]);
    // the light well under the glass, ringed with soft blue light, ending at the Earth window
    const well = [];
    for (const y of [floorY - 0.12, -3.55]) { const ring = []; for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2; ring.push(V(OV.x + Math.cos(a) * OV.rx, y, OV.z + Math.sin(a) * OV.rz)); } well.push(ring); }
    b.add(loft(well, { ring: true, caps: false, invert: true }), 'well');
    for (const y of [-0.3, -1.6, -2.9]) { const ring = []; for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2; ring.push(V(OV.x + Math.cos(a) * (OV.rx - 0.03), y, OV.z + Math.sin(a) * (OV.rz - 0.03))); } b.tube(ring, 0.012, 'coveBlue', { closed: true, radial: 5, seg: 128 }); }
  }
  // carpet runner from the docking portal to the lounge, round rugs
  b.box(4.6, 0.012, 1.5, 'carpet', [5.2 + 2.3, floorY + 0.006, TUNNEL.zc], null, 0);
  b.add(new THREE.CircleGeometry(2.3, 64), 'carpet', [xc, floorY + 0.007, -9.0], [-Math.PI / 2, 0, 0]);
  b.add(new THREE.CircleGeometry(1.8, 64), 'carpet', [xc + 2.4, floorY + 0.007, 1.0], [-Math.PI / 2, 0, 0]);

  // ---- docking portal: thick frame around the tunnel mouth
  {
    const s = new THREE.Shape();
    s.moveTo(TUNNEL.zc - 1.25, floorY); s.lineTo(TUNNEL.zc + 1.25, floorY); s.lineTo(TUNNEL.zc + 1.25, 2.9); s.lineTo(TUNNEL.zc - 1.25, 2.9); s.closePath();
    const hole = new THREE.Path();
    const ring = tunnelRing(0, TUNNEL.hu, TUNNEL.hv, TUNNEL.r, 48);
    ring.forEach((p, i) => { if (i === 0) hole.moveTo(p.z, p.y); else hole.lineTo(p.z, p.y); });
    hole.closePath();
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.55, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 8 });
    // shape (z, y) -> world: x = 5.17 - depth, y = shape.y, z = shape.x
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
    g.translate(TUNNEL.xEnd - 0.03, 0, 0);
    b.add(g, 'wood');
    const lip = tunnelRing(TUNNEL.xEnd - 0.01, TUNNEL.hu + 0.06, TUNNEL.hv + 0.06, TUNNEL.r + 0.06, 48);
    b.tube(lip, 0.05, 'gold', { closed: true, radial: 8, seg: 96 });
    b.tube(tunnelRing(TUNNEL.xEnd + 0.01, TUNNEL.hu + 0.2, TUNNEL.hv + 0.2, TUNNEL.r + 0.2, 48), 0.02, 'cove', { closed: true, radial: 5, seg: 96 });
    // name plate and screens either side of the portal
    b.box(0.04, 0.24, 1.2, 'black', [TUNNEL.xEnd, 2.62, TUNNEL.zc], null, 0.01);
    for (const s2 of [-1, 1]) {
      const zz = TUNNEL.zc + s2 * 2.3;
      b.box(0.06, 0.95, 1.6, 'black', [5.05 + 0.03, 1.75, zz], null, 0.02);
      b.add(new THREE.PlaneGeometry(1.5, 0.85), 'screen', [5.05 + 0.065, 1.75, zz], [0, Math.PI / 2, 0]);
      b.box(0.05, 0.03, 1.66, 'gold', [5.09, 1.26, zz], null, 0.005);
    }
  }

  // ---- docking tunnel (ship hatch -> portal), walkway, rails, LED lines, outer skin
  {
    const hull = openingOutline(HATCH, 0, 48, 0.1);
    const r1 = tunnelRing(TUNNEL.x0, TUNNEL.hu, TUNNEL.hv, TUNNEL.r);
    const r2 = tunnelRing(TUNNEL.xEnd, TUNNEL.hu, TUNNEL.hv, TUNNEL.r);
    b.add(loft([hull, r1, r2], { ring: true, caps: false, invert: true }), 'hullInner');
    const o1 = tunnelRing(TUNNEL.x0, TUNNEL.hu + 0.09, TUNNEL.hv + 0.09, TUNNEL.r + 0.09);
    const o2 = tunnelRing(TUNNEL.xEnd - 0.3, TUNNEL.hu + 0.09, TUNNEL.hv + 0.09, TUNNEL.r + 0.09);
    const hullO = openingOutline(HATCH, 0, 48, 0.2);
    b.add(loft([hullO, o1, o2], { ring: true, caps: false }), 'hullOut');
    for (const x of [TUNNEL.x0 + 0.2, (TUNNEL.x0 + TUNNEL.xEnd) / 2, TUNNEL.xEnd - 0.2]) b.tube(tunnelRing(x, TUNNEL.hu - 0.02, TUNNEL.hv - 0.02, TUNNEL.r - 0.02), 0.025, 'steel', { closed: true, radial: 6, seg: 96 });
    b.box(TUNNEL.xEnd - 3.0, 0.03, 1.1, 'grate', [(3.0 + TUNNEL.xEnd) / 2, floorY + 0.005, TUNNEL.zc], null, 0.005);
    b.colBox(TUNNEL.xEnd - 2.95, 0.1, 1.5, [(2.95 + TUNNEL.xEnd) / 2, floorY - 0.05, TUNNEL.zc]);
    for (const s of [-1, 1]) {
      b.pipe([3.25, 1.05, TUNNEL.zc + s * 0.66], [TUNNEL.xEnd - 0.1, 1.05, TUNNEL.zc + s * 0.66], 0.018, 'brass', 8);
      b.pipe([3.25, 2.05, TUNNEL.zc + s * 0.42], [TUNNEL.xEnd - 0.1, 2.05, TUNNEL.zc + s * 0.42], 0.01, 'led', 6);
      b.colBox(TUNNEL.xEnd - 3.0, 2.2, 0.1, [(3.0 + TUNNEL.xEnd) / 2, 1.2, TUNNEL.zc + s * (TUNNEL.hv + 0.05)]);
    }
    b.colBox(TUNNEL.xEnd - 3.0, 0.1, 1.6, [(3.0 + TUNNEL.xEnd) / 2, TUNNEL.yc + TUNNEL.hu + 0.05, TUNNEL.zc]);
    lamp(4.3, 2.0, TUNNEL.zc, 0xe8f0ff, 2.2, 5);
  }

  // ---- lounge facing the forward window
  sofaArc(b, xc, -9.0, 2.4, Math.PI * 0.08, Math.PI * 0.92, 'leatherCream');
  roundTable(b, xc, -9.0, 0.75, 0.42, 'marbleDark');
  for (const s of [-1, 1]) armchair(b, xc + s * 2.0, -10.9, Math.PI + s * 0.5, 'leather');
  floorLamp(b, xc - 3.6, -10.4); floorLamp(b, xc + 3.6, -10.4);
  // little things on the table: a vase and books
  b.cyl(0.07, 0.05, 0.28, 'crystal', [xc - 0.2, floorY + 0.58, -9.0], null, 16);
  for (let k = 0; k < 5; k++) b.sphere(0.05, 'lampSoft', [xc - 0.2 + Math.cos(k) * 0.06, floorY + 0.76 + k * 0.012, -9.0 + Math.sin(k) * 0.06], 8);
  b.box(0.3, 0.05, 0.22, 'leather', [xc + 0.25, floorY + 0.465, -8.9], [0, 0.4, 0], 0.01);
  lamp(xc, 2.6, -9.2, 0xffd6a0, 3.2, 8);
  lamp(xc - 3.6, 1.9, -10.4, 0xffc890, 1.8, 6);
  lamp(xc + 3.6, 1.9, -10.4, 0xffc890, 1.8, 6);
  // window benches along the panoramic side
  for (const [za, zb] of WIN_R.z) {
    const zm = (za + zb) / 2, len = zb - za - 0.6;
    const bx = xc + halfC - 0.55;
    b.box(0.6, 0.42, len, 'wood', [bx, floorY + 0.21, zm], null, 0.03, 2);
    b.box(0.56, 0.12, len - 0.04, 'velvet', [bx, floorY + 0.48, zm], null, 0.05, 3);
    b.colBox(0.6, 0.55, len, [bx, floorY + 0.27, zm]);
  }

  // ---- centre: the Earth globe sculpture under the chandelier
  const GL = { x: xc + 0.2, y: floorY + 1.95, z: 0.9, r: 0.85 };
  b.cyl(0.9, 1.0, 0.25, 'marbleDark', [GL.x, floorY + 0.125, GL.z], null, 48);
  b.torus(0.95, 0.03, 'gold', [GL.x, floorY + 0.25, GL.z], [Math.PI / 2, 0, 0], 48);
  b.cyl(0.18, 0.3, 0.75, 'gold', [GL.x, floorY + 0.62, GL.z], null, 32);
  b.colCyl(1.0, 1.1, [GL.x, floorY + 0.55, GL.z]);
  // orbit ring around the globe
  b.torus(GL.r + 0.35, 0.02, 'gold', [GL.x, GL.y, GL.z], [Math.PI / 2 + 0.41, 0, 0], 96);
  b.sphere(0.06, 'lampWarm', [GL.x + GL.r + 0.35, GL.y, GL.z], 10);
  lamp(GL.x, GL.y + 0.2, GL.z + 1.6, 0xfff0d8, 2.4, 7);
  // chandelier: two rings of glowing globes with crystal drops, hung from the ceiling
  const CH = { x: GL.x, y: 6.4, z: GL.z };
  b.pipe([CH.x, yc + RR - 0.05, CH.z], [CH.x, CH.y + 0.4, CH.z], 0.02, 'gold', 8);
  for (const [rr, n, dy] of [[1.6, 24, 0], [0.95, 14, -0.35], [0.45, 8, -0.7]]) {
    b.torus(rr, 0.025, 'gold', [CH.x, CH.y + dy, CH.z], [Math.PI / 2, 0, 0], 64);
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2;
      const p = [CH.x + Math.cos(a) * rr, CH.y + dy - 0.08, CH.z + Math.sin(a) * rr];
      b.sphere(0.07, 'lampWarm', p, 10);
      b.add(new THREE.OctahedronGeometry(0.045, 0), 'crystal', [p[0], p[1] - 0.16, p[2]], null, [1, 1.8, 1]);
    }
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; b.pipe([CH.x + Math.cos(a) * rr, CH.y + dy, CH.z + Math.sin(a) * rr], [CH.x, CH.y + 0.4, CH.z], 0.008, 'gold', 6); }
  }
  lamp(CH.x, CH.y - 0.4, CH.z, 0xffe0b0, 7.0, 13);

  // ---- bar along the panoramic side, aft
  const BAR = { x: xc + 3.2, z0: 3.1, z1: 6.7 };
  {
    const zc = (BAR.z0 + BAR.z1) / 2, L = BAR.z1 - BAR.z0;
    b.box(0.7, 1.05, L, 'wood', [BAR.x, floorY + 0.525, zc], null, 0.05, 2);
    b.box(0.9, 0.06, L + 0.2, 'marbleDark', [BAR.x - 0.08, floorY + 1.08, zc], null, 0.02);
    b.pipe([BAR.x - 0.48, floorY + 0.2, BAR.z0], [BAR.x - 0.48, floorY + 0.2, BAR.z1], 0.025, 'brass', 10);
    b.box(0.02, 0.04, L, 'cove', [BAR.x - 0.36, floorY + 1.0, zc], null, 0);
    b.colBox(0.9, 1.1, L + 0.2, [BAR.x, floorY + 0.55, zc]);
    for (let k = 0; k < 5; k++) {
      const z = BAR.z0 + 0.35 + k * (L - 0.7) / 4, x = BAR.x - 0.95;
      b.cyl(0.2, 0.2, 0.08, 'leather', [x, floorY + 0.78, z], null, 24);
      b.cyl(0.03, 0.03, 0.72, 'brass', [x, floorY + 0.38, z], null, 10);
      b.cyl(0.2, 0.22, 0.02, 'brass', [x, floorY + 0.01, z], null, 24);
      b.torus(0.15, 0.012, 'brass', [x, floorY + 0.3, z], [Math.PI / 2, 0, 0], 20);
      b.colCyl(0.2, 0.82, [x, floorY + 0.41, z]);
      // glasses on the counter
      if (k % 2 === 0) { b.cyl(0.03, 0.025, 0.1, 'crystal', [BAR.x - 0.3, floorY + 1.16, z + 0.1], null, 12); b.cyl(0.024, 0.024, 0.02, 'lampWarm', [BAR.x - 0.3, floorY + 1.13, z + 0.1], null, 12); }
    }
    // back shelves with lit bottles on the window bench line
    const sx = xc + halfC - 0.42;
    b.box(0.3, 1.6, L, 'wood', [sx, floorY + 1.3, zc], null, 0.03);
    b.add(new THREE.PlaneGeometry(L - 0.1, 1.4), 'bottles', [sx - 0.16, floorY + 1.32, zc], [0, -Math.PI / 2, 0]);
    for (const y of [0.85, 1.32, 1.8]) b.box(0.08, 0.025, L - 0.1, 'gold', [sx - 0.18, floorY + y, zc], null, 0.005);
    // pendant lamps over the bar
    for (let k = 0; k < 3; k++) {
      const z = BAR.z0 + 0.6 + k * (L - 1.2) / 2;
      const top = yc + Math.sqrt(RR * RR - (BAR.x - 0.2 - xc) ** 2) - 0.05;
      b.pipe([BAR.x - 0.2, top, z], [BAR.x - 0.2, floorY + 2.3, z], 0.006, 'black', 6);
      b.cyl(0.04, 0.17, 0.22, 'brass', [BAR.x - 0.2, floorY + 2.2, z], null, 20, true);
      b.sphere(0.07, 'lampWarm', [BAR.x - 0.2, floorY + 2.1, z], 10);
      lamp(BAR.x - 0.2, floorY + 1.95, z, 0xffc888, 2.2, 6);
    }
  }

  // ---- reception desk in front of the sign
  {
    const zr = z1 - 1.3;
    const pts = [];
    for (let i = 0; i <= 24; i++) { const a = Math.PI * (0.15 + 0.7 * i / 24); pts.push([Math.cos(a) * 1.9, Math.sin(a) * 0.9 - 0.4]); }
    const s = new THREE.Shape();
    pts.forEach(([x, y], i) => { if (i === 0) s.moveTo(x, y); else s.lineTo(x, y); });
    for (let i = 24; i >= 0; i--) { const a = Math.PI * (0.15 + 0.7 * i / 24); s.lineTo(Math.cos(a) * 1.35, Math.sin(a) * 0.55 - 0.4); }
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    g.translate(xc, floorY, zr);
    b.add(g, 'marble');
    const top = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false, curveSegments: 4 });
    top.rotateX(-Math.PI / 2);
    top.translate(xc, floorY + 1.07, zr);
    b.add(top, 'marbleDark');
    b.colBox(3.8, 1.1, 1.2, [xc, floorY + 0.55, zr - 0.3]);
    b.box(3.2, 0.04, 0.04, 'cove', [xc, floorY + 0.1, zr - 0.75], null, 0);
    // a desk screen, a bell, a small orchid
    b.box(0.5, 0.32, 0.03, 'black', [xc + 0.6, floorY + 1.3, zr + 0.1], [-0.2, Math.PI, 0], 0.01);
    b.sphere(0.05, 'gold', [xc - 0.5, floorY + 1.13, zr - 0.3], 12, [1, 0.7, 1]);
    plantBush(b, R, xc - 1.3, zr + 0.05, 0.45, floorY + 1.07, 'ceramicDark');
    lamp(xc, 2.2, zr - 0.6, 0xfff0d8, 2.4, 7);
  }

  // ---- columns, plants, information screens along the near (ship) side
  for (const z of [-7.4, 3.0]) for (const s of [-1, 1]) column(b, xc + s * 3.4, z, floorY, yc + Math.sqrt(RR * RR - 3.4 * 3.4) - 0.02);
  for (const [x, z, h] of [[xc - 4.3, -11.0, 2.0], [xc + 4.3, -11.0, 2.3], [xc - 4.5, 7.1, 2.1], [xc + 4.6, 7.0, 1.9], [xc - 4.6, -6.8, 1.8], [xc - 4.6, 3.6, 2.2]]) plantPalm(b, R, x, z, h);
  for (const [x, z, s] of [[xc - 4.7, -4.4, 0.9], [xc - 4.7, 1.6, 0.8], [xc + 4.5, -1.5, 1.0], [xc - 2.4, 7.2, 0.7], [xc + 2.4, 7.2, 0.7]]) plantBush(b, R, x, z, s);
  for (const z of [-8.8, 5.4]) {
    const th = Math.PI - Math.asin((2.3 - yc) / RR);
    const p = shellP(th, z, RR - 0.08);
    b.box(0.06, 1.0, 1.7, 'black', p.toArray(), null, 0.02);
    b.add(new THREE.PlaneGeometry(1.6, 0.9), 'screen', [p.x + 0.035, p.y, p.z], [0, Math.PI / 2, 0]);
  }
  lamp(xc - 3.6, 2.6, -4.6, 0xffe6c0, 3.0, 9);
  lamp(xc + 3.6, 2.6, -4.6, 0xffe6c0, 3.0, 9);
  lamp(xc + 3.6, 2.6, 0.6, 0xffe6c0, 2.6, 9);
  lamp(xc - 3.6, 2.6, 4.4, 0xffe6c0, 2.6, 9);
  lamp(OV.x, -1.2, OV.z, 0x9fd0ff, 0.6, 4);

  // ---- colliders for the module walls (coarse cylinder) and end walls
  {
    const ring = (z) => { const pts = []; for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; pts.push(V(xc + Math.cos(a) * (RR - 0.02), yc + Math.sin(a) * (RR - 0.02), z)); } return pts; };
    // half-metre sections: with one long section every triangle's centre sat metres away from the
    // tunnel, nothing was cut out and an invisible wall closed the docking portal
    const rings = [];
    for (let k = 0; k <= 40; k++) rings.push(ring(z0 + (z1 - z0) * (k / 40)));
    const g = loft(rings, { ring: true, caps: false });
    // leave the docking tunnel open (remove the wall quads in front of it)
    const cut = new THREE.BufferGeometry();
    const gp = g.index ? g.toNonIndexed() : g;
    const a = gp.attributes.position.array, out = [];
    for (let i = 0; i < a.length; i += 9) {
      const cx = (a[i] + a[i + 3] + a[i + 6]) / 3, cy = (a[i + 1] + a[i + 4] + a[i + 7]) / 3, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
      if (cx < xc - 4 && cy < 2.9 && cy > -0.2 && Math.abs(cz - TUNNEL.zc) < 1.4) continue;
      for (let k = 0; k < 9; k++) out.push(a[i + k]);
    }
    cut.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    b.colMesh(cut);
    b.colBox(RR * 2, RR * 2, 0.1, [xc, yc, z0 - 0.05]);
    b.colBox(RR * 2, RR * 2, 0.1, [xc, yc, z1 + 0.05]);
  }

  const group = b.build(M, { castShadow: false, receiveShadow: false });
  group.traverse((o) => { o.layers.set(LAYER_NEAR); });
  // the globe turns (separate mesh with the Earth texture painted from the colour map if present)
  const globeMat = new THREE.MeshStandardMaterial({ color: 0x3a6fb0, roughness: 0.45, metalness: 0.1, envMap: ENV, envMapIntensity: 0.6 });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(GL.r, 64, 48), globeMat);
  globe.position.set(GL.x, GL.y, GL.z);
  globe.rotation.z = 0.41;
  globe.layers.set(LAYER_NEAR);
  group.add(globe);

  const contains = (p) => {
    if (p.x > 2.9 && p.x < TUNNEL.xEnd + 0.3 && Math.abs(p.z - TUNNEL.zc) < TUNNEL.hv + 0.05 && p.y > floorY - 0.3 && p.y < TUNNEL.yc + TUNNEL.hu + 0.05) return true;
    const dx = p.x - xc, dy = p.y - yc;
    return dx * dx + dy * dy < (RR - 0.05) * (RR - 0.05) && p.z > z0 && p.z < z1 && p.y > floorY - 0.4;
  };
  return { group, colliders: b.colliders, lamps, globe, globeMat, contains, materials: M };
}

/** paint the globe with the Earth colour map once it is available */
export function setGlobeTexture(lobby, tex) {
  if (!lobby || !tex) return;
  lobby.globeMat.map = tex;
  lobby.globeMat.color.set(0xffffff);
  lobby.globeMat.needsUpdate = true;
}

/** the module's outer shell for the station model (station-local, centred on the module axis) */
export function lobbyShellExterior(b, cx, cy, cz) {
  const { R: RR, z0, z1 } = LOBBY;
  const L = z1 - z0;
  const Ro = RR + 0.35;
  b.cyl(Ro, Ro, L + 0.6, 'hull', [cx, cy, cz], [Math.PI / 2, 0, 0], 64, true);
  for (const s of [-1, 1]) {
    b.cyl(Ro, Ro * 0.86, 0.9, 'hullDark', [cx, cy, cz + s * (L / 2 + 0.75)], [Math.PI / 2, 0, 0], 64);
    b.sphere(Ro * 0.86, 'hull', [cx, cy, cz + s * (L / 2 + 1.2)], 48, [1, 1, 0.32]);
  }
  // the big round forward window glows warm in the bow cap (a lit cap just outside the dome)
  {
    const rd = Ro * 0.86 + 0.04, wr = 3.0, wy = 4.2 - LOBBY.yc;
    const th = Math.asin(Math.min(0.95, wr / rd));
    const g = new THREE.SphereGeometry(rd, 40, 12, 0, Math.PI * 2, 0, th);
    g.rotateX(-Math.PI / 2);
    g.scale(1, 1, 0.32);
    // shift the cap up to the window centre (the dome is flat enough there)
    b.add(g, 'lobbyGlow', [cx, cy + wy * 0.85, cz - (L / 2 + 1.2) - 0.02]);
  }
  for (const dz of [-L / 2, -L / 4, 0, L / 4, L / 2]) b.torus(Ro + 0.04, 0.12, 'gold', [cx, cy, cz + dz], [0, 0, 0], 64);
  return { Ro, L };
}

export { TH_FLOOR };
