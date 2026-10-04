/**
 * One shared WebAudio context for every sound in the app (announcements,
 * chimes, street sounds). Browsers start it suspended until the user
 * interacts with the page, and the journey can begin on its own, so the
 * first click, tap or key press resumes it. Everything here is optional:
 * without WebAudio, callers get null and simply stay silent.
 */

let ctx: AudioContext | null = null;
let failed = false;

function unlockOnGesture(c: AudioContext) {
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const resume = () => {
    if (c.state === "suspended") void c.resume().catch(() => undefined);
    if (c.state === "running") events.forEach((e) => window.removeEventListener(e, resume, true));
  };
  events.forEach((e) => window.addEventListener(e, resume, true));
}

export function getAudioContext(): AudioContext | null {
  if (ctx || failed || typeof window === "undefined") return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      failed = true;
      return null;
    }
    ctx = new Ctor();
    unlockOnGesture(ctx);
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  } catch {
    failed = true;
    ctx = null;
  }
  return ctx;
}

/** A few seconds of noise to loop. Brown noise is a deep road rumble; white noise is tyre hiss. */
export function createNoiseBuffer(c: BaseAudioContext, colour: "brown" | "white", seconds = 4): AudioBuffer {
  const length = Math.floor(c.sampleRate * seconds);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (colour === "white") data[i] = white;
    else {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buffer;
}

/** Ducking: background sound drops while an announcement is being spoken. */
let ducked = false;
export const setDucked = (on: boolean) => {
  ducked = on;
};
export const duckLevel = () => (ducked ? 0.4 : 1);
