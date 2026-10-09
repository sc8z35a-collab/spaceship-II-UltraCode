// Engine flames are hot. Whatever is in one is heated by it — the hotter the deeper in (the white
// core just out of the nozzle worst), the longer the worse:
//   - B-29's skin: the paint scorches, the skin glows red, fittings cook off, then it burns through
//     into the cabin behind (damage.js flameOn);
//   - H8's armour: plate after plate goes, as if struck again and again (h8.flameOn);
//   - the drones, the stations' escape pods, H8's K3 robots: they cook and break up;
//   - Kaito in his suit: its layers char, then leak, and he is burnt (suits.js flameOn).
// A vessel's own flame does not touch it (it points away from it).
// Cameras near a flame are dazzled and overheat: the picture washes out, its lines tear, its
// colours slip; past its limit the signal is lost until it cools (the external cameras' view, a
// stolen pod's cabin camera; H8's four hull cameras, each sector of its display on its own).
import * as THREE from 'three';
import { PLUMES } from './enginePlume.js';
import { CAMERAS, H8 } from '../h8/h8Spec.js';
import { HULL, halfWidthAt } from '../ship/hullShape.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _ax = new THREE.Vector3(), _e = new THREE.Vector3();

/** the heat (0 .. ~50) a flame puts into a point (ECI) */
function heatOf(F, p) {
  const rx = p.x - F.a.x, ry = p.y - F.a.y, rz = p.z - F.a.z;
  const z = rx * F.d.x + ry * F.d.y + rz * F.d.z;
  if (z < -F.r0 || z > F.L) return 0;
  const zc = Math.max(0, z);
  const qx = rx - F.d.x * z, qy = ry - F.d.y * z, qz = rz - F.d.z * z;
  const r = Math.sqrt(qx * qx + qy * qy + qz * qz);
  const rm = F.r0 * 1.02 + zc * F.tan;
  if (r > rm * 2.4) return 0;
  // the flame: spreading and thinning with the distance (the shader's own shape), and the white
  // core straight out of the nozzle
  const x = r / rm, f = 1 - zc / F.L;
  const body = Math.exp(-x * x * 1.9) * (F.r0 * F.r0) / (rm * rm) * f * f;
  const rc = r / (F.r0 * 0.5);
  const core = Math.exp(-rc * rc * 2.3) * Math.exp(-zc / F.coreL) * 2;
  return F.P * F.K * (body + core);
}

/** inside B-29's hull (ship frame)? */
function inHull(p) {
  return p.z > HULL.zTip && p.z < HULL.zTail1 && Math.abs(p.x) < halfWidthAt(p.z, p.y);
}

/**
 * where a flame's axis (ship frame: from a along d, for len) first runs into B-29's skin, or null
 * (marched along it, then narrowed down)
 */
function hullEntry(a, d, len, out) {
  const step = Math.max(0.12, len / 240);
  let t0 = 0;
  if (inHull(a)) return null;            // (a flame lit inside the hull: none of its business)
  for (let t = step; t <= len + 1e-6; t += step) {
    if (!inHull(_e.copy(a).addScaledVector(d, t))) { t0 = t; continue; }
    let lo = t0, hi = t;
    for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (inHull(_e.copy(a).addScaledVector(d, m))) hi = m; else lo = m; }
    return out.copy(a).addScaledVector(d, lo);
  }
  return null;
}

/** closest points of two segments (a0..a1, b0..b1): s, t along each */
function segSeg(a0, a1, b0, b1) {
  const d1 = _v.subVectors(a1, a0), d2 = _v2.subVectors(b1, b0), r = _v3.subVectors(a0, b0);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a < 1e-9 && e < 1e-9) return [0, 0];
  if (a < 1e-9) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = d1.dot(r);
    if (e < 1e-9) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  return [s, t];
}

export class PlumeHeat {
  constructor(game) {
    this.g = game;
    this.F = [];
    this.cam = 0;              // the heat in the view's camera (0 .. 2: past 1 its signal is lost)
    this.h8Cam = [0, 0, 0, 0];
    this.h8Lost = [false, false, false, false];
    this.eye = 0;              // the flame's glare through the visor
  }

  /** the flames burning now, as cones in space (from the last drawn frame's placement) */
  flames() {
    const g = this.g, F = this.F;
    F.length = 0;
    for (const P of PLUMES) {
      const m = P.mesh;
      if (!m.visible || !m.parent || P.k < 0.02) continue;
      const M = m.matrixWorld;
      _ax.setFromMatrixColumn(M, 2).normalize();
      const U = P.u;
      for (const e of P.exitsP) {
        F.push({
          a: e.clone().applyMatrix4(M).add(g.origin), d: _ax.clone(), L: P.L, r0: P.o.r0, tan: U.uTan.value, coreL: Math.max(0.05, U.uCoreL.value),
          K: Math.min(1.4, P.k) + 0.25 * P.ign, P: P.heat * P.o.r0 * P.o.r0, owner: P.owner,
        });
      }
    }
    return F;
  }

  /** the heat at a point (ECI) from every flame (but those of `skip`) */
  heatAt(p, skip = null) {
    let q = 0;
    for (const F of this.F) if (F.owner !== skip || !skip) q += heatOf(F, p);
    return q;
  }

  /** per drawn frame (dt: the game time it covers), once every vessel and plume is placed */
  update(dt) {
    const g = this.g;
    if (dt <= 0) return;
    const F = this.flames();
    if (F.length) this.burn(dt, F);
    this.cameras(dt);
  }

  // ------------------------------------------------------------------ what the flames burn
  burn(dt, flames) {
    const g = this.g, f = g.flight;
    // ---- B-29: the line down its middle against each flame's axis; the skin there facing it
    const qInv = _q.copy(f.quat).invert();
    const b0 = new THREE.Vector3(0, 0.3, HULL.zTip + 1).applyQuaternion(f.quat).add(f.pos);
    const b1 = new THREE.Vector3(0, 0.3, HULL.zTail1 - 0.5).applyQuaternion(f.quat).add(f.pos);
    // (H8 on B-29's back: its drive is mounted to clear B-29, and B-29's to clear it)
    const pair = !!(g.h8 && g.h8.mode === 'docked');
    for (const F of flames) {
      if (F.owner === 'b29' || (pair && F.owner === 'h8')) continue;
      const end = F.a.clone().addScaledVector(F.d, F.L);
      const [s, t] = segSeg(b0, b1, F.a, end);
      const pb = b0.clone().lerp(b1, s), pf = F.a.clone().lerp(end, t);
      const rm = F.r0 + t * F.L * F.tan;
      if (pb.distanceTo(pf) > 5.5 + rm * 2.4) continue;
      // the skin where it plays: where its axis runs into the hull; a flame going by, the skin on
      // the side toward it
      const aL = F.a.clone().sub(f.pos).applyQuaternion(qInv), dL = F.d.clone().applyQuaternion(qInv);
      let skin = hullEntry(aL, dL, F.L, new THREE.Vector3());
      if (skin) skin = g.damage.snapToSkin(skin);
      else skin = g.damage.snapToSkin(pf.clone().sub(f.pos).applyQuaternion(qInv));
      const n = g.damage.skinNormal(skin);
      const q = heatOf(F, skin.clone().applyQuaternion(f.quat).add(f.pos));
      if (q > 0.05) g.damage.flameOn(skin, n, q, dt);
    }
    // ---- H8: its armoured ball
    const h8 = g.h8;
    if (h8 && h8.mode !== 'lost' && h8.mode !== 'pod') {
      const C = this.h8Centre(new THREE.Vector3());
      const hq = this.h8Quat(new THREE.Quaternion());
      for (const F of flames) {
        if (F.owner === 'h8' || (h8.mode === 'docked' && F.owner === 'b29')) continue;
        const t = Math.max(0, Math.min(F.L, _v.subVectors(C, F.a).dot(F.d)));
        const pf = F.a.clone().addScaledVector(F.d, t);
        const dist = pf.distanceTo(C);
        if (dist > H8.R + (F.r0 + t * F.tan) * 2.4) continue;
        // (its axis through the ball: where it goes in, on the side facing the flame; going by: the
        // side nearest it)
        if (dist < H8.R) pf.addScaledVector(F.d, -Math.sqrt(H8.R * H8.R - dist * dist));
        const dc = pf.distanceTo(C);
        const dir = dc > 1e-3 ? pf.sub(C).divideScalar(dc) : F.d.clone().negate();
        const q = heatOf(F, C.clone().addScaledVector(dir, H8.R));
        if (q > 0.05 && h8.flameOn) h8.flameOn(dir.clone().applyQuaternion(hq.clone().invert()), q, dt);
      }
    }
    // ---- the drones, the pods, the robots: balls (a pod: its nose, middle and tail)
    if (g.drones) for (const d of g.drones.list) {
      if (!d.alive) continue;
      const q = this.heatAt(d.pos, d);
      if (q > 0.05) g.drones.heat(d, q * dt * 0.05);
    }
    if (g.pods) for (const p of g.pods.list) {
      if (!p.alive || p.state === 'wait') continue;
      let q = 0;
      for (const k of [-0.4, 0, 0.4]) q = Math.max(q, this.heatAt(_e.set(0, 0, k * p.G.len).applyQuaternion(p.q).add(p.pos), p));
      if (q > 0.05) g.pods.damage(p, q * dt * 4e4, null, null);
    }
    if (h8 && h8.k3) for (const u of h8.k3.free()) {
      const q = this.heatAt(u.pos);
      if (q > 0.05) h8.k3.hit(u, q * dt * 1e5, null);
    }
    // ---- Kaito out in his suit
    const pl = g.player, S = g.suits;
    if (S && pl.suit && pl.outside) {
      const me = S.eva && pl.inertial ? S.eva.p : S.playerEci(_e);
      const q = this.heatAt(me, 'suit');
      this.eye = q;
      if (q > 0.05) {
        // (from which side: toward the hottest flame's axis, in his own frame)
        let best = null, bq = 0;
        for (const F of flames) { if (F.owner === 'suit') continue; const h = heatOf(F, me); if (h > bq) { bq = h; best = F; } }
        const t = best ? Math.max(0, _v.subVectors(me, best.a).dot(best.d)) : 0;
        const toward = best ? best.a.clone().addScaledVector(best.d, t).sub(me) : new THREE.Vector3(0, 0, -1);
        S.flameOn(q, dt, toward);
      }
    } else this.eye = 0;
  }

  h8Centre(out) {
    const g = this.g, h8 = g.h8;
    if (h8.mode === 'docked') return out.copy(H8.dockAt).applyQuaternion(g.flight.quat).add(g.flight.pos);
    return out.copy(h8.flight.pos);
  }

  h8Quat(out) {
    const g = this.g, h8 = g.h8;
    return out.copy(h8.mode === 'docked' ? g.flight.quat : h8.flight.quat);
  }

  // ------------------------------------------------------------------ what the flames dazzle
  /** the cameras: the view's own (an external camera, a stolen pod's) and H8's four */
  cameras(dt) {
    const g = this.g;
    const live = this.F.length > 0;
    // the camera the picture is from (not the eye: a suit's visor is not a camera)
    const feed = g.mode === 'camera' || !!(g.pods && g.pods.remote);
    const q = live && feed ? this.heatAt(_v.copy(g.camWorld).add(g.origin)) : 0;
    // (a sensor heats quickly in a flame and cools more slowly out of it)
    const want = Math.min(2.2, q / 2.5);
    this.cam += (want - this.cam) * Math.min(1, dt * (want > this.cam ? 2.5 : 0.35));
    if (this.cam < 0.002) this.cam = 0;
    g.engine.grade.set('uCamHeat', feed ? this.cam : 0);
    // H8's cameras on its hull
    const h8 = g.h8;
    if (h8 && h8.display && h8.mode !== 'lost' && h8.mode !== 'pod') {
      const C = this.h8Centre(_v2), hq = this.h8Quat(_q);
      for (let i = 0; i < 4; i++) {
        const p = _e.copy(CAMERAS[i].dir).multiplyScalar(H8.R + 0.05).applyQuaternion(hq).add(C);
        const qi = live ? this.heatAt(p, 'h8') : 0;
        const w = Math.min(2.2, qi / 2.5);
        this.h8Cam[i] += (w - this.h8Cam[i]) * Math.min(1, dt * (w > this.h8Cam[i] ? 2.5 : 0.35));
        if (this.h8Cam[i] < 0.002) this.h8Cam[i] = 0;
        // (HACHI says so when one of them loses its picture to the heat)
        const lost = this.h8Cam[i] > 1.05;
        if (lost && !this.h8Lost[i] && (h8.crew || h8.mode === 'docked')) h8.say('hachi_cam_heat', { cam: CAMERAS[i].name }, { minGap: 8, force: false });
        this.h8Lost[i] = lost;
      }
      h8.display.setCameraHeat(this.h8Cam);
    }
  }
}
