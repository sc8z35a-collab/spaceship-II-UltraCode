// Flight dynamics of B-29 in an Earth-centred inertial frame (float64).
// Flight assist holds a commanded velocity relative to a reference field that blends the
// local circular-orbit velocity (space) and the co-rotating atmosphere (low altitude).
// Attitude is held relative to the local-vertical/local-horizontal (LVLH) frame.
import * as THREE from 'three';
import { MU_EARTH, R_EARTH, OMEGA_EARTH, airDensity, G0 } from '../core/astro.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const NORMAL_MAX = 60;     // m/s cruise limit
export const ULTRA_MAX = 300;     // m/s
export const SHIP_MASS = 42000;
export const HULL_BOTTOM = 2.25;  // m below ship origin (incl. skids)

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _m = new THREE.Matrix4();

export class Flight {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.hRef = new THREE.Vector3(0, 1, 0);
    this.qRel = new THREE.Quaternion();   // attitude relative to LVLH
    this.wRel = new THREE.Vector3();      // angular velocity (ship axes)
    this.quat = new THREE.Quaternion();   // ship -> ECI (derived)
    this.setSpeed = 0;                    // commanded speed along the nose (m/s)
    this.speedLimit = NORMAL_MAX;
    this.ultra = false;
    this.ultraLevel = 0;                  // 0..1 smoothing
    this.ultraDown = null;                // staged ramp-down state
    this.preUltraSpeed = 0;
    this.autopilot = null;                // { target, phase }
    this.landed = false;
    this.inWater = false;
    this.properAcc = new THREE.Vector3(); // non-gravitational acceleration (ECI)
    this.thrustAcc = new THREE.Vector3();
    this.dragAcc = new THREE.Vector3();
    this.heatFlux = 0;                    // W/m^2
    this.hullTemp = 290;                  // K (leading surface)
    this.dynPressure = 0;
    this.mach = 0;
    this.engineHealth = 1;                // 0..1 (damage scales thrust)
    this.rcsHealth = 1;
    this.stickPitch = 0; this.stickYaw = 0; this.stickRoll = 0; this.throttleIn = 0;
    this.groundAlt = 1e9;                 // height above terrain (m)
    this.surfaceH = 0;
    this.impactCallback = null;           // (speed, normalShip, water) => void
    this.events = [];
    this.vertSpeed = 0;
    this._lastRef = new THREE.Vector3();
  }

  get alt() { return this.pos.length() - R_EARTH; }

  /** initialise on a circular orbit at position with prograde direction */
  initOrbit(pos, prograde) {
    this.pos.copy(pos);
    const r = pos.length();
    const up = pos.clone().normalize();
    const t = prograde.clone().sub(up.clone().multiplyScalar(prograde.dot(up))).normalize();
    this.hRef.crossVectors(up, t).normalize();
    this.vel.copy(t).multiplyScalar(Math.sqrt(MU_EARTH / r));
    this.qRel.identity();
    this.wRel.set(0, 0, 0);
    this.updateAttitude();
  }

  /** reference (field) velocity at a position */
  refVelocity(pos, out) {
    const r = pos.length();
    const up = _v1.copy(pos).divideScalar(r);
    const h = _v2.copy(this.hRef).addScaledVector(up, -this.hRef.dot(up)).normalize();
    const t = _v3.crossVectors(h, up).normalize();
    const vOrb = t.multiplyScalar(Math.sqrt(MU_EARTH / r));
    // air velocity (Earth rotation about +Y)
    const vAir = _v4.set(OMEGA_EARTH * pos.z, 0, -OMEGA_EARTH * pos.x);
    const alt = r - R_EARTH;
    const w = smooth(55000, 140000, alt);
    return out.copy(vAir).lerp(vOrb, w);
  }

  /** LVLH basis quaternion at the current position (Y up, -Z prograde) */
  lvlhQuat(pos, out) {
    const up = _v1.copy(pos).normalize();
    const h = _v2.copy(this.hRef).addScaledVector(up, -this.hRef.dot(up)).normalize();
    const fwd = _v3.crossVectors(h, up).normalize(); // prograde
    const Z = fwd.negate();
    const X = _v4.crossVectors(up, Z).normalize();
    _m.makeBasis(X, up, Z);
    return out.setFromRotationMatrix(_m);
  }

  updateAttitude() {
    this.lvlhQuat(this.pos, _q1);
    this.quat.copy(_q1).multiply(this.qRel);
  }

  forward(out) { return out.set(0, 0, -1).applyQuaternion(this.quat); }

  gravity(pos, out) {
    const r = pos.length();
    return out.copy(pos).multiplyScalar(-MU_EARTH / (r * r * r));
  }

  // ---------------------------------------------------------------- ULTRA
  setUltra(on) {
    if (on === this.ultra) return;
    if (on) {
      if (this.engineHealth < 0.45) { this.events.push('ultra_denied'); return; }
      this.ultra = true;
      this.ultraAuto = true;                 // spools up to full ULTRA speed unless the pilot takes over
      this.preUltraSpeed = Math.min(this.setSpeed, NORMAL_MAX);
      this.ultraDown = null;
      this.events.push('ultra_on');
    } else {
      this.ultra = false;
      // staged ramp-down to the original speed
      const from = this.setSpeed;
      const to = this.preUltraSpeed;
      const steps = [];
      const n = Math.max(1, Math.ceil((from - to) / 60));
      for (let i = 1; i <= n; i++) steps.push(from + (to - from) * (i / n));
      this.ultraDown = { steps, i: 0, hold: 0 };
      this.events.push('ultra_off');
    }
  }

  // ---------------------------------------------------------------- update
  /**
   * dt seconds. inputs: { pitch, yaw, roll, throttle } in -1..1 (when piloting)
   * terrainHeight(posEci) -> { h, water } of the surface beneath
   */
  step(dt, inputs, terrainHeight) {
    const sub = Math.max(1, Math.ceil(dt / 0.02));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) this._step(h, inputs, terrainHeight);
  }

  _step(dt, inp, terrainHeight) {
    const pos = this.pos, vel = this.vel;
    const r = pos.length();
    const alt = r - R_EARTH;
    const up = _v1.copy(pos).divideScalar(r).clone();
    // --- terrain
    const surf = terrainHeight ? terrainHeight(pos) : { h: 0, water: true };
    this.surfaceH = surf.h;
    this.inWaterSurface = surf.water;
    this.groundAlt = alt - surf.h - HULL_BOTTOM;

    // --- attitude control (relative to LVLH)
    const maxRate = (this.ultra ? 9 : 6) * Math.PI / 180;
    const rcs = Math.max(0.15, this.rcsHealth);
    const angAcc = 4.0 * Math.PI / 180 * rcs;
    const wDes = _v2.set(0, 0, 0);
    if (inp && !this.landed) wDes.set(inp.pitch * maxRate, -inp.yaw * maxRate, -inp.roll * maxRate);
    if (this.autopilot && this.autopilot.wDes) wDes.copy(this.autopilot.wDes);
    const dw = wDes.sub(this.wRel);
    const dl = dw.length();
    const lim = angAcc * dt;
    if (dl > lim) dw.multiplyScalar(lim / dl);
    if (!this.landed) this.wRel.add(dw); else this.wRel.multiplyScalar(0.8);
    const ang = this.wRel.length() * dt;
    if (ang > 1e-9) {
      _q1.setFromAxisAngle(_v3.copy(this.wRel).normalize(), ang);
      this.qRel.multiply(_q1).normalize();
    }
    this.updateAttitude();
    const fwd = this.forward(new THREE.Vector3());

    // --- speed command
    if (inp && !this.autopilot) {
      const rate = this.ultra ? 6 : 4;
      this.setSpeed += inp.throttle * rate * dt * (Math.abs(this.setSpeed) < 5 ? 0.5 : 1);
      if (Math.abs(inp.throttle) > 0.25) this.ultraAuto = false;
    }
    if (this.ultra && this.ultraAuto && !this.autopilot) this.setSpeed = Math.min(ULTRA_MAX, this.setSpeed + 6 * dt);
    if (this.ultraDown) {
      const u = this.ultraDown;
      const target = u.steps[u.i];
      // each stage: ramp at ~2.5 m/s^2 then hold briefly
      if (this.setSpeed > target + 0.5) this.setSpeed = Math.max(target, this.setSpeed - 9.0 * dt);
      else { u.hold += dt; if (u.hold > 0.9) { u.i++; u.hold = 0; this.events.push('ultra_stage'); if (u.i >= u.steps.length) this.ultraDown = null; } }
    }
    this.speedLimit = this.ultra ? ULTRA_MAX : (this.ultraDown ? Math.max(NORMAL_MAX, this.setSpeed) : NORMAL_MAX);
    this.speedLimit *= Math.max(0.2, this.engineHealth);
    this.setSpeed = Math.max(-15, Math.min(this.speedLimit, this.setSpeed));
    this.ultraLevel += ((this.ultra ? 1 : 0) - this.ultraLevel) * Math.min(1, dt * 0.5);

    // --- desired velocity
    const vRef = this.refVelocity(pos, new THREE.Vector3());
    let vDes = vRef.clone().addScaledVector(fwd, this.setSpeed);
    if (this.autopilot && this.autopilot.vRel) vDes = vRef.clone().add(this.autopilot.vRel);
    // feed-forward: the curvature of a constant-altitude path at our horizontal speed
    // (equals gravity at orbital speed: no thrust needed; hovering in air: full support)
    const g = this.gravity(pos, new THREE.Vector3());
    const vh = vel.clone().addScaledVector(up, -vel.dot(up));
    const ffwd = this.autopilot && this.autopilot.aff ? this.autopilot.aff.clone() : up.clone().multiplyScalar(-vh.lengthSq() / r);
    // --- drag
    const rho = airDensity(alt);
    const vAir = _v3.set(OMEGA_EARTH * pos.z, 0, -OMEGA_EARTH * pos.x);
    const vRelAir = vel.clone().sub(vAir);
    const sp = vRelAir.length();
    const CdA = 0.9 * 30; // m^2 (broadside-ish average)
    const drag = rho > 0 ? vRelAir.clone().multiplyScalar(-0.5 * rho * sp * CdA / SHIP_MASS) : new THREE.Vector3();
    this.dragAcc.copy(drag);
    this.dynPressure = 0.5 * rho * sp * sp;
    this.mach = sp / 300;
    // Sutton-Graves stagnation heating (nose radius ~2 m)
    this.heatFlux = rho > 0 ? 1.74e-4 * Math.sqrt(rho / 2.0) * sp * sp * sp : 0;
    // leading-surface temperature: convective heating vs. radiative cooling (skin ~4 kJ/m^2K)
    const T = this.hullTemp;
    this.hullTemp = Math.max(150, Math.min(4000, T + (this.heatFlux * 0.85 - 0.8 * 5.67e-8 * (T ** 4 - 250 ** 4)) / 4000 * dt));
    // --- thrust
    const aMaxEngine = 15 * Math.max(0, this.engineHealth);
    let aComp = ffwd.clone().sub(g).sub(drag);
    if (aComp.length() > aMaxEngine) aComp.setLength(aMaxEngine);
    const tau = Math.max(2.5, dt * 1.5);   // stays stable for coarse (catch-up) steps too
    const comfort = (this.ultraDown ? 7.0 : this.ultra ? 2.6 : 1.3) * Math.max(0.3, this.engineHealth);
    const extra = Math.max(0, aMaxEngine - aComp.length());
    const corrLim = Math.min(comfort + (alt < 140000 ? 6 : 0), extra);
    // altitude (radial) errors are corrected first, the rest of the budget goes to the
    // horizontal velocity — a long speed change never lets the ship sink or climb away
    const err = vDes.clone().sub(vel);
    const errR = err.dot(up);
    let aR = errR / tau;
    if (Math.abs(aR) > corrLim) aR = Math.sign(aR) * corrLim;
    const aH = err.addScaledVector(up, -errR).divideScalar(tau);
    const remH = Math.sqrt(Math.max(0, corrLim * corrLim - aR * aR));
    if (aH.length() > remH) aH.setLength(remH);
    let aCorr = aH.addScaledVector(up, aR);
    let thrust = aComp.add(aCorr);
    if (this.landed && this.setSpeed <= 0.5 && !(inp && inp.throttle > 0.2) && !this.autopilot) thrust.set(0, 0, 0);
    // in deep space above the atmosphere with no command and FA holding: fine
    this.thrustAcc.copy(thrust);

    // --- integrate (semi-implicit)
    const acc = g.clone().add(thrust).add(drag);
    if (this.landed) {
      // resting on the surface: co-rotate with the ground
      const ground = vAir.clone();
      const wantUp = (inp && inp.throttle > 0.35 && this.engineHealth > 0.2) || (thrust.dot(up) + g.dot(up) > 0.5 && thrust.length() > 0.1);
      if (wantUp) { const lift = this.inWater ? 1.45 : 0.05; this.landed = false; this.inWater = false; vel.copy(ground).addScaledVector(up, 2.0); pos.addScaledVector(up, lift); this.events.push('liftoff'); }
      else {
        // settle level on the ground / rock on the waves (heading kept)
        const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(this.qRel);
        const yaw = Math.atan2(-fw.x, -fw.z);
        const lvl = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        if (this.inWater) {
          const t = performance.now() / 1000;
          lvl.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(t * 0.41) * 0.025, 0, Math.sin(t * 0.29 + 1) * 0.045)));
        }
        this.qRel.slerp(lvl, 1 - Math.exp(-dt * 1.2));
        this.updateAttitude();
        vel.copy(ground);
        pos.addScaledVector(vel, dt);
        // keep on the surface
        const rr = pos.length();
        const target = R_EARTH + this.surfaceH + HULL_BOTTOM - (this.inWater ? 1.2 + Math.sin(performance.now() / 1300) * 0.15 : 0);
        pos.multiplyScalar(target / rr);
        this.properAcc.copy(g).negate(); // ground pushes up
        this.vertSpeed = 0;
        return;
      }
    }
    // second-order position update (no systematic sink on a curved path, even with big steps)
    pos.addScaledVector(vel, dt).addScaledVector(acc, 0.5 * dt * dt);
    vel.addScaledVector(acc, dt);
    this.properAcc.copy(thrust).add(drag);
    this.vertSpeed = vel.clone().sub(vAir).dot(up);

    // --- reference plane slowly follows sustained lateral motion
    const hv = _v4.crossVectors(pos, vel).normalize();
    if (alt > 140000 && Math.abs(hv.dot(this.hRef)) > 0.9) this.hRef.lerp(hv, Math.min(1, dt * 0.0005)).normalize();

    // --- ground / water contact
    const rr = pos.length();
    const gAlt = rr - R_EARTH - this.surfaceH - HULL_BOTTOM;
    if (gAlt <= 0) {
      const vrel = vel.clone().sub(vAir);
      const vn = -vrel.dot(up);           // downward speed
      const vt = vrel.clone().addScaledVector(up, vrel.dot(up)).length();
      const impact = Math.hypot(vn, vt * 0.35);
      pos.multiplyScalar((R_EARTH + this.surfaceH + HULL_BOTTOM) / rr);
      this.inWater = !!this.inWaterSurface;
      if (impact > 2.5 && this.impactCallback) this.impactCallback(impact, vn, this.inWater);
      this.landed = true;
      this.setSpeed = 0;
      this.autopilot = null;
      this.ultra = false; this.ultraDown = null;
      vel.copy(vAir);
      this.wRel.set(0, 0, 0);
      this.events.push(this.inWater ? 'splashdown' : 'touchdown');
    }
  }

  /** fast propagation for long offline gaps (coasting along the field + autopilot heading) */
  propagate(seconds, terrainHeight, onChunk) {
    let t = 0;
    const big = 2.0;
    while (t < seconds) {
      const h = Math.min(big, seconds - t);
      this._step(h, null, terrainHeight);
      t += h;
      if (onChunk && Math.floor(t / 3600) !== Math.floor((t - h) / 3600)) onChunk(t);
    }
  }

  serialize() {
    return {
      pos: this.pos.toArray(), vel: this.vel.toArray(), hRef: this.hRef.toArray(),
      qRel: this.qRel.toArray(), wRel: this.wRel.toArray(), setSpeed: this.setSpeed,
      ultra: this.ultra, preUltraSpeed: this.preUltraSpeed, landed: this.landed, inWater: this.inWater,
      engineHealth: this.engineHealth, rcsHealth: this.rcsHealth, hullTemp: this.hullTemp,
    };
  }

  restore(d) {
    this.pos.fromArray(d.pos); this.vel.fromArray(d.vel); this.hRef.fromArray(d.hRef);
    this.qRel.fromArray(d.qRel); this.wRel.fromArray(d.wRel);
    this.setSpeed = d.setSpeed; this.ultra = d.ultra; this.preUltraSpeed = d.preUltraSpeed || 0;
    this.landed = d.landed; this.inWater = d.inWater;
    this.engineHealth = d.engineHealth ?? 1; this.rcsHealth = d.rcsHealth ?? 1; this.hullTemp = d.hullTemp ?? 290;
    this.updateAttitude();
  }
}
