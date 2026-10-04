"use client";

import { useEffect } from "react";

export type ShortcutMap = Record<string, (e: KeyboardEvent) => void>;

export const SHORTCUT_HELP: { keys: string; action: string }[] = [
  { keys: "Space", action: "Play / pause" },
  { keys: "1 – 5", action: "Camera: cinematic, driver, passenger, map, free" },
  { keys: "[  ]", action: "Slower / faster" },
  { keys: "← →", action: "Skip 10 s (when the timeline isn't focused)" },
  { keys: "N", action: "Day / night" },
  { keys: "W", action: "Cycle weather" },
  { keys: "S", action: "Route panel" },
  { keys: "F", action: "Fullscreen" },
  { keys: ",", action: "Settings" },
];

const RANGE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

/** Global shortcuts that stay out of the way of form controls. */
export function useKeyboardShortcuts(map: ShortcutMap, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" && (t as HTMLInputElement).type === "range") {
        // Sliders only need their navigation keys; everything else stays global.
        if (RANGE_KEYS.has(e.key)) return;
      } else if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || t?.isContentEditable) {
        return;
      }
      // Let buttons handle their own Space/Enter activation.
      if ((e.key === " " || e.key === "Enter") && tag === "BUTTON") return;
      const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const fn = map[key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map, enabled]);
}
