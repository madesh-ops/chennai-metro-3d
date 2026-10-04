import Link from "next/link";
import { LogoMark } from "../ui/Logo";

export function SiteFooter({ lastVerified }: { lastVerified: string }) {
  return (
    <footer className="border-t border-line px-4 py-10 sm:px-8 lg:px-12">
      <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-md flex-col gap-3">
          <div className="flex items-center gap-3">
            <LogoMark size={24} />
            <span className="text-[12px] font-semibold tracking-[0.16em]">CHENNAI METRO 3D</span>
          </div>
          <p className="text-sm leading-relaxed text-muted">
            An independent visualisation. Not affiliated with or endorsed by Chennai Metro Rail Limited. Station data last
            verified {new Date(lastVerified).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
          <Link className="text-subtle hover:text-ink" href="/simulator">Simulator</Link>
          <Link className="text-subtle hover:text-ink" href="/stations">Stations</Link>
          <Link className="text-subtle hover:text-ink" href="/routes">Routes</Link>
          <Link className="text-subtle hover:text-ink" href="/explore">Explore</Link>
          <Link className="text-subtle hover:text-ink" href="/about">Data &amp; sources</Link>
        </nav>
      </div>
    </footer>
  );
}
