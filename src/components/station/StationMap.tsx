"use client";

import { useRouter } from "next/navigation";
import { RouteMap } from "../route/RouteMap";
import type { RouteSummary } from "../../lib/routeSummary";

/** Route map whose served stations navigate to their station pages. */
export function StationMap({ summary, highlight, className }: { summary: RouteSummary; highlight?: string; className?: string }) {
  const router = useRouter();
  return (
    <RouteMap
      summary={summary}
      highlight={highlight ?? null}
      onSelect={(id) => router.push(`/stations/${id}`)}
      className={className}
      label="Route map — select a station to open its page"
    />
  );
}
