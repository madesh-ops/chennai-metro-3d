import { test } from "node:test";
import assert from "node:assert/strict";
import { Box3 } from "three";
import { CROWD_VARIANTS, humanTemplate, paintHuman, PART } from "./humanModel.ts";
import { PEOPLE_VARIANTS } from "./cityGen.ts";

test("standing people are about 1.6–1.8 m tall with feet on the ground", () => {
  for (const outfit of ["shirt", "tshirt", "veshti", "saree", "kurta"] as const) {
    const box = new Box3().setFromBufferAttribute(humanTemplate({ outfit, pose: "stand" }).getAttribute("position") as never);
    assert.ok(box.min.y > -0.02 && box.min.y < 0.02, `${outfit} feet at ${box.min.y}`);
    assert.ok(box.max.y > 1.6 && box.max.y < 1.8, `${outfit} height ${box.max.y}`);
    assert.ok(box.max.x - box.min.x < 0.62, `${outfit} width`);
  }
});

test("seated people reach the floor (0.47 m below the seat) and stay in front of the backrest", () => {
  const box = new Box3().setFromBufferAttribute(humanTemplate({ outfit: "shirt", pose: "sit" }).getAttribute("position") as never);
  assert.ok(box.min.y < -0.4 && box.min.y > -0.5, `feet at ${box.min.y}`);
  assert.ok(box.max.y > 0.8 && box.max.y < 0.95, `head at ${box.max.y}`);
  assert.ok(box.min.z > -0.2, `back at ${box.min.z}`);
});

test("a strap-holder's hand reaches up to the grab rail", () => {
  const box = new Box3().setFromBufferAttribute(humanTemplate({ outfit: "tshirt", pose: "strap" }).getAttribute("position") as never);
  assert.ok(box.max.y > 1.75 && box.max.y < 1.92, `hand at ${box.max.y}`);
});

test("painting replaces part ids with colours", () => {
  const t = humanTemplate({ outfit: "saree", pose: "stand", jasmine: true });
  const ids = t.getAttribute("aPart");
  const seen = new Set<number>();
  for (let i = 0; i < ids.count; i++) seen.add(ids.getX(i));
  for (const p of [PART.skin, PART.top, PART.bottom, PART.hair, PART.shoe, PART.accent, PART.light]) assert.ok(seen.has(p), `part ${p}`);
  const g = paintHuman(t, { skin: "#8d5524", top: "#c2185b", bottom: "#c2185b" });
  assert.equal(g.getAttribute("aPart"), undefined);
  assert.equal(g.getAttribute("color").count, ids.count);
});

test("city pedestrians use every crowd variant", () => {
  assert.equal(PEOPLE_VARIANTS, CROWD_VARIANTS.length);
});
