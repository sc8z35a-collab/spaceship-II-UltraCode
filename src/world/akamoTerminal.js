// AKAMO's bottom terminal inside Shirasagi, in the B-29 frame while docked (spawned with the
// station's lobby, like its ring). A glass lift rises from the floor of the core atrium, beside the
// heron, through a gold sleeve in the dome and up the open lattice tower (the whole station below,
// the Earth beyond it) to the berth drum fifty metres over the core. Up there the platform is a
// ring of polished floor round the open, airless shaft the cabin rests in: tall windows all round,
// the shaft's glass wall in the middle, and at either end of the cabin a short gangway with a pair of
// screen doors that open only while the cabin's own doors stand open against them.
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';
import { AK_SITE } from './akamoSite.js';
import { CABIN } from './akamoCabin.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const L = AK_SITE.lift, BR = AK_SITE.berth;
export const TERM = {
  floor: BR.y, ceil: BR.y + 6.2, R: 12.4,
  shaft: { a: CABIN.A + 0.6, b: CABIN.B + 0.6, pit: BR.y - 1.0 },
  gang: { hw: CABIN.door.w / 2, h: CABIN.door.h },
  car: { r: 1.1, h: 2.5 },
  door: { w: 1.2, h: 2.2, phi: Math.atan2(0.8, -0.6) },   // both landings face the same way
  top: BR.y + 3.0,
  run: { v: 6.0, a: 1.1 },
};
const FONT = '"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif';
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function materials(M) {
  if (M.akFloor) return;
  const env = (M.gold && M.gold.envMap) || null;
  M.akFloor = new THREE.MeshStandardMaterial({ color: 0xdcd8d0, roughness: 0.16, metalness: 0, envMap: env, envMapIntensity: 0.45 });
  M.akDark = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.45, metalness: 0.7, envMap: env, envMapIntensity: 0.5 });
  M.akWall = new THREE.MeshStandardMaterial({ color: 0xeae6de, roughness: 0.55, metalness: 0 });
  M.akLight = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.0, 0.95, 0.86), emissiveIntensity: 2.4 });
  M.akBlue = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.35, 0.72, 1.0), emissiveIntensity: 1.8 });
  M.akTactile = new THREE.MeshStandardMaterial({ color: 0xd8b52a, roughness: 0.6 });
  M.akLeaf = new THREE.MeshStandardMaterial({ color: 0x3f6f3a, roughness: 0.8 });
}

/** a band of an upright round or elliptic wall about (cx, cz); angles from +x toward +z */
export function band(cx, cz, ax, az, ph0, ph1, nP, y0, y1, nY, inward) {
  const pos = [], nrm = [], uv = [];
  const pt = (ph, y) => [cx + ax * Math.cos(ph), y, cz + az * Math.sin(ph)];
  const nm = (ph) => { const x = Math.cos(ph) / ax, z = Math.sin(ph) / az, l = Math.hypot(x, z) * (inward ? -1 : 1); return [x / l, 0, z / l]; };
  for (let i = 0; i < nP; i++) {
    const pa = ph0 + (ph1 - ph0) * i / nP, pb = ph0 + (ph1 - ph0) * (i + 1) / nP;
    const na = nm(pa), nb = nm(pb);
    for (let j = 0; j < nY; j++) {
      const ya = y0 + (y1 - y0) * j / nY, yb = y0 + (y1 - y0) * (j + 1) / nY;
      const A = [pt(pa, ya), na, pa, ya], B = [pt(pb, ya), nb, pb, ya], C = [pt(pb, yb), nb, pb, yb], D = [pt(pa, yb), na, pa, yb];
      for (const [p, n, ph, y] of (inward ? [A, B, C, A, C, D] : [A, D, C, A, C, B])) { pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); uv.push(ph * (ax + az) * 0.25, y * 0.5); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** a shape laid level about (cx, y, cz): facing up (shape y = -z) or down (shape y = +z) */
export function level(shape, cx, y, cz, up, segs = 96) {
  const g = new THREE.ShapeGeometry(shape, segs);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  g.translate(cx, y, cz);
  return g;
}
export const ellipse = (a, b, hole) => { const s = hole ? new THREE.Path() : new THREE.Shape(); s.absellipse(0, 0, a, b, 0, TAU, !!hole); return s; };

// ---- signs and screens (canvas textures, kept sharp by the crisp layer)
function panel(w, h, ppm) {
  const c = document.createElement('canvas');
  c.width = Math.max(64, Math.round(w * ppm)); c.height = Math.max(32, Math.round(h * ppm));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  return { mesh, ctx: c.getContext('2d'), tex, W: c.width, H: c.height };
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function txt(ctx, s, x, y, px, color, align = 'left', weight = 600) { ctx.font = `${weight} ${px}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); }
const where = (i) => (i ? 'AKAMO 乗り場' : 'アトリウム');

function drawCar(p, st) {
  const { ctx, W, H } = p;
  ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, W, H);
  txt(ctx, 'AKAMO', W / 2, H * 0.07, H * 0.055, '#d9b867', 'center', 700);
  const moving = st.phase === 'move';
  txt(ctx, moving ? (st.dest ? '▲' : '▼') : '●', W / 2, H * 0.2, H * 0.11, moving ? '#7fd0ff' : '#e9eef5', 'center', 700);
  txt(ctx, moving ? where(st.dest) + ' へ' : where(st.at), W / 2, H * 0.33, H * 0.06, '#e9eef5', 'center', 700);
  txt(ctx, `${Math.max(0, st.y - L.y0).toFixed(1)} m`, W / 2, H * 0.42, H * 0.05, '#9fb3c8', 'center', 500);
  for (const i of [1, 0]) {
    const y = i ? H * 0.52 : H * 0.75, on = (moving ? st.dest : st.at) === i;
    rr(ctx, W * 0.07, y, W * 0.86, H * 0.18, 12); ctx.fillStyle = on ? '#1d4f7a' : '#16202e'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = on ? '#7fd0ff' : '#3a4a5e'; ctx.stroke();
    txt(ctx, (i ? '▲ ' : '▼ ') + where(i), W / 2, y + H * 0.09, H * 0.055, on ? '#ffffff' : '#c4cfdb', 'center', 700);
  }
  // (someone came up in it and stays aboard: it waits for a tap)
  if (st.phase === 'open' && st.inCar && !st.armed && Math.floor(Date.now() / 500) % 2 === 0) {
    rr(ctx, W * 0.07, H * 0.935, W * 0.86, H * 0.055, 8); ctx.fillStyle = '#d9b867'; ctx.fill();
    txt(ctx, 'タップで出発', W / 2, H * 0.962, H * 0.04, '#0b1220', 'center', 800);
  }
  p.tex.needsUpdate = true;
}
function drawInd(p, i, st) {
  const { ctx, W, H } = p;
  ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, W, H);
  const moving = st.phase === 'move', here = !moving && st.at === i;
  const arrow = moving ? (st.v > 0 ? '▲' : '▼') : here ? '●' : st.at > i ? '▲' : '▼';
  txt(ctx, arrow, H * 0.5, H / 2, H * 0.45, moving ? '#7fd0ff' : here ? '#8dffb0' : '#5d6b7c', 'center', 700);
  const s = here ? '到着しています' : moving ? (st.dest === i ? 'まもなく到着' : '移動中') : st.calls[i] ? '呼び出し中' : where(st.at) + 'にあります';
  txt(ctx, s, H * 1.0, H * 0.36, H * 0.25, '#e9eef5', 'left', 700);
  txt(ctx, `${Math.max(0, st.y - L.y0).toFixed(0)} m`, H * 1.0, H * 0.74, H * 0.2, '#9fb3c8', 'left', 500);
  p.tex.needsUpdate = true;
}
function drawBoard(p, info) {
  const { ctx, W, H } = p;
  ctx.fillStyle = '#05080e'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0d1828'; ctx.fillRect(0, 0, W, H * 0.23);
  txt(ctx, 'AKAMO', W * 0.027, H * 0.115, H * 0.12, '#d9b867', 'left', 800);
  txt(ctx, '頂上ステーション行き', W * 0.2, H * 0.115, H * 0.1, '#e9eef5', 'left', 700);
  txt(ctx, '2,500 km', W * 0.973, H * 0.115, H * 0.09, '#9fb3c8', 'right', 600);
  const s = info || { text: '運転を見合わせています', sub: '', tone: 'off' };
  const col = s.tone === 'go' ? '#8dffb0' : s.tone === 'run' ? '#7fd0ff' : s.tone === 'wait' ? '#ffd27a' : '#c4cfdb';
  txt(ctx, s.text, W * 0.027, H * 0.45, H * 0.17, col, 'left', 800);
  if (s.sub) txt(ctx, s.sub, W * 0.027, H * 0.7, H * 0.125, '#e9eef5', 'left', 600);
  txt(ctx, '最高速度 80 km/s ・ 所要 約2分20秒', W * 0.973, H * 0.9, H * 0.075, '#7e8fa3', 'right', 500);
  p.tex.needsUpdate = true;
}
function drawGate(p, g) {
  const { ctx, W, H } = p;
  ctx.fillStyle = '#0d1828'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#d9b867'; ctx.fillRect(0, H - 6, W, 6);
  txt(ctx, '乗車口 ' + g, W * 0.05, H / 2, H * 0.5, '#ffffff', 'left', 800);
  txt(ctx, 'GATE ' + g, W * 0.95, H / 2, H * 0.32, '#9fb3c8', 'right', 600);
  p.tex.needsUpdate = true;
}
function drawWall(p) {
  const { ctx, W, H } = p;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(12,20,32,0.92)'; rr(ctx, 0, 0, W, H, H * 0.12); ctx.fill();
  txt(ctx, 'AKAMO', W * 0.04, H * 0.5, H * 0.62, '#d9b867', 'left', 800);
  txt(ctx, '宇宙エレベーター', W * 0.96, H * 0.33, H * 0.2, '#e9eef5', 'right', 700);
  txt(ctx, 'シラサギ駅 ・ 0 km', W * 0.96, H * 0.68, H * 0.17, '#9fb3c8', 'right', 600);
  p.tex.needsUpdate = true;
}
function drawAtrium(p) {
  const { ctx, W, H } = p;
  ctx.fillStyle = '#0d1828'; rr(ctx, 0, 0, W, H, H * 0.15); ctx.fill();
  txt(ctx, '▲ AKAMO', W * 0.05, H * 0.5, H * 0.42, '#d9b867', 'left', 800);
  txt(ctx, '宇宙エレベーター乗り場', W * 0.95, H * 0.38, H * 0.22, '#ffffff', 'right', 700);
  txt(ctx, 'SPACE ELEVATOR', W * 0.95, H * 0.72, H * 0.16, '#9fb3c8', 'right', 600);
  p.tex.needsUpdate = true;
}
function drawCall(p, up) {
  const { ctx, W, H } = p;
  ctx.fillStyle = '#1a1f27'; rr(ctx, 0, 0, W, H, W * 0.2); ctx.fill();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, W * 0.34, 0, TAU); ctx.fillStyle = '#0b1220'; ctx.fill();
  ctx.lineWidth = W * 0.05; ctx.strokeStyle = '#7fd0ff'; ctx.stroke();
  txt(ctx, up ? '▲' : '▼', W / 2, H / 2 + 1, W * 0.36, '#e9eef5', 'center', 700);
  p.tex.needsUpdate = true;
}

/**
 * The terminal (ship-local). lamp(x, y, z, colour, intensity, range) is the lobby's lamp helper.
 * Returns { group, colliders, contains(p), showsShell(p), breachSpots, attach(g), detach(g),
 * update(dt, g), liftDelta(p) }
 */
export function buildTerminal(M, lamp) {
  materials(M);
  const T = TERM, S = T.shaft, G = T.gang, C = T.car, D = T.door;
  const cx = BR.x, cz = BR.z, lx = L.x, lz = L.z;
  const b = new Builder();
  const O = [0, 0, 0];
  const at = (r, a, y, ox = lx, oz = lz) => [ox + r * Math.cos(a), y, oz + r * Math.sin(a)];
  const out = (a) => [0, Math.PI / 2 - a, 0];         // a box's or a plane's +z pointing out along a
  const HT = D.w / 2 / L.r, HC = D.w / 2 / C.r;       // half the doorway's angle on the tube, the car
  const thD = Math.PI / 2 - D.phi;                    // the doorway's angle as three's cylinders count it
  const yA = L.y0, yB = T.floor, dh = D.h;
  const texts = [];
  const dyn = new THREE.Group();
  dyn.name = 'akamoTerminalMoving';

  // =================================================================== the lift's glass tube
  for (const [y0, y1, door] of [[yA, yA + dh, true], [yA + dh, yB, false], [yB, yB + dh, true], [yB + dh, T.top, false]]) {
    const a0 = door ? D.phi + HT : 0, a1 = door ? D.phi + TAU - HT : TAU;
    b.add(band(lx, lz, L.r, L.r, a0, a1, door ? 40 : 48, y0, y1, Math.max(1, Math.round((y1 - y0) / 4)), false), 'glass', O, O);
    // its wall for the player: boxes round it (the doorways left open at the landings)
    const nb = door ? 20 : 24, da = (a1 - a0) / nb, w = 2 * (L.r + 0.06) * Math.sin(da / 2) + 0.05;
    for (let i = 0; i < nb; i++) { const a = a0 + da * (i + 0.5); b.colBox(w, y1 - y0, 0.12, at(L.r + 0.06, a, (y0 + y1) / 2), out(a)); }
  }
  // its cap over the platform, a light in it
  b.cyl(L.r + 0.12, L.r + 0.12, 0.16, 'steel', [lx, T.top + 0.08, lz], O, 40);
  b.add(new THREE.CircleGeometry(L.r - 0.12, 40), 'akLight', [lx, T.top - 0.006, lz], [Math.PI / 2, 0, 0]);
  b.colBox(2 * L.r + 0.3, 0.14, 2 * L.r + 0.3, [lx, T.top + 0.08, lz], O);
  // gold rings round it, light pipes up its back
  for (let y = yA + dh + 1.6; y < T.top - 0.2; y += 4.2) {
    if (y > yB - 0.3 && y < yB + dh + 0.2) continue;
    b.torus(L.r + 0.035, 0.03, 'gold', [lx, y, lz], [Math.PI / 2, 0, 0], 48);
  }
  for (const k of [-1.5, -0.5, 0.5, 1.5]) b.cyl(0.022, 0.022, T.top - yA - 0.3, 'akBlue', at(L.r + 0.05, D.phi + Math.PI + k * 0.55, (yA + T.top) / 2), O, 6);
  // the doorways: gold posts and lintels, a steel threshold
  for (const y of [yA, yB]) {
    for (const s of [-1, 1]) b.box(0.08, dh + 0.1, 0.08, 'gold', at(L.r + 0.09, D.phi + s * (HT + 0.03), y + (dh + 0.1) / 2), out(D.phi), 0.01);
    for (const [yy, key, r] of [[y + dh + 0.08, 'gold', 0.04], [y + 0.02, 'steel', 0.03]]) {
      const g = new THREE.TorusGeometry(L.r + 0.09, r, 6, 24, 2 * HT + 0.06); g.rotateX(Math.PI / 2);
      b.add(g, key, [lx, yy, lz], [0, -(D.phi - HT - 0.03), 0]);
    }
  }
  // a gold ring on the atrium's floor round its foot; sleeves where it goes through the dome and
  // through the berth's floor
  b.torus(L.r + 0.4, 0.045, 'gold', [lx, yA + 0.025, lz], [Math.PI / 2, 0, 0], 64);
  b.add(band(lx, lz, 1.9, 1.9, 0, TAU, 48, 6.85, 10.25, 1, false), 'gold', O, O);
  b.add(band(lx, lz, 1.86, 1.86, 0, TAU, 48, 6.85, 10.25, 1, true), 'gold', O, O);
  { const r = new THREE.RingGeometry(L.r + 0.02, 1.9, 48); r.rotateX(Math.PI / 2); r.translate(lx, 6.85, lz); b.add(r, 'gold', O, O); }
  b.cyl(L.r + 0.22, L.r + 0.22, 1.1, 'steel', [lx, T.floor - 0.55, lz], O, 48, true);

  // =================================================================== the car
  const car = new THREE.Group();
  car.name = 'akamoLiftCar';
  const put = (geo, mat, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; car.add(m); return m; };
  put(new THREE.CylinderGeometry(C.r + 0.14, C.r + 0.14, 0.12, 48), M.akDark, -0.06);
  put(new THREE.CylinderGeometry(C.r - 0.03, C.r - 0.03, 0.01, 48), M.akFloor, 0.005);
  { const g = new THREE.RingGeometry(C.r - 0.12, C.r - 0.05, 48); g.rotateX(-Math.PI / 2); put(g, M.akLight, 0.012); }
  put(new THREE.CylinderGeometry(C.r, C.r, C.h, 48, 1, true, thD + HC, TAU - 2 * HC), M.glass, C.h / 2);
  for (const y of [0.04, C.h - 0.04]) { const g = new THREE.TorusGeometry(C.r + 0.01, 0.028, 6, 48); g.rotateX(Math.PI / 2); put(g, M.gold, y); }
  put(new THREE.CylinderGeometry(C.r + 0.14, C.r + 0.14, 0.14, 48), M.akDark, C.h + 0.07);
  { const g = new THREE.CircleGeometry(C.r - 0.3, 40); g.rotateX(Math.PI / 2); put(g, M.akLight, C.h - 0.004); }
  { const ra = HC + 0.2, g = new THREE.TorusGeometry(C.r - 0.09, 0.022, 6, 40, TAU - 2 * ra); g.rotateX(Math.PI / 2); put(g, M.brass, 0.95).rotation.y = -(D.phi + ra); }
  // its doors: two curved glass leaves that slide round it, a gold edge where they meet
  const leafG = new THREE.CylinderGeometry(C.r + 0.03, C.r + 0.03, C.h - 0.1, 10, 1, true, 0, HC);
  const carLeaves = [put(leafG, M.glass, C.h / 2), put(leafG, M.glass, C.h / 2)];
  const edgeG = new THREE.BoxGeometry(0.025, C.h - 0.1, 0.025);
  { const m = new THREE.Mesh(edgeG, M.gold); m.position.set((C.r + 0.03) * Math.sin(HC), 0, (C.r + 0.03) * Math.cos(HC)); carLeaves[0].add(m); }
  { const m = new THREE.Mesh(edgeG, M.gold); m.position.set(0, 0, C.r + 0.03); carLeaves[1].add(m); }
  // its panel (opposite the doors): where it is, where it goes; a tap sends it
  const cp = panel(0.34, 0.5, 700);
  { const ap = D.phi + Math.PI, r = C.r - 0.035; cp.mesh.position.set(r * Math.cos(ap), 1.28, r * Math.sin(ap)); cp.mesh.rotation.y = -Math.PI / 2 - ap; car.add(cp.mesh); texts.push(cp.mesh); }
  car.position.set(lx, yA, lz);
  dyn.add(car);
  // the landings' doors (outside the tube), their indicators and call buttons
  const landG = new THREE.CylinderGeometry(L.r + 0.075, L.r + 0.075, dh - 0.05, 10, 1, true, 0, HT);
  const land = [], ind = [], calls = [];
  for (const [i, y] of [[0, yA], [1, yB]]) {
    const pair = [new THREE.Mesh(landG, M.glass), new THREE.Mesh(landG, M.glass)];
    for (const m of pair) { m.position.set(lx, y + dh / 2, lz); dyn.add(m); }
    land.push(pair);
    const p = panel(0.66, 0.2, 600);
    p.mesh.position.set(...at(L.r + 0.16, D.phi, y + dh + 0.34)); p.mesh.rotation.y = Math.PI / 2 - D.phi;
    dyn.add(p.mesh); texts.push(p.mesh); ind.push(p);
    const a = D.phi + HT + 0.32, c = panel(0.16, 0.3, 600);
    c.mesh.position.set(...at(L.r + 0.08, a, y + 1.15)); c.mesh.rotation.y = Math.PI / 2 - a;
    dyn.add(c.mesh); texts.push(c.mesh); calls.push(c);
    drawCall(c, i === 0);
  }
  { const sg = panel(1.5, 0.36, 500); sg.mesh.position.set(...at(L.r + 0.2, D.phi, yA + dh + 0.66)); sg.mesh.rotation.y = Math.PI / 2 - D.phi; dyn.add(sg.mesh); texts.push(sg.mesh); drawAtrium(sg); }

  // =================================================================== the platform
  // floor (round the shaft, the lift's tube through it), its warning strip, a gold ring inlaid
  {
    const s = new THREE.Shape(); s.absarc(0, 0, T.R, 0, TAU, false);
    s.holes.push(ellipse(S.a, S.b, true));
    const h = new THREE.Path(); h.absarc(lx - cx, -(lz - cz), L.r + 0.03, 0, TAU, true); s.holes.push(h);
    const g = level(s, cx, T.floor, cz, true);
    const gc = g.clone();
    b.add(g, 'akFloor', O, O);
    b.colMesh(gc);
    const st2 = ellipse(S.a + 0.42, S.b + 0.42); st2.holes.push(ellipse(S.a + 0.12, S.b + 0.12, true));
    b.add(level(st2, cx, T.floor + 0.004, cz, true), 'akTactile', O, O);
    const ring = new THREE.RingGeometry(9.96, 10.02, 160); ring.rotateX(-Math.PI / 2); ring.translate(cx, T.floor + 0.003, cz);
    b.add(ring, 'gold', O, O);
  }
  // ceiling, cove lights round the shaft and round the wall's head
  {
    const s = new THREE.Shape(); s.absarc(0, 0, T.R, 0, TAU, false); s.holes.push(ellipse(S.a, S.b, true));
    b.add(level(s, cx, T.ceil, cz, false), 'akWall', O, O);
    const s2 = ellipse(S.a + 0.5, S.b + 0.5); s2.holes.push(ellipse(S.a + 0.3, S.b + 0.3, true));
    b.add(level(s2, cx, T.ceil - 0.01, cz, false), 'akLight', O, O);
    const r3 = new THREE.RingGeometry(T.R - 0.42, T.R - 0.22, 160); r3.rotateX(Math.PI / 2); r3.translate(cx, T.ceil - 0.01, cz);
    b.add(r3, 'akLight', O, O);
  }
  // the outer wall: 24 tall windows (deep reveals, gold frames) looking out over the station
  const NB = 24, bay = TAU / NB, WA = 0.9 / T.R, w0 = T.floor + 0.55, w1 = T.floor + 4.55;
  for (let k = 0; k < NB; k++) {
    const c = (k + 0.5) * bay;
    b.add(band(cx, cz, T.R, T.R, c - bay / 2, c - WA, 3, T.floor, T.ceil, 1, true), 'akWall', O, O);
    b.add(band(cx, cz, T.R, T.R, c + WA, c + bay / 2, 3, T.floor, T.ceil, 1, true), 'akWall', O, O);
    b.add(band(cx, cz, T.R, T.R, c - WA, c + WA, 4, T.floor, w0, 1, true), 'akWall', O, O);
    b.add(band(cx, cz, T.R, T.R, c - WA, c + WA, 4, w1, T.ceil, 1, true), 'akWall', O, O);
    b.add(band(cx, cz, T.R + 0.26, T.R + 0.26, c - WA, c + WA, 4, w0, w1, 1, true), 'glass', O, O);
    const chord = 2 * T.R * Math.sin(WA);
    for (const s of [-1, 1]) b.box(0.03, w1 - w0, 0.28, 'akWall', at(T.R + 0.13, c + s * WA, (w0 + w1) / 2, cx, cz), out(c + s * WA), 0);
    for (const y of [w0, w1]) b.box(chord, 0.03, 0.28, 'akWall', at(T.R + 0.13, c, y, cx, cz), out(c), 0);
    for (const s of [-1, 1]) b.box(0.035, w1 - w0 + 0.07, 0.03, 'gold', at(T.R - 0.01, c + s * (WA + 0.002), (w0 + w1) / 2, cx, cz), out(c), 0);
    for (const y of [w0 - 0.02, w1 + 0.02]) b.box(chord + 0.07, 0.035, 0.03, 'gold', at(T.R - 0.01, c, y, cx, cz), out(c), 0);
  }
  { const g = new THREE.CylinderGeometry(T.R, T.R, T.ceil - T.floor, 64, 1, true); g.translate(cx, (T.floor + T.ceil) / 2, cz); b.colMesh(g); }
  // the shaft's glass wall (steel kick plate, dark head band, mullions), open at the two gangways
  const gph = Math.asin(Math.min(1, (G.hw + 0.02) / S.b));
  for (const [a0, a1] of [[gph, Math.PI - gph], [Math.PI + gph, TAU - gph]]) {
    b.add(band(cx, cz, S.a, S.b, a0, a1, 48, T.floor + 0.16, T.ceil - 0.32, 1, false), 'glass', O, O);
    b.add(band(cx, cz, S.a + 0.01, S.b + 0.01, a0, a1, 48, T.floor, T.floor + 0.16, 1, false), 'steel', O, O);
    const n = 22, da = (a1 - a0) / n;
    for (let i = 0; i < n; i++) {
      const pa = a0 + da * i, pb = pa + da;
      const xa = cx + S.a * Math.cos(pa), za = cz + S.b * Math.sin(pa), xb = cx + S.a * Math.cos(pb), zb = cz + S.b * Math.sin(pb);
      b.colBox(Math.hypot(xb - xa, zb - za) + 0.04, T.ceil - T.floor, 0.1, [(xa + xb) / 2, (T.floor + T.ceil) / 2, (za + zb) / 2], [0, -Math.atan2(zb - za, xb - xa), 0]);
    }
  }
  b.add(band(cx, cz, S.a + 0.01, S.b + 0.01, 0, TAU, 96, T.ceil - 0.32, T.ceil, 1, false), 'akDark', O, O);
  for (const g0 of [-gph, Math.PI - gph]) {
    b.add(band(cx, cz, S.a, S.b, g0, g0 + 2 * gph, 4, T.floor + G.h + 0.16, T.ceil - 0.32, 1, false), 'glass', O, O);
    b.add(band(cx, cz, S.a + 0.01, S.b + 0.01, g0, g0 + 2 * gph, 4, T.floor + G.h, T.floor + G.h + 0.16, 1, false), 'steel', O, O);
  }
  for (let i = 0; i < 28; i++) {
    const a = (i + 0.5) / 28 * TAU;
    if (Math.abs(Math.sin(a)) * S.b < G.hw + 0.15) continue;
    b.box(0.05, T.ceil - T.floor, 0.05, 'steel', [cx + S.a * Math.cos(a), (T.floor + T.ceil) / 2, cz + S.b * Math.sin(a)], O, 0);
  }
  // the gangways: a steel floor plate over the gap, walls, a lit ceiling, the rubber seal that
  // meets the cabin's door frame; the gate's sign and the departure board over each
  const boards = [];
  for (const s of [-1, 1]) {
    const x0 = cx + s * (CABIN.A - 0.02), x1 = cx + s * (S.a + 0.1), xm = (x0 + x1) / 2, len = Math.abs(x1 - x0);
    b.box(len + 0.06, 0.06, 2 * G.hw + 0.1, 'steel', [xm, T.floor - 0.03, cz], O, 0.005, 2, true);
    for (const t of [-1, 1]) b.box(len, G.h, 0.08, 'akDark', [xm, T.floor + G.h / 2, cz + t * (G.hw + 0.04)], O, 0.01, 2, true);
    b.box(len, 0.08, 2 * G.hw + 0.16, 'akDark', [xm, T.floor + G.h + 0.04, cz], O, 0.01, 2, true);
    for (const t of [-1, 1]) b.box(0.06, G.h, 0.06, 'black', [x0, T.floor + G.h / 2, cz + t * (G.hw + 0.02)], O, 0.01);
    b.box(0.06, 0.06, 2 * G.hw + 0.1, 'black', [x0, T.floor + G.h + 0.01, cz], O, 0.01);
    b.box(len * 0.7, 0.012, 0.3, 'akLight', [xm, T.floor + G.h - 0.005, cz], O, 0);
    const x = cx + s * (S.a + 0.08), ry = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    const gs = panel(1.5, 0.3, 500); gs.mesh.position.set(x, T.floor + G.h + 0.38, cz); gs.mesh.rotation.y = ry; dyn.add(gs.mesh); texts.push(gs.mesh); drawGate(gs, s > 0 ? 'A' : 'B');
    const bd = panel(2.6, 0.84, 400); bd.mesh.position.set(x, T.floor + G.h + 1.25, cz); bd.mesh.rotation.y = ry; dyn.add(bd.mesh); texts.push(bd.mesh); boards.push(bd);
    b.box(0.06, 0.96, 2.72, 'akDark', [x - s * 0.045, T.floor + G.h + 1.25, cz], O, 0.01);
  }
  // the screen doors: two glass leaves (steel framed) at each gangway's mouth
  const sd = [];
  for (const s of [-1, 1]) {
    const x = cx + s * (S.a + 0.05);
    for (const t of [-1, 1]) {
      const q = new THREE.Group();
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(G.hw - 0.04, G.h - 0.08), M.glass); gl.rotation.y = Math.PI / 2; q.add(gl);
      const fr = (w, h, d, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.steel); m.position.set(0, y, z); q.add(m); };
      fr(0.04, 0.05, G.hw, (G.h - 0.06) / 2, 0); fr(0.04, 0.05, G.hw, -(G.h - 0.06) / 2, 0);
      fr(0.04, G.h - 0.02, 0.04, 0, -(G.hw - 0.02) / 2); fr(0.04, G.h - 0.02, 0.04, 0, (G.hw - 0.02) / 2);
      q.position.set(x, T.floor + G.h / 2, cz + t * G.hw / 2);
      dyn.add(q); sd.push({ q, t });
    }
  }
  // the pit under the cabin (open to space): dark, blue work lights, the anchor where the ribbon's
  // foot is clamped into the berth's frame
  {
    b.add(level(ellipse(S.a, S.b), cx, S.pit, cz, true), 'akDark', O, O);
    b.add(band(cx, cz, S.a, S.b, 0, TAU, 96, S.pit, T.floor, 1, true), 'akDark', O, O);
    for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU; b.box(0.5, 0.05, 0.02, 'akBlue', [cx + (S.a - 0.02) * Math.cos(a), S.pit + 0.55, cz + (S.b - 0.02) * Math.sin(a)], out(a), 0); }
    b.box(1.5, 0.3, 0.9, 'steel', [cx, S.pit + 0.15, cz], O, 0.03);
    for (const t of [-1, 1]) b.box(0.9, 0.22, 0.24, 'akDark', [cx, S.pit + 0.41, cz + t * 0.17], O, 0.02);
    for (const sx of [-0.55, 0.55]) for (const sz of [-0.32, 0.32]) b.cyl(0.05, 0.05, 0.08, 'gold', [cx + sx, S.pit + 0.33, cz + sz], O, 10);
  }
  // benches between the windows, planters flanking the gates
  const phL = Math.atan2(lz - cz, lx - cx);
  for (let k = 0; k < NB; k += 3) {
    const a = k * bay;
    if (Math.abs(angDiff(a, phL)) < 0.45 || Math.abs(Math.sin(a)) < 0.3) continue;
    const tx = -Math.sin(a), tz = Math.cos(a), p = at(T.R - 0.6, a, 0, cx, cz), q = at(T.R - 0.36, a, 0, cx, cz);
    b.box(1.7, 0.07, 0.48, 'wood', [p[0], T.floor + 0.44, p[2]], out(a), 0.02);
    b.box(1.7, 0.46, 0.06, 'wood', [q[0], T.floor + 0.78, q[2]], out(a), 0.02);
    for (const s of [-0.7, 0.7]) b.box(0.06, 0.42, 0.44, 'steel', [p[0] + tx * s, T.floor + 0.21, p[2] + tz * s], out(a), 0.01);
    b.colBox(1.7, 0.5, 0.5, [p[0], T.floor + 0.25, p[2]], out(a));
  }
  for (const a of [0.55, -0.55, Math.PI + 0.55, Math.PI - 0.55]) {
    const p = at(11.0, a, 0, cx, cz);
    b.cyl(0.5, 0.42, 0.7, 'akDark', [p[0], T.floor + 0.35, p[2]], O, 24);
    b.sphere(0.62, 'akLeaf', [p[0], T.floor + 1.05, p[2]], 16, [1, 0.8, 1]);
    b.colCyl(0.5, 0.72, [p[0], T.floor + 0.36, p[2]]);
  }
  // the name on the wall over the windows, facing the lift
  { const ws = panel(4.2, 0.9, 260); ws.mesh.position.set(...at(T.R - 0.2, phL, T.floor + 5.3, cx, cz)); ws.mesh.rotation.y = -Math.PI / 2 - phL; dyn.add(ws.mesh); texts.push(ws.mesh); drawWall(ws); }
  // lights
  for (let k = 0; k < 8; k++) { const p = at(10.0, (k + 0.5) / 8 * TAU, T.ceil - 0.5, cx, cz); lamp(p[0], p[1], p[2], 0xfff0dc, 3.2, 11); }
  lamp(cx, S.pit + 0.8, cz, 0x9cc8ff, 1.2, 6);

  const group = b.build(M, { castShadow: false, receiveShadow: false });
  group.name = 'akamoTerminal';
  group.add(dyn);
  const breachSpots = [];
  for (let k = 0; k < 6; k++) { const a = (k + 0.25) / 6 * TAU; breachSpots.push({ p: V(cx + Math.cos(a) * (T.R - 0.05), T.floor + 2.5, cz + Math.sin(a) * (T.R - 0.05)), n: V(-Math.cos(a), 0, -Math.sin(a)) }); }

  /** the terminal's air: the lift's tube, the platform round the shaft, the gangways */
  const contains = (p) => {
    if (Math.hypot(p.x - lx, p.z - lz) < L.r - 0.02 && p.y > yA - 0.4 && p.y < T.top) return true;
    if (p.y < T.floor - 0.4 || p.y > T.ceil) return false;
    const x = p.x - cx, z = p.z - cz;
    if (x * x + z * z > (T.R - 0.02) * (T.R - 0.02)) return false;
    if ((x / S.a) ** 2 + (z / S.b) ** 2 > 1) return true;
    return Math.abs(z) < G.hw + 0.05 && Math.abs(x) > CABIN.A - 0.05 && p.y < T.floor + G.h + 0.1;
  };

  // =================================================================== the lift's run
  const st = { y: yA, v: 0, dy: 0, at: 0, dest: 0, phase: 'idle', k: 0, timer: 0, ride: 0, armed: false, go: false, inCar: false, calls: [false, false], sd: 0, cols: null, landCols: null, sdCols: null, taps: [], interact: null, crisp: false, drawT: 0 };
  const ys = (i) => (i ? yB : yA);
  const inCar = (p) => !!p && Math.hypot(p.x - lx, p.z - lz) < L.r - 0.05 && p.y > st.y - 0.5 && p.y < st.y + 2.6;
  const doorPt = (r) => at(r, D.phi, 0);
  const near = (p, i, rad) => { if (!p) return false; const q = doorPt(L.r + 0.85), y = ys(i); return Math.hypot(p.x - q[0], p.z - q[2]) < rad && p.y > y - 0.6 && p.y < y + 2.4; };
  const inDoor = (p, i) => { if (!p) return false; const q = doorPt(L.r), y = ys(i); return Math.hypot(p.x - q[0], p.z - q[2]) < 0.7 && p.y > y - 0.6 && p.y < y + 2.4; };
  const landK = (i) => (st.at === i && st.phase !== 'move' ? st.k : 0);

  function step(dt, who) {
    const here = inCar(who);
    st.inCar = here;
    st.dy = 0;
    switch (st.phase) {
      case 'idle':          // at a landing, doors shut: open for whoever comes, go to a call
        if (here || near(who, st.at, 1.9) || st.calls[st.at]) { st.calls[st.at] = false; st.phase = 'opening'; }
        else if (st.calls[1 - st.at] || near(who, 1 - st.at, 1.9)) { st.calls[1 - st.at] = false; st.dest = 1 - st.at; st.phase = 'move'; }
        break;
      case 'opening':
        st.k = Math.min(1, st.k + dt / 1.4);
        if (st.k >= 1) { st.phase = 'open'; st.timer = 0; st.ride = 0; st.armed = !here; }
        break;
      case 'open':          // goes three seconds after someone steps in (or at a tap on its panel)
        st.timer += dt;
        if (!here) st.armed = true;
        st.ride = here && st.armed ? st.ride + dt : 0;
        if (st.go || st.ride > 3.0) { st.go = false; st.dest = 1 - st.at; st.phase = 'closing'; }
        else if (!here && !near(who, st.at, 2.4) && st.timer > 5) { st.dest = st.at; st.phase = 'closing'; }
        break;
      case 'closing':       // never on someone in the doorway
        if (inDoor(who, st.at)) { st.phase = 'opening'; break; }
        st.k = Math.max(0, st.k - dt / 1.4);
        if (st.k <= 0) st.phase = st.dest !== st.at ? 'move' : 'idle';
        break;
      case 'move': {        // a smooth start, 6 m/s, a gentle stop at the floor
        const rem = ys(st.dest) - st.y, s = Math.sign(rem) || 1;
        const vWant = s * Math.min(T.run.v, Math.sqrt(2 * T.run.a * Math.abs(rem)) * 0.96 + 0.04);
        st.v += THREE.MathUtils.clamp((vWant - st.v) * Math.min(1, dt * 2.5), -T.run.a * dt, T.run.a * dt);
        let d = st.v * dt;
        if (Math.abs(rem) <= Math.abs(d) || Math.abs(rem) < 0.002) { d = rem; st.v = 0; st.at = st.dest; st.phase = 'opening'; }
        st.y += d; st.dy = d;
        break;
      }
    }
  }
  function applyCols() {
    if (!st.cols) return;
    st.cols[0].setTranslation({ x: lx, y: st.y - 0.06, z: lz });
    st.cols[1].setTranslation({ x: lx, y: st.y + C.h + 0.1, z: lz });
    for (let i = 0; i < 2; i++) st.landCols[i].setEnabled(landK(i) < 0.6);
    for (const c of st.sdCols) c.setEnabled(st.sd < 0.7);
  }
  function visuals() {
    car.position.y = st.y;
    const kc = st.phase === 'move' ? 0 : st.k;
    carLeaves[0].rotation.y = thD - HC - HC * 0.94 * kc;
    carLeaves[1].rotation.y = thD + HC * 0.94 * kc;
    for (let i = 0; i < 2; i++) { const k = landK(i); land[i][0].rotation.y = thD - HT - HT * 0.94 * k; land[i][1].rotation.y = thD + HT * 0.94 * k; }
    for (const { q, t } of sd) q.position.z = cz + t * (G.hw / 2 + (G.hw + 0.02) * st.sd);
  }

  function attach(g) {
    if (st.cols) return;
    const ph = g.phys, tr = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
    st.cols = ph.addColliders([
      { type: 'cyl', hh: 0.06, r: L.r - 0.03, m: tr(lx, st.y - 0.06, lz) },
      { type: 'cyl', hh: 0.06, r: L.r - 0.03, m: tr(lx, st.y + C.h + 0.1, lz) },
    ]);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...out(D.phi)));
    st.landCols = ph.addColliders([yA, yB].map((y) => ({ type: 'box', hx: D.w / 2 + 0.12, hy: dh / 2, hz: 0.07, m: new THREE.Matrix4().compose(V(...at(L.r + 0.07, D.phi, y + dh / 2)), q, V(1, 1, 1)) })));
    st.sdCols = ph.addColliders([-1, 1].map((s) => ({ type: 'box', hx: 0.06, hy: G.h / 2, hz: G.hw + 0.03, m: tr(cx + s * (S.a + 0.05), T.floor + G.h / 2, cz) })));
    applyCols();
  }
  function detach(g) {
    for (const c of [...(st.cols || []), ...(st.landCols || []), ...(st.sdCols || [])]) g.phys.world.removeCollider(c, true);
    st.cols = st.landCols = st.sdCols = null;
    if (st.interact) for (const t of st.taps) st.interact.remove(t);
    st.taps = [];
  }
  /** before the player's step: the car moves (and its floor), the carry is set */
  function preStep(dt, g) {
    const pl = g.player, who = pl && pl.state !== 'dead' ? pl.pos : null;
    step(dt, who);
    _d.set(0, st.dy, 0);
    applyCols();
    st.stepped = true;
  }
  function update(dt, g) {
    if (!st.crisp && g.engine && g.engine.crisp) { for (const m of texts) g.engine.crisp.add(m); st.crisp = true; }
    if (!st.taps.length && g.interact) {
      st.interact = g.interact;
      st.taps.push(g.interact.addMesh(cp.mesh, () => { if (st.phase === 'open') st.go = true; else if (st.phase === 'idle' && st.inCar) { st.dest = 1 - st.at; st.phase = 'move'; } }, { maxDist: 2.0 }));
      for (let i = 0; i < 2; i++) st.taps.push(g.interact.addMesh(calls[i].mesh, () => { st.calls[i] = true; }, { maxDist: 2.6 }));
    }
    const pl = g.player, who = pl && pl.state !== 'dead' ? pl.pos : null;
    if (!st.stepped) { step(dt, who); _d.set(0, st.dy, 0); }
    st.stepped = false;
    // the screen doors go with the cabin's doors (open only while it is in at this end, doors open)
    const ak = g.akamo;
    st.sd = ak && ak.platformDoorK ? ak.platformDoorK() : 0;
    applyCols();
    visuals();
    st.drawT -= dt;
    if (st.drawT <= 0) {
      st.drawT = 0.25;
      drawCar(cp, st);
      for (let i = 0; i < 2; i++) drawInd(ind[i], i, st);
      const info = ak && ak.boardInfo ? ak.boardInfo() : null;
      for (const bd of boards) drawBoard(bd, info);
    }
  }
  const _d = new THREE.Vector3();
  /** the lift's carry for the walking player (ship-local position), or null */
  const liftDelta = (p) => (inCar(p) ? _d : null);      // (filled in by preStep, just before the step)
  // (from the tower up, the station's lobby shell stays drawn: it is seen through the windows)
  const showsShell = (p) => p.y > 10.6 && contains(p);
  return { group, colliders: b.colliders, contains, showsShell, breachSpots, attach, detach, preStep, update, liftDelta, lift: st };
}
