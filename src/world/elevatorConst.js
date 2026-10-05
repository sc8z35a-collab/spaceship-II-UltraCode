// Heights along the space elevator (metres above the anchor at sea level). Kept apart so the
// traffic, the ribbon and the models can share them without importing each other.
export const ELEVATOR_H = {
  mih: 420e3,                  // Mihashira, the low terminal station
  geo: 35786e3,                // Amaterasu, the geostationary port
  top: 96000e3,                // the counterweight rock's centre
  anchorTop: 150,              // top of the anchor tower: the ribbons leave it here
  anchorBerth: 164.4,          // ground-line berth (climber centre) on the anchor tower
  cwBerth: 96000e3 - 262,      // outer-line berth under the counterweight station
  cwEnd: 96000e3 - 228,        // the ribbons end in the counterweight station's keel
  deck: 49.6,                  // terminal towers: berth deck surface, metres from the station centre
};
