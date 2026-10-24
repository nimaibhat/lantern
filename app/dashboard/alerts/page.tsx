import { getHomeModel } from "@/lib/world/store";
import { AlertLog } from "./alert-log";
import "./alerts.css";

// Alert log with context (Part 6 step 8), live from the monitor's responder.
export default async function AlertsPage() {
  const { model } = await getHomeModel();
  return <AlertLog roomNames={Object.fromEntries(model.rooms.map((r) => [r.id, r.name]))} />;
}
