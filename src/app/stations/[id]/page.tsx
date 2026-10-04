import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "../../../components/navigation/SiteHeader";
import { SiteFooter } from "../../../components/navigation/SiteFooter";
import { StationBadges, QUALITY_LABEL } from "../../../components/station/StationBadges";
import { StationMap } from "../../../components/station/StationMap";
import { buttonClass } from "../../../components/ui/Button";
import { ArrowRight, ChevronLeft } from "../../../components/ui/Icons";
import { getRouteSummary } from "../../../lib/getRouteSummary";
import { dataBundle } from "../../../simulation/data";

export function generateStaticParams() {
  return getRouteSummary().stations.map((s) => ({ id: s.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const st = getRouteSummary().stations.find((s) => s.id === id);
  if (!st) return { title: "Station not found" };
  return {
    title: `${st.name} station`,
    description: `${st.name}${st.nameTa ? ` (${st.nameTa})` : ""} on Chennai Metro Line 4 — ${st.service === "stop" ? "served" : "not yet open"}, ${st.km.toFixed(2)} km from Poonamallee Bypass.`,
  };
}

export default async function StationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = getRouteSummary();
  const idx = s.stations.findIndex((x) => x.id === id);
  if (idx < 0) notFound();
  const st = s.stations[idx];
  const prevServed = [...s.stations.slice(0, idx)].reverse().find((x) => x.service === "stop");
  const nextServed = s.stations.slice(idx + 1).find((x) => x.service === "stop");
  const first = s.stopIds[0];
  const last = s.stopIds[s.stopIds.length - 1];
  const landmarks = dataBundle.landmarks.landmarks.filter((l) => l.nearStation === st.id);
  const sourceName = dataBundle.stations.stations.find((x) => x.id === st.id)?.coordinates?.source;
  const sourceText = sourceName ? dataBundle.stations.meta.sources[sourceName] : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex-1 px-4 py-8 sm:px-8 lg:px-12 lg:py-12">
        <Link href="/stations" className="inline-flex items-center gap-1 text-[14px] text-muted hover:text-ink">
          <ChevronLeft size={16} /> All stations
        </Link>
        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:gap-14">
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 font-mono text-[12px] tracking-[0.08em] text-muted">
                <span className="h-1 w-3.5 rounded-sm" style={{ background: s.lineColour }} aria-hidden="true" />
                {s.lineName.toUpperCase()} · {st.km.toFixed(2)} KM FROM POONAMALLEE BYPASS
              </div>
              <h1 className="text-[36px] font-semibold uppercase leading-none tracking-[0.03em] sm:text-[48px]">{st.name}</h1>
              {st.nameTa && (
                <p lang="ta" className="font-tamil text-[22px] text-subtle sm:text-[26px]">
                  {st.nameTa}
                </p>
              )}
              <StationBadges s={st} />
            </div>

            {st.service === "stop" ? (
              <div className="flex flex-wrap gap-3">
                {st.id !== last && (
                  <Link href={`/simulator?from=${st.id}&to=${last}`} className={buttonClass("primary", "md")}>
                    Ride to {s.stations.find((x) => x.id === last)?.name} <ArrowRight size={16} />
                  </Link>
                )}
                {st.id !== first && (
                  <Link href={`/simulator?from=${st.id}&to=${first}`} className={buttonClass("secondary", "md")}>
                    Ride to {s.stations.find((x) => x.id === first)?.name}
                  </Link>
                )}
              </div>
            ) : (
              <p className="rounded-xl border border-line bg-surface px-4 py-3 text-[14px] leading-relaxed text-subtle">
                Not served yet — trains run through without stopping. Nearest served stations:{" "}
                {prevServed && <Link className="text-accent-soft hover:underline" href={`/stations/${prevServed.id}`}>{prevServed.name}</Link>}
                {prevServed && nextServed && " and "}
                {nextServed && <Link className="text-accent-soft hover:underline" href={`/stations/${nextServed.id}`}>{nextServed.name}</Link>}.
              </p>
            )}

            <dl className="divide-y divide-line rounded-2xl border border-line">
              <Fact label="Status">{st.service === "stop" ? "Served from opening (scheduled 11 Oct 2026)" : "Built, not yet open"}</Fact>
              {st.altNames.length > 0 && <Fact label="Also known as">{st.altNames.join(", ")}</Fact>}
              <Fact label="Previous / next served">
                {prevServed ? prevServed.name : "—"} · {nextServed ? nextServed.name : "—"}
              </Fact>
              <Fact label="Position">
                {st.coordinateQuality === "interpolated" ? (
                  <span>No published coordinates — placed between neighbours for visualisation only.</span>
                ) : (
                  <span className="tabular font-mono text-[13px]">
                    {st.lat.toFixed(5)}° N, {st.lon.toFixed(5)}° E
                  </span>
                )}
                <span className="mt-1 block text-[12px] text-muted">
                  {QUALITY_LABEL[st.coordinateQuality]}
                  {sourceText ? ` · ${sourceText}` : ""}
                </span>
              </Fact>
              {st.notes && <Fact label="Notes">{st.notes}</Fact>}
            </dl>

            {landmarks.length > 0 && (
              <section aria-labelledby="nearby" className="flex flex-col gap-3">
                <h2 id="nearby" className="text-[13px] font-semibold tracking-[0.12em] text-muted">
                  CONTEXT
                </h2>
                {landmarks.map((l) => (
                  <div key={l.id} className="rounded-xl border border-line px-4 py-3.5">
                    <p className="text-[15px] font-medium">
                      {l.name}
                      {l.nameTa && (
                        <span lang="ta" className="ml-2 font-tamil text-[14px] font-normal text-subtle">
                          {l.nameTa}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-[14px] leading-relaxed text-muted">{l.description}</p>
                    <p className="mt-2 text-[12px] text-faint">Source: {l.source}</p>
                    {l.model && (
                      <p className="mt-1 text-[12px] text-faint">
                        Shown in 3D · position {l.positionQuality === "verified" ? "from published coordinates" : "approximate"}
                        {l.positionSource ? ` (${l.positionSource})` : ""}
                        {l.nameTa && !l.nameTaVerified ? " · Tamil name not yet verified" : ""}
                      </p>
                    )}
                  </div>
                ))}
              </section>
            )}
          </div>
          <div className="relative min-h-[360px] overflow-hidden rounded-2xl border border-line bg-[#0a0f18] lg:sticky lg:top-8 lg:h-[560px]">
            <StationMap summary={s} highlight={st.id} className="absolute inset-0 h-full w-full p-2" />
          </div>
        </div>
      </main>
      <SiteFooter lastVerified={s.lastVerified} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 px-5 py-4 sm:grid-cols-[160px_1fr] sm:gap-6">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="text-[14px] leading-relaxed text-ink">{children}</dd>
    </div>
  );
}
