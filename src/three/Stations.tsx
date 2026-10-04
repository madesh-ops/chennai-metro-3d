"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type Material,
  type Texture,
} from "three";
import { useScene } from "./SceneContext.tsx";
import { buildSignBoards, buildStation, type StationDims, type StationGeometry } from "./stationModel.ts";
import { ensureFontsLoaded, makeConcreteTexture, makeRadialTexture, makeStationSignTexture } from "./textures.ts";
import { composeMatrix } from "../utils/geometry.ts";
import { mulberry32, range as rr } from "../utils/random.ts";
import type { StationModel } from "../simulation/RouteController.ts";
import { crowdFactor } from "../simulation/crowd.ts";
import { useViewStore } from "../simulation/store.ts";
import { useHour } from "./CabinPeople.tsx";

export interface StationSignalState {
  /** Station id where our train currently holds a red signal, if any. */
  holdAt: string | null;
}

const LIT = new Color("#fff1d6");
const DARK = new Color("#2a2d31");

function stationMatrix(st: StationModel, alignment: ReturnType<typeof useScene>["route"]["alignment"]) {
  const p = alignment.point(st.distance);
  return composeMatrix(new Matrix4(), p.x, 0, p.z, alignment.heading(st.distance));
}

function VariantMeshes({
  geo,
  stations,
  mats,
}: {
  geo: StationGeometry;
  stations: StationModel[];
  mats: Record<string, Material>;
}) {
  const { route } = useScene();
  const meshes = useMemo(() => {
    if (!stations.length) return [];
    const matrices = stations.map((s) => stationMatrix(s, route.alignment));
    const make = (g: BufferGeometry, m: Material, cast = false, perInstanceLit = false) => {
      const mesh = new InstancedMesh(g, m, stations.length);
      matrices.forEach((mx, i) => mesh.setMatrixAt(i, mx));
      if (perInstanceLit) {
        const colors = new Float32Array(stations.length * 3);
        stations.forEach((s, i) => (s.service === "stop" ? LIT : DARK).toArray(colors, i * 3));
        mesh.instanceColor = new InstancedBufferAttribute(colors, 3);
      }
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      return mesh;
    };
    return [
      make(geo.concrete, mats.concrete, true),
      make(geo.platformTop, mats.platformTop),
      make(geo.tactile, mats.tactile),
      make(geo.roof, mats.roof, true),
      make(geo.steel, mats.steel),
      make(geo.glass, mats.glass),
      make(geo.facade, mats.facade),
      make(geo.lights, mats.lights, false, true),
    ];
  }, [geo, stations, mats, route.alignment]);
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

function SignBoards({ station, geometry, lineColour }: { station: StationModel; geometry: BufferGeometry; lineColour: string }) {
  const { route } = useScene();
  const [texture, setTexture] = useState<Texture | null>(null);
  useEffect(() => {
    let alive = true;
    let tex: Texture | null = null;
    ensureFontsLoaded().then(() => {
      if (!alive) return;
      tex = makeStationSignTexture(station.name, station.nameTa, lineColour, station.service === "stop");
      setTexture(tex);
    });
    return () => {
      alive = false;
      tex?.dispose();
    };
  }, [station, lineColour]);
  const material = useMemo(
    () => (texture ? new MeshBasicMaterial({ map: texture, toneMapped: false, side: DoubleSide }) : null),
    [texture],
  );
  const matrix = useMemo(() => stationMatrix(station, route.alignment), [station, route.alignment]);
  if (!material) return null;
  return <mesh geometry={geometry} material={material} matrix={matrix} matrixAutoUpdate={false} />;
}

export function Stations({ signal }: { signal?: StationSignalState }) {
  const { route, range, env, quality } = useScene();
  const { params, alignment, line } = route;

  const dims: StationDims = useMemo(
    () => ({
      rail: params.railLevel,
      platformLength: params.platformLength,
      platformHeight: params.platformHeight,
      trackCentres: params.trackCentres,
      upperDeck: params.upperDeckHeight,
    }),
    [params],
  );

  const inRange = useMemo(
    () => route.stations.filter((s) => s.distance > range[0] - 80 && s.distance < range[1] + 80),
    [route.stations, range],
  );
  // Stations with a flyover running beneath them get split side concourses.
  const overFlyover = useMemo(
    () => new Set(inRange.filter((s) => route.flyovers.some((f) => s.distance > f.corridorFrom && s.distance < f.corridorTo)).map((s) => s.id)),
    [inRange, route.flyovers],
  );
  const single = useMemo(() => inRange.filter((s) => !s.doubleDecker && !overFlyover.has(s.id)), [inRange, overFlyover]);
  const double = useMemo(() => inRange.filter((s) => s.doubleDecker), [inRange]);
  const flyover = useMemo(() => inRange.filter((s) => !s.doubleDecker && overFlyover.has(s.id)), [inRange, overFlyover]);

  const geos = useMemo(
    () => ({
      single: buildStation(dims, false),
      double: buildStation(dims, true),

      // Line 4 runs on the lower deck of the two-tier stretch, so boards stay at rail level.
      boards: buildSignBoards(dims, dims.rail),
    }),
    [dims],
  );

  // Over a flyover each station gets its own geometry: supports and stairs skip the deck below.
  const flyoverGeos = useMemo(
    () =>
      flyover.map((station) => {
        const p0 = alignment.point(station.distance);
        const t = alignment.tangent(station.distance);
        const r = alignment.right(station.distance);
        const blocked = (x: number, z: number, rad: number) => {
          const wx = p0.x + t.x * x + r.x * z;
          const wz = p0.z + t.z * x + r.z * z;
          return route.flyovers.some((f) => {
            const road = f.road.alignment;
            const s = road.project(wx, wz, f.road.junctionS + (station.distance - f.road.junctionD) + x, 150);
            if (s <= f.startS || s >= f.endS) return false;
            const q = road.point(s);
            return Math.hypot(wx - q.x, wz - q.z) < f.halfWidth + rad + 0.5;
          });
        };
        return { station, geo: buildStation(dims, false, true, blocked) };
      }),
    [flyover, alignment, route.flyovers, dims],
  );

  const mats = useMemo<Record<string, Material>>(() => {
    const concrete = makeConcreteTexture();
    return {
      concrete: new MeshStandardMaterial({ color: "#d6d4ce", map: concrete, roughness: 0.9 }),
      platformTop: new MeshStandardMaterial({ color: "#c9cbcd", roughness: 0.7 }),
      tactile: new MeshStandardMaterial({ color: line.colour, roughness: 0.6 }),
      roof: new MeshStandardMaterial({ color: "#eef0f2", roughness: 0.45, metalness: 0.3, side: DoubleSide }),
      steel: new MeshStandardMaterial({ color: "#8e969e", roughness: 0.4, metalness: 0.6 }),
      glass: new MeshStandardMaterial({
        color: "#9fb4c4",
        roughness: 0.08,
        metalness: 0.3,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
      facade: new MeshStandardMaterial({ color: "#3a4a5a", roughness: 0.2, metalness: 0.5, emissive: new Color("#ffe2b0"), emissiveIntensity: 0 }),
      lights: new MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
    };
  }, [line.colour]);

  // Night: platform light pools and lit concourse glazing.
  const pools = useMemo(() => {
    const served = inRange.filter((s) => s.service === "stop");
    if (!served.length) return null;
    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshBasicMaterial({
      map: makeRadialTexture(),
      color: "#ffe6bf",
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const perPlatform = 8;
    const mesh = new InstancedMesh(geo, mat, served.length * perPlatform * 2);
    const m = new Matrix4();
    const p = { x: 0, z: 0 };
    let i = 0;
    const y = params.railLevel + params.platformHeight + 0.03;
    for (const st of served) {
      const yaw = alignment.heading(st.distance);
      for (const s of [-1, 1]) {
        for (let k = 0; k < perPlatform; k++) {
          const d = st.distance + (k - (perPlatform - 1) / 2) * (params.platformLength / perPlatform);
          alignment.offsetPoint(d, s * (params.trackCentres / 2 + 3.6), p);
          composeMatrix(m, p.x, y, p.z, yaw, 9, 1, 7);
          mesh.setMatrixAt(i++, m);
        }
      }
    }
    mesh.computeBoundingSphere();
    return mesh;
  }, [inRange, alignment, params]);

  // Crowd level (setting, or the local clock's peaks): quantised so the clock rarely rebuilds.
  const crowd = useViewStore((st) => st.settings.crowd);
  const hour = useHour();
  const crowdLevel = Math.round(crowdFactor(crowd, hour + 0.5) * 10) / 10;

  // People waiting on served platforms; barricades on unopened ones.
  const extras = useMemo(() => {
    const rng = mulberry32(77);
    const served = inRange.filter((s) => s.service === "stop");
    const closed = inRange.filter((s) => s.service === "pass");
    const p = { x: 0, z: 0 };
    const m = new Matrix4();
    const y = params.railLevel + params.platformHeight;
    // Midday "auto" (0.5) keeps the old counts; "packed" doubles them.
    const base = quality === "low" ? 0 : quality === "medium" ? 7 : 12;
    const peopleCount = base ? Math.max(1, Math.round(base * 2 * crowdLevel)) : 0;
    let people: InstancedMesh | null = null;
    if (peopleCount && served.length) {
      const geo = new CapsuleGeometry(0.22, 1.1, 2, 6);
      geo.translate(0, 0.77, 0);
      people = new InstancedMesh(geo, new MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 }), served.length * peopleCount * 2);
      const colors = new Float32Array(people.count * 3);
      const palette = ["#c0392b", "#2e86c1", "#f1c40f", "#27ae60", "#8e44ad", "#ecf0f1", "#e67e22", "#16a085", "#34495e"].map((c) => new Color(c));
      let i = 0;
      for (const st of served) {
        for (const s of [-1, 1]) {
          for (let k = 0; k < peopleCount; k++) {
            // Leave the platform ends clear: the cinematic camera stands there.
            const d = st.distance + rr(rng, -params.platformLength / 2 + 14, params.platformLength / 2 - 14);
            alignment.offsetPoint(d, s * rr(rng, params.trackCentres / 2 + 2.6, params.trackCentres / 2 + 5.4), p);
            composeMatrix(m, p.x, y, p.z, rng() * Math.PI * 2, 1, rr(rng, 0.9, 1.08), 1);
            people.setMatrixAt(i, m);
            palette[Math.floor(rng() * palette.length)].toArray(colors, i * 3);
            i++;
          }
        }
      }
      people.instanceColor = new InstancedBufferAttribute(colors, 3);
      people.computeBoundingSphere();
    }
    let barricades: InstancedMesh | null = null;
    if (closed.length) {
      const geo = new BoxGeometry(2.0, 1.0, 0.12);
      geo.translate(0, 0.5, 0);
      barricades = new InstancedMesh(geo, new MeshStandardMaterial({ color: "#e8742a", roughness: 0.7 }), closed.length * 12);
      let i = 0;
      for (const st of closed) {
        const yaw = alignment.heading(st.distance);
        for (const s of [-1, 1]) {
          for (let k = 0; k < 6; k++) {
            const d = st.distance + (k - 2.5) * 13;
            alignment.offsetPoint(d, s * (params.trackCentres / 2 + 2.4), p);
            composeMatrix(m, p.x, y, p.z, yaw, 1, 1, 1);
            barricades.setMatrixAt(i++, m);
          }
        }
      }
      barricades.computeBoundingSphere();
    }
    return { people, barricades };
  }, [inRange, alignment, params, quality, crowdLevel]);
  // Rebuilt when the crowd changes, so free the old meshes.
  useEffect(
    () => () => {
      for (const mesh of [extras.people, extras.barricades]) {
        if (!mesh) continue;
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
        mesh.dispose();
      }
    },
    [extras],
  );

  // Departure signals: one per track at each platform's leaving end.
  const signals = useMemo(() => {
    const posts = new InstancedMesh(new CylinderGeometry(0.07, 0.07, 3.2, 6).translate(0, 1.6, 0), mats.steel, inRange.length * 2);
    const heads = new InstancedMesh(new BoxGeometry(0.34, 0.5, 0.34).translate(0, 3.35, 0), new MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), inRange.length * 2);
    const keys: { id: string; dir: 1 | -1 }[] = [];
    const m = new Matrix4();
    const p = { x: 0, z: 0 };
    const y = params.railLevel + -0.42;
    let i = 0;
    for (const st of inRange) {
      for (const dir of [1, -1] as const) {
        const d = st.distance + dir * (params.platformLength / 2 + 4);
        const lateral = (params.driving === "left" ? -1 : 1) * dir * (params.trackCentres / 2 + 1.75);
        alignment.offsetPoint(d, lateral, p);
        composeMatrix(m, p.x, y, p.z, alignment.heading(d));
        posts.setMatrixAt(i, m);
        heads.setMatrixAt(i, m);
        heads.setColorAt(i, new Color("#29d17a"));
        keys.push({ id: st.id, dir });
        i++;
      }
    }
    posts.computeBoundingSphere();
    heads.computeBoundingSphere();
    return { posts, heads, keys };
  }, [inRange, alignment, params, mats.steel]);

  const lastHold = useRef<string | null>("__init__");
  const tmpColor = useMemo(() => new Color(), []);
  const { pose } = useScene();
  useFrame(() => {
    const n = env.night;
    if (pools) {
      const mat = pools.material as MeshBasicMaterial;
      mat.opacity = n * 0.5;
      pools.visible = n > 0.02;
    }
    (mats.facade as MeshStandardMaterial).emissiveIntensity = n * 0.55;
    const hold = signal?.holdAt ?? null;
    const key = `${hold}:${pose.direction}`;
    if (key !== lastHold.current) {
      lastHold.current = key;
      signals.keys.forEach((k, i) => {
        const red = hold === k.id && k.dir === pose.direction;
        signals.heads.setColorAt(i, tmpColor.set(red ? "#ff3b30" : "#29d17a"));
      });
      if (signals.heads.instanceColor) signals.heads.instanceColor.needsUpdate = true;
    }
  });

  useEffect(
    () => () => {
      Object.values(geos).forEach((g) => {
        if ("dispose" in g) (g as BufferGeometry).dispose();
        else Object.values(g as StationGeometry).forEach((x) => x.dispose());
      });
      Object.values(mats).forEach((m) => m.dispose());
    },
    [geos, mats],
  );
  useEffect(
    () => () => flyoverGeos.forEach(({ geo }) => Object.values(geo).forEach((g) => g.dispose())),
    [flyoverGeos],
  );

  return (
    <group>
      <VariantMeshes geo={geos.single} stations={single} mats={mats} />
      <VariantMeshes geo={geos.double} stations={double} mats={mats} />
      {flyoverGeos.map(({ station, geo }) => (
        <VariantMeshes key={station.id} geo={geo} stations={[station]} mats={mats} />
      ))}
      {inRange.map((s) => (
        <SignBoards key={s.id} station={s} geometry={geos.boards} lineColour={line.colour} />
      ))}
      {pools && <primitive object={pools} />}
      {extras.people && <primitive object={extras.people} />}
      {extras.barricades && <primitive object={extras.barricades} />}
      <primitive object={signals.posts} />
      <primitive object={signals.heads} />
    </group>
  );
}
