"use client";

import { useEffect, useRef, useState } from "react";
import { Logo } from "../ui/Logo";
import { Segmented } from "../ui/Segmented";
import { Clear, Cloud, CloudRain, Expand, Moon, More, Shrink, Sliders, Sun } from "../ui/Icons";
import { CAMERA_MODES, useViewStore, type CameraMode, type Weather } from "../../simulation/store";

export function useFullscreen() {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggle = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    } catch {
      // Fullscreen may be unavailable (iOS Safari); ignore.
    }
  };
  return { full, toggle };
}

export function CameraSwitcher({ compact = false }: { compact?: boolean }) {
  const mode = useViewStore((s) => s.cameraMode);
  const setMode = useViewStore((s) => s.setCameraMode);
  return (
    <Segmented<CameraMode>
      label="Camera"
      value={mode}
      onChange={setMode}
      size={compact ? "sm" : "md"}
      className="hud-panel"
      options={CAMERA_MODES.map((m) => ({ value: m.id, label: m.label }))}
    />
  );
}

const WEATHER: { id: Weather | "night"; label: string; icon: React.ReactNode }[] = [
  { id: "clear", label: "Clear", icon: <Clear size={16} /> },
  { id: "cloudy", label: "Cloudy", icon: <Cloud size={16} /> },
  { id: "rain", label: "Rain", icon: <CloudRain size={16} /> },
  { id: "night", label: "Night", icon: <Moon size={16} /> },
];

export function WeatherMenu() {
  const weather = useViewStore((s) => s.weather);
  const setWeather = useViewStore((s) => s.setWeather);
  const setTime = useViewStore((s) => s.setTimeOfDay);
  const effects = useViewStore((s) => s.settings.weatherEffects);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const icon = weather === "rain" ? <CloudRain /> : weather === "cloudy" ? <Cloud /> : <Clear />;
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Weather: ${weather}`}
        onClick={() => setOpen((o) => !o)}
        className="hud-panel inline-flex h-[42px] w-[42px] items-center justify-center rounded-[10px] text-[#d6dce4] hover:text-ink"
      >
        {icon}
      </button>
      {open && (
        <div role="menu" aria-label="Weather" className="hud-panel absolute right-0 top-[50px] z-40 flex w-44 flex-col rounded-xl p-1.5 animate-fade-in">
          {WEATHER.map((w) => {
            const checked = w.id === "night" ? false : weather === w.id;
            return (
              <button
                key={w.id}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                disabled={!effects && w.id !== "night" && w.id !== "clear"}
                onClick={() => {
                  if (w.id === "night") setTime("night");
                  else setWeather(w.id);
                  setOpen(false);
                }}
                className={`flex h-10 items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors disabled:opacity-40 ${
                  checked ? "bg-white/[0.08] text-ink" : "text-subtle hover:bg-white/[0.05] hover:text-ink"
                }`}
              >
                {w.icon}
                {w.label}
              </button>
            );
          })}
          {!effects && <p className="px-3 pb-1 pt-2 text-[11px] leading-snug text-muted">Weather effects are off in Settings.</p>}
        </div>
      )}
    </div>
  );
}

export function TimeToggle() {
  const time = useViewStore((s) => s.timeOfDay);
  const setTime = useViewStore((s) => s.setTimeOfDay);
  return (
    <Segmented
      label="Time of day"
      value={time}
      onChange={setTime}
      className="hud-panel"
      options={[
        { value: "day", label: <Sun size={16} />, ariaLabel: "Day" },
        { value: "night", label: <Moon size={16} />, ariaLabel: "Night" },
      ]}
    />
  );
}

export function IconButton({
  label,
  onClick,
  children,
  pressed,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="hud-panel inline-flex h-[42px] w-[42px] items-center justify-center rounded-[10px] text-[#d6dce4] transition-colors hover:text-ink"
    >
      {children}
    </button>
  );
}

export function TopBar({ onOpenMenu, threeD = true }: { onOpenMenu: () => void; threeD?: boolean }) {
  const { full, toggle } = useFullscreen();
  const setSettingsOpen = useViewStore((s) => s.setSettingsOpen);
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4 md:p-5">
      <div className="pointer-events-auto flex h-[42px] items-center rounded-[10px] md:pl-1">
        <span className="hidden md:inline">
          <Logo />
        </span>
        <span className="md:hidden">
          <Logo compact />
        </span>
      </div>
      {threeD && (
        <>
          <div className="pointer-events-auto absolute left-1/2 top-5 hidden -translate-x-1/2 lg:block">
            <CameraSwitcher />
          </div>
          <div className="pointer-events-auto absolute left-1/2 top-[70px] hidden -translate-x-1/2 md:block lg:hidden">
            <CameraSwitcher compact />
          </div>
        </>
      )}
      <div className="pointer-events-auto hidden items-center gap-2 md:flex">
        {threeD && <TimeToggle />}
        {threeD && <WeatherMenu />}
        <IconButton label={full ? "Exit fullscreen" : "Enter fullscreen"} onClick={toggle} pressed={full}>
          {full ? <Shrink /> : <Expand />}
        </IconButton>
        <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
          <Sliders />
        </IconButton>
      </div>
      <div className="pointer-events-auto md:hidden">
        {threeD ? (
          <IconButton label="Open menu: cameras, lighting, weather and settings" onClick={onOpenMenu}>
            <More />
          </IconButton>
        ) : (
          <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
            <Sliders />
          </IconButton>
        )}
      </div>
    </header>
  );
}
