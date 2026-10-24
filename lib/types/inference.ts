// Inference types (owner: Vineet).

import type { LocationSource } from "./sensing";
import type { Vec2 } from "./world";

// Room probabilities before the HMM.
export interface RoomPosterior {
  ts: number;
  posterior: Record<string, number>;
}

export interface PositionEstimate {
  ts: number;
  x: number; // inches, clamped inside roomId
  y: number;
  roomId: string;
  confidence: number;
  source: LocationSource;
  velocity?: Vec2; // inches per second
}

// Emitted only when the room changes.
export interface LocationEvent {
  id: string;
  householdId: string;
  roomId: string;
  prevRoomId?: string;
  confidence: number;
  source: LocationSource;
  ts: string; // ISO
}

export interface Prediction {
  ts: number;
  fromRoomId: string;
  nextRoomId: string;
  probability: number;
}

export interface MetricsReport {
  accuracy: number;
  baselineAccuracy: number;
  perRoom: Record<string, number>;
  confusion: number[][]; // rows = true room, cols = predicted, in `labels` order
  labels: string[];
  leadTimesS: number[];
  falseRedirectsPerNight: number;
  latencyMs: number; // median delay from a real room change to the location event
  // Added for the models page; optional so older reports still parse
  dataset?: "synthetic" | "real";
  shipped?: string; // "knn7", or "baseline" when kNN did not beat it
  baselinePerRoom?: Record<string, number>;
  models?: Record<string, number>; // cross-validated accuracy per candidate
  windowsPerRoom?: Record<string, number>;
  pipeline?: {
    sessions: number;
    nights: number;
    roomAccuracy: number; // tracked room vs truth, with the HMM
    roomAccuracyNoHmm: number;
    impossibleJumps: number;
    impossibleJumpsNoHmm: number;
    roomChanges: number;
    roomChangesNoHmm?: number;
    trueRoomChanges: number;
    predictions: number;
    predictionsCorrect: number;
    positionErrorIn?: number; // median, only when the data has true x, y
    positionErrorRoomCenterIn?: number; // the same, if the avatar just sat in the middle of the believed room
  };
  // Failure drill: each listener unplugged in turn (accuracyUnmasked = before offline listeners were left out)
  unplugged?: Record<string, { accuracy: number; accuracyUnmasked: number; falseRedirects: number; falseRedirectsUnmasked: number }>;
  generatedAt?: string;
}
