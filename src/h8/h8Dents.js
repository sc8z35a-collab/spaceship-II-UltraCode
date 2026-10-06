// H8's battle damage, for real: every blow the armour takes leaves its mark in the hull itself.
// The shell is pushed in — a bowl with a raised, cracked lip; the plates, their bolts, the
// markings and the camera pods in it all go in with it (the GPU moves every vertex of the outer
// layer, so the dent follows the real surface) — scorched black round it, bare bright metal on the
// crater floor, white-hot at first and cooling through orange to a dull red. A heavy hit punches
// through the outer plate: the hole is torn open (its jagged petals curl into it) and the dark
// layer underneath shows. When the inner armour goes too, the cabin air vents out of the hole as
// a stream of ice crystals. Hits near a camera can blind it (its part of the 360-degree picture
// goes dark). Everything is kept in the save and stays until the repair dock.
import * as THREE from 'three';
import { H8, CAMERAS } from './h8Spec.js';
import { LAYER_NEAR } from '../core/layers.js';
import { Pockmarks } from '../combat/pockmarks.js';
import { CAM_DEAD } from './h8Display.js';

export const DENT_MAX = 12;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** shared uniforms of every dented material */
export const DENT_U = {
  uDentN: { value: 0 },
  uDentA: { value: Array.from({ length: DENT_MAX }, () => new THREE.Vector4()) },   // dir.xyz, angular radius
  uDentB: { value: Array.from({ length: DENT_MAX }, () => new THREE.Vector4()) },   // depth, lip, heat, hole (in crater radii)
  uDentC: { value: Array.from({ length: DENT_MAX }, () => new THREE.Vector4()) },   // soot, seed, -, -
  uH8Root: { value: new THREE.Matrix4() },
  uH8RootInv: { value: new THREE.Matrix4() },
};

// the outer layer that dents: from just under the plates to just over them (the camera pods,
// thrusters and bolts too; not the radiators, the umbilical, or anything inside)
const BAND = [H8.R - 0.5, H8.R + 0.6].map((x) => x.toFixed(3));

const VERT_HEAD = /* glsl */`
uniform int uDentN; uniform vec4 uDentA[${DENT_MAX}]; uniform vec4 uDentB[${DENT_MAX}];
uniform mat4 uH8Root; uniform mat4 uH8RootInv;
varying vec3 vH8P;`;

const VERT_DENT = /* glsl */`
vec3 h8Disp = vec3(0.0);
{
  mat4 toH8 = uH8RootInv * modelMatrix;
  #ifdef USE_INSTANCING
    toH8 = toH8 * instanceMatrix;
  #endif
  vec3 hp = (toH8 * vec4(position, 1.0)).xyz;
  vH8P = hp;
  float rr = length(hp);
  if (uDentN > 0 && rr > ${BAND[0]} && rr < ${BAND[1]}) {
    vec3 u = hp / rr;
    float inward = 0.0;
    vec3 tilt = vec3(0.0);
    for (int i = 0; i < ${DENT_MAX}; i++) {
      if (i >= uDentN) break;
      vec4 A = uDentA[i], B = uDentB[i];
      float c = dot(u, A.xyz);
      float th = acos(clamp(c, -1.0, 1.0));
      float s = th / A.w;
      if (s > 1.6) continue;
      // the bowl, and the lip thrown up round it
      float q = max(0.0, 1.0 - s * s);
      float bowl = q * q, dBowl = -4.0 * s * q;
      float lx = (s - 1.08) / 0.17, lip = exp(-lx * lx), dLip = -2.0 * lx / 0.17 * lip;
      float hgt = B.x * bowl - B.y * lip;
      float dh = (B.x * dBowl - B.y * dLip) / (A.w * rr);      // slope along the surface
      inward += hgt;
      vec3 t = A.xyz - u * c;
      float tl = length(t);
      if (tl > 1e-5) tilt += t / tl * (-dh);                   // the walls lean toward the middle
    }
    // fade out at the edges of the band (no tearing where the layer ends)
    float band = smoothstep(${BAND[0]}, ${(H8.R - 0.3).toFixed(3)}, rr) * (1.0 - smoothstep(${(H8.R + 0.35).toFixed(3)}, ${BAND[1]}, rr));
    mat3 toObj = transpose(mat3(toH8));
    h8Disp = toObj * (-u * inward * band);
    objectNormal = normalize(objectNormal + toObj * tilt * band);
    vH8P = hp - u * inward * band;
  }
}`;

const FRAG_HEAD = /* glsl */`
uniform int uDentN; uniform vec4 uDentA[${DENT_MAX}]; uniform vec4 uDentB[${DENT_MAX}]; uniform vec4 uDentC[${DENT_MAX}];
varying vec3 vH8P;`;

const fragDent = (plate) => /* glsl */`
float dSoot = 0.0, dBare = 0.0, dCrack = 0.0;
vec3 dGlow = vec3(0.0);
{
  float rr = length(vH8P);
  if (uDentN > 0 && rr > ${BAND[0]} && rr < ${BAND[1]}) {
    vec3 u = vH8P / rr;
    for (int i = 0; i < ${DENT_MAX}; i++) {
      if (i >= uDentN) break;
      vec4 A = uDentA[i], B = uDentB[i], Cc = uDentC[i];
      float c = dot(u, A.xyz);
      if (c < cos(min(3.0, A.w * 2.6))) continue;
      float s = acos(clamp(c, -1.0, 1.0)) / A.w;
      // the angle round the crater (for the spokes of soot and the cracks)
      vec3 ax = normalize(cross(A.xyz, abs(A.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
      vec3 ay = cross(A.xyz, ax);
      float phi = atan(dot(u, ay), dot(u, ax));
      float seed = Cc.y * 40.0;
      float spokes = pow(abs(sin(phi * (4.0 + floor(Cc.y * 5.0)) + seed + 1.3 * sin(phi * 3.0 + seed))), 5.0);
      float reach = 1.15 + 0.9 * Cc.x * (0.5 + spokes);
      dSoot = max(dSoot, (1.0 - smoothstep(0.35, reach, s)) * (0.5 + 0.5 * Cc.x));
      dBare = max(dBare, (1.0 - smoothstep(0.2, 0.75, s)) * (1.0 - 0.6 * Cc.x));
      // radial cracks through the paint round a deep one
      float cr = smoothstep(0.965, 1.0, abs(sin(phi * 7.0 + seed * 1.7 + s * 2.3 + 0.6 * sin(phi * 13.0 + seed))));
      dCrack = max(dCrack, cr * smoothstep(0.55, 0.8, s) * (1.0 - smoothstep(1.1, 1.6, s)) * min(1.0, B.x * 14.0));
      // a fresh hit glows: white-hot in the middle, orange to dull red outward, then it cools
      float hot = B.z * (1.0 - smoothstep(0.0, 0.6, s / max(0.3, sqrt(B.z))));
      dGlow += mix(vec3(0.9, 0.16, 0.02), vec3(1.0, 0.8, 0.5), hot * hot) * hot * 2.2;
      ${plate ? `// torn through: the outer plate is gone (the dark layer below shows)
      if (B.w > 0.0) {
        float edge = B.w * (0.82 + 0.16 * sin(phi * 9.0 + seed) + 0.1 * sin(phi * 23.0 + seed * 2.0));
        if (s < edge) discard;
        dGlow += vec3(1.0, 0.35, 0.06) * B.z * 1.6 * (1.0 - smoothstep(edge, edge + 0.12, s));
        dSoot = max(dSoot, 1.0 - smoothstep(edge, edge + 0.5, s));
      }` : ''}
    }
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.6, 0.62), dBare * 0.55);
    diffuseColor.rgb *= (1.0 - 0.85 * dSoot) * (1.0 - 0.75 * dCrack);
  }
}`;

/** give a material the dents (plate: the outer plates, which can be torn through) */
export function dentify(mat, plate = false) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey && mat.hasOwnProperty('customProgramCacheKey') ? mat.customProgramCacheKey : null;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, DENT_U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + VERT_DENT)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += h8Disp;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <alphamap_fragment>', fragDent(plate) + '\n#include <alphamap_fragment>')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(mix(roughnessFactor, 0.97, dSoot), 0.32, dBare * 0.6);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(mix(metalnessFactor, 0.02, dSoot), 0.9, dBare * 0.6);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += dGlow;`);
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|h8dent' + (plate ? 'P' : '');
  mat.needsUpdate = true;
  return mat;
}

/** the jagged petals of a hole torn through the outer plate, curling into it (H8-local) */
function petalGeometry(dir, rHole, depthAt, seed) {
  const R = H8.R;
  const ax = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize();
  const ay = new THREE.Vector3().crossVectors(dir, ax);
  const rnd = (k) => { const x = Math.sin(k * 12.9898 + seed * 78.233) * 43758.5453; return x - Math.floor(x); };
  const N = 7 + Math.floor(rnd(1) * 5);
  const pos = [], idx = [];
  const at = (phi, rho, sink) => {
    // a point at distance rho from the crater axis on the (dented) sphere, sunk a further 'sink'
    const a = rho / R;
    const u = dir.clone().multiplyScalar(Math.cos(a)).addScaledVector(ax, Math.sin(a) * Math.cos(phi)).addScaledVector(ay, Math.sin(a) * Math.sin(phi));
    return u.multiplyScalar(R - depthAt(rho) - sink);
  };
  for (let k = 0; k < N; k++) {
    const p0 = (k + 0.08 + rnd(k + 3) * 0.1) / N * Math.PI * 2, p1 = (k + 0.92 - rnd(k + 7) * 0.1) / N * Math.PI * 2;
    const len = rHole * (0.45 + rnd(k + 11) * 0.6);
    const curl = 0.5 + rnd(k + 13) * 0.9;
    // a strip from the rim inward and down, narrowing to a ragged tip
    const S = 5;
    const base = pos.length / 3;
    for (let j = 0; j <= S; j++) {
      const f = j / S;
      const w = (1 - f * 0.85) * (0.5 + 0.5 * rnd(k * 7 + j));
      const pm = (p0 + p1) / 2, ph = (p1 - p0) / 2 * w;
      const rho = rHole * (1.02 - f * 0.55);
      const sink = len * f * curl * f + 0.01;
      for (const s of [-1, 1]) { const p = at(pm + s * ph, rho, sink); pos.push(p.x, p.y, p.z); }
    }
    for (let j = 0; j < S; j++) { const a = base + j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** the hull's damage record and its effects */
export class H8Hull {
  constructor(vessel) {
    this.v = vessel;
    this.dents = [];          // { dir, a, depth, lip, heat, hole, soot, seed, E }
    this.cams = [1, 1, 1, 1];
    this.petals = [];
    this.vents = [];
    this.petalMat = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.55, metalness: 0.75, side: THREE.DoubleSide });
    // bullet strikes: pits on the plates (they sink with the dents they lie in)
    this.pocks = new Pockmarks(vessel.ext.group, 300, [LAYER_NEAR]);
    dentify(this.pocks.mesh.material);
    vessel.extMeshes.push(this.pocks.mesh);
  }

  /** a blow: dir (H8-local unit, from the centre to the point hit), E (J). Returns the dent */
  hit(dir, E, opts = {}) {
    const d = dir.clone().normalize();
    // a gun round: a pit on the plate — until the strikes crowd together and the plate there gives
    if (opts.shot && E < 2e6) {
      const p = d.clone().multiplyScalar(H8.R + 0.03);
      this.pocks.add(p, d, 0.22 + 0.06 * Math.cbrt(E / 5e5));
      const v = this.v;
      if (v.fx) {
        v.fx.burst('spark', p, d, Math.min(60, 14 + E / 3e4), { speed: 6, spread: 0.9 });
        v.fx.burst('debris', p, d, 5, { speed: 2.5, spread: 1.0 });
      }
      if (this.pocks.countNear(p, 0.45) < 6) {
        const blinded = this.camHit(d, E, 0.06);
        this.sync();
        return { dent: { hole: 0, holeSaid: true }, blinded };
      }
    }
    const k = Math.cbrt(Math.max(1, E) / 1000);
    const rc = Math.min(0.95, 0.05 + 0.021 * k);
    const depth = Math.min(0.24, 0.006 + 0.0042 * k);
    const a = rc / H8.R;
    let dent = this.dents.find((x) => x.dir.angleTo(d) < Math.max(x.a, a) * 0.7);
    if (dent) {
      // the same spot again: deeper, wider, and torn through sooner
      dent.depth = Math.min(0.3, dent.depth + depth * 0.7);
      dent.a = Math.max(dent.a, a) * 1.05;
      dent.E += E;
      dent.heat = Math.min(1, dent.heat + 0.5 + Math.log10(Math.max(10, E)) / 14);
      dent.soot = Math.min(1, dent.soot + 0.25);
    } else {
      if (this.dents.length >= DENT_MAX) {
        // the hull is covered in them: the smallest goes (it merges into the scarring)
        let iMin = 0;
        for (let i = 1; i < this.dents.length; i++) if (this.dents[i].depth < this.dents[iMin].depth) iMin = i;
        this.dents.splice(iMin, 1);
      }
      dent = { dir: d, a, depth, lip: depth * 0.22, heat: Math.min(1, 0.45 + Math.log10(Math.max(10, E)) / 14), hole: 0, soot: Math.min(1, 0.25 + E / 3e7), seed: Math.random(), E };
      this.dents.push(dent);
    }
    dent.lip = dent.depth * 0.22;
    // torn through: a big enough blow (or the plate there was already worn thin)
    if ((dent.E > 2.5e7 || (opts.outer !== undefined && opts.outer < 0.12 && dent.E > 4e6)) && !dent.hole) {
      dent.hole = Math.min(0.6, 0.28 + Math.log10(dent.E / 2.5e7 + 1) * 0.3);
      this.addPetals(dent);
    }
    // cameras near the blow
    const blinded = this.camHit(d, E, dent.a);
    this.sync();
    // sparks and spall off the face; a fresh crater smokes a little
    const v = this.v;
    if (v.fx) {
      const p = d.clone().multiplyScalar(H8.R + 0.02);
      v.fx.burst('spark', p, d, Math.min(160, 20 + E / 4e4), { speed: 5 + Math.min(20, k * 0.6), spread: 0.9 });
      v.fx.burst('debris', p, d, Math.min(80, 6 + E / 2e5), { speed: 2 + Math.min(8, k * 0.25), spread: 1.0 });
      if (E > 1e6) v.fx.burst('smoke', p, d, 12, { speed: 0.6, spread: 0.8 });
    }
    return { dent, blinded };
  }

  /** a blow near a camera hurts it (0 = gone): returns the camera that just went blind, or -1 */
  camHit(d, E, a) {
    let blinded = -1;
    CAMERAS.forEach((c, i) => {
      const ang = c.dir.angleTo(d);
      const reach = a * 1.4 + 0.1;
      if (ang < reach) {
        const before = this.cams[i];
        this.cams[i] = Math.max(0, this.cams[i] - Math.min(1, E / 1.2e7 + 0.05) * (1 - ang / reach));
        if (before >= CAM_DEAD && this.cams[i] < CAM_DEAD) blinded = i;
      }
    });
    return blinded;
  }

  addPetals(dent) {
    const rHole = dent.hole * dent.a * H8.R;
    const depthAt = (rho) => { const s = rho / (dent.a * H8.R); const q = Math.max(0, 1 - s * s); return dent.depth * q * q; };
    const mesh = new THREE.Mesh(petalGeometry(dent.dir, rHole, depthAt, dent.seed), this.petalMat);
    mesh.layers.set(LAYER_NEAR);
    mesh.userData.dent = dent;
    const grp = new THREE.Group();
    grp.add(mesh);
    this.v.ext.group.add(grp);
    grp.traverse((o) => { if (o.isMesh) this.v.extMeshes.push(o); });
    this.petals.push({ grp, dent });
  }

  /** the inner armour gave way at the worst crater: the cabin air streams out of it */
  vent(on, rate = 1) {
    const v = this.v;
    if (!v.fx) return;
    if (on && !this.vents.length) {
      const worst = this.dents.reduce((a, b) => (!a || b.E > a.E ? b : a), null);
      const dir = worst ? worst.dir : V(0.3, -0.2, 0.93).normalize();
      const e = v.fx.emitter('ice', dir.clone().multiplyScalar(H8.R + 0.05), dir, 60 * rate, { speed: 9, spread: 0.25 });
      const e2 = v.fx.emitter('mist', dir.clone().multiplyScalar(H8.R + 0.05), dir, 25 * rate, { speed: 4, spread: 0.4 });
      this.vents.push(e, e2);
    } else if (!on && this.vents.length) {
      for (const e of this.vents) v.fx.removeEmitter(e);
      this.vents.length = 0;
    } else if (on) for (const e of this.vents) e.rate = (e.kind === 'ice' ? 60 : 25) * rate;
  }

  update(dt) {
    let any = false;
    for (const d of this.dents) if (d.heat > 0.001) { d.heat *= Math.exp(-dt / 7); if (d.heat < 0.002) d.heat = 0; any = true; }
    if (any) this.sync();
  }

  sync() {
    const n = this.dents.length;
    DENT_U.uDentN.value = n;
    this.dents.forEach((d, i) => {
      DENT_U.uDentA.value[i].set(d.dir.x, d.dir.y, d.dir.z, d.a);
      DENT_U.uDentB.value[i].set(d.depth, d.lip, d.heat, d.hole);
      DENT_U.uDentC.value[i].set(d.soot, d.seed, 0, 0);
    });
    this.v.display && this.v.display.setCameras(this.cams, !!this.restoring);
  }

  /** the repair dock makes it all good again */
  repairAll() {
    if (this.v.display) this.v.display.repairPanels();
    this.dents.length = 0;
    this.pocks.clear();
    this.cams = [1, 1, 1, 1];
    for (const p of this.petals) {
      this.v.ext.group.remove(p.grp);
      p.grp.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); const i = this.v.extMeshes.indexOf(o); if (i >= 0) this.v.extMeshes.splice(i, 1); } });
    }
    this.petals.length = 0;
    this.vent(false);
    this.sync();
  }

  /** worst damage near a direction (for HACHI's reports): 0..1 */
  get worst() { return this.dents.reduce((m, d) => Math.max(m, d.depth / 0.24), 0); }

  serialize() {
    return { d: this.dents.map((d) => [d.dir.x, d.dir.y, d.dir.z, d.a, d.depth, d.hole, d.soot, d.seed, d.E].map((x) => +x.toFixed(5))), cams: this.cams.slice(), p: this.pocks.serialize(160) };
  }

  restore(s) {
    if (!s) return;
    this.repairAll();
    for (const r of s.d || []) {
      const d = { dir: V(r[0], r[1], r[2]).normalize(), a: r[3], depth: r[4], lip: r[4] * 0.22, heat: 0, hole: r[5], soot: r[6], seed: r[7], E: r[8] };
      this.dents.push(d);
      if (d.hole) this.addPetals(d);
    }
    if (s.cams) this.cams = s.cams.slice(0, 4);
    this.pocks.restore(s.p);
    this.restoring = true;
    this.sync();
    this.restoring = false;
  }
}
