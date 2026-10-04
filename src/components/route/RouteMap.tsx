"use client";

import { useMemo } from "react";
import type { RouteSummary } from "../../lib/routeSummary";

export interface RouteMapProps {
  summary: RouteSummary;
  from?: string | null;
  to?: string | null;
  /** Called when a served station is activated. */
  onSelect?: (id: string) => void;
  /** Highlighted station (e.g. a station page). */
  highlight?: string | null;
  /** Train position as km from the western terminus (2D fallback / progress). */
  trainKm?: number | null;
  className?: string;
  /** Accessible label for the whole map. */
  label?: string;
  showPassLabels?: boolean;
}

const W = 1000;
const H = 560;
const PAD_X = 70;
const EXAGGERATION = 1.7;

/**
 * Geographic schematic of the line drawn from the published station
 * coordinates (vertical scale exaggerated so labels fit). Served stations
 * are interactive; stations not yet open are shown hollow.
 */
export function RouteMap({
  summary,
  from = null,
  to = null,
  onSelect,
  highlight = null,
  trainKm = null,
  className = "",
  label,
  showPassLabels = true,
}: RouteMapProps) {
  const layout = useMemo(() => {
    const lats = summary.stations.map((s) => s.lat);
    const lons = summary.stations.map((s) => s.lon);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const kx = (W - PAD_X * 2) / (maxLon - minLon);
    // Equirectangular with cos(lat) correction, then exaggerate vertically.
    const ky = kx * (1 / Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)) * EXAGGERATION;
    const midLat = (minLat + maxLat) / 2;
    const pts = summary.stations.map((s) => ({
      ...s,
      x: PAD_X + (s.lon - minLon) * kx,
      y: H / 2 + 20 - (s.lat - midLat) * ky,
    }));
    return pts;
  }, [summary]);

  const indexOf = (id: string | null) => (id ? layout.findIndex((p) => p.id === id) : -1);
  const ia = indexOf(from);
  const ib = indexOf(to);
  const lo = ia >= 0 && ib >= 0 ? Math.min(ia, ib) : -1;
  const hi = ia >= 0 && ib >= 0 ? Math.max(ia, ib) : -1;

  const line = layout.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const active = lo >= 0 ? layout.slice(lo, hi + 1).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") : "";

  const train = trainKm === null ? null : trainPoint(layout, trainKm);

  const colour = summary.lineColour;
  const interactive = Boolean(onSelect);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="group"
      aria-label={label ?? `${summary.lineName} route map, ${summary.title}`}
    >
      <g stroke="#121a26" strokeWidth={1} aria-hidden="true">
        {[120, 240, 360, 480].map((y) => (
          <line key={y} x1={0} x2={W} y1={y} y2={y} />
        ))}
        {[150, 300, 450, 600, 750, 900].map((x) => (
          <line key={x} y1={0} y2={H} x1={x} x2={x} />
        ))}
      </g>
      <polyline points={line} fill="none" stroke={lo >= 0 ? "#3a4556" : colour} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" />
      {lo >= 0 && (
        <polyline points={active} fill="none" stroke={colour} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" />
      )}

      {layout.map((p, i) => {
        const stop = p.service === "stop";
        const isFrom = p.id === from;
        const isTo = p.id === to;
        const isHi = p.id === highlight;
        const inJourney = lo >= 0 && i >= lo && i <= hi;
        const below = !stop;
        const r = stop ? (isFrom || isTo || isHi ? 9 : 7) : 4.5;
        const labelX = p.x + (below ? 7 : 9);
        const labelY = p.y + (below ? 18 : -14);
        const angle = below ? 38 : -38;
        const endLabel = isFrom || isTo;
        const content = (
          <>
            {(isFrom || isTo || isHi) && (
              <circle cx={p.x} cy={p.y} r={15} fill="none" stroke={isFrom ? "#1677ff" : "#f5f7fa"} strokeWidth={2} />
            )}
            <circle
              cx={p.x}
              cy={p.y}
              r={r}
              fill={!stop ? "#0a0f18" : isFrom ? "#1677ff" : "#f5f7fa"}
              stroke={stop ? "#0a0f18" : "#7a8596"}
              strokeWidth={stop ? 3 : 1.5}
            />
            {(stop || showPassLabels) && !endLabel && (
              <text
                x={labelX}
                y={labelY}
                transform={`rotate(${angle} ${labelX} ${labelY})`}
                fill={stop ? (inJourney || lo < 0 ? "#c9d1dc" : "#7a8596") : "#7a8596"}
                fontSize={stop ? 14 : 11.5}
                fontWeight={isHi ? 600 : 400}
              >
                {p.name}
              </text>
            )}
            {endLabel && (
              <>
                <text x={p.x} y={i === layout.length - 1 ? p.y - 44 : p.y + 40} textAnchor="middle" fill="#f5f7fa" fontSize={16} fontWeight={600}>
                  {p.name}
                </text>
                <text
                  x={p.x}
                  y={i === layout.length - 1 ? p.y - 26 : p.y + 58}
                  textAnchor="middle"
                  fill={isFrom ? "#6fa8ff" : "#8b96a7"}
                  fontSize={11}
                  fontWeight={500}
                  letterSpacing="0.12em"
                >
                  {isFrom ? "FROM" : "TO"}
                </text>
              </>
            )}
          </>
        );
        if (interactive && stop) {
          return (
            <g
              key={p.id}
              role="button"
              tabIndex={0}
              aria-label={`${p.name}${isFrom ? " (origin)" : isTo ? " (destination)" : ""}`}
              aria-pressed={isFrom || isTo}
              className="cursor-pointer outline-none [&:focus-visible>circle:nth-of-type(1)]:stroke-accent"
              onClick={() => onSelect?.(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect?.(p.id);
                }
              }}
            >
              <circle cx={p.x} cy={p.y} r={20} fill="transparent" />
              {content}
            </g>
          );
        }
        return (
          <g key={p.id} aria-label={stop ? p.name : `${p.name} (not yet open)`} role="img">
            {content}
          </g>
        );
      })}

      {train && (
        <g aria-hidden="true">
          <circle cx={train.x} cy={train.y} r={16} fill="#1677ff" opacity={0.25} />
          <circle cx={train.x} cy={train.y} r={8} fill="#1677ff" stroke="#f5f7fa" strokeWidth={2.5} />
        </g>
      )}
      <g transform={`translate(${W - 34} ${H - 54})`} aria-hidden="true">
        <path d="M0 -16 L6 2 L0 -3 L-6 2 Z" fill="none" stroke="#7a8596" strokeWidth={1.5} />
        <text y={20} textAnchor="middle" fill="#7a8596" fontSize={10} fontFamily="var(--font-mono)">
          N
        </text>
      </g>
    </svg>
  );
}

function trainPoint(layout: { km: number; x: number; y: number }[], km: number) {
  for (let i = 0; i < layout.length - 1; i++) {
    const a = layout[i];
    const b = layout[i + 1];
    if (km >= a.km && km <= b.km) {
      const u = b.km === a.km ? 0 : (km - a.km) / (b.km - a.km);
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
  }
  const end = km <= 0 ? layout[0] : layout[layout.length - 1];
  return { x: end.x, y: end.y };
}
