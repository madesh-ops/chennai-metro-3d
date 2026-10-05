import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVerticalProfile, MAX_GRADE, UNDERGROUND_RAIL } from "./VerticalProfile.ts";

const RAIL = 18;

test("elevated, underground and at-grade runs reach their heights", () => {
  const p = buildVerticalProfile(
    [
      { from: 0, to: 4000, kind: "elevated", layer: 1 },
      { from: 4000, to: 9000, kind: "underground", layer: -1 },
      { from: 9000, to: 12000, kind: "at-grade", layer: 0 },
    ],
    12000,
    [],
    RAIL,
  );
  assert.ok(Math.abs(p.railAt(1000) - RAIL) < 1e-6);
  assert.ok(Math.abs(p.railAt(6500) - UNDERGROUND_RAIL) < 1e-6);
  assert.ok(Math.abs(p.railAt(11500) - 1) < 1e-6);
  assert.equal(p.kindAt(6500), "underground");
  assert.equal(p.kindAt(4000), "ramp");
});

test("no grade exceeds the limit, and ramps sit across the change of level", () => {
  const p = buildVerticalProfile(
    [
      { from: 0, to: 5000, kind: "elevated", layer: 1 },
      { from: 5000, to: 10000, kind: "underground", layer: -2 },
    ],
    10000,
    [],
    RAIL,
  );
  for (let d = 0; d < 9999; d += 1) assert.ok(Math.abs(p.railAt(d + 1) - p.railAt(d)) <= MAX_GRADE + 1e-6, `grade at ${d}`);
  // Half the climb happens on each side of the boundary.
  const mid = (RAIL + UNDERGROUND_RAIL - 4) / 2;
  assert.ok(Math.abs(p.railAt(5000) - mid) < 3, `height at the change ${p.railAt(5000).toFixed(1)}`);
});

test("stations stay level even next to a ramp", () => {
  const p = buildVerticalProfile(
    [
      { from: 0, to: 3000, kind: "underground", layer: -1 },
      { from: 3000, to: 6000, kind: "elevated", layer: 2 },
    ],
    6000,
    [2700, 3600],
    RAIL,
  );
  for (const s of [2700, 3600]) for (let d = s - 50; d <= s + 50; d += 5) assert.ok(Math.abs(p.railAt(d) - p.railAt(s)) < 1e-6, `station at ${s} not level at ${d}`);
  assert.ok(p.railAt(2700) < 0 && p.railAt(3600) > 10);
});
