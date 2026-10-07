/** Where the tunnel box is drawn: everywhere underground except inside station halls. */

/** Underground station hall: this far beyond each platform end (stationModel.buildUndergroundStation). */
export const UG_HALL_END = 12;

/** Parts of [a, b] outside every hall range (hall ranges may overlap or extend past [a, b]). */
export function outsideHalls(a: number, b: number, halls: readonly [number, number][]): [number, number][] {
  let out: [number, number][] = [[a, b]];
  for (const [h0, h1] of halls) {
    const next: [number, number][] = [];
    for (const [p0, p1] of out) {
      if (h1 <= p0 || h0 >= p1) {
        next.push([p0, p1]);
        continue;
      }
      if (h0 > p0) next.push([p0, h0]);
      if (h1 < p1) next.push([h1, p1]);
    }
    out = next;
  }
  // Very short leftovers (under one sweep step) are dropped.
  return out.filter(([p0, p1]) => p1 - p0 > 1);
}
