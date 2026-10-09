// Where AKAMO stands on Shirasagi, in the B-29 frame at the station's berth (ship-local; the
// station frame is this plus DOCK_AT). No imports: the station's builders and the elevator share it.
//  - the lift: a glass tube from the core atrium's floor (beside the heron, clear of the axial
//    shaft) straight up through the dome and the tower to the berth's platform
//  - the berth: where the cabin's floor's middle lies when it is in, 7.4 m from the lift (the
//    lift's doors face the atrium's middle below and away from the shaft above)
export const AK_SITE = {
  lift: { x: 38.0, z: -6.0, r: 1.32, y0: -2.55 },
  berth: { x: 38.0 + 7.4 * 0.6, y: 48.25, z: -6.0 - 7.4 * 0.8 },
};
