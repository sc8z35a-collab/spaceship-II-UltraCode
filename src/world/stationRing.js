// The inside of Shirasagi's habitat ring: a deck 377 m round, its floor curving up ahead and
// behind until it disappears overhead, held down by the ring's spin (about half a g on the
// floor). Twenty-four sections: the spoke elevator halls (six, one under each spoke), a café
// plaza, residential streets with front doors, a park with lawn, trees and a brook, an
// observation deck with glass in the floor (the stars wheel past under your feet), hydroponic
// farms under violet light. Skylights in the ceiling look up the spokes to the hub.
//
// Ring-local frame: the ring turns about +z; a point at angle a and radius r is
// (r cos a, r sin a, z). The floor is the far side (gravity points outward).
import * as THREE from 'three';
import { Builder, rng } from '../ship/geom.js';

export const RING = { R: 58, floor: 60.0, ceil: 55.4, hw: 2.2, omega: 0.28, sections: 24 };
const D2R = Math.PI / 180;
const SEG = 360 / RING.sections;

/** a band of a cylinder (radius r, angles a0..a1 rad, z0..z1) facing the axis (inward) or out */
function band(r, a0, a1, z0, z1, segs, inward = true, tile = 1.0) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (a1 - a0) * (i / segs);
    const c = Math.cos(a), s = Math.sin(a);
    for (const z of [z0, z1]) {
      pos.push(r * c, r * s, z);
      nrm.push(inward ? -c : c, inward ? -s : s, 0);
      uv.push((a * r) / tile, z / tile);
    }
  }
  for (let i = 0; i < segs; i++) {
    const k = i * 2;
    if (inward) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    else idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** a flat annulus sector in the plane z (side wall), normal along nz (+1 / -1) */
function annulus(r0, r1, a0, a1, z, segs, nz, tile = 1.0, tileV = tile) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (a1 - a0) * (i / segs);
    const c = Math.cos(a), s = Math.sin(a);
    for (const r of [r0, r1]) { pos.push(r * c, r * s, z); nrm.push(0, 0, nz); uv.push(a * RING.floor / tile, (RING.floor - r) / tileV); }
  }
  for (let i = 0; i < segs; i++) {
    const k = i * 2;
    if (nz > 0) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    else idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function ringMaterials(M) {
  if (M.ringFloor) return M;
  const S = (o) => new THREE.MeshStandardMaterial(o);
  // pale stone pavers with darker joints
  M.ringFloor = S({ color: 0xffffff, roughness: 0.7, metalness: 0.0, map: canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#cfc9bd'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const v = 190 + ((x * 7 + y * 13) % 5) * 6;
      g.fillStyle = `rgb(${v},${v - 6},${v - 16})`;
      g.fillRect(x * 128 + (y % 2) * 64 + 3, y * 128 + 3, 122, 122);
    }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  }) });
  M.ringFloor.map.repeat.set(0.5, 0.5);
  M.grass = S({ color: 0xffffff, roughness: 0.95, map: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4f7a34'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) { const v = Math.random(); g.fillStyle = `rgb(${50 + v * 50},${95 + v * 70},${30 + v * 30})`; g.fillRect(Math.random() * w, Math.random() * h, 1, 3); }
  }) });
  M.grass.map.repeat.set(0.4, 0.4);
  M.water = S({ color: 0x23475e, roughness: 0.08, metalness: 0.2, envMapIntensity: 1.2 });
  // wall lining: a darker dado up to the rail at 0.9 m, pale panels with fine seams above
  M.ringWall = S({ color: 0xffffff, roughness: 0.75, map: canvasTex(256, 512, (g, w, h) => {
    const rail = h - h * 0.9 / 4.8;
    g.fillStyle = '#ece6da'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#8b7d6b'; g.fillRect(0, rail, w, h - rail);
    g.fillStyle = '#c9a55a'; g.fillRect(0, rail - 4, w, 6);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (const x of [0, w / 2]) g.fillRect(x, 0, 2, rail - 4);
    for (const x of [w / 4, w * 3 / 4]) g.fillRect(x, rail + 4, 2, h - rail);
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.03})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  }) });
  M.deckGlass = new THREE.MeshPhysicalMaterial({ color: 0x0b131c, roughness: 0.02, transparent: true, opacity: 0.12, depthWrite: false, envMapIntensity: 0.25 });
  M.ringCeil = S({ color: 0xf2efe8, roughness: 0.8, emissive: new THREE.Color(0.22, 0.22, 0.2) });
  M.ringStrip = S({ color: 0x000000, emissive: new THREE.Color(1.0, 0.93, 0.8), emissiveIntensity: 2.2 });
  M.farmLed = S({ color: 0x000000, emissive: new THREE.Color(0.75, 0.25, 1.0), emissiveIntensity: 2.6 });
  M.skyGlass = new THREE.MeshPhysicalMaterial({ color: 0x9fc4e8, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  M.doorPaint = S({ color: 0x3e5a6e, roughness: 0.5, metalness: 0.2 });
  M.doorPaint2 = S({ color: 0x7a4b32, roughness: 0.55, metalness: 0.1 });
  M.awning = S({ color: 0xb8432f, roughness: 0.8, side: THREE.DoubleSide });
  M.callBtn = S({ color: 0x000000, emissive: new THREE.Color(0.3, 0.8, 1.0), emissiveIntensity: 2.0 });
  return M;
}

/** a small deciduous tree: tapering trunk, a few limbs, a clumped canopy */
function tree(b, R, h) {
  b.cyl(0.07, 0.12, h, 'trunk', [0, h / 2, 0], null, 10);
  b.cyl(0.16, 0.16, 0.04, 'soil', [0, 0.02, 0], null, 12);
  const top = [0, h, 0];
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI * 2 + R();
    const tip = [Math.cos(a) * 0.55, h + 0.35 + R() * 0.25, Math.sin(a) * 0.55];
    b.pipe([0, h * 0.75, 0], tip, 0.035, 'trunk', 6);
  }
  for (let k = 0; k < 16; k++) {
    const a = R() * Math.PI * 2, r = 0.2 + R() * 0.62, y = h + 0.15 + R() * 0.75 - r * 0.25;
    b.sphere(0.28 + R() * 0.26, R() > 0.45 ? 'leaf' : 'leafLight', [Math.cos(a) * r, y, Math.sin(a) * r], 9, [1, 0.78 + R() * 0.3, 1]);
  }
  b.colCyl(0.14, h, [0, h / 2, 0]);
  return top;
}

const signCache = new Map();
function signMat(text, sub = '') {
  const key = text + '|' + sub;
  if (signCache.has(key)) return signCache.get(key);
  const t = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#10161d'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9a55a'; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#f2e6c8'; g.font = 'bold 92px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, sub ? h * 0.42 : h / 2);
    if (sub) { g.fillStyle = '#9fb3c4'; g.font = '48px sans-serif'; g.fillText(sub, w / 2, h * 0.78); }
  });
  const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.9, color: 0x000000, roughness: 0.5 });
  signCache.set(key, m);
  return m;
}

/**
 * Build the ring interior. Returns { group (ring-local, to be placed at the ring centre and turned
 * with the ring), colliders (ring-local), lamps (ring-local), contains(pLocal), halls: [{ a, pos,
 * out (Vector3 where you step out), button (Mesh) }] }
 */
export function buildRingInterior(def, M) {
  ringMaterials(M);
  const b = new Builder();
  const R = rng(777);
  const { floor: RF, ceil: RC, hw } = RING;
  const lamps = [];
  const lamp = (a, z, h, color = 0xfff1dc, intensity = 2.2, range = 11) => {
    const r = RF - h;
    lamps.push({ local: new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), z), pos: new THREE.Vector3(), color, intensity, range, room: 'station' });
  };
  const at = (aDeg, z = 0, h = 0) => {
    const a = aDeg * D2R, r = RF - h;
    return { pos: [r * Math.cos(a), r * Math.sin(a), z], rot: [0, 0, a + Math.PI / 2] };
  };
  const place = (aDeg, z, h, fn) => { const f = at(aDeg, z, h); b.push(f.pos, f.rot); fn(); b.pop(); };
  // a hanging sign readable from both ways along the deck
  const signs = [];
  const hangSign = (aDeg, h, w, ht, mat) => {
    const sg = at(aDeg, 0, h);
    for (const flip of [0, Math.PI]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, ht), mat);
      m.position.set(...sg.pos);
      m.rotation.set(0, Math.PI / 2 + flip, sg.rot[2], 'ZYX');
      signs.push(m);
    }
  };

  const halls = [];
  for (let k = 0; k < RING.sections; k++) {
    const a0 = k * SEG, a1 = a0 + SEG, am = a0 + SEG / 2;
    const A0 = a0 * D2R, A1 = a1 * D2R;
    const kind = k % 4 === 0 ? 'hall' : ['plaza', 'park', 'street', 'deck', 'farm', 'street'][(k + Math.floor(k / 4)) % 6];
    // ---- floor (glass panels in the observation deck)
    if (kind === 'deck') {
      const g0 = am - 3.2, g1 = am + 3.2;
      b.add(band(RF, A0, g0 * D2R, -hw, hw, 12, true, 2), 'ringFloor');
      b.add(band(RF, g1 * D2R, A1, -hw, hw, 12, true, 2), 'ringFloor');
      b.add(band(RF, g0 * D2R, g1 * D2R, -hw, -1.3, 12, true, 2), 'ringFloor');
      b.add(band(RF, g0 * D2R, g1 * D2R, 1.3, hw, 12, true, 2), 'ringFloor');
      b.add(band(RF + 0.02, g0 * D2R, g1 * D2R, -1.3, 1.3, 16, true, 2), 'deckGlass');
      // gold frame around the floor window, railing-free (it is glass you can walk on)
      for (const ad of [g0, g1]) place(ad, 0, 0.0, () => b.box(0.08, 0.03, 2.7, 'gold', [0, 0.015, 0], null, 0));
      for (const z of [-1.32, 1.32]) b.add(band(RF - 0.012, g0 * D2R, g1 * D2R, z - 0.04, z + 0.04, 16, true, 1), 'gold');
      place(am - 5.5, -1.6, 0, () => { b.box(1.8, 0.45, 0.5, 'wood', [0, 0.225, 0], null, 0.03); b.colBox(1.8, 0.45, 0.5, [0, 0.225, 0]); });
      place(am + 5.5, 1.6, 0, () => { b.box(1.8, 0.45, 0.5, 'wood', [0, 0.225, 0], null, 0.03); b.colBox(1.8, 0.45, 0.5, [0, 0.225, 0]); });
    } else if (kind === 'park') {
      // lawn with a brook down the middle and a path along one side
      b.add(band(RF, A0, A1, -hw, -0.9, 24, true, 2), 'ringFloor');
      b.add(band(RF, A0, A1, -0.9, 1.45, 24, true, 2), 'grass');
      b.add(band(RF + 0.05, A0, A1, 1.45, 1.75, 24, true, 1), 'water');
      b.add(band(RF, A0, A1, 1.75, hw, 24, true, 2), 'grass');
      for (let i = 0; i < 5; i++) {
        const ad = a0 + 1.5 + i * 3.0, z = -0.1 + (i % 2) * 0.55;
        place(ad, z, 0, () => tree(b, R, 1.9 + R() * 0.6));
      }
      // a lamp post by the path
      place(am, -1.95, 0, () => {
        b.cyl(0.035, 0.05, 2.6, 'black', [0, 1.3, 0], null, 8);
        b.sphere(0.13, 'lampWarm', [0, 2.65, 0], 12);
        b.colCyl(0.06, 2.6, [0, 1.3, 0]);
      });
      for (const ad of [a0 + 4, a0 + 11]) place(ad, -1.55, 0, () => {
        b.box(1.4, 0.06, 0.42, 'wood', [0, 0.44, 0], null, 0.02);
        b.box(1.4, 0.4, 0.05, 'wood', [0, 0.7, -0.2], null, 0.02);
        for (const x of [-0.6, 0.6]) b.box(0.06, 0.44, 0.4, 'black', [x, 0.22, 0], null, 0.01);
        b.colBox(1.4, 0.5, 0.45, [0, 0.25, 0]);
      });
      lamp(am, 1.2, 3.6, 0xfff3d8, 1.8, 10);
    } else {
      b.add(band(RF, A0, A1, -hw, hw, 24, true, 2), kind === 'plaza' ? 'marble' : kind === 'farm' ? 'grate' : 'ringFloor');
    }
    // ---- side walls (doors along the residential streets, shopfronts on the plaza)
    for (const sz of [-1, 1]) b.add(annulus(RC, RF, A0, A1, sz * hw, 24, -sz, 2.4, 4.8), 'ringWall');
    // skirting and the cove light lines along both walls
    for (const sz of [-1, 1]) {
      b.add(band(RF - 0.06, A0, A1, sz * hw - sz * 0.03, sz * hw, 24, true, 1), 'black');
      b.add(band(RC + 0.25, A0, A1, sz * (hw - 0.05) - 0.03, sz * (hw - 0.05) + 0.03, 24, true, 1), 'ringStrip');
    }
    // ---- ceiling with a skylight strip (the spokes, the hub and the stars go round overhead)
    const skyA = am - 2.5, skyB = am + 2.5;
    const sky = kind === 'park' || kind === 'plaza' || kind === 'deck';
    if (sky) {
      b.add(band(RC, A0, skyA * D2R, -hw, hw, 10, false, 2), 'ringCeil');
      b.add(band(RC, skyB * D2R, A1, -hw, hw, 10, false, 2), 'ringCeil');
      b.add(band(RC, skyA * D2R, skyB * D2R, -hw, -1.2, 10, false, 2), 'ringCeil');
      b.add(band(RC, skyA * D2R, skyB * D2R, 1.2, hw, 10, false, 2), 'ringCeil');
      b.add(band(RC - 0.02, skyA * D2R, skyB * D2R, -1.2, 1.2, 10, false, 2), 'skyGlass');
      for (const z of [-1.22, 1.22]) b.add(band(RC + 0.01, skyA * D2R, skyB * D2R, z - 0.05, z + 0.05, 10, false, 1), 'gold');
    } else b.add(band(RC, A0, A1, -hw, hw, 24, false, 2), 'ringCeil');
    // ceiling ribs every 3 degrees
    for (let ad = a0; ad < a1 - 0.01; ad += 3) place(ad, 0, RF - RC - 0.12, () => b.box(0.14, 0.22, hw * 2, 'brass', [0, 0, 0], null, 0.02));

    // ---- what is in the section
    if (kind === 'hall') {
      // the spoke elevator: a glass column from the floor into the ceiling, the car inside, doors
      // facing along the deck, a call pillar beside them
      place(am, 0, 0, () => {
        // (Shirasagi's first hall: the column is open at its doors for the real car, ringLift.js)
        const live = def.id === 'shirasagi' && k === 0;
        if (live) b.add(new THREE.CylinderGeometry(0.95, 0.95, RF - RC, 32, 1, true, Math.PI / 2 + 0.56, Math.PI * 2 - 1.12), 'glass', [0, (RF - RC) / 2, 0]);
        else b.cyl(0.95, 0.95, RF - RC, 'glass', [0, (RF - RC) / 2, 0], null, 32, true);
        for (const y of [0.04, RF - RC - 0.1]) b.torus(0.97, 0.06, 'gold', [0, y, 0], [Math.PI / 2, 0, 0], 32);
        for (let i = 0; i < 6; i++) { const q = i / 6 * Math.PI * 2 + Math.PI / 6; b.box(0.08, RF - RC, 0.08, 'steel', [Math.cos(q) * 0.97, (RF - RC) / 2, Math.sin(q) * 0.97], null, 0.01); }
        if (!live) {
          b.cyl(0.85, 0.85, 2.3, 'cream', [0, 1.2, 0], null, 24);       // the car
          b.cyl(0.9, 0.9, 0.12, 'brass', [0, 2.42, 0], null, 24);
          b.box(1.0, 2.05, 0.06, 'steel', [0.9, 1.05, 0], [0, Math.PI / 2, 0], 0.01);   // doors facing +x (along the deck)
          b.box(0.04, 2.0, 0.02, 'led', [0.94, 1.05, 0], [0, Math.PI / 2, 0], 0);
          b.colCyl(1.0, RF - RC, [0, (RF - RC) / 2, 0]);
        }
        // call pillar
        b.cyl(0.12, 0.16, 1.1, 'marbleDark', [1.5, 0.55, 0.85], null, 16);
        b.box(0.3, 0.18, 0.06, 'black', [1.5, 1.12, 0.85], [0, Math.PI / 2, -0.4], 0.02);
        b.colCyl(0.17, 1.1, [1.5, 0.55, 0.85]);
      });
      const f = at(am, 0, 0);
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 20), M.callBtn);
      const fb = at(am, 0.85, 1.16);
      btn.position.set(...fb.pos);
      btn.rotation.set(0, 0, fb.rot[2]);
      // the step-out point in front of the doors
      const a = am * D2R, ta = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
      const out = new THREE.Vector3(...f.pos).addScaledVector(ta, 1.7).addScaledVector(new THREE.Vector3(-Math.cos(a), -Math.sin(a), 0), 1.0);
      halls.push({ a: am, out, tangent: ta, button: btn, k: k / 4 });
      // the hall's sign hanging from the ceiling
      hangSign(am - 2.2, 3.4, 2.4, 0.6, signMat(`第${k / 4 + 1}エレベーター`, `SPOKE ${k / 4 + 1} · ハブ行き`));
      lamp(am, 1.4, 3.4, 0xffeccf, 2.4, 11);
      lamp(am, -1.4, 3.4, 0xffeccf, 2.0, 9);
    } else if (kind === 'plaza') {
      // café: counter with an awning, round tables, chairs, a fountain in the middle
      place(am - 4.5, -1.55, 0, () => {
        b.box(2.6, 1.05, 0.7, 'wood', [0, 0.525, 0], null, 0.04);
        b.box(2.7, 0.06, 0.8, 'marble', [0, 1.08, 0], null, 0.02);
        b.box(2.8, 0.08, 0.9, 'awning', [0, 2.5, 0.15], [0.25, 0, 0], 0.02);
        for (const x of [-1.2, 1.2]) b.cyl(0.03, 0.03, 1.4, 'brass', [x, 1.8, 0.45], null, 6);
        b.box(0.5, 0.35, 0.3, 'steel', [0.8, 1.28, -0.1], null, 0.03);   // espresso machine
        b.colBox(2.7, 1.1, 0.8, [0, 0.55, 0]);
      });
      for (const [ad, z] of [[am - 1.5, 0.6], [am + 1.2, -0.9], [am + 3.6, 0.8], [am + 5.5, -1.1]]) place(ad, z, 0, () => {
        b.cyl(0.38, 0.38, 0.03, 'marble', [0, 0.74, 0], null, 24);
        b.cyl(0.04, 0.05, 0.72, 'brass', [0, 0.37, 0], null, 8);
        b.cyl(0.22, 0.22, 0.02, 'brass', [0, 0.01, 0], null, 16);
        for (const q of [0, Math.PI]) {
          b.push([Math.cos(q) * 0.6, 0, Math.sin(q) * 0.6], [0, -q + Math.PI / 2, 0]);
          b.box(0.4, 0.04, 0.4, 'leather', [0, 0.45, 0], null, 0.02);
          b.box(0.4, 0.4, 0.04, 'leather', [0, 0.68, 0.18], null, 0.02);
          for (const x of [-0.17, 0.17]) for (const zz of [-0.17, 0.17]) b.cyl(0.015, 0.015, 0.45, 'black', [x, 0.225, zz], null, 6);
          b.pop();
        }
        b.colCyl(0.4, 0.76, [0, 0.38, 0]);
      });
      place(am + 7.0, 0.4, 0, () => {
        b.cyl(0.75, 0.85, 0.45, 'marble', [0, 0.225, 0], null, 32);
        b.cyl(0.66, 0.66, 0.05, 'water', [0, 0.42, 0], null, 32);
        b.cyl(0.08, 0.12, 1.0, 'marble', [0, 0.8, 0], null, 12);
        b.sphere(0.2, 'gold', [0, 1.35, 0], 16);
        b.colCyl(0.85, 0.45, [0, 0.225, 0]);
      });
      lamp(am - 4, -0.8, 3.0, 0xffd9a8, 2.4, 10);
      lamp(am + 3, 0.5, 3.6, 0xfff1dc, 2.0, 11);
    } else if (kind === 'street') {
      // front doors along both walls, with house numbers and little lamps
      for (let i = 0; i < 4; i++) for (const sz of [-1, 1]) {
        const ad = a0 + 2 + i * 3.6 + (sz > 0 ? 1.6 : 0);
        place(ad, sz * (hw - 0.02), 0, () => {
          b.box(1.0, 2.1, 0.08, (i + (sz > 0 ? 1 : 0)) % 2 ? 'doorPaint' : 'doorPaint2', [0, 1.05, 0], null, 0.02);
          b.box(1.16, 2.22, 0.04, 'brass', [0, 1.1, sz * 0.03], null, 0.01);
          b.sphere(0.035, 'gold', [0.36, 1.0, -sz * 0.06], 8);
          b.box(0.2, 0.26, 0.05, 'lampWarm', [0.75, 1.7, -sz * 0.04], null, 0.02);
          b.box(0.28, 0.16, 0.02, 'sign', [0, 2.4, -sz * 0.03], null, 0.01);
        });
      }
      // planters down the middle
      for (const ad of [a0 + 4.5, a0 + 10.5]) place(ad, 0, 0, () => {
        b.box(1.4, 0.5, 0.6, 'ceramicDark', [0, 0.25, 0], null, 0.05);
        b.box(1.3, 0.12, 0.5, 'soil', [0, 0.5, 0], null, 0.02);
        for (let j = 0; j < 4; j++) b.sphere(0.25, j % 2 ? 'leaf' : 'leafLight', [-0.45 + j * 0.3, 0.72, (j % 2 - 0.5) * 0.15], 8);
        b.colBox(1.4, 0.5, 0.6, [0, 0.25, 0]);
      });
      lamp(am - 3.5, 0, 3.5, 0xffe4bf, 1.8, 9);
      lamp(am + 3.5, 0, 3.5, 0xffe4bf, 1.8, 9);
    } else if (kind === 'farm') {
      // hydroponic racks under violet grow lights, a walkway between
      for (const sz of [-1, 1]) for (let i = 0; i < 4; i++) {
        const ad = a0 + 2 + i * 3.6;
        place(ad, sz * 1.45, 0, () => {
          for (const y of [0.35, 1.05, 1.75]) {
            b.box(2.6, 0.08, 0.9, 'steel', [0, y, 0], null, 0.01);
            for (let j = 0; j < 8; j++) b.sphere(0.13, j % 3 ? 'leaf' : 'leafLight', [-1.1 + j * 0.31, y + 0.15, (j % 2 - 0.5) * 0.3], 6, [1, 0.7, 1]);
            b.box(2.5, 0.03, 0.12, 'farmLed', [0, y + 0.62, 0], null, 0);
          }
          for (const x of [-1.25, 1.25]) for (const z of [-0.4, 0.4]) b.box(0.04, 2.3, 0.04, 'steel', [x, 1.15, z], null, 0);
          b.colBox(2.6, 2.3, 0.9, [0, 1.15, 0]);
        });
      }
      lamp(am, 0, 3.2, 0xc78cff, 2.0, 10);
    } else if (kind === 'deck') {
      lamp(am, 0, 3.6, 0xdde8ff, 1.6, 10);
    }
    // a section sign over the way on (every section; names in Japanese)
    if (kind !== 'hall') {
      const names = { plaza: ['カフェ広場', 'PLAZA'], park: ['せせらぎ公園', 'PARK'], street: ['居住区', 'RESIDENCES'], deck: ['展望デッキ', 'OBSERVATION'], farm: ['水耕農場', 'HYDROPONICS'] };
      const [jp, en] = names[kind];
      hangSign(a0 + 0.8, 3.6, 1.8, 0.45, signMat(jp, `${en} · ${k + 1}`));
    }
  }
  // ---- colliders: floor, walls, ceiling (ring-local trimeshes) + what the sections added
  const FN = 360;
  b.colMesh(band(RF, 0, Math.PI * 2, -hw, hw, FN, true));
  for (const sz of [-1, 1]) b.colMesh(annulus(RC, RF, 0, Math.PI * 2, sz * hw, FN, -sz));
  b.colMesh(band(RC, 0, Math.PI * 2, -hw, hw, FN, false));

  const group = b.build(M, { castShadow: false, receiveShadow: false });
  for (const s of signs) group.add(s);
  for (const h of halls) group.add(h.button);
  group.name = 'ringInterior';
  const contains = (p) => {
    const r = Math.hypot(p.x, p.y);
    return r > RC - 0.3 && r < RF + 0.3 && Math.abs(p.z) < hw + 0.2;
  };
  return { group, colliders: b.colliders, lamps, contains, halls };
}
