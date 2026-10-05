// Inside H8: up from the docking neck through a narrow shaft whose walls are cable trays,
// conduit bundles and junction boxes, through the hatch in the cockpit floor, into a sphere just
// big enough for one: a reclined harness seat with a side-stick and throttle, a low console with
// three small displays and banks of switches, and above everything the wrap-around display that
// shows the outside. Everything below the display band is equipment: racks of processors with
// rows of blinking status lights behind grilles, cable looms in clamps, coolant lines, fans, the
// HACHI core over the hatch. H8-local coordinates.
import * as THREE from 'three';
import { Builder, rng } from '../ship/geom.js';
import { H8 } from './h8Spec.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function createH8InteriorMaterials(M) {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  // cockpit lining in the B-29 family: warm grey padded panels, gunmetal frames, orange accents
  M.pad = S({ color: 0x5d6570, roughness: 0.85, metalness: 0.02 });
  M.padDark = S({ color: 0x31363d, roughness: 0.82, metalness: 0.05 });
  M.panelIn = S({ color: 0x9aa1a8, roughness: 0.55, metalness: 0.25 });
  M.panelInDark = S({ color: 0x24282d, roughness: 0.5, metalness: 0.45 });
  M.frameIn = S({ color: 0x3a3f46, roughness: 0.4, metalness: 0.8 });
  M.grille = S({ color: 0x15171a, roughness: 0.6, metalness: 0.6, side: THREE.DoubleSide });
  M.rack = S({ color: 0x2b2f35, roughness: 0.45, metalness: 0.7 });
  M.blade = S({ color: 0x3d434b, roughness: 0.4, metalness: 0.6 });
  M.seatShell = S({ color: 0x2a2d31, roughness: 0.45, metalness: 0.35 });
  M.seatCushion = S({ color: 0x3c4148, roughness: 0.92, metalness: 0 });
  M.harness = S({ color: 0xc8611c, roughness: 0.75, metalness: 0 });
  M.buckle = S({ color: 0xb9bec4, roughness: 0.25, metalness: 0.95 });
  M.switchBody = S({ color: 0x15161a, roughness: 0.5, metalness: 0.2 });
  M.switchLever = S({ color: 0xc9ced4, roughness: 0.3, metalness: 0.9 });
  M.knob = S({ color: 0x1a1b1e, roughness: 0.4, metalness: 0.3 });
  M.keycap = S({ color: 0x2b2e33, roughness: 0.7, metalness: 0.05 });
  M.coolant = S({ color: 0x2a5d8f, roughness: 0.4, metalness: 0.4 });
  M.hose = S({ color: 0x232527, roughness: 0.8, metalness: 0.05 });
  M.fan = S({ color: 0x0f1012, roughness: 0.5, metalness: 0.3 });
  M.core = S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.55, 0.15), emissiveIntensity: 2.2 });
  M.coreGlass = new THREE.MeshPhysicalMaterial({ color: 0x1a1208, roughness: 0.05, transparent: true, opacity: 0.35, clearcoat: 1 });
  M.amberLamp = S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.62, 0.25), emissiveIntensity: 1.6 });
  M.labelIn = S({ color: 0xd9d4c4, roughness: 0.7 });
  M.yellowBlack = S({ color: 0xe0b81e, roughness: 0.6 });
  return M;
}

/** point on the cockpit sphere (around C) at azimuth az (0 = forward, + = starboard), elevation el */
export function onCockpit(az, el, r = H8.cockpitR) {
  const C = H8.cockpitC;
  return V(C.x + Math.sin(az) * Math.cos(el) * r, C.y + Math.sin(el) * r, C.z - Math.cos(az) * Math.cos(el) * r);
}

/** the wrap-around display region: everything above el -0.36 rad, except the area behind the seat
 * low down (hatch, HACHI core) */
export function isDisplay(az, el) {
  if (el < -0.36) return false;
  const back = Math.abs(Math.abs(az) - Math.PI);
  if (back < 0.62 && el < 0.32) return false;
  return true;
}

/**
 * Build the interior. Returns { group, colliders, lamps, seat, mfd (monitor slots), leds (instanced
 * mesh with per-instance blink data), fans (rotors), core, hatch }.
 */
export function buildH8Interior(M) {
  const b = new Builder();
  const R = rng(88);
  const C = H8.cockpitC, RC = H8.cockpitR;
  const lamps = [];
  const lamp = (p, color, intensity, range) => lamps.push({ pos: p.clone(), color, intensity, range, room: 'h8' });
  const ledList = [];   // {p, n, color}
  const fans = [];

  // ============================================================ the access shaft
  const sz = H8.shaftZ, sr = H8.shaftR;
  const yBot = H8.neckBottom + 0.24, yTop = H8.floorY;
  {
    // lining: segmented tube (inward-facing), cable trays on three sides, a ladder on the fourth
    const rings = (r) => { const pts = []; for (let i = 0; i <= 32; i++) { const a = i / 32 * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); } return pts; };
    const tube = new THREE.CylinderGeometry(sr, sr, yTop - yBot, 40, 6, true);
    tube.scale(-1, 1, 1);      // faces inward
    b.add(tube, 'panelInDark', [0, (yTop + yBot) / 2, sz]);
    // ribs every 0.45 m
    for (let y = yBot + 0.2; y < yTop; y += 0.45) b.torus(sr - 0.02, 0.022, 'frameIn', [0, y, sz], [Math.PI / 2, 0, 0], 40);
    // ladder rungs on the forward wall
    for (let y = yBot + 0.3; y < yTop - 0.1; y += 0.32) {
      b.pipe(V(-0.17, y, sz - sr + 0.09), V(0.17, y, sz - sr + 0.09), 0.016, 'switchLever', 8);
      for (const x of [-0.17, 0.17]) b.pipe(V(x, y, sz - sr + 0.09), V(x, y, sz - sr + 0.01), 0.012, 'frameIn', 6);
    }
    // cable trays: vertical bundles in the three other quadrants, clamped
    for (const a of [Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
      const cx = Math.sin(a) * (sr - 0.07), cz = sz - Math.cos(a) * (sr - 0.07);
      b.box(0.16, yTop - yBot - 0.1, 0.03, 'grille', [cx, (yTop + yBot) / 2, cz], [0, a, 0], 0.005);
      for (let k = 0; k < 5; k++) {
        const off = (k - 2) * 0.026;
        const key = ['cable', 'cableOrange', 'cable', 'cableRed', 'cable'][k];
        b.pipe(V(cx + Math.cos(a) * off, yBot + 0.05, cz + Math.sin(a) * off), V(cx + Math.cos(a) * off, yTop - 0.05, cz + Math.sin(a) * off), 0.011, key, 6);
      }
      for (let y = yBot + 0.35; y < yTop; y += 0.45) b.box(0.17, 0.025, 0.05, 'frameIn', [cx, y, cz], [0, a, 0], 0.005);
    }
    // junction boxes, an O2 bottle, a pressure gauge, LED strip
    b.box(0.12, 0.16, 0.06, 'panelIn', [sr - 0.08, yBot + 1.1, sz + 0.1], [0, -Math.PI / 2, 0], 0.01);
    b.cyl(0.05, 0.05, 0.36, 'trim', [-sr + 0.07, yBot + 1.6, sz + 0.12], null, 16);
    b.sphere(0.05, 'trim', [-sr + 0.07, yBot + 1.78, sz + 0.12], 12);
    b.cyl(0.04, 0.04, 0.012, 'steel', [sr - 0.035, yBot + 2.1, sz - 0.12], [0, 0, Math.PI / 2], 16);
    for (let y = yBot + 0.2; y < yTop - 0.1; y += 0.12) ledList.push({ p: V(sr - 0.05, y, sz + 0.2), color: 0 });
    // a hatch rim at the bottom (H8's own hatch) and at the cockpit floor
    b.torus(sr + 0.01, 0.035, 'trim', [0, yBot + 0.02, sz], [Math.PI / 2, 0, 0], 40);
    b.torus(sr + 0.02, 0.04, 'frameIn', [0, yTop - 0.02, sz], [Math.PI / 2, 0, 0], 40);
    lamp(V(0, (yTop + yBot) / 2, sz + 0.2), 0xffd6a8, 0.9, 3.5);
    // colliders: the shaft wall
    const ring = []; for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; ring.push(a); }
    for (const a of ring) b.colBox(0.18, yTop - yBot, 0.05, [Math.sin(a) * (sr + 0.03), (yTop + yBot) / 2, sz - Math.cos(a) * (sr + 0.03)], [0, a, 0]);
  }

  // ============================================================ the cockpit
  // floor: a small deck with the hatch ring behind the seat
  {
    const fr = Math.sqrt(RC * RC - (C.y - H8.floorY) ** 2);
    const sh = new THREE.Shape();
    sh.absarc(0, 0, fr, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, -(sz - C.z), sr, 0, Math.PI * 2, true);
    sh.holes.push(hole);
    const g = new THREE.ShapeGeometry(sh, 48);
    g.rotateX(-Math.PI / 2);
    b.add(g, 'grille', [C.x, H8.floorY, C.z]);
    // tread plates and the orange hatch ring
    for (let k = 0; k < 6; k++) b.box(0.6, 0.012, 0.06, 'frameIn', [0, H8.floorY + 0.006, C.z - 0.85 + k * 0.1], null, 0.004);
    b.torus(sr + 0.03, 0.03, 'trim', [0, H8.floorY + 0.01, sz], [Math.PI / 2, 0, 0], 40);
    // floor collider with the hatch opening (four boxes round it)
    b.colBox(fr * 2, 0.06, (sz - sr) - (C.z - fr), [0, H8.floorY - 0.03, (C.z - fr + sz - sr) / 2]);
    b.colBox(fr * 2, 0.06, (C.z + fr) - (sz + sr), [0, H8.floorY - 0.03, (sz + sr + C.z + fr) / 2]);
    for (const s of [-1, 1]) b.colBox(fr - sr, 0.06, sr * 2, [s * (sr + (fr - sr) / 2), H8.floorY - 0.03, sz]);
  }
  // the shell below the display (and the wall behind the seat): equipment panels with grilles,
  // lit racks behind them; a dark equipment layer behind it all closes the gaps
  {
    const N = 36, ROW = 0.17;
    const frame = (az, el) => {
      const X = V(Math.cos(az), 0, Math.sin(az));
      const Y = V(-Math.sin(az) * Math.sin(el), Math.cos(el), Math.cos(az) * Math.sin(el));
      const Z = new THREE.Vector3().crossVectors(X, Y);
      const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z), 'YXZ');
      return { X, Y, Z, e: [e.x, e.y, e.z] };
    };
    for (let i = 0; i < N; i++) {
      const az = -Math.PI + (i + 0.5) / N * Math.PI * 2;
      for (let j = 0; j < 9; j++) {
        const el = 0.32 - (j + 0.5) * ROW;
        if (isDisplay(az, el)) continue;
        const p = onCockpit(az, el, RC);
        if (p.y < H8.floorY + 0.04) continue;
        const n = p.clone().sub(C).normalize();
        const f = frame(az, el);
        const w = 2 * Math.PI * RC * Math.cos(el) / N - 0.016, h = ROW * RC - 0.016;
        const kind = (i * 7 + j * 3) % 5;
        b.box(w, h, 0.02, kind === 0 ? 'grille' : kind === 1 ? 'panelInDark' : 'panelIn', p.toArray(), f.e, 0.004);
        if (kind === 0) {
          // behind a grille: a rack with blades and status lights
          const pr = p.clone().addScaledVector(n, 0.12);
          b.box(w * 0.9, h * 0.85, 0.2, 'rack', pr.toArray(), f.e, 0.01);
          for (let k = 0; k < 4; k++) ledList.push({ p: p.clone().addScaledVector(n, 0.025).addScaledVector(f.X, (R() - 0.5) * w * 0.7).addScaledVector(f.Y, (R() - 0.5) * h * 0.6), color: (k + i) % 3 });
        } else if (kind === 2) {
          // a breaker / switch strip on the panel
          for (let k = 0; k < 5; k++) {
            const sp = p.clone().addScaledVector(n, -0.02).addScaledVector(f.X, (k - 2) * w * 0.17);
            b.box(0.022, 0.034, 0.02, 'switchBody', sp.toArray(), f.e, 0.003);
            ledList.push({ p: sp.clone().addScaledVector(f.Y, 0.03).addScaledVector(n, -0.012), color: 1 });
          }
        } else if (kind === 3 && R() < 0.5) {
          // a labelled cover with four screws
          b.box(w * 0.5, h * 0.3, 0.006, 'labelIn', p.clone().addScaledVector(n, -0.013).toArray(), f.e, 0.002);
          for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.cyl(0.006, 0.006, 0.006, 'buckle', p.clone().addScaledVector(n, -0.012).addScaledVector(f.X, sx * w * 0.42).addScaledVector(f.Y, sy * h * 0.38).toArray(), [f.e[0] + Math.PI / 2, f.e[1], f.e[2]], 6);
        }
      }
    }
    // the dark equipment layer behind the panels (seen only through the gaps and grilles)
    const pos = [], idx = [];
    const NA = 72, NE = 20, e0 = -1.32, e1 = 0.34;
    for (let jj = 0; jj <= NE; jj++) for (let ii = 0; ii <= NA; ii++) {
      const az = -Math.PI + ii / NA * Math.PI * 2, el = e0 + (e1 - e0) * jj / NE;
      const p = onCockpit(az, el, RC + 0.42);
      pos.push(p.x, p.y, p.z);
    }
    for (let jj = 0; jj < NE; jj++) for (let ii = 0; ii < NA; ii++) {
      const az = -Math.PI + (ii + 0.5) / NA * Math.PI * 2, el = e0 + (e1 - e0) * (jj + 0.5) / NE;
      if (isDisplay(az, el + 0.04)) continue;
      const a = jj * (NA + 1) + ii, b2 = a + 1, c = a + NA + 1, d = c + 1;
      idx.push(a, b2, c, b2, d, c);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.setIndex(idx);
    sg.computeVertexNormals();
    b.add(sg, 'rack');
    // the racks inside the equipment layer, seen through the grilles (rows of blades)
    for (let i = 0; i < 18; i++) {
      const az = -Math.PI + (i + 0.5) / 18 * Math.PI * 2;
      if (Math.abs(Math.abs(az) - Math.PI) < 0.5) continue;
      for (const el of [-0.62, -0.85]) {
        const p = onCockpit(az, el, RC + 0.34);
        if (p.y < H8.floorY - 0.3) continue;
        const f = frame(az, el);
        for (let k = 0; k < 6; k++) b.box(0.035, 0.22, 0.32, 'blade', p.clone().addScaledVector(f.X, (k - 2.5) * 0.045).toArray(), f.e, 0.004);
      }
    }
    // band frames: the display's lower edge ring and the ring between the panel rows
    for (const el of [-0.36, -0.53, -0.70]) {
      const r = RC * Math.cos(el) - 0.01, y = C.y + Math.sin(el) * RC;
      b.torus(r, 0.022, 'frameIn', [C.x, y, C.z], [Math.PI / 2, 0, 0], 72);
    }
    // cable looms sweeping round under the display edge, clamped
    for (const [el, key, rr] of [[-0.42, 'cable', 0.03], [-0.46, 'cableOrange', 0.022], [-0.5, 'cableRed', 0.018]]) {
      const pts = [];
      for (let k = 0; k <= 40; k++) {
        const az = -2.45 + k / 40 * 4.9;
        pts.push(onCockpit(az, el, RC - 0.05 - rr));
      }
      b.tube(pts, rr, key, { radial: 8, seg: 160 });
    }
    for (let k = 0; k < 14; k++) { const az = -2.4 + k / 13 * 4.8; const p = onCockpit(az, -0.46, RC - 0.07); b.box(0.05, 0.1, 0.03, 'frameIn', p.toArray(), [0, -az, 0], 0.006); }
    // coolant lines (blue insulated) down both sides, with valves
    for (const s of [-1, 1]) {
      const pts = [onCockpit(s * 1.2, -0.38, RC - 0.08), onCockpit(s * 1.35, -0.7, RC - 0.08), onCockpit(s * 1.5, -0.95, RC - 0.06)];
      b.tube(pts, 0.03, 'coolant', { radial: 10 });
      const vp = onCockpit(s * 1.3, -0.62, RC - 0.12);
      b.cyl(0.04, 0.04, 0.08, 'steel', vp.toArray(), [0, 0, Math.PI / 2], 12);
      b.cyl(0.05, 0.05, 0.012, 'trim', vp.clone().add(V(0, 0.05, 0)).toArray(), null, 12);
    }
    // two cooling fans in the side panels
    for (const s of [-1, 1]) {
      const p = onCockpit(s * 1.75, -0.5, RC - 0.04);
      b.cyl(0.11, 0.11, 0.04, 'grille', p.toArray(), [0, 0, Math.PI / 2], 24);
      fans.push({ pos: onCockpit(s * 1.75, -0.5, RC - 0.02), axis: p.clone().sub(C).normalize() });
    }
  }
  // the HACHI core above the hatch (behind the seat): an octagonal glowing module
  const coreAt = onCockpit(Math.PI, 0.05, RC - 0.12);
  {
    const n = coreAt.clone().sub(C).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n.clone().negate());
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    b.cyl(0.24, 0.26, 0.1, 'rack', coreAt.toArray(), [e.x, e.y, e.z], 8);
    b.cyl(0.17, 0.17, 0.11, 'core', coreAt.toArray(), [e.x, e.y, e.z], 8);
    b.cyl(0.2, 0.2, 0.12, 'coreGlass', coreAt.toArray(), [e.x, e.y, e.z], 8);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; ledList.push({ p: coreAt.clone().add(V(Math.cos(a) * 0.25, Math.sin(a) * 0.25, 0.04)), color: 2 }); }
    // the rear wall round it: emergency kit, extinguisher, a rescue handle
    const kit = onCockpit(Math.PI - 0.45, -0.25, RC - 0.12);
    b.box(0.22, 0.16, 0.1, 'trim', kit.toArray(), [0, Math.PI - 0.45, 0], 0.02);
    const ext = onCockpit(Math.PI + 0.45, -0.25, RC - 0.12);
    b.cyl(0.05, 0.05, 0.3, 'cableRed', ext.toArray(), null, 16);
    b.cyl(0.02, 0.025, 0.05, 'frameIn', ext.clone().add(V(0, 0.17, 0)).toArray(), null, 10);
    const rh = onCockpit(Math.PI, -0.2, RC - 0.06);
    b.box(0.2, 0.04, 0.04, 'yellowBlack', rh.toArray(), null, 0.01);
  }

  // ============================================================ the seat
  // reclined harness seat on a pedestal; the eye sits near the sphere's centre
  // the eye sits just in front of the headrest of the reclined seat (see below)
  const SEAT_BACK = 0.36;
  const seatPanY = C.y + 0.12 - 0.68, seatPanZ = C.z - 0.12;
  const headPad = V(0, 0.84, -0.1).applyAxisAngle(V(1, 0, 0), SEAT_BACK).add(V(0, seatPanY + 0.04, seatPanZ + 0.24));
  const seatEye = V(C.x, headPad.y - 0.03, headPad.z - 0.13);
  const S0 = V(0, H8.floorY, C.z - 0.05);   // pedestal foot: the seat turns round its column (360°)
  const sb = new Builder();                   // the turning part
  {
    b.box(0.3, 0.22, 0.34, 'frameIn', [S0.x, S0.y + 0.11, S0.z], null, 0.04);
    b.cyl(0.07, 0.08, 0.12, 'steel', [S0.x, S0.y + 0.27, S0.z], null, 16);
    for (const s of [-1, 1]) b.box(0.03, 0.03, 0.6, 'steel', [s * 0.12, S0.y + 0.03, S0.z - 0.1], null, 0.005);   // seat rails
    // the swivel bearing: a ring with an index scale and the lock lever
    sb.torus(0.105, 0.016, 'steel', [S0.x, S0.y + 0.34, S0.z], [Math.PI / 2, 0, 0], 32);
    sb.cyl(0.1, 0.1, 0.03, 'frameIn', [S0.x, S0.y + 0.355, S0.z], null, 24);
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; b.box(0.004, 0.012, k % 6 ? 0.012 : 0.022, 'switchLever', [S0.x + Math.sin(a) * 0.092, S0.y + 0.335, S0.z - Math.cos(a) * 0.092], [0, -a, 0], 0.001); }
    sb.pipe(V(S0.x + 0.1, S0.y + 0.36, S0.z - 0.02), V(S0.x + 0.2, S0.y + 0.33, S0.z - 0.1), 0.008, 'switchLever', 8);
    sb.sphere(0.018, 'harness', [S0.x + 0.2, S0.y + 0.33, S0.z - 0.1], 10);
    // shell: pan, back (reclined 22 degrees), headrest, side bolsters
    const panY = seatPanY, back = SEAT_BACK;     // reclined backwards
    sb.cyl(0.09, 0.07, Math.max(0.05, panY - 0.06 - (S0.y + 0.37)), 'frameIn', [S0.x, (panY - 0.06 + S0.y + 0.37) / 2, S0.z], null, 16);
    sb.push([0, panY, seatPanZ]);
    sb.box(0.52, 0.08, 0.5, 'seatShell', [0, 0, 0], null, 0.03);
    sb.box(0.46, 0.07, 0.46, 'seatCushion', [0, 0.06, -0.01], null, 0.03);
    for (const s of [-1, 1]) sb.box(0.07, 0.14, 0.46, 'seatCushion', [s * 0.23, 0.1, 0], [0, 0, s * 0.25], 0.03);
    sb.push([0, 0.04, 0.24], [back, 0, 0]);
    sb.box(0.52, 0.74, 0.08, 'seatShell', [0, 0.37, 0], null, 0.03);
    sb.box(0.44, 0.68, 0.07, 'seatCushion', [0, 0.37, -0.06], null, 0.03);
    for (let k = 0; k < 5; k++) sb.box(0.4, 0.008, 0.012, 'padDark', [0, 0.12 + k * 0.12, -0.096], null, 0.003);   // quilting
    for (const s of [-1, 1]) sb.box(0.08, 0.6, 0.13, 'seatCushion', [s * 0.25, 0.36, -0.03], [0, s * 0.3, 0], 0.03);
    sb.box(0.3, 0.2, 0.12, 'seatShell', [0, 0.84, 0.0], null, 0.04);              // headrest
    sb.box(0.26, 0.16, 0.06, 'seatCushion', [0, 0.84, -0.07], null, 0.025);
    for (const s of [-1, 1]) sb.cyl(0.035, 0.035, 0.02, 'switchBody', [s * 0.16, 0.86, -0.04], [0, 0, Math.PI / 2], 12);   // headrest speakers
    // harness: two shoulder straps, lap belt, rotary buckle
    for (const s of [-1, 1]) sb.tube([V(s * 0.1, 0.72, -0.11), V(s * 0.09, 0.5, -0.17), V(s * 0.05, 0.22, -0.2), V(0, 0.08, -0.22)], 0.012, 'harness', { radial: 4 });
    sb.pop();
    for (const s of [-1, 1]) sb.tube([V(s * 0.22, 0.08, 0.05), V(s * 0.14, 0.12, -0.1), V(0, 0.12, -0.18)], 0.012, 'harness', { radial: 4 });
    sb.cyl(0.045, 0.045, 0.02, 'buckle', [0, 0.13, -0.19], [Math.PI / 2 - 0.3, 0, 0], 20);
    // armrests with the side-stick (right) and the throttle (left)
    for (const s of [-1, 1]) sb.box(0.08, 0.06, 0.36, 'seatShell', [s * 0.31, 0.24, -0.05], null, 0.02);
    // (they are on the seat, so they turn with it)
    sb.cyl(0.026, 0.03, 0.022, 'frameIn', [0.31, 0.281, -0.17], null, 16);
    sb.cyl(0.03, 0.03, 0.012, 'rubber', [0.31, 0.296, -0.17], null, 16);
    sb.push([0.31, 0.3, -0.17], [-0.16, 0, 0]);
    sb.cyl(0.016, 0.019, 0.1, 'padDark', [0, 0.05, 0], null, 12);
    sb.sphere(0.022, 'padDark', [0, 0.105, -0.004], 12, [1, 0.8, 1.15]);
    sb.box(0.012, 0.022, 0.012, 'switchLever', [0, 0.085, -0.024], [0.4, 0, 0], 0.003);       // trigger
    sb.cyl(0.006, 0.006, 0.008, 'harness', [0, 0.126, -0.004], null, 8);                      // hat button
    sb.pop();
    sb.box(0.055, 0.03, 0.13, 'frameIn', [-0.31, 0.285, -0.14], null, 0.006);                // throttle quadrant
    sb.push([-0.31, 0.3, -0.15], [0.35, 0, 0]);
    sb.box(0.016, 0.075, 0.016, 'steel', [0, 0.035, 0], null, 0.003);
    sb.box(0.045, 0.028, 0.05, 'padDark', [0, 0.078, 0], null, 0.008);
    sb.box(0.01, 0.006, 0.01, 'harness', [0.012, 0.094, -0.012], null, 0.002);
    sb.pop();
    sb.pop();
  }
  // seat collider (so Kaito does not walk through it)
  b.colBox(0.52, 0.5, 0.5, [0, seatPanY - 0.07, seatPanZ]);

  // ============================================================ the console in front
  {
    // a low curved desk under the display edge: faceplate, three small displays, switch banks
    const az0 = -0.85, az1 = 0.85, el = -0.48;
    const pts = [];
    for (let k = 0; k <= 16; k++) pts.push(onCockpit(az0 + (az1 - az0) * k / 16, el, RC - 0.2));
    for (let k = 0; k < 16; k++) {
      const a = pts[k], c = pts[k + 1], m = a.clone().lerp(c, 0.5);
      const az = az0 + (az1 - az0) * (k + 0.5) / 16;
      b.box(a.distanceTo(c) + 0.004, 0.05, 0.42, 'panelInDark', m.toArray(), [-0.5, -az, 0], 0.008);
      // switch row on the faceplate
      for (let s = 0; s < 3; s++) {
        const sp = m.clone().add(V(Math.sin(az) * (-0.1 + s * 0.1) * 0, 0.03, 0)).addScaledVector(V(-Math.sin(az), 0, Math.cos(az)), -0.08 + s * 0.08);
        b.box(0.018, 0.012, 0.03, 'switchBody', sp.toArray(), [-0.5, -az, 0], 0.003);
        b.box(0.006, 0.006, 0.026, 'switchLever', sp.clone().add(V(0, 0.012, 0)).toArray(), [-0.5 + (R() < 0.5 ? 0.4 : -0.4), -az, 0], 0.002);
        ledList.push({ p: sp.clone().add(V(0, 0.015, 0)).addScaledVector(V(Math.sin(az), 0, -Math.cos(az)), 0.03), color: (k + s) % 3 });
      }
    }
    b.colBox(1.6, 0.14, 0.42, [0, onCockpit(0, el, RC).y, C.z - RC + 0.32]);
    // keyboard tray under the middle display, rotary knobs
    const kb = onCockpit(0, -0.6, RC - 0.42);
    b.box(0.36, 0.02, 0.14, 'panelInDark', kb.toArray(), [-0.25, 0, 0], 0.006);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++) b.box(0.022, 0.008, 0.022, 'keycap', [kb.x - 0.15 + c * 0.027, kb.y + 0.014 - r * 0.0065, kb.z - 0.045 + r * 0.027], [-0.25, 0, 0], 0.002);
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
      const kp = onCockpit(s * (0.55 + k * 0.1), -0.5, RC - 0.27);
      b.cyl(0.018, 0.02, 0.025, 'knob', kp.toArray(), null, 16);
    }
  }
  // MFD slots (three small displays on the console, angled to the eye)
  const mfd = [];
  for (const [id, az] of [['h8sys', -0.48], ['h8nav', 0], ['h8cam', 0.48]]) {
    const p = onCockpit(az, -0.3, RC - 0.3);
    const n = seatEye.clone().sub(p).normalize();
    mfd.push({ id, pos: p, n, up: V(0, 1, 0), w: 0.28, h: 0.17, res: 512 });
    // housing behind each display
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    b.box(0.31, 0.2, 0.05, 'frameIn', p.clone().addScaledVector(n, -0.03).toArray(), [e.x, e.y, e.z], 0.01);
    b.box(0.04, 0.12, 0.04, 'frameIn', p.clone().addScaledVector(n, -0.06).add(V(0, -0.12, 0)).toArray(), null, 0.008);
  }
  // side consoles: switch banks either side of the seat
  for (const s of [-1, 1]) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
      const p = onCockpit(s * (1.15 + c * 0.075), -0.42 - r * 0.07, RC - 0.04);
      b.box(0.02, 0.03, 0.025, 'switchBody', p.toArray(), [0, -s * (1.15 + c * 0.075), 0], 0.003);
      ledList.push({ p: p.clone().add(V(0, 0.026, 0)), color: (r + c) % 3 });
    }
  }

  // ============================================================ the display shell frame
  // thin bezels between the display panels (the display itself is its own mesh)
  {
    for (let k = 0; k < 12; k++) {
      const az = k / 12 * Math.PI * 2;
      const pts = [];
      for (let e = -0.36; e <= 1.45; e += 0.08) if (isDisplay(az, e)) pts.push(onCockpit(az, e, RC + 0.012));
      if (pts.length > 2) b.tube(pts, 0.006, 'panelInDark', { radial: 4 });
    }
    for (const e of [0.25, 0.75]) {
      const pts = [];
      for (let a = -Math.PI; a <= Math.PI + 0.01; a += 0.08) if (isDisplay(a, e)) pts.push(onCockpit(a, e, RC + 0.012));
      if (pts.length > 2) b.tube(pts, 0.006, 'panelInDark', { radial: 4 });
    }
  }
  // cockpit shell collider: rings of boxes (so the camera / Kaito stay inside)
  for (let i = 0; i < 16; i++) for (let j = 0; j < 8; j++) {
    const az = i / 16 * Math.PI * 2, el = -0.55 + j / 7 * 2.0;
    const p = onCockpit(az, el, RC + 0.08);
    if (p.y < H8.floorY) continue;
    const n = p.clone().sub(C).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    b.colBox(0.62, 0.4, 0.1, p.toArray(), [e.x, e.y, e.z]);
  }

  // lamps: soft amber footwell lights, a cool light from above
  lamp(V(0, H8.floorY + 0.25, C.z - 0.4), 0xffb070, 0.8, 2.5);
  lamp(V(0, C.y + 0.9, C.z + 0.1), 0xcfe2ff, 0.7, 3.2);
  lamp(coreAt.clone().add(V(0, 0, -0.2)), 0xff9a40, 0.6, 2.0);

  const group = b.build(M, { castShadow: false });
  group.name = 'h8Interior';
  // status LEDs (instanced: per-instance colour, blinked by the controller)
  const ledGeo = new THREE.SphereGeometry(0.006, 6, 4);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const leds = new THREE.InstancedMesh(ledGeo, ledMat, ledList.length);
  const PAL = [new THREE.Color(0.3, 2.2, 0.5), new THREE.Color(2.4, 1.2, 0.2), new THREE.Color(0.4, 1.0, 2.4)];
  const m = new THREE.Matrix4();
  ledList.forEach((l, i) => { m.makeTranslation(l.p.x, l.p.y, l.p.z); leds.setMatrixAt(i, m); leds.setColorAt(i, PAL[l.color]); });
  leds.instanceMatrix.needsUpdate = true;
  leds.instanceColor.needsUpdate = true;
  leds.userData = { base: ledList.map((l) => PAL[l.color].clone()), rate: ledList.map(() => 0.3 + R() * 3) };
  group.add(leds);
  // fan rotors
  const rotors = fans.map((f) => {
    const rg = new THREE.Group();
    for (let k = 0; k < 7; k++) { const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.004, 0.03), M.fan); blade.position.set(0.045, 0, 0); const h = new THREE.Group(); h.rotation.y = k / 7 * Math.PI * 2; blade.rotation.x = 0.4; h.add(blade); rg.add(h); }
    rg.position.copy(f.pos);
    rg.quaternion.setFromUnitVectors(V(0, 1, 0), f.axis);
    group.add(rg);
    return rg;
  });
  // the turning seat on its column (pivot on the column's axis)
  const seatPivot = new THREE.Group();
  seatPivot.name = 'h8Seat';
  seatPivot.position.set(S0.x, 0, S0.z);
  const seatMesh = sb.build(M, { castShadow: false });
  seatMesh.position.set(-S0.x, 0, -S0.z);
  seatPivot.add(seatMesh);
  group.add(seatPivot);
  // the seat (for the seat system): eye, forward, exit point; it swivels round its column
  const seat = { id: 'h8pilot', kind: 'pilot', eye: seatEye, fwd: V(0, -0.08, -1).normalize(), exit: V(0, H8.floorY, sz - 0.05), h8: true, swivel: true, axis: V(S0.x, 0, S0.z), yawSeat: 0 };
  return { group, colliders: b.colliders, lamps, seat, mfd, leds, rotors, coreAt, seatPivot };
}

/**
 * The wrap-around display surface (inside of the cockpit sphere where isDisplay) as one mesh.
 * uv = (azimuth, elevation) normalised for the overlay.
 */
export function displayGeometry() {
  const pos = [], uv = [], idx = [];
  const NA = 96, NE = 36, e0 = -0.36, e1 = Math.PI / 2;
  const grid = [];
  for (let j = 0; j <= NE; j++) {
    const row = [];
    const el = e0 + (e1 - e0) * j / NE;
    for (let i = 0; i <= NA; i++) {
      const az = -Math.PI + i / NA * Math.PI * 2;
      const p = onCockpit(az, el, H8.cockpitR);
      row.push(pos.length / 3);
      pos.push(p.x, p.y, p.z);
      uv.push(i / NA, (el + Math.PI / 2) / Math.PI);
    }
    grid.push(row);
  }
  for (let j = 0; j < NE; j++) for (let i = 0; i < NA; i++) {
    const az = -Math.PI + (i + 0.5) / NA * Math.PI * 2, el = e0 + (e1 - e0) * (j + 0.5) / NE;
    if (!isDisplay(az, el)) continue;
    const a = grid[j][i], b2 = grid[j][i + 1], c = grid[j + 1][i], d = grid[j + 1][i + 1];
    // facing the centre
    idx.push(a, b2, c, b2, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
