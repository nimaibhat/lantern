// Shared: all four sign off on changes. Events on the monitor's in-process bus.

import type { PatientState, RiskEvent } from "./actions";
import type { LocationEvent, PositionEstimate, Prediction } from "./inference";
import type { SensorFrame } from "./sensing";

export interface BusEvents {
  frame: SensorFrame; // Saran -> Vineet
  reading: { receiverId: string; rssi: number; ts: number }; // Saran -> Vineet: each raw RSSI as it arrives (ts = hub clock), for the low-lag dot
  position: PositionEstimate; // Vineet (or Saran's sim) -> Nimai view, Aarnav, recorder
  location: LocationEvent; // Vineet (or sim) -> Aarnav, recorder
  prediction: Prediction; // Vineet -> Aarnav, Nimai view
  risk: RiskEvent; // Aarnav -> view, recorder
  patient: PatientState; // Aarnav -> view, recorder
}
