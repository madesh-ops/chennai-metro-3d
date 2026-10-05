#!/usr/bin/env node
/**
 * Bake src/data/network.json from the cached OpenStreetMap data:
 * for every modelled line, the real track centreline from terminus to
 * terminus (shortest path over that line's track ways), its vertical
 * structure (elevated / underground / at grade, from bridge/tunnel/layer
 * tags) and its stations in order along the track.
 *
 *   node scripts/osm/bake-network.mjs
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR } from "./overpass.mjs";
import { ORIGIN, toLocal } from "./tiles.mjs";

const load = async (name) => JSON.parse(await readFile(path.join(CACHE_DIR, `${name}.json`), "utf8"));

/**
 * Per line: which track ways are its own (name pattern), and its termini as
 * OSM station names (any of the listed spellings). Order: west/north end first.
 */
export const LINE_SPECS = [
  {
    id: "line-1",
    name: "Line 1",
    colourName: "Blue Line",
    own: /Line 1\b|Blue Line/i,
    from: ["Wimco Nagar Depot", "விம்கோ நகர் டிப்போ"],
    to: ["Chennai International Airport", "Airport", "சென்னை விமான நிலையம்"],
  },
  {
    id: "line-2",
    name: "Line 2",
    colourName: "Green Line",
    own: /Line 2\b|Green Line/i,
    from: ["Central Metro", "Puratchi Thalaivar Dr. M.G. Ramachandran Central", "Chennai Central"],
    to: ["St. Thomas Mount", "பரங்கிமலை", "Parangimalai"],
  },
  {
    id: "line-4",
    name: "Line 4",
    colourName: "Yellow Line",
    own: /Yellow Line/i,
    from: ["Poonamallee Bypass"],
    to: ["Lighthouse Metro", "Lighthouse"],
  },
  {
    id: "line-5",
    name: "Line 5",
    colourName: "Red Line",
    own: /Line 5\b|Red Line/i,
    from: ["Madhavaram Milk Colony", "Assissi Nagar", "Assisi Nagar"],
    to: ["Sholinganallur Metro", "Sholinganallur", "Shozhinganallur"],
  },
];

const key = (lat, lon) => `${lat.toFixed(7)},${lon.toFixed(7)}`;

/** Structure of a way from its tags. */
function structureOf(tags) {
  const layer = Number(tags.layer ?? 0) || 0;
  if (tags.tunnel && tags.tunnel !== "no") return { kind: "underground", layer: Math.min(layer, -1) };
  if (tags.bridge && tags.bridge !== "no") return { kind: "elevated", layer: Math.max(layer, 1) };
  if (layer < 0) return { kind: "underground", layer };
  if (layer > 0) return { kind: "elevated", layer };
  return { kind: "at-grade", layer: 0 };
}

/** Graph of track ways: vertices at shared coordinates, edges along each way. */
function buildGraph(ways, ownPattern) {
  const verts = new Map(); // key -> { lat, lon, edges: [{ to, len, cost, way }] }
  const vert = (g) => {
    const k = key(g.lat, g.lon);
    let v = verts.get(k);
    if (!v) verts.set(k, (v = { k, lat: g.lat, lon: g.lon, x: 0, z: 0, edges: [] }));
    [v.x, v.z] = toLocal(g.lat, g.lon);
    return v;
  };
  for (const w of ways) {
    const tags = w.tags ?? {};
    const own = ownPattern.test(`${tags.name ?? ""} ${tags.ref ?? ""} ${tags.line ?? ""}`) || w.member;
    // Other lines' track only bridges gaps; unnamed track (stations, crossovers) is fine in between.
    const weight = own ? 1 : tags.name ? 25 : 3;
    const st = structureOf(tags);
    for (let i = 1; i < w.geometry.length; i++) {
      const a = vert(w.geometry[i - 1]);
      const b = vert(w.geometry[i]);
      const len = Math.hypot(a.x - b.x, a.z - b.z);
      a.edges.push({ to: b, len, cost: len * weight, st, own });
      b.edges.push({ to: a, len, cost: len * weight, st, own });
    }
  }
  return [...verts.values()];
}

function nearestVertex(verts, x, z, preferOwn = true) {
  let best = null;
  let bd = Infinity;
  for (const v of verts) {
    if (preferOwn && !v.edges.some((e) => e.own)) continue;
    const d = Math.hypot(v.x - x, v.z - z);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return { v: best, d: bd };
}

/** Dijkstra with a binary heap. Returns the vertex path and per-edge structure. */
function shortestPath(src, dst) {
  const dist = new Map([[src, 0]]);
  const prev = new Map();
  const heap = [[0, src]];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, v] = pop();
    if (v === dst) break;
    if (d > (dist.get(v) ?? Infinity)) continue;
    for (const e of v.edges) {
      const nd = d + e.cost;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { from: v, edge: e });
        push([nd, e.to]);
      }
    }
  }
  if (!prev.has(dst)) return null;
  const pts = [];
  const sts = [];
  let foreign = 0;
  for (let v = dst; v !== src; ) {
    const p = prev.get(v);
    pts.push(v);
    sts.push(p.edge.st);
    if (!p.edge.own) foreign += p.edge.len;
    v = p.from;
  }
  pts.push(src);
  pts.reverse();
  sts.reverse();
  return { pts, sts, foreign };
}

/** Resample a polyline every `step` metres, carrying each sample's structure. */
function resample(pts, sts, step) {
  const out = [];
  let carry = 0;
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    let s = carry;
    while (s < len) {
      const t = s / len;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, d: total + s, st: sts[i - 1] });
      s += step;
    }
    carry = s - len;
    total += len;
  }
  const last = pts[pts.length - 1];
  out.push({ x: last.x, z: last.z, d: total, st: sts[sts.length - 1] });
  return out;
}

/** Light smoothing (moving average over ±window samples) to remove crossover jogs, ends pinned. */
function smooth(samples, window) {
  return samples.map((p, i) => {
    if (i < window || i >= samples.length - window) return p;
    let x = 0;
    let z = 0;
    for (let k = -window; k <= window; k++) {
      x += samples[i + k].x;
      z += samples[i + k].z;
    }
    const n = 2 * window + 1;
    return { ...p, x: x / n, z: z / n };
  });
}

/** Compress per-sample structure into runs [fromD, toD, kind, layer]. */
function structureRuns(samples) {
  const runs = [];
  for (const s of samples) {
    const last = runs[runs.length - 1];
    if (last && last.kind === s.st.kind && last.layer === s.st.layer) last.to = s.d;
    else runs.push({ from: s.d, to: s.d, kind: s.st.kind, layer: s.st.layer });
  }
  // Drop slivers under 40 m (merge into the previous run): tag noise at way joins.
  const clean = [];
  for (const r of runs) {
    const prev = clean[clean.length - 1];
    if (prev && r.to - r.from < 40) prev.to = r.to;
    else if (prev && prev.kind === r.kind && prev.layer === r.layer) prev.to = r.to;
    else clean.push({ ...r });
  }
  // Contiguous: each run ends where the next begins.
  for (let i = 0; i + 1 < clean.length; i++) clean[i].to = clean[i + 1].from;
  return clean.map((r) => [Math.round(r.from), Math.round(r.to), r.kind, r.layer]);
}

/** Project a point onto the sampled polyline: [distance, offset]. */
function projectOnto(samples, x, z) {
  let best = { d: 0, off: Infinity };
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const off = Math.hypot(x - px, z - pz);
    if (off < best.off) best = { d: a.d + (b.d - a.d) * t, off };
  }
  return best;
}

/** Chennai Metro stations only (not suburban / MRTS / IR stations that sit near the track). */
const isMetro = (tags = {}) =>
  tags.station === "subway" || tags.subway === "yes" || /chennai metro/i.test(tags.network ?? "") || /cmrl|chennai metro/i.test(tags.operator ?? "");

const englishName = (tags) => tags["name:en"] ?? (/[a-z]/i.test(tags.name ?? "") ? tags.name : null) ?? tags.name;

async function main() {
  const trackWays = (await load("track-ways")).elements.filter((e) => e.type === "way" && e.geometry);
  const stationEls = (await load("stations")).elements;
  const stationNodes = stationEls.filter(
    (e) => e.type === "node" && isMetro(e.tags) && (e.tags?.railway === "station" || e.tags?.public_transport === "station" || e.tags?.railway === "stop"),
  );
  const entrances = stationEls.filter((e) => e.tags?.railway === "subway_entrance");

  const lines = [];
  for (const spec of LINE_SPECS) {
    const rel = await load(`rel-${spec.id}`);
    const relations = rel.elements.filter((e) => e.type === "relation");
    const relNodes = new Map(rel.elements.filter((e) => e.type === "node").map((n) => [n.id, n]));
    const memberWays = relations.flatMap((r) =>
      r.members.filter((m) => m.type === "way" && m.geometry).map((m) => ({ tags: trackWays.find((w) => w.id === m.ref)?.tags ?? {}, geometry: m.geometry, member: true })),
    );
    const graph = buildGraph([...memberWays, ...trackWays], spec.own);

    // Termini: OSM station or relation stop nodes by name.
    const allNamed = [...stationNodes, ...relNodes.values()].filter((n) => n.tags);
    const findStation = (names) =>
      allNamed.find((n) => names.some((nm) => [n.tags.name, n.tags["name:en"], n.tags["name:ta"]].some((v) => v && v.toLowerCase() === nm.toLowerCase())));
    const a = findStation(spec.from);
    const b = findStation(spec.to);
    if (!a || !b) throw new Error(`${spec.id}: termini not found (${!a ? spec.from[0] : spec.to[0]})`);
    const [ax, az] = toLocal(a.lat, a.lon);
    const [bx, bz] = toLocal(b.lat, b.lon);
    const va = nearestVertex(graph, ax, az);
    const vb = nearestVertex(graph, bx, bz);
    const route = shortestPath(va.v, vb.v);
    if (!route) throw new Error(`${spec.id}: no track path between termini`);

    const samples = smooth(resample(route.pts, route.sts, 5), 3);
    const length = samples[samples.length - 1].d;
    // Thin the stored centreline to ~10 m (the app's Catmull-Rom resamples it every metre).
    const track = samples.filter((_, i) => i % 2 === 0 || i === samples.length - 1).map((s) => [Math.round(s.x * 10) / 10, Math.round(s.z * 10) / 10]);
    const structure = structureRuns(samples);

    // Stations: relation stops plus station nodes within 160 m of the track, one per name, in order.
    const candidates = [
      ...relations.flatMap((r) => r.members.filter((m) => m.type === "node" && m.role.startsWith("stop")).map((m) => relNodes.get(m.ref))).filter(Boolean),
      ...stationNodes,
    ];
    const byName = new Map();
    for (const n of candidates) {
      const tags = n.tags ?? {};
      if (tags.railway === "stop" && !relations.some((r) => r.members.some((m) => m.ref === n.id))) continue;
      const [x, z] = toLocal(n.lat, n.lon);
      const p = projectOnto(samples, x, z);
      if (p.off > 160) continue;
      // Prefer the station node (it carries name:en / name:ta) over the stop position.
      const nm = englishName(tags);
      const station = tags.railway === "station" || tags.public_transport === "station";
      // Same station: within 140 m along the track, or the same name within 600 m (stations mapped as two nodes).
      const existing = [...byName.values()].find((s) => Math.abs(s.d - p.d) < 140 || (s.name === nm && Math.abs(s.d - p.d) < 600));
      const entry = { osmId: n.id, name: nm, nameTa: tags["name:ta"] ?? (/[஀-௿]/.test(tags.name ?? "") ? tags.name : null), lat: n.lat, lon: n.lon, x, z, d: p.d, off: p.off, station, construction: !!(tags.construction || tags["construction:railway"]) };
      if (existing) {
        // Merge: keep the station node's names; keep the position nearest the track.
        if (station && !existing.station) Object.assign(existing, { osmId: entry.osmId, name: entry.name, nameTa: entry.nameTa ?? existing.nameTa, station: true });
        if (!existing.nameTa && entry.nameTa) existing.nameTa = entry.nameTa;
        if (entry.off < existing.off) Object.assign(existing, { d: entry.d, off: entry.off, lat: entry.lat, lon: entry.lon, x: entry.x, z: entry.z });
        continue;
      }
      byName.set(`${nm}@${Math.round(p.d)}`, entry);
    }
    const stations = [...byName.values()].sort((p, q) => p.d - q.d);

    // Entrances near each station.
    for (const s of stations) {
      s.entrances = entrances
        .map((e) => ({ e, dd: Math.hypot(...toLocal(e.lat, e.lon).map((v, i) => v - (i ? s.z : s.x))) }))
        .filter((o) => o.dd < 220)
        .map(({ e }) => {
          const [x, z] = toLocal(e.lat, e.lon);
          return [Math.round(x * 10) / 10, Math.round(z * 10) / 10];
        });
    }

    const colour = relations[0]?.tags?.colour ?? null;
    lines.push({
      id: spec.id,
      name: spec.name,
      colourName: spec.colourName,
      osmColour: colour,
      osmRelations: relations.map((r) => r.id),
      lengthM: Math.round(length),
      offOwnTrackM: Math.round(route.foreign),
      track,
      structure,
      stations: stations.map((s) => ({
        osmId: s.osmId,
        name: s.name,
        nameTa: s.nameTa,
        lat: Number(s.lat.toFixed(6)),
        lon: Number(s.lon.toFixed(6)),
        d: Math.round(s.d),
        offsetM: Math.round(s.off),
        underConstruction: s.construction,
        entrances: s.entrances,
      })),
    });
    console.log(
      `${spec.id}: ${(length / 1000).toFixed(2)} km, ${stations.length} stations, ${structure.length} structure runs, ${Math.round(route.foreign)} m on other track`,
    );
  }

  const out = {
    meta: {
      source: "OpenStreetMap (route relations, railway ways tagged bridge/tunnel/layer, station and entrance nodes)",
      licence: "Data © OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright",
      snapshot: new Date().toISOString().slice(0, 10),
      origin: ORIGIN,
      projection: "Equirectangular about origin: x east, z south (metres), as src/utils/coordinates.ts",
      note: "Generated by scripts/osm/bake-network.mjs — do not edit by hand. Curated facts (service, fares, speeds) live in stations.json / routes.json / tracks.json.",
    },
    lines,
  };
  const file = path.resolve("src/data/network.json");
  await writeFile(file, JSON.stringify(out) + "\n");
  console.log(`wrote ${file} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
}

await main();
