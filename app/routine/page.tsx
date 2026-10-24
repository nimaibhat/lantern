import { getHousehold, getRooms, getRoutineSteps } from "@/lib/dashboard/data";
import "@/app/dashboard/_components/dashboard.css";
import { PatientScreen } from "./patient-screen";

export const dynamic = "force-dynamic";

// The patient's TV: /routine?h=<householdId>, fullscreen on the laptop beside the TV. ?preview=1 labels it
// "TV (simulated)" for tests on a normal screen.
export default async function RoutinePage({ searchParams }: { searchParams: Promise<{ h?: string; preview?: string }> }) {
  const [steps, rooms, household, { h, preview }] = await Promise.all([getRoutineSteps(), getRooms(), getHousehold(), searchParams]);
  return (
    <PatientScreen
      steps={steps}
      rooms={rooms}
      householdId={h || household.id}
      quiet={{ start: household.quietHoursStart, end: household.quietHoursEnd }}
      preview={preview === "1"}
    />
  );
}
