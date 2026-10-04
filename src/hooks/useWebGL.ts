"use client";

import { useSyncExternalStore } from "react";

export type WebGLStatus = "checking" | "supported" | "unsupported";

let cached: WebGLStatus | null = null;

export function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    return Boolean(gl);
  } catch {
    return false;
  }
}

function clientStatus(): WebGLStatus {
  if (cached) return cached;
  // Allows forcing the fallback for testing: ?webgl=0
  const forcedOff = new URLSearchParams(window.location.search).get("webgl") === "0";
  cached = !forcedOff && detectWebGL() ? "supported" : "unsupported";
  return cached;
}

const noop = () => () => {};

/** "checking" during SSR/hydration, then the (cached) client result. */
export function useWebGL(): WebGLStatus {
  return useSyncExternalStore(noop, clientStatus, () => "checking");
}
