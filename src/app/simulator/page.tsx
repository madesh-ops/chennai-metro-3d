import type { Metadata } from "next";
import { Suspense } from "react";
import { SimulatorFromUrl } from "../../components/simulator/SimulatorLoader";
import { BootScreen } from "../../components/simulator/BootScreen";
import { getRouteSummary } from "../../lib/getRouteSummary";

export const metadata: Metadata = {
  title: "Simulator",
  description: "Ride any Chennai Metro line in real-time 3D: cinematic, driver, passenger, map and free cameras.",
};

export default function SimulatorPage() {
  const summary = getRouteSummary();
  const first = summary.stopIds[0];
  const last = summary.stopIds[summary.stopIds.length - 1];
  // ?from=…&to=… is read in the browser, so the page also works as a static file.
  return (
    <Suspense fallback={<BootScreen />}>
      <SimulatorFromUrl first={first} last={last} />
    </Suspense>
  );
}
