import { getHomeModel } from "@/lib/world/store";
import { Replayer } from "./replayer";

export default async function ReplayPage() {
  const { model } = await getHomeModel();
  return <Replayer home={model} />;
}
