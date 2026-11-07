import { test } from "node:test";
import assert from "node:assert/strict";
import { reachablePads, standAt, walk } from "../simulation/walkSpace.ts";
import { carWalkSpace, concoursePlan, CONCOURSE, gateId, securityBarrier, stationPoints, stationWalkSpace } from "./walkPlan.ts";
import { STATION } from "./layout.ts";

const dims = { rail: 18, platformLength: 92, platformHeight: 1.1, trackCentres: 4.2 };
const plan = concoursePlan(dims);
const space = stationWalkSpace(plan);
const entry = new Set(CONCOURSE.gate.lanes.map((_, i) => gateId("entry", i)));
const exit = new Set(CONCOURSE.gate.lanes.map((_, i) => gateId("exit", i)));

test("the concourse sits under the platforms with standing headroom", () => {
  assert.ok(plan.ceilY - plan.floorY >= 3, `clear height ${plan.ceilY - plan.floorY}`);
  assert.ok(plan.platformY - plan.ceilY > 4, "platform above the concourse roof");
  // The escalator bank stands outside the viaduct deck, so it rises past it rather than through it.
  assert.ok(CONCOURSE.escalator.up[0] > STATION.halfWidth, "escalators clear the deck");
  assert.ok(Math.abs(plan.escalator.rise / plan.escalator.run - Math.tan(Math.PI / 6)) < 1e-9, "30 degree escalators");
  // Headroom under the roof slab where the opening starts.
  const riseAtOpening = (plan.roofOpening.x0 - plan.escalator.x0) * Math.tan(CONCOURSE.escalator.angle);
  assert.ok(plan.ceilY - (plan.floorY + riseAtOpening) > 2.2, "headroom at the foot of the escalator");
});

test("from the street, the platform is reached only through an entry gate", () => {
  for (const s of [-1, 1] as const) {
    const pts = stationPoints(plan, s);
    assert.ok(standAt(space, pts.spawn.x, pts.spawn.z, pts.spawn.y), "spawn is on the footpath");
    const closed = reachablePads(space, pts.spawn);
    for (const id of ["hall-west", "hall-east", "corridor-l", "corridor-r", "street-el", "street-er"]) assert.ok(closed.has(id), `${id} reachable without a ticket`);
    for (const id of ["entry-lane-0", "island", "escalator-up-l", "landing-r", "platform-l", "platform-r"]) assert.ok(!closed.has(id), `${id} is behind the security check`);
    assert.ok(!reachablePads(space, pts.spawn, entry).has("island"), "the gates cannot be reached around the security check");
    // Clearing either lane is enough to reach the bag and every gate lane.
    for (const lane of [0, 1]) {
      const cleared = reachablePads(space, pts.spawn, new Set([securityBarrier(lane)]));
      for (const id of CONCOURSE.gate.lanes.map((_, i) => `entry-lane-${i}`)) assert.ok(cleared.has(id), `${id} reachable once cleared`);
      assert.ok(!cleared.has("island"), "the fare gates are still closed");
    }
    const open = reachablePads(space, pts.spawn, new Set([securityBarrier(0), ...entry]));
    for (const id of ["island", "escalator-up-l", "escalator-up-r", "landing-l", "screen-gap-r", "platform-l", "platform-r"]) assert.ok(open.has(id), `${id} reachable with the gates open`);
  }
});

/** Is there a way on foot between two points, with these barriers open? Pads alone can't say: both lanes share the hall's. */
function connected(from: { x: number; z: number; y: number }, to: { x: number; z: number }, open: ReadonlySet<string>): boolean {
  const cell = 0.1;
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const p = queue.pop()!;
    if (Math.hypot(p.x - to.x, p.z - to.z) < cell * 1.5) return true;
    for (const [dx, dz] of [[cell, 0], [-cell, 0], [0, cell], [0, -cell]]) {
      const x = p.x + dx;
      const z = p.z + dz;
      if (x < -20 || x > -7 || Math.abs(z) > 6) continue;
      const key = `${x.toFixed(2)}:${z.toFixed(2)}`;
      if (seen.has(key) || !standAt(space, x, z, p.y, open)) continue;
      seen.add(key);
      queue.push({ x, z, y: p.y });
    }
  }
  return false;
}

test("security: the bag is reached only by way of a lane, and both lanes can be walked", () => {
  const pts = stationPoints(plan, 1);
  const hall = { x: -16, z: 0, y: plan.floorY };
  const none = new Set<string>();
  assert.ok(connected(hall, pts.bagDrop, none), "the belt's near end is in the hall");
  assert.ok(!connected(hall, pts.bagCollect, none), "the far end of the belt is behind the barriers");
  pts.security.forEach((spot, lane) => {
    assert.ok(connected(hall, spot, none), `the ${CONCOURSE.security.lanes[lane].id} lane opens from the hall`);
    assert.ok(connected(spot, pts.bagCollect, new Set([securityBarrier(lane)])), "its barrier leads to the bag");
    assert.ok(!connected(spot, pts.bagCollect, none), "and only its barrier");
  });
  // The exit guard stands clear of the way out.
  const G = CONCOURSE.exitGuard;
  assert.equal(standAt(space, G.x, G.z, plan.floorY), null, "the exit guard is in the way like anyone else");
  assert.ok(standAt(space, G.x, 0, plan.floorY), "and leaves the exit lanes clear");
});

test("from the platform, the street is reached only through an exit gate", () => {
  const pts = stationPoints(plan, -1);
  const closed = reachablePads(space, pts.platform);
  assert.ok(closed.has("island") && closed.has("escalator-down-l") && closed.has("exit-lane-2"));
  assert.ok(!closed.has("hall-east") && !closed.has("street-el"));
  const open = reachablePads(space, pts.platform, exit);
  assert.ok(open.has("hall-east") && open.has("street-el") && open.has("street-er") && open.has("stairs-wl"));
});

test("everything the passenger uses can be stood at", () => {
  for (const s of [-1, 1] as const) {
    const pts = stationPoints(plan, s);
    const spots = [pts.spawn, ...pts.counters, ...pts.security, pts.bagDrop, pts.bagCollect, ...pts.entryLanes, ...pts.exitLanes, pts.escalatorFoot, pts.platform, pts.escalatorHead, pts.street];
    for (const p of spots) assert.ok(standAt(space, p.x, p.z, p.y), `(${p.x}, ${p.z}, ${p.y})`);
    // The ticket box is furniture: you stand beside it, not on it.
    assert.equal(standAt(space, pts.ticketBox.x, pts.ticketBox.z, pts.ticketBox.y), null);
    assert.ok(standAt(space, pts.ticketBox.x - 0.8, pts.ticketBox.z, pts.ticketBox.y));
  }
});

test("the escalators carry a standing passenger between concourse and platform", () => {
  const pts = stationPoints(plan, 1);
  // Just past where the floor and the landing overlap the ends of the ramp.
  let p = { x: plan.escalator.x0 + 0.3, z: pts.escalatorFoot.z, y: plan.floorY };
  let pad = "";
  for (let t = 0; t < 30 && pad !== "landing-r"; t += 0.05) {
    const r = walk(space, p, 0, 0, 0.05)!;
    p = r;
    pad = r.pad.id;
  }
  assert.equal(pad, "landing-r", "up escalator arrives on the landing");
  assert.ok(Math.abs(p.y - plan.platformY) < 1e-6);
  let q = { x: plan.escalator.x1 - 0.4, z: pts.escalatorHead.z, y: plan.platformY };
  pad = "";
  for (let t = 0; t < 30 && pad !== "island-west-r"; t += 0.05) {
    const r = walk(space, q, 0, 0, 0.05)!;
    q = r;
    pad = r.pad.id;
  }
  assert.equal(pad, "island-west-r", "down escalator arrives in the paid area");
  assert.ok(Math.abs(q.y - plan.floorY) < 1e-6);
});

test("the stairs span the full height at a walkable slope", () => {
  const rise = plan.floorY - plan.streetY;
  const slope = Math.atan2(rise, plan.stairs.bottom - plan.stairs.top);
  assert.ok(slope > 0.5 && slope < 0.62, `slope ${slope}`);
  assert.ok(Math.abs(rise / plan.stairs.steps - CONCOURSE.stairs.riser) < 0.01, "riser height");
});

test("inside a car: the aisle and every doorway, but not the benches", () => {
  const car = carWalkSpace({ xRear: -11, xFront: 11, doors: [-8.55, -2.85, 2.85, 8.55], doorHalf: 0.72, floorY: 1.13, innerHalf: 1.38 });
  const all = reachablePads(car, { x: 0, z: 0, y: 1.13 }, new Set(), 0.1);
  assert.equal(all.size, 5, "aisle and four vestibules joined");
  assert.ok(standAt(car, -2.85, -1.0, 1.13), "at a door");
  assert.equal(standAt(car, 0, -1.0, 1.13), null, "a bench");
});

test("ticket windows: stand at the counter, but not inside its shelf", () => {
  const O = CONCOURSE.office;
  for (const s of [-1, 1] as const) {
    for (const c of stationPoints(plan, s).counters) {
      assert.ok(standAt(space, c.x, c.z, c.y), `stand at the window at z ${c.z}`);
      // Body radius clear of the shelf's front edge.
      assert.ok(!standAt(space, O.x0 - O.shelf - 0.15, c.z, c.y), "the shelf is solid");
      assert.ok(standAt(space, O.x0 - O.shelf - 0.35, c.z, c.y), "right up to the shelf");
    }
  }
});
