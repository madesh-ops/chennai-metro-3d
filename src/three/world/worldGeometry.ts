import { BufferAttribute, BufferGeometry, Color, Matrix4, Quaternion, ShapeUtils, Vector2, Vector3 } from "three";
import { mulberry32, type Rng } from "../../utils/random.ts";
import { TILE_M, type TileArea, type TileBuilding, type TileData, type TileRoad, type TileTree } from "./tileFormat.ts";

/**
 * Geometry for one world tile: extruded building footprints (one merged
 * mesh, facade drawn by the footprint building shader), a flat layer of
 * water, parks, footpaths, roads and lane markings (one mesh, painted in
 * order), and instance transforms for trees, rooftop tanks and shop signs.
 * Pure: no WebGL, so it is unit-tested and could move to a worker.
 */

/** Wall base below ground, so footprints on a slope never show a gap. */
const WALL_FOOT = -0.6;
const FLAT_Y = 0.02;

export interface TileGeometry {
  /** Buildings in quadrants of the tile (centre of each), so far ones can skip the shadow pass and be culled. */
  buildings: { cx: number; cz: number; geometry: BufferGeometry }[];
  flat: BufferGeometry | null;
  /** Instance matrices (16 floats each) and colours (3 each). */
  trunks: InstanceList;
  crowns: InstanceList;
  palms: InstanceList;
  tanks: InstanceList;
  /** Sign boards; `cells` holds each board's atlas cell. */
  signs: InstanceList & { cells: number[] };
  /** Buildings kept (after the keep-out test). */
  kept: TileBuilding[];
}

export interface InstanceList {
  matrices: number[];
  colors: number[];
}

/** Areas kept clear: route corridor, stations, landmarks. Returns true if (x, z) with radius r is blocked. */
export type KeepOut = (x: number, z: number, r: number) => boolean;

const ROAD_COLOUR = ["#43464b", "#46494e", "#4b4e52", "#515457", "#5a5c5e", "#626362", "#8a857a"];
const FOOTPATH = "#a49e92";
const MARKING = "#d8d5cc";
const AREA_COLOUR = ["#3f6c78", "#6f8f4f", "#7f9d58"];
const FOLIAGE = ["#4f7a3e", "#5a8444", "#456f38", "#68904a", "#3f6634"];

/** Shopfront bay (matches the shader's sign band) and board size. */
export const SHOP_BAY = 4.2;
const SIGN_W = 3.7;
const SIGN_H = 0.7;
const SIGN_Y = 2.7;

class Flat {
  pos: number[] = [];
  col: number[] = [];
  private c = new Color();
  tri(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, colour: string, y = FLAT_Y) {
    // Face up (+y): in this frame (x east, z south) that is clockwise in (x, z).
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (cross > 0) this.pos.push(ax, y, az, cx, y, cz, bx, y, bz);
    else this.pos.push(ax, y, az, bx, y, bz, cx, y, cz);
    this.c.set(colour);
    for (let i = 0; i < 3; i++) this.col.push(this.c.r, this.c.g, this.c.b);
  }
  quad(a: [number, number], b: [number, number], c: [number, number], d: [number, number], colour: string) {
    this.tri(a[0], a[1], b[0], b[1], c[0], c[1], colour);
    this.tri(a[0], a[1], c[0], c[1], d[0], d[1], colour);
  }
  polygon(ring: Float32Array, colour: string) {
    const pts: Vector2[] = [];
    for (let i = 0; i < ring.length; i += 2) pts.push(new Vector2(ring[i], ring[i + 1]));
    for (const [a, b, c] of ShapeUtils.triangulateShape(pts, [])) this.tri(pts[a].x, pts[a].y, pts[b].x, pts[b].y, pts[c].x, pts[c].y, colour);
  }
  geometry(): BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    const n = new Float32Array(this.pos.length);
    for (let i = 1; i < n.length; i += 3) n[i] = 1;
    g.setAttribute("normal", new BufferAttribute(n, 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** A ribbon of half-width `half` either side of a polyline (mitred joins, capped ends). */
function ribbon(flat: Flat, line: Float32Array, half: number, colour: string, inner = 0) {
  const n = line.length / 2;
  if (n < 2) return;
  const off: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    let nx = 0;
    let nz = 0;
    const seg = (a: number, b: number) => {
      const dx = line[b * 2] - line[a * 2];
      const dz = line[b * 2 + 1] - line[a * 2 + 1];
      const l = Math.hypot(dx, dz) || 1;
      return [dz / l, -dx / l] as const;
    };
    const s0 = i > 0 ? seg(i - 1, i) : null;
    const s1 = i < n - 1 ? seg(i, i + 1) : null;
    if (s0 && s1) {
      nx = s0[0] + s1[0];
      nz = s0[1] + s1[1];
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      const k = 1 / Math.max(0.35, nx * s0[0] + nz * s0[1]);
      nx *= k;
      nz *= k;
    } else {
      [nx, nz] = (s0 ?? s1)!;
    }
    off.push([nx, nz]);
  }
  for (let i = 1; i < n; i++) {
    const a = i - 1;
    const b = i;
    const ax = line[a * 2];
    const az = line[a * 2 + 1];
    const bx = line[b * 2];
    const bz = line[b * 2 + 1];
    for (const side of inner > 0 ? [-1, 1] : [0]) {
      const lo = inner > 0 ? inner : -half;
      const hi = half;
      const s = side === 0 ? 1 : side;
      const pa0: [number, number] = [ax + off[a][0] * lo * s, az + off[a][1] * lo * s];
      const pa1: [number, number] = [ax + off[a][0] * hi * s, az + off[a][1] * hi * s];
      const pb0: [number, number] = [bx + off[b][0] * lo * s, bz + off[b][1] * lo * s];
      const pb1: [number, number] = [bx + off[b][0] * hi * s, bz + off[b][1] * hi * s];
      flat.quad(pa0, pa1, pb1, pb0, colour);
    }
  }
}

/** A filled disc (junction / road end patch). */
function disc(flat: Flat, x: number, z: number, r: number, colour: string) {
  const k = 10;
  for (let i = 0; i < k; i++) {
    const a0 = (i / k) * Math.PI * 2;
    const a1 = ((i + 1) / k) * Math.PI * 2;
    flat.tri(x, z, x + Math.cos(a0) * r, z + Math.sin(a0) * r, x + Math.cos(a1) * r, z + Math.sin(a1) * r, colour);
  }
}

/** Dashed centre line along a polyline. */
function dashes(flat: Flat, line: Float32Array, dash: number, gap: number, half: number, colour: string) {
  let phase = 0;
  for (let i = 2; i < line.length; i += 2) {
    const ax = line[i - 2];
    const az = line[i - 1];
    const dx = line[i] - ax;
    const dz = line[i + 1] - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const ux = dx / len;
    const uz = dz / len;
    let s = phase;
    while (s < len) {
      const e = Math.min(len, s + dash);
      if (e > s + 0.3) {
        const p0: [number, number] = [ax + ux * s + uz * half, az + uz * s - ux * half];
        const p1: [number, number] = [ax + ux * e + uz * half, az + uz * e - ux * half];
        const p2: [number, number] = [ax + ux * e - uz * half, az + uz * e + ux * half];
        const p3: [number, number] = [ax + ux * s - uz * half, az + uz * s + ux * half];
        flat.quad(p0, p1, p2, p3, colour);
      }
      s += dash + gap;
    }
    phase = s - len;
  }
}

export function buildFlat(roads: TileRoad[], areas: TileArea[]): BufferGeometry | null {
  const flat = new Flat();
  // Painted bottom up: water and parks, footpaths, roads (minor first), markings.
  for (const a of areas) flat.polygon(a.ring, AREA_COLOUR[a.kind] ?? AREA_COLOUR[1]);
  for (const r of roads) if (r.cls <= 3 && !r.bridge) ribbon(flat, r.line, r.width / 2 + 2.2, FOOTPATH, r.width / 2);
  const order = [...roads].sort((a, b) => b.cls - a.cls || Number(a.bridge) - Number(b.bridge));
  for (const r of order) {
    const colour = ROAD_COLOUR[r.cls] ?? ROAD_COLOUR[4];
    ribbon(flat, r.line, r.width / 2, colour);
    const n = r.line.length;
    disc(flat, r.line[0], r.line[1], r.width / 2, colour);
    disc(flat, r.line[n - 2], r.line[n - 1], r.width / 2, colour);
  }
  for (const r of roads) if (r.cls <= 2 && r.width >= 9) dashes(flat, r.line, 3, 5, 0.08, MARKING);
  return flat.geometry();
}

/* ------------------------------------------------------------------ */
/* Buildings                                                            */
/* ------------------------------------------------------------------ */

function ringArea(ring: Float32Array) {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  return a / 2;
}

function pointInRing(x: number, z: number, ring: Float32Array) {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2];
    const zi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const zj = ring[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Is a building in a keep-out zone (any corner or its centre)? */
export function blocked(b: TileBuilding, keep: KeepOut): boolean {
  const r = b.ring;
  let cx = 0;
  let cz = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    if (keep(r[i * 2], r[i * 2 + 1], 0.5)) return true;
    cx += r[i * 2];
    cz += r[i * 2 + 1];
  }
  return keep(cx / n, cz / n, 0.5);
}

interface BuildingArrays {
  pos: number[];
  nor: number[];
  col: number[];
  facade: number[];
  kind: number[];
  seed: number[];
}

function extrude(out: BuildingArrays, b: TileBuilding, colour: Color, seed: number) {
  const r = b.ring;
  const n = r.length / 2;
  const h = b.height;
  // The shader expects positive signed area (outward normal of edge p→q is (dz, -dx)).
  const flip = ringArea(r) < 0;
  const at = (i: number) => {
    const k = flip ? n - 1 - i : i;
    return [r[k * 2], r[k * 2 + 1]] as const;
  };
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, fu: number, wall: number) => {
    out.pos.push(x, y, z);
    out.nor.push(nx, ny, nz);
    out.col.push(colour.r, colour.g, colour.b);
    out.facade.push(fu, y, wall, h);
    out.kind.push(b.kind);
    out.seed.push(seed);
  };
  for (let i = 0; i < n; i++) {
    const [px, pz] = at(i);
    const [qx, qz] = at((i + 1) % n);
    const len = Math.hypot(qx - px, qz - pz);
    if (len < 0.05) continue;
    const nx = (qz - pz) / len;
    const nz = -(qx - px) / len;
    // Two outward-facing triangles: (p0, q1, q0) and (p0, p1, q1).
    push(px, WALL_FOOT, pz, nx, 0, nz, 0, len);
    push(qx, h, qz, nx, 0, nz, len, len);
    push(qx, WALL_FOOT, qz, nx, 0, nz, len, len);
    push(px, WALL_FOOT, pz, nx, 0, nz, 0, len);
    push(px, h, pz, nx, 0, nz, 0, len);
    push(qx, h, qz, nx, 0, nz, len, len);
  }
  // Flat roof.
  const pts: Vector2[] = [];
  for (let i = 0; i < n; i++) pts.push(new Vector2(r[i * 2], r[i * 2 + 1]));
  for (const [a, b2, c] of ShapeUtils.triangulateShape(pts, [])) {
    const A = pts[a];
    let B = pts[b2];
    let C = pts[c];
    // Face up: clockwise in (x, z) here.
    if ((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) > 0) [B, C] = [C, B];
    for (const p of [A, B, C]) push(p.x, h, p.y, 0, 1, 0, 0, 0);
  }
}

export function buildBuildings(list: TileBuilding[], palette: Color[], seedBase: number): BufferGeometry | null {
  const out: BuildingArrays = { pos: [], nor: [], col: [], facade: [], kind: [], seed: [] };
  list.forEach((b, i) => extrude(out, b, palette[b.colour] ?? palette[0], ((seedBase * 131 + i * 7919) % 997) / 997));
  if (!out.pos.length) return null;
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(out.pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(out.nor), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(out.col), 3));
  g.setAttribute("aFacade", new BufferAttribute(new Float32Array(out.facade), 4));
  g.setAttribute("aKind", new BufferAttribute(new Float32Array(out.kind), 1));
  g.setAttribute("aSeed", new BufferAttribute(new Float32Array(out.seed), 1));
  g.computeBoundingSphere();
  return g;
}

/* ------------------------------------------------------------------ */
/* Instances                                                            */
/* ------------------------------------------------------------------ */

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const _c = new Color();

function add(list: InstanceList, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, colour?: string) {
  _q.setFromAxisAngle(_up, yaw);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  for (let i = 0; i < 16; i++) list.matrices.push(_m.elements[i]);
  if (colour) {
    _c.set(colour);
    list.colors.push(_c.r, _c.g, _c.b);
  }
}

const pick = <T,>(r: Rng, a: readonly T[]) => a[Math.floor(r() * a.length)];

function addTree(t: TileTree, r: Rng, out: Pick<TileGeometry, "trunks" | "crowns" | "palms">) {
  if (t.type === 1) {
    const h = 8 + r() * 5;
    add(out.trunks, t.x, 0, t.z, 0, 0.7, h, 0.7, "#7b6a55");
    add(out.palms, t.x, h, t.z, r() * Math.PI * 2, 0.85 + r() * 0.3, 0.85 + r() * 0.25, 0.85 + r() * 0.3, pick(r, FOLIAGE));
    return;
  }
  const wide = t.type === 2 || r() > 0.55;
  const h = wide ? 4.5 + r() * 2.5 : 3 + r() * 1.5;
  const rx = wide ? 4 + r() * 3 : 2.4 + r() * 1.2;
  const ry = wide ? 2.4 + r() : 2.6 + r() * 1.2;
  add(out.trunks, t.x, 0, t.z, 0, wide ? 1.4 : 1, h + ry * 0.3, wide ? 1.4 : 1, "#6f5e4b");
  add(out.crowns, t.x, h + ry * 0.75, t.z, r() * Math.PI, rx, ry, rx * (0.85 + r() * 0.25), pick(r, FOLIAGE));
}

/** A point inside the roof for the water tank: centroid if inside, else a roof vertex nudged in. */
function roofPoint(b: TileBuilding, r: Rng): [number, number] {
  const ring = b.ring;
  const n = ring.length / 2;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += ring[i * 2];
    cz += ring[i * 2 + 1];
  }
  cx /= n;
  cz /= n;
  for (let k = 0; k < 4; k++) {
    const j = Math.floor(r() * n);
    const t = 0.25 + r() * 0.35;
    const x = cx + (ring[j * 2] - cx) * t;
    const z = cz + (ring[j * 2 + 1] - cz) * t;
    if (pointInRing(x, z, ring)) return [x, z];
  }
  return [cx, cz];
}

/** Boards along the road-facing edge of a shop building. */
function addSigns(b: TileBuilding, r: Rng, signs: TileGeometry["signs"], cells: number) {
  if (b.front < 0) return;
  const ring = b.ring;
  const n = ring.length / 2;
  const i = b.front % n;
  const j = (i + 1) % n;
  const px = ring[i * 2];
  const pz = ring[i * 2 + 1];
  const dx = ring[j * 2] - px;
  const dz = ring[j * 2 + 1] - pz;
  const len = Math.hypot(dx, dz);
  const bays = Math.floor((len - 0.6) / SHOP_BAY);
  if (bays < 1) return;
  const ux = dx / len;
  const uz = dz / len;
  // Outward normal (dz, -dx); flip if the ring winds the other way.
  const s = ringArea(ring) < 0 ? -1 : 1;
  const nx = uz * s;
  const nz = -ux * s;
  const yaw = Math.atan2(nx, nz);
  const single = r() < 0.35 ? Math.floor(r() * cells) : -1;
  const start = (len - bays * SHOP_BAY) / 2;
  for (let k = 0; k < bays; k++) {
    if (r() > 0.9) continue;
    const along = start + (k + 0.5) * SHOP_BAY;
    add(signs, px + ux * along + nx * 0.06, SIGN_Y, pz + uz * along + nz * 0.06, yaw, SIGN_W, SIGN_H, 1);
    signs.cells.push(single >= 0 ? single : Math.floor(r() * cells));
  }
}

export interface BuildOptions {
  palette: Color[];
  keep: KeepOut;
  /** Number of cells in the shop-sign atlas (0: no signs). */
  signCells: number;
  /** 0..1: share of trees kept (lower quality settings). */
  treeDensity: number;
}

export function buildTileGeometry(tile: TileData, opts: BuildOptions): TileGeometry {
  const seed = (tile.tx * 7349 + tile.tz * 9157) >>> 0;
  const r = mulberry32(seed);
  const kept = tile.buildings.filter((b) => !blocked(b, opts.keep));
  // Quadrants by footprint centre.
  const half = TILE_M / 2;
  const x0 = tile.tx * TILE_M;
  const z0 = tile.tz * TILE_M;
  const quads: TileBuilding[][] = [[], [], [], []];
  for (const b of kept) {
    const r0 = b.ring;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < r0.length; i += 2) {
      cx += r0[i];
      cz += r0[i + 1];
    }
    cx /= r0.length / 2;
    cz /= r0.length / 2;
    quads[(cx - x0 >= half ? 1 : 0) + (cz - z0 >= half ? 2 : 0)].push(b);
  }
  const buildings: TileGeometry["buildings"] = [];
  quads.forEach((list, q) => {
    const geometry = buildBuildings(list, opts.palette, seed + q);
    if (geometry) buildings.push({ cx: x0 + (q & 1 ? 1.5 : 0.5) * half, cz: z0 + (q & 2 ? 1.5 : 0.5) * half, geometry });
  });
  const out: TileGeometry = {
    buildings,
    flat: buildFlat(tile.roads, tile.areas),
    trunks: { matrices: [], colors: [] },
    crowns: { matrices: [], colors: [] },
    palms: { matrices: [], colors: [] },
    tanks: { matrices: [], colors: [] },
    signs: { matrices: [], colors: [], cells: [] },
    kept,
  };
  for (const b of kept) {
    if (b.flags & 2) {
      const [x, z] = roofPoint(b, r);
      add(out.tanks, x, b.height, z, 0, 1, 1, 1);
    }
    if (b.kind === 1 && opts.signCells > 0) addSigns(b, r, out.signs, opts.signCells);
  }
  for (const t of tile.trees) {
    if (r() > opts.treeDensity) continue;
    if (opts.keep(t.x, t.z, 3)) continue;
    addTree(t, r, out);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Packed form: plain typed arrays, built in a worker and transferred   */
/* ------------------------------------------------------------------ */

export interface PackedGeometry {
  attrs: { name: string; array: Float32Array; size: number }[];
}

export interface PackedInstances {
  matrices: Float32Array;
  colors: Float32Array;
}

export interface PackedTile {
  key: string;
  flat: PackedGeometry | null;
  buildings: { cx: number; cz: number; geometry: PackedGeometry }[];
  trunks: PackedInstances;
  crowns: PackedInstances;
  palms: PackedInstances;
  tanks: PackedInstances;
  signs: PackedInstances & { cells: Float32Array };
  /** Kept footprints for the camera roof lookup: rings concatenated, ring i spans offsets[i]..offsets[i+1]. */
  heights: { rings: Float32Array; offsets: Uint32Array; h: Float32Array };
}

function packGeometry(g: BufferGeometry): PackedGeometry {
  return {
    attrs: Object.entries(g.attributes).map(([name, a]) => ({ name, array: a.array as Float32Array, size: a.itemSize })),
  };
}

const packInstances = (l: InstanceList): PackedInstances => ({ matrices: new Float32Array(l.matrices), colors: new Float32Array(l.colors) });

export function packTile(key: string, tile: TileData, opts: BuildOptions): PackedTile {
  const g = buildTileGeometry(tile, opts);
  let total = 0;
  for (const b of g.kept) total += b.ring.length;
  const rings = new Float32Array(total);
  const offsets = new Uint32Array(g.kept.length + 1);
  const h = new Float32Array(g.kept.length);
  let o = 0;
  g.kept.forEach((b, i) => {
    rings.set(b.ring, o);
    offsets[i] = o;
    o += b.ring.length;
    h[i] = b.height;
  });
  offsets[g.kept.length] = o;
  return {
    key,
    flat: g.flat ? packGeometry(g.flat) : null,
    buildings: g.buildings.map((b) => ({ cx: b.cx, cz: b.cz, geometry: packGeometry(b.geometry) })),
    trunks: packInstances(g.trunks),
    crowns: packInstances(g.crowns),
    palms: packInstances(g.palms),
    tanks: packInstances(g.tanks),
    signs: { ...packInstances(g.signs), cells: new Float32Array(g.signs.cells) },
    heights: { rings, offsets, h },
  };
}

/** Every buffer in a packed tile, for postMessage's transfer list. */
export function packedBuffers(p: PackedTile): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const geo = (g: PackedGeometry | null) => g?.attrs.forEach((a) => out.push(a.array.buffer as ArrayBuffer));
  geo(p.flat);
  p.buildings.forEach((b) => geo(b.geometry));
  for (const l of [p.trunks, p.crowns, p.palms, p.tanks, p.signs]) out.push(l.matrices.buffer as ArrayBuffer, l.colors.buffer as ArrayBuffer);
  out.push(p.signs.cells.buffer as ArrayBuffer, p.heights.rings.buffer as ArrayBuffer, p.heights.offsets.buffer as ArrayBuffer, p.heights.h.buffer as ArrayBuffer);
  return [...new Set(out)];
}

/** Rebuild a BufferGeometry from its packed arrays (main thread). */
export function unpackGeometry(p: PackedGeometry): BufferGeometry {
  const g = new BufferGeometry();
  for (const a of p.attrs) g.setAttribute(a.name, new BufferAttribute(a.array, a.size));
  g.computeBoundingSphere();
  return g;
}
