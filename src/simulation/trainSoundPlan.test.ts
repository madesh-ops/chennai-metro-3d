import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LOOP_OVERLAP_S, trainSoundLayers, type ClipLengths, type SoundLayer } from "./trainSoundPlan.ts";
import { buildRouteModel } from "./RouteController.ts";
import { planJourney } from "./Journey.ts";
import { simulateJourney } from "./TrainController.ts";
import type { DataBundle } from "./types.ts";

const LEN: ClipLengths = { start: 23.1, run: 13.5, stop: 16.9 };
// Origin departs at 10 s, arrives 80 s later; long dwell; terminus never departs.
const STOPS = [
  { departTime: 10, arriveTime: 0 },
  { departTime: 120, arriveTime: 90 },
  { departTime: Infinity, arriveTime: 170 },
];

const power = (ls: SoundLayer[]) => ls.reduce((s, l) => s + l.gain * l.gain, 0);
const only = (ls: SoundLayer[], clip: string) => ls.length > 0 && ls.every((l) => l.clip === clip);

test("departure clip plays from the moment the train leaves", () => {
  const ls = trainSoundLayers(12, STOPS, LEN);
  assert.ok(only(ls, "start"));
  assert.ok(Math.abs(ls[0].offset - 2) < 1e-9);
  assert.equal(ls[0].gain, 1);
});

test("running loop mid-run: offsets inside the clip, constant loudness", () => {
  for (let t = 40; t < 72; t += 0.05) {
    const ls = trainSoundLayers(t, STOPS, LEN);
    assert.ok(only(ls, "run"), `t=${t}: ${ls.map((l) => l.clip)}`);
    for (const l of ls) assert.ok(l.offset >= 0 && l.offset < LEN.run, `offset ${l.offset}`);
    assert.ok(Math.abs(power(ls) - 1) < 1e-6, `power ${power(ls)} at ${t}`);
  }
});

test("braking clip ends exactly as the train halts", () => {
  const ls = trainSoundLayers(89, STOPS, LEN);
  assert.ok(only(ls, "stop"));
  assert.ok(Math.abs(ls[0].offset - (LEN.stop - 1)) < 1e-9);
  assert.equal(trainSoundLayers(90, STOPS, LEN).length, 0);
});

test("silent before departure, during dwell and at the terminus", () => {
  for (const t of [0, 5, 9.99, 90, 100, 119.99, 170, 400]) assert.equal(trainSoundLayers(t, STOPS, LEN).length, 0, `t=${t}`);
});

test("crossfades are smooth: no jumps in loudness from departure to halt", () => {
  let prev = power(trainSoundLayers(10, STOPS, LEN));
  for (let t = 10.01; t < 89.7; t += 0.01) {
    const p = power(trainSoundLayers(t, STOPS, LEN));
    assert.ok(Math.abs(p - prev) < 0.02, `jump ${prev.toFixed(3)} → ${p.toFixed(3)} at ${t.toFixed(2)}`);
    assert.ok(p > 0.95 && p < 1.05, `power ${p} at ${t.toFixed(2)}`);
    prev = p;
  }
});

test("loop repeats overlap and keep stable keys", () => {
  const period = LEN.run - LOOP_OVERLAP_S;
  const runStart = 10 + LEN.start - 1.5;
  const t = runStart + period + LOOP_OVERLAP_S / 2;
  const keys = trainSoundLayers(t, STOPS, LEN).map((l) => l.key).sort();
  assert.deepEqual(keys, ["run:0:0", "run:0:1"]);
});

test("a run shorter than both clips goes straight from departure to braking", () => {
  const short = [
    { departTime: 0, arriveTime: 0 },
    { departTime: Infinity, arriveTime: 30 },
  ];
  assert.ok(only(trainSoundLayers(5, short, LEN), "start"));
  const mid = trainSoundLayers(14, short, LEN);
  assert.ok(mid.some((l) => l.clip === "start") && mid.some((l) => l.clip === "stop"));
  assert.ok(!mid.some((l) => l.clip === "run"));
  assert.ok(only(trainSoundLayers(29, short, LEN), "stop"));
});

test("works on a real journey: every run starts, cruises and stops", () => {
  const load = (n: string) => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), "utf8"));
  const data: DataBundle = { stations: load("stations"), routes: load("routes"), tracks: load("tracks"), landmarks: load("landmarks") };
  const route = buildRouteModel(data);
  const traj = simulateJourney(planJourney(route, "poonamallee-bypass", "vadapalani"), route.operations);
  for (let k = 0; k < traj.stops.length - 1; k++) {
    const d = traj.stops[k].departTime;
    const a = traj.stops[k + 1].arriveTime;
    assert.ok(only(trainSoundLayers(d + 1, traj.stops, LEN), "start"));
    assert.ok(trainSoundLayers((d + a) / 2, traj.stops, LEN).some((l) => l.clip === "run"));
    assert.ok(only(trainSoundLayers(a - 0.5, traj.stops, LEN), "stop"));
  }
});
