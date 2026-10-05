import type { RouteModel } from "../../simulation/RouteController.ts";
import { ROAD } from "../layout.ts";
import { landmarkFootprints } from "../landmarkLayout.ts";
import { branchLayout } from "../line5Layout.ts";
import { makeKeepOut, type KeepOutData } from "./keepOutCore.ts";
import type { KeepOut } from "./worldGeometry.ts";

/** Rail heights: viaduct over a road, open trough / at grade, tunnel (as Track.tsx). */
const VIADUCT_MIN = 4;
const TUNNEL_MAX = -7;

/**
 * Ground the real city must leave clear for what this route draws itself:
 * the corridor road under the viaduct (with its footpaths), open troughs,
 * underground station entrances, curated landmarks and the Line 5 branch
 * corridors. Tunnels need nothing: the city stands over them.
 */
export function routeKeepOutData(route: RouteModel, range: [number, number]): KeepOutData {
  const circles: number[] = [];
  const add = (x: number, z: number, r: number) => circles.push(x, z, r);
  const { alignment, profile } = route;
  const p = { x: 0, z: 0 };
  const corridor = ROAD.halfWidth + ROAD.sidewalk + 0.8;
  for (let d = range[0]; d <= range[1]; d += 6) {
    const y = profile.railAt(d);
    const r = y >= VIADUCT_MIN ? corridor : y > TUNNEL_MAX ? 8 : 0;
    if (r <= 0) continue;
    alignment.point(d, p);
    add(p.x, p.z, r);
  }
  // Street entrances of underground stations (buildStationEntrances in stationModel.ts).
  const half = route.params.platformLength / 2;
  for (const st of route.stations) {
    if (st.distance < range[0] || st.distance > range[1] || profile.railAt(st.distance) >= 0) continue;
    for (const along of [-(half - 8), half - 8]) {
      for (const side of [-1, 1]) {
        alignment.offsetPoint(st.distance + along, side * (ROAD.halfWidth + ROAD.sidewalk + 3.2), p);
        add(p.x, p.z, 7);
      }
    }
  }
  // Landmarks: oriented rectangles with a margin.
  const rects: number[] = [];
  for (const f of landmarkFootprints(route)) {
    if (f.placement.type === "lake") continue; // the real lake outline comes from OSM
    const c = alignment.offsetPoint(f.distance, f.lateral);
    const a = alignment.point(f.distance - 1);
    const b = alignment.point(f.distance + 1);
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    rects.push(c.x, c.z, (b.x - a.x) / l, (b.z - a.z) / l, f.along / 2 + 8, f.depth / 2 + 8);
  }
  // Line 5 branch viaducts and the roads under them.
  for (const s of branchLayout(route)?.samples ?? []) add(s.x, s.z, s.half);
  return { circles, rects };
}

export function routeKeepOut(route: RouteModel, range: [number, number]): KeepOut {
  return makeKeepOut(routeKeepOutData(route, range));
}
