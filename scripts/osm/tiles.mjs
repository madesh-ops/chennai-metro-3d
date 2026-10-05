/**
 * The shared world grid: one fixed projection for the whole city (origin at
 * Chennai Central) and 1 km tiles. A tile is kept when any track of a
 * modelled line passes within BUFFER_M of it.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR } from "./overpass.mjs";
import { LINES } from "./lines.mjs";

/** World origin: Chennai Central (MGR Chennai Central) metro, close to the network's centre of gravity. */
export const ORIGIN = { lat: 13.0827, lon: 80.2753 };
export const TILE_M = 1000;
export const BUFFER_M = 700;

const R = 6371008.8;
const DEG = Math.PI / 180;
const KX = Math.cos(ORIGIN.lat * DEG) * R * DEG;
const KZ = R * DEG;

/** Same equirectangular projection as src/utils/coordinates.ts: +x east, -z north. */
export const toLocal = (lat, lon) => [(lon - ORIGIN.lon) * KX, -(lat - ORIGIN.lat) * KZ];
export const toLatLon = (x, z) => ({ lat: ORIGIN.lat - z / KZ, lon: ORIGIN.lon + x / KX });

export const tileKey = (tx, tz) => `${tx}_${tz}`;

/** Track polylines (local metres) of every modelled line, from the cached relations. */
export async function lineTrackPoints() {
  const pts = [];
  for (const line of LINES) {
    const rel = JSON.parse(await readFile(path.join(CACHE_DIR, `rel-${line.id}.json`), "utf8"));
    for (const r of rel.elements.filter((e) => e.type === "relation")) {
      for (const m of r.members) {
        if (m.type === "way" && m.geometry) for (const g of m.geometry) pts.push(toLocal(g.lat, g.lon));
        if (m.type === "node" && m.lat !== undefined) pts.push(toLocal(m.lat, m.lon));
      }
    }
  }
  return pts;
}

/** Tiles within BUFFER_M of any modelled track or stop, with their lat/lon bounds. */
export async function tileList() {
  const pts = await lineTrackPoints();
  const keys = new Map();
  const reach = BUFFER_M + TILE_M / 2;
  for (const [x, z] of pts) {
    for (let tx = Math.floor((x - reach) / TILE_M); tx <= Math.floor((x + reach) / TILE_M); tx++) {
      for (let tz = Math.floor((z - reach) / TILE_M); tz <= Math.floor((z + reach) / TILE_M); tz++) {
        // Distance from the point to the tile rectangle.
        const dx = Math.max(tx * TILE_M - x, 0, x - (tx + 1) * TILE_M);
        const dz = Math.max(tz * TILE_M - z, 0, z - (tz + 1) * TILE_M);
        if (Math.hypot(dx, dz) <= BUFFER_M) keys.set(tileKey(tx, tz), [tx, tz]);
      }
    }
  }
  return [...keys.values()]
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
    .map(([tx, tz]) => {
      const nw = toLatLon(tx * TILE_M, tz * TILE_M);
      const se = toLatLon((tx + 1) * TILE_M, (tz + 1) * TILE_M);
      return { key: tileKey(tx, tz), tx, tz, north: nw.lat, west: nw.lon, south: se.lat, east: se.lon };
    });
}
