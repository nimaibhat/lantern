import { REDIRECT_PHOTO } from "@/lib/dashboard/redirect-media";
import { getHomeModel } from "@/lib/world/store";
  let { data, error } = await db.storage.from(bucket).createSignedUrl(path, 300);
  // No photo chosen in Settings yet: show the scanned bedroom photo instead.
  if ((error || !data) && path === `${h}/${REDIRECT_PHOTO}`) {
    const { model } = await getHomeModel(h);
    const bedroom = model.rooms.find((r) => r.kind === "bedroom")?.photoPaths?.[0];
    if (bedroom) ({ data, error } = await db.storage.from("photos").createSignedUrl(bedroom, 300));
  }
