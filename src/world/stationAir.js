// The air inside a docked station, section by section (lobby, promenade, core atrium): pressure
// and oxygen, holes punched by strikes that vent to space, flow through open doors, and the
// station's emergency protocol — doors next to a section that loses pressure slam shut and lock,
// sealing the rest; the station's life support refills sealed sections while it has power and
// its crew slowly patch the holes. B-29's open hatch breathes with the lobby section.
import * as THREE from 'three';

const P0 = 101.3, O2F = 0.2095;

export class StationAir {
  constructor(lobby, station) {
    this.lobby = lobby;
    this.station = station;
    const sec = (name, vol) => ({ name, vol, p: P0, o2: P0 * O2F });
    if (lobby.sections) {
      // a station of its own plan (the Origin): its sections as it lists them ('lobby' is the port)
      this.sec = {};
      for (const s of lobby.sections) this.sec[s.id] = sec(s.name, s.vol);
    } else {
      this.sec = { lobby: sec('ロビー', 2500), promenade: sec('プロムナード', 900) };
      if (lobby.hasAtrium) this.sec.atrium = sec('中央アトリウム', 2300);
      if (lobby.ring) this.sec.ring = sec('リング居住区', 12000);
      if (lobby.terminal) this.sec.akamo = sec('AKAMOターミナル', 3400);
    }
    this.ringContains = null;
    // links between sections through the station doors
    this.links = [];
    for (const d of lobby.doors) { d.air = this; if (d.def.link) this.links.push({ a: d.def.link[0], b: d.def.link[1], door: d }); }
    this.breaches = [];       // { sec, p, n, area, id }
    this.nextId = 1;
    this.events = [];
    // a station already in trouble when we dock has thin air
    const st = station.dmg ? station.dmg.status : 'ok';
    if (st === 'critical') for (const s of Object.values(this.sec)) { s.p = 78; s.o2 = 78 * O2F * 0.9; }
  }

  sectionAt(p) {
    if (this.ringContains && this.ringContains(p)) return 'ring';
    return this.lobby.sectionAt ? this.lobby.sectionAt(p) || 'lobby' : 'lobby';
  }

  airAt(p) {
    const s = this.sec[this.sectionAt(p)] || this.sec.lobby;
    return { p: s.p, o2: s.o2, co2: 0.05 };
  }

  /** a strike tears a hole in one section (area m^2); returns the breach { sec, p, n (inward), area } */
  breach(area, secName = null) {
    const names = Object.keys(this.sec);
    const w = names.map((n) => this.sec[n].vol);
    let pick = secName;
    if (!pick) { let r = Math.random() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < names.length; i++) { r -= w[i]; if (r <= 0) { pick = names[i]; break; } } pick = pick || names[0]; }
    const spots = (this.lobby.breachSpots && this.lobby.breachSpots[pick]) || [];
    const sp = spots.length ? spots[Math.floor(Math.random() * spots.length)] : { p: new THREE.Vector3(11, 7, -2), n: new THREE.Vector3(0, -1, 0) };
    const b = { sec: pick, p: sp.p.clone(), n: sp.n.clone(), area, area0: area, id: 'stbreach' + this.nextId++, t: 0 };
    this.breaches.push(b);
    return b;
  }

  /** emergency protocol state for one door: shut and locked while either side is unsafe */
  _unsafe(name) {
    const s = this.sec[name];
    return s.p < 85 || this.breaches.some((b) => b.sec === name && b.area > 1e-4);
  }

  update(dt, status, playerPos) {
    const alive = status === 'ok' || status === 'damaged' || status === 'critical';
    // venting to space
    for (const b of this.breaches) {
      const s = this.sec[b.sec];
      b.t += dt;
      const q = Math.min(s.p, s.p * b.area * 198.5 / s.vol * dt);   // choked flow to vacuum
      s.p -= q; s.o2 = Math.max(0, s.o2 - q * (s.o2 / Math.max(s.p + q, 1e-3)));
      // the crew patch what they can reach while the station has power
      if (alive) b.area = Math.max(0, b.area - dt * (status === 'critical' ? 0.00006 : 0.00025));
    }
    this.breaches = this.breaches.filter((b) => b.area > 1e-5);
    // flow between sections through open doors (equalising)
    for (const L of this.links) {
      const A = this.sec[L.a], B = this.sec[L.b];
      if (!A || !B || L.door.open < 0.03) continue;
      const area = L.door.open * L.door.def.w * L.door.def.h;
      const k = Math.min(0.5, area * 60 * dt / Math.min(A.vol, B.vol));
      const dp = (A.p - B.p) * k;
      const moved = dp * (A.vol * B.vol) / (A.vol + B.vol);
      const fa = moved / A.vol, fb = moved / B.vol;
      const xo = dp > 0 ? A.o2 / Math.max(A.p, 1e-3) : B.o2 / Math.max(B.p, 1e-3);
      A.p -= fa; B.p += fb; A.o2 -= fa * xo; B.o2 += fb * xo;
    }
    // the station's life support tops up sealed sections (none at all once it has failed)
    if (alive) for (const [name, s] of Object.entries(this.sec)) {
      if (this.breaches.some((b) => b.sec === name)) continue;
      const rate = status === 'critical' ? 0.12 : 0.6;
      if (s.p < P0) { const d = Math.min(P0 - s.p, rate * dt); s.p += d; s.o2 = Math.min(s.p * O2F, s.o2 + d * O2F * 1.05); }
    } else for (const s of Object.values(this.sec)) s.o2 = Math.max(0, s.o2 - dt * 0.0008 * s.p / 101);   // nobody scrubs, nobody refills
    // a section that held again after a breach
    for (const [name, s] of Object.entries(this.sec)) {
      const bad = this._unsafe(name);
      if (s.wasBad && !bad) this.events.push({ type: 'recovered', sec: name });
      s.wasBad = bad;
    }
    // emergency doors: shut and lock between a failing section and the rest
    for (const L of this.links) {
      const lock = this._unsafe(L.a) || this._unsafe(L.b) || !alive;
      const d = L.door;
      if (lock && !d.locked) d.emergency = true;
      if (!lock && d.emergency) d.emergency = false;
      // never close on someone standing in the doorway
      const inWay = playerPos && d.def.c.distanceTo(playerPos) < 1.0;
      d.locked = d.emergency && !inWay;
    }
  }

  /** pressure at B-29's hatch (the docking tunnel opens into the lobby) */
  get portPressure() { return this.sec.lobby.p; }
}
