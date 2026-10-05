// Bullet strikes on a hull: a small dark pit with a ragged bright ring of bare metal round it and a
// splash of soot thrown out in streaks. Hundreds of them can pile up (one instanced mesh per
// vessel, oldest replaced first), each lying flat on the surface where the round struck, so a hull
// that has been under fire for a while is pocked all over — and thickly where the bursts walked
// across it. Kept in the save; gone after the repair dock.
import * as THREE from 'three';

let TEX = null;

/** four variants in a 2 x 2 atlas (each: soot splash, scuffed ring, pit) */
function pockTexture() {
  if (TEX) return TEX;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let v = 0; v < 4; v++) {
    const cx = (v % 2) * S + S / 2, cy = Math.floor(v / 2) * S + S / 2;
    // soot: streaks thrown out from the strike, then a soft dark halo
    for (let k = 0; k < 14; k++) {
      const a = rnd() * Math.PI * 2, len = S * (0.18 + rnd() * 0.3), w = 2 + rnd() * 5;
      const gr = g.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      gr.addColorStop(0, 'rgba(14,12,10,0.75)'); gr.addColorStop(1, 'rgba(14,12,10,0)');
      g.strokeStyle = gr; g.lineWidth = w; g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); g.stroke();
    }
    const halo = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.34);
    halo.addColorStop(0, 'rgba(10,9,8,0.85)'); halo.addColorStop(0.55, 'rgba(18,16,14,0.45)'); halo.addColorStop(1, 'rgba(20,18,16,0)');
    g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, S * 0.34, 0, Math.PI * 2); g.fill();
    // the ring of bare, scuffed metal thrown up round the pit (ragged)
    const rr = S * (0.1 + rnd() * 0.03);
    g.beginPath();
    for (let i = 0; i <= 28; i++) {
      const a = i / 28 * Math.PI * 2, r = rr * (1 + (rnd() - 0.5) * 0.45);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath();
    const ring = g.createRadialGradient(cx, cy, rr * 0.4, cx, cy, rr * 1.2);
    ring.addColorStop(0, 'rgba(70,68,66,1)'); ring.addColorStop(0.55, 'rgba(196,192,186,1)'); ring.addColorStop(0.85, 'rgba(120,116,110,0.95)'); ring.addColorStop(1, 'rgba(60,56,52,0.6)');
    g.fillStyle = ring; g.fill();
    // the pit: a dark crater with a jagged edge
    g.beginPath();
    const pr = rr * 0.55;
    for (let i = 0; i <= 18; i++) {
      const a = i / 18 * Math.PI * 2, r = pr * (1 + (rnd() - 0.5) * 0.6);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath();
    g.fillStyle = 'rgba(8,7,6,1)'; g.fill();
  }
  TEX = new THREE.CanvasTexture(c);
  TEX.colorSpace = THREE.SRGBColorSpace;
  TEX.anisotropy = 4;
  return TEX;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

export class Pockmarks {
  /** parent: the vessel's frame; max: how many are kept; layers: the layers they draw in */
  constructor(parent, max = 320, layers = [3]) {
    this.max = max;
    this.list = [];          // { p, n, s, rot, v }
    this.next = 0;
    const geo = new THREE.PlaneGeometry(1, 1);
    // each instance picks its quarter of the atlas through the uv offset in its colour slot
    const mat = new THREE.MeshStandardMaterial({
      map: pockTexture(), transparent: true, depthWrite: false, roughness: 0.62, metalness: 0.55,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aVar;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * 0.5 + aVar * 0.5;\n#endif');
    };
    mat.customProgramCacheKey = () => 'pockmarks';
    this.var = new Float32Array(max * 2);
    geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(this.var, 2));
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'pockmarks';
    this.mesh.layers.set(layers[0]);
    for (const l of layers.slice(1)) this.mesh.layers.enable(l);
    parent.add(this.mesh);
  }

  /** a strike at p (vessel frame) on a surface with outward normal n; s: size (m) */
  add(p, n, s, rot = Math.random() * Math.PI * 2, v = Math.floor(Math.random() * 4)) {
    const e = { p: p.clone(), n: n.clone().normalize(), s, rot, v };
    const i = this.next % this.max;
    this.list[i] = e;
    this.next++;
    this.write(i, e);
    this.mesh.count = Math.min(this.max, this.next);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.aVar.needsUpdate = true;
    return e;
  }

  write(i, e) {
    _q.setFromUnitVectors(Z, e.n).multiply(_q2.setFromAxisAngle(Z, e.rot));
    _p.copy(e.p).addScaledVector(e.n, 0.004);
    _m.compose(_p, _q, _s.set(e.s, e.s, e.s));
    this.mesh.setMatrixAt(i, _m);
    this.var[i * 2] = e.v % 2; this.var[i * 2 + 1] = Math.floor(e.v / 2);
  }

  /** how many strikes lie within r of p */
  countNear(p, r) {
    let n = 0;
    const r2 = r * r;
    for (const e of this.list) if (e && e.p.distanceToSquared(p) < r2) n++;
    return n;
  }

  clear() {
    this.list.length = 0;
    this.next = 0;
    this.mesh.count = 0;
  }

  serialize(keep = 220) {
    const out = [];
    const n = Math.min(this.list.length, keep);
    for (let k = 0; k < n; k++) {
      const e = this.list[((this.next - n + k) % this.max + this.max) % this.max];
      if (e) out.push([e.p.x, e.p.y, e.p.z, e.n.x, e.n.y, e.n.z, e.s, e.rot, e.v].map((x) => +x.toFixed(3)));
    }
    return out;
  }

  restore(a) {
    this.clear();
    for (const r of a || []) this.add(new THREE.Vector3(r[0], r[1], r[2]), new THREE.Vector3(r[3], r[4], r[5]), r[6], r[7], r[8]);
  }
}
