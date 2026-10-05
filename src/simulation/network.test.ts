import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** The OSM-baked network (scripts/osm/bake-network.mjs) checked against published facts. */
interface NetLine {
  id: string;
  lengthM: number;
  track: [number, number][];
  structure: [number, number, "elevated" | "underground" | "at-grade", number][];
  stations: { name: string; d: number; offsetM: number; osmId: number | null; quality?: string; source?: string }[];
}
const net = JSON.parse(readFileSync(new URL("../data/network.json", import.meta.url), "utf8")) as { meta: { licence: string }; lines: NetLine[] };
const line = (id: string) => net.lines.find((l) => l.id === id)!;
const station = (l: NetLine, name: RegExp) => l.stations.find((s) => name.test(s.name))!;
const kindAt = (l: NetLine, d: number) => l.structure.find((r) => d >= r[0] && d <= r[1])?.[2];

test("network credits OpenStreetMap", () => {
  assert.match(net.meta.licence, /OpenStreetMap contributors/);
});

test("line lengths match the published figures", () => {
  // Published route lengths (CMRL / Wikipedia): Line 1 32.1 km, Line 2 22 km, Line 4 26.1 km, Line 5 ~47 km (u/c).
  const published: Record<string, number> = { "line-1": 32.1, "line-2": 22.0, "line-4": 26.1, "line-5": 47.0 };
  for (const [id, km] of Object.entries(published)) {
    const got = line(id).lengthM / 1000;
    assert.ok(Math.abs(got - km) / km < 0.06, `${id}: ${got.toFixed(2)} km vs ${km} km`);
  }
});

test("tracks are continuous and stations sit on them in order", () => {
  for (const l of net.lines) {
    for (let i = 1; i < l.track.length; i++) {
      const gap = Math.hypot(l.track[i][0] - l.track[i - 1][0], l.track[i][1] - l.track[i - 1][1]);
      assert.ok(gap < 30, `${l.id}: ${gap.toFixed(0)} m gap at point ${i}`);
    }
    for (let i = 1; i < l.stations.length; i++) assert.ok(l.stations[i].d > l.stations[i - 1].d, `${l.id}: ${l.stations[i].name} out of order`);
  }
});

test("station lists match the open and planned lines", () => {
  const l1 = line("line-1");
  assert.equal(l1.stations.length, 26);
  assert.match(l1.stations[0].name, /Wimco Nagar Depot/);
  assert.match(l1.stations.at(-1)!.name, /Airport/);
  const l2 = line("line-2");
  assert.equal(l2.stations.length, 17);
  assert.match(l2.stations[0].name, /Central/);
  assert.match(l2.stations.at(-1)!.name, /St\. Thomas Mount/);
  const l4 = line("line-4");
  assert.equal(l4.stations.length, 27);
  assert.match(l4.stations[0].name, /Poonamallee Bypass/);
  assert.match(l4.stations.at(-1)!.name, /Lighthouse/);
  for (const n of [/Porur Junction/, /Vadapalani/, /Alwarpet/, /Thirumayilai/]) assert.ok(station(l4, n), `Line 4 has ${n}`);
});

test("elevated and underground stretches are where the real lines run", () => {
  const l1 = line("line-1");
  assert.equal(kindAt(l1, station(l1, /Thousand Lights/).d), "underground");
  assert.equal(kindAt(l1, station(l1, /Wimco Nagar$/).d), "elevated");
  const l2 = line("line-2");
  assert.equal(kindAt(l2, station(l2, /Egmore/).d), "underground");
  assert.equal(kindAt(l2, station(l2, /^Koyambedu/).d), "elevated");
  assert.equal(kindAt(l2, station(l2, /Vadapalani/).d), "elevated");
  const l4 = line("line-4");
  assert.equal(kindAt(l4, station(l4, /Porur Junction/).d), "elevated");
  assert.equal(kindAt(l4, station(l4, /Alwarpet/).d), "underground");
});

test("Line 5: all 45 stations (Wikipedia), unmapped ones flagged with how they were placed", () => {
  const l5 = net.lines.find((l) => l.id === "line-5")!;
  assert.equal(l5.stations.length, 45);
  for (let i = 1; i < l5.stations.length; i++) {
    const gap = l5.stations[i].d - l5.stations[i - 1].d;
    assert.ok(gap > 500 && gap < 1700, `${l5.stations[i - 1].name} → ${l5.stations[i].name}: ${gap} m`);
  }
  const added = l5.stations.filter((s) => s.osmId === null);
  assert.equal(added.length, 18);
  for (const s of added) assert.ok(s.quality && s.source, s.name);
  const names = l5.stations.map((s) => s.name);
  assert.ok(names.indexOf("Thirumangalam") > names.indexOf("Villivakkam Metro"));
  assert.ok(names.indexOf("Adambakkam") === names.indexOf("St. Thomas Mount Metro") + 1);
});
