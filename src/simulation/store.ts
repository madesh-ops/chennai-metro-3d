"use client";

import { create } from "zustand";

export type CameraMode = "cinematic" | "driver" | "passenger" | "map" | "free";
export type TimeOfDay = "day" | "night";
export type Weather = "clear" | "cloudy" | "rain";
export type Quality = "high" | "medium" | "low";

export const CAMERA_MODES: { id: CameraMode; label: string; key: string }[] = [
  { id: "cinematic", label: "Cinematic", key: "1" },
  { id: "driver", label: "Driver", key: "2" },
  { id: "passenger", label: "Passenger", key: "3" },
  { id: "map", label: "Map", key: "4" },
  { id: "free", label: "Free Camera", key: "5" },
];

export interface Settings {
  quality: Quality;
  reducedMotion: boolean;
  audio: boolean;
  /** Synthesised traffic and horns in the Cinematic and Free cameras. */
  streetSound: boolean;
  /** 0..1 */
  streetVolume: number;
  /** Recorded departure / running / braking sounds in the Driver and Passenger cameras. */
  trainSound: boolean;
  /** 0..1 */
  trainVolume: number;
  weatherEffects: boolean;
  shadows: boolean;
  traffic: boolean;
  cameraShake: boolean;
}

interface ViewStore {
  cameraMode: CameraMode;
  timeOfDay: TimeOfDay;
  weather: Weather;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  /** Free camera keeps its framing relative to the moving train. */
  freeFollow: boolean;
  settings: Settings;
  setCameraMode: (m: CameraMode) => void;
  setTimeOfDay: (t: TimeOfDay) => void;
  toggleTimeOfDay: () => void;
  setWeather: (w: Weather) => void;
  setSidebarOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setFreeFollow: (follow: boolean) => void;
  updateSettings: (patch: Partial<Settings>) => void;
}

const SETTINGS_KEY = "cm3d.settings.v1";

function initialSettings(): Settings {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const lowEnd =
    typeof navigator !== "undefined" &&
    ((navigator.hardwareConcurrency ?? 8) <= 4 || /Mobi|Android/i.test(navigator.userAgent));
  const defaults: Settings = {
    quality: lowEnd ? "medium" : "high",
    reducedMotion: Boolean(reduced),
    audio: true,
    streetSound: true,
    streetVolume: 0.6,
    trainSound: true,
    trainVolume: 0.8,
    weatherEffects: true,
    shadows: !lowEnd,
    traffic: true,
    cameraShake: !reduced,
  };
  if (typeof window === "undefined") return defaults;
  try {
    const saved = window.localStorage.getItem(SETTINGS_KEY);
    if (saved) return { ...defaults, ...(JSON.parse(saved) as Partial<Settings>) };
  } catch {
    // Storage can be unavailable (private mode); defaults are fine.
  }
  return defaults;
}

export const useViewStore = create<ViewStore>((set, get) => ({
  cameraMode: "cinematic",
  timeOfDay: "day",
  weather: "clear",
  sidebarOpen: true,
  settingsOpen: false,
  freeFollow: true,
  settings: initialSettings(),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setTimeOfDay: (timeOfDay) => set({ timeOfDay }),
  toggleTimeOfDay: () => set({ timeOfDay: get().timeOfDay === "day" ? "night" : "day" }),
  setWeather: (weather) => set({ weather }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setFreeFollow: (freeFollow) => set({ freeFollow }),
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  },
}));
