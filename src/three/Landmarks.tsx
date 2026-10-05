"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { Color, Matrix4, MeshStandardMaterial, PlaneGeometry, type Texture } from "three";
import { useScene } from "./SceneContext.tsx";
import { landmarkFootprints, type LandmarkFootprint } from "./landmarkLayout.ts";
import { buildLandmarkModel, type LandmarkModel } from "./landmarkModels.ts";
import { ensureFontsLoaded, makeLandmarkPanelTexture, makeNameBoardTexture, type BoardStyle } from "./textures.ts";
import { composeMatrix } from "../utils/geometry.ts";
import { hashString } from "../utils/random.ts";
import type { LandmarkModelType } from "../simulation/types.ts";

const BOARD_STYLE: Record<LandmarkModelType, BoardStyle> = {
  temple: "temple",
  lake: "nature",
  hospital: "civic",
  "bus-stand": "transport",
  depot: "transport",
  mall: "civic",
  cinema: "civic",
  "glass-mall": "civic",
};

/** Shallow water with a gentle moving ripple in the normals. */
function createWaterMaterial(uTime: { value: number }) {
  const mat = new MeshStandardMaterial({ color: "#3b7684", roughness: 0.12, metalness: 0.25 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vLmPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLmPos = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vLmPos;\nuniform float uTime;")
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        vec3 lmRipple = vec3(sin(vLmPos.x * 0.21 + uTime * 0.9) + sin(vLmPos.y * 0.13 - uTime * 0.6), 0.0, cos(vLmPos.y * 0.17 + uTime * 0.7) + cos(vLmPos.x * 0.11 + uTime * 0.5));
        normal = normalize(normal + (viewMatrix * vec4(lmRipple * 0.025, 0.0)).xyz);`,
      );
  };
  mat.customProgramCacheKey = () => "cm-water-v1";
  return mat;
}

function NameBoard({ footprint, model, matrix }: { footprint: LandmarkFootprint; model: LandmarkModel; matrix: Matrix4 }) {
  const { env } = useScene();
  const lm = footprint.placement.landmark;
  const [texture, setTexture] = useState<Texture | null>(null);
  useEffect(() => {
    let alive = true;
    let tex: Texture | null = null;
    void ensureFontsLoaded().then(() => {
      if (!alive) return;
      tex = makeNameBoardTexture(lm.name, lm.nameTa ?? null, BOARD_STYLE[footprint.placement.type]);
      setTexture(tex);
    });
    return () => {
      alive = false;
      tex?.dispose();
    };
  }, [lm, footprint.placement.type]);

  const geometry = useMemo(() => {
    const b = model.board ?? { x: 0, y: 0, z: 0, w: 1, h: 1 };
    const g = new PlaneGeometry(b.w, b.h);
    g.rotateY(Math.PI); // face -z, towards the road
    g.translate(b.x, b.y, b.z);
    return g;
  }, [model]);
  const material = useMemo(
    () => (texture ? new MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: new Color("#ffffff"), emissiveIntensity: 0, roughness: 0.6 }) : null),
    [texture],
  );
  useFrame(() => {
    if (material) material.emissiveIntensity = 0.12 + env.night * 0.7;
  });
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material?.dispose(), [material]);
  if (!material) return null;
  return <mesh geometry={geometry} material={material} matrix={matrix} matrixAutoUpdate={false} />;
}

/** Signs, hoardings and posters on the mall and cinema, lit at night. */
function Panels({ model, matrix }: { model: LandmarkModel; matrix: Matrix4 }) {
  const { env } = useScene();
  const [textures, setTextures] = useState<Texture[] | null>(null);
  const panels = model.panels;
  useEffect(() => {
    if (!panels?.length) return;
    let alive = true;
    let made: Texture[] = [];
    void ensureFontsLoaded().then(() => {
      if (!alive) return;
      made = panels.map((p) => makeLandmarkPanelTexture(p.texture));
      setTextures(made);
    });
    return () => {
      alive = false;
      made.forEach((t) => t.dispose());
    };
  }, [panels]);
  const parts = useMemo(() => {
    if (!panels || !textures) return null;
    return panels.map((p, i) => {
      const g = new PlaneGeometry(p.w, p.h);
      g.rotateY(Math.PI); // face -z, towards the road
      g.translate(p.x, p.y, p.z);
      const m = new MeshStandardMaterial({ map: textures[i], emissiveMap: textures[i], emissive: new Color("#ffffff"), emissiveIntensity: 0, roughness: 0.55 });
      return { g, m };
    });
  }, [panels, textures]);
  useFrame(() => {
    if (!parts) return;
    const glow = 0.08 + env.night * 0.85;
    for (const p of parts) p.m.emissiveIntensity = glow;
  });
  useEffect(
    () => () =>
      parts?.forEach((p) => {
        p.g.dispose();
        p.m.dispose();
      }),
    [parts],
  );
  if (!parts) return null;
  return (
    <>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.g} material={p.m} matrix={matrix} matrixAutoUpdate={false} />
      ))}
    </>
  );
}

/**
 * Real public landmarks (temples, lake, hospital, bus stands, the metro
 * depot) as stylised models with English and Tamil name boards, placed from
 * landmarks.json. The city generator keeps their footprints clear.
 */
export function Landmarks({ shadows }: { shadows: boolean }) {
  const { route, range, env } = useScene();
  const items = useMemo(() => {
    return landmarkFootprints(route)
      .filter((f) => f.distance + f.along / 2 > range[0] && f.distance - f.along / 2 < range[1])
      .map((f) => {
        const p = f.placement;
        const model = buildLandmarkModel(p.type, p.along, p.depth, p.height, hashString(p.landmark.id) % 1000);
        const pt = route.alignment.offsetPoint(f.distance, f.lateral);
        // Models face -z; turn them so the front looks at the road.
        const yaw = route.alignment.heading(f.distance) + (f.side < 0 ? Math.PI : 0);
        const matrix = composeMatrix(new Matrix4(), pt.x, 0, pt.z, yaw);
        return { f, model, matrix };
      });
  }, [route, range]);

  const materials = useMemo(
    () => ({
      solid: new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 }),
      water: createWaterMaterial(env.uniforms.uTime),
      // Curtain-wall glass: reflective by day, lit from inside at night.
      glass: new MeshStandardMaterial({ color: "#4f8f9c", metalness: 0.55, roughness: 0.14, emissive: new Color("#bfe3ea"), emissiveIntensity: 0 }),
    }),
    [env],
  );

  useEffect(
    () => () => {
      for (const it of items) {
        it.model.solid.dispose();
        it.model.water?.geometry.dispose();
        it.model.glass?.dispose();
      }
    },
    [items],
  );
  useEffect(
    () => () => {
      materials.solid.dispose();
      materials.water.dispose();
      materials.glass.dispose();
    },
    [materials],
  );

  useFrame(() => {
    materials.glass.emissiveIntensity = env.night * 0.45;
  });

  // Dev-only: frame a landmark from a script (used for visual checks).
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __cm3dLandmarks?: () => unknown };
    w.__cm3dLandmarks = () =>
      items.map(({ f, matrix }) => {
        const road = route.alignment.point(f.distance);
        return { id: f.placement.landmark.id, x: matrix.elements[12], z: matrix.elements[14], roadX: road.x, roadZ: road.z, along: f.along, depth: f.depth };
      });
    return () => {
      delete w.__cm3dLandmarks;
    };
  }, [items, route]);

  return (
    <group>
      {items.map(({ f, model, matrix }) => (
        <group key={f.placement.landmark.id}>
          <mesh geometry={model.solid} material={materials.solid} matrix={matrix} matrixAutoUpdate={false} castShadow={shadows} receiveShadow />
          {model.water && <mesh geometry={model.water.geometry} material={materials.water} matrix={matrix} matrixAutoUpdate={false} receiveShadow />}
          {model.glass && <mesh geometry={model.glass} material={materials.glass} matrix={matrix} matrixAutoUpdate={false} receiveShadow />}
          {model.board && <NameBoard footprint={f} model={model} matrix={matrix} />}
          {model.panels && <Panels model={model} matrix={matrix} />}
        </group>
      ))}
    </group>
  );
}
