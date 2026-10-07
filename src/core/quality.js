// Graphics quality: 'high' (the full look), 'low' (about half the GPU work) or 'low2' (LOW II:
// well under half of low again).
// Low renders at ~0.72x the pixel ratio (about half the pixels), with lighter anti-aliasing and
// bloom, half the cabin lights, a quarter-size sun shadow map and no earthshine shadows, a coarser
// Earth terrain, single-projection surface detail on the ship, nearer cut-offs for far detail, and
// slower camera feeds and monitor redraws; on top of that the small, rarely noticed parts of the
// exteriors (bolts, greebles, clamps, cooling tubes...) are left out and the drones get a light
// model.
// LOW II goes further: 0.45x the pixel ratio (a fifth of the pixels), no anti-aliasing pass and a
// short bloom, a quarter of the cabin lights, a small sun shadow map redrawn every eighth frame,
// B-29's cabin and hull cut into sections so what is behind the viewer is not drawn, coarser
// curved parts and plain boxes, plain ship surfaces (no detail texture, grime or roughness noise),
// lighter sky, haze, clouds, ground, exhaust and re-entry fire, coarser sky and cloud shells, less
// texture filtering on the Earth; from inside the cabin the Earth, sky and stations are drawn only
// where the windows are; the stations out to 80 km, camera feeds and screens half as often again.
// The choice is kept in this browser; in a running game it applies at once (what was not built on
// a low start comes with the next start).
const KEY = 'b29.gfx';
const LEVELS = ['high', 'low', 'low2'];

export const QUALITY = { level: 'high' };

export function loadQuality() {
  try {
    const v = localStorage.getItem(KEY);
    if (LEVELS.includes(v)) QUALITY.level = v;
  } catch (e) { /* storage blocked: keep the default */ }
  // what the models were built at: started on low, the fine detail (bolts, greebles...) and the
  // close-up drone model do not exist until the next start
  QUALITY.builtLevel = QUALITY.level;
  QUALITY.builtLow = QUALITY.level !== 'high';
  return QUALITY.level;
}

export function saveQuality(level) {
  QUALITY.level = LEVELS.includes(level) ? level : 'high';
  try { localStorage.setItem(KEY, QUALITY.level); } catch (e) { /* not persisted */ }
  return QUALITY.level;
}

/** the next setting round: high -> low -> LOW II -> high */
export const nextQuality = (level = QUALITY.level) => LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length];

/** low or LOW II */
export const isLow = () => QUALITY.level !== 'high';
/** LOW II only */
export const isLow2 = () => QUALITY.level === 'low2';
export const QUALITY_JP = { high: '高', low: 'ロー', low2: 'ロー II' };
