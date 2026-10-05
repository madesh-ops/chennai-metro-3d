import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRouteModel } from "../simulation/RouteController.ts";
import type { DataBundle } from "../simulation/types.ts";
import { generateCityChunk, type InstanceSet } from "./cityGen.ts";
import { landmarkFootprints } from "./landmarkLayout.ts";

const json = (name: string) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
const data = { stations: json("stations"), routes: json("routes"), tracks: json("tracks"), landmarks: json("landmarks") } as DataBundle;
const route = buildRouteModel(data);
const zone = route.neighbourhoods.find((n) => n.raw.id === "virugambakkam")!;

interface Bldg {
  d: number;
  lateral: number;
  height: number;
  along: number;
  depth: number;
}

/** Buildings of a chunk in road coordinates (distance, signed lateral) with their sizes. */
function buildings(set: InstanceSet, guess: number): Bldg[] {
  const out: Bldg[] = [];
  for (let i = 0; i < set.count; i++) {
    const m = set.matrices.subarray(i * 16, i * 16 + 16);
    const x = m[12];
    const z = m[14];
    const d = route.alignment.project(x, z, guess, 1500);
    const c = route.alignment.point(d);
    const r = route.alignment.right(d);
    out.push({
      d,
      lateral: (x - c.x) * r.x + (z - c.z) * r.z,
      along: Math.hypot(m[0], m[1], m[2]),
      height: Math.hypot(m[4], m[5], m[6]),
      depth: Math.hypot(m[8], m[9], m[10]),
    });
  }
  return out;
}

const mid = (zone.from + zone.to) / 2;
const chunk = generateCityChunk(route, zone.from, zone.to, "high", []);
const all = buildings(chunk.buildings, mid);
const inside = all.filter((b) => b.d > zone.from + 20 && b.d < zone.to - 20);
// North (the mall's side, Virugambakkam) is the left of the line here when right points south.
const northSign = route.alignment.right(mid).z > 0 ? -1 : 1;

test("Virugambakkam: the mall's side is packed low-rise, no towers", () => {
  const north = inside.filter((b) => Math.sign(b.lateral) === northSign);
  assert.ok(north.length > 60, `${north.length} buildings on the mall's side`);
  // At most 4 floors (3.1 m near the road, 3.2 m in the far field).
  for (const b of north) assert.ok(b.height <= 4 * 3.2 + 0.8 + 1e-6, `${b.height.toFixed(1)} m tall at lateral ${b.lateral.toFixed(0)}`);
  // Denser than an ordinary stretch of the same length nearer Porur.
  const elsewhere = buildings(generateCityChunk(route, 10200, 10200 + (zone.to - zone.from), "high", []).buildings, 10500);
  const near = (bs: Bldg[]) => bs.filter((b) => Math.sign(b.lateral) === northSign && Math.abs(b.lateral) < 270).length;
  assert.ok(near(inside) > near(elsewhere) * 1.2, `${near(inside)} vs ${near(elsewhere)} buildings within 270 m`);
});

test("Virugambakkam: apartment blocks round a courtyard across the road", () => {
  const south = inside.filter((b) => Math.sign(b.lateral) === -northSign);
  const blocks = south.filter((b) => b.along >= 30 && b.depth >= 26 && Math.abs(b.height - (5 * 3.1 + 0.8)) < 1e-6);
  assert.ok(blocks.length >= 4, `${blocks.length} apartment blocks`);
  // Nothing taller than the blocks on that side, and open ground behind them.
  for (const b of south) assert.ok(b.height <= 5 * 3.1 + 0.8 + 1e-6);
  assert.equal(south.filter((b) => Math.abs(b.lateral) > 130 && Math.abs(b.lateral) < 290).length, 0);
});

test("nothing is built in the mall's footprint or under the Line 5 curve", () => {
  const mall = landmarkFootprints(route).find((f) => f.placement.landmark.id === "chandra-metro-mall")!;
  for (const b of all) {
    const overlaps = Math.abs(b.d - mall.distance) < mall.along / 2 + b.along / 2 && Math.abs(b.lateral - mall.lateral) < mall.depth / 2 + b.depth / 2;
    assert.ok(!overlaps, `building at ${b.d.toFixed(0)} / ${b.lateral.toFixed(0)} overlaps the mall`);
  }
  const east = route.line5Branches.find((b) => b.end === "east")!;
  const chunkAll = generateCityChunk(route, east.junction - 200, east.junction + 600, "high", []);
  const m = chunkAll.buildings.matrices;
  for (let i = 0; i < chunkAll.buildings.count; i++) {
    const x = m[i * 16 + 12];
    const z = m[i * 16 + 14];
    for (let s = 0; s <= east.alignment.length; s += 10) {
      const p = east.alignment.point(s);
      assert.ok(Math.hypot(x - p.x, z - p.z) > 6, "building under the Line 5 viaduct");
    }
  }
});

test("chunks away from the neighbourhood are generated exactly as before", () => {
  const plain = { ...route, neighbourhoods: [] };
  for (const d0 of [3000, 9600]) {
    const a = generateCityChunk(route, d0, d0 + 800, "high", []);
    const b = generateCityChunk(plain, d0, d0 + 800, "high", []);
    assert.deepEqual(a.buildings.matrices, b.buildings.matrices);
    assert.deepEqual(a.signs.matrices, b.signs.matrices);
  }
});
