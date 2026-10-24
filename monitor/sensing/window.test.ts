import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RssiWindow } from "./window";

describe("RssiWindow", () => {
  const order = ["a", "b", "c"];

  it("returns -100 with no data", () => {
    const w = new RssiWindow(order);
    assert.deepEqual(w.vector(1000), [-100, -100, -100]);
  });

  it("returns -100 with fewer than minSamples", () => {
    const w = new RssiWindow(order, 3000, 2);
    w.push({ receiverId: "a", rssi: -50, ts: 900 });
    assert.deepEqual(w.vector(1000), [-100, -100, -100]);
  });

  it("computes median with odd number of samples", () => {
    const w = new RssiWindow(order, 5000, 1);
    w.push({ receiverId: "a", rssi: -60, ts: 100 });
    w.push({ receiverId: "a", rssi: -50, ts: 200 });
    w.push({ receiverId: "a", rssi: -70, ts: 300 });
    // sorted: -70, -60, -50 -> median -60
    assert.equal(w.vector(400)[0], -60);
  });

  it("computes median with even number of samples", () => {
    const w = new RssiWindow(order, 5000, 1);
    w.push({ receiverId: "b", rssi: -50, ts: 100 });
    w.push({ receiverId: "b", rssi: -60, ts: 200 });
    // sorted: -60, -50 -> avg = -55
    assert.equal(w.vector(300)[1], -55);
  });

  it("expires readings older than spanMs", () => {
    const w = new RssiWindow(order, 3000, 1);
    w.push({ receiverId: "a", rssi: -50, ts: 100 });
    w.push({ receiverId: "a", rssi: -60, ts: 2500 });
    w.push({ receiverId: "a", rssi: -55, ts: 3000 });
    // at ts=3200, ts=100 is 3100 ms old and expired; -60 and -55 average to -57.5
    assert.equal(w.vector(3200)[0], -57.5);
  });

  it("frame() returns a SensorFrame shape", () => {
    const w = new RssiWindow(order);
    const f = w.frame(1000, { a: true, b: false, c: true });
    assert.equal(f.ts, 1000);
    assert.deepEqual(f.order, order);
    assert.deepEqual(f.rssi, [-100, -100, -100]);
    assert.deepEqual(f.online, { a: true, b: false, c: true });
  });
});
