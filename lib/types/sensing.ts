// Bluetooth sensing types (owner: Saran).

export type LocationSource = "ble" | "sim";
export type ReceiverKind = "mac-bleak" | "iphone" | "replay";

// What a listener sends over WS /ws/listener.
export type ListenerMsg =
  | { type: "hello"; receiverId: string; kind: ReceiverKind }
  | { type: "rssi"; receiverId: string; tagId: string; rssi: number; ts: number }
  | { type: "hb"; receiverId: string; ts: number };

// One reading every second: median RSSI per receiver over the last 3 s, in a fixed order. -100 = no reading.
export interface SensorFrame {
  ts: number;
  order: string[];
  rssi: number[];
  online: Record<string, boolean>;
}

// A listener as the dashboard shows it.
export interface Receiver {
  id: string;
  label: string;
  roomId: string;
  online: boolean;
}
