import assert from "node:assert/strict";
import { test } from "node:test";
import { closestRoom } from "./nearest-room";

const placed = [
  { id: "bedroom", roomId: "bedroom" },
  { id: "living-room", roomId: "living" },
];

test("the louder placed device decides the room", () => {
  const call = closestRoom(
    [
      { id: "bedroom", rssi: -70, online: true },
      { id: "living-room", rssi: -48, online: true },
    ],
    placed,
    null,
  );
  assert.equal(call?.roomId, "living");
  assert.equal(call?.receiverId, "living-room");
});

test("a device with no room is ignored", () => {
  const call = closestRoom(
    [
      { id: "bedroom", rssi: -60, online: true },
      { id: "spare", rssi: -40, online: true },
    ],
    placed,
    null,
  );
  assert.equal(call?.roomId, "bedroom");
});

test("the current room holds until another device is clearly louder", () => {
  const readings = [
    { id: "bedroom", rssi: -55, online: true },
    { id: "living-room", rssi: -52, online: true },
  ];
  assert.equal(closestRoom(readings, placed, "bedroom")?.roomId, "bedroom");
  assert.equal(closestRoom(readings, placed, "bedroom", 1)?.roomId, "living");
});
