import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32, pick, range as rr } from "../utils/random.ts";

/**
 * Landmarks modelled on reference photos supplied by the project owner:
 * Nexus Vijaya Mall (sweeping silver canopy over glass blocks, landscaped
 * forecourt, solar panels on the roof), Kamala Cinemas (white front with a
 * poster row and its name sign, big car park in front) and Chandra Metro
 * Mall (blue glass sail, gold billboard band, white drum with a crown).
 * Local frame as in landmarkModels.ts: +x along the road, +y up, origin at
 * the footprint centre, front facing -z (towards the road).
 */

/** A textured flat panel (sign, hoarding, poster) facing -z. */
export interface Panel {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  /** Texture key, see makeLandmarkPanelTexture(). */
  texture: string;
}

export interface CommercialModel {
  solid: BufferGeometry;
  /** Curtain-wall glass (own material, lit at night). */
  glass?: BufferGeometry;
  panels: Panel[];
}

const tmp = new Color();

function paint(g: BufferGeometry, hex: string): BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (n.getAttribute("uv")) n.deleteAttribute("uv");
  tmp.set(hex);
  const count = n.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) tmp.toArray(arr, i * 3);
  n.setAttribute("color", new BufferAttribute(arr, 3));
  return n;
}

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hex: string) {
  const g = new BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return paint(g, hex);
}

/** Plain glass box (no colour attribute: drawn with the glass material). */
function glassBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const g = new BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)).toNonIndexed();
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  g.deleteAttribute("uv");
  return g;
}

const merge = (parts: BufferGeometry[]) => mergeGeometries(parts)!;

/** Glass-grid curtain wall: glass box plus mullions across its front face. */
function curtainWall(solid: BufferGeometry[], glass: BufferGeometry[], x0: number, x1: number, y0: number, y1: number, zf: number, zb: number) {
  glass.push(glassBox(x0, x1, y0, y1, zf, zb));
  const mull = "#d7dde2";
  for (let y = y0; y <= y1 + 0.01; y += 3.6) solid.push(box(x0 - 0.1, x1 + 0.1, y - 0.12, y + 0.12, zf - 0.25, zf + 0.05, mull));
  for (let x = x0; x <= x1 + 0.01; x += 2.8) solid.push(box(x - 0.08, x + 0.08, y0, y1, zf - 0.22, zf + 0.05, mull));
  // Side faces get a few mullions too.
  for (const x of [x0, x1]) for (let z = zf; z <= zb + 0.01; z += 2.8) solid.push(box(x - 0.15, x + 0.15, y0, y1, z - 0.08, z + 0.08, mull));
}

/**
 * The mall's signature canopy: a thin silver slab whose front edge bulges
 * towards the road and whose ends droop like a wing, in alternating panel
 * strips.
 */
function canopy(width: number, zFront: number, zBack: number, bulge: number, top: number, droop: number): BufferGeometry {
  const n = 48;
  const thick = 1.1;
  const pos: number[] = [];
  const col: number[] = [];
  const c1 = new Color("#c4cad0");
  const c2 = new Color("#aab1b8");
  const under = new Color("#8d949b");
  const edge = new Color("#d6dbe0");
  const at = (i: number) => {
    const u = (i / n) * 2 - 1; // -1..1 across
    const x = (u * width) / 2;
    const zf = zFront - bulge * (1 - u * u);
    const y = top - droop * u * u * u * u;
    return { x, zf, y };
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], color: Color) => {
    for (const p of [a, b, c, a, c, d]) {
      pos.push(p[0], p[1], p[2]);
      col.push(color.r, color.g, color.b);
    }
  };
  for (let i = 0; i < n; i++) {
    const p = at(i);
    const q = at(i + 1);
    const c = i % 2 ? c1 : c2;
    // Top (faces up): front-left, back-left, back-right, front-right.
    quad([p.x, p.y, p.zf], [p.x, p.y, zBack], [q.x, q.y, zBack], [q.x, q.y, q.zf], c);
    // Underside (faces down).
    quad([p.x, p.y - thick, p.zf], [q.x, q.y - thick, q.zf], [q.x, q.y - thick, zBack], [p.x, p.y - thick, zBack], under);
    // Front fascia (faces the road).
    quad([p.x, p.y - thick, p.zf], [p.x, p.y, p.zf], [q.x, q.y, q.zf], [q.x, q.y - thick, q.zf], edge);
  }
  // End caps.
  for (const i of [0, n]) {
    const p = at(i);
    const s = i === 0 ? 1 : -1;
    const a = [p.x, p.y - thick, p.zf];
    const b = [p.x, p.y - thick, zBack];
    const c = [p.x, p.y, zBack];
    const d = [p.x, p.y, p.zf];
    if (s > 0) quad(a, b, c, d, edge);
    else quad(a, d, c, b, edge);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */

export function mall(along: number, depth: number, height: number, seed: number): CommercialModel {
  const rng = mulberry32(seed);
  const solid: BufferGeometry[] = [];
  const glass: BufferGeometry[] = [];
  const panels: Panel[] = [];
  const A = along / 2;
  const D = depth / 2;
  const front = -D;
  const z0 = -D + 18; // building front line, behind the forecourt

  // Forecourt: pink-beige paving with darker bands, hedged planters, ad pylons, entrance arch.
  solid.push(box(-A, A, 0, 0.15, front, z0 + 1, "#cdb9a6"));
  for (let z = front + 3; z < z0; z += 4) solid.push(box(-A, A, 0.15, 0.17, z, z + 0.4, "#b9a28e"));
  for (const [x0, x1] of [
    [-A + 2, -8],
    [8, A - 2],
  ]) {
    solid.push(box(x0, x1, 0, 0.7, front + 1, front + 2.6, "#8f8a84"));
    solid.push(box(x0 + 0.2, x1 - 0.2, 0.7, 1.4, front + 1.2, front + 2.4, "#3f7a35"));
  }
  for (const x of [-48, -30, -14, 14, 30, 48]) {
    solid.push(box(x - 0.9, x + 0.9, 0, 7.5, front + 6, front + 7.8, "#e9ebee"));
    solid.push(box(x - 0.95, x + 0.95, 6.9, 7.6, front + 5.95, front + 7.85, "#9aa1a8"));
    solid.push(box(x - 0.7, x + 0.7, 2.2, 6.0, front + 5.9, front + 6.0, "#1e5fbf"));
  }
  // Entrance arch over the walkway.
  for (const s of [-1, 1]) solid.push(box(s * 9 - 0.5, s * 9 + 0.5, 0, 6.2, front + 9, front + 10, "#f2f4f6"));
  solid.push(box(-9.6, 9.6, 5.2, 6.4, front + 9, front + 10, "#1e5fbf"));

  // Main beige block behind, with a taller service tower at one corner.
  const mainH = height - 2;
  solid.push(box(-A + 4, A - 4, 0, mainH, z0 + 10, D - 1, "#d8caa2"));
  solid.push(box(-A + 3.6, A - 3.6, mainH, mainH + 1.2, z0 + 9.6, D - 0.6, "#c9bb93"));
  solid.push(box(-A + 6, -A + 24, 0, height + 4, z0 + 4, z0 + 24, "#9ba8b4"));
  solid.push(box(-A + 5.6, -A + 24.4, height + 4, height + 4.6, z0 + 3.6, z0 + 24.4, "#7d8a96"));

  // Front: two glass blocks either side of a recessed central atrium.
  const gH = height - 10;
  curtainWall(solid, glass, -A + 6, -17, 4.5, gH, z0, z0 + 12);
  curtainWall(solid, glass, 17, A - 6, 4.5, gH, z0, z0 + 12);
  // Ground-floor store fronts under the glass blocks.
  for (const [x0, x1] of [
    [-A + 6, -17],
    [17, A - 6],
  ]) {
    solid.push(box(x0, x1, 0, 4.5, z0, z0 + 12, "#e7e1d4"));
    for (let x = x0 + 1.5; x < x1 - 4; x += 7) solid.push(box(x, x + 5.5, 0.3, 3.8, z0 - 0.06, z0, "#2e3c46"));
    solid.push(box(x0, x1, 3.9, 4.5, z0 - 0.3, z0, "#c7a33a"));
  }
  // Atrium: grey panelled front, balcony band, dark entrance.
  solid.push(box(-17, 17, 0, height - 6, z0 + 3, z0 + 14, "#b7bec5"));
  for (let y = 6; y < height - 6; y += 2.4) solid.push(box(-17, 17, y, y + 0.1, z0 + 2.94, z0 + 3, "#a3aab1"));
  solid.push(box(-17, 17, 14, 15.2, z0 + 1, z0 + 3, "#d9dde1"));
  solid.push(box(-17, 17, 15.2, 16.3, z0 + 1, z0 + 1.2, "#6c757d"));
  solid.push(box(-9, 9, 0, 4.8, z0 + 2.9, z0 + 3, "#1f2429"));

  // Signature canopy on slim cylindrical columns.
  const canopyTop = height - 1;
  const droop = 7;
  const bulge = 7;
  const cz = z0 - 4;
  solid.push(canopy(along - 2, cz, z0 + 14, bulge, canopyTop, droop));
  for (const x of [-13, 13, -(A - 9), A - 9]) {
    const u = (2 * x) / (along - 2);
    const top = canopyTop - droop * u ** 4 - 1.1;
    const zc = cz - bulge * (1 - u * u) + 2.2;
    const c = new CylinderGeometry(0.55, 0.55, top, 16);
    c.translate(x, top / 2, zc);
    solid.push(paint(c, "#cfd5da"));
  }

  // Roof-top solar panels in rows (seen in the satellite view).
  for (let z = z0 + 14; z < D - 5; z += 4.2) {
    for (let x = -A + 8; x < A - 12; x += 18) {
      if (x < -A + 26 && z < z0 + 26) continue; // service tower
      const p = new BoxGeometry(16, 0.12, 2.4);
      p.rotateX(-0.26);
      p.translate(x + 8, mainH + 0.9, z + 1.2);
      solid.push(paint(p, "#1d3a66"));
    }
  }

  // Signs and hoardings (invented ads).
  panels.push({ x: 0, y: 17.6, z: z0 + 0.9, w: 14, h: 3.5, texture: "mall-sign" });
  solid.push(box(-7.4, 7.4, 15.6, 19.6, z0 + 0.95, z0 + 1.6, "#f4f5f6"));
  panels.push({ x: 0, y: 9.6, z: z0 + 2.85, w: 16, h: 8, texture: `hoarding:${Math.floor(rng() * 1000)}` });
  panels.push({ x: -A + 22, y: 13.5, z: z0 - 0.35, w: 12, h: 14, texture: `hoarding:${Math.floor(rng() * 1000)}` });
  panels.push({ x: A - 22, y: 13.5, z: z0 - 0.35, w: 11, h: 14, texture: `hoarding:${Math.floor(rng() * 1000)}` });
  for (const x of [-48, -30, -14, 14, 30, 48]) panels.push({ x, y: 4.1, z: front + 5.85, w: 1.3, h: 3.6, texture: `hoarding:${Math.floor(rng() * 1000)}` });

  return { solid: merge(solid), glass: merge(glass), panels };
}

/* ------------------------------------------------------------------ */

const CAR_COLOURS = ["#f2f2f0", "#c9ccd0", "#8a9096", "#2b2e33", "#7a1f1f", "#1f3c66", "#d9d2c3", "#b03030", "#ffffff"];

/** Angled parking bays in rows across x (one row per z), about six in ten taken by a parked car. */
function parkedCars(solid: BufferGeometry[], rng: () => number, x0: number, x1: number, rows: number[], angle = 0.5) {
  for (const rz of rows) {
    for (let x = x0 + 4; x < x1 - 4; x += 2.9) {
      const line = new BoxGeometry(0.14, 0.03, 5.4);
      line.rotateY(angle);
      line.translate(x, 0.14, rz);
      solid.push(paint(line, "#e2b524"));
      if (rng() < 0.62 && x < x1 - 6) {
        const cx = x + 1.45;
        const colour = pick(rng, CAR_COLOURS);
        const parts = [
          new BoxGeometry(1.75, 0.7, 4.2).translate(0, 0.65, 0),
          new BoxGeometry(1.6, 0.5, 2.3).translate(0, 1.25, -0.2),
          new BoxGeometry(1.62, 0.44, 2.2).translate(0, 1.25, -0.2),
        ];
        const cols = [colour, colour, "#1b1f24"];
        parts.forEach((part, k) => {
          part.rotateY(angle);
          part.translate(cx, 0.12, rz + rr(rng, -0.2, 0.2));
          solid.push(paint(part, cols[k]));
        });
      }
    }
    // Aisle edge line.
    solid.push(box(x0 + 3, x1 - 3, 0.13, 0.15, rz + 3.2, rz + 3.4, "#e2b524"));
  }
}

export function cinema(along: number, depth: number, height: number, seed: number): CommercialModel {
  const rng = mulberry32(seed);
  const solid: BufferGeometry[] = [];
  const panels: Panel[] = [];
  const A = along / 2;
  const D = depth / 2;
  const front = -D;
  const lotBack = D - 36; // car park in front, building behind
  const white = "#eef0ec";

  // Car park: paving, yellow diagonal bays, parked cars, gate, booth, boundary wall.
  solid.push(box(-A, A, 0, 0.12, front, lotBack + 2, "#a19d95"));
  parkedCars(
    solid,
    rng,
    -A,
    A,
    [front + 10, front + 23, front + 36, front + 49].filter((rz) => rz <= lotBack - 3),
  );
  // Boundary wall with the entry on the right.
  const gate0 = A - 16;
  const gate1 = A - 4;
  solid.push(box(-A, gate0, 0, 1.1, front, front + 0.4, "#d9d6cf"));
  solid.push(box(gate1, A, 0, 1.1, front, front + 0.4, "#d9d6cf"));
  for (const s of [-1, 1]) solid.push(box(s * A - (s > 0 ? 0.4 : 0), s * A + (s < 0 ? 0.4 : 0), 0, 1.1, front, lotBack, "#d9d6cf"));
  solid.push(box(gate0 + 0.6, gate0 + 1.0, 0, 1.2, front + 1, front + 1.4, "#c62828"));
  solid.push(box(gate0 + 0.8, gate1 - 1, 1.0, 1.15, front + 1.1, front + 1.25, "#f5f5f5"));
  solid.push(box(gate1 - 3, gate1 - 0.5, 0, 2.6, front + 2, front + 4.2, "#f2f2ee"));
  solid.push(box(gate1 - 3.2, gate1 - 0.3, 2.6, 2.9, front + 1.8, front + 4.4, "#1e5fbf"));

  // Building: white front block with a raised centre and classical cornice.
  const zf = lotBack;
  solid.push(box(-A + 8, A - 10, 0, 17, zf + 1.5, D - 1, white));
  solid.push(box(-14, 13, 17, height - 3, zf + 1.5, D - 6, white));
  solid.push(box(-14.6, 13.6, height - 3, height - 2.4, zf + 0.9, D - 5.4, "#f6f6f3"));
  solid.push(box(-12, 11, height - 2.4, height - 1.2, zf + 1.4, D - 7, "#f6f6f3"));
  solid.push(box(-A + 7.6, A - 9.6, 16.6, 17.2, zf + 1.0, D - 0.5, "#f6f6f3"));
  // (billboard face sits just in front of the cornice band)
  // Pilasters across the front.
  // Pilasters frame the poster row only, leaving the name sign and billboard clear.
  for (let x = -A + 9; x < A - 10; x += 6.2) solid.push(box(x, x + 0.7, 5.2, 12.4, zf + 1.1, zf + 1.5, "#e2e4df"));
  // Ground floor: dark entrance band under a canopy, with doors.
  solid.push(box(-A + 8, A - 10, 0, 4.6, zf + 1.4, zf + 1.6, "#26211e"));
  solid.push(box(-A + 7.5, A - 9.5, 4.6, 5.2, zf - 2.2, zf + 1.6, "#f4f4f1"));
  for (let x = -A + 11; x < A - 12; x += 5) solid.push(box(x, x + 3, 0.2, 3.4, zf + 1.3, zf + 1.4, "#5b4a3b"));
  // Left tower with vertical fins.
  solid.push(box(-A, -A + 8, 0, height + 1, zf + 1.5, zf + 16, "#5b6168"));
  for (let x = -A + 0.4; x < -A + 8; x += 0.9) solid.push(box(x, x + 0.45, 3, height + 1, zf + 1.1, zf + 1.6, white));
  solid.push(box(-A - 0.3, -A + 8.3, height + 1, height + 1.6, zf + 0.8, zf + 16.3, "#f6f6f3"));
  // Lower right wing with window bands.
  solid.push(box(A - 10, A, 0, 13, zf + 2.5, D - 1, white));
  for (let y = 3; y < 12; y += 3.2) solid.push(box(A - 9.5, A - 0.5, y, y + 1.4, zf + 2.4, zf + 2.5, "#3c4a57"));
  // Gold emblem between the Tamil and English names.
  const emblem = new CylinderGeometry(0.9, 0.9, 0.2, 20);
  emblem.rotateX(Math.PI / 2);
  emblem.translate(-0.5, 14.1, zf + 1.25);
  solid.push(paint(emblem, "#d4a63a"));

  // Panels: top billboard, name sign, poster row (invented films).
  // Top billboard sits on the raised centre, between the cornice band (17.2 m) and the parapet.
  panels.push({ x: -0.5, y: (17.4 + height - 3) / 2, z: zf + 1.38, w: 18, h: height - 3 - 17.6, texture: `poster-wide:${Math.floor(rng() * 1000)}` });
  panels.push({ x: -0.5, y: 14.1, z: zf + 1.4, w: 21, h: 2.4, texture: "kamala-sign" });
  for (let i = 0; i < 5; i++) {
    const x = -A + 12 + i * 7.4;
    if (x > A - 14) break;
    panels.push({ x, y: 9.0, z: zf + 1.0, w: 6.2, h: 6.4, texture: `poster:${Math.floor(rng() * 1000)}` });
  }
  return { solid: merge(solid), panels };
}


/* ------------------------------------------------------------------ */

/**
 * Chandra Metro Mall (Arcot Road, Virugambakkam), after two street photos:
 * a blue glass front whose top edge sweeps up to the left like a sail, a
 * dark left edge with porthole windows and white sun fins, a big gold band
 * carrying three billboards, a white drum on the right topped by a flared,
 * ribbed crown, the mall's name sign beside the drum, and at street level a
 * row of hoardings over dark shopfronts behind black granite pillars.
 * Behind the facade (after a satellite view) a deep hall with a flat white
 * roof runs back from the road, with an open car park beside it.
 *
 * The facade is laid out in a 52 m wide design frame and squeezed to `along`;
 * +x in the design frame ends up on the viewer's right (the drum end).
 */
export function glassMall(along: number, depth: number, height: number, seed: number): CommercialModel {
  const rng = mulberry32(seed);
  const solid: BufferGeometry[] = [];
  const glass: BufferGeometry[] = [];
  const panels: Panel[] = [];
  const A = 26; // design half-width; scaled to along / 2 at the end
  const D = depth / 2;
  const front = -D;
  const z0 = -D + 8; // building front, behind the forecourt
  const zb = z0 + 30; // back of the facade block; the hall runs on from here
  const gold = "#e2b32c";
  const white = "#e9edf0";
  const steel = "#b9c0c7";

  // Forecourt: paving, black granite pillars with railings along the street, steps up to the entrance.
  solid.push(box(-A, A, 0, 0.15, front, z0 + 1, "#b8b2a8"));
  for (let x = -A + 1; x <= A - 1; x += 6) {
    solid.push(box(x - 0.6, x + 0.6, 0, 3.4, front + 0.3, front + 1.5, "#1f2124"));
    if (x + 6 <= A - 1) for (const y of [0.9, 1.5]) solid.push(box(x + 0.6, x + 5.4, y - 0.05, y + 0.05, front + 0.85, front + 0.95, steel));
  }
  for (let i = 0; i < 4; i++) solid.push(box(2, 12, 0, 0.18 * (i + 1), z0 - 4 + i * 0.9, z0, "#8c8780"));

  // Ground floor: dark shopfronts, then the hoarding row above them (invented ads and films).
  solid.push(box(-A + 1, A - 1, 0, 5.4, z0, z0 + 6, "#2b2d31"));
  for (let x = -A + 3; x < A - 5; x += 7.5) solid.push(box(x, x + 5, 0.3, 4, z0 - 0.06, z0, "#4a5560"));
  solid.push(box(-A + 1, A - 1, 5.4, 11.4, z0 - 0.6, z0, "#3a3d42"));
  panels.push({ x: -13.5, y: 8.4, z: z0 - 0.65, w: 20, h: 5.6, texture: `hoarding:${Math.floor(rng() * 1000)}` });
  panels.push({ x: 3, y: 8.4, z: z0 - 0.65, w: 11.5, h: 5.6, texture: `poster-wide:${Math.floor(rng() * 1000)}` });
  panels.push({ x: 16, y: 8.4, z: z0 - 0.65, w: 13.5, h: 5.6, texture: `poster-wide:${Math.floor(rng() * 1000)}` });

  // Blue glass front: its top edge sweeps up to the left, down towards the drum.
  const gx0 = -A + 3;
  const gx1 = 10;
  const top = (x: number) => height - 6 + 6 * ((gx1 - x) / (gx1 - gx0)) ** 2;
  solid.push(box(gx0, gx1, 0, height - 7, z0 + 3, zb, "#c9cdd2"));
  for (let x = gx0; x < gx1 - 0.01; x += 2.8) {
    const x1 = Math.min(gx1, x + 2.8);
    const t = top((x + x1) / 2);
    glass.push(glassBox(x, x1, 11.4, t, z0 + 0.4, z0 + 3));
    solid.push(box(x - 0.07, x + 0.07, 11.4, t, z0 + 0.2, z0 + 0.45, "#cfd6dc"));
    for (let y = 11.4 + 3.6; y < t; y += 3.6) solid.push(box(x, x1, y - 0.07, y + 0.07, z0 + 0.2, z0 + 0.45, "#cfd6dc"));
    // Coping along the swept top edge.
    solid.push(box(x, x1, t, t + 0.4, z0 + 0.2, z0 + 3.2, "#d9dee2"));
  }

  // Dark left edge with portholes, white sun fins across the glass, and the big round window.
  solid.push(box(-A + 0.8, gx0 + 0.4, 5.4, height + 0.4, z0 - 0.5, z0 + 9, "#2b3440"));
  for (let y = 13; y < height - 1; y += 3.2) {
    const disc = new CylinderGeometry(0.55, 0.55, 0.2, 18);
    disc.rotateX(Math.PI / 2);
    disc.translate(-A + 2.1, y, z0 - 0.55);
    solid.push(paint(disc, "#dfe7ee"));
  }
  for (let y = 12; y < height - 2; y += 3.6) solid.push(box(gx0, -6, y - 0.12, y + 0.12, z0 - 1.2, z0 + 0.5, white));
  for (const [r, c, dz] of [
    [1.9, "#59636e", 0.2],
    [1.5, "#2a3038", 0.3],
  ] as const) {
    const port = new CylinderGeometry(r, r, 0.3, 28);
    port.rotateX(Math.PI / 2);
    port.translate(-15, height - 2.5, z0 + 0.4 - dz);
    solid.push(paint(port, c));
  }

  // Gold band with a tile grid, a wing out to the left, and three billboards.
  const b0 = 12.5;
  const b1 = 23;
  solid.push(box(-17, 22, b0, b1, z0 - 1.8, z0 - 0.4, gold));
  for (let x = -17; x <= 22; x += 1.5) solid.push(box(x - 0.03, x + 0.03, b0, b1, z0 - 1.84, z0 - 1.8, "#c99a1f"));
  for (let y = b0; y <= b1; y += 1.5) solid.push(box(-17, 22, y - 0.03, y + 0.03, z0 - 1.84, z0 - 1.8, "#c99a1f"));
  solid.push(box(-A - 2, -17, b1 - 2.2, b1 - 0.8, z0 - 1.6, z0 + 4, gold));
  solid.push(box(22, A + 1, b1 - 2.2, b1 - 0.8, z0 - 1.6, z0 + 4, gold));
  const by = (b0 + b1) / 2;
  panels.push({ x: -9.5, y: by, z: z0 - 1.86, w: 10.5, h: 8.4, texture: `hoarding:${Math.floor(rng() * 1000)}` });
  panels.push({ x: 2, y: by, z: z0 - 1.86, w: 8, h: 8.4, texture: `poster:${Math.floor(rng() * 1000)}` });
  panels.push({ x: 13.5, y: by, z: z0 - 1.86, w: 10, h: 8.4, texture: `hoarding:${Math.floor(rng() * 1000)}` });

  // White drum with horizontal bands, crowned by a flared, ribbed bowl.
  const dx = 15;
  const dz = z0 + 6;
  const R = 7.5;
  const drumTop = height - 3;
  const drum = new CylinderGeometry(R, R, drumTop, 48);
  drum.translate(dx, drumTop / 2, dz);
  solid.push(paint(drum, "#dfe3e6"));
  for (let y = 3.6; y < drumTop; y += 3.6) {
    const ring = new CylinderGeometry(R + 0.15, R + 0.15, 0.35, 48, 1, true);
    ring.translate(dx, y, dz);
    solid.push(paint(ring, "#b9c0c6"));
  }
  const bowlH = 5;
  const rTop = 10.2;
  const outer = new CylinderGeometry(rTop, R + 0.1, bowlH, 48, 1, true);
  outer.translate(dx, drumTop + bowlH / 2, dz);
  solid.push(paint(outer, "#e9ecef"));
  // Inside of the bowl (same cone, turned inside out).
  const inner = new CylinderGeometry(rTop - 0.15, R - 0.05, bowlH, 48, 1, true);
  inner.scale(-1, 1, 1);
  inner.translate(dx, drumTop + bowlH / 2, dz);
  solid.push(paint(inner, "#cfd5da"));
  const lip = new CylinderGeometry(rTop + 0.25, rTop + 0.25, 0.5, 48, 1, true);
  lip.translate(dx, drumTop + bowlH, dz);
  solid.push(paint(lip, "#f4f6f8"));
  const ribLen = Math.hypot(rTop - R, bowlH);
  const tilt = Math.atan2(rTop - R, bowlH);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const rib = new BoxGeometry(0.3, ribLen, 0.35);
    rib.translate(0, ribLen / 2, 0);
    rib.rotateZ(-tilt);
    rib.translate(R + 0.12, 0, 0);
    rib.rotateY(a);
    rib.translate(dx, drumTop, dz);
    solid.push(paint(rib, "#c3c9cf"));
  }
  const roof = new CylinderGeometry(R, R, 0.3, 48);
  roof.translate(dx, drumTop + 0.2, dz);
  solid.push(paint(roof, "#8c949c"));

  // Name sign on a dark plate beside the drum.
  solid.push(box(8.6, 23.4, height - 8.2, height - 3.8, z0 - 2.3, z0 - 1.5, "#2f3438"));
  panels.push({ x: 16, y: height - 6, z: z0 - 2.35, w: 14.2, h: 3.9, texture: "chandra-sign" });

  // Right wing: grey block with blue window strips and white fins.
  solid.push(box(19, A - 0.5, 0, height - 7, z0 + 2, zb, "#d4d8dc"));
  for (let y = 12; y < height - 9; y += 3.6) {
    glass.push(glassBox(20.5, A - 1.5, y, y + 2.2, z0 + 1.8, z0 + 2.1));
    solid.push(box(19.5, A - 0.5, y + 2.4, y + 2.65, z0 + 0.6, z0 + 2.1, white));
  }

  // Roof plant behind the glass front.
  solid.push(box(-14, -2, height - 7, height - 4.5, z0 + 12, zb - 3, "#9aa1a8"));

  // The hall behind (the white roof in the satellite view), narrower than the
  // facade so the car park fits beside it on the drum (+x) side.
  const hallH = 16;
  const hx0 = -A + 1;
  const hx1 = A - 18;
  solid.push(box(hx0, hx1, 0, hallH, zb, D - 2, "#cfd3d6"));
  solid.push(box(hx0 - 0.3, hx1 + 0.3, hallH, hallH + 0.5, zb - 0.3, D - 1.7, "#e9e9e4"));
  for (const x of [hx0 + 9, hx1 - 9]) solid.push(box(x - 1.6, x + 1.6, hallH + 0.5, hallH + 1.3, zb + 6, D - 8, "#a9c1d3"));
  for (let z = zb + 8; z < D - 10; z += 14) solid.push(box(-3, 2, hallH + 0.5, hallH + 2.2, z, z + 3.5, "#9aa1a8"));
  for (let y = 9; y <= 12; y += 3) {
    solid.push(box(hx0 - 0.05, hx1 + 0.05, y, y + 1.2, zb + 4, D - 6, "#4a5866"));
  }
  // Loading bay with shutters at the back.
  solid.push(box(hx0 + 4, hx0 + 22, 0, 5, D - 2.05, D - 1.95, "#7d848b"));
  for (let x = hx0 + 5; x < hx0 + 21; x += 5.5) solid.push(box(x, x + 4.5, 0.2, 4.4, D - 1.98, D - 1.9, "#b2b8be"));

  // Open car park beside the hall, with a low wall and a gate to the side lane.
  solid.push(box(hx1 + 1, A, 0, 0.12, zb, D - 1, "#a19d95"));
  parkedCars(solid, rng, hx1 + 1, A, [zb + 6, zb + 19, zb + 32, zb + 45, zb + 58].filter((rz) => rz < D - 6));
  solid.push(box(A - 0.4, A, 0, 1.1, zb, D - 1, "#d9d6cf"));
  solid.push(box(hx1 + 1, A, 0, 1.1, D - 1.4, D - 1, "#d9d6cf"));

  // Squeeze the 52 m design frame to the real frontage. Built with the drum at +x;
  // seen from the street (looking +z) +x is on the viewer's left, so also mirror it
  // to match the photos (portholes left, drum right).
  const k = along / (2 * A);
  for (const p of panels) {
    p.x = -p.x * k;
    p.w *= k;
  }
  const squeeze = (g: BufferGeometry) => {
    g.scale(k, 1, 1);
    return mirrorX(g);
  };
  return { solid: squeeze(merge(solid)), glass: squeeze(merge(glass)), panels };
}

/** Mirror a non-indexed geometry in x, keeping its faces pointing outward. */
function mirrorX(g: BufferGeometry): BufferGeometry {
  g.scale(-1, 1, 1);
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name);
    for (let i = 0; i + 2 < a.count; i += 3) {
      for (let k = 0; k < a.itemSize; k++) {
        const t = a.getComponent(i + 1, k);
        a.setComponent(i + 1, k, a.getComponent(i + 2, k));
        a.setComponent(i + 2, k, t);
      }
    }
  }
  g.computeBoundingSphere();
  return g;
}
