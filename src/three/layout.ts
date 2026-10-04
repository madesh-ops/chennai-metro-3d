/**
 * World layout constants (metres). These are visual dimensions for the
 * procedural scene — not survey data — and live in one place so the
 * viaduct, road, stations and city stay consistent with each other.
 */
export const ROAD = {
  halfWidth: 13,
  medianHalf: 1.2,
  laneCentres: [2.95, 6.45, 9.95] as const,
  sidewalk: 3.6,
  kerb: 0.18,
};

/** Building frontage starts this far from the centreline. */
export const BUILDING_SETBACK = ROAD.halfWidth + ROAD.sidewalk + 1.2;

export const VIADUCT = {
  halfWidth: 4.8,
  /** Deck top below rail top. */
  deckTop: -0.42,
  girderBottom: -2.5,
  parapet: 0.95,
};

/** Steel portal columns stand this far either side of the centreline over a flyover. */
export const FLYOVER_PORTAL_OFFSET = 12.0;
/** Depth of the steel portal beam under the viaduct. */
export const PORTAL_BEAM_DEPTH = 0.9;
/** Tallest road vehicle (bus) height, for clearance checks. */
export const BUS_HEIGHT = 3.15;

export const PIER = {
  width: 2.2,
  depth: 1.7,
  capHeight: 1.3,
  capWidth: 7.4,
};

export const TRAIN = {
  carLength: 22.0,
  pitch: 22.6,
  width: 2.9,
  floor: 1.13,
  roof: 3.86,
};

export const STATION = {
  halfWidth: 9.6,
  canopyHeight: 7.4,
  /** Concourse underside, below rail level (concourses rise with the metro). */
  concourseBelowRail: 7.5,
  /** Concourse floor-to-roof height. */
  concourseHeight: 4.2,
  concourseHalfWidth: 17,
  concourseLength: 66,
};
