// Assembles the ship's visual model (exterior + interior + glass) under one root group,
// keeps shared ship uniforms up to date and produces environment maps for reflections.
import * as THREE from 'three';
import { createMaterials, shipUniforms } from './materials.js';
import { buildExterior, buildGlass } from './exterior.js';
import { buildInteriorShell } from './interior.js';
import { createGlassMaterial, glassUniforms } from './glass.js';
import { mergeGeometries } from './geom.js';
import { setLayersDeep, LAYER_NEAR, LAYER_MID, LAYER_FAR, assignLayers } from '../core/layers.js';
import { OPENINGS } from './hullShape.js';
import { QUALITY } from '../core/quality.js';

export class ShipVisual {
  constructor(engine) {
    this.engine = engine;
    this.root = new THREE.Group();
    this.root.name = 'shipRoot';
    this.root.matrixAutoUpdate = false;
    this.M = createMaterials();
    this.envSpace = null;
    this.envInterior = null;
  }

  build(extraBuilders = []) {
    const M = this.M;
    const ext = buildExterior(M);
    this.exterior = ext.group;
    this.rcsSpots = ext.rcsSpots;
    this.extLights = ext.lights;
    this.rails = ext.rails;
    this.ladder = ext.ladder;
    this.root.add(this.exterior);
    const shell = buildInteriorShell(M);
    this.interiorBuilder = shell.builder;
    for (const fn of extraBuilders) fn(shell.builder, M);
    // (LOW II: the cabin in sections along the ship, so what is behind the viewer is not drawn)
    this.interior = shell.builder.build(M, QUALITY.level === 'low2' ? { chunks: [-6.5, -1.0, 4.0] } : {});
    this.root.add(this.interior);
    this.colliders = shell.builder.colliders;
    this.extColliders = ext.colliders;
    this.lampsCorridor = shell.lampsCorridor;

    // glass
    const glass = buildGlass();
    this.glassOuterMat = createGlassMaterial(null, false);
    this.glassInnerMat = createGlassMaterial(null, true);
    const go = new THREE.Mesh(mergeGeometries(glass.outer, false), this.glassOuterMat);
    const gi = new THREE.Mesh(mergeGeometries(glass.inner, false), this.glassInnerMat);
    go.renderOrder = 10; gi.renderOrder = 11;
    go.matrixAutoUpdate = gi.matrixAutoUpdate = false;
    this.root.add(go, gi);
    this.glassOuter = go; this.glassInner = gi;
    setLayersDeep(this.root, LAYER_NEAR);
    // the exterior should also be visible from afar (EVA / external cameras)
    this.exterior.traverse((o) => o.layers.enable(LAYER_MID));

    // openings uniform (matrices)
    const U = shipUniforms.uOpen.value;
    OPENINGS.forEach((o, i) => {
      const m = U[i];
      m.set(
        o.center.x, o.u.x, o.v.x, o.normal.x,
        o.center.y, o.u.y, o.v.y, o.normal.y,
        o.center.z, o.u.z, o.v.z, o.normal.z,
        o.halfW, o.halfH, o.radius, 0.6,
      );
    });
    shipUniforms.uOpenCount.value = OPENINGS.length;
    // (the canopy is closed now: no hole cut in the nose — uCanopy stays off)
    this._setupEnv();
    return this;
  }

  _setupEnv() {
    const r = this.engine.renderer;
    this.pmrem = new THREE.PMREMGenerator(r);
    // cube copy that scrubs NaN / Inf (one bad sample would otherwise poison every reflection)
    this.cleanMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uFace: { value: 0 }, uSize: { value: 256 } },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform samplerCube tSrc; uniform int uFace; uniform float uSize;
        void main(){
          vec2 st = gl_FragCoord.xy / uSize; float sc = st.x * 2.0 - 1.0, tc = st.y * 2.0 - 1.0; vec3 d;
          if (uFace == 0) d = vec3(1.0, -tc, -sc); else if (uFace == 1) d = vec3(-1.0, -tc, sc);
          else if (uFace == 2) d = vec3(sc, 1.0, tc); else if (uFace == 3) d = vec3(sc, -1.0, -tc);
          else if (uFace == 4) d = vec3(sc, -tc, 1.0); else d = vec3(-sc, -tc, -1.0);
          vec3 c = textureLod(tSrc, d, 0.0).rgb;
          if (!(c.r == c.r && c.g == c.g && c.b == c.b) || any(isinf(c))) c = vec3(0.0);
          gl_FragColor = vec4(clamp(c, 0.0, 30000.0), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.cleanQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.cleanMat);
    this.cleanQuad.frustumCulled = false;
    this.cleanScene = new THREE.Scene();
    this.cleanScene.add(this.cleanQuad);
    this.cleanCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // space env: rendered from the FAR + MID layers occasionally
    this.cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter });
    this.cubeClean = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.cubeCam = new THREE.CubeCamera(1, 2e9, this.cubeRT);
    this.cubeCam.layers.set(LAYER_FAR);
    this.envTimer = 0;
    // interior env: simple warm room gradient until captured
    this.interiorCubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter });
    this.interiorClean = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.interiorCubeCam = new THREE.CubeCamera(0.05, 40, this.interiorCubeRT);
    this.interiorCubeCam.layers.set(LAYER_NEAR);
  }

  _clean(src, dst, size) {
    const r = this.engine.renderer;
    const prev = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    this.cleanMat.uniforms.tSrc.value = src.texture;
    this.cleanMat.uniforms.uSize.value = size;
    for (let f = 0; f < 6; f++) {
      this.cleanMat.uniforms.uFace.value = f;
      r.setRenderTarget(dst, f);
      r.render(this.cleanScene, this.cleanCam);
    }
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
    return dst;
  }

  /** capture environment maps (call sparingly) */
  captureEnv(scene, camWorld, interior = false) {
    const r = this.engine.renderer;
    r.shadowMap.needsUpdate = true;
    if (interior) {
      this.interiorCubeCam.position.copy(camWorld);
      this.interiorCubeCam.updateMatrixWorld();
      const vis = this.glassOuter.visible;
      // (the cabin may be switched off while the camera is outside: it is what this captures)
      const cabin = this.interior.visible;
      this.interior.visible = true;
      this.interiorCubeCam.update(r, scene);
      this.interior.visible = cabin;
      this._clean(this.interiorCubeRT, this.interiorClean, 128);
      const env = this.pmrem.fromCubemap(this.interiorClean.texture);
      if (this.envInterior) this.envInterior.dispose();
      this.envInterior = env.texture;
      this.glassInnerMat.uniforms.envMap.value = this.interiorClean.texture;
      for (const k of Object.keys(this.M)) {
        const m = this.M[k];
        if (m.isMeshStandardMaterial && !this._isExteriorMat(k)) { m.envMap = this.envInterior; m.envMapIntensity = 0.55; m.needsUpdate = true; }
      }
    } else {
      this.cubeCam.position.copy(camWorld);
      this.cubeCam.updateMatrixWorld();
      this.cubeCam.update(r, scene);
      this._clean(this.cubeRT, this.cubeClean, 256);
      const env = this.pmrem.fromCubemap(this.cubeClean.texture);
      if (this.envSpace) this.envSpace.dispose();
      this.envSpace = env.texture;
      this.glassOuterMat.uniforms.envMap.value = this.cubeClean.texture;
      for (const k of Object.keys(this.M)) {
        const m = this.M[k];
        if (m.isMeshStandardMaterial && this._isExteriorMat(k)) {
          const first = !m.envMap;
          m.envMap = this.envSpace; m.envMapIntensity = 1.0;
          if (first) m.needsUpdate = true;
        }
      }
    }
  }

  _isExteriorMat(k) {
    return ['hull', 'hullDark', 'hullOrange', 'mli', 'radiator', 'nozzle', 'gold', 'solar', 'decal', 'metal', 'metalDark', 'steel'].includes(k);
  }

  /** re-entry heating glow (0..1.6) and air-flow direction in ship axes (direction of travel) */
  setHeat(h, travelDirLocal) {
    shipUniforms.uHeat.value = h;
    if (travelDirLocal) shipUniforms.uHeatDir.value.copy(travelDirLocal).negate();
    glassUniforms.uHeatGlass.value = Math.min(1, h * 0.8);
  }

  /** condensation / frost on the inner window panes (0..1) */
  setFrost(v) { glassUniforms.uFrost.value = v; }

  update(dt, time) {
    this.root.updateMatrixWorld(true);
    shipUniforms.uWorldToShip.value.copy(this.root.matrixWorld).invert();
    shipUniforms.uTime.value = time % 1000;
    glassUniforms.uTimeG.value = time % 1000;
  }
}
