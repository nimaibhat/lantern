async function sample(body: { readings?: { id: string; rssi: number }[]; roomId?: string; prevRoomId?: string | null; from?: string; to?: string; trueRoomId?: string }) {
    const { data: known } = await db!.from("receivers").select("id").eq("household_id", HOUSEHOLD_ID).in("id", readings.map((r) => r.id));
    const placed = new Set((known ?? []).map((r) => r.id));
    // A training label is where the PERSON is, which only a human knows. The listener's own room is not a label:
    // the phone in the hallway is heard by the bedroom laptop too. So these live readings stay unlabeled unless the
    // caller says where the phone really is (trueRoomId); labeled data comes from the monitor's /calibrate/* routes.
    const trueRoom = typeof body.trueRoomId === "string" && SLUG.test(body.trueRoomId) ? body.trueRoomId : null;
      .filter((r) => placed.has(r.id))
        label_room_id: trueRoom,
