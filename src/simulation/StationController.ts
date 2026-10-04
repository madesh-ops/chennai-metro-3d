import type { StopTiming, TrainSample } from "./TrainController.ts";
import type { ArrivalPhase } from "./types.ts";

/** How long before arrival the "Next station" card appears (simulation seconds). */
export const APPROACH_WINDOW_S = 26;
/** How long the "Next: …" hint stays after departure. */
export const DEPARTED_WINDOW_S = 7;

/**
 * Derives the passenger-facing arrival sequence from the train state:
 * approaching → arrived → doors opening → doors open → doors closing → departed.
 */
export function arrivalPhase(sample: TrainSample, stops: StopTiming[]): ArrivalPhase {
  const t = sample.time;
  const cur = stops[sample.stopIndex];
  switch (sample.state) {
    case "stopped":
      return "arrived";
    case "doors-open":
      if (cur && t < cur.doorsOpenEnd) return "doors-opening";
      if (cur && t - cur.doorsOpenEnd < 3 && sample.stopIndex > 0) return "doors-opening";
      return "doors-open";
    case "doors-closing":
      return "doors-closing";
    case "idle":
      return "none";
    default: {
      const next = stops[sample.stopIndex + 1];
      if (next && next.arriveTime - t <= APPROACH_WINDOW_S) return "approaching";
      if (cur && Number.isFinite(cur.departTime) && t - cur.departTime < DEPARTED_WINDOW_S) return "departed";
      return "none";
    }
  }
}

/** Seconds until the next stop (0 while stopped at the final stop). */
export function etaToNext(sample: TrainSample, stops: StopTiming[]): number {
  const next = stops[sample.stopIndex + 1];
  if (!next) return 0;
  return Math.max(0, next.arriveTime - sample.time);
}
