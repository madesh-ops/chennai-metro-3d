"use client";

import { useEffect, useRef } from "react";
import type { SimulationEngine } from "../simulation/SimulationEngine";
import { trainSoundLayers, type ClipLengths, type TrainClip } from "../simulation/trainSoundPlan";
import { useViewStore } from "../simulation/store";
import { duckLevel } from "../utils/audio";

const SOURCES: Record<TrainClip, string> = {
  start: "/audio/train-start.mp3",
  run: "/audio/train-running.mp3",
  stop: "/audio/train-stop.mp3",
};
/** Elements per clip: the loop needs two for its overlapping repeats. */
const POOL: Record<TrainClip, number> = { start: 1, run: 2, stop: 1 };
/** Fade when entering or leaving the Driver / Passenger cameras (seconds). */
const MODE_FADE_S = 0.5;

interface Track {
  clip: TrainClip;
  el: HTMLAudioElement;
  /** Layer key this element is playing, if any. */
  key: string | null;
  playPending: boolean;
}

type PitchAudio = HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };

function createTracks(): Track[] {
  const tracks: Track[] = [];
  for (const clip of Object.keys(SOURCES) as TrainClip[]) {
    for (let i = 0; i < POOL[clip]; i++) {
      const el = new Audio() as PitchAudio;
      el.preload = "auto";
      el.src = SOURCES[clip];
      // Keep a natural pitch when the ride plays at 0.5×–4×.
      el.preservesPitch = true;
      el.webkitPreservesPitch = true;
      el.mozPreservesPitch = true;
      el.volume = 0;
      tracks.push({ clip, el, key: null, playPending: false });
    }
  }
  return tracks;
}

function lengths(tracks: Track[]): ClipLengths | null {
  const len = (c: TrainClip) => tracks.find((t) => t.clip === c)?.el.duration ?? NaN;
  const out = { start: len("start"), run: len("run"), stop: len("stop") };
  return Number.isFinite(out.start) && Number.isFinite(out.run) && Number.isFinite(out.stop) ? out : null;
}

function pause(t: Track) {
  if (!t.el.paused) t.el.pause();
}

/**
 * Recorded train sounds in the Driver and Passenger cameras: a departure clip,
 * a running loop and a braking clip that ends as the train halts. What should
 * play comes from trainSoundLayers() (a pure function of simulation time);
 * this hook keeps a few <audio> elements matched to it, so pausing, seeking
 * and 0.5×–4× playback stay in sync.
 */
export function useTrainSounds(engine: SimulationEngine, { enabled, volume }: { enabled: boolean; volume: number }) {
  const tracksRef = useRef<Track[] | null>(null);
  const opts = useRef({ enabled, volume });
  useEffect(() => {
    opts.current = { enabled, volume };
  }, [enabled, volume]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let fade = 0;
    let hidden = document.visibilityState === "hidden";

    const stopAll = () => tracksRef.current?.forEach(pause);
    const onVis = () => {
      hidden = document.visibilityState === "hidden";
      if (hidden) stopAll();
    };
    document.addEventListener("visibilitychange", onVis);

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const mode = useViewStore.getState().cameraMode;
      const want = opts.current.enabled && !hidden && engine.started && (mode === "driver" || mode === "passenger");
      fade = Math.max(0, Math.min(1, fade + (want ? dt : -dt) / MODE_FADE_S));

      if (!tracksRef.current) {
        if (!want) return;
        tracksRef.current = createTracks();
      }
      const tracks = tracksRef.current;
      const len = lengths(tracks);
      if (fade <= 0 || !len || !engine.clock.playing) {
        // Fully faded out, still loading, or the ride is paused.
        tracks.forEach(pause);
        if (fade <= 0) tracks.forEach((t) => (t.key = null));
        return;
      }

      const layers = trainSoundLayers(engine.clock.time, engine.trajectory.stops, len);
      const wanted = new Set(layers.map((l) => l.key));
      for (const t of tracks) if (t.key && !wanted.has(t.key)) t.key = null;

      const speed = engine.clock.speed;
      const level = opts.current.volume * duckLevel() * fade;
      for (const layer of layers) {
        let t = tracks.find((tr) => tr.key === layer.key);
        if (!t) {
          t = tracks.find((tr) => tr.clip === layer.clip && tr.key === null);
          if (!t) continue;
          t.key = layer.key;
          t.el.currentTime = layer.offset;
        }
        const el = t.el;
        if (el.playbackRate !== speed) el.playbackRate = speed;
        el.volume = Math.min(1, Math.max(0, layer.gain * level));
        // Re-sync after a seek, skip or speed change (or a slow start).
        if (Math.abs(el.currentTime - layer.offset) > 0.25 + 0.05 * speed) el.currentTime = layer.offset;
        if (el.paused && !t.playPending) {
          t.playPending = true;
          const track = t;
          // Rejected until the user has interacted with the page; retried next frame.
          el.play()
            .catch(() => undefined)
            .finally(() => {
              track.playPending = false;
            });
        }
      }
      for (const t of tracks) if (!t.key) pause(t);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      stopAll();
    };
  }, [engine]);

  // Release the audio elements when the simulator closes.
  useEffect(
    () => () => {
      tracksRef.current?.forEach((t) => {
        t.el.pause();
        t.el.removeAttribute("src");
        t.el.load();
      });
      tracksRef.current = null;
    },
    [],
  );

  // Dev-only probe for automated checks.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __cm3dTrainAudio?: () => unknown };
    w.__cm3dTrainAudio = () => ({
      time: Number(engine.clock.time.toFixed(2)),
      speed: engine.clock.speed,
      tracks: (tracksRef.current ?? []).map((t) => ({
        clip: t.clip,
        key: t.key,
        paused: t.el.paused,
        at: Number(t.el.currentTime.toFixed(2)),
        rate: t.el.playbackRate,
        volume: Number(t.el.volume.toFixed(2)),
      })),
      plan: (() => {
        const len = tracksRef.current ? lengths(tracksRef.current) : null;
        return len ? trainSoundLayers(engine.clock.time, engine.trajectory.stops, len).map((l) => `${l.key}@${l.offset.toFixed(2)}×${l.gain.toFixed(2)}`) : null;
      })(),
    });
    return () => {
      delete w.__cm3dTrainAudio;
    };
  }, [engine]);
}
