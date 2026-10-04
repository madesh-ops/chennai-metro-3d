"use client";

import { useMemo } from "react";
import { RouteMap } from "../route/RouteMap";
import { getRouteSummary } from "../../lib/getRouteSummary";
import type { SimulationEngine } from "../../simulation/SimulationEngine";
import type { SimulationState } from "../../simulation/types";
import { Info } from "../ui/Icons";

/**
 * Shown when WebGL is unavailable or the 3D scene fails: the same journey,
 * clock and controls, drawn on the route map instead of in 3D.
 */
export type FallbackReason = "unsupported" | "failed" | "context-lost" | "chose-2d";

const MESSAGES: Record<FallbackReason, string> = {
  unsupported:
    "3D graphics (WebGL) aren't available in this browser, so the journey is shown on the route map instead. Everything else works the same.",
  failed: "The 3D scene couldn't start on this device, so the journey continues on the route map.",
  "context-lost": "The graphics driver stopped the 3D scene, so the journey continues on the route map. Reload to try 3D again.",
  "chose-2d": "Showing the journey on the route map. Reload the page to try the 3D view again.",
};

export function FallbackView({ engine, snap, reason }: { engine: SimulationEngine; snap: SimulationState; reason: FallbackReason }) {
  const summary = useMemo(() => getRouteSummary(), []);
  const fromKm = engine.journey.from.km;
  const trainKm = fromKm + engine.journey.direction * (snap.distanceTravelled / 1000);
  return (
    <div className="absolute inset-0 flex flex-col bg-[#0a0f18]">
      <div className="absolute left-4 right-4 top-[76px] z-10 flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-[13px] leading-relaxed text-subtle md:bottom-[104px] md:left-[316px] md:right-auto md:top-auto md:max-w-[560px]">
        <Info size={18} className="mt-0.5 shrink-0 text-accent-soft" />
        <p>
          {MESSAGES[reason]}
        </p>
      </div>
      <div className="relative mt-[150px] flex-1 md:ml-[300px] md:mt-[60px]">
        <RouteMap
          summary={summary}
          from={engine.journey.from.id}
          to={engine.journey.to.id}
          trainKm={trainKm}
          className="absolute inset-0 h-full w-full p-4 pb-[300px] md:pb-[120px]"
          label="Live journey map"
        />
      </div>
    </div>
  );
}
