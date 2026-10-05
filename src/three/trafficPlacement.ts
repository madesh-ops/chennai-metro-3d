import type { RouteModel } from "../simulation/RouteController.ts";
import type { TrafficVehicle } from "./SceneContext.tsx";
import { ROAD } from "./layout.ts";

/** Lanes (from the median) that carry through traffic over a flyover. */
export const FLYOVER_LANES = 2;
/** m/s per lane, kerbside lane slowest. */
export const LANE_SPEED = [12.5, 10.5, 7.8];

export interface VehiclePlacement {
  x: number;
  y: number;
  z: number;
  /** Heading (radians, three.js yaw for a +x-forward model), including travel direction. */
  yaw: number;
  /** Nose-up angle on a ramp. */
  pitch: number;
  /** Unit direction of travel. */
  fx: number;
  fz: number;
  visible: boolean;
}

export const createPlacement = (): VehiclePlacement => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fx: 1, fz: 0, visible: true });

const pt = { x: 0, z: 0 };

/**
 * Where a road vehicle is. Corridor vehicles follow the main alignment; the
 * inner two lanes climb the MGR flyover's western half (where it lies in the
 * corridor road, beneath the metro) and are hidden where it veers off along
 * Mount–Poonamallee Road. Side-road vehicles follow their own road and ride
 * over that road's flyover.
 */
export function placeVehicle(route: RouteModel, v: TrafficVehicle, range: [number, number], out: VehiclePlacement): VehiclePlacement {
  const lateral = -v.dir * ROAD.laneCentres[v.lane];
  let h = 0;
  let grade = 0;
  let visible = true;
  let yaw: number;
  if (v.road) {
    const road = route.sideRoads.get(v.road);
    if (!road) {
      out.visible = false;
      return out;
    }
    road.alignment.offsetPoint(v.s, lateral, pt);
    yaw = road.alignment.heading(v.s);
    if (v.lane < FLYOVER_LANES) {
      for (const f of route.flyovers) {
        if (f.road !== road || v.s <= f.startS || v.s >= f.endS) continue;
        h = f.heightAt(v.s);
        grade = (f.heightAt(v.s + 1) - f.heightAt(v.s - 1)) / 2;
      }
    }
    visible = road.junctionD >= range[0] - 400 && road.junctionD <= range[1] + 400;
  } else {
    route.alignment.offsetPoint(v.s, lateral, pt);
    yaw = route.alignment.heading(v.s);
    // Near a flyover, find the deck point under/over this vehicle. Inner lanes before the
    // junction ride up onto it (through traffic); anything else that would sit inside the deck
    // is hidden (the deck veers across the outer lanes or away along its own road).
    for (const f of route.flyovers) {
      if (v.s < f.corridorFrom - 10 || v.s > f.corridorTo + 80) continue;
      const road = f.road.alignment;
      const s = road.project(pt.x, pt.z, f.road.junctionS + (v.s - f.road.junctionD), 400);
      if (s <= f.startS || s >= f.endS) continue;
      const deck = f.heightAt(s);
      const q = road.point(s);
      const onDeck = Math.hypot(pt.x - q.x, pt.z - q.z) < f.halfWidth + 1.3;
      if (!onDeck || deck < 0.2) continue;
      if (v.lane < FLYOVER_LANES && v.s <= f.road.junctionD) {
        h = deck;
        grade = (f.heightAt(s + 1) - f.heightAt(s - 1)) / 2;
      } else {
        visible = false;
      }
    }
    // The road ends with the scenery.
    if (v.s < range[0] || v.s > range[1]) visible = false;
  }
  if (v.dir < 0) yaw += Math.PI;
  out.x = pt.x;
  out.z = pt.z;
  out.y = 0.03 + h;
  out.yaw = yaw;
  out.pitch = Math.atan(v.dir * grade);
  out.fx = Math.cos(yaw);
  out.fz = -Math.sin(yaw);
  out.visible = visible;
  return out;
}
