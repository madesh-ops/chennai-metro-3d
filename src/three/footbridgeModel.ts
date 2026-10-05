import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Covered steel footbridge (FOB) over a road, as at Poonamallee Bypass metro:
 * a white Warren truss either side of a concrete walkway, a faceted roof
 * clad in diamond-patterned panels, round white columns with cross-heads,
 * and a clad stair/lift tower at the far end.
 *
 * Local frame: x across the road (0 at the station, `length` at the tower),
 * z along the walkway's width, y up from the ground.
 */
export interface FootbridgeDims {
  length: number;
  width: number;
  /** Walkway level above the road (m). */
  floor: number;
  /** Intermediate supports, as distances along x. */
  supports: number[];
  /** Stair/lift tower footprint (square) and height. */
  tower: { size: number; height: number };
}

export interface FootbridgeGeometry {
  steel: BufferGeometry;
  floor: BufferGeometry;
  /** Roof cladding (uv for the diamond panel texture). */
  roof: BufferGeometry;
  tower: BufferGeometry;
}

const TRUSS_H = 3.6;
const PANEL = 3.0;
const MEMBER = 0.22;

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): BufferGeometry {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  g.deleteAttribute("uv");
  return g.toNonIndexed();
}

/** A straight member between two points in the x-y plane at depth z (square section). */
function member(x0: number, y0: number, x1: number, y1: number, z: number, t = MEMBER): BufferGeometry {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const g = new BoxGeometry(len, t, t);
  g.rotateZ(Math.atan2(y1 - y0, x1 - x0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
  g.deleteAttribute("uv");
  return g.toNonIndexed();
}

export function buildFootbridge(d: FootbridgeDims): FootbridgeGeometry {
  const { length: L, width: W, floor: F } = d;
  const steel: BufferGeometry[] = [];
  const hw = W / 2;
  const top = F + TRUSS_H;
  // Two side trusses: chords, verticals and alternating diagonals.
  const panels = Math.max(1, Math.round(L / PANEL));
  const p = L / panels;
  for (const z of [-hw, hw]) {
    steel.push(member(0, F, L, F, z, 0.35), member(0, top, L, top, z, 0.3));
    for (let k = 0; k <= panels; k++) steel.push(member(k * p, F, k * p, top, z));
    for (let k = 0; k < panels; k++) {
      const up = k % 2 === 0;
      steel.push(member(k * p, up ? F : top, (k + 1) * p, up ? top : F, z));
    }
  }
  // Cross beams under the walkway and over the top, each panel point.
  for (let k = 0; k <= panels; k++) {
    steel.push(box(k * p - 0.12, k * p + 0.12, F - 0.45, F - 0.15, -hw, hw));
    steel.push(box(k * p - 0.1, k * p + 0.1, top - 0.1, top + 0.1, -hw, hw));
  }
  // Supports: round white columns with a cross-head under the walkway.
  for (const x of d.supports) {
    const c = new CylinderGeometry(0.55, 0.6, F - 0.9, 20);
    c.translate(x, (F - 0.9) / 2, 0);
    steel.push(c.toNonIndexed());
    steel.push(box(x - 0.5, x + 0.5, F - 1.1, F - 0.45, -hw - 0.3, hw + 0.3));
  }
  for (const g of steel) {
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
  }

  // Walkway slab with a low kerb.
  const floor = mergeGeometries([box(0, L, F - 0.15, F + 0.05, -hw, hw), box(0, L, F + 0.05, F + 0.25, -hw, -hw + 0.15), box(0, L, F + 0.05, F + 0.25, hw - 0.15, hw)])!;

  // Faceted roof over the trusses: two sloped sides and a flat crown, clad in diamond panels.
  // u runs along the bridge, v across the roof, both in metres / 2 (texture repeats every 2 m).
  const rise = 1.0;
  const eave = top + 0.1;
  const crownHalf = hw * 0.45;
  const roofPts: [number, number][] = [
    [-hw - 0.3, eave],
    [-crownHalf, eave + rise],
    [crownHalf, eave + rise],
    [hw + 0.3, eave],
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  let vAcc = 0;
  for (let i = 0; i < roofPts.length - 1; i++) {
    const [z0, y0] = roofPts[i];
    const [z1, y1] = roofPts[i + 1];
    const w = Math.hypot(z1 - z0, y1 - y0);
    const v0 = vAcc / 2;
    const v1 = (vAcc + w) / 2;
    vAcc += w;
    const A = [0, y0, z0];
    const B = [L, y0, z0];
    const C = [L, y1, z1];
    const D = [0, y1, z1];
    // Facing up/out (counter-clockwise seen from above the roof).
    for (const [P, u, v] of [
      [A, 0, v0],
      [D, 0, v1],
      [C, L / 2, v1],
      [A, 0, v0],
      [C, L / 2, v1],
      [B, L / 2, v0],
    ] as const) {
      pos.push(P[0], P[1], P[2]);
      uv.push(u, v);
    }
  }
  const roof = new BufferGeometry();
  roof.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  roof.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  roof.computeVertexNormals();

  // Stair/lift tower at the far end: clad box with a lighter crown and a roof slab.
  const s = d.tower.size / 2;
  const tx = L + s - 0.5;
  const tower = mergeGeometries([
    box(tx - s, tx + s, 0, d.tower.height, -s, s),
    box(tx - s - 0.4, tx + s + 0.4, d.tower.height, d.tower.height + 0.5, -s - 0.4, s + 0.4),
  ])!;
  return { steel: mergeGeometries(steel)!, floor, roof, tower };
}
