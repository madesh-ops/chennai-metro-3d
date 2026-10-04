import Link from "next/link";
import { Hero } from "../components/landing/Hero";
import { SiteFooter } from "../components/navigation/SiteFooter";
import { ArrowRight } from "../components/ui/Icons";
import { getRouteSummary } from "../lib/getRouteSummary";

export default function HomePage() {
  const s = getRouteSummary();
  const served = s.stations.filter((x) => x.service === "stop").length;
  const opening = new Date(s.openingDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return (
    <>
      <Hero
        facts={{
          lengthKm: s.lengthKm,
          servedStations: served,
          openingLabel: `Opening ${opening}`,
          title: s.title,
          lineColour: s.lineColour,
        }}
      />
      <section aria-labelledby="about-heading" className="px-4 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="grid gap-14 lg:grid-cols-[1fr_1.4fr] lg:gap-20">
          <div className="flex flex-col gap-5">
            <p className="font-mono text-[12px] tracking-[0.08em] text-muted">THE FIRST PHASE II STRETCH</p>
            <h2 id="about-heading" className="text-[32px] font-semibold leading-[1.12] tracking-[-0.02em] sm:text-[40px]">
              {s.lengthKm} km of elevated line, from the western edge of the city to Vadapalani.
            </h2>
            <p className="max-w-lg text-[16px] leading-relaxed text-muted">
              Line 4&apos;s first section has been cleared by the Commissioner of Metro Railway Safety. Trains call at {served} stations
              and run straight through six double-decker stations still being finished on Arcot Road.
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
            {[
              { title: "Ride it", body: "Five camera views, real braking curves and a full station-stop sequence at every platform.", href: "/routes", cta: "Choose a journey" },
              { title: "Every station", body: "Names in English and Tamil, where each one sits on the line, and what is still under construction.", href: "/stations", cta: "Browse stations" },
              { title: "Open data", body: "No paid APIs. Every fact is sourced, and every approximation is labelled as one.", href: "/about", cta: "Data & sources" },
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
        </div>
        <dl className="mt-16 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-line pt-10 sm:grid-cols-4">
          {[
            ["Route length", `${s.lengthKm} km`],
            ["Stations served", `${served}`],
            ["Trainsets", `${s.rollingStock.cars}-car ${s.rollingStock.manufacturer}`],
            ["Planned headway", `${s.headwayMinutes} min`],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-1.5">
              <dt className="text-[13px] text-muted">{k}</dt>
              <dd className="tabular font-mono text-[22px]">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <SiteFooter lastVerified={s.lastVerified} />
    </>
  );
}
