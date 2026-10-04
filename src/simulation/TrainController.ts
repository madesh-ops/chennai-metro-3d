import { clamp, easeInOutCubic } from "../utils/interpolation.ts";
import { limitAt, type Journey } from "./Journey.ts";
import { TRAIN_STATES, type OperationsParams, type TrainState } from "./types.ts";

/**
 * Train motion.
 *
 * The whole journey is integrated once, up front, with a jerk-limited speed
 * controller that follows braking curves for stops and speed restrictions.
 * The result is a time-indexed trajectory. Playback then becomes a lookup,
 * which makes pause, 0.5×–4× speed and timeline scrubbing exact and keeps
 * acceleration and braking physically identical at every playback speed.
 */

export interface StopTiming {
  stopIndex: number;
  arriveTime: number;
  doorsOpenStart: number;
  doorsOpenEnd: number;
  closeStart: number;
  /** Departure time; Infinity at the terminus. */
  departTime: number;
}

export interface TrainSample {
  time: number;
  /** Journey-local distance (modelled metres). */
  x: number;
  /** m/s */
  v: number;
  /** m/s² */
  a: number;
  /** 0 = closed, 1 = fully open */
  door: number;
  state: TrainState;
  /** Stop the train is at, or last departed. */
  stopIndex: number;
  nextStopIndex: number;
  progress: number;
}

export const createSample = (): TrainSample => ({
  time: 0,
  x: 0,
  v: 0,
  a: 0,
  door: 1,
  state: "idle",
  stopIndex: 0,
  nextStopIndex: 1,
  progress: 0,
});

const RECORD_DT = 0.1;
const STEP_DT = 0.02;
const STEPS_PER_RECORD = Math.round(RECORD_DT / STEP_DT);

export class Trajectory {
  readonly dt = RECORD_DT;
  readonly duration: number;
  readonly length: number;
  readonly stopCount: number;
  readonly stops: StopTiming[];
  private readonly xs: Float64Array;
  private readonly vs: Float32Array;
  private readonly as: Float32Array;
  private readonly doors: Float32Array;
  private readonly states: Uint8Array;
  private readonly stopIdx: Int16Array;
  private readonly count: number;

  constructor(rec: Recorder, stops: StopTiming[], length: number) {
    this.count = rec.x.length;
    this.xs = Float64Array.from(rec.x);
    this.vs = Float32Array.from(rec.v);
    this.as = Float32Array.from(rec.a);
    this.doors = Float32Array.from(rec.door);
    this.states = Uint8Array.from(rec.state);
    this.stopIdx = Int16Array.from(rec.stop);
    this.duration = (this.count - 1) * RECORD_DT;
    this.stops = stops;
    this.stopCount = stops.length;
    this.length = length;
  }

  sample(t: number, out: TrainSample = createSample()): TrainSample {
    const tt = clamp(t, 0, this.duration);
    const f = tt / RECORD_DT;
    const i = Math.min(Math.floor(f), this.count - 1);
    const j = Math.min(i + 1, this.count - 1);
    const u = f - i;
    out.time = tt;
    out.x = this.xs[i] + (this.xs[j] - this.xs[i]) * u;
    out.v = this.vs[i] + (this.vs[j] - this.vs[i]) * u;
    out.a = this.as[i] + (this.as[j] - this.as[i]) * u;
    out.door = this.doors[i] + (this.doors[j] - this.doors[i]) * u;
    out.state = TRAIN_STATES[this.states[i]];
    out.stopIndex = this.stopIdx[i];
    out.nextStopIndex = Math.min(out.stopIndex + 1, this.stopCount - 1);
    out.progress = this.length > 0 ? out.x / this.length : 0;
    return out;
  }

  /** Simulation time at which the train first reaches journey distance x. */
  timeAtDistance(x: number): number {
    let lo = 0;
    let hi = this.count - 1;
    if (x <= this.xs[0]) return 0;
    if (x >= this.xs[hi]) {
      // First index reaching the end.
      while (hi > 0 && this.xs[hi - 1] >= x) hi--;
      return hi * RECORD_DT;
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.xs[mid] < x) lo = mid;
      else hi = mid;
    }
    return hi * RECORD_DT;
  }
}

interface Recorder {
  x: number[];
  v: number[];
  a: number[];
  door: number[];
  state: number[];
  stop: number[];
}

const stateCode = (s: TrainState) => TRAIN_STATES.indexOf(s);

export function simulateJourney(journey: Journey, ops: OperationsParams): Trajectory {
  const rec: Recorder = { x: [], v: [], a: [], door: [], state: [], stop: [] };
  const stops: StopTiming[] = [];

  let t = 0;
  let x = 0;
  let v = 0;
  let a = 0;
  let stepCount = 0;
  let currentStop = 0;

  const record = (state: TrainState, door: number) => {
    if (stepCount % STEPS_PER_RECORD === 0) {
      rec.x.push(x);
      rec.v.push(v);
      rec.a.push(a);
      rec.door.push(door);
      rec.state.push(stateCode(state));
      rec.stop.push(currentStop);
    }
    stepCount++;
    t += STEP_DT;
  };

  const hold = (seconds: number, state: TrainState, door: (u: number) => number) => {
    const n = Math.max(1, Math.round(seconds / STEP_DT));
    for (let k = 0; k < n; k++) record(state, door(k / n));
  };

  const aMax = ops.accelerationMps2;
  const bPlan = ops.serviceBrakeMps2;
  const bMax = ops.maxBrakeMps2;
  const jerk = ops.jerkMps3;
  const kP = 1.6;

  const drive = (target: number) => {
    const departAt = t;
    const departX = x;
    const guardUntil = t + 3600;
    for (;;) {
      const dist = target - x;

      // Speed restrictions: current section and any lower limit ahead.
      let vT = limitAt(journey, x + 0.5);
      for (const l of journey.limits) {
        if (l.x0 > x && l.v < vT) {
          const room = Math.max(0, l.x0 - x - 5);
          vT = Math.min(vT, Math.sqrt(l.v * l.v + 2 * bPlan * room));
        }
      }
      // Stopping curve for the platform.
      vT = Math.min(vT, Math.sqrt(Math.max(0, 2 * bPlan * (dist - 0.1))));

      let aDes = clamp(kP * (vT - v), -bMax, aMax);
      // Final approach: decelerate exactly onto the stopping mark.
      if (dist < 60 && v > 0.05) {
        const aReq = (v * v) / (2 * Math.max(dist, 0.02));
        if (aReq >= bPlan * 0.97) aDes = -Math.min(aReq, bMax * 1.2);
      }
      const da = clamp(aDes - a, -jerk * STEP_DT * 2.2, jerk * STEP_DT);
      a = dist < 60 && aDes < a ? aDes : a + da;
      v = Math.max(0, v + a * STEP_DT);
      x += v * STEP_DT;

      // Snap onto the mark only once the train is effectively still, so the
      // last few centimetres never produce a visible jolt.
      if (x >= target - 0.001 || (dist < 0.02 && v < 0.02)) {
        x = target;
        v = 0;
        a = 0;
        return;
      }

      let state: TrainState;
      const sinceDepart = t - departAt;
      const brakeZone = (v * v) / (2 * bPlan) + 30;
      if ((sinceDepart < 7 || x - departX < 35) && a >= -0.02) state = "departing";
      else if (dist < Math.max(140, brakeZone) && a < -0.02) state = "arriving";
      else if (a < -0.06) state = "braking";
      else if (a > 0.06) state = "accelerating";
      else state = "cruising";
      record(state, 0);

      if (t > guardUntil) throw new Error("Train failed to reach its stop — check operations parameters.");
    }
  };

  const doorEase = (from: number, to: number) => (u: number) => from + (to - from) * easeInOutCubic(u);

  // Origin: boarding with doors open, then doors close and we depart.
  stops.push({ stopIndex: 0, arriveTime: 0, doorsOpenStart: 0, doorsOpenEnd: 0, closeStart: 0, departTime: 0 });
  hold(ops.originBoardingSeconds, "doors-open", () => 1);
  stops[0].closeStart = t;
  hold(ops.doorClosingSeconds, "doors-closing", doorEase(1, 0));
  stops[0].departTime = t;

  for (let k = 1; k < journey.stops.length; k++) {
    drive(journey.stops[k].x);
    currentStop = k;
    const timing: StopTiming = {
      stopIndex: k,
      arriveTime: t,
      doorsOpenStart: 0,
      doorsOpenEnd: 0,
      closeStart: Infinity,
      departTime: Infinity,
    };
    stops.push(timing);
    hold(ops.settleBeforeDoorsSeconds, "stopped", () => 0);
    timing.doorsOpenStart = t;
    hold(ops.doorOpeningSeconds, "doors-open", doorEase(0, 1));
    timing.doorsOpenEnd = t;
    const last = k === journey.stops.length - 1;
    if (last) {
      hold(ops.terminusAlightSeconds, "doors-open", () => 1);
      break;
    }
    hold(ops.dwellSeconds, "doors-open", () => 1);
    timing.closeStart = t;
    hold(ops.doorClosingSeconds, "doors-closing", doorEase(1, 0));
    timing.departTime = t;
  }
  // Final record so the trajectory ends exactly at the terminus.
  stepCount = 0;
  record("doors-open", 1);

  return new Trajectory(rec, stops, journey.length);
}
