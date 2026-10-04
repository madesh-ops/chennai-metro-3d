"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, LineSegments, ShaderMaterial } from "three";
import { useScene } from "./SceneContext.tsx";
import { mulberry32 } from "../utils/random.ts";
import { useViewStore } from "../simulation/store.ts";

const BOX = 80;
const HEIGHT = 46;

/**
 * Rain as GPU-animated streaks in a volume that follows the camera.
 * Drops stay fixed in world space horizontally (no popping as the camera
 * moves) and are cleared from inside the car in driver/passenger views.
 */
export function Rain({ count, enabled }: { count: number; enabled: boolean }) {
  const { env } = useScene();
  const { camera } = useThree();

  const lines = useMemo(() => {
    const rng = mulberry32(31);
    const offsets = new Float32Array(count * 2 * 3);
    const ends = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = rng() * BOX;
      const y = rng() * HEIGHT;
      const z = rng() * BOX;
      for (let k = 0; k < 2; k++) {
        offsets.set([x, y, z], (i * 2 + k) * 3);
        ends[i * 2 + k] = k;
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(offsets, 3));
    geo.setAttribute("aEnd", new BufferAttribute(ends, 1));
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: env.uniforms.uTime,
        uCam: { value: camera.position.clone() },
        uOpacity: { value: 0 },
        uClear: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aEnd;
        uniform float uTime;
        uniform vec3 uCam;
        varying float vDist;
        varying float vEnd;
        void main() {
          vec3 p = position;
          float fall = mod(p.y - uTime * 17.0, ${HEIGHT.toFixed(1)});
          vec3 w;
          w.xz = uCam.xz + mod(p.xz - uCam.xz + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
          w.y = uCam.y - ${(HEIGHT * 0.45).toFixed(1)} + fall;
          w.y -= aEnd * 0.62;
          w.x += aEnd * 0.09;
          vDist = length(w.xz - uCam.xz);
          vEnd = aEnd;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform float uClear;
        varying float vDist;
        varying float vEnd;
        void main() {
          if (vDist < uClear) discard;
          gl_FragColor = vec4(0.78, 0.83, 0.9, uOpacity * mix(0.25, 1.0, vEnd));
        }`,
    });
    const seg = new LineSegments(geo, mat);
    seg.frustumCulled = false;
    return seg;
  }, [count, env, camera]);

  useEffect(
    () => () => {
      lines.geometry.dispose();
      (lines.material as ShaderMaterial).dispose();
    },
    [lines],
  );

  useFrame(() => {
    const u = (lines.material as ShaderMaterial).uniforms;
    u.uCam.value.copy(camera.position);
    u.uOpacity.value = env.rain * 0.5;
    const mode = useViewStore.getState().cameraMode;
    u.uClear.value = mode === "passenger" ? 2.2 : mode === "driver" ? 1.7 : 0;
    lines.visible = enabled && env.rain > 0.01 && mode !== "map";
  });

  return <primitive object={lines} />;
}
