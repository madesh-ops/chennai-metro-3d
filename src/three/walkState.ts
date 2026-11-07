import type { TripStage } from "../simulation/PassengerTrip.ts";

/**
 * Shared state of Walk mode: input written by the keyboard, pointer and
 * on-screen pad; the eye the camera rig reads every frame; and a snapshot
 * for the HUD that changes only when something discrete does. Free of
 * three.js so DOM components (and tests) can import it without the 3D bundle.
 */

/** Held movement and pending look, consumed by the walk controller each frame. */
export const walkInput = {
  /** -1..1 from the keyboard: + forward, + right. */
  forward: 0,
  strafe: 0,
  /** -1..1 from the on-screen stick (added to the keyboard). */
  stickForward: 0,
  stickStrafe: 0,
  run: false,
  /** Turn right / look up, in radians, accumulated since the last frame. */
  turn: 0,
  tilt: 0,
  /** Set to act on whatever the prompt offers (E, Enter or the Use button). */
  interact: false,
};

export function releaseWalkInput() {
  walkInput.forward = 0;
  walkInput.strafe = 0;
  walkInput.stickForward = 0;
  walkInput.stickStrafe = 0;
  walkInput.run = false;
  walkInput.turn = 0;
  walkInput.tilt = 0;
  walkInput.interact = false;
}

/** The passenger's eye in the world, and where it looks (unit vector). */
export const walkView = {
  ready: false,
  x: 0,
  y: 0,
  z: 0,
  dx: 1,
  dy: 0,
  dz: 0,
};

export type WalkAction = "counter" | "bag-drop" | "security" | "bag-collect" | "scan-in" | "scan-out" | "drop-ticket";

export interface WalkHud {
  /** A trip is in progress in Walk mode. */
  active: boolean;
  /** Counts trips, so the HUD can tell a fresh one from the last. */
  trip: number;
  stage: TripStage;
  objective: string;
  hasTicket: boolean;
  ticketDropped: boolean;
  aboard: boolean;
  /** The trip began on board (the origin's inside is not modelled, or the ride had already started). */
  startedAboard: boolean;
  /** What "use" would do here, if anything. */
  prompt: { action: WalkAction; label: string } | null;
  /** A short message (bumped `noticeId` re-shows the same text). */
  notice: string | null;
  noticeId: number;
  /** The ticket-counter dialog is open. */
  counterOpen: boolean;
  /** Whole metres to the objective marker, or null when there is none. */
  distance: number | null;
  pointerLocked: boolean;
}

const INITIAL: WalkHud = {
  active: false,
  trip: 0,
  stage: "buy-ticket",
  objective: "",
  hasTicket: false,
  ticketDropped: false,
  aboard: false,
  startedAboard: false,
  prompt: null,
  notice: null,
  noticeId: 0,
  counterOpen: false,
  distance: null,
  pointerLocked: false,
};

let hud: WalkHud = INITIAL;
const listeners = new Set<() => void>();

export const getWalkHud = () => hud;
export const getServerWalkHud = () => INITIAL;

export function subscribeWalkHud(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const samePrompt = (a: WalkHud["prompt"], b: WalkHud["prompt"]) => a === b || (a !== null && b !== null && a.action === b.action && a.label === b.label);

/** Merge a change into the HUD snapshot; listeners hear about it only if something differs. */
export function setWalkHud(patch: Partial<WalkHud>) {
  let changed = false;
  for (const k of Object.keys(patch) as (keyof WalkHud)[]) {
    if (k === "prompt" ? samePrompt(hud.prompt, patch.prompt ?? null) : hud[k] === patch[k]) continue;
    changed = true;
  }
  if (!changed) return;
  hud = { ...hud, ...patch };
  listeners.forEach((l) => l());
}

export function showWalkNotice(text: string) {
  setWalkHud({ notice: text, noticeId: hud.noticeId + 1 });
}

export function resetWalkHud() {
  hud = INITIAL;
  listeners.forEach((l) => l());
}

/**
 * Where people wait on each station's platforms (world x, z), by station id.
 * Stations.tsx fills it as it places the crowd; the walker steps round them.
 */
export const platformCrowd = new Map<string, readonly { x: number; z: number }[]>();

/** Things the HUD asks the walk controller to do (picked up on the next frame). */
export type WalkRequest = "buy-ticket" | "restart";
const requests: WalkRequest[] = [];
export const requestWalk = (r: WalkRequest) => {
  requests.push(r);
};
export const takeWalkRequests = (): WalkRequest[] => requests.splice(0, requests.length);

/**
 * Mouse capture for looking around. WalkMode registers the canvas; anything
 * handling a click (the view, Depart, the counter's buttons) may capture the
 * mouse from inside that click, as browsers require.
 */
export const walkPointer = { el: null as HTMLElement | null };

export function lockWalkPointer() {
  const el = walkPointer.el;
  if (!el || typeof document === "undefined" || document.pointerLockElement === el) return;
  // Touch screens look by dragging; a captured pointer would turn finger moves into mouse-look.
  if (typeof matchMedia === "function" && !matchMedia("(pointer: fine)").matches) return;
  const request = (opts?: object) => (el.requestPointerLock as (o?: object) => Promise<void> | undefined)(opts);
  try {
    // Raw mouse input where the browser offers it; a plain capture otherwise.
    const p = request({ unadjustedMovement: true });
    p?.catch?.(() => {
      try {
        request()?.catch?.(() => undefined);
      } catch {
        // Refused (for a moment after Esc, in Chrome): the overlay offers it again.
      }
    });
  } catch {
    try {
      request()?.catch?.(() => undefined);
    } catch {
      // Pointer lock is optional.
    }
  }
}

export function unlockWalkPointer() {
  if (typeof document !== "undefined" && document.pointerLockElement) document.exitPointerLock();
}

/** On board in Walk mode (the cabin and train sounds follow the passenger there). */
export const walkingAboard = () => hud.active && hud.aboard;
