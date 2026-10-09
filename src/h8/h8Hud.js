// What H8's display draws over the outside view (on a canvas over the picture, laid exactly where
// each thing is seen — magnified with it when the view is zoomed):
//   - the focus frame in the middle of the view: whatever Kaito keeps inside it for a moment is
//     locked and becomes the focus (a camera's AF area: the brackets close in as it acquires);
//   - the locks: a box round the WHOLE of each locked vessel (every corner of its hull, as seen
//     now), the focus with its card — name, range, closing speed, hull damage, the fire control's
//     odds of a hit — and the point the guns are to aim at, which Kaito sets anywhere inside the
//     box with a tap (it stays on that spot of the vessel as it turns and moves);
//   - small markers on everything else it tracks, the orbit directions, arrows at the edge toward
//     locks out of view.
// A tap in a lock's box focuses it (and sets the aim point there), a double tap sends H8 there, a
// long press releases the lock. Nothing is drawn where the display is dead (its camera gone, a
// broken panel) or under a tab.
import * as THREE from 'three';
import { fmtDist } from './h8Display.js';
import { STATUS_JP } from '../world/worldDamage.js';
import { HACK_FOCUS, HACK_RANGE, HACK_STAGES, HACK_TIME } from '../world/escapePods.js';

const FONT = '"Hiragino Sans","Noto Sans JP",sans-serif';
const MONO = '"SF Mono","Menlo","Consolas",monospace';
const C = { cyan: 'rgba(130,232,255,0.95)', dim: 'rgba(150,215,245,0.62)', red: 'rgba(255,92,64,0.98)', amber: 'rgba(255,190,90,0.97)', green: 'rgba(120,255,170,0.95)', white: 'rgba(225,242,255,0.96)', card: 'rgba(4,12,22,0.72)' };
const DWELL = 0.45;            // s inside the focus frame to lock it
const LOCK_MAX = 8;
const DOUBLE = 380;            // ms between the two taps of a double tap
const HOLD = 650;              // ms: a long press on a lock releases it
const R_MOON = 1737400;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _aim = new THREE.Vector3(), _fwd = new THREE.Vector3(), _v4 = new THREE.Vector4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _vp = new THREE.Matrix4(), _vpUi = new THREE.Matrix4(), _view = new THREE.Matrix4(), _proj = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);

/** the box round everything in an object (its own frame) */
export function localBox(root) {
  const box = new THREE.Box3(), tmp = new THREE.Box3();
  const walk = (o, M) => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(M);
      if (Number.isFinite(tmp.min.x)) box.union(tmp);
    }
    for (const ch of o.children) {
      if (ch.matrixAutoUpdate) ch.updateMatrix();
      walk(ch, new THREE.Matrix4().multiplyMatrices(M, ch.matrix));
    }
  };
  walk(root, new THREE.Matrix4());
  return box.isEmpty() ? null : box;
}

export class H8Hud {
  constructor(vessel) {
    this.v = vessel;
    this.g = vessel.g;
    this.cv = document.getElementById('hud-h8');
    this.ctx = this.cv ? this.cv.getContext('2d') : null;
    this.on = false;
    this.locks = [];            // { id, c, t, aim (target-local point, or null), pulse }
    this.primaryId = null;
    this.dwell = { id: null, t: 0 };
    this.dwellK = 0;            // the acquisition as drawn (eased)
    this.pulse = 0;             // the frame's flash when something locks
    this.boxes = [];            // this frame's lock boxes on the screen (for taps)
    this.lastTap = null;
    this.held = new Set();
    this.W = 1; this.H = 1;
  }

  // ------------------------------------------------------------------ locks
  isLocked(id) { return this.locks.some((l) => l.id === id); }

  /** the focused lock, or null */
  primary() { return this.locks.find((l) => l.id === this.primaryId) || null; }

  lock(c, focus) {
    if (!this.isLocked(c.id)) {
      if (this.locks.length >= LOCK_MAX) {
        // room for it: the oldest lock that is neither a threat nor the focus
        const i = this.locks.findIndex((l) => !l.c.threat && l.id !== this.primaryId);
        if (i < 0) return false;
        this.locks.splice(i, 1);
      }
      this.locks.push({ id: c.id, c, t: 0, aim: null, pulse: 1 });
      this.v.onLock && this.v.onLock(c);
    }
    if (focus) this.setPrimary(c.id);
    this.pulse = 1;
    return true;
  }

  setPrimary(id) {
    const l = this.locks.find((x) => x.id === id);
    if (!l) return;
    if (this.primaryId !== id) { this.primaryId = id; l.pulse = 1; }
  }

  unlock(id) {
    this.locks = this.locks.filter((l) => l.id !== id);
    if (this.primaryId === id) {
      const next = this.locks.slice().sort((a, b) => (b.c.threat ? 1 : 0) - (a.c.threat ? 1 : 0) || a.c.dist - b.c.dist)[0];
      this.primaryId = next ? next.id : null;
    }
    const A = this.g.audio;
    A.beep && A.beep(700, 0.06, 0.04, { direct: true });
  }

  clear() { this.locks.length = 0; this.primaryId = null; this.dwell.id = null; this.dwell.t = 0; }

  /** the point a lock's guns aim at (ECI): its middle, or the spot Kaito picked on it */
  aimPoint(l, out = new THREE.Vector3()) {
    out.copy(l.c.pos);
    if (l.aim) out.add(_v3.copy(l.aim).applyQuaternion(this.quatOf(l.c, _q2)));
    return out;
  }

  // ------------------------------------------------------------------ what things are
  /** an object's orientation (ECI) */
  quatOf(c, out) {
    const g = this.g;
    if (c.kind === 'station' && c.ref) return g.stations.frameOf(c.ref, out);
    if (c.kind === 'b29') return out.copy(g.flight.quat);
    if (c.kind === 'drone' && c.ref && c.ref.q) return out.copy(c.ref.q);
    if (c.kind === 'h8' && g.h8) return out.copy(g.h8.flight.quat);
    if (c.kind === 'pod' && c.ref) return out.copy(c.ref.q);
    return out.identity();
  }

  /** the box round the whole object (its own frame), or null for a plain sphere of c.R */
  boxOf(c) {
    const g = this.g;
    if (c.kind === 'station' && c.ref && c.ref.model) return c.ref._box !== undefined ? c.ref._box : (c.ref._box = localBox(c.ref.model));
    if (c.kind === 'b29') return this._b29Box !== undefined ? this._b29Box : (this._b29Box = localBox(g.shipVis.exterior));
    if (c.kind === 'drone' && g.drones && g.drones.templates) {
      if (this._droneBox === undefined) this._droneBox = localBox(g.drones.templates.lo);
      return this._droneBox;
    }
    if (c.kind === 'pod' && c.ref) {
      // (its hull: nose dome to the bell; a gun's turret on its back)
      const P = c.ref, k = P.grade + (P.armed ? 'A' : '');
      const B = this._podBox || (this._podBox = {});
      return B[k] || (B[k] = new THREE.Box3(new THREE.Vector3(-P.G.R, -P.G.R, -P.G.len / 2), new THREE.Vector3(P.G.R, P.G.R * (P.armed ? 1.35 : 1.02), P.G.len / 2 + P.G.R * 0.5)));
    }
    return null;
  }

  radiusOf(c) {
    if (c.R) return c.R;
    if (c.kind === 'body') return R_MOON;
    if (c.kind === 'rock' && c.ref) return c.ref.radius;
    const B = this.boxOf(c);
    return B ? B.getSize(_v2).length() / 2 : 5;
  }

  /** what the object's damage is: { k (0 sound .. 1 wrecked), text } or null */
  damageOf(c) {
    const g = this.g;
    if (c.kind === 'station' && c.ref && c.ref.dmg) {
      const D = c.ref.dmg;
      return { k: D.destroyed ? 1 : 1 - Math.max(0, D.health), text: D.destroyed ? '大破' : `損傷 ${Math.round((1 - Math.max(0, D.health)) * 100)}%  ${STATUS_JP[D.status] || ''}` };
    }
    if (c.kind === 'b29') {
      const integ = g.damage.integrityNow ?? g.damage.integrity();
      return { k: 1 - integ, text: `損傷 ${Math.round((1 - integ) * 100)}%` };
    }
    if (c.kind === 'drone' && c.ref) return { k: 1 - c.ref.hp, text: `損傷 ${Math.round((1 - c.ref.hp) * 100)}%${c.ref.state === 'evade' ? '  後退中' : ''}` };
    if (c.kind === 'pod' && c.ref) {
      const P = c.ref, k = 1 - Math.max(0, P.hp) / P.G.hp;
      return { k, text: `損傷 ${Math.round(k * 100)}%  最大 ${P.G.vMax} m/s` };
    }
    if (c.kind === 'rock' && c.ref) {
      const a = c.ref, hp0 = Math.pow(a.radius / 0.5, 3) * 0.6;
      const k = a.hp !== undefined ? 1 - Math.max(0, a.hp) / hp0 : 0;
      return { k, text: `直径 ${(a.radius * 2).toFixed(1)} m${k > 0.01 ? `  損壊 ${Math.round(k * 100)}%` : ''}` };
    }
    return null;
  }

  // ------------------------------------------------------------------ per frame
  /**
   * Once per drawn frame while Kaito is in the cockpit. cands: what the display tracks
   * ({ id, kind, name, short, pos, vel, dist, closing, threat, extra, ref }), orbit: { pro, retro,
   * zen, nad } (ECI unit vectors), up: draw it (seated or standing in the cockpit, display on),
   * live: locks can be made
   */
  frame(dt, cands, orbit, show, live) {
    const g = this.g, v = this.v, cv = this.cv, ctx = this.ctx;
    this.lastCands = cands;
    // ---- the locks follow what is still tracked
    const byId = new Map(cands.map((c) => [c.id, c]));
    this.locks = this.locks.filter((l) => { const c = byId.get(l.id); if (!c) return false; l.c = c; return true; });
    for (const c of cands) c.locked = false;
    for (const l of this.locks) { l.c.locked = true; l.t += dt; l.pulse = Math.max(0, l.pulse - dt * 2.5); }
    if (this.primaryId && !this.isLocked(this.primaryId)) this.primaryId = null;
    if (live) for (const c of cands) if (c.threat && !c.locked) { this.lock(c, false); c.locked = true; }
    if (!this.primaryId && this.locks.length) {
      const t = this.locks.filter((l) => l.c.threat).sort((a, b) => a.c.dist - b.c.dist)[0];
      if (t) this.primaryId = t.id;
    }
    this.pulse = Math.max(0, this.pulse - dt * 3);
    // how long the focus has been the focus, watched (an escape pod can be broken into after a while)
    if (this.primaryId !== this._primId) { this._primId = this.primaryId; this.primT = 0; }
    else if (show) this.primT = (this.primT || 0) + dt;
    this.hackBtn = null; this.hackAbort = null;
    if (!cv || !ctx) return;
    if (!show) {
      if (this.on) { ctx.clearRect(0, 0, cv.width, cv.height); cv.style.display = 'none'; this.on = false; }
      this.boxes.length = 0;
      this.outl = null;
      this.dwell.id = null; this.dwell.t = 0;
      return;
    }
    if (!this.on) { cv.style.display = 'block'; this.on = true; }
    const W = cv.clientWidth, H = cv.clientHeight, pr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * pr) || cv.height !== Math.round(H * pr)) { cv.width = Math.round(W * pr); cv.height = Math.round(H * pr); }
    this.W = W; this.H = H;
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // ---- this frame's view: the magnified one (the outside) and the plain one (the tabs)
    const cam = g.engine.camera, origin = g.origin;
    // (the outside through the cameras' gimbal; the tabs on the glass with the head)
    _view.compose(g.camWorld, g.viewQuat || g.camQuat, ONE).invert();
    _vp.multiplyMatrices(cam.projectionMatrix, _view);
    _vpUi.multiplyMatrices(g.engine.uiProjection(_proj), _m.compose(g.camWorld, g.camQuat, ONE).invert());
    const tanH = Math.tan(cam.fov * Math.PI / 360);
    const rootInv = _m.copy(v.root.matrixWorld).invert();
    const eyeL = _v2.copy(g.camWorld).applyMatrix4(rootInv).clone();
    const D = v.display;
    const proj = (p, out) => {
      _v4.set(p.x - origin.x, p.y - origin.y, p.z - origin.z, 1).applyMatrix4(_vp);
      out.w = _v4.w;
      if (_v4.w <= 1e-6) { out.x = _v4.x; out.y = _v4.y; out.ok = false; return out; }
      out.x = (_v4.x / _v4.w * 0.5 + 0.5) * W; out.y = (0.5 - _v4.y / _v4.w * 0.5) * H; out.ok = true;
      return out;
    };
    // where on the display a thing is seen: dead there, or under a tab?
    const dirL = new THREE.Vector3();
    const hidden = v.hudCam ? () => null : (p) => {
      dirL.set(p.x - origin.x, p.y - origin.y, p.z - origin.z).applyMatrix4(rootInv).sub(eyeL).normalize();
      const P = _v.copy(eyeL).addScaledVector(dirL, D.surface(eyeL, dirL));
      if (D.deadAt(dirL, P)) return 'dead';
      if (v.tabs.coverAt(eyeL, dirL)) return 'tab';
      return null;
    };
    // ---- everything is drawn round the tabs (they lie on the glass over the picture)
    ctx.save();
    const outl = this.outl = v.tabs.outlines(v.root.matrixWorld, _vpUi, W, H);
    H8Hud.clipOut(ctx, outl, W, H);
    // ---- the focus frame (an AF area in the middle of the view)
    const cx = W / 2, cy = H / 2, S = Math.min(W, H);
    const fw = S * 0.46, fh = S * 0.34;
    const fx0 = cx - fw / 2, fy0 = cy - fh / 2, fx1 = cx + fw / 2, fy1 = cy + fh / 2;
    // what lies in it (its middle inside the frame), nearest the middle first
    let best = null, bestD = Infinity;
    const sp = {};
    if (live) {
      for (const c of cands) {
        proj(c.pos, sp);
        if (!sp.ok || sp.x < fx0 || sp.x > fx1 || sp.y < fy0 || sp.y > fy1) continue;
        if (hidden(c.pos) === 'dead') continue;
        const d = Math.hypot(sp.x - cx, sp.y - cy);
        if (d < bestD) { bestD = d; best = c; }
      }
    }
    const isPrim = best && best.id === this.primaryId;
    // (while H8's computer is breaking into a pod the focus stays on it: nothing passing through the
    // frame takes it over)
    const hacking = !!(g.pods && g.pods.hack);
    if (best && !isPrim && !hacking) {
      if (this.dwell.id !== best.id) { this.dwell.id = best.id; this.dwell.t = 0; }
      this.dwell.t += dt;
      if (this.dwell.t >= DWELL) { this.lock(best, true); this.dwell.t = 0; this.dwell.id = null; }
    } else { this.dwell.id = null; this.dwell.t = 0; }
    const dk = this.dwell.id ? Math.min(1, this.dwell.t / DWELL) : 0;
    this.dwellK += (dk - this.dwellK) * Math.min(1, dt * (dk > this.dwellK ? 30 : 10));
    _fwd.set(0, 0, -1).applyQuaternion(g.viewQuat || g.camQuat).multiplyScalar(1e4).add(g.camWorld).add(origin);
    if (hidden(_fwd) !== 'dead') {
      this.drawFocusFrame(ctx, fx0, fy0, fx1, fy1, this.dwellK, this.pulse, best && this.dwell.id ? best : null);
    }
    // ---- orbit directions (small, dim)
    if (orbit) {
      for (const [k, dir] of Object.entries(orbit)) {
        if (!dir) continue;
        _v.copy(g.camWorld).add(origin).addScaledVector(dir, 1e7);
        proj(_v, sp);
        if (!sp.ok || sp.x < 0 || sp.x > W || sp.y < 0 || sp.y > H) continue;
        if (hidden(_v)) continue;
        this.drawOrbitMark(ctx, sp.x, sp.y, k);
      }
    }
    // ---- markers on the rest
    ctx.lineWidth = 1.4;
    let n = 0;
    const others = cands.filter((c) => !c.locked).sort((a, b) => a.dist - b.dist);
    for (const c of others) {
      if (n >= 28) break;
      proj(c.pos, sp);
      if (!sp.ok || sp.x < -20 || sp.x > W + 20 || sp.y < -20 || sp.y > H + 20) continue;
      if (hidden(c.pos)) continue;
      n++;
      const col = c.threat ? C.red : c.kind === 'b29' ? C.amber : c.kind === 'body' ? C.white : C.dim;
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(sp.x, sp.y - 6); ctx.lineTo(sp.x + 6, sp.y); ctx.lineTo(sp.x, sp.y + 6); ctx.lineTo(sp.x - 6, sp.y); ctx.closePath(); ctx.stroke();
      ctx.font = `500 11px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(c.short || c.name, sp.x + 10, sp.y);
    }
    // ---- the locks: a box round the whole of each
    this.boxes.length = 0;
    const W8 = g.weapons;
    for (const l of this.locks) {
      const c = l.c, prim = l.id === this.primaryId;
      const b = this.screenBox(c, proj, W, H, tanH);
      const col = c.threat ? C.red : c.kind === 'b29' ? C.amber : c.kind === 'body' ? C.white : C.cyan;
      if (!b || b.x1 < 0 || b.x0 > W || b.y1 < 0 || b.y0 > H) { this.drawEdgeArrow(ctx, c, proj, W, H, col, prim); continue; }
      const h = hidden(c.pos);
      if (h === 'dead') continue;
      this.boxes.push({ id: l.id, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, l });
      // acquisition: the box closes in from a little wider
      const e = Math.min(1, l.t / 0.3), k = 1 - Math.pow(1 - e, 3), grow = (1 - k) * 18 + l.pulse * 6;
      const x0 = b.x0 - grow, y0 = b.y0 - grow, x1 = b.x1 + grow, y1 = b.y1 + grow;
      ctx.strokeStyle = col; ctx.lineWidth = prim ? 2 : 1.4;
      ctx.globalAlpha = (h === 'tab' ? 0.35 : 1) * (0.35 + 0.65 * k);
      const cl = Math.min(16, (x1 - x0) * 0.3, (y1 - y0) * 0.3);
      for (const [sx, sy, X, Y] of [[1, 1, x0, y0], [-1, 1, x1, y0], [1, -1, x0, y1], [-1, -1, x1, y1]]) {
        ctx.beginPath(); ctx.moveTo(X, Y + sy * cl); ctx.lineTo(X, Y); ctx.lineTo(X + sx * cl, Y); ctx.stroke();
      }
      if (prim) {
        // the focus: the full frame, faint, and the corners strong
        ctx.globalAlpha *= 0.35; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.globalAlpha /= 0.35;
        // where the guns are to aim
        proj(this.aimPoint(l, _aim), sp);
        if (sp.ok) {
          ctx.lineWidth = 1.6; ctx.strokeStyle = l.aim ? C.amber : col;
          ctx.beginPath(); ctx.arc(sp.x, sp.y, 7, 0, Math.PI * 2);
          ctx.moveTo(sp.x - 12, sp.y); ctx.lineTo(sp.x - 4, sp.y); ctx.moveTo(sp.x + 4, sp.y); ctx.lineTo(sp.x + 12, sp.y);
          ctx.moveTo(sp.x, sp.y - 12); ctx.lineTo(sp.x, sp.y - 4); ctx.moveTo(sp.x, sp.y + 4); ctx.lineTo(sp.x, sp.y + 12);
          ctx.stroke();
        }
        this.drawCard(ctx, l, x0, y0, x1, y1, W, H, col, W8);
      } else {
        ctx.font = `600 11.5px ${FONT}`; ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(`${c.short || c.name}  ${fmtDist(c.dist)}`, x0, y1 + 4);
      }
      if (l.t < 0.8 && Math.floor(l.t * 8) % 2 === 0) { ctx.font = `700 11px ${MONO}`; ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('LOCK', x0, y0 - 3); }
      ctx.globalAlpha = 1;
    }
    // ---- breaking into an escape pod: H8's computer at work
    const P = g.pods;
    if (P && P.hack) this.drawHackPanel(ctx, P.hack, W, H);
    ctx.restore();
  }

  /** the intrusion's terminal (bottom right): the layers it works through, its chatter, the bar */
  drawHackPanel(ctx, Hk, W, H) {
    const t = performance.now() / 1000;
    const S = Math.min(W, H);
    const pw = Math.min(400, Math.max(300, W * 0.34)), ph = 236;
    const m = S * 0.05;
    const x = W - m - pw, y = Math.max(m + 60, H - m - 44 - ph);
    const green = 'rgba(120,255,170,0.96)', gdim = 'rgba(120,255,170,0.55)';
    ctx.save();
    ctx.fillStyle = 'rgba(2,10,6,0.82)'; ctx.strokeStyle = green; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.rect(x, y, pw, ph); ctx.fill(); ctx.stroke();
    ctx.fillStyle = green; ctx.fillRect(x, y, pw, 22);
    ctx.fillStyle = '#021006'; ctx.font = `700 12px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('HACHI 侵入端末', x + 8, y + 11);
    ctx.textAlign = 'right'; ctx.font = `700 11px ${MONO}`;
    ctx.fillText(`→ ${Hk.pod.label}`, x + pw - 8, y + 11);
    // the layers
    ctx.textAlign = 'left';
    const k = Math.min(1, Hk.t / Hk.dur);
    for (let i = 0; i < HACK_STAGES.length; i++) {
      const yy = y + 36 + i * 17;
      const done = i < Hk.stage, now = i === Hk.stage;
      ctx.font = `${now ? 700 : 500} 11.5px ${FONT}`;
      ctx.fillStyle = done ? green : now ? 'rgba(255,230,140,0.98)' : gdim;
      ctx.fillText(`${done ? '✔' : now ? (Math.floor(t * 6) % 2 ? '▶' : '▷') : '·'} ${String(i + 1).padStart(2, '0')} ${HACK_STAGES[i]}`, x + 10, yy);
      if (now) {
        const sk = Math.min(1, (k * HACK_STAGES.length) - i);
        const bx = x + pw - 120;
        ctx.fillStyle = 'rgba(120,255,170,0.15)'; ctx.fillRect(bx, yy - 3, 100, 6);
        ctx.fillStyle = 'rgba(255,230,140,0.95)'; ctx.fillRect(bx, yy - 3, 100 * sk, 6);
      }
    }
    // the chatter
    ctx.font = `500 10.5px ${MONO}`;
    const lines = Hk.lines.slice(-6);
    lines.forEach((s, i) => {
      ctx.fillStyle = s.startsWith('==') ? 'rgba(255,230,140,0.95)' : `rgba(120,255,170,${0.35 + 0.6 * (i + 1) / lines.length})`;
      ctx.fillText(`> ${s}`, x + 10, y + 112 + i * 14);
    });
    if (Math.floor(t * 3) % 2) { ctx.fillStyle = green; ctx.fillRect(x + 10, y + 112 + lines.length * 14 - 5, 7, 11); }
    // the whole of it
    const by = y + ph - 22;
    ctx.fillStyle = 'rgba(120,255,170,0.15)'; ctx.fillRect(x + 10, by - 4, pw - 100, 8);
    ctx.fillStyle = green; ctx.fillRect(x + 10, by - 4, (pw - 100) * k, 8);
    ctx.font = `700 11px ${MONO}`; ctx.fillText(`${Math.round(k * 100)}%`, x + pw - 84, by);
    // abort
    const ax0 = x + pw - 52, ay0 = by - 13, ax1 = x + pw - 8, ay1 = by + 13;
    ctx.strokeStyle = 'rgba(255,120,90,0.95)'; ctx.strokeRect(ax0, ay0, ax1 - ax0, ay1 - ay0);
    ctx.fillStyle = 'rgba(255,120,90,0.95)'; ctx.font = `700 11px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText('中止', (ax0 + ax1) / 2, by);
    this.hackAbort = { x0: ax0 - 6, y0: ay0 - 8, x1: ax1 + 6, y1: ay1 + 8 };
    ctx.restore();
  }

  /** keep a canvas's drawing off the tabs: clip to the screen less their outlines */
  static clipOut(ctx, outl, W, H) {
    if (!outl || !outl.length) return;
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    for (const poly of outl) { ctx.moveTo(poly[0][0], poly[0][1]); for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]); ctx.closePath(); }
    ctx.clip('evenodd');
  }

  /** the screen box round the whole object: { x0, y0, x1, y1, cx, cy } (CSS px) or null */
  screenBox(c, proj, W, H, tanH) {
    const B = this.boxOf(c);
    const sp = {};
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, ok = !!B;
    if (B) {
      const q = this.quatOf(c, _q);
      const P = new THREE.Vector3();
      for (let i = 0; i < 8 && ok; i++) {
        P.set(i & 1 ? B.max.x : B.min.x, i & 2 ? B.max.y : B.min.y, i & 4 ? B.max.z : B.min.z).applyQuaternion(q).add(c.pos);
        proj(P, sp);
        if (!sp.ok) { ok = false; break; }
        x0 = Math.min(x0, sp.x); y0 = Math.min(y0, sp.y); x1 = Math.max(x1, sp.x); y1 = Math.max(y1, sp.y);
      }
    }
    if (!ok) {
      // a sphere (or a box partly behind the eye): the middle and how big it looks
      proj(c.pos, sp);
      if (!sp.ok) return null;
      const R = this.radiusOf(c);
      const r = R / Math.max(1, c.dist) / tanH * H * 0.5;
      x0 = sp.x - r; x1 = sp.x + r; y0 = sp.y - r; y1 = sp.y + r;
    }
    // never smaller than a fingertip
    const m = 13;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    if (x1 - x0 < 2 * m) { x0 = mx - m; x1 = mx + m; }
    if (y1 - y0 < 2 * m) { y0 = my - m; y1 = my + m; }
    return { x0, y0, x1, y1 };
  }

  drawFocusFrame(ctx, x0, y0, x1, y1, k, pulse, acq) {
    const inset = 10 * k;
    ctx.strokeStyle = `rgba(160,236,255,${0.42 + 0.4 * Math.max(k, pulse)})`;
    ctx.lineWidth = 1.4 + pulse;
    const L = 18;
    const a = x0 + inset, b = y0 + inset, c = x1 - inset, d = y1 - inset;
    for (const [X, Y, sx, sy] of [[a, b, 1, 1], [c, b, -1, 1], [a, d, 1, -1], [c, d, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(X, Y + sy * L); ctx.lineTo(X, Y); ctx.lineTo(X + sx * L, Y); ctx.stroke();
    }
    // the middle
    ctx.beginPath(); ctx.arc((x0 + x1) / 2, (y0 + y1) / 2, 1.6, 0, Math.PI * 2); ctx.fillStyle = 'rgba(160,236,255,0.7)'; ctx.fill();
    if (k > 0.01) {
      // acquiring: a bar fills along the bottom, the name of what is being locked
      ctx.fillStyle = 'rgba(160,236,255,0.85)';
      ctx.fillRect(a, d + 5, (c - a) * k, 2.5);
      if (acq) { ctx.font = `600 12px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(`ロック中… ${acq.short || acq.name}`, a, d + 10); }
    }
    if (pulse > 0) { ctx.fillStyle = `rgba(170,245,255,${0.08 * pulse})`; ctx.fillRect(a, b, c - a, d - b); }
  }

  drawOrbitMark(ctx, x, y, kind) {
    const col = kind === 'pro' || kind === 'retro' ? 'rgba(140,255,175,0.8)' : 'rgba(150,215,245,0.6)';
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
    if (kind === 'pro') { ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x - 12, y); ctx.moveTo(x + 6, y); ctx.lineTo(x + 12, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y - 12); ctx.stroke(); }
    if (kind === 'retro') { ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke(); }
    if (kind === 'nad') { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); }
    ctx.font = `500 10px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText({ pro: '進行', retro: '逆行', zen: '天頂', nad: '天底' }[kind], x, y - 9);
  }

  /** a lock out of view: an arrow at the edge of the screen toward it */
  drawEdgeArrow(ctx, c, proj, W, H, col, prim) {
    const sp = proj(c.pos, {});
    let ax = sp.x - W / 2, ay = sp.y - H / 2;
    if (!sp.ok) {
      // behind: the way to turn
      _v4.set(c.pos.x - this.g.origin.x, c.pos.y - this.g.origin.y, c.pos.z - this.g.origin.z, 1).applyMatrix4(_vp);
      ax = -_v4.x; ay = _v4.y;
      if (Math.abs(ax) + Math.abs(ay) < 1e-6) ax = 1;
    }
    const a = Math.atan2(ay, ax), m = 40;
    const k = Math.min((W / 2 - m) / Math.max(1e-6, Math.abs(Math.cos(a))), (H / 2 - m) / Math.max(1e-6, Math.abs(Math.sin(a))));
    const x = W / 2 + Math.cos(a) * k, y = H / 2 + Math.sin(a) * k;
    ctx.fillStyle = col; ctx.globalAlpha = prim ? 1 : 0.75;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12);
    ctx.lineTo(x + Math.cos(a + 2.5) * 10, y + Math.sin(a + 2.5) * 10);
    ctx.lineTo(x + Math.cos(a - 2.5) * 10, y + Math.sin(a - 2.5) * 10);
    ctx.closePath(); ctx.fill();
    ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${prim ? '◆ ' : ''}${c.short || c.name} ${fmtDist(c.dist)}`, Math.max(64, Math.min(W - 64, x - Math.cos(a) * 30)), Math.max(14, Math.min(H - 14, y - Math.sin(a) * 22)));
    ctx.globalAlpha = 1;
  }

  /** the focus's card beside its box */
  drawCard(ctx, l, x0, y0, x1, y1, W, H, col, Wp) {
    const c = l.c;
    const lines = [];
    const cl = c.closing || 0;
    lines.push({ t: `${fmtDist(c.dist)}   ${Math.abs(cl) < 0.05 ? '相対 0 m/s' : (cl > 0 ? '接近 ' : '離隔 ') + Math.abs(cl).toFixed(Math.abs(cl) > 100 ? 0 : 1) + ' m/s'}`, c: C.white, mono: true });
    const dm = this.damageOf(c);
    if (dm) lines.push({ t: dm.text, c: dm.k > 0.5 ? C.red : dm.k > 0.15 ? C.amber : C.green, bar: dm.k });
    if (c.extra && c.kind !== 'rock') lines.push({ t: c.extra, c: c.threat ? C.red : C.dim });
    if (Wp && Wp.hitChance) {
      const T = Wp.targets('h8').find((x) => x.id === c.id);
      if (T) {
        const p1 = Wp.hitChance(T, 'cannon'), p2 = Wp.hitChance(T, 'rail');
        const f = (p) => (p == null ? '—' : p >= 0.995 ? '99%' : p < 0.005 ? '<1%' : Math.round(p * 100) + '%');
        lines.push({ t: `命中見込み  25mm ${f(p1)}  レール ${f(p2)}`, c: C.cyan });
      } else if (c.dist > 30000) lines.push({ t: '射程外（30 km 超）', c: C.dim });
    }
    // an escape pod: how near H8's computer is to being able to break into it
    let hs = null;
    const PD = this.g.pods;
    if (c.kind === 'pod' && c.ref && PD) {
      hs = PD.hackState(c.ref);
      if (PD.hack && PD.hack.pod === c.ref) { lines.push({ t: `侵入中… ${HACK_STAGES[PD.hack.stage]}`, c: C.green }); hs = null; }
      else if (hs.ok) {
        lines.push({ t: 'ハッキング可能', c: C.green });
        if (!c.ref.saidReady) {
          c.ref.saidReady = true;
          this.v.say('hachi_hack_ready', { n: c.ref.label }, { minGap: 4 });
          const A = this.g.audio;
          if (A.beep) { A.beep(1200, 0.05, 0.04, { direct: true, type: 'square' }); A.beep(1800, 0.08, 0.04, { direct: true, type: 'square', when: 0.08 }); }
        }
      }
      else if (hs.far) lines.push({ t: `侵入するには ${fmtDist(HACK_RANGE)} 以内へ`, c: C.dim, small: true });
      else if (!hs.busy && hs.ready) lines.push({ t: `侵入準備 ${Math.min(HACK_FOCUS, hs.focus).toFixed(1)} / ${HACK_FOCUS} 秒`, c: C.cyan, bar: 1 - Math.min(1, hs.focus / HACK_FOCUS) });
    }
    lines.push({ t: l.aim ? '照準：指定点（枠内をタップで変更）' : '照準：中心（枠内をタップで指定）', c: l.aim ? C.amber : C.dim, small: true });
    ctx.font = `600 12px ${FONT}`;
    let w = ctx.measureText(`◆ ${c.name}`).width + 24;
    for (const L of lines) { ctx.font = `${L.small ? 500 : 500} ${L.small ? 10.5 : 11.5}px ${L.mono ? MONO : FONT}`; w = Math.max(w, ctx.measureText(L.t).width + 20); }
    const lh = 16, h = 22 + lines.length * lh + 4;
    let x = x1 + 10, y = y0;
    if (x + w > W - 6) x = x0 - 10 - w;
    if (x < 6) { x = Math.max(6, Math.min(W - w - 6, x0)); y = y1 + 10; }
    y = Math.max(6, Math.min(H - h - 6, y));
    ctx.fillStyle = C.card; ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col; ctx.fillRect(x, y, 3, h);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `700 12.5px ${FONT}`; ctx.fillStyle = col;
    ctx.fillText(`◆ ${c.name}`, x + 10, y + 12);
    let yy = y + 22 + lh / 2;
    for (const L of lines) {
      ctx.font = `500 ${L.small ? 10.5 : 11.5}px ${L.mono ? MONO : FONT}`; ctx.fillStyle = L.c;
      ctx.fillText(L.t, x + 10, yy);
      if (L.bar !== undefined) {
        const bw = 46, bx = x + w - bw - 8;
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(bx, yy - 2, bw, 4);
        ctx.fillStyle = L.c; ctx.fillRect(bx, yy - 2, bw * Math.max(0, Math.min(1, 1 - L.bar)), 4);
      }
      yy += lh;
    }
    // the way in: a button under the card once it can be tried
    if (hs && hs.ok) {
      const bh = 40, bx0 = x, by0 = Math.min(H - bh - 6, y + h + 6), bw = Math.max(w, 170);
      const t = performance.now() / 1000, glow = 0.55 + 0.45 * Math.sin(t * 5);
      ctx.fillStyle = `rgba(10,40,22,${0.75 + 0.15 * glow})`; ctx.strokeStyle = C.green; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.rect(bx0, by0, bw, bh); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.green; ctx.font = `700 14px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText('▶ ハッキング開始', bx0 + bw / 2, by0 + bh / 2);
      ctx.font = `500 10px ${MONO}`; ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(120,255,170,0.6)';
      ctx.fillText(`${c.ref.G.name}  ${HACK_TIME[c.ref.grade]} 秒`, bx0 + bw - 6, by0 + bh - 7);
      this.hackBtn = { x0: bx0, y0: by0, x1: bx0 + bw, y1: by0 + bh, pod: c.ref };
    }
  }

  // ------------------------------------------------------------------ touch
  /** a tap on the view (client px): true if a lock's box took it */
  tap(px, py) {
    // breaking into an escape pod: its button under the card, the terminal's abort
    const PD = this.g.pods;
    const inR = (r) => r && px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1;
    if (PD && inR(this.hackAbort)) { PD.cancelHack('中止した'); return true; }
    if (PD && inR(this.hackBtn)) { PD.startHack(this.hackBtn.pod); return true; }
    const b = this.boxAt(px, py);
    if (!b) {
      // a tap on something seen but not locked yet: focus on it (twice quickly: and go there)
      const c = this.candAt(px, py);
      if (!c || !this.lock(c, true)) { this.lastTap = null; return false; }
      this.setPrimary(c.id);
      const now = performance.now();
      const dbl = this.lastTap && this.lastTap.id === c.id && now - this.lastTap.t < DOUBLE;
      this.lastTap = dbl ? null : { id: c.id, t: now };
      const A = this.g.audio;
      A.beep && A.beep(1500, 0.035, 0.04, { direct: true });
      if (dbl) { A.beep && A.beep(2200, 0.06, 0.05, { direct: true, when: 0.07 }); this.v.goTo && this.v.goTo(c); }
      return true;
    }
    const now = performance.now();
    const l = b.l;
    const dbl = this.lastTap && this.lastTap.id === l.id && now - this.lastTap.t < DOUBLE;
    this.lastTap = dbl ? null : { id: l.id, t: now };
    this.setPrimary(l.id);
    this.setAim(l, px, py);
    const A = this.g.audio;
    if (dbl) {
      A.beep && A.beep(1700, 0.05, 0.05, { direct: true }); A.beep && A.beep(2200, 0.06, 0.05, { direct: true, when: 0.07 });
      this.v.goTo && this.v.goTo(l.c);
    } else A.beep && A.beep(1500, 0.035, 0.04, { direct: true });
    return true;
  }

  /** long presses (input.holds): one held on a lock's box for a moment releases it */
  holds(list) {
    const now = performance.now();
    const live = new Set();
    for (const h of list || []) {
      live.add(h.id);
      if (this.held.has(h.id) || now - h.t0 < HOLD) continue;
      const b = this.boxAt(h.x, h.y);
      if (b) { this.held.add(h.id); this.unlock(b.id); }
    }
    for (const id of [...this.held]) if (!live.has(id)) this.held.delete(id);
  }

  /** the tracked thing (not locked yet) seen nearest a tap, within a fingertip of it */
  candAt(px, py) {
    if (!this.W) return null;
    const o = this.g.origin, v4 = new THREE.Vector4();
    let best = null, bd = 34;
    for (const c of this.lastCands || []) {
      if (c.locked || c.kind === 'body' || !c.pos) continue;
      v4.set(c.pos.x - o.x, c.pos.y - o.y, c.pos.z - o.z, 1).applyMatrix4(_vp);
      if (v4.w <= 1e-6) continue;
      const x = (v4.x / v4.w * 0.5 + 0.5) * this.W, y = (0.5 - v4.y / v4.w * 0.5) * this.H;
      const d = Math.hypot(x - px, y - py);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  boxAt(px, py) {
    const pad = 12;
    let best = null;
    for (const b of this.boxes) {
      if (px < b.x0 - pad || px > b.x1 + pad || py < b.y0 - pad || py > b.y1 + pad) continue;
      // the smallest box under the finger (a drone in front of a station)
      if (!best || (b.x1 - b.x0) * (b.y1 - b.y0) < (best.x1 - best.x0) * (best.y1 - best.y0)) best = b;
    }
    return best;
  }

  /** the spot under the finger on the vessel (its own frame): where the line of sight through the
   * tap meets its box, else the point of that line nearest its middle */
  setAim(l, px, py) {
    const g = this.g, cam = g.engine.camera, c = l.c;
    const ndc = new THREE.Vector3(px / this.W * 2 - 1, -(py / this.H) * 2 + 1, 0.5);
    const dir = ndc.applyMatrix4(_m.copy(cam.projectionMatrix).invert()).normalize().applyQuaternion(g.viewQuat || g.camQuat);
    const eye = g.camWorld.clone().add(g.origin);
    const q = this.quatOf(c, _q), qi = _q2.copy(q).invert();
    const o = eye.sub(c.pos).applyQuaternion(qi), d = dir.applyQuaternion(qi);
    const B = this.boxOf(c);
    let p = null;
    if (B) {
      const ray = new THREE.Ray(o, d);
      p = ray.intersectBox(B, new THREE.Vector3());
    }
    if (!p) {
      const t = Math.max(0, -o.dot(d));
      p = o.clone().addScaledVector(d, t);
      const R = this.radiusOf(c);
      if (p.length() > R) p.setLength(R);
    }
    // (a tap close to the middle of a small one keeps the middle)
    l.aim = p.length() < this.radiusOf(c) * 0.08 ? null : p;
  }

  serialize() { return { locks: this.locks.map((l) => ({ id: l.id, aim: l.aim ? l.aim.toArray().map((x) => +x.toFixed(2)) : null })), primary: this.primaryId }; }
}
