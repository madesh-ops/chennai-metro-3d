import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  type Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { pick, type Rng } from "../utils/random.ts";

/**
 * Low-poly people with real proportions: head and face, neck, a shaped torso
 * with shoulders, two-segment arms with hands, two-segment legs with shoes,
 * and hair, dressed in everyday Chennai clothes (shirt and trousers, T-shirt
 * and jeans, white veshti, saree with a draped pallu, kurta with dupatta).
 * Poses: standing, holding an overhead strap, looking at a phone, seated.
 *
 * Person-local space: +z forward, +y up. Standing figures have their origin
 * at the feet; seated figures at the seat surface under the hips.
 * Every vertex carries a body part id (aPart) so the same template can be
 * painted per person (baked vertex colours) or tinted per instance.
 */

export type Outfit = "shirt" | "tshirt" | "veshti" | "saree" | "kurta";
export type Pose = "stand" | "strap" | "phone" | "sit";
export type Hair = "short" | "long" | "bun";
export type Detail = "high" | "low";

/** Body part ids stored in the aPart attribute. */
export const PART = { skin: 0, top: 1, bottom: 2, hair: 3, shoe: 4, accent: 5, light: 6, phone: 7 } as const;
type Part = (typeof PART)[keyof typeof PART];

export interface HumanColours {
  skin: string;
  top: string;
  bottom: string;
  hair?: string;
  shoe?: string;
  accent?: string;
}

export const SKIN_TONES = ["#8d5524", "#a0673a", "#6b4226", "#c68642", "#7a4a2a", "#9c6b45", "#b07a4f", "#5e3a22"];
export const SHIRTS = ["#f5f5f5", "#cfe0f3", "#1f3c66", "#8fb3d9", "#b03a2e", "#2e7d5b", "#e8d9b5", "#5d6d7e", "#f2c94c", "#d5d8dc"];
export const TSHIRTS = ["#c0392b", "#2e86c1", "#27ae60", "#8e44ad", "#2b2e33", "#e67e22", "#16a085", "#ecf0f1", "#f1c40f"];
export const TROUSERS = ["#2b2e33", "#3b4a5c", "#4a4036", "#1f2a36", "#6b5b4b", "#28303b"];
export const JEANS = ["#2c4a7a", "#34557f", "#1d3557", "#3e5c8a"];
export const SAREES = ["#c2185b", "#e65100", "#00897b", "#fdd835", "#6a1b9a", "#ad1457", "#2e7d32", "#d84315", "#f06292", "#1565c0"];
export const KURTAS = ["#f8bbd0", "#b2dfdb", "#ffe082", "#ce93d8", "#90caf9", "#ffccbc", "#c5e1a5", "#ef9a9a"];
export const BORDERS = ["#d4a63a", "#c9a227", "#e0b84c", "#b8860b"];
const HAIR_COLOUR = "#15110e";
const SHOE_COLOUR = "#2a2420";

const up = new Vector3(0, 1, 0);

/** Tag a geometry with a part id (non-indexed, position + normal + aPart only). */
function tag(g: BufferGeometry, part: Part): BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(n.attributes)) if (name !== "position" && name !== "normal") n.deleteAttribute(name);
  const ids = new Float32Array(n.attributes.position.count).fill(part);
  n.setAttribute("aPart", new BufferAttribute(ids, 1));
  return n;
}

/** Capsule limb from a to b. */
function limb(a: Vector3, b: Vector3, r: number, seg: number): BufferGeometry {
  const dir = new Vector3().subVectors(b, a);
  const len = Math.max(0.001, dir.length());
  const g = new CapsuleGeometry(r, Math.max(0.001, len), 2, seg);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(up, dir.normalize()));
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/** Tapered body of revolution through [radius, y] points, flattened front-to-back. */
function lathe(profile: [number, number][], seg: number, depth = 0.66): BufferGeometry {
  const g = new LatheGeometry(profile.map(([r, y]) => new Vector2(Math.max(0.001, r), y)), seg);
  g.scale(1, 1, depth);
  return g;
}

function ball(c: Vector3, r: number, seg: number, sx = 1, sy = 1, sz = 1): BufferGeometry {
  const g = new SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.75)));
  g.scale(sx, sy, sz);
  g.translate(c.x, c.y, c.z);
  return g;
}

function slab(cx: number, cy: number, cz: number, w: number, h: number, d: number): BufferGeometry {
  return new BoxGeometry(w, h, d).translate(cx, cy, cz);
}

/** A thin band (sash, pallu, dupatta) from a to b. */
function band(a: Vector3, b: Vector3, width: number, thick: number, roll = 0): BufferGeometry {
  const dir = new Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new BoxGeometry(width, len, thick);
  g.rotateY(roll);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(up, dir.normalize()));
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

export interface HumanSpec {
  outfit: Outfit;
  pose: Pose;
  hair?: Hair;
  /** Jasmine flowers in the hair (women). */
  jasmine?: boolean;
  detail?: Detail;
}

const cache = new Map<string, BufferGeometry>();

/** A body template (positions, normals, aPart). Cached per spec; do not mutate. */
export function humanTemplate(spec: HumanSpec): BufferGeometry {
  const key = `${spec.outfit}|${spec.pose}|${spec.hair ?? ""}|${spec.jasmine ? 1 : 0}|${spec.detail ?? "high"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const g = buildTemplate(spec);
  cache.set(key, g);
  return g;
}

function buildTemplate({ outfit, pose, hair, jasmine, detail = "high" }: HumanSpec): BufferGeometry {
  const hi = detail === "high";
  const seg = hi ? 10 : 6;
  const lseg = hi ? 7 : 5;
  const woman = outfit === "saree" || outfit === "kurta";
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, p: Part) => parts.push(tag(g, p));

  // Proportions (metres, standing): women are drawn a little narrower; height varies per instance.
  const sh = woman ? 0.165 : 0.19; // shoulder half-width
  const hipW = woman ? 0.165 : 0.15;
  const sit = pose === "sit";
  // Seated: hips sit on the seat; everything above the hips shifts down.
  const hipY = sit ? 0.1 : 0.88;
  const dy = hipY - 0.88;
  const Y = (y: number) => y + dy;

  // --- Legs -------------------------------------------------------------
  const legX = woman ? 0.085 : 0.095;
  const legs: [Vector3, Vector3, Vector3][] = [-1, 1].map((s) => {
    if (sit) {
      const hip = V(s * legX, hipY, 0.02);
      const knee = V(s * (legX + 0.01), hipY + 0.01, 0.44);
      const ankle = V(s * (legX + 0.015), hipY - 0.47, 0.5);
      return [hip, knee, ankle];
    }
    const hip = V(s * legX, 0.86, 0);
    const knee = V(s * (legX + 0.005), 0.48, 0.015);
    const ankle = V(s * (legX + 0.01), 0.09, 0);
    return [hip, knee, ankle];
  });
  const legsCovered = outfit === "saree" || outfit === "veshti";
  for (const [hip, knee, ankle] of legs) {
    if (!legsCovered || sit) {
      // Trousers, jeans or leggings; seated saree/veshti cloth also wraps the legs.
      const draped = legsCovered && sit;
      add(limb(hip, knee, draped ? 0.088 : 0.072, lseg), PART.bottom);
      if (!draped) add(limb(knee, ankle, 0.054, lseg), PART.bottom);
    } else {
      // Ankles show below the drape.
      add(limb(V(ankle.x, 0.16, ankle.z), ankle, 0.045, lseg), PART.skin);
    }
    // Shoes / sandals.
    add(slab(ankle.x, ankle.y - 0.05, ankle.z + 0.05, 0.085, 0.06, 0.22), PART.shoe);
  }
  if (legsCovered && !sit) {
    // Draped saree / veshti: a gently flaring skirt from the waist to the ankles.
    const flare = outfit === "saree" ? 0.25 : 0.22;
    add(lathe([[0.001, 0.12], [flare, 0.13], [flare - 0.02, 0.4], [hipW + 0.02, 0.8], [hipW, 1.0], [0.001, 1.01]], seg, 0.72), PART.bottom);
    if (outfit === "saree") {
      // Front pleats: a slightly darker panel.
      add(slab(0, 0.5, 0.17, 0.12, 0.72, 0.02), PART.accent);
    }
  }
  if (sit && legsCovered) {
    // Seated: the drape falls from the knees to the ankles.
    const top = hipY + 0.06;
    const bottom = hipY - 0.45;
    const skirt = new CylinderGeometry(0.17, 0.2, top - bottom, seg, 1, false).scale(1, 1, 0.55);
    add(skirt.translate(0, (top + bottom) / 2, 0.47), PART.bottom);
  }

  // --- Torso ------------------------------------------------------------
  const waistY = Y(1.04);
  const chestY = Y(1.27);
  const shY = Y(1.4);
  if (outfit === "saree") {
    // Blouse over the chest, a band of skin at the midriff, the skirt from the waist.
    add(lathe([[0.001, Y(1.15)], [0.14, Y(1.15)], [0.165, chestY], [sh, Y(1.38)], [0.07, Y(1.47)], [0.001, Y(1.47)]], seg), PART.top);
    add(lathe([[0.001, Y(1.0)], [hipW, Y(1.0)], [0.135, Y(1.08)], [0.14, Y(1.16)], [0.001, Y(1.16)]], seg), PART.skin);
    // Pallu: from the right hip across the chest, over the left shoulder, down the back.
    add(band(V(0.1, Y(0.98), 0.13), V(-0.12, Y(1.42), 0.08), 0.2, 0.025, 0.4), PART.bottom);
    add(band(V(-0.14, Y(1.43), 0.0), V(-0.12, Y(0.9), -0.15), 0.22, 0.025), PART.bottom);
    add(band(V(0.13, Y(0.98), 0.145), V(-0.1, Y(1.41), 0.095), 0.03, 0.03, 0.4), PART.accent);
  } else if (outfit === "kurta") {
    // Long kurta to the knee over leggings; dupatta over both shoulders.
    add(lathe([[0.001, Y(0.55)], [0.2, Y(0.56)], [0.18, Y(0.85)], [0.15, waistY], [0.165, chestY], [sh, Y(1.38)], [0.07, Y(1.47)], [0.001, Y(1.47)]], seg), PART.top);
    for (const s of [-1, 1]) add(band(V(s * 0.115, Y(1.44), 0.02), V(s * 0.1, Y(1.0), 0.13), 0.065, 0.015), PART.accent);
    add(band(V(-0.11, Y(1.44), 0.075), V(0.11, Y(1.44), 0.075), 0.05, 0.015), PART.accent);
  } else {
    const bottom = outfit === "veshti" ? 0.9 : 0.84;
    add(lathe([[0.001, Y(bottom)], [hipW + 0.01, Y(bottom)], [0.145, waistY], [0.175, chestY], [sh, Y(1.38)], [0.08, Y(1.47)], [0.001, Y(1.47)]], seg), PART.top);
    if (outfit === "shirt") {
      // Collar and buttons strip.
      add(lathe([[0.001, Y(1.44)], [0.075, Y(1.44)], [0.065, Y(1.5)], [0.001, Y(1.5)]], seg), PART.top);
      add(slab(0, Y(1.2), 0.118, 0.015, 0.4, 0.01), PART.light);
    }
    if (outfit !== "veshti") add(lathe([[0.001, Y(0.94)], [hipW + 0.015, Y(0.94)], [hipW + 0.015, Y(0.98)], [0.001, Y(0.98)]], seg), PART.shoe);
  }

  // --- Arms -------------------------------------------------------------
  const sleeveLong = outfit === "shirt" || outfit === "kurta";
  const arm = (s: number, elbow: Vector3, wrist: Vector3) => {
    const shoulder = V(s * (sh - 0.02), shY - 0.02, 0);
    add(ball(shoulder, 0.055, lseg), PART.top);
    // Short sleeves (T-shirt, blouse) show the upper arm.
    const sleeveEnd = sleeveLong ? elbow : new Vector3().lerpVectors(shoulder, elbow, 0.45);
    add(limb(shoulder, sleeveEnd, 0.052, lseg), PART.top);
    if (!sleeveLong) add(limb(sleeveEnd, elbow, 0.044, lseg), PART.skin);
    add(limb(elbow, wrist, 0.038, lseg), sleeveLong && outfit === "shirt" ? PART.top : PART.skin);
    if (outfit === "kurta") add(limb(elbow, new Vector3().lerpVectors(elbow, wrist, 0.6), 0.042, lseg), PART.top);
    const handDir = new Vector3().subVectors(wrist, elbow).normalize();
    add(ball(wrist.clone().addScaledVector(handDir, 0.06), 0.042, lseg, 0.8, 1.15, 0.6), PART.skin);
  };
  for (const s of [-1, 1]) {
    const S = V(s * (sh - 0.02), shY - 0.02, 0);
    if (pose === "strap" && s > 0) {
      // Right hand up on the overhead strap.
      // Holding the overhead rail (about 1.8 m above the floor).
      const e = V(s * (sh + 0.06), shY + 0.14, 0.05);
      arm(s, e, V(s * (sh - 0.01), shY + 0.33, 0.06));
    } else if (pose === "phone") {
      const e = V(s * (sh + 0.01), shY - 0.27, 0.05);
      arm(s, e, V(s * 0.05, shY - 0.2, 0.27));
    } else if (sit) {
      const e = V(s * (sh + 0.02), shY - 0.26, 0.08);
      arm(s, e, V(s * 0.1, hipY + 0.14, 0.3));
    } else {
      const e = V(s * (sh + 0.035), S.y - 0.28, -0.01);
      arm(s, e, V(s * (sh + 0.045), S.y - 0.53, 0.04));
    }
  }
  if (pose === "phone") add(slab(0, shY - 0.17, 0.32, 0.075, 0.14, 0.012).rotateX(-0.6), PART.phone);

  // --- Neck and head ----------------------------------------------------
  add(limb(V(0, Y(1.45), 0), V(0, Y(1.52), 0.005), 0.046, lseg), PART.skin);
  const hc = V(0, Y(1.6), 0.01);
  add(ball(hc, 0.1, seg, 0.9, 1.12, 1.0), PART.skin);
  if (hi) {
    // Face: nose, eyes, brows and ears give the head a front.
    add(slab(0, hc.y - 0.01, hc.z + 0.098, 0.025, 0.045, 0.03), PART.skin);
    for (const s of [-1, 1]) {
      add(ball(V(s * 0.034, hc.y + 0.016, hc.z + 0.086), 0.014, 6, 1.2, 0.8, 0.6), PART.hair);
      add(slab(s * 0.035, hc.y + 0.042, hc.z + 0.088, 0.03, 0.008, 0.01), PART.hair);
      add(ball(V(s * 0.09, hc.y, hc.z - 0.005), 0.022, 6, 0.5, 1, 0.8), PART.skin);
    }
    // Mouth.
    add(slab(0, hc.y - 0.052, hc.z + 0.09, 0.03, 0.006, 0.01), PART.accent);
  }
  // Hair.
  const style: Hair = hair ?? (woman ? "long" : "short");
  add(ball(V(0, hc.y + 0.02, hc.z - 0.012), 0.106, seg, 0.92, 0.95, 1.02), PART.hair);
  if (style === "short") {
    // Trim the hair cap to the top/back by sinking it: a slightly smaller face sphere covers the front.
    add(ball(V(0, hc.y - 0.01, hc.z + 0.012), 0.1, seg, 0.9, 1.08, 0.98), PART.skin);
  } else {
    add(ball(V(0, hc.y - 0.012, hc.z + 0.016), 0.099, seg, 0.88, 1.06, 0.97), PART.skin);
    if (style === "long") {
      // Long plait down the back.
      add(limb(V(0, hc.y - 0.02, hc.z - 0.09), V(0, Y(1.12), -0.13), 0.032, lseg), PART.hair);
    } else {
      add(ball(V(0, hc.y + 0.01, hc.z - 0.11), 0.05, lseg), PART.hair);
    }
    if (jasmine) {
      for (let i = 0; i < 5; i++) {
        const a = -0.9 + (i / 4) * 1.8;
        add(ball(V(Math.sin(a) * 0.06, hc.y + 0.03 - Math.abs(a) * 0.02, hc.z - 0.1 - Math.cos(a) * 0.015), 0.013, 5), PART.light);
      }
    }
  }
  if (outfit === "saree" || outfit === "kurta") {
    // Bindi.
    if (hi) add(ball(V(0, hc.y + 0.04, hc.z + 0.093), 0.006, 5), PART.accent);
  }

  const merged = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return merged;
}

/* ------------------------------------------------------------------ */
/* Painting                                                             */
/* ------------------------------------------------------------------ */

const tmp = new Color();
const fixed: Record<number, string> = {
  [PART.hair]: HAIR_COLOUR,
  [PART.shoe]: SHOE_COLOUR,
  [PART.light]: "#f7f4ea",
  [PART.phone]: "#111317",
};

/** A copy of a template with baked vertex colours (for merging many people into one mesh). */
export function paintHuman(template: BufferGeometry, colours: HumanColours): BufferGeometry {
  const g = template.clone();
  const ids = g.getAttribute("aPart");
  const n = ids.count;
  const arr = new Float32Array(n * 3);
  const byPart: Record<number, Color> = {
    [PART.skin]: new Color(colours.skin),
    [PART.top]: new Color(colours.top),
    [PART.bottom]: new Color(colours.bottom),
    [PART.hair]: new Color(colours.hair ?? fixed[PART.hair]),
    [PART.shoe]: new Color(colours.shoe ?? fixed[PART.shoe]),
    [PART.accent]: new Color(colours.accent ?? "#5a1e1e"),
    [PART.light]: new Color(fixed[PART.light]),
    [PART.phone]: new Color(fixed[PART.phone]),
  };
  for (let i = 0; i < n; i++) {
    (byPart[ids.getX(i)] ?? tmp.set("#888888")).toArray(arr, i * 3);
  }
  g.setAttribute("color", new BufferAttribute(arr, 3));
  g.deleteAttribute("aPart");
  return g;
}

/** Plausible colours for an outfit. */
export function pickColours(outfit: Outfit, rng: Rng): HumanColours {
  const skin = pick(rng, SKIN_TONES);
  switch (outfit) {
    case "saree": {
      const saree = pick(rng, SAREES);
      return { skin, top: rng() < 0.5 ? saree : pick(rng, SAREES), bottom: saree, accent: pick(rng, BORDERS), shoe: "#6b4a2e" };
    }
    case "kurta":
      return { skin, top: pick(rng, KURTAS), bottom: rng() < 0.5 ? "#f5f5f5" : pick(rng, TROUSERS), accent: pick(rng, SAREES), shoe: "#6b4a2e" };
    case "veshti":
      return { skin, top: pick(rng, ["#f5f5f5", "#e8e4d8", "#cfe0f3"]), bottom: "#f4f1e8", accent: "#3a2a1a", shoe: "#4a3020" };
    case "tshirt":
      return { skin, top: pick(rng, TSHIRTS), bottom: pick(rng, JEANS), accent: "#3a2a1a" };
    case "shirt":
    default:
      return { skin, top: pick(rng, SHIRTS), bottom: pick(rng, TROUSERS), accent: "#3a2a1a" };
  }
}

/** A random outfit: about four in ten women (saree or kurta). */
export function pickOutfit(rng: Rng, women = false): Outfit {
  if (women || rng() < 0.42) return rng() < 0.55 ? "saree" : "kurta";
  const r = rng();
  return r < 0.45 ? "shirt" : r < 0.85 ? "tshirt" : "veshti";
}

export function pickHair(outfit: Outfit, rng: Rng): Hair {
  if (outfit === "saree" || outfit === "kurta") return rng() < 0.65 ? "long" : "bun";
  return "short";
}

/* ------------------------------------------------------------------ */
/* Instanced crowds (platforms, streets)                                */
/* ------------------------------------------------------------------ */

/**
 * Material for instanced people: hair, shoes and fixed details keep their
 * baked colours; skin, top, bottom and accent come from per-instance
 * attributes (aSkin, aTop, aBottom, aAccent).
 */
export function createHumanMaterial(): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aPart;
        attribute vec3 aSkin;
        attribute vec3 aTop;
        attribute vec3 aBottom;
        attribute vec3 aAccent;`,
      )
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>
        if (aPart < 0.5) vColor.rgb = aSkin;
        else if (aPart < 1.5) vColor.rgb = aTop;
        else if (aPart < 2.5) vColor.rgb = aBottom;
        else if (aPart > 4.5 && aPart < 5.5) vColor.rgb = aAccent;`,
      );
  };
  mat.customProgramCacheKey = () => "cm-human-v1";
  return mat;
}

/** Template with a baked colour attribute for the fixed parts (needed by createHumanMaterial). */
function instancedTemplate(spec: HumanSpec): BufferGeometry {
  const g = humanTemplate(spec).clone();
  const ids = g.getAttribute("aPart");
  const arr = new Float32Array(ids.count * 3);
  for (let i = 0; i < ids.count; i++) tmp.set(fixed[ids.getX(i)] ?? "#ffffff").toArray(arr, i * 3);
  g.setAttribute("color", new BufferAttribute(arr, 3));
  return g;
}

export interface CrowdMember {
  matrix: Matrix4;
  colours: HumanColours;
}

/** One InstancedMesh for everyone sharing a body template. */
export function crowdMesh(spec: HumanSpec, members: CrowdMember[], material: MeshStandardMaterial): InstancedMesh {
  const geo = instancedTemplate(spec);
  const n = members.length;
  const attrs = { aSkin: new Float32Array(n * 3), aTop: new Float32Array(n * 3), aBottom: new Float32Array(n * 3), aAccent: new Float32Array(n * 3) };
  const mesh = new InstancedMesh(geo, material, n);
  members.forEach((m, i) => {
    mesh.setMatrixAt(i, m.matrix);
    tmp.set(m.colours.skin).toArray(attrs.aSkin, i * 3);
    tmp.set(m.colours.top).toArray(attrs.aTop, i * 3);
    tmp.set(m.colours.bottom).toArray(attrs.aBottom, i * 3);
    tmp.set(m.colours.accent ?? "#5a1e1e").toArray(attrs.aAccent, i * 3);
  });
  for (const [k, v] of Object.entries(attrs)) geo.setAttribute(k, new InstancedBufferAttribute(v, 3));
  mesh.computeBoundingSphere();
  return mesh;
}

/** Instanced-crowd variants used on platforms and streets (low detail, varied looks). */
export const CROWD_VARIANTS: HumanSpec[] = [
  { outfit: "shirt", pose: "stand", detail: "low" },
  { outfit: "tshirt", pose: "phone", detail: "low" },
  { outfit: "veshti", pose: "stand", detail: "low" },
  { outfit: "saree", pose: "stand", hair: "long", detail: "low" },
  { outfit: "kurta", pose: "phone", hair: "bun", detail: "low" },
  { outfit: "tshirt", pose: "stand", detail: "low" },
];

/** Dispose the geometries cached by humanTemplate (e.g. on hot reload). */
export function disposeHumanTemplates() {
  cache.forEach((g) => g.dispose());
  cache.clear();
}
