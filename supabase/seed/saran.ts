// Seed receivers for the demo home model.
// Run with: npx tsx supabase/seed/saran.ts

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key);

const receivers = [
  // Where each laptop sits is the home model's anchors (zone editor); this table only names them and their room.
  { id: "bedroom", household_id: "h1", label: "Bedroom Laptop", room_id: "bedroom", kind: "mac-bleak", offset_db: 0 },
  { id: "hallway", household_id: "h1", label: "Hallway Laptop", room_id: "hallway", kind: "mac-bleak", offset_db: 0 },
  { id: "kitchen", household_id: "h1", label: "Kitchen Laptop", room_id: "kitchen", kind: "mac-bleak", offset_db: 0 },
  { id: "tv-room", household_id: "h1", label: "TV Room Laptop", room_id: "tv-room", kind: "mac-bleak", offset_db: 0 },
];

async function seed() {
  const { error } = await sb.from("receivers").upsert(receivers, { onConflict: "id" });
  if (error) {
    console.error("seed failed:", error.message);
    process.exit(1);
  }
  console.log(`seeded ${receivers.length} receivers`);
}

seed();
