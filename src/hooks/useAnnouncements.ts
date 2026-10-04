"use client";

import { useEffect } from "react";
import { getAudioContext, setDucked } from "../utils/audio";
import type { SimulationEngine } from "../simulation/SimulationEngine";

/**
 * Station announcements using only free, local browser features:
 * SpeechSynthesis for the voice and WebAudio for chimes. Everything is
 * optional — if either API is missing or blocked, the ride continues.
 */
export function useAnnouncements(engine: SimulationEngine | null, enabled: boolean) {
  useEffect(() => {
    if (!engine || !enabled) return;

    const audio = () => getAudioContext();

    const tone = (freq: number, start: number, dur: number, gain = 0.12) => {
      const ctx = audio();
      if (!ctx) return;
      const t0 = ctx.currentTime + start;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    };

    const chime = () => {
      tone(659.25, 0, 0.9);
      tone(523.25, 0.32, 1.1);
    };
    const doorBeeps = () => {
      for (let i = 0; i < 3; i++) tone(988, i * 0.32, 0.18, 0.08);
    };

    const speak = (text: string) => {
      try {
        const synth = window.speechSynthesis;
        if (!synth) return;
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const voices = synth.getVoices();
        u.voice = voices.find((v) => v.lang === "en-IN") ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
        u.rate = 0.95;
        // Street sounds dip while the voice speaks.
        u.onstart = () => setDucked(true);
        u.onend = () => setDucked(false);
        u.onerror = () => setDucked(false);
        synth.speak(u);
      } catch {
        // Speech is a nice-to-have.
      }
    };

    const off = engine.onEvent((e) => {
      // Skip voice at high playback speeds where announcements would overlap.
      const fast = engine.clock.speed > 2;
      if (e.type === "approaching") {
        const stop = engine.journey.stops[e.stopIndex];
        if (!stop) return;
        chime();
        if (!fast) speak(`The next station is ${stop.station.name}.`);
      } else if (e.type === "arrived") {
        const stop = engine.journey.stops[e.stopIndex];
        if (stop && !fast) speak(`This is ${stop.station.name}.${e.stopIndex === engine.journey.stops.length - 1 ? " This train terminates here." : ""}`);
      } else if (e.type === "doors-closing") {
        doorBeeps();
      }
    });
    return () => {
      off();
      setDucked(false);
      try {
        window.speechSynthesis?.cancel();
      } catch {
        // ignore
      }
    };
  }, [engine, enabled]);
}
