import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { HOUSEHOLD_ID } from "@/lib/supabase/server";

// Which home a dashboard request is about. There is no login: the demo home is open to everyone, and each home
// created from "Add a home" is kept by this browser in a cookie. Its id is a random uuid, so the id is the key.
// The monitor (live tracking, alerts, the TV) only watches the demo home; other homes get the scan and the audits.

export const DEMO_HOUSEHOLD_ID = HOUSEHOLD_ID;
export const HOME_COOKIE = "lantern-home"; // the home the dashboard is showing
export const MINE_COOKIE = "lantern-homes"; // homes this browser created, comma separated
const MAX_MINE = 12;
const ID = /^[A-Za-z0-9-]{1,64}$/;

export const isHouseholdId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

export const currentHouseholdId = cache(async (): Promise<string> => {
  const v = (await cookies()).get(HOME_COOKIE)?.value;
  return isHouseholdId(v) ? v : DEMO_HOUSEHOLD_ID;
});

export async function myHouseholdIds(): Promise<string[]> {
  const raw = (await cookies()).get(MINE_COOKIE)?.value ?? "";
  return [...new Set(raw.split(",").filter(isHouseholdId))].filter((id) => id !== DEMO_HOUSEHOLD_ID).slice(0, MAX_MINE);
}

const YEAR_S = 60 * 60 * 24 * 365;
const cookieOpts = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: YEAR_S, secure: process.env.NODE_ENV === "production" };

// Call from a server action or route handler only (cookies are read-only while rendering).
export async function openHousehold(id: string) {
  (await cookies()).set(HOME_COOKIE, id, cookieOpts);
}

export async function rememberHousehold(id: string) {
  const mine = [id, ...(await myHouseholdIds()).filter((x) => x !== id)].slice(0, MAX_MINE);
  (await cookies()).set(MINE_COOKIE, mine.join(","), cookieOpts);
  await openHousehold(id);
}

// On the public deploy (DEMO_READ_ONLY=1) the shared demo home can be looked at but not changed.
export const isReadOnly = (id: string) => process.env.DEMO_READ_ONLY === "1" && id === DEMO_HOUSEHOLD_ID;
export const READ_ONLY_MESSAGE = "The demo home is shared, so it can't be changed. Add your own home to try this.";

// The current home, for a write. Throws on the read-only demo home.
export async function writableHouseholdId(): Promise<string> {
  const id = await currentHouseholdId();
  if (isReadOnly(id)) throw new Error(READ_ONLY_MESSAGE);
  return id;
}
