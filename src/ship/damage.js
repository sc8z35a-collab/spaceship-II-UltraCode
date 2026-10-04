// Damage model: hull dents (exterior and interior walls deform), hull breaches with torn metal
// and air leaks, cracked windows, pipe leaks, equipment faults. Damage worsens over time and
// spreads (metal fatigue); only the very smallest damage can be fixed on board — everything else
// stays and gets worse until the repair dock. A structural integrity figure sums it all up: when
// it runs out (or one impact is simply too big) the hull breaks apart.
import * as THREE from 'three';
import { shipUniforms, MAX_DENTS, MAX_BREACH } from './materials.js';
import { glassUniforms } from './glass.js';
import { OPENINGS, HULL, sectionPoint, sectionNormal, tForPoint, inCanopy, DECK_Y } from './hullShape.js';
import { PIPE_SYSTEMS } from './underfloor.js';
import { setLayersDeep, LAYER_NEAR, LAYER_MID } from '../core/layers.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// what Kaito can still fix himself (anything bigger is beyond a repair kit)
export const FIXABLE = { breach: 0.012, crack: 0.3, pipe: 0.15, equip: 0.12 };
const BREAKUP_ENERGY = 6e7;   // J: a single impact that tears the ship apart outright

export const EQUIPMENT = {
  servers: { name: 'サーバー', pos: V(-1.5, 1.0, 6.5), zone: 'eng' },
  comms: { name: '5G通信アンテナ', pos: V(0, 2.7, -2.8), zone: null, ext: true },
  sensors: { name: 'レーダー', pos: V(0, -2.3, -8.0), zone: null, ext: true },
  o2gen: { name: '酸素生成器', pos: V(2.3, 0.9, 3.0), zone: 'ls' },
  scrubber: { name: 'CO2除去装置', pos: V(2.1, 0.8, 1.5), zone: 'ls' },
  fans: { name: '換気ファン', pos: V(1.2, 2.2, 3.0), zone: 'ls' },
  power: { name: '配電盤', pos: V(1.7, 1.0, 6.9), zone: 'eng' },
  reactor: { name: '原子炉', pos: V(0, 0.4, 13.0), zone: null, ext: true },
  engine: { name: 'メインエンジン', pos: V(0, 0.4, 16.5), zone: null, ext: true },
  rcs: { name: '姿勢制御スラスター', pos: V(0, 2.0, -7.6), zone: null, ext: true },
  lift: { name: '昇降機', pos: V(1.5, -0.6, -3.75), zone: 'corridor' },
  coffee: { name: 'コーヒーメーカー', pos: V(-1.55, 1.1, -3.36), zone: 'living' },
  lights: { name: '照明回路', pos: V(0, 2.4, -2), zone: 'corridor' },
};

function rimGeometry(radius, seed) {
  // torn petals bent inward
  const petals = 9 + Math.floor((seed % 7));
  const pos = [];
  for (let i = 0; i < petals; i++) {
    const a0 = (i / petals) * Math.PI * 2, a1 = ((i + 1) / petals) * Math.PI * 2;
    const am = (a0 + a1) / 2 + (Math.sin(seed + i * 3.1) * 0.2);
    const l = radius * (0.35 + 0.35 * Math.abs(Math.sin(seed * 1.7 + i * 2.3)));
    const r0 = radius * (0.92 + 0.15 * Math.sin(i * 1.3 + seed));
    const p0 = [Math.cos(a0) * r0, Math.sin(a0) * r0, 0];
    const p1 = [Math.cos(a1) * r0, Math.sin(a1) * r0, 0];
    const tip = [Math.cos(am) * (r0 - l * 0.6), Math.sin(am) * (r0 - l * 0.6), -l * 0.9];
    pos.push(...p0, ...p1, ...tip);
    pos.push(...p1, ...p0, ...tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export class Damage {
  constructor(game) {
    this.g = game;
    this.dents = [];      // {pos, dir, r, depth}
    this.breaches = [];   // {id, pos, n, r, zone, area, leak, patched, sev, meshes}
    this.cracks = OPENINGS.map(() => null); // per opening index: {u,v,sev,seed,patched}
    this.canopyCrack = null;
    this.issues = [];     // active problems for UI + repairs
    this.health = { servers: 1, comms: 1, sensors: 1, o2gen: 1, scrubber: 1, fans: 1, power: 1, reactor: 1, engine: 1, rcs: 1, lift: 1, coffee: 1, lights: 1, cameras: [1, 1, 1, 1, 1] };
    this.scorch = [];
    this.nextId = 1;
    this.stress = 0;
    this.group = new THREE.Group();
    game.shipVis.root.add(this.group);
    this.events = [];
  }

  // ------------------------------------------------------------------ impacts
  /**
   * pLocal: impact point on the hull (ship-local), dirLocal: direction of travel of the projectile,
   * energy: kinetic energy (J)
   */
  impact(pLocal, dirLocal, energy, opts = {}) {
    const g = this.g;
    const E = Math.max(1, energy);
    const big = E > 5e5;
    // dent: radius & depth from energy
    const r = Math.min(1.6, 0.08 + 0.025 * Math.cbrt(E / 1000));
    const depth = Math.min(0.34, 0.015 + 0.007 * Math.cbrt(E / 1000));
    const inward = dirLocal.clone().normalize();
    this.addDent(pLocal, inward, r, depth);
    this.addScorch(pLocal, r * 0.8);
    // breach?
    const pen = E / (3e5 * (1 + this.dentCount(pLocal, 0.6) * -0.15));
    const zone = this.zoneForHullPoint(pLocal);
    let breach = null;
    if (pen > 1 && zone) {
      const holeR = Math.min(0.5, 0.008 * Math.pow(pen, 0.6) + 0.004);
      breach = this.addBreach(pLocal, inward.clone().negate(), holeR, zone);
    }
    // windows nearby crack
    OPENINGS.forEach((o, i) => {
      if (o.kind !== 'win') return;
      const d = o.center.distanceTo(pLocal);
      if (d < r * 3 + 0.8) {
        const sev = Math.min(2, (E / 2e5) / (1 + d * 2));
        if (sev > 0.05) this.crackWindow(i, pLocal, sev);
      }
    });
    if (inCanopy(pLocal) || pLocal.z < -11.5 && pLocal.y > 0.6) {
      this.crackWindow(15, pLocal, Math.min(2, E / 2.5e5));
    }
    // equipment & pipes near the impact
    for (const [k, eq] of Object.entries(EQUIPMENT)) {
      const d = eq.pos.distanceTo(pLocal);
      const reach = r * 2 + (big ? 3.0 : 1.2);
      if (d < reach) {
        const dmg = Math.min(0.9, (E / 4e5) * (1 - d / reach) * (0.5 + Math.random()));
        if (dmg > 0.03) this.damageEquipment(k, dmg, pLocal);
      }
    }
    for (const s of g.layout.pipes) {
      const d = s.mid.distanceTo(pLocal);
      const reach = r + (big ? 2.4 : 1.0);
      if (d < reach && Math.random() < 0.6) {
        const sev = Math.min(1, (E / 3e5) * (1 - d / reach) * (0.4 + Math.random()));
        if (sev > 0.04) this.pipeLeak(s, sev);
      }
    }
    // loose items fly, ship kicks, shake
    const kick = inward.clone().multiplyScalar(Math.min(4, Math.sqrt(E) / 900));
    g.phys.kick(kick, Math.min(6, Math.sqrt(E) / 400), pLocal, Math.min(0.9, E / 2e6));
    g.player.vel.addScaledVector(kick, -0.9);
    g.shake = Math.min(3, g.shake + 0.4 + Math.log10(E) * 0.25);
    if (g.flight) {
      const dvShip = inward.clone().applyQuaternion(g.flight.quat).multiplyScalar(Math.sqrt(E * 2 * 1) / Math.sqrt(42000 * 42000) * 2);
      g.flight.vel.add(dvShip);
      g.flight.wRel.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(Math.min(0.1, Math.sqrt(E) / 30000)));
    }
    // fx & sound
    const fx = g.fx;
    if (fx) {
      fx.burst('spark', pLocal, inward.clone().negate(), 30 + Math.min(200, E / 5000), { speed: 4 });
      fx.burst('debris', pLocal, inward.clone().negate(), 10 + Math.min(80, E / 20000), { speed: 2.5, spread: 1.2 });
      if (breach) fx.burst('ice', pLocal, inward.clone().negate(), 40, { speed: 6 });
    }
    g.audio.impact(pLocal, Math.min(1, Math.log10(E) / 7));
    g.systems.flicker = Math.min(0.5, 0.15 + E / 2e6);
    setTimeout(() => { g.systems.flicker = 0; }, 900 + Math.min(4000, E / 500));
    g.engine.grade.set('uFlash', Math.min(0.6, E / 3e6));
    this.events.push({ type: 'impact', E, breach: !!breach, zone, pos: pLocal.clone() });
    this.stress += E / 1e6;
    this.fatigue = (this.fatigue || 0) + E / 4e8;
    // far too much energy for the frame: the ship comes apart right away
    if (E > BREAKUP_ENERGY && !this.broken && g.gameplay && !opts.noBreakup) { this.broken = true; setTimeout(() => g.gameplay.breakup('impact'), 60); }
    return { breach, zone };
  }

  dentCount(p, rad) { return this.dents.filter((d) => d.pos.distanceTo(p) < rad).length; }

  zoneForHullPoint(p) {
    // project slightly inward and classify
    const n = new THREE.Vector3(p.x, p.y - 0.4, 0);
    if (n.lengthSq() < 1e-6) n.set(0, 1, 0);
    const inner = p.clone().addScaledVector(n.normalize(), -0.45);
    const ls = this.g.lifeSupport;
    if (p.z > 9.6 || p.z < HULL.zTip) return null;
    return ls.zoneAt(inner);
  }

  addDent(pos, dir, r, depth) {
    // merge with an existing dent nearby
    const ex = this.dents.find((d) => d.pos.distanceTo(pos) < Math.max(d.r, r) * 0.6);
    if (ex) { ex.depth = Math.min(0.45, ex.depth + depth * 0.6); ex.r = Math.max(ex.r, r); }
    else {
      if (this.dents.length >= MAX_DENTS) this.dents.shift();
      this.dents.push({ pos: pos.clone(), dir: dir.clone().normalize(), r, depth });
    }
    this.syncUniforms();
  }

  addScorch(pos, r) {
    if (this.scorch.length >= 8) this.scorch.shift();
    this.scorch.push({ pos: pos.clone(), r });
    this.syncUniforms();
  }

  addBreach(pos, n, radius, zone) {
    if (this.breaches.length >= MAX_BREACH) {
      // grow the closest existing breach instead
      const c = this.breaches.reduce((a, b) => (a.pos.distanceTo(pos) < b.pos.distanceTo(pos) ? a : b));
      c.r = Math.min(0.6, c.r + radius * 0.5);
      this._updateBreachLeak(c);
      return c;
    }
    const b = { id: this.nextId++, pos: pos.clone(), n: n.clone().normalize(), r: radius, zone, patched: false, sev: Math.min(1, radius / 0.08), seed: Math.random() * 100, meshes: [] };
    b.leak = this.g.lifeSupport.addLeak(zone, Math.PI * radius * radius, 'breach' + b.id);
    this._breachMeshes(b);
    this.breaches.push(b);
    this.addIssue({ kind: 'breach', ref: b, zone, pos: b.pos.clone().addScaledVector(b.n, -0.3), sev: b.sev, repairable: radius < FIXABLE.breach, name: '船体の穴' });
    this.syncUniforms();
    // continuous venting effect
    if (this.g.fx) b.vent = this.g.fx.emitter('mist', b.pos.clone().addScaledVector(b.n, -0.25), b.n.clone(), 40, { speed: 3, spread: 0.4 });
    return b;
  }

  _updateBreachLeak(b) {
    if (b.leak) b.leak.area = b.patched ? Math.PI * b.r * b.r * 0.02 : Math.PI * b.r * b.r;
    this.syncUniforms();
  }

  _breachMeshes(b) {
    const M = this.g.shipVis.M;
    for (const m of b.meshes) this.group.remove(m);
    b.meshes = [];
    for (const [inset, flip] of [[0, false], [HULL.inset, true]]) {
      const t = tForPoint(b.pos.z, b.pos.x, b.pos.y, 0);
      const p = sectionPoint(b.pos.z, t, inset);
      const nrm = sectionNormal(b.pos.z, t, inset);
      const g = rimGeometry(b.r * (flip ? 1.1 : 1.0), b.seed + (flip ? 3 : 0));
      const mesh = new THREE.Mesh(g, flip ? M.wall : M.hullDark);
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), nrm);
      mesh.position.copy(p);
      mesh.quaternion.copy(q);
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      setLayersDeep(mesh, LAYER_NEAR, LAYER_MID);
      this.group.add(mesh);
      b.meshes.push(mesh);
    }
    if (b.patched) {
      const t = tForPoint(b.pos.z, b.pos.x, b.pos.y, 0);
      const pIn = sectionPoint(b.pos.z, t, HULL.inset - 0.012);
      const nIn = sectionNormal(b.pos.z, t, HULL.inset);
      const patch = new THREE.Mesh(new THREE.CylinderGeometry(b.r * 1.6 + 0.04, b.r * 1.6 + 0.04, 0.01, 18), M.steel);
      patch.quaternion.setFromUnitVectors(V(0, 1, 0), nIn);
      patch.position.copy(pIn);
      patch.updateMatrix(); patch.matrixAutoUpdate = false;
      setLayersDeep(patch, LAYER_NEAR);
      this.group.add(patch);
      b.meshes.push(patch);
    }
  }

  crackWindow(i, p, sev) {
    const o = OPENINGS[i];
    let u = 0, v = 0;
    if (o) { const d = p.clone().sub(o.center); u = Math.max(-o.halfW, Math.min(o.halfW, d.dot(o.u))); v = Math.max(-o.halfH, Math.min(o.halfH, d.dot(o.v))); }
    const c = this.cracks[i] || { u, v, sev: 0, seed: Math.random() * 10, patched: false, glass: true };
    c.sev = Math.min(2.2, c.sev + sev);
    this.cracks[i] = c;
    if (!c.issue) c.issue = this.addIssue({ kind: 'crack', ref: { i }, zone: o ? o.room : 'cockpit', pos: o ? o.center.clone().addScaledVector(o.normal, -0.35) : V(0, 1.6, -12), sev: c.sev / 2, repairable: c.sev < FIXABLE.crack, name: '窓のひび' });
    else { c.issue.sev = c.sev / 2; c.issue.repairable = c.sev < FIXABLE.crack && !c.patched; }
    if (c.sev >= 2.0 && !c.broken) this._breakWindow(i);
    this.syncUniforms();
  }

  _breakWindow(i) {
    const c = this.cracks[i];
    c.broken = true;
    const o = OPENINGS[i];
    const zone = o ? (o.room === 'corridor' ? 'corridor' : o.room) : 'cockpit';
    const area = o ? Math.PI * o.halfW * o.halfH : 0.8;
    c.leak = this.g.lifeSupport.addLeak(zone, area, 'window' + i);
    glassUniforms.uWinGone.value[i] = 1;
    if (this.g.fx) {
      const p = o ? o.center : V(0, 1.6, -12.5);
      this.g.fx.burst('ice', p, o ? o.normal : V(0, 0.3, -1), 200, { speed: 9, spread: 0.8 });
      this.g.fx.burst('debris', p, o ? o.normal : V(0, 0.3, -1), 120, { speed: 5, spread: 1 });
    }
    this.events.push({ type: 'window', zone });
    this.addIssue({ kind: 'window', ref: { i }, zone, pos: o ? o.center.clone() : V(0, 1.6, -12), sev: 1, repairable: false, name: '窓の破損' });
  }

  damageEquipment(k, dmg, p) {
    if (k === 'cameras') return;
    const prev = this.health[k];
    this.health[k] = Math.max(0, prev - dmg);
    const eq = EQUIPMENT[k];
    const ex = this.issues.find((i) => i.kind === 'equip' && i.ref.k === k && i.state === 'active');
    const sev = 1 - this.health[k];
    if (ex) { ex.sev = sev; ex.repairable = sev < FIXABLE.equip && !eq.ext; }
    else this.addIssue({ kind: 'equip', ref: { k }, zone: eq.zone, pos: eq.pos.clone(), sev, repairable: sev < FIXABLE.equip && !eq.ext, name: eq.name + 'の故障', ext: eq.ext });
    if (this.g.fx && !eq.ext) this.g.fx.burst('spark', eq.pos, V(0, 1, 0), 25, { speed: 2 });
    this.events.push({ type: 'equip', k, sev });
    // cameras near impact
    const cams = [V(0, 7, 20), V(0, -0.8, -13.4), V(0, -2.4, -3), V(7.5, 0.5, 13), V(0, 3.2, 2.6)];
    cams.forEach((c, i) => { if (c.distanceTo(p) < 3) this.health.cameras[i] = Math.max(0, this.health.cameras[i] - dmg * 2); });
  }

  pipeLeak(seg, sev) {
    seg.leak = Math.min(1, seg.leak + sev);
    const S = PIPE_SYSTEMS[seg.sys];
    if (!seg.issue) {
      seg.where = seg.mid.clone();
      seg.issue = this.addIssue({ kind: 'pipe', ref: seg, zone: seg.mid.y < -0.1 ? 'under' : this.g.lifeSupport.zoneAt(seg.mid), pos: seg.mid.clone(), sev: seg.leak, repairable: seg.leak < FIXABLE.pipe, name: S.name + 'の配管漏れ' });
      const dir = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).normalize();
      seg.dir = dir;
      if (this.g.fx) seg.emitter = this.g.fx.emitter(S.leak, seg.mid.clone().addScaledVector(dir, seg.r), dir, 10, { speed: S.leak === 'water' ? 0.4 : 2.5, spread: 0.35 });
      // air & gas lines leak into the zone
      seg.audio = 'leak' + seg.id;
    } else {
      seg.issue.sev = seg.leak;
      seg.issue.repairable = seg.leak < FIXABLE.pipe && !seg.patched;
    }
    this.events.push({ type: 'pipe', sys: seg.sys, pos: seg.mid.clone() });
  }

  addIssue(o) {
    const it = Object.assign({ id: this.nextId++, state: 'active', created: this.g.time, patched: false }, o);
    this.issues.push(it);
    return it;
  }

  // ------------------------------------------------------------------ repairs
  /** returns 'fixed' | 'patched' | 'cannot' */
  repair(issue) {
    const g = this.g;
    if (issue.state !== 'active') return 'none';
    if (issue.kind === 'breach') {
      const b = issue.ref;
      if (b.r < FIXABLE.breach && !b.patched) {
        b.patched = true;
        this._updateBreachLeak(b);
        this._breachMeshes(b);
        if (b.vent) { g.fx.removeEmitter(b.vent); b.vent = null; }
        issue.state = 'patched';
        return 'patched';
      }
      return 'cannot';
    }
    if (issue.kind === 'crack') {
      const c = this.cracks[issue.ref.i];
      if (c && !c.broken && c.sev < FIXABLE.crack) { c.patched = true; issue.state = 'patched'; return 'patched'; }
      return 'cannot';
    }
    if (issue.kind === 'pipe') {
      const s = issue.ref;
      if (s.leak < FIXABLE.pipe) {
        s.patched = true;
        s.leak = s.leak < 0.15 ? 0 : s.leak * 0.15;
        if (s.emitter) { g.fx.removeEmitter(s.emitter); s.emitter = null; }
        if (s.leak > 0) s.emitter = g.fx.emitter('mist', s.mid.clone().addScaledVector(s.dir, s.r), s.dir, 1.5, { speed: 0.6 });
        issue.state = s.leak === 0 ? 'fixed' : 'patched';
        // clamp visual
        const clamp = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 1.45, s.r * 1.45, 0.12, 14), g.shipVis.M.steel);
        clamp.position.copy(s.mid);
        clamp.quaternion.setFromUnitVectors(V(0, 1, 0), s.b.clone().sub(s.a).normalize());
        clamp.updateMatrix(); clamp.matrixAutoUpdate = false;
        setLayersDeep(clamp, LAYER_NEAR);
        this.group.add(clamp);
        return issue.state;
      }
      return 'cannot';
    }
    if (issue.kind === 'equip') {
      const k = issue.ref.k;
      if (EQUIPMENT[k].ext) return 'cannot';
      if (1 - this.health[k] < FIXABLE.equip) {
        this.health[k] = Math.min(1, this.health[k] + 0.12);
        issue.state = this.health[k] > 0.97 ? 'fixed' : 'patched';
        issue.sev = 1 - this.health[k];
        return issue.state;
      }
      return 'cannot';
    }
    return 'cannot';
  }

  /** full repair at the dock */
  repairAll() {
    for (const b of this.breaches) { this.g.lifeSupport.removeLeak(b.leak); for (const m of b.meshes) this.group.remove(m); if (b.vent) this.g.fx.removeEmitter(b.vent); }
    this.breaches = [];
    this.cracks.forEach((c, i) => { if (c && c.leak) this.g.lifeSupport.removeLeak(c.leak); glassUniforms.uWinGone.value[i] = 0; });
    this.cracks = OPENINGS.map(() => null);
    this.dents = []; this.scorch = [];
    for (const s of this.g.layout.pipes) { s.leak = 0; s.patched = false; s.issue = null; if (s.emitter) { this.g.fx.removeEmitter(s.emitter); s.emitter = null; } }
    for (const k of Object.keys(this.health)) this.health[k] = k === 'cameras' ? [1, 1, 1, 1, 1] : 1;
    this.issues = [];
    this.fatigue = 0;
    this.broken = false;
    this.group.clear();
    this.syncUniforms();
  }

  // ------------------------------------------------------------------ structure
  /**
   * Structural integrity 0..1 of the pressure hull: dents, holes, missing windows and accumulated
   * metal fatigue all eat into it. Below ~0.35 the hull is in danger; at 0 it comes apart.
   */
  integrity() {
    let x = this.fatigue || 0;
    for (const d of this.dents) x += d.depth * d.r * 2.2;
    for (const b of this.breaches) x += b.r * (b.patched ? 0.8 : 2.4);
    for (const c of this.cracks) if (c && c.broken) x += 0.12;
    return Math.max(0, 1 - x);
  }

  /** stress events (ULTRA shudders, hard landings...): fatigue plus a chance of fresh damage */
  stressEvent(amount, where = null) {
    this.fatigue = (this.fatigue || 0) + amount * 0.02;
    if (Math.random() < Math.min(0.9, amount)) this.spawnFatigueDamage(where, Math.min(1, 0.3 + amount));
  }

  /** new damage grown out of fatigue somewhere in the ship (cracks, leaks, failures, buckling) */
  spawnFatigueDamage(near = null, k = 0.5) {
    const g = this.g;
    const roll = Math.random();
    if (roll < 0.34 && g.layout.pipes.length) {
      const list = near ? g.layout.pipes.filter((s) => s.mid.distanceTo(near) < 3) : g.layout.pipes;
      const s = (list.length ? list : g.layout.pipes)[Math.floor(Math.random() * (list.length || g.layout.pipes.length))];
      this.pipeLeak(s, 0.05 + 0.25 * k * Math.random());
      return 'pipe';
    }
    if (roll < 0.58) {
      const keys = Object.keys(EQUIPMENT).filter((q) => !EQUIPMENT[q].ext || Math.random() < 0.4);
      const q = keys[Math.floor(Math.random() * keys.length)];
      this.damageEquipment(q, 0.04 + 0.2 * k * Math.random(), EQUIPMENT[q].pos);
      return 'equip';
    }
    if (roll < 0.76) {
      const wins = OPENINGS.map((o, i) => [o, i]).filter(([o]) => o.kind === 'win');
      const [o, i] = wins[Math.floor(Math.random() * wins.length)];
      this.crackWindow(i, o.center.clone().addScaledVector(o.u, (Math.random() - 0.5) * o.halfW), 0.15 + 0.5 * k * Math.random());
      return 'crack';
    }
    // buckled plating: an inward dent in the hull, sometimes split open
    const z = near ? Math.max(-11, Math.min(9, near.z + (Math.random() - 0.5) * 2)) : -11 + Math.random() * 20;
    const t = Math.random() * Math.PI * 2;
    const p = sectionPoint(z, t, 0), n = sectionNormal(z, t, 0);
    this.addDent(p, n.clone().negate(), 0.25 + 0.4 * k, 0.02 + 0.05 * k);
    if (Math.random() < 0.25 * k) {
      const zone = this.zoneForHullPoint(p);
      if (zone) this.addBreach(p, n, 0.004 + 0.02 * k * Math.random(), zone);
    }
    this.events.push({ type: 'buckle', pos: p.clone() });
    return 'buckle';
  }

  // ------------------------------------------------------------------ time evolution
  update(dt) {
    const g = this.g;
    const f = g.flight;
    if (this.broken) return;
    // stress multiplier: ULTRA vibration, heating, high g
    const stressMul = 1 + (f.ultra ? 2.0 + 2.0 * Math.min(1, Math.max(0, f.setSpeed) / 900) : 0) + Math.min(4, f.heatFlux / 5e4) + Math.min(3, f.properAcc.length() / 10);
    for (const it of this.issues) {
      if (it.state === 'fixed') continue;
      const patchK = it.state === 'patched' ? 0.15 : 1;
      let grow = 0;
      if (it.kind === 'breach') grow = 0.00003;
      else if (it.kind === 'crack') grow = 0.00008;
      else if (it.kind === 'pipe') grow = 0.00006;
      else if (it.kind === 'equip') grow = 0.00003;
      else if (it.kind === 'window') grow = 0;
      // larger damage worsens faster (fatigue): the growth accelerates with severity
      const d = grow * stressMul * patchK * (0.4 + it.sev * 1.6) * dt;
      if (d <= 0) continue;
      it.sev = Math.min(1, it.sev + d);
      if (it.kind === 'breach') {
        const b = it.ref;
        b.r = Math.min(0.6, b.r * (1 + d * 0.9));
        this._updateBreachLeak(b);
        it.repairable = b.r < FIXABLE.breach && !b.patched;
        if (Math.random() < dt * 0.02) this._breachMeshes(b);
      } else if (it.kind === 'crack') {
        const c = this.cracks[it.ref.i];
        if (c && !c.broken) { c.sev = Math.min(2.2, c.sev + d * 2); it.repairable = c.sev < FIXABLE.crack && !c.patched; if (c.sev >= 2.0) this._breakWindow(it.ref.i); this.syncUniforms(); }
      } else if (it.kind === 'pipe') {
        const s = it.ref;
        s.leak = Math.min(1, s.leak + d);
        it.repairable = s.leak < FIXABLE.pipe && !s.patched;
      } else if (it.kind === 'equip') {
        const k = it.ref.k;
        this.health[k] = Math.max(0, this.health[k] - d);
        it.repairable = 1 - this.health[k] < FIXABLE.equip && !EQUIPMENT[k].ext;
      }
      if (!it.worseNotified && it.sev > 0.6 && it.state !== 'fixed') { it.worseNotified = true; this.events.push({ type: 'worse', issue: it }); }
    }
    // metal fatigue: open holes and a weakened frame keep working the structure; it spreads as new
    // cracks, leaks and buckled plates, and accelerates once the hull is badly weakened
    let open = 0;
    for (const b of this.breaches) if (!b.patched) open += b.r;
    const integ = this.integrity();
    const weak = Math.max(0, 0.45 - integ);
    const fRate = (open * 0.12 + weak * 0.05 + (f.ultra ? 0.004 : 0)) * stressMul / 3600;
    this.fatigue = (this.fatigue || 0) + fRate * dt;
    this.spreadT = (this.spreadT ?? 600) - dt * (open * 6 + weak * 4 + (integ < 0.9 ? 0.15 : 0)) * stressMul;
    if (this.spreadT <= 0) {
      this.spreadT = 600 + Math.random() * 900;
      const src = this.breaches.length ? this.breaches[Math.floor(Math.random() * this.breaches.length)].pos : null;
      this.spawnFatigueDamage(src, Math.min(1, 0.3 + weak * 1.5));
    }
    this.integrityNow = integ;
    if (integ <= 0 && !this.broken && !this.catchingUp && g.gameplay) { this.broken = true; g.gameplay.breakup('structure'); return; }
    // effects of pipe leaks on systems
    let coolantLoss = 0, waterLoss = 0, airLoss = 0, o2Loss = 0, n2Loss = 0, rcsLoss = 0;
    for (const s of g.layout.pipes) {
      if (s.leak <= 0) continue;
      const v = g.systems.valveOpen ? g.systems.valveOpen(s) : true;
      const lk = v ? s.leak : s.leak * 0.05;
      if (s.sys === 'coolant') coolantLoss += lk;
      else if (s.sys === 'water' || s.sys === 'waste') waterLoss += lk;
      else if (s.sys === 'air') airLoss += lk;
      else if (s.sys === 'o2') o2Loss += lk;
      else if (s.sys === 'n2') n2Loss += lk;
      else if (s.sys === 'rcs') rcsLoss += lk;
      if (s.emitter) s.emitter.rate = lk * 60 + 2;
    }
    this.coolant = Math.max(0, (this.coolant ?? 1) - coolantLoss * dt * 0.00012);
    const ls = g.lifeSupport;
    ls.water = Math.max(0, ls.water - waterLoss * dt * 0.02);
    ls.reserve.o2 = Math.max(0, ls.reserve.o2 - o2Loss * dt * 1.5);
    ls.z.under.o2 += o2Loss * dt * 1.5 / ls.z.under.vol;
    ls.reserve.n2 = Math.max(0, ls.reserve.n2 - n2Loss * dt * 1.5);
    ls.z.under.n2 += n2Loss * dt * 1.5 / ls.z.under.vol;
    ls.fans.health = this.health.fans * (1 - Math.min(0.8, airLoss));
    ls.o2gen.health = this.health.o2gen;
    ls.scrubber.health = this.health.scrubber;
    f.engineHealth = this.health.engine * (this.health.reactor > 0.3 ? 1 : 0.4);
    f.rcsHealth = this.health.rcs * (1 - Math.min(0.85, rcsLoss));
    // reactor temperature vs coolant
    const coolEff = this.coolant * (this.health.reactor * 0.5 + 0.5);
    this.reactorTemp = 560 + (1 - coolEff) * 420 + (f.ultra ? 40 : 0);
    g.systems.power = Math.min(this.health.power, this.reactorTemp > 820 ? 0.45 : 1) * (this.health.reactor > 0.15 ? 1 : 0.25);
    g.systems.serversHealth = this.health.servers;
    this.stress = Math.max(0, this.stress - dt * 0.001);
  }

  syncUniforms() {
    const D = shipUniforms.uDents.value, DD = shipUniforms.uDentDir.value;
    for (let i = 0; i < MAX_DENTS; i++) {
      const d = this.dents[i];
      if (d) { D[i].set(d.pos.x, d.pos.y, d.pos.z, d.r); DD[i].set(d.dir.x, d.dir.y, d.dir.z, d.depth); }
      else { D[i].set(0, 0, 0, 0); DD[i].set(0, 0, 0, 0); }
    }
    const B = shipUniforms.uBreach.value;
    for (let i = 0; i < MAX_BREACH; i++) {
      const b = this.breaches[i];
      if (b && !b.patched) B[i].set(b.pos.x, b.pos.y, b.pos.z, b.r);
      else if (b && b.patched) B[i].set(b.pos.x, b.pos.y, b.pos.z, b.r); // hole stays, patch covers it inside
      else B[i].set(0, 0, 0, 0);
    }
    const S = shipUniforms.uScorch.value;
    for (let i = 0; i < 8; i++) { const s = this.scorch[i]; if (s) S[i].set(s.pos.x, s.pos.y, s.pos.z, s.r); else S[i].set(0, 0, 0, 0); }
    const W = glassUniforms.uWinDmg.value;
    for (let i = 0; i < W.length; i++) {
      const c = this.cracks[i];
      if (c) W[i].set(c.u, c.v, c.sev, c.seed); else W[i].set(0, 0, 0, 0);
    }
  }

  serialize() {
    return {
      dents: this.dents.map((d) => ({ p: d.pos.toArray(), d: d.dir.toArray(), r: d.r, depth: d.depth })),
      breaches: this.breaches.map((b) => ({ p: b.pos.toArray(), n: b.n.toArray(), r: b.r, zone: b.zone, patched: b.patched, seed: b.seed })),
      cracks: this.cracks.map((c) => c ? { u: c.u, v: c.v, sev: c.sev, seed: c.seed, patched: c.patched, broken: !!c.broken } : null),
      scorch: this.scorch.map((s) => ({ p: s.pos.toArray(), r: s.r })),
      health: this.health, coolant: this.coolant ?? 1, fatigue: this.fatigue || 0,
      pipes: this.g.layout.pipes.filter((s) => s.leak > 0 || s.patched).map((s) => ({ id: s.id, leak: s.leak, patched: s.patched })),
      equipIssues: this.issues.filter((i) => i.kind === 'equip').map((i) => ({ k: i.ref.k, sev: i.sev, state: i.state })),
    };
  }

  restore(d) {
    this.dents = (d.dents || []).map((x) => ({ pos: V(...x.p), dir: V(...x.d), r: x.r, depth: x.depth }));
    this.scorch = (d.scorch || []).map((x) => ({ pos: V(...x.p), r: x.r }));
    Object.assign(this.health, d.health || {});
    this.coolant = d.coolant ?? 1;
    this.fatigue = d.fatigue || 0;
    for (const b of d.breaches || []) {
      const br = this.addBreach(V(...b.p), V(...b.n), b.r, b.zone);
      br.seed = b.seed;
      if (b.patched) { br.patched = true; this._updateBreachLeak(br); this._breachMeshes(br); if (br.vent) { this.g.fx.removeEmitter(br.vent); br.vent = null; } const is = this.issues.find((i) => i.ref === br); if (is) is.state = 'patched'; }
    }
    (d.cracks || []).forEach((c, i) => {
      if (!c) return;
      this.cracks[i] = { u: c.u, v: c.v, sev: c.sev, seed: c.seed, patched: c.patched };
      this.cracks[i].issue = this.addIssue({ kind: 'crack', ref: { i }, zone: OPENINGS[i] ? OPENINGS[i].room : 'cockpit', pos: OPENINGS[i] ? OPENINGS[i].center.clone() : V(0, 1.6, -12), sev: c.sev / 2, repairable: true, name: '窓のひび', state: c.patched ? 'patched' : 'active' });
      if (c.broken) this._breakWindow(i);
    });
    for (const p of d.pipes || []) {
      const s = this.g.layout.pipes.find((x) => x.id === p.id);
      if (!s) continue;
      if (p.leak > 0) this.pipeLeak(s, p.leak);
      s.patched = p.patched;
      if (s.issue && p.patched) s.issue.state = 'patched';
    }
    for (const e of d.equipIssues || []) {
      this.addIssue({ kind: 'equip', ref: { k: e.k }, zone: EQUIPMENT[e.k].zone, pos: EQUIPMENT[e.k].pos.clone(), sev: e.sev, repairable: e.sev < 0.35 && !EQUIPMENT[e.k].ext, name: EQUIPMENT[e.k].name + 'の故障', state: e.state, ext: EQUIPMENT[e.k].ext });
    }
    this.events.length = 0;
    this.syncUniforms();
  }
}
