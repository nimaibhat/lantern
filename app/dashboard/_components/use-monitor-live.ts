// Overview data from the monitor's /ws/live WebSocket: the room the monitor's classifier decided, the timeline,
// risks and listener status. The room always comes from the monitor so the overview and the 3D view agree.
  const { rooms } = initial;
          if (frame.t === "snapshot") {
            // One row per risk event: a later state (escalated, resolved) replaces the earlier one.
              startedAt: prev.find((r) => r.id === frame.riskEventId)?.startedAt ?? time,
            }, ...prev.filter((r) => r.id !== frame.riskEventId)]);
