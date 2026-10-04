"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useScene, type TrafficVehicle, type VehicleKind } from "./SceneContext.tsx";
import { ROAD } from "./layout.ts";
import { LANE_SPEED, createPlacement, placeVehicle } from "./trafficPlacement.ts";
import { mulberry32, pick } from "../utils/random.ts";

type Kind = VehicleKind;


function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const n = g.toNonIndexed();
  n.deleteAttribute("uv");
  return n;
}

function coloured(g: BufferGeometry, hex: string) {
  const c = new Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  g.setAttribute("color", new BufferAttribute(arr, 3));
  return g;
}

/** body (instance-coloured), dark (glass, tyres, roof) and lights (head/tail). */
function vehicleGeometry(kind: Kind) {
  const m = (parts: BufferGeometry[]) => mergeGeometries(parts)!;
  switch (kind) {
    case "car":
      return {
        body: m([box(-2.1, 2.1, 0.32, 1.02, -0.86, 0.86), box(-1.25, 0.95, 1.02, 1.5, -0.8, 0.8)]),
        dark: m([box(-1.2, 0.9, 1.06, 1.46, -0.82, 0.82), box(-1.9, 1.9, 0.0, 0.34, -0.8, 0.8)]),
        lights: m([
          coloured(box(2.08, 2.12, 0.72, 0.86, 0.45, 0.78), "#fff6dc"),
          coloured(box(2.08, 2.12, 0.72, 0.86, -0.78, -0.45), "#fff6dc"),
          coloured(box(-2.12, -2.08, 0.78, 0.9, 0.5, 0.82), "#ff2a1f"),
          coloured(box(-2.12, -2.08, 0.78, 0.9, -0.82, -0.5), "#ff2a1f"),
        ]),
      };
    case "bus":
      return {
        body: m([box(-5.6, 5.6, 0.42, 3.15, -1.27, 1.27)]),
        dark: m([box(-5.3, 5.62, 1.75, 2.75, -1.29, 1.29), box(-4.6, 4.6, 0.0, 0.45, -1.1, 1.1)]),
        lights: m([
          coloured(box(5.6, 5.64, 0.75, 0.95, 0.75, 1.15), "#fff6dc"),
          coloured(box(5.6, 5.64, 0.75, 0.95, -1.15, -0.75), "#fff6dc"),
          coloured(box(-5.64, -5.6, 0.85, 1.15, 0.8, 1.15), "#ff2a1f"),
          coloured(box(-5.64, -5.6, 0.85, 1.15, -1.15, -0.8), "#ff2a1f"),
        ]),
      };
    case "auto":
      return {
        body: m([box(-1.3, 1.1, 0.28, 1.2, -0.66, 0.66), box(1.1, 1.45, 0.28, 1.0, -0.4, 0.4)]),
        dark: m([box(-1.35, 1.2, 1.2, 1.78, -0.7, 0.7), box(-1.0, 1.0, 0.0, 0.3, -0.6, 0.6)]),
        lights: m([
          coloured(box(1.45, 1.49, 0.75, 0.9, -0.1, 0.1), "#fff6dc"),
          coloured(box(-1.34, -1.3, 0.55, 0.68, -0.55, 0.55), "#ff2a1f"),
        ]),
      };
    case "bike":
    default:
      return {
        body: m([box(-0.6, 0.35, 0.65, 1.55, -0.24, 0.24)]),
        dark: m([box(-0.95, 0.95, 0.0, 0.7, -0.12, 0.12), box(-0.25, 0.15, 1.55, 1.82, -0.15, 0.15)]),
        lights: m([coloured(box(0.94, 0.98, 0.72, 0.84, -0.06, 0.06), "#fff6dc"), coloured(box(-0.98, -0.94, 0.7, 0.8, -0.06, 0.06), "#ff2a1f")]),
      };
  }
}

const PALETTE: Record<Kind, string[]> = {
  car: ["#f2f2f0", "#c9ccd0", "#8a9096", "#2b2e33", "#7a1f1f", "#1f3c66", "#d9d2c3", "#2f4f3e"],
  bus: ["#2f6fa8", "#b9373a", "#3a7d4d", "#d8d3c8"],
  auto: ["#f2c230", "#e8b923", "#3b8f4a"],
  bike: ["#2e86c1", "#c0392b", "#f1c40f", "#ecf0f1", "#27ae60", "#8e44ad", "#34495e"],
};

const LANE_MIX: Kind[][] = [
  ["car", "car", "car", "car", "car", "bike"],
  ["car", "car", "car", "bike", "bike", "auto"],
  ["bus", "bus", "auto", "auto", "bike", "bike", "car"],
];
export { LANE_SPEED } from "./trafficPlacement.ts";

type Vehicle = TrafficVehicle;

export function Traffic({ getSimDelta, enabled }: { getSimDelta: () => number; enabled: boolean }) {
  const { route, pose, env, quality, traffic, range } = useScene();
  const half = quality === "high" ? 950 : quality === "medium" ? 700 : 420;
  const spacing = quality === "low" ? 1.6 : 1;

  const setup = useMemo(() => {
    const rng = mulberry32(2026);
    const vehicles: Vehicle[] = [];
    const counts: Record<Kind, number> = { car: 0, bus: 0, auto: 0, bike: 0 };
    for (const dir of [1, -1] as const) {
      for (let lane = 0; lane < 3; lane++) {
        let s = -half;
        while (s < half) {
          const kind = pick(rng, LANE_MIX[lane]);
          vehicles.push({ kind, index: counts[kind]++, s, lane, dir });
          s += (kind === "bus" ? 30 : 16) + rng() * 34 * spacing;
        }
      }
    }
    // Side roads (Mount–Poonamallee Road over the MGR flyover, Kundrathur Road):
    // their own traffic from the junction outwards, in every lane that fits.
    for (const road of route.sideRoads.values()) {
      const from = road.junctionS + 15;
      const to = road.alignment.length;
      for (const dir of [1, -1] as const) {
        for (let lane = 0; lane < 3; lane++) {
          if (ROAD.laneCentres[lane] + 1.4 > road.width / 2) continue;
          let s = from + rng() * 20;
          while (s < to) {
            const kind = pick(rng, LANE_MIX[lane]);
            vehicles.push({ kind, index: counts[kind]++, s, lane, dir, road: road.raw.id });
            s += (kind === "bus" ? 32 : 18) + rng() * 40 * spacing;
          }
        }
      }
    }
    const kinds: Kind[] = ["car", "bus", "auto", "bike"];
    const meshes = kinds
      .filter((k) => counts[k] > 0)
      .map((k) => {
        const g = vehicleGeometry(k);
        const body = new InstancedMesh(g.body, new MeshStandardMaterial({ color: "#ffffff", roughness: 0.45, metalness: 0.35 }), counts[k]);
        const colors = new Float32Array(counts[k] * 3);
        const c = new Color();
        for (let i = 0; i < counts[k]; i++) c.set(pick(rng, PALETTE[k])).toArray(colors, i * 3);
        body.instanceColor = new InstancedBufferAttribute(colors, 3);
        const dark = new InstancedMesh(g.dark, new MeshStandardMaterial({ color: "#14171b", roughness: 0.35, metalness: 0.4 }), counts[k]);
        const lights = new InstancedMesh(g.lights, new MeshBasicMaterial({ vertexColors: true, toneMapped: false }), counts[k]);
        dark.instanceMatrix = body.instanceMatrix;
        lights.instanceMatrix = body.instanceMatrix;
        for (const m of [body, dark, lights]) m.frustumCulled = false;
        body.castShadow = true;
        return { kind: k, body, dark, lights };
      });
    return { vehicles, meshes };
  }, [half, spacing, route]);

  // Share the live vehicles (TrafficAudio listens to the same cars).
  useEffect(() => {
    traffic.vehicles = setup.vehicles;
    return () => {
      if (traffic.vehicles === setup.vehicles) traffic.vehicles = [];
    };
  }, [traffic, setup]);

  const byKind = useMemo(() => Object.fromEntries(setup.meshes.map((m) => [m.kind, m])), [setup]);
  const tmp = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), p: new Vector3(), s: new Vector3(1, 1, 1), zero: new Vector3(0, 0, 0), place: createPlacement(), pitch: new Quaternion(), axisZ: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0), pt: { x: 0, z: 0 } }), []);
  const lightTint = useRef(-1);

  useFrame(() => {
    const dt = getSimDelta();
    const c = pose.centerDistance;
    const lo = c - half;
    const span = half * 2;
    for (const v of setup.vehicles) {
      v.s += v.dir * LANE_SPEED[v.lane] * dt;
      if (v.road) {
        // Side-road traffic loops along its own road.
        const road = route.sideRoads.get(v.road);
        if (road) {
          const from = road.junctionS + 15;
          const len = road.alignment.length - from;
          v.s = from + ((((v.s - from) % len) + len) % len);
        }
      } else {
        // Keep corridor traffic in a window around the train (handles seeking too).
        v.s = lo + ((((v.s - lo) % span) + span) % span);
      }
      const at = placeVehicle(route, v, range, tmp.place);
      tmp.p.set(at.x, at.y, at.z);
      tmp.q.setFromAxisAngle(tmp.up, at.yaw);
      if (at.pitch !== 0) {
        tmp.pitch.setFromAxisAngle(tmp.axisZ, at.pitch);
        tmp.q.multiply(tmp.pitch);
      }
      tmp.m.compose(tmp.p, tmp.q, at.visible ? tmp.s : tmp.zero);
      byKind[v.kind].body.setMatrixAt(v.index, tmp.m);
    }
    for (const m of setup.meshes) m.body.instanceMatrix.needsUpdate = true;

    const tint = Math.round((0.35 + env.night * 0.65) * 50) / 50;
    if (tint !== lightTint.current) {
      lightTint.current = tint;
      for (const m of setup.meshes) (m.lights.material as MeshBasicMaterial).color.setScalar(tint);
    }
  });

  useEffect(
    () => () => {
      for (const m of setup.meshes) {
        m.body.geometry.dispose();
        m.dark.geometry.dispose();
        m.lights.geometry.dispose();
        (m.body.material as MeshStandardMaterial).dispose();
        (m.dark.material as MeshStandardMaterial).dispose();
        (m.lights.material as MeshBasicMaterial).dispose();
      }
    },
    [setup],
  );

  return (
    <group visible={enabled}>
      {setup.meshes.map((m) => (
        <group key={m.kind}>
          <primitive object={m.body} />
          <primitive object={m.dark} />
          <primitive object={m.lights} />
        </group>
      ))}
    </group>
  );
}
