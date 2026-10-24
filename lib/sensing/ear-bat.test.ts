import assert from "node:assert/strict";
import test from "node:test";
import { earBat, earLaunch, originFor } from "./ear-bat";

test("ear file posts as the laptop that downloaded it", () => {
  const bat = earBat("ear-87f06ffd", "https://192.168.1.68:3000/api/tracking", "Bedroom");
  const encoded = bat.split("-EncodedCommand ")[1]?.trim() ?? "";
  const script = Buffer.from(encoded, "base64").toString("utf16le");
  assert.match(script, /ear-87f06ffd/);
  assert.match(script, /https:\/\/192\.168\.1\.68:3000\/api\/tracking/);
  assert.doesNotThrow(() => earBat("ear-87f06ffd", "http://192.168.1.68:3000/api/tracking", "Bedroom"));
  assert.match(script, /lantern/);
  assert.match(script, /CreateDelegate/);
  assert.match(script, /add_Received/);
  assert.doesNotMatch(script, /Register-ObjectEvent/);
  assert.doesNotMatch(script, /Apple/);
});

test("listener file is a visible bat and posts as that laptop", () => {
  const file = earLaunch("ear-87f06ffd", "https://192.168.1.68:3000/api/tracking", "Bedroom");
  assert.match(file, /echo off/);
  assert.match(file, /pause/);
  assert.doesNotMatch(file, /WindowStyle Hidden/);
  assert.doesNotMatch(file, /Wscript/);
  assert.doesNotMatch(file, /-EncodedCommand /);
  assert.match(file, /https:\/\/192\.168\.1\.68:3000\/api\/tracking\/ear\?id=ear-87f06ffd/);
  assert.ok(file.length < 2000);
});

test("origin follows the browser host instead of 0.0.0.0", () => {
  const req = new Request("https://0.0.0.0:3000/api/tracking/launch?id=ear-87f06ffd", {
    headers: { host: "192.168.1.68:3000" },
  });
  assert.equal(originFor(req), "https://192.168.1.68:3000");
});
