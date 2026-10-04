"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { SimulationEngine } from "../simulation/SimulationEngine";
import type { SimulationState } from "../simulation/types";

/** Subscribe the DOM UI to the engine's throttled snapshot. */
export function useSimulation(engine: SimulationEngine): SimulationState {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
}

/** Drive the engine from requestAnimationFrame (independent of WebGL). */
export function useEngineLoop(engine: SimulationEngine | null) {
  useEffect(() => {
    if (!engine) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      engine.update(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine]);
}
