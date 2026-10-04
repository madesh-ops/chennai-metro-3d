"use client";

import { useEffect } from "react";
import { getAudioContext, setDucked } from "../utils/audio";
import { useViewStore } from "../simulation/store";
import type { SimulationEngine } from "../simulation/SimulationEngine";

/**
 * Station announcements in the style of CMRL's on-board PA, using only free,
 * local browser features: SpeechSynthesis for the voice (English with an
 * en-IN voice, then Tamil with a ta-IN voice when the browser has one) and
 * WebAudio for chimes. Everything is optional — if either API is missing or
 * blocked, the ride continues; without a Tamil voice the Tamil line is
 * simply not spoken (the in-car displays still show it).
 */
export function useAnnouncements(engine: SimulationEngine | null, enabled: boolean, tamil = true) {
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

    // Voices load asynchronously in most browsers; keep the list fresh.
    let voices: SpeechSynthesisVoice[] = [];
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    const refreshVoices = () => {
      try {
        voices = synth?.getVoices() ?? [];
      } catch {
        voices = [];
      }
    };
    refreshVoices();
    synth?.addEventListener?.("voiceschanged", refreshVoices);
    const englishVoice = () => voices.find((v) => v.lang === "en-IN") ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
    const tamilVoice = () => voices.find((v) => v.lang === "ta-IN") ?? voices.find((v) => v.lang.toLowerCase().startsWith("ta")) ?? null;

    // Ducking spans the whole English + Tamil sequence.
    let speaking = 0;
    const duck = (on: boolean) => {
      speaking = Math.max(0, speaking + (on ? 1 : -1));
      setDucked(speaking > 0);
    };

    /** Speak English, then Tamil (queued, never cancelling each other). */
    const announce = (english: string, tamilText: string) => {
      try {
        if (!synth) return;
        // A new announcement replaces whatever was still queued from the last one.
        synth.cancel();
        speaking = 0;
        setDucked(false);
        const lines: { text: string; voice: SpeechSynthesisVoice | null; lang: string }[] = [
          { text: english, voice: englishVoice(), lang: "en-IN" },
        ];
        const ta = tamil ? tamilVoice() : null;
        if (ta) lines.push({ text: tamilText, voice: ta, lang: "ta-IN" });
        for (const line of lines) {
          const u = new SpeechSynthesisUtterance(line.text);
          u.voice = line.voice;
          u.lang = line.lang;
          u.rate = 0.95;
          u.onstart = () => duck(true);
          u.onend = () => duck(false);
          u.onerror = () => duck(false);
          synth.speak(u);
        }
      } catch {
        // Speech is a nice-to-have.
      }
    };

    const names = (i: number) => {
      const st = engine.journey.stops[i]?.station;
      return st ? { en: st.name, ta: st.nameTa ?? st.name } : null;
    };

    const off = engine.onEvent((e) => {
      // Skip voice at high playback speeds where announcements would overlap.
      const fast = engine.clock.speed > 2;
      if (e.type === "approaching") {
        const n = names(e.stopIndex);
        if (!n) return;
        chime();
        if (!fast)
          announce(
            `Next station is ${n.en}. Doors will open on the left side.`,
            `அடுத்த நிலையம் ${n.ta}. கதவுகள் இடது பக்கம் திறக்கும்.`,
          );
      } else if (e.type === "arrived") {
        const n = names(e.stopIndex);
        if (!n || fast) return;
        if (e.stopIndex === engine.journey.stops.length - 1) {
          announce(
            `This is ${n.en}. This train terminates here. Please alight.`,
            `இது ${n.ta} நிலையம். இந்த ரயில் இங்கே முடிவடைகிறது. அனைவரும் இறங்கவும்.`,
          );
        } else {
          announce(`This is ${n.en}.`, `இது ${n.ta} நிலையம்.`);
        }
      } else if (e.type === "doors-closing") {
        // In the Passenger camera the cabin sounds play their own door warning.
        if (useViewStore.getState().cameraMode !== "passenger") doorBeeps();
      }
    });
    return () => {
      off();
      synth?.removeEventListener?.("voiceschanged", refreshVoices);
      setDucked(false);
      try {
        synth?.cancel();
      } catch {
        // ignore
      }
    };
  }, [engine, enabled, tamil]);
}
