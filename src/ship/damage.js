// Damage model: hull dents (exterior and interior walls deform), hull breaches with torn metal
// and air leaks, cracked windows, pipe leaks, equipment faults. Damage worsens over time and
// spreads (metal fatigue); only the very smallest damage can be fixed on board — everything else
// stays and gets worse until the repair dock. A structural integrity figure sums it all up: when
// it runs out (or one impact is simply too big) the hull breaks apart.
import * as THREE from 'three';
import { shipUniforms, MAX_DENTS, MAX_PEEL, MAX_BREACH, dentData, followDents } from './materials.js';
import { glassUniforms } from './glass.js';
import { OPENINGS, HULL, sectionPoint, sectionNormal, tForPoint, canopyF, halfWidthAt, heightRangeAt, DECK_Y } from './hullShape.js';
import { PIPE_SYSTEMS } from './underfloor.js';
import { setLayersDeep, LAYER_NEAR, LAYER_MID } from '../core/layers.js';
import { petalGeometry, linerGeometry, cableCurves, patchPlate, holeFrame } from './tornMetal.js';
import { CrackAtlas } from './glassCracks.js';
import { crackPaths, crackGeometry, stressPoint } from './wallCracks.js';
import { Pockmarks } from '../combat/pockmarks.js';
import { rng } from './geom.js';
import { addDisplayCut } from './b29Display.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// The outer skin is riveted panels, 1.2 x 0.6 m, staggered row by row (the grid the hull's surface
// detail draws), laid out in whichever ship plane the skin there faces most. The belly is
// covered in 16 cm heat-shield tiles instead.
const PANEL = { w: 1.2, h: 0.6 };
const keyHash = (k) => { let h = 2166136261; for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; };

// what Kaito can still fix himself (anything bigger is beyond a repair kit)
export const FIXABLE = { breach: 0.012, crack: 0.3, pipe: 0.15, equip: 0.12, fracture: 0.15 };
const BREAKUP_ENERGY = 6e7;   // J: a single impact that tears the ship apart outright

export const EQUIPMENT = {
  servers: { name: 'サーバー', pos: V(-1.5, 1.0, 6.5), zone: 'eng' },
  comms: { name: '5G通信アンテナ', pos: V(0, 2.7, -2.8), zone: null, ext: true },
  sensors: { name: 'レーダー', pos: V(0, -2.3, -8.0), zone: null, ext: true },
  o2gen: { name: '酸素生成器', pos: V(2.3, 0.9, 3.0), zone: 'ls' },
  scrubber: { name: 'CO2除去装置', pos: V(2.1, 0.8, 1.5), zone: 'ls' },
  fans: { name: '換気ファン', pos: V(1.2, 2.2, 3.0), zone: 'ls' },
  power: { name: '配電盤', pos: V(1.7, 1.0, 6.9), zone: 'eng' },
  reactor: { name: '原子炉', pos: V(0, 0.4, 13.0), zone: null, ext: true },
  engine: { name: 'メインエンジン', pos: V(0, 0.4, 16.5), zone: null, ext: true },
  rcs: { name: '姿勢制御スラスター', pos: V(0, 2.0, -7.6), zone: null, ext: true },
  lift: { name: '昇降機', pos: V(1.5, -0.6, -3.75), zone: 'corridor' },
  coffee: { name: 'コーヒーメーカー', pos: V(-1.55, 1.1, -3.36), zone: 'living' },
  lights: { name: '照明回路', pos: V(0, 2.4, -2), zone: 'corridor' },
};

export class Damage {
  constructor(game) {
    this.g = game;
    this.dents = [];      // {pos, dir, r, r0, depth, sharp, heat, seed}
    this.peels = [];      // skin panels torn (half) off, holes torn in them, tiles knocked off
    this.panelHits = new Map();   // the blows each panel has taken (J): its fasteners give in the end
    this.breaches = [];   // {id, pos, n, r, zone, area, leak, patched, sev, meshes}
    this.cracks = OPENINGS.map(() => null); // per opening index: {u,v,sev,seed,patched}
    this.canopyCrack = null;
    this.issues = [];     // active problems for UI + repairs
    this.health = { servers: 1, comms: 1, sensors: 1, o2gen: 1, scrubber: 1, fans: 1, power: 1, reactor: 1, engine: 1, rcs: 1, lift: 1, coffee: 1, lights: 1, cameras: [1, 1, 1, 1, 1] };
    this.scorch = [];
    this.fractures = [];  // fatigue cracks in the cabin wall
    this.nextId = 1;
    this.stress = 0;
    this.group = new THREE.Group();
    game.shipVis.root.add(this.group);
    this.events = [];
    // bullet strikes on the outside (their wear counts against the structure)
    this.pocks = new Pockmarks(game.shipVis.root, 360, [LAYER_NEAR, LAYER_MID]);
    followDents(this.pocks.mesh.material);     // (they sink with the dents they lie in)
    this.shotWear = 0;
  }

  // ------------------------------------------------------------------ impacts
  /**
   * pLocal: impact point on the hull (ship-local), dirLocal: direction of travel of the projectile,
   * energy: kinetic energy (J)
   */
  impact(pLocal, dirLocal, energy, opts = {}) {
    const g = this.g;
    const E = Math.max(1, energy);
    const big = E > 5e5;
    // (a blow worked out from the collision spheres lands on the skin itself)
    if (opts.snap) pLocal = this.snapToSkin(pLocal);
    // dent: radius & depth from energy
    const r = Math.min(1.6, 0.08 + 0.025 * Math.cbrt(E / 1000));
    const depth = Math.min(0.34, 0.015 + 0.007 * Math.cbrt(E / 1000));
    const inward = dirLocal.clone().normalize();
    // the skin there, facing out: a dent goes in mostly square to it, a little the way the blow went
    const nOut = this.skinNormal(pLocal, opts.normal, inward);
    const push = nOut.clone().multiplyScalar(-0.75).addScaledVector(inward, 0.25).normalize();
    // the skin is weaker where it is already dented (or shot full of holes): hit after hit on one
    // spot goes through
    let old = 0;
    for (const d of this.dents) if (d.pos.distanceTo(pLocal) < Math.max(d.r, 0.3)) old = Math.max(old, d.depth);
    const weak = Math.min(0.8, this.dentCount(pLocal, 0.6) * 0.15 + 0.7 * Math.min(1, old / 0.45) + this.pocks.countNear(pLocal, 0.35) * 0.1);
    if (opts.shot && E < 1e6) {
      // a gun round: a pit and a splash of soot where it struck, the skin punched in round it (a
      // small sharp crater with its lip thrown up, glowing for a moment); the wear adds up
      this.pocks.add(pLocal, opts.normal || nOut, 0.2 + 0.07 * Math.cbrt(E / 1e5));
      this.shotWear += E / 1e8;
      const k = Math.cbrt(E / 1000);
      this.addDent(pLocal, push, 0.045 + 0.016 * k, 0.004 + 0.0032 * k, { sharp: 1, heat: Math.min(1, 0.45 + E / 5e5) });
    } else {
      this.addDent(pLocal, push, r, depth, { sharp: E < 2e6 ? 0.4 : 0.15, heat: Math.min(1, 0.3 + E / 4e6) });
      this.addScorch(pLocal, r * 0.8);
    }
    // the skin's panels (the belly's tiles) round it: loosened, torn half off, torn away
    if (!opts.noPanels) this.panelBlow(pLocal, nOut, inward, E, r);
    // breach?
    const pen = E / (3e5 * (1 - weak));
    const zone = this.zoneForHullPoint(pLocal);
    let breach = null;
    if (pen > 1 && zone) {
      const holeR = Math.min(0.5, 0.008 * Math.pow(pen, 0.6) + 0.004);
      breach = this.addBreach(pLocal, inward.clone().negate(), holeR, zone);
    }
    // windows nearby crack
    OPENINGS.forEach((o, i) => {
      if (o.kind !== 'win') return;
      const d = o.center.distanceTo(pLocal);
      if (d < r * 3 + 0.8) {
        const sev = Math.min(2, (E / 2e5) / (1 + d * 2));
        if (sev > 0.05) this.crackWindow(i, pLocal, sev);
      }
    });
    // the nose and its cameras: the cockpit's screen tears where it was hit
    if (pLocal.z < -10.6 && g.b29Display) g.b29Display.hit(pLocal, E);
    // equipment & pipes near the impact (a gun round that stays in the skin only hurts what is
    // mounted outside; through the skin, it hurts what lies behind)
    const shotOnly = opts.shot && !breach;
    for (const [k, eq] of Object.entries(EQUIPMENT)) {
      if (shotOnly && !eq.ext) continue;
      const d = eq.pos.distanceTo(pLocal);
      const reach = opts.shot ? r + 0.8 : r * 2 + (big ? 3.0 : 1.2);
      if (d < reach) {
        const dmg = Math.min(0.9, (E / 4e5) * (1 - d / reach) * (0.5 + Math.random()));
        if (dmg > 0.03) this.damageEquipment(k, dmg, pLocal);
      }
    }
    for (const s of g.layout.pipes) {
      if (shotOnly) break;
      const d = s.mid.distanceTo(pLocal);
      const reach = r + (big ? 2.4 : 1.0);
      if (d < reach && Math.random() < 0.6) {
        const sev = Math.min(1, (E / 3e5) * (1 - d / reach) * (0.4 + Math.random()));
        if (sev > 0.04) this.pipeLeak(s, sev);
      }
    }
    // the blow cracks the cabin wall round the impact (the bigger, the longer the cracks)
    if (E > 2.5e5 && !opts.noFracture) {
      const n = E > 2e6 ? 2 : 1;
      for (let k = 0; k < n; k++) this.addFracture(pLocal, null, Math.min(0.6, 0.06 + E / 5e6), 0.4 + Math.min(1.2, E / 3e6));
    }
    // loose items fly, ship kicks, shake
    const kick = inward.clone().multiplyScalar(Math.min(4, Math.sqrt(E) / 900));
    g.phys.kick(kick, Math.min(6, Math.sqrt(E) / 400), pLocal, Math.min(0.9, E / 2e6));
    // gunfire: many small blows — each one a hard knock, but they do not pile up into an earthquake
    g.player.vel.addScaledVector(kick, opts.shot ? -0.3 : -0.9);
    if (opts.shot) g.shake = Math.min(3, Math.max(g.shake, 0.3 + Math.log10(E) * 0.12));
    else g.shake = Math.min(3, g.shake + 0.4 + Math.log10(E) * 0.25);
    if (g.flight) {
      const dvShip = inward.clone().applyQuaternion(g.flight.quat).multiplyScalar(Math.sqrt(E * 2 * 1) / Math.sqrt(42000 * 42000) * 2);
      g.flight.vel.add(dvShip);
      g.flight.wRel.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(Math.min(0.1, Math.sqrt(E) / 30000)));
    }
    // fx & sound
    const fx = g.fx;
    if (fx) {
      fx.burst('spark', pLocal, inward.clone().negate(), 30 + Math.min(200, E / 5000), { speed: 4 });
      fx.burst('debris', pLocal, inward.clone().negate(), 10 + Math.min(80, E / 20000), { speed: 2.5, spread: 1.2 });
      if (breach) fx.burst('ice', pLocal, inward.clone().negate(), 40, { speed: 6 });
    }
    g.audio.impact(pLocal, Math.min(1, Math.log10(E) / 7) * (opts.shot ? 0.6 : 1));
    g.systems.flicker = Math.min(0.5, 0.15 + E / 2e6);
    setTimeout(() => { g.systems.flicker = 0; }, 900 + Math.min(4000, E / 500));
    g.engine.grade.set('uFlash', Math.min(0.6, E / 3e6));
    this.events.push({ type: 'impact', E, breach: !!breach, zone, pos: pLocal.clone(), shot: !!opts.shot });
    this.stress += E / 1e6;
    this.fatigue = (this.fatigue || 0) + E / 4e8;
    // far too much energy for the frame: the ship comes apart right away
    if (E > BREAKUP_ENERGY && !this.broken && g.gameplay && !opts.noBreakup) { this.broken = true; setTimeout(() => g.gameplay.breakup('impact'), 60); }
    return { breach, zone };
  }

  dentCount(p, rad) { return this.dents.filter((d) => d.pos.distanceTo(p) < rad).length; }

  /** a fatigue crack in the cabin wall from p0 (on/near the inner wall) */
  addFracture(p0, dir, sev, len = null, seed = null, restoring = false) {
    if (this.fractures.length >= 16) {
      // the wall is already full of cracks: the nearest one runs on instead
      const f = this.fractures.reduce((a, b) => (a.p0.distanceTo(p0) < b.p0.distanceTo(p0) ? a : b));
      f.issue.sev = Math.min(1, f.issue.sev + sev * 0.5);
      return f;
    }
    seed = seed ?? Math.random() * 1000;
    len = len ?? 0.4 + Math.random() * 0.9;
    const paths = crackPaths(p0, seed, { dir, len });
    const a = paths[0][0];
    const inRoom = a.p.clone().addScaledVector(a.n, -0.35);
    const zone = this.g.lifeSupport.zoneAt(inRoom);
    const f = { p0: p0.clone(), dir: dir ? dir.clone() : null, len, seed, paths, sev, zone, sealed: false, mesh: null, builtSev: -1 };
    f.issue = this.addIssue({ kind: 'fracture', ref: f, zone, pos: inRoom, sev, repairable: sev < FIXABLE.fracture, name: '壁の亀裂' });
    this.fractures.push(f);
    this._fractureMesh(f);
    if (!restoring) this.events.push({ type: 'fracture', zone, pos: a.p.clone() });
    return f;
  }

  _fractureMesh(f) {
    const T = this._tornMats();
    if (f.mesh) { this.group.remove(f.mesh); f.mesh.geometry.dispose(); }
    f.mesh = new THREE.Mesh(crackGeometry(f.paths, f.sev, f.seed, f.sealed), T.crack);
    f.mesh.matrixAutoUpdate = false; f.mesh.updateMatrix();
    setLayersDeep(f.mesh, LAYER_NEAR);
    this.group.add(f.mesh);
    f.builtSev = f.sev;
  }

  zoneForHullPoint(p) {
    // project slightly inward and classify
    const n = new THREE.Vector3(p.x, p.y - 0.4, 0);
    if (n.lengthSq() < 1e-6) n.set(0, 1, 0);
    const inner = p.clone().addScaledVector(n.normalize(), -0.45);
    const ls = this.g.lifeSupport;
    if (p.z > 9.6 || p.z < HULL.zTip) return null;
    return ls.zoneAt(inner);
  }

  /** o: { sharp (0 a broad bowl .. 1 a punched crater), heat (the glow of a fresh strike) } */
  addDent(pos, dir, r, depth, o = {}) {
    const sharp = o.sharp ?? 0, heat = o.heat ?? 0;
    // the same spot again: deeper and a little wider — but a dent never spreads past half again
    // its first size (blow after blow on one spot goes through, it does not swallow the hull)
    const ex = this.dents.find((d) => d.pos.distanceTo(pos) < Math.max(d.r, r) * 0.6);
    if (ex) {
      const r0 = ex.r0 || ex.r;
      ex.depth = Math.min(0.45, Math.max(ex.depth, r0 * 0.7), ex.depth + depth * 0.6);
      ex.r = Math.min(Math.max(r0 * 1.5, r), Math.max(ex.r, r * 1.04));
      ex.sharp = ((ex.sharp || 0) * ex.r + sharp * r) / (ex.r + r);
      ex.heat = Math.max(ex.heat || 0, heat);
    } else {
      if (this.dents.length >= MAX_DENTS) {
        // the hull is covered in them: the least of them gives way to the new one
        let iMin = 0, vMin = Infinity;
        this.dents.forEach((d, i) => { const v = d.depth * d.r * d.r; if (v < vMin) { vMin = v; iMin = i; } });
        this.dents.splice(iMin, 1);
      }
      this.dents.push({ pos: pos.clone(), dir: dir.clone().normalize(), r, r0: r, depth, sharp, heat, seed: Math.random() * 6.28 });
    }
    this.syncDents();
  }

  /** the nearest point of the skin (by its cross-section at that station) */
  snapToSkin(p) {
    const z = Math.max(HULL.zTip + 0.3, Math.min(HULL.zTail1 - 0.05, p.z));
    return sectionPoint(z, tForPoint(z, p.x, p.y, 0), 0);
  }

  /** the skin's outward normal at p (given: the surface normal a ray found there) */
  skinNormal(p, given = null, inward = null) {
    if (given) { const n = given.clone().normalize(); if (inward && n.dot(inward) > 0) n.negate(); return n; }
    if (p.z > HULL.zTip + 0.3 && p.z < HULL.zTail1) return sectionNormal(p.z, tForPoint(p.z, p.x, p.y, 0), 0);
    return inward ? inward.clone().negate() : V(0, 1, 0);
  }

  // ------------------------------------------------------------------ the skin's panels
  /** the panel under p (outward normal n): its plane, its rectangle in that plane, its key */
  panelAt(p, n) {
    const ax = Math.abs(n.x) > Math.abs(n.y) && Math.abs(n.x) > Math.abs(n.z) ? 0 : Math.abs(n.y) > Math.abs(n.z) ? 1 : 2;
    const side = Math.sign(ax === 0 ? n.x : ax === 1 ? n.y : n.z) || 1;
    const u = ax === 0 ? p.z : p.x, v = ax === 0 ? p.y : ax === 1 ? p.z : p.y;
    const row = Math.floor(v / PANEL.h);
    const off = (((row % 2) + 2) % 2) * PANEL.w / 2;
    const col = Math.floor((u - off) / PANEL.w);
    return { ax, side, plane: ax === 0 ? p.x : ax === 1 ? p.y : p.z, u0: col * PANEL.w + off, u1: (col + 1) * PANEL.w + off, v0: row * PANEL.h, v1: (row + 1) * PANEL.h, key: `${ax}${side}:${col}:${row}` };
  }

  /** a point of the skin at (u, v) in a panel's plane */
  skinPoint(pe, u, v, out = new THREE.Vector3()) {
    if (pe.ax === 0) { const w = halfWidthAt(u, v, 0); return out.set(pe.side * (w > 0 ? w : Math.abs(pe.plane)), v, u); }
    if (pe.ax === 1) { const yy = heightRangeAt(v, u, 0); const y = pe.side > 0 ? yy[1] : yy[0]; return out.set(u, Number.isFinite(y) ? y : pe.plane, v); }
    return out.set(u, v, pe.plane);
  }

  /** may this panel come off? (not round the windows, hatches and the port, which are framed in
   * heavy rings, nor on the canopy, the nose cone or the tail) */
  panelFree(pe) {
    if (pe.ax === 2) return false;
    const c = this.skinPoint(pe, (pe.u0 + pe.u1) / 2, (pe.v0 + pe.v1) / 2);
    if (c.z < -11.8 || c.z > 9.8 || canopyF(c) > -0.6) return false;
    for (const o of OPENINGS) if (o.center.distanceTo(c) < Math.max(o.halfW, o.halfH) + 0.85) return false;
    return true;
  }

  /**
   * A blow on the skin: it adds to what the panel there has taken. Enough of it and the panel's
   * fasteners give — it is torn half off, bent out on the edge still holding (and the bay under
   * it shows), and the next blows rip it away to tumble off into space. One big blow tears a
   * jagged hole straight through it; a bigger one throws the whole panel off and loosens the
   * ones round it. On the belly the heat-shield tiles are knocked off instead.
   */
  panelBlow(p, n, travel, E, r, spread = true) {
    if (p.z < -12.4 || p.z > 10.2) return;
    if (p.y < -1.15 && n.y < -0.55) { this.knockTiles(p, n, travel, E); return; }
    const pan = this.panelAt(p, n);
    if (!this.panelFree(pan)) return;
    const hits = (this.panelHits.get(pan.key) || 0) + E;
    this.panelHits.set(pan.key, hits);
    if (this.panelHits.size > 160) this.panelHits.delete(this.panelHits.keys().next().value);
    const hold = 5.5e5 * (0.75 + 0.5 * keyHash(pan.key));      // what its fasteners take
    let pe = this.peels.find((x) => x.key === pan.key);
    if (pe && pe.style === 0 && !pe.flap) { pe.heat = Math.max(pe.heat, 0.4); this.syncDents(); }
    else if (E > 2.5e6 || hits > hold * 2.4) {
      // (a hole torn in it: now the whole panel goes, along its seams)
      if (pe && pe.style === 1) { Object.assign(pe, { u0: pan.u0, u1: pan.u1, v0: pan.v0, v1: pan.v1 }); this.peelFrame(pe); }
      this.panelGone(pe || this.newPeel(pan, 0), travel);
    }
    else if (!pe && E > 1.2e6) {
      // a jagged hole torn through it, round where it struck
      const hu = Math.min(0.55, 0.22 + 0.1 * Math.cbrt(E / 1e6)), hv = hu * 0.7;
      const u = pan.ax === 0 ? p.z : p.x, v = pan.ax === 0 ? p.y : p.z;
      pe = this.newPeel(Object.assign({}, pan, { u0: u - hu, u1: u + hu, v0: v - hv, v1: v + hv }), 1);
      if (pe) this.fling(pe, null, travel, 0.35);
    } else if (!pe && hits > hold) {
      pe = this.newPeel(pan, 0);
      if (pe) this.addFlap(pe, 0.5 + Math.random() * 0.9);
    }
    // a big blow loosens the panels round it too
    if (spread && E > 3e6) {
      const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize();
      const t2 = new THREE.Vector3().crossVectors(n, t1);
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * Math.PI * 2 + Math.random() * 0.5;
        const q = this.snapToSkin(p.clone().addScaledVector(t1, Math.cos(a) * (r * 0.9 + 0.5)).addScaledVector(t2, Math.sin(a) * (r * 0.9 + 0.5)));
        this.panelBlow(q, this.skinNormal(q), travel, E * 0.3, r, false);
      }
    }
  }

  newPeel(pan, style) {
    if (this.peels.length >= MAX_PEEL) return null;
    const pe = { key: pan.key, ax: pan.ax, side: pan.side, plane: pan.plane, u0: pan.u0, u1: pan.u1, v0: pan.v0, v1: pan.v1, style, seed: Math.random() * 50, heat: 1, depth: style === 2 ? 0.05 : 0.065, R: 0, flap: null };
    this.peelFrame(pe);
    this.peels.push(pe);
    this.syncDents();
    return pe;
  }

  /** a peel's middle on the skin and the skin's normal there */
  peelFrame(pe) {
    pe.centre = this.skinPoint(pe, (pe.u0 + pe.u1) / 2, (pe.v0 + pe.v1) / 2);
    pe.n = this.skinNormal(pe.centre);
  }

  /** the panel is torn away: the bent flap (or the whole panel) tumbles off into space */
  panelGone(pe, travel) {
    if (!pe) return;
    const flap = pe.flap;
    pe.style = 0; pe.heat = 1;
    if (flap) {
      this.group.remove(flap.mesh);
      this.fling(pe, flap.mesh.geometry, travel, 0);
      pe.flap = null;
    } else this.fling(pe, null, travel, 0.25);
    this.syncDents();
    const g = this.g;
    if (g.audio.ready && !this.catchingUp) { g.audio._burst(pe.centre, { dur: 0.3, freq: 1500, q: 3, gain: 0.12, type: 'white', filter: 'bandpass', sweep: -0.4 }); g.audio.creak(pe.centre, 0.7); }
    if (g.fx) { g.fx.burst('spark', pe.centre, pe.n, 40, { speed: 4, spread: 0.9 }); g.fx.burst('debris', pe.centre, pe.n, 25, { speed: 3, spread: 1.0 }); }
    this.events.push({ type: 'panel', pos: pe.centre.clone(), gone: true });
  }

  /** the panel half torn off: bent out on the edge still fastened */
  addFlap(pe, angle, hinge = Math.floor(Math.random() * 4)) {
    const geo = this.flapGeometry(pe, hinge, angle, true);
    const mesh = new THREE.Mesh(geo, this.flapMat(true));
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    setLayersDeep(mesh, LAYER_NEAR, LAYER_MID);
    this.group.add(mesh);
    pe.flap = { mesh, hinge, angle };
    const g = this.g;
    if (g.audio.ready && !this.catchingUp) { g.audio._burst(pe.centre, { dur: 0.45, freq: 900, q: 4, gain: 0.1, type: 'white', filter: 'bandpass', sweep: 0.5 }); g.audio.creak(pe.centre, 0.6); }
    if (g.fx && !this.catchingUp) g.fx.burst('spark', pe.centre, pe.n, 20, { speed: 3, spread: 0.8 });
    this.events.push({ type: 'panel', pos: pe.centre.clone(), gone: false });
  }

  /** a piece of skin thrown off (geo: its shape as it was on the hull, else a slightly bent panel) */
  fling(pe, geo, travel, bend) {
    const g = this.g, f = g.flight;
    if (!g.combat || !f || this.catchingUp) { if (geo) geo.dispose(); return; }
    if (!geo) {
      const sub = bend > 0.3 ? Object.assign({}, pe, { u0: pe.u0 + (pe.u1 - pe.u0) * 0.2, u1: pe.u1 - (pe.u1 - pe.u0) * 0.2, v0: pe.v0 + (pe.v1 - pe.v0) * 0.2, v1: pe.v1 - (pe.v1 - pe.v0) * 0.2 }) : pe;
      geo = this.flapGeometry(sub, Math.floor(Math.random() * 4), bend, bend > 0.3);
    }
    geo.computeBoundingBox();
    const c = geo.boundingBox.getCenter(new THREE.Vector3());
    geo.translate(-c.x, -c.y, -c.z);
    const mesh = new THREE.Mesh(geo, this.flapMat());
    const posE = c.clone().applyQuaternion(f.quat).add(f.pos);
    const out = pe.n.clone().multiplyScalar(2 + Math.random() * 5);
    if (travel) out.addScaledVector(travel, 1.5);
    out.add(new THREE.Vector3().randomDirection().multiplyScalar(0.8));
    g.combat.addWreck(mesh, posE, f.vel.clone().add(out.applyQuaternion(f.quat)), 45, 1);
    const w = g.combat.wrecks[g.combat.wrecks.length - 1];
    if (w) { w.q.copy(f.quat); w.spin = 1 + Math.random() * 4; }
  }

  /**
   * The panel's shape bent out about one edge (hinge: 0 the v0 edge, 1 v1, 2 u0, 3 u1) by angle
   * (rad): it leaves the skin there at an angle and curls on further; torn, its free edge ragged
   */
  flapGeometry(pe, hinge, angle, torn) {
    const NU = 10, NV = 6;
    const alongU = hinge < 2;
    const W = alongU ? pe.u1 - pe.u0 : pe.v1 - pe.v0;     // along the hinge
    const L = alongU ? pe.v1 - pe.v0 : pe.u1 - pe.u0;     // from the hinge to the free edge
    const U3 = pe.ax === 0 ? V(0, 0, 1) : V(1, 0, 0), V3 = pe.ax === 0 ? V(0, 1, 0) : V(0, 0, 1);
    const S3 = alongU ? U3 : V3;
    const free = alongU ? V3.clone().multiplyScalar(hinge === 0 ? 1 : -1) : U3.clone().multiplyScalar(hinge === 2 ? 1 : -1);
    const hingeAt = (s) => (alongU ? this.skinPoint(pe, pe.u0 + s, hinge === 0 ? pe.v0 : pe.v1) : this.skinPoint(pe, hinge === 2 ? pe.u0 : pe.u1, pe.v0 + s));
    const R = rng(Math.floor(pe.seed * 1000) + hinge);
    const th0 = angle * 0.55, kc = angle * 0.45 / L;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= NV; j++) {
      for (let i = 0; i <= NU; i++) {
        const s = W * i / NU;
        let h = L * j / NV;
        if (torn && j === NV) h *= 0.82 + 0.18 * R();
        if (torn && (i === 0 || i === NU) && j > 0) h *= 0.92 + 0.08 * R();
        const H = hingeAt(s);
        const nH = this.skinNormal(H);
        const T = free.clone().addScaledVector(nH, -free.dot(nH)).normalize();
        const t = kc > 1e-4 ? (Math.sin(th0 + kc * h) - Math.sin(th0)) / kc : h * Math.cos(th0);
        const nn = kc > 1e-4 ? (Math.cos(th0) - Math.cos(th0 + kc * h)) / kc : h * Math.sin(th0);
        const P = H.addScaledVector(T, t).addScaledVector(nH, nn + 0.004);
        pos.push(P.x, P.y, P.z);
        const a = s / W, b = h / L;
        uv.push(alongU ? a : (hinge === 2 ? b : 1 - b), alongU ? (hinge === 0 ? b : 1 - b) : a);
      }
    }
    // the painted face out
    const nOut = this.skinNormal(hingeAt(W / 2));
    const flip = new THREE.Vector3().crossVectors(S3, free).dot(nOut) < 0;
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
      if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /** the skin panels' own material: paint outside with the rivet holes torn through round the
   * edge, scorched; bare primer on the back (onShip: the one for panels still on the hull, which
   * the cockpit's screen sees through like the rest of the ship) */
  flapMat(onShip = false) {
    if (onShip) return this._flapMatShip || (this._flapMatShip = addDisplayCut(this.makeFlapMat()));
    return this._flapMat || (this._flapMat = this.makeFlapMat());
  }

  makeFlapMat() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#d6d8d4'; x.fillRect(0, 0, 256, 128);
    for (let k = 0; k < 600; k++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '40,38,36' : '255,255,255'},${Math.random() * 0.06})`; x.fillRect(Math.random() * 256, Math.random() * 128, 2 + Math.random() * 10, 1 + Math.random() * 4); }
    const gr = x.createRadialGradient(128, 64, 4, 128, 64, 90);
    gr.addColorStop(0, 'rgba(12,10,8,0.7)'); gr.addColorStop(1, 'rgba(12,10,8,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 256, 128);
    x.strokeStyle = 'rgba(40,40,42,0.8)'; x.lineWidth = 2; x.strokeRect(1, 1, 254, 126);
    x.fillStyle = '#18191a';
    for (let t = 8; t < 252; t += 7) for (const yy of [5, 123]) { x.beginPath(); x.arc(t, yy, 1.4, 0, Math.PI * 2); x.fill(); }
    for (let t = 8; t < 124; t += 7) for (const xx of [5, 251]) { x.beginPath(); x.arc(xx, t, 1.4, 0, Math.PI * 2); x.fill(); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.4, 0.45, 0.33) * (0.8 + 0.4 * texture2D(map, vMapUv * 3.0).g);`);
    };
    m.customProgramCacheKey = () => 'hullFlap';
    return m;
  }

  /** heat-shield tiles knocked off the belly round p (a gap that grows with further blows) */
  knockTiles(p, n, travel, E) {
    const R = Math.min(0.55, 0.06 + 0.035 * Math.cbrt(E / 1e4));
    let pe = this.peels.find((x) => x.style === 2 && Math.hypot(x.cx - p.x, x.cz - p.z) < x.R + R * 0.5);
    if (pe) {
      pe.R = Math.min(0.8, Math.max(pe.R, Math.hypot(pe.cx - p.x, pe.cz - p.z) + R * 0.6));
      pe.heat = Math.max(pe.heat, 0.6);
    } else {
      pe = this.newPeel({ key: 'tile' + this.nextId++, ax: 1, side: -1, plane: p.y, u0: 0, u1: 0, v0: 0, v1: 0 }, 2);
      if (!pe) return;
      pe.cx = p.x; pe.cz = p.z; pe.R = R;
    }
    pe.u0 = pe.cx - pe.R; pe.u1 = pe.cx + pe.R; pe.v0 = pe.cz - pe.R; pe.v1 = pe.cz + pe.R;
    this.peelFrame(pe);
    this.syncDents();
    // a few of them tumbling off: black glaze on top, white silica through
    const g = this.g, f = g.flight;
    if (!g.combat || !f || this.catchingUp) return;
    if (!this._tileMats) this._tileMats = [0xd8d7d2, 0xd8d7d2, 0x121212, 0xd8d7d2, 0xd8d7d2, 0xd8d7d2].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, metalness: 0 }));
    const nPieces = 1 + Math.min(3, Math.floor(R / 0.12));
    for (let k = 0; k < nPieces; k++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 0.15), this._tileMats);
      const at = p.clone().add(V((Math.random() - 0.5) * R, 0, (Math.random() - 0.5) * R));
      const v = n.clone().multiplyScalar(2 + Math.random() * 4).addScaledVector(travel, 1.2).add(new THREE.Vector3().randomDirection());
      g.combat.addWreck(mesh, at.applyQuaternion(f.quat).add(f.pos), f.vel.clone().add(v.applyQuaternion(f.quat)), 30, 0.5);
    }
  }

  addScorch(pos, r) {
    if (this.scorch.length >= 8) this.scorch.shift();
    this.scorch.push({ pos: pos.clone(), r });
    this.syncUniforms();
  }

  addBreach(pos, n, radius, zone, seed = null) {
    if (this.breaches.length >= MAX_BREACH) {
      // grow the closest existing breach instead
      const c = this.breaches.reduce((a, b) => (a.pos.distanceTo(pos) < b.pos.distanceTo(pos) ? a : b));
      c.r = Math.min(0.6, c.r + radius * 0.5);
      this._updateBreachLeak(c);
      return c;
    }
    const b = { id: this.nextId++, pos: pos.clone(), n: n.clone().normalize(), r: radius, zone, patched: false, sev: Math.min(1, radius / 0.08), seed: seed ?? Math.random() * 100, meshes: [], frost: 0 };
    // the hull's own normal there (the hole's frame) and the way the projectile went (the torn
    // petals fold that way); the inner wall tears a little wider than the skin
    const t = tForPoint(pos.z, pos.x, pos.y, 0);
    b.sn = sectionNormal(pos.z, t, 0);
    b.dir = b.n.clone().negate();
    b.innerK = 1.05 + 0.25 * ((b.seed * 0.731) % 1);
    b.leak = this.g.lifeSupport.addLeak(zone, Math.PI * radius * radius, 'breach' + b.id);
    this._breachMeshes(b);
    this.breaches.push(b);
    this.addIssue({ kind: 'breach', ref: b, zone, pos: b.pos.clone().addScaledVector(b.n, -0.3), sev: b.sev, repairable: radius < FIXABLE.breach, name: '船体の穴' });
    this.syncUniforms();
    // continuous venting effect
    if (this.g.fx) b.vent = this.g.fx.emitter('mist', b.pos.clone().addScaledVector(b.n, -0.25), b.n.clone(), 40, { speed: 3, spread: 0.4 });
    return b;
  }

  _updateBreachLeak(b) {
    if (b.leak) b.leak.area = b.patched ? Math.PI * b.r * b.r * 0.02 : Math.PI * b.r * b.r;
    this.syncUniforms();
  }

  _tornMats() {
    if (this.tm) return this.tm;
    const S = (o) => new THREE.MeshStandardMaterial(o);
    this.tm = {
      metal: S({ vertexColors: true, metalness: 0.5, roughness: 0.55, side: THREE.DoubleSide, envMapIntensity: 0.6 }),
      liner: S({ vertexColors: true, metalness: 0.5, roughness: 0.62, side: THREE.DoubleSide }),
      copper: S({ color: 0xd8874a, metalness: 0.95, roughness: 0.28, emissive: new THREE.Color(1.0, 0.45, 0.15), emissiveIntensity: 0 }),
      cables: new Map(),
      plate: S({ color: 0x8d949b, metalness: 0.75, roughness: 0.42, side: THREE.DoubleSide }),
      bolt: S({ color: 0x5d6168, metalness: 0.85, roughness: 0.35 }),
      sealant: S({ color: 0x9a9c98, metalness: 0.0, roughness: 0.9 }),
      crack: S({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, metalness: 0.0, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    };
    // (seen through the cockpit's screen like the rest of the ship: gone behind it)
    for (const m of Object.values(this.tm)) if (m.isMaterial) addDisplayCut(m);
    return this.tm;
  }

  /** torn plating, insulation, cables (and the patch once fixed) around a breach */
  _breachMeshes(b) {
    const T = this._tornMats();
    for (const m of b.meshes) { this.group.remove(m); if (m.userData.own) m.geometry.dispose(); }
    b.meshes = [];
    b.cables = [];
    const add = (geo, mat, own = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.userData.own = own;
      m.matrixAutoUpdate = false; m.updateMatrix();
      setLayersDeep(m, LAYER_NEAR, LAYER_MID);
      this.group.add(m); b.meshes.push(m);
      return m;
    };
    const t = tForPoint(b.pos.z, b.pos.x, b.pos.y, 0);
    const sn = b.sn || (b.sn = sectionNormal(b.pos.z, t, 0));
    const pin = sectionPoint(b.pos.z, t, HULL.inset);
    const gap = Math.max(0.06, b.pos.clone().sub(pin).dot(sn));
    const cIn = b.pos.clone().addScaledVector(sn, -gap);
    // petals fold the way the projectile went, never back out of the wall
    const travel = (b.dir || sn.clone().negate()).clone();
    if (travel.dot(sn) > -0.45) travel.addScaledVector(sn, -(travel.dot(sn) + 0.45));
    travel.normalize();
    const R = b.r, K = b.innerK || 1.12;
    add(petalGeometry({ c: b.pos, n: sn, R, seed: b.seed, travel, paint: 'outer', bend: 1.55 }), T.metal);
    add(linerGeometry({ c: b.pos, n: sn, R, seed: b.seed, gap, innerK: K }), T.liner);
    add(petalGeometry({ c: cIn, n: sn, R: R * K, seed: b.seed + 7.3, travel, paint: 'inner', bend: 1.3, lenK: 0.95 }), T.metal);
    // severed cables hanging into the room out of the larger holes
    if (R > 0.03 && !b.patched) {
      for (const cb of cableCurves({ c: cIn, n: sn, R: R * K, seed: b.seed, count: R > 0.12 ? 4 : 2 })) {
        let mat = T.cables.get(cb.color);
        if (!mat) { mat = addDisplayCut(new THREE.MeshStandardMaterial({ color: cb.color, roughness: 0.55, metalness: 0.05 })); T.cables.set(cb.color, mat); }
        add(cb.geo, mat);
        const tipG = new THREE.CylinderGeometry(cb.rad * 0.55, cb.rad * 0.55, 0.035, 6);
        tipG.rotateX(Math.PI / 2);
        tipG.lookAt(cb.dir);
        tipG.translate(cb.tip.x + cb.dir.x * 0.015, cb.tip.y + cb.dir.y * 0.015, cb.tip.z + cb.dir.z * 0.015);
        add(tipG, T.copper);
        b.cables.push({ tip: cb.tip.clone().addScaledVector(cb.dir, 0.03), dir: cb.dir.clone() });
      }
    }
    if (b.patched) {
      // a plate bolted over the hole on the inside, bent to the wall, sealant all round
      const { u, v } = holeFrame(sn);
      const surf = (x, y) => {
        const q = cIn.clone().addScaledVector(u, x).addScaledVector(v, y);
        const tq = tForPoint(q.z, q.x, q.y, HULL.inset);
        return sectionPoint(q.z, tq, HULL.inset + 0.012);
      };
      const size = R * K * 1.45 + 0.05;
      const pp = patchPlate(surf, sn.clone().negate(), size, b.seed);
      add(pp.plate, T.plate);
      add(pp.bead, T.sealant);
      const boltG = new THREE.CylinderGeometry(0.011, 0.012, 0.012, 6);
      for (const bp of pp.bolts) {
        const g = boltG.clone();
        g.rotateX(Math.PI / 2);
        g.lookAt(sn.clone().negate());
        g.translate(bp.x - sn.x * 0.006, bp.y - sn.y * 0.006, bp.z - sn.z * 0.006);
        add(g, T.bolt);
      }
    }
    b.rBuilt = b.r;
  }

  crackWindow(i, p, sev) {
    const o = OPENINGS[i];
    let u = 0, v = 0;
    if (o) { const d = p.clone().sub(o.center); u = Math.max(-o.halfW, Math.min(o.halfW, d.dot(o.u))); v = Math.max(-o.halfH, Math.min(o.halfH, d.dot(o.v))); }
    const c = this.cracks[i] || { u, v, sev: 0, seed: Math.random() * 10, patched: false, glass: true };
    c.sev = Math.min(2.2, c.sev + sev);
    this.cracks[i] = c;
    if (!c.issue) c.issue = this.addIssue({ kind: 'crack', ref: { i }, zone: o ? o.room : 'cockpit', pos: o ? o.center.clone().addScaledVector(o.normal, -0.35) : V(0, 1.6, -12), sev: c.sev / 2, repairable: c.sev < FIXABLE.crack, name: '窓のひび' });
    else { c.issue.sev = c.sev / 2; c.issue.repairable = c.sev < FIXABLE.crack && !c.patched; }
    if (c.sev >= 2.0 && !c.broken) this._breakWindow(i);
    this.syncUniforms();
  }

  _breakWindow(i) {
    const c = this.cracks[i];
    c.broken = true;
    const o = OPENINGS[i];
    const zone = o ? (o.room === 'corridor' ? 'corridor' : o.room) : 'cockpit';
    const area = o ? Math.PI * o.halfW * o.halfH : 0.8;
    c.leak = this.g.lifeSupport.addLeak(zone, area, 'window' + i);
    glassUniforms.uWinGone.value[i] = 1;
    if (this.g.fx) {
      const p = o ? o.center : V(0, 1.6, -12.5);
      this.g.fx.burst('ice', p, o ? o.normal : V(0, 0.3, -1), 200, { speed: 9, spread: 0.8 });
      this.g.fx.burst('debris', p, o ? o.normal : V(0, 0.3, -1), 120, { speed: 5, spread: 1 });
    }
    this.events.push({ type: 'window', zone });
    this.addIssue({ kind: 'window', ref: { i }, zone, pos: o ? o.center.clone() : V(0, 1.6, -12), sev: 1, repairable: false, name: '窓の破損' });
  }

  damageEquipment(k, dmg, p) {
    if (k === 'cameras') return;
    const prev = this.health[k];
    this.health[k] = Math.max(0, prev - dmg);
    const eq = EQUIPMENT[k];
    const ex = this.issues.find((i) => i.kind === 'equip' && i.ref.k === k && i.state === 'active');
    const sev = 1 - this.health[k];
    if (ex) { ex.sev = sev; ex.repairable = sev < FIXABLE.equip && !eq.ext; }
    else this.addIssue({ kind: 'equip', ref: { k }, zone: eq.zone, pos: eq.pos.clone(), sev, repairable: sev < FIXABLE.equip && !eq.ext, name: eq.name + 'の故障', ext: eq.ext });
    if (this.g.fx && !eq.ext) this.g.fx.burst('spark', eq.pos, V(0, 1, 0), 25, { speed: 2 });
    this.events.push({ type: 'equip', k, sev });
    // cameras near impact
    const cams = [V(0, 7, 20), V(0, -0.8, -13.4), V(0, -2.4, -3), V(7.5, 0.5, 13), V(0, 3.2, 2.6)];
    cams.forEach((c, i) => { if (c.distanceTo(p) < 3) this.health.cameras[i] = Math.max(0, this.health.cameras[i] - dmg * 2); });
  }

  pipeLeak(seg, sev) {
    seg.leak = Math.min(1, seg.leak + sev);
    const S = PIPE_SYSTEMS[seg.sys];
    if (!seg.issue) {
      seg.where = seg.mid.clone();
      seg.issue = this.addIssue({ kind: 'pipe', ref: seg, zone: seg.mid.y < -0.1 ? 'under' : this.g.lifeSupport.zoneAt(seg.mid), pos: seg.mid.clone(), sev: seg.leak, repairable: seg.leak < FIXABLE.pipe, name: S.name + 'の配管漏れ' });
      const dir = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).normalize();
      seg.dir = dir;
      if (this.g.fx) seg.emitter = this.g.fx.emitter(S.leak, seg.mid.clone().addScaledVector(dir, seg.r), dir, 10, { speed: S.leak === 'water' ? 0.4 : 2.5, spread: 0.35 });
      // air & gas lines leak into the zone
      seg.audio = 'leak' + seg.id;
    } else {
      seg.issue.sev = seg.leak;
      seg.issue.repairable = seg.leak < FIXABLE.pipe && !seg.patched;
    }
    this.events.push({ type: 'pipe', sys: seg.sys, pos: seg.mid.clone() });
  }

  addIssue(o) {
    const it = Object.assign({ id: this.nextId++, state: 'active', created: this.g.time, patched: false }, o);
    this.issues.push(it);
    return it;
  }

  // ------------------------------------------------------------------ repairs
  /** returns 'fixed' | 'patched' | 'cannot' */
  repair(issue) {
    const g = this.g;
    if (issue.state !== 'active') return 'none';
    if (issue.kind === 'breach') {
      const b = issue.ref;
      if (b.r < FIXABLE.breach && !b.patched) {
        b.patched = true;
        this._updateBreachLeak(b);
        this._breachMeshes(b);
        if (b.vent) { g.fx.removeEmitter(b.vent); b.vent = null; }
        issue.state = 'patched';
        return 'patched';
      }
      return 'cannot';
    }
    if (issue.kind === 'crack') {
      const c = this.cracks[issue.ref.i];
      if (c && !c.broken && c.sev < FIXABLE.crack) { c.patched = true; issue.state = 'patched'; return 'patched'; }
      return 'cannot';
    }
    if (issue.kind === 'fracture') {
      const f = issue.ref;
      if (f.sev < FIXABLE.fracture) {
        f.sealed = true;
        if (f.leak) { g.lifeSupport.removeLeak(f.leak); f.leak = null; }
        if (f.hiss) { g.audio.stopLoop(f.hiss); f.hiss = null; }
        this._fractureMesh(f);
        issue.state = 'patched';
        return 'patched';
      }
      return 'cannot';
    }
    if (issue.kind === 'pipe') {
      const s = issue.ref;
      if (s.leak < FIXABLE.pipe) {
        s.patched = true;
        s.leak = s.leak < 0.15 ? 0 : s.leak * 0.15;
        if (s.emitter) { g.fx.removeEmitter(s.emitter); s.emitter = null; }
        if (s.leak > 0) s.emitter = g.fx.emitter('mist', s.mid.clone().addScaledVector(s.dir, s.r), s.dir, 1.5, { speed: 0.6 });
        issue.state = s.leak === 0 ? 'fixed' : 'patched';
        // clamp visual
        const clamp = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 1.45, s.r * 1.45, 0.12, 14), g.shipVis.M.steel);
        clamp.position.copy(s.mid);
        clamp.quaternion.setFromUnitVectors(V(0, 1, 0), s.b.clone().sub(s.a).normalize());
        clamp.updateMatrix(); clamp.matrixAutoUpdate = false;
        setLayersDeep(clamp, LAYER_NEAR);
        this.group.add(clamp);
        return issue.state;
      }
      return 'cannot';
    }
    if (issue.kind === 'equip') {
      const k = issue.ref.k;
      if (EQUIPMENT[k].ext) return 'cannot';
      if (1 - this.health[k] < FIXABLE.equip) {
        this.health[k] = Math.min(1, this.health[k] + 0.12);
        issue.state = this.health[k] > 0.97 ? 'fixed' : 'patched';
        issue.sev = 1 - this.health[k];
        return issue.state;
      }
      return 'cannot';
    }
    return 'cannot';
  }

  /** full repair at the dock */
  repairAll() {
    for (const b of this.breaches) { this.g.lifeSupport.removeLeak(b.leak); for (const m of b.meshes) this.group.remove(m); if (b.vent) this.g.fx.removeEmitter(b.vent); }
    this.breaches = [];
    this.cracks.forEach((c, i) => { if (c && c.leak) this.g.lifeSupport.removeLeak(c.leak); glassUniforms.uWinGone.value[i] = 0; });
    this.cracks = OPENINGS.map(() => null);
    this.dents = []; this.scorch = [];
    this.peels = []; this.panelHits.clear();
    for (const f of this.fractures) { if (f.leak) this.g.lifeSupport.removeLeak(f.leak); if (f.hiss) this.g.audio.stopLoop(f.hiss); }
    this.fractures = [];
    for (const s of this.g.layout.pipes) { s.leak = 0; s.patched = false; s.issue = null; if (s.emitter) { this.g.fx.removeEmitter(s.emitter); s.emitter = null; } }
    for (const k of Object.keys(this.health)) this.health[k] = k === 'cameras' ? [1, 1, 1, 1, 1] : 1;
    this.issues = [];
    this.fatigue = 0;
    this.shotWear = 0;
    this.pocks.clear();
    this.broken = false;
    this.group.clear();
    if (this.g.b29Display) this.g.b29Display.repair();
    this.syncUniforms();
  }

  // ------------------------------------------------------------------ structure
  /**
   * Structural integrity 0..1 of the pressure hull: dents, holes, missing windows and accumulated
   * metal fatigue all eat into it. Below ~0.35 the hull is in danger; at 0 it comes apart.
   */
  integrity() {
    let x = (this.fatigue || 0) + (this.shotWear || 0);
    // (a gun round's own crater counts little: its wear is in shotWear already)
    for (const d of this.dents) x += d.depth * d.r * 2.2 * (1 - 0.85 * (d.sharp || 0));
    for (const b of this.breaches) x += b.r * (b.patched ? 0.8 : 2.4);
    for (const c of this.cracks) if (c && c.broken) x += 0.12;
    for (const f of this.fractures) x += f.sev * (f.sealed ? 0.008 : 0.03);
    for (const pe of this.peels) x += pe.style === 2 ? 0.002 + pe.R * 0.004 : 0.005;
    return Math.max(0, 1 - x);
  }

  /** stress events (ULTRA shudders, hard landings...): fatigue plus a chance of fresh damage */
  stressEvent(amount, where = null) {
    this.fatigue = (this.fatigue || 0) + amount * 0.02;
    if (Math.random() < Math.min(0.9, amount)) this.spawnFatigueDamage(where, Math.min(1, 0.3 + amount));
  }

  /** new damage grown out of fatigue somewhere in the ship (cracks, leaks, failures, buckling) */
  spawnFatigueDamage(near = null, k = 0.5) {
    const g = this.g;
    const roll = Math.random();
    if (roll < 0.34 && g.layout.pipes.length) {
      const list = near ? g.layout.pipes.filter((s) => s.mid.distanceTo(near) < 3) : g.layout.pipes;
      const s = (list.length ? list : g.layout.pipes)[Math.floor(Math.random() * (list.length || g.layout.pipes.length))];
      this.pipeLeak(s, 0.05 + 0.25 * k * Math.random());
      return 'pipe';
    }
    if (roll < 0.58) {
      const keys = Object.keys(EQUIPMENT).filter((q) => !EQUIPMENT[q].ext || Math.random() < 0.4);
      const q = keys[Math.floor(Math.random() * keys.length)];
      this.damageEquipment(q, 0.04 + 0.2 * k * Math.random(), EQUIPMENT[q].pos);
      return 'equip';
    }
    if (roll < 0.76) {
      const wins = OPENINGS.map((o, i) => [o, i]).filter(([o]) => o.kind === 'win');
      const [o, i] = wins[Math.floor(Math.random() * wins.length)];
      this.crackWindow(i, o.center.clone().addScaledVector(o.u, (Math.random() - 0.5) * o.halfW), 0.15 + 0.5 * k * Math.random());
      return 'crack';
    }
    // a fatigue crack in the wall, from a window corner or along the frames (or near the trouble)
    if (Math.random() < 0.5) {
      const sp = near && Math.random() < 0.5 ? { p: near.clone(), dir: null } : stressPoint(OPENINGS);
      this.addFracture(sp.p, sp.dir, 0.04 + 0.25 * k * Math.random());
      return 'fracture';
    }
    // buckled plating: an inward dent in the hull, sometimes split open
    const z = near ? Math.max(-11, Math.min(9, near.z + (Math.random() - 0.5) * 2)) : -11 + Math.random() * 20;
    const t = Math.random() * Math.PI * 2;
    const p = sectionPoint(z, t, 0), n = sectionNormal(z, t, 0);
    this.addDent(p, n.clone().negate(), 0.25 + 0.4 * k, 0.02 + 0.05 * k);
    if (Math.random() < 0.4) this.addFracture(p, null, 0.05 + 0.2 * k, 0.3 + 0.5 * k);
    if (Math.random() < 0.25 * k) {
      const zone = this.zoneForHullPoint(p);
      if (zone) this.addBreach(p, n, 0.004 + 0.02 * k * Math.random(), zone);
    }
    this.events.push({ type: 'buckle', pos: p.clone() });
    return 'buckle';
  }

  // ------------------------------------------------------------------ time evolution
  update(dt) {
    const g = this.g;
    const f = g.flight;
    if (this.broken) return;
    // stress multiplier: ULTRA vibration, heating, high g
    const stressMul = 1 + (f.ultra ? 0.6 + 0.9 * Math.min(1, Math.max(0, f.setSpeed) / 900) : 0) + Math.min(4, f.heatFlux / 5e4) + Math.min(3, f.properAcc.length() / 10);
    for (const it of this.issues) {
      if (it.state === 'fixed') continue;
      const patchK = it.state === 'patched' ? 0.15 : 1;
      let grow = 0;
      if (it.kind === 'breach') grow = 0.00003;
      else if (it.kind === 'crack') grow = 0.000011;
      else if (it.kind === 'pipe') grow = 0.00003;
      else if (it.kind === 'equip') grow = 0.00002;
      else if (it.kind === 'window') grow = 0;
      else if (it.kind === 'fracture') grow = 0.000016;
      // larger damage worsens faster (fatigue): the growth accelerates with severity
      const d = grow * stressMul * patchK * (0.4 + it.sev * 1.6) * dt;
      if (d <= 0) continue;
      it.sev = Math.min(1, it.sev + d);
      if (it.kind === 'breach') {
        const b = it.ref;
        b.r = Math.min(0.6, b.r * (1 + d * 0.9));
        this._updateBreachLeak(b);
        it.repairable = b.r < FIXABLE.breach && !b.patched;
        if (b.r > (b.rBuilt || 0) * 1.04) this._breachMeshes(b);
      } else if (it.kind === 'crack') {
        const c = this.cracks[it.ref.i];
        if (c && !c.broken) { c.sev = Math.min(2.2, c.sev + d * 1.6); it.repairable = c.sev < FIXABLE.crack && !c.patched; if (c.sev >= 2.0) this._breakWindow(it.ref.i); this.syncUniforms(); }
      } else if (it.kind === 'fracture') {
        const f = it.ref;
        f.sev = it.sev;
        it.repairable = f.sev < FIXABLE.fracture && !f.sealed;
        if (f.sev - f.builtSev > 0.02) {
          this._fractureMesh(f);
          // the crack running on: a sharp tick in the wall
          if (g.audio.ready && !this.catchingUp) g.audio._burst(f.paths[0][0].p, { dur: 0.06, freq: 1800 + Math.random() * 1500, q: 2, gain: 0.07, type: 'white', filter: 'bandpass' });
        }
        // once it goes right through the skin, air seeps out of it
        if (!f.sealed && f.sev > 0.45) {
          const area = (f.sev - 0.45) * (f.sev - 0.45) * 2e-4;
          if (!f.leak) f.leak = g.lifeSupport.addLeak(f.zone, area, 'fracture');
          else f.leak.area = area;
        }
      } else if (it.kind === 'pipe') {
        const s = it.ref;
        s.leak = Math.min(1, s.leak + d);
        it.repairable = s.leak < FIXABLE.pipe && !s.patched;
      } else if (it.kind === 'equip') {
        const k = it.ref.k;
        this.health[k] = Math.max(0, this.health[k] - d);
        it.repairable = 1 - this.health[k] < FIXABLE.equip && !EQUIPMENT[k].ext;
      }
      if (!it.worseNotified && it.sev > 0.6 && it.state !== 'fixed') { it.worseNotified = true; this.events.push({ type: 'worse', issue: it }); }
    }
    this.updateSkin(dt);
    // frost where the escaping air freezes round a hole; sparks from severed live cables
    const BS = shipUniforms.uBreachS.value, lsp = g.lifeSupport;
    this.breaches.forEach((b, i) => {
      const venting = !b.patched && lsp.pressure(b.zone) > 3;
      b.frost = Math.max(0, Math.min(1, (b.frost || 0) + dt * (venting ? 0.06 : -0.0012)));
      if (i < MAX_BREACH) BS[i].x = b.frost;
      if (b.cables && b.cables.length && !b.patched && (g.systems.power ?? 1) > 0.3 && Math.random() < dt * 0.18) {
        const c = b.cables[Math.floor(Math.random() * b.cables.length)];
        if (g.fx) g.fx.burst('spark', c.tip, c.dir, 5 + Math.floor(Math.random() * 14), { speed: 1.3 });
        if (g.audio.ready) g.audio._burst(c.tip, { dur: 0.09 + Math.random() * 0.1, freq: 3400, q: 0.7, gain: 0.05, type: 'white', filter: 'highpass' });
      }
    });
    // metal fatigue: open holes and a weakened frame keep working the structure; it spreads as new
    // cracks, leaks and buckled plates, and accelerates once the hull is badly weakened
    let open = 0;
    for (const b of this.breaches) if (!b.patched) open += b.r;
    const integ = this.integrity();
    const weak = Math.max(0, 0.45 - integ);
    const fRate = (open * 0.12 + weak * 0.05 + (f.ultra ? 0.0008 : 0)) * stressMul / 3600;
    this.fatigue = (this.fatigue || 0) + fRate * dt;
    this.spreadT = (this.spreadT ?? 600) - dt * (open * 2.5 + weak * 4 + Math.max(0, 0.8 - integ) * 0.5) * stressMul;
    if (this.spreadT <= 0) {
      this.spreadT = 600 + Math.random() * 900;
      const src = this.breaches.length ? this.breaches[Math.floor(Math.random() * this.breaches.length)].pos : null;
      this.spawnFatigueDamage(src, Math.min(1, 0.3 + weak * 1.5));
    }
    this.integrityNow = integ;
    if (integ <= 0 && !this.broken && !this.catchingUp && g.gameplay) { this.broken = true; g.gameplay.breakup('structure'); return; }
    // effects of pipe leaks on systems
    let coolantLoss = 0, waterLoss = 0, airLoss = 0, o2Loss = 0, n2Loss = 0, rcsLoss = 0;
    for (const s of g.layout.pipes) {
      if (s.leak <= 0) continue;
      const v = g.systems.valveOpen ? g.systems.valveOpen(s) : true;
      const lk = v ? s.leak : s.leak * 0.05;
      if (s.sys === 'coolant') coolantLoss += lk;
      else if (s.sys === 'water' || s.sys === 'waste') waterLoss += lk;
      else if (s.sys === 'air') airLoss += lk;
      else if (s.sys === 'o2') o2Loss += lk;
      else if (s.sys === 'n2') n2Loss += lk;
      else if (s.sys === 'rcs') rcsLoss += lk;
      if (s.emitter) s.emitter.rate = lk * 60 + 2;
    }
    this.coolant = Math.max(0, (this.coolant ?? 1) - coolantLoss * dt * 0.00012);
    const ls = g.lifeSupport;
    ls.water = Math.max(0, ls.water - waterLoss * dt * 0.02);
    ls.reserve.o2 = Math.max(0, ls.reserve.o2 - o2Loss * dt * 1.5);
    ls.z.under.o2 += o2Loss * dt * 1.5 / ls.z.under.vol;
    ls.reserve.n2 = Math.max(0, ls.reserve.n2 - n2Loss * dt * 1.5);
    ls.z.under.n2 += n2Loss * dt * 1.5 / ls.z.under.vol;
    ls.fans.health = this.health.fans * (1 - Math.min(0.8, airLoss));
    ls.o2gen.health = this.health.o2gen;
    ls.scrubber.health = this.health.scrubber;
    f.engineHealth = this.health.engine * (this.health.reactor > 0.3 ? 1 : 0.4);
    f.rcsHealth = this.health.rcs * (1 - Math.min(0.85, rcsLoss));
    // reactor temperature vs coolant
    const coolEff = this.coolant * (this.health.reactor * 0.5 + 0.5);
    this.reactorTemp = 560 + (1 - coolEff) * 420 + (f.ultra ? 40 : 0);
    g.systems.power = Math.min(this.health.power, this.reactorTemp > 820 ? 0.45 : 1) * (this.health.reactor > 0.15 ? 1 : 0.25);
    g.systems.serversHealth = this.health.servers;
    this.stress = Math.max(0, this.stress - dt * 0.001);
  }

  /** the dents and the torn panels into the ship materials' data texture */
  syncDents() {
    const W = MAX_DENTS, A = dentData;
    A.fill(0);
    const put = (row, i, a, b, c, d) => { const o = (row * W + i) * 4; A[o] = a; A[o + 1] = b; A[o + 2] = c; A[o + 3] = d; };
    const n = Math.min(MAX_DENTS, this.dents.length);
    for (let i = 0; i < n; i++) {
      const d = this.dents[i];
      put(0, i, d.pos.x, d.pos.y, d.pos.z, d.r);
      put(1, i, d.dir.x, d.dir.y, d.dir.z, d.depth);
      put(2, i, d.heat || 0, d.seed || 0, d.sharp || 0, 0);
    }
    const m = Math.min(MAX_PEEL, this.peels.length);
    for (let j = 0; j < m; j++) {
      const p = this.peels[j];
      put(3, j, p.u0, p.u1, p.v0, p.v1);
      put(4, j, p.ax, p.side, p.plane, p.style);
      put(5, j, p.heat || 0, p.seed, p.depth, p.R || 0);
    }
    shipUniforms.uDentN.value = n;
    shipUniforms.uPeelN.value = m;
    shipUniforms.tDents.value.needsUpdate = true;
  }

  /**
   * Fresh strikes cool off; torn wiring in the open bays spits sparks while there is power; in
   * the air the bent panels are torn away by the wind, and where tiles are missing from the belly
   * the heat of entry gets in at the bare skin and burns through it
   */
  updateSkin(dt) {
    const g = this.g, f = g.flight;
    let dirty = false;
    for (const d of this.dents) if (d.heat > 0) { d.heat = d.heat < 0.01 ? 0 : d.heat * Math.exp(-dt / 5); dirty = true; }
    for (const pe of [...this.peels]) {
      if (pe.heat > 0) { pe.heat = pe.heat < 0.01 ? 0 : pe.heat * Math.exp(-dt / 7); dirty = true; }
      if (this.catchingUp) continue;
      if (pe.style !== 2 && g.fx && (g.systems.power ?? 1) > 0.3 && Math.random() < dt * 0.07) g.fx.burst('spark', pe.centre, pe.n, 4 + Math.floor(Math.random() * 10), { speed: 1.6, spread: 0.7 });
      const q = f.dynPressure || 0;
      if (pe.flap && q > 1500 && Math.random() < dt * Math.min(2, q / 6000)) this.panelGone(pe, null);
      if (pe.style === 2 && f.heatFlux > 6e4) {
        pe.heat = Math.max(pe.heat, Math.min(1, f.heatFlux / 4e5));
        pe.burn = (pe.burn || 0) + dt * (f.heatFlux - 6e4) / 3e6 * (0.5 + pe.R * 2);
        dirty = true;
        if (pe.burn > 1 && !pe.burnt) {
          pe.burnt = true;
          const zone = this.zoneForHullPoint(pe.centre);
          this.addScorch(pe.centre, pe.R * 2.5);
          this.addDent(pe.centre, pe.n.clone().negate(), pe.R * 1.6, 0.05, { heat: 1 });
          if (zone) this.addBreach(pe.centre.clone(), pe.n.clone(), Math.min(0.1, 0.02 + pe.R * 0.12), zone);
          this.events.push({ type: 'burnthrough', zone, pos: pe.centre.clone() });
        }
      }
    }
    if (dirty) this.syncDents();
  }

  syncUniforms() {
    this.syncDents();
    const B = shipUniforms.uBreach.value, BN = shipUniforms.uBreachN.value, BS = shipUniforms.uBreachS.value;
    for (let i = 0; i < MAX_BREACH; i++) {
      const b = this.breaches[i];
      // (a patched hole stays open in the wall: the plate covers it from the inside)
      if (b) {
        B[i].set(b.pos.x, b.pos.y, b.pos.z, b.r);
        const sn = b.sn || b.n;
        BN[i].set(sn.x, sn.y, sn.z, b.seed);
        BS[i].set(b.frost || 0, b.innerK || 1.12, b.patched ? 1 : 0, 0);
      } else B[i].set(0, 0, 0, 0);
    }
    const S = shipUniforms.uScorch.value;
    for (let i = 0; i < 8; i++) { const s = this.scorch[i]; if (s) S[i].set(s.pos.x, s.pos.y, s.pos.z, s.r); else S[i].set(0, 0, 0, 0); }
    const W = glassUniforms.uWinDmg.value;
    for (let i = 0; i < W.length; i++) {
      const c = this.cracks[i];
      if (c) W[i].set(c.u, c.v, c.sev, c.seed); else W[i].set(0, 0, 0, 0);
      // the pane's own fracture network, repainted as its cracks creep on
      if (c && !this.crackAtlas) {
        this.crackAtlas = new CrackAtlas();
        glassUniforms.tCracks.value = this.crackAtlas.tex;
        glassUniforms.uWinTile.value = this.crackAtlas.uTile;
      }
      if (this.crackAtlas) {
        const o = OPENINGS[i];
        const grew = this.crackAtlas.update(i, c, o ? Math.max(o.halfW, o.halfH) + 0.03 : 1.4);
        // a crack running on ticks
        if (grew && this.g.audio.ready && !this.catchingUp) {
          const p = o ? o.center : V(0, 1.6, -12.2);
          this.g.audio._burst(p, { dur: 0.05, freq: 5200, q: 2.5, gain: 0.08, type: 'white', filter: 'bandpass' });
          this.g.audio._burst(p, { dur: 0.12, freq: 2400, q: 1.2, gain: 0.05, type: 'white', filter: 'bandpass', attack: 0.02 });
        }
      }
    }
  }

  serialize() {
    return {
      dents: this.dents.map((d) => ({ p: d.pos.toArray(), d: d.dir.toArray(), r: d.r, depth: d.depth, r0: d.r0, s: d.sharp || 0, sd: d.seed || 0 })),
      peels: this.peels.map((pe) => ({ k: pe.key, a: pe.ax, sd: pe.side, pl: pe.plane, r: [pe.u0, pe.u1, pe.v0, pe.v1], st: pe.style, s: pe.seed, R: pe.R || 0, c: pe.style === 2 ? [pe.cx, pe.cz] : null, f: pe.flap ? [pe.flap.hinge, pe.flap.angle] : null, b: pe.burn || 0, bt: !!pe.burnt })),
      panelHits: [...this.panelHits].slice(-120).map(([k, e]) => [k, Math.round(e)]),
      breaches: this.breaches.map((b) => ({ p: b.pos.toArray(), n: b.n.toArray(), r: b.r, zone: b.zone, patched: b.patched, seed: b.seed })),
      fractures: this.fractures.map((f) => ({ p: f.p0.toArray(), d: f.dir ? f.dir.toArray() : null, len: f.len, seed: f.seed, sev: f.sev, sealed: f.sealed })),
      cracks: this.cracks.map((c) => c ? { u: c.u, v: c.v, sev: c.sev, seed: c.seed, patched: c.patched, broken: !!c.broken } : null),
      scorch: this.scorch.map((s) => ({ p: s.pos.toArray(), r: s.r })),
      health: this.health, coolant: this.coolant ?? 1, fatigue: this.fatigue || 0,
      shotWear: this.shotWear || 0, pocks: this.pocks.serialize(),
      pipes: this.g.layout.pipes.filter((s) => s.leak > 0 || s.patched).map((s) => ({ id: s.id, leak: s.leak, patched: s.patched })),
      equipIssues: this.issues.filter((i) => i.kind === 'equip').map((i) => ({ k: i.ref.k, sev: i.sev, state: i.state })),
    };
  }

  restore(d) {
    this.dents = (d.dents || []).map((x) => ({ pos: V(...x.p), dir: V(...x.d), r: x.r, r0: x.r0 || x.r, depth: x.depth, sharp: x.s || 0, heat: 0, seed: x.sd || 0 }));
    this.panelHits = new Map(d.panelHits || []);
    for (const pe of this.peels) if (pe.flap) this.group.remove(pe.flap.mesh);
    this.peels = [];
    for (const x of d.peels || []) {
      const pe = { key: x.k, ax: x.a, side: x.sd, plane: x.pl, u0: x.r[0], u1: x.r[1], v0: x.r[2], v1: x.r[3], style: x.st, seed: x.s, heat: 0, depth: x.st === 2 ? 0.05 : 0.065, R: x.R || 0, flap: null, burn: x.b || 0, burnt: !!x.bt };
      if (x.c) { pe.cx = x.c[0]; pe.cz = x.c[1]; }
      this.peelFrame(pe);
      this.peels.push(pe);
      if (x.f) { const cu = this.catchingUp; this.catchingUp = true; this.addFlap(pe, x.f[1], x.f[0]); this.catchingUp = cu; }
    }
    this.scorch = (d.scorch || []).map((x) => ({ pos: V(...x.p), r: x.r }));
    Object.assign(this.health, d.health || {});
    this.coolant = d.coolant ?? 1;
    this.fatigue = d.fatigue || 0;
    this.shotWear = d.shotWear || 0;
    this.pocks.restore(d.pocks);
    for (const b of d.breaches || []) {
      const br = this.addBreach(V(...b.p), V(...b.n), b.r, b.zone, b.seed);
      if (b.patched) { br.patched = true; this._updateBreachLeak(br); this._breachMeshes(br); if (br.vent) { this.g.fx.removeEmitter(br.vent); br.vent = null; } const is = this.issues.find((i) => i.ref === br); if (is) is.state = 'patched'; }
    }
    (d.cracks || []).forEach((c, i) => {
      if (!c) return;
      this.cracks[i] = { u: c.u, v: c.v, sev: c.sev, seed: c.seed, patched: c.patched };
      this.cracks[i].issue = this.addIssue({ kind: 'crack', ref: { i }, zone: OPENINGS[i] ? OPENINGS[i].room : 'cockpit', pos: OPENINGS[i] ? OPENINGS[i].center.clone() : V(0, 1.6, -12), sev: c.sev / 2, repairable: true, name: '窓のひび', state: c.patched ? 'patched' : 'active' });
      if (c.broken) this._breakWindow(i);
    });
    for (const x of d.fractures || []) {
      const f = this.addFracture(V(...x.p), x.d ? V(...x.d) : null, x.sev, x.len, x.seed, true);
      if (x.sealed) { f.sealed = true; f.issue.state = 'patched'; this._fractureMesh(f); }
    }
    for (const p of d.pipes || []) {
      const s = this.g.layout.pipes.find((x) => x.id === p.id);
      if (!s) continue;
      if (p.leak > 0) this.pipeLeak(s, p.leak);
      s.patched = p.patched;
      if (s.issue && p.patched) s.issue.state = 'patched';
    }
    for (const e of d.equipIssues || []) {
      this.addIssue({ kind: 'equip', ref: { k: e.k }, zone: EQUIPMENT[e.k].zone, pos: EQUIPMENT[e.k].pos.clone(), sev: e.sev, repairable: e.sev < 0.35 && !EQUIPMENT[e.k].ext, name: EQUIPMENT[e.k].name + 'の故障', state: e.state, ext: EQUIPMENT[e.k].ext });
    }
    this.events.length = 0;
    this.syncUniforms();
  }
}
