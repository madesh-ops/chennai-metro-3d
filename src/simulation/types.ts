/* ------------------------------------------------------------------------ */
/* Raw data shapes (mirrors src/data/*.json)                                 */
/* ------------------------------------------------------------------------ */

export type CoordinateQuality = "station" | "bus-stop" | "locality" | "interpolated";

export interface RawStation {
  id: string;
  name: string;
  nameTa: string | null;
  nameTaVerified: boolean;
  altNames: string[];
  type: string;
  service: "stop" | "pass";
  terminus?: boolean;
  interchange?: string[];
  coordinates: { lat: number; lon: number; quality: CoordinateQuality; source: string } | null;
  placement?: { between: [string, string]; fraction: number; quality: CoordinateQuality };
  notes: string;
}

export interface RawStationsFile {
  meta: {
    lastVerified: string;
    coordinateQuality: Record<string, string>;
    sources: Record<string, string>;
    [k: string]: unknown;
  };
  stations: RawStation[];
}

export interface RawLine {
  id: string;
  name: string;
  colourName: string;
  colour: string;
  colourNote?: string;
  lengthKm?: number;
  termini?: string[];
  status?: string;
  corridor?: string;
  source?: string;
}

export interface RawFlyover {
  id: string;
  name: string;
  shortName: string;
  nameTa?: string;
  nameTaVerified?: boolean;
  /** Side road it carries, and its ends measured from that road's junction with the corridor. */
  road: string;
  fromJunctionM: number;
  toJunctionM: number;
  lengthM: Tagged<number>;
  lanes: Tagged<number>;
  widthM: Tagged<number>;
  /** Deck-top height at the crest. */
  crestDeckM: Tagged<number>;
  /** Length of each ramp. */
  rampM: Tagged<number>;
  opened?: string;
  source: string;
}

/**
 * A road leaving the corridor at a station's junction: shares the corridor for
 * `westM` before it, then follows `path` ([alongM, southM] in the corridor's
 * frame at the junction).
 */
export interface RawSideRoad {
  id: string;
  name: string;
  atStation: string;
  westM: number;
  widthM: number;
  path: [number, number][];
  status: string;
  source: string;
}

/** A viaduct branching off the corridor, peeling away and landing on a side road. */
export interface RawBranch {
  line: string;
  /**
   * Leaves the double-decker on a circular arc: starts heading back along the
   * corridor (towards the route start) and turns towards `side` by turnDeg.
   */
  peelArc: { radiusM: number; turnDeg: number; note?: string };
  side: "north" | "south";
  /** Then follows this side road from the given distance past its junction. */
  landsOn: { road: string; fromJunctionM: number };
  /** Rail height falls from the upper deck to normal rail level between these branch distances. */
  descent: { fromM: number; toM: number; status: string };
  /** Street beneath the peel-away curve. */
  streetWidthM: number;
  status: string;
  source: string;
}

export interface RawRoute {
  id: string;
  line: string;
  name: string;
  title: string;
  stationIds: string[];
  lengthKm: number;
  status: string;
  statusLabel: string;
  openingDate: string;
  servedStationCount: number;
  passedStationCount: number;
  headwayMinutes: number;
  trainsInService: number;
  operatingHours: string;
  reportedJourneyMinutes: number;
  fares: {
    currency: string;
    min: number;
    max: number;
    examples: { from: string; to: string; fare: number }[];
    note: string;
    source: string;
    /** Distance-band chart: a fare per slab up to `upToKm` (null = beyond the last). */
    bands?: { status: string; note: string; source: string; slabs: FareSlab[] };
    /** Discount on digital tickets and the Singara Chennai (NCMC) card. */
    digitalDiscount?: { percent: number; status: string; appliesTo: string; source: string };
  };
  [k: string]: unknown;
}

export interface FareSlab {
  upToKm: number | null;
  fare: number;
}

export interface RawRoutesFile {
  meta: { lastVerified: string; sources: Record<string, string> };
  lines: RawLine[];
  routes: RawRoute[];
}

export interface Tagged<T> {
  value: T;
  status: "verified" | "reported" | "assumed";
  note?: string;
}

export interface RawTracksFile {
  meta: { lastVerified: string; summary: string; sources: Record<string, string> };
  alignment: {
    method: string;
    status: string;
    railLevelM: Tagged<number>;
    trackCentresM: Tagged<number>;
    gaugeMm: Tagged<number>;
    pierSpacingM: Tagged<number>;
    tailTrackM: Tagged<number>;
    driving: "left" | "right";
    drivingNote: string;
  };
  sections: {
    from: string;
    to: string;
    maxSpeedKmh: number;
    status: string;
    note?: string;
    source?: string;
  }[];
  structures: {
    doubleDecker: {
      from: string;
      to: string;
      lengthKm: number;
      lowerDeck: string;
      upperDeck: string;
      upperDeckHeightAboveRailM: Tagged<number>;
      status: string;
      source: string;
      /** Upper-deck line leaving the double-decker at its west (from) end. */
      line5West?: RawBranch;
    };
    /** Road flyovers, carried on side roads. */
    flyovers?: RawFlyover[];
    /** Roads leaving the corridor at junctions. */
    sideRoads?: RawSideRoad[];
    platform: {
      type: string;
      lengthM: Tagged<number>;
      widthM: Tagged<number>;
      heightAboveRailM: Tagged<number>;
    };
  };
  rollingStock: {
    manufacturer: string;
    family: string;
    cars: number;
    formation: string[];
    lengthM: number;
    widthM: Tagged<number>;
    heightM: Tagged<number>;
    doorsPerSide: Tagged<number>;
    capacityCrush: number;
    designSpeedKmh: number;
    operatingSpeedKmh: number;
    automation: string;
    livery: { status: string; note: string };
    source: string;
  };
  operations: OperationsParams & { status: string; note: string };
}

export interface OperationsParams {
  accelerationMps2: number;
  serviceBrakeMps2: number;
  maxBrakeMps2: number;
  jerkMps3: number;
  dwellSeconds: number;
  doorOpeningSeconds: number;
  doorClosingSeconds: number;
  settleBeforeDoorsSeconds: number;
  originBoardingSeconds: number;
  terminusAlightSeconds: number;
}

export type LandmarkModelType = "temple" | "lake" | "hospital" | "bus-stand" | "depot" | "mall" | "cinema" | "glass-mall";

/** Where a drawn landmark stands: published coordinates, or relative to a station. */
export type RawLandmarkPosition =
  | { lat: number; lon: number; /** Tie-break when the point sits on the road. */ side?: "north" | "south" }
  | { station: string; alongM: number; side: "north" | "south"; offsetM: number };

export interface RawLandmark {
  id: string;
  name: string;
  nameTa?: string;
  nameTaVerified?: boolean;
  kind: string;
  nearStation: string;
  description: string;
  source: string;
  /** Present only for landmarks drawn in 3D. */
  model?: { type: LandmarkModelType; along: number; depth: number; height?: number };
  position?: RawLandmarkPosition;
  positionQuality?: "verified" | "approximate";
  positionSource?: string;
}

export interface RawLandmarksFile {
  meta: { lastVerified: string; note: string };
  landmarks: RawLandmark[];
}

export interface DataBundle {
  stations: RawStationsFile;
  routes: RawRoutesFile;
  tracks: RawTracksFile;
  landmarks: RawLandmarksFile;
}

/* ------------------------------------------------------------------------ */
/* Simulation                                                               */
/* ------------------------------------------------------------------------ */

export type TrainState =
  | "idle"
  | "accelerating"
  | "cruising"
  | "braking"
  | "arriving"
  | "stopped"
  | "doors-open"
  | "doors-closing"
  | "departing";

export const TRAIN_STATES: readonly TrainState[] = [
  "idle",
  "accelerating",
  "cruising",
  "braking",
  "arriving",
  "stopped",
  "doors-open",
  "doors-closing",
  "departing",
];

/** The single source of truth the UI renders from (spec §31). */
export interface SimulationState {
  isPlaying: boolean;
  simulationSpeed: number;
  /** Index into journey.stops of the stop the train is at or last left. */
  currentStationIndex: number;
  /** Index into journey.stops of the next stop (equals current at the terminus). */
  nextStationIndex: number;
  /** 0..1 along the journey. */
  trainProgress: number;
  /** km/h */
  trainSpeed: number;
  /** metres, calibrated to the published route length */
  distanceTravelled: number;
  /** metres, calibrated */
  totalDistance: number;
  state: TrainState;
  /** simulation seconds since departure sequence began */
  elapsed: number;
  /** total simulated seconds of the journey */
  duration: number;
  /** seconds until the next stop arrives (0 when stopped) */
  etaNext: number;
  arrival: ArrivalPhase;
  finished: boolean;
}

export type ArrivalPhase =
  | "none"
  | "approaching"
  | "arrived"
  | "doors-opening"
  | "doors-open"
  | "doors-closing"
  | "departed";
