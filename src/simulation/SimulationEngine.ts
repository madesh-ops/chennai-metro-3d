import { arrivalPhase, etaToNext } from "./StationController.ts";
import { SimulationClock } from "./SimulationClock.ts";
import { simulateJourney, createSample, type Trajectory, type TrainSample } from "./TrainController.ts";
import { planJourney, journeyToAlignment, type Journey } from "./Journey.ts";
import type { RouteModel } from "./RouteController.ts";
import type { ArrivalPhase, SimulationState } from "./types.ts";

export type EngineEvent =
  | { type: "approaching"; stopIndex: number }
  | { type: "arrived"; stopIndex: number }
  | { type: "doors-closing"; stopIndex: number }
  | { type: "departed"; stopIndex: number }
  | { type: "finished" };

type Listener = () => void;
type EventListener = (e: EngineEvent) => void;

const UI_INTERVAL = 0.1;

/**
 * Owns the clock, the precomputed trajectory and the live train sample.
 *
 * The 3D scene reads `engine.sample` directly every frame (no React work);
 * the DOM UI subscribes through useSyncExternalStore and receives an
 * immutable SimulationState snapshot at most ten times per second, or
 * immediately when something discrete changes.
 */
export class SimulationEngine {
  readonly route: RouteModel;
  readonly journey: Journey;
  readonly trajectory: Trajectory;
  readonly clock: SimulationClock;
  readonly sample: TrainSample = createSample();
  /** True once the user has pressed play at least once. */
  started = false;
  private snapshot: SimulationState;
  private listeners = new Set<Listener>();
  private eventListeners = new Set<EventListener>();
  private sinceNotify = 0;
  private lastPhase: ArrivalPhase = "none";
  private lastPhaseStop = -1;
  /** Simulation seconds advanced on the last update (for traffic etc.). */
  lastDelta = 0;

  constructor(route: RouteModel, fromId: string, toId: string) {
    this.route = route;
    this.journey = planJourney(route, fromId, toId);
    this.trajectory = simulateJourney(this.journey, route.operations);
    this.clock = new SimulationClock(this.trajectory.duration);
    this.trajectory.sample(0, this.sample);
    this.snapshot = this.buildSnapshot();
  }

  /** Alignment distance of the train centre (stops align it with the platform centre). */
  get centerDistance(): number {
    return journeyToAlignment(this.journey, this.sample.x);
  }

  update(realDelta: number) {
    this.lastDelta = this.clock.tick(realDelta);
    this.trajectory.sample(this.clock.time, this.sample);
    if (!this.started) this.sample.state = "idle";

    const phase = this.started ? arrivalPhase(this.sample, this.trajectory.stops) : "none";
    const discreteChange =
      phase !== this.lastPhase ||
      this.sample.state !== this.snapshot.state ||
      this.sample.stopIndex !== this.snapshot.currentStationIndex ||
      this.clock.playing !== this.snapshot.isPlaying;

    if (phase !== this.lastPhase || this.sample.stopIndex !== this.lastPhaseStop) {
      this.emitPhase(phase);
      this.lastPhase = phase;
      this.lastPhaseStop = this.sample.stopIndex;
    }

    this.sinceNotify += realDelta;
    if (discreteChange || (this.clock.playing && this.sinceNotify >= UI_INTERVAL)) {
      this.sinceNotify = 0;
      this.snapshot = this.buildSnapshot(phase);
      this.listeners.forEach((l) => l());
    }
  }

  private emitPhase(phase: ArrivalPhase) {
    const stopIndex = this.sample.stopIndex;
    if (phase === "approaching") this.emit({ type: "approaching", stopIndex: stopIndex + 1 });
    else if (phase === "arrived" || (phase === "doors-opening" && this.lastPhase === "approaching"))
      this.emit({ type: "arrived", stopIndex });
    else if (phase === "doors-closing") this.emit({ type: "doors-closing", stopIndex });
    else if (phase === "departed") this.emit({ type: "departed", stopIndex });
    if (this.clock.finished && this.started) this.emit({ type: "finished" });
  }

  private emit(e: EngineEvent) {
    this.eventListeners.forEach((l) => l(e));
  }

  private buildSnapshot(phase: ArrivalPhase = this.lastPhase): SimulationState {
    const s = this.sample;
    const scale = this.journey.displayScale;
    return {
      isPlaying: this.clock.playing,
      simulationSpeed: this.clock.speed,
      currentStationIndex: s.stopIndex,
      nextStationIndex: s.nextStopIndex,
      trainProgress: s.progress,
      trainSpeed: s.v * 3.6,
      distanceTravelled: s.x * scale,
      totalDistance: this.journey.length * scale,
      state: this.started ? s.state : "idle",
      elapsed: this.clock.time,
      duration: this.clock.duration,
      etaNext: etaToNext(s, this.trajectory.stops),
      arrival: phase,
      finished: this.started && this.clock.finished,
    };
  }

  private forceNotify() {
    this.trajectory.sample(this.clock.time, this.sample);
    if (!this.started) this.sample.state = "idle";
    const phase = this.started ? arrivalPhase(this.sample, this.trajectory.stops) : "none";
    this.lastPhase = phase;
    this.lastPhaseStop = this.sample.stopIndex;
    this.snapshot = this.buildSnapshot(phase);
    this.listeners.forEach((l) => l());
  }

  play() {
    if (this.clock.finished) this.clock.seek(0);
    this.started = true;
    this.clock.playing = true;
    this.forceNotify();
  }

  pause() {
    this.clock.playing = false;
    this.forceNotify();
  }

  toggle() {
    if (this.clock.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: number) {
    this.clock.speed = speed;
    this.forceNotify();
  }

  seek(time: number) {
    this.started = true;
    this.clock.seek(time);
    this.forceNotify();
  }

  restart() {
    this.clock.seek(0);
    this.forceNotify();
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  onEvent(l: EventListener) {
    this.eventListeners.add(l);
    return () => {
      this.eventListeners.delete(l);
    };
  }

  getSnapshot = () => this.snapshot;
}
