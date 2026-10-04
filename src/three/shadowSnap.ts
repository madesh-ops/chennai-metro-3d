import { Vector3 } from "three";

/**
 * Keeps a following sun shadow steady. The shadow camera follows the train;
 * moving it by fractions of a shadow-map texel every frame makes every
 * shadow edge re-sample differently, so shadows shimmer and crawl. Snapping
 * the centre to whole texels in the light's view (the plane facing the sun)
 * moves the map in exact texel steps, so static shadows stay put.
 *
 * `dir` points from the scene towards the sun (light position − target).
 * The basis matches three.js's shadow camera (lookAt with +y up).
 */
const _z = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const UP = new Vector3(0, 1, 0);

export function snapShadowCentre(centre: Vector3, dir: Vector3, texel: number, out = new Vector3()): Vector3 {
  _z.copy(dir).normalize();
  _x.crossVectors(UP, _z);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0); // sun straight overhead
  _x.normalize();
  _y.crossVectors(_z, _x);
  const px = Math.round(centre.dot(_x) / texel) * texel;
  const py = Math.round(centre.dot(_y) / texel) * texel;
  const pz = centre.dot(_z);
  return out.copy(_x).multiplyScalar(px).addScaledVector(_y, py).addScaledVector(_z, pz);
}
