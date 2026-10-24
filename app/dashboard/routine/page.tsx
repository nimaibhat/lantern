import { getRooms, getRoutineSteps } from "@/lib/dashboard/data";
import { RoutineEditor } from "./routine-editor";

export default async function RoutinePage() {
  const [steps, rooms] = await Promise.all([getRoutineSteps(), getRooms()]);
  return <RoutineEditor initialSteps={steps} rooms={rooms} />;
}
