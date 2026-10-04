import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAR_M,
  NEAR_M,
  distanceGain,
  dopplerRatio,
  hornProfile,
  listenerCutoff,
  listenerLevel,
  pickNearest,
  type VehicleKind,
} from "./trafficAudioMath.ts";
import { mulberry32 } from "../utils/random.ts";

test("street level is full up close, fades steadily when zooming out, silent far away", () => {
  assert.equal(listenerLevel(0), 1);
  assert.equal(listenerLevel(NEAR_M), 1);
  let prev = 1;
  for (let d = NEAR_M; d <= FAR_M + 200; d += 10) {
    const l = listenerLevel(d);
    assert.ok(l >= 0 && l <= 1, `level ${l} at ${d} m`);
    assert.ok(l <= prev + 1e-12, `level rose at ${d} m`);
    prev = l;
  }
  assert.equal(listenerLevel(FAR_M), 0);
  assert.equal(listenerLevel(3000), 0);
  // Gradual, not a cliff: still clearly audible a few hundred metres out.
  assert.ok(listenerLevel(300) > 0.25);
});

test("far traffic is muffled", () => {
  assert.ok(Math.abs(listenerCutoff(NEAR_M) - 2000) < 1e-6);
  assert.ok(Math.abs(listenerCutoff(FAR_M) - 250) < 1e-6);
  assert.ok(listenerCutoff(400) < listenerCutoff(100));
});

test("point sources fall off with distance and stop at the range limit", () => {
  assert.equal(distanceGain(2, 6, 70), 1);
  assert.ok(distanceGain(20, 6, 70) < distanceGain(10, 6, 70));
  assert.equal(distanceGain(70, 6, 70), 0);
  assert.equal(distanceGain(Number.NaN, 6, 70), 0);
});

test("doppler raises pitch when approaching, lowers it when receding", () => {
  assert.equal(dopplerRatio(0), 1);
  assert.ok(dopplerRatio(15) > 1);
  assert.ok(dopplerRatio(-15) < 1);
  assert.ok(Number.isFinite(dopplerRatio(1e6)));
});

test("nearest vehicles are picked closest first, within range", () => {
  const c = [40, 5, 90, 12, 3, 66, 8].map((d, i) => ({ d, i }));
  const near = pickNearest(c, 4, 70);
  assert.deepEqual(near.map((x) => x.d), [3, 5, 8, 12]);
  assert.deepEqual(pickNearest(c, 10, 10).map((x) => x.d), [3, 5, 8]);
  assert.equal(pickNearest([], 4, 70).length, 0);
});

test("horns stay in their pitch ranges", () => {
  const rng = mulberry32(7);
  const ranges: Record<VehicleKind, [number, number]> = { auto: [560, 650], bike: [520, 620], car: [380, 460], bus: [250, 320] };
  for (const kind of Object.keys(ranges) as VehicleKind[]) {
    for (let i = 0; i < 50; i++) {
      const h = hornProfile(kind, rng);
      assert.ok(h.freqs[0] >= ranges[kind][0] && h.freqs[0] <= ranges[kind][1], `${kind} ${h.freqs[0]}`);
      assert.ok(h.beeps >= 1 && h.beeps <= 3 && h.beepSeconds > 0);
    }
  }
});
