// The people who work on a hub station, walking their rounds while B-29 is docked (ship-local, in
// the lobby's group). Each has a job and a post: the receptionists keep to the desk, the guides walk
// the lobby, the promenade and the atrium, the technicians go out to the bridge, the core and
// AKAMO's platform and stop at the panels; they look at Kaito as he passes, stand aside for him,
// talk to each other when they meet. When the station is in trouble (holed, failing) they run for
// the escape pod bays, and each bay's pod goes once its people are in.
import * as THREE from 'three';
import { buildPerson, randomLook } from './humanModel.js';
import { LAYER_NEAR } from '../core/layers.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const WALK = 1.25, RUN = 3.3;

/** nodes: [{ id, p: [x,y,z], kind: 'path'|'post'|'desk'|'panel'|'bay', face?, area }], links: [[a, b], ...] */
export class WalkGraph {
  constructor(nodes, links) {
    this.nodes = new Map();
    for (const n of nodes) this.nodes.set(n.id, { ...n, p: V(...n.p), adj: [] });
    for (const [a, b] of links) {
      const A = this.nodes.get(a), B = this.nodes.get(b);
      if (!A || !B) continue;
      const d = A.p.distanceTo(B.p);
      A.adj.push([b, d]); B.adj.push([a, d]);
    }
  }
  /** the shortest way from a to b (node ids), or null */
  path(a, b) {
    if (a === b) return [a];
    const dist = new Map([[a, 0]]), prev = new Map(), open = new Set([a]);
    while (open.size) {
      let u = null, du = Infinity;
      for (const k of open) { const d = dist.get(k); if (d < du) { du = d; u = k; } }
      open.delete(u);
      if (u === b) break;
      for (const [v, w] of this.nodes.get(u).adj) {
        const nd = du + w;
        if (nd < (dist.has(v) ? dist.get(v) : Infinity)) { dist.set(v, nd); prev.set(v, u); open.add(v); }
      }
    }
    if (!prev.has(b)) return null;
    const out = [b];
    while (out[0] !== a) out.unshift(prev.get(out[0]));
    return out;
  }
  nearest(p, test = null) {
    let best = null, bd = Infinity;
    for (const n of this.nodes.values()) {
      if (test && !test(n)) continue;
      const d = n.p.distanceToSquared(p);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  of(kind, area = null) { return [...this.nodes.values()].filter((n) => n.kind === kind && (!area || n.area === area)); }
}

// what each job does: the kinds of node it goes to (and how often), how long it stays
const JOBS = {
  reception: { goals: [['desk', 6], ['post', 1]], stay: [12, 40] },
  guide: { goals: [['post', 4], ['desk', 1], ['panel', 1]], stay: [5, 16] },
  tech: { goals: [['panel', 5], ['post', 1]], stay: [8, 24] },
  guard: { goals: [['post', 3], ['panel', 1]], stay: [3, 9] },
};

export class StationCrew {
  /**
   * layout: { nodes, links, jobs: [job, ...] (one person each), bays?: [{ node, pod }] }
   * parent: the group they stand in (the lobby's)
   */
  constructor(layout, parent, seed = 1) {
    this.graph = new WalkGraph(layout.nodes, layout.links);
    this.parent = parent;
    this.people = [];
    this.layout = layout;
    this.seed = seed;
    this.t = 0;
    this.panic = false;
    this.boarded = new Map();       // bay node id -> how many went in
    this._v = V(0, 0, 0); this._w = V(0, 0, 0);
  }

  spawn() {
    if (this.people.length) return;
    let k = 0;
    for (const job of this.layout.jobs) {
      const seed = this.seed * 1000 + (k++) * 53;
      const person = buildPerson(randomLook(seed, 'crew'));
      person.root.traverse((o) => { if (o.isMesh) o.layers.set(LAYER_NEAR); });
      this.parent.add(person.root);
      const goals = this.goalsFor(job);
      const start = goals.length ? goals[Math.floor(this.rand(seed) * goals.length)] : [...this.graph.nodes.values()][0];
      const P = { person, job, node: start.id, pos: start.p.clone(), face: start.face ?? 0, path: null, seg: 0, stay: this.rand(seed + 1) * 6, pose: { mode: 'stand' }, seed: seed * 0.17, blocked: 0, look: 0, gone: false };
      this.people.push(P);
      this.place(P, 0);
    }
  }
  clear() {
    for (const P of this.people) { P.person.root.removeFromParent(); P.person.dispose(); }
    this.people.length = 0;
  }
  rand(s) { const x = Math.sin(s * 12.9898 + this.t * 0.0001) * 43758.5453; return x - Math.floor(x); }
  goalsFor(job) {
    const J = JOBS[job] || JOBS.guide, out = [];
    for (const [kind, w] of J.goals) for (const n of this.graph.of(kind)) for (let i = 0; i < w; i++) out.push(n);
    return out;
  }

  /** the station is in trouble: everyone to the pod bays */
  alarm(on) {
    if (on === this.panic) return;
    this.panic = on;
    if (!on) return;
    for (const P of this.people) {
      if (P.gone) continue;
      const bay = this.graph.nearest(P.pos, (n) => n.kind === 'bay');
      if (!bay) continue;
      const from = this.graph.nearest(P.pos);
      const path = this.graph.path(from.id, bay.id);
      if (path) { P.path = path; P.seg = 0; P.stay = 0; P.bay = bay.id; }
    }
  }

  /** player: ship-local position of Kaito (or null); onBoard(bayId, n): someone went into a bay's pod */
  update(dt, player, onBoard) {
    this.t += dt;
    for (const P of this.people) {
      if (P.gone) continue;
      const p = P.pose;
      if (P.path) this.walk(P, dt, player, onBoard);
      else {
        P.stay -= dt;
        p.mode = 'stand'; p.lean = 0; p.brace = 0;
        if (P.stay <= 0 && !this.panic) this.next(P);
      }
      // a look at Kaito when he is near (and roughly in front)
      let lookYaw = Math.sin(this.t * 0.21 + P.seed * 7) * 0.35, lookPitch = 0;
      if (player) {
        const dx = player.x - P.pos.x, dz = player.z - P.pos.z, d = Math.hypot(dx, dz);
        if (d < 4.5) {
          const rel = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - P.face), Math.cos(Math.atan2(-dx, -dz) - P.face));
          if (Math.abs(rel) < 1.9) { lookYaw = Math.max(-1.1, Math.min(1.1, rel)); lookPitch = Math.max(-0.3, Math.min(0.3, (player.y + 0.6 - (P.pos.y + 1.6)) / Math.max(d, 0.5))); }
        }
      }
      P.look += (lookYaw - P.look) * Math.min(1, dt * 3);
      p.lookYaw = P.look; p.lookPitch = lookPitch;
      this.place(P, dt);
    }
  }

  next(P) {
    const goals = this.goalsFor(P.job).filter((n) => n.id !== P.node && !this.people.some((Q) => Q !== P && !Q.gone && (Q.node === n.id || (Q.path && Q.path[Q.path.length - 1] === n.id))));
    if (!goals.length) { P.stay = 4; return; }
    const goal = goals[Math.floor(Math.random() * goals.length)];
    const path = this.graph.path(P.node, goal.id);
    if (!path || path.length < 2) { P.stay = 4; return; }
    P.path = path; P.seg = 0;
  }

  walk(P, dt, player, onBoard) {
    const p = P.pose, g = this.graph;
    const to = g.nodes.get(P.path[Math.min(P.seg + 1, P.path.length - 1)]);
    const d = this._v.copy(to.p).sub(P.pos);
    const flat = Math.hypot(d.x, d.z);
    // stand aside for Kaito: wait when he is right in the way, then step round him
    let speed = this.panic ? RUN : WALK;
    if (player && !this.panic) {
      const ax = player.x - P.pos.x, az = player.z - P.pos.z, ad = Math.hypot(ax, az);
      if (ad < 1.1 && Math.abs(player.y - P.pos.y - 0.9) < 1.6 && flat > 0.01 && (ax * d.x + az * d.z) / (ad * flat) > 0.4) {
        P.blocked += dt;
        if (P.blocked < 1.2) speed = 0;
        else { const sx = -d.z / flat, sz = d.x / flat, s = (ax * sx + az * sz) > 0 ? -1 : 1; d.x += sx * s * 1.4; d.z += sz * s * 1.4; }
      } else P.blocked = Math.max(0, P.blocked - dt);
    }
    if (flat < 0.06) {
      P.seg++;
      P.node = to.id;
      if (P.seg >= P.path.length - 1) {
        P.path = null;
        if (P.bay && to.id === P.bay) { P.gone = true; P.person.root.visible = false; this.boarded.set(to.id, (this.boarded.get(to.id) || 0) + 1); if (onBoard) onBoard(to.id, this.boarded.get(to.id)); return; }
        const J = JOBS[P.job] || JOBS.guide;
        P.stay = J.stay[0] + Math.random() * (J.stay[1] - J.stay[0]);
        if (to.face !== undefined) P.turnTo = to.face;
        else {
          // two who meet talk a while, facing each other
          const mate = this.people.find((Q) => Q !== P && !Q.gone && !Q.path && Q.pos.distanceTo(P.pos) < 2.2);
          if (mate) { P.turnTo = Math.atan2(-(mate.pos.x - P.pos.x), -(mate.pos.z - P.pos.z)); mate.turnTo = Math.atan2(-(P.pos.x - mate.pos.x), -(P.pos.z - mate.pos.z)); mate.stay = Math.max(mate.stay, P.stay * 0.8); }
        }
      }
      return;
    }
    const step = Math.min(flat, speed * dt);
    if (step > 0) {
      P.pos.x += d.x / flat * step; P.pos.z += d.z / flat * step;
      // the floor's height along the way (stairs, ramps)
      const fr = g.nodes.get(P.path[P.seg]), L = Math.hypot(to.p.x - fr.p.x, to.p.z - fr.p.z);
      const k = L > 0.01 ? 1 - Math.hypot(to.p.x - P.pos.x, to.p.z - P.pos.z) / L : 1;
      P.pos.y = fr.p.y + (to.p.y - fr.p.y) * Math.max(0, Math.min(1, k));
      const want = Math.atan2(-d.x, -d.z);
      P.face += Math.atan2(Math.sin(want - P.face), Math.cos(want - P.face)) * Math.min(1, dt * 8);
    }
    p.mode = step > 0 ? 'walk' : 'stand';
    p.speed = speed > WALK ? 1.7 : 1;
    p.phase = (p.phase || 0) + step * 5.2;
    P.turnTo = undefined;
  }

  place(P, dt) {
    if (P.turnTo !== undefined && !P.path) P.face += Math.atan2(Math.sin(P.turnTo - P.face), Math.cos(P.turnTo - P.face)) * Math.min(1, dt * 4);
    P.person.root.position.copy(P.pos);
    P.person.root.rotation.set(0, P.face, 0);
    P.person.pose(P.pose, this.t);
  }
}
