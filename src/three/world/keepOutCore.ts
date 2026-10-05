import type { KeepOut } from "./worldGeometry.ts";

/**
 * Keep-out zones as plain numbers (so they can be posted to the tile worker):
 * circles (x, z, r) and oriented rectangles (cx, cz, ux, uz, halfAlong, halfDepth).
 */
export interface KeepOutData {
  circles: number[];
  rects: number[];
  /** Circles (x, z, r) along flyovers the scene models itself: OSM's copy is not built there. */
  flyovers?: number[];
}

/** Is (x, z) on a flyover the scene models itself? */
export function makeOwnFlyover(data: KeepOutData): (x: number, z: number) => boolean {
  const f = data.flyovers ?? [];
  return (x, z) => {
    for (let k = 0; k < f.length; k += 3) {
      const dx = x - f[k];
      const dz = z - f[k + 1];
      if (dx * dx + dz * dz < f[k + 2] * f[k + 2]) return true;
    }
    return false;
  };
}

const CELL = 50;

/** The lookup over keep-out data: is a circle (x, z, r) blocked? */
export function makeKeepOut(data: KeepOutData): KeepOut {
  const grid = new Map<number, number[]>();
  const key = (i: number, j: number) => i * 100003 + j;
  const c = data.circles;
  for (let k = 0; k < c.length; k += 3) {
    const [x, z, r] = [c[k], c[k + 1], c[k + 2]];
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        let l = grid.get(key(i, j));
        if (!l) grid.set(key(i, j), (l = []));
        l.push(k);
      }
    }
  }
  const q = data.rects;
  return (x, z, r) => {
    const l = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (l) {
      for (const k of l) {
        const rr = c[k + 2] + r;
        if ((x - c[k]) * (x - c[k]) + (z - c[k + 1]) * (z - c[k + 1]) < rr * rr) return true;
      }
    }
    for (let k = 0; k < q.length; k += 6) {
      const dx = x - q[k];
      const dz = z - q[k + 1];
      const a = dx * q[k + 2] + dz * q[k + 3];
      const d = -dx * q[k + 3] + dz * q[k + 2];
      if (Math.abs(a) < q[k + 4] + r && Math.abs(d) < q[k + 5] + r) return true;
    }
    return false;
  };
}
