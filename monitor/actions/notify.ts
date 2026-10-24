// Twilio SMS and voice calls (Part 6 step 6) over Twilio's REST API, with fetch instead of the SDK.
// TWILIO_DRY_RUN=1, missing keys, or no number for a contact: log the message instead of sending it.
// Phone numbers are never logged, including inside Twilio's error messages.
// ntfy push alerts are the free fallback when Twilio is not live: a contact's address is then `ntfy:<topic>`
// (contactAddress), a "text" becomes a high-priority push and a "call" an urgent one. Topics are never logged.

import { ackBody } from "./ntfy-acks";
import type { Notifier } from "./responder";

type Log = (tag: string, ...args: unknown[]) => void;

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
export const withoutNumbers = (s: string) => s.replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]");

const NTFY = "ntfy:";
const TOPIC = /^[A-Za-z0-9_-]{1,64}$/;

// Where a contact's alerts go: their phone when Twilio is live, otherwise their ntfy topic if one is set.
export function contactAddress(phone: string, topic: string | undefined, twilioLive: boolean): string {
  if (twilioLive || !topic || !TOPIC.test(topic)) return phone;
  return NTFY + topic;
}

export interface NtfyAcks {
  server: string;
  topic: string;
  token?: string;
}

export function createNotifier(env: Record<string, string | undefined>, log: Log): Notifier & { live: boolean; ntfy: boolean; acks?: NtfyAcks } {
  const sid = env.TWILIO_ACCOUNT_SID, token = env.TWILIO_AUTH_TOKEN, from = env.TWILIO_FROM_NUMBER || env.TWILIO_FROM;
  const live = env.TWILIO_DRY_RUN !== "1" && !!(sid && token && from);
  const ntfyServer = (env.NTFY_SERVER || "https://ntfy.sh").replace(/\/+$/, "");
  const ntfy = !live && [env.NTFY_CAREGIVER_TOPIC, env.NTFY_BACKUP_TOPIC].some((t) => !!t && TOPIC.test(t));
  const ackTopic = env.NTFY_ACK_TOPIC;
  // With an ack topic, taps come back through ntfy (ntfy-acks.ts); without one, the button calls the ack link.
  const acks: NtfyAcks | undefined = ntfy && ackTopic && TOPIC.test(ackTopic) ? { server: ntfyServer, topic: ackTopic, token: env.NTFY_TOKEN } : undefined;
  const auth = env.NTFY_TOKEN ? { Authorization: `Bearer ${env.NTFY_TOKEN}` } : undefined;

  // The Acknowledge button: an ntfy "http" action the app runs in the background, then clears the alert, so the
  // caregiver never leaves the notification. It publishes to the ack topic, or calls PUBLIC_BASE_URL's ack link.
  function ackAction(ackUrl: string) {
    const alertId = ackUrl.match(/\/alerts\/([\w-]{1,80})\/ack\b/)?.[1];
    if (acks && alertId) return { action: "http", label: "Acknowledge", url: `${acks.server}/${acks.topic}`, method: "POST", body: ackBody(alertId), clear: true, ...(auth ? { headers: auth } : {}) };
    return { action: "http", label: "Acknowledge", url: ackUrl, method: "GET", clear: true };
  }

  // One push. JSON publishing keeps any characters in the text intact (headers would have to be ASCII).
  async function push(to: string, message: string, level: "alert" | "urgent" | "done", ackUrl?: string) {
    const topic = to.slice(NTFY.length);
    const urgent = level === "urgent";
    const ack = level === "done" ? undefined : ackUrl ?? message.match(/https?:\/\/\S+\/ack\b/)?.[0];
    // With acks through ntfy the link would need a tunnel to work, so point at the button instead.
    if (acks && ack) message = message.replace(/Tap when you are on it: \S+$/, "Tap Acknowledge when you are on it.").replace(ack, "").trim();
    const res = await fetch(ntfyServer, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        topic,
        title: urgent ? "Lantern: please check now" : level === "done" ? "Lantern: got it" : "Lantern",
        message,
        priority: urgent ? 5 : level === "done" ? 3 : 4, // 5 rings through Do Not Disturb on most phones; 3 is quiet
        tags: [urgent ? "rotating_light" : level === "done" ? "white_check_mark" : "house"],
        ...(ack ? { actions: [ackAction(ack)] } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(withoutNumbers(`ntfy ${res.status}: ${(await res.text().catch(() => "")).split(topic).join("[topic]").slice(0, 200)}`));
    log("ntfy", `${level} push sent`);
  }

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
    ntfy,
    acks,
    async sms(to, body) {
      if (ntfy && to.startsWith(NTFY)) return push(to, body, "alert");
      if (!live || !to) return log("twilio", `dry run sms: ${withoutNumbers(body)}`);
      await post("Messages", { To: to, From: from!, Body: body });
      log("twilio", "sms sent");
    },
    async call(to, say, ackUrl) {
      if (ntfy && to.startsWith(NTFY)) return push(to, say, "urgent", ackUrl);
      if (!live || !to) return log("twilio", `dry run call: ${withoutNumbers(say)}`);
      const line = `<Say voice="alice">${xml(say)}</Say>`;
      await post("Calls", { To: to, From: from!, Twiml: `<Response>${line}<Pause length="1"/>${line}</Response>` }); // said twice
      log("twilio", "call placed");
    },
    // Push alerts give no feedback when tapped, so the person who acknowledged gets a quiet "got it". A text's link
    // already shows a thank-you page, so Twilio sends nothing here.
    async confirm(to, body) {
      if (ntfy && to.startsWith(NTFY)) return push(to, body, "done");
    },
  };
}
