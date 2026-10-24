import assert from "node:assert/strict";
import test from "node:test";
import { earBat } from "./ear-bat";

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
