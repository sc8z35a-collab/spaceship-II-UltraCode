// The cockpit's wrap-around display: what H8's four outside cameras see, stitched in real time and
// shown on the inside of the cockpit sphere. While Kaito sits inside, H8's own hull is left out of
// the picture (the cameras look past it), so the display shows the world as if the walls were
// gone — through a fine pixel grid, faint stitch seams where one camera's field hands over to the
// next, and an AR overlay: horizon and pitch ladder, the orbit markers, targets with distances,
// threats boxed in red, H8's own state. Dark when H8 is powered down; panels come up one by one.
import * as THREE from 'three';
import { H8, CAMERAS } from './h8Spec.js';
import { displayGeometry } from './h8Interior.js';
import { R_EARTH } from '../core/astro.js';

const FRAG = /* glsl */`
uniform sampler2D tHud;
uniform float uPower;     // 0 off .. 1 on (boot sweeps through it)
uniform float uTime;
uniform vec3 uCam[4];
uniform vec3 uC;
varying vec2 vUv;
varying vec3 vP;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 d = normalize(vP - uC);
  // panel grid (12 x 6) and the boot order of the panels
  vec2 pan = vec2(floor(vUv.x * 24.0), floor(vUv.y * 12.0));
  float on = smoothstep(0.0, 0.08, uPower * 1.15 - h(pan) * 0.9);
  // camera hand-over: the two nearest cameras' weights
  float best = -2.0, second = -2.0;
  for (int i = 0; i < 4; i++){ float k = dot(d, uCam[i]); if (k > best){ second = best; best = k; } else if (k > second) second = k; }
  float seam = 1.0 - smoothstep(0.0, 0.025, best - second);
  // pixel grid of the panels
  vec2 px = fract(vUv * vec2(2048.0, 1024.0));
  float grid = smoothstep(0.0, 0.18, min(px.x, px.y));
  // panel bezel lines
  vec2 pf = fract(vUv * vec2(24.0, 12.0));
  float bez = 1.0 - smoothstep(0.0, 0.012, min(min(pf.x, 1.0 - pf.x), min(pf.y, 1.0 - pf.y)));
  vec4 hud = texture2D(tHud, vUv);
  // the view through: nearly clear, a touch of the display's own black level and grid
  vec3 col = vec3(0.0);
  float a = mix(0.97, 0.06 + 0.1 * (1.0 - grid), on);
  col += vec3(0.25, 0.45, 0.6) * seam * 0.05 * on;
  col += hud.rgb * hud.a * on;
  a = max(a, hud.a * 0.85 * on);
  a = max(a, bez * 0.85);
  col = mix(col, vec3(0.008), bez * 0.9);
  // scan shimmer and a little noise
  col += (h(vUv * 900.0 + uTime) - 0.5) * 0.012 * on;
  // booting panel edge flash
  col += vec3(0.4, 0.7, 1.0) * smoothstep(0.08, 0.0, abs(uPower * 1.15 - h(pan) * 0.9 - 0.04)) * (1.0 - step(0.999, uPower)) * 0.8;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

const VERT = /* glsl */`
varying vec2 vUv; varying vec3 vP;
void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export class H8Display {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2048; this.canvas.height = 1024;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.wrapS = THREE.RepeatWrapping;
    this.tex.anisotropy = 4;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tHud: { value: this.tex }, uPower: { value: 0 }, uTime: { value: 0 },
        uCam: { value: CAMERAS.map((c) => c.dir.clone()) }, uC: { value: H8.cockpitC.clone() },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(displayGeometry(), this.mat);
    this.mesh.renderOrder = 20;
    this.mesh.name = 'h8Display';
    this.mesh.frustumCulled = false;
    this.power = 0;
    this.target = 0;
    this.t = 0;
  }

  /** H8-local direction -> canvas pixel */
  px(d) {
    const az = Math.atan2(d.x, -d.z), el = Math.asin(Math.max(-1, Math.min(1, d.y)));
    return [((az + Math.PI) / (Math.PI * 2)) * 2048, (1 - (el + Math.PI / 2) / Math.PI) * 1024];
  }

  /**
   * Repaint the AR overlay. info: { qInv (ECI -> H8 local), up (ECI radial), vel (ECI, relative to
   * the local orbit), targets: [{ name, pos (ECI), from (ECI eye pos), kind }], threats: [...],
   * status lines, time }
   */
  paint(info) {
    const g = this.ctx, W = 2048, H = 1024;
    g.clearRect(0, 0, W, H);
    const L = (v) => v.clone().applyQuaternion(info.qInv).normalize();
    const col = 'rgba(120,230,255,0.85)', dim = 'rgba(120,230,255,0.45)', warn = 'rgba(255,90,60,0.95)';
    g.lineWidth = 2;
    g.font = 'bold 20px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // ---- horizon & pitch ladder: great circles at elevations relative to the local vertical
    const up = L(info.up);
    const e1 = new THREE.Vector3().crossVectors(up, Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    const e2 = new THREE.Vector3().crossVectors(up, e1).normalize();
    for (const pitch of [-60, -40, -20, 0, 20, 40, 60]) {
      const c = Math.cos(pitch * Math.PI / 180), s = Math.sin(pitch * Math.PI / 180);
      g.strokeStyle = pitch === 0 ? col : dim;
      g.setLineDash(pitch < 0 ? [10, 10] : []);
      g.lineWidth = pitch === 0 ? 3 : 1.5;
      let prev = null;
      for (let k = 0; k <= 360; k += 2) {
        const a = k * Math.PI / 180;
        const d = e1.clone().multiplyScalar(Math.cos(a) * c).addScaledVector(e2, Math.sin(a) * c).addScaledVector(up, s);
        const p = this.px(d);
        if (prev && Math.abs(p[0] - prev[0]) < W / 2) { g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(p[0], p[1]); g.stroke(); }
        prev = p;
      }
      if (pitch !== 0) {
        for (const a of [0.3, 2.4, 4.5]) {
          const d = e1.clone().multiplyScalar(Math.cos(a) * c).addScaledVector(e2, Math.sin(a) * c).addScaledVector(up, s);
          const p = this.px(d);
          g.fillStyle = dim; g.fillText((pitch > 0 ? '+' : '') + pitch + '°', p[0], p[1] - 14);
        }
      }
    }
    g.setLineDash([]);
    // ---- orbit markers: prograde / retrograde / radial / normal
    const mark = (dEci, label, kind) => {
      const d = L(dEci), p = this.px(d);
      g.strokeStyle = kind === 'pro' ? 'rgba(140,255,160,0.95)' : col; g.lineWidth = 2.5;
      g.beginPath(); g.arc(p[0], p[1], 14, 0, Math.PI * 2); g.stroke();
      if (kind === 'pro') { for (const a of [0, Math.PI / 2, Math.PI]) { g.beginPath(); g.moveTo(p[0] + Math.cos(a + Math.PI / 2) * 14, p[1] - Math.sin(a + Math.PI / 2) * 14); g.lineTo(p[0] + Math.cos(a + Math.PI / 2) * 28, p[1] - Math.sin(a + Math.PI / 2) * 28); g.stroke(); } }
      g.fillStyle = g.strokeStyle; g.font = 'bold 16px sans-serif'; g.fillText(label, p[0], p[1] + 30);
    };
    if (info.vel && info.vel.lengthSq() > 1) { mark(info.vel.clone().normalize(), '進行方向', 'pro'); mark(info.vel.clone().normalize().negate(), '逆行', 'retro'); }
    mark(info.up, '天頂', 'rad');
    // ---- targets
    g.font = 'bold 18px sans-serif';
    for (const t of info.targets) {
      const rel = t.pos.clone().sub(info.from);
      const dist = rel.length();
      if (dist < 1) continue;
      const p = this.px(L(rel));
      const c = t.kind === 'b29' ? 'rgba(255,190,90,0.95)' : t.kind === 'body' ? 'rgba(220,235,255,0.8)' : col;
      g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 2;
      if (t.kind === 'body') { g.beginPath(); g.arc(p[0], p[1], 9, 0, Math.PI * 2); g.stroke(); }
      else { const s = 16; g.strokeRect(p[0] - s, p[1] - s, s * 2, s * 2); }
      const dTxt = dist > 9.5e5 ? (dist / 1000).toFixed(0) + ' km' : dist > 9500 ? (dist / 1000).toFixed(1) + ' km' : dist.toFixed(0) + ' m';
      g.fillText(t.name, p[0], p[1] - 30);
      g.font = '15px sans-serif'; g.fillText(dTxt, p[0], p[1] + 32); g.font = 'bold 18px sans-serif';
    }
    // ---- threats: red brackets that pulse
    const pulse = 0.6 + 0.4 * Math.sin(info.time * 8);
    for (const a of info.threats) {
      const p = this.px(L(a.rel));
      g.strokeStyle = `rgba(255,70,50,${pulse})`; g.lineWidth = 3;
      const s = 26;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.beginPath(); g.moveTo(p[0] + sx * s, p[1] + sy * (s - 10)); g.lineTo(p[0] + sx * s, p[1] + sy * s); g.lineTo(p[0] + sx * (s - 10), p[1] + sy * s); g.stroke(); }
      g.fillStyle = warn; g.fillText(`接近物  ${(a.dist).toFixed(0)} m`, p[0], p[1] + s + 18);
    }
    // ---- camera hand-over labels
    g.font = '14px sans-serif'; g.fillStyle = 'rgba(150,200,230,0.5)';
    for (const c of CAMERAS) { const p = this.px(c.dir); g.fillText(c.name, p[0], p[1] + 54); }
    // ---- status block (fixed, ahead and a little up) + a heading tape along the top of the view
    const sx = W * (0.5 - 0.09), sy = H * 0.3;
    g.textAlign = 'left'; g.font = 'bold 22px sans-serif'; g.fillStyle = col;
    (info.lines || []).forEach((ln, i) => { g.fillStyle = ln.warn ? warn : col; g.fillText(ln.text, sx, sy + i * 30); });
    g.textAlign = 'center';
    this.tex.needsUpdate = true;
  }

  update(dt, on) {
    this.target = on ? 1 : 0;
    // boot: the panels come up over ~2.5 s; switching off is quicker
    this.power += (this.target > this.power ? 1 / 2.5 : -1 / 0.8) * dt;
    this.power = Math.max(0, Math.min(1, this.power));
    this.t += dt;
    this.mat.uniforms.uPower.value = this.power;
    this.mat.uniforms.uTime.value = this.t % 1000;
  }
}

/** a short readable distance */
export function fmtDist(m) {
  if (m > 9.5e5) return (m / 1000).toFixed(0) + ' km';
  if (m > 9500) return (m / 1000).toFixed(1) + ' km';
  return m.toFixed(0) + ' m';
}

export function altOf(pos) { return pos.length() - R_EARTH; }
