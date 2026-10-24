// Inference types (owner: Vineet).
import type { LocationSource } from "./sensing";
import type { Vec2 } from "./world";
// Room probabilities before the HMM.
export interface RoomPosterior {
  ts: number;
  posterior: Record<string, number>;
}
  x: number; // inches, clamped inside roomId
  roomId: string;
// Emitted only when the room changes.
  ts: string; // ISO
export interface Prediction {
  ts: number;
  fromRoomId: string;
  nextRoomId: string;
  probability: number;
}
