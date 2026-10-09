// Orbital infrastructure: named stations (autopilot destinations, one repair dock) and a
// network of 5G relay base stations on circular orbits, rendered as 3D models up close and
// blinking lights far away.
import * as THREE from 'three';
import { shirasagiCore, buildAkamoExterior } from './akamoBase.js';
import { MU_EARTH, R_EARTH, OMEGA_EARTH, gmst, latLonToUnit, ecefToEci } from '../core/astro.js';
import { Builder, rng } from '../ship/geom.js';
import { assignLayers, LAYER_FAR, LAYER_MID, LAYER_NEAR, setLayersDeep } from '../core/layers.js';
import { elevatorAxis } from './elevator.js';
import { LOBBY, lobbyShellExterior } from './stationLobby.js';
import { PROM, promenadeShellExterior } from './stationPromenade.js';
import { atriumExterior } from './stationAtrium.js';
import { originModel, originAnimate, ORIGIN } from './originStation.js';

/** reference plane defined from the canonical start state (deterministic) */
export function referenceFrame(startTime) {
  const lat = 34.5 * Math.PI / 180, lon = 137.5 * Math.PI / 180;
  const th = gmst(startTime);
  const e1 = ecefToEci(latLonToUnit(lat, lon), th).normalize();
  const north = new THREE.Vector3(0, 1, 0).addScaledVector(e1, -e1.y).normalize();
  const east = new THREE.Vector3(0, 1, 0).cross(e1).normalize();
  const head = 55 * Math.PI / 180;
  const pro = north.multiplyScalar(Math.cos(head)).add(east.multiplyScalar(Math.sin(head))).normalize();
  const h = new THREE.Vector3().crossVectors(e1, pro).normalize();
  const e2 = new THREE.Vector3().crossVectors(h, e1).normalize();
  return { e1, e2, h, t0: startTime };
}

export const STATION_DEFS = [
  // Shirasagi is the orbital port B-29 just left: same orbit, a few kilometres ahead at the start
  { id: 'shirasagi', name: 'シラサギ・ステーション', jp: '白鷺', en: 'SHIRASAGI', alt: 420e3, phase: 0.011, size: 1.0, kind: 'hub' },
  // the Origin International Space Station: 100 km ahead on the same orbit, unmanned, the big
  // supply port (power, propellant, air, water, food, spares); B-29 swings round it wide
  { id: 'origin', name: 'オリジン国際宇宙ステーション', jp: 'オリジン国際宇宙ステーション', en: 'ORIGIN ISS', alt: 420e3, phase: 100e3 / (R_EARTH + 420e3) * 180 / Math.PI, size: 1.0, kind: 'hub', origin: true, berthR: 900, standoff: 1150, supply: true },
  // the space elevator's low station: built around the ribbon at 420 km; it turns with the Earth
  // instead of orbiting, so it is not weightless (about 0.88 g)
  { id: 'mihashira', name: '天の御柱 低軌道ステーション', jp: '天の御柱', en: 'MIHASHIRA', alt: 420e3, size: 1.0, kind: 'hub', tether: true },
  { id: 'nagi', name: 'ナギ中継局', en: 'NAGI RELAY', alt: 515e3, phase: -9, size: 0.7, kind: 'relay' },
  { id: 'kaguya', name: 'カグヤ中継基地', en: 'KAGUYA', alt: 2000e3, phase: 40, size: 1.2, kind: 'relay' },
  // the geostationary port on the same ribbon
  { id: 'amaterasu', name: 'アマテラス静止港', jp: '天照', en: 'AMATERASU GEO', alt: 35786e3, phase: 0, size: 1.6, kind: 'hub', tether: true },
  { id: 'tsukuyomi', name: 'ツクヨミ・ドック（修理基地）', en: 'TSUKUYOMI DOCK', alt: 260000e3, phase: 200, size: 2.2, kind: 'dock' },
];

/**
 * Hub stations are all built to one plan around the grand lobby module: its axis runs along the
 * station's z at LOBBY_AT (station-local, y radial up, -z along the station's motion). B-29 docks
 * with its airlock to the lobby's docking tunnel; its origin then sits at DOCK_AT with the same
 * orientation as the station. Nothing else of the station comes near that parking space.
 */
export const LOBBY_AT = new THREE.Vector3(-24, 0, 0);
// H8's own port on a hub: on top of the forward spine truss (the surface it stands on)
const H8_PORT_HUB = { y: 2.47, z: -50 };

/** H8's docking port: a collar on the surface (y0 its foot), the yellow target ring, two floods */
function h8Collar(b, x, y0, z) {
  b.cyl(1.7, 1.9, 1.4, 'hullOrange', [x, y0 + 0.5, z], null, 18);
  b.torus(1.75, 0.12, 'plasticY', [x, y0 + 1.22, z], [Math.PI / 2, 0, 0], 18);
  for (const s of [-1, 1]) b.box(0.3, 0.12, 3.0, 'plasticY', [x + s * 2.6, y0 + 0.3, z], null, 0);
  for (const s of [-1, 1]) b.cyl(0.3, 0.3, 0.12, 'flood', [x + s * 3.2, y0 + 0.4, z + 2.4], null, 10);
}
export const DOCK_AT = new THREE.Vector3(LOBBY_AT.x - LOBBY.xc, LOBBY_AT.y - LOBBY.yc, LOBBY_AT.z - (LOBBY.z0 + LOBBY.z1) / 2);

// ---------------------------------------------------------------------------- station models
function solarTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#0d1a3a'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
    const gr = g.createLinearGradient(x * 64, y * 32, x * 64 + 64, y * 32 + 32);
    gr.addColorStop(0, '#1a2f63'); gr.addColorStop(1, '#0e1d45');
    g.fillStyle = gr; g.fillRect(x * 64 + 2, y * 32 + 2, 60, 28);
  }
  g.strokeStyle = 'rgba(200,210,230,0.55)'; g.lineWidth = 1;
  for (let i = 0; i <= 256; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function stationMaterials() {
  const solar = solarTexture();
  solar.repeat.set(3, 10);
  return {
    solarPanel: new THREE.MeshStandardMaterial({ map: solar, roughness: 0.3, metalness: 0.6, color: 0xffffff }),
    windowLit: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(1.0, 0.8, 0.52), emissiveIntensity: 4.0, roughness: 0.3 }),
    strobe: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 }),
    navR: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 0.08, 0.04), emissiveIntensity: 6 }),
    navG: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.1, 1, 0.25), emissiveIntensity: 6 }),
    flood: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.95, 0.97, 1), emissiveIntensity: 5 }),
    dish: new THREE.MeshStandardMaterial({ color: 0xeceee8, roughness: 0.55, metalness: 0.1 }),
    radiatorPanel: new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.42, metalness: 0.05 }),
    dome: new THREE.MeshPhysicalMaterial({ color: 0xcfe6ff, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.22, depthWrite: false, clearcoat: 1, side: THREE.DoubleSide }),
    garden: new THREE.MeshStandardMaterial({ color: 0x1d4a22, emissive: new THREE.Color(0.18, 0.55, 0.22), emissiveIntensity: 1.1, roughness: 0.8 }),
    gardenLamp: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.0, 0.86, 0.6), emissiveIntensity: 3.0 }),
    lobbyGlow: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(1.0, 0.78, 0.5), emissiveIntensity: 2.6, roughness: 0.2 }),
    cyanGlow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.35, 0.8, 1.0), emissiveIntensity: 2.4 }),
    whitePanel: new THREE.MeshStandardMaterial({ color: 0xf4f5f2, roughness: 0.45, metalness: 0.08 }),
    // the Origin's own: lit window panes, its blue, the farm's grow light, the storage rings,
    // the partners' emblems
    originWin: new THREE.MeshStandardMaterial({ color: 0x0c1622, emissive: new THREE.Color(0.95, 0.85, 0.65), emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.3 }),
    originBlue: new THREE.MeshStandardMaterial({ color: 0x2d5c99, roughness: 0.5, metalness: 0.2 }),
    growGlow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.55, 1.0, 0.45), emissiveIntensity: 2.2 }),
    energyGlow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.3, 0.75, 1.0), emissiveIntensity: 4.0 }),
    ...Object.fromEntries([0xd8392b, 0xf2f2f2, 0x2a5fb0, 0x2f9a4a, 0xf0c020, 0x8a3fb8].map((c, i) => ['emblem' + i, new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.1 })])),
  };
}

function nameSignMaterial(def) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#05070a'; g.fillRect(0, 0, 2048, 512);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#f2f6ff';
  g.font = '200 230px "Helvetica Neue", Helvetica, Arial, sans-serif';
  g.fillText((def.en || '').split(' ')[0], 1024, 210);
  g.fillStyle = '#ffd38a';
  g.font = '500 110px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';
  g.fillText(def.jp || def.name || '', 1024, 420);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ color: 0x000000, map: t, emissiveMap: t, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 2.2 });
}

/** square lattice truss along local z (length L, width w), centred at the builder origin */
function truss(b, L, w, t = 0.25, key = 'metal', keyD = 'metalDark') {
  const bays = Math.max(1, Math.round(L / w));
  const bl = L / bays;
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(t, t, L, key, [x * w / 2, y * w / 2, 0], null, 0);
  for (let k = 0; k <= bays; k++) {
    const z = -L / 2 + k * bl;
    b.box(w, t * 0.8, t * 0.8, keyD, [0, w / 2, z], null, 0); b.box(w, t * 0.8, t * 0.8, keyD, [0, -w / 2, z], null, 0);
    b.box(t * 0.8, w, t * 0.8, keyD, [w / 2, 0, z], null, 0); b.box(t * 0.8, w, t * 0.8, keyD, [-w / 2, 0, z], null, 0);
  }
  const dl = Math.hypot(w, bl), ang = Math.atan2(w, bl);
  for (let k = 0; k < bays; k++) {
    const z = -L / 2 + (k + 0.5) * bl, sg = k % 2 ? 1 : -1;
    b.box(t * 0.6, t * 0.6, dl, keyD, [0, w / 2, z], [0, sg * ang, 0], 0);
    b.box(t * 0.6, t * 0.6, dl, keyD, [0, -w / 2, z], [0, -sg * ang, 0], 0);
    b.box(t * 0.6, t * 0.6, dl, keyD, [w / 2, 0, z], [sg * ang, 0, 0], 0);
    b.box(t * 0.6, t * 0.6, dl, keyD, [-w / 2, 0, z], [-sg * ang, 0, 0], 0);
  }
}

/** pressurised module along local z: cylinder with domed ends, insulation bands and lit windows */
function module(b, r, L, key = 'hull', windows = 8) {
  b.cyl(r, r, L, key, [0, 0, 0], [Math.PI / 2, 0, 0], 36);
  b.sphere(r, key, [0, 0, -L / 2], 36, [1, 1, 0.45]);
  b.sphere(r, key, [0, 0, L / 2], 36, [1, 1, 0.45]);
  for (const z of [-L / 2 + 0.6, L / 2 - 0.6]) b.torus(r + 0.04, 0.12, 'gold', [0, 0, z], [0, 0, 0], 36);
  for (let k = 0; k < windows; k++) {
    const z = -L / 2 + 1.5 + (L - 3) * ((k + 0.5) / windows);
    for (const a of [Math.PI * 0.32, Math.PI * 0.68]) b.box(0.55, 0.12, 0.38, 'windowLit', [Math.cos(a) * (r + 0.02), Math.sin(a) * (r + 0.02), z], [0, 0, a - Math.PI / 2], 0.02);
  }
}

function solarWing(b, len, wid, side) {
  b.cyl(0.35, 0.35, 6, 'metal', [side * 3, 0, 0], [0, 0, Math.PI / 2], 10);
  b.box(len, 0.12, wid, 'solarPanel', [side * (6 + len / 2), 0, 0], null, 0);
  b.box(len, 0.2, 0.25, 'metalDark', [side * (6 + len / 2), 0, 0], null, 0);
  for (let k = 0; k <= 4; k++) b.box(0.18, 0.18, wid, 'metalDark', [side * (6 + len * k / 4), 0, 0], null, 0);
}

function dish(b, r, pos, rot) {
  const pts = [];
  for (let i = 0; i <= 12; i++) { const x = r * i / 12; pts.push(new THREE.Vector2(Math.max(0.001, x), (x * x) / (4 * r * 0.6))); }
  b.push(pos, rot);
  b.add(new THREE.LatheGeometry(pts, 32), 'dish');
  b.cyl(0.08, 0.08, r * 0.7, 'metal', [0, r * 0.35, 0], null, 8);
  b.sphere(0.25, 'metalDark', [0, r * 0.7, 0], 10);
  b.pop();
}

function stationModel(def, M) {
  const b = new Builder();
  const s = def.size;
  const strobes = [];
  b.push([0, 0, 0], [0, 0, 0], [s, s, s]);
  const hub = def.kind !== 'relay';
  const spineL = hub ? 150 : 80;
  // spine truss through everything
  truss(b, spineL, 4.2, 0.28);
  // core module cluster around the middle
  b.push([0, 0, 4]); module(b, 3.4, 26, 'hull', 10); b.pop();
  for (const [ax, ay, k] of [[1, 0, 'hull'], [-1, 0, 'hullDark'], [0, 1, 'hull'], [0, -1, 'hull']]) {
    const rot = ax ? [0, ax * Math.PI / 2, 0] : [ay > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0];
    b.push([ax * 10.5, ay * 10.5, 6], rot);
    module(b, 2.4, 13, k, 5);
    b.cyl(1.25, 1.25, 2.2, 'hullOrange', [0, 0, 7.6], [Math.PI / 2, 0, 0], 24);
    b.torus(1.3, 0.1, 'navR', [0, 0, 8.7], [0, 0, 0], 24);
    b.pop();
  }
  b.sphere(3.6, 'hull', [0, 0, -12], 32);
  b.sphere(3.0, 'hullDark', [0, 0, 20], 32);
  // radiators and antennas
  for (const sy of [-1, 1]) b.box(0.22, 24, 8, 'radiatorPanel', [0, sy * 16, 26], null, 0);
  for (const sy of [-1, 1]) b.box(0.6, 6, 0.6, 'metal', [0, sy * 4, 26], null, 0);
  dish(b, 4.2, [7, 6, 40], [0, 0, -0.6]);
  dish(b, 2.6, [-6, 5, 44], [0.3, 0, 0.7]);
  // 5G relay array (this network is what the whole station is about)
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2;
    b.box(3.2, 4.4, 0.25, 'hullDark', [Math.cos(a) * 6.5, Math.sin(a) * 6.5, spineL / 2 - 6], [0, 0, a + Math.PI / 2], 0.05);
  }
  // solar wings at both ends of the spine
  for (const z of [spineL / 2 - 16, -spineL / 2 + 14]) for (const side of [-1, 1]) { b.push([0, 0, z]); solarWing(b, hub ? 44 : 26, hub ? 12 : 9, side); b.pop(); }
  // a docked shuttle on the top port
  b.cyl(1.6, 1.6, 7, 'hull', [0, 22.6, 6], null, 24);
  b.cyl(0.45, 1.6, 2.4, 'hull', [0, 27.3, 6], null, 24);
  b.box(7.5, 2.2, 0.15, 'solarPanel', [0, 22.6, 6], null, 0);
  b.sphere(0.25, 'navG', [3.75, 22.6, 6], 8);
  b.sphere(0.25, 'navR', [-3.75, 22.6, 6], 8);
  // floodlights around the docking face and strobes at the extremities
  for (const [x, y] of [[3, 3], [-3, 3], [3, -3], [-3, -3]]) b.cyl(0.35, 0.35, 0.1, 'flood', [x, y, spineL / 2 + 0.1], [Math.PI / 2, 0, 0], 12);
  for (const z of [spineL / 2, -spineL / 2]) for (const [x, y] of [[2.1, 2.1], [-2.1, -2.1]]) { b.sphere(0.45, 'strobe', [x, y, z], 10); strobes.push([x * s, y * s, z * s]); }
  b.sphere(0.4, 'navR', [-2.1, 2.1, spineL / 2], 10);
  b.sphere(0.4, 'navG', [2.1, -2.1, spineL / 2], 10);
  // repair dock: an open gantry frame big enough to swallow a ship
  if (def.kind === 'dock') {
    b.push([0, -22, 10]);
    for (let k = 0; k < 6; k++) b.box(30, 1.4, 1.4, 'plasticY', [0, -8, -25 + k * 10], null, 0.1);
    for (const x of [-15, 15]) b.box(1.4, 18, 52, 'metalDark', [x, 0, 0], null, 0.1);
    for (const x of [-14, 14]) for (let k = 0; k < 5; k++) b.cyl(0.4, 0.4, 0.15, 'flood', [x * 0.95, 6, -20 + k * 10], [0, 0, Math.PI / 2], 10);
    b.pop();
  }
  b.pop();
  h8Collar(b, 0, 3.4 * s, -5 * s);
  const g = b.build(M, { castShadow: false });
  // rotating habitat ring (hubs and the dock)
  let ring = null;
  if (hub) {
    const rb = new Builder();
    rb.push([0, 0, 0], [0, 0, 0], [s, s, s]);
    rb.torus(46, 3.1, 'hull', [0, 0, 0], [0, 0, 0], 96);
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; rb.cyl(0.9, 0.9, 41, 'hullDark', [Math.cos(a) * 24, Math.sin(a) * 24, 0], [0, 0, a - Math.PI / 2], 12); }
    rb.cyl(4.6, 4.6, 7, 'hull', [0, 0, 0], [Math.PI / 2, 0, 0], 32);
    for (let k = 0; k < 120; k++) {
      const a = k / 120 * Math.PI * 2;
      rb.box(0.5, 1.2, 0.7, 'windowLit', [Math.cos(a) * 42.85, Math.sin(a) * 42.85, (k % 2 ? 1 : -1) * 0.9], [0, 0, a], 0.05);
    }
    for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.4; rb.sphere(0.5, 'strobe', [Math.cos(a) * 49.3, Math.sin(a) * 49.3, 0], 10); }
    rb.pop();
    ring = rb.build(M, { castShadow: false });
    ring.position.set(0, 0, -36 * s);
    g.add(ring);
  }
  g.userData.ring = ring;
  g.userData.strobes = strobes;
  g.userData.portOffset = new THREE.Vector3(0, 0, (spineL / 2 + 8) * s);
  g.userData.radius = (hub ? 95 : 60) * s;
  return g;
}

/**
 * Hub station (Shirasagi, the elevator stations): a long spine with a big core, the grand lobby
 * module where B-29 docks, a glass garden dome at the bow, a rotating habitat ring at the stern,
 * hotel towers, four solar wings, radiators, lit windows everywhere and the station's name in light.
 * Returns the group; userData has the collision proxies (station-local), the lobby shell (hidden
 * while the viewer is inside the lobby), strobe spots and the rotating ring.
 */
function hubModel(def, M) {
  const b = new Builder();
  const P = [];
  const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const cap = (a, c, r) => P.push({ type: 'capsule', a: V3(a), b: V3(c), r });
  const sph = (c, r) => P.push({ type: 'sphere', c: V3(c), r });
  const box = (c, h) => P.push({ type: 'box', c: V3(c), h: V3(h) });
  const strobes = [];
  const tether = !!def.tether;
  const R = rng(def.id.length * 97 + 13);

  // ---- spine (it ends at the core sphere: inside it is the walkable atrium)
  const coreR = tether ? 10.5 : 8.5;
  for (const sg of [-1, 1]) {
    const za = coreR + 0.3, zb = 115, L = zb - za;
    b.push([0, 0, sg * (za + L / 2)]);
    truss(b, L, 4.6, 0.34);
    b.pop();
  }
  box([0, 0, 0], [2.7, 2.7, 116]);
  // Shirasagi: the pressurised transit tube inside the aft truss, from the core to the ring hub
  if (def.id === 'shirasagi') {
    b.cyl(1.55, 1.55, 38 - coreR, 'hull', [0, 0, (coreR + 38) / 2], [Math.PI / 2, 0, 0], 24, true);
    for (let z = coreR + 3; z < 36; z += 4) b.torus(1.6, 0.08, 'gold', [0, 0, z], [0, 0, 0], 24);
    b.cyl(2.45, 2.45, 3.4, 'hullDark', [0, 0, 38.1], [Math.PI / 2, 0, 0], 32, true);
    b.add(new THREE.RingGeometry(1.55, 2.45, 32), 'hullDark', [0, 0, 36.4], [0, Math.PI, 0]);
  }
  // ---- core: big sphere with window bands, node modules on the spine
  if (def.id === 'shirasagi') shirasagiCore(b, coreR, DOCK_AT);
  else b.sphere(coreR, 'hull', [0, 0, 0], 48);
  for (const y of [-0.35, 0.35]) b.torus(coreR * Math.cos(y) + 0.05, 0.16, 'gold', [0, coreR * Math.sin(y), 0], [Math.PI / 2, 0, 0], 64);
  for (let k = 0; k < (def.id === 'shirasagi' ? 0 : 48); k++) {
    const a = k / 48 * Math.PI * 2;
    for (const y of [-0.15, 0.15]) {
      const rr = coreR * Math.cos(y) + 0.02;
      b.box(0.9, 0.55, 0.16, 'lobbyGlow', [Math.cos(a) * rr, coreR * Math.sin(y), Math.sin(a) * rr], [0, -a + Math.PI / 2, 0], 0.05);
    }
  }
  sph([0, 0, 0], coreR + 0.4);
  for (const z of [-24, 22]) { if (def.id !== 'shirasagi' || z < 0) { b.push([0, 0, z]); module(b, 4.2, 18, 'hull', 8); b.pop(); } cap([0, 0, z - 11], [0, 0, z + 11], 4.6); }
  // ---- elevator terminal: the two ribbons run up through this tower (station y, at x = -+4.2);
  // at both ends a berth deck where the climbers dock (the berth gantries, traversers and
  // bridges are the elevator's own: see elevatorPort.js)
  if (tether) {
    b.cyl(6.6, 6.6, 96, 'hull', [0, 0, 0], null, 48, true);
    for (const sg of [-1, 1]) {
      b.cyl(sg > 0 ? 8.2 : 6.6, sg > 0 ? 6.6 : 8.2, 2.4, 'hull', [0, sg * 46.8, 0], null, 56);
      b.cyl(10.2, 10.2, 1.6, 'hullDark', [0, sg * 48.8, 0], null, 64);
      b.torus(10.2, 0.2, 'gold', [0, sg * 49.6, 0], [Math.PI / 2, 0, 0], 64);
      b.torus(10.2, 0.2, 'hullOrange', [0, sg * 48.0, 0], [Math.PI / 2, 0, 0], 64);
      for (const lx of [-4.2, 4.2]) {
        b.torus(1.25, 0.22, 'hullOrange', [lx, sg * 49.75, 0], [Math.PI / 2, 0, 0], 32);
        for (const sz of [-1, 1]) b.box(2.2, 0.6, 0.6, 'metalDark', [lx, sg * 50.0, sz * 0.62], null, 0.05);
      }
      // deck lights round the rim
      for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; b.box(0.9, 0.22, 0.12, 'lobbyGlow', [Math.cos(a) * 10.22, sg * 48.8, Math.sin(a) * 10.22], [0, -a + Math.PI / 2, 0], 0.03); }
      P.push({ type: 'cyl', a: new THREE.Vector3(0, sg * 47.9, 0), b: new THREE.Vector3(0, sg * 49.8, 0), r: 10.3 });
      box([0, sg * 63.4, 0], [9.4, 13.9, 8.0]);
    }
    for (let y = -44; y <= 44; y += 8) b.torus(6.7, 0.14, 'gold', [0, y, 0], [Math.PI / 2, 0, 0], 64);
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; for (let y = -40; y <= 40; y += 8) b.box(0.6, 3.2, 0.14, 'lobbyGlow', [Math.cos(a) * 6.66, y, Math.sin(a) * 6.66], [0, -a + Math.PI / 2, 0], 0.04); }
    cap([0, -48, 0], [0, 48, 0], 7.2);
  }
  // ---- the grand lobby (B-29's berth) and the service tube to the core under its floor
  const L = LOBBY_AT;
  const shell = new Builder();
  lobbyShellExterior(shell, L.x, L.y, L.z);
  const RO = LOBBY.R + 0.36;
  const shellPt = (th, z) => [L.x + RO * Math.cos(th), L.y + RO * Math.sin(th), L.z + z];
  // warm window glows where the lobby has windows (same angles as inside)
  for (const [z0, z1] of [[-10.9, -6.9], [-6.3, -2.3], [-1.7, 2.3], [2.9, 6.9]]) for (let k = 0; k < 6; k++) {
    const th = (-6 + 34 * (k + 0.5) / 6) * Math.PI / 180;
    shell.box(0.12, RO * 0.095, z1 - z0, 'lobbyGlow', shellPt(th, (z0 + z1) / 2 + 2), [0, 0, th], 0.02);
  }
  for (const [z0, z1] of [[-10.4, -6.8], [-4.4, -0.4], [2.0, 5.6]]) shell.box(3.2, 0.12, z1 - z0, 'lobbyGlow', [L.x, L.y + RO, L.z + (z0 + z1) / 2 + 2], null, 0.02);
  for (const [z0, z1] of [[-10.8, -6.2], [3.0, 7.0]]) for (let k = 0; k < 4; k++) { const th = (151 + 20 * (k + 0.5) / 4) * Math.PI / 180; shell.box(0.12, RO * 0.085, z1 - z0, 'lobbyGlow', shellPt(th, (z0 + z1) / 2 + 2), [0, 0, th], 0.02); }
  // docking collar where B-29's tunnel enters the lobby
  shell.torus(1.45, 0.16, 'hullOrange', [L.x - Math.sqrt(RO * RO - 1.03 * 1.03), L.y - 1.03, L.z + 0.95], [0, Math.PI / 2, 0], 32);
  // the promenade wing behind the lobby (same frame as the lobby: ship-local + DOCK_AT)
  const pe = promenadeShellExterior(shell, PROM.x + DOCK_AT.x, PROM.y + DOCK_AT.y, DOCK_AT.z);
  if (def.id === 'shirasagi') atriumExterior(shell, DOCK_AT);
  const shellGroup = shell.build(M, { castShadow: false });
  P.push({ type: 'cyl', a: new THREE.Vector3(L.x, L.y, L.z - 12.6), b: new THREE.Vector3(L.x, L.y, L.z + 12.6), r: RO + 0.08 });
  P.push({ type: 'cyl', a: new THREE.Vector3(PROM.x + DOCK_AT.x, PROM.y + DOCK_AT.y, pe.za), b: new THREE.Vector3(PROM.x + DOCK_AT.x, PROM.y + DOCK_AT.y, pe.zb + PROM.R), r: pe.Ro + 0.05 });
  {
    // service tube from under the lobby floor to the core (ends at the core's skin)
    const xa = L.x + RO - 0.3, xb = -coreR - 0.05;
    b.cyl(1.6, 1.6, xb - xa, 'hull', [(xa + xb) / 2, L.y - 3.0, L.z], [0, 0, Math.PI / 2], 24);
  }
  b.torus(1.7, 0.12, 'gold', [L.x + RO + 0.6, L.y - 3.0, L.z], [0, Math.PI / 2, 0], 24);
  cap([L.x + RO - 0.5, L.y - 3, L.z], [-coreR + 0.5, L.y - 3, L.z], 1.8);
  // floodlights on the core and the spine light up the lobby module and the parked ship
  for (const [x, y, z] of [[-coreR * 0.7, 4, 6], [-coreR * 0.7, -4, -6], [-3, 3.2, 26], [-3, -3.2, -26]]) b.cyl(0.55, 0.55, 0.14, 'flood', [x, y, z], [0, 0, Math.PI / 2], 14);

  // ---- garden dome at the bow
  const GD = [0, 0, -78];
  b.sphere(14, 'dome', GD, 48);
  b.sphere(12.6, 'garden', [GD[0], GD[1] - 6.5, GD[2]], 40, [1, 0.42, 1]);
  for (let k = 0; k < 7; k++) b.torus(14.02, 0.12, 'metal', GD, [0, k / 7 * Math.PI, 0], 64);
  b.torus(14.05, 0.3, 'gold', GD, [Math.PI / 2, 0, 0], 64);
  for (let k = 0; k < 24; k++) { const a = R() * Math.PI * 2, r = R() * 9; b.sphere(0.35 + R() * 0.3, 'gardenLamp', [GD[0] + Math.cos(a) * r, GD[1] - 1.5 + R() * 2, GD[2] + Math.sin(a) * r], 8); }
  for (let k = 0; k < 30; k++) { const a = R() * Math.PI * 2, r = R() * 10; b.sphere(1.0 + R() * 1.4, 'garden', [GD[0] + Math.cos(a) * r, GD[1] - 2.5 + R() * 2.5, GD[2] + Math.sin(a) * r], 10, [1, 1.4, 1]); }
  b.cyl(3.5, 3.5, 8, 'hullDark', [0, 0, GD[2] + 16], [Math.PI / 2, 0, 0], 32);
  sph(GD, 14.4);

  // ---- habitat ring (turns) at the stern
  // (built into its own group below)

  // ---- hotel towers off the core aft: up, down, starboard (never toward B-29's berth on -x)
  for (const [rot, pos] of [[[-Math.PI / 2, 0, 0], [0, 19, 12]], [[Math.PI / 2, 0, 0], [0, -19, 12]], [[0, Math.PI / 2, 0], [19, 0, 12]]]) {
    b.push(pos, rot);
    module(b, 3.6, 24, 'hull', 10);
    for (let k = 0; k < 10; k++) b.torus(3.66, 0.06, 'gold', [0, 0, -10 + k * 2.2], [0, 0, 0], 40);
    b.pop();
    const dir = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ'));
    const c = new THREE.Vector3(...pos);
    cap(c.clone().addScaledVector(dir, -13).toArray(), c.clone().addScaledVector(dir, 13).toArray(), 4.0);
  }

  // ---- solar wings (four per boom) and radiators
  for (const z of [-104, 104]) {
    b.push([0, 0, z], [0, Math.PI / 2, 0]);
    truss(b, 176, 3.2, 0.26);
    b.pop();
    box([0, 0, z], [88, 1.8, 1.8]);
    for (const side of [-1, 1]) for (const k of [0, 1]) {
      const x = side * (16 + k * 36);
      b.box(32, 0.14, 15, 'solarPanel', [x, 0, z + (k ? 9 : -9)], null, 0);
      b.box(32, 0.24, 0.3, 'metalDark', [x, 0, z + (k ? 9 : -9)], null, 0);
      for (let m = 0; m <= 4; m++) b.box(0.2, 0.2, 15, 'metalDark', [x - 16 + m * 8, 0, z + (k ? 9 : -9)], null, 0);
      box([x, 0, z + (k ? 9 : -9)], [16.2, 0.4, 7.7]);
    }
  }
  for (const sy of [-1, 1]) { b.box(0.25, 26, 12, 'radiatorPanel', [0, sy * 18, 70], null, 0); box([0, sy * 18, 70], [0.6, 13.2, 6.2]); }
  // ---- H8's port on the forward truss
  h8Collar(b, 0, H8_PORT_HUB.y, H8_PORT_HUB.z);
  // ---- antennas, dishes, docked visitor, nav lights, strobes
  dish(b, 5.0, [6, 7, -100], [0, 0, -0.6]);
  dish(b, 3.0, [-6, 6, -96], [0.3, 0, 0.7]);
  box([0, 6, -98], [9, 5, 5]);
  if (def.id !== 'shirasagi') {      // (Shirasagi's stands on AKAMO's berth drum instead)
    b.cyl(1.6, 1.6, 7, 'hull', [0, coreR + 4.2, -6], null, 24);
    b.cyl(0.45, 1.6, 2.4, 'hull', [0, coreR + 8.9, -6], null, 24);
    b.box(7.5, 2.2, 0.15, 'solarPanel', [0, coreR + 4.2, -6], null, 0);
    cap([0, coreR, -6], [0, coreR + 10, -6], 2.2);
  }
  for (const z of [115, -115]) for (const [x, y] of [[2.4, 2.4], [-2.4, -2.4]]) { b.sphere(0.5, 'strobe', [x, y, z], 10); strobes.push([x, y, z]); }
  b.sphere(0.45, 'navR', [-2.4, 2.4, 115], 10);
  b.sphere(0.45, 'navG', [2.4, -2.4, 115], 10);
  // the name in light, on the core facing B-29's berth and facing the bow
  const sign = nameSignMaterial(def);
  b.push([-coreR - 0.3, coreR * 0.55, 0], [0, -Math.PI / 2, 0]);
  b.add(new THREE.PlaneGeometry(16, 4), 'nameSign');
  b.pop();
  b.push([0, coreR * 0.55, -coreR - 0.3], [0, Math.PI, 0]);
  b.add(new THREE.PlaneGeometry(16, 4), 'nameSign');
  b.pop();
  const g = b.build(Object.assign({}, M, { nameSign: sign }), { castShadow: false });
  g.add(shellGroup);
  // Shirasagi: AKAMO's tower and berth drum, and the station grown round it (akamoBase.js)
  if (def.id === 'shirasagi') {
    const ak = buildAkamoExterior(M, DOCK_AT, { cap, sph, box });
    g.add(ak.group);
    g.userData.ring2 = ak.ring2;
    g.userData.akBand = ak.band;
  }
  // ---- rotating habitat ring
  const rb = new Builder();
  rb.torus(58, 3.6, 'hull', [0, 0, 0], [0, 0, 0], 128);
  rb.torus(58, 3.7, 'gold', [0, 0, 2.2], [0, 0, 0], 128);
  rb.torus(58, 3.7, 'gold', [0, 0, -2.2], [0, 0, 0], 128);
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; rb.cyl(1.0, 1.0, 50, 'hullDark', [Math.cos(a) * 29, Math.sin(a) * 29, 0], [0, 0, a - Math.PI / 2], 12); }
  rb.cyl(5.2, 5.2, 8, 'hull', [0, 0, 0], [Math.PI / 2, 0, 0], 32);
  for (let k = 0; k < 180; k++) {
    const a = k / 180 * Math.PI * 2;
    rb.box(0.6, 1.4, 0.8, 'windowLit', [Math.cos(a) * 54.35, Math.sin(a) * 54.35, (k % 2 ? 1 : -1) * 1.0], [0, 0, a], 0.05);
  }
  for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.4; rb.sphere(0.5, 'strobe', [Math.cos(a) * 61.8, Math.sin(a) * 61.8, 0], 10); }
  const ring = rb.build(M, { castShadow: false });
  ring.position.set(0, 0, 44);
  g.add(ring);
  for (let k = 0; k < 28; k++) { const a = k / 28 * Math.PI * 2; sph([Math.cos(a) * 58, Math.sin(a) * 58, 44], 4.3); }
  g.userData.ring = ring;
  g.userData.strobes = strobes;
  g.userData.radius = def.id === 'shirasagi' ? 240 : 150;
  g.userData.proxies = P;
  g.userData.lobbyShell = shellGroup;
  g.userData.hub = true;
  return g;
}

function relayModel(M) {
  const b = new Builder();
  b.box(1.6, 1.6, 2.4, 'mli', [0, 0, 0], null, 0.08);
  b.box(6, 0.06, 1.6, 'solar', [-4.2, 0, 0], null, 0.01);
  b.box(6, 0.06, 1.6, 'solar', [4.2, 0, 0], null, 0.01);
  b.box(1.1, 1.1, 0.12, 'hullDark', [0, 0, -1.3], null, 0.02); // 5G panel array
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) b.box(0.28, 0.28, 0.04, 'metal', [-0.35 + i * 0.35, -0.35 + j * 0.35, -1.38], null, 0.01);
  b.cyl(0.03, 0.03, 1.4, 'metal', [0, 1.4, 0], null, 6);
  return b;
}

export class Stations {
  constructor(engine, shipM, startTime) {
    this.ref = referenceFrame(startTime);
    this.scene = engine.scene;
    this.engine = engine;
    // plain copies of the ship materials (no ship-space dents / window cut-outs)
    const M = {};
    for (const [k, m] of Object.entries(shipM)) M[k] = m.userData && m.userData.shipPatched ? m.clone() : m;
    this.SM = stationMaterials();
    Object.assign(M, this.SM);
    this.M = M;
    this.list = STATION_DEFS.map((d) => {
      const r = R_EARTH + d.alt;
      return { ...d, r, n: Math.sqrt(MU_EARTH / (r * r * r)), phi0: d.phase * Math.PI / 180, pos: new THREE.Vector3(), vel: new THREE.Vector3(), model: null };
    });
    // every station gets its own copies of the light materials, so a damaged one can go dark
    const LIGHTS = ['windowLit', 'lobbyGlow', 'cyanGlow', 'garden', 'gardenLamp', 'flood', 'strobe', 'navR', 'navG', 'originWin', 'growGlow', 'energyGlow'];
    for (const s of this.list) {
      s.model = s.origin ? originModel(s, Object.assign({}, M, { originSign: nameSignMaterial(s) }), DOCK_AT) : s.kind === 'hub' ? hubModel(s, M) : stationModel(s, M);
      s.model.matrixAutoUpdate = false;
      s.model.visible = false;
      s.lm = {};
      s.model.traverse((o) => {
        if (!o.isMesh) return;
        for (const k of LIGHTS) if (o.material === this.SM[k]) {
          if (!s.lm[k]) { s.lm[k] = this.SM[k].clone(); s.lm[k].userData.base = this.SM[k].emissiveIntensity; }
          o.material = s.lm[k];
        }
      });
      setLayersDeep(s.model, LAYER_MID);
      this.scene.add(s.model);
    }
    // relay network (5G base stations)
    this.relays = [];
    const shells = [[420e3, 1.6, 0], [395e3, 3, 0.3], [455e3, 3, -0.4], [520e3, 3, 0.8], [640e3, 4, -1.1], [800e3, 5, 1.6], [1100e3, 6, -2.2], [1600e3, 8, 2.8], [3000e3, 10, 0], [8000e3, 15, 0], [20200e3, 20, 0], [35786e3, 18, 0], [100000e3, 30, 0], [200000e3, 45, 0], [380000e3, 60, 0]];
    let seed = 1;
    for (const [alt, spacing, incl] of shells) {
      const r = R_EARTH + alt;
      const n = Math.sqrt(MU_EARTH / (r * r * r));
      const cnt = Math.floor(360 / spacing);
      for (let k = 0; k < cnt; k++) {
        seed = (seed * 16807) % 2147483647;
        this.relays.push({ r, n, phi0: (k * spacing + (seed % 1000) / 1000 * spacing * 0.3) * Math.PI / 180, incl: incl * Math.PI / 180, blink: (seed % 997) / 997, pos: new THREE.Vector3() });
      }
    }
    // far lights: points
    const N = this.relays.length;
    const pg = new THREE.BufferGeometry();
    this.relayPos = new Float32Array(N * 3);
    this.relayPh = new Float32Array(N);
    this.relays.forEach((r, i) => { this.relayPh[i] = r.blink; });
    pg.setAttribute('position', new THREE.BufferAttribute(this.relayPos, 3));
    pg.setAttribute('phase', new THREE.BufferAttribute(this.relayPh, 1));
    this.lightsMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
      vertexShader: /* glsl */`
        attribute float phase; uniform float uTime; uniform float uScale; varying float vB; varying float vRed;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = length(mv.xyz);
          float blink = step(0.86, fract(uTime * 0.5 + phase));
          vRed = step(0.5, fract(phase * 7.0));
          vB = (0.25 + 2.5 * blink) * clamp(3.0e5 / d, 0.05, 1.0);
          gl_PointSize = (1.5 + 2.5 * blink) * uScale;
        }`,
      fragmentShader: /* glsl */`
        varying float vB; varying float vRed;
        void main(){
          vec2 p = gl_PointCoord * 2.0 - 1.0; float g = exp(-dot(p,p) * 3.0);
          vec3 c = mix(vec3(0.75, 0.9, 1.0), vec3(1.0, 0.25, 0.15), vRed);
          gl_FragColor = vec4(c * vB * g * 4.0, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.lights = new THREE.Points(pg, this.lightsMat);
    this.lights.frustumCulled = false;
    this.lights.matrixAutoUpdate = false;
    this.lights.layers.set(LAYER_FAR);
    this.lights.layers.enable(LAYER_MID);
    this.scene.add(this.lights);
    // station beacons: visible from far away as a strobing white light and a warm window glow,
    // so the stations can be found in the sky long before their structure resolves
    const SN = this.list.length * 2;
    const sg = new THREE.BufferGeometry();
    this.stPos = new Float32Array(SN * 3);
    const stCol = new Float32Array(SN * 3), stKind = new Float32Array(SN);
    for (let i = 0; i < this.list.length; i++) {
      stCol.set([1, 1, 1], i * 6); stKind[i * 2] = 1;
      stCol.set([1, 0.78, 0.5], i * 6 + 3); stKind[i * 2 + 1] = 0;
    }
    sg.setAttribute('position', new THREE.BufferAttribute(this.stPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(stCol, 3));
    sg.setAttribute('kind', new THREE.BufferAttribute(stKind, 1));
    this.stLightsMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
      vertexShader: /* glsl */`
        attribute vec3 color; attribute float kind; uniform float uTime; uniform float uScale;
        varying vec3 vC; varying float vA;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = length(mv.xyz);
          float t = fract(uTime / 1.6);
          float flash = kind > 0.5 ? max(step(t, 0.05), step(0.16, t) * step(t, 0.21)) : 1.0;
          float fadeNear = smoothstep(1500.0, 6000.0, d);      // close up the model's own lamps take over
          vA = flash * fadeNear * (kind > 0.5 ? 1.6 : 0.6) * clamp(4.0e6 / d, 0.12, 1.0);
          gl_PointSize = (kind > 0.5 ? 2.0 + 4.0 * flash : 2.4) * uScale * clamp(2.0e5 / d, 0.6, 1.6);
          vC = color;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC; varying float vA;
        void main(){
          vec2 p = gl_PointCoord * 2.0 - 1.0; float g = exp(-dot(p, p) * 3.0);
          gl_FragColor = vec4(vC * vA * g * 5.0, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.stLights = new THREE.Points(sg, this.stLightsMat);
    this.stLights.frustumCulled = false;
    this.stLights.matrixAutoUpdate = false;
    this.stLights.layers.set(LAYER_FAR);
    this.stLights.layers.enable(LAYER_MID);
    this.scene.add(this.stLights);
    // near relay models (instanced)
    const rb = relayModel(M);
    const rg = rb.build(M, { castShadow: false });
    this.relayInst = [];
    rg.children.forEach((mesh) => {
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, 24);
      im.count = 0;
      im.frustumCulled = false;
      im.layers.set(LAYER_MID); im.layers.enable(LAYER_NEAR);
      this.scene.add(im);
      this.relayInst.push(im);
    });
    this._m = new THREE.Matrix4();
  }

  /** ECI position / velocity of a named station at time t (ms) */
  posOf(s, t, pos, vel) {
    if (s.tether) {
      elevatorAxis(t, pos).multiplyScalar(s.r);
      if (vel) vel.set(OMEGA_EARTH * pos.z, 0, -OMEGA_EARTH * pos.x);
      return pos;
    }
    return this.orbitPos(s.r, s.n, s.phi0, 0, t, pos, vel);
  }

  /** ECI position/velocity of a body on a circular reference orbit */
  orbitPos(r, n, phi0, incl, t, out, vout) {
    const { e1, e2, h, t0 } = this.ref;
    const phi = phi0 + n * (t - t0) / 1000;
    const c = Math.cos(phi), s = Math.sin(phi);
    // inclined plane: rotate e2 about e1 by incl
    const ci = Math.cos(incl), si = Math.sin(incl);
    const e2x = e2.x * ci + h.x * si, e2y = e2.y * ci + h.y * si, e2z = e2.z * ci + h.z * si;
    out.set((e1.x * c + e2x * s) * r, (e1.y * c + e2y * s) * r, (e1.z * c + e2z * s) * r);
    if (vout) vout.set((-e1.x * s + e2x * c) * r * n, (-e1.y * s + e2y * c) * r * n, (-e1.z * s + e2z * c) * r * n);
    return out;
  }

  update(t, origin, camWorld, dt) {
    const camEci = camWorld.clone().add(origin);
    // a magnified view (H8's zoom) brings them closer: the models show from further away
    const E = this.engine, cam = E && E.camera;
    const zk = cam && E.baseVFov ? Math.tan(cam.fov * Math.PI / 360) / Math.tan(E.baseVFov() * Math.PI / 360) : 1;
    for (const s of this.list) {
      this.posOf(s, t, s.pos, s.vel);
      const rel = s.pos.clone().sub(origin);
      const d = rel.distanceTo(camWorld);
      s.dist = s.pos.distanceTo(origin);
      const vis = d * zk < (this.visRange || 4.0e5) && d < 6.0e6;
      s.model.visible = vis;
      if (vis) {
        // orient: long axis along velocity, up radial
        const q = this.frameOf(s, s.quat || (s.quat = new THREE.Quaternion()));
        s.model.matrix.compose(rel, q, new THREE.Vector3(1, 1, 1));
        s.model.matrixWorld.copy(s.model.matrix);
        const shell = s.model.userData.lobbyShell;
        if (shell) shell.visible = this.shellHiddenFor !== s.id;
        // the Origin: its port's cover while no ship lies in it; its robots at work up close
        const cov = s.model.userData.portCover;
        if (cov) cov.visible = this.dockedId !== s.id;
        if (s.origin && d < 3.0e4) originAnimate(s.model, t);
        // the fine structure only within a few kilometres (through the zoom, further)
        const ud = s.model.userData;
        if (ud.detail) { const near = d * zk < 6000; ud.detail.visible = near; ud.coarse.visible = !near; }
        const ring = s.model.userData.ring;
        // a crippled station's habitat ring spins down
        const ringTarget = !s.dmg || s.dmg.status === 'ok' || s.dmg.status === 'damaged' ? 1 : 0;
        s.ringK = (s.ringK ?? 1) + (ringTarget - (s.ringK ?? 1)) * Math.min(1, dt * 0.05);
        // (about half a g on the deck: 0.28 rad/s at 60 m; the ring B-29 is docked to is turned by
        // the docking, together with its walkable inside)
        if (ring && !s.ringDriven) { ring.rotation.z += dt * 0.28 * s.ringK; ring.updateMatrix(); }
        // (Shirasagi's second ring turns the other way; the AKAMO shaft's outside band gives way to
        // the platform inside while B-29 is docked)
        const ring2 = s.model.userData.ring2;
        if (ring2) { ring2.rotation.z -= dt * 0.28 * s.ringK; ring2.updateMatrix(); }
        if (s.model.userData.akBand) s.model.userData.akBand.visible = this.dockedId !== s.id;
        s.model.updateMatrixWorld(true);
        const R = s.model.userData.radius || 70 * s.size;
        s.model.traverse((o) => { if (o.isMesh) assignLayers(o, Math.max(0, d - R), d + R); });
      }
    }
    // beacons + strobes (double flash every 1.6 s); a wrecked station shows none
    for (let i = 0; i < this.list.length; i++) {
      const st = this.list[i];
      const gone = st.dmg && (st.dmg.status === 'destroyed' || st.dmg.status === 'failed');
      const rel = gone ? new THREE.Vector3(1e15, 0, 0) : st.pos.clone().sub(origin);
      this.stPos.set([rel.x, rel.y, rel.z], i * 6);
      this.stPos.set([rel.x, rel.y + 3, rel.z], i * 6 + 3);
    }
    this.stLights.geometry.attributes.position.needsUpdate = true;
    const tt = (t / 1000) % 10000;
    this.stLightsMat.uniforms.uTime.value = tt;
    const ph = (tt / 1.6) % 1;
    // (kept moderate: at 40x the strobes of the station next door bloomed over the whole view and
    // the picture flickered every 1.6 s)
    const blink = (c) => Math.max(0, 1 - Math.abs(ph - c) / 0.025);
    const strobe = 4 * Math.max(blink(0.025), blink(0.185));
    this.SM.strobe.emissiveIntensity = strobe;
    // per station: lights dim with damage, warning strobes turn red and fast when in danger
    const tsec = t / 1000;
    for (const st of this.list) {
      if (!st.model.visible || !st.lm) continue;
      const D = st.dmg, stt = D ? D.status : 'ok';
      let lk = stt === 'ok' ? 1 : stt === 'damaged' ? 0.6 : stt === 'critical' ? 0.3 : 0;
      if (stt === 'critical' && Math.sin(tsec * 23 + st.r) > 0.6) lk *= 0.2;   // failing circuits stutter
      for (const [k, m] of Object.entries(st.lm)) if (k !== 'strobe') m.emissiveIntensity = m.userData.base * lk;
      const sm = st.lm.strobe;
      if (sm) {
        const danger = stt === 'damaged' || stt === 'critical';
        sm.emissive.setRGB(1, danger ? 0.08 : 1, danger ? 0.04 : 1);
        const fast = ((tsec * 2.2) % 1) < 0.18 ? 6 : 0;
        sm.emissiveIntensity = stt === 'failed' || stt === 'destroyed' ? 0 : danger ? fast : strobe;
      }
    }
    // relays
    let k = 0;
    const near = [];
    const p = new THREE.Vector3();
    const camR = camEci.length();
    for (let i = 0; i < this.relays.length; i++) {
      const r = this.relays[i];
      this.orbitPos(r.r, r.n, r.phi0, r.incl, t, p);
      r.pos.copy(p);
      const rel = p.sub(origin);
      // hide those behind the Earth
      this.relayPos[k * 3] = rel.x; this.relayPos[k * 3 + 1] = rel.y; this.relayPos[k * 3 + 2] = rel.z;
      const d = rel.distanceTo(camWorld);
      if (d < 3.0e4) near.push({ rel: rel.clone(), d, r });
      k++;
    }
    this.lights.geometry.attributes.position.needsUpdate = true;
    this.lightsMat.uniforms.uTime.value = (t / 1000) % 10000;
    this.nearRelays = near;
    // instanced models for the closest relays
    near.sort((a, b) => a.d - b.d);
    const cnt = Math.min(24, near.length);
    for (const im of this.relayInst) im.count = cnt;
    for (let i = 0; i < cnt; i++) {
      const n = near[i];
      const up = n.r.pos.clone().normalize();
      this._m.lookAt(new THREE.Vector3(), up, new THREE.Vector3(0, 1, 0));
      this._m.setPosition(n.rel);
      for (const im of this.relayInst) im.setMatrixAt(i, this._m);
    }
    for (const im of this.relayInst) im.instanceMatrix.needsUpdate = true;
  }

  setPixelScale(pr) {
    this.lightsMat.uniforms.uScale.value = pr;
    this.stLightsMat.uniforms.uScale.value = pr;
  }

  byId(id) { return this.list.find((s) => s.id === id); }

  /**
   * Where H8's origin sits when it lies at a station's own H8 port (station-local, upright in the
   * station's frame): the port's collar stands on the hub's forward truss, on the core module of a
   * relay or the dock, on the Origin's spine; H8's mating ring is 4.3 m under its origin.
   */
  h8PortOf(s) {
    if (s.h8Port) return s.h8Port;
    if (s.origin) s.h8Port = ORIGIN.h8Port.clone();
    else if (s.kind === 'hub') s.h8Port = new THREE.Vector3(0, H8_PORT_HUB.y + 1.2 + 4.3, H8_PORT_HUB.z);
    else s.h8Port = new THREE.Vector3(0, 3.4 * s.size + 1.2 + 4.3, -5 * s.size);
    return s.h8Port;
  }

  /** station orientation (ECI): y radial up, -z along its motion, x = y cross z */
  frameOf(s, out = new THREE.Quaternion()) {
    const up = s.pos.clone().normalize();
    const z = s.vel.clone().addScaledVector(up, -s.vel.dot(up)).normalize().negate();
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z));
  }

  /** nearest relay distance (for 5G signal) */
  nearestRelay(shipPos) {
    let best = Infinity;
    for (const r of this.relays) { const d = r.pos.distanceTo(shipPos); if (d < best) best = d; }
    return best;
  }
}
