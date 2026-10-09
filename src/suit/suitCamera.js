// The suit's camera: on top of the helmet, looking where the head looks. A 24–70 mm zoom (as a
// 35 mm camera's focal lengths) and a digital zoom of up to 5x on top — a crop of fewer and fewer
// sensor pixels, so the picture coarsens as it goes in. Worked like the H8 zoom: pinch or the
// buttons, the shutter takes a photograph. Its picture is shown on the visor's own display, the
// view through the glass replaced by it while it is on.
//
// A screen in the picture (a monitor aboard, a station's panel) is a picture of its own pixels:
// zoomed in digitally it shows them as they are — its resolution, not a smoothed blow-up of it.
import * as THREE from 'three';

export const FOCAL = [24, 70];   // mm
export const DIGITAL_MAX = 5;
const SENSOR_W = 36;             // mm: the 35 mm frame
const NOTCH = [24, 28, 35, 50, 70];

/** the horizontal field of view (deg) at a focal length (mm) */
export function hfovAt(f) { return 2 * Math.atan(SENSOR_W / 2 / f) * 180 / Math.PI; }

export class SuitCamera {
  constructor() {
    this.on = false;
    this.f = FOCAL[0];           // the lens (mm)
    this.fT = FOCAL[0];
    this.d = 1;                  // the digital zoom
    this.dT = 1;
    this.flash = 0;              // the shutter's blink
    this.health = 1;             // the camera's own health (the suit's 'camera' system)
    this._crisp = false;
  }

  /** the whole magnification against the widest view (for the zoom bar): 1 .. 70/24*5 */
  get zoom() { return this.f / FOCAL[0] * this.d; }
  get zoomMax() { return FOCAL[1] / FOCAL[0] * DIGITAL_MAX; }

  /** set the whole magnification (the bar, a pinch): the lens first, then the crop */
  setZoom(z) {
    z = Math.max(1, Math.min(this.zoomMax, z));
    const opt = Math.min(FOCAL[1] / FOCAL[0], z);
    this.fT = FOCAL[0] * opt;
    this.dT = z / opt;
  }

  /** a fraction of the bar (0 .. 1, logarithmic) */
  setFraction(t) { this.setZoom(Math.exp(Math.max(0, Math.min(1, t)) * Math.log(this.zoomMax))); }
  fraction() { return Math.log(this.zoom) / Math.log(this.zoomMax); }

  /** one notch in or out */
  step(dir) {
    if (this.dT > 1.01 || (dir > 0 && this.fT >= FOCAL[1] - 0.5)) {
      // in the digital range: whole steps
      const d = Math.max(1, Math.min(DIGITAL_MAX, Math.round(this.dT) + dir));
      if (d === 1 && dir < 0 && this.dT <= 1.01) { /* fall through to the lens */ } else { this.dT = d; this.fT = FOCAL[1]; return; }
    }
    const cur = this.fT;
    const next = dir > 0 ? NOTCH.find((n) => n > cur + 0.5) || FOCAL[1] : [...NOTCH].reverse().find((n) => n < cur - 0.5) || FOCAL[0];
    this.fT = next; this.dT = 1;
  }

  /** per frame: the lens drive (about a second end to end), the crop at once */
  update(dt) {
    const k = 1 - Math.exp(-dt * 5.5);
    this.f += (this.fT - this.f) * k;
    if (Math.abs(this.f - this.fT) < 0.05) this.f = this.fT;
    this.d += (this.dT - this.d) * Math.min(1, dt * 12);
    if (Math.abs(this.d - this.dT) < 0.01) this.d = this.dT;
    this.flash = Math.max(0, this.flash - dt * 4);
  }

  /** the view's horizontal field (deg): the lens's, narrowed by the crop */
  hfov() { return hfovAt(this.f) / this.d; }

  /**
   * The screens aboard drawn as their own pixels while the crop is on (nearest texels: their
   * resolution as it is), smoothed again when it is off. textures: the monitors' canvas textures
   */
  crispScreens(textures, on) {
    if (on === this._crisp) return;
    this._crisp = on;
    for (const t of textures) {
      if (!t) continue;
      t.magFilter = on ? THREE.NearestFilter : THREE.LinearFilter;
      t.needsUpdate = true;
    }
  }

  serialize() { return { f: +this.fT.toFixed(1), d: +this.dT.toFixed(2) }; }
  restore(s) { if (!s) return; this.f = this.fT = Math.max(FOCAL[0], Math.min(FOCAL[1], s.f || FOCAL[0])); this.d = this.dT = Math.max(1, Math.min(DIGITAL_MAX, s.d || 1)); }
}
