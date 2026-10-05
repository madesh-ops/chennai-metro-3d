import stations from "../data/stations.json";
import routes from "../data/routes.json";
import tracks from "../data/tracks.json";
import landmarks from "../data/landmarks.json";
import network from "../data/network.json";
import { buildRouteModel, type RouteModel } from "./RouteController.ts";
import type { DataBundle } from "./types.ts";

export const dataBundle = { stations, routes, tracks, landmarks, network } as unknown as DataBundle;

const cache = new Map<string, RouteModel>();

/** The default route (the one people ride today). */
export const DEFAULT_ROUTE_ID = (routes as { routes: { id: string }[] }).routes[0].id;

/** Route models are pure data + maths, so each is built once per page load. */
export function getRouteModel(routeId: string = DEFAULT_ROUTE_ID): RouteModel {
  let m = cache.get(routeId);
  if (!m) {
    m = buildRouteModel(dataBundle, routeId);
    cache.set(routeId, m);
  }
  return m;
}
