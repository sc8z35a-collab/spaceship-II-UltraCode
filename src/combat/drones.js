// Five unmanned hunter drones. Each is a little over two metres across (H8 is 7.2 m): a dark
// faceted body with a red sensor eye, four thruster pods on an X of short arms and a 20 mm cannon
// under the nose. They roam toward wherever Kaito is, find him with their sensors (80 km), close
// in fast and attack the vessel he is in — B-29, or H8 when he flies it: circling, then gun runs
// with short bursts from 2.5 km in, breaking away and coming round again. Hurt badly, one pulls
// back for a while; shot to pieces, it blows apart (its pieces tumble away) and another one comes
// a couple of hours later. The stations' point-defence guns fire on any that come too close.
// Everything flies in ECI with gravity, like the ships.
import * as THREE from 'three';
import { droneMaterials, droneHi, droneMid, droneLo } from './droneModel.js';
import { QUALITY } from '../core/quality.js';
import { MU_EARTH } from '../core/astro.js';
import { assignLayers, LAYER_FAR, LAYER_MID } from '../core/layers.js';
import { Particles } from '../fx/particles.js';
import { AMMO, GUNS, FireControl, seedOf } from './ballistics.js';

const N = 5;
const SENSOR = 80e3;         // detection range (m)
const GUN_RANGE = 2600;
const A_MAX = 60;            // m/s^2: unmanned, six g
const V_HUNT = 2400;         // closing speed while hunting (m/s, relative)
const V_SEARCH = 1100;       // speed of the search legs
const RESPAWN = 2 * 3600;    // s of game time
const AMMO_N = 180;          // rounds a drone carries
const RELOAD = 25 * 60;      // s: away to rearm when it has shot its drum empty
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, -1);

function grav(p, out) { const r = p.length(); return out.copy(p).multiplyScalar(-MU_EARTH / (r * r * r)); }
const rand = (a, b) => a + Math.random() * (b - a);

export class Drones {
  constructor(game, combat) {
    this.g = game;
    this.combat = combat;
    this.M = droneMaterials();
    // levels of detail: the close-up model and the plain one only when starting on high quality;
    // the light one always (low quality, and far away)
    const low = QUALITY.level === 'low';
    const T = { lo: droneLo(this.M) };
    if (!low) { T.hi = droneHi(this.M); T.mid = droneMid(this.M); }
    this.templates = T;
    this.template = T.mid || T.lo;     // (the pieces a kill leaves)
    this.low = low;
    this.list = [];
    for (let i = 0; i < N; i++) {
      // each one its own lights (eye, jets, lamp), shared by its levels of detail
      const own = { eye: this.M.eye.clone(), jet: this.M.jet.clone(), lamp: this.M.lamp.clone() };
      const lods = {};
      for (const [k, t] of Object.entries(T)) {
        const grp = t.clone();
        grp.traverse((o) => { if (o.isMesh) { if (o.material === this.M.eye) o.material = own.eye; else if (o.material === this.M.jet) o.material = own.jet; else if (o.material === this.M.lamp) o.material = own.lamp; o.frustumCulled = false; } });
        grp.matrixAutoUpdate = false;
        grp.visible = false;
        game.engine.scene.add(grp);
        lods[k] = grp;
      }
      this.list.push({
        i, id: 'D-' + (i + 1), kind: 'drone', R: 1.25, lods, lod: null, own,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), thrust: new THREE.Vector3(),
        alive: false, hp: 1, state: 'patrol', t: 0, burst: 0, shotT: 0, cool: rand(1, 3), respawnT: 0,
        slot: { r: rand(650, 1150), ph: rand(0, Math.PI * 2), w: rand(0.12, 0.22) * (Math.random() < 0.5 ? -1 : 1), tilt: rand(-0.7, 0.7) },
        run: null, smokeT: 0, seenT: 0, evadeT: 0, ammo: AMMO_N, reloadT: 0, search: 0, wp: null, wpT: 0,
        // its gun's fire control (a cruder sensor set than H8's)
        fc: new FireControl({ am: AMMO.d20, gun: GUNS.drone20, seed: seedOf('drone', i), sensor: { ang: 0.45e-3, range: 4, vel: 0.25 }, accT: 0.8 }),
      });
    }
    // far away: their drive glow as points (visible out to a few hundred km)
    const pg = new THREE.BufferGeometry();
    this.ptPos = new Float32Array(N * 3);
    this.ptK = new Float32Array(N);
    pg.setAttribute('position', new THREE.BufferAttribute(this.ptPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('k', new THREE.BufferAttribute(this.ptK, 1).setUsage(THREE.DynamicDrawUsage));
    this.ptMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 1 } },
      vertexShader: /* glsl */`
        attribute float k; uniform float uScale; varying float vK;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          float d = length(mv.xyz); vK = k * smoothstep(300.0, 1500.0, d) * clamp(4.0e5 / d, 0.15, 1.0);
          gl_PointSize = (2.2 + 2.0 * k) * uScale; }`,
      fragmentShader: /* glsl */`
        varying float vK;
        void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float g = exp(-dot(p, p) * 3.0); gl_FragColor = vec4(vec3(1.0, 0.35, 0.18) * vK * g * 4.0, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(pg, this.ptMat);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
    this.points.layers.set(LAYER_FAR); this.points.layers.enable(LAYER_MID);
    game.engine.scene.add(this.points);
    // smoke from a damaged drone, in a frame riding with the vessel Kaito is in
    this.trailGrp = new THREE.Group();
    this.trailGrp.matrixAutoUpdate = false;
    game.engine.scene.add(this.trailGrp);
    this.trail = new Particles(this.trailGrp);
    this.trailRef = { pos: new THREE.Vector3(), vel: new THREE.Vector3() };
    this.enabled = true;
    this.contact = false;        // any drone has Kaito's vessel on its sensors
    this.started = false;
  }

  /** the vessel the drones are after: the one Kaito is in */
  target() {
    const g = this.g;
    if (g.h8 && g.h8.solo) return { kind: 'h8', ref: g.h8, pos: g.h8.flight.pos, vel: g.h8.flight.vel, acc: g.h8.flight.properAcc, R: 3.6 };
    return { kind: 'b29', ref: g.flight, pos: g.flight.pos, vel: g.flight.vel, acc: g.flight.properAcc, R: 14 };
  }

  /** a new drone far from the target (it has to find him again) */
  spawn(d, far = rand(900e3, 1500e3)) {
    const T = this.target();
    const up = T.pos.clone().normalize();
    // somewhere behind or ahead along the orbit, a little off the plane
    const along = T.vel.clone().normalize();
    const side = new THREE.Vector3().crossVectors(up, along).normalize();
    const dir = along.clone().multiplyScalar(Math.random() < 0.5 ? -1 : 1).addScaledVector(side, rand(-0.5, 0.5)).addScaledVector(up, rand(-0.08, 0.08)).normalize();
    d.pos.copy(T.pos).addScaledVector(dir, far);
    // on a circular orbit at that height
    const r = d.pos.length();
    const h = new THREE.Vector3().crossVectors(T.pos, T.vel).normalize();
    d.vel.crossVectors(h, d.pos).normalize().multiplyScalar(Math.sqrt(MU_EARTH / r));
    d.alive = true; d.hp = 1; d.state = 'patrol'; d.t = 0; d.burst = 0; d.cool = rand(1, 3); d.run = null; d.evadeT = 0;
    d.ammo = AMMO_N; d.reloadT = 0; d.search = rand(800e3, 1400e3); d.wp = null; d.wpT = 0;
    d.q.setFromUnitVectors(Z, d.vel.clone().normalize());
    this.showLod(d, null);
  }

  start() {
    if (this.started) return;
    this.started = true;
    for (const d of this.list) this.spawn(d);
  }

  // ------------------------------------------------------------------ simulation
  update(sdt) {
    if (!this.enabled) return;
    if (!this.started) this.start();
    const g = this.g;
    const T = this.target();
    let contact = false, attacking = 0;
    for (const d of this.list) {
      if (!d.alive) {
        d.respawnT -= sdt;
        if (d.respawnT <= 0 && d.respawnT > -1e9) { this.spawn(d); }
        continue;
      }
      // fine steps (sleeping runs the clock 240 times faster)
      const n = Math.min(120, Math.max(1, Math.ceil(sdt / 0.2)));
      const h = sdt / n;
      for (let k = 0; k < n; k++) this.step(d, T, h);
      if (d.state === 'attack' || d.state === 'hunt') contact = true;
      if (d.state === 'attack') attacking++;
    }
    // first contact: the AIs call it, the sleeper is woken
    if (contact && !this.contact) this.onContact(T);
    if (!contact && this.contact) this.onClear();
    this.contact = contact;
    this.attacking = attacking;
    this.stationDefence(sdt);
  }

  step(d, T, dt) {
    const g = this.g;
    d.t += dt;
    const rel = _v.copy(T.pos).sub(d.pos);
    const dist = rel.length();
    // ---- what to do: search (legs closing in on where he might be), hunt once he is on the
    // sensors, attack close in; an empty drum sends it away to rearm, heavy damage makes it back off
    if (d.reloadT > 0) { d.reloadT -= dt; if (d.reloadT <= 0) { d.ammo = AMMO_N; d.hp = Math.min(1, d.hp + 0.5); } }
    const armed = d.ammo > 0 && d.reloadT <= 0;
    if (d.state === 'patrol' && dist < SENSOR && armed) { d.state = 'hunt'; d.seenT = 0; }
    if (d.state === 'hunt' && dist < 5000) d.state = 'attack';
    if (d.state === 'attack' && dist > 12000) d.state = 'hunt';
    if (d.state === 'evade') { d.evadeT -= dt; if (d.evadeT <= 0) d.state = armed ? 'hunt' : 'patrol'; }
    if ((d.state === 'hunt' || d.state === 'attack') && !armed) { d.state = 'patrol'; d.search = rand(400e3, 700e3); d.wp = null; }
    if (d.state !== 'patrol' && d.state !== 'evade' && dist > SENSOR * 2.5) { d.state = 'patrol'; d.wp = null; }
    // ---- where to be
    const acc = new THREE.Vector3();
    const gT = grav(T.pos, new THREE.Vector3()), gD = grav(d.pos, new THREE.Vector3());
    const ff = gT.sub(gD);                     // stay in the target's falling frame
    const vRel = d.vel.clone().sub(T.vel);
    let aimAt = null;
    if (d.state === 'patrol') {
      // the search: legs to points round the area he was last placed in, each leg a bit closer
      // (or, without ammunition, far out of his way)
      const up = T.pos.clone().normalize();
      const fwd = T.vel.clone().projectOnPlane(up).normalize();
      const side = new THREE.Vector3().crossVectors(up, fwd);
      d.wpT -= dt;
      if (!d.wp || d.wpT <= 0) {
        if (armed) d.search = Math.max(30e3, d.search * rand(0.6, 0.85));
        const a = rand(0, Math.PI * 2);
        d.wp = { f: Math.cos(a) * d.search, s: Math.sin(a) * d.search, u: rand(-0.05, 0.05) * d.search };
        d.wpT = d.search / V_SEARCH + rand(60, 240);
      }
      const pDes = T.pos.clone().addScaledVector(fwd, d.wp.f).addScaledVector(side, d.wp.s).addScaledVector(up, d.wp.u);
      const to = pDes.sub(d.pos), dw = to.length();
      const want = Math.min(V_SEARCH, Math.sqrt(2 * 12 * dw));
      const vDes = to.divideScalar(Math.max(1, dw)).multiplyScalar(want);
      acc.copy(vDes.sub(vRel)).multiplyScalar(0.5).add(ff);
      if (dw < 3000) d.wpT = Math.min(d.wpT, 20);
    } else if (d.state === 'hunt') {
      // close in along the line of sight, braking in time
      const los = rel.clone().divideScalar(Math.max(1, dist));
      const want = Math.min(V_HUNT, Math.sqrt(2 * 18 * Math.max(0, dist - 3500)));
      const vDes = los.multiplyScalar(want);
      acc.copy(vDes.sub(vRel)).multiplyScalar(0.6).add(ff);
    } else if (d.state === 'evade') {
      const away = rel.clone().negate().normalize();
      acc.copy(away.multiplyScalar(500).sub(vRel)).multiplyScalar(0.5).add(ff);
    } else {
      // attack: hold a slot circling the target, every so often a gun run straight at it
      const S = d.slot;
      S.ph += S.w * dt;
      if (!d.run && d.cool <= 0 && Math.random() < dt * 0.25) d.run = { t: 0, side: Math.random() < 0.5 ? -1 : 1 };
      const up = T.pos.clone().normalize();
      const fwd = T.vel.clone().projectOnPlane(up).normalize();
      const side = new THREE.Vector3().crossVectors(up, fwd);
      const ring = fwd.clone().multiplyScalar(Math.cos(S.ph)).addScaledVector(side, Math.sin(S.ph)).multiplyScalar(Math.cos(S.tilt)).addScaledVector(up, Math.sin(S.tilt)).normalize();
      let pDes, vDes;
      if (d.run) {
        // in to 350 m on the target, then break hard sideways and climb away
        d.run.t += dt;
        const inbound = d.run.t < 7;
        const pRun = inbound ? ring.clone().multiplyScalar(Math.max(350, 1200 - d.run.t * 170)) : ring.clone().multiplyScalar(1400).addScaledVector(side, d.run.side * 600).addScaledVector(up, 300);
        pDes = T.pos.clone().add(pRun);
        vDes = T.vel.clone();
        if (d.run.t > 12) { d.run = null; d.cool = rand(2, 5); }
      } else {
        pDes = T.pos.clone().addScaledVector(ring, S.r);
        vDes = T.vel.clone().addScaledVector(new THREE.Vector3().crossVectors(up, ring).normalize(), S.w * S.r);
      }
      const e = pDes.sub(d.pos), ev = vDes.sub(d.vel);
      acc.copy(e.multiplyScalar(0.36)).addScaledVector(ev, 1.1).add(ff);
      // never ram: a hard push away inside 120 m
      if (dist < 120 + T.R) acc.addScaledVector(rel.clone().normalize(), -A_MAX);
      aimAt = T;
    }
    if (acc.length() > A_MAX * (d.hp < 0.4 ? 0.6 : 1)) acc.setLength(A_MAX * (d.hp < 0.4 ? 0.6 : 1));
    d.thrust.copy(acc);
    // ---- fly (second-order step with gravity)
    const gg = grav(d.pos, new THREE.Vector3()).add(acc);
    d.pos.addScaledVector(d.vel, dt).addScaledVector(gg, 0.5 * dt * dt);
    d.vel.addScaledVector(gg, dt);
    // ---- point the nose: at its fire control's solution while it can shoot, else along its motion
    let want = null;
    d.fc.tick(dt);
    if (aimAt && dist < GUN_RANGE + 400) {
      d.fc.observe(T.kind, T.pos, T.vel, T.acc, dt);
      const sol = d.fc.solve(T.kind, d.pos, d.vel);
      if (sol) want = sol.aimDir.clone();
    }
    if (!want) want = d.vel.clone().sub(T.vel).normalize();
    if (want.lengthSq() > 0.5) {
      const qWant = _q.setFromUnitVectors(Z, want);
      const ang = d.q.angleTo(qWant);
      const maxTurn = 2.6 * dt;
      d.q.slerp(qWant, ang > maxTurn ? maxTurn / ang : 1);
    }
    // ---- the gun: bursts when lined up and in range
    d.cool -= dt;
    d.shotT -= dt;
    if (aimAt && dist < GUN_RANGE && want) {
      const nose = Z.clone().applyQuaternion(d.q);
      const err = nose.angleTo(want);
      if (d.burst <= 0 && d.cool <= 0 && err < 0.05 && d.ammo > 0) { d.burst = 6 + Math.floor(Math.random() * 5); }
      if (d.burst > 0 && d.shotT <= 0 && d.ammo > 0) {
        d.shotT = 1 / 9;
        d.burst--;
        d.ammo--;
        const muzzle = d.pos.clone().add(new THREE.Vector3(0, -0.28, -1.2).applyQuaternion(d.q));
        // (the gun is fixed in the nose: it fires where the nose points; the scatter is the gun's)
        this.combat.fire({ kind: 'drone', round: d.fc.fire(muzzle, d.vel, nose, d.hp < 0.5 ? 1.6 : 1), pos: muzzle, vel: d.vel, dir: nose, owner: d });
        if (d.burst <= 0) d.cool = rand(1.6, 3.2);
        // the drum is empty: away to rearm
        if (d.ammo <= 0) { d.reloadT = RELOAD * rand(0.8, 1.2); d.run = null; this.onDry(d); }
      }
    } else d.burst = 0;
  }

  /** hit by something: sparks, smoke when it is hurt, gone when it is done */
  damage(d, amount, hit, r) {
    if (!d.alive) return;
    d.hp -= amount;
    const C = this.combat;
    const A = C.anchorAt(d.pos, d.vel);
    A.P.burst('spark', hit.point.clone(), hit.n, 24, { speed: 18, spread: 1.4, size: 10 });
    A.P.burst('debris', hit.point.clone(), hit.n, 8, { speed: 6, spread: 1.2, size: 10 });
    if (d.hp < 0.35 && d.state !== 'evade' && d.hp > 0) { d.state = 'evade'; d.evadeT = rand(40, 80); d.run = null; }
    if (d.hp <= 0) this.kill(d, r);
    else if (r && r.byPlayer && this.g.h8) this.g.h8.say('hachi_drone_hit', { id: d.id }, { minGap: 6, force: false });
  }

  kill(d, r) {
    const g = this.g, C = this.combat;
    d.alive = false;
    d.respawnT = RESPAWN * rand(0.8, 1.3);
    this.showLod(d, null);
    C.explode(d.pos, d.vel, 1.1, true);
    // the pieces: the body breaks in two, a thruster pod spins off
    const parts = this.template.children.filter((m) => m.isMesh);
    for (let k = 0; k < 3; k++) {
      const piece = new THREE.Group();
      for (const m of parts) if ((m.name.length + k) % 3 !== 0) { const c = m.clone(); c.material = m.material; piece.add(c); }
      piece.scale.setScalar(0.55 + 0.2 * k);
      const v = d.vel.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(rand(4, 18)));
      C.addWreck(piece, d.pos, v, 50);
    }
    const by = r ? (r.owner && r.owner.kind === 'station' ? 'station' : r.byPlayer ? 'player' : 'other') : 'other';
    if (g.h8) g.h8.say(by === 'station' ? 'hachi_drone_down_station' : 'hachi_drone_down', { id: d.id, left: this.list.filter((x) => x.alive).length }, { minGap: 3, force: true });
    if (g.asphalt && !(g.h8 && g.h8.solo)) g.asphalt.say('drone_down', { left: this.list.filter((x) => x.alive).length }, { minGap: 4, force: true });
  }

  onContact(T) {
    const g = this.g;
    const n = this.list.filter((d) => d.alive && (d.state === 'hunt' || d.state === 'attack')).length;
    if (g.gameplay && g.gameplay.sleeping) g.gameplay.wake();
    if (g.asphalt && T.kind === 'b29') g.asphalt.say('drones_contact', { n }, { force: true });
    if (g.h8) g.h8.say('hachi_drones_contact', { n, who: T.kind === 'h8' ? 'H8' : 'B-29' }, { force: true });
    if (g.gameplay) g.gameplay.raise(0.8);
    if (g.h8 && g.h8.onThreat) g.h8.onThreat(T);
  }

  /** one of them has shot itself dry and turns away */
  onDry(d) {
    const g = this.g;
    if (g.h8) g.h8.say('hachi_drone_dry', { id: d.id }, { minGap: 20, force: false });
  }

  onClear() {
    const g = this.g;
    if (g.h8) g.h8.say('hachi_drones_clear', {}, { minGap: 30, force: false });
  }

  /** the hub stations defend themselves: their point-defence guns fire at drones within 2.5 km */
  stationDefence(dt) {
    const g = this.g;
    for (const s of g.stations.list) {
      if (s.kind !== 'hub' || (s.dmg && (s.dmg.status === 'failed' || s.dmg.status === 'destroyed'))) continue;
      s.pdT = (s.pdT || 0) - dt;
      if (s.pdT > 0) continue;
      if (!s.fc) s.fc = new FireControl({ am: AMMO.p30, gun: GUNS.pd30, seed: seedOf('station.' + s.id), sensor: { ang: 0.3e-3, range: 2, vel: 0.15 }, accT: 0.8 });
      s.fc.tick(0.12);
      for (const d of this.list) {
        if (!d.alive) continue;
        const dist = d.pos.distanceTo(s.pos);
        if (dist > 2500) continue;
        s.pdT = 1 / GUNS.pd30.rof;
        // a turret on the station's rim, on the drone's side
        const from = d.pos.clone().sub(s.pos).setLength(40).add(s.pos);
        s.fc.observe(d.id, d.pos, d.vel, d.thrust, 0.12);
        const sol = s.fc.solve(d.id, from, s.vel);
        if (!sol) break;
        this.combat.fire({ kind: 'pd', round: s.fc.fire(from, s.vel, sol.aimDir), pos: from, vel: s.vel, dir: sol.aimDir, owner: { kind: 'station', ref: s } });
        break;
      }
    }
  }

  // ------------------------------------------------------------------ per render frame
  /** one level of detail on show (or none) */
  showLod(d, k) {
    if (d.lod === k) return;
    for (const [kk, grp] of Object.entries(d.lods)) grp.visible = kk === k;
    d.lod = k;
  }

  /** the quality switch: low draws the light model only */
  setQuality(low) { this.low = low; }

  updateVisual(dt, origin, camWorld) {
    const g = this.g;
    const T = this.target();
    const t = performance.now() / 1000;
    // how big things look: a zoomed view (H8's) brings them closer
    const cam = g.engine.camera, base = g.engine.baseVFov ? g.engine.baseVFov() : cam.fov;
    const zoomK = Math.tan(cam.fov * Math.PI / 360) / Math.tan(base * Math.PI / 360);
    for (const d of this.list) {
      const i = d.i;
      if (!d.alive) { this.showLod(d, null); this.ptPos.set([1e15, 0, 0], i * 3); this.ptK[i] = 0; continue; }
      const rel = d.pos.clone().sub(origin);
      const dist = rel.distanceTo(camWorld);
      const eff = dist * zoomK;
      const thrustK = Math.min(1, d.thrust.length() / A_MAX);
      this.ptPos.set([rel.x, rel.y, rel.z], i * 3);
      this.ptK[i] = 0.35 + 0.65 * thrustK;
      const L = d.lods;
      // (out to the guns' reach and beyond: a zoomed view can pick one out at tens of kilometres)
      const k = this.low || !L.hi ? (eff < 9000 && dist < 90000 ? 'lo' : null)
        : eff < 60 ? 'hi' : eff < 1200 ? 'mid' : eff < 25000 && dist < 90000 ? 'lo' : null;
      this.showLod(d, k);
      const mesh = k && L[k];
      if (mesh) {
        mesh.matrix.compose(rel, d.q, _v2.set(1, 1, 1));
        mesh.matrixWorld.copy(mesh.matrix);
        mesh.updateMatrixWorld(true);
        mesh.traverse((o) => { if (o.isMesh) assignLayers(o, Math.max(0, dist - 2), dist + 2); });
        d.own.jet.emissiveIntensity = 0.8 + 5 * thrustK;
        // (a deep red: brighter, it bloomed out into a pale disc)
        d.own.eye.emissiveIntensity = (k === 'hi' ? 2.6 : 4.5) + (k === 'hi' ? 1.4 : 2.5) * Math.sin(t * 9 + i) * (d.state === 'attack' ? 1 : 0.2);
        d.own.lamp.emissiveIntensity = (t * 1.3 + i * 0.37) % 1 < 0.07 ? 12 : 0;
      }
      // a hurt drone trails smoke
      if (d.hp < 0.6 && dist < 20000) {
        d.smokeT -= dt;
        if (d.smokeT <= 0) {
          d.smokeT = 0.08;
          const p = d.pos.clone().sub(T.pos), v = d.vel.clone().sub(T.vel).multiplyScalar(0.9);
          this.trail._one('smoke', p, v.add(new THREE.Vector3().randomDirection().multiplyScalar(2)), { size: 6 + 10 * (0.6 - d.hp), life: 1.5, grow: 1.6 });
          if (d.hp < 0.3) this.trail._one('spark', p.clone(), v.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(6)), { size: 14 });
        }
      }
    }
    const pg = this.points.geometry;
    pg.attributes.position.needsUpdate = pg.attributes.k.needsUpdate = true;
    this.ptMat.uniforms.uScale.value = g.engine.renderer.getPixelRatio();
    // the smoke frame rides with the vessel Kaito is in
    const ref = T.pos.clone().sub(origin);
    this.trailGrp.matrix.makeTranslation(ref.x, ref.y, ref.z);
    this.trailGrp.matrixWorld.copy(this.trailGrp.matrix);
    this.trailGrp.updateMatrixWorld(true);
    const sc = g.engine.renderer.domElement.height / (2 * Math.tan(g.engine.camera.fov * Math.PI / 360));
    this.trail.add.pts.material.uniforms.uScale.value = sc;
    this.trail.alpha.pts.material.uniforms.uScale.value = sc;
    this.trail.update(Math.min(dt, 0.1));
  }

  // ------------------------------------------------------------------ save / load
  serialize() {
    return {
      started: this.started,
      list: this.list.map((d) => ({ alive: d.alive, hp: d.hp, state: d.state, respawnT: d.respawnT, pos: d.pos.toArray(), vel: d.vel.toArray(), ammo: d.ammo, reloadT: d.reloadT, search: d.search })),
    };
  }

  restore(s, gapSec = 0) {
    if (!s || !s.list) return;
    this.started = !!s.started;
    s.list.forEach((x, i) => {
      const d = this.list[i];
      if (!d) return;
      d.alive = x.alive; d.hp = x.hp; d.state = x.state === 'attack' || x.state === 'hunt' ? 'patrol' : x.state;
      d.respawnT = (x.respawnT || 0) - gapSec;
      d.pos.fromArray(x.pos); d.vel.fromArray(x.vel);
      d.ammo = x.ammo ?? AMMO_N; d.reloadT = Math.max(0, (x.reloadT || 0) - gapSec); d.search = x.search || 600e3; d.wp = null;
      if (d.reloadT <= 0 && d.ammo <= 0) d.ammo = AMMO_N;
    });
    // back after a long time away: they have lost him and search from afar again
    if (gapSec > 600) for (const d of this.list) if (d.alive) this.spawn(d);
  }
}
