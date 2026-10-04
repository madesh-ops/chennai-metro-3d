"use client";

import type { ReactNode } from "react";
import { LogoMark } from "../ui/Logo";

export interface LoadProgress {
  route: number;
  environment: number;
  train: number;
  render: number;
}

export interface LoadRow {
  label: string;
  /** 0..1, or null while the stage is running but can't report a fraction. */
  value: number | null;
  /** Shown instead of a percentage for indeterminate or waiting rows. */
  note?: string;
}

function Bar({ label, value, note }: LoadRow) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
  const waiting = note === "Waiting";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[13px]">
        <span className={pct !== null && pct >= 100 ? "text-subtle" : waiting ? "text-faint" : "text-ink"}>{label}</span>
        <span className="tabular font-mono text-[12px] text-muted">{pct === null ? note ?? "…" : `${pct}%`}</span>
      </div>
      <div
        className="relative h-[3px] overflow-hidden rounded-full bg-line-strong"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        aria-valuetext={pct === null ? note ?? "In progress" : undefined}
      >
        {pct === null ? (
          !waiting && <div className="loading-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-ink" />
        ) : (
          <div className="h-full rounded-full bg-ink transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  );
}

export function progressRows(p: LoadProgress): LoadRow[] {
  return [
    { label: "Loading route", value: p.route },
    { label: "Loading environment", value: p.environment },
    { label: "Preparing train", value: (p.train + p.render) / 2 },
  ];
}

/** Real progress from each loading stage — never a made-up number. */
export function LoadingScreen({
  progress,
  rows,
  visible,
  title,
  children,
}: {
  progress?: LoadProgress;
  rows?: LoadRow[];
  visible: boolean;
  title: string;
  /** Extra content under the bars (help, actions). */
  children?: ReactNode;
}) {
  const list = rows ?? (progress ? progressRows(progress) : []);
  return (
    <div
      className={`absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-bg px-6 py-10 transition-opacity duration-700 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-hidden={!visible}
    >
      <div className="flex w-full max-w-[380px] flex-col gap-10">
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <LogoMark />
            <span className="text-[13px] font-semibold tracking-[0.16em]">CHENNAI METRO 3D</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-[20px] font-medium" role="status">
              Preparing your journey…
            </p>
            <p className="text-[13px] text-muted">{title}</p>
          </div>
        </div>
        <div className="flex flex-col gap-5">
          {list.map((r) => (
            <Bar key={r.label} {...r} />
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}
