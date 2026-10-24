// Fallback room estimate (strongest listener wins). Off by default because monitor/inference (Vineet's classifier)
// emits location and position from the same frames; two sources would double-report every room change.
// Turn it on with NEAREST_ROOM=1 only when the classifier is not loaded.
  const enabled = process.env.NEAREST_ROOM === "1";
    ctx.log("sensing", "nearest-room estimator off (the classifier decides the room; NEAREST_ROOM=1 turns it on)");
