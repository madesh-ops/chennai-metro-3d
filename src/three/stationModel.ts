import {
  BufferAttribute, BoxGeometry, BufferGeometry, CylinderGeometry, ExtrudeGeometry, PlaneGeometry, Shape } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ROAD, STATION, VIADUCT } from "./layout.ts";

/**
 * Elevated side-platform station in station-local space: origin on the
 * centreline at ground level, +x along the line, +z to the right.
 * Generic design — individual Line 4 station architecture is not modelled.
 */

export interface StationGeometry {
  concrete: BufferGeometry;
  platformTop: BufferGeometry;
  tactile: BufferGeometry;
  roof: BufferGeometry;
  steel: BufferGeometry;
  glass: BufferGeometry;
  facade: BufferGeometry;
  lights: BufferGeometry;
}

export interface StationDims {
  rail: number;
  platformLength: number;
  platformHeight: number;
  trackCentres: number;
  upperDeck: number;
}

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const g = new BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g.toNonIndexed();
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  for (const p of parts) for (const k of Object.keys(p.attributes)) if (!["position", "normal", "uv"].includes(k)) p.deleteAttribute(k);
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  g.computeBoundingSphere();
  return g;
}

function canopy(length: number, base: number, halfWidth: number): BufferGeometry {
  const shape = new Shape();
  const n = 14;
  const rise = 2.4;
  for (let i = 0; i <= n; i++) {
    const z = -halfWidth + (2 * halfWidth * i) / n;
    const y = base + rise * (1 - (z / halfWidth) ** 2);
    if (i === 0) shape.moveTo(z, y);
    else shape.lineTo(z, y);
  }
  for (let i = n; i >= 0; i--) {
    const z = -halfWidth + (2 * halfWidth * i) / n;
    const y = base - 0.28 + (rise - 0.3) * (1 - (z / halfWidth) ** 2);
    shape.lineTo(z, y);
  }
  shape.closePath();
  const g = new ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  g.translate(-length / 2, 0, 0);
  return g;
}

function platformLevel(
  d: StationDims,
  rail: number,
  out: Record<keyof StationGeometry, BufferGeometry[]>,
  withCanopy: boolean,
) {
  const L = d.platformLength;
  const edge = d.trackCentres / 2 + 1.52;
  const outer = edge + 4.3;
  const top = rail + d.platformHeight;
  out.concrete.push(box(-L / 2 - 4, L / 2 + 4, rail + VIADUCT.girderBottom - 0.2, rail + VIADUCT.deckTop, -STATION.halfWidth, STATION.halfWidth));
  for (const s of [-1, 1]) {
    const [z0, z1] = s < 0 ? [-outer, -edge] : [edge, outer];
    out.concrete.push(box(-L / 2, L / 2, rail + VIADUCT.deckTop, top - 0.01, z0, z1));
    const [t0, t1] = s < 0 ? [-outer, -(edge + 0.55)] : [edge + 0.55, outer];
    out.platformTop.push(box(-L / 2, L / 2, top - 0.01, top + 0.005, t0, t1));
    const [y0, y1] = s < 0 ? [-(edge + 0.55), -edge] : [edge, edge + 0.55];
    out.tactile.push(box(-L / 2, L / 2, top - 0.01, top + 0.012, y0, y1));
    // Outer screen wall.
    const [g0, g1] = s < 0 ? [-(outer + 0.06), -outer] : [outer, outer + 0.06];
    out.glass.push(box(-L / 2, L / 2, top, top + 1.4, g0, g1));
    out.steel.push(box(-L / 2, L / 2, top + 1.38, top + 1.46, g0 - 0.02, g1 + 0.02));
    if (withCanopy) {
      for (let x = -L / 2 + 4; x <= L / 2 - 4 + 0.01; x += 11.5) {
        const c = new CylinderGeometry(0.2, 0.2, STATION.canopyHeight - d.platformHeight, 10);
        c.translate(x, top + (STATION.canopyHeight - d.platformHeight) / 2, s * (outer - 0.6));
        out.steel.push(c.toNonIndexed());
      }
      for (const lz of [2.0, 5.6]) {
        out.lights.push(box(-L / 2 + 5, L / 2 - 5, rail + STATION.canopyHeight - 0.06, rail + STATION.canopyHeight, s * lz - 0.12, s * lz + 0.12));
      }
    } else {
      for (const lz of [2.0, 5.6]) {
        out.lights.push(box(-L / 2 + 5, L / 2 - 5, rail + d.upperDeck + VIADUCT.girderBottom - 0.25, rail + d.upperDeck + VIADUCT.girderBottom - 0.2, s * lz - 0.12, s * lz + 0.12));
      }
    }
  }
  if (withCanopy) out.roof.push(canopy(L + 8, rail + STATION.canopyHeight, STATION.halfWidth + 0.8));
}

/** Side concourses start this far out when a flyover runs down the middle of the road. */
export const FLYOVER_CONCOURSE_INNER = 9.2;

/**
 * @param overFlyover The road beneath has a flyover in the middle (Porur
 * Junction): the concourse splits into two side halls over the outer lanes
 * and footpaths, with no supports in the median. The metro rests on steel
 * portal frames there instead (Track.tsx).
 */
export function buildStation(
  d: StationDims,
  doubleDecker: boolean,
  overFlyover = false,
  /** Station-local (x along, z lateral, radius) spots taken by something else (a flyover deck): no supports or stairs there. */
  blocked: (x: number, z: number, r: number) => boolean = () => false,
): StationGeometry {
  const out: Record<keyof StationGeometry, BufferGeometry[]> = {
    concrete: [],
    platformTop: [],
    tactile: [],
    roof: [],
    steel: [],
    glass: [],
    facade: [],
    lights: [],
  };
  const R = d.rail;
  platformLevel(d, R, out, !doubleDecker);
  if (doubleDecker) {
    platformLevel(d, R + d.upperDeck, out, true);
    // Columns tying the two levels together at the platform backs.
    for (const s of [-1, 1]) {
      for (let x = -d.platformLength / 2 + 4; x <= d.platformLength / 2 - 4 + 0.01; x += 11.5) {
        out.concrete.push(box(x - 0.45, x + 0.45, R + d.platformHeight, R + d.upperDeck + VIADUCT.girderBottom, s * 9.0 - 0.45, s * 9.0 + 0.45));
      }
    }
  }

  // Concourse spanning the road beneath the platforms (or two side halls over a flyover),
  // hung a fixed distance below rail level.
  const cb = R - STATION.concourseBelowRail;
  const ct = cb + STATION.concourseHeight;
  const cl = STATION.concourseLength / 2;
  const cw = STATION.concourseHalfWidth;
  const halls: [number, number][] = overFlyover
    ? [
        [-cw, -FLYOVER_CONCOURSE_INNER],
        [FLYOVER_CONCOURSE_INNER, cw],
      ]
    : [[-cw, cw]];
  for (const [z0, z1] of halls) {
    out.concrete.push(box(-cl, cl, cb, cb + 0.6, z0, z1));
    out.concrete.push(box(-cl, cl, ct - 0.5, ct, z0, z1));
    out.facade.push(box(-cl + 0.3, cl - 0.3, cb + 0.6, ct - 0.5, z0 + 0.3, z1 - 0.3));
    for (const x of [-cl, cl]) out.concrete.push(box(x - 0.4, x + 0.4, cb, ct, z0, z1));
  }
  // Supports: median and footpaths only, never in a traffic lane (footpaths only over a flyover).
  for (const x of [-cl + 6, -8, 8, cl - 6]) {
    if (!overFlyover) out.concrete.push(box(x - 0.7, x + 0.7, 0, cb, -0.7, 0.7));
    for (const s of [-1, 1]) {
      const z = s * (ROAD.halfWidth + 1.4);
      if (blocked(x, z, 0.6)) continue;
      out.concrete.push(box(x - 0.6, x + 0.6, 0, cb, z - 0.6, z + 0.6));
    }
  }
  // Stairs down to each footpath.
  // Street stairs at about 32 degrees, whatever the concourse height.
  const run = cb * 1.6;
  const slope = Math.atan2(cb, run);
  for (const s of [-1, 1]) {
    for (const xs of [-1, 1]) {
      const sz = s * (ROAD.halfWidth + 2.0);
      let clear = true;
      for (let k = 0; k <= 4; k++) if (blocked(xs * (cl + (run * k) / 4), sz, 1.2)) clear = false;
      if (!clear) continue;
      const g = new BoxGeometry(Math.hypot(run, cb), 0.45, 2.4);
      g.rotateZ(-xs * slope);
      g.translate(xs * (cl + run / 2), cb / 2, s * (ROAD.halfWidth + 2.0));
      out.concrete.push(g.toNonIndexed());
      const rail = new BoxGeometry(Math.hypot(run, cb), 0.06, 0.06);
      rail.rotateZ(-xs * slope);
      rail.translate(xs * (cl + run / 2), cb / 2 + 1.0, s * (ROAD.halfWidth + 3.2));
      out.steel.push(rail.toNonIndexed());
    }
  }

  return {
    concrete: merge(out.concrete),
    platformTop: merge(out.platformTop),
    tactile: merge(out.tactile),
    roof: merge(out.roof.length ? out.roof : [box(0, 0.01, 0, 0.01, 0, 0.01)]),
    steel: merge(out.steel),
    glass: merge(out.glass),
    facade: merge(out.facade),
    lights: merge(out.lights),
  };
}

/** Name boards facing the tracks, plus one on each concourse facade. */
export function buildSignBoards(d: StationDims, level: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const top = level + d.platformHeight;
  const cb = d.rail - STATION.concourseBelowRail;
  const ct = cb + STATION.concourseHeight;
  for (const s of [-1, 1]) {
    for (const x of [-34, -11.5, 11.5, 34]) {
      const g = new PlaneGeometry(3.4, 0.85);
      if (s > 0) g.rotateY(Math.PI);
      g.translate(x, top + 2.75, s * (d.trackCentres / 2 + 3.7));
      parts.push(g.toNonIndexed());
    }
    const f = new PlaneGeometry(11, 2.75);
    if (s < 0) f.rotateY(Math.PI);
    f.translate(0, (cb + ct) / 2 + 0.2, s * (STATION.concourseHalfWidth + 0.05));
    parts.push(f.toNonIndexed());
  }
  return mergeGeometries(parts)!;
}


/* ------------------------------------------------------------------ */
/* Underground stations                                                 */
/* ------------------------------------------------------------------ */

/** Underground box station: hall half-width and clear height above the rail. */
const UG_HALF = 13;
/**
 * Tunnel mouth in the hall's end walls: the tunnel box's clear inside (TUNNEL_HALF, TUNNEL_ROOF
 * in Track.tsx), so the end wall also covers the cut ends of the tunnel's walls and roof slab
 * (swept without end caps, they would otherwise show straight through to the surface).
 */
const UG_OPENING = 5.4;
const UG_OPENING_TOP = 6.0;
const UG_CEILING = 8;

/**
 * Underground side-platform station (CMRL-style): a concrete box around the
 * tracks with wide platforms, full-height platform screen doors, a row of
 * columns, ceiling light strips and escalator banks at each end. Same
 * station-local frame as the elevated station; `d.rail` is below ground.
 */
export function buildUndergroundStation(d: StationDims): StationGeometry {
  const out: Record<keyof StationGeometry, BufferGeometry[]> = { concrete: [], platformTop: [], tactile: [], roof: [], steel: [], glass: [], facade: [], lights: [] };
  const R = d.rail;
  const L = d.platformLength;
  // Keep in step with UG_HALL_END in Track.tsx (the tunnel box stops at these end walls).
  const X = L / 2 + 12;
  const edge = d.trackCentres / 2 + 1.52;
  const outer = UG_HALF - 0.6;
  const top = R + d.platformHeight;
  // Floor slab, side walls, roof slab, end walls above the tunnel mouths.
  out.concrete.push(box(-X, X, R - 1.4, R + VIADUCT.deckTop, -UG_HALF, UG_HALF));
  for (const s of [-1, 1]) {
    out.concrete.push(box(-X, X, R - 1.4, R + UG_CEILING, s < 0 ? -UG_HALF : UG_HALF - 0.6, s < 0 ? -UG_HALF + 0.6 : UG_HALF));
    out.concrete.push(box(s < 0 ? -X : X - 0.6, s < 0 ? -X + 0.6 : X, R + UG_OPENING_TOP, R + UG_CEILING, -UG_HALF, UG_HALF));
    // Openings exactly the tunnel box's width (TUNNEL_HALF + WALL in Track.tsx), so it butts on with no slit.
    for (const z of [-1, 1]) out.concrete.push(box(s < 0 ? -X : X - 0.6, s < 0 ? -X + 0.6 : X, R - 1.4, R + UG_CEILING, z < 0 ? -UG_HALF : UG_OPENING, z < 0 ? -UG_OPENING : UG_HALF));
  }
  out.roof.push(box(-X, X, R + UG_CEILING, R + UG_CEILING + 0.6, -UG_HALF, UG_HALF));
  for (const s of [-1, 1]) {
    const [z0, z1] = s < 0 ? [-outer, -edge] : [edge, outer];
    out.concrete.push(box(-L / 2 - 6, L / 2 + 6, R + VIADUCT.deckTop, top - 0.01, z0, z1));
    const [t0, t1] = s < 0 ? [-outer, -(edge + 0.55)] : [edge + 0.55, outer];
    out.platformTop.push(box(-L / 2 - 6, L / 2 + 6, top - 0.01, top + 0.005, t0, t1));
    const [y0, y1] = s < 0 ? [-(edge + 0.55), -edge] : [edge, edge + 0.55];
    out.tactile.push(box(-L / 2, L / 2, top - 0.01, top + 0.012, y0, y1));
    // Full-height platform screen doors: glass panels on steel posts, a header with the door lights.
    const zp = s * (edge - 0.05);
    out.glass.push(box(-L / 2, L / 2, top, top + 2.3, zp - 0.02, zp + 0.02));
    for (let x = -L / 2; x <= L / 2 + 0.01; x += 2.0) out.steel.push(box(x - 0.05, x + 0.05, top, top + 2.3, zp - 0.05, zp + 0.05));
    out.facade.push(box(-L / 2, L / 2, top + 2.3, top + 2.75, zp - 0.12, zp + 0.12));
    // Columns down the middle of each platform.
    for (let x = -L / 2 + 4; x <= L / 2 - 4 + 0.01; x += 9) {
      const c = new CylinderGeometry(0.42, 0.42, UG_CEILING - d.platformHeight, 14);
      c.translate(x, top + (UG_CEILING - d.platformHeight) / 2, s * 10);
      out.facade.push(c.toNonIndexed());
    }
    // Ceiling light strips.
    for (const lz of [5.2, 8.6, 11.4]) out.lights.push(box(-L / 2, L / 2, R + UG_CEILING - 0.08, R + UG_CEILING - 0.02, s * lz - 0.15, s * lz + 0.15));
    // Escalator banks rising towards the concourse at each end.
    for (const xs of [-1, 1]) {
      const g = new BoxGeometry(14, 0.6, 2.4);
      g.rotateZ(xs * 0.52);
      g.translate(xs * (L / 2 - 4), top + 3.4, s * 10.6);
      out.steel.push(g.toNonIndexed());
    }
  }
  return {
    concrete: merge(out.concrete),
    platformTop: merge(out.platformTop),
    tactile: merge(out.tactile),
    roof: merge(out.roof),
    steel: merge(out.steel),
    glass: merge(out.glass),
    facade: merge(out.facade),
    lights: merge(out.lights),
  };
}

/** Street entrances of an underground station: glass-fronted kiosks on both footpaths, one at each end. */
export function buildStationEntrances(d: StationDims): StationGeometry {
  const out: Record<keyof StationGeometry, BufferGeometry[]> = { concrete: [], platformTop: [], tactile: [], roof: [], steel: [], glass: [], facade: [], lights: [] };
  const L = d.platformLength;
  for (const s of [-1, 1]) {
    for (const xs of [-1, 1]) {
      const x = xs * (L / 2 - 8);
      const z = s * (ROAD.halfWidth + ROAD.sidewalk + 3.2);
      out.concrete.push(box(x - 4, x + 4, 0, 0.3, z - 2.4, z + 2.4));
      out.facade.push(box(x - 4, x + 4, 0.3, 3.6, z - 2.2, z + 2.2));
      out.roof.push(box(x - 4.6, x + 4.6, 3.6, 4.0, z - 2.8, z + 2.8));
      // Glass front towards the road, with a light band over it.
      const zf = z - s * 2.25;
      out.glass.push(box(x - 3.4, x + 3.4, 0.3, 3.2, zf - 0.03, zf + 0.03));
      out.lights.push(box(x - 3.4, x + 3.4, 3.3, 3.5, zf - 0.05, zf + 0.05));
    }
  }
  return {
    concrete: merge(out.concrete),
    platformTop: merge(out.platformTop.length ? out.platformTop : [box(0, 0.01, 0, 0.01, 0, 0.01)]),
    tactile: merge(out.tactile.length ? out.tactile : [box(0, 0.01, 0, 0.01, 0, 0.01)]),
    roof: merge(out.roof),
    steel: merge(out.steel.length ? out.steel : [box(0, 0.01, 0, 0.01, 0, 0.01)]),
    glass: merge(out.glass),
    facade: merge(out.facade),
    lights: merge(out.lights),
  };
}

/** Name boards on the platform walls of an underground station. */
export function buildUndergroundSignBoards(d: StationDims): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const top = d.rail + d.platformHeight;
  for (const s of [-1, 1]) {
    for (const x of [-34, -11.5, 11.5, 34]) {
      const g = new PlaneGeometry(3.4, 0.85);
      if (s > 0) g.rotateY(Math.PI);
      g.translate(x, top + 3.4, s * (UG_HALF - 0.62));
      parts.push(g.toNonIndexed());
    }
  }
  return mergeGeometries(parts)!;
}

/* ------------------------------------------------------------------ */
/* Following a curved track                                             */
/* ------------------------------------------------------------------ */

/**
 * Split triangles (non-indexed) until none spans more than `maxDx` metres
 * along x, so a station built straight can be bent to a curved track.
 * Every float attribute is interpolated.
 */
export function subdivideAlongX(geo: BufferGeometry, maxDx: number): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const names = Object.keys(g.attributes);
  const sizes = names.map((n) => g.getAttribute(n).itemSize);
  const src = names.map((n) => g.getAttribute(n).array as ArrayLike<number>);
  const pos = g.getAttribute("position");
  const out: number[][] = names.map(() => []);
  type V = number[][]; // per attribute: values
  const vertex = (i: number): V => names.map((_, a) => Array.from({ length: sizes[a] }, (_, k) => src[a][i * sizes[a] + k]));
  const mid = (p: V, q: V): V => p.map((vals, a) => vals.map((v, k) => (v + q[a][k]) / 2));
  const xOf = (v: V) => v[names.indexOf("position")][0];
  const emit = (v: V) => v.forEach((vals, a) => out[a].push(...vals));
  const split = (a: V, b: V, c: V, depth: number) => {
    const xs = [xOf(a), xOf(b), xOf(c)];
    if (depth > 12 || Math.max(...xs) - Math.min(...xs) <= maxDx) {
      emit(a);
      emit(b);
      emit(c);
      return;
    }
    // Split the edge with the longest run in x (keeps the winding).
    const dab = Math.abs(xs[0] - xs[1]);
    const dbc = Math.abs(xs[1] - xs[2]);
    const dca = Math.abs(xs[2] - xs[0]);
    if (dab >= dbc && dab >= dca) {
      const m = mid(a, b);
      split(a, m, c, depth + 1);
      split(m, b, c, depth + 1);
    } else if (dbc >= dca) {
      const m = mid(b, c);
      split(a, b, m, depth + 1);
      split(a, m, c, depth + 1);
    } else {
      const m = mid(c, a);
      split(a, b, m, depth + 1);
      split(m, b, c, depth + 1);
    }
  };
  for (let i = 0; i < pos.count; i += 3) split(vertex(i), vertex(i + 1), vertex(i + 2), 0);
  const res = new BufferGeometry();
  names.forEach((n, a) => res.setAttribute(n, new BufferAttribute(new Float32Array(out[a]), sizes[a])));
  return res;
}

/** The track frame x metres along from the station centre: point, unit tangent and unit right. */
export type TrackFrame = (x: number) => { px: number; pz: number; tx: number; tz: number };

/**
 * Bend station-local geometry (x along the track, z to its right, y up) onto
 * the real, possibly curved track: each vertex goes to the track point x
 * metres along, offset z to the right there. Normals turn with the track.
 * Returns world-space geometry (subdivided first so walls curve smoothly).
 */
export function bendToTrack(geo: BufferGeometry, frame: TrackFrame, maxDx = 3): BufferGeometry {
  const g = subdivideAlongX(geo, maxDx);
  const pos = g.getAttribute("position") as BufferAttribute;
  const nor = g.getAttribute("normal") as BufferAttribute | undefined;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const f = frame(x);
    // Right of the tangent (tx, tz) is (-tz, tx).
    pos.setXYZ(i, f.px - f.tz * z, pos.getY(i), f.pz + f.tx * z);
    if (nor) {
      const nx = nor.getX(i);
      const nz = nor.getZ(i);
      nor.setXYZ(i, f.tx * nx - f.tz * nz, nor.getY(i), f.tz * nx + f.tx * nz);
    }
  }
  g.computeBoundingSphere();
  return g;
}
