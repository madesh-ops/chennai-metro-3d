"use client";

import { createContext, useContext } from "react";
import { Quaternion, Vector3 } from "three";
import type { RouteModel } from "../simulation/RouteController.ts";
import type { SceneEnv } from "./env.ts";
import type { Quality } from "../simulation/store.ts";

/** Train pose recomputed once per frame and read by the train, cameras and traffic. */
export interface TrainPose {
  /** Alignment distance of the train centre. */
  centerDistance: number;
  /** +1 / -1 travel direction relative to alignment distance. */
  direction: 1 | -1;
  /** Signed lateral offset of the running track (metres, right-positive). */
  lateral: number;
  speed: number;
  door: number;
  center: Vector3;
  head: Vector3;
  forward: Vector3;
  cars: { position: Vector3; quaternion: Quaternion; yaw: number }[];
  /** Total wheel rotation angle (radians). */
  wheelAngle: number;
}

export function createTrainPose(cars: number): TrainPose {
  return {
    centerDistance: 0,
    direction: 1,
    lateral: -2.1,
    speed: 0,
    door: 0,
    center: new Vector3(),
    head: new Vector3(),
    forward: new Vector3(1, 0, 0),
    cars: Array.from({ length: cars }, () => ({ position: new Vector3(), quaternion: new Quaternion(), yaw: 0 })),
    wheelAngle: 0,
  };
}

export type VehicleKind = "car" | "bus" | "auto" | "bike";

/** One simulated road vehicle (moved by Traffic, listened to by TrafficAudio). */
export interface TrafficVehicle {
  kind: VehicleKind;
  /** Instance index within its kind's mesh. */
  index: number;
  /** Alignment distance. */
  s: number;
  lane: number;
  /** +1 travels towards increasing distance. */
  dir: 1 | -1;
  /** Side road it drives on (s is then that road's distance); main corridor if absent. */
  road?: string;
}

/** Live road traffic, shared without React re-renders (like the train pose). */
export interface TrafficState {
  vehicles: TrafficVehicle[];
}

export const createTrafficState = (): TrafficState => ({ vehicles: [] });

export interface SceneContextValue {
  route: RouteModel;
  env: SceneEnv;
  pose: TrainPose;
  traffic: TrafficState;
  quality: Quality;
  /** Alignment range the scenery is generated for. */
  range: [number, number];
  /** Called by heavy components to report loading progress (0..1). */
  reportProgress?: (key: "environment" | "train", value: number) => void;
}

export const SceneContext = createContext<SceneContextValue | null>(null);

export function useScene(): SceneContextValue {
  const ctx = useContext(SceneContext);
  if (!ctx) throw new Error("useScene must be used inside <SceneContext.Provider>");
  return ctx;
}
