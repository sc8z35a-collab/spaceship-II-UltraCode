// Renderer, multi-frustum scene pass, auto exposure and the final grade/post stack.
import * as THREE from 'three';
import { EffectComposer, EffectPass, Pass, BloomEffect, SMAAEffect, SMAAPreset, Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { LAYER_FAR, LAYER_MID, LAYER_NEAR, RANGES } from './layers.js';

// shared uniform: ownership range [min,max) of the pass currently rendering (for blended shells)
export const passRange = { value: new THREE.Vector2(0, 1e12) };
const OWN = { far: [120000, 1e13], mid: [300, 120000], near: [0, 300] };

class MultiFrustumPass extends Pass {
  constructor(scene, mainCam) {
    super('MultiFrustumPass', scene, mainCam);
    this.needsSwap = false;
    this.cams = {};
    for (const k of ['far', 'mid', 'near']) {
      const c = new THREE.PerspectiveCamera();
      c.matrixAutoUpdate = false;
      c.matrixWorldAutoUpdate = false;
      c.layers.set(k === 'far' ? LAYER_FAR : k === 'mid' ? LAYER_MID : LAYER_NEAR);
      this.cams[k] = c;
    }
    this.onBeforePass = null;
    this.frames = 0;
  }

  syncCam(c, range) {
    const m = this.camera;
    c.matrixWorld.copy(m.matrixWorld);
    c.matrixWorldInverse.copy(m.matrixWorldInverse);
    c.fov = m.fov; c.aspect = m.aspect; c.zoom = m.zoom; c.filmGauge = m.filmGauge; c.filmOffset = m.filmOffset;
    c.view = m.view;
    c.near = range[0]; c.far = range[1];
    c.updateProjectionMatrix();
  }

  render(renderer, inputBuffer) {
    const target = this.renderToScreen ? null : inputBuffer;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    const sm = renderer.shadowMap;
    for (const k of ['far', 'mid', 'near']) {
      const c = this.cams[k];
      this.syncCam(c, RANGES[k]);
      passRange.value.set(OWN[k][0], OWN[k][1]);
      if (this.onBeforePass) this.onBeforePass(k, c);
      sm.needsUpdate = k === 'near' || this.frames < 2;
      renderer.render(this.scene, c);
      if (k !== 'near') renderer.clearDepth();
    }
    this.frames++;
  }
}

/** replaces NaN / Inf pixels of the HDR scene before bloom and exposure can spread them */
class SanitizePass extends Pass {
  constructor() {
    super('SanitizePass');
    this.fullscreenMaterial = new THREE.ShaderMaterial({
      uniforms: { inputBuffer: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D inputBuffer; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(inputBuffer, vUv).rgb;
          if (!(c.r == c.r && c.g == c.g && c.b == c.b) || any(isinf(c))) c = vec3(0.0);
          gl_FragColor = vec4(clamp(c, 0.0, 60000.0), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
  }

  render(renderer, inputBuffer, outputBuffer) {
    this.fullscreenMaterial.uniforms.inputBuffer.value = inputBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }
}

class AutoExposurePass extends Pass {
  constructor() {
    super('AutoExposurePass');
    this.needsSwap = false;
    this.lumRT = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.adaptA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false });
    this.adaptB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false });
    this.lumMat = new THREE.ShaderMaterial({
      uniforms: { tInput: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tInput; varying vec2 vUv;
        void main(){
          vec3 c = vec3(0.0);
          for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++){
            c += texture2D(tInput, vUv + (vec2(float(i), float(j)) - 0.5) / 128.0).rgb;
          }
          c *= 0.25;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          if (!(l >= 0.0 && l < 65000.0)) l = 0.0;
          vec2 d = vUv - 0.5;
          float w = exp(-dot(d, d) * 4.0);
          float m = smoothstep(0.004, 0.03, l);
          gl_FragColor = vec4(min(l, 6.0) * w * m, w * m, w, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.adaptMat = new THREE.ShaderMaterial({
      uniforms: { tLum: { value: this.lumRT.texture }, tPrev: { value: null }, uRate: { value: 0.05 }, uLock: { value: 0 }, uLockValue: { value: 0.3 } },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tLum; uniform sampler2D tPrev; uniform float uRate; uniform float uLock; uniform float uLockValue;
        void main(){
          vec3 s = textureLod(tLum, vec2(0.5), 6.0).rgb;
          float frac = s.y / max(s.z, 1e-5);
          float avgNB = s.x / max(s.y, 1e-5);
          float avg = mix(0.12, avgNB, smoothstep(0.01, 0.12, frac));
          float prev = texture2D(tPrev, vec2(0.5)).r;
          if (prev <= 0.0 || prev != prev) prev = avg;
          if (!(avg > 0.0 && avg < 1e5)) avg = prev;
          float v = prev + (avg - prev) * uRate;
          v = mix(v, uLockValue, uLock);
          gl_FragColor = vec4(v, 0.0, 0.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lumMat);
    this.quad.frustumCulled = false;
    this.qscene = new THREE.Scene();
    this.qscene.add(this.quad);
    this.qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.flip = false;
    this.frame = 0;
    this.texture = this.adaptA.texture;
  }

  render(renderer, inputBuffer, outputBuffer, dt) {
    this.frame++;
    this.lumMat.uniforms.tInput.value = inputBuffer.texture;
    this.quad.material = this.lumMat;
    renderer.setRenderTarget(this.lumRT);
    renderer.render(this.qscene, this.qcam);
    const src = this.flip ? this.adaptB : this.adaptA;
    const dst = this.flip ? this.adaptA : this.adaptB;
    this.adaptMat.uniforms.tPrev.value = src.texture;
    this.adaptMat.uniforms.uRate.value = 1 - Math.exp(-(dt || 0.016) * 1.6);
    this.quad.material = this.adaptMat;
    renderer.setRenderTarget(dst);
    renderer.render(this.qscene, this.qcam);
    this.flip = !this.flip;
    this.texture = dst.texture;
    if (this.onTexture) this.onTexture(dst.texture);
  }
}

const GRADE_FRAG = /* glsl */`
uniform sampler2D tLum;
uniform float uExposureBias;
uniform float uTime;
uniform float uAlarm;
uniform float uHypoxia;
uniform float uFlash;
uniform float uCA;
uniform float uVignette;
uniform float uGrain;
uniform float uFade;
uniform float uVisor;
uniform float uHeat;
uniform float uDesat;
uniform float uBlur;
uniform vec3 uTint;

vec3 agxDefault(vec3 color){
  const mat3 AgXInsetMatrix = mat3(
    vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 AgXOutsetMatrix = mat3(
    vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float AgxMinEv = -12.47393;
  const float AgxMaxEv = 4.026069;
  color = AgXInsetMatrix * color;
  color = max(color, 1e-10);
  color = log2(color);
  color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);
  color = clamp(color, 0.0, 1.0);
  vec3 x2 = color * color;
  vec3 x4 = x2 * x2;
  color = + 15.5 * x4 * x2 - 40.14 * x4 * color + 31.96 * x4 - 6.868 * x2 * color + 0.4298 * x2 + 0.1191 * color - 0.00232;
  color = AgXOutsetMatrix * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  return clamp(color, 0.0, 1.0);
}
float gHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
  vec2 dc = uv - 0.5;
  float r2 = dot(dc, dc);
  // heat shimmer during re-entry
  vec2 suv = uv;
  if (uHeat > 0.0){
    suv += vec2(sin(uv.y * 60.0 + uTime * 9.0), cos(uv.x * 50.0 + uTime * 7.0)) * 0.0025 * uHeat;
  }
  vec3 base = texture2D(inputBuffer, uv).rgb;
  vec2 off = dc * (uCA * (0.4 + r2 * 3.0));
  vec3 col = vec3(texture2D(inputBuffer, suv + off).r, texture2D(inputBuffer, suv).g, texture2D(inputBuffer, suv - off).b);
  if (uBlur > 0.0){
    vec3 b = vec3(0.0);
    for (int i = 0; i < 6; i++){
      float a = float(i) * 1.0472 + uTime;
      b += texture2D(inputBuffer, suv + vec2(cos(a), sin(a)) * 0.006 * uBlur).rgb;
    }
    col = mix(col, b / 6.0, clamp(uBlur, 0.0, 1.0));
  }
  col += inputColor.rgb - base; // keep bloom from earlier effects
  float avg = texture2D(tLum, vec2(0.5)).r;
  float exposure = uExposureBias * 0.34 / clamp(avg, 0.05, 3.0);
  col *= exposure;
  col += vec3(1.0, 0.97, 0.9) * uFlash * 2.5;
  col = agxDefault(col);
  // grading: slight cool shadows, warm highlights
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * vec3(0.94, 0.98, 1.06), (1.0 - smoothstep(0.0, 0.4, l)) * 0.6);
  col = mix(col, vec3(l), uDesat);
  col *= uTint;
  // alarm: pulsing red edges + red wash
  if (uAlarm > 0.0){
    float edge = smoothstep(0.08, 0.42, r2);
    col = mix(col, col * vec3(1.2, 0.45, 0.4) + vec3(0.16, 0.0, 0.0) * edge, uAlarm * (0.18 + 0.72 * edge));
  }
  // hypoxia: tunnel vision, desaturation, pulse
  if (uHypoxia > 0.0){
    float pulse = 0.85 + 0.15 * sin(uTime * 6.0);
    float tunnel = smoothstep(0.55 - 0.45 * uHypoxia * pulse, 0.05, sqrt(r2) * 1.6);
    col = mix(col, vec3(dot(col, vec3(0.33))), uHypoxia * 0.8);
    col *= mix(1.0, tunnel, uHypoxia);
  }
  // helmet visor: faint tint, edge darkening and reflections
  if (uVisor > 0.0){
    float rim = smoothstep(0.18, 0.36, r2 * vec2(1.0, 1.6).y + dc.x * dc.x * 0.4);
    col = mix(col, col * vec3(0.92, 0.97, 1.02), uVisor);
    col *= 1.0 - rim * 0.85 * uVisor;
    // faint curved glare from the visor dome (only noticeable against dark backgrounds)
    float glare = exp(-pow((length(dc * vec2(1.0, 1.7) - vec2(-0.25, 0.32)) - 0.42) * 22.0, 2.0)) * 0.006;
    col += vec3(0.8, 0.9, 1.0) * glare * uVisor;
  }
  // vignette
  col *= 1.0 - uVignette * smoothstep(0.12, 0.62, r2);
  // grain
  float n = gHash(uv * vec2(1920.0, 1080.0) + fract(uTime * 13.7) * 100.0) - 0.5;
  col += n * uGrain * (0.6 + 0.4 * (1.0 - l));
  col *= 1.0 - uFade;
  outputColor = vec4(max(col, 0.0), 1.0);
}
`;

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE_FRAG, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['tLum', new THREE.Uniform(null)],
        ['uExposureBias', new THREE.Uniform(1.0)],
        ['uTime', new THREE.Uniform(0)],
        ['uAlarm', new THREE.Uniform(0)],
        ['uHypoxia', new THREE.Uniform(0)],
        ['uFlash', new THREE.Uniform(0)],
        ['uCA', new THREE.Uniform(0.0025)],
        ['uVignette', new THREE.Uniform(0.55)],
        ['uGrain', new THREE.Uniform(0.012)],
        ['uFade', new THREE.Uniform(0)],
        ['uVisor', new THREE.Uniform(0)],
        ['uHeat', new THREE.Uniform(0)],
        ['uDesat', new THREE.Uniform(0)],
        ['uBlur', new THREE.Uniform(0)],
        ['uTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ]),
    });
  }
  set(name, v) { this.uniforms.get(name).value = v; }
  get(name) { return this.uniforms.get(name).value; }
}

export class Engine {
  constructor(canvas) {
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, stencil: false, depth: true,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = false;
    this.camera = new THREE.PerspectiveCamera(60, 2, 0.03, 2e9);
    this.camera.matrixAutoUpdate = false;
    this.maxPR = Math.min(window.devicePixelRatio || 1, 2.25);
    this.pr = Math.min(this.maxPR, 1.75);
    renderer.setPixelRatio(this.pr);

    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.mfPass = new MultiFrustumPass(this.scene, this.camera);
    this.exposure = new AutoExposurePass();
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.9, luminanceSmoothing: 0.35, intensity: 0.85, radius: 0.78, levels: 8 });
    this.grade = new GradeEffect();
    this.exposure.onTexture = (t) => this.grade.set('tLum', t);
    this.composer.addPass(this.mfPass);
    this.composer.addPass(new SanitizePass());
    this.composer.addPass(this.exposure);
    this.composer.addPass(new EffectPass(this.camera, this.bloom, this.grade));
    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.composer.addPass(new EffectPass(this.camera, this.smaa));
    this.frameTimes = [];
    this.lastAdjust = 0;
    this.autoRes = true;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.pr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.setHFov(this.hfov || 92);
    this.width = w; this.height = h;
  }

  setHFov(deg) {
    this.hfov = deg;
    const a = this.camera.aspect;
    const vf = 2 * Math.atan(Math.tan((deg * Math.PI) / 360) / a) * 180 / Math.PI;
    this.camera.fov = Math.min(100, Math.max(25, vf));
    this.camera.updateProjectionMatrix();
  }

  /** frame-time based dynamic resolution */
  adapt(dt, now) {
    if (!this.autoRes) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (now - this.lastAdjust < 2.0 || this.frameTimes.length < 60) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    let pr = this.pr;
    if (med > 1 / 48 && pr > 0.85) pr = Math.max(0.85, pr - 0.15);
    else if (med < 1 / 58 && pr < this.maxPR) pr = Math.min(this.maxPR, pr + 0.1);
    if (Math.abs(pr - this.pr) > 0.01) {
      this.pr = pr;
      this.resize();
      this.lastAdjust = now;
      this.frameTimes.length = 0;
    }
  }

  render(dt) {
    this.renderer.info.reset();
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld(true);
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    this.composer.render(dt);
  }
}
