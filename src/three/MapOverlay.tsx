"use client";

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CircleGeometry, type Group, MeshBasicMaterial, PlaneGeometry, RingGeometry, type Mesh } from "three";
import { useScene } from "./SceneContext.tsx";
import { sweepProfile } from "../utils/geometry.ts";
import { landmarkFootprints } from "./landmarkLayout.ts";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useViewStore } from "../simulation/store.ts";

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

  const ribbon = useMemo(
    () =>
      // ~4 px wide at full-route altitude.
      sweepProfile(route.alignment, route.startDistance - 120, route.endDistance + 120, 8, [
        { l: 28, y: 20 },
        { l: -28, y: 20 },
      ]),
    [route],
  );

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

  const mats = useMemo(
    () => ({
      line: new MeshBasicMaterial({ color: route.line.colour, depthTest: false, transparent: true, toneMapped: false }),
      stop: new MeshBasicMaterial({ color: "#f5f7fa", depthTest: false, transparent: true, toneMapped: false }),
      pass: new MeshBasicMaterial({ color: "#7a8596", depthTest: false, transparent: true, toneMapped: false }),
      ring: new MeshBasicMaterial({ color: "#1677ff", depthTest: false, transparent: true, toneMapped: false }),
      dot: new MeshBasicMaterial({ color: "#ffffff", depthTest: false, transparent: true, toneMapped: false }),
      landmark: new MeshBasicMaterial({ color: "#ffb23e", depthTest: false, transparent: true, toneMapped: false }),
      line5: new MeshBasicMaterial({ color: line5?.colour ?? "#D7262E", depthTest: false, transparent: true, toneMapped: false }),
      dim: new MeshBasicMaterial({ color: "#070b12", depthTest: false, depthWrite: false, transparent: true, opacity: 0.5 }),
    }),
    [route.line.colour, line5],
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
      ribbon.dispose();
      line5?.geometry.dispose();
      circle.dispose();
      ringGeo.dispose();
      dimGeo.dispose();
      Object.values(mats).forEach((m) => m.dispose());
    },
    [ribbon, line5, circle, ringGeo, dimGeo, mats],
  );

  useFrame((state) => {
    if (!group.current) return;
    group.current.visible = visible;
    if (!visible) return;
    // Approximate metres per screen pixel at the current altitude.
    const px = Math.max(500, camera.position.y) / 900;
    markers.current?.children.forEach((c) => c.scale.setScalar(px * (c.userData.size as number)));
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
      <mesh geometry={ribbon} material={mats.line} renderOrder={20} />
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
              className={`map-label ${i % 2 ? "map-label--below" : ""} ${highlight.has(s.id) ? "map-label--active" : ""}`}
            >
              {s.name}
            </div>
          </Html>
        ))}
    </group>
  );
}
