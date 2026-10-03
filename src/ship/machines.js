// Working machines with visible internals: the underfloor lift (twin lead screws, motors,
// folding rails), the coffee machine, the shower, reactor + turbine behind the viewport,
// server LEDs, fans, pumps, O2 electrolysis column, and the EVA suit on its rack.
import * as THREE from 'three';
import { RoundedBoxGeometry, roundedRectShape, roundedRectPath } from './geom.js';
import { LIFT, ENG_HATCH } from './interior.js';
import { DECK_Y, LOWER_Y, Z_REACTOR_BULK } from './hullShape.js';
import { setLayersDeep, LAYER_NEAR } from '../core/layers.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function threadedRod(r, h, pitch, M) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, h, 12), M.steel);
  g.add(core);
  const pts = [];
  const turns = h / pitch;
  for (let i = 0; i <= turns * 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r * 0.85, -h / 2 + (i / 16) * pitch, Math.sin(a) * r * 0.85));
  }
  const thread = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.floor(turns * 16), r * 0.18, 5), M.steel);
  g.add(thread);
  return g;
}

function gear(r, teeth, w, M, key = 'brass') {
  const s = new THREE.Shape();
  for (let i = 0; i <= teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 ? r : r * 0.84;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.holes.push(new THREE.Path().absarc(0, 0, r * 0.2, 0, Math.PI * 2, true));
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  return new THREE.Mesh(g, M[key]);
}

export class Machines {
  constructor(game) {
    this.g = game;
    this.M = game.shipVis.M;
    this.root = new THREE.Group();
    this.root.name = 'machines';
    game.shipVis.root.add(this.root);
    this.anims = [];
    this.shower = { on: false, emitter: null, t: 0 };
    this.coffee = { state: 'idle', t: 0, cupReady: false };
  }

  init() {
    this.buildLift();
    this.buildCoffee();
    this.buildShower();
    this.buildReactor();
    this.buildServers();
    this.buildFans();
    this.buildSuit();
    this.buildEngHatch();
    setLayersDeep(this.root, LAYER_NEAR);
    this.root.traverse((o) => { if (o.isMesh && !o.userData.noShadow) { o.castShadow = true; o.receiveShadow = true; } });
  }

  // ------------------------------------------------------------------ lift
  buildLift() {
    const g = this.g, M = this.M;
    const cx = (LIFT.x0 + LIFT.x1) / 2, cz = (LIFT.z0 + LIFT.z1) / 2;
    const w = LIFT.x1 - LIFT.x0 - 0.04, d = LIFT.z1 - LIFT.z0 - 0.04;
    const lift = { y: DECK_Y, target: DECK_Y, top: DECK_Y, bottom: LOWER_Y, speed: 0.22, moving: false, shaftOpen: 0, rot: 0 };
    const plat = new THREE.Group();
    const plate = new THREE.Mesh(new RoundedBoxGeometry(w, 0.06, d, 2, 0.01), M.floor);
    plate.position.y = -0.03;
    plat.add(plate);
    // hazard rim
    for (const [x, z, ww, dd] of [[0, d / 2 - 0.03, w, 0.06], [0, -d / 2 + 0.03, w, 0.06], [w / 2 - 0.03, 0, 0.06, d], [-w / 2 + 0.03, 0, 0.06, d]]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(ww, 0.008, dd), M.plasticY);
      r.position.set(x, 0.002, z);
      plat.add(r);
    }
    // nut blocks
    for (const [x, z] of [[-w / 2 + 0.05, -d / 2 + 0.05], [w / 2 - 0.05, d / 2 - 0.05]]) {
      const nb = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.12, 0.12, 2, 0.015), M.metalDark);
      nb.position.set(x, -0.08, z);
      plat.add(nb);
    }
    // control post with buttons + beacon
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.0, 10), M.steel);
    post.position.set(w / 2 - 0.08, 0.5, -d / 2 + 0.08);
    const box = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.16, 0.08, 2, 0.015), M.plasticY);
    box.position.set(w / 2 - 0.08, 1.02, -d / 2 + 0.08);
    const bUp = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 12), M.ledGreen); bUp.rotation.x = Math.PI / 2; bUp.position.set(w / 2 - 0.08, 1.06, -d / 2 + 0.125);
    const bDn = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 12), M.ledAmber); bDn.rotation.x = Math.PI / 2; bDn.position.set(w / 2 - 0.08, 0.99, -d / 2 + 0.125);
    const beaconMat = new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: new THREE.Color(1, 0.55, 0.05), emissiveIntensity: 0 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), beaconMat);
    beacon.position.set(w / 2 - 0.08, 1.12, -d / 2 + 0.08);
    plat.add(post, box, bUp, bDn, beacon);
    // folding rails (rise while moving)
    const rails = [];
    for (const [x, z, ry] of [[0, -d / 2 + 0.02, 0], [-w / 2 + 0.02, 0, Math.PI / 2], [0, d / 2 - 0.02, Math.PI]]) {
      const hinge = new THREE.Group();
      hinge.position.set(x, 0.02, z);
      hinge.rotation.y = ry;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, w * 0.9, 8), M.handrail);
      bar.rotation.z = Math.PI / 2;
      bar.position.y = 0.9;
      const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6), M.handrail); s1.position.set(-w * 0.43, 0.45, 0);
      const s2 = s1.clone(); s2.position.x = w * 0.43;
      const fold = new THREE.Group();
      fold.add(bar, s1, s2);
      hinge.add(fold);
      plat.add(hinge);
      rails.push(fold);
    }
    plat.position.set(cx, DECK_Y, cz);
    this.root.add(plat);
    // lead screws + motors (static frame) and guide rails
    const screws = [];
    for (const [x, z] of [[cx - w / 2 + 0.05, cz - d / 2 + 0.05], [cx + w / 2 - 0.05, cz + d / 2 - 0.05]]) {
      const rod = threadedRod(0.025, 2.1, 0.035, M);
      rod.position.set(x, -0.95, z);
      this.root.add(rod);
      screws.push(rod);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 16), M.metalDark);
      motor.position.set(x, -1.98, z);
      this.root.add(motor);
      const cpl = gear(0.06, 14, 0.03, M);
      cpl.rotation.x = Math.PI / 2;
      cpl.position.set(x, -1.86, z);
      this.root.add(cpl);
      screws.push(cpl);
    }
    for (const [x, z] of [[cx + w / 2 - 0.04, cz - d / 2 + 0.04], [cx - w / 2 + 0.04, cz + d / 2 - 0.04]]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.0, 0.04), M.steel);
      rail.position.set(x, -0.95, z);
      this.root.add(rail);
    }
    // deck-level guard gates around the shaft (lowered when the platform is at the top)
    const gates = [];
    for (const [x, z, ry, len] of [[cx, LIFT.z0 - 0.04, 0, w], [cx, LIFT.z1 + 0.04, 0, w], [LIFT.x0 - 0.04, cz, Math.PI / 2, d]]) {
      const hinge = new THREE.Group();
      hinge.position.set(x, DECK_Y, z);
      hinge.rotation.y = ry;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, len, 8), M.plasticY);
      bar.rotation.z = Math.PI / 2; bar.position.y = 0.95;
      const legA = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.95, 6), M.plasticY); legA.position.set(-len / 2, 0.47, 0);
      const legB = legA.clone(); legB.position.x = len / 2;
      const fold = new THREE.Group(); fold.add(bar, legA, legB);
      hinge.add(fold);
      this.root.add(hinge);
      gates.push(fold);
    }
    lift.plat = plat; lift.rails = rails; lift.screws = screws; lift.gates = gates; lift.beacon = beaconMat;
    // kinematic collider for the platform
    lift.col = g.phys.addKinematicBox(w / 2, 0.03, d / 2, V(cx, DECK_Y - 0.03, cz));
    // controls: tap the post, or call points at the top/bottom
    g.interact.addSphere(V(cx + w / 2 - 0.08, 1.0, cz - d / 2 + 0.1), 0.18, () => this.liftGo(), { maxDist: 2.0 });
    g.interact.addSphere(V(LIFT.x0 - 0.15, 1.1, LIFT.z0 - 0.2), 0.15, () => this.liftCall(DECK_Y), { maxDist: 2.0 });
    g.interact.addSphere(V(cx, LOWER_Y + 1.0, LIFT.z0 - 0.15), 0.18, () => this.liftCall(LOWER_Y), { maxDist: 2.0 });
    // call button visuals
    for (const p of [V(LIFT.x0 - 0.15, 1.1, LIFT.z0 - 0.2), V(cx, LOWER_Y + 1.0, LIFT.z0 - 0.15)]) {
      const b = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.12, 0.04, 2, 0.01), M.plasticY);
      b.position.copy(p);
      this.root.add(b);
    }
    this.lift = lift;
    g.lift = lift;
  }

  liftGo() {
    const L = this.lift;
    if (L.moving) return;
    if (this.g.damage && this.g.damage.health.lift < 0.25) { this.g.audio.denied(L.plat.position); return; }
    L.target = L.y > (L.top + L.bottom) / 2 ? L.bottom : L.top;
    L.moving = true;
    this.g.audio.beep(660, 0.1, 0.12, { pos: L.plat.position.clone() });
    this.g.audio.beep(880, 0.1, 0.12, { pos: L.plat.position.clone(), when: 0.15 });
  }

  liftCall(y) {
    const L = this.lift;
    if (Math.abs(L.y - y) < 0.01) return;
    L.target = y; L.moving = true;
    this.g.audio.beep(660, 0.1, 0.12, { pos: L.plat.position.clone() });
  }

  updateLift(dt) {
    const L = this.lift, g = this.g;
    const health = g.damage ? g.damage.health.lift : 1;
    const prevY = L.y;
    // rails fold up before moving, gates
    const railsUp = L.moving || Math.abs(L.y - L.top) > 0.02;
    for (const r of L.rails) r.rotation.x += ((railsUp ? 0 : -Math.PI / 2 + 0.05) - r.rotation.x) * Math.min(1, dt * 4);
    const gateUp = Math.abs(L.y - L.top) > 0.03;
    for (const gt of L.gates) gt.rotation.x += ((gateUp ? 0 : Math.PI / 2 - 0.05) - gt.rotation.x) * Math.min(1, dt * 3);
    if (L.moving) {
      const ready = L.rails.every((r) => Math.abs(r.rotation.x) < 0.1);
      if (ready) {
        const d = L.target - L.y;
        const sp = L.speed * (0.4 + 0.6 * health) * Math.min(1, 0.25 + Math.min(Math.abs(d), Math.abs(L.y - (d > 0 ? L.bottom : L.top))) * 3);
        if (Math.abs(d) < sp * dt) { L.y = L.target; L.moving = false; g.audio.beep(990, 0.12, 0.1, { pos: L.plat.position.clone() }); g.audio.stopLoop('lift'); }
        else { L.y += Math.sign(d) * sp * dt; if (health < 0.5 && Math.random() < dt * 2) L.y -= Math.sign(d) * 0.01; }
        g.audio.humLoop('lift', { pos: L.plat.position.clone(), freq: 95, gain: 0.05 });
        g.audio.setLoopPos('lift', L.plat.position.clone().add(V(0, -1, 0)));
      }
    }
    const dy = L.y - prevY;
    L.plat.position.y = L.y;
    L.rot += dy / 0.035 * Math.PI * 2;
    for (const s of L.screws) s.rotation.y = L.rot;
    L.beacon.emissiveIntensity = L.moving ? (Math.sin(performance.now() / 120) > 0 ? 6 : 0.3) : 0;
    L.shaftOpen = Math.min(1, Math.abs(L.y - L.top) / 0.05);
    L.col.body.setNextKinematicTranslation({ x: L.plat.position.x, y: L.y - 0.03, z: L.plat.position.z });
    L.delta = dy;
  }

  // ------------------------------------------------------------------ coffee machine
  buildCoffee() {
    const g = this.g, M = this.M;
    const p = g.layout.spots.coffee;
    if (!p) return;
    const grp = new THREE.Group();
    grp.position.copy(p);
    // front (spout, window, buttons) is local -z: faces forward into the living room
    // body: rounded back block + front frame with a real opening, so the grinder burr, the
    // heater coil and the brew piston can be watched working through the inspection window
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.36, 0.22, 3, 0.03), M.plasticK);
    body.position.set(0, 0.18, 0.04);
    grp.add(body);
    const face = roundedRectShape(0.32, 0.36, 0.03);
    face.holes.push(roundedRectPath(0.12, 0.14, 0.012, -0.08, 0.04));
    const faceG = new THREE.ExtrudeGeometry(face, { depth: 0.08, bevelEnabled: false, curveSegments: 6 });
    faceG.translate(0, 0.18, -0.15);
    grp.add(new THREE.Mesh(faceG, M.plasticK));
    // little work light inside the cavity
    const cavLight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.004, 0.03), new THREE.MeshStandardMaterial({ color: 0, emissive: new THREE.Color(1, 0.88, 0.7), emissiveIntensity: 1.6 }));
    cavLight.position.set(-0.08, 0.286, -0.1);
    grp.add(cavLight);
    const top = new THREE.Mesh(new RoundedBoxGeometry(0.33, 0.04, 0.31, 2, 0.015), M.steel);
    top.position.y = 0.37;
    grp.add(top);
    // bean hopper (glass) with beans
    const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.12, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, roughness: 0.05 }));
    hop.position.set(0.05, 0.45, 0);
    const beans = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.045, 0.07, 14), new THREE.MeshStandardMaterial({ color: 0x3b2314, roughness: 0.6 }));
    beans.position.set(0.05, 0.43, 0);
    grp.add(hop, beans);
    // inspection window showing the grinder burr, heater coil and piston
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.14), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0.2, depthWrite: false }));
    win.position.set(-0.08, 0.22, -0.151);
    win.rotation.y = Math.PI;
    grp.add(win);
    const burr = gear(0.035, 16, 0.012, M, 'steel');
    burr.position.set(-0.08, 0.26, -0.12);
    grp.add(burr);
    const coilMat = new THREE.MeshStandardMaterial({ color: 0x331100, emissive: new THREE.Color(1, 0.3, 0.05), emissiveIntensity: 0 });
    const coilPts = []; for (let i = 0; i <= 60; i++) { const a = i / 60 * Math.PI * 8; coilPts.push(V(Math.cos(a) * 0.018 - 0.08, 0.16 + i / 60 * 0.05, Math.sin(a) * 0.018 - 0.12)); }
    const coil = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coilPts), 120, 0.003, 4), coilMat);
    grp.add(coil);
    const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 10), M.brass);
    piston.position.set(-0.04, 0.2, -0.12);
    grp.add(piston);
    // spout + drip tray + buttons + tiny display
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.04, 10), M.steel);
    spout.position.set(0.0, 0.1, -0.17);
    const tray = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.02, 0.12, 2, 0.006), M.steel);
    tray.position.set(0, 0.01, -0.2);
    grp.add(spout, tray);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0, emissive: new THREE.Color(0.2, 1, 0.4), emissiveIntensity: 2 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), lampMat);
    lamp.position.set(0.1, 0.3, -0.152);
    grp.add(lamp);
    for (const x of [0.06, 0.1]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 12), M.plasticW); b.rotation.x = Math.PI / 2; b.position.set(x, 0.24, -0.152); grp.add(b); }
    // cup that appears
    const cup = new THREE.Group();
    const mugG = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.036, 0), new THREE.Vector2(0.038, 0.004), new THREE.Vector2(0.039, 0.085), new THREE.Vector2(0.034, 0.085), new THREE.Vector2(0.033, 0.006), new THREE.Vector2(0, 0.006)], 18);
    cup.add(new THREE.Mesh(mugG, M.ceramic));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(0.033, 16), new THREE.MeshStandardMaterial({ color: 0x2a140a, roughness: 0.15 }));
    fill.rotation.x = -Math.PI / 2; fill.position.y = 0.07;
    cup.add(fill);
    const pouch = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.12, 0.03, 3, 0.012), new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.6, roughness: 0.3 }));
    pouch.position.y = 0.06;
    cup.add(pouch);
    cup.position.set(0, 0.02, -0.2);
    cup.visible = false;
    grp.add(cup);
    this.root.add(grp);
    this.coffee = Object.assign(this.coffee, { grp, burr, coilMat, piston, lampMat, cup, fill, pouch, spout });
    g.interact.addSphere(p.clone().add(V(0, 0.18, 0)), 0.22, () => this.coffeeTap(), { maxDist: 2.0 });
  }

  coffeeTap() {
    const c = this.coffee, g = this.g;
    if (c.state === 'ready') { this.takeCup(); return; }
    if (c.state !== 'idle') return;
    if ((g.damage && g.damage.health.coffee < 0.3) || (g.systems.power ?? 1) < 0.3) { g.audio.denied(c.grp.position); g.fx && g.fx.burst('spark', c.grp.position.clone().add(V(0, 0.2, 0)), V(0, 1, 0), 12, { speed: 1.5 }); return; }
    if (g.lifeSupport.water < 0.5) { g.audio.denied(c.grp.position); return; }
    c.state = 'grind'; c.t = 0;
    g.audio.click(c.grp.position);
  }

  takeCup() {
    const c = this.coffee, g = this.g;
    c.state = 'idle';
    c.cup.visible = false;
    g.systems.hold('coffee', { zeroG: g.player.state === 'float', level: 1 });
    g.asphalt.say(g.player.state === 'float' ? 'coffee_zero_g' : 'coffee', {}, { minGap: 600 });
  }

  updateCoffee(dt) {
    const c = this.coffee, g = this.g;
    if (!c.grp) return;
    const pos = c.grp.position.clone();
    c.t += dt;
    if (c.state === 'grind') {
      c.burr.rotation.z += dt * 40;
      g.audio.noiseLoop('grinder', { pos, type: 'white', freq: 2400, q: 1.2, gain: 0.12 });
      if (c.t > 5) { c.state = 'heat'; c.t = 0; g.audio.stopLoop('grinder'); }
    } else if (c.state === 'heat') {
      c.coilMat.emissiveIntensity = Math.min(4, c.t * 1.2);
      g.audio.humLoop('heater', { pos, freq: 120, gain: 0.03 });
      if (c.t > 4) { c.state = 'brew'; c.t = 0; g.audio.stopLoop('heater'); }
    } else if (c.state === 'brew') {
      c.piston.position.y = 0.2 - Math.sin(Math.min(1, c.t / 8) * Math.PI) * 0.025;
      c.cup.visible = true;
      const zeroG = g.player.state === 'float' || g.player.state === 'eva';
      c.pouch.visible = zeroG; c.cup.children[0].visible = !zeroG; c.fill.visible = !zeroG;
      c.fill.position.y = 0.01 + Math.min(1, c.t / 8) * 0.06;
      g.audio.noiseLoop('pump', { pos, type: 'pink', freq: 300, q: 2, gain: 0.08 });
      if (g.fx && !zeroG && Math.random() < 0.8) g.fx.burst('coffee', pos.clone().add(V(0, 0.08, -0.17)), V(0, -1, 0), 2, { speed: 0.3, spread: 0.05, life: 0.15 });
      if (g.fx && Math.random() < dt * 6) g.fx.burst('steam', pos.clone().add(V(0, 0.12, -0.2)), V(0, 1, 0), 1, { speed: 0.15 });
      if (c.t > 8) { c.state = 'ready'; c.t = 0; g.audio.stopLoop('pump'); g.audio.beep(1500, 0.08, 0.1, { pos }); g.audio.beep(1500, 0.08, 0.1, { pos, when: 0.15 }); g.lifeSupport.water -= 0.25; }
    } else {
      c.coilMat.emissiveIntensity *= Math.exp(-dt);
    }
    c.lampMat.emissive.setRGB(c.state === 'idle' ? 0.2 : 1, c.state === 'idle' ? 1 : 0.6, 0.3);
  }

  // ------------------------------------------------------------------ shower
  buildShower() {
    const g = this.g, M = this.M;
    const sc = g.layout.spots.shower;
    if (!sc) return;
    // sliding curved glass door
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xdde8ee, transparent: true, opacity: 0.22, roughness: 0.08, side: THREE.DoubleSide });
    const door = new THREE.Mesh(new THREE.CylinderGeometry(0.49, 0.49, 1.86, 24, 1, true, -Math.PI * 0.42, Math.PI * 0.84), doorMat);
    door.position.set(sc.x, 1.02, sc.z);
    this.root.add(door);
    this.shower.door = door;
    this.shower.pos = sc.clone();
    // the falling water: thin streaks scrolling down a faint cone under the head
    const sprayMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uA: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uT; uniform float uA; varying vec2 vUv;
        float h(float x){ return fract(sin(x * 127.1) * 43758.5453); }
        void main(){
          float k = vUv.x * 110.0, col = floor(k);
          float sp = 0.7 + h(col) * 0.6;
          float y = fract(vUv.y * (1.2 + h(col + 3.0)) + uT * 2.4 * sp + h(col + 7.0));
          float streak = smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(0.05, 0.45, y));
          float edge = smoothstep(0.1, 0.4, fract(k)) * (1.0 - smoothstep(0.6, 0.9, fract(k)));
          float a = streak * edge * uA * (0.3 + 0.7 * vUv.y) * step(0.35, h(col + 11.0));
          gl_FragColor = vec4(vec3(0.78, 0.87, 0.96), a * 0.55);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const spray = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.3, 1.8, 32, 1, true), sprayMat);
    spray.position.set(sc.x, 0.99, sc.z);
    spray.visible = false;
    spray.userData.noShadow = true;
    this.root.add(spray);
    this.shower.spray = spray;
    g.interact.addSphere(V(sc.x - 0.3, 1.1, sc.z), 0.35, () => this.toggleShower(), { maxDist: 2.0 });
  }

  toggleShower() {
    const s = this.shower, g = this.g;
    if (!s.pos) return;
    if (!s.on && g.lifeSupport.water < 2) { g.audio.denied(s.pos); return; }
    s.on = !s.on;
    if (s.on) {
      // drops live about as long as the fall to the tray (the drain's air flow takes them in zero-g)
      s.emitter = g.fx.emitter('water', s.pos.clone().add(V(0, 1.88, 0)), V(0, -1, 0), 120, { speed: 1.4, spread: 0.25, life: 0.12 });
      s.steam = g.fx.emitter('steam', s.pos.clone().add(V(0, 1.2, 0)), V(0, 1, 0), 6, { speed: 0.1, spread: 1 });
      g.asphalt.say(g.player.state === 'float' ? 'shower_zero_g' : 'shower', {}, { minGap: 900 });
    } else {
      g.fx.removeEmitter(s.emitter); g.fx.removeEmitter(s.steam);
      s.emitter = s.steam = null;
      g.audio.stopLoop('shower');
    }
  }

  updateShower(dt) {
    const s = this.shower, g = this.g;
    if (!s.door) return;
    s.door.rotation.y += ((s.on ? 0 : Math.PI * 0.8) - s.door.rotation.y) * Math.min(1, dt * 3);
    // standing under the running water: steam and drops on the eyes (read by the crew effects)
    const pp = g.player.pos;
    const under = s.on && Math.hypot(pp.x - s.pos.x, pp.z - s.pos.z) < 0.5 && pp.y > s.pos.y - 0.2 && pp.y < s.pos.y + 2.1;
    s.wet = (s.wet || 0) + ((under ? 1 : 0) - (s.wet || 0)) * Math.min(1, dt * (under ? 0.8 : 0.35));
    if (s.spray) {
      const u = s.spray.material.uniforms;
      u.uA.value += ((s.on ? 1 : 0) - u.uA.value) * Math.min(1, dt * 4);
      u.uT.value = (u.uT.value + dt) % 1000;
      s.spray.visible = u.uA.value > 0.01;
    }
    if (s.on) {
      g.audio.noiseLoop('shower', { pos: s.pos.clone().add(V(0, 1, 0)), type: 'white', freq: 3500, q: 0.4, gain: 0.12 });
      g.lifeSupport.water = Math.max(0, g.lifeSupport.water - dt * 0.004); // recycled ~90%
      g.lifeSupport.z.bath.T = Math.min(301, g.lifeSupport.z.bath.T + dt * 0.02);
      if (g.lifeSupport.water <= 0) this.toggleShower();
    }
  }

  // ------------------------------------------------------------------ reactor (behind the aft viewport)
  buildReactor() {
    const M = this.M;
    const z0 = Z_REACTOR_BULK + 0.25;
    const grp = new THREE.Group();
    // vessel
    const vessel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.4, 32), M.steel);
    vessel.rotation.x = Math.PI / 2;
    vessel.position.set(0, 0.6, z0 + 1.0);
    grp.add(vessel);
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.2, 0.5, 1.0), emissiveIntensity: 8 });
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 24), glowMat);
    glow.rotation.x = Math.PI / 2;
    glow.position.set(0, 0.6, z0 + 0.29);
    grp.add(glow);
    for (let i = 0; i < 6; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.51, 0.025, 6, 32), M.metalDark); r.position.set(0, 0.6, z0 + 0.4 + i * 0.24); grp.add(r); }
    // control rod drives on top
    const rods = [];
    for (let i = 0; i < 4; i++) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8), M.steel);
      rod.position.set(-0.18 + i * 0.12, 1.25, z0 + 1.0);
      grp.add(rod); rods.push(rod);
    }
    // turbine with blades (spins)
    const turb = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 16), M.steel);
    hub.rotation.z = Math.PI / 2;
    turb.add(hub);
    for (let i = 0; i < 14; i++) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.012), M.brass);
      const a = i / 14 * Math.PI * 2;
      bl.position.set(0, Math.cos(a) * 0.18, Math.sin(a) * 0.18);
      bl.rotation.x = a; bl.rotation.y = 0.5;
      turb.add(bl);
    }
    turb.position.set(0.95, 0.7, z0 + 0.7);
    grp.add(turb);
    const casing = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.03, 8, 24), M.metalDark);
    casing.rotation.y = Math.PI / 2;
    casing.position.copy(turb.position);
    grp.add(casing);
    // pipes from vessel to turbine
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0.4, 0.8, z0 + 0.7), V(0.7, 1.0, z0 + 0.7), V(0.95, 0.95, z0 + 0.7)]), 16, 0.05, 8), M.pipeOrange);
    grp.add(pipe);
    this.root.add(grp);
    this.reactor = { glowMat, turb, rods, light: new THREE.PointLight(0x4d8dff, 1.5, 4, 1.5) };
    this.reactor.light.position.set(0, 0.8, z0 + 0.1);
    this.reactor.light.layers.enableAll();
    grp.add(this.reactor.light);
  }

  // ------------------------------------------------------------------ servers (LEDs + fans)
  buildServers() {
    const g = this.g, M = this.M;
    const spots = g.layout.spots.servers || [];
    const n = spots.length * 12 * 6;
    const geo = new THREE.BoxGeometry(0.008, 0.008, 0.008);
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 3 });
    const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (const s of spots) for (let row = 0; row < 12; row++) for (let i = 0; i < 6; i++) {
      m4.makeTranslation(s.x - 0.012, s.y - 0.7 + row * 0.13, s.z - 0.2 + i * 0.03);
      inst.setMatrixAt(k, m4);
      inst.setColorAt(k, new THREE.Color(0.2, 1, 0.4));
      k++;
    }
    inst.count = k;
    this.root.add(inst);
    this.servers = { inst, n: k, t: 0 };
  }

  buildFans() {
    const g = this.g, M = this.M;
    this.fans = [];
    const mk = (p, ax, r) => {
      const f = new THREE.Group();
      for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(r * 0.9, 0.006, r * 0.35), M.metalDark); b.position.x = r * 0.45; b.rotation.x = 0.4; const h = new THREE.Group(); h.rotation.y = i / 5 * Math.PI * 2; h.add(b); f.add(h); }
      f.position.copy(p);
      if (ax === 'x') f.rotation.z = Math.PI / 2;
      this.root.add(f);
      this.fans.push(f);
    };
    for (const p of g.layout.spots.fans || []) mk(p.clone().add(V(-0.01, 0, 0)), 'x', 0.14);
    for (const p of g.layout.spots.pumps || []) mk(p, 'x', 0.11);
    const U = g.layout.spots.under || {};
    for (const p of U.ahuFans || []) mk(p, 'x', 0.13);
    // reaction wheel: heavy spoked flywheel spinning behind the housing window
    if (U.wheel) {
      const w = new THREE.Group();
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 12, 48), M.steel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 20), M.brass);
      hub.rotation.x = Math.PI / 2;
      w.add(rim, hub);
      for (let k = 0; k < 6; k++) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.025, 0.02), M.metal);
        sp.position.set(Math.cos(k / 6 * Math.PI * 2) * 0.12, Math.sin(k / 6 * Math.PI * 2) * 0.12, 0);
        sp.rotation.z = k / 6 * Math.PI * 2;
        w.add(sp);
      }
      for (let k = 0; k < 3; k++) {   // balance weights make the spin readable
        const bw = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.06), M.plasticR);
        bw.position.set(Math.cos(k / 3 * Math.PI * 2) * 0.2, Math.sin(k / 3 * Math.PI * 2) * 0.2, 0);
        bw.rotation.z = k / 3 * Math.PI * 2;
        w.add(bw);
      }
      const holder = new THREE.Group();
      holder.position.copy(U.wheel);
      holder.rotation.y = Math.PI / 2;      // wheel axis along ship x (faces the window)
      holder.add(w);
      this.root.add(holder);
      this.wheel = w;
    }
    this.under = U;
    // O2 electrolysis column: glass tube + bubbles emitter
    const oc = g.layout.spots.o2col;
    if (oc) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.2, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.25, roughness: 0.05, side: THREE.DoubleSide }));
      tube.position.copy(oc);
      const water = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.1, 18), new THREE.MeshStandardMaterial({ color: 0x3b7fb0, transparent: true, opacity: 0.35, roughness: 0.05, emissive: new THREE.Color(0.05, 0.15, 0.25), emissiveIntensity: 1 }));
      water.position.copy(oc);
      this.root.add(tube, water);
      this.o2col = oc;
    }
  }

  // ------------------------------------------------------------------ EVA suit on its rack
  buildSuit() {
    const g = this.g, M = this.M;
    const p = g.layout.spots.suit;
    if (!p) return;
    // EVA suit hanging on its rack (local front = -z): hard upper torso, bearings at every joint,
    // bellows knees, gloves, boots, life-support backpack with umbilicals, helmet with gold visor
    const suit = new THREE.Group();
    const cloth = M.suit || M.plasticW, hard = M.plasticW, dark = M.plasticK, metal = M.steel;
    const add = (geo, mat, pos, rot, scl) => { const m = new THREE.Mesh(geo, mat); if (pos) m.position.set(...pos); if (rot) m.rotation.set(...rot); if (scl) m.scale.set(...scl); suit.add(m); return m; };
    const limb = (a, b, r, mat) => {
      const A = V(...a), B = V(...b), d = B.clone().sub(A), len = d.length();
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r * 0.4), 6, 14), mat);
      m.position.copy(A).lerp(B, 0.5);
      m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
      suit.add(m);
      return m;
    };
    const ring = (pos, axis, R, r, mat = metal) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(R, r, 8, 24), mat);
      m.position.set(...pos);
      m.quaternion.setFromUnitVectors(V(0, 0, 1), V(...axis).normalize());
      suit.add(m);
      return m;
    };
    // torso + hips
    add(new THREE.CapsuleGeometry(0.2, 0.24, 8, 20), hard, [0, 0.38, 0], null, [1.22, 1, 0.86]);
    add(new THREE.CapsuleGeometry(0.17, 0.08, 6, 18), cloth, [0, 0.04, 0], null, [1.12, 1, 0.9]);
    ring([0, 0.15, 0], [0, 1, 0], 0.19, 0.018);                       // waist bearing
    // chest control module with knobs and a little lit display
    add(new RoundedBoxGeometry(0.26, 0.13, 0.08, 3, 0.02), M.panel, [0, 0.42, -0.2]);
    add(new THREE.BoxGeometry(0.07, 0.035, 0.005), M.ledGreen, [-0.06, 0.45, -0.243]);
    for (const [x, key] of [[0.05, 'plasticR'], [0.09, 'plasticY'], [0.02, 'plasticK']]) add(new THREE.CylinderGeometry(0.013, 0.013, 0.02, 12), M[key], [x, 0.4, -0.245], [Math.PI / 2, 0, 0]);
    // umbilicals from the backpack to the chest module
    for (const [s2, key] of [[-1, 'pipeBlue'], [1, 'pipeRed']]) {
      const pts = [V(s2 * 0.2, 0.55, 0.2), V(s2 * 0.27, 0.48, 0.0), V(s2 * 0.2, 0.38, -0.18), V(s2 * 0.1, 0.4, -0.22)];
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.014, 8), M[key]);
    }
    // neck ring + helmet: white shell, clear bubble, gold sun visor, lights
    ring([0, 0.64, 0], [0, 1, 0], 0.125, 0.024);
    add(new THREE.SphereGeometry(0.16, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.62), hard, [0, 0.8, 0.02]);
    const visorMat = new THREE.MeshStandardMaterial({ color: 0xd0a648, metalness: 1, roughness: 0.06 });
    add(new THREE.SphereGeometry(0.152, 28, 18, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.22, Math.PI * 0.5), visorMat, [0, 0.8, -0.005]);
    add(new THREE.TorusGeometry(0.155, 0.012, 8, 32, Math.PI * 0.9), hard, [0, 0.8, -0.005], [0, 0, -0.05]).rotation.set(Math.PI / 2 - 0.25, 0, 0);
    for (const s2 of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.022, 0.026, 0.07, 12), dark, [s2 * 0.15, 0.86, -0.04], [Math.PI / 2, 0, 0]);
      add(new THREE.CircleGeometry(0.018, 12), M.lampCool, [s2 * 0.15, 0.86, -0.076], [0, Math.PI, 0]);
    }
    // arms: shoulder / elbow / wrist bearings, gloves with a thumb
    for (const s2 of [-1, 1]) {
      const sh = [s2 * 0.29, 0.54, 0], el = [s2 * 0.34, 0.25, -0.03], wr = [s2 * 0.33, 0.0, -0.06];
      ring(sh, [1, -0.2, 0], 0.085, 0.016);
      limb(sh, el, 0.07, cloth);
      ring(el, [0.1, 1, 0.1], 0.066, 0.012);
      limb(el, wr, 0.062, cloth);
      ring(wr, [0, 1, 0.2], 0.058, 0.016);
      add(new RoundedBoxGeometry(0.065, 0.12, 0.09, 3, 0.025), dark, [s2 * 0.33, -0.08, -0.07]);
      limb([s2 * 0.3, -0.06, -0.1], [s2 * 0.29, -0.11, -0.12], 0.016, dark);
      add(new THREE.CylinderGeometry(0.064, 0.06, 0.05, 14), M.plasticR, [s2 * 0.335, 0.11, -0.045]).rotation.set(0.1, 0, 0);   // cuff checklist band
    }
    // legs: hip bearing, bellows knee, boots with treads
    for (const s2 of [-1, 1]) {
      const hp = [s2 * 0.11, -0.04, 0], kn = [s2 * 0.12, -0.42, -0.02], an = [s2 * 0.12, -0.76, 0.0];
      ring(hp, [0, 1, 0], 0.09, 0.016);
      limb(hp, kn, 0.088, cloth);
      for (let k = -1; k <= 1; k++) ring([kn[0], kn[1] + k * 0.028, kn[2]], [0, 1, 0.05], 0.084, 0.012, cloth);
      limb(kn, an, 0.078, cloth);
      add(new THREE.CylinderGeometry(0.081, 0.081, 0.03, 16), M.plasticR, [s2 * 0.12, -0.3, -0.01]);   // commander stripe
      add(new RoundedBoxGeometry(0.13, 0.12, 0.27, 3, 0.04), hard, [s2 * 0.12, -0.83, -0.04]);
      add(new RoundedBoxGeometry(0.14, 0.03, 0.28, 2, 0.01), dark, [s2 * 0.12, -0.9, -0.04]);
    }
    // life-support backpack: vents, antenna, oxygen bottles
    add(new RoundedBoxGeometry(0.46, 0.62, 0.22, 4, 0.06), hard, [0, 0.4, 0.29]);
    for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(0.3, 0.012, 0.01), dark, [0, 0.2 + k * 0.035, 0.405]);
    for (const s2 of [-1, 1]) add(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 14), metal, [s2 * 0.19, 0.42, 0.37]);
    add(new THREE.CylinderGeometry(0.006, 0.004, 0.28, 6), metal, [0.16, 0.85, 0.32]);
    add(new THREE.SphereGeometry(0.012, 8, 6), M.ledRed, [0.16, 0.99, 0.32]);
    // patch + name tag
    add(new THREE.PlaneGeometry(0.09, 0.06), M.decal, [0.255, 0.44, -0.05], [0, Math.PI / 2 + 0.25, 0]);
    add(new THREE.PlaneGeometry(0.11, 0.035), M.labels, [-0.11, 0.53, -0.215], [0, Math.PI, 0]);
    // hanger through the shoulders up to the rack
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.66, 8), metal, [0, 0.6, 0.1], [0, 0, Math.PI / 2]);
    add(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 8), metal, [0, 0.76, 0.12]);
    suit.position.copy(p);
    suit.rotation.y = Math.PI;
    this.root.add(suit);
    this.suitModel = suit;
    g.interact.addSphere(p.clone().add(V(0, 0.3, 0)), 0.5, () => g.systems.suitTapped(), { maxDist: 2.2 });
  }

  // ------------------------------------------------------------------ engineering floor hatch
  buildEngHatch() {
    const g = this.g, M = this.M;
    const w = ENG_HATCH.x1 - ENG_HATCH.x0, d = ENG_HATCH.z1 - ENG_HATCH.z0;
    const hinge = new THREE.Group();
    hinge.position.set(ENG_HATCH.x0, DECK_Y, (ENG_HATCH.z0 + ENG_HATCH.z1) / 2);
    const plate = new THREE.Mesh(new RoundedBoxGeometry(w - 0.01, 0.04, d - 0.01, 2, 0.01), M.floor);
    plate.position.set(w / 2, -0.02, 0);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 12, Math.PI), M.steel);
    handle.position.set(w * 0.8, 0.0, 0); handle.rotation.x = -Math.PI / 2;
    hinge.add(plate, handle);
    this.root.add(hinge);
    const col = g.phys.addKinematicBox(w / 2, 0.02, d / 2, V(ENG_HATCH.x0 + w / 2, DECK_Y - 0.02, (ENG_HATCH.z0 + ENG_HATCH.z1) / 2));
    // telescoping grab rails: hidden below the deck, they slide up through two sleeves when the
    // hatch is open so there is something to hold on to while climbing in or out
    const rails = new THREE.Group();
    const hx = (ENG_HATCH.x0 + ENG_HATCH.x1) / 2, rz = ENG_HATCH.z1 - 0.06;
    for (const x of [hx - 0.22, hx + 0.22]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.95, 10), M.handrail);
      r.position.set(x, -0.5, rz);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), M.handrail);
      cap.position.set(x, -0.02, rz);
      rails.add(r, cap);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.03, 12), M.steel);
      sleeve.position.set(x, -0.03, rz);
      this.root.add(sleeve);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.44, 8), M.handrail);
    bar.rotation.z = Math.PI / 2; bar.position.set(hx, -0.35, rz);
    rails.add(bar);
    this.root.add(rails);
    this.engHatch = { hinge, open: 0, target: 0, col, w, d, rails };
    g.engHatch = this.engHatch;
    g.interact.addSphere(V((ENG_HATCH.x0 + ENG_HATCH.x1) / 2, 0.05, (ENG_HATCH.z0 + ENG_HATCH.z1) / 2), 0.4, () => { this.engHatch.target = this.engHatch.target ? 0 : 1; g.audio.click(V(-1.3, 0, 7.7)); }, { maxDist: 2.2 });
    g.interact.addSphere(V((ENG_HATCH.x0 + ENG_HATCH.x1) / 2, -0.4, (ENG_HATCH.z0 + ENG_HATCH.z1) / 2), 0.4, () => { this.engHatch.target = this.engHatch.target ? 0 : 1; }, { maxDist: 2.2 });
  }

  update(dt) {
    const g = this.g;
    this.updateLift(dt);
    this.updateCoffee(dt);
    this.updateShower(dt);
    const power = g.systems.power ?? 1;
    // reactor
    if (this.reactor) {
      const r = this.reactor;
      const t = performance.now() / 1000;
      r.glowMat.emissiveIntensity = 6 + 3 * power + Math.sin(t * 7) * 0.4;
      r.turb.rotation.x += dt * 40 * power;
      r.rods.forEach((rod, i) => { rod.position.y = 1.25 + (1 - power) * 0.25 + Math.sin(t * 0.2 + i) * 0.005; });
      r.light.intensity = 1.2 + power;
    }
    // fans
    const fanOn = g.lifeSupport.fans.on && g.lifeSupport.fans.health > 0.2 && power > 0.2;
    for (const f of this.fans) f.rotation.x += dt * (fanOn ? 18 : 0.5) * (0.8 + Math.random() * 0.05);
    // server LEDs
    const s = this.servers;
    if (s) {
      s.t += dt;
      if (s.t > 0.08) {
        s.t = 0;
        const health = g.damage ? g.damage.health.servers : 1;
        const c = new THREE.Color();
        for (let i = 0; i < s.n; i++) {
          if (Math.random() < 0.25) {
            const bad = Math.random() > health;
            const on = Math.random() < (power > 0.2 ? 0.7 : 0.05);
            c.setRGB(on ? (bad ? 1 : 0.15) : 0, on ? (bad ? 0.1 : (i % 7 === 0 ? 0.5 : 1)) : 0, on ? (bad ? 0.05 : (i % 5 === 0 ? 1 : 0.35)) : 0);
            s.inst.setColorAt(i, c);
          }
        }
        s.inst.instanceColor.needsUpdate = true;
      }
    }
    // bubbles in the O2 column
    if (this.o2col && g.fx && g.lifeSupport.o2gen.on && Math.random() < dt * 12 * g.lifeSupport.o2gen.health) {
      g.fx._one('water', this.o2col.clone().add(V((Math.random() - 0.5) * 0.12, -0.5, (Math.random() - 0.5) * 0.12)), V(0, 0.25 + Math.random() * 0.2, 0), { color: [0.85, 0.95, 1], life: 0.35 });
    }
    // underfloor machinery: reaction wheel spin (slows when power sags), bubbles in the
    // water recycler columns and the algae coil
    if (this.wheel) this.wheel.rotation.z += dt * 22 * Math.max(0.05, power);
    const U = this.under;
    if (U && g.fx && g.player.pos.y < -0.2) {
      if (U.recycler) for (const p of U.recycler) if (Math.random() < dt * 5) g.fx._one('water', p.clone().add(V((Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.08)), V(0, 0.18 + Math.random() * 0.1, 0), { color: [0.7, 0.95, 1], life: 0.3 });
      if (U.algae && Math.random() < dt * 3) { const p = U.algae[0].clone().lerp(U.algae[1], Math.random()); g.fx._one('water', p, V(0, 0.08, (Math.random() - 0.5) * 0.1), { color: [0.75, 1, 0.75], life: 0.25 }); }
    }
    // eng hatch
    const h = this.engHatch;
    if (h) {
      h.open += (h.target - h.open) * Math.min(1, dt * 2.5);
      h.hinge.rotation.z = h.open * 1.75;
      h.hinge.updateMatrix();
      const p = V(h.w / 2, -0.02, 0).applyMatrix4(h.hinge.matrix);
      h.col.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      h.col.body.setNextKinematicRotation(new THREE.Quaternion().setFromEuler(h.hinge.rotation));
      h.col.col.setEnabled(h.open < 0.35);
      // grab rails follow once the lid is out of the way (and retract before it closes)
      const ext = Math.max(0, Math.min(1, (h.open - 0.55) / 0.4));
      h.railY = (h.railY ?? 0) + (ext * 0.92 - (h.railY ?? 0)) * Math.min(1, dt * 3);
      h.rails.position.y = h.railY;
    }
    // suit model visible only when not worn
    if (this.suitModel) this.suitModel.visible = !g.player.suit;
  }
}
