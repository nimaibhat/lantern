import { getHousehold, getReceivers, getRooms } from "@/lib/dashboard/data";
import { currentHouseholdId } from "@/lib/households";
import { Tracker } from "./tracker";

export default async function TrackingPage() {
  const [receivers, rooms, household, householdId] = await Promise.all([getReceivers(), getRooms(), getHousehold(), currentHouseholdId()]);
  // At night the laptop the phone is closest to asks them to go back to bed, except the one in their own bedroom
  const patient = {
    name: household.patientName,
    quietStart: household.quietHoursStart,
    quietEnd: household.quietHoursEnd,
    bedroomId: process.env.PATIENT_BEDROOM || undefined,
    householdId,
  };
  return <Tracker receivers={receivers} rooms={rooms.map((r) => ({ id: r.id, name: r.name }))} patient={patient} />;
}
