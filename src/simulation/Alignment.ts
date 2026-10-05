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
    // Positions of the arc samples, reused for the 1 m table below (no second pass over the curve).
    const xs: number[] = [prev.x];
    const zs: number[] = [prev.z];
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
        xs.push(cur.x);
        zs.push(cur.z);
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
    // Positions every metre, interpolated between the ~0.5 m arc samples (walking forward).
    let j = 0;
    for (let i = 0; i < this.count; i++) {
      const d = Math.min(i * this.step, this.length);
      while (j < sTable.length - 2 && sTable[j + 1] < d) j++;
      const span = sTable[j + 1] - sTable[j] || 1;
      const u = clamp((d - sTable[j]) / span, 0, 1);
      this.px[i] = xs[j] + (xs[j + 1] - xs[j]) * u;
      this.pz[i] = zs[j] + (zs[j + 1] - zs[j]) * u;
    }
    // Tangents by central differences (one-sided at the ends).
    for (let i = 0; i < this.count; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(this.count - 1, i + 1);
      const dx = this.px[b] - this.px[a];
      const dz = this.pz[b] - this.pz[a];
      const l = Math.hypot(dx, dz);
      // Coincident samples (the last two can share the end point): keep the previous direction.
      this.tx[i] = l > 1e-9 ? dx / l : i > 0 ? this.tx[i - 1] : 1;
      this.tz[i] = l > 1e-9 ? dz / l : i > 0 ? this.tz[i - 1] : 0;
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
    // Straight on the 1 m sample table (no per-step interpolation): a 3 m coarse
    // pass, a 1 m pass round the best, then an exact projection onto its segments.
    const lo = clamp(guess - span, 0, this.length);
    const hi = clamp(guess + span, 0, this.length);
    const i0 = Math.floor(lo / this.step);
    const i1 = Math.min(this.count - 1, Math.ceil(hi / this.step));
    const px = this.px;
    const pz = this.pz;
    let bi = i0;
    let bd = Infinity;
    for (let i = i0; i <= i1; i += 3) {
      const dx = px[i] - x;
      const dz = pz[i] - z;
      const e = dx * dx + dz * dz;
      if (e < bd) {
        bd = e;
        bi = i;
      }
    }
    for (let i = Math.max(i0, bi - 3); i <= Math.min(i1, bi + 3); i++) {
      const dx = px[i] - x;
      const dz = pz[i] - z;
      const e = dx * dx + dz * dz;
      if (e < bd) {
        bd = e;
        bi = i;
      }
    }
    let best = bi * this.step;
    for (const a of [bi - 1, bi]) {
      const b = a + 1;
      if (a < i0 || b > i1) continue;
      const sx = px[b] - px[a];
      const sz = pz[b] - pz[a];
      const l2 = sx * sx + sz * sz || 1;
      const t = clamp(((x - px[a]) * sx + (z - pz[a]) * sz) / l2, 0, 1);
      const dx = px[a] + sx * t - x;
      const dz = pz[a] + sz * t - z;
      const e = dx * dx + dz * dz;
      if (e < bd) {
        bd = e;
        best = (a + t) * this.step;
      }
    }
    return clamp(best, lo, hi);
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
