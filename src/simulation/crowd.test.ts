import { test } from "node:test";
import assert from "node:assert/strict";
import { crowdFactor } from "./crowd.ts";

test("auto crowd follows the peaks of a weekday", () => {
  assert.ok(Math.abs(crowdFactor("auto", 9) - 0.9) < 1e-9, "morning peak");
  assert.ok(Math.abs(crowdFactor("auto", 18.5) - 0.9) < 1e-9, "evening peak");
  assert.ok(Math.abs(crowdFactor("auto", 14) - 0.5) < 1e-9, "midday shoulder");
  assert.ok(Math.abs(crowdFactor("auto", 2) - 0.15) < 1e-9, "late night");
  assert.ok(crowdFactor("auto", 7) > crowdFactor("auto", 6) && crowdFactor("auto", 7) < 0.9, "ramps into the peak");
});

test("auto crowd stays within 0..1 for every minute and wraps the day", () => {
  for (let m = 0; m < 24 * 60; m++) {
    const f = crowdFactor("auto", m / 60);
    assert.ok(f >= 0 && f <= 1, `factor ${f} at ${m} min`);
  }
  assert.equal(crowdFactor("auto", 24 + 9), crowdFactor("auto", 9));
  assert.equal(crowdFactor("auto", -15), crowdFactor("auto", 9));
});

test("fixed crowd levels ignore the clock and are ordered", () => {
  for (const h of [3, 9, 14, 18]) {
    assert.equal(crowdFactor("light", h), 0.2);
    assert.equal(crowdFactor("busy", h), 0.6);
    assert.equal(crowdFactor("packed", h), 1);
  }
  assert.ok(crowdFactor("light", 0) < crowdFactor("busy", 0) && crowdFactor("busy", 0) < crowdFactor("packed", 0));
});
