import assert from "node:assert/strict";
import test from "node:test";
import { earBat, earHidden } from "./ear-bat";

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

test("hidden listener has no window and posts as that laptop", () => {
  const file = earHidden("ear-87f06ffd", "https://192.168.1.68:3000/api/tracking", "Bedroom");
  assert.match(file, /WindowStyle Hidden/);
  assert.doesNotMatch(file, /echo off/);
  assert.doesNotMatch(file, /-EncodedCommand /);
  assert.match(file, /https:\/\/192\.168\.1\.68:3000\/api\/tracking\/ear\?id=ear-87f06ffd/);
  const run = file.split("shell.Run ")[1] ?? "";
  assert.ok(run.length < 2000);
});
