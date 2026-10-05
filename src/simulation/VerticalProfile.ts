/**
 * Rail height along a route, from the elevated / underground / at-grade runs
 * of the real track (network.json, from OpenStreetMap bridge/tunnel/layer
 * tags). Viaducts sit at the elevated rail level, tunnels below ground (deeper
 * for deeper OSM layers); between them the track ramps at no more than
 * MAX_GRADE, and stations are kept level.
 */

export type TrackKind = "elevated" | "underground" | "at-grade";

export interface ProfileRun {
  /** Alignment distances. */
  from: number;
  to: number;
  kind: TrackKind;
  layer: number;
}

export interface VerticalProfile {
  /** Rail-top height above ground at alignment distance d (m). */
  railAt(d: number): number;
  /** Structure at d: the run's kind, or "ramp" where the track is between levels. */
  kindAt(d: number): TrackKind | "ramp";
  runs: ProfileRun[];
}

export const MAX_GRADE = 0.04;
/** Rail top in a cut-and-cover box or bored tunnel (layer -1); each deeper layer adds 4 m. */
export const UNDERGROUND_RAIL = -14;
export const AT_GRADE_RAIL = 1.0;
const STEP = 5;
/** Half-length kept level at each station (a 3-car train plus margin). */
const STATION_FLAT = 60;

export function targetHeight(kind: TrackKind, layer: number, elevatedRail: number): number {
  if (kind === "underground") return UNDERGROUND_RAIL - 4 * Math.max(0, Math.abs(layer) - 1);
  if (kind === "at-grade") return AT_GRADE_RAIL;
  return elevatedRail;
}

/**
 * Build a profile over [0, length]. Stations are fixed points (kept level); the
 * runs give each stretch's target height; ramps are spread across each change
 * of level, then the whole profile is slope-limited so no grade exceeds MAX_GRADE.
 */
export function buildVerticalProfile(runs: ProfileRun[], length: number, stations: number[], elevatedRail: number): VerticalProfile {
  const n = Math.ceil(length / STEP) + 1;
  const target = new Float64Array(n);
  const kinds: TrackKind[] = new Array(n);
  const runAt = (d: number) => runs.find((r) => d >= r.from && d <= r.to) ?? (d < (runs[0]?.from ?? 0) ? runs[0] : runs[runs.length - 1]);
  for (let i = 0; i < n; i++) {
    const r = runAt(i * STEP);
    kinds[i] = r?.kind ?? "elevated";
    target[i] = r ? targetHeight(r.kind, r.layer, elevatedRail) : elevatedRail;
  }
  // Station flat zones (kept level at the height of the run they are in).
  const zones = stations.map((sd) => [sd - STATION_FLAT, sd + STATION_FLAT] as const);
  const fixed = new Uint8Array(n);
  for (const [z0, z1] of zones) {
    const hz = target[Math.min(n - 1, Math.max(0, Math.round((z0 + z1) / 2 / STEP)))];
    for (let i = Math.max(0, Math.ceil(z0 / STEP)); i <= Math.min(n - 1, Math.floor(z1 / STEP)); i++) {
      target[i] = hz;
      fixed[i] = 1;
    }
  }
  // A straight ramp across each change of level, centred on it and shifted off any station.
  const h = Float64Array.from(target);
  for (let i = 1; i < n; i++) {
    const a = target[i - 1];
    const b = target[i];
    if (Math.abs(b - a) < 1e-6) continue;
    const D = i * STEP;
    const L = Math.abs(b - a) / MAX_GRADE;
    let r0 = D - L / 2;
    let r1 = D + L / 2;
    for (const [z0, z1] of zones) {
      if (r1 <= z0 || r0 >= z1) continue;
      if ((z0 + z1) / 2 <= D) {
        r0 = z1;
        r1 = r0 + L;
      } else {
        r1 = z0;
        r0 = r1 - L;
      }
    }
    for (let k = Math.max(0, Math.floor(r0 / STEP)); k <= Math.min(n - 1, Math.ceil(r1 / STEP)); k++) {
      if (fixed[k]) continue;
      const u = Math.min(1, Math.max(0, (k * STEP - r0) / (r1 - r0)));
      h[k] = a + (b - a) * u;
    }
  }
  // Where ramps crowd each other, limit the grade from both sides (stations win).
  const dh = MAX_GRADE * STEP;
  for (let i = 1; i < n; i++) if (!fixed[i]) h[i] = Math.min(Math.max(h[i], h[i - 1] - dh), h[i - 1] + dh);
  for (let i = n - 2; i >= 0; i--) if (!fixed[i]) h[i] = Math.min(Math.max(h[i], h[i + 1] - dh), h[i + 1] + dh);
  // Round the knees of each ramp a little (vertical curves), keeping stations level.
  const smooth = Float64Array.from(h);
  for (let i = 2; i < n - 2; i++) if (!fixed[i]) smooth[i] = (h[i - 2] + h[i - 1] + h[i] + h[i + 1] + h[i + 2]) / 5;

  const railAt = (d: number) => {
    const x = Math.min(n - 1, Math.max(0, d / STEP));
    const i = Math.floor(x);
    const t = x - i;
    return i + 1 < n ? smooth[i] * (1 - t) + smooth[i + 1] * t : smooth[i];
  };
  // Classified by height: a change of depth inside a tunnel is still underground.
  const kindAt = (d: number): TrackKind | "ramp" => {
    const y = railAt(d);
    if (y <= UNDERGROUND_RAIL + 6) return "underground";
    if (y >= elevatedRail - 4) return "elevated";
    if (Math.abs(y - AT_GRADE_RAIL) < 0.5) return "at-grade";
    return "ramp";
  };
  return { railAt, kindAt, runs };
}

/** A flat profile (every route before network.json, and tests). */
export function flatProfile(rail: number): VerticalProfile {
  return { railAt: () => rail, kindAt: () => "elevated", runs: [] };
}
