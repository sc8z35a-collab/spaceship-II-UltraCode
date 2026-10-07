// Lightweight CPU particle system in ship-local space: sparks (additive), mist/steam, water
// droplets, debris and ice (alpha). Emitters can be continuous (leaks) or bursts (impacts).
import * as THREE from 'three';
import { LAYER_NEAR, LAYER_MID } from '../core/layers.js';

const MAX = 4000;

function makeSystem(additive) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 4), size = new Float32Array(MAX);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 } },
    vertexShader: /* glsl */`
      attribute vec4 color; attribute float size; uniform float uScale; varying vec4 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(size * uScale / max(-mv.z, 0.05), 1.0, 256.0); vC = color;
        // fade out what drifts right in front of the eye (would fill the screen)
        vC.a *= smoothstep(0.12, 0.45, -mv.z); }`,
    fragmentShader: /* glsl */`
      varying vec4 vC;
      void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = dot(p,p); if (r > 1.0) discard;
        float a = ${additive ? 'exp(-r * 3.0)' : '(1.0 - r) * (1.0 - r)'};
        gl_FragColor = ${additive ? 'vec4(vC.rgb * vC.a * a, 1.0)' : 'vec4(vC.rgb * vC.a * a, vC.a * a)'}; }`,
    transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.layers.set(LAYER_NEAR); pts.layers.enable(LAYER_MID);
  pts.renderOrder = 20;
  return { pts, pos, col, size, n: 0, p: [] };
}

export class Particles {
  constructor(parent) {
    this.add = makeSystem(true);
    this.alpha = makeSystem(false);
    parent.add(this.add.pts, this.alpha.pts);
    this.emitters = [];
    this.gravity = new THREE.Vector3();
    this.airflow = null; // function(pos) -> velocity of air (decompression)
  }

  _spawn(sys, o) {
    if (sys.p.length >= MAX) sys.p.shift();
    sys.p.push(o);
  }

  /** kinds: spark, mist, steam, water, debris, ice, smoke, plasma, dust, casing, gunsmoke */
  burst(kind, pos, dir, n, opts = {}) {
    const spread = opts.spread ?? 0.6, speed = opts.speed ?? 2;
    for (let i = 0; i < n; i++) {
      const d = new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).multiplyScalar(spread).add(dir).normalize();
      const v = d.multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this._one(kind, pos.clone().addScaledVector(d, 0.02), v, opts);
    }
  }

  _one(kind, pos, vel, opts = {}) {
    const P = { pos, vel, age: 0, kind };
    switch (kind) {
      case 'spark': P.life = 0.3 + Math.random() * 0.9; P.size = 0.012; P.c = [1, 0.62, 0.25]; P.a = 3; P.drag = 0.3; P.grav = 1; this._spawn(this.add, P); break;
      case 'plasma': P.life = 0.4 + Math.random() * 0.5; P.size = 0.5 + Math.random() * 0.8; P.c = [1, 0.45, 0.15]; P.a = 2; P.drag = 0.1; P.grav = 0; P.grow = 1.5; this._spawn(this.add, P); break;
      case 'mist': P.life = 1.2 + Math.random() * 1.6; P.size = 0.06 + Math.random() * 0.08; P.c = [0.85, 0.88, 0.92]; P.a = 0.18; P.drag = 1.2; P.grav = 0.05; P.grow = 0.6; P.air = 1; this._spawn(this.alpha, P); break;
      case 'steam': P.life = 1.0 + Math.random() * 1.2; P.size = 0.05; P.c = [0.95, 0.95, 0.95]; P.a = 0.28; P.drag = 1.5; P.grav = -0.15; P.grow = 0.9; P.air = 1; this._spawn(this.alpha, P); break;
      case 'water': P.life = 6 + Math.random() * 10; P.size = 0.008 + Math.random() * 0.014; P.c = [0.6, 0.75, 0.9]; P.a = 0.75; P.drag = 0.05; P.grav = 1; P.wobble = 1; this._spawn(this.alpha, P); break;
      case 'coffee': P.life = 4 + Math.random() * 6; P.size = 0.008; P.c = [0.25, 0.12, 0.05]; P.a = 0.9; P.drag = 0.05; P.grav = 1; this._spawn(this.alpha, P); break;
      case 'debris': P.life = 4 + Math.random() * 6; P.size = 0.01 + Math.random() * 0.03; P.c = [0.25, 0.25, 0.27]; P.a = 1; P.drag = 0.02; P.grav = 1; this._spawn(this.alpha, P); break;
      case 'ice': P.life = 1.5 + Math.random() * 2; P.size = 0.02 + Math.random() * 0.03; P.c = [0.9, 0.95, 1]; P.a = 0.55; P.drag = 0.0; P.grav = 0; P.grow = 0.3; this._spawn(this.alpha, P); break;
      case 'smoke': P.life = 3 + Math.random() * 3; P.size = 0.1; P.c = [0.12, 0.12, 0.13]; P.a = 0.35; P.drag = 0.8; P.grav = -0.05; P.grow = 0.5; P.air = 1; this._spawn(this.alpha, P); break;
      case 'dust': P.life = 6 + Math.random() * 6; P.size = 0.004 + Math.random() * 0.004; P.c = [1, 0.95, 0.85]; P.a = 0.25; P.drag = 0.4; P.grav = 0.02; P.air = 1; this._spawn(this.alpha, P); break;
      case 'rcs': P.life = 0.35 + Math.random() * 0.3; P.size = 0.08; P.c = [0.85, 0.9, 1]; P.a = 0.35; P.drag = 0.0; P.grav = 0; P.grow = 4; this._spawn(this.alpha, P); break;
      case 'exhaust': P.life = 0.25 + Math.random() * 0.2; P.size = 0.35; P.c = [0.5, 0.65, 1.0]; P.a = 1.2; P.drag = 0.0; P.grav = 0; P.grow = 3; this._spawn(this.add, P); break;
      case 'casing': P.life = 2.5 + Math.random() * 2; P.size = 0.022 + Math.random() * 0.01; P.c = [0.82, 0.6, 0.24]; P.a = 1; P.drag = 0.0; P.grav = 1; this._spawn(this.alpha, P); break;
      case 'gunsmoke': P.life = 0.45 + Math.random() * 0.5; P.size = 0.1 + Math.random() * 0.06; P.c = [0.62, 0.6, 0.56]; P.a = 0.32; P.drag = 2.2; P.grav = 0; P.grow = 5; this._spawn(this.alpha, P); break;
      case 'splash': P.life = 1.5 + Math.random() * 1.5; P.size = 0.15 + Math.random() * 0.3; P.c = [0.85, 0.9, 0.95]; P.a = 0.6; P.drag = 0.3; P.grav = 1; P.grow = 1; this._spawn(this.alpha, P); break;
      default: return;
    }
    if (opts.color) P.c = opts.color;
    if (opts.life) P.life *= opts.life;
    if (opts.size) P.size *= opts.size;
    if (opts.grow !== undefined) P.grow = opts.grow;
    if (opts.alpha !== undefined) P.a = opts.alpha;
    if (opts.drag !== undefined) P.drag = opts.drag;
  }

  /** continuous emitter; returns handle with .rate (particles/s) .pos .dir .kind */
  emitter(kind, pos, dir, rate, opts = {}) {
    const e = { kind, pos: pos.clone(), dir: dir.clone().normalize(), rate, acc: 0, opts, alive: true };
    this.emitters.push(e);
    return e;
  }

  removeEmitter(e) { e.alive = false; this.emitters = this.emitters.filter((x) => x !== e); }

  update(dt, camLocal) {
    for (const e of this.emitters) {
      e.acc += e.rate * dt;
      while (e.acc >= 1) {
        e.acc -= 1;
        const sp = e.opts.speed ?? 2;
        const d = e.dir.clone().add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(e.opts.spread ?? 0.3)).normalize();
        this._one(e.kind, e.pos.clone(), d.multiplyScalar(sp * (0.5 + Math.random() * 0.7)), e.opts);
      }
    }
    const g = this.gravity;
    for (const sys of [this.add, this.alpha]) {
      let n = 0;
      const out = [];
      for (const P of sys.p) {
        P.age += dt;
        if (P.age > P.life) continue;
        out.push(P);
        const drag = Math.exp(-P.drag * dt);
        P.vel.multiplyScalar(drag);
        if (P.grav) P.vel.addScaledVector(g, P.grav * dt);
        if (P.air && this.airflow) { const a = this.airflow(P.pos); if (a) P.vel.lerp(a, Math.min(1, dt * 1.5)); }
        if (P.wobble) P.vel.addScaledVector(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), 0.02 * dt);
        P.pos.addScaledVector(P.vel, dt);
        const f = P.age / P.life;
        const s = P.size * (1 + (P.grow || 0) * f);
        sys.pos[n * 3] = P.pos.x; sys.pos[n * 3 + 1] = P.pos.y; sys.pos[n * 3 + 2] = P.pos.z;
        const fade = f < 0.1 ? f / 0.1 : 1 - Math.pow((f - 0.1) / 0.9, 1.5);
        sys.col[n * 4] = P.c[0]; sys.col[n * 4 + 1] = P.c[1]; sys.col[n * 4 + 2] = P.c[2]; sys.col[n * 4 + 3] = P.a * Math.max(0, fade);
        sys.size[n] = s;
        n++;
      }
      sys.p = out;
      sys.n = n;
      const geo = sys.pts.geometry;
      geo.setDrawRange(0, n);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.attributes.size.needsUpdate = true;
    }
  }
}
