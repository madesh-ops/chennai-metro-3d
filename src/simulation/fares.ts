import type { FareSlab } from "./types.ts";

/**
 * Chennai Metro fares by distance band (routes.json → fares.bands). Pure, so
 * the route pages, the ticket card and the tests can all use it without
 * loading three.js.
 */

/** Fare for a trip of `km` (rounded up into its band; the last band has no upper limit). */
export function fareForDistanceKm(km: number, slabs: readonly FareSlab[]): number {
  const d = Math.max(0, km);
  for (const s of slabs) if (s.upToKm === null || d <= s.upToKm) return s.fare;
  return slabs[slabs.length - 1]?.fare ?? 0;
}

/** Fare between two stations, from their distance along the line (km from the route start). */
export function fareForJourney(
  stations: readonly { id: string; km: number }[],
  slabs: readonly FareSlab[],
  fromId: string,
  toId: string,
): number | null {
  const a = stations.find((s) => s.id === fromId);
  const b = stations.find((s) => s.id === toId);
  if (!a || !b || !slabs.length) return null;
  return fareForDistanceKm(Math.abs(b.km - a.km), slabs);
}

/** Fare after a percentage discount, rounded to the nearest rupee. */
export const discountedFare = (fare: number, percent: number) => Math.round(fare * (1 - percent / 100));
