import type { Alignment } from "../simulation/Alignment.ts";
import type { RouteModel } from "../simulation/RouteController.ts";
import { ROAD, VIADUCT } from "./layout.ts";

/**
 * Ground-level layout around Porur Junction: the side roads leaving the
 * corridor (Mount–Poonamallee Road towards Guindy, Kundrathur Main Road),
 * the street beneath the Line 5 viaduct's peel-away curve, and a clearance
 * corridor that keeps buildings and trees off those roads and from under the
 * viaduct.
 */

export interface BranchRoad {
  alignment: Alignment;
  from: number;
  to: number;
  width: number;
}

export interface CorridorSample {
  x: number;
  z: number;
  half: number;
}

export interface BranchLayout {
  roads: BranchRoad[];
  samples: CorridorSample[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const cache = new WeakMap<RouteModel, BranchLayout | null>();

export function branchLayout(route: RouteModel): BranchLayout | null {
  if (cache.has(route)) return cache.get(route)!;
  const roads: BranchRoad[] = [];
  const samples: CorridorSample[] = [];
  const offMain = (x: number, z: number, guess: number) => {
    const d = route.alignment.project(x, z, guess, 1500);
    const c = route.alignment.point(d);
    return Math.hypot(x - c.x, z - c.z);
  };

  // Side roads, drawn from their junction (before it they are the corridor road).
  for (const r of route.sideRoads.values()) {
    roads.push({ alignment: r.alignment, from: r.junctionS, to: r.alignment.length, width: r.width });
  }

  // Street under the Line 5 curve: from where it leaves the main road to where it lands on its side road.
  const b = route.line5Branch;
  const deckHalf = VIADUCT.halfWidth + 2;
  if (b) {
    const clearOfMain = ROAD.halfWidth + ROAD.sidewalk + 1;
    let streetFrom = 0;
    while (streetFrom < b.landS) {
      const p = b.alignment.point(streetFrom);
      if (offMain(p.x, p.z, b.junction) >= clearOfMain) break;
      streetFrom += 2;
    }
    if (streetFrom < b.landS) roads.push({ alignment: b.alignment, from: streetFrom, to: b.landS + 10, width: b.raw.streetWidthM });
    // The viaduct itself, all the way.
    for (let s = 0; s <= b.alignment.length; s += 8) {
      const p = b.alignment.point(s);
      samples.push({ x: p.x, z: p.z, half: deckHalf });
    }
  }

  for (const r of roads) {
    const half = r.width / 2 + 2.5;
    for (let s = r.from; s <= r.to; s += 8) {
      const p = r.alignment.point(s);
      samples.push({ x: p.x, z: p.z, half });
    }
  }
  if (!samples.length) {
    cache.set(route, null);
    return null;
  }
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of samples) {
    bounds.minX = Math.min(bounds.minX, p.x - p.half);
    bounds.maxX = Math.max(bounds.maxX, p.x + p.half);
    bounds.minZ = Math.min(bounds.minZ, p.z - p.half);
    bounds.maxZ = Math.max(bounds.maxZ, p.z + p.half);
  }
  const out = { roads, samples, bounds };
  cache.set(route, out);
  return out;
}

/** Is a circle (world x, z, radius) on one of these roads or under the Line 5 viaduct? */
export function inBranchCorridor(layout: BranchLayout | null, x: number, z: number, radius: number): boolean {
  if (!layout) return false;
  const { bounds } = layout;
  if (x + radius < bounds.minX || x - radius > bounds.maxX || z + radius < bounds.minZ || z - radius > bounds.maxZ) return false;
  for (const s of layout.samples) {
    const r = s.half + radius;
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}
