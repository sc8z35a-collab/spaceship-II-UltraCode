// Rapier world in ship-local coordinates: static interior/exterior colliders, kinematic doors /
// lift, loose dynamic props, and the player's kinematic character controller.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export let R = null;

export async function initRapier() {
  if (!R) {
    await RAPIER.init();
    R = RAPIER;
  }
  return R;
}

const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class LocalPhysics {
  constructor() {
    this.world = new R.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = 1 / 60;
    this.fixed = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    this.loose = [];   // {body, mesh, home, stowed, kind}
    this.kinematic = [];
    this.acc = 0;
  }

  addColliders(list, body = this.fixed, friction = 0.6) {
    const out = [];
    for (const c of list) {
      let desc = null;
      if (c.type === 'mesh') {
        const pos = c.geo.attributes.position.array;
        const verts = new Float32Array(pos);
        let idx;
        if (c.geo.index) idx = new Uint32Array(c.geo.index.array);
        else {
          const n = verts.length / 3;
          idx = new Uint32Array(n);
          for (let i = 0; i < n; i++) idx[i] = i;
        }
        desc = R.ColliderDesc.trimesh(verts, idx);
      } else if (c.type === 'box') {
        desc = R.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
      } else if (c.type === 'cyl') {
        desc = R.ColliderDesc.cylinder(c.hh, c.r);
      } else if (c.type === 'capsule') {
        desc = R.ColliderDesc.capsule(c.hh, c.r);
      }
      if (!desc) continue;
      if (c.m) {
        c.m.decompose(_p, _q, _s);
        desc.setTranslation(_p.x, _p.y, _p.z);
        desc.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
      }
      desc.setFriction(friction);
      out.push(this.world.createCollider(desc, body));
    }
    return out;
  }

  /** kinematic body (doors, lift) with a cuboid collider */
  addKinematicBox(hx, hy, hz, pos, quat) {
    const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z).setRotation(quat || { x: 0, y: 0, z: 0, w: 1 }));
    const col = this.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz), body);
    this.kinematic.push(body);
    return { body, col };
  }

  /** loose dynamic prop; stowed props are fixed in place until knocked free */
  addLoose(mesh, shape, mass, kind, stowed = true) {
    const p = mesh.position, q = mesh.quaternion;
    const desc = R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setLinearDamping(0.05).setAngularDamping(0.15).setCcdEnabled(true);
    const body = this.world.createRigidBody(desc);
    let cd;
    if (shape.type === 'box') cd = R.ColliderDesc.cuboid(shape.hx, shape.hy, shape.hz);
    else if (shape.type === 'cyl') cd = R.ColliderDesc.cylinder(shape.hh, shape.r);
    else cd = R.ColliderDesc.ball(shape.r);
    cd.setDensity(1).setFriction(0.5).setRestitution(0.25);
    const col = this.world.createCollider(cd, body);
    body.setAdditionalMass(mass, true);
    const item = { body, col, mesh, kind, stowed, home: p.clone(), homeQ: q.clone(), lastHit: 0 };
    if (stowed) body.setBodyType(R.RigidBodyType.Fixed, true);
    this.loose.push(item);
    return item;
  }

  release(item, impulse) {
    if (!item.stowed) return;
    item.stowed = false;
    item.body.setBodyType(R.RigidBodyType.Dynamic, true);
    if (impulse) item.body.applyImpulse(impulse, true);
  }

  /** whole-ship velocity kick (ship-local delta-v of the hull): free bodies keep their inertia */
  kick(dv, angKick = 0, center = null, releaseChance = 0) {
    for (const it of this.loose) {
      if (it.stowed) {
        if (Math.random() < releaseChance) this.release(it);
        else continue;
      }
      const v = it.body.linvel();
      it.body.setLinvel({ x: v.x - dv.x * (0.8 + Math.random() * 0.4), y: v.y - dv.y * (0.8 + Math.random() * 0.4), z: v.z - dv.z * (0.8 + Math.random() * 0.4) }, true);
      if (angKick) it.body.setAngvel({ x: (Math.random() - 0.5) * angKick, y: (Math.random() - 0.5) * angKick, z: (Math.random() - 0.5) * angKick }, true);
    }
  }

  setGravity(g) {
    this.world.gravity = { x: g.x, y: g.y, z: g.z };
  }

  step(dt) {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= 1 / 60 && n < 4) {
      this.world.step();
      this.acc -= 1 / 60;
      n++;
    }
    // sync loose meshes
    for (const it of this.loose) {
      if (it.stowed) continue;
      const t = it.body.translation(), r = it.body.rotation();
      it.mesh.position.set(t.x, t.y, t.z);
      it.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      it.mesh.updateMatrix();
    }
  }
}
