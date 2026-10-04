import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOK_LIMITS, clampFov, clampPitch, clampYaw, dragLook, passengerLook, requestRecentre, setPassengerSpot, settleLook, zoomLook } from "./passengerLook.ts";

test("look-around is clamped to its limits", () => {
  assert.equal(clampYaw(10), LOOK_LIMITS.maxYaw);
  assert.equal(clampYaw(-10), -LOOK_LIMITS.maxYaw);
  assert.equal(clampPitch(5), LOOK_LIMITS.maxPitch);
  assert.equal(clampPitch(-5), -LOOK_LIMITS.maxPitch);
  assert.equal(clampFov(10), LOOK_LIMITS.minFov);
  assert.equal(clampFov(200), LOOK_LIMITS.maxFov);
  for (let i = 0; i < 50; i++) dragLook(400, -400, 700);
  assert.ok(Math.abs(passengerLook.yaw) <= LOOK_LIMITS.maxYaw + 1e-9);
  assert.ok(Math.abs(passengerLook.pitch) <= LOOK_LIMITS.maxPitch + 1e-9);
  for (let i = 0; i < 50; i++) zoomLook(10);
  assert.equal(passengerLook.fov, LOOK_LIMITS.maxFov);
});

test("the view eases back to rest after idle, and snaps under reduced motion", () => {
  passengerLook.yaw = 1;
  passengerLook.pitch = 0.5;
  passengerLook.lastInput = 1000;
  // Not idle yet: nothing moves.
  settleLook(0.1, 1000 + 2000, false);
  assert.equal(passengerLook.yaw, 1);
  // Idle: eases towards zero.
  for (let i = 0; i < 200; i++) settleLook(1 / 60, 1000 + 7000 + i * 16, false);
  assert.equal(passengerLook.yaw, 0);
  assert.equal(passengerLook.pitch, 0);
  passengerLook.yaw = 0.8;
  requestRecentre();
  settleLook(1 / 60, 1000 + 2000, true);
  assert.equal(passengerLook.yaw, 0);
  assert.equal(passengerLook.fov, LOOK_LIMITS.defaultFov);
});

test("changing spot resets the look", () => {
  passengerLook.yaw = 0.7;
  setPassengerSpot("doors");
  assert.equal(passengerLook.spot, "doors");
  assert.equal(passengerLook.yaw, 0);
  setPassengerSpot("window");
});
