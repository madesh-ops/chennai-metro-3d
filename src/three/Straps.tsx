"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useScene } from "./SceneContext.tsx";
import { cabinLayout, type CarKind } from "./trainModel.ts";

/**
 * Hanging grab straps along the overhead rails. Each car's straps swing as a
 * damped pendulum driven by the train's real motion: they lean forward when
 * it brakes, back when it pulls away, and outwards on curves.
 */

const G = 9.81;
const MAX_SWING = (25 * Math.PI) / 180;
/** Pendulum stiffness (1/s²) and damping (1/s): about a 0.9 s period, settling in a few swings. */
const STIFFNESS = 45;
const DAMPING = 3.2;

function paint(g: BufferGeometry, hex: string) {
  const n = g.index ? g.toNonIndexed() : g;
  if (n.getAttribute("uv")) n.deleteAttribute("uv");
  const c = new Color(hex);
  const arr = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < n.attributes.position.count; i++) c.toArray(arr, i * 3);
  n.setAttribute("color", new BufferAttribute(arr, 3));
  return n;
}

/** Strap template hanging from its pivot at the origin. */
function strapGeometry(): BufferGeometry {
  const band = paint(new BoxGeometry(0.032, 0.24, 0.012).translate(0, -0.12, 0), "#3a3f45");
  const ring = paint(new TorusGeometry(0.065, 0.011, 6, 16).translate(0, -0.3, 0), "#f2c230");
  return mergeGeometries([band, ring])!;
}

export function Straps({ kind, carIndex }: { kind: CarKind; carIndex: number }) {
  const { pose } = useScene();
  const mesh = useRef<InstancedMesh>(null);
  const layout = useMemo(() => cabinLayout(kind), [kind]);
  const anchors = useMemo(() => {
    const out: { x: number; z: number; gain: number; phase: number }[] = [];
    let k = 0;
    for (const side of [-1, 1]) {
      for (let x = layout.xRear + 0.8; x < layout.xFront - 0.6; x += 0.7) {
        // Small per-strap differences so they don't move in lock-step.
        const h = Math.sin(k * 12.9898) * 43758.5453;
        const r = h - Math.floor(h);
        out.push({ x, z: side * layout.railZ, gain: 0.85 + 0.3 * r, phase: r * Math.PI * 2 });
        k++;
      }
    }
    return out;
  }, [layout]);
  const geometry = useMemo(() => strapGeometry(), []);
  const material = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 }), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  const st = useRef({ prevSpeed: 0, prevYaw: NaN, accel: 0, yawRate: 0, lon: 0, lonV: 0, lat: 0, latV: 0, t: 0 });
  const tmp = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), e: new Euler(), p: new Vector3(), s: new Vector3(1, 1, 1) }), []);

  useFrame((_, delta) => {
    const g = mesh.current;
    if (!g) return;
    const s = st.current;
    const dt = Math.min(Math.max(delta, 1e-3), 0.05);
    s.t += dt;
    const car = pose.cars[carIndex];
    const speed = pose.speed;
    // Smoothed longitudinal acceleration and yaw rate from the car's motion.
    const a = (speed - s.prevSpeed) / dt;
    s.prevSpeed = speed;
    s.accel += (a - s.accel) * Math.min(1, dt * 6);
    if (Number.isFinite(s.prevYaw)) {
      let dy = car.yaw - s.prevYaw;
      if (dy > Math.PI) dy -= 2 * Math.PI;
      if (dy < -Math.PI) dy += 2 * Math.PI;
      s.yawRate += (dy / dt - s.yawRate) * Math.min(1, dt * 4);
    }
    s.prevYaw = car.yaw;

    // The trailing car is turned around: its local +x points backwards.
    const fwd = carIndex === pose.cars.length - 1 ? -1 : 1;
    // Equilibrium: lean forward when braking, outward on curves (pseudo-forces).
    const lonEq = Math.max(-MAX_SWING, Math.min(MAX_SWING, Math.atan(-s.accel / G) * fwd));
    const latEq = Math.max(-MAX_SWING, Math.min(MAX_SWING, -Math.atan((speed * s.yawRate) / G) * fwd));
    s.lonV += (STIFFNESS * (lonEq - s.lon) - DAMPING * s.lonV) * dt;
    s.lon += s.lonV * dt;
    s.latV += (STIFFNESS * (latEq - s.lat) - DAMPING * s.latV) * dt;
    s.lat += s.latV * dt;
    const jiggle = Math.min(1, speed / 15) * 0.025;

    anchors.forEach((an, i) => {
      const lon = s.lon * an.gain + jiggle * Math.sin(s.t * 2.3 + an.phase);
      const lat = s.lat * an.gain + jiggle * 0.6 * Math.sin(s.t * 1.7 + an.phase * 1.3);
      // Rotation about z swings the ring along the car; about x, across it.
      tmp.e.set(lat, 0, lon);
      tmp.q.setFromEuler(tmp.e);
      tmp.p.set(an.x, layout.railY, an.z);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      g.setMatrixAt(i, tmp.m);
    });
    g.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, anchors.length]} frustumCulled={false} />;
}
