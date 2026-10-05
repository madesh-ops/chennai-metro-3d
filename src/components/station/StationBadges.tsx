import { lineInfo } from "../../lib/lines";
import type { StationSummary } from "../../lib/routeSummary";

const QUALITY_LABEL: Record<string, string> = {
  osm: "Position from OpenStreetMap",
  station: "Station coordinates",
  "bus-stop": "Approx. (bus stop)",
  locality: "Approx. (locality)",
  interpolated: "Position indicative",
};

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "route" | "accent" | "warn" }) {
  const cls = {
    neutral: "border-line-strong text-subtle",
    route: "border-route/40 text-route",
    accent: "border-accent/50 text-accent-soft",
    warn: "border-[#e8742a]/40 text-[#f0a46c]",
  }[tone];
  return <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[11.5px] font-medium ${cls}`}>{children}</span>;
}

export function StationBadges({ s, showQuality = true }: { s: StationSummary; showQuality?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {s.service === "pass" && <Badge tone="warn">Not yet open</Badge>}
      {s.terminus && <Badge tone="route">Terminus</Badge>}
      {s.interchange.map((id) => {
        const l = lineInfo(id);
        return (
          <span key={id} className="inline-flex h-6 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-[11.5px] font-medium text-subtle">
            <span className="h-2 w-2 rounded-full" style={{ background: l.colour }} aria-hidden="true" />
            Change for {l.name} ({l.colourName})
          </span>
        );
      })}
      {s.doubleDecker && <Badge>Double-decker</Badge>}
      {showQuality && <Badge>{QUALITY_LABEL[s.coordinateQuality] ?? s.coordinateQuality}</Badge>}
    </div>
  );
}

export { QUALITY_LABEL };
