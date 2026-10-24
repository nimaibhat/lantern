import "server-only";
import { db } from "@/lib/supabase/server";

// Pairing codes let the iPhone app act for one household without holding any keys.

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I/L, easy to read off a screen
const LIFETIME_MS = 24 * 60 * 60 * 1000;

export async function createPairCode(householdId: string) {
  if (!db) throw new Error("Supabase is not configured");
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  const expiresAt = new Date(Date.now() + LIFETIME_MS).toISOString();
  const { error } = await db.from("pair_codes").insert({ code, household_id: householdId, expires_at: expiresAt });
  if (error) throw new Error(error.message);
  return { code, expiresAt };
}

// Returns the household for a valid, unexpired code, or null.
export async function householdForCode(raw: unknown): Promise<{ id: string; name: string } | null> {
  if (!db || typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return null;

  const { data } = await db
    .from("pair_codes")
    .select("household_id, expires_at, households(name)")
    .eq("code", code)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!data) return null;
  const household = data.households as unknown as { name: string } | null;
  return { id: data.household_id, name: household?.name ?? "" };
}
