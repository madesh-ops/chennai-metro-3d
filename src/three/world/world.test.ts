import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Color, Vector3 } from "three";
import { decodeTile, TILE_M, type TileBuilding, type TileData } from "./tileFormat.ts";
import { blocked, buildBuildings, buildFlat, buildTileGeometry } from "./worldGeometry.ts";
import { createProjection } from "../../utils/coordinates.ts";
import network from "../../data/network.json" with { type: "json" };

const DIR = new URL("../../../public/world/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("index.json", DIR), "utf8")) as { palette: string[]; tiles: [number, number, number][] };

function tile(key: string): TileData {
  const buf = gunzipSync(readFileSync(new URL(`tiles/${key}.bin`, DIR)));
  return decodeTile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer);
}

test("every indexed tile exists and the set stays small", () => {
  let total = 0;
  for (const [tx, tz] of index.tiles) {
    const f = new URL(`tiles/${tx}_${tz}.bin`, DIR);
    assert.ok(existsSync(f), `${tx}_${tz}`);
    total += statSync(f).size;
  }
  assert.ok(index.tiles.length > 200);
  assert.ok(total < 15e6, `${(total / 1e6).toFixed(1)} MB`);
});

test("every station of every line stands in a world tile", () => {
  const have = new Set(index.tiles.map(([tx, tz]) => `${tx}_${tz}`));
  const proj = createProjection(network.meta.origin);
  for (const line of network.lines) {
    for (const st of line.stations) {
      const [x, z] = proj.toLocal({ lat: st.lat, lon: st.lon });
      assert.ok(have.has(`${Math.floor(x / TILE_M)}_${Math.floor(z / TILE_M)}`), `${line.id} ${st.name}`);
    }
  }
});

test("a Virugambakkam tile: real streets and buildings, in its own square", () => {
  const t = tile("-10_3");
  assert.equal(t.tx, -10);
  assert.equal(t.tz, 3);
  assert.ok(t.buildings.length > 1000, `${t.buildings.length} buildings`);
  assert.ok(t.roads.length > 50);
  const x0 = t.tx * TILE_M - 0.05;
  const z0 = t.tz * TILE_M - 0.05;
  for (const r of t.roads) {
    for (let i = 0; i < r.line.length; i += 2) {
      assert.ok(r.line[i] >= x0 && r.line[i] <= x0 + TILE_M + 0.1 && r.line[i + 1] >= z0 && r.line[i + 1] <= z0 + TILE_M + 0.1, "road clipped to the tile");
    }
  }
  for (const b of t.buildings) {
    assert.ok(b.height >= 2 && b.height < 300, `height ${b.height}`);
    assert.ok(b.ring.length >= 6);
    assert.ok(b.colour < index.palette.length);
  }
  // Mostly real OSM footprints here, not procedural fill.
  const real = t.buildings.filter((b) => !(b.flags & 1)).length;
  assert.ok(real / t.buildings.length > 0.7);
});

const square = (cx: number, cz: number, s: number, height = 9): TileBuilding => ({
  kind: 0,
  colour: 0,
  height,
  floors: 3,
  front: -1,
  flags: 0,
  ring: new Float32Array([cx - s, cz - s, cx + s, cz - s, cx + s, cz + s, cx - s, cz + s]),
});

test("extruded walls face outward and roofs face up, whichever way the ring winds", () => {
  const cw = square(0, 0, 5);
  const ccw = { ...square(40, 0, 5), ring: new Float32Array([35, -5, 35, 5, 45, 5, 45, -5]) };
  const g = buildBuildings([cw, ccw], [new Color("#ffffff")], 1)!;
  const pos = g.getAttribute("position");
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    const centre = a.x < 20 ? new Vector3(0, 0, 0) : new Vector3(40, 0, 0);
    const mid = a.clone().add(b).add(c).divideScalar(3);
    if (Math.abs(n.y) > 0.9) assert.ok(n.y > 0, "roof faces up");
    else assert.ok(n.dot(mid.sub(centre).setY(0)) > 0, "wall faces out");
  }
});

test("flat layer faces up", () => {
  const g = buildFlat([{ cls: 1, width: 12, bridge: false, layer: 0, line: new Float32Array([0, 0, 50, 10, 80, 60]) }], [{ kind: 1, ring: new Float32Array([0, 0, 30, 0, 30, 30, 0, 30]) }])!;
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i += 3) {
    const a = new Vector3().fromBufferAttribute(pos, i);
    const b = new Vector3().fromBufferAttribute(pos, i + 1);
    const c = new Vector3().fromBufferAttribute(pos, i + 2);
    const ny = b.clone().sub(a).cross(c.clone().sub(a)).y;
    assert.ok(ny >= -1e-6, "triangle faces up");
  }
});

test("keep-out zones remove buildings and trees", () => {
  const data: TileData = {
    tx: 0,
    tz: 0,
    buildings: [square(100, 100, 5), square(300, 300, 5)],
    roads: [],
    areas: [],
    trees: [
      { type: 0, x: 100, z: 120 },
      { type: 0, x: 500, z: 500 },
    ],
  };
  const keep = (x: number, z: number, r: number) => Math.hypot(x - 100, z - 100) < 30 + r;
  assert.equal(blocked(data.buildings[0], keep), true);
  assert.equal(blocked(data.buildings[1], keep), false);
  const g = buildTileGeometry(data, { palette: [new Color("#fff")], keep, signCells: 0, treeDensity: 1 });
  assert.equal(g.kept.length, 1);
  assert.equal(g.trunks.matrices.length / 16, 1);
});

test("flyovers: raised runs split from ground pieces, decks face up, piers only on high spans", async () => {
  const { splitRaised, buildRaised } = await import("./worldGeometry.ts");
  const line = new Float32Array([0, 0, 100, 0, 200, 0, 300, 0, 400, 0]);
  const heights = new Float32Array([0, 0, 7.5, 7.5, 0]);
  const { ground, raised } = splitRaised([{ cls: 0, width: 11, bridge: true, layer: 1, line, heights }]);
  assert.equal(raised.length, 1);
  assert.deepEqual(Array.from(raised[0].heights!), [0, 7.5, 7.5, 0]);
  assert.equal(ground.length, 1);
  const { deck, barriers } = buildRaised(raised);
  assert.ok(deck && barriers);
  // The road surface reaches the deck height; nothing hangs below ground.
  const pos = deck!.getAttribute("position");
  let top = -Infinity;
  let low = Infinity;
  for (let i = 0; i < pos.count; i++) {
    top = Math.max(top, pos.getY(i));
    low = Math.min(low, pos.getY(i));
  }
  assert.ok(top > 7.5 && top < 7.7, `top ${top}`);
  assert.ok(low >= -0.001, `low ${low}`);
  assert.ok(barriers!.getAttribute("uv"), "barrier chevron uvs");
});

test("footbridge: walkway at its floor height, tower at the far end", async () => {
  const { buildFootbridge } = await import("../footbridgeModel.ts");
  const g = buildFootbridge({ length: 70, width: 4.5, floor: 10.5, supports: [27], tower: { size: 8, height: 14 } });
  g.floor.computeBoundingBox();
  assert.ok(Math.abs(g.floor.boundingBox!.max.y - 10.75) < 0.01);
  g.tower.computeBoundingBox();
  assert.ok(g.tower.boundingBox!.min.x >= 69 && g.tower.boundingBox!.max.y > 14);
  g.steel.computeBoundingBox();
  assert.ok(g.steel.boundingBox!.min.y <= 0.01, "the column reaches the ground");
});
