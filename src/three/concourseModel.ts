import { BoxGeometry, BufferAttribute, type BufferGeometry, CapsuleGeometry, Color, Matrix4, PlaneGeometry, Quaternion, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CONCOURSE, type ConcoursePlan } from "./walkPlan.ts";
import { humanTemplate, paintHuman, pickColours, pickHair, pickOutfit, type HumanSpec, type Pose } from "./humanModel.ts";
import { mulberry32 } from "../utils/random.ts";

/**
 * What is inside a station concourse (walkPlan.ts), in station-local space:
 * floor and wall finishes, the ticket office and its clerks, the railed paid
 * area with its fare-gate cabinets, the used-ticket box, wayfinding signs
 * and a few people. Drawn only at the stations a passenger walks through.
 * A generic interior, not a survey of any real station.
 */
export interface ConcourseGeometry {
  /** Furniture, finishes and people, coloured per vertex. */
  solid: BufferGeometry;
  glass: BufferGeometry;
  /** Self-lit parts (ceiling lights, gate indicators), coloured per vertex. */
  glow: BufferGeometry;
  /** Sign faces, mapped into the sign atlas (textures.ts makeConcourseSignAtlas). */
  signs: BufferGeometry;
}

/** Cells of the sign atlas: two columns by four rows of 4:1 boards. */
export const SIGN = { tickets: 0, entry: 1, exit: 2, platform1: 3, platform2: 4, wayOut: 5, usedTickets: 6, security: 7, men: 8, women: 9, bags: 10 } as const;
export const SIGN_COLS = 2;
export const SIGN_ROWS = 6;

const COLOUR = {
  tile: "#8f959c",
  tilePaid: "#a3a9af",
  guide: "#d9a916",
  wall: "#e6e8ea",
  ceiling: "#eceff1",
  office: "#e7eaed",
  stone: "#2c333c",
  steel: "#aeb5bc",
  cabinet: "#c5cbd1",
  dark: "#1e242b",
  reader: "#1565c0",
  board: "#0d1724",
  box: "#1f5fa8",
  go: "#2fd67b",
  stop: "#ff453a",
  lamp: "#fff6e6",
};

/** Security uniform. The staff in each lane match their own arm (buildGuardArm). */
const UNIFORM = { top: "#3b4a5c", bottom: "#1f2a36" };
export const GUARD_SKIN = ["#8d5524", "#a0673a"];
const OPERATOR_SKIN = "#6b4226";
/** The right shoulder of the staff in each lane, in person-local space (+z forward; the arm swings about it). */
export const GUARD_SHOULDER = [
  { x: 0.17, y: 1.38, z: 0 },
  { x: 0.145, y: 1.38, z: 0 },
];
export const CURTAIN = "#2e8b57";

const tint = new Color();

function coloured(g: BufferGeometry, colour: string): BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(n.attributes)) if (name !== "position" && name !== "normal") n.deleteAttribute(name);
  const count = n.getAttribute("position").count;
  const arr = new Float32Array(count * 3);
  tint.set(colour);
  for (let i = 0; i < count; i++) tint.toArray(arr, i * 3);
  n.setAttribute("color", new BufferAttribute(arr, 3));
  return n;
}

function cbox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: string): BufferGeometry {
  const g = new BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return coloured(g, colour);
}

function pane(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): BufferGeometry {
  const g = new BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)).toNonIndexed();
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  g.deleteAttribute("uv");
  return g;
}

type Facing = "+x" | "-x" | "+z" | "-z";
const FACING_YAW: Record<Facing, number> = { "+z": 0, "+x": Math.PI / 2, "-z": Math.PI, "-x": -Math.PI / 2 };

/** A sign face `w` by `h` centred at (x, y, z), showing one atlas cell. */
function signFace(cell: number, x: number, y: number, z: number, w: number, h: number, facing: Facing): BufferGeometry {
  const g = new PlaneGeometry(w, h).toNonIndexed();
  const uv = g.getAttribute("uv") as BufferAttribute;
  const col = cell % SIGN_COLS;
  const row = Math.floor(cell / SIGN_COLS);
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (col + uv.getX(i)) / SIGN_COLS, 1 - (row + 1 - uv.getY(i)) / SIGN_ROWS);
  }
  g.rotateY(FACING_YAW[facing]);
  g.translate(x, y, z);
  return g;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  g.computeBoundingSphere();
  return g;
}

export function buildConcourse(plan: ConcoursePlan, lineColour: string): ConcourseGeometry {
  const solid: BufferGeometry[] = [];
  const glass: BufferGeometry[] = [];
  const glow: BufferGeometry[] = [];
  const signs: BufferGeometry[] = [];
  const C = CONCOURSE;
  const F = plan.floorY;
  const H = plan.ceilY;
  const cl = plan.halfLength - C.endWall;
  const cw = plan.halfWidth - C.sideWall;
  const o = plan.roofOpening;

  /** A hanging board with a sign on its front and a plain back. */
  const board = (cell: number, x: number, y: number, z: number, w: number, facing: Facing, hangFrom = H) => {
    const h = w / 4;
    const along = facing === "+x" || facing === "-x";
    const sgn = facing === "+x" || facing === "+z" ? 1 : -1;
    if (along) solid.push(cbox(x - sgn * 0.06, x - sgn * 0.005, y - h / 2 - 0.04, y + h / 2 + 0.04, z - w / 2 - 0.04, z + w / 2 + 0.04, COLOUR.board));
    else solid.push(cbox(x - w / 2 - 0.04, x + w / 2 + 0.04, y - h / 2 - 0.04, y + h / 2 + 0.04, z - sgn * 0.06, z - sgn * 0.005, COLOUR.board));
    signs.push(signFace(cell, x, y, z, w, h, facing));
    // Two rods up to the ceiling.
    for (const e of [-0.35, 0.35]) {
      if (along) solid.push(cbox(x - sgn * 0.045, x - sgn * 0.02, y + h / 2, hangFrom, z + e * w - 0.012, z + e * w + 0.012, COLOUR.steel));
      else solid.push(cbox(x + e * w - 0.012, x + e * w + 0.012, y + h / 2, hangFrom, z - sgn * 0.045, z - sgn * 0.02, COLOUR.steel));
    }
  };
  /** Glass railing with a steel top rail. */
  const railing = (x0: number, x1: number, z0: number, z1: number, y = F) => {
    glass.push(pane(x0, x1, y + 0.08, y + 1.05, z0, z1));
    solid.push(cbox(x0 - 0.02, x1 + 0.02, y + 1.05, y + 1.11, Math.min(z0, z1) - 0.02, Math.max(z0, z1) + 0.02, COLOUR.steel));
    solid.push(cbox(x0, x1, y, y + 0.08, z0, z1, COLOUR.steel));
  };

  // Floor: tiles, a lighter paid area, and a yellow waiting line before each gate array and counter.
  solid.push(cbox(-cl, cl, F, F + 0.012, -cw, cw, COLOUR.tile));
  solid.push(cbox(C.island.x0, C.island.x1, F + 0.012, F + 0.018, -C.island.z, C.island.z, COLOUR.tilePaid));
  const gateHalf = (C.gate.lanes.length * C.gate.pitch) / 2;
  solid.push(cbox(C.island.x0 - 1.7, C.island.x0 - 1.55, F + 0.012, F + 0.02, -gateHalf, gateHalf, COLOUR.guide));
  solid.push(cbox(C.island.x1 - 1.7, C.island.x1 - 1.55, F + 0.018, F + 0.026, -gateHalf, gateHalf, COLOUR.guide));
  solid.push(cbox(C.office.x0 - 1.5, C.office.x0 - 1.35, F + 0.012, F + 0.02, -C.office.halfZ, C.office.halfZ, COLOUR.guide));

  // Wall linings with a band in the line's colour, and the ceiling around the escalator openings.
  for (const s of [-1, 1]) {
    solid.push(cbox(-cl, cl, F, H, s * cw, s * (cw - 0.04), COLOUR.wall));
    solid.push(cbox(-cl, cl, F + 1.0, F + 1.18, s * (cw - 0.04), s * (cw - 0.055), lineColour));
    for (const x of [-cl, cl]) {
      const xi = x - Math.sign(x) * 0.04;
      solid.push(cbox(x, xi, F, H, -C.door.z0, C.door.z0, COLOUR.wall));
      solid.push(cbox(x, xi, F, H, s * C.door.z1, s * cw, COLOUR.wall));
      solid.push(cbox(x, xi, F + C.door.height, H, s * C.door.z0, s * C.door.z1, COLOUR.wall));
      signs.push(signFace(SIGN.wayOut, xi - Math.sign(x) * 0.012, F + C.door.height + 0.4, s * (C.door.z0 + C.door.z1) / 2, 2.2, 0.55, x > 0 ? "-x" : "+x"));
    }
  }
  const ceil = (x0: number, x1: number, z0: number, z1: number) => solid.push(cbox(x0, x1, H - 0.04, H, z0, z1, COLOUR.ceiling));
  ceil(-cl, o.x0, -cw, cw);
  ceil(o.x1, cl, -cw, cw);
  ceil(o.x0, o.x1, -o.z0, o.z0);
  for (const s of [-1, 1]) ceil(o.x0, o.x1, s * o.z1, s * cw);
  // Ceiling light strips in rows clear of the openings.
  // None inside the ticket office, which has its own lamp (two in one place flicker).
  const inOffice = (x0: number, x1: number, z: number) => x1 > C.office.x0 && x0 < C.office.x1 && Math.abs(z) < C.office.halfZ;
  for (const z of [-14.6, -7.2, 0, 7.2, 14.6]) {
    for (let x = -cl + 2; x < cl - 4; x += 6) {
      if (inOffice(x, x + 3.6, z)) continue;
      glow.push(cbox(x, x + 3.6, H - 0.06, H - 0.045, z - 0.14, z + 0.14, COLOUR.lamp));
    }
  }

  // Ticket office: a room with two windows on its west face, a counter shelf and a clerk at each.
  {
    const O = C.office;
    const sill = F + 1.05;
    const head = F + 2.25;
    const half = O.windowHalf;
    solid.push(cbox(O.x1 - 0.12, O.x1, F, H, -O.halfZ, O.halfZ, COLOUR.office));
    for (const s of [-1, 1]) solid.push(cbox(O.x0, O.x1, F, H, s * O.halfZ, s * (O.halfZ - 0.12), COLOUR.office));
    // Stops under the counter shelf, so the shelf alone is at sill height.
    solid.push(cbox(O.x0, O.x0 + 0.12, F, sill - 0.05, -O.halfZ, O.halfZ, COLOUR.office));
    solid.push(cbox(O.x0, O.x0 + 0.12, head, H, -O.halfZ, O.halfZ, COLOUR.office));
    const edges = [-O.halfZ, ...O.windows.flatMap((z) => [z - half, z + half]), O.halfZ];
    for (let i = 0; i < edges.length; i += 2) solid.push(cbox(O.x0, O.x0 + 0.12, sill - 0.05, head, edges[i], edges[i + 1], COLOUR.office));
    // Just above the hall tiles, not level with them.
    solid.push(cbox(O.x0 + 0.12, O.x1 - 0.12, F + 0.012, F + 0.02, -O.halfZ, O.halfZ, COLOUR.stone));
    for (const z of O.windows) {
      // Counter shelf through the window, glass above a pay slot, the sign over it.
      solid.push(cbox(O.x0 - O.shelf, O.x0 + 0.62, sill - 0.05, sill, z - half, z + half, COLOUR.stone));
      solid.push(cbox(O.x0 + 0.1, O.x0 + 0.16, F, sill - 0.05, z - half, z + half, COLOUR.office));
      glass.push(pane(O.x0 + 0.05, O.x0 + 0.07, sill + 0.16, head, z - half, z + half));
      signs.push(signFace(SIGN.tickets, O.x0 - 0.012, head + 0.42, z, 2.2, 0.55, "-x"));
      // The clerk's stool and monitor.
      solid.push(cbox(O.x0 + 0.8, O.x0 + 1.2, F, F + 0.47, z - 0.2, z + 0.2, COLOUR.dark));
      solid.push(cbox(O.x0 + 0.42, O.x0 + 0.46, sill + 0.02, sill + 0.3, z + 0.42, z + 0.82, COLOUR.dark));
      glow.push(cbox(O.x0 + 0.46, O.x0 + 0.47, sill + 0.04, sill + 0.28, z + 0.45, z + 0.79, "#9fc4e8"));
    }
    glow.push(cbox(O.x0 + 1.5, O.x1 - 1.5, H - 0.06, H - 0.045, -0.14, 0.14, COLOUR.lamp));
  }

  // Paid island: railings down both sides and across each end beside the gates.
  for (const s of [-1, 1]) {
    railing(C.island.x0, C.island.x1, s * (C.island.z - 0.02), s * (C.island.z + 0.02));
    for (const gx of [C.island.x0, C.island.x1]) railing(gx - 0.02, gx + 0.02, s * (gateHalf + C.gate.cabinetWidth / 2), s * C.island.z);
    // The escalator well is fenced where its underside is too low to walk under.
    railing(plan.escalator.x0, o.x1 + 0.55, s * (C.escalator.up[0] - 0.32), s * (C.escalator.up[0] - 0.28));
    railing(o.x1 + 0.51, o.x1 + 0.55, s * (C.escalator.up[0] - 0.3), s * (C.island.z - 0.02));
    board(s < 0 ? SIGN.platform1 : SIGN.platform2, plan.escalator.x0 - 0.9, F + 2.5, (s * (C.escalator.up[0] + C.escalator.down[1])) / 2, 2.4, "-x");
    // On the platform landing, the way out points back down.
    // Over the head of the down escalator, facing those who come off the platform.
    board(SIGN.wayOut, plan.landing.x0 + 0.1, plan.platformY + 2.4, (s * (C.escalator.down[0] + C.escalator.down[1])) / 2, 1.9, "+x", plan.platformY + 2.9);
  }

  // Fare gates: a cabinet either side of every lane, a reader on the approach side, a lit arrow or cross.
  const gates: [number, 1 | -1][] = [
    [C.island.x0, 1],
    [C.island.x1, 1],
  ];
  for (const [gx, dir] of gates) {
    const top = F + C.gate.cabinetHeight;
    const half = C.gate.cabinetLength / 2;
    for (let k = 0; k <= C.gate.lanes.length; k++) {
      const z = C.gate.lanes[0] - C.gate.pitch / 2 + k * C.gate.pitch;
      const w = C.gate.cabinetWidth / 2;
      solid.push(cbox(gx - half, gx + half, F, top - 0.04, z - w, z + w, COLOUR.cabinet));
      solid.push(cbox(gx - half, gx + half, top - 0.04, top, z - w, z + w, COLOUR.steel));
      solid.push(cbox(gx - half * dir - 0.02, gx - half * dir + 0.02, F + 0.02, top - 0.06, z - w + 0.03, z + w - 0.03, COLOUR.dark));
      if (k < C.gate.lanes.length) {
        // A reader pad on the approach end of the cabinet; a green light on the way in, red on the way back.
        solid.push(cbox(gx - dir * (half - 0.12), gx - dir * (half - 0.4), top, top + 0.025, z - w + 0.05, z + w - 0.05, COLOUR.reader));
        glow.push(cbox(gx - dir * half - dir * 0.022, gx - dir * half - dir * 0.03, top - 0.36, top - 0.2, z - 0.08, z + 0.08, COLOUR.go));
        glow.push(cbox(gx + dir * half + dir * 0.002, gx + dir * half + dir * 0.01, top - 0.36, top - 0.2, z - 0.08, z + 0.08, COLOUR.stop));
      }
    }
  }
  board(SIGN.entry, C.island.x0 - 0.75, F + 2.55, 0, 3.2, "-x");
  board(SIGN.exit, C.island.x1 - 0.75, F + 2.55, 0, 3.2, "-x");

  // Security check: a detector in each lane, the X-ray machine and its belt, the women's enclosure, rails and signs.
  {
    const S = C.security;
    const fx = S.frameX;
    const top = F + S.frameHeight;
    const [men, women] = S.lanes;
    for (const { frameZ } of S.lanes) {
      for (const s of [-1, 1]) {
        const inner = frameZ + s * S.frameHalf;
        const outer = frameZ + s * (S.frameHalf + 0.15);
        solid.push(cbox(fx - 0.2, fx + 0.2, F, top, Math.min(inner, outer), Math.max(inner, outer), COLOUR.cabinet));
        glow.push(cbox(fx - 0.21, fx - 0.2, F + 1.0, F + 1.9, frameZ + s * (S.frameHalf + 0.05) - 0.03, frameZ + s * (S.frameHalf + 0.05) + 0.03, COLOUR.go));
      }
      solid.push(cbox(fx - 0.2, fx + 0.2, top, top + 0.16, frameZ - S.frameHalf - 0.15, frameZ + S.frameHalf + 0.15, COLOUR.dark));
    }
    // Rails along the detector line, between the lanes, round the operator and on to the island.
    railing(fx - 0.02, fx + 0.02, S.machine.z1, men.frameZ - S.frameHalf - 0.15);
    railing(fx - 0.02, fx + 0.02, men.frameZ + S.frameHalf + 0.15, women.frameZ - S.frameHalf - 0.15);
    railing(fx - 0.02, fx + 0.02, women.frameZ + S.frameHalf + 0.15, S.penHalf);
    railing(fx, S.barrierX, men.z0 - 0.02, men.z0 + 0.02);
    railing(fx, S.enclosure.x0, men.z1 - 0.02, men.z1 + 0.02);
    railing(S.enclosure.x1, S.barrierX, men.z1 - 0.02, men.z1 + 0.02);
    railing(S.barrierX - 0.02, S.barrierX + 0.02, S.belt.z1, men.z0);
    railing(S.machine.x1, C.island.x0, -S.penHalf - 0.02, -S.penHalf + 0.02);
    railing(fx, S.enclosure.x0, S.penHalf - 0.02, S.penHalf + 0.02);
    railing(S.enclosure.x1, C.island.x0, S.penHalf - 0.02, S.penHalf + 0.02);

    // The women's enclosure: closed on every side and roofed, so nothing inside can be seen.
    // The curtains across its two doorways are WalkMode's, because they draw aside for the passenger.
    {
      const E = S.enclosure;
      const h = F + E.height;
      solid.push(cbox(E.x0, E.x1, F, h, women.z0 - 0.03, women.z0 + 0.03, CURTAIN));
      solid.push(cbox(E.x0, E.x1, F, h, women.z1 - 0.03, women.z1 + 0.03, CURTAIN));
      for (const x of [E.x0, E.x1]) {
        solid.push(cbox(x - 0.03, x + 0.03, F, h, women.z0, women.frameZ - S.frameHalf, CURTAIN));
        solid.push(cbox(x - 0.03, x + 0.03, F, h, women.frameZ + S.frameHalf, women.z1, CURTAIN));
        solid.push(cbox(x - 0.04, x + 0.04, h, h + 0.05, women.z0 - 0.04, women.z1 + 0.04, COLOUR.steel));
      }
      for (const z of [women.z0, women.z1]) solid.push(cbox(E.x0 - 0.04, E.x1 + 0.04, h, h + 0.05, z - 0.04, z + 0.04, COLOUR.steel));
      solid.push(cbox(E.x0 - 0.03, E.x1 + 0.03, h - 0.03, h + 0.02, women.z0 - 0.03, women.z1 + 0.03, CURTAIN));
      glow.push(cbox(E.x0 + 0.4, E.x1 - 0.4, h - 0.045, h - 0.03, women.frameZ - 0.1, women.frameZ + 0.1, COLOUR.lamp));
    }

    // X-ray machine: a belt on legs through a housing with a dark tunnel at each end.
    {
      const B = S.belt;
      const M = S.machine;
      const y = F + B.top;
      solid.push(cbox(B.x0, B.x1, y - 0.1, y - 0.015, B.z0, B.z1, COLOUR.steel));
      solid.push(cbox(B.x0, B.x1, y - 0.015, y, B.z0 + 0.04, B.z1 - 0.04, COLOUR.dark));
      for (const x of [B.x0 + 0.1, B.midLeg, B.x1 - 0.1]) for (const z of [B.z0 + 0.06, B.z1 - 0.06]) solid.push(cbox(x - 0.03, x + 0.03, F, y - 0.1, z - 0.03, z + 0.03, COLOUR.steel));
      const open = y + M.tunnel;
      solid.push(cbox(M.x0, M.x1, F, y - 0.1, M.z0, M.z1, COLOUR.office));
      solid.push(cbox(M.x0, M.x1, open, F + M.height, M.z0, M.z1, COLOUR.office));
      solid.push(cbox(M.x0, M.x1, y - 0.1, open, M.z0, B.z0, COLOUR.office));
      solid.push(cbox(M.x0, M.x1, y - 0.1, open, B.z1, M.z1, COLOUR.office));
      solid.push(cbox(M.x0 - 0.01, M.x0 + 0.01, open, open + 0.08, M.z0, M.z1, COLOUR.box));
      solid.push(cbox(M.x1 - 0.01, M.x1 + 0.01, open, open + 0.08, M.z0, M.z1, COLOUR.box));
      // Strip curtains that hide the tunnel.
      for (const x of [M.x0, M.x1]) glass.push(pane(x - 0.01, x + 0.01, y, open, B.z0, B.z1));
      // The operator's desk and the back of the monitor (the screen itself is WalkMode's).
      const D = S.desk;
      solid.push(cbox(D.x0, D.x1, F + D.height - 0.04, F + D.height, D.z0, D.z1, COLOUR.stone));
      for (const x of [D.x0 + 0.06, D.x1 - 0.06]) solid.push(cbox(x - 0.03, x + 0.03, F, F + D.height - 0.04, D.z0 + 0.1, D.z1 - 0.1, COLOUR.steel));
      const Mon = S.monitor;
      solid.push(cbox(Mon.x - 0.03, Mon.x + 0.03, F + D.height, F + D.height + Mon.stand, Mon.z - 0.03, Mon.z + 0.03, COLOUR.dark));
      const back = new BoxGeometry(Mon.width + 0.05, Mon.height + 0.05, 0.04).toNonIndexed();
      back.rotateY(Math.PI / 4);
      back.translate(Mon.x - 0.016, F + D.height + Mon.stand + Mon.height / 2, Mon.z - 0.016);
      solid.push(coloured(back, COLOUR.dark));
    }

    board(SIGN.security, fx - 2.1, F + 2.65, 0, 2.4, "-x");
    board(SIGN.men, fx - 0.5, F + 2.62, men.frameZ, 1.5, "-x");
    board(SIGN.women, fx - 0.5, F + 2.62, women.frameZ, 1.5, "-x");
    board(SIGN.bags, S.bagFrom, F + 2.45, S.belt.z0, 1.5, "-x");
  }

  // Used-ticket box past the exit gates.
  {
    const B = C.ticketBox;
    solid.push(cbox(B.x - B.half, B.x + B.half, F, F + B.height, B.z - B.half, B.z + B.half, COLOUR.box));
    solid.push(cbox(B.x - B.half - 0.02, B.x + B.half + 0.02, F + B.height, F + B.height + 0.05, B.z - B.half - 0.02, B.z + B.half + 0.02, COLOUR.dark));
    solid.push(cbox(B.x - 0.16, B.x + 0.16, F + B.height + 0.05, F + B.height + 0.056, B.z - 0.03, B.z + 0.03, "#05070a"));
    signs.push(signFace(SIGN.usedTickets, B.x - B.half - 0.006, F + 0.72, B.z, 0.56, 0.14, "-x"));
  }

  // People: a clerk at each window, and a few passengers standing about.
  {
    const rng = mulberry32(4107);
    const up = new Vector3(0, 1, 0);
    const m = new Matrix4();
    const q = new Quaternion();
    const one = new Vector3(1, 1, 1);
    const person = (x: number, y: number, z: number, yaw: number, pose: Pose, scale = 1) => {
      const outfit = pickOutfit(rng);
      const g = paintHuman(humanTemplate({ outfit, pose, hair: pickHair(outfit, rng) }), pickColours(outfit, rng));
      m.compose(new Vector3(x, y, z), q.setFromAxisAngle(up, yaw), one.setScalar(scale));
      solid.push(g.applyMatrix4(m));
    };
    for (const z of C.office.windows) person(C.office.x0 + 1.0, F + 0.47, z, FACING_YAW["-x"], "sit");
    for (const [x, z, yaw] of C.bystanders) person(x, F, z, yaw, rng() < 0.5 ? "phone" : "stand", 0.95 + rng() * 0.1);
    const staff = (spec: HumanSpec, skin: string, x: number, z: number, yaw: number) => {
      const g = paintHuman(humanTemplate(spec), { skin, ...UNIFORM });
      m.compose(new Vector3(x, F, z), q.setFromAxisAngle(up, yaw), one.setScalar(1));
      solid.push(g.applyMatrix4(m));
    };
    // Staff in each lane, a man in the men's and a woman in the women's, facing across it; the right arm is drawn apart so it can move.
    const [men, women] = C.security.lanes;
    staff({ outfit: "shirt", pose: "guard", hair: "short" }, GUARD_SKIN[0], men.guard.x, men.guard.z, FACING_YAW["-z"]);
    staff({ outfit: "kurta", pose: "guard", hair: "bun" }, GUARD_SKIN[1], women.guard.x, women.guard.z, FACING_YAW["-z"]);
    // The X-ray operator at the monitor, and the guard who just stands at the exit.
    staff({ outfit: "shirt", pose: "stand", hair: "short" }, OPERATOR_SKIN, C.security.operator.x, C.security.operator.z, FACING_YAW["-z"] - Math.PI / 4);
    staff({ outfit: "shirt", pose: "stand", hair: "short" }, GUARD_SKIN[1], C.exitGuard.x, C.exitGuard.z, FACING_YAW["-x"]);
  }

  return { solid: merge(solid), glass: merge(glass), glow: merge(glow), signs: merge(signs) };
}

/** The guard's right arm and hand scanner, reaching along +z from the shoulder at the origin. */
export function buildGuardArm(skin: string): BufferGeometry {
  /** A rounded limb along +z, matching the people's own arms. */
  const limb = (r: number, z0: number, z1: number, colour: string) => coloured(new CapsuleGeometry(r, z1 - z0, 3, 8).rotateX(Math.PI / 2).translate(0, 0, (z0 + z1) / 2), colour);
  return merge([
    limb(0.05, 0, 0.28, UNIFORM.top),
    limb(0.04, 0.28, 0.55, UNIFORM.top),
    limb(0.036, 0.57, 0.62, skin),
    cbox(-0.018, 0.018, -0.018, 0.018, 0.62, 0.76, COLOUR.dark),
    cbox(-0.012, 0.012, -0.05, 0.05, 0.76, 1.02, COLOUR.dark),
    cbox(-0.013, 0.013, -0.015, 0.015, 0.99, 1.01, COLOUR.stop),
  ]);
}

/** The passenger's backpack, standing on the belt at the origin. */
export function buildBag(): BufferGeometry {
  return merge([
    cbox(-0.16, 0.16, 0, 0.42, -0.12, 0.12, "#7a2f3a"),
    cbox(-0.12, 0.12, 0.04, 0.2, 0.12, 0.17, "#5a1e28"),
    cbox(-0.05, 0.05, 0.42, 0.47, -0.02, 0.02, COLOUR.dark),
  ]);
}

/** One escalator's treads as steps, from a step below the foot to the head: slid along the slope to make them run (WalkMode.tsx). */
export function buildEscalatorSteps(plan: ConcoursePlan): { geometry: BufferGeometry; tread: number; rise: number } {
  const E = CONCOURSE.escalator;
  const rise = E.stepRise;
  const tread = rise / Math.tan(E.angle);
  const n = Math.round(plan.escalator.rise / rise);
  const parts: BufferGeometry[] = [];
  const half = E.stepWidth / 2;
  // Stopping a step short of the head keeps every tread under the landing floor as it arrives.
  for (let k = -1; k < n - 1; k++) {
    // Tops half a riser off the walking line, as on the street stairs.
    const y = (k + 0.5) * rise;
    parts.push(cbox(k * tread, (k + 1) * tread, y - rise - 0.02, y, -half, half, "#2a2f36"));
    // Yellow edge on each nosing.
    parts.push(cbox((k + 1) * tread - 0.03, (k + 1) * tread, y, y + 0.004, -half, half, COLOUR.guide));
  }
  return { geometry: merge(parts), tread, rise };
}
