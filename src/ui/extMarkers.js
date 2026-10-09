// Watching through an external camera: a camera's viewfinder over the picture — its frame and
// middle, REC and which camera it is, the time code and the exposure, its sensor's temperature
// (an engine's flame near it heats it: the picture tears, then the signal is lost until it cools),
// the strip of the ship's cameras along the top (a tap picks one) — and where every vessel is: a
// bracket on each ship in view (B-29, H8, the drones, the stations, H8's shelter adrift) with its
// name and its distance from the ship Kaito is aboard; those out of the picture get an arrow at the
// edge of the screen pointing the way to them.
import * as THREE from 'three';

const _v4 = new THREE.Vector4(), _m = new THREE.Matrix4(), _vp = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1);
const FONT = '"Hiragino Sans","Noto Sans JP",sans-serif';
const MONO = '"SF Mono","Menlo","Consolas",monospace';
// the cameras' names (and short ones for the strip)
const CAM_JP = {
  chase: ['追尾カメラ', '追尾'], nose: ['機首カメラ', '機首'], belly: ['腹部カメラ', '腹部'], radiator: ['右舷ラジエーター', '右舷'], mast: ['後方監視マスト', 'マスト'],
  h8chase: ['H8 追尾カメラ', '追尾'], h8cam2: ['H8 CAM-2 前方', 'CAM-2'], h8top: ['H8 天頂カメラ', '天頂'], h8side: ['H8 側方カメラ', '側方'],
};

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
    this.chips = [];
  }

  /** the cameras of the ship the view is from (their names, in order) */
  camList() {
    const g = this.g, src = g.h8 && g.h8.solo ? g.h8 : g.systems;
    if (this._src === src && this._cams) return this._cams;
    const names = [];
    for (let i = 0; i < 16; i++) { const n = src.externalCamera(i).name; if (i > 0 && n === names[0]) break; names.push(n); }
    this._src = src; this._cams = names;
    return names;
  }

  /** a tap on the strip of cameras: which one (or -1) */
  stripAt(tap) {
    if (!this.on || tap.px === undefined) return -1;
    for (const c of this.chips) if (tap.px >= c.x0 && tap.px <= c.x1 && tap.py >= c.y0 && tap.py <= c.y1) return c.i;
    return -1;
  }

  /** the viewfinder (under the vessels' marks) */
  viewfinder(ctx, W, H) {
    const g = this.g, t = performance.now() / 1000, vh = H / 100;
    const names = this.camList(), n = names.length;
    const idx = ((g.extCam % n) + n) % n;
    const solo = !!(g.h8 && g.h8.solo);
    const heat = g.plumeHeat ? g.plumeHeat.cam : 0;
    const lost = heat > 1.05;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 3;
    // the frame's corners and its middle
    ctx.strokeStyle = 'rgba(235,242,255,0.5)'; ctx.lineWidth = 1.3;
    const m = 1.1 * vh, L = 4.5 * vh;
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) { ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke(); }
    const cx = W / 2, cy = H / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 11, cy); ctx.lineTo(cx - 4, cy); ctx.moveTo(cx + 4, cy); ctx.lineTo(cx + 11, cy);
    ctx.moveTo(cx, cy - 11); ctx.lineTo(cx, cy - 4); ctx.moveTo(cx, cy + 4); ctx.lineTo(cx, cy + 11);
    ctx.stroke();
    // top left, under the buttons: REC, which camera, how far it is zoomed, its sensor
    const x0 = 1.8 * vh;
    let y = 10.4 * vh;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (!lost && (t % 1) < 0.6) { ctx.fillStyle = 'rgba(255,70,60,0.95)'; ctx.beginPath(); ctx.arc(x0 + 5, y, 4.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.font = `700 12px ${MONO}`; ctx.fillStyle = lost ? 'rgba(255,110,90,0.95)' : 'rgba(240,245,255,0.95)';
    ctx.fillText(lost ? 'NO SIGNAL' : 'REC', x0 + 15, y);
    ctx.fillText(`CAM ${idx + 1}/${n}`, x0 + 15 + (lost ? 82 : 40), y);
    y += 2.9 * vh;
    const jp = CAM_JP[names[idx]] ? CAM_JP[names[idx]][0] : names[idx];
    ctx.font = `600 13px ${FONT}`; ctx.fillStyle = 'rgba(235,242,255,0.95)';
    ctx.fillText(`${jp} — ${solo ? 'H8' : 'B-29'}`, x0, y);
    y += 2.6 * vh;
    const Lk = g.extLook || {};
    const z = Lk.sz || 1;
    const cam = solo ? g.h8.externalCamera(idx) : g.systems.externalCamera(idx);
    ctx.font = `500 11px ${MONO}`; ctx.fillStyle = 'rgba(210,225,245,0.85)';
    ctx.fillText(cam.orbit ? `距離 ×${z.toFixed(2)}  パン ${Math.round((Lk.sy || 0) * 57.3)}°` : `パン ${Math.round((Lk.sy || 0) * 57.3)}°  チルト ${Math.round(-(Lk.sp || 0) * 57.3)}°`, x0, y);
    y += 2.6 * vh;
    // (the sensor: room temperature, up to ~125 °C where it gives out)
    const T = 22 + Math.min(2.2, heat) * 95;
    const hc = heat > 1.05 ? 'rgba(255,90,70,0.98)' : heat > 0.5 ? 'rgba(255,190,90,0.97)' : 'rgba(160,230,190,0.9)';
    ctx.fillStyle = hc; ctx.font = `600 11px ${FONT}`;
    ctx.fillText(`センサー ${Math.round(T)}°C`, x0, y);
    const bx = x0 + 86, bw = 70;
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(bx, y - 2.5, bw, 5);
    ctx.fillStyle = hc; ctx.fillRect(bx, y - 2.5, bw * Math.min(1, heat / 1.05), 5);
    // top right, under the buttons: the time code, the exposure
    const d = new Date(g.time);
    const ff = Math.floor((g.time % 1000) / 1000 * 30);
    const tc = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
    ctx.textAlign = 'right';
    ctx.font = `700 13px ${MONO}`; ctx.fillStyle = 'rgba(240,245,255,0.95)';
    ctx.fillText(`${tc} UTC`, W - 1.8 * vh, 10.4 * vh);
    const sc = g.space && g.space.sunColor;
    const lit = sc ? Math.min(1, (sc.r + sc.g + sc.b) / 3) : 1;
    const ev = 8 + 7 * lit;
    const N = 8, sh = (N * N) / Math.pow(2, ev - 2);
    ctx.font = `500 11px ${MONO}`; ctx.fillStyle = 'rgba(210,225,245,0.85)';
    ctx.fillText(`${sh >= 1 ? sh.toFixed(1) + '"' : '1/' + Math.round(1 / Math.max(1e-5, sh))}  F${N.toFixed(1)}  ISO ${lit > 0.3 ? 100 : 1600}`, W - 1.8 * vh, 13.2 * vh);
    // along the top: the ship's cameras (a tap picks one)
    const cw = 9.5 * vh, ch = 3.6 * vh, gap = 0.8 * vh;
    let cx0 = W / 2 - (n * cw + (n - 1) * gap) / 2;
    const cy0 = 5.2 * vh;
    this.chips.length = 0;
    ctx.textAlign = 'center';
    ctx.shadowBlur = 0;
    for (let i = 0; i < n; i++) {
      const on = i === idx;
      ctx.fillStyle = on ? 'rgba(120,190,255,0.45)' : 'rgba(8,14,26,0.5)';
      ctx.strokeStyle = on ? 'rgba(170,220,255,0.95)' : 'rgba(170,200,240,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(cx0, cy0, cw, ch, ch / 2); else ctx.rect(cx0, cy0, cw, ch); ctx.fill(); ctx.stroke();
      ctx.font = `${on ? 700 : 500} 11px ${FONT}`; ctx.fillStyle = on ? 'rgba(255,255,255,0.98)' : 'rgba(215,228,248,0.8)';
      ctx.fillText(`${i + 1} ${CAM_JP[names[i]] ? CAM_JP[names[i]][1] : names[i]}`, cx0 + cw / 2, cy0 + ch / 2);
      this.chips.push({ i, x0: cx0 - 3, y0: cy0 - 6, x1: cx0 + cw + 3, y1: cy0 + ch + 6 });
      cx0 += cw + gap;
    }
    ctx.restore();
  }

  /** the vessels to mark: { name, pos (ECI), color, R (m), self } */
  vessels() {
    const g = this.g, out = [];
    const h = g.h8;
    const soloH8 = !!(h && h.solo);
    out.push({ name: 'B-29', pos: g.flight.pos, color: '#ffc46a', R: 16, self: !soloH8 });
    if (h && h.mode !== 'docked' && h.mode !== 'lost') out.push({ name: h.mode === 'pod' ? 'H8 シェルター' : 'H8', pos: h.flight.pos, color: '#ffb347', R: h.mode === 'pod' ? 1.5 : 4, self: soloH8 });
    if (g.drones) for (const d of g.drones.list) if (d.alive) out.push({ name: `無人機 ${d.id} ${'★'.repeat(d.stars || 1)}`, pos: d.pos, color: '#ff6a50', R: 1.3, hostile: true });
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
    this.viewfinder(ctx, W, H);
    const cam = g.engine.camera, origin = g.origin;
    _vp.multiplyMatrices(cam.projectionMatrix, _m.compose(g.camWorld, g.viewQuat || g.camQuat, _one).invert());
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
    // the camera too hot (an engine's flame on it): its warning, then its lost signal
    const hk = g.plumeHeat ? g.plumeHeat.cam : 0;
    if (hk > 0.25) {
      const lost = hk > 1.05, t = performance.now() / 1000;
      if (!lost || (t % 1) < 0.65) {
        ctx.font = `700 ${lost ? 18 : 14}px ${FONT}`;
        ctx.fillStyle = lost ? 'rgba(255,90,70,0.98)' : 'rgba(255,196,110,0.97)';
        ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 5;
        ctx.fillText(lost ? '信号喪失 — カメラ過熱・冷却中' : `高温 ${Math.round(Math.min(1, hk) * 100)}% — 映像が乱れています`, W / 2, lost ? H / 2 + 34 : 12.5 * H / 100);
        ctx.shadowBlur = 0;
      }
    }
  }
}
