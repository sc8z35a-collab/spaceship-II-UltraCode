// Shirasagi's habitat ring reached for real: the first spoke's elevator is a car that runs the 52 m
// of the spoke between the hub and the deck in the ring's own turning frame. The pull of the spin
// grows as it goes down (0.06 g up at the hub, 0.43 g on the deck: you float at the top and settle
// onto the floor on the way), the spoke's lamps run past the windows, the station and the Earth
// wheel round outside. At the hub the car meets the transit tube's terminal: the same car, coupled
// there (the frame changes over in a blink while its doors are shut).
//  ring space: ring-local + the ring's centre C (ship-local), turning about +z
//  the car's own frame: floor at y 0, up along y, its doors facing +x
import * as THREE from 'three';
import { RING } from './stationRing.js';
import { CORE, TERMINAL } from './stationAtrium.js';
import { LAYER_NEAR } from '../core/layers.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const A0 = 7.5 * Math.PI / 180;                       // the first spoke hall
const U = V(Math.cos(A0), Math.sin(A0), 0);           // down the spoke (outward)
const TG = V(-Math.sin(A0), Math.cos(A0), 0);         // along the deck: the doors face this way
const Z = V(0, 0, 1);
const CAR = { r: 0.85, h: 2.3, door: 1.0, doorH: 2.05 };
const R_DECK = RING.floor, R_TOP = 7.6, R_CEIL = RING.ceil;
const RUN = { v: 6.0, a: 1.0 };
const FONT = '"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif';
// the car's frame in ring space (x along the deck, y toward the hub, z the axis) and in the ship's
// (at the hub terminal: x toward the transit tube, y up, z to starboard)
const QR = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(TG, U.clone().negate(), Z));
const QT = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, -1), V(0, 1, 0), V(1, 0, 0)));
const TP = V(CORE.x, CORE.y - 1.15, TERMINAL.z1 - 0.9);   // the terminal car's floor (ship-local)

function mats(M) {
  if (M.rlShell) return;
  const env = (M.gold && M.gold.envMap) || null;
  M.rlShell = new THREE.MeshStandardMaterial({ color: 0xece4d4, roughness: 0.45, metalness: 0.1, envMap: env, envMapIntensity: 0.4, side: THREE.DoubleSide });
  M.rlFloor = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.6, metalness: 0.4, envMap: env, envMapIntensity: 0.3 });
  M.rlLight = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 0.95, 0.86), emissiveIntensity: 2.2 });
  M.rlRun = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.45, 0.8, 1.0), emissiveIntensity: 2.6 });
}

function panel(w, h, ppm) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * ppm); c.height = Math.round(h * ppm);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  return { mesh, ctx: c.getContext('2d'), tex, W: c.width, H: c.height };
}
function txt(ctx, s, x, y, px, color, align = 'center', weight = 700) { ctx.font = `${weight} ${px}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); }

/** the car (its own frame): a cream and glass drum, ring light, handrail, two curved door leaves, its panel */
function buildCar(M) {
  const g = new THREE.Group();
  const put = (geo, mat, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; g.add(m); return m; };
  const HD = Math.asin(CAR.door / 2 / CAR.r), th0 = Math.PI / 2 + HD, thL = TAU - 2 * HD;
  put(new THREE.CylinderGeometry(CAR.r + 0.06, CAR.r + 0.06, 0.12, 40), M.rlFloor, -0.06);
  { const f = new THREE.CircleGeometry(CAR.r, 40); f.rotateX(-Math.PI / 2); put(f, M.rlFloor, 0.002); }
  { const f = new THREE.RingGeometry(CAR.r - 0.1, CAR.r - 0.04, 40); f.rotateX(-Math.PI / 2); put(f, M.rlLight, 0.006); }
  put(new THREE.CylinderGeometry(CAR.r, CAR.r, 0.9, 40, 1, true, th0, thL), M.rlShell, 0.45);
  put(new THREE.CylinderGeometry(CAR.r, CAR.r, 1.2, 40, 1, true, th0, thL), M.glass, 1.5);
  put(new THREE.CylinderGeometry(CAR.r, CAR.r, CAR.h - 2.1, 40, 1, true, th0, thL), M.rlShell, (2.1 + CAR.h) / 2);
  put(new THREE.CylinderGeometry(CAR.r, CAR.r, CAR.h - CAR.doorH, 12, 1, true, Math.PI / 2 - HD, 2 * HD), M.rlShell, (CAR.doorH + CAR.h) / 2);
  put(new THREE.CylinderGeometry(CAR.r + 0.06, CAR.r + 0.06, 0.12, 40), M.rlFloor, CAR.h + 0.06);
  { const c = new THREE.CircleGeometry(CAR.r - 0.25, 40); c.rotateX(Math.PI / 2); put(c, M.rlLight, CAR.h - 0.004); }
  for (const y of [0.9, 2.1]) { const t = new THREE.TorusGeometry(CAR.r + 0.005, 0.02, 6, 40); t.rotateX(Math.PI / 2); put(t, M.gold, y); }
  { const ra = HD + 0.2, t = new THREE.TorusGeometry(CAR.r - 0.08, 0.02, 6, 40, TAU - 2 * ra); t.rotateX(Math.PI / 2); put(t, M.brass || M.gold, 0.95).rotation.y = -ra; }
  const leafG = new THREE.CylinderGeometry(CAR.r + 0.025, CAR.r + 0.025, CAR.doorH - 0.04, 10, 1, true, 0, HD);
  const leaves = [put(leafG, M.glass, CAR.doorH / 2), put(leafG, M.glass, CAR.doorH / 2)];
  const edgeG = new THREE.BoxGeometry(0.025, CAR.doorH - 0.04, 0.025);
  { const m = new THREE.Mesh(edgeG, M.gold); m.position.set((CAR.r + 0.025) * Math.sin(HD), 0, (CAR.r + 0.025) * Math.cos(HD)); leaves[0].add(m); }
  { const m = new THREE.Mesh(edgeG, M.gold); m.position.set(0, 0, CAR.r + 0.025); leaves[1].add(m); }
  const p = panel(0.32, 0.46, 640);
  p.mesh.position.set(-(CAR.r - 0.03), 1.3, 0); p.mesh.rotation.y = Math.PI / 2;
  g.add(p.mesh);
  g.traverse((o) => o.layers.set(LAYER_NEAR));
  return { group: g, leaves, HD, panel: p };
}

/** the car's walls, floor, roof and door for the player (its own frame): [{ d: descriptor, o: offset, door? }] */
function carColliders() {
  const out = [], HD = Math.asin(CAR.door / 2 / CAR.r), n = 14, a0 = HD, a1 = TAU - HD, da = (a1 - a0) / n;
  const box = (hx, hy, hz, o, q) => ({ d: { type: 'box', hx, hy, hz }, o, q });
  out.push({ d: { type: 'cyl', hh: 0.05, r: CAR.r + 0.04 }, o: V(0, -0.05, 0), q: new THREE.Quaternion() });
  out.push({ d: { type: 'cyl', hh: 0.05, r: CAR.r + 0.04 }, o: V(0, CAR.h + 0.05, 0), q: new THREE.Quaternion() });
  for (let i = 0; i < n; i++) {
    const a = a0 + da * (i + 0.5), w = 2 * (CAR.r + 0.04) * Math.sin(da / 2) + 0.03;
    out.push(box(w / 2, CAR.h / 2, 0.04, V((CAR.r + 0.04) * Math.cos(a), CAR.h / 2, (CAR.r + 0.04) * Math.sin(a)), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI / 2 - a)));
  }
  const door = box(0.04, CAR.doorH / 2, CAR.door / 2 + 0.06, V(CAR.r + 0.04, CAR.doorH / 2, 0), new THREE.Quaternion());
  door.door = true;
  out.push(door);
  return out;
}

const _v = V(0, 0, 0), _w = V(0, 0, 0), _q = new THREE.Quaternion();

/** cut the triangles that fall in a hole out of a geometry (indexed or not); returns a geometry */
function cut(geo, hole) {
  const P = geo.attributes.position.array;
  const tri = (i0, i1, i2) => hole((P[i0 * 3] + P[i1 * 3] + P[i2 * 3]) / 3, (P[i0 * 3 + 1] + P[i1 * 3 + 1] + P[i2 * 3 + 1]) / 3, (P[i0 * 3 + 2] + P[i1 * 3 + 2] + P[i2 * 3 + 2]) / 3);
  if (geo.index) {
    const I = geo.index.array, keep = [];
    for (let i = 0; i < I.length; i += 3) if (!tri(I[i], I[i + 1], I[i + 2])) keep.push(I[i], I[i + 1], I[i + 2]);
    geo.setIndex(keep);
    return geo;
  }
  const n = P.length / 3, out = new THREE.BufferGeometry(), keepT = [];
  for (let t = 0; t < n; t += 3) if (!tri(t, t + 1, t + 2)) keepT.push(t);
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const s = attr.itemSize, src = attr.array, dst = new src.constructor(keepT.length * 3 * s);
    keepT.forEach((t, j) => { for (let k = 0; k < 3 * s; k++) dst[j * 3 * s + k] = src[t * s + k]; });
    out.setAttribute(name, new THREE.BufferAttribute(dst, s));
  }
  return out;
}

/**
 * Build it into Shirasagi's ring (R: buildRingInterior's result) and its hub terminal. Returns
 * { shipGroup, shipColliders, attach(g, C), detach(g), call(where), nearHall(pRing), preStep, update,
 * liftDelta(p) }
 */
export function buildRingLift(M, R) {
  mats(M);
  // ---- the ceiling over the first hall opened for the car (its mesh and its collider), a collar
  // round the opening; the spoke's air joins the ring's
  const hole = (x, y, z) => {
    const r = Math.hypot(x, y);
    if (r < R_CEIL - 0.4 || r > R_CEIL + 0.4) return false;
    const da = Math.atan2(Math.sin(Math.atan2(y, x) - A0), Math.cos(Math.atan2(y, x) - A0));
    return Math.hypot(da * r, z) < 1.15;
  };
  let cutMeshes = 0;
  R.group.traverse((o) => { if (o.isMesh && M.ringCeil && o.material === M.ringCeil) { o.geometry = cut(o.geometry, hole); cutMeshes++; } });
  if (!cutMeshes) console.warn('[ringLift] no ceiling mesh found to open');
  for (const c of R.colliders) if (c.type === 'mesh' && c.geo) c.geo = cut(c.geo, hole);
  const c0 = R.contains;
  const inSpoke = (p) => { const s = p.x * U.x + p.y * U.y; if (s < R_TOP - CAR.h - 0.3 || s > R_DECK + 0.3) return false; return Math.hypot(p.x - U.x * s, p.y - U.y * s, p.z) < 1.05; };
  R.contains = (p) => c0(p) || inSpoke(p);

  // ---- in the ring: the spoke's tube (glass, rails, lamps that run past), the hub's end, the collar
  // under the ceiling, the car, the hall's landing doors
  const ring = new THREE.Group();
  ring.name = 'ringLift';
  const along = (s) => U.clone().multiplyScalar(s);
  const qU = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), U);
  {
    const s0 = R_TOP - CAR.h - 0.1, s1 = R_CEIL, L = s1 - s0;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, L, 28, 1, true), M.glass);
    tube.position.copy(along((s0 + s1) / 2)); tube.quaternion.copy(qU); ring.add(tube);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * TAU + 0.5, rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, L, 0.05), M.steel);
      rail.position.copy(along((s0 + s1) / 2)).addScaledVector(TG, Math.cos(a) * 0.93).addScaledVector(Z, Math.sin(a) * 0.93);
      rail.quaternion.copy(qU); ring.add(rail);
    }
    const lampG = new THREE.TorusGeometry(0.96, 0.025, 6, 32);
    for (let s = s0 + 1.2; s < s1 - 0.4; s += 2.5) { const t = new THREE.Mesh(lampG, M.rlRun); t.position.copy(along(s)); t.quaternion.setFromUnitVectors(V(0, 0, 1), U); ring.add(t); }
    const cap = new THREE.Mesh(new THREE.CircleGeometry(1.0, 28), M.steel);
    cap.position.copy(along(s0)); cap.quaternion.setFromUnitVectors(V(0, 0, 1), U); ring.add(cap);
    const sh = new THREE.Shape(); sh.moveTo(-1.7, -RING.hw); sh.lineTo(1.7, -RING.hw); sh.lineTo(1.7, RING.hw); sh.lineTo(-1.7, RING.hw); sh.closePath();
    const hp = new THREE.Path(); hp.absarc(0, 0, 0.97, 0, TAU, true); sh.holes.push(hp);
    const collar = new THREE.Mesh(new THREE.ShapeGeometry(sh, 32), M.steel);
    // (just under the ceiling, square with the deck: it covers the whole slot cut for the car)
    collar.position.copy(along(R_CEIL + 0.012)); collar.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(TG, Z, U)); ring.add(collar);
  }
  const rcar = buildCar(M);
  rcar.group.quaternion.copy(QR);
  ring.add(rcar.group);
  // the landing's doors on the glass column's opening (hall frame: the column's foot)
  const HL = Math.asin(0.5 / 0.97);
  const landG = new THREE.CylinderGeometry(0.97, 0.97, CAR.doorH, 10, 1, true, 0, HL);
  const hall = new THREE.Group();
  hall.position.copy(along(R_DECK)); hall.quaternion.copy(QR);
  const land = [new THREE.Mesh(landG, M.glass), new THREE.Mesh(landG, M.glass)];
  for (const m of land) { m.position.y = CAR.doorH / 2; hall.add(m); }
  ring.add(hall);
  ring.traverse((o) => o.layers.set(LAYER_NEAR));
  R.group.add(ring);

  // ---- at the hub's terminal, ship-local: the same car, standing where the transit tube ends
  const tcar = buildCar(M);
  tcar.group.position.copy(TP); tcar.group.quaternion.copy(QT);
  const shipGroup = new THREE.Group();
  shipGroup.name = 'ringLiftTerminal';
  shipGroup.add(tcar.group);
  const shipColliders = [], tDoor = [];
  for (const c of carColliders()) {
    const pos = c.o.clone().applyQuaternion(QT).add(TP), q = QT.clone().multiply(c.q);
    const d = Object.assign({}, c.d, { m: new THREE.Matrix4().compose(pos, q, V(1, 1, 1)) });
    if (c.door) tDoor.push(d); else shipColliders.push(d);
  }

  // ---- the run
  const st = { rf: R_DECK, v: 0, dr: 0, at: 'deck', dest: 'deck', phase: 'idle', k: 0, timer: 0, ride: 0, armed: false, go: false, calls: { top: false, deck: false }, xfer: 0, xferDir: null, stepped: false, cols: null, colOff: null, doorCols: null, landCols: null, tDoorCols: null, wallCols: null, C: null, taps: [], interact: null, crisp: false, drawT: 0, inside: false };
  const ringPos = (g) => (g.docking.inRing ? g.docking.ringState.pos : null);
  const inRingCar = (p) => {
    if (!p || !st.C) return false;
    const d = _v.copy(p).sub(st.C).addScaledVector(U, -st.rf);
    const y = -d.dot(U), x = d.dot(TG);
    return y > -0.5 && y < CAR.h + 0.3 && Math.hypot(x, d.z) < CAR.r - 0.05;
  };
  const looseIn = (p) => {
    if (!p || !st.C) return false;
    const d = _v.copy(p).sub(st.C).addScaledVector(U, -st.rf);
    const y = -d.dot(U), x = d.dot(TG);
    return y > -0.8 && y < CAR.h + 0.6 && Math.hypot(x, d.z) < CAR.r + 0.3;
  };
  const inTermCar = (p) => { if (!p) return false; const d = _v.copy(p).sub(TP); return d.y > -0.5 && d.y < CAR.h + 0.3 && Math.hypot(d.x, d.z) < CAR.r - 0.05; };
  const nearHall = (p) => { if (!p || !st.C) return false; const d = _v.copy(p).sub(st.C); const s = d.dot(U); return s > R_DECK - 3 && Math.hypot(d.x - U.x * s, d.y - U.y * s, d.z) < 3.5; };
  const nearTerm = (p) => !!p && p.distanceTo(_w.copy(TP).add(V(0, 1, -1.6))) < 2.2;
  const pull = () => (RING.omega * RING.omega * st.rf / 9.81);

  function step(dt, g) {
    const pl = g.player, alive = pl && pl.state !== 'dead';
    const D = g.docking, rp = alive ? ringPos(g) : null, sp = alive && !D.inRing ? pl.pos : null;
    st.ringK = D.station && D.station.ringK != null ? D.station.ringK : 1;
    const inRingC = inRingCar(rp), inTermC = st.at === 'top' && st.phase !== 'move' && inTermCar(sp);
    const here = st.at === 'top' ? inTermC : inRingC;
    st.inside = inRingC || inTermC;
    st.dr = 0;
    const nearStop = (w) => (w === 'top' ? nearTerm(sp) : nearHall(rp));
    switch (st.phase) {
      case 'idle':
        if (here || nearStop(st.at) || st.calls[st.at]) { st.calls[st.at] = false; st.phase = 'opening'; }
        else { const other = st.at === 'top' ? 'deck' : 'top'; if (st.calls[other] || nearStop(other)) { st.calls[other] = false; st.dest = other; st.phase = 'move'; st.rider = false; } }
        break;
      case 'opening':
        st.k = Math.min(1, st.k + dt / 1.3);
        if (st.k >= 1) { st.phase = 'open'; st.timer = 0; st.ride = 0; st.armed = !here; }
        break;
      case 'open':
        st.timer += dt;
        if (!here) st.armed = true;
        st.ride = here && st.armed ? st.ride + dt : 0;
        const noPower = !!(D.station && D.station.dmg && D.station.dmg.status === 'failed');
        if (noPower && st.go) { st.go = false; if (g.statusLine) g.statusLine.note('ステーションの電源が落ちています — エレベーターは動きません', 4); }
        if (!noPower && (st.go || st.ride > 3.0)) { st.go = false; st.dest = st.at === 'top' ? 'deck' : 'top'; st.phase = 'closing'; }
        else if (!here && !nearStop(st.at) && st.timer > 6) { st.dest = st.at; st.phase = 'closing'; }
        break;
      case 'closing':
        // (never onto someone standing in the deck doorway)
        if (rp && st.at === 'deck') {
          _w.copy(rp).sub(st.C).addScaledVector(U, -st.rf);
          const dx = _w.dot(TG), dy = -_w.dot(U);
          if (dx > 0.68 && dx < 1.7 && Math.abs(_w.z) < 0.75 && dy > -0.4 && dy < 2.4) { st.phase = 'opening'; break; }
        }
        st.k = Math.max(0, st.k - dt / 1.3);
        if (st.k <= 0) {
          if (st.dest === st.at) st.phase = 'idle';
          else if (st.at === 'top' && inTermC) { st.phase = 'xfer'; st.xfer = 0; st.xferDir = 'in'; }
          else { st.phase = 'move'; st.rider = inRingC; }
        }
        break;
      case 'xfer': {        // a blink while the frame changes over (the doors shut)
        st.xfer += dt;
        if (st.xfer < 0.3) g.hud && g.hud.setFade && g.hud.setFade(1);
        if (st.xfer > 0.4 && st.xferDir) { (st.xferDir === 'in' ? intoRing : outOfRing)(g); st.xferDir = null; }
        if (st.xfer > 0.7) { g.hud && g.hud.setFade && g.hud.setFade(0); st.phase = st.dest === st.at ? 'opening' : 'move'; }
        break;
      }
      case 'move': {
        if (inRingC) st.rider = true;
        const goal = st.dest === 'deck' ? R_DECK : R_TOP, rem = goal - st.rf, s = Math.sign(rem) || 1;
        const vWant = s * Math.min(RUN.v, Math.sqrt(2 * RUN.a * Math.abs(rem)) * 0.96 + 0.04);
        st.v += THREE.MathUtils.clamp((vWant - st.v) * Math.min(1, dt * 2.2), -RUN.a * dt, RUN.a * dt);
        let d = st.v * dt;
        if (Math.abs(rem) <= Math.abs(d) || Math.abs(rem) < 0.002) {
          d = rem; st.v = 0; st.at = st.dest;
          if (g.audio && g.audio.beep) g.audio.beep(988, 0.1, 0.06, { pos: pl.eyeLocal });
          if (st.at === 'top' && (inRingC || looseIn(rp))) { st.phase = 'xfer'; st.xfer = 0; st.xferDir = 'out'; }
          else st.phase = 'opening';
          st.rider = false;
          if (st.at === 'deck' && inRingC && g.asphalt) g.asphalt.say('ring_arrive', { g: (pull() * Math.pow(D.station.ringK ?? 1, 2)).toFixed(2) }, { force: true });
        }
        st.rf += d; st.dr = d;
        break;
      }
    }
    _d.copy(U).multiplyScalar(st.dr);
  }
  /** at the hub, doors shut: the rider goes over from the terminal's car into the spoke's */
  function intoRing(g) {
    const D = g.docking, pl = g.player;
    if (!st.C || D.inRing) return;
    const loc = _v.copy(pl.pos).sub(TP).applyQuaternion(_q.copy(QT).invert());
    const p = loc.applyQuaternion(QR).add(st.C).addScaledVector(U, st.rf);
    D.inRing = true;
    pl.teleport(p.clone());
    pl.up.copy(U).negate();
    pl.yaw = -Math.PI / 2; pl.pitch = 0; if (pl.state !== 'dead') pl.state = 'float';
    pl.eyeLocal.copy(p).addScaledVector(pl.up, 0.7);
    D.storeRingState();
    D.toRenderSpace();
    st.rider = true;
  }
  /** at the hub, doors shut: the rider goes over from the spoke's car into the terminal's */
  function outOfRing(g) {
    const D = g.docking, pl = g.player;
    if (!D.inRing) return;
    const loc = _v.copy(D.ringState.pos).sub(st.C).addScaledVector(U, -st.rf).applyQuaternion(_q.copy(QR).invert());
    if (loc.y < -0.8 || loc.y > CAR.h + 0.6 || Math.hypot(loc.x, loc.z) > CAR.r + 0.3) return;     // (not in the car after all: he stays where he is)
    const p = loc.applyQuaternion(QT).add(TP);
    D.leaveRingFrame();
    pl.teleport(p.clone());
    pl.up.set(0, 1, 0);
    pl.yaw = 0; pl.pitch = 0; pl.state = 'float';
    pl.eyeLocal.copy(p).addScaledVector(pl.up, 0.7);
    if (g.asphalt) g.asphalt.say('ring_leave', {}, { minGap: 30 });
  }

  function applyCols() {
    if (!st.cols) return;
    st.cols.forEach((c, i) => c.setTranslation(_w.copy(st.colOff[i]).addScaledVector(U, st.rf).add(st.C)));
    const k = st.phase === 'move' || st.phase === 'xfer' ? 0 : st.k;
    for (const c of st.doorCols) c.setEnabled(!(st.at === 'deck' && k > 0.6));
    for (const c of st.landCols) c.setEnabled(!(st.at === 'deck' && k > 0.6));
    for (const c of st.tDoorCols) c.setEnabled(!(st.at === 'top' && k > 0.6));
  }
  function visuals() {
    rcar.group.position.copy(U).multiplyScalar(st.rf);
    const k = st.phase === 'move' || st.phase === 'xfer' ? 0 : st.k;
    const kd = st.at === 'deck' ? k : 0, kt = st.at === 'top' ? k : 0;
    const th = Math.PI / 2;
    for (const [c, kk] of [[rcar, kd], [tcar, kt]]) { c.leaves[0].rotation.y = th - c.HD - c.HD * 0.94 * kk; c.leaves[1].rotation.y = th + c.HD * 0.94 * kk; }
    land[0].rotation.y = th - HL - HL * 0.94 * kd; land[1].rotation.y = th + HL * 0.94 * kd;
  }
  function draw(p) {
    const { ctx, W, H } = p;
    ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, W, H);
    txt(ctx, 'SPOKE 1', W / 2, H * 0.07, H * 0.05, '#d9b867');
    const moving = st.phase === 'move';
    const name = (w) => (w === 'deck' ? 'リング居住区' : 'ハブ');
    txt(ctx, moving ? (st.dest === 'deck' ? '▼' : '▲') : '●', W / 2, H * 0.2, H * 0.1, moving ? '#7fd0ff' : '#e9eef5');
    txt(ctx, moving ? name(st.dest) + ' へ' : name(st.at), W / 2, H * 0.33, H * 0.065, '#e9eef5');
    txt(ctx, (pull() * (st.ringK ?? 1) * (st.ringK ?? 1)).toFixed(2) + ' G', W / 2, H * 0.45, H * 0.075, '#8dffb0');
    txt(ctx, '半径 ' + st.rf.toFixed(1) + ' m', W / 2, H * 0.55, H * 0.045, '#9fb3c8', 'center', 500);
    for (const w of ['top', 'deck']) {
      const y = w === 'top' ? H * 0.63 : H * 0.8, on = (moving ? st.dest : st.at) === w;
      ctx.fillStyle = on ? '#1d4f7a' : '#16202e'; ctx.fillRect(W * 0.08, y, W * 0.84, H * 0.14);
      txt(ctx, (w === 'top' ? '▲ ' : '▼ ') + name(w), W / 2, y + H * 0.07, H * 0.055, on ? '#ffffff' : '#c4cfdb');
    }
    if (st.phase === 'open' && st.inside && !st.armed && Math.floor(Date.now() / 500) % 2 === 0) txt(ctx, 'タップで出発', W / 2, H * 0.97, H * 0.04, '#d9b867', 'center', 800);
    p.tex.needsUpdate = true;
  }

  const _d = V(0, 0, 0);
  return {
    shipGroup, shipColliders,
    /** with the ring spawned (C: its centre, ship-local): the car's colliders in ring space */
    attach(g, C) {
      if (st.cols) return;
      st.C = C.clone();
      const ph = g.phys, defs = carColliders(), live = [], door = [];
      st.colOff = [];
      for (const c of defs) {
        const off = c.o.clone().applyQuaternion(QR), q = QR.clone().multiply(c.q);
        const d = Object.assign({}, c.d, { m: new THREE.Matrix4().compose(off.clone().addScaledVector(U, st.rf).add(st.C), q, V(1, 1, 1)) });
        (c.door ? door : live).push([d, off]);
      }
      st.cols = ph.addColliders([...live, ...door].map(([d]) => d));
      st.colOff = [...live, ...door].map(([, o]) => o);
      st.doorCols = st.cols.slice(live.length);
      // the column's glass wall round the car's place (the hall's own collider is left out), the
      // landing's doors across its opening
      const wall = [], foot = along(R_DECK).add(st.C), n = 14, HLw = Math.asin(0.55 / 1.0);
      for (let i = 0; i < n; i++) {
        const a = HLw + (TAU - 2 * HLw) * (i + 0.5) / n, w = 2 * 1.04 * Math.sin((TAU - 2 * HLw) / n / 2) + 0.03;
        const o = V(1.04 * Math.cos(a), (R_DECK - R_CEIL) / 2, 1.04 * Math.sin(a)).applyQuaternion(QR);
        wall.push({ type: 'box', hx: w / 2, hy: (R_DECK - R_CEIL) / 2, hz: 0.05, m: new THREE.Matrix4().compose(o.add(foot), QR.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI / 2 - a)), V(1, 1, 1)) });
      }
      st.wallCols = ph.addColliders(wall);
      // the slot the hall's ceiling lost to the spoke, closed again round the column (its hole stays)
      const cp = (t, z, hx, hz) => ({ type: 'box', hx, hy: 0.1, hz, m: new THREE.Matrix4().compose(along(R_CEIL - 0.1).clone().addScaledVector(TG, t).addScaledVector(Z, z).add(st.C), QR, V(1, 1, 1)) });
      st.ceilCols = ph.addColliders([cp(0, 1.6, 1.62, 0.6), cp(0, -1.6, 1.62, 0.6), cp(1.3, 0, 0.32, 1.02), cp(-1.3, 0, 0.32, 1.02)]);
      const lo = V(1.04, CAR.doorH / 2, 0).applyQuaternion(QR).add(foot);
      st.landCols = ph.addColliders([{ type: 'box', hx: 0.05, hy: CAR.doorH / 2, hz: 0.62, m: new THREE.Matrix4().compose(lo, QR, V(1, 1, 1)) }]);
      st.tDoorCols = ph.addColliders(tDoor);
      applyCols();
    },
    detach(g) {
      for (const c of [...(st.cols || []), ...(st.wallCols || []), ...(st.landCols || []), ...(st.tDoorCols || []), ...(st.ceilCols || [])]) g.phys.world.removeCollider(c, true);
      st.cols = st.doorCols = st.wallCols = st.landCols = st.tDoorCols = st.ceilCols = null;
      if (st.interact) for (const t of st.taps) st.interact.remove(t);
      st.taps = [];
    },
    /** the hub's panel ('top') or the hall's button ('deck') */
    call(where) { st.calls[where] = true; if (st.phase === 'open' && st.at !== where && !st.inside) { st.dest = st.at; st.phase = 'closing'; } },
    nearHall,
    preStep(dt, g) {
      if (!st.cols) return;
      const pl = g.player, D = g.docking;
      // (in the ring frame here: pl.pos is in ring space)
      const rider = D.inRing && pl && pl.state !== 'dead' && looseIn(pl.pos);
      step(dt, g); applyCols(); st.stepped = true;
      // the rider goes with the car, moved with it outright (no contest with its floor's contact)
      if (rider && st.dr !== 0 && D.inRing) { _w.copy(pl.pos).addScaledVector(U, st.dr); pl.teleport(_w); }
      // (never left sunk into the car's floor: his middle at least his half height over it)
      if (rider && D.inRing) {
        _w.copy(pl.pos).sub(st.C);
        const s = _w.dot(U), top = st.rf - (pl.crouch > 0.5 ? 0.5 : 0.8);
        if (s > top + 0.06) { _w.addScaledVector(U, top - s).add(st.C); pl.teleport(_w); }
      }
    },
    update(dt, g) {
      if (!st.cols) return;
      if (!st.crisp && g.engine && g.engine.crisp) { g.engine.crisp.add(rcar.panel.mesh); g.engine.crisp.add(tcar.panel.mesh); st.crisp = true; }
      if (!st.taps.length && g.interact) {
        st.interact = g.interact;
        for (const c of [rcar, tcar]) st.taps.push(g.interact.addMesh(c.panel.mesh, () => { if (st.phase === 'open') st.go = true; }, { maxDist: 2.0 }));
      }
      if (!st.stepped) { step(dt, g); applyCols(); }
      st.stepped = false;
      visuals();
      st.drawT -= dt;
      if (st.drawT <= 0) { st.drawT = 0.25; draw(rcar.panel); draw(tcar.panel); }
    },
    /** the car's carry for the player (ring space), or null: filled in by preStep before his step */
    liftDelta() { return null; },      // (the rider is carried outright, in preStep)
    state: st,
  };
}
