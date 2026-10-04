// Persistence: autosave + manual save in localStorage. On load the world keeps going: the time
// that passed in real life is simulated (orbit / autopilot travel, life support, damage).
import * as THREE from 'three';
import { MU_EARTH, OMEGA_EARTH } from '../core/astro.js';

const KEY = 'b29.save.v1';
const SAFE = 'b29.save.safe.v1';

export class SaveSystem {
  constructor(game) {
    this.g = game;
    this.timer = 0;
    this.enabled = true;
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { this.save(); this.hiddenAt = Date.now(); }
      else if (this.hiddenAt) this.resume();
    });
    window.addEventListener('pagehide', () => this.save());
  }

  hasSave() {
    try { const s = localStorage.getItem(KEY); if (!s) return false; const d = JSON.parse(s); return !d.dead; } catch (e) { return false; }
  }

  snapshot() {
    const g = this.g;
    const d = {
      v: 1, wall: Date.now(), time: g.time,
      flight: g.flight.serialize(),
      player: g.player.serialize(),
      ls: g.lifeSupport.serialize(),
      dmg: g.damage.serialize(),
      doors: Object.fromEntries(Object.entries(g.doors).map(([k, d]) => [k, { open: d.open, target: d.target, locked: d.locked, jammed: d.jammed }])),
      hatch: { open: g.hatch.open, target: g.hatch.target, dogs: g.hatch.dogs },
      lift: g.lift ? g.lift.y : 0,
      ap: g.autopilot.state !== 'off' && g.autopilot.target ? g.autopilot.target.id : null,
      dock: g.docking ? g.docking.serialize() : null,
      sys: g.systems.serializeState(),
      ast: { timer: g.asteroids.timer, micro: g.asteroids.microTimer },
      world: g.worldDamage ? g.worldDamage.serialize() : null,
      dead: g.player.state === 'dead',
    };
    return d;
  }

  save() {
    if (!this.enabled || !this.g.running) return;
    try {
      const d = this.snapshot();
      const s = JSON.stringify(d);
      localStorage.setItem(KEY, s);
      if (!d.dead && !this.g.systems.alarm.active) localStorage.setItem(SAFE, s);
    } catch (e) { console.warn('save failed', e); }
  }

  update(dt) {
    this.timer += dt;
    if (this.timer > 15) { this.timer = 0; this.save(); }
  }

  load(useSafe = false) {
    let d;
    try { d = JSON.parse(localStorage.getItem(useSafe ? SAFE : KEY)); } catch (e) { d = null; }
    if (!d) return false;
    const g = this.g;
    g.time = d.time;
    g.flight.restore(d.flight);
    g.lifeSupport.restore(d.ls);
    g.damage.restore(d.dmg);
    for (const [k, v] of Object.entries(d.doors || {})) if (g.doors[k]) Object.assign(g.doors[k], v);
    if (d.hatch) Object.assign(g.hatch, d.hatch);
    if (g.lift && d.lift !== undefined) { g.lift.y = d.lift; g.lift.target = d.lift; }
    const p = d.player;
    g.player.teleport(new THREE.Vector3(...p.pos));
    g.player.yaw = p.yaw; g.player.pitch = p.pitch;
    g.player.suit = p.suit; g.player.suitO2 = p.suitO2 ?? 1; g.player.suitFuel = p.suitFuel ?? 1; g.player.health = Math.max(0.3, p.health ?? 1);
    if (p.outside) { g.player.outside = true; g.player.state = 'eva'; }
    if (p.seat) { const seat = g.layout.seats.find((s) => s.id === p.seat); if (seat) g.systems.sit(seat); }
    g.systems.restoreState(d.sys || {});
    if (d.ast) { g.asteroids.timer = d.ast.timer; g.asteroids.microTimer = d.ast.micro; }
    if (d.world && g.worldDamage) g.worldDamage.restore(d.world);
    // ---- the world did not stop: simulate the elapsed real time
    const gap = Math.min(30 * 86400, Math.max(0, (Date.now() - d.wall) / 1000));
    this.offline = this.catchUp(gap, d.dock ? null : d.ap);
    // docked: the ship rode along with the station the whole time
    if (d.dock && g.docking) g.docking.redock(d.dock);
    return true;
  }

  /** back from the background (app switched / screen off): the world kept going meanwhile */
  resume() {
    const g = this.g;
    const gap = Math.min(30 * 86400, Math.max(0, (Date.now() - this.hiddenAt) / 1000));
    this.hiddenAt = 0;
    if (!g.running || !this.enabled || gap < 8 || g.player.state === 'dead') return;
    const ap = g.autopilot.state !== 'off' && g.autopilot.target ? g.autopilot.target.id : null;
    const rep = this.catchUp(gap, ap, true);
    g.last = 0;
    if (gap > 60) {
      const h = gap / 3600;
      const ht = h < 1 ? Math.round(gap / 60) + '分' : h < 48 ? h.toFixed(1) + '時間' : (h / 24).toFixed(1) + '日';
      g.asphalt.say('back', { h: ht }, { force: true });
      if (rep.hits) g.asphalt.say('offline_hits', { n: rep.hits }, { force: true });
    }
  }

  catchUp(gap, apTarget, engaged = false) {
    const g = this.g, f = g.flight;
    const report = { gap, hits: 0 };
    if (gap < 5) return report;
    const tStart = g.time;
    const terrain = (pos) => g.terrainAt(pos);
    if (apTarget && (engaged || g.autopilot.engage(apTarget))) {
      // fly the autopilot in coarse steps (the simulation clock advances with it)
      if (!engaged) { g.asphalt.queue.length = 0; g.asphalt.log.pop(); }
      let t = 0;
      const step = gap > 86400 ? 4 : 1;
      while (t < gap) {
        const h = Math.min(step, gap - t);
        g.time = tStart + t * 1000;
        g.autopilot.update(h, g.time);
        f._step(h, null, terrain);
        t += h;
        if (g.autopilot.state === 'hold' && f.vel.distanceTo(g.autopilot.target.vel) < 1) {
          // arrived: coast along with the target for the rest of the gap
          const rest = gap - t;
          this._coast(rest);
          break;
        }
      }
    } else if (f.landed || f.alt < 100000) {
      // resting on the ground / hovering with the air: turn with the Earth
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), OMEGA_EARTH * gap);
      f.pos.applyQuaternion(q); f.vel.applyQuaternion(q); f.hRef.applyQuaternion(q);
      f.updateAttitude();
    } else {
      this._coast(gap);
    }
    g.time = tStart + gap * 1000;
    // life support + damage evolution in coarse steps (Asphalt keeps the crew zone sealed)
    const dt = gap > 3600 ? 30 : 5;
    let left = gap;
    const ls = g.lifeSupport;
    // probable impacts while away (Asphalt dodges most of them)
    const hits = Math.min(3, Math.floor(gap / (14 * 3600) + Math.random() * (gap / (14 * 3600))));
    const when = Array.from({ length: hits }, () => Math.random() * gap).sort((a, b) => a - b);
    let el = 0;
    g.damage.catchingUp = true;
    while (left > 0) {
      const h = Math.min(dt, left);
      ls._step(h);
      g.damage.update(h);
      if (g.worldDamage) g.worldDamage.update(h);
      left -= h; el += h;
      while (when.length && when[0] <= el) {
        when.shift();
        g.asteroids.micro();
        report.hits++;
      }
      // Asphalt closes the doors of leaking zones
      for (const z of Object.values(ls.z)) if (z.leaks.length && z.p < 80) ls.lockdown = true;
    }
    if (ls.lockdown) for (const d of Object.values(g.doors)) d.setTarget(0, true);
    g.damage.catchingUp = false;
    // while nobody was watching the hull held on - just: it comes back on the brink, not in pieces
    if (g.damage.integrity() <= 0.02) g.damage.fatigue = Math.max(0, (g.damage.fatigue || 0) - (0.03 - g.damage.integrity()));
    g.damage.events.length = 0;
    g.systems.alarm.active = g.damage.issues.some((i) => i.state === 'active');
    return report;
  }

  _coast(sec) {
    // rotate along the reference circular orbit (flight assist hold)
    const f = this.g.flight;
    const r = f.pos.length();
    const n = Math.sqrt(MU_EARTH / (r * r * r));
    const h = f.hRef.clone().addScaledVector(f.pos.clone().normalize(), -f.hRef.dot(f.pos) / r).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(h, n * sec);
    f.pos.applyQuaternion(q);
    f.vel.applyQuaternion(q);
    f.updateAttitude();
  }

  clear() {
    try { localStorage.removeItem(KEY); localStorage.removeItem(SAFE); } catch (e) { /* ignore */ }
  }
}
