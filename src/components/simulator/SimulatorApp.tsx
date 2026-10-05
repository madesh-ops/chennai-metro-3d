"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TopBar } from "./TopBar";
import { RouteSidebar } from "./RouteSidebar";
import { ControlBar } from "./ControlBar";
import { ArrivalAnnouncer, ArrivalOverlay } from "./ArrivalOverlay";
import { SettingsPanel } from "./SettingsPanel";
import { FreeCameraPad } from "./FreeCameraPad";
import { PassengerPad } from "./PassengerPad";
import { TicketCard } from "./TicketCard";
import { JourneySummary } from "./JourneySummary";
import { LoadingScreen, type LoadProgress } from "./LoadingScreen";
import { MobileMenu, MobileSheet } from "./MobileSheet";
import { FallbackView } from "./FallbackView";
import { SceneErrorBoundary } from "./SceneErrorBoundary";
import { buttonClass } from "../ui/Button";
import { getRouteModel } from "../../simulation/data";
import { SimulationEngine } from "../../simulation/SimulationEngine";
import { SPEED_OPTIONS } from "../../simulation/SimulationClock";
import { CAMERA_MODES, useViewStore, type Weather } from "../../simulation/store";
import { useEngineLoop, useSimulation } from "../../hooks/useSimulation";
import { useWebGL } from "../../hooks/useWebGL";
import { useAnnouncements } from "../../hooks/useAnnouncements";
import { useTrainSounds } from "../../hooks/useTrainSounds";
import { useCabinSounds } from "../../hooks/useCabinSounds";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import type { LoadKey } from "../../three/SimulatorScene";

const SimulatorScene = dynamic(() => import("../../three/SimulatorScene"), { ssr: false });

const WEATHER_CYCLE: Weather[] = ["clear", "cloudy", "rain"];
/** Offer the 2D map if the 3D scene still isn't ready after this long. */
const SCENE_SLOW_MS = 25000;

function DataError({ message }: { message: string }) {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-6">
      <div className="flex max-w-md flex-col gap-5">
        <h1 className="text-[24px] font-semibold">We couldn&apos;t prepare this journey</h1>
        <p className="text-[15px] leading-relaxed text-muted">{message}</p>
        <div className="flex gap-3">
          <Link href="/routes" className={buttonClass("primary", "md")}>
            Choose a route
          </Link>
          <Link href="/stations" className={buttonClass("secondary", "md")}>
            Browse stations
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function SimulatorApp({ routeId, from, to }: { routeId?: string; from: string; to: string }) {
  const built = useMemo(() => {
    try {
      return { engine: new SimulationEngine(getRouteModel(routeId), from, to), error: null };
    } catch (e) {
      return { engine: null, error: e instanceof Error ? e.message : "Unknown error while loading route data." };
    }
  }, [routeId, from, to]);

  if (!built.engine) return <DataError message={built.error ?? ""} />;
  return <Simulator engine={built.engine} />;
}

function Simulator({ engine }: { engine: SimulationEngine }) {
  const webgl = useWebGL();
  const [sceneFailed, setSceneFailed] = useState(false);
  const [failReason, setFailReason] = useState<"failed" | "context-lost" | "chose-2d">("failed");
  const [sceneSlow, setSceneSlow] = useState(false);
  const [progress, setProgress] = useState<LoadProgress>({ route: 1, environment: 0, train: 0, render: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const settings = useViewStore((s) => s.settings);
  const sidebarOpen = useViewStore((s) => s.sidebarOpen);
  const setSidebarOpen = useViewStore((s) => s.setSidebarOpen);
  const autoplayed = useRef(false);

  useEngineLoop(engine);
  const snap = useSimulation(engine);
  useAnnouncements(engine, settings.audio, settings.announceTamil);

  const use3d = webgl === "supported" && !sceneFailed;
  // Driver / Passenger only; the hook checks the camera mode itself.
  useTrainSounds(engine, { enabled: use3d && settings.trainSound, volume: settings.trainVolume });
  // Air-conditioning hum and door chimes, in the Passenger camera only.
  useCabinSounds(engine, { enabled: use3d && settings.trainSound, volume: settings.trainVolume });
  const loaded = webgl === "checking" ? false : use3d ? progress.render >= 1 : true;

  // Watchdog: if the 3D scene hasn't finished after a while, offer the 2D map
  // rather than leaving the rider on a loading screen with no way forward.
  useEffect(() => {
    if (!use3d || loaded) return;
    const t = window.setTimeout(() => setSceneSlow(true), SCENE_SLOW_MS);
    return () => window.clearTimeout(t);
  }, [use3d, loaded]);

  const onContextLost = useCallback(() => {
    setFailReason("context-lost");
    setSceneFailed(true);
  }, []);

  const onProgress = useCallback((key: LoadKey, value: number) => {
    setProgress((p) => (p[key] === value ? p : { ...p, [key]: value }));
  }, []);

  // Depart automatically once everything is ready — unless the rider asked
  // for reduced motion, in which case nothing moves until they press play.
  useEffect(() => {
    if (!loaded || autoplayed.current || settings.reducedMotion) return;
    autoplayed.current = true;
    const t = window.setTimeout(() => {
      if (!engine.started) engine.play();
    }, 2600);
    return () => window.clearTimeout(t);
  }, [loaded, engine, settings.reducedMotion]);

  const shortcuts = useMemo(() => {
    const view = useViewStore.getState;
    const map: Record<string, () => void> = {
      Space: () => engine.toggle(),
      k: () => engine.toggle(),
      "[": () => {
        const i = SPEED_OPTIONS.indexOf(engine.clock.speed as (typeof SPEED_OPTIONS)[number]);
        engine.setSpeed(SPEED_OPTIONS[Math.max(0, i - 1)]);
      },
      "]": () => {
        const i = SPEED_OPTIONS.indexOf(engine.clock.speed as (typeof SPEED_OPTIONS)[number]);
        engine.setSpeed(SPEED_OPTIONS[Math.min(SPEED_OPTIONS.length - 1, i + 1)]);
      },
      ArrowLeft: () => engine.seek(engine.clock.time - 10),
      ArrowRight: () => engine.seek(engine.clock.time + 10),
      n: () => view().toggleTimeOfDay(),
      w: () => {
        const cur = WEATHER_CYCLE.indexOf(view().weather);
        view().setWeather(WEATHER_CYCLE[(cur + 1) % WEATHER_CYCLE.length]);
      },
      s: () => view().setSidebarOpen(!view().sidebarOpen),
      f: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
      },
      ",": () => view().setSettingsOpen(true),
    };
    CAMERA_MODES.forEach((m) => {
      map[m.key] = () => view().setCameraMode(m.id);
    });
    return map;
  }, [engine]);
  const settingsOpen = useViewStore((s) => s.settingsOpen);
  useKeyboardShortcuts(shortcuts, !settingsOpen && !menuOpen);

  const journeyTitle = `${engine.journey.from.name} → ${engine.journey.to.name}`;

  return (
    <div className="fixed inset-0 overflow-hidden bg-bg text-ink" data-loaded={loaded} data-mode={use3d ? "3d" : "2d"}>
      <h1 className="sr-only">
        Simulator: {journeyTitle}
      </h1>
      <div className="absolute inset-0" id="main">
        {use3d && (
          <SceneErrorBoundary
            fallback={null}
            onError={() => {
              setFailReason("failed");
              setSceneFailed(true);
            }}
          >
            <SimulatorScene key={settings.quality} engine={engine} onProgress={onProgress} onContextLost={onContextLost} />
          </SceneErrorBoundary>
        )}
        {webgl === "unsupported" && <FallbackView engine={engine} snap={snap} reason="unsupported" />}
        {sceneFailed && <FallbackView engine={engine} snap={snap} reason={failReason} />}
      </div>

      {/* Soft top shade keeps the HUD legible over bright skies. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[rgba(7,11,18,0.55)] to-transparent" />

      {use3d && (
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="absolute bottom-1 right-2 z-10 text-[10px] text-white/55 hover:text-white/80"
        >
          Map data © OpenStreetMap contributors
        </a>
      )}
      <TopBar onOpenMenu={() => setMenuOpen(true)} threeD={use3d} />
      <RouteSidebar
        engine={engine}
        snap={snap}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        corridor={engine.route.route.name}
      />
      <ArrivalOverlay engine={engine} snap={snap} autoplayBlocked={settings.reducedMotion} summaryShown />
      <TicketCard engine={engine} snap={snap} />
      <JourneySummary engine={engine} snap={snap} />
      <ArrivalAnnouncer engine={engine} snap={snap} />
      {use3d && loaded && <FreeCameraPad />}
      {use3d && loaded && <PassengerPad />}
      <ControlBar engine={engine} snap={snap} />
      <MobileSheet engine={engine} snap={snap} />
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
      <SettingsPanel />
      <LoadingScreen progress={progress} visible={!loaded} title={journeyTitle}>
        {sceneSlow && !loaded && (
          <div className="flex flex-col gap-3 animate-fade-in" role="alert" data-scene-slow="true">
            <p className="text-[13px] leading-relaxed text-muted">
              The 3D scene is taking a while on this device. You can keep waiting, or ride the same journey on the route map.
            </p>
            <button
              type="button"
              onClick={() => {
                setFailReason("chose-2d");
                setSceneFailed(true);
              }}
              className={buttonClass("secondary", "sm", "self-start")}
            >
              Continue with the 2D map
            </button>
          </div>
        )}
      </LoadingScreen>
    </div>
  );
}
