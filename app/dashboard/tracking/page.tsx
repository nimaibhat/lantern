import { getReceivers } from "@/lib/dashboard/data";
import { Tracker } from "./tracker";

export default async function TrackingPage() {
  const receivers = await getReceivers();
  return <Tracker receivers={receivers} />;
}
