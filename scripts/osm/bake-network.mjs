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
import { ORIGIN, toLatLon, toLocal } from "./tiles.mjs";

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
    id: "line-3",
    name: "Line 3",
    colourName: "Purple Line",
    own: /Line 3|Purple Line/i,
    from: ["Madhavaram Milk Colony"],
    // SIPCOT 2 is not mapped yet: run to the end of Line 3's own track.
    to: ["SIPCOT 2", "Siruseri SIPCOT 2", "SIPCOT"],
    toTrackEnd: true,
    /** OSM maps 5 of the 48 stations; the rest as for Line 5 (see below). */
    supplement: {
      source: "Wikipedia — Purple Line (Chennai Metro), station list (2026-10-05)",
      after: {
        "Madhavaram Milk Colony": [
          { name: "Madhavaram High Road", nameTa: null },
          { name: "Moolakadai", nameTa: "மூலக்கடை", at: [13.12917, 80.2417], quality: "locality" },
          { name: "Sembiyum", nameTa: null, at: [13.12201, 80.24122], quality: "locality" },
          { name: "Perambur Market", nameTa: null },
          { name: "Perambur", nameTa: "பெரம்பூர்", at: [13.10816, 80.24449], quality: "bus-stop" },
          { name: "Ayanavaram", nameTa: null, at: [13.09863, 80.24201], quality: "bus-stop" },
          { name: "Otteri", nameTa: "ஓட்டேரி", at: [13.09721, 80.25138], quality: "bus-stop" },
          { name: "Pattalam", nameTa: null },
          { name: "Perambur Barracks Road", nameTa: null },
          { name: "Purasaiwakkam", nameTa: "புரசைவாக்கம்", at: [13.08933, 80.25503], quality: "locality" },
          { name: "Kellys", nameTa: null, at: [13.08282, 80.24333], quality: "locality" },
        ],
        "Kilpauk": [
          { name: "Chetpet", nameTa: "சேத்துப்பட்டு", at: [13.07048, 80.24212], quality: "bus-stop" },
          { name: "Sterling Road", nameTa: "ஸ்டெர்லிங் ரோடு", at: [13.0635, 80.24345], quality: "bus-stop" },
          { name: "Nungambakkam", nameTa: "நுங்கம்பாக்கம்" },
          { name: "Anna Flyover", nameTa: null, at: [13.05531, 80.24938], quality: "bus-stop" },
          { name: "Thousand Lights", nameTa: "ஆயிரம் விளக்கு", at: [13.05652, 80.25644], quality: "bus-stop" },
        ],
        "Royapettah Metro": [
          { name: "Dr. Radhakrishnan Salai", nameTa: null },
        ],
        "Thirumayilai Metro": [
          { name: "Mandaiveli", nameTa: null, at: [13.0272, 80.26624], quality: "bus-stop" },
          { name: "Greenways Road", nameTa: null },
          { name: "Adyar Junction", nameTa: null, at: [13.00707, 80.25864], quality: "bus-stop" },
          { name: "Adyar Depot", nameTa: null, at: [12.99874, 80.25617], quality: "bus-stop" },
          { name: "Indira Nagar", nameTa: "இந்திரா நகர்", at: [12.99606, 80.24972], quality: "locality" },
          { name: "Thiruvanmiyur", nameTa: null, at: [12.98325, 80.25502], quality: "locality" },
          { name: "Tharamani", nameTa: null },
          { name: "Nehru Nagar", nameTa: null, at: [12.97422, 80.24754], quality: "locality" },
          { name: "Kandanchavadi", nameTa: null, at: [12.96692, 80.24828], quality: "bus-stop" },
          { name: "Perungudi", nameTa: null },
          { name: "Thoraipakkam", nameTa: "துறைப்பாக்கம்", at: [12.95262, 80.24187], quality: "bus-stop" },
          { name: "Mettukuppam", nameTa: "மேட்டுக்குப்பம்", at: [12.94001, 80.23563], quality: "bus-stop" },
          { name: "PTC Colony", nameTa: null, at: [12.93411, 80.23615], quality: "locality" },
          { name: "Okkiyampet", nameTa: null },
          { name: "Karapakkam", nameTa: "காரப்பாக்கம்", at: [12.91328, 80.22936], quality: "bus-stop" },
          { name: "Okkiyam Thoraipakkam", nameTa: null },
        ],
        "Sholinganallur Metro": [
          { name: "Sholinganallur Lake I", nameTa: null },
          { name: "Sholinganallur Lake II", nameTa: null },
          { name: "Semmancheri Depot", nameTa: null },
          { name: "Semmancheri I", nameTa: null },
          { name: "Semmancheri II", nameTa: null },
          { name: "Gandhi Nagar", nameTa: null },
          { name: "Navallur", nameTa: "நாவலூர்", at: [12.84458, 80.22646], quality: "bus-stop" },
          { name: "Siruseri", nameTa: null },
          { name: "SIPCOT 1", nameTa: null, at: [12.83208, 80.2292], quality: "bus-stop" },
          { name: "SIPCOT 2", nameTa: null, atTrackEnd: true },
        ],
      },
    },
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
    /**
     * Stations OSM does not map yet (it has 27 of the 45). Names and order from
     * Wikipedia (Red Line (Chennai Metro), checked 2026-10-05). Positioned at the
     * same-name bus stop or locality on the track where OSM has one (`at`),
     * otherwise spaced evenly between their neighbours.
     */
    supplement: {
      source: "Wikipedia — Red Line (Chennai Metro), station list (2026-10-05)",
      after: {
        "Villivakkam Metro": [
          { name: "Villivakkam Bus Terminus", nameTa: null, at: [13.10546, 80.20793], quality: "bus-stop" },
          { name: "Villivakkam CTH Road", nameTa: null },
          { name: "Anna Nagar West", nameTa: "அண்ணா நகர் மேற்கு", at: [13.09375, 80.19849], quality: "bus-stop" },
          { name: "Thirumangalam", nameTa: "திருமங்கலம்", at: [13.08538, 80.20131], quality: "bus-stop" },
          { name: "Anna Nagar KV", nameTa: null },
        ],
        "St. Thomas Mount Metro": [
          { name: "Adambakkam", nameTa: "ஆதம்பாக்கம்", at: [12.982381, 80.196888], quality: "locality" },
          { name: "Vanuvampet", nameTa: null },
          { name: "Ullagaram", nameTa: "உள்ளகரம்" },
          { name: "Madipakkam", nameTa: "மடிப்பாக்கம்", at: [12.96846, 80.19002], quality: "locality" },
          { name: "Kilkattalai", nameTa: "கீழ்க்கட்டளை", at: [12.95595, 80.18683], quality: "bus-stop" },
          { name: "Echangadu", nameTa: "ஈச்சங்காடு", at: [12.94865, 80.1851], quality: "bus-stop" },
          { name: "Kovilambakkam", nameTa: "கோவிலம்பாக்கம்", at: [12.93924, 80.18252], quality: "bus-stop" },
          { name: "Vellakkal", nameTa: "வெள்ளைக்கல்", at: [12.93137, 80.18145], quality: "bus-stop" },
          { name: "Medavakkam I", nameTa: null, at: [12.92047, 80.18396], quality: "bus-stop" },
          { name: "Medavakkam II", nameTa: null, at: [12.91732, 80.19368], quality: "bus-stop" },
          { name: "Perumbakkam", nameTa: "பெரும்பாக்கம்", at: [12.90555, 80.19562], quality: "locality" },
          { name: "Classical Tamil Institute", nameTa: null },
          { name: "Elcot", nameTa: null },
        ],
      },
    },
  },
];

/**
 * Insert supplementary stations after their named neighbour: anchored ones
 * projected onto the track, the rest spaced evenly between positioned
 * neighbours. Mutates `stations` (sorted by d).
 */
/** Half a station (platform plus margin), the closest two stations get, and how far one may move to find straight track. */
const STATION_HALF = 80;
const MIN_SPACING = 500;
const SHIFT = 400;

function addSupplement(spec, stations, samples) {
  if (!spec.supplement) return;
  const at = (d) => {
    let i = samples.findIndex((s) => s.d >= d);
    if (i < 0) i = samples.length - 1;
    return samples[i];
  };
  for (const [after, list] of Object.entries(spec.supplement.after)) {
    const i = stations.findIndex((s) => s.name === after);
    if (i < 0) throw new Error(`${spec.id}: supplement anchor ${after} not found`);
    const next = stations[i + 1];
    const end = samples[samples.length - 1].d;
    const run = list.map((e) => {
      // The mapped track ends at the terminus: a little short of the buffer.
      if (e.atTrackEnd) return { ...e, d: end - 120, quality: "interpolated" };
      if (!e.at) return { ...e, d: null };
      const [x, z] = toLocal(e.at[0], e.at[1]);
      const p = projectOnto(samples, x, z);
      return { ...e, d: p.d, off: p.off };
    });
    // Evenly between the nearest positioned neighbours.
    const pos = [{ d: stations[i].d }, ...run, { d: next ? next.d : samples[samples.length - 1].d }];
    for (let k = 1; k < pos.length - 1; k++) {
      if (pos[k].d !== null) continue;
      let a = k - 1;
      let b = k + 1;
      while (pos[b].d === null) b++;
      const d0 = pos[a].d;
      const d1 = pos[b].d;
      for (let m = k; m < b; m++) pos[m].d = d0 + ((d1 - d0) * (m - a)) / (b - a);
      pos[k].quality = "interpolated";
      k = b - 1;
    }
    // Stations stand on straight track: move each a little (in order, clear of its
    // neighbours) to the straightest stretch nearby if it landed on a curve.
    const heading = (d) => {
      const a = at(Math.max(0, d - 5));
      const b = at(Math.min(end, d + 5));
      return Math.atan2(b.z - a.z, b.x - a.x);
    };
    const turn = (d) => {
      let t = Math.abs(heading(d + STATION_HALF) - heading(d - STATION_HALF));
      if (t > Math.PI) t = 2 * Math.PI - t;
      return t;
    };
    for (let k = 1; k < pos.length - 1; k++) {
      const e = pos[k];
      if (turn(e.d) < 0.04) continue;
      const lo = pos[k - 1].d + MIN_SPACING;
      const hi = pos[k + 1].d - MIN_SPACING;
      let best = e.d;
      let cost = turn(e.d);
      for (let c = Math.max(lo, e.d - SHIFT); c <= Math.min(hi, e.d + SHIFT); c += 10) {
        const v = turn(c) + Math.abs(c - e.d) / 3000;
        if (v < cost) {
          cost = v;
          best = c;
        }
      }
      e.shiftM = Math.round(best - e.d);
      e.d = best;
    }
    for (let k = 1; k < pos.length - 1; k++) {
      const e = pos[k];
      const s = at(e.d);
      const ll = toLatLon(s.x, s.z);
      stations.push({
        osmId: null,
        name: e.name,
        nameTa: e.nameTa,
        lat: ll.lat,
        lon: ll.lon,
        x: s.x,
        z: s.z,
        d: e.d,
        off: 0,
        station: true,
        construction: true,
        entrances: [],
        quality: e.quality ?? "interpolated",
        source: spec.supplement.source,
        ...(e.shiftM ? { shiftedM: e.shiftM } : {}),
      });
    }
    for (let k = 2; k < pos.length - 1; k++) if (pos[k].d <= pos[k - 1].d) throw new Error(`${spec.id}: supplement ${pos[k].name} out of order`);
  }
  stations.sort((a, b) => a.d - b.d);
}

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

/**
 * Side roads named in tracks.json (`sideRoads[].osm`): walk the named OSM road
 * away from its junction station in the given heading, for lengthM metres.
 * Returns local [x, z] points every ~10 m, plus [s0, s1] spans of named features
 * along it (e.g. the MGR flyover).
 */
async function bakeRoads(lineStations) {
  const tracksJson = JSON.parse(await readFile(path.resolve("src/data/tracks.json"), "utf8"));
  const specs = (tracksJson.structures.sideRoads ?? []).filter((r) => r.osm);
  const out = {};
  if (!specs.length) return out;
  const { tileList } = await import("./tiles.mjs");
  const tiles = await tileList();
  for (const spec of specs) {
    const st = lineStations.get(spec.atStation);
    if (!st) throw new Error(`side road ${spec.id}: station ${spec.atStation} not found`);
    const [sx, sz] = toLocal(st.lat, st.lon);
    const names = new Set(spec.osm.names);
    // Ways of those names in tiles within 3 km.
    const ways = [];
    for (const t of tiles) {
      const cx = (t.tx + 0.5) * 1000;
      const cz = (t.tz + 0.5) * 1000;
      if (Math.hypot(cx - sx, cz - sz) > 3800) continue;
      let data;
      try {
        data = await load(`tile-${t.key}`);
      } catch {
        continue;
      }
      for (const e of data.elements) if (e.type === "way" && names.has(e.tags?.name)) ways.push(e);
    }
    const seen = new Set();
    const uniq = ways.filter((w) => !seen.has(w.id) && seen.add(w.id));
    // Graph by shared coordinates; each edge remembers its way's name.
    const verts = new Map();
    const vert = (g) => {
      const k = key(g.lat, g.lon);
      let v = verts.get(k);
      if (!v) {
        const [x, z] = toLocal(g.lat, g.lon);
        verts.set(k, (v = { x, z, edges: [] }));
      }
      return v;
    };
    for (const w of uniq) {
      for (let i = 1; i < w.geometry.length; i++) {
        const a = vert(w.geometry[i - 1]);
        const b = vert(w.geometry[i]);
        a.edges.push({ to: b, name: w.tags.name });
        b.edges.push({ to: a, name: w.tags.name });
      }
    }
    // Start on the main road or a named feature, not a parallel service road.
    const mainNames = new Set([spec.osm.names[0], ...Object.values(spec.osm.features ?? {})]);
    let v = null;
    let best = Infinity;
    for (const c of verts.values()) {
      if (!c.edges.some((e) => mainNames.has(e.name))) continue;
      const d = Math.hypot(c.x - sx, c.z - sz);
      if (d < best) {
        best = d;
        v = c;
      }
    }
    if (!v || best > 400) throw new Error(`side road ${spec.id}: no ${spec.osm.names[0]} within 400 m of ${spec.atStation}`);
    const featureNames = new Set(Object.values(spec.osm.features ?? {}));
    // Greedy walk along a heading from vertex v0, never turning back; returns points after v0.
    const walk = (v0, h0x, h0z, maxLen, visited) => {
      let hx = h0x;
      let hz = h0z;
      const hl = Math.hypot(hx, hz);
      hx /= hl;
      hz /= hl;
      const out = [];
      let at = v0;
      let length = 0;
      while (length < maxLen) {
        let next = null;
        let score = 0.35;
        for (const e of at.edges) {
          if (visited.has(e.to)) continue;
          const dx = e.to.x - at.x;
          const dz = e.to.z - at.z;
          const l = Math.hypot(dx, dz) || 1;
          // Prefer the named features (the flyover over the service road beneath it).
          const bonus = featureNames.has(e.name) ? 0.25 : 0;
          const dot = (dx * hx + dz * hz) / l + bonus;
          if (dot > score) {
            score = dot;
            next = e;
          }
        }
        if (!next) break;
        const dx = next.to.x - at.x;
        const dz = next.to.z - at.z;
        const l = Math.hypot(dx, dz) || 1;
        length += l;
        hx = 0.75 * hx + 0.25 * (dx / l);
        hz = 0.75 * hz + 0.25 * (dz / l);
        const hn = Math.hypot(hx, hz);
        hx /= hn;
        hz /= hn;
        at = next.to;
        visited.add(at);
        out.push({ x: at.x, z: at.z, name: next.name });
      }
      return out;
    };
    // Back along the road (under the metro, before the junction), then forward along the heading.
    const visited = new Set([v]);
    const back = walk(v, -spec.osm.heading[0], -spec.osm.heading[1], (spec.westM ?? 0) + 150, visited);
    const fwd = walk(v, spec.osm.heading[0], spec.osm.heading[1], spec.osm.lengthM, visited);
    // Points in road order; each point's `name` is the name of the edge arriving at it.
    const backPts = back.reverse();
    const pts = [];
    for (let i = 0; i < backPts.length; i++) pts.push({ x: backPts[i].x, z: backPts[i].z, name: i > 0 ? backPts[i - 1].name : null });
    pts.push({ x: v.x, z: v.z, name: backPts.length ? backPts[backPts.length - 1].name : null });
    for (const p of fwd) pts.push(p);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    // Resample every 10 m with names, then features as spans of matching names.
    const sts = pts.slice(1).map((p) => ({ name: p.name }));
    const samples = resample(pts, sts.length ? sts : [{ name: null }], 10);
    const features = {};
    for (const [fid, fname] of Object.entries(spec.osm.features ?? {})) {
      const on = samples.filter((p) => p.st?.name === fname);
      if (on.length) features[fid] = [Math.round(on[0].d), Math.round(on[on.length - 1].d)];
    }
    out[spec.id] = {
      points: samples.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]),
      lengthM: Math.round(samples[samples.length - 1].d),
      features,
    };
    console.log(`road ${spec.id}: ${(length / 1000).toFixed(2)} km from ${uniq.length} ways, features ${JSON.stringify(features)}`);
  }
  return out;
}

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
    let b = findStation(spec.to);
    if (!b && spec.toTrackEnd && a) {
      // Terminus not mapped yet: the end of the line's own track farthest from the other terminus.
      const [ax0, az0] = toLocal(a.lat, a.lon);
      const ends = graph.filter((v) => v.edges.some((e) => e.own));
      b = ends.reduce((best, v) => (Math.hypot(v.x - ax0, v.z - az0) > Math.hypot(best.x - ax0, best.z - az0) ? v : best), ends[0]);
    }
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
    addSupplement(spec, stations, samples);

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
        ...(s.quality ? { quality: s.quality, source: s.source, ...(s.shiftedM ? { shiftedM: s.shiftedM } : {}) } : {}),
      })),
    });
    console.log(
      `${spec.id}: ${(length / 1000).toFixed(2)} km, ${stations.length} stations, ${structure.length} structure runs, ${Math.round(route.foreign)} m on other track`,
    );
  }

  // Stations by curated id, for side roads (curated stations match by osmName / name).
  const curated = JSON.parse(await readFile(path.resolve("src/data/stations.json"), "utf8")).stations;
  const norm = (n) => n.toLowerCase().replace(/\s+metro$/, "").replace(/[^a-z0-9]+/g, " ").trim();
  const byId = new Map();
  for (const c of curated) {
    for (const l of lines) {
      const hit = l.stations.find((n) => norm(n.name) === norm(c.osmName ?? c.name));
      if (hit) byId.set(c.id, hit);
    }
  }
  const roads = await bakeRoads(byId);

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
    roads,
  };
  const file = path.resolve("src/data/network.json");
  await writeFile(file, JSON.stringify(out) + "\n");
  console.log(`wrote ${file} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
}

await main();
