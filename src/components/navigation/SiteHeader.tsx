"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "../ui/Logo";
import { ArrowRight, Close, Menu } from "../ui/Icons";

const NAV = [
  { href: "/explore", label: "Explore" },
  { href: "/routes", label: "Routes" },
  { href: "/stations", label: "Stations" },
  { href: "/about", label: "About" },
];

export function SiteHeader({ overlay = false }: { overlay?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Close the mobile menu on navigation (state adjusted during render).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  return (
    <header
      className={`${overlay ? "absolute inset-x-0 top-0 z-30" : "relative z-30 border-b border-line"} px-4 sm:px-8 lg:px-12`}
    >
      <div className="flex h-[76px] items-center justify-between gap-6">
        <Logo />
        <nav aria-label="Primary" className="hidden items-center gap-8 text-sm md:flex">
          {NAV.map((n) => {
            const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`transition-colors ${active ? "text-ink" : "text-subtle hover:text-ink"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/simulator"
            className="hidden h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-[#2b85ff] sm:inline-flex"
          >
            Start Simulation <ArrowRight size={16} />
          </Link>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink hover:bg-white/5 md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <Close /> : <Menu />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Primary" className="hud-panel mb-4 flex flex-col rounded-xl p-2 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-lg px-4 py-3 text-[15px] text-subtle hover:bg-white/5 hover:text-ink">
              {n.label}
            </Link>
          ))}
          <Link href="/simulator" className="mt-1 rounded-lg bg-accent px-4 py-3 text-[15px] font-semibold text-white">
            Start Simulation
          </Link>
        </nav>
      )}
    </header>
  );
}
