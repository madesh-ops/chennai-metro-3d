import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "../../components/navigation/SiteHeader";
import { SiteFooter } from "../../components/navigation/SiteFooter";
import { StationMap } from "../../components/station/StationMap";
import { buttonClass } from "../../components/ui/Button";
import { ArrowRight } from "../../components/ui/Icons";
import { getRouteSummary } from "../../lib/getRouteSummary";

export const metadata: Metadata = {
  title: "Explore the network",
  description: "Chennai Metro Line 4's first Phase II stretch: sections, speed limits, the Arcot Road double-decker and the trains.",
};

export default function ExplorePage() {
  const s = getRouteSummary();
  const name = (id: string) => s.stations.find((x) => x.id === id)?.name ?? id;
  const served = s.stations.filter((x) => x.service === "stop").length;
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex-1">
        <section className="px-4 pb-6 pt-10 sm:px-8 lg:px-12 lg:pt-14">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="flex max-w-2xl flex-col gap-4">
              <div className="flex items-center gap-2 font-mono text-[12px] tracking-[0.08em] text-muted">
                <span className="h-1 w-3.5 rounded-sm" style={{ background: s.lineColour }} aria-hidden="true" />
                {s.lineName.toUpperCase()} · {s.lineColourName.toUpperCase()}
              </div>
              <h1 className="text-[32px] font-semibold tracking-[-0.02em] sm:text-[40px]">Explore the network</h1>
              <p className="text-[16px] leading-relaxed text-muted">
                Line 4 will run {s.lineLengthKm} km from Lighthouse to Poonamallee Bypass. Its first {s.lengthKm} km — {s.title} —
                is cleared for service, with {served} stations open and the rest of the corridor still under construction.
              </p>
            </div>
            <Link href="/routes" className={buttonClass("primary", "md")}>
              Start a journey <ArrowRight size={16} />
            </Link>
          </div>
        </section>

        <section className="px-4 sm:px-8 lg:px-12" aria-label="Route map">
          <div className="relative h-[420px] overflow-hidden rounded-2xl border border-line bg-[#0a0f18] sm:h-[540px]">
            <StationMap summary={s} className="absolute inset-0 h-full w-full p-2" />
            <p className="absolute bottom-4 left-5 font-mono text-[11px] text-faint">Select a station to open its page</p>
          </div>
        </section>

        <section className="grid gap-px overflow-hidden px-4 py-14 sm:px-8 lg:grid-cols-3 lg:px-12" aria-label="Sections">
          <div className="grid gap-4 lg:col-span-3 lg:grid-cols-3">
            {s.speedSections.map((sec, i) => (
              <article key={i} className="flex flex-col gap-3 rounded-2xl border border-line p-6">
                <span className="font-mono text-[12px] tracking-[0.08em] text-muted">SECTION {i + 1}</span>
                <h2 className="text-[18px] font-semibold">
                  {name(sec.from)} — {name(sec.to)}
                </h2>
                <p className="text-[14px] leading-relaxed text-muted">
                  Simulated at up to <span className="text-ink">{sec.maxSpeedKmh} km/h</span>
                  {sec.status === "reported"
                    ? ", the limit reported after CMRS raised it from 25 km/h in May 2026."
                    : ", the trainset's operating speed (no section limit has been published)."}
                </p>
              </article>
            ))}
            {s.doubleDecker && (
              <article className="flex flex-col gap-3 rounded-2xl border border-line p-6">
                <span className="font-mono text-[12px] tracking-[0.08em] text-muted">STRUCTURE</span>
                <h2 className="text-[18px] font-semibold">Arcot Road double-decker</h2>
                <p className="text-[14px] leading-relaxed text-muted">
                  {s.doubleDecker.lengthKm} km two-tier viaduct between {name(s.doubleDecker.from)} and {name(s.doubleDecker.to)}. Line 4
                  runs on the lower deck, Line 5 (Red Line, under construction) on the upper deck, with shared concourses at four
                  stations. Just after Porur Junction, Line 5 peels off the upper deck and curves south to Mount–Poonamallee Road,
                  towards Mugalivakkam.
                </p>
              </article>
            )}
          </div>
        </section>

        <section className="grid gap-10 border-t border-line px-4 py-14 sm:px-8 lg:grid-cols-2 lg:px-12" aria-label="Trains and service">
          <div className="flex flex-col gap-5">
            <h2 className="text-[13px] font-semibold tracking-[0.12em] text-muted">THE TRAINS</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-6">
              <Fact k="Builder" v={`${s.rollingStock.manufacturer} ${s.rollingStock.family}`} />
              <Fact k="Formation" v={`${s.rollingStock.cars} cars, ${s.rollingStock.lengthM} m`} />
              <Fact k="Operating speed" v={`${s.rollingStock.operatingSpeedKmh} km/h`} />
              <Fact k="Design speed" v={`${s.rollingStock.designSpeedKmh} km/h`} />
              <Fact k="Capacity (crush)" v={`~${s.rollingStock.capacity}`} />
              <Fact k="Automation" v={s.rollingStock.automation} />
            </dl>
          </div>
          <div className="flex flex-col gap-5">
            <h2 className="text-[13px] font-semibold tracking-[0.12em] text-muted">THE SERVICE</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-6">
              <Fact k="Status" v={s.statusLabel} />
              <Fact k="Planned headway" v={`${s.headwayMinutes} min · ${s.trainsInService} trains`} />
              <Fact k="Hours" v={s.operatingHours} />
              <Fact k="Fares" v={`₹${s.fareMin}–₹${s.fareMax}`} />
              <Fact k="End to end (reported)" v={`~${s.reportedJourneyMinutes} min`} />
              <Fact k="Stations" v={`${served} served · ${s.stations.length - served} passed`} />
            </dl>
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
