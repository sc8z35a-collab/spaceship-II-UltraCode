// Damage to the world around B-29: asteroids strike the stations and the space elevator too.
// Each has a health that strikes take away (scorched / holed plating, venting air, fires); it can
// lose power and stop (lights out, habitat ring spinning down, elevator climbers stuck), and a big
// enough strike breaks it apart. Kaito cannot fix any of it — station crews slowly patch what is
// still alive; a wreck stays a wreck. Nearby strikes are seen and heard, and the ship warns.
import * as THREE from 'three';
import { LAYER_FAR, LAYER_MID, LAYER_NEAR } from '../core/layers.js';
import { petalGeometry, linerGeometry, outlineF, shardGeometry } from '../ship/tornMetal.js';

const H = 3600;
const STATUS_ORDER = ['ok', 'damaged', 'critical', 'failed', 'destroyed'];
const statusOf = (D) => (D.destroyed ? 'destroyed' : D.health > 0.72 ? 'ok' : D.health > 0.42 ? 'damaged' : D.health > 0.15 ? 'critical' : 'failed');
export const STATUS_JP = { ok: '正常', damaged: '損傷', critical: '危険', failed: '機能停止', destroyed: '崩壊' };

function rand(a, b) { return a + Math.random() * (b - a); }

let FLASH_TEX = null;
function flashTexture() {
  if (FLASH_TEX) return FLASH_TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.25, 'rgba(255,200,120,0.8)'); gr.addColorStop(0.6, 'rgba(255,110,40,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  FLASH_TEX = new THREE.CanvasTexture(c);
  return FLASH_TEX;
}

let SOOT_TEX = null;
/** soot that fades out irregularly toward its edge (mapped on a flattened sphere: dense at the
 * poles = the middle of the patch, gone at the equator = its rim) */
function sootTexture() {
  if (SOOT_TEX) return SOOT_TEX;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const v = y / 127, u = x / 127;
    const edge = 0.62 + 0.25 * Math.sin(u * 37.7 + Math.sin(u * 91) * 2) * Math.sin(u * 13.1 + 1.7);
    const d = Math.abs(v - 0.5) * 2;                 // 0 at the rim, 1 in the middle
    const a = Math.max(0, Math.min(1, (d - (1 - edge)) / 0.35)) * (0.75 + 0.25 * Math.sin(u * 211 + v * 57));
    const k = (y * 128 + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(a * 255); img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  SOOT_TEX = new THREE.CanvasTexture(c);
  SOOT_TEX.colorSpace = THREE.NoColorSpace;
  return SOOT_TEX;
}

export class WorldDamage {
  constructor(game) {
    this.g = game;
    this.mats = {
      scorch: new THREE.MeshBasicMaterial({ color: 0x0b0806, alphaMap: sootTexture(), transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      petal: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.55, side: THREE.DoubleSide }),
      liner: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.55, side: THREE.DoubleSide }),
      beam: new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.7, roughness: 0.45 }),
      hole: new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }),
      rim: new THREE.MeshStandardMaterial({ color: 0x2b2522, roughness: 0.8, metalness: 0.5, side: THREE.DoubleSide }),
      vent: new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      fire: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.1, 0.3), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
    };
    for (const s of game.stations.list) s.dmg = { health: 1, status: 'ok', hits: [], destroyed: false, t: rand(1.5, 7) * H, dirty: false };
    game.elevator.dmg = { health: 1, status: 'ok', hits: [], destroyed: false, breakH: 0, t: rand(4, 12) * H, dirty: false };
    this.anim = [];   // flashes / fires / vents to animate
  }

  /** all damageable things: the stations and the elevator */
  get targets() { return [...this.g.stations.list, this.g.elevator]; }

  isElevator(t) { return t === this.g.elevator; }

  name(t) { return this.isElevator(t) ? '宇宙エレベーター' : t.name.replace('（修理基地）', ''); }

  /** sim-time step (sleeping speeds it up, offline catch-up runs it in big steps) */
  update(dt) {
    for (const t of this.targets) {
      const D = t.dmg;
      if (D.destroyed) continue;
      D.t -= dt;
      if (D.t <= 0) {
        // stations are big targets: something hits each of them every few hours of game time
        D.t = (this.isElevator(t) ? rand(5, 14) : rand(3, 9)) * H;
        this.strike(t);
      }
      // the crews patch what still has power, slowly
      if (D.status === 'ok' || D.status === 'damaged' || D.status === 'critical') D.health = Math.min(1, D.health + dt * 0.015 / H);
      this.refresh(t);
    }
  }

  /** one asteroid strike (sev 0..1, or random) */
  strike(t, sev = null) {
    const D = t.dmg;
    if (D.destroyed) return;
    if (sev === null) {
      const r = Math.random();
      sev = r < 0.62 ? rand(0.02, 0.08) : r < 0.88 ? rand(0.1, 0.3) : r < 0.986 ? rand(0.3, 0.65) : 1.2;
    }
    D.health -= sev;
    const hit = this.hitPoint(t);
    hit.r = 0.6 + sev * 9;
    hit.sev = sev;
    hit.time = this.g.time;
    D.hits.push(hit);
    if (D.hits.length > 20) D.hits.shift();
    D.lastHit = { sev, time: this.g.time };
    if (this.isElevator(t)) D.hitH = hit.h;
    if (D.health <= 0 || sev >= 1) this.destroy(t);
    else this.dockedBreach(t, sev);
    D.dirty = true;
    const near = this.distTo(t);
    this.announceStrike(t, sev, near);
    if (near < 3.0e4) this.nearbyEffects(t, hit, sev, near);
    this.refresh(t);
  }

  distTo(t) {
    const g = this.g;
    if (this.isElevator(t)) {
      // nearest point of the ribbon
      const ax = t.axis && t.axis.lengthSq() > 0 ? t.axis : new THREE.Vector3(1, 0, 0);
      const r = g.flight.pos.dot(ax);
      return g.flight.pos.clone().sub(ax.clone().multiplyScalar(Math.max(0, r))).length();
    }
    return t.pos.distanceTo(g.flight.pos);
  }

  /** a point on the target's surface (local frame) + outward normal */
  hitPoint(t) {
    if (this.isElevator(t)) return { p: new THREE.Vector3(), n: new THREE.Vector3(1, 0, 0), h: rand(300e3, 30000e3) };
    const P = t.model.userData.proxies;
    const dir = new THREE.Vector3().randomDirection();
    if (P && P.length) {
      const pr = P[Math.floor(Math.random() * P.length)];
      let hp = null;
      if (pr.type === 'sphere') hp = { p: pr.c.clone().addScaledVector(dir, pr.r), n: dir };
      else if (pr.type === 'capsule' || pr.type === 'cyl') {
        const a = pr.a.clone().lerp(pr.b, Math.random());
        const ax = pr.b.clone().sub(pr.a).normalize();
        const n = dir.projectOnPlane(ax).normalize();
        hp = { p: a.addScaledVector(n, pr.r), n };
      } else if (pr.type === 'box') {
        const k = Math.floor(Math.random() * 3), s = Math.random() < 0.5 ? -1 : 1;
        const n = new THREE.Vector3(); n.setComponent(k, s);
        const p = pr.c.clone();
        for (let i = 0; i < 3; i++) p.setComponent(i, p.getComponent(i) + (i === k ? s * pr.h.getComponent(i) : (Math.random() - 0.5) * 2 * pr.h.getComponent(i) * 0.8));
        hp = { p, n };
      }
      if (hp) return this.onSurface(t, hp);
    }
    // relays / the dock: spine along z with the module cluster in the middle
    const sz = t.size || 1;
    const n = dir.projectOnPlane(new THREE.Vector3(0, 0, 1)).normalize();
    return { p: new THREE.Vector3(0, 0, (Math.random() - 0.5) * 30 * sz).addScaledVector(n, 3.4 * sz), n };
  }

  /** move a proxy hit point onto the station's real plating (ray along -n into the model) */
  onSurface(t, hp) {
    try {
      const model = t.model;
      model.updateMatrixWorld(true);
      const skip = model.userData.dmgGroup;
      const meshes = [];
      model.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.geometry && o !== skip && !(skip && skip.getObjectById(o.id))) meshes.push(o); });
      const o = model.localToWorld(hp.p.clone().addScaledVector(hp.n, 40));
      const d = hp.n.clone().transformDirection(model.matrixWorld).negate();
      const rc = new THREE.Raycaster(o, d, 0, 80);
      const hit = rc.intersectObjects(meshes, false)[0];
      if (!hit || !hit.face) return hp;
      const p = model.worldToLocal(hit.point.clone());
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(model.matrixWorld.clone().invert());
      if (n.dot(hp.n) < 0) n.negate();
      return { p, n: n.normalize() };
    } catch (e) { return hp; }
  }

  destroy(t) {
    const D = t.dmg;
    if (D.destroyed) return;
    D.destroyed = true;
    D.health = 0;
    D.destroyedAt = this.g.time;
    if (this.isElevator(t)) D.breakH = D.hitH || rand(500e3, 20000e3);
    D.dirty = true;
    // B-29 docked to it: the lobby is gone in an instant
    const g = this.g, dk = g.docking;
    if (dk && dk.station === t && dk.state !== 'free') {
      const pl = g.player;
      const inside = dk.lobby && dk.lobby.contains(pl.pos) && pl.state !== 'dead';
      dk.forceRelease();
      g.damage.impact(new THREE.Vector3(3.0, 0.5, -1.0), new THREE.Vector3(-1, 0, 0), 2.5e6, { noBreakup: true });
      if (inside) {
        // the lobby is torn away around Kaito: thrown out into vacuum among the wreckage, bruised —
        // a suit keeps him alive (fly back to B-29), without one there is under a minute left
        pl.health = Math.max(0.05, pl.health - 0.3);
        pl.vel.add(new THREE.Vector3().randomDirection().multiplyScalar(1.5)).add(new THREE.Vector3(1.2, 0, 0));
        g.shake = Math.max(g.shake, 3);
        g.asphalt.say(pl.suit ? 'st_gone_suit' : 'st_gone', {}, { force: true });
      }
    }
  }

  /** a strike on the station B-29 is docked to: it may hole one of the pressurised sections */
  dockedBreach(t, sev) {
    const g = this.g, dk = g.docking;
    if (!dk || dk.station !== t || dk.state !== 'docked' || !dk.air) return;
    if (Math.random() > 0.35 + sev * 2.5) return;       // the truss or a tank took it
    const b = dk.air.breach(0.004 + sev * 0.25);
    g.shake = Math.max(g.shake, 0.6 + sev * 3);
    if (g.audio.ready) {
      g.audio.impact(b.p.clone(), Math.min(0.7, 0.25 + sev));
      g.audio._burst(null, { dur: 2.2, freq: 55, q: 0.7, gain: 0.35 + sev * 0.4, type: 'brown', filter: 'lowpass', direct: true });
    }
    g.systems.flicker = 0.5; setTimeout(() => { g.systems.flicker = 0; }, 900 + sev * 2000);
    if (g.gameplay) g.gameplay.raise(0.7 + sev * 0.3);
    const name = dk.air.sec[b.sec].name;
    const here = dk.lobby.sectionAt(g.player.pos);
    setTimeout(() => {
      g.asphalt.say('st_breach', { name: this.name(t), sec: name }, { force: true });
      if (here === b.sec && !g.player.suit) setTimeout(() => g.asphalt.say('st_breach_here', {}, { force: true }), 5000);
      else if (here && here !== b.sec) setTimeout(() => g.asphalt.say('st_sealed', {}, { minGap: 30 }), 6000);
    }, 1500);
    if (b.sec === 'lobby' && g.hatch && g.hatch.open > 0.2) setTimeout(() => g.asphalt.say('st_port_low', {}, { minGap: 60 }), 14000);
  }

  /** status changes: announcements, the ship's alarm when it concerns us */
  refresh(t) {
    const D = t.dmg;
    const st = statusOf(D);
    if (st === D.status) return;
    const worse = STATUS_ORDER.indexOf(st) > STATUS_ORDER.indexOf(D.status);
    D.status = st;
    D.dirty = true;
    if (!worse) return;
    const g = this.g;
    if (!g.asphalt || !g.running) return;
    const near = this.distTo(t) < 2.0e5 || (g.docking && g.docking.station === t) || (g.autopilot.target === t);
    const key = { damaged: 'w_damaged', critical: 'w_critical', failed: 'w_failed', destroyed: 'w_destroyed' }[st];
    if (key && (near || st === 'destroyed' || st === 'failed')) g.asphalt.say(this.isElevator(t) ? key + '_el' : key, { name: this.name(t) }, { force: st === 'destroyed', minGap: 20 });
    if (near && g.gameplay && (st === 'critical' || st === 'failed' || st === 'destroyed')) g.gameplay.raise(st === 'destroyed' ? 0.9 : 0.6);
    // a failed station cannot hold a docked ship: crew evacuates, Asphalt keeps the berth only
    if (st === 'failed' && g.docking && g.docking.station === t && g.docking.state === 'docked') g.asphalt.say('w_berth_dark', {}, { minGap: 60 });
  }

  announceStrike(t, sev, near) {
    const g = this.g;
    if (!g.asphalt || !g.running) return;
    const close = near < 2.0e5 || (g.docking && g.docking.station === t) || g.autopilot.target === t;
    if (sev >= 0.3 || (close && sev >= 0.08)) g.asphalt.say(this.isElevator(t) ? 'w_hit_el' : (sev >= 0.3 ? 'w_hit_big' : 'w_hit'), { name: this.name(t) }, { minGap: 30 });
  }

  /** seen from up close: flash, fireball, debris; heard when very near */
  nearbyEffects(t, hit, sev, dist) {
    const g = this.g;
    if (this.isElevator(t)) return;
    const grp = this.groupFor(t);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.position.copy(hit.p).addScaledVector(hit.n, 1);
    flash.layers.set(LAYER_MID); flash.layers.enable(LAYER_NEAR); flash.layers.enable(LAYER_FAR);
    flash.scale.setScalar(8 + sev * 120);
    grp.add(flash);
    this.anim.push({ o: flash, kind: 'flash', t: 0, life: 1.6 + sev * 2, s0: flash.scale.x });
    // torn-off plating, insulation foil and frame scraps blown out of the hole
    if (!this.shards) {
      this.shards = Array.from({ length: 8 }, (_, i) => shardGeometry(i * 7.31 + 1.3));
      this.foil = new THREE.MeshStandardMaterial({ color: 0xd8a640, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide });
    }
    for (let k = 0; k < 10 + sev * 40; k++) {
      const kind = Math.random();
      const sz = rand(0.3, 1.8) * (0.6 + sev);
      const m = kind < 0.6 ? new THREE.Mesh(this.shards[k % this.shards.length], this.mats.petal)
        : kind < 0.85 ? new THREE.Mesh(this.shards[(k + 3) % this.shards.length], this.foil)
        : new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, rand(0.6, 2.2)), this.mats.beam);
      if (kind < 0.85) m.scale.set(sz, sz, sz);
      m.quaternion.random();
      m.position.copy(hit.p);
      grp.add(m);
      const v = hit.n.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.8)).normalize().multiplyScalar(rand(4, 25) * (0.5 + sev));
      this.anim.push({ o: m, kind: 'debris', t: 0, life: 40, v, w: new THREE.Vector3().randomDirection().multiplyScalar(rand(0.5, 3)) });
    }
    if (dist < 6000) {
      g.audio.impact(new THREE.Vector3(0, 0, -30), Math.min(0.6, 0.15 + sev * 0.6) * Math.max(0.2, 1 - dist / 6000));
      g.shake = Math.max(g.shake, Math.min(0.6, sev * (1 - dist / 6000)));
    }
    if (g.gameplay && dist < 3.0e4) g.gameplay.raise(0.4 + 0.4 * Math.min(1, sev * 2));
  }

  groupFor(t) {
    let grp = t.model.userData.dmgGroup;
    if (!grp) {
      grp = new THREE.Group();
      t.model.add(grp);
      t.model.userData.dmgGroup = grp;
      grp.userData.static = new THREE.Group();
      grp.add(grp.userData.static);
    }
    return grp;
  }

  /** rebuild the persistent damage dressing of a visible station (scorch, holes, vents, fires) */
  dress(t) {
    const D = t.dmg;
    const grp = this.groupFor(t);
    const S = grp.userData.static;
    for (const c of [...S.children]) { S.remove(c); if (c.geometry) c.geometry.dispose(); }
    const M = this.mats, up = new THREE.Vector3(0, 1, 0);
    const fresh = (h) => this.g.time - h.time < 3 * H * 1000;
    for (const h of D.hits) {
      const q = new THREE.Quaternion().setFromUnitVectors(up, h.n);
      const sc = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), M.scorch);
      sc.position.copy(h.p).addScaledVector(h.n, 0.05);
      sc.quaternion.copy(q);
      sc.scale.set(h.r * 1.8, 0.04, h.r * 1.8);
      S.add(sc);
      if (h.sev >= 0.08) {
        // a real tear: a jagged black opening, the plating peeled back round it in torn,
        // crumpled, scorched petals, insulation foil bursting out of the gap, and in bigger
        // holes the bent frame members across it
        const seed = h.seed ?? (h.seed = Math.random() * 100);
        const R = h.r * 0.42;
        const pts = [];
        for (let k = 0; k < 64; k++) { const a = k / 64 * Math.PI * 2; const r = R * outlineF(a, seed); pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r)); }
        // (the outline frame of tornMetal: u = n x up)
        const u = new THREE.Vector3().crossVectors(h.n, Math.abs(h.n.y) < 0.9 ? up : new THREE.Vector3(1, 0, 0)).normalize();
        const v = new THREE.Vector3().crossVectors(h.n, u);
        const hole = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)), M.hole);
        hole.matrix.makeBasis(u, v, h.n).setPosition(h.p.clone().addScaledVector(h.n, 0.04));
        hole.matrixAutoUpdate = false;
        S.add(hole);
        // (seeded: the dressing is rebuilt whenever anything changes and must come out the same)
        let rs = Math.floor(seed * 1e4) % 233280;
        const rnd = () => { rs = (rs * 9301 + 49297) % 233280; return rs / 233280; };
        const blown = rnd() < 0.65;   // the air inside blew the plating out
        S.add(new THREE.Mesh(petalGeometry({ c: h.p.clone().addScaledVector(h.n, 0.05), n: h.n, R, seed, travel: blown ? h.n : h.n.clone().negate(), paint: 'station', bend: blown ? 1.5 + rnd() * 0.8 : 0.9, lenK: 0.95 }), M.petal));
        S.add(new THREE.Mesh(linerGeometry({ c: h.p.clone().addScaledVector(h.n, 0.03), n: h.n.clone().negate(), R: R * 0.98, seed, gap: R * 0.22, innerK: 0.78 }), M.liner));
        if (h.sev >= 0.25) {
          for (let k = 0; k < 2 + Math.floor(h.sev * 3); k++) {
            const a = rnd() * Math.PI * 2, a2 = a + Math.PI + (rnd() - 0.5) * 0.8;
            const e0 = h.p.clone().addScaledVector(u, Math.cos(a) * R * 0.95).addScaledVector(v, Math.sin(a) * R * 0.95);
            const e1 = h.p.clone().addScaledVector(u, Math.cos(a2) * R * 0.95).addScaledVector(v, Math.sin(a2) * R * 0.95);
            const mid = e0.clone().lerp(e1, 0.3 + rnd() * 0.4).addScaledVector(h.n, R * (0.1 + rnd() * 0.35));
            const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([e0, mid, e1]), 12, R * 0.035, 5, false);
            S.add(new THREE.Mesh(tg, M.beam));
          }
        }
        if (!D.destroyed && (fresh(h) || D.status === 'critical')) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(h.r * 1.4, h.r * 7, 16, 1, true), M.vent);
          cone.position.copy(h.p).addScaledVector(h.n, h.r * 3.5);
          cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), h.n);
          S.add(cone);
          this.anim.push({ o: cone, kind: 'vent', t: Math.random() * 10, life: Infinity, static: true });
        }
      }
      if (!D.destroyed && h.sev >= 0.25 && (fresh(h) || D.status !== 'ok')) {
        // something burning inside the module: a flickering orange glow deep in the hole (in
        // vacuum there are no flames outside — only what still has air and power burns within)
        const R = h.r * 0.42;
        const u = new THREE.Vector3().crossVectors(h.n, Math.abs(h.n.y) < 0.9 ? up : new THREE.Vector3(1, 0, 0)).normalize();
        const v = new THREE.Vector3().crossVectors(h.n, u);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.3, R * 1.3), new THREE.MeshBasicMaterial({ map: flashTexture(), color: new THREE.Color(1.5, 0.45, 0.1), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.matrix.makeBasis(u, v, h.n).setPosition(h.p.clone().addScaledVector(h.n, 0.06));
        glow.matrixAutoUpdate = false;
        S.add(glow);
        this.anim.push({ o: glow, kind: 'fire', t: Math.random() * 10, life: Infinity, static: true });
      }
    }
    // a wreck: the structure is gone, a debris field drifts where it was
    const keep = new Set([grp]);
    for (const ch of t.model.children) if (!keep.has(ch)) ch.visible = !D.destroyed;
    if (D.destroyed && !grp.userData.wreck) this.buildWreck(t, grp);
    D.dirty = false;
    D.dressedFor = D.hits.length + (D.destroyed ? 100 : 0) + STATUS_ORDER.indexOf(D.status) * 1000;
  }

  buildWreck(t, grp) {
    const M = this.g.stations.M;
    const W = new THREE.Group();
    grp.add(W);
    grp.userData.wreck = W;
    const P = t.model.userData.proxies || [{ type: 'capsule', a: new THREE.Vector3(0, 0, -40), b: new THREE.Vector3(0, 0, 40), r: 4 }];
    const keys = ['hull', 'hullDark', 'solarPanel', 'metalDark', 'mli'];
    let n = 0;
    for (const pr of P) {
      const seg = pr.type === 'capsule' || pr.type === 'cyl';
      if (!seg && pr.type !== 'sphere' && pr.type !== 'box') continue;
      const c = seg ? pr.a.clone().lerp(pr.b, 0.5) : pr.c;
      const span = pr.type === 'sphere' ? pr.r : seg ? pr.a.distanceTo(pr.b) / 2 + pr.r : pr.h.length();
      for (let k = 0; k < 3; k++) {
        const s = rand(0.3, 1) * Math.min(14, span * 0.6 + 1);
        const geo = Math.random() < 0.5 ? new THREE.BoxGeometry(s, s * rand(0.2, 0.8), s * rand(0.4, 1.4)) : new THREE.CylinderGeometry(s * 0.4, s * 0.45, s * 1.4, 10, 1, true);
        const m = new THREE.Mesh(geo, M[keys[(n + k) % keys.length]] || M.hull);
        m.position.copy(c).add(new THREE.Vector3().randomDirection().multiplyScalar(rand(0, span)));
        m.quaternion.random();
        W.add(m);
        this.anim.push({ o: m, kind: 'drift', t: 0, life: Infinity, v: m.position.clone().sub(c).normalize().multiplyScalar(rand(0.2, 1.4)), w: new THREE.Vector3().randomDirection().multiplyScalar(rand(0.02, 0.2)), static: true });
      }
      n++;
    }
    const SM = this.g.stations.SM;
    const drift = (m, v, w) => { W.add(m); this.anim.push({ o: m, kind: 'drift', t: 0, life: Infinity, v, w: new THREE.Vector3().randomDirection().multiplyScalar(w), static: true }); };
    // the habitat ring torn into arcs that tumble away from the hub
    const ring = t.model.userData.ring;
    if (ring) {
      const sz = new THREE.Box3().setFromObject(ring).getSize(new THREE.Vector3());
      const R = Math.max(sz.x, sz.y) / 2 * 0.93, tube = R * 0.055;
      const n0 = 4 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n0; k++) {
        const arc = rand(0.35, 1.0), a0 = k / n0 * Math.PI * 2 + rand(-0.25, 0.25);
        const m = new THREE.Mesh(new THREE.TorusGeometry(R, tube, 8, 28, arc), M.hull);
        const out = new THREE.Vector3(Math.cos(a0 + arc / 2), Math.sin(a0 + arc / 2), rand(-0.2, 0.2)).normalize();
        m.position.copy(ring.position).addScaledVector(out, rand(3, 18));
        m.rotation.set(rand(-0.35, 0.35), rand(-0.35, 0.35), a0);
        drift(m, out.clone().multiplyScalar(rand(0.4, 1.5)), rand(0.01, 0.05));
        // the spoke stub still hanging on
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.018, R * 0.018, R * rand(0.2, 0.5), 8), M.hullDark || M.hull);
        sp.position.set(Math.cos(arc / 2) * R * 0.8, Math.sin(arc / 2) * R * 0.8, 0);
        sp.rotation.z = arc / 2 - Math.PI / 2;
        m.add(sp);
      }
    }
    // snapped truss beams and solar wings
    for (let k = 0; k < 8; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(rand(0.8, 1.6), rand(0.8, 1.6), rand(12, 38)), M.hullDark || M.hull);
      m.position.set(rand(-25, 25), rand(-25, 25), rand(-80, 80));
      m.quaternion.random();
      drift(m, new THREE.Vector3().randomDirection().multiplyScalar(rand(0.2, 0.9)), rand(0.01, 0.08));
    }
    for (let k = 0; k < 7; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(rand(6, 16), 0.12, rand(3, 7)), SM.solarPanel);
      m.position.set(rand(-45, 45), rand(-30, 30), rand(-70, 70));
      m.quaternion.random();
      drift(m, new THREE.Vector3().randomDirection().multiplyScalar(rand(0.3, 1.2)), rand(0.02, 0.15));
    }
    for (let k = 0; k < 60; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(rand(0.3, 2), rand(0.1, 0.5), rand(0.3, 2.5)), M[keys[k % keys.length]] || M.hull);
      m.position.set(rand(-60, 60), rand(-30, 30), rand(-90, 90));
      m.quaternion.random();
      W.add(m);
      this.anim.push({ o: m, kind: 'drift', t: 0, life: Infinity, v: new THREE.Vector3().randomDirection().multiplyScalar(rand(0.1, 1)), w: new THREE.Vector3().randomDirection().multiplyScalar(rand(0.05, 0.4)), static: true });
    }
  }

  /** per render frame: dress visible stations, animate flashes / fires / vents / debris */
  updateVisual(dt) {
    for (const s of this.g.stations.list) {
      const D = s.dmg;
      if (!s.model.visible || !D) continue;
      const key = D.hits.length + (D.destroyed ? 100 : 0) + STATUS_ORDER.indexOf(D.status) * 1000;
      if (D.dirty || D.dressedFor !== key) this.dress(s);
    }
    const tt = performance.now() / 1000;
    this.anim = this.anim.filter((a) => {
      a.t += dt;
      const o = a.o;
      if (!o.parent) return false;
      if (a.kind === 'flash') {
        const k = a.t / a.life;
        o.material.opacity = Math.max(0, 1 - k);
        o.scale.setScalar(a.s0 * (1 + k * 2));
      } else if (a.kind === 'debris' || a.kind === 'drift') {
        const v = a.kind === 'drift' ? a.v.clone().multiplyScalar(Math.max(0, 1 - a.t / 3600)) : a.v;
        o.position.addScaledVector(v, dt);
        o.rotation.x += a.w.x * dt; o.rotation.y += a.w.y * dt; o.rotation.z += a.w.z * dt;
      } else if (a.kind === 'fire') {
        o.material.opacity = Math.max(0.08, 0.36 + 0.18 * Math.sin(tt * 13 + a.t * 3) + 0.12 * Math.sin(tt * 31 + a.t) + 0.08 * Math.sin(tt * 4.3));
      } else if (a.kind === 'vent') {
        o.scale.set(1, 0.8 + 0.25 * Math.sin(tt * 9 + a.t), 1);
      }
      if (a.t > a.life) { o.parent.remove(o); return false; }
      return true;
    });
  }

  serialize() {
    const pack = (t) => ({ h: +t.dmg.health.toFixed(4), d: t.dmg.destroyed ? 1 : 0, t: Math.round(t.dmg.t), bh: t.dmg.breakH || 0, hits: t.dmg.hits.map((h) => ({ p: h.p.toArray().map((v) => +v.toFixed(2)), n: h.n.toArray().map((v) => +v.toFixed(3)), r: +h.r.toFixed(2), s: +h.sev.toFixed(3), time: h.time, hh: h.h || 0 })) });
    const out = { el: pack(this.g.elevator) };
    for (const s of this.g.stations.list) out[s.id] = pack(s);
    return out;
  }

  restore(d) {
    if (!d) return;
    const un = (t, o) => {
      if (!o) return;
      const D = t.dmg;
      D.health = o.h; D.destroyed = !!o.d; D.t = o.t || D.t; D.breakH = o.bh || 0;
      D.hits = (o.hits || []).map((h) => ({ p: new THREE.Vector3(...h.p), n: new THREE.Vector3(...h.n), r: h.r, sev: h.s, time: h.time, h: h.hh }));
      D.status = statusOf(D);
      D.dirty = true;
    };
    un(this.g.elevator, d.el);
    for (const s of this.g.stations.list) un(s, d[s.id]);
  }
}
