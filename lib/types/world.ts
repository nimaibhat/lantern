// World model and scan types (owner: Nimai).
// Distances are inches in one shared floor frame: x right, y down the plan. RoomPlan reports meters; convert at the edge.

export type Vec2 = { x: number; y: number };

export type RoomKind = "bedroom" | "bathroom" | "hallway" | "kitchen" | "living" | "tv-room" | "front-door" | "other";
export type Severity = "high" | "medium" | "low";

export interface Segment {
  id: string;
  start: Vec2;
  end: Vec2;
  heightIn: number;
}

export interface RoomObject {
  id: string;
  category: string; // RoomPlan category: bed, toilet, bathtub, sofa, table, stove...
  center: Vec2;
  widthIn: number;
  depthIn: number;
  heightIn: number;
  rotationDeg: number;
}

// The shared home model every part of the system codes against.

export interface HomeRoom {
  id: string; // text slug: bedroom, hallway, tv-room
  name: string;
  kind: RoomKind;
  polygon: Vec2[]; // floor outline, clockwise, in the shared frame
  centroid: Vec2;
  heightIn: number;
  walls?: Segment[]; // optional; the viewer derives walls from the polygon if absent
  objects?: RoomObject[];
  photoPaths?: string[];
  virtual?: boolean; // true for demo zones drawn over a larger scanned room
}

export interface HomeDoor {
  id: string;
  roomA: string;
  roomB: string;
  center: Vec2;
  widthIn: number;
  kind: "door" | "opening";
}

// Where each listener sits. receiverId equals the listener's --id.
export interface Anchor {
  receiverId: string;
  position: Vec2;
  heightIn: number;
}

export interface Hazard {
  id: string;
  roomId: string;
  position: Vec2;
  title: string;
  severity: Severity;
}

export interface HomeModel {
  householdId: string;
  version: number;
  unit: "in";
  rooms: HomeRoom[];
  doors: HomeDoor[];
  anchors: Anchor[];
  hazards: Hazard[];
  assets?: { usdzPath?: string; glbPath?: string; splatPath?: string };
}

// One RoomPlan scan as uploaded by the phone, parsed per room.

export interface Scan {
  id: string;
  householdId: string;
  createdAt: string;
  jsonPath: string;
  usdzPath: string;
  rooms: Room[];
}

export interface Room {
  id: string;
  scanId: string;
  name: string;
  outline: Vec2[];
  walls: Segment[];
  doors: Opening[];
  windows: Opening[];
  objects: RoomObject[];
  photoPaths: string[];
  photoUrls?: string[]; // short-lived signed URLs for display
  preview?: RoomPreview;
}

// World Labs 3D preview of a room. A visual preview only; measurements come from the scan.
export interface RoomPreview {
  status: "none" | "generating" | "ready" | "failed";
  worldUrl?: string; // opens in the Marble viewer
  splatUrl?: string; // .spz Gaussian splat for the in-page viewer
  thumbnailUrl?: string;
  panoUrl?: string;
}

// Latest upload from the phone.
export interface ScanSummary {
  id: string;
  status: "uploading" | "processing" | "done" | "failed";
  rooms: number;
  createdAt: string; // "HH:MM" today, or a short date
}

export interface Opening extends Segment {
  kind: "door" | "window" | "opening";
  widthIn: number;
  isOpen?: boolean;
}

export type AuditStatus = "open" | "accepted" | "dismissed" | "fixed";

export interface AuditItem {
  id: string;
  roomId: string;
  source: "ada-rule" | "vision";
  code?: string; // e.g. "ADA 404.2.3"
  title: string;
  detail: string;
  fix: string;
  severity: Severity;
  measuredIn?: number;
  requiredIn?: number;
  photoPath?: string;
  photoUrl?: string; // short-lived signed URL for display
  location?: Vec2;
  status: AuditStatus; // set by the OT during review
  note?: string; // OT's note
}
