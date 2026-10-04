import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRouteModel } from "./RouteController.ts";
import { discountedFare, fareForDistanceKm, fareForJourney } from "./fares.ts";
import type { DataBundle } from "./types.ts";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
const data: DataBundle = { stations: load("stations"), routes: load("routes"), tracks: load("tracks"), landmarks: load("landmarks") };
const route = buildRouteModel(data);
const fares = route.route.fares;
const slabs = fares.bands!.slabs;

test("fare bands reproduce the published Line 4 examples", () => {
  for (const ex of fares.examples) {
    assert.equal(fareForJourney(route.stations, slabs, ex.from, ex.to), ex.fare, `${ex.from} → ${ex.to}`);
  }
  // And the published range for the whole stretch.
  const served = route.stops;
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of served) for (const b of served) {
    if (a === b) continue;
    const f = fareForJourney(route.stations, slabs, a.id, b.id)!;
    lo = Math.min(lo, f);
    hi = Math.max(hi, f);
  }
  assert.equal(lo, fares.min);
  assert.equal(hi, fares.max);
});

test("fares never go down with distance and band edges belong to the lower band", () => {
  let prev = 0;
  for (let km = 0; km <= 40; km += 0.05) {
    const f = fareForDistanceKm(km, slabs);
    assert.ok(f >= prev, `fare fell at ${km.toFixed(2)} km`);
    prev = f;
  }
  assert.equal(fareForDistanceKm(2, slabs), 10);
  assert.equal(fareForDistanceKm(2.01, slabs), 20);
  assert.equal(fareForDistanceKm(100, slabs), 50);
});

test("fares are the same in both directions; unknown stations give null", () => {
  for (const a of route.stops) for (const b of route.stops) {
    assert.equal(fareForJourney(route.stations, slabs, a.id, b.id), fareForJourney(route.stations, slabs, b.id, a.id));
  }
  assert.equal(fareForJourney(route.stations, slabs, "nowhere", "vadapalani"), null);
});

test("digital tickets get the published discount", () => {
  assert.equal(fares.digitalDiscount!.percent, 20);
  assert.equal(discountedFare(40, 20), 32);
  assert.equal(discountedFare(10, 20), 8);
});
