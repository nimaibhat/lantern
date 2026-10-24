// In-memory state shared by the modules. Durable rows go to Supabase; this is only the latest view.

import type { HomeModel, PatientMode, PatientState } from "@/lib/types";

export interface Store {
  world?: HomeModel; // set by the world module
  room?: string; // last room from a location event, any source
  patient?: PatientMode;
  patientState?: PatientState; // the whole latest state, for a TV that connects in the middle of a redirect
  listeners: Record<string, boolean>; // receiverId -> online
  tagLastSeen?: number;
  tagOnline?: boolean; // heard by any listener in the last minute; the overview warns when it goes quiet
  replaying?: string; // session id while /replay/start runs; actions must not respond to a replay
}

export const createStore = (): Store => ({ listeners: {} });
