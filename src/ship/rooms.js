// Furniture, equipment and clutter for every room. Static geometry goes into the Builder;
// interactive / animated parts are registered in the layout L for other systems to build.
import * as THREE from 'three';
import { rng, roundedRectShape } from './geom.js';
import { sectionPoint, sectionNormal, halfWidthAt, heightRangeAt, HULL, Z_COCKPIT_BULK, Z_ENG_BULK, Z_REACTOR_BULK, CORRIDOR_X, DECK_Y } from './hullShape.js';
import { INSET, LIFT, ENG_HATCH } from './interior.js';
import { bookRow, plantPot, hangingPlant, mug, boxStack, cargoBag, cableBundle, switchPanel, gauge, valveWheel, sticker, stringLights, toolWall, photoFrame, locker } from './props.js';
import { hullCabinet, hullPadding } from './furniture.js';

export function createLayout() {
  return { monitors: [], seats: [], interact: [], lamps: [], loose: [], controls: {}, anim: [], pipes: [], spots: {} };
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** monitor slot facing direction n with up vector */
function monitorSlot(L, id, pos, n, up, w, h, room, res = 512) {
  L.monitors.push({ id, pos: pos.clone(), n: n.clone().normalize(), up: up.clone().normalize(), w, h, room, res });
}

// ------------------------------------------------------------------ cockpit
function consoleSweep(b, C, R0, a0, a1, profile, key, steps = 40) {
  // revolve the closed (r, y) profile around the vertical axis through C. Each profile edge
  // gets its own vertices (crisp edges between faces, smooth shading along the arc) and is
  // wound so that it faces outward whichever way round the profile was written.
  const n = profile.length;
  let area = 0;
  for (let k = 0; k < n; k++) { const [r0, y0] = profile[k], [r1, y1] = profile[(k + 1) % n]; area += r0 * y1 - r1 * y0; }
  const ccw = area > 0;
  const dirAt = (a) => V(Math.sin(a), 0, -Math.cos(a));
  const pos = [], nrm = [], idx = [];
  for (let k = 0; k < n; k++) {
    const [r0, y0] = profile[k], [r1, y1] = profile[(k + 1) % n];
    const dr = r1 - r0, dy = y1 - y0, len = Math.hypot(dr, dy) || 1;
    const nr = (ccw ? dy : -dy) / len, ny = (ccw ? -dr : dr) / len;
    const base = pos.length / 3;
    for (let i = 0; i <= steps; i++) {
      const d = dirAt(a0 + (a1 - a0) * (i / steps));
      const N = d.clone().multiplyScalar(nr).add(V(0, ny, 0)).normalize();
      for (const [r, y] of [[r0, y0], [r1, y1]]) {
        const p = C.clone().addScaledVector(d, R0 + r).setY(y);
        pos.push(p.x, p.y, p.z);
        nrm.push(N.x, N.y, N.z);
      }
    }
    // pick the winding whose geometric normal agrees with the outward normal
    const P = (j) => V(pos[(base + j) * 3], pos[(base + j) * 3 + 1], pos[(base + j) * 3 + 2]);
    const mid = Math.floor(steps / 2) * 2;
    const g0 = P(mid + 1).sub(P(mid)).cross(P(mid + 2).sub(P(mid)));
    const Nm = V(nrm[(base + mid) * 3], nrm[(base + mid) * 3 + 1], nrm[(base + mid) * 3 + 2]);
    const flip = g0.dot(Nm) < 0;
    for (let i = 0; i < steps; i++) {
      const A = base + i * 2, B = A + 1, Cc = A + 2, D = A + 3;
      if (!flip) idx.push(A, B, Cc, B, D, Cc);
      else idx.push(A, Cc, B, B, Cc, D);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  b.add(g, key);
  // end caps (built in a right-handed frame, then turned to face outward at each end)
  for (const a of [a0, a1]) {
    const shape = new THREE.Shape(profile.map(([r, y]) => new THREE.Vector2(r, y)));
    const cap = new THREE.ShapeGeometry(shape);
    const d = dirAt(a);
    const side = V(Math.cos(a), 0, Math.sin(a));   // = d x up: direction of increasing a
    const m = new THREE.Matrix4().makeBasis(d, V(0, 1, 0), side);
    m.setPosition(C.clone().addScaledVector(d, R0));
    cap.applyMatrix4(m);
    if (a === a0) {
      // the start cap must face towards decreasing a: reverse its winding and normals
      const ix = cap.index.array;
      for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
      const na = cap.attributes.normal;
      for (let i = 0; i < na.count; i++) na.setXYZ(i, -na.getX(i), -na.getY(i), -na.getZ(i));
    }
    b.add(cap, key);
  }
}

export function buildCockpit(b, L) {
  const R = rng(101);
  const C = V(0, 0, -10.35);
  const R0 = 1.0;
  // main console (arc desk)
  const prof = [[0.0, 0.0], [0.0, 0.58], [-0.1, 0.66], [-0.1, 0.71], [0.02, 0.74], [0.38, 0.84], [0.47, 0.86], [0.56, 0.78], [0.62, 0.0]];
  consoleSweep(b, C, R0, -1.12, 1.12, prof, 'panel');
  b.colBox(2.0, 0.85, 0.7, [0, 0.42, -11.55]);
  b.colBox(0.6, 0.85, 0.9, [-1.0, 0.42, -10.9], [0, 0.9, 0]);
  b.colBox(0.6, 0.85, 0.9, [1.0, 0.42, -10.9], [0, -0.9, 0]);
  // kick plate + lighting strip at console base
  consoleSweep(b, C, R0 - 0.005, -1.1, 1.1, [[0, 0.02], [0, 0.04], [-0.01, 0.04], [-0.01, 0.02]], 'ledBlue', 30);
  // monitors on the console (slots)
  const tilt = 0.82;
  const mons = [['sys', -0.66, 0.44, 0.28], ['nav', 0, 0.56, 0.32], ['cam', 0.66, 0.44, 0.28]];
  for (const [id, a, w, h] of mons) {
    const d = V(Math.sin(a), 0, -Math.cos(a));
    const up = V(0, Math.cos(tilt), 0).addScaledVector(d, Math.sin(tilt)).normalize();
    const n = d.clone().negate().multiplyScalar(Math.cos(tilt)).add(V(0, Math.sin(tilt), 0)).normalize();
    const base = C.clone().addScaledVector(d, R0 + 0.43).setY(0.855);
    const pos = base.clone().addScaledVector(up, h / 2 + 0.02).addScaledVector(n, 0.025);
    monitorSlot(L, id, pos, n, up, w, h, 'cockpit', id === 'nav' ? 768 : 512);
  }
  // physical controls on the desk
  const deskPt = (a, r, dy = 0) => C.clone().addScaledVector(V(Math.sin(a), 0, -Math.cos(a)), R0 + r).setY(0.74 + (r - 0.02) * 0.27 + dy);
  const deskRot = (a) => [-(Math.PI / 2 - 0.27), -a, 0];
  for (const a of [-0.42, -0.2, 0.2, 0.42]) switchPanel(b, R, deskPt(a, 0.13).toArray(), deskRot(a), 5, 2, 0.045);
  // ULTRA guarded switch + alarm silence button (interactive)
  L.spots.ultra = deskPt(0.06, 0.2, 0.02);
  L.spots.silence = deskPt(-0.06, 0.2, 0.02);
  L.spots.deskRot = (a) => deskRot(a);
  // side consoles
  for (const side of [-1, 1]) {
    const x = side * 1.36;
    b.push([x, 0, -10.0], [0, -side * 0.18, 0]);
    b.box(0.46, 0.66, 1.15, 'panel', [0, 0.33, 0], null, 0.03, 2, true);
    b.box(0.5, 0.06, 1.2, 'panelDark', [0, 0.69, 0], [0, 0, side * 0.28], 0.02);
    switchPanel(b, R, [-side * 0.06, 0.73, 0.3], [-Math.PI / 2, 0, side * 0.28], 4, 3, 0.05);
    b.pop();
    const mp = V(x - side * 0.02, 0.98, -10.25);
    const n = V(-side, 0.35, 0.15).normalize();
    monitorSlot(L, side < 0 ? 'comms' : 'life', mp, n, V(side * 0.3, 1, 0).normalize(), 0.34, 0.22, 'cockpit');
    // monitor arm
    b.cyl(0.02, 0.02, 0.28, 'metal', [x, 0.82, -10.25], null, 8);
  }
  // overhead panel
  b.push([0, 2.12, -9.95], [0.25, 0, 0]);
  b.box(1.0, 0.13, 0.72, 'panelDark', [0, 0, 0], null, 0.03);
  switchPanel(b, R, [-0.25, -0.07, 0.05], [Math.PI / 2, 0, 0], 6, 4, 0.05);
  switchPanel(b, R, [0.25, -0.07, 0.05], [Math.PI / 2, 0, 0], 6, 4, 0.05);
  b.pop();
  monitorSlot(L, 'status', V(0, 1.98, -10.33), V(0, -0.55, 1), V(0, 0.83, 0.55), 0.3, 0.14, 'cockpit', 256);
  // ceiling struts for the overhead panel
  b.pipe([-0.42, 2.18, -9.7], [-0.42, 2.55, -9.6], 0.025, 'metal');
  b.pipe([0.42, 2.18, -9.7], [0.42, 2.55, -9.6], 0.025, 'metal');

  // pilot seat
  b.cyl(0.11, 0.16, 0.34, 'metalDark', [0, 0.17, -10.3], null, 16);
  b.box(0.36, 0.05, 0.36, 'metalDark', [0, 0.36, -10.3], null, 0.01);
  b.box(0.56, 0.12, 0.52, 'fabric', [0, 0.45, -10.33], null, 0.05, 3);
  b.push([0, 0.48, -10.05], [0.2, 0, 0]);
  b.box(0.56, 0.78, 0.13, 'fabric', [0, 0.4, 0], null, 0.05, 3);
  b.box(0.32, 0.2, 0.1, 'fabric', [0, 0.92, 0.02], null, 0.04, 3);
  // harness
  for (const s of [-1, 1]) b.box(0.05, 0.6, 0.012, 'plasticY', [s * 0.13, 0.42, -0.075], [0, 0, s * 0.12], 0.004);
  b.box(0.06, 0.06, 0.02, 'steel', [0, 0.12, -0.09], null, 0.006);
  b.pop();
  for (const s of [-1, 1]) {
    b.box(0.09, 0.07, 0.46, 'plasticK', [s * 0.32, 0.62, -10.36], null, 0.025);
    b.box(0.05, 0.16, 0.05, 'metalDark', [s * 0.32, 0.53, -10.15], null, 0.01);
  }
  b.colBox(0.6, 0.55, 0.6, [0, 0.27, -10.3]);
  b.colBox(0.6, 0.8, 0.15, [0, 0.9, -10.0], [0.2, 0, 0]);
  L.seats.push({ id: 'pilot', eye: V(0, 1.17, -10.42), fwd: V(0, -0.12, -1).normalize(), kind: 'pilot', room: 'cockpit', exit: V(0.75, 0, -9.5) });
  L.spots.stick = V(0.32, 0.66, -10.6);
  L.spots.throttle = V(-0.32, 0.66, -10.58);

  // clutter
  photoFrame(b, [0.3, 0.98, -11.58], [-0.6, -0.1, 0.05], 'poster1', 0.09, 0.065);
  b.sphere(0.03, 'plasticY', [-0.42, 0.93, -11.48], 10); // little figure
  b.cyl(0.02, 0.025, 0.06, 'plasticY', [-0.42, 0.88, -11.48], null, 10);
  sticker(b, [0.62, 0.77, -11.35], [-1.3, -0.5, 0], 0.07, 0.045);
  sticker(b, [-0.75, 0.77, -11.28], [-1.3, 0.55, 0], 0.07, 0.045);
  plantPot(b, R, [1.3, 0.72, -9.55], 0.8);
  mug(b, [1.22, 0.72, -10.5], 0.4, 'plasticB');
  b.box(0.22, 0.03, 0.3, 'plasticR', [-1.3, 0.735, -9.6], [0, 0.3, 0], 0.005); // checklist binder
  b.torus(0.08, 0.012, 'plasticK', [0.4, 1.95, -9.75], [0.2, 0, 0], 16, Math.PI); // headset band
  b.sphere(0.035, 'plasticK', [0.32, 1.9, -9.75], 10, [1, 1, 0.6]);
  b.sphere(0.035, 'plasticK', [0.48, 1.9, -9.75], 10, [1, 1, 0.6]);
  cableBundle(b, [[-0.7, 0.05, -11.3], [-0.9, 0.1, -10.8], [-1.2, 0.05, -10.4], [-1.3, 0.3, -9.4]], 4);
  // rear storage cabinet + jump seat
  b.box(0.7, 1.0, 0.55, 'panel', [1.65, 0.5, -8.85], null, 0.03, 2, true);
  b.box(0.68, 0.02, 0.53, 'wood', [1.65, 1.01, -8.85], null, 0.005);
  mug(b, [1.5, 1.02, -8.8], 1.2);
  boxStack(b, R, [1.8, 1.02, -8.9], 2);
  b.box(0.45, 0.08, 0.4, 'fabric', [-1.6, 0.55, -8.65], null, 0.03); // folded jump seat
  b.box(0.45, 0.55, 0.05, 'metalDark', [-1.6, 0.85, -8.47], null, 0.01);
  L.lamps.push({ pos: V(0, 2.25, -10.2), color: 0xfff1dc, intensity: 5.5, room: 'cockpit' });
  L.lamps.push({ pos: V(0, 0.3, -11.0), color: 0x7fb0ff, intensity: 1.6, room: 'cockpit' });
  L.lamps.push({ pos: V(0, 1.05, -11.05), color: 0x6fd0ff, intensity: 1.5, room: 'cockpit' });   // screen glow on the pilot
  L.lamps.push({ pos: V(-1.5, 1.6, -9.6), color: 0xffd2a0, intensity: 1.4, room: 'cockpit' });
  L.lamps.push({ pos: V(1.5, 1.6, -9.6), color: 0xcfe0ff, intensity: 1.4, room: 'cockpit' });
}

// ------------------------------------------------------------------ living room
export function buildLiving(b, L) {
  const R = rng(202);
  // sofa along the corridor wall, facing the big window (port)
  const zs0 = -7.85, zs1 = -4.6;
  const sx = -1.05;
  b.box(0.62, 0.36, zs1 - zs0, 'fabric', [sx, 0.18, (zs0 + zs1) / 2], null, 0.04, 2, true);
  for (let i = 0; i < 3; i++) {
    const z = zs0 + 0.06 + (i + 0.5) * ((zs1 - zs0 - 0.12) / 3);
    b.box(0.6, 0.13, (zs1 - zs0 - 0.12) / 3 - 0.03, 'cushion', [sx - 0.02, 0.43, z], null, 0.05, 3);
    b.box(0.16, 0.5, (zs1 - zs0 - 0.12) / 3 - 0.03, 'cushion', [-0.84, 0.75, z], [0, 0, -0.18], 0.06, 3);
  }
  b.box(0.18, 0.62, zs1 - zs0, 'fabric', [-0.8, 0.5, (zs0 + zs1) / 2], null, 0.05, 2, true);
  for (const z of [zs0, zs1]) b.box(0.66, 0.55, 0.12, 'fabric', [sx, 0.32, z], null, 0.05, 2, true);
  // throw pillows + blanket
  b.box(0.3, 0.3, 0.12, 'fabricRed', [-1.0, 0.68, -7.55], [0.2, 0.3, 0.3], 0.06, 3);
  b.box(0.28, 0.28, 0.11, 'fabricBlue', [-1.0, 0.66, -4.9], [-0.2, -0.4, -0.2], 0.06, 3);
  b.box(0.55, 0.05, 0.7, 'fabricBlue', [-1.15, 0.52, -6.2], [0, 0.1, 0.05], 0.025, 2);
  L.seats.push({ id: 'sofa', eye: V(-1.05, 1.08, -6.2), fwd: V(-1, 0.08, 0).normalize(), kind: 'sofa', room: 'living', exit: V(-1.6, 0, -5.4) });
  // fold-down table on the hull wall below the window
  const tw = sectionPoint(-6.2, Math.PI - 0.02, INSET);
  b.box(0.42, 0.035, 1.1, 'wood', [tw.x + 0.3, 0.7, -6.2], null, 0.01, 2, true);
  b.pipe([tw.x + 0.12, 0.69, -6.6], [tw.x + 0.45, 0.69, -6.6], 0.012, 'steel');
  b.pipe([tw.x + 0.12, 0.69, -5.8], [tw.x + 0.45, 0.69, -5.8], 0.012, 'steel');
  // laptop
  b.box(0.3, 0.015, 0.22, 'metal', [tw.x + 0.32, 0.725, -6.45], [0, 0.4, 0], 0.005);
  b.push([tw.x + 0.24, 0.73, -6.5], [0, 0.4, 0]);
  b.box(0.3, 0.2, 0.01, 'metal', [0, 0.1, -0.1], [0.35, 0, 0], 0.005);
  b.pop();
  mug(b, [tw.x + 0.35, 0.718, -5.85], 2.0);
  bookRow(b, R, tw.x + 0.2, 0.718, -5.55, 0.1, 1, 0.15, Math.PI / 2);
  // rug
  b.box(1.2, 0.012, 2.4, 'fabricRed', [-1.75, 0.006, -6.2], null, 0.005);
  // bookshelf on the forward bulkhead (aft-facing)
  const zb = Z_COCKPIT_BULK + 0.06;
  for (let i = 0; i < 4; i++) {
    const y = 0.55 + i * 0.42;
    const hw = halfWidthAt(zb + 0.2, y, INSET) - 0.1;
    const x0 = -hw, x1 = -0.95;
    if (x1 - x0 < 0.3) continue;
    b.box(x1 - x0, 0.025, 0.3, 'wood', [(x0 + x1) / 2, y, zb + 0.15], null, 0.005, 2, true);
    if (i < 3) bookRow(b, R, x0 + 0.05, y + 0.013, zb + 0.15, (x1 - x0) * (0.4 + R() * 0.4), 1, 0.2, 0);
    if (i === 1) plantPot(b, R, [x1 - 0.18, y + 0.013, zb + 0.16], 1.0);
    if (i === 2) { photoFrame(b, [x1 - 0.22, y + 0.12, zb + 0.08], [0, 0, 0.05], 'poster2', 0.14, 0.14); }
    if (i === 3) { // model rocket
      b.cyl(0.025, 0.03, 0.3, 'plasticW', [x0 + 0.3, y + 0.16, zb + 0.15], null, 10);
      b.cyl(0.0, 0.025, 0.08, 'plasticR', [x0 + 0.3, y + 0.35, zb + 0.15], null, 10);
    }
  }
  b.colBox(1.5, 2.0, 0.32, [-1.75, 1.2, zb + 0.15]);
  // living sub monitor on an arm from the shelf
  monitorSlot(L, 'living', V(-1.5, 1.38, -7.95), V(0.35, -0.05, 1).normalize(), V(0, 1, 0), 0.42, 0.26, 'living');
  b.pipe([-1.3, 1.4, zb + 0.2], [-1.45, 1.4, -8.0], 0.018, 'metal');
  // galley along the aft cross wall (z = -3.0)
  const zg = -3.06;
  b.box(1.55, 0.9, 0.56, 'panel', [-2.05, 0.45, zg - 0.28], null, 0.02, 2, true);
  b.box(1.6, 0.04, 0.6, 'steel', [-2.05, 0.92, zg - 0.3], null, 0.008);
  for (let i = 0; i < 3; i++) b.box(0.46, 0.75, 0.01, 'panelDark', [-2.6 + i * 0.5, 0.45, zg - 0.565], null, 0.004);
  b.cyl(0.13, 0.11, 0.1, 'steel', [-2.3, 0.89, zg - 0.3], null, 16, true); // sink
  b.pipe([-2.3, 0.94, zg - 0.08], [-2.3, 1.12, zg - 0.08], 0.012, 'steel');
  b.pipe([-2.3, 1.12, zg - 0.08], [-2.3, 1.12, zg - 0.22], 0.012, 'steel');
  // upper cabinets with mugs hanging
  b.box(1.4, 0.45, 0.32, 'panel', [-2.0, 1.9, zg - 0.16], null, 0.02, 2, true);
  for (let i = 0; i < 4; i++) {
    b.pipe([-2.55 + i * 0.16, 1.66, zg - 0.2], [-2.55 + i * 0.16, 1.62, zg - 0.2], 0.004, 'steel');
    mug(b, [-2.55 + i * 0.16, 1.5, zg - 0.2], i * 0.7, ['ceramic', 'plasticB', 'plasticY', 'plasticR'][i]);
  }
  L.spots.coffee = V(-1.55, 0.94, zg - 0.3);
  // fridge
  b.box(0.5, 0.82, 0.02, 'plasticW', [-1.52, 0.44, zg - 0.565], null, 0.005);
  b.box(0.02, 0.3, 0.03, 'steel', [-1.3, 0.6, zg - 0.58], null, 0.004);
  // posters on the corridor wall above the sofa
  photoFrame(b, [-0.76, 1.62, -7.3], [0, -Math.PI / 2, 0], 'poster1', 0.42, 0.42);
  photoFrame(b, [-0.76, 1.55, -6.45], [0, -Math.PI / 2, 0.04], 'poster2', 0.36, 0.36);
  photoFrame(b, [-0.76, 1.6, -5.4], [0, -Math.PI / 2, -0.03], 'poster3', 0.36, 0.48);
  // guitar strapped near the bulkhead corner
  b.push([-2.2, 1.05, -7.8], [0, Math.PI / 2 + 0.6, 0.15]);
  b.sphere(0.16, 'wood', [0, -0.12, 0], 16, [1, 1, 0.35]);
  b.sphere(0.13, 'wood', [0, 0.1, 0], 16, [1, 1, 0.35]);
  b.cyl(0.04, 0.04, 0.008, 'black', [0, -0.02, 0.06], [Math.PI / 2, 0, 0], 16);
  b.box(0.05, 0.5, 0.025, 'wood', [0, 0.45, 0], null, 0.005);
  b.box(0.07, 0.12, 0.03, 'plasticK', [0, 0.74, 0], null, 0.008);
  b.pop();
  // string lights along the ceiling arc
  const lamps = stringLights(b, [[-0.9, 2.42, -8.2], [-1.6, 2.32, -7.2], [-2.0, 2.2, -6.2], [-1.6, 2.32, -5.2], [-1.1, 2.4, -4.2], [-0.9, 2.38, -3.3]]);
  L.lamps.push({ pos: V(-1.7, 2.1, -6.0), color: 0xffc98a, intensity: 4.5, room: 'living', string: lamps });
  L.lamps.push({ pos: V(-2.0, 1.6, -3.4), color: 0xffe2b8, intensity: 3.0, room: 'living' });
  L.lamps.push({ pos: V(-2.25, 1.15, -6.45), color: 0xffbf70, intensity: 2.0, room: 'living' });   // table lamp
  L.lamps.push({ pos: V(-1.8, 1.85, -8.0), color: 0xffd9a8, intensity: 1.2, room: 'living' });     // bookshelf glow
  // cargo net with soft bags on the ceiling
  cargoBag(b, R, [-1.5, 2.25, -4.3], [0.4, 0.2, 0.35], 'fabricBlue');
  cargoBag(b, R, [-1.9, 2.15, -4.0], [0.35, 0.2, 0.3], 'fabric');
  hangingPlant(b, R, [-2.25, 2.05, -5.1]);
  cableBundle(b, [[-0.85, 2.45, -8.3], [-1.4, 2.4, -7.0], [-1.9, 2.3, -5.6], [-1.5, 2.38, -3.2]], 3);
}

// ------------------------------------------------------------------ bathroom
export function buildBath(b, L) {
  const R = rng(303);
  // shower capsule at the aft end
  const sc = V(1.85, 0, -5.3);
  b.cyl(0.52, 0.52, 0.08, 'panel', [sc.x, 0.04, sc.z], null, 32, false, true);
  b.cyl(0.52, 0.52, 0.06, 'panel', [sc.x, 2.0, sc.z], null, 32);
  b.torus(0.5, 0.02, 'steel', [sc.x, 0.08, sc.z], [Math.PI / 2, 0, 0], 32);
  b.torus(0.5, 0.02, 'steel', [sc.x, 1.97, sc.z], [Math.PI / 2, 0, 0], 32);
  // back half shell (opaque) and glass front registered separately (animated door)
  b.add(new THREE.CylinderGeometry(0.5, 0.5, 1.9, 32, 1, true, Math.PI * 0.15, Math.PI * 1.1), 'plasticW', [sc.x, 1.02, sc.z], [0, Math.PI, 0]);
  b.cyl(0.05, 0.05, 0.04, 'steel', [sc.x, 1.93, sc.z], null, 12); // shower head
  b.cyl(0.08, 0.09, 0.02, 'steel', [sc.x, 1.9, sc.z], null, 16);
  b.cyl(0.04, 0.04, 0.01, 'black', [sc.x, 0.085, sc.z], null, 12); // drain
  b.colCyl(0.55, 0.08, [sc.x, 0.04, sc.z]);
  L.spots.shower = sc.clone();
  // toilet (vacuum)
  b.cyl(0.2, 0.17, 0.42, 'plasticW', [2.25, 0.21, -7.85], null, 24, false, true);
  b.torus(0.17, 0.035, 'plasticK', [2.25, 0.43, -7.85], [Math.PI / 2, 0, 0], 20);
  b.box(0.3, 0.5, 0.22, 'plasticW', [2.5, 0.55, -7.85], null, 0.04);
  b.pipe([2.5, 0.3, -7.75], [2.6, 0.05, -7.6], 0.03, 'rubber');
  // sink + mirror on the hull side
  b.box(0.45, 0.08, 0.36, 'plasticW', [2.25, 0.85, -6.7], null, 0.03, 2, true);
  b.box(0.4, 0.8, 0.32, 'plasticW', [2.29, 0.4, -6.7], null, 0.07, 4, true);          // pedestal (water feed inside)
  b.box(0.3, 0.012, 0.012, 'steel', [2.085, 0.62, -6.7], [0, Math.PI / 2, 0], 0.004);  // drawer pull
  b.cyl(0.13, 0.11, 0.05, 'steel', [2.2, 0.875, -6.7], null, 16, true);
  b.box(0.04, 0.6, 0.45, 'mirror', [2.55, 1.35, -6.7], [0, 0, 0.18], 0.01);
  // shelves with toiletries
  b.box(0.3, 0.025, 0.5, 'wood', [2.45, 1.65, -7.6], [0, 0, 0.25], 0.005);
  for (let i = 0; i < 5; i++) b.cyl(0.025, 0.025, 0.1 + R() * 0.08, ['plasticB', 'plasticW', 'plasticG', 'plasticY', 'plasticR'][i], [2.4, 1.72, -7.8 + i * 0.1], null, 10);
  // towels on a rail
  b.pipe([0.85, 1.3, -6.0], [0.85, 1.3, -5.0], 0.012, 'steel');
  b.box(0.04, 0.55, 0.45, 'fabricBlue', [0.86, 1.05, -5.6], null, 0.02, 2);
  b.box(0.04, 0.45, 0.35, 'cushion', [0.86, 1.1, -5.15], null, 0.02, 2);
  plantPot(b, R, [2.35, 1.665, -7.25], 0.7);
  monitorSlot(L, 'bath', V(0.78, 1.45, -6.85), V(1, 0, 0), V(0, 1, 0), 0.3, 0.2, 'bath', 384);
  L.lamps.push({ pos: V(1.7, 2.2, -6.5), color: 0xf4f8ff, intensity: 4.5, room: 'bath' });
  L.lamps.push({ pos: V(1.85, 1.95, -5.3), color: 0xd8f4ff, intensity: 1.5, room: 'bath' });
  L.lamps.push({ pos: V(2.3, 1.72, -6.7), color: 0xffe0b8, intensity: 1.4, room: 'bath' });
  L.interact.push({ id: 'toilet', pos: V(2.25, 0.45, -7.85), r: 0.35, kind: 'toilet' });
  L.interact.push({ id: 'sink', pos: V(2.2, 0.9, -6.7), r: 0.3, kind: 'sink' });
}

// ------------------------------------------------------------------ bunk alcove (open to corridor)
export function buildBunk(b, L) {
  const R = rng(404);
  const x0 = -2.72, x1 = -1.6, z0 = -2.9, z1 = 0.28;
  b.box(x1 - x0, 0.48, z1 - z0, 'panel', [(x0 + x1) / 2, 0.24, (z0 + z1) / 2], null, 0.02, 2, true);
  for (let i = 0; i < 3; i++) b.box(0.9, 0.38, 0.01, 'panelDark', [(x0 + x1) / 2, 0.24, z1 + 0.006 - 1.06 * i - 0.53 - 0.0], [0, Math.PI / 2, 0], 0.004);
  b.box(x1 - x0 - 0.06, 0.14, z1 - z0 - 0.06, 'fabric', [(x0 + x1) / 2, 0.55, (z0 + z1) / 2], null, 0.05, 3);
  // sleeping bag (strapped) + pillow
  b.box(0.75, 0.16, 1.8, 'fabricBlue', [(x0 + x1) / 2 + 0.05, 0.69, -1.0], null, 0.08, 3);
  b.box(0.55, 0.12, 0.35, 'cushion', [(x0 + x1) / 2 + 0.05, 0.69, -2.55], [0.1, 0, 0], 0.06, 3);
  for (const z of [-1.6, -0.4]) b.box(0.8, 0.02, 0.05, 'plasticY', [(x0 + x1) / 2 + 0.05, 0.78, z], null, 0.005);
  hullPadding(b, { side: -1, z0: -2.85, z1: 0.22, yB: 0.72, yT: 1.42, cols: 3, rows: 1 });
  // personal shelf
  b.box(0.22, 0.025, 1.6, 'wood', [-2.62, 1.55, -1.3], [0, 0, 0.35], 0.005);
  bookRow(b, R, -2.6, 1.565, -2.0, 0.35, 1, 0.14, Math.PI / 2);
  photoFrame(b, [-2.6, 1.68, -1.1], [0, Math.PI / 2, 0], 'poster1', 0.12, 0.09);
  // plush toy
  b.sphere(0.07, 'cushion', [-2.55, 1.64, -0.6], 10);
  b.sphere(0.05, 'cushion', [-2.55, 1.75, -0.6], 10);
  b.sphere(0.02, 'cushion', [-2.55, 1.79, -0.56], 6);
  b.sphere(0.02, 'cushion', [-2.55, 1.79, -0.64], 6);
  // reading lamp
  b.pipe([-2.55, 1.2, -2.6], [-2.35, 1.35, -2.5], 0.01, 'metal');
  b.cyl(0.03, 0.05, 0.06, 'metalDark', [-2.33, 1.33, -2.49], [0, 0, 0.6], 12);
  b.colBox(x1 - x0, 0.62, z1 - z0, [(x0 + x1) / 2, 0.31, (z0 + z1) / 2]);
  // curtain rail + curtain (bunched)
  b.pipe([-0.8, 1.85, -2.55], [-0.8, 1.85, -0.05], 0.01, 'steel');
  b.box(0.04, 1.6, 0.35, 'fabricRed', [-0.82, 1.04, -0.25], null, 0.02, 2);
  L.seats.push({ id: 'bunk', eye: V(-2.0, 0.92, -2.2), fwd: V(-0.6, 0.3, 0.75).normalize(), kind: 'bed', room: 'corridor', exit: V(-1.0, 0, -1.3) });
  L.lamps.push({ pos: V(-2.2, 1.4, -2.3), color: 0xffd9a0, intensity: 2.4, room: 'corridor' });
}

// ------------------------------------------------------------------ storage room (port, aft of bunk)
export function buildStorage(b, L) {
  const R = rng(505);
  hullCabinet(b, { side: -1, z0: 0.62, z1: 2.95, yB: 0, yT: 1.92, depth: 0.5, doors: 4, rows: 2, key: 'panel' });
  sticker(b, [-2.27, 1.55, 1.2], [0, Math.PI / 2 - 0.12, 0], 0.12, 0.08);
  sticker(b, [-2.27, 1.55, 2.35], [0, Math.PI / 2 - 0.12, 0], 0.12, 0.08);
  boxStack(b, R, [-1.4, 0, 4.9], 3);
  boxStack(b, R, [-1.9, 0, 4.9], 2);
  cargoBag(b, R, [-1.6, 2.15, 1.5], [0.5, 0.25, 0.4], 'fabricBlue');
  cargoBag(b, R, [-1.4, 2.2, 2.6], [0.4, 0.22, 0.35], 'fabric');
  cargoBag(b, R, [-1.8, 2.05, 3.6], [0.5, 0.3, 0.4], 'fabricRed');
  // water containers
  for (let i = 0; i < 3; i++) b.cyl(0.12, 0.12, 0.45, 'pipeBlue', [-1.2 - i * 0.26, 0.225, 1.0], null, 16, false, true);
  // fire extinguisher
  b.cyl(0.07, 0.07, 0.45, 'plasticR', [-0.85, 0.5, 0.75], null, 14);
  // repair kit cabinet (interactive)
  b.box(0.45, 0.35, 0.25, 'plasticR', [-0.88, 1.25, 4.6], [0, Math.PI / 2, 0], 0.02, 2, true);
  b.box(0.3, 0.06, 0.02, 'plasticW', [-0.75, 1.3, 4.6], [0, Math.PI / 2, 0], 0.005);
  L.interact.push({ id: 'repairkit', pos: V(-0.85, 1.25, 4.6), r: 0.4, kind: 'repairkit' });
  L.spots.repairKit = V(-0.85, 1.25, 4.6);
  L.lamps.push({ pos: V(-1.6, 2.1, 2.8), color: 0xe8efff, intensity: 3.5, room: 'store' });
}

// ------------------------------------------------------------------ airlock (starboard)
export function buildAirlock(b, L) {
  const R = rng(606);
  // suit rack against the forward cross wall
  b.box(0.7, 0.06, 0.25, 'metalDark', [1.75, 1.85, -2.42], null, 0.01);
  b.pipe([1.75, 1.85, -2.45], [1.75, 2.2, -2.52], 0.02, 'metal');
  L.spots.suit = V(1.75, 0.95, -2.14);
  // bench
  b.box(0.95, 0.06, 0.4, 'panelDark', [1.7, 0.45, 0.32], null, 0.02, 2, true);
  b.box(0.06, 0.45, 0.35, 'metalDark', [1.3, 0.22, 0.32], null, 0.01);
  b.box(0.06, 0.45, 0.35, 'metalDark', [2.1, 0.22, 0.32], null, 0.01);
  // control panel + gauge near the inner hatch
  b.box(0.05, 0.4, 0.3, 'panelDark', [0.78, 1.35, -1.85], null, 0.01);
  gauge(b, [0.81, 1.45, -1.85], [0, Math.PI / 2, 0], 0.06);
  switchPanel(b, R, [0.81, 1.25, -1.85], [0, Math.PI / 2, 0], 3, 2, 0.05);
  monitorSlot(L, 'airlock', V(0.81, 1.72, -1.85), V(1, 0, 0), V(0, 1, 0), 0.22, 0.14, 'airlock', 256);
  // handholds on stand-off brackets, following the curved wall
  for (const z of [-2.0, -0.2]) {
    const wx = (y) => halfWidthAt(z, y, INSET) - 0.075;
    b.pipe([wx(0.95), 0.95, z], [wx(1.65), 1.65, z], 0.016, 'handrail');
    for (const y of [1.0, 1.6]) {
      b.pipe([wx(y), y, z], [halfWidthAt(z, y, INSET) + 0.01, y, z], 0.01, 'steel', 8);
      b.cyl(0.026, 0.026, 0.012, 'steel', [halfWidthAt(z, y, INSET) - 0.004, y, z], [0, 0, Math.PI / 2], 12);
    }
  }
  // status light
  b.sphere(0.04, 'lampRed', [1.6, 2.2, -1.05], 10);
  L.lamps.push({ pos: V(1.6, 2.05, -1.0), color: 0xf2f6ff, intensity: 4.5, room: 'airlock' });
  L.lamps.push({ pos: V(2.3, 1.95, -1.05), color: 0xffa040, intensity: 1.2, room: 'airlock' });
  // tether reel, bolted to the wall
  {
    const xw = halfWidthAt(0.3, 1.0, INSET);
    b.cyl(0.12, 0.12, 0.02, 'metalDark', [xw - 0.01, 1.0, 0.3], [0, 0, Math.PI / 2], 16);
    b.cyl(0.1, 0.1, 0.08, 'plasticY', [xw - 0.06, 1.0, 0.3], [0, 0, Math.PI / 2], 16);
    b.cyl(0.03, 0.03, 0.03, 'steel', [xw - 0.115, 1.0, 0.3], [0, 0, Math.PI / 2], 10);
  }
  // three low steps up to the outer hatch sill, and a sill plate bridging the hatch tunnel
  for (let k = 0; k < 3; k++) {
    const h = 0.11 * (k + 1), x0 = 2.1 + k * 0.22;
    b.box(0.24, h, 0.82, 'metalDark', [x0 + 0.12, h / 2, -1.05], null, 0.008, 2, true);
    b.box(0.03, 0.008, 0.8, 'plasticY', [x0 + 0.015, h + 0.003, -1.05], null, 0.002);
  }
  b.box(0.54, 0.025, 0.78, 'steel', [2.81, 0.318, -1.05], null, 0.005, 2, true);
}

// ------------------------------------------------------------------ life support room
export function buildLifeSupport(b, L) {
  const R = rng(707);
  // CO2 scrubber cabinet
  hullCabinet(b, { side: 1, z0: 1.02, z1: 1.98, yB: 0, yT: 1.75, depth: 0.95, doors: 1, rows: 1, key: 'panel' });
  for (let i = 0; i < 2; i++) {
    b.torus(0.15, 0.015, 'metalDark', [1.84, 1.2 - i * 0.5, 1.5], [0, Math.PI / 2, 0], 20);
  }
  L.spots.fans = [V(1.84, 1.2, 1.5), V(1.84, 0.7, 1.5)];
  // O2 generator: glass column with bubbles (anim) + electrodes
  b.cyl(0.14, 0.14, 0.05, 'steel', [2.3, 0.3, 3.0], null, 20);
  b.cyl(0.14, 0.14, 0.05, 'steel', [2.3, 1.55, 3.0], null, 20);
  b.cyl(0.11, 0.16, 0.28, 'metalDark', [2.3, 0.14, 3.0], null, 24);                    // pedestal (O2 feed inside)
  b.torus(0.16, 0.012, 'steel', [2.3, 0.008, 3.0], [Math.PI / 2, 0, 0], 24);
  L.spots.o2col = V(2.3, 0.925, 3.0);
  b.pipe([2.3, 1.58, 3.0], [2.3, 2.1, 3.0], 0.025, 'pipeWhite');
  // water tank on its skirt (stands on the deck), dished heads, weld bands
  b.cyl(0.3, 0.3, 0.9, 'steel', [2.1, 0.62, 4.6], null, 24, false, true);
  b.sphere(0.3, 'steel', [2.1, 1.07, 4.6], 20, [1, 0.4, 1]);
  b.sphere(0.3, 'steel', [2.1, 0.17, 4.6], 20, [1, 0.3, 1]);
  b.cyl(0.24, 0.27, 0.12, 'metalDark', [2.1, 0.06, 4.6], null, 24);
  b.torus(0.27, 0.012, 'steel', [2.1, 0.012, 4.6], [Math.PI / 2, 0, 0], 24);
  for (const y of [0.36, 0.88]) b.torus(0.302, 0.008, 'metal', [2.1, y, 4.6], [Math.PI / 2, 0, 0], 24);
  b.pipe([2.1, 1.18, 4.6], [2.1, 2.2, 4.6], 0.02, 'pipeBlue');
  gauge(b, [1.78, 0.8, 4.6], [0, -Math.PI / 2, 0], 0.05);
  // ducts to the ceiling
  b.tube([[2.05, 1.7, 1.5], [1.75, 2.02, 1.6], [1.2, 2.3, 2.2], [1.1, 2.35, 4.0]], 0.09, 'insul', { radial: 12 });
  b.torus(0.1, 0.018, 'steel', [2.03, 1.72, 1.5], [Math.PI / 2 + 0.6, 0, 0], 16);
  valveWheel(b, [1.6, 1.0, 3.9], [0, Math.PI / 2, 0], 0.07, 'pipeBlue');
  valveWheel(b, [1.6, 1.2, 2.3], [0, Math.PI / 2, 0], 0.06, 'pipeRed');
  for (let i = 0; i < 4; i++) {
    const x = 2.6 - i * 0.12, z = 2.6 + i * 0.05, r = 0.02 + (i % 2) * 0.01;
    b.pipe([x, -0.05, z], [x, 2.0, z], r, ['pipeBlue', 'pipeWhite', 'pipeGreen', 'pipeRed'][i]);
    b.cyl(r * 2.3, r * 2.6, 0.025, 'steel', [x, 0.012, z], null, 14);                     // deck penetration collar
    b.torus(r * 1.6, r * 0.45, 'steel', [x, 0.05, z], [Math.PI / 2, 0, 0], 14);
    b.cyl(r * 1.5, r * 1.5, 0.04, 'steel', [x, 1.0, z], null, 12);                         // clamp
  }
  b.box(0.06, 0.03, 0.4, 'metalDark', [2.42, 1.0, 2.68], [0, 0.4, 0], 0.008);
  sticker(b, [1.84, 1.55, 1.5], [0, -Math.PI / 2, 0], 0.12, 0.08);
  L.lamps.push({ pos: V(1.6, 2.15, 3.0), color: 0xe9f2ff, intensity: 4.0, room: 'ls' });
  L.lamps.push({ pos: V(2.05, 1.0, 3.0), color: 0x7dffb0, intensity: 1.2, room: 'ls' });
}

// ------------------------------------------------------------------ engineering
export function buildEngineering(b, L) {
  const R = rng(808);
  // server racks (port)
  for (let i = 0; i < 2; i++) {
    const z = 6.15 + i * 0.66;
    b.box(0.6, 1.9, 0.62, 'metalDark', [-1.55, 0.95, z], null, 0.02, 2, true);
    for (let k = 0; k < 12; k++) {
      b.box(0.02, 0.1, 0.56, 'plasticK', [-1.24, 0.25 + k * 0.13, z], null, 0.004);
    }
  }
  L.spots.servers = [V(-1.23, 0.95, 6.15), V(-1.23, 0.95, 6.81)];
  // power distribution panel (starboard)
  const pwr = hullCabinet(b, { side: 1, z0: 5.72, z1: 6.92, yB: 0, yT: 1.8, depth: 0.82, doors: 0, rows: 1, key: 'panel' });
  for (let i = 0; i < 3; i++) { const p = pwr.frontAt(6.32, 0.62 + i * 0.4); switchPanel(b, R, [p.x - 0.012, p.y, p.z], [0, -Math.PI / 2, 0], 8, 3, 0.05); }
  for (const z of [5.98, 6.66]) { const p = pwr.frontAt(z, 1.6); gauge(b, [p.x - 0.015, p.y, p.z], [0, -Math.PI / 2, 0], 0.06); }
  // reactor control console facing the aft viewport
  b.box(1.0, 0.85, 0.45, 'panel', [0.25, 0.42, 8.9], null, 0.03, 2, true);
  b.box(1.05, 0.05, 0.5, 'panelDark', [0.25, 0.87, 8.88], [-0.25, 0, 0], 0.01);
  switchPanel(b, R, [0.05, 0.9, 8.85], [-Math.PI / 2 + 0.25, 0, 0], 6, 2, 0.045);
  monitorSlot(L, 'reactor', V(0.45, 1.12, 9.02), V(0, 0.3, -1).normalize(), V(0, 1, 0.3).normalize(), 0.36, 0.22, 'eng', 384);
  // tool board on the reactor bulkhead, beside the viewport (scaled to fit under the hull curve)
  b.push([-0.9, 1.12, Z_REACTOR_BULK - 0.105], [0, Math.PI, 0], [0.72, 0.72, 0.72]);
  toolWall(b, R, [0, 0, 0], [0, 0, 0]);
  b.pop();
  b.box(0.84, 0.55, 0.012, 'metalDark', [-0.9, 1.12, Z_REACTOR_BULK - 0.093], null, 0.004);
  // floor hatch frame + ladder down
  const hx = (ENG_HATCH.x0 + ENG_HATCH.x1) / 2, hz = (ENG_HATCH.z0 + ENG_HATCH.z1) / 2;
  b.box(ENG_HATCH.x1 - ENG_HATCH.x0 + 0.08, 0.03, 0.04, 'plasticY', [hx, 0.0, ENG_HATCH.z0 - 0.02], null, 0.005);
  b.box(ENG_HATCH.x1 - ENG_HATCH.x0 + 0.08, 0.03, 0.04, 'plasticY', [hx, 0.0, ENG_HATCH.z1 + 0.02], null, 0.005);
  for (const x of [hx - 0.22, hx + 0.22]) b.pipe([x, -1.5, ENG_HATCH.z1 - 0.06], [x, -0.07, ENG_HATCH.z1 - 0.06], 0.018, 'handrail');
  for (let k = 0; k < 5; k++) b.pipe([hx - 0.22, -1.35 + k * 0.29, ENG_HATCH.z1 - 0.06], [hx + 0.22, -1.35 + k * 0.29, ENG_HATCH.z1 - 0.06], 0.014, 'handrail');
  L.interact.push({ id: 'ladder', pos: V(hx, -0.2, hz), r: 0.5, kind: 'ladder' });
  // cable bundles from racks into the floor
  cableBundle(b, [[-1.45, 1.86, 6.4], [-1.25, 2.12, 6.5], [-0.6, 2.32, 6.6], [0.6, 2.3, 6.5], [1.5, 2.0, 6.35], [1.75, 1.74, 6.3]], 5);
  L.lamps.push({ pos: V(0, 2.1, 7.4), color: 0xe8f0ff, intensity: 4.5, room: 'eng' });
  L.lamps.push({ pos: V(0, 1.25, 9.4), color: 0x3d7bff, intensity: 2.5, room: 'eng' });
  L.lamps.push({ pos: V(-1.05, 1.2, 6.5), color: 0x60ffd0, intensity: 1.0, room: 'eng' });   // server LEDs
  L.lamps.push({ pos: V(1.3, 1.9, 6.9), color: 0xffb060, intensity: 1.2, room: 'eng' });
}

export function buildAllRooms(b, L) {
  buildCockpit(b, L);
  buildLiving(b, L);
  buildBath(b, L);
  buildBunk(b, L);
  buildStorage(b, L);
  buildAirlock(b, L);
  buildLifeSupport(b, L);
  buildEngineering(b, L);
}
