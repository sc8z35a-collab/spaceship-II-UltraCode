// A small line always in view (top centre): the speed of the vessel Kaito is aboard, and where it
// is taking him on its own — B-29's autopilot or docking, HACHI's course while he flies H8 alone,
// the shelter adrift. Plain text, refreshed a few times a second (only when it changes).
import * as THREE from 'three';

const _v = new THREE.Vector3();

function fmtDist(m) {
  if (m >= 1e6) return (m / 1000).toFixed(0) + ' km';
  if (m >= 1e4) return (m / 1000).toFixed(1) + ' km';
  if (m >= 1000) return (m / 1000).toFixed(2) + ' km';
  return Math.round(m) + ' m';
}

function fmtEta(s) {
  if (!(s > 1)) return '';
  if (s < 60) return Math.round(s) + '秒';
  if (s < 3600) return Math.round(s / 60) + '分';
  if (s < 86400) return (s / 3600).toFixed(1) + '時間';
  return (s / 86400).toFixed(1) + '日';
}

function fmtSpeed(v) {
  if (v < 100) return v.toFixed(1) + ' m/s';
  if (v < 10000) return Math.round(v).toLocaleString() + ' m/s';
  return (v / 1000).toFixed(2) + ' km/s';
}

export class StatusLine {
  constructor(game) {
    this.g = game;
    this.el = document.getElementById('hud-info');
    this.t = 0;
    this.last = '';
    this.noteText = ''; this.noteT = 0;
  }

  /** a short notice in place of the destination for a few seconds */
  note(text, sec = 3.5) { this.noteText = text; this.noteT = sec; this.t = 0; }

  /** { who, speed (m/s), tags, dest } of the vessel Kaito is aboard */
  read() {
    const g = this.g, h = g.h8;
    if (h && h.mode === 'pod' && h.crew) {
      const P = h.shelter;
      return { who: 'シェルター', speed: h.relSpeed(), tags: '', dest: `漂流中・酸素 ${P ? P.o2Text() : '—'}` };
    }
    if (h && h.solo) {
      const f = h.flight, P = h.pilot;
      const sp = f.vel.clone().sub(f.refVelocity(f.pos, _v)).length();
      const tags = f.maxMode ? ' MAX' : f.ultra ? ' ULTRA' : '';
      let dest = g.aim && g.aim.active ? '手動・視点追従' : '手動操縦';
      const hs = P.dock && P.dock.host && P.dock.host.s;
      const nm = (st) => st.name.replace('（修理基地）', '');
      if (h.berthAt) dest = `${nm(h.berthAt)} に係留中`;
      else if (P.state === 'dock') dest = `→ ${hs ? nm(hs) : 'B-29'} へドッキング中`;
      else if (P.state === 'undock') dest = `${hs ? nm(hs) : 'B-29'} から離脱中`;
      else if (P.goal) dest = `→ ${P.goal.name}  ${fmtDist(P.dist || 0)}${P.eta > 1 ? '（' + fmtEta(P.eta) + '）' : ''}${P.state === 'hold' ? '  到着' : ''}`;
      return { who: 'H8', speed: sp, tags, dest };
    }
    const f = g.flight, ap = g.autopilot, dk = g.docking;
    const sp = f.vel.clone().sub(f.refVelocity(f.pos, _v)).length();
    const tags = (f.maxMode ? ' MAX' : f.ultra ? ' ULTRA' : '') + (h && h.docked ? ' +H8' : '');
    let dest = f.landed ? (f.inWater ? '着水中' : '着陸中') : g.aim && g.aim.active ? '手動・視点追従' : '手動';
    if (dk && dk.state === 'docked') dest = `${dk.station ? dk.station.name.replace('（修理基地）', '') : 'ステーション'} に係留中`;
    else if (dk && dk.state === 'approach') dest = `→ ${dk.station ? dk.station.name : ''} へドッキング中`;
    else if (dk && dk.state === 'leaving') dest = '離脱中';
    else if (ap.state !== 'off' && ap.target) {
      const nm = ap.target.name.replace('（修理基地）', '').replace('（サブ拠点）', '');
      dest = ap.state === 'hold' ? `${nm} に到着・保持` : `→ ${nm}  ${fmtDist(ap.dist || 0)}${ap.eta > 1 ? '（' + fmtEta(ap.eta) + '）' : ''}`;
    }
    return { who: 'B-29', speed: sp, tags, dest };
  }

  update(dt) {
    const g = this.g;
    if (!this.el) return;
    if (this.noteT > 0) this.noteT -= dt;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.2;
    const show = g.running && g.player.state !== 'dead' && !(g.focus && !g.focus.out && g.focus.amt > 0.5);
    let txt = '';
    if (show) {
      const r = this.read();
      txt = `${r.who}${r.tags}  ${fmtSpeed(r.speed)}  ${this.noteT > 0 ? this.noteText : r.dest}`;
    }
    if (txt === this.last) return;
    this.last = txt;
    this.el.textContent = txt;
    this.el.style.display = txt ? 'block' : 'none';
  }
}
