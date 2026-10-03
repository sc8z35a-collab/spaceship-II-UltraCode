// Astronomical constants, time and low-precision ephemerides.
// Engine frame ("ECI"): +Y = Earth's north pole, +X = vernal equinox, +Z = -Y_eci (right handed).
import * as THREE from 'three';

export const R_EARTH = 6371000.0;          // m (spherical Earth)
export const MU_EARTH = 3.986004418e14;    // m^3/s^2
export const OMEGA_EARTH = 7.2921159e-5;   // rad/s (sidereal)
export const R_MOON = 1737400.0;
export const AU = 1.495978707e11;
export const ATMO_TOP = 100000.0;          // m, visual/physical top of atmosphere
export const G0 = 9.80665;

const DEG = Math.PI / 180;

export function julianDate(unixMs) {
  return unixMs / 86400000.0 + 2440587.5;
}

/** Greenwich mean sidereal angle (radians) */
export function gmst(unixMs) {
  const n = julianDate(unixMs) - 2451545.0;
  let deg = 280.46061837 + 360.98564736629 * n;
  deg = ((deg % 360) + 360) % 360;
  return deg * DEG;
}

function eciToEngine(x, y, z, out) {
  return out.set(x, z, -y);
}

/** Unit vector from Earth to Sun (engine frame). */
export function sunDirection(unixMs, out = new THREE.Vector3()) {
  const n = julianDate(unixMs) - 2451545.0;
  const L = (280.460 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lam = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const x = Math.cos(lam);
  const y = Math.cos(eps) * Math.sin(lam);
  const z = Math.sin(eps) * Math.sin(lam);
  return eciToEngine(x, y, z, out).normalize();
}

/** Moon position relative to Earth centre, metres (engine frame). */
export function moonPosition(unixMs, out = new THREE.Vector3()) {
  const n = julianDate(unixMs) - 2451545.0;
  const Lp = (218.316 + 13.176396 * n) * DEG;
  const Mp = (134.963 + 13.064993 * n) * DEG;
  const F = (93.272 + 13.229350 * n) * DEG;
  const D = (297.850 + 12.190749 * n) * DEG;
  const M = (357.529 + 0.98560028 * n) * DEG;
  const lam = Lp + (6.289 * Math.sin(Mp) - 1.274 * Math.sin(Mp - 2 * D) + 0.658 * Math.sin(2 * D)
    - 0.186 * Math.sin(M) - 0.059 * Math.sin(2 * Mp - 2 * D) - 0.057 * Math.sin(Mp - 2 * D + M)) * DEG;
  const beta = (5.128 * Math.sin(F) + 0.281 * Math.sin(Mp + F) - 0.278 * Math.sin(F - Mp)) * DEG;
  const dist = (385001 - 20905 * Math.cos(Mp) - 3699 * Math.cos(2 * D - Mp) - 2956 * Math.cos(2 * D)) * 1000;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const xe = Math.cos(beta) * Math.cos(lam);
  const ye = Math.cos(beta) * Math.sin(lam);
  const ze = Math.sin(beta);
  const x = xe;
  const y = Math.cos(eps) * ye - Math.sin(eps) * ze;
  const z = Math.sin(eps) * ye + Math.cos(eps) * ze;
  return eciToEngine(x, y, z, out).multiplyScalar(dist);
}

/** Earth-fixed (rotating) unit vector for latitude/longitude in radians. */
export function latLonToUnit(lat, lon, out = new THREE.Vector3()) {
  const c = Math.cos(lat);
  return out.set(c * Math.cos(lon), Math.sin(lat), -c * Math.sin(lon));
}

export function unitToLatLon(v) {
  const r = v.length();
  return { lat: Math.asin(v.y / r), lon: Math.atan2(-v.z, v.x) };
}

/** Earth-fixed -> inertial (engine) given rotation angle theta. */
export function ecefToEci(v, theta, out = new THREE.Vector3()) {
  const c = Math.cos(theta), s = Math.sin(theta);
  // rotation about +Y by theta: x' = x c + z s ; z' = -x s + z c
  return out.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

export function eciToEcef(v, theta, out = new THREE.Vector3()) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return out.set(v.x * c - v.z * s, v.y, v.x * s + v.z * c);
}

export function circularSpeed(r) {
  return Math.sqrt(MU_EARTH / r);
}

// ---------------- atmosphere (physics) ----------------
/** Approximate air density (kg/m^3) for altitude in metres (piecewise exponential, US1976-ish). */
const ATM_TABLE = [
  // h(m), rho, H
  [0, 1.225, 7249],
  [25000, 3.899e-2, 6349],
  [30000, 1.774e-2, 6682],
  [40000, 3.972e-3, 7554],
  [50000, 1.057e-3, 8382],
  [60000, 3.206e-4, 7714],
  [70000, 8.770e-5, 6549],
  [80000, 1.905e-5, 5799],
  [90000, 3.396e-6, 5382],
  [100000, 5.297e-7, 5877],
  [110000, 9.661e-8, 7263],
  [120000, 2.438e-8, 9473],
  [130000, 8.484e-9, 12636],
  [140000, 3.845e-9, 16149],
  [150000, 2.070e-9, 22523],
  [180000, 5.464e-10, 29740],
  [200000, 2.789e-10, 37105],
  [250000, 7.248e-11, 45546],
  [300000, 2.418e-11, 53628],
  [350000, 9.518e-12, 53298],
  [400000, 3.725e-12, 58515],
  [450000, 1.585e-12, 60828],
  [500000, 6.967e-13, 63822],
  [600000, 1.454e-13, 71835],
  [700000, 3.614e-14, 88667],
  [800000, 1.170e-14, 124640],
  [900000, 5.245e-15, 181050],
  [1000000, 3.019e-15, 268000],
];
export function airDensity(h) {
  if (h < 0) h = 0;
  if (h > 1000000) return 0;
  let i = ATM_TABLE.length - 1;
  while (i > 0 && ATM_TABLE[i][0] > h) i--;
  const [h0, rho0, H] = ATM_TABLE[i];
  return rho0 * Math.exp(-(h - h0) / H);
}

/** Speed of sound (m/s), rough */
export function speedOfSound(h) {
  if (h < 11000) return 340.3 - 0.0039 * h;
  if (h < 20000) return 295;
  if (h < 47000) return 295 + (h - 20000) * 0.00148;
  if (h < 71000) return 335 - (h - 47000) * 0.0011;
  return 290;
}

/** Atmospheric pressure (Pa) at altitude */
export function airPressure(h) {
  return airDensity(h) * 287.05 * (h < 11000 ? 288.15 - 0.0065 * h : 216.65);
}

export function formatDate(unixMs) {
  // JST display
  const d = new Date(unixMs + 9 * 3600000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return {
    date: `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
    sec: p(d.getUTCSeconds()),
  };
}
