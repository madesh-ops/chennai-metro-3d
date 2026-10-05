#!/usr/bin/env node
/**
 * Fetch the OpenStreetMap data the bake needs into data-cache/osm/.
 *
 *   node scripts/osm/fetch.mjs network     route relations, stops and track ways
 *   node scripts/osm/fetch.mjs tiles       buildings, roads, water, parks per 1 km tile
 *   node scripts/osm/fetch.mjs all
 *
 * Add --refresh to ignore the cache. Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { CACHE_DIR, overpass } from "./overpass.mjs";
import { LINES } from "./lines.mjs";
import { TILE_M, tileList, toLocal } from "./tiles.mjs";

const args = new Set(process.argv.slice(2));
const refresh = args.has("--refresh");
const what = [...args].find((a) => !a.startsWith("--")) ?? "network";

async function fetchNetwork() {
  for (const line of LINES) {
    console.log(`${line.id}: route relations`);
    // Relations with member geometry, then their stop / platform nodes with tags.
    await overpass(
      `rel-${line.id}`,
      `[out:json][timeout:180];relation(id:${line.relations.join(",")});out geom;node(r);out body;`,
      { refresh },
    );
  }
  // All metro track in the metro area: relations are often incomplete (Line 4 lists 2 ways).
  console.log("track ways (metro area)");
  await overpass(
    "track-ways",
    `[out:json][timeout:240];way["railway"~"^(subway|construction|light_rail)$"](12.80,80.05,13.25,80.32);out tags geom;`,
    { refresh },
  );
  console.log("stations and entrances (metro area)");
  await overpass(
    "stations",
    `[out:json][timeout:180];(node["railway"~"^(station|subway_entrance|stop)$"](12.80,80.05,13.25,80.32);node["public_transport"~"^(station|stop_position)$"]["subway"="yes"](12.80,80.05,13.25,80.32);way["railway"="platform"](12.80,80.05,13.25,80.32););out tags center;`,
    { refresh },
  );
}

async function fetchTiles() {
  const all = await tileList();
  // Line 4 (the line people ride today) first, nearest Porur Junction outward; then the rest.
  const [px, pz] = toLocal(13.0355, 80.1563);
  const centre = (t) => [(t.tx + 0.5) * TILE_M, (t.tz + 0.5) * TILE_M];
  const tiles = [...all].sort((a, b) => Math.hypot(...centre(a).map((v, i) => v - [px, pz][i])) - Math.hypot(...centre(b).map((v, i) => v - [px, pz][i])));
  console.log(`${tiles.length} tiles`);
  const query = (t) => {
    const bbox = `${t.south},${t.west},${t.north},${t.east}`;
    return `[out:json][timeout:180];(way["building"](${bbox});relation["building"](${bbox});way["highway"](${bbox});way["natural"="water"](${bbox});relation["natural"="water"](${bbox});way["landuse"~"^(grass|recreation_ground|cemetery|reservoir|basin)$"](${bbox});way["leisure"~"^(park|garden|pitch|playground)$"](${bbox});node["natural"="tree"](${bbox}););out tags geom;`;
  };
  // Several passes: a busy server fails some tiles; they are retried after the rest (cached ones are skipped).
  let pending = tiles;
  for (let pass = 1; pass <= 8 && pending.length; pass++) {
    const failed = [];
    let i = 0;
    for (const t of pending) {
      i++;
      try {
        const cached = existsSync(path.join(CACHE_DIR, `tile-${t.key}.json`));
        await overpass(`tile-${t.key}`, query(t), { refresh, attempts: 3 });
        console.log(`pass ${pass} tile ${i}/${pending.length} ${t.key}${cached ? " (cached)" : ""}`);
        if (!cached) await new Promise((r) => setTimeout(r, 1500)); // be polite between downloads
      } catch (e) {
        console.warn(`pass ${pass} tile ${t.key} failed: ${e.message}`);
        failed.push(t);
      }
    }
    pending = failed;
    if (pending.length) {
      console.log(`${pending.length} tiles left after pass ${pass}; pausing before the next pass`);
      await new Promise((r) => setTimeout(r, 120_000));
    }
  }
  if (pending.length) throw new Error(`${pending.length} tiles could not be fetched; run again later`);
}

if (what === "network" || what === "all") await fetchNetwork();
if (what === "tiles" || what === "all") await fetchTiles();
console.log("done");
