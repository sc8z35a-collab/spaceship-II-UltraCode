// The text on the screens, drawn a second time at the screen's own resolution.
//
// At low quality the picture is drawn at a fraction of the screen's resolution and brought up to it
// (engine.js), which left the small text of the cockpit's screens soft — at LOW II unreadable. The
// screens that carry text (the monitors, the pages on B-29's display, H8's tabs, the shelter's
// panel) register here; each frame those in view are drawn again straight onto the screen, at its
// full resolution, over the finished picture:
//  - hidden wherever the picture has something in front of them (the scene's depth, which the
//    composer keeps as a texture: what its last pass — the cockpit — drew);
//  - graded the way the picture is (the eye's exposure, the same tone curve, the cool shadows, the
//    tint, the alarm's red wash, the helmet's visor, the vignette, a fade to black), so they sit in
//    the picture rather than on it.
// Effects that distort the whole picture (blurred eyes, heat shimmer, a camera too hot, the digital
// zoom's blocks) switch it off: the screens then stay as soft as everything else.
import * as THREE from 'three';
import { LAYER_NEAR, LAYER_CABIN } from './layers.js';

const PARS = /* glsl */`
uniform sampler2D tCrispDepth;  // the scene's depth (its last pass)
uniform vec4 uCrispScr;         // 1 / the screen's size in pixels (xy); that pass's near and far planes
uniform sampler2D tCrispLum;    // the eye's adaptation (engine.js)
uniform float uCrispBias, uCrispFlash, uCrispDesat, uCrispVig, uCrispFade, uCrispAlarm, uCrispVisor;
uniform vec3 uCrispTint;
float crispLin(float d){ float n = uCrispScr.z, f = uCrispScr.w; return 2.0 * n * f / (f + n - (d * 2.0 - 1.0) * (f - n)); }
vec3 crispAgx(vec3 color){
  const mat3 I = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 O = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  color = I * color;
  color = max(color, 1e-10);
  color = clamp((log2(color) + 12.47393) / 16.5, 0.0, 1.0);
  vec3 x2 = color * color, x4 = x2 * x2;
  color = 15.5 * x4 * x2 - 40.14 * x4 * color + 31.96 * x4 - 6.868 * x2 * color + 0.4298 * x2 + 0.1191 * color - 0.00232;
  color = O * color;
  return clamp(pow(max(vec3(0.0), color), vec3(2.2)), 0.0, 1.0);
}
`;

const MAIN = /* glsl */`
void main(){
  vec2 cuv = gl_FragCoord.xy * uCrispScr.xy;
  // something of the picture in front of it (by more than the picture's coarser pixels can be off)
  float cz = crispLin(texture2D(tCrispDepth, cuv).r), fz = crispLin(gl_FragCoord.z);
  if (cz < fz - 0.012 - 0.012 * fz) discard;
  crispMain_();
  vec3 col = max(gl_FragColor.rgb, 0.0);
  float avg = texture2D(tCrispLum, vec2(0.5)).r;
  col *= uCrispBias * 0.34 / clamp(avg, 0.05, 3.0);
  col += vec3(1.0, 0.97, 0.9) * uCrispFlash * 2.5;
  col = crispAgx(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * vec3(0.94, 0.98, 1.06), (1.0 - smoothstep(0.0, 0.4, l)) * 0.6);
  col = mix(col, vec3(l), uCrispDesat);
  col *= uCrispTint;
  vec2 dc = cuv - 0.5; float r2 = dot(dc, dc);
  if (uCrispAlarm > 0.0){ float edge = smoothstep(0.08, 0.42, r2); col = mix(col, col * vec3(1.2, 0.45, 0.4) + vec3(0.16, 0.0, 0.0) * edge, uCrispAlarm * (0.18 + 0.72 * edge)); }
  if (uCrispVisor > 0.0){ float rim = smoothstep(0.18, 0.36, r2 * 1.6 + dc.x * dc.x * 0.4); col = mix(col, col * vec3(0.92, 0.97, 1.02), uCrispVisor); col *= 1.0 - rim * 0.85 * uCrispVisor; }
  col *= 1.0 - uCrispVig * smoothstep(0.12, 0.62, r2);
  col *= 1.0 - uCrispFade;
  gl_FragColor = vec4(linearToOutputTexel(vec4(max(col, 0.0), 1.0)).rgb, clamp(gl_FragColor.a, 0.0, 1.0));
}
`;

/** the material's fragment shader with its own main() renamed and wrapped in the crisp one */
function wrap(fs) {
  const out = fs.replace(/void\s+main\s*\(\s*(void)?\s*\)\s*\{/, 'void crispMain_(){');
  if (out === fs) return null;
  return PARS + out + MAIN;
}

const BIG = 1e9;

export class CrispLayer {
  constructor(engine) {
    this.e = engine;
    this.items = [];
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = false;
    this.cam = new THREE.PerspectiveCamera();
    this.cam.matrixAutoUpdate = false;
    this.cam.matrixWorldAutoUpdate = false;
    this.U = null;
    this.on = true;
    this.maxDist = 30;          // m: past this a screen's text is too small to matter
    this.drawn = 0;             // screens drawn last frame (for the tests)
    this._sz = new THREE.Vector2();
  }

  /** the uniforms every crisp material shares (the grade's own, so they always agree with it) */
  uniforms() {
    if (this.U) return this.U;
    const G = this.e.grade.uniforms;
    this.U = {
      tCrispDepth: { value: null },
      uCrispScr: { value: new THREE.Vector4(1, 1, 0.03, 320) },
      tCrispLum: G.get('tLum'),
      uCrispBias: G.get('uExposureBias'),
      uCrispFlash: G.get('uFlash'),
      uCrispDesat: G.get('uDesat'),
      uCrispTint: G.get('uTint'),
      uCrispVig: G.get('uVignette'),
      uCrispFade: G.get('uFade'),
      uCrispAlarm: G.get('uAlarm'),
      uCrispVisor: G.get('uVisor'),
    };
    return this.U;
  }

  /**
   * a mesh whose picture carries text: drawn again at the screen's resolution while it is drawn in
   * the cockpit's pass. Its shader may hold an #ifdef CRISP part (only what has to be sharp; the
   * rest discarded). opts: { maxDist }
   */
  add(src, opts = {}) {
    if (!src || !src.isMesh || this.items.some((it) => it.src === src)) return;
    const it = { src, proxy: null, mat: null, srcMat: null, opts };
    if (!this.build(it)) return;
    this.items.push(it);
  }

  remove(src) {
    const i = this.items.findIndex((it) => it.src === src);
    if (i < 0) return;
    const it = this.items[i];
    this.scene.remove(it.proxy);
    if (it.mat) it.mat.dispose();
    this.items.splice(i, 1);
  }

  /** the proxy drawn in its place: the same geometry, its material made crisp */
  build(it) {
    const m = it.src.material;
    if (!m || Array.isArray(m)) return false;
    const U = this.uniforms();
    let mat;
    if (m.isShaderMaterial) {
      const fs = wrap(m.fragmentShader);
      if (!fs) return false;
      // (the original's program has no use for these: they are ignored there)
      Object.assign(m.uniforms, U);
      mat = new THREE.ShaderMaterial({
        uniforms: m.uniforms,
        defines: Object.assign({}, m.defines, { CRISP: 1 }),
        vertexShader: m.vertexShader, fragmentShader: fs,
        transparent: m.transparent, side: m.side, blending: m.blending,
        depthTest: true, depthWrite: m.depthWrite,
      });
      mat.extensions = Object.assign({}, m.extensions);
    } else {
      mat = m.clone();
      mat.toneMapped = false;
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.fragmentShader = wrap(sh.fragmentShader.replace('#include <colorspace_fragment>', '').replace('#include <tonemapping_fragment>', '')) || sh.fragmentShader;
      };
      mat.customProgramCacheKey = () => 'crisp:' + m.type;
      // its changing parts kept the same as the original's
      it.sync = () => {
        if ('map' in m) mat.map = m.map;
        if (m.color) mat.color.copy(m.color);
        if (m.emissive) { mat.emissive.copy(m.emissive); mat.emissiveIntensity = m.emissiveIntensity; mat.emissiveMap = m.emissiveMap; }
        mat.opacity = m.opacity;
      };
    }
    if (it.proxy) { it.proxy.material = mat; if (it.mat) it.mat.dispose(); }
    else {
      const p = new THREE.Mesh(it.src.geometry, mat);
      p.matrixAutoUpdate = false;
      p.matrixWorldAutoUpdate = false;
      p.visible = false;
      this.scene.add(p);
      it.proxy = p;
    }
    it.proxy.frustumCulled = it.src.frustumCulled;
    it.proxy.renderOrder = it.src.renderOrder;
    it.mat = mat;
    it.srcMat = m;
    return true;
  }

  /** whether src is drawn this frame in the pass whose depth was kept, and near enough */
  shown(it, bit, cx, cy, cz) {
    const s = it.src;
    if ((s.layers.mask & bit) === 0) return false;
    let o = s, top = s;
    for (; o; o = o.parent) { if (!o.visible) return false; top = o; }
    if (top !== this.e.scene) return false;
    const me = s.matrixWorld.elements;
    const dx = me[12] - cx, dy = me[13] - cy, dz = me[14] - cz;
    const md = it.opts.maxDist || this.maxDist;
    return dx * dx + dy * dy + dz * dz < md * md;
  }

  render(renderer) {
    if (!this.on || !this.items.length) return;
    const E = this.e, G = E.grade;
    this.drawn = 0;
    // the whole picture distorted: the screens stay as soft as the rest of it
    if (G.get('uBlur') > 0.02 || G.get('uFog') > 0.02 || G.get('uCamHeat') > 0.02 || G.get('uHeat') > 0.05 ||
      G.get('uPixel') > 1.01 || G.get('uHypoxia') > 0.3 || G.get('uFade') > 0.985) return;
    const P = E.mfPass;
    const cabin = !!P.cabin;
    const src = cabin ? P.cams.cabin : P.cams.near;
    const bit = 1 << (cabin ? LAYER_CABIN : LAYER_NEAR);
    const ce = src.matrixWorld.elements;
    let any = 0;
    for (const it of this.items) {
      const vis = this.shown(it, bit, ce[12], ce[13], ce[14]);
      if (vis && it.src.material !== it.srcMat && !this.build(it)) { it.proxy.visible = false; continue; }
      it.proxy.visible = vis;
      if (!vis) continue;
      any++;
      it.proxy.matrixWorld.copy(it.src.matrixWorld);
      if (it.sync) it.sync();
    }
    if (!any) return;
    this.drawn = any;
    const C = this.cam;
    C.matrixWorld.copy(src.matrixWorld);
    C.matrixWorldInverse.copy(src.matrixWorldInverse);
    C.projectionMatrix.copy(src.projectionMatrix);
    C.projectionMatrixInverse.copy(src.projectionMatrixInverse);
    C.near = src.near; C.far = src.far;
    const U = this.U;
    const db = renderer.getDrawingBufferSize(this._sz);
    U.uCrispScr.value.set(1 / db.x, 1 / db.y, src.near, Math.min(src.far, BIG));
    U.tCrispDepth.value = E.composer.inputBuffer.depthTexture;
    renderer.setRenderTarget(null);
    renderer.clearDepth();
    renderer.render(this.scene, C);
  }
}
