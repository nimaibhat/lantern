
import { registerCalibration } from "./calibrate";
import { registerReplay } from "./replay";
import { registerSim } from "./sim";
const sensing: MonitorModule = {
    registerSim(ctx);
    (ctx as unknown as Record<string, unknown>)._ingest = ingest;
    // Labeled RSSI for training, and replays of recorded sessions
    registerCalibration(ctx);
    registerReplay(ctx);

    // Strongest-listener fallback room estimate (off unless NEAREST_ROOM=1; the classifier decides the room)

export default sensing;
