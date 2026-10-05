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
const PAD_Y = 70;
/** Most vertical stretch applied to a mainly east–west line so its labels fit. */
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
    const midLat = (minLat + maxLat) / 2;
    const midLon = (minLon + maxLon) / 2;
    // Equirectangular (cos(lat) on longitude), fitted to the box both ways; a flat
    // east–west line is stretched vertically up to EXAGGERATION so labels fit.
    const cos = Math.cos((midLat * Math.PI) / 180);
    const spanX = Math.max(1e-6, (maxLon - minLon) * cos);
    const spanY = Math.max(1e-6, maxLat - minLat);
    const boxW = W - PAD_X * 2;
    const boxH = H - PAD_Y * 2;
    const ex = Math.min(EXAGGERATION, Math.max(1, (boxH / boxW) * (spanX / spanY)));
    const k = Math.min(boxW / spanX, boxH / (spanY * ex));
    const pts = summary.stations.map((s) => ({
      ...s,
      x: W / 2 + (s.lon - midLon) * cos * k,
      y: H / 2 + 10 - (s.lat - midLat) * k * ex,
    }));
    return pts;
  }, [summary]);

  // Frame the drawn line (plus room for its labels) rather than the fixed canvas, so a
  // north–south line fills a tall phone-width map instead of a thin strip in the middle.
  const view = useMemo(() => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of layout) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    x0 -= 90;
    x1 += 170;
    y0 -= 100;
    y1 += 100;
    const w = Math.max(x1 - x0, 460);
    const h = Math.max(y1 - y0, 320);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }, [layout]);
  const gridX: number[] = [];
  const gridY: number[] = [];
  for (let x = Math.ceil(view.x / 150) * 150; x < view.x + view.w; x += 150) gridX.push(x);
  for (let y = Math.ceil(view.y / 120) * 120; y < view.y + view.h; y += 120) gridY.push(y);

  const indexOf = (id: string | null) => (id ? layout.findIndex((p) => p.id === id) : -1);
  const ia = indexOf(from);
  const ib = indexOf(to);
  const lo = ia >= 0 && ib >= 0 ? Math.min(ia, ib) : -1;
  const hi = ia >= 0 && ib >= 0 ? Math.max(ia, ib) : -1;

  // Station labels that fit: each label is a rotated strip; keep the important ones
  // (journey ends, highlighted, interchanges, termini) and drop any that would overlap.
  const shown = useMemo(() => {
    const keep = new Set<string>();
    const placed: [number, number][] = [];
    // Room for the large FROM / TO labels (drawn above or below their station).
    for (const id of [from, to]) {
      const p = layout.find((q) => q.id === id);
      if (!p) continue;
      const half = p.name.length * 4.6;
      for (let x = p.x - half; x <= p.x + half; x += 10) placed.push([x, p.y - 46], [x, p.y - 30], [x, p.y + 36], [x, p.y + 54]);
    }
    const order = layout
      .map((p, i) => {
        const special = p.id === from || p.id === to || p.id === highlight;
        const rank = special ? 0 : i === 0 || i === layout.length - 1 ? 1 : p.interchange.length ? 2 : p.service === "stop" ? 3 : 4;
        return { p, rank };
      })
      .sort((a, b) => a.rank - b.rank);
    for (const { p } of order) {
      const below = p.service !== "stop";
      const size = below ? 11.5 : 14;
      const a = ((below ? 38 : -38) * Math.PI) / 180;
      const x0 = p.x + (below ? 7 : 9);
      const y0 = p.y + (below ? 18 : -14);
      // Sample points along the label's baseline.
      const len = p.name.length * size * 0.55;
      const pts: [number, number][] = [];
      for (let t = 0; t <= len; t += size * 0.9) pts.push([x0 + Math.cos(a) * t, y0 + Math.sin(a) * t - size * 0.35]);
      const clash = pts.some(([x, y]) => placed.some(([px, py]) => Math.hypot(x - px, y - py) < size * 0.95));
      if (clash && !(p.id === from || p.id === to || p.id === highlight)) continue;
      placed.push(...pts);
      keep.add(p.id);
    }
    return keep;
  }, [layout, from, to, highlight]);

  const line = layout.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const active = lo >= 0 ? layout.slice(lo, hi + 1).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") : "";

  const train = trainKm === null ? null : trainPoint(layout, trainKm);

  const colour = summary.lineColour;
  const interactive = Boolean(onSelect);

  return (
    <svg
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className={className}
      role="group"
      aria-label={label ?? `${summary.lineName} route map, ${summary.title}`}
    >
      <g stroke="#121a26" strokeWidth={1} aria-hidden="true">
        {gridY.map((y) => (
          <line key={y} x1={view.x} x2={view.x + view.w} y1={y} y2={y} />
        ))}
        {gridX.map((x) => (
          <line key={x} y1={view.y} y2={view.y + view.h} x1={x} x2={x} />
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
        // FROM / TO labels sit beyond the journey's end, away from the other end
        // (east–west: the later station's label above, as before).
        const other = layout[isFrom ? ib : ia];
        const above = !other || Math.abs(other.y - p.y) < 60 ? i > (isFrom ? ib : ia) : p.y < other.y;
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
            {(stop || showPassLabels) && !endLabel && shown.has(p.id) && (
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
                <text x={p.x} y={above ? p.y - 44 : p.y + 40} textAnchor="middle" fill="#f5f7fa" fontSize={16} fontWeight={600}>
                  {p.name}
                </text>
                <text
                  x={p.x}
                  y={above ? p.y - 26 : p.y + 58}
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
      <g transform={`translate(${view.x + view.w - 34} ${view.y + view.h - 54})`} aria-hidden="true">
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
