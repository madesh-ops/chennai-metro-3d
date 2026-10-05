"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import type { ComponentType } from "react";
import { BootScreen, LoadFailure } from "./BootScreen";
import routesData from "../../data/routes.json";

type AppProps = { routeId?: string; from: string; to: string };

// Start downloading the 3D scene alongside the app shell instead of after it;
// SimulatorApp's own dynamic import then resolves from the module cache.
if (typeof window !== "undefined") {
  void import("../../three/SimulatorScene").catch(() => undefined);
}

const SimulatorApp = dynamic<AppProps>(
  () =>
    import("./SimulatorApp").catch((error: unknown) => {
      // A failed download must show an explanation, never an endless loader.
      const Failed: ComponentType<AppProps> = () => <LoadFailure error={error} />;
      return { default: Failed };
    }),
  { ssr: false, loading: () => <BootScreen /> },
);

export function SimulatorLoader({ routeId, from, to }: AppProps) {
  return <SimulatorApp key={`${routeId ?? ""}__${from}__${to}`} routeId={routeId} from={from} to={to} />;
}

/** Served termini of each route, for default journeys (?route=… without from/to). */
const ROUTE_ENDS: Record<string, [string, string]> = Object.fromEntries(
  (routesData as { routes: { id: string; stationIds: string[] }[] }).routes.map((r) => [r.id, [r.stationIds[0], r.stationIds[r.stationIds.length - 1]]]),
);

/**
 * Journey from ?route=…&from=…&to=… (defaults: the first route, its whole
 * length). Old links without a route keep riding the original Line 4 route.
 */
export function SimulatorFromUrl({ first, last }: { first: string; last: string }) {
  const params = useSearchParams();
  const routeId = params.get("route") ?? undefined;
  const [a, b] = (routeId && ROUTE_ENDS[routeId]) || [first, last];
  const from = params.get("from") ?? a;
  const to = params.get("to") ?? (from === b ? a : b);
  return <SimulatorLoader routeId={routeId} from={from} to={to} />;
}
