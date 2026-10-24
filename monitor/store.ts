// In-memory state shared by the modules. Durable rows go to Supabase; this is only the latest view.


export interface Store {
  world?: HomeModel; // set by the world module
  room?: string; // last room from a location event, any source
  patient?: PatientMode;
  listeners: Record<string, boolean>; // receiverId -> online
  tagLastSeen?: number;
  replaying?: string; // session id while /replay/start runs; actions must not respond to a replay
}

export const createStore = (): Store => ({ listeners: {} });
