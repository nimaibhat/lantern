// Print what the parser sees in one or more RoomPlan files.
// npx tsx lib/world/cli.ts fixtures/captured-room.json [more.json ...]
// The room name comes from the file name (captured-room-bedroom.json -> Bedroom) unless given as name=path.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { auditHome } from "@/lib/audit/ada";
import { buildHomeModel } from "./build";
import { parseCapturedRoom } from "./parse";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: npx tsx lib/world/cli.ts <captured-room.json> [more.json ...]");
  process.exit(1);
}

const nameFrom = (path: string) => {
  const stem = basename(path, ".json").replace(/^captured-(room-)?/, "").replace(/[-_]+/g, " ").trim() || "room";
  return stem.charAt(0).toUpperCase() + stem.slice(1);
};

const parsed = files.map((arg) => {
  const [name, path] = arg.includes("=") ? arg.split("=") : [nameFrom(arg), arg];
  return parseCapturedRoom(JSON.parse(readFileSync(path, "utf8")), name);
});
const home = buildHomeModel(parsed, { householdId: "cli" });
const r1 = (n: number) => Math.round(n);

for (const room of home.rooms) {
  const xs = room.polygon.map((p) => p.x), ys = room.polygon.map((p) => p.y);
  console.log(`\n${room.name} (${room.id}, ${room.kind})`);
  console.log(`  size ${r1(Math.max(...xs) - Math.min(...xs))} x ${r1(Math.max(...ys) - Math.min(...ys))} in, height ${room.heightIn} in, ${room.walls?.length ?? 0} walls`);
  console.log(`  centroid (${r1(room.centroid.x)}, ${r1(room.centroid.y)})`);
  for (const o of room.objects ?? []) console.log(`  object ${o.category} ${r1(o.widthIn)} x ${r1(o.depthIn)} in at (${r1(o.center.x)}, ${r1(o.center.y)})`);
}
console.log("\ndoors");
for (const d of home.doors) console.log(`  ${d.id} ${d.kind} ${d.widthIn} in at (${r1(d.center.x)}, ${r1(d.center.y)})`);
console.log("\nanchors");
for (const a of home.anchors) console.log(`  ${a.receiverId} at (${r1(a.position.x)}, ${r1(a.position.y)})`);
console.log("\naccessibility");
for (const item of auditHome(home)) console.log(`  ${item.severity.padEnd(6)} ${item.title}${item.measuredIn !== undefined ? ` (${item.measuredIn} / ${item.requiredIn} in)` : ""}`);
