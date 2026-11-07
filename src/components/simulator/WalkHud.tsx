"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SimulationEngine } from "../../simulation/SimulationEngine";
import type { SimulationState } from "../../simulation/types";
import { fareForJourney } from "../../simulation/fares";
import { useViewStore } from "../../simulation/store";
import { getServerWalkHud, getWalkHud, lockWalkPointer, requestWalk, setWalkHud, subscribeWalkHud, unlockWalkPointer, walkInput, type WalkHud as WalkHudState } from "../../three/walkState";
import { formatClock } from "../../utils/format";
import { buttonClass } from "../ui/Button";
import { Close, Restart } from "../ui/Icons";
import { TicketQr } from "./TicketCard";

/** How long a notice stays up (ms). */
const NOTICE_MS = 4200;

const STEPS: WalkHudState["stage"][] = ["buy-ticket", "drop-bag", "security", "collect-bag", "enter-gate", "to-platform", "board", "riding", "alight", "exit-gate", "drop-ticket", "leave-station"];

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-block min-w-7 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-center font-mono text-[12px] text-ink">{children}</kbd>;
}

/** Ticket counter: the fare for this journey, and a button to pay it. */
function CounterDialog({ engine, fare }: { engine: SimulationEngine; fare: number | null }) {
  const { from, to } = engine.journey;
  const pay = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    pay.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // A key can't capture the mouse: the "click to look around" panel offers it.
        e.preventDefault();
        setWalkHud({ counterOpen: false });
      } else if (e.code === "KeyE" && !e.repeat) {
        // E again pays, as E opened the counter.
        e.preventDefault();
        requestWalk("buy-ticket");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-4 animate-fade-in" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="walk-counter-title" className="hud-panel flex w-[min(420px,100%)] flex-col gap-5 rounded-[18px] p-6 animate-rise-in">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-[0.16em] text-muted">TICKET COUNTER · {from.name.toUpperCase()}</span>
          <h2 id="walk-counter-title" className="text-[20px] font-semibold">
            One ticket to {to.name}
          </h2>
          {to.nameTa && (
            <span lang="ta" className="font-tamil text-[14px] text-subtle">
              {to.nameTa}
            </span>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[14px]">
          <dt className="text-muted">Ticket</dt>
          <dd>Single journey, paper QR</dd>
          <dt className="text-muted">Fare</dt>
          <dd className="tabular font-mono text-[18px] font-semibold">{fare !== null ? `₹${fare}` : "—"}</dd>
        </dl>
        <p className="text-[12px] leading-snug text-muted">Counter tickets are sold at the full fare; the digital discount applies to mobile QR tickets and travel cards.</p>
        <div className="flex gap-3">
          <button ref={pay} type="button" onClick={() => {
              requestWalk("buy-ticket");
              // Back to looking around, in the same click.
              lockWalkPointer();
            }} className={buttonClass("primary", "md")}>
            Pay {fare !== null ? `₹${fare}` : ""}
          </button>
          <button
            type="button"
            onClick={() => {
              setWalkHud({ counterOpen: false });
              lockWalkPointer();
            }}
            className={buttonClass("ghost", "md")}
          >
            Not now
          </button>
        </div>
      </section>
    </div>
  );
}

/** The ticket in the passenger's hand. */
function TicketStub({ engine, fare, startedAboard }: { engine: SimulationEngine; fare: number | null; startedAboard: boolean }) {
  const { from, to } = engine.journey;
  return (
    <div
      aria-label={`Your ticket: ${from.name} to ${to.name}`}
      className="pointer-events-none absolute right-3 top-[136px] z-20 flex w-[176px] origin-top-right scale-90 items-center gap-3 rounded-[10px] bg-[#f4f1e6] p-2.5 text-[#1b2430] shadow-xl animate-rise-in md:bottom-[108px] md:right-5 md:top-auto md:w-[210px] md:scale-100"
    >
      <div className="origin-left scale-[0.5] [margin-right:-56px] [margin-block:-28px]">
        <TicketQr seed={`${from.id}>${to.id}@walk`} />
      </div>
      <div className="flex min-w-0 flex-col text-[11px] leading-tight">
        <span className="text-[9px] font-semibold tracking-[0.14em] text-[#6b7480]">{startedAboard ? "MOBILE QR" : "SINGLE JOURNEY"}</span>
        <span className="truncate font-semibold">{from.name}</span>
        <span className="truncate font-semibold">→ {to.name}</span>
        {fare !== null && <span className="tabular font-mono">₹{fare}</span>}
      </div>
    </div>
  );
}

function Summary({ engine, snap, hud, fare, onClose }: { engine: SimulationEngine; snap: SimulationState; hud: WalkHudState; fare: number | null; onClose: () => void }) {
  const { from, to } = engine.journey;
  const setMode = useViewStore((s) => s.setCameraMode);
  const facts: [string, string][] = [
    ["Time on board", formatClock(snap.duration)],
    ["Distance", `${(snap.totalDistance / 1000).toFixed(1)} km`],
  ];
  if (fare !== null) facts.push(["Fare paid", `₹${fare}`]);
  if (!hud.startedAboard) facts.push(["Used ticket", hud.ticketDropped ? "Dropped in the box" : "Still in your pocket"]);
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-4 animate-fade-in">
      <section role="dialog" aria-labelledby="walk-summary-title" className="hud-panel pointer-events-auto relative flex w-[min(460px,100%)] flex-col gap-5 rounded-[18px] p-6">
        <button type="button" aria-label="Close summary" onClick={onClose} className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-ink">
          <Close size={16} />
        </button>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-[0.16em] text-muted">JOURNEY COMPLETE</span>
          <h2 id="walk-summary-title" className="text-[22px] font-semibold leading-tight">
            {from.name} → {to.name}
          </h2>
          {from.nameTa && to.nameTa && (
            <span lang="ta" className="font-tamil text-[14px] text-subtle">
              {from.nameTa} → {to.nameTa}
            </span>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-[14px]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="tabular text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="flex flex-col gap-1 border-t border-line pt-4 text-[14px]">
          <span>Thank you for travelling with Chennai Metro.</span>
          <span lang="ta" className="font-tamil text-subtle">
            சென்னை மெட்ரோவில் பயணித்தமைக்கு நன்றி.
          </span>
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => requestWalk("restart")} className={buttonClass("primary", "md")}>
            <Restart size={16} /> Walk it again
          </button>
          <button type="button" onClick={() => setMode("cinematic")} className={buttonClass("secondary", "md")}>
            Watch from outside
          </button>
          <Link href="/routes" className={buttonClass("ghost", "md")}>
            Choose another journey
          </Link>
        </div>
      </section>
    </div>
  );
}

/** Stick travel (px) from the centre to the rim; at the rim the passenger runs. */
const STICK_R = 48;

/**
 * Thumb stick for touch screens, as in mobile games: touch anywhere in the
 * lower left and the stick appears under the thumb; push to walk, to the rim
 * to run. At rest a faint stick shows where it lives. Tracks its own finger
 * by pointer id on the window, so it keeps working if pointer capture is
 * refused, and a second finger elsewhere still looks around (WalkMode).
 */
function WalkStick() {
  const zone = useRef<HTMLDivElement>(null);
  const finger = useRef<number | null>(null);
  const centre = useRef({ x: 0, y: 0 });
  /** Where the stick sits in the zone (px) and the knob's offset (-1..1), while held. */
  const [held, setHeld] = useState<{ cx: number; cy: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const release = () => {
      finger.current = null;
      walkInput.stickStrafe = 0;
      walkInput.stickForward = 0;
      walkInput.run = false;
      setHeld(null);
    };
    const follow = (clientX: number, clientY: number) => {
      const r = zone.current?.getBoundingClientRect();
      if (!r) return;
      let x = (clientX - centre.current.x) / STICK_R;
      let y = (clientY - centre.current.y) / STICK_R;
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      walkInput.stickStrafe = x;
      walkInput.stickForward = -y;
      walkInput.run = len > 0.95;
      setHeld({ cx: centre.current.x - r.left, cy: centre.current.y - r.top, x, y });
    };
    const down = (e: PointerEvent) => {
      if (finger.current !== null || e.pointerType === "mouse") return;
      const el = zone.current!;
      finger.current = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Not needed: the finger is followed by id below.
      }
      // Centre the stick under the thumb, kept clear of the zone's edges.
      const r = el.getBoundingClientRect();
      centre.current = {
        x: Math.min(Math.max(e.clientX, r.left + STICK_R + 12), r.right - STICK_R - 12),
        y: Math.min(Math.max(e.clientY, r.top + STICK_R + 12), r.bottom - STICK_R - 12),
      };
      follow(e.clientX, e.clientY);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId === finger.current) follow(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === finger.current) release();
    };
    const el = zone.current!;
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", release);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", release);
      release();
    };
  }, []);

  return (
    <div
      ref={zone}
      role="application"
      aria-label="Walk: touch and drag to move"
      onContextMenu={(e) => e.preventDefault()}
      className="pointer-events-auto absolute bottom-0 left-0 z-20 hidden h-[46%] w-[55%] touch-none select-none pointer-coarse:block md:bottom-[96px] md:h-[40%] md:w-[40%]"
    >
      {held ? (
        <div
          className="absolute rounded-full border border-white/25 bg-black/25"
          style={{ left: held.cx - STICK_R, top: held.cy - STICK_R, width: STICK_R * 2, height: STICK_R * 2 }}
        >
          <span
            className="absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-ink/90 shadow-lg"
            style={{ transform: `translate(calc(-50% + ${held.x * STICK_R}px), calc(-50% + ${held.y * STICK_R}px))` }}
          />
        </div>
      ) : (
        // At rest: where the thumb goes.
        <div
          className="absolute bottom-[max(28px,calc(env(safe-area-inset-bottom)+16px))] left-6 rounded-full border border-white/20 bg-black/15"
          style={{ width: STICK_R * 2, height: STICK_R * 2 }}
        >
          <span className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/45" />
        </div>
      )}
    </div>
  );
}

/**
 * Everything on screen in Walk mode: what to do next and how far it is, the
 * "use" prompt, short notices, the ticket in hand, the ticket-counter dialog,
 * the end-of-trip summary, and a thumb stick on touch screens.
 */
export function WalkHud({ engine, snap }: { engine: SimulationEngine; snap: SimulationState }) {
  const walking = useViewStore((s) => s.cameraMode === "walk");
  const panelOpen = useViewStore((s) => s.settingsOpen || s.shortcutsOpen);
  const hud = useSyncExternalStore(subscribeWalkHud, getWalkHud, getServerWalkHud);
  const fare = useMemo(
    () => fareForJourney(engine.route.stations, engine.route.route.fares.bands?.slabs ?? [], engine.journey.from.id, engine.journey.to.id),
    [engine],
  );
  // Notices fade on their own; a repeat of the same text shows again.
  const [seenNotice, setSeenNotice] = useState(0);
  useEffect(() => {
    if (!hud.notice) return;
    const t = window.setTimeout(() => setSeenNotice(hud.noticeId), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [hud.notice, hud.noticeId]);
  // The summary can be put away to look around; the next trip brings its own.
  const [summaryClosedFor, setSummaryClosedFor] = useState(-1);
  const done = hud.stage === "done";
  useEffect(() => {
    // Free the mouse so the summary's buttons can be clicked.
    if (done) unlockWalkPointer();
  }, [done]);

  if (!walking || !hud.active) return null;
  const step = STEPS.indexOf(hud.stage);
  const showNotice = hud.notice && hud.noticeId !== seenNotice;
  const showSummary = done && summaryClosedFor !== hud.trip;

  return (
    <>
      {!done && (
        <div
          aria-live="polite"
          className="hud-panel pointer-events-none absolute inset-x-3 top-[72px] z-20 mx-auto flex w-fit max-w-[calc(100%-24px)] items-center gap-3 rounded-[14px] px-4 py-2.5 md:top-[124px] lg:top-[84px]"
        >
          {!hud.startedAboard && step >= 0 && (
            <span className="tabular shrink-0 rounded-full bg-route px-2 py-0.5 font-mono text-[11px] font-semibold text-black">
              {step + 1}/{STEPS.length}
            </span>
          )}
          <span className="text-[14px] font-medium leading-snug">{hud.objective}</span>
          {hud.distance !== null && <span className="tabular shrink-0 font-mono text-[12px] text-muted">{hud.distance} m</span>}
        </div>
      )}

      {hud.pointerLocked && <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 shadow" />}

      {hud.prompt && !hud.counterOpen && (
        <button
          type="button"
          onClick={() => {
            walkInput.interact = true;
          }}
          // Phones: a large button under the right thumb (the left one is on the stick). Larger screens: centred, with its key.
          className="hud-panel pointer-events-auto absolute bottom-[max(28px,calc(env(safe-area-inset-bottom)+16px))] right-4 z-30 flex min-h-14 w-fit max-w-[45%] items-center gap-2.5 rounded-full px-5 py-3 text-[15px] font-semibold leading-tight animate-rise-in active:scale-[0.97] md:inset-x-3 md:bottom-[124px] md:right-3 md:mx-auto md:min-h-0 md:max-w-none md:py-2.5 md:text-[14px] md:font-medium"
        >
          <span className="hidden pointer-fine:inline-flex">
            <Key>E</Key>
          </span>
          {hud.prompt.label}
        </button>
      )}

      {showNotice && (
        <div role="status" className="hud-panel pointer-events-none absolute inset-x-3 bottom-[max(132px,calc(env(safe-area-inset-bottom)+120px))] z-20 mx-auto w-fit max-w-[calc(100%-24px)] rounded-[18px] px-5 py-2 text-center text-[13px] text-ink animate-fade-in md:bottom-[176px]">
          {hud.notice}
        </div>
      )}

      {!hud.pointerLocked && !done && !hud.counterOpen && !panelOpen && (
        // Mouse devices: the view is "paused" until the mouse is captured again.
        <button
          type="button"
          onClick={lockWalkPointer}
          className="pointer-events-auto absolute inset-0 z-[15] hidden items-center justify-center bg-black/20 pointer-fine:flex"
        >
          <span className="hud-panel flex max-w-[340px] flex-col items-center gap-2.5 rounded-[16px] px-5 py-4 text-center text-[13px] text-muted">
            <span className="text-[15px] font-semibold text-ink">Click to look around</span>
            <span className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
              <span className="inline-flex items-center gap-1">
                <Key>W</Key>
                <Key>A</Key>
                <Key>S</Key>
                <Key>D</Key> move
              </span>
              <span className="inline-flex items-center gap-1">
                <Key>Shift</Key> run
              </span>
              <span className="inline-flex items-center gap-1">
                <Key>E</Key> use
              </span>
              <span className="inline-flex items-center gap-1">
                <Key>Esc</Key> frees the mouse
              </span>
            </span>
          </span>
        </button>
      )}

      {hud.hasTicket && !done && <TicketStub engine={engine} fare={fare} startedAboard={hud.startedAboard} />}
      <WalkStick />
      {hud.counterOpen && <CounterDialog engine={engine} fare={fare} />}
      {showSummary && <Summary engine={engine} snap={snap} hud={hud} fare={fare} onClose={() => setSummaryClosedFor(hud.trip)} />}
    </>
  );
}
