"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { RouteMap } from "./RouteMap";
import { ArrowRight, ChevronDown, Swap } from "../ui/Icons";
import { buttonClass } from "../ui/Button";
import { journeyDistanceKm, journeyDuration, simulatorHref, stationsBetween, type RouteSummary } from "../../lib/routeSummary";
import { statusChip } from "../../lib/lines";

type Field = "from" | "to";

export function JourneyPlanner({ summaries }: { summaries: RouteSummary[] }) {
  const params = useSearchParams();
  const initial = summaries.find((r) => r.id === params.get("route")) ?? summaries[0];
  const [routeId, setRouteId] = useState(initial.id);
  const summary = summaries.find((r) => r.id === routeId) ?? summaries[0];
  return (
    <div className="flex flex-1 flex-col gap-5">
      <LinePicker summaries={summaries} value={summary.id} onChange={setRouteId} />
      {/* Keyed by route so the stations reset when the line changes. */}
      <Planner key={summary.id} summary={summary} initialFrom={summary === initial ? params.get("from") : null} initialTo={summary === initial ? params.get("to") : null} />
    </div>
  );
}

function LinePicker({ summaries, value, onChange }: { summaries: RouteSummary[]; value: string; onChange: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Line" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {summaries.map((r) => {
        const on = r.id === value;
        return (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(r.id)}
            className={`flex flex-col gap-1.5 rounded-xl border px-4 py-3 text-left transition-colors ${on ? "border-accent bg-surface" : "border-line bg-surface/40 hover:bg-surface"}`}
          >
            <span className="flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] text-muted">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.lineColour }} aria-hidden="true" />
              {r.lineName.toUpperCase()} · {r.lineColourName.toUpperCase()}
              <span className={`ml-auto rounded-full border px-1.5 py-px text-[10px] ${r.preview ? "border-[#e8742a]/40 text-[#f0a46c]" : "border-line-strong text-subtle"}`}>
                {statusChip(r.status).toUpperCase()}
              </span>
            </span>
            <span className="text-[14px] font-medium leading-snug text-ink">{r.title}</span>
          </button>
        );
      })}
    </div>
  );
}

function Planner({ summary, initialFrom, initialTo }: { summary: RouteSummary; initialFrom: string | null; initialTo: string | null }) {
  const router = useRouter();
  const stops = summary.stations.filter((s) => s.service === "stop");
  const valid = (id: string | null) => (id && stops.some((s) => s.id === id) ? id : null);
  const [from, setFrom] = useState<string>(valid(initialFrom) ?? stops[0].id);
  const [to, setTo] = useState<string>(valid(initialTo) ?? stops[stops.length - 1].id);
  const [active, setActive] = useState<Field>("from");
  const [announce, setAnnounce] = useState("");
  const fromId = useId();
  const toId = useId();

  const same = from === to;
  const stats = useMemo(() => {
    if (same) return null;
    const between = stationsBetween(summary, from, to);
    return {
      km: journeyDistanceKm(summary, from, to),
      seconds: journeyDuration(summary, from, to),
      stops: between.filter((s) => s.service === "stop").length,
      passes: between.filter((s) => s.service === "pass").length,
    };
  }, [summary, from, to, same]);

  const nameOf = (id: string) => summary.stations.find((s) => s.id === id)?.name ?? id;

  const pick = (id: string) => {
    if (active === "from") {
      setFrom(id);
      setActive("to");
      setAnnounce(`Origin set to ${nameOf(id)}. Now choose a destination.`);
    } else {
      setTo(id);
      setActive("from");
      setAnnounce(`Destination set to ${nameOf(id)}.`);
    }
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
    setAnnounce(`Swapped. From ${nameOf(to)} to ${nameOf(from)}.`);
  };

  const href = simulatorHref(summary.id, from, to);

  return (
    <div className="flex flex-1 flex-col gap-6 lg:flex-row lg:gap-8">
      <section
        aria-labelledby="choose-heading"
        className="flex w-full flex-col gap-7 rounded-2xl border border-line bg-surface p-6 sm:p-8 lg:max-w-[420px]"
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 font-mono text-[12px] tracking-[0.08em] text-muted">
            <span className="h-1 w-3.5 rounded-sm" style={{ background: summary.lineColour }} aria-hidden="true" />
            {summary.lineName.toUpperCase()} · {summary.lineColourName.toUpperCase()}
          </div>
          <h1 id="choose-heading" className="text-[28px] font-semibold tracking-[-0.015em]">
            Choose your journey
          </h1>
        </div>

        <div className="flex flex-col gap-2.5">
          <StationSelect
            id={fromId}
            label="From"
            value={from}
            stops={stops}
            active={active === "from"}
            onFocus={() => setActive("from")}
            onChange={setFrom}
            marker={<span className="h-2.5 w-2.5 rounded-full border-2 border-accent" />}
          />
          <div className="-my-1 flex justify-end">
            <button
              type="button"
              onClick={swap}
              aria-label="Swap origin and destination"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line-strong bg-surface text-subtle transition-colors hover:text-ink"
            >
              <Swap size={16} />
            </button>
          </div>
          <StationSelect
            id={toId}
            label="To"
            value={to}
            stops={stops}
            active={active === "to"}
            onFocus={() => setActive("to")}
            onChange={setTo}
            marker={<span className="h-2.5 w-2.5 rounded-full bg-ink" />}
          />
        </div>

        <dl className="grid grid-cols-3 gap-3 border-t border-line pt-6">
          <Stat label="Distance" value={stats ? stats.km.toFixed(1) : "—"} unit="km" />
          <Stat label="Est. journey" value={stats ? String(Math.round(stats.seconds / 60)) : "—"} unit="min" />
          <Stat label="Stations" value={stats ? String(stats.stops) : "—"} />
        </dl>

        <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-muted">
          {same && <p className="text-[#ffb4a8]" role="alert">Choose two different stations.</p>}
          {stats && stats.passes > 0 && (
            <p>
              {stats.passes} double-decker {stats.passes === 1 ? "station is" : "stations are"} passed without stopping until
              they open.
            </p>
          )}
          {summary.preview && (
            <p className="text-[#f0a46c]">
              {summary.statusLabel}. This is a preview ride on the real track: every station is a stop, timings are illustrative.
            </p>
          )}
          <p>
            Journey time is simulated from the published train specification
            {summary.reportedJourneyMinutes ? `. CMRL quotes about ${summary.reportedJourneyMinutes} minutes end to end.` : "."}
          </p>
        </div>

        <Link
          href={same ? "#" : href}
          aria-disabled={same}
          onClick={(e) => {
            if (same) e.preventDefault();
            else {
              e.preventDefault();
              router.push(href);
            }
          }}
          className={buttonClass("primary", "lg", `mt-auto w-full ${same ? "pointer-events-none opacity-40" : ""}`)}
        >
          Start Journey <ArrowRight size={18} />
        </Link>
      </section>

      <section aria-label="Route map" className="relative min-h-[420px] flex-1 overflow-hidden rounded-2xl border border-line bg-[#0a0f18]">
        <div className="absolute inset-x-6 top-5 z-10 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
          <p>
            Select a station to set it as{" "}
            <span className="font-semibold text-ink">{active === "from" ? "From" : "To"}</span>
          </p>
          <div className="flex flex-wrap gap-5" aria-hidden="true">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-ink ring-2" style={{ ["--tw-ring-color" as string]: summary.lineColour }} />
              Served
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full border-[1.5px] border-faint" />
              Passed without stopping
            </span>
          </div>
        </div>
        <RouteMap summary={summary} from={from} to={to} onSelect={pick} className="absolute inset-x-2 bottom-10 top-14 h-[calc(100%-6rem)] w-[calc(100%-1rem)]" />
        <p className="absolute bottom-4 left-6 right-6 font-mono text-[11px] text-faint">
          Drawn from station coordinates (OpenStreetMap) · vertical scale exaggerated
        </p>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="tabular font-mono text-[22px] font-medium">
        {value}
        {unit && <span className="text-[13px] text-muted"> {unit}</span>}
      </dd>
    </div>
  );
}

function StationSelect({
  id,
  label,
  value,
  stops,
  active,
  onFocus,
  onChange,
  marker,
}: {
  id: string;
  label: string;
  value: string;
  stops: { id: string; name: string }[];
  active: boolean;
  onFocus: () => void;
  onChange: (id: string) => void;
  marker: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <label htmlFor={id} className="font-mono text-[11px] tracking-[0.12em] text-muted">
        {label.toUpperCase()}
      </label>
      <div
        className={`relative flex h-[52px] items-center rounded-[10px] border bg-surface-2 transition-colors ${active ? "border-accent" : "border-line-strong"}`}
      >
        <span className="pointer-events-none absolute left-4 flex items-center" aria-hidden="true">
          {marker}
        </span>
        <select
          id={id}
          value={value}
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value)}
          className="h-full w-full cursor-pointer appearance-none rounded-[10px] bg-transparent pl-11 pr-10 text-[16px] font-medium text-ink outline-none"
        >
          {stops.map((s) => (
            <option key={s.id} value={s.id} className="bg-surface text-ink">
              {s.name}
            </option>
          ))}
        </select>
        <ChevronDown size={16} className="pointer-events-none absolute right-4 text-muted" />
      </div>
    </div>
  );
}
