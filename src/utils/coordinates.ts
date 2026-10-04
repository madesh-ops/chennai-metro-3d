/**
 * Geographic helpers. The 3D world uses metres in a local tangent plane:
 * +x = east, -z = north, +y = up. An equirectangular projection is accurate
 * to well under a metre across the ~15 km extent of the route.
 */
export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

export function haversineMetres(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export interface LocalProjection {
  origin: LatLon;
  /** Returns [x, z] in metres. */
  toLocal(p: LatLon): [number, number];
  toLatLon(x: number, z: number): LatLon;
}

export function createProjection(origin: LatLon): LocalProjection {
  const kx = Math.cos(origin.lat * DEG) * EARTH_RADIUS_M * DEG;
  const kz = EARTH_RADIUS_M * DEG;
  return {
    origin,
    toLocal(p) {
      return [(p.lon - origin.lon) * kx, -(p.lat - origin.lat) * kz];
    },
    toLatLon(x, z) {
      return { lat: origin.lat - z / kz, lon: origin.lon + x / kx };
    },
  };
}

export function centroid(points: LatLon[]): LatLon {
  let lat = 0;
  let lon = 0;
  for (const p of points) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / points.length, lon: lon / points.length };
}
