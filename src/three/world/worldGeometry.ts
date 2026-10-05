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
  /** Flyover and ramp structures, and their crash barriers (chevron uvs). */
  decks: BufferGeometry | null;
  barriers: BufferGeometry | null;
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
  /** Where the scene models a flyover itself (OSM's is then not built). */
  ownFlyover?: (x: number, z: number) => boolean;
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
  // Raised roads become structures, except where the scene draws its own flyover.
  const { ground, raised } = splitRaised(tile.roads);
  const own = opts.ownFlyover ?? (() => false);
  const built = raised.filter((r) => {
    const m = Math.floor(r.line.length / 4) * 2;
    return !own(r.line[m], r.line[m + 1]);
  });
  const structures = buildRaised(built, ground);
  const out: TileGeometry = {
    buildings,
    decks: structures.deck,
    barriers: structures.barriers,
    flat: buildFlat(ground, tile.areas),
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
  decks: PackedGeometry | null;
  barriers: PackedGeometry | null;
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
    decks: g.decks ? packGeometry(g.decks) : null,
    barriers: g.barriers ? packGeometry(g.barriers) : null,
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
  geo(p.decks);
  geo(p.barriers);
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

/* ------------------------------------------------------------------ */
/* Flyovers and ramps                                                   */
/* ------------------------------------------------------------------ */

/** Points above this (m) are on a structure; below, the road is painted on the ground. */
const RAISED = 0.3;
/** From this height the deck stands on piers; below it the ramp is a walled embankment. */
const ON_PIERS = 4.5;
const DECK_DEPTH = 1.3;
const SHOULDER = 0.6;
const BARRIER_H = 1.0;
const BARRIER_T = 0.4;
const PIER_SPACING = 30;
const CONCRETE = "#b9b6ae";
const CONCRETE_DARK = "#9d9a93";
const RE_WALL = "#c8c3b8";

/** Split roads into ground pieces (painted flat) and raised runs (built as structures). */
export function splitRaised(roads: TileRoad[]): { ground: TileRoad[]; raised: TileRoad[] } {
  const ground: TileRoad[] = [];
  const raised: TileRoad[] = [];
  for (const r of roads) {
    const h = r.heights;
    if (!h) {
      ground.push(r);
      continue;
    }
    const n = h.length;
    // A segment is raised if either end is; runs of raised segments become structures.
    let i = 0;
    while (i < n - 1) {
      const up = h[i] > RAISED || h[i + 1] > RAISED;
      let j = i + 1;
      while (j < n - 1 && (h[j] > RAISED || h[j + 1] > RAISED) === up) j++;
      const line = r.line.slice(i * 2, (j + 1) * 2);
      if (up) raised.push({ ...r, line, heights: h.slice(i, j + 1) });
      else ground.push({ ...r, line, heights: undefined });
      i = j;
    }
  }
  return { ground, raised };
}

type P3 = [number, number, number];

class Solid {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  private c = new Color();
  /** Quad A-B-C-D (either winding), turned to face `face`, with optional uvs per corner. */
  quad(p: P3[], face: P3, colour: string, uv?: [number, number][]) {
    const [A, B, C] = p;
    const ax = B[0] - A[0];
    const ay = B[1] - A[1];
    const az = B[2] - A[2];
    const bx = C[0] - A[0];
    const by = C[1] - A[1];
    const bz = C[2] - A[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const flip = nx * face[0] + ny * face[1] + nz * face[2] < 0;
    const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    const l = Math.hypot(face[0], face[1], face[2]) || 1;
    this.c.set(colour);
    for (const k of order) {
      this.pos.push(p[k][0], p[k][1], p[k][2]);
      this.nor.push(face[0] / l, face[1] / l, face[2] / l);
      this.col.push(this.c.r, this.c.g, this.c.b);
      if (uv) this.uv.push(uv[k][0], uv[k][1]);
    }
  }
  /** Box: centre, unit direction u in plan, half along / across, y0..y1. */
  box(cx: number, cz: number, ux: number, uz: number, ha: number, hc: number, y0: number, y1: number, colour: string) {
    const nx = uz;
    const nz = -ux;
    const c = (sa: number, sc: number, y: number): P3 => [cx + ux * ha * sa + nx * hc * sc, y, cz + uz * ha * sa + nz * hc * sc];
    this.quad([c(-1, -1, y1), c(1, -1, y1), c(1, 1, y1), c(-1, 1, y1)], [0, 1, 0], colour);
    this.quad([c(1, -1, y0), c(1, 1, y0), c(1, 1, y1), c(1, -1, y1)], [ux, 0, uz], colour);
    this.quad([c(-1, -1, y0), c(-1, 1, y0), c(-1, 1, y1), c(-1, -1, y1)], [-ux, 0, -uz], colour);
    this.quad([c(-1, 1, y0), c(1, 1, y0), c(1, 1, y1), c(-1, 1, y1)], [nx, 0, nz], colour);
    this.quad([c(-1, -1, y0), c(1, -1, y0), c(1, -1, y1), c(-1, -1, y1)], [-nx, 0, -nz], colour);
  }
  geometry(withUv = false): BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
    if (withUv) g.setAttribute("uv", new BufferAttribute(new Float32Array(this.uv), 2));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Flyover decks and ramps from raised road runs: road surface with lane
 * markings, deck slab and fascia, walled embankment on the low ramps, piers
 * with hammerhead caps under the high spans, and crash barriers both sides
 * (uv mapped for the black-and-white chevron texture).
 */
export function buildRaised(raised: TileRoad[], ground: TileRoad[] = []): { deck: BufferGeometry | null; barriers: BufferGeometry | null } {
  const deck = new Solid();
  const bars = new Solid();
  const covered = roadCover([...raised, ...ground]);
  raised.forEach((r, index) => {
    const line = r.line;
    const h = r.heights!;
    const n = h.length;
    if (n < 2) return;
    const half = r.width / 2 + SHOULDER;
    const surface = ROAD_COLOUR[Math.min(r.cls, 3)];
    // Decks meeting at a merge overlap: a millimetre-scale step per road stops their surfaces flickering.
    const lift = (index % 5) * 0.012;
    // Mitred offsets per point (as the flat ribbon).
    const off: [number, number][] = [];
    const seg = (a: number, b: number): [number, number] => {
      const dx = line[b * 2] - line[a * 2];
      const dz = line[b * 2 + 1] - line[a * 2 + 1];
      const l = Math.hypot(dx, dz) || 1;
      return [dz / l, -dx / l];
    };
    for (let i = 0; i < n; i++) {
      const s0 = i > 0 ? seg(i - 1, i) : null;
      const s1 = i < n - 1 ? seg(i, i + 1) : null;
      if (s0 && s1) {
        let nx = s0[0] + s1[0];
        let nz = s0[1] + s1[1];
        const l = Math.hypot(nx, nz) || 1;
        nx /= l;
        nz /= l;
        const k = 1 / Math.max(0.5, nx * s0[0] + nz * s0[1]);
        off.push([nx * k, nz * k]);
      } else off.push((s0 ?? s1)!);
    }
    const P = (i: number, lat: number, y: number): P3 => [line[i * 2] + off[i][0] * lat, y, line[i * 2 + 1] + off[i][1] * lat];
    const bottom = (i: number) => (h[i] >= ON_PIERS ? h[i] - DECK_DEPTH : 0);
    const lanes = Math.max(1, Math.round(r.width / 3.5));
    let along = 0;
    let nextPier = PIER_SPACING / 2;
    for (let i = 0; i < n - 1; i++) {
      const j = i + 1;
      const len = Math.hypot(line[j * 2] - line[i * 2], line[j * 2 + 1] - line[i * 2 + 1]);
      if (len < 0.05) continue;
      const ux = (line[j * 2] - line[i * 2]) / len;
      const uz = (line[j * 2 + 1] - line[i * 2 + 1]) / len;
      const nx = uz;
      const nz = -ux;
      const yi = h[i] + 0.04 + lift;
      const yj = h[j] + 0.04 + lift;
      // Where this edge runs over another road at about the same height (a merge, or a ramp
      // touching down onto a street), there is no wall or barrier: the roads join there.
      const mid = (lat: number): [number, number] => [
        (line[i * 2] + line[j * 2]) / 2 + ((off[i][0] + off[j][0]) / 2) * lat,
        (line[i * 2 + 1] + line[j * 2 + 1]) / 2 + ((off[i][1] + off[j][1]) / 2) * lat,
      ];
      const yMid = (h[i] + h[j]) / 2;
      const open = (s: number) => {
        const [x, z] = mid(s * (half - BARRIER_T / 2));
        return covered(x, z, yMid, r);
      };
      // An embankment wall cannot stand on a road below it: carry the deck over on its soffit there.
      const overRoad = (s: number) => {
        const [x, z] = mid(s * half);
        return covered(x, z, yMid, r, true);
      };
      // Road surface.
      deck.quad([P(i, -half, yi), P(j, -half, yj), P(j, half, yj), P(i, half, yi)], [0, 1, 0], surface);
      // Fascia / embankment walls, and the soffit where the deck is on piers.
      let soffit = bottom(i) > 0 && bottom(j) > 0;
      for (const s of [-1, 1]) {
        if (open(s)) continue;
        const wallOverRoad = !soffit && overRoad(s);
        const b0 = wallOverRoad ? Math.max(0, h[i] - DECK_DEPTH) : bottom(i);
        const b1 = wallOverRoad ? Math.max(0, h[j] - DECK_DEPTH) : bottom(j);
        if (wallOverRoad) soffit = true;
        deck.quad([P(i, s * half, b0), P(j, s * half, b1), P(j, s * half, yj), P(i, s * half, yi)], [nx * s, 0, nz * s], h[i] >= ON_PIERS ? CONCRETE : RE_WALL);
      }
      if (soffit) {
        deck.quad([P(i, -half, bottom(i)), P(j, -half, bottom(j)), P(j, half, bottom(j)), P(i, half, bottom(i))], [0, -1, 0], CONCRETE_DARK);
      }
      // Lane lines: dashed between lanes, solid at the edges.
      for (let k = 0; k <= lanes; k++) {
        const lat = -r.width / 2 + 0.3 + ((r.width - 0.6) * k) / lanes;
        const edge = k === 0 || k === lanes;
        const at = (t: number, dl: number): P3 => [
          line[i * 2] + (line[j * 2] - line[i * 2]) * t + nx * (lat + dl),
          yi + (yj - yi) * t + 0.02,
          line[i * 2 + 1] + (line[j * 2 + 1] - line[i * 2 + 1]) * t + nz * (lat + dl),
        ];
        for (let s = edge ? 0 : (8 - (along % 8)) % 8; s < len; s += edge ? len : 8) {
          const e = Math.min(len, s + (edge ? len : 3));
          deck.quad([at(s / len, -0.08), at(e / len, -0.08), at(e / len, 0.08), at(s / len, 0.08)], [0, 1, 0], MARKING);
        }
      }
      // Crash barriers (chevron texture: u along the road in 1.2 m repeats, v up).
      const u0 = along / 1.2;
      const u1 = (along + len) / 1.2;
      for (const s of [-1, 1]) {
        if (open(s)) continue;
        const inner = s * (half - BARRIER_T);
        const outer = s * half;
        for (const [lat, dir] of [
          [inner, -s],
          [outer, s],
        ]) {
          bars.quad([P(i, lat, yi), P(j, lat, yj), P(j, lat, yj + BARRIER_H), P(i, lat, yi + BARRIER_H)], [nx * dir, 0, nz * dir], "#ffffff", [
            [u0, 0],
            [u1, 0],
            [u1, 1],
            [u0, 1],
          ]);
        }
        const top: [number, number][] = [
          [0.02, 0.97],
          [0.02, 0.97],
          [0.02, 0.97],
          [0.02, 0.97],
        ];
        bars.quad([P(i, inner, yi + BARRIER_H), P(j, inner, yj + BARRIER_H), P(j, outer, yj + BARRIER_H), P(i, outer, yi + BARRIER_H)], [0, 1, 0], "#ffffff", top);
      }
      // Piers under the high spans: a column and a hammerhead cap across the deck.
      while (nextPier <= along + len) {
        const t = (nextPier - along) / len;
        const y = h[i] + (h[j] - h[i]) * t;
        if (y >= ON_PIERS + 0.5) {
          const cx = line[i * 2] + (line[j * 2] - line[i * 2]) * t;
          const cz = line[i * 2 + 1] + (line[j * 2 + 1] - line[i * 2 + 1]) * t;
          const capTop = y - DECK_DEPTH;
          deck.box(cx, cz, ux, uz, 0.8, Math.max(1.2, half * 0.85), capTop - 1.1, capTop, CONCRETE);
          deck.box(cx, cz, ux, uz, 0.75, Math.min(1.4, half * 0.3), 0, capTop - 1.1, CONCRETE);
        }
        nextPier += PIER_SPACING;
      }
      along += len;
    }
  });
  return { deck: deck.geometry(), barriers: bars.geometry(true) };
}

/**
 * Lookup over road footprints with their surface heights: is (x, z) on
 * another road whose surface is within 1.5 m of y (or, with `below`, a road
 * well beneath y)?
 */
function roadCover(roads: TileRoad[]) {
  const CELL = 40;
  const grid = new Map<number, { r: TileRoad; k: number }[]>();
  const cellKey = (i: number, j: number) => i * 100003 + j;
  for (const r of roads) {
    const l = r.line;
    for (let k = 0; k + 3 < l.length; k += 2) {
      const reach = r.width / 2 + SHOULDER;
      const x0 = Math.min(l[k], l[k + 2]) - reach;
      const x1 = Math.max(l[k], l[k + 2]) + reach;
      const z0 = Math.min(l[k + 1], l[k + 3]) - reach;
      const z1 = Math.max(l[k + 1], l[k + 3]) + reach;
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
        for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
          let c = grid.get(cellKey(i, j));
          if (!c) grid.set(cellKey(i, j), (c = []));
          c.push({ r, k });
        }
      }
    }
  }
  return (x: number, z: number, y: number, self: TileRoad, below = false): boolean => {
    for (const { r, k } of grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      if (r === self) continue;
      const l = r.line;
      const ax = l[k];
      const az = l[k + 1];
      const dx = l[k + 2] - ax;
      const dz = l[k + 3] - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d > r.width / 2 + (r.heights ? SHOULDER : 0) - 0.2) continue;
      const hy = r.heights ? r.heights[k / 2] + (r.heights[k / 2 + 1] - r.heights[k / 2]) * t : 0;
      if (below ? hy < y - 2.5 : Math.abs(hy - y) < 1.5) return true;
    }
    return false;
  };
}
