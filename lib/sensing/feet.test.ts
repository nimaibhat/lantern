import assert from "node:assert/strict";
import { test } from "node:test";
import { roughFeet } from "./feet";

test("minus 50 dBm is about 3 feet", () => {
  assert.equal(Math.round(roughFeet(-50)), 3);
});

test("a stronger signal is closer, and a weak one stops at 45 feet", () => {
  assert.ok(roughFeet(-40) < roughFeet(-50));
  assert.equal(roughFeet(-90), 45);
  assert.equal(roughFeet(-20), 0.5);
});
