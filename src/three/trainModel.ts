import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, Shape, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TRAIN } from "./layout.ts";
import { buildNose, NOSE_DEPTH, paint } from "./trainNose.ts";

/**
 * Procedural metro car, built in car-local space:
 * +x = front of the car, +y = up from rail top, +z = right side.
 *
 * Dimensions follow the published Phase II trainset (3 cars, 67.8 m) with
 * assumed width/height (see tracks.json). Livery after a photo of a CMRL
 * Alstom Metropolis: blue cab and cantrail band, stainless sides with a
 * blue stripe under the windows.
 * Side walls are assembled from panels around real window and door
 * openings so the passenger and driver cameras can see out.
 */

export type CarKind = "DMC" | "TC";

export interface CarGeometry {
  kind: CarKind;
  body: BufferGeometry;
  dark: BufferGeometry;
  /** Grey underframe equipment and roof units. */
  under: BufferGeometry;
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
  /** Head-light beam origin (cab cars). */
  beam: [number, number, number] | null;
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
const WINDOW_BOTTOM = 1.9;
const WINDOW_TOP = 3.0;
const BAND_TOP = 3.28;
/** Top of the blue cantrail band (a roof profile point). */
const ROOF_BAND_TOP = 3.7;
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
      if (name !== "position" && name !== "normal") n.deleteAttribute(name);
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

/** Big windows in a bay between doors: one in a short bay, two (with a pier) in a long one. */
function bayWindows(a: number, b: number): [number, number][] {
  const span = b - a;
  const m = 0.3;
  if (span < 1.3) return [];
  if (span < 2.8) return [[a + m, b - m]];
  const w = (span - 2 * m - 0.5) / 2;
  return [
    [a + m, a + m + w],
    [b - m - w, b - m],
  ];
}

export const LIVERY = {
  /** Stainless side panels. */
  side: "#aab0b6",
  door: "#9ea4ab",
  blue: "#2864ec",
  roof: "#8b9198",
  lining: "#e7ebef",
  rubber: "#2a2f35",
};

/**
 * Vertex colours for the car body from each triangle's facing: outside
 * faces stainless, the cantrail band blue, the roof grey, window and door
 * reveals black rubber, and everything facing into the saloon light grey.
 */
function paintBody(g: BufferGeometry): BufferGeometry {
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const col = new Float32Array(pos.count * 3);
  const C = Object.fromEntries(Object.entries(LIVERY).map(([k, v]) => [k, new Color(v)])) as Record<keyof typeof LIVERY, Color>;
  const c = new Vector3();
  const n = new Vector3();
  const v = new Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    c.set(0, 0, 0);
    n.set(0, 0, 0);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < 3; k++) {
      c.add(v.fromBufferAttribute(pos, i + k));
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
      n.add(v.fromBufferAttribute(nor, i + k));
    }
    c.divideScalar(3);
    n.normalize();
    let colour: Color;
    if (minY >= 3.18 - 1e-3) {
      // Roof: blue cantrail band up to the 3.7 m profile point, grey top, light ceiling side.
      // Judged by the triangle's top edge so both halves of a long roof strip match.
      colour = n.y < -0.5 ? C.lining : maxY <= ROOF_BAND_TOP + 1e-3 ? C.blue : C.roof;
    } else if (Math.abs(n.z) > 0.5) {
      colour = Math.abs(c.z) > PANEL_IN - 0.01 && n.z * c.z > 0 ? C.side : C.lining;
    } else if (Math.abs(n.x) > 0.5) {
      // Car ends: outside stainless, inside light; elsewhere window and door reveals.
      colour = Math.abs(c.x) > HALF - 0.12 ? (n.x * c.x > 0 ? C.side : C.lining) : C.rubber;
    } else {
      colour = c.y < 1.0 ? C.side : Math.abs(c.z) > PANEL_IN - 0.01 ? C.rubber : C.lining;
    }
    for (let k = 0; k < 3; k++) colour.toArray(col, (i + k) * 3);
  }
  g.setAttribute("color", new BufferAttribute(col, 3));
  return g;
}

function paintLeaf(g: BufferGeometry): BufferGeometry {
  const nor = g.getAttribute("normal");
  const out = new Color(LIVERY.door);
  const inner = new Color(LIVERY.lining);
  const edge = new Color(LIVERY.rubber);
  const col = new Float32Array(nor.count * 3);
  for (let i = 0; i < nor.count; i++) (nor.getZ(i) > 0.5 ? out : nor.getZ(i) < -0.5 ? inner : edge).toArray(col, i * 3);
  g.setAttribute("color", new BufferAttribute(col, 3));
  return g;
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
  const blueStripe: BufferGeometry[] = [];

  for (const s of [-1, 1] as const) {
    const zo = s * W;
    const zi = s * PANEL_IN;
    const [za, zb] = s < 0 ? [zo, zi] : [zi, zo];
    for (const [a, b] of intervalsWithout(xRear, xFront, doors, DOOR_HALF)) {
      body.push(box(a, b, 0.95, WINDOW_BOTTOM, za, zb));
      body.push(box(a, b, WINDOW_TOP, BAND_TOP, za, zb));
      // Blue stripe under the windows, then large windows with dark surrounds.
      blueStripe.push(box(a, b, 1.66, 1.78, s * (W + 0.004), s * (W - 0.002)));
      let px = a;
      const fo = s * (W + 0.012);
      const fi = s * (W - 0.004);
      const [f0, f1] = s < 0 ? [fo, fi] : [fi, fo];
      for (const [w0, w1] of bayWindows(a, b)) {
        if (w0 > px) body.push(box(px, w0, WINDOW_BOTTOM, WINDOW_TOP, za, zb));
        glass.push(box(w0, w1, WINDOW_BOTTOM, WINDOW_TOP, s * (W - 0.05), s * (W - 0.02)));
        dark.push(box(w0 - 0.05, w1 + 0.05, WINDOW_BOTTOM - 0.05, WINDOW_BOTTOM + 0.03, f0, f1));
        dark.push(box(w0 - 0.05, w1 + 0.05, WINDOW_TOP - 0.03, WINDOW_TOP + 0.05, f0, f1));
        dark.push(box(w0 - 0.05, w0 + 0.03, WINDOW_BOTTOM + 0.03, WINDOW_TOP - 0.03, f0, f1));
        dark.push(box(w1 - 0.03, w1 + 0.05, WINDOW_BOTTOM + 0.03, WINDOW_TOP - 0.03, f0, f1));
        px = w1;
      }
      if (px < b) body.push(box(px, b, WINDOW_BOTTOM, WINDOW_TOP, za, zb));
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
  const under: BufferGeometry[] = [];
  under.push(box(xRear + 0.4, xFront - 0.2, 0.74, 1.05, -W + 0.12, W - 0.12));
  for (const ex of [-3.2, 0.2, 3.4]) under.push(box(ex - 1.1, ex + 1.1, 0.42, 0.74, -0.95, 0.95));
  // Roof-mounted air conditioning units.
  for (const ax of [-5.4, 4.6]) under.push(box(ax - 1.4, ax + 1.4, 3.72, 4.02, -0.85, 0.85));

  // Rear end wall with open gangway, plus half of the bellows.
  const endWall = (x: number, dir: 1 | -1) => {
    const x0 = dir > 0 ? x - 0.08 : x;
    const x1 = dir > 0 ? x : x + 0.08;
    body.push(box(x0, x1, 0.95, BAND_TOP, -W, -0.64));
    body.push(box(x0, x1, 0.95, BAND_TOP, 0.64, W));
    body.push(box(x0, x1, 3.0, BAND_TOP, -0.64, 0.64));
    const g0 = dir > 0 ? x : x - 0.3;
    const g1 = dir > 0 ? x + 0.3 : x;
    dark.push(box(g0, g1, 1.0, 3.14, -0.82, -0.64));
    dark.push(box(g0, g1, 1.0, 3.14, 0.64, 0.82));
    dark.push(box(g0, g1, 3.0, 3.14, -0.82, 0.82));
    dark.push(box(g0, g1, 1.0, 1.13, -0.82, 0.82));
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
  let beam: [number, number, number] | null = null;
  if (isCab) {
    const nose = buildNose(xFront);
    noseOut = nose.shell;
    windshield = nose.glass;
    destination = nose.destination;
    headlights = nose.lamps;
    beam = nose.beam;
    dark.push(nose.frame);
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
  // Leaves are drawn with local +z facing out (Train turns the left-side ones round):
  // stainless outside, light grey inside, a tall narrow window.
  const LH = DOOR_HALF / 2;
  const LW = 0.17;
  const leafBody = paintLeaf(
    merge([
      box(-LH, LH, 1.08, 1.72, -0.025, 0.025),
      box(-LH, LH, 2.9, DOOR_TOP, -0.025, 0.025),
      box(-LH, -LW, 1.72, 2.9, -0.025, 0.025),
      box(LW, LH, 1.72, 2.9, -0.025, 0.025),
    ]),
  );
  const leafGlass = merge([box(-LW, LW, 1.72, 2.9, -0.012, 0.012)]);

  const wheel = new CylinderGeometry(0.42, 0.42, 0.1, 14);
  wheel.rotateX(Math.PI / 2);

  return {
    kind,
    body: (() => {
      const g = mergeGeometries([paintBody(merge(body)), paint(merge(blueStripe), LIVERY.blue)], false);
      if (!g) throw new Error("Failed to merge the car body");
      g.computeBoundingSphere();
      return g;
    })(),
    dark: merge(dark),
    under: merge(under),
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
    beam,
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
export const NOSE_TIP = HALF - CAB + NOSE_DEPTH;
/** Where the driver's eyes are, in car-local coordinates of the leading DMC. */
export const DRIVER_EYE = { x: HALF - CAB + 1.05, y: 2.78, z: -0.35 };
