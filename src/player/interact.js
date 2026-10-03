// Tap-to-interact: raycasts from the camera through the tap point against invisible proxy
// volumes and monitor screens, occluded by the ship's static geometry (BVH accelerated).
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const LAYER_PROXY = 6;

export class Interactions {
  constructor(shipRoot) {
    this.root = shipRoot;
    this.items = [];      // {obj, onTap(hit), maxDist, enabled()}
    this.occluders = [];
    this.ray = new THREE.Raycaster();
    this.ray.layers.enableAll();
    this.proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    this.group = new THREE.Group();
    this.group.name = 'proxies';
    shipRoot.add(this.group);
  }

  addOccluders(group) {
    group.traverse((o) => {
      if (o.isMesh && !o.material.transparent) {
        if (!o.geometry.boundsTree) o.geometry.computeBoundsTree();
        this.occluders.push(o);
      }
    });
  }

  /** sphere proxy */
  addSphere(pos, r, onTap, opts = {}) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), this.proxyMat);
    m.position.copy(pos);
    m.layers.set(LAYER_PROXY);
    this.group.add(m);
    m.updateMatrixWorld();
    const it = { obj: m, onTap, maxDist: opts.maxDist || 2.6, enabled: opts.enabled || (() => true), id: opts.id };
    this.items.push(it);
    return it;
  }

  addBox(pos, size, quat, onTap, opts = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), this.proxyMat);
    m.position.copy(pos);
    if (quat) m.quaternion.copy(quat);
    m.layers.set(LAYER_PROXY);
    this.group.add(m);
    m.updateMatrixWorld();
    const it = { obj: m, onTap, maxDist: opts.maxDist || 2.6, enabled: opts.enabled || (() => true), id: opts.id };
    this.items.push(it);
    return it;
  }

  /** an existing mesh (e.g. a monitor screen) */
  addMesh(mesh, onTap, opts = {}) {
    const it = { obj: mesh, onTap, maxDist: opts.maxDist || 2.8, enabled: opts.enabled || (() => true), id: opts.id };
    this.items.push(it);
    return it;
  }

  remove(it) {
    this.items = this.items.filter((x) => x !== it);
    if (it.obj.parent === this.group) this.group.remove(it.obj);
  }

  /** returns true if something was hit */
  tap(ndc, camera) {
    this.ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    this.ray.near = 0.01; this.ray.far = 6;
    const objs = this.items.filter((i) => i.enabled()).map((i) => i.obj);
    const hits = this.ray.intersectObjects(objs, false);
    if (!hits.length) return null;
    const occ = this.ray.intersectObjects(this.occluders, false);
    const occD = occ.length ? occ[0].distance : Infinity;
    for (const h of hits) {
      const it = this.items.find((i) => i.obj === h.object);
      if (!it) continue;
      if (h.distance > it.maxDist) continue;
      if (h.distance > occD + 0.06) continue;
      it.onTap(h);
      return it;
    }
    return null;
  }
}
