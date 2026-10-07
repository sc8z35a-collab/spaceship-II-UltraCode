// The inside of the Origin International Space Station, walkable once B-29 is docked (ship-local
// metres, built next to the ship like the hub stations' lobby). Nobody lives here: the station runs
// itself. From the docking tunnel Kaito floats into the port node (the supply board, the station's
// welcome), then down a 36 m main corridor lined with equipment racks: the power control room and
// the operations centre, the hydroponic farm and the cold food store, the supply warehouse with
// its gantry robot and the robot bay, and at the far end the observation node with its cupola
// looking straight down at the Earth. Free-flying robots work the corridor; everything that moves
// is driven by update().
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Builder, rng } from '../ship/geom.js';
import { OPENINGS } from '../ship/hullShape.js';
import { openingOutline } from '../ship/exterior.js';
import { loft } from '../ship/sweep.js';
import { LAYER_NEAR } from '../core/layers.js';
import { StationDoor } from './stationDoors.js';
import { TUNNEL, tunnelRing } from './stationLobby.js';
import { ORIGIN_ROOMS, ORIGIN_PORTALS, ORIGIN_WINDOWS, ORIGIN_WALL, roomById, holesOf } from './originLayout.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const HATCH = OPENINGS.find((o) => o.kind === 'hatch');
const FACES = ['+x', '-x', '+y', '-y', '+z', '-z'];

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
  t.userData.canvas = c;
  return t;
}

/** white wall panels with seams, screws, labels and velcro patches (one tile: 1.2 m) */
function panelTex(seed, base = '#d8dcdf', seam = '#9aa1a8') {
  const R = rng(seed);
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const x = i * 256, y = j * 256;
      const gr = g.createLinearGradient(x, y, x + 256, y + 256);
      gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0.06)');
      g.fillStyle = gr; g.fillRect(x + 3, y + 3, 250, 250);
      g.strokeStyle = seam; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, 253, 253);
      g.fillStyle = '#7d858c';
      for (const [sx, sy] of [[14, 14], [242, 14], [14, 242], [242, 242]]) { g.beginPath(); g.arc(x + sx, y + sy, 4, 0, Math.PI * 2); g.fill(); }
      if (R() < 0.6) { g.fillStyle = 'rgba(40,46,52,0.75)'; g.fillRect(x + 30 + R() * 120, y + 40 + R() * 150, 60 + R() * 50, 16); }
      if (R() < 0.5) { g.fillStyle = 'rgba(245,242,230,0.9)'; g.fillRect(x + 40 + R() * 140, y + 60 + R() * 120, 34, 34); }
    }
  }, { repeat: [1 / 1.2, 1 / 1.2] });
}

/** equipment rack fronts, four to a tile (4.2 m x 2.44 m) */
function rackTex() {
  const R = rng(91);
  return canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#c9cdd0'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 4; k++) {
      const x0 = k * 256;
      g.fillStyle = '#e7e9ea'; g.fillRect(x0 + 6, 8, 244, h - 16);
      g.strokeStyle = '#8c949b'; g.lineWidth = 3; g.strokeRect(x0 + 6, 8, 244, h - 16);
      let y = 20;
      while (y < h - 40) {
        const ph = 40 + Math.floor(R() * 4) * 22;
        const kind = R();
        g.fillStyle = kind < 0.3 ? '#d5d9dc' : kind < 0.6 ? '#f1f2f2' : '#bfc5ca';
        g.fillRect(x0 + 16, y, 224, ph - 6);
        g.strokeStyle = '#9aa2a8'; g.lineWidth = 2; g.strokeRect(x0 + 16, y, 224, ph - 6);
        // handles, a label, LEDs, connectors or a fan
        g.fillStyle = '#5d6670'; g.fillRect(x0 + 24, y + ph / 2 - 8, 8, 14); g.fillRect(x0 + 224, y + ph / 2 - 8, 8, 14);
        g.fillStyle = '#2c3238'; g.fillRect(x0 + 44, y + 8, 70 + R() * 50, 12);
        g.fillStyle = '#fafafa'; g.fillRect(x0 + 46, y + 10, 30, 8);
        if (R() < 0.6) for (let i = 0; i < 4; i++) { g.fillStyle = ['#36d46a', '#36d46a', '#ffb02a', '#3aa0ff'][Math.floor(R() * 4)]; g.beginPath(); g.arc(x0 + 150 + i * 14, y + 14, 3.5, 0, Math.PI * 2); g.fill(); }
        if (kind > 0.8 && ph > 70) { g.strokeStyle = '#5c646b'; g.lineWidth = 2; g.beginPath(); g.arc(x0 + 190, y + ph / 2, ph / 2 - 12, 0, Math.PI * 2); g.stroke(); for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(x0 + 190 - (ph / 2 - 14), y + ph / 2 + i * 6); g.lineTo(x0 + 190 + (ph / 2 - 14), y + ph / 2 + i * 6); g.stroke(); } }
        else if (kind > 0.6) for (let i = 0; i < 5; i++) { g.fillStyle = '#3b4148'; g.beginPath(); g.arc(x0 + 60 + i * 26, y + ph - 18, 6, 0, Math.PI * 2); g.fill(); }
        y += ph;
      }
      // barcode strip
      g.fillStyle = '#fff'; g.fillRect(x0 + 160, h - 34, 70, 18);
      for (let i = 0; i < 24; i++) if (R() < 0.6) { g.fillStyle = '#111'; g.fillRect(x0 + 163 + i * 2.7, h - 32, 1.6, 14); }
    }
  }, { repeat: [1 / 4.2, 1 / 2.44] });
}

function hazardTex() {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#e0b31c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#16181a';
    for (let x = -64; x < w + 64; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 24, 0); g.lineTo(x + 24 + h, h); g.lineTo(x + h, h); g.closePath(); g.fill(); }
  }, { repeat: [1, 1] });
}

/** the station's name over the corridor portal */
function nameTex() {
  return canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#0a0f16'; g.fillRect(0, 0, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#eaf4ff'; g.font = '200 118px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText('O R I G I N', w / 2, 92);
    g.fillStyle = '#7fd2ff'; g.font = '500 44px sans-serif';
    g.fillText('オリジン国際宇宙ステーション', w / 2, 186);
    g.fillStyle = '#7fd2ff'; g.fillRect(w * 0.2, 140, w * 0.6, 2);
  });
}

/** room names, all in one atlas (one row each) */
const SIGNS = [
  ['入港ノード', 'PORT NODE'], ['中央通路', 'MAIN CORRIDOR'], ['電力管制室', 'POWER CONTROL'], ['運用管制センター', 'OPERATIONS'],
  ['水耕農場', 'HYDROPONICS'], ['食料庫', 'FOOD STORE'], ['物資倉庫', 'SUPPLY STORE'], ['ロボット整備室', 'ROBOT BAY'],
  ['展望ノード', 'OBSERVATION'], ['← 入港ノード', 'TO PORT'], ['展望ノード →', 'TO CUPOLA'], ['冷凍 −18 ℃', 'FREEZER'],
];
function signAtlas() {
  const N = SIGNS.length;
  return canvasTex(512, 64 * N, (g, w) => {
    SIGNS.forEach(([jp, en], i) => {
      const y = i * 64;
      g.fillStyle = '#0c1a26'; g.fillRect(0, y, w, 64);
      g.fillStyle = '#3aa0ff'; g.fillRect(0, y, 10, 64);
      g.fillStyle = '#e8f3ff'; g.font = '600 30px sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
      g.fillText(jp, 24, y + 24);
      g.fillStyle = '#7fb3d6'; g.font = '500 16px sans-serif';
      g.fillText(en, 24, y + 50);
    });
  });
}
/** a plane showing row i of the sign atlas */
function signPlane(i, w, h) {
  const g = new THREE.PlaneGeometry(w, h);
  const N = SIGNS.length, uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (i + 1 - uv.getY(k)) / N);
  return g;
}

/** colourful packets on lit shelves (behind the freezer glass) */
function shelfTex() {
  const R = rng(7);
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#cfe6f5'; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 4; row++) {
      const base = (row + 1) * 128 - 8;
      g.fillStyle = '#8fa7b8'; g.fillRect(0, base, w, 8);
      let x = 6;
      while (x < w - 20) {
        const bw = 26 + R() * 40, bh = 50 + R() * 60;
        const hue = [8, 30, 48, 120, 200, 280, 340][Math.floor(R() * 7)];
        g.fillStyle = `hsl(${hue},${55 + R() * 30}%,${45 + R() * 20}%)`;
        g.fillRect(x, base - bh, bw, bh);
        g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(x + 4, base - bh * 0.6, bw - 8, 10);
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 2, base - bh + 2, 3, bh - 4);
        x += bw + 3;
      }
    }
    g.fillStyle = 'rgba(230,245,255,0.25)'; g.fillRect(0, 0, w, h);
  });
}

/** server racks: rows of LEDs */
function serverTex() {
  const R = rng(5);
  return canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#14181d'; g.fillRect(0, 0, w, h);
    for (let y = 8; y < h - 8; y += 22) {
      g.fillStyle = '#20262d'; g.fillRect(8, y, w - 16, 18);
      for (let i = 0; i < 10; i++) { g.fillStyle = R() < 0.7 ? (R() < 0.8 ? '#3bdc6e' : '#ffb02a') : '#1d2a22'; g.fillRect(16 + i * 9, y + 6, 5, 5); }
      g.fillStyle = '#3a4048'; g.fillRect(130, y + 4, 100, 10);
    }
  });
}

function pegTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4a5560'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2b3138';
    for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) { g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill(); }
  }, { repeat: [1 / 1.0, 1 / 1.0] });
}

// ------------------------------------------------------------------ the dynamic screens
const COLS = { bg: '#04111c', line: 'rgba(95,208,255,0.35)', text: '#e6f4ff', dim: '#8fb6cc', cyan: '#5fd0ff', green: '#5fe08f', amber: '#ffb347', red: '#ff5a4a' };

function screen(w, h, draw) {
  const tex = canvasTex(w, h, () => {});
  const mat = new THREE.MeshStandardMaterial({ color: 0x000000, map: tex, emissiveMap: tex, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.3 });
  const S = { tex, mat, draw, ctx: tex.userData.canvas.getContext('2d'), w, h, t: 0 };
  S.redraw = (g) => { S.draw(S.ctx, w, h, g); tex.needsUpdate = true; };
  return S;
}

function head(g, w, title, sub) {
  g.fillStyle = COLS.bg; g.fillRect(0, 0, w, 600);
  g.fillStyle = COLS.cyan; g.font = '600 40px sans-serif'; g.textBaseline = 'top'; g.textAlign = 'left';
  g.fillText(title, 32, 24);
  g.fillStyle = COLS.dim; g.font = '500 22px sans-serif'; g.fillText(sub, 34, 72);
  g.fillStyle = COLS.line; g.fillRect(32, 106, w - 64, 3);
}

function bar(g, x, y, w, h, k, col) {
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x, y, w, h);
  g.fillStyle = col; g.fillRect(x, y, w * Math.max(0, Math.min(1, k)), h);
}

function drawSupply(g, w, h, game) {
  head(g, w, '補給状況  SUPPLY', 'オリジン自動補給システム — B-29 / H8');
  const items = game && game.gameplay && game.gameplay.supplyItems ? game.gameplay.supplyItems() : [];
  let y = 128;
  for (const it of items) {
    g.font = '600 28px sans-serif'; g.fillStyle = COLS.text; g.textBaseline = 'middle';
    g.fillText(it.name, 40, y + 18);
    bar(g, 300, y + 6, 520, 24, it.k, it.k >= 0.995 ? COLS.green : it.active ? COLS.cyan : COLS.amber);
    g.font = '500 24px monospace'; g.fillStyle = it.active ? COLS.cyan : it.k >= 0.995 ? COLS.green : COLS.dim; g.textAlign = 'right';
    g.fillText(it.k >= 0.995 ? '満載' : it.active ? '補給中' : Math.round(it.k * 100) + '%', w - 36, y + 18);
    g.textAlign = 'left';
    y += 54;
    if (y > h - 40) break;
  }
  if (!items.length) { g.fillStyle = COLS.dim; g.font = '500 30px sans-serif'; g.fillText('接続待ち…', 40, 160); }
}

function drawPower(g, w, h, game, t) {
  head(g, w, '電力管制  POWER GRID', '太陽電池 8 翼 → 超電導蓄電 → 各区画 / 入港船');
  const sun = game && game.sky && game.sky.sunUp !== undefined ? game.sky.sunUp : 1;
  const solar = 2.38 * (0.15 + 0.85 * (sun ? 1 : 0));
  // flow boxes
  const box = (x, y, bw, bh, title, val, col) => {
    g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(x, y, bw, bh);
    g.fillStyle = 'rgba(95,208,255,0.06)'; g.fillRect(x, y, bw, bh);
    g.fillStyle = COLS.dim; g.font = '500 22px sans-serif'; g.textBaseline = 'top'; g.fillText(title, x + 14, y + 12);
    g.fillStyle = COLS.text; g.font = '600 34px monospace'; g.fillText(val, x + 14, y + 44);
  };
  box(40, 140, 280, 110, '太陽電池', solar.toFixed(2) + ' GW', COLS.amber);
  box(380, 140, 280, 110, '蓄電 (SMES)', (86 + 3 * Math.sin(t * 0.05)).toFixed(1) + ' %', COLS.cyan);
  box(720, 140, 260, 110, '区画負荷', (0.41 + 0.02 * Math.sin(t * 0.3)).toFixed(2) + ' GW', COLS.green);
  box(380, 330, 280, 110, '入港船へ送電', (game && game.docking && game.docking.docked ? 180 + 20 * Math.sin(t) : 0).toFixed(0) + ' MW', COLS.cyan);
  // animated flow arrows
  g.strokeStyle = COLS.cyan; g.lineWidth = 4;
  const arrow = (x0, y0, x1, y1) => {
    g.globalAlpha = 0.35; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.globalAlpha = 1;
    const k = (t * 0.6) % 1;
    g.fillStyle = COLS.cyan; g.beginPath(); g.arc(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, 7, 0, Math.PI * 2); g.fill();
  };
  arrow(320, 195, 380, 195); arrow(660, 195, 720, 195); arrow(520, 250, 520, 330);
  g.fillStyle = COLS.dim; g.font = '500 22px sans-serif'; g.textBaseline = 'top';
  g.fillText('自動運用中 — 異常なし', 40, h - 60);
}

const TASKS = ['R-03  物資コンテナ搬送 (デポ → 第2バース)', 'R-07  太陽電池翼 清掃', 'R-11  水耕農場 収穫', 'R-12  食料庫 在庫整理', 'R-15  外壁点検 (第4モジュール)', 'R-21  入港船へ補給', 'R-24  冷却ループ 点検', 'R-30  ロボット整備室で充電中'];
function drawOps(g, w, h, game, t) {
  head(g, w, '運用管制  OPERATIONS', '無人自動運用 — ロボット 32 機稼働');
  g.font = '500 25px monospace'; g.textBaseline = 'top';
  const off = Math.floor(t / 4) % TASKS.length;
  for (let i = 0; i < 7; i++) {
    const s = TASKS[(off + i) % TASKS.length];
    const y = 130 + i * 52;
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)'; g.fillRect(32, y - 6, w - 64, 46);
    g.fillStyle = i === 0 ? COLS.cyan : COLS.text; g.fillText(s, 44, y + 4);
    g.fillStyle = i === 0 ? COLS.amber : COLS.green; g.textAlign = 'right'; g.fillText(i === 0 ? '実行中' : '待機', w - 44, y + 4); g.textAlign = 'left';
  }
}

function drawMap(g, w, h, game, t) {
  head(g, w, 'ステーション全図', 'ORIGIN — 全長 1.3 km');
  g.save(); g.translate(w / 2, 340);
  g.strokeStyle = COLS.cyan; g.lineWidth = 3;
  g.strokeRect(-420, -6, 840, 12);                       // main truss
  for (const x of [-360, -200, 200, 360]) { g.strokeStyle = COLS.amber; g.strokeRect(x - 40, -110, 80, 92); g.strokeRect(x - 40, 18, 80, 92); }
  g.strokeStyle = COLS.text; g.strokeRect(-12, -170, 24, 340);                  // module spine
  g.beginPath(); g.arc(0, 200, 40, 0, Math.PI * 2); g.stroke();
  // robots: dots running along the truss and spine
  for (let i = 0; i < 12; i++) {
    const k = ((t * 0.05 + i * 0.37) % 1) * 2 - 1;
    g.fillStyle = i % 3 ? COLS.green : COLS.amber;
    g.beginPath(); if (i % 2) g.arc(k * 410, 0, 6, 0, Math.PI * 2); else g.arc(0, k * 160, 6, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

function drawFood(g, w, h) {
  head(g, w, '食料庫  在庫', '自動在庫管理 — 冷凍 −18 ℃ / 常温 21 ℃');
  const rows = [['冷凍食品', '12.4 t'], ['保存食 (常温)', '31.8 t'], ['新鮮野菜 (農場)', '1.9 t'], ['飲料水', '86 t'], ['調味料・嗜好品', '2.3 t'], ['宇宙食パック (船舶用)', '9,600 食']];
  g.textBaseline = 'top';
  rows.forEach(([a, b], i) => {
    const y = 132 + i * 60;
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)'; g.fillRect(32, y - 6, w - 64, 52);
    g.fillStyle = COLS.text; g.font = '600 30px sans-serif'; g.fillText(a, 44, y + 4);
    g.fillStyle = COLS.cyan; g.font = '500 30px monospace'; g.textAlign = 'right'; g.fillText(b, w - 44, y + 4); g.textAlign = 'left';
  });
}

function drawWelcome(g, w, h) {
  g.fillStyle = '#06121c'; g.fillRect(0, 0, w, h);
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, 'rgba(58,160,255,0.18)'); gr.addColorStop(1, 'rgba(58,160,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#eaf4ff'; g.font = '200 84px "Helvetica Neue", Helvetica, Arial, sans-serif'; g.fillText('WELCOME TO ORIGIN', w / 2, 110);
  g.fillStyle = COLS.cyan; g.font = '500 38px sans-serif'; g.fillText('オリジン国際宇宙ステーションへようこそ', w / 2, 190);
  g.fillStyle = COLS.dim; g.font = '500 26px sans-serif';
  ['当ステーションは無人の完全自動運用です。', '入港した船には電力・推進剤・空気・水・食料・修理部材を自動で補給します。', '各区画へは中央通路からどうぞ。'].forEach((s, i) => g.fillText(s, w / 2, 270 + i * 44));
  // partner emblems: twelve coloured roundels
  for (let i = 0; i < 12; i++) {
    const x = w / 2 + (i - 5.5) * 72, y = 470;
    g.fillStyle = `hsl(${i * 30},60%,52%)`; g.beginPath(); g.arc(x, y, 24, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 3; g.stroke();
  }
}

function drawRobots(g, w, h, game, t) {
  head(g, w, 'ロボット整備', '自由飛行ロボット 32 機 / 整備中 2 機');
  g.textBaseline = 'top'; g.font = '500 26px monospace';
  for (let i = 0; i < 6; i++) {
    const y = 132 + i * 56, k = (0.35 + 0.65 * ((i * 0.37 + t * 0.01) % 1));
    g.fillStyle = COLS.text; g.fillText(`R-${String(30 + i).padStart(2, '0')}`, 44, y + 6);
    bar(g, 180, y + 10, 560, 22, k, k > 0.9 ? COLS.green : COLS.cyan);
    g.fillStyle = COLS.dim; g.textAlign = 'right'; g.fillText(k > 0.995 ? '待機' : '充電中', w - 44, y + 6); g.textAlign = 'left';
  }
}

// ------------------------------------------------------------------ materials
let ENV = null;
function envMap(renderer) {
  if (ENV || !renderer) return ENV;
  const pm = new THREE.PMREMGenerator(renderer);
  ENV = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  return ENV;
}

function originMaterials(renderer) {
  const env = envMap(renderer);
  const S = (o) => new THREE.MeshStandardMaterial(Object.assign({ envMap: env, envMapIntensity: 0.4 }, o));
  const P = (o) => new THREE.MeshPhysicalMaterial(Object.assign({ envMap: env, envMapIntensity: 0.6 }, o));
  const E = (r, g, b, i) => S({ color: 0x000000, emissive: new THREE.Color(r, g, b), emissiveIntensity: i });
  const peg = pegTex();
  return {
    panel: S({ map: panelTex(3), roughness: 0.62, metalness: 0.05 }),
    panelCold: S({ map: panelTex(4, '#dbe9f4', '#93a9bb'), roughness: 0.4, metalness: 0.08 }),
    panelDark: S({ map: panelTex(5, '#5c646c', '#3c434a'), roughness: 0.7, metalness: 0.1 }),
    rack: S({ map: rackTex(), roughness: 0.55, metalness: 0.08 }),
    deck: S({ map: panelTex(6, '#4c535b', '#30363c'), roughness: 0.85, metalness: 0.1 }),
    peg: S({ map: peg, roughness: 0.8 }),
    rail: S({ color: 0x2f73c9, roughness: 0.32, metalness: 0.55 }),
    railY: S({ color: 0xd8a920, roughness: 0.38, metalness: 0.45 }),
    steel: S({ color: 0xcdd1d6, roughness: 0.25, metalness: 1.0, envMapIntensity: 0.9 }),
    gold: S({ color: 0xc9cfd6, roughness: 0.3, metalness: 1.0, envMapIntensity: 0.9 }),
    brass: S({ color: 0x9aa4ad, roughness: 0.32, metalness: 1.0, envMapIntensity: 0.9 }),
    black: S({ color: 0x0b0c0e, roughness: 0.3, metalness: 0.3 }),
    dark: S({ color: 0x23272d, roughness: 0.55, metalness: 0.35 }),
    white: S({ color: 0xf0f1ee, roughness: 0.55, metalness: 0.05 }),
    bag: S({ color: 0xebe6d8, roughness: 0.96 }),
    strap: S({ color: 0x27303a, roughness: 0.8 }),
    crateO: S({ color: 0xd06a24, roughness: 0.6 }),
    crateG: S({ color: 0x8a939b, roughness: 0.5, metalness: 0.4 }),
    crateB: S({ color: 0x2d5c99, roughness: 0.55 }),
    crateY: S({ color: 0xd8b42a, roughness: 0.55 }),
    hazard: S({ map: hazardTex(), roughness: 0.6 }),
    cable: S({ color: 0x1b1e22, roughness: 0.7 }),
    tray: S({ color: 0x2c3036, roughness: 0.75, metalness: 0.3 }),
    leaf: S({ color: 0x3f8f3a, roughness: 0.7, side: THREE.DoubleSide }),
    leafLight: S({ color: 0x7cbf4a, roughness: 0.7, side: THREE.DoubleSide }),
    fruit: S({ color: 0xd8352a, roughness: 0.45 }),
    robot: S({ color: 0xeef0f2, roughness: 0.38, metalness: 0.2 }),
    robotBlue: S({ color: 0x2a6fd6, roughness: 0.4, metalness: 0.3 }),
    // (the room environment's lamps are very bright: on smooth glass they bloomed into a glare
    // that filled whole doorways)
    glass: P({ color: 0x0b1015, roughness: 0.06, transparent: true, opacity: 0.12, depthWrite: false, envMapIntensity: 0.12, side: THREE.DoubleSide }),
    glassTube: P({ color: 0xbfe6ff, roughness: 0.08, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 0.15 }),
    frostGlass: P({ map: shelfTex(), color: 0xffffff, roughness: 0.35, emissiveMap: null, emissive: new THREE.Color(0.25, 0.32, 0.38), emissiveIntensity: 0.6 }),
    server: S({ map: serverTex(), emissiveMap: serverTex(), emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.2, color: 0x222222 }),
    hullOut: S({ color: 0xe6e8ea, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide }),
    hullInner: S({ color: 0xd9dde0, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide }),
    grate: S({ color: 0x8b9096, roughness: 0.4, metalness: 0.8 }),
    led: E(0.9, 0.95, 1.0, 2.0),
    ledWarm: E(1.0, 0.86, 0.66, 2.0),
    ledBlue: E(0.3, 0.65, 1.0, 2.4),
    ledG: E(0.25, 1.0, 0.45, 2.4),
    ledR: E(1.0, 0.12, 0.06, 2.4),
    grow: E(1.0, 0.22, 0.78, 3.2),
    cold: E(0.6, 0.85, 1.0, 1.8),
    energy: E(0.3, 0.75, 1.0, 1.4),
    name: ((t) => S({ map: t, emissiveMap: t, color: 0x000000, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.6 }))(nameTex()),
    signs: ((t) => S({ map: t, emissiveMap: t, color: 0x000000, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.3 }))(signAtlas()),
  };
}

// ------------------------------------------------------------------ geometry helpers
/** the plane of one face of a space (e: pushed out by e) and its (u, v) axes */
function faceFrame(room, face, e = 0) {
  const s = face[0] === '+' ? 1 : -1, a = face[1];
  const [ua, va] = a === 'x' ? ['z', 'y'] : a === 'y' ? ['x', 'z'] : ['x', 'y'];
  return { s, a, ua, va, plane: s > 0 ? room[a + '1'] + e : room[a + '0'] - e, u0: room[ua + '0'] - e, u1: room[ua + '1'] + e, v0: room[va + '0'] - e, v1: room[va + '1'] + e };
}

function to3(F, u, v, out = new THREE.Vector3()) { out[F.a] = F.plane; out[F.ua] = u; out[F.va] = v; return out; }

/** a rounded rectangle (centre cu, cv) walked counter-clockwise */
export function rrPts(cu, cv, w, h, r, n = 6) {
  r = Math.min(r, w / 2, h / 2);
  const pts = [];
  const cs = [[w / 2 - r, h / 2 - r, 0], [-(w / 2 - r), h / 2 - r, Math.PI / 2], [-(w / 2 - r), -(h / 2 - r), Math.PI], [w / 2 - r, -(h / 2 - r), Math.PI * 1.5]];
  for (const [x, y, a0] of cs) {
    if (r < 1e-3) { pts.push([cu + x, cv + y]); continue; }
    for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * Math.PI / 2; pts.push([cu + x + Math.cos(a) * r, cv + y + Math.sin(a) * r]); }
  }
  return pts;
}

function flipIndex(g) {
  const ix = g.index;
  if (!ix) return;
  for (let i = 0; i < ix.count; i += 3) { const a = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, a); }
}

/**
 * One face of a space as a flat sheet with its holes cut out, facing in (the inside) or out (the
 * station's skin); uvs in metres
 */
export function faceGeo(room, face, holes, e, outward) {
  const F = faceFrame(room, face, e);
  const shape = new THREE.Shape();
  shape.moveTo(F.u0, F.v0); shape.lineTo(F.u1, F.v0); shape.lineTo(F.u1, F.v1); shape.lineTo(F.u0, F.v1); shape.closePath();
  for (const h of holes) {
    const path = new THREE.Path();
    rrPts(h.u, h.v, h.w, h.h, h.r, h.r > 0.6 ? 12 : 6).forEach(([u, v], i) => (i ? path.lineTo(u, v) : path.moveTo(u, v)));
    path.closePath();
    shape.holes.push(path);
  }
  const g = new THREE.ShapeGeometry(shape, 4);
  const pos = g.attributes.position, p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { to3(F, pos.getX(i), pos.getY(i), p); pos.setXYZ(i, p.x, p.y, p.z); }
  const U = V(0, 0, 0), W = V(0, 0, 0), want = V(0, 0, 0);
  U[F.ua] = 1; W[F.va] = 1; want[F.a] = outward ? F.s : -F.s;
  if (new THREE.Vector3().crossVectors(U, W).dot(want) < 0) flipIndex(g);
  g.computeVertexNormals();
  return g;
}

/** the inside of a hole through a wall: its outline swept from plane pa to plane pb, facing in */
function revealGeo(F, h, pa, pb) {
  const pts = rrPts(h.u, h.v, h.w, h.h, h.r, h.r > 0.6 ? 12 : 6);
  const pos = [];
  const A = V(0, 0, 0), B = V(0, 0, 0), C = V(0, 0, 0), D = V(0, 0, 0), c = V(0, 0, 0);
  const at = (u, v, pl, out) => { out[F.a] = pl; out[F.ua] = u; out[F.va] = v; return out; };
  for (let i = 0; i < pts.length; i++) {
    const [u0, v0] = pts[i], [u1, v1] = pts[(i + 1) % pts.length];
    at(u0, v0, pa, A); at(u1, v1, pa, B); at(u1, v1, pb, C); at(u0, v0, pb, D);
    // facing the opening's axis
    const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(D, A));
    at(h.u, h.v, (pa + pb) / 2, c);
    const mid = A.clone().add(C).multiplyScalar(0.5);
    if (n.dot(c.clone().sub(mid)) >= 0) pos.push(...A.toArray(), ...B.toArray(), ...C.toArray(), ...A.toArray(), ...C.toArray(), ...D.toArray());
    else pos.push(...A.toArray(), ...C.toArray(), ...B.toArray(), ...A.toArray(), ...D.toArray(), ...C.toArray());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** a trim ring round a hole, standing just off the wall */
function trimRing(b, F, h, pl, r, key) {
  // (no repeated points: a round hole's corners meet in one centre)
  const raw = rrPts(h.u, h.v, h.w + 0.04, h.h + 0.04, h.r + 0.02, 4);
  const pts = [];
  for (const [u, v] of raw) if (!pts.length || Math.hypot(u - pts[pts.length - 1][0], v - pts[pts.length - 1][1]) > 1e-4) pts.push([u, v]);
  if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-4) pts.pop();
  const P3 = pts.map(([u, v]) => to3(F, u, v, V(0, 0, 0)).setComponent(F.a === 'x' ? 0 : F.a === 'y' ? 1 : 2, pl));
  b.tube(P3, r, key, { closed: true, radial: 5, seg: Math.min(72, P3.length * 2) });
}

/** colliders for a wall: thin boxes over the face, the holes left open */
function wallColliders(b, room, face, holes) {
  const F = faceFrame(room, face, 0);
  const T = 0.14;
  const us = [F.u0, F.u1], vs = [F.v0, F.v1];
  for (const h of holes) { us.push(h.u - h.w / 2, h.u + h.w / 2); vs.push(h.v - h.h / 2, h.v + h.h / 2); }
  const U = [...new Set(us.map((x) => +x.toFixed(4)))].filter((x) => x >= F.u0 - 1e-6 && x <= F.u1 + 1e-6).sort((a, c) => a - c);
  const Vs = [...new Set(vs.map((x) => +x.toFixed(4)))].filter((x) => x >= F.v0 - 1e-6 && x <= F.v1 + 1e-6).sort((a, c) => a - c);
  const inHole = (u, v) => holes.some((h) => Math.abs(u - h.u) < h.w / 2 && Math.abs(v - h.v) < h.h / 2);
  const pl = F.plane + F.s * T / 2;
  for (let j = 0; j < Vs.length - 1; j++) {
    let i = 0;
    while (i < U.length - 1) {
      const vm = (Vs[j] + Vs[j + 1]) / 2;
      if (inHole((U[i] + U[i + 1]) / 2, vm)) { i++; continue; }
      let k = i + 1;
      while (k < U.length - 1 && !inHole((U[k] + U[k + 1]) / 2, vm)) k++;
      const ua = U[i], ub = U[k], va = Vs[j], vb = Vs[j + 1];
      const c = V(0, 0, 0), size = V(0, 0, 0);
      c[F.a] = pl; c[F.ua] = (ua + ub) / 2; c[F.va] = (va + vb) / 2;
      size[F.a] = T; size[F.ua] = ub - ua + 0.02; size[F.va] = vb - va + 0.02;
      b.colBox(size.x, size.y, size.z, c.toArray());
      i = k;
    }
  }
}

/** a handrail between a and c, on stand-offs toward the wall (n: unit vector to the wall) */
function rail(b, a, c, n, key = 'rail') {
  const A = Array.isArray(a) ? V(...a) : a, C = Array.isArray(c) ? V(...c) : c;
  b.pipe(A, C, 0.017, key, 8);
  const L = A.distanceTo(C), k = Math.max(1, Math.round(L / 0.8));
  for (let i = 0; i <= k; i++) { const p = A.clone().lerp(C, i / k); b.pipe(p, p.clone().addScaledVector(n, 0.07), 0.009, 'steel', 6); }
}

/** a cargo transfer bag strapped down */
function bag(b, R, x, y, z, w, h, d, rot) {
  b.box(w, h, d, 'bag', [x, y, z], rot, Math.min(0.05, w * 0.2, h * 0.2), 2);
  b.box(w + 0.01, 0.025, d * 0.5, 'strap', [x, y + h * 0.18, z], rot, 0.005);
  b.box(w * 0.4, h * 0.3, 0.004, 'white', [x, y + h * 0.05, z + d / 2 + 0.002], rot, 0.002);
}

// ------------------------------------------------------------------ the station inside
export function buildOriginInterior(renderer, def) {
  const M = originMaterials(renderer);
  const b = new Builder();
  // plain boxes for the props (the rounding is invisible at arm's length, the vertices are not)
  b.plainUpTo = 0.05;
  const R = rng(1337);
  const lamps = [];
  const lamp = (x, y, z, color, intensity, range = 8) => lamps.push({ pos: V(x, y, z), color, intensity, range, room: 'station' });
  const group = new THREE.Group();
  group.name = 'originInterior';
  const moving = [];      // animated parts (own meshes)
  const screens = [];     // { S, room }
  const room = (id) => roomById(id);
  /** a screen (mesh material) on a wall: the point on the wall, its normal into the room */
  const RY = { '+z': 0, '-z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 };
  const mount = (mat, at, n, w, h) => {
    const ry = RY[n], d = V(0, 0, 0); d[n[1]] = n[0] === '+' ? 1 : -1;
    const bx = n[1] === 'x' ? 0.04 : w + 0.15, bz = n[1] === 'x' ? w + 0.15 : 0.04;
    b.box(bx, h + 0.14, bz, 'dark', at.clone().addScaledVector(d, 0.02).toArray(), null, 0.01);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.copy(at).addScaledVector(d, 0.045); m.rotation.y = ry;
    group.add(m);
    return m;
  };

  // ---- walls, windows and portals of every space
  const wallKey = { node: 'panel', corr: 'rack', power: 'panel', ops: 'panelDark', farm: 'panel', food: 'panelCold', store: 'panel', robot: 'panel', cupola: 'panel' };
  const floorKey = { power: 'deck', ops: 'deck', farm: 'deck', food: 'deck', store: 'deck', robot: 'deck' };
  for (const rm of ORIGIN_ROOMS) {
    for (const face of FACES) {
      const holes = holesOf(rm, face);
      const key = face === '-y' && floorKey[rm.id] ? floorKey[rm.id] : wallKey[rm.id];
      b.add(faceGeo(rm, face, holes, 0, false), key);
      const F = faceFrame(rm, face, 0);
      for (const h of holes) {
        if (h.kind === 'window') {
          // through the skin: the reveal, the pane at the outer skin, a trim ring inside
          b.add(revealGeo(F, h, F.plane, F.plane + F.s * ORIGIN_WALL), 'steel');
          const pane = new THREE.ShapeGeometry(new THREE.Shape(rrPts(h.u, h.v, h.w + 0.02, h.h + 0.02, h.r + 0.01, 10).map(([u, v]) => new THREE.Vector2(u, v))), 4);
          const pp = pane.attributes.position, p = V(0, 0, 0);
          const Fo = Object.assign({}, F, { plane: F.plane + F.s * (ORIGIN_WALL - 0.03) });
          for (let i = 0; i < pp.count; i++) { to3(Fo, pp.getX(i), pp.getY(i), p); pp.setXYZ(i, p.x, p.y, p.z); }
          b.add(pane, 'glass');
          trimRing(b, F, h, F.plane - F.s * 0.015, 0.025, 'steel');
        } else if (h.kind === 'cupola') {
          b.add(revealGeo(F, h, F.plane, F.plane + F.s * ORIGIN_WALL), 'dark');
        } else if (h.kind === 'portal' && h.portal.a === rm.id && !h.portal.door) {
          // an open hatchway through both walls: its lining, trim rings both ends, hazard sills
          const P = h.portal, other = room(P.b);
          const Fo = faceFrame(other, (F.s > 0 ? '-' : '+') + F.a, 0);
          b.add(revealGeo(F, h, F.plane, Fo.plane), 'steel');
          trimRing(b, F, h, F.plane - F.s * 0.02, 0.035, 'railY');
          trimRing(b, F, h, Fo.plane + F.s * 0.02, 0.035, 'railY');
        }
      }
      // colliders: windows are solid glass, portals and the tunnel open
      // (the cupola's round hole: a square inside it, the cupola's own walls take over below)
      const open = holes.filter((h) => h.kind === 'portal' || h.kind === 'tunnel' || h.kind === 'cupola').map((h) => (h.kind === 'cupola' ? Object.assign({}, h, { w: 2.5, h: 2.5 }) : h));
      wallColliders(b, rm, face, open);
    }
  }

  // ---- the docking tunnel from B-29's outer hatch to the port node
  {
    const hull = openingOutline(HATCH, 0, 48, 0.1);
    const r1 = tunnelRing(TUNNEL.x0, TUNNEL.hu, TUNNEL.hv, TUNNEL.r);
    const r2 = tunnelRing(TUNNEL.xEnd, TUNNEL.hu, TUNNEL.hv, TUNNEL.r);
    b.add(loft([hull, r1, r2], { ring: true, caps: false, invert: true }), 'hullInner');
    const o1 = tunnelRing(TUNNEL.x0, TUNNEL.hu + 0.09, TUNNEL.hv + 0.09, TUNNEL.r + 0.09);
    const o2 = tunnelRing(TUNNEL.xEnd - 0.25, TUNNEL.hu + 0.09, TUNNEL.hv + 0.09, TUNNEL.r + 0.09);
    const hullO = openingOutline(HATCH, 0, 48, 0.2);
    b.add(loft([hullO, o1, o2], { ring: true, caps: false }), 'hullOut');
    for (const x of [TUNNEL.x0 + 0.2, (TUNNEL.x0 + TUNNEL.xEnd) / 2]) b.tube(tunnelRing(x, TUNNEL.hu - 0.02, TUNNEL.hv - 0.02, TUNNEL.r - 0.02), 0.025, 'steel', { closed: true, radial: 6, seg: 96 });
    b.box(TUNNEL.xEnd - 3.0, 0.03, 1.1, 'grate', [(3.0 + TUNNEL.xEnd) / 2, 0.255, TUNNEL.zc], null, 0.005);
    b.colBox(TUNNEL.xEnd - 2.95, 0.1, 1.5, [(2.95 + TUNNEL.xEnd) / 2, 0.2, TUNNEL.zc]);
    for (const s of [-1, 1]) {
      b.pipe([3.25, 1.05, TUNNEL.zc + s * 0.66], [TUNNEL.xEnd - 0.05, 1.05, TUNNEL.zc + s * 0.66], 0.018, 'rail', 8);
      b.pipe([3.25, 2.05, TUNNEL.zc + s * 0.42], [TUNNEL.xEnd - 0.05, 2.05, TUNNEL.zc + s * 0.42], 0.01, 'led', 6);
      b.colBox(TUNNEL.xEnd - 3.0, 2.2, 0.1, [(3.0 + TUNNEL.xEnd) / 2, 1.2, TUNNEL.zc + s * (TUNNEL.hv + 0.05)]);
    }
    b.colBox(TUNNEL.xEnd - 3.0, 0.1, 1.6, [(3.0 + TUNNEL.xEnd) / 2, TUNNEL.yc + TUNNEL.hu + 0.05, TUNNEL.zc]);
    // the docking ring round the tunnel mouth: hazard band and the yellow alignment marks
    const N0 = room('node');
    const F = faceFrame(N0, '-x', 0);
    const h = { u: TUNNEL.zc, v: TUNNEL.yc, w: TUNNEL.hv * 2, h: TUNNEL.hu * 2, r: TUNNEL.r };
    trimRing(b, F, h, N0.x0 + 0.03, 0.05, 'railY');
    trimRing(b, F, { u: h.u, v: h.v, w: h.w + 0.36, h: h.h + 0.36, r: h.r + 0.18 }, N0.x0 + 0.02, 0.03, 'steel');
    lamp(4.3, 2.0, TUNNEL.zc, 0xe8f0ff, 2.0, 5);
  }

  // ================================================================ the port node
  {
    const N0 = room('node'), cx = 7.6, cy = 1.22, cz = -1.05;
    // the station's name over the corridor door
    mount(M.name, V(N0.x1, 2.85, cz), '-x', 2.6, 0.65);
    // screens: the supply board (-z wall) and the welcome (+z wall)
    const sup = screen(1024, 576, drawSupply);
    const wel = screen(1024, 576, drawWelcome);
    wel.redraw(null);
    mount(sup.mat, V(cx, 1.5, N0.z0), '+z', 2.6, 1.46);
    mount(wel.mat, V(cx, 1.5, N0.z1), '-z', 2.6, 1.46);
    screens.push({ S: sup, room: 'node', every: 0.5 }, { S: wel, room: 'node', static: true });
    // handrails round the walls, an LED ring round the overhead window, the floor window's blue ring
    for (const y of [0.3, 2.3]) {
      rail(b, [N0.x0 + 0.5, y, N0.z0 + 0.12], [N0.x1 - 0.5, y, N0.z0 + 0.12], V(0, 0, -1));
      rail(b, [N0.x0 + 0.5, y, N0.z1 - 0.12], [N0.x1 - 0.5, y, N0.z1 - 0.12], V(0, 0, 1));
    }
    for (const z of [N0.z0 + 0.5, N0.z1 - 0.5]) rail(b, [N0.x1 - 0.12, -0.6, z], [N0.x1 - 0.12, 3.0, z], V(1, 0, 0), 'railY');
    b.torus(1.48, 0.03, 'led', [cx, N0.y1 - 0.03, cz], [Math.PI / 2, 0, 0], 48);
    b.torus(0.98, 0.03, 'ledBlue', [cx, N0.y0 + 0.03, cz], [Math.PI / 2, 0, 0], 48);
    // a fire extinguisher, a first-aid box, the O2 masks
    b.cyl(0.07, 0.07, 0.45, 'crateO', [N0.x0 + 0.12, 0.0, N0.z0 + 0.6], null, 12);
    b.box(0.3, 0.22, 0.1, 'white', [N0.x0 + 0.08, 2.9, N0.z1 - 0.7], [0, Math.PI / 2, 0], 0.02);
    b.box(0.06, 0.06, 0.006, 'ledR', [N0.x0 + 0.13, 2.9, N0.z1 - 0.7], [0, Math.PI / 2, 0], 0.002);
    b.add(signPlane(0, 1.3, 0.16), 'signs', [N0.x0 + 0.02, 2.6, cz], [0, Math.PI / 2, 0]);
    lamp(cx, 3.0, cz, 0xeef4ff, 3.2, 8);
    lamp(cx, -0.5, cz, 0x9fd0ff, 0.8, 5);
  }

  // ================================================================ the main corridor
  {
    const C = room('corr'), x0 = C.x0, x1 = C.x1, cy = 1.22, cz = -1.05;
    const zL = C.z0, zR = C.z1, yB = C.y0, yT = C.y1;
    // segment frames (where two module sections meet)
    for (const x of [12.2, 19.6, 23.6, 31.9, 36.2, 44.6]) {
      b.box(0.14, 0.14, zR - zL, 'steel', [x, yT - 0.07, cz], null, 0.01);
      b.box(0.14, 0.14, zR - zL, 'steel', [x, yB + 0.07, cz], null, 0.01);
      b.box(0.14, yT - yB, 0.14, 'steel', [x, cy, zL + 0.07], null, 0.01);
      b.box(0.14, yT - yB, 0.14, 'steel', [x, cy, zR - 0.07], null, 0.01);
    }
    // handrails along the four corners, LED strips along the ceiling, cable runs along the floor
    for (const [y, z, n] of [[yT - 0.18, zL + 0.18, V(0, 0.7, -0.7)], [yT - 0.18, zR - 0.18, V(0, 0.7, 0.7)], [yB + 0.18, zL + 0.18, V(0, -0.7, -0.7)], [yB + 0.18, zR - 0.18, V(0, -0.7, 0.7)]]) {
      rail(b, V(x0 + 0.3, y, z), V(x1 - 0.3, y, z), n, y > cy ? 'rail' : 'railY');
    }
    for (const z of [zL + 0.45, zR - 0.45]) b.box(x1 - x0 - 0.4, 0.02, 0.05, 'led', [(x0 + x1) / 2, yT - 0.012, z], null, 0);
    for (const z of [zL + 0.06, zR - 0.06]) { b.pipe([x0 + 0.2, yB + 0.06, z], [x1 - 0.2, yB + 0.06, z], 0.03, 'cable', 6); b.pipe([x0 + 0.2, yB + 0.12, z], [x1 - 0.2, yB + 0.12, z], 0.022, 'cable', 6); }
    // stowage bags strapped to the racks here and there, small screens, foot loops
    for (let x = x0 + 1.4; x < x1 - 1.2; x += 2.3 + R() * 1.6) {
      const nearPortal = ORIGIN_PORTALS.some((P) => P.n === 'z' && Math.abs(P.p[0] - x) < 1.3);
      if (nearPortal) continue;
      const side = R() < 0.5 ? -1 : 1;
      const z = side < 0 ? zL + 0.2 : zR - 0.2;
      if (R() < 0.6) bag(b, R, x, 0.6 + R() * 1.2, z, 0.5, 0.32, 0.36, null);
      else { b.box(0.34, 0.22, 0.03, 'black', [x, 1.5, side < 0 ? zL + 0.02 : zR - 0.02], null, 0.01); b.box(0.3, 0.18, 0.004, 'ledBlue', [x, 1.5, side < 0 ? zL + 0.036 : zR - 0.036], null, 0.002); }
    }
    // signs over the side doors, the way along at both ends
    const ids = { power: 2, ops: 3, farm: 4, food: 5, store: 6, robot: 7 };
    for (const P of ORIGIN_PORTALS) {
      if (P.n !== 'z') continue;
      const toRoom = P.b, i = ids[toRoom];
      if (i === undefined) continue;
      const side = P.p[2] < cz ? -1 : 1;
      b.add(signPlane(i, 1.15, 0.15), 'signs', [P.p[0], 2.32, side < 0 ? zL + 0.02 : zR - 0.02], [0, side < 0 ? 0 : Math.PI, 0]);
    }
    b.add(signPlane(10, 1.3, 0.16), 'signs', [x0 + 0.02, 2.3, cz], [0, Math.PI / 2, 0]);
    b.add(signPlane(9, 1.3, 0.16), 'signs', [x1 - 0.02, 2.3, cz], [0, -Math.PI / 2, 0]);
    for (let x = x0 + 3; x < x1; x += 6) lamp(x, yT - 0.3, cz, 0xf2f6ff, 2.4, 6.5);
    // two free-flying robots working along it
    for (let k = 0; k < 2; k++) {
      const rb = new Builder();
      rb.box(0.32, 0.32, 0.32, 'robot', [0, 0, 0], null, 0.04, 3);
      for (const s of [-1, 1]) { rb.cyl(0.11, 0.11, 0.02, 'dark', [s * 0.165, 0, 0], [0, 0, Math.PI / 2], 16); rb.box(0.02, 0.26, 0.26, 'robotBlue', [s * 0.16, 0, 0], null, 0.01); }
      rb.box(0.1, 0.04, 0.02, 'ledG', [0, 0.08, 0.165], null, 0.005);
      rb.cyl(0.04, 0.04, 0.03, 'black', [0, -0.02, 0.17], [Math.PI / 2, 0, 0], 12);
      rb.box(0.04, 0.04, 0.22, 'steel', [0.08, -0.17, 0.05], null, 0.01);
      const grp = rb.build(M, { castShadow: false });
      grp.position.set(x0 + 6 + k * 14, cy, cz);
      group.add(grp);
      moving.push({ kind: 'flyer', obj: grp, k, x: grp.position.x, target: grp.position.x, wait: 1 + k * 3 });
    }
  }

  // ================================================================ power control room
  {
    const P = room('power'), y0 = P.y0, cz = (P.z0 + P.z1) / 2, cx = (P.x0 + P.x1) / 2;
    // the grid display on the -x wall, consoles facing the big window, energy cells by the +x wall
    const pw = screen(1024, 576, drawPower);
    mount(pw.mat, V(P.x0, 1.35, cz), '+x', 4.2, 2.36);
    screens.push({ S: pw, room: 'power', every: 0.25 });
    for (let k = 0; k < 3; k++) {
      const x = cx - 2.0 + k * 2.0, z = P.z0 + 1.5;
      b.box(1.6, 0.85, 0.7, 'dark', [x, y0 + 0.43, z], null, 0.04, 2);
      b.box(1.62, 0.05, 0.75, 'steel', [x, y0 + 0.88, z], null, 0.01);
      b.box(1.3, 0.62, 0.04, 'black', [x, y0 + 1.25, z + 0.28], [-0.35, 0, 0], 0.01);
      b.box(1.2, 0.54, 0.004, 'ledBlue', [x, y0 + 1.25 + 0.009, z + 0.303], [-0.35, 0, 0], 0.002);
      b.colBox(1.6, 0.9, 0.7, [x, y0 + 0.45, z]);
    }
    const cells = new Builder();
    for (let k = 0; k < 3; k++) {
      const z = P.z0 + 1.4 + k * 1.6, x = P.x1 - 0.7;
      b.cyl(0.42, 0.42, 0.2, 'steel', [x, y0 + 0.1, z], null, 24);
      b.cyl(0.42, 0.42, 0.2, 'steel', [x, P.y1 - 0.1, z], null, 24);
      b.cyl(0.36, 0.36, P.y1 - y0 - 0.4, 'glassTube', [x, (y0 + P.y1) / 2, z], null, 24, true);
      cells.cyl(0.2, 0.2, P.y1 - y0 - 0.5, 'energy', [x, (y0 + P.y1) / 2, z], null, 16);
      for (let i = 0; i < 6; i++) b.torus(0.37, 0.015, 'steel', [x, y0 + 0.5 + i * 0.5, z], [Math.PI / 2, 0, 0], 14);
      b.colCyl(0.42, P.y1 - y0, [x, (y0 + P.y1) / 2, z]);
    }
    const cg = cells.build(M, { castShadow: false });
    group.add(cg);
    moving.push({ kind: 'pulse', mat: M.energy });
    b.add(signPlane(2, 1.2, 0.15), 'signs', [cx, P.y1 - 0.25, P.z1 - 0.02], [0, Math.PI, 0]);
    lamp(cx - 2, P.y1 - 0.3, cz, 0xe6f0ff, 2.6, 7);
    lamp(cx + 2, P.y1 - 0.3, cz, 0xe6f0ff, 2.6, 7);
    lamp(P.x1 - 0.8, 1.2, cz, 0x5fb8ff, 1.6, 4);
  }

  // ================================================================ operations centre
  {
    const O = room('ops'), y0 = O.y0, cz = (O.z0 + O.z1) / 2, cx = (O.x0 + O.x1) / 2;
    const ops = screen(1024, 576, drawOps), map = screen(1024, 576, drawMap);
    for (const [S, z] of [[map, cz - 1.45], [ops, cz + 1.45]]) mount(S.mat, V(O.x1, 1.5, z), '-x', 2.6, 1.46);
    screens.push({ S: ops, room: 'ops', every: 1 }, { S: map, room: 'ops', every: 0.2 });
    // the automation core: server racks along the -x wall
    for (let k = 0; k < 4; k++) {
      const z = O.z0 + 0.9 + k * 1.2;
      b.box(0.8, O.y1 - y0 - 0.3, 1.0, 'dark', [O.x0 + 0.45, (y0 + O.y1) / 2 - 0.15, z], null, 0.02);
      b.add(new THREE.PlaneGeometry(0.9, O.y1 - y0 - 0.5), 'server', [O.x0 + 0.86, (y0 + O.y1) / 2 - 0.15, z], [0, Math.PI / 2, 0]);
      b.colBox(0.8, O.y1 - y0 - 0.3, 1.0, [O.x0 + 0.45, (y0 + O.y1) / 2 - 0.15, z]);
    }
    // a round table with the station's hologram turning over it
    b.cyl(0.9, 0.9, 0.08, 'steel', [cx + 0.6, y0 + 0.85, cz], null, 32);
    b.cyl(0.2, 0.35, 0.8, 'dark', [cx + 0.6, y0 + 0.4, cz], null, 16);
    b.cyl(0.6, 0.6, 0.01, 'ledBlue', [cx + 0.6, y0 + 0.9, cz], null, 32);
    b.colCyl(0.9, 0.9, [cx + 0.6, y0 + 0.45, cz]);
    const hb = new Builder();
    hb.box(1.2, 0.04, 0.04, 'ledBlue', [0, 0, 0], null, 0);
    for (const s of [-1, 1]) for (const t of [-1, 1]) hb.box(0.24, 0.01, 0.12, 'ledBlue', [s * 0.36, 0, t * 0.12], null, 0);
    hb.box(0.04, 0.04, 0.6, 'ledBlue', [0, 0, 0], null, 0);
    hb.torus(0.16, 0.012, 'ledBlue', [0, 0, 0.42], [0, Math.PI / 2, 0], 24);
    const holo = hb.build(M, { castShadow: false });
    holo.position.set(cx + 0.6, y0 + 1.35, cz);
    group.add(holo);
    moving.push({ kind: 'spin', obj: holo, w: 0.35 });
    b.add(signPlane(3, 1.2, 0.15), 'signs', [cx, O.y1 - 0.25, O.z0 + 0.02], [0, 0, 0]);
    lamp(cx, O.y1 - 0.3, cz, 0xd8e6ff, 2.2, 7);
    lamp(cx + 0.6, y0 + 1.4, cz, 0x5fb8ff, 1.2, 4);
  }

  // ================================================================ hydroponic farm
  {
    const F = room('farm'), y0 = F.y0, cx = (F.x0 + F.x1) / 2;
    const rows = [F.z0 + 1.4, (F.z0 + F.z1) / 2, F.z1 - 1.6];
    for (const z of rows) {
      const L = F.x1 - F.x0 - 1.6;
      for (let t = 0; t < 3; t++) {
        const y = y0 + 0.5 + t * 1.15;
        b.box(L, 0.08, 0.9, 'tray', [cx, y, z], null, 0.01);
        b.box(L, 0.04, 0.95, 'grow', [cx, y + 0.95, z], null, 0);
        // the plants: clumps of leaves along the tray
        for (let x = F.x0 + 1.0; x < F.x1 - 0.9; x += 0.4) {
          const s = 0.14 + R() * 0.1, zz = z + (R() - 0.5) * 0.4;
          b.add(new THREE.IcosahedronGeometry(s, 0), R() < 0.5 ? 'leaf' : 'leafLight', [x, y + 0.04 + s * 0.8, zz], [R() * 3, R() * 3, 0], [1, 0.8 + R() * 0.5, 1]);
          if (R() < 0.12) b.add(new THREE.IcosahedronGeometry(0.04, 0), 'fruit', [x + 0.05, y + 0.1 + s, zz]);
        }
        b.pipe([F.x0 + 0.8, y + 0.1, z + 0.48], [F.x1 - 0.8, y + 0.1, z + 0.48], 0.02, 'robotBlue', 6);
      }
      for (const x of [F.x0 + 0.8, F.x1 - 0.8]) b.box(0.08, F.y1 - y0 - 0.2, 0.08, 'steel', [x, (y0 + F.y1) / 2, z], null, 0.01);
      b.colBox(F.x1 - F.x0 - 1.6, F.y1 - y0 - 0.4, 0.95, [cx, (y0 + F.y1) / 2, z]);
    }
    // the harvester: a carriage on a rail over the middle row, its arm reaching down
    const zm = rows[1];
    b.box(F.x1 - F.x0 - 0.6, 0.08, 0.12, 'steel', [cx, F.y1 - 0.2, zm], null, 0.01);
    const hv = new Builder();
    hv.box(0.5, 0.22, 0.32, 'robot', [0, 0, 0], null, 0.03);
    hv.box(0.06, 0.6, 0.06, 'steel', [0, -0.4, 0], null, 0.01);
    hv.box(0.2, 0.06, 0.12, 'robotBlue', [0, -0.72, 0], null, 0.01);
    hv.box(0.06, 0.03, 0.004, 'ledG', [0.12, 0.05, 0.162], null, 0.002);
    const harv = hv.build(M, { castShadow: false });
    harv.position.set(cx, F.y1 - 0.36, zm);
    group.add(harv);
    moving.push({ kind: 'harvester', obj: harv, x0: F.x0 + 1.2, x1: F.x1 - 1.2 });
    b.add(signPlane(4, 1.2, 0.15), 'signs', [cx, F.y1 - 0.3, F.z1 - 0.02], [0, Math.PI, 0]);
    lamp(cx - 3, F.y1 - 0.4, (F.z0 + F.z1) / 2, 0xff7ad8, 2.6, 8);
    lamp(cx + 3, F.y1 - 0.4, (F.z0 + F.z1) / 2, 0xff7ad8, 2.6, 8);
    lamp(cx, 1.0, F.z1 - 0.6, 0xf0f4ff, 1.4, 5);
  }

  // ================================================================ cold food store
  {
    const Fd = room('food'), y0 = Fd.y0, cx = (Fd.x0 + Fd.x1) / 2, cz = (Fd.z0 + Fd.z1) / 2;
    // freezer cabinets along the far wall and the -x wall: frosted glass fronts over lit shelves
    const unit = (x, z, ry) => {
      b.box(1.2, 2.3, 0.75, 'white', [x, y0 + 1.15, z], [0, ry, 0], 0.03, 2);
      const n = V(Math.sin(ry), 0, Math.cos(ry));
      b.add(new THREE.PlaneGeometry(1.0, 1.95), 'frostGlass', [x + n.x * 0.38, y0 + 1.2, z + n.z * 0.38], [0, ry, 0]);
      b.box(0.04, 0.5, 0.04, 'steel', [x + n.x * 0.42 + Math.cos(ry) * 0.42, y0 + 1.2, z + n.z * 0.42 - Math.sin(ry) * 0.42], [0, ry, 0], 0.01);
      b.box(1.0, 0.03, 0.02, 'cold', [x + n.x * 0.39, y0 + 2.22, z + n.z * 0.39], [0, ry, 0], 0.005);
      b.colBox(1.2, 2.3, 0.75, [x, y0 + 1.15, z], [0, ry, 0]);
    };
    for (let k = 0; k < 8; k++) unit(Fd.x0 + 1.0 + k * 1.3, Fd.z1 - 0.42, Math.PI);
    for (let k = 0; k < 3; k++) unit(Fd.x0 + 0.42, Fd.z0 + 1.7 + k * 1.3, Math.PI / 2);
    // open shelving down the middle with sealed food containers
    for (const z of [cz - 0.4]) {
      for (let t = 0; t < 4; t++) b.box(7.0, 0.04, 0.8, 'steel', [cx + 0.6, y0 + 0.3 + t * 0.6, z], null, 0.01);
      for (const x of [cx - 2.9, cx + 0.6, cx + 4.1]) b.box(0.05, 2.2, 0.8, 'steel', [x, y0 + 1.1, z], null, 0.01);
      for (let t = 0; t < 4; t++) for (let x = cx - 2.7; x < cx + 3.9; x += 0.42) {
        const k = ['crateB', 'white', 'crateO', 'white', 'crateY'][Math.floor(R() * 5)];
        b.box(0.36, 0.3 + R() * 0.15, 0.6, k, [x + 0.18, y0 + 0.5 + t * 0.6, z], null, 0.02);
      }
      b.colBox(7.0, 2.4, 0.8, [cx + 0.6, y0 + 1.2, z]);
    }
    const fd = screen(1024, 576, drawFood);
    fd.redraw(null);
    mount(fd.mat, V(Fd.x1, 1.4, Fd.z0 + 1.6), '-x', 1.8, 1.0);
    screens.push({ S: fd, room: 'food', static: true });
    b.add(signPlane(11, 1.0, 0.13), 'signs', [Fd.x0 + 1.6, y0 + 2.45, Fd.z1 - 0.8], [0, Math.PI, 0]);
    b.add(signPlane(5, 1.2, 0.15), 'signs', [cx, Fd.y1 - 0.25, Fd.z0 + 0.02], [0, 0, 0]);
    lamp(cx - 2.5, Fd.y1 - 0.3, cz, 0xcfe8ff, 2.4, 7);
    lamp(cx + 2.5, Fd.y1 - 0.3, cz, 0xcfe8ff, 2.4, 7);
  }

  // ================================================================ supply warehouse
  {
    const St = room('store'), y0 = St.y0, cx = (St.x0 + St.x1) / 2, cz = (St.z0 + St.z1) / 2;
    // tall racks in three rows along x, four shelves, filled with cargo
    const rowsZ = [St.z0 + 1.2, St.z0 + 4.6, St.z0 + 8.0];
    const keys = ['bag', 'bag', 'crateO', 'crateG', 'crateB', 'crateY'];
    for (const z of rowsZ) {
      const L = St.x1 - St.x0 - 1.6;
      for (let t = 0; t < 5; t++) b.box(L, 0.06, 1.3, 'steel', [cx, y0 + 0.2 + t * 1.6, z], null, 0.01);
      for (let x = St.x0 + 0.8; x <= St.x1 - 0.79; x += L / 4) b.box(0.1, 6.6, 1.3, 'crateG', [x, y0 + 3.3, z], null, 0.01);
      for (let t = 0; t < 4; t++) for (let x = St.x0 + 1.1; x < St.x1 - 1.0; x += 0.9 + R() * 0.3) {
        if (R() < 0.18) continue;
        const k = keys[Math.floor(R() * keys.length)], w = 0.6 + R() * 0.2, h = 0.5 + R() * 0.7;
        if (k === 'bag') bag(b, R, x, y0 + 0.23 + t * 1.6 + h / 2, z, w, h, 0.9, null);
        else { b.box(w, h, 1.0, k, [x, y0 + 0.23 + t * 1.6 + h / 2, z], null, 0.02); b.box(w * 0.5, 0.12, 0.005, 'white', [x, y0 + 0.23 + t * 1.6 + h * 0.6, z + 0.503], null, 0.002); }
      }
      b.colBox(L, 6.6, 1.3, [cx, y0 + 3.3, z]);
    }
    // hazard lanes on the deck
    for (const z of [St.z0 + 2.9, St.z0 + 6.3]) b.box(St.x1 - St.x0 - 1.0, 0.006, 0.3, 'hazard', [cx, y0 + 0.004, z], null, 0);
    // the gantry: rails along z under the ceiling, a bridge across, a carriage with a hoist
    for (const x of [St.x0 + 0.4, St.x1 - 0.4]) b.box(0.18, 0.22, St.z1 - St.z0 - 0.4, 'crateY', [x, St.y1 - 0.25, cz], null, 0.01);
    const bridgeB = new Builder();
    bridgeB.box(St.x1 - St.x0 - 0.6, 0.3, 0.3, 'crateY', [0, 0, 0], null, 0.02);
    bridgeB.box(0.12, 0.12, 0.6, 'hazard', [-(St.x1 - St.x0) / 2 + 0.5, -0.05, 0], null, 0.005);
    const bridge = bridgeB.build(M, { castShadow: false });
    bridge.position.set(cx, St.y1 - 0.45, cz);
    group.add(bridge);
    const carB = new Builder();
    carB.box(0.7, 0.4, 0.6, 'robot', [0, 0, 0], null, 0.04);
    carB.box(0.1, 0.03, 0.004, 'ledG', [0.2, 0.1, 0.302], null, 0.002);
    const car = carB.build(M, { castShadow: false });
    bridge.add(car);
    const hoistB = new Builder();
    hoistB.box(0.08, 1.0, 0.08, 'steel', [0, 0.5, 0], null, 0.01);
    hoistB.box(0.9, 0.08, 0.7, 'dark', [0, 0, 0], null, 0.01);
    hoistB.box(0.8, 0.6, 0.6, 'crateO', [0, -0.36, 0], null, 0.03);
    const hoist = hoistB.build(M, { castShadow: false });
    car.add(hoist);
    moving.push({ kind: 'gantry', bridge, car, hoist, St, rowsZ, t: 0 });
    b.add(signPlane(6, 1.4, 0.18), 'signs', [cx, 2.3, St.z1 - 0.02], [0, Math.PI, 0]);
    for (const x of [cx - 2.6, cx + 2.6]) for (const z of [St.z0 + 3, St.z0 + 9]) lamp(x, St.y1 - 0.6, z, 0xf6f2e6, 2.6, 9);
  }

  // ================================================================ robot bay
  {
    const Rb = room('robot'), y0 = Rb.y0, cx = (Rb.x0 + Rb.x1) / 2, cz = (Rb.z0 + Rb.z1) / 2;
    // charging docks on the +x wall: robots resting in their cradles
    b.add(new THREE.PlaneGeometry(Rb.z1 - Rb.z0 - 0.6, 2.2), 'peg', [Rb.x1 - 0.02, y0 + 1.6, cz], [0, -Math.PI / 2, 0]);
    for (let k = 0; k < 4; k++) {
      const z = Rb.z0 + 1.0 + k * 1.3, x = Rb.x1 - 0.3;
      b.box(0.1, 0.5, 0.5, 'dark', [x + 0.2, y0 + 1.6, z], null, 0.02);
      b.box(0.32, 0.32, 0.32, 'robot', [x - 0.05, y0 + 1.6, z], null, 0.04, 3);
      b.box(0.02, 0.26, 0.26, 'robotBlue', [x - 0.22, y0 + 1.6, z], null, 0.01);
      b.box(0.004, 0.04, 0.1, k === 1 ? 'ledR' : 'ledG', [x - 0.232, y0 + 1.72, z], null, 0.002);
    }
    // the workbench with a robot opened up, the arm over it
    b.box(2.4, 0.9, 1.1, 'dark', [cx - 0.5, y0 + 0.45, cz], null, 0.03);
    b.box(2.45, 0.05, 1.15, 'steel', [cx - 0.5, y0 + 0.92, cz], null, 0.01);
    b.box(0.32, 0.25, 0.32, 'robot', [cx - 0.6, y0 + 1.07, cz], [0, 0.4, 0], 0.03);
    b.box(0.3, 0.02, 0.3, 'robotBlue', [cx - 0.1, y0 + 0.96, cz + 0.2], [0, 0.2, 0], 0.005);
    b.colBox(2.4, 0.95, 1.1, [cx - 0.5, y0 + 0.47, cz]);
    b.cyl(0.14, 0.18, 0.2, 'steel', [cx + 0.6, y0 + 1.04, cz - 0.3], null, 16);
    const armB = new Builder();
    armB.box(0.09, 0.6, 0.09, 'robot', [0, 0.3, 0], null, 0.02);
    const arm = armB.build(M, { castShadow: false });
    const fore = new Builder();
    fore.box(0.07, 0.07, 0.5, 'robot', [0, 0, -0.25], null, 0.02);
    fore.box(0.06, 0.1, 0.06, 'steel', [0, -0.06, -0.5], null, 0.01);
    fore.box(0.03, 0.03, 0.03, 'ledBlue', [0, -0.12, -0.5], null, 0.005);
    const fa = fore.build(M, { castShadow: false });
    fa.position.set(0, 0.6, 0);
    arm.add(fa);
    arm.position.set(cx + 0.6, y0 + 1.14, cz - 0.3);
    group.add(arm);
    moving.push({ kind: 'arm', arm, fore: fa, t: 0 });
    const rs = screen(1024, 576, drawRobots);
    mount(rs.mat, V(Rb.x0, 1.5, cz), '+x', 1.8, 1.0);
    screens.push({ S: rs, room: 'robot', every: 1 });
    b.add(signPlane(7, 1.2, 0.15), 'signs', [cx, Rb.y1 - 0.25, Rb.z0 + 0.02], [0, 0, 0]);
    lamp(cx - 2, Rb.y1 - 0.3, cz, 0xeef2ff, 2.4, 7);
    lamp(cx + 2, Rb.y1 - 0.3, cz, 0xeef2ff, 2.4, 7);
  }

  // ================================================================ observation node and cupola
  {
    const Cu = room('cupola'), cx = 49.0, cz = -1.05;
    const top = Cu.y0, depth = 1.25, r0 = 1.8, r1 = 1.05;
    // the cupola: six trapezoid panes round a round one at the bottom, in a dark frame
    const ring = (y, r) => { const p = []; for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + Math.PI / 6; p.push(V(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r)); } return p; };
    const A = ring(top - ORIGIN_WALL, r0), Bt = ring(top - depth, r1);
    for (let k = 0; k < 6; k++) {
      const a0 = A[k], a1 = A[(k + 1) % 6], b0 = Bt[k], b1 = Bt[(k + 1) % 6];
      const quad = (p, q, r2, s, key) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...p.toArray(), ...q.toArray(), ...r2.toArray(), ...p.toArray(), ...r2.toArray(), ...s.toArray()], 3)); g.computeVertexNormals(); b.add(g, key); };
      // pane inset in its frame
      const c = a0.clone().add(a1).add(b0).add(b1).multiplyScalar(0.25);
      const ins = (p) => p.clone().lerp(c, 0.12);
      quad(ins(a0), ins(a1), ins(b1), ins(b0), 'glass');
      b.pipe(a0, b0, 0.05, 'dark', 8);
      b.pipe(a0, a1, 0.05, 'dark', 8);
      b.pipe(b0, b1, 0.05, 'dark', 8);
    }
    b.add(new THREE.CircleGeometry(r1 * 0.78, 32), 'glass', [cx, top - depth - 0.01, cz], [Math.PI / 2, 0, 0]);
    b.torus(r1 * 0.8, 0.05, 'dark', [cx, top - depth, cz], [Math.PI / 2, 0, 0], 32);
    // the cupola's walls for the physics: a ring of slabs leaning out with its sides, the bottom
    const tilt = Math.atan2(r0 - r1, depth), L = Math.hypot(depth, r0 - r1);
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2, rm = (r0 + r1) / 2 + 0.06;
      b.colBox(0.12, L + 0.2, 1.0, [cx + Math.cos(a) * rm, top - depth / 2, cz + Math.sin(a) * rm], [0, -a, -tilt]);
    }
    b.colBox(2.4, 0.12, 2.4, [cx, top - depth - 0.08, cz]);
    rail(b, [cx - 1.3, top + 0.12, cz - 1.3], [cx + 1.3, top + 0.12, cz - 1.3], V(0, -1, 0), 'railY');
    rail(b, [cx - 1.3, top + 0.12, cz + 1.3], [cx + 1.3, top + 0.12, cz + 1.3], V(0, -1, 0), 'railY');
    for (const z of [Cu.z0 + 0.12, Cu.z1 - 0.12]) rail(b, [Cu.x0 + 0.5, 2.6, z], [Cu.x1 - 0.5, 2.6, z], V(0, 0, Math.sign(z - cz)));
    b.torus(1.32, 0.025, 'ledWarm', [Cu.x1 - 0.03, 1.22, cz], [0, Math.PI / 2, 0], 48);
    b.add(signPlane(8, 1.2, 0.15), 'signs', [cx, Cu.y1 - 0.25, Cu.z1 - 0.02], [0, Math.PI, 0]);
    // kept dim: the view is the point
    lamp(cx, Cu.y1 - 0.4, cz, 0xffe2c0, 1.2, 6);
  }

  // ---- the automatic pressure doors (portals marked door)
  const doors = [];
  for (const P of ORIGIN_PORTALS) {
    if (!P.door) continue;
    const c = V(P.p[0], P.p[1] - P.h / 2, P.p[2]);
    doors.push(new StationDoor({ c, normal: P.n, w: P.w, h: P.h, depth: 0.3, label: P.b, link: P.link, trimKey: 'railY' }, M));
  }

  // ---- build
  const stat = b.build(M, { castShadow: false, receiveShadow: false });
  group.add(stat);
  for (const d of doors) group.add(d.group);
  group.traverse((o) => { o.layers.set(LAYER_NEAR); });

  // ---- inside tests
  const inBox = (r, p, m = 0.05) => p.x > r.x0 - m && p.x < r.x1 + m && p.y > r.y0 - m && p.y < r.y1 + m && p.z > r.z0 - m && p.z < r.z1 + m;
  const inTunnel = (p) => p.x > 2.9 && p.x < 5.3 && Math.abs(p.z - TUNNEL.zc) < TUNNEL.hv + 0.05 && p.y > 0.15 && p.y < TUNNEL.yc + TUNNEL.hu + 0.05;
  const inGap = (P, p) => {
    const [x, y, z] = P.p;
    if (Math.abs(p.y - y) > P.h / 2) return false;
    return P.n === 'x' ? Math.abs(p.x - x) < 0.2 && Math.abs(p.z - z) < P.w / 2 : Math.abs(p.z - z) < 0.2 && Math.abs(p.x - x) < P.w / 2;
  };
  const Cu = room('cupola');
  const inCupola = (p) => p.y < Cu.y0 && p.y > Cu.y0 - 1.35 && Math.hypot(p.x - 49.0, p.z + 1.05) < 1.8;
  const sectionAt = (p) => {
    for (const r of ORIGIN_ROOMS) if (inBox(r, p)) return r.sec;
    if (inTunnel(p)) return 'lobby';
    for (const P of ORIGIN_PORTALS) if (inGap(P, p)) return room(P.a).sec;
    if (inCupola(p)) return 'cupola';
    return null;
  };
  const contains = (p) => sectionAt(p) !== null;
  const roomAt = (p) => { for (const r of ORIGIN_ROOMS) if (inBox(r, p, 0)) return r; return null; };
  // where a strike can hole each section: the middle of each outer wall, facing in
  const breachSpots = {};
  for (const r of ORIGIN_ROOMS) {
    const L = breachSpots[r.sec] || (breachSpots[r.sec] = []);
    for (const face of ['+y', '-y', r.id === 'corr' ? '+z' : '-z']) {
      const F = faceFrame(r, face, 0);
      const p = to3(F, (F.u0 + F.u1) / 2, (F.v0 + F.v1) / 2, V(0, 0, 0));
      const n = V(0, 0, 0); n[F.a] = -F.s;
      L.push({ p: p.addScaledVector(n, 0.05), n });
    }
  }
  const sections = [
    { id: 'lobby', name: '入港ノード', vol: 110 },
    { id: 'main', name: '中央区画', vol: 1150 },
    { id: 'warehouse', name: '物資倉庫', vol: 1010 },
    { id: 'cupola', name: '展望ノード', vol: 120 },
  ];

  // ---- per frame (while docked): the robots at work, the screens
  let T = 0;
  const update = (dt, g) => {
    T += dt;
    const who = g && g.player && g.player.state !== 'dead' ? g.player.pos : null;
    for (const m of moving) {
      if (m.kind === 'flyer') {
        // hop from one doorway to the next, hover there a while; never into Kaito
        if (m.wait > 0) m.wait -= dt;
        else {
          const d = m.target - m.x;
          if (Math.abs(d) < 0.02) { m.wait = 2 + R() * 4; const stops = [12.5, 16.4, 27.9, 40.4, 45.5]; m.target = stops[Math.floor(R() * stops.length)] + (m.k ? 0.6 : -0.6); }
          else {
            let v = Math.sign(d) * Math.min(0.55, Math.abs(d) * 0.8);
            if (who && Math.abs(who.x - (m.x + Math.sign(d) * 0.8)) < 0.7 && Math.abs(who.z + 1.05) < 1.3) v = 0;
            m.x += v * dt;
          }
        }
        m.obj.position.set(m.x, 1.22 + (m.k ? 0.55 : -0.45) + Math.sin(T * 1.3 + m.k) * 0.04, -1.05 + (m.k ? 0.55 : -0.5));
        m.obj.rotation.set(Math.sin(T * 0.7 + m.k) * 0.06, m.target > m.x ? -Math.PI / 2 : Math.PI / 2, 0);
      } else if (m.kind === 'pulse') {
        m.mat.emissiveIntensity = 1.2 + 0.4 * Math.sin(T * 2.2);
      } else if (m.kind === 'spin') {
        m.obj.rotation.y += dt * m.w;
      } else if (m.kind === 'harvester') {
        const k = 0.5 + 0.5 * Math.sin(T * 0.12);
        m.obj.position.x = m.x0 + (m.x1 - m.x0) * k;
        m.obj.children.forEach((c) => { c.position.y = -0.05 * Math.max(0, Math.sin(T * 1.7)); });
      } else if (m.kind === 'gantry') {
        // a 24 s cycle: along to a rack, down, up with the crate, along to another rack, down, up
        m.t += dt;
        const ph = (m.t % 24) / 24, St = m.St;
        const zA = m.rowsZ[0] + 1.7, zB = m.rowsZ[2] - 1.7;
        const ease = (u) => u * u * (3 - 2 * u);
        const seg = (a, c) => Math.max(0, Math.min(1, (ph - a) / (c - a)));
        const z = zA + (zB - zA) * (ease(seg(0.05, 0.4)) - ease(seg(0.55, 0.9)));
        const xo = (St.x1 - St.x0) * 0.32 * (ease(seg(0.1, 0.35)) - ease(seg(0.6, 0.85)));
        const dn = Math.max(Math.sin(Math.min(1, seg(0.4, 0.55)) * Math.PI), Math.sin(Math.min(1, seg(0.9, 1)) * Math.PI));
        m.bridge.position.z = z;
        m.car.position.set(xo, -0.3, 0);
        m.hoist.position.set(0, -0.4 - dn * 2.2, 0);
      } else if (m.kind === 'arm') {
        m.t += dt;
        m.arm.rotation.y = Math.sin(m.t * 0.4) * 0.9;
        m.arm.rotation.z = 0.25 + Math.sin(m.t * 0.7) * 0.15;
        m.fore.rotation.x = -0.7 + Math.sin(m.t * 0.9) * 0.3;
      }
    }
    // screens: redraw the ones in the room Kaito is in (and the supply board), a few times a second
    const here = who ? roomAt(who) : null;
    for (const s of screens) {
      if (s.static) continue;
      if (!(here && here.id === s.room) && s.room !== 'node') continue;
      s.S.t -= dt;
      if (s.S.t > 0) continue;
      s.S.t = s.every;
      s.S.draw(s.S.ctx, s.S.w, s.S.h, g, T);
      s.S.tex.needsUpdate = true;
    }
  };
  // first frames
  for (const s of screens) if (!s.static) { s.S.draw(s.S.ctx, s.S.w, s.S.h, null, 0); s.S.tex.needsUpdate = true; }

  return { group, colliders: b.colliders, lamps, globe: null, globeMat: null, contains, sectionAt, breachSpots, hasAtrium: false, doors, materials: M, ring: null, sections, update, roomAt, origin: true };
}
