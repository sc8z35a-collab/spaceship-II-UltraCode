// The walkable part of the Origin International Space Station, as data shared by its inside (built
// next to the docked B-29, ship-local metres) and its outside (the station model, station-local =
// ship-local + DOCK_AT). Every space is an axis-aligned box; neighbours stand 0.3 m apart and are
// joined by portals cut through both walls. The axis of the docking tunnel (y 1.22, z -1.05) runs
// on as the main corridor along +x, away from the ship.

/** spaces: x0..x1, y0..y1, z0..z1; sec: the air section; floor: rooms with a deck (y0 is it) */
export const ORIGIN_ROOMS = [
  { id: 'node', sec: 'lobby', name: '入港ノード', x0: 5.2, x1: 10.0, y0: -1.18, y1: 3.62, z0: -3.45, z1: 1.35 },
  { id: 'corr', sec: 'main', name: '中央通路', x0: 10.3, x1: 46.3, y0: 0.0, y1: 2.44, z0: -2.27, z1: 0.17 },
  { id: 'power', sec: 'main', name: '電力管制室', x0: 12.4, x1: 20.4, y0: -0.6, y1: 3.04, z0: -8.57, z1: -2.57, floor: true },
  { id: 'ops', sec: 'main', name: '運用管制センター', x0: 12.4, x1: 20.4, y0: -0.6, y1: 3.04, z0: 0.47, z1: 6.47, floor: true },
  { id: 'farm', sec: 'main', name: '水耕農場', x0: 22.4, x1: 33.4, y0: -1.2, y1: 3.64, z0: -10.57, z1: -2.57, floor: true },
  { id: 'food', sec: 'main', name: '食料庫', x0: 22.4, x1: 33.4, y0: -0.6, y1: 3.04, z0: 0.47, z1: 7.47, floor: true },
  { id: 'store', sec: 'warehouse', name: '物資倉庫', x0: 35.4, x1: 45.4, y0: -3.0, y1: 5.44, z0: -14.57, z1: -2.57, floor: true },
  { id: 'robot', sec: 'main', name: 'ロボット整備室', x0: 35.4, x1: 45.4, y0: -0.6, y1: 3.04, z0: 0.47, z1: 6.47, floor: true },
  { id: 'cupola', sec: 'cupola', name: '展望ノード', x0: 46.6, x1: 51.4, y0: -1.18, y1: 3.62, z0: -3.45, z1: 1.35 },
];

/** wall thickness of the outer skin */
export const ORIGIN_WALL = 0.22;

/**
 * openings between two spaces: n = the wall's normal axis, p = the opening's centre (mid-gap),
 * w = width across (z for an x-wall, x for a z-wall), h = height; door: an automatic pressure door
 * (its link: the two air sections)
 */
export const ORIGIN_PORTALS = [
  { a: 'node', b: 'corr', n: 'x', p: [10.15, 1.22, -1.05], w: 1.4, h: 1.9, door: true, link: ['lobby', 'main'] },
  { a: 'corr', b: 'power', n: 'z', p: [16.4, 1.22, -2.42], w: 1.4, h: 1.9 },
  { a: 'corr', b: 'ops', n: 'z', p: [16.4, 1.22, 0.32], w: 1.4, h: 1.9 },
  { a: 'corr', b: 'farm', n: 'z', p: [27.9, 1.22, -2.42], w: 1.4, h: 1.9 },
  { a: 'corr', b: 'food', n: 'z', p: [27.9, 1.22, 0.32], w: 1.4, h: 1.9 },
  { a: 'corr', b: 'store', n: 'z', p: [40.4, 1.22, -2.42], w: 1.4, h: 1.9, door: true, link: ['main', 'warehouse'] },
  { a: 'corr', b: 'robot', n: 'z', p: [40.4, 1.22, 0.32], w: 1.4, h: 1.9 },
  { a: 'corr', b: 'cupola', n: 'x', p: [46.45, 1.22, -1.05], w: 1.4, h: 1.9, door: true, link: ['main', 'cupola'] },
];

/**
 * holes in a space's walls to the outside: face '+x' .. '-z', (u, v) the centre in the face's own
 * axes (x-faces: z, y; y-faces: x, z; z-faces: x, y), w x h its size (r: corner radius).
 * kind 'tunnel' is where B-29's docking tunnel comes in.
 */
export const ORIGIN_WINDOWS = [
  { room: 'node', face: '-x', u: -1.05, v: 1.22, w: 1.56, h: 2.0, r: 0.45, kind: 'tunnel' },
  { room: 'node', face: '+y', u: 7.6, v: -1.05, w: 2.6, h: 2.6, r: 0.3 },
  { room: 'node', face: '-y', u: 7.6, v: -1.05, w: 1.8, h: 1.8, r: 0.9 },
  { room: 'power', face: '-z', u: 16.4, v: 1.35, w: 5.6, h: 1.7, r: 0.25 },
  { room: 'ops', face: '+z', u: 16.4, v: 1.45, w: 4.6, h: 1.4, r: 0.25 },
  { room: 'food', face: '+x', u: 3.97, v: 1.6, w: 1.2, h: 0.9, r: 0.2 },
  { room: 'robot', face: '+z', u: 40.4, v: 1.5, w: 3.0, h: 1.2, r: 0.25 },
  { room: 'cupola', face: '-y', u: 49.0, v: -1.05, w: 3.6, h: 3.6, r: 1.8, kind: 'cupola' },
  { room: 'cupola', face: '+x', u: -1.05, v: 1.22, w: 2.6, h: 2.6, r: 1.3 },
  { room: 'corr', face: '+y', u: 22.0, v: -1.05, w: 0.9, h: 0.9, r: 0.45 },
  { room: 'corr', face: '+y', u: 34.4, v: -1.05, w: 0.9, h: 0.9, r: 0.45 },
];

export const roomById = (id) => ORIGIN_ROOMS.find((r) => r.id === id);

/** the holes (portals and windows) in one face of a space, in the face's (u, v) axes */
export function holesOf(room, face) {
  const out = [];
  for (const w of ORIGIN_WINDOWS) if (w.room === room.id && w.face === face) out.push({ u: w.u, v: w.v, w: w.w, h: w.h, r: w.r || 0, kind: w.kind || 'window', win: w });
  const ax = face[1];
  for (const P of ORIGIN_PORTALS) {
    if (P.a !== room.id && P.b !== room.id) continue;
    if (P.n !== ax) continue;
    // the wall of this room the portal goes through: the one facing the other room
    const other = roomById(P.a === room.id ? P.b : P.a);
    const k = ax === 'x' ? 0 : 2;
    const sideP = P.p[k] > (room[ax + '0'] + room[ax + '1']) / 2 ? '+' : '-';
    if (face[0] !== sideP || !other) continue;
    if (ax === 'x') out.push({ u: P.p[2], v: P.p[1], w: P.w, h: P.h, r: 0.18, kind: 'portal', portal: P });
    else out.push({ u: P.p[0], v: P.p[1], w: P.w, h: P.h, r: 0.18, kind: 'portal', portal: P });
  }
  return out;
}
