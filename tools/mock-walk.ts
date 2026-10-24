// A pretend person walking through whatever home the monitor has loaded, heard by a pretend listener at every
// placed anchor. Readings stream in real time over /ws/listener, so the live map, its trail and the fast dot can be
// watched without any hardware. Prints where the person really is, to compare with the map.
//
//   npm run dev:mock-walk        (MONITOR_URL, MONITOR_WS_URL, LISTENER_TOKEN)

import type { HomeModel } from "@/lib/types";
import { Radio, rng, walk } from "./walk-sim";

const MONITOR = process.env.MONITOR_URL || "http://localhost:8787";
const WS_URL = process.env.MONITOR_WS_URL || "ws://localhost:8787/ws/listener";
const TOKEN = process.env.LISTENER_TOKEN || "change-me";
const WALK_S = 600;

async function main() {
  const home: HomeModel = await (await fetch(`${MONITOR}/world`)).json();
  const ids = [...new Set(home.anchors.map((a) => a.receiverId))];
  if (!ids.length) throw new Error("the home has no placed listeners; place some on the Devices page first");
  console.log(`[mock-walk] ${home.rooms.length} rooms, listeners: ${ids.join(", ")}`);

  const r = rng(Date.now());
  let w = walk(home, WALK_S, r), radio = new Radio(home, r), start = Date.now(), lastRoom = "";
  const here = () => {
    let i = Math.floor((Date.now() - start) / 100);
    if (i >= w.track.length) {
      w = walk(home, WALK_S, r);
      radio = new Radio(home, r);
      start = Date.now();
      i = 0;
    }
    return { p: w.track[i], room: w.roomAt[i] };
  };

  // One socket per listener. If the monitor restarts (tsx watch reloads it on every save), reconnect.
  const connect = (id: string) => {
    const ws = new WebSocket(`${WS_URL}?token=${TOKEN}`);
    let timer: ReturnType<typeof setTimeout> | undefined, beat: ReturnType<typeof setInterval> | undefined;
    ws.addEventListener("open", () => {
      console.log(`[mock-walk] ${id} connected`);
      ws.send(JSON.stringify({ type: "hello", receiverId: id, kind: "replay" }));
      // Each listener hears an advertisement about every 200 ms, a little irregularly, like a real scanner
      const tick = () => {
        const rssi = radio.hear(id, here().p);
        if (rssi !== undefined) ws.send(JSON.stringify({ type: "rssi", receiverId: id, tagId: "mock-walk", rssi, ts: Date.now() }));
        timer = setTimeout(tick, 160 + Math.random() * 80);
      };
      tick();
      beat = setInterval(() => ws.send(JSON.stringify({ type: "hb", receiverId: id, ts: Date.now() })), 2000);
    });
    let retried = false;
    const retry = () => {
      if (retried) return;
      retried = true;
      clearTimeout(timer);
      clearInterval(beat);
      setTimeout(() => connect(id), 1000);
    };
    ws.addEventListener("close", retry);
    ws.addEventListener("error", retry);
  };
  ids.forEach(connect);

  setInterval(() => {
    const { room } = here();
    if (room !== lastRoom) console.log(`[mock-walk] now in ${room}`);
    lastRoom = room;
  }, 500);
}

main().catch((e) => {
  console.error("[mock-walk]", e.message);
  process.exit(1);
});
