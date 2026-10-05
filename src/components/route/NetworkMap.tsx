import Link from "next/link";
import type { NetworkSummary } from "../../lib/routeSummary";

export interface NetworkMapProps {
  network: NetworkSummary;
  /** Emphasise one line (others dimmed) and label all its stations. */
  highlightLine?: string | null;
  /** Ring one station. */
  highlightStation?: string | null;
  /** Stations link to their pages. */
  linkStations?: boolean;
  className?: string;
  label?: string;
}

const PAD = 1400;

/**
 * Every modelled line on one map, drawn from the real track (OpenStreetMap)
 * in the shared city projection: north up, true scale. Lines still under
 * construction are dashed; interchanges are white rings.
 */
export function NetworkMap({ network, highlightLine = null, highlightStation = null, linkStations = false, className = "", label }: NetworkMapProps) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const l of network.lines) {
    for (const [x, z] of l.track) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  minX -= PAD;
  maxX += PAD * 4.5; // room for labels on the right
  minZ -= PAD;
  maxZ += PAD;
  const w = maxX - minX;
  const h = maxZ - minZ;
  const unit = w / 560; // ~1 screen px when drawn ~560 px wide
  const colour = new Map(network.lines.map((l) => [l.id, l.colour]));
  const dim = (lineId: string) => highlightLine !== null && lineId !== highlightLine;
  // Labels: most important first, skipping any that would overlap one already placed.
  const wanted = network.stations
    .map((s) => {
      const inter = s.lines.length > 1;
      const isHi = s.id === highlightStation;
      const onHi = highlightLine !== null && s.lines.includes(highlightLine);
      const show = isHi || inter || onHi || (highlightLine === null && s.end);
      const rank = isHi ? 0 : s.end ? 1 : s.lines.length > 2 ? 2 : inter ? 3 : 4;
      return { s, show, rank, size: unit * (inter || isHi ? 13 : 11) };
    })
    .filter((c) => c.show)
    .sort((a, b) => a.rank - b.rank);
  const placed: [number, number, number, number][] = [];
  const labelled = new Set<string>();
  for (const c of wanted) {
    const x0 = c.s.x + unit * 9;
    const box: [number, number, number, number] = [x0, c.s.z - c.size * 0.75, x0 + c.s.name.length * c.size * 0.56, c.s.z + c.size * 0.4];
    if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    placed.push(box);
    labelled.add(c.s.id);
  }
  const order = [...network.lines].sort((a, b) => Number(a.id === highlightLine) - Number(b.id === highlightLine));

  return (
    <svg viewBox={`${minX} ${minZ} ${w} ${h}`} className={className} role="group" aria-label={label ?? "Chennai Metro network map"}>
      {order.map((l) => (
        <polyline
          key={l.id}
          points={l.track.map(([x, z]) => `${x},${z}`).join(" ")}
          fill="none"
          stroke={l.colour}
          strokeOpacity={dim(l.id) ? 0.28 : 1}
          strokeWidth={unit * (l.id === highlightLine ? 7 : 5)}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={l.open ? undefined : `${unit * 10} ${unit * 6}`}
        >
          <title>{`${l.name} · ${l.colourName}${l.open ? "" : " (under construction)"}`}</title>
        </polyline>
      ))}
      {network.stations.map((s) => {
        const inter = s.lines.length > 1;
        const onHi = highlightLine !== null && s.lines.includes(highlightLine);
        const faded = highlightLine !== null && !onHi;
        const isHi = s.id === highlightStation;
        const r = unit * (inter ? 6.5 : isHi ? 6 : 3.6);
        const showLabel = labelled.has(s.id);
        const dot = (
          <>
            {isHi && <circle cx={s.x} cy={s.z} r={unit * 13} fill="none" stroke="#f5f7fa" strokeWidth={unit * 2} />}
            <circle
              cx={s.x}
              cy={s.z}
              r={r}
              fill={inter ? "#f5f7fa" : s.open ? "#f5f7fa" : "#0a0f18"}
              stroke={inter ? "#0a0f18" : colour.get(s.lines[0]) ?? "#7a8596"}
              strokeWidth={unit * (inter ? 2.4 : 2)}
              opacity={faded ? 0.35 : 1}
            />
            {showLabel && (
              <text
                x={s.x + unit * 10}
                y={s.z + unit * 4}
                fontSize={unit * (inter || isHi ? 13 : 11)}
                fontWeight={inter || isHi ? 600 : 400}
                fill={faded ? "#5d6878" : inter || isHi ? "#f5f7fa" : "#b7c0cc"}
                paintOrder="stroke"
                stroke="#0a0f18"
                strokeWidth={unit * 3}
              >
                {s.name}
              </text>
            )}
            <title>{`${s.name}${s.nameTa ? ` · ${s.nameTa}` : ""} — ${s.lines.map((id) => network.lines.find((l) => l.id === id)?.name ?? id).join(", ")}`}</title>
          </>
        );
        return linkStations ? (
          <Link key={s.id} href={`/stations/${s.id}`} aria-label={s.name} className="outline-none [&:focus-visible>circle]:stroke-accent">
            {dot}
          </Link>
        ) : (
          <g key={s.id}>{dot}</g>
        );
      })}
      <g transform={`translate(${maxX - unit * 40} ${maxZ - unit * 60})`} aria-hidden="true">
        <path d={`M0 ${-unit * 16} L${unit * 6} ${unit * 2} L0 ${-unit * 3} L${-unit * 6} ${unit * 2} Z`} fill="none" stroke="#7a8596" strokeWidth={unit * 1.5} />
        <text y={unit * 20} textAnchor="middle" fill="#7a8596" fontSize={unit * 10}>
          N
        </text>
        <line x1={-unit * 120} x2={-unit * 120 + 5000} y1={unit * 30} y2={unit * 30} stroke="#7a8596" strokeWidth={unit * 1.5} />
        <text x={-unit * 120 + 2500} y={unit * 46} textAnchor="middle" fill="#7a8596" fontSize={unit * 10}>
          5 km
        </text>
      </g>
    </svg>
  );
}
