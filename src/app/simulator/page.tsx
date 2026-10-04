import type { Metadata } from "next";
import { SimulatorLoader } from "../../components/simulator/SimulatorLoader";
import { getRouteSummary } from "../../lib/getRouteSummary";

export const metadata: Metadata = {
  title: "Simulator",
  description: "Ride Chennai Metro Line 4 in real-time 3D: cinematic, driver, passenger, map and free cameras.",
};

export default async function SimulatorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const summary = getRouteSummary();
  const first = summary.stopIds[0];
  const last = summary.stopIds[summary.stopIds.length - 1];
  const from = typeof sp.from === "string" ? sp.from : first;
  const to = typeof sp.to === "string" ? sp.to : from === last ? first : last;
  return <SimulatorLoader from={from} to={to} />;
}
