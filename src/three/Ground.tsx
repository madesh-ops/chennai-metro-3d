"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { BufferGeometry, Color, Matrix4, MeshStandardMaterial, PlaneGeometry, InstancedMesh } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useScene } from "./SceneContext.tsx";
import { chunkRanges, composeMatrix, rectProfile, sweepProfile } from "../utils/geometry.ts";
import { makeConcreteTexture, makeGroundTexture, makeRoadTexture } from "./textures.ts";
import { ROAD } from "./layout.ts";
import { branchLayout } from "./line5Layout.ts";

/**
 * The ground, cross streets and carriageway are only centimetres apart, which
 * is below depth-buffer precision a few hundred metres out (worse during
 * camera transitions, when the near plane drops to 10 cm). Rather than rely
 * on depth, these layers are painted in a fixed order, bottom first, and the
 * two lower ones don't write depth, so the road always lands on top.
 * Everything else in the scene stands on or above them and draws afterwards.
 */
export const ORDER = { ground: -3, cross: -2, road: -1 };

/**
 * Ground plane plus the arterial road the viaduct stands over (Trunk Road /
 * Mount–Poonamallee Road and Arcot Road in reality), its median, footpaths
 * and cross streets.
 */
export function Ground({ crossStreets }: { crossStreets: number[] }) {
  const { route, range, env } = useScene();
  const { alignment } = route;

  const materials = useMemo(() => {
    const groundTex = makeGroundTexture();
    groundTex.repeat.set(1500, 1500);
    const roadTex = makeRoadTexture();
    const concrete = makeConcreteTexture();
    return {
      ground: new MeshStandardMaterial({ map: groundTex, roughness: 1, depthWrite: false }),
      road: new MeshStandardMaterial({ map: roadTex, roughness: 0.9 }),
      cross: new MeshStandardMaterial({ color: "#45484d", roughness: 0.92, depthWrite: false }),
      kerb: new MeshStandardMaterial({ color: "#bdb8ad", map: concrete, roughness: 0.95 }),
      footpath: new MeshStandardMaterial({ color: "#a9a397", map: concrete, roughness: 0.95 }),
    };
  }, []);

  const groundGeo = useMemo(() => {
    const g = new PlaneGeometry(60000, 60000);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);

  // The corridor road runs only under the viaduct; over tunnels the real streets (world tiles) take over.
  const corridor = useMemo(() => {
    const out: [number, number][] = [];
    const railAt = route.profile.railAt;
    for (let d = range[0]; d < range[1]; d += 5) {
      if (railAt(d) < 4) continue;
      const last = out[out.length - 1];
      if (last && d - last[1] <= 5.01) last[1] = Math.min(range[1], d + 5);
      else out.push([d, Math.min(range[1], d + 5)]);
    }
    return out;
  }, [route.profile, range]);

  const roads = useMemo(() => {
    return corridor.flatMap(([c0, c1]) => chunkRanges(c0, c1, 1000)).map(([a, b]) => {
      const road = sweepProfile(alignment, a, b, 6, [
        { l: ROAD.halfWidth, y: 0.03 },
        { l: -ROAD.halfWidth, y: 0.03 },
      ], { uPerMetre: 1 / 12, vPerMetre: 1 / (ROAD.halfWidth * 2) });
      const median = sweepProfile(alignment, a, b, 6, rectProfile(-ROAD.medianHalf, ROAD.medianHalf, 0, 0.24), {
        closed: true,
        uPerMetre: 1 / 6,
      });
      const paths: BufferGeometry[] = [];
      for (const s of [-1, 1]) {
        const l0 = s * ROAD.halfWidth;
        const l1 = s * (ROAD.halfWidth + ROAD.sidewalk);
        paths.push(
          sweepProfile(alignment, a, b, 6, rectProfile(Math.min(l0, l1), Math.max(l0, l1), 0, ROAD.kerb), {
            closed: true,
            uPerMetre: 1 / 4,
            vPerMetre: 1 / 4,
          }),
        );
      }
      return { key: `${a}`, road, median, paths: mergeGeometries(paths)! };
    });
  }, [alignment, corridor]);

  // Street and Mount–Poonamallee Road beneath the Line 5 branch.
  const branchRoads = useMemo(() => {
    const layout = branchLayout(route);
    if (!layout) return [];
    return layout.roads.map((r) =>
      sweepProfile(r.alignment, r.from, r.to, 4, [
        { l: r.width / 2, y: 0.02 },
        { l: -r.width / 2, y: 0.02 },
      ]),
    );
  }, [route]);

  const cross = useMemo(() => {
    if (!crossStreets.length) return null;
    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new InstancedMesh(geo, materials.cross, crossStreets.length * 2);
    const p = { x: 0, z: 0 };
    const m = new Matrix4();
    let i = 0;
    for (const d of crossStreets) {
      // Plane x (width) runs along the main road, z (length) across it: yaw = road heading.
      const yaw = alignment.heading(d);
      for (const s of [-1, 1]) {
        alignment.offsetPoint(d, s * (ROAD.halfWidth + 230), p);
        composeMatrix(m, p.x, 0.02, p.z, yaw, 14, 1, 460);
        mesh.setMatrixAt(i++, m);
      }
    }
    mesh.receiveShadow = true;
    mesh.renderOrder = ORDER.cross;
    mesh.computeBoundingSphere();
    return mesh;
  }, [alignment, crossStreets, materials.cross]);

  const centre = useMemo(() => {
    const b = route.bounds;
    return [(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2] as const;
  }, [route.bounds]);

  const groundColor = useMemo(() => new Color(), []);
  useFrame(() => {
    // Darken and cool the ground slightly in rain.
    groundColor.setRGB(1 - env.rain * 0.25, 1 - env.rain * 0.22, 1 - env.rain * 0.18);
    materials.ground.color.copy(groundColor);
    materials.road.roughness = 0.9 - env.rain * 0.55;
    materials.road.color.setScalar(1 - env.rain * 0.3);
  });

  useEffect(
    () => () => {
      roads.forEach((r) => {
        r.road.dispose();
        r.median.dispose();
        r.paths.dispose();
      });
      cross?.geometry.dispose();
      branchRoads.forEach((g) => g.dispose());
    },
    [roads, cross, branchRoads],
  );

  return (
    <group>
      <mesh geometry={groundGeo} material={materials.ground} position={centre} renderOrder={ORDER.ground} receiveShadow />
      {roads.map((r) => (
        <group key={r.key}>
          <mesh geometry={r.road} material={materials.road} renderOrder={ORDER.road} receiveShadow />
          <mesh geometry={r.median} material={materials.kerb} receiveShadow />
          <mesh geometry={r.paths} material={materials.footpath} receiveShadow />
        </group>
      ))}
      {cross && <primitive object={cross} />}
      {branchRoads.map((g, i) => (
        <mesh key={i} geometry={g} material={materials.cross} renderOrder={ORDER.cross} receiveShadow />
      ))}
    </group>
  );
}
