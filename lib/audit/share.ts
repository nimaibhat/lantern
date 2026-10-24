import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Read-only share links for the audit report: /dashboard/audit/share/<token>.
// The token is an HMAC of the household id, so it cannot be guessed and needs no table.
// Rotate AUDIT_SHARE_SECRET (or the service key it falls back to) to revoke every link.

const secret = () => process.env.AUDIT_SHARE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "lantern-dev-only";

export function shareToken(householdId: string): string {
  const mac = createHmac("sha256", secret()).update(`audit:${householdId}`).digest("base64url").slice(0, 22);
  return `${Buffer.from(householdId).toString("base64url")}.${mac}`;
}

export function householdFromToken(token: string): string | undefined {
  const [encoded, mac] = token.split(".");
  if (!encoded || !mac) return;
  const householdId = Buffer.from(encoded, "base64url").toString();
  const expected = shareToken(householdId).split(".")[1];
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return;
  return householdId;
}
