// Atmosphere simulation per pressure zone: N2/O2/CO2 partial pressures (kPa), gas flow through
// open doors, ducts and leaks (orifice / choked flow), O2 generation, CO2 scrubbing, reserves.
import * as THREE from 'three';

export const ZONES = {
  cockpit: { name: 'コックピット', vol: 30, center: [0, 1.2, -10.2] },
  living: { name: 'リビング', vol: 20, center: [-1.7, 1.2, -5.8] },
  bath: { name: 'バスルーム', vol: 14, center: [1.8, 1.2, -6.4] },
  corridor: { name: '通路', vol: 55, center: [0, 1.2, -2.0] },
  airlock: { name: 'エアロック', vol: 11, center: [1.8, 1.2, -1.0] },
  ls: { name: '生命維持室', vol: 18, center: [1.8, 1.2, 3.0] },
  store: { name: '倉庫', vol: 19, center: [-1.8, 1.2, 3.0] },
  eng: { name: '機関室', vol: 22, center: [0, 1.2, 7.4] },
  under: { name: '配管層', vol: 60, center: [0, -0.9, 0] },
  // H8 (docked on the dorsal port: cockpit + shaft + the tunnel; its own life support)
  h8: { name: 'H8 船内', vol: 9, center: [0, 8.15, 0.5] },
};

// gas constant factor: kPa*m^3/s per (m^2 * kPa) of upstream pressure, air at 293 K (choked)
const KFLOW = 198.5;

function flowFactor(pUp, pDn) {
  if (pUp <= 0) return 0;
  const r = pDn / pUp;
  if (r < 0.528) return 1;
  const x = (r - 0.528) / 0.472;
  return Math.sqrt(Math.max(0, 1 - x * x));
}

export class LifeSupport {
  constructor(game) {
    this.g = game;
    this.z = {};
    for (const [id, d] of Object.entries(ZONES)) {
      this.z[id] = { id, ...d, n2: 79.2, o2: 21.3, co2: 0.04, T: 293.5, leaks: [], fog: 0, dpdt: 0, p: 100.54 };
    }
    this.reserve = { o2: 9100, n2: 17000 };   // kPa*m^3
    this.o2gen = { on: true, health: 1, rate: 0 };
    this.scrubber = { on: true, health: 1 };
    this.fans = { on: true, health: 1 };
    this.water = 180;                          // litres
    this.autoRepress = true;
    this.lockdown = false;
    this.zoneOfPlayer = 'cockpit';
    this.vacuumZones = new Set();
    this.ambient = 0;                          // outside pressure (kPa): 0 in space, ~101 on the ground
    this.portAmbient = null;                   // beyond the outer hatch when docked (the station lobby)
    this.inStation = false;                    // Kaito is aboard the docked station
    this.dampers = new Set();                  // zones cut off from the ducts (losing air)
    this.boost = 0;                            // manual re-pressurisation timer (s)
  }

  /** manual re-pressurisation of every sealed zone from the reserve tanks */
  repress() { this.boost = 120; }

  zoneAt(p) {
    const h8 = this.g.h8;
    if (p.y > 2.8 && h8 && (h8.containsPF(p) || h8.inVestibule(p))) return 'h8';
    if (p.y < -0.1) return 'under';
    if (p.z < -8.4) return 'cockpit';
    if (p.z > 5.6) return 'eng';
    if (Math.abs(p.x) <= 0.7) return 'corridor';
    if (p.x < 0) {
      if (p.z < -3.0) return 'living';
      if (p.z < 0.4) return 'corridor'; // bunk alcove
      return 'store';
    }
    if (p.z < -4.6) return 'bath';
    if (p.z < -2.6) return 'corridor'; // lift alcove
    if (p.z < 0.6) return 'airlock';
    return 'ls';
  }

  pressure(id) { const z = this.z[id]; return z.n2 + z.o2 + z.co2; }

  /** connections: [a, b, area] */
  connections() {
    const g = this.g, D = g.doors, c = [];
    for (const d of Object.values(D)) {
      const [a, b] = d.def.zones;
      if (d.flowArea > 1e-5) c.push([a, b, d.flowArea]);
    }
    // lift shaft open when the platform is down
    if (g.lift && g.lift.shaftOpen > 0) c.push(['corridor', 'under', 1.1 * g.lift.shaftOpen]);
    if (g.engHatch && g.engHatch.open > 0) c.push(['eng', 'under', 0.5 * g.engHatch.open]);
    // B-29's dorsal port open to a docked H8
    if (g.h8) { const a = g.h8.portFlowArea(); if (a > 1e-5) c.push(['corridor', 'h8', a]); }
    // ducts (forced ventilation) — small effective areas between every zone and LS hub; the
    // dampers of a zone that is losing air shut on their own so it cannot drain the others
    if (this.fans.on && this.fans.health > 0.2 && !this.lockdown && !this.dampers.has('ls')) {
      for (const id of Object.keys(this.z)) if (id !== 'ls' && id !== 'airlock' && id !== 'h8' && !this.dampers.has(id)) c.push([id, 'ls', 0.004 * this.fans.health, true]);
    }
    return c;
  }

  addLeak(zone, area, id) {
    const L = { zone, area, id };
    this.z[zone].leaks.push(L);
    return L;
  }

  removeLeak(L) {
    const z = this.z[L.zone];
    z.leaks = z.leaks.filter((x) => x !== L);
  }

  step(dt) {
    const Z = this.z;
    const sub = Math.max(1, Math.ceil(dt / 0.02));
    const h = dt / sub;
    for (let s = 0; s < sub; s++) this._step(h);
    for (const z of Object.values(Z)) {
      const p = z.n2 + z.o2 + z.co2;
      z.dpdt = (p - z.p) / Math.max(dt, 1e-4);
      z.p = p;
      // adiabatic fog when pressure drops quickly
      const drop = Math.max(0, -z.dpdt);
      z.fog = Math.max(z.fog * Math.exp(-dt * 0.25), Math.min(1, Math.max(0, drop - 0.5) / 4));
      if (z.fog < 1e-3) z.fog = 0;
      z.T += (293.5 - z.T) * Math.min(1, dt * 0.002) - Math.min(30, drop * 0.02) * dt;
      if (p < 0.5) this.vacuumZones.add(z.id); else this.vacuumZones.delete(z.id);
      // automatic duct dampers: shut while a zone leaks or falls fast, open again once it holds
      const leaking = z.leaks.some((l) => l.area > 2e-5) || z.dpdt < -0.25;
      if (leaking && p < 99) this.dampers.add(z.id);
      else if (!leaking && p > 95) this.dampers.delete(z.id);
    }
  }

  /** air pressure at a ship-local point: docked station, outside, or the cabin zone */
  pressureAt(p, outside = false) {
    const g = this.g;
    if (g.docking && g.docking.contains(p)) return g.docking.airAt(p).p;
    if (outside) return this.ambient;
    return this.pressure(this.zoneAt(p));
  }

  _step(dt) {
    const Z = this.z;
    // inter-zone flows
    for (const [a, b, area, duct] of this.connections()) {
      const A = Z[a], B = Z[b];
      const pa = A.n2 + A.o2 + A.co2, pb = B.n2 + B.o2 + B.co2;
      const up = pa >= pb ? A : B, dn = pa >= pb ? B : A;
      const pu = Math.max(pa, pb), pd = Math.min(pa, pb);
      if (pu - pd < 1e-6 && !duct) continue;
      let flow = KFLOW * area * pu * flowFactor(pu, pd) * dt; // kPa*m^3
      // limit to equalisation amount
      const eq = (pu - pd) / (1 / up.vol + 1 / dn.vol);
      flow = Math.min(flow, eq * 0.5);
      if (flow > 0) {
        const fu = flow / up.vol, fd = flow / dn.vol;
        const tot = pu;
        const cn = up.n2 / tot, co = up.o2 / tot, cc = up.co2 / tot;
        up.n2 -= cn * fu; up.o2 -= co * fu; up.co2 -= cc * fu;
        dn.n2 += cn * fd; dn.o2 += co * fd; dn.co2 += cc * fd;
      }
      if (duct) {
        // ventilation mixing of composition even without pressure difference
        const mix = Math.min(1, area * 30 * dt);
        for (const k of ['o2', 'co2']) {
          const ca = A[k] / Math.max(pa, 1e-3), cb = B[k] / Math.max(pb, 1e-3);
          const dc = (ca - cb) * mix * 0.5;
          A[k] -= dc * pa * (B.vol / (A.vol + B.vol));
          B[k] += dc * pb * (A.vol / (A.vol + B.vol));
        }
      }
    }
    // leaks to vacuum (plus the outer hatch)
    const out = [];
    for (const z of Object.values(Z)) for (const L of z.leaks) out.push([z, L.area]);
    const hatch = this.g.hatch;
    if (hatch && hatch.flowArea > 0) out.push([Z.airlock, hatch.flowArea, true]);
    for (const [z, area, port] of out) {
      // hull leaks go to space (or the outside air); the open hatch to whatever is beyond it
      const pa = port && this.portAmbient !== null ? this.portAmbient : this.ambient;
      const p = z.n2 + z.o2 + z.co2;
      if (p > pa + 1e-4) {
        // venting (choked to vacuum, subsonic when the outside has air)
        const loss = Math.min((p - pa) * 0.6, KFLOW * area * p * flowFactor(p, pa) * dt / z.vol);
        const f = 1 - loss / Math.max(p, 1e-6);
        z.n2 *= f; z.o2 *= f; z.co2 *= f;
      } else if (pa > p + 1e-4) {
        // outside air flows in (on Earth)
        const gain = Math.min((pa - p) * 0.6, KFLOW * area * pa * flowFactor(pa, p) * dt / z.vol);
        z.n2 += gain * 0.7808; z.o2 += gain * 0.2095; z.co2 += gain * 0.0004;
      }
    }
    // crew metabolism (player zone, unless in suit)
    const pl = this.g.player;
    const zp = Z[this.zoneOfPlayer];
    if (zp && !pl.suit && pl.state !== 'dead' && !this.inStation) {
      const use = 7.4e-4 * dt / zp.vol;
      zp.o2 = Math.max(0, zp.o2 - use);
      zp.co2 += 6.4e-4 * dt / zp.vol;
    }
    // O2 generator (LS room) & scrubbers (via ducts all zones are reached)
    const ls = Z.ls;
    const power = this.g.systems.power ?? 1;
    if (this.o2gen.on && this.o2gen.health > 0.1 && power > 0.3) {
      const ppo2 = ls.o2;
      const need = Math.max(0, 21.3 - ppo2);
      const rate = Math.min(need * 0.02, 0.004 * this.o2gen.health) * dt;
      ls.o2 += rate;
      this.o2gen.rate = rate / dt;
    } else this.o2gen.rate = 0;
    if (this.scrubber.on && this.scrubber.health > 0.1 && power > 0.3) {
      for (const z of Object.values(Z)) {
        if (z.id === 'h8') continue;   // H8 scrubs its own air
        const k = (this.fans.on ? 0.0025 : 0.0) * this.scrubber.health * (z.id === 'ls' ? 3 : 1);
        z.co2 -= (z.co2 - 0.03) * Math.min(1, k * dt);
      }
    }
    // automatic re-pressurisation from reserves (sealed zones only, slow)
    if (this.autoRepress || this.boost > 0) {
      this.boost = Math.max(0, this.boost - dt);
      const k = this.boost > 0 ? 6 : 1;
      for (const z of Object.values(Z)) {
        if (z.id === 'h8') continue;   // H8's own tanks (see H8Vessel.updateAir)
        if (z.id === 'airlock' && ((this.g.airlockMode && this.g.airlockMode !== 'idle') || (this.g.hatch && !this.g.hatch.sealed))) continue;
        if (z.leaks.length && z.leaks.some((l) => l.area > 2e-4)) continue;
        const p = z.n2 + z.o2 + z.co2;
        if (p < 99 && (p > 20 || this.boost > 0)) {
          const dn = Math.min(0.08 * k * dt, Math.max(0, 79.2 - z.n2) * 0.01 * k * dt + (this.boost > 0 ? 0.02 * dt : 0), this.reserve.n2 / z.vol);
          if (dn > 0) { z.n2 += dn; this.reserve.n2 -= dn * z.vol; }
          const doo = Math.min(0.03 * k * dt, Math.max(0, 21.3 - z.o2) * 0.01 * k * dt + (this.boost > 0 ? 0.006 * dt : 0), this.reserve.o2 / z.vol);
          if (doo > 0) { z.o2 += doo; this.reserve.o2 -= doo * z.vol; }
        }
      }
    }
  }

  /** conditions the player breathes */
  breathing() {
    const pl = this.g.player;
    if (pl.suit) return { p: 30, o2: pl.suitO2 > 0.003 ? 29.6 : 0, co2: 0.1, suit: true };
    if (pl.outside) { const a = this.ambient; return { p: a, o2: a * 0.2095, co2: a * 0.0004, suit: false }; }
    if (this.inStation) { const a = this.g.docking.airAt(pl.pos); return { p: a.p, o2: a.o2, co2: a.co2, suit: false }; }   // station air
    const z = this.z[this.zoneOfPlayer];
    return { p: z.n2 + z.o2 + z.co2, o2: z.o2, co2: z.co2, suit: false };
  }

  serialize() {
    const z = {};
    for (const [k, v] of Object.entries(this.z)) z[k] = { n2: v.n2, o2: v.o2, co2: v.co2, T: v.T };
    return { z, reserve: this.reserve, o2gen: this.o2gen, scrubber: this.scrubber, fans: this.fans, water: this.water, lockdown: this.lockdown };
  }

  restore(d) {
    for (const [k, v] of Object.entries(d.z || {})) if (this.z[k]) { Object.assign(this.z[k], v); this.z[k].p = v.n2 + v.o2 + v.co2; }
    Object.assign(this.reserve, d.reserve || {});
    Object.assign(this.o2gen, d.o2gen || {});
    Object.assign(this.scrubber, d.scrubber || {});
    Object.assign(this.fans, d.fans || {});
    if (d.water !== undefined) this.water = d.water;
    this.lockdown = !!d.lockdown;
  }
}
