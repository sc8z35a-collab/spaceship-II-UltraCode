// H8's emergency shelter. Behind the aft panel of the cockpit display, a narrow upright box with
// room for one person and no more: a fold-down seat against the back wall, the knees nearly against
// the door. The display panel slides aside along the sphere to let him in and shuts behind him;
// then the shelter is sealed and lives on its own — its own oxygen bottles and scrubber (ten hours
// for one person), a battery for a dim lamp, a console that runs everything H8 (and, over the link
// or the cable, B-29) can do, and one small screen: the only view out. It has no drive and makes
// no power of its own. Built into H8's strongest frame, it is the one part that comes through if
// H8 is destroyed: it drifts on alone, keeping Kaito alive until B-29 comes for it or the oxygen
// runs out. H8-local coordinates.
import * as THREE from 'three';
import { Builder } from '../ship/geom.js';
import { H8 } from './h8Spec.js';
import { LAYER_NEAR } from '../core/layers.js';
import { LAYER_PROXY } from '../player/interact.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Cc = H8.cockpitC, R = H8.cockpitR;
const DOCK = H8.dockAt;

/** the box: x within +-X, y0..y1, from the sphere's surface back to z1; the eye on the seat */
export const SHELTER = { X: 0.39, y0: -0.38, y1: 1.12, z1: 1.95, eye: V(0, 0.68, 1.58), center: V(0, 0.37, 1.42) };
const BREATH = 7.4e-4;                // kPa*m^3/s of O2 one person uses (the ship's own air model)
const FULL = 10 * 3600 * BREATH;      // ten hours' worth in the bottles
const AREA = 0.55;                    // the opening (m^2)

/** the front of the box: where the sphere's surface is at (x, y), behind the cockpit */
const zFront = (y, x = 0) => Cc.z + Math.sqrt(Math.max(0, R * R - (y - Cc.y) ** 2 - x * x));

export function shelterMaterials(M) {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  M.shelterPad = S({ color: 0x3d434b, roughness: 0.9, metalness: 0.02 });
  M.shelterO2 = S({ color: 0x2f7d4a, roughness: 0.45, metalness: 0.35 });
  M.shelterLamp = S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.58, 0.22), emissiveIntensity: 0 });
  M.shelterRed = S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.08, 0.04), emissiveIntensity: 0 });
  M.shelterGauge = S({ color: 0x000000, emissive: new THREE.Color(0.35, 1.0, 0.55), emissiveIntensity: 0 });
  M.shelterStrobe = S({ color: 0x000000, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 });
  M.podShell = S({ color: 0x8d949b, roughness: 0.55, metalness: 0.6 });
  M.podTorn = S({ color: 0x2c2724, roughness: 0.9, metalness: 0.3, side: THREE.DoubleSide });
  return M;
}

/** a wall of the box as a strip between the sphere's surface and the back wall (one-sided: it
 * faces into the shelter only, so from the cockpit nothing of the box shows past the opening) */
function sideWall(x, inward) {
  const pos = [], idx = [];
  const N = 14, { y0, y1, z1 } = SHELTER;
  for (let i = 0; i <= N; i++) {
    const y = y0 + (y1 - y0) * i / N;
    pos.push(x, y, zFront(y, Math.abs(x)) - 0.01, x, y, z1);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    if (inward > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** the floor or the ceiling (y), the same way */
function capWall(y, up) {
  const pos = [], idx = [];
  const N = 10, { X, z1 } = SHELTER;
  for (let i = 0; i <= N; i++) {
    const x = -X + 2 * X * i / N;
    pos.push(x, y, zFront(y, Math.abs(x)) - 0.01, x, y, z1);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    if (up > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** the front of the box round the door: the sphere's back between the door's edges and the walls
 * (from inside, the display's own back would show there; adrift, open space) */
function frontFrame() {
  const S = H8.shelter, Rf = R + 0.035;
  // breakpoints on the door's edges so the hole is exact
  const span = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
  const AZ = [...span(-0.44, -S.hw, 2), ...span(-S.hw, S.hw, 10).slice(1), ...span(S.hw, 0.44, 2).slice(1)];
  const EL = [...span(-0.62, S.el0, 2), ...span(S.el0, S.el1, 12).slice(1), ...span(S.el1, 0.74, 2).slice(1)];
  const pos = [], idx = [];
  const NA = AZ.length;
  for (const el of EL) for (const a of AZ) {
    const az = S.az + a;
    pos.push(Cc.x + Math.sin(az) * Math.cos(el) * Rf, Cc.y + Math.sin(el) * Rf, Cc.z - Math.cos(az) * Math.cos(el) * Rf);
  }
  for (let j = 0; j < EL.length - 1; j++) for (let i = 0; i < NA - 1; i++) {
    const am = (AZ[i] + AZ[i + 1]) / 2, em = (EL[j] + EL[j + 1]) / 2;
    if (Math.abs(am) < S.hw && em > S.el0 && em < S.el1) continue;
    const a = j * NA + i, b = a + 1, c = a + NA, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class H8Shelter {
  constructor(vessel, M) {
    this.v = vessel;
    this.M = M;
    this.target = 0;          // the door: where it is going (0 shut .. 1 open)
    this.open = 0;
    this.o2 = FULL;           // kPa*m^3 of O2 in its bottles
    this.lioh = 1;            // the scrubber's canister left
    this.battery = 1;         // lamp, console, camera (no power plant of its own)
    this.occupied = false;
    this.sitT = 0;
    this.leftT = -1;
    this.saidO2 = 99;
    this.group = new THREE.Group();
    this.group.name = 'h8Shelter';
    this.build();
    this.buildPod();
    // the seat: a pilot's seat in all but the view (the sticks fly H8, the console runs it all)
    this.seat = { id: 'h8shelter', kind: 'pilot', shelter: true, h8: true, eye: SHELTER.eye.clone().add(DOCK), fwd: V(0, -0.12, -1).normalize(), exit: V(0, H8.floorY + 0.02, 0.42).add(DOCK) };
  }

  // ------------------------------------------------------------------ the box
  build() {
    const M = this.M, { X, y0, y1, z1 } = SHELTER;
    const add = (geo, key) => { const m = new THREE.Mesh(geo, M[key]); this.group.add(m); return m; };
    add(sideWall(-X, 1), 'shelterPad');
    add(sideWall(X, -1), 'shelterPad');
    add(capWall(y0, 1), 'panelInDark');
    add(capWall(y1, -1), 'shelterPad');
    add(frontFrame(), 'shelterPad');
    const back = new THREE.PlaneGeometry(2 * X, y1 - y0);
    back.rotateY(Math.PI);
    back.translate(0, (y0 + y1) / 2, z1);
    add(back, 'padDark');
    const b = new Builder();
    // the fold-down seat and its harness, against the back wall
    b.box(0.5, 0.06, 0.34, 'padDark', [0, 0.0, z1 - 0.19], null, 0.02);
    b.box(0.46, 0.5, 0.06, 'pad', [0, 0.3, z1 - 0.04], [0.08, 0, 0], 0.02);
    b.box(0.2, 0.16, 0.06, 'pad', [0, 0.82, z1 - 0.05], null, 0.02);
    for (const s of [-1, 1]) {
      b.box(0.045, 0.62, 0.012, 'harness', [s * 0.12, 0.4, z1 - 0.09], [0.12, 0, s * 0.1], 0.004);
      b.box(0.03, 0.34, 0.03, 'frameIn', [s * 0.24, -0.15, z1 - 0.2], null, 0.006);
    }
    b.box(0.07, 0.05, 0.02, 'buckle', [0, 0.32, z1 - 0.11], null, 0.004);
    // two oxygen bottles and the scrubber canister in the back corners, a gauge
    for (const s of [-1, 1]) {
      b.cyl(0.055, 0.055, 0.62, 'shelterO2', [s * (X - 0.075), 0.66, z1 - 0.08], null, 14);
      b.cyl(0.028, 0.028, 0.05, 'steel', [s * (X - 0.075), 1.0, z1 - 0.08], null, 10);
    }
    b.box(0.16, 0.22, 0.1, 'rack', [-(X - 0.1), -0.22, z1 - 0.12], null, 0.01);
    b.box(0.12, 0.03, 0.005, 'labelIn', [-(X - 0.1), -0.1, z1 - 0.175], null, 0.002);
    b.cyl(0.035, 0.035, 0.012, 'shelterGauge', [X - 0.15, 1.0, z1 - 0.15], [Math.PI / 2, 0, 0], 16);
    // the lamp in the ceiling, a red strip along the floor, handholds, the placards
    b.box(0.16, 0.015, 0.06, 'shelterLamp', [0, y1 - 0.012, 1.38], null, 0.004);
    for (const s of [-1, 1]) {
      b.box(0.01, 0.01, z1 - 1.05, 'shelterRed', [s * (X - 0.01), y0 + 0.012, (1.05 + z1) / 2], null, 0.002);
      b.pipe(V(s * (X - 0.03), 0.95, 1.2), V(s * (X - 0.03), 0.95, 1.65), 0.012, 'steel', 8);
    }
    b.box(0.22, 0.05, 0.004, 'labelIn', [0, y1 - 0.06, z1 - 0.004], null, 0.002);
    // the console's and the small screen's mounts (the screens themselves: init)
    b.box(0.05, 0.08, 0.06, 'frameIn', [-(X - 0.03), 0.42, 1.36], null, 0.01);
    b.box(0.05, 0.06, 0.05, 'frameIn', [X - 0.03, 0.55, 1.34], null, 0.01);
    this.group.add(b.build(M, { castShadow: false }));
    this.group.traverse((o) => { if (o.isMesh) o.layers.set(LAYER_NEAR); });
    this.group.visible = false;
  }

  /** what is left when H8 is gone: the box in its frame, torn edges where the cockpit was cut away,
   * a strobe and the little emergency camera */
  buildPod() {
    const M = this.M, { X, y0, y1, z1 } = SHELTER;
    const b = new Builder();
    const cz = (0.82 + z1) / 2, d = z1 - 0.78;
    b.box(2 * X + 0.14, y1 - y0 + 0.14, d + 0.08, 'podShell', [0, (y0 + y1) / 2, cz + 0.02], null, 0.05);
    // ribs and armour plates riveted round it
    for (let i = 0; i < 4; i++) b.box(2 * X + 0.2, 0.06, d + 0.12, 'frameIn', [0, y0 + 0.1 + i * 0.42, cz + 0.02], null, 0.01);
    for (const s of [-1, 1]) b.box(0.05, y1 - y0 + 0.1, d * 0.8, 'armorPlain', [s * (X + 0.1), (y0 + y1) / 2, cz + 0.05], null, 0.02);
    b.box(2 * X + 0.1, y1 - y0 + 0.05, 0.08, 'armorPlain', [0, (y0 + y1) / 2, z1 + 0.1], null, 0.02);
    // the torn front: jagged plates bent outward round where the cockpit was
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2;
      const r = 0.5 + 0.12 * Math.sin(k * 2.7);
      b.box(0.22 + 0.1 * Math.sin(k * 1.3), 0.03, 0.18 + 0.12 * Math.cos(k * 1.9), 'podTorn', [Math.cos(a) * r * 0.85, 0.37 + Math.sin(a) * r * 1.2, 0.74 - 0.05 * Math.sin(k)], [0.4 * Math.sin(k * 3.1), a, 0.6 * Math.cos(k * 2.3)], 0.005);
    }
    b.cyl(0.05, 0.05, 0.08, 'shelterStrobe', [0, y1 + 0.12, cz], null, 10);
    b.cyl(0.035, 0.035, 0.1, 'steel', [X + 0.12, y1 - 0.1, z1], [Math.PI / 2, 0, 0], 10);
    this.pod = b.build(M, { castShadow: false });
    this.pod.name = 'h8Pod';
    this.pod.traverse((o) => { if (o.isMesh) o.layers.set(LAYER_NEAR); });
    this.pod.visible = false;
  }

  /** the door's inner lining, riding on the display's sliding panel */
  buildDoorLiner(pivot) {
    const S = H8.shelter, Rl = R + 0.03;
    const pos = [], idx = [];
    const NA = 10, NE = 14;
    for (let j = 0; j <= NE; j++) {
      const el = S.el0 + (S.el1 - S.el0) * j / NE;
      for (let i = 0; i <= NA; i++) {
        const az = S.az - S.hw + 2 * S.hw * i / NA;
        pos.push(Cc.x + Math.sin(az) * Math.cos(el) * Rl - Cc.x, Cc.y + Math.sin(el) * Rl, Cc.z - Math.cos(az) * Math.cos(el) * Rl - Cc.z);
      }
    }
    // facing outward (into the shelter): from the cockpit only its back shows, and is not drawn
    for (let j = 0; j < NE; j++) for (let i = 0; i < NA; i++) {
      const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const liner = new THREE.Mesh(g, this.M.shelterPad);
    liner.layers.set(LAYER_NEAR);
    // a handle and the placard on it
    const hb = new Builder();
    const at = (el, az, r) => [Math.sin(az) * Math.cos(el) * r, Cc.y + Math.sin(el) * r, -Math.cos(az) * Math.cos(el) * r];
    hb.box(0.04, 0.16, 0.03, 'steel', at(0.1, S.az + S.hw * 0.7, R + 0.05), [0, S.az, 0], 0.01);
    hb.box(0.18, 0.08, 0.004, 'labelIn', at(0.32, S.az, R + 0.035), [0, S.az, 0], 0.002);
    const h = hb.build(this.M, { castShadow: false });
    h.traverse((o) => { if (o.isMesh) o.layers.set(LAYER_NEAR); });
    pivot.add(liner, h);
    this.liner = [liner, h];
    // adrift the display (and its sliding panel) is gone: the shelter keeps the door's inside as
    // its own front wall
    const front = new THREE.Group();
    front.position.set(Cc.x, 0, Cc.z);
    front.add(liner.clone(), h.clone());
    front.visible = false;
    this.group.add(front);
    this.podDoor = front;
  }

  /** the screens (once the monitors exist): the console — every page of H8's, B-29's over the
   * link — and the small outside view */
  init(g) {
    const { X } = SHELTER;
    const eye = SHELTER.eye;
    const face = (p) => eye.clone().sub(p).setY(0).normalize();
    const pC = V(-(X - 0.06), 0.47, 1.33), pS = V(X - 0.065, 0.6, 1.3);
    this.console = g.monitors.addSlot({ id: 'h8sys', pos: pC, n: face(pC), up: V(0, 1, 0), w: 0.3, h: 0.19, res: 640, h8: true }, this.group, DOCK);
    this.screen = g.monitors.addSlot({ id: 'h8shcam', pos: pS, n: face(pS), up: V(0, 1, 0), w: 0.2, h: 0.1125, res: 360, h8: true }, this.group, DOCK);
    
    // getting in: a tap on the panel from the cockpit opens it; a tap into the open shelter sits
    const C = g.interact;
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), C.proxyMat);
    proxy.position.set(0, 0.38, 1.12);
    proxy.layers.set(LAYER_PROXY);
    this.v.int.group.add(proxy);
    C.addMesh(proxy, () => this.tapped(), { maxDist: 2.4, enabled: () => g.player.state !== 'seated' && (this.v.mode === 'docked' || this.v.crew) });
    this.proxy = proxy;
  }

  // ------------------------------------------------------------------ use
  get sealed() { return this.open < 0.02; }

  /** a point of the physics frame inside the box */
  containsPF(p) {
    const x = p.x - DOCK.x, y = p.y - DOCK.y, z = p.z - DOCK.z;
    const { X, y0, y1, z1 } = SHELTER;
    return Math.abs(x) < X && y > y0 - 0.02 && y < y1 + 0.02 && z < z1 && z > zFront(y, Math.abs(x)) - 0.05;
  }

  /** the opening between the cockpit and the shelter (m^2) */
  flowArea() { return this.v.mode === 'pod' ? 0 : this.open * AREA; }

  o2Hours() { return this.o2 / (BREATH * 3600); }
  o2Text() { const h = this.o2Hours(); return h >= 1 ? `${h.toFixed(1)} 時間` : `${Math.round(h * 60)} 分`; }

  toggle() {
    if (this.v.mode === 'pod') return;
    this.target = this.target > 0.5 ? 0 : 1;
    this.sound();
    if (this.target > 0.5) this.v.say('hachi_shelter_open', {}, { minGap: 4 });
  }

  /** from the cockpit: open the panel, then in */
  tapped() {
    const g = this.v.g;
    if (this.open < 0.95) { if (this.target < 0.5) this.toggle(); return; }
    this.enter();
  }

  enter() {
    const g = this.v.g, pl = g.player;
    g.gameplay.fadeAction(() => {
      pl.teleport(SHELTER.center.clone().add(DOCK));
      g.systems.sit(this.seat);
      pl.yaw = 0; pl.pitch = -0.05;
      this.sitT = 0;
    });
  }

  sound() {
    const A = this.v.g.audio;
    if (!A.ready) return;
    const p = V(0, 0.4, 1.0).add(DOCK);
    A.doorMotor && A.doorMotor(p, this.target > 0.5);
  }

  // ------------------------------------------------------------------ per step
  update(dt) {
    const v = this.v, g = v.g, pl = g.player, ls = g.lifeSupport;
    const was = this.occupied;
    this.occupied = pl.state === 'seated' && pl.seat === this.seat;
    // the door: 1.4 s along its track
    const sp = dt / 1.4;
    this.open = this.target > this.open ? Math.min(this.target, this.open + sp) : Math.max(this.target, this.open - sp);
    // seated: it shuts behind him; out of the seat: it opens to let him out, then shuts again
    if (this.occupied) {
      this.sitT += dt;
      if (this.sitT > 0.6 && this.sitT - dt <= 0.6 && v.mode !== 'pod') { this.target = 0; this.sound(); setTimeout(() => this.occupied && this.v.say('hachi_shelter_seal', {}, { minGap: 20 }), 1500); }
    } else if (was) { this.leftT = 0; if (v.mode !== 'pod') { this.target = 1; this.open = Math.max(this.open, 0.98); } }
    if (this.leftT >= 0) { this.leftT += dt; if (this.leftT > 3.5) { this.leftT = -1; this.target = 0; this.sound(); } }
    // its air: sealed, its own bottles keep it breathable (and scrub it); open, it shares the
    // cockpit's while the bottles are topped up from H8
    const z = ls.z.h8shelter;
    if (z) {
      const intact = v.mode !== 'pod' && v.mode !== 'lost';
      if (this.sealed || !intact) {
        const want = Math.max(0, 21.3 - z.o2);
        const dO = Math.min(want, 0.02 * dt, this.o2 / z.vol);
        if (dO > 0) { z.o2 += dO; this.o2 -= dO * z.vol; }
        // (it holds its pressure: what leaks is made up from the same bottles)
        const p = z.n2 + z.o2 + z.co2;
        if (p < 97 && this.o2 > 0) { const dn = Math.min(97 - p, 0.05 * dt); z.n2 += dn; this.o2 -= dn * z.vol * 0.25; }
        if (this.lioh > 0) {
          const s = Math.min(1, dt * 0.02) * (z.co2 > 0.05 ? 1 : 0);
          z.co2 -= (z.co2 - 0.04) * s;
          if (this.occupied) this.lioh = Math.max(0, this.lioh - dt / (10.5 * 3600));
        }
      }
      if (intact && v.awake > 0.3) {
        this.o2 = Math.min(FULL, this.o2 + FULL * dt / 1800);
        if (!this.occupied) this.lioh = Math.min(1, this.lioh + dt / 3600);
      }
      this.o2 = Math.max(0, this.o2);
    }
    // the battery: only while adrift does it run down (some 30 hours of lamp and screens)
    if (v.mode === 'pod') this.battery = Math.max(0, this.battery - dt / (30 * 3600));
    else this.battery = Math.min(1, this.battery + dt / 600);
    // the oxygen left, said as it runs low
    if (this.occupied && (this.sealed || v.mode === 'pod')) {
      const h = this.o2Hours();
      const mark = h < 0.5 ? 0.5 : h < 1 ? 1 : h < 3 ? 3 : h < 6 ? 6 : 99;
      if (mark < this.saidO2) { this.saidO2 = mark; v.say('hachi_shelter_o2', { t: this.o2Text() }, { force: true }); }
    } else if (this.o2Hours() > 9) this.saidO2 = 99;
  }

  /** per drawn frame: what shows, the lamp */
  updateVisual(eyePF) {
    const v = this.v, M = this.M;
    const pod = v.mode === 'pod';
    const inside = !!(eyePF && this.containsPF(eyePF));
    this.group.visible = pod ? inside : v.int.group.visible && (this.open > 0.002 || inside || this.occupied);
    this.pod.visible = pod && !inside;
    if (this.liner) for (const l of this.liner) l.visible = !pod;
    if (this.podDoor) this.podDoor.visible = pod;
    const lit = this.battery > 0 && (this.occupied || this.open > 0.01 || pod);
    M.shelterLamp.emissiveIntensity = lit ? 0.9 : 0;
    M.shelterRed.emissiveIntensity = lit ? 1.4 + (pod ? 0.8 * Math.sin(performance.now() / 300) : 0) : 0;
    M.shelterGauge.emissiveIntensity = lit ? 0.8 : 0;
    // the drifting shelter's strobe: a double flash every two seconds
    const ph = (performance.now() / 2000) % 1;
    M.shelterStrobe.emissiveIntensity = pod && this.battery > 0 ? 9 * (Math.max(0, 1 - Math.abs(ph - 0.02) / 0.02) + Math.max(0, 1 - Math.abs(ph - 0.14) / 0.02)) : 0;
  }

  /** the lamp in the light pool (dim; nothing more in here) */
  lampIntensity() { return this.battery > 0 && (this.occupied || this.open > 0.02 || this.v.mode === 'pod') ? 0.22 : 0; }

  // ------------------------------------------------------------------ save
  serialize() { return { o2: +this.o2.toFixed(3), lioh: +this.lioh.toFixed(4), bat: +this.battery.toFixed(4) }; }
  restore(s) { if (!s) return; this.o2 = s.o2 ?? FULL; this.lioh = s.lioh ?? 1; this.battery = s.bat ?? 1; }
}
