// Exterior of B-29: lofted skin, window frames + glass, reactor module, radiators, engine,
// RCS quads, antennas, handrails, lights, lettering.
import * as THREE from 'three';
import { QUALITY } from '../core/quality.js';
import { Builder, roundedRectShape, rng, fixNormals } from './geom.js';
import { HULL, hullAt, sectionPoint, sectionNormal, tForPoint, OPENINGS, inCanopy, canopyZ } from './hullShape.js';
import { createGlassMaterial } from './glass.js';
import { buildPortExterior, PORT } from '../h8/b29Port.js';

/** lofted superellipse surface between z0..z1 (inset = inner wall) */
export function loftGeometry(z0, z1, rings, segs, inset = 0, flip = false, closeNose = true) {
  const pos = [], nrm = [], uv = [], idx = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    // denser near the nose for curvature
    const f = i / rings;
    const z = z0 + (z1 - z0) * f;
    for (let j = 0; j <= segs; j++) {
      const t = (j / segs) * Math.PI * 2 - Math.PI / 2; // start at bottom
      sectionPoint(z, t, inset, p);
      pos.push(p.x, p.y, p.z);
      uv.push(j / segs, z);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j, b = a + 1, c = a + segs + 1, d = c + 1;
      if (!flip) idx.push(a, b, d, a, d, c); else idx.push(a, d, b, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // fix the seam normals (j=0 and j=segs coincide)
  const n = g.attributes.normal;
  for (let i = 0; i <= rings; i++) {
    const a = i * (segs + 1), b = a + segs;
    const x = (n.getX(a) + n.getX(b)) / 2, y = (n.getY(a) + n.getY(b)) / 2, z = (n.getZ(a) + n.getZ(b)) / 2;
    n.setXYZ(a, x, y, z); n.setXYZ(b, x, y, z);
  }
  fixNormals(g);
  return g;
}

/** copy of a lofted surface without the triangles inside an opening (non-indexed) */
export function cutOpeningTris(geo, o, grow = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const a = g.attributes.position.array;
  const out = [];
  const c = new THREE.Vector3(), d = new THREE.Vector3();
  const hw = o.halfW + grow, hh = o.halfH + grow, r = Math.min(o.radius + grow, hw, hh);
  for (let i = 0; i < a.length; i += 9) {
    c.set((a[i] + a[i + 3] + a[i + 6]) / 3, (a[i + 1] + a[i + 4] + a[i + 7]) / 3, (a[i + 2] + a[i + 5] + a[i + 8]) / 3);
    d.copy(c).sub(o.center);
    if (Math.abs(d.dot(o.normal)) < 0.5) {
      const kx = Math.abs(d.dot(o.u)) - hw + r, ky = Math.abs(d.dot(o.v)) - hh + r;
      const sd = Math.hypot(Math.max(kx, 0), Math.max(ky, 0)) + Math.min(Math.max(kx, ky), 0) - r;
      if (sd < 0) continue;
    }
    for (let k = 0; k < 9; k++) out.push(a[i + k]);
  }
  const res = new THREE.BufferGeometry();
  res.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return res;
}

/** points of an opening outline projected to a hull surface (inset) */
export function openingOutline(o, inset, n = 48, grow = 0) {
  const pts = [];
  const hw = o.halfW + grow, hh = o.halfH + grow, r = Math.min(o.radius + grow, hw, hh);
  // rounded-rect perimeter param
  const corners = [[hw - r, hh - r], [-(hw - r), hh - r], [-(hw - r), -(hh - r)], [hw - r, -(hh - r)]];
  const per = [];
  for (let k = 0; k < 4; k++) {
    const [cx, cy] = corners[k];
    for (let s = 0; s < n / 4; s++) {
      const a = (k * Math.PI) / 2 + (s / (n / 4)) * (Math.PI / 2);
      per.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  const tmp = new THREE.Vector3();
  for (const [qu, qv] of per) {
    tmp.copy(o.center).addScaledVector(o.u, qu).addScaledVector(o.v, qv);
    const t = tForPoint(tmp.z, tmp.x, tmp.y, 0);
    pts.push(sectionPoint(tmp.z, t, inset));
  }
  return pts;
}

/** frame tunnel between outer and inner skin + lips */
function buildFrame(b, o, matTunnel, matLip) {
  const n = 48;
  const outer = openingOutline(o, 0, n, 0);
  const inner = openingOutline(o, HULL.inset, n, 0);
  const pos = [];
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    const A = outer[k], B = outer[k2], C = inner[k], D = inner[k2];
    pos.push(A.x, A.y, A.z, C.x, C.y, C.z, B.x, B.y, B.z, B.x, B.y, B.z, C.x, C.y, C.z, D.x, D.y, D.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  b.add(g, matTunnel);
  // outer lip ring (raised rim) and inner trim ring
  const lip = (pts, out, rad) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p, i) => p.clone().addScaledVector(o.normal, out)), true);
    b.add(new THREE.TubeGeometry(curve, n * 2, rad, 6, true), matLip);
  };
  lip(openingOutline(o, 0, n, 0.03), 0.015, 0.035);
  // inside: a slim steel trim (the bolted flange around it is part of the cabin furnishing)
  lip(openingOutline(o, HULL.inset, n, 0.03), -0.012, 0.018);
}

export function buildExterior(M) {
  const b = new Builder();
  // ---------- main skin ----------
  // (low quality: a coarser skin, still smooth at every distance it is seen from)
  const lowQ = QUALITY.level !== 'high', low2 = QUALITY.level === 'low2';
  const skin = loftGeometry(HULL.zTip + 0.002, HULL.zTail1, low2 ? 110 : lowQ ? 150 : 260, low2 ? 72 : lowQ ? 100 : 160, 0, false);
  b.add(skin, 'hullSkin');
  // aft closing ring/neck
  b.cyl(1.72, 1.72, 0.5, 'hullDark', [0, 0.4, HULL.zTail1 + 0.2], [Math.PI / 2, 0, 0], 48);
  b.add(new THREE.RingGeometry(0.2, 1.75, 48), 'hullDark', [0, 0.4, HULL.zTail1 + 0.45], [0, 0, 0]);

  // ---------- window frames ----------
  for (const o of OPENINGS) {
    if (o.kind === 'hatch') continue;
    buildFrame(b, o, 'metalDark', 'hullDark');
  }
  // (no canopy any more: the nose is closed, its cameras feed the cockpit's big screen)
  noseCameras(b);
  // hatch frame (airlock)
  const hatch = OPENINGS.find((o) => o.kind === 'hatch');
  buildFrame(b, hatch, 'metalDark', 'hullOrange');

  // ---------- reactor module ----------
  const zR0 = 11.0, zR1 = 15.2;
  b.cyl(1.45, 1.45, zR1 - zR0, 'mli', [0, 0.4, (zR0 + zR1) / 2], [Math.PI / 2, 0, 0], 40);
  for (let i = 0; i <= 6; i++) {
    const z = zR0 + (i / 6) * (zR1 - zR0);
    b.torus(1.47, 0.045, 'metal', [0, 0.4, z], [0, 0, 0], 48);
  }
  // longerons
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.box(0.08, 0.08, zR1 - zR0, 'metalDark', [Math.cos(a) * 1.5, 0.4 + Math.sin(a) * 1.5, (zR0 + zR1) / 2], [0, 0, a], 0.01);
  }
  // shadow shield (front of reactor)
  b.cyl(1.9, 1.9, 0.22, 'hullDark', [0, 0.4, zR0 - 0.15], [Math.PI / 2, 0, 0], 48);
  // radiation trefoil plate
  b.box(0.5, 0.5, 0.02, 'plasticY', [0, 1.95, 13.0], [-Math.PI / 2, 0, 0], 0.02);

  // ---------- radiators (two big fins) ----------
  for (const side of [-1, 1]) {
    b.push([side * 1.5, 0.4, 13.1], [0, 0, 0]);
    // root boom
    b.box(0.35, 0.18, 0.5, 'metalDark', [side * 0.25, 0, 0], null, 0.02);
    const W = 6.4, D = 3.4;
    b.box(W, 0.05, D, 'radiator', [side * (0.4 + W / 2), 0, 0], null, 0.01);
    // heat pipes
    b.fine(() => {
      for (let k = 0; k < 9; k++) {
        const z = -D / 2 + 0.2 + (k / 8) * (D - 0.4);
        b.cyl(0.03, 0.03, W, 'copper', [side * (0.4 + W / 2), 0.04, z], [0, 0, Math.PI / 2], 6);
        b.cyl(0.03, 0.03, W, 'copper', [side * (0.4 + W / 2), -0.04, z], [0, 0, Math.PI / 2], 6);
      }
    });
    // stiffener ribs
    for (let k = 0; k <= 4; k++) {
      b.box(0.06, 0.09, D, 'metal', [side * (0.4 + (k / 4) * W), 0, 0], null, 0.01);
    }
    b.pop();
  }

  // ---------- engine ----------
  const zE = 15.4;
  b.cyl(1.2, 1.45, 0.5, 'metalDark', [0, 0.4, zE], [Math.PI / 2, 0, 0], 32);
  // thrust frame struts
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const A = new THREE.Vector3(Math.cos(a) * 1.1, 0.4 + Math.sin(a) * 1.1, zE + 0.2);
    const B = new THREE.Vector3(Math.cos(a + 0.5) * 0.55, 0.4 + Math.sin(a + 0.5) * 0.55, zE + 1.0);
    b.pipe(A, B, 0.045, 'metal');
  }
  b.cyl(0.42, 0.5, 0.7, 'steel', [0, 0.4, zE + 0.9], [Math.PI / 2, 0, 0], 24); // turbopump housing
  // nozzle bell
  const bell = [];
  for (let i = 0; i <= 18; i++) {
    const f = i / 18;
    bell.push([0.28 + 0.92 * Math.pow(f, 0.62), f * 2.1]);
  }
  b.lathe(bell, 'nozzle', [0, 0.4, zE + 1.25], [Math.PI / 2, 0, 0], 40);
  b.lathe(bell.map(([r, y]) => [r - 0.035, y]).reverse(), 'nozzle', [0, 0.4, zE + 1.25], [Math.PI / 2, 0, 0], 40);
  b.torus(1.2, 0.05, 'metal', [0, 0.4, zE + 3.35], [0, 0, 0], 48);
  // gimbal actuators
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    b.pipe([Math.cos(a) * 0.9, 0.4 + Math.sin(a) * 0.9, zE + 0.25], [Math.cos(a) * 0.55, 0.4 + Math.sin(a) * 0.55, zE + 1.6], 0.04, 'steel');
  }

  // ---------- RCS quads ----------
  const rcsSpots = [];
  for (const z of [-7.6, 6.2]) {
    for (const t of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
      const p = sectionPoint(z, t, 0);
      const nrm = sectionNormal(z, t, 0);
      rcsSpots.push({ p: p.clone(), n: nrm.clone() });
      b.push([p.x, p.y, p.z], [0, 0, 0]);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
      const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      b.push([0, 0, 0], [e.x, e.y, e.z]);
      b.box(0.34, 0.22, 0.34, 'hullDark', [0, 0.08, 0], null, 0.04);
      // 4 small nozzles pointing in 4 directions
      b.fine(() => {
        for (const [dx, dz, rx, rz] of [[0.2, 0, 0, -Math.PI / 2], [-0.2, 0, 0, Math.PI / 2], [0, 0.2, Math.PI / 2, 0], [0, -0.2, -Math.PI / 2, 0]]) {
          b.cyl(0.03, 0.055, 0.1, 'nozzle', [dx, 0.1, dz], [rx, 0, rz], 10, true);
        }
      });
      b.cyl(0.03, 0.06, 0.1, 'nozzle', [0, 0.24, 0], [0, 0, 0], 10, true);
      b.pop(); b.pop();
    }
  }

  // ---------- antenna mast + dish (top) ----------
  const top = sectionPoint(2.6, Math.PI / 2, 0);
  b.cyl(0.08, 0.12, 0.9, 'metal', [top.x, top.y + 0.45, top.z], null, 12);
  b.box(0.3, 0.12, 0.3, 'hullDark', [top.x, top.y + 0.05, top.z], null, 0.03);
  // phased array panel (5G)
  const pa = sectionPoint(-2.8, Math.PI / 2, 0);
  b.box(1.3, 0.1, 0.9, 'hullDark', [pa.x, pa.y + 0.06, pa.z], null, 0.03);
  b.fine(() => { for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) b.box(0.16, 0.025, 0.16, 'metal', [pa.x - 0.5 + i * 0.2, pa.y + 0.12, pa.z - 0.3 + j * 0.2], null, 0.005); });
  // whip antennas
  for (const [z, t] of [[-6.5, Math.PI / 2 + 0.5], [4.0, Math.PI / 2 - 0.6], [-9.5, Math.PI / 2 + 0.9]]) {
    const p = sectionPoint(z, t, 0), n = sectionNormal(z, t, 0);
    b.pipe(p, p.clone().addScaledVector(n, 1.1), 0.012, 'metal', 6);
    b.fine(() => b.sphere(0.03, 'plasticK', p.clone().addScaledVector(n, 1.1).toArray(), 8));
  }
  // dorsal docking port (H8's berth) with its collar, and H8's power receptacle beside it
  buildPortExterior(b);
  // sensor turret (belly, front)
  const bt = sectionPoint(-8.0, -Math.PI / 2, 0);
  b.cyl(0.25, 0.32, 0.3, 'hullDark', [bt.x, bt.y - 0.12, bt.z], null, 20);
  b.sphere(0.22, 'black', [bt.x, bt.y - 0.3, bt.z], 16);
  // landing skids (retracted pads)
  for (const [x, z] of [[-1.6, -6], [1.6, -6], [-1.6, 4], [1.6, 4]]) {
    const yb = sectionPoint(z, x > 0 ? -Math.PI / 2 + 0.6 : -Math.PI / 2 - 0.6, 0);
    b.box(0.5, 0.12, 0.9, 'metalDark', [yb.x * 0.9, yb.y - 0.03, z], null, 0.04);
    b.fine(() => b.cyl(0.07, 0.07, 0.35, 'steel', [yb.x * 0.9, yb.y + 0.1, z - 0.3], null, 8));
  }
  // EVA handrails along the hull (top + lower flanks), kept clear of windows and the hatch
  const rails = [];
  const clearOf = (p, m) => {
    for (const o of OPENINGS) {
      const d = p.clone().sub(o.center);
      if (Math.abs(d.dot(o.normal)) > 0.6) continue;
      if (Math.abs(d.dot(o.u)) < o.halfW + m && Math.abs(d.dot(o.v)) < o.halfH + m) return false;
    }
    return true;
  };
  const railAB = (A, B, p0, p1) => {
    b.pipe(A, B, 0.02, 'handrail', 8);
    b.pipe(p0, A, 0.015, 'handrail', 6);
    b.pipe(p1, B, 0.015, 'handrail', 6);
    rails.push({ a: A, b: B });
  };
  for (const t of [Math.PI / 2 + 0.75, Math.PI / 2 - 0.75, -0.68, Math.PI + 0.68]) {
    for (let z = -8.6; z < 4.5; z += 1.6) {
      const p0 = sectionPoint(z, t, 0), p1 = sectionPoint(z + 1.0, t, 0);
      if (!clearOf(p0, 0.18) || !clearOf(p1, 0.18) || !clearOf(sectionPoint(z + 0.5, t, 0), 0.18)) continue;
      const n0 = sectionNormal(z, t, 0), n1 = sectionNormal(z + 1.0, t, 0);
      railAB(p0.clone().addScaledVector(n0, 0.12), p1.clone().addScaledVector(n1, 0.12), p0, p1);
    }
  }
  // grab bars on both sides of the airlock hatch + a boarding ladder down the flank
  const ladder = [];
  {
    const o = OPENINGS.find((x) => x.kind === 'hatch');
    const onHull = (q) => { const t = tForPoint(q.z, q.x, q.y, 0); return { p: sectionPoint(q.z, t, 0), n: sectionNormal(q.z, t, 0), t }; };
    for (const sv of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        const s = -o.halfW * 0.85 + (k / 6) * o.halfW * 1.7;
        const h = onHull(o.center.clone().addScaledVector(o.u, s).addScaledVector(o.v, sv * (o.halfH + 0.24)));
        pts.push(h.p.clone().addScaledVector(h.n, 0.12));
      }
      b.tube(pts, 0.02, 'handrail', { radial: 8 });
      const e0 = onHull(o.center.clone().addScaledVector(o.u, -o.halfW * 0.85).addScaledVector(o.v, sv * (o.halfH + 0.24)));
      const e1 = onHull(o.center.clone().addScaledVector(o.u, o.halfW * 0.85).addScaledVector(o.v, sv * (o.halfH + 0.24)));
      b.pipe(e0.p, pts[0], 0.015, 'handrail', 6);
      b.pipe(e1.p, pts[6], 0.015, 'handrail', 6);
      for (let k = 0; k < 6; k++) rails.push({ a: pts[k], b: pts[k + 1] });
    }
    // ladder: rungs from just below the hatch to near the belly
    const bottom = o.center.clone().addScaledVector(o.u, o.halfW + 0.12);
    const t0 = tForPoint(bottom.z, bottom.x, bottom.y, 0);
    let prev = null;
    for (let t = t0; t > -1.25; t -= 0.13) {
      const pc = sectionPoint(o.z, t, 0), n = sectionNormal(o.z, t, 0);
      const A = pc.clone().addScaledVector(n, 0.11).add(new THREE.Vector3(0, 0, -0.25));
      const B = pc.clone().addScaledVector(n, 0.11).add(new THREE.Vector3(0, 0, 0.25));
      b.pipe(A, B, 0.016, 'handrail', 8);
      for (const P of [A, B]) b.pipe(P, P.clone().addScaledVector(n, -0.11), 0.012, 'steel', 6);
      if (prev) { b.pipe(prev[0], A, 0.014, 'steel', 6); b.pipe(prev[1], B, 0.014, 'steel', 6); }
      prev = [A, B];
      rails.push({ a: A, b: B });
      ladder.push(pc.clone().addScaledVector(n, 0.11));
    }
  }
  // floodlights + nav lights housings
  const lights = {
    // nav lights sit aft of the airlock (at z = -1 the green one glowed right in the hatch opening)
    navPort: sectionPoint(3.4, Math.PI - 0.05, 0).addScaledVector(sectionNormal(3.4, Math.PI - 0.05, 0), 0.05),
    navStar: sectionPoint(3.4, 0.05, 0).addScaledVector(sectionNormal(3.4, 0.05, 0), 0.05),
    strobe: sectionPoint(4.2, Math.PI / 2, 0).addScaledVector(new THREE.Vector3(0, 1, 0), 0.12),
    flood1: sectionPoint(-3.0, Math.PI / 2 + 0.3, 0),
    flood2: sectionPoint(3.0, Math.PI / 2 - 0.3, 0),
    beacon: sectionPoint(-9.6, -Math.PI / 2, 0),
  };
  b.sphere(0.04, 'navRed', lights.navPort.toArray(), 10);
  b.sphere(0.04, 'navGreen', lights.navStar.toArray(), 10);
  b.sphere(0.045, 'navWhite', lights.strobe.toArray(), 10);
  // red danger beacons on the spine and the belly (flash when the ship is in trouble)
  for (const [z, t] of [[-3.4, Math.PI / 2], [6.0, Math.PI / 2], [-1.0, -Math.PI / 2]]) b.sphere(0.07, 'navDanger', sectionPoint(z, t, -0.02).toArray(), 12);
  for (const f of [lights.flood1, lights.flood2]) {
    b.box(0.24, 0.12, 0.18, 'hullDark', [f.x, f.y + 0.06, f.z], null, 0.03);
    b.box(0.2, 0.02, 0.14, 'lampCool', [f.x, f.y + 0.125, f.z], null, 0.005);
  }

  // hull lettering decals (both sides, below the windows)
  for (const side of [-1, 1]) {
    const z = -5.6, t = side > 0 ? -0.32 : Math.PI + 0.32;
    const p = sectionPoint(z, t, 0), n = sectionNormal(z, t, 0);
    const g = new THREE.PlaneGeometry(2.6, 1.3, 16, 8);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(side * Math.PI / 2));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(side, 0, 0), n);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
    const pa = g.attributes.position;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) {
      tmp.set(pa.getX(i), pa.getY(i), pa.getZ(i)).add(p);
      const tt = tForPoint(tmp.z, tmp.x, tmp.y, 0);
      const sp = sectionPoint(tmp.z, tt, 0);
      const sn = sectionNormal(tmp.z, tt, 0);
      sp.addScaledVector(sn, 0.008);
      pa.setXYZ(i, sp.x, sp.y, sp.z);
    }
    g.computeVertexNormals();
    b.add(g, 'decal');
  }

  // ---------- surface detail: greebles, conduit runs, engine bell cooling tubes ----------
  hullGreebles(b);
  b.fine(() => {
    const zE2 = 15.4;
    const prof = [];
    for (let i = 0; i <= 18; i++) { const f = i / 18; prof.push([0.28 + 0.92 * Math.pow(f, 0.62), f * 2.1]); }
    b.push([0, 0.4, zE2 + 1.25], [Math.PI / 2, 0, 0]);
    for (let k = 0; k < 64; k++) {
      const a = k / 64 * Math.PI * 2;
      const pts = prof.filter((_, i) => i % 2 === 0).map(([r, y]) => new THREE.Vector3(Math.cos(a) * (r + 0.012), y, Math.sin(a) * (r + 0.012)));
      b.tube(pts, 0.011, 'nozzle', { radial: 4, seg: 18 });
    }
    for (const f of [0.25, 0.55, 0.85]) { const r = 0.28 + 0.92 * Math.pow(f, 0.62); b.torus(r + 0.03, 0.025, 'metalDark', [0, f * 2.1, 0], [Math.PI / 2, 0, 0], 48); }
    b.pop();
  });

  // ---------- collision: outer skin (hatch cut out) + main external modules ----------
  b.colMesh(cutOpeningTris(cutOpeningTris(loftGeometry(HULL.zTip + 0.002, HULL.zTail1, 110, 72, 0, false), hatch, 0.06), OPENINGS.find((o) => o.kind === 'port'), 0.03));
  b.colCyl(1.72, 0.5, [0, 0.4, HULL.zTail1 + 0.2], [Math.PI / 2, 0, 0]);
  b.colCyl(1.5, zR1 - zR0, [0, 0.4, (zR0 + zR1) / 2], [Math.PI / 2, 0, 0]);
  b.colCyl(1.9, 0.22, [0, 0.4, zR0 - 0.15], [Math.PI / 2, 0, 0]);
  for (const side of [-1, 1]) b.colBox(6.6, 0.12, 3.4, [side * (1.9 + 3.2), 0.4, 13.1]);
  b.colCyl(1.3, 3.4, [0, 0.4, zE + 1.7], [Math.PI / 2, 0, 0]);
  // (LOW II: in sections along the ship, so from inside only what lies ahead of the eye is drawn)
  const group = b.build(M, QUALITY.level === 'low2' ? { chunks: [-6.5, -1.0, 4.0, 10.0] } : {});
  // the things mounted on the skin: their vertices in the merged meshes
  const mounts = b.mountList || [];
  group.traverse((o) => { if (o.isMesh && o.userData.mounts) for (const [id, start, count] of o.userData.mounts) if (mounts[id]) mounts[id].ranges.push({ mesh: o, start, count }); });
  return { group, rcsSpots, lights, rails, ladder, colliders: b.colliders, mounts };
}

/**
 * Hundreds of small parts on the skin: equipment boxes, canisters, vent grilles, sensor domes,
 * star trackers, cameras, cable conduits with clamps. Kept off windows, the hatch, the canopy,
 * the rails, the lettering and the heat-shielded belly.
 */
function hullGreebles(b) {
  const R = rng(2929);
  const railT = [Math.PI / 2 + 0.75, Math.PI / 2 - 0.75, -0.68, Math.PI + 0.68];
  const clear = (z, t, m) => {
    const p = sectionPoint(z, t, 0);
    if (inCanopy(p) || p.z < -10.2 || p.z > 10.0) return false;
    if (p.y < -0.85) return false;                                     // belly: heat-shield tiles only
    for (const o of OPENINGS) {
      const d = p.clone().sub(o.center);
      if (Math.abs(d.dot(o.normal)) > 0.8) continue;
      if (Math.abs(d.dot(o.u)) < o.halfW + m && Math.abs(d.dot(o.v)) < o.halfH + m) return false;
    }
    for (const rt of railT) if (Math.abs(t - rt) < 0.09 || Math.abs(t - rt - Math.PI * 2) < 0.09) return false;
    if (Math.abs(p.z + 5.6) < 1.5 && Math.abs(Math.abs(t > Math.PI ? t - Math.PI * 2 : t) - 0.32) < 0.4 && p.x > 0) return false;   // lettering
    if (Math.abs(p.z + 5.6) < 1.5 && Math.abs(t - (Math.PI - 0.32)) < 0.4) return false;
    if (Math.abs(p.z - 1.15) < 1.0 && Math.abs(t - Math.PI / 2) < 0.4) return false;    // docking port collar
    if (p.distanceTo(PORT.receptacle) < 0.6) return false;                                // power receptacle
    if ((Math.abs(p.z - 2.6) < 0.5 || Math.abs(p.z + 2.8) < 0.8) && Math.abs(t - Math.PI / 2) < 0.3) return false;   // mast, array
    for (const zr of [-7.6, 6.2]) if (Math.abs(p.z - zr) < 0.45) for (const tr of [1, 3, 5, 7]) if (Math.abs(t - tr * Math.PI / 4) < 0.18 || Math.abs(t + (8 - tr) * Math.PI / 4) < 0.18) return false;
    return true;
  };
  const frame = (z, t) => {
    const p = sectionPoint(z, t, 0), n = sectionNormal(z, t, 0);
    const zAxis = new THREE.Vector3(0, 0, 1).addScaledVector(n, -n.z).normalize();
    const xAxis = new THREE.Vector3().crossVectors(n, zAxis).normalize();
    const m = new THREE.Matrix4().makeBasis(xAxis, n, zAxis).setPosition(p);
    const e = new THREE.Euler().setFromRotationMatrix(m, 'YXZ');
    return { p, n, e };
  };
  // (each one tagged: torn off with the skin under it, damage.js finds its vertices)
  const mounts = b.mountList || (b.mountList = []);
  const keys = ['hullDark', 'hullDark', 'metal', 'mli', 'hull', 'metalDark'];
  let placed = 0, tries = 0;
  b.fine(() => { while (placed < 230 && tries < 4000) {
    tries++;
    const z = -9.8 + R() * 19.4, t = R() * Math.PI * 2 - Math.PI / 2;
    if (!clear(z, t, 0.22)) continue;
    const { p, n, e } = frame(z, t);
    b.mount = mounts.length;
    mounts.push({ p: p.clone(), n: n.clone(), ranges: [] });
    b.push(p.toArray(), [e.x, e.y, e.z]);
    const k = R();
    if (k < 0.34) {                                                   // equipment box with a lid line
      const w = 0.16 + R() * 0.34, h = 0.05 + R() * 0.1, d = 0.14 + R() * 0.38;
      const key = keys[Math.floor(R() * keys.length)];
      b.box(w, h, d, key, [0, h / 2 - 0.01, 0], null, Math.min(0.02, h * 0.3), 2);
      b.box(w * 0.8, 0.006, d * 0.04, 'metalDark', [0, h - 0.005, d * 0.3], null, 0);
      if (R() < 0.5) for (const sx of [-1, 1]) b.cyl(0.008, 0.008, 0.012, 'steel', [sx * w * 0.4, h, -d * 0.4], null, 6);
    } else if (k < 0.5) {                                            // canister pair on a cradle
      const r = 0.04 + R() * 0.06, l = 0.25 + R() * 0.35;
      b.box(r * 5, 0.025, l * 0.6, 'metalDark', [0, 0.012, 0], null, 0.005);
      for (const sx of [-1, 1]) {
        b.cyl(r, r, l, R() < 0.5 ? 'hull' : 'mli', [sx * r * 1.15, r + 0.03, 0], [Math.PI / 2, 0, 0], 12);
        b.sphere(r, 'hull', [sx * r * 1.15, r + 0.03, l / 2], 10, [1, 1, 0.5]);
      }
      for (const zz of [-l * 0.3, l * 0.3]) b.box(r * 5, 0.018, 0.025, 'steel', [0, r * 2 + 0.035, zz], null, 0.004);
    } else if (k < 0.62) {                                           // vent grille
      const w = 0.2 + R() * 0.25, d = 0.12 + R() * 0.2;
      b.box(w, 0.03, d, 'metalDark', [0, 0.012, 0], null, 0.008);
      for (let i = 0; i < 6; i++) b.box(w * 0.85, 0.012, 0.012, 'black', [0, 0.03, -d * 0.4 + i * d * 0.16], null, 0);
    } else if (k < 0.72) {                                           // sensor dome on a base
      b.cyl(0.07, 0.09, 0.05, 'hullDark', [0, 0.025, 0], null, 14);
      b.sphere(0.06, R() < 0.5 ? 'black' : 'plasticW', [0, 0.06, 0], 14, [1, 0.8, 1]);
    } else if (k < 0.8) {                                            // star tracker: baffle tube
      b.box(0.14, 0.08, 0.14, 'hullDark', [0, 0.04, 0], null, 0.01);
      b.cyl(0.045, 0.055, 0.18, 'black', [0, 0.14, 0.03], [0.5, 0, 0], 14, true);
      b.torus(0.05, 0.008, 'metal', [0, 0.22, 0.075], [0.5 + Math.PI / 2, 0, 0], 14);
    } else if (k < 0.88) {                                           // camera on a short mast
      b.cyl(0.015, 0.02, 0.18, 'metal', [0, 0.09, 0], null, 8);
      b.box(0.07, 0.06, 0.12, 'plasticW', [0, 0.2, 0.02], null, 0.012);
      b.cyl(0.022, 0.022, 0.02, 'black', [0, 0.2, 0.085], [Math.PI / 2, 0, 0], 12);
    } else {                                                         // flush panel cover with fasteners
      const w = 0.3 + R() * 0.4, d = 0.2 + R() * 0.35;
      b.box(w, 0.012, d, R() < 0.5 ? 'hull' : 'hullDark', [0, 0.004, 0], null, 0.004);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.cyl(0.01, 0.01, 0.008, 'steel', [sx * (w / 2 - 0.025), 0.012, sz * (d / 2 - 0.025)], null, 6);
    }
    b.pop();
    b.mount = null;
    placed++;
  } });
  // conduit runs along the flanks (broken around openings), clamped every 0.55 m (on low only the
  // thick one, without clamps)
  for (const t of [0.95, Math.PI - 0.95, -0.38, Math.PI + 0.38, Math.PI / 2 + 0.32, Math.PI / 2 - 0.32]) {
    for (const [r, key, off] of [[0.035, 'hullDark', 0.06], [0.022, 'mli', 0.11]]) {
      let run = [];
      const flush = () => {
        if (run.length > 3) {
          const pts = run.map((q) => q.p), cs = run.filter((_, i) => i % 2 === 0).map((q) => q.c);
          const tube = () => b.tube(pts, r, key, { radial: 8, seg: pts.length * 3 });
          if (r < 0.03) b.fine(tube); else tube();
          b.fine(() => { for (const c of cs) b.box(0.07, 0.03, 0.04, 'metalDark', c.toArray(), null, 0.006); });
        }
        run = [];
      };
      for (let z = -9.2; z <= 9.6; z += 0.275) {
        if (!clear(z, t, 0.3)) { flush(); continue; }
        const pp = sectionPoint(z, t, 0), n = sectionNormal(z, t, 0);
        run.push({ p: pp.clone().addScaledVector(n, off), c: pp.clone().addScaledVector(n, off * 0.5) });
      }
      flush();
    }
  }
}

/** glass panes for all windows (outer and inner pane) */
/**
 * Where the canopy was: a band of dark armoured glass over the nose (opaque: the cockpit sees out
 * through its cameras), with the camera lenses set into it — the big one in the middle, a pair to
 * each side, one low under the chin
 */
function noseCameras(b) {
  // the band: the old canopy's outline, just proud of the skin. Laid out along its own edge — for
  // each way round the nose, from the tip back to where the canopy's plane cuts the skin — so its
  // edge is the clean curve of that cut, with a dark metal lip along it
  const rings = 40, segs = 140, z0 = HULL.zTip + 0.001, lift = -0.012;
  const cols = [];
  for (let j = 0; j <= segs; j++) {
    const t = (j / segs) * Math.PI * 2 - Math.PI / 2;
    const zc = canopyZ(t, lift);
    cols.push(zc === null ? null : { t, zc });
  }
  const pos = [];
  const at = (c, i) => sectionPoint(z0 + (c.zc - z0) * (i / rings), c.t, lift);
  for (let j = 0; j < segs; j++) {
    const c0 = cols[j], c1 = cols[j + 1];
    if (!c0 || !c1) continue;
    for (let i = 0; i < rings; i++) {
      const A = at(c0, i), B = at(c1, i), C = at(c0, i + 1), D = at(c1, i + 1);
      // (wound to face out of the hull)
      for (const tri of [[A, D, C], [A, B, D]]) for (const p of tri) pos.push(p.x, p.y, p.z);
    }
  }
  const band = new THREE.BufferGeometry();
  band.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  band.computeVertexNormals();
  b.add(band, 'sensorGlass');
  const lip = cols.filter(Boolean).map((c) => sectionPoint(c.zc, c.t, lift - 0.004));
  if (lip.length > 3) b.tube(lip, 0.014, 'metalDark', { radial: 6, seg: lip.length * 2, tension: 0.2 });
  // the lenses: a dark eye in a bright rim, a status lamp beside it
  const m = new THREE.Matrix4();
  const lens = (z, t, r) => {
    const p = sectionPoint(z, t, -0.016), n = sectionNormal(z, t, 0);
    if (!inCanopy(p) && z > -13.0) return;
    const f = new THREE.Vector3(0, 0, -1).addScaledVector(n, n.z).normalize();
    const X = new THREE.Vector3().crossVectors(n, f).normalize();
    m.makeBasis(X, n, f.clone().negate()).setPosition(p);
    const add = (geo, key) => { geo.applyMatrix4(m); b.add(geo, key); };
    const rim = new THREE.CylinderGeometry(r * 1.25, r * 1.32, 0.03, 28);
    add(rim, 'metalDark');
    const ring = new THREE.TorusGeometry(r * 1.12, r * 0.08, 6, 28); ring.rotateX(Math.PI / 2); ring.translate(0, 0.016, 0);
    add(ring, 'metal');
    const glass = new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2); glass.scale(1, 0.35, 1); glass.translate(0, 0.012, 0);
    add(glass, 'lens');
    const led = new THREE.SphereGeometry(0.009, 8, 6); led.translate(r * 1.6, 0.01, 0);
    add(led, 'ledGreen');
  };
  lens(-12.55, Math.PI / 2, 0.075);
  for (const s of [-1, 1]) {
    lens(-12.2, Math.PI / 2 - s * 0.55, 0.05);
    lens(-12.85, Math.PI / 2 - s * 0.95, 0.045);
  }
  lens(-13.15, -Math.PI / 2 + 0.25, 0.04);
}

export function buildGlass(env) {
  const gOuter = [], gInner = [];
  for (const o of OPENINGS) {
    if (o.kind !== 'win') continue;
    const shape = roundedRectShape(o.halfW * 2 + 0.02, o.halfH * 2 + 0.02, o.radius + 0.01);
    for (const [inset, list] of [[0.035, gOuter], [HULL.inset - 0.02, gInner]]) {
      const g = new THREE.ShapeGeometry(shape, 12);
      // bend the pane slightly to follow the hull: project vertices to the surface (offset)
      const p = g.attributes.position;
      const tmp = new THREE.Vector3();
      const wuv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        const qu = p.getX(i), qv = p.getY(i);
        wuv[i * 2] = qu; wuv[i * 2 + 1] = qv;
        tmp.copy(o.center).addScaledVector(o.u, qu).addScaledVector(o.v, qv);
        const t = tForPoint(tmp.z, tmp.x, tmp.y, 0);
        const s = sectionPoint(tmp.z, t, inset);
        p.setXYZ(i, s.x, s.y, s.z);
      }
      g.computeVertexNormals();
      // ensure normals point outward
      const nAttr = g.attributes.normal;
      if (nAttr.getX(0) * o.normal.x + nAttr.getY(0) * o.normal.y + nAttr.getZ(0) * o.normal.z < 0) {
        const idx = g.index.array;
        for (let k = 0; k < idx.length; k += 3) { const t2 = idx[k]; idx[k] = idx[k + 2]; idx[k + 2] = t2; }
        g.computeVertexNormals();
      }
      const win = new Float32Array(p.count).fill(OPENINGS.indexOf(o));
      g.setAttribute('winId', new THREE.BufferAttribute(win, 1));
      g.setAttribute('wuv', new THREE.BufferAttribute(wuv, 2));
      list.push(g);
    }
  }
  const norm = (list) => list.map((g) => { let h = g.index ? g.toNonIndexed() : g; if (h.attributes.uv) h.deleteAttribute('uv'); fixNormals(h); return h; });
  return { outer: norm(gOuter), inner: norm(gInner) };
}

