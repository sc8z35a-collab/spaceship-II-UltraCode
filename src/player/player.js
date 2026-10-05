// First-person player in ship-local coordinates: walking under (apparent) gravity, floating in
// zero-g with handhold damping, seated, and EVA with a suit jetpack.
import * as THREE from 'three';
import { R } from '../physics/localPhysics.js';

const STAND_HH = 0.58, STAND_R = 0.22;  // capsule: total 1.6 m
const CROUCH_HH = 0.28;
const EYE_STAND = 0.66, EYE_CROUCH = 0.36; // above capsule centre

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _qUp = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(phys) {
    this.phys = phys;
    this.pos = new THREE.Vector3(0, 0.9, -6.0);   // capsule centre, ship-local
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.up = new THREE.Vector3(0, 1, 0);         // body up (ship-local)
    this.state = 'float';                          // walk | float | seated | eva | evaWalk | dead
    this.seat = null;
    this.crouch = 0;
    this.suit = false;
    this.suitO2 = 1;                               // 0..1 (8 h)
    this.suitFuel = 1;                             // jetpack propellant
    this.health = 1;
    this.headBob = 0;
    this.camShake = new THREE.Vector3();
    this.grounded = false;
    this.onLift = null;
    this.holding = null;
    this.outside = false;
    const w = phys.world;
    this.body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y, this.pos.z));
    this.colStand = w.createCollider(R.ColliderDesc.capsule(STAND_HH, STAND_R), this.body);
    this.kcc = w.createCharacterController(0.02);
    this.kcc.setSlideEnabled(true);
    this.kcc.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    this.kcc.setMinSlopeSlideAngle(40 * Math.PI / 180);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(70);
    this.curHH = STAND_HH;
    this.eyeLocal = new THREE.Vector3();
    this.lookQuat = new THREE.Quaternion();
  }

  /** orientation of the body frame: up vector + yaw/pitch -> quaternion (ship-local) */
  frameQuat(out) {
    // base frame whose +Y = this.up and -Z close to ship -Z
    const up = this.up;
    let fwd = _v.set(0, 0, -1);
    if (Math.abs(fwd.dot(up)) > 0.95) fwd.set(1, 0, 0);
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const right = _v2.crossVectors(fwd, up).normalize();
    const m = new THREE.Matrix4().makeBasis(right, up, fwd.clone().negate());
    out.setFromRotationMatrix(m);
    return out;
  }

  /** camera orientation (ship-local) */
  viewQuat(out) {
    if (this.state === 'seated' && this.seat) {
      const s = this.seat;
      const base = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), s.fwd, new THREE.Vector3(0, 1, 0)));
      out.copy(base).multiply(_q.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')));
      return out;
    }
    this.frameQuat(out);
    out.multiply(_q.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ')));
    return out;
  }

  setColliderHeight(hh) {
    if (Math.abs(hh - this.curHH) < 1e-3) return;
    this.colStand.setHalfHeight(hh);
    this.curHH = hh;
  }

  teleport(p) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.body.setNextKinematicTranslation(p);
    this.body.setTranslation(p, true);
  }

  sit(seat) {
    this.seat = seat;
    this.state = 'seated';
    this.yaw = seat.swivel ? seat.yawSeat || 0 : 0; this.pitch = 0;
    this.vel.set(0, 0, 0);
    this.colStand.setEnabled(false);
  }

  stand(gravityDir) {
    if (!this.seat) return;
    const exit = this.seat.exit.clone();
    exit.y = Math.max(exit.y, 0) + STAND_HH + STAND_R + 0.05;
    this.seat = null;
    this.colStand.setEnabled(true);
    this.teleport(exit);
    this.state = 'float';
  }

  /**
   * input: polled input; gLocal: apparent gravity (ship-local, m/s^2); dt
   * env: { inShip: bool, rails: [...], liftDelta }
   */
  update(dt, input, gLocal, env) {
    if (this.state === 'dead') return;
    // look
    const sens = 0.0042;
    this.yaw -= input.lookDX * sens;
    this.pitch -= input.lookDY * sens;
    const pLim = this.state === 'seated' ? 1.2 : 1.5;
    this.pitch = Math.max(-pLim, Math.min(pLim, this.pitch));
    if (this.state === 'seated') {
      const s = this.seat;
      if (s.swivel) {
        // a swivel seat turns all the way round: the body follows the head once it looks more
        // than ~40 degrees off the seat's heading (the eye goes round the seat's column with it)
        const d = this.yaw - s.yawSeat;
        const dead = 0.7;
        if (Math.abs(d) > dead) s.yawSeat += (d - Math.sign(d) * dead) * Math.min(1, dt * 5);
        this.eyeLocal.copy(s.eye).sub(s.axis).applyAxisAngle(_Y, s.yawSeat).add(s.axis);
      } else {
        this.yaw = Math.max(-2.2, Math.min(2.2, this.yaw));
        this.eyeLocal.copy(s.eye);
      }
      this.viewQuat(this.lookQuat);
      return;
    }
    const gMag = gLocal.length();
    // hysteresis: thrust hovering around the threshold must not flip walk <-> float every few
    // seconds (the camera height, the controls and the up/down buttons all change with it)
    const gravityMode = this.gravityMode = gMag > (this.gravityMode ? 1.4 : 2.2);
    // body up vector: oppose gravity when there is any, else drift back to ship up
    const targetUp = gravityMode ? _v.copy(gLocal).multiplyScalar(-1 / gMag) : _v.set(0, 1, 0);
    const k = 1 - Math.exp(-dt * (gravityMode ? 4 : 0.8));
    // keep the look direction stable while the up vector changes
    this.up.lerp(targetUp, k).normalize();
    this.kcc.setUp({ x: this.up.x, y: this.up.y, z: this.up.z });
    // the capsule stands along the body's up (inside a turning habitat ring "up" points at the axis)
    _qUp.setFromUnitVectors(_Y, this.up);
    this.body.setNextKinematicRotation({ x: _qUp.x, y: _qUp.y, z: _qUp.z, w: _qUp.w });

    if (this.state === 'seated') return;
    const inEva = this.state === 'eva' || this.state === 'evaWalk';
    if (!inEva) this.state = gravityMode ? 'walk' : 'float';
    else this.state = gravityMode ? 'evaWalk' : 'eva';

    // movement basis
    const vq = this.viewQuat(new THREE.Quaternion());
    const camF = new THREE.Vector3(0, 0, -1).applyQuaternion(vq);
    const camR = new THREE.Vector3(1, 0, 0).applyQuaternion(vq);
    let desired = new THREE.Vector3();
    const walking = this.state === 'walk' || this.state === 'evaWalk';
    if (walking) {
      const f = camF.clone().addScaledVector(this.up, -camF.dot(this.up)).normalize();
      const r = camR.clone().addScaledVector(this.up, -camR.dot(this.up)).normalize();
      const speed = this.crouch > 0.5 ? 0.8 : 1.45;
      desired.addScaledVector(f, input.moveY * speed).addScaledVector(r, input.moveX * speed);
      // horizontal velocity follows input, vertical integrates gravity
      const vUp = this.vel.dot(this.up);
      const hv = this.vel.clone().addScaledVector(this.up, -vUp);
      if (env.climb) desired.multiplyScalar(0.5);
      if (env.swim) desired.multiplyScalar(0.45);
      hv.lerp(desired, 1 - Math.exp(-dt * (env.swim ? 2 : 8)));
      let vy = vUp - gMag * dt;
      if (env.climb) {
        // hands on a ladder / handholds: hang on, move up and down with the buttons
        vy += (input.up * 1.1 - vy) * Math.min(1, dt * 8);
      } else if (env.swim) {
        // floating in water: buoyancy holds the head just above the surface
        vy += (env.swim * 9.0 + input.up * 1.5) * dt;
        vy *= Math.exp(-dt * 2.5);
      }
      if (this.grounded && !env.climb) vy = Math.max(vy, -1.0);
      if (this.grounded && !env.climb && input.up > 0.5) vy = 3.0;
      this.vel.copy(hv).addScaledVector(this.up, vy);
    } else if (this.state === 'float') {
      const speed = 1.15 * (env.speedK || 1);
      desired.addScaledVector(camF, input.moveY * speed).addScaledVector(camR, input.moveX * speed).addScaledVector(this.up, input.up * speed);
      const has = desired.lengthSq() > 0.001;
      // pushing off / grabbing handholds: velocity follows input, otherwise slow drift decay
      this.vel.lerp(desired, 1 - Math.exp(-dt * (has ? 2.2 : 0.9)));
      // apparent acceleration (ship manoeuvres) still pushes us
      this.vel.addScaledVector(gLocal, dt * 0.6);
    } else if (this.state === 'eva') {
      // MMU-style jetpack: true inertia, thrust while input, gentle auto-stabilisation
      const thrust = 0.35;
      const tv = new THREE.Vector3().addScaledVector(camF, input.moveY).addScaledVector(camR, input.moveX).addScaledVector(this.up, input.up);
      if (tv.lengthSq() > 0.001 && this.suitFuel > 0) {
        this.vel.addScaledVector(tv.clampLength(0, 1), thrust * dt);
        this.suitFuel = Math.max(0, this.suitFuel - dt * 0.0009 * tv.length());
        this.thrusting = true;
      } else {
        this.thrusting = false;
        // grab nearby handrails; otherwise the pack's auto-hold slowly nulls drift (uses a little gas)
        if (env.nearRail) this.vel.multiplyScalar(Math.exp(-dt * 2.5));
        else if (this.suitFuel > 0 && this.vel.lengthSq() > 1e-4) {
          this.vel.multiplyScalar(Math.exp(-dt * 0.18));
          this.suitFuel = Math.max(0, this.suitFuel - dt * 0.00012);
        }
      }
      this.vel.addScaledVector(gLocal, dt);
    }
    // crouch automatically under low ceilings
    const wantCrouch = env.lowCeiling ? 1 : 0;
    this.crouch += (wantCrouch - this.crouch) * Math.min(1, dt * 6);
    this.setColliderHeight(this.crouch > 0.5 ? CROUCH_HH : STAND_HH);

    // move with collision
    const delta = this.vel.clone().multiplyScalar(dt);
    if (env.liftDelta) delta.add(env.liftDelta);
    this.canClimb = !!env.climb;
    this.kcc.enableSnapToGround(walking && !env.climb ? 0.15 : 0);
    if (walking) this.kcc.enableAutostep(env.stepUp || 0.25, 0.12, false); else this.kcc.disableAutostep();
    this.kcc.computeColliderMovement(this.colStand, { x: delta.x, y: delta.y, z: delta.z });
    const mv = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded();
    const moved = new THREE.Vector3(mv.x, mv.y, mv.z);
    // velocity loss on collision (bonk)
    if (dt > 0) {
      const realV = moved.clone().divideScalar(dt);
      if (env.liftDelta) realV.addScaledVector(env.liftDelta, -1 / dt);
      const lost = this.vel.clone().sub(realV);
      if (lost.length() > 3.5 && this.state !== 'walk') this.bump = Math.min(1, (lost.length() - 3.5) / 6);
      // keep tangential motion, drop the blocked component
      if (!walking) this.vel.copy(realV.lerp(this.vel, 0.0));
      else if (this.grounded) { const vu = this.vel.dot(this.up); if (vu < 0) this.vel.addScaledVector(this.up, -vu); }
    }
    this.pos.add(moved);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    // head bob
    const hs = walking && this.grounded ? this.vel.length() : 0;
    this.headBob += dt * hs * 5.5;
    const bob = Math.sin(this.headBob) * 0.022 * Math.min(1, hs);
    const eyeH = THREE.MathUtils.lerp(EYE_STAND, EYE_CROUCH, this.crouch);
    this.eyeLocal.copy(this.pos).addScaledVector(this.up, eyeH + bob);
    // no idle camera sway: the slow bob swept every fine highlight across the pixel grid and the
    // picture shimmered every few seconds
    this.roll *= 0.9;
    this.viewQuat(this.lookQuat);
  }

  serialize() {
    return { pos: this.pos.toArray(), yaw: this.yaw, pitch: this.pitch, state: this.state, seat: this.seat ? this.seat.id : null, suit: this.suit, suitO2: this.suitO2, suitFuel: this.suitFuel, health: this.health, outside: this.outside };
  }
}
