"use client";

import { useSyncExternalStore } from "react";
import { Target } from "../ui/Icons";
import { PASSENGER_SPOTS, getPassengerSpot, requestRecentre, setPassengerSpot, subscribePassengerLook } from "../../three/passengerLook";
import { useViewStore } from "../../simulation/store";

/**
 * Passenger camera controls: move between spots in the car (window seat,
 * by the doors, car end) and recentre the view. Dragging on the scene turns
 * your head; scroll or pinch zooms.
 */
export function PassengerPad() {
  const visible = useViewStore((s) => s.cameraMode === "passenger");
  const spot = useSyncExternalStore(subscribePassengerLook, getPassengerSpot, getPassengerSpot);
  if (!visible) return null;
  return (
    <div
      role="group"
      aria-label="Passenger view"
      className="hud-panel pointer-events-auto absolute right-3 top-[220px] z-20 flex w-[148px] flex-col gap-2 rounded-[14px] p-2.5 md:right-5 md:top-1/2 md:-translate-y-1/2 md:p-3"
    >
      <span className="px-1 text-[10px] font-semibold tracking-[0.12em] text-muted">WHERE YOU ARE</span>
      {PASSENGER_SPOTS.map((s) => {
        const active = s.id === spot;
        return (
          <button
            key={s.id}
            type="button"
            title={s.hint}
            aria-pressed={active}
            onClick={() => setPassengerSpot(s.id)}
            className={`rounded-[10px] px-3 py-2 text-left text-[12px] font-medium transition-colors ${
              active ? "bg-accent text-white" : "bg-surface-2 text-ink hover:bg-white/10"
            }`}
          >
            {s.label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={requestRecentre}
        className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-surface-2 px-3 py-2 text-[12px] text-ink transition-colors hover:bg-white/10"
      >
        <Target size={14} />
        Recentre
      </button>
      <p className="hidden px-1 text-center text-[10px] leading-snug text-muted md:block">
        Drag to look around
        <br />
        Scroll to zoom
      </p>
      <p className="px-1 text-center text-[10px] leading-snug text-muted md:hidden">Drag to look · pinch to zoom</p>
    </div>
  );
}
