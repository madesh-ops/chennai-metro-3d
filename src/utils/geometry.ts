import { BufferAttribute, BufferGeometry, Matrix4, Quaternion, Vector3 } from "three";
import type { Alignment } from "../simulation/Alignment.ts";

/**
 * A 2D cross-section point: `l` metres to the right of the centreline,
 * `y` metres above the sweep's base height.
 */
export interface ProfilePoint {
  l: number;
  y: number;
}

export interface SweepOptions {
  /** Extra lateral offset applied to every profile point. */
  lateral?: number;
  /** Base height added to every profile point. */
  baseY?: number;
  /** Texture U per metre along the path. */
  uPerMetre?: number;
  /** Texture V per metre across the profile. */
  vPerMetre?: number;
  /** Close the profile (last point joins the first). */
  closed?: boolean;
  /** Base height as a function of distance (overrides baseY), for climbing or falling sweeps. */
  heightAt?: (d: number) => number;
  /** Cross-section as a function of distance (same point count as `profile`), e.g. to stop at the ground. */
  profileAt?: (d: number) => ProfilePoint[];
}

/**
 * Sweep a cross-section along the alignment between distances d0 and d1.
 *
 * Profiles are counter-clockwise polygons in (l, y) — l to the right, y up —
 * which yields outward-facing triangles. Each profile edge gets its own
 * vertices so creases stay sharp while the path direction stays smooth.
 */
export function sweepProfile(
  alignment: Alignment,
  d0: number,
  d1: number,
  step: number,
  profile: ProfilePoint[],
  opts: SweepOptions = {},
): BufferGeometry {
  const { lateral = 0, baseY = 0, uPerMetre = 1, vPerMetre = 1, closed = false, heightAt, profileAt } = opts;
  const pts = closed ? [...profile, profile[0]] : profile;
  const edges = pts.length - 1;
  const samples = Math.max(2, Math.ceil((d1 - d0) / step) + 1);

  // Cumulative profile length for V coordinates.
  const vAt: number[] = [0];
  for (let k = 1; k < pts.length; k++) {
    vAt.push(vAt[k - 1] + Math.hypot(pts[k].l - pts[k - 1].l, pts[k].y - pts[k - 1].y));
  }

  const vertsPerRing = edges * 2;
  const positions = new Float32Array(samples * vertsPerRing * 3);
  const uvs = new Float32Array(samples * vertsPerRing * 2);
  const indices: number[] = [];
  const c = { x: 0, z: 0 };
  const t = { x: 0, z: 0 };

  for (let i = 0; i < samples; i++) {
    const d = d0 + ((d1 - d0) * i) / (samples - 1);
    alignment.point(d, c);
    alignment.tangent(d, t);
    const rx = -t.z;
    const rz = t.x;
    const y0 = heightAt ? heightAt(d) : baseY;
    const local = profileAt ? (closed ? [...profileAt(d), profileAt(d)[0]] : profileAt(d)) : pts;
    for (let e = 0; e < edges; e++) {
      for (let k = 0; k < 2; k++) {
        const p = local[e + k];
        const l = p.l + lateral;
        const vi = (i * vertsPerRing + e * 2 + k) * 3;
        positions[vi] = c.x + rx * l;
        positions[vi + 1] = y0 + p.y;
        positions[vi + 2] = c.z + rz * l;
        const ui = (i * vertsPerRing + e * 2 + k) * 2;
        // U from absolute distance so textures run on seamlessly across chunks.
        uvs[ui] = d * uPerMetre;
        uvs[ui + 1] = vAt[e + k] * vPerMetre;
      }
    }
  }
  for (let i = 0; i < samples - 1; i++) {
    for (let e = 0; e < edges; e++) {
      const a = i * vertsPerRing + e * 2;
      const b = (i + 1) * vertsPerRing + e * 2;
      const cc = b + 1;
      const dd = a + 1;
      indices.push(a, b, cc, a, cc, dd);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("uv", new BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Rectangle profile (CCW) for boxes swept along a path. */
export function rectProfile(l0: number, l1: number, y0: number, y1: number): ProfilePoint[] {
  return [
    { l: l0, y: y0 },
    { l: l1, y: y0 },
    { l: l1, y: y1 },
    { l: l0, y: y1 },
  ];
}

/** Split [d0, d1] into chunks so each mesh can be frustum-culled on its own. */
export function chunkRanges(d0: number, d1: number, size: number): [number, number][] {
  const out: [number, number][] = [];
  for (let a = d0; a < d1; a += size) out.push([a, Math.min(d1, a + size)]);
  return out;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);

/** Compose a matrix for an object at (x, y, z) facing heading `yaw` (radians, forward = +x). */
export function composeMatrix(
  out: Matrix4,
  x: number,
  y: number,
  z: number,
  yaw: number,
  sx = 1,
  sy = 1,
  sz = 1,
): Matrix4 {
  _p.set(x, y, z);
  _q.setFromAxisAngle(_up, yaw);
  _s.set(sx, sy, sz);
  return out.compose(_p, _q, _s);
}

export { _m as scratchMatrix };
