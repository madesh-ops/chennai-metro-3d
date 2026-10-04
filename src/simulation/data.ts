import stations from "../data/stations.json";
import routes from "../data/routes.json";
import tracks from "../data/tracks.json";
import landmarks from "../data/landmarks.json";
import { buildRouteModel, type RouteModel } from "./RouteController.ts";
import type { DataBundle } from "./types.ts";

export const dataBundle = { stations, routes, tracks, landmarks } as unknown as DataBundle;

let cached: RouteModel | null = null;

/** The route model is pure data + maths, so it is built once per page load. */
export function getRouteModel(): RouteModel {
  if (!cached) cached = buildRouteModel(dataBundle);
  return cached;
}
