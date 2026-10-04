"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  Color,
  DoubleSide,
  Object3D,
  type PointLight,
  type SpotLight,
  type Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Mesh,
} from "three";
import { useScene } from "./SceneContext.tsx";
import { BOGIE_OFFSET, NOSE_TIP, buildCar, type CarGeometry } from "./trainModel.ts";
import { TRAIN } from "./layout.ts";
import { makeDestinationTexture } from "./textures.ts";
import { CabinPeople, WomenOnlyDecals } from "./CabinPeople.tsx";
import { Straps } from "./Straps.tsx";
import { useViewStore } from "../simulation/store.ts";

export interface TrainMotion {
  /** Alignment distance of the train centre. */
  centerDistance: number;
  direction: 1 | -1;
  /** m/s */
  speed: number;
  /** 0..1 door opening on the platform side */
  door: number;
}

const UP = new Vector3(0, 1, 0);
const CAR_COUNT = 3;

/**
 * Computes the train pose once per frame (priority -1, before anything that
 * reads it). Each car is placed by its two bogie pivots on the curve, so the
 * cars articulate naturally through curves.
 */
export function TrainPoseDriver({ getMotion }: { getMotion: () => TrainMotion }) {
  const { route, pose } = useScene();
  const fp = useMemo(() => ({ x: 0, z: 0 }), []);
  const rp = useMemo(() => ({ x: 0, z: 0 }), []);
  const dir = useMemo(() => new Vector3(), []);

  useFrame((_, delta) => {
    const m = getMotion();
    const { alignment, params } = route;
    pose.centerDistance = m.centerDistance;
    pose.direction = m.direction;
    pose.speed = m.speed;
    pose.door = m.door;
    pose.lateral = (params.driving === "left" ? -1 : 1) * m.direction * (params.trackCentres / 2);
    pose.wheelAngle += (m.speed * Math.min(delta, 0.1)) / 0.42;

    for (let k = 0; k < CAR_COUNT; k++) {
      const carCentre = m.centerDistance + m.direction * (1 - k) * TRAIN.pitch;
      alignment.offsetPoint(carCentre + m.direction * BOGIE_OFFSET, pose.lateral, fp);
      alignment.offsetPoint(carCentre - m.direction * BOGIE_OFFSET, pose.lateral, rp);
      const car = pose.cars[k];
      car.position.set((fp.x + rp.x) / 2, params.railLevel, (fp.z + rp.z) / 2);
      dir.set(fp.x - rp.x, 0, fp.z - rp.z).normalize();
      // Trailing cab faces backwards.
      car.yaw = Math.atan2(-dir.z, dir.x) + (k === CAR_COUNT - 1 ? Math.PI : 0);
      car.quaternion.setFromAxisAngle(UP, car.yaw);
      if (k === 0) {
        pose.forward.copy(dir);
        pose.head.copy(car.position).addScaledVector(dir, NOSE_TIP);
      }
      if (k === 1) pose.center.copy(car.position);
    }
  }, -1);
  return null;
}

interface TrainMaterials {
  body: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  under: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  windshield: MeshStandardMaterial;
  stripe: MeshStandardMaterial;
  steel: MeshStandardMaterial;
  seats: MeshStandardMaterial;
  floor: MeshStandardMaterial;
  ceiling: MeshStandardMaterial;
  lights: MeshBasicMaterial;
  head: MeshBasicMaterial;
  tail: MeshBasicMaterial;
  door: MeshStandardMaterial;
  destination: MeshBasicMaterial;
}

function useTrainMaterials(lineColour: string, destination: string): TrainMaterials {
  const mats = useMemo<TrainMaterials>(() => {
    const interior = (color: string, emissive: number, extra: Partial<MeshStandardMaterial> = {}) =>
      Object.assign(new MeshStandardMaterial({ color, roughness: 0.6 }), {
        emissive: new Color(color),
        emissiveIntensity: emissive,
        ...extra,
      });
    return {
      // Livery comes from vertex colours (trainModel.ts paintBody / trainNose.ts).
      body: new MeshStandardMaterial({ color: "#ffffff", vertexColors: true, metalness: 0.25, roughness: 0.38 }),
      dark: new MeshStandardMaterial({ color: "#23272d", roughness: 0.6, metalness: 0.2 }),
      under: new MeshStandardMaterial({ color: "#5d636b", roughness: 0.7, metalness: 0.3 }),
      glass: new MeshStandardMaterial({
        color: "#0c1620",
        metalness: 0.45,
        roughness: 0.06,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        side: DoubleSide,
      }),
      windshield: new MeshStandardMaterial({
        color: "#26384a",
        metalness: 0.5,
        roughness: 0.08,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
      stripe: new MeshStandardMaterial({ color: lineColour, roughness: 0.45 }),
      steel: interior("#b4bcc5", 0.18, { metalness: 0.55, roughness: 0.32 } as Partial<MeshStandardMaterial>),
      seats: interior("#5d7891", 0.22),
      floor: interior("#545d68", 0.12),
      ceiling: interior("#eef1f3", 0.42),
      lights: new MeshBasicMaterial({ color: "#fff4df", toneMapped: false }),
      head: new MeshBasicMaterial({ color: "#fffbea", toneMapped: false }),
      tail: new MeshBasicMaterial({ color: "#ff2b2b", toneMapped: false }),
      door: new MeshStandardMaterial({ color: "#ffffff", vertexColors: true, metalness: 0.15, roughness: 0.34 }),
      destination: new MeshBasicMaterial({ toneMapped: false }),
    };
  }, [lineColour]);

  useEffect(() => {
    const tex = makeDestinationTexture(destination);
    mats.destination.map = tex;
    mats.destination.needsUpdate = true;
    return () => tex.dispose();
  }, [destination, mats]);

  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
    },
    [mats],
  );
  return mats;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);
const _axisZ = new Vector3(0, 0, 1);

function Car({
  geo,
  mats,
  index,
  leading,
}: {
  geo: CarGeometry;
  mats: TrainMaterials;
  index: number;
  leading: boolean;
}) {
  const { pose, env } = useScene();
  const group = useRef<Group>(null);
  const leaves = useRef<InstancedMesh>(null);
  const leafGlass = useRef<InstancedMesh>(null);
  const wheels = useRef<InstancedMesh>(null);
  const nose = useRef<Mesh>(null);
  const lastDoor = useRef(-1);
  const interior = useRef<PointLight>(null);
  const beam = useRef<SpotLight>(null);
  const beamTarget = useMemo(() => {
    const o = new Object3D();
    o.position.set(60, -1, 0);
    return o;
  }, []);

  useEffect(() => {
    // Door glass shares the leaf transforms.
    if (leaves.current && leafGlass.current) leafGlass.current.instanceMatrix = leaves.current.instanceMatrix;
  }, []);

  useFrame(() => {
    const car = pose.cars[index];
    const g = group.current;
    if (!g) return;
    g.position.copy(car.position);
    g.quaternion.copy(car.quaternion);

    // Platform is on the left of travel; the trailing car is turned around.
    const platformSide = index === pose.cars.length - 1 ? 1 : -1;
    const door = pose.door;
    if (leaves.current && Math.abs(door - lastDoor.current) > 1e-4) {
      lastDoor.current = door;
      geo.leaves.forEach((leaf, i) => {
        const open = leaf.side === platformSide ? door : 0;
        _p.set(leaf.x + leaf.slide * 0.7 * open, 0, leaf.side * (TRAIN.width / 2 + 0.03 + 0.04 * Math.min(1, open * 4)));
        // Leaf geometry faces +z (outside); turn the left-side leaves round.
        if (leaf.side > 0) _q.identity();
        else _q.setFromAxisAngle(UP, Math.PI);
        _m.compose(_p, _q, _s);
        leaves.current!.setMatrixAt(i, _m);
      });
      leaves.current.instanceMatrix.needsUpdate = true;
    }

    if (wheels.current) {
      _q.setFromAxisAngle(_axisZ, -pose.wheelAngle);
      geo.wheelPositions.forEach(([x, y, z], i) => {
        _p.set(x, y, z);
        _m.compose(_p, _q, _s);
        wheels.current!.setMatrixAt(i, _m);
      });
      wheels.current.instanceMatrix.needsUpdate = true;
    }

    if (nose.current) {
      const hide = leading && useViewStore.getState().cameraMode === "driver";
      nose.current.visible = !hide;
    }
    // Interior lighting reads stronger at night.
    const n = env.night;
    if (interior.current) interior.current.intensity = 1 + n * 6;
    if (beam.current) {
      beam.current.intensity = n * 300;
      beam.current.target = beamTarget;
    }
    mats.ceiling.emissiveIntensity = 0.42 + n * 0.55;
    mats.seats.emissiveIntensity = 0.22 + n * 0.3;
  });

  return (
    <group ref={group}>
      <mesh geometry={geo.body} material={mats.body} castShadow receiveShadow />
      <mesh geometry={geo.dark} material={mats.dark} castShadow />
      <mesh geometry={geo.under} material={mats.under} castShadow />
      <mesh geometry={geo.stripe} material={mats.stripe} />
      <mesh geometry={geo.steel} material={mats.steel} />
      <mesh geometry={geo.seats} material={mats.seats} />
      <mesh geometry={geo.floor} material={mats.floor} receiveShadow />
      <mesh geometry={geo.ceiling} material={mats.ceiling} />
      <mesh geometry={geo.lights} material={mats.lights} />
      <mesh geometry={geo.glass} material={mats.glass} renderOrder={2} />
      {geo.nose && <mesh ref={nose} geometry={geo.nose} material={mats.body} castShadow />}
      {geo.windshield && <mesh geometry={geo.windshield} material={mats.windshield} renderOrder={2} />}
      {geo.headlights && <mesh geometry={geo.headlights} material={leading ? mats.head : mats.tail} />}
      {geo.destination && leading && <mesh geometry={geo.destination} material={mats.destination} />}
      <instancedMesh ref={leaves} args={[geo.doorLeaf, mats.door, geo.leaves.length]} castShadow frustumCulled={false} />
      <instancedMesh
        ref={leafGlass}
        args={[geo.doorGlass, mats.glass, geo.leaves.length]}
        renderOrder={2}
        frustumCulled={false}
      />
      <instancedMesh ref={wheels} args={[geo.wheel, mats.dark, geo.wheelPositions.length]} frustumCulled={false} />
      {/* Inside: passengers and grab straps; the leading car is the women's coach. */}
      <CabinPeople kind={geo.kind} carIndex={index} women={leading} />
      <Straps kind={geo.kind} carIndex={index} />
      {leading && <WomenOnlyDecals kind={geo.kind} />}
      {/* Lights stay mounted (intensity animated) so toggling night never recompiles shaders. */}
      <pointLight ref={interior} position={[0, 2.7, 0]} distance={13} decay={2} intensity={1} color="#fff3df" />
      {leading && (
        <>
          <primitive object={beamTarget} />
          <spotLight ref={beam} position={geo.beam ?? [11.2, 1.5, 0]} angle={0.42} penumbra={0.6} distance={180} decay={1.6} intensity={0} color="#fff6e0" />
        </>
      )}
    </group>
  );
}

export function Train({ destination, lineColour }: { destination: string; lineColour: string }) {
  const { reportProgress } = useScene();
  const geos = useMemo(() => ({ dmc: buildCar("DMC"), tc: buildCar("TC") }), []);
  const mats = useTrainMaterials(lineColour, destination);
  const windshieldOpacity = useRef(0.9);

  useEffect(() => {
    reportProgress?.("train", 1);
  }, [reportProgress]);

  useEffect(
    () => () => {
      for (const g of Object.values(geos)) {
        for (const v of Object.values(g)) if (v && typeof v === "object" && "dispose" in v) (v as { dispose(): void }).dispose();
      }
    },
    [geos],
  );

  useFrame(() => {
    // Driver view looks through the windshield; outside it reads as dark glass.
    const target = useViewStore.getState().cameraMode === "driver" ? 0.16 : 0.9;
    if (Math.abs(windshieldOpacity.current - target) > 0.001) {
      windshieldOpacity.current = target;
      mats.windshield.opacity = target;
    }
  });

  return (
    <group>
      <Car geo={geos.dmc} mats={mats} index={0} leading />
      <Car geo={geos.tc} mats={mats} index={1} leading={false} />
      <Car geo={geos.dmc} mats={mats} index={2} leading={false} />
    </group>
  );
}
