"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type Material,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useScene } from "./SceneContext.tsx";
import { generateCityChunk, type CityChunk, type InstanceSet } from "./cityGen.ts";
import { createBuildingMaterial } from "./materials.ts";
import { ensureFontsLoaded, makeRadialTexture, makeSignAtlasTexture } from "./textures.ts";
import { SIGN_COLS, SIGN_ROWS, signAtlasNames } from "./shopNames.ts";
import { chunkRanges } from "../utils/geometry.ts";

const CHUNK = 800;

function palmGeometry(): BufferGeometry {
  // Eight drooping fronds around a small crown.
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const frond = new ConeGeometry(0.55, 4.6, 4, 1);
    frond.scale(1, 1, 0.18);
    frond.translate(0, 2.3, 0);
    frond.rotateZ(-Math.PI / 2 + 0.55);
    frond.rotateY((i / 8) * Math.PI * 2);
    parts.push(frond.toNonIndexed());
  }
  const core = new IcosahedronGeometry(0.6, 0);
  parts.push(core);
  for (const p of parts) {
    for (const k of Object.keys(p.attributes)) if (k !== "position" && k !== "normal") p.deleteAttribute(k);
  }
  return mergeGeometries(parts)!;
}

function poleGeometry(): BufferGeometry {
  const pole = new CylinderGeometry(0.09, 0.13, 9.2, 6);
  pole.translate(0, 4.6, 0);
  const arm = new BoxGeometry(0.08, 0.08, 2.2);
  arm.translate(0, 9.1, 1.05);
  const g = mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed()])!;
  return g;
}

/**
 * Shop signboards: one material for every board, sampling its own cell of
 * the sign atlas (per-instance aCell) and glowing softly at night.
 */
function createSignMaterial() {
  const glow = { value: 0 };
  const mat = new MeshStandardMaterial({ color: "#ffffff", roughness: 0.65, metalness: 0 });
  mat.visible = false; // until the atlas is drawn (fonts must load first)
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSignGlow = glow;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aCell;")
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
        #ifdef USE_MAP
          vMapUv = vec2((mod(aCell, ${SIGN_COLS.toFixed(1)}) + vMapUv.x) / ${SIGN_COLS.toFixed(1)}, 1.0 - (floor(aCell / ${SIGN_COLS.toFixed(1)}) + 1.0 - vMapUv.y) / ${SIGN_ROWS.toFixed(1)});
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uSignGlow;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uSignGlow;");
  };
  mat.customProgramCacheKey = () => "cm-sign-v1";
  mat.userData.glow = glow;
  return mat;
}

interface Shared {
  geo: Record<string, BufferGeometry>;
  mat: Record<string, Material>;
}

function useShared(): Shared {
  const { env } = useScene();
  const shared = useMemo<Shared>(() => {
    const box = new BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const tank = new CylinderGeometry(0.62, 0.62, 1.15, 10);
    tank.translate(0, 0.575, 0);
    const trunk = new CylinderGeometry(0.16, 0.22, 1, 5);
    trunk.translate(0, 0.5, 0);
    const crown = new IcosahedronGeometry(1, 0);
    const lamp = new BoxGeometry(0.5, 0.14, 0.9);
    const pool = new PlaneGeometry(1, 1);
    pool.rotateX(-Math.PI / 2);
    const sign = new PlaneGeometry(1, 1);
    const person = new CapsuleGeometry(0.22, 1.12, 2, 6);
    person.translate(0, 0.78, 0);
    const radial = makeRadialTexture();
    return {
      geo: { box, tank, trunk, crown, palm: palmGeometry(), pole: poleGeometry(), lamp, pool, person, sign },
      mat: {
        building: createBuildingMaterial(env),
        tank: new MeshStandardMaterial({ color: "#1f2328", roughness: 0.6 }),
        trunk: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.95 }),
        foliage: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.9, flatShading: true }),
        pole: new MeshStandardMaterial({ color: "#7d848c", roughness: 0.5, metalness: 0.5 }),
        lamp: new MeshStandardMaterial({ color: "#2b2f35", emissive: new Color("#ffd9a0"), emissiveIntensity: 0 }),
        pool: new MeshBasicMaterial({
          map: radial,
          color: "#ffcf8a",
          transparent: true,
          opacity: 0,
          blending: AdditiveBlending,
          depthWrite: false,
          // Lies flat on the road and footpath; draw it over both.
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -12,
        }),
        person: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 }),
        sign: createSignMaterial(),
      },
    };
  }, [env]);

  // Draw the sign atlas once the bundled fonts (incl. Tamil) are ready.
  useEffect(() => {
    let alive = true;
    let tex: Texture | null = null;
    void ensureFontsLoaded().then(() => {
      if (!alive) return;
      tex = makeSignAtlasTexture(signAtlasNames());
      const mat = shared.mat.sign as MeshStandardMaterial;
      mat.map = tex;
      mat.visible = true;
      mat.needsUpdate = true;
    });
    return () => {
      alive = false;
      tex?.dispose();
    };
  }, [shared]);

  useEffect(
    () => () => {
      Object.values(shared.geo).forEach((g) => g.dispose());
      Object.values(shared.mat).forEach((m) => m.dispose());
    },
    [shared],
  );

  useFrame(() => {
    const n = env.night;
    (shared.mat.lamp as MeshStandardMaterial).emissiveIntensity = n * 3.2;
    const pool = shared.mat.pool as MeshBasicMaterial;
    pool.opacity = n * 0.42;
    pool.visible = n > 0.02;
    (shared.mat.sign.userData.glow as { value: number }).value = n * 0.75;
  });
  return shared;
}

function Instanced({
  set,
  geometry,
  material,
  castShadow = false,
  receiveShadow = false,
  building = false,
  cells = false,
}: {
  set: InstanceSet;
  geometry: BufferGeometry;
  material: Material;
  castShadow?: boolean;
  receiveShadow?: boolean;
  building?: boolean;
  /** Per-instance atlas cell (from set.kinds). */
  cells?: boolean;
}) {
  const mesh = useMemo(() => {
    if (!set.count) return null;
    const own = building || cells;
    const geo = own ? geometry.clone() : geometry;
    if (building) {
      geo.setAttribute("aSeed", new InstancedBufferAttribute(set.seeds!, 1));
      geo.setAttribute("aKind", new InstancedBufferAttribute(set.kinds!, 1));
    }
    if (cells) geo.setAttribute("aCell", new InstancedBufferAttribute(set.kinds!, 1));
    const m = new InstancedMesh(geo, material, set.count);
    m.instanceMatrix.array.set(set.matrices);
    m.instanceMatrix.needsUpdate = true;
    if (set.colors) {
      m.instanceColor = new InstancedBufferAttribute(set.colors, 3);
    }
    m.castShadow = castShadow;
    m.receiveShadow = receiveShadow;
    m.computeBoundingSphere();
    m.matrixAutoUpdate = false;
    return m;
  }, [set, geometry, material, castShadow, receiveShadow, building, cells]);

  useEffect(
    () => () => {
      if (mesh && (building || cells)) mesh.geometry.dispose();
      mesh?.dispose();
    },
    [mesh, building, cells],
  );
  return mesh ? <primitive object={mesh} /> : null;
}

function Chunk({ chunk, shared, shadows }: { chunk: CityChunk; shared: Shared; shadows: boolean }) {
  const { geo, mat } = shared;
  return (
    <group>
      <Instanced set={chunk.buildings} geometry={geo.box} material={mat.building} building castShadow={shadows} receiveShadow />
      <Instanced set={chunk.tanks} geometry={geo.tank} material={mat.tank} />
      <Instanced set={chunk.trunks} geometry={geo.trunk} material={mat.trunk} />
      <Instanced set={chunk.crowns} geometry={geo.crown} material={mat.foliage} castShadow={shadows} />
      <Instanced set={chunk.palms} geometry={geo.palm} material={mat.foliage} castShadow={shadows} />
      <Instanced set={chunk.poles} geometry={geo.pole} material={mat.pole} />
      <Instanced set={chunk.lamps} geometry={geo.lamp} material={mat.lamp} />
      <Instanced set={chunk.pools} geometry={geo.pool} material={mat.pool} />
      <Instanced set={chunk.people} geometry={geo.person} material={mat.person} />
      <Instanced set={chunk.signs} geometry={geo.sign} material={mat.sign} cells receiveShadow />
    </group>
  );
}

export function City({ crossStreets, shadows }: { crossStreets: number[]; shadows: boolean }) {
  const { route, range, quality, reportProgress } = useScene();
  const shared = useShared();
  const [chunks, setChunks] = useState<CityChunk[]>([]);
  const cancelled = useRef(false);
  // Progress callback identity must not restart generation.
  const progressRef = useRef(reportProgress);
  useEffect(() => {
    progressRef.current = reportProgress;
  }, [reportProgress]);

  useEffect(() => {
    cancelled.current = false;
    const ranges = chunkRanges(range[0], range[1], CHUNK);
    const out: CityChunk[] = [];
    let i = 0;
    let raf = 0;
    const work = () => {
      if (cancelled.current) return;
      const t0 = performance.now();
      // Generate as many chunks as fit in ~12 ms, then yield to the browser.
      while (i < ranges.length && performance.now() - t0 < 12) {
        const [a, b] = ranges[i++];
        out.push(generateCityChunk(route, a, b, quality, crossStreets));
      }
      progressRef.current?.("environment", i / ranges.length);
      if (i < ranges.length) raf = requestAnimationFrame(work);
      else setChunks([...out]);
    };
    raf = requestAnimationFrame(work);
    return () => {
      cancelled.current = true;
      cancelAnimationFrame(raf);
    };
  }, [route, range, quality, crossStreets]);

  return (
    <group>
      {chunks.map((c) => (
        <Chunk key={c.key} chunk={c} shared={shared} shadows={shadows} />
      ))}
    </group>
  );
}
