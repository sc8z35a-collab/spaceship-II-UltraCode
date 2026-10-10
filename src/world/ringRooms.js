// The rooms of Shirasagi's ring. Five of its residential street sections are closed off as rooms of
// their own: a clinic, the crew mess, capsule quarters, the ring's control room and a gym. Each has a
// bulkhead with a sliding door at either end, its own floor, light and furniture, screens that run,
// and the people who use it. Frames as in stationRing.js: in a place() frame +x runs along the deck,
// +y toward the ring's axis (up), +z across the deck, the origin on the floor.
import * as THREE from 'three';
import { buildPerson, randomLook } from './humanModel.js';

const D2R = Math.PI / 180;
const _Z = new THREE.Vector3(0, 0, 1), _Y = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion();
const DW = 0.8, DH = 2.5, BI = 0.45;        // the doorway's half width and its height; the bulkheads' inset (deg)

const ROOMS = { 2: 'clinic', 7: 'mess', 9: 'quarters', 14: 'control', 19: 'gym' };
const ORDER = ['clinic', 'mess', 'quarters', 'control', 'gym'];
const INFO = {
  clinic: { jp: '医務室', en: 'MEDICAL BAY', col: '#56d6c8', floor: 'rmTile', panel: 'rmPanel', lamp: 0xeef6ff },
  mess: { jp: '食堂', en: 'CREW MESS', col: '#ffad4d', floor: 'wood', panel: 'rmPanelWarm', lamp: 0xffd8a6 },
  quarters: { jp: '居住区', en: 'CAPSULE QUARTERS', col: '#b49bff', floor: 'rmCarpet', panel: 'rmPanelWarm', lamp: 0xffcf9e },
  control: { jp: '管制室', en: 'RING CONTROL', col: '#62c4ff', floor: 'rmDeck', panel: 'rmPanel', lamp: 0xcfe4ff },
  gym: { jp: 'トレーニング室', en: 'FITNESS', col: '#7be08a', floor: 'rmRubber', panel: 'rmPanel', lamp: 0xf4f9ff },
};
const STATUS_JP = { ok: '正常', damaged: '損傷あり', critical: '危険', failed: '機能停止', destroyed: '喪失' };
const JP = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';
const wrapDeg = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const wrapRad = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** the room a ring section is made into, or null (Shirasagi's ring only) */
export function roomAt(def, k) { return def && def.id === 'shirasagi' ? ROOMS[k] || null : null; }

// ------------------------------------------------------------------ screens and signs (canvases)
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function texOf(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

/** the room names over the doors: one 1024 x 128 row each (a sixth for the quarters' quiet hours) */
function drawSigns(c) {
  const x = c.getContext('2d');
  const rows = ORDER.map((k) => [INFO[k].jp, INFO[k].en, INFO[k].col]).concat([['消灯 22:00〜6:00', 'QUIET HOURS', '#b49bff']]);
  rows.forEach(([jp, en, col], i) => {
    const y = i * 128;
    x.fillStyle = '#0c131a'; x.fillRect(0, y, 1024, 128);
    x.fillStyle = col; x.fillRect(0, y + 8, 12, 112); x.fillRect(1012, y + 8, 12, 112);
    x.textBaseline = 'middle';
    x.fillStyle = '#f3f7fb'; x.font = `700 68px ${JP}`; x.textAlign = 'left'; x.fillText(jp, 46, y + 66, 600);
    x.fillStyle = col; x.font = '600 32px Arial, sans-serif'; x.textAlign = 'right'; x.fillText(en, 984, y + 68, 330);
  });
}
function signGeo(i, w = 1.5) {
  const g = new THREE.PlaneGeometry(w, w / 8), uv = g.attributes.uv;
  for (let j = 0; j < uv.count; j++) uv.setY(j, 1 - (i + 1) / 6 + uv.getY(j) / 6);
  return g;
}

/** a heartbeat as a bedside monitor draws it (t in beats) */
function ecgWave(t) {
  const g = (m, s, a) => a * Math.exp(-((t - m) ** 2) / (2 * s * s));
  return g(0.18, 0.025, 0.12) - g(0.31, 0.008, 0.12) + g(0.33, 0.012, 1.0) - g(0.355, 0.01, 0.25) + g(0.6, 0.045, 0.28);
}
function drawEcg(c, T, hr) {
  const x = c.getContext('2d'), W = c.width, H = c.height;
  x.fillStyle = '#03080b'; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(60,140,120,0.18)'; x.lineWidth = 1;
  for (let i = 0; i < W; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); }
  for (let j = 0; j < H; j += 16) { x.beginPath(); x.moveTo(0, j); x.lineTo(W, j); x.stroke(); }
  x.strokeStyle = '#3dff9a'; x.lineWidth = 2.2; x.beginPath();
  const span = 3.0, bps = hr / 60, n = 160, w = W - 74;
  for (let i = 0; i <= n; i++) {
    const tt = T - span + span * i / n, ph = (((tt * bps) % 1) + 1) % 1;
    const yv = H * 0.56 - ecgWave(ph) * H * 0.36, xv = i / n * w;
    if (i) x.lineTo(xv, yv); else x.moveTo(xv, yv);
  }
  x.stroke();
  x.textAlign = 'right'; x.textBaseline = 'alphabetic';
  x.fillStyle = '#3dff9a'; x.font = '700 34px monospace'; x.fillText(String(Math.round(hr)), W - 8, 42);
  x.font = '600 14px Arial, sans-serif'; x.fillText('HR', W - 8, 60);
  x.fillStyle = '#7fd8ff'; x.font = '700 26px monospace'; x.fillText('98', W - 8, 108);
  x.font = '600 13px Arial, sans-serif'; x.fillText('SpO2 %', W - 8, 124);
}
function drawMenu(c) {
  const x = c.getContext('2d'), W = c.width, H = c.height;
  const gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#1b1309'); gr.addColorStop(1, '#0d0904');
  x.fillStyle = gr; x.fillRect(0, 0, W, H);
  x.textBaseline = 'alphabetic';
  x.fillStyle = '#ffad4d'; x.font = `700 30px ${JP}`; x.textAlign = 'left'; x.fillText('本日のメニュー', 22, 42);
  x.fillStyle = '#9a8a74'; x.font = '600 16px Arial, sans-serif'; x.textAlign = 'right'; x.fillText("TODAY'S MENU", W - 22, 40);
  x.fillStyle = 'rgba(255,173,77,0.4)'; x.fillRect(22, 54, W - 44, 2);
  const items = [['白鷺カレー（水耕野菜）', '420'], ['照り焼きチキン定食', '560'], ['味噌汁とおにぎり', '280'], ['リング農場サラダ', '300']];
  items.forEach(([nm, pr], i) => {
    const y = 88 + i * 30;
    x.fillStyle = '#f6eadb'; x.font = `500 22px ${JP}`; x.textAlign = 'left'; x.fillText(nm, 30, y, 380);
    x.fillStyle = '#ffcf8a'; x.font = '600 21px monospace'; x.textAlign = 'right'; x.fillText(pr + ' cr', W - 26, y);
  });
}
function drawConsole(c) {
  const x = c.getContext('2d'), W = c.width, H = c.height;
  x.fillStyle = '#04101a'; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(98,196,255,0.25)'; x.lineWidth = 1;
  for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(10, 22 + i * 14); x.lineTo(W - 10, 22 + i * 14); x.stroke(); }
  x.lineWidth = 2;
  x.strokeStyle = '#62c4ff'; x.beginPath();
  for (let i = 0; i <= 60; i++) { const xx = 10 + i * (W - 20) / 60, yy = 82 - Math.sin(i * 0.31) * 22 - Math.sin(i * 0.11) * 14; if (i) x.lineTo(xx, yy); else x.moveTo(xx, yy); }
  x.stroke();
  x.strokeStyle = '#7dff9a'; x.beginPath();
  for (let i = 0; i <= 60; i++) { const xx = 10 + i * (W - 20) / 60, yy = 116 - Math.cos(i * 0.23) * 10; if (i) x.lineTo(xx, yy); else x.moveTo(xx, yy); }
  x.stroke();
  x.fillStyle = '#9fd7ff'; x.font = '600 13px monospace'; x.textAlign = 'left'; x.fillText('RING CONTROL · ONLINE', 12, 15);
  x.fillStyle = 'rgba(125,255,154,0.9)'; x.fillRect(W - 60, 132, 48, 10);
}
function drawTread(c) {
  const x = c.getContext('2d'), W = c.width, H = c.height;
  x.fillStyle = '#071108'; x.fillRect(0, 0, W, H);
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.fillStyle = '#7be08a'; x.font = '700 40px monospace'; x.fillText('9.6', W / 2, 58);
  x.font = '600 15px Arial, sans-serif'; x.fillText('km/h', W / 2, 78);
  x.fillStyle = '#ff8a7a'; x.font = `600 18px ${JP}`; x.fillText('♥ 132  ·  0.48 G', W / 2, 114);
}
function drawRack(c) {
  const x = c.getContext('2d'), W = c.width;
  x.fillStyle = '#15191e'; x.fillRect(0, 0, W, c.height);
  const cols = ['#3fb8ff', '#7dff9a', '#ffb347'];
  for (let u = 0; u < 20; u++) {
    const y = 6 + u * 15.5;
    x.fillStyle = u % 5 === 0 ? '#20262d' : '#1a1f25'; x.fillRect(6, y, W - 12, 13);
    x.fillStyle = '#0b0e11'; for (let v = 0; v < 6; v++) x.fillRect(46 + v * 12, y + 3, 8, 7);
    for (let l = 0; l < 3; l++) if ((u * 3 + l) % 4) { x.fillStyle = cols[(u + l) % 3]; x.fillRect(12 + l * 9, y + 5, 4, 4); }
  }
}
function drawGym(c, t, G) {
  const x = c.getContext('2d'), W = c.width;
  x.fillStyle = '#06100a'; x.fillRect(0, 0, W, c.height);
  x.textBaseline = 'alphabetic'; x.textAlign = 'left';
  x.fillStyle = '#7be08a'; x.font = `700 26px ${JP}`; x.fillText('トレーニング室', 18, 36);
  x.fillStyle = '#5f7f66'; x.font = '600 14px Arial, sans-serif'; x.fillText('FITNESS · RING GRAVITY', 210, 34);
  x.fillStyle = '#e9ffe9'; x.font = '700 50px monospace'; x.fillText(G.toFixed(2) + ' G', 18, 102);
  x.fillStyle = '#9fd3a8'; x.font = `600 18px ${JP}`; x.fillText('地球のおよそ半分の重さ', 18, 134);
  x.textAlign = 'right';
  x.fillStyle = '#7be08a'; x.font = '700 36px monospace'; x.fillText((12.4 + t * 0.0052).toFixed(2), W - 20, 92);
  x.font = `600 16px ${JP}`; x.fillText('本日の走行 km', W - 20, 118);
}

// ------------------------------------------------------------------ materials (once per material set)
function roomMaterials(M) {
  if (M._rm) return M._rm;
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const glow = (c, i) => S({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.6 });
  Object.assign(M, {
    rmTile: S({ color: 0xe6ecef, roughness: 0.32, metalness: 0.02 }),
    rmCarpet: S({ color: 0x343c4a, roughness: 1 }),
    rmRubber: S({ color: 0x2a2d31, roughness: 0.95 }),
    rmDeck: S({ color: 0x262b32, roughness: 0.55, metalness: 0.45 }),
    rmBulk: S({ color: 0xd5dade, roughness: 0.48, metalness: 0.2 }),
    rmDoor: S({ color: 0xc9d1d8, roughness: 0.32, metalness: 0.65 }),
    rmWhite: S({ color: 0xf1f3f5, roughness: 0.4 }),
    rmSteel: S({ color: 0xa3acb5, roughness: 0.3, metalness: 0.85 }),
    rmDark: S({ color: 0x252a30, roughness: 0.55, metalness: 0.35 }),
    rmScreenDark: S({ color: 0x0c1117, roughness: 0.25, metalness: 0.3 }),
    rmShell: S({ color: 0xeeefea, roughness: 0.26, metalness: 0.08 }),
    rmMattress: S({ color: 0xdde4e8, roughness: 0.95 }),
    rmFabric: S({ color: 0x7fb0c8, roughness: 0.92 }),
    rmFabricDark: S({ color: 0x30343c, roughness: 0.9 }),
    rmFabricWarm: S({ color: 0xd9733a, roughness: 0.85 }),
    rmBlind: S({ color: 0x9aa8c0, roughness: 0.9 }),
    rmCurtain: S({ color: 0xa9d4dc, roughness: 0.95, side: THREE.DoubleSide }),
    rmBag: S({ color: 0xe8f2f6, roughness: 0.3 }),
    rmMirror: S({ color: 0xb4c3cf, roughness: 0.05, metalness: 1 }),
    rmFoodA: S({ color: 0xc8742b, roughness: 0.7 }),
    rmFoodB: S({ color: 0x5fa845, roughness: 0.75 }),
    rmFoodC: S({ color: 0x8a5426, roughness: 0.6 }),
    rmRice: S({ color: 0xf4f1e8, roughness: 0.8 }),
    rmPanel: glow(0xf1f6ff, 1.7),
    rmPanelWarm: glow(0xffdfb0, 1.5),
    rmCapsuleLit: glow(0xffd3a0, 0.85),
    rmRed: glow(0xe03a3a, 1.3),
    rmLedW: glow(0xcfe8ff, 1.4),
    rmLedG: glow(0x35ff8f, 2.4),
    rmLedA: glow(0x3fb8ff, 2.0),
    rmLedB: glow(0x7dff9a, 1.8),
  });
  for (const k of ORDER) M['rmAcc_' + k] = glow(new THREE.Color(INFO[k].col).getHex(), 1.4);
  const R = M._rm = {
    sign: canvas(1024, 768), ecg: canvas(256, 160), ctrl: canvas(1024, 342), ctrl2: canvas(256, 150),
    gym: canvas(512, 150), tread: canvas(256, 144), menu: canvas(512, 190), rack: canvas(128, 320),
  };
  drawSigns(R.sign); drawEcg(R.ecg, 0, 72); drawConsole(R.ctrl2); drawTread(R.tread); drawMenu(R.menu); drawRack(R.rack);
  drawGym(R.gym, 0, 0.48);
  { const x = R.ctrl.getContext('2d'); x.fillStyle = '#040a11'; x.fillRect(0, 0, R.ctrl.width, R.ctrl.height); }
  const scr = (key, c) => { const t = texOf(c); M[key] = new THREE.MeshBasicMaterial({ map: t, toneMapped: false }); return t; };
  scr('rmSign', R.sign); R.ecgTex = scr('rmEcg', R.ecg); R.ctrlTex = scr('rmCtrl', R.ctrl); scr('rmCtrl2', R.ctrl2);
  R.gymTex = scr('rmGym', R.gym); scr('rmTread', R.tread); scr('rmMenu', R.menu); scr('rmRack', R.rack);
  return R;
}

// ------------------------------------------------------------------ the rooms
export class RingRooms {
  /** ctx: { RF, RC, hw, band, place, lamp } from buildRingInterior */
  constructor(def, M, ctx) {
    this.def = def; this.M = M; this.ctx = ctx;
    this.count = 0; this.rooms = []; this.doors = []; this.folk = [];
    this.t = 0; this.cols = null; this.C = null; this.mask = 1; this.dyn = null; this.group = null; this.holo = null; this.pa = null;
    this.drawT = { ecg: 0, ctrl: 0, gym: 0 };
    this.R = roomMaterials(M);
  }

  /** a local point in the floor frame at aDeg, into ring-local coordinates */
  toRing(aDeg, lx, ly, lz, out = new THREE.Vector3()) {
    const a = aDeg * D2R, c = Math.cos(a), s = Math.sin(a), RF = this.ctx.RF;
    return out.set(RF * c - lx * s - ly * c, RF * s + lx * c - ly * s, lz);
  }
  /** a ring-local point in the floor frame at aDeg: { x along the deck, y up } (z is its own) */
  local(aDeg, q) {
    const a = aDeg * D2R, c = Math.cos(a), s = Math.sin(a), RF = this.ctx.RF;
    const dx = q.x - RF * c, dy = q.y - RF * s;
    return { x: -dx * s + dy * c, y: -dx * c - dy * s };
  }

  /** a street section made into its room (inside buildRingInterior's section loop) */
  build(b, k, a0, a1, am) {
    const kind = ROOMS[k];
    if (!kind) return;
    this.count++;
    const { RF, RC, hw, band } = this.ctx, H = RF - RC, I = INFO[kind];
    const ab0 = a0 + BI, ab1 = a1 - BI, room = { kind, k, a0, a1, am, ab0, ab1 };
    this.rooms.push(room);
    // the room's own floor between its bulkheads, the deck's outside them
    b.add(band(RF, a0 * D2R, ab0 * D2R, -hw, hw, 2, true, 2), 'ringFloor');
    b.add(band(RF, ab1 * D2R, a1 * D2R, -hw, hw, 2, true, 2), 'ringFloor');
    b.add(band(RF, ab0 * D2R, ab1 * D2R, -hw, hw, 24, true, 2), I.floor);
    this.bulkhead(b, kind, ab0);
    this.bulkhead(b, kind, ab1);
    const at = (x, z, fn) => this.ctx.place(am + x / (RF * D2R), z, 0, fn);
    // light panels under the ceiling's ribs, two lamps
    for (const x of [-5.4, -2.7, 0, 2.7, 5.4]) at(x, 0, () => b.box(1.6, 0.035, 1.1, I.panel, [0, H - 0.27, 0], null, 0.01));
    for (const x of [-3.6, 3.6]) this.ctx.lamp(am + x / (RF * D2R), 0, 3.9, I.lamp, 2.0, 10);
    this[kind](b, at, H, hw, room);
  }

  /** a bulkhead across the deck at angle ab, its doorway in the middle (the leaves are added later) */
  bulkhead(b, kind, ab) {
    const { place, hw, RF, RC } = this.ctx, H = RF - RC, T = 0.26, w = hw - DW;
    place(ab, 0, 0, () => {
      for (const sz of [-1, 1]) {
        b.box(T, H, w, 'rmBulk', [0, H / 2, sz * (DW + w / 2)], null, 0.02);
        b.colBox(T, H, w, [0, H / 2, sz * (DW + w / 2)]);
      }
      b.box(T, H - DH, 2 * DW, 'rmBulk', [0, DH + (H - DH) / 2, 0], null, 0.02);
      b.colBox(T, H - DH, 2 * DW, [0, DH + (H - DH) / 2, 0]);
      for (const fx of [-1, 1]) {
        const f = fx * (T / 2 + 0.012);
        for (const sz of [-1, 1]) b.box(0.03, DH + 0.06, 0.06, 'brass', [f, DH / 2, sz * (DW + 0.03)], null, 0.01);
        b.box(0.03, 0.06, 2 * DW + 0.12, 'brass', [f, DH + 0.03, 0], null, 0.01);
        b.box(0.02, 0.07, 2 * hw - 0.12, 'rmAcc_' + kind, [fx * (T / 2 + 0.008), DH + 0.62, 0], null, 0.01);
        b.add(signGeo(ORDER.indexOf(kind)), 'rmSign', [fx * (T / 2 + 0.016), DH + 0.3, 0], [0, fx * Math.PI / 2, 0]);
      }
      b.box(T + 0.04, 0.012, 2 * DW, 'black', [0, 0.006, 0], null, 0.004);
    });
    this.doors.push({ ab, kind, k: 0, hold: 0, leaves: null, led: null, col: null, q: null });
  }

  person(room, o) {
    const n = this.folk.length;
    this.folk.push(Object.assign({ room, x: 0, z: 0, yaw: 0, kind: 'stand', seat: 0.5, y0: 0, reach: 0.3, lean: 0, role: 'crew', person: null, pose: null, seed: n * 1.37, n: 4100 + n * 97, curYaw: null, pos: null }, o));
  }

  // ---- 医務室: three beds and their monitors, the cabinets, the doctor's desk, a scanner
  clinic(b, at, H, hw, room) {
    for (const x of [-4.8, -1.8, 1.2]) {
      at(x, 1.64, () => {
        b.box(2.0, 0.07, 0.9, 'rmSteel', [0, 0.5, 0], null, 0.02);
        for (const lx of [-0.92, 0.92]) for (const lz of [-0.38, 0.38]) b.cyl(0.025, 0.025, 0.47, 'rmSteel', [lx, 0.235, lz], null, 8);
        b.box(1.94, 0.15, 0.84, 'rmMattress', [0, 0.61, 0], null, 0.06);
        b.box(0.42, 0.11, 0.6, 'rmWhite', [-0.72, 0.74, 0], null, 0.05);
        b.box(1.15, 0.05, 0.88, 'rmFabric', [0.36, 0.71, 0], null, 0.025);
        b.box(0.06, 0.6, 0.9, 'rmSteel', [-1.0, 0.8, 0], null, 0.02);
        b.colBox(2.0, 0.8, 0.9, [0, 0.4, 0]);
      });
      at(x - 0.35, hw - 0.03, () => {
        b.box(0.66, 0.46, 0.05, 'rmScreenDark', [0, 1.62, -0.025], null, 0.02);
        b.add(new THREE.PlaneGeometry(0.6, 0.38), 'rmEcg', [0, 1.62, -0.052], [0, Math.PI, 0]);
      });
      at(x - 1.12, 1.05, () => {
        b.cyl(0.015, 0.015, 1.85, 'rmSteel', [0, 0.95, 0], null, 6);
        b.cyl(0.2, 0.2, 0.03, 'rmSteel', [0, 0.02, 0], null, 16);
        b.box(0.14, 0.22, 0.05, 'rmBag', [0.06, 1.72, 0], null, 0.02);
      });
    }
    for (const x of [-3.3, -0.3, 2.7]) at(x, 1.66, () => {
      b.box(0.03, 0.03, 1.08, 'rmSteel', [0, 2.36, 0], null, 0.01);
      b.box(0.02, 1.86, 1.0, 'rmCurtain', [0, 1.4, 0.02], null, 0.005);
    });
    at(-4.4, -1.9, () => {
      b.box(4.0, 0.9, 0.6, 'rmWhite', [0, 0.45, 0], null, 0.02);
      b.box(4.04, 0.04, 0.64, 'rmSteel', [0, 0.92, 0], null, 0.01);
      b.box(4.0, 0.72, 0.36, 'rmWhite', [0, 2.15, -0.12], null, 0.02);
      for (let i = 0; i < 6; i++) {
        b.box(0.14, 0.02, 0.02, 'rmSteel', [-1.65 + i * 0.66, 0.78, 0.31], null, 0.005);
        b.box(0.14, 0.02, 0.02, 'rmSteel', [-1.65 + i * 0.66, 1.86, 0.07], null, 0.005);
      }
      b.box(0.36, 0.1, 0.02, 'rmRed', [0.95, 2.2, 0.065], null, 0.01);
      b.box(0.1, 0.36, 0.02, 'rmRed', [0.95, 2.2, 0.065], null, 0.01);
      b.box(0.5, 0.03, 0.38, 'rmDark', [-1.2, 0.93, 0.02], null, 0.01);
      b.cyl(0.015, 0.015, 0.26, 'rmSteel', [-1.2, 1.06, -0.2], null, 6);
      b.colBox(4.0, 0.95, 0.6, [0, 0.475, 0]);
    });
    at(-0.6, -1.78, () => {
      b.box(1.3, 0.04, 0.68, 'rmWhite', [0, 0.74, 0], null, 0.01);
      for (const s of [-1, 1]) b.box(0.04, 0.72, 0.6, 'rmSteel', [s * 0.6, 0.36, 0], null, 0.01);
      b.box(0.64, 0.42, 0.04, 'rmScreenDark', [0, 1.1, -0.2], null, 0.01);
      b.add(new THREE.PlaneGeometry(0.58, 0.36), 'rmEcg', [0, 1.1, -0.178]);
      b.box(0.05, 0.3, 0.05, 'rmSteel', [0, 0.9, -0.24], null, 0.01);
      b.box(0.42, 0.02, 0.15, 'rmDark', [0, 0.77, 0.1], null, 0.005);
      b.colBox(1.3, 0.78, 0.68, [0, 0.39, 0]);
    });
    at(3.9, -1.48, () => {
      b.box(2.0, 0.6, 0.6, 'rmWhite', [0, 0.3, 0], null, 0.04);
      b.box(1.9, 0.09, 0.6, 'rmFabric', [0, 0.65, 0], null, 0.04);
      b.add(new THREE.TorusGeometry(0.58, 0.1, 12, 40), 'rmWhite', [0.35, 0.86, 0], [0, Math.PI / 2, 0]);
      b.add(new THREE.TorusGeometry(0.49, 0.016, 6, 40), 'rmLedA', [0.35, 0.86, 0], [0, Math.PI / 2, 0]);
      b.box(0.24, 0.2, 0.7, 'rmWhite', [0.35, 0.1, 0], null, 0.03);
      b.colBox(2.0, 1.56, 1.36, [0, 0.78, 0]);
      b.cyl(0.025, 0.025, H - 3.35, 'rmSteel', [0, (H + 3.35) / 2, 0], null, 6);
      b.cyl(0.32, 0.22, 0.12, 'rmWhite', [0, 3.29, 0], null, 24);
      b.cyl(0.27, 0.27, 0.01, 'rmPanel', [0, 3.225, 0], null, 24);
    });
    this.person(room, { x: -0.6, z: -1.0, yaw: 0, kind: 'stand', lean: 0.15 });
    this.person(room, { x: 1.4, z: 1.1, yaw: 0, kind: 'sit', seat: 0.69, reach: 0.05, role: 'passenger' });
    this.person(room, { x: -4.8, z: 0.45, yaw: -Math.PI / 2, kind: 'pace', x0: -4.8, x1: 1.2, faceEnd: Math.PI });
  }

  // ---- 食堂: the counter and its menu, tables down both walls with stools, pendant lamps
  mess(b, at, H, hw, room) {
    at(4.4, -1.83, () => {
      b.box(4.2, 0.98, 0.72, 'rmWhite', [0, 0.49, 0], null, 0.03);
      b.box(4.26, 0.05, 0.78, 'rmSteel', [0, 1.005, 0], null, 0.01);
      b.box(4.1, 0.36, 0.02, 'glass', [0, 1.26, 0.24], null, 0.005);
      b.box(4.1, 0.02, 0.3, 'rmSteel', [0, 1.45, 0.1], null, 0.005);
      for (let i = 0; i < 6; i++) {
        const x = -1.75 + i * 0.7;
        b.box(0.56, 0.05, 0.36, 'rmSteel', [x, 1.055, -0.02], null, 0.01);
        b.sphere(0.15, ['rmFoodA', 'rmFoodB', 'rmFoodC', 'rmRice'][i % 4], [x, 1.09, -0.02], 10, [1.4, 0.35, 0.9]);
      }
      b.colBox(4.2, 1.05, 0.78, [0, 0.52, 0]);
    });
    at(4.4, -hw + 0.02, () => {
      b.box(2.6, 1.0, 0.05, 'rmScreenDark', [0, 2.55, 0.025], null, 0.02);
      b.add(new THREE.PlaneGeometry(2.48, 0.9), 'rmMenu', [0, 2.55, 0.052]);
    });
    at(-6.5, -1.92, () => {
      b.box(0.8, 1.8, 0.55, 'rmDark', [0, 0.9, 0], null, 0.03);
      b.box(0.6, 0.5, 0.02, 'rmLedW', [0, 1.35, 0.28], null, 0.01);
      for (let i = 0; i < 3; i++) b.box(0.12, 0.08, 0.03, 'rmLedB', [-0.2 + i * 0.2, 0.95, 0.285], null, 0.01);
      b.box(0.5, 0.25, 0.12, 'black', [0, 0.62, 0.24], null, 0.01);
      b.colBox(0.8, 1.8, 0.55, [0, 0.9, 0]);
    });
    const table = (x, sz) => {
      at(x, sz * 1.68, () => {
        b.box(1.6, 0.05, 0.76, 'wood', [0, 0.74, 0], null, 0.02);
        for (const lx of [-0.5, 0.5]) b.cyl(0.045, 0.045, 0.7, 'rmSteel', [lx, 0.37, 0], null, 8);
        b.box(1.3, 0.03, 0.42, 'rmSteel', [0, 0.015, 0], null, 0.01);
        for (const px of [-0.42, 0.42]) {
          b.cyl(0.13, 0.11, 0.02, 'rmWhite', [px, 0.775, -sz * 0.14], null, 16);
          b.sphere(0.07, px < 0 ? 'rmFoodA' : 'rmFoodB', [px, 0.8, -sz * 0.14], 8, [1.3, 0.5, 1.1]);
        }
        b.colBox(1.6, 0.77, 0.76, [0, 0.385, 0]);
        b.cyl(0.006, 0.006, H - 2.85, 'black', [0, (H + 2.85) / 2, 0], null, 4);
        b.cyl(0.1, 0.24, 0.22, 'rmDark', [0, 2.74, 0], null, 16);
        b.sphere(0.07, 'rmPanelWarm', [0, 2.61, 0], 10);
      });
      for (const sx of [-0.42, 0.42]) at(x + sx, sz * 1.02, () => {
        b.cyl(0.2, 0.2, 0.06, 'rmFabricWarm', [0, 0.47, 0], null, 16);
        b.cyl(0.03, 0.03, 0.44, 'rmSteel', [0, 0.22, 0], null, 8);
        b.cyl(0.17, 0.19, 0.02, 'rmSteel', [0, 0.01, 0], null, 16);
        b.colCyl(0.2, 0.5, [0, 0.25, 0]);
      });
    };
    for (const x of [-5.0, -1.7, 1.6, 4.9]) table(x, 1);
    for (const x of [-3.6, -0.3]) table(x, -1);
    const planter = () => {
      b.box(0.9, 0.55, 0.6, 'ceramicDark', [0, 0.275, 0], null, 0.05);
      b.box(0.82, 0.1, 0.52, 'soil', [0, 0.55, 0], null, 0.02);
      for (let j = 0; j < 3; j++) b.sphere(0.24, j % 2 ? 'leaf' : 'leafLight', [-0.25 + j * 0.25, 0.8 + (j % 2) * 0.1, 0], 8);
      b.colBox(0.9, 0.55, 0.6, [0, 0.275, 0]);
    };
    at(6.7, 1.8, planter);
    at(-6.75, 1.75, planter);
    this.person(room, { x: -4.58, z: 1.0, yaw: Math.PI, kind: 'sit', seat: 0.5, reach: 0.4, role: 'passenger' });
    this.person(room, { x: 1.18, z: 1.0, yaw: Math.PI, kind: 'sit', seat: 0.5, reach: 0.35 });
    this.person(room, { x: 5.32, z: 1.0, yaw: Math.PI, kind: 'sit', seat: 0.5, reach: 0.45, role: 'passenger' });
    this.person(room, { x: -3.18, z: -1.0, yaw: 0, kind: 'sit', seat: 0.5, reach: 0.4, role: 'passenger' });
    this.person(room, { x: -6.5, z: -1.12, yaw: 0, kind: 'stand', role: 'passenger' });
  }

  // ---- 居住区: capsule berths in two tiers along both walls, ladders, lockers
  quarters(b, at, H, hw, room) {
    const CL = 2.1, CD = 1.25, CH = 1.12;
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const x = -6.0 + i * 2.25;
        for (const [t, y0] of [[0, 0.08], [1, 1.38]]) at(x, sz * (hw - CD / 2), () => {
          b.box(CL, 0.05, CD, 'rmShell', [0, y0 + 0.025, 0], null, 0.02);
          b.box(CL, 0.05, CD, 'rmShell', [0, y0 + CH - 0.025, 0], null, 0.02);
          for (const ex of [-1, 1]) b.box(0.05, CH, CD, 'rmShell', [ex * (CL / 2 - 0.025), y0 + CH / 2, 0], null, 0.01);
          b.box(CL - 0.1, CH - 0.1, 0.02, 'rmCapsuleLit', [0, y0 + CH / 2, sz * (CD / 2 - 0.02)], null, 0.005);
          b.box(CL - 0.14, 0.12, CD - 0.14, 'rmMattress', [0, y0 + 0.11, sz * 0.02], null, 0.05);
          b.box(0.4, 0.1, 0.5, 'rmWhite', [-CL / 2 + 0.34, y0 + 0.22, sz * 0.12], null, 0.04);
          b.box(0.5, 0.03, 0.16, 'rmShell', [CL / 2 - 0.42, y0 + 0.74, sz * (CD / 2 - 0.12)], null, 0.01);
          b.sphere(0.035, 'rmPanelWarm', [CL / 2 - 0.22, y0 + 0.86, sz * (CD / 2 - 0.1)], 8);
          const drop = 0.12 + ((i * 7 + t * 3 + (sz > 0 ? 5 : 0)) % 5) * 0.17;
          b.box(CL - 0.12, drop, 0.02, 'rmBlind', [0, y0 + CH - 0.06 - drop / 2, -sz * (CD / 2 - 0.03)], null, 0.005);
          b.box(0.2, 0.065, 0.015, 'rmLedW', [CL / 2 - 0.3, y0 + CH + 0.05, -sz * (CD / 2 + 0.01)], null, 0.005);
          b.colBox(CL, CH, CD, [0, y0 + CH / 2, 0]);
        });
        at(x + CL / 2 + 0.07, sz * (hw - CD - 0.05), () => {
          for (const lx of [-0.06, 0.06]) b.cyl(0.016, 0.016, 2.5, 'rmSteel', [lx, 1.25, 0], null, 6);
          for (let r = 0; r < 6; r++) b.box(0.14, 0.024, 0.024, 'rmSteel', [0, 0.35 + r * 0.38, 0], null, 0.008);
        });
      }
      at(4.7, sz * 1.93, () => {
        b.box(4.4, 2.1, 0.52, 'rmSteel', [0, 1.05, 0], null, 0.02);
        for (let i = 1; i < 10; i++) b.box(0.012, 2.0, 0.01, 'black', [-2.2 + i * 0.44, 1.05, -sz * 0.262], null, 0.002);
        for (let i = 0; i < 10; i++) b.box(0.03, 0.03, 0.01, i % 3 ? 'rmLedB' : 'rmLedW', [-2.0 + i * 0.44, 1.5, -sz * 0.264], null, 0.005);
        if (sz > 0) b.add(signGeo(5, 1.6), 'rmSign', [0, 1.84, -0.268], [0, Math.PI, 0]);
        b.colBox(4.4, 2.1, 0.52, [0, 1.05, 0]);
      });
    }
    this.person(room, { x: -5.5, z: -0.3, yaw: -Math.PI / 2, kind: 'pace', x0: -5.8, x1: 1.6, role: 'passenger' });
    this.person(room, { x: 4.2, z: 1.2, yaw: Math.PI, kind: 'stand' });
  }

  // ---- 管制室: the wall screen, three consoles and their operators, server racks, a hologram table
  control(b, at, H, hw, room) {
    at(0, -hw + 0.02, () => {
      b.box(7.6, 2.75, 0.06, 'rmScreenDark', [0, 2.6, 0.03], null, 0.02);
      b.add(new THREE.PlaneGeometry(7.4, 2.47), 'rmCtrl', [0, 2.6, 0.064]);
    });
    for (const x of [-2.6, 0, 2.6]) {
      at(x, -1.62, () => {
        b.box(1.9, 0.72, 0.56, 'rmDark', [0, 0.36, 0], null, 0.03);
        b.box(1.9, 0.05, 0.62, 'rmScreenDark', [0, 0.75, 0.02], [0.22, 0, 0], 0.01);
        for (const sx of [-0.48, 0.48]) {
          b.box(0.78, 0.48, 0.04, 'rmScreenDark', [sx, 1.12, -0.18], [-0.12, 0, 0], 0.01);
          b.add(new THREE.PlaneGeometry(0.72, 0.42), 'rmCtrl2', [sx, 1.12, -0.155], [-0.12, 0, 0]);
        }
        b.box(0.5, 0.02, 0.16, 'rmLedB', [0, 0.785, 0.2], [0.22, 0, 0], 0.005);
        b.colBox(1.9, 0.8, 0.62, [0, 0.4, 0]);
      });
      at(x, -0.98, () => {
        b.cyl(0.24, 0.24, 0.08, 'rmFabricDark', [0, 0.47, 0], null, 16);
        b.box(0.44, 0.52, 0.07, 'rmFabricDark', [0, 0.82, 0.22], [0.12, 0, 0], 0.03);
        b.cyl(0.03, 0.03, 0.4, 'rmSteel', [0, 0.24, 0], null, 8);
        for (let j = 0; j < 5; j++) { const t = j / 5 * Math.PI * 2; b.box(0.3, 0.03, 0.04, 'rmSteel', [Math.cos(t) * 0.14, 0.04, Math.sin(t) * 0.14], [0, -t, 0], 0.01); }
        b.colCyl(0.25, 0.95, [0, 0.475, 0]);
      });
    }
    for (let i = 0; i < 4; i++) at(-5.7 + i * 1.0, 1.8, () => {
      b.box(0.95, 2.3, 0.8, 'rmDark', [0, 1.15, 0], null, 0.02);
      b.add(new THREE.PlaneGeometry(0.84, 2.1), 'rmRack', [0, 1.15, -0.405], [0, Math.PI, 0]);
      b.box(0.06, 0.06, 0.012, i % 2 ? 'rmLedA' : 'rmLedB', [0.36, 2.2, -0.41], null, 0.01);
      b.colBox(0.95, 2.3, 0.8, [0, 1.15, 0]);
    });
    at(0.6, hw - 0.02, () => {
      b.box(1.7, 1.0, 0.05, 'rmScreenDark', [0, 1.75, -0.025], null, 0.02);
      b.add(new THREE.PlaneGeometry(1.6, 0.92), 'rmCtrl2', [0, 1.75, -0.052], [0, Math.PI, 0]);
    });
    at(4.2, 1.5, () => {
      b.cyl(0.6, 0.66, 0.86, 'rmDark', [0, 0.43, 0], null, 32);
      b.cyl(0.63, 0.63, 0.03, 'glass', [0, 0.875, 0], null, 32);
      b.add(new THREE.TorusGeometry(0.62, 0.014, 6, 64), 'rmLedA', [0, 0.89, 0], [Math.PI / 2, 0, 0]);
      b.colCyl(0.66, 0.95, [0, 0.475, 0]);
    });
    for (const x of [-2.6, 0, 2.6]) this.person(room, { x, z: -0.98, yaw: 0, kind: 'sit', seat: 0.51, reach: 0.9, lean: 0.1 });
    this.person(room, { x: 3.3, z: 1.5, yaw: -Math.PI / 2, kind: 'stand', lean: 0.1 });
  }

  // ---- トレーニング室: treadmills, weights, a rower, a bench, a mirror wall, the scoreboard
  gym(b, at, H, hw, room) {
    for (const x of [-4.6, -1.8, 1.0]) at(x, 1.58, () => {
      b.box(2.0, 0.18, 0.78, 'rmDark', [0, 0.09, 0], null, 0.04);
      b.box(1.7, 0.025, 0.52, 'black', [0, 0.19, 0], null, 0.01);
      for (const s of [-1, 1]) {
        b.cyl(0.02, 0.02, 0.85, 'rmSteel', [0.78, 0.6, s * 0.36], null, 8);
        b.box(0.9, 0.04, 0.04, 'rmSteel', [0.33, 1.02, s * 0.36], null, 0.01);
      }
      b.box(0.1, 0.4, 0.72, 'rmDark', [0.86, 1.16, 0], null, 0.02);
      b.add(new THREE.PlaneGeometry(0.5, 0.28), 'rmTread', [0.805, 1.18, 0], [0, -Math.PI / 2, 0]);
      b.colBox(2.0, 1.1, 0.78, [0, 0.55, 0]);
    });
    at(-1.8, hw - 0.02, () => {
      b.box(3.0, 0.95, 0.05, 'rmScreenDark', [0, 3.05, -0.025], null, 0.02);
      b.add(new THREE.PlaneGeometry(2.86, 0.84), 'rmGym', [0, 3.05, -0.052], [0, Math.PI, 0]);
    });
    at(-5.2, -1.85, () => {
      for (const y of [0.45, 0.85]) b.box(1.8, 0.05, 0.5, 'rmSteel', [0, y, 0], null, 0.01);
      for (const s of [-0.88, 0.88]) b.box(0.05, 0.9, 0.5, 'rmSteel', [s, 0.45, 0], null, 0.01);
      for (let i = 0; i < 6; i++) for (const y of [0.47, 0.87]) {
        const x = -0.72 + i * 0.29, r = 0.05 + (i % 3) * 0.012;
        for (const e of [-0.11, 0.11]) b.cyl(r, r, 0.06, 'rmDark', [x, y + r, e], [Math.PI / 2, 0, 0], 12);
        b.cyl(0.016, 0.016, 0.2, 'rmSteel', [x, y + r, 0], [Math.PI / 2, 0, 0], 6);
      }
      b.colBox(1.8, 0.95, 0.5, [0, 0.475, 0]);
    });
    at(-2.9, -1.62, () => {
      b.box(1.5, 0.03, 0.9, 'rmRubber', [0, 0.015, 0], null, 0.01);
      for (const s of [-0.62, 0.62]) {
        b.box(0.08, 1.5, 0.08, 'rmSteel', [s, 0.75, 0], null, 0.01);
        b.box(0.3, 0.04, 0.3, 'rmSteel', [s, 0.02, 0], null, 0.01);
      }
      b.cyl(0.016, 0.016, 2.0, 'rmSteel', [0, 1.38, 0.06], [0, 0, Math.PI / 2], 8);
      for (const s of [-1, 1]) for (const [d, r] of [[0.78, 0.22], [0.84, 0.17]]) b.cyl(r, r, 0.05, 'rmDark', [s * d, 1.38, 0.06], [0, 0, Math.PI / 2], 20);
      b.colBox(1.6, 1.5, 0.6, [0, 0.75, 0]);
    });
    at(-0.2, -1.72, () => {
      b.box(2.2, 0.06, 0.16, 'rmSteel', [0, 0.2, 0], null, 0.01);
      for (const s of [-1, 1]) b.box(0.1, 0.2, 0.42, 'rmDark', [s * 1.0, 0.1, 0], null, 0.02);
      b.box(0.32, 0.07, 0.3, 'rmFabricDark', [-0.35, 0.29, 0], null, 0.03);
      b.cyl(0.26, 0.26, 0.14, 'rmDark', [0.98, 0.42, 0], [Math.PI / 2, 0, 0], 24);
      b.cyl(0.012, 0.012, 0.5, 'black', [0.72, 0.5, 0], [Math.PI / 2, 0, 0], 6);
      for (const s of [-1, 1]) b.box(0.14, 0.04, 0.12, 'rmDark', [0.55, 0.28, s * 0.12], [0, 0, -0.6], 0.01);
      b.colBox(2.3, 0.6, 0.5, [0, 0.3, 0]);
    });
    at(2.5, -1.7, () => {
      b.box(1.2, 0.08, 0.32, 'rmFabricDark', [0, 0.46, 0], null, 0.03);
      for (const s of [-0.45, 0.45]) b.box(0.06, 0.42, 0.28, 'rmSteel', [s, 0.21, 0], null, 0.01);
      b.colBox(1.2, 0.5, 0.34, [0, 0.25, 0]);
    });
    at(-1.6, -hw + 0.012, () => b.box(7.0, 2.1, 0.02, 'rmMirror', [0, 1.35, 0], null, 0.005));
    at(5.4, 1.85, () => {
      b.box(0.5, 1.15, 0.45, 'rmWhite', [0, 0.575, 0], null, 0.03);
      b.cyl(0.15, 0.15, 0.42, 'glass', [0, 1.36, 0], null, 16);
      b.box(0.9, 0.04, 0.4, 'rmSteel', [0.85, 1.0, 0], null, 0.01);
      for (let j = 0; j < 4; j++) b.box(0.32, 0.08, 0.3, j % 2 ? 'rmWhite' : 'rmFabric', [0.72 + (j % 2) * 0.28, 1.06 + Math.floor(j / 2) * 0.085, 0], null, 0.03);
      b.colBox(1.4, 1.2, 0.45, [0.4, 0.6, 0]);
    });
    this.person(room, { x: -4.6, z: 1.58, yaw: -Math.PI / 2, kind: 'run', y0: 0.2, role: 'passenger' });
    this.person(room, { x: 1.0, z: 1.58, yaw: -Math.PI / 2, kind: 'run', y0: 0.2 });
    this.person(room, { x: -1.6, z: -0.95, yaw: 0, kind: 'stand', lean: 0.35, role: 'passenger' });
  }

  /** after the ring is built: the doors' leaves and lamps, the hologram (all moving, so not merged) */
  finish(group) {
    if (!this.count) return;
    this.group = group;
    const M = this.M, dyn = this.dyn = new THREE.Group();
    dyn.name = 'ringRooms';
    group.add(dyn);
    const leafG = new THREE.BoxGeometry(0.05, DH - 0.02, DW + 0.03);
    const bandG = new THREE.BoxGeometry(0.058, 0.06, DW - 0.08);
    const ledG = new THREE.BoxGeometry(0.3, 0.05, 0.42);
    for (const d of this.doors) {
      d.q = new THREE.Quaternion().setFromAxisAngle(_Z, d.ab * D2R + Math.PI / 2);
      d.leaves = [-1, 1].map((s) => {
        const m = new THREE.Mesh(leafG, M.rmDoor);
        const stripe = new THREE.Mesh(bandG, M['rmAcc_' + d.kind]);
        stripe.position.y = 0.3;
        m.add(stripe);
        m.quaternion.copy(d.q);
        dyn.add(m);
        return { m, s };
      });
      d.led = new THREE.Mesh(ledG, M.rmLedW);
      d.led.quaternion.copy(d.q);
      this.toRing(d.ab, 0, DH + 0.11, 0, d.led.position);
      dyn.add(d.led);
      this.placeLeaves(d);
    }
    const ctl = this.rooms.find((r) => r.kind === 'control');
    if (ctl) this.holo = this.makeHolo(ctl);
  }

  placeLeaves(d) {
    const e = d.k * d.k * (3 - 2 * d.k);
    for (const L of d.leaves) this.toRing(d.ab, 0, DH / 2 - 0.01, L.s * ((DW + 0.03) / 2 + e * (DW + 0.06)), L.m.position);
  }

  /** the station in light over the control room's table: core, ring, spokes, AKAMO's thread */
  makeHolo(room) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x6fd6ff, wireframe: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const dot = new THREE.MeshBasicMaterial({ color: 0xb8f0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const root = new THREE.Group(), spin = new THREE.Group(), model = new THREE.Group();
    root.add(spin); spin.add(model);
    const s = 0.0062;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(58 * s, 5 * s, 6, 64), mat); ring.position.z = 22 * s; model.add(ring);
    const core = new THREE.Mesh(new THREE.SphereGeometry(13 * s, 14, 10), mat); core.position.z = -22 * s; model.add(core);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 44 * s, 6), mat); tube.rotation.x = Math.PI / 2; model.add(tube);
    for (let i = 0; i < 6; i++) {
      const a = (7.5 + i * 60) * D2R, sp = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 58 * s, 4), mat);
      sp.position.set(Math.cos(a) * 29 * s, Math.sin(a) * 29 * s, 22 * s);
      sp.rotation.z = a - Math.PI / 2;
      model.add(sp);
    }
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.78, 4), mat); tower.position.set(0, 0.39, -22 * s); model.add(tower);
    const car = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), dot); car.position.set(0, 0.1, -22 * s); model.add(car);
    model.rotation.x = -0.45;
    const aDeg = room.am + 4.2 / (this.ctx.RF * D2R);
    this.toRing(aDeg, 0, 1.4, 1.5, root.position);
    root.quaternion.setFromAxisAngle(_Z, aDeg * D2R + Math.PI / 2);
    this.dyn.add(root);
    return { root, spin, car };
  }

  /** the ring spawned (docked, C its centre in ship space): the doors' colliders */
  attach(g, C) {
    if (!this.count || this.cols) return;
    this.C = C.clone();
    const one = new THREE.Vector3(1, 1, 1);
    const descs = this.doors.map((d) => ({ type: 'box', hx: 0.06, hy: DH / 2, hz: DW, m: new THREE.Matrix4().compose(this.toRing(d.ab, 0, DH / 2, 0).add(this.C), d.q, one) }));
    this.cols = g.phys.addColliders(descs);
    this.doors.forEach((d, i) => { d.col = this.cols[i] || null; if (d.col) d.col.setEnabled(d.k < 0.45); });
    // drawn on the same layers as the rest of the ring
    let ref = null;
    for (const ch of this.group.children) { if (ch === this.dyn) continue; ch.traverse((o) => { if (!ref && o.isMesh) ref = o; }); if (ref) break; }
    this.mask = ref ? ref.layers.mask : 1;
    this.dyn.traverse((o) => { o.layers.mask = this.mask; });
    this.makeTaps(g);
  }

  /** things to tap in the rooms: a clear box over each real thing */
  makeTaps(g) {
    if (!g.interact) return;
    const say = (t) => { if (g.statusLine) g.statusLine.note(t, 4); if (g.audio && g.audio.beep) g.audio.beep(1180, 0.06, 0.05, { direct: true }); };
    if (!this.tapM) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const spots = {
        mess: [[-6.5, -1.92, 1.0, 0.85, 1.8, 0.6, () => say('ドリンクサーバー：冷たい緑茶をもらった（0.48G だと少しゆっくり注がれる）')]],
        clinic: [[3.9, -1.48, 0.8, 2.0, 1.6, 1.3, () => say('医療スキャン：異常なし — 心拍 72・SpO2 98%')]],
        quarters: [[-3.75, -(this.ctx.hw - 0.62), 0.64, 2.1, 1.12, 1.25, () => this.rest(g)]],
        control: [[4.2, 1.5, 1.2, 1.4, 0.8, 1.4, () => {
          if (!this.holo) return;
          const big = this.holo.root.scale.x < 1.2;
          this.holo.root.scale.setScalar(big ? 1.8 : 1);
          say('ホロテーブル：白鷺の全体図を' + (big ? '拡大' : '通常表示'));
        }]],
        gym: [[-1.8, 1.58, 0.6, 2.0, 1.2, 0.8, () => say('ランニングマシン：ここでは体重がおよそ半分。地球の倍は走れそう')]],
      };
      this.tapM = [];
      for (const r of this.rooms) for (const [x, z, y, w, h, d, fn] of spots[r.kind] || []) {
        const aDeg = r.am + x / (this.ctx.RF * D2R);
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        this.toRing(aDeg, 0, y, z, m.position);
        m.quaternion.setFromAxisAngle(_Z, aDeg * D2R + Math.PI / 2);
        m.layers.mask = this.mask;
        this.dyn.add(m);
        this.tapM.push([m, fn]);
      }
    }
    this.taps = this.tapM.map(([m, fn]) => g.interact.addMesh(m, fn, { maxDist: 2.6 }));
  }

  /** a nap in a capsule: the eyes close a moment */
  rest(g) {
    if (this.restT > 0) return;
    this.restT = 3.2;
    if (g.statusLine) g.statusLine.note('カプセルで少し仮眠した', 4);
  }

  detach(g) {
    if (this.cols) for (const c of this.cols) g.phys.world.removeCollider(c, true);
    this.cols = null;
    for (const d of this.doors) d.col = null;
    if (this.taps && g.interact) for (const t of this.taps) g.interact.remove(t);
    this.taps = null;
  }

  update(dt, g) {
    if (!this.count || !this.cols) return;
    this.t += dt;
    const D = g.docking, pl = g.player;
    const p = D.inRing && pl && pl.state !== 'dead' && this.C ? _p.copy(D.ringState.pos).sub(this.C) : null;
    this.pa = p ? Math.atan2(p.y, p.x) / D2R : null;
    const st = D.station, dmg = st && st.dmg, s = dmg ? dmg.status : 'ok';
    const alarm = s === 'critical' || s === 'failed' || s === 'destroyed';
    this.updateDoors(dt, g, p);
    this.updateFolk(dt, p, alarm);
    if (this.restT > 0 && g.hud && g.hud.setFade) {
      this.restT -= dt;
      const k = this.restT > 1.6 ? (3.2 - this.restT) / 1.6 : this.restT / 1.6;
      g.hud.setFade(this.restT > 0 ? Math.max(0, Math.min(1, k)) : 0);
    }
    if (this.pa == null) return;
    const near = (kind) => { const r = this.rooms.find((q) => q.kind === kind); return !!r && Math.abs(wrapDeg(this.pa - r.am)) < 14; };
    const T = this.drawT, R = this.R, k = st && st.ringK != null ? st.ringK : 1, om = 0.28 * k, G = om * om * this.ctx.RF / 9.81;
    if (near('clinic') && (T.ecg -= dt) <= 0) { T.ecg = 0.08; drawEcg(R.ecg, this.t, 71 + Math.sin(this.t * 0.13) * 3); R.ecgTex.needsUpdate = true; }
    if (near('control')) {
      if ((T.ctrl -= dt) <= 0) { T.ctrl = 0.5; this.drawCtrl(dmg, om, G, alarm); R.ctrlTex.needsUpdate = true; }
      if (this.holo) { this.holo.spin.rotation.y += dt * 0.35; this.holo.car.position.y = 0.05 + 0.68 * (0.5 - 0.5 * Math.cos(this.t * 0.21)); }
    }
    if (near('gym') && (T.gym -= dt) <= 0) { T.gym = 1; drawGym(R.gym, this.t, G); R.gymTex.needsUpdate = true; }
    const blink = (f, ph) => (Math.sin(this.t * f + ph) > 0.35 ? 2.6 : 0.9);
    this.M.rmLedA.emissiveIntensity = blink(4.1, 0);
    this.M.rmLedB.emissiveIntensity = blink(2.7, 1.3);
  }

  /** each door opens for Kaito coming up to it and never shuts on him in its doorway */
  updateDoors(dt, g, p) {
    const D = g.docking;
    for (const d of this.doors) {
      let want = false, inWay = false;
      if (p) {
        const L = this.local(d.ab, p);
        want = Math.abs(L.x) < 2.5 && Math.abs(p.z) < 1.9 && L.y > -0.6 && L.y < 3.2;
        inWay = Math.abs(L.x) < 0.55 && Math.abs(p.z) < DW + 0.2 && L.y > -0.6 && L.y < DH;
      }
      d.hold = want ? 0.8 : Math.max(0, d.hold - dt);
      const open = d.hold > 0 || inWay;
      const k0 = d.k;
      d.k = open ? Math.min(1, d.k + dt / 0.55) : Math.max(0, d.k - dt / 0.75);
      if (d.k === k0) continue;
      this.placeLeaves(d);
      if (d.col) d.col.setEnabled(d.k < 0.45);
      d.led.material = d.k > 0.5 ? this.M.rmLedG : this.M.rmLedW;
      if ((k0 === 0 || k0 === 1) && p && g.audio && g.audio.mech && D.ringToRender) {
        this.toRing(d.ab, 0, 1.4, 0, _a).add(this.C);
        g.audio.mech(D.ringToRender(_a, _b), 'door', { open });
      }
    }
  }

  /** the people: made one a frame as Kaito nears their room, drawn and moved only near him */
  updateFolk(dt, p, alarm) {
    let made = false;
    const RF = this.ctx.RF;
    for (const F of this.folk) {
      const near = this.pa != null && Math.abs(wrapDeg(this.pa - F.room.am)) < 32;
      if (!F.person) {
        if (!near || made) continue;
        this.spawnPerson(F);
        made = true;
      }
      F.person.root.visible = near;
      if (!near) continue;
      const P = F.pose;
      let y = F.y0, yaw = F.yaw;
      if (alarm) {
        P.mode = 'panic';
        yaw = F.x < 0 ? Math.PI / 2 : -Math.PI / 2;        // toward the nearer door
      } else if (F.kind === 'sit') {
        P.mode = 'sit'; P.reach = F.reach + Math.sin(this.t * 0.9 + F.seed) * 0.08; P.lean = F.lean;
        y = F.seat + 0.1 - F.pelvisH;
      } else if (F.kind === 'run') {
        P.mode = 'walk'; P.speed = 1.4; P.phase = (P.phase || 0) + dt * 11;
      } else if (F.kind === 'pace') {
        yaw = this.pace(F, dt, p);
      } else {
        P.mode = 'stand'; P.lean = F.lean;
      }
      F.curYaw = F.curYaw == null ? yaw : F.curYaw + wrapRad(yaw - F.curYaw) * Math.min(1, dt * 5);
      // eyes on Kaito when he comes close
      let look = 0;
      if (p) {
        const L = this.local(F.room.am + F.x / (RF * D2R), p), lz = p.z - F.z;
        if (L.x * L.x + lz * lz < 25) look = Math.max(-1.1, Math.min(1.1, wrapRad(Math.atan2(-L.x, -lz) - F.curYaw)));
      }
      P.lookYaw = (P.lookYaw || 0) + (look - (P.lookYaw || 0)) * Math.min(1, dt * 3);
      this.placePerson(F, y);
      F.person.pose(P, this.t + F.seed);
    }
  }

  /** a walk up and down the room, a pause at each end, a stop for Kaito in the way */
  pace(F, dt, p) {
    const P = F.pose;
    if (F.dir == null) F.dir = 1;
    if (F.wait > 0) {
      F.wait -= dt;
      P.mode = 'stand';
      const face = F.faceEnd != null ? F.faceEnd : (F.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      if (F.wait <= 0) F.dir = -F.dir;
      return face;
    }
    const target = F.dir > 0 ? F.x1 : F.x0;
    let v = 0.85;
    if (p) {
      const L = this.local(F.room.am + F.x / (this.ctx.RF * D2R), p);
      if (L.x * F.dir > 0 && Math.abs(L.x) < 1.3 && Math.abs(p.z - F.z) < 0.7) v = 0;
    }
    const step = Math.min(Math.abs(target - F.x), v * dt);
    F.x += Math.sign(target - F.x) * step;
    P.mode = step > 0 ? 'walk' : 'stand'; P.speed = 1; P.phase = (P.phase || 0) + step * 5.2;
    if (Math.abs(target - F.x) < 0.01) F.wait = 2.5 + ((F.seed * 7) % 3);
    return F.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
  }

  placePerson(F, y) {
    const aDeg = F.room.am + F.x / (this.ctx.RF * D2R), root = F.person.root;
    this.toRing(aDeg, 0, y, F.z, root.position);
    _q.setFromAxisAngle(_Y, F.curYaw);
    root.quaternion.setFromAxisAngle(_Z, aDeg * D2R + Math.PI / 2).multiply(_q);
  }

  spawnPerson(F) {
    const person = buildPerson(randomLook(F.n, F.role));
    person.root.position.set(0, 0, 0);
    person.root.quaternion.identity();
    person.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    person.bones[0].getWorldPosition(v);
    F.pelvisH = v.y;
    person.root.traverse((o) => { o.layers.mask = this.mask; });
    this.dyn.add(person.root);
    F.person = person;
    F.pose = { mode: 'stand' };
    F.curYaw = F.yaw;
  }

  /** the control room's wall: the ring as the controllers see it, and its numbers */
  drawCtrl(dmg, om, G, alarm) {
    const c = this.R.ctrl, x = c.getContext('2d'), W = c.width, H = c.height;
    x.fillStyle = '#040a11'; x.fillRect(0, 0, W, H);
    x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    x.fillStyle = '#62c4ff'; x.font = `700 28px ${JP}`; x.fillText('白鷺 リング管制', 26, 40);
    x.fillStyle = '#6f879c'; x.font = '600 16px Arial, sans-serif'; x.fillText('SHIRASAGI RING CONTROL', 250, 39);
    const up = Math.floor(this.t), hh = String(Math.floor(up / 3600) % 24).padStart(2, '0'), mm = String(Math.floor(up / 60) % 60).padStart(2, '0'), ss = String(up % 60).padStart(2, '0');
    x.textAlign = 'right'; x.fillStyle = '#8fa6bb'; x.font = '600 18px monospace'; x.fillText(`T+ ${hh}:${mm}:${ss}`, W - 26, 39);
    x.fillStyle = alarm ? 'rgba(255,80,70,0.6)' : 'rgba(98,196,255,0.35)'; x.fillRect(26, 52, W - 52, 2);
    // the ring from its hub: the sections, the spokes, where Kaito is
    const cx = 178, cy = 200, R = 112;
    for (let s = 0; s < 24; s++) {
      const hall = s % 4 === 0, rm = ROOMS[s];
      x.strokeStyle = hall ? '#d8b24a' : rm ? INFO[rm].col : '#1f3a52';
      x.lineWidth = hall || rm ? 16 : 11;
      x.beginPath(); x.arc(cx, cy, R, (s * 15 + 0.8 - 90) * D2R, ((s + 1) * 15 - 0.8 - 90) * D2R); x.stroke();
    }
    x.strokeStyle = '#2c4d68'; x.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const a = (7.5 + i * 60 - 90) * D2R;
      x.beginPath(); x.moveTo(cx + Math.cos(a) * 24, cy + Math.sin(a) * 24); x.lineTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10)); x.stroke();
    }
    x.fillStyle = '#1b3348'; x.beginPath(); x.arc(cx, cy, 24, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#9fd7ff'; x.font = '700 13px Arial, sans-serif'; x.textAlign = 'center'; x.fillText('HUB', cx, cy + 5);
    const ra = (this.t * om / D2R) % 360;
    x.strokeStyle = 'rgba(159,215,255,0.55)'; x.lineWidth = 2;
    x.beginPath(); x.arc(cx, cy, R + 19, (ra - 110) * D2R, (ra - 70) * D2R); x.stroke();
    if (this.pa != null && Math.floor(this.t * 2) % 2 === 0) {
      const a = (this.pa - 90) * D2R, px = cx + Math.cos(a) * R, py = cy + Math.sin(a) * R;
      x.fillStyle = '#ffffff'; x.beginPath(); x.arc(px, py, 7, 0, Math.PI * 2); x.fill();
      x.font = `700 15px ${JP}`; x.fillText('現在地', px, py - 13);
    }
    // the numbers
    const rows = [
      ['遠心重力', G.toFixed(2) + ' G'],
      ['回転', om.toFixed(3) + ' rad/s · ' + (om * 60 / (2 * Math.PI)).toFixed(2) + ' rpm'],
      ['居住者', this.folk.length + ' 名（リング内）'],
      ['脱出ポッド', dmg && dmg.podsOut ? '発進済み' : '待機中'],
      ['ステーション', STATUS_JP[dmg ? dmg.status : 'ok'] || '正常'],
      ['AKAMO', '軌道エレベーター運行中'],
    ];
    x.textAlign = 'left';
    rows.forEach(([a, v], i) => {
      const y = 100 + i * 37;
      x.fillStyle = '#7f9ab2'; x.font = `600 20px ${JP}`; x.fillText(a, 360, y);
      x.fillStyle = i === 4 && alarm ? '#ff6a5e' : '#e8f3ff'; x.font = `600 22px ${JP}`; x.fillText(v, 510, y, 330);
    });
    // supply bars
    const bars = [['電力', 0.86], ['酸素', 0.93], ['水', 0.71]];
    bars.forEach(([n, f], i) => {
      const y = 104 + i * 62, v = f + Math.sin(this.t * 0.07 + i) * 0.01;
      x.fillStyle = '#7f9ab2'; x.font = `600 18px ${JP}`; x.fillText(n, 870, y);
      x.fillStyle = '#132535'; x.fillRect(870, y + 10, 128, 14);
      x.fillStyle = v < 0.3 ? '#ff6a5e' : '#62c4ff'; x.fillRect(870, y + 10, 128 * v, 14);
    });
    if (alarm) {
      x.fillStyle = 'rgba(255,60,50,0.85)'; x.fillRect(360, 312, 640, 26);
      x.fillStyle = '#fff'; x.font = `700 18px ${JP}`; x.fillText('警報: 全員 脱出ポッドへ', 372, 331);
    }
  }
}
