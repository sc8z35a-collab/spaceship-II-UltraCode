// Automatic pressure doors of the stations. A deep bolted portal set into the wall; two heavy
// layered leaves with interlocking teeth and rubber seals on their meeting edges, hung on rollers
// that run along an exposed track over the opening. Opening is a real sequence: the locking bar
// across the meeting line swings up (clunk), the leaves pop out of their seals with a hiss and a
// puff of vapour, then slide apart into the wall pockets — the chaser lights round the frame
// running and the beacon on the header turning while they move. Closing runs it backwards (seal
// thud, the bar swings down). A status screen beside the door shows both sections' pressure and
// the door's state. A locked door (the station's emergency protocol) slams shut, its lights turn
// red and it refuses; its screen says why.
import * as THREE from 'three';
import { R } from '../physics/localPhysics.js';
import { roundPolygon } from '../ship/sweep.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const SECTION_JP = { lobby: 'ロビー', promenade: 'プロムナード', atrium: '中央アトリウム', ring: 'リング居住区' };

function rrShape(w, h, r, cy = 0, floorCut = false) {
  const pts = floorCut
    ? roundPolygon([[-w / 2, cy - h / 2], [w / 2, cy - h / 2], [w / 2, cy + h / 2], [-w / 2, cy + h / 2]], [0, 0, r, r], 8)
    : roundPolygon([[-w / 2, cy - h / 2], [w / 2, cy - h / 2], [w / 2, cy + h / 2], [-w / 2, cy + h / 2]], r, 8);
  return pts;
}

let HAZ = null;
/** yellow-black hazard stripes */
function hazardTex() {
  if (HAZ) return HAZ;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d9b21c'; g.fillRect(0, 0, 64, 256);
  g.fillStyle = '#141414';
  for (let y = -64; y < 320; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(64, y + 32); g.lineTo(64, y + 56); g.lineTo(0, y + 24); g.closePath(); g.fill(); }
  HAZ = new THREE.CanvasTexture(c);
  HAZ.colorSpace = THREE.SRGBColorSpace;
  HAZ.wrapT = THREE.RepeatWrapping;
  return HAZ;
}

let GLOW = null;
function glowTex() {
  if (GLOW) return GLOW;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  GLOW = new THREE.CanvasTexture(c);
  return GLOW;
}

/** a box with rounded (bevelled) edges, centred */
function bevelBox(w, h, d, r) {
  const s = new THREE.Shape(rrShape(w, h, r, 0).map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.9, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(d - 2 * r) / 2);
  return g;
}

export class StationDoor {
  /**
   * def: { c: Vector3 (centre of the opening at floor level, mid-wall), normal: 'z' | 'x',
   *        w, h, depth (wall thickness), label, link: [sectionA, sectionB], frameKey, leafKey, trimKey }
   * M: material set (needs steel, gold, black, glass; door lights are added here)
   */
  constructor(def, M) {
    this.def = def;
    this.open = 0;            // leaves slid apart 0..1
    this.seal = 1;            // 1: pressed into the seals, 0: popped out
    this.lockK = 1;           // locking bar: 1 across the meeting line, 0 swung up
    this.target = 0;
    this.locked = false;
    this.emergency = false;   // sealed by the station's pressure protocol
    this.hold = 0;
    this.cols = null;
    this.air = null;          // the station's air (set while docked): both sides' pressure
    const w = def.w, h = def.h, d = def.depth;
    this.group = new THREE.Group();
    this.group.name = 'stationDoor_' + (def.label || '');
    // local frame: x across the opening, y up, z through the wall
    this.group.position.copy(def.c);
    if (def.normal === 'x') this.group.rotation.y = Math.PI / 2;
    this.group.updateMatrix();
    if (!M.ledRed) M.ledRed = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 0.08, 0.05), emissiveIntensity: 2.5 });
    if (!M.ledGreen) M.ledGreen = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.25, 1, 0.45), emissiveIntensity: 2.2 });
    if (!M.ledOff) M.ledOff = new THREE.MeshStandardMaterial({ color: 0x1a0606, roughness: 0.4 });
    if (!M.ledAmber) M.ledAmber = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 0.55, 0.08), emissiveIntensity: 2.4 });
    if (!M.doorRubber) M.doorRubber = new THREE.MeshStandardMaterial({ color: 0x0e0e0f, roughness: 0.9, metalness: 0 });
    if (!M.doorHazard) M.doorHazard = new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.6, metalness: 0.1 });
    if (!M.doorChrome) M.doorChrome = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.18, metalness: 1 });
    const steel = M[def.frameKey || 'steel'], leafMat = M[def.leafKey || 'steel'], trim = M[def.trimKey || 'gold'];
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = this.group) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m; };

    // ---- portal: a deep bolted frame filling the wall thickness around the opening
    const fw = 0.34;   // frame band width
    const outer = rrShape(w + fw * 2, h + fw, 0.3, (h + fw) / 2, true);
    const inner = rrShape(w, h, 0.2, h / 2 + 0.001, true);
    const s = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
    s.holes.push(new THREE.Path(inner.map(([x, y]) => new THREE.Vector2(x, y + 0.002))));
    const fg = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 8 });
    fg.translate(0, 0, -d / 2);
    add(fg, steel, 0, 0, 0);
    this.faces = [];
    for (const sz of [-1, 1]) {
      const zf = sz * (d / 2 + 0.035);
      // gold edge band, black outline, bolts round the frame
      const band = rrShape(w + 0.06, h + 0.03, 0.22, (h + 0.03) / 2, true).map(([x, y]) => V(x, y, zf));
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(band, false), 120, 0.022, 6, false), trim, 0, 0, 0);
      const ob = rrShape(w + fw * 2 - 0.08, h + fw - 0.04, 0.28, (h + fw - 0.04) / 2, true).map(([x, y]) => V(x, y, sz * (d / 2 + 0.034)));
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ob, false), 120, 0.014, 6, false), M.black, 0, 0, 0);
      const boltG = new THREE.CylinderGeometry(0.018, 0.02, 0.02, 6);
      boltG.rotateX(Math.PI / 2);
      const off = w / 2 + fw * 0.55;
      for (let y = 0.25; y < h - 0.1; y += 0.42) for (const x of [-off, off]) add(boltG, M.steel, x, y, sz * (d / 2 + 0.04));
      // hazard stripes up both jambs
      for (const x of [-1, 1]) {
        add(new THREE.PlaneGeometry(0.07, h - 0.3), M.doorHazard, x * (w / 2 + 0.11), (h - 0.3) / 2 + 0.12, sz * (d / 2 + 0.036), 0, sz < 0 ? Math.PI : 0, 0);
      }
      // the roller track across the header, its end stops
      add(new THREE.BoxGeometry(w * 2 + 0.2, 0.05, 0.05), M.black, 0, h + 0.07, sz * (d / 2 + 0.07));
      for (const x of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.12, 0.07), M.steel, x * (w + 0.12), h + 0.07, sz * (d / 2 + 0.07));
      // chaser lights along the inner frame edge (one instanced strip per face)
      const n = 14;
      const chaser = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n);
      const m = new THREE.Matrix4();
      const path = [];
      for (let k = 0; k < n; k++) {
        // up the left jamb, across the top, down the right one
        const u = k / (n - 1);
        const L = (h - 0.25) * 2 + w;
        let p = u * L, x, y;
        if (p < h - 0.25) { x = -w / 2 - 0.05; y = 0.2 + p; } else if (p < h - 0.25 + w) { x = -w / 2 + (p - (h - 0.25)); y = h + 0.04; } else { x = w / 2 + 0.05; y = h - 0.05 - (p - (h - 0.25) - w); }
        path.push([x, y]);
        m.makeTranslation(x, y, sz * (d / 2 + 0.05));
        chaser.setMatrixAt(k, m);
        chaser.setColorAt(k, new THREE.Color(0.1, 0.4, 0.2));
      }
      chaser.instanceMatrix.needsUpdate = true;
      this.group.add(chaser);
      // the beacon on the header (turns while the door moves; red while it is locked)
      const bHouse = add(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 16), M.black, 0, h + fw * 0.62, sz * (d / 2 + 0.08), Math.PI / 2, 0, 0);
      const bDome = add(new THREE.SphereGeometry(0.065, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.ledOff, 0, h + fw * 0.62, sz * (d / 2 + 0.13), sz * Math.PI / 2, 0, 0);
      const beam = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(1.6, 0.8, 0.15), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      beam.position.set(0, h + fw * 0.62, sz * (d / 2 + 0.14));
      beam.scale.setScalar(0.5);
      this.group.add(beam);
      // status lamps on the header (as before) and the screen beside the door
      const lamp = add(new THREE.SphereGeometry(0.035, 12, 8), M.ledGreen, w / 2 - 0.1, h + fw * 0.5, sz * (d / 2 + 0.05));
      const cv = document.createElement('canvas');
      cv.width = 320; cv.height = 200;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      const screen = add(new THREE.PlaneGeometry(0.34, 0.2125), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), w / 2 + fw + 0.32, 1.42, sz * (d / 2 + 0.03), 0, sz < 0 ? Math.PI : 0, 0);
      add(new THREE.BoxGeometry(0.4, 0.27, 0.04), M.black, w / 2 + fw + 0.32, 1.42, sz * (d / 2 + 0.005));
      this.faces.push({ sz, chaser, path, bDome, beam, lamp, cv, g: cv.getContext('2d'), tex, screen });
    }
    const sill = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.012, d + 0.06), M.black);
    sill.position.set(0, 0.006, 0);
    this.group.add(sill);

    // ---- leaves
    this.leaves = [];
    const lw = w / 2 + 0.03, lt = 0.12;
    const teeth = [0.16, 0.36, 0.56, 0.76];
    for (const side of [-1, 1]) {
      const leaf = new THREE.Group();
      const hh = h - 0.02;
      add(bevelBox(lw, hh, lt, 0.012), leafMat, 0, hh / 2, 0, 0, 0, 0, leaf);
      for (const sz of [-1, 1]) {
        const zf = sz * (lt / 2 + 0.004);
        // raised inner panel with two grooves, a gold trim line, a kick plate
        add(bevelBox(lw - 0.2, hh * 0.62, 0.012, 0.004), leafMat, 0, hh * 0.56, zf, 0, 0, 0, leaf);
        for (const yy of [0.42, 0.7]) add(new THREE.BoxGeometry(lw - 0.24, 0.012, 0.006), M.black, 0, hh * yy, zf + sz * 0.007, 0, 0, 0, leaf);
        add(new THREE.BoxGeometry(lw - 0.08, 0.025, 0.012), trim, 0, hh * 0.24, zf, 0, 0, 0, leaf);
        add(new THREE.BoxGeometry(lw - 0.06, 0.16, 0.01), M.black, 0, 0.1, zf, 0, 0, 0, leaf);
        // hazard stripe by the meeting edge
        const hz = add(new THREE.PlaneGeometry(0.06, hh * 0.7), M.doorHazard, -side * (lw / 2 - 0.1), hh * 0.5, zf + sz * 0.002, 0, sz < 0 ? Math.PI : 0, 0, leaf);
        hz.renderOrder = 1;
      }
      // frosted glass slit
      add(new THREE.BoxGeometry(0.14, h * 0.5, lt + 0.01), M.glass, side * (lw / 2 - 0.3), h * 0.58, 0, 0, 0, 0, leaf);
      // the meeting edge: rubber seal, interlocking teeth, the LED strip
      add(new THREE.BoxGeometry(0.03, hh - 0.06, lt * 0.7), M.doorRubber, -side * (lw / 2 + 0.008), hh / 2, 0, 0, 0, 0, leaf);
      for (let k = 0; k < teeth.length; k++) {
        if ((k % 2 === 0) !== (side < 0)) continue;
        add(new THREE.BoxGeometry(0.07, 0.16, lt * 0.55), M.steel, -side * (lw / 2 + 0.035), hh * teeth[k] + 0.08, 0, 0, 0, 0, leaf);
      }
      const led = add(new THREE.BoxGeometry(0.02, h - 0.3, lt + 0.012), M.ledGreen, -side * (lw / 2 - 0.03), h / 2, 0, 0, 0, 0, leaf);
      // rollers on the header track (both faces)
      const rollers = [];
      for (const sz of [-1, 1]) for (const xx of [-lw * 0.3, lw * 0.3]) {
        const rg = new THREE.Group();
        rg.position.set(xx, h + 0.07, sz * (d / 2 + 0.07) - leaf.position.z);
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 14), M.doorChrome);
        wheel.rotation.x = Math.PI / 2;
        rg.add(wheel);
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.034), M.black);
        rg.add(spoke);
        leaf.add(rg);
        rollers.push(rg);
      }
      leaf.userData = { side, led, rollers };
      leaf.position.set(side * lw / 2, 0, 0);
      this.group.add(leaf);
      this.leaves.push(leaf);
    }
    // ---- the locking bar on each face: on the right leaf, swinging across the meeting line
    this.bars = [];
    for (const sz of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(-lw / 2 + 0.16, h * 0.5, sz * (lt / 2 + 0.03));
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 18), M.doorChrome, 0, 0, 0, Math.PI / 2, 0, 0, pivot);
      const arm = add(new THREE.BoxGeometry(0.5, 0.055, 0.025), M.steel, -0.16, 0, sz * 0.012, 0, 0, 0, pivot);
      add(new THREE.BoxGeometry(0.08, 0.075, 0.035), M.doorHazard, -0.39, 0, sz * 0.012, 0, 0, 0, pivot);
      arm.userData.k = 1;
      this.leaves[1].add(pivot);
      // the catch on the left leaf the bar drops into
      const cat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.03), M.steel);
      cat.position.set(lw / 2 - 0.12, h * 0.5, sz * (lt / 2 + 0.02));
      this.leaves[0].add(cat);
      this.bars.push(pivot);
    }
    this.lw = lw; this.lt = lt;
    this.leafMatOpen = M.ledGreen; this.leafMatLocked = M.ledRed; this.leafMatOff = M.ledOff; this.leafMatAmber = M.ledAmber;
    this.drawT = 0;
    this.shown = '';
    this.phase = 'shut';
  }

  /** world (ship-local) centre of a leaf at the current opening */
  _leafPos(leaf, out) {
    const u = leaf.userData.side * (this.lw / 2 + this.open * (this.lw - 0.06));
    out.set(u, (this.def.h - 0.02) / 2, 0).applyMatrix4(this.group.matrix);
    return out;
  }

  attach(phys) {
    if (this.cols) return;
    const q = this.group.quaternion;
    this.cols = this.leaves.map((leaf) => {
      const p = this._leafPos(leaf, V(0, 0, 0));
      const body = phys.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
      const col = phys.world.createCollider(R.ColliderDesc.cuboid(this.lw / 2, (this.def.h - 0.02) / 2, this.lt / 2 + 0.02), body);
      return { body, col };
    });
  }

  detach(phys) {
    if (!this.cols) return;
    for (const c of this.cols) phys.world.removeRigidBody(c.body);
    this.cols = null;
  }

  /** opens for anyone within reach (ship-local position), closes behind them */
  update(dt, who, audio, fx) {
    const c = this.def.c;
    const near = who && Math.abs(who.y - (c.y + 0.9)) < 2.2 && Math.hypot(who.x - c.x, who.z - c.z) < 2.1;
    if (this.locked) this.target = 0;
    else if (near) { this.target = 1; this.hold = 1.2; }
    else { this.hold -= dt; if (this.hold <= 0) this.target = 0; }
    const at = (y) => c.clone().add(V(0, y, 0));
    const snd = audio && audio.ready;
    const prevOpen = this.open, prevSeal = this.seal, prevLock = this.lockK;
    // an emergency closure slams the leaves shut more than twice as fast
    const sp = this.locked ? 2.6 : 1.15;
    if (this.target > 0.5) {
      // the bar swings up, the leaves pop out of their seals, then they slide apart
      if (this.lockK > 0) this.lockK = Math.max(0, this.lockK - dt / 0.35);
      else if (this.seal > 0) this.seal = Math.max(0, this.seal - dt / 0.22);
      else this.open = Math.min(1, this.open + dt * sp);
    } else {
      if (this.open > 0) this.open = Math.max(0, this.open - dt * sp * (this.locked ? 1 : 0.8));
      else if (this.seal < 1) this.seal = Math.min(1, this.seal + dt / (this.locked ? 0.1 : 0.22));
      else if (this.lockK < 1) this.lockK = Math.min(1, this.lockK + dt / (this.locked ? 0.15 : 0.35));
    }
    if (snd) {
      if (prevLock === 1 && this.lockK < 1) audio._burst(at(1.1), { dur: 0.12, freq: 420, q: 1.2, gain: 0.14, type: 'brown', filter: 'lowpass' });   // the bar unlatches
      if (prevLock < 1 && this.lockK === 1) audio.mech(at(1.1), 'latch', { open: false });                                                         // and drops into its catch
      if (prevSeal === 1 && this.seal < 1) audio._burst(at(1.2), { dur: 0.55, freq: 1600, q: 0.5, gain: 0.13, type: 'white', filter: 'bandpass', sweep: 0.5 });
      if (prevSeal < 1 && this.seal === 1) audio._burst(at(1.0), { dur: 0.2, freq: 140, q: 0.8, gain: 0.22, type: 'brown', filter: 'lowpass' });
      if ((prevOpen === 0 && this.open > 0) || (prevOpen === 1 && this.open < 1)) audio.mech(at(2.2), this.locked ? 'heavy' : 'door', { open: this.target > 0.5 });
      if (prevOpen > 0 && this.open === 0 && this.locked) audio.mech(at(1.2), 'latch', { open: false, gain: 1.4 });
    }
    // the seal lets go: a puff of vapour out of the meeting line on both faces
    if (fx && prevSeal === 1 && this.seal < 1) {
      const n = V(0, 0, 1).applyQuaternion(this.group.quaternion);
      for (const s of [-1, 1]) fx.burst('steam', c.clone().add(V(0, 1.1, 0)).addScaledVector(n, s * (this.def.depth / 2 + 0.05)), n.clone().multiplyScalar(s), 14, { speed: 0.6, spread: 0.6 });
    }
    this.t = (this.t || 0) + dt;
    // eased travel (heavy leaves start and stop softly); the seal pops them 12 mm out of the wall
    const e = this.open * this.open * (3 - 2 * this.open);
    const pop = (1 - this.seal) * 0.012;
    for (const leaf of this.leaves) {
      const x = leaf.userData.side * (this.lw / 2 + e * (this.lw - 0.06));
      const dx = x - leaf.position.x;
      leaf.position.x = x;
      leaf.position.z = pop;
      for (const r of leaf.userData.rollers) r.rotation.z -= dx / 0.045;
    }
    // the locking bar swings between across (locked) and up (free)
    for (const b of this.bars) b.rotation.z = (1 - this.lockK) * (Math.PI / 2);
    // lights: green steady when shut and safe, amber chase while moving, red flashing when locked
    const moving = this.open > 0 && this.open < 1 || (this.seal > 0 && this.seal < 1) || (this.lockK > 0 && this.lockK < 1);
    const lockedMat = this.locked ? ((this.t % 1) < 0.6 ? this.leafMatLocked : this.leafMatOff) : moving ? this.leafMatAmber : this.leafMatOpen;
    for (const leaf of this.leaves) leaf.userData.led.material = lockedMat;
    const col = new THREE.Color();
    for (const f of this.faces) {
      f.lamp.material = lockedMat;
      f.bDome.material = this.locked ? this.leafMatLocked : moving ? this.leafMatAmber : this.leafMatOff;
      // the beacon's beam sweeps round while the door moves (or flashes red while locked)
      const on = moving || this.locked;
      const ph = (this.t * (this.locked ? 1.2 : 2.2)) % 1;
      const k = on ? Math.max(0, Math.cos((ph - 0.5) * Math.PI * 2)) ** 6 : 0;
      f.beam.material.opacity = k * 0.9;
      f.beam.material.color.setRGB(this.locked ? 1.8 : 1.6, this.locked ? 0.12 : 0.8, this.locked ? 0.06 : 0.15);
      f.beam.scale.setScalar(0.25 + 0.5 * k);
      // chaser lights: a running pulse while moving, steady when idle
      const n = f.path.length;
      for (let i = 0; i < n; i++) {
        if (this.locked) col.setRGB((this.t % 1) < 0.6 ? 1.6 : 0.1, 0.05, 0.03);
        else if (moving) { const q = ((i / n - this.t * 1.6) % 1 + 1) % 1; const g = Math.max(0, 1 - q * 5); col.setRGB(0.25 + 1.6 * g, 0.18 + 0.9 * g, 0.02); }
        else col.setRGB(0.06, 0.45, 0.2);
        f.chaser.setColorAt(i, col);
      }
      f.chaser.instanceColor.needsUpdate = true;
    }
    // the screens (redrawn when something changes, the pressures once a second)
    this.phase = this.locked ? 'locked' : this.open >= 1 ? 'open' : moving ? 'moving' : 'shut';
    this.drawT -= dt;
    const key = this.phase + (this.air ? '' : '-');
    if (key !== this.shown || this.drawT <= 0) { this.shown = key; this.drawT = 1; this.drawScreens(); }
    if (this.cols) {
      const p = V(0, 0, 0);
      this.leaves.forEach((leaf, i) => {
        const u = leaf.userData.side * (this.lw / 2 + e * (this.lw - 0.06));
        p.set(u, (this.def.h - 0.02) / 2, 0).applyMatrix4(this.group.matrix);
        this.cols[i].body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      });
    }
  }

  drawScreens() {
    const [a, b] = this.def.link || ['lobby', 'promenade'];
    const sec = this.air ? this.air.sec : null;
    const pa = sec && sec[a] ? sec[a].p : 101.3, pb = sec && sec[b] ? sec[b].p : 101.3;
    const na = (sec && sec[a] && sec[a].name) || SECTION_JP[a] || a, nb = (sec && sec[b] && sec[b].name) || SECTION_JP[b] || b;
    const st = { shut: ['閉', 'CLOSED', '#5fe08f'], open: ['開', 'OPEN', '#5fd0ff'], moving: ['作動中', 'CYCLING', '#ffb347'], locked: ['ロック', 'LOCKED', '#ff4d3d'] }[this.phase];
    for (const f of this.faces) {
      const g = f.g;
      g.fillStyle = this.phase === 'locked' ? '#2a0806' : '#06121c';
      g.fillRect(0, 0, 320, 200);
      g.strokeStyle = st[2]; g.lineWidth = 4; g.strokeRect(4, 4, 312, 192);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(200,225,245,0.85)'; g.font = '600 22px sans-serif';
      g.fillText(`${na}  ⇄  ${nb}`, 160, 30);
      g.fillStyle = st[2]; g.font = '700 46px sans-serif';
      g.fillText(st[0], 160, 84);
      g.font = '600 18px monospace';
      g.fillText(st[1], 160, 118);
      g.fillStyle = 'rgba(200,225,245,0.9)'; g.font = '500 20px monospace';
      g.fillText(`${pa.toFixed(1)} kPa | ${pb.toFixed(1)} kPa`, 160, 152);
      if (this.phase === 'locked') { g.fillStyle = '#ff7a66'; g.font = '600 17px sans-serif'; g.fillText(Math.abs(pa - pb) > 5 ? '気圧差あり — 開放禁止' : '非常閉鎖中', 160, 180); }
      f.tex.needsUpdate = true;
    }
  }
}
