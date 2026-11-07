"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BoxGeometry,
  Color,
  type Group,
  InstancedMesh,
  Matrix4,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  type Texture,
  Vector3,
} from "three";
import { useScene } from "./SceneContext.tsx";
import { cabinLayout } from "./trainModel.ts";
import { TRAIN } from "./layout.ts";
import { buildBag, buildConcourse, buildEscalatorSteps, buildGuardArm, CURTAIN, GUARD_SHOULDER, GUARD_SKIN } from "./concourseModel.ts";
import { ensureFontsLoaded, makeConcourseSignAtlas, makeXrayScreen } from "./textures.ts";
import { CONCOURSE, carWalkSpace, concoursePlan, gateId, planDims, securityBarrier, stationPoints, stationWalkSpace, stationWalkable, type ConcoursePlan, type Side, type WalkPoint } from "./walkPlan.ts";
import { getWalkHud, lockWalkPointer, platformCrowd, releaseWalkInput, resetWalkHud, setWalkHud, showWalkNotice, subscribeWalkHud, takeWalkRequests, unlockWalkPointer, walkInput, walkPointer, walkView, type WalkHud } from "./walkState.ts";
import { composeMatrix } from "../utils/geometry.ts";
import { clamp, damp, dampAngle } from "../utils/interpolation.ts";
import { gateBeep } from "../utils/audio.ts";
import { PassengerTrip, tripObjective } from "../simulation/PassengerTrip.ts";
import { standAt, walk, type Obstacle, type Pad, type WalkSpace } from "../simulation/walkSpace.ts";
import type { SimulationEngine } from "../simulation/SimulationEngine.ts";
import type { StationModel } from "../simulation/RouteController.ts";
import { useViewStore } from "../simulation/store.ts";

/**
 * Walk mode: the journey on foot, in first person. The passenger starts on
 * the street outside the origin station, buys a ticket at the counter, puts
 * a bag on the X-ray belt, is scanned in the men's or women's security lane,
 * collects the bag, scans in at a gate, rides the escalator up, boards when
 * the doors are open,
 * rides, gets off at the destination, scans out, drops the used ticket in
 * the box and walks down to the street.
 *
 * This component owns the passenger: it reads input, moves them through the
 * walkable space (simulation/walkSpace.ts) of whichever frame they are in —
 * a station or a train car — and hands their eye to the camera rig. It also
 * draws what only matters on foot: the concourse interiors of the two
 * stations, the gate flaps, the running escalator steps and a waypoint.
 */

const EYE = 1.62;
const WALK_SPEED = 2.4;
const RUN_SPEED = 5.2;
/** Radians per pixel: mouse look while the pointer is captured, and drag look otherwise. */
const LOOK_RATE = 0.0023;
const MAX_PITCH = 1.35;
/** Larger single mouse moves (pixels) while captured are glitches, not looks. */
const MAX_LOOK_STEP = 250;
/** A gate lane stays open this long after a scan, or until the passenger is through. */
const GATE_OPEN_S = 9;
const USE_RANGE = 1.4;
/** How long the guard takes over the body scan (seconds), and the pass of the scanner up and down. */
const SCAN_S = 3.2;
const SCAN_PASS_S = 1.05;
/** The guard's arm, in radians below level: at rest, and the two ends of a pass. */
const ARM_REST = 1.42;
const ARM_HIGH = 0.12;
const ARM_LOW = 1.12;
/** The enclosure's doorway curtains draw aside for a passenger this near, and shut again behind them. */
const CURTAIN_RANGE = 0.6;

/** A local frame on the ground plane: origin and unit +x axis (the +z axis is its right-hand normal). */
interface Frame {
  px: number;
  pz: number;
  tx: number;
  tz: number;
}

const toWorld = (f: Frame, x: number, z: number, out: { x: number; z: number }) => {
  out.x = f.px + f.tx * x - f.tz * z;
  out.z = f.pz + f.tz * x + f.tx * z;
  return out;
};
const toLocal = (f: Frame, wx: number, wz: number, out: { x: number; z: number }) => {
  const dx = wx - f.px;
  const dz = wz - f.pz;
  out.x = dx * f.tx + dz * f.tz;
  out.z = -dx * f.tz + dz * f.tx;
  return out;
};

type Where = "origin" | "destination" | "car";

interface StationWalk {
  station: StationModel;
  walkable: boolean;
  frame: Frame;
  matrix: Matrix4;
  /** Platform our train uses here: -1 = left of increasing distance. */
  side: Side;
  space: WalkSpace;
  /** The station's own furniture, and the platform crowd last added to it (Stations.tsx re-places it with the crowd level). */
  furniture: Obstacle[];
  crowd: readonly { x: number; z: number }[] | null;
  points: ReturnType<typeof stationPoints>;
  /** Open gate lanes: barrier id → seconds left. */
  timers: Map<string, number>;
  open: Set<string>;
  /** How far each lane's flaps have swung open (0..1), by barrier id. */
  flaps: Map<string, number>;
}

const GATE_IDS = (["entry", "exit"] as const).flatMap((kind) => CONCOURSE.gate.lanes.map((_, lane) => gateId(kind, lane)));

function interiorMaterial(): MeshStandardMaterial {
  // Lit from within: each surface glows a little in its own colour, as under the hall's lamps.
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.78, emissive: new Color("#ffffff"), emissiveIntensity: 0.34 });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor.rgb;");
  };
  mat.customProgramCacheKey = () => "cm-walk-interior-v1";
  return mat;
}

export function WalkMode({ engine, reducedMotion }: { engine: SimulationEngine; reducedMotion: boolean }) {
  const { route, pose } = useScene();
  const gl = useThree((s) => s.gl);
  const walking = useViewStore((s) => s.cameraMode === "walk");
  const { journey } = engine;
  const plan: ConcoursePlan = useMemo(() => concoursePlan(planDims(route)), [route]);

  const stations = useMemo(() => {
    const side = -journey.direction as Side;
    const make = (station: StationModel): StationWalk => {
      const p = route.alignment.point(station.distance);
      const t = route.alignment.tangent(station.distance);
      const space = stationWalkSpace(plan);
      return {
        station,
        walkable: stationWalkable(route, station),
        frame: { px: p.x, pz: p.z, tx: t.x, tz: t.z },
        matrix: composeMatrix(new Matrix4(), p.x, 0, p.z, route.alignment.heading(station.distance)),
        side,
        space,
        furniture: space.obstacles,
        crowd: null,
        points: stationPoints(plan, side),
        timers: new Map(),
        open: new Set(),
        flaps: new Map(GATE_IDS.map((id) => [id, 0])),
      };
    };
    return { origin: make(journey.from), destination: make(journey.to) };
  }, [route, journey, plan]);
  const interiors = useMemo(() => [stations.origin, stations.destination].filter((s) => s.walkable), [stations]);

  // The three cars: DMC, TC, DMC (the last one turned round, so its platform side is its right).
  const cars = useMemo(
    () =>
      (["DMC", "TC", "DMC"] as const).map((kind, k) => {
        const layout = cabinLayout(kind);
        return { layout, space: carWalkSpace(layout), platformSide: (k === 2 ? 1 : -1) as Side };
      }),
    [],
  );

  const S = useRef({
    trip: null as PassengerTrip | null,
    wasWalking: false,
    where: "origin" as Where,
    car: 1,
    x: 0,
    z: 0,
    y: 0,
    /** Heading in the current frame: 0 faces +x, + turns right (towards +z). */
    yaw: 0,
    pitch: 0,
    vx: 0,
    vz: 0,
    stride: 0,
    lastClock: 0,
    escalator: 0,
    /** Seconds left of the guard's body scan (0 = none under way). The passenger stands still for it. */
    scanning: 0,
    /** Which security lane the scan is in. */
    scanLane: 0,
    /** Where the bag is along the belt (null = not on it). */
    bagX: null as number | null,
    /** Where the waypoint stands, in the current frame (for the dev probe). */
    target: null as WalkPoint | null,
    /** Dev probe: a heading to turn towards smoothly, until the passenger looks elsewhere. */
    aim: null as { yaw: number; pitch: number } | null,
  });
  const tmp = useMemo(() => ({ a: { x: 0, z: 0 }, b: { x: 0, z: 0 }, v: new Vector3(), target: new Vector3(), frame: { px: 0, pz: 0, tx: 1, tz: 0 } as Frame, m: new Matrix4(), q: new Quaternion(), p: new Vector3(), s: new Vector3() }), []);

  const carFrame = (k: number, out: Frame): Frame => {
    const car = pose.cars[k];
    out.px = car.position.x;
    out.pz = car.position.z;
    out.tx = Math.cos(car.yaw);
    out.tz = -Math.sin(car.yaw);
    return out;
  };
  const frameOf = (where: Where, k: number): Frame => (where === "car" ? carFrame(k, tmp.frame) : stations[where].frame);

  /** Move the passenger to another frame, keeping where they are and which way they face in the world. */
  const transfer = (where: Where, car: number, x: number, z: number, y: number) => {
    const s = S.current;
    const from = frameOf(s.where, s.car);
    const fx = from.tx * Math.cos(s.yaw) - from.tz * Math.sin(s.yaw);
    const fz = from.tz * Math.cos(s.yaw) + from.tx * Math.sin(s.yaw);
    const vx = from.tx * s.vx - from.tz * s.vz;
    const vz = from.tz * s.vx + from.tx * s.vz;
    const to = frameOf(where, car);
    s.yaw = Math.atan2(-fx * to.tz + fz * to.tx, fx * to.tx + fz * to.tz);
    s.vx = vx * to.tx + vz * to.tz;
    s.vz = -vx * to.tz + vz * to.tx;
    s.where = where;
    s.car = car;
    s.x = x;
    s.z = z;
    s.y = y;
    s.aim = null;
  };

  const placeAboard = () => {
    const s = S.current;
    const { layout } = cars[1];
    s.where = "car";
    s.car = 1;
    s.x = layout.doors[1];
    s.z = 0;
    s.y = layout.floorY;
    s.yaw = 0;
    s.pitch = 0;
    s.vx = s.vz = 0;
  };

  const startTrip = () => {
    const s = S.current;
    const origin = stations.origin;
    const first = engine.trajectory.stops[0];
    const rideStarted = engine.started && engine.clock.time > first.closeStart - 0.3;
    s.trip = new PassengerTrip({ originWalkable: origin.walkable, destinationWalkable: stations.destination.walkable, rideStarted });
    for (const st of [stations.origin, stations.destination]) {
      st.timers.clear();
      st.open.clear();
    }
    s.scanning = 0;
    s.bagX = null;
    if (s.trip.startedAboard) {
      placeAboard();
      // Nothing to walk through at the origin: the train leaves as it would for any other camera.
      if (!engine.started && !reducedMotion) engine.play();
    } else {
      // The train waits at the platform, doors open, until the passenger is on it.
      engine.reset();
      const p = origin.points.spawn;
      s.where = "origin";
      s.x = p.x;
      s.z = p.z;
      s.y = p.y;
      s.yaw = 0;
      s.pitch = 0;
      s.vx = s.vz = 0;
    }
    s.lastClock = engine.clock.time;
    setWalkHud({ trip: getWalkHud().trip + 1, counterOpen: false, notice: null, startedAboard: s.trip.startedAboard });
  };

  // Keyboard: WASD or arrows to move, Shift to run, E or Enter to use.
  useEffect(() => {
    if (!walking) return;
    const held = new Set<string>();
    const apply = () => {
      const on = (...codes: string[]) => (codes.some((c) => held.has(c)) ? 1 : 0);
      walkInput.forward = on("KeyW", "ArrowUp") - on("KeyS", "ArrowDown");
      walkInput.strafe = on("KeyD", "ArrowRight") - on("KeyA", "ArrowLeft");
      walkInput.run = on("ShiftLeft", "ShiftRight") === 1;
    };
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return t?.tagName === "INPUT" || t?.tagName === "SELECT" || t?.tagName === "TEXTAREA" || Boolean(t?.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
      const blockedByDialog = getWalkHud().counterOpen || useViewStore.getState().settingsOpen || useViewStore.getState().shortcutsOpen;
      if (blockedByDialog) return;
      if (e.code === "KeyE" || (e.code === "Enter" && (e.target as HTMLElement | null)?.tagName !== "BUTTON")) {
        if (!e.repeat) walkInput.interact = true;
        e.preventDefault();
        return;
      }
      held.add(e.code);
      if (e.code.startsWith("Arrow")) e.preventDefault();
      apply();
    };
    const up = (e: KeyboardEvent) => {
      held.delete(e.code);
      apply();
    };
    const clear = () => {
      held.clear();
      apply();
    };
    // A dialog takes the keyboard: let go of whatever was held so nobody walks off when it closes.
    let dialog = false;
    const offHud = subscribeWalkHud(() => {
      const open = getWalkHud().counterOpen;
      if (open && !dialog) clear();
      dialog = open;
    });
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      offHud();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      releaseWalkInput();
    };
  }, [walking]);

  // The canvas is what the mouse locks to (Depart and the counter's buttons capture it too).
  useEffect(() => {
    walkPointer.el = gl.domElement;
    return () => {
      if (walkPointer.el === gl.domElement) walkPointer.el = null;
    };
  }, [gl]);

  // Settings and the shortcuts list need the mouse.
  const panelOpen = useViewStore((s) => s.settingsOpen || s.shortcutsOpen);
  useEffect(() => {
    if (walking && panelOpen) unlockWalkPointer();
  }, [walking, panelOpen]);

  // Looking: a click on the view captures the mouse (Esc frees it); on touch, drag the view the way to look.
  useEffect(() => {
    if (!walking) return;
    const el = gl.domElement;
    const drags = new Map<number, { x: number; y: number }>();
    const prevTouch = el.style.touchAction;
    el.style.touchAction = "none";
    const locked = () => document.pointerLockElement === el;
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse") {
        if (e.button === 0 && !locked() && !getWalkHud().counterOpen) lockWalkPointer();
        return;
      }
      drags.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const move = (e: PointerEvent) => {
      if (locked()) {
        // Chrome sometimes reports one huge jump just after capture: ignore it.
        if (Math.abs(e.movementX) > MAX_LOOK_STEP || Math.abs(e.movementY) > MAX_LOOK_STEP) return;
        walkInput.turn += e.movementX * LOOK_RATE;
        walkInput.tilt -= e.movementY * LOOK_RATE;
        return;
      }
      const d = drags.get(e.pointerId);
      if (!d) return;
      // The view follows the finger, as in phone games: drag left to look left, up to look up.
      walkInput.turn += (e.clientX - d.x) * LOOK_RATE * 1.6;
      walkInput.tilt -= (e.clientY - d.y) * LOOK_RATE * 1.6;
      d.x = e.clientX;
      d.y = e.clientY;
    };
    const up = (e: PointerEvent) => {
      drags.delete(e.pointerId);
    };
    const lockChange = () => setWalkHud({ pointerLocked: locked() });
    // Capture may have begun before these listeners (Depart captures in its own click).
    lockChange();
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    document.addEventListener("pointerlockchange", lockChange);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.removeEventListener("pointerlockchange", lockChange);
      el.style.touchAction = prevTouch;
      if (locked()) document.exitPointerLock();
      setWalkHud({ pointerLocked: false });
    };
  }, [walking, gl]);

  // A new journey starts a new trip; leaving the simulator clears the HUD.
  useEffect(() => {
    const s = S.current;
    return () => {
      s.trip = null;
      s.wasWalking = false;
      walkView.ready = false;
      engine.setHeld(false);
      resetWalkHud();
    };
  }, [engine, stations]);

  // Dev-only probe for scripted checks: where the passenger is, and a way to face a point.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __cm3dWalk?: unknown };
    w.__cm3dWalk = {
      state: () => {
        const s = S.current;
        const car = cars[s.car];
        return { where: s.where, car: s.car, x: s.x, z: s.z, y: s.y, yaw: s.yaw, stage: s.trip?.stage ?? null, target: s.target, doors: car.layout.doors, platformSide: car.platformSide, hud: getWalkHud() };
      },
      /** Face a point given in the current frame (station- or car-local): at once, or turning smoothly. */
      face: (x: number, z: number, pitch = 0, smooth = false) => {
        const s = S.current;
        const yaw = Math.atan2(z - s.z, x - s.x);
        if (smooth) s.aim = { yaw, pitch };
        else {
          s.aim = null;
          s.yaw = yaw;
          s.pitch = pitch;
        }
      },
      points: () => ({ origin: stations.origin.points, destination: stations.destination.points, plan }),
    };
    return () => {
      delete w.__cm3dWalk;
    };
  }, [stations, plan, cars]);

  /* ---------------------------------------------------------------- */
  /* What is drawn only for the passenger on foot                      */
  /* ---------------------------------------------------------------- */

  const interior = useMemo(() => buildConcourse(plan, route.line.colour), [plan, route.line.colour]);
  const steps = useMemo(() => buildEscalatorSteps(plan), [plan]);
  const mats = useMemo(
    () => ({
      solid: interiorMaterial(),
      glass: new MeshStandardMaterial({ color: "#9fb4c4", roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.26, depthWrite: false }),
      glow: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      signs: new MeshBasicMaterial({ color: "#0d1724", toneMapped: false }),
      flap: new MeshStandardMaterial({ color: "#f0652f", roughness: 0.25, transparent: true, opacity: 0.82, emissive: new Color("#f0652f"), emissiveIntensity: 0.25 }),
      marker: new MeshBasicMaterial({ color: "#ffd23f", toneMapped: false, transparent: true, opacity: 0.92, depthTest: false }),
      xray: new MeshBasicMaterial({ toneMapped: false }),
      curtain: new MeshStandardMaterial({ color: CURTAIN, roughness: 0.9, emissive: new Color(CURTAIN), emissiveIntensity: 0.3 }),
    }),
    [],
  );
  const screens = useMemo(() => ({ idle: makeXrayScreen(false), bag: makeXrayScreen(true) }), []);
  useEffect(() => {
    mats.xray.map = screens.idle;
    mats.xray.needsUpdate = true;
    return () => {
      screens.idle.dispose();
      screens.bag.dispose();
    };
  }, [mats, screens]);
  const [atlas, setAtlas] = useState<Texture | null>(null);
  useEffect(() => {
    let alive = true;
    let tex: Texture | null = null;
    const last = route.stations[route.stations.length - 1];
    const first = route.stations[0];
    ensureFontsLoaded().then(() => {
      if (!alive) return;
      // Platform 1 (left of increasing distance) serves trains towards the far end of the line.
      tex = makeConcourseSignAtlas(route.line.colour, { name: last.name, nameTa: last.nameTa }, { name: first.name, nameTa: first.nameTa });
      setAtlas(tex);
    });
    return () => {
      alive = false;
      tex?.dispose();
    };
  }, [route]);
  useEffect(() => {
    mats.signs.map = atlas;
    mats.signs.color.set(atlas ? "#ffffff" : "#0d1724");
    mats.signs.needsUpdate = true;
  }, [atlas, mats]);

  const interiorMeshes = useMemo(() => {
    if (!interiors.length) return [];
    const make = (geo: (typeof interior)[keyof typeof interior], mat: MeshStandardMaterial | MeshBasicMaterial, order = 0) => {
      const mesh = new InstancedMesh(geo, mat, interiors.length);
      interiors.forEach((st, i) => mesh.setMatrixAt(i, st.matrix));
      mesh.receiveShadow = true;
      mesh.renderOrder = order;
      mesh.computeBoundingSphere();
      return mesh;
    };
    return [make(interior.solid, mats.solid), make(interior.glow, mats.glow), make(interior.signs, mats.signs), make(interior.glass, mats.glass, 2)];
  }, [interior, interiors, mats]);

  // Two flaps per gate lane, per station.
  const flapGeo = useMemo(() => new BoxGeometry(0.05, 0.5, 1), []);
  const flapMeshes = useMemo(
    () =>
      interiors.map(() => {
        const mesh = new InstancedMesh(flapGeo, mats.flap, GATE_IDS.length * 2);
        mesh.frustumCulled = false;
        return mesh;
      }),
    [interiors, flapGeo, mats],
  );
  const stepRefs = useRef<(Mesh | null)[]>([]);
  const armRefs = useRef<(Mesh | null)[]>([]);
  const barrierRefs = useRef<(Mesh | null)[]>([]);
  const curtainRefs = useRef<(Mesh | null)[]>([]);
  const curtainGeo = useMemo(() => new BoxGeometry(0.04, CONCOURSE.security.enclosure.height, CONCOURSE.security.frameHalf * 2), []);
  const bagRef = useRef<Mesh>(null);
  const guardArms = useMemo(() => GUARD_SKIN.map((skin) => buildGuardArm(skin)), []);
  const bagGeo = useMemo(() => buildBag(), []);
  const screenGeo = useMemo(() => new PlaneGeometry(CONCOURSE.security.monitor.width, CONCOURSE.security.monitor.height), []);
  const marker = useRef<Group>(null);
  const markerGeo = useMemo(() => new OctahedronGeometry(0.2, 0), []);

  useEffect(
    () => () => {
      Object.values(interior).forEach((g) => g.dispose());
    },
    [interior],
  );
  useEffect(() => () => steps.geometry.dispose(), [steps]);
  useEffect(
    () => () => {
      guardArms.forEach((g) => g.dispose());
      bagGeo.dispose();
      screenGeo.dispose();
      curtainGeo.dispose();
    },
    [guardArms, bagGeo, screenGeo, curtainGeo],
  );
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
      flapGeo.dispose();
      markerGeo.dispose();
    },
    [mats, flapGeo, markerGeo],
  );
  useEffect(() => () => flapMeshes.forEach((m) => m.dispose()), [flapMeshes]);

  const layoutFlaps = (st: StationWalk, mesh: InstancedMesh) => {
    const C = CONCOURSE;
    const clear = (C.gate.pitch - C.gate.cabinetWidth) / 2;
    let i = 0;
    for (const kind of ["entry", "exit"] as const) {
      const gx = kind === "entry" ? C.island.x0 : C.island.x1;
      C.gate.lanes.forEach((zc, lane) => {
        const open = st.flaps.get(gateId(kind, lane)) ?? 0;
        const w = clear * (1 - 0.94 * open);
        for (const e of [-1, 1]) {
          tmp.m.compose(tmp.p.set(gx, plan.floorY + 0.62, zc + e * (clear - w / 2)), tmp.q.identity(), tmp.s.set(1, 1, w));
          mesh.setMatrixAt(i++, tmp.m.premultiply(st.matrix));
        }
      });
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  useEffect(() => {
    interiors.forEach((st, i) => layoutFlaps(st, flapMeshes[i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interiors, flapMeshes]);

  /* ---------------------------------------------------------------- */
  /* The passenger                                                     */
  /* ---------------------------------------------------------------- */

  const nearest = <T extends { x: number; z: number }>(points: readonly T[], x: number, z: number): { point: T; dist: number } | null => {
    let best: { point: T; dist: number } | null = null;
    for (const point of points) {
      const dist = Math.hypot(point.x - x, point.z - z);
      if (!best || dist < best.dist) best = { point, dist };
    }
    return best;
  };

  /** Station-local position of a car's platform-side door. */
  const doorAt = (st: StationWalk, k: number, dx: number, out: { x: number; z: number }) => {
    const f = carFrame(k, tmp.frame);
    toWorld(f, dx, cars[k].platformSide * (TRAIN.width / 2), tmp.a);
    return toLocal(st.frame, tmp.a.x, tmp.a.z, out);
  };

  const openGate = (st: StationWalk, id: string) => {
    st.timers.set(id, GATE_OPEN_S);
    st.open.add(id);
  };

  const use = (hud: WalkHud) => {
    const s = S.current;
    const trip = s.trip;
    if (!trip || !hud.prompt || s.where === "car") return;
    const st = stations[s.where];
    switch (hud.prompt.action) {
      case "counter":
        unlockWalkPointer();
        setWalkHud({ counterOpen: true });
        break;
      case "bag-drop":
        if (trip.dropBag()) {
          s.bagX = CONCOURSE.security.bagFrom;
          showWalkNotice("Your bag is on the belt. Go through a security lane and collect it at the far end.");
        }
        break;
      case "bag-collect":
        if (trip.collectBag()) {
          s.bagX = null;
          gateBeep(true);
          showWalkNotice("Bag collected. Scan your ticket at an entry gate.");
        }
        break;
      case "security":
        if (trip.stage === "security") {
          const lane = nearest(st.points.security, s.x, s.z)?.point.lane ?? 0;
          const G = CONCOURSE.security.lanes[lane].guard;
          s.scanning = SCAN_S;
          s.scanLane = lane;
          s.aim = { yaw: Math.atan2(G.z - s.z, G.x - s.x), pitch: -0.12 };
          showWalkNotice("Stand still for the scan.");
        } else {
          gateBeep(false);
          showWalkNotice(trip.stage === "buy-ticket" ? "Ticket first, please. The counter is behind you, in this hall." : "Your bag goes on the belt first. It's beside this lane, back through the detector.");
        }
        break;
      case "scan-in": {
        const lane = nearest(st.points.entryLanes, s.x, s.z);
        const result = trip.scanEntry();
        gateBeep(result === "ok");
        if (result === "ok" && lane) openGate(st, gateId("entry", lane.point.lane));
        break;
      }
      case "scan-out": {
        const lane = nearest(st.points.exitLanes, s.x, s.z);
        const result = trip.scanExit();
        gateBeep(result === "ok");
        if (result === "ok" && lane) openGate(st, gateId("exit", lane.point.lane));
        break;
      }
      case "drop-ticket":
        if (trip.dropTicket()) showWalkNotice("Ticket dropped in the box. Thank you.");
        break;
    }
  };

  useFrame((state, delta) => {
    const s = S.current;
    const isWalking = useViewStore.getState().cameraMode === "walk";
    const dt = Math.min(delta, 0.1);

    // Escalators run, and gate flaps settle, whether or not anyone is walking.
    s.escalator = (s.escalator + (dt * CONCOURSE.escalator.speed) / steps.tread) % 1;
    interiors.forEach((st, i) => {
      for (let k = 0; k < 4; k++) {
        const mesh = stepRefs.current[i * 4 + k];
        if (!mesh) continue;
        // k: 0, 1 = up and down on the left; 2, 3 on the right.
        const off = k % 2 === 0 ? s.escalator : 1 - s.escalator;
        mesh.position.x = plan.escalator.x0 + off * steps.tread;
        mesh.position.y = plan.floorY + off * steps.rise;
      }
      let moved = false;
      for (const id of GATE_IDS) {
        const cur = st.flaps.get(id) ?? 0;
        const target = st.open.has(id) ? 1 : 0;
        if (Math.abs(cur - target) < 1e-3) continue;
        const next = reducedMotion ? target : clamp(cur + Math.sign(target - cur) * dt * 3.2, 0, 1);
        st.flaps.set(id, next);
        moved = true;
      }
      if (moved) layoutFlaps(st, flapMeshes[i]);
      CONCOURSE.security.lanes.forEach((_, lane) => {
        const flap = barrierRefs.current[i * 2 + lane];
        if (flap) flap.visible = !st.open.has(securityBarrier(lane));
        const arm = armRefs.current[i * 2 + lane];
        if (arm) {
          const scanning = s.scanning > 0 && st === stations.origin && s.scanLane === lane;
          const pass = reducedMotion ? 0.5 : 0.5 - 0.5 * Math.cos(((SCAN_S - s.scanning) / SCAN_PASS_S) * Math.PI * 2);
          const target = scanning ? ARM_HIGH + (ARM_LOW - ARM_HIGH) * pass : ARM_REST;
          arm.rotation.x = reducedMotion ? target : damp(arm.rotation.x, target, 10, dt);
        }
      });
      // The enclosure stays shut: its curtains gather to one side only while the passenger is at them.
      const { enclosure, frameHalf, lanes } = CONCOURSE.security;
      const women = lanes[1];
      [enclosure.x0, enclosure.x1].forEach((x, d) => {
        const curtain = curtainRefs.current[i * 2 + d];
        if (!curtain) return;
        const here = isWalking && s.where !== "car" && stations[s.where] === st && Math.abs(s.y - plan.floorY) < 0.3;
        // Never during a scan: that is what the enclosure is for.
        const near = here && s.scanning === 0 && Math.abs(s.x - x) < CURTAIN_RANGE && Math.abs(s.z - women.frameZ) < frameHalf + 0.5;
        const target = near ? 0.08 : 1;
        const width = reducedMotion ? target : damp(curtain.scale.z, target, 12, dt);
        curtain.scale.z = width;
        curtain.position.z = women.frameZ + frameHalf * (1 - width);
      });
    });

    // The bag rides the belt whichever way the passenger is looking, and the operator's screen shows it from the machine on.
    const X = CONCOURSE.security;
    if (s.bagX !== null) s.bagX = Math.min(X.bagTo, s.bagX + X.belt.speed * dt);
    if (bagRef.current) {
      bagRef.current.visible = s.bagX !== null;
      if (s.bagX !== null) bagRef.current.position.x = s.bagX;
    }
    const screen = s.bagX !== null && s.bagX > X.machine.x0 ? screens.bag : screens.idle;
    if (mats.xray.map !== screen) mats.xray.map = screen;

    if (!isWalking) {
      if (s.wasWalking) {
        s.wasWalking = false;
        walkView.ready = false;
        engine.setHeld(false);
        setWalkHud({ active: false, prompt: null, counterOpen: false });
        if (marker.current) marker.current.visible = false;
      }
      return;
    }
    if (!s.wasWalking) {
      s.wasWalking = true;
      if (!s.trip) startTrip();
      // Back from another camera after the train left without us: catch it up.
      else if (s.trip.holdsTrain && engine.started && engine.clock.time > engine.trajectory.stops[0].closeStart) startTrip();
      useViewStore.getState().setSidebarOpen(false);
    }
    // "Ride again" after getting off (or after finishing) starts the whole trip over.
    if (s.trip!.reached("exit-gate") && engine.clock.time < s.lastClock - 2) startTrip();
    for (const r of takeWalkRequests()) {
      if (r === "restart") startTrip();
      else if (r === "buy-ticket" && s.trip!.buyTicket()) {
        gateBeep(true);
        setWalkHud({ counterOpen: false });
        showWalkNotice("Ticket bought. Put your bag on the X-ray belt at the security check.");
      }
    }
    const trip = s.trip!;
    if (s.scanning > 0) {
      s.scanning = Math.max(0, s.scanning - dt);
      if (s.scanning === 0 && trip.clearSecurity()) {
        stations.origin.open.add(securityBarrier(s.scanLane));
        gateBeep(true);
        showWalkNotice("All clear. Collect your bag at the end of the belt.");
      }
    }
    s.lastClock = engine.clock.time;
    engine.setHeld(trip.holdsTrain);
    const hud = getWalkHud();

    // Look.
    if (walkInput.turn !== 0 || walkInput.tilt !== 0) s.aim = null;
    else if (s.aim) {
      s.yaw = dampAngle(s.yaw, s.aim.yaw, 5, dt);
      s.pitch = damp(s.pitch, s.aim.pitch, 5, dt);
    }
    s.yaw += walkInput.turn;
    s.pitch = clamp(s.pitch + walkInput.tilt, -MAX_PITCH, MAX_PITCH);
    walkInput.turn = 0;
    walkInput.tilt = 0;

    // Move: wish velocity in the frame's axes, eased so starts and stops are not abrupt.
    let f = clamp(walkInput.forward + walkInput.stickForward, -1, 1);
    let r = clamp(walkInput.strafe + walkInput.stickStrafe, -1, 1);
    if (hud.counterOpen || s.scanning > 0) f = r = 0;
    const len = Math.hypot(f, r);
    if (len > 1) {
      f /= len;
      r /= len;
    }
    const speed = walkInput.run ? RUN_SPEED : WALK_SPEED;
    const cy = Math.cos(s.yaw);
    const sy = Math.sin(s.yaw);
    s.vx = damp(s.vx, (f * cy - r * sy) * speed, 12, dt);
    s.vz = damp(s.vz, (f * sy + r * cy) * speed, 12, dt);
    const dx = s.vx * dt;
    const dz = s.vz * dt;

    const trainStopped = engine.sample.v < 0.01 && pose.door > 0.85;
    const lastStop = engine.journey.stops.length - 1;

    if (s.where === "car") {
      const car = cars[s.car];
      const res = walk(car.space, s, dx, dz, 0) ?? { ...s, x: car.layout.doors[1], z: 0, y: car.layout.floorY, pad: car.space.pads[0], blocked: false };
      s.x = res.x;
      s.z = res.z;
      s.y = res.y;
      const atDestination = engine.sample.stopIndex === lastStop && (engine.sample.state === "doors-open" || engine.sample.state === "stopped");
      if (trip.stage === "riding" && atDestination && trainStopped) trip.arrive();
      else if (trip.stage === "alight" && !(atDestination && trainStopped)) trip.rideOn();
      // Step out through an open platform-side door at the destination.
      const dest = stations.destination;
      const reach = car.layout.innerHalf - 0.3;
      if (trip.stage === "alight" && res.pad.id.startsWith("vestibule") && dz * car.platformSide > 0 && s.z * car.platformSide > reach - 0.1) {
        const door = car.layout.doors[Number(res.pad.id.split("-")[1])];
        const at = doorAt(dest, s.car, door, tmp.b);
        const along = carFrame(s.car, tmp.frame).tx * dest.frame.tx + tmp.frame.tz * dest.frame.tz;
        const x = clamp(at.x + (s.x - door) * along, -plan.platformHalfLength + 0.5, plan.platformHalfLength - 0.5);
        const z = dest.side * (plan.platformEdge + 0.32);
        if (standAt(dest.space, x, z, plan.platformY, dest.open)) {
          transfer("destination", 0, x, z, plan.platformY);
          trip.alight();
        }
      }
    } else {
      const st = stations[s.where];
      // People waiting on the platforms are in the way, like anyone else.
      const crowd = platformCrowd.get(st.station.id) ?? null;
      if (crowd !== st.crowd) {
        st.crowd = crowd;
        st.space.obstacles = st.furniture.concat(
          (crowd ?? []).map((c) => {
            const l = toLocal(st.frame, c.x, c.z, tmp.a);
            return { x0: l.x - 0.2, x1: l.x + 0.2, z0: l.z - 0.2, z1: l.z + 0.2, y0: plan.platformY, y1: plan.platformY + 1.7 };
          }),
        );
      }
      const res = walk(st.space, s, dx, dz, dt, st.open);
      let pad: Pad | null = null;
      if (res) {
        // The detector chimes as the passenger steps through it on the way to the guard.
        const { frameX, frameHalf, lanes } = CONCOURSE.security;
        if (s.where === "origin" && trip.stage === "security" && Math.abs(s.y - plan.floorY) < 0.3 && s.x < frameX && res.x >= frameX && lanes.some((l) => Math.abs(s.z - l.frameZ) < frameHalf)) gateBeep(true);
        s.x = res.x;
        s.z = res.z;
        s.y = res.y;
        pad = res.pad;
      } else {
        // Off the map (should not happen): back to a known spot.
        const p = s.where === "origin" ? st.points.spawn : st.points.platform;
        s.x = p.x;
        s.z = p.z;
        s.y = p.y;
      }
      if (pad?.zone === "platform" && s.where === "origin") trip.reachPlatform();
      if (pad?.zone === "street" && s.where === "destination") trip.reachStreet();

      // Gate lanes close behind the passenger, or when the scan times out with nobody in them.
      for (const [id, left] of st.timers) {
        const b = st.space.barriers.find((x) => x.id === id)!;
        const inside = Math.abs(s.x - (b.x0 + b.x1) / 2) < 0.7 && s.z > b.z0 && s.z < b.z1;
        const through = s.x > b.x1 + 0.7 && Math.abs(s.z) < CONCOURSE.island.z;
        if (inside) continue;
        if (through || left - dt <= 0) {
          st.timers.delete(id);
          st.open.delete(id);
        } else st.timers.set(id, left - dt);
      }

      // Step aboard through an open door while the train waits at the origin.
      const boardable = s.where === "origin" && (trip.stage === "to-platform" || trip.stage === "board") && engine.sample.stopIndex === 0 && trainStopped;
      if (boardable && pad?.zone === "platform" && dz * st.side < 0 && Math.abs(s.z) < plan.platformEdge + 0.4) {
        let done = false;
        for (let k = 0; k < cars.length && !done; k++) {
          for (const door of cars[k].layout.doors) {
            const at = doorAt(st, k, door, tmp.b);
            if (Math.abs(s.x - at.x) > cars[k].layout.doorHalf - 0.1) continue;
            const along = carFrame(k, tmp.frame).tx * st.frame.tx + tmp.frame.tz * st.frame.tz;
            const half = cars[k].layout.doorHalf - 0.15;
            transfer("car", k, door + clamp((s.x - at.x) * along, -half, half), cars[k].platformSide * (cars[k].layout.innerHalf - 0.36), cars[k].layout.floorY);
            trip.board();
            engine.setHeld(false);
            engine.play();
            done = true;
            break;
          }
        }
      }
    }

    // What "use" would do here.
    let prompt: WalkHud["prompt"] = null;
    if (s.where !== "car" && !hud.counterOpen) {
      const st = stations[s.where];
      const onFloor = Math.abs(s.y - plan.floorY) < 0.3;
      if (onFloor && s.where === "origin") {
        const counter = nearest(st.points.counters, s.x, s.z);
        const lane = nearest(st.points.entryLanes, s.x, s.z);
        const S = CONCOURSE.security;
        const inLane = s.x > S.frameX && s.x < S.barrierX && s.z > S.lanes[0].z0 && s.z < S.penHalf;
        const near = (p: WalkPoint) => Math.hypot(p.x - s.x, p.z - s.z) < USE_RANGE;
        if (trip.stage === "buy-ticket" && counter && counter.dist < USE_RANGE) prompt = { action: "counter", label: "Buy a ticket" };
        // From either side of the belt: which side the passenger reaches it from depends on the platform.
        else if (trip.stage === "drop-bag" && Math.abs(s.x - S.bagFrom) < USE_RANGE && Math.abs(s.z - (S.belt.z0 + S.belt.z1) / 2) < USE_RANGE) prompt = { action: "bag-drop", label: "Put your bag on the belt" };
        else if (trip.stage === "collect-bag" && s.bagX === S.bagTo && near(st.points.bagCollect)) prompt = { action: "bag-collect", label: "Take your bag" };
        else if (inLane && !trip.reached("collect-bag")) {
          const spot = nearest(st.points.security, s.x, s.z);
          if (s.scanning === 0 && spot && spot.dist < USE_RANGE) prompt = { action: "security", label: "Stand for the body scan" };
        } else if (trip.stage === "enter-gate" && lane && lane.dist < USE_RANGE) prompt = { action: "scan-in", label: "Scan your ticket" };
      } else if (onFloor && s.where === "destination") {
        const lane = nearest(st.points.exitLanes, s.x, s.z);
        if (trip.stage === "exit-gate" && lane && lane.dist < USE_RANGE) prompt = { action: "scan-out", label: "Scan your ticket" };
        else if (trip.stage === "drop-ticket" && Math.hypot(st.points.ticketBox.x - s.x, st.points.ticketBox.z - s.z) < USE_RANGE + 0.2) prompt = { action: "drop-ticket", label: "Drop your used ticket" };
      }
    }
    if (walkInput.interact) {
      walkInput.interact = false;
      if (prompt) use({ ...hud, prompt });
    }

    // The eye, in the world.
    const fr = frameOf(s.where, s.car);
    const moving = Math.hypot(s.vx, s.vz);
    s.stride += moving * dt;
    const bob = reducedMotion ? 0 : Math.sin(s.stride * 3.3) * 0.022 * Math.min(1, moving / WALK_SPEED);
    if (s.where === "car") {
      // Ride with the car, including its pitch on ramps.
      const car = pose.cars[s.car];
      tmp.v.set(s.x, s.y + EYE + bob, s.z).applyQuaternion(car.quaternion).add(car.position);
      walkView.x = tmp.v.x;
      walkView.y = tmp.v.y;
      walkView.z = tmp.v.z;
    } else {
      toWorld(fr, s.x, s.z, tmp.a);
      walkView.x = tmp.a.x;
      walkView.y = s.y + EYE + bob;
      walkView.z = tmp.a.z;
    }
    const cp = Math.cos(s.pitch);
    walkView.dx = (fr.tx * cy - fr.tz * sy) * cp;
    walkView.dz = (fr.tz * cy + fr.tx * sy) * cp;
    walkView.dy = Math.sin(s.pitch);
    walkView.ready = true;

    // Waypoint: where to head next.
    let target: WalkPoint | null = null;
    let targetFrame: Frame | null = null;
    if (s.where !== "car") {
      const st = stations[s.where];
      const up = s.y > plan.floorY + 1.5;
      const pts = st.points;
      switch (trip.target) {
        case "counter":
          target = nearest(pts.counters, s.x, s.z)?.point ?? null;
          break;
        case "bag-drop":
          target = pts.bagDrop;
          break;
        case "security":
          target = nearest(pts.security, s.x, s.z)?.point ?? null;
          break;
        case "bag-collect":
          target = pts.bagCollect;
          break;
        case "entry-gate":
          target = nearest(pts.entryLanes, s.x, s.z)?.point ?? null;
          break;
        case "platform":
          target = up ? pts.platform : pts.escalatorFoot;
          break;
        case "train": {
          const at = doorAt(st, 1, cars[1].layout.doors[1], tmp.b);
          target = { x: at.x, z: st.side * (plan.platformEdge + 0.4), y: plan.platformY };
          break;
        }
        case "exit-gate":
          target = up ? pts.escalatorHead : (nearest(pts.exitLanes, s.x, s.z)?.point ?? null);
          break;
        case "ticket-box":
          target = pts.ticketBox;
          break;
        case "street":
          target = pts.street;
          break;
      }
      targetFrame = st.frame;
    }
    s.target = target;
    let distance: number | null = null;
    if (marker.current) {
      marker.current.visible = false;
      if (target && targetFrame) {
        toWorld(targetFrame, target.x, target.z, tmp.a);
        const dist = Math.hypot(tmp.a.x - walkView.x, tmp.a.z - walkView.z, target.y + 1.3 - walkView.y);
        distance = Math.round(Math.hypot(target.x - s.x, target.z - s.z));
        // Up close the thing itself is in view (and the prompt says what to do).
        marker.current.visible = dist > 2.4;
        marker.current.position.set(tmp.a.x, target.y + 1.35 + (reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 2.4) * 0.08), tmp.a.z);
        marker.current.rotation.y = reducedMotion ? 0 : state.clock.elapsedTime * 1.4;
        // Keep it readable from far away without it looming up close.
        marker.current.scale.setScalar(clamp(dist / 9, 0.8, 5));
      }
    }

    setWalkHud({
      active: true,
      stage: trip.stage,
      objective: tripObjective(trip.stage, { from: journey.from.name, to: journey.to.name }),
      hasTicket: trip.hasTicket,
      ticketDropped: trip.ticketDropped,
      aboard: s.where === "car",
      startedAboard: trip.startedAboard,
      prompt,
      distance,
    });
  }, -0.5);

  return (
    <group>
      {interiorMeshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      {flapMeshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      {interiors.map((st, i) => (
        <group key={st.station.id} matrix={st.matrix} matrixAutoUpdate={false}>
          {CONCOURSE.security.lanes.map((lane, l) => (
            <group key={lane.id}>
              <group position={[lane.guard.x, plan.floorY, lane.guard.z]} rotation={[0, Math.PI, 0]}>
                <mesh
                  ref={(mesh) => {
                    armRefs.current[i * 2 + l] = mesh;
                  }}
                  geometry={guardArms[l]}
                  material={mats.solid}
                  position={[GUARD_SHOULDER[l].x, GUARD_SHOULDER[l].y, GUARD_SHOULDER[l].z]}
                  rotation={[ARM_REST, 0, 0]}
                />
              </group>
              <mesh
                ref={(mesh) => {
                  barrierRefs.current[i * 2 + l] = mesh;
                }}
                geometry={flapGeo}
                material={mats.flap}
                position={[CONCOURSE.security.barrierX, plan.floorY + 0.62, (lane.z0 + lane.z1) / 2]}
                scale={[1, 1, lane.z1 - lane.z0]}
              />
            </group>
          ))}
          {[CONCOURSE.security.enclosure.x0, CONCOURSE.security.enclosure.x1].map((x, d) => (
            <mesh
              key={x}
              ref={(mesh) => {
                curtainRefs.current[i * 2 + d] = mesh;
              }}
              geometry={curtainGeo}
              material={mats.curtain}
              position={[x, plan.floorY + CONCOURSE.security.enclosure.height / 2, CONCOURSE.security.lanes[1].frameZ]}
            />
          ))}
          <mesh
            geometry={screenGeo}
            material={mats.xray}
            position={[CONCOURSE.security.monitor.x, plan.floorY + CONCOURSE.security.desk.height + CONCOURSE.security.monitor.stand + CONCOURSE.security.monitor.height / 2, CONCOURSE.security.monitor.z]}
            rotation={[0, Math.PI / 4, 0]}
          />
          {st === stations.origin && <mesh ref={bagRef} geometry={bagGeo} material={mats.solid} position={[CONCOURSE.security.bagFrom, plan.floorY + CONCOURSE.security.belt.top, (CONCOURSE.security.belt.z0 + CONCOURSE.security.belt.z1) / 2]} visible={false} />}
          {([-1, 1] as const).flatMap((side, a) =>
            [CONCOURSE.escalator.up, CONCOURSE.escalator.down].map((lane, b) => (
              <mesh
                key={`${side}${b}`}
                ref={(mesh) => {
                  stepRefs.current[i * 4 + a * 2 + b] = mesh;
                }}
                geometry={steps.geometry}
                material={mats.solid}
                position={[plan.escalator.x0, plan.floorY, (side * (lane[0] + lane[1])) / 2]}
              />
            )),
          )}
        </group>
      ))}
      <group ref={marker} visible={false} renderOrder={10}>
        <mesh geometry={markerGeo} material={mats.marker} renderOrder={10} />
        <mesh geometry={markerGeo} material={mats.marker} position={[0, -0.42, 0]} scale={[0.35, 0.9, 0.35]} renderOrder={10} />
      </group>
    </group>
  );
}
