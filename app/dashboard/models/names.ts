const ROOM_NAMES: Record<string, string> = { "tv-room": "TV room", "front-door": "Front door" };

export const roomName = (id: string) => ROOM_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " ");
export const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
