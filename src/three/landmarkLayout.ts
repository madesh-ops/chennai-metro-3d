import type { LandmarkPlacement, RouteModel } from "../simulation/RouteController.ts";
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
}

/** Facilities that front the road: snapped to the roadside instead of their published point. */
const FRONTAGE = new Set<LandmarkPlacement["type"]>(["bus-stand", "hospital", "mall", "cinema"]);

const cache = new WeakMap<RouteModel, LandmarkFootprint[]>();

export function landmarkFootprints(route: RouteModel): LandmarkFootprint[] {
  const hit = cache.get(route);
  if (hit) return hit;
  const out = route.placedLandmarks.map((p) => {
    const side: 1 | -1 = p.lateral < 0 ? -1 : 1;
    const minLat = BUILDING_SETBACK + p.depth / 2 + 2;
    const mag = FRONTAGE.has(p.type) ? minLat : Math.max(Math.abs(p.lateral), minLat);
    return { placement: p, distance: p.distance, lateral: side * mag, side, along: p.along, depth: p.depth };
  });
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
