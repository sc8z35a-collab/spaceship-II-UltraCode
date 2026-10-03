// Loose objects with real rigid-body physics: mugs, books, a tablet, tools, boxes, a ball...
// Most are stowed (velcro / straps) until an impact or a hard manoeuvre knocks them free;
// a few drift freely in zero-g from the start.
import * as THREE from 'three';
import { RoundedBoxGeometry } from './geom.js';
import { LAYER_NEAR, setLayersDeep } from '../core/layers.js';
import { mugGeo } from './props.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function createLooseProps(game) {
  const g = game, M = g.shipVis.M, phys = g.phys;
  const group = new THREE.Group();
  group.name = 'loose';
  g.shipVis.root.add(group);
  const items = [];

  const add = (obj, shape, mass, kind, pos, rot = [0, 0, 0], stowed = true) => {
    obj.position.copy(pos);
    obj.rotation.set(rot[0], rot[1], rot[2]);
    obj.updateMatrix();
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    setLayersDeep(obj, LAYER_NEAR);
    group.add(obj);
    const it = phys.addLoose(obj, shape, mass, kind, stowed);
    it.prevV = new THREE.Vector3();
    it.knockT = 0;
    items.push(it);
    return it;
  };
  const box = (w, h, d, mat, r = 0.01) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)), mat);

  // ---- living room table / sofa / galley
  {
    const m = new THREE.Group();
    const mesh = new THREE.Mesh(mugGeo(), M.plasticY);
    mesh.position.y = -0.045;
    m.add(mesh);
    add(m, { type: 'cyl', hh: 0.045, r: 0.04 }, 0.3, 'mug', V(-2.43, 0.765, -6.08));
  }
  {
    const tab = new THREE.Group();
    tab.add(box(0.24, 0.012, 0.17, M.plasticK, 0.006));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.145), M.screenOff);
    scr.rotation.x = -Math.PI / 2; scr.position.y = 0.0065;
    tab.add(scr);
    add(tab, { type: 'box', hx: 0.12, hy: 0.006, hz: 0.085 }, 0.5, 'tablet', V(-2.6, 0.727, -6.0), [0, 0.3, 0]);
  }
  add(box(0.14, 0.05, 0.09, M.plasticR), { type: 'box', hx: 0.07, hy: 0.025, hz: 0.045 }, 0.15, 'snack', V(-2.45, 0.746, -5.7), [0, -0.5, 0]);
  {
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.14, 6), M.plasticB);
    pen.rotation.z = Math.PI / 2;
    const pg = new THREE.Group(); pg.add(pen);
    add(pg, { type: 'cyl', hh: 0.07, r: 0.006 }, 0.02, 'pen', V(-2.38, 0.726, -6.3), [0, 0.8, 0]);
  }
  {
    const book = new THREE.Group();
    book.add(box(0.15, 0.03, 0.21, M.book2, 0.004));
    const pages = box(0.142, 0.026, 0.2, M.paper, 0.002); pages.position.x = 0.006; book.add(pages);
    add(book, { type: 'box', hx: 0.075, hy: 0.015, hz: 0.105 }, 0.35, 'book', V(-1.12, 0.515, -5.3), [0, 0.6, 0]);
  }
  add(box(0.08, 0.16, 0.08, M.plasticG, 0.015), { type: 'box', hx: 0.04, hy: 0.08, hz: 0.04 }, 0.4, 'can', V(-2.05, 1.02, -3.35));
  add(box(0.14, 0.2, 0.08, new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.8 }), 0.02), { type: 'box', hx: 0.07, hy: 0.1, hz: 0.04 }, 0.5, 'beans', V(-2.6, 1.04, -3.35), [0, 0.2, 0]);

  // ---- cockpit
  {
    const fl = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 12), M.metalDark);
    body.rotation.z = Math.PI / 2;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.02, 0.04, 12), M.steel);
    head.rotation.z = Math.PI / 2; head.position.x = 0.09;
    fl.add(body, head);
    add(fl, { type: 'cyl', hh: 0.1, r: 0.026 }, 0.25, 'flashlight', V(1.42, 1.055, -8.66), [0, 0.4, Math.PI / 2]);
  }
  {
    const nb = new THREE.Group();
    nb.add(box(0.15, 0.012, 0.21, M.plasticY, 0.003));
    add(nb, { type: 'box', hx: 0.075, hy: 0.006, hz: 0.105 }, 0.15, 'notebook', V(1.75, 1.15, -8.75), [0, -0.3, 0]);
  }

  // ---- bunk
  {
    const book = new THREE.Group();
    book.add(box(0.13, 0.025, 0.19, M.book1, 0.004));
    add(book, { type: 'box', hx: 0.065, hy: 0.0125, hz: 0.095 }, 0.3, 'book', V(-2.3, 0.79, -0.35), [0, 1.2, 0]);
  }
  {
    // plush: a small bear made of spheres
    const bear = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), M.cushion);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), M.cushion); head.position.y = 0.08;
    for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), M.cushion); ear.position.set(s * 0.033, 0.115, 0); bear.add(ear); }
    bear.add(body, head);
    add(bear, { type: 'ball', r: 0.07 }, 0.15, 'plush', V(-1.95, 0.85, 0.0), [0, 0.5, 0]);
  }

  // ---- storage
  add(box(0.36, 0.3, 0.3, M.plasticW, 0.02), { type: 'box', hx: 0.18, hy: 0.15, hz: 0.15 }, 6, 'box', V(-1.45, 0.15, 3.2), [0, 0.15, 0]);
  add(box(0.3, 0.26, 0.3, M.plasticB, 0.02), { type: 'box', hx: 0.15, hy: 0.13, hz: 0.15 }, 4, 'box', V(-1.85, 0.13, 3.75), [0, -0.3, 0]);
  {
    const tb = new THREE.Group();
    tb.add(box(0.42, 0.18, 0.2, M.plasticR, 0.015));
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.01, 6, 12, Math.PI), M.plasticK); h.position.y = 0.09; tb.add(h);
    add(tb, { type: 'box', hx: 0.21, hy: 0.09, hz: 0.1 }, 5, 'toolbox', V(-1.25, 0.09, 2.3), [0, 0.7, 0]);
  }

  // ---- engineering
  {
    const wr = new THREE.Group();
    const shaft = box(0.2, 0.012, 0.025, M.steel, 0.004);
    const jaw = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.009, 6, 10, Math.PI * 1.4), M.steel); jaw.rotation.x = Math.PI / 2; jaw.position.x = 0.11;
    wr.add(shaft, jaw);
    add(wr, { type: 'box', hx: 0.12, hy: 0.008, hz: 0.02 }, 0.35, 'wrench', V(0.55, 0.012, 7.7), [0, 0.9, 0]);
  }
  add(box(0.22, 0.12, 0.16, M.plasticY, 0.012), { type: 'box', hx: 0.11, hy: 0.06, hz: 0.08 }, 1.5, 'box', V(-0.6, 0.06, 8.6), [0, 0.2, 0]);

  // ---- bathroom
  add(box(0.05, 0.12, 0.05, M.plasticG, 0.012), { type: 'box', hx: 0.025, hy: 0.06, hz: 0.025 }, 0.2, 'bottle', V(2.36, 0.95, -6.55));

  // ---- free floaters (zero-g from the start): a soft ball and a forgotten sock-shaped cushion
  {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 12), M.plasticR);
    const it = add(ball, { type: 'ball', r: 0.055 }, 0.08, 'ball', V(-0.2, 1.45, -2.4), [0, 0, 0], false);
    it.body.setLinvel({ x: 0.03, y: 0.01, z: -0.02 }, true);
    it.body.setAngvel({ x: 0.2, y: 0.4, z: 0.1 }, true);
  }
  {
    const it = add(box(0.18, 0.06, 0.12, M.fabricBlue, 0.03), { type: 'box', hx: 0.09, hy: 0.03, hz: 0.06 }, 0.1, 'cushion', V(-1.7, 1.5, -6.6), [0.3, 0.2, 0.1], false);
    it.body.setLinvel({ x: 0.01, y: -0.005, z: 0.015 }, true);
    it.body.setAngvel({ x: 0.05, y: 0.12, z: 0.03 }, true);
  }
  return { group, items };
}
