// The space environment: Earth (terrain, clouds, atmosphere), Sun, Moon, stars, lights.
// World (render) frame = ECI translated so that the render origin (the ship) is at 0.
import * as THREE from 'three';
import { AtmosphereLUTs, cpuTransmittance } from './atmosphere.js';
import { createTerrainMaterial } from './earth/terrainMaterial.js';
import { EarthTerrain } from './earth/earthTerrain.js';
import { EarthTiles } from './earth/earthTiles.js';
import { HiresImagery } from './earth/hiresImagery.js';
import { createClouds, CLOUD_ALT } from './earth/clouds.js';
import { createSkyShell } from './earth/skyShell.js';
import { createStars, createMilkyWay, createSun } from './sky.js';
import { gmst, sunDirection, moonPosition, R_EARTH, R_MOON, eciToEcef } from '../core/astro.js';
import { assignLayers, setLayers, LAYER_FAR, LAYER_MID, LAYER_NEAR } from '../core/layers.js';
import { passRange } from '../core/engine.js';
import { assetUrl } from './earth/earthAssets.js';

export const SUN_E = 7.5; // sun illuminance in engine units

export class Space {
  constructor(engine, earthAssets) {
    this.engine = engine;
    const scene = engine.scene;
    this.atmo = new AtmosphereLUTs(engine.renderer);
    this.shared = {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunDirEcef: { value: new THREE.Vector3(1, 0, 0) },
      uEarthCenterKm: { value: new THREE.Vector3() },
      uSunIllum: { value: SUN_E },
      uEcefToWorld: { value: new THREE.Matrix3() },
      uWorldToEcef: { value: new THREE.Matrix3() },
      uCloudRot: { value: 0 },
      uTime: { value: 0 },
      uMoonLight: { value: new THREE.Vector4(0, 1, 0, 0) },
    };
    this.earthGroup = new THREE.Group();
    this.earthGroup.matrixAutoUpdate = false;
    scene.add(this.earthGroup);
    this.tiles = new EarthTiles();
    this.tiles.renderer = engine.renderer;
    this.hires = new HiresImagery(engine.renderer);
    this.terrainMat = createTerrainMaterial(earthAssets, this.atmo, this.shared, this.tiles, this.hires);
    this.terrain = new EarthTerrain(earthAssets, this.terrainMat, this.earthGroup);

    this.clouds = createClouds(earthAssets, this.atmo, this.shared);
    this.clouds.material.uniforms.uPassRange = passRange;
    this.skyShell = createSkyShell(this.atmo, this.shared);
    this.skyShell.material.uniforms.uPassRange = passRange;
    injectPassDiscard(this.clouds.material);
    injectPassDiscard(this.skyShell.material);
    this.clouds.matrixAutoUpdate = false;
    this.skyShell.matrixAutoUpdate = false;
    scene.add(this.clouds);
    scene.add(this.skyShell);

    this.milky = createMilkyWay();
    this.milky.matrixAutoUpdate = false;
    scene.add(this.milky);
    this.sun = createSun();
    scene.add(this.sun);
    this.stars = null;
    createStars().then((s) => { this.stars = s; s.matrixAutoUpdate = false; scene.add(s); });

    // Moon
    const tl = new THREE.TextureLoader();
    const mcol = tl.load(assetUrl('moon/color_2k.jpg'));
    mcol.colorSpace = THREE.SRGBColorSpace; mcol.anisotropy = 4;
    const mnor = tl.load(assetUrl('moon/normal_2k.jpg'));
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(R_MOON, 128, 64),
      new THREE.MeshStandardMaterial({ map: mcol, normalMap: mnor, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 1.0, metalness: 0.0 }),
    );
    this.moon.matrixAutoUpdate = false;
    setLayers(this.moon, LAYER_FAR);
    scene.add(this.moon);

    // Sun light (also used for ship shadows)
    this.sunLight = new THREE.DirectionalLight(0xffffff, SUN_E);
    this.sunLight.castShadow = true;
    const sc = this.sunLight.shadow.camera;
    sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 80;
    this.sunLight.shadow.mapSize.set(4096, 4096);
    this.sunLight.shadow.bias = -0.0006;
    this.sunLight.shadow.normalBias = 0.045;
    this.sunLight.shadow.radius = 1.6;
    this.sunLight.layers.enableAll();
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);
    // Earthshine: hemisphere light pointing from Earth (no shadows, used for exterior only)
    this.earthshine = new THREE.DirectionalLight(0x9fbcff, 0);
    this.earthshine.castShadow = true;
    {
      const ec = this.earthshine.shadow.camera;
      ec.left = -16; ec.right = 16; ec.top = 16; ec.bottom = -16; ec.near = 1; ec.far = 80;
      this.earthshine.shadow.mapSize.set(1024, 1024);
      this.earthshine.shadow.bias = -0.001;
      this.earthshine.shadow.normalBias = 0.04;
      this.earthshine.shadow.radius = 3;
    }
    this.earthshine.layers.enableAll();
    // earthshine changes slowly: its shadow map is refreshed every few frames (see update)
    this.earthshine.shadow.autoUpdate = false;
    this.earthshine.shadow.needsUpdate = true;
    this._esFrame = 0;
    scene.add(this.earthshine);
    scene.add(this.earthshine.target);

    this.sunDir = new THREE.Vector3(1, 0, 0);
    this.moonPos = new THREE.Vector3();
    this.theta = 0;
    this._m4 = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._camEcef = new THREE.Vector3();
    this._trans = [1, 1, 1];
    this.sunColor = new THREE.Color(1, 1, 1);
    this.sunVisible = 1;
    this.flashT = 0;
    this.strokes = 0;
    this.strokeT = 0;
  }

  /**
   * origin: Vector3 ECI (float64) of the render origin
   * camWorld: Vector3 camera position in the render frame
   * timeMs: game time (unix ms)
   */
  update(origin, camWorld, timeMs, dt, shadowCenterWorld) {
    const sh = this.shared;
    this.theta = gmst(timeMs);
    sunDirection(timeMs, this.sunDir);
    moonPosition(timeMs, this.moonPos);
    const th = this.theta;
    // Earth group: translate to (0 - origin), rotate about Y by theta
    const eg = this.earthGroup;
    eg.matrix.makeRotationY(th);
    eg.matrix.setPosition(-origin.x, -origin.y, -origin.z);
    eg.matrixWorld.copy(eg.matrix);
    // shared uniforms
    sh.uSunDir.value.copy(this.sunDir);
    eciToEcef(this.sunDir, th, sh.uSunDirEcef.value);
    sh.uEarthCenterKm.value.set(-origin.x / 1000, -origin.y / 1000, -origin.z / 1000);
    const m3 = new THREE.Matrix3().setFromMatrix4(this._m4.makeRotationY(th));
    sh.uEcefToWorld.value.copy(m3);
    sh.uWorldToEcef.value.copy(m3).transpose();
    sh.uTime.value = timeMs / 1000 % 100000;
    sh.uCloudRot.value = (timeMs / 1000) * 2.0e-6 % (Math.PI * 2);

    // camera in Earth-fixed coords
    const camEci = this._v.copy(camWorld).add(origin);
    eciToEcef(camEci, th, this._camEcef);
    const camR = camEci.length();
    const camAlt = camR - R_EARTH;
    this.camAlt = camAlt;
    this.terrain.update(this._camEcef, eg.matrixWorld, camWorld);
    {
      const ce = this._camEcef;
      const rr = ce.length();
      this.camLat = Math.asin(ce.y / rr);
      this.camLon = Math.atan2(-ce.z, ce.x);
      this.tiles.update(this.camLat, this.camLon, dt, camAlt);
      this.hires.update(this.camLat, this.camLon, camAlt, dt);
    }

    // clouds / sky shell positioned at the Earth centre (shaders do exact geometry)
    for (const o of [this.clouds, this.skyShell]) {
      o.matrix.makeTranslation(-origin.x, -origin.y, -origin.z);
      o.matrixWorld.copy(o.matrix);
    }
    const Rc = R_EARTH + CLOUD_ALT;
    this.clouds.material.side = camR > Rc + 2500 ? THREE.FrontSide : THREE.BackSide;
    const dC = Math.abs(camR - Rc);
    assignLayers(this.clouds, Math.max(0, dC - 3000), camR + Rc);
    const Rs = R_EARTH + 101500;
    assignLayers(this.skyShell, Math.max(0, Math.abs(camR - Rs) - 100), camR + Rs);
    // detail origin for cloud noise (km)
    const cdo = this.clouds.material.uniforms.uDetailOriginKm.value;
    const S = 16384;
    const ce = this._camEcef.clone().normalize().multiplyScalar(Rc);
    cdo.set(Math.round(ce.x / S) * S / 1000, Math.round(ce.y / S) * S / 1000, Math.round(ce.z / S) * S / 1000);
    // lightning: storm cells in the tropics, only in darkness, a cell some tens of km across that
    // flickers with a few return strokes (the old 900 km wide flash anywhere, day or night, every
    // couple of seconds lit up the whole window)
    this.flashT -= dt;
    const cu = this.clouds.material.uniforms;
    if (this.flashT <= 0) {
      this.flashT = 4 + Math.random() * 9;
      const sunE = sh.uSunDirEcef.value;
      for (let k = 0; k < 8; k++) {
        const lat = (Math.random() - 0.5) * 0.8, lon = Math.random() * Math.PI * 2;
        const d = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
        if (d.dot(sunE) < -0.12) { cu.uFlashDir.value.copy(d); this.strokes = 1 + Math.floor(Math.random() * 3); this.strokeT = 0; break; }
      }
    }
    if (this.strokes > 0) {
      this.strokeT -= dt;
      if (this.strokeT <= 0) { cu.uFlash.value = 0.5 + Math.random() * 0.5; this.strokes--; this.strokeT = 0.06 + Math.random() * 0.12; }
    }
    cu.uFlash.value *= Math.exp(-dt * 22);

    // sky background follows the camera
    for (const o of [this.milky, this.stars]) {
      if (!o) continue;
      o.matrix.makeTranslation(camWorld.x, camWorld.y, camWorld.z);
      o.matrixWorld.copy(o.matrix);
    }
    if (this.stars) {
      const u = this.stars.material.uniforms;
      u.uTime.value = sh.uTime.value;
      u.uPixelScale.value = this.engine.pr;
      u.uTwinkle.value = camAlt < 60000 ? 1 - camAlt / 60000 : 0;
    }
    // sun: transmittance along camera->sun, Earth occlusion handled by depth
    const up = this._v2.copy(camEci).normalize();
    const mu = up.dot(this.sunDir);
    cpuTransmittance(camR / 1000, mu, this._trans);
    const t = this._trans;
    this.sunColor.setRGB(t[0], t[1], t[2]);
    const sd = 1.0e9;
    this.sun.matrix.compose(
      this._v.set(camWorld.x + this.sunDir.x * sd, camWorld.y + this.sunDir.y * sd, camWorld.z + this.sunDir.z * sd),
      new THREE.Quaternion(), new THREE.Vector3(1, 1, 1).multiplyScalar(sd * 0.00465 * 40));
    this.sun.matrixWorld.copy(this.sun.matrix);
    this.sun.material.uniforms.uColor.value.copy(this.sunColor);

    // moonlight (phase-dependent) for the night side
    {
      const md = this._v.copy(this.moonPos).normalize();
      const phase = 0.5 * (1 - md.dot(this.sunDir)); // 1 = full moon
      sh.uMoonLight.value.set(md.x, md.y, md.z, SUN_E * 2.2e-3 * phase * phase);
    }
    // Moon
    this.moon.matrix.makeRotationFromEuler(new THREE.Euler(0, Math.atan2(-this.moonPos.z, this.moonPos.x) + Math.PI, 0));
    this.moon.matrix.setPosition(this.moonPos.x - origin.x, this.moonPos.y - origin.y, this.moonPos.z - origin.z);
    this.moon.matrixWorld.copy(this.moon.matrix);

    // lights
    const sl = this.sunLight;
    sl.color.copy(this.sunColor);
    sl.intensity = SUN_E;
    const c = shadowCenterWorld || camWorld;
    sl.position.set(c.x + this.sunDir.x * 40, c.y + this.sunDir.y * 40, c.z + this.sunDir.z * 40);
    sl.target.position.copy(c);
    sl.updateMatrixWorld();
    sl.target.updateMatrixWorld();
    // earthshine strength: lit fraction of the visible Earth disc
    const toEarth = this._v.copy(camEci).multiplyScalar(-1).normalize();
    const phase = 0.5 * (1 + toEarth.dot(this.sunDir) * -1); // 1 when we see the day side
    const solid = 1 - Math.sqrt(Math.max(0, 1 - (R_EARTH / camR) ** 2));
    this.earthshine.intensity = SUN_E * 0.3 * phase * solid * 1.2;
    if (++this._esFrame % 4 === 0) this.earthshine.shadow.needsUpdate = true;
    this.earthshine.position.set(c.x + toEarth.x * 40, c.y + toEarth.y * 40, c.z + toEarth.z * 40);
    this.earthshine.target.position.copy(c);
    this.earthshine.updateMatrixWorld();
    this.earthshine.target.updateMatrixWorld();
    this.toEarth = toEarth.clone();
    this.earthLitFactor = phase * solid;
  }
}

function injectPassDiscard(mat) {
  // fragments owned by another pass are discarded (prevents double blending in overlaps). The
  // test is on view depth, like the passes' near / far planes: with the straight-line distance a
  // fragment toward the screen's edge could be beyond the mid pass's share yet in front of the far
  // pass's near plane, and the sky showed black wedges there when flying low
  mat.fragmentShader = mat.fragmentShader.replace('void main(){', 'uniform vec2 uPassRange;\nvoid main(){\n  { float pd = -(viewMatrix * vec4(vWorld, 1.0)).z; if (pd < uPassRange.x || pd >= uPassRange.y) discard; }\n');
}
