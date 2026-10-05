#!/usr/bin/env node
/**
 * Add the stations and routes of every line in network.json to the curated
 * data (src/data/stations.json, routes.json). Existing entries are never
 * changed — only missing stations and routes are added, with their facts
 * marked as coming from OpenStreetMap or as unknown, ready for curation.
 *
 *   node scripts/osm/sync-stations.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const file = (n) => path.resolve(`src/data/${n}.json`);
const read = async (n) => JSON.parse(await readFile(file(n), "utf8"));
const write = (n, v) => writeFile(file(n), JSON.stringify(v, null, 2) + "\n");

const norm = (n) => n.toLowerCase().replace(/\s+metro$/, "").replace(/[^a-z0-9]+/g, " ").trim();
const slug = (n) => norm(n).replace(/ /g, "-");
const clean = (n) => n.replace(/\s+Metro$/i, "").trim();

/** Routes to make, one per line, by terminus names (OSM, first → last as baked). */
const ROUTES = [
  {
    id: "line-1-wimco-nagar-depot-airport",
    line: "line-1",
    name: "Corridor 1",
    title: "Wimco Nagar Depot — Chennai Airport",
    status: "open",
    statusLabel: "Open",
    openingDate: "2015-06-29",
    headwayMinutes: 6,
    operatingHours: "05:00–23:00",
    lengthKm: 32.1,
  },
  {
    id: "line-2-central-st-thomas-mount",
    line: "line-2",
    name: "Corridor 2",
    title: "Chennai Central — St. Thomas Mount",
    status: "open",
    statusLabel: "Open",
    openingDate: "2015-06-29",
    headwayMinutes: 6,
    operatingHours: "05:00–23:00",
    lengthKm: 22.0,
  },
  {
    id: "line-4-vadapalani-lighthouse",
    line: "line-4",
    name: "Corridor 4",
    title: "Vadapalani — Lighthouse",
    status: "under-construction",
    statusLabel: "Under construction · preview ride",
    openingDate: "",
    headwayMinutes: 10,
    operatingHours: "Not yet operating",
    from: "Vadapalani",
    lengthKm: null,
  },
  {
    id: "line-5-madhavaram-sholinganallur",
    line: "line-5",
    name: "Corridor 5",
    title: "Madhavaram Milk Colony — Sholinganallur",
    status: "under-construction",
    statusLabel: "Under construction · preview ride",
    openingDate: "",
    headwayMinutes: 10,
    operatingHours: "Not yet operating",
    lengthKm: null,
  },
];

const LINES = {
  "line-1": { id: "line-1", name: "Line 1", corridor: "Corridor 1", colourName: "Blue Line", termini: ["Wimco Nagar Depot", "Chennai International Airport"], status: "Open.", source: "Wikipedia — Blue Line (Chennai Metro); OpenStreetMap route relation" },
};

async function main() {
  const net = await read("network");
  const stations = await read("stations");
  const routes = await read("routes");
  const byNorm = new Map();
  for (const s of stations.stations) byNorm.set(norm(s.osmName ?? s.name), s);
  let addedStations = 0;
  for (const line of net.lines) {
    for (const n of line.stations) {
      if (byNorm.has(norm(n.name))) continue;
      const kind = line.structure.find((r) => n.d >= r[0] && n.d <= r[1])?.[2] ?? "elevated";
      const name = clean(n.name);
      let id = slug(name);
      if (stations.stations.some((s) => s.id === id)) id = `${id}-${line.id.replace("line-", "l")}`;
      const entry = {
        id,
        name,
        nameTa: n.nameTa ?? null,
        nameTaVerified: false,
        altNames: [],
        type: kind === "underground" ? "underground" : kind === "at-grade" ? "at-grade" : "elevated",
        service: "stop",
        coordinates: null,
        ...(name !== n.name ? { osmName: n.name } : {}),
        notes: `Position and Tamil name from OpenStreetMap (${line.name}).${n.underConstruction ? " Under construction." : ""}`,
      };
      stations.stations.push(entry);
      byNorm.set(norm(n.name), entry);
      addedStations++;
    }
  }

  const template = routes.routes[0];
  let addedRoutes = 0;
  for (const spec of ROUTES) {
    if (routes.routes.some((r) => r.id === spec.id)) continue;
    const line = net.lines.find((l) => l.id === spec.line);
    let ids = line.stations.map((n) => byNorm.get(norm(n.name)).id);
    if (spec.from) ids = ids.slice(ids.indexOf(byNorm.get(norm(spec.from)).id));
    // Line 4 runs west → east as baked; its eastern route starts at Vadapalani.
    const lengthKm = spec.lengthKm ?? Number(((line.stations.at(-1).d - line.stations[ids.length === line.stations.length ? 0 : line.stations.length - ids.length].d) / 1000).toFixed(2));
    routes.routes.push({
      id: spec.id,
      line: spec.line,
      name: spec.name,
      title: spec.title,
      stationIds: ids,
      lengthKm,
      lengthSource: spec.lengthKm ? "Wikipedia (published route length)" : "OpenStreetMap track length (network.json)",
      status: spec.status,
      statusLabel: spec.statusLabel,
      openingDate: spec.openingDate,
      servedStationCount: ids.length,
      passedStationCount: 0,
      headwayMinutes: spec.headwayMinutes,
      trainsInService: 0,
      operatingHours: spec.operatingHours,
      reportedJourneyMinutes: null,
      fares: { ...template.fares, min: 10, max: 50, examples: [], note: "CMRL's city-wide distance-band fares; examples not yet checked for this line." },
    });
    addedRoutes++;
  }
  for (const [id, l] of Object.entries(LINES)) {
    if (routes.lines.some((x) => x.id === id)) continue;
    const osm = net.lines.find((x) => x.id === id);
    routes.lines.push({ ...l, colour: osm?.osmColour?.toUpperCase() ?? "#3281C4", colourNote: "Colour from the OpenStreetMap route relation.", lengthKm: Number((osm.lengthM / 1000).toFixed(1)) });
  }
  await write("stations", stations);
  await write("routes", routes);
  console.log(`added ${addedStations} stations and ${addedRoutes} routes`);
}

await main();
