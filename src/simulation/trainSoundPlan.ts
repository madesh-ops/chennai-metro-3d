import type { StopTiming } from "./TrainController.ts";

/**
 * Which train recording should be playing at simulation time t, and where in it.
 *
 * Because the trajectory is computed up front, the soundtrack is a pure
 * function of time: a departure clip as the train pulls away, a running loop
 * while it cruises, and a braking clip timed to end exactly as it halts.
 * Pause, scrubbing and playback speed then come for free — the player only
 * has to keep real audio matched to this plan.
 */

export type TrainClip = "start" | "run" | "stop";

export interface ClipLengths {
  start: number;
  run: number;
  stop: number;
}

export interface SoundLayer {
  /** Stable identity of this playthrough (one per clip instance). */
  key: string;
  clip: TrainClip;
  /** Seconds into the clip. */
  offset: number;
  /** 0..1, equal-power crossfades between layers. */
  gain: number;
}

/** Departure clip fades into the loop over its last seconds. */
export const START_FADE_S = 1.5;
/** Overlap between loop repeats so the loop has no seam. */
export const LOOP_OVERLAP_S = 0.4;
/** Loop fades into the braking clip. */
export const STOP_FADE_S = 1.0;
/** Short fade at the very end of the braking clip, as the train halts. */
const STOP_TAIL_S = 0.25;

const fadeIn = (x: number) => Math.sin((Math.PI / 2) * Math.min(1, Math.max(0, x)));
const fadeOut = (x: number) => Math.cos((Math.PI / 2) * Math.min(1, Math.max(0, x)));

type Timing = Pick<StopTiming, "departTime" | "arriveTime">;

export function trainSoundLayers(t: number, stops: readonly Timing[], len: ClipLengths): SoundLayer[] {
  const out: SoundLayer[] = [];
  if (!(len.start > 0 && len.run > LOOP_OVERLAP_S && len.stop > 0)) return out;

  // The run (departure → next arrival) that contains t, if any.
  let k = -1;
  for (let i = 0; i < stops.length - 1; i++) {
    const d = stops[i].departTime;
    if (Number.isFinite(d) && t >= d && t < stops[i + 1].arriveTime) {
      k = i;
      break;
    }
  }
  if (k < 0) return out;

  const d = stops[k].departTime;
  const a = stops[k + 1].arriveTime;
  const stopStart = Math.max(d, a - len.stop);
  const runStart = d + len.start - START_FADE_S;
  const hasRun = runStart < stopStart;
  const push = (key: string, clip: TrainClip, offset: number, gain: number) => {
    if (gain > 0.001) out.push({ key, clip, offset, gain });
  };

  // Departure clip.
  const startEnd = hasRun ? d + len.start : Math.min(d + len.start, stopStart + STOP_FADE_S);
  if (t < startEnd) {
    const gain = hasRun ? (t < runStart ? 1 : fadeOut((t - runStart) / START_FADE_S)) : t < stopStart ? 1 : fadeOut((t - stopStart) / STOP_FADE_S);
    push(`start:${k}`, "start", t - d, gain);
  }

  // Running loop: repeats overlap slightly, each with its own key.
  if (hasRun && t >= runStart && t < stopStart + STOP_FADE_S) {
    const envelope =
      (t < runStart + START_FADE_S ? fadeIn((t - runStart) / START_FADE_S) : 1) *
      (t >= stopStart ? fadeOut((t - stopStart) / STOP_FADE_S) : 1);
    const period = len.run - LOOP_OVERLAP_S;
    const u = t - runStart;
    const n = Math.floor(u / period);
    const offset = u - n * period;
    const inX = offset / LOOP_OVERLAP_S;
    push(`run:${k}:${n}`, "run", offset, envelope * (n > 0 && inX < 1 ? fadeIn(inX) : 1));
    // Tail of the previous repeat, crossfading out.
    if (n > 0 && inX < 1) push(`run:${k}:${n - 1}`, "run", offset + period, envelope * fadeOut(inX));
  }

  // Braking clip, ending exactly at the halt.
  if (t >= stopStart) {
    const offset = t - (a - len.stop);
    const tail = a - t < STOP_TAIL_S ? (a - t) / STOP_TAIL_S : 1;
    const gain = stopStart > d || hasRun ? fadeIn((t - stopStart) / STOP_FADE_S) : 1;
    push(`stop:${k}`, "stop", offset, gain * tail);
  }
  return out;
}
