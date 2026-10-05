#!/usr/bin/env node
/**
 * Bake the world tiles: data-cache/osm/tile-*.json (from extract.mjs or
 * fetch.mjs) → public/world/tiles/{tx}_{tz}.bin (gzip) + public/world/index.json.
 * Format: src/three/world/tileFormat.ts.
 *
 * - Buildings: OpenStreetMap footprints. OSM almost never has heights here,
 *   so floors are estimated from the building type, footprint and whether it
 *   faces a main road (seeded, so every bake is identical).
 * - Where a street has no buildings mapped at all (much of the west of the
 *   city), plausible plots are laid along both sides of the real street,
 *   flagged procedural.
 * - Roads clipped to the tile; water and parks clipped to the tile; OSM trees
 *   plus street and park trees.
 *
 *   node scripts/osm/bake-tiles.mjs
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { CACHE_DIR } from "./overpass.mjs";
import { TILE_M, toLocal } from "./tiles.mjs";

const OUT = path.join("public", "world");
const MAGIC = 0x31574d43;

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rr = (r, a, b) => a + (b - a) * r();

const num = (s) => {
  if (s === undefined) return NaN;
  const m = String(s).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
};

/** Signed area (x right, z down in the projection; sign only used for winding). */
function signedArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % n];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

function centroid(ring) {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}

function bbox(pts) {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [x, z] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return [x0, z0, x1, z1];
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distPointSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function segsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Distance between segment ab and polygon ring (0 if they touch). */
function distSegRing(a, b, ring) {
  if (pointInRing(a[0], a[1], ring) || pointInRing(b[0], b[1], ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    if (segsCross(a, b, p, q)) return 0;
    best = Math.min(best, distPointSeg(p[0], p[1], a[0], a[1], b[0], b[1]), distPointSeg(a[0], a[1], p[0], p[1], q[0], q[1]), distPointSeg(b[0], b[1], p[0], p[1], q[0], q[1]));
  }
  return best;
}

function ringsOverlap(r1, r2) {
  if (pointInRing(r1[0][0], r1[0][1], r2) || pointInRing(r2[0][0], r2[0][1], r1)) return true;
  for (let i = 0; i < r1.length; i++) {
    for (let j = 0; j < r2.length; j++) {
      if (segsCross(r1[i], r1[(i + 1) % r1.length], r2[j], r2[(j + 1) % r2.length])) return true;
    }
  }
  return false;
}

/** Liang–Barsky clip of segment ab to the rectangle; null if outside. */
function clipSeg(a, b, x0, z0, x1, z1) {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  for (const [p, q] of [
    [-dx, a[0] - x0],
    [dx, x1 - a[0]],
    [-dz, a[1] - z0],
    [dz, z1 - a[1]],
  ]) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  const dh = (b[2] ?? 0) - (a[2] ?? 0);
  return [
    [a[0] + t0 * dx, a[1] + t0 * dz, (a[2] ?? 0) + t0 * dh],
    [a[0] + t1 * dx, a[1] + t1 * dz, (a[2] ?? 0) + t1 * dh],
  ];
}

/** A polyline clipped to the rectangle: zero or more pieces. */
function clipLine(pts, x0, z0, x1, z1) {
  const out = [];
  let cur = null;
  for (let i = 1; i < pts.length; i++) {
    const c = clipSeg(pts[i - 1], pts[i], x0, z0, x1, z1);
    if (!c) {
      cur = null;
      continue;
    }
    const startsHere = cur && Math.hypot(cur[cur.length - 1][0] - c[0][0], cur[cur.length - 1][1] - c[0][1]) < 1e-6;
    if (!startsHere) {
      cur = [c[0]];
      out.push(cur);
    }
    cur.push(c[1]);
  }
  return out.filter((l) => l.length >= 2);
}

/** Sutherland–Hodgman clip of a polygon to the rectangle. */
function clipRing(ring, x0, z0, x1, z1) {
  let poly = ring;
  const edges = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= z0, (a, b) => [a[0] + ((b[0] - a[0]) * (z0 - a[1])) / (b[1] - a[1]), z0]],
    [(p) => p[1] <= z1, (a, b) => [a[0] + ((b[0] - a[0]) * (z1 - a[1])) / (b[1] - a[1]), z1]],
  ];
  for (const [inside, cut] of edges) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (inside(b)) {
        if (!inside(a)) out.push(cut(a, b));
        out.push(b);
      } else if (inside(a)) out.push(cut(a, b));
    }
    poly = out;
    if (poly.length < 3) return [];
  }
  return poly;
}

/** Drop points closer than `tol` to the line through their neighbours (Douglas–Peucker). */
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distPointSeg(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > tol) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Spatial hash of items by bounding box. */
class Grid {
  constructor(cell) {
    this.cell = cell;
    this.map = new Map();
  }
  keys(x0, z0, x1, z1) {
    const c = this.cell;
    const out = [];
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) out.push(`${i},${j}`);
    return out;
  }
  add(item, box) {
    for (const k of this.keys(...box)) {
      let l = this.map.get(k);
      if (!l) this.map.set(k, (l = []));
      l.push(item);
    }
  }
  query(x0, z0, x1, z1) {
    const seen = new Set();
    for (const k of this.keys(x0, z0, x1, z1)) for (const it of this.map.get(k) ?? []) seen.add(it);
    return seen;
  }
}

/* ------------------------------------------------------------------ */
/* Classification                                                       */
/* ------------------------------------------------------------------ */

const ROAD_CLASS = {
  motorway: 0, motorway_link: 0, trunk: 0, trunk_link: 0,
  primary: 1, primary_link: 1,
  secondary: 2, secondary_link: 2,
  tertiary: 3, tertiary_link: 3,
  residential: 4, unclassified: 4, living_street: 4, road: 4,
  service: 5,
  pedestrian: 6,
};
/** Carriageway width (m) by class when OSM has neither width nor lanes: [two-way, one-way]. */
const ROAD_WIDTH = [
  [20, 11],
  [15, 9],
  [12, 7.5],
  [8.5, 6],
  [6, 4.5],
  [4, 3.5],
  [5, 5],
];

function roadWidth(tags, cls) {
  const w = num(tags.width);
  if (w > 2 && w < 60) return w;
  const lanes = num(tags.lanes);
  if (lanes >= 1 && lanes <= 10) return lanes * 3.3 + (cls <= 2 && tags.oneway !== "yes" ? 1 : 0);
  return ROAD_WIDTH[cls][tags.oneway === "yes" ? 1 : 0];
}

const SKIP_BUILDING = new Set(["train_station", "roof", "construction", "ruins", "no", "transportation", "bridge", "carport", "canopy", "toilets"]);
const HOUSE = new Set(["house", "detached", "residential", "terrace", "semidetached_house", "hut", "bungalow", "dormitory"]);
const SHED = new Set(["shed", "garage", "garages", "service", "kiosk", "cabin", "farm_auxiliary", "greenhouse"]);
const INDUSTRIAL = new Set(["industrial", "warehouse", "manufacture", "hangar", "factory", "storage_tank"]);
const RELIGIOUS = new Set(["temple", "church", "mosque", "religious", "chapel", "cathedral", "shrine", "synagogue", "gurdwara"]);
const INSTITUTION = new Set(["school", "college", "university", "hospital", "public", "government", "civic", "kindergarten", "fire_station", "police", "library"]);
const COMMERCIAL = new Set(["commercial", "retail", "office", "hotel", "supermarket", "mall", "shop"]);

/** Wall colours (index stored per building). The client reads them from index.json. */
const PALETTE = [
  // 0–12 plastered walls
  "#efe7d6", "#eadcc0", "#ecd9a6", "#e7cdc3", "#c6d6dc", "#cfe0cc", "#dfb79b",
  "#f3f1ea", "#d9d4c8", "#e9e2cf", "#f0d9b5", "#d5c7e0", "#bfc9b8",
  // 13–16 glass / office
  "#8fa3b3", "#9fb0bc", "#7d8f9e", "#b7c3cb",
  // 17–19 industrial sheds
  "#b9bcbf", "#a7aeb3", "#c9c2b2",
  // 20–22 temples / churches / mosques
  "#e2b25a", "#f1ece0", "#d9cfb8",
  // 23–25 institutional
  "#d8c3a0", "#cdb79a", "#e6dccb",
];
const WALL = [0, 12];
const OFFICE = [13, 16];
const SHEDC = [17, 19];
const HOLY = [20, 22];
const INST = [23, 25];
const pickIn = (r, [a, b]) => a + Math.floor(r() * (b - a + 1));

const FLOOR_H = 3.1;
const PARAPET = 0.8;

/* ------------------------------------------------------------------ */
/* Load                                                                 */
/* ------------------------------------------------------------------ */

async function load() {
  const files = (await readdir(CACHE_DIR)).filter((f) => /^tile-.*\.json$/.test(f));
  const tiles = files.map((f) => f.slice(5, -5)).map((k) => ({ key: k, tx: Number(k.split("_")[0]), tz: Number(k.split("_")[1]) }));
  const buildings = new Map();
  const roads = new Map();
  const areas = new Map();
  const trees = new Map();
  const proj = (g) => g.map((p) => toLocal(p.lat, p.lon));
  const areaKind = (t) => {
    if (t.natural === "water" || t.water || t.waterway === "riverbank" || t.landuse === "reservoir" || t.landuse === "basin") return 0;
    if (t.leisure === "pitch" || t.leisure === "stadium") return 2;
    if (t.leisure || t.landuse) return 1;
    return -1;
  };
  for (const f of files) {
    const j = JSON.parse(await readFile(path.join(CACHE_DIR, f), "utf8"));
    for (const e of j.elements) {
      if (e.type === "node") {
        trees.set(e.id, toLocal(e.lat, e.lon));
        continue;
      }
      const t = e.tags ?? {};
      if (e.type === "relation") {
        const outer = e.members.filter((m) => m.role === "outer");
        if (!outer.length) continue;
        const rings = joinRings(outer.map((m) => proj(m.geometry)));
        if (t.building || t["building:part"]) {
          rings.forEach((ring, i) => buildings.set(`r${e.id}-${i}`, { tags: t, ring }));
        } else {
          const k = areaKind(t);
          if (k >= 0) rings.forEach((ring, i) => areas.set(`r${e.id}-${i}`, { kind: k, ring }));
        }
        continue;
      }
      const g = proj(e.geometry);
      if (t.building || t["building:part"]) {
        if (g.length >= 4) buildings.set(`w${e.id}`, { tags: t, ring: g.slice(0, -1) });
      } else if (t.highway) {
        if (t.tunnel && t.tunnel !== "no") continue;
        if (ROAD_CLASS[t.highway] === undefined) continue;
        roads.set(e.id, { tags: t, line: g });
      } else {
        const k = areaKind(t);
        if (k >= 0 && g.length >= 4) areas.set(`w${e.id}`, { kind: k, ring: g.slice(0, -1) });
      }
    }
  }
  return { tiles, buildings, roads, areas, trees };
}

/** Join multipolygon outer ways end to end into closed rings. */
function joinRings(parts) {
  const rings = [];
  const pool = parts.map((p) => p.slice());
  const same = (a, b) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
  while (pool.length) {
    let ring = pool.shift();
    let grown = true;
    while (!same(ring[0], ring[ring.length - 1]) && grown) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        const end = ring[ring.length - 1];
        if (same(p[0], end)) ring = ring.concat(p.slice(1));
        else if (same(p[p.length - 1], end)) ring = ring.concat(p.slice(0, -1).reverse());
        else continue;
        pool.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (same(ring[0], ring[ring.length - 1])) ring = ring.slice(0, -1);
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/* ------------------------------------------------------------------ */
/* Bake                                                                 */
/* ------------------------------------------------------------------ */

async function main() {
  const t0 = Date.now();
  const { tiles, buildings, roads, areas, trees } = await load();
  console.log(`loaded ${buildings.size} buildings, ${roads.size} roads, ${areas.size} areas, ${trees.size} trees from ${tiles.length} tiles`);
  const tileSet = new Set(tiles.map((t) => t.key));

  // Elevation of every road point (flyovers, their ramps), before simplifying.
  const heights = roadHeights(roads);
  let elevated = 0;

  // Roads: projected, simplified, classified; indexed by segment.
  const roadList = [];
  const roadGrid = new Grid(40);
  for (const [id, r] of roads) {
    const cls = ROAD_CLASS[r.tags.highway];
    const hs = heights.get(id);
    // Raised roads keep every point (the height profile lives on them); others are simplified.
    const line = hs ? r.line.map((p, i) => [p[0], p[1], hs[i]]) : simplify(r.line, 0.4);
    if (hs) elevated++;
    const width = roadWidth(r.tags, cls);
    const layer = Math.max(0, Math.min(5, num(r.tags.layer) || 0));
    const bridge = (r.tags.bridge && r.tags.bridge !== "no") || layer > 0;
    const road = { id, cls, width, bridge, layer, line, name: r.tags.name, raised: Boolean(hs && hs.some((v) => v > 1)) };
    roadList.push(road);
    for (let i = 1; i < line.length; i++) {
      const seg = { road, a: line[i - 1], b: line[i] };
      roadGrid.add(seg, bbox([seg.a, seg.b]));
    }
  }
  const mainRoadNear = (x, z, reach) => {
    let best = null;
    let bd = Infinity;
    for (const s of roadGrid.query(x - reach, z - reach, x + reach, z + reach)) {
      if (s.road.cls > 3) continue;
      const d = distPointSeg(x, z, s.a[0], s.a[1], s.b[0], s.b[1]) - s.road.width / 2;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return bd <= reach ? { seg: best, dist: bd } : null;
  };

  // Areas indexed for "is this point in a park / water" tests.
  const areaList = [...areas.values()].filter((a) => Math.abs(signedArea(a.ring)) > 50);
  const areaGrid = new Grid(100);
  for (const a of areaList) {
    a.box = bbox(a.ring);
    areaGrid.add(a, a.box);
  }
  const inArea = (x, z) => {
    for (const a of areaGrid.query(x, z, x, z)) if (pointInRing(x, z, a.ring)) return a;
    return null;
  };

  // OSM buildings: estimate heights and kinds.
  const bList = [];
  const bGrid = new Grid(30);
  for (const [id, b] of buildings) {
    const type = b.tags.building ?? "yes";
    if (SKIP_BUILDING.has(type)) continue;
    if (/metro/i.test(b.tags.name ?? "")) continue; // the station models stand there
    let ring = simplify([...b.ring, b.ring[0]], 0.15).slice(0, -1);
    if (ring.length < 3) continue;
    const area = Math.abs(signedArea(ring));
    if (area < 6) continue;
    // Counter-clockwise on screen (x east, z south): positive signed area here.
    if (signedArea(ring) < 0) ring = ring.reverse();
    const box = bbox(ring);
    if (box[2] - box[0] > 600 || box[3] - box[1] > 600) continue;
    const item = { id, tags: b.tags, type, ring, area, box, c: centroid(ring), procedural: false };
    bList.push(item);
    bGrid.add(item, box);
  }
  console.log(`kept ${bList.length} OSM buildings; ${elevated} raised roads (flyovers and ramps)`);

  const tilesOut = new Map(tiles.map((t) => [t.key, { ...t, buildings: [], roads: [], areas: [], trees: [] }]));
  const tileOf = (x, z) => `${Math.floor(x / TILE_M)}_${Math.floor(z / TILE_M)}`;

  // Height, kind and colour of each OSM building.
  for (const b of bList) {
    const r = mulberry32(hash(b.id));
    const levels = num(b.tags["building:levels"]);
    const height = num(b.tags.height);
    const near = mainRoadNear(b.c[0], b.c[1], 30 + Math.sqrt(b.area) / 2);
    const onMain = near && near.dist < 14;
    let floors;
    let kind = 0;
    let colour = pickIn(r, WALL);
    const t = b.type;
    if (HOUSE.has(t)) floors = 1 + Math.floor(Math.pow(r(), 1.3) * 3);
    else if (t === "apartments") floors = b.area > 900 ? 6 + Math.floor(r() * 8) : 4 + Math.floor(r() * 3);
    else if (SHED.has(t)) floors = 1;
    else if (INDUSTRIAL.has(t)) {
      floors = 1 + Math.floor(r() * 2);
      kind = 3;
      colour = pickIn(r, SHEDC);
    } else if (RELIGIOUS.has(t)) {
      floors = 1 + Math.floor(r() * 2);
      kind = 4;
      colour = pickIn(r, HOLY);
    } else if (INSTITUTION.has(t)) {
      floors = 2 + Math.floor(r() * 3);
      kind = 5;
      colour = pickIn(r, INST);
    } else if (COMMERCIAL.has(t)) {
      floors = 3 + Math.floor(r() * (b.area > 1500 ? 6 : 3));
      kind = floors >= 6 && r() < 0.7 ? 2 : 1;
    } else {
      // building=yes: by footprint, taller on main roads.
      const a = b.area;
      if (a < 40) floors = 1 + Math.floor(r() * 2);
      else if (a < 130) floors = 1 + Math.floor(Math.pow(r(), 1.2) * 3);
      else if (a < 350) floors = 2 + Math.floor(Math.pow(r(), 1.3) * 3);
      else if (a < 1000) floors = 2 + Math.floor(Math.pow(r(), 1.2) * 4);
      else if (a < 3000) floors = 3 + Math.floor(r() * 5);
      else floors = 2 + Math.floor(r() * 5);
      if (onMain) floors += r() < 0.5 ? 1 : 0;
      if (a > 600 && r() < 0.06) floors += 4 + Math.floor(r() * 6);
    }
    if (levels > 0 && levels < 80) floors = Math.round(levels);
    let h = floors * FLOOR_H + PARAPET;
    if (SHED.has(t)) h = 3.2;
    if (INDUSTRIAL.has(t)) h = floors * 4.5 + 0.5;
    if (RELIGIOUS.has(t)) h = 6 + floors * 2.5;
    if (height > 2 && height < 300) h = height;
    if (kind === 0 && onMain && b.area < 2500 && !HOUSE.has(t) && t !== "apartments" && r() < 0.85) kind = 1;
    if (kind <= 1 && floors >= 8 && r() < 0.45) kind = 2;
    if (kind === 2) colour = pickIn(r, OFFICE);
    const front = kind === 1 && near ? facingEdge(b.ring, near.seg) : -1;
    const tank = (kind === 0 || kind === 1) && floors <= 6 && b.area > 40 && b.area < 900 && r() < 0.55;
    b.out = { kind, colour, height: h, floors: Math.min(255, floors), front, flags: tank ? 2 : 0, ring: b.ring };
    const key = tileOf(b.c[0], b.c[1]);
    tilesOut.get(key)?.buildings.push(b.out);
  }

  // Procedural plots along streets where nothing is mapped.
  let generated = 0;
  const genGrid = new Grid(30);
  const clearOfRoads = (ring, margin) => {
    const box = bbox(ring);
    for (const s of roadGrid.query(box[0] - 30, box[1] - 30, box[2] + 30, box[3] + 30)) {
      if (distSegRing(s.a, s.b, ring) < s.road.width / 2 + margin) return false;
    }
    return true;
  };
  const clearOfBuildings = (ring, near) => {
    const box = bbox(ring);
    // Unmapped area only: no OSM building within `near` metres.
    for (const b of bGrid.query(box[0] - near, box[1] - near, box[2] + near, box[3] + near)) {
      if (b.box[0] - near < box[2] && b.box[2] + near > box[0] && b.box[1] - near < box[3] && b.box[3] + near > box[1]) return false;
    }
    for (const g of genGrid.query(...box)) if (ringsOverlap(ring, g.ring)) return false;
    return true;
  };
  for (const tile of tilesOut.values()) {
    const x0 = tile.tx * TILE_M;
    const z0 = tile.tz * TILE_M;
    const r = mulberry32(hash(`gen${tile.key}`));
    const tileRoads = new Set();
    for (const s of roadGrid.query(x0, z0, x0 + TILE_M, z0 + TILE_M)) tileRoads.add(s.road);
    for (const road of [...tileRoads].sort((a, b) => a.id - b.id)) {
      if (road.cls > 4 || road.bridge || road.raised) continue;
      const main = road.cls <= 2;
      for (const piece of clipLine(road.line, x0, z0, x0 + TILE_M, z0 + TILE_M)) {
        for (const side of [-1, 1]) {
          let carry = rr(r, 0, 6);
          for (let i = 1; i < piece.length; i++) {
            const [ax, az] = piece[i - 1];
            const [bx, bz] = piece[i];
            const len = Math.hypot(bx - ax, bz - az);
            if (len < 1) continue;
            const ux = (bx - ax) / len;
            const uz = (bz - az) / len;
            // Left of travel in this frame (x east, z south) is (uz, -ux).
            const nx = side * uz;
            const nz = -side * ux;
            let s = carry;
            while (s < len) {
              const lot = main ? rr(r, 8, 17) : rr(r, 7, 13);
              const mid = s + lot / 2;
              s += lot + (r() < 0.15 ? rr(r, 3, 9) : rr(r, 0.3, 1.6));
              if (mid > len - 2 || mid < 2) continue;
              const rows = main || r() < 0.55 ? 2 : 1;
              let back = road.width / 2 + (main ? 2.6 : 1.2) + rr(r, 0, 1.4);
              for (let row = 0; row < rows; row++) {
                const depth = main ? rr(r, 10, 20) : rr(r, 9, 15);
                const w = row === 0 ? lot : lot * rr(r, 0.8, 1.15);
                const cx = ax + ux * mid + nx * (back + depth / 2);
                const cz = az + uz * mid + nz * (back + depth / 2);
                back += depth + rr(r, 1.2, 4);
                if (Math.floor(cx / TILE_M) !== tile.tx || Math.floor(cz / TILE_M) !== tile.tz) break;
                const hw = w / 2;
                const hd = depth / 2;
                // Corners counter-clockwise (positive signed area in this frame).
                let ring = [
                  [cx - ux * hw - nx * hd, cz - uz * hw - nz * hd],
                  [cx + ux * hw - nx * hd, cz + uz * hw - nz * hd],
                  [cx + ux * hw + nx * hd, cz + uz * hw + nz * hd],
                  [cx - ux * hw + nx * hd, cz - uz * hw + nz * hd],
                ];
                if (signedArea(ring) < 0) ring = ring.reverse();
                if (inArea(cx, cz)) break;
                if (!clearOfRoads(ring, 0.8)) break;
                if (!clearOfBuildings(ring, 18)) break;
                const commercial = row === 0 && (main || (road.cls === 3 && r() < 0.5)) && r() < 0.85;
                let floors = main ? 2 + Math.floor(Math.pow(r(), 1.4) * 4) : 1 + Math.floor(Math.pow(r(), 1.3) * 3);
                if (row > 0) floors = 1 + Math.floor(Math.pow(r(), 1.2) * 4);
                const kind = commercial ? 1 : 0;
                // The front faces the street: the edge on the road side.
                const front = commercial ? facingEdge(ring, { a: [ax, az], b: [bx, bz] }) : -1;
                const tank = floors <= 5 && r() < 0.6;
                const item = { ring, out: { kind, colour: pickIn(r, WALL), height: floors * FLOOR_H + PARAPET, floors, front, flags: 1 | (tank ? 2 : 0), ring } };
                genGrid.add(item, bbox(ring));
                tile.buildings.push(item.out);
                generated++;
                if (row === 0 && depth > 15) break;
              }
            }
            carry = s - len;
          }
        }
      }
    }
  }
  console.log(`generated ${generated} plots on unmapped streets`);

  // Roads and areas clipped per tile; trees.
  const isBuilt = (x, z, pad) => {
    for (const b of bGrid.query(x - pad, z - pad, x + pad, z + pad)) if (pointInRing(x, z, b.ring) || (pad > 0 && b.ring.some((p, i) => distPointSeg(x, z, p[0], p[1], b.ring[(i + 1) % b.ring.length][0], b.ring[(i + 1) % b.ring.length][1]) < pad))) return true;
    for (const g of genGrid.query(x - pad, z - pad, x + pad, z + pad)) if (pointInRing(x, z, g.ring) || g.ring.some((p, i) => distPointSeg(x, z, p[0], p[1], g.ring[(i + 1) % 4][0], g.ring[(i + 1) % 4][1]) < pad)) return true;
    return false;
  };
  const onRoad = (x, z) => {
    for (const s of roadGrid.query(x - 20, z - 20, x + 20, z + 20)) {
      // Raised roads: keep crowns clear of the deck and barriers too.
      const clear = s.road.width / 2 + (s.road.raised ? 7 : 0.6);
      if (distPointSeg(x, z, s.a[0], s.a[1], s.b[0], s.b[1]) < clear) return true;
    }
    return false;
  };
  let treeCount = 0;
  for (const tile of tilesOut.values()) {
    const x0 = tile.tx * TILE_M;
    const z0 = tile.tz * TILE_M;
    const x1 = x0 + TILE_M;
    const z1 = z0 + TILE_M;
    const r = mulberry32(hash(`trees${tile.key}`));
    const seen = new Set();
    for (const s of roadGrid.query(x0, z0, x1, z1)) {
      const road = s.road;
      if (seen.has(road)) continue;
      seen.add(road);
      for (const piece of clipLine(road.line, x0, z0, x1, z1)) {
        tile.roads.push({ cls: road.cls, width: road.width, bridge: road.bridge, layer: road.layer, line: piece });
        // Street trees along the kerbs of ordinary streets and main roads.
        if (road.cls > 4 || road.bridge || road.raised) continue;
        const every = road.cls <= 2 ? 16 : 22;
        for (let i = 1; i < piece.length; i++) {
          const [ax, az] = piece[i - 1];
          const [bx, bz] = piece[i];
          const len = Math.hypot(bx - ax, bz - az);
          for (let s2 = rr(r, 0, every); s2 < len; s2 += every * rr(r, 0.6, 1.5)) {
            if (r() > (road.cls <= 2 ? 0.55 : 0.35)) continue;
            const side = r() < 0.5 ? -1 : 1;
            const off = road.width / 2 + rr(r, 0.9, 2.2);
            const x = ax + ((bx - ax) * s2) / len + (side * (bz - az) * off) / len;
            const z = az + ((bz - az) * s2) / len - (side * (bx - ax) * off) / len;
            if (x < x0 || x >= x1 || z < z0 || z >= z1) continue;
            if (isBuilt(x, z, 1.2) || onRoad(x, z)) continue;
            tile.trees.push({ type: r() < 0.25 ? 1 : r() < 0.2 ? 2 : 0, x, z });
          }
        }
      }
    }
    for (const a of areaGrid.query(x0, z0, x1, z1)) {
      const ring = clipRing(a.ring, x0, z0, x1, z1);
      if (ring.length < 3 || Math.abs(signedArea(ring)) < 30) continue;
      const simple = simplify([...ring, ring[0]], 0.5).slice(0, -1);
      if (simple.length < 3) continue;
      tile.areas.push({ kind: a.kind, ring: signedArea(simple) < 0 ? simple.reverse() : simple });
      if (a.kind !== 1) continue;
      // Parks: trees scattered over the clipped area, about one per 140 m².
      const box = bbox(ring);
      const n = Math.min(900, Math.floor(Math.abs(signedArea(ring)) / 140));
      for (let i = 0; i < n; i++) {
        const x = rr(r, box[0], box[2]);
        const z = rr(r, box[1], box[3]);
        if (!pointInRing(x, z, ring) || isBuilt(x, z, 1) || onRoad(x, z)) continue;
        tile.trees.push({ type: r() < 0.3 ? 2 : r() < 0.2 ? 1 : 0, x, z });
      }
    }
    for (const [, p] of trees) {
      if (p[0] >= x0 && p[0] < x1 && p[1] >= z0 && p[1] < z1) tile.trees.push({ type: 2, x: p[0], z: p[1] });
    }
    treeCount += tile.trees.length;
  }
  console.log(`${treeCount} trees`);

  // Write.
  await rm(path.join(OUT, "tiles"), { recursive: true, force: true });
  await mkdir(path.join(OUT, "tiles"), { recursive: true });
  const index = [];
  let total = 0;
  let largest = 0;
  for (const tile of [...tilesOut.values()].sort((a, b) => a.tz - b.tz || a.tx - b.tx)) {
    if (!tileSet.has(tile.key)) continue;
    const buf = encode(tile);
    const gz = gzipSync(buf, { level: 9 });
    await writeFile(path.join(OUT, "tiles", `${tile.key}.bin`), gz);
    total += gz.length;
    largest = Math.max(largest, gz.length);
    index.push([tile.tx, tile.tz, tile.buildings.length]);
  }
  await writeFile(
    path.join(OUT, "index.json"),
    JSON.stringify({
      meta: {
        source: "OpenStreetMap",
        attribution: "© OpenStreetMap contributors (ODbL 1.0)",
        snapshot: "2026-10-05",
        tileM: TILE_M,
        note: "Footprints from OpenStreetMap; floors estimated. Plots flagged procedural fill streets with no buildings mapped.",
      },
      palette: PALETTE,
      tiles: index,
    }),
  );
  console.log(`wrote ${index.length} tiles, ${(total / 1e6).toFixed(1)} MB (largest ${(largest / 1e3).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

/** The ring edge whose outward side faces the road segment (closest midpoint, facing it). */
function facingEdge(ring, seg) {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 4) continue;
    const mx = (p[0] + q[0]) / 2;
    const mz = (p[1] + q[1]) / 2;
    // Outward normal of a positive-area ring in this frame: (dz, -dx).
    const nx = (q[1] - p[1]) / len;
    const nz = -(q[0] - p[0]) / len;
    const d = distPointSeg(mx, mz, seg.a[0], seg.a[1], seg.b[0], seg.b[1]);
    const ahead = distPointSeg(mx + nx * 2, mz + nz * 2, seg.a[0], seg.a[1], seg.b[0], seg.b[1]);
    if (ahead >= d) continue;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

function hash(s) {
  const str = String(s);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function encode(tile) {
  const ox = tile.tx * TILE_M;
  const oz = tile.tz * TILE_M;
  let size = 4 + 4 + 16;
  for (const b of tile.buildings) size += 10 + b.ring.length * 4;
  for (const r of tile.roads) size += 6 + r.line.length * 4 + (raised(r) ? r.line.length : 0);
  for (const a of tile.areas) size += 4 + a.ring.length * 4;
  size += tile.trees.length * 5;
  const buf = Buffer.alloc(size);
  let o = 0;
  const u8 = (v) => (o = buf.writeUInt8(v, o));
  const u16 = (v) => (o = buf.writeUInt16LE(v, o));
  const i16 = (v) => (o = buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), o));
  const u32 = (v) => (o = buf.writeUInt32LE(v, o));
  const pts = (list) => {
    for (const [x, z] of list) {
      i16((x - ox) * 10);
      i16((z - oz) * 10);
    }
  };
  u32(MAGIC);
  i16(tile.tx);
  i16(tile.tz);
  u32(tile.buildings.length);
  u32(tile.roads.length);
  u32(tile.areas.length);
  u32(tile.trees.length);
  for (const b of tile.buildings) {
    u8(b.kind);
    u8(b.colour);
    u16(Math.min(65535, Math.round(b.height * 10)));
    u16(b.front < 0 ? 0xffff : b.front);
    u8(b.flags);
    u8(b.floors);
    u16(b.ring.length);
    pts(b.ring);
  }
  for (const r of tile.roads) {
    u8(r.cls);
    u8(Math.min(255, Math.round(r.width * 4)));
    const hasH = raised(r);
    u8((r.bridge ? 1 : 0) | (hasH ? 2 : 0));
    u8(r.layer);
    u16(r.line.length);
    pts(r.line);
    if (hasH) for (const p of r.line) u8(Math.max(0, Math.min(255, Math.round((p[2] ?? 0) * 10))));
  }
  for (const a of tile.areas) {
    u8(a.kind);
    u8(0);
    u16(a.ring.length);
    pts(a.ring);
  }
  for (const t of tile.trees) {
    u8(t.type);
    i16((t.x - ox) * 10);
    i16((t.z - oz) * 10);
  }
  if (o !== size) throw new Error(`encode size ${o} != ${size}`);
  return buf;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/** A road piece with any point raised above the ground (heights stored per point). */
function raised(r) {
  return r.line.some((p) => (p[2] ?? 0) > 0.05);
}

/** Deck height (m, road surface) of a flyover on OSM layer n. */
const DECK = (layer) => 7.5 + 6 * (Math.max(1, layer) - 1);
/** Approach ramps fall at this grade from a flyover's ends. */
const RAMP_GRADE = 0.04;

/**
 * Height of every point of every road, keyed by road id (only roads with a
 * raised point are returned). A bridge counts as a flyover when it crosses
 * another road, or joins a bridge that is one (the loops of an interchange);
 * other bridges (over canals) stay on the ground. Flyover points sit at the
 * deck height of their layer; from there the connected roads ramp down at
 * RAMP_GRADE until they meet the ground.
 */
function roadHeights(roads) {
  const key = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const isBridge = (t) => t.bridge && t.bridge !== "no" && !(t.tunnel && t.tunnel !== "no");
  const layerOf = (t) => Math.max(0, Math.min(5, num(t.layer) || 0));
  // Ground road segments, for the "does this bridge cross a road" test.
  const grid = new Grid(50);
  for (const [id, r] of roads) {
    if (isBridge(r.tags)) continue;
    for (let i = 1; i < r.line.length; i++) grid.add({ id, a: r.line[i - 1], b: r.line[i] }, bbox([r.line[i - 1], r.line[i]]));
  }
  const crossesRoad = (r) => {
    for (let i = 1; i < r.line.length; i++) {
      const a = r.line[i - 1];
      const b = r.line[i];
      for (const s of grid.query(...bbox([a, b]))) if (segsCross(a, b, s.a, s.b)) return true;
    }
    return false;
  };
  const bridges = [...roads].filter(([, r]) => isBridge(r.tags));
  const flyover = new Set(bridges.filter(([, r]) => crossesRoad(r)).map(([id]) => id));
  // Spread to bridges joined to a flyover (interchange loops, multi-span decks).
  const byVertex = new Map();
  for (const [id, r] of bridges) {
    for (const p of [r.line[0], r.line[r.line.length - 1]]) {
      const k = key(p);
      if (!byVertex.has(k)) byVertex.set(k, []);
      byVertex.get(k).push(id);
    }
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const [id, r] of bridges) {
      if (flyover.has(id)) continue;
      if ([r.line[0], r.line[r.line.length - 1]].some((p) => (byVertex.get(key(p)) ?? []).some((o) => flyover.has(o)))) {
        flyover.add(id);
        grew = true;
      }
    }
  }
  // Heights: fixed on flyovers, falling away along every connected road.
  const h = new Map(); // vertex key -> height
  const adj = new Map(); // vertex key -> [{ k, len }]
  const link = (a, b) => {
    const ka = key(a);
    const kb = key(b);
    const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push({ k: kb, len });
    adj.get(kb).push({ k: ka, len });
  };
  const queue = [];
  for (const [id, r] of roads) {
    for (let i = 1; i < r.line.length; i++) link(r.line[i - 1], r.line[i]);
    if (!flyover.has(id)) continue;
    const H = DECK(layerOf(r.tags));
    for (const p of r.line) {
      const k = key(p);
      if ((h.get(k) ?? 0) < H) {
        h.set(k, H);
        queue.push(k);
      }
    }
  }
  const fixed = new Set(h.keys());
  // Highest first: each vertex takes the best height any flyover can give it down a ramp.
  queue.sort((a, b) => h.get(a) - h.get(b));
  while (queue.length) {
    const k = queue.pop();
    const hk = h.get(k);
    for (const { k: n, len } of adj.get(k) ?? []) {
      if (fixed.has(n)) continue;
      const v = hk - RAMP_GRADE * len;
      if (v <= 0.05 || v <= (h.get(n) ?? 0)) continue;
      h.set(n, v);
      // Keep the queue roughly ordered (insert by height).
      let lo = 0;
      let hi = queue.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (h.get(queue[mid]) < v) lo = mid + 1;
        else hi = mid;
      }
      queue.splice(lo, 0, n);
    }
  }
  const out = new Map();
  for (const [id, r] of roads) {
    const hs = r.line.map((p) => h.get(key(p)) ?? 0);
    if (hs.some((v) => v > 0.05)) out.set(id, hs);
  }
  console.log(`flyovers: ${flyover.size} of ${bridges.length} bridges`);
  return out;
}
