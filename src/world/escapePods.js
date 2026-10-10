// Escape pods. Every station has its pod bays — round hatches in an orange ring with two status
// lamps, 10 to 30 of them by the station's size, in fixed places on its pressurised modules (found
// on the real hull, clear of the panels, the glass and the ring, each with a free way out). When a
// station is crippled its crew abandons it:
//   - the bays' lamps flash, faster as each one's turn comes;
//   - one after another the covers are blown off on their bolts (a flash, a puff of air and ice,
//     the cover tumbling away), the pod is pushed out of its tube on springs, its thrusters puff
//     to steady it and, a dozen metres clear, it lights its engine (a real plume: the ray-marched
//     flame every vessel has) and runs, the pods fanning out from the station;
//   - three grades (podModel.js): small and fast (1200 m/s against the station it left, 42 m/s^2,
//     quick to turn, short on battery), medium (800), large (400 m/s, slow, long-lasting); some
//     carry a gun and fire back at whoever shoots at them; shot at, they jink.
// They are real things in space: H8 tracks them, focuses on them, follows them, and its guns bring
// them down (a few hits for a small one, more for a large one: then a flash, the cabin broken
// open, the hull tumbling away dark).
// Hacking: kept as H8's focus for ten seconds, a pod can be broken into from H8's computer — a few
// seconds of work on the display (layer after layer, the terminal chattering, pips) — and its
// controls are Kaito's: he flies it from the camera in its cabin, its crew panicking in front of
// him, until he lets it go (or the link breaks).
import * as THREE from 'three';
import { buildPod, POD_GRADES } from './podModel.js';
import { EnginePlume } from '../fx/enginePlume.js';
import { QUALITY } from '../core/quality.js';
import { MU_EARTH } from '../core/astro.js';
import { RANGES, LAYER_NEAR, LAYER_MID, LAYER_FAR } from '../core/layers.js';
import { AMMO, GUNS, FireControl, seedOf } from '../combat/ballistics.js';
import { Builder } from '../ship/geom.js';
import { computeBoundsTree } from 'three-mesh-bvh';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _p4 = new THREE.Vector4(), _col = new THREE.Color(), _e = new THREE.Euler();
const grav = (p, out) => { const r = p.length(); return out.copy(p).multiplyScalar(-MU_EARTH / (r * r * r)); };
const Z = V(0, 0, -1), UP = V(0, 1, 0);

function rng(seed) { let s = (Math.abs(seed | 0) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function hashStr(t) { let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619); return h >>> 0; }

/** the render passes for a model at a distance (on every object in it, only when they change) */
function layerTree(root, dmin, dmax) {
  let mask = 0;
  if (dmin < RANGES.near[1]) mask |= 1 << LAYER_NEAR;
  if (dmax > RANGES.mid[0] && dmin < RANGES.mid[1]) mask |= 1 << LAYER_MID;
  if (dmax > RANGES.far[0]) mask |= 1 << LAYER_FAR;
  if (root.userData.lm === mask) return;
  root.userData.lm = mask;
  root.traverse((o) => { o.layers.mask = mask; });
}

// what is the cabin (drawn only when it can be seen into)
const CABIN = new Set(['liner', 'floor', 'seat', 'console', 'screen', 'screenR', 'strip']);
// how long breaking into one takes H8's computer (s), by grade
export const HACK_TIME = { S: 6, M: 8, L: 11 };
const HACK = HACK_TIME;
export const HACK_FOCUS = 10;       // seconds as H8's focus before it can be tried
export const HACK_RANGE = 60e3;     // and no further off than this
const LINK_RANGE = 150e3;           // the stolen link holds out to here
// surfaces a bay is never put on (glass, lamps, panels, foil) — by the station's material names
const NO_BAY = /dome|garden|glass|glow|lit|win|solar|panel|radiat|flood|strobe|nav|gold|cable|truss|mli|lamp|sign/i;
const MAXP = 96;                    // pods drawn as far points at once
export const HACK_STAGES = ['通信ポート走査', '認証バイパス', '制御系へ注入', '操縦権取得'];

/** the cover's face: white, an orange rim, ESCAPE POD and an arrow */
function coverTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d9d7d0'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#e5621c'; g.lineWidth = 12; g.beginPath(); g.arc(64, 64, 57, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#1b1d21'; g.lineWidth = 2; g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#1b1d21'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 17px sans-serif'; g.fillText('ESCAPE', 64, 46); g.fillText('POD', 64, 64);
  g.fillStyle = '#c4161c'; g.font = 'bold 12px sans-serif'; g.fillText('非常脱出', 64, 81);
  g.fillStyle = '#e5621c'; g.beginPath(); g.moveTo(52, 92); g.lineTo(76, 92); g.lineTo(64, 104); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class EscapePods {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.n = 0;
    this.remote = null;           // the pod Kaito flies
    this.hack = null;             // { pod, t, dur, lines, stage }
    this.look = { yaw: 0, pitch: 0 };
    this.wrecks = [];             // broken pods' models (disposed once they have tumbled away)
    const S = (o) => new THREE.MeshStandardMaterial(o);
    const tex = coverTexture();
    this.portMats = {
      ring: S({ color: 0xe5621c, roughness: 0.5, metalness: 0.1 }),
      rim: S({ color: 0x3a3e44, roughness: 0.45, metalness: 0.6 }),
      dark: S({ color: 0x07080a, roughness: 0.95, metalness: 0 }),
      bolt: S({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.85 }),
      coverTop: S({ map: tex, roughness: 0.5, metalness: 0.15 }),
      coverSide: S({ color: 0xbdbab2, roughness: 0.5, metalness: 0.3 }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    };
    // far away a pod is a point: its strobe and its engine's glow
    const fg = new THREE.BufferGeometry();
    this.fPos = new Float32Array(MAXP * 3); this.fCol = new Float32Array(MAXP * 3); this.fSize = new Float32Array(MAXP);
    fg.setAttribute('position', new THREE.BufferAttribute(this.fPos, 3).setUsage(THREE.DynamicDrawUsage));
    fg.setAttribute('color', new THREE.BufferAttribute(this.fCol, 3).setUsage(THREE.DynamicDrawUsage));
    fg.setAttribute('size', new THREE.BufferAttribute(this.fSize, 1).setUsage(THREE.DynamicDrawUsage));
    fg.setDrawRange(0, 0);
    this.fMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */`
        attribute vec3 color; attribute float size; uniform float uScale; varying vec3 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          float d = max(-mv.z, 0.05);
          gl_PointSize = clamp(size * uScale / d, 2.0, 64.0); vC = color * clamp(size * uScale / d / 2.0, 0.3, 1.0); }`,
      fragmentShader: /* glsl */`
        varying vec3 vC;
        void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = dot(p, p); if (r > 1.0) discard;
          float a = exp(-r * 4.0) + 0.35 * exp(-r * 22.0); gl_FragColor = vec4(vC * a, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.far = new THREE.Points(fg, this.fMat);
    this.far.frustumCulled = false;
    this.far.matrixAutoUpdate = false;
    this.far.layers.set(LAYER_NEAR); this.far.layers.enable(LAYER_MID); this.far.layers.enable(LAYER_FAR);
    this.far.renderOrder = 21;
    this.far.visible = false;
    game.engine.scene.add(this.far);
  }

  // ================================================================== the bays
  /**
   * A station's pod bays: found on its hull, then built onto its model. A ray against a whole
   * station is slow, so first each of its meshes gets a BVH (one or a few a call: the rays are
   * then cheap), then the bays are tried. true once they are there.
   */
  prepare(st, budgetMs = 3) {
    if (st.podPorts) return true;
    if (!st.model || !st.model.userData || !st.model.userData.proxies) return false;
    let J = st.podJob;
    if (!J) {
      const R = st.model.userData.radius || 150;
      const n = Math.max(10, Math.min(30, Math.round(10 + (R - 60) / 14)));
      const ud = st.model.userData, skip = ud.dmgGroup, ring = ud.ring;
      const meshes = [];
      st.model.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || !o.geometry || !o.geometry.attributes.position) return;
        if (skip && (o === skip || skip.getObjectById(o.id))) return;
        if (ring && ring.getObjectById(o.id)) return;
        meshes.push(o);
      });
      // (bays go on the pressurised modules: the round proxies of a fair size)
      const mods = ud.proxies.filter((p) => (p.type === 'capsule' || p.type === 'cyl' || p.type === 'sphere') && p.r >= 2.6);
      J = st.podJob = { n, rnd: rng(hashStr(String(st.id))), ports: [], tries: 0, meshes, mods, rc: new THREE.Raycaster(), bvh: 0 };
      J.rc.layers.enableAll();
      J.rc.far = 9;
      J.rc.firstHitOnly = true;
    }
    const t0 = performance.now();
    let did = false;
    while (J.bvh < J.meshes.length && (!did || performance.now() - t0 < budgetMs)) {
      const geo = J.meshes[J.bvh++].geometry;
      // (indirect: the geometry being drawn is left as it is)
      if (!geo.boundsTree) computeBoundsTree.call(geo, { indirect: true });
      did = true;
    }
    if (J.bvh < J.meshes.length) return false;
    st.model.updateMatrixWorld(true);
    const max = J.n * 16;
    while (J.ports.length < J.n && J.tries < max && performance.now() - t0 < budgetMs) {
      J.tries++;
      const c = this.candidate(st, J, J.tries > J.n * 11);
      if (c) J.ports.push(c);
    }
    if (J.ports.length < J.n && J.tries < max) return false;
    const rnd = J.rnd;
    st.podPorts = J.ports.map((c, i) => {
      const u = rnd();
      return { p: c.p, n: c.n, grade: u < 0.4 ? 'S' : u < 0.82 ? 'M' : 'L', armed: rnd() < 0.25, used: false, i, pod: null };
    });
    delete st.podJob;
    this.buildBays(st, st.podPorts);
    // (a station abandoned before this was built: its bays are empty)
    if (st.dmg && st.dmg.podsOut && !st.podLaunch) for (const pt of st.podPorts) { pt.used = true; this.coverOff(st, pt); }
    return true;
  }

  /** one try at a bay: a point on a module's skin with a clear way out; or null */
  candidate(st, J, relaxed) {
    const rnd = J.rnd, P = st.model.userData.proxies, D = this.g.docking;
    if (!J.mods.length) return null;
    const pr = J.mods[Math.floor(rnd() * J.mods.length)];
    const dir = V(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    if (dir.lengthSq() < 1e-4) return null;
    dir.normalize();
    let p, n;
    if (pr.type === 'sphere') { n = dir; p = pr.c.clone().addScaledVector(n, pr.r); }
    else {
      const ax = _v.copy(pr.b).sub(pr.a).normalize();
      n = dir.projectOnPlane(ax);
      if (n.lengthSq() < 1e-4) return null;
      n.normalize();
      p = pr.a.clone().lerp(pr.b, 0.12 + 0.76 * rnd()).addScaledVector(n, pr.r);
    }
    // (apart from the bays already there)
    for (const q of J.ports) if (q.p.distanceTo(p) < 6.5) return null;
    // the way out: nothing of the station within 40 m along it
    const nrm = _v2;
    for (let s = 2; s <= 40; s += 2) {
      const q = _v3.copy(p).addScaledVector(n, s);
      for (const o of P) if (D.proxyDist(q, o, nrm) < 0.8) return null;
    }
    // onto the real plating (a short ray in along the normal), never glass or panels
    const M = st.model.matrixWorld;
    J.rc.set(st.model.localToWorld(p.clone().addScaledVector(n, 4)), n.clone().transformDirection(M).negate());
    const hit = J.rc.intersectObjects(J.meshes, false)[0];
    if (!hit || !hit.face) return relaxed ? { p, n } : null;
    if (NO_BAY.test(hit.object.name || '')) return null;
    const hn = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(_m2.copy(M).invert());
    if (hn.dot(n) < 0) hn.negate();
    if (hn.dot(n) < 0.8) return relaxed ? { p, n } : null;
    return { p: st.model.worldToLocal(hit.point.clone()), n: hn.normalize() };
  }

  /** the bays drawn on the station: dark rim, orange ring, bolts, the covers, two lamps each */
  buildBays(st, ports) {
    const b = new Builder();
    for (const pt of ports) {
      const r = POD_GRADES[pt.grade].R * 1.12;
      const q = new THREE.Quaternion().setFromUnitVectors(UP, pt.n);
      b.pushM(new THREE.Matrix4().compose(pt.p.clone().addScaledVector(pt.n, 0.02), q, V(1, 1, 1)));
      b.cyl(r + 0.26, r + 0.3, 0.08, 'rim', [0, 0.0, 0], null, 28);
      b.torus(r + 0.12, 0.06, 'ring', [0, 0.06, 0], [Math.PI / 2, 0, 0], 32);
      // the open tube's mouth (dark: what is left once the cover has gone)
      b.cyl(r + 0.02, r + 0.02, 0.012, 'dark', [0, 0.045, 0], null, 28);
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + 0.2; b.cyl(0.035, 0.035, 0.05, 'bolt', [Math.cos(a) * (r + 0.2), 0.06, Math.sin(a) * (r + 0.2)], null, 8); }
      b.pop();
    }
    const grp = b.build(this.portMats, { castShadow: false, receiveShadow: true });
    grp.name = 'podBays';
    // the covers (one each, blown off one by one) and the lamps (two each, lit one by one)
    const cg = new THREE.CylinderGeometry(1, 1, 0.08, 28);
    const covers = new THREE.InstancedMesh(cg, [this.portMats.coverSide, this.portMats.coverTop, this.portMats.coverSide], ports.length);
    const lg = new THREE.CylinderGeometry(0.075, 0.09, 0.06, 12);
    const lamps = new THREE.InstancedMesh(lg, this.portMats.lamp, ports.length * 2);
    ports.forEach((pt, i) => {
      const r = POD_GRADES[pt.grade].R * 1.12;
      // (a defined roll: the cover's lettering upright, its top toward the station's up)
      const up0 = Math.abs(pt.n.y) < 0.9 ? V(0, 1, 0) : V(0, 0, -1);
      const xc = up0.clone().addScaledVector(pt.n, -up0.dot(pt.n)).normalize(), zc = new THREE.Vector3().crossVectors(xc, pt.n);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xc, pt.n, zc));
      covers.setMatrixAt(i, _m.compose(pt.p.clone().addScaledVector(pt.n, 0.085), q, V(r, 1, r)));
      // (the lamps beside the ring, across from each other)
      const side = V(1, 0, 0).applyQuaternion(q);
      for (const s of [0, 1]) {
        lamps.setMatrixAt(i * 2 + s, _m.compose(pt.p.clone().addScaledVector(pt.n, 0.05).addScaledVector(side, (s ? 1 : -1) * (r + 0.45)), q, V(1, 1, 1)));
        lamps.setColorAt(i * 2 + s, _col.setRGB(0.35, 0.22, 0.04));
      }
    });
    covers.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
    lamps.instanceColor.needsUpdate = true;
    covers.computeBoundingSphere(); lamps.computeBoundingSphere();
    covers.name = 'podCovers'; lamps.name = 'podLamps';
    covers.frustumCulled = lamps.frustumCulled = false;
    grp.add(covers, lamps);
    st.model.add(grp);
    st.podBays = { grp, covers, lamps };
  }

  coverOff(st, pt) {
    const B = st.podBays;
    if (!B) return;
    B.covers.setMatrixAt(pt.i, _m.makeScale(0, 0, 0));
    B.covers.instanceMatrix.needsUpdate = true;
  }

  // ================================================================== abandon ship
  /**
   * A station's crew abandons it: every bay's pod goes, a second or two apart (sudden: it broke
   * up at once — only those already in their pods get away, at once). How many go.
   */
  launch(st, sudden = false) {
    st.podLaunch = { sudden };
    if (!this.prepare(st, 1e9)) return 0;
    let k = 0;
    const order = st.podPorts.filter((pt) => !pt.used).sort(() => Math.random() - 0.5);
    for (const pt of order) {
      pt.used = true;
      if (sudden && Math.random() < 0.55) { this.coverOff(st, pt); continue; }
      pt.pod = this.add(st, pt, sudden ? 0.2 + Math.random() * 2.5 : 3 + k * (0.7 + Math.random() * 1.3));
      k++;
    }
    st.podAlarm = sudden ? 0 : 6 + k * 1.6;
    if (st.podBays) st.podBays.calm = false;
    return k;
  }

  add(st, pt, delay) {
    const G = POD_GRADES[pt.grade];
    const id = ++this.n;
    const label = `POD-${String(id).padStart(2, '0')}`;
    const code = String(st.en || st.name || 'STATION').replace('（修理基地）', '').toUpperCase();
    const p = {
      id, label, st, pt, grade: pt.grade, G, armed: pt.armed, state: 'wait', t: -delay,
      pos: V(0, 0, 0), vel: V(0, 0, 0), q: new THREE.Quaternion(), w: V(0, 0, 0), refVel: V(0, 0, 0),
      flee: V(0, 0, 0), want: G.vMax * (0.8 + Math.random() * 0.2), n0: null, out: 0,
      battery: 1, hp: G.hp, alive: true, thrust: V(0, 0, 0), accL: V(0, 0, 0), panic: 0.55 + Math.random() * 0.35,
      evadeT: 0, jink: V(0, 0, 0), jinkT: 0, hostile: 0, hostileTo: null, cool: 1, burst: 0, shotT: 0, ammo: 160,
      ctl: { throttle: 0, yaw: 0, pitch: 0, roll: 0 }, model: null, plume: null, level: null, code, rcsT: 0, age: 0,
      name: `脱出ポッド ${label}（${G.name}${pt.armed ? '・武装' : ''}）`,
    };
    if (p.armed) p.fc = new FireControl({ am: AMMO.p30, gun: GUNS.pd30, seed: seedOf('pod', id), sensor: { ang: 0.6e-3, range: 6, vel: 0.3 } });
    this.list.push(p);
    return p;
  }

  /** where a bay is (ECI) and which way it faces; the station's pose */
  portPose(p, outP, outN) {
    const pose = this.g.docking.stationPose(p.st, this.g.time, this._pose || (this._pose = {}));
    outP.copy(p.pt.p).applyQuaternion(pose.quat).add(pose.pos);
    outN.copy(p.pt.n).applyQuaternion(pose.quat);
    return pose;
  }

  // ================================================================== per step
  update(dt) {
    const g = this.g;
    // (bays are found on a station as it is approached: a few rays a frame)
    this.prepT = (this.prepT || 0) - dt;
    const job = g.stations.list.find((s) => s.podJob && !s.podPorts);
    if (job) this.prepare(job, 3);
    else if (this.prepT <= 0) {
      this.prepT = 0.5;
      const me = this.mePos();
      for (const st of g.stations.list) if (!st.podPorts && st.model && st.pos.distanceTo(me) < 40e3) { this.prepare(st, 3); break; }
    }
    for (const st of g.stations.list) if (st.podAlarm > 0) st.podAlarm -= dt;
    if (!this.list.length && !this.hack && !this.wrecks.length) return;
    // (big steps while sleeping are cut into pieces)
    const n = Math.min(40, Math.max(1, Math.ceil(dt / 0.1))), h = dt / n;
    const me = this.mePos();
    for (const p of this.list) {
      if (!p.alive) continue;
      for (let k = 0; k < n && p.alive; k++) {
        p.t += h;
        if (p.state === 'wait') { if (p.t >= 0) this.blow(p); continue; }
        this.step(p, h);
      }
      if (p.state === 'wait') continue;
      p.age += dt;
      // far out of anyone's way, or long gone: given up
      if (p !== this.remote && (p.pos.distanceTo(me) > 900e3 || p.age > 7200)) this.remove(p);
    }
    this.list = this.list.filter((p) => p.alive);
    for (const w of this.wrecks) w.t += dt;
    this.wrecks = this.wrecks.filter((w) => { if (w.t > w.life) { w.model.dispose(); return false; } return true; });
    this.updateHack(dt);
    // the stolen link: H8 must stay near, Kaito in its seat
    const R = this.remote;
    if (R) {
      const h8 = g.h8;
      if (!h8 || !h8.seatedHere() || g.player.state === 'dead') this.release(true);
      else if (R.pos.distanceTo(h8.flight.pos) > LINK_RANGE) { h8.say('hachi_hack_lost', { n: R.label }, { force: true }); this.release(true); }
    }
  }

  mePos() { const g = this.g; return g.playerVessel ? g.playerVessel().pos : g.flight.pos; }

  /** the bay's cover blown off, the pod pushed out of its tube on springs */
  blow(p) {
    const g = this.g;
    const P = _v4, N = _v5;
    const pose = this.portPose(p, P, N);
    p.state = 'eject';
    p.t = 0;
    // (the nose just inside the mouth of the tube, the rest of it down in the station)
    p.pos.copy(P).addScaledVector(N, -p.G.len / 2 + 0.25);
    const fv = g.docking.frameVel(p.st, pose, P, new THREE.Vector3());
    p.vel.copy(fv).addScaledVector(N, 5.5 + Math.random() * 2);
    p.refVel.copy(fv);
    p.q.setFromUnitVectors(Z, N);
    p.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.3);
    // where it will run: out from the station, fanning away from the others
    p.flee.copy(N).add(_v.randomDirection().multiplyScalar(0.45)).normalize();
    // how far it is out of its tube (nose first: its middle starts half its length down in it)
    p.n0 = N.clone();
    p.out = -p.G.len / 2 + 0.25;
    // the cover tumbles away; a flash and a puff of air and ice where it was
    this.coverOff(p.st, p.pt);
    const d = P.distanceTo(this.mePos());
    if (!g.combat || d > 60e3) return;
    g.combat.flash(P.clone().addScaledVector(N, 0.4), [1, 0.85, 0.6], 2.4 * p.G.R, 0.2, fv);
    g.combat.flash(P.clone().addScaledVector(N, 1.2), [0.85, 0.9, 1.0], 3.2 * p.G.R, 0.5, fv.clone().addScaledVector(N, 4));
    const r = p.G.R * 1.12;
    const cover = new THREE.Mesh(this.coverGeo || (this.coverGeo = new THREE.CylinderGeometry(1, 1, 0.08, 20)), [this.portMats.coverSide, this.portMats.coverTop, this.portMats.coverSide]);
    cover.scale.set(r, 1, r);
    cover.quaternion.setFromUnitVectors(UP, N);
    const wrap = new THREE.Group();
    wrap.add(cover);
    g.combat.addWreck(wrap, P.clone().addScaledVector(N, 0.3), fv.clone().addScaledVector(N, 10 + Math.random() * 5).add(_v.randomDirection().multiplyScalar(1.5)), 50, r + 0.3);
    const F = g.worldDamage && g.worldDamage.fxOf ? g.worldDamage.fxOf(p.st) : null;
    if (F) {
      const pl = p.pt.p.clone().addScaledVector(p.pt.n, 0.3);
      F.P.burst('ice', pl, p.pt.n, 40, { speed: 7, spread: 0.7, size: 16, life: 1.4 });
      F.P.burst('spark', pl, p.pt.n, 26, { speed: 11, spread: 1.1, size: 9 });
      F.P.burst('smoke', pl, p.pt.n, 8, { speed: 1.6, spread: 0.9, size: 26, life: 2.2 });
    }
    // heard (and felt) only from right by it
    if (d < 300 && g.audio.ready) g.audio.impact(new THREE.Vector3(0, 0, -20), Math.min(0.4, 0.3 * (1 - d / 300)));
  }

  /** one pod's flight: out of its bay, clear of the station, then away; or Kaito flying it */
  step(p, dt) {
    const G = p.G;
    const acc = _v3.set(0, 0, 0);
    const fwd = _v.copy(Z).applyQuaternion(p.q);
    let want = null, turnK = 1;
    if (p.state === 'eject') {
      // out of its tube, the thrusters steadying it; it lights a dozen metres clear
      p.w.multiplyScalar(Math.exp(-dt * 1.4));
      // (measured in the station's own frame: it is moving at orbital speed with it)
      p.out += _v2.copy(p.vel).sub(p.refVel).dot(p.n0) * dt;
      if (p.out > G.len / 2 + 12 && p.t > 1.5) { p.state = 'flee'; p.ignite = true; }
    } else if (p.state === 'flee' || p.state === 'coast') {
      // away: up to its speed along its way out, then it coasts (a reserve kept for dodging)
      const vRel = _v2.copy(p.vel).sub(p.refVel);
      want = p.flee;
      if (p.state === 'flee' && p.battery > 0.2) {
        acc.copy(p.flee).multiplyScalar(p.want).sub(vRel);
        const l = acc.length();
        if (l < 3) p.state = 'coast';
        else acc.multiplyScalar(Math.min(1, G.accel / l) * Math.min(1, l / 30 + 0.3));
      }
      // shot at: it jinks (while its battery lasts)
      if (p.evadeT > 0) {
        p.evadeT -= dt;
        p.jinkT -= dt;
        if (p.jinkT <= 0) { p.jinkT = 0.5 + Math.random() * (G.turn > 2 ? 0.6 : 1.4); p.jink.randomDirection(); }
        if (p.battery > 0.03) acc.addScaledVector(p.jink, G.accel * 0.8);
        turnK = 1.4;
        if (p.evadeT <= 0 && p.state === 'coast' && p.battery > 0.2) p.state = 'flee';
      }
      // armed and shot at: it turns on whoever did it and fires back
      if (p.armed && p.hostile > 0 && p.hostileTo) {
        p.hostile -= dt;
        const to = _v4.copy(p.hostileTo.pos).sub(p.pos);
        if (to.length() < 5000) { want = to.normalize(); this.fire(p, dt); }
      }
    } else if (p.state === 'remote') {
      // Kaito's hands: the throttle along the nose (backwards on the thrusters), the stick turns it
      const c = p.ctl;
      const th = c.throttle > 0 ? c.throttle * G.accel : c.throttle * G.accel * 0.3;
      if (p.battery > 0) acc.copy(fwd).multiplyScalar(th);
      const tr = G.turn;
      p.w.set(c.pitch * tr * 0.8, -c.yaw * tr, -c.roll * tr * 1.2).applyQuaternion(p.q);
    }
    if (acc.length() > G.accel) acc.setLength(G.accel);
    // (the main engine pushes along the nose; the thrusters manage a little sideways)
    if (p.state !== 'remote' && acc.lengthSq() > 1e-6) {
      const along = Math.max(0, acc.dot(fwd));
      const side = _v2.copy(acc).addScaledVector(fwd, -acc.dot(fwd));
      if (side.length() > G.accel * 0.12) side.setLength(G.accel * 0.12);
      if (!want || p.evadeT > 0) want = _v4.copy(acc).normalize();
      acc.copy(fwd).multiplyScalar(along).add(side);
    }
    // battery: the engine drains it in its burn time (and a little for the lights and the air)
    if (p.battery > 0) p.battery = Math.max(0, p.battery - dt * (acc.length() / G.accel / G.burn + 1 / 14400));
    if (p.battery <= 0) { acc.set(0, 0, 0); if (p.state === 'flee') p.state = 'coast'; }
    // attitude: toward where it wants to go (or as Kaito turns it)
    if (p.state !== 'remote' && want && p.state !== 'eject') {
      const qWant = _q.setFromUnitVectors(Z, want);
      const ang = p.q.angleTo(qWant);
      const maxT = G.turn * turnK * dt;
      if (ang > 1e-5) p.q.slerp(qWant, Math.min(1, maxT / ang));
    } else {
      const wl = p.w.length();
      if (wl > 1e-8) p.q.premultiply(_q2.setFromAxisAngle(_v2.copy(p.w).divideScalar(wl), wl * dt));
    }
    p.q.normalize();
    // fly (second order: gravity and its own push)
    const gg = grav(p.pos, _v2).add(acc);
    p.pos.addScaledVector(p.vel, dt).addScaledVector(gg, 0.5 * dt * dt);
    p.vel.addScaledVector(gg, dt);
    p.refVel.addScaledVector(grav(p.pos, _v2), dt);
    // (no faster than its top speed against the station it left: its flight computer holds it)
    const rv = _v2.copy(p.vel).sub(p.refVel), sp = rv.length();
    if (sp > G.vMax) p.vel.copy(p.refVel).addScaledVector(rv, G.vMax / sp);
    p.thrust.copy(acc);
    p.accL.copy(acc).applyQuaternion(_q.copy(p.q).invert());
    const scared = p.evadeT > 0 || p.state === 'remote' || p.state === 'eject';
    p.panic = Math.min(1, Math.max(0.35, p.panic + (scared ? dt * 0.4 : -dt * 0.01)));
  }

  /** an armed pod's gun on whoever shot at it */
  fire(p, dt) {
    const g = this.g, T = p.hostileTo;
    if (!T || !p.fc || p.ammo <= 0 || p.state === 'remote' || !g.combat) return;
    p.fc.tick(dt);
    p.fc.observe('t', T.pos, T.vel, null, dt);
    const sol = p.fc.solve('t', p.pos, p.vel);
    p.cool -= dt; p.shotT -= dt;
    // (only once the nose is round toward it: the turret covers the front)
    if (!sol || _v2.copy(Z).applyQuaternion(p.q).dot(sol.aimDir) < 0.6) return;
    if (p.burst <= 0 && p.cool <= 0) { p.burst = 5 + Math.floor(Math.random() * 6); if (!p.saidFire && g.h8) { p.saidFire = true; g.h8.say('hachi_pod_fire', { n: p.label }, { minGap: 8 }); } }
    if (p.burst > 0 && p.shotT <= 0) {
      p.shotT = 1 / GUNS.pd30.rof; p.burst--; p.ammo--;
      const at = this.muzzle(p, new THREE.Vector3());
      g.combat.fire({ kind: 'pd', round: p.fc.fire(at, p.vel, sol.aimDir, 1.3), pos: at, vel: p.vel, dir: sol.aimDir, owner: p });
      if (p.burst <= 0) p.cool = 1.4 + Math.random() * 2;
    }
  }

  muzzle(p, out) {
    const gun = p.model ? p.model.gunAt : null;
    return out.copy(gun || V(0, p.G.R * 1.2, -p.G.len / 2)).applyQuaternion(p.q).add(p.pos);
  }

  // ================================================================== hits
  /** a round found it: E (J), hit (the point, pod-centred ECI, and the normal), r (the round) */
  damage(p, E, hit, r) {
    if (!p.alive) return;
    const g = this.g;
    p.hp -= E / 1.6e5;
    p.evadeT = 8;
    p.panic = 1;
    if (r && r.byPlayer && !(this.remote === p)) { p.hostile = 150; p.hostileTo = g.playerVessel ? g.playerVessel() : null; }
    const at = hit && hit.point ? hit.point : new THREE.Vector3();
    const n = hit && hit.n ? hit.n : V(0, 1, 0);
    if (g.combat) {
      const A = g.combat.anchorAt(p.pos, p.vel);
      A.P.burst('spark', at.clone(), n, 24, { speed: 12, spread: 1.2, size: 8 });
      A.P.burst('debris', at.clone(), n, 6, { speed: 4, spread: 1.0, size: 8, life: 2 });
      if (p.hp < p.G.hp * 0.5) A.P.burst('smoke', at.clone(), n, 4, { speed: 1, spread: 1, size: 14, life: 2.5 });
    }
    if (p.hp > 0) return;
    // broken up
    p.alive = false;
    if (this.remote === p) { this.release(true); if (g.h8) g.h8.say('hachi_hack_lost', { n: p.label }, { force: true }); }
    if (this.hack && this.hack.pod === p) this.hack = null;
    if (p.plume) { p.plume.dispose(); p.plume = null; }
    if (g.combat) {
      g.combat.explode(p.pos.clone(), p.vel.clone(), 0.32 + p.G.R * 0.22, true);
      // the hull tumbles away, broken open and dark; pieces of it with it
      if (p.model) {
        const M = p.model;
        M.wreck();
        M.root.parent && M.root.parent.remove(M.root);
        g.combat.addWreck(M.root, p.pos.clone(), p.vel.clone().add(_v.randomDirection().multiplyScalar(2.5)), 90, p.G.len);
        const w = g.combat.wrecks[g.combat.wrecks.length - 1];
        if (w) { w.q.copy(p.q); w.spin = 0.5 + Math.random() * 1.2; }
        this.wrecks.push({ model: M, t: 0, life: 91 });
        p.model = null;
      }
      const mats = this.shardMats || (this.shardMats = [new THREE.MeshStandardMaterial({ color: 0xd8d5cc, roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide }), new THREE.MeshStandardMaterial({ color: 0xd2601c, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide }), new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.6, metalness: 0.5 })]);
      const geo = this.shardGeo || (this.shardGeo = [new THREE.BoxGeometry(0.5, 0.03, 0.34), new THREE.BoxGeometry(0.3, 0.03, 0.62), new THREE.BoxGeometry(0.22, 0.18, 0.3)]);
      for (let k = 0; k < 4 + Math.floor(p.G.R * 3); k++) {
        const m = new THREE.Mesh(geo[k % 3], mats[k % 3]);
        m.scale.setScalar(0.6 + Math.random() * p.G.R);
        g.combat.addWreck(m, p.pos.clone().add(_v.randomDirection().multiplyScalar(p.G.R)), p.vel.clone().add(_v.randomDirection().multiplyScalar(4 + Math.random() * 10)), 40, 1);
      }
    }
    if (g.h8 && r && r.byPlayer) g.h8.say('hachi_pod_down', { n: p.label }, { minGap: 3 });
  }

  remove(p) {
    p.alive = false;
    if (this.remote === p) this.release(true);
    if (this.hack && this.hack.pod === p) this.hack = null;
    if (p.model) { p.model.dispose(); p.model = null; }
    if (p.plume) { p.plume.dispose(); p.plume = null; }
  }

  /** what the display says about it */
  status(p) {
    if (p === this.remote) return '遠隔操縦中（HACHI）';
    if (this.hack && this.hack.pod === p) return '侵入中…';
    const b = `電池 ${Math.round(p.battery * 100)}%`;
    if (p.state === 'eject') return '射出中';
    if (p.battery <= 0) return '電池切れ・漂流';
    if (p.armed && p.hostile > 0) return `反撃中  ${b}`;
    if (p.evadeT > 0) return `回避中  ${b}`;
    return `${p.state === 'flee' ? '離脱中' : '慣性飛行'}  ${b}`;
  }

  // ================================================================== hacking
  /** how long a pod has been H8's focus (s), and whether it can be broken into now */
  hackState(p) {
    const g = this.g, h8 = g.h8;
    if (!h8 || !h8.hud || !p || !p.alive) return { ok: false, focus: 0 };
    const H = h8.hud;
    const focus = H.primaryId === 'pod:' + p.id ? (H.primT || 0) : 0;
    const d = p.pos.distanceTo(h8.flight.pos);
    const busy = !!this.remote || !!this.hack;
    const ready = p.state !== 'wait' && p.state !== 'eject';
    return { ok: focus >= HACK_FOCUS && d < HACK_RANGE && !busy && ready, focus, far: d >= HACK_RANGE, busy, ready };
  }

  startHack(p) {
    const s = this.hackState(p);
    if (!s.ok) return false;
    this.hack = { pod: p, t: 0, dur: HACK[p.grade] || 8, lines: [], beepT: 0, stage: 0, hex: 0 };
    const h8 = this.g.h8;
    if (h8) h8.say('hachi_hack_start', { n: p.label }, { minGap: 2, force: true });
    const A = this.g.audio;
    if (A.ready) for (let i = 0; i < 4; i++) A.beep(600 + i * 400, 0.04, 0.035, { direct: true, type: 'square', when: i * 0.05 });
    return true;
  }

  cancelHack(why, quiet = false) {
    if (!this.hack) return;
    const h8 = this.g.h8;
    if (h8 && !quiet) h8.say('hachi_hack_fail', { why }, { minGap: 2, force: true });
    const A = this.g.audio;
    if (A.ready) { A.beep(420, 0.12, 0.05, { direct: true, type: 'square' }); A.beep(300, 0.2, 0.05, { direct: true, type: 'square', when: 0.13 }); }
    this.hack = null;
  }

  updateHack(dt) {
    const H = this.hack;
    if (!H) return;
    const p = H.pod, g = this.g, A = g.audio, h8 = g.h8;
    if (!p.alive) { this.cancelHack('目標喪失'); return; }
    // (it must stay locked; it need not stay in the middle of the view while the work goes on)
    if (!h8 || !h8.hud || !h8.hud.isLocked('pod:' + p.id)) { this.cancelHack('ロックが外れた'); return; }
    if (!h8.seatedHere()) { this.cancelHack('席を離れた'); return; }
    if (p.pos.distanceTo(h8.flight.pos) > HACK_RANGE * 1.15) { this.cancelHack('距離が遠すぎる'); return; }
    H.t += Math.min(dt, 0.1);
    // the computer's chatter: pips at random pitches, a rising run at each layer it gets through
    H.beepT -= dt;
    if (H.beepT <= 0 && A.ready) {
      H.beepT = 0.06 + Math.random() * 0.09;
      A.beep(880 + Math.floor(Math.random() * 7) * 220, 0.03, 0.028, { direct: true, type: Math.random() < 0.5 ? 'square' : 'triangle' });
    }
    const stage = Math.min(HACK_STAGES.length - 1, Math.floor(H.t / H.dur * HACK_STAGES.length));
    if (stage > H.stage) {
      H.stage = stage;
      if (A.ready) for (let i = 0; i < 3; i++) A.beep(1500 + i * 350, 0.05, 0.04, { direct: true, when: i * 0.07 });
      H.lines.push(`== ${String(stage).padStart(2, '0')} ${HACK_STAGES[stage - 1]} 完了 ==`);
    }
    // the terminal's lines
    H.hex += Math.min(dt, 0.1) * 18;
    while (H.hex >= 1) {
      H.hex -= 1;
      const hx = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0').toUpperCase();
      const verb = [['SCAN', 'PING', 'PORT'], ['AUTH', 'SALT', 'KEYX', 'BYPASS'], ['INJECT', 'PATCH', 'FLASH', 'ROUTE'], ['TAKE', 'BIND', 'SYNC', 'ACK']][stage];
      const v = verb[Math.floor(Math.random() * verb.length)];
      H.lines.push(`${v.padEnd(6)} ${hx()}:${hx()} ${hx()}${hx()} ${['OK', 'OK', 'OK', 'RETRY', '…'][Math.floor(Math.random() * 5)]}`);
      if (H.lines.length > 40) H.lines.shift();
    }
    if (H.t >= H.dur) { this.hack = null; this.takeOver(p); }
  }

  /** its controls are Kaito's: he flies it from the camera in its cabin */
  takeOver(p) {
    const g = this.g, A = g.audio;
    this.remote = p;
    p.state = 'remote';
    p.ctl.throttle = p.ctl.yaw = p.ctl.pitch = p.ctl.roll = 0;
    p.panic = 1;
    p.w.set(0, 0, 0);
    this.look.yaw = 0; this.look.pitch = 0;
    this.switchT = 0;
    // (its cabin built now, so the very first piloted frame already looks out of it)
    if (!p.model || p.level !== QUALITY.level) this.buildModel(p);
    if (A.ready) { A.beep(1320, 0.08, 0.06, { direct: true }); A.beep(1760, 0.12, 0.06, { direct: true, when: 0.1 }); A.beep(2640, 0.22, 0.05, { direct: true, when: 0.22 }); }
    if (g.h8) g.h8.say('hachi_hack_done', { n: p.label }, { force: true });
  }

  /** let it go (its crew have it back) */
  release(quiet = false) {
    const p = this.remote;
    if (!p) return;
    this.remote = null;
    if (p.alive) {
      p.state = p.battery > 0.2 ? 'flee' : 'coast';
      p.w.set(0, 0, 0);
      // (they run on the way it is pointing now, at what speed it has)
      p.flee.copy(Z).applyQuaternion(p.q);
    }
    const A = this.g.audio;
    if (A.ready) { A.beep(1760, 0.06, 0.05, { direct: true }); A.beep(1100, 0.1, 0.05, { direct: true, when: 0.08 }); }
    if (!quiet && this.g.h8) this.g.h8.say('hachi_hack_off', { n: p.label }, { minGap: 2 });
    if (this.cv) { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.cv.width, this.cv.height); this.cv.style.display = 'none'; this.cvOn = false; }
  }

  /** the sticks (and a drag to look round the cabin), while Kaito flies a pod */
  remoteInput(fi, inp) {
    const p = this.remote;
    if (!p) return;
    const c = p.ctl;
    if (!fi) { c.throttle = c.yaw = c.pitch = c.roll = 0; }
    else { c.throttle = fi.throttle || 0; c.yaw = fi.yaw || 0; c.pitch = fi.pitch || 0; c.roll = fi.roll || 0; }
    if (inp) {
      const L = this.look;
      L.yaw = Math.max(-2.9, Math.min(2.9, L.yaw - (inp.lookDX || 0) * 0.004));
      L.pitch = Math.max(-1.1, Math.min(1.1, L.pitch - (inp.lookDY || 0) * 0.004));
      // (flying it, the eye drifts back to the front)
      if (Math.abs(c.throttle) + Math.abs(c.yaw) + Math.abs(c.pitch) > 0.05) { L.yaw *= 0.97; L.pitch *= 0.97; }
    }
  }

  /** the cabin camera of the pod being flown: { pos (ECI), quat } */
  remoteCamera(out = {}) {
    const p = this.remote;
    if (!p) return null;
    const cam = p.model ? p.model.cam : V(0, p.G.R * 0.42, 0);
    out.pos = (out.pos || new THREE.Vector3()).copy(cam).applyQuaternion(p.q).add(p.pos);
    // (a little shake as it burns, more when it is hit)
    const t = performance.now() / 1000, k = Math.min(1, p.thrust.length() / p.G.accel) * 0.004 + (p.evadeT > 7 ? 0.01 : 0);
    _q2.setFromEuler(_e.set(-0.05 + this.look.pitch + Math.sin(t * 41) * k, this.look.yaw + Math.sin(t * 37 + 1) * k, Math.sin(t * 29 + 2) * k, 'YXZ'));
    out.quat = (out.quat || new THREE.Quaternion()).copy(p.q).multiply(_q2);
    return out;
  }

  /** a tap while flying a pod: its buttons; true if one took it */
  remoteTap(tap) {
    if (!this.remote || tap.px === undefined) return false;
    for (const b of this.btns || []) {
      if (tap.px < b.x0 || tap.px > b.x1 || tap.py < b.y0 || tap.py > b.y1) continue;
      if (b.k === 'release') this.release();
      else if (b.k === 'fire') this.remoteFire();
      return true;
    }
    return false;
  }

  /** the pod's own gun, straight ahead (a short burst) */
  remoteFire() {
    const p = this.remote, g = this.g;
    if (!p || !p.armed || p.ammo <= 0 || !g.combat) return;
    if ((this.fireT || 0) > performance.now()) return;
    this.fireT = performance.now() + 750;
    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        if (!p.alive || this.remote !== p || p.ammo <= 0) return;
        const at = this.muzzle(p, new THREE.Vector3());
        g.combat.fire({ kind: 'pd', pos: at, vel: p.vel, dir: new THREE.Vector3(0, 0, -1).applyQuaternion(p.q), owner: p, byPlayer: true, disp: 1.2 });
        p.ammo--;
        if (g.audio.ready) g.audio.beep(150, 0.05, 0.07, { direct: true, type: 'sawtooth' });
      }, i * 125);
    }
  }

  // ================================================================== drawing
  updateVisual(dt, origin, camWorld) {
    const g = this.g, t = performance.now() / 1000;
    // the bays' lamps: dim amber at rest; flashing while the station is abandoned, faster as each
    // bay's turn comes; dark once its pod is gone
    for (const st of g.stations.list) {
      const B = st.podBays;
      if (!B || !st.model.visible) continue;
      const alarm = st.podAlarm > 0;
      if (!alarm && B.calm) continue;
      B.calm = !alarm;
      st.podPorts.forEach((pt, i) => {
        const pod = pt.pod;
        let r = 0.35, gg = 0.22, b = 0.04;
        if (pt.used && (!pod || pod.state !== 'wait')) { r = 0.06; gg = 0.0; b = 0.0; }
        else if (alarm) {
          const left = pod ? -pod.t : 5;
          const f = left < 3 ? 6 : 2.2;
          const on = (t * f + i * 0.13) % 1 < 0.5;
          r = on ? 4 : 0.2; gg = on ? (left < 3 ? 0.5 : 1.6) : 0.05; b = on ? 0.1 : 0;
        }
        for (const s of [0, 1]) B.lamps.setColorAt(i * 2 + s, _col.setRGB(r, s && alarm ? gg * 0.6 : gg, b));
      });
      B.lamps.instanceColor.needsUpdate = true;
    }
    if (!this.list.length) { this.far.visible = false; this.drawRemote(); return; }
    const cam = g.engine.camera;
    const pxK = g.engine.pxPerRad(cam);
    this.fMat.uniforms.uScale.value = pxK;
    let nf = 0, builds = 0;
    for (const p of this.list) {
      if (!p.alive || p.state === 'wait') { if (p.model) p.model.root.visible = false; continue; }
      const rel = _v.copy(p.pos).sub(origin);
      const d = rel.distanceTo(camWorld);
      const px = p.G.len / Math.max(1, d) * pxK;
      const burn = p.thrust.length() > 0.5 && p.state !== 'eject' ? Math.min(1.1, Math.max(0, p.thrust.dot(_v3.copy(Z).applyQuaternion(p.q))) / p.G.accel) : 0;
      // far: a point (its strobe; its engine's glow)
      if (px < 30 && nf < MAXP - 1) {
        const strobe = p.model ? p.model.strobeOn(t) : (t * 1.1 + p.id * 0.37) % 1 < 0.06;
        const fade = Math.min(1, (30 - px) / 20);
        if (burn > 0.05) {
          const at = _v2.set(0, 0, p.G.len / 2 + p.G.R).applyQuaternion(p.q).add(rel);
          this.fPos[nf * 3] = at.x; this.fPos[nf * 3 + 1] = at.y; this.fPos[nf * 3 + 2] = at.z;
          const k = 3 * burn * fade, warm = p.grade === 'S';
          this.fCol[nf * 3] = (warm ? 1.0 : 0.6) * k; this.fCol[nf * 3 + 1] = (warm ? 0.72 : 0.78) * k; this.fCol[nf * 3 + 2] = (warm ? 0.4 : 1.0) * k;
          this.fSize[nf] = p.G.R * 3.5 * (0.8 + 0.2 * Math.sin(t * 40 + p.id));
          nf++;
        }
        if (strobe && p.battery > 0) {
          this.fPos[nf * 3] = rel.x; this.fPos[nf * 3 + 1] = rel.y; this.fPos[nf * 3 + 2] = rel.z;
          this.fCol[nf * 3] = this.fCol[nf * 3 + 1] = this.fCol[nf * 3 + 2] = 5 * fade;
          this.fSize[nf] = 1.8;
          nf++;
        }
      }
      // (the model is built once it is more than a dot — a couple a frame — at the level of the moment)
      if ((!p.model || p.level !== QUALITY.level) && (px > 1.5 || p === this.remote) && (builds < 2 || p === this.remote)) { this.buildModel(p); builds++; }
      if (!p.model) continue;
      const M = p.model, r = M.root;
      r.visible = px > 0.8 || p === this.remote;
      if (!r.visible) { if (p.plume) p.plume.mesh.visible = false; continue; }
      r.matrix.compose(rel, p.q, _v2.set(1, 1, 1));
      r.matrixWorld.copy(r.matrix);
      r.updateMatrixWorld(true);
      layerTree(r, Math.max(0, d - p.G.len), d + p.G.len);
      // the cabin and its crew only when it is big enough to be seen into (or being flown)
      const inside = px > 60 || p === this.remote;
      if (inside !== p.inside) {
        p.inside = inside;
        r.traverse((o) => { if (o.isMesh && CABIN.has(o.name)) o.visible = inside; });
        for (const c of M.crew) c.root.visible = inside;
      }
      M.tick(dt, t, p.panic, p.accL, p.battery <= 0, inside);
      // its engine: lit while it burns
      if (!p.plume && (burn > 0 || p.ignite)) {
        p.plume = new EnginePlume(r, { exits: [M.exit], r0: p.G.R * 0.36, len: p.G.R * 11, style: p.grade === 'S' ? 'chem' : 'blue', spread: 0.3, dia: 0.6, gain: 1.6, seed: p.id * 1.7, owner: p });
      }
      if (p.plume) { p.plume.update(dt, p.ignite ? Math.max(burn, 0.6) : burn, 0, 0); p.plume.setDistance(d); }
      p.ignite = false;
      // the thrusters' puffs (steadying it out of its tube; Kaito turning it; dodging)
      p.rcsT -= dt;
      const turning = p.state === 'eject' || (p === this.remote && Math.abs(p.ctl.yaw) + Math.abs(p.ctl.pitch) + Math.abs(p.ctl.roll) > 0.1) || p.evadeT > 0;
      if (turning && p.rcsT <= 0 && d < 3000 && g.combat) {
        p.rcsT = 0.09 + Math.random() * 0.1;
        const q = M.rcs[Math.floor(Math.random() * M.rcs.length)];
        const at = _v2.copy(q).applyQuaternion(p.q).add(p.pos);
        const out = _v3.copy(q).setZ(0).normalize().applyQuaternion(p.q);
        g.combat.flash(at, [0.75, 0.8, 0.9], 0.22 * p.G.R, 0.09, _v4.copy(p.vel).addScaledVector(out, 6));
      }
    }
    // the far points
    const fg = this.far.geometry;
    fg.setDrawRange(0, nf);
    fg.attributes.position.needsUpdate = fg.attributes.color.needsUpdate = fg.attributes.size.needsUpdate = true;
    this.far.visible = nf > 0;
    this.drawRemote();
  }

  buildModel(p) {
    if (p.model) { p.model.dispose(); p.model = null; }
    if (p.plume) { p.plume.dispose(); p.plume = null; }
    p.level = QUALITY.level;
    p.model = buildPod(p.grade, p.armed, p.level, p.label, p.code);
    const r = p.model.root;
    r.matrixAutoUpdate = false;
    p.inside = undefined;
    this.g.engine.scene.add(r);
    const env = this.g.shipVis && this.g.shipVis.envSpace;
    if (env) r.traverse((o) => { const m = o.material; if (o.isMesh && m && m.isMeshStandardMaterial && !m.envMap && !m.transparent) { m.envMap = env; m.envMapIntensity = 0.8; m.needsUpdate = true; } });
  }

  /** the pods flying (for H8's display, the guns) */
  active() { return this.list.filter((p) => p.alive && p.state !== 'wait'); }

  // ================================================================== the remote pilot's screen
  /** over the pod's cabin camera: what is being flown, the link, speed, battery, H8, the buttons */
  drawRemote() {
    const p = this.remote;
    if (!p) return;
    const g = this.g;
    if (!this.cv) {
      const cv = document.createElement('canvas');
      cv.id = 'hud-pod';
      cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none;';
      const host = document.getElementById('hud-h8');
      (host && host.parentElement ? host.parentElement : document.body).appendChild(cv);
      this.cv = cv; this.ctx = cv.getContext('2d');
    }
    const cv = this.cv, ctx = this.ctx;
    if (!this.cvOn) { cv.style.display = 'block'; this.cvOn = true; }
    const W = cv.clientWidth || window.innerWidth, H = cv.clientHeight || window.innerHeight, pr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * pr) || cv.height !== Math.round(H * pr)) { cv.width = Math.round(W * pr); cv.height = Math.round(H * pr); }
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const t = performance.now() / 1000;
    this.switchT = (this.switchT || 0) + 1 / 60;
    const FONT = '"Hiragino Sans","Noto Sans JP",sans-serif', MONO = '"SF Mono","Menlo","Consolas",monospace';
    const col = 'rgba(140,255,190,0.95)', dim = 'rgba(140,255,190,0.6)', warn = 'rgba(255,190,90,0.97)', red = 'rgba(255,92,64,0.98)';
    const h8 = g.h8;
    const dH8 = h8 ? p.pos.distanceTo(h8.flight.pos) : 0;
    const link = Math.max(0, 1 - dH8 / LINK_RANGE);
    const fmt = (d) => (d < 1000 ? d.toFixed(0) + ' m' : (d / 1000).toFixed(1) + ' km');
    // the stolen feed: scan lines, a rolling bar; static as the link weakens (and as it cuts in)
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = (t * 30) % 3; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    const roll = ((t * 0.25) % 1) * (H + 120) - 60;
    ctx.fillStyle = 'rgba(160,255,200,0.035)'; ctx.fillRect(0, roll, W, 60);
    const noise = (1 - link) * 0.6 + (this.switchT < 0.6 ? (0.6 - this.switchT) * 1.6 : 0);
    if (noise > 0.02) {
      for (let i = 0; i < 160 * noise; i++) { ctx.fillStyle = `rgba(220,255,230,${0.06 + Math.random() * 0.12})`; ctx.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 40, 1 + Math.random() * 2); }
    }
    // the feed's corners
    ctx.strokeStyle = dim; ctx.lineWidth = 1.5;
    const m = 18, L = 26;
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) { ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke(); }
    // top left: what is being flown, the link
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `700 15px ${FONT}`; ctx.fillStyle = col;
    ctx.fillText(`遠隔操縦  ${p.label}（${p.G.name}${p.armed ? '・武装' : ''}）`, 30, 26);
    ctx.font = `500 11.5px ${FONT}`; ctx.fillStyle = dim;
    ctx.fillText(`${p.code}  脱出ポッド  ·  HACHI 経由の奪取リンク`, 30, 46);
    const bars = Math.ceil(link * 5);
    for (let i = 0; i < 5; i++) { ctx.fillStyle = i < bars ? (link < 0.25 ? red : col) : 'rgba(140,255,190,0.18)'; ctx.fillRect(30 + i * 9, 74 - i * 3, 6, 6 + i * 3); }
    ctx.font = `600 11.5px ${MONO}`; ctx.fillStyle = link < 0.25 ? red : col;
    ctx.fillText(`LINK ${Math.round(link * 100)}%  H8 ${fmt(dH8)}`, 80, 66);
    if ((t % 1) < 0.6) { ctx.fillStyle = red; ctx.beginPath(); ctx.arc(36, 98, 4, 0, Math.PI * 2); ctx.fill(); ctx.font = `700 11px ${MONO}`; ctx.fillText('LIVE', 46, 92); }
    // top right: speed, push, battery, hull
    const vRel = _v.copy(p.vel).sub(p.refVel).length();
    const vH8 = h8 ? _v2.copy(p.vel).sub(h8.flight.vel).length() : 0;
    ctx.textAlign = 'right';
    ctx.font = `700 22px ${MONO}`; ctx.fillStyle = col;
    ctx.fillText(`${vRel.toFixed(0)} m/s`, W - 30, 24);
    ctx.font = `500 11px ${FONT}`; ctx.fillStyle = dim;
    ctx.fillText(`離脱元基準 / 最大 ${p.G.vMax} m/s   対H8 ${vH8.toFixed(0)} m/s`, W - 30, 52);
    ctx.fillText(`推力 ${(p.thrust.length() / 9.81).toFixed(1)} G`, W - 30, 68);
    const bx = W - 30 - 150, by = 86;
    ctx.fillStyle = 'rgba(140,255,190,0.15)'; ctx.fillRect(bx, by, 150, 7);
    ctx.fillStyle = p.battery < 0.15 ? red : p.battery < 0.35 ? warn : col; ctx.fillRect(bx, by, 150 * p.battery, 7);
    ctx.font = `600 11px ${FONT}`; ctx.fillStyle = dim; ctx.fillText(`電池 ${Math.round(p.battery * 100)}%   船体 ${Math.round(Math.max(0, p.hp / p.G.hp) * 100)}%${p.armed ? `   弾 ${p.ammo}` : ''}`, W - 30, 100);
    // the middle: the nose's mark, the way it is moving (against H8), H8 itself
    const cam = g.engine.camera;
    const view = _m.compose(g.camWorld, g.viewQuat || g.camQuat, _v3.set(1, 1, 1)).invert();
    const vp = _m2.multiplyMatrices(cam.projectionMatrix, view);
    const proj = (dir, far = 1e5) => {
      _p4.set(g.camWorld.x + dir.x * far, g.camWorld.y + dir.y * far, g.camWorld.z + dir.z * far, 1).applyMatrix4(vp);
      if (_p4.w <= 1e-6) return null;
      return { x: (_p4.x / _p4.w * 0.5 + 0.5) * W, y: (0.5 - _p4.y / _p4.w * 0.5) * H };
    };
    const nose = proj(_v4.copy(Z).applyQuaternion(p.q));
    if (nose) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(nose.x - 22, nose.y); ctx.lineTo(nose.x - 8, nose.y); ctx.lineTo(nose.x - 4, nose.y + 5); ctx.moveTo(nose.x + 22, nose.y); ctx.lineTo(nose.x + 8, nose.y); ctx.lineTo(nose.x + 4, nose.y + 5); ctx.stroke();
      ctx.beginPath(); ctx.arc(nose.x, nose.y, 1.8, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    }
    if (h8 && vH8 > 0.5) {
      const pv = proj(_v4.copy(p.vel).sub(h8.flight.vel).normalize());
      if (pv) {
        ctx.strokeStyle = warn; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(pv.x, pv.y, 7, 0, Math.PI * 2);
        ctx.moveTo(pv.x - 7, pv.y); ctx.lineTo(pv.x - 15, pv.y); ctx.moveTo(pv.x + 7, pv.y); ctx.lineTo(pv.x + 15, pv.y); ctx.moveTo(pv.x, pv.y - 7); ctx.lineTo(pv.x, pv.y - 13); ctx.stroke();
      }
    }
    if (h8) {
      const toH8 = _v4.copy(h8.flight.pos).sub(p.pos).normalize();
      const ph = proj(toH8);
      const on = ph && ph.x > 30 && ph.x < W - 30 && ph.y > 30 && ph.y < H - 30;
      ctx.fillStyle = 'rgba(255,200,110,0.95)'; ctx.strokeStyle = 'rgba(255,200,110,0.95)'; ctx.lineWidth = 1.5;
      ctx.font = `600 11.5px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      if (on) {
        ctx.beginPath(); ctx.moveTo(ph.x, ph.y - 8); ctx.lineTo(ph.x + 8, ph.y); ctx.lineTo(ph.x, ph.y + 8); ctx.lineTo(ph.x - 8, ph.y); ctx.closePath(); ctx.stroke();
        ctx.fillText(`H8  ${fmt(dH8)}`, ph.x + 12, ph.y);
      } else {
        // off the view: an arrow at the edge
        const back = _v3.copy(toH8).applyQuaternion(_q.copy(g.camQuat).invert());
        const a = Math.atan2(-back.y, back.x);
        const k = Math.min((W / 2 - 50) / Math.max(1e-6, Math.abs(Math.cos(a))), (H / 2 - 50) / Math.max(1e-6, Math.abs(Math.sin(a))));
        const x = W / 2 + Math.cos(a) * k, y = H / 2 + Math.sin(a) * k;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12); ctx.lineTo(x + Math.cos(a + 2.5) * 10, y + Math.sin(a + 2.5) * 10); ctx.lineTo(x + Math.cos(a - 2.5) * 10, y + Math.sin(a - 2.5) * 10); ctx.closePath(); ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillText('H8', x - Math.cos(a) * 24, y - Math.sin(a) * 18);
      }
    }
    // warnings
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 13px ${FONT}`;
    let wy = H * 0.24;
    const warnLine = (s, c) => { ctx.fillStyle = c; ctx.fillText(s, W / 2, wy); wy += 20; };
    if (link < 0.25 && (t % 0.8) < 0.5) warnLine('リンク弱 — H8から離れすぎ', red);
    if (p.battery <= 0) warnLine('電池切れ — 推力なし', red);
    else if (p.battery < 0.15 && (t % 1) < 0.6) warnLine('電池残量わずか', warn);
    if (p.evadeT > 6) warnLine('被弾', red);
    // (its camera too hot: an engine's flame)
    const hk = g.plumeHeat ? g.plumeHeat.cam : 0;
    if (hk > 1.05) warnLine('信号喪失 — カメラ過熱', red);
    else if (hk > 0.25) warnLine(`カメラ高温 ${Math.round(Math.min(1, hk) * 100)}%`, warn);
    // the buttons: let it go; its gun
    const btns = this.btns = [];
    const bw = 150, bh = 46, gap = 14;
    const n = p.armed ? 2 : 1;
    let x0 = W / 2 - (n * bw + (n - 1) * gap) / 2;
    const yb = H - bh - 34;
    const button = (k, label, c) => {
      ctx.fillStyle = 'rgba(4,16,10,0.6)'; ctx.strokeStyle = c; ctx.lineWidth = 1.5;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x0, yb, bw, bh, 9); else ctx.rect(x0, yb, bw, bh); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c; ctx.font = `700 14px ${FONT}`; ctx.fillText(label, x0 + bw / 2, yb + bh / 2);
      btns.push({ k, x0, y0: yb, x1: x0 + bw, y1: yb + bh });
      x0 += bw + gap;
    };
    button('release', '制御を返す', col);
    if (p.armed) button('fire', p.ammo > 0 ? '射撃' : '弾切れ', p.ammo > 0 ? red : dim);
    ctx.font = `500 11px ${FONT}`; ctx.fillStyle = dim;
    ctx.fillText('スティック：姿勢　スロットル：推力　ドラッグ：見回す', W / 2, yb - 14);
  }
}
