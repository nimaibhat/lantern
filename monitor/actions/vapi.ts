// Vapi phone calls to the family (docs/vapi.md) over Vapi's REST API with fetch, like notify.ts does for Twilio.
// Live only with VAPI_API_KEY and VAPI_PHONE_NUMBER_ID, and not VAPI_DRY_RUN=1; otherwise the responder places a
// plain Twilio call. The outcome is read back by polling GET /call/:id, so no public webhook is needed.
// Phone numbers are never logged.

import { VAPI_API, callOutcome, familyCallRequest } from "@/lib/cues/vapi";
import { withoutNumbers } from "./notify";
import type { VoiceCaller } from "./responder";

type Log = (tag: string, ...args: unknown[]) => void;

export function createVoiceCaller(env: Record<string, string | undefined>, log: Log, fetchImpl: typeof fetch = fetch): VoiceCaller {
  const key = env.VAPI_API_KEY;
  const phoneNumberId = env.VAPI_PHONE_NUMBER_ID;
  const live = env.VAPI_DRY_RUN !== "1" && !!(key && phoneNumberId);
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  return {
    live,
    async place(to, facts, riskEventId) {
      const body = familyCallRequest({
        phoneNumberId: phoneNumberId ?? "",
        to,
        facts,
        riskEventId,
        assistantId: env.VAPI_FAMILY_ASSISTANT_ID || undefined,
        model: env.VAPI_MODEL || undefined,
        voiceId: env.VAPI_FAMILY_VOICE_ID || undefined,
      });
      if (!live) {
        log("vapi", `dry run call: ${withoutNumbers(String((body.assistant as { firstMessage?: string } | undefined)?.firstMessage ?? facts.kind))}`);
        return undefined;
      }
      const res = await fetchImpl(`${VAPI_API}/call`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: unknown };
        throw new Error(withoutNumbers(`Vapi ${res.status}: ${Array.isArray(err.message) ? err.message.join("; ") : String(err.message ?? "request failed")}`));
      }
      const call = (await res.json()) as { id?: string };
      log("vapi", "call placed");
      return call.id;
    },
    async outcome(callId) {
      const res = await fetchImpl(`${VAPI_API}/call/${encodeURIComponent(callId)}`, { headers, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Vapi ${res.status} reading the call`);
      return callOutcome(await res.json());
    },
  };
}
