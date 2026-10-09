// Life aboard Shirasagi while B-29 is docked (ship-local, in the lobby's group): its crew walking
// their rounds through the lobby, the promenade, the skybridge, the core and AKAMO's platform, and
// the escape pod hatches they run for when the station is in trouble. Each hatch is a pod's door:
// a round plug door with a window, a status ring (green: ready; amber: boarding; red: gone), its
// number; open, the pod's lit cabin is seen inside. Once its people are in it shuts, the pod goes
// with a thud through the deck, and the station's pods are away (escapePods.js).
import * as THREE from 'three';
import { StationCrew } from './stationCrew.js';
import { AK_SITE, AK_POD_DEG } from './akamoSite.js';
import { LAYER_NEAR } from '../core/layers.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const FONT = '"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif';
const BX = AK_SITE.berth.x, BZ = AK_SITE.berth.z, PF = AK_SITE.berth.y;
const PLAT_HATCH = AK_POD_DEG;

function layout() {
  const n = (id, p, kind = 'path', face) => ({ id, p, kind, face });
  const F = 0.25, A = -2.55;
  const nodes = [
    // ---- the lobby (floor 0.25)
    n('L_tun', [5.6, F, -1.05]), n('L_mid', [9.4, F, -1.2]), n('L_globe', [11.2, F, -1.0], 'post', Math.PI),
    n('L_east', [13.4, F, -1.2]), n('L_br', [16.0, F, 1.3]), n('L_fwd_l', [8.3, F, -5.4]), n('L_fwd_r', [13.7, F, -5.4]), n('L_e2', [12.4, F, 2.6]),
    n('L_sofa', [11.0, F, -5.6], 'post', 0), n('L_fl', [8.25, F, -8.5]), n('L_fr', [13.75, F, -8.5]),
    n('L_window', [11.0, F, -11.45], 'post', 0), n('L_aft', [10.4, F, 4.4]), n('L_dl0', [5.5, F, 4.6]), n('L_dl1', [5.45, F, 7.72]),
    n('L_desk1', [7.2, F, 7.6], 'post', 0), n('L_desk2', [7.95, F, 7.6], 'post', 0), n('L_bay', [7.55, F, 7.78]),
    n('L_prom', [12.5, F, 7.3]), n('L_bar', [15.15, F, 4.9], 'post', Math.PI / 2),
    // ---- the promenade (floor 0.25)
    n('P_door', [13.0, F, 9.2]), n('P_cafe', [12.15, F, 12.45], 'post', Math.PI / 2), n('P_shelf', [14.4, F, 12.6], 'post', -Math.PI / 2),
    n('P_mid', [13.9, F, 14.4]), n('P_x', [13.4, F, 15.25]), n('P_a', [11.4, F, 15.3]), n('P_left', [11.4, F, 18.5]),
    n('P_b2', [11.4, F, 22.4]), n('P_b', [13.0, F, 23.6]), n('P_pod1', [10.75, F, 24.2], 'bay'), n('P_pod2', [15.25, F, 24.6], 'bay'),
    n('P_lounge', [13.0, F, 26.9], 'post', Math.PI), n('P_l1', [10.6, F, 27.0]), n('P_l2', [10.55, F, 29.3]), n('P_balc', [12.0, F, 31.2], 'post', Math.PI),
    // ---- the skybridge and the core's atrium (floor -2.55)
    n('B_m', [22.0, F, 1.3], 'post', Math.PI), n('B_r', [27.0, F, 1.3]), n('A_s0', [29.8, F, 3.0]), n('A_foot', [33.6, A, 3.6]),
    n('A_n', [36.0, A, 3.5]), n('A_e', [39.6, A, 1.7], 'post', 0.935), n('A_w', [31.9, A, -1.0]), n('A_s', [34.0, A, -5.2]),
    n('A_lift', [36.5, A, -4.15], 'post', -0.73),
  ];
  const links = [
    ['L_tun', 'L_mid'], ['L_mid', 'L_globe'], ['L_globe', 'L_east'], ['L_east', 'L_br'], ['L_mid', 'L_fwd_l'], ['L_east', 'L_fwd_r'],
    ['L_fwd_l', 'L_sofa'], ['L_sofa', 'L_fwd_r'], ['L_fwd_l', 'L_fl'], ['L_fl', 'L_window'], ['L_fr', 'L_window'], ['L_fwd_r', 'L_fr'],
    ['L_mid', 'L_aft'], ['L_aft', 'L_dl0'], ['L_tun', 'L_dl0'], ['L_dl0', 'L_dl1'], ['L_dl1', 'L_desk1'], ['L_desk1', 'L_desk2'], ['L_desk1', 'L_bay'], ['L_desk2', 'L_bay'],
    ['L_east', 'L_e2'], ['L_e2', 'L_prom'], ['L_aft', 'L_prom'], ['L_br', 'L_bar'], ['L_prom', 'P_door'],
    ['P_door', 'P_cafe'], ['P_door', 'P_shelf'], ['P_door', 'P_mid'], ['P_mid', 'P_x'], ['P_x', 'P_a'], ['P_a', 'P_left'], ['P_left', 'P_b2'],
    ['P_b2', 'P_b'], ['P_b', 'P_pod1'], ['P_b', 'P_pod2'], ['P_b', 'P_lounge'], ['P_lounge', 'P_l1'], ['P_l1', 'P_l2'], ['P_l2', 'P_balc'],
    ['L_br', 'B_m'], ['B_m', 'B_r'], ['B_r', 'A_s0'], ['A_s0', 'A_foot'], ['A_foot', 'A_n'], ['A_n', 'A_e'], ['A_foot', 'A_w'],
    ['A_w', 'A_s'], ['A_s', 'A_lift'], ['A_lift', 'A_e'],
  ];
  // ---- AKAMO's platform (round the berth, floor 48.25): a ring of ways, the gates, the lift's
  // landing, the pod hatches on the wall
  const at = (r, deg, kind, face) => [BX + r * Math.cos(deg * Math.PI / 180), PF, BZ + r * Math.sin(deg * Math.PI / 180)];
  // (the lift's tube stands between K4 and K5: the way goes round by its landing)
  for (let i = 0; i < 12; i++) { nodes.push(n('K' + i, at(9.6, i * 30))); if (i !== 4) links.push(['K' + i, 'K' + ((i + 1) % 12)]); }
  nodes.push(n('K_gA', at(8.3, 0), 'post', Math.PI / 2), n('K_gB', at(8.3, 180), 'post', -Math.PI / 2), n('K_lift', at(9.9, 126.87)));
  links.push(['K0', 'K_gA'], ['K6', 'K_gB'], ['K4', 'K_lift'], ['K_lift', 'K5']);
  for (const deg of PLAT_HATCH) {
    nodes.push(n('K_pod' + deg, at(11.25, deg), 'bay'));
    links.push(['K' + (Math.round(deg / 30) % 12), 'K_pod' + deg]);
  }
  // what stands on the floors (x, z; a body's width is added)
  const c = (x, z, r, y0 = -9, y1 = 99) => ({ c: [x, z], r, y: [y0, y1] }), bx = (x0, x1, z0, z1, y0 = -9, y1 = 99) => ({ box: [x0, x1, z0, z1], y: [y0, y1] });
  const obstacles = [
    // lobby
    bx(8.7, 13.3, -8.4, -6.2, 0, 2), c(11, -9, 0.75, 0, 2), bx(8.6, 9.4, -11.3, -10.5, 0, 2), bx(12.6, 13.4, -11.3, -10.5, 0, 2),
    c(7.4, -10.4, 0.2, 0, 2), c(14.6, -10.4, 0.2, 0, 2), c(11.2, 0.9, 1.0, 0, 2), bx(16.1, 16.7, -10.6, -7.2, 0, 2), bx(16.1, 16.7, -6.0, -2.6, 0, 2),
    bx(16.1, 16.7, 3.2, 6.6, 0, 2), bx(13.7, 14.6, 3.0, 6.8, 0, 2), bx(13.05, 13.45, 3.25, 6.55, 0, 2), bx(5.9, 9.3, 6.0, 6.9, 0, 2),
    c(7.6, -7.4, 0.24, 0, 4), c(7.6, 3.0, 0.24, 0, 4), c(14.4, -7.4, 0.24, 0, 4), c(14.4, 3.0, 0.24, 0, 4),
    c(6.7, -11.0, 0.2, 0, 2), c(15.3, -11.0, 0.2, 0, 2), c(6.5, 7.1, 0.2, 0, 2), c(15.6, 7.0, 0.2, 0, 2), c(6.4, -6.8, 0.2, 0, 2), c(6.4, 3.6, 0.2, 0, 2),
    c(6.3, -4.4, 0.45, 0, 2), c(6.3, 1.6, 0.4, 0, 2), c(15.5, -1.5, 0.5, 0, 2), c(8.6, 7.2, 0.35, 0, 2), c(13.4, 7.2, 0.35, 0, 2),
    // promenade
    bx(10.5, 11.3, 10.4, 14.6, 0, 2), c(11.6, 11.1, 0.2, 0, 2), c(11.6, 12.0, 0.2, 0, 2), c(11.6, 12.9, 0.2, 0, 2), c(11.6, 13.8, 0.2, 0, 2),
    bx(15.15, 15.7, 10.75, 14.45, 0, 3), bx(11.97, 12.77, 14.0, 14.8, 0, 2), bx(12.5, 13.5, 15.8, 17.4, 0, 3), bx(12.5, 13.5, 19.6, 21.2, 0, 3),
    bx(11.95, 12.45, 15.85, 17.35, 0, 2), bx(13.55, 14.05, 15.85, 17.35, 0, 2), bx(11.95, 12.45, 19.65, 21.15, 0, 2), bx(13.55, 14.05, 19.65, 21.15, 0, 2),
    bx(12.76, 13.24, 18.2, 18.8, 0, 2), bx(10.24, 10.86, 16.0, 17.65, 0, 2.5), bx(14.5, 15.35, 16.8, 17.6, 0, 2), bx(14.5, 15.35, 18.8, 19.6, 0, 2),
    c(14.82, 18.2, 0.32, 0, 2), bx(11.0, 11.8, 27.9, 28.7, 0, 2), bx(12.05, 12.85, 27.9, 28.7, 0, 2), bx(13.15, 13.95, 27.9, 28.7, 0, 2),
    bx(14.2, 15.0, 27.9, 28.7, 0, 2), c(15.0, 30.6, 0.35, 0, 2),
    // atrium
    c(35.4, -1.4, 1.4, -3, 0), c(39.31, -1.13, 0.55, -3, 0), c(34.12, 2.31, 0.55, -3, 0), c(30.69, -2.88, 0.55, -3, 0), c(35.88, -6.31, 0.55, -3, 0),
    c(36.97, 1.97, 0.38, -3, 0), c(37.89, 1.37, 0.38, -3, 0), c(31.03, -0.03, 0.38, -3, 0), c(31.63, 0.89, 0.38, -3, 0),
    c(33.03, -5.98, 0.38, -3, 0), c(32.11, -5.36, 0.38, -3, 0), c(AK_SITE.lift.x, AK_SITE.lift.z, 1.75, -3, 60),
  ];
  // the crew: each with a round of places (repeats weight them) and how long they stay at one
  const people = [
    { goals: ['L_desk1', 'L_desk1', 'L_desk1', 'L_desk1', 'L_desk2'], stay: [15, 45] },
    { goals: ['L_desk2', 'L_desk2', 'L_desk2', 'L_desk1', 'L_aft'], stay: [12, 40] },
    { goals: ['L_bar', 'L_bar', 'L_bar', 'L_bar', 'L_east'], stay: [20, 50] },
    { goals: ['L_globe', 'L_sofa', 'L_window', 'L_tun', 'L_prom', 'L_aft'], stay: [6, 16] },
    { goals: ['P_cafe', 'P_shelf', 'P_lounge', 'P_balc', 'P_door', 'P_b'], stay: [6, 18] },
    { goals: ['A_e', 'A_lift', 'A_n', 'A_w', 'B_m', 'A_s'], stay: [6, 16] },
    { goals: ['B_m', 'A_lift', 'A_e', 'L_br', 'P_balc', 'L_bar'], stay: [8, 20] },
    { goals: ['L_tun', 'L_br', 'B_r', 'A_foot', 'L_prom', 'P_b', 'L_window'], stay: [3, 8] },
    { goals: ['K_gA', 'K_gA', 'K_gA', 'K_gB', 'K2', 'K8'], stay: [10, 30] },
    { goals: ['K_gB', 'K_gB', 'K_gB', 'K_gA', 'K_lift', 'K4'], stay: [10, 30] },
  ];
  return { nodes, links, obstacles, people };
}

// ---- the pod hatches
function label(n) {
  const c = document.createElement('canvas'); c.width = 360; c.height = 88;
  const x = c.getContext('2d');
  x.fillStyle = '#10161f'; x.fillRect(0, 0, 360, 88);
  x.fillStyle = '#e8a33a'; x.fillRect(0, 0, 12, 88); x.fillRect(348, 0, 12, 88);
  x.textBaseline = 'middle';
  x.font = `800 34px ${FONT}`; x.fillStyle = '#ffffff'; x.fillText('脱出ポッド ' + n, 26, 32);
  x.font = `600 20px ${FONT}`; x.fillStyle = '#9fb3c8'; x.fillText('ESCAPE POD ' + String(n).padStart(2, '0'), 26, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
}

/** a hatch at p (its middle, on the wall), facing n (into the room); depth: how far its pod's cabin shows */
function buildHatch(M, p, n, num, depth) {
  const g = new THREE.Group();
  g.position.copy(p);
  g.lookAt(p.clone().add(n));
  const mk = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const steel = M.steel || M.akDark, dark = M.akDark || steel;
  mk(new THREE.RingGeometry(0.6, 0.76, 48), dark, 0, 0, 0.004);
  mk(new THREE.TorusGeometry(0.66, 0.055, 10, 48), steel, 0, 0, 0.03);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.2, 1, 0.45), emissiveIntensity: 2.2 });
  mk(new THREE.TorusGeometry(0.75, 0.02, 6, 48), ringMat, 0, 0, 0.02);
  // the pod's cabin behind it (seen when it is open): a short lit tube, a seat back
  const tube = new THREE.CylinderGeometry(0.6, 0.6, depth, 32, 1, true); tube.rotateX(Math.PI / 2);
  const inMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.3, side: THREE.BackSide });
  mk(tube, inMat, 0, 0, -depth / 2);
  const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 0.72, 0.42), emissiveIntensity: 1.6 });
  mk(new THREE.CircleGeometry(0.58, 32), glow, 0, 0, -depth + 0.01);
  mk(new THREE.BoxGeometry(0.7, 0.5, 0.06), new THREE.MeshStandardMaterial({ color: 0xc8682c, roughness: 0.7 }), 0, -0.25, -depth + 0.1);
  // the plug door: swings in on its left edge
  const pivot = new THREE.Group(); pivot.position.set(-0.6, 0, 0.02); g.add(pivot);
  const door = new THREE.CylinderGeometry(0.6, 0.6, 0.09, 40); door.rotateX(Math.PI / 2);
  mk(door, steel, 0.6, 0, 0, pivot);
  mk(new THREE.CircleGeometry(0.17, 24), M.glass || steel, 0.6, 0.18, 0.05, pivot);
  mk(new THREE.TorusGeometry(0.17, 0.025, 6, 24), M.gold || steel, 0.6, 0.18, 0.05, pivot);
  mk(new THREE.BoxGeometry(0.34, 0.05, 0.06), M.gold || steel, 0.6, -0.2, 0.07, pivot);
  const lab = label(num); lab.position.set(0, 0.98, 0.02); g.add(lab);
  g.traverse((o) => o.layers.set(LAYER_NEAR));
  return { group: g, pivot, ringMat, label: lab, k: 0, state: 'ready', t: 0 };
}

export class ShirasagiLife {
  /** M: the lobby's materials; parent: the lobby's group */
  constructor(M, parent) {
    this.L = layout();
    this.crew = new StationCrew(this.L, parent, 7);
    this.hatches = new Map();
    // the promenade's two (on its round walls, port and starboard), the platform's four
    const PR = 3.5, PY = 2.25, PX = 13.0, hy = 0.25 + 1.15;
    const wallX = Math.sqrt(PR * PR - (PY - hy) * (PY - hy));
    const prom = [['P_pod1', V(PX - wallX + 0.02, hy, 24.2), 1], ['P_pod2', V(PX + wallX - 0.02, hy, 24.6), 2]];
    for (const [id, p, num] of prom) {
      const nrm = V(PX - p.x, PY - p.y, 0).normalize();
      this.hatches.set(id, buildHatch(M, p, nrm, num, 0.32));
    }
    PLAT_HATCH.forEach((deg, i) => {
      const a = deg * Math.PI / 180, p = V(BX + 12.38 * Math.cos(a), PF + 1.15, BZ + 12.38 * Math.sin(a));
      this.hatches.set('K_pod' + deg, buildHatch(M, p, V(-Math.cos(a), 0, -Math.sin(a)), 3 + i, 0.85));
    });
    for (const h of this.hatches.values()) parent.add(h.group);
    this.spawned = false;
    this.crisp = false;
    this.launched = false;
  }

  update(dt, g) {
    if (!this.spawned) { this.crew.spawn(); this.spawned = true; }
    if (!this.crisp && g.engine && g.engine.crisp) { for (const h of this.hatches.values()) g.engine.crisp.add(h.label); this.crisp = true; }
    const D = g.docking, st = D && D.station, status = st && st.dmg ? st.dmg.status : 'ok';
    const trouble = status === 'critical' || status === 'failed' || status === 'destroyed' || !!(D && D.air && D.air.breaches && D.air.breaches.length);
    this.crew.alarm(trouble);
    const pl = g.player, alive = pl && pl.state !== 'dead';
    this.crew.update(dt, alive ? pl.pos : null, alive ? pl.eyeLocal : null, (bay) => this.boarded(bay, g), g.gLocal ? g.gLocal.length() : 9.81);
    // the hatches: open while someone runs for them, shut once they are in, the pod away after
    const runningTo = new Set(this.crew.people.filter((P) => !P.gone && P.bay && P.path).map((P) => P.bay));
    for (const [id, h] of this.hatches) {
      if (h.state === 'ready' && trouble && runningTo.has(id)) { h.state = 'boarding'; h.t = 0; }
      if (h.state === 'boarding') {
        h.t += dt;
        // (the last ones in, no one coming any more, or too long: it shuts if anyone is aboard; nobody
        // aboard and the trouble over: it stands ready again)
        if (!runningTo.has(id) || h.t > 40) {
          if (h.aboard > 0) { h.state = 'sealing'; h.t = 0; } else if (!trouble) h.state = 'ready';
        }
      }
      if (h.state === 'sealing') { h.t += dt; if (h.t > 2.5) this.away(h, g); }
      const want = h.state === 'boarding' ? 1 : 0;
      h.k += Math.max(-dt / 0.9, Math.min(dt / 0.9, want - h.k));
      h.pivot.rotation.y = -1.45 * (h.k * h.k * (3 - 2 * h.k));
      const col = h.state === 'gone' ? [1, 0.08, 0.05] : h.state === 'ready' ? (trouble ? [1, 0.6, 0.1] : [0.2, 1, 0.45]) : [1, 0.6, 0.1];
      const blink = h.state === 'boarding' || h.state === 'sealing' ? (Math.sin(g.time * 9) > 0 ? 1 : 0.25) : 1;
      h.ringMat.emissive.setRGB(col[0] * blink, col[1] * blink, col[2] * blink);
    }
  }

  boarded(bay, g) {
    const h = this.hatches.get(bay);
    if (h) { h.aboard = (h.aboard || 0) + 1; if (h.state === 'ready') { h.state = 'boarding'; h.t = 0; } }
    if (g.audio && g.audio.beep) g.audio.beep(660, 0.06, 0.05, { pos: h ? h.group.position : undefined });
  }

  /** a pod goes: its door shut, a thud through the deck; the station's pods are away */
  away(h, g) {
    h.state = 'gone';
    g.shake = Math.max(g.shake || 0, 0.35);
    if (g.audio && g.audio.ready && g.audio._burst) g.audio._burst(null, { dur: 0.9, freq: 55, q: 0.7, gain: 0.3, type: 'brown', filter: 'lowpass', direct: true, attack: 0.01 });
    const st = g.docking && g.docking.station, D = st && st.dmg;
    if (!this.launched && st && g.pods && (!D || !D.podsOut)) {
      this.launched = true;
      if (D) D.podsOut = true;
      g.pods.launch(st, false);
    }
  }
}
