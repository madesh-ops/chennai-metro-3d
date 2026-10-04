"use client";

import { useEffect, useMemo } from "react";
import { type BufferGeometry, Matrix4 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useScene } from "./SceneContext.tsx";
import { DECK_PROFILE, createTrackMaterials, pierGeometry, trackGeometry } from "./Track.tsx";
import { PIER, ROAD, VIADUCT } from "./layout.ts";
import { composeMatrix, sweepProfile } from "../utils/geometry.ts";

const PIER_SPACING = 30;

/**
 * Line 5 (Red Line) leaving the Arcot Road double-decker at its west end:
 * the upper deck peels off south, falls to normal rail level and runs east
 * along Mount–Poonamallee Road. Finished viaduct with track, no trains
 * (Line 5 is not open). Path traced from satellite imagery (tracks.json).
 */
export function Line5Branch() {
  const { route, range } = useScene();
  const branch = route.line5Branch;
  const { params } = route;

  const parts = useMemo(() => {
    if (!branch || branch.junction < range[0] - 200 || branch.junction > range[1] + 200) return null;
    const { alignment, railAt } = branch;
    // Under a kilometre: one mesh per part (deck, beds, rails) keeps draw calls low.
    const chunks = [
      {
        deck: sweepProfile(alignment, 0, alignment.length, 4, DECK_PROFILE, { heightAt: railAt, closed: true, uPerMetre: 1 / 8, vPerMetre: 1 / 4 }),
        ...trackGeometry(alignment, 0, alignment.length, params.trackCentres, params.gauge, { heightAt: railAt }),
      },
    ];

    // Single-column piers sized to the falling deck; none while the branch is
    // still over the main carriageway, so traffic never meets a pier.
    const piers: BufferGeometry[] = [];
    const m = new Matrix4();
    for (let s = PIER_SPACING / 2; s < alignment.length; s += PIER_SPACING) {
      const p = alignment.point(s);
      const d = route.alignment.project(p.x, p.z, branch.junction, 1500);
      const c = route.alignment.point(d);
      if (Math.hypot(p.x - c.x, p.z - c.z) < ROAD.halfWidth + 1.5) continue;
      // Nor on a flyover deck it passes over (the MGR flyover's east end).
      const onFlyover = route.flyovers.some((f) => {
        const rs = f.road.alignment.project(p.x, p.z, f.road.junctionS, 800);
        if (rs <= f.startS - 2 || rs >= f.endS + 2) return false;
        const q = f.road.alignment.point(rs);
        return Math.hypot(p.x - q.x, p.z - q.z) < f.halfWidth + 1.5;
      });
      if (onFlyover) continue;
      const top = railAt(s) + VIADUCT.girderBottom - PIER.capHeight;
      const g = pierGeometry(top);
      g.applyMatrix4(composeMatrix(m, p.x, 0, p.z, alignment.heading(s)));
      piers.push(g);
    }
    return { chunks, piers: piers.length ? mergeGeometries(piers)! : null };
  }, [branch, range, route.alignment, route.flyovers, params.trackCentres, params.gauge]);

  const materials = useMemo(() => createTrackMaterials(), []);

  useEffect(
    () => () => {
      parts?.chunks.forEach((c) => {
        c.deck.dispose();
        c.bed.dispose();
        c.rails.dispose();
      });
      parts?.piers?.dispose();
    },
    [parts],
  );
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);

  // Dev-only: branch points for scripted camera framing.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !branch) return;
    const w = window as unknown as { __cm3dBranch?: () => unknown };
    w.__cm3dBranch = () => {
      const pts = [];
      for (let s = 0; s <= branch.alignment.length; s += 50) {
        const p = branch.alignment.point(s);
        pts.push({ s, x: p.x, z: p.z, y: branch.railAt(s) });
      }
      const j = route.alignment.point(branch.junction);
      const t = route.alignment.tangent(branch.junction);
      return { junction: { x: j.x, z: j.z, tx: t.x, tz: t.z }, points: pts };
    };
    return () => {
      delete w.__cm3dBranch;
    };
  }, [branch, route.alignment]);

  if (!parts) return null;
  return (
    <group>
      {parts.chunks.map((c, i) => (
        <group key={i}>
          <mesh geometry={c.deck} material={materials.upper} castShadow receiveShadow />
          <mesh geometry={c.bed} material={materials.bed} receiveShadow />
          <mesh geometry={c.rails} material={materials.rail} />
        </group>
      ))}
      {parts.piers && <mesh geometry={parts.piers} material={materials.pier} castShadow receiveShadow />}
    </group>
  );
}
