"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cabinLayout, type CabinLayout, type CarKind } from "./trainModel.ts";
import { TRAIN } from "./layout.ts";
import { ensureFontsLoaded, fontFamilies } from "./textures.ts";
import { crowdFactor, localHour } from "../simulation/crowd.ts";
import { useViewStore } from "../simulation/store.ts";
import { mulberry32, pick, range as rr, type Rng } from "../utils/random.ts";

/**
 * Passengers inside the cars, seated on the benches and standing by the
 * doors and under the grab rails, in car-local space (the component is
 * mounted inside each car's group, so it rides along for free). How many
 * depends on the crowd level. Each car's people are one merged,
 * vertex-coloured mesh, rebuilt only when the crowd changes.
 *
 * The leading car in the direction of travel is the women's coach: its
 * passengers are women and it carries "Women only" decals.
 */

/** Middle-car spots the Passenger camera uses: keep them free of people (car-local). */
export const PASSENGER_CAMERA_CAR = 1;
const CLEAR_SPOTS = [
  { x: -1.6, z: 0.78, r: 1.2 }, // window seat
  { x: -2.85, z: -1.0, r: 1.2 }, // standing at the left (platform-side) door
  { x: -10.1, z: 0, r: 1.2 }, // car end, looking down the car
];
/** Keep the centre aisle open in front of the car-end spot. */
const CLEAR_AISLE = { x0: -10.1, x1: -6.1, halfZ: 0.45 };
/** From the window seat you look across the car: no one stands in that band (people opposite still sit). */
const WINDOW_SIGHTLINE = { x: -1.6, halfX: 1.4 };

const CLOTHES = ["#c0392b", "#2e86c1", "#f1c40f", "#27ae60", "#8e44ad", "#ecf0f1", "#e67e22", "#1abc9c", "#34495e", "#f5f5f5", "#1f3c66"];
const SAREES = ["#c2185b", "#e65100", "#00897b", "#fdd835", "#6a1b9a", "#ad1457", "#2e7d32", "#d84315", "#f06292"];
const TROUSERS = ["#2b2e33", "#3b4a5c", "#4a4036", "#1f2a36"];
const SKIN = ["#8d5524", "#a0673a", "#6b4226", "#c68642", "#7a4a2a", "#9c6b45"];
const HAIR = "#15110e";

interface Slot {
  x: number;
  z: number;
  /** Facing (yaw about +y; geometry faces +z). */
  yaw: number;
  seated: boolean;
}

function slotsFor(layout: CabinLayout, carIndex: number): { seated: Slot[]; standing: Slot[] } {
  const seated: Slot[] = [];
  const standing: Slot[] = [];
  for (const run of layout.seatRuns) {
    const n = Math.max(1, Math.floor((run.x1 - run.x0) / 0.56));
    for (let k = 0; k < n; k++) {
      const x = run.x0 + ((k + 0.5) * (run.x1 - run.x0)) / n;
      // Seated passengers face the aisle.
      seated.push({ x, z: run.side * layout.seatZ, yaw: run.side > 0 ? Math.PI : 0, seated: true });
    }
  }
  for (const dx of layout.doors) {
    for (const e of [-1, 1]) {
      for (const side of [-1, 1]) {
        standing.push({ x: dx + e * (layout.doorHalf + 0.42), z: side * 0.62, yaw: side > 0 ? Math.PI : 0, seated: false });
      }
    }
  }
  for (let x = layout.xRear + 1.2; x < layout.xFront - 1.2; x += 1.15) {
    if (layout.doors.some((d) => Math.abs(d - x) < layout.doorHalf + 0.7)) continue;
    for (const side of [-1, 1]) standing.push({ x, z: side * 0.34, yaw: (side > 0 ? -1 : 1) * Math.PI / 2, seated: false });
  }
  if (carIndex === PASSENGER_CAMERA_CAR) {
    const free = (s: Slot) =>
      CLEAR_SPOTS.every((c) => Math.hypot(s.x - c.x, s.z - c.z) > c.r) &&
      !(s.x > CLEAR_AISLE.x0 - 0.6 && s.x < CLEAR_AISLE.x1 && Math.abs(s.z) < CLEAR_AISLE.halfZ);
    const clearSight = (s: Slot) => Math.abs(s.x - WINDOW_SIGHTLINE.x) > WINDOW_SIGHTLINE.halfX;
    return { seated: seated.filter(free), standing: standing.filter((st) => free(st) && clearSight(st)) };
  }
  return { seated, standing };
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const tmpColor = new Color();
function painted(g: BufferGeometry, hex: string): BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(n.attributes)) if (name !== "position" && name !== "normal") n.deleteAttribute(name);
  tmpColor.set(hex);
  const arr = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < n.attributes.position.count; i++) tmpColor.toArray(arr, i * 3);
  n.setAttribute("color", new BufferAttribute(arr, 3));
  return n;
}

// Body templates in person-local space: +z forward, origin at the feet (standing) or hips (seated).
const T = {
  legs: new BoxGeometry(0.3, 0.82, 0.2).translate(0, 0.41, 0),
  torso: new CapsuleGeometry(0.18, 0.36, 2, 8).scale(1, 1, 0.72).translate(0, 1.1, 0),
  skirt: new CylinderGeometry(0.17, 0.27, 0.92, 10).translate(0, 0.46, 0),
  torsoF: new CapsuleGeometry(0.16, 0.32, 2, 8).scale(1, 1, 0.72).translate(0, 1.07, 0),
  seatTorso: new CapsuleGeometry(0.18, 0.36, 2, 8).scale(1, 1, 0.72).translate(0, 0.36, 0),
  thighs: new BoxGeometry(0.32, 0.15, 0.46).translate(0, 0.06, 0.2),
  shins: new BoxGeometry(0.28, 0.48, 0.14).translate(0, -0.22, 0.42),
  head: new SphereGeometry(0.11, 10, 8),
  hair: new SphereGeometry(0.115, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
};

function buildPeople(kind: CarKind, carIndex: number, factor: number, women: boolean): BufferGeometry | null {
  const layout = cabinLayout(kind);
  const rng = mulberry32(carIndex * 977 + 31);
  const { seated, standing } = slotsFor(layout, carIndex);
  // Seats fill first; people start standing once the car is about a third full.
  const nSeated = Math.round(Math.min(1, factor * 1.35) * seated.length);
  const nStanding = Math.round(Math.min(1, Math.max(0, (factor - 0.35) / 0.65)) * standing.length);
  const chosen = [...shuffle(seated, rng).slice(0, nSeated), ...shuffle(standing, rng).slice(0, nStanding)];
  if (!chosen.length) return null;

  const parts: BufferGeometry[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const scale = new Vector3();
  for (const slot of chosen) {
    const woman = women || rng() < 0.42;
    const h = rr(rng, 0.94, 1.06);
    const yaw = slot.yaw + rr(rng, -0.25, 0.25);
    q.setFromAxisAngle(up, yaw);
    const jitterX = rr(rng, -0.08, 0.08);
    const skin = pick(rng, SKIN);
    const cloth = woman ? pick(rng, SAREES) : pick(rng, CLOTHES);
    let pieces: [BufferGeometry, string][];
    let headY: number;
    if (slot.seated) {
      pos.set(slot.x + jitterX, layout.seatY, slot.z);
      pieces = [
        [T.seatTorso, cloth],
        [T.thighs, woman ? cloth : pick(rng, TROUSERS)],
        [T.shins, woman ? cloth : pick(rng, TROUSERS)],
      ];
      headY = 0.8;
    } else {
      pos.set(slot.x + jitterX, layout.floorY, slot.z + rr(rng, -0.06, 0.06));
      pieces = woman
        ? [
            [T.skirt, cloth],
            [T.torsoF, cloth],
          ]
        : [
            [T.legs, pick(rng, TROUSERS)],
            [T.torso, cloth],
          ];
      headY = woman ? 1.47 : 1.52;
    }
    scale.set(1, h, 1);
    m.compose(pos, q, scale);
    for (const [g, hex] of pieces) parts.push(painted(g, hex).applyMatrix4(m));
    const head = painted(T.head, skin).translate(0, headY, 0).applyMatrix4(m);
    const hair = painted(T.hair, HAIR).translate(0, headY + 0.015, -0.005).applyMatrix4(m);
    parts.push(head, hair);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged ?? null;
}

/** Re-render on the hour so "auto" crowds follow the clock. */
export function useHour(): number {
  const [hour, setHour] = useState(() => Math.floor(localHour()));
  useEffect(() => {
    const id = window.setInterval(() => setHour(Math.floor(localHour())), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return hour;
}

export function CabinPeople({ kind, carIndex, women }: { kind: CarKind; carIndex: number; women: boolean }) {
  const crowd = useViewStore((s) => s.settings.crowd);
  const hour = useHour();
  const factor = crowdFactor(crowd, hour + 0.5);
  // Quantise so small clock changes don't rebuild the mesh.
  const level = Math.round(factor * 20) / 20;
  const geometry = useMemo(() => buildPeople(kind, carIndex, level, women), [kind, carIndex, level, women]);
  const material = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), []);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} />;
}

/* ------------------------------------------------------------------ */
/* Women's coach decals                                                */
/* ------------------------------------------------------------------ */

function womenOnlyTexture(): CanvasTexture {
  const W = 256;
  const H = 320;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const f = fontFamilies();
  ctx.fillStyle = "#d81b60";
  ctx.beginPath();
  ctx.roundRect(4, 4, W - 8, H - 8, 22);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.stroke();
  // Pictogram: head and dress.
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(W / 2, 62, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(W / 2 - 22, 96);
  ctx.lineTo(W / 2 + 22, 96);
  ctx.lineTo(W / 2 + 44, 176);
  ctx.lineTo(W / 2 - 44, 176);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = "center";
  ctx.font = `800 40px ${f.sans}`;
  ctx.fillText("WOMEN", W / 2, 222);
  ctx.fillText("ONLY", W / 2, 260);
  ctx.font = `700 26px ${f.tamil}`;
  ctx.fillText("மகளிர் மட்டும்", W / 2, 296);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** "Women only" stickers beside the doors (outside) and signs on the end walls (inside). */
export function WomenOnlyDecals({ kind }: { kind: CarKind }) {
  const [texture, setTexture] = useState<CanvasTexture | null>(null);
  useEffect(() => {
    let alive = true;
    let tex: CanvasTexture | null = null;
    void ensureFontsLoaded().then(() => {
      if (!alive) return;
      tex = womenOnlyTexture();
      setTexture(tex);
    });
    return () => {
      alive = false;
      tex?.dispose();
    };
  }, []);
  const geometry = useMemo(() => {
    const layout = cabinLayout(kind);
    const half = TRAIN.width / 2;
    const parts: BufferGeometry[] = [];
    for (const dx of layout.doors) {
      for (const side of [-1, 1]) {
        // On the window glass just beside each door, facing out.
        const g = new PlaneGeometry(0.42, 0.52);
        if (side < 0) g.rotateY(Math.PI);
        g.translate(dx + layout.doorHalf + 0.36, 2.4, side * (half + 0.012));
        parts.push(g);
      }
    }
    // Inside: one sign on each end of the saloon, facing in.
    const back = new PlaneGeometry(0.5, 0.62);
    back.rotateY(Math.PI / 2);
    back.translate(layout.xRear + 0.1, 2.35, 0.98);
    parts.push(back);
    const front = new PlaneGeometry(0.5, 0.62);
    front.rotateY(-Math.PI / 2);
    front.translate(layout.xFront - 0.1, 2.35, -0.98);
    parts.push(front);
    return mergeGeometries(parts)!;
  }, [kind]);
  const material = useMemo(() => (texture ? new MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }) : null), [texture]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material?.dispose(), [material]);
  if (!material) return null;
  return <mesh geometry={geometry} material={material} />;
}
