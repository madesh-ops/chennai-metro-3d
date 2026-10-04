import type { CrowdLevel } from "./store.ts";

/**
 * How full trains and platforms are, 0 (empty) .. 1 (packed).
 *
 * "auto" follows a typical weekday on Chennai Metro by local clock time:
 * morning and evening peaks, a calmer middle of the day, and a quiet late
 * evening. Service runs about 05:00–23:00, so the small hours stay sparse.
 * The fixed levels let the rider choose instead.
 */
const AUTO: [hour: number, factor: number][] = [
  [0, 0.15],
  [5, 0.15],
  [6.5, 0.4],
  [8, 0.9],
  [11, 0.9],
  [12, 0.5],
  [16.5, 0.5],
  [17.5, 0.9],
  [20, 0.9],
  [21.5, 0.4],
  [23, 0.15],
  [24, 0.15],
];

const FIXED: Record<Exclude<CrowdLevel, "auto">, number> = {
  light: 0.2,
  busy: 0.6,
  packed: 1,
};

/** Crowd factor for a level at a local hour of day (fractional hours allowed). */
export function crowdFactor(level: CrowdLevel, hour: number): number {
  if (level !== "auto") return FIXED[level];
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < AUTO.length; i++) {
    const [h1, v1] = AUTO[i];
    if (h <= h1) {
      const [h0, v0] = AUTO[i - 1];
      const u = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
      return v0 + (v1 - v0) * u;
    }
  }
  return AUTO[AUTO.length - 1][1];
}

/** The current local hour as a fraction (e.g. 17.5 = half past five in the evening). */
export function localHour(date = new Date()): number {
  return date.getHours() + date.getMinutes() / 60;
}
