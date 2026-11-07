import type { Metadata } from "next";
import { SiteHeader } from "../../components/navigation/SiteHeader";
import { SiteFooter } from "../../components/navigation/SiteFooter";
import { dataBundle } from "../../simulation/data";
import { getRouteSummary } from "../../lib/getRouteSummary";
import { PageIntro, SectionTitle } from "../../components/ui/PageIntro";

export const metadata: Metadata = {
  title: "About & data sources",
  description: "How Chennai Metro 3D is built, what is verified, what is approximated, and where every fact comes from.",
};

const ROWS: { what: string; status: "Verified" | "Reported" | "Assumed" | "Approximate" | "Procedural"; detail: string }[] = [
  { what: "Track path, tunnels and viaducts (all five lines)", status: "Verified", detail: "The real track from OpenStreetMap, accurate to a few metres, with its elevated and underground stretches. Poonamallee Bypass–Vadapalani measures 14.73 km against the official 14.64 km." },
  { what: "Station positions and order", status: "Verified", detail: "OpenStreetMap stations on the real track. Lines 3 and 5 are not fully mapped yet: their missing stations (43 of 48, 18 of 45) follow the Wikipedia station lists and sit at the same-name bus stop or locality, or are spaced evenly between neighbours. Each station page says which." },
  { what: "Which Line 4 stations are served at opening", status: "Verified", detail: "11 served between Poonamallee Bypass and Vadapalani; six Arcot Road stations passed without stopping (CMRS approval and opening coverage)." },
  { what: "Route lengths, opening, headway, fares", status: "Reported", detail: "As published (CMRL, news coverage, Wikipedia). Lines 3, 5 and Line 4 east are under construction and ridden as previews: every station is a stop and timings are illustrative." },
  { what: "City: buildings, streets, water, parks", status: "Approximate", detail: "Real OpenStreetMap footprints and street grid within 700 m of every line. Heights are estimated (OSM has almost none here). Streets with no buildings mapped get plausible plots along the real street." },
  { what: "Flyovers and interchanges", status: "Approximate", detail: "Paths, lanes and which roads are bridges from OpenStreetMap; deck height (7.5 m), 4% ramps, barriers and piers are standard values, not survey data." },
  { what: "Landmarks (temples, malls, cinema, hospital, bus stands)", status: "Approximate", detail: "Placed from published coordinates or traced from satellite views and photos; the same spot on every line. Models are stylised; hoardings and film posters are invented." },
  { what: "Train length, cars, speeds", status: "Verified", detail: "Alstom Metropolis: 3 cars, 67.8 m, 80 km/h operating, 90 km/h design. The same three-car train is used on every line (Lines 1 and 2 really run four-car Phase I trains)." },
  { what: "Porur–Vadapalani speed limit", status: "Reported", detail: "Raised from 25 to 40 km/h in May 2026 per news coverage of the CMRS approval." },
  { what: "Acceleration, braking, dwell", status: "Assumed", detail: "Typical metro values (1.0 m/s², 0.85 m/s², 22 s); CMRL has not published them." },
  { what: "Train livery and interior", status: "Approximate", detail: "Stylised after photos of CMRL Alstom Metropolis trainsets." },
  { what: "Station interiors in Walk mode", status: "Procedural", detail: "One generic floor plan for every elevated station (concourse, ticket office, security check, fare gates, escalators, street stairs, signs), not a survey of any real one. The security check's layout (X-ray belt, men's lane, women's enclosure, staff) and the used-ticket box at the exit are illustrative. Underground concourses are not modelled yet." },
  { what: "Ticket bought in Walk mode", status: "Reported", detail: "A single-journey paper QR ticket from the counter at the full distance-band fare: CMRL sells these at counters, and its 20% discount does not apply to them (DT Next, 1 Sep 2026)." },
  { what: "Facades, shop names, traffic, crowds", status: "Procedural", detail: "Window patterns, invented shop names, road traffic and passengers are generated, seeded so they are the same on every visit." },
];

/** How sure each kind of fact is, most to least. */
const STATUS: Record<(typeof ROWS)[number]["status"], { colour: string; meaning: string }> = {
  Verified: { colour: "#3dd68c", meaning: "checked against the map or an official source" },
  Reported: { colour: "#6fa8ff", meaning: "as published in the news or by CMRL" },
  Approximate: { colour: "#b7c0cc", meaning: "real in outline, estimated in detail" },
  Assumed: { colour: "#f2b705", meaning: "a typical value; nothing has been published" },
  Procedural: { colour: "#7a8596", meaning: "generated, but the same on every visit" },
};

export default function AboutPage() {
  const s = getRouteSummary();
  const sources = [
    ...Object.values(dataBundle.stations.meta.sources),
    ...Object.values(dataBundle.routes.meta.sources),
    ...Object.values(dataBundle.tracks.meta.sources),
  ];
  const unique = Array.from(new Set(sources));
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex-1 px-5 pb-24 pt-14 sm:px-8 lg:px-12 lg:pt-20">
        <PageIntro title="What's real, and what isn't.">
          <p>
            Chennai Metro 3D is a real-time ride on the Blue, Green, Purple, Yellow and Red lines, on the real track and through the real city.
            Pick two stations and ride between them from the cab, a seat, on foot or from above, by day or night, in sun or rain.
          </p>
        </PageIntro>

        <div className="mt-12 grid max-w-[64rem] gap-6 text-[16px] leading-relaxed text-muted lg:grid-cols-2 lg:gap-12">
          <p>
            The track, stations, tunnels and viaducts of every line, and the buildings, streets, flyovers, water and parks around them, come from
            OpenStreetMap. The city streams in around the train in one-kilometre tiles, built in a background thread. Underground, the train runs
            through tunnels and curved station halls; above ground, along real roads and past real landmarks.
          </p>
          <p>
            It runs entirely in your browser, with no paid services, no API keys and no tracking: open-source libraries, data kept as JSON in the
            project, textures drawn as it loads, and announcements spoken by your browser&apos;s own voice. It is an independent project, not
            affiliated with Chennai Metro Rail Limited.
          </p>
        </div>

        <section className="mt-24 lg:mt-32" aria-labelledby="provenance">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-20">
            <div className="flex flex-col gap-5 lg:sticky lg:top-8 lg:self-start">
              <SectionTitle id="provenance">Where each part comes from</SectionTitle>
              <dl className="flex flex-col gap-2.5 text-[14px]">
                {Object.entries(STATUS).map(([k, v]) => (
                  <div key={k} className="flex gap-2.5">
                    <dt className="flex w-28 shrink-0 items-center gap-2 font-medium text-ink">
                      <span className="h-2 w-2 rounded-full" style={{ background: v.colour }} aria-hidden="true" />
                      {k}
                    </dt>
                    <dd className="text-muted">{v.meaning}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <dl>
                {ROWS.map((r) => (
                  <div key={r.what} className="grid grid-cols-[minmax(0,1fr)] gap-2 border-t border-line py-6 last:border-b sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:gap-8">
                    <dt className="flex flex-col gap-1.5">
                      <span className="text-[16px] font-semibold leading-snug tracking-[-0.01em]">{r.what}</span>
                      <span className="flex items-center gap-2 text-[13px] text-subtle">
                        <span className="h-2 w-2 rounded-full" style={{ background: STATUS[r.status].colour }} aria-hidden="true" />
                        {r.status}
                      </span>
                    </dt>
                    <dd className="text-[15px] leading-relaxed text-muted">{r.detail}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 text-[13px] leading-relaxed text-faint">
                Every value lives in <code className="text-subtle">src/data/*.json</code> beside its source, so a correction needs no code change.
                Last checked{" "}
                {new Date(s.lastVerified).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-24 grid gap-16 lg:mt-32 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-20" aria-label="Sources and credits">
          <SectionTitle>Sources</SectionTitle>
          <ul className="flex flex-col text-[15px] leading-relaxed text-subtle">
            {unique.map((src) => (
              <li key={src} className="border-t border-line py-3 last:border-b">
                {src}
              </li>
            ))}
          </ul>
          <SectionTitle>Credits and licences</SectionTitle>
          <ul className="flex flex-col text-[15px] leading-relaxed text-subtle">
            {[
              "three.js, React Three Fiber, drei: MIT licence",
              "Next.js, React, Tailwind CSS, Zustand: MIT licence",
              "Geist and Geist Mono by Vercel: SIL Open Font License 1.1",
              "Noto Sans Tamil by Google: SIL Open Font License 1.1",
              "Station lists for Lines 3 and 5 where OpenStreetMap is incomplete: Wikipedia (Purple Line, Red Line), CC BY-SA 4.0",
            ].map((c) => (
              <li key={c} className="border-t border-line py-3">
                {c}
              </li>
            ))}
            <li className="border-y border-line py-3">
              Metro track, station positions, tunnels and viaducts, building footprints, streets, flyovers, water and parks: map data ©{" "}
              <a href="https://www.openstreetmap.org/copyright" className="text-ink underline decoration-white/25 underline-offset-4 hover:decoration-white/70">
                OpenStreetMap contributors
              </a>
              , under the Open Database Licence (ODbL).
            </li>
          </ul>
        </section>
      </main>
      <SiteFooter lastVerified={s.lastVerified} />
    </div>
  );
}
