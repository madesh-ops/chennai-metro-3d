"use client";

import { useEffect, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Minus, Plus, RotateLeft, RotateRight, Target } from "../ui/Icons";
import { freeCameraInput, type FreeCameraAxis } from "../../three/freeCamera";
import { useViewStore } from "../../simulation/store";

function release() {
  freeCameraInput.orbit = 0;
  freeCameraInput.tilt = 0;
  freeCameraInput.zoom = 0;
  freeCameraInput.panX = 0;
  freeCameraInput.panY = 0;
}

/** A button that drives one camera axis for as long as it is held (pointer or keyboard). */
function HoldButton({ axis, dir, label, children }: { axis: FreeCameraAxis; dir: 1 | -1; label: string; children: ReactNode }) {
  const start = () => {
    freeCameraInput[axis] = dir;
  };
  const stop = () => {
    freeCameraInput[axis] = 0;
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={stop}
      onBlur={stop}
      onContextMenu={(e) => e.preventDefault()}
      className="inline-flex h-9 w-9 touch-none select-none items-center justify-center rounded-[10px] bg-surface-2 text-ink transition-colors hover:bg-white/10 active:bg-accent active:text-white"
    >
      {children}
    </button>
  );
}

/**
 * On-screen controls for the free camera: pan, zoom, rotate and tilt, plus
 * recentre and follow. Mouse, trackpad and touch gestures work as well; the
 * pad makes every move discoverable and usable without them.
 */
export function FreeCameraPad() {
  const visible = useViewStore((s) => s.cameraMode === "free");
  const follow = useViewStore((s) => s.freeFollow);
  const setFollow = useViewStore((s) => s.setFreeFollow);

  // Dev-only: let scripts frame a spot (`__cm3dFreeLook([tx,ty,tz],[fx,fy,fz])`).
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __cm3dFreeLook?: (t: [number, number, number], f: [number, number, number]) => void };
    w.__cm3dFreeLook = (target, from) => {
      freeCameraInput.lookAt = { target, from };
    };
    return () => {
      delete w.__cm3dFreeLook;
    };
  }, []);

  // Never leave the camera drifting after the pad goes away.
  useEffect(() => {
    if (!visible) release();
    return release;
  }, [visible]);

  if (!visible) return null;
  return (
    <div
      role="group"
      aria-label="Free camera controls"
            // Phones: compact two-column pad clear of the bottom sheet. Desktop: one column at mid-height.
      className="hud-panel pointer-events-auto absolute right-3 top-[220px] z-20 flex flex-col items-center gap-2.5 rounded-[14px] p-2.5 md:right-5 md:top-1/2 md:w-[132px] md:-translate-y-1/2 md:gap-3 md:p-3"
    >
      <div className="flex flex-row items-center gap-3 md:flex-col">
      <div className="grid grid-cols-3 gap-1" aria-label="Pan">
        <span />
        <HoldButton axis="panY" dir={1} label="Pan forward">
          <ChevronUp size={16} />
        </HoldButton>
        <span />
        <HoldButton axis="panX" dir={-1} label="Pan left">
          <ChevronLeft size={16} />
        </HoldButton>
        <button
          type="button"
          aria-label="Recentre on the train"
          title="Recentre on the train"
          onClick={() => {
            freeCameraInput.recentre = true;
            setFollow(true);
          }}
          className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-accent text-white transition-transform active:scale-95"
        >
          <Target size={16} />
        </button>
        <HoldButton axis="panX" dir={1} label="Pan right">
          <ChevronRight size={16} />
        </HoldButton>
        <span />
        <HoldButton axis="panY" dir={-1} label="Pan back">
          <ChevronDown size={16} />
        </HoldButton>
        <span />
      </div>

      <div className="grid grid-cols-2 gap-1">
        <HoldButton axis="zoom" dir={1} label="Zoom in">
          <Plus size={16} />
        </HoldButton>
        <HoldButton axis="zoom" dir={-1} label="Zoom out">
          <Minus size={16} />
        </HoldButton>
        <HoldButton axis="orbit" dir={-1} label="Rotate left">
          <RotateLeft size={16} />
        </HoldButton>
        <HoldButton axis="orbit" dir={1} label="Rotate right">
          <RotateRight size={16} />
        </HoldButton>
        <HoldButton axis="tilt" dir={1} label="Tilt up (more overhead)">
          <ChevronUp size={16} />
        </HoldButton>
        <HoldButton axis="tilt" dir={-1} label="Tilt down (towards the horizon)">
          <ChevronDown size={16} />
        </HoldButton>
      </div>
      </div>

      <label className="flex cursor-pointer select-none items-center gap-2 text-[11px] text-muted">
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-accent" />
        Follow train
      </label>

      <p className="hidden text-center text-[10px] leading-snug text-muted md:block">
        Drag to rotate
        <br />
        Right-drag to pan
        <br />
        Scroll to zoom
      </p>
    </div>
  );
}
