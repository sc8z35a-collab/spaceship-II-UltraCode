// High-resolution surface detail for the cabin, generated once at start-up and sampled triplanar
// in ship space by the ship materials. Linear RGBA data (no premultiplication):
//   R height (0.5 flat)   G albedo factor (0.5 = x1)   B roughness offset (0.5 = 0)   A label ink
// panel: hard wall panels with recessed rounded seams, screws, vent grilles, ribs and labels
// pad:   quilted padding with stitched diamonds and woven fabric
// floor: tread plates with diamond pattern, bolts and worn walkways
import * as THREE from 'three';
import { rng } from './geom.js';

const S = 1024;
export const DETAIL_TILE = { panel: 1.2, pad: 0.8, floor: 1.2, hull: 2.4, rad: 1.0, mli: 0.5 };

function layer() {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, S, S);
  return g;
}
const grey = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;
const greyA = (v, a) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** wrap-around drawing: call f with offsets so shapes crossing an edge continue on the other side */
function wrapped(f) { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) f(dx, dy); }

function noise(g, R, amp, alpha = 1) {
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * amp; d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = d[i]; d[i + 2] = d[i]; }
  g.putImageData(img, 0, 0);
  void alpha;
}

function pack(H, A, Rg, I) {
  const h = H.getImageData(0, 0, S, S).data, a = A.getImageData(0, 0, S, S).data, r = Rg.getImageData(0, 0, S, S).data, k = I.getImageData(0, 0, S, S).data;
  const out = new Uint8Array(S * S * 4);
  for (let i = 0; i < out.length; i += 4) { out[i] = h[i]; out[i + 1] = a[i]; out[i + 2] = r[i]; out[i + 3] = 255 - k[i]; }
  const t = new THREE.DataTexture(out, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function fakeText(g, R, x, y, w, lines, size) {
  for (let l = 0; l < lines; l++) {
    let cx = x;
    const yy = y + l * size * 1.7;
    while (cx < x + w) {
      const ww = size * (0.4 + R() * 2.4);
      if (cx + ww > x + w) break;
      g.fillRect(cx, yy, ww, size);
      cx += ww + size * (R() < 0.25 ? 1.4 : 0.45);
    }
  }
}

function makePanel() {
  const R = rng(1201);
  const H = layer(), A = layer(), Rg = layer(), I = layer();
  I.fillStyle = grey(0); I.fillRect(0, 0, S, S);
  const px = S / DETAIL_TILE.panel;                       // pixels per metre
  const seam = 0.006 * px;
  // panel layout (metres): three bands, different splits
  const rows = [[0, 0.4, [0, 0.6, 1.2]], [0.4, 0.8, [0, 0.4, 0.8, 1.2]], [0.8, 1.2, [0, 1.2]]];
  H.fillStyle = grey(52); H.fillRect(0, 0, S, S);         // the seams are recessed
  Rg.fillStyle = grey(175); Rg.fillRect(0, 0, S, S);
  A.fillStyle = grey(96); A.fillRect(0, 0, S, S);
  let n = 0;
  for (const [y0, y1, xs] of rows) for (let k = 0; k < xs.length - 1; k++) {
    const x = xs[k] * px + seam / 2, y = y0 * px + seam / 2, w = (xs[k + 1] - xs[k]) * px - seam, h = (y1 - y0) * px - seam;
    const r = 0.018 * px;
    // face with a soft bevel toward the edges
    for (let b = 0; b < 6; b++) { H.fillStyle = grey(118 + b * 5); rr(H, x + b, y + b, w - 2 * b, h - 2 * b, Math.max(2, r - b)); H.fill(); }
    H.fillStyle = grey(150); rr(H, x + 6, y + 6, w - 12, h - 12, Math.max(2, r - 6)); H.fill();
    const tint = 126 + (R() - 0.5) * 16;
    A.fillStyle = grey(tint); rr(A, x, y, w, h, r); A.fill();
    Rg.fillStyle = grey(118 + (R() - 0.5) * 20); rr(Rg, x, y, w, h, r); Rg.fill();
    // screws in the corners
    const sc = 0.022 * px;
    for (const [cx, cy] of [[x + sc, y + sc], [x + w - sc, y + sc], [x + sc, y + h - sc], [x + w - sc, y + h - sc]]) {
      H.fillStyle = grey(110); H.beginPath(); H.arc(cx, cy, 8.5, 0, Math.PI * 2); H.fill();
      H.fillStyle = grey(178); H.beginPath(); H.arc(cx, cy, 6.5, 0, Math.PI * 2); H.fill();
      H.strokeStyle = grey(120); H.lineWidth = 1.6; const a = R() * Math.PI;
      H.beginPath(); H.moveTo(cx - Math.cos(a) * 5, cy - Math.sin(a) * 5); H.lineTo(cx + Math.cos(a) * 5, cy + Math.sin(a) * 5); H.stroke();
      Rg.fillStyle = grey(70); Rg.beginPath(); Rg.arc(cx, cy, 7, 0, Math.PI * 2); Rg.fill();
      A.fillStyle = grey(150); A.beginPath(); A.arc(cx, cy, 6.5, 0, Math.PI * 2); A.fill();
    }
    n++;
    // detail per panel
    if (n === 4) {
      // vent grille: rows of rounded slots
      const gx = x + w * 0.2, gy = y + h * 0.28, gw = w * 0.6, gh = h * 0.44;
      H.fillStyle = grey(132); rr(H, gx - 6, gy - 6, gw + 12, gh + 12, 8); H.fill();
      for (let s = 0; s < 8; s++) { H.fillStyle = grey(40); rr(H, gx, gy + s * gh / 8, gw, gh / 8 * 0.5, 3); H.fill(); A.fillStyle = grey(70); rr(A, gx, gy + s * gh / 8, gw, gh / 8 * 0.5, 3); A.fill(); }
    } else if (n === 6) {
      // wide panel: two embossed ribs and a label plate
      for (const f of [0.3, 0.7]) { H.fillStyle = grey(168); H.fillRect(x + 30, y + h * f - 3, w - 60, 6); }
      I.fillStyle = grey(255);
      I.lineWidth = 3; I.strokeStyle = grey(255); I.strokeRect(x + w * 0.07, y + h * 0.4, w * 0.22, h * 0.2);
      fakeText(I, R, x + w * 0.08, y + h * 0.43, w * 0.2, 3, 7);
      I.fillRect(x + w * 0.75, y + h * 0.44, w * 0.14, 12);
    } else if (n === 1 || n === 5) {
      // access port: recessed circle with a quarter-turn fastener
      const cx = x + w * 0.5, cy = y + h * 0.55;
      H.fillStyle = grey(92); H.beginPath(); H.arc(cx, cy, 34, 0, Math.PI * 2); H.fill();
      H.fillStyle = grey(140); H.beginPath(); H.arc(cx, cy, 28, 0, Math.PI * 2); H.fill();
      H.fillStyle = grey(110); H.fillRect(cx - 14, cy - 3, 28, 6);
      I.fillStyle = grey(255); fakeText(I, R, x + w * 0.12, y + h * 0.16, w * 0.4, 1, 8);
    } else if (n === 3) {
      I.fillStyle = grey(255);
      // hazard chevrons strip
      for (let c = 0; c < 6; c++) { I.beginPath(); const bx = x + w * 0.15 + c * 22; I.moveTo(bx, y + h - 40); I.lineTo(bx + 10, y + h - 40); I.lineTo(bx + 22, y + h - 28); I.lineTo(bx + 12, y + h - 28); I.closePath(); I.fill(); }
      fakeText(I, R, x + w * 0.15, y + h * 0.2, w * 0.6, 2, 9);
    }
  }
  // wear: scuffs and scratches (albedo lighter, roughness lower), grime along the seams
  for (let k = 0; k < 160; k++) {
    const x = R() * S, y = R() * S, a = (R() - 0.5) * 0.6, l = 8 + R() * 60;
    wrapped((dx, dy) => {
      A.strokeStyle = greyA(R() > 0.5 ? 160 : 90, 0.35); A.lineWidth = 0.8 + R() * 1.4;
      A.beginPath(); A.moveTo(x + dx, y + dy); A.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); A.stroke();
      Rg.strokeStyle = greyA(80, 0.4); Rg.lineWidth = 1;
      Rg.beginPath(); Rg.moveTo(x + dx, y + dy); Rg.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); Rg.stroke();
    });
  }
  noise(A, R, 7); noise(Rg, R, 14); noise(H, R, 3);
  return pack(H, A, Rg, I);
}

function makePad() {
  const R = rng(2203);
  const H = layer(), A = layer(), Rg = layer(), I = layer();
  I.fillStyle = grey(0); I.fillRect(0, 0, S, S);
  Rg.fillStyle = grey(200); Rg.fillRect(0, 0, S, S);
  // woven fabric
  for (let y = 0; y < S; y += 3) { A.fillStyle = greyA(R() > 0.5 ? 140 : 116, 0.5); A.fillRect(0, y, S, 1.5); }
  for (let x = 0; x < S; x += 3) { A.fillStyle = greyA(R() > 0.5 ? 138 : 118, 0.4); A.fillRect(x, 0, 1.5, S); }
  // quilting: puffy diamonds with stitched seams (4 x 4 per tile)
  const n = 4, c = S / n;
  H.fillStyle = grey(100); H.fillRect(0, 0, S, S);
  for (let i = -1; i <= n; i++) for (let j = -1; j <= n; j++) {
    const cx = i * c + (j % 2 ? c / 2 : 0), cy = j * c / 2;
    const gr = H.createRadialGradient(cx, cy, 4, cx, cy, c * 0.55);
    gr.addColorStop(0, grey(200)); gr.addColorStop(0.7, grey(150)); gr.addColorStop(1, grey(100));
    H.fillStyle = gr;
    H.beginPath(); H.moveTo(cx, cy - c / 2); H.lineTo(cx + c / 2, cy); H.lineTo(cx, cy + c / 2); H.lineTo(cx - c / 2, cy); H.closePath(); H.fill();
  }
  // stitches along the diamond lines
  H.strokeStyle = grey(60); H.lineWidth = 3; A.strokeStyle = greyA(90, 0.8); A.lineWidth = 2; A.setLineDash([7, 5]);
  for (let k = -n; k <= 2 * n; k++) {
    for (const g of [H, A]) {
      g.beginPath(); g.moveTo(k * c, 0); g.lineTo(k * c + S, S); g.stroke();
      g.beginPath(); g.moveTo(k * c, 0); g.lineTo(k * c - S, S); g.stroke();
    }
  }
  A.setLineDash([]);
  // button tufts at the crossings
  for (let i = 0; i <= n; i++) for (let j = 0; j <= 2 * n; j++) {
    const cx = i * c + (j % 2 ? c / 2 : 0), cy = j * c / 2;
    H.fillStyle = grey(40); H.beginPath(); H.arc(cx, cy, 7, 0, Math.PI * 2); H.fill();
    A.fillStyle = grey(70); A.beginPath(); A.arc(cx, cy, 6, 0, Math.PI * 2); A.fill();
  }
  noise(A, R, 10); noise(H, R, 4);
  return pack(H, A, Rg, I);
}

function makeFloor() {
  const R = rng(3307);
  const H = layer(), A = layer(), Rg = layer(), I = layer();
  I.fillStyle = grey(0); I.fillRect(0, 0, S, S);
  const px = S / DETAIL_TILE.floor, plate = 0.6 * px, seam = 0.008 * px;
  H.fillStyle = grey(40); H.fillRect(0, 0, S, S);
  Rg.fillStyle = grey(160); Rg.fillRect(0, 0, S, S);
  A.fillStyle = grey(80); A.fillRect(0, 0, S, S);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const x = i * plate + seam / 2, y = j * plate + seam / 2, w = plate - seam;
    H.fillStyle = grey(120); rr(H, x, y, w, w, 6); H.fill();
    A.fillStyle = grey(120 + (R() - 0.5) * 14); rr(A, x, y, w, w, 6); A.fill();
    Rg.fillStyle = grey(140); rr(Rg, x, y, w, w, 6); Rg.fill();
    // diamond tread
    H.save(); rr(H, x + 10, y + 10, w - 20, w - 20, 4); H.clip();
    for (let a = 0; a < w / 18 + 2; a++) for (let b = 0; b < w / 18 + 2; b++) {
      const cx = x + a * 18 + (b % 2 ? 9 : 0), cy = y + b * 18;
      H.save(); H.translate(cx, cy); H.rotate((a + b) % 2 ? 0.785 : -0.785);
      H.fillStyle = grey(165); H.fillRect(-9, -2.5, 18, 5);
      H.restore();
    }
    H.restore();
    // bolts
    for (const [cx, cy] of [[x + 22, y + 22], [x + w - 22, y + 22], [x + 22, y + w - 22], [x + w - 22, y + w - 22]]) {
      H.fillStyle = grey(190); H.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; H.lineTo(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9); } H.closePath(); H.fill();
      Rg.fillStyle = grey(80); Rg.beginPath(); Rg.arc(cx, cy, 9, 0, Math.PI * 2); Rg.fill();
    }
    // worn walkway across the plate (shinier, lighter)
    const gr = A.createLinearGradient(x, y, x + w, y);
    gr.addColorStop(0, greyA(128, 0)); gr.addColorStop(0.5, greyA(170, 0.35)); gr.addColorStop(1, greyA(128, 0));
    A.fillStyle = gr; A.fillRect(x + 10, y + 10, w - 20, w - 20);
    const gr2 = Rg.createLinearGradient(x, y, x + w, y);
    gr2.addColorStop(0, greyA(140, 0)); gr2.addColorStop(0.5, greyA(70, 0.45)); gr2.addColorStop(1, greyA(140, 0));
    Rg.fillStyle = gr2; Rg.fillRect(x + 10, y + 10, w - 20, w - 20);
  }
  // grime blotches
  for (let k = 0; k < 40; k++) { const x = R() * S, y = R() * S, r = 20 + R() * 90; wrapped((dx, dy) => { const gg = A.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r); gg.addColorStop(0, greyA(60, 0.18)); gg.addColorStop(1, greyA(60, 0)); A.fillStyle = gg; A.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r); }); }
  noise(A, R, 10); noise(Rg, R, 16); noise(H, R, 4);
  return pack(H, A, Rg, I);
}

function makeHull() {
  // exterior plating: staggered 1.2 x 0.6 m panels, rivet rows, access covers, stencils
  const R = rng(4409);
  const H = layer(), A = layer(), Rg = layer(), I = layer();
  I.fillStyle = grey(0); I.fillRect(0, 0, S, S);
  const px = S / DETAIL_TILE.hull, pw = 1.2 * px, ph = 0.6 * px;
  H.fillStyle = grey(140); H.fillRect(0, 0, S, S);
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? pw / 2 : 0;
    for (let col = -1; col < 3; col++) {
      const x = col * pw + off, y = row * ph;
      const tint = 128 + (R() - 0.5) * 12;
      wrapped((dx, dy) => {
        A.fillStyle = grey(tint); A.fillRect(x + dx, y + dy, pw, ph);
        Rg.fillStyle = grey(124 + (R() - 0.5) * 16); Rg.fillRect(x + dx, y + dy, pw, ph);
        // panel line (recessed) and rivet rows inside each edge
        H.fillStyle = grey(60); H.fillRect(x + dx, y + dy, pw, 2.2); H.fillRect(x + dx, y + dy, 2.2, ph);
        A.fillStyle = grey(84); A.fillRect(x + dx, y + dy, pw, 2); A.fillRect(x + dx, y + dy, 2, ph);
        for (let t = 14; t < pw - 8; t += 17) for (const yy of [7, ph - 6]) { H.fillStyle = grey(176); H.beginPath(); H.arc(x + dx + t, y + dy + yy, 1.6, 0, Math.PI * 2); H.fill(); }
        for (let t = 14; t < ph - 8; t += 17) for (const xx of [7, pw - 6]) { H.fillStyle = grey(176); H.beginPath(); H.arc(x + dx + xx, y + dy + t, 1.6, 0, Math.PI * 2); H.fill(); }
      });
      // access cover in some panels
      if (R() < 0.45) {
        const cw = 50 + R() * 60, ch = 34 + R() * 40, cx = x + 30 + R() * (pw - cw - 60), cy = y + 26 + R() * (ph - ch - 52);
        wrapped((dx, dy) => {
          H.strokeStyle = grey(78); H.lineWidth = 1.6; rr(H, cx + dx, cy + dy, cw, ch, 4); H.stroke();
          for (const [fx, fy] of [[5, 5], [cw - 5, 5], [5, ch - 5], [cw - 5, ch - 5]]) { H.fillStyle = grey(182); H.beginPath(); H.arc(cx + dx + fx, cy + dy + fy, 2.4, 0, Math.PI * 2); H.fill(); }
          A.fillStyle = grey(tint - 8); rr(A, cx + dx + 1, cy + dy + 1, cw - 2, ch - 2, 4); A.fill();
        });
      }
      // stencils: NO STEP plates, arrows, numbers
      const k = R();
      I.fillStyle = grey(255); I.strokeStyle = grey(255);
      if (k < 0.18) { const sx = x + 40 + R() * (pw - 160), sy = y + 30 + R() * (ph - 80); wrapped((dx, dy) => { I.lineWidth = 2; I.strokeRect(sx + dx, sy + dy, 110, 26); fakeText(I, R, sx + dx + 8, sy + dy + 8, 94, 1, 9); }); }
      else if (k < 0.32) { const sx = x + 50 + R() * (pw - 120), sy = y + 40 + R() * (ph - 80); wrapped((dx, dy) => { I.beginPath(); I.moveTo(sx + dx, sy + dy); I.lineTo(sx + dx + 30, sy + dy + 12); I.lineTo(sx + dx, sy + dy + 24); I.closePath(); I.fill(); I.fillRect(sx + dx - 36, sy + dy + 9, 36, 6); }); }
      else if (k < 0.46) { const sx = x + 40 + R() * (pw - 120), sy = y + ph - 40; wrapped((dx, dy) => fakeText(I, R, sx + dx, sy + dy, 70, 1, 11)); }
    }
  }
  // streaks of grime running down the hull, micro scratches
  for (let k = 0; k < 90; k++) { const x = R() * S, y = R() * S, l = 30 + R() * 160; wrapped((dx, dy) => { const gr = A.createLinearGradient(0, y + dy, 0, y + dy + l); gr.addColorStop(0, greyA(70, 0.18)); gr.addColorStop(1, greyA(70, 0)); A.fillStyle = gr; A.fillRect(x + dx, y + dy, 2 + R() * 5, l); }); }
  for (let k = 0; k < 120; k++) { const x = R() * S, y = R() * S, a = R() * Math.PI, l = 6 + R() * 30; wrapped((dx, dy) => { Rg.strokeStyle = greyA(70, 0.5); Rg.lineWidth = 0.8; Rg.beginPath(); Rg.moveTo(x + dx, y + dy); Rg.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); Rg.stroke(); }); }
  noise(A, R, 6); noise(Rg, R, 14); noise(H, R, 2);
  return pack(H, A, Rg, I);
}

function makeRad() {
  // radiator panel: raised fluid channels between thin fins, header tubes, panel joints
  const R = rng(5501);
  const H = layer(), A = layer(), Rg = layer(), I = layer();
  I.fillStyle = grey(0); I.fillRect(0, 0, S, S);
  H.fillStyle = grey(110); H.fillRect(0, 0, S, S);
  Rg.fillStyle = grey(110); Rg.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 32) {
    const g = H.createLinearGradient(x, 0, x + 12, 0);
    g.addColorStop(0, grey(110)); g.addColorStop(0.5, grey(200)); g.addColorStop(1, grey(110));
    H.fillStyle = g; H.fillRect(x, 0, 12, S);
    A.fillStyle = grey(140); A.fillRect(x + 3, 0, 6, S);
    Rg.fillStyle = grey(80); Rg.fillRect(x + 3, 0, 6, S);
  }
  for (const y of [0, S / 2]) { H.fillStyle = grey(210); H.fillRect(0, y, S, 14); H.fillStyle = grey(60); H.fillRect(0, y + 16, S, 3); A.fillStyle = grey(150); A.fillRect(0, y, S, 14); }
  noise(A, R, 6); noise(H, R, 2);
  return pack(H, A, Rg, I);
}

let CACHE = null;
export function detailTextures() {
  if (!CACHE) CACHE = { panel: makePanel(), pad: makePad(), floor: makeFloor(), hull: makeHull(), rad: makeRad() };
  CACHE.mli = CACHE.pad;
  return CACHE;
}
