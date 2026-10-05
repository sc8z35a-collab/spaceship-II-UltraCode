// In-world monitors: each slot gets a canvas UI (drawn with Kit) composited with an optional
// live external-camera feed. Taps on the 3D screen are mapped to canvas coordinates.
import * as THREE from 'three';
import { Kit, COL } from './monitorKit.js';
import { LAYER_NEAR, LAYER_FAR, LAYER_MID } from '../core/layers.js';
import { formatDate, R_EARTH } from '../core/astro.js';
import { ZONES } from '../ship/lifeSupport.js';
import { EXT_CAMS } from '../ship/systems.js';
import { placeName } from './places.js';
import { RANGES } from '../core/layers.js';
import { passRange } from '../core/engine.js';
import { QUALITY, QUALITY_JP } from '../core/quality.js';
import { STATUS_JP } from '../world/worldDamage.js';

const SCREEN_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SCREEN_FRAG = /* glsl */`
uniform sampler2D tUI; uniform sampler2D tFeed; uniform float uFeed; uniform vec4 uFeedRect;
uniform float uPower; uniform float uGlitch; uniform float uTime; uniform float uBright; uniform float uGrid;
varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  if (uGlitch > 0.0){ float band = step(0.985 - uGlitch * 0.05, h(vec2(floor(uv.y * 40.0), floor(uTime * 12.0)))); uv.x += band * (h(vec2(uTime, uv.y)) - 0.5) * 0.08 * uGlitch; }
  vec4 ui = texture2D(tUI, uv);
  vec3 c = ui.rgb;
  if (uFeed > 0.5){
    vec2 fr = (uv - uFeedRect.xy) / uFeedRect.zw;
    if (fr.x > 0.0 && fr.x < 1.0 && fr.y > 0.0 && fr.y < 1.0){
      vec3 f = texture2D(tFeed, fr).rgb;
      c = mix(f, ui.rgb, ui.a);
    }
  }
  // pixel grid (faded out where its cells get smaller than a couple of screen pixels — a grid
  // finer than the screen's own pixels shimmers as moire whenever the head moves) + edge falloff
  vec2 gp = vUv * vec2(640.0, 360.0);
  vec2 px = fract(gp);
  float gk = uGrid * (1.0 - smoothstep(0.25, 0.5, max(fwidth(gp.x), fwidth(gp.y))));
  c *= 1.0 - gk + gk * smoothstep(0.0, 0.25, min(px.x, px.y));
  vec2 d = vUv - 0.5; c *= 1.0 - dot(d, d) * 0.35;
  if (uGlitch > 0.0) c += (h(vUv * 300.0 + uTime) - 0.5) * 0.25 * uGlitch;
  float on = uPower;
  gl_FragColor = vec4(c * uBright * on + vec3(0.004, 0.006, 0.008), 1.0);
}`;

export class Monitors {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.byId = {};
    this.camIndex = 0;
    this.feedTimer = 0;
    this.selDest = null;
  }

  init() {
    const g = this.g;
    const root = g.shipVis.root;
    for (const slot of g.layout.monitors) this.addSlot(slot, root);
    // camera feed render targets
    this.feedRT = new THREE.WebGLRenderTarget(480, 270, { type: THREE.HalfFloatType });
    this.feedLDR = new THREE.WebGLRenderTarget(480, 270, { type: THREE.UnsignedByteType });
    this.feedLDR.texture.colorSpace = THREE.SRGBColorSpace;
    this.feedCam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 2e9);
    this.feedCam.matrixAutoUpdate = false;
    this.feedCams = {};
    for (const k of ['far', 'mid', 'near']) {
      const c = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 1e9);
      c.matrixAutoUpdate = false; c.matrixWorldAutoUpdate = false;
      c.layers.set(k === 'far' ? LAYER_FAR : k === 'mid' ? LAYER_MID : LAYER_NEAR);
      this.feedCams[k] = c;
    }
    this.toneScene = new THREE.Scene();
    this.toneCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.toneQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { tIn: { value: this.feedRT.texture }, uExp: { value: 1.0 }, uNoise: { value: 0 }, uTime: { value: 0 }, uGrain: { value: 0.04 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tIn; uniform float uExp; uniform float uNoise; uniform float uTime; uniform float uGrain; varying vec2 vUv;
        vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
        void main(){
          vec3 c = texture2D(tIn, vUv).rgb * uExp;
          c = aces(c);
          float g = dot(c, vec3(0.3, 0.59, 0.11));
          c = mix(c, vec3(g) * vec3(0.9, 1.0, 1.05), 0.15);
          c += (h(vUv * 500.0) - 0.5) * (uGrain + uNoise);
          if (uNoise > 0.5) c = vec3(h(vUv * 300.0 + uTime));
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    }));
    this.toneQuad.frustumCulled = false;
    this.toneScene.add(this.toneQuad);
  }

  /**
   * A screen for a slot { id, pos, n, up, w, h, res } placed in parent (local coordinates). offset:
   * where that parent's origin sits in the physics frame (the eye's frame) — H8's cockpit screens
   * live in H8 but are looked at from B-29's frame.
   */
  addSlot(slotIn, parent, offset = null) {
    const g = this.g;
    const slot = offset ? Object.assign({}, slotIn, { pos: slotIn.pos.clone().add(offset), local: slotIn.pos.clone() }) : slotIn;
    const lpos = slot.local || slot.pos;
    const W = slot.res, H = Math.round(slot.res * slot.h / slot.w);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const kit = new Kit(canvas);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tUI: { value: tex }, tFeed: { value: null }, uFeed: { value: 0 }, uFeedRect: { value: new THREE.Vector4(0, 0, 1, 1) },
        uPower: { value: 1 }, uGlitch: { value: 0 }, uTime: { value: 0 }, uBright: { value: 1.6 }, uGrid: { value: 0.1 },
      },
      vertexShader: SCREEN_VERT, fragmentShader: SCREEN_FRAG,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(slot.w, slot.h), mat);
    const X = new THREE.Vector3().crossVectors(slot.up, slot.n).normalize();
    const Y = new THREE.Vector3().crossVectors(slot.n, X).normalize();
    mesh.matrix.makeBasis(X, Y, slot.n).setPosition(lpos);
    mesh.matrixAutoUpdate = false;
    mesh.layers.set(LAYER_NEAR);
    parent.add(mesh);
    // bezel + glass
    const bez = new THREE.Mesh(new THREE.BoxGeometry(slot.w + 0.035, slot.h + 0.035, 0.03), g.shipVis.M.plasticK);
    bez.matrix.copy(mesh.matrix).multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.017));
    bez.matrixAutoUpdate = false; bez.layers.set(LAYER_NEAR);
    bez.castShadow = true; bez.receiveShadow = true;
    parent.add(bez);
    const rate = { nav: 8, status: 6, cam: 3, airlock: 6, h8nav: 8, h8sys: 6, h8cam: 4 }[slot.id] || 4;
    const m = { slot, id: slot.id, canvas, kit, tex, mat, mesh, W, H, t: Math.random(), rate, baseRate: rate, tab: 0, boot: 0 };
    m.lo = { canvas, kit, tex, W, H };
    this.list.push(m);
    this.byId[slot.id] = m;
    g.interact.addMesh(mesh, (hit) => this.tap(m, hit), { maxDist: 2.6 });
    return m;
  }

  /** quality: smaller, slower camera feeds and slower redraws of the screens nobody is reading */
  setQuality(low) {
    this.low = low;
    const w = low ? 320 : 480, h = low ? 180 : 270;
    if (this.feedRT && this.feedRT.width !== w) { this.feedRT.setSize(w, h); this.feedLDR.setSize(w, h); }
    for (const m of this.list) {
      const r = { nav: 8, status: 6, cam: 3, airlock: 6, h8nav: 8, h8sys: 6, h8cam: 4 }[m.id] || 4;
      m.baseRate = low ? Math.max(2, Math.round(r * 0.6)) : r;
      if (m.rate < 15) m.rate = m.baseRate;
    }
  }

  /** while a monitor is looked at closely its canvas is rendered at a higher resolution and rate */
  setFocus(m, on) {
    m.rate = on ? Math.max(m.baseRate, this.low ? 10 : 15) : m.baseRate;
    m.mat.uniforms.uGrid.value = on ? 0.035 : 0.1;
    m.t = 999;
    const L = on ? this.hiRes(m) : m.lo;
    if (m.canvas === L.canvas) return;
    // two canvases per screen (the sharp one kept for the last couple of screens looked at), so
    // going in and out swaps a texture instead of reallocating one
    m.canvas = L.canvas; m.kit = L.kit; m.tex = L.tex; m.W = L.W; m.H = L.H;
    m.mat.uniforms.tUI.value = L.tex;
    this.draw(m);
    L.tex.needsUpdate = true;
  }

  hiRes(m) {
    this.hiLRU = (this.hiLRU || []).filter((x) => x !== m);
    this.hiLRU.push(m);
    while (this.hiLRU.length > 2) {
      const o = this.hiLRU.shift();
      if (o.hi && o.canvas !== o.hi.canvas) { o.hi.tex.dispose(); o.hi.canvas.width = o.hi.canvas.height = 1; o.hi = null; }
    }
    if (m.hi) return m.hi;
    const W = Math.min(1600, Math.round(m.slot.res * 2.4)), H = Math.round(W * m.slot.h / m.slot.w);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    m.hi = { canvas, kit: new Kit(canvas), tex, W, H };
    return m.hi;
  }

  /** a tap while zoomed in on monitor m: press its buttons, or leave when tapping beside it */
  focusTap(m, tap, camera) {
    this._ray = this._ray || new THREE.Raycaster();
    this._ray.setFromCamera(new THREE.Vector2(tap.x, tap.y), camera);
    this._ray.layers.enableAll();
    const hit = this._ray.intersectObject(m.mesh, false)[0];
    if (!hit) { this.g.exitFocus(); return; }
    this.press(m, hit);
  }

  tap(m, hit) {
    if (!hit.uv) return;
    // first tap on a screen leans in so it fills the view; buttons are pressed from there
    if (!this.g.focus || this.g.focus.m !== m || this.g.focus.out) { this.g.enterFocus(m); return; }
    this.press(m, hit);
  }

  press(m, hit) {
    if (!hit.uv) return;
    if (m.slot.h8 ? !(this.g.h8 && this.g.h8.screenPower() > 0.1) : (this.g.systems.power ?? 1) < 0.15) return;
    const px = hit.uv.x * m.W, py = (1 - hit.uv.y) * m.H;
    const ok = m.kit.hit(px, py);
    this.g.audio.click(m.slot.pos, ok ? 0.25 : 0.12);
    if (ok) { this.g.audio.beep(ok ? 1320 : 400, 0.04, 0.05, { pos: m.slot.pos }); m.t = 999; }
  }

  // ------------------------------------------------------------------ update / draw
  update(dt) {
    const g = this.g;
    const eye = g.player.eyeLocal;
    const power = g.systems.power ?? 1;
    const servers = g.damage ? g.damage.health.servers : 1;
    const time = performance.now() / 1000;
    let feedWanted = false;
    // only screens in front of the viewer are redrawn
    const cam = g.engine.camera;
    this._frustum = this._frustum || new THREE.Frustum();
    this._pm = this._pm || new THREE.Matrix4();
    this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pm);
    this._sph = this._sph || new THREE.Sphere();
    let feedD = 5;
    for (const m of this.list) {
      const d = m.slot.pos.distanceTo(eye);
      this._sph.center.setFromMatrixPosition(m.mesh.matrixWorld);
      this._sph.radius = Math.max(m.slot.w, m.slot.h);
      const inView = this._frustum.intersectsSphere(this._sph);
      // the live camera picture goes to the nearest screen that shows one (every frame, not only
      // when its own page is redrawn)
      if (m.feed && d < feedD && (inView || d < 1.5)) { feedD = d; feedWanted = true; this.feedSrc = m.feedSrc || null; }
      m.mat.uniforms.uTime.value = time % 100;
      if (m.slot.h8) {
        // H8's screens run on H8's power and computers (B-29's troubles do not reach them)
        m.mat.uniforms.uPower.value = g.h8 ? g.h8.screenPower() : 1;
        m.mat.uniforms.uGlitch.value = 0;
      } else {
        m.mat.uniforms.uPower.value = power < 0.15 ? (Math.random() < 0.02 ? 0.3 : 0) : Math.min(1, 0.4 + power * 0.6);
        m.mat.uniforms.uGlitch.value = servers < 0.6 ? (0.6 - servers) * 1.6 * (0.5 + 0.5 * Math.sin(time * 3)) : 0;
      }
      if ((d > 7 || !inView) && g.mode !== 'camera' && m.boot >= 1) continue;
      m.t += dt;
      if (m.t < 1 / m.rate) continue;
      m.t = 0;
      m.boot = Math.min(1, m.boot + 0.12);
      this.draw(m);
      m.tex.needsUpdate = true;
    }
    // camera feed
    this.feedTimer -= dt;
    if (feedWanted && this.feedTimer <= 0 && g.mode !== 'camera') {
      this.feedTimer = this.low ? 1 / 4 : 1 / 8;
      this.renderFeed();
    }
  }

  renderFeed() {
    const g = this.g, r = g.engine.renderer;
    // B-29's cameras (ship frame), or a source that gives its own world pose (H8's cameras)
    let m, camHealth = 1;
    if (this.feedSrc) {
      m = this.feedSrc();
      camHealth = this.feedHealth ?? 1;
    } else {
      const c = g.systems.externalCamera(this.camIndex);
      camHealth = g.damage ? g.damage.health.cameras[((this.camIndex % 5) + 5) % 5] : 1;
      const rm = g.shipVis.root.matrix;
      const rq = new THREE.Quaternion().setFromRotationMatrix(rm);
      const wq = rq.clone().multiply(c.quat);
      const wp = c.pos.clone().applyMatrix4(rm);
      m = new THREE.Matrix4().compose(wp, wq, new THREE.Vector3(1, 1, 1));
    }
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.shadowMap.autoUpdate;
    r.setRenderTarget(this.feedRT);
    r.setClearColor(0, 1);
    r.clear(true, true, true);
    for (const k of ['far', 'mid', 'near']) {
      const cam = this.feedCams[k];
      cam.matrixWorld.copy(m);
      cam.matrixWorldInverse.copy(m).invert();
      cam.fov = 62; cam.aspect = 16 / 9;
      cam.near = RANGES[k][0]; cam.far = RANGES[k][1];
      cam.updateProjectionMatrix();
      passRange.value.set(k === 'far' ? 120000 : k === 'mid' ? 300 : 0, k === 'far' ? 1e13 : k === 'mid' ? 120000 : 300);
      r.shadowMap.needsUpdate = false;
      r.render(g.engine.scene, cam);
      if (k !== 'near') r.clearDepth();
    }
    const tq = this.toneQuad.material.uniforms;
    tq.uExp.value = 1.4;
    tq.uNoise.value = camHealth < 0.3 ? 1 : (1 - camHealth) * 0.3;
    // H8's cameras are newer: almost no sensor grain (it shimmered on the small screens)
    tq.uGrain.value = this.feedSrc ? 0.006 : 0.04;
    tq.uTime.value = performance.now() / 1000 % 100;
    r.setRenderTarget(this.feedLDR);
    r.render(this.toneScene, this.toneCam);
    r.setRenderTarget(prevTarget);
    r.shadowMap.autoUpdate = prevAuto;
  }

  setFeed(m, on, rect) {
    m.feed = on;
    m.mat.uniforms.uFeed.value = on ? 1 : 0;
    m.mat.uniforms.tFeed.value = this.feedLDR ? this.feedLDR.texture : null;
    if (rect) m.mat.uniforms.uFeedRect.value.set(rect[0], rect[1], rect[2], rect[3]);
  }

  draw(m) {
    const K = m.kit;
    K.begin();
    // H8's screens can show any of H8's pages, or (docked) B-29's own: a row of tabs on top
    const page = m.slot.h8 ? this.h8PageOf(m) : m.id;
    const fn = this['draw_' + page];
    const H = 512 * m.H / m.W;
    this._tabs = m.slot.h8 ? m : null;
    try {
      if (fn) fn.call(this, K, m, H); else this.draw_generic(K, m, H);
    } finally { this._tabs = null; }
    if (m.boot < 1) {
      K.g.fillStyle = `rgba(0,0,0,${1 - m.boot})`;
      K.g.fillRect(0, 0, m.W, m.H);
    }
    const servers = this.g.damage ? this.g.damage.health.servers : 1;
    if (m.slot.h8) K.end(0, performance.now(), false);
    else K.end(servers < 0.6 ? (0.6 - servers) * 1.5 : 0, performance.now());
  }

  header(K, title, H) {
    const g = this.g;
    // on H8's screens the header row is the page tabs
    if (this._tabs) { this.h8Tabs(K, this._tabs); return; }
    const d = formatDate(g.time);
    K.rect(0, 0, 512, 26, { fill: 'rgba(95,208,255,0.08)', stroke: null, r: 0 });
    K.line(0, 26, 512, 26, COL.line);
    K.text(title, 12, 18, { size: 12, color: COL.cyan, weight: 700 });
    K.text(`${d.date}  ${d.time}`, 500, 18, { size: 12, color: COL.text, align: 'right', mono: true });
    const al = g.systems.alarm;
    if (al.active) {
      const blink = Math.floor(performance.now() / 400) % 2;
      K.rect(190, 4, 130, 18, { fill: blink ? 'rgba(255,77,61,0.5)' : 'rgba(255,77,61,0.15)', stroke: COL.red, r: 4 });
      K.text(al.silenced ? '警報（消音中）' : '警 報', 255, 17, { size: 11, color: '#fff', align: 'center', weight: 700 });
    }
  }

  // ------------------------------------------------------------------ NAV
  draw_nav(K, m, H) {
    const g = this.g, f = g.flight;
    this.header(K, 'B-29  ナビゲーション', H);
    // orbit map
    const cx = 150, cy = 30 + (H - 30) / 2, R0 = Math.min(110, (H - 50) / 2);
    const zoom = m.zoom || 0;
    const scale = zoom === 0 ? R0 / (R_EARTH * 1.35) : zoom === 1 ? R0 / 4.4e7 : R0 / 2.8e8;
    // plane basis
    const st = g.stations;
    const e1 = st.ref.e1, e2 = st.ref.e2;
    const proj = (p) => [cx + p.dot(e2) * scale, cy - p.dot(e1) * scale];
    const er = R_EARTH * scale;
    const gr = K.g.createRadialGradient(cx * K.s, cy * K.s, 0, cx * K.s, cy * K.s, er * K.s);
    gr.addColorStop(0, '#1d4f8a'); gr.addColorStop(0.85, '#0e2f5a'); gr.addColorStop(1, '#5fb0ff');
    K.circle(cx, cy, Math.max(2, er), { fill: gr, stroke: 'rgba(130,190,255,0.5)' });
    // day/night terminator hint
    const sd = g.space.sunDir;
    const sx = sd.dot(e2), sy = sd.dot(e1);
    K.g.save(); K.g.beginPath(); K.g.arc(cx * K.s, cy * K.s, Math.max(2, er) * K.s, Math.atan2(sy, -sx) + Math.PI / 2, Math.atan2(sy, -sx) - Math.PI / 2); K.g.fillStyle = 'rgba(0,0,0,0.45)'; K.g.fill(); K.g.restore();
    // ship orbit circle
    const rr = f.pos.length() * scale;
    K.circle(cx, cy, rr, { stroke: 'rgba(95,208,255,0.55)', lw: 1 });
    // stations
    for (const s of st.list) {
      const [x, y] = proj(s.pos);
      if (Math.hypot(x - cx, y - cy) > 140) continue;
      const sel = this.selDest === s.id;
      const sst = s.dmg ? s.dmg.status : 'ok';
      const dot = sst === 'destroyed' || sst === 'failed' ? COL.dim : sst === 'critical' ? COL.red : sst === 'damaged' ? COL.amber : s.kind === 'dock' ? COL.amber : COL.green;
      K.circle(x, y, sel ? 4 : 3, { fill: dot, stroke: null });
      K.text(s.en + (sst === 'destroyed' ? ' ×' : ''), x + 6, y - 4, { size: 8, color: sel ? COL.amber : COL.dim });
    }
    // relays (dots)
    if (zoom === 0) for (let i = 0; i < st.relays.length; i += 7) { const [x, y] = proj(st.relays[i].pos); if (Math.hypot(x - cx, y - cy) < R0 + 15) K.circle(x, y, 0.6, { fill: 'rgba(160,200,255,0.4)', stroke: null }); }
    const [shx, shy] = proj(f.pos);
    const t = performance.now() / 300;
    K.circle(shx, shy, 4 + Math.sin(t) * 1, { fill: COL.cyan, stroke: '#fff' });
    K.text('B-29', shx + 7, shy + 10, { size: 9, color: COL.cyan, weight: 700 });
    // asteroids
    for (const a of g.asteroids.list) {
      if (!a.warned) continue;
      const [x, y] = proj(a.pos);
      K.circle(x, y, 3, { fill: COL.red, stroke: null });
    }
    K.button(12, H - 26, 70, 20, ['近傍', '静止軌道', '月軌道'][zoom], () => { m.zoom = ((m.zoom || 0) + 1) % 3; }, { size: 10 });
    // H8 on the map and its call / release strip
    if (g.h8) {
      if (g.h8.mode !== 'docked') {
        const [hx, hy] = proj(g.h8.flight.pos);
        if (Math.hypot(hx - cx, hy - cy) < 140) { K.circle(hx, hy, 3, { fill: COL.amber, stroke: null }); K.text('H8', hx + 6, hy - 4, { size: 8, color: COL.amber }); }
      }
      this.drawH8Strip(K, 12, 32);
    }
    {
      const es = g.elevator.dmg ? g.elevator.dmg.status : 'ok';
      K.text('宇宙エレベーター：' + STATUS_JP[es], 12, H - 34, { size: 9, color: es === 'ok' ? COL.dim : es === 'damaged' ? COL.amber : COL.red });
      // docked at a terminal on the ribbon: when the next climbers come in
      const dk = g.docking;
      if (dk && dk.state === 'docked' && dk.station && dk.station.tether && g.elevator.nextInfo && es !== 'failed' && es !== 'destroyed') {
        const fm = (w) => (w < 60 ? 'まもなく' : w < 3600 ? Math.round(w / 60) + '分後' : (w / 3600).toFixed(1) + '時間後');
        const txt = g.elevator.nextInfo(dk.station.id).map((i) => (i.up ? '↓' : '↑') + i.line + ' ' + fm(i.w)).join('   ');
        K.text('次のクライマー到着  ' + txt, 12, H - 47, { size: 8, color: COL.cyan });
      }
    }
    // right column
    const X = 300;
    K.rect(X, 34, 202, 74, { fill: COL.bg2, r: 8 });
    const sp = f.vel.clone().sub(f.refVelocity(f.pos, new THREE.Vector3())).length();
    K.text('速度', X + 10, 52, { size: 10, color: COL.dim });
    K.text(sp.toFixed(1), X + 10, 82, { size: 28, color: f.ultra ? COL.amber : COL.text, weight: 300, mono: true });
    K.text('m/s', X + 104, 82, { size: 11, color: COL.dim });
    const alt = f.alt / 1000;
    if (f.groundAlt < 8000 || f.landed) {
      // close to the surface: radar altitude in metres + vertical speed
      K.text('対地', X + 140, 52, { size: 10, color: COL.dim });
      const ga = Math.max(0, f.groundAlt);
      K.text(ga.toFixed(0), X + 192, 74, { size: 16, color: ga < 100 && f.vertSpeed < -4 ? COL.red : COL.text, align: 'right', mono: true });
      K.text('m  ' + (f.vertSpeed >= 0 ? '↑' : '↓') + Math.abs(f.vertSpeed).toFixed(1), X + 192, 92, { size: 9, color: f.vertSpeed < -6 ? COL.amber : COL.dim, align: 'right', mono: true });
    } else {
      K.text('高度', X + 140, 52, { size: 10, color: COL.dim });
      K.text(alt < 1000 ? alt.toFixed(1) : (alt / 1000).toFixed(1) + 'k', X + 192, 76, { size: 16, color: COL.text, align: 'right', mono: true });
      K.text('km', X + 192, 92, { size: 9, color: COL.dim, align: 'right' });
    }
    K.bar(X + 10, 96, 182, 5, sp / (f.ultra || sp > f.vNormal ? f.vUltra : f.vNormal), f.ultra ? COL.amber : COL.cyan);
    // ULTRA button
    const ultraStyle = f.ultra ? 'warn' : (f.engineHealth < 0.45 || f.dry ? 'disabled' : 'normal');
    K.button(X, 112, 202, 26, f.ultra ? 'ULTRA  作動中' : (f.ultraDown ? 'ULTRA  減速中…' : 'ULTRA'), () => g.systems.toggleUltra(), { style: ultraStyle, size: 13 });
    // propellant (and H8's push while it is docked)
    const fu = f.fuel;
    K.text('推進剤', X + 4, 153, { size: 9, color: COL.dim });
    K.bar(X + 40, 147, 88, 6, fu, fu < 0.15 ? COL.red : COL.amber);
    K.text(f.dry ? '空' : `${Math.round(fu * 100)}%`, X + 160, 153, { size: 9, color: fu < 0.15 ? COL.red : COL.text, align: 'right', mono: true });
    if (f.mul > 1) K.text(`H8 ×${f.mul}`, X + 202, 153, { size: 9, color: COL.amber, align: 'right', weight: 700 });
    // destinations
    K.text('目的地', X + 4, 168, { size: 10, color: COL.dim });
    let y = 173;
    const ap = g.autopilot;
    // H8 (Kaito's sub-base) is a destination too while it is away from B-29
    if (g.h8 && g.h8.mode !== 'docked') {
      const s = g.h8.navTarget();
      const d = s.pos.distanceTo(f.pos);
      const sel = this.selDest === 'h8';
      const dd = d < 1e5 ? (d / 1000).toFixed(d < 1e4 ? 1 : 0) + ' km' : (d / 1000 / 1000).toFixed(1) + ' 千km';
      K.rect(X, y, 202, 20, { fill: sel ? 'rgba(255,170,60,0.16)' : 'rgba(255,170,60,0.04)', stroke: sel ? COL.amber : 'rgba(255,170,80,0.25)', r: 5 });
      K.text('H8（サブ拠点）', X + 8, y + 14, { size: 10, color: COL.amber });
      K.text(dd, X + 196, y + 14, { size: 9, color: COL.dim, align: 'right', mono: true });
      K.buttons.push({ x: X, y, w: 202, h: 20, onTap: () => { this.selDest = 'h8'; } });
      y += 23;
    }
    for (const s of st.list) {
      const d = s.dist || s.pos.distanceTo(f.pos);
      const sel = this.selDest === s.id;
      const lbl = s.name.replace('（修理基地）', '');
      const dd = d < 1e5 ? (d / 1000).toFixed(0) + ' km' : (d / 1000 / 1000).toFixed(1) + ' 千km';
      K.rect(X, y, 202, 20, { fill: sel ? 'rgba(95,208,255,0.14)' : 'rgba(255,255,255,0.02)', stroke: sel ? COL.cyan : 'rgba(120,190,255,0.12)', r: 5 });
      const sst = s.dmg ? s.dmg.status : 'ok';
      const sc = { ok: s.kind === 'dock' ? COL.amber : COL.text, damaged: COL.amber, critical: COL.red, failed: COL.dim, destroyed: COL.dim }[sst];
      if (sst === 'ok') K.text(lbl, X + 8, y + 14, { size: 10, color: sc });
      else {
        // short name + status pill, so the distance still fits
        const short = lbl.split(/[・ ]/)[0];
        K.text(short, X + 8, y + 14, { size: 10, color: sc });
        const px = X + 14 + short.length * 10;
        K.rect(px, y + 4, 46, 13, { fill: sst === 'critical' ? 'rgba(255,77,61,0.25)' : sst === 'damaged' ? 'rgba(255,176,59,0.2)' : 'rgba(120,130,140,0.2)', stroke: sc, r: 3 });
        K.text(STATUS_JP[sst], px + 23, y + 14, { size: 8, color: sc, align: 'center', weight: 700 });
      }
      K.text(dd, X + 196, y + 14, { size: 9, color: COL.dim, align: 'right', mono: true });
      K.buttons.push({ x: X, y, w: 202, h: 20, onTap: () => { this.selDest = s.id; } });
      y += 23;
      if (y > H - 60) break;
    }
    // autopilot button
    const on = ap.state !== 'off';
    const label = on ? (ap.state === 'hold' ? '到着・保持中（解除）' : `自動操縦中  ${fmtEta(ap.eta)}（解除）`) : (this.selDest ? '自動操縦  開始' : '目的地を選択');
    K.button(X, H - 34, 202, 28, label, () => { if (on) ap.disengage(); else if (this.selDest) ap.engage(this.selDest); }, { style: on ? 'on' : this.selDest ? 'normal' : 'disabled', size: 11 });
    // dock repair when holding at the dock
    if (ap.state === 'hold' && ap.target && ap.target.kind === 'dock') {
      K.button(12, H - 54, 130, 22, 'ドッキング・修理', () => g.systems.dockRepair(), { style: 'warn', size: 10 });
    }
    // docking with a hub station (walk into its lobby)
    const dk = g.docking;
    if (dk && (dk.state !== 'free' || dk.candidate())) {
      const lbl = { free: 'ドッキング', approach: 'ドッキング中…（中止）', docked: '離脱（アンドック）', leaving: '離脱中…' }[dk.state];
      K.button(88, H - 26, 150, 22, lbl, () => dk.request(), { style: dk.state === 'docked' ? 'on' : dk.state === 'free' ? 'warn' : 'normal', size: 10 });
    }
  }

  // ------------------------------------------------------------------ SYSTEMS (schematic)
  draw_sys(K, m, H) {
    const g = this.g;
    this.header(K, 'システム', H);
    const ls = g.lifeSupport;
    // schematic: x = ship z (-13..10), y = ship x
    const ox = 20, oy = 40, w = 300, h = H - 80;
    const sx = (z) => ox + (z + 13.4) / 24 * w;
    const sy = (x) => oy + h / 2 + x / 3.2 * (h / 2);
    // hull outline
    K.g.beginPath();
    for (let i = 0; i <= 60; i++) { const z = -13.4 + i / 60 * 24; const hw = hullHW(z); const X = sx(z) * K.s, Y = sy(-hw) * K.s; if (i === 0) K.g.moveTo(X, Y); else K.g.lineTo(X, Y); }
    for (let i = 60; i >= 0; i--) { const z = -13.4 + i / 60 * 24; const hw = hullHW(z); K.g.lineTo(sx(z) * K.s, sy(hw) * K.s); }
    K.g.closePath(); K.g.strokeStyle = 'rgba(150,200,255,0.5)'; K.g.lineWidth = 1.2 * K.s; K.g.stroke();
    const rooms = {
      cockpit: [-12.5, -8.4, -1.8, 1.8], living: [-8.4, -3.0, -2.6, -0.7], bath: [-8.4, -4.6, 0.7, 2.6], corridor: [-8.4, 5.6, -0.7, 0.7],
      airlock: [-2.6, 0.6, 0.7, 2.6], ls: [0.6, 5.6, 0.7, 2.6], store: [0.4, 5.6, -2.6, -0.7], eng: [5.6, 9.6, -1.9, 1.9],
    };
    for (const [id, [z0, z1, x0, x1]] of Object.entries(rooms)) {
      const z = ls.z[id];
      const p = z.n2 + z.o2 + z.co2;
      const col = p > 90 ? 'rgba(95,224,143,0.18)' : p > 60 ? 'rgba(255,179,71,0.3)' : 'rgba(255,77,61,0.45)';
      K.rect(sx(z0), sy(x0), sx(z1) - sx(z0), sy(x1) - sy(x0), { fill: col, stroke: 'rgba(150,200,255,0.35)', r: 3 });
      if (id !== 'corridor') K.text(Math.round(p) + '', (sx(z0) + sx(z1)) / 2, (sy(x0) + sy(x1)) / 2 + 4, { size: 9, color: COL.text, align: 'center', mono: true });
      K.buttons.push({ x: sx(z0), y: sy(x0), w: sx(z1) - sx(z0), h: sy(x1) - sy(x0), onTap: () => { m.selRoom = id; } });
    }
    // doors (tap to toggle)
    for (const d of Object.values(g.doors)) {
      const def = d.def;
      let x, y, ww, hh;
      if (def.axis === 'z') { x = sx(def.at) - 2; y = sy(def.c - def.w / 2); ww = 4; hh = sy(def.c + def.w / 2) - y; }
      else { x = sx(def.c - def.w / 2); y = sy(def.at) - 2; ww = sx(def.c + def.w / 2) - x; hh = 4; }
      const col = d.locked || d.jammed >= 1 ? COL.red : d.open > 0.5 ? COL.cyan : COL.green;
      K.rect(x - 1, y - 1, ww + 2, hh + 2, { fill: col, stroke: null, r: 1 });
      K.buttons.push({ x: x - 6, y: y - 6, w: ww + 12, h: hh + 12, onTap: () => g.systems.remoteDoor(d) });
    }
    // damage markers (approximate area only)
    const blink = Math.floor(performance.now() / 350) % 2;
    for (const it of g.damage.issues) {
      if (it.state === 'fixed' || !it.pos) continue;
      const jitterX = ((it.id * 7919) % 100) / 100 - 0.5, jitterZ = ((it.id * 104729) % 100) / 100 - 0.5;
      const X = sx(it.pos.z + jitterZ * 1.5), Y = sy(it.pos.x + jitterX * 1.0);
      const c = it.state === 'patched' ? COL.amber : COL.red;
      if (it.state !== 'patched' && blink) K.circle(X, Y, 7, { stroke: c, lw: 1.2 });
      K.text('×', X, Y + 4, { size: 11, color: c, align: 'center', weight: 700 });
    }
    // right column: alarms and controls
    const X = 334;
    K.text('警報 / 異常', X, 46, { size: 10, color: COL.dim });
    let y = 52;
    const act = g.damage.issues.filter((i) => i.state !== 'fixed').slice(-5).reverse();
    if (!act.length) K.text('異常なし', X, 70, { size: 11, color: COL.green });
    for (const it of act) {
      K.rect(X, y, 170, 18, { fill: it.state === 'patched' ? 'rgba(255,179,71,0.1)' : 'rgba(255,77,61,0.12)', stroke: null, r: 4 });
      K.text((ZONES[it.zone] ? ZONES[it.zone].name + ' ' : '') + it.name, X + 6, y + 13, { size: 9, color: it.state === 'patched' ? COL.amber : COL.text });
      y += 21;
    }
    const al = g.systems.alarm;
    // graphics quality (low: about half the processing)
    K.button(X, H - 124, 170, 26, '画質  ' + QUALITY_JP[QUALITY.level] + (QUALITY.level === 'low' ? '（軽い）' : '（きれい）'), () => g.applyQuality(QUALITY.level === 'low' ? 'high' : 'low'), { style: QUALITY.level === 'low' ? 'warn' : 'normal', size: 11 });
    K.button(X, H - 92, 170, 26, al.active && !al.silenced ? '警報 消音' : '警報 消音済', () => g.systems.silenceAlarm(), { style: al.active && !al.silenced ? 'danger' : 'disabled', size: 12 });
    K.button(X, H - 62, 82, 24, ls.lockdown ? '隔壁 解除' : '隔壁 閉鎖', () => g.systems.toggleLockdown(), { style: ls.lockdown ? 'warn' : 'normal', size: 10 });
    K.button(X + 88, H - 62, 82, 24, '照明 ' + { normal: '通常', dim: '暗め', night: '夜間', off: '消灯' }[g.systems.lightMode], () => g.systems.cycleLights(), { size: 10 });
    K.text('扉はタップで遠隔開閉', ox, H - 14, { size: 9, color: COL.dim });
  }

  // ------------------------------------------------------------------ CAM
  draw_cam(K, m, H) {
    const g = this.g;
    K.g.clearRect(0, 0, m.W, m.H);
    K.buttons.length = 0;
    const c = EXT_CAMS[((this.camIndex % EXT_CAMS.length) + EXT_CAMS.length) % EXT_CAMS.length];
    const names = { chase: '後方カメラ', nose: '機首カメラ', belly: '下面カメラ', radiator: 'ラジエーター', mast: 'マスト' };
    this.setFeed(m, true, [0, 0.16, 1, 0.84]);
    K.rect(0, 0, 512, H * 0.16, { fill: 'rgba(5,13,23,0.95)', stroke: null, r: 0 });
    K.text('船外カメラ  ' + names[c.name], 10, H * 0.11, { size: 11, color: COL.cyan, weight: 700 });
    const rec = Math.floor(performance.now() / 600) % 2;
    if (rec) K.circle(495, H * 0.08, 4, { fill: COL.red, stroke: null });
    K.button(300, 4, 80, H * 0.16 - 8, '◀ 前', () => { this.camIndex--; }, { size: 10 });
    K.button(388, 4, 80, H * 0.16 - 8, '次 ▶', () => { this.camIndex++; }, { size: 10 });
    // fullscreen hint button bottom right
    K.button(400, H - 30, 104, 24, '全画面で見る', () => { this.g.extCam = this.camIndex; if (this.g.mode === 'pilot') this.g.systems.cameraPressed(); }, { style: g.mode === 'pilot' ? 'on' : 'disabled', size: 10 });
  }

  // ------------------------------------------------------------------ COMMS
  draw_comms(K, m, H) {
    const g = this.g;
    this.header(K, '通信', H);
    const sig = g.systems.signal ?? 1;
    for (let i = 0; i < 5; i++) K.rect(14 + i * 14, 70 - i * 7, 10, 12 + i * 7, { fill: sig * 5 > i ? COL.cyan : 'rgba(255,255,255,0.08)', stroke: null, r: 2 });
    K.text('5G  ' + (sig > 0.05 ? '接続' : '圏外'), 100, 60, { size: 16, color: sig > 0.05 ? COL.text : COL.red, weight: 600 });
    K.text('最寄り中継局  ' + ((g.systems.relayDist ?? 0) / 1000).toFixed(0) + ' km', 100, 78, { size: 10, color: COL.dim });
    const music = g.audio.musicOn;
    K.button(14, 92, 230, 30, music ? '♪ 5Gラジオ  再生中' : '♪ 5Gラジオ', () => g.systems.toggleMusic(), { style: music ? 'on' : sig > 0.05 ? 'normal' : 'disabled', size: 12 });
    K.button(254, 92, 120, 30, g.asphalt.voiceOn ? 'AI音声  ON' : 'AI音声  OFF', () => { g.asphalt.voiceOn = !g.asphalt.voiceOn; }, { style: g.asphalt.voiceOn ? 'on' : 'normal', size: 11 });
    // H8 over the link (within 1500 km)
    if (g.h8 && this.drawH8Comms && !this._tabs) this.drawH8Comms(K, 384, 32, 120, 92);
    K.text('アスファルト ログ', 14, 142, { size: 10, color: COL.dim });
    let y = 160;
    for (const e of g.asphalt.log.slice(-5).reverse()) {
      const d = formatDate(e.t);
      K.text(d.time, 14, y, { size: 9, color: COL.dim, mono: true });
      wrap(K, e.text, 54, y, 440, 10, COL.text, 2);
      y += 30;
      if (y > H - 10) break;
    }
  }

  // ------------------------------------------------------------------ LIFE
  draw_life(K, m, H) {
    const g = this.g, ls = g.lifeSupport;
    this.header(K, '生命維持', H);
    K.text('区画', 12, 44, { size: 9, color: COL.dim });
    K.text('気圧 kPa', 140, 44, { size: 9, color: COL.dim });
    K.text('O2', 300, 44, { size: 9, color: COL.dim });
    K.text('CO2', 350, 44, { size: 9, color: COL.dim });
    let y = 52;
    for (const [id, Z] of Object.entries(ZONES)) {
      const z = ls.z[id];
      const p = z.n2 + z.o2 + z.co2;
      const col = p > 90 ? COL.green : p > 60 ? COL.amber : COL.red;
      K.text(Z.name, 12, y + 10, { size: 10, color: id === ls.zoneOfPlayer ? COL.cyan : COL.text });
      K.bar(100, y + 3, 150, 7, p / 101.3, col);
      K.text(p.toFixed(1), 290, y + 10, { size: 9, color: COL.text, align: 'right', mono: true });
      K.text(z.o2.toFixed(1), 320, y + 10, { size: 9, color: z.o2 < 16 ? COL.red : COL.text, align: 'right', mono: true });
      K.text(z.co2.toFixed(2), 380, y + 10, { size: 9, color: z.co2 > 1 ? COL.amber : COL.text, align: 'right', mono: true });
      y += 17;
    }
    const X = 400;
    K.button(X, 46, 104, 24, ls.o2gen.on ? 'O2生成  ON' : 'O2生成  OFF', () => { ls.o2gen.on = !ls.o2gen.on; }, { style: ls.o2gen.on ? 'on' : 'warn', size: 10 });
    K.button(X, 76, 104, 24, ls.scrubber.on ? 'CO2除去 ON' : 'CO2除去 OFF', () => { ls.scrubber.on = !ls.scrubber.on; }, { style: ls.scrubber.on ? 'on' : 'warn', size: 10 });
    K.button(X, 106, 104, 24, ls.fans.on ? '換気  ON' : '換気  OFF', () => { ls.fans.on = !ls.fans.on; }, { style: ls.fans.on ? 'on' : 'warn', size: 10 });
    K.button(X, 136, 104, 24, ls.boost > 0 ? '再加圧中…' : '再加圧', () => { ls.repress(); g.asphalt.say('repress', {}, { minGap: 5 }); }, { style: ls.boost > 0 ? 'on' : 'normal', size: 10 });
    K.text('予備 O2', X, 176, { size: 9, color: COL.dim }); K.bar(X, 181, 104, 6, ls.reserve.o2 / 9100, COL.green);
    K.text('予備 N2', X, 202, { size: 9, color: COL.dim }); K.bar(X, 207, 104, 6, ls.reserve.n2 / 17000, COL.cyan);
    K.text('水 ' + ls.water.toFixed(0) + ' L', X, 228, { size: 9, color: COL.dim }); K.bar(X, 233, 104, 6, ls.water / 180, '#5f9cff');
  }

  draw_status(K, m, H) {
    const g = this.g;
    const al = g.systems.alarm;
    const blink = Math.floor(performance.now() / 300) % 2;
    K.rect(6, 6, 150, H - 12, { fill: al.active && blink && !al.silenced ? 'rgba(255,40,30,0.75)' : al.active ? 'rgba(255,77,61,0.2)' : 'rgba(95,224,143,0.1)', stroke: al.active ? COL.red : COL.green, r: 8 });
    K.text(al.active ? 'MASTER ALARM' : 'NORMAL', 81, H / 2 + 6, { size: 15, color: '#fff', align: 'center', weight: 700 });
    K.buttons.push({ x: 6, y: 6, w: 150, h: H - 12, onTap: () => g.systems.silenceAlarm() });
    const pw = g.systems.power ?? 1;
    K.text('PWR', 170, 30, { size: 11, color: COL.dim }); K.bar(210, 22, 280, 9, pw, pw > 0.7 ? COL.green : COL.amber);
    const rt = g.damage.reactorTemp || 560;
    K.text('CORE', 170, 58, { size: 11, color: COL.dim }); K.bar(210, 50, 280, 9, (rt - 300) / 700, rt > 800 ? COL.red : COL.cyan);
    K.text(Math.round(rt) + ' K', 490, 80, { size: 11, color: COL.text, align: 'right', mono: true });
  }

  draw_living(K, m, H) { this.draw_sub(K, m, H, ['状態', 'カメラ', '音楽', '照明', '扉']); }
  draw_bath(K, m, H) { this.draw_sub(K, m, H, ['状態', 'シャワー', '照明']); }

  draw_sub(K, m, H, tabs) {
    const g = this.g;
    this.header(K, m.id === 'living' ? 'リビング' : 'バスルーム', H);
    const tw = 512 / tabs.length;
    tabs.forEach((t, i) => {
      K.rect(i * tw + 2, 30, tw - 4, 24, { fill: m.tab === i ? 'rgba(95,208,255,0.2)' : 'rgba(255,255,255,0.03)', stroke: m.tab === i ? COL.cyan : COL.line, r: 6 });
      K.text(t, i * tw + tw / 2, 47, { size: 12, color: COL.text, align: 'center', weight: 600 });
      K.buttons.push({ x: i * tw, y: 30, w: tw, h: 24, onTap: () => { m.tab = i; } });
    });
    const tab = tabs[m.tab] || tabs[0];
    this.setFeed(m, tab === 'カメラ', [0.04, 0.06, 0.92, 0.72]);
    const y0 = 66;
    if (tab === '状態') {
      const f = g.flight;
      const sp = g.space;
      const lat = (sp.camLat || 0) * 180 / Math.PI, lon = (sp.camLon || 0) * 180 / Math.PI;
      K.text('現在地', 16, y0 + 14, { size: 10, color: COL.dim });
      K.text(placeName(lat, lon) + ' 上空', 16, y0 + 40, { size: 20, color: COL.text, weight: 600 });
      K.text(`${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`, 16, y0 + 60, { size: 11, color: COL.dim, mono: true });
      K.text('高度 ' + (f.alt / 1000).toFixed(0) + ' km', 300, y0 + 26, { size: 13, color: COL.text });
      const zp = g.lifeSupport.z[g.lifeSupport.zoneOfPlayer];
      K.text('室内 ' + (zp.n2 + zp.o2 + zp.co2).toFixed(1) + ' kPa / ' + (zp.T - 273.15).toFixed(1) + '℃', 300, y0 + 48, { size: 11, color: COL.text });
      const issues = g.damage.issues.filter((i) => i.state === 'active').length;
      K.text(issues ? `異常 ${issues} 件` : '異常なし', 300, y0 + 70, { size: 12, color: issues ? COL.red : COL.green });
      const al = g.systems.alarm;
      K.button(16, H - 40, 150, 30, '警報 消音', () => g.systems.silenceAlarm(), { style: al.active && !al.silenced ? 'danger' : 'disabled', size: 12 });
      K.button(176, H - 40, 150, 30, '記録（セーブ）', () => g.systems.manualSave(), { size: 12 });
      K.button(336, H - 40, 160, 30, g.systems.sleeping ? '起きる' : '眠る（時間経過）', () => g.systems.toggleSleep(), { size: 12 });
    } else if (tab === 'カメラ') {
      K.g.clearRect(0.04 * m.W, 0.22 * m.H, 0.92 * m.W, 0.72 * m.H);
      K.button(16, H - 34, 100, 26, '◀ 前', () => { this.camIndex--; }, { size: 11 });
      K.button(396, H - 34, 100, 26, '次 ▶', () => { this.camIndex++; }, { size: 11 });
    } else if (tab === '音楽' || tab === 'シャワー') {
      if (tab === '音楽') {
        K.button(60, y0 + 30, 392, 50, g.audio.musicOn ? '♪ 5Gラジオ  停止' : '♪ 5Gラジオ  再生', () => g.systems.toggleMusic(), { style: g.audio.musicOn ? 'on' : 'normal', size: 16 });
        K.text('受信 ' + ((g.systems.signal ?? 1) > 0.05 ? '良好' : '圏外'), 256, y0 + 110, { size: 11, color: COL.dim, align: 'center' });
      } else {
        const sh = g.machines && g.machines.shower;
        K.button(60, y0 + 20, 392, 50, sh && sh.on ? 'シャワー  停止' : 'シャワー  開始', () => g.machines.toggleShower(), { style: sh && sh.on ? 'on' : 'normal', size: 16 });
        K.text('水 ' + g.lifeSupport.water.toFixed(0) + ' L', 256, y0 + 100, { size: 12, color: COL.text, align: 'center' });
      }
    } else if (tab === '照明') {
      const modes = [['normal', '通常'], ['dim', '暗め'], ['night', '夜間（赤）'], ['off', '消灯']];
      modes.forEach(([k, n], i) => K.button(30 + (i % 2) * 230, y0 + 10 + Math.floor(i / 2) * 50, 220, 40, n, () => { g.systems.lightMode = k; }, { style: g.systems.lightMode === k ? 'on' : 'normal', size: 13 }));
    } else if (tab === '扉') {
      let i = 0;
      const names = { cockpit: 'コックピット', living: 'リビング', bath: 'バス', airlock: 'エアロック', ls: '生命維持室', eng: '機関室', store: '倉庫' };
      for (const d of Object.values(g.doors)) {
        const x = 16 + (i % 3) * 164, y = y0 + 6 + Math.floor(i / 3) * 40;
        K.button(x, y, 154, 32, `${names[d.id] || d.id}  ${d.open > 0.5 ? '開' : '閉'}`, () => g.systems.remoteDoor(d), { style: d.locked || d.jammed >= 1 ? 'danger' : d.open > 0.5 ? 'on' : 'normal', size: 11 });
        i++;
      }
    }
  }

  draw_airlock(K, m, H) {
    const g = this.g;
    const z = g.lifeSupport.z.airlock;
    const p = z.n2 + z.o2 + z.co2;
    K.text('エアロック', 10, 22, { size: 13, color: COL.cyan, weight: 700 });
    K.text(p.toFixed(1) + ' kPa', 500, 24, { size: 14, color: p > 90 ? COL.green : p < 1 ? COL.amber : COL.text, align: 'right', mono: true });
    K.bar(10, 34, 492, 8, p / 101.3, p > 90 ? COL.green : COL.amber);
    const mode = g.airlockMode || 'idle';
    K.button(10, 54, 160, 40, mode === 'dep' ? '減圧中…' : '減圧', () => g.systems.airlockCycle('dep'), { style: mode === 'dep' ? 'on' : 'normal', size: 13 });
    K.button(176, 54, 160, 40, mode === 'rep' ? '加圧中…' : '加圧', () => g.systems.airlockCycle('rep'), { style: mode === 'rep' ? 'on' : 'normal', size: 13 });
    const canOpen = p < 2 && g.player.suit;
    K.button(342, 54, 160, 40, g.hatch.target > 0.5 ? 'ハッチ 閉' : 'ハッチ 開', () => g.systems.hatchTapped(), { style: g.hatch.target > 0.5 ? 'warn' : canOpen ? 'normal' : 'disabled', size: 13 });
    K.text(g.player.suit ? '宇宙服 装着' : '宇宙服 未装着', 10, H - 12, { size: 11, color: g.player.suit ? COL.green : COL.amber });
  }

  draw_reactor(K, m, H) {
    const g = this.g;
    this.header(K, '原子炉', H);
    const rt = g.damage.reactorTemp || 560;
    const cool = g.damage.coolant ?? 1;
    const out = (g.systems.power ?? 1);
    K.text('出力', 16, 54, { size: 10, color: COL.dim }); K.bar(70, 46, 300, 10, out, COL.green); K.text(Math.round(out * 100) + ' %', 500, 56, { size: 12, color: COL.text, align: 'right', mono: true });
    K.text('炉心温度', 16, 84, { size: 10, color: COL.dim }); K.bar(70, 76, 300, 10, (rt - 300) / 700, rt > 800 ? COL.red : COL.amber); K.text(Math.round(rt) + ' K', 500, 86, { size: 12, color: COL.text, align: 'right', mono: true });
    K.text('冷却材', 16, 114, { size: 10, color: COL.dim }); K.bar(70, 106, 300, 10, cool, cool < 0.6 ? COL.red : COL.cyan); K.text(Math.round(cool * 100) + ' %', 500, 116, { size: 12, color: COL.text, align: 'right', mono: true });
    const rpm = 18000 * out * (0.9 + 0.1 * Math.sin(performance.now() / 700));
    K.text('タービン', 16, 144, { size: 10, color: COL.dim }); K.text(Math.round(rpm) + ' rpm', 70, 144, { size: 12, color: COL.text, mono: true });
    K.text('寿命  残り 9年 3か月', 16, H - 14, { size: 10, color: COL.dim });
  }

  draw_generic(K, m, H) {
    this.header(K, m.id, H);
  }
}

function hullHW(z) {
  if (z < -9) { const u = (-9 - z) / 4.4; return 3.05 * Math.sqrt(Math.max(0, 1 - u * u)); }
  if (z > 4.6) { const u = Math.min(1, (z - 4.6) / 6.1); return 3.05 - 1.32 * u * u * (3 - 2 * u); }
  return 3.05;
}

function fmtEta(s) {
  if (!s || s < 1) return '';
  if (s < 3600) return Math.round(s / 60) + '分';
  if (s < 86400) return (s / 3600).toFixed(1) + '時間';
  return (s / 86400).toFixed(1) + '日';
}

function wrap(K, text, x, y, w, size, color, maxLines = 3) {
  K.font(size);
  let line = '', ly = y, n = 0;
  for (const ch of text) {
    const test = line + ch;
    if (K.g.measureText(test).width / K.s > w && line) {
      K.text(line, x, ly, { size, color });
      line = ch; ly += size + 3; n++;
      if (n >= maxLines) return;
    } else line = test;
  }
  if (line) K.text(line, x, ly, { size, color });
}
