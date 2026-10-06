import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRouteModel, RouteDataError } from "./RouteController.ts";
import { planJourney } from "./Journey.ts";
import { simulateJourney, createSample } from "./TrainController.ts";
import { SimulationEngine } from "./SimulationEngine.ts";
import type { DataBundle, TrainState } from "./types.ts";

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
const data: DataBundle = {
  stations: load("stations"),
  routes: load("routes"),
  tracks: load("tracks"),
  landmarks: load("landmarks"),
  network: load("network"),
};

test("route model matches published length and station order", () => {
  const route = buildRouteModel(data);
  const modelled = route.endDistance - route.startDistance;
  // The real (OpenStreetMap) track between the termini should be within 2 % of the published 14.64 km.
  assert.ok(Math.abs(modelled - 14640) / 14640 < 0.02, `modelled length ${modelled.toFixed(0)} m`);
  assert.equal(route.stations.length, 17);
  assert.equal(route.stops.length, 11);
  for (let i = 1; i < route.stations.length; i++) {
    assert.ok(route.stations[i].distance > route.stations[i - 1].distance, `order broken at ${route.stations[i].id}`);
  }
  assert.ok(Math.abs(route.stations.at(-1)!.km - 14.64) < 1e-6);
  assert.ok(route.doubleDecker && route.doubleDecker.end > route.doubleDecker.start);
});

test("invalid data produces a readable error", () => {
  const broken: DataBundle = structuredClone(data);
  broken.routes.routes[0].stationIds.push("nowhere");
  assert.throws(() => buildRouteModel(broken), RouteDataError);
});

test("journey planning covers served and passed stations", () => {
  const route = buildRouteModel(data);
  const j = planJourney(route, "poonamallee-bypass", "vadapalani");
  assert.equal(j.stops.length, 11);
  assert.equal(j.passes.length, 6);
  assert.equal(j.direction, 1);
  assert.throws(() => planJourney(route, "alapakkam", "vadapalani"), RouteDataError);
  const r = planJourney(route, "vadapalani", "porur-bypass");
  assert.equal(r.direction, -1);
  assert.deepEqual(
    r.stops.map((s) => s.station.id),
    ["vadapalani", "porur-junction", "porur-bypass"],
  );
});

for (const [from, to] of [
  ["poonamallee-bypass", "vadapalani"],
  ["vadapalani", "poonamallee-bypass"],
  ["kumananchavadi", "kattupakkam"],
] as const) {
  test(`trajectory ${from} → ${to} is physically sound`, () => {
    const route = buildRouteModel(data);
    const j = planJourney(route, from, to);
    const traj = simulateJourney(j, route.operations);
    const s = createSample();
    const seen = new Set<TrainState>();
    let prevX = 0;
    let prevV = 0;
    let maxA = 0;
    let minA = 0;
    let maxJerkViolations = 0;
    for (let t = 0; t <= traj.duration; t += 0.1) {
      traj.sample(t, s);
      seen.add(s.state);
      assert.ok(s.x >= prevX - 1e-6, `moved backwards at t=${t.toFixed(1)}`);
      const nextStop = j.stops[s.stopIndex + 1];
      if (nextStop) assert.ok(s.x <= nextStop.x + 1e-6, `overshot ${nextStop.station.name}`);
      const limit = j.limits.find((l) => s.x >= l.x0 && s.x < l.x1)?.v ?? 99;
      assert.ok(s.v <= limit + 0.6, `over speed ${(s.v * 3.6).toFixed(1)} km/h at x=${s.x.toFixed(0)}`);
      if (s.state === "doors-open" || s.state === "stopped" || s.state === "doors-closing") {
        // Sampling interpolates toward the next record, so allow a sliver at state edges.
        assert.ok(s.v < 0.05, `moving while ${s.state}: ${s.v}`);
      }
      maxA = Math.max(maxA, s.a);
      minA = Math.min(minA, s.a);
      if (Math.abs((s.v - prevV) / 0.1) > 1.6) maxJerkViolations++;
      prevX = s.x;
      prevV = s.v;
    }
    // Ends exactly at the destination platform.
    traj.sample(traj.duration, s);
    assert.ok(Math.abs(s.x - j.length) < 1e-6);
    assert.ok(maxA <= route.operations.accelerationMps2 + 1e-3, `accel ${maxA}`);
    assert.ok(minA >= -route.operations.maxBrakeMps2 * 1.25, `brake ${minA}`);
    assert.equal(maxJerkViolations, 0);
    for (const st of ["departing", "accelerating", "arriving", "stopped", "doors-open", "doors-closing"] as TrainState[]) {
      assert.ok(seen.has(st), `never entered ${st}`);
    }
    // Each stop is reached exactly.
    for (let k = 1; k < j.stops.length; k++) {
      traj.sample(traj.stops[k].arriveTime + 0.5, s);
      assert.ok(Math.abs(s.x - j.stops[k].x) < 1e-6, `stop ${k} misaligned by ${(s.x - j.stops[k].x).toFixed(3)} m`);
    }
  });
}

test("full journey duration is plausible against the reported ~30 minutes", () => {
  const route = buildRouteModel(data);
  const j = planJourney(route, "poonamallee-bypass", "vadapalani");
  const traj = simulateJourney(j, route.operations);
  const minutes = traj.duration / 60;
  console.log(`  simulated end-to-end: ${minutes.toFixed(1)} min, ${traj.stops.length} stops`);
  assert.ok(minutes > 18 && minutes < 36, `${minutes} min`);
});

test("engine playback: speed multiplier, seek and arrival phases", () => {
  const route = buildRouteModel(data);
  const engine = new SimulationEngine(route, "poonamallee-bypass", "poonamallee");
  const events: string[] = [];
  engine.onEvent((e) => events.push(e.type));
  assert.equal(engine.getSnapshot().state, "idle");
  engine.play();
  engine.setSpeed(4);
  let guard = 0;
  while (!engine.clock.finished && guard++ < 100000) engine.update(1 / 60);
  const snap = engine.getSnapshot();
  assert.ok(snap.finished);
  assert.ok(Math.abs(snap.distanceTravelled - snap.totalDistance) < 1e-6);
  assert.ok(events.includes("approaching"), events.join(","));
  assert.ok(events.includes("arrived"));
  assert.ok(events.includes("doors-closing"));
  engine.seek(engine.trajectory.stops[1].arriveTime + 1);
  assert.equal(engine.getSnapshot().arrival, "arrived");
});

test("summary journey durations match the engine exactly", async () => {
  const { journeyDuration } = await import("../lib/routeSummary.ts");
  const route = buildRouteModel(data);
  const first = route.stops[0].id;
  const last = route.stops.at(-1)!.id;
  const runs = (a: string, b: string) => {
    const t = simulateJourney(planJourney(route, a, b), route.operations);
    return t.stops.slice(1).map((s, k) => s.arriveTime - t.stops[k].departTime);
  };
  const ops = route.operations;
  const summary = {
    stopIds: route.stops.map((s) => s.id),
    segmentRun: { forward: runs(first, last), reverse: runs(last, first).reverse() },
    ops: {
      originBoarding: ops.originBoardingSeconds,
      doorClosing: ops.doorClosingSeconds,
      settle: ops.settleBeforeDoorsSeconds,
      doorOpening: ops.doorOpeningSeconds,
      dwell: ops.dwellSeconds,
      terminusAlight: ops.terminusAlightSeconds,
    },
  } as unknown as Parameters<typeof journeyDuration>[0];
  for (const [a, b] of [["poonamallee", "porur-junction"], ["vadapalani", "mullaithottam"], ["kattupakkam", "iyyappanthangal"]]) {
    const engineDuration = simulateJourney(planJourney(route, a, b), route.operations).duration;
    const est = journeyDuration(summary, a, b);
    assert.ok(Math.abs(engineDuration - est) < 0.6, `${a}→${b}: engine ${engineDuration.toFixed(1)} vs summary ${est.toFixed(1)}`);
  }
});

test("drawn landmarks resolve onto the route and clear the road", async () => {
  const { landmarkFootprints } = await import("../three/landmarkLayout.ts");
  const { BUILDING_SETBACK } = await import("../three/layout.ts");
  const route = buildRouteModel(data);
  assert.ok(route.placedLandmarks.length >= 6);
  for (const f of landmarkFootprints(route)) {
    const id = f.placement.landmark.id;
    assert.ok(f.distance > -100 && f.distance < route.alignment.length + 100, `${id} off the route`);
    assert.ok(Math.abs(f.lateral) - f.depth / 2 >= BUILDING_SETBACK, `${id} overlaps the road`);
    assert.ok(Math.abs(f.placement.distance - (route.stationById.get(f.placement.landmark.nearStation)?.distance ?? f.distance)) < 1500, `${id} is far from its station`);
  }
  // Published points are honoured: the Vadapalani temple sits north of the line near the terminus.
  const temple = route.placedLandmarks.find((p) => p.landmark.id === "vadapalani-murugan-temple")!;
  assert.ok(temple.lateral < -150 && temple.lateral > -320, `temple ${temple.lateral.toFixed(0)} m off the line`);
});

test("a broken landmark produces a readable error", () => {
  const broken: DataBundle = structuredClone(data);
  broken.landmarks.landmarks.push({ ...broken.landmarks.landmarks[0], id: "bad", position: { station: "nowhere", alongM: 0, side: "north", offsetM: 50 } });
  assert.throws(() => buildRouteModel(broken), RouteDataError);
  const noPos: DataBundle = structuredClone(data);
  noPos.landmarks.landmarks.push({ ...noPos.landmarks.landmarks[0], id: "bad2", position: undefined });
  assert.throws(() => buildRouteModel(noPos), RouteDataError);
});

/** Lateral offset of a world point from the route alignment (+ right). */
function lateralOf(route: ReturnType<typeof buildRouteModel>, x: number, z: number, guess: number) {
  const d = route.alignment.project(x, z, guess, 4000);
  const c = route.alignment.point(d);
  const r = route.alignment.right(d);
  return { d, lateral: (x - c.x) * r.x + (z - c.z) * r.z, northSign: r.z > 0 ? -1 : 1 };
}


test("Line 5 west branch follows the real track south towards Mount–Poonamallee Road", () => {
  const route = buildRouteModel(data);
  const b = route.line5Branch!;
  assert.ok(b, "branch present");
  assert.equal(b.end, "west");
  const upper = route.params.railLevel + route.params.upperDeckHeight;
  // Starts on the upper deck's west end, at upper-deck height, and comes down to normal rail level.
  const p0 = b.alignment.point(0);
  const j = route.alignment.point(b.junction);
  assert.ok(Math.hypot(p0.x - j.x, p0.z - j.z) < 0.5);
  assert.equal(b.junction, route.doubleDecker!.upperStart);
  assert.equal(b.railAt(0), upper);
  assert.ok(Math.abs(b.railAt(b.alignment.length) - route.params.railLevel) < 1e-6);
  for (let s = 0; s + 1 < b.alignment.length; s += 1) {
    assert.ok(Math.abs(b.railAt(s + 1) - b.railAt(s)) <= 0.03, `gradient at ${s} m`);
  }
  // Heads south, onto the real Line 5 track (OpenStreetMap).
  const end = b.alignment.point(b.alignment.length);
  const { lateral, northSign } = lateralOf(route, end.x, end.z, b.junction);
  assert.ok(Math.sign(lateral) === -northSign && Math.abs(lateral) > 500, `ends ${lateral.toFixed(0)} m off the corridor`);
  const l5 = data.network!.lines.find((l) => l.id === "line-5")!;
  const nearest = Math.min(...l5.track.map(([x, z]) => Math.hypot(x - end.x, z - end.z)));
  assert.ok(nearest < 6, `branch end is ${nearest.toFixed(1)} m from the Line 5 track`);
});

test("a malformed Line 5 branch produces a readable error", () => {
  const broken: DataBundle = structuredClone(data);
  broken.tracks.structures.doubleDecker.line5West!.lengthM = -5;
  assert.throws(() => buildRouteModel(broken), RouteDataError);
  const descent: DataBundle = structuredClone(data);
  descent.tracks.structures.doubleDecker.line5East!.descent = { fromM: 300, toM: 100, status: "assumed" };
  assert.throws(() => buildRouteModel(descent), RouteDataError);
});

test("MGR flyover runs along Mount–Poonamallee Road over Porur Junction", () => {
  const route = buildRouteModel(data);
  assert.equal(route.flyovers.length, 1);
  const f = route.flyovers[0];
  const mp = f.road;
  const J = route.stationById.get("porur-junction")!.distance;
  assert.equal(mp.raw.id, "mount-poonamallee-road");
  // The real road junction (OpenStreetMap) is a little west of the station.
  assert.ok(mp.junctionD < J && mp.junctionD > J - 250, `junction ${(mp.junctionD - J).toFixed(0)} m from the station`);
  assert.ok(Math.abs(f.endS - f.startS - 505) < 1e-6, "published 505 m");
  assert.equal(f.heightAt(f.startS), 0);
  assert.equal(f.heightAt(f.endS), 0);
  // Crest over the junction itself.
  // Crest at the junction: the deck height in tracks.json (matching the OSM deck in the world tiles).
  assert.ok(Math.abs(f.heightAt(mp.junctionS) - f.raw.crestDeckM.value) < 0.05);
  for (let s = f.startS; s < f.endS; s += 0.5) {
    assert.ok(Math.abs(f.heightAt(s + 0.5) - f.heightAt(s)) / 0.5 <= 0.05, `grade at ${s.toFixed(1)}`);
  }
  // West of the junction it lies under the metro; east of it, it veers away from Arcot Road.
  const dist = (s: number) => {
    const p = mp.alignment.point(s);
    const d = route.alignment.project(p.x, p.z, J, 900);
    const c = route.alignment.point(d);
    return Math.hypot(p.x - c.x, p.z - c.z);
  };
  assert.ok(dist(mp.junctionS - 100) < 20, "shares the corridor west of the junction");
  assert.ok(f.corridorFrom < mp.junctionD - 150, "its west ramp is under the metro");
  assert.ok(dist(f.endS) > 100, "well away from the metro at its east end");
  assert.ok(f.corridorTo - mp.junctionD < 60, "leaves the corridor at the junction");
  // Between the neighbouring stations, and clear of the Line 5 branch's junction.
  const i = route.stations.findIndex((s) => s.id === "porur-junction");
  assert.ok(f.corridorFrom > route.stations[i - 1].distance + 60);
  assert.ok(!route.line5Branch || f.corridorTo < route.line5Branch.junction);
});
test("Kundrathur Main Road leaves the junction to the south-west", () => {
  const route = buildRouteModel(data);
  const k = route.sideRoads.get("kundrathur-road")!;
  const J = route.alignment.point(route.stationById.get("porur-junction")!.distance);
  const end = k.alignment.point(k.alignment.length);
  assert.ok(end.x < J.x && end.z > J.z, "ends west and south of the junction");
});

test("steel portals clear the flyover and the outer lane", async () => {
  const { FLYOVER_PORTAL_OFFSET, ROAD } = await import("../three/layout.ts");
  const route = buildRouteModel(data);
  const f = route.flyovers[0];
  const halfVehicle = 1.3;
  assert.ok(FLYOVER_PORTAL_OFFSET - 0.45 > ROAD.laneCentres[2] + halfVehicle, "column clears the outer lane");
  assert.ok(FLYOVER_PORTAL_OFFSET + 0.45 < ROAD.halfWidth, "column stays inside the kerb");
  assert.ok(ROAD.laneCentres[2] - halfVehicle > f.halfWidth, "outer lane clears the flyover deck");
  assert.ok(ROAD.laneCentres[1] + halfVehicle < f.halfWidth - 0.5, "inner lanes fit between the barriers");
});

test("buses on the flyover crest pass under the metro", async () => {
  const { BUS_HEIGHT, PORTAL_BEAM_DEPTH, VIADUCT } = await import("../three/layout.ts");
  const route = buildRouteModel(data);
  const f = route.flyovers[0];
  const busTop = f.crest + BUS_HEIGHT;
  const beamBottom = route.params.railLevel + VIADUCT.girderBottom - PORTAL_BEAM_DEPTH;
  assert.ok(busTop + 0.3 < beamBottom, `bus top ${busTop} m vs portal beam ${beamBottom} m`);
  assert.ok(f.crest - 1.2 > BUS_HEIGHT + 0.5);
});

test("malformed flyover data produces a readable error", () => {
  const broken: DataBundle = structuredClone(data);
  broken.tracks.structures.flyovers![0].road = "nowhere";
  assert.throws(() => buildRouteModel(broken), RouteDataError);
  const ramps: DataBundle = structuredClone(data);
  ramps.tracks.structures.flyovers![0].rampM.value = 400;
  assert.throws(() => buildRouteModel(ramps), RouteDataError);
  const len: DataBundle = structuredClone(data);
  len.tracks.structures.flyovers![0].toJunctionM = 400;
  assert.throws(() => buildRouteModel(len), RouteDataError);
});

test("no traffic drives inside the flyover deck or the station concourse", async () => {
  const { placeVehicle, createPlacement } = await import("../three/trafficPlacement.ts");
  const { BUS_HEIGHT, STATION } = await import("../three/layout.ts");
  const route = buildRouteModel(data);
  const f = route.flyovers[0];
  const J = f.road.junctionD;
  const range: [number, number] = [0, route.alignment.length];
  const out = createPlacement();
  const concourseBottom = route.params.railLevel - STATION.concourseBelowRail;
  for (const dir of [1, -1] as const) {
    for (let lane = 0; lane < 3; lane++) {
      for (let s = J - 260; s < J + 200; s += 2) {
        const at = placeVehicle(route, { kind: "bus", index: 0, s, lane, dir }, range, out);
        if (!at.visible) continue;
        // Vehicles on the deck ride at deck height; at-grade vehicles must be clear of it.
        const rs = f.road.alignment.project(at.x, at.z, f.road.junctionS + (s - J), 200);
        const q = f.road.alignment.point(rs);
        const off = Math.hypot(at.x - q.x, at.z - q.z);
        const deck = f.heightAt(rs);
        if (deck > 0.2 && off < f.halfWidth + 1.3) {
          assert.ok(Math.abs(at.y - 0.03 - deck) < 0.3, `lane ${lane} dir ${dir} at J${(s - J).toFixed(0)} is inside the deck`);
        }
        // And every bus beneath a station concourse keeps its roof under it.
        const underConcourse = route.stations.some((st) => Math.abs(s - st.distance) < STATION.concourseLength / 2 + 2);
        if (underConcourse) assert.ok(at.y + BUS_HEIGHT < concourseBottom - 0.3, `bus roof ${(at.y + BUS_HEIGHT).toFixed(2)} m reaches the concourse`);
      }
    }
  }
});

test("Line 5 leaves the upper deck smoothly: no kink, no tight curve", () => {
  const route = buildRouteModel(data);
  for (const b of route.line5Branches) {
    const t = route.alignment.tangent(b.junction);
    const bt = b.alignment.tangent(0.5);
    const dir = b.end === "west" ? -1 : 1;
    const kink = (Math.acos(Math.min(1, dir * (t.x * bt.x + t.z * bt.z))) * 180) / Math.PI;
    assert.ok(kink < 2, `${b.end}: kink of ${kink.toFixed(1)} degrees where it leaves the upper deck`);
    // OpenStreetMap draws some Line 5 bends with few nodes (corners down to ~45 m); nothing tighter.
    for (let s = 2; s < b.alignment.length - 2; s += 1) {
      let dh = Math.abs(b.alignment.heading(s + 2) - b.alignment.heading(s - 2));
      if (dh > Math.PI) dh = 2 * Math.PI - dh;
      assert.ok(4 / Math.max(dh, 1e-9) > 45, `${b.end}: radius ${(4 / dh).toFixed(0)} m at ${s} m`);
    }
  }
});

test("Nexus Vijaya Mall and Kamala Cinemas sit either side of Arcot Road before Vadapalani", async () => {
  const { landmarkFootprints } = await import("../three/landmarkLayout.ts");
  const { BUILDING_SETBACK } = await import("../three/layout.ts");
  const route = buildRouteModel(data);
  const V = route.stationById.get("vadapalani")!.distance;
  const fps = landmarkFootprints(route);
  const mall = fps.find((f) => f.placement.landmark.id === "nexus-vijaya-mall")!;
  const cinema = fps.find((f) => f.placement.landmark.id === "kamala-cinemas")!;
  assert.ok(mall && cinema);
  const north = (f: typeof mall) => (route.alignment.right(f.distance).z > 0 ? f.lateral < 0 : f.lateral > 0);
  assert.ok(north(mall), "mall on the north side");
  assert.ok(!north(cinema), "cinema on the south side");
  assert.ok(mall.distance < V - 60 && mall.distance > V - 400, "mall a little before the station");
  assert.ok(cinema.distance < V && cinema.distance > V - 150, "cinema just before the station");
  // Clear of the road, the station's street stairs (about 16 m out) and every other landmark.
  for (const f of [mall, cinema]) {
    assert.ok(Math.abs(f.lateral) - f.depth / 2 >= BUILDING_SETBACK);
    assert.ok(Math.abs(f.lateral) - f.depth / 2 > 17);
    for (const o of fps) {
      if (o === f) continue;
      const overlap = Math.abs(o.distance - f.distance) < (o.along + f.along) / 2 && Math.abs(o.lateral - f.lateral) < (o.depth + f.depth) / 2;
      assert.ok(!overlap, `${f.placement.landmark.id} overlaps ${o.placement.landmark.id}`);
    }
  }
});

test("Line 5 east branch curves north off the upper deck towards Virugambakkam", async () => {
  const { landmarkFootprints } = await import("../three/landmarkLayout.ts");
  const route = buildRouteModel(data);
  const dd = route.doubleDecker!;
  const b = route.line5Branches.find((x) => x.end === "east")!;
  assert.ok(b, "east branch present");
  assert.equal(b.junction, dd.upperEnd);
  assert.ok(dd.upperEnd > dd.end, "upper deck runs on past Alwarthirunagar");
  const end = b.alignment.point(b.alignment.length);
  const { lateral, northSign } = lateralOf(route, end.x, end.z, b.junction);
  assert.ok(Math.sign(lateral) === northSign && Math.abs(lateral) > 500, `ends ${lateral.toFixed(0)} m off the corridor`);
  // Comes down from the upper deck to normal elevated rail level, never climbing.
  assert.equal(b.railAt(0), route.params.railLevel + route.params.upperDeckHeight);
  assert.ok(Math.abs(b.railAt(b.alignment.length) - route.params.railLevel) < 1e-6);
  for (let s = 0; s + 1 < b.alignment.length; s += 1) assert.ok(b.railAt(s + 1) <= b.railAt(s) + 1e-9);
  // Clear of every drawn landmark.
  for (const f of landmarkFootprints(route)) {
    for (let s = 0; s <= b.alignment.length; s += 5) {
      const p = b.alignment.point(s);
      const { d: pd, lateral: pl } = lateralOf(route, p.x, p.z, f.distance);
      const inside = Math.abs(pd - f.distance) < f.along / 2 + 6 && Math.abs(pl - f.lateral) < f.depth / 2 + 6;
      assert.ok(!inside, `branch at ${s} m runs through ${f.placement.landmark.id}`);
    }
  }
});

test("Chandra Metro Mall sits between Alwarthirunagar and Saligramam, on the side Line 5 turns off", async () => {
  const { landmarkFootprints } = await import("../three/landmarkLayout.ts");
  const { BUILDING_SETBACK } = await import("../three/layout.ts");
  const route = buildRouteModel(data);
  const f = landmarkFootprints(route).find((x) => x.placement.landmark.id === "chandra-metro-mall")!;
  const a = route.stationById.get("alwarthirunagar")!.distance;
  const s = route.stationById.get("saligramam")!.distance;
  assert.ok(f.distance - f.along / 2 > a && f.distance + f.along / 2 < s, "between the two stations");
  const north = route.alignment.right(f.distance).z > 0 ? f.lateral < 0 : f.lateral > 0;
  assert.ok(north, "north side, towards Virugambakkam");
  assert.ok(Math.abs(f.lateral) - f.depth / 2 >= BUILDING_SETBACK, "clear of the road");
  // Line 5 parts from Arcot Road just past it (Vadapalani side), as in the satellite view.
  const east = route.line5Branches.find((x) => x.end === "east")!;
  let parts = -1;
  for (let sd = 0; sd < east.alignment.length; sd += 2) {
    const p = east.alignment.point(sd);
    if (Math.abs(lateralOf(route, p.x, p.z, east.junction).lateral) > 20) {
      parts = lateralOf(route, p.x, p.z, east.junction).d;
      break;
    }
  }
  assert.ok(parts > f.distance + f.along / 2 && parts < f.distance + 250, `Line 5 parts ${(parts - f.distance).toFixed(0)} m past the mall`);
});

test("a neighbourhood around an unknown landmark produces a readable error", () => {
  const broken: DataBundle = structuredClone(data);
  (broken.tracks as { neighbourhoods?: { around: string }[] }).neighbourhoods![0].around = "nowhere";
  assert.throws(() => buildRouteModel(broken), RouteDataError);
});

test("every line builds from the real network and a train can run it end to end", () => {
  for (const r of data.routes.routes) {
    const route = buildRouteModel(data, r.id);
    assert.ok(route.stations.length >= 10, `${r.id}: ${route.stations.length} stations`);
    const modelled = (route.endDistance - route.startDistance) / 1000;
    assert.ok(Math.abs(modelled - r.lengthKm) / r.lengthKm < 0.07, `${r.id}: ${modelled.toFixed(2)} km vs ${r.lengthKm} km`);
    const journey = planJourney(route, route.stops[0].id, route.stops.at(-1)!.id);
    const run = simulateJourney(journey, route.operations);
    assert.ok(run.duration > 600 && run.duration < 7200, `${r.id}: ${(run.duration / 60).toFixed(0)} min`);
  }
});
