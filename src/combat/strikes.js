// The strike damage engine: B-29, H8 and the hunter drones. A round that strikes leaves its mark
// exactly where it struck, and the same spot struck again goes one stage deeper:
//   B-29 (3 stages)  1 the paint and primer blasted off, the bare aluminium heat-tinted and pitted
//                    2 the skin torn open, the gold insulation blanket under it showing
//                    3 holed through: the blanket gone, the frames and cables bare, the pressure
//                      hull's dark wall at the bottom, the edges glowing (on the belly the stages
//                      are the tile's glaze, the tile, then the skin under it)
//   H8 (5 stages)    1 the coating burned off the armour   2 the ceramic face spalled and cracked
//                    3 the ceramic gone, the woven backing  4 the backing torn, the titanium
//                    honeycomb under it                     5 holed through to the inner wall
//   drones (3)       1 the paint chipped off the plate   2 the plate torn   3 holed, the insides
// Each stage peels out from where it struck (the new layer's ragged edge grows in a fraction of a
// second), throws out its pieces — paint flakes, curled skin, ceramic chips, shreds of the blanket,
// bits of the structure — on real ballistic paths (the vessel's own orbit plus the kick of the
// strike, tumbling as they go), with a shower of sparks. The last stage is the bad one: a big
// ragged hole, soot thrown far out round it, its edges glowing and cooling for half a minute.
//
// What the eye sees in a crater is worked out per pixel in the vessel's own material: its view ray
// is followed down through the layers (each its own depth and its own ragged outline) to the floor
// it reaches or the cut edge of the layer it meets on the way. The sites live in a small float
// texture (one column per site), so a hull can carry dozens of them.
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * stages; max sites; R: the damaged area's radius at each stage (m); D: each layer's floor below
 * the surface (m); capture: a strike this close to a site works on it (m); heavy: a blow this
 * heavy takes a site two stages at once (J); lip: the torn lip's height (m)
 */
export const STRIKE = {
  b29: { stages: 3, max: 40, R: [0.15, 0.3, 0.52], D: [0.0015, 0.032, 0.17], capture: 0.55, heavy: 1.2e6, lip: 0.004 },
  h8: { stages: 5, max: 32, R: [0.085, 0.14, 0.21, 0.3, 0.5], D: [0.0012, 0.008, 0.026, 0.055, 0.2], capture: 0.4, heavy: 6e6, lip: 0.003 },
  drone: { stages: 3, max: 10, R: [0.07, 0.12, 0.2], D: [0.001, 0.014, 0.08], capture: 0.2, heavy: 3e6, lip: 0.002 },
};

/** the uniforms a vessel's materials share with its strike sites */
export function strikeUniforms(kind) {
  const P = STRIKE[kind];
  const data = new Float32Array(P.max * 4 * 4);
  const tex = new THREE.DataTexture(data, P.max, 4, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tStrike: { value: tex }, uStrikeN: { value: 0 }, uStrikeTime: { value: 0 }, _data: data };
}
export const B29_STRIKE_U = strikeUniforms('b29');
export const H8_STRIKE_U = strikeUniforms('h8');

// ------------------------------------------------------------------ GLSL
const f3 = (x) => x.toFixed(4);
const vec3s = (c) => `vec3(${f3(c[0])}, ${f3(c[1])}, ${f3(c[2])})`;

// each vessel's layers: the floor of layer k (what is left showing once k layers are gone) and
// the cut edge of layer k (seen on the way down); kind: 0 the painted skin, 1 B-29's tiled belly
const PALETTE = {
  b29: {
    soot: [0.04, 0.036, 0.032], chip: [0.42, 0.44, 0.38], chipBelly: [0.85, 0.84, 0.8],
    floor: /* glsl */`
      // (fine detail fades out where a pixel spans more than it: no glitter far off)
      float n1 = mix(0.5, stN(q * 38.0 + seed * 13.0), fine), n2 = stN(q * 11.0 - seed * 7.0), n3 = mix(0.5, stN(q * 120.0 + seed), fine);
      if (k == 1) {
        if (kind > 0.5) {
          // the black glaze chipped off the tile: the white silica under it, gritty, grimy
          col = vec3(0.78, 0.77, 0.73) * (0.86 + 0.14 * n3) * (0.85 + 0.15 * n2); rough = 0.95; metal = 0.0; h = 0.0;
        } else {
          // the paint and primer blasted off: bare aluminium, scoured, the heat's colours toward
          // the middle (straw, bronze, a blue), scorched dark right at the middle
          col = vec3(0.66, 0.67, 0.69) * (0.9 + 0.1 * stN(vec2(q.x * 160.0, q.y * 6.0) + seed) * fine) * (0.92 + 0.08 * n2);
          vec3 temper = mix(vec3(0.9, 0.72, 0.45), vec3(0.5, 0.42, 0.66), smoothstep(0.3, 0.8, n2));
          col = mix(col, col * temper * 1.15, 0.6 * (1.0 - smoothstep(0.1, 0.8, rr)));
          col *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.35, rr)) * (0.6 + 0.4 * n1);
          rough = 0.42 + 0.12 * n1; metal = 0.7; h = 0.0;
        }
      } else if (k == 2) {
        if (kind > 0.5) {
          // the tile knocked out: the felt pad it sat on, the glue, the tile's broken edge
          float glue = smoothstep(0.45, 0.6, n2);
          col = mix(vec3(0.74, 0.72, 0.66), vec3(0.42, 0.37, 0.29), glue) * (0.9 + 0.1 * n3);
          rough = 0.95; metal = 0.0; h = glue * 0.001;
        } else {
          // the insulation blanket: crinkled gold foil (its creases a few centimetres apart), torn
          // through to the silver layers in places, charred toward the middle
          float cr = stN(q * 26.0 + seed * 5.0) * 0.65 + n1 * 0.35;
          col = vec3(0.66, 0.46, 0.15) * (0.6 + 0.65 * cr); rough = 0.26 + 0.2 * cr; metal = 0.8; h = cr * 0.004;
          float torn = smoothstep(0.62, 0.7, n2);
          col = mix(col, vec3(0.7, 0.72, 0.75) * (0.75 + 0.35 * cr), torn);
          // a stringer under it shows through a rip (primer green)
          float st = (1.0 - smoothstep(0.012, 0.016, abs(q.y - (fract(seed * 7.0) - 0.5) * 0.3))) * step(0.55, n2);
          col = mix(col, vec3(0.32, 0.37, 0.28), st); metal = mix(metal, 0.3, st); rough = mix(rough, 0.6, st);
          col = mix(col, vec3(0.05, 0.04, 0.03), (1.0 - smoothstep(0.1, 0.6, rr)) * 0.6 * (0.5 + 0.5 * n2));
        }
      } else {
        // holed through: the bay under the skin. The pressure hull's dark wall at the bottom, a
        // frame and a stringer across it (bent, the primer scorched), cut cables, shreds of the
        // blanket at the edges, embers
        col = vec3(0.075, 0.08, 0.085) * (0.75 + 0.45 * n2); rough = 0.7; metal = 0.4; h = 0.0;
        float bolts = (1.0 - smoothstep(0.004, 0.006, length(fract(q / 0.05) - 0.5) * 0.05)) * fine;
        col = mix(col, vec3(0.2), bolts * 0.6);
        float bend = 0.03 * sin(q.y * 9.0 + seed * 5.0) * (1.0 - rr);
        float fx = abs(q.x - (fract(seed * 3.1) - 0.5) * 0.25 - bend);
        float frame = 1.0 - smoothstep(0.022, 0.028, fx);
        float sy = abs(q.y - (fract(seed * 5.3) - 0.5) * 0.22 + bend * 0.6);
        float strg = 1.0 - smoothstep(0.011, 0.015, sy);
        float beam = max(frame, strg);
        vec3 primer = vec3(0.3, 0.36, 0.26) * (0.75 + 0.35 * n1);
        primer = mix(primer, vec3(0.04), smoothstep(0.2, 0.9, 1.0 - rr) * 0.7);
        col = mix(col, primer, beam); rough = mix(rough, 0.62, beam); metal = mix(metal, 0.25, beam); h = beam * 0.03;
        // cables crossing the bay, one cut short (its copper end glowing)
        for (int c = 0; c < 3; c++) {
          float fc = float(c);
          float yc = (fract(seed * (2.3 + fc)) - 0.5) * 0.3 + 0.025 * sin(q.x * 14.0 + fc * 2.0);
          float cw = 1.0 - smoothstep(0.006, 0.009, abs(q.y - yc));
          float cut = step(q.x, (fract(seed * 9.7 + fc) - 0.5) * 0.3);
          float band = step(0.8, fract(q.x * 6.0 + fc));
          vec3 cc = c == 0 ? vec3(0.02) : c == 1 ? vec3(0.45, 0.06, 0.04) : vec3(0.05, 0.12, 0.35);
          col = mix(col, mix(cc, vec3(0.6, 0.55, 0.2), band * 0.4), cw * cut); rough = mix(rough, 0.5, cw * cut); metal = mix(metal, 0.05, cw * cut); h = max(h, cw * cut * 0.04);
          float tip = cw * (1.0 - smoothstep(0.0, 0.012, abs(q.x - (fract(seed * 9.7 + fc) - 0.5) * 0.3)));
          em += vec3(1.0, 0.45, 0.12) * tip * (0.4 + 2.0 * ember) * step(0.5, fract(seed * 4.0 + fc * 0.37));
        }
        // shreds of the blanket hanging in from the edge
        float sh = smoothstep(0.55, 0.9, rr) * step(0.5, n2);
        col = mix(col, mix(vec3(0.6, 0.42, 0.14), vec3(0.62, 0.64, 0.66), step(0.7, n1)) * 0.7, sh); metal = mix(metal, 0.8, sh); rough = mix(rough, 0.35, sh);
        col *= 0.6 + 0.4 * smoothstep(0.3, 0.9, n3 + rr * 0.4);
        // embers: glowing specks, slowly going out
        float eb = step(0.94, stN(q * 90.0 + seed)) * ember;
        em += stGlow(0.5 + 0.5 * ember) * eb * (0.6 + 0.4 * sin(uStrikeTime * 7.0 + q.x * 300.0)) * 3.0;
      }`,
    wall: /* glsl */`
      float n1 = stN(vec2(q.x + q.y, z) * vec2(60.0, 900.0) + seed);
      if (k == 1) {
        col = kind > 0.5 ? vec3(0.05) : vec3(0.82, 0.83, 0.8); rough = 0.6; metal = 0.0;
      } else if (k == 2) {
        if (kind > 0.5) { col = vec3(0.84, 0.83, 0.79) * (0.85 + 0.15 * n1); rough = 0.95; metal = 0.0; }
        else {
          // the skin's cut edge (bright, bent), the dark gap under it
          float e = 1.0 - smoothstep(0.0025, 0.0045, z - ST_D1);
          col = mix(vec3(0.05, 0.05, 0.055), vec3(0.82, 0.83, 0.85), e); rough = mix(0.7, 0.25, e); metal = mix(0.3, 0.95, e);
          em += stGlow(heat) * e * heat * 1.6;
        }
      } else {
        // the blanket's layers (gold and silver foil, spacer) over the dark of the bay
        float lay = step(0.5, fract((z - ST_D2) * 420.0));
        float inBl = 1.0 - smoothstep(0.012, 0.016, z - ST_D2);
        col = mix(vec3(0.04, 0.04, 0.045), mix(vec3(0.6, 0.42, 0.14), vec3(0.66, 0.68, 0.7), lay) * (0.6 + 0.4 * n1), inBl);
        rough = mix(0.75, 0.3, inBl); metal = mix(0.3, 0.85, inBl);
        em += stGlow(0.4 + 0.6 * heat) * (1.0 - smoothstep(0.0, 0.03, z - ST_D2)) * (heat * 2.0 + ember * 0.5);
      }`,
  },
  h8: {
    soot: [0.03, 0.028, 0.026], chip: [0.55, 0.56, 0.58], chipBelly: [0.55, 0.56, 0.58],
    floor: /* glsl */`
      float n1 = mix(0.5, stN(q * 60.0 + seed * 13.0), fine), n2 = stN(q * 15.0 - seed * 7.0), n3 = mix(0.5, stN(q * 160.0 + seed), fine);
      if (k == 1) {
        // the armour's own steel, the coating burned off it: heat colours, grit-blasted
        col = vec3(0.56, 0.57, 0.6) * (0.85 + 0.15 * n3);
        vec3 temper = mix(vec3(0.82, 0.66, 0.4), vec3(0.4, 0.34, 0.66), smoothstep(0.3, 0.8, n2 + (1.0 - rr) * 0.3));
        col = mix(col, col * temper * 1.25, 0.6 * (1.0 - smoothstep(0.2, 0.9, rr)));
        rough = 0.36 + 0.15 * n1; metal = 0.9; h = (n3 - 0.5) * 0.0004;
      } else if (k == 2) {
        // the ceramic strike face, spalled: grainy grey-white, a net of cracks
        col = vec3(0.6, 0.6, 0.58) * (0.8 + 0.2 * n3);
        float a = atan(q.y, q.x);
        float rad = smoothstep(0.93, 1.0, abs(sin(a * (7.0 + floor(seed * 4.0)) + seed * 11.0 + 2.0 * n2)));
        float ring = smoothstep(0.9, 1.0, abs(sin(rr * 19.0 + n2 * 3.0)));
        float crack = max(rad, ring * 0.7);
        col = mix(col, vec3(0.08, 0.075, 0.07), crack * 0.85);
        rough = 0.8; metal = 0.0; h = -crack * 0.0012 + n3 * 0.0006;
      } else if (k == 3) {
        // the woven backing: aramid fibre, the weave frayed and scorched
        vec2 w = q * 160.0;
        float wa = smoothstep(0.2, 0.5, abs(sin(w.x + floor(w.y) * 1.57))) , wb = smoothstep(0.2, 0.5, abs(sin(w.y + floor(w.x) * 1.57)));
        float weave = mix(wa, wb, step(0.5, fract((floor(w.x / 3.1416) + floor(w.y / 3.1416)) * 0.5)));
        col = vec3(0.66, 0.55, 0.24) * (0.65 + 0.35 * weave) * (0.85 + 0.15 * n1);
        float fray = smoothstep(0.55, 0.75, n2) * smoothstep(0.3, 0.9, rr);
        col = mix(col, vec3(0.86, 0.78, 0.48), fray * 0.6);
        col = mix(col, vec3(0.06, 0.05, 0.03), smoothstep(0.5, 1.0, 1.0 - rr) * 0.6 * (0.5 + 0.5 * n3));
        rough = 0.88; metal = 0.0; h = weave * 0.0008;
      } else if (k == 4) {
        // the titanium honeycomb under the armour: cell walls bright, the cells dark, heat-blued
        vec2 hq = q / 0.012;
        vec2 r2 = vec2(1.0, 1.7320508);
        vec2 ha = mod(hq, r2) - r2 * 0.5, hb = mod(hq - r2 * 0.5, r2) - r2 * 0.5;
        vec2 hc = dot(ha, ha) < dot(hb, hb) ? ha : hb;
        vec2 ah = abs(hc);
        float hd = max(dot(ah, normalize(vec2(1.0, 1.7320508))), ah.x);
        float wall = smoothstep(0.42, 0.48, hd);
        vec3 ti = vec3(0.62, 0.64, 0.68) * mix(vec3(1.0), vec3(0.6, 0.55, 0.95), smoothstep(0.2, 0.9, 1.0 - rr + 0.2 * n2));
        col = mix(vec3(0.03, 0.03, 0.035), ti, wall);
        rough = mix(0.8, 0.3, wall); metal = mix(0.2, 0.92, wall); h = wall * 0.004;
        // crushed toward the middle
        float crush = smoothstep(0.4, 0.0, rr) * step(0.45, n2);
        col = mix(col, vec3(0.05), crush * 0.7);
      } else {
        // holed through: the inner pressure wall torn, the dark inside, cut wiring, glowing metal
        col = vec3(0.05, 0.05, 0.055) * (0.6 + 0.6 * n2); rough = 0.7; metal = 0.45; h = 0.0;
        float rib = 1.0 - smoothstep(0.012, 0.018, abs(fract(q.x / 0.09 + seed) - 0.5) * 0.09);
        col = mix(col, vec3(0.22, 0.23, 0.25) * (0.6 + 0.4 * n1), rib * 0.8); metal = mix(metal, 0.8, rib); h = rib * 0.02;
        for (int c = 0; c < 4; c++) {
          float fc = float(c);
          float yc = (fract(seed * (3.7 + fc)) - 0.5) * 0.22 + 0.02 * sin(q.x * 18.0 + fc * 1.3);
          float cw = 1.0 - smoothstep(0.004, 0.007, abs(q.y - yc));
          float cut = step(q.x, (fract(seed * 6.1 + fc * 0.71) - 0.5) * 0.2);
          vec3 cc = c == 0 ? vec3(0.6, 0.12, 0.05) : c == 1 ? vec3(0.02) : c == 2 ? vec3(0.75, 0.6, 0.1) : vec3(0.1, 0.2, 0.5);
          col = mix(col, cc, cw * cut); metal = mix(metal, 0.05, cw * cut); rough = mix(rough, 0.5, cw * cut); h = max(h, cw * cut * 0.03);
          float tip = cw * (1.0 - smoothstep(0.0, 0.01, abs(q.x - (fract(seed * 6.1 + fc * 0.71) - 0.5) * 0.2)));
          em += vec3(0.6, 0.8, 1.0) * tip * step(0.6, fract(uStrikeTime * (1.3 + fc) + seed * 3.0)) * 3.0;
        }
        col *= 0.5 + 0.5 * smoothstep(0.2, 0.9, n3 + rr * 0.5);
        float eb = step(0.92, stN(q * 170.0 + seed)) * ember;
        em += stGlow(0.45 + 0.55 * ember) * eb * (0.6 + 0.4 * sin(uStrikeTime * 6.0 + q.y * 400.0)) * 3.5;
      }`,
    wall: /* glsl */`
      float n1 = stN(vec2(q.x + q.y, z) * vec2(70.0, 900.0) + seed);
      if (k == 1) { col = vec3(0.12, 0.13, 0.14); rough = 0.7; metal = 0.1; }
      else if (k == 2) { col = vec3(0.6, 0.6, 0.58) * (0.75 + 0.25 * n1); rough = 0.75; metal = 0.6; }
      else if (k == 3) { col = vec3(0.76, 0.74, 0.7) * (0.7 + 0.3 * n1); rough = 0.85; metal = 0.0; }
      else if (k == 4) {
        float lay = step(0.5, fract((z - ST_D3) * 300.0));
        col = mix(vec3(0.5, 0.42, 0.2), vec3(0.3, 0.25, 0.12), lay) * (0.7 + 0.3 * n1); rough = 0.9; metal = 0.0;
      } else {
        // the honeycomb cut across, then the inner wall
        float cell = step(0.5, fract((q.x * 13.0 + q.y * 17.0) * 6.0));
        float inHc = 1.0 - smoothstep(0.0, 0.004, z - ST_D4 - 0.03);
        col = mix(vec3(0.06), mix(vec3(0.05), vec3(0.6, 0.62, 0.66), cell), inHc);
        rough = mix(0.7, 0.35, inHc * cell); metal = mix(0.4, 0.9, inHc * cell);
        em += stGlow(0.45 + 0.55 * heat) * (1.0 - smoothstep(0.0, 0.04, z - ST_D4)) * (heat * 2.4 + ember * 0.7);
      }`,
  },
  drone: {
    soot: [0.02, 0.018, 0.017], chip: [0.62, 0.63, 0.66], chipBelly: [0.62, 0.63, 0.66],
    floor: /* glsl */`
      float n1 = mix(0.5, stN(q * 90.0 + seed * 13.0), fine), n2 = stN(q * 26.0 - seed * 7.0), n3 = mix(0.5, stN(q * 220.0 + seed), fine);
      if (k == 1) {
        col = vec3(0.6, 0.61, 0.64) * (0.85 + 0.15 * n3);
        col = mix(col, col * vec3(0.8, 0.62, 0.45) * 1.2, 0.5 * (1.0 - smoothstep(0.2, 0.9, rr)));
        rough = 0.32 + 0.15 * n1; metal = 0.92; h = (n3 - 0.5) * 0.0003;
      } else if (k == 2) {
        // under the plate: the dark composite inner hull, blistered and scorched
        col = vec3(0.1, 0.085, 0.07) * (0.6 + 0.6 * n1); rough = 0.85; metal = 0.1; h = n1 * 0.001;
        em += stGlow(heat) * smoothstep(0.6, 1.0, 1.0 - rr) * heat * 1.2;
      } else {
        // holed: the drone's insides — boards, wiring, a coolant line, all of it scorched
        col = vec3(0.03, 0.035, 0.03) * (0.6 + 0.8 * n2); rough = 0.7; metal = 0.3;
        float board = step(0.55, n2) * (1.0 - smoothstep(0.0, 0.004, abs(fract(q.x * 40.0) - 0.5) - 0.42));
        col = mix(col, vec3(0.05, 0.25, 0.08), board * 0.7);
        float wire = 1.0 - smoothstep(0.003, 0.005, abs(q.y - 0.02 * sin(q.x * 40.0 + seed * 6.0)));
        col = mix(col, vec3(0.5, 0.08, 0.04), wire); h = wire * 0.01;
        float eb = step(0.9, stN(q * 200.0 + seed)) * ember;
        em += stGlow(0.5 + 0.5 * ember) * eb * 3.0 + vec3(1.0, 0.1, 0.04) * smoothstep(0.7, 1.0, 1.0 - rr) * (0.5 + 0.5 * sin(uStrikeTime * 9.0 + seed * 20.0)) * 0.8;
      }`,
    wall: /* glsl */`
      if (k == 1) { col = vec3(0.15); rough = 0.6; metal = 0.3; }
      else if (k == 2) { col = vec3(0.55, 0.56, 0.6); rough = 0.35; metal = 0.9; em += stGlow(heat) * heat * 1.5; }
      else { col = vec3(0.06, 0.05, 0.045); rough = 0.8; metal = 0.1; em += stGlow(0.4 + 0.6 * heat) * (heat * 2.0 + ember * 0.6) * (1.0 - smoothstep(0.0, 0.02, z - ST_D2)); }`,
  },
};

/**
 * The GLSL for one vessel's materials: uniforms, helpers and strikeAt(P, N, eye) -> StOut.
 * mode: 'deep' (the skin: the craters go down into it), 'surface' (fittings on it: burned and
 * sooted, no crater), 'cut' (decals, bullet pits: gone where the layer under them is)
 */
export function strikeGLSL(kind, mode = 'deep') {
  const P = STRIKE[kind], C = PALETTE[kind];
  const N = P.stages;
  const D = P.D.map(f3).join(', ');
  return /* glsl */`
uniform highp sampler2D tStrike;
uniform int uStrikeN;
uniform float uStrikeTime;
#define ST_N ${N}
const float ST_D[${N}] = float[${N}](${D});
${P.D.map((d, i) => `#define ST_D${i + 1} ${f3(d)}`).join('\n')}
struct StOut { float on; vec3 col; float rough; float metal; float ao; vec3 em; float bump; float soot; float chip; float layer; float kind; };
const vec3 ST_SOOT = ${vec3s(C.soot)};
const vec3 ST_CHIP = ${vec3s(C.chip)};
const vec3 ST_CHIP_B = ${vec3s(C.chipBelly)};
vec4 stT(int i, int r){ return texelFetch(tStrike, ivec2(i, r), 0); }
float stHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float stN(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(stHash(i), stHash(i + vec2(1.0, 0.0)), f.x), mix(stHash(i + vec2(0.0, 1.0)), stHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// noise round the circle (angle a; f: how many lumps round it): no seam where the angle wraps
float stA(float a, float f, float s){ return stN(vec2(cos(a), sin(a)) * f * 0.16 + vec2(s * 7.31, s * 3.17)); }
// metal glowing at heat x (0..1): dull red, orange, yellow-white
vec3 stGlow(float x){
  vec3 c = mix(vec3(0.85, 0.1, 0.02), vec3(1.0, 0.5, 0.1), smoothstep(0.25, 0.65, x));
  c = mix(c, vec3(1.0, 0.88, 0.65), smoothstep(0.7, 1.0, x));
  return c * x * x * 4.0;
}
// (set per pixel and per site by strikeAt: how much fine detail a pixel can carry; the site's
// frame and kind, for the belly's tiles)
float ST_FINE = 1.0;
float ST_KIND = 0.0;
vec3 ST_C = vec3(0.0), ST_T = vec3(1.0, 0.0, 0.0), ST_B = vec3(0.0, 1.0, 0.0);
// layer k's ragged outline at angle a (a site of radius R at stage S, the newest layer growing in)
float stR(int k, float S, float R, float a, float seed){
  float kf = float(k);
  float grow = clamp(S - kf + 1.0, 0.0, 1.0);
  float base = R * pow(max(0.0, 1.0 - (kf - 1.0) / max(1.0, S)), 0.72) * grow;
  float s = seed * 37.0 + kf * 11.3;
  float j = 0.15 * sin(3.0 * a + s) + 0.09 * sin(5.0 * a + s * 1.7) + 0.055 * sin(8.0 * a + s * 2.3)
          + (0.035 * sin(15.0 * a + s * 3.1) + 0.022 * sin(27.0 * a + s * 4.9) + 0.012 * sin(47.0 * a + s * 6.1)) * ST_FINE;
  // the last one: a hole torn ragged, deep irregular notches in it
  if (k == ST_N) j += 0.3 * pow(stA(a, 9.0, seed), 3.0) - 0.08 + 0.07 * (stA(a, 40.0, seed + 3.0) - 0.5) * ST_FINE;
  return base * (1.0 + j);
}
float stIn(vec2 q, int k, float S, float R, float seed){
  ${kind === 'b29' ? `// B-29's belly: the tiles go whole (in if its middle is), the glaze chips and the skin tears freely
  if (ST_KIND > 0.5 && k == 2) {
    vec3 w = ST_C + ST_T * q.x + ST_B * q.y;
    float zi = floor(w.z / 0.16);
    float xj = floor(w.x / 0.16 + zi * 0.5);
    vec3 tc = vec3((xj + 0.5 - zi * 0.5) * 0.16, w.y, (zi + 0.5) * 0.16);
    vec2 qc = vec2(dot(tc - ST_C, ST_T), dot(tc - ST_C, ST_B));
    return length(qc) - stR(k, S, R, atan(qc.y, qc.x), seed) * 0.9;
  }` : ''}
  return length(q) - stR(k, S, R, atan(q.y, q.x), seed);
}
void stFloor(int k, float kind, vec2 q, float rr, float seed, float heat, float ember, float fine, inout vec3 col, inout float rough, inout float metal, inout vec3 em, inout float h){
${C.floor}
}
void stWall(int k, float kind, float z, vec2 q, float seed, float heat, float ember, float fine, inout vec3 col, inout float rough, inout float metal, inout vec3 em){
${C.wall}
}
StOut strikeAt(vec3 P, vec3 Nn, vec3 eye, float pw){
  StOut o;
  ST_FINE = 1.0 - smoothstep(0.0025, 0.01, pw);
  o.on = 0.0; o.col = vec3(0.0); o.rough = 0.5; o.metal = 0.0; o.ao = 1.0; o.em = vec3(0.0); o.bump = 0.0; o.soot = 0.0; o.chip = 0.0; o.layer = 0.0; o.kind = 0.0;
  for (int i = 0; i < ${P.max}; i++){
    if (i >= uStrikeN) break;
    vec4 A = stT(i, 0);
    vec3 dp = P - A.xyz;
    float R = A.w;
    if (R <= 0.0 || dot(dp, dp) > R * R * 6.25) continue;
    vec4 B = stT(i, 1), C = stT(i, 2), E = stT(i, 3);
    vec3 n = B.xyz;
    if (abs(dot(dp, n)) > R * 0.8 + 0.06 || dot(Nn, n) < 0.15) continue;
    vec3 t = C.xyz, b = cross(n, t);
    vec2 q = vec2(dot(dp, t), dot(dp, b));
    float S = B.w, seed = C.w, heat = E.x, kind = E.y, ember = E.z;
    ST_KIND = kind; ST_C = A.xyz; ST_T = t; ST_B = b;
    float L = length(q), a = atan(q.y, q.x);
    float rr = L / R;
    float d1 = L - stR(1, S, R, a, seed);
    if (d1 > 0.0) {
      // round it: soot thrown out in spokes (further for the worse stages), the paint chipped
      // and blistered just outside the edge, the torn lip standing up, the edge still hot
      // (irregular lobes of it, longer where the blast went; thickest right at the edge)
      float lobes = stA(a, 5.0, seed) * 0.65 + stA(a, 14.0, seed + 1.7) * 0.35;
      float sk = S / float(ST_N);
      float e0 = stR(1, S, R, a, seed);
      float reach = e0 * (1.0 + 0.18 + 0.25 * sk + 0.55 * lobes * (0.6 + 0.6 * sk));
      float so = (1.0 - smoothstep(e0, reach, L)) * (0.5 + 0.5 * sk);
      so *= 0.8 + 0.2 * mix(0.5, stN(q * 30.0 + seed * 9.0), ST_FINE);
      o.soot = max(o.soot, so * so * (3.0 - 2.0 * so));
      // flakes of paint chipped off just outside the edge (the bare metal shows)
      float chip = smoothstep(0.62, 0.7, stN(q * 42.0 + seed * 7.0)) * (1.0 - smoothstep(0.0, R * 0.1 + 0.006, d1)) * (0.4 + 0.6 * ST_FINE);
      if (chip > o.chip) { o.chip = chip; o.kind = kind; }
      // the torn lip standing up round it, and a fresh one's edge still glowing
      o.bump += ${f3(P.lip)} * exp(-pow(d1 / (R * 0.05 + 0.004), 2.0)) * min(1.0, S);
      // (patches of it, not a ring)
      o.em += stGlow(heat * 0.85) * (1.0 - smoothstep(0.0, R * 0.06, d1)) * heat * heat * heat * 0.5 * smoothstep(0.55, 0.75, stA(a, 24.0, seed + 5.0));
      continue;
    }
    // inside it: which layers the surface itself is through
    float lay = 1.0;
    for (int k = 2; k <= ST_N; k++) { if (float(k) > S + 0.999) break; if (stIn(q, k, S, R, seed) < 0.0) lay = float(k); }
    o.layer = lay; o.kind = kind;
${mode === 'cut' ? '    return o;' : mode === 'surface' ? `
    // (a fitting on the skin: its paint burned off, no crater in it)
    vec3 col = vec3(0.0); float rough = 0.5, metal = 0.0, h = 0.0; vec3 em = vec3(0.0);
    stFloor(1, kind, q, rr, seed, heat, ember, ST_FINE, col, rough, metal, em, h);
    // (scorched black toward the middle, the worse the stage the further; embers in the last)
    float burnt = (1.0 - smoothstep(0.0, 0.45 + 0.4 * S / float(ST_N), rr)) * (0.55 + 0.4 * S / float(ST_N));
    col = mix(col, ST_SOOT, burnt);
    o.on = 1.0; o.col = col; o.rough = mix(rough, 0.9, burnt); o.metal = mix(metal, 0.1, burnt);
    o.em = em + stGlow(heat) * heat * 0.4 * (1.0 - rr) + stGlow(0.5 + 0.5 * ember) * step(0.93, stN(q * 70.0 + seed)) * ember * step(float(ST_N) - 0.01, S) * 2.0;
    return o;` : `
    // down into it along the eye's ray: through each layer to the floor it reaches, or the cut
    // edge of the layer it meets on the way
    vec3 vd = normalize(P - eye);
    float cosA = max(0.1, -dot(vd, n));
    vec2 v2 = vec2(dot(vd, t), dot(vd, b)) / cosA;
    int kF = 0, kW = 0; float z = 0.0; vec2 qz = q;
    float dPrev = 0.0;
    for (int k = 1; k <= ST_N; k++) {
      if (float(k) > S + 0.999) break;
      float Dk = ST_D[k - 1];
      bool hitWall = false;
      for (int j = 1; j <= 3; j++) {
        float zz = mix(dPrev, Dk, float(j) / 3.0);
        vec2 pp = q + v2 * zz;
        if (stIn(pp, k, S, R, seed) > 0.0) { kW = k; z = zz; qz = pp; hitWall = true; break; }
      }
      if (hitWall) break;
      kF = k; z = Dk; qz = q + v2 * Dk;
      if (k + 1 > ST_N || float(k + 1) > S + 0.999) break;
      if (stIn(qz, k + 1, S, R, seed) > 0.0) break;
      dPrev = Dk;
    }
    vec3 col = vec3(0.0); float rough = 0.5, metal = 0.0, h = 0.0; vec3 em = vec3(0.0);
    float rz = length(qz) / R;
    // (a thin bright line where a layer's cut edge meets the floor: the metal's own edge)
    if (kW > 0) stWall(kW, kind, z, qz, seed, heat, ember, ST_FINE, col, rough, metal, em);
    else stFloor(max(kF, 1), kind, qz, rz, seed, heat, ember, ST_FINE, col, rough, metal, em, h);
    // dark down in it, darker still close under its walls
    float dIn = -stIn(qz, max(max(kF, kW), 1), S, R, seed);
    float deep = smoothstep(0.0, ST_D[ST_N - 1], z);
    o.ao = (kW > 0 ? 0.4 : mix(0.45, 1.0, smoothstep(0.0, 0.015 + z * 0.5, dIn))) * (1.0 - 0.6 * deep);
    o.on = 1.0; o.col = col; o.rough = rough; o.metal = metal; o.em = em;
    o.bump = -z + h;
    return o;`}
  }
  return o;
}
`;
}

/** the bump of a strike as a normal (view space; the caller's normal and its derivatives) */
export const ST_BUMP = /* glsl */`
{
  vec2 _sdH = vec2(dFdx(_stBump), dFdy(_stBump));
  vec3 _ssx = dFdx(-vViewPosition), _ssy = dFdy(-vViewPosition);
  vec3 _sr1 = cross(_ssy, normal), _sr2 = cross(normal, _ssx);
  float _sdet = dot(_ssx, _sr1) * faceDirection;
  vec3 _sgrad = sign(_sdet) * (_sdH.x * _sr1 + _sdH.y * _sr2);
  if (abs(_sdet) > 1e-12) normal = normalize(abs(_sdet) * normal - _sgrad);
}`;

// ------------------------------------------------------------------ the sites
const _t = new THREE.Vector3();

export class StrikeSet {
  /** kind: 'b29' | 'h8' | 'drone'; U: the uniforms (strikeUniforms) the materials read; tangent:
   * (n) -> the site's tangent (B-29's run along the ship, so its frames lie across) */
  constructor(kind, U = strikeUniforms(kind), tangent = null) {
    this.kind = kind;
    this.P = STRIKE[kind];
    this.U = U;
    this.tangentOf = tangent;
    this.sites = [];
    this.t = 0;
  }

  get stages() { return this.P.stages; }

  /**
   * a strike at p (local) on a surface facing n (out), the round travelling along travel, with
   * energy E. Returns { site, from, to } (from 0: a new site)
   */
  hit(p, n, travel, E, o = {}) {
    const P = this.P;
    const steps = E > P.heavy * 5 ? 3 : E > P.heavy ? 2 : 1;
    const nn = n.clone().normalize();
    let s = null, best = Infinity;
    for (const x of this.sites) {
      const d = x.p.distanceTo(p);
      // (the same face of it: a strike on a plate's edge beside it still counts)
      if (d < Math.max(P.capture, x.R * 1.15) && x.n.dot(nn) > 0.2 && d < best) { best = d; s = x; }
    }
    let from = 0;
    if (s) {
      from = s.stage;
      s.stage = Math.min(P.stages, s.stage + steps);
      // (the crater spreads a little toward where this one struck)
      if (s.stage > from) s.p.lerp(p, 0.25 / from);
      s.hits++;
    } else {
      if (this.sites.length >= P.max) {
        // full: the least of them (lowest stage, then oldest) gives way
        let iMin = 0;
        this.sites.forEach((x, i) => { const y = this.sites[iMin]; if (x.stage < y.stage || (x.stage === y.stage && x.born < y.born)) iMin = i; });
        this.sites.splice(iMin, 1);
      }
      const t = this.tangentOf ? this.tangentOf(nn) : _t.set(0, 1, 0).cross(nn);
      if (t.lengthSq() < 1e-6) t.set(1, 0, 0).cross(nn);
      s = { p: p.clone(), n: nn, t: t.clone().normalize(), seed: Math.random(), stage: Math.min(P.stages, steps), shown: 0, R: 0, heat: 0, ember: 0, kind: o.kind || 0, hits: 1, born: this.t };
      this.sites.push(s);
    }
    // (at the last stage every further strike widens the hole a little, up to a third more)
    const Rs = P.R[s.stage - 1];
    s.Rt = s.stage === from ? Math.min(Rs * 1.33, (s.Rt || Rs) * 1.07) : Rs;
    s.heat = Math.min(1, s.heat + 0.75);
    if (s.stage === P.stages) s.ember = 1;
    this.dirty = true;
    return { site: s, from, to: s.stage };
  }

  /** the stages grow in, the heat goes out of them */
  update(dt) {
    this.t += dt;
    this.U.uStrikeTime.value = this.t;
    for (const s of this.sites) {
      if (s.shown < s.stage) { s.shown = Math.min(s.stage, s.shown + dt / 0.18); this.dirty = true; }
      if (s.R !== s.Rt) { s.R += (s.Rt - s.R) * Math.min(1, dt / 0.08); if (Math.abs(s.R - s.Rt) < 1e-4) s.R = s.Rt; this.dirty = true; }
      if (s.heat > 0) { s.heat = s.heat < 0.004 ? 0 : s.heat * Math.exp(-dt / 6); this.dirty = true; }
      if (s.ember > 0) { s.ember = s.ember < 0.004 ? 0 : s.ember * Math.exp(-dt / 28); this.dirty = true; }
    }
    if (this.dirty) this.sync();
  }

  sync() {
    this.dirty = false;
    const A = this.U._data, W = this.P.max;
    A.fill(0);
    const put = (row, i, a, b, c, d) => { const o = (row * W + i) * 4; A[o] = a; A[o + 1] = b; A[o + 2] = c; A[o + 3] = d; };
    const n = Math.min(W, this.sites.length);
    for (let i = 0; i < n; i++) {
      const s = this.sites[i];
      put(0, i, s.p.x, s.p.y, s.p.z, Math.max(1e-4, s.R));
      put(1, i, s.n.x, s.n.y, s.n.z, Math.max(0.001, s.shown));
      put(2, i, s.t.x, s.t.y, s.t.z, s.seed);
      put(3, i, s.heat, s.kind, s.ember, 0);
    }
    this.U.uStrikeN.value = n;
    this.U.tStrike.value.needsUpdate = true;
  }

  /** the deepest stage near p (for the systems: is the skin holed here?) */
  stageAt(p, r = 0.3) {
    let m = 0;
    for (const s of this.sites) if (s.p.distanceTo(p) < Math.max(r, s.R)) m = Math.max(m, s.stage);
    return m;
  }

  clear() { this.sites.length = 0; this.sync(); }

  serialize() { return this.sites.map((s) => [s.p.x, s.p.y, s.p.z, s.n.x, s.n.y, s.n.z, s.t.x, s.t.y, s.t.z, s.seed, s.stage, s.Rt || 0, s.kind].map((x) => +x.toFixed(4))); }

  restore(a) {
    this.sites.length = 0;
    for (const r of a || []) {
      const st = Math.max(1, Math.min(this.P.stages, Math.round(r[10])));
      const Rt = r[11] || this.P.R[st - 1];
      this.sites.push({ p: V(r[0], r[1], r[2]), n: V(r[3], r[4], r[5]).normalize(), t: V(r[6], r[7], r[8]).normalize(), seed: r[9], stage: st, shown: st, R: Rt, Rt, heat: 0, ember: 0, kind: r[12] || 0, hits: st, born: 0 });
    }
    this.sync();
  }
}

// ------------------------------------------------------------------ what flies off
// the pieces each stage throws: [count, size range (m), curl, outer colour, inner colour]
const PIECES = {
  b29: [
    [[5, 0.012, 0.03, 0.4, 0xd9dbd7, 0x8f9474]],                                    // paint flakes
    [[3, 0.05, 0.13, 1.1, 0xd9dbd7, 0xb9bdc3], [3, 0.02, 0.05, 0.6, 0xc9a24a, 0xd2d6da]],   // curled skin, foil
    [[4, 0.06, 0.2, 1.3, 0xd2d4d0, 0xaeb3b9], [4, 0.04, 0.1, 0.9, 0xc9a24a, 0xd2d6da], [2, 0.05, 0.12, 0.2, 0x56664a, 0x56664a]],   // skin, blanket, structure
  ],
  b29Belly: [
    [[5, 0.01, 0.03, 0.1, 0x151515, 0xe4e2dc]],
    [[3, 0.05, 0.1, 0.05, 0x151515, 0xe4e2dc]],
    [[3, 0.06, 0.16, 1.1, 0x9aa0a6, 0xb9bdc3], [3, 0.03, 0.08, 0.1, 0xe4e2dc, 0xe4e2dc]],
  ],
  h8: [
    [[4, 0.01, 0.025, 0.3, 0x5c6168, 0x8a8f96]],
    [[5, 0.015, 0.045, 0.05, 0xc9c6bf, 0xdcd9d2]],                                  // ceramic chips
    [[4, 0.03, 0.08, 0.8, 0xa58a3c, 0x7a6630]],                                     // backing shreds
    [[3, 0.04, 0.09, 0.3, 0xa6acb6, 0x8a9099]],                                     // honeycomb bits
    [[5, 0.07, 0.22, 0.9, 0x4c5158, 0x9aa0a8], [4, 0.03, 0.08, 0.4, 0xa6acb6, 0x6b7078], [3, 0.03, 0.06, 0.2, 0xa58a3c, 0x7a6630]],   // armour, all of it
  ],
  drone: [
    [[3, 0.008, 0.02, 0.3, 0x30343a, 0x9aa0a8]],
    [[3, 0.025, 0.06, 0.8, 0x3b4048, 0x8d949c]],
    [[5, 0.03, 0.1, 0.9, 0x3b4048, 0x8d949c], [3, 0.02, 0.05, 0.3, 0x1a1c1e, 0x5a2a18]],
  ],
};

const MATS = new Map();
/** a two-sided material for the pieces: paint on the outside, what was under it inside */
function pieceMat(outer, inner) {
  const k = outer + ':' + inner;
  if (MATS.has(k)) return MATS.get(k);
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide });
  const co = new THREE.Color(outer), ci = new THREE.Color(inner);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uOut = { value: co }; sh.uniforms.uIn = { value: ci };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uOut; uniform vec3 uIn;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = gl_FrontFacing ? uOut : uIn;');
  };
  m.customProgramCacheKey = () => 'strikePiece';
  MATS.set(k, m);
  return m;
}

/** a ragged piece of sheet (size: across, m), bent by curl */
function pieceGeometry(size, curl, rnd) {
  const n = 5 + Math.floor(rnd() * 4);
  const pos = [0, 0, 0];
  for (let i = 0; i <= n; i++) {
    const a = (i % n) / n * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const r = size * 0.5 * (0.55 + 0.45 * rnd());
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    pos.push(x, y, curl * (x * x) / Math.max(0.01, size) * 1.2 + (rnd() - 0.5) * size * 0.06);
  }
  const idx = [];
  for (let i = 1; i <= n; i++) idx.push(0, i, i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

let LIVE = [];              // the pieces flying (all vessels): the oldest go when there are too many
const LIVE_MAX = 90;

/**
 * The pieces and the sparks of a site going from stage `from` to `to`.
 * ctx: { combat, fx (particles in the vessel's frame), pos/quat/vel (the vessel in ECI), kind
 * ('b29' | 'b29Belly' | 'h8' | 'drone'), sound(p, k) }; p, n, travel in the vessel's frame
 */
export function strikeDebris(ctx, res, p, n, travel, E) {
  const s = res.site, final = res.to >= STRIKE[ctx.kind === 'b29Belly' ? 'b29' : ctx.kind].stages;
  const kStages = STRIKE[ctx.kind === 'b29Belly' ? 'b29' : ctx.kind].stages;
  const out = n.clone().normalize();
  // the bounce off the face: back out, the way a stone skips (and the spray of it round)
  const refl = travel.clone().normalize().reflect(out);
  // sparks: a shower off the face (more and faster the deeper it goes), molten drops from the
  // last stage
  if (ctx.fx) {
    const k = res.to / kStages;
    ctx.fx.burst('spark', p, out.clone().lerp(refl, 0.4).normalize(), Math.round(26 + 70 * k + (final ? 60 : 0)), { speed: 9 + 22 * k, spread: 1.1 });
    ctx.fx.burst('debris', p, out, Math.round(8 + 22 * k), { speed: 2.5 + 5 * k, spread: 1.2 });
    if (final) ctx.fx.burst('spark', p, out, 30, { speed: 3, spread: 1.6, life: 2.5 });
  }
  const C = ctx.combat;
  if (!C || !ctx.pos) return;
  const rnd = Math.random;
  const t1 = new THREE.Vector3().crossVectors(out, Math.abs(out.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize();
  const t2 = new THREE.Vector3().crossVectors(out, t1);
  for (let st = Math.max(1, res.from + 1); st <= res.to; st++) {
    const list = (PIECES[ctx.kind] || PIECES.b29)[st - 1] || [];
    for (const [count, s0, s1, curl, outer, inner] of list) {
      for (let i = 0; i < count; i++) {
        const size = s0 + (s1 - s0) * Math.pow(rnd(), 1.6);
        // (the smallest are only specks: particles do for them)
        if (size < 0.03) {
          if (ctx.fx) ctx.fx.burst('debris', p, out, 2, { speed: 3 + 8 * rnd(), spread: 1.0, size: size / 0.02 });
          continue;
        }
        const geo = pieceGeometry(size, curl * (0.5 + rnd()), rnd);
        const mesh = new THREE.Mesh(geo, pieceMat(outer, inner));
        mesh.castShadow = false;
        // where it comes off: somewhere on the ring being torn away
        const a = rnd() * Math.PI * 2, r = s.R * (0.25 + 0.6 * rnd());
        const at = p.clone().addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).addScaledVector(out, 0.01);
        // its kick: out of the face and along the bounce, the light ones faster
        const v = out.clone().multiplyScalar(2 + 9 * rnd() * (0.05 / Math.max(0.03, size)) ** 0.5)
          .addScaledVector(refl, (1 + 5 * rnd()) * Math.min(1, E / 3e5))
          .addScaledVector(t1, (rnd() - 0.5) * 3).addScaledVector(t2, (rnd() - 0.5) * 3);
        const posE = at.clone().applyQuaternion(ctx.quat).add(ctx.pos);
        const velE = ctx.vel.clone().add(v.applyQuaternion(ctx.quat));
        C.addWreck(mesh, posE, velE, 18 + rnd() * 10, Math.max(0.3, size * 2));
        const w = C.wrecks[C.wrecks.length - 1];
        // it starts lying where it was on the face, spinning the faster the smaller it is
        w.q.copy(ctx.quat).multiply(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), out));
        w.spin = (3 + 10 * rnd()) * Math.sqrt(0.06 / Math.max(0.03, size));
        LIVE.push(w);
      }
    }
  }
  // too many pieces about: the oldest are let go
  LIVE = LIVE.filter((w) => w.t < w.life);
  while (LIVE.length > LIVE_MAX) { const w = LIVE.shift(); w.t = w.life + 1; }
  if (ctx.sound) ctx.sound(p, res.to / kStages, final);
}

/**
 * A plain standard material (its mesh in the vessel's own frame, the vessel's matrix a rotation and
 * a move only) given a vessel's strike sites: the drones' armour.
 */
export function strikeMaterial(mat, kind, U, mode = 'deep') {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, { tStrike: U.tStrike, uStrikeN: U.uStrikeN, uStrikeTime: U.uStrikeTime });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStP; varying vec3 vStN; varying vec3 vStEye;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vStP = transformed; vStN = objectNormal;
        vStEye = transpose(mat3(modelMatrix)) * (cameraPosition - modelMatrix[3].xyz);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStP; varying vec3 vStN; varying vec3 vStEye;\n' + strikeGLSL(kind, mode))
      .replace('#include <color_fragment>', `#include <color_fragment>
        StOut _st = strikeAt(vStP, normalize(vStN), vStEye, length(fwidth(vStP)));
        float _stBump = _st.bump;
        diffuseColor.rgb = mix(diffuseColor.rgb, ST_SOOT, _st.soot * 0.9);
        diffuseColor.rgb = mix(diffuseColor.rgb, ST_CHIP, _st.chip * 0.85);
        if (_st.on > 0.5) diffuseColor.rgb = _st.col;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (_st.on > 0.5) roughnessFactor = _st.rough; else roughnessFactor = mix(roughnessFactor, 0.95, _st.soot * 0.8);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        if (_st.on > 0.5) metalnessFactor = _st.metal; else metalnessFactor = mix(metalnessFactor, 0.1, _st.soot * 0.8);`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + ST_BUMP)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= _st.ao; reflectedLight.indirectSpecular *= _st.ao;
        reflectedLight.directDiffuse *= mix(1.0, _st.ao, 0.7); reflectedLight.directSpecular *= _st.ao;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += _st.em;`);
  };
  const prevKey = mat.customProgramCacheKey && mat.hasOwnProperty('customProgramCacheKey') ? mat.customProgramCacheKey : null;
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|strike' + kind + mode;
  mat.needsUpdate = true;
  return mat;
}
