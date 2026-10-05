/**
 * World tile format (public/world/tiles/{tx}_{tz}.bin, gzip-compressed),
 * written by scripts/osm/bake-tiles.mjs from OpenStreetMap data.
 *
 * One tile is a TILE_M square of the shared city projection (origin Chennai
 * Central, +x east, +z south). Coordinates are int16 decimetres relative to
 * the tile's north-west corner. All numbers little-endian.
 *
 *   header   u32 magic "CMW1", i16 tx, i16 tz, u32 buildings, roads, areas, trees
 *   building u8 kind, u8 colour, u16 height (dm), u16 front edge (0xffff none),
 *            u8 flags, u8 floors, u16 n, n × (i16 x, i16 z)   — outer ring, no repeat
 *   road     u8 class, u8 width (0.25 m), u8 flags, u8 layer, u16 n, n × (i16 x, i16 z)
 *            [flags bit 1: then n × u8 height of the road surface (0.1 m) — flyovers and ramps]
 *   area     u8 kind, u8 0, u16 n, n × (i16 x, i16 z)          — clipped to the tile
 *   tree     u8 type, i16 x, i16 z
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */

export const TILE_M = 1000;
export const TILE_MAGIC = 0x31574d43;

/** Building kinds, which the facade shader draws differently. */
export const BUILDING = {
  residential: 0,
  /** Ground-floor shops with sign bands (faces a main road). */
  shops: 1,
  /** Glass curtain-wall office. */
  office: 2,
  industrial: 3,
  religious: 4,
  institutional: 5,
} as const;

/** Building flags. */
export const BFLAG = {
  /** Not in OpenStreetMap: placed along a real street where none are mapped. */
  procedural: 1,
  /** Rooftop water tank. */
  tank: 2,
} as const;

/** Road classes (links take their parent's). */
export const ROAD_CLASS = { trunk: 0, primary: 1, secondary: 2, tertiary: 3, residential: 4, service: 5, pedestrian: 6 } as const;

export const AREA = { water: 0, park: 1, pitch: 2 } as const;

export const TREE = { broadleaf: 0, palm: 1, rain: 2 } as const;

export interface TileBuilding {
  kind: number;
  colour: number;
  height: number;
  floors: number;
  /** Index of the edge (ring[i] → ring[i+1]) facing the main road, or -1. */
  front: number;
  flags: number;
  /** Ring as x0, z0, x1, z1… in world metres. */
  ring: Float32Array;
}

export interface TileRoad {
  cls: number;
  width: number;
  bridge: boolean;
  layer: number;
  line: Float32Array;
  /** Road-surface height per point (m) on flyovers and their ramps; absent at ground level. */
  heights?: Float32Array;
}

export interface TileArea {
  kind: number;
  ring: Float32Array;
}

export interface TileTree {
  type: number;
  x: number;
  z: number;
}

export interface TileData {
  tx: number;
  tz: number;
  buildings: TileBuilding[];
  roads: TileRoad[];
  areas: TileArea[];
  trees: TileTree[];
}

/** Decode an (already decompressed) tile into world coordinates. */
export function decodeTile(buf: ArrayBuffer): TileData {
  const v = new DataView(buf);
  let o = 0;
  const u8 = () => v.getUint8(o++);
  const u16 = () => {
    const r = v.getUint16(o, true);
    o += 2;
    return r;
  };
  const i16 = () => {
    const r = v.getInt16(o, true);
    o += 2;
    return r;
  };
  const u32 = () => {
    const r = v.getUint32(o, true);
    o += 4;
    return r;
  };
  if (u32() !== TILE_MAGIC) throw new Error("Not a world tile");
  const tx = i16();
  const tz = i16();
  const nb = u32();
  const nr = u32();
  const na = u32();
  const nt = u32();
  const ox = tx * TILE_M;
  const oz = tz * TILE_M;
  const ring = (n: number) => {
    const a = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      a[i * 2] = ox + i16() / 10;
      a[i * 2 + 1] = oz + i16() / 10;
    }
    return a;
  };
  const buildings: TileBuilding[] = [];
  for (let i = 0; i < nb; i++) {
    const kind = u8();
    const colour = u8();
    const height = u16() / 10;
    const f = u16();
    const flags = u8();
    const floors = u8();
    const n = u16();
    buildings.push({ kind, colour, height, floors, front: f === 0xffff ? -1 : f, flags, ring: ring(n) });
  }
  const roads: TileRoad[] = [];
  for (let i = 0; i < nr; i++) {
    const cls = u8();
    const width = u8() / 4;
    const flags = u8();
    const layer = u8();
    const n = u16();
    const line = ring(n);
    let heights: Float32Array | undefined;
    if (flags & 2) {
      heights = new Float32Array(n);
      for (let k = 0; k < n; k++) heights[k] = u8() / 10;
    }
    roads.push({ cls, width, bridge: (flags & 1) === 1, layer, line, heights });
  }
  const areas: TileArea[] = [];
  for (let i = 0; i < na; i++) {
    const kind = u8();
    u8();
    const n = u16();
    areas.push({ kind, ring: ring(n) });
  }
  const trees: TileTree[] = [];
  for (let i = 0; i < nt; i++) {
    const type = u8();
    trees.push({ type, x: ox + i16() / 10, z: oz + i16() / 10 });
  }
  return { tx, tz, buildings, roads, areas, trees };
}
