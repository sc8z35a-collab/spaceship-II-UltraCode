// Gameplay rules layered on top of the ship systems: alarms + AI reactions, crew condition,
// airlock / suit / EVA, items (repair kit, coffee), on-site repairs, isolation valves, sleep,
// re-entry heating, landing and Earth-gravity EVA, exterior effects and comms.
import * as THREE from 'three';
import { ZONES } from './lifeSupport.js';
import { HULL, sectionPoint, halfWidthAt, heightRangeAt, DECK_Y, OPENINGS } from './hullShape.js';
import { EQUIPMENT } from './damage.js';
import { PIPE_SYSTEMS } from './underfloor.js';
import { ENG_HATCH, LIFT } from './interior.js';
import { RoundedBoxGeometry } from './geom.js';
import { LAYER_NEAR, LAYER_MID, setLayersDeep } from '../core/layers.js';
import { R_EARTH } from '../core/astro.js';
import { HULL_BOTTOM } from './flight.js';
import { R as RAPIER } from '../physics/localPhysics.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DIRS = [[V(0, 0, -1), '前方'], [V(0, 0, 1), '後方'], [V(1, 0, 0), '右舷'], [V(-1, 0, 0), '左舷'], [V(0, 1, 0), '上方'], [V(0, -1, 0), '下方']];
function dirName(v) { let best = DIRS[0]; for (const d of DIRS) if (d[0].dot(v) > best[0].dot(v)) best = d; return best[1]; }
function distToSeg(p, a, b) {
  const ab = b.clone().sub(a), ap = p.clone().sub(a);
  const t = Math.max(0, Math.min(1, ap.dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}
const HATCH = OPENINGS.find((o) => o.kind === 'hatch');

export class Gameplay {
  constructor(game) {
    this.g = game;
    this.kit = { patches: 6, clamps: 5, sealant: 8, parts: 4 };
    this.held = null;
    this.coffeeLevel = 0;
    this.repairing = null;
    this.issueProxies = new Map();
    this.sleeping = false;
    this.gravityAnnounced = false;
    this.reentryWarned = 0;
    this.flashT = 0;
    this.evaWarnD = 60;
    this.ground = null;
    this.landingSaid = false;
    this.plumeP = 0;
    this.prevW = new THREE.Vector3();
    this.commsT = 0;
    this.watched = [];     // asteroids on a collision course
    this.underwater = 0;
  }

  // ================================================================== setup
  init() {
    const g = this.g, L = g.layout, M = g.shipVis.M;
    // repair kit cabinet in the storage room
    if (L.spots.repairKit) g.interact.addSphere(L.spots.repairKit, 0.3, () => this.toggleKit(), { maxDist: 2.0 });
    // isolation valves under the floor (turnable hand wheels)
    for (const v of L.valves || []) {
      const wheel = new THREE.Group();
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.011, 8, 22), M.pipeRed);
      rim.rotation.x = Math.PI / 2;
      wheel.add(rim);
      for (let k = 0; k < 3; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.012, 0.012), M.pipeRed); sp.rotation.y = k * Math.PI / 3; wheel.add(sp); }
      wheel.position.copy(v.pos).add(V(0, 0.012, 0));
      setLayersDeep(wheel, LAYER_NEAR);
      g.shipVis.root.add(wheel);
      v.wheel = wheel; v.turn = 0;
      g.interact.addSphere(v.pos, 0.15, () => this.toggleValve(v), { maxDist: 1.9 });
    }
    // first-person held items
    this.vm = new THREE.Group();
    this.vm.name = 'viewmodel';
    g.shipVis.root.add(this.vm);
    const kit = new THREE.Group();
    kit.add(new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.14, 0.09, 3, 0.02), M.plasticR));
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 6, 12, Math.PI), M.plasticK);
    handle.position.y = 0.07;
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.002), M.plasticW);
    label.position.set(0, 0, 0.046);
    kit.add(handle, label);
    const cup = new THREE.Group();
    const prof = [[0, 0], [0.036, 0], [0.039, 0.085], [0.034, 0.085], [0.033, 0.006], [0, 0.006]].map(([x, y]) => new THREE.Vector2(x, y));
    const mug = new THREE.Mesh(new THREE.LatheGeometry(prof, 18), M.ceramic);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.033, 16), new THREE.MeshStandardMaterial({ color: 0x2a140a, roughness: 0.1 }));
    coffee.rotation.x = -Math.PI / 2; coffee.position.y = 0.075;
    const pouch = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.12, 0.03, 3, 0.012), new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.6, roughness: 0.3 }));
    pouch.position.y = 0.06;
    const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 6), M.plasticY);
    straw.position.set(0.02, 0.14, 0);
    cup.add(mug, coffee, pouch, straw);
    this.vmKit = kit; this.vmCup = cup; this.vmCoffee = coffee; this.vmMug = mug; this.vmPouch = pouch; this.vmStraw = straw;
    this.vm.add(kit, cup);
    kit.visible = cup.visible = false;
    setLayersDeep(this.vm, LAYER_NEAR);
    // Kaito's arms while flying: hands on the side stick and the throttle
    this.arms = new THREE.Group();
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x2d3a52, roughness: 0.85 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.6 });
    this.armParts = [];
    for (let k = 0; k < 2; k++) {
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.26, 4, 10), sleeve);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.24, 4, 10), sleeve);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), glove);
      hand.scale.set(1, 0.8, 1.35);
      this.arms.add(upper, fore, hand);
      this.armParts.push({ upper, fore, hand });
    }
    setLayersDeep(this.arms, LAYER_NEAR);
    this.arms.visible = false;
    g.shipVis.root.add(this.arms);
    // exterior floodlights (EVA / external cameras at night)
    this.flood = [];
    const fl = g.shipVis.extLights;
    for (const [p, tgt] of [[fl.flood1, V(0.8, -0.6, 4)], [fl.flood2, V(-0.8, -0.6, -6)]]) {
      const s = new THREE.SpotLight(0xdde8ff, 0, 40, 0.95, 0.55, 1.2);
      s.position.copy(p).add(V(0, 0.2, 0));
      s.target.position.copy(tgt);
      s.layers.enableAll();
      g.shipVis.root.add(s, s.target);
      this.flood.push(s);
    }
    // engine plume
    const plumeMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uP: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uT; uniform float uP; varying vec2 vUv;
        void main(){ float r = abs(vUv.x - 0.5) * 2.0; float a = vUv.y; float core = exp(-r * r * 6.0) * a * a;
          float shock = 0.5 + 0.5 * sin(vUv.y * 40.0 + uT * 30.0);
          vec3 c = mix(vec3(0.35, 0.55, 1.0), vec3(1.0, 0.85, 0.7), core) * core * (0.8 + 0.4 * shock) * uP * 6.0;
          gl_FragColor = vec4(c, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const plumeGeo = new THREE.CylinderGeometry(0.55, 1.15, 7, 24, 1, true);
    plumeGeo.rotateX(Math.PI / 2);          // narrow top (uv.y = 1) -> +z
    plumeGeo.rotateY(Math.PI);              // ... -> -z (toward the nozzle)
    plumeGeo.translate(0, 0, 3.5);          // root at the origin, plume extends aft (+z)
    const plume = new THREE.Mesh(plumeGeo, plumeMat);
    plume.position.set(0, 0.4, 15.4 + 1.25 + 2.1);
    plume.frustumCulled = false;
    setLayersDeep(plume, LAYER_NEAR, LAYER_MID);
    plume.visible = false;
    g.shipVis.root.add(plume);
    this.plume = plume;
    // re-entry plasma sheath
    const plasmaMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uH: { value: 0 }, uDir: { value: new THREE.Vector3(0, 0, -1) } },
      vertexShader: 'varying vec3 vP; varying vec3 vN; varying vec3 vW; varying vec3 vNw; void main(){ vP = position; vN = normal; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vNw = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float uT; uniform float uH; uniform vec3 uDir; varying vec3 vP; varying vec3 vN; varying vec3 vW; varying vec3 vNw;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
        float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(h(i), h(i+vec3(1,0,0)), f.x), mix(h(i+vec3(0,1,0)), h(i+vec3(1,1,0)), f.x), f.y), mix(mix(h(i+vec3(0,0,1)), h(i+vec3(1,0,1)), f.x), mix(h(i+vec3(0,1,1)), h(i+vec3(1,1,1)), f.x), f.y), f.z); }
        void main(){
          vec3 N = normalize(vN);
          float facing = dot(N, uDir);
          float bow = pow(max(facing, 0.0), 3.0);                 // shock layer in front
          vec3 V = normalize(cameraPosition - vW);
          float rim = 1.0 - abs(dot(V, normalize(vNw)));          // glowing shell, see-through middle
          // streaks flowing back along the hull
          vec3 q = vP - uDir * dot(vP, uDir);
          float s = n3(q * 2.4 + uDir * (dot(vP, uDir) * 0.35 - uT * 6.0)) * 0.65 + n3(vP * 5.0 - uDir * uT * 15.0) * 0.35;
          float st = smoothstep(0.35, 0.85, s);                    // thin hot filaments
          float wake = smoothstep(0.2, -0.6, facing) * pow(rim, 3.0) * st;
          float a = uH * (bow * (0.6 + 0.6 * s) + pow(rim, 4.0) * 0.5 * smoothstep(-0.3, 0.6, facing) * (0.25 + st) + wake * 0.4);
          vec3 c = mix(vec3(1.0, 0.25, 0.06), vec3(1.0, 0.86, 0.62), clamp(bow * 1.3, 0.0, 1.0)) * a * 2.2;
          gl_FragColor = vec4(c, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const sheath = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), plasmaMat);
    sheath.scale.set(4.6, 3.8, 18.5);
    sheath.position.set(0, 0.4, -1.0);
    sheath.visible = false;
    sheath.frustumCulled = false;
    setLayersDeep(sheath, LAYER_NEAR, LAYER_MID);
    g.shipVis.root.add(sheath);
    this.sheath = sheath;
    // dust motes in the cabin
    if (g.fx) {
      g.fx.emitter('dust', V(-1.6, 1.3, -6), V(0, 1, 0), 0.5, { speed: 0.02, spread: 3 });
      g.fx.emitter('dust', V(0, 1.2, -10.4), V(0, 1, 0), 0.4, { speed: 0.02, spread: 3 });
      g.fx.emitter('dust', V(0, 1.4, -1.5), V(0, 1, 0), 0.4, { speed: 0.02, spread: 3 });
    }
    g.flight.impactCallback = (speed, vn, water) => this.groundImpact(speed, vn, water);
  }

  onBegin(cont) {
    const g = this.g;
    g.asphalt.unlock();
    const off = g.save.offline;
    if (cont && off && off.gap > 60) {
      const h = off.gap / 3600;
      const ht = h < 1 ? Math.round(off.gap / 60) + '分' : h < 48 ? h.toFixed(1) + '時間' : (h / 24).toFixed(1) + '日';
      setTimeout(() => g.asphalt.say('back', { h: ht }, { force: true }), 2500);
      setTimeout(() => g.asphalt.say(off.hits ? 'offline_hits' : 'offline_quiet', { n: off.hits }, { force: true }), 3000);
    } else if (cont) setTimeout(() => g.asphalt.say('boot', {}, { force: true }), 2500);
    else setTimeout(() => g.asphalt.say('welcome', {}, { force: true }), 3000);
    // ambient machinery (positional, muffled when the air thins)
    const a = g.audio;
    a.humLoop('reactorHum', { pos: V(0, 1.0, 9.0), freq: 47, gain: 0.05, harm: [1, 0.7, 0.3, 0.2] });
    a.noiseLoop('ventMain', { pos: V(0, 2.3, -2.2), type: 'pink', freq: 420, q: 0.5, gain: 0.035, filter: 'lowpass' });
    a.noiseLoop('ventCockpit', { pos: V(0, 2.2, -10.0), type: 'pink', freq: 600, q: 0.4, gain: 0.02, filter: 'lowpass' });
    a.noiseLoop('lsFans', { pos: V(1.8, 1.2, 1.5), type: 'pink', freq: 900, q: 0.8, gain: 0.04 });
    a.humLoop('servers', { pos: V(-1.5, 1.0, 6.5), freq: 120, gain: 0.012, harm: [1, 0.2, 0.4, 0.1] });
  }

  // ================================================================== player environment
  env(env) {
    const g = this.g, pl = g.player, p = pl.pos;
    const L = g.lift;
    if (L && L.delta) {
      const lp = L.plat.position;
      if (Math.abs(p.x - lp.x) < 0.55 && Math.abs(p.z - lp.z) < 0.55 && p.y - lp.y < 1.3 && p.y - lp.y > -0.2) env.liftDelta = V(0, L.delta, 0);
    }
    const gMag = g.gLocal ? g.gLocal.length() : 0;
    // crouch under the deck (not in the lift shaft / floor hatch) and through the airlock hatch
    const inShaft = p.x > LIFT.x0 && p.x < LIFT.x1 && p.z > LIFT.z0 && p.z < LIFT.z1;
    const inHatchway = p.x > ENG_HATCH.x0 - 0.1 && p.x < ENG_HATCH.x1 + 0.1 && p.z > ENG_HATCH.z0 - 0.1 && p.z < ENG_HATCH.z1 + 0.1;
    const nearHatch = p.distanceTo(HATCH.center) < 1.25;
    // at the foot of the lift shaft / the hatch ladder Kaito ducks too, so he can step out under
    // the deck (standing there, his head stuck up into the opening and the deck edge stopped him)
    env.lowCeiling = (p.y < DECK_Y - 0.1 && (!(inShaft || inHatchway) || p.y < DECK_Y - 0.55) && (pl.state === 'walk' || pl.state === 'evaWalk')) || nearHatch;
    if (nearHatch) env.stepUp = 0.45;    // step over the hatch sill
    // ladders: the engineering floor hatch inside, hull rails / boarding ladder outside
    env.climb = false;
    if (gMag > 2) {
      if (inHatchway && p.y < 1.2) env.climb = true;
      if (pl.outside) for (const r of g.shipVis.rails) if (distToSeg(p, r.a, r.b) < 0.75) { env.climb = true; break; }
    }
    if (pl.outside) {
      let best = 9;
      for (const r of g.shipVis.rails) { const d = distToSeg(p, r.a, r.b); if (d < best) best = d; }
      env.nearRail = best < 0.9;
      // in the sea after a splashdown
      if (g.flight.landed && g.flight.inWater) {
        const yw = this.waterLevelLocal();
        if (p.y < yw + 0.4) env.swim = Math.max(0, Math.min(1.6, (yw - (p.y + 0.2)) / 0.6 + 0.5));
      }
    }
  }

  waterLevelLocal() {
    const f = this.g.flight;
    return R_EARTH + f.surfaceH - f.pos.length();
  }

  // ================================================================== events
  on(ev, data) {
    const g = this.g;
    if (ev === 'doorTap') {
      const d = data;
      const [a, b] = d.def.zones;
      const pa = g.lifeSupport.pressure(a), pb = g.lifeSupport.pressure(b);
      if (d.target < 0.5 && Math.abs(pa - pb) > 8) { g.systems.handled = true; g.audio.denied(d.group.position); g.asphalt.say('door_pressure', {}, { minGap: 8 }); return; }
      if (d.jammed >= 1) { g.systems.handled = true; g.audio.denied(d.group.position); g.asphalt.say('door_jammed', {}, { minGap: 10 }); return; }
      if (d.target < 0.5 && g.lifeSupport.lockdown) g.lifeSupport.lockdown = false; // opening a door ends the lockdown
    }
    if (ev === 'hatchTap') this.hatchTap();
    if (ev === 'drop') this.drop();
    if (ev === 'silence') { g.audio.alarm(false); g.asphalt.say('silenced', {}, { minGap: 30 }); }
    if (ev === 'tapNothing') this.tapNothing(data);
    if (ev === 'arrived') g.audio.chime();
  }

  // ================================================================== items
  toggleKit() {
    const g = this.g;
    this.held = this.held === 'kit' ? null : 'kit';
    g.systems.held = this.held;
    g.audio.click(g.layout.spots.repairKit);
    if (g.audio.ready) g.audio._burst(g.layout.spots.repairKit, { dur: 0.25, freq: 500, q: 0.8, gain: 0.12, type: 'brown', filter: 'lowpass' });
  }

  hold(kind) {
    this.held = kind;
    this.g.systems.held = kind;
    this.coffeeLevel = 1;
  }

  drop() {
    const g = this.g;
    if (this.held === 'coffee' && g.fx && this.coffeeLevel > 0) {
      const p = g.player.eyeLocal.clone().add(V(0.2, -0.3, -0.4).applyQuaternion(g.player.lookQuat));
      if (g.player.state === 'float' || g.player.state === 'eva') g.fx.burst('coffee', p, V(0, 0, 0), Math.round(30 * this.coffeeLevel), { speed: 0.12, spread: 1 });
      else g.fx.burst('coffee', p, V(0, -1, 0), Math.round(40 * this.coffeeLevel), { speed: 0.6, spread: 0.4 });
    }
    this.held = null;
    g.systems.held = null;
  }

  tapNothing(tap) {
    // tap the lower-right of the screen while holding coffee = take a sip
    const g = this.g;
    if (this.held === 'coffee' && tap.x > 0.2 && tap.y < -0.15) {
      if (this.coffeeLevel <= 0) { this.drop(); return; }
      this.coffeeLevel = Math.max(0, this.coffeeLevel - 0.2);
      if (g.audio.ready) g.audio._burst(null, { dur: 0.45, freq: 520, q: 1, gain: 0.07, type: 'pink', direct: true });
      this.sipT = 1;
      g.player.health = Math.min(1, g.player.health + 0.02);
      if (this.coffeeLevel <= 0) setTimeout(() => { if (this.held === 'coffee') this.drop(); }, 1500);
    }
  }

  toggleValve(v) {
    v.open = !v.open;
    this.g.audio.click(v.pos);
    if (this.g.audio.ready) this.g.audio._burst(v.pos, { dur: 0.6, freq: 260, q: 2, gain: 0.08, type: 'brown', sweep: v.open ? 1.6 : 0.6 });
  }

  /** a leaking segment is isolated when any valve of its system is closed */
  valveOpen(seg) {
    const vs = (this.g.layout.valves || []).filter((v) => v.sys === seg.sys);
    return vs.every((v) => v.open);
  }

  // ================================================================== airlock / suit / EVA
  breathable(p) { return p > 60; }

  suitTapped() {
    const g = this.g, pl = g.player;
    if (!pl.suit) {
      this.fadeAction(() => { pl.suit = true; pl.suitO2 = 1; pl.suitFuel = Math.max(pl.suitFuel, 0.98); g.asphalt.say('suit_on', {}, { force: true }); });
    } else {
      const here = pl.outside ? g.lifeSupport.ambient : g.lifeSupport.pressure(g.lifeSupport.zoneAt(pl.pos));
      if (!this.breathable(here)) { g.audio.denied(pl.eyeLocal); return; }
      this.fadeAction(() => { pl.suit = false; g.asphalt.say('suit_off', {}, { force: true }); });
    }
  }

  fadeAction(fn) {
    const g = this.g;
    g.hud.setFade(1);
    if (g.audio.ready) g.audio._burst(null, { dur: 1.2, freq: 900, q: 0.5, gain: 0.12, type: 'pink', direct: true });
    setTimeout(() => { fn(); g.hud.setFade(this.sleeping ? 0.93 : 0); g.audio.beep(1200, 0.08, 0.08, { direct: true }); }, 1500);
  }

  hatchTap() {
    const g = this.g, h = g.hatch, ls = g.lifeSupport;
    if (h.target > 0.5) { h.target = 0; g.audio.doorMotor(h.o.center, false); return; }
    const p = ls.pressure('airlock');
    if (!g.player.suit && !this.breathable(ls.ambient)) { g.asphalt.say('hatch_denied', {}, { minGap: 6 }); g.audio.denied(h.o.center); return; }
    if (Math.abs(p - ls.ambient) > 4) { g.asphalt.say('hatch_denied', {}, { minGap: 6 }); g.audio.denied(h.o.center); return; }
    h.target = 1;
    g.audio.doorMotor(h.o.center, true);
  }

  airlockCycle(mode) {
    const g = this.g;
    if (g.doors.airlock.open > 0.05 || g.hatch.open > 0.02) { g.audio.denied(V(0.8, 1.4, -1.8)); return; }
    if (g.airlockMode === mode) { g.airlockMode = 'idle'; g.audio.stopLoop('alpump'); g.audio.stopLoop('alrep'); return; }
    g.airlockMode = mode;
    g.asphalt.say(mode === 'dep' ? 'airlock_dep' : 'airlock_rep', {}, { minGap: 3 });
  }

  updateAirlock(dt) {
    const g = this.g, ls = g.lifeSupport, z = ls.z.airlock;
    const mode = g.airlockMode;
    g.doors.airlock.locked = Math.abs(ls.pressure('airlock') - ls.pressure('corridor')) > 8 || (mode && mode !== 'idle');
    if (!mode || mode === 'idle') return;
    const p = z.n2 + z.o2 + z.co2;
    if (mode === 'dep') {
      // pump the air back into the reserve tanks (down to the outside pressure)
      const k = Math.min(1, dt * 0.08);
      const floor = ls.ambient;
      if (p > floor + 1.2) {
        const dn = z.n2 * k, doo = z.o2 * k;
        z.n2 -= dn; z.o2 -= doo; z.co2 *= 1 - k;
        ls.reserve.n2 += dn * z.vol * 0.92; ls.reserve.o2 += doo * z.vol * 0.92;
        g.audio.humLoop('alpump', { pos: V(1.8, 0.3, -1.0), freq: 70, gain: 0.08 });
        if (g.fx && Math.random() < dt * 6 && p > 5) g.fx.burst('mist', V(2.3, 0.3, -2.3), V(0, 0, 1), 2, { speed: 0.5 });
      } else {
        if (floor < 1) { z.n2 = z.o2 = z.co2 = 0; }
        g.airlockMode = 'idle'; g.audio.stopLoop('alpump');
        g.audio.beep(660, 0.25, 0.1, { pos: V(0.8, 1.7, -1.85) });
        g.asphalt.say('airlock_ready', {}, { minGap: 5 });
      }
    } else if (mode === 'rep') {
      const need = 101.3 - p;
      const k = Math.min(Math.max(0, need), dt * 3.2);
      if (k > 0 && ls.reserve.n2 > 0 && g.hatch.sealed) {
        z.n2 += k * 0.79; z.o2 += k * 0.21;
        ls.reserve.n2 -= k * 0.79 * z.vol; ls.reserve.o2 -= k * 0.21 * z.vol;
      }
      g.audio.noiseLoop('alrep', { pos: V(1.8, 2.0, -1.0), type: 'pink', freq: 1500, q: 0.6, gain: 0.15 });
      if (p > 100.5 || ls.reserve.n2 <= 0) { g.airlockMode = 'idle'; g.audio.stopLoop('alrep'); g.audio.beep(880, 0.2, 0.1, { pos: V(0.8, 1.7, -1.85) }); }
    }
  }

  updateEva(dt) {
    const g = this.g, pl = g.player, p = pl.pos;
    // inside / outside the pressure hull
    const [bot, top] = heightRangeAt(p.z, p.x, 0);
    const hw = halfWidthAt(p.z, p.y, 0);
    const insideHull = (p.z > HULL.zTip && p.z < 9.6 && Math.abs(p.x) < hw && p.y > bot && p.y < top) || g.docking.contains(p);
    const wasOut = pl.outside;
    pl.outside = !insideHull;
    if (pl.outside && !wasOut) {
      if (pl.state === 'float' || pl.state === 'walk') pl.state = g.gLocal.length() > 2 ? 'evaWalk' : 'eva';
      if (pl.vel.length() > 0.5) pl.vel.setLength(0.5);   // a gentle push off the hatch rim
      if (!g.flight.landed) g.asphalt.say('eva_out', {}, { minGap: 120 });
    } else if (!pl.outside && wasOut) {
      if (pl.state === 'eva' || pl.state === 'evaWalk') pl.state = 'float';
      g.asphalt.say('eva_back', {}, { minGap: 60 });
    }
    if (pl.suit) {
      pl.suitO2 = Math.max(0, pl.suitO2 - dt / (8 * 3600));
      if (pl.suitO2 < 0.15) g.asphalt.say('eva_o2', {}, { minGap: 300 });
      if (pl.outside && pl.suitFuel < 0.15 && !g.flight.landed) g.asphalt.say('fuel_low', {}, { minGap: 300 });
      g.audio.breath(true, 0.24 + (1 - pl.health) * 0.3);
      g.audio.noiseLoop('suitfan', { type: 'pink', freq: 600, q: 0.6, gain: 0.03, direct: true });
    } else { g.audio.breath(false); g.audio.stopLoop('suitfan'); }
    if (pl.outside && !g.flight.landed) {
      const d = p.length();
      if (d > this.evaWarnD) { g.asphalt.say('eva_far', { m: Math.round(d) }, { minGap: 30 }); this.evaWarnD = d + 60; }
      if (d < 40) this.evaWarnD = 60;
      if (pl.thrusting && g.fx && Math.random() < dt * 25) {
        const back = V(0, -0.2, 0.35).applyQuaternion(pl.lookQuat);
        g.fx.burst('rcs', pl.eyeLocal.clone().add(back), back.clone().normalize(), 1, { speed: 1.2, size: 0.35 });
        if (Math.random() < dt * 6) g.audio.rcsPuff(pl.eyeLocal, 0.05);
      }
    }
    // swimming / underwater
    const yw = g.flight.landed && g.flight.inWater ? this.waterLevelLocal() : -1e9;
    const under = pl.outside && pl.eyeLocal.y < yw;
    this.underwater += ((under ? 1 : 0) - this.underwater) * Math.min(1, dt * 4);
    if (under && !this.wasUnder) { g.audio.splash(0.4); g.asphalt.say('water_in', {}, { minGap: 120 }); }
    this.wasUnder = under;
    g.engine.grade.set('uVisor', pl.suit ? 1 : 0);
  }

  // ================================================================== on-site repairs
  updateIssueProxies() {
    const g = this.g;
    for (const it of g.damage.issues) {
      const has = this.issueProxies.get(it);
      if (it.state === 'fixed' || it.ext || it.kind === 'window') { if (has) { g.interact.remove(has); this.issueProxies.delete(it); } continue; }
      if (!has && it.pos) this.issueProxies.set(it, g.interact.addSphere(it.pos, it.kind === 'pipe' ? 0.32 : 0.42, () => this.startRepair(it), { maxDist: 2.1 }));
    }
    for (const [it, pr] of this.issueProxies) if (!g.damage.issues.includes(it)) { g.interact.remove(pr); this.issueProxies.delete(it); }
  }

  startRepair(it) {
    const g = this.g;
    if (this.held !== 'kit') { g.asphalt.say('need_kit', {}, { minGap: 15 }); return; }
    if (it.state !== 'active') { g.asphalt.say('repair_patch', {}, { minGap: 15 }); return; }
    if (!it.repairable) { g.asphalt.say('repair_cannot', {}, { minGap: 20 }); return; }
    const need = it.kind === 'pipe' ? 'clamps' : it.kind === 'breach' ? 'patches' : it.kind === 'crack' ? 'sealant' : 'parts';
    if (this.kit[need] <= 0) { g.asphalt.say('kit_empty', {}, { minGap: 15 }); return; }
    this.repairing = { it, t: 0, dur: it.kind === 'equip' ? 7 : 4.5, need, pos: it.pos.clone() };
  }

  updateRepair(dt) {
    const r = this.repairing, g = this.g;
    const ring = document.getElementById('hold-ring');
    if (!r) { ring.classList.remove('on'); return; }
    if (g.player.eyeLocal.distanceTo(r.pos) > 2.5 || this.held !== 'kit') { this.repairing = null; ring.classList.remove('on'); return; }
    r.t += dt;
    ring.classList.add('on');
    ring.style.left = '50%'; ring.style.top = '50%';
    ring.style.setProperty('--p', Math.round((r.t / r.dur) * 100) + '%');
    if (Math.random() < dt * 7) {
      g.audio.click(r.pos, 0.14);
      if (g.fx) g.fx.burst(r.it.kind === 'equip' || r.it.kind === 'breach' ? 'spark' : 'mist', r.pos, V(0, 1, 0), 3, { speed: 0.8 });
    }
    if (r.t >= r.dur) {
      const res = g.damage.repair(r.it);
      if (res === 'fixed' || res === 'patched') {
        this.kit[r.need]--;
        g.asphalt.say(r.it.kind === 'breach' ? 'breach_patched' : res === 'fixed' ? 'repair_ok' : 'repair_patch', {}, { minGap: 5 });
        g.audio.beep(1200, 0.1, 0.1, { pos: r.pos }); g.audio.beep(1600, 0.12, 0.1, { pos: r.pos, when: 0.12 });
      } else g.asphalt.say('repair_cannot', {}, { minGap: 10 });
      this.repairing = null;
      ring.classList.remove('on');
    }
  }

  // ================================================================== alarms & AI reactions
  processEvents() {
    const g = this.g;
    const ev = g.damage.events.splice(0);
    for (const e of ev) {
      if (e.type === 'impact') {
        if (e.E < 3e4 && !e.breach) g.asphalt.say('impact_micro', {}, { minGap: 10 });
        else { this.raise(e.E > 5e5 ? 1 : 0.75); g.asphalt.say(e.E > 5e5 ? 'impact_big' : 'impact', {}, { minGap: 5, force: e.E > 5e5 }); }
        if (e.breach) {
          const zn = ZONES[e.zone] ? ZONES[e.zone].name : '船内';
          setTimeout(() => g.asphalt.say(e.E > 1.5e6 ? 'breach_big' : 'breach', { zone: zn }, { minGap: 8 }), 2500);
          if (e.E > 1.5e6) this.autoLockdown(e.zone);
        }
        if (this.sleeping) this.wake();
      } else if (e.type === 'window') {
        this.raise(1);
        g.asphalt.say('window_broken', { zone: ZONES[e.zone] ? ZONES[e.zone].name : '' }, { minGap: 5, force: true });
        this.autoLockdown(e.zone);
      } else if (e.type === 'pipe') {
        this.raise(0.6);
        const where = e.pos.z < -6 ? '前方' : e.pos.z < -2 ? '中央前寄り' : e.pos.z < 3 ? '中央' : '後方';
        g.asphalt.say('pipe', { sys: PIPE_SYSTEMS[e.sys].name, where: (e.pos.x > 0.3 ? '右舷' : e.pos.x < -0.3 ? '左舷' : '中央') + 'の' + where }, { minGap: 12 });
      } else if (e.type === 'equip') {
        this.raise(0.5);
        g.asphalt.say('equip', { what: EQUIPMENT[e.k].name }, { minGap: 15 });
        if (e.k === 'comms') setTimeout(() => g.asphalt.say('comms_lost', {}, { minGap: 60 }), 3000);
      } else if (e.type === 'worse') {
        this.raise(0.5);
        g.asphalt.say('worse', { what: e.issue.name }, { minGap: 30 });
      }
    }
    // flight events
    for (const e of g.flight.events.splice(0)) {
      if (e === 'ultra_on') {
        g.asphalt.say('ultra_on', {}, { force: true });
        if (g.audio.ready) g.audio._burst(null, { dur: 2.5, freq: 120, q: 0.6, gain: 0.5, type: 'brown', filter: 'lowpass', sweep: 3, direct: true });
        g.shake = Math.max(g.shake, 0.6);
      } else if (e === 'ultra_off') g.asphalt.say('ultra_off', {}, { force: true });
      else if (e === 'ultra_stage') { g.shake = Math.max(g.shake, 0.35); if (g.audio.ready) g.audio._burst(null, { dur: 0.6, freq: 90, q: 0.7, gain: 0.35, type: 'brown', filter: 'lowpass', direct: true }); }
      else if (e === 'ultra_denied') { g.asphalt.say('ultra_denied', {}, { force: true }); g.audio.denied(V(0, 0.8, -10.6)); }
      else if (e === 'touchdown' || e === 'splashdown') {
        if (!this.landingSaid) setTimeout(() => g.asphalt.say(e === 'splashdown' ? 'splash' : 'landing', {}, { force: true }), 1500);
        this.landingSaid = false;
        this.buildGround();
      } else if (e === 'liftoff') { this.removeGround(); g.asphalt.say('liftoff', {}, { minGap: 30 }); }
    }
  }

  raise(level) {
    const al = this.g.systems.alarm;
    if (this.sleeping) this.wake();
    if (!al.active) al.silenced = false;
    al.active = true;
    al.level = Math.max(al.level || 0, level);
    al.t = 0;
  }

  autoLockdown(zone) {
    const g = this.g;
    const pz = g.lifeSupport.zoneOfPlayer;
    for (const d of Object.values(g.doors)) {
      if (!d.def.zones.includes(zone)) continue;
      if (d.def.zones.includes(pz) && g.player.pos.distanceTo(d.group.position) < 1.2) continue; // don't crush Kaito
      d.setTarget(0, true);
    }
    g.lifeSupport.lockdown = true;
    setTimeout(() => g.asphalt.say('lockdown', {}, { minGap: 10 }), 4000);
  }

  updateAlarm(dt) {
    const g = this.g, al = g.systems.alarm, ls = g.lifeSupport;
    const br = ls.breathing();
    const hazards = [];
    if (br.p < 75 && !br.suit) hazards.push(1);
    if (br.o2 < 17) hazards.push(0.8);
    if (br.co2 > 1.5) hazards.push(0.5);
    if ((g.damage.reactorTemp || 0) > 820) hazards.push(0.7);
    if (g.flight.hullTemp > 1300) hazards.push(1);
    if (g.player.suit && g.player.suitO2 < 0.15) hazards.push(0.7);
    for (const a of this.watched) if (!a.hit && !a.dead && a.dist < 3500) hazards.push(0.9);
    if (hazards.length) { const h = Math.max(...hazards); if (!al.active || h > al.level + 0.05) this.raise(h); }
    al.t += dt;
    // events ring for a while; ongoing hazards keep it going (lasting damage alone does not)
    if (!hazards.length && al.t > 25) { al.active = false; al.level = 0; }
    const on = al.active && !al.silenced;
    if (on) {
      g.audio.alarm(true);
      this.flashT += dt;
      if (this.flashT > 0.9) { this.flashT = 0; g.engine.grade.set('uFlash', Math.max(g.engine.grade.get('uFlash'), 0.07 * al.level)); }
    } else g.audio.alarm(false);
    g.engine.grade.set('uFlash', g.engine.grade.get('uFlash') * Math.exp(-dt * 7));
    // spoken warnings
    if (br.o2 < 17 && br.p > 30) g.asphalt.say('o2_low', {}, { minGap: 60 });
    if (br.co2 > 1.5) g.asphalt.say('co2_high', {}, { minGap: 90 });
    if (!br.suit && br.p < 50 && !g.player.outside) g.asphalt.say('pressure_low', {}, { minGap: 25 });
    if ((g.damage.reactorTemp || 0) > 820) g.asphalt.say('reactor_hot', {}, { minGap: 120 });
    if ((g.systems.power ?? 1) < 0.5) g.asphalt.say('low_power', {}, { minGap: 300 });
  }

  // ---------------------------------------------------------------- asteroids
  onAsteroidWarning(a, relLocal) {
    const g = this.g, f = g.flight;
    const rel = a.pos.clone().sub(f.pos), rv = a.vel.clone().sub(f.vel);
    const tca = -rel.dot(rv) / Math.max(rv.lengthSq(), 1e-6);
    const miss = rel.clone().addScaledVector(rv, tca).length();
    const dir = dirName(relLocal.clone().normalize());
    const km = (a.dist / 1000).toFixed(1);
    a.predMiss = miss;
    if (miss < 40) {
      this.watched.push(a);
      this.raise(0.9);
      g.asphalt.say('asteroid', { dir, km }, { force: true });
      if (this.sleeping) this.wake();
    } else if (miss < 600) g.asphalt.say('asteroid_miss', { dir }, { minGap: 20 });
  }

  updateWatched() {
    const g = this.g;
    this.watched = this.watched.filter((a) => {
      if (a.hit) return false;
      if (a.dead || (a.closing !== undefined && a.closing < 0 && a.dist > 60)) { g.asphalt.say('evaded', {}, { force: true }); return false; }
      return true;
    });
  }

  onImpact(E, pLocal) {
    const g = this.g, pl = g.player;
    if (pl.outside && pl.pos.distanceTo(pLocal) < 3.5) {
      pl.health = Math.max(0, pl.health - Math.min(0.8, E / 2e5) * (1 - pl.pos.distanceTo(pLocal) / 3.5));
      g.asphalt.say('eva_impact', {}, { force: true });
    }
    if (E > 4e5 && pl.state !== 'seated') setTimeout(() => g.asphalt.say('hurt', {}, { minGap: 60 }), 4000);
  }

  // ================================================================== crew condition
  updateCrew(dt) {
    const g = this.g, pl = g.player, ls = g.lifeSupport;
    ls.zoneOfPlayer = ls.zoneAt(pl.pos);
    const br = ls.breathing();
    let hurt = 0, blur = 0;
    let hyp = Math.max(0, Math.min(1, (17 - br.o2) / 9));
    if (!br.suit && br.p < 20) { hurt += dt / 45; hyp = 1; }       // ebullism / no air
    else if (br.o2 < 8) hurt += dt / 120;
    if (br.co2 > 2) blur = Math.min(1, (br.co2 - 2) / 4);
    if (br.co2 > 6) hurt += dt / 300;
    if (this.underwater > 0.5 && !pl.suit) { hurt += dt / 40; hyp = Math.max(hyp, 0.8); }
    // g-loads (re-entry / impacts) when not strapped in
    const gload = g.gLocal.length() / 9.81;
    if (gload > 4 && pl.state !== 'seated') hurt += dt * (gload - 4) / 20;
    if (pl.bump) { hurt += pl.bump * 0.08; g.shake = Math.max(g.shake, pl.bump * 1.5); g.audio.impact(pl.pos, 0.12 * pl.bump); pl.bump = 0; }
    pl.health = Math.max(0, Math.min(1, pl.health - hurt + (hurt === 0 && hyp === 0 ? dt / 900 : 0)));
    const gr = g.engine.grade;
    gr.set('uHypoxia', Math.max(hyp * 0.85, pl.health < 0.5 ? (0.5 - pl.health) * 1.6 : 0));
    const wet = (g.machines && g.machines.shower && g.machines.shower.wet) || 0;   // in the shower
    gr.set('uBlur', Math.max(blur * 0.6, hyp * 0.4, this.underwater * 0.7, wet * 0.32));
    gr.set('uDesat', Math.min(0.8, (1 - pl.health) * 0.8));
    gr.get('uTint').set(1 - this.underwater * 0.55 + wet * 0.05, 1 - this.underwater * 0.25 + wet * 0.02, 1 - this.underwater * 0.05 - wet * 0.03);
    if (hyp > 0.3 || pl.health < 0.6) g.audio.heartbeat(70 + 70 * Math.max(hyp, 1 - pl.health));
    // what the ears hear: cabin air, suit, or outside air
    g.audio.setAir(pl.outside ? ls.ambient : ls.pressure(ls.zoneOfPlayer), pl.suit);
    if (pl.health <= 0 && pl.state !== 'dead') this.die();
  }

  die() {
    const g = this.g;
    if (g.player.state === 'dead') return;
    g.player.state = 'dead';
    g.mode = 'dead';
    g.input.enabled = false;
    if (this.sleeping) { this.sleeping = false; g.timeScale = 1; }
    g.asphalt.say('dying', {}, { force: true });
    g.hud.setFade(1);
    g.audio.alarm(false);
    g.save.save();
    g.save.enabled = false;
    setTimeout(() => {
      document.getElementById('hud').classList.add('hidden');
      const boot = document.getElementById('boot');
      boot.classList.remove('hidden', 'fade');
      document.getElementById('progress').classList.add('hidden');
      document.querySelector('#boot .sub').textContent = 'カイトの旅は、ここで終わった。';
      let hasSafe = false;
      try { hasSafe = !!localStorage.getItem('b29.save.safe.v1'); } catch (e) { /* ignore */ }
      const bc = document.getElementById('btn-continue');
      bc.classList.toggle('hidden', !hasSafe);
      bc.querySelector('span').textContent = '直前の記録から';
      bc.onclick = () => { try { localStorage.setItem('b29.save.v1', localStorage.getItem('b29.save.safe.v1')); } catch (e) { /* ignore */ } location.reload(); };
      document.getElementById('btn-new').onclick = () => { g.save.clear(); location.reload(); };
      document.getElementById('boot-btns').classList.remove('hidden');
    }, 5000);
  }

  // ================================================================== sleep
  toggleSleep() {
    if (this.sleeping) { this.wake(); return; }
    const g = this.g;
    if (g.systems.alarm.active && !g.systems.alarm.silenced) { g.asphalt.say('sleep_denied', {}, { force: true }); return; }
    const bunk = g.layout.seats.find((s) => s.kind === 'bed');
    this.fadeAction(() => {
      if (bunk && g.player.seat !== bunk) { if (g.player.state === 'seated') g.systems.exitPressed(); g.systems.sit(bunk); }
      this.sleeping = true;
      this.sleepStart = g.time;
      this.prevLight = g.systems.lightMode;
      g.systems.lightMode = 'night';
      g.systems.sleeping = true;
      g.timeScale = 240;
      g.asphalt.say('sleep', {}, { force: true });
    });
  }

  wake() {
    const g = this.g;
    if (!this.sleeping) return;
    this.sleeping = false;
    g.systems.sleeping = false;
    g.timeScale = 1;
    if (this.prevLight) { g.systems.lightMode = this.prevLight; this.prevLight = null; }
    g.hud.setFade(0);
    const h = (g.time - this.sleepStart) / 3.6e6;
    g.asphalt.say('wake', { h: h < 1 ? Math.round(h * 60) + '分' : h.toFixed(1) + '時間' }, { force: true });
  }

  updateSleep() {
    const g = this.g;
    if (!this.sleeping) return;
    if (g.player.state !== 'seated' || (g.time - this.sleepStart) > 8 * 3.6e6) this.wake();
  }

  // ================================================================== dock repair
  dockRepair() {
    const g = this.g, ap = g.autopilot;
    if (!(ap.state === 'hold' && ap.target && ap.target.kind === 'dock')) { g.asphalt.say('dock_far', {}, { force: true }); return; }
    g.hud.setFade(1);
    setTimeout(() => {
      g.damage.repairAll();
      const ls = g.lifeSupport;
      ls.reserve.o2 = 9100; ls.reserve.n2 = 17000; ls.water = 180;
      for (const z of Object.values(ls.z)) { z.n2 = 79.2; z.o2 = 21.3; z.co2 = 0.04; z.leaks = []; }
      ls.lockdown = false;
      g.damage.coolant = 1;
      for (const d of Object.values(g.doors)) { d.jammed = 0; d.locked = false; }
      this.kit = { patches: 6, clamps: 5, sealant: 8, parts: 4 };
      g.player.health = 1; g.player.suitO2 = 1; g.player.suitFuel = 1;
      g.flight.engineHealth = 1; g.flight.rcsHealth = 1;
      g.time += 6 * 3.6e6;
      g.systems.alarm.active = false;
      g.asphalt.say('docked', {}, { force: true });
      g.hud.setFade(0);
    }, 2500);
  }

  // ================================================================== re-entry / landing
  groundImpact(speed, vn, water) {
    const g = this.g;
    const seated = g.player.state === 'seated';
    this.landingSaid = true;
    const lethal = water ? 90 : 60;
    if (speed > lethal) {
      // the ship breaks up on impact
      g.shake = 3;
      g.engine.grade.set('uFlash', 1.2);
      g.audio.impact(V(0, -2, -4), 1);
      if (water) g.audio.splash(1.5);
      for (let i = 0; i < 8; i++) {
        const z = -11 + Math.random() * 18;
        g.damage.impact(sectionPoint(z, -Math.PI / 2 + (Math.random() - 0.5) * 2.4, 0), V(0, 1, 0), 3e6);
      }
      g.player.health = 0;
      setTimeout(() => this.die(), 300);
      return;
    }
    const sev = speed / lethal;
    g.shake = Math.min(3, 0.4 + sev * 3);
    g.audio.impact(V(0, -2, -2), Math.min(1, sev + 0.2));
    if (water) { g.audio.splash(0.5 + sev); if (g.fx) g.fx.burst('splash', V(0, -1.2, -2), V(0, 1, 0), 160, { speed: 6 + sev * 8, spread: 1.2 }); }
    else if (g.fx) g.fx.burst('debris', V(0, -2.2, -2), V(0, 1, 0), 140, { speed: 4 + sev * 4, spread: 1.5 });
    // belly damage: dents everywhere, breaches when hard
    if (sev > 0.1) {
      const n = Math.ceil(sev * 7);
      for (let i = 0; i < n; i++) {
        const z = -10 + Math.random() * 18;
        const p = sectionPoint(z, -Math.PI / 2 + (Math.random() - 0.5) * 1.4, 0);
        g.damage.impact(p, V(0, 1, 0), 1.6e5 * sev * sev * (0.5 + Math.random()) * (water ? 0.6 : 1));
      }
    }
    // everything loose keeps falling when the hull stops
    const dv = V(0, Math.min(40, Math.max(0, vn)), 0);
    g.phys.kick(dv, 3, null, Math.min(1, sev * 1.6));
    if (!seated) { g.player.vel.addScaledVector(dv, -1); g.player.health = Math.max(0.05, g.player.health - sev * 0.6); }
    setTimeout(() => g.asphalt.say(water ? 'splash' : 'landing', {}, { force: true }), 2500);
  }

  buildGround() {
    const g = this.g, f = g.flight;
    this.removeGround();
    const N = 41, S = 3.5;
    const r0 = f.pos.length();
    const verts = new Float32Array(N * N * 3);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = (i - (N - 1) / 2) * S, z = (j - (N - 1) / 2) * S;
      tmp.set(x, 0, z).applyQuaternion(f.quat).add(f.pos);
      const t = g.terrainAt(tmp);
      const h = t.water ? t.h - 6 : t.h;           // seabed (the sea itself is swimming)
      const y = R_EARTH + h - r0 - (x * x + z * z) / (2 * R_EARTH);
      const k = (i * N + j) * 3;
      verts[k] = x; verts[k + 1] = y; verts[k + 2] = z;
    }
    const idx = [];
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
      const a = i * N + j, b = a + 1, c = a + N, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    const desc = RAPIER.ColliderDesc.trimesh(verts, new Uint32Array(idx)).setFriction(0.9);
    this.ground = g.phys.world.createCollider(desc, g.phys.fixed);
  }

  removeGround() {
    if (this.ground) { this.g.phys.world.removeCollider(this.ground, true); this.ground = null; }
  }

  updateReentry(dt) {
    const g = this.g, f = g.flight;
    const q = f.heatFlux;
    // outside air pressure for the life support
    g.lifeSupport.ambient = g.docking.docked ? 101.3 : f.alt < 100000 ? 101.325 * Math.exp(-Math.max(0, f.alt - HULL_BOTTOM) / 8434) : 0;
    const heat = Math.max(0, Math.min(1.6, (f.hullTemp - 650) / 900));
    const vAir = V(7.292e-5 * f.pos.z, 0, -7.292e-5 * f.pos.x);
    const travel = f.vel.clone().sub(vAir).applyQuaternion(f.quat.clone().invert());
    const sp = travel.length();
    if (sp > 1e-3) travel.divideScalar(sp); else travel.set(0, 0, -1);
    g.shipVis.setHeat(heat, travel);
    g.engine.grade.set('uHeat', Math.min(1, heat * 0.8));
    const plasma = Math.min(1.3, Math.max(0, q - 1.2e4) / 2.2e5);
    this.sheath.visible = plasma > 0.01;
    this.sheath.material.uniforms.uH.value = plasma;
    this.sheath.material.uniforms.uT.value = performance.now() / 1000 % 100;
    this.sheath.material.uniforms.uDir.value.copy(travel);
    if (q > 3e3) {
      g.shake = Math.max(g.shake, Math.min(2, q / 5e4));
      const gain = Math.min(0.6, q / 8e4);
      g.audio.noiseLoop('reentry', { type: 'brown', freq: 300, q: 0.4, gain, filter: 'lowpass', direct: true });
      g.audio.setLoopGain('reentry', gain);
      if (this.reentryWarned < 1) { this.reentryWarned = 1; g.asphalt.say('reentry', {}, { force: true }); this.raise(0.8); }
      if (f.hullTemp > 1500 && this.reentryWarned < 2) { this.reentryWarned = 2; g.asphalt.say('reentry_hot', {}, { force: true }); }
      if (g.fx && Math.random() < dt * 40 * plasma) {
        const p = V((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, -12 + Math.random() * 20);
        g.fx.burst('plasma', p, travel.clone().negate(), 1, { speed: Math.min(300, sp) * 0.15 });
      }
    } else {
      if (g.audio.loops.has('reentry')) g.audio.setLoopGain('reentry', 0, 1);
      if (q < 500) this.reentryWarned = 0;
    }
    // overheating burns through the skin and hurts equipment
    if (f.hullTemp > 1650 && Math.random() < dt * (f.hullTemp - 1650) / 300) {
      const z = -12 + Math.random() * 10;
      g.damage.impact(sectionPoint(z, Math.random() * Math.PI * 2, 0), travel.clone().negate(), 2.5e5);
    }
    if (f.hullTemp > 2700 && g.player.state !== 'dead') { g.player.health = 0; this.die(); }
    // wind in the atmosphere
    if (f.alt < 70000 && !f.landed) {
      const gain = Math.min(0.32, f.dynPressure / 15000);
      g.audio.noiseLoop('wind', { type: 'pink', freq: 500, q: 0.5, gain, filter: 'lowpass', direct: true });
      g.audio.setLoopGain('wind', gain);
      g.audio.setLoopFreq('wind', 300 + Math.min(2500, sp * 3));
      if (gain > 0.05) g.shake = Math.max(g.shake, gain * 0.6);
    } else if (g.audio.loops.has('wind')) g.audio.setLoopGain('wind', f.landed ? 0.02 : 0, 1);
    // ground proximity tones: faster as the ground comes up while sinking
    if (!f.landed && f.groundAlt < 300 && f.vertSpeed < -2.5) {
      this.gpwsT = (this.gpwsT || 0) - dt;
      if (this.gpwsT <= 0) {
        this.gpwsT = Math.max(0.12, Math.min(1.2, f.groundAlt / 220));
        g.audio.beep(f.vertSpeed < -8 ? 1250 : 980, 0.07, 0.09, { pos: V(0, 1.9, -10.0) });
      }
    }
    // gravity notice
    if (g.gLocal.length() > 3 && !this.gravityAnnounced) { this.gravityAnnounced = true; g.asphalt.say('gravity', {}, { minGap: 60 }); }
    if (g.gLocal.length() < 1) this.gravityAnnounced = false;
    if (f.landed && !this.ground) this.buildGround();
    if (!f.landed && this.ground) this.removeGround();
  }

  // ================================================================== exterior effects
  updateExterior(dt) {
    const g = this.g, f = g.flight, fx = g.fx;
    const t = performance.now() / 1000;
    const M = g.shipVis.M;
    const power = g.systems.power ?? 1;
    M.navRed.emissiveIntensity = 1.6 * power; M.navGreen.emissiveIntensity = 1.6 * power;
    // anti-collision strobe: a short double blink every 2.4 s, bright but not a screen-filling
    // flash (at 40x it bloomed over the whole view and the picture flickered every 1.6 s)
    const ph = t % 2.4;
    const blink = (c) => Math.max(0, 1 - Math.abs(ph - c) / 0.035);   // short soft-edged pulse
    M.navWhite.emissiveIntensity = 4 * power * Math.max(blink(0.035), blink(0.22));
    // main engine plume from thrust toward -z (exhaust out of +z)
    const qInv = f.quat.clone().invert();
    const thrLocal = f.thrustAcc.clone().applyQuaternion(qInv);
    const fwdThrust = Math.max(0, -thrLocal.z) / 15;
    const p = Math.min(1.3, fwdThrust * 2.2 + (f.ultra ? 0.3 : 0)) * (f.engineHealth > 0.05 ? 1 : 0);
    this.plumeP += (p - this.plumeP) * Math.min(1, dt * 4);
    this.plume.visible = this.plumeP > 0.01;
    this.plume.material.uniforms.uP.value = this.plumeP;
    this.plume.material.uniforms.uT.value = t % 100;
    this.plume.scale.set(1, 1, 0.6 + this.plumeP);
    M.nozzle.emissiveIntensity = this.plumeP * 2.5 + (f.ultra ? 0.8 : 0);
    if (this.plumeP > 0.04 && g.running) {
      g.audio.humLoop('engine', { freq: 36, gain: 0.08, harm: [1, 0.7, 0.45, 0.3] });
      g.audio.setLoopGain('engine', 0.05 + 0.12 * this.plumeP);
      if (fx && Math.random() < dt * 30 * this.plumeP) fx.burst('exhaust', V(0, 0.4, 19.0), V(0, 0, 1), 1, { speed: 25, spread: 0.08 });
    } else if (g.audio.loops.has('engine')) g.audio.setLoopGain('engine', 0, 0.5);
    // RCS puffs when the attitude rate changes or when translating sideways
    const dw = f.wRel.clone().sub(this.prevW);
    this.prevW.copy(f.wRel);
    const lat = Math.abs(thrLocal.x) + Math.abs(thrLocal.y) + Math.max(0, thrLocal.z);
    if (fx && g.shipVis.rcsSpots && (dw.length() > 1.5e-4 || lat > 0.25) && f.rcsHealth > 0.1) {
      const spots = g.shipVis.rcsSpots;
      const n = Math.min(4, Math.ceil(dw.length() * 3000 + lat * 2));
      for (let i = 0; i < n; i++) {
        const s = spots[Math.floor(Math.random() * spots.length)];
        fx.burst('rcs', s.p.clone().addScaledVector(s.n, 0.35), s.n, 1, { speed: 4, spread: 0.15 });
      }
      if (Math.random() < 0.25 && g.running) g.audio.rcsPuff(spots[Math.floor(Math.random() * spots.length)].p, 0.08);
    }
    // radiators glow with the reactor temperature
    const rt = g.damage.reactorTemp || 560;
    M.radiator.emissiveIntensity = Math.max(0, (rt - 540) / 600) * 0.9;
    // floodlights at night for EVA / external cameras
    const night = g.space.sunColor.r < 0.25;
    const want = (g.player.outside || g.mode === 'camera') && night && power > 0.3 ? 70 : 0;
    for (const s of this.flood) s.intensity += (want - s.intensity) * Math.min(1, dt * 3);
  }

  // ================================================================== pilot arms
  updateArms() {
    const g = this.g, pl = g.player, c = g.systems.controls;
    const on = g.mode === 'pilot' && pl.state === 'seated' && pl.seat && pl.seat.kind === 'pilot' && c.stick;
    this.arms.visible = !!on;
    if (!on) return;
    const seg = (m, a, b, len) => {
      const d = b.clone().sub(a);
      m.position.copy(a).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
      m.scale.y = a.distanceTo(b) / len;
    };
    const eye = pl.seat.eye;
    // grip points follow the animated controls
    const stickGrip = V(0, 0.15, 0).applyEuler(c.stick.rotation).add(c.stick.position).add(c.stick.parent.position);
    const thrGrip = V(0, 0.125, 0).applyEuler(c.throttle.rotation).add(c.throttle.position).add(c.throttle.parent.position);
    [[1, stickGrip], [-1, thrGrip]].forEach(([side, grip], i) => {
      const P = this.armParts[i];
      const sh = eye.clone().add(V(side * 0.2, -0.27, 0.06));
      const elbow = sh.clone().lerp(grip, 0.5).add(V(side * 0.09, -0.13, 0.07));
      seg(P.upper, sh, elbow, 0.36);
      seg(P.fore, elbow, grip.clone().add(V(0, 0.01, 0.04)), 0.32);
      P.hand.position.copy(grip).add(V(0, 0.0, 0.01));
      P.hand.quaternion.setFromUnitVectors(V(0, 0, 1), grip.clone().sub(elbow).normalize());
    });
  }

  // ================================================================== viewmodel
  updateViewmodel(dt) {
    const g = this.g, pl = g.player;
    const show = this.held && g.mode !== 'camera' && pl.state !== 'dead' && pl.state !== 'seated';
    this.vm.visible = !!show;
    if (!show) return;
    this.vmKit.visible = this.held === 'kit';
    this.vmCup.visible = this.held === 'coffee';
    const zeroG = pl.state === 'float' || pl.state === 'eva';
    this.vmMug.visible = !zeroG; this.vmCoffee.visible = !zeroG && this.coffeeLevel > 0; this.vmPouch.visible = zeroG; this.vmStraw.visible = zeroG;
    this.vmCoffee.position.y = 0.012 + 0.065 * this.coffeeLevel;
    this.sipT = Math.max(0, (this.sipT || 0) - dt * 1.5);
    const t = performance.now() / 1000;
    const sway = V(Math.sin(t * 1.3) * 0.006, Math.sin(t * 2.1) * 0.004 + Math.sin(pl.headBob) * 0.008, 0);
    const local = this.held === 'kit' ? V(0.22, -0.26, -0.48) : V(0.2 - this.sipT * 0.12, -0.22 + this.sipT * 0.14, -0.42 + this.sipT * 0.16);
    local.add(sway);
    const q = pl.lookQuat.clone();
    this.vm.position.copy(pl.eyeLocal).add(local.applyQuaternion(q));
    this.vm.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.15 - this.sipT * 0.7, -0.4, 0.05)));
    if (this.held === 'coffee' && g.fx && !zeroG && Math.random() < dt * 3 && this.coffeeLevel > 0) g.fx.burst('steam', this.vm.position.clone().add(V(0, 0.09, 0)), V(0, 1, 0), 1, { speed: 0.08 });
  }

  // ================================================================== comms
  updateComms(dt) {
    const g = this.g;
    this.commsT -= dt;
    if (this.commsT > 0) return;
    this.commsT = 1;
    const d = g.stations.nearestRelay(g.flight.pos);
    g.systems.relayDist = d;
    const ant = g.damage.health.comms;
    g.systems.signal = Math.max(0, Math.min(1, (1 - d / 2.5e6) * ant)) * ((g.systems.power ?? 1) > 0.2 ? 1 : 0);
    if (g.systems.signal < 0.05 && g.audio.musicOn) g.audio.setMusic(false);
  }

  // ================================================================== loose objects
  updateLoose(dt) {
    const g = this.g;
    if (!g.loose || !g.audio.ready) return;
    for (const it of g.loose.items) {
      if (it.stowed) continue;
      const v = it.body.linvel();
      const nv = V(v.x, v.y, v.z);
      const dv = nv.distanceTo(it.prevV);
      it.knockT -= dt;
      if (dv > 0.7 && it.knockT <= 0) {
        it.knockT = 0.12;
        const soft = it.kind === 'plush' || it.kind === 'cushion' || it.kind === 'ball';
        g.audio._burst(it.mesh.position.clone(), { dur: soft ? 0.08 : 0.12, freq: soft ? 300 : 900 + Math.random() * 1600, q: soft ? 0.7 : 3, gain: Math.min(0.25, dv * (soft ? 0.02 : 0.06)), type: soft ? 'pink' : 'white' });
      }
      it.prevV.copy(nv);
    }
  }

  // ================================================================== main update
  update(dt) {
    const g = this.g;
    if (g.player.state === 'dead') return;
    this.processEvents();
    this.updateWatched();
    this.updateCrew(dt);
    this.updateAlarm(dt);
    this.updateAirlock(dt);
    this.updateEva(dt);
    this.updateIssueProxies();
    this.updateRepair(dt);
    this.updateReentry(dt);
    this.updateComms(dt);
    this.updateSleep();
    this.updateLoose(dt);
    const ls = g.lifeSupport;
    // door safety interlocks: no opening against a pressure difference
    for (const d of Object.values(g.doors)) {
      if (d.id === 'airlock') continue;
      const [a, b] = d.def.zones;
      d.locked = d.open < 0.05 && Math.abs(ls.pressure(a) - ls.pressure(b)) > 8;
    }
    // valves: animate the hand wheels
    for (const v of g.layout.valves || []) {
      if (!v.wheel) continue;
      v.turn += ((v.open ? 0 : Math.PI * 3) - v.turn) * Math.min(1, dt * 2);
      v.wheel.rotation.y = v.turn;
    }
    // decompression: air rushes toward open breaches / broken windows
    const vents = [];
    for (const b of g.damage.breaches) if (!b.patched) vents.push({ pos: b.pos, r: b.r, zone: b.zone, id: 'breach' + b.id });
    g.damage.cracks.forEach((c, i) => {
      if (!c || !c.broken) return;
      const o = OPENINGS[i];
      vents.push(o ? { pos: o.center, r: 0.35, zone: o.room, id: 'win' + i } : { pos: V(0, 1.6, -12.4), r: 0.6, zone: 'cockpit', id: 'win' + i });
    });
    const flows = [];
    for (const b of vents) {
      const zp = ls.pressure(b.zone);
      const dp = zp - ls.ambient;
      if (dp < 1) { if (g.audio.loops.has(b.id)) g.audio.stopLoop(b.id); continue; }
      flows.push({ b, zp, s: Math.min(30, b.r * b.r * 4000 * dp / 101) });
      const gain = Math.min(0.5, (0.05 + b.r * 15) * Math.min(1, dp / 30));
      g.audio.noiseLoop(b.id, { pos: b.pos.clone(), type: 'white', freq: 2600, q: 0.4, gain });
      g.audio.setLoopGain(b.id, gain);
    }
    g.fx.airflow = flows.length ? (pos) => {
      let v = null;
      for (const { b, zp } of flows) {
        const d = b.pos.clone().sub(pos);
        const l = d.length();
        if (l > 6) continue;
        const s = Math.min(8, b.r * 120 * zp / 101 / Math.max(0.3, l * l));
        v = (v || V(0, 0, 0)).addScaledVector(d.normalize(), s);
      }
      return v;
    } : null;
    for (const { b, s } of flows) {
      if (s < 0.5) continue;
      for (const it of g.phys.loose) {
        const tp = it.body.translation();
        const ip = V(tp.x, tp.y, tp.z);
        if (ls.zoneAt(ip) !== b.zone) continue;
        const d = b.pos.clone().sub(ip);
        const l = d.length();
        if (it.stowed) { if (s > 6 && l < 3 && Math.random() < dt * 0.4) g.phys.release(it); continue; }
        if (l < 5) it.body.applyImpulse(d.normalize().multiplyScalar(s * 0.02 * dt * 60 / (1 + l * l)), true);
      }
      if (ls.zoneOfPlayer === b.zone && !g.player.suit && g.player.state !== 'seated') {
        const d = b.pos.clone().sub(g.player.pos); const l = d.length();
        if (l < 6) g.player.vel.addScaledVector(d.normalize(), s * 0.012 * dt / (1 + l * l * 0.3));
      }
    }
    // hissing pipe leaks
    for (const s of g.layout.pipes) {
      const id = 'leak' + s.id;
      if (s.leak > 0.01) {
        const S = PIPE_SYSTEMS[s.sys];
        const gain = (this.valveOpen(s) ? 1 : 0.12) * Math.min(0.35, 0.05 + s.leak * 0.4);
        g.audio.noiseLoop(id, { pos: s.mid.clone(), type: S.leak === 'water' ? 'pink' : 'white', freq: S.leak === 'water' ? 900 : 3200, q: 0.5, gain });
        g.audio.setLoopGain(id, gain);
      } else if (g.audio.loops.has(id)) g.audio.stopLoop(id);
    }
    // ventilation sound follows the fans
    const fansOn = ls.fans.on && ls.fans.health > 0.2 && (g.systems.power ?? 1) > 0.2;
    for (const [id, v] of [['ventMain', 0.035], ['ventCockpit', 0.02], ['lsFans', 0.04]]) g.audio.setLoopGain(id, fansOn ? v : 0, 0.8);
    // sunrise / sunset: the hull creaks as it heats and cools
    const lit = g.space.sunColor.r > 0.25;
    if (this.wasLit !== undefined && lit !== this.wasLit && !g.flight.landed) {
      for (let i = 0; i < 3; i++) {
        const p = V((Math.random() - 0.5) * 4, Math.random() * 2.4, -10 + Math.random() * 18);
        setTimeout(() => g.audio.creak(p, 0.3 + Math.random() * 0.4), 1500 + Math.random() * 20000);
      }
      if (lit && !this.sleeping) g.asphalt.say('sunrise', {}, { minGap: 5400 });
    }
    this.wasLit = lit;
    // window condensation while the cabin air is falling
    g.shipVis.setFrost(Math.min(1, ls.z[ls.zoneOfPlayer].fog * 2));
    g.asphalt.update(dt, !g.systems.alarm.active && g.mode !== 'camera' && !this.sleeping);
  }

  updateVisual(dt) {
    this.updateExterior(dt);
    if (this.g.running) { this.updateViewmodel(dt); this.updateArms(); }
  }

  // ================================================================== persistence
  serialize() {
    const g = this.g;
    return {
      kit: this.kit, held: this.held, coffee: this.coffeeLevel,
      valves: (g.layout.valves || []).map((v) => v.open),
      airlockMode: g.airlockMode || 'idle',
    };
  }

  restore(d) {
    const g = this.g;
    if (d.kit) this.kit = d.kit;
    if (d.held) this.hold(d.held);
    if (d.coffee !== undefined) this.coffeeLevel = d.coffee;
    (d.valves || []).forEach((o, i) => { const v = (g.layout.valves || [])[i]; if (v) v.open = o; });
    g.airlockMode = d.airlockMode || 'idle';
  }
}
