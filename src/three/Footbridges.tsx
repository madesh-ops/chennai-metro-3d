"use client";

import { useEffect, useMemo } from "react";
import { DoubleSide, Matrix4, MeshStandardMaterial } from "three";
import { useScene } from "./SceneContext.tsx";
import { buildFootbridge } from "./footbridgeModel.ts";
import { makeDiamondPanelTexture } from "./textures.ts";
import { dataBundle } from "../simulation/data.ts";

/**
 * Curated footbridges at stations (tracks.json structures.footbridges):
 * covered steel trusses from the concourse across the road below.
 */
export function Footbridges() {
  const { route, range } = useScene();
  const items = useMemo(() => {
    const out: { id: string; geo: ReturnType<typeof buildFootbridge>; matrix: Matrix4 }[] = [];
    for (const f of dataBundle.tracks.structures.footbridges ?? []) {
      const st = route.stationById.get(f.station);
      if (!st) continue;
      const d = st.distance + f.alongM;
      if (d < range[0] || d > range[1]) continue;
      // Which lateral direction is the named side (south = +z, north = -z, east = +x, west = -x)?
      const c = route.alignment.point(d);
      const r = route.alignment.offsetPoint(d, 10);
      const dir = { south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0] }[f.side];
      const sign = (r.x - c.x) * dir[0] + (r.z - c.z) * dir[1] >= 0 ? 1 : -1;
      const start = route.alignment.offsetPoint(d, sign * f.fromLateralM);
      const end = route.alignment.offsetPoint(d, sign * f.toLateralM);
      const len = Math.hypot(end.x - start.x, end.z - start.z);
      const geo = buildFootbridge({
        length: len,
        width: f.widthM,
        floor: f.floorM,
        supports: f.supportsAtM.map((m) => m - f.fromLateralM),
        tower: { size: f.tower.sizeM, height: f.tower.heightM },
      });
      // Local +x runs from the station to the tower.
      const yaw = Math.atan2(-(end.z - start.z), end.x - start.x);
      const matrix = new Matrix4().makeRotationY(yaw).setPosition(start.x, 0, start.z);
      out.push({ id: f.id, geo, matrix });
    }
    return out;
  }, [route, range]);

  const mats = useMemo(
    () => ({
      steel: new MeshStandardMaterial({ color: "#eef0f1", roughness: 0.45, metalness: 0.3 }),
      floor: new MeshStandardMaterial({ color: "#a9a59d", roughness: 0.9 }),
      roof: new MeshStandardMaterial({ map: makeDiamondPanelTexture(), roughness: 0.55, metalness: 0.2, side: DoubleSide }),
      tower: new MeshStandardMaterial({ color: "#7c8188", roughness: 0.7, metalness: 0.15 }),
    }),
    [],
  );

  useEffect(
    () => () => {
      for (const it of items) Object.values(it.geo).forEach((g) => g.dispose());
    },
    [items],
  );
  useEffect(
    () => () => {
      mats.roof.map?.dispose();
      Object.values(mats).forEach((m) => m.dispose());
    },
    [mats],
  );

  return (
    <group>
      {items.map((it) => (
        <group key={it.id} matrix={it.matrix} matrixAutoUpdate={false}>
          <mesh geometry={it.geo.steel} material={mats.steel} castShadow receiveShadow />
          <mesh geometry={it.geo.floor} material={mats.floor} castShadow receiveShadow />
          <mesh geometry={it.geo.roof} material={mats.roof} castShadow receiveShadow />
          <mesh geometry={it.geo.tower} material={mats.tower} castShadow receiveShadow />
        </group>
      ))}
    </group>
  );
}
