import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "../../components/navigation/SiteHeader";
import { SiteFooter } from "../../components/navigation/SiteFooter";
import { NetworkMap } from "../../components/route/NetworkMap";
import { buttonClass } from "../../components/ui/Button";
import { ArrowRight } from "../../components/ui/Icons";
import { getAllRouteSummaries, getNetworkSummary } from "../../lib/getRouteSummary";
import { simulatorHref } from "../../lib/routeSummary";
import { lineInfo, statusChip } from "../../lib/lines";

export const metadata: Metadata = {
  title: "Explore the network",
  description: "Chennai Metro's Blue, Green, Purple, Yellow and Red lines on one map: routes, status, speed limits, the Arcot Road double-decker and the trains.",
};

export default function ExplorePage() {
  const routes = getAllRouteSummaries();
  const network = getNetworkSummary();
  const s = routes[0];
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex-1">
        <section className="px-4 pb-6 pt-10 sm:px-8 lg:px-12 lg:pt-14">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="flex max-w-2xl flex-col gap-4">
              <p className="font-mono text-[12px] tracking-[0.08em] text-muted">CHENNAI METRO · {network.lines.length} LINES · {routes.length} ROUTES</p>
              <h1 className="text-[32px] font-semibold tracking-[-0.02em] sm:text-[40px]">Explore the network</h1>
              <p className="text-[16px] leading-relaxed text-muted">
                The Blue and Green lines are open; Line 4&apos;s first stretch to Vadapalani opens next, and the rest of Line 4 and the
                Purple and Red lines are under construction. Every line is drawn on its real track from OpenStreetMap.
              </p>
            </div>
            <Link href="/routes" className={buttonClass("primary", "md")}>
              Start a journey <ArrowRight size={16} />
            </Link>
          </div>
        </section>

        <section className="px-4 sm:px-8 lg:px-12" aria-label="Network map">
          <div className="relative h-[560px] overflow-hidden rounded-2xl border border-line bg-[#0a0f18] sm:h-[720px]">
            <NetworkMap network={network} linkStations className="absolute inset-0 h-full w-full p-3" />
            <p className="absolute bottom-4 left-5 font-mono text-[11px] text-faint">Select a station to open its page · dashed: under construction</p>
          </div>
        </section>

        <section className="grid gap-4 px-4 py-14 sm:px-8 md:grid-cols-2 lg:px-12 xl:grid-cols-3" aria-label="Routes">
          {routes.map((r) => {
            const name = (id: string) => r.stations.find((x) => x.id === id)?.name ?? id;
            const served = r.stations.filter((x) => x.service === "stop").length;
            const inter = r.stations.filter((x) => x.interchange.length > 0);
            return (
              <article key={r.id} className="flex flex-col gap-4 rounded-2xl border border-line p-6">
                <div className="flex items-center gap-2 font-mono text-[12px] tracking-[0.08em] text-muted">
                  <span className="h-1 w-3.5 rounded-sm" style={{ background: r.lineColour }} aria-hidden="true" />
                  {r.lineName.toUpperCase()} · {r.lineColourName.toUpperCase()} · {statusChip(r.status).toUpperCase()}
                </div>
                <h2 className="text-[19px] font-semibold">{r.title}</h2>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <Fact k="Length" v={`${r.lengthKm} km`} />
                  <Fact k="Stations" v={r.preview ? `${r.stations.length}` : `${served} served${r.stations.length > served ? ` · ${r.stations.length - served} passed` : ""}`} />
                  <Fact k="Status" v={r.statusLabel} />
                  <Fact k="Fares" v={`₹${r.fareMin}–₹${r.fareMax}`} />
                  {r.reportedJourneyMinutes ? <Fact k="End to end (reported)" v={`~${r.reportedJourneyMinutes} min`} /> : null}
                  {!r.preview && <Fact k="Headway" v={`${r.headwayMinutes} min`} />}
                </dl>
                {inter.length > 0 && (
                  <p className="text-[13px] leading-relaxed text-muted">
                    Interchanges: {inter.map((x) => `${x.name} (${x.interchange.map((l) => lineInfo(l).colourName).join(", ")})`).join(" · ")}
                  </p>
                )}
                {r.speedSections.map((sec, i) => (
                  <p key={i} className="text-[13px] leading-relaxed text-muted">
                    {name(sec.from)} — {name(sec.to)}: up to <span className="text-ink">{sec.maxSpeedKmh} km/h</span>
                    {sec.status === "reported" ? " (reported limit, May 2026)" : " (trainset operating speed)"}
                  </p>
                ))}
                {r.doubleDecker && (
                  <p className="text-[13px] leading-relaxed text-muted">
                    {r.doubleDecker.lengthKm} km Arcot Road double-decker between {name(r.doubleDecker.from)} and {name(r.doubleDecker.to)}: Line 4
                    on the lower deck, the Red Line on the upper deck.
                  </p>
                )}
                <div className="mt-auto flex gap-2 pt-2">
                  <Link href={simulatorHref(r.id)} className={buttonClass("primary", "md")}>
                    Ride <ArrowRight size={16} />
                  </Link>
                  <Link href={`/routes?route=${r.id}`} className={buttonClass("secondary", "md")}>
                    Plan a journey
                  </Link>
                </div>
              </article>
            );
          })}
        </section>

        <section className="grid gap-10 border-t border-line px-4 py-14 sm:px-8 lg:grid-cols-2 lg:px-12" aria-label="Trains">
          <div className="flex flex-col gap-5">
            <h2 className="text-[13px] font-semibold tracking-[0.12em] text-muted">THE TRAINS (PHASE II)</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-6">
              <Fact k="Builder" v={`${s.rollingStock.manufacturer} ${s.rollingStock.family}`} />
              <Fact k="Formation" v={`${s.rollingStock.cars} cars, ${s.rollingStock.lengthM} m`} />
              <Fact k="Operating speed" v={`${s.rollingStock.operatingSpeedKmh} km/h`} />
              <Fact k="Design speed" v={`${s.rollingStock.designSpeedKmh} km/h`} />
              <Fact k="Capacity (crush)" v={`~${s.rollingStock.capacity}`} />
              <Fact k="Automation" v={s.rollingStock.automation} />
            </dl>
          </div>
          <div className="flex flex-col gap-4 text-[14px] leading-relaxed text-muted">
            <h2 className="text-[13px] font-semibold tracking-[0.12em] text-muted">ON EVERY LINE</h2>
            <p>
              The simulator uses the same three-car Phase II trainset on every line. The Blue and Green lines really run four-car Phase I
              trains; their formation is simplified here.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter lastVerified={s.lastVerified} />
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-[13px] text-muted">{k}</dt>
      <dd className="text-[15px] leading-snug text-ink">{v}</dd>
    </div>
  );
}
