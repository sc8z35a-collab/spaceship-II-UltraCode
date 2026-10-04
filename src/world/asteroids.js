// 3D asteroids on real trajectories: procedural rocks approach the ship in the inertial frame,
// are tested against the hull (BVH sweep) and strike with their real kinetic energy.
import * as THREE from 'three';
import { Simplex3, mulberry32 } from '../core/noise.js';
import { assignLayers, LAYER_MID, LAYER_NEAR } from '../core/layers.js';
import { noiseTex } from '../core/noiseTex.js';
import { MU_EARTH } from '../core/astro.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

function rockGeometry(seed, radius) {
  const g = new THREE.IcosahedronGeometry(1, 5);
  const n = new Simplex3(seed);
  const p = g.attributes.position;
  const rnd = mulberry32(seed);
  const elong = [0.75 + rnd() * 0.5, 0.7 + rnd() * 0.45, 0.8 + rnd() * 0.5];
  const craters = [];
  for (let i = 0; i < 7; i++) craters.push([new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), 0.15 + rnd() * 0.35]);
  for (let i = 0; i < p.count; i++) {
    const v = _v.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    let h = 1 + n.fbm(v.x * 1.6, v.y * 1.6, v.z * 1.6, 5) * 0.32 + n.ridged(v.x * 4, v.y * 4, v.z * 4, 3) * 0.06;
    for (const [c, r] of craters) {
      const d = v.distanceTo(c);
      if (d < r) { const t = d / r; h -= (1 - t * t) * 0.12 * r; }
      else if (d < r * 1.25) h += 0.03 * r;
    }
    v.multiplyScalar(h * radius);
    p.setXYZ(i, v.x * elong[0], v.y * elong[1], v.z * elong[2]);
  }
  g.computeVertexNormals();
  return g;
}

function rockMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x6b645c, roughness: 0.95, metalness: 0.0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tNoise3D = noiseTex;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;\nuniform highp sampler3D tNoise3D;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec4 nA = texture(tNoise3D, vObj * 0.35);
        vec4 nB = texture(tNoise3D, vObj * 1.7 + 0.3);
        diffuseColor.rgb *= 0.55 + 0.6 * nA.r + 0.25 * (nB.b - 0.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.33, 0.25), smoothstep(0.55, 0.75, nA.g) * 0.5);`);
  };
  return m;
}

export class Asteroids {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.mat = rockMaterial();
    this.timer = 9 * 60 + Math.random() * 300;   // first notable approach after ~10 min
    this.microTimer = 18 * 60 + Math.random() * 600;
    this.hullMeshes = [];
    this.ray = new THREE.Raycaster();
    this.ray.layers.enableAll();
    this.warned = new Set();
    this.enabled = true;
  }

  setHull(meshes) {
    this.hullMeshes = meshes;
    for (const m of meshes) if (!m.geometry.boundsTree) m.geometry.computeBoundsTree();
  }

  /** spawn a rock that will pass at 'miss' metres from the ship centre (0 = direct hit) */
  spawn({ radius = 0.6, speed = 60, miss = 0, dist = 6000, from = null } = {}) {
    // aimed at the vessel Kaito is in (B-29, or H8 while he flies it alone)
    const g = this.g, f = g.h8 && g.h8.solo ? g.h8.flight : g.flight;
    const seed = Math.floor(Math.random() * 1e9);
    const geo = rockGeometry(seed, 1);
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.scale.setScalar(radius);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = true;
    g.engine.scene.add(mesh);
    // approach direction (ECI): random, biased to the front hemisphere of the ship
    const dirLocal = from ? from.clone().normalize() : new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.2, -Math.random() * 1.4 - 0.1).normalize();
    const dirEci = dirLocal.clone().applyQuaternion(f.quat);
    // aim point near the ship centre (+ miss offset perpendicular to the path). Rock and ship
    // are on (slightly) different orbits, so a straight-line aim would drift metres off over the
    // approach: predict where the ship will be on arrival and fly the rock's orbit backwards
    // from there with the same integrator the update uses (exactly reversible).
    const off = new THREE.Vector3().randomDirection().projectOnPlane(dirEci).setLength(miss);
    const aimLocal = new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 12);
    const T = dist / speed, h = 0.05, steps = Math.max(1, Math.round(T / h));
    const sp = f.pos.clone(), sv = f.vel.clone();
    const grav = (p, out) => { const r = p.length(); return out.copy(p).multiplyScalar(-MU_EARTH / (r * r * r)); };
    const acc = new THREE.Vector3();
    // same second-order step as the flight model (and the rock update below)
    for (let i = 0; i < steps; i++) { grav(sp, acc); sp.addScaledVector(sv, h).addScaledVector(acc, 0.5 * h * h); sv.addScaledVector(acc, h); }
    const pos = sp.clone().add(aimLocal.applyQuaternion(f.quat)).add(off);
    const vel = sv.clone().addScaledVector(dirEci, -speed);
    for (let i = 0; i < steps; i++) { grav(pos, acc); pos.addScaledVector(vel, -h).addScaledVector(acc, 0.5 * h * h); vel.addScaledVector(grav(pos, acc), -h); }
    const density = 2600;
    const mass = density * (4 / 3) * Math.PI * Math.pow(radius * 0.8, 3);
    const spin = new THREE.Vector3().randomDirection().multiplyScalar(0.1 + Math.random() * 0.6);
    const a = { mesh, pos, vel, radius, mass, spin, q: new THREE.Quaternion().random(), age: 0, hit: false, seed, warnedAt: 0 };
    this.list.push(a);
    return a;
  }

  /** instant micrometeoroid strike (invisible, tiny but fast) */
  micro() {
    const g = this.g;
    const hull = this.hullMeshes[0];
    if (!hull) return;
    // pick a random point on the hull via ray from outside
    for (let k = 0; k < 6; k++) {
      const d = new THREE.Vector3().randomDirection();
      const o = d.clone().multiplyScalar(30).add(new THREE.Vector3(0, 0, (Math.random() - 0.5) * 16));
      const mw = g.shipVis.root.matrixWorld;
      this.ray.set(o.clone().applyMatrix4(mw), d.clone().negate().transformDirection(mw));
      this.ray.far = 60;
      const hits = this.ray.intersectObjects(this.hullMeshes, false);
      if (hits.length) {
        const pLocal = g.shipVis.root.worldToLocal(hits[0].point.clone());
        const E = 2e4 + Math.random() * 2e5; // grain at km/s
        g.damage.impact(pLocal, d.clone().negate(), E, { micro: true });
        g.systems.onImpact(E, pLocal);
        return;
      }
    }
  }

  schedule(dt) {
    if (!this.enabled) return;
    const g = this.g;
    const f = g.h8 && g.h8.solo ? g.h8.flight : g.flight;
    if (f.landed || f.alt < 120000) return;
    this.timer -= dt;
    this.microTimer -= dt;
    if (this.microTimer <= 0) {
      this.microTimer = 25 * 60 + Math.random() * 40 * 60;
      if (!(g.h8 && g.h8.solo)) this.micro();
    }
    if (this.timer <= 0) {
      this.timer = 40 * 60 + Math.random() * 60 * 60;
      const roll = Math.random();
      if (roll < 0.45) this.spawn({ radius: 0.25 + Math.random() * 0.5, speed: 30 + Math.random() * 60, miss: 40 + Math.random() * 400, dist: 5000 });
      else if (roll < 0.85) this.spawn({ radius: 0.2 + Math.random() * 0.45, speed: 25 + Math.random() * 70, miss: 0, dist: 5000 });
      else this.spawn({ radius: 0.9 + Math.random() * 1.8, speed: 20 + Math.random() * 40, miss: Math.random() < 0.5 ? 0 : 20, dist: 6000 });
    }
  }

  /** dt: simulation step; realDt: wall-clock step (event scheduling does not speed up while sleeping) */
  update(dt, realDt = dt) {
    const g = this.g, f = g.flight;
    this.schedule(realDt);
    const root = g.shipVis.root;
    const invQ = f.quat.clone().invert();
    for (const a of this.list) {
      a.age += dt;
      // previous position relative to the ship as it was then (the ship itself moved ~400 m
      // along its orbit this frame; sweeping from rock(old) - ship(new) would cast along the orbit)
      const prevRel = a.rel ? a.rel.clone() : a.pos.clone().sub(f.pos);
      const prevPos = a.pos.clone();
      // rocks fall around the Earth like the ship does (same second-order step as the flight model,
      // otherwise the two drift metres apart during an approach)
      const r = a.pos.length();
      const ga = a.pos.clone().multiplyScalar(-MU_EARTH / (r * r * r));
      a.pos.addScaledVector(a.vel, dt).addScaledVector(ga, 0.5 * dt * dt);
      a.vel.addScaledVector(ga, dt);
      const rel = a.pos.clone().sub(f.pos);
      a.rel = rel.clone();
      a.q.multiply(new THREE.Quaternion().setFromAxisAngle(a.spin.clone().normalize(), a.spin.length() * dt));
      a.dist = rel.length();
      // H8 (wherever it is) can be struck too
      if (g.h8 && g.h8.mode !== 'parked' && g.h8.rockCheck(a, prevPos, dt)) continue;
      // warnings
      const relVel = a.vel.clone().sub(f.vel);
      const closing = -rel.dot(relVel) / Math.max(a.dist, 1);
      a.closing = closing;
      if (g.h8 && g.h8.solo) {
        // Kaito is away in H8: HACHI watches the rocks round H8
        if (!a.warned) { const hr = a.pos.clone().sub(g.h8.flight.pos); if (hr.length() < 3500 && -hr.dot(a.vel.clone().sub(g.h8.flight.vel)) > 0) { a.warned = true; g.h8.rockWarning(a); } }
      } else if (!a.warned && a.dist < 3500 && closing > 0) {
        a.warned = true;
        g.systems.onAsteroidWarning(a, rel.clone().applyQuaternion(invQ));
      }
      // collision sweep (ship-local)
      if (!a.hit && a.dist < 60) {
        const p0 = prevRel.clone().applyQuaternion(invQ), p1 = rel.clone().applyQuaternion(invQ);
        const seg = p1.clone().sub(p0);
        const len = seg.length();
        if (len > 1e-6) {
          const dir = seg.clone().divideScalar(len);
          // cast several rays across the rock's cross-section
          let best = null;
          const side = new THREE.Vector3().randomDirection().projectOnPlane(dir).normalize();
          const up = new THREE.Vector3().crossVectors(dir, side);
          for (const [sx, sy] of [[0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) {
            const o = p0.clone().addScaledVector(side, sx * a.radius).addScaledVector(up, sy * a.radius);
            this.ray.set(o.applyMatrix4(root.matrixWorld), dir.clone().applyQuaternion(f.quat));
            this.ray.far = len + a.radius;
            const hits = this.ray.intersectObjects(this.hullMeshes, false);
            if (hits.length && (!best || hits[0].distance < best.distance)) best = hits[0];
          }
          if (best) {
            a.hit = true;
            const pLocal = root.worldToLocal(best.point.clone());
            const speed = relVel.length();
            const E = 0.5 * a.mass * speed * speed;
            g.damage.impact(pLocal, dir, E);
            g.systems.onImpact(E, pLocal, a);
            // fragments drift on
            if (g.fx) g.fx.burst('debris', pLocal, dir.clone().negate(), 60, { speed: 3, spread: 1.5, life: 2 });
            g.engine.scene.remove(a.mesh);
          }
        }
      }
      if (a.age > 600 || (a.dist > 9000 && a.age > 30)) a.dead = true;
    }
    this.list = this.list.filter((a) => {
      if (a.hit || a.dead) { if (a.mesh.parent) a.mesh.parent.remove(a.mesh); a.mesh.geometry.dispose(); return false; }
      return true;
    });
  }

  /** per render frame: place the rocks relative to the render origin */
  updateVisual(origin, camWorld) {
    const s = new THREE.Vector3();
    for (const a of this.list) {
      const rel = a.pos.clone().sub(origin);
      s.setScalar(a.radius);
      a.mesh.matrix.compose(rel, a.q, s);
      a.mesh.matrixWorld.copy(a.mesh.matrix);
      const d = rel.distanceTo(camWorld);
      assignLayers(a.mesh, Math.max(0, d - a.radius * 1.5), d + a.radius * 1.5);
    }
  }
}
