import { Alignment, type Vec2 } from "./Alignment.ts";
import { centroid, createProjection, type LatLon, type LocalProjection } from "../utils/coordinates.ts";
import type {
  CoordinateQuality,
  LandmarkModelType,
  DataBundle,
  OperationsParams,
  RawBranch,
  RawNetworkLine,
  RawNetworkStation,
  RawNeighbourhood,
  NeighbourhoodStyle,
  RawFlyover,
  RawLandmark,
  RawSideRoad,
  RawLine,
  RawRoute,
  RawStation,
  RawTracksFile,
} from "./types.ts";

export class RouteDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteDataError";
  }
}

export interface StationModel {
  id: string;
  name: string;
  nameTa: string | null;
  nameTaVerified: boolean;
  altNames: string[];
  type: string;
  service: "stop" | "pass";
  terminus: boolean;
  interchange: string[];
  notes: string;
  /** Index along the route's station list (west → east). */
  order: number;
  coordinates: LatLon;
  coordinateQuality: CoordinateQuality;
  coordinateSource: string | null;
  /** Distance along the alignment in metres (includes the western tail track). */
  distance: number;
  /** Calibrated km from the first station of the route. */
  km: number;
  local: Vec2;
  doubleDecker: boolean;
}

export interface SpeedSection {
  start: number;
  end: number;
  /** m/s */
  maxSpeed: number;
  status: string;
}

export interface RouteParams {
  railLevel: number;
  trackCentres: number;
  gauge: number;
  pierSpacing: number;
  tailTrack: number;
  platformLength: number;
  platformWidth: number;
  platformHeight: number;
  upperDeckHeight: number;
  driving: "left" | "right";
}

/** A landmark drawn in 3D, resolved onto the alignment. */
export interface LandmarkPlacement {
  landmark: RawLandmark;
  type: LandmarkModelType;
  /** Footprint along the road and away from it (metres). */
  along: number;
  depth: number;
  height?: number;
  /** Alignment distance of the footprint centre. */
  distance: number;
  /** Signed metres right of increasing distance (+ = right); not yet clear of the road. */
  lateral: number;
}

/** A viaduct branching off the corridor (Line 5 leaving the double-decker). */
export interface BranchModel {
  raw: RawBranch;
  /** Which end of the double-decker it leaves from. */
  end: "west" | "east";
  line: RawLine | null;
  /** Branch centreline, distance 0 at the junction. */
  alignment: Alignment;
  /** Corridor distance where it leaves (the upper deck's end). */
  junction: number;
  /** World points of the traced path (for roads and clearances). */
  points: Vec2[];
  /** Rail height at branch distance s. */
  railAt: (s: number) => number;
  /** Branch distance where it lands on its side road (or its end, for a branch that runs on), and that road. */
  landS: number;
  road: SideRoadModel | null;
}

/** A road leaving the corridor at a junction (Mount–Poonamallee Road, Kundrathur Road). */
export interface SideRoadModel {
  raw: RawSideRoad;
  alignment: Alignment;
  /** Road distance at the junction with the corridor (0 if it starts there). */
  junctionS: number;
  /** Corridor distance of the junction. */
  junctionD: number;
  width: number;
}

/** A road flyover on a side road (the MGR flyover on Mount–Poonamallee Road). */
export interface FlyoverModel {
  raw: RawFlyover;
  road: SideRoadModel;
  /** Road distances of its ends. */
  startS: number;
  endS: number;
  halfWidth: number;
  crest: number;
  /** Deck-top height at road distance s (0 outside the flyover). */
  heightAt: (s: number) => number;
  /** Corridor distances where the flyover sits in the corridor road (beneath the metro). */
  corridorFrom: number;
  corridorTo: number;
  /** Deck height under the corridor at corridor distance d, while the two coincide (up to the junction). */
  corridorHeightAt: (d: number) => number;
}

export interface NeighbourhoodModel {
  raw: RawNeighbourhood;
  from: number;
  to: number;
  right: NeighbourhoodStyle | null;
  left: NeighbourhoodStyle | null;
}

/** How far the upper deck reaches beyond the double-decker's end stations, unless a branch says otherwise. */
export const UPPER_DECK_OVERHANG = 160;

export interface RouteModel {
  id: string;
  title: string;
  line: RawLine;
  route: RawRoute;
  stations: StationModel[];
  stationById: Map<string, StationModel>;
  stops: StationModel[];
  alignment: Alignment;
  /** Alignment distance of the first / last station. */
  startDistance: number;
  endDistance: number;
  /** Published length ÷ modelled length, used for displayed distances. */
  displayScale: number;
  officialLengthM: number;
  sections: SpeedSection[];
  defaultMaxSpeed: number;
  /**
   * Double-decker between its end stations, plus where the upper deck itself
   * starts and ends (it overhangs the end stations to where Line 5 leaves).
   */
  doubleDecker: { start: number; end: number; lengthKm: number; upperStart: number; upperEnd: number } | null;
  projection: LocalProjection;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  params: RouteParams;
  rollingStock: RawTracksFile["rollingStock"];
  operations: OperationsParams;
  landmarks: RawLandmark[];
  /** Landmarks with a 3D model, placed along the corridor. */
  placedLandmarks: LandmarkPlacement[];
  /** Line 5 viaduct leaving the double-decker's west end towards Mount–Poonamallee Road, if defined. */
  line5Branch: BranchModel | null;
  /** Every Line 5 branch (west towards Mount–Poonamallee Road, east towards Virugambakkam). */
  line5Branches: BranchModel[];
  /** Stretches whose surroundings follow a traced pattern, with a style per side (+1 right, -1 left). */
  neighbourhoods: NeighbourhoodModel[];
  /** Road flyovers (the MGR flyover at Porur Junction). */
  flyovers: FlyoverModel[];
  /** Roads leaving the corridor at junctions, by id. */
  sideRoads: Map<string, SideRoadModel>;
  lastVerified: string;
}

const KMH = 1 / 3.6;

/** Validate the raw JSON bundle and throw a readable error on the first problem. */
export function validateBundle(data: DataBundle, routeId?: string): RawRoute {
  if (!data?.stations?.stations?.length) throw new RouteDataError("stations.json has no stations.");
  if (!data?.routes?.routes?.length) throw new RouteDataError("routes.json has no routes.");
  const route = routeId
    ? data.routes.routes.find((r) => r.id === routeId)
    : data.routes.routes[0];
  if (!route) throw new RouteDataError(`Route "${routeId}" is not defined in routes.json.`);

  const byId = new Map(data.stations.stations.map((s) => [s.id, s]));
  for (const id of route.stationIds) {
    const st = byId.get(id);
    if (!st) throw new RouteDataError(`Route "${route.id}" lists unknown station "${id}".`);
    if (st.service !== "stop" && st.service !== "pass")
      throw new RouteDataError(`Station "${id}" has invalid service "${String(st.service)}".`);
    if (!st.coordinates && !st.placement)
      throw new RouteDataError(`Station "${id}" has neither coordinates nor a placement rule.`);
    if (st.placement) {
      for (const ref of st.placement.between) {
        if (!byId.get(ref)?.coordinates)
          throw new RouteDataError(`Station "${id}" is placed relative to "${ref}", which has no coordinates.`);
      }
    }
  }
  const stops = route.stationIds.filter((id) => byId.get(id)!.service === "stop");
  if (stops.length < 2) throw new RouteDataError(`Route "${route.id}" needs at least two served stations.`);
  if (!data.routes.lines.find((l) => l.id === route.line))
    throw new RouteDataError(`Route "${route.id}" references unknown line "${route.line}".`);
  for (const sec of data.tracks.sections) {
    if (!route.stationIds.includes(sec.from) || !route.stationIds.includes(sec.to))
      throw new RouteDataError(`Speed section ${sec.from} → ${sec.to} references a station outside the route.`);
  }
  const roadIds = new Set<string>();
  for (const r of data.tracks.structures.sideRoads ?? []) {
    if (!route.stationIds.includes(r.atStation)) throw new RouteDataError(`Road "${r.id}" starts at "${r.atStation}", which is not on route "${route.id}".`);
    if (!Array.isArray(r.path) || r.path.length < 2 || r.path[0][0] !== 0 || r.path[0][1] !== 0)
      throw new RouteDataError(`Road "${r.id}" needs a path of at least two points starting at [0, 0] (the junction).`);
    if (!(r.widthM > 0 && r.westM >= 0)) throw new RouteDataError(`Road "${r.id}" needs a positive width.`);
    roadIds.add(r.id);
  }
  for (const f of data.tracks.structures.flyovers ?? []) {
    if (!roadIds.has(f.road)) throw new RouteDataError(`Flyover "${f.id}" is on unknown road "${f.road}".`);
    const len = f.toJunctionM - f.fromJunctionM;
    const ramp = f.rampM?.value;
    if (!(len > 0 && f.widthM?.value > 0 && f.crestDeckM?.value > 0 && ramp > 0))
      throw new RouteDataError(`Flyover "${f.id}" needs a positive length, width, crest height and ramp length.`);
    if (Math.abs(len - f.lengthM.value) > 1) throw new RouteDataError(`Flyover "${f.id}": its ends are ${len} m apart but its length is ${f.lengthM.value} m.`);
    if (2 * ramp > len) throw new RouteDataError(`Flyover "${f.id}": its two ${ramp} m ramps do not fit in ${len} m.`);
  }
  const ddRaw = data.tracks.structures.doubleDecker;
  for (const [end, branch] of [
    ["west", ddRaw?.line5West],
    ["east", ddRaw?.line5East],
  ] as const) {
    if (!branch) continue;
    if (!(branch.lengthM > 0)) throw new RouteDataError(`The Line 5 ${end} branch needs a positive length to draw.`);
    if (!(branch.descent && branch.descent.toM > branch.descent.fromM && branch.descent.fromM >= 0))
      throw new RouteDataError(`The Line 5 ${end} branch needs a descent that ends after it starts.`);
  }
  const drawn = new Set((data.landmarks?.landmarks ?? []).filter((lm) => lm.model && lm.position).map((lm) => lm.id));
  for (const n of data.tracks.neighbourhoods ?? []) {
    if (!drawn.has(n.around)) throw new RouteDataError(`Neighbourhood "${n.id}" is around "${n.around}", which is not a drawn landmark.`);
    if (!(n.halfLengthM > 0)) throw new RouteDataError(`Neighbourhood "${n.id}" needs a positive half-length.`);
  }
  for (const lm of data.landmarks?.landmarks ?? []) {
    if (!byId.has(lm.nearStation)) throw new RouteDataError(`Landmark "${lm.id}" is near unknown station "${lm.nearStation}".`);
    if (!lm.model) continue;
    const { along, depth } = lm.model;
    if (!(along > 0 && depth > 0)) throw new RouteDataError(`Landmark "${lm.id}" needs a positive model footprint.`);
    const pos = lm.position;
    if (!pos) throw new RouteDataError(`Landmark "${lm.id}" has a model but no position.`);
    if ("station" in pos) {
      if (!route.stationIds.includes(pos.station))
        throw new RouteDataError(`Landmark "${lm.id}" is placed relative to "${pos.station}", which is not on route "${route.id}".`);
    } else if (!(Number.isFinite(pos.lat) && Number.isFinite(pos.lon))) {
      throw new RouteDataError(`Landmark "${lm.id}" has invalid coordinates.`);
    }
  }
  return route;
}

function resolveCoordinates(st: RawStation, byId: Map<string, RawStation>): LatLon {
  if (st.coordinates) return { lat: st.coordinates.lat, lon: st.coordinates.lon };
  const [aId, bId] = st.placement!.between;
  const a = byId.get(aId)!.coordinates!;
  const b = byId.get(bId)!.coordinates!;
  const f = st.placement!.fraction;
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

/** The network station for a curated station: by `osmName`, else by name (ignoring a trailing "Metro"). */
function networkStation(net: RawNetworkLine, st: RawStation): RawNetworkStation | undefined {
  const norm = (n: string) => n.toLowerCase().replace(/\s+metro$/, "").replace(/[^a-z0-9]+/g, " ").trim();
  const want = norm(st.osmName ?? st.name);
  return net.stations.find((n) => norm(n.name) === want);
}

export function buildRouteModel(data: DataBundle, routeId?: string): RouteModel {
  const route = validateBundle(data, routeId);
  const line = data.routes.lines.find((l) => l.id === route.line)!;
  const tracks = data.tracks;
  const byId = new Map(data.stations.stations.map((s) => [s.id, s]));
  const raw = route.stationIds.map((id) => byId.get(id)!);
  const net = data.network?.lines.find((l) => l.id === route.line);

  // Tail tracks: extend straight beyond each end.
  const tail = tracks.alignment.tailTrackM.value;
  const extend = (from: Vec2, toward: Vec2): Vec2 => {
    const dx = from.x - toward.x;
    const dz = from.z - toward.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: from.x + (dx / len) * tail, z: from.z + (dz / len) * tail };
  };

  let projection: LocalProjection;
  let coords: LatLon[];
  let local: Vec2[];
  let alignment: Alignment;
  let stationDistance: (i: number) => number;
  if (net && data.network) {
    // Real track from OpenStreetMap, in the shared city projection.
    projection = createProjection(data.network.meta.origin);
    const matched = raw.map((s) => {
      const n = networkStation(net, s);
      if (!n) throw new RouteDataError(`Station "${s.id}" (${s.osmName ?? s.name}) is not on ${net.name} in network.json.`);
      return n;
    });
    coords = matched.map((n) => ({ lat: n.lat, lon: n.lon }));
    local = coords.map((c) => {
      const [x, z] = projection.toLocal(c);
      return { x, z };
    });
    const pts = net.track.map(([x, z]) => ({ x, z }));
    alignment = new Alignment([extend(pts[0], pts[1]), ...pts, extend(pts[pts.length - 1], pts[pts.length - 2])]);
    const distances = matched.map((n, i) => alignment.project(local[i].x, local[i].z, n.d + tail, 800));
    for (let i = 1; i < distances.length; i++) {
      if (distances[i] <= distances[i - 1])
        throw new RouteDataError(`Route "${route.id}": "${raw[i].id}" comes before "${raw[i - 1].id}" on the real track; fix the station order.`);
    }
    stationDistance = (i) => distances[i];
  } else {
    coords = raw.map((s) => resolveCoordinates(s, byId));
    projection = createProjection(centroid(coords));
    local = coords.map((c) => {
      const [x, z] = projection.toLocal(c);
      return { x, z };
    });
    const west = extend(local[0], local[1]);
    const east = extend(local[local.length - 1], local[local.length - 2]);
    alignment = new Alignment([west, ...local, east]);
    stationDistance = (i) => alignment.controlDistances[i + 1];
  }

  const startDistance = stationDistance(0);
  const endDistance = stationDistance(raw.length - 1);
  const modelled = endDistance - startDistance;
  const officialLengthM = route.lengthKm * 1000;
  const displayScale = officialLengthM / modelled;

  const dd = tracks.structures.doubleDecker;
  const ddStations = new Set<string>();
  if (dd) {
    const i0 = route.stationIds.indexOf(dd.from);
    const i1 = route.stationIds.indexOf(dd.to);
    if (i0 >= 0 && i1 >= 0) for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) ddStations.add(route.stationIds[i]);
  }

  const stations: StationModel[] = raw.map((s, i) => {
    const distance = stationDistance(i);
    return {
      id: s.id,
      name: s.name,
      nameTa: s.nameTa,
      nameTaVerified: s.nameTaVerified,
      altNames: s.altNames ?? [],
      type: s.type,
      service: s.service,
      terminus: Boolean(s.terminus),
      interchange: s.interchange ?? [],
      notes: s.notes ?? "",
      order: i,
      coordinates: coords[i],
      coordinateQuality: net ? "osm" : (s.coordinates?.quality ?? s.placement?.quality ?? "interpolated"),
      coordinateSource: net ? "osm" : (s.coordinates?.source ?? null),
      distance,
      km: ((distance - startDistance) * displayScale) / 1000,
      local: local[i],
      doubleDecker: ddStations.has(s.id),
    };
  });
  const stationById = new Map(stations.map((s) => [s.id, s]));

  const sections: SpeedSection[] = tracks.sections.map((sec) => {
    const a = stationById.get(sec.from)!.distance;
    const b = stationById.get(sec.to)!.distance;
    return { start: Math.min(a, b), end: Math.max(a, b), maxSpeed: sec.maxSpeedKmh * KMH, status: sec.status };
  });

  let doubleDecker: RouteModel["doubleDecker"] = null;
  // Where the upper-deck line's real track runs over ours (network.json), as indices into its track.
  let upperRun: { line: RawNetworkLine; i0: number; i1: number; d: number[] } | null = null;
  if (dd && stationById.get(dd.from) && stationById.get(dd.to)) {
    const a = stationById.get(dd.from)!.distance;
    const b = stationById.get(dd.to)!.distance;
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    let upperStart = start - UPPER_DECK_OVERHANG;
    let upperEnd = end + UPPER_DECK_OVERHANG;
    const upperNet = net && data.network?.lines.find((l) => l.id === dd.upperDeck);
    if (upperNet) {
      // Project the upper line's track onto ours; its longest stretch within 20 m is the double-decker.
      const mid = (start + end) / 2;
      const span = (end - start) / 2 + 3000;
      const d: number[] = [];
      const near: boolean[] = [];
      for (const [x, z] of upperNet.track) {
        const pd = alignment.project(x, z, mid, span);
        const c = alignment.point(pd);
        d.push(pd);
        near.push(Math.hypot(x - c.x, z - c.z) < 20 && pd > mid - span + 5 && pd < mid + span - 5);
      }
      let best = { i0: -1, i1: -1 };
      for (let i = 0; i < near.length; ) {
        if (!near[i]) {
          i++;
          continue;
        }
        let j = i;
        while (j + 1 < near.length && near[j + 1]) j++;
        if (j - i > best.i1 - best.i0) best = { i0: i, i1: j };
        i = j + 1;
      }
      if (best.i0 >= 0 && Math.abs(d[best.i1] - d[best.i0]) > 500) {
        upperStart = Math.min(d[best.i0], d[best.i1]);
        upperEnd = Math.max(d[best.i0], d[best.i1]);
        upperRun = { line: upperNet, i0: best.i0, i1: best.i1, d };
      }
    }
    doubleDecker = { start, end, lengthKm: dd.lengthKm, upperStart, upperEnd };
  }

  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  // The route's own stretch (the alignment may carry the whole line beyond it).
  const boundsPts: Vec2[] = [];
  for (let d = Math.max(0, startDistance - tail); d <= Math.min(alignment.length, endDistance + tail); d += 50) boundsPts.push(alignment.point(d));
  for (const p of boundsPts) {
    bounds.minX = Math.min(bounds.minX, p.x);
    bounds.maxX = Math.max(bounds.maxX, p.x);
    bounds.minZ = Math.min(bounds.minZ, p.z);
    bounds.maxZ = Math.max(bounds.maxZ, p.z);
  }

  // Drawn landmarks: project onto the alignment (coordinates) or offset from a station.
  const placedLandmarks: LandmarkPlacement[] = [];
  const rightZ = (d: number) => alignment.right(d).z;
  const sideSign = (side: "north" | "south", d: number) => ((side === "south") === rightZ(d) > 0 ? 1 : -1);
  for (const lm of data.landmarks?.landmarks ?? []) {
    if (!lm.model || !lm.position) continue;
    const pos = lm.position;
    let distance: number;
    let lateral: number;
    if ("station" in pos) {
      const st = stationById.get(pos.station)!;
      distance = st.distance + pos.alongM;
      lateral = sideSign(pos.side, distance) * pos.offsetM;
    } else {
      const [x, z] = projection.toLocal({ lat: pos.lat, lon: pos.lon });
      const guess = stationById.get(lm.nearStation)?.distance ?? alignment.length / 2;
      distance = alignment.project(x, z, guess, 3000);
      const c = alignment.point(distance);
      const r = alignment.right(distance);
      lateral = (x - c.x) * r.x + (z - c.z) * r.z;
      if (Math.abs(lateral) < 1 && pos.side) lateral = sideSign(pos.side, distance);
    }
    placedLandmarks.push({ landmark: lm, type: lm.model.type, along: lm.model.along, depth: lm.model.depth, height: lm.model.height, distance, lateral });
  }

  /** Rigid frame at a corridor distance: maps [along, lateral-to-side] to world points. */
  const frameAt = (d: number, side: "north" | "south") => {
    const p = alignment.point(d);
    const t = alignment.tangent(d);
    const r = alignment.right(d);
    const sign = sideSign(side, d);
    return (a: number, l: number): Vec2 => ({ x: p.x + t.x * a + r.x * l * sign, z: p.z + t.z * a + r.z * l * sign });
  };

  // Side roads: the real road from OpenStreetMap when baked, else share the corridor for westM
  // then follow the traced path.
  const sideRoads = new Map<string, SideRoadModel>();
  for (const raw of tracks.structures.sideRoads ?? []) {
    const junctionD = stationById.get(raw.atStation)!.distance;
    const netRoad = net ? data.network?.roads?.[raw.id] : undefined;
    if (netRoad) {
      // The junction is where the real road leaves the metro corridor: the last point (in its
      // first half) still within 20 m of the line.
      const road = new Alignment(netRoad.points.map(([x, z]) => ({ x, z })));
      let junctionS = 0;
      let jd = junctionD;
      for (let s = 0; s <= road.length / 2; s += 2) {
        const p = road.point(s);
        const d = alignment.project(p.x, p.z, junctionD, 1200);
        const c = alignment.point(d);
        if (Math.hypot(p.x - c.x, p.z - c.z) < 20) {
          junctionS = s;
          jd = d;
        }
      }
      sideRoads.set(raw.id, { raw, alignment: road, junctionS, junctionD: jd, width: raw.widthM });
      continue;
    }
    const pts: Vec2[] = [];
    // Densely sampled while it shares the corridor, so the spline cannot bulge off it before the bend.
    for (let d = junctionD - raw.westM; d < junctionD - 1; d += 20) pts.push(alignment.point(d));
    const at = frameAt(junctionD, "south");
    for (const [a, l] of raw.path) pts.push(at(a, l));
    const road = new Alignment(pts);
    const j = alignment.point(junctionD);
    const junctionS = raw.westM > 0 ? road.project(j.x, j.z, raw.westM, raw.westM) : 0;
    sideRoads.set(raw.id, { raw, alignment: road, junctionS, junctionD, width: raw.widthM });
  }

  // Line 5 branches: the real upper-line track where it parts from ours, blended in from our
  // centreline over the first BLEND metres so it leaves the upper deck without a kink.
  const line5Branches: BranchModel[] = [];
  const BLEND = 350;
  /** Start the blend this far back inside the shared stretch, while the two tracks still run parallel. */
  const LEAD_IN = 200;
  const buildBranch = (rawBranch: RawBranch, end: "west" | "east"): BranchModel | null => {
    if (!upperRun || !doubleDecker) return null;
    const { line: upper, i0, i1, d } = upperRun;
    const junction = end === "west" ? doubleDecker.upperStart : doubleDecker.upperEnd;
    // The end of the shared stretch at this junction, and the direction (in track indices) away from it.
    const atStart = Math.abs(d[i0] - junction) < Math.abs(d[i1] - junction);
    const step = atStart ? -1 : 1;
    // Walk LEAD_IN metres back into the shared stretch before branching off.
    let from = atStart ? i0 : i1;
    for (let back = 0; back < LEAD_IN && from - step >= i0 && from - step <= i1; ) {
      const q = upper.track[from - step];
      back += Math.hypot(q[0] - upper.track[from][0], q[1] - upper.track[from][1]);
      from -= step;
    }
    const startD = d[from];
    const raw: Vec2[] = [];
    let length = 0;
    for (let i = from; i >= 0 && i < upper.track.length && length <= rawBranch.lengthM; i += step) {
      const p = { x: upper.track[i][0], z: upper.track[i][1] };
      if (raw.length) length += Math.hypot(p.x - raw[raw.length - 1].x, p.z - raw[raw.length - 1].z);
      raw.push(p);
    }
    if (raw.length < 3) return null;
    const points: Vec2[] = [alignment.point(startD)];
    let s = 0;
    for (let k = 1; k < raw.length; k++) {
      s += Math.hypot(raw[k].x - raw[k - 1].x, raw[k].z - raw[k - 1].z);
      const w = Math.min(1, s / BLEND);
      const ease = w * w * (3 - 2 * w);
      const c = alignment.point(alignment.project(raw[k].x, raw[k].z, startD, BLEND + 400));
      points.push({ x: c.x + (raw[k].x - c.x) * ease, z: c.z + (raw[k].z - c.z) * ease });
    }
    const upperY = tracks.alignment.railLevelM.value + dd!.upperDeckHeightAboveRailM.value;
    const lower = tracks.alignment.railLevelM.value;
    const { fromM, toM } = rawBranch.descent;
    const railAt = (sd: number) => {
      const u = Math.min(1, Math.max(0, (sd - fromM) / (toM - fromM)));
      return upperY + (lower - upperY) * (0.5 - 0.5 * Math.cos(Math.PI * u));
    };
    const branchAlign = new Alignment(points);
    return {
      raw: rawBranch,
      end,
      line: data.routes.lines.find((l) => l.id === rawBranch.line) ?? null,
      alignment: branchAlign,
      junction: startD,
      points,
      railAt,
      landS: branchAlign.length,
      road: null,
    };
  };
  for (const [end, rb] of [
    ["west", dd?.line5West],
    ["east", dd?.line5East],
  ] as const) {
    const b = rb && buildBranch(rb, end);
    if (b) line5Branches.push(b);
  }
  // The upper deck runs exactly to where each branch leaves it.
  if (doubleDecker) {
    for (const b of line5Branches) {
      if (b.end === "west") doubleDecker.upperStart = b.junction;
      else doubleDecker.upperEnd = b.junction;
    }
  }
  const line5Branch = line5Branches.find((b) => b.end === "west") ?? null;

  // Neighbourhoods: a stretch either side of their landmark, with a style per side of the road.
  const neighbourhoods: NeighbourhoodModel[] = [];
  for (const raw of tracks.neighbourhoods ?? []) {
    const lm = placedLandmarks.find((p) => p.landmark.id === raw.around)!;
    const northSign = sideSign("north", lm.distance);
    neighbourhoods.push({
      raw,
      from: lm.distance - raw.halfLengthM,
      to: lm.distance + raw.halfLengthM,
      right: (northSign > 0 ? raw.north : raw.south) ?? null,
      left: (northSign > 0 ? raw.south : raw.north) ?? null,
    });
  }

  // Flyovers: straight-graded ramps with rounded (parabolic) ends up to a level crest.
  const VERTICAL_CURVE = 40;
  const rampHeight = (x: number, len: number, h: number) => {
    if (x <= 0) return 0;
    if (x >= len) return h;
    const c = Math.min(VERTICAL_CURVE, len / 2);
    const g = h / (len - c);
    if (x < c) return (g * x * x) / (2 * c);
    if (x > len - c) return h - (g * (len - x) * (len - x)) / (2 * c);
    return g * (x - c / 2);
  };
  const flyovers: FlyoverModel[] = (tracks.structures.flyovers ?? []).map((raw) => {
    const road = sideRoads.get(raw.road)!;
    // Centred on the flyover's span in OpenStreetMap when baked, keeping its published length.
    const osmSpan = net ? data.network?.roads?.[raw.road]?.features?.[raw.id] : undefined;
    let fromJ = raw.fromJunctionM;
    if (osmSpan) fromJ = (osmSpan[0] + osmSpan[1]) / 2 - raw.lengthM.value / 2 - road.junctionS;
    const startS = road.junctionS + fromJ;
    const endS = startS + (raw.toJunctionM - raw.fromJunctionM);
    const ramp = raw.rampM.value;
    const crest = raw.crestDeckM.value;
    const halfWidth = raw.widthM.value / 2;
    const heightAt = (s: number) => (s <= startS || s >= endS ? 0 : Math.min(rampHeight(s - startS, ramp, crest), rampHeight(endS - s, ramp, crest)));
    // Where the deck lies within the corridor carriageway (13 m half-width), measured by projection.
    let corridorFrom = Infinity;
    let corridorTo = -Infinity;
    const under: [number, number][] = [];
    for (let s = startS; s <= endS; s += 2) {
      const p = road.alignment.point(s);
      const d = alignment.project(p.x, p.z, road.junctionD, endS - startS + 400);
      const c = alignment.point(d);
      if (Math.hypot(p.x - c.x, p.z - c.z) - halfWidth > 13) continue;
      corridorFrom = Math.min(corridorFrom, d);
      corridorTo = Math.max(corridorTo, d);
      under.push([d, heightAt(s)]);
    }
    if (!under.length) corridorFrom = corridorTo = road.junctionD;
    under.sort((a, b) => a[0] - b[0]);
    /** Deck height above the corridor at corridor distance d (0 where it is not over the corridor). */
    const corridorHeightAt = (d: number) => {
      if (!under.length || d < under[0][0] || d > under[under.length - 1][0]) return 0;
      let i = 1;
      while (i < under.length - 1 && under[i][0] < d) i++;
      const [d0, h0] = under[i - 1];
      const [d1, h1] = under[i];
      return d1 > d0 ? h0 + ((h1 - h0) * (d - d0)) / (d1 - d0) : h0;
    };
    return { raw, road, startS, endS, halfWidth, crest, heightAt, corridorFrom, corridorTo, corridorHeightAt };
  });

  const { operations } = tracks;
  return {
    id: route.id,
    title: route.title,
    line,
    route,
    stations,
    stationById,
    stops: stations.filter((s) => s.service === "stop"),
    alignment,
    startDistance,
    endDistance,
    displayScale,
    officialLengthM,
    sections,
    defaultMaxSpeed: tracks.rollingStock.operatingSpeedKmh * KMH,
    doubleDecker,
    projection,
    bounds,
    params: {
      railLevel: tracks.alignment.railLevelM.value,
      trackCentres: tracks.alignment.trackCentresM.value,
      gauge: tracks.alignment.gaugeMm.value / 1000,
      pierSpacing: tracks.alignment.pierSpacingM.value,
      tailTrack: tail,
      platformLength: tracks.structures.platform.lengthM.value,
      platformWidth: tracks.structures.platform.widthM.value,
      platformHeight: tracks.structures.platform.heightAboveRailM.value,
      upperDeckHeight: dd?.upperDeckHeightAboveRailM.value ?? 9.5,
      driving: tracks.alignment.driving,
    },
    rollingStock: tracks.rollingStock,
    operations: {
      accelerationMps2: operations.accelerationMps2,
      serviceBrakeMps2: operations.serviceBrakeMps2,
      maxBrakeMps2: operations.maxBrakeMps2,
      jerkMps3: operations.jerkMps3,
      dwellSeconds: operations.dwellSeconds,
      doorOpeningSeconds: operations.doorOpeningSeconds,
      doorClosingSeconds: operations.doorClosingSeconds,
      settleBeforeDoorsSeconds: operations.settleBeforeDoorsSeconds,
      originBoardingSeconds: operations.originBoardingSeconds,
      terminusAlightSeconds: operations.terminusAlightSeconds,
    },
    landmarks: data.landmarks?.landmarks ?? [],
    placedLandmarks,
    line5Branch,
    line5Branches,
    neighbourhoods,
    flyovers,
    sideRoads,
    lastVerified: data.stations.meta.lastVerified,
  };
}

/** Speed limit (m/s) at an alignment distance. */
export function speedLimitAt(route: RouteModel, distance: number): number {
  for (const s of route.sections) {
    if (distance >= s.start && distance <= s.end) return s.maxSpeed;
  }
  return route.defaultMaxSpeed;
}
