import { test } from "node:test";
import assert from "node:assert/strict";
import { getAllRouteSummaries, getNetworkSummary, routeForStation } from "./getRouteSummary.ts";
import { journeyDuration, simulatorHref } from "./routeSummary.ts";

test("every route has a summary with a playable journey", () => {
  const all = getAllRouteSummaries();
  assert.equal(all.length, 6);
  for (const r of all) {
    assert.ok(r.stopIds.length >= 10, r.id);
    const t = journeyDuration(r, r.stopIds[0], r.stopIds[r.stopIds.length - 1]);
    assert.ok(t > 600 && t < 6000, `${r.id}: ${t}s`);
    assert.equal(r.preview, r.status === "under-construction");
  }
});

test("interchanges come from stations shared between lines", () => {
  const l1 = getAllRouteSummaries().find((r) => r.lineId === "line-1")!;
  assert.deepEqual(l1.stations.find((s) => s.id === "alandur")!.interchange, ["line-2", "line-5"]);
  assert.deepEqual(l1.stations.find((s) => s.id === "central")!.interchange, ["line-2"]);
  const l4 = getAllRouteSummaries()[0];
  assert.ok(l4.stations.find((s) => s.id === "vadapalani")!.interchange.includes("line-2"));
});

test("network summary: five lines, shared stations once", () => {
  const n = getNetworkSummary();
  assert.deepEqual(n.lines.map((l) => l.id).sort(), ["line-1", "line-2", "line-3", "line-4", "line-5"]);
  const ids = n.stations.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(n.stations.find((s) => s.id === "alandur")!.lines, ["line-1", "line-2", "line-5"]);
  for (const l of n.lines) assert.ok(l.track.length > 20 && l.track.length < 3000, `${l.id} ${l.track.length}`);
});

test("station pages pick a served route, links carry the route", () => {
  assert.equal(routeForStation("alandur")!.lineId, "line-1");
  assert.equal(routeForStation("alapakkam")!.id, "line-4-poonamallee-vadapalani");
  assert.equal(simulatorHref("line-2-central-st-thomas-mount", "central", "alandur"), "/simulator?route=line-2-central-st-thomas-mount&from=central&to=alandur");
});
