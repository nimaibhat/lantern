

const actions: MonitorModule = {
  name: "actions",
          // The caregiver's chosen photo (Settings). /api/patient/media falls back to the scanned bedroom photo.
          photoPath: `${householdId}/redirect-photo.jpg`,
    // A replay (/replay/start) re-emits a recorded night for the screens only: no new risks, texts or calls.
    const live = <T>(fn: (e: T) => void) => (e: T) => {
      if (!ctx.store.replaying) fn(e);
    };
    ctx.bus.on("location", live(engine.onLocation));
    ctx.bus.on("location", live((e) => responder.onLocation(e.roomId, Date.parse(e.ts) || Date.now())));
    ctx.bus.on("prediction", live(engine.onPrediction));
    ctx.bus.on("risk", live(engine.track));
    ctx.bus.on("risk", live(responder.onRisk));
    ctx.bus.on("risk", live(outcomes.onRisk));
      if (ctx.store.replaying) return;
      if (ctx.store.replaying) return;
};

export default actions;
