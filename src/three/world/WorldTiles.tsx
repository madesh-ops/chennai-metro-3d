"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
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
import { TILE_M } from "./tileFormat.ts";
import { unpackGeometry, type PackedInstances, type PackedTile } from "./worldGeometry.ts";
import { routeKeepOutData } from "./keepOut.ts";
import { addTileHeights, removeTileHeights } from "./heightField.ts";
import type { WorkerReply, WorkerRequest } from "./tileWorker.ts";

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

/** Load radius around the camera and the train (m), by quality; tiles unload beyond it plus UNLOAD_SLACK. */
const RADIUS = { high: 1700, medium: 1250, low: 850 } as const;
const UNLOAD_SLACK = 600;
/** The loading screen waits only for the tiles this close to the train; the rest stream in. */
const INITIAL_RADIUS = 650;
/** Building quadrants (500 m) farther than this from the train skip the shadow pass. */
const SHADOW_REACH = 450;
const TREES = { high: 1, medium: 0.7, low: 0.4 } as const;
const MAX_IN_FLIGHT = 4;
/** Main-thread time per frame for wrapping finished tiles in meshes (ms). */
const FRAME_BUDGET = 4;

interface Live {
  key: string;
  tx: number;
  tz: number;
  state: "loading" | "ready" | "built";
  packed?: PackedTile;
  group?: Group;
  /** Building quadrant meshes (shadow casting toggled by distance) and tree meshes. */
  quads: Mesh[];
  trees: InstancedMesh[];
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

function instanced(geo: BufferGeometry, mat: Material, list: PackedInstances): InstancedMesh | null {
  const n = list.matrices.length / 16;
  if (!n) return null;
  const m = new InstancedMesh(geo, mat, n);
  m.instanceMatrix.array.set(list.matrices);
  m.instanceMatrix.needsUpdate = true;
  if (list.colors.length) m.instanceColor = new InstancedBufferAttribute(list.colors, 3);
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  m.computeBoundingSphere();
  return m;
}

function buildGroup(t: Live, p: PackedTile, shared: Shared): Group {
  const group = new Group();
  group.name = `tile ${p.key}`;
  group.matrixAutoUpdate = false;
  if (p.flat) {
    const m = new Mesh(unpackGeometry(p.flat), shared.flat);
    m.receiveShadow = true;
    m.renderOrder = ORDER.cross;
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  for (const b of p.buildings) {
    const m = new Mesh(unpackGeometry(b.geometry), shared.building);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.userData.centre = [b.cx, b.cz];
    group.add(m);
    t.quads.push(m);
  }
  const crowns = instanced(shared.geo.crown, shared.foliage, p.crowns);
  const palms = instanced(shared.geo.palm, shared.foliage, p.palms);
  for (const m of [crowns, palms]) if (m) t.trees.push(m);
  const parts = [instanced(shared.geo.trunk, shared.trunk, p.trunks), crowns, palms, instanced(shared.geo.tank, shared.tank, p.tanks)];
  if (p.signs.cells.length) {
    const geo = shared.geo.sign.clone();
    geo.setAttribute("aCell", new InstancedBufferAttribute(p.signs.cells, 1));
    parts.push(instanced(geo, shared.sign, p.signs));
  }
  for (const m of parts) if (m) group.add(m);
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
 * scripts/osm/bake-tiles.mjs). A worker fetches and builds tiles within
 * RADIUS of the camera or the train; this component only wraps the results
 * in meshes, a few per frame, and disposes far tiles. Reports "world"
 * progress until the tiles right around the train are in.
 */
export function WorldTiles({ shadows }: { shadows: boolean }) {
  const { route, range, env, quality, pose, reportProgress } = useScene();
  const camera = useThree((s) => s.camera);
  const root = useMemo(() => new Group(), []);
  const keepData = useMemo(() => routeKeepOutData(route, range), [route, range]);
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
    live: new Map<string, Live>(),
    lastScan: -1,
    initial: null as Set<string> | null,
    initialAge: 0,
    reported: false,
    failed: false,
    worker: null as Worker | null,
    gen: 0,
    /** The worker has its settings for the current generation. */
    ready: false,
  });

  // The tile worker lives as long as the scene.
  useEffect(() => {
    const s = state.current;
    // Bundled by scripts/build-worker.mjs (Turbopack does not compile worker entry points).
    const w = new Worker(`${BASE}/world/tileWorker.js`);
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const { gen, key, tile, error } = e.data;
      const t = s.live.get(key);
      if (gen !== s.gen || !t || t.state !== "loading") return;
      if (error || !tile) {
        console.warn(`[world] tile ${key} failed`, error);
        t.state = "built"; // counts as done; not retried every scan
        return;
      }
      t.packed = tile;
      t.state = "ready";
    };
    s.worker = w;
    return () => {
      w.terminate();
      s.worker = null;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const s = state.current;
    loadIndex()
      .then((idx) => {
        if (alive) s.index = idx;
      })
      .catch((e) => {
        console.warn("[world] index failed; the city is left out", e);
        s.failed = true;
      });
    return () => {
      alive = false;
    };
  }, []);

  // Send the worker its build settings, and drop every tile, when the route (keep-out) or quality changes.
  useEffect(() => {
    const s = state.current;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      if (!s.worker || !s.index) {
        requestAnimationFrame(start);
        return;
      }
      s.gen++;
      const msg: WorkerRequest = { type: "init", gen: s.gen, base: BASE, palette: s.index.palette, keep: keepData, signCells: SIGN_CELLS, treeDensity: TREES[quality] };
      s.worker.postMessage(msg);
      s.ready = true;
    };
    start();
    return () => {
      cancelled = true;
      for (const t of s.live.values()) {
        if (t.group) {
          root.remove(t.group);
          disposeGroup(t.group, shared);
        }
        removeTileHeights(t.key);
      }
      s.live.clear();
      s.initial = null;
      s.ready = false;
      s.gen++;
    };
  }, [root, shared, keepData, quality]);

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
    (shared.sign.userData.glow as { value: number }).value = env.night * 0.75;
    shared.flat.color.setScalar(1 - env.rain * 0.28);
    shared.flat.roughness = 0.93 - env.rain * 0.5;

    if (s.failed) {
      if (!s.reported) {
        s.reported = true;
        progressRef.current?.("world", 1);
      }
      return;
    }
    if (!s.index || !s.worker || !s.ready) return;

    const train = pose.cars[Math.floor(pose.cars.length / 2)]?.position;
    const trainKnown = Boolean(train && (train.x !== 0 || train.z !== 0));
    const rectDist = (tx: number, tz: number, x: number, z: number) =>
      Math.hypot(Math.max(tx * TILE_M - x, 0, x - (tx + 1) * TILE_M), Math.max(tz * TILE_M - z, 0, z - (tz + 1) * TILE_M));

    // Which tiles should be live: near the camera or the train.
    s.lastScan -= delta;
    if (s.lastScan <= 0 && trainKnown) {
      s.lastScan = 0.4;
      const focus: [number, number][] = [
        [train.x, train.z],
        [camera.position.x, camera.position.z],
      ];
      const R = RADIUS[quality];
      const dist = (tx: number, tz: number) => Math.min(...focus.map(([x, z]) => rectDist(tx, tz, x, z)));
      const want = s.index.tiles.filter(([tx, tz]) => dist(tx, tz) <= R).sort((a, b) => dist(a[0], a[1]) - dist(b[0], b[1]));
      // The loading screen waits for the tiles around the train only (not the camera's start-up spot).
      if (!s.initial) {
        s.initial = new Set(s.index.tiles.filter(([tx, tz]) => rectDist(tx, tz, train.x, train.z) <= INITIAL_RADIUS).map(([tx, tz]) => `${tx}_${tz}`));
      }
      let inFlight = 0;
      for (const t of s.live.values()) if (t.state === "loading") inFlight++;
      for (const [tx, tz] of want) {
        const key = `${tx}_${tz}`;
        if (s.live.has(key) || inFlight >= MAX_IN_FLIGHT) continue;
        s.live.set(key, { key, tx, tz, state: "loading", quads: [], trees: [] });
        const msg: WorkerRequest = { type: "tile", gen: s.gen, key };
        s.worker.postMessage(msg);
        inFlight++;
      }
      for (const t of [...s.live.values()]) {
        if (dist(t.tx, t.tz) <= R + UNLOAD_SLACK) continue;
        if (t.group) {
          root.remove(t.group);
          disposeGroup(t.group, shared);
        }
        removeTileHeights(t.key);
        s.live.delete(t.key);
      }
      // Only buildings and trees near the train cast shadows (the shadow map covers ~150 m anyway).
      for (const t of s.live.values()) {
        for (const m of t.quads) {
          const [cx, cz] = m.userData.centre as [number, number];
          m.castShadow = shadows && Math.hypot(cx - train.x, cz - train.z) < SHADOW_REACH;
        }
        const near = shadows && rectDist(t.tx, t.tz, train.x, train.z) < 200;
        for (const m of t.trees) m.castShadow = near;
      }
    }

    // Wrap finished tiles in meshes, within a small budget per frame.
    const t0 = performance.now();
    for (const t of s.live.values()) {
      if (t.state !== "ready" || !t.packed) continue;
      t.group = buildGroup(t, t.packed, shared);
      t.group.updateMatrixWorld(true);
      root.add(t.group);
      const { rings, offsets, h } = t.packed.heights;
      addTileHeights(
        t.key,
        Array.from(h, (height, i) => ({ height, ring: rings.subarray(offsets[i], offsets[i + 1]) })),
      );
      t.state = "built";
      t.packed = undefined;
      s.lastScan = Math.min(s.lastScan, 0); // set shadow flags for the new tile right away
      if (performance.now() - t0 > FRAME_BUDGET) break;
    }

    if (s.initial && !s.reported) {
      s.initialAge += delta;
      let done = 0;
      // Built, failed, or dropped again (out of range): nothing more to wait for.
      for (const k of s.initial) if (!s.live.has(k) || s.live.get(k)!.state === "built") done++;
      // Never hold the ride hostage to a slow network: stop waiting after 20 s.
      const p = s.initial.size && s.initialAge < 20 ? done / s.initial.size : 1;
      progressRef.current?.("world", p);
      if (p >= 1) s.reported = true;
    }
  });

  return <primitive object={root} />;
}
