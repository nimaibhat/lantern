import "server-only";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Secret-key client: it bypasses row-level security, so it only ever runs on the server.
// Null when the env is not filled in, in which case lib/data.ts falls back to mock data.
export const db = url && secret ? createClient(url, secret, { auth: { persistSession: false } }) : null;

// No login yet, so everything reads the seeded demo household (supabase/seed.sql).
export const HOUSEHOLD_ID = process.env.DEMO_HOUSEHOLD_ID ?? "h1";
