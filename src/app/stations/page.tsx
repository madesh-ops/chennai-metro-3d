import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "../../components/navigation/SiteHeader";
import { SiteFooter } from "../../components/navigation/SiteFooter";
import { StationBadges } from "../../components/station/StationBadges";
import { ChevronRight } from "../../components/ui/Icons";
import { getRouteSummary } from "../../lib/getRouteSummary";

export const metadata: Metadata = {
  title: "Stations",
  description: "All 17 stations on Chennai Metro Line 4 between Poonamallee Bypass and Vadapalani, in English and Tamil.",
};

export default function StationsPage() {
  const s = getRouteSummary();
  const served = s.stations.filter((x) => x.service === "stop");
  const passed = s.stations.filter((x) => x.service === "pass");
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex-1 px-4 py-10 sm:px-8 lg:px-12 lg:py-14">
        <div className="flex max-w-3xl flex-col gap-4">
          <div className="flex items-center gap-2 font-mono text-[12px] tracking-[0.08em] text-muted">
            <span className="h-1 w-3.5 rounded-sm" style={{ background: s.lineColour }} aria-hidden="true" />
            {s.lineName.toUpperCase()} · {s.title.toUpperCase()}
          </div>
          <h1 className="text-[32px] font-semibold tracking-[-0.02em] sm:text-[40px]">Stations</h1>
          <p className="text-[16px] leading-relaxed text-muted">
            {served.length} stations are served from opening. {passed.length} more on Arcot Road are built into the line but trains
            pass through them until they are finished.
          </p>
        </div>

        <StationGroup title="Served from opening" items={served} />
        <StationGroup title="Passed without stopping" items={passed} note="Positions of these stations are indicative: no coordinates have been published yet." />
      </main>
      <SiteFooter lastVerified={s.lastVerified} />
    </div>
  );
}

function StationGroup({ title, items, note }: { title: string; items: ReturnType<typeof getRouteSummary>["stations"]; note?: string }) {
  return (
    <section className="mt-12" aria-label={title}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold tracking-[0.12em] text-muted">{title.toUpperCase()}</h2>
        {note && <p className="text-[12px] text-faint">{note}</p>}
      </div>
      <ol className="overflow-hidden rounded-2xl border border-line">
        {items.map((st) => (
          <li key={st.id} className="border-b border-line last:border-b-0">
            <Link href={`/stations/${st.id}`} className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-surface sm:gap-6 sm:px-6">
              <span className="tabular w-14 shrink-0 font-mono text-[13px] text-muted">{st.km.toFixed(2)}<span className="text-faint"> km</span></span>
              <span className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-6">
                <span className="flex min-w-0 flex-col">
                  <span className="text-[16px] font-medium text-ink">{st.name}</span>
                  {st.nameTa && (
                    <span lang="ta" className="font-tamil text-[14px] text-muted">
                      {st.nameTa}
                    </span>
                  )}
                </span>
                <span className="sm:ml-auto">
                  <StationBadges s={st} showQuality={false} />
                </span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
