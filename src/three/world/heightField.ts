import { TILE_M, type TileBuilding } from "./tileFormat.ts";

/**
 * Roof heights of the buildings currently streamed in, so cameras can keep
 * clear of them. WorldTiles adds a tile when it is built and removes it when
 * it is unloaded.
 */
const CELL = 25;

interface Entry {
  ring: Float32Array;
  h: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const tiles = new Map<string, Map<number, Entry[]>>();
const cellKey = (i: number, j: number) => i * 100003 + j;

export function addTileHeights(key: string, buildings: TileBuilding[]): void {
  const cells = new Map<number, Entry[]>();
  for (const b of buildings) {
    const r = b.ring;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < r.length; i += 2) {
      x0 = Math.min(x0, r[i]);
      x1 = Math.max(x1, r[i]);
      z0 = Math.min(z0, r[i + 1]);
      z1 = Math.max(z1, r[i + 1]);
    }
    const e = { ring: r, h: b.height, x0, z0, x1, z1 };
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        const k = cellKey(i, j);
        let l = cells.get(k);
        if (!l) cells.set(k, (l = []));
        l.push(e);
      }
    }
  }
  tiles.set(key, cells);
}

export function removeTileHeights(key: string): void {
  tiles.delete(key);
}

function inside(x: number, z: number, ring: Float32Array): boolean {
  let hit = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2];
    const zi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const zj = ring[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/** Highest roof within `radius` metres of (x, z) (0 if open ground or the tile isn't loaded). */
export function roofHeightNear(x: number, z: number, radius: number): number {
  const cells = tiles.get(`${Math.floor(x / TILE_M)}_${Math.floor(z / TILE_M)}`);
  if (!cells) return 0;
  let best = 0;
  const seen = new Set<Entry>();
  for (let i = Math.floor((x - radius) / CELL); i <= Math.floor((x + radius) / CELL); i++) {
    for (let j = Math.floor((z - radius) / CELL); j <= Math.floor((z + radius) / CELL); j++) {
      for (const e of cells.get(cellKey(i, j)) ?? []) {
        if (seen.has(e) || e.h <= best) continue;
        seen.add(e);
        if (x < e.x0 - radius || x > e.x1 + radius || z < e.z0 - radius || z > e.z1 + radius) continue;
        // Inside, or within the radius of the footprint (bbox corners checked as an approximation).
        if (inside(x, z, e.ring) || (radius > 0 && [[x - radius, z], [x + radius, z], [x, z - radius], [x, z + radius]].some(([px, pz]) => inside(px, pz, e.ring)))) best = e.h;
      }
    }
  }
  return best;
}
