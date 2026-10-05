"use client";

import { useFrame } from "@react-three/fiber";

/**
 * Takes over rendering (priority 1) and draws nothing until the shaders are
 * compiled: otherwise every frame while the scene mounts would compile its new
 * materials synchronously and freeze the page (the loading screen covers the
 * canvas meanwhile).
 */
export function RenderGate({ open }: { open: { current: boolean } }) {
  useFrame(({ gl, scene, camera }) => {
    if (open.current) gl.render(scene, camera);
  }, 1);
  return null;
}
