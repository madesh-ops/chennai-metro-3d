import { ROAD, STATION } from "./layout.ts";
import type { Barrier, Obstacle, Pad, WalkSpace } from "../simulation/walkSpace.ts";
import type { RouteModel, StationModel } from "../simulation/RouteController.ts";

/**
 * Floor plan of an elevated station's inside, in station-local space (origin
 * on the centreline at ground level, +x along the line, +z to the right).
 * One place for every measurement, shared by the model (stationModel.ts,
 * concourseModel.ts) and by the passenger on foot (walk pads and gates), so
 * what is drawn and what can be walked on never drift apart.
 *
 * A generic layout, not a survey of any real station:
 *
 *   street stairs at the four corners → concourse (ticket office in the
 *   west hall) → security check → entry gates → paid area → escalators up to each platform;
 *   back down → exit gates → east hall (used-ticket box) → stairs → street.
 *
 * Free of three.js so the HUD and the tests can import it.
 */

export interface PlanDims {
  rail: number;
  platformLength: number;
  platformHeight: number;
  trackCentres: number;
}

/** Fixed interior measurements (metres). `z` values are distances from the centreline; both sides mirror. */
export const CONCOURSE = {
  floorSlab: 0.6,
  roofSlab: 0.5,
  /** Inner face of the long side walls, in from the concourse edge. */
  sideWall: 0.45,
  endWall: 0.4,
  /** Street doorways in the end walls. */
  door: { z0: 13.75, z1: 16.25, height: 2.3 },
  /** Paid area: a railed island between the two halls. */
  island: { x0: -8, x1: 16, z: 12.5 },
  /** Fare-gate lanes (centres across the hall) on the island's west (entry) and east (exit) faces. */
  gate: { lanes: [-2.25, -0.75, 0.75, 2.25], pitch: 1.5, cabinetWidth: 0.35, cabinetLength: 1.3, cabinetHeight: 1.0 },
  /**
   * Security check in front of the entry gates. Bags go on the X-ray belt on
   * the -z side and ride through the machine, past the operator's monitor, to
   * the railed area before the gates. Passengers take either lane through a
   * door-frame detector: men's (open) or women's (a green enclosure). Staff
   * scan them there, and a barrier at the lane's end lets them on to their bag.
   */
  security: {
    frameX: -13,
    frameHalf: 0.6,
    frameHeight: 2.2,
    barrierX: -10.6,
    penHalf: 3.6,
    lanes: [
      { id: "men", z0: -1, z1: 1, frameZ: 0, spot: { x: -11.5, z: -0.3 }, guard: { x: -11.5, z: 0.65 } },
      { id: "women", z0: 1, z1: 3.6, frameZ: 2.3, spot: { x: -11.75, z: 1.95 }, guard: { x: -11.75, z: 3.1 } },
    ],
    /** The women's enclosure: curtains on all sides, with a doorway in line with the detector and one opposite. */
    enclosure: { x0: -12.5, x1: -11, height: 2.2 },
    belt: { x0: -15.6, x1: -9.2, z0: -3.5, z1: -2.7, top: 0.75, speed: 0.6, midLeg: -11.6 },
    machine: { x0: -13.7, x1: -12.3, z0: -3.7, z1: -2.5, height: 1.75, tunnel: 0.5 },
    /** Where a bag is put down and where it stops, along the belt. */
    bagFrom: -14.8,
    bagTo: -9.6,
    /** The operator stands in the rails between the machine and the men's lane, with the monitor on a desk. */
    operator: { x: -11.4, z: -1.5 },
    desk: { x0: -12.5, x1: -11.2, z0: -2.45, z1: -1.95, height: 0.8 },
    monitor: { x: -12, z: -2.2, width: 0.62, height: 0.42, stand: 0.14 },
  },
  /** A guard standing past the exit gates, facing those coming through. */
  exitGuard: { x: 17.6, z: 4.2 },
  /** Ticket office in the west hall; its windows face west. */
  office: { x0: -24.4, x1: -18.6, halfZ: 4.4, windows: [-2.2, 2.2], windowHalf: 0.9, shelf: 0.32 },
  /** Used-ticket box in the east hall, just past the exit gates. */
  ticketBox: { x: 18.6, z: -5, half: 0.3, height: 1.1 },
  /** Escalator bank beside each platform: up nearer the track, down outside it. */
  escalator: { xBottom: -3, angle: Math.PI / 6, up: [9.85, 10.95], down: [11.05, 12.15], stepWidth: 0.8, speed: 0.9, stepRise: 0.2 },
  /** Landing at platform level where the escalators arrive. */
  landing: { length: 4.1, z1: 12.35 },
  /** Street stairs: a short landing outside each doorway, then one flight at about 32 degrees. */
  stairs: { landing: 1.0, runPerRise: 1.6, z0: 13.8, z1: 16.2, riser: 0.17 },
  /** People standing about in the two halls: [x, z, facing (radians, 0 = +z)]. They are furniture to the walker. */
  bystanders: [
    [-29.5, -8.5, 0.9],
    [-28.7, -7.9, -2.2],
    [-13.5, 9.5, 2.6],
    [-12, -11, 0.4],
    [22, 8.5, -1.9],
    [27.5, -10.5, 2.4],
    [26.7, -9.9, -0.7],
  ],
} as const;

export interface ConcoursePlan {
  /** Concourse floor, roof-slab underside, platform top and footpath heights. */
  floorY: number;
  ceilY: number;
  platformY: number;
  streetY: number;
  halfLength: number;
  halfWidth: number;
  /** Platform edge and outer screen (distance from the centreline). */
  platformEdge: number;
  platformOuter: number;
  platformHalfLength: number;
  escalator: { x0: number; x1: number; rise: number; run: number };
  /** Opening in the concourse roof over each escalator bank. */
  roofOpening: { x0: number; x1: number; z0: number; z1: number };
  landing: { x0: number; x1: number; z0: number; z1: number };
  /** Gap in the platform's outer glass screen, onto the landing. */
  screenGap: { x0: number; x1: number };
  /** Street stairs: the flight runs from |x| = top (concourse floor) out to |x| = bottom (footpath). */
  stairs: { top: number; bottom: number; steps: number };
}

export function concoursePlan(d: PlanDims): ConcoursePlan {
  const base = d.rail - STATION.concourseBelowRail;
  const floorY = base + CONCOURSE.floorSlab;
  const ceilY = base + STATION.concourseHeight - CONCOURSE.roofSlab;
  const platformY = d.rail + d.platformHeight;
  const streetY = ROAD.kerb;
  const halfLength = STATION.concourseLength / 2;
  const platformEdge = d.trackCentres / 2 + 1.52;
  const platformOuter = platformEdge + 4.3;
  const rise = platformY - floorY;
  const run = rise / Math.tan(CONCOURSE.escalator.angle);
  const ex0 = CONCOURSE.escalator.xBottom;
  const ex1 = ex0 + run;
  // The escalator needs headroom from a metre in until it is through the roof slab.
  const through = (ceilY + CONCOURSE.roofSlab - floorY) / Math.tan(CONCOURSE.escalator.angle);
  const stairTop = halfLength + CONCOURSE.endWall + CONCOURSE.stairs.landing;
  const stairRise = floorY - streetY;
  return {
    floorY,
    ceilY,
    platformY,
    streetY,
    halfLength,
    halfWidth: STATION.concourseHalfWidth,
    platformEdge,
    platformOuter,
    platformHalfLength: d.platformLength / 2,
    escalator: { x0: ex0, x1: ex1, rise, run },
    roofOpening: { x0: ex0 + 1.0, x1: ex0 + through + 0.6, z0: CONCOURSE.escalator.up[0] - 0.15, z1: CONCOURSE.escalator.down[1] + 0.15 },
    landing: { x0: ex1, x1: ex1 + CONCOURSE.landing.length, z0: platformOuter, z1: CONCOURSE.landing.z1 },
    screenGap: { x0: ex1 + 0.45, x1: ex1 + CONCOURSE.landing.length - 0.25 },
    stairs: { top: stairTop, bottom: stairTop + stairRise * CONCOURSE.stairs.runPerRise, steps: Math.round(stairRise / CONCOURSE.stairs.riser) },
  };
}

/** Station dimensions of a route, as the floor plan needs them. */
export const planDims = (route: RouteModel): PlanDims => ({
  rail: route.params.railLevel,
  platformLength: route.params.platformLength,
  platformHeight: route.params.platformHeight,
  trackCentres: route.params.trackCentres,
});

/**
 * Can this station be walked through? Only served, elevated stations at the
 * standard rail level have a modelled inside; underground halls and the
 * split concourses over a flyover do not (yet).
 */
export function stationWalkable(route: RouteModel, st: StationModel): boolean {
  if (st.service !== "stop") return false;
  if (Math.abs(route.profile.railAt(st.distance) - route.params.railLevel) > 0.01) return false;
  return !route.flyovers.some((f) => st.distance > f.corridorFrom && st.distance < f.corridorTo);
}

/** Barrier ids of the gate lanes (`entry-0`…, `exit-0`…), nearest lane first for a given z. */
export const gateId = (kind: "entry" | "exit", lane: number) => `${kind}-${lane}`;

/** Barrier id at the end of a security lane (index into CONCOURSE.security.lanes). */
export const securityBarrier = (lane: number) => `security-${CONCOURSE.security.lanes[lane].id}`;

/** Sides of the station: -1 = left of +x (z < 0), +1 = right. */
export type Side = 1 | -1;

/** Everything walkable in an elevated station, as pads, furniture and gate barriers. */
export function stationWalkSpace(plan: ConcoursePlan): WalkSpace {
  const pads: Pad[] = [];
  const obstacles: Obstacle[] = [];
  const barriers: Barrier[] = [];
  const F = plan.floorY;
  const P = plan.platformY;
  const G = plan.streetY;
  const C = CONCOURSE;
  /** Walkers stop this far short of a wall. */
  const m = 0.3;
  const hallX = plan.halfLength - C.endWall - m;
  const hallZ = plan.halfWidth - C.sideWall - m;
  const flat = (id: string, zone: Pad["zone"], x0: number, x1: number, z0: number, z1: number, y: number) =>
    pads.push({ id, zone, x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), y0: y, y1: y });

  // Unpaid: the two halls, joined by a corridor down each side of the paid island.
  flat("hall-west", "unpaid", -hallX, C.island.x0 - m, -hallZ, hallZ, F);
  flat("hall-east", "unpaid", C.island.x1 + m, hallX, -hallZ, hallZ, F);
  // Paid island: the middle, plus the strips beside each escalator bank.
  flat("island", "paid", C.island.x0 + m, C.island.x1 - m, -(C.escalator.up[0] - 0.25), C.escalator.up[0] - 0.25, F);

  for (const s of [-1, 1] as const) {
    const side = s < 0 ? "l" : "r";
    flat(`corridor-${side}`, "unpaid", C.island.x0 - m - 0.2, C.island.x1 + m + 0.2, s * (C.island.z + m), s * hallZ, F);
    const bankIn = C.escalator.up[0] - 0.35;
    const bankOut = C.island.z - m;
    flat(`island-west-${side}`, "paid", C.island.x0 + m, plan.escalator.x0 + 0.15, s * bankIn, s * bankOut, F);
    flat(`island-east-${side}`, "paid", plan.roofOpening.x1 + 0.6, C.island.x1 - m, s * bankIn, s * bankOut, F);

    // Escalators: ramps with a moving floor (up runs towards +x, down back towards -x).
    const lane = (id: string, zr: readonly [number, number], conveyor: number) => {
      const half = C.escalator.stepWidth / 2 - 0.05;
      const zc = (zr[0] + zr[1]) / 2;
      pads.push({
        id,
        zone: "escalator",
        x0: plan.escalator.x0,
        x1: plan.escalator.x1,
        z0: Math.min(s * (zc - half), s * (zc + half)),
        z1: Math.max(s * (zc - half), s * (zc + half)),
        y0: F,
        y1: P,
        conveyor,
      });
    };
    lane(`escalator-up-${side}`, C.escalator.up, C.escalator.speed);
    lane(`escalator-down-${side}`, C.escalator.down, -C.escalator.speed);

    // Platform level: landing, the way through the screen, the platform itself.
    flat(`landing-${side}`, "landing", plan.landing.x0 - 0.2, plan.landing.x1 - m, s * (plan.landing.z0 + 0.4), s * (plan.landing.z1 - 0.15), P);
    flat(`screen-gap-${side}`, "landing", plan.screenGap.x0 + m, plan.screenGap.x1 - m, s * (plan.platformOuter - 1.1), s * (plan.landing.z0 + 0.6), P);
    // Inside the canopy posts, and a pace back from the platform edge.
    flat(`platform-${side}`, "platform", -plan.platformHalfLength + 0.4, plan.platformHalfLength - 0.4, s * (plan.platformEdge + m), s * (plan.platformOuter - 0.9), P);

    // Street doors, stairs and a stretch of footpath at each end.
    for (const xs of [-1, 1] as const) {
      const end = xs < 0 ? "w" : "e";
      flat(`door-${end}${side}`, "unpaid", xs * (hallX - 0.1), xs * (plan.stairs.top + 0.1), s * (C.door.z0 + m), s * (C.door.z1 - m), F);
      const z0 = s * (C.stairs.z0 + m);
      const z1 = s * (C.stairs.z1 - m);
      pads.push({
        id: `stairs-${end}${side}`,
        zone: "stairs",
        x0: xs < 0 ? -plan.stairs.bottom : plan.stairs.top,
        x1: xs < 0 ? -plan.stairs.top : plan.stairs.bottom,
        z0: Math.min(z0, z1),
        z1: Math.max(z0, z1),
        y0: xs < 0 ? G : F,
        y1: xs < 0 ? F : G,
      });
      flat(`street-${end}${side}`, "street", xs * (plan.stairs.bottom - 0.2), xs * (plan.stairs.bottom + 9), s * (ROAD.halfWidth + 0.4), s * (ROAD.halfWidth + ROAD.sidewalk - 0.3), G);
    }
  }

  // Gate lanes cross the island's west (entry) and east (exit) railings.
  const gates: ["entry" | "exit", number][] = [
    ["entry", C.island.x0],
    ["exit", C.island.x1],
  ];
  for (const [kind, gx] of gates) {
    C.gate.lanes.forEach((zc, i) => {
      flat(`${kind}-lane-${i}`, "gate", gx - 0.6, gx + 0.6, zc - 0.3, zc + 0.3, F);
      barriers.push({ id: gateId(kind, i), x0: gx - 0.1, x1: gx + 0.1, z0: zc - C.gate.pitch / 2, z1: zc + C.gate.pitch / 2, y0: F, y1: F + 1.2 });
    });
    // Cabinets either side of every lane.
    for (let k = 0; k <= C.gate.lanes.length; k++) {
      const zc = C.gate.lanes[0] - C.gate.pitch / 2 + k * C.gate.pitch;
      obstacles.push({ x0: gx - C.gate.cabinetLength / 2, x1: gx + C.gate.cabinetLength / 2, z0: zc - C.gate.cabinetWidth / 2, z1: zc + C.gate.cabinetWidth / 2, y0: F, y1: F + C.gate.cabinetHeight });
    }
  }

  // Security check: the machine, belt and rails close off the gates, so the only way to them is through a lane.
  {
    const S = C.security;
    const box = (x0: number, x1: number, z0: number, z1: number, height = 1.2) => obstacles.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), y0: F, y1: F + height });
    const fx = S.frameX;
    const [men, women] = S.lanes;
    box(S.belt.x0, S.belt.x1, S.belt.z0, S.belt.z1);
    box(S.machine.x0, S.machine.x1, S.machine.z0, S.machine.z1, S.machine.height);
    // The line of the detectors, from the machine across to the far rail.
    box(fx - 0.1, fx + 0.1, S.machine.z1, men.frameZ - S.frameHalf, S.frameHeight);
    box(fx - 0.1, fx + 0.1, men.frameZ + S.frameHalf, women.frameZ - S.frameHalf, S.frameHeight);
    box(fx - 0.1, fx + 0.1, women.frameZ + S.frameHalf, S.penHalf, S.frameHeight);
    // Rails between the lanes, round the operator, and down both sides to the island.
    box(fx, S.barrierX, men.z0 - 0.02, men.z0 + 0.02);
    box(fx, S.barrierX, men.z1 - 0.02, men.z1 + 0.02);
    box(S.barrierX - 0.02, S.barrierX + 0.02, S.belt.z1, men.z0);
    box(S.machine.x1, C.island.x0, -S.penHalf - 0.02, -S.penHalf + 0.02);
    box(fx, C.island.x0, S.penHalf - 0.02, S.penHalf + 0.02);
    // The enclosure's end curtains, either side of its doorways.
    for (const x of [S.enclosure.x0, S.enclosure.x1]) {
      box(x - 0.03, x + 0.03, women.z0, women.frameZ - S.frameHalf, S.enclosure.height);
      box(x - 0.03, x + 0.03, women.frameZ + S.frameHalf, women.z1, S.enclosure.height);
    }
    S.lanes.forEach((lane, i) => {
      barriers.push({ id: securityBarrier(i), x0: S.barrierX - 0.1, x1: S.barrierX + 0.1, z0: lane.z0, z1: lane.z1, y0: F, y1: F + 1.2 });
      box(lane.guard.x - 0.22, lane.guard.x + 0.22, lane.guard.z - 0.22, lane.guard.z + 0.22, 1.7);
    });
    box(C.exitGuard.x - 0.22, C.exitGuard.x + 0.22, C.exitGuard.z - 0.22, C.exitGuard.z + 0.22, 1.7);
  }

  for (const [x, z] of C.bystanders) obstacles.push({ x0: x - 0.22, x1: x + 0.22, z0: z - 0.22, z1: z + 0.22, y0: F, y1: F + 1.7 });
  obstacles.push({ x0: C.office.x0, x1: C.office.x1, z0: -C.office.halfZ, z1: C.office.halfZ, y0: F, y1: plan.ceilY });
  // The counter shelves stick out through the windows: keep the eye out of them.
  for (const z of C.office.windows) {
    obstacles.push({ x0: C.office.x0 - C.office.shelf, x1: C.office.x0, z0: z - C.office.windowHalf, z1: z + C.office.windowHalf, y0: F, y1: F + 1.05 });
  }
  obstacles.push({ x0: C.ticketBox.x - C.ticketBox.half, x1: C.ticketBox.x + C.ticketBox.half, z0: C.ticketBox.z - C.ticketBox.half, z1: C.ticketBox.z + C.ticketBox.half, y0: F, y1: F + C.ticketBox.height });

  return { pads, obstacles, barriers };
}

export interface WalkPoint {
  x: number;
  z: number;
  y: number;
}

/** Where things the passenger uses or heads for stand, for the platform on side `s`. */
export function stationPoints(plan: ConcoursePlan, s: Side) {
  const C = CONCOURSE;
  const F = plan.floorY;
  return {
    /** Start: on the footpath at the foot of the west stairs, facing them. */
    spawn: { x: -(plan.stairs.bottom + 6), z: s * (ROAD.halfWidth + ROAD.sidewalk / 2 + 0.05), y: plan.streetY } as WalkPoint,
    /** Standing at each ticket window. */
    counters: C.office.windows.map((z) => ({ x: C.office.x0 - 1.0, z, y: F }) as WalkPoint),
    /** Where staff scan the passenger, in each security lane. */
    security: C.security.lanes.map((l, lane) => ({ lane, x: l.spot.x, z: l.spot.z, y: F })),
    /** Standing at each end of the X-ray belt. */
    bagDrop: { x: C.security.bagFrom, z: C.security.belt.z1 + 0.5, y: F } as WalkPoint,
    bagCollect: { x: C.security.bagTo, z: C.security.belt.z1 + 0.5, y: F } as WalkPoint,
    entryLanes: C.gate.lanes.map((z, lane) => ({ lane, x: C.island.x0 - 0.9, z, y: F })),
    exitLanes: C.gate.lanes.map((z, lane) => ({ lane, x: C.island.x1 - 0.9, z, y: F })),
    ticketBox: { x: C.ticketBox.x, z: C.ticketBox.z, y: F } as WalkPoint,
    /** Foot of the up escalator, and the platform where it arrives. */
    escalatorFoot: { x: plan.escalator.x0 - 0.8, z: (s * (C.escalator.up[0] + C.escalator.up[1])) / 2, y: F } as WalkPoint,
    platform: { x: (plan.screenGap.x0 + plan.screenGap.x1) / 2, z: s * (plan.platformEdge + 2), y: plan.platformY } as WalkPoint,
    /** Head of the down escalator, for the way out. */
    escalatorHead: { x: plan.landing.x0 + 0.6, z: (s * (C.escalator.down[0] + C.escalator.down[1])) / 2, y: plan.platformY } as WalkPoint,
    /** Foot of the east stairs on the street. */
    street: { x: plan.stairs.bottom + 3, z: s * (ROAD.halfWidth + ROAD.sidewalk / 2 + 0.05), y: plan.streetY } as WalkPoint,
  };
}

/** The part of a train car's layout the walker needs (trainModel.ts cabinLayout). */
export interface CarWalkLayout {
  xRear: number;
  xFront: number;
  doors: readonly number[];
  doorHalf: number;
  floorY: number;
  innerHalf: number;
}

/** Inside a car, in car-local space: the aisle between the benches and a vestibule at each doorway. */
export function carWalkSpace(layout: CarWalkLayout): WalkSpace {
  const y = layout.floorY;
  const pads: Pad[] = [{ id: "aisle", zone: "train", x0: layout.xRear + 0.4, x1: layout.xFront - 0.4, z0: -0.55, z1: 0.55, y0: y, y1: y }];
  layout.doors.forEach((dx, i) => {
    const half = layout.doorHalf - 0.12;
    const reach = layout.innerHalf - 0.3;
    pads.push({ id: `vestibule-${i}`, zone: "train", x0: dx - half, x1: dx + half, z0: -reach, z1: reach, y0: y, y1: y });
  });
  return { pads, obstacles: [], barriers: [] };
}
