"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import type { ComponentType } from "react";
import { BootScreen, LoadFailure } from "./BootScreen";

type AppProps = { from: string; to: string };

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

export function SimulatorLoader({ from, to }: AppProps) {
  return <SimulatorApp key={`${from}__${to}`} from={from} to={to} />;
}

/** Journey from ?from=…&to=… (defaults: the whole line, first to last served station). */
export function SimulatorFromUrl({ first, last }: { first: string; last: string }) {
  const params = useSearchParams();
  const from = params.get("from") ?? first;
  const to = params.get("to") ?? (from === last ? first : last);
  return <SimulatorLoader from={from} to={to} />;
}
