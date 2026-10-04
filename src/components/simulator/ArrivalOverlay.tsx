"use client";

import Link from "next/link";
import type { SimulationEngine } from "../../simulation/SimulationEngine";
import type { SimulationState } from "../../simulation/types";
import { formatClock } from "../../utils/format";
import { ArrowRight, Play, Restart } from "../ui/Icons";
import { buttonClass } from "../ui/Button";

function StationName({ name, nameTa, size = "lg" }: { name: string; nameTa: string | null; size?: "lg" | "md" }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <span aria-hidden="true" className="h-1 w-10 rounded-full bg-route" />
      <span
        className={`font-semibold uppercase leading-none tracking-[0.06em] text-ink [text-shadow:0_2px_24px_rgba(0,0,0,0.45)] ${
          size === "lg" ? "text-[40px] sm:text-[64px]" : "text-[32px] sm:text-[44px]"
        }`}
      >
        {name}
      </span>
      {nameTa && (
        <span lang="ta" className="font-tamil text-[22px] font-medium text-[#d5dce5] [text-shadow:0_2px_18px_rgba(0,0,0,0.5)] sm:text-[28px]">
          {nameTa}
        </span>
      )}
    </div>
  );
}

function StatusPill({ text, dot }: { text: string; dot: string }) {
  return (
    <span className="hud-panel inline-flex h-10 items-center gap-2.5 rounded-full px-[18px] text-[15px] text-ink animate-fade-in">
      <span className="h-2 w-2 rounded-full" style={{ background: dot }} aria-hidden="true" />
      {text}
    </span>
  );
}

/**
 * The arrival sequence (spec §19): Next station → name in English and
 * Tamil → doors opening → doors closing → depart. Purely presentational;
 * the phase comes from the simulation engine.
 */
export function ArrivalOverlay({
  engine,
  snap,
  autoplayBlocked,
  summaryShown = false,
}: {
  engine: SimulationEngine;
  snap: SimulationState;
  autoplayBlocked: boolean;
  /** The JourneySummary card handles the finished state; don't draw the plain arrival screen. */
  summaryShown?: boolean;
}) {
  const stops = engine.journey.stops;
  const current = stops[snap.currentStationIndex]?.station;
  const next = stops[snap.nextStationIndex]?.station;
  const phase = snap.arrival;

  // Before the first departure: show the origin and how to begin.
  if (snap.state === "idle" && !snap.finished && snap.elapsed === 0) {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-8 px-6">
        <StationName name={engine.journey.from.name} nameTa={engine.journey.from.nameTa} />
        <div className="pointer-events-auto flex flex-col items-center gap-3">
          <button type="button" onClick={() => engine.play()} className={buttonClass("primary", "lg")} autoFocus={autoplayBlocked}>
            <Play size={16} /> Depart for {engine.journey.to.name}
          </button>
          <span className="text-[13px] text-[#c9d1dc] [text-shadow:0_1px_8px_rgba(0,0,0,0.6)]">
            {stops.length - 1} {stops.length - 1 === 1 ? "stop" : "stops"} · press Space to start or pause
          </span>
        </div>
      </div>
    );
  }

  if (snap.finished && summaryShown) return null;

  if (snap.finished && current) {
    const reverse = `/simulator?from=${engine.journey.to.id}&to=${engine.journey.from.id}`;
    return (
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-8 px-6 animate-fade-in">
        <div className="flex flex-col items-center gap-4">
          <span className="text-[12px] font-semibold tracking-[0.16em] text-[#c9d1dc]">YOU HAVE ARRIVED AT</span>
          <StationName name={current.name} nameTa={current.nameTa} />
        </div>
        <div className="pointer-events-auto flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => engine.play()} className={buttonClass("primary", "md")}>
            <Restart size={16} /> Ride again
          </button>
          <Link href={reverse} className={buttonClass("secondary", "md", "bg-bg/40")}>
            Return journey <ArrowRight size={16} />
          </Link>
          <Link href="/routes" className={buttonClass("ghost", "md")}>
            Choose another route
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {phase === "approaching" && next && (
        <div
          key={`next-${next.id}`}
          className="hud-panel pointer-events-none absolute left-1/2 top-[86px] z-10 flex min-w-[300px] max-w-[calc(100%-32px)] -translate-x-1/2 items-end justify-between gap-6 rounded-[14px] px-6 py-5 animate-rise-in md:top-[128px] lg:top-[88px]"
        >
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[11px] tracking-[0.16em] text-muted">NEXT STATION</span>
            <span className="truncate whitespace-nowrap text-[20px] font-semibold uppercase tracking-[0.04em] sm:text-[24px]">{next.name}</span>
          </div>
          <span className="tabular font-mono text-[22px] text-ink">{formatClock(snap.etaNext)}</span>
        </div>
      )}

      {(phase === "arrived" || phase === "doors-opening") && current && (
        <div key={`arr-${current.id}`} className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-7 px-6 animate-rise-in">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_45%_at_50%_50%,rgba(7,11,18,0.55),rgba(7,11,18,0))]" />
          <StationName name={current.name} nameTa={current.nameTa} />
          {phase === "doors-opening" && <StatusPill text="Doors opening…" dot="#3dd68c" />}
        </div>
      )}

      {(phase === "doors-open" || phase === "doors-closing") && current && (
        <div
          key={`dwell-${current.id}`}
          className="pointer-events-none absolute left-1/2 top-[86px] z-10 flex -translate-x-1/2 flex-col items-center gap-3 animate-fade-in md:top-[96px] lg:top-[88px]"
        >
          <div className="hud-panel flex items-center gap-3 rounded-[12px] px-5 py-3">
            <span aria-hidden="true" className="h-3 w-1 rounded-full bg-route" />
            <span className="text-[15px] font-semibold uppercase tracking-[0.06em]">{current.name}</span>
            {current.nameTa && (
              <span lang="ta" className="font-tamil hidden text-[15px] text-[#c9d1dc] sm:inline">
                {current.nameTa}
              </span>
            )}
          </div>
          {phase === "doors-closing" ? (
            <StatusPill text="Doors closing…" dot="#f2b705" />
          ) : (
            <StatusPill text={snap.currentStationIndex === stops.length - 1 ? "This train terminates here" : "Doors open"} dot="#3dd68c" />
          )}
        </div>
      )}

      {phase === "departed" && next && (
        <div
          key={`dep-${next.id}`}
          className="hud-panel pointer-events-none absolute bottom-[196px] left-1/2 z-10 -translate-x-1/2 rounded-full px-5 py-2.5 text-[14px] text-subtle animate-fade-in md:bottom-[112px]"
        >
          Next: <span className="font-semibold text-ink">{next.name}</span>
          <span className="tabular ml-2 font-mono text-muted">{formatClock(snap.etaNext)}</span>
        </div>
      )}
    </>
  );
}

/** Polite live region so screen-reader users hear the journey progress. */
export function ArrivalAnnouncer({ engine, snap }: { engine: SimulationEngine; snap: SimulationState }) {
  const stops = engine.journey.stops;
  const current = stops[snap.currentStationIndex]?.station;
  const next = stops[snap.nextStationIndex]?.station;
  let message = "";
  if (snap.finished && current) message = `Arrived at ${current.name}. Journey complete.`;
  else if (snap.arrival === "approaching" && next) message = `Next station: ${next.name}.`;
  else if (snap.arrival === "arrived" && current) message = `${current.name}.`;
  else if (snap.arrival === "doors-closing") message = "Doors closing.";
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  );
}
