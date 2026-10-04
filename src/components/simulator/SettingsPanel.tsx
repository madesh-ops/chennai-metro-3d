"use client";

import { useEffect, useRef } from "react";
import { Segmented } from "../ui/Segmented";
import { Close } from "../ui/Icons";
import { useViewStore, type CrowdLevel, type Quality } from "../../simulation/store";
import { SHORTCUT_HELP } from "../../hooks/useKeyboardShortcuts";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14px] text-ink">{label}</span>
        {hint && <span className="text-[12px] leading-snug text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function OnOff({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Segmented
      label={label}
      value={value ? "on" : "off"}
      onChange={(v) => onChange(v === "on")}
      size="sm"
      className="bg-surface-2"
      options={[
        { value: "on", label: "On" },
        { value: "off", label: "Off" },
      ]}
    />
  );
}

function VolumeSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-3 pb-3">
      <span className="text-[12px] text-muted">Volume</span>
      <input
        type="range"
        className="timeline-range flex-1"
        min={0}
        max={100}
        step={5}
        value={pct}
        aria-label={label}
        aria-valuetext={`${pct} percent`}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        style={{ ["--progress" as string]: `${pct}%` }}
      />
      <span className="tabular w-9 text-right font-mono text-[12px] text-ink">{pct}%</span>
    </div>
  );
}

export function SettingsPanel() {
  const open = useViewStore((s) => s.settingsOpen);
  const setOpen = useViewStore((s) => s.setSettingsOpen);
  const settings = useViewStore((s) => s.settings);
  const update = useViewStore((s) => s.updateSettings);
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement;
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab" && panel.current) {
        const items = panel.current.querySelectorAll<HTMLElement>("button:not([tabindex='-1']), a, [tabindex='0']");
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      returnFocus.current?.focus?.();
    };
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <button type="button" aria-label="Close settings" tabIndex={-1} className="absolute inset-0 bg-black/45 animate-fade-in" onClick={() => setOpen(false)} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="relative flex max-h-[88dvh] w-full max-w-[460px] flex-col rounded-t-2xl border border-white/[0.06] bg-surface shadow-2xl animate-rise-in sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 id="settings-title" className="text-[16px] font-semibold">
            Settings
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close settings"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-subtle hover:bg-white/5 hover:text-ink"
          >
            <Close size={18} />
          </button>
        </div>
        <div className="quiet-scroll overflow-y-auto px-6 py-2">
          <div className="divide-y divide-line">
            <Row label="Graphics quality" hint="Lower settings reduce city density, shadows and resolution.">
              <Segmented<Quality>
                label="Graphics quality"
                value={settings.quality}
                onChange={(quality) => update({ quality })}
                size="sm"
                className="bg-surface-2"
                options={[
                  { value: "high", label: "High" },
                  { value: "medium", label: "Medium" },
                  { value: "low", label: "Low" },
                ]}
              />
            </Row>
            <Row label="Motion" hint="Reduced keeps the camera steady and cuts instead of gliding.">
              <Segmented
                label="Motion"
                value={settings.reducedMotion ? "reduced" : "normal"}
                onChange={(v) => update({ reducedMotion: v === "reduced", cameraShake: v === "reduced" ? false : settings.cameraShake })}
                size="sm"
                className="bg-surface-2"
                options={[
                  { value: "normal", label: "Normal" },
                  { value: "reduced", label: "Reduced" },
                ]}
              />
            </Row>
            <Row label="Audio" hint="Chimes and spoken announcements (uses your browser's voice).">
              <OnOff label="Audio" value={settings.audio} onChange={(audio) => update({ audio })} />
            </Row>
            <Row label="Tamil announcements" hint="Speak each announcement in Tamil after English (needs a Tamil voice in your browser; the displays always show both).">
              <OnOff label="Tamil announcements" value={settings.announceTamil} onChange={(announceTamil) => update({ announceTamil })} />
            </Row>
            <Row label="Crowd" hint="Passengers in the train and on platforms. Auto follows your clock's peak hours.">
              <Segmented<CrowdLevel>
                label="Crowd"
                value={settings.crowd}
                onChange={(crowd) => update({ crowd })}
                size="sm"
                className="bg-surface-2"
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "light", label: "Light" },
                  { value: "busy", label: "Busy" },
                  { value: "packed", label: "Packed" },
                ]}
              />
            </Row>
            <Row label="Street sounds" hint="Traffic and horns in the Cinematic and Free cameras. Quieter as you zoom out.">
              <OnOff label="Street sounds" value={settings.streetSound} onChange={(streetSound) => update({ streetSound })} />
            </Row>
            {settings.streetSound && (
              <VolumeSlider label="Street sounds volume" value={settings.streetVolume} onChange={(streetVolume) => update({ streetVolume })} />
            )}
            <Row label="Train sounds" hint="Departure, running and braking sounds in the Driver and Passenger cameras.">
              <OnOff label="Train sounds" value={settings.trainSound} onChange={(trainSound) => update({ trainSound })} />
            </Row>
            {settings.trainSound && (
              <VolumeSlider label="Train sounds volume" value={settings.trainVolume} onChange={(trainVolume) => update({ trainVolume })} />
            )}
            <Row label="Weather">
              <OnOff label="Weather effects" value={settings.weatherEffects} onChange={(weatherEffects) => update({ weatherEffects })} />
            </Row>
            <Row label="Shadows">
              <OnOff label="Shadows" value={settings.shadows} onChange={(shadows) => update({ shadows })} />
            </Row>
            <Row label="Traffic">
              <OnOff label="Traffic" value={settings.traffic} onChange={(traffic) => update({ traffic })} />
            </Row>
            <Row label="Camera shake" hint="Subtle vibration in driver and passenger views.">
              <OnOff label="Camera shake" value={settings.cameraShake && !settings.reducedMotion} onChange={(cameraShake) => update({ cameraShake })} />
            </Row>
          </div>
          <div className="mt-4 border-t border-line pb-5 pt-5">
            <h3 className="mb-3 text-[12px] font-semibold tracking-[0.12em] text-muted">KEYBOARD</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[13px]">
              {SHORTCUT_HELP.map((s) => (
                <div key={s.keys} className="contents">
                  <dt className="font-mono text-ink">{s.keys}</dt>
                  <dd className="text-muted">{s.action}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
