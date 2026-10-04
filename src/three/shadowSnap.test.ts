import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { snapShadowCentre } from "./shadowSnap.ts";

const sun = new Vector3(0.45, 0.8, -0.4).normalize();
const texel = 150 / 2048;

test("small moves of the train leave the shadow map exactly still", () => {
  // Only the position across the sun's view matters (the shadow camera is orthographic along it).
  const z = sun.clone();
  const x = new Vector3().crossVectors(new Vector3(0, 1, 0), z).normalize();
  const y = new Vector3().crossVectors(z, x);
  const a = snapShadowCentre(new Vector3(100, 18, 200), sun, texel);
  let still = 0;
  for (let i = 1; i <= 50; i++) {
    const b = snapShadowCentre(new Vector3(100 + i * 0.0002, 18, 200), sun, texel);
    if (Math.abs(b.dot(x) - a.dot(x)) < 1e-9 && Math.abs(b.dot(y) - a.dot(y)) < 1e-9) still++;
  }
  assert.ok(still >= 45, `${still} of 50 millimetre moves left the map still`);
});

test("the snapped centre moves only in whole texel steps across the sun's view", () => {
  const z = sun.clone();
  const x = new Vector3().crossVectors(new Vector3(0, 1, 0), z).normalize();
  const y = new Vector3().crossVectors(z, x);
  for (let i = 0; i < 200; i++) {
    const c = new Vector3(37.3 + i * 0.731, 18 + (i % 7) * 0.13, -512.9 + i * 1.37);
    const s = snapShadowCentre(c, sun, texel);
    const fx = s.dot(x) / texel;
    const fy = s.dot(y) / texel;
    assert.ok(Math.abs(fx - Math.round(fx)) < 1e-6 && Math.abs(fy - Math.round(fy)) < 1e-6, "on the texel grid");
    // Along the sun direction nothing changes, and it never strays more than half a texel diagonal.
    assert.ok(Math.abs(s.dot(z) - c.dot(z)) < 1e-9);
    assert.ok(s.distanceTo(c) <= texel * Math.SQRT1_2 + 1e-9);
  }
});

test("works with the sun straight overhead", () => {
  const s = snapShadowCentre(new Vector3(10.03, 5, 7.01), new Vector3(0, 1, 0), 0.5);
  assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
  assert.equal(s.y, 5);
});
