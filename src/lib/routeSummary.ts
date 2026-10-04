/**
 * Serializable route summary for pages that don't need the 3D engine
 * (route planner, station pages). Built on the server from the full route
 * model; contains no three.js objects.
 */
export interface StationSummary {
  id: string;
  name: string;
  nameTa: string | null;
  altNames: string[];
  service: "stop" | "pass";
  terminus: boolean;
  interchange: string[];
  doubleDecker: boolean;
  km: number;
  lat: number;
  lon: number;
  coordinateQuality: string;
  notes: string;
}

export interface RouteSummary {
  id: string;
  title: string;
  corridor: string;
  lineName: string;
  lineColourName: string;
  lineColour: string;
  lineLengthKm: number;
  lengthKm: number;
  statusLabel: string;
  openingDate: string;
  headwayMinutes: number;
  trainsInService: number;
  operatingHours: string;
  reportedJourneyMinutes: number;
  fareMin: number;
  fareMax: number;
  lastVerified: string;
  stations: StationSummary[];
  stopIds: string[];
  /** Run time between consecutive stops (s): forward = west→east, reverse = east→west. */
  segmentRun: { forward: number[]; reverse: number[] };
  ops: {
    originBoarding: number;
    doorClosing: number;
    settle: number;
    doorOpening: number;
    dwell: number;
    terminusAlight: number;
  };
  doubleDecker: { from: string; to: string; lengthKm: number } | null;
  speedSections: { from: string; to: string; maxSpeedKmh: number; status: string }[];
  rollingStock: { manufacturer: string; family: string; cars: number; lengthM: number; operatingSpeedKmh: number; designSpeedKmh: number; capacity: number; automation: string };
}

export function stopIndex(s: RouteSummary, id: string) {
  return s.stopIds.indexOf(id);
}

/** Simulated journey time (s) — identical to what the 3D simulator plays. */
export function journeyDuration(s: RouteSummary, fromId: string, toId: string): number {
  const a = stopIndex(s, fromId);
  const b = stopIndex(s, toId);
  if (a < 0 || b < 0 || a === b) return 0;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const runs = a < b ? s.segmentRun.forward : s.segmentRun.reverse;
  let t = s.ops.originBoarding + s.ops.doorClosing;
  for (let k = lo; k < hi; k++) t += runs[k];
  const intermediate = hi - lo - 1;
  t += intermediate * (s.ops.settle + s.ops.doorOpening + s.ops.dwell + s.ops.doorClosing);
  t += s.ops.settle + s.ops.doorOpening + s.ops.terminusAlight;
  return t;
}

export function journeyDistanceKm(s: RouteSummary, fromId: string, toId: string): number {
  const a = s.stations.find((x) => x.id === fromId);
  const b = s.stations.find((x) => x.id === toId);
  if (!a || !b) return 0;
  return Math.abs(b.km - a.km);
}

export function stationsBetween(s: RouteSummary, fromId: string, toId: string) {
  const ia = s.stations.findIndex((x) => x.id === fromId);
  const ib = s.stations.findIndex((x) => x.id === toId);
  if (ia < 0 || ib < 0) return [];
  const slice = s.stations.slice(Math.min(ia, ib), Math.max(ia, ib) + 1);
  return ia <= ib ? slice : slice.reverse();
}
