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

/** chamfered-corner rectangle path (octagonal corners) */
function chamf(g, x, y, w, h, c) {
  g.beginPath();
  g.moveTo(x + c, y); g.lineTo(x + w - c, y); g.lineTo(x + w, y + c); g.lineTo(x + w, y + h - c);
  g.lineTo(x + w - c, y + h); g.lineTo(x + c, y + h); g.lineTo(x, y + h - c); g.lineTo(x, y + c);
  g.closePath();
}

/** raised plate with a stepped chamfer: f(level) fills the shape inset by `level` pixels */
function bevelled(H, levels, from, to, shape) {
  for (let b = 0; b < levels; b++) { H.fillStyle = grey(from + (to - from) * (b + 1) / levels); shape(b); H.fill(); }
}

function hexBolt(H, A, Rg, cx, cy, r) {
  H.fillStyle = grey(96); H.beginPath(); H.arc(cx, cy, r * 1.35, 0, Math.PI * 2); H.fill();     // washer seat
  H.fillStyle = grey(176); H.beginPath(); H.arc(cx, cy, r * 1.2, 0, Math.PI * 2); H.fill();
  H.fillStyle = grey(222); H.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + 0.3; H.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } H.closePath(); H.fill();
  A.fillStyle = grey(150); A.beginPath(); A.arc(cx, cy, r * 1.2, 0, Math.PI * 2); A.fill();
  Rg.fillStyle = grey(70); Rg.beginPath(); Rg.arc(cx, cy, r * 1.2, 0, Math.PI * 2); Rg.fill();
}

function rivet(H, A, cx, cy, r) {
  const gr = H.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
  gr.addColorStop(0, grey(225)); gr.addColorStop(1, grey(150));
  H.fillStyle = gr; H.beginPath(); H.arc(cx, cy, r, 0, Math.PI * 2); H.fill();
  A.fillStyle = grey(146); A.beginPath(); A.arc(cx, cy, r, 0, Math.PI * 2); A.fill();
}

function makePanel() {
  // heavy armoured lining: staggered 0.6 m plates with deep chamfered seams, rivet rows along
  // every edge, bolted reinforcement plates, ribbed plates, access hatches and vents, brushed grain
  const R = rng(1207);
  const H = layer(), A = layer(), Rg = layer(), I = layer();
  I.fillStyle = grey(0); I.fillRect(0, 0, S, S);
  const px = S / DETAIL_TILE.panel;                       // pixels per metre
  const seam = 0.016 * px;                                // groove width
  H.fillStyle = grey(34); H.fillRect(0, 0, S, S);         // deep grooves everywhere between plates
  Rg.fillStyle = grey(196); Rg.fillRect(0, 0, S, S);
  A.fillStyle = grey(66); A.fillRect(0, 0, S, S);         // grime in the seams
  // brickwork of plates: lower rows aligned, upper rows offset half a plate
  const plates = [];
  for (let row = 0; row < 2; row++) for (let col = -1; col < 2; col++) {
    const off = row ? 0.3 : 0;
    plates.push({ x: (col * 0.6 + off) * px, y: row * 0.6 * px, w: 0.6 * px, h: 0.6 * px, kind: (row * 3 + col + 1) % 6 });
  }
  // a horizontal reinforcing strap crossing the tile at mid height (drawn over the plates later)
  const kinds = ['armour', 'ribbed', 'plain', 'hatch', 'vent', 'plain'];
  for (const P of plates) {
    const kind = kinds[P.kind];
    wrapped((dx, dy) => {
      const x = P.x + dx + seam / 2, y = P.y + dy + seam / 2, w = P.w - seam, h = P.h - seam;
      if (x > S || y > S || x + w < 0 || y + h < 0) return;
      // chamfered edge into the groove (6 steps), then the face
      bevelled(H, 7, 70, 150, (b) => chamf(H, x + b, y + b, w - 2 * b, h - 2 * b, 16 - b * 0.8));
      const tint = 128 + (R() - 0.5) * 14;
      A.fillStyle = grey(tint); chamf(A, x + 2, y + 2, w - 4, h - 4, 15); A.fill();
      // worn bright edge on the chamfer
      A.strokeStyle = greyA(168, 0.55); A.lineWidth = 2.2; chamf(A, x + 3, y + 3, w - 6, h - 6, 14); A.stroke();
      Rg.fillStyle = grey(124 + (R() - 0.5) * 18); chamf(Rg, x + 2, y + 2, w - 4, h - 4, 15); Rg.fill();
      // brushed grain on the face
      for (let k = 0; k < 140; k++) {
        const yy = y + 10 + R() * (h - 20);
        A.strokeStyle = greyA(R() > 0.5 ? 150 : 110, 0.12); A.lineWidth = 0.7;
        A.beginPath(); A.moveTo(x + 10 + R() * 30, yy); A.lineTo(x + w - 10 - R() * 30, yy); A.stroke();
      }
      // rivet row inside every edge
      const ri = 15, step = 0.045 * px;
      for (let t = ri + 10; t < w - ri - 6; t += step) for (const yy of [y + ri, y + h - ri]) rivet(H, A, x + t, yy, 3.2);
      for (let t = ri + 10; t < h - ri - 6; t += step) for (const xx of [x + ri, x + w - ri]) rivet(H, A, xx, y + t, 3.2);
      const cx = x + w / 2, cy = y + h / 2;
      if (kind === 'armour') {
        // raised reinforcement plate with big hex bolts
        const pw = w * 0.62, ph = h * 0.5, ax = cx - pw / 2, ay = cy - ph / 2;
        bevelled(H, 6, 150, 196, (b) => chamf(H, ax + b, ay + b, pw - 2 * b, ph - 2 * b, 22 - b));
        A.fillStyle = grey(tint - 10); chamf(A, ax + 3, ay + 3, pw - 6, ph - 6, 20); A.fill();
        A.strokeStyle = greyA(176, 0.6); A.lineWidth = 2; chamf(A, ax + 1, ay + 1, pw - 2, ph - 2, 21); A.stroke();
        for (const [bx, by] of [[ax + 26, ay + 26], [ax + pw - 26, ay + 26], [ax + 26, ay + ph - 26], [ax + pw - 26, ay + ph - 26]]) hexBolt(H, A, Rg, bx, by, 8.5);
        I.fillStyle = grey(255); fakeText(I, R, ax + pw * 0.3, ay + ph * 0.42, pw * 0.4, 1, 10);
        I.fillRect(ax + pw * 0.3, ay + ph * 0.6, pw * 0.16, 4);
      } else if (kind === 'ribbed') {
        // stiffening ribs pressed into the plate
        for (let k = 0; k < 5; k++) {
          const ry = y + h * 0.2 + k * h * 0.15;
          const g1 = H.createLinearGradient(0, ry - 9, 0, ry + 9);
          g1.addColorStop(0, grey(150)); g1.addColorStop(0.35, grey(205)); g1.addColorStop(0.7, grey(170)); g1.addColorStop(1, grey(150));
          H.fillStyle = g1; rr(H, x + 44, ry - 9, w - 88, 18, 9); H.fill();
          A.fillStyle = greyA(150, 0.5); rr(A, x + 44, ry - 9, w - 88, 7, 4); A.fill();
          A.fillStyle = greyA(90, 0.5); rr(A, x + 44, ry + 4, w - 88, 5, 3); A.fill();
        }
      } else if (kind === 'hatch') {
        // recessed access hatch with two flush latches and a stencil
        const hw = w * 0.5, hh = h * 0.6, hx = cx - hw / 2, hy = cy - hh / 2;
        H.fillStyle = grey(60); rr(H, hx - 5, hy - 5, hw + 10, hh + 10, 10); H.fill();
        bevelled(H, 4, 110, 142, (b) => rr(H, hx + b, hy + b, hw - 2 * b, hh - 2 * b, Math.max(2, 8 - b)));
        A.fillStyle = grey(70); rr(A, hx - 5, hy - 5, hw + 10, 5, 3); A.fill();
        for (const ly of [hy + hh * 0.25, hy + hh * 0.75]) {
          H.fillStyle = grey(80); rr(H, hx + hw - 40, ly - 14, 22, 28, 5); H.fill();
          H.fillStyle = grey(180); rr(H, hx + hw - 36, ly - 4, 14, 8, 3); H.fill();
        }
        I.fillStyle = grey(255); fakeText(I, R, hx + 18, hy + 20, hw * 0.55, 2, 9);
        I.lineWidth = 2.5; I.strokeStyle = grey(255); I.strokeRect(hx + 14, hy + 14, hw * 0.6, 40);
      } else if (kind === 'vent') {
        // deep louvre slots in a raised surround
        const vw = w * 0.56, vh = h * 0.42, vx = cx - vw / 2, vy = cy - vh / 2;
        bevelled(H, 4, 150, 178, (b) => rr(H, vx - 14 + b, vy - 14 + b, vw + 28 - 2 * b, vh + 28 - 2 * b, 12));
        for (let k = 0; k < 7; k++) {
          const sy = vy + k * vh / 7;
          H.fillStyle = grey(20); rr(H, vx, sy + 4, vw, vh / 7 - 9, 4); H.fill();
          A.fillStyle = grey(36); rr(A, vx, sy + 4, vw, vh / 7 - 9, 4); A.fill();
          Rg.fillStyle = grey(220); rr(Rg, vx, sy + 4, vw, vh / 7 - 9, 4); Rg.fill();
        }
        for (const [bx, by] of [[vx - 4, vy - 4], [vx + vw + 4, vy - 4], [vx - 4, vy + vh + 4], [vx + vw + 4, vy + vh + 4]]) hexBolt(H, A, Rg, bx, by, 5);
      } else {
        // plain plate: frame number stencil + a short hazard tick in one corner
        I.fillStyle = grey(255);
        // (block stencils, not glyphs: the triplanar projection mirrors some walls)
        if (R() < 0.6) { fakeText(I, R, x + 30, y + h - 60, 120, 1, 22); I.fillRect(x + 30, y + h - 30, 60, 5); }
        if (R() < 0.5) for (let c = 0; c < 4; c++) { I.beginPath(); const bx = x + w - 120 + c * 20; I.moveTo(bx, y + 30); I.lineTo(bx + 9, y + 30); I.lineTo(bx + 20, y + 44); I.lineTo(bx + 11, y + 44); I.closePath(); I.fill(); }
      }
    });
  }
  // grime collecting under the lower edges of plates, scuffs
  for (let k = 0; k < 120; k++) {
    const x = R() * S, y = R() * S, a = (R() - 0.5) * 0.5, l = 10 + R() * 50;
    wrapped((dx, dy) => {
      A.strokeStyle = greyA(R() > 0.6 ? 170 : 88, 0.3); A.lineWidth = 0.8 + R() * 1.6;
      A.beginPath(); A.moveTo(x + dx, y + dy); A.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); A.stroke();
      Rg.strokeStyle = greyA(84, 0.35); Rg.lineWidth = 1;
      Rg.beginPath(); Rg.moveTo(x + dx, y + dy); Rg.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); Rg.stroke();
    });
  }
  noise(A, R, 6); noise(Rg, R, 14); noise(H, R, 3);
  return pack(H, A, Rg, I);
}

function makePad() {
  // padded lining: horizontal channel quilting (rolled tubes between stitched seams), a vertical
  // compression seam every 0.4 m, fine woven leatherette grain
  const R = rng(2209);
  const H = layer(), A = layer(), Rg = layer(), I = layer();
  I.fillStyle = grey(0); I.fillRect(0, 0, S, S);
  Rg.fillStyle = grey(176); Rg.fillRect(0, 0, S, S);
  A.fillStyle = grey(128); A.fillRect(0, 0, S, S);
  const n = 8, c = S / n;
  for (let j = 0; j < n; j++) {
    const y = j * c;
    const gr = H.createLinearGradient(0, y, 0, y + c);
    gr.addColorStop(0, grey(60)); gr.addColorStop(0.18, grey(150)); gr.addColorStop(0.5, grey(205)); gr.addColorStop(0.82, grey(150)); gr.addColorStop(1, grey(60));
    H.fillStyle = gr; H.fillRect(0, y, S, c);
    // the roll catches light along its crown, the seam valleys are darker and duller
    const ga = A.createLinearGradient(0, y, 0, y + c);
    ga.addColorStop(0, grey(86)); ga.addColorStop(0.3, grey(128)); ga.addColorStop(0.5, grey(142)); ga.addColorStop(0.7, grey(124)); ga.addColorStop(1, grey(86));
    A.fillStyle = ga; A.fillRect(0, y, S, c);
    const gro = Rg.createLinearGradient(0, y, 0, y + c);
    gro.addColorStop(0, grey(210)); gro.addColorStop(0.5, grey(150)); gro.addColorStop(1, grey(210));
    Rg.fillStyle = gro; Rg.fillRect(0, y, S, c);
    // stitching along both seams
    for (const yy of [y + 3, y + c - 3]) {
      H.strokeStyle = grey(40); H.lineWidth = 2; H.setLineDash([6, 4]); H.beginPath(); H.moveTo(0, yy); H.lineTo(S, yy); H.stroke();
      A.strokeStyle = greyA(170, 0.6); A.lineWidth = 1.4; A.setLineDash([6, 4]); A.beginPath(); A.moveTo(0, yy); A.lineTo(S, yy); A.stroke();
    }
  }
  H.setLineDash([]); A.setLineDash([]);
  // vertical compression seams (every 0.4 m) pinching the rolls
  for (const x of [0, S / 2]) {
    const gx = H.createLinearGradient(x - 14, 0, x + 14, 0);
    gx.addColorStop(0, greyA(0, 0)); gx.addColorStop(0.5, greyA(40, 0.75)); gx.addColorStop(1, greyA(0, 0));
    wrapped((dx) => { H.fillStyle = gx; H.save(); H.translate(dx, 0); H.fillRect(x - 14, 0, 28, S); H.restore(); });
    for (const g of [H, A]) { g.strokeStyle = g === H ? grey(36) : greyA(160, 0.5); g.lineWidth = 1.6; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(x + 2, 0); g.lineTo(x + 2, S); g.stroke(); g.setLineDash([]); }
  }
  // leatherette grain
  for (let k = 0; k < 9000; k++) { const x = R() * S, y = R() * S; A.fillStyle = greyA(R() > 0.5 ? 150 : 104, 0.25); A.fillRect(x, y, 1.5, 1.5); }
  noise(A, R, 6); noise(H, R, 3); noise(Rg, R, 10);
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
