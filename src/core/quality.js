// Graphics quality: 'high' (the full look) or 'low' (about half the GPU work). Low renders at
// ~0.72x the pixel ratio (about half the pixels), with lighter anti-aliasing and bloom, half the
// cabin lights, a quarter-size sun shadow map and no earthshine shadows, a coarser Earth terrain,
// single-projection surface detail on the ship, nearer cut-offs for far detail, and slower camera
// feeds and monitor redraws. The choice is kept in this browser and applies at once.
const KEY = 'b29.gfx';

export const QUALITY = { level: 'high' };

export function loadQuality() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'low' || v === 'high') QUALITY.level = v;
  } catch (e) { /* storage blocked: keep the default */ }
  return QUALITY.level;
}

export function saveQuality(level) {
  QUALITY.level = level === 'low' ? 'low' : 'high';
  try { localStorage.setItem(KEY, QUALITY.level); } catch (e) { /* not persisted */ }
  return QUALITY.level;
}

export const isLow = () => QUALITY.level === 'low';
export const QUALITY_JP = { high: '高', low: 'ロー' };
