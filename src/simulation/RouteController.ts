import { Alignment, type Vec2 } from "./Alignment.ts";
import { centroid, createProjection, type LatLon, type LocalProjection } from "../utils/coordinates.ts";
import type {
  CoordinateQuality,
  LandmarkModelType,
  DataBundle,
  OperationsParams,
  RawBranch,
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
    const arc = branch.peelArc;
    if (!(arc?.radiusM > 0 && arc.turnDeg > 0 && arc.turnDeg < 180))
      throw new RouteDataError(`The Line 5 ${end} branch needs a peel-away arc with a positive radius and a turn between 0 and 180 degrees.`);
    if (branch.landsOn) {
      if (!roadIds.has(branch.landsOn.road)) throw new RouteDataError(`The Line 5 ${end} branch lands on unknown road "${branch.landsOn.road}".`);
    } else if (!(branch.runOn && branch.runOn.straightM > 0)) {
      throw new RouteDataError(`The Line 5 ${end} branch needs either a side road to land on or a straight run-on length.`);
    }
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

export function buildRouteModel(data: DataBundle, routeId?: string): RouteModel {
  const route = validateBundle(data, routeId);
  const line = data.routes.lines.find((l) => l.id === route.line)!;
  const tracks = data.tracks;
  const byId = new Map(data.stations.stations.map((s) => [s.id, s]));
  const raw = route.stationIds.map((id) => byId.get(id)!);

  const coords = raw.map((s) => resolveCoordinates(s, byId));
  const projection = createProjection(centroid(coords));
  const local: Vec2[] = coords.map((c) => {
    const [x, z] = projection.toLocal(c);
    return { x, z };
  });

  // Tail tracks: extend straight beyond each terminus.
  const tail = tracks.alignment.tailTrackM.value;
  const extend = (from: Vec2, toward: Vec2): Vec2 => {
    const dx = from.x - toward.x;
    const dz = from.z - toward.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: from.x + (dx / len) * tail, z: from.z + (dz / len) * tail };
  };
  const west = extend(local[0], local[1]);
  const east = extend(local[local.length - 1], local[local.length - 2]);
  const alignment = new Alignment([west, ...local, east]);

  const startDistance = alignment.controlDistances[1];
  const endDistance = alignment.controlDistances[local.length];
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
    const distance = alignment.controlDistances[i + 1];
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
      coordinateQuality: s.coordinates?.quality ?? s.placement?.quality ?? "interpolated",
      coordinateSource: s.coordinates?.source ?? null,
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
  if (dd && stationById.get(dd.from) && stationById.get(dd.to)) {
    const a = stationById.get(dd.from)!.distance;
    const b = stationById.get(dd.to)!.distance;
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    doubleDecker = {
      start,
      end,
      lengthKm: dd.lengthKm,
      upperStart: start - (dd.line5West?.leavesPastStationM ?? UPPER_DECK_OVERHANG),
      upperEnd: end + (dd.line5East?.leavesPastStationM ?? UPPER_DECK_OVERHANG),
    };
  }

  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of [west, ...local, east]) {
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

  // Side roads: share the corridor for westM, then follow their traced path.
  const sideRoads = new Map<string, SideRoadModel>();
  for (const raw of tracks.structures.sideRoads ?? []) {
    const junctionD = stationById.get(raw.atStation)!.distance;
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

  // Line 5 branches: peel off the upper deck's ends, then land on a side road or run on.
  const line5Branches: BranchModel[] = [];
  const buildBranch = (rawBranch: RawBranch, end: "west" | "east"): BranchModel => {
    const dir = end === "west" ? -1 : 1;
    const junction = end === "west" ? doubleDecker!.upperStart : doubleDecker!.upperEnd;
    const at = frameAt(junction, rawBranch.side);
    // Sample the arc densely so the spline through it stays a true arc (no kink, no tightening).
    const { radiusM: R, turnDeg } = rawBranch.peelArc;
    const turn = (turnDeg * Math.PI) / 180;
    const n = Math.ceil((R * turn) / 4);
    const points: Vec2[] = [];
    for (let k = 0; k <= n; k++) {
      const th = (turn * k) / n;
      points.push(at(dir * R * Math.sin(th), R * (1 - Math.cos(th))));
    }
    const road = rawBranch.landsOn ? sideRoads.get(rawBranch.landsOn.road)! : null;
    if (road && rawBranch.landsOn) {
      for (let s = road.junctionS + rawBranch.landsOn.fromJunctionM; s <= road.alignment.length; s += 60) points.push(road.alignment.point(s));
    } else if (rawBranch.runOn) {
      // Straight on in the arc's final direction.
      const endAlong = dir * R * Math.sin(turn);
      const endLat = R * (1 - Math.cos(turn));
      const dAlong = dir * Math.cos(turn);
      const dLat = Math.sin(turn);
      for (let s = 20; s <= rawBranch.runOn.straightM; s += 20) points.push(at(endAlong + dAlong * s, endLat + dLat * s));
    }
    const upper = tracks.alignment.railLevelM.value + dd!.upperDeckHeightAboveRailM.value;
    const lower = tracks.alignment.railLevelM.value;
    const { fromM, toM } = rawBranch.descent;
    const railAt = (s: number) => {
      const u = Math.min(1, Math.max(0, (s - fromM) / (toM - fromM)));
      return upper + (lower - upper) * (0.5 - 0.5 * Math.cos(Math.PI * u));
    };
    const branchAlign = new Alignment(points);
    let landS = branchAlign.length;
    if (road && rawBranch.landsOn) {
      const land = road.alignment.point(road.junctionS + rawBranch.landsOn.fromJunctionM);
      landS = branchAlign.project(land.x, land.z, branchAlign.length / 3, branchAlign.length);
    }
    return {
      raw: rawBranch,
      end,
      line: data.routes.lines.find((l) => l.id === rawBranch.line) ?? null,
      alignment: branchAlign,
      junction,
      points,
      railAt,
      landS,
      road,
    };
  };
  if (doubleDecker && dd?.line5West) line5Branches.push(buildBranch(dd.line5West, "west"));
  if (doubleDecker && dd?.line5East) line5Branches.push(buildBranch(dd.line5East, "east"));
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
    const startS = road.junctionS + raw.fromJunctionM;
    const endS = road.junctionS + raw.toJunctionM;
    const ramp = raw.rampM.value;
    const crest = raw.crestDeckM.value;
    const halfWidth = raw.widthM.value / 2;
    const heightAt = (s: number) => (s <= startS || s >= endS ? 0 : Math.min(rampHeight(s - startS, ramp, crest), rampHeight(endS - s, ramp, crest)));
    // Where the deck still overlaps the corridor carriageway (13 m half-width).
    let corridorTo = road.junctionD;
    for (let s = road.junctionS; s <= endS; s += 2) {
      const p = road.alignment.point(s);
      const d = alignment.project(p.x, p.z, corridorTo, 200);
      const c = alignment.point(d);
      if (Math.hypot(p.x - c.x, p.z - c.z) - halfWidth > 13) break;
      corridorTo = Math.max(corridorTo, d);
    }
    const corridorFrom = road.junctionD + raw.fromJunctionM;
    const corridorHeightAt = (d: number) => (d <= road.junctionD ? heightAt(road.junctionS + (d - road.junctionD)) : 0);
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
