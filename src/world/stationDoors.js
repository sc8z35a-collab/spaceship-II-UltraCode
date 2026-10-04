// Automatic pressure doors of the stations: a thick bolted portal set into the wall, two heavy
// leaves that slide apart into the wall pockets when someone walks up (eased, with a hiss), glass
// slits and LED edges that show the state, and kinematic colliders that move with the leaves.
// A door can be locked (emergency): it then stays shut, its lights turn red and it refuses.
import * as THREE from 'three';
import { R } from '../physics/localPhysics.js';
import { roundPolygon } from '../ship/sweep.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function rrShape(w, h, r, cy = 0, floorCut = false) {
  const pts = floorCut
    ? roundPolygon([[-w / 2, cy - h / 2], [w / 2, cy - h / 2], [w / 2, cy + h / 2], [-w / 2, cy + h / 2]], [0, 0, r, r], 8)
    : roundPolygon([[-w / 2, cy - h / 2], [w / 2, cy - h / 2], [w / 2, cy + h / 2], [-w / 2, cy + h / 2]], r, 8);
  return pts;
}

export class StationDoor {
  /**
   * def: { c: Vector3 (centre of the opening at floor level, mid-wall), normal: 'z' | 'x',
   *        w, h, depth (wall thickness), label, frameKey, leafKey, trimKey }
   * M: material set (needs steel, gold, black, glass, led, lampWarm; ledRed / ledGreen added here)
   */
  constructor(def, M) {
    this.def = def;
    this.open = 0;
    this.target = 0;
    this.locked = false;
    this.hold = 0;
    this.cols = null;
    const w = def.w, h = def.h, d = def.depth;
    this.group = new THREE.Group();
    this.group.name = 'stationDoor_' + (def.label || '');
    // local frame: x across the opening, y up, z through the wall
    this.group.position.copy(def.c);
    if (def.normal === 'x') this.group.rotation.y = Math.PI / 2;
    this.group.updateMatrix();
    if (!M.ledRed) M.ledRed = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 0.08, 0.05), emissiveIntensity: 2.5 });
    if (!M.ledGreen) M.ledGreen = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.25, 1, 0.45), emissiveIntensity: 2.2 });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); this.group.add(m); return m; };

    // ---- portal: a deep bolted frame filling the wall thickness around the opening
    const fw = 0.34;   // frame band width
    const outer = rrShape(w + fw * 2, h + fw, 0.3, (h + fw) / 2, true);
    const inner = rrShape(w, h, 0.2, h / 2 + 0.001, true);
    const s = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
    s.holes.push(new THREE.Path(inner.map(([x, y]) => new THREE.Vector2(x, y + 0.002))));
    const fg = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 8 });
    fg.translate(0, 0, -d / 2);
    add(fg, M[def.frameKey || 'steel'], 0, 0, 0);
    // gold edge bands on both faces, hazard stripes along the sill, bolts around the frame
    for (const sz of [-1, 1]) {
      const band = rrShape(w + 0.06, h + 0.03, 0.22, (h + 0.03) / 2, true).map(([x, y]) => V(x, y, sz * (d / 2 + 0.035)));
      const curve = new THREE.CatmullRomCurve3(band, false);
      add(new THREE.TubeGeometry(curve, 120, 0.022, 6, false), M[def.trimKey || 'gold'], 0, 0, 0);
      const ob = rrShape(w + fw * 2 - 0.08, h + fw - 0.04, 0.28, (h + fw - 0.04) / 2, true).map(([x, y]) => V(x, y, sz * (d / 2 + 0.034)));
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ob, false), 120, 0.014, 6, false), M.black, 0, 0, 0);
      const boltG = new THREE.CylinderGeometry(0.018, 0.02, 0.02, 6);
      boltG.rotateX(Math.PI / 2);
      const off = w / 2 + fw * 0.55;
      for (let y = 0.25; y < h - 0.1; y += 0.42) for (const x of [-off, off]) add(boltG, M.steel, x, y, sz * (d / 2 + 0.04));
      for (let x = -w / 2 + 0.1; x <= w / 2 - 0.1; x += 0.36) add(boltG, M.steel, x, h + fw * 0.5, sz * (d / 2 + 0.04));
      // status lamps on the header
      this['lamp' + (sz > 0 ? 'A' : 'B')] = add(new THREE.SphereGeometry(0.035, 12, 8), M.ledGreen, w / 2 - 0.1, h + fw * 0.5, sz * (d / 2 + 0.05));
    }
    const sill = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.012, d + 0.06), M.black);
    sill.position.set(0, 0.006, 0);
    this.group.add(sill);
    // ---- leaves
    this.leaves = [];
    const lw = w / 2 + 0.03, lt = 0.09;
    for (const side of [-1, 1]) {
      const leaf = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(lw, h - 0.02, lt), M[def.leafKey || 'steel']);
      body.position.set(0, (h - 0.02) / 2, 0);
      leaf.add(body);
      // frosted glass slit, gold trim, LED meeting edge, kick plate
      const gl = new THREE.Mesh(new THREE.BoxGeometry(0.14, h * 0.55, lt + 0.01), M.glass);
      gl.position.set(-side * (lw / 2 - 0.32), h * 0.55, 0);
      leaf.add(gl);
      for (const sz of [-1, 1]) {
        const tr = new THREE.Mesh(new THREE.BoxGeometry(lw - 0.08, 0.025, 0.012), M[def.trimKey || 'gold']);
        tr.position.set(0, h * 0.25, sz * (lt / 2 + 0.006));
        leaf.add(tr);
        const kick = new THREE.Mesh(new THREE.BoxGeometry(lw - 0.06, 0.16, 0.01), M.black);
        kick.position.set(0, 0.1, sz * (lt / 2 + 0.005));
        leaf.add(kick);
      }
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, h - 0.3, lt + 0.012), M.ledGreen);
      led.position.set(-side * (lw / 2 - 0.012), h / 2, 0);
      leaf.add(led);
      leaf.userData = { side, led };
      leaf.position.set(side * lw / 2, 0, 0);
      this.group.add(leaf);
      this.leaves.push(leaf);
    }
    this.lw = lw; this.lt = lt;
    this.leafMatOpen = M.ledGreen; this.leafMatLocked = M.ledRed;
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
  update(dt, who, audio) {
    const c = this.def.c;
    const near = who && Math.abs(who.y - (c.y + 0.9)) < 2.2 && Math.hypot(who.x - c.x, who.z - c.z) < 2.1;
    if (this.locked) this.target = 0;
    else if (near) { this.target = 1; this.hold = 1.2; }
    else { this.hold -= dt; if (this.hold <= 0) this.target = 0; }
    const prev = this.open;
    const sp = 1.15;
    this.open = this.target > this.open ? Math.min(this.target, this.open + dt * sp) : Math.max(this.target, this.open - dt * sp * 0.8);
    if (audio && audio.ready && ((prev === 0 && this.open > 0) || (prev === 1 && this.open < 1))) {
      audio._burst(c.clone().add(V(0, 1.2, 0)), { dur: 0.55, freq: 1400, q: 0.5, gain: 0.12, type: 'white', filter: 'bandpass', sweep: -0.5 });
      audio.doorMotor && audio.doorMotor(c.clone().add(V(0, 2.2, 0)), this.target > 0.5);
    }
    // eased travel (heavy leaves start and stop softly)
    const e = this.open * this.open * (3 - 2 * this.open);
    for (const leaf of this.leaves) leaf.position.x = leaf.userData.side * (this.lw / 2 + e * (this.lw - 0.06));
    const lockedMat = this.locked ? this.leafMatLocked : this.leafMatOpen;
    for (const leaf of this.leaves) leaf.userData.led.material = lockedMat;
    if (this.lampA) { this.lampA.material = lockedMat; this.lampB.material = lockedMat; }
    if (this.cols) {
      const p = V(0, 0, 0);
      this.leaves.forEach((leaf, i) => {
        const u = leaf.userData.side * (this.lw / 2 + e * (this.lw - 0.06));
        p.set(u, (this.def.h - 0.02) / 2, 0).applyMatrix4(this.group.matrix);
        this.cols[i].body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      });
    }
  }
}
