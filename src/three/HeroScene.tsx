"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import { SceneContext, createTrafficState, createTrainPose, type SceneContextValue } from "./SceneContext.tsx";
import { createSceneEnv } from "./env.ts";
import { TrainPoseDriver, Train, type TrainMotion } from "./Train.tsx";
import { Lighting } from "./Lighting.tsx";
import { Ground } from "./Ground.tsx";
import { Track } from "./Track.tsx";
import { Line5Branch } from "./Line5Branch.tsx";
import { Flyover } from "./Flyover.tsx";
import { Stations } from "./Stations.tsx";
import { City } from "./City.tsx";
import { WorldTiles } from "./world/WorldTiles.tsx";
import { RenderGate } from "./RenderGate.tsx";
import { Landmarks } from "./Landmarks.tsx";
import { Traffic } from "./Traffic.tsx";
import { CameraRig } from "./Cameras.tsx";
import { getRouteModel } from "../simulation/data.ts";

const CRUISE = 9.5; // m/s ≈ 34 km/h — unhurried, cinematic

/**
 * Landing-page backdrop: a real slice of the modelled alignment between
 * Thelliyaragaram and Porur Junction, at dusk, with the train cruising
 * through it. The loop restarts behind a short fade.
 */
export default function HeroScene({ reducedMotion, onReady }: { reducedMotion: boolean; onReady?: () => void }) {
  const route = useMemo(() => getRouteModel(), []);
  const env = useMemo(() => createSceneEnv(0.46), []);
  const pose = useMemo(() => createTrainPose(3), []);
  const traffic = useMemo(() => createTrafficState(), []);
  const fade = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const renderOpen = useRef(false);

  // Nearly straight run between Thelliyaragaram and Porur Junction.
  const start = route.stationById.get("thelliyaragaram")!.distance + 70;
  const end = route.stationById.get("porur-junction")!.distance - 140;
  const range = useMemo<[number, number]>(() => [start - 250, end + 250], [start, end]);
  const crossStreets = useMemo<number[]>(() => [], []);
  const quality = typeof navigator !== "undefined" && /Mobi|Android/i.test(navigator.userAgent) ? "low" : "medium";

  const parts = useRef({ environment: 0, world: 0 });
  const reportProgress = useCallback(
    (key: "environment" | "world" | "train", v: number) => {
      if (key === "train") return;
      parts.current[key] = v;
      if (parts.current.environment >= 1 && parts.current.world >= 1 && !ready) {
        // Compile shaders (in parallel, off the main thread) before the scene fades in.
        setReady(true);
      }
    },
    [ready],
  );

  const ctx = useMemo<SceneContextValue>(
    () => ({ route, env, pose, traffic, quality, range, reportProgress }),
    [route, env, pose, traffic, quality, range, reportProgress],
  );

  const t = useRef(reducedMotion ? 24 : 0);
  const motion = useMemo<TrainMotion>(() => ({ centerDistance: start, direction: 1, speed: CRUISE, door: 0 }), [start]);
  const loopLength = end - start;
  const getMotion = useCallback(() => {
    const along = (t.current * CRUISE) % loopLength;
    motion.centerDistance = start + along;
    motion.speed = reducedMotion ? 0 : CRUISE;
    return motion;
  }, [loopLength, motion, reducedMotion, start]);

  return (
    <div className="absolute inset-0">
      <Canvas
        dpr={[1, quality === "low" ? 1.25 : 1.6]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 36, near: 0.5, far: 7000, position: [0, 30, 60] }}
        frameloop={reducedMotion ? "demand" : "always"}
        onCreated={({ gl }) => {
          gl.toneMapping = ACESFilmicToneMapping;
          gl.outputColorSpace = SRGBColorSpace;
        }}
        aria-hidden="true"
      >
        <SceneContext.Provider value={ctx}>
          <Clock t={t} paused={reducedMotion} loopLength={loopLength} fade={fade} />
          <TrainPoseDriver getMotion={getMotion} />
          <Lighting timeOfDay="day" weather="clear" shadows={false} shadowMapSize={512} mapMode={false} dusk instant />
          <Ground crossStreets={crossStreets} />
          <Track />
          <Line5Branch />
          <Flyover />
          <Stations />
          <WorldTiles shadows={false} />
          <City crossStreets={crossStreets} shadows={false} />
          <Landmarks shadows={false} />
          <Traffic getSimDelta={() => (reducedMotion ? 0 : 1 / 60)} enabled />
          <Train destination="Vadapalani" lineColour={route.line.colour} />
          <RenderGate open={renderOpen} />
          <CompileThenShow armed={ready} onShown={onReady} open={renderOpen} />
          <CameraRig hero reducedMotion={reducedMotion} cameraShake={false} getArrival={heroArrival} />
        </SceneContext.Provider>
      </Canvas>
      <div ref={fade} className="pointer-events-none absolute inset-0 bg-[#070B12] transition-opacity duration-700" style={{ opacity: 1 }} />
    </div>
  );
}

const heroArrival = () => ({ phase: "none" as const, eta: 0, nextStopDistance: null, currentStopDistance: null, dwellTime: 0 });

function Clock({
  t,
  paused,
  loopLength,
  fade,
}: {
  t: React.MutableRefObject<number>;
  paused: boolean;
  loopLength: number;
  fade: React.RefObject<HTMLDivElement | null>;
}) {
  const frames = useRef(0);
  useFrame((_, delta) => {
    frames.current++;
    if (!paused) t.current += Math.min(delta, 0.1);
    const along = (t.current * CRUISE) % loopLength;
    const remaining = loopLength - along;
    // Fade out just before the loop wraps, fade back in after it.
    const hidden = frames.current < 20 || remaining < CRUISE * 0.9 || along < CRUISE * 0.5;
    if (fade.current) fade.current.style.opacity = hidden ? "1" : "0";
  });
  return null;
}

/** Once armed, compile every shader asynchronously, then report (so the fade-in doesn't hitch). */
function CompileThenShow({ armed, onShown, open }: { armed: boolean; onShown?: () => void; open: { current: boolean } }) {
  const { gl, scene, camera } = useThree();
  const started = useRef(false);
  useEffect(() => {
    if (!armed || started.current) return;
    started.current = true;
    gl.compileAsync(scene, camera)
      .catch(() => undefined)
      .then(() => {
        open.current = true;
        requestAnimationFrame(() => onShown?.());
      });
  }, [armed, gl, scene, camera, onShown, open]);
  return null;
}
