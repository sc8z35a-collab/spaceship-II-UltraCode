// H8 — Kaito's old sub-base: a small armoured sphere, packed solid with computers, wiring, a
// compact reactor and a drive far stronger than B-29's. One person fits in its cockpit, sealed in
// the middle of it all; four dedicated cameras outside, stitched in real time, show the world on
// the cockpit's wrap-around display. It docks on B-29's back (the dorsal port), feeds on B-29's
// power through its high-speed coupling when its own reactor is not enough, and can push the
// pair along as their drive.
//
// H8-local frame (same axes as B-29 when docked): +X starboard, +Y up, -Z forward, +Z aft.
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const H8 = {
  // shells (radii, m): outer armour 0.28 thick, a Whipple gap with its standoff lattice, the inner
  // pressure armour 0.22 thick — both more than twice B-29's skin and wall
  R: 3.6,
  armourIn: 3.32,
  whippleIn: 3.12,
  innerIn: 2.9,
  // the cockpit in the middle: a 2.7 m sphere lined with the wrap-around display above and
  // equipment below; the pilot's eye sits close to its centre
  cockpitR: 1.35,
  cockpitC: V(0, 0.3, -0.3),
  floorY: -0.62,
  // the access shaft from the docking neck up into the cockpit floor (behind the seat)
  shaftR: 0.45,
  shaftZ: 0.35,
  // docking neck under the sphere: its mating ring sits on B-29's dorsal port ring
  neckR: 0.62,
  neckBottom: -4.3,
  // where H8's origin sits in B-29's frame when docked: the neck's mating ring on the top of
  // B-29's port tunnel (y 3.55) over the dorsal port at z 1.15
  dockAt: V(0, 7.85, 0.8),
  // the high-speed power coupling (H8-local, on the line to B-29's receptacle on the starboard
  // shoulder of its back, clear of the antenna mast) and that receptacle (B-29 local)
  couplingAt: V(1.154, -3.289, 0.897),
  b29Receptacle: V(1.8, 2.72, 2.2),
  // the hatch at the foot of the neck (H8-local) and the way it slides into its pocket (-x)
  neckHatchY: -4.08,
  neckHatchSlide: 0.96,
  // the point-defence laser (the comm terminal doubles as one)
  laserDir: V(0.86, 0.45, -0.24).normalize(),
  // drive: the plasma drive's magnetic nozzle at the stern, four auxiliary engines round it
  driveZ: 3.15,
  aux: [[1.55, 45], [1.55, 135], [1.55, 225], [1.55, 315]],
  // performance (B-29: 60 / 900 m/s, 15 m/s^2)
  speedMulInternal: 6,
  speedMulFed: 12,
  accel: 62,
  mass: 26000,
  reactorMW: 140,
  driveMW: { cruise: 120, boost: 310 },
  feedMW: 220,
  smesMJ: 90000,          // superconducting storage (MJ)
  // propellant for the plasma drive (its exhaust is twice as fast as B-29's)
  propKg: 5000,
  ve: 5.2e5,
};

/** the four cameras: one at the top, three round the lower hemisphere (tetrahedral cover) */
export const CAMERAS = (() => {
  const out = [{ id: 1, dir: V(0, 1, 0), name: 'CAM-1 天頂' }];
  const el = Math.asin(-1 / 3);
  const names = ['CAM-2 前方', 'CAM-3 右舷後方', 'CAM-4 左舷後方'];
  for (let k = 0; k < 3; k++) {
    const az = k * 2 * Math.PI / 3;           // 0 = forward (-z), turning to starboard
    out.push({ id: k + 2, dir: V(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize(), name: names[k] });
  }
  return out;
})();

/** cube-corner RCS quads */
export const RCS = (() => {
  const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push(V(sx, sy, sz).normalize());
  return out;
})();

/** directions kept clear of armour tiles (component cut-outs): { dir, ang (rad) } */
export function exclusions() {
  const ex = [];
  for (const c of CAMERAS) ex.push({ dir: c.dir, ang: 0.13 });
  ex.push({ dir: V(0, -1, 0.1).normalize(), ang: 0.22 });     // docking neck
  ex.push({ dir: V(0, 0, 1), ang: 0.4 });                      // drive mount (its plate covers the rest)
  for (const d of RCS) ex.push({ dir: d, ang: 0.075 });
  ex.push({ dir: H8.couplingAt.clone().normalize(), ang: 0.12 });
  ex.push({ dir: V(0, Math.sin(0.87), -Math.cos(0.87)), ang: 0.12 });   // radar dome
  return ex;
}
