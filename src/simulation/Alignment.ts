import { CatmullRomCurve3, Vector3 } from "three";
import { clamp } from "../utils/interpolation.ts";

export interface Vec2 {
  x: number;
  z: number;
}

/**
 * The railway centreline as an arc-length parameterised path.
 *
 * A centripetal Catmull–Rom spline passes through every control point
 * (stations + tail-track points). It is resampled at a fixed 1 m step so
 * that position/tangent lookups by distance are O(1) during the frame loop.
 * Distance 0 is the first control point; the curve is flat (y = 0) and
 * consumers add rail level themselves.
 */
export class Alignment {
  readonly step = 1;
  readonly length: number;
  readonly controlDistances: number[];
  private readonly px: Float64Array;
  private readonly pz: Float64Array;
  private readonly tx: Float64Array;
  private readonly tz: Float64Array;
  private readonly count: number;

  constructor(controlPoints: Vec2[]) {
    if (controlPoints.length < 2) throw new Error("Alignment needs at least two points");
    const pts = controlPoints.map((p) => new Vector3(p.x, 0, p.z));
    const curve = new CatmullRomCurve3(pts, false, "centripetal");
    const segments = pts.length - 1;

    // Dense arc-length table: ~0.5 m between samples on every segment.
    const tTable: number[] = [0];
    const sTable: number[] = [0];
    const prev = curve.getPoint(0);
    const cur = new Vector3();
    let s = 0;
    for (let seg = 0; seg < segments; seg++) {
      const chord = pts[seg].distanceTo(pts[seg + 1]);
      const n = Math.max(8, Math.ceil(chord / 0.5));
      for (let k = 1; k <= n; k++) {
        const t = (seg + k / n) / segments;
        curve.getPoint(t, cur);
        s += cur.distanceTo(prev);
        prev.copy(cur);
        tTable.push(t);
        sTable.push(s);
      }
    }
    this.length = s;
    this.controlDistances = pts.map((_, i) => {
      if (i === 0) return 0;
      // Control point i sits exactly at t = i / segments.
      return interpolateTable(tTable, sTable, i / segments);
    });

    this.count = Math.floor(this.length / this.step) + 2;
    this.px = new Float64Array(this.count);
    this.pz = new Float64Array(this.count);
    this.tx = new Float64Array(this.count);
    this.tz = new Float64Array(this.count);
    const tan = new Vector3();
    for (let i = 0; i < this.count; i++) {
      const d = Math.min(i * this.step, this.length);
      const t = interpolateTable(sTable, tTable, d);
      curve.getPoint(t, cur);
      curve.getTangent(t, tan);
      tan.y = 0;
      tan.normalize();
      this.px[i] = cur.x;
      this.pz[i] = cur.z;
      this.tx[i] = tan.x;
      this.tz[i] = tan.z;
    }
  }

  /** Centreline point at distance d. Extrapolates linearly beyond the ends. */
  point(d: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
    if (d <= 0) {
      out.x = this.px[0] + this.tx[0] * d;
      out.z = this.pz[0] + this.tz[0] * d;
      return out;
    }
    if (d >= this.length) {
      const last = this.count - 1;
      const over = d - this.length;
      out.x = this.px[last] + this.tx[last] * over;
      out.z = this.pz[last] + this.tz[last] * over;
      return out;
    }
    const f = d / this.step;
    const i = Math.floor(f);
    const u = f - i;
    const j = Math.min(i + 1, this.count - 1);
    out.x = this.px[i] + (this.px[j] - this.px[i]) * u;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * u;
    return out;
  }

  /** Unit tangent (direction of increasing distance) at d. */
  tangent(d: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
    const f = clamp(d, 0, this.length) / this.step;
    const i = Math.min(Math.floor(f), this.count - 1);
    const j = Math.min(i + 1, this.count - 1);
    const u = f - i;
    const x = this.tx[i] + (this.tx[j] - this.tx[i]) * u;
    const z = this.tz[i] + (this.tz[j] - this.tz[i]) * u;
    const len = Math.hypot(x, z) || 1;
    out.x = x / len;
    out.z = z / len;
    return out;
  }

  /**
   * Unit vector to the right of the direction of increasing distance
   * (tangent × up). With +x east and -z north, a train heading east has
   * "right" pointing south (+z).
   */
  right(d: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
    const t = this.tangent(d, out);
    const x = -t.z;
    const z = t.x;
    out.x = x;
    out.z = z;
    return out;
  }

  /** Heading angle (radians) for a three.js object whose forward is +x. */
  heading(d: number): number {
    const t = this.tangent(d);
    return Math.atan2(-t.z, t.x);
  }

  /**
   * Distance along the alignment nearest to (x, z), searched within
   * `span` metres either side of `guess`: a coarse pass, then a fine one.
   */
  project(x: number, z: number, guess: number, span: number): number {
    const p = { x: 0, z: 0 };
    const dist2 = (d: number) => {
      this.point(d, p);
      return (p.x - x) ** 2 + (p.z - z) ** 2;
    };
    const lo = clamp(guess - span, 0, this.length);
    const hi = clamp(guess + span, 0, this.length);
    let best = lo;
    let bestD = Infinity;
    for (let d = lo; d <= hi; d += 10) {
      const e = dist2(d);
      if (e < bestD) [best, bestD] = [d, e];
    }
    for (let d = Math.max(lo, best - 10); d <= Math.min(hi, best + 10); d += 0.5) {
      const e = dist2(d);
      if (e < bestD) [best, bestD] = [d, e];
    }
    return best;
  }

  /** Offset point: centreline + lateral metres to the right. */
  offsetPoint(d: number, lateral: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
    const p = this.point(d, out);
    const t = this.tangent(d);
    out.x = p.x + -t.z * lateral;
    out.z = p.z + t.x * lateral;
    return out;
  }
}

function interpolateTable(keys: number[], values: number[], k: number): number {
  let lo = 0;
  let hi = keys.length - 1;
  if (k <= keys[0]) return values[0];
  if (k >= keys[hi]) return values[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] <= k) lo = mid;
    else hi = mid;
  }
  const span = keys[hi] - keys[lo] || 1;
  const u = (k - keys[lo]) / span;
  return values[lo] + (values[hi] - values[lo]) * u;
}
