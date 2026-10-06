"use client";

import { useEffect, useMemo } from "react";
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Shape,
  BoxGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useScene } from "./SceneContext.tsx";
import type { Alignment } from "../simulation/Alignment.ts";
import { chunkRanges, composeMatrix, rectProfile, sweepProfile, type ProfilePoint } from "../utils/geometry.ts";
import { makeConcreteTexture, makeTrackBedTexture } from "./textures.ts";
import { FLYOVER_PORTAL_OFFSET, PIER, PORTAL_BEAM_DEPTH, VIADUCT } from "./layout.ts";

export const DECK_PROFILE: ProfilePoint[] = [
  { l: -2.6, y: VIADUCT.girderBottom },
  { l: 2.6, y: VIADUCT.girderBottom },
  { l: 4.0, y: -0.98 },
  { l: VIADUCT.halfWidth, y: -0.78 },
  { l: VIADUCT.halfWidth, y: VIADUCT.parapet },
  { l: VIADUCT.halfWidth - 0.24, y: VIADUCT.parapet },
  { l: VIADUCT.halfWidth - 0.24, y: VIADUCT.deckTop },
  { l: -(VIADUCT.halfWidth - 0.24), y: VIADUCT.deckTop },
  { l: -(VIADUCT.halfWidth - 0.24), y: VIADUCT.parapet },
  { l: -VIADUCT.halfWidth, y: VIADUCT.parapet },
  { l: -VIADUCT.halfWidth, y: -0.78 },
  { l: -4.0, y: -0.98 },
];

const CHUNK = 500;
/** Rail heights splitting viaduct / open trough / tunnel. */
const VIADUCT_MIN = 4;
const TUNNEL_MAX = -7;
/** Tunnel box: clear width either side of the centreline, and roof height above the rail. */
const TUNNEL_HALF = 5.4;
const TUNNEL_ROOF = 6.0;
const WALL = 0.6;

export type TrackStructure = "viaduct" | "trough" | "tunnel";

/** Contiguous stretches of one structure kind within [d0, d1], from the rail height. */
export function structureSpans(railAt: (d: number) => number, d0: number, d1: number): { kind: TrackStructure; a: number; b: number }[] {
  const kindAt = (d: number): TrackStructure => {
    const y = railAt(d);
    return y >= VIADUCT_MIN ? "viaduct" : y <= TUNNEL_MAX ? "tunnel" : "trough";
  };
  const out: { kind: TrackStructure; a: number; b: number }[] = [];
  for (let d = d0; d < d1; d += 5) {
    const k = kindAt(d);
    const last = out[out.length - 1];
    if (last && last.kind === k) last.b = Math.min(d1, d + 5);
    else out.push({ kind: k, a: d, b: Math.min(d1, d + 5) });
  }
  return out;
}

/** U-trough (open cut / embankment) cross-section at rail height y: walls reach 1 m above the ground. */
function troughProfile(y: number): ProfilePoint[] {
  const bottom = Math.min(-1.2, -y);
  const top = y < 0 ? 1.0 - y : 1.0;
  const outer = TUNNEL_HALF + WALL;
  return [
    { l: -outer, y: bottom },
    { l: outer, y: bottom },
    { l: outer, y: top },
    { l: TUNNEL_HALF, y: top },
    { l: TUNNEL_HALF, y: VIADUCT.deckTop },
    { l: -TUNNEL_HALF, y: VIADUCT.deckTop },
    { l: -TUNNEL_HALF, y: top },
    { l: -outer, y: top },
  ];
}

/** Render order for underground geometry: before the ground (see Ground.tsx ORDER). */
export const TUNNEL_ORDER = -5;

export function pierGeometry(height: number): BufferGeometry {
  const col = new CylinderGeometry(1, 1, height, 14);
  col.scale(PIER.depth / 2, 1, PIER.width / 2);
  col.translate(0, height / 2, 0);
  const cap = new Shape();
  const hw = PIER.capWidth / 2;
  cap.moveTo(-1.6, 0);
  cap.lineTo(1.6, 0);
  cap.lineTo(hw, PIER.capHeight * 0.55);
  cap.lineTo(hw, PIER.capHeight);
  cap.lineTo(-hw, PIER.capHeight);
  cap.lineTo(-hw, PIER.capHeight * 0.55);
  cap.closePath();
  const capGeo = new ExtrudeGeometry(cap, { depth: 2.2, bevelEnabled: false });
  // Shape is in (lateral, y); extrude along z then turn so it runs across the track.
  capGeo.translate(0, 0, -1.1);
  capGeo.rotateY(Math.PI / 2);
  capGeo.translate(0, height, 0);
  // ExtrudeGeometry is already non-indexed.
  return mergeGeometries([col.toNonIndexed(), capGeo])!;
}

/** Portal pier for the two-tier stretch: two columns and two cross-beams. */
function portalGeometry(lowerTop: number, upperTop: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const col = new BoxGeometry(1.5, upperTop, 1.6);
    col.translate(0, upperTop / 2, s * 6.2);
    parts.push(col.toNonIndexed());
  }
  for (const top of [lowerTop, upperTop]) {
    const beam = new BoxGeometry(1.9, 1.5, 14.0);
    beam.translate(0, top - 0.75, 0);
    parts.push(beam.toNonIndexed());
  }
  return mergeGeometries(parts)!;
}

/** Viaduct materials (shared look for Line 4, the upper deck and the Line 5 branch). */
export function createTrackMaterials() {
  const concreteTex = makeConcreteTexture();
  const bedTex = makeTrackBedTexture();
  return {
    deck: new MeshStandardMaterial({ color: "#d4d2cc", map: concreteTex, roughness: 0.92 }),
    upper: new MeshStandardMaterial({ color: "#cbc9c2", map: concreteTex, roughness: 0.92 }),
    bed: new MeshStandardMaterial({ map: bedTex, roughness: 0.95 }),
    rail: new MeshStandardMaterial({ color: "#8d949b", metalness: 0.85, roughness: 0.32 }),
    pier: new MeshStandardMaterial({ color: "#cfcdc6", map: concreteTex, roughness: 0.9 }),
    steel: new MeshStandardMaterial({ color: "#56626d", roughness: 0.5, metalness: 0.45 }),
    // Tunnels get no sun: a soft glow stands in for their own lighting.
    tunnel: new MeshStandardMaterial({ color: "#a9a8a2", map: concreteTex, roughness: 0.95, emissive: new Color("#8a8780"), emissiveMap: concreteTex, emissiveIntensity: 0.35 }),
    tunnelLight: new MeshBasicMaterial({ color: "#fff1d0", toneMapped: false }),
  };
}

/** Two track beds and four rails swept along an alignment (base height = rail top). */
export function trackGeometry(
  alignment: Alignment,
  a: number,
  b: number,
  trackCentres: number,
  gauge: number,
  height: { baseY?: number; heightAt?: (d: number) => number },
) {
  const half = trackCentres / 2;
  const gaugeHalf = gauge / 2 + 0.035;
  const beds: BufferGeometry[] = [];
  const rails: BufferGeometry[] = [];
  for (const c of [-half, half]) {
    beds.push(
      sweepProfile(alignment, a, b, 5, [
        { l: c + 1.5, y: VIADUCT.deckTop + 0.04 },
        { l: c - 1.5, y: VIADUCT.deckTop + 0.04 },
      ], { ...height, uPerMetre: 1 / 0.65, vPerMetre: 1 / 3 }),
    );
    for (const r of [-gaugeHalf, gaugeHalf]) {
      rails.push(sweepProfile(alignment, a, b, 5, rectProfile(c + r - 0.036, c + r + 0.036, -0.2, 0), { ...height, closed: true }));
    }
  }
  return { bed: mergeGeometries(beds)!, rails: mergeGeometries(rails)! };
}

/** Painted-steel portal frame: two columns outside the flyover, a box beam under the viaduct. */
function steelPortalGeometry(top: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const col = new BoxGeometry(0.9, top - 0.9, 0.9);
    col.translate(0, (top - 0.9) / 2, s * FLYOVER_PORTAL_OFFSET);
    parts.push(col.toNonIndexed());
    const plate = new BoxGeometry(1.4, 0.12, 1.4);
    plate.translate(0, 0.06, s * FLYOVER_PORTAL_OFFSET);
    parts.push(plate.toNonIndexed());
  }
  // A shallow steel box beam, so buses on the flyover crest pass beneath it.
  const beam = new BoxGeometry(1.6, PORTAL_BEAM_DEPTH, FLYOVER_PORTAL_OFFSET * 2 + 1.6);
  beam.translate(0, top - PORTAL_BEAM_DEPTH / 2, 0);
  parts.push(beam.toNonIndexed());
  return mergeGeometries(parts)!;
}

export function Track() {
  const { route, range } = useScene();
  const { alignment, params } = route;
  const rail = params.railLevel;

  const materials = useMemo(() => createTrackMaterials(), []);

  const railAt = route.profile.railAt;
  const spans = useMemo(() => structureSpans(railAt, range[0], range[1]), [railAt, range]);
  const height = useMemo(() => ({ heightAt: railAt }), [railAt]);

  // Viaduct deck, open trough or tunnel box per stretch, in chunks; track beds and rails throughout.
  const chunks = useMemo(() => {
    const out: { key: string; kind: TrackStructure; structure: BufferGeometry; bed: BufferGeometry; rails: BufferGeometry; lights?: BufferGeometry }[] = [];
    for (const sp of spans) {
      for (const [a, b] of chunkRanges(sp.a, sp.b, CHUNK)) {
        let structure: BufferGeometry;
        let lights: BufferGeometry | undefined;
        if (sp.kind === "viaduct") {
          structure = sweepProfile(alignment, a, b, 5, DECK_PROFILE, { ...height, closed: true, uPerMetre: 1 / 8, vPerMetre: 1 / 4 });
        } else if (sp.kind === "trough") {
          structure = sweepProfile(alignment, a, b, 5, troughProfile(0), {
            ...height,
            closed: true,
            profileAt: (d) => troughProfile(railAt(d)),
            uPerMetre: 1 / 8,
            vPerMetre: 1 / 4,
          });
        } else {
          // Cut-and-cover box: floor slab, two walls, roof slab (each faces outward; seen from inside).
          const o = { ...height, closed: true, uPerMetre: 1 / 8, vPerMetre: 1 / 4 };
          structure = mergeGeometries([
            sweepProfile(alignment, a, b, 5, rectProfile(-TUNNEL_HALF - WALL, TUNNEL_HALF + WALL, -1.2, VIADUCT.deckTop), o),
            sweepProfile(alignment, a, b, 5, rectProfile(TUNNEL_HALF, TUNNEL_HALF + WALL, VIADUCT.deckTop, TUNNEL_ROOF), o),
            sweepProfile(alignment, a, b, 5, rectProfile(-TUNNEL_HALF - WALL, -TUNNEL_HALF, VIADUCT.deckTop, TUNNEL_ROOF), o),
            sweepProfile(alignment, a, b, 5, rectProfile(-TUNNEL_HALF - WALL, TUNNEL_HALF + WALL, TUNNEL_ROOF, TUNNEL_ROOF + 0.8), o),
            // Cable trays along both walls.
            sweepProfile(alignment, a, b, 5, rectProfile(TUNNEL_HALF - 0.35, TUNNEL_HALF, 1.6, 1.75), o),
            sweepProfile(alignment, a, b, 5, rectProfile(-TUNNEL_HALF, -TUNNEL_HALF + 0.35, 1.6, 1.75), o),
          ])!;
          lights = mergeGeometries([
            sweepProfile(alignment, a, b, 5, rectProfile(TUNNEL_HALF - 0.08, TUNNEL_HALF, 3.6, 3.75), o),
            sweepProfile(alignment, a, b, 5, rectProfile(-TUNNEL_HALF, -TUNNEL_HALF + 0.08, 3.6, 3.75), o),
          ])!;
        }
        out.push({ key: `${sp.kind}-${a}`, kind: sp.kind, structure, lights, ...trackGeometry(alignment, a, b, params.trackCentres, params.gauge, height) });
      }
    }
    return out;
  }, [alignment, spans, height, railAt, params.trackCentres, params.gauge]);

  // Concrete headwalls where a tunnel meets an open trough (the portals).
  const portals = useMemo(() => {
    const parts: BufferGeometry[] = [];
    for (let i = 1; i < spans.length; i++) {
      const pair = [spans[i - 1].kind, spans[i].kind];
      if (!(pair.includes("tunnel") && pair.includes("trough"))) continue;
      const d = spans[i].a;
      const y = railAt(d);
      const wall = new BoxGeometry(0.8, Math.max(1, 1.2 - (y + TUNNEL_ROOF)), 2 * (TUNNEL_HALF + WALL) + 2);
      wall.translate(0, (y + TUNNEL_ROOF + 1.2) / 2, 0);
      const p = alignment.point(d);
      wall.applyMatrix4(composeMatrix(new Matrix4(), p.x, 0, p.z, alignment.heading(d)));
      parts.push(wall.toNonIndexed());
    }
    return parts.length ? mergeGeometries(parts)! : null;
  }, [alignment, spans, railAt]);

  const dd = route.doubleDecker;
  // Upper deck (Line 5): deck, track beds and rails. At its west end it continues
  // onto the Line 5 branch (Line5Branch.tsx); the east end still stops short.
  const upper = useMemo(() => {
    if (!dd) return [];
    const a = Math.max(range[0], dd.upperStart);
    const b = Math.min(range[1], dd.upperEnd);
    if (b <= a) return [];
    const top = rail + params.upperDeckHeight;
    // One mesh per part for the whole upper deck: it is only ~4 km, and fewer
    // draw calls beat finer culling here.
    return [
      {
        deck: sweepProfile(alignment, a, b, 5, DECK_PROFILE, { baseY: top, closed: true, uPerMetre: 1 / 8, vPerMetre: 1 / 4 }),
        ...trackGeometry(alignment, a, b, params.trackCentres, params.gauge, { baseY: top }),
      },
    ];
  }, [alignment, dd, range, rail, params.upperDeckHeight, params.trackCentres, params.gauge]);

  const piers = useMemo(() => {
    const steel = steelPortalGeometry(rail + VIADUCT.girderBottom);
    const portal = portalGeometry(rail + VIADUCT.girderBottom, rail + VIADUCT.girderBottom + params.upperDeckHeight);
    // Standard piers in 1.5 m height steps (ramps), so caps are never stretched.
    const byHeight = new Map<number, Matrix4[]>();
    const portalM: Matrix4[] = [];
    const steelM: Matrix4[] = [];
    const overFlyover = (d: number) => route.flyovers.some((f) => d > f.corridorFrom - 6 && d < f.corridorTo + 6);
    const halfPlatform = params.platformLength / 2 + 4;
    const p = { x: 0, z: 0 };
    for (let d = Math.ceil(range[0] / params.pierSpacing) * params.pierSpacing; d <= range[1]; d += params.pierSpacing) {
      const y = railAt(d);
      if (y < VIADUCT_MIN + 2) continue; // trough, tunnel, or deck resting on its approach
      // Over a flyover the metro rests on steel portals, even inside a station
      // (its concourse has no median supports there).
      const flyover = overFlyover(d);
      if (!flyover && route.stations.some((s) => Math.abs(s.distance - d) < halfPlatform)) continue;
      alignment.point(d, p);
      const m = composeMatrix(new Matrix4(), p.x, 0, p.z, alignment.heading(d));
      if (flyover) steelM.push(m);
      else if (dd && d > dd.upperStart && d < dd.upperEnd) portalM.push(m);
      else {
        const bucket = Math.round((y + VIADUCT.girderBottom - PIER.capHeight) / 1.5) * 1.5;
        if (!byHeight.has(bucket)) byHeight.set(bucket, []);
        byHeight.get(bucket)!.push(m);
      }
    }
    const make = (geo: BufferGeometry, ms: Matrix4[], mat = materials.pier) => {
      if (!ms.length) return null;
      const mesh = new InstancedMesh(geo, mat, ms.length);
      ms.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      return mesh;
    };
    return [
      ...[...byHeight.entries()].map(([h, ms]) => make(pierGeometry(Math.max(1, h)), ms)),
      make(portal, portalM),
      make(steel, steelM, materials.steel),
    ].filter(Boolean) as InstancedMesh[];
  }, [alignment, dd, materials.pier, materials.steel, params.pierSpacing, params.platformLength, params.upperDeckHeight, rail, railAt, range, route.stations, route.flyovers]);

  useEffect(
    () => () => {
      chunks.forEach((c) => {
        c.structure.dispose();
        c.lights?.dispose();
        c.bed.dispose();
        c.rails.dispose();
      });
      portals?.dispose();
      upper.forEach((u) => {
        u.deck.dispose();
        u.bed.dispose();
        u.rails.dispose();
      });
      piers.forEach((p) => p.geometry.dispose());
    },
    [chunks, upper, piers, portals],
  );

  return (
    <group>
      {chunks.map((c) => {
        // Tunnels draw before the ground so the ground hides them from above (it writes no depth);
        // from inside, the tunnel roof is nearer than the ground and hides it instead.
        const order = c.kind === "tunnel" ? TUNNEL_ORDER : 0;
        return (
          <group key={c.key}>
            <mesh geometry={c.structure} material={c.kind === "viaduct" ? materials.deck : materials.tunnel} castShadow receiveShadow renderOrder={order} />
            <mesh geometry={c.bed} material={materials.bed} receiveShadow renderOrder={order} />
            <mesh geometry={c.rails} material={materials.rail} renderOrder={order} />
            {c.lights && <mesh geometry={c.lights} material={materials.tunnelLight} renderOrder={order} />}
          </group>
        );
      })}
      {portals && <mesh geometry={portals} material={materials.tunnel} castShadow receiveShadow />}
      {upper.map((u, i) => (
        <group key={i}>
          <mesh geometry={u.deck} material={materials.upper} castShadow receiveShadow />
          <mesh geometry={u.bed} material={materials.bed} receiveShadow />
          <mesh geometry={u.rails} material={materials.rail} />
        </group>
      ))}
      {piers.map((p, i) => (
        <primitive key={i} object={p} />
      ))}
    </group>
  );
}
