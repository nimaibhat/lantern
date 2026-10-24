// npm run dev:monitor
import { loadConfig } from "./config";
import { startMonitor } from "./server";

startMonitor(loadConfig()).catch((e) => {
  console.error("[monitor] failed to start", e);
  process.exit(1);
});
