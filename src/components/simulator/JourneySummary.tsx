"use client";

import Link from "next/link";
import type { SimulationEngine } from "../../simulation/SimulationEngine";
import type { SimulationState } from "../../simulation/types";
import { discountedFare, fareForJourney } from "../../simulation/fares";
import { formatClock } from "../../utils/format";
import { ArrowRight, Restart } from "../ui/Icons";
import { buttonClass } from "../ui/Button";

/**
 * End-of-ride card at the terminus: where you went, how far, how long, what
 * it cost, and the thank-you message in English and Tamil. Replaces the plain
 * "You have arrived" screen (ArrivalOverlay with summaryShown).
 */
export function JourneySummary({ engine, snap }: { engine: SimulationEngine; snap: SimulationState }) {
  if (!snap.finished) return null;
  const { from, to, stops, passes } = engine.journey;
  const fares = engine.route.route.fares;
  const fare = fareForJourney(engine.route.stations, fares.bands?.slabs ?? [], from.id, to.id);
  const discount = fares.digitalDiscount?.percent ?? null;
  const stopsBetween = stops.length - 2;
  const reverse = `/simulator?from=${to.id}&to=${from.id}`;

  const facts: [string, string][] = [
    ["Stations", `${stops.length - 1} ${stops.length - 1 === 1 ? "stop" : "stops"}${stopsBetween > 0 ? ` · ${stopsBetween} on the way` : ""}${passes.length ? ` · ${passes.length} passed` : ""}`],
    ["Distance", `${(snap.totalDistance / 1000).toFixed(1)} km`],
    ["Time on board", formatClock(snap.duration)],
  ];
  if (fare !== null) facts.push(["Fare", discount !== null ? `₹${discountedFare(fare, discount)} with QR / card (₹${fare} token)` : `₹${fare}`]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-4 animate-fade-in">
      <section
        role="dialog"
        aria-labelledby="journey-summary-title"
        className="hud-panel pointer-events-auto flex w-[min(460px,100%)] flex-col gap-5 rounded-[18px] p-6"
      >
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-[0.16em] text-muted">JOURNEY COMPLETE</span>
          <h2 id="journey-summary-title" className="text-[22px] font-semibold leading-tight">
            {from.name} → {to.name}
          </h2>
          {from.nameTa && to.nameTa && (
            <span lang="ta" className="font-tamil text-[14px] text-subtle">
              {from.nameTa} → {to.nameTa}
            </span>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-[14px]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="tabular text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="flex flex-col gap-1 border-t border-line pt-4 text-[14px]">
          <span>Thank you for travelling with Chennai Metro.</span>
          <span lang="ta" className="font-tamil text-subtle">
            சென்னை மெட்ரோவில் பயணித்தமைக்கு நன்றி.
          </span>
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => engine.play()} className={buttonClass("primary", "md")} autoFocus>
            <Restart size={16} /> Ride again
          </button>
          <Link href={reverse} className={buttonClass("secondary", "md")}>
            Return journey <ArrowRight size={16} />
          </Link>
          <Link href="/routes" className={buttonClass("ghost", "md")}>
            Choose another journey
          </Link>
        </div>
      </section>
    </div>
  );
}
