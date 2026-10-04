"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";
import { useScene, type TrafficVehicle } from "./SceneContext.tsx";
import { ROAD } from "./layout.ts";
import { LANE_SPEED, createPlacement, placeVehicle } from "./trafficPlacement.ts";
import {
  ENGINE,
  distanceGain,
  dopplerRatio,
  hornProfile,
  listenerCutoff,
  listenerDistance,
  listenerLevel,
  nextHornDelay,
  pickNearest,
} from "./trafficAudioMath.ts";
import { createNoiseBuffer, duckLevel, getAudioContext } from "../utils/audio.ts";
import { mulberry32, pick } from "../utils/random.ts";

/** Pass-by voices: the closest vehicles each get one. */
const VOICES = 4;
const PASSBY_RANGE = 70;
const HORN_RANGE = 120;
/** Overall ceiling, kept below the announcements. */
const MASTER = 0.55;
/** Seconds of silence before the audio graph is torn down. */
const IDLE_TEARDOWN_S = 3;

interface Voice {
  osc: OscillatorNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  engineFilter: BiquadFilterNode;
  tyre: AudioBufferSourceNode;
  tyreGain: GainNode;
  gain: GainNode;
  pan: StereoPannerNode;
  vehicle: TrafficVehicle | null;
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  bus: GainNode;
  humGain: GainNode;
  /** Muffles the whole mix with distance. */
  busFilter: BiquadFilterNode;
  sources: AudioScheduledSourceNode[];
  voices: Voice[];
}

interface Candidate {
  v: TrafficVehicle;
  d: number;
  x: number;
  z: number;
  /** Direction of travel. */
  fx: number;
  fz: number;
}

export interface TrafficAudioProps {
  /** Camera mode allows it, setting is on, traffic is shown and the ride has started. */
  enabled: boolean;
  /** 0..1 from Settings. */
  volume: number;
  /** Traffic only moves while the simulation plays. */
  getPlaying: () => boolean;
  getPlaybackSpeed: () => number;
}

function buildGraph(ctx: AudioContext): Graph {
  const master = ctx.createGain();
  master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);

  // Everything below feeds the bus; the bus applies the zoom fade and muffling.
  const bus = ctx.createGain();
  const busFilter = ctx.createBiquadFilter();
  busFilter.type = "lowpass";
  busFilter.frequency.value = 2000;
  bus.connect(busFilter).connect(master);

  const brown = createNoiseBuffer(ctx, "brown");
  const white = createNoiseBuffer(ctx, "white");
  const sources: AudioScheduledSourceNode[] = [];

  // Road hum: deep rumble plus a little tyre hiss.
  const humGain = ctx.createGain();
  humGain.gain.value = 0;
  const rumble = ctx.createBufferSource();
  rumble.buffer = brown;
  rumble.loop = true;
  const rumbleLp = ctx.createBiquadFilter();
  rumbleLp.type = "lowpass";
  rumbleLp.frequency.value = 520;
  rumble.connect(rumbleLp).connect(humGain);
  const hiss = ctx.createBufferSource();
  hiss.buffer = white;
  hiss.loop = true;
  const hissBp = ctx.createBiquadFilter();
  hissBp.type = "bandpass";
  hissBp.frequency.value = 1100;
  hissBp.Q.value = 0.6;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.05;
  hiss.connect(hissBp).connect(hissGain).connect(humGain);
  humGain.connect(bus);
  rumble.start();
  hiss.start(0, 1.3);
  sources.push(rumble, hiss);

  const voices: Voice[] = [];
  for (let i = 0; i < VOICES; i++) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    gain.connect(pan).connect(bus);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 70;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0;
    lfo.connect(lfoGain).connect(osc.frequency);
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 380;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.22;
    osc.connect(engineFilter).connect(engineGain).connect(gain);

    const tyre = ctx.createBufferSource();
    tyre.buffer = white;
    tyre.loop = true;
    const tyreBp = ctx.createBiquadFilter();
    tyreBp.type = "bandpass";
    tyreBp.frequency.value = 750;
    tyreBp.Q.value = 0.8;
    const tyreGain = ctx.createGain();
    tyreGain.gain.value = 0.2;
    tyre.connect(tyreBp).connect(tyreGain).connect(gain);

    osc.start();
    lfo.start();
    tyre.start(0, (i * 0.97) % 3.5);
    sources.push(osc, lfo, tyre);
    voices.push({ osc, lfo, lfoGain, engineFilter, tyre, tyreGain, gain, pan, vehicle: null });
  }
  return { ctx, master, bus, humGain, busFilter, sources, voices };
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

/**
 * Street soundscape: a road hum, pass-bys from the nearest vehicles and the
 * occasional horn, all synthesised (no audio files). It follows the same
 * simulated cars as <Traffic>, and the whole mix fades and muffles as the
 * camera rises away from the road, so zooming out in Free Camera quietens it.
 */
export function TrafficAudio({ enabled, volume, getPlaying, getPlaybackSpeed }: TrafficAudioProps) {
  const { route, pose, env, traffic, range } = useScene();
  const camera = useThree((s) => s.camera);
  const graph = useRef<Graph | null>(null);
  const st = useRef({ silentFor: 0, hornIn: 2, projected: NaN, hidden: false, level: { master: 0, hum: 0 }, horns: 0 });
  const tmp = useMemo(
    () => ({
      pt: { x: 0, z: 0 },
      tan: { x: 0, z: 0 },
      right: new Vector3(),
      prevCam: new Vector3(),
      camVel: new Vector3(),
      candidates: [] as Candidate[],
      place: createPlacement(),
      rng: mulberry32(911),
    }),
    [],
  );

  // Silence immediately when the tab is hidden (frames stop, audio wouldn't).
  useEffect(() => {
    const onVis = () => {
      st.current.hidden = document.visibilityState === "hidden";
      const g = graph.current;
      if (g && st.current.hidden) g.master.gain.setTargetAtTime(0, g.ctx.currentTime, 0.05);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(
    () => () => {
      if (graph.current) teardown(graph.current);
      graph.current = null;
    },
    [],
  );

  // Dev-only probe for automated checks.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __cm3dAudioDebug?: () => unknown };
    w.__cm3dAudioDebug = () => ({
      active: Boolean(graph.current),
      state: graph.current?.ctx.state ?? null,
      master: st.current.level.master,
      hum: st.current.level.hum,
      horns: st.current.horns,
      voices: graph.current?.voices.map((v) => Number(v.gain.gain.value.toFixed(3))) ?? [],
    });
    return () => {
      delete w.__cm3dAudioDebug;
    };
  }, []);

  const hornAt = (g: Graph, c: Candidate, gain: number, pan: number) => {
    const { ctx } = g;
    const h = hornProfile(c.v.kind, tmp.rng);
    const out = ctx.createGain();
    out.gain.value = 0;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2400;
    out.connect(lp).connect(p).connect(g.bus);
    const t0 = ctx.currentTime + 0.02;
    const peak = gain * h.level;
    let t = t0;
    for (let b = 0; b < h.beeps; b++) {
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(peak, t + 0.015);
      out.gain.setValueAtTime(peak, t + h.beepSeconds - 0.03);
      out.gain.linearRampToValueAtTime(0, t + h.beepSeconds);
      t += h.beepSeconds + h.gapSeconds;
    }
    for (const f of h.freqs) {
      const o = ctx.createOscillator();
      o.type = h.wave;
      o.frequency.value = f;
      o.connect(out);
      o.start(t0);
      o.stop(t + 0.05);
      o.onended = () => {
        try {
          out.disconnect();
        } catch {
          // ignore
        }
      };
    }
  };

  useFrame((_, delta) => {
    const s = st.current;
    const dt = Math.min(delta, 0.1);
    const want = enabled && !s.hidden;

    if (!want) {
      const g = graph.current;
      if (!g) return;
      g.master.gain.setTargetAtTime(0, g.ctx.currentTime, 0.25);
      s.level.master = 0;
      s.level.hum = 0;
      s.silentFor += dt;
      if (s.silentFor > IDLE_TEARDOWN_S) {
        teardown(g);
        graph.current = null;
      }
      return;
    }
    s.silentFor = 0;
    if (!graph.current) {
      const ctx = getAudioContext();
      if (!ctx) return;
      try {
        graph.current = buildGraph(ctx);
      } catch {
        return;
      }
      tmp.prevCam.copy(camera.position);
      s.projected = NaN;
    }
    const g = graph.current;
    const now = g.ctx.currentTime;
    const playing = getPlaying();
    const speed = getPlaybackSpeed();

    // Listener: camera position, its right-hand direction and velocity.
    const cam = camera.position;
    tmp.right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    tmp.camVel.subVectors(cam, tmp.prevCam).divideScalar(Math.max(dt, 1e-3));
    tmp.prevCam.copy(cam);

    // Distance from the road for the hum and the zoom fade.
    const { alignment } = route;
    const guess = Number.isFinite(s.projected) ? s.projected : pose.centerDistance;
    s.projected = alignment.project(cam.x, cam.z, guess, Number.isFinite(s.projected) ? 400 : 3000);
    alignment.point(s.projected, tmp.pt);
    const lateral = Math.max(0, Math.hypot(cam.x - tmp.pt.x, cam.z - tmp.pt.z) - ROAD.halfWidth);
    const listenerD = listenerDistance(cam.y, lateral);
    const zoom = listenerLevel(listenerD);

    const masterTarget = MASTER * volume * duckLevel();
    g.master.gain.setTargetAtTime(masterTarget, now, 0.25);
    g.bus.gain.setTargetAtTime(zoom, now, 0.1);
    g.busFilter.frequency.setTargetAtTime(listenerCutoff(listenerD), now, 0.1);
    const hum = 0.32 * (playing ? 1 : 0.6) * (1 - 0.15 * env.night);
    g.humGain.gain.setTargetAtTime(hum, now, 0.3);
    s.level.master = masterTarget * zoom;
    s.level.hum = hum * zoom;

    // Candidate vehicles near the listener (cheap prefilter on alignment distance).
    const cands = tmp.candidates;
    cands.length = 0;
    const reach = HORN_RANGE + cam.y;
    for (const v of traffic.vehicles) {
      // Cheap prefilter on corridor distance; side-road traffic is few enough to place directly.
      if (!v.road && Math.abs(v.s - s.projected) > reach) continue;
      const at = placeVehicle(route, v, range, tmp.place);
      if (!at.visible) continue;
      const d = Math.hypot(at.x - cam.x, at.y + 1 - cam.y, at.z - cam.z);
      if (d <= HORN_RANGE) cands.push({ v, d, x: at.x, z: at.z, fx: at.fx, fz: at.fz });
    }

    // Pass-bys: keep a voice on its vehicle while it stays among the nearest.
    const nearest = pickNearest(cands, VOICES, PASSBY_RANGE);
    const free: Voice[] = [];
    for (const voice of g.voices) {
      if (!voice.vehicle || !nearest.some((c) => c.v === voice.vehicle)) {
        voice.vehicle = null;
        free.push(voice);
      }
    }
    for (const c of nearest) {
      if (!g.voices.some((vo) => vo.vehicle === c.v)) {
        const vo = free.shift();
        if (vo) vo.vehicle = c.v;
      }
    }
    for (const voice of g.voices) {
      const c = voice.vehicle ? nearest.find((n) => n.v === voice.vehicle) : undefined;
      if (!c) {
        voice.gain.gain.setTargetAtTime(0, now, 0.12);
        continue;
      }
      const e = ENGINE[c.v.kind];
      const dx = cam.x - c.x;
      const dz = cam.z - c.z;
      const inv = 1 / Math.max(c.d, 1);
      // Vehicle velocity in real time (traffic runs at playback speed).
      const vs = playing ? LANE_SPEED[c.v.lane] * speed : 0;
      const radial = ((c.fx * vs - tmp.camVel.x) * dx + (c.fz * vs - tmp.camVel.z) * dz) * inv;
      const ratio = dopplerRatio(radial);
      const moving = playing ? 1 : 0.3;
      const freq = e.hz * ratio * (playing ? 1 : 0.8);
      voice.osc.frequency.setTargetAtTime(freq, now, 0.08);
      voice.lfo.frequency.setTargetAtTime(e.lfoHz, now, 0.2);
      voice.lfoGain.gain.setTargetAtTime(freq * e.lfoDepth, now, 0.2);
      voice.engineFilter.frequency.setTargetAtTime(260 + e.hz * 2.5, now, 0.2);
      voice.tyreGain.gain.setTargetAtTime(playing ? 0.22 : 0.02, now, 0.2);
      voice.gain.gain.setTargetAtTime(0.9 * distanceGain(c.d, 6, PASSBY_RANGE) * e.level * moving, now, 0.08);
      const pan = Math.max(-1, Math.min(1, -(dx * tmp.right.x + dz * tmp.right.z) * inv)) * 0.85;
      voice.pan.pan.setTargetAtTime(pan, now, 0.08);
    }

    // The occasional horn from somewhere nearby (only while traffic moves).
    s.hornIn -= dt;
    if (s.hornIn <= 0) {
      s.hornIn = nextHornDelay(tmp.rng, speed);
      if (playing && cands.length && g.ctx.state === "running") {
        const c = pick(tmp.rng, cands);
        const gain = distanceGain(c.d, 8, HORN_RANGE);
        if (gain > 0.02) {
          const inv = 1 / Math.max(c.d, 1);
          const pan = Math.max(-1, Math.min(1, ((c.x - cam.x) * tmp.right.x + (c.z - cam.z) * tmp.right.z) * inv)) * 0.85;
          hornAt(g, c, gain, pan);
          s.horns++;
        }
      }
    }
  });

  return null;
}
