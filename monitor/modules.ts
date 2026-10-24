import actions from "./actions";
import inference from "./inference";
import type { MonitorModule } from "./module";
import sensing from "./sensing";
import world from "./world";

// Registered in this order: world first so everyone else can call ctx.world().
const modules: MonitorModule[] = [world, sensing, inference, actions];
export default modules;
