"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SimulationEngine } from "../../simulation/SimulationEngine";
import type { SimulationState } from "../../simulation/types";
import { discountedFare, fareForJourney } from "../../simulation/fares";
import { getAudioContext } from "../../utils/audio";
import { hashString, mulberry32 } from "../../utils/random";
import { Close } from "../ui/Icons";

/** How long the ticket stays up after the ride starts (ms). */
const SHOW_MS = 3500;
const QR_CELLS = 21;

/** Two-tone ticket-gate beep. Silent when audio is unavailable or still locked. */
function gateBeep() {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime + 0.02;
    [
      [1180, 0],
      [1580, 0.13],
    ].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(0.07, t0 + at + 0.01);
      g.gain.setValueAtTime(0.07, t0 + at + 0.09);
      g.gain.linearRampToValueAtTime(0, t0 + at + 0.11);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.14);
    });
  } catch {
    // A beep is a nice-to-have.
  }
}

/**
 * QR-code-like pattern: finder squares in three corners and a deterministic
 * pseudo-random module grid from the journey and date. Decorative only — not
 * a scannable code.
 */
function TicketQr({ seed }: { seed: string }) {
  const cells = useMemo(() => {
    const rng = mulberry32(hashString(seed));
    const out: [number, number][] = [];
    const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x > QR_CELLS - 9 && y < 8) || (x < 8 && y > QR_CELLS - 9);
    for (let y = 0; y < QR_CELLS; y++) for (let x = 0; x < QR_CELLS; x++) if (!inFinder(x, y) && rng() < 0.48) out.push([x, y]);
    return out;
  }, [seed]);
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={7} height={7} fill="#0b1220" />
      <rect x={x + 1} y={y + 1} width={5} height={5} fill="#fff" />
      <rect x={x + 2} y={y + 2} width={3} height={3} fill="#0b1220" />
    </g>
  );
  return (
    <svg viewBox={`-1 -1 ${QR_CELLS + 2} ${QR_CELLS + 2}`} className="h-[112px] w-[112px] shrink-0 rounded-md bg-white" role="img" aria-label="QR ticket (illustration)" shapeRendering="crispEdges">
      {cells.map(([x, y]) => (
        <rect key={`${x}.${y}`} x={x} y={y} width={1} height={1} fill="#0b1220" />
      ))}
      {finder(0, 0)}
      {finder(QR_CELLS - 7, 0)}
      {finder(0, QR_CELLS - 7)}
    </svg>
  );
}

/**
 * "Tap your ticket": a mobile QR ticket for this journey, shown for a few
 * seconds when the ride starts, with the fare from CMRL's distance bands and
 * a ticket-gate beep. Tap or Escape dismisses it early.
 */
export function TicketCard({ engine, snap }: { engine: SimulationEngine; snap: SimulationState }) {
  const [open, setOpen] = useState(false);
  const shownFor = useRef<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { from, to } = engine.journey;
  const fares = engine.route.route.fares;
  const fare = fareForJourney(engine.route.stations, fares.bands?.slabs ?? [], from.id, to.id);
  const discount = fares.digitalDiscount?.percent ?? null;
  const today = useMemo(() => new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }), []);

  // Show once per journey, when the ride first starts.
  const started = snap.state !== "idle" || snap.elapsed > 0;
  useEffect(() => {
    if (!started || shownFor.current === engine.journey.id) return;
    shownFor.current = engine.journey.id;
    setOpen(true);
    gateBeep();
    const t = window.setTimeout(() => setOpen(false), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [started, engine.journey.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label={`Ticket from ${from.name} to ${to.name}`}
      className="hud-panel pointer-events-auto absolute left-1/2 top-[86px] z-30 flex w-[min(440px,calc(100%-24px))] -translate-x-1/2 flex-col gap-4 rounded-[16px] p-5 animate-rise-in md:top-[120px]"
      onClick={() => setOpen(false)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold tracking-[0.16em] text-muted">CHENNAI METRO · MOBILE QR TICKET</span>
          <span className="text-[18px] font-semibold">Tap your ticket</span>
        </div>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close ticket"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-ink"
        >
          <Close size={16} />
        </button>
      </div>
      <div className="flex items-center gap-4">
        <TicketQr seed={`${from.id}>${to.id}@${today}`} />
        <dl className="flex min-w-0 flex-1 flex-col gap-2 text-[13px]">
          <div>
            <dt className="text-[10px] tracking-[0.14em] text-muted">FROM</dt>
            <dd className="truncate font-semibold">{from.name}</dd>
            {from.nameTa && (
              <dd lang="ta" className="font-tamil truncate text-[12px] text-subtle">
                {from.nameTa}
              </dd>
            )}
          </div>
          <div>
            <dt className="text-[10px] tracking-[0.14em] text-muted">TO</dt>
            <dd className="truncate font-semibold">{to.name}</dd>
            {to.nameTa && (
              <dd lang="ta" className="font-tamil truncate text-[12px] text-subtle">
                {to.nameTa}
              </dd>
            )}
          </div>
          <div className="flex items-baseline gap-3">
            {fare !== null && (
              <span className="tabular font-mono text-[20px] font-semibold">
                ₹{discount !== null ? discountedFare(fare, discount) : fare}
              </span>
            )}
            {fare !== null && discount !== null && (
              <span className="text-[12px] text-muted">
                <s>₹{fare}</s> · {discount}% digital discount
              </span>
            )}
          </div>
          <span className="text-[12px] text-muted">{today} · single journey</span>
        </dl>
      </div>
      <p className="text-[12px] leading-snug text-subtle">
        Singara Chennai (NCMC) card accepted at the gates · fare by CMRL distance band
      </p>
    </div>
  );
}
