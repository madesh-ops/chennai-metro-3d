import { DEFAULT_ROUTE_ID, getRouteModel } from "../simulation/data.ts";
import { planJourney } from "../simulation/Journey.ts";
import { simulateJourney } from "../simulation/TrainController.ts";
import { dataBundle } from "../simulation/data.ts";
import { createProjection } from "../utils/coordinates.ts";
import type { NetworkSummary, RouteSummary } from "./routeSummary.ts";

const cache = new Map<string, RouteSummary>();

/** Lines (ids) whose routes call at or pass each station. */
function linesByStation(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of dataBundle.routes.routes) {
    for (const id of r.stationIds) {
      if (!out.has(id)) out.set(id, new Set());
      out.get(id)!.add(r.line);
    }
  }
  return out;
}

/** Every route id, in routes.json order (the default route first). */
export function routeIds(): string[] {
  return dataBundle.routes.routes.map((r) => r.id);
}

/** Server-side: build the serializable summary of one route (runs the simulation twice). */
export function getRouteSummary(routeId: string = DEFAULT_ROUTE_ID): RouteSummary {
  const hit = cache.get(routeId);
  if (hit) return hit;
  const route = getRouteModel(routeId);
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
  const lines = linesByStation();
  const ids = new Set(route.route.stationIds);
  const dd = tracks.structures.doubleDecker;
  const summary: RouteSummary = {
    id: route.id,
    lineId: route.line.id,
    status: route.route.status,
    preview: route.route.status === "under-construction",
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
    fareSlabs: route.route.fares.bands?.slabs ?? [],
    fareBandsStatus: route.route.fares.bands?.status ?? "unknown",
    digitalDiscountPercent: route.route.fares.digitalDiscount?.percent ?? null,
    lastVerified: route.lastVerified,
    stations: route.stations.map((s) => ({
      id: s.id,
      name: s.name,
      nameTa: s.nameTa,
      altNames: s.altNames,
      service: s.service,
      terminus: s.terminus,
      // Other lines at this station (shared station ids across routes).
      interchange: [...(lines.get(s.id) ?? [])].filter((l) => l !== route.line.id).sort(),
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
    doubleDecker: dd && route.doubleDecker && ids.has(dd.from) && ids.has(dd.to) ? { from: dd.from, to: dd.to, lengthKm: dd.lengthKm } : null,
    speedSections: tracks.sections
      .filter((s) => ids.has(s.from) && ids.has(s.to))
      .map((s) => ({ from: s.from, to: s.to, maxSpeedKmh: s.maxSpeedKmh, status: s.status })),
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
  cache.set(routeId, summary);
  return summary;
}

/** Summaries of every route, in routes.json order. */
export function getAllRouteSummaries(): RouteSummary[] {
  return routeIds().map((id) => getRouteSummary(id));
}

/** The route a station page belongs to: the first route listing it (served routes before previews). */
export function routeForStation(stationId: string): RouteSummary | null {
  const all = getAllRouteSummaries();
  return all.find((r) => !r.preview && r.stations.some((s) => s.id === stationId)) ?? all.find((r) => r.stations.some((s) => s.id === stationId)) ?? null;
}

/** Douglas–Peucker in the plane. */
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, az] = pts[a];
    const [bx, bz] = pts[b];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - az) * dz) / l2));
      const d = Math.hypot(pts[i][0] - (ax + t * dx), pts[i][1] - (az + t * dz));
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > tol) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

let network: NetworkSummary | null = null;

/** All lines on one map: real track (simplified) and stations, in the shared city projection (m). */
export function getNetworkSummary(): NetworkSummary {
  if (network) return network;
  const net = dataBundle.network!;
  const proj = createProjection(net.meta.origin);
  const lineMeta = new Map(dataBundle.routes.lines.map((l) => [l.id, l]));
  const routes = getAllRouteSummaries();
  const stations = new Map<string, NetworkSummary["stations"][number]>();
  for (const r of routes) {
    for (const s of r.stations) {
      let st = stations.get(s.id);
      if (!st) {
        const [x, z] = proj.toLocal({ lat: s.lat, lon: s.lon });
        st = { id: s.id, name: s.name, nameTa: s.nameTa, x: Math.round(x), z: Math.round(z), lines: [], routes: [], open: false, end: false };
        stations.set(s.id, st);
      }
      if (!st.lines.includes(r.lineId)) st.lines.push(r.lineId);
      st.routes.push(r.id);
      if (!r.preview && s.service === "stop") st.open = true;
      if (s.id === r.stations[0].id || s.id === r.stations[r.stations.length - 1].id) st.end = true;
    }
  }
  network = {
    lines: net.lines.map((l) => {
      const meta = lineMeta.get(l.id);
      const lr = routes.filter((r) => r.lineId === l.id);
      return {
        id: l.id,
        name: meta?.name ?? l.name,
        colourName: meta?.colourName ?? l.name,
        colour: meta?.colour ?? "#888888",
        lengthKm: Math.round(l.lengthM / 100) / 10,
        routeIds: lr.map((r) => r.id),
        open: lr.some((r) => !r.preview),
        track: simplify(l.track as [number, number][], 12).map(([x, z]) => [Math.round(x), Math.round(z)] as [number, number]),
      };
    }),
    stations: [...stations.values()].map((s) => ({ ...s, lines: s.lines.sort() })),
  };
  return network;
}
