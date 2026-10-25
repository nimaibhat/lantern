import { getReceivers, getRooms } from "@/lib/dashboard/data";
import { Tracker } from "./tracker";

export default async function TrackingPage() {
  const [receivers, rooms] = await Promise.all([getReceivers(), getRooms()]);
  return <Tracker receivers={receivers} rooms={rooms.map((r) => ({ id: r.id, name: r.name }))} />;
}
