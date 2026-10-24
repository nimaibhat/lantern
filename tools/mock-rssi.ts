// Pretends to be 4 laptop listeners sending RSSI over WebSocket.
// Walks the tag through rooms so the sensing pipeline has data.

import WebSocket from "ws";

const URL = process.env.MONITOR_WS_URL || "ws://localhost:8787/ws/listener";
const TOKEN = process.env.LISTENER_TOKEN || "change-me";
const RECEIVERS = ["bedroom", "hallway", "kitchen", "tv-room"];

// Simulated walk: bedroom -> hallway -> kitchen -> hallway -> bedroom, repeat
const WALK = ["bedroom", "hallway", "kitchen", "hallway", "tv-room", "hallway", "bedroom"];
let walkIdx = 0;
let currentRoom = WALK[0];

function rssiForReceiver(receiverId: string, tagRoom: string): number {
  // closer receiver = stronger signal
  if (receiverId === tagRoom) return -45 + Math.round(Math.random() * 6 - 3);
  // adjacent
  const adj: Record<string, string[]> = {
    bedroom: ["hallway"],
    hallway: ["bedroom", "bathroom", "kitchen", "tv-room"],
    kitchen: ["hallway"],
    "tv-room": ["hallway"],
    bathroom: ["hallway"],
  };
  if (adj[tagRoom]?.includes(receiverId)) return -65 + Math.round(Math.random() * 8 - 4);
  return -85 + Math.round(Math.random() * 10 - 5);
}

function connectListener(receiverId: string) {
  const ws = new WebSocket(`${URL}?token=${TOKEN}`);
  ws.on("open", () => {
    console.log(`[mock] ${receiverId} connected`);
    ws.send(JSON.stringify({ type: "hello", receiverId, kind: "mac-bleak" }));

    // send RSSI every 200ms
    const rssiTimer = setInterval(() => {
      ws.send(JSON.stringify({
        type: "rssi",
        receiverId,
        tagId: "tag-1",
        rssi: rssiForReceiver(receiverId, currentRoom),
        ts: Date.now(),
      }));
    }, 200);

    // heartbeat every 5s
    const hbTimer = setInterval(() => {
      ws.send(JSON.stringify({ type: "hb", receiverId, ts: Date.now() }));
    }, 5000);

    ws.on("close", () => {
      clearInterval(rssiTimer);
      clearInterval(hbTimer);
      console.log(`[mock] ${receiverId} disconnected, reconnecting in 2s...`);
      setTimeout(() => connectListener(receiverId), 2000);
    });
  });
  ws.on("error", () => {
    console.log(`[mock] ${receiverId} error, retrying in 2s...`);
    setTimeout(() => connectListener(receiverId), 2000);
  });
}

// Walk the tag through rooms every 8 seconds
setInterval(() => {
  walkIdx = (walkIdx + 1) % WALK.length;
  currentRoom = WALK[walkIdx];
  console.log(`[mock] tag moved to ${currentRoom}`);
}, 8000);

console.log(`[mock] starting ${RECEIVERS.length} fake listeners -> ${URL}`);
console.log(`[mock] tag starts in ${currentRoom}, walks every 8s`);
for (const r of RECEIVERS) connectListener(r);
