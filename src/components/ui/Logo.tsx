import Link from "next/link";

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center rounded-[7px] border-[1.5px] border-ink font-semibold text-ink"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      C
    </span>
  );
}

export function Logo({ compact = false, href = "/" }: { compact?: boolean; href?: string }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-3 text-ink" aria-label="Chennai Metro 3D — home">
      <LogoMark />
      <span className="text-[13px] font-semibold tracking-[0.16em]">{compact ? "METRO 3D" : "CHENNAI METRO 3D"}</span>
    </Link>
  );
}
