// The promenade wing behind the grand lobby of a hub station: a 22 m long street module (thick
// walls with deep window reveals) with a café, a space-goods shop, vending machines, a seating
// nook, guest cabins and, at its end, an observation lounge under a glass dome looking aft at the
// turning habitat ring. Built in ship-local coordinates like the lobby (B-29 docked).
import * as THREE from 'three';
import { loft } from '../ship/sweep.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const D2R = Math.PI / 180;

// module axis (ship-local), inner radius, wall thickness, z range; the dome closes the aft end
export const PROM = { x: 13.0, y: 2.25, R: 3.5, T: 0.38, z0: 8.6, z1: 30.0, floorY: 0.25 };
export const PROM_DOOR = { x: 13.0, z: 8.3, w: 2.4, h: 2.85, depth: 0.6 };

const pP = (th, z, r = PROM.R) => V(PROM.x + r * Math.cos(th), PROM.y + r * Math.sin(th), z);

function cylGrid(th0, th1, nT, z0, z1, nZ, r, skip) {
  const pos = [], uv = [];
  for (let i = 0; i < nT; i++) for (let j = 0; j < nZ; j++) {
    const ta = th0 + (th1 - th0) * (i / nT), tb = th0 + (th1 - th0) * ((i + 1) / nT);
    const za = z0 + (z1 - z0) * (j / nZ), zb = z0 + (z1 - z0) * ((j + 1) / nZ);
    if (skip && skip((ta + tb) / 2, (za + zb) / 2)) continue;
    const A = pP(ta, za, r), B = pP(tb, za, r), C = pP(tb, zb, r), D = pP(ta, zb, r);
    pos.push(A.x, A.y, A.z, C.x, C.y, C.z, B.x, B.y, B.z, A.x, A.y, A.z, D.x, D.y, D.z, C.x, C.y, C.z);
    uv.push(ta * r * 0.5, za * 0.5, tb * r * 0.5, zb * 0.5, tb * r * 0.5, za * 0.5, ta * r * 0.5, za * 0.5, ta * r * 0.5, zb * 0.5, tb * r * 0.5, zb * 0.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** the four faces lining a window cut through a thick cylindrical wall */
function windowReveal(b, th0, th1, z0, z1, key) {
  const r0 = PROM.R, r1 = PROM.R + PROM.T, n = 12;
  // both windings: the reveal is seen from inside the room whichever way the quad was built
  const quad = (a, bb, c, d) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...bb, ...c, ...a, ...c, ...d, ...a, ...c, ...bb, ...a, ...d, ...c], 3)); g.computeVertexNormals(); return g; };
  const T = (v) => v.toArray();
  for (let i = 0; i < n; i++) {
    const ta = th0 + (th1 - th0) * i / n, tb = th0 + (th1 - th0) * (i + 1) / n;
    for (const z of [z0, z1]) b.add(quad(T(pP(ta, z, r0)), T(pP(tb, z, r0)), T(pP(tb, z, r1)), T(pP(ta, z, r1))), key);
  }
  for (const th of [th0, th1]) b.add(quad(T(pP(th, z0, r0)), T(pP(th, z1, r0)), T(pP(th, z1, r1)), T(pP(th, z0, r1))), key);
}

function canvasMat(w, h, draw, emissive = 1.2) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: emissive, color: 0x000000, roughness: 0.4 });
}

/**
 * Adds the promenade to the lobby's builder. M gets the extra materials it needs.
 * Returns { contains(p), doorDefs }.
 */
export function buildPromenade(b, M, lamp, R, def) {
  const { x: PX, y: PY, R: PR, T, z0, z1, floorY } = PROM;
  const hw = Math.sqrt(PR * PR - (PY - floorY) * (PY - floorY));     // floor half width
  const thF = Math.asin((floorY - PY) / PR);                          // floor line (right)
  const thL = Math.PI - thF;
  const name = (def.en || 'STATION').split(' ')[0];
  // ---- extra materials
  M.paintTeal = M.paintTeal || new THREE.MeshStandardMaterial({ color: 0x1f5f66, roughness: 0.45, metalness: 0.2 });
  M.paintRed = M.paintRed || new THREE.MeshStandardMaterial({ color: 0xa8322a, roughness: 0.4, metalness: 0.1 });
  M.paintYellow = M.paintYellow || new THREE.MeshStandardMaterial({ color: 0xd8a22a, roughness: 0.4, metalness: 0.1 });
  M.paintBlue = M.paintBlue || new THREE.MeshStandardMaterial({ color: 0x2a5ea8, roughness: 0.4, metalness: 0.1 });
  M.paintWhite = M.paintWhite || new THREE.MeshStandardMaterial({ color: 0xf1f0ec, roughness: 0.35, metalness: 0.05 });
  M.promSign = canvasMat(1024, 256, (g, w, h) => {
    g.fillStyle = '#06080b'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9a25a'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#f3efe6'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '300 92px "Helvetica Neue", Arial, sans-serif'; g.fillText('PROMENADE', w / 2, h * 0.4);
    g.fillStyle = '#e0b860'; g.font = '500 56px "Hiragino Mincho ProN", "Noto Serif JP", serif'; g.fillText('プロムナード', w / 2, h * 0.76);
  }, 1.4);
  M.cafeMenu = canvasMat(512, 512, (g, w, h) => {
    g.fillStyle = '#14100c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd9a0'; g.textAlign = 'center'; g.font = '700 54px Georgia, serif'; g.fillText('CAFÉ ' + name, w / 2, 76);
    g.fillStyle = '#f3e6d0'; g.textAlign = 'left'; g.font = '400 30px "Hiragino Sans", "Noto Sans JP", sans-serif';
    const items = [['エスプレッソ', '¥480'], ['カフェラテ', '¥560'], ['宇宙ほうじ茶', '¥420'], ['無重力パウチ', '+¥60'], ['月面チーズケーキ', '¥620'], ['オービット・サンド', '¥780']];
    items.forEach(([a, p], i) => { g.fillText(a, 44, 150 + i * 56); g.textAlign = 'right'; g.fillText(p, w - 44, 150 + i * 56); g.textAlign = 'left'; });
    g.strokeStyle = 'rgba(255,217,160,0.5)'; g.lineWidth = 2; g.strokeRect(20, 110, w - 40, h - 130);
  }, 1.1);
  M.shopSign = canvasMat(1024, 192, (g, w, h) => {
    g.fillStyle = '#071219'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7fe0ff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 74px "Helvetica Neue", Arial, sans-serif'; g.fillText('ORBIT GOODS', w * 0.42, h * 0.52);
    g.fillStyle = '#ffffff'; g.font = '500 44px "Hiragino Sans", "Noto Sans JP", sans-serif'; g.fillText('宇宙用品', w * 0.84, h * 0.52);
  }, 1.5);
  M.vending = canvasMat(256, 512, (g, w, h) => {
    g.fillStyle = '#0d1a2a'; g.fillRect(0, 0, w, h);
    const cols = ['#e04848', '#48a0e0', '#e0c048', '#48e08a', '#e08a48', '#c048e0'];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) { g.fillStyle = cols[(r * 4 + c) % cols.length]; g.fillRect(18 + c * 58, 30 + r * 80, 40, 58); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(22 + c * 58, 34 + r * 80, 10, 50); }
    g.fillStyle = '#e8f4ff'; g.font = '700 30px sans-serif'; g.textAlign = 'center'; g.fillText('DRINKS', w / 2, h - 46);
  }, 1.0);
  M.cabinPlate = canvasMat(512, 128, (g, w, h) => {
    g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e0b860'; g.font = '600 64px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('GUEST  101 · 102 · 103 · 104', w / 2, h / 2);
  }, 0.9);

  // ---- windows: long strips high on both sides and a skylight row (deep reveals: thick walls)
  const WR = { th: [24 * D2R, 50 * D2R] }, WL = { th: [130 * D2R, 156 * D2R] }, WS = { th: [80 * D2R, 100 * D2R] };
  const WZ = [[10.6, 14.4], [16.0, 19.8], [21.4, 25.2]];
  const inW = (th, z) => [WR, WL, WS].some((W) => th > W.th[0] && th < W.th[1]) && WZ.some(([a, c]) => z > a && z < c);
  b.add(cylGrid(thF, thL, 120, z0, z1, 86, PR, inW), 'cream');
  for (const W of [WR, WL, WS]) for (const [a, c] of WZ) {
    windowReveal(b, W.th[0], W.th[1], a, c, 'marbleDark');
    b.add(cylGrid(W.th[0], W.th[1], 16, a, c, 6, PR + T - 0.04), 'glass');
    const ring = [];
    for (let i = 0; i <= 16; i++) ring.push(pP(W.th[0] + (W.th[1] - W.th[0]) * (i / 16), a, PR - 0.02));
    for (let i = 0; i <= 16; i++) ring.push(pP(W.th[1] - (W.th[1] - W.th[0]) * (i / 16), c, PR - 0.02));
    b.tube(ring, 0.035, 'gold', { closed: true, radial: 8, seg: 100 });
  }
  // wall panelling: dark wood wainscot to 1.3 m, gold rail, arches every few metres
  const thW = Math.asin((1.3 - PY) / PR);
  b.add(cylGrid(thF, thW, 6, z0, z1, 40, PR - 0.02), 'wood');
  b.add(cylGrid(Math.PI - thW, thL, 6, z0, z1, 40, PR - 0.02), 'wood');
  for (const th of [thW, Math.PI - thW]) b.pipe(pP(th, z0 + 0.1, PR - 0.05), pP(th, z1 - 0.1, PR - 0.05), 0.02, 'gold', 8);
  for (const z of [10.2, 15.2, 20.6, 26.0]) {
    const secs = [];
    for (let i = 0; i <= 48; i++) { const th = thF + 0.02 + (thL - thF - 0.04) * (i / 48); secs.push([pP(th, z - 0.16, PR - 0.005), pP(th, z + 0.16, PR - 0.005), pP(th, z + 0.16, PR - 0.17), pP(th, z - 0.16, PR - 0.17)]); }
    b.add(loft(secs, { ring: true, caps: true }), 'wood');
  }
  // ceiling cove light down the middle and soft uplights
  for (const dx of [-0.95, 0.95]) {
    const yc = PY + Math.sqrt(PR * PR - dx * dx) - 0.05;
    b.box(0.05, 0.05, z1 - z0 - 1.0, 'cove', [PX + dx, yc, (z0 + z1) / 2], null, 0);
    b.box(0.2, 0.025, z1 - z0 - 0.9, 'gold', [PX + dx * 1.06, yc + 0.01, (z0 + z1) / 2], [0, 0, -dx * 0.28], 0.01);
  }

  // ---- front wall (with the portal) and floor
  const disk = (z, cx, holeW, holeH) => {
    const s = new THREE.Shape();
    for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2; const x = PX + Math.cos(a) * (PR + T), y = PY + Math.sin(a) * (PR + T); if (i === 0) s.moveTo(x, y); else s.lineTo(x, y); }
    if (holeW) {
      const h = new THREE.Path();
      const x0 = cx - holeW / 2, x1 = cx + holeW / 2, y0 = floorY, y1 = floorY + holeH;
      h.moveTo(x0, y0); h.lineTo(x0, y1 - 0.2); h.quadraticCurveTo(x0, y1, x0 + 0.2, y1); h.lineTo(x1 - 0.2, y1); h.quadraticCurveTo(x1, y1, x1, y1 - 0.2); h.lineTo(x1, y0); h.closePath();
      s.holes.push(h);
    }
    const g = new THREE.ShapeGeometry(s, 24);
    g.translate(0, 0, z);
    return g;
  };
  b.add(disk(z0, PROM_DOOR.x, PROM_DOOR.w + 0.6, PROM_DOOR.h + 0.3), 'cream');
  {
    const s = new THREE.Shape();
    // from the lobby's aft wall (under the portal) to the dome
    s.moveTo(PX - hw, -(z0 - 0.62)); s.lineTo(PX + hw, -(z0 - 0.62)); s.lineTo(PX + hw, -z1); s.lineTo(PX - hw, -z1); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, floorY - 0.12, 0);
    b.add(g, 'marble');
    b.colBox(hw * 2, 0.12, z1 - z0 + 0.4, [PX, floorY - 0.06, (z0 + z1) / 2 - 0.2]);
    // inlaid border and a carpet runner down the street
    for (const x of [PX - hw + 0.45, PX + hw - 0.45]) b.box(0.1, 0.004, z1 - z0 - 0.8, 'marbleDark', [x, floorY + 0.002, (z0 + z1) / 2], null, 0);
    b.box(1.2, 0.012, z1 - z0 - 3.0, 'carpet', [PX, floorY + 0.006, (z0 + z1) / 2 - 1.2], null, 0);
  }

  // ---- café (port side, by the entrance)
  {
    const cx = PX - hw + 0.75, za = 10.4, zb = 14.6;
    b.box(0.7, 1.05, zb - za, 'wood', [cx, floorY + 0.525, (za + zb) / 2], null, 0.03, 2);
    b.box(0.8, 0.05, zb - za + 0.1, 'marbleDark', [cx + 0.04, floorY + 1.08, (za + zb) / 2], null, 0.01);
    b.box(0.03, 0.04, zb - za, 'cove', [cx + 0.36, floorY + 0.12, (za + zb) / 2], null, 0);
    b.colBox(0.85, 1.1, zb - za + 0.1, [cx + 0.04, floorY + 0.55, (za + zb) / 2]);
    // espresso machine, grinder, cups, cake dome
    b.box(0.5, 0.42, 0.42, 'steel', [cx - 0.05, floorY + 1.31, za + 0.6], null, 0.04);
    b.box(0.46, 0.08, 0.38, 'black', [cx - 0.05, floorY + 1.18, za + 0.6], null, 0.01);
    for (const dz of [-0.1, 0.1]) b.cyl(0.025, 0.025, 0.12, 'brass', [cx + 0.2, floorY + 1.2, za + 0.6 + dz], [0, 0, Math.PI / 2], 10);
    b.cyl(0.08, 0.1, 0.36, 'black', [cx - 0.05, floorY + 1.29, za + 1.25], null, 14);
    b.sphere(0.09, 'crystal', [cx - 0.05, floorY + 1.52, za + 1.25], 12);
    for (let k = 0; k < 6; k++) b.cyl(0.035, 0.03, 0.08, 'ceramic', [cx + 0.15, floorY + 1.15, za + 1.7 + k * 0.12], null, 12);
    b.cyl(0.16, 0.16, 0.02, 'marble', [cx, floorY + 1.12, zb - 0.6], null, 24);
    b.sphere(0.15, 'crystal', [cx, floorY + 1.13, zb - 0.6], 16, [1, 0.8, 1]);
    b.cyl(0.11, 0.11, 0.07, 'leatherCream', [cx, floorY + 1.165, zb - 0.6], null, 16);
    // menu board on the wall above, pendant lamps, stools
    const mp = pP(Math.PI - 10 * D2R, (za + zb) / 2, PR - 0.12);
    b.box(0.05, 1.05, 1.05, 'black', [mp.x, 2.45, (za + zb) / 2], null, 0.02);
    b.add(new THREE.PlaneGeometry(0.98, 0.98), 'cafeMenu', [mp.x + 0.03, 2.45, (za + zb) / 2], [0, Math.PI / 2, 0]);
    for (const z of [za + 0.8, (za + zb) / 2, zb - 0.8]) {
      b.pipe([cx + 0.2, PY + PR - 0.3, z], [cx + 0.2, floorY + 2.05, z], 0.008, 'black', 6);
      b.cyl(0.05, 0.16, 0.14, 'brass', [cx + 0.2, floorY + 2.0, z], null, 16, true);
      b.sphere(0.06, 'lampWarm', [cx + 0.2, floorY + 1.95, z], 10);
    }
    for (const z of [za + 0.7, za + 1.6, za + 2.5, za + 3.4]) {
      b.cyl(0.02, 0.02, 0.7, 'brass', [cx + 0.72, floorY + 0.35, z], null, 8);
      b.cyl(0.17, 0.17, 0.06, 'leather', [cx + 0.72, floorY + 0.72, z], null, 16);
      b.cyl(0.16, 0.2, 0.03, 'brass', [cx + 0.72, floorY + 0.015, z], null, 16);
      b.colCyl(0.2, 0.76, [cx + 0.72, floorY + 0.38, z]);
    }
    lamp(cx + 0.6, 2.2, (za + zb) / 2, 0xffd2a0, 2.6, 7);
  }

  // ---- shop (starboard side): shelves of colourful goods, a lit sign, a display case
  {
    const sx = PX + hw - 0.45, za = 10.4, zb = 14.8;
    const colors = ['paintRed', 'paintBlue', 'paintYellow', 'paintTeal', 'paintWhite', 'leather'];
    for (const z of [za + 0.9, za + 2.2, za + 3.5]) {
      b.box(0.5, 2.0, 1.1, 'wood', [sx, floorY + 1.0, z], null, 0.02);
      b.colBox(0.55, 2.0, 1.15, [sx, floorY + 1.0, z]);
      for (let s = 0; s < 4; s++) {
        const y = floorY + 0.35 + s * 0.45;
        b.box(0.46, 0.025, 1.04, 'black', [sx - 0.02, y, z], null, 0.005);
        for (let k = 0; k < 5; k++) {
          const hh = 0.12 + R() * 0.18, ww = 0.1 + R() * 0.12;
          b.box(0.22, hh, ww, colors[(s * 5 + k + Math.floor(z)) % colors.length], [sx - 0.08, y + hh / 2 + 0.013, z - 0.4 + k * 0.2], null, 0.01);
        }
      }
    }
    b.box(0.05, 0.36, 2.0, 'black', [sx + 0.02, floorY + 2.45, (za + zb) / 2], null, 0.02);
    b.add(new THREE.PlaneGeometry(1.95, 0.34), 'shopSign', [sx - 0.01, floorY + 2.45, (za + zb) / 2], [0, -Math.PI / 2, 0]);
    // glass display case with a model of B-29 and a helmet
    const dx = PX + hw - 1.5, dz = zb - 0.2;
    b.box(0.8, 0.8, 0.8, 'wood', [dx, floorY + 0.4, dz], null, 0.03);
    b.box(0.78, 0.5, 0.78, 'crystal', [dx, floorY + 1.05, dz], null, 0.01);
    b.cyl(0.05, 0.08, 0.36, 'paintWhite', [dx, floorY + 1.0, dz], [Math.PI / 2, 0, 0], 12);
    b.sphere(0.12, 'paintWhite', [dx + 0.18, floorY + 0.94, dz], 16);
    b.colBox(0.82, 1.3, 0.82, [dx, floorY + 0.65, dz]);
    lamp(sx - 0.8, 2.3, (za + zb) / 2, 0xe8f2ff, 2.4, 7);
  }

  // ---- street furniture down the middle: planters with trees, benches, a lit info pillar
  for (const z of [16.6, 20.4]) {
    b.box(1.0, 0.5, 1.6, 'marbleDark', [PX, floorY + 0.25, z], null, 0.04);
    b.box(0.9, 0.06, 1.5, 'soil', [PX, floorY + 0.49, z], null, 0.01);
    b.colBox(1.05, 0.55, 1.65, [PX, floorY + 0.27, z]);
    // a small tree: trunk and layered canopy
    b.cyl(0.05, 0.08, 1.4, 'trunk', [PX, floorY + 1.2, z], null, 10);
    for (const [dy, rr] of [[1.75, 0.55], [2.05, 0.45], [2.3, 0.3]]) b.sphere(rr, R() > 0.5 ? 'leaf' : 'leafLight', [PX + (R() - 0.5) * 0.2, floorY + dy, z + (R() - 0.5) * 0.2], 12, [1, 0.7, 1]);
    for (const s of [-1, 1]) {
      b.box(0.45, 0.06, 1.5, 'wood', [PX + s * 0.78, floorY + 0.44, z], null, 0.02);
      b.box(0.08, 0.42, 1.5, 'wood', [PX + s * 1.0, floorY + 0.7, z], null, 0.02);
      for (const dz of [-0.6, 0.6]) b.box(0.4, 0.42, 0.05, 'brass', [PX + s * 0.78, floorY + 0.21, z + dz], null, 0.01);
      b.colBox(0.5, 0.48, 1.5, [PX + s * 0.8, floorY + 0.24, z]);
    }
  }
  {
    const z = 18.5;
    b.cyl(0.22, 0.26, 1.6, 'black', [PX, floorY + 0.8, z], null, 24);
    b.cyl(0.235, 0.235, 0.9, 'screen', [PX, floorY + 1.05, z], null, 24, true);
    b.torus(0.25, 0.015, 'gold', [PX, floorY + 1.62, z], [Math.PI / 2, 0, 0], 32);
    b.colCyl(0.27, 1.6, [PX, floorY + 0.8, z]);
  }
  // vending machines and a seating nook (z 16..20)
  {
    const vx = PX - hw + 0.42;
    for (const z of [16.4, 17.25]) {
      b.box(0.62, 1.85, 0.8, 'paintRed', [vx, floorY + 0.925, z], null, 0.03);
      b.add(new THREE.PlaneGeometry(0.66, 1.3), 'vending', [vx + 0.32, floorY + 1.15, z], [0, Math.PI / 2, 0]);
      b.box(0.04, 0.2, 0.5, 'black', [vx + 0.32, floorY + 0.3, z], null, 0.01);
      b.colBox(0.66, 1.9, 0.82, [vx, floorY + 0.95, z]);
    }
    lamp(vx + 0.8, 1.6, 16.8, 0xbfe0ff, 1.2, 4);
    const nx = PX + hw - 0.95;
    for (const z of [17.2, 19.2]) {
      b.box(0.85, 0.42, 0.8, 'velvet', [nx, floorY + 0.21, z], null, 0.08, 3);
      b.box(0.2, 0.6, 0.8, 'velvet', [nx + 0.35, floorY + 0.6, z], null, 0.08, 3);
      b.colBox(0.9, 0.5, 0.85, [nx, floorY + 0.25, z]);
    }
    b.cyl(0.32, 0.32, 0.04, 'marbleDark', [nx - 0.1, floorY + 0.52, 18.2], null, 24);
    b.cyl(0.04, 0.06, 0.5, 'brass', [nx - 0.1, floorY + 0.25, 18.2], null, 10);
    b.colCyl(0.33, 0.55, [nx - 0.1, floorY + 0.27, 18.2]);
    lamp(nx - 0.6, 2.0, 18.2, 0xffd8a8, 1.8, 5);
  }

  // ---- guest cabins (z 21..25): recessed doors with number plates on both sides
  for (const s of [-1, 1]) for (const z of [22.0, 24.2]) {
    const th = s > 0 ? 8 * D2R : Math.PI - 8 * D2R;
    const p = pP(th, z, PR - 0.06);
    const rotY = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    b.box(0.12, 2.2, 1.2, 'black', [p.x, floorY + 1.1, z], null, 0.02);
    b.box(0.08, 2.05, 1.0, 'wood', [p.x - s * 0.05, floorY + 1.05, z], null, 0.02);
    b.box(0.04, 0.3, 0.05, 'gold', [p.x - s * 0.1, floorY + 1.05, z + 0.38], null, 0.01);
    b.box(0.02, 0.02, 0.9, 'cove', [p.x - s * 0.1, floorY + 2.18, z], null, 0);
    b.sphere(0.025, R() > 0.5 ? 'cove' : 'lampSoft', [p.x - s * 0.09, floorY + 1.45, z + 0.38], 8);
    void rotY;
  }
  for (const s of [-1, 1]) {
    const p = pP(s > 0 ? 20 * D2R : Math.PI - 20 * D2R, 23.1, PR - 0.1);
    b.box(0.04, 0.24, 0.96, 'black', [p.x, 2.75, 23.1], null, 0.01);
    b.add(new THREE.PlaneGeometry(0.92, 0.22), 'cabinPlate', [p.x - s * 0.025, 2.75, 23.1], [0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0]);
  }
  lamp(PX, 2.6, 23.1, 0xffe2b8, 2.0, 7);

  // ---- observation lounge: glass dome closing the module, lounge chairs, a telescope
  {
    const segs = 48;
    const dome = new THREE.SphereGeometry(PR + T * 0.5, segs, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.rotateX(Math.PI / 2);   // pole along +z
    b.add(dome, 'glass', [PX, PY, z1]);
    b.torus(PR + 0.05, 0.12, 'gold', [PX, PY, z1], [0, 0, 0], 96);
    b.torus(PR + 0.25, 0.05, 'steel', [PX, PY, z1 + 0.05], [0, 0, 0], 96);
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      const pts = [];
      for (let i = 0; i <= 16; i++) { const ph = (i / 16) * Math.PI / 2; const r = (PR + T * 0.5) * Math.cos(ph) - 0.02; pts.push(V(PX + Math.cos(a) * r, PY + Math.sin(a) * r, z1 + (PR + T * 0.5) * Math.sin(ph) - 0.02)); }
      b.tube(pts, 0.035, 'gold', { radial: 6, seg: 32 });
    }
    // balcony floor inside the dome, rail at its edge
    const rr = Math.sqrt((PR * PR) - (PY - floorY) * (PY - floorY)) - 0.08;
    const hs = new THREE.Shape();
    for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI; const x = PX + Math.cos(a) * rr, y = -(z1 + Math.sin(a) * rr); if (i === 0) hs.moveTo(x, y); else hs.lineTo(x, y); }
    hs.closePath();
    const half = new THREE.ShapeGeometry(hs, 32);
    half.rotateX(-Math.PI / 2);
    b.add(half, 'marbleDark', [0, floorY - 0.001, 0]);
    b.colCyl(rr, 0.12, [PX, floorY - 0.06, z1]);
    const rail = [];
    for (let i = 0; i <= 24; i++) { const a = -Math.PI / 2 + (i / 24) * Math.PI; rail.push(V(PX + Math.sin(a) * (rr - 0.15), floorY + 1.0, z1 + Math.cos(a) * (rr - 0.15))); }
    b.tube(rail, 0.025, 'brass', { radial: 8, seg: 64 });
    for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; b.pipe([PX + Math.sin(a) * (rr - 0.15), floorY, z1 + Math.cos(a) * (rr - 0.15)], [PX + Math.sin(a) * (rr - 0.15), floorY + 1.0, z1 + Math.cos(a) * (rr - 0.15)], 0.015, 'brass', 6); }
    // dome collider: a coarse hemisphere just outside the glass
    const cg = new THREE.SphereGeometry(PR + 0.02, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    cg.rotateX(Math.PI / 2);
    cg.translate(PX, PY, z1);
    b.colMesh(cg);
    // lounge chairs facing the view, a side table, the telescope
    for (const dx of [-1.6, -0.55, 0.55, 1.6]) {
      const z = z1 - 1.6;
      b.box(0.7, 0.38, 0.75, 'leatherCream', [PX + dx, floorY + 0.19, z], null, 0.1, 3);
      b.box(0.7, 0.75, 0.18, 'leatherCream', [PX + dx, floorY + 0.55, z - 0.4], [-0.35, 0, 0], 0.08, 3);
      b.colBox(0.72, 0.5, 0.8, [PX + dx, floorY + 0.25, z - 0.1]);
    }
    b.cyl(0.04, 0.04, 1.3, 'black', [PX + 2.0, floorY + 0.65, z1 + 0.6], null, 8);
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2; b.pipe([PX + 2.0, floorY + 0.9, z1 + 0.6], [PX + 2.0 + Math.cos(a) * 0.35, floorY, z1 + 0.6 + Math.sin(a) * 0.35], 0.012, 'black', 6); }
    b.cyl(0.09, 0.07, 0.9, 'paintWhite', [PX + 2.0, floorY + 1.35, z1 + 0.6], [1.0, 0, 0.2], 16);
    b.colCyl(0.25, 1.4, [PX + 2.0, floorY + 0.7, z1 + 0.6]);
    lamp(PX, 1.4, z1 - 1.0, 0xffcf98, 1.4, 6);
  }

  // ---- hanging sign at the entrance
  b.box(2.3, 0.62, 0.06, 'black', [PX, 3.55, z0 + 0.9], null, 0.02);
  b.add(new THREE.PlaneGeometry(2.2, 0.55), 'promSign', [PX, 3.55, z0 + 0.86], [0, Math.PI, 0]);
  b.add(new THREE.PlaneGeometry(2.2, 0.55), 'promSign', [PX, 3.55, z0 + 0.94]);
  for (const dx of [-0.9, 0.9]) b.pipe([PX + dx, 3.86, z0 + 0.9], [PX + dx, PY + Math.sqrt(PR * PR - dx * dx) - 0.05, z0 + 0.9], 0.008, 'brass', 6);
  lamp(PX, 2.8, z0 + 2.4, 0xffe6c0, 2.6, 8);
  lamp(PX, 2.8, 13.0, 0xffe6c0, 2.2, 8);

  // ---- colliders: the shell (half-metre sections, cut at the portal), the front wall around it
  {
    const ring = (z) => { const pts = []; for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2; pts.push(V(PX + Math.cos(a) * (PR - 0.02), PY + Math.sin(a) * (PR - 0.02), z)); } return pts; };
    const rings = [];
    for (let k = 0; k <= 43; k++) rings.push(ring(z0 + (z1 - z0) * (k / 43)));
    b.colMesh(loft(rings, { ring: true, caps: false }));
    const dw = PROM_DOOR.w / 2 + 0.05, dh = PROM_DOOR.h + 0.05;
    const fz = z0 - 0.02;
    b.colBox(PX - dw - (PX - PR - T), PR * 2 + T * 2, 0.12, [(PX - dw + PX - PR - T) / 2, PY, fz]);
    b.colBox(PX + PR + T - (PX + dw), PR * 2 + T * 2, 0.12, [(PX + dw + PX + PR + T) / 2, PY, fz]);
    b.colBox(dw * 2, PY + PR + T - (floorY + dh), 0.12, [PX, (floorY + dh + PY + PR + T) / 2, fz]);
  }

  const contains = (p) => {
    const dx = p.x - PX, dy = p.y - PY;
    if (p.y < floorY - 0.4) return false;
    if (p.z >= z0 - 0.7 && p.z <= z1 && dx * dx + dy * dy < (PR - 0.05) * (PR - 0.05)) return true;
    if (p.z > z1) return dx * dx + dy * dy + (p.z - z1) * (p.z - z1) < (PR - 0.05) * (PR - 0.05);
    return false;
  };
  return { contains, hw };
}

/** the promenade's outer shell for the station model (station-local; cx, cy: module axis) */
export function promenadeShellExterior(b, cx, cy, zOff) {
  const { R: PR, T, z0, z1 } = PROM;
  const Ro = PR + T + 0.02;
  const za = z0 + zOff - 0.6, zb = z1 + zOff;
  b.cyl(Ro, Ro, zb - za, 'hull', [cx, cy, (za + zb) / 2], [Math.PI / 2, 0, 0], 48, true);
  for (const z of [za + 0.4, (za + zb) / 2, zb - 0.3]) b.torus(Ro + 0.03, 0.1, 'gold', [cx, cy, z], [0, 0, 0], 48);
  // window strips glowing warm, the lit observation dome
  for (const [a, c] of [[10.6, 14.4], [16.0, 19.8], [21.4, 25.2]]) {
    for (const th of [37 * Math.PI / 180, 143 * Math.PI / 180, Math.PI / 2]) b.box(0.1, 0.9, c - a, 'lobbyGlow', [cx + Ro * Math.cos(th), cy + Ro * Math.sin(th), (a + c) / 2 + zOff], [0, 0, th - Math.PI / 2], 0.02);
  }
  const dome = new THREE.SphereGeometry(PR + T * 0.5 + 0.02, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.rotateX(Math.PI / 2);
  b.add(dome, 'dome', [cx, cy, zb]);
  b.sphere(PR * 0.7, 'lobbyGlow', [cx, cy - 1.0, zb + 0.4], 24, [1, 0.25, 0.5]);
  b.torus(PR + 0.1, 0.16, 'gold', [cx, cy, zb], [0, 0, 0], 64);
  return { Ro, za, zb };
}
