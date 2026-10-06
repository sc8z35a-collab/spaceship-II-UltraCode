// The Origin International Space Station (オリジン国際宇宙ステーション): the biggest thing in orbit,
// 100 km ahead of where B-29 starts, on the same orbit. Nobody lives aboard; it runs itself. A
// gateway of walkable modules (where B-29 berths; see originInterior.js) hangs under the front of a
// 310 m spine of pressurised robot modules. Across the spine runs the 1.3 km power truss with eight
// solar wings, the superconducting storage banks and the radiators; ahead of the gateway lies the
// supply depot, an open frame stacked with cargo containers worked by gantry robots; at the far end
// turns the farm wheel. Rail carts run the truss, freighters lie at the nodes, drones patrol.
// Station-local coordinates: y radial up, -z along the motion, x = y cross z.
import * as THREE from 'three';
import { Builder, rng } from '../ship/geom.js';
import { ORIGIN_ROOMS, ORIGIN_WALL, holesOf } from './originLayout.js';
import { faceGeo, rrPts } from './originInterior.js';

const FACES = ['+x', '-x', '+y', '-y', '+z', '-z'];
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** the main pieces, station-local */
export const ORIGIN = {
  spine: { y: 14, z: 0.95, x0: -10, x1: 300, r: 4.5 },
  truss: { x: 150, y: 14, half: 640, w: 10 },
  depot: { x0: 50, x1: 130, y0: -14, y1: 6, z0: -26, z1: 28 },
  wheel: { x: 318, r: 70 },
  // B-29 swings round outside this, comes in along the berth line
  berthR: 900,
  // H8's docking port on the spine (its root sits there, upright)
  h8Port: V(48, 14 + 4.5 + 4.65, 0.95),
};

/** a square lattice truss from a to b (w wide) */
function lattice(b, a, c, w, t, key = 'metal', keyD = 'metalDark') {
  const A = V(...a), C = V(...c), d = C.clone().sub(A), L = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d.clone().normalize());
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  b.push(A.clone().lerp(C, 0.5).toArray(), [e.x, e.y, e.z]);
  const bays = Math.max(1, Math.round(L / w)), bl = L / bays;
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(t, t, L, key, [x * w / 2, y * w / 2, 0], null, 0);
  for (let k = 0; k <= bays; k++) {
    const z = -L / 2 + k * bl;
    b.box(w, t * 0.7, t * 0.7, keyD, [0, w / 2, z], null, 0); b.box(w, t * 0.7, t * 0.7, keyD, [0, -w / 2, z], null, 0);
    b.box(t * 0.7, w, t * 0.7, keyD, [w / 2, 0, z], null, 0); b.box(t * 0.7, w, t * 0.7, keyD, [-w / 2, 0, z], null, 0);
  }
  const dl = Math.hypot(w, bl), ang = Math.atan2(w, bl);
  for (let k = 0; k < bays; k++) {
    const z = -L / 2 + (k + 0.5) * bl, sg = k % 2 ? 1 : -1;
    b.box(t * 0.5, t * 0.5, dl, keyD, [0, w / 2, z], [0, sg * ang, 0], 0);
    b.box(t * 0.5, t * 0.5, dl, keyD, [0, -w / 2, z], [0, -sg * ang, 0], 0);
    b.box(t * 0.5, t * 0.5, dl, keyD, [w / 2, 0, z], [sg * ang, 0, 0], 0);
    b.box(t * 0.5, t * 0.5, dl, keyD, [-w / 2, 0, z], [-sg * ang, 0, 0], 0);
  }
  b.pop();
}

/** a pressurised module along x: cylinder, domed ends, bands, a row of lit windows */
function moduleX(b, bd, x0, x1, y, z, r, key, winKey, nWin) {
  const L = x1 - x0, xc = (x0 + x1) / 2;
  b.cyl(r, r, L, key, [xc, y, z], [0, 0, Math.PI / 2], 20);
  b.sphere(r, key, [x0, y, z], 16, [0.4, 1, 1]);
  b.sphere(r, key, [x1, y, z], 16, [0.4, 1, 1]);
  for (let k = 1; k < 5; k++) bd.torus(r + 0.06, 0.12, 'metalDark', [x0 + L * k / 5, y, z], [0, Math.PI / 2, 0], 16);
  for (let k = 0; k < nWin; k++) {
    const x = x0 + 2 + (L - 4) * (k + 0.5) / nWin;
    for (const a of [0.55, Math.PI - 0.55]) bd.box(1.1, 0.5, 0.12, winKey, [x, y + Math.sin(a) * (r + 0.02), z + Math.cos(a) * (r + 0.02)], [-a, 0, 0], 0.02);
  }
}

/** a solar wing: blanket of cells on a mast, out along +-x from the truss at (x, y, z) */
function solarWing(b, x, y, z, side, len, wid) {
  const x0 = x + side * 7, xc = x0 + side * len / 2;
  b.box(len, 0.25, 0.5, 'metalDark', [xc, y, z], null, 0);
  for (const dz of [-1, 1]) {
    b.box(len, 0.12, wid, 'solarPanel', [xc, y, z + dz * (wid / 2 + 0.6)], null, 0);
    b.box(len, 0.3, 0.3, 'metalDark', [xc, y, z + dz * (wid + 0.6)], null, 0);
    for (let k = 0; k <= 8; k++) b.box(0.25, 0.25, wid, 'metalDark', [x0 + side * len * k / 8, y, z + dz * (wid / 2 + 0.6)], null, 0);
  }
  b.cyl(1.2, 1.2, 4, 'metal', [x + side * 5, y, z], [0, 0, Math.PI / 2], 14);
}

/** the gateway's skin: quilted white blankets over the hull, seams, straps, patches (2.4 m tile) */
let SKIN = null;
function skinMaterial() {
  if (SKIN) return SKIN;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const R = rng(77);
  g.fillStyle = '#e9ebe8'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const x = i * 128, y = j * 128;
    const t = 225 + Math.floor(R() * 22);
    g.fillStyle = `rgb(${t},${t + 1},${t - 2})`; g.fillRect(x + 2, y + 2, 124, 124);
    // quilting stitches
    g.fillStyle = 'rgba(120,124,128,0.35)';
    for (let k = 1; k < 4; k++) for (let m = 1; m < 4; m++) g.fillRect(x + k * 32 - 1, y + m * 32 - 1, 2, 2);
    g.strokeStyle = 'rgba(110,116,122,0.7)'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, 126, 126);
    if (R() < 0.25) { g.fillStyle = 'rgba(200,170,90,0.55)'; g.fillRect(x + 20, y + 54, 88, 20); }
    if (R() < 0.2) { g.fillStyle = 'rgba(60,64,70,0.6)'; g.fillRect(x + 50, y + 10, 28, 108); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 2.4, 1 / 2.4);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  SKIN = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0.05 });
  return SKIN;
}

/** a cargo container (standard 6 x 2.6 x 2.6 m) */
const CONT_KEYS = ['whitePanel', 'whitePanel', 'hullOrange', 'originBlue', 'metal', 'plasticY'];

export function originModel(def, M, DOCK_AT) {
  // b: always drawn; bd: the detail, only up close (6 km); bc: what stands in for it further out
  const b = new Builder(), bd = new Builder(), bc = new Builder();
  b.plainUpTo = bd.plainUpTo = bc.plainUpTo = 0.2;
  const P = [];
  const v3 = (a) => V(a[0], a[1], a[2]);
  const cap = (a, c, r) => P.push({ type: 'capsule', a: v3(a), b: v3(c), r });
  const sph = (c, r) => P.push({ type: 'sphere', c: v3(c), r });
  const box = (c, h) => P.push({ type: 'box', c: v3(c), h: v3(h) });
  const strobes = [];
  const R = rng(20410);
  const D = DOCK_AT;
  const { spine: SP, truss: TR, depot: DP } = ORIGIN;

  // ---------------------------------------------------------------- the gateway (walkable)
  const shell = new Builder();             // window panes seen from outside: hidden while inside
  const cover = new Builder();             // the port's cover: only while no ship is in it
  shell.plainUpTo = cover.plainUpTo = 0.2;
  shell.push([D.x, D.y, D.z]); cover.push([D.x, D.y, D.z]); b.push([D.x, D.y, D.z]); bd.push([D.x, D.y, D.z]);
  for (const rm of ORIGIN_ROOMS) {
    for (const face of FACES) {
      const holes = holesOf(rm, face);
      b.add(faceGeo(rm, face, holes, ORIGIN_WALL, true), 'originSkin');
      for (const h of holes) {
        if (h.kind !== 'window' && h.kind !== 'tunnel') continue;
        // an opaque pane flush with the skin (lit from inside); the tunnel mouth gets the cover
        const pts = rrPts(h.u, h.v, h.w + 0.01, h.h + 0.01, h.r, 10);
        const s = face[0] === '+' ? 1 : -1, a = face[1];
        const plane = (s > 0 ? rm[a + '1'] : rm[a + '0']) + s * (ORIGIN_WALL + 0.004);
        const sh = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v))), 4);
        const pp = sh.attributes.position, p = V(0, 0, 0);
        const [ua, va] = a === 'x' ? ['z', 'y'] : a === 'y' ? ['x', 'z'] : ['x', 'y'];
        for (let i = 0; i < pp.count; i++) { p[a] = plane; p[ua] = pp.getX(i); p[va] = pp.getY(i); pp.setXYZ(i, p.x, p.y, p.z); }
        // face it outward
        const U = V(0, 0, 0), W = V(0, 0, 0), want = V(0, 0, 0); U[ua] = 1; W[va] = 1; want[a] = s;
        if (new THREE.Vector3().crossVectors(U, W).dot(want) < 0) { const ix = sh.index; for (let i = 0; i < ix.count; i += 3) { const t = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, t); } }
        sh.computeVertexNormals();
        (h.kind === 'tunnel' ? cover : shell).add(sh, h.kind === 'tunnel' ? 'metalDark' : 'originWin');
      }
    }
    // a handrail or two and bands round every space
    const cx = (rm.x0 + rm.x1) / 2, cy = (rm.y0 + rm.y1) / 2, cz = (rm.z0 + rm.z1) / 2;
    bd.pipe([rm.x0 + 0.4, rm.y1 + ORIGIN_WALL + 0.12, cz - 0.4], [rm.x1 - 0.4, rm.y1 + ORIGIN_WALL + 0.12, cz - 0.4], 0.03, 'plasticY', 6);
    box([cx + D.x, cy + D.y, cz + D.z], [(rm.x1 - rm.x0) / 2 + 0.3, (rm.y1 - rm.y0) / 2 + 0.3, (rm.z1 - rm.z0) / 2 + 0.3]);
  }
  // the corridor's segment bands outside, the cupola's frame
  for (const x of [12.2, 19.6, 23.6, 31.9, 36.2, 44.6]) bd.box(0.3, 2.44 + ORIGIN_WALL * 2 + 0.12, 2.44 + ORIGIN_WALL * 2 + 0.12, 'metalDark', [x, 1.22, -1.05], null, 0.02);
  {
    const cx = 49.0, cz = -1.05, top = -1.18, depth = 1.25, r0 = 1.8, r1 = 1.05;
    const ring = (y, r) => { const p = []; for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + Math.PI / 6; p.push(V(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r)); } return p; };
    const A = ring(top - ORIGIN_WALL, r0 + 0.05), Bt = ring(top - depth, r1 + 0.05);
    for (let k = 0; k < 6; k++) {
      bd.pipe(A[k], Bt[k], 0.07, 'metalDark', 6);
      bd.pipe(A[k], A[(k + 1) % 6], 0.07, 'metalDark', 6);
      bd.pipe(Bt[k], Bt[(k + 1) % 6], 0.07, 'metalDark', 6);
      const g = new THREE.BufferGeometry();
      const a0 = A[k], a1 = A[(k + 1) % 6], b0 = Bt[k], b1 = Bt[(k + 1) % 6];
      g.setAttribute('position', new THREE.Float32BufferAttribute([...a0.toArray(), ...b0.toArray(), ...b1.toArray(), ...a0.toArray(), ...b1.toArray(), ...a1.toArray()], 3));
      g.computeVertexNormals();
      shell.add(g, 'originWin');
    }
    shell.add(new THREE.CircleGeometry(r1, 24), 'originWin', [cx, top - depth - 0.02, cz], [Math.PI / 2, 0, 0]);
    bd.torus(r1 + 0.05, 0.08, 'metalDark', [cx, top - depth, cz], [Math.PI / 2, 0, 0], 16);
  }
  // the docking target round the port, floodlights on the berth
  bd.box(0.08, 0.3, 3.2, 'plasticY', [5.2 - ORIGIN_WALL - 0.04, 3.0, -1.05], null, 0.01);
  bd.box(0.08, 0.3, 3.2, 'plasticY', [5.2 - ORIGIN_WALL - 0.04, -0.6, -1.05], null, 0.01);
  for (const z of [-3.2, 1.1]) bd.cyl(0.3, 0.3, 0.12, 'flood', [5.2 - ORIGIN_WALL - 0.06, 3.3, z], [0, 0, Math.PI / 2], 10);
  shell.pop(); cover.pop(); b.pop(); bd.pop();
  // struts from the gateway up to the spine
  for (const x of [-20, -6, 8]) {
    lattice(bd, [x, 0.5, 0.95], [x, SP.y - SP.r + 0.3, 0.95], 1.6, 0.14);
    bc.box(1.6, SP.y - SP.r - 0.2, 1.6, 'metalDark', [x, (0.5 + SP.y - SP.r) / 2, 0.95], null, 0);
    cap([x, 0.5, 0.95], [x, SP.y - SP.r, 0.95], 1.4);
  }

  // ---------------------------------------------------------------- the spine
  const nodes = [-4, 34, 76, 116, 150, 190, 236, 290];
  for (let i = 0; i < nodes.length - 1; i++) {
    const xa = nodes[i] + 6.5, xb = nodes[i + 1] - 6.5;
    const food = i === 4 || i === 5;
    moduleX(b, bd, xa, xb, SP.y, SP.z, SP.r, food ? 'whitePanel' : 'hull', food ? 'growGlow' : 'windowLit', 9);
    // food modules: cold storage in white with blue lights underneath; greenhouse glow on top
    if (food) for (let k = 0; k < 6; k++) bd.box(3.4, 0.2, 1.4, 'cyanGlow', [xa + 3 + k * (xb - xa - 6) / 5, SP.y - SP.r - 0.05, SP.z], null, 0.02);
  }
  for (const x of nodes) {
    b.sphere(6.5, 'hull', [x, SP.y, SP.z], 20);
    bd.torus(6.55, 0.2, 'gold', [x, SP.y, SP.z], [0, 0, 0], 24);
    for (const [dy, dz] of [[0, 6.5], [0, -6.5], [6.5, 0]]) bd.cyl(1.9, 1.9, 1.6, 'hullOrange', [x, SP.y + dy, SP.z + dz], dy ? null : [Math.PI / 2, 0, 0], 14);
  }
  cap([SP.x0, SP.y, SP.z], [SP.x1, SP.y, SP.z], SP.r + 2.2);
  // the name in light on the spine's front, facing the arriving ships; partner emblems
  b.push([SP.x0 - 6.6, SP.y + 0.5, SP.z], [0, -Math.PI / 2, 0]);
  b.add(new THREE.PlaneGeometry(16, 4), 'originSign');
  b.pop();
  for (let k = 0; k < 12; k++) bd.box(1.6, 1.6, 0.1, 'emblem' + (k % 6), [10 + k * 2.1, SP.y + SP.r * 0.75, SP.z - SP.r * 0.66 - 0.05], [0.85, 0, 0], 0.02);
  // H8's docking port on top of the spine: a collar with its target marks
  {
    const p = ORIGIN.h8Port;
    b.cyl(1.7, 1.9, 1.4, 'hullOrange', [p.x, SP.y + SP.r + 0.5, p.z], null, 18);
    bd.torus(1.75, 0.12, 'plasticY', [p.x, SP.y + SP.r + 1.22, p.z], [Math.PI / 2, 0, 0], 18);
    for (const s of [-1, 1]) bd.box(0.3, 0.12, 3.0, 'plasticY', [p.x + s * 2.6, SP.y + SP.r + 0.3, p.z], null, 0.01);
    for (const s of [-1, 1]) bd.cyl(0.3, 0.3, 0.12, 'flood', [p.x + s * 3.2, SP.y + SP.r + 0.4, p.z + 2.4], null, 10);
  }
  // freighters berthed at the nodes (automatic cargo ships), under the spine
  for (const x of [190, 236]) {
    const y = SP.y - 6.5 - 1.2 - 7;
    b.cyl(2.2, 2.2, 1.6, 'hullDark', [x, SP.y - 7.4, SP.z], null, 14);
    b.cyl(3.2, 3.2, 12, 'whitePanel', [x, y, SP.z], null, 18);
    b.cyl(3.2, 1.4, 3, 'hull', [x, y - 7.5, SP.z], null, 18);
    b.sphere(3.2, 'whitePanel', [x, y + 6, SP.z], 14, [1, 0.4, 1]);
    for (const s of [-1, 1]) b.box(16, 5, 0.12, 'solarPanel', [x + s * 11.5, y, SP.z], null, 0);
    cap([x, y - 9, SP.z], [x, SP.y - 6.5, SP.z], 3.6);
    box([x, y, SP.z], [20, 3, 1]);
  }
  // robotic arms: one on the spine reaching over the depot, one on the truss
  const armAt = (x, y, z, a0, a1) => {
    bd.cyl(0.9, 1.1, 1.4, 'whitePanel', [x, y, z], null, 12);
    const e = V(x + Math.cos(a0) * 14, y + 6, z + Math.sin(a0) * 14);
    bd.pipe(V(x, y + 0.7, z), e, 0.5, 'whitePanel', 8);
    bd.sphere(0.8, 'metalDark', e.toArray(), 10);
    const w = e.clone().add(V(Math.cos(a1) * 13, -5, Math.sin(a1) * 13));
    bd.pipe(e, w, 0.45, 'whitePanel', 8);
    bd.sphere(0.7, 'metalDark', w.toArray(), 10);
    bd.box(1.2, 1.6, 1.2, 'metalDark', [w.x, w.y - 1, w.z], null, 0.05);
  };
  armAt(60, SP.y + SP.r, SP.z + 2, 0.4, -0.8);
  armAt(150, TR.y + TR.w / 2, 22, 2.2, 1.0);

  // ---------------------------------------------------------------- the power truss
  lattice(bd, [TR.x, TR.y, -TR.half], [TR.x, TR.y, TR.half], TR.w, 0.55);
  bc.box(TR.w * 0.8, TR.w * 0.8, TR.half * 2, 'metalDark', [TR.x, TR.y, 0], null, 0);
  box([TR.x, TR.y, 0], [TR.w / 2 + 0.5, TR.w / 2 + 0.5, TR.half]);
  // rails for the carts along the top
  for (const s of [-1, 1]) bd.box(0.6, 0.4, TR.half * 2, 'metal', [TR.x + s * 2.4, TR.y + TR.w / 2 + 0.4, 0], null, 0);
  // eight solar wings
  for (const z of [-390, -170, 170, 390]) for (const side of [-1, 1]) {
    solarWing(b, TR.x, TR.y, z, side, 140, 34);
    box([TR.x + side * 77, TR.y, z], [70, 0.6, 36]);
  }
  // superconducting storage banks hanging under the truss, their rings glowing
  for (const z of [-130, -100, -70, -40, 40, 70, 100, 130]) {
    const y0 = TR.y - TR.w / 2;
    b.cyl(5, 5, 22, 'whitePanel', [TR.x, y0 - 12, z], null, 18);
    b.sphere(5, 'whitePanel', [TR.x, y0 - 23, z], 12, [1, 0.5, 1]);
    for (let k = 0; k < 4; k++) b.cyl(5.08, 5.08, 0.6, 'energyGlow', [TR.x, y0 - 4 - k * 5, z], null, 18, true);
    bd.cyl(1.4, 1.4, 2, 'metalDark', [TR.x, y0 - 0.5, z], null, 10);
    cap([TR.x, y0 - 1, z], [TR.x, y0 - 25, z], 5.4);
  }
  // radiators: big white wings hanging off the truss between the solar arrays
  for (const z of [-280, 280]) {
    for (const s of [-1, 1]) {
      b.box(0.4, 72, 28, 'radiatorPanel', [TR.x + s * 8, TR.y - 40, z], null, 0);
      for (let k = 0; k < 6; k++) bd.box(0.5, 0.6, 28, 'metalDark', [TR.x + s * 8, TR.y - 6 - k * 13, z], null, 0);
      box([TR.x + s * 8, TR.y - 40, z], [0.8, 36.5, 14.5]);
    }
  }
  // comms at the truss ends, the spine's front
  for (const z of [-TR.half, TR.half]) {
    b.cyl(0.4, 0.4, 14, 'metal', [TR.x, TR.y + 7, z], null, 8);
    b.sphere(3.6, 'dish', [TR.x, TR.y + 15, z], 18, [1, 0.35, 1]);
    for (const [x, y] of [[3, 3], [-3, -3]]) { b.sphere(0.8, 'strobe', [TR.x + x, TR.y + y, z], 10); strobes.push([TR.x + x, TR.y + y, z]); }
  }
  b.sphere(0.8, 'navR', [TR.x, TR.y + 5.5, -TR.half], 10);
  b.sphere(0.8, 'navG', [TR.x, TR.y + 5.5, TR.half], 10);

  // ---------------------------------------------------------------- the supply depot
  {
    const { x0, x1, y0, y1, z0, z1 } = DP;
    // the frame: edges and a few cross beams
    const E = [[[x0, y0, z0], [x1, y0, z0]], [[x0, y1, z0], [x1, y1, z0]], [[x0, y0, z1], [x1, y0, z1]], [[x0, y1, z1], [x1, y1, z1]],
      [[x0, y0, z0], [x0, y1, z0]], [[x1, y0, z0], [x1, y1, z0]], [[x0, y0, z1], [x0, y1, z1]], [[x1, y0, z1], [x1, y1, z1]],
      [[x0, y0, z0], [x0, y0, z1]], [[x1, y0, z0], [x1, y0, z1]], [[x0, y1, z0], [x0, y1, z1]], [[x1, y1, z0], [x1, y1, z1]]];
    for (const [a, c] of E) b.pipe(V(...a), V(...c), 0.45, 'metalDark', 6);
    for (let x = x0 + 10; x < x1; x += 10) for (const z of [z0, z1]) bd.pipe(V(x, y0, z), V(x, y1, z), 0.3, 'metal', 5);
    for (let x = x0 + 10; x < x1; x += 10) bd.pipe(V(x, y1, z0), V(x, y1, z1), 0.3, 'metal', 5);
    // containers in racks: rows along x, stacks four high, aisles between pairs of rows
    const rowsZ = [];
    for (let z = z0 + 3; z < z1 - 2; z += 6.8) rowsZ.push(z);
    for (const z of rowsZ) {
      for (let x = x0 + 4; x < x1 - 3; x += 6.6) for (let k = 0; k < 6; k++) {
        if (R() < 0.22) continue;
        const key = CONT_KEYS[Math.floor(R() * CONT_KEYS.length)];
        bd.box(6, 2.6, 2.6, key, [x, y0 + 1.6 + k * 3.0, z], null, 0);
      }
      // from afar: one block per row
      bc.box(x1 - x0 - 6, 17.6, 2.6, 'whitePanel', [(x0 + x1) / 2, y0 + 9.4, z], null, 0);
    }
    box([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [(x1 - x0) / 2 + 0.5, (y1 - y0) / 2 + 0.5, (z1 - z0) / 2 + 0.5]);
    // the depot hangs from the spine on two struts
    for (const x of [x0 + 12, x1 - 12]) { lattice(bd, [x, y1, SP.z], [x, SP.y - SP.r, SP.z], 2.2, 0.2); cap([x, y1, SP.z], [x, SP.y - SP.r, SP.z], 1.6); }
    for (const [x, y, z] of [[x0, y1, z0], [x1, y1, z1], [x0, y0, z1], [x1, y0, z0]]) { b.sphere(0.6, 'strobe', [x, y, z], 8); strobes.push([x, y, z]); }
    for (const x of [x0 + 6, x1 - 6]) for (const z of [z0 + 4, z1 - 4]) bd.cyl(0.6, 0.6, 0.2, 'flood', [x, y1 + 0.5, z], null, 10);
  }

  // ---------------------------------------------------------------- the farm wheel
  const rb = new Builder();
  rb.plainUpTo = 0.2;
  {
    const W = ORIGIN.wheel.r;
    rb.torus(W, 5.5, 'whitePanel', [0, 0, 0], [0, 0, 0], 64);
    rb.torus(W, 5.6, 'gold', [0, 0, 3.6], [0, 0, 0], 64);
    rb.torus(W, 5.6, 'gold', [0, 0, -3.6], [0, 0, 0], 64);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; rb.cyl(1.4, 1.4, W - 8, 'hullDark', [Math.cos(a) * (W / 2 + 2), Math.sin(a) * (W / 2 + 2), 0], [0, 0, a - Math.PI / 2], 12); }
    rb.cyl(7, 7, 12, 'hull', [0, 0, 0], [Math.PI / 2, 0, 0], 28);
    // greenhouse windows all round: green light
    for (let k = 0; k < 64; k++) {
      const a = k / 64 * Math.PI * 2;
      rb.box(2.6, 0.3, 6.5, 'growGlow', [Math.cos(a) * (W - 5.4), Math.sin(a) * (W - 5.4), 0], [0, 0, a + Math.PI / 2], 0.05);
    }
    for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.4; rb.sphere(0.8, 'strobe', [Math.cos(a) * (W + 6), Math.sin(a) * (W + 6), 0], 10); }
  }
  const ring = rb.build(M, { castShadow: false });
  const ringMount = new THREE.Group();
  ringMount.position.set(ORIGIN.wheel.x, SP.y, SP.z);
  ringMount.rotation.y = Math.PI / 2;
  ringMount.add(ring);
  for (let k = 0; k < 32; k++) { const a = k / 32 * Math.PI * 2; sph([ORIGIN.wheel.x, SP.y + Math.cos(a) * ORIGIN.wheel.r, SP.z + Math.sin(a) * ORIGIN.wheel.r], 6.5); }
  b.cyl(2.5, 2.5, ORIGIN.wheel.x - SP.x1 + 4, 'hullDark', [(ORIGIN.wheel.x + SP.x1) / 2, SP.y, SP.z], [0, 0, Math.PI / 2], 16);
  for (const [x, y] of [[SP.x1 + 6, 0]]) { b.sphere(0.7, 'navR', [x, SP.y + 7, SP.z - 4], 10); b.sphere(0.7, 'navG', [x, SP.y + 7, SP.z + 4], 10); }
  for (const [x, y, z] of [[SP.x0 - 6.5, SP.y + 6, SP.z], [SP.x0 - 6.5, SP.y - 6, SP.z]]) { b.sphere(0.6, 'strobe', [x, y, z], 10); strobes.push([x, y, z]); }

  // ---------------------------------------------------------------- build
  const mats = Object.assign({}, M, { originSkin: skinMaterial() });
  const sign = M.originSign;
  if (!sign) mats.originSign = M.windowLit;
  const g = b.build(mats, { castShadow: false });
  const shellG = shell.build(mats, { castShadow: false });
  const coverG = cover.build(mats, { castShadow: false });
  const detail = bd.build(mats, { castShadow: false });
  const coarse = bc.build(mats, { castShadow: false });
  coarse.visible = false;
  g.add(shellG, coverG, ringMount, detail, coarse);

  // ---- moving parts: carts on the truss rails, gantry robots over the depot, patrol drones
  const anim = { carts: [], gantries: [], drones: [] };
  const mk = (fn) => { const bb = new Builder(); bb.plainUpTo = 0.2; fn(bb); const o = bb.build(mats, { castShadow: false }); detail.add(o); return o; };
  for (let k = 0; k < 4; k++) {
    const o = mk((bb) => { bb.box(4.2, 1.2, 7, 'plasticY', [0, 0, 0], null, 0.1); bb.box(6, 2.6, 2.6, CONT_KEYS[k % CONT_KEYS.length], [0, 2, 0], [0, Math.PI / 2, 0], 0); bb.sphere(0.35, 'navR', [0, 0.9, 3.4], 8); });
    anim.carts.push({ o, k, side: k % 2 ? 1 : -1, ph: k * 0.27 });
  }
  for (let k = 0; k < 2; k++) {
    const o = mk((bb) => {
      bb.box(3, 1.6, DP.z1 - DP.z0 + 2, 'plasticY', [0, 0, 0], null, 0.1);
      bb.box(2.4, 2.4, 2.4, 'whitePanel', [0, -1.8, 0], null, 0.1);
      bb.box(0.4, 6, 0.4, 'metal', [0, -5.5, 0], null, 0);
      bb.box(6, 2.6, 2.6, CONT_KEYS[(k + 2) % CONT_KEYS.length], [0, -9.8, 0], null, 0);
    });
    anim.gantries.push({ o, k });
  }
  for (let k = 0; k < 6; k++) {
    const o = mk((bb) => { bb.box(1.2, 1.2, 1.2, 'whitePanel', [0, 0, 0], null, 0.15); for (const s of [-1, 1]) bb.box(2.2, 0.06, 0.9, 'solarPanel', [s * 1.7, 0, 0], null, 0); bb.sphere(0.25, 'strobe', [0, 0.7, 0], 8); });
    anim.drones.push({ o, k });
  }

  g.userData.ring = ring;
  g.userData.strobes = strobes;
  g.userData.radius = 720;
  g.userData.proxies = P;
  g.userData.lobbyShell = shellG;
  g.userData.portCover = coverG;
  g.userData.hub = true;
  g.userData.anim = anim;
  g.userData.detail = detail;
  g.userData.coarse = coarse;
  return g;
}

/** the station at work (only worth doing within sight of it) */
export function originAnimate(model, t) {
  const A = model.userData.anim;
  if (!A) return;
  const { truss: TR, depot: DP, spine: SP } = ORIGIN;
  const s = t / 1000;
  for (const c of A.carts) {
    // up and down the truss between the depot and the far wings, stopping at each end
    const ph = (s / 220 + c.ph) % 1, u = ph < 0.5 ? ph * 2 : 2 - ph * 2;
    const k = u * u * (3 - 2 * u);
    c.o.position.set(TR.x + c.side * 2.4, TR.y + TR.w / 2 + 1.4, (c.side > 0 ? -1 : 1) * (40 + k * (TR.half - 70)));
  }
  for (const gn of A.gantries) {
    const ph = (s / 60 + gn.k * 0.5) % 1;
    const x = DP.x0 + 8 + (DP.x1 - DP.x0 - 16) * (0.5 + 0.5 * Math.sin(ph * Math.PI * 2));
    gn.o.position.set(x, DP.y1 + 1.2, (DP.z0 + DP.z1) / 2);
  }
  for (const d of A.drones) {
    const w = 0.02 + d.k * 0.004, a = s * w + d.k;
    d.o.position.set(TR.x + Math.cos(a) * (150 + d.k * 10), 40 + Math.sin(a * 1.7) * 12, Math.sin(a) * (150 + d.k * 10));
    d.o.rotation.set(0, -a, 0);
  }
}
