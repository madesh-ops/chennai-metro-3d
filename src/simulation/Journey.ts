import { RouteDataError, speedLimitAt, type RouteModel, type StationModel } from "./RouteController.ts";

export interface JourneyStop {
  station: StationModel;
  /** Journey-local distance from the origin platform (metres, modelled). */
  x: number;
}

export interface JourneyPass {
  station: StationModel;
  x: number;
}

export interface Journey {
  id: string;
  from: StationModel;
  to: StationModel;
  /** +1 = towards increasing alignment distance (west → east), -1 = reverse. */
  direction: 1 | -1;
  startDistance: number;
  endDistance: number;
  /** Modelled length in metres. */
  length: number;
  stops: JourneyStop[];
  passes: JourneyPass[];
  /** All stations in travel order with their journey-local distance. */
  sequence: { station: StationModel; x: number; kind: "stop" | "pass" }[];
  /** Speed limit changes in journey-local distance, sorted. */
  limits: { x0: number; x1: number; v: number }[];
  displayScale: number;
}

export function planJourney(route: RouteModel, fromId: string, toId: string): Journey {
  const from = route.stationById.get(fromId);
  const to = route.stationById.get(toId);
  if (!from) throw new RouteDataError(`Unknown origin station "${fromId}".`);
  if (!to) throw new RouteDataError(`Unknown destination station "${toId}".`);
  if (from.service !== "stop") throw new RouteDataError(`${from.name} is not served yet, so a journey cannot start there.`);
  if (to.service !== "stop") throw new RouteDataError(`${to.name} is not served yet, so a journey cannot end there.`);
  if (from.id === to.id) throw new RouteDataError("Choose two different stations.");

  const direction: 1 | -1 = to.distance > from.distance ? 1 : -1;
  const startDistance = from.distance;
  const endDistance = to.distance;
  const length = Math.abs(endDistance - startDistance);
  const toLocal = (d: number) => (d - startDistance) * direction;

  const lo = Math.min(from.order, to.order);
  const hi = Math.max(from.order, to.order);
  const inRange = route.stations.filter((s) => s.order >= lo && s.order <= hi);
  if (direction === -1) inRange.reverse();

  const sequence = inRange.map((station) => ({
    station,
    x: toLocal(station.distance),
    kind: station.service,
  }));
  const stops = sequence.filter((s) => s.kind === "stop").map(({ station, x }) => ({ station, x }));
  const passes = sequence.filter((s) => s.kind === "pass").map(({ station, x }) => ({ station, x }));

  // Piecewise-constant speed limits sampled along the journey.
  const limits: Journey["limits"] = [];
  const step = 5;
  let x0 = 0;
  let v0 = speedLimitAt(route, startDistance + direction * 0.5);
  for (let x = step; x <= length + step; x += step) {
    const xc = Math.min(x, length);
    const v = speedLimitAt(route, startDistance + direction * Math.max(0.5, xc - 0.5));
    if (v !== v0 || xc >= length) {
      limits.push({ x0, x1: xc, v: v0 });
      x0 = xc;
      v0 = v;
    }
    if (xc >= length) break;
  }

  return {
    id: `${from.id}__${to.id}`,
    from,
    to,
    direction,
    startDistance,
    endDistance,
    length,
    stops,
    passes,
    sequence,
    limits,
    displayScale: route.displayScale,
  };
}

/** Alignment distance for a journey-local distance. */
export const journeyToAlignment = (j: Journey, x: number) => j.startDistance + j.direction * x;

export function limitAt(j: Journey, x: number): number {
  for (const l of j.limits) if (x >= l.x0 && x < l.x1) return l.v;
  return j.limits[j.limits.length - 1]?.v ?? 22;
}
