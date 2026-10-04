import { getRouteModel } from "../simulation/data.ts";
import { planJourney } from "../simulation/Journey.ts";
import { simulateJourney } from "../simulation/TrainController.ts";
import { dataBundle } from "../simulation/data.ts";
import type { RouteSummary } from "./routeSummary.ts";

let cached: RouteSummary | null = null;

/** Server-side: build the serializable summary (runs the simulation twice). */
export function getRouteSummary(): RouteSummary {
  if (cached) return cached;
  const route = getRouteModel();
  const first = route.stops[0].id;
  const last = route.stops[route.stops.length - 1].id;
  const runTimes = (fromId: string, toId: string) => {
    const traj = simulateJourney(planJourney(route, fromId, toId), route.operations);
    const out: number[] = [];
    for (let k = 1; k < traj.stops.length; k++) out.push(traj.stops[k].arriveTime - traj.stops[k - 1].departTime);
    return out;
  };
  const forward = runTimes(first, last);
  const reverse = runTimes(last, first).reverse();
  const ops = route.operations;
  const tracks = dataBundle.tracks;
  cached = {
    id: route.id,
    title: route.title,
    corridor: route.route.name,
    lineName: route.line.name,
    lineColourName: route.line.colourName,
    lineColour: route.line.colour,
    lineLengthKm: route.line.lengthKm ?? 0,
    lengthKm: route.route.lengthKm,
    statusLabel: route.route.statusLabel,
    openingDate: route.route.openingDate,
    headwayMinutes: route.route.headwayMinutes,
    trainsInService: route.route.trainsInService,
    operatingHours: route.route.operatingHours,
    reportedJourneyMinutes: route.route.reportedJourneyMinutes,
    fareMin: route.route.fares.min,
    fareMax: route.route.fares.max,
    lastVerified: route.lastVerified,
    stations: route.stations.map((s) => ({
      id: s.id,
      name: s.name,
      nameTa: s.nameTa,
      altNames: s.altNames,
      service: s.service,
      terminus: s.terminus,
      interchange: s.interchange,
      doubleDecker: s.doubleDecker,
      km: Math.round(s.km * 1000) / 1000,
      lat: s.coordinates.lat,
      lon: s.coordinates.lon,
      coordinateQuality: s.coordinateQuality,
      notes: s.notes,
    })),
    stopIds: route.stops.map((s) => s.id),
    segmentRun: { forward, reverse },
    ops: {
      originBoarding: ops.originBoardingSeconds,
      doorClosing: ops.doorClosingSeconds,
      settle: ops.settleBeforeDoorsSeconds,
      doorOpening: ops.doorOpeningSeconds,
      dwell: ops.dwellSeconds,
      terminusAlight: ops.terminusAlightSeconds,
    },
    doubleDecker: tracks.structures.doubleDecker
      ? { from: tracks.structures.doubleDecker.from, to: tracks.structures.doubleDecker.to, lengthKm: tracks.structures.doubleDecker.lengthKm }
      : null,
    speedSections: tracks.sections.map((s) => ({ from: s.from, to: s.to, maxSpeedKmh: s.maxSpeedKmh, status: s.status })),
    rollingStock: {
      manufacturer: tracks.rollingStock.manufacturer,
      family: tracks.rollingStock.family,
      cars: tracks.rollingStock.cars,
      lengthM: tracks.rollingStock.lengthM,
      operatingSpeedKmh: tracks.rollingStock.operatingSpeedKmh,
      designSpeedKmh: tracks.rollingStock.designSpeedKmh,
      capacity: tracks.rollingStock.capacityCrush,
      automation: tracks.rollingStock.automation,
    },
  };
  return cached;
}
