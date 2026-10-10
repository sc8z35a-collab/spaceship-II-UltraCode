// Shirasagi's heart: a glass skybridge from the lobby's starboard wall to the station's core
// sphere, and inside the core a two-level atrium — window bands all round, a curved staircase down
// from the bridge landing, a white heron (shirasagi) sculpture with spread wings over a mosaic
// floor, and the glowing axial shaft along the station's spine overhead (the way on toward the
// habitat ring). Ship-local coordinates (B-29 docked), like the lobby.
import * as THREE from 'three';
import { AK_SITE } from './akamoSite.js';
import { loft } from '../ship/sweep.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const D2R = Math.PI / 180;

// core sphere centre (ship-local) and inner radius; main floor and bridge level
export const CORE = { x: 35.0, y: 2.25, z: -2.0, R: 8.1, floorY: -2.55, bridgeY: 0.25 };
// skybridge: along +x from the lobby wall to the core wall
export const BRIDGE = { x0: 16.9, x1: 27.4, zc: 1.3, hw: 1.3, h: 2.7 };
export const SHAFT = { r: 1.3 };
// the transit tube along the spine from the core's aft pole to the ring hub terminal (ship-local z)
export const TRANSIT = { z1: 34.4 };
export const TERMINAL = { z0: 34.4, z1: 37.6, r: 2.1 };

function canvasMat(w, h, draw, emissive = 1.0) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: emissive, color: 0x000000, roughness: 0.5 });
}

/** a white heron with spread wings (group of simple shapes), standing on one leg */
function heron(b, x, y, z, s) {
  const P = (dx, dy, dz) => [x + dx * s, y + dy * s, z + dz * s];
  // body and the S-curved neck, head, long beak
  b.sphere(0.55 * s, 'paintWhite', P(0, 2.1, 0), 24, [0.75, 0.62, 1.45]);
  const neck = [V(...P(0, 2.35, -0.6)), V(...P(0, 2.95, -0.75)), V(...P(0, 3.35, -0.55)), V(...P(0, 3.7, -0.75)), V(...P(0, 3.95, -1.05))];
  b.tube(neck, 0.12 * s, 'paintWhite', { radial: 12, seg: 40 });
  b.sphere(0.17 * s, 'paintWhite', P(0, 3.98, -1.1), 16, [0.8, 0.85, 1.2]);
  b.cyl(0.0, 0.05 * s, 0.75 * s, 'gold', P(0, 3.94, -1.55), [Math.PI / 2 + 0.2, 0, 0], 10);
  b.sphere(0.03 * s, 'black', P(0.1, 4.03, -1.18), 6);
  b.sphere(0.03 * s, 'black', P(-0.1, 4.03, -1.18), 6);
  // crest plumes
  for (const k of [0, 1]) b.tube([V(...P(0, 4.1, -1.0)), V(...P(0, 4.2, -0.6 - k * 0.1)), V(...P(0, 4.05, -0.2 - k * 0.15))], 0.02 * s, 'paintWhite', { radial: 6, seg: 12 });
  // wings: swept fans of feathers, slightly raised
  for (const side of [-1, 1]) {
    for (let f = 0; f < 9; f++) {
      const a0 = (side > 0 ? 0 : Math.PI);
      const ang = a0 + side * (-0.15 + f * 0.09);
      const len = (1.6 + f * 0.33) * s;
      const g = new THREE.BoxGeometry(len, 0.03 * s, 0.32 * s);
      g.translate(len / 2, 0, 0);
      g.rotateZ(side > 0 ? 0.32 + f * 0.035 : Math.PI - 0.32 - f * 0.035);
      g.rotateY(-side * (0.35 - f * 0.06));
      g.translate(...P(side * 0.35, 2.3, 0.1 + f * 0.08));
      b.add(g, 'paintWhite');
      void ang;
    }
  }
  // tail, one long leg (the other tucked), the rock it stands on
  for (let k = 0; k < 5; k++) { const g = new THREE.BoxGeometry(0.16 * s, 0.03 * s, 0.9 * s); g.translate(0, 0, 0.45 * s); g.rotateY((k - 2) * 0.12); g.rotateX(-0.25); g.translate(...P(0, 2.05, 0.65)); b.add(g, 'paintWhite'); }
  b.cyl(0.035 * s, 0.03 * s, 1.6 * s, 'black', P(0, 0.85, 0.05), null, 8);
  b.cyl(0.03 * s, 0.03 * s, 0.7 * s, 'black', P(0.1, 1.55, 0.2), [0.9, 0, 0], 8);
  b.sphere(0.65 * s, 'marbleDark', P(0, 0.0, 0), 16, [1.2, 0.45, 1.0]);
}

export function buildCoreAtrium(b, M, lamp, R, def) {
  const { x: CX, y: CY, z: CZ, R: RA, floorY, bridgeY } = CORE;
  // ---- materials
  M.paintWhite = M.paintWhite || new THREE.MeshStandardMaterial({ color: 0xf1f0ec, roughness: 0.35, metalness: 0.05 });
  M.atriumWall = M.atriumWall || new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: 0.75, side: THREE.DoubleSide, envMap: M.cream.envMap, envMapIntensity: 0.4 });
  M.shaftGlow = M.shaftGlow || new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.35, 0.75, 1.0), emissiveIntensity: 2.4 });
  M.mosaic = canvasMat(1024, 1024, (g, w) => {
    g.fillStyle = '#e9e4da'; g.fillRect(0, 0, w, w);
    const c = w / 2;
    for (let r = 0; r < 9; r++) { g.strokeStyle = r % 2 ? 'rgba(201,162,90,0.9)' : 'rgba(30,60,80,0.7)'; g.lineWidth = r % 3 ? 3 : 7; g.beginPath(); g.arc(c, c, 60 + r * 52, 0, Math.PI * 2); g.stroke(); }
    for (let k = 0; k < 32; k++) { const a = k / 32 * Math.PI * 2; g.strokeStyle = k % 4 ? 'rgba(30,60,80,0.45)' : 'rgba(201,162,90,0.9)'; g.lineWidth = k % 4 ? 2 : 5; g.beginPath(); g.moveTo(c + Math.cos(a) * 60, c + Math.sin(a) * 60); g.lineTo(c + Math.cos(a) * 500, c + Math.sin(a) * 500); g.stroke(); }
    g.fillStyle = '#20384a'; g.beginPath(); g.arc(c, c, 56, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e0b860'; g.font = '700 46px "Hiragino Mincho ProN", "Noto Serif JP", serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('白鷺', c, c + 2);
  }, 0.05);
  M.mosaic.color = new THREE.Color(1, 1, 1);
  M.mosaic.roughness = 0.2;
  M.bridgeSign = canvasMat(1024, 160, (g, w, h) => {
    g.fillStyle = '#06080b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#9fe2ff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '300 66px "Helvetica Neue", Arial, sans-serif'; g.fillText('CORE ATRIUM  →', w * 0.4, h / 2);
    g.fillStyle = '#ffffff'; g.font = '500 48px "Hiragino Sans", "Noto Sans JP", sans-serif'; g.fillText('中央アトリウム', w * 0.83, h / 2);
  }, 1.4);

  // ================================================================ skybridge
  {
    const { x0, x1, zc, hw, h } = BRIDGE;
    const y0 = bridgeY, len = x1 - x0, xm = (x0 + x1) / 2;
    // floor: dark grating with LED edge lines, glass side walls and roof between steel ribs
    b.box(len, 0.08, hw * 2, 'grate', [xm, y0 - 0.04, zc], null, 0.01);
    b.colBox(len + 0.4, 0.12, hw * 2, [xm, y0 - 0.06, zc]);
    for (const s of [-1, 1]) {
      b.box(len, 0.03, 0.03, 'coveBlue', [xm, y0 + 0.03, zc + s * (hw - 0.12)], null, 0);
      b.box(len, h, 0.04, 'glass', [xm, y0 + h / 2, zc + s * hw], null, 0);
      b.colBox(len, h, 0.1, [xm, y0 + h / 2, zc + s * (hw + 0.05)]);
      b.pipe([x0 + 0.2, y0 + 1.0, zc + s * (hw - 0.1)], [x1 - 0.2, y0 + 1.0, zc + s * (hw - 0.1)], 0.02, 'brass', 8);
    }
    b.box(len, 0.04, hw * 2, 'glass', [xm, y0 + h, zc], null, 0);
    b.colBox(len, 0.1, hw * 2, [xm, y0 + h + 0.05, zc]);
    for (let x = x0 + 0.6; x < x1; x += 1.3) {
      const pts = [V(x, y0, zc - hw), V(x, y0 + h - 0.3, zc - hw), V(x, y0 + h, zc - hw + 0.3), V(x, y0 + h, zc + hw - 0.3), V(x, y0 + h - 0.3, zc + hw), V(x, y0, zc + hw)];
      b.tube(pts, 0.045, 'steel', { radial: 6, seg: 40, tension: 0.1 });
    }
    b.box(1.9, 0.3, 0.05, 'black', [x0 + 0.5, y0 + h - 0.3, zc], [0, Math.PI / 2, 0], 0.01);
    b.add(new THREE.PlaneGeometry(1.85, 0.29), 'bridgeSign', [x0 + 0.53, y0 + h - 0.3, zc], [0, Math.PI / 2, 0]);
    lamp(xm, y0 + 2.2, zc, 0xd8ecff, 1.8, 7);
  }

  // ================================================================ core sphere
  // shell: lat/long grid, two bands of windows (deep reveals) and the bridge opening left out
  const WIN_LAT = [[4 * D2R, 13 * D2R], [-13 * D2R, -4 * D2R]];
  const nLon = 96, nLat = 64;
  const isWin = (lat, lon) => WIN_LAT.some(([a, c]) => lat > a && lat < c) && (Math.floor((lon + Math.PI) / (Math.PI * 2) * 48) % 2 === 0);
  const sp = (lat, lon, r = RA) => V(CX + r * Math.cos(lat) * Math.cos(lon), CY + r * Math.sin(lat), CZ + r * Math.cos(lat) * Math.sin(lon));
  // the bridge mouth on the -x side (lon ~ PI), the axial shaft on +-z (lon ~ +-PI/2 at lat 0)
  const bridgeHole = (p) => p.x < CX - 5 && Math.abs(p.z - BRIDGE.zc) < BRIDGE.hw + 0.05 && p.y > bridgeY - 0.1 && p.y < bridgeY + BRIDGE.h + 0.05;
  const shaftHole = (p) => Math.hypot(p.x - CX, p.y - CY) < SHAFT.r + 0.05;
  // AKAMO's lift goes up through the dome here (its gold collar covers the cut)
  const liftHole = (p, m) => p.y > CY && Math.hypot(p.x - AK_SITE.lift.x, p.z - AK_SITE.lift.z) < AK_SITE.lift.r + m;
  {
    const pos = [], win = [];
    for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) {
      const la = -Math.PI / 2 + Math.PI * i / nLat, lb = -Math.PI / 2 + Math.PI * (i + 1) / nLat;
      const oa = -Math.PI + Math.PI * 2 * j / nLon, ob = -Math.PI + Math.PI * 2 * (j + 1) / nLon;
      const lm = (la + lb) / 2, om = (oa + ob) / 2;
      const pm = sp(lm, om);
      if (pm.y < floorY - 0.05) continue;                 // under the main floor: not seen
      if (bridgeHole(pm) || shaftHole(pm) || liftHole(pm, 0.3)) continue;
      const A = sp(la, oa), B = sp(la, ob), C = sp(lb, ob), D = sp(lb, oa);
      (isWin(lm, om) ? win : pos).push(...A.toArray(), ...B.toArray(), ...C.toArray(), ...A.toArray(), ...C.toArray(), ...D.toArray());
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    b.add(g, 'atriumWall');
    const gw = new THREE.BufferGeometry();
    // window cells: glass pushed out to the outer skin, reveals between
    const wp = [];
    for (let k = 0; k < win.length; k += 3) { const v = V(win[k], win[k + 1], win[k + 2]).sub(V(CX, CY, CZ)).multiplyScalar((RA + 0.36) / RA).add(V(CX, CY, CZ)); wp.push(v.x, v.y, v.z); }
    gw.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    gw.computeVertexNormals();
    b.add(gw, 'glass');
    // gold rings framing the window bands
    for (const [a, c] of WIN_LAT) for (const lat of [a, c]) b.torus(RA * Math.cos(lat) - 0.03, 0.035, 'gold', [CX, CY + RA * Math.sin(lat), CZ], [Math.PI / 2, 0, 0], 96);
    // reveals: short radial walls around every window cell
    for (const [a, c] of WIN_LAT) for (let j = 0; j < 48; j += 2) {
      const oa = -Math.PI + Math.PI * 2 * j / 48, ob = -Math.PI + Math.PI * 2 * (j + 1) / 48;
      const mid = sp((a + c) / 2, (oa + ob) / 2);
      if (bridgeHole(mid)) continue;
      for (const o of [oa, ob]) {
        const pts = [];
        for (let t = 0; t <= 4; t++) { const lat = a + (c - a) * t / 4; pts.push([sp(lat, o, RA), sp(lat, o, RA + 0.36)]); }
        const q = [];
        for (let t = 0; t < 4; t++) { const [p0, p1] = pts[t], [p2, p3] = pts[t + 1]; q.push(...p0.toArray(), ...p2.toArray(), ...p3.toArray(), ...p0.toArray(), ...p3.toArray(), ...p1.toArray(), ...p0.toArray(), ...p3.toArray(), ...p2.toArray(), ...p0.toArray(), ...p1.toArray(), ...p3.toArray()); }
        const gq = new THREE.BufferGeometry(); gq.setAttribute('position', new THREE.Float32BufferAttribute(q, 3)); gq.computeVertexNormals();
        b.add(gq, 'marbleDark');
      }
    }
  }
  // coarse sphere collider, open at the bridge mouth and where the axial shaft passes
  {
    const g = new THREE.SphereGeometry(RA - 0.02, 32, 24);
    const gp = g.toNonIndexed();
    const a = gp.attributes.position.array, out = [];
    for (let i = 0; i < a.length; i += 9) {
      const c = V((a[i] + a[i + 3] + a[i + 6]) / 3 + CX, (a[i + 1] + a[i + 4] + a[i + 7]) / 3 + CY, (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + CZ);
      if (bridgeHole(c) || shaftHole(c) || liftHole(c, 1.3)) continue;
      for (let k = 0; k < 9; k += 3) out.push(a[i + k] + CX, a[i + k + 1] + CY, a[i + k + 2] + CZ);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    b.colMesh(cg);
    // (that collider is coarse, so its opening round AKAMO's lift is cut wide: plates laid on the
    // dome's own curve close the gap right up to the lift's glass, or a weightless Kaito drifts out)
    {
      const Rd = RA + 0.02, lx = AK_SITE.lift.x, lz = AK_SITE.lift.z, NS = 18, rr = [1.5, 2.2, 2.95];
      const onDome = (d, t) => { const x = lx + d * Math.cos(t), z = lz + d * Math.sin(t), q = Rd * Rd - (x - CX) ** 2 - (z - CZ) ** 2; return q > 0 ? V(x, CY + Math.sqrt(q), z) : null; };
      const mb = new THREE.Matrix4(), eu = new THREE.Euler(), ctr = V(CX, CY, CZ);
      for (let i = 0; i < NS; i++) {
        const t = (i + 0.5) / NS * Math.PI * 2;
        for (let j = 0; j < rr.length - 1; j++) {
          const A = onDome(rr[j], t), B = onDome(rr[j + 1], t);
          if (!A || !B) continue;
          const c = A.clone().add(B).multiplyScalar(0.5);
          if (bridgeHole(c) || shaftHole(c)) continue;
          const ex = B.clone().sub(A), len = ex.length();
          ex.normalize();
          const ey = c.clone().sub(ctr).normalize();
          ey.addScaledVector(ex, -ey.dot(ex)).normalize();
          const ez = new THREE.Vector3().crossVectors(ex, ey);
          c.addScaledVector(ey, 0.04);
          eu.setFromRotationMatrix(mb.makeBasis(ex, ey, ez), 'YXZ');
          b.colBox(len + 0.12, 0.24, 2 * rr[j + 1] * Math.sin(Math.PI / NS) + 0.14, c.toArray(), [eu.x, eu.y, eu.z]);
        }
      }
    }
  }

  // ---- main floor with the heron mosaic; bridge landing; curved stair; balustrades
  const rF = Math.sqrt(RA * RA - (CY - floorY) * (CY - floorY)) - 0.02;
  b.add(new THREE.CircleGeometry(rF, 96), 'mosaic', [CX, floorY, CZ], [-Math.PI / 2, 0, 0]);
  b.colCyl(rF, 0.16, [CX, floorY - 0.08, CZ]);
  b.torus(rF - 0.05, 0.04, 'gold', [CX, floorY + 0.02, CZ], [Math.PI / 2, 0, 0], 96);
  const LX0 = CX - Math.sqrt(RA * RA - (CY - bridgeY) * (CY - bridgeY)) + 0.1, LX1 = LX0 + 2.6;
  b.box(LX1 - LX0, 0.253, 4.2, 'marble', [(LX0 + LX1) / 2, bridgeY - 0.1235, BRIDGE.zc], null, 0.02);     // (3 mm proud of the bridge's grate)
  b.colBox(LX1 - LX0, 0.25, 4.2, [(LX0 + LX1) / 2, bridgeY - 0.125, BRIDGE.zc]);
  // balustrade along the landing edge (glass with a brass rail), gap at the stair head
  for (const [za, zb] of [[BRIDGE.zc - 2.1, BRIDGE.zc - 0.1], [BRIDGE.zc + 1.4, BRIDGE.zc + 2.1]]) {
    b.box(0.04, 0.95, zb - za, 'glass', [LX1 - 0.04, bridgeY + 0.475, (za + zb) / 2], null, 0);
    b.pipe([LX1 - 0.04, bridgeY + 0.98, za], [LX1 - 0.04, bridgeY + 0.98, zb], 0.025, 'brass', 8);
    b.colBox(0.1, 1.0, zb - za, [LX1 - 0.04, bridgeY + 0.5, (za + zb) / 2]);
  }
  // stair: steps curving down from the landing to the floor
  {
    const n = 14, rise = (bridgeY - floorY) / n;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const x = LX1 + 0.45 + t * 2.8, z = BRIDGE.zc + 0.65 + Math.sin(t * 1.2) * 1.6, y = bridgeY - (k + 1) * rise;
      b.box(0.5, rise, 1.3, 'marble', [x, y + rise / 2, z], [0, -t * 0.7, 0], 0.01);
      b.box(0.04, 0.02, 1.25, 'gold', [x - 0.24, y + rise, z], [0, -t * 0.7, 0], 0);
      b.colBox(0.52, rise, 1.32, [x, y + rise / 2, z], [0, -t * 0.7, 0]);
    }
  }
  // ---- the heron on its rock, a ring of benches and planters around it
  heron(b, CX + 0.4, floorY, CZ + 0.6, 1.45);
  b.colCyl(1.2, 1.2, [CX + 0.4, floorY + 0.6, CZ + 0.6]);
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2 + 0.2;
    if (k === 7) continue;     // (AKAMO's lift stands there)
    const x = CX + Math.cos(a) * 4.4, z = CZ + Math.sin(a) * 4.4;
    if (k % 2) {
      b.box(1.5, 0.42, 0.5, 'wood', [x, floorY + 0.21, z], [0, -a + Math.PI / 2, 0], 0.03);
      b.colBox(1.5, 0.45, 0.5, [x, floorY + 0.22, z], [0, -a + Math.PI / 2, 0]);
    } else {
      b.cyl(0.55, 0.45, 0.6, 'ceramicDark', [x, floorY + 0.3, z], null, 20);
      b.sphere(0.6, R() > 0.5 ? 'leaf' : 'leafLight', [x, floorY + 0.95, z], 14, [1, 0.75, 1]);
      b.colCyl(0.56, 0.62, [x, floorY + 0.31, z]);
    }
  }
  // ---- the axial shaft overhead: glass tube with racing light rails (onward to the ring)
  {
    const zA = CZ - RA - 0.4, zB = CZ + RA + 0.4;
    const tube = new THREE.CylinderGeometry(SHAFT.r, SHAFT.r, zB - zA, 48, 1, true);
    b.add(tube, 'glass', [CX, CY, (zA + zB) / 2], [Math.PI / 2, 0, 0]);
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; b.pipe([CX + Math.cos(a) * (SHAFT.r - 0.05), CY + Math.sin(a) * (SHAFT.r - 0.05), zA], [CX + Math.cos(a) * (SHAFT.r - 0.05), CY + Math.sin(a) * (SHAFT.r - 0.05), zB], 0.025, k % 2 ? 'shaftGlow' : 'steel', 6); }
    for (let z = zA + 1.0; z < zB; z += 4.2) b.torus(SHAFT.r + 0.02, 0.035, 'gold', [CX, CY, z], [0, 0, 0], 48);
    // the shaft's entry ring over the heron (a gap with a landing ring and handholds)
    b.torus(SHAFT.r + 0.25, 0.08, 'brass', [CX, CY - SHAFT.r - 0.1, CZ], [Math.PI / 2, 0, 0], 48);
    // colliders: the tube wall with an opening at the centre for floating in
    for (const [za, zb] of [[zA, CZ - 1.2], [CZ + 1.2, zB]]) {
      const rings = [];
      for (let k = 0; k <= 8; k++) { const z = za + (zb - za) * k / 8; const r = []; for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; r.push(V(CX + Math.cos(a) * SHAFT.r, CY + Math.sin(a) * SHAFT.r, z)); } rings.push(r); }
      b.colMesh(loft(rings, { ring: true, caps: false }));
    }
    lamp(CX, CY, CZ + 4, 0x9fd8ff, 1.6, 7);
  }
  // ---- onward: the transit tube along the spine to the hub terminal of the habitat ring (a
  // moving handrail band carries you along), and the terminal with the spoke elevator
  {
    const zA = CZ + RA + 0.4, zB = TRANSIT.z1;
    const ringAt = (r, z) => { const pts = []; for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2; pts.push(V(CX + Math.cos(a) * r, CY + Math.sin(a) * r, z)); } return pts; };
    const rings = [];
    for (let k = 0; k <= 12; k++) rings.push(ringAt(SHAFT.r, zA + (zB - zA) * k / 12));
    b.add(loft(rings, { ring: true, caps: false, invert: true }), 'atriumWall');
    b.colMesh(loft(rings, { ring: true, caps: false }));
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2 + Math.PI / 6;
      b.pipe([CX + Math.cos(a) * (SHAFT.r - 0.06), CY + Math.sin(a) * (SHAFT.r - 0.06), zA], [CX + Math.cos(a) * (SHAFT.r - 0.06), CY + Math.sin(a) * (SHAFT.r - 0.06), zB], 0.03, k % 2 ? 'shaftGlow' : 'brass', 6);
    }
    for (let z = zA + 1.5; z < zB; z += 3.0) {
      b.torus(SHAFT.r - 0.04, 0.05, 'gold', [CX, CY, z], [0, 0, 0], 40);
      // porthole pairs looking out at the truss and the stars
      if (Math.round(z) % 2 === 0) for (const s2 of [-1, 1]) b.cyl(0.24, 0.24, 0.04, 'glass', [CX + s2 * (SHAFT.r - 0.02), CY, z + 1.5], [0, 0, Math.PI / 2], 20);
    }
    for (let z = zA + 3; z < zB; z += 6) lamp(CX, CY + 0.9, z, 0xbfe3ff, 1.3, 6);
    // the terminal: a round chamber at the hub, the spoke elevator's great round door at its end
    const { z0, z1, r } = TERMINAL;
    const tr = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, z = z0 + (z1 - z0) * t;
      const rr = SHAFT.r + (r - SHAFT.r) * Math.sin(Math.min(1, t * 2.2) * Math.PI / 2);
      tr.push(ringAt(rr, z));
    }
    b.add(loft(tr, { ring: true, caps: false, invert: true }), 'marble');
    b.colMesh(loft(tr, { ring: true, caps: false }));
    // the end wall with the elevator door (a heavy gold-rimmed round door) and a window band
    b.cyl(r, r, 0.2, 'marbleDark', [CX, CY, z1 + 0.1], [Math.PI / 2, 0, 0], 40);
    b.colBox(r * 2, r * 2, 0.2, [CX, CY, z1 + 0.1]);
    b.cyl(1.05, 1.05, 0.12, 'steel', [CX, CY, z1 - 0.06], [Math.PI / 2, 0, 0], 40);
    b.torus(1.1, 0.07, 'gold', [CX, CY, z1 - 0.1], [0, 0, 0], 40);
    b.box(0.05, 2.0, 0.02, 'led', [CX, CY, z1 - 0.13], null, 0);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; b.sphere(0.035, 'gold', [CX + Math.cos(a) * 1.18, CY + Math.sin(a) * 1.18, z1 - 0.12], 8); }
    // call panel beside the door
    b.box(0.34, 0.5, 0.06, 'black', [CX + 1.55, CY - 0.2, z1 - 0.06], null, 0.02);
    lamp(CX, CY + 1.4, z1 - 1.2, 0xffe2b8, 2.0, 7);
  }
  // ---- lights, screens, vertical gardens around the wall
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2 + 0.5;
    const p = sp(-0.18, a, RA - 0.12);
    if (bridgeHole(p)) continue;
    b.box(0.08, 1.8, 1.2, R() > 0.4 ? 'leaf' : 'leafLight', p.toArray(), [0, -a, 0], 0.05);
  }
  lamp(CX, floorY + 4.5, CZ, 0xfff0d8, 3.2, 12);
  lamp(CX - 4, floorY + 2.0, CZ - 3, 0xffd8a8, 2.0, 7);
  lamp(CX + 4, floorY + 2.0, CZ + 3, 0xffd8a8, 2.0, 7);
  lamp(LX0 + 1.2, bridgeY + 2.0, BRIDGE.zc, 0xffe6c0, 2.0, 6);

  const contains = (p) => {
    if (p.x > BRIDGE.x0 - 0.3 && p.x < BRIDGE.x1 + 0.3 && Math.abs(p.z - BRIDGE.zc) < BRIDGE.hw + 0.05 && p.y > bridgeY - 0.4 && p.y < bridgeY + BRIDGE.h + 0.05) return true;
    // the transit tube and the hub terminal
    const rr = Math.hypot(p.x - CX, p.y - CY);
    if (p.z > CZ && p.z < TERMINAL.z1 + 0.1 && rr < (p.z > TERMINAL.z0 ? TERMINAL.r : SHAFT.r) + 0.05) return true;
    const d = Math.hypot(p.x - CX, p.y - CY, p.z - CZ);
    return d < RA - 0.05 && p.y > floorY - 0.3;
  };
  return { contains };
}

/** Shirasagi's skybridge and core details for the station model (station-local) */
export function atriumExterior(b, dock) {
  const { x0, x1, zc, hw, h } = BRIDGE;
  const y0 = CORE.bridgeY + dock.y, z = zc + dock.z;
  const xa = x0 + dock.x, xb = x1 + dock.x;
  b.box(xb - xa, h + 0.3, hw * 2 + 0.3, 'dome', [(xa + xb) / 2, y0 + h / 2, z], null, 0.1);
  for (let x = xa + 0.6; x < xb; x += 1.3) b.box(0.12, h + 0.36, hw * 2 + 0.36, 'hullDark', [x, y0 + h / 2, z], null, 0.04);
  b.box(xb - xa, 0.3, hw * 2 + 0.4, 'hull', [(xa + xb) / 2, y0 - 0.2, z], null, 0.05);
  b.box(xb - xa - 0.4, 0.1, hw * 2 - 0.4, 'lobbyGlow', [(xa + xb) / 2, y0 + h - 0.2, z], null, 0.02);
}
