import assert from "node:assert/strict";
import { test } from "node:test";
import { Bus } from "../bus";
import { loadConfig } from "../config";
import { createStore } from "../store";
import { createIngest } from "./ingest";

test("a laptop's Supabase signal comes in once, and not on top of what it reported here directly", () => {
  const bus = new Bus();
  const store = createStore();
  const ingest = createIngest(bus, store, () => {}, loadConfig({}), []);
  const heard: string[] = [];
  bus.on("reading", (r) => heard.push(`${r.receiverId} ${r.rssi}`));
  try {
    // Reported to another laptop's hub: only Supabase has it
    assert.equal(ingest.relay("ear-11111111", -48), true);
    assert.equal(store.listeners["ear-11111111"], true);

    // Reported here directly: the copy that hub saved is the same reading
    ingest.handleHttp({ type: "rssi", receiverId: "ear-22222222", tagId: "lantern-tag", rssi: -60, ts: Date.now() });
    assert.equal(ingest.relay("ear-22222222", -60), false);

    assert.equal(ingest.relay("ear-33333333", -100), false, "no signal is not a reading");
    assert.deepEqual(heard, ["ear-11111111 -48", "ear-22222222 -60"]);
  } finally {
    ingest.stop();
  }
});
