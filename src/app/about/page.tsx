import type { Metadata } from "next";
import { SiteHeader } from "../../components/navigation/SiteHeader";
import { SiteFooter } from "../../components/navigation/SiteFooter";
import { dataBundle } from "../../simulation/data";
import { getRouteSummary } from "../../lib/getRouteSummary";

export const metadata: Metadata = {
  title: "About & data sources",
  description: "How Chennai Metro 3D is built, what is verified, what is approximated, and where every fact comes from.",
};

const ROWS: { what: string; status: "Verified" | "Reported" | "Assumed" | "Approximate" | "Procedural"; detail: string }[] = [
  { what: "Station names and order", status: "Verified", detail: "Consistent across CMRS-approval, fare and opening coverage (DT Next, NativePlanet, Swarajya, Oneindia)." },
  { what: "Which stations are served", status: "Verified", detail: "11 served; six Arcot Road stations passed without stopping at opening." },
  { what: "Route length (14.64 km)", status: "Reported", detail: "As published for the opening. The modelled spline through station coordinates measures 14.61 km — within 0.2 %." },
  { what: "Station coordinates", status: "Verified", detail: "Six stations use their own Wikipedia coordinates; five use the bus stop or locality of the same name (±150–300 m)." },
  { what: "Unopened station positions", status: "Approximate", detail: "No coordinates published; spaced so Alapakkam–Alwarthirunagar spans the reported 3.75 km double-decker." },
  { what: "Track alignment between stations", status: "Approximate", detail: "A smooth spline through the stations, not the surveyed viaduct, which follows Trunk Road and Arcot Road." },
  { what: "Train length, cars, speeds", status: "Verified", detail: "Alstom Metropolis: 3 cars, 67.8 m, 80 km/h operating, 90 km/h design." },
  { what: "Porur–Vadapalani speed limit", status: "Reported", detail: "Raised from 25 to 40 km/h in May 2026 per news coverage of the CMRS approval." },
  { what: "Acceleration, braking, dwell", status: "Assumed", detail: "Typical metro values (1.0 m/s², 0.85 m/s², 22 s). CMRL has not published Line 4 figures." },
  { what: "Train livery and interior", status: "Approximate", detail: "Stylised; the official livery and seating layout are not reproduced." },
  { what: "Buildings, trees, traffic", status: "Procedural", detail: "Seeded generation of a plausible Chennai streetscape. No real building is modelled." },
];

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
      <main id="main" className="flex-1 px-4 py-10 sm:px-8 lg:px-12 lg:py-14">
        <div className="flex max-w-3xl flex-col gap-5">
          <h1 className="text-[32px] font-semibold tracking-[-0.02em] sm:text-[40px]">About Chennai Metro 3D</h1>
          <p className="text-[17px] leading-relaxed text-subtle">
            An interactive, real-time 3D ride on Chennai Metro&apos;s Blue, Green, Yellow and Red lines, on the real track and through the
            real city (from OpenStreetMap). Pick a line and two stations and watch a three-car train accelerate, cruise, brake into each platform, open its doors and carry on — from five camera angles, by
            day or night, in sun or rain.
          </p>
          <p className="text-[15px] leading-relaxed text-muted">
            It runs entirely in the browser with no paid services and no API keys: open-source libraries (Next.js, React, three.js,
            React Three Fiber), data stored as JSON in the project, textures drawn procedurally at runtime, and announcements spoken
            by your browser&apos;s built-in voice. It is an independent project and is not affiliated with Chennai Metro Rail Limited.
          </p>
        </div>

        <section className="mt-14" aria-labelledby="provenance">
          <h2 id="provenance" className="mb-5 text-[13px] font-semibold tracking-[0.12em] text-muted">
            WHAT IS REAL, WHAT IS APPROXIMATED
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <thead className="border-b border-line text-[12px] text-muted">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Item</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                  <th scope="col" className="px-5 py-3 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ROWS.map((r) => (
                  <tr key={r.what}>
                    <th scope="row" className="px-5 py-3.5 align-top font-medium text-ink">{r.what}</th>
                    <td className="px-5 py-3.5 align-top">
                      <span
                        className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[11.5px] font-medium ${
                          r.status === "Verified"
                            ? "border-[#3dd68c]/40 text-[#7ee2ae]"
                            : r.status === "Reported"
                              ? "border-accent/50 text-accent-soft"
                              : r.status === "Assumed"
                                ? "border-route/40 text-route"
                                : "border-line-strong text-subtle"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 align-top leading-relaxed text-muted">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-[13px] text-faint">
            All values live in <code className="font-mono text-subtle">src/data/*.json</code> with their sources, so corrections need
            no code changes. Last verified {s.lastVerified}.
          </p>
        </section>

        <section className="mt-14 grid gap-12 lg:grid-cols-2" aria-label="Sources and credits">
          <div className="flex flex-col gap-4">
            <h2 className="text-[13px] font-semibold tracking-[0.12em] text-muted">SOURCES</h2>
            <ul className="flex flex-col gap-2.5 text-[14px] leading-relaxed text-subtle">
              {unique.map((src) => (
                <li key={src} className="border-l-2 border-line pl-3">{src}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-4">
            <h2 className="text-[13px] font-semibold tracking-[0.12em] text-muted">CREDITS &amp; LICENCES</h2>
            <ul className="flex flex-col gap-2.5 text-[14px] leading-relaxed text-subtle">
              <li className="border-l-2 border-line pl-3">three.js, React Three Fiber, drei — MIT licence</li>
              <li className="border-l-2 border-line pl-3">Next.js, React, Tailwind CSS, Zustand — MIT licence</li>
              <li className="border-l-2 border-line pl-3">Geist and Geist Mono by Vercel — SIL Open Font License 1.1</li>
              <li className="border-l-2 border-line pl-3">Noto Sans Tamil by Google — SIL Open Font License 1.1</li>
              <li className="border-l-2 border-line pl-3">
                Metro track, station positions, tunnels/viaducts, building footprints, streets, water and parks: map data
                © OpenStreetMap contributors, available
                under the Open Database Licence (ODbL) — openstreetmap.org/copyright
              </li>
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter lastVerified={s.lastVerified} />
    </div>
  );
}
