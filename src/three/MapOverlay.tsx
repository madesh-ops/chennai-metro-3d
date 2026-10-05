"use client";

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Vector3, CircleGeometry, type Group, MeshBasicMaterial, PlaneGeometry, RingGeometry, type Mesh } from "three";
import { useScene } from "./SceneContext.tsx";
import { sweepProfile } from "../utils/geometry.ts";
import { landmarkFootprints } from "./landmarkLayout.ts";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useViewStore } from "../simulation/store.ts";
import { dataBundle } from "../simulation/data.ts";
import { BufferAttribute, BufferGeometry, DoubleSide } from "three";

/**
 * A flat ribbon along a polyline at height y whose width is set in screen
 * pixels: vertices sit on the centreline and the shader pushes them out
 * along aOff by uHalf metres (updated with the camera altitude).
 */
function polylineRibbon(pts: readonly (readonly [number, number])[], y: number): BufferGeometry {
  const pos: number[] = [];
  const off: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (bz - az) / l;
    const nz = -(bx - ax) / l;
    // Two triangles per segment (overdrawn joins are invisible in a flat colour).
    for (const [x, z, s] of [[ax, az, -1], [bx, bz, 1], [ax, az, 1], [ax, az, -1], [bx, bz, -1], [bx, bz, 1]] as const) {
      pos.push(x, y, z);
      off.push(nx * s, nz * s);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aOff", new BufferAttribute(new Float32Array(off), 2));
  g.computeBoundingSphere();
  return g;
}

function ribbonMaterial(color: string, opacity: number, half: { value: number }) {
  const m = new MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity, toneMapped: false, side: DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHalf = half;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec2 aOff;
uniform float uHalf;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
transformed.xz += aOff * uHalf;`);
  };
  m.customProgramCacheKey = () => "cm-map-ribbon";
  return m;
}

/**
 * Bird's-eye overlay: at map altitude the 10 m-wide viaduct is sub-pixel,
 * so the line, stations and train get markers that scale with altitude.
 */
export function MapOverlay({ highlightIds }: { highlightIds: string[] }) {
  const { route, pose } = useScene();
  const visible = useViewStore((s) => s.cameraMode === "map");
  const camera = useThree((s) => s.camera);
  const group = useRef<Group>(null);
  const markers = useRef<Group>(null);
  const beacon = useRef<Group>(null);
  const ring = useRef<Mesh>(null);

  // Line 5 (red): a thinner ribbon on top of Line 4 along the double-decker,
  // then on its own along the branch, so the map shows where they part.
  const line5 = useMemo(() => {
    const dd = route.doubleDecker;
    const branches = route.line5Branches;
    if (!dd || !branches.length) return null;
    const parts = [
      sweepProfile(route.alignment, dd.upperStart, dd.upperEnd, 8, [
        { l: 13, y: 20.5 },
        { l: -13, y: 20.5 },
      ]),
      ...branches.map((b) =>
        sweepProfile(b.alignment, 0, b.alignment.length, 6, [
          { l: 18, y: 20.5 },
          { l: -18, y: 20.5 },
        ]),
      ),
    ];
    return { geometry: mergeGeometries(parts)!, colour: branches[0].line?.colour ?? "#D7262E" };
  }, [route]);

  // Ribbon half-widths (m), set from the altitude every frame so lines keep their screen width.
  const widths = useMemo(() => ({ route: { value: 28 }, network: { value: 12 } }), []);
  const routeRibbon = useMemo(() => {
    const pts: [number, number][] = [];
    const p = { x: 0, z: 0 };
    for (let d = route.startDistance - 120; d <= route.endDistance + 120; d += 8) {
      route.alignment.point(Math.max(0, Math.min(route.alignment.length, d)), p);
      pts.push([p.x, p.z]);
    }
    return { geometry: polylineRibbon(pts, 20), material: ribbonMaterial(route.line.colour, 1, widths.route) };
  }, [route, widths]);

  // The whole network: every line's real track, thin, under this route's ribbon.
  const network = useMemo(() => {
    const net = dataBundle.network;
    if (!net) return [];
    const colours = new Map(dataBundle.routes.lines.map((l) => [l.id, l.colour]));
    return net.lines.map((l) => ({
      id: l.id,
      geometry: polylineRibbon(l.track as [number, number][], 19.5),
      material: ribbonMaterial(colours.get(l.id) ?? "#888888", 0.7, widths.network),
    }));
  }, [widths]);

  const mats = useMemo(
    () => ({
      stop: new MeshBasicMaterial({ color: "#f5f7fa", depthTest: false, transparent: true, toneMapped: false }),
      pass: new MeshBasicMaterial({ color: "#7a8596", depthTest: false, transparent: true, toneMapped: false }),
      ring: new MeshBasicMaterial({ color: "#1677ff", depthTest: false, transparent: true, toneMapped: false }),
      dot: new MeshBasicMaterial({ color: "#ffffff", depthTest: false, transparent: true, toneMapped: false }),
      landmark: new MeshBasicMaterial({ color: "#ffb23e", depthTest: false, transparent: true, toneMapped: false }),
      line5: new MeshBasicMaterial({ color: line5?.colour ?? "#D7262E", depthTest: false, transparent: true, toneMapped: false }),
      dim: new MeshBasicMaterial({ color: "#070b12", depthTest: false, depthWrite: false, transparent: true, opacity: 0.5 }),
    }),
    [line5],
  );
  const landmarks = useMemo(
    () =>
      landmarkFootprints(route).map((f) => {
        const p = route.alignment.offsetPoint(f.distance, f.lateral);
        // Pins only: landmarks sit too close to stations for readable labels at map scale.
        return { id: f.placement.landmark.id, x: p.x, z: p.z };
      }),
    [route],
  );
  const circle = useMemo(() => new CircleGeometry(1, 28).rotateX(-Math.PI / 2), []);
  const ringGeo = useMemo(() => new RingGeometry(0.75, 1, 40).rotateX(-Math.PI / 2), []);
  const dimGeo = useMemo(() => new PlaneGeometry(80000, 80000).rotateX(-Math.PI / 2), []);

  useEffect(
    () => () => {
      line5?.geometry.dispose();
      routeRibbon.geometry.dispose();
      routeRibbon.material.dispose();
      network.forEach((n) => {
        n.geometry.dispose();
        n.material.dispose();
      });
      circle.dispose();
      ringGeo.dispose();
      dimGeo.dispose();
      Object.values(mats).forEach((m) => m.dispose());
    },
    [routeRibbon, line5, network, circle, ringGeo, dimGeo, mats],
  );

  // Station labels: hide any that would overlap a more important one (ends and highlights win).
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const labelOrder = useMemo(() => {
    const n = route.stops.length;
    const hi = new Set(highlightIds);
    return route.stops
      .map((s, i) => ({ i, rank: hi.has(s.id) ? 0 : i === 0 || i === n - 1 ? 1 : 2 }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i)
      .map((x) => x.i);
  }, [route.stops, highlightIds]);
  const tmpV = useMemo(() => new Vector3(), []);

  useFrame((state) => {
    if (!group.current) return;
    group.current.visible = visible;
    if (!visible) return;
    const { width, height } = state.size;
    const boxes: [number, number, number, number][] = [];
    for (const i of labelOrder) {
      const el = labelRefs.current[i];
      if (!el) continue;
      const s = route.stops[i];
      tmpV.set(s.local.x, 22, s.local.z).project(camera);
      const x = (tmpV.x * 0.5 + 0.5) * width;
      const y = (-tmpV.y * 0.5 + 0.5) * height;
      const w = s.name.length * 7 + 18;
      const below = i % 2 === 1;
      const box: [number, number, number, number] = [x - w / 2, below ? y + 10 : y - 36, x + w / 2, below ? y + 36 : y - 10];
      const clash = boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      el.style.visibility = clash ? "hidden" : "visible";
      if (!clash) boxes.push(box);
    }
    // Approximate metres per screen pixel at the current altitude.
    const px = Math.max(500, camera.position.y) / 900;
    markers.current?.children.forEach((c) => c.scale.setScalar(px * (c.userData.size as number)));
    widths.route.value = px * 3.2;
    widths.network.value = px * 1.6;
    if (beacon.current) {
      beacon.current.position.set(pose.center.x, 30, pose.center.z);
      beacon.current.scale.setScalar(px);
      if (ring.current) {
        const t = (state.clock.elapsedTime % 1.6) / 1.6;
        ring.current.scale.setScalar(9 + t * 16);
        (ring.current.material as MeshBasicMaterial).opacity = 0.9 * (1 - t);
      }
    }
  });

  const highlight = new Set(highlightIds);
  return (
    <group ref={group} visible={false}>
      <mesh geometry={dimGeo} material={mats.dim} position={[pose.center.x, 12, pose.center.z]} renderOrder={19} frustumCulled={false} />
      {network.map((n) => (
        <mesh key={n.id} geometry={n.geometry} material={n.material} renderOrder={19.5} frustumCulled={false} />
      ))}
      <mesh geometry={routeRibbon.geometry} material={routeRibbon.material} renderOrder={20} frustumCulled={false} />
      {line5 && <mesh geometry={line5.geometry} material={mats.line5} renderOrder={20.5} />}
      <group ref={markers}>
        {route.stations.map((s) => {
          const stop = s.service === "stop";
          return (
            <mesh
              key={s.id}
              geometry={circle}
              material={stop ? mats.stop : mats.pass}
              position={[s.local.x, 22, s.local.z]}
              userData={{ size: stop ? 7 : 4.5 }}
              renderOrder={21}
            />
          );
        })}
        {landmarks.map((l) => (
          <mesh key={l.id} geometry={circle} material={mats.landmark} position={[l.x, 21, l.z]} userData={{ size: 3.5 }} renderOrder={21} />
        ))}
      </group>
      <group ref={beacon}>
        <mesh geometry={ringGeo} material={mats.ring} ref={ring} renderOrder={22} />
        <mesh geometry={circle} material={mats.ring} scale={8} renderOrder={23} />
        <mesh geometry={circle} material={mats.dot} scale={4} position={[0, 1, 0]} renderOrder={24} />
      </group>
      {visible &&
        route.stops.map((s, i) => (
          <Html key={s.id} position={[s.local.x, 22, s.local.z]} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div
              ref={(el) => {
                labelRefs.current[i] = el;
              }}
              className={`map-label ${i % 2 ? "map-label--below" : ""} ${highlight.has(s.id) ? "map-label--active" : ""}`}
            >
              {s.name}
            </div>
          </Html>
        ))}
    </group>
  );
}
