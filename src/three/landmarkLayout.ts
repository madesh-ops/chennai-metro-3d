import type { LandmarkPlacement, RouteModel } from "../simulation/RouteController.ts";
import { dataBundle, getRouteModel } from "../simulation/data.ts";
import { BUILDING_SETBACK } from "./layout.ts";

/**
 * Final footprints of the landmarks drawn in 3D, in road coordinates
 * (alignment distance × signed lateral metres). Shared by the city generator,
 * which keeps buildings, trees and cross streets out of them, and by the
 * landmark models themselves.
 */
export interface LandmarkFootprint {
  placement: LandmarkPlacement;
  distance: number;
  /** Signed centre offset (+ = right of increasing distance), clear of the road. */
  lateral: number;
  /** +1 right of the line, -1 left. */
  side: 1 | -1;
  along: number;
  depth: number;
  /**
   * Where the model stands in the world and which way it faces (yaw: models face -z). Fixed
   * for every route: worked out once on the landmark's home route (the line it was traced on).
   */
  world: { x: number; z: number; yaw: number };
}

/** The route a landmark was traced on: the first route (routes.json order) through its station. */
function homeRouteId(stationId: string): string | null {
  return dataBundle.routes.routes.find((r) => r.stationIds.includes(stationId))?.id ?? null;
}

/** Landmarks farther than this from another route's track are left out of its scene. */
const MAX_OFF_TRACK = 900;

/** Facilities that front the road: snapped to the roadside instead of their published point. */
const FRONTAGE = new Set<LandmarkPlacement["type"]>(["bus-stand", "hospital", "mall", "cinema", "glass-mall"]);

const cache = new WeakMap<RouteModel, LandmarkFootprint[]>();

export function landmarkFootprints(route: RouteModel): LandmarkFootprint[] {
  const hit = cache.get(route);
  if (hit) return hit;
  const local = (p: LandmarkPlacement): LandmarkFootprint => {
    const side: 1 | -1 = p.lateral < 0 ? -1 : 1;
    const minLat = BUILDING_SETBACK + p.depth / 2 + 2;
    const mag = FRONTAGE.has(p.type) ? minLat : Math.max(Math.abs(p.lateral), minLat);
    const lateral = side * mag;
    const c = route.alignment.offsetPoint(p.distance, lateral);
    // Models face -z; turn them so the front looks at the road.
    const yaw = route.alignment.heading(p.distance) + (side < 0 ? Math.PI : 0);
    return { placement: p, distance: p.distance, lateral, side, along: p.along, depth: p.depth, world: { x: c.x, z: c.z, yaw } };
  };
  const out: LandmarkFootprint[] = [];
  for (const p of route.placedLandmarks) {
    const home = homeRouteId(p.landmark.nearStation);
    if (!home || home === route.id) {
      out.push(local(p));
      continue;
    }
    // Traced on another line: keep its real place and facing, expressed along this route's track.
    let homeFp: LandmarkFootprint | undefined;
    try {
      homeFp = landmarkFootprints(getRouteModel(home)).find((f) => f.placement.landmark.id === p.landmark.id);
    } catch {
      homeFp = undefined;
    }
    if (!homeFp) {
      out.push(local(p));
      continue;
    }
    const { x, z } = homeFp.world;
    const distance = route.alignment.project(x, z, p.distance, 3000);
    const c = route.alignment.point(distance);
    const r = route.alignment.right(distance);
    const lateral = (x - c.x) * r.x + (z - c.z) * r.z;
    if (Math.hypot(x - c.x, z - c.z) > MAX_OFF_TRACK) continue;
    out.push({ ...homeFp, placement: p, distance, lateral, side: lateral < 0 ? -1 : 1 });
  }
  cache.set(route, out);
  return out;
}

/** Does a box (centre d/lateral, half sizes) touch any landmark footprint? */
export function overlapsLandmark(fps: readonly LandmarkFootprint[], d: number, lateral: number, halfAlong: number, halfDepth: number, margin = 4): boolean {
  for (const f of fps) {
    if (Math.abs(d - f.distance) < f.along / 2 + halfAlong + margin && Math.abs(lateral - f.lateral) < f.depth / 2 + halfDepth + margin) return true;
  }
  return false;
}
