// Renderer, multi-frustum scene pass, auto exposure and the final grade/post stack.
import * as THREE from 'three';
import { EffectComposer, EffectPass, Pass, BloomEffect, SMAAEffect, SMAAPreset, Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { LAYER_FAR, LAYER_MID, LAYER_NEAR, LAYER_CABIN, RANGES } from './layers.js';
import { QUALITY, loadQuality } from './quality.js';

const _ONE = new THREE.Vector3(1, 1, 1);
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
    // LOW II, the eye in B-29's cabin: the far and middle passes are drawn only inside this box of
    // the picture (where the windows are), or not at all ('none'); null: the whole picture
    this.farRect = null;
    // the sun's shadow map is centred on the ship and hardly changes from one frame to the next:
    // low quality redraws it every few frames only
    this.shadowEvery = 1;
    // H8's zoom: the cockpit drawn last at the eye's own view ({ matrixWorld, fov }), over the
    // magnified picture; and the picture's digital zoom (a crop of fewer sensor pixels, rebuilt by
    // the camera's image processor) worked on the outside alone, before the cockpit goes over it
    this.cabin = null;
    this.digital = 1;
    const cc = new THREE.PerspectiveCamera();
    cc.matrixAutoUpdate = false; cc.matrixWorldAutoUpdate = false;
    cc.layers.set(LAYER_CABIN);
    this.cams.cabin = cc;
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = (mat) => { const sc = new THREE.Scene(); const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; sc.add(m); return sc; };
    this.aiMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uPix: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tSrc; uniform vec2 uRes; uniform float uPix; varying vec2 vUv;
        vec2 lr;
        // one of the sensor's pixels (a grid uPix times coarser than the screen)
        vec3 S(vec2 g){ return texture2D(tSrc, (g + 0.5) / lr).rgb; }
        vec4 cr(float t){ float t2 = t * t, t3 = t2 * t; return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2); }
        void main(){
          lr = uRes / uPix;
          vec2 p = vUv * lr - 0.5, i = floor(p), f = p - i;
          vec4 wx = cr(f.x), wy = cr(f.y);
          vec3 c = vec3(0.0);
          for (int y = 0; y < 4; y++){
            vec3 row = vec3(0.0);
            for (int x = 0; x < 4; x++) row += S(i + vec2(float(x - 1), float(y - 1))) * wx[x];
            c += row * wy[y];
          }
          // the processor rebuilds the edges (detail against the local mean), never past what the
          // neighbouring pixels allow: crisp, no blocks, no halos
          vec3 a = S(i), b = S(i + vec2(1.0, 0.0)), d = S(i + vec2(0.0, 1.0)), e = S(i + vec2(1.0, 1.0));
          vec3 mn = min(min(a, b), min(d, e)), mx = max(max(a, b), max(d, e));
          c = clamp(c + (c - (a + b + d + e) * 0.25) * 0.55, mn, mx);
          gl_FragColor = vec4(max(c, 0.0), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.aiScene = quad(this.aiMat);
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }',
      depthTest: false, depthWrite: false,
    });
    this.copyScene = quad(this.copyMat);
    this.tmp = null;
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
      sm.needsUpdate = (k === 'near' && this.frames % this.shadowEvery === 0) || this.frames < 2;
      const clip = k !== 'near' && target ? this.farRect : null;
      if (clip === 'none') continue;                       // none of it can be seen
      if (clip) { target.scissor.set(clip.x, clip.y, clip.w, clip.h); target.scissorTest = true; renderer.setRenderTarget(target); }
      renderer.render(this.scene, c);
      if (clip) { target.scissorTest = false; renderer.setRenderTarget(target); }
      if (k !== 'near') renderer.clearDepth();
    }
    // the digital zoom, on the cameras' picture alone
    if (this.digital > 1.01 && target) {
      const w = target.width, h = target.height;
      if (!this.tmp || this.tmp.width !== w || this.tmp.height !== h) {
        if (this.tmp) this.tmp.dispose();
        this.tmp = new THREE.WebGLRenderTarget(w, h, { type: target.texture.type, format: target.texture.format, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      }
      this.aiMat.uniforms.tSrc.value = target.texture;
      this.aiMat.uniforms.uRes.value.set(w, h);
      this.aiMat.uniforms.uPix.value = this.digital;
      renderer.setRenderTarget(this.tmp);
      renderer.render(this.aiScene, this.fsCam);
      this.copyMat.uniforms.tSrc.value = this.tmp.texture;
      renderer.setRenderTarget(target);
      renderer.render(this.copyScene, this.fsCam);
    }
    // the cockpit, at the eye's own view
    if (this.cabin) {
      renderer.clearDepth();
      const c = this.cams.cabin, m = this.camera;
      c.matrixWorld.copy(this.cabin.matrixWorld);
      c.matrixWorldInverse.copy(c.matrixWorld).invert();
      c.fov = this.cabin.fov; c.aspect = m.aspect; c.near = RANGES.near[0]; c.far = 60; c.view = null;
      c.updateProjectionMatrix();
      passRange.value.set(OWN.near[0], OWN.near[1]);
      sm.needsUpdate = false;
      renderer.render(this.scene, c);
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
    // half float: renderable everywhere the HDR frame buffers are (32-bit float targets are not on
    // every phone, and a failed target made the exposure jump with every frame)
    this.adaptA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.adaptB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.lumMat = new THREE.ShaderMaterial({
      uniforms: { tInput: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tInput; varying vec2 vUv;
        void main(){
          // 4 x 4 taps spread over the whole area this 64 x 64 texel stands for: small bright things
          // (lamps, glints, stars) no longer pop in and out of a sparse sample grid as the view sways
          vec3 c = vec3(0.0);
          for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++){
            vec3 s = texture2D(tInput, vUv + (vec2(float(i), float(j)) - 1.5) / 256.0).rgb;
            c += min(s, vec3(8.0));
          }
          c *= 1.0 / 16.0;
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
    this.adaptMat.uniforms.uRate.value = 1 - Math.exp(-Math.min(0.1, dt || 0.016) * 1.1);
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
uniform float uPixel;
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

void mainImage(const in vec4 inputColor, const in vec2 uv0, out vec4 outputColor){
  // digital zoom: the picture is a crop of fewer sensor pixels (blocks)
  vec2 uv = uv0;
  if (uPixel > 1.01){ vec2 px = resolution / uPixel; uv = (floor(uv0 * px) + 0.5) / px; }
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
  col += (uPixel > 1.01 ? vec3(0.0) : inputColor.rgb - base); // keep bloom from earlier effects
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
  float n = gHash(uv0 * vec2(1920.0, 1080.0) + fract(uTime * 13.7) * 100.0) - 0.5;
  col += n * (uGrain + max(0.0, uPixel - 1.0) * 0.007) * (0.6 + 0.4 * (1.0 - l));
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
        ['uPixel', new THREE.Uniform(1)],
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
    loadQuality();
    this.low = QUALITY.level !== 'high';
    this.low2 = QUALITY.level === 'low2';
    this.pr = this.basePR();
    renderer.setPixelRatio(this.pr);

    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.mfPass = new MultiFrustumPass(this.scene, this.camera);
    this.exposure = new AutoExposurePass();
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.05, luminanceSmoothing: 0.3, intensity: 0.75, radius: 0.75, levels: 8 });
    this.grade = new GradeEffect();
    this.exposure.onTexture = (t) => this.grade.set('tLum', t);
    this.composer.addPass(this.mfPass);
    this.composer.addPass(new SanitizePass());
    this.composer.addPass(this.exposure);
    this.gradePass = new EffectPass(this.camera, this.bloom, this.grade);
    this.composer.addPass(this.gradePass);
    this.smaa = new SMAAEffect({ preset: this.low ? SMAAPreset.LOW : SMAAPreset.HIGH });
    if (this.low) this.bloom.mipmapBlurPass.levels = this.low2 ? 4 : 5;
    this.smaaPass = new EffectPass(this.camera, this.smaa);
    this.composer.addPass(this.smaaPass);
    this.setAA();
    // drawn over the finished picture, with the unmagnified view (H8's tabs: they are part of its
    // display, so the zoom does not magnify them; the picture's grading does not touch them)
    this.uiScene = new THREE.Scene();
    this.uiScene.matrixWorldAutoUpdate = false;
    this.uiCam = new THREE.PerspectiveCamera();
    this.uiCam.matrixAutoUpdate = false;
    this.uiCam.matrixWorldAutoUpdate = false;
    this.uiOn = false;
    // called once with the canvas right after the next picture is finished (before the overlay is
    // drawn over it): a photograph
    this.onFrame = null;
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
    this.applyFov();
  }

  /** the vertical field of view without any zoom (degrees) */
  baseVFov() {
    const a = this.camera.aspect;
    const vf = 2 * Math.atan(Math.tan(((this.hfov || 92) * Math.PI) / 360) / a) * 180 / Math.PI;
    return Math.min(100, Math.max(25, vf));
  }

  /**
   * H8's zoom from its seat: the outside is magnified (the cameras' picture), the cockpit is drawn
   * at the eye's own view (eye: { pos, quat } or null), the digital part of the zoom is worked
   * by the camera's image processor on the picture alone
   */
  setCabinView(eye, digital = 1) {
    const P = this.mfPass;
    if (!P) return;
    if (!eye) { P.cabin = null; P.digital = 1; return; }
    const C = P.cabin || (P.cabin = { matrixWorld: new THREE.Matrix4(), fov: 60 });
    C.matrixWorld.compose(eye.pos, eye.quat, _ONE);
    C.fov = this.baseVFov();
    P.digital = digital;
  }

  /** magnify the view (H8's zoom): the field of view narrows by z */
  setZoom(z) {
    if (Math.abs((this.zoom || 1) - z) < 1e-5) return;
    this.zoom = z;
    this.applyFov();
  }

  applyFov() {
    const vf = this.baseVFov(), z = this.zoom || 1;
    this.camera.fov = z > 1.00001 ? 2 * Math.atan(Math.tan(vf * Math.PI / 360) / z) * 180 / Math.PI : vf;
    this.camera.updateProjectionMatrix();
  }

  /** starting pixel ratio: low quality draws about half the pixels (0.72^2), LOW II a fifth */
  basePR() {
    const hi = Math.min(this.maxPR, 1.75);
    if (this.low2) return Math.max(0.45, Math.round(hi * 0.45 * 100) / 100);
    return this.low ? Math.max(0.7, Math.round(hi * 0.72 * 100) / 100) : hi;
  }

  /** switch between the full look, the half-cost one and LOW II (resolution, anti-aliasing,
   *  bloom, how often the sun's shadows are redrawn) */
  setQuality(level) {
    this.low = level !== 'high';
    this.low2 = level === 'low2';
    this.pr = this.basePR();
    this.resStart = undefined;
    this.resDropped = false;
    this.frameTimes.length = 0;
    this.smaa.applyPreset(this.low ? SMAAPreset.LOW : SMAAPreset.HIGH);
    this.setAA();
    this.bloom.mipmapBlurPass.levels = this.low2 ? 4 : this.low ? 5 : 8;
    if (this.mfPass) { this.mfPass.shadowEvery = this.low2 ? 8 : this.low ? 3 : 1; this.mfPass.farRect = null; }
    this.resize();
  }

  /** LOW II: no anti-aliasing pass at all (the grade goes straight to the screen) */
  setAA() {
    this.smaaPass.enabled = !this.low2;
    this.smaaPass.renderToScreen = !this.low2;
    this.gradePass.renderToScreen = this.low2;
  }

  /** frame-time based dynamic resolution */
  adapt(dt, now) {
    if (!this.autoRes) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    if (this.resStart === undefined) this.resStart = now;
    // Every change of resolution is visible (the image goes soft/sharp), so: settle during the first
    // ~25 s, never climb again after having had to drop (that ping-pong flickered every few
    // seconds on phones), and afterwards only drop when the frame rate really sags.
    // after the first ~20 s the resolution is locked for good: a change of resolution re-creates
    // every frame buffer and is seen as a flash on phones
    const settling = now - this.resStart < 20;
    if (!settling) return;
    if (now - this.lastAdjust < 2.5 || this.frameTimes.length < 60) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    let pr = this.pr;
    // (low quality stays at its own, lower level: it only drops further when it has to)
    const floor = this.low2 ? 0.4 : this.low ? 0.6 : 0.85, cap = this.low ? this.basePR() : this.maxPR;
    if (med > 1 / 40 && pr > floor) { pr = Math.max(floor, pr - 0.2); this.resDropped = true; }
    else if (!this.resDropped && med < 1 / 58 && pr < cap) pr = Math.min(cap, pr + 0.1);
    if (Math.abs(pr - this.pr) > 0.01) {
      this.pr = pr;
      this.resize();
      this.lastAdjust = now;
      this.frameTimes.length = 0;
    }
  }

  /** the projection of the unmagnified view (what the overlay is drawn with) */
  uiProjection(out = new THREE.Matrix4()) {
    const c = this.uiCam;
    c.fov = this.baseVFov(); c.aspect = this.camera.aspect; c.near = 0.02; c.far = 50;
    c.updateProjectionMatrix();
    return out.copy(c.projectionMatrix);
  }

  render(dt) {
    this.renderer.info.reset();
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld(true);
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    this.composer.render(dt);
    if (this.onFrame) { const f = this.onFrame; this.onFrame = null; try { f(this.renderer.domElement); } catch (e) { console.warn(e); } }
    if (this.uiOn) {
      const c = this.uiCam;
      this.uiProjection();
      c.matrixWorld.copy(this.camera.matrixWorld);
      c.matrixWorldInverse.copy(this.camera.matrixWorldInverse);
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.uiScene, c);
    }
  }
}
