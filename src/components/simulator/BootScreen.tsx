"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { LoadingScreen, type LoadRow } from "./LoadingScreen";
import { buttonClass } from "../ui/Button";

/** After this long without the simulator code, explain and offer a retry. */
export const SLOW_LOAD_MS = 12000;

const BOOT_ROWS: LoadRow[] = [
  { label: "Downloading the 3D engine", value: null, note: "In progress" },
  { label: "Loading environment", value: null, note: "Waiting" },
  { label: "Preparing train", value: null, note: "Waiting" },
];

const noopSubscribe = () => () => {};
/** false during SSR and hydration, true once running in the browser. */
const useHydrated = () => useSyncExternalStore(noopSubscribe, () => true, () => false);
const useHref = () => useSyncExternalStore(noopSubscribe, () => window.location.href, () => null);

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1" || hostname.endsWith(".localhost");
}

/**
 * Next.js dev server only serves its development files to localhost and the
 * origins allowed in next.config.ts. Anywhere else the code never arrives
 * and the page would wait forever — so say exactly what to do.
 */
function DevOriginHint() {
  const href = useHref();
  if (process.env.NODE_ENV !== "development" || !href) return null;
  const url = new URL(href);
  const loc = { host: url.host, hostname: url.hostname, port: url.port || "3000", path: url.pathname + url.search };
  if (isLocalHost(loc.hostname)) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-4 py-3.5 text-[13px] leading-relaxed text-subtle">
      <p>
        You&apos;re viewing the development server at <span className="font-mono text-ink">{loc.host}</span>. Next.js only sends its
        development files to localhost and allowed hosts, so the simulator can&apos;t load from here.
      </p>
      <p>
        Open{" "}
        <a className="font-mono text-accent-soft underline-offset-2 hover:underline" href={`http://localhost:${loc.port}${loc.path}`}>
          localhost:{loc.port}
        </a>{" "}
        instead, or restart the dev server with:
      </p>
      <code className="block overflow-x-auto whitespace-nowrap rounded-lg bg-surface-2 px-3 py-2 font-mono text-[12px] text-ink">
        ALLOWED_DEV_ORIGINS={loc.hostname} npm run dev
      </code>
    </div>
  );
}

function Actions() {
  return (
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={() => window.location.reload()} className={buttonClass("primary", "sm")}>
        Retry
      </button>
      <Link href="/stations" className={buttonClass("secondary", "sm")}>
        Browse stations
      </Link>
    </div>
  );
}

/** Shown while the simulator's JavaScript downloads (and server-rendered before it). */
export function BootScreen() {
  const mounted = useHydrated();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="fixed inset-0 bg-bg" data-boot={slow ? "slow" : "loading"}>
      <LoadingScreen visible rows={BOOT_ROWS} title="Loading simulator">
        {slow && (
          <div className="flex flex-col gap-4 animate-fade-in" role="alert">
            <div className="flex flex-col gap-1.5">
              <p className="text-[15px] font-medium text-ink">This is taking longer than usual</p>
              <p className="text-[13px] leading-relaxed text-muted">
                The 3D engine is about a megabyte. On a slow connection it can take a minute, but the download may also have been
                blocked.
              </p>
            </div>
            <DevOriginHint />
            <Actions />
          </div>
        )}
        {/* If JavaScript never runs at all, these explain why nothing moves. */}
        {!mounted && (
          <p className="boot-nojs-hint text-[13px] leading-relaxed text-muted">
            Still here? The simulator needs JavaScript and an up-to-date browser (Chrome or Edge 111+, Firefox 111+, Safari 16.4+).{" "}
            <a href="" className="text-accent-soft underline">
              Reload
            </a>
          </p>
        )}
        <noscript>
          <p className="text-[13px] leading-relaxed text-subtle">
            JavaScript is turned off, so the 3D simulator can&apos;t run. Station details still work:{" "}
            <Link href="/stations" className="text-accent-soft underline">
              browse stations
            </Link>
            .
          </p>
        </noscript>
      </LoadingScreen>
    </div>
  );
}

/** Shown when the simulator code fails to download or evaluate. */
export function LoadFailure({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="fixed inset-0 bg-bg" data-boot="failed">
      <LoadingScreen
        visible
        rows={[{ label: "Downloading the 3D engine", value: 0, note: "Failed" }]}
        title="Loading simulator"
      >
        <div className="flex flex-col gap-4" role="alert">
          <div className="flex flex-col gap-1.5">
            <p className="text-[15px] font-medium text-ink">The simulator couldn&apos;t load</p>
            <p className="text-[13px] leading-relaxed text-muted">
              Its code didn&apos;t download. Check your connection and try again.
            </p>
            <p className="break-words font-mono text-[11px] text-faint">{message}</p>
          </div>
          <DevOriginHint />
          <Actions />
        </div>
      </LoadingScreen>
    </div>
  );
}
