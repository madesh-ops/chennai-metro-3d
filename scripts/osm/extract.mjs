#!/usr/bin/env node
/**
 * Cut the world tiles out of a Geofabrik .osm.pbf extract, writing the same
 * per-tile cache files the Overpass fetch writes (data-cache/osm/tile-*.json),
 * so the bake does not care where the data came from.
 *
 *   node scripts/osm/extract.mjs data-cache/pbf/southern-zone.osm.pbf
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR } from "./overpass.mjs";
import { readPbf } from "./pbf.mjs";
import { TILE_M, tileList, toLocal } from "./tiles.mjs";

const file = process.argv[2] ?? "data-cache/pbf/southern-zone.osm.pbf";
// Chennai metro area, generous.
const BOX = { south: 12.78, north: 13.27, west: 80.03, east: 80.34 };

const HIGHWAYS = new Set([
  "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "service", "living_street",
  "pedestrian", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link", "road",
]);
const LANDUSE = new Set(["grass", "recreation_ground", "cemetery", "reservoir", "basin", "forest", "meadow", "village_green"]);
const LEISURE = new Set(["park", "garden", "pitch", "playground", "stadium", "nature_reserve"]);

function wanted(tags) {
  if (tags.building && tags.building !== "no") return true;
  if (tags["building:part"]) return true;
  if (tags.highway && HIGHWAYS.has(tags.highway)) return true;
  if (tags.natural === "water" || tags.water || tags.waterway === "riverbank") return true;
  if (tags.landuse && LANDUSE.has(tags.landuse)) return true;
  if (tags.leisure && LEISURE.has(tags.leisure)) return true;
  return false;
}

/** Keep only the tags the bake reads (smaller cache files). */
const KEEP = /^(building|building:levels|building:part|height|min_height|roof:shape|roof:levels|name|name:en|name:ta|amenity|shop|religion|highway|lanes|width|oneway|bridge|tunnel|layer|ref|natural|water|waterway|landuse|leisure|surface|junction|service)$/;
const slim = (tags) => Object.fromEntries(Object.entries(tags).filter(([k]) => KEEP.test(k)));

async function main() {
  const tiles = await tileList();
  const tileSet = new Map(tiles.map((t) => [t.key, { meta: t, elements: [] }]));
  const tileOf = (x, z) => `${Math.floor(x / TILE_M)}_${Math.floor(z / TILE_M)}`;

  // Nodes inside the box: ids ascend in PBF, so sorted typed arrays + binary search.
  let cap = 1 << 22;
  let ids = new Float64Array(cap);
  let lats = new Float64Array(cap);
  let lons = new Float64Array(cap);
  let n = 0;
  const trees = [];
  const findNode = (id) => {
    let lo = 0;
    let hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = ids[mid];
      if (v === id) return mid;
      if (v < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  };
  const geometry = (refs) => {
    const g = [];
    for (const r of refs) {
      const i = findNode(r);
      if (i < 0) return null; // partly outside the box
      g.push({ lat: Number(lats[i].toFixed(7)), lon: Number(lons[i].toFixed(7)) });
    }
    return g;
  };

  const ways = new Map(); // id -> { tags, geometry } for wanted ways
  const spare = new Map(); // id -> geometry for untagged ways (multipolygon members)
  const relations = [];
  let phase = "nodes";
  const t0 = Date.now();

  readPbf(file, {
    onProgress: (p) => process.stdout.write(`\r${(p * 100).toFixed(0)}% ${phase} (${n} nodes, ${ways.size} ways, ${relations.length} relations) ${((Date.now() - t0) / 1000).toFixed(0)}s   `),
    node: ({ id, lat, lon, tags }) => {
      if (lat < BOX.south || lat > BOX.north || lon < BOX.west || lon > BOX.east) return;
      if (n === cap) {
        cap *= 2;
        const grow = (a) => {
          const b = new Float64Array(cap);
          b.set(a);
          return b;
        };
        ids = grow(ids);
        lats = grow(lats);
        lons = grow(lons);
      }
      ids[n] = id;
      lats[n] = lat;
      lons[n] = lon;
      n++;
      if (tags.natural === "tree") trees.push({ type: "node", id, lat: Number(lat.toFixed(7)), lon: Number(lon.toFixed(7)), tags: { natural: "tree" } });
    },
    way: ({ id, tags, refs }) => {
      phase = "ways";
      if (!refs.length || findNode(refs[0]) < 0) return;
      const isWanted = wanted(tags);
      const g = geometry(refs);
      if (!g) return;
      if (isWanted) ways.set(id, { tags: slim(tags), geometry: g });
      else if (!Object.keys(tags).length || tags.type === "multipolygon") spare.set(id, g);
    },
    relation: ({ id, tags, members }) => {
      phase = "relations";
      if (tags.type !== "multipolygon" || !wanted(tags)) return;
      const out = [];
      for (const m of members) {
        if (m.type !== "way") continue;
        const g = ways.get(m.ref)?.geometry ?? spare.get(m.ref);
        if (!g) return; // incomplete in the box
        out.push({ type: "way", ref: m.ref, role: m.role || "outer", geometry: g });
      }
      if (out.length) relations.push({ type: "relation", id, tags: slim(tags), members: out });
    },
  });
  console.log(`\nread ${n} nodes, ${ways.size} ways, ${relations.length} relations, ${trees.length} trees in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // Assign to tiles: areas by their first vertex's centroid tile; lines to every tile they touch.
  const put = (key, el) => tileSet.get(key)?.elements.push(el);
  for (const [id, w] of ways) {
    const el = { type: "way", id, tags: w.tags, geometry: w.geometry };
    if (w.tags.highway) {
      const keys = new Set(w.geometry.map((p) => tileOf(...toLocal(p.lat, p.lon))));
      for (const k of keys) put(k, el);
    } else {
      let x = 0;
      let z = 0;
      for (const p of w.geometry) {
        const [px, pz] = toLocal(p.lat, p.lon);
        x += px;
        z += pz;
      }
      put(tileOf(x / w.geometry.length, z / w.geometry.length), el);
    }
  }
  for (const r of relations) {
    const g = r.members.find((m) => m.role === "outer")?.geometry ?? r.members[0].geometry;
    let x = 0;
    let z = 0;
    for (const p of g) {
      const [px, pz] = toLocal(p.lat, p.lon);
      x += px;
      z += pz;
    }
    put(tileOf(x / g.length, z / g.length), r);
  }
  for (const t of trees) put(tileOf(...toLocal(t.lat, t.lon)), t);

  await mkdir(CACHE_DIR, { recursive: true });
  let bytes = 0;
  for (const [key, t] of tileSet) {
    const text = JSON.stringify({ source: "geofabrik-extract", elements: t.elements });
    bytes += text.length;
    await writeFile(path.join(CACHE_DIR, `tile-${key}.json`), text);
  }
  console.log(`wrote ${tileSet.size} tiles (${(bytes / 1e6).toFixed(0)} MB) to ${CACHE_DIR}`);
}

await main();
