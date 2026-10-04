// The end of B-29: when the structure gives out (or one impact is far too big) the hull tears into
// shell sections, the reactor and engine section break away, the interior spills out as debris,
// a flash and a cloud of sparks, ice and fragments — seen from a camera that pulls away.
import * as THREE from 'three';
import { HULL, sectionPoint } from './hullShape.js';
import { LAYER_NEAR, LAYER_MID } from '../core/layers.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function mats() {
  const S = (color, rough, metal, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal }, extra));
  return {
    hull: S(0xd6d8d4, 0.55, 0.2),
    inner: S(0xb7bbbd, 0.65, 0.1),
    edge: S(0x2a2624, 0.8, 0.4, { emissive: new THREE.Color(1.0, 0.35, 0.08), emissiveIntensity: 1.5 }),
    mli: S(0xd8c27a, 0.4, 0.85),
    dark: S(0x3a3d42, 0.5, 0.7),
    rad: S(0xe2e5e8, 0.35, 0.25),
    debris: [S(0xadb1b4, 0.6, 0.2), S(0x5a5f66, 0.55, 0.35), S(0x6e6258, 0.95, 0), S(0xa8adb3, 0.35, 0.85), S(0xe8e8e2, 0.5, 0.05)],
    fire: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 1.6, 0.45), transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }),
  };
}

/** a torn section of the pressure hull: outer skin, inner wall, glowing torn edges */
function shellPiece(z0, z1, t0, t1, M, rnd) {
  const NZ = 6, NT = 7;
  const jag = (i, j) => {
    // jagged boundary: the edge rows / columns wander a little
    const bz = (i === 0 || i === NZ) ? (rnd() - 0.5) * 0.35 : 0;
    const bt = (j === 0 || j === NT) ? (rnd() - 0.5) * 0.12 : 0;
    return [z0 + (z1 - z0) * (i / NZ) + bz, t0 + (t1 - t0) * (j / NT) + bt];
  };
  const O = [], I = [];
  for (let i = 0; i <= NZ; i++) {
    const ro = [], ri = [];
    for (let j = 0; j <= NT; j++) {
      const [z, t] = jag(i, j);
      const zc = Math.max(HULL.zTip + 0.05, Math.min(HULL.zTail1 - 0.02, z));
      ro.push(sectionPoint(zc, t, 0));
      ri.push(sectionPoint(zc, t, HULL.inset));
    }
    O.push(ro); I.push(ri);
  }
  const c = new THREE.Vector3();
  let n = 0;
  for (const row of O) for (const p of row) { c.add(p); n++; }
  c.divideScalar(n);
  const geo = (grid, flip) => {
    const pos = [];
    for (let i = 0; i < NZ; i++) for (let j = 0; j < NT; j++) {
      const a = grid[i][j], b = grid[i + 1][j], d = grid[i][j + 1], e = grid[i + 1][j + 1];
      const tri = flip ? [a, d, b, b, d, e] : [a, b, d, b, e, d];
      for (const p of tri) pos.push(p.x - c.x, p.y - c.y, p.z - c.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  };
  const rim = () => {
    const pos = [];
    const edge = (A, B) => { for (let k = 0; k < A.length - 1; k++) { const a = A[k], b = A[k + 1], d = B[k], e = B[k + 1]; for (const p of [a, b, d, b, e, d]) pos.push(p.x - c.x, p.y - c.y, p.z - c.z); } };
    edge(O[0], I[0]); edge(I[NZ], O[NZ]);
    edge(O.map((r) => r[NT]), I.map((r) => r[NT])); edge(I.map((r) => r[0]), O.map((r) => r[0]));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  };
  const grp = new THREE.Group();
  const outer = new THREE.Mesh(geo(O, false), M.hull); outer.material.side = THREE.DoubleSide;
  grp.add(outer, new THREE.Mesh(geo(I, true), M.inner), new THREE.Mesh(rim(), M.edge));
  grp.position.copy(c);
  return grp;
}

export class Breakup {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.pieces = [];
  }

  start(reason = 'structure') {
    const g = this.g;
    if (this.active) return;
    this.active = true;
    this.t = 0;
    this.reason = reason;
    const root = g.shipVis.root;
    const M = mats();
    this.M = M;
    let seed = 12345;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // hide the intact ship (keep the particles), show the wreck in its place
    this.group = new THREE.Group();
    root.add(this.group);
    const keep = new Set([this.group, g.fx.add.pts, g.fx.alpha.pts]);
    for (const ch of root.children) if (!keep.has(ch)) { ch.userData._wasVisible = ch.visible; ch.visible = false; }
    if (g.damage && g.damage.group) g.damage.group.visible = false;
    // hull sections
    const zs = [HULL.zTip + 0.1, -9.6, -5.8, -2.2, 1.4, 5.2, HULL.zTail1 - 0.05];
    for (let i = 0; i < zs.length - 1; i++) {
      const nT = i === 0 || i === zs.length - 2 ? 3 : 4;
      for (let k = 0; k < nT; k++) {
        const t0 = k / nT * Math.PI * 2 + rnd() * 0.2, t1 = (k + 1) / nT * Math.PI * 2 + rnd() * 0.2;
        this.add(shellPiece(zs[i], zs[i + 1], t0, t1, M, rnd), rnd, 2.5 + rnd() * 5.5);
      }
    }
    // reactor + engine section, radiator wings, mast
    const reactor = new THREE.Group();
    const rc = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 4.2, 32), M.mli); rc.rotation.x = Math.PI / 2;
    const noz = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.2, 32, 1, true), M.dark); noz.rotation.x = -Math.PI / 2; noz.position.z = 3.2;
    reactor.add(rc, noz); reactor.position.set(0, 0.4, 13.1);
    this.add(reactor, rnd, 1.2, V(0, 0, 1));
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.06, 2.6), M.rad);
      r.position.set(s * 5.4, 0.9, 12.6);
      this.add(r, rnd, 3 + rnd() * 3, V(s, 0.3, 0.2));
    }
    // the cabin spills out: panels, cabinets, cushions, pipes
    for (let k = 0; k < 70; k++) {
      const w = 0.08 + rnd() * 0.6, h = 0.05 + rnd() * 0.45, d = 0.08 + rnd() * 0.7;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.debris[Math.floor(rnd() * M.debris.length)]);
      m.position.set((rnd() - 0.5) * 4, -1.2 + rnd() * 3.4, -11 + rnd() * 20);
      this.add(m, rnd, 2 + rnd() * 9);
    }
    for (let k = 0; k < 14; k++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03 + rnd() * 0.05, 0.03 + rnd() * 0.05, 0.6 + rnd() * 1.8, 8), M.debris[3]);
      m.position.set((rnd() - 0.5) * 3, -1.4 + rnd() * 1.4, -9 + rnd() * 16);
      this.add(m, rnd, 3 + rnd() * 7);
    }
    // flash, fireball, sparks, ice and fragments
    this.fire = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), M.fire);
    this.fire.position.set(0, 0.4, reason === 'reactor' ? 9.5 : -1);
    this.group.add(this.fire);
    this.setLayers(this.fire);
    g.engine.grade.set('uFlash', 1.6);
    g.shake = 3;
    const fx = g.fx;
    for (let k = 0; k < 14; k++) {
      const p = V((rnd() - 0.5) * 4, (rnd() - 0.5) * 3, -11 + rnd() * 21);
      const dir = p.clone().setZ(0).normalize();
      fx.burst('spark', p, dir, 120, { speed: 9, spread: 1.6 });
      fx.burst('debris', p, dir, 90, { speed: 6, spread: 1.6, life: 6 });
      fx.burst('ice', p, dir, 80, { speed: 8, spread: 1.4 });
    }
    g.audio.impact(V(0, 0, -2), 1);
    setTimeout(() => g.audio.impact(V(0, 0, 6), 1), 350);
    setTimeout(() => g.audio.impact(V(0, 1, -8), 0.8), 900);
    if (g.audio.ready) g.audio._burst(null, { dur: 5, freq: 60, q: 0.5, gain: 0.8, type: 'brown', filter: 'lowpass', sweep: 0.3, direct: true });
    // camera: pulled out to a view of the whole wreck
    const side = rnd() < 0.5 ? -1 : 1;
    this.cam = { from: V(side * 9, 3.5, 16), to: V(side * 34, 14, 46) };
  }

  setLayers(o) { o.traverse((x) => { x.layers.set(LAYER_NEAR); x.layers.enable(LAYER_MID); }); }

  add(obj, rnd, speed, bias = null) {
    const c = obj.position.clone();
    const out = c.clone().sub(V(0, 0.4, 0)).setZ(c.z * 0.25);
    if (out.lengthSq() < 1e-4) out.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5);
    out.normalize();
    if (bias) out.add(bias).normalize();
    const vel = out.multiplyScalar(speed).add(V((rnd() - 0.5) * 1.5, (rnd() - 0.5) * 1.5, (rnd() - 0.5) * 1.5));
    const spin = V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(0.3 + rnd() * 1.6);
    this.group.add(obj);
    this.setLayers(obj);
    this.pieces.push({ obj, vel, spin });
  }

  /** camera in ship space while the wreck flies apart */
  camera() {
    if (!this.active) return null;
    const k = Math.min(1, this.t / 9);
    const e = 1 - Math.pow(1 - k, 2);
    const pos = this.cam.from.clone().lerp(this.cam.to, e);
    return { pos, look: V(0, 0.3, 0) };
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const gr = this.g.engine.grade;
    gr.set('uFlash', gr.get('uFlash') * Math.exp(-dt * 2.5));
    gr.set('uAlarm', 0);
    const q = new THREE.Quaternion();
    for (const p of this.pieces) {
      p.obj.position.addScaledVector(p.vel, dt);
      q.setFromAxisAngle(p.spin.clone().normalize(), p.spin.length() * dt);
      p.obj.quaternion.premultiply(q);
    }
    // the torn edges cool down, the fireball swells and fades
    this.M.edge.emissiveIntensity = 1.5 * Math.exp(-this.t * 0.35);
    const f = this.fire;
    if (f) {
      const s = 2 + this.t * 9;
      f.scale.setScalar(s);
      this.M.fire.opacity = Math.max(0, 1 - this.t / 1.6);
      if (this.t > 1.7) { this.group.remove(f); this.fire = null; }
    }
    // secondary bursts as tanks and batteries let go
    if (Math.random() < dt * 1.2 && this.t < 6) {
      const p = this.pieces[Math.floor(Math.random() * this.pieces.length)];
      this.g.fx.burst('spark', p.obj.position, p.vel.clone().normalize(), 60, { speed: 5, spread: 1.4 });
      this.g.fx.burst('ice', p.obj.position, p.vel.clone().normalize(), 40, { speed: 4, spread: 1.2 });
      this.g.audio.impact(p.obj.position, 0.35);
    }
  }
}
