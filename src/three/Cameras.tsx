"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { MOUSE, Matrix4, type PerspectiveCamera, Quaternion, Spherical, TOUCH, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useScene } from "./SceneContext.tsx";
import { DRIVER_EYE } from "./trainModel.ts";
import { TRAIN } from "./layout.ts";

/** Tunnel chase: distance from the train's centre to the camera (half the 3-car train plus ~14 m). */
const TUNNEL_CHASE = (TRAIN.pitch * 2 + TRAIN.carLength) / 2 + 14;
import { clamp, easeInOutCubic } from "../utils/interpolation.ts";
import { freeCameraInput } from "./freeCamera.ts";
import { roofHeightNear } from "./world/heightField.ts";
import { dragLook, passengerLook, settleLook, zoomLook, type PassengerSpot } from "./passengerLook.ts";
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

/**
 * Passenger spots in the middle car, car-local: along (+ = forward), lateral
 * (+ = right of travel; the platform side is the left), eye height above the
 * floor, and the resting look direction (along, lateral) with a slight pitch.
 */
const PASSENGER_SPOT_POSE: Record<PassengerSpot, { along: number; lateral: number; eye: number; look: [number, number]; pitch: number }> = {
  // Seated on the right-hand bench, looking across at the platform-side windows.
  window: { along: -1.6, lateral: 0.78, eye: 1.22, look: [1.6, -6], pitch: -0.05 },
  // Standing just inside a platform-side door (door at x = -2.85), facing it.
  doors: { along: -2.85, lateral: 0.05, eye: 1.62, look: [0, -6], pitch: -0.08 },
  // At the rear end of the car, looking down its length towards the front.
  end: { along: -10.1, lateral: 0.0, eye: 1.62, look: [6, 0], pitch: -0.06 },
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
  const passengerMode = useViewStore((v) => v.cameraMode === "passenger");
  const gl = useThree((s) => s.gl);

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
    /** Height added to keep a cinematic camera above nearby roofs. */
    lift: 0,
    passengerSpot: passengerLook.spot,
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

  // Passenger look-around: drag (mouse / one finger) turns the head, wheel and
  // two-finger pinch zoom. Attached only while the passenger camera is active.
  useEffect(() => {
    if (!passengerMode || hero) return;
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const prevTouch = el.style.touchAction;
    el.style.touchAction = "none";
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 1) {
        dragLook(cur.x - prev.x, cur.y - prev.y, el.clientHeight);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) zoomLook((pinch - d) * 0.08);
        pinch = d;
      }
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomLook(e.deltaY * 0.02);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      el.style.touchAction = prevTouch;
    };
  }, [passengerMode, hero, gl]);

  // Dev-only probe for scripted checks.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __cm3dPassengerLook?: () => unknown };
    w.__cm3dPassengerLook = () => ({ ...passengerLook, fovNow: camera.fov });
    return () => {
      delete w.__cm3dPassengerLook;
    };
  }, [camera]);

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
    // Rail height under the train (the track climbs onto viaducts and dips into tunnels).
    const railAt = (d: number) => route.profile.railAt(d);
    const rail = railAt(pose.centerDistance);
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
      if (mode === "passenger") {
        // Enter at rest, at the current spot (the mode glide covers the move).
        passengerLook.yaw = 0;
        passengerLook.pitch = 0;
        s.passengerSpot = passengerLook.spot;
      }
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
          s.flybyPoint.set(tmp.pt.x, Math.max(2.0, railAt(d) > 8 ? 2.0 : railAt(d) + 3), tmp.pt.z);
        }
        if (wanted === "platform" && arrival) {
          const stopD = platformStop;
          s.platformStop = stopD ?? NaN;
          if (stopD !== null) {
            const lateral = Math.sign(pose.lateral || -1) * (route.params.trackCentres / 2 + 3.4);
            route.alignment.offsetPoint(stopD + pose.direction * (route.params.platformLength / 2 - 7), lateral, tmp.pt);
            s.platformPoint.set(tmp.pt.x, railAt(stopD) + route.params.platformHeight + 1.65, tmp.pt.z);
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
      // Underground the outside shots would be inside the earth: ride in the tunnel instead,
      // between the tracks behind the train, under the roof.
      if (!hero && rail < -4 && s.shot !== "platform") {
        // Clear of the last car (the train is ~68 m long; 30 m behind its centre is inside it).
        const back = pose.centerDistance - pose.direction * TUNNEL_CHASE;
        route.alignment.offsetPoint(back, -pose.lateral * 0.4, tmp.pt);
        tmp.pos.set(tmp.pt.x, railAt(back) + 3.4, tmp.pt.z);
        route.alignment.offsetPoint(pose.centerDistance + pose.direction * 20, pose.lateral, tmp.pt);
        tmp.look.set(tmp.pt.x, railAt(pose.centerDistance + pose.direction * 20) + 1.6, tmp.pt.z);
        desiredFov = 54;
      }
      // Real buildings line the track now: lift the camera over any roof it would sit in
      // (eased, so a shot glides over a building rather than jumping).
      // Only above ground: an underground platform shot sits beneath the buildings on purpose.
      if (tmp.pos.y > 0) {
        const roof = roofHeightNear(tmp.pos.x, tmp.pos.z, 3);
        const need = roof > 0 ? Math.max(0, roof + 3 - tmp.pos.y) : 0;
        s.lift += (need - s.lift) * Math.min(1, dt * (need > s.lift ? 6 : 1.5));
        tmp.pos.y += s.lift;
      } else s.lift = 0;
      lookFrom(tmp.pos, tmp.look);
    } else if (mode === "driver") {
      const car = pose.cars[0];
      const cf = tmp.cf.set(Math.cos(car.yaw), 0, -Math.sin(car.yaw));
      const cr = tmp.cr.set(-cf.z, 0, cf.x);
      // The eye rides with the cab, including its pitch on ramps (car-local: +x forward, +z right).
      tmp.pos.copy(tmp.lift.set(DRIVER_EYE.x, DRIVER_EYE.y, DRIVER_EYE.z).applyQuaternion(car.quaternion)).add(car.position);
      const headD = pose.centerDistance + pose.direction * (TRAIN.pitch + TRAIN.carLength / 2);
      route.alignment.offsetPoint(headD + pose.direction * 95, pose.lateral, tmp.pt);
      tmp.look.set(tmp.pt.x, railAt(headD + pose.direction * 95) + 2.0, tmp.pt.z);
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
      // Entering passenger mode starts at rest; a new spot glides there.
      if (s.passengerSpot !== passengerLook.spot) {
        s.passengerSpot = passengerLook.spot;
        startTransition(1.0);
      }
      const spot = PASSENGER_SPOT_POSE[passengerLook.spot];
      tmp.pos
        .copy(car.position)
        .addScaledVector(cf, spot.along)
        .addScaledVector(cr, spot.lateral)
        .add(tmp.v.set(0, TRAIN.floor + spot.eye, 0));
      settleLook(dt, performance.now(), reducedMotion);
      // Resting direction in the car frame, turned by yaw about the vertical and tilted by pitch.
      const bx = cf.x * spot.look[0] + cr.x * spot.look[1];
      const bz = cf.z * spot.look[0] + cr.z * spot.look[1];
      const bl = Math.hypot(bx, bz) || 1;
      const hx = bx / bl;
      const hz = bz / bl;
      const cy = Math.cos(passengerLook.yaw);
      const sy = Math.sin(passengerLook.yaw);
      // Rotate (hx, hz) counter-clockwise seen from above (+ yaw = turn left).
      const dx = hx * cy + hz * sy;
      const dz = -hx * sy + hz * cy;
      const p = spot.pitch + passengerLook.pitch;
      tmp.look.copy(tmp.pos).add(tmp.v.set(dx * Math.cos(p) * 6, Math.sin(p) * 6, dz * Math.cos(p) * 6));
      if (cameraShake && !reducedMotion) {
        const k = Math.min(1, pose.speed / 20);
        tmp.pos.y += Math.sin(s.time * 13) * 0.004 * k;
        tmp.pos.addScaledVector(cf, Math.sin(s.time * 1.7) * 0.015 * k);
      }
      desiredFov = passengerLook.fov;
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
