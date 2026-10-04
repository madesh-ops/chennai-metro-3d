"use client";

import { useEffect, useRef } from "react";
import type { SimulationEngine } from "../simulation/SimulationEngine";
import { useViewStore } from "../simulation/store";
import { createNoiseBuffer, duckLevel, getAudioContext } from "../utils/audio";

/**
 * Sounds inside the car, heard only from the Passenger camera: the air
 * conditioning's steady hum (a touch louder with the doors shut), a soft
 * two-note chime as the doors open, and a quick warning chime as they start
 * to close. All synthesised; it mixes under the recorded train sounds.
 */

/** Fade when entering or leaving the Passenger camera (seconds). */
const FADE_S = 0.6;
const MASTER = 0.5;

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  hum: GainNode;
  sources: AudioScheduledSourceNode[];
}

function build(ctx: AudioContext): Graph {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  // AC: a low airy rumble plus a faint fan whine.
  const hum = ctx.createGain();
  hum.gain.value = 0;
  hum.connect(master);
  const air = ctx.createBufferSource();
  air.buffer = createNoiseBuffer(ctx, "brown");
  air.loop = true;
  const airLp = ctx.createBiquadFilter();
  airLp.type = "lowpass";
  airLp.frequency.value = 420;
  air.connect(airLp).connect(hum);
  const hiss = ctx.createBufferSource();
  hiss.buffer = createNoiseBuffer(ctx, "white");
  hiss.loop = true;
  const hissBp = ctx.createBiquadFilter();
  hissBp.type = "bandpass";
  hissBp.frequency.value = 2400;
  hissBp.Q.value = 0.7;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.04;
  hiss.connect(hissBp).connect(hissGain).connect(hum);
  const fan = ctx.createOscillator();
  fan.type = "sine";
  fan.frequency.value = 118;
  const fanGain = ctx.createGain();
  fanGain.gain.value = 0.025;
  fan.connect(fanGain).connect(hum);
  air.start();
  hiss.start(0, 0.7);
  fan.start();
  return { ctx, master, hum, sources: [air, hiss, fan] };
}

function teardown(g: Graph) {
  for (const s of g.sources) {
    try {
      s.stop();
    } catch {
      // already stopped
    }
  }
  try {
    g.master.disconnect();
  } catch {
    // ignore
  }
}

/** A soft bell-like tone through the master bus. */
function tone(g: Graph, freq: number, start: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const { ctx } = g;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(g.master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
  osc.onended = () => env.disconnect();
}

export function useCabinSounds(engine: SimulationEngine, { enabled, volume }: { enabled: boolean; volume: number }) {
  const graphRef = useRef<Graph | null>(null);
  const opts = useRef({ enabled, volume });
  useEffect(() => {
    opts.current = { enabled, volume };
  }, [enabled, volume]);
  const probe = useRef({ fade: 0, hum: 0, chimes: 0 });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let fade = 0;
    let silentFor = 0;
    let hidden = document.visibilityState === "hidden";
    const onVis = () => {
      hidden = document.visibilityState === "hidden";
      const g = graphRef.current;
      if (g && hidden) g.master.gain.setTargetAtTime(0, g.ctx.currentTime, 0.05);
    };
    document.addEventListener("visibilitychange", onVis);

    const audible = () => {
      const mode = useViewStore.getState().cameraMode;
      return opts.current.enabled && !hidden && engine.started && mode === "passenger";
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const want = audible();
      fade = Math.max(0, Math.min(1, fade + (want ? dt : -dt) / FADE_S));
      probe.current.fade = fade;
      if (!want && fade <= 0) {
        silentFor += dt;
        if (graphRef.current && silentFor > 3) {
          teardown(graphRef.current);
          graphRef.current = null;
        }
        return;
      }
      silentFor = 0;
      if (!graphRef.current) {
        const ctx = getAudioContext();
        if (!ctx) return;
        try {
          graphRef.current = build(ctx);
        } catch {
          return;
        }
      }
      const g = graphRef.current;
      const t = g.ctx.currentTime;
      g.master.gain.setTargetAtTime(MASTER * opts.current.volume * duckLevel() * fade, t, 0.08);
      // Doors open: a little more of the outside comes in and the hum sits lower.
      const humLevel = 0.28 * (1 - 0.35 * engine.sample.door);
      g.hum.gain.setTargetAtTime(humLevel, t, 0.3);
      probe.current.hum = humLevel * fade;
    };
    raf = requestAnimationFrame(tick);

    // Door chimes, timed to the simulation (the doors open after the train settles).
    const timers: number[] = [];
    const off = engine.onEvent((e) => {
      const g = graphRef.current;
      if (!g || !audible()) return;
      if (e.type === "arrived") {
        const delay = (engine.route.operations.settleBeforeDoorsSeconds / Math.max(0.25, engine.clock.speed)) * 1000;
        timers.push(
          window.setTimeout(() => {
            const gg = graphRef.current;
            if (!gg || !audible()) return;
            // Two-note "doors opening" chime.
            tone(gg, 783.99, 0, 0.7, 0.16);
            tone(gg, 587.33, 0.28, 0.9, 0.16);
            probe.current.chimes++;
          }, delay),
        );
      } else if (e.type === "doors-closing") {
        // Quick warning before the doors move.
        for (let i = 0; i < 4; i++) tone(g, 1046.5, i * 0.22, 0.14, 0.09, "triangle");
        probe.current.chimes++;
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      timers.forEach((id) => window.clearTimeout(id));
      off();
      if (graphRef.current) teardown(graphRef.current);
      graphRef.current = null;
    };
  }, [engine]);

  // Dev-only probe for automated checks.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __cm3dCabinSounds?: () => unknown };
    w.__cm3dCabinSounds = () => ({
      active: Boolean(graphRef.current),
      state: graphRef.current?.ctx.state ?? null,
      ...probe.current,
    });
    return () => {
      delete w.__cm3dCabinSounds;
    };
  }, []);
}
