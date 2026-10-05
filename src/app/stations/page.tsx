import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "../../components/navigation/SiteHeader";
import { SiteFooter } from "../../components/navigation/SiteFooter";
import { StationBadges } from "../../components/station/StationBadges";
import { NetworkMap } from "../../components/route/NetworkMap";
import { ChevronRight } from "../../components/ui/Icons";
import { getAllRouteSummaries, getNetworkSummary } from "../../lib/getRouteSummary";
import { statusChip } from "../../lib/lines";
import type { RouteSummary } from "../../lib/routeSummary";

export const metadata: Metadata = {
  title: "Stations",
  description: "Every station on Chennai Metro's Blue, Green, Purple, Yellow and Red lines, in English and Tamil, with interchanges.",
};

export default function StationsPage() {
  const routes = getAllRouteSummaries();
  const network = getNetworkSummary();
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex-1 px-4 py-10 sm:px-8 lg:px-12 lg:py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex max-w-3xl flex-col gap-4">
            <p className="font-mono text-[12px] tracking-[0.08em] text-muted">CHENNAI METRO · {network.lines.length} LINES</p>
            <h1 className="text-[32px] font-semibold tracking-[-0.02em] sm:text-[40px]">Stations</h1>
            <p className="text-[16px] leading-relaxed text-muted">
              {network.stations.length} stations on {routes.length} routes. Positions come from OpenStreetMap; stations shared by two lines are
              interchanges.
            </p>
            <nav aria-label="Lines" className="mt-2 flex flex-wrap gap-2">
              {routes.map((r) => (
                <a key={r.id} href={`#${r.id}`} className="inline-flex h-9 items-center gap-2 rounded-full border border-line-strong px-3.5 text-[13px] text-subtle hover:text-ink">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.lineColour }} aria-hidden="true" />
                  {r.lineName} · {r.title}
                </a>
              ))}
            </nav>
          </div>
          <div className="relative h-[420px] overflow-hidden rounded-2xl border border-line bg-[#0a0f18] lg:h-[520px]">
            <NetworkMap network={network} linkStations className="absolute inset-0 h-full w-full p-3" />
          </div>
        </div>
        {routes.map((r) => (
          <RouteStations key={r.id} r={r} />
        ))}
      </main>
      <SiteFooter lastVerified={routes[0].lastVerified} />
    </div>
  );
}

function RouteStations({ r }: { r: RouteSummary }) {
  return (
    <section id={r.id} className="mt-14 scroll-mt-6" aria-labelledby={`${r.id}-h`}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${r.id}-h`} className="flex items-center gap-2.5 text-[13px] font-semibold tracking-[0.12em] text-muted">
          <span className="h-1 w-5 rounded-sm" style={{ background: r.lineColour }} aria-hidden="true" />
          {r.lineName.toUpperCase()} · {r.lineColourName.toUpperCase()} — {r.title.toUpperCase()}
        </h2>
        <p className="text-[12px] text-faint">
          {statusChip(r.status)} · {r.lengthKm} km · {r.stations.length} stations
        </p>
      </div>
      <ol className="overflow-hidden rounded-2xl border border-line">
        {r.stations.map((st) => (
          <li key={st.id} className="border-b border-line last:border-b-0">
            <Link href={`/stations/${st.id}`} className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface sm:gap-6 sm:px-6">
              <span className="tabular w-16 shrink-0 font-mono text-[13px] text-muted">
                {st.km.toFixed(2)}
                <span className="text-faint"> km</span>
              </span>
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
