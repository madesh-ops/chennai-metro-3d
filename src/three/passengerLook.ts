/**
 * Passenger camera look-around: where you stand in the middle car and where
 * you are looking. The camera rig reads this every frame; the on-screen pad
 * and canvas drag/wheel/pinch input write to it. Free of three.js so DOM
 * components (and tests) can import it without the 3D bundle.
 */

export type PassengerSpot = "window" | "doors" | "end";

export const PASSENGER_SPOTS: { id: PassengerSpot; label: string; hint: string }[] = [
  { id: "window", label: "Window seat", hint: "Seated, looking out across the car" },
  { id: "doors", label: "By the doors", hint: "Standing at a platform-side door" },
  { id: "end", label: "Car end", hint: "Looking down the length of the car" },
];

export const LOOK_LIMITS = {
  /** Radians either side of the spot's resting direction. */
  maxYaw: (160 * Math.PI) / 180,
  maxPitch: (55 * Math.PI) / 180,
  minFov: 45,
  maxFov: 75,
  defaultFov: 68,
  /** Seconds without input before the view eases back to rest. */
  recentreAfter: 6,
};

export const clampYaw = (yaw: number) => Math.max(-LOOK_LIMITS.maxYaw, Math.min(LOOK_LIMITS.maxYaw, yaw));
export const clampPitch = (pitch: number) => Math.max(-LOOK_LIMITS.maxPitch, Math.min(LOOK_LIMITS.maxPitch, pitch));
export const clampFov = (fov: number) => Math.max(LOOK_LIMITS.minFov, Math.min(LOOK_LIMITS.maxFov, fov));

export const passengerLook = {
  /** + turns left (seen from above), relative to the spot's resting direction. */
  yaw: 0,
  /** + looks up. */
  pitch: 0,
  fov: LOOK_LIMITS.defaultFov,
  spot: "window" as PassengerSpot,
  /** performance.now() of the last drag/zoom; 0 = never. */
  lastInput: 0,
  /** Set to ease back to the resting direction now. */
  recentre: false,
};

/** Apply a drag (pixels) at the given field of view: grab-and-pull, like a street-view panorama. */
export function dragLook(dx: number, dy: number, viewportHeight: number) {
  // One viewport height of drag sweeps roughly the vertical field of view.
  const k = ((passengerLook.fov * Math.PI) / 180 / Math.max(200, viewportHeight)) * 1.1;
  passengerLook.yaw = clampYaw(passengerLook.yaw + dx * k);
  passengerLook.pitch = clampPitch(passengerLook.pitch + dy * k);
  passengerLook.lastInput = performance.now();
}

export function zoomLook(deltaFov: number) {
  passengerLook.fov = clampFov(passengerLook.fov + deltaFov);
  passengerLook.lastInput = performance.now();
}

/** Ease yaw/pitch towards rest once input has been idle long enough (or a recentre was asked for). */
export function settleLook(dt: number, now: number, instant: boolean) {
  const idle = passengerLook.lastInput === 0 || (now - passengerLook.lastInput) / 1000 > LOOK_LIMITS.recentreAfter;
  if (!idle && !passengerLook.recentre) return;
  if (instant) {
    passengerLook.yaw = 0;
    passengerLook.pitch = 0;
  } else {
    const k = Math.min(1, dt * 2.2);
    passengerLook.yaw += (0 - passengerLook.yaw) * k;
    passengerLook.pitch += (0 - passengerLook.pitch) * k;
  }
  if (Math.abs(passengerLook.yaw) < 1e-3 && Math.abs(passengerLook.pitch) < 1e-3) {
    passengerLook.yaw = 0;
    passengerLook.pitch = 0;
    passengerLook.recentre = false;
  }
}

/* Tiny change notifier so the pad can highlight the current spot. */
const listeners = new Set<() => void>();
export const subscribePassengerLook = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const getPassengerSpot = () => passengerLook.spot;

export function setPassengerSpot(spot: PassengerSpot) {
  if (passengerLook.spot === spot) return;
  passengerLook.spot = spot;
  passengerLook.yaw = 0;
  passengerLook.pitch = 0;
  passengerLook.recentre = false;
  listeners.forEach((l) => l());
}

export function requestRecentre() {
  passengerLook.recentre = true;
  passengerLook.fov = LOOK_LIMITS.defaultFov;
}
