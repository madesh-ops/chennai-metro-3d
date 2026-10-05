"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import { RenderGate } from "./RenderGate.tsx";
import { SceneContext, createTrafficState, createTrainPose, type SceneContextValue } from "./SceneContext.tsx";
import { createSceneEnv } from "./env.ts";
import { CabinDisplays } from "./CabinDisplays.tsx";
import { TrainPoseDriver, Train, type TrainMotion } from "./Train.tsx";
import { Lighting } from "./Lighting.tsx";
import { Ground } from "./Ground.tsx";
import { Track } from "./Track.tsx";
import { Line5Branch } from "./Line5Branch.tsx";
import { Flyover } from "./Flyover.tsx";
import { Stations, type StationSignalState } from "./Stations.tsx";
import { City } from "./City.tsx";
import { WorldTiles } from "./world/WorldTiles.tsx";
import { Landmarks } from "./Landmarks.tsx";
import { Traffic } from "./Traffic.tsx";
import { TrafficAudio } from "./TrafficAudio.tsx";
import { Rain } from "./Weather.tsx";
import { CameraRig } from "./Cameras.tsx";
import { MapOverlay } from "./MapOverlay.tsx";
import type { SimulationEngine } from "../simulation/SimulationEngine.ts";
import { arrivalPhase } from "../simulation/StationController.ts";
import { useViewStore, type Quality } from "../simulation/store.ts";
import { journeyToAlignment } from "../simulation/Journey.ts";

export type LoadKey = "environment" | "train" | "render";

const DPR: Record<Quality, [number, number]> = {
  high: [1, 2],
  medium: [1, 1.5],
  low: [0.75, 1],
};
const SHADOW_SIZE: Record<Quality, number> = { high: 2048, medium: 1024, low: 512 };
const RAIN_DROPS: Record<Quality, number> = { high: 7000, medium: 4000, low: 1800 };

/** Dev-only: expose the renderer and scene to scripts (draw-call checks). */
function DevProbe() {
  const { gl, scene } = useThree();
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __cm3dRenderer?: () => unknown };
    w.__cm3dRenderer = () => ({ gl, scene });
    return () => {
      delete w.__cm3dRenderer;
    };
  }, [gl, scene]);
  return null;
}

/**
 * Compiles shaders once everything is mounted, then reports the first frame.
 * compileAsync uses the driver's parallel compile, so the page keeps
 * responding while dozens of programs build (the synchronous compile froze
 * it for over a second).
 */
function ReadyGate({ armed, onReady, open }: { armed: boolean; onReady: () => void; open: { current: boolean } }) {
  const { gl, scene, camera } = useThree();
  const stage = useRef(0);
  useFrame(() => {
    if (!armed) return;
    if (stage.current === 0) {
      stage.current = 1;
      gl.compileAsync(scene, camera)
        .catch(() => undefined)
        .then(() => {
          stage.current = 2;
          open.current = true;
        });
      return;
    }
    if (stage.current >= 2 && stage.current < 4) {
      stage.current++;
      if (stage.current === 4) onReady();
    }
  });
  return null;
}

/** Updates the per-frame signal state from the engine (red while dwelling). */
function SignalDriver({ engine, signal }: { engine: SimulationEngine; signal: StationSignalState }) {
  useFrame(() => {
    const s = engine.sample;
    const holding = engine.started && (s.state === "stopped" || s.state === "doors-open") && s.stopIndex < engine.journey.stops.length - 1;
    const idleAtOrigin = !engine.started;
    signal.holdAt = holding || idleAtOrigin ? engine.journey.stops[s.stopIndex].station.id : null;
  });
  return null;
}

export interface SimulatorSceneProps {
  engine: SimulationEngine;
  onProgress: (key: LoadKey, value: number) => void;
  /** The GPU dropped the WebGL context (driver reset, memory pressure). */
  onContextLost?: () => void;
}

export default function SimulatorScene({ engine, onProgress, onContextLost }: SimulatorSceneProps) {
  const settings = useViewStore((s) => s.settings);
  const timeOfDay = useViewStore((s) => s.timeOfDay);
  const weather = useViewStore((s) => s.weather);
  const mapMode = useViewStore((s) => s.cameraMode === "map");
  const streetCamera = useViewStore((s) => s.cameraMode === "cinematic" || s.cameraMode === "free");
  // Re-render once the ride starts so street sounds can begin.
  const started = useSyncExternalStore(engine.subscribe, () => engine.started, () => false);
  const route = engine.route;
  const [dprCap, setDprCap] = useState(1);
  const [envDone, setEnvDone] = useState(false);
  const [trainDone, setTrainDone] = useState(false);

  const env = useMemo(() => createSceneEnv(useViewStore.getState().timeOfDay === "night" ? 1 : 0), []);
  const pose = useMemo(() => createTrainPose(3), []);
  const traffic = useMemo(() => createTrafficState(), []);
  // The route's own stretch plus tail tracks (the alignment can carry the whole line beyond it).
  const range = useMemo<[number, number]>(() => {
    const margin = route.params.tailTrack + 400;
    return [Math.max(0, route.startDistance - margin), Math.min(route.alignment.length, route.endDistance + margin)];
  }, [route]);
  // The real street grid comes from the world tiles; no invented cross streets.
  const crossStreets = useMemo<number[]>(() => [], []);
  const signal = useMemo<StationSignalState>(() => ({ holdAt: null }), []);
  const renderOpen = useRef(false);

  // The environment is the street furniture (City) plus the first world tiles round the train.
  const envParts = useRef({ environment: 0, world: 0 });
  const reportProgress = useCallback(
    (key: "environment" | "world" | "train", value: number) => {
      if (key === "train") {
        onProgress("train", value);
        if (value >= 1) setTrainDone(true);
        return;
      }
      envParts.current[key] = value;
      const { environment, world } = envParts.current;
      onProgress("environment", (environment + world) / 2);
      if (environment >= 1 && world >= 1) setEnvDone(true);
    },
    [onProgress],
  );

  const ctx = useMemo<SceneContextValue>(
    () => ({ route, env, pose, traffic, quality: settings.quality, range, reportProgress }),
    [route, env, pose, traffic, settings.quality, range, reportProgress],
  );

  const motion = useMemo<TrainMotion>(() => ({ centerDistance: 0, direction: 1, speed: 0, door: 1 }), []);
  const getMotion = useCallback(() => {
    motion.centerDistance = engine.centerDistance;
    motion.direction = engine.journey.direction;
    motion.speed = engine.sample.v;
    motion.door = engine.sample.door;
    return motion;
  }, [engine, motion]);

  const arrival = useMemo(
    () => ({ phase: "none" as ReturnType<typeof arrivalPhase>, eta: 0, nextStopDistance: null as number | null, currentStopDistance: null as number | null, dwellTime: 0 }),
    [],
  );
  const getArrival = useCallback(() => {
    const s = engine.sample;
    const stops = engine.trajectory.stops;
    arrival.phase = engine.started ? arrivalPhase(s, stops) : "none";
    const next = engine.journey.stops[s.stopIndex + 1];
    const cur = engine.journey.stops[s.stopIndex];
    arrival.eta = stops[s.stopIndex + 1] ? stops[s.stopIndex + 1].arriveTime - s.time : 0;
    arrival.nextStopDistance = next ? journeyToAlignment(engine.journey, next.x) : null;
    arrival.currentStopDistance = cur ? journeyToAlignment(engine.journey, cur.x) : null;
    arrival.dwellTime = stops[s.stopIndex] ? s.time - stops[s.stopIndex].doorsOpenEnd : 0;
    return arrival;
  }, [engine, arrival]);

  const shadows = settings.shadows && settings.quality !== "low";
  const [lo, hi] = DPR[settings.quality];

  useEffect(() => {
    if (envDone && trainDone) onProgress("render", 0.5);
  }, [envDone, trainDone, onProgress]);

  return (
    <Canvas
      shadows={shadows ? "percentage" : false}
      dpr={[lo, Math.max(lo, hi * dprCap)]}
      gl={{ antialias: settings.quality !== "low", powerPreference: "high-performance", stencil: false }}
      camera={{ fov: 42, near: 0.5, far: 9000, position: [0, 40, 80] }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.outputColorSpace = SRGBColorSpace;
        gl.domElement.addEventListener(
          "webglcontextlost",
          (e) => {
            e.preventDefault();
            onContextLost?.();
          },
          { once: true },
        );
      }}
      aria-hidden="true"
    >
      <SceneContext.Provider value={ctx}>
        <PerformanceMonitor onDecline={() => setDprCap((c) => Math.max(0.6, c - 0.2))} onIncline={() => setDprCap((c) => Math.min(1, c + 0.1))} />
        <TrainPoseDriver getMotion={getMotion} />
        <SignalDriver engine={engine} signal={signal} />
        <Lighting
          timeOfDay={timeOfDay}
          weather={settings.weatherEffects ? weather : "clear"}
          shadows={shadows}
          shadowMapSize={SHADOW_SIZE[settings.quality]}
          mapMode={mapMode}
          instant={settings.reducedMotion}
        />
        <Ground crossStreets={crossStreets} />
        <Track />
        <Line5Branch />
        <Flyover />
        <Stations signal={signal} />
        <WorldTiles shadows={shadows && settings.quality === "high"} />
        <City crossStreets={crossStreets} shadows={shadows && settings.quality === "high"} />
        <Landmarks shadows={shadows} />
        <Traffic getSimDelta={() => engine.lastDelta} enabled={settings.traffic} />
        <TrafficAudio
          enabled={streetCamera && settings.streetSound && settings.traffic && started}
          volume={settings.streetVolume}
          getPlaying={() => engine.clock.playing}
          getPlaybackSpeed={() => engine.clock.speed}
        />
        <Train destination={engine.journey.to.name} lineColour={route.line.colour} />
        <CabinDisplays engine={engine} />
        <Rain count={RAIN_DROPS[settings.quality]} enabled={settings.weatherEffects} />
        <MapOverlay highlightIds={[engine.journey.from.id, engine.journey.to.id]} />
        <CameraRig reducedMotion={settings.reducedMotion} cameraShake={settings.cameraShake} getArrival={getArrival} />
        <DevProbe />
        <RenderGate open={renderOpen} />
        <ReadyGate armed={envDone && trainDone} onReady={() => onProgress("render", 1)} open={renderOpen} />
      </SceneContext.Provider>
    </Canvas>
  );
}
