import { BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TRAIN } from "./layout.ts";

/**
 * Cab front of the Chennai Metro Alstom Metropolis, after a photo of the
 * trainset: a rounded, nearly upright blue face leaning back a little and
 * rolling into the roof, a wrap-around black mask holding the windscreen
 * and the amber destination display, black headlight pods at the lower
 * corners, a grey-blue bumper with grilles, and a coupler under it.
 *
 * Car-local space (+x forward, +y up from rail top, +z right). The face is
 * a height field x = faceX(y, z) over the front-view outline: a box whose
 * top is a superellipse (the roof section), so the roll into the roof and
 * the rounded corners in plan both come from one function.
 */

const W = TRAIN.width / 2;
/** Bottom of the blue shell; the dark skirt is below it. */
const SHELL_BOTTOM = 1.15;
const SKIRT_BOTTOM = 0.58;
/** Section centre and half-height of the roof superellipse. */
const YC = 2.4;
const HY = TRAIN.roof - YC;
const N = 4;
/** How far the face rolls back at its edges, and where the roll starts (0..1 of the outline). */
const EDGE_DEPTH = 0.78;
const EDGE_START = 0.5;

/** Centre-line profile in side view: [y, distance ahead of the cab bulkhead]. */
const PROFILE: [number, number][] = [
  [0.8, 2.3],
  [1.15, 2.33],
  [1.45, 2.39],
  [1.62, 2.4],
  [1.85, 2.36],
  [3.3, 2.1],
  [3.6, 2.02],
  [TRAIN.roof, 1.96],
];

function profileX(y: number): number {
  const p = PROFILE;
  if (y <= p[0][0]) return p[0][1];
  if (y >= p[p.length - 1][0]) return p[p.length - 1][1];
  let i = 0;
  while (y > p[i + 1][0]) i++;
  // Cubic Hermite with finite-difference tangents (smooth, no bumps at the nodes).
  const slope = (k: number) => {
    const a = p[Math.max(0, k - 1)];
    const b = p[Math.min(p.length - 1, k + 1)];
    return (b[1] - a[1]) / (b[0] - a[0]);
  };
  const [y0, x0] = p[i];
  const [y1, x1] = p[i + 1];
  const h = y1 - y0;
  const t = (y - y0) / h;
  const m0 = slope(i) * h;
  const m1 = slope(i + 1) * h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * x0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * x1 + (t3 - t2) * m1;
}

/** 0 in the middle of the face, 1 on its outline (sides and roof; the bottom stays square). */
function outlineNorm(y: number, z: number): number {
  const a = Math.abs(z) / W;
  const b = Math.max(0, (y - YC) / HY);
  return Math.min(1, Math.pow(Math.pow(a, N) + Math.pow(b, N), 1 / N));
}

function rollBack(r: number): number {
  if (r <= EDGE_START) return 0;
  const t = Math.min(1, (r - EDGE_START) / (1 - EDGE_START));
  return EDGE_DEPTH * (1 - Math.sqrt(1 - t * t));
}

/** Face position ahead of the cab bulkhead at height y and offset z. */
export function faceX(y: number, z: number): number {
  return profileX(y) - rollBack(outlineNorm(y, z));
}

/** Outward unit normal of the face (numerical gradient). */
function faceNormal(y: number, z: number, out: Vector3): Vector3 {
  const e = 0.004;
  const dy = (faceX(y + e, z) - faceX(y - e, z)) / (2 * e);
  const dz = (faceX(y, z + e) - faceX(y, z - e)) / (2 * e);
  return out.set(1, -dy, -dz).normalize();
}

/** Furthest-forward point of the shell, ahead of the cab bulkhead. */
export const NOSE_DEPTH = (() => {
  let m = 0;
  for (let y = SHELL_BOTTOM; y <= TRAIN.roof; y += 0.01) m = Math.max(m, profileX(y));
  return m;
})();

/* ------------------------------------------------------------------ */
/* Outline and grids                                                    */
/* ------------------------------------------------------------------ */

/** Closed front-view outline of the shell (y, z), anticlockwise seen from the front-left. */
function outline(segments: number): [number, number][] {
  const pts: [number, number][] = [];
  const side = 6;
  const bottom = 10;
  const arc = segments - 2 * side - bottom;
  // Left side up.
  for (let i = 0; i < side; i++) pts.push([SHELL_BOTTOM + ((YC - SHELL_BOTTOM) * i) / side, -W]);
  // Roof superellipse, left to right.
  for (let i = 0; i < arc; i++) {
    const th = Math.PI - (Math.PI * i) / arc;
    const c = Math.cos(th);
    const s = Math.sin(th);
    pts.push([YC + HY * Math.pow(Math.abs(s), 2 / N), W * Math.sign(c) * Math.pow(Math.abs(c), 2 / N)]);
  }
  // Right side down.
  for (let i = 0; i < side; i++) pts.push([YC - ((YC - SHELL_BOTTOM) * i) / side, W]);
  // Bottom, right to left.
  for (let i = 0; i < bottom; i++) pts.push([SHELL_BOTTOM, W - (2 * W * i) / bottom]);
  return pts;
}

function geometryFrom(positions: number[], indices: number[], colour: string, uvs?: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  if (uvs) g.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  const n = g.toNonIndexed();
  g.dispose();
  return paint(n, colour);
}

/** Add a flat vertex colour (drops uv unless kept). */
export function paint(g: BufferGeometry, colour: string, keepUv = false): BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(n.attributes)) {
    if (name !== "position" && name !== "normal" && !(keepUv && name === "uv")) n.deleteAttribute(name);
  }
  const c = new Color(colour);
  const arr = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < n.attributes.position.count; i++) c.toArray(arr, i * 3);
  n.setAttribute("color", new BufferAttribute(arr, 3));
  return n;
}

/** The blue shell: side/roof walls from the bulkhead plus the face itself. */
function shell(x0: number, colour: string): BufferGeometry[] {
  const ring = outline(96);
  const M = ring.length;
  // Walls from the bulkhead to where the face starts (bottom edge = underside).
  const wp: number[] = [];
  const wi: number[] = [];
  for (const [y, z] of ring) wp.push(x0, y, z, x0 + faceX(y, z), y, z);
  for (let j = 0; j < M; j++) {
    const k = (j + 1) % M;
    const a = 2 * j;
    const b = 2 * k;
    wi.push(a, b, a + 1, b, b + 1, a + 1);
  }
  // Face: polar grid from the outline to the centre, denser near the rolled edge.
  const R = 28;
  const fp: number[] = [];
  const fi: number[] = [];
  for (let r = 0; r <= R; r++) {
    const rho = Math.cos((Math.PI / 2) * (r / R)); // 1 at the outline → 0 at the centre
    for (const [by, bz] of ring) {
      const y = YC + (by - YC) * rho;
      const z = bz * rho;
      fp.push(x0 + faceX(y, z), y, z);
    }
  }
  for (let r = 0; r < R; r++) {
    for (let j = 0; j < M; j++) {
      const k = (j + 1) % M;
      const a = r * M + j;
      const b = r * M + k;
      fi.push(a, b, a + M, b, b + M, a + M);
    }
  }
  const walls = geometryFrom(wp, wi, colour);
  const face = geometryFrom(fp, fi, colour);
  return [walls, face];
}

interface PatchSpec {
  zc: number;
  yc: number;
  hz: number;
  hy: number;
  /** Superellipse exponent of the outline (2 = ellipse, large = rectangle). */
  n: number;
  /** Lift above the shell along its normal. */
  lift: number;
  /** Narrower at the top: 0.1 = top 10 % narrower than the middle. */
  taper?: number;
  rings?: number;
  segments?: number;
}

/**
 * A patch lying on the face, `lift` metres off it. UVs run left→right as
 * seen from in front of the train (u) and bottom→top (v).
 */
function patch(x0: number, s: PatchSpec, colour: string, keepUv = false): BufferGeometry {
  const R = s.rings ?? 6;
  const M = s.segments ?? 48;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const nrm = new Vector3();
  const taper = s.taper ?? 0;
  for (let r = 0; r <= R; r++) {
    const rho = r / R;
    for (let j = 0; j < M; j++) {
      const th = (2 * Math.PI * j) / M;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const dy = s.hy * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / s.n) * rho;
      const y = s.yc + dy;
      const scale = 1 - taper * (dy / s.hy);
      const z = s.zc + s.hz * scale * Math.sign(c) * Math.pow(Math.abs(c), 2 / s.n) * rho;
      faceNormal(y, z, nrm);
      pos.push(x0 + faceX(y, z) + nrm.x * s.lift, y + nrm.y * s.lift, z + nrm.z * s.lift);
      uv.push((s.zc + s.hz - z) / (2 * s.hz), (y - (s.yc - s.hy)) / (2 * s.hy));
    }
  }
  for (let r = 0; r < R; r++) {
    for (let j = 0; j < M; j++) {
      const k = (j + 1) % M;
      const a = r * M + j;
      const b = r * M + k;
      // Seen from +x: z decreases to the viewer's right, so this winding faces forward.
      idx.push(a, b, a + M, b, b + M, a + M);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Make sure the patch faces forward (normals along the face's outward side).
  const nor = g.getAttribute("normal");
  let fwd = 0;
  for (let i = 0; i < nor.count; i++) fwd += nor.getX(i);
  if (fwd < 0) {
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i += 3) {
      const t = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, t);
    }
    g.computeVertexNormals();
  }
  const out = g.toNonIndexed();
  g.dispose();
  return paint(out, colour, keepUv);
}

function slab(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: string): BufferGeometry {
  // Axis-aligned box as 12 triangles with flat normals.
  const g = new BufferGeometry();
  const p = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const quads = [
    [1, 2, 6, 5], [0, 4, 7, 3], [3, 7, 6, 2], [0, 1, 5, 4], [4, 5, 6, 7], [0, 3, 2, 1],
  ];
  const pos: number[] = [];
  for (const [a, b, c, d] of quads) for (const v of [a, b, c, a, c, d]) pos.push(...p[v]);
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return paint(g, colour);
}

export const NOSE_COLOURS = {
  blue: "#2864ec",
  /** Grey surround of the windscreen. */
  mask: "#5a626c",
  pod: "#0b0d10",
  grille: "#2a2f36",
  logo: "#c9ced4",
  /** Lower front bumper. */
  bumper: "#7b8794",
  coupler: "#1c2026",
  buffer: "#eef0f2",
};

export interface NoseParts {
  /** Vertex-coloured shell, mask, pods, grilles, logo, skirt and coupler (hidden from the driver's seat). */
  shell: BufferGeometry;
  /** Windscreen glass. */
  glass: BufferGeometry;
  /** Amber destination display (uv for the LED texture). */
  destination: BufferGeometry;
  /** Lamp lenses (head- or tail-light material). */
  lamps: BufferGeometry;
  /** Cab interior frame seen from the driver's seat (dark). */
  frame: BufferGeometry;
  /** Where the head-light beam starts. */
  beam: [number, number, number];
}

const LAMP_Y = 1.5;

/** Build the cab front with the bulkhead at x = x0. */
export function buildNose(x0: number): NoseParts {
  const C = NOSE_COLOURS;
  const shellParts = shell(x0, C.blue);
  const extras: BufferGeometry[] = [
    // Wrap-around black mask holding the windscreen and destination display.
    patch(x0, { zc: 0, yc: 2.62, hz: 1.24, hy: 0.84, n: 5, lift: 0.024, taper: 0.12, rings: 10, segments: 72 }, C.mask),
    // Headlight pods, lower corners.
    ...[-1, 1].map((s) => patch(x0, { zc: s * 0.97, yc: LAMP_Y, hz: 0.3, hy: 0.12, n: 4, lift: 0.014 }, C.pod)),
    // Round logo on the chin.
    patch(x0, { zc: 0, yc: LAMP_Y, hz: 0.1, hy: 0.1, n: 2, lift: 0.012 }, C.logo),
    patch(x0, { zc: 0, yc: LAMP_Y, hz: 0.07, hy: 0.07, n: 2, lift: 0.016 }, C.blue),
  ];
  // Grey-blue bumper under the shell, following the face in plan.
  const sp: number[] = [];
  const si: number[] = [];
  const plan: [number, number][] = [[0, -W]];
  for (let i = 0; i <= 24; i++) {
    const z = -W + (2 * W * i) / 24;
    plan.push([faceX(SHELL_BOTTOM, z) - 0.005, z]);
  }
  plan.push([0, W]);
  for (const [x, z] of plan) sp.push(x0 + x, SKIRT_BOTTOM, z, x0 + x, SHELL_BOTTOM, z);
  for (let j = 0; j < plan.length - 1; j++) {
    const a = 2 * j;
    const b = 2 * (j + 1);
    si.push(a, a + 1, b, b, a + 1, b + 1);
  }
  extras.push(geometryFrom(sp, si, C.bumper));
  // Grilles on the bumper either side, slatted.
  for (const side of [-1, 1]) {
    const zc = side * 0.86;
    const fx = x0 + Math.min(faceX(SHELL_BOTTOM, zc - 0.22), faceX(SHELL_BOTTOM, zc + 0.22)) - 0.005;
    extras.push(slab(fx - 0.01, fx + 0.008, 0.9, 1.08, zc - 0.22, zc + 0.22, C.grille));
    for (let y = 0.92; y < 1.07; y += 0.035) extras.push(slab(fx, fx + 0.016, y, y + 0.012, zc - 0.21, zc + 0.21, C.bumper));
  }
  // Coupler under the bumper with its white buffer plate.
  const tip = x0 + faceX(SHELL_BOTTOM, 0) - 0.005;
  extras.push(slab(tip - 0.3, tip + 0.1, 0.62, 0.82, -0.17, 0.17, C.coupler));
  extras.push(slab(tip + 0.1, tip + 0.14, 0.63, 0.81, -0.2, 0.2, C.buffer));

  const glass = patch(x0, { zc: 0, yc: 2.6, hz: 1.1, hy: 0.62, n: 5, lift: 0.034, taper: 0.12, rings: 10, segments: 72 }, "#ffffff");
  const destination = patch(x0, { zc: 0, yc: 3.12, hz: 0.6, hy: 0.085, n: 10, lift: 0.042, rings: 2 }, "#ffffff", true);
  const lamps: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    lamps.push(patch(x0, { zc: s * 0.86, yc: LAMP_Y + 0.005, hz: 0.065, hy: 0.065, n: 2, lift: 0.024, rings: 2, segments: 20 }, "#ffffff"));
    lamps.push(patch(x0, { zc: s * 1.07, yc: LAMP_Y + 0.005, hz: 0.065, hy: 0.065, n: 2, lift: 0.024, rings: 2, segments: 20 }, "#ffffff"));
    lamps.push(patch(x0, { zc: s * 1.2, yc: LAMP_Y - 0.02, hz: 0.03, hy: 0.03, n: 2, lift: 0.024, rings: 1, segments: 12 }, "#ffffff"));
  }

  // Cab frame from the inside: windscreen pillars, console and header. Each piece
  // stops short of the face at its outermost corner so nothing pokes through.
  const inside = (y0: number, y1: number, z0: number, z1: number, gap: number) =>
    x0 + Math.min(faceX(y0, z0), faceX(y0, z1), faceX(y1, z0), faceX(y1, z1)) - gap;
  const frame: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    for (let y = 1.95; y < 3.25; y += 0.13) {
      const z0 = s * 1.04;
      const z1 = s * 1.18;
      const x = inside(y, y + 0.135, z0, z1, 0.05);
      frame.push(slab(x - 0.08, x, y, y + 0.135, Math.min(z0, z1), Math.max(z0, z1), C.coupler));
    }
  }
  frame.push(slab(x0 + 0.9, inside(1.13, 1.82, -1.1, 1.1, 0.12), 1.13, 1.82, -1.1, 1.1, C.coupler));
  frame.push(slab(x0 - 0.2, inside(3.42, 3.5, -1.05, 1.05, 0.06), 3.42, 3.5, -1.05, 1.05, C.coupler));

  const join = (parts: BufferGeometry[], uv = false) => {
    const clean = parts.map((g) => {
      for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "color" && !(uv && name === "uv")) g.deleteAttribute(name);
      return g;
    });
    const m = mergeGeometries(clean, false);
    clean.forEach((g) => g.dispose());
    if (!m) throw new Error("Failed to merge the cab front");
    m.computeBoundingSphere();
    return m;
  };
  return {
    shell: join([...shellParts, ...extras]),
    glass: join([glass]),
    destination: join([destination], true),
    lamps: join(lamps),
    frame: join(frame),
    beam: [x0 + faceX(LAMP_Y, 0) + 0.05, LAMP_Y, 0],
  };
}
