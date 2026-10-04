import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteHeader } from "../../components/navigation/SiteHeader";
import { JourneyPlanner } from "../../components/route/JourneyPlanner";
import { getRouteSummary } from "../../lib/getRouteSummary";

export const metadata: Metadata = {
  title: "Choose your journey",
  description: "Pick any two served stations on Chennai Metro Line 4 and ride between them in 3D.",
};

export default function RoutesPage() {
  const summary = getRouteSummary();
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex flex-1 flex-col px-4 py-6 sm:px-8 sm:py-10 lg:px-12">
        <Suspense fallback={<div className="flex-1" />}>
          <JourneyPlanner summary={summary} />
        </Suspense>
      </main>
    </div>
  );
}
