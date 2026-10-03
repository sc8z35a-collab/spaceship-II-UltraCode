// Cube-sphere quadtree terrain with worker-generated patches, CDLOD-style morphing and
// multi-frustum layer assignment.
import * as THREE from 'three';
import { GRID_N, boundaryLoop, faceToDir, nodeSize, EARTH_R, TerrainFn } from './terrainFn.js';
import { assignLayers } from '../../core/layers.js';

const K_SPLIT = 4.2;
const MAX_LEVEL = 17;
const MAX_NODES = 1100;
const DETAIL_SNAP = 524288; // m; multiple of every periodic-noise period used in terrain shaders (256 * 2048 m)

function buildIndex(N) {
  const NV = (N + 1) * (N + 1);
  const idx = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + (N + 1) + 1, d = a + (N + 1);
      idx.push(a, b, c, a, c, d);
    }
  }
  const loop = boundaryLoop(N);
  const NS = loop.length;
  for (let k = 0; k < NS; k++) {
    const e0 = loop[k], e1 = loop[(k + 1) % NS];
    const s0 = NV + k, s1 = NV + ((k + 1) % NS);
    idx.push(e0, s0, e1, e1, s0, s1);
  }
  return new THREE.BufferAttribute(new Uint16Array(idx), 1);
}

class TNode {
  constructor(face, level, x, y) {
    this.face = face; this.level = level; this.x = x; this.y = y;
    this.key = face + ':' + level + ':' + x + ':' + y;
    this.state = 0; // 0 empty, 1 pending, 2 ready
    this.children = null;
    this.mesh = null;
    this.size = nodeSize(level);
    const span = 2 / Math.pow(2, level);
    const u0 = -1 + x * span, v0 = -1 + y * span;
    const t = [0, 0, 0];
    faceToDir(face, u0 + span / 2, v0 + span / 2, t);
    this.cdir = new THREE.Vector3(t[0], t[1], t[2]);
    this.corners = [];
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      faceToDir(face, u0 + a * span, v0 + b * span, t);
      this.corners.push(new THREE.Vector3(t[0], t[1], t[2]));
    }
    this.angRadius = 0;
    for (const c of this.corners) this.angRadius = Math.max(this.angRadius, Math.acos(Math.min(1, c.dot(this.cdir))));
    this.angRadius *= 1.02;
    this.center = this.cdir.clone().multiplyScalar(EARTH_R);
    this.bcenter = this.center.clone();
    this.bradius = this.size * 0.75 + 9000;
    this.minH = 0; this.maxH = 9000;
    this.lastUsed = 0;
    this.prio = 0;
  }
}

export class EarthTerrain {
  constructor(assets, material, group) {
    this.material = material;
    this.group = group;
    this.fn = new TerrainFn(assets.elevArr, assets.waterArr);
    this.index = buildIndex(GRID_N);
    this.nodes = new Map();
    this.roots = [];
    for (let f = 0; f < 6; f++) this.roots.push(this._node(f, 0, 0, 0));
    this.queue = [];
    this.inflight = 0;
    this.frame = 0;
    this.visible = [];
    this.ready = false;
    this.detailOrigin = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._camEcef = new THREE.Vector3();
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    this.workerLoad = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this._onMsg(e.data, i);
      w.postMessage({ type: 'init', elev: assets.elevArr, water: assets.waterArr });
      this.workers.push(w);
      this.workerLoad.push(0);
    }
    this.pendingByKey = new Map();
  }

  _node(face, level, x, y) {
    const n = new TNode(face, level, x, y);
    this.nodes.set(n.key, n);
    return n;
  }

  _request(node) {
    if (node.state !== 0) return;
    node.state = 1;
    this.queue.push(node);
  }

  _pump() {
    if (!this.queue.length) return;
    this.queue.sort((a, b) => a.prio - b.prio);
    while (this.queue.length) {
      let wi = 0;
      for (let i = 1; i < this.workers.length; i++) if (this.workerLoad[i] < this.workerLoad[wi]) wi = i;
      if (this.workerLoad[wi] >= 3) break;
      const node = this.queue.shift();
      if (node.state !== 1) continue;
      // drop stale requests (not used recently)
      if (this.frame - node.lastUsed > 30 && node.level > 1) { node.state = 0; continue; }
      this.workerLoad[wi]++;
      this.pendingByKey.set(node.key, node);
      this.workers[wi].postMessage({ type: 'build', key: node.key, face: node.face, level: node.level, x: node.x, y: node.y });
    }
  }

  _onMsg(m, wi) {
    if (m.type !== 'built') return;
    this.workerLoad[wi]--;
    const node = this.pendingByKey.get(m.key);
    this.pendingByKey.delete(m.key);
    if (!node || node.state !== 1) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    g.setAttribute('dir', new THREE.BufferAttribute(m.dir, 3));
    g.setAttribute('hw', new THREE.BufferAttribute(m.hw, 2));
    g.setAttribute('morph', new THREE.BufferAttribute(m.morph, 3));
    g.setIndex(this.index);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(...m.bcenter), m.bradius);
    const mesh = new THREE.Mesh(g, this.material);
    mesh.position.set(m.center[0], m.center[1], m.center[2]);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    mesh.frustumCulled = true;
    mesh.userData.node = node;
    const self = this;
    mesh.onBeforeRender = function (r, s, cam, geo, mat) {
      const nd = this.userData.node;
      const u = mat.uniforms;
      u.uMorph.value.copy(nd.morph);
      u.uDetailOffset.value.set(nd.center.x - self.detailOrigin.x, nd.center.y - self.detailOrigin.y, nd.center.z - self.detailOrigin.z);
      mat.uniformsNeedUpdate = true;
    };
    node.mesh = mesh;
    node.center.set(m.center[0], m.center[1], m.center[2]);
    node.bcenter.set(m.center[0] + m.bcenter[0], m.center[1] + m.bcenter[1], m.center[2] + m.bcenter[2]);
    node.bradius = m.bradius;
    node.minH = m.minH; node.maxH = m.maxH;
    const L = node.level;
    node.morph = L === 0 ? new THREE.Vector2(1e12, 2e12) : new THREE.Vector2(2 * K_SPLIT * node.size * 0.62, 2 * K_SPLIT * node.size * 0.92);
    node.state = 2;
    this.group.add(mesh);
  }

  _horizonCulled(node, cam) {
    // conservative cone test: node cap vs. the camera's visible cap (incl. elevated terrain)
    const r = cam.length();
    const Ro = EARTH_R - 50;
    if (r <= Ro + 1) return false;
    const angH = Math.acos(Ro / r) + Math.acos(Ro / (Ro + Math.max(node.maxH, 0) + 100));
    const c = (cam.x * node.cdir.x + cam.y * node.cdir.y + cam.z * node.cdir.z) / r;
    const ang = Math.acos(Math.max(-1, Math.min(1, c)));
    return ang > angH + node.angRadius;
  }

  /**
   * camEcef: camera position in Earth-fixed metres (float64)
   * camToWorld: function(ecefVec, out) mapping Earth-fixed point to world (render) frame
   */
  update(camEcef, earthGroupMatrixWorld, camWorld) {
    this.frame++;
    this._camEcef.copy(camEcef);
    // periodic-noise detail origin snapped to a coarse grid
    this.detailOrigin.set(
      Math.round(camEcef.x / DETAIL_SNAP) * DETAIL_SNAP,
      Math.round(camEcef.y / DETAIL_SNAP) * DETAIL_SNAP,
      Math.round(camEcef.z / DETAIL_SNAP) * DETAIL_SNAP);
    for (const n of this.visible) n.mesh.visible = false;
    this.visible.length = 0;
    let allRoots = true;
    for (const r of this.roots) { r.lastUsed = this.frame; if (r.state !== 2) { this._request(r); allRoots = false; } }
    if (allRoots) {
      this.ready = true;
      for (const r of this.roots) this._visit(r, camEcef);
    }
    // layer assignment for visible nodes
    const t = this._tmp;
    for (const n of this.visible) {
      t.copy(n.bcenter).applyMatrix4(earthGroupMatrixWorld);
      const d = t.distanceTo(camWorld);
      assignLayers(n.mesh, Math.max(0, d - n.bradius), d + n.bradius);
      n.mesh.visible = true;
    }
    this._pump();
    if (this.nodes.size > MAX_NODES) this._evict();
  }

  _visit(node, cam) {
    node.lastUsed = this.frame;
    if (this._horizonCulled(node, cam)) return;
    const dist = Math.max(0, cam.distanceTo(node.bcenter) - node.bradius);
    node.prio = dist / node.size;
    const wantSplit = node.level < MAX_LEVEL && dist < K_SPLIT * node.size;
    if (wantSplit) {
      if (!node.children) {
        const L = node.level + 1, x = node.x * 2, y = node.y * 2;
        node.children = [this._node(node.face, L, x, y), this._node(node.face, L, x + 1, y), this._node(node.face, L, x, y + 1), this._node(node.face, L, x + 1, y + 1)];
      }
      let ready = true;
      for (const c of node.children) {
        c.lastUsed = this.frame;
        if (c.state !== 2) {
          ready = false;
          c.prio = Math.max(0, cam.distanceTo(c.bcenter) - c.bradius) / c.size;
          this._request(c);
        }
      }
      if (ready) {
        for (const c of node.children) this._visit(c, cam);
        return;
      }
    }
    if (node.state === 2) this.visible.push(node);
  }

  _evict() {
    // release whole child subtrees that have not been used recently (oldest first)
    const cands = [];
    const walk = (n) => {
      if (!n.children) return;
      let old = true;
      for (const c of n.children) if (this.frame - c.lastUsed < 90) { old = false; break; }
      if (old) cands.push(n);
      else for (const c of n.children) walk(c);
    };
    for (const r of this.roots) walk(r);
    cands.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const n of cands) {
      if (this.nodes.size < MAX_NODES * 0.8) break;
      for (const c of n.children) this._free(c);
      n.children = null;
    }
  }

  _free(n) {
    if (n.children) for (const c of n.children) this._free(c);
    n.children = null;
    if (n.mesh) {
      this.group.remove(n.mesh);
      n.mesh.geometry.dispose();
      n.mesh = null;
    }
    n.state = 0; // a pending worker result for this node is ignored
    this.nodes.delete(n.key);
  }

  /** surface height (m) under an Earth-fixed unit direction */
  heightAt(dir, out) {
    return this.fn.height(dir.x, dir.y, dir.z, 3, out);
  }
}
