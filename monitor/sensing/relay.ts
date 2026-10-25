// Tracking laptops post their signal to whichever laptop's page they paired with, and that hub saves it to Supabase.
// The Tracking tab reads every laptop from there; this monitor only hears the ones that post to this machine. So
// every second, each laptop's newest signal in Supabase that this monitor did not already hear directly goes in as
// a reading, and the map, the alerts and the Tracking tab all work from the same signals.
//
// Off with no Supabase keys, for the fixture home (tests), or with SUPABASE_RELAY=0.

import { createClient } from "@supabase/supabase-js";
import type { ModuleCtx } from "../module";

const EVERY_MS = 1000;
const FRESH_MS = 5000; // the same freshness Tracking uses (HEAR_FRESH_MS in app/api/tracking/route.ts)

export function startRelay(ctx: ModuleCtx, ingest: { relay(receiverId: string, rssi: number): boolean }) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || process.env.HOME_MODEL_SOURCE === "fixture" || process.env.SUPABASE_RELAY === "0") return;
  const db = createClient(url, key, { auth: { persistSession: false } });
  const taken = new Map<string, string>(); // receiver -> the last_rssi_at already taken in
  let busy = false;
  let failing = false;
  ctx.log("sensing", "relaying Tracking signals from Supabase");

  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const since = new Date(Date.now() - FRESH_MS).toISOString();
      const { data, error } = await db
        .from("receivers")
        .select("id, last_rssi, last_rssi_at")
        .eq("household_id", ctx.cfg.householdId)
        .gte("last_rssi_at", since);
      if (error) throw new Error(error.message);
      if (failing) ctx.log("sensing", "Supabase relay back");
      failing = false;
      for (const r of data ?? []) {
        const id = r.id as string, at = r.last_rssi_at as string | null;
        if (typeof r.last_rssi !== "number" || !at || taken.get(id) === at) continue;
        taken.set(id, at);
        ingest.relay(id, r.last_rssi);
      }
    } catch (e) {
      if (!failing) ctx.log("sensing", "Supabase relay failed, retrying:", (e as Error).message);
      failing = true;
    } finally {
      busy = false;
    }
  }, EVERY_MS).unref();
}
