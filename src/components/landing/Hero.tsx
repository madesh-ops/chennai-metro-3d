"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { ButtonLink } from "../ui/Button";
import { ArrowRight } from "../ui/Icons";
import { SiteHeader } from "../navigation/SiteHeader";
import { useWebGL } from "../../hooks/useWebGL";
import { usePrefersReducedMotion } from "../../hooks/useReducedMotion";
import { SceneErrorBoundary } from "../simulator/SceneErrorBoundary";

const HeroScene = dynamic(() => import("../../three/HeroScene"), { ssr: false });

export interface HeroFacts {
  lines: { name: string; colour: string }[];
  lengthKm: number;
  stations: number;
  openLines: number;
}

export function Hero({ facts }: { facts: HeroFacts }) {
  const webgl = useWebGL();
  const reduced = usePrefersReducedMotion();
  const [sceneReady, setSceneReady] = useState(false);

  return (
    <section className="relative isolate h-[100svh] min-h-[640px] w-full overflow-hidden" aria-labelledby="hero-title">
      {/* Poster shown until the 3D scene is ready (and as the WebGL fallback). */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(120% 80% at 78% 62%, rgba(217,154,98,0.32) 0%, rgba(217,154,98,0) 55%), linear-gradient(180deg, #060a11 0%, #142238 55%, #3a4356 100%)",
        }}
      />
      {webgl === "supported" && (
        <div className={`absolute inset-0 -z-10 transition-opacity duration-1000 ${sceneReady ? "opacity-100" : "opacity-0"}`}>
          <SceneErrorBoundary fallback={null}>
            <HeroScene reducedMotion={reduced} onReady={() => setSceneReady(true)} />
          </SceneErrorBoundary>
        </div>
      )}
      {/* Legibility scrims */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-0"
        style={{ background: "linear-gradient(90deg, rgba(7,11,18,0.86) 0%, rgba(7,11,18,0.5) 38%, rgba(7,11,18,0) 66%)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-36"
        style={{ background: "linear-gradient(180deg, rgba(7,11,18,0.7), rgba(7,11,18,0))" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
        style={{ background: "linear-gradient(0deg, rgba(7,11,18,0.75), rgba(7,11,18,0))" }}
      />

      <SiteHeader overlay />

      <div id="main" className="absolute inset-x-4 bottom-[120px] flex max-w-[560px] flex-col gap-6 sm:inset-x-8 lg:left-12 lg:bottom-[132px]">
        <div className="flex items-center gap-2.5 font-mono text-[12px] tracking-[0.08em] text-muted animate-fade-in">
          <span className="flex gap-1" aria-hidden="true">
            {facts.lines.map((l) => (
              <span key={l.name} className="h-1 w-[14px] rounded-sm" style={{ background: l.colour }} />
            ))}
          </span>
          <span>{facts.lines.length} LINES · REAL TRACK, REAL CITY</span>
        </div>
        <div className="flex flex-col gap-3.5 animate-rise-in">
          <p className="text-[13px] font-semibold tracking-[0.16em] text-muted">CHENNAI METRO 3D</p>
          <h1 id="hero-title" className="text-[44px] font-semibold leading-[1.02] tracking-[-0.025em] sm:text-[60px]">
            Explore the journey.
          </h1>
          <p className="max-w-[420px] text-[17px] leading-relaxed text-[#aeb8c5] sm:text-[18px]">
            Ride the Blue, Green, Purple, Yellow and Red lines in real-time 3D, on the real track through the real streets of Chennai.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 animate-rise-in [animation-delay:120ms]">
          <ButtonLink href="/routes" size="lg">
            Start a Journey <ArrowRight size={18} />
          </ButtonLink>
          <ButtonLink href="/explore" size="lg" variant="secondary">
            Explore Routes
          </ButtonLink>
        </div>
      </div>

      <div className="absolute inset-x-4 bottom-8 flex flex-wrap items-end justify-between gap-4 font-mono text-[12px] text-muted sm:inset-x-8 lg:inset-x-12">
        <dl className="flex flex-wrap gap-x-7 gap-y-1">
          <div className="flex gap-1.5">
            <dt className="sr-only">Length</dt>
            <dd><span className="text-ink">{facts.lengthKm.toFixed(0)}</span> km of line</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="sr-only">Stations</dt>
            <dd><span className="text-ink">{facts.stations}</span> stations</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="sr-only">Status</dt>
            <dd><span className="text-ink">{facts.openLines}</span> running or opening · {facts.lines.length - facts.openLines} under construction</dd>
          </div>
        </dl>
        <span className="hidden sm:inline">{webgl === "unsupported" ? "3D preview unavailable on this device" : "Real-time 3D · city from OpenStreetMap"}</span>
      </div>
    </section>
  );
}
