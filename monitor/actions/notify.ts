// Twilio SMS and voice calls (Part 6 step 6) over Twilio's REST API, with fetch instead of the SDK.
// TWILIO_DRY_RUN=1, missing keys, or no number for a contact: log the message instead of sending it.
// Phone numbers are never logged, including inside Twilio's error messages.

import type { Notifier } from "./responder";

type Log = (tag: string, ...args: unknown[]) => void;

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
export const withoutNumbers = (s: string) => s.replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]");

export function createNotifier(env: Record<string, string | undefined>, log: Log): Notifier & { live: boolean } {
  const sid = env.TWILIO_ACCOUNT_SID, token = env.TWILIO_AUTH_TOKEN, from = env.TWILIO_FROM_NUMBER || env.TWILIO_FROM;
  const live = env.TWILIO_DRY_RUN !== "1" && !!(sid && token && from);

  async function post(resource: "Messages" | "Calls", form: Record<string, string>) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/${resource}.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
      // 21608: a trial account can only reach verified numbers
      throw new Error(withoutNumbers(`Twilio ${res.status}${err.code ? ` (code ${err.code})` : ""}: ${err.message ?? "request failed"}`));
    }
  }

  return {
    live,
    async sms(to, body) {
      if (!live || !to) return log("twilio", `dry run sms: ${withoutNumbers(body)}`);
      await post("Messages", { To: to, From: from!, Body: body });
      log("twilio", "sms sent");
    },
    async call(to, say) {
      if (!live || !to) return log("twilio", `dry run call: ${withoutNumbers(say)}`);
      const line = `<Say voice="alice">${xml(say)}</Say>`;
      await post("Calls", { To: to, From: from!, Twiml: `<Response>${line}<Pause length="1"/>${line}</Response>` }); // said twice
      log("twilio", "call placed");
    },
  };
}
