"use client";

import { Segmented } from "../ui/Segmented";
import { Pause, Play, Restart } from "../ui/Icons";
import { SPEED_OPTIONS } from "../../simulation/SimulationClock";
import type { SimulationEngine } from "../../simulation/SimulationEngine";
import type { SimulationState } from "../../simulation/types";
import { formatClock } from "../../utils/format";

export function PlayButton({ engine, snap, size = 44 }: { engine: SimulationEngine; snap: SimulationState; size?: number }) {
  const label = snap.finished ? "Ride again" : snap.isPlaying ? "Pause" : snap.elapsed > 0 ? "Resume" : "Start journey";
  return (
    <button
      type="button"
      onClick={() => engine.toggle()}
      aria-label={label}
      title={`${label} (Space)`}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-ink text-bg transition-transform active:scale-95"
      style={{ width: size, height: size }}
    >
      {snap.finished ? <Restart size={18} /> : snap.isPlaying ? <Pause size={16} /> : <Play size={16} />}
    </button>
  );
}

export function SpeedControl({ engine, snap, size = "sm" }: { engine: SimulationEngine; snap: SimulationState; size?: "sm" | "md" }) {
  return (
    <Segmented<number>
      label="Simulation speed"
      value={snap.simulationSpeed}
      onChange={(v) => engine.setSpeed(v)}
      size={size}
      tone="accent"
      className="bg-surface-2 font-mono"
      options={SPEED_OPTIONS.map((s) => ({ value: s, label: `${s}×` }))}
    />
  );
}

export function Timeline({ engine, snap }: { engine: SimulationEngine; snap: SimulationState }) {
  const pct = snap.duration > 0 ? (snap.elapsed / snap.duration) * 100 : 0;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 font-mono text-[12px] text-muted">
      <span className="tabular text-ink">{formatClock(snap.elapsed)}</span>
      <input
        type="range"
        className="timeline-range min-w-0 flex-1"
        min={0}
        max={Math.round(snap.duration)}
        step={1}
        value={Math.round(snap.elapsed)}
        aria-label="Journey timeline"
        aria-valuetext={`${formatClock(snap.elapsed)} of ${formatClock(snap.duration)}`}
        onChange={(e) => engine.seek(Number(e.target.value))}
        style={{ ["--progress" as string]: `${pct}%` }}
      />
      <span className="tabular">{formatClock(snap.duration)}</span>
    </div>
  );
}

export function ControlBar({ engine, snap }: { engine: SimulationEngine; snap: SimulationState }) {
  const next = engine.journey.stops[snap.nextStationIndex];
  const atTerminus = snap.finished || (snap.currentStationIndex === engine.journey.stops.length - 1 && snap.state !== "idle");
  return (
    <div
      role="toolbar"
      aria-label="Journey controls"
      className="hud-panel pointer-events-auto absolute bottom-5 left-1/2 z-20 hidden w-[min(1080px,calc(100%-40px))] -translate-x-1/2 flex-wrap items-center gap-x-5 gap-y-3 rounded-[14px] px-[18px] py-3.5 md:flex"
    >
      <PlayButton engine={engine} snap={snap} />
      <SpeedControl engine={engine} snap={snap} />
      <Timeline engine={engine} snap={snap} />
      <dl className="flex items-start gap-7 border-l border-[#1f2a3a] pl-5">
        <div className="flex min-w-[120px] flex-col gap-1">
          <dt className="text-[10px] tracking-[0.12em] text-muted">{atTerminus ? "ARRIVED" : "NEXT STATION"}</dt>
          <dd className="max-w-[170px] truncate text-[14px] font-semibold">
            {atTerminus ? engine.journey.to.name : next?.station.name}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[10px] tracking-[0.12em] text-muted">SPEED</dt>
          <dd className="tabular font-mono text-[14px] font-semibold">
            {Math.round(snap.trainSpeed)} <span className="font-normal text-muted">km/h</span>
          </dd>
        </div>
        <div className="hidden flex-col gap-1 lg:flex">
          <dt className="text-[10px] tracking-[0.12em] text-muted">DISTANCE</dt>
          <dd className="tabular font-mono text-[14px] font-semibold">
            {(snap.distanceTravelled / 1000).toFixed(1)}{" "}
            <span className="font-normal text-muted">/ {(snap.totalDistance / 1000).toFixed(1)} km</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
