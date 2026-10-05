"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Material,
  type Texture,
} from "three";
import { useScene } from "../SceneContext.tsx";
import { createFootprintBuildingMaterial } from "../materials.ts";
import { createSignMaterial, palmGeometry } from "../City.tsx";
import { ORDER } from "../Ground.tsx";
import { ensureFontsLoaded, makeSignAtlasTexture } from "../textures.ts";
import { SIGN_CELLS, signAtlasNames } from "../shopNames.ts";
import { decodeTile, TILE_M, type TileData } from "./tileFormat.ts";
import { blocked, buildTileGeometry, type InstanceList, type KeepOut } from "./worldGeometry.ts";
import { addTileHeights, removeTileHeights } from "./heightField.ts";
import { routeKeepOut } from "./keepOut.ts";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

interface WorldIndex {
  palette: string[];
  tiles: [number, number, number][];
}

let indexPromise: Promise<WorldIndex> | null = null;
function loadIndex(): Promise<WorldIndex> {
  indexPromise ??= fetch(`${BASE}/world/index.json`).then((r) => {
    if (!r.ok) throw new Error(`world index: HTTP ${r.status}`);
    return r.json() as Promise<WorldIndex>;
  });
  return indexPromise;
}

async function loadTile(key: string, signal: AbortSignal): Promise<TileData> {
  const res = await fetch(`${BASE}/world/tiles/${key}.bin`, { signal });
  if (!res.ok) throw new Error(`tile ${key}: HTTP ${res.status}`);
  let buf = await res.arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  // Stored gzip-compressed; a server may already have undone that in transit.
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    buf = await new Response(stream).arrayBuffer();
  }
  return decodeTile(buf);
}

/** Load radius around the camera and the train (m), by quality; tiles unload beyond it plus UNLOAD_SLACK. */
const RADIUS = { high: 1700, medium: 1250, low: 850 } as const;
const UNLOAD_SLACK = 600;
const TREES = { high: 1, medium: 0.7, low: 0.4 } as const;
const MAX_FETCHES = 4;

interface Live {
  key: string;
  tx: number;
  tz: number;
  state: "loading" | "ready" | "built";
  data?: TileData;
  group?: Group;
  abort: AbortController;
}

interface Shared {
  building: MeshStandardMaterial;
  flat: MeshStandardMaterial;
  trunk: MeshStandardMaterial;
  foliage: MeshStandardMaterial;
  tank: MeshStandardMaterial;
  sign: MeshStandardMaterial;
  geo: { trunk: BufferGeometry; crown: BufferGeometry; palm: BufferGeometry; tank: BufferGeometry; sign: BufferGeometry };
}

function instanced(geo: BufferGeometry, mat: Material, list: InstanceList, cast: boolean): InstancedMesh | null {
  const n = list.matrices.length / 16;
  if (!n) return null;
  const m = new InstancedMesh(geo, mat, n);
  m.instanceMatrix.array.set(list.matrices);
  m.instanceMatrix.needsUpdate = true;
  if (list.colors.length) m.instanceColor = new InstancedBufferAttribute(new Float32Array(list.colors), 3);
  m.castShadow = cast;
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  m.computeBoundingSphere();
  return m;
}

function buildGroup(data: TileData, shared: Shared, palette: Color[], keep: KeepOut, quality: keyof typeof RADIUS, shadows: boolean): Group {
  const g = buildTileGeometry(data, { palette, keep, signCells: SIGN_CELLS, treeDensity: TREES[quality] });
  const group = new Group();
  group.name = `tile ${data.tx}_${data.tz}`;
  group.matrixAutoUpdate = false;
  if (g.flat) {
    const m = new Mesh(g.flat, shared.flat);
    m.receiveShadow = true;
    m.renderOrder = ORDER.cross;
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  if (g.buildings) {
    const m = new Mesh(g.buildings, shared.building);
    m.castShadow = shadows;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  const parts = [
    instanced(shared.geo.trunk, shared.trunk, g.trunks, false),
    instanced(shared.geo.crown, shared.foliage, g.crowns, shadows),
    instanced(shared.geo.palm, shared.foliage, g.palms, shadows),
    instanced(shared.geo.tank, shared.tank, g.tanks, false),
  ];
  if (g.signs.cells.length) {
    const geo = shared.geo.sign.clone();
    geo.setAttribute("aCell", new InstancedBufferAttribute(new Float32Array(g.signs.cells), 1));
    parts.push(instanced(geo, shared.sign, g.signs, false));
  }
  for (const p of parts) if (p) group.add(p);
  return group;
}

function disposeGroup(group: Group, shared: Shared) {
  const own = new Set(Object.values(shared.geo));
  group.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    if (!own.has(m.geometry)) m.geometry.dispose();
    if ((m as InstancedMesh).isInstancedMesh) (m as InstancedMesh).dispose();
  });
}

/**
 * The real city around the line, streamed in 1 km tiles from
 * public/world (OpenStreetMap footprints, roads, water, parks and trees; see
 * scripts/osm/bake-tiles.mjs). Tiles within RADIUS of the camera or the
 * train load in the background and are built one per frame; far ones are
 * disposed. Reports "world" progress until the first set around the train
 * has been built.
 */
export function WorldTiles({ shadows }: { shadows: boolean }) {
  const { route, range, env, quality, pose, reportProgress } = useScene();
  const camera = useThree((s) => s.camera);
  const root = useMemo(() => new Group(), []);
  const keep = useMemo(() => routeKeepOut(route, range), [route, range]);
  const progressRef = useRef(reportProgress);
  useEffect(() => {
    progressRef.current = reportProgress;
  }, [reportProgress]);

  const shared = useMemo<Shared>(() => {
    const trunk = new CylinderGeometry(0.16, 0.22, 1, 5);
    trunk.translate(0, 0.5, 0);
    const tank = new CylinderGeometry(0.62, 0.62, 1.15, 10);
    tank.translate(0, 0.575, 0);
    return {
      building: createFootprintBuildingMaterial(env),
      flat: new MeshStandardMaterial({ vertexColors: true, roughness: 0.93, depthWrite: false }),
      trunk: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.95 }),
      foliage: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.9, flatShading: true }),
      tank: new MeshStandardMaterial({ color: "#1f2328", roughness: 0.6 }),
      sign: createSignMaterial(),
      geo: { trunk, crown: new IcosahedronGeometry(1, 0), palm: palmGeometry(), tank, sign: new PlaneGeometry(1, 1) },
    };
  }, [env]);

  // Shop-sign atlas once the bundled fonts (incl. Tamil) are ready.
  useEffect(() => {
    let alive = true;
    let tex: Texture | null = null;
    void ensureFontsLoaded().then(() => {
      if (!alive) return;
      tex = makeSignAtlasTexture(signAtlasNames());
      shared.sign.map = tex;
      shared.sign.visible = true;
      shared.sign.needsUpdate = true;
    });
    return () => {
      alive = false;
      tex?.dispose();
    };
  }, [shared]);

  const state = useRef({
    index: null as WorldIndex | null,
    palette: [] as Color[],
    live: new Map<string, Live>(),
    lastScan: -1,
    initial: null as Set<string> | null,
    initialAge: 0,
    reported: false,
    failed: false,
  });

  useEffect(() => {
    let alive = true;
    const s = state.current;
    loadIndex()
      .then((idx) => {
        if (!alive) return;
        s.index = idx;
        s.palette = idx.palette.map((c) => new Color(c));
      })
      .catch((e) => {
        console.warn("[world] index failed; the city is left out", e);
        s.failed = true;
      });
    return () => {
      alive = false;
    };
  }, []);

  // Rebuild everything when the route (keep-out), quality or shadows change.
  useEffect(() => {
    const s = state.current;
    return () => {
      for (const t of s.live.values()) {
        t.abort.abort();
        if (t.group) {
          root.remove(t.group);
          disposeGroup(t.group, shared);
        }
        removeTileHeights(t.key);
      }
      s.live.clear();
      s.initial = null;
    };
  }, [root, shared, keep, quality, shadows]);

  // Dev-only: tile status and the train position for scripted visual checks.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __cm3dWorld?: () => unknown };
    w.__cm3dWorld = () => {
      const s = state.current;
      const car = pose.cars[Math.floor(pose.cars.length / 2)].position;
      return { train: [car.x, car.z], tiles: [...s.live.values()].map((t) => `${t.key}:${t.state}`) };
    };
    return () => {
      delete w.__cm3dWorld;
    };
  }, [pose]);

  useEffect(
    () => () => {
      Object.values(shared.geo).forEach((g) => g.dispose());
      [shared.building, shared.flat, shared.trunk, shared.foliage, shared.tank, shared.sign].forEach((m) => m.dispose());
    },
    [shared],
  );

  useFrame((_, delta) => {
    const s = state.current;
    const night = env.night;
    (shared.sign.userData.glow as { value: number }).value = night * 0.75;
    shared.flat.color.setScalar(1 - env.rain * 0.28);
    shared.flat.roughness = 0.93 - env.rain * 0.5;

    if (s.failed) {
      if (!s.reported) {
        s.reported = true;
        progressRef.current?.("world", 1);
      }
      return;
    }
    if (!s.index) return;

    // Which tiles should be live: near the camera or the train.
    s.lastScan -= delta;
    if (s.lastScan <= 0) {
      s.lastScan = 0.4;
      const train = pose.cars[Math.floor(pose.cars.length / 2)]?.position;
      const focus: [number, number][] = [[camera.position.x, camera.position.z]];
      if (train && (train.x !== 0 || train.z !== 0)) focus.push([train.x, train.z]);
      const R = RADIUS[quality];
      const dist = (tx: number, tz: number) => {
        let best = Infinity;
        for (const [x, z] of focus) {
          const dx = Math.max(tx * TILE_M - x, 0, x - (tx + 1) * TILE_M);
          const dz = Math.max(tz * TILE_M - z, 0, z - (tz + 1) * TILE_M);
          best = Math.min(best, Math.hypot(dx, dz));
        }
        return best;
      };
      const want = s.index.tiles.filter(([tx, tz]) => dist(tx, tz) <= R).sort((a, b) => dist(a[0], a[1]) - dist(b[0], b[1]));
      if (!s.initial && focus.length > 1) s.initial = new Set(want.map(([tx, tz]) => `${tx}_${tz}`));
      let fetching = [...s.live.values()].filter((t) => t.state === "loading").length;
      for (const [tx, tz] of want) {
        const key = `${tx}_${tz}`;
        if (s.live.has(key) || fetching >= MAX_FETCHES) continue;
        const t: Live = { key, tx, tz, state: "loading", abort: new AbortController() };
        s.live.set(key, t);
        fetching++;
        loadTile(key, t.abort.signal)
          .then((data) => {
            if (s.live.get(key) !== t) return;
            t.data = data;
            t.state = "ready";
          })
          .catch((e) => {
            if (t.abort.signal.aborted) return;
            console.warn(`[world] tile ${key} failed`, e);
            // Leave it marked so it is not retried every scan; it counts as done.
            t.state = "built";
          });
      }
      for (const t of [...s.live.values()]) {
        if (dist(t.tx, t.tz) <= R + UNLOAD_SLACK) continue;
        t.abort.abort();
        if (t.group) {
          root.remove(t.group);
          disposeGroup(t.group, shared);
        }
        removeTileHeights(t.key);
        s.live.delete(t.key);
      }
    }

    // Build ready tiles, nearest first, within a small time budget per frame.
    const t0 = performance.now();
    for (const t of s.live.values()) {
      if (t.state !== "ready" || !t.data) continue;
      t.group = buildGroup(t.data, shared, s.palette, keep, quality, shadows);
      addTileHeights(t.key, t.data.buildings.filter((b) => !blocked(b, keep)));
      t.group.updateMatrixWorld(true);
      root.add(t.group);
      t.state = "built";
      t.data = undefined;
      if (performance.now() - t0 > 8) break;
    }

    if (s.initial && !s.reported) {
      s.initialAge += delta;
      let done = 0;
      for (const k of s.initial) if (s.live.get(k)?.state === "built") done++;
      // Never hold the ride hostage to a slow network: give up waiting after 30 s.
      const p = s.initial.size && s.initialAge < 30 ? done / s.initial.size : 1;
      progressRef.current?.("world", p);
      if (p >= 1) s.reported = true;
    }
  });

  return <primitive object={root} />;
}
