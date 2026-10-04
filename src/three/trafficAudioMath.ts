import { clamp, smoothstep } from "../utils/interpolation.ts";
import type { Rng } from "../utils/random.ts";

/**
 * Pure maths for the street soundscape, kept free of three.js and WebAudio
 * so it can be unit tested. Distances are metres, speeds m/s.
 */

export type VehicleKind = "car" | "bus" | "auto" | "bike";

/** Full volume within this distance of the road. */
export const NEAR_M = 40;
/** Silent beyond this distance (Free Camera zooms out to 3 km). */
export const FAR_M = 1200;

/** Camera height and sideways distance from the carriageway, as one distance. */
export const listenerDistance = (height: number, lateral: number) => Math.hypot(Math.max(0, height), Math.max(0, lateral));

/**
 * Overall street level for a listener this far from the road. A road is a
 * line source, so it falls about 3 dB per doubling of distance, then fades
 * out completely between 600 m and FAR_M. Never increases with distance.
 */
export function listenerLevel(distance: number): number {
  const d = Math.max(distance, NEAR_M);
  return Math.sqrt(NEAR_M / d) * (1 - smoothstep(FAR_M * 0.5, FAR_M, d));
}

/** Low-pass cutoff (Hz): far-away traffic is muffled, not just quieter. */
export function listenerCutoff(distance: number): number {
  const t = clamp(Math.log(Math.max(distance, NEAR_M) / NEAR_M) / Math.log(FAR_M / NEAR_M), 0, 1);
  return 2000 * Math.pow(250 / 2000, t);
}

/** Point-source loudness (0..1): inverse distance beyond `ref`, faded to 0 at `max`. */
export function distanceGain(d: number, ref: number, max: number): number {
  if (!(d < max)) return 0;
  return (ref / Math.max(d, ref)) * (1 - smoothstep(max * 0.6, max, d));
}

/** Pitch ratio for a source approaching the listener at `radialSpeed` (negative = receding). */
export function dopplerRatio(radialSpeed: number): number {
  const c = 343;
  return c / (c - clamp(radialSpeed, -40, 40));
}

/** The `n` closest candidates within `maxDist`, nearest first. */
export function pickNearest<T extends { d: number }>(candidates: readonly T[], n: number, maxDist: number): T[] {
  const out: T[] = [];
  for (const c of candidates) {
    if (!(c.d <= maxDist)) continue;
    let i = out.length;
    while (i > 0 && out[i - 1].d > c.d) i--;
    if (i >= n) continue;
    out.splice(i, 0, c);
    if (out.length > n) out.pop();
  }
  return out;
}

/** Engine voice per vehicle type: base pitch, wobble (rate, depth) and loudness. */
export const ENGINE: Record<VehicleKind, { hz: number; lfoHz: number; lfoDepth: number; level: number }> = {
  bus: { hz: 46, lfoHz: 5, lfoDepth: 0.02, level: 1 },
  car: { hz: 68, lfoHz: 7, lfoDepth: 0.015, level: 0.6 },
  // Two-stroke auto-rickshaw: buzzy and unsteady.
  auto: { hz: 92, lfoHz: 17, lfoDepth: 0.09, level: 0.75 },
  bike: { hz: 118, lfoHz: 24, lfoDepth: 0.04, level: 0.55 },
};

export interface HornProfile {
  /** Two slightly detuned tones sounded together. */
  freqs: [number, number];
  wave: "square" | "sawtooth";
  beeps: number;
  beepSeconds: number;
  gapSeconds: number;
  level: number;
}

export function hornProfile(kind: VehicleKind, rng: Rng): HornProfile {
  const r = (a: number, b: number) => a + (b - a) * rng();
  const beeps = (max: number) => 1 + Math.floor(rng() * max);
  switch (kind) {
    case "auto": {
      const f = r(560, 650);
      return { freqs: [f, f * 1.012], wave: "square", beeps: beeps(3), beepSeconds: r(0.1, 0.16), gapSeconds: r(0.06, 0.1), level: 0.5 };
    }
    case "bike": {
      const f = r(520, 620);
      return { freqs: [f, f * 1.01], wave: "square", beeps: beeps(2), beepSeconds: r(0.14, 0.24), gapSeconds: r(0.08, 0.12), level: 0.45 };
    }
    case "bus": {
      const f = r(250, 320);
      return { freqs: [f, f * 1.26], wave: "sawtooth", beeps: 1, beepSeconds: r(0.45, 0.7), gapSeconds: 0.15, level: 0.7 };
    }
    default: {
      const f = r(380, 460);
      return { freqs: [f, f * 1.26], wave: "sawtooth", beeps: beeps(2), beepSeconds: r(0.2, 0.34), gapSeconds: r(0.08, 0.14), level: 0.55 };
    }
  }
}

/** Seconds until the next horn: occasional, and sparser at fast playback. */
export function nextHornDelay(rng: Rng, playbackSpeed: number): number {
  return (3 + rng() * 4) * (playbackSpeed > 2 ? 1.6 : 1);
}
