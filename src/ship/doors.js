// Sliding pressure doors with visible rack-and-pinion drives, status lights and kinematic
// colliders; the airlock outer hatch is a swinging hatch with locking dogs.
import * as THREE from 'three';
import { RoundedBoxGeometry, roundedRectShape } from './geom.js';
import { DOORS } from './interior.js';
import { DECK_Y, OPENINGS } from './hullShape.js';
import { setLayersDeep, LAYER_NEAR, LAYER_MID } from '../core/layers.js';

function gearGeometry(r, teeth, w) {
  const s = new THREE.Shape();
  for (let i = 0; i <= teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 ? r : r * 0.82;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  return g;
}

export class Door {
  constructor(id, def, M, phys) {
    this.id = id;
    this.def = def;
    this.open = 0;          // 0 closed .. 1 open
    this.target = 0;
    this.locked = false;    // safety interlock / lockdown
    this.jammed = 0;        // 0..1 damage (1 = stuck)
    this.speed = 0.75;
    this.group = new THREE.Group();
    this.group.name = 'door_' + id;
    const w = def.w + 0.02, h = def.h + 0.02;
    const isX = def.axis === 'x';
    // panel
    const shape = roundedRectShape(w, h, 0.22);
    const panel = new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 10 });
    panel.translate(0, h / 2, -0.0225);
    this.panel = new THREE.Mesh(panel, def.hatch ? M.hullOrange : M.panelDark);
    this.panel.castShadow = true; this.panel.receiveShadow = true;
    // details on the panel: window strip, handle, warning stripe
    const win = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.42, 0.06, 2, 0.04), M.black);
    win.position.set(0, h * 0.68, 0);
    const handle = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.24, 0.07, 2, 0.015), M.steel);
    handle.position.set(w * 0.34, h * 0.48, 0);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.05, 0.052), M.plasticY);
    stripe.position.set(0, 0.12, 0);
    this.panel.add(win, handle, stripe);
    // rack on top of the panel
    const rack = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.025, 0.02), M.steel);
    rack.position.set(0, h + 0.02, 0);
    this.panel.add(rack);
    this.group.add(this.panel);
    // fixed drive housing above the opening (one side) with a visible pinion gear
    const housing = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.14, 0.14, 2, 0.02), M.panel);
    housing.position.set(-w * 0.25, h + 0.1, 0.06);
    this.gear = new THREE.Mesh(gearGeometry(0.045, 12, 0.02), M.brass);
    this.gear.position.set(-w * 0.25, h + 0.075, 0.0);
    this.motor = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 12), M.metalDark);
    this.motor.rotation.x = Math.PI / 2;
    this.motor.position.set(-w * 0.25 - 0.09, h + 0.1, 0.06);
    this.group.add(housing, this.gear, this.motor);
    // status lights both sides
    this.lightMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.1, 1, 0.3), emissiveIntensity: 3 });
    for (const s of [-1, 1]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), this.lightMat);
      l.position.set(w * 0.5 + 0.08, h + 0.02, s * 0.06);
      this.group.add(l);
    }
    // place group: local X = slide direction, local Z = wall normal
    if (isX) {
      this.group.position.set(def.at, DECK_Y, def.c);
      this.group.rotation.y = Math.PI / 2;
    } else {
      this.group.position.set(def.c, DECK_Y, def.at);
    }
    this.slideDist = w * 0.92;
    this.group.updateMatrixWorld(true);
    setLayersDeep(this.group, LAYER_NEAR);
    // kinematic collider
    if (phys) {
      const wp = new THREE.Vector3(0, h / 2, 0).applyMatrix4(this.group.matrixWorld);
      const q = this.group.quaternion;
      this.col = phys.addKinematicBox(w / 2, h / 2, 0.04, wp, { x: q.x, y: q.y, z: q.z, w: q.w });
    }
    this.h = h; this.w = w;
    this.moving = false;
    this.onSound = null;
  }

  toggle() {
    if (this.locked || this.jammed >= 1) { this.onSound && this.onSound('denied', this); return false; }
    this.target = this.target > 0.5 ? 0 : 1;
    this.onSound && this.onSound(this.target ? 'open' : 'close', this);
    return true;
  }

  setTarget(v, force = false) {
    if (!force && (this.locked || this.jammed >= 1)) return false;
    if (this.target !== v) { this.target = v; this.onSound && this.onSound(v ? 'open' : 'close', this); }
    return true;
  }

  update(dt) {
    const sp = this.speed * (1 - this.jammed * 0.85);
    const prev = this.open;
    if (this.jammed < 1) {
      const d = this.target - this.open;
      // ease: slow start/stop
      const step = Math.sign(d) * Math.min(Math.abs(d), sp * dt * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, Math.max(0.05, this.open)))));
      this.open += Math.abs(d) < 0.002 ? d : step;
    }
    this.moving = Math.abs(this.open - prev) > 1e-5;
    const e = this.open;
    this.panel.position.x = e * this.slideDist + (this.jammed > 0.3 ? Math.sin(e * 40) * 0.003 : 0);
    this.gear.rotation.z = -this.panel.position.x / 0.045;
    // light colour: green closed+safe, amber moving, red locked
    const c = this.locked || this.jammed >= 1 ? [1, 0.08, 0.05] : this.moving ? [1, 0.6, 0.1] : this.open > 0.5 ? [0.2, 0.6, 1] : [0.1, 1, 0.3];
    this.lightMat.emissive.setRGB(c[0], c[1], c[2]);
    if (this.col) {
      // ship-local placement (group transform is relative to the ship root)
      this.group.updateMatrix(); this.panel.updateMatrix();
      const wp = new THREE.Vector3(0, this.h / 2, 0).applyMatrix4(this.panel.matrix).applyMatrix4(this.group.matrix);
      this.col.body.setNextKinematicTranslation({ x: wp.x, y: wp.y, z: wp.z });
    }
  }

  /** opening area for gas flow (m^2) */
  get flowArea() { return this.open * this.w * this.h * 0.85; }
}

/** airlock outer hatch: swings outward on a hinge after its locking dogs retract */
export class OuterHatch {
  constructor(M, phys) {
    const o = OPENINGS.find((x) => x.kind === 'hatch');
    this.o = o;
    this.open = 0; this.target = 0; this.dogs = 1; // dogs engaged
    this.locked = true;
    this.group = new THREE.Group();
    const m = new THREE.Matrix4().makeBasis(o.v, o.u, o.normal); // local x along ship, y around hull, z outward
    m.setPosition(o.center);
    this.base = new THREE.Group();
    this.base.matrixAutoUpdate = false;
    this.base.matrix.copy(m);
    this.group.add(this.base);
    // hinge at the forward edge (local -x side)
    this.hinge = new THREE.Group();
    this.hinge.position.set(-o.halfH - 0.02, 0, 0.04);
    this.base.add(this.hinge);
    const shape = roundedRectShape(o.halfH * 2 + 0.06, o.halfW * 2 + 0.06, o.radius + 0.02);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 12 });
    g.translate(o.halfH + 0.02, 0, -0.16);
    this.door = new THREE.Mesh(g, M.hull);
    this.door.castShadow = true; this.door.receiveShadow = true;
    this.hinge.add(this.door);
    // inside face details: wheel + dogs
    this.wheel = new THREE.Group();
    const tor = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 24), M.plasticY);
    this.wheel.add(tor);
    for (let k = 0; k < 3; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.02), M.plasticY); sp.rotation.z = k * Math.PI / 3; this.wheel.add(sp); }
    this.wheel.position.set(o.halfH + 0.02, 0, -0.19);
    this.hinge.add(this.wheel);
    this.dogMeshes = [];
    for (const [x, y] of [[0.0, o.halfW * 0.95], [0.0, -o.halfW * 0.95], [o.halfH * 0.95, 0], [-o.halfH * 0.95, 0]]) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.05), M.steel);
      d.position.set(o.halfH + 0.02 + x * 0.92, y * 0.92, -0.18);
      d.userData.dir = new THREE.Vector2(Math.sign(x), Math.sign(y));
      this.hinge.add(d);
      this.dogMeshes.push(d);
    }
    // outside: handle + stripes
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 16, Math.PI), M.handrail);
    h.rotation.x = Math.PI / 2;            // the grab bar arcs out of the door skin
    h.position.set(o.halfH * 1.4, 0, -0.03);
    this.hinge.add(h);
    setLayersDeep(this.group, LAYER_NEAR, LAYER_MID);
    this.group.traverse((x) => x.layers.enable(LAYER_MID));
    if (phys) {
      this.col = phys.addKinematicBox(o.halfH, o.halfW, 0.08, o.center.clone().addScaledVector(o.normal, -0.1), new THREE.Quaternion().setFromRotationMatrix(m));
    }
    this.onSound = null;
  }

  update(dt) {
    // sequence: dogs retract (0.8s) -> swing open ; close: swing -> dogs engage
    if (this.target > 0.5) {
      if (this.dogs > 0) this.dogs = Math.max(0, this.dogs - dt * 1.4);
      else this.open = Math.min(1, this.open + dt * 0.35);
    } else {
      if (this.open > 0) this.open = Math.max(0, this.open - dt * 0.35);
      else this.dogs = Math.min(1, this.dogs + dt * 1.4);
    }
    const a = this.open * 1.75;
    this.hinge.rotation.y = -a;
    this.wheel.rotation.z = (1 - this.dogs) * Math.PI * 2;
    for (const d of this.dogMeshes) {
      const k = this.dogs * 0.05;
      d.position.x = this.o.halfH + 0.02 + d.userData.dir.x * (this.o.halfH * 0.9 + k);
      d.position.y = d.userData.dir.y * (this.o.halfW * 0.9 + k);
    }
    if (this.col) {
      this.hinge.updateMatrix();
      const hm = this.base.matrix.clone().multiply(this.hinge.matrix); // ship-local hinge frame
      const p = new THREE.Vector3(this.o.halfH + 0.02, 0, -0.1).applyMatrix4(hm);
      const q = new THREE.Quaternion().setFromRotationMatrix(hm);
      this.col.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      this.col.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
  }

  get sealed() { return this.open <= 0 && this.dogs >= 1; }
  get flowArea() { return this.open > 0 ? Math.min(1, this.open * 3) * this.o.halfW * this.o.halfH * 3.4 : (this.dogs < 1 ? 0.0004 : 0); }
}

export function createDoors(M, phys) {
  const doors = {};
  for (const [id, def] of Object.entries(DOORS)) doors[id] = new Door(id, def, M, phys);
  return doors;
}
