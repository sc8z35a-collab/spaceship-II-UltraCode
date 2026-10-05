// Inside H8: up from the docking neck through a narrow shaft whose walls are cable trays,
// conduit bundles and junction boxes, through the hatch in the cockpit floor, into a sphere just
// big enough for one — and that sphere is all display: the walls, the ceiling and the floor under
// Kaito's feet (a sheet of display glass on a thin rim; the floor hatch is a disc of the same glass
// that slides away under it). In the middle, on a gimbal, one smooth seat (h8Seat.js). Behind a
// section of the display on the port side, a locker with the compact suit: the panel slides
// aside and the suit comes out on its rail. Everything else — the computers, the wiring, the
// cooling — lives behind the display, out of sight. H8-local coordinates.
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';
import { H8 } from './h8Spec.js';
import { buildSeat, seatMaterials, SEAT } from './h8Seat.js';
import { FLOOR } from './h8Display.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function createH8InteriorMaterials(M) {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  // the shaft in the B-29 family: warm grey padded panels, gunmetal frames, orange accents
  M.pad = S({ color: 0x5d6570, roughness: 0.85, metalness: 0.02 });
  M.padDark = S({ color: 0x31363d, roughness: 0.82, metalness: 0.05 });
  M.panelIn = S({ color: 0x9aa1a8, roughness: 0.55, metalness: 0.25 });
  M.panelInDark = S({ color: 0x24282d, roughness: 0.5, metalness: 0.45 });
  M.frameIn = S({ color: 0x3a3f46, roughness: 0.4, metalness: 0.8 });
  M.grille = S({ color: 0x15171a, roughness: 0.6, metalness: 0.6, side: THREE.DoubleSide });
  M.rack = S({ color: 0x2b2f35, roughness: 0.45, metalness: 0.7 });
  M.harness = S({ color: 0xc8611c, roughness: 0.75, metalness: 0 });
  M.buckle = S({ color: 0xb9bec4, roughness: 0.25, metalness: 0.95 });
  M.switchLever = S({ color: 0xc9ced4, roughness: 0.3, metalness: 0.9 });
  M.amberLamp = S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.62, 0.25), emissiveIntensity: 1.6 });
  M.labelIn = S({ color: 0xd9d4c4, roughness: 0.7 });
  M.lockerLight = S({ color: 0x000000, emissive: new THREE.Color(0.75, 0.88, 1.0), emissiveIntensity: 0 });
  // the compact suit
  M.suitWhite = S({ color: 0xe9e6df, roughness: 0.78, metalness: 0 });
  M.suitOrange = S({ color: 0xd8671f, roughness: 0.7, metalness: 0 });
  M.suitGrey = S({ color: 0x5b6067, roughness: 0.6, metalness: 0.25 });
  M.visor = S({ color: 0x5a4416, roughness: 0.08, metalness: 1.0 });
  seatMaterials(M);
  return M;
}

/** point on the cockpit sphere (around C) at azimuth az (0 = forward, + = starboard), elevation el */
export function onCockpit(az, el, r = H8.cockpitR) {
  const C = H8.cockpitC;
  return V(C.x + Math.sin(az) * Math.cos(el) * r, C.y + Math.sin(el) * r, C.z - Math.cos(az) * Math.cos(el) * r);
}

/** the compact suit, folded on its hanger (local: -z toward the cockpit, +y up), ~0.85 m tall */
function suitModel(M) {
  const b = new Builder();
  // helmet: shell, gold visor, lamps
  b.sphere(0.13, 'suitWhite', [0, 0.66, 0], 20);
  b.sphere(0.112, 'visor', [0, 0.655, -0.03], 20, [1, 0.86, 0.9]);
  for (const s of [-1, 1]) b.cyl(0.018, 0.018, 0.03, 'lockerLight', [s * 0.1, 0.72, -0.06], [Math.PI / 2, 0, 0], 10);
  b.torus(0.105, 0.018, 'suitGrey', [0, 0.53, 0], [Math.PI / 2, 0, 0], 24);              // neck ring
  // torso with the chest unit (its little display glows when HACHI is linked), the backpack
  b.box(0.36, 0.34, 0.22, 'suitWhite', [0, 0.35, 0.01], null, 0.06);
  b.box(0.2, 0.1, 0.05, 'suitGrey', [0, 0.38, -0.11], null, 0.015);
  b.box(0.12, 0.05, 0.01, 'lockerLight', [0, 0.39, -0.137], null, 0.004);
  b.box(0.3, 0.36, 0.13, 'suitGrey', [0, 0.38, 0.17], null, 0.03);
  for (const s of [-1, 1]) b.box(0.04, 0.3, 0.02, 'suitOrange', [s * 0.12, 0.36, -0.1], null, 0.008);
  // arms folded across, gloves
  for (const s of [-1, 1]) {
    b.tube([V(s * 0.2, 0.45, 0), V(s * 0.24, 0.3, -0.05), V(s * 0.1, 0.22, -0.13)], 0.055, 'suitWhite', { radial: 10 });
    b.sphere(0.05, 'suitGrey', [s * 0.06, 0.22, -0.15], 12);
    b.torus(0.052, 0.012, 'suitOrange', [s * 0.13, 0.235, -0.12], [0, s * 0.9, 0], 16);
  }
  // legs folded up (knees forward), boots
  for (const s of [-1, 1]) {
    b.tube([V(s * 0.1, 0.18, 0.02), V(s * 0.11, 0.06, -0.14), V(s * 0.1, -0.1, -0.06)], 0.07, 'suitWhite', { radial: 10 });
    b.box(0.1, 0.08, 0.17, 'suitGrey', [s * 0.1, -0.15, -0.08], null, 0.03);
    b.torus(0.068, 0.012, 'suitOrange', [s * 0.11, 0.06, -0.14], [Math.PI / 2, 0, 0], 16);
  }
  // the hanger: a bar behind the shoulders on a rail carriage
  b.box(0.42, 0.03, 0.03, 'frameIn', [0, 0.5, 0.24], null, 0.008);
  b.box(0.05, 0.6, 0.04, 'frameIn', [0, 0.3, 0.26], null, 0.01);
  return b.build(M, { castShadow: false });
}

/**
 * Build the interior. Returns { group, shaft (group, hidden while the floor hatch is shut and
 * Kaito is up in the cockpit), colliders, lamps, seat, seatParts, leds, locker }
 */
export function buildH8Interior(M) {
  const b = new Builder();     // the cockpit
  const bs = new Builder();    // the shaft
  const C = H8.cockpitC, RC = H8.cockpitR;
  const lamps = [];
  const lamp = (p, color, intensity, range) => lamps.push({ pos: p.clone(), color, intensity, range, room: 'h8' });
  const ledList = [];   // {p, color}

  // ============================================================ the access shaft
  const sz = H8.shaftZ, sr = H8.shaftR;
  const yBot = H8.neckBottom + 0.24, yTop = H8.floorY;
  {
    const tube = new THREE.CylinderGeometry(sr, sr, yTop - yBot, 40, 6, true);
    tube.scale(-1, 1, 1);      // faces inward
    bs.add(tube, 'panelInDark', [0, (yTop + yBot) / 2, sz]);
    for (let y = yBot + 0.2; y < yTop; y += 0.45) bs.torus(sr - 0.02, 0.022, 'frameIn', [0, y, sz], [Math.PI / 2, 0, 0], 40);
    // ladder rungs on the forward wall
    for (let y = yBot + 0.3; y < yTop - 0.1; y += 0.32) {
      bs.pipe(V(-0.17, y, sz - sr + 0.09), V(0.17, y, sz - sr + 0.09), 0.016, 'switchLever', 8);
      for (const x of [-0.17, 0.17]) bs.pipe(V(x, y, sz - sr + 0.09), V(x, y, sz - sr + 0.01), 0.012, 'frameIn', 6);
    }
    // cable trays in the three other quadrants, clamped
    for (const a of [Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
      const cx = Math.sin(a) * (sr - 0.07), cz = sz - Math.cos(a) * (sr - 0.07);
      bs.box(0.16, yTop - yBot - 0.1, 0.03, 'grille', [cx, (yTop + yBot) / 2, cz], [0, a, 0], 0.005);
      for (let k = 0; k < 5; k++) {
        const off = (k - 2) * 0.026;
        const key = ['cable', 'cableOrange', 'cable', 'cableRed', 'cable'][k];
        bs.pipe(V(cx + Math.cos(a) * off, yBot + 0.05, cz + Math.sin(a) * off), V(cx + Math.cos(a) * off, yTop - 0.05, cz + Math.sin(a) * off), 0.011, key, 6);
      }
      for (let y = yBot + 0.35; y < yTop; y += 0.45) bs.box(0.17, 0.025, 0.05, 'frameIn', [cx, y, cz], [0, a, 0], 0.005);
    }
    // junction boxes, an O2 bottle, a pressure gauge, LED strip
    bs.box(0.12, 0.16, 0.06, 'panelIn', [sr - 0.08, yBot + 1.1, sz + 0.1], [0, -Math.PI / 2, 0], 0.01);
    bs.cyl(0.05, 0.05, 0.36, 'trim', [-sr + 0.07, yBot + 1.6, sz + 0.12], null, 16);
    bs.sphere(0.05, 'trim', [-sr + 0.07, yBot + 1.78, sz + 0.12], 12);
    bs.cyl(0.04, 0.04, 0.012, 'steel', [sr - 0.035, yBot + 2.1, sz - 0.12], [0, 0, Math.PI / 2], 16);
    for (let y = yBot + 0.2; y < yTop - 0.1; y += 0.12) ledList.push({ p: V(sr - 0.05, y, sz + 0.2), color: 0 });
    bs.torus(sr + 0.01, 0.035, 'trim', [0, yBot + 0.02, sz], [Math.PI / 2, 0, 0], 40);
    lamp(V(0, (yTop + yBot) / 2, sz + 0.2), 0xffd6a8, 0.9, 3.5);
    // the shaft wall
    for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; bs.colBox(0.18, yTop - yBot, 0.05, [Math.sin(a) * (sr + 0.03), (yTop + yBot) / 2, sz - Math.cos(a) * (sr + 0.03)], [0, a, 0]); }
  }

  // ============================================================ the cockpit
  {
    // the floor glass sits on a thin rim where it meets the sphere; the hatch has its own ring
    b.torus(FLOOR.r - 0.012, 0.014, 'frameIn', [C.x, FLOOR.y, C.z], [Math.PI / 2, 0, 0], 96);
    b.torus(FLOOR.r - 0.035, 0.004, 'amberLamp', [C.x, FLOOR.y + 0.004, C.z], [Math.PI / 2, 0, 0], 96);
    b.torus(FLOOR.hatchR + 0.012, 0.012, 'trim', [FLOOR.hatch.x, FLOOR.y + 0.004, FLOOR.hatch.z], [Math.PI / 2, 0, 0], 48);
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2;
      ledList.push({ p: V(FLOOR.hatch.x + Math.cos(a) * (FLOOR.hatchR + 0.035), FLOOR.y + 0.008, FLOOR.hatch.z + Math.sin(a) * (FLOOR.hatchR + 0.035)), color: 1 });
    }
    // floor colliders round the hatch opening (the hatch itself is a moving collider)
    const fr = FLOOR.r;
    b.colBox(fr * 2, 0.06, (sz - sr) - (C.z - fr), [0, H8.floorY - 0.03, (C.z - fr + sz - sr) / 2]);
    b.colBox(fr * 2, 0.06, (C.z + fr) - (sz + sr), [0, H8.floorY - 0.03, (sz + sr + C.z + fr) / 2]);
    for (const s of [-1, 1]) b.colBox(fr - sr, 0.06, sr * 2, [s * (sr + (fr - sr) / 2), H8.floorY - 0.03, sz]);
    // the seat's column and shell (so Kaito does not walk through them)
    b.colBox(0.5, 0.75, 0.55, [SEAT.G.x, H8.floorY + 0.37, SEAT.G.z - 0.05]);
  }
  // the cockpit shell: rings of boxes (so the camera / Kaito stay inside)
  for (let i = 0; i < 16; i++) for (let j = 0; j < 8; j++) {
    const az = i / 16 * Math.PI * 2, el = -0.55 + j / 7 * 2.0;
    const p = onCockpit(az, el, RC + 0.08);
    if (p.y < H8.floorY) continue;
    const n = p.clone().sub(C).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    b.colBox(0.62, 0.4, 0.1, p.toArray(), [e.x, e.y, e.z]);
  }

  // ============================================================ the suit locker
  const L = H8.locker;
  const locker = new THREE.Group();
  locker.name = 'h8Locker';
  {
    const lb = new Builder();
    // a recess behind the display opening: back wall, sides, top and bottom (following the
    // sphere's curve at the opening, then straight in)
    const R0 = RC + 0.01, R1 = RC + L.depth;
    const elM = (L.el0 + L.el1) / 2;
    const n = onCockpit(L.az, elM, 1).sub(C).normalize();
    const tW = 2 * Math.sin(L.hw) * RC, tH = (L.el1 - L.el0) * RC;
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, -1), n);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    const back = C.clone().addScaledVector(n, R1);
    lb.push(back.toArray(), [e.x, e.y, e.z]);
    // (local frame: -z = outward, into the wall; +z toward the cockpit). The walls face into the
    // niche only: from the cockpit, past the opening, the display shows the world, not a box
    const dep = R1 - R0 + 0.05;
    lb.add(new THREE.PlaneGeometry(tW, tH), 'panelInDark', [0, 0, 0]);
    lb.add(new THREE.PlaneGeometry(dep, tH), 'padDark', [tW / 2, 0, dep / 2], [0, -Math.PI / 2, 0]);
    lb.add(new THREE.PlaneGeometry(dep, tH), 'padDark', [-tW / 2, 0, dep / 2], [0, Math.PI / 2, 0]);
    lb.add(new THREE.PlaneGeometry(tW, dep), 'padDark', [0, tH / 2, dep / 2], [Math.PI / 2, 0, 0]);
    lb.add(new THREE.PlaneGeometry(tW, dep), 'padDark', [0, -tH / 2, dep / 2], [-Math.PI / 2, 0, 0]);
    // light strips in the corners, the rail the suit rides on, a label
    for (const s of [-1, 1]) lb.box(0.012, tH - 0.06, 0.012, 'lockerLight', [s * (tW / 2 - 0.01), 0, 0.06], null, 0.003);
    lb.box(0.04, 0.03, dep - 0.04, 'steel', [0, tH / 2 - 0.05, dep / 2], null, 0.006);
    lb.box(0.14, 0.04, 0.005, 'labelIn', [0, -tH / 2 + 0.05, 0.018], null, 0.002);
    lb.pop();
    const niche = lb.build(M, { castShadow: false });
    locker.add(niche);
    // the suit on its carriage: it rides out along n
    const suit = suitModel(M);
    const carriage = new THREE.Group();
    carriage.add(suit);
    suit.position.set(0, -tH / 2 + 0.17, 0);
    carriage.quaternion.copy(q);
    locker.add(carriage);
    const inPos = C.clone().addScaledVector(n, R1 - 0.2);
    const outPos = C.clone().addScaledVector(n, RC - 0.42);
    carriage.position.copy(inPos);
    locker.userData = { carriage, inPos, outPos, n, suit };
    locker.visible = false;
    lamps.push({ pos: C.clone().addScaledVector(n, R1 - 0.12), color: 0xcfe4ff, intensity: 0, range: 1.6, room: 'h8', locker: true });
  }

  // lamps: soft amber at the floor's rim, a cool light from above
  lamp(V(0, H8.floorY + 0.3, C.z - 0.6), 0xffb070, 0.55, 2.5);
  lamp(V(0, C.y + 0.95, C.z + 0.1), 0xcfe2ff, 0.5, 3.2);

  const group = b.build(M, { castShadow: false });
  group.name = 'h8Interior';
  const shaft = bs.build(M, { castShadow: false });
  shaft.name = 'h8Shaft';
  group.add(shaft);
  group.add(locker);
  // status LEDs (instanced: per-instance colour, blinked by the controller)
  const ledGeo = new THREE.SphereGeometry(0.006, 6, 4);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const leds = new THREE.InstancedMesh(ledGeo, ledMat, ledList.length);
  const PAL = [new THREE.Color(0.3, 2.2, 0.5), new THREE.Color(2.4, 1.2, 0.2), new THREE.Color(0.4, 1.0, 2.4)];
  const m = new THREE.Matrix4();
  ledList.forEach((l, i) => { m.makeTranslation(l.p.x, l.p.y, l.p.z); leds.setMatrixAt(i, m); leds.setColorAt(i, PAL[l.color]); });
  leds.instanceMatrix.needsUpdate = true;
  leds.instanceColor.needsUpdate = true;
  leds.userData = { base: ledList.map((l) => PAL[l.color].clone()), rate: ledList.map((_, i) => 0.3 + ((i * 7919) % 100) / 100 * 3) };
  group.add(leds);
  // the seat on its gimbal
  const seatParts = buildSeat(M);
  group.add(seatParts.base, seatParts.yaw);
  // the seat record (for the seat system): it swivels round its column and tips on its yoke; the
  // eye rides on it (h8Seat.js works it out every frame)
  const seat = { id: 'h8pilot', kind: 'pilot', eye: SEAT.G.clone().add(SEAT.eye), fwd: V(0, -0.08, -1).normalize(), exit: V(0, H8.floorY, sz - 0.05), h8: true, swivel: true, gimbal: true, axis: V(SEAT.G.x, 0, SEAT.G.z), yawSeat: 0, pitchSeat: 0 };
  return { group, shaft, colliders: [...b.colliders, ...bs.colliders], lamps, seat, seatParts, leds, locker };
}
