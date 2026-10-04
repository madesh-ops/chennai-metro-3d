"use client";

import { useRef, type ReactNode } from "react";

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Accessible name when the label is an icon. */
  ariaLabel?: string;
}

/**
 * Radio-group segmented control with roving focus (arrow keys move and
 * select, as per the WAI-ARIA radio pattern).
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  size = "md",
  className = "",
  tone = "light",
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
  /** light = white pill for the active item; accent = blue. */
  tone?: "light" | "accent";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = options.findIndex((o) => o.value === value);
  const move = (dir: number) => {
    const next = (idx + dir + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  const h = size === "sm" ? "h-[30px] px-2.5 text-[12px]" : "h-8 px-3.5 text-[13px]";
  return (
    <div role="radiogroup" aria-label={label} className={`flex gap-0.5 rounded-[10px] p-1 ${className}`}>
      {options.map((o, i) => {
        const selected = o.value === value;
        const activeCls = tone === "accent" ? "bg-accent text-white font-semibold" : "bg-ink text-bg font-semibold";
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.ariaLabel}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(-1);
              }
            }}
            className={`${h} inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] transition-colors duration-150 ${
              selected ? activeCls : "font-medium text-subtle hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
