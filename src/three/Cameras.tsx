"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MOUSE, Matrix4, type PerspectiveCamera, Quaternion, Spherical, TOUCH, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useScene } from "./SceneContext.tsx";
import { DRIVER_EYE } from "./trainModel.ts";
import { TRAIN } from "./layout.ts";
import { clamp, easeInOutCubic } from "../utils/interpolation.ts";
import { freeCameraInput } from "./freeCamera.ts";
import { useViewStore, type CameraMode } from "../simulation/store.ts";
import type { ArrivalPhase } from "../simulation/types.ts";

/**
 * Camera director. Every mode computes a desired pose each frame; changes of
 * mode or cinematic shot glide from the current pose to the new one, so
 * the view never snaps (except under reduced motion, where it cuts cleanly).
 */

type Shot = "chase" | "front" | "flyby" | "side" | "aerial" | "platform" | "dwell";
const SHOT_CYCLE: { shot: Shot; seconds: number }[] = [
  { shot: "chase", seconds: 16 },
  { shot: "front", seconds: 12 },
  { shot: "flyby", seconds: 13 },
  { shot: "side", seconds: 14 },
  { shot: "aerial", seconds: 13 },
];

const MODE_LENS: Record<CameraMode, { fov: number; near: number; far: number }> = {
  cinematic: { fov: 42, near: 0.5, far: 9000 },
  driver: { fov: 62, near: 0.08, far: 9000 },
  passenger: { fov: 68, near: 0.05, far: 7000 },
  map: { fov: 40, near: 40, far: 90000 },
  free: { fov: 48, near: 0.3, far: 30000 },
};

/** Free camera limits, shared by the mouse/touch controls and the on-screen pad. */
const FREE = {
  minDistance: 8,
  maxDistance: 3000,
  /** Just above the horizon, so the camera never dips under the ground. */
  maxPolar: Math.PI * 0.485,
  minPolar: 0.05,
  /** Pad rates: radians/s for orbit and tilt, e-folds/s for zoom, view-widths/s for pan. */
  orbitRate: 1.1,
  tiltRate: 0.7,
  zoomRate: 1.4,
  panRate: 0.9,
};

export interface StopTarget {
  /** Alignment distance of the next stop's platform centre. */
  distance: number;
}

export interface CameraRigProps {
  reducedMotion: boolean;
  cameraShake: boolean;
  /** Live arrival phase (read every frame). */
  getArrival: () => { phase: ArrivalPhase; eta: number; nextStopDistance: number | null; currentStopDistance: number | null; dwellTime: number };
  /** Hero mode: fixed gentle tracking shot only. */
  hero?: boolean;
}

export function CameraRig({ reducedMotion, cameraShake, getArrival, hero = false }: CameraRigProps) {
  const { route, pose } = useScene();
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useRef<OrbitControlsImpl>(null);
  const freeMode = useViewStore((v) => v.cameraMode === "free");

  const st = useRef({
    mode: null as CameraMode | null,
    shot: "chase" as Shot,
    cycleIndex: 0,
    shotTime: 0,
    flybyPoint: new Vector3(),
    platformPoint: new Vector3(),
    platformStop: NaN,
    trans: { t: 1, dur: 1, fromPos: new Vector3(), fromQuat: new Quaternion(), fromFov: 50, fromNear: 0.5 },
    lastCenter: new Vector3(),
    time: 0,
    orbitBase: 0,
  });
  const tmp = useMemo(
    () => ({
      pos: new Vector3(),
      look: new Vector3(),
      quat: new Quaternion(),
      mat: new Matrix4(),
      f: new Vector3(),
      r: new Vector3(),
      up: new Vector3(0, 1, 0),
      north: new Vector3(0, 0, -1),
      pt: { x: 0, z: 0 },
      v: new Vector3(),
      cf: new Vector3(),
      cr: new Vector3(),
      lift: new Vector3(),
      sph: new Spherical(),
      offset: new Vector3(),
      pf: new Vector3(),
      pr: new Vector3(),
    }),
    [],
  );

  const startTransition = (dur: number) => {
    const s = st.current;
    s.trans.t = 0;
    s.trans.dur = reducedMotion ? 0.0001 : dur;
    s.trans.fromPos.copy(camera.position);
    s.trans.fromQuat.copy(camera.quaternion);
    s.trans.fromFov = camera.fov;
    s.trans.fromNear = camera.near;
  };

  /** On-screen pad: orbit, tilt and zoom about the target, pan across the ground. */
  const applyFreePad = (cam: PerspectiveCamera, ctl: OrbitControlsImpl, dt: number) => {
    const inp = freeCameraInput;
    if (!inp.orbit && !inp.tilt && !inp.zoom && !inp.panX && !inp.panY) return;
    const offset = tmp.offset.subVectors(cam.position, ctl.target);
    const sph = tmp.sph.setFromVector3(offset);
    sph.theta -= inp.orbit * FREE.orbitRate * dt;
    sph.phi = clamp(sph.phi - inp.tilt * FREE.tiltRate * dt, FREE.minPolar, FREE.maxPolar);
    sph.radius = clamp(sph.radius * Math.exp(-inp.zoom * FREE.zoomRate * dt), FREE.minDistance, FREE.maxDistance);
    offset.setFromSpherical(sph);
    // Pan on the ground plane, relative to where the camera is facing.
    const fwd = tmp.pf.set(-offset.x, 0, -offset.z);
    if (fwd.lengthSq() < 1e-6) fwd.set(-Math.sin(sph.theta), 0, -Math.cos(sph.theta));
    fwd.normalize();
    const right = tmp.pr.set(-fwd.z, 0, fwd.x);
    const step = sph.radius * FREE.panRate * dt;
    ctl.target.addScaledVector(right, inp.panX * step).addScaledVector(fwd, inp.panY * step);
    cam.position.copy(ctl.target).add(offset);
    cam.lookAt(ctl.target);
  };

  // Camera convention: -Z looks at the target (Matrix4.lookAt builds exactly that).
  const lookFrom = (pos: Vector3, look: Vector3, up: Vector3 = tmp.up) => {
    tmp.mat.lookAt(pos, look, up);
    tmp.quat.setFromRotationMatrix(tmp.mat);
  };

  useFrame((state, delta) => {
    const s = st.current;
    const dt = Math.min(delta, 0.1);
    s.time += dt;
    const mode: CameraMode = hero ? "cinematic" : useViewStore.getState().cameraMode;
    const rail = route.params.railLevel;
    const C = pose.center;
    const f = tmp.f.copy(pose.forward);
    const r = tmp.r.set(-f.z, 0, f.x);

    if (mode !== s.mode) {
      const fromMap = s.mode === "map" || mode === "map";
      // Free mode always glides into its default framing, even on first load.
      if (s.mode !== null || mode === "free") startTransition(fromMap ? 2.2 : 1.6);
      else s.trans.t = 1;
      s.mode = mode;
      s.shot = "chase";
      s.shotTime = 0;
    }

    const lens = MODE_LENS[mode];
    let desiredFov = lens.fov;
    let up = tmp.up;

    if (mode === "free") {
      const ctl = controls.current;
      tmp.v.subVectors(C, s.lastCenter);
      s.lastCenter.copy(C);
      if (freeCameraInput.recentre) {
        freeCameraInput.recentre = false;
        startTransition(1.2);
      }
      // Default framing: behind and above the train, looking at its middle car.
      tmp.look.copy(C).add(tmp.lift.set(0, 1.5, 0));
      if (s.trans.t < 1) {
        // Glide in (on entering free mode or recentring), then hand over to the controls.
        tmp.pos.copy(C).addScaledVector(f, -52).addScaledVector(r, 34).add(tmp.lift.set(0, 30, 0));
        lookFrom(tmp.pos, tmp.look);
        const tr = s.trans;
        tr.t = Math.min(1, tr.t + dt / tr.dur);
        const e = easeInOutCubic(tr.t);
        camera.position.lerpVectors(tr.fromPos, tmp.pos, e);
        camera.quaternion.slerpQuaternions(tr.fromQuat, tmp.quat, e);
        const near = Math.max(Math.min(lens.near, tr.fromNear), MODE_LENS.passenger.near * 2);
        applyLens(camera, tr.fromFov + (lens.fov - tr.fromFov) * e, tr.t < 1 ? near : lens.near, lens.far);
        ctl?.target.copy(tmp.look);
        return;
      }
      if (!ctl) return;
      if (freeCameraInput.lookAt) {
        const { target, from } = freeCameraInput.lookAt;
        freeCameraInput.lookAt = null;
        useViewStore.getState().setFreeFollow(false);
        ctl.target.set(...target);
        camera.position.set(...from);
        camera.lookAt(ctl.target);
      }
      // Carry the view along with the train unless the rider unpinned it.
      if (useViewStore.getState().freeFollow) {
        camera.position.add(tmp.v);
        ctl.target.add(tmp.v);
      }
      applyFreePad(camera, ctl, dt);
      applyLens(camera, lens.fov, lens.near, lens.far);
      return;
    }

    if (mode === "cinematic") {
      const arrival = hero ? null : getArrival();
      let wanted: Shot = s.shot;
      if (hero || reducedMotion) {
        wanted = hero ? "front" : "chase";
      } else if (arrival && arrival.phase === "approaching" && arrival.eta < 22 && arrival.nextStopDistance !== null) {
        wanted = "platform";
      } else if (arrival && ["arrived", "doors-opening"].includes(arrival.phase)) {
        wanted = "platform";
      } else if (arrival && arrival.phase === "doors-open") {
        wanted = arrival.dwellTime > 7 ? "dwell" : "platform";
      } else if (arrival && arrival.phase === "doors-closing") {
        wanted = "platform";
      } else {
        if (s.shot === "platform" || s.shot === "dwell") {
          wanted = "chase";
          s.cycleIndex = 0;
        } else {
          s.shotTime += dt;
          const cur = SHOT_CYCLE[s.cycleIndex % SHOT_CYCLE.length];
          const passed = s.shot === "flyby" && tmp.v.subVectors(s.flybyPoint, C).dot(f) < -70;
          if (s.shotTime > cur.seconds || passed) {
            s.cycleIndex++;
            wanted = SHOT_CYCLE[s.cycleIndex % SHOT_CYCLE.length].shot;
          } else wanted = cur.shot;
        }
      }
      // A platform shot belongs to one station; re-target if the stop changed (e.g. after seeking).
      const platformStop =
        wanted === "platform" && arrival
          ? (arrival.phase === "approaching" ? arrival.nextStopDistance : arrival.currentStopDistance)
          : null;
      if (wanted === "platform" && s.shot === "platform" && platformStop !== null && platformStop !== s.platformStop) {
        s.shot = "chase";
      }
      if (wanted !== s.shot) {
        startTransition(wanted === "platform" ? 3.2 : 2.6);
        s.shot = wanted;
        s.shotTime = 0;
        if (wanted === "flyby") {
          const d = pose.centerDistance + pose.direction * 170;
          const side = Math.sin(s.time) > 0 ? 1 : -1;
          route.alignment.offsetPoint(d, side * 17, tmp.pt);
          s.flybyPoint.set(tmp.pt.x, 2.0, tmp.pt.z);
        }
        if (wanted === "platform" && arrival) {
          const stopD = platformStop;
          s.platformStop = stopD ?? NaN;
          if (stopD !== null) {
            const lateral = Math.sign(pose.lateral || -1) * (route.params.trackCentres / 2 + 3.4);
            route.alignment.offsetPoint(stopD + pose.direction * (route.params.platformLength / 2 - 7), lateral, tmp.pt);
            s.platformPoint.set(tmp.pt.x, rail + route.params.platformHeight + 1.65, tmp.pt.z);
          }
        }
        if (wanted === "dwell") s.orbitBase = s.time;
      }

      switch (s.shot) {
        case "chase":
          tmp.pos.copy(C).addScaledVector(f, -58).addScaledVector(r, 15).add(tmp.v.set(0, 15, 0));
          tmp.look.copy(C).addScaledVector(f, 24).add(tmp.v.set(0, 1.5, 0));
          break;
        case "front":
          if (hero) {
            // Gentle front three-quarter, drifting slowly so the frame breathes.
            const drift = Math.sin(s.time * 0.07);
            tmp.pos.copy(pose.head).addScaledVector(f, 24 + drift * 4).addScaledVector(r, -8.5 - drift * 1.5).add(tmp.v.set(0, 5.2 + drift * 0.6, 0));
            tmp.look.copy(C).addScaledVector(f, -4).addScaledVector(r, -2).add(tmp.v.set(0, 1.2, 0));
            desiredFov = 38;
          } else {
            tmp.pos.copy(pose.head).addScaledVector(f, 26).addScaledVector(r, -15).add(tmp.v.set(0, 4, 0));
            tmp.look.copy(C).add(tmp.v.set(0, 1.6, 0));
            desiredFov = 40;
          }
          break;
        case "flyby":
          tmp.pos.copy(s.flybyPoint);
          tmp.look.copy(C).add(tmp.v.set(0, 1.4, 0));
          desiredFov = 46;
          break;
        case "side":
          tmp.pos.copy(C).addScaledVector(r, 30).addScaledVector(f, 8 * Math.sin(s.time * 0.12)).add(tmp.v.set(0, 5, 0));
          tmp.look.copy(C).add(tmp.v.set(0, 1.8, 0));
          break;
        case "aerial":
          tmp.pos.copy(C).addScaledVector(f, -110).addScaledVector(r, 85).add(tmp.v.set(0, 80, 0));
          tmp.look.copy(C).addScaledVector(f, 70);
          desiredFov = 46;
          break;
        case "platform":
          tmp.pos.copy(s.platformPoint);
          tmp.look.copy(C).add(tmp.v.set(0, 1.6, 0));
          desiredFov = 50;
          break;
        case "dwell": {
          const a = (s.time - s.orbitBase) * 0.06 + 2.3;
          tmp.pos.copy(C).addScaledVector(f, Math.cos(a) * 36).addScaledVector(r, Math.sin(a) * 36).add(tmp.v.set(0, 10, 0));
          tmp.look.copy(C).add(tmp.v.set(0, 1.5, 0));
          break;
        }
      }
      lookFrom(tmp.pos, tmp.look);
    } else if (mode === "driver") {
      const car = pose.cars[0];
      const cf = tmp.cf.set(Math.cos(car.yaw), 0, -Math.sin(car.yaw));
      const cr = tmp.cr.set(-cf.z, 0, cf.x);
      tmp.pos
        .copy(car.position)
        .addScaledVector(cf, DRIVER_EYE.x)
        .addScaledVector(cr, DRIVER_EYE.z)
        .add(tmp.lift.set(0, DRIVER_EYE.y, 0));
      const headD = pose.centerDistance + pose.direction * (TRAIN.pitch + TRAIN.carLength / 2);
      route.alignment.offsetPoint(headD + pose.direction * 95, pose.lateral, tmp.pt);
      tmp.look.set(tmp.pt.x, rail + 2.0, tmp.pt.z);
      if (cameraShake && !reducedMotion) {
        const k = Math.min(1, pose.speed / 20);
        tmp.pos.y += Math.sin(s.time * 19) * 0.006 * k + Math.sin(s.time * 7.3) * 0.004 * k;
        tmp.pos.addScaledVector(cr, Math.sin(s.time * 3.1) * 0.01 * k);
      }
      lookFrom(tmp.pos, tmp.look);
    } else if (mode === "passenger") {
      const car = pose.cars[1];
      const cf = tmp.cf.set(Math.cos(car.yaw), 0, -Math.sin(car.yaw));
      const cr = tmp.cr.set(-cf.z, 0, cf.x);
      tmp.pos
        .copy(car.position)
        .addScaledVector(cf, -1.6)
        .addScaledVector(cr, 0.78)
        .add(tmp.v.set(0, TRAIN.floor + 1.22, 0));
      tmp.look.copy(tmp.pos).addScaledVector(cr, -6).addScaledVector(cf, 1.6).add(tmp.v.set(0, -0.3, 0));
      if (cameraShake && !reducedMotion) {
        const k = Math.min(1, pose.speed / 20);
        tmp.pos.y += Math.sin(s.time * 13) * 0.004 * k;
        tmp.pos.addScaledVector(cf, Math.sin(s.time * 1.7) * 0.015 * k);
      }
      lookFrom(tmp.pos, tmp.look);
    } else if (mode === "map") {
      const b = route.bounds;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const w = (b.maxX - b.minX) * 1.12;
      const h = (b.maxZ - b.minZ) * 1.12 + 1200;
      // Fit the route into the screen area the HUD leaves free.
      const desktop = size.width >= 768;
      const left = desktop && useViewStore.getState().sidebarOpen ? 310 : 0;
      const top = desktop ? 90 : 70;
      const bottom = desktop ? 110 : 300;
      const freeW = Math.max(200, size.width - left - 24);
      const freeH = Math.max(200, size.height - top - bottom);
      const vfov = (lens.fov * Math.PI) / 180;
      const worldPerPxAtUnit = (2 * Math.tan(vfov / 2)) / Math.max(1, size.height);
      const alt = Math.max(w / (freeW * worldPerPxAtUnit), h / (freeH * worldPerPxAtUnit));
      const perPx = alt * worldPerPxAtUnit;
      // Screen right = +x, screen up = -z (north up).
      const ox = -((left - 24) / 2) * perPx;
      const oz = ((bottom - top) / 2) * perPx;
      tmp.pos.set(cx + ox, alt, cz + oz + alt * 0.001);
      tmp.look.set(cx + ox, 0, cz + oz);
      up = tmp.north;
      lookFrom(tmp.pos, tmp.look, up);
    }

    // Blend from the previous pose while a transition is running.
    const tr = s.trans;
    if (tr.t < 1) {
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      const e = easeInOutCubic(tr.t);
      camera.position.lerpVectors(tr.fromPos, tmp.pos, e);
      camera.quaternion.slerpQuaternions(tr.fromQuat, tmp.quat, e);
      const fov = tr.fromFov + (desiredFov - tr.fromFov) * e;
      // Only pull the near plane in as far as the two shots need (e.g. when
      // gliding into the cab); a needlessly tiny near plane costs depth
      // precision across the whole scene and makes thin layers flicker.
      const near = Math.max(Math.min(lens.near, tr.fromNear), MODE_LENS.passenger.near * 2);
      applyLens(camera, fov, tr.t < 1 ? near : lens.near, Math.max(lens.far, mode === "map" ? lens.far : 9000));
    } else {
      camera.position.copy(tmp.pos);
      camera.quaternion.copy(tmp.quat);
      applyLens(camera, desiredFov, lens.near, lens.far);
    }
    s.lastCenter.copy(C);
    void state;
  });

  if (hero) return null;
  return (
    <OrbitControls
      ref={controls}
      enabled={freeMode}
      enableDamping
      dampingFactor={0.1}
      rotateSpeed={0.7}
      zoomSpeed={1.3}
      panSpeed={1.1}
      // Pan across the ground like a map, not up and down the screen.
      screenSpacePanning={false}
      minDistance={FREE.minDistance}
      maxDistance={FREE.maxDistance}
      minPolarAngle={FREE.minPolar}
      maxPolarAngle={FREE.maxPolar}
      // Drag: rotate · right-drag (or Shift/Ctrl + drag): pan · wheel: zoom.
      mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
      // One finger: rotate · two fingers: pinch to zoom and drag to pan.
      touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
      makeDefault={false}
    />
  );
}

function applyLens(camera: PerspectiveCamera, fov: number, near: number, far: number) {
  if (Math.abs(camera.fov - fov) > 0.01 || camera.near !== near || camera.far !== far) {
    camera.fov = fov;
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}
