/**
 * Simulation time. Real elapsed time × speed multiplier, clamped so a
 * backgrounded tab or a long frame never makes the train jump.
 */
export const SPEED_OPTIONS = [0.5, 1, 2, 4] as const;
export type SpeedOption = (typeof SPEED_OPTIONS)[number];

export class SimulationClock {
  time = 0;
  playing = false;
  speed: number = 1;
  duration: number;
  private readonly maxRealDelta = 0.1;

  constructor(duration: number) {
    this.duration = duration;
  }

  /** Advance by a real-time delta (seconds). Returns the simulation delta. */
  tick(realDelta: number): number {
    if (!this.playing) return 0;
    const dt = Math.min(Math.max(realDelta, 0), this.maxRealDelta) * this.speed;
    const before = this.time;
    this.time = Math.min(this.duration, this.time + dt);
    if (this.time >= this.duration) this.playing = false;
    return this.time - before;
  }

  seek(time: number) {
    this.time = Math.min(Math.max(time, 0), this.duration);
  }

  get finished() {
    return this.time >= this.duration;
  }
}
