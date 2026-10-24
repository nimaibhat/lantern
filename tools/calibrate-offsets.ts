// Per-listener RSSI offsets (Part 3 step 3). Laptop antennas read 8 to 15 dB apart at the same distance; offsets line
// them up so the classifier and the strongest-receiver rule compare like with like.
//
// With the monitor and every listener running (listeners at --offset 0):
//   npx tsx tools/calibrate-offsets.ts
// For each listener, hold the tag 1 m from it, in the demo hand and case, until the count finishes. Then restart each
// listener with the printed --offset. Offsets bring the 1 m reading to -59 dBm, the txPower the position model assumes.

import { createInterface } from "node:readline/promises";
import type { SensorFrame } from "@/lib/types";

const MONITOR = process.env.MONITOR_URL || `http://localhost:${process.env.MONITOR_PORT ?? 8787}`;
const SECONDS = Number(process.env.CALIBRATE_SECONDS ?? 30);
const TARGET_DBM = -59;
const NO_READING = -100;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function frame(): Promise<SensorFrame> {
  const res = await fetch(`${MONITOR}/debug/vector`, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`GET /debug/vector answered ${res.status}`);
  return res.json();
}

// One reading per second from this listener's 3 s median window.
async function sample(receiverId: string): Promise<number[]> {
  const out: number[] = [];
  for (let s = 0; s < SECONDS; s++) {
    const f = await frame();
    const v = f.rssi[f.order.indexOf(receiverId)];
    if (v > NO_READING) out.push(v);
    process.stdout.write(`\r  ${s + 1}/${SECONDS} s, ${out.length} readings${v > NO_READING ? `, now ${v} dBm` : ""}    `);
    await wait(1000);
  }
  process.stdout.write("\n");
  return out;
}

async function main() {
  let first: SensorFrame;
  try {
    first = await frame();
  } catch (e) {
    console.log(`The monitor at ${MONITOR} does not answer (${(e as Error).message}). Start it with npm run dev:monitor.`);
    process.exitCode = 1;
    return;
  }
  const online = first.order.filter((id) => first.online[id]);
  if (!online.length) {
    console.log("No listener is online. Start them first (docs/runbook.md, step 4).");
    process.exitCode = 1;
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const offsets: Record<string, number> = {};
  for (const id of online) {
    await rl.question(`\nHold the tag 1 m from the ${id} listener, then press Enter.`);
    const readings = await sample(id);
    if (readings.length < SECONDS / 3) {
      console.log(`  Too few readings from ${id} (${readings.length}). Is LanternTag open and advertising? Skipped.`);
      continue;
    }
    const m = median(readings);
    offsets[id] = Math.round(TARGET_DBM - m);
    console.log(`  median ${m} dBm at 1 m -> --offset ${offsets[id]}`);
  }
  rl.close();

  if (!Object.keys(offsets).length) return;
  console.log("\nRestart each listener with its offset (add it to any offset it already had):");
  for (const [id, off] of Object.entries(offsets)) console.log(`  python listener/listener.py --id ${id} --offset ${off} --token <LISTENER_TOKEN>`);
}

main();
