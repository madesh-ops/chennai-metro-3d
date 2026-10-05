import Link from "next/link";
import { Hero } from "../components/landing/Hero";
import { SiteFooter } from "../components/navigation/SiteFooter";
import { NetworkMap } from "../components/route/NetworkMap";
import { ArrowRight } from "../components/ui/Icons";
import { getAllRouteSummaries, getNetworkSummary } from "../lib/getRouteSummary";
import { simulatorHref } from "../lib/routeSummary";
import { statusChip } from "../lib/lines";

export default function HomePage() {
  const routes = getAllRouteSummaries();
  const network = getNetworkSummary();
  const lengthKm = network.lines.reduce((a, l) => a + l.lengthKm, 0);
  return (
    <>
      <Hero
        facts={{
          lines: network.lines.map((l) => ({ name: l.name, colour: l.colour })),
          lengthKm,
          stations: network.stations.length,
          openLines: network.lines.filter((l) => l.open).length,
        }}
      />
      <section aria-labelledby="lines-heading" className="px-4 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-5">
              <p className="font-mono text-[12px] tracking-[0.08em] text-muted">THE NETWORK</p>
              <h2 id="lines-heading" className="text-[32px] font-semibold leading-[1.12] tracking-[-0.02em] sm:text-[40px]">
                Four lines, {Math.round(lengthKm)} km of real track, {network.stations.length} stations.
              </h2>
              <p className="max-w-xl text-[16px] leading-relaxed text-muted">
                Every line runs on its real path from OpenStreetMap: up on viaducts, down into tunnels and underground stations, past
                the real streets and buildings of the city. Lines still being built can be ridden as previews.
              </p>
            </div>
            <ul className="flex flex-col gap-3">
              {routes.map((r) => (
                <li key={r.id}>
                  <div className="group flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-line p-5 transition-colors hover:bg-surface">
                    <span className="h-12 w-1.5 shrink-0 rounded-full" style={{ background: r.lineColour }} aria-hidden="true" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2 font-mono text-[11.5px] tracking-[0.08em] text-muted">
                        {r.lineName.toUpperCase()} · {r.lineColourName.toUpperCase()}
                        <span className={`rounded-full border px-1.5 py-px text-[10px] ${r.preview ? "border-[#e8742a]/40 text-[#f0a46c]" : "border-line-strong text-subtle"}`}>
                          {statusChip(r.status).toUpperCase()}
                        </span>
                      </span>
                      <span className="text-[17px] font-semibold">{r.title}</span>
                      <span className="text-[13px] text-muted">
                        {r.lengthKm} km · {r.stopIds.length} {r.preview ? "stations" : "stations served"}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Link href={`/routes?route=${r.id}`} className="inline-flex h-10 items-center rounded-lg border border-line-strong px-3.5 text-[14px] text-subtle transition-colors hover:text-ink">
                        Plan
                      </Link>
                      <Link href={simulatorHref(r.id)} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#2b85ff]">
                        Ride <ArrowRight size={15} />
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="relative min-h-[520px] overflow-hidden rounded-2xl border border-line bg-[#0a0f18] lg:min-h-[720px]">
            <NetworkMap network={network} linkStations className="absolute inset-0 h-full w-full p-3" />
            <p className="absolute bottom-4 left-5 right-5 font-mono text-[11px] text-faint">
              Real track from OpenStreetMap · dashed: under construction · white rings: interchanges · select a station
            </p>
          </div>
        </div>
        <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
          {[
            { title: "Ride it", body: "Five camera views, real braking curves, tunnels and viaducts, and a full station-stop sequence at every platform.", href: "/routes", cta: "Choose a journey" },
            { title: "Every station", body: "Names in English and Tamil, the lines that call there, and what is still under construction.", href: "/stations", cta: "Browse stations" },
            { title: "Open data", body: "No paid APIs. Track and city from OpenStreetMap; every fact is sourced, every approximation labelled.", href: "/about", cta: "Data & sources" },
          ].map((c) => (
            <Link key={c.title} href={c.href} className="group flex flex-col gap-3 bg-bg p-6 transition-colors hover:bg-surface sm:p-7">
              <span className="text-[17px] font-semibold">{c.title}</span>
              <span className="flex-1 text-[14px] leading-relaxed text-muted">{c.body}</span>
              <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-accent-soft">
                {c.cta} <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>
      <SiteFooter lastVerified={routes[0].lastVerified} />
    </>
  );
}
