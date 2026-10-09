// The people who work on a hub station, walking their rounds while B-29 is docked (ship-local, in
// the lobby's group). Each has a round of places (the reception desk, the bar, the globe, the
// café, the lift, the gates...) where they stay a while; they look at Kaito as he passes, wait and
// step round him when he is in the way, talk when two of them meet. When the station is in trouble
// (holed, failing) they run for the escape pod hatches, and each hatch's pod goes once its people
// are in.
import * as THREE from 'three';
import { buildPerson, randomLook } from './humanModel.js';
import { LAYER_NEAR } from '../core/layers.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const WALK = 1.25, RUN = 3.3, BODY = 0.26;

/** distance from point (px, pz) to the segment (ax, az)-(bx, bz) on the floor */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/**
 * nodes: [{ id, p: [x,y,z], kind: 'path'|'post'|'bay', face? }], links: [[a, b], ...],
 * obstacles: [{ c: [x, z], r } | { box: [x0, x1, z0, z1] }, with y: [y0, y1]] — a link that passes
 * through one (a body's width) is left out, with a warning
 */
export class WalkGraph {
  constructor(nodes, links, obstacles = []) {
    this.nodes = new Map();
    for (const n of nodes) this.nodes.set(n.id, { ...n, p: V(...n.p), adj: [] });
    for (const [a, b] of links) {
      const A = this.nodes.get(a), B = this.nodes.get(b);
      if (!A || !B) { console.warn('[crew] link to a missing node', a, b); continue; }
      const hit = obstacles.find((o) => {
        const y = Math.min(A.p.y, B.p.y);
        if (o.y && (y + 1.8 < o.y[0] || y > o.y[1])) return false;
        if (o.c) return segDist(o.c[0], o.c[1], A.p.x, A.p.z, B.p.x, B.p.z) < o.r + BODY;
        const [x0, x1, z0, z1] = o.box;
        // (the box grown by a body's width, against a few points along the way)
        for (let i = 0; i <= 16; i++) {
          const x = A.p.x + (B.p.x - A.p.x) * i / 16, z = A.p.z + (B.p.z - A.p.z) * i / 16;
          if (x > x0 - BODY && x < x1 + BODY && z > z0 - BODY && z < z1 + BODY) return true;
        }
        return false;
      });
      if (hit) { console.warn('[crew] link blocked', a, b); continue; }
      const d = A.p.distanceTo(B.p);
      A.adj.push([b, d]); B.adj.push([a, d]);
    }
  }
  /** the shortest way from a to b (node ids) and its length, or null */
  path(a, b) {
    if (a === b) return { ids: [a], len: 0 };
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
    const ids = [b];
    while (ids[0] !== a) ids.unshift(prev.get(ids[0]));
    return { ids, len: dist.get(b) };
  }
}

export class StationCrew {
  /**
   * layout: { nodes, links, obstacles, people: [{ goals: [node ids (repeat to weight)], stay: [s0, s1] }] }
   * parent: the group they stand in
   */
  constructor(layout, parent, seed = 1) {
    this.graph = new WalkGraph(layout.nodes, layout.links, layout.obstacles || []);
    this.layout = layout;
    this.parent = parent;
    this.people = [];
    this.seed = seed;
    this.t = 0;
    this.panic = false;
    this._v = V(0, 0, 0);
  }

  spawn() {
    if (this.people.length) return;
    this.layout.people.forEach((def, k) => {
      const seed = this.seed * 1000 + k * 53;
      const person = buildPerson(randomLook(seed, 'crew'));
      person.root.rotation.order = 'YXZ';
      person.root.traverse((o) => { if (o.isMesh) o.layers.set(LAYER_NEAR); });
      this.parent.add(person.root);
      const start = this.graph.nodes.get(def.goals[0]);
      const P = { person, def, node: start.id, pos: start.p.clone(), face: start.face ?? 0, path: null, seg: 0, stay: 3 + (k % 5) * 2.5, pose: { mode: 'stand' }, seed: (seed % 997) * 0.37, blocked: 0, look: 0, gone: false, bay: null, tilt: 0, stuckT: 0 };
      this.people.push(P);
      this.place(P, 0);
    });
  }
  clear() {
    for (const P of this.people) { P.person.root.removeFromParent(); P.person.dispose(); }
    this.people.length = 0;
  }

  /** the station is in trouble: everyone to the nearest pod hatch they can reach */
  alarm(on) {
    if (on === this.panic) return;
    this.panic = on;
    if (!on) {
      // (the trouble over before they were in: back to their rounds)
      for (const P of this.people) if (!P.gone && P.bay) { P.bay = null; P.path = null; P.stay = 1 + Math.random() * 3; }
      return;
    }
    const bays = [...this.graph.nodes.values()].filter((n) => n.kind === 'bay');
    for (const P of this.people) {
      if (P.gone) continue;
      let best = null;
      for (const b of bays) { const r = this.graph.path(P.node, b.id); if (r && (!best || r.len < best.len)) best = r; }
      if (best) { P.path = best.ids; P.seg = 0; P.stay = 0; P.bay = best.ids[best.ids.length - 1]; P.turnTo = undefined; }
    }
  }

  /** pos: Kaito's position (ship-local, or null), eye: his eye; onBoard(bayId): one went in */
  update(dt, pos, eye, onBoard, gMag = 9.81) {
    this.t += dt;
    // (in free fall, as a station that does not turn is, they float along the ways)
    this.zeroG = gMag < 2.2;
    for (const P of this.people) {
      if (P.gone) continue;
      const p = P.pose;
      if (P.path) this.walk(P, dt, pos, onBoard);
      else {
        P.stay -= dt;
        p.mode = this.zeroG ? 'float' : 'stand'; p.lean = 0; p.brace = 0;
        if (P.stay <= 0 && !this.panic) this.next(P);
      }
      if (P.gone) continue;
      // a look at Kaito when he is near and roughly in front, else about
      let lookYaw = Math.sin(this.t * 0.21 + P.seed * 7) * 0.35, lookPitch = 0;
      if (eye && !this.panic) {
        const dx = eye.x - P.pos.x, dz = eye.z - P.pos.z, d = Math.hypot(dx, dz);
        if (d < 4.5 && d > 0.3) {
          const rel = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - P.face), Math.cos(Math.atan2(-dx, -dz) - P.face));
          if (Math.abs(rel) < 1.9) { lookYaw = Math.max(-1.1, Math.min(1.1, rel)); lookPitch = Math.max(-0.35, Math.min(0.35, (eye.y - (P.pos.y + 1.6)) / d)); }
        }
      }
      P.look += (lookYaw - P.look) * Math.min(1, dt * 3);
      p.lookYaw = P.look; p.lookPitch = lookPitch;
      this.place(P, dt);
    }
  }

  next(P) {
    const G = this.graph, taken = (id) => this.people.some((Q) => Q !== P && !Q.gone && (Q.node === id && !Q.path || (Q.path && Q.path[Q.path.length - 1] === id)));
    const goals = P.def.goals.filter((id) => id !== P.node && G.nodes.has(id) && !taken(id));
    if (!goals.length) { P.stay = 4; return; }
    const r = G.path(P.node, goals[Math.floor(Math.random() * goals.length)]);
    if (!r || r.ids.length < 2) { P.stay = 4; return; }
    P.path = r.ids; P.seg = 0; P.turnTo = undefined;
  }

  walk(P, dt, pos, onBoard) {
    const p = P.pose, G = this.graph;
    const fr = G.nodes.get(P.path[P.seg]), to = G.nodes.get(P.path[Math.min(P.seg + 1, P.path.length - 1)]);
    const d = this._v.set(to.p.x - P.pos.x, 0, to.p.z - P.pos.z);
    const flat = Math.hypot(d.x, d.z);
    let speed = (this.panic ? RUN : WALK) * (this.zeroG ? 0.7 : 1);
    // wait for Kaito when he is right in the way, then step round him
    if (pos && !this.panic && flat > 0.01) {
      const ax = pos.x - P.pos.x, az = pos.z - P.pos.z, ad = Math.hypot(ax, az);
      if (ad < 1.1 && Math.abs(pos.y - P.pos.y - 0.9) < 1.6 && (ax * d.x + az * d.z) / (ad * flat) > 0.4) {
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
        if (P.bay && to.id === P.bay) { P.gone = true; P.person.root.visible = false; if (onBoard) onBoard(to.id); return; }
        P.stay = P.def.stay[0] + Math.random() * (P.def.stay[1] - P.def.stay[0]);
        if (to.face !== undefined) P.turnTo = to.face;
        else {
          // two who meet talk a while, facing each other
          const mate = this.people.find((Q) => Q !== P && !Q.gone && !Q.path && Q.pos.distanceTo(P.pos) < 2.2);
          if (mate) { P.turnTo = Math.atan2(-(mate.pos.x - P.pos.x), -(mate.pos.z - P.pos.z)); mate.turnTo = Math.atan2(-(P.pos.x - mate.pos.x), -(P.pos.z - mate.pos.z)); mate.stay = Math.max(mate.stay, P.stay * 0.8); }
        }
      }
      return;
    }
    const step = Math.min(flat, speed * dt), len = Math.hypot(d.x, d.z);
    // (one who cannot get on for long finds another way out)
    if (this.panic) { P.stuckT = step > 0.002 ? 0 : P.stuckT + dt; if (P.stuckT > 8) { P.gone = true; P.person.root.visible = false; return; } }
    if (step > 0) {
      P.pos.x += d.x / len * step; P.pos.z += d.z / len * step;
      // the floor's height along the way (stairs)
      const L = Math.hypot(to.p.x - fr.p.x, to.p.z - fr.p.z);
      const k = L > 0.01 ? 1 - Math.hypot(to.p.x - P.pos.x, to.p.z - P.pos.z) / L : 1;
      P.pos.y = fr.p.y + (to.p.y - fr.p.y) * Math.max(0, Math.min(1, k));
      const want = Math.atan2(-d.x, -d.z);
      P.face += Math.atan2(Math.sin(want - P.face), Math.cos(want - P.face)) * Math.min(1, dt * 8);
    }
    p.mode = this.zeroG ? 'float' : step > 0 ? 'walk' : 'stand';
    P.tilt += ((this.zeroG && step > 0 ? -0.38 : 0) - P.tilt) * Math.min(1, dt * 3);
    p.speed = this.panic ? 1.7 : 1;
    p.phase = (p.phase || 0) + step * (this.panic ? 3.6 : 5.2);
  }

  place(P, dt) {
    if (P.turnTo !== undefined && !P.path) P.face += Math.atan2(Math.sin(P.turnTo - P.face), Math.cos(P.turnTo - P.face)) * Math.min(1, dt * 4);
    P.person.root.position.copy(P.pos);
    if (this.zeroG) P.person.root.position.y += 0.09 + 0.035 * Math.sin(this.t * 0.9 + P.seed * 3);
    if (!P.path) P.tilt *= Math.max(0, 1 - dt * 3);
    P.person.root.rotation.set(P.tilt || 0, P.face, 0);
    P.person.pose(P.pose, this.t);
  }
}
