import { test } from "node:test";
import assert from "node:assert/strict";
import { Box3, Color, type BufferGeometry } from "three";
import { buildCar, DRIVER_EYE, LIVERY, NOSE_TIP } from "./trainModel.ts";
import { buildNose, faceX } from "./trainNose.ts";
import { TRAIN } from "./layout.ts";

const bounds = (g: BufferGeometry) => new Box3().setFromBufferAttribute(g.getAttribute("position") as never);
const dmc = buildCar("DMC");
const tc = buildCar("TC");
const HALF = TRAIN.carLength / 2;

test("cars fit the published width and stay under the roof units", () => {
  for (const car of [dmc, tc]) {
    for (const g of [car.body, car.nose].filter(Boolean) as BufferGeometry[]) {
      const b = bounds(g);
      assert.ok(b.max.z <= TRAIN.width / 2 + 0.01 && b.min.z >= -TRAIN.width / 2 - 0.01, `width ${b.min.z}..${b.max.z}`);
      assert.ok(b.max.y <= TRAIN.roof + 0.01, `height ${b.max.y}`);
    }
    // Window surrounds stand only a little proud of the side.
    assert.ok(bounds(car.dark).max.z < TRAIN.width / 2 + 0.02);
  }
});

test("the cab shell ends at NOSE_TIP and the coupler just beyond it", () => {
  const shell = dmc.nose!;
  const pos = shell.getAttribute("position");
  let maxShell = -Infinity;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 1.14) maxShell = Math.max(maxShell, pos.getX(i));
  assert.ok(Math.abs(maxShell - NOSE_TIP) < 0.03, `shell tip ${maxShell} vs ${NOSE_TIP}`);
  assert.ok(NOSE_TIP > HALF - 0.1 && NOSE_TIP < HALF + 0.3, `nose tip ${NOSE_TIP}`);
});

test("the driver sits inside the cab, behind the windscreen", () => {
  const glass = bounds(dmc.windshield!);
  const xFront = HALF - 2.3;
  assert.ok(DRIVER_EYE.x < xFront + faceX(DRIVER_EYE.y, DRIVER_EYE.z) - 0.5, "eye behind the face");
  assert.ok(DRIVER_EYE.y > glass.min.y && DRIVER_EYE.y < glass.max.y, `eye ${DRIVER_EYE.y} within glass ${glass.min.y}..${glass.max.y}`);
  assert.ok(Math.abs(DRIVER_EYE.z) < glass.max.z, "eye within the windscreen width");
});

test("the shell faces outward", () => {
  const g = dmc.nose!;
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  let wrong = 0;
  let face = 0;
  for (let i = 0; i < pos.count; i++) {
    // Front-facing part of the blue face, away from the edges.
    if (Math.abs(pos.getZ(i)) < 0.5 && pos.getY(i) > 1.3 && pos.getY(i) < 3.2) {
      face++;
      if (nor.getX(i) < 0.5) wrong++;
    }
  }
  assert.ok(face > 50);
  assert.equal(wrong, 0);
});

test("outside of the sides is stainless, the saloon lining stays light", () => {
  const pos = tc.body.getAttribute("position");
  const nor = tc.body.getAttribute("normal");
  const col = tc.body.getAttribute("color");
  const side = new Color(LIVERY.side);
  const blue = new Color(LIVERY.blue);
  const lining = new Color(LIVERY.lining);
  const c = new Color();
  let out = 0;
  let inside = 0;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const nz = nor.getZ(i);
    const y = pos.getY(i);
    if (y < 1.0 || y > 3.15 || Math.abs(nz) < 0.9) continue;
    c.fromBufferAttribute(col, i);
    if (Math.abs(z) > TRAIN.width / 2 - 0.001 && nz * z > 0) {
      out++;
      assert.ok([side.getHexString(), blue.getHexString()].includes(c.getHexString()), `outside at y ${y}`);
    } else if (Math.abs(z) < TRAIN.width / 2 - 0.06 && Math.abs(z) > 1.3 && nz * z < 0) {
      inside++;
      assert.equal(c.getHexString(), lining.getHexString(), `inside at y ${y}`);
    }
  }
  assert.ok(out > 20 && inside > 20, `${out} outside, ${inside} inside`);
});

test("the cab interior frame stays inside the nose shell", () => {
  const x0 = HALF - 2.3;
  const { frame } = buildNose(x0);
  const pos = frame.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) - x0;
    const y = pos.getY(i);
    const z = pos.getZ(i);
    assert.ok(x < faceX(y, z) - 0.02, `frame vertex at y ${y.toFixed(2)} z ${z.toFixed(2)} pokes out (${x.toFixed(3)} vs ${faceX(y, z).toFixed(3)})`);
  }
});

test("the roof band is one colour along the whole car (no diagonal split)", () => {
  for (const car of [dmc, tc]) {
    const pos = car.body.getAttribute("position");
    const nor = car.body.getAttribute("normal");
    const col = car.body.getAttribute("color");
    const blue = new Color(LIVERY.blue).getHexString();
    const roof = new Color(LIVERY.roof).getHexString();
    const c = new Color();
    for (let i = 0; i < pos.count; i += 3) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < 3; k++) {
        lo = Math.min(lo, pos.getY(i + k));
        hi = Math.max(hi, pos.getY(i + k));
      }
      // Outer roof strips only (not end caps, not the ceiling side).
      if (lo < 3.18 || nor.getY(i) < 0 || Math.abs(nor.getX(i)) > 0.5) continue;
      c.fromBufferAttribute(col, i);
      assert.equal(c.getHexString(), hi <= 3.701 ? blue : roof, `roof strip ${lo.toFixed(2)}–${hi.toFixed(2)}`);
    }
  }
});

test("no roof face lies on the outer side wall below the band (z-fighting)", () => {
  for (const car of [dmc, tc]) {
    const pos = car.body.getAttribute("position");
    const nor = car.body.getAttribute("normal");
    // Side panels own the outer face up to BAND_TOP (3.28); nothing else may share it.
    let roofOnWall = 0;
    for (let i = 0; i < pos.count; i += 3) {
      let lo = Infinity;
      let onWall = true;
      for (let k = 0; k < 3; k++) {
        lo = Math.min(lo, pos.getY(i + k));
        if (Math.abs(Math.abs(pos.getZ(i + k)) - TRAIN.width / 2) > 1e-4) onWall = false;
      }
      if (onWall && lo >= 3.18 - 1e-3 && Math.abs(nor.getZ(i)) > 0.9) roofOnWall++;
    }
    assert.equal(roofOnWall, 0);
  }
});
