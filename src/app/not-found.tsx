import Link from "next/link";
import { SiteHeader } from "../components/navigation/SiteHeader";
import { buttonClass } from "../components/ui/Button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex flex-1 flex-col items-start justify-center gap-5 px-4 sm:px-8 lg:px-12">
        <p className="font-mono text-[12px] tracking-[0.08em] text-muted">404</p>
        <h1 className="text-[32px] font-semibold">This stop isn&apos;t on the line.</h1>
        <p className="max-w-md text-[15px] text-muted">The page you were looking for doesn&apos;t exist. Try a station or start a journey instead.</p>
        <div className="flex gap-3">
          <Link href="/routes" className={buttonClass("primary", "md")}>Choose a journey</Link>
          <Link href="/stations" className={buttonClass("secondary", "md")}>Stations</Link>
        </div>
      </main>
    </div>
  );
}
