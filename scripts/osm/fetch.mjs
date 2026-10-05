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
import { overpass } from "./overpass.mjs";
import { LINES } from "./lines.mjs";
import { tileList } from "./tiles.mjs";

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
  const tiles = await tileList();
  console.log(`${tiles.length} tiles`);
  let i = 0;
  for (const t of tiles) {
    i++;
    const bbox = `${t.south},${t.west},${t.north},${t.east}`;
    process.stdout.write(`tile ${i}/${tiles.length} ${t.key}\n`);
    await overpass(
      `tile-${t.key}`,
      `[out:json][timeout:180];(way["building"](${bbox});relation["building"](${bbox});way["highway"](${bbox});way["natural"="water"](${bbox});relation["natural"="water"](${bbox});way["landuse"~"^(grass|recreation_ground|cemetery|reservoir|basin)$"](${bbox});way["leisure"~"^(park|garden|pitch|playground)$"](${bbox});node["natural"="tree"](${bbox}););out tags geom;`,
      { refresh },
    );
  }
}

if (what === "network" || what === "all") await fetchNetwork();
if (what === "tiles" || what === "all") await fetchTiles();
console.log("done");
