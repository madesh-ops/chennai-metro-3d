import { Color, Matrix4, Quaternion, Vector3 } from "three";
import type { RouteModel } from "../simulation/RouteController.ts";
import type { Quality } from "../simulation/store.ts";
import { mulberry32, pick, range as rr, type Rng } from "../utils/random.ts";
import { smoothstep } from "../utils/interpolation.ts";
import { BUILDING_SETBACK, ROAD } from "./layout.ts";
import { landmarkFootprints, overlapsLandmark } from "./landmarkLayout.ts";
import { branchLayout, inBranchCorridor } from "./line5Layout.ts";
import { SIGN_CELLS } from "./shopNames.ts";

/**
 * Deterministic procedural city along the corridor. Ordinary buildings are
 * not real ones: a plausible low-to-mid-rise Chennai streetscape (pastel
 * plastered walls, shopfronts with invented names, rooftop water tanks, rain
 * trees and coconut palms) seeded so it never changes between loads. Real
 * landmarks (landmarks.json) are drawn separately; their footprints are kept
 * clear here.
 */

export interface InstanceSet {
  matrices: Float32Array;
  count: number;
  colors?: Float32Array;
  seeds?: Float32Array;
  kinds?: Float32Array;
}

export interface CityChunk {
  key: string;
  buildings: InstanceSet;
  tanks: InstanceSet;
  trunks: InstanceSet;
  crowns: InstanceSet;
  palms: InstanceSet;
  poles: InstanceSet;
  lamps: InstanceSet;
  pools: InstanceSet;
  people: InstanceSet;
  /** Shop signboards; `kinds` holds each board's atlas cell. */
  signs: InstanceSet;
}

export interface CityPlan {
  chunks: CityChunk[];
  crossStreets: number[];
}

const DENSITY: Record<Quality, { far: number; trees: number; scatter: number; people: number; signs: number }> = {
  high: { far: 0.55, trees: 1, scatter: 1, people: 1, signs: 1 },
  medium: { far: 0.34, trees: 0.7, scatter: 0.55, people: 0.6, signs: 0.6 },
  low: { far: 0.16, trees: 0.45, scatter: 0.25, people: 0, signs: 0.25 },
};

/** Shopfront bays (m) and the board that fills one: matches the building shader's sign band. */
const SHOP_BAY = 4.2;
const SIGN_W = 3.7;
const SIGN_H = 0.7;
const SIGN_Y = 2.7;

const WALLS = [
  "#efe7d6", "#eadcc0", "#ecd9a6", "#e7cdc3", "#c6d6dc", "#cfe0cc", "#dfb79b",
  "#f3f1ea", "#d9d4c8", "#e9e2cf", "#f0d9b5", "#d5c7e0", "#bfc9b8",
];
const OFFICE = ["#8fa3b3", "#9fb0bc", "#7d8f9e", "#b7c3cb"];
const FOLIAGE = ["#4f7a3e", "#5a8444", "#456f38", "#68904a", "#3f6634"];
/** Number of body variants for pedestrians (CROWD_VARIANTS.length in humanModel.ts). */
export const PEOPLE_VARIANTS = 6;

class Builder {
  matrices: number[] = [];
  colors: number[] = [];
  seeds: number[] = [];
  kinds: number[] = [];
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3();
  private c = new Color();
  private up = new Vector3(0, 1, 0);

  add(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, color?: string, seed?: number, kind?: number) {
    this.p.set(x, y, z);
    this.q.setFromAxisAngle(this.up, yaw);
    this.s.set(sx, sy, sz);
    this.m.compose(this.p, this.q, this.s);
    for (let i = 0; i < 16; i++) this.matrices.push(this.m.elements[i]);
    if (color) {
      this.c.set(color);
      this.colors.push(this.c.r, this.c.g, this.c.b);
    }
    if (seed !== undefined) this.seeds.push(seed);
    if (kind !== undefined) this.kinds.push(kind);
  }

  build(): InstanceSet {
    return {
      matrices: new Float32Array(this.matrices),
      count: this.matrices.length / 16,
      colors: this.colors.length ? new Float32Array(this.colors) : undefined,
      seeds: this.seeds.length ? new Float32Array(this.seeds) : undefined,
      kinds: this.kinds.length ? new Float32Array(this.kinds) : undefined,
    };
  }
}

export function planCrossStreets(route: RouteModel, d0: number, d1: number): number[] {
  const rng = mulberry32(4242);
  const out: number[] = [];
  // Cross streets run 460 m out on both sides, so they must miss every landmark.
  const fps = landmarkFootprints(route);
  const clear = (c: number) => fps.every((f) => Math.abs(c - f.distance) > f.along / 2 + 12);
  for (const st of route.stations) if (st.distance > d0 && st.distance < d1 && clear(st.distance + 72)) out.push(st.distance + 72);
  let d = d0 + 200;
  while (d < d1) {
    d += rr(rng, 380, 720);
    if (clear(d) && out.every((c) => Math.abs(c - d) > 160)) out.push(d);
  }
  return out.filter((c) => c > d0 && c < d1).sort((a, b) => a - b);
}

export function generateCityChunk(
  route: RouteModel,
  d0: number,
  d1: number,
  quality: Quality,
  crossStreets: number[],
  /**
   * The real city comes from the world tiles (OSM): generate only the street
   * furniture of the corridor road under the viaduct (trees, lights, people).
   */
  world = false,
): CityChunk {
  const { alignment } = route;
  const dens = DENSITY[quality];
  const rng = mulberry32(Math.floor(d0 * 7.3) + 1013);
  const buildings = new Builder();
  const tanks = new Builder();
  const trunks = new Builder();
  const crowns = new Builder();
  const palms = new Builder();
  const poles = new Builder();
  const lamps = new Builder();
  const pools = new Builder();
  const people = new Builder();
  const signs = new Builder();
  const fps = landmarkFootprints(route);
  const branch = branchLayout(route);
  const pt = { x: 0, z: 0 };
  const startKm = route.startDistance;

  const urbanity = (d: number) => {
    const km = (d - startKm) / 1000;
    return 0.25 + 0.75 * smoothstep(4.5, 13, km);
  };
  const nearStation = (d: number, margin = 60) =>
    route.stations.some((s) => Math.abs(s.distance - d) < margin);
  const nearCross = (d: number, half: number) => crossStreets.some((c) => Math.abs(c - d) < half);

  const place = (d: number, lateral: number) => alignment.offsetPoint(d, lateral, pt);

  /** Traced neighbourhood pattern at road distance d on one side, if any. */
  const styleAt = (d: number, side: 1 | -1) => {
    for (const z of route.neighbourhoods) if (d >= z.from && d <= z.to) return side > 0 ? z.right : z.left;
    return null;
  };
  /** Narrow lanes every ~45 m through the dense low-rise blocks. */
  const onLane = (d: number) => {
    for (const z of route.neighbourhoods) if (d >= z.from && d <= z.to) return (d - z.from) % 45 < 5;
    return false;
  };

  const addBuilding = (d: number, lateral: number, along: number, depth: number, height: number, kind: number, r: Rng) => {
    // Landmarks stand in clear ground.
    if (overlapsLandmark(fps, d, lateral, along / 2, depth / 2)) return false;
    const p = place(d, lateral);
    // Nothing under the Line 5 viaduct or on the roads beneath it.
    if (inBranchCorridor(branch, p.x, p.z, Math.max(along, depth) / 2)) return false;
    const yaw = alignment.heading(d);
    const color = kind === 2 ? pick(r, OFFICE) : pick(r, WALLS);
    buildings.add(p.x, 0, p.z, yaw, along, height, depth, color, r(), kind);
    if (kind !== 2 && height < 22 && r() < 0.5) {
      // Rooftop water tank, the unmistakable Chennai skyline detail.
      const tx = rr(r, -along * 0.3, along * 0.3);
      const tz = rr(r, -depth * 0.3, depth * 0.3);
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      tanks.add(p.x + tx * c + tz * s, height, p.z - tx * s + tz * c, 0, 1, 1, 1);
    }
    return true;
  };

  /** Named boards over the shopfront bays of a road-facing commercial building. */
  const addSigns = (d: number, lateral: number, along: number, depth: number, side: 1 | -1, r: Rng) => {
    const bays = Math.floor((along - 0.6) / SHOP_BAY);
    if (bays < 1) return;
    const centre = place(d, lateral);
    const cx = centre.x;
    const cz = centre.z;
    const yaw = alignment.heading(d);
    const fx = Math.cos(yaw);
    const fz = -Math.sin(yaw);
    // Right of the road direction = local +z of the building.
    const rx = Math.sin(yaw);
    const rz = Math.cos(yaw);
    const lz = -side * (depth / 2 + 0.05);
    const boardYaw = yaw + (side > 0 ? Math.PI : 0);
    // Often one business takes the whole front; otherwise each bay is its own shop.
    const single = r() < 0.35 ? Math.floor(r() * SIGN_CELLS) : -1;
    for (let b = 0; b < bays; b++) {
      if (r() > 0.92 * dens.signs) continue;
      const lx = -along / 2 + (b + 0.5) * SHOP_BAY;
      const cell = single >= 0 ? single : Math.floor(r() * SIGN_CELLS);
      signs.add(cx + fx * lx + rx * lz, SIGN_Y, cz + fz * lx + rz * lz, boardYaw, SIGN_W, SIGN_H, 1, undefined, undefined, cell);
    }
  };

  const floorsFor = (d: number, r: Rng, tallBias = 0) => {
    const u = urbanity(d);
    let floors = 1 + Math.floor(Math.pow(r(), 1.6) * (2.2 + 5 * u));
    if (r() < 0.035 + 0.07 * u + tallBias) floors = 7 + Math.floor(r() * (6 + 8 * u));
    return floors;
  };

  // Where the corridor road exists: under the viaduct (not over tunnels or troughs).
  const onCorridor = (d: number) => route.profile.railAt(d) >= 4;

  for (const side of [-1, 1] as const) {
    // Row 1: continuous frontage onto the main road.
    let d = world ? d1 : d0;
    while (d < d1) {
      const zone = styleAt(d, side);
      if (zone) {
        // Traced pattern: packed 1–4 storey shop-houses, or a short row of 1–2 storey shops.
        const dense = zone === "dense-low-rise";
        const lot = dense ? rr(rng, 6, 12) : rr(rng, 8, 16);
        const mid = d + lot / 2;
        d += lot + (dense ? rr(rng, 0.3, 1.2) : rr(rng, 0.4, 2));
        if (mid > d1 || nearStation(mid) || nearCross(mid, 13) || (dense && onLane(mid))) continue;
        const depth = dense ? rr(rng, 10, 18) : rr(rng, 8, 12);
        const floors = dense ? 1 + Math.floor(rng() * 4) : 1 + Math.floor(rng() * 2);
        const kind = rng() < 0.8 ? 1 : 0;
        const lateral = side * (BUILDING_SETBACK + rr(rng, 0, 1.5) + depth / 2);
        const placed = addBuilding(mid, lateral, lot, depth, floors * 3.1 + 0.8, kind, rng);
        if (placed && kind === 1) addSigns(mid, lateral, lot, depth, side, rng);
        continue;
      }
      const lot = rr(rng, 8, 19);
      const gap = rng() < 0.12 ? rr(rng, 4, 12) : rr(rng, 0.4, 2.2);
      const mid = d + lot / 2;
      d += lot + gap;
      if (mid > d1 || nearStation(mid) || nearCross(mid, 13)) continue;
      const setback = BUILDING_SETBACK + rr(rng, 0, 3.5);
      const depth = rr(rng, 10, 22);
      const floors = floorsFor(mid, rng);
      const kind = floors >= 7 && rng() < 0.45 ? 2 : rng() < 0.68 ? 1 : 0;
      const placed = addBuilding(mid, side * (setback + depth / 2), lot, depth, floors * (kind === 2 ? 3.6 : 3.1) + 0.8, kind, rng);
      if (placed && kind === 1) addSigns(mid, side * (setback + depth / 2), lot, depth, side, rng);
    }
    // Rows 2–3: behind the frontage, looser.
    for (const [lat0, lat1, prob] of world ? [] : ([
      [44, 74, 0.82],
      [84, 140, 0.7],
    ] as const)) {
      d = d0;
      while (d < d1) {
        const zone = styleAt(d, side);
        if (zone === "apartment-blocks") {
          // Apartment blocks are laid out on their own below; skip ahead.
          d += 8;
          continue;
        }
        if (zone === "dense-low-rise") {
          const lot = rr(rng, 8, 16);
          const mid = d + lot / 2;
          d += lot + rr(rng, 0.5, 2);
          if (mid > d1 || rng() > 0.97 || nearCross(mid, 12) || onLane(mid)) continue;
          const depth = rr(rng, 10, 20);
          addBuilding(mid, side * rr(rng, lat0 + depth / 2, lat1), lot, depth, (2 + Math.floor(rng() * 3)) * 3.1 + 0.8, 0, rng);
          continue;
        }
        const lot = rr(rng, 12, 30);
        const mid = d + lot / 2;
        d += lot + rr(rng, 2, 10);
        if (mid > d1 || rng() > prob || nearCross(mid, 12)) continue;
        const depth = rr(rng, 12, 28);
        const lateral = side * rr(rng, lat0 + depth / 2, lat1);
        const floors = floorsFor(mid, rng, -0.01);
        const kind = floors >= 7 && rng() < 0.35 ? 2 : rng() < 0.2 ? 1 : 0;
        addBuilding(mid, lateral, lot, depth, floors * (kind === 2 ? 3.6 : 3.1) + 0.8, kind, rng);
      }
    }
    // Far field: sparse blocks for skyline depth.
    for (let fd = d0; fd < (world ? d0 : d1); fd += 46) {
      for (let lat = 160; lat < 720; lat += 46) {
        if (rng() > dens.far * (1 - lat / 1100)) continue;
        const along = rr(rng, 14, 38);
        const depth = rr(rng, 14, 36);
        const md = fd + rr(rng, 0, 30);
        const zone = styleAt(md, side);
        if (zone === "apartment-blocks" && lat < 300) continue; // open ground behind the blocks
        const floors = zone ? 2 + Math.floor(rng() * 3) : floorsFor(md, rng, 0.01);
        addBuilding(md, side * (lat + rr(rng, 0, 30)), along, depth, floors * 3.2 + 0.8, floors >= 8 && rng() < 0.4 ? 2 : 0, rng);
      }
    }

    // Traced neighbourhood extras: a third row of houses, and apartment blocks round a courtyard.
    for (const z of world ? [] : route.neighbourhoods) {
      const style = side > 0 ? z.right : z.left;
      if (!style || z.to < d0 || z.from >= d1) continue;
      const zr = mulberry32(Math.floor(z.from * 3.1) + (side > 0 ? 7 : 11));
      if (style === "dense-low-rise") {
        for (let hd = z.from; hd < z.to; ) {
          const lot = rr(zr, 8, 16);
          const mid = hd + lot / 2;
          hd += lot + rr(zr, 0.5, 2);
          const depth = rr(zr, 10, 20);
          const lateral = side * rr(zr, 150 + depth / 2, 260);
          const floors = 2 + Math.floor(zr() * 3);
          if (mid < d0 || mid >= d1 || onLane(mid) || nearCross(mid, 12)) continue;
          addBuilding(mid, lateral, lot, depth, floors * 3.1 + 0.8, 0, zr);
        }
      } else {
        // Two rows of 5-storey blocks either side of a ~30 m courtyard.
        for (let bd = z.from + 22; bd < z.to - 16; bd += 42) {
          if (bd < d0 || bd >= d1 || nearCross(bd, 20)) continue;
          for (const lat of [44, 102]) addBuilding(bd, side * lat, 32, 28, 5 * 3.1 + 0.8, 0, zr);
        }
      }
    }

    // Street trees on the outer edge of the footpath.
    d = d0 + rr(rng, 0, 10);
    while (d < d1) {
      d += rr(rng, 13, 30) / dens.trees;
      if (nearStation(d, 50) || nearCross(d, 10) || (world && !onCorridor(d))) continue;
      addTree(d, side * (ROAD.halfWidth + ROAD.sidewalk - 0.6 + rr(rng, -0.2, 0.4)), rng);
    }
    // Scattered greenery behind buildings.
    const scatter = world ? 0 : Math.floor(((d1 - d0) / 1000) * 220 * dens.scatter);
    for (let i = 0; i < scatter; i++) {
      const sd = rr(rng, d0, d1);
      const lat = side * rr(rng, 30, 420);
      addTree(sd, lat, rng);
    }

    // Street lights every ~36 m, staggered per side.
    for (let ld = d0 + (side > 0 ? 0 : 18); ld < d1; ld += 36) {
      if (nearStation(ld, 48) || nearCross(ld, 9) || (world && !onCorridor(ld))) continue;
      const lateral = side * (ROAD.halfWidth + 0.5);
      const p = place(ld, lateral);
      const yaw = alignment.heading(ld) + (side > 0 ? Math.PI : 0);
      poles.add(p.x, 0, p.z, yaw, 1, 1, 1);
      const h = place(ld, lateral - side * 2.1);
      lamps.add(h.x, 9.05, h.z, yaw, 1, 1, 1);
      const pool = place(ld, lateral - side * 4.5);
      // Just above the kerb so the footpath does not cut the pool in half.
      pools.add(pool.x, ROAD.kerb + 0.01, pool.z, 0, 11, 1, 11);
    }

    // Pedestrians on the footpaths near stations.
    if (dens.people > 0) {
      for (const st of route.stations) {
        if (st.distance < d0 || st.distance >= d1 || st.service !== "stop" || (world && !onCorridor(st.distance))) continue;
        const n = Math.round(16 * dens.people);
        for (let i = 0; i < n; i++) {
          const pd = st.distance + rr(rng, -70, 70);
          const p = place(pd, side * rr(rng, ROAD.halfWidth + 0.6, ROAD.halfWidth + ROAD.sidewalk - 0.4));
          // kind = body variant (CROWD_VARIANTS in humanModel.ts); colours are picked when drawn.
          const h = rr(rng, 0.93, 1.06);
          people.add(p.x, 0.18, p.z, rng() * Math.PI * 2, h, h, h, undefined, undefined, Math.floor(rng() * PEOPLE_VARIANTS));
        }
      }
    }
  }

  function addTree(d: number, lateral: number, r: Rng) {
    if (overlapsLandmark(fps, d, lateral, 3, 3, 2)) return;
    const p = place(d, lateral);
    if (inBranchCorridor(branch, p.x, p.z, 2.5)) return;
    const type = r();
    if (type < 0.22) {
      const h = rr(r, 8, 13);
      trunks.add(p.x, 0, p.z, 0, 0.7, h, 0.7, "#7b6a55");
      palms.add(p.x, h, p.z, r() * Math.PI * 2, rr(r, 0.85, 1.15), rr(r, 0.85, 1.1), rr(r, 0.85, 1.15), pick(r, FOLIAGE));
    } else {
      const wide = type > 0.6;
      const h = wide ? rr(r, 4.5, 6.5) : rr(r, 3, 4.5);
      const rx = wide ? rr(r, 4, 6.5) : rr(r, 2.4, 3.6);
      const ry = wide ? rr(r, 2.4, 3.4) : rr(r, 2.6, 3.8);
      trunks.add(p.x, 0, p.z, 0, wide ? 1.4 : 1, h + ry * 0.3, wide ? 1.4 : 1, "#6f5e4b");
      crowns.add(p.x, h + ry * 0.75, p.z, r() * Math.PI, rx, ry, rx * rr(r, 0.85, 1.1), pick(r, FOLIAGE));
    }
  }

  return {
    key: `${Math.round(d0)}-${Math.round(d1)}`,
    buildings: buildings.build(),
    tanks: tanks.build(),
    trunks: trunks.build(),
    crowns: crowns.build(),
    palms: palms.build(),
    poles: poles.build(),
    lamps: lamps.build(),
    pools: pools.build(),
    people: people.build(),
    signs: signs.build(),
  };
}
