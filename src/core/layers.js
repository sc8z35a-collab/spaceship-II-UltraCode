// Multi-frustum render passes. Each pass has its own near/far range and a camera layer.
// Objects can live in several passes; the renderer draws FAR -> MID -> NEAR with depth clears.
export const LAYER_FAR = 1;
export const LAYER_MID = 2;
export const LAYER_NEAR = 3;
export const LAYER_CAMFEED = 5; // extra layer used to hide the player's own body etc. from feeds
// the cockpit seen at the eye's own view while the outside is magnified (H8's zoom: the cameras'
// picture on the display is magnified, the cockpit round it is not)
export const LAYER_CABIN = 6;

export const RANGES = {
  near: [0.03, 320],
  mid: [280, 130000],
  far: [110000, 2.0e9],
};

/** Assign pass layers from the distance interval [dmin,dmax] (metres from camera). */
export function assignLayers(obj, dmin, dmax) {
  const L = obj.layers;
  let mask = 0;
  if (dmin < RANGES.near[1]) mask |= 1 << LAYER_NEAR;
  if (dmax > RANGES.mid[0] && dmin < RANGES.mid[1]) mask |= 1 << LAYER_MID;
  if (dmax > RANGES.far[0]) mask |= 1 << LAYER_FAR;
  L.mask = mask | (L.mask & ((1 << LAYER_CAMFEED) | (1 << LAYER_CABIN)));
}

export function setLayers(obj, ...layers) {
  obj.layers.mask = 0;
  for (const l of layers) obj.layers.enable(l);
}

export function setLayersDeep(obj, ...layers) {
  obj.traverse((o) => setLayers(o, ...layers));
}
