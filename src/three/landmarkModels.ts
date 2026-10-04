import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { LandmarkModelType } from "../simulation/types.ts";
import { mulberry32, pick, range as rr } from "../utils/random.ts";
import { cinema, mall, type Panel } from "./commercialModels.ts";

/**
 * Stylised models of real landmarks, built from simple shapes with vertex
 * colours (one material, one draw call each). Local frame: +x along the
 * road, +y up, origin at the footprint centre, and the front faces -z —
 * the placement turns it towards the road.
 */

export interface LandmarkModel {
  /** Everything opaque, vertex-coloured. */
  solid: BufferGeometry;
  /** Optional water surface (lakes). */
  water?: { geometry: BufferGeometry };
  /** Where the name board goes (centre, size), facing -z; none when the model carries its own signs. */
  board: { x: number; y: number; z: number; w: number; h: number } | null;
  /** Curtain-wall glass, drawn with a glass material that lights up at night. */
  glass?: BufferGeometry;
  /** Textured signs, hoardings and posters. */
  panels?: Panel[];
}

const tmpColor = new Color();

function paint(g: BufferGeometry, hex: string): BufferGeometry {
  const n = g.toNonIndexed();
  n.deleteAttribute("uv");
  // Color.set() already converts sRGB hex into the linear working space.
  tmpColor.set(hex);
  const count = n.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) tmpColor.toArray(arr, i * 3);
  n.setAttribute("color", new BufferAttribute(arr, 3));
  return n;
}

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hex: string) {
  const g = new BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return paint(g, hex);
}

const merge = (parts: BufferGeometry[]) => mergeGeometries(parts)!;

/** Board on two posts in front of a landmark. */
function boardOnPosts(parts: BufferGeometry[], x: number, z: number, w: number, h: number, y: number, post = "#5a5f66") {
  for (const s of [-1, 1]) parts.push(box(x + s * (w / 2 - 0.4) - 0.12, x + s * (w / 2 - 0.4) + 0.12, 0, y + h / 2, z + 0.05, z + 0.3, post));
  parts.push(box(x - w / 2 - 0.1, x + w / 2 + 0.1, y - h / 2 - 0.1, y + h / 2 + 0.1, z + 0.06, z + 0.2, "#2a2d31"));
  return { x, y, z, w, h };
}

/* ------------------------------------------------------------------ */

const TIER_COLOURS = ["#e4572e", "#f3a712", "#2e86ab", "#a23b72", "#3bb273", "#efd36a", "#d94f70"];

function temple(along: number, depth: number, height: number, seed: number): LandmarkModel {
  const rng = mulberry32(seed);
  const parts: BufferGeometry[] = [];
  const A = along / 2;
  const D = depth / 2;
  // Stone-paved courtyard.
  parts.push(box(-A, A, 0, 0.12, -D, D, "#cbbfa8"));

  // Compound wall with the classic red-ochre and white vertical stripes.
  const wallH = 4.6;
  const stripe = 1.6;
  const wall = (x0: number, x1: number, z0: number, z1: number) => {
    const len = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
    const n = Math.max(1, Math.round(len / stripe));
    for (let i = 0; i < n; i++) {
      const c = i % 2 ? "#f2ead8" : "#b5452b";
      if (Math.abs(x1 - x0) > Math.abs(z1 - z0)) {
        const a = x0 + ((x1 - x0) * i) / n;
        const b = x0 + ((x1 - x0) * (i + 1)) / n;
        parts.push(box(a, b, 0, wallH, z0, z1, c));
      } else {
        const a = z0 + ((z1 - z0) * i) / n;
        const b = z0 + ((z1 - z0) * (i + 1)) / n;
        parts.push(box(x0, x1, 0, wallH, a, b, c));
      }
    }
  };
  const t = 1.1;
  const gw = Math.min(along * 0.42, 26);
  wall(-A, -gw / 2, -D, -D + t);
  wall(gw / 2, A, -D, -D + t);
  wall(-A, A, D - t, D);
  wall(-A, -A + t, -D, D);
  wall(A - t, A, -D, D);

  // Gopuram over the front gate: granite base, then tapering painted tiers.
  const bd = gw * 0.55;
  const z0 = -D + t / 2;
  const baseH = Math.max(7, height * 0.2);
  parts.push(box(-gw / 2, gw / 2, 0, baseH * 0.5, z0 - bd / 2, z0 + bd / 2, "#9a8f80"));
  parts.push(box(-gw / 2 - 0.3, gw / 2 + 0.3, baseH * 0.5, baseH * 0.5 + 0.6, z0 - bd / 2 - 0.3, z0 + bd / 2 + 0.3, "#7f766a"));
  parts.push(box(-gw / 2, gw / 2, baseH * 0.5 + 0.6, baseH, z0 - bd / 2, z0 + bd / 2, "#a89c8b"));
  // Gateway opening.
  parts.push(box(-2.2, 2.2, 0, baseH * 0.62, z0 - bd / 2 - 0.05, z0 + bd / 2 + 0.05, "#2b2118"));
  const vaultR = bd * 0.22;
  const tiersH = height - baseH - vaultR * 1.6;
  const n = Math.max(5, Math.min(11, Math.round(tiersH / 3.4)));
  const th = tiersH / n;
  let y = baseH;
  for (let i = 0; i < n; i++) {
    const k = 1 - (0.58 * i) / n;
    const w = gw * k;
    const d = bd * (1 - (0.45 * i) / n);
    const col = TIER_COLOURS[(i + Math.floor(seed)) % TIER_COLOURS.length];
    parts.push(box(-w / 2, w / 2, y, y + th - 0.4, z0 - d / 2, z0 + d / 2, col));
    parts.push(box(-w / 2 - 0.35, w / 2 + 0.35, y + th - 0.4, y + th, z0 - d / 2 - 0.35, z0 + d / 2 + 0.35, "#efe4c8"));
    // Sculpted figures in niches along the front.
    const figures = Math.max(3, Math.floor(w / 3.2));
    for (let f = 0; f < figures; f++) {
      const fx = -w / 2 + ((f + 0.5) * w) / figures;
      parts.push(box(fx - 0.45, fx + 0.45, y + 0.5, y + th - 1.0, z0 - d / 2 - 0.35, z0 - d / 2, pick(rng, TIER_COLOURS)));
    }
    y += th;
  }
  // Barrel-vaulted crown (shala) with a row of gold kalasams.
  const topW = gw * 0.42;
  // A cylinder half-sunk into the top tier reads as the barrel vault.
  const vault = new CylinderGeometry(vaultR, vaultR, topW, 16);
  vault.rotateZ(Math.PI / 2);
  vault.translate(0, y, z0);
  parts.push(paint(vault, "#d9a441"));
  const kal = Math.max(5, Math.min(11, Math.round(topW / 1.6)));
  for (let i = 0; i < kal; i++) {
    const kx = -topW / 2 + ((i + 0.5) * topW) / kal;
    const pot = new SphereGeometry(0.42, 8, 6);
    pot.translate(kx, y + vaultR + 0.35, z0);
    parts.push(paint(pot, "#f2c14e"));
    const tip = new ConeGeometry(0.18, 0.9, 6);
    tip.translate(kx, y + vaultR + 1.15, z0);
    parts.push(paint(tip, "#f2c14e"));
  }

  // Shrine (vimanam) and pillared hall behind the gopuram.
  const sz = Math.min(along, depth) * 0.2;
  const sv = D * 0.25;
  parts.push(box(-sz / 2, sz / 2, 0, 6, sv - sz / 2, sv + sz / 2, "#d9cdb5"));
  let vy = 6;
  for (let i = 0; i < 3; i++) {
    const w = sz * (0.85 - i * 0.2);
    parts.push(box(-w / 2, w / 2, vy, vy + 2.2, sv - w / 2, sv + w / 2, TIER_COLOURS[(i + 2) % TIER_COLOURS.length]));
    vy += 2.2;
  }
  const dome = new SphereGeometry(sz * 0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(0, vy, sv);
  parts.push(paint(dome, "#e0b04a"));
  parts.push(box(-sz * 0.9, sz * 0.9, 0, 5.5, sv - sz * 1.5, sv - sz * 0.5, "#efe4c8"));
  parts.push(box(-sz * 0.95, sz * 0.95, 5.5, 6.0, sv - sz * 1.55, sv - sz * 0.45, "#b5452b"));
  // Gold flagstaff (dhwajasthambam).
  const flag = new CylinderGeometry(0.22, 0.32, 11, 8);
  flag.translate(0, 5.5, sv - sz * 2.2);
  parts.push(paint(flag, "#e8b84a"));

  const board = boardOnPosts(parts, gw / 2 + 7, -D - 2.5, 10, 2.5, 3.4);
  return { solid: merge(parts), board };
}

/* ------------------------------------------------------------------ */

function lakeOutline(rx: number, rz: number, seed: number, points = 48): Shape {
  const rng = mulberry32(seed);
  const wobble = Array.from({ length: 5 }, () => [rr(rng, 0.03, 0.09), rr(rng, 0, Math.PI * 2)] as const);
  const shape = new Shape();
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    const k = 1 + wobble.reduce((s, [amp, ph], j) => s + amp * Math.sin(a * (j + 2) + ph), 0);
    const x = Math.cos(a) * rx * k;
    const y = Math.sin(a) * rz * k;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

function lake(along: number, depth: number, seed: number): LandmarkModel {
  const rng = mulberry32(seed);
  const parts: BufferGeometry[] = [];
  const rx = along / 2;
  const rz = depth / 2;
  // Earth bund around the water (shape with the lake as a hole), then the water.
  const outer = lakeOutline(rx * 0.97, rz * 0.95, seed);
  const inner = lakeOutline(rx * 0.86, rz * 0.82, seed);
  outer.holes.push(inner);
  const bund = new ShapeGeometry(outer, 2);
  bund.rotateX(-Math.PI / 2);
  bund.translate(0, 0.1, 0);
  parts.push(paint(bund, "#9b8466"));
  const water = new ShapeGeometry(inner, 2);
  water.rotateX(-Math.PI / 2);
  water.translate(0, 0.14, 0);
  // Trees ringing the shore.
  for (let i = 0; i < 70; i++) {
    const a = rng() * Math.PI * 2;
    const r = rr(rng, 0.88, 0.95);
    const x = Math.cos(a) * rx * r;
    const z = Math.sin(a) * rz * r;
    if (z < -rz * 0.7 && Math.abs(x) < 14) continue; // keep the view from the road open by the board
    const h = rr(rng, 3, 5.5);
    parts.push(box(x - 0.25, x + 0.25, 0, h, z - 0.25, z + 0.25, "#6f5e4b"));
    const crown = new IcosahedronGeometry(rr(rng, 2.2, 3.8), 0);
    crown.scale(1, 0.75, 1);
    crown.translate(x, h + 1.5, z);
    parts.push(paint(crown, pick(rng, ["#4f7a3e", "#5a8444", "#456f38", "#68904a"])));
  }
  const board = boardOnPosts(parts, 0, -rz * 0.96 - 2, 9, 2.25, 2.6, "#3d4a3a");
  return { solid: merge(parts), water: { geometry: water }, board };
}

/* ------------------------------------------------------------------ */

function hospital(along: number, depth: number, height: number): LandmarkModel {
  const parts: BufferGeometry[] = [];
  const A = along / 2;
  const D = depth / 2;
  parts.push(box(-A, A, 0, 0.1, -D, D, "#c9c4b8"));
  // Main block set back behind a forecourt, ribbon windows on every floor.
  const bw = along * 0.8;
  const bz0 = -D + depth * 0.3;
  const floors = Math.max(3, Math.floor(height / 3.4));
  const h = floors * 3.4;
  parts.push(box(-bw / 2, bw / 2, 0, h, bz0, D - 2, "#f4f4f0"));
  parts.push(box(-bw / 2 - 0.2, bw / 2 + 0.2, h, h + 1, bz0 - 0.2, D - 1.8, "#e2e0d8"));
  for (let f = 0; f < floors; f++) {
    const y = f * 3.4 + 1.1;
    parts.push(box(-bw / 2 + 1, bw / 2 - 1, y, y + 1.5, bz0 - 0.1, bz0, "#4a6f8f"));
  }
  // Entrance porch.
  parts.push(box(-6, 6, 4.2, 4.6, bz0 - 7, bz0, "#e2e0d8"));
  for (const s of [-1, 1]) parts.push(box(s * 5.5 - 0.25, s * 5.5 + 0.25, 0, 4.2, bz0 - 6.8, bz0 - 6.3, "#c9c4b8"));
  // Red-cross sign on the roof.
  parts.push(box(-2.8, 2.8, h + 1, h + 6.6, bz0 + 0.1, bz0 + 0.5, "#ffffff"));
  parts.push(box(-0.7, 0.7, h + 1.6, h + 6, bz0 - 0.05, bz0 + 0.1, "#d62828"));
  parts.push(box(-2.2, 2.2, h + 3.1, h + 4.5, bz0 - 0.05, bz0 + 0.1, "#d62828"));
  // Low boundary wall with a gate.
  parts.push(box(-A, -7, 0, 1.5, -D, -D + 0.4, "#d8d4c8"));
  parts.push(box(7, A, 0, 1.5, -D, -D + 0.4, "#d8d4c8"));
  const board = { x: 0, y: h * 0.5 + 1.6, z: bz0 - 0.25, w: Math.min(bw * 0.7, 18), h: Math.min(bw * 0.7, 18) / 4 };
  return { solid: merge(parts), board };
}

/* ------------------------------------------------------------------ */

const BUS_COLOURS = ["#2f6fa8", "#b9373a", "#3a7d4d", "#d8d3c8", "#2f6fa8"];

function bus(parts: BufferGeometry[], x: number, z: number, hex: string) {
  parts.push(box(x - 5.6, x + 5.6, 0.45, 3.1, z - 1.27, z + 1.27, hex));
  parts.push(box(x - 5.3, x + 5.62, 1.75, 2.75, z - 1.29, z + 1.29, "#1b1f24"));
  parts.push(box(x - 4.6, x + 4.6, 0, 0.45, z - 1.1, z + 1.1, "#14171b"));
}

function busStand(along: number, depth: number, seed: number): LandmarkModel {
  const rng = mulberry32(seed);
  const parts: BufferGeometry[] = [];
  const A = along / 2;
  const D = depth / 2;
  parts.push(box(-A, A, 0, 0.1, -D, D, "#b9b4aa"));
  // Platforms with long canopies, buses in the bays between them.
  const rows = Math.max(2, Math.floor((depth - 12) / 16));
  const pitch = (depth - 12) / rows;
  const pw = along * 0.8;
  for (let i = 0; i < rows; i++) {
    const z = -D + 10 + i * pitch + pitch * 0.25;
    parts.push(box(-pw / 2, pw / 2, 0.1, 0.35, z - 1.6, z + 1.6, "#d8d3c8"));
    for (let x = -pw / 2 + 2; x <= pw / 2 - 2; x += 9) parts.push(box(x - 0.15, x + 0.15, 0.35, 4.4, z - 0.15, z + 0.15, "#7d848c"));
    parts.push(box(-pw / 2 - 1, pw / 2 + 1, 4.4, 4.75, z - 3.2, z + 3.2, i % 2 ? "#2f8f6b" : "#2f6fa8"));
    const bz = z + pitch * 0.5;
    for (let x = -pw / 2 + 7; x < pw / 2 - 6; x += rr(rng, 13, 18)) if (rng() < 0.75) bus(parts, x, bz, pick(rng, BUS_COLOURS));
  }
  // Small office at the back.
  parts.push(box(A - 22, A - 4, 0, 7, D - 14, D - 3, "#efe7d6"));
  parts.push(box(A - 21, A - 5, 2, 3.4, D - 14.1, D - 13.9, "#3c4a57"));
  parts.push(box(A - 21, A - 5, 5, 6.2, D - 14.1, D - 13.9, "#3c4a57"));
  // Entrance arch carrying the name board.
  const gx = -A + 18;
  for (const s of [-1, 1]) parts.push(box(gx + s * 7.5 - 0.5, gx + s * 7.5 + 0.5, 0, 6.8, -D - 0.5, -D + 0.5, "#d8d3c8"));
  parts.push(box(gx - 8, gx + 8, 5.8, 7.4, -D - 0.4, -D + 0.4, "#13579b"));
  const board = { x: gx, y: 4.6, z: -D - 0.55, w: 13, h: 2.1 };
  return { solid: merge(parts), board };
}

/* ------------------------------------------------------------------ */

function depot(along: number, depth: number): LandmarkModel {
  const parts: BufferGeometry[] = [];
  const A = along / 2;
  const D = depth / 2;
  parts.push(box(-A, A, 0, 0.1, -D, D, "#a9a49a"));
  // Maintenance shed with a gabled roof at the back.
  const sw = along * 0.62;
  const sz0 = D - depth * 0.45;
  const sh = 9;
  parts.push(box(-sw / 2, sw / 2, 0, sh, sz0, D - 3, "#d5d8dc"));
  const span = D - 3 - sz0;
  for (const s of [-1, 1]) {
    const roof = new BoxGeometry(sw + 1, 0.35, span / 2 / Math.cos(0.32) + 0.6);
    roof.rotateX(-s * 0.32);
    roof.translate(0, sh + Math.tan(0.32) * (span / 4) + 0.1, sz0 + span / 2 + (s * span) / 4);
    parts.push(paint(roof, "#5d6d7e"));
  }
  // Stabling yard: tracks in front of the shed, with parked three-car trains.
  const tracks = Math.max(4, Math.floor((sz0 + D - 10) / 5.2));
  for (let i = 0; i < tracks; i++) {
    const z = -D + 8 + i * 5.2;
    for (const r of [-0.72, 0.72]) parts.push(box(-A + 6, A - 6, 0.1, 0.28, z + r - 0.04, z + r + 0.04, "#4a4d52"));
    if (i % 2 === 0) {
      const x0 = -A + 20 + (i % 4) * 10;
      parts.push(box(x0, x0 + 67.8, 0.9, 4.1, z - 1.45, z + 1.45, "#e7ebef"));
      parts.push(box(x0 + 0.5, x0 + 67.3, 1.9, 2.9, z - 1.47, z + 1.47, "#20262d"));
      parts.push(box(x0, x0 + 67.8, 1.2, 1.45, z - 1.48, z + 1.48, "#f3c623"));
    }
  }
  const board = boardOnPosts(parts, -A + 16, -D - 2.5, 11, 2.75, 3.5);
  return { solid: merge(parts), board };
}

export function buildLandmarkModel(type: LandmarkModelType, along: number, depth: number, height: number | undefined, seed: number): LandmarkModel {
  switch (type) {
    case "temple":
      return temple(along, depth, height ?? 24, seed);
    case "lake":
      return lake(along, depth, seed);
    case "hospital":
      return hospital(along, depth, height ?? 17);
    case "bus-stand":
      return busStand(along, depth, seed);
    case "mall":
      return { ...mall(along, depth, height ?? 32, seed), board: null };
    case "cinema":
      return { ...cinema(along, depth, height ?? 24, seed), board: null };
    case "depot":
    default:
      return depot(along, depth);
  }
}
