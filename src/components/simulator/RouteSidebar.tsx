"use client";

import { useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight } from "../ui/Icons";
import type { SimulationEngine } from "../../simulation/SimulationEngine";
import type { SimulationState } from "../../simulation/types";
import { formatClock } from "../../utils/format";

interface Row {
  id: string;
  name: string;
  kind: "stop" | "pass";
  x: number;
  stopIndex: number;
}

export function useRouteRows(engine: SimulationEngine): Row[] {
  return useMemo(() => {
    let k = -1;
    return engine.journey.sequence.map((s) => {
      if (s.kind === "stop") k++;
      return { id: s.station.id, name: s.station.name, kind: s.kind, x: s.x, stopIndex: s.kind === "stop" ? k : -1 };
    });
  }, [engine]);
}

/** The station list with live progress. Shared by the sidebar and the mobile sheet. */
export function RouteList({ engine, snap }: { engine: SimulationEngine; snap: SimulationState }) {
  const rows = useRouteRows(engine);
  const x = snap.trainProgress * engine.journey.length;
  const atStation = ["stopped", "doors-open", "doors-closing", "idle"].includes(snap.state);
  const currentStop = atStation ? snap.currentStationIndex : snap.nextStationIndex;
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>("[data-current='true']");
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentStop]);

  return (
    <ol ref={listRef} className="flex flex-col" aria-label="Stations on this journey">
      {rows.map((row, i) => {
        const next = rows[i + 1];
        const isCurrent = row.kind === "stop" && row.stopIndex === currentStop;
        const done = row.x < x - 1 && !isCurrent;
        const segFill = next ? Math.min(1, Math.max(0, (x - row.x) / Math.max(1, next.x - row.x))) : 0;
        const eta = row.kind === "stop" && row.stopIndex > snap.currentStationIndex ? engine.trajectory.stops[row.stopIndex]?.arriveTime - snap.elapsed : null;
        const pass = row.kind === "pass";
        return (
          <li
            key={row.id}
            data-current={isCurrent}
            className={`relative flex gap-3.5 ${pass ? "min-h-[30px]" : "min-h-[40px]"}`}
            aria-current={isCurrent ? "step" : undefined}
          >
            <div className="relative flex w-3.5 shrink-0 flex-col items-center">
              <span
                className={`relative z-10 shrink-0 rounded-full transition-all duration-500 ${
                  pass
                    ? `mt-[6px] h-2 w-2 border-[1.5px] ${done ? "border-route bg-route/40" : "border-faint bg-surface"}`
                    : isCurrent
                      ? "mt-[2px] h-3.5 w-3.5 border-[3px] border-accent bg-ink"
                      : done
                        ? "mt-[4px] h-2.5 w-2.5 bg-route"
                        : "mt-[4px] h-2.5 w-2.5 border-2 border-faint bg-surface"
                }`}
              />
              {next && (
                <span className="absolute bottom-0 top-[14px] w-[2px] overflow-hidden rounded bg-[#3a4556]">
                  <span
                    className="absolute inset-x-0 top-0 bg-route transition-[height] duration-300 ease-linear"
                    style={{ height: `${segFill * 100}%` }}
                  />
                </span>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 pb-2">
              <span
                className={`truncate leading-snug transition-colors duration-300 ${
                  pass
                    ? `text-[12px] ${done ? "text-faint" : "text-muted"}`
                    : isCurrent
                      ? "text-[15px] font-semibold text-ink"
                      : done
                        ? "text-[13px] text-faint"
                        : "text-[13px] text-[#b4bdca]"
                }`}
              >
                {row.name}
              </span>
              {pass && <span className="text-[10.5px] text-faint">Passes · not yet open</span>}
              {isCurrent && (
                <span className="tabular font-mono text-[11px] tracking-[0.06em] text-accent-soft">
                  {atStation ? (snap.finished ? "ARRIVED" : "AT PLATFORM") : `NEXT · ${formatClock(snap.etaNext)}`}
                </span>
              )}
              {!isCurrent && eta !== null && eta > 0 && !done && (
                <span className="tabular font-mono text-[10.5px] text-faint">{formatClock(eta)}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function RouteSidebar({
  engine,
  snap,
  open,
  onToggle,
  corridor,
}: {
  engine: SimulationEngine;
  snap: SimulationState;
  open: boolean;
  onToggle: () => void;
  corridor: string;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="Show route panel"
        aria-expanded={false}
        className="hud-panel pointer-events-auto absolute left-4 top-[86px] z-20 hidden h-11 items-center gap-2 rounded-[10px] px-3 text-[12px] font-semibold tracking-[0.12em] text-ink md:flex lg:top-[88px]"
      >
        {corridor.toUpperCase()}
        <ChevronRight size={16} />
      </button>
    );
  }
  return (
    <aside
      aria-label="Route progress"
      className="hud-panel pointer-events-auto absolute bottom-[132px] left-4 top-[86px] z-20 hidden w-[280px] flex-col gap-4 rounded-[14px] p-5 pb-3 animate-fade-in md:flex lg:left-5 lg:top-[88px] md:top-[128px]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[12px] font-semibold tracking-[0.14em]">{corridor.toUpperCase()}</span>
          <span className="truncate text-[12px] text-muted">Towards {engine.journey.to.name}</span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse route panel"
          aria-expanded
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line-strong text-subtle hover:text-ink"
        >
          <ChevronLeft size={15} />
        </button>
      </div>
      <div className="quiet-scroll -mr-2 flex-1 overflow-y-auto pr-2">
        <RouteList engine={engine} snap={snap} />
      </div>
    </aside>
  );
}
