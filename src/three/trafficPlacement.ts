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
    if (v.lane < FLYOVER_LANES) {
      for (const f of route.flyovers) {
        if (v.s >= f.corridorFrom && v.s <= f.road.junctionD) {
          h = f.corridorHeightAt(v.s);
          grade = (f.corridorHeightAt(v.s + 1) - f.corridorHeightAt(v.s - 1)) / 2;
        } else if (v.s > f.road.junctionD && v.s <= f.corridorTo + 8) {
          // The deck veers away along Mount–Poonamallee Road here; through traffic is on it.
          visible = false;
        }
      }
    }
    // Where the flyover veers across the outer lane just past the junction, at-grade traffic
    // there would be inside its deck (vehicles riding the deck have h > 0 and are left alone).
    if (visible && h === 0) {
      for (const f of route.flyovers) {
        if (v.s < f.road.junctionD - 10 || v.s > f.corridorTo + 80) continue;
        const road = f.road.alignment;
        const s = road.project(pt.x, pt.z, f.road.junctionS + (v.s - f.road.junctionD), 150);
        if (s <= f.startS || s >= f.endS || f.heightAt(s) < 0.2) continue;
        const q = road.point(s);
        if (Math.hypot(pt.x - q.x, pt.z - q.z) < f.halfWidth + 1.3) visible = false;
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
