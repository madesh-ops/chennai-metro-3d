/**
 * Live input for the free camera from the on-screen pad. Buttons set a rate
 * (-1, 0 or 1) while held; the camera rig reads these every frame, so moves
 * are smooth and frame-rate independent. Deliberately free of three.js so
 * DOM components can import it without pulling in the 3D bundle.
 */
export const freeCameraInput = {
  /** +1 orbits clockwise seen from above. */
  orbit: 0,
  /** +1 raises the view towards top-down. */
  tilt: 0,
  /** +1 zooms in. */
  zoom: 0,
  /** +1 pans right / forward (relative to the view). */
  panX: 0,
  panY: 0,
  /** Set to request a glide back to the default view of the train. */
  recentre: false,
  /** Set to jump the free camera to a fixed view (unpins it from the train). */
  lookAt: null as null | { target: [number, number, number]; from: [number, number, number] },
};

export type FreeCameraAxis = "orbit" | "tilt" | "zoom" | "panX" | "panY";
