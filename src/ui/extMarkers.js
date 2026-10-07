// Watching through an external camera: where every vessel is. A bracket on each ship in view
// (B-29, H8, the drones, the stations, H8's shelter adrift) with its name and its distance from
// the ship Kaito is aboard; those out of the picture get an arrow at the edge of the screen
// pointing the way to them.
import * as THREE from 'three';

const _v4 = new THREE.Vector4(), _m = new THREE.Matrix4(), _vp = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1);
const FONT = '"Hiragino Sans","Noto Sans JP",sans-serif';

function fmtDist(m) {
  if (m >= 1e6) return (m / 1000).toFixed(0) + ' km';
  if (m >= 9500) return (m / 1000).toFixed(1) + ' km';
  return Math.round(m) + ' m';
}

export class ExtMarkers {
  constructor(game) {
    this.g = game;
    this.cv = document.getElementById('hud-ext');
    this.ctx = this.cv ? this.cv.getContext('2d') : null;
    this.on = false;
  }

  /** the vessels to mark: { name, pos (ECI), color, R (m), self } */
  vessels() {
    const g = this.g, out = [];
    const h = g.h8;
    const soloH8 = !!(h && h.solo);
    out.push({ name: 'B-29', pos: g.flight.pos, color: '#ffc46a', R: 16, self: !soloH8 });
    if (h && h.mode !== 'docked' && h.mode !== 'lost') out.push({ name: h.mode === 'pod' ? 'H8 シェルター' : 'H8', pos: h.flight.pos, color: '#ffb347', R: h.mode === 'pod' ? 1.5 : 4, self: soloH8 });
    if (g.drones) for (const d of g.drones.list) if (d.alive) out.push({ name: '無人機 ' + d.id, pos: d.pos, color: '#ff6a50', R: 1.3, hostile: true });
    for (const s of g.stations.list) {
      const st = s.dmg ? s.dmg.status : 'ok';
      out.push({ name: s.name.replace('（修理基地）', '') + (st === 'destroyed' ? '（残骸）' : ''), pos: s.pos, color: st === 'ok' ? '#8fe0ff' : '#ff8a6a', R: (s.model && s.model.userData.radius) || 150, station: true });
    }
    return out;
  }

  update() {
    const g = this.g, cv = this.cv, ctx = this.ctx;
    if (!cv || !ctx) return;
    const show = g.mode === 'camera' && g.running;
    if (!show) { if (this.on) { ctx.clearRect(0, 0, cv.width, cv.height); cv.style.display = 'none'; this.on = false; } return; }
    if (!this.on) { cv.style.display = 'block'; this.on = true; }
    const W = cv.clientWidth, H = cv.clientHeight, pr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * pr) || cv.height !== Math.round(H * pr)) { cv.width = Math.round(W * pr); cv.height = Math.round(H * pr); }
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cam = g.engine.camera, origin = g.origin;
    _vp.multiplyMatrices(cam.projectionMatrix, _m.compose(g.camWorld, g.camQuat, _one).invert());
    const ref = g.playerVessel ? g.playerVessel().pos : g.flight.pos;
    const fovY = cam.fov * Math.PI / 180;
    ctx.textAlign = 'center';
    ctx.lineWidth = 1.6;
    for (const o of this.vessels()) {
      const dist = o.pos.distanceTo(ref);
      if (!o.self && dist > 4.0e6) continue;
      _v4.set(o.pos.x - origin.x, o.pos.y - origin.y, o.pos.z - origin.z, 1).applyMatrix4(_vp);
      const dCam = Math.hypot(o.pos.x - origin.x - g.camWorld.x, o.pos.y - origin.y - g.camWorld.y, o.pos.z - origin.z - g.camWorld.z);
      const label = o.self ? o.name : `${o.name}  ${fmtDist(dist)}`;
      ctx.strokeStyle = o.color; ctx.fillStyle = o.color;
      if (_v4.w > 0) {
        const x = (_v4.x / _v4.w * 0.5 + 0.5) * W, y = (1 - (_v4.y / _v4.w * 0.5 + 0.5)) * H;
        if (x > 8 && x < W - 8 && y > 8 && y < H - 8) {
          // a bracket sized to the vessel as seen (never smaller than a finger's width)
          const r = Math.max(13, Math.min(H * 0.45, o.R / Math.max(1, dCam) / Math.tan(fovY / 2) * H * 0.5 * 1.15));
          const c = Math.min(10, r * 0.45);
          for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            ctx.beginPath(); ctx.moveTo(x + sx * r, y + sy * (r - c)); ctx.lineTo(x + sx * r, y + sy * r); ctx.lineTo(x + sx * (r - c), y + sy * r); ctx.stroke();
          }
          if (o.hostile) { ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill(); }
          ctx.font = `600 13px ${FONT}`;
          ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 4;
          ctx.fillText(label, x, Math.min(H - 6, y + r + 15));
          ctx.shadowBlur = 0;
          continue;
        }
      }
      if (o.self) continue;
      // out of the picture: an arrow at the edge, pointing the way
      let ax = _v4.x / Math.abs(_v4.w || 1e-6), ay = _v4.y / Math.abs(_v4.w || 1e-6);
      if (_v4.w < 0) { ax = -ax; ay = -ay; }
      const a = Math.atan2(-ay, ax);
      const m = 34;
      const k = Math.min((W / 2 - m) / Math.max(1e-6, Math.abs(Math.cos(a))), (H / 2 - m) / Math.max(1e-6, Math.abs(Math.sin(a))));
      const x = W / 2 + Math.cos(a) * k, y = H / 2 + Math.sin(a) * k;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 11, y + Math.sin(a) * 11);
      ctx.lineTo(x + Math.cos(a + 2.5) * 9, y + Math.sin(a + 2.5) * 9);
      ctx.lineTo(x + Math.cos(a - 2.5) * 9, y + Math.sin(a - 2.5) * 9);
      ctx.closePath(); ctx.fill();
      ctx.font = `600 11px ${FONT}`;
      ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 4;
      ctx.fillText(label, Math.max(60, Math.min(W - 60, x - Math.cos(a) * 26)), Math.max(14, Math.min(H - 8, y - Math.sin(a) * 18 + 4)));
      ctx.shadowBlur = 0;
    }
  }
}
