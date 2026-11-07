import { test } from "node:test";
import assert from "node:assert/strict";
import { floorAt, reachablePads, standAt, STEP_HEIGHT, walk, type WalkSpace } from "./walkSpace.ts";
import { PassengerTrip, tripObjective, type TripStage } from "./PassengerTrip.ts";

/** A hall, a ramp up to a deck, a gate lane beyond the hall and a pillar in the middle of it. */
const space: WalkSpace = {
  pads: [
    { id: "hall", zone: "unpaid", x0: 0, x1: 10, z0: -3, z1: 3, y0: 0, y1: 0 },
    { id: "ramp", zone: "escalator", x0: 9.9, x1: 15, z0: 1, z1: 2, y0: 0, y1: 3, conveyor: 1 },
    { id: "deck", zone: "platform", x0: 14.9, x1: 20, z0: -3, z1: 3, y0: 3, y1: 3 },
    { id: "lane", zone: "gate", x0: -2, x1: 0.1, z0: -0.3, z1: 0.3, y0: 0, y1: 0 },
    { id: "beyond", zone: "paid", x0: -6, x1: -1.9, z0: -3, z1: 3, y0: 0, y1: 0 },
  ],
  obstacles: [{ x0: 4.5, x1: 5.5, z0: -0.5, z1: 0.5, y0: 0, y1: 2.5 }],
  barriers: [{ id: "gate", x0: -1.1, x1: -0.9, z0: -0.75, z1: 0.75, y0: 0, y1: 1.2 }],
};

test("the floor is the pad nearest in height, within one step", () => {
  assert.equal(floorAt(space, 2, 0, 0)?.pad.id, "hall");
  assert.equal(floorAt(space, 12, 1.5, 1.2)?.pad.id, "ramp");
  assert.ok(Math.abs(floorAt(space, 12.45, 1.5, 1.5)!.y - 1.5) < 1e-9, "ramp height is linear in x");
  // Under the deck at ground level there is nothing to stand on, and no jumping up to it.
  assert.equal(floorAt(space, 17, 0, 0), null);
  assert.equal(floorAt(space, 17, 0, 3 - STEP_HEIGHT - 0.01), null);
  assert.equal(floorAt(space, 30, 0, 0), null);
});

test("walls stop the walker and it slides along them", () => {
  // Straight into the hall's side wall: no further than the pad edge.
  const hit = walk(space, { x: 2, z: 2.8, y: 0 }, 0, 1, 0)!;
  assert.ok(hit.blocked && hit.z <= 3 + 1e-9 && hit.z > 2.8);
  // Diagonally into it: z stops at the wall, x carries on.
  const slide = walk(space, { x: 2, z: 2.95, y: 0 }, 1, 1, 0)!;
  assert.ok(slide.blocked && slide.z <= 3 + 1e-9 && Math.abs(slide.x - 3) < 0.16, `slid to x ${slide.x}`);
});

test("furniture blocks by the walker's radius, and only at its own height", () => {
  const stopped = walk(space, { x: 3, z: 0, y: 0 }, 2, 0, 0)!;
  assert.ok(stopped.blocked && stopped.x < 4.5 - 0.29, `stopped at ${stopped.x}`);
  assert.equal(standAt(space, 5, 0, 0), null);
  // The same spot one storey up (on the deck) is clear of a 2.5 m pillar below.
  assert.equal(standAt({ ...space, obstacles: [{ ...space.obstacles[0], x0: 16, x1: 17 }] }, 16.5, 0, 3)?.pad.id, "deck");
});

test("a long move never tunnels through a thin barrier", () => {
  const r = walk(space, { x: 0, z: 0, y: 0 }, -5, 0, 0)!;
  assert.ok(r.blocked && r.x > -0.9, `stopped at ${r.x}`);
  const open = walk(space, { x: 0, z: 0, y: 0 }, -5, 0, 0, new Set(["gate"]))!;
  assert.ok(!open.blocked && Math.abs(open.x + 5) < 1e-9 && open.pad.id === "beyond");
});

test("a walker caught inside furniture or a shut gate can walk out, but not back in", () => {
  // Inside the pillar: free to leave in any direction the floor allows.
  const out = walk(space, { x: 5, z: 0, y: 0 }, 1.5, 0, 0)!;
  assert.ok(Math.abs(out.x - 6.5) < 1e-9, `walked out to ${out.x}`);
  const back = walk(space, { x: out.x, z: 0, y: 0 }, -1.5, 0, 0)!;
  assert.ok(back.blocked && back.x > 5.5 + 0.29, `stopped at ${back.x}`);
  // In a gate lane as it shuts: on through to the far side.
  const through = walk(space, { x: -1, z: 0, y: 0 }, -2, 0, 0)!;
  assert.equal(through.pad.id, "beyond");
});

test("ramps carry the walker up, and a moving ramp carries them on its own", () => {
  let p = { x: 9.5, z: 1.5, y: 0 };
  for (let i = 0; i < 40; i++) p = walk(space, p, 0.2, 0, 0)!;
  assert.equal(floorAt(space, p.x, p.z, p.y)?.pad.id, "deck");
  assert.ok(Math.abs(p.y - 3) < 1e-9);
  // Standing still on the escalator for six seconds: carried to the top and set down on the deck.
  let q = { x: 10, z: 1.5, y: 0.06 };
  let last = walk(space, q, 0, 0, 0)!;
  for (let t = 0; t < 6; t += 0.05) {
    last = walk(space, q, 0, 0, 0.05)!;
    q = last;
  }
  assert.equal(last.pad.id, "deck");
  assert.ok(!last.blocked, "being set down at the top is not a collision");
});

test("flood fill reaches the far side only through an open gate", () => {
  const closed = reachablePads(space, { x: 2, z: 0, y: 0 });
  assert.ok(closed.has("hall") && closed.has("deck") && closed.has("lane"));
  assert.ok(!closed.has("beyond"));
  assert.ok(reachablePads(space, { x: 2, z: 0, y: 0 }, new Set(["gate"])).has("beyond"));
});

test("a full trip runs through every stage in order", () => {
  const trip = new PassengerTrip({ originWalkable: true, destinationWalkable: true });
  const seen: TripStage[] = [trip.stage];
  const step = (fn: () => unknown) => {
    fn();
    seen.push(trip.stage);
  };
  assert.ok(trip.holdsTrain && !trip.hasTicket);
  assert.equal(trip.scanEntry(), "no-ticket");
  assert.equal(trip.board(), false, "no boarding without passing the gate");
  step(() => trip.buyTicket());
  assert.equal(trip.buyTicket(), false, "one ticket per trip");
  assert.equal(trip.scanEntry(), "not-cleared", "no gate before the security check");
  assert.equal(trip.clearSecurity(), false, "the bag goes on the belt before the body scan");
  step(() => assert.ok(trip.dropBag()));
  assert.equal(trip.dropBag(), false, "one bag per trip");
  assert.equal(trip.collectBag(), false, "the bag comes back only after the body scan");
  step(() => assert.ok(trip.clearSecurity()));
  assert.equal(trip.clearSecurity(), false, "one check per trip");
  assert.equal(trip.scanEntry(), "not-cleared", "no gate without the bag");
  step(() => assert.ok(trip.collectBag()));
  step(() => assert.equal(trip.scanEntry(), "ok"));
  assert.equal(trip.scanEntry(), "already-scanned");
  step(() => trip.reachPlatform());
  step(() => assert.ok(trip.board()));
  assert.ok(!trip.holdsTrain && trip.aboard);
  assert.equal(trip.scanExit(), "not-here");
  assert.equal(trip.alight(), false, "doors stay shut to the passenger until the destination");
  step(() => trip.arrive());
  step(() => assert.ok(trip.alight()));
  step(() => assert.equal(trip.scanExit(), "ok"));
  assert.equal(trip.scanExit(), "already-scanned");
  step(() => assert.ok(trip.dropTicket()));
  assert.ok(!trip.hasTicket && trip.ticketDropped);
  step(() => trip.reachStreet());
  assert.deepEqual(seen, ["buy-ticket", "drop-bag", "security", "collect-bag", "enter-gate", "to-platform", "board", "riding", "alight", "exit-gate", "drop-ticket", "leave-station", "done"]);
  assert.equal(trip.target, "none");
});

test("walking off with the used ticket still ends the trip", () => {
  const trip = new PassengerTrip({ originWalkable: true, destinationWalkable: true, rideStarted: true });
  assert.ok(trip.startedAboard && trip.hasTicket && trip.stage === "riding");
  trip.arrive();
  trip.alight();
  trip.scanExit();
  trip.reachStreet();
  assert.equal(trip.stage, "done");
  assert.ok(trip.hasTicket && !trip.ticketDropped);
});

test("stations that cannot be walked through are skipped", () => {
  const trip = new PassengerTrip({ originWalkable: false, destinationWalkable: false });
  assert.equal(trip.stage, "riding");
  assert.ok(!trip.holdsTrain, "the train leaves as usual");
  trip.arrive();
  assert.equal(trip.stage, "done");
});

test("every stage has an objective and a sensible target", () => {
  const names = { from: "Porur", to: "Vadapalani" };
  const stages: TripStage[] = ["buy-ticket", "drop-bag", "security", "collect-bag", "enter-gate", "to-platform", "board", "riding", "alight", "exit-gate", "drop-ticket", "leave-station", "done"];
  for (const s of stages) assert.ok(tripObjective(s, names).length > 5, s);
  assert.match(tripObjective("buy-ticket", names), /Vadapalani/);
  const trip = new PassengerTrip({ originWalkable: true, destinationWalkable: true });
  assert.equal(trip.target, "counter");
  trip.buyTicket();
  assert.equal(trip.target, "bag-drop");
  trip.dropBag();
  assert.equal(trip.target, "security");
  trip.clearSecurity();
  assert.equal(trip.target, "bag-collect");
  trip.collectBag();
  assert.equal(trip.target, "entry-gate");
});
