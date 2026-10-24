import assert from "node:assert/strict";
import { test } from "node:test";
import type { PatientState } from "@/lib/types";
import { Bus } from "./bus";

const patient: PatientState = { householdId: "h1", mode: "glow", updatedAt: new Date().toISOString() };

test("a guard returning false drops the event", () => {
  const bus = new Bus();
  let heard = 0;
  bus.on("patient", () => heard++);
  bus.guard((event) => event !== "patient");
  assert.equal(bus.emit("patient", patient), false);
  assert.equal(heard, 0);
});

test("a throwing listener does not stop the others", () => {
  const bus = new Bus();
  let heard = 0;
  bus.on("patient", () => {
    throw new Error("boom");
  });
  bus.on("patient", () => heard++);
  assert.equal(bus.emit("patient", patient), true);
  assert.equal(heard, 1);
});
