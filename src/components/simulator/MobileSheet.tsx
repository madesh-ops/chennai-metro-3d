"use client";

import { useState } from "react";
import { PlayButton, Timeline } from "./ControlBar";
import { RouteList } from "./RouteSidebar";
import { useFullscreen } from "./TopBar";
import { Close, Expand, Shrink, Sliders } from "../ui/Icons";
import { Segmented } from "../ui/Segmented";
import { SPEED_OPTIONS } from "../../simulation/SimulationClock";
import { CAMERA_MODES, useViewStore, type Weather } from "../../simulation/store";
import type { SimulationEngine } from "../../simulation/SimulationEngine";
import type { SimulationState } from "../../simulation/types";
import { formatClock } from "../../utils/format";

/** Phone layout: the world stays full-screen, controls live in a bottom sheet. */
export function MobileSheet({ engine, snap }: { engine: SimulationEngine; snap: SimulationState }) {
  const [expanded, setExpanded] = useState(false);
  const { full, toggle } = useFullscreen();
  const next = engine.journey.stops[snap.nextStationIndex]?.station;
  const current = engine.journey.stops[snap.currentStationIndex]?.station;
  const atStation = ["stopped", "doors-open", "doors-closing"].includes(snap.state);
  const showName = snap.finished ? engine.journey.to.name : atStation ? current?.name : next?.name;
  const caption = snap.finished ? "Arrived" : atStation ? "At platform" : snap.state === "idle" ? "First stop" : "Next station";
  const cycleSpeed = () => {
    const i = SPEED_OPTIONS.indexOf(snap.simulationSpeed as (typeof SPEED_OPTIONS)[number]);
    engine.setSpeed(SPEED_OPTIONS[(i + 1) % SPEED_OPTIONS.length]);
  };

  return (
    <section
      aria-label="Journey controls"
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex flex-col gap-4 rounded-t-[20px] border-t border-white/[0.06] bg-[rgba(16,23,34,0.96)] px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-2.5 md:hidden"
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label={expanded ? "Hide station list" : "Show station list"}
        className="mx-auto flex h-6 w-16 items-center justify-center"
      >
        <span className="h-1 w-9 rounded-full bg-[#2e3a4c]" />
      </button>
      {expanded && (
        <div className="quiet-scroll max-h-[40dvh] overflow-y-auto px-1">
          <RouteList engine={engine} snap={snap} />
        </div>
      )}
      <div className="flex items-end justify-between gap-3 rounded-[14px] bg-surface-2 px-4 py-3.5">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-[19px] font-semibold uppercase tracking-[0.04em]">{showName}</span>
          <span className="text-[12px] text-muted">{caption}</span>
        </div>
        {!atStation && !snap.finished && snap.state !== "idle" && (
          <span className="tabular font-mono text-[19px]">{formatClock(snap.etaNext)}</span>
        )}
        {snap.state !== "idle" && (
          <span className="tabular shrink-0 font-mono text-[12px] text-muted">{Math.round(snap.trainSpeed)} km/h</span>
        )}
      </div>
      <div className="flex items-center justify-center gap-7">
        <PlayButton engine={engine} snap={snap} size={52} />
        <button
          type="button"
          onClick={cycleSpeed}
          aria-label={`Simulation speed ${snap.simulationSpeed}×, tap to change`}
          className="tabular h-11 min-w-[56px] rounded-full border border-line-strong px-3.5 font-mono text-[14px] text-ink"
        >
          {snap.simulationSpeed}×
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-label={full ? "Exit fullscreen" : "Enter fullscreen"}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line-strong text-[#d6dce4]"
        >
          {full ? <Shrink /> : <Expand />}
        </button>
      </div>
      <Timeline engine={engine} snap={snap} />
    </section>
  );
}

export function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mode = useViewStore((s) => s.cameraMode);
  const setMode = useViewStore((s) => s.setCameraMode);
  const time = useViewStore((s) => s.timeOfDay);
  const setTime = useViewStore((s) => s.setTimeOfDay);
  const weather = useViewStore((s) => s.weather);
  const setWeather = useViewStore((s) => s.setWeather);
  const setSettingsOpen = useViewStore((s) => s.setSettingsOpen);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:hidden" role="presentation">
      <button type="button" aria-label="Close menu" tabIndex={-1} className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="View options" className="relative flex w-full flex-col gap-5 rounded-t-2xl bg-surface px-5 pb-8 pt-4 animate-rise-in">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold">View</span>
          <button type="button" onClick={onClose} aria-label="Close menu" className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-subtle">
            <Close />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[11px] tracking-[0.12em] text-muted">CAMERA</span>
          <div className="grid grid-cols-2 gap-2">
            {CAMERA_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={mode === m.id}
                onClick={() => {
                  setMode(m.id);
                  onClose();
                }}
                className={`h-11 rounded-lg text-[14px] ${mode === m.id ? "bg-ink font-semibold text-bg" : "bg-surface-2 text-subtle"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[14px]">Time</span>
          <Segmented label="Time of day" value={time} onChange={setTime} size="sm" className="bg-surface-2" options={[{ value: "day", label: "Day" }, { value: "night", label: "Night" }]} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[14px]">Weather</span>
          <Segmented<Weather>
            label="Weather"
            value={weather}
            onChange={setWeather}
            size="sm"
            className="bg-surface-2"
            options={[{ value: "clear", label: "Clear" }, { value: "cloudy", label: "Cloudy" }, { value: "rain", label: "Rain" }]}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            onClose();
            setSettingsOpen(true);
          }}
          className="flex h-11 items-center justify-center gap-2 rounded-lg border border-line-strong text-[14px] text-ink"
        >
          <Sliders size={16} /> Settings
        </button>
      </div>
    </div>
  );
}
