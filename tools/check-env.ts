// Demo-day readiness check: what is configured, and what actually answers.
// npm run check-env
//
// Prints one line per item: ok, warn (works, but in a reduced mode) or missing. Never prints secret values.

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: check whatever is in the environment.
}

type Level = "ok" | "warn" | "missing";
const results: { level: Level; item: string; note: string }[] = [];
const add = (level: Level, item: string, note: string) => results.push({ level, item, note });
const has = (k: string) => !!process.env[k]?.trim();

async function reachable(url: string, init?: RequestInit): Promise<{ ok: boolean; status?: number; body?: unknown }> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(2500) });
    let body: unknown;
    try {
      body = await r.json();
    } catch {
      body = undefined;
    }
    return { ok: r.ok, status: r.status, body };
  } catch {
    return { ok: false };
  }
}

async function main() {
  // Supabase
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!sbUrl || !has("SUPABASE_SERVICE_ROLE_KEY")) {
    add("missing", "Supabase", "set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the web app falls back to demo data)");
  } else {
    const r = await reachable(`${sbUrl}/rest/v1/households?select=id&limit=1`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    add(r.ok ? "ok" : "missing", "Supabase", r.ok ? "keys work" : `cannot read households (${r.status ?? "no answer"})`);
  }
  if (!has("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")) add("warn", "Supabase publishable key", "missing; the browser cannot use Realtime");

  // Monitor
  const monitor = process.env.NEXT_PUBLIC_MONITOR_URL || `http://localhost:${process.env.MONITOR_PORT ?? 8787}`;
  const health = await reachable(`${monitor}/health`);
  if (!health.ok) {
    add("missing", "Monitor", `${monitor} does not answer; start it with npm run dev:monitor`);
  } else {
    const h = health.body as { listeners?: Record<string, boolean>; tagLastSeen?: number | null };
    const listeners = Object.entries(h.listeners ?? {});
    const online = listeners.filter(([, on]) => on).length;
    add("ok", "Monitor", `${monitor} answers`);
    add(online >= 3 ? "ok" : online > 0 ? "warn" : "missing", "Listeners", `${online} of ${listeners.length} online${online < 3 ? " (3 or more for reliable rooms)" : ""}`);
    const seen = h.tagLastSeen ? Math.round((Date.now() - h.tagLastSeen) / 1000) : undefined;
    add(seen !== undefined && seen < 10 ? "ok" : "warn", "Tag", seen === undefined ? "never heard; open the Lantern app, Tag tab, and tap Start" : `last heard ${seen} s ago`);
    const inf = await reachable(`${monitor}/debug/inference`);
    add(inf.ok ? "ok" : "warn", "Room classifier", inf.ok ? "loaded" : "no /debug/inference answer; check ml/out/knn.json");
  }

  // Web app
  const web = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
  const site = await reachable(`${web}/api/world`);
  add(site.ok ? "ok" : "warn", "Web app", site.ok ? `${web} answers` : `${web} does not answer; start it with npm run dev`);

  // Alerts
  const twilioKeys = has("TWILIO_ACCOUNT_SID") && has("TWILIO_AUTH_TOKEN") && (has("TWILIO_FROM_NUMBER") || has("TWILIO_FROM"));
  if (process.env.TWILIO_DRY_RUN === "1" || !twilioKeys) {
    add("warn", "Twilio", twilioKeys ? "dry run (TWILIO_DRY_RUN=1): alerts are logged, not sent" : "no keys: alerts are logged, not sent");
  } else {
    add("ok", "Twilio", "live: alerts will text and call for real");
  }
  if (!has("CAREGIVER_PHONE_NUMBER")) add("warn", "Caregiver phone", "CAREGIVER_PHONE_NUMBER is empty; alerts have nobody to reach");
  if (!process.env.PUBLIC_BASE_URL || /localhost/.test(process.env.PUBLIC_BASE_URL)) {
    add("warn", "Acknowledge links", "PUBLIC_BASE_URL is localhost; the link in the SMS will not open on a phone");
  }

  // TV
  const roku = process.env.ROKU_HOST?.trim();
  if (!roku) {
    add("warn", "Roku", "ROKU_HOST is empty; the TV wake call is logged, not sent");
  } else {
    const r = await reachable(`http://${roku}:8060/query/device-info`);
    add(r.status ? "ok" : "missing", "Roku", r.status ? `${roku} answers` : `${roku} does not answer; same network? Roku network access on?`);
  }

  // AI and previews
  add(has("ANTHROPIC_API_KEY") ? "ok" : "missing", "Claude (photo hazards)", has("ANTHROPIC_API_KEY") ? "key set" : "ANTHROPIC_API_KEY missing; the photo check is skipped");
  add(has("WORLD_LABS_API_KEY") ? "ok" : "warn", "World Labs (3D preview)", has("WORLD_LABS_API_KEY") ? "key set" : "optional; the preview button stays off");

  const mark = { ok: "  ok    ", warn: "  warn  ", missing: "  MISSING" };
  for (const r of results) console.log(`${mark[r.level]}  ${r.item.padEnd(24)} ${r.note}`);
  const missing = results.filter((r) => r.level === "missing").length;
  console.log(missing ? `\n${missing} missing. Fix those before the demo.` : "\nReady. Warnings are fine for a simulated run.");
  process.exitCode = missing ? 1 : 0;
}

main();
