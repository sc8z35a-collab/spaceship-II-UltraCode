// Web worker: generates cube-sphere terrain patches with float64 precision.
import { TerrainFn, faceToDir, nodeSize, EARTH_R, GRID_N, boundaryLoop } from './terrainFn.js';
import { HiElev, zoomForLevel } from './hiresElevation.js';

let fn = null;
let hi = null;
let hiOn = true;

/** lat/lon box (radians) of a patch, padded a little so edge samples find their neighbours */
function nodeBox(face, level, nx, ny) {
  const span = 2 / Math.pow(2, level);
  const u0 = -1 + nx * span, v0 = -1 + ny * span;
  const t = [0, 0, 0];
  faceToDir(face, u0 + span / 2, v0 + span / 2, t);
  const lonC = Math.atan2(-t[2], t[0]);
  let la0 = 9, la1 = -9, dl0 = 9, dl1 = -9;
  for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) {
    faceToDir(face, u0 + span * i / 2, v0 + span * j / 2, t);
    const lat = Math.asin(Math.max(-1, Math.min(1, t[1])));
    let dl = Math.atan2(-t[2], t[0]) - lonC;
    if (dl > Math.PI) dl -= 2 * Math.PI; else if (dl < -Math.PI) dl += 2 * Math.PI;
    la0 = Math.min(la0, lat); la1 = Math.max(la1, lat); dl0 = Math.min(dl0, dl); dl1 = Math.max(dl1, dl);
  }
  const pl = (la1 - la0) * 0.06 + 2e-5, pn = (dl1 - dl0) * 0.06 + 2e-5;
  return [la0 - pl, la1 + pl, lonC + dl0 - pn, lonC + dl1 + pn];
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    fn = new TerrainFn(m.elev, m.water);
    hi = new HiElev();
    fn.hi = hi;
    self.postMessage({ type: 'ready' });
    return;
  }
  if (m.type === 'hires') { hiOn = !!m.on; return; }
  if (m.type === 'build') {
    // real elevation for this patch first (falls back to the global data when it cannot load)
    const z = hiOn ? zoomForLevel(m.level) : -1;
    if (z >= 0) {
      const [a, b, c, d] = nodeBox(m.face, m.level, m.x, m.y);
      try { await hi.ensure(z, a, b, c, d); } catch (err) { /* offline */ }
    }
    fn.hiZoom = z;
    const out = build(m.face, m.level, m.x, m.y);
    out.type = 'built';
    out.key = m.key;
    self.postMessage(out, [out.position.buffer, out.normal.buffer, out.dir.buffer, out.hw.buffer, out.morph.buffer]);
  }
};

function build(face, level, nx, ny) {
  const N = GRID_N;
  const span = 2 / Math.pow(2, level);
  const u0 = -1 + nx * span, v0 = -1 + ny * span;
  const step = span / N;
  const G = N + 3; // with 1-cell border
  const P = new Float64Array(G * G * 3);
  const D = new Float64Array(G * G * 3);
  const H = new Float32Array(G * G);
  const W = new Uint8Array(G * G);
  const tmp = [0, 0, 0];
  const wout = [0];
  const size = nodeSize(level);
  const spacing = size / N;
  const skirt = Math.max(spacing * 0.6, 3);
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const u = u0 + (i - 1) * step, v = v0 + (j - 1) * step;
      faceToDir(face, Math.max(-1, Math.min(1, u)), Math.max(-1, Math.min(1, v)), tmp);
      const idx = j * G + i;
      const h = fn.height(tmp[0], tmp[1], tmp[2], 3, wout);
      const r = EARTH_R + h;
      D[idx * 3] = tmp[0]; D[idx * 3 + 1] = tmp[1]; D[idx * 3 + 2] = tmp[2];
      P[idx * 3] = tmp[0] * r; P[idx * 3 + 1] = tmp[1] * r; P[idx * 3 + 2] = tmp[2] * r;
      H[idx] = h; W[idx] = wout[0];
    }
  }
  // centre
  faceToDir(face, u0 + span / 2, v0 + span / 2, tmp);
  const cx = tmp[0] * EARTH_R, cy = tmp[1] * EARTH_R, cz = tmp[2] * EARTH_R;
  const NV = (N + 1) * (N + 1);
  const NS = 4 * N;
  const total = NV + NS;
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const dir = new Float32Array(total * 3);
  const hw = new Float32Array(total * 2);
  const morph = new Float32Array(total * 3);
  let minH = 1e9, maxH = -1e9;
  let bx = 0, by = 0, bz = 0;
  const gi = (i, j) => ((j + 1) * G + (i + 1)) * 3;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const o = (j * (N + 1) + i);
      const p = gi(i, j);
      position[o * 3] = P[p] - cx; position[o * 3 + 1] = P[p + 1] - cy; position[o * 3 + 2] = P[p + 2] - cz;
      bx += position[o * 3]; by += position[o * 3 + 1]; bz += position[o * 3 + 2];
      dir[o * 3] = D[p]; dir[o * 3 + 1] = D[p + 1]; dir[o * 3 + 2] = D[p + 2];
      const hi = (j + 1) * G + (i + 1);
      hw[o * 2] = H[hi]; hw[o * 2 + 1] = W[hi];
      if (H[hi] < minH) minH = H[hi];
      if (H[hi] > maxH) maxH = H[hi];
      // normal from central differences (dP/du x dP/dv)
      const pl = gi(i - 1, j), pr = gi(i + 1, j), pd = gi(i, j - 1), pu = gi(i, j + 1);
      const ax = P[pr] - P[pl], ay = P[pr + 1] - P[pl + 1], az = P[pr + 2] - P[pl + 2];
      const vx = P[pu] - P[pd], vy = P[pu + 1] - P[pd + 1], vz = P[pu + 2] - P[pd + 2];
      let nx_ = ay * vz - az * vy, ny_ = az * vx - ax * vz, nz_ = ax * vy - ay * vx;
      const nl = Math.hypot(nx_, ny_, nz_) || 1;
      normal[o * 3] = nx_ / nl; normal[o * 3 + 1] = ny_ / nl; normal[o * 3 + 2] = nz_ / nl;
      // morph target (coarse parent representation)
      let mx = 0, my = 0, mz = 0;
      const oddI = i & 1, oddJ = j & 1;
      if (oddI || oddJ) {
        let a, b;
        if (oddI && !oddJ) { a = gi(i - 1, j); b = gi(i + 1, j); }
        else if (!oddI && oddJ) { a = gi(i, j - 1); b = gi(i, j + 1); }
        else { a = gi(i - 1, j - 1); b = gi(i + 1, j + 1); }
        mx = (P[a] + P[b]) * 0.5 - P[p];
        my = (P[a + 1] + P[b + 1]) * 0.5 - P[p + 1];
        mz = (P[a + 2] + P[b + 2]) * 0.5 - P[p + 2];
      }
      morph[o * 3] = mx; morph[o * 3 + 1] = my; morph[o * 3 + 2] = mz;
    }
  }
  bx /= NV; by /= NV; bz /= NV;
  let rad = 0;
  for (let o = 0; o < NV; o++) {
    const dx = position[o * 3] - bx, dy = position[o * 3 + 1] - by, dz = position[o * 3 + 2] - bz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > rad) rad = d;
  }
  rad = Math.sqrt(rad) + skirt;
  // skirts (boundary loop, CCW seen from outside)
  const loop = boundaryLoop(N);
  for (let k = 0; k < NS; k++) {
    const g = loop[k];
    const o = NV + k;
    const px = position[g * 3] + cx, py = position[g * 3 + 1] + cy, pz = position[g * 3 + 2] + cz;
    const l = Math.hypot(px, py, pz);
    const f = (l - skirt) / l;
    position[o * 3] = px * f - cx; position[o * 3 + 1] = py * f - cy; position[o * 3 + 2] = pz * f - cz;
    normal[o * 3] = normal[g * 3]; normal[o * 3 + 1] = normal[g * 3 + 1]; normal[o * 3 + 2] = normal[g * 3 + 2];
    dir[o * 3] = dir[g * 3]; dir[o * 3 + 1] = dir[g * 3 + 1]; dir[o * 3 + 2] = dir[g * 3 + 2];
    hw[o * 2] = hw[g * 2]; hw[o * 2 + 1] = hw[g * 2 + 1];
    morph[o * 3] = morph[g * 3]; morph[o * 3 + 1] = morph[g * 3 + 1]; morph[o * 3 + 2] = morph[g * 3 + 2];
  }
  return {
    position, normal, dir, hw, morph,
    center: [cx, cy, cz], bcenter: [bx, by, bz], bradius: rad, minH, maxH,
  };
}
