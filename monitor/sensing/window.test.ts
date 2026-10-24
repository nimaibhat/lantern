import assert from "node:assert/strict";
import { describe, it } from "node:test";
    assert.deepEqual(w.vector(1000), [-100, -100, -100]);
    assert.deepEqual(w.vector(1000), [-100, -100, -100]);
    assert.equal(w.vector(400)[0], -60);
    assert.equal(w.vector(300)[1], -55);
    // at ts=3200, ts=100 is 3100 ms old and expired; -60 and -55 average to -57.5
    assert.equal(w.vector(3200)[0], -57.5);
    assert.equal(f.ts, 1000);
    assert.deepEqual(f.order, order);
    assert.deepEqual(f.rssi, [-100, -100, -100]);
    assert.deepEqual(f.online, { a: true, b: false, c: true });
