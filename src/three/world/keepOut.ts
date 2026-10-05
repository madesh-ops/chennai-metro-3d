import type { RouteModel } from "../../simulation/RouteController.ts";
import { ROAD } from "../layout.ts";
import { landmarkFootprints } from "../landmarkLayout.ts";
import { branchLayout, inBranchCorridor } from "../line5Layout.ts";
import type { KeepOut } from "./worldGeometry.ts";

const CELL = 50;
/** Rail heights: viaduct over a road, open trough / at grade, tunnel (as Track.tsx). */
const VIADUCT_MIN = 4;
const TUNNEL_MAX = -7;

interface Circle {
  x: number;
  z: number;
  r: number;
}

interface Rect {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  ha: number;
  hd: number;
}

/**
 * Ground the real city must leave clear for what this route draws itself:
 * the corridor road under the viaduct (with its footpaths), open troughs,
 * underground station entrances, curated landmarks and the Line 5 branch
 * corridors. Tunnels need nothing: the city stands over them.
 */
export function routeKeepOut(route: RouteModel, range: [number, number]): KeepOut {
  const grid = new Map<string, Circle[]>();
  const add = (x: number, z: number, r: number) => {
    const c = { x, z, r };
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const k = `${i},${j}`;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(c);
      }
    }
  };
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
  const rects: Rect[] = [];
  for (const f of landmarkFootprints(route)) {
    if (f.placement.type === "lake") continue; // the real lake outline comes from OSM
    const c = alignment.offsetPoint(f.distance, f.lateral);
    const a = alignment.point(f.distance - 1);
    const b = alignment.point(f.distance + 1);
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    rects.push({ cx: c.x, cz: c.z, ux: (b.x - a.x) / l, uz: (b.z - a.z) / l, ha: f.along / 2 + 8, hd: f.depth / 2 + 8 });
  }
  const branch = branchLayout(route);

  return (x, z, r) => {
    const l = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (l) {
      for (const c of l) {
        const rr = c.r + r;
        if ((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) < rr * rr) return true;
      }
    }
    for (const q of rects) {
      const dx = x - q.cx;
      const dz = z - q.cz;
      const a = dx * q.ux + dz * q.uz;
      const d = -dx * q.uz + dz * q.ux;
      if (Math.abs(a) < q.ha + r && Math.abs(d) < q.hd + r) return true;
    }
    return inBranchCorridor(branch, x, z, r);
  };
}
