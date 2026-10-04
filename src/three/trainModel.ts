import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  PlaneGeometry,
  Shape,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TRAIN } from "./layout.ts";

/**
 * Procedural metro car, built in car-local space:
 * +x = front of the car, +y = up from rail top, +z = right side.
 *
 * Dimensions follow the published Phase II trainset (3 cars, 67.8 m) with
 * assumed width/height (see tracks.json). Livery is stylised.
 * Side walls are assembled from panels around real window and door
 * openings so the passenger and driver cameras can see out.
 */

export type CarKind = "DMC" | "TC";

export interface CarGeometry {
  kind: CarKind;
  body: BufferGeometry;
  dark: BufferGeometry;
  glass: BufferGeometry;
  stripe: BufferGeometry;
  steel: BufferGeometry;
  seats: BufferGeometry;
  floor: BufferGeometry;
  ceiling: BufferGeometry;
  lights: BufferGeometry;
  headlights: BufferGeometry | null;
  destination: BufferGeometry | null;
  /** Cab nose shell (hidden from the driver's seat). */
  nose: BufferGeometry | null;
  windshield: BufferGeometry | null;
  doorLeaf: BufferGeometry;
  doorGlass: BufferGeometry;
  /** Closed-door leaf centres: x, side (+1 right / -1 left), slide direction. */
  leaves: { x: number; side: 1 | -1; slide: 1 | -1 }[];
  wheel: BufferGeometry;
  wheelPositions: [number, number, number][];
}

const HALF = TRAIN.carLength / 2;
const W = TRAIN.width / 2;
const PANEL_IN = W - 0.07;
const WINDOW_BOTTOM = 1.95;
const WINDOW_TOP = 2.95;
const BAND_TOP = 3.28;
const DOOR_TOP = 3.05;
const DOOR_HALF = 0.72;
const CAB = 2.3;

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): BufferGeometry {
  const g = new BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g.index ? g.toNonIndexed() : g;
}

function cylinder(r: number, len: number, axis: "x" | "y" | "z", x: number, y: number, z: number, seg = 8) {
  const g = new CylinderGeometry(r, r, len, seg);
  if (axis === "x") g.rotateZ(Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g.toNonIndexed();
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const clean = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") n.deleteAttribute(name);
    }
    return n;
  });
  const m = mergeGeometries(clean, false);
  if (!m) throw new Error("Failed to merge train geometry");
  m.computeBoundingSphere();
  return m;
}

function intervalsWithout(x0: number, x1: number, holes: number[], half: number): [number, number][] {
  const out: [number, number][] = [];
  let a = x0;
  for (const h of [...holes].sort((p, q) => p - q)) {
    if (h - half > a) out.push([a, h - half]);
    a = h + half;
  }
  if (a < x1) out.push([a, x1]);
  return out;
}

const carDoors = (kind: CarKind) => (kind === "DMC" ? [-8.6, -3.2, 2.2, 7.3] : [-8.55, -2.85, 2.85, 8.55]);

/** Interior layout in car-local space, shared by the passengers and grab straps. */
export interface CabinLayout {
  kind: CarKind;
  /** Passenger saloon extent along the car (the cab is excluded). */
  xRear: number;
  xFront: number;
  /** Door centres along x (doors on both sides). */
  doors: number[];
  doorHalf: number;
  /** Bench seat runs between doors, per side (+1 right / -1 left). */
  seatRuns: { x0: number; x1: number; side: 1 | -1 }[];
  /** Floor top, seat cushion top, and |z| of a seated passenger's hips. */
  floorY: number;
  seatY: number;
  seatZ: number;
  /** Overhead grab rails: height and |z|. */
  railY: number;
  railZ: number;
  /** Inner half-width of the saloon. */
  innerHalf: number;
}

export function cabinLayout(kind: CarKind): CabinLayout {
  const xFront = kind === "DMC" ? HALF - CAB : HALF;
  const xRear = -HALF;
  const doors = carDoors(kind);
  const seatRuns: CabinLayout["seatRuns"] = [];
  for (const side of [-1, 1] as const) {
    for (const [a, b] of intervalsWithout(xRear, xFront, doors, DOOR_HALF)) {
      if (b - a > 1.4) seatRuns.push({ x0: a + 0.25, x1: b - 0.25, side });
    }
  }
  return {
    kind,
    xRear,
    xFront,
    doors,
    doorHalf: DOOR_HALF,
    seatRuns,
    floorY: 1.13,
    seatY: 1.6,
    seatZ: PANEL_IN - 0.26,
    railY: 2.93,
    railZ: 0.62,
    innerHalf: PANEL_IN,
  };
}

export function buildCar(kind: CarKind): CarGeometry {
  const isCab = kind === "DMC";
  const doors = carDoors(kind);
  const xFront = isCab ? HALF - CAB : HALF;
  const xRear = -HALF;

  const body: BufferGeometry[] = [];
  const dark: BufferGeometry[] = [];
  const glass: BufferGeometry[] = [];
  const stripe: BufferGeometry[] = [];
  const steel: BufferGeometry[] = [];
  const seats: BufferGeometry[] = [];
  const lights: BufferGeometry[] = [];

  for (const s of [-1, 1] as const) {
    const zo = s * W;
    const zi = s * PANEL_IN;
    const [za, zb] = s < 0 ? [zo, zi] : [zi, zo];
    for (const [a, b] of intervalsWithout(xRear, xFront, doors, DOOR_HALF)) {
      body.push(box(a, b, 0.95, WINDOW_BOTTOM, za, zb));
      body.push(box(a, b, WINDOW_TOP, BAND_TOP, za, zb));
      // Window pillars and glass.
      const n = Math.max(1, Math.round((b - a) / 1.9));
      const span = (b - a) / n;
      for (let k = 0; k <= n; k++) {
        const px = a + span * k;
        const p0 = Math.max(a, px - 0.11);
        const p1 = Math.min(b, px + 0.11);
        body.push(box(p0, p1, WINDOW_BOTTOM, WINDOW_TOP, za, zb));
        if (k < n) glass.push(box(px + 0.11, px + span - 0.11, WINDOW_BOTTOM, WINDOW_TOP, s * (W - 0.05), s * (W - 0.02)));
      }
      stripe.push(box(a, b, 1.3, 1.42, s * (W + 0.006), s * (W - 0.01)));
      stripe.push(box(a, b, 3.1, 3.16, s * (W + 0.006), s * (W - 0.01)));
      // Longitudinal bench seats inside.
      if (b - a > 1.4) {
        const sx0 = a + 0.25;
        const sx1 = b - 0.25;
        seats.push(box(sx0, sx1, 1.53, 1.6, s * (PANEL_IN - 0.48), zi));
        seats.push(box(sx0, sx1, 1.13, 1.53, s * (PANEL_IN - 0.42), s * (PANEL_IN - 0.36)));
        seats.push(box(sx0, sx1, 1.62, 2.02, s * (PANEL_IN - 0.08), zi));
      }
    }
    for (const dx of doors) {
      body.push(box(dx - DOOR_HALF, dx + DOOR_HALF, DOOR_TOP, BAND_TOP, za, zb));
      // Door-side grab poles.
      for (const e of [-1, 1]) steel.push(cylinder(0.022, 2.05, "y", dx + e * (DOOR_HALF + 0.12), 2.16, s * (PANEL_IN - 0.5)));
      // Door-area floor marker strip.
      stripe.push(box(dx - DOOR_HALF, dx + DOOR_HALF, 1.131, 1.136, s * (PANEL_IN - 0.25), zi));
    }
  }

  // Roof: shallow arch extruded along the car.
  const roofShape = new Shape();
  const roofPts: [number, number][] = [
    [-W, BAND_TOP],
    [-W + 0.06, 3.5],
    [-W + 0.32, 3.7],
    [-0.62, 3.82],
    [0, TRAIN.roof],
    [0.62, 3.82],
    [W - 0.32, 3.7],
    [W - 0.06, 3.5],
    [W, BAND_TOP],
    [W, 3.18],
    [-W, 3.18],
  ];
  roofShape.moveTo(roofPts[0][0], roofPts[0][1]);
  for (const [z, y] of roofPts.slice(1)) roofShape.lineTo(z, y);
  roofShape.closePath();
  const roofLen = xFront - xRear;
  const roof = new ExtrudeGeometry(roofShape, { depth: roofLen, bevelEnabled: false, steps: 1 });
  roof.rotateY(Math.PI / 2);
  roof.translate(xRear, 0, 0);
  body.push(roof);

  // Floor, underframe, ceiling.
  const floor = box(xRear + 0.05, xFront, 1.05, 1.13, -PANEL_IN, PANEL_IN);
  const ceiling = box(xRear + 0.05, xFront, 3.16, 3.2, -PANEL_IN, PANEL_IN);
  dark.push(box(xRear + 0.4, xFront - 0.2, 0.74, 1.05, -W + 0.12, W - 0.12));
  for (const ex of [-3.2, 0.2, 3.4]) dark.push(box(ex - 1.1, ex + 1.1, 0.42, 0.74, -0.95, 0.95));
  // Roof-mounted air conditioning units.
  for (const ax of [-5.4, 4.6]) dark.push(box(ax - 1.4, ax + 1.4, 3.72, 4.02, -0.85, 0.85));

  // Rear end wall with open gangway, plus half of the bellows.
  const endWall = (x: number, dir: 1 | -1) => {
    const x0 = dir > 0 ? x - 0.08 : x;
    const x1 = dir > 0 ? x : x + 0.08;
    body.push(box(x0, x1, 0.95, BAND_TOP, -W, -0.64));
    body.push(box(x0, x1, 0.95, BAND_TOP, 0.64, W));
    body.push(box(x0, x1, 3.0, BAND_TOP, -0.64, 0.64));
    const g0 = dir > 0 ? x : x - 0.3;
    const g1 = dir > 0 ? x + 0.3 : x;
    dark.push(box(g0, g1, 1.08, 3.08, -0.74, -0.64));
    dark.push(box(g0, g1, 1.08, 3.08, 0.64, 0.74));
    dark.push(box(g0, g1, 3.0, 3.08, -0.74, 0.74));
    dark.push(box(g0, g1, 1.05, 1.13, -0.74, 0.74));
  };
  endWall(xRear, -1);
  if (!isCab) endWall(xFront, 1);

  // Overhead grab rails and ceiling light strips.
  for (const s of [-1, 1]) {
    steel.push(cylinder(0.02, xFront - xRear - 0.6, "x", (xFront + xRear) / 2, 2.93, s * 0.62));
    lights.push(box(xRear + 0.4, xFront - 0.3, 3.14, 3.16, s * 0.42, s * 0.62));
  }

  let headlights: BufferGeometry | null = null;
  let destination: BufferGeometry | null = null;
  let noseOut: BufferGeometry | null = null;
  let windshield: BufferGeometry | null = null;
  if (isCab) {
    // Nose: side profile extruded across the width with rounded edges.
    const nose = new Shape();
    const bevel = 0.09;
    const profile: [number, number][] = [
      [0, 0.95 + bevel],
      [CAB - 0.3, 0.95 + bevel],
      [CAB - bevel, 1.2],
      [CAB - bevel, 1.86],
      [CAB - 0.48, 3.02],
      [CAB - 1.0, 3.7],
      [0, TRAIN.roof - bevel],
    ];
    nose.moveTo(profile[0][0], profile[0][1]);
    for (const [x, y] of profile.slice(1)) nose.lineTo(x, y);
    nose.closePath();
    const noseGeo = new ExtrudeGeometry(nose, {
      depth: TRAIN.width - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3,
      steps: 1,
    });
    noseGeo.translate(xFront, 0, -(W - bevel));
    noseOut = merge([noseGeo]);

    // Windshield on the sloped face.
    const wx0 = CAB - bevel;
    const wy0 = 1.9;
    const wx1 = CAB - 0.46;
    const wy1 = 3.0;
    const len = Math.hypot(wx1 - wx0, wy1 - wy0);
    const theta = Math.atan2(wx0 - wx1, wy1 - wy0);
    const nx = Math.cos(theta);
    const ny = Math.sin(theta);
    const mx = xFront + (wx0 + wx1) / 2 + nx * (bevel + 0.02);
    const my = (wy0 + wy1) / 2 + ny * (bevel + 0.02);
    const shield = new BoxGeometry(0.03, len * 0.94, 2.36);
    shield.rotateZ(theta);
    shield.translate(mx, my, 0);
    windshield = merge([shield]);
    // Cab frame visible from the driver's seat: pillars, console, header.
    for (const s of [-1, 1]) {
      const pillar = new BoxGeometry(0.08, len, 0.16);
      pillar.rotateZ(theta);
      pillar.translate(mx - nx * 0.06, my - ny * 0.06, s * 1.22);
      dark.push(pillar.toNonIndexed());
    }
    dark.push(box(xFront + 0.9, xFront + CAB - 0.25, 1.13, 1.82, -1.3, 1.3));
    dark.push(box(xFront - 0.2, xFront + CAB - 0.7, 3.42, 3.5, -1.3, 1.3));
    // Front stripe and coupler.
    stripe.push(box(xFront + CAB - 0.02, xFront + CAB + 0.02, 1.62, 1.74, -1.15, 1.15));
    dark.push(box(xFront + CAB - 0.1, xFront + CAB + 0.25, 0.62, 0.86, -0.35, 0.35));

    const head: BufferGeometry[] = [];
    for (const s of [-1, 1]) head.push(box(xFront + CAB - 0.03, xFront + CAB + 0.015, 1.32, 1.48, s * 1.16, s * 0.72));
    headlights = merge(head);

    // Destination display behind the top of the windshield.
    const dest = new PlaneGeometry(1.5, 0.24);
    dest.rotateY(Math.PI / 2);
    dest.rotateZ(theta);
    const dt = 0.86;
    dest.translate(
      xFront + wx0 + (wx1 - wx0) * dt + nx * (bevel + 0.04),
      wy0 + (wy1 - wy0) * dt + ny * (bevel + 0.04),
      0,
    );
    destination = dest.toNonIndexed();
  }

  // Bogies and wheels.
  const wheelPositions: [number, number, number][] = [];
  for (const bx of [-(HALF - 3.1), HALF - 3.1]) {
    dark.push(box(bx - 1.35, bx + 1.35, 0.32, 0.72, -1.02, 1.02));
    for (const wx of [-1.05, 1.05]) for (const wz of [-0.72, 0.72]) wheelPositions.push([bx + wx, 0.42, wz]);
  }

  // Door leaves: each opening has two leaves that slide apart.
  const leaves: CarGeometry["leaves"] = [];
  for (const s of [-1, 1] as const) {
    for (const dx of doors) {
      leaves.push({ x: dx - DOOR_HALF / 2, side: s, slide: -1 });
      leaves.push({ x: dx + DOOR_HALF / 2, side: s, slide: 1 });
    }
  }
  const leafBody = merge([
    box(-DOOR_HALF / 2, DOOR_HALF / 2, 1.08, 1.98, -0.025, 0.025),
    box(-DOOR_HALF / 2, DOOR_HALF / 2, 2.9, DOOR_TOP, -0.025, 0.025),
    box(-DOOR_HALF / 2, -DOOR_HALF / 2 + 0.08, 1.98, 2.9, -0.025, 0.025),
    box(DOOR_HALF / 2 - 0.08, DOOR_HALF / 2, 1.98, 2.9, -0.025, 0.025),
  ]);
  const leafGlass = merge([box(-DOOR_HALF / 2 + 0.08, DOOR_HALF / 2 - 0.08, 1.98, 2.9, -0.012, 0.012)]);

  const wheel = new CylinderGeometry(0.42, 0.42, 0.1, 14);
  wheel.rotateX(Math.PI / 2);

  return {
    kind,
    body: merge(body),
    dark: merge(dark),
    glass: merge(glass),
    stripe: merge(stripe),
    steel: merge(steel),
    seats: merge(seats),
    floor,
    ceiling,
    lights: merge(lights),
    headlights,
    destination,
    nose: noseOut,
    windshield,
    doorLeaf: leafBody,
    doorGlass: leafGlass,
    leaves,
    wheel,
    wheelPositions,
  };
}

/** Distance from car centre to the front bogie pivot. */
export const BOGIE_OFFSET = HALF - 3.1;
/** Distance from the leading car centre to the nose tip. */
export const NOSE_TIP = HALF + 0.09;
/** Where the driver's eyes are, in car-local coordinates of the leading DMC. */
export const DRIVER_EYE = { x: HALF - CAB + 1.05, y: 2.78, z: -0.35 };
