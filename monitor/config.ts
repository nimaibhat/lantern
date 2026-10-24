// Monitor settings from the environment. .env.local is optional; values already in the environment win.

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: run on defaults.
}

export interface Config {
  port: number;
  householdId: string;
  listenerToken: string;
  debug: boolean; // enables POST /debug/emit
  corsOrigin: string;
  homeModelPath: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: Number(env.MONITOR_PORT ?? 8787),
    householdId: env.HOUSEHOLD_ID || env.DEMO_HOUSEHOLD_ID || "h1",
    listenerToken: env.LISTENER_TOKEN || "change-me",
    debug: env.MONITOR_DEBUG ? env.MONITOR_DEBUG === "1" : env.NODE_ENV !== "production",
    corsOrigin: env.MONITOR_CORS_ORIGIN || "*",
    homeModelPath: env.HOME_MODEL_PATH || "fixtures/home-model.json",
  };
}
