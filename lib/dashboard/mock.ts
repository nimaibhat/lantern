// Fake data for building the dashboard before Supabase and the hardware exist.
// Swap these exports for real queries later; the shapes match lib/types.ts.

import type { Activity, AuditItem, Contact, Household, Opening, Receiver, RiskEvent, Room, RoomObject, RoutineStep, Vec2 } from "@/lib/types";

export const household: Household = {
  id: "h1",
  name: "Demo home",
  patientName: "Patient",
  mobility: "walker",
  quietHoursStart: "21:00",
  quietHoursEnd: "07:00",
  timezone: "America/New_York",
};

export const contacts: Contact[] = [
  { id: "c1", name: "Caregiver", relation: "Family", phone: "+1 (614) 555-0142", priority: 1 },
  { id: "c2", name: "Backup caregiver", relation: "Family", phone: "+1 (614) 555-0178", priority: 2 },
];

const rect = (x: number, y: number, w: number, h: number): Vec2[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const door = (id: string, x1: number, y1: number, x2: number, y2: number): Opening => ({
  id,
  kind: "door",
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
  heightIn: 80,
  widthIn: Math.round(Math.hypot(x2 - x1, y2 - y1)),
});

const obj = (id: string, category: string, x: number, y: number, w: number, d: number): RoomObject => ({
  id,
  category,
  center: { x, y },
  widthIn: w,
  depthIn: d,
  heightIn: 30,
  rotationDeg: 0,
});

const room = (id: string, name: string, outline: Vec2[], doors: Opening[], objects: RoomObject[]): Room => ({
  id,
  scanId: "s1",
  name,
  outline,
  walls: [],
  doors,
  windows: [],
  objects,
  photoPaths: [],
});

// A one-floor home, 480 x 360 inches. The hallway is 34 in wide on purpose so the audit has something to flag.
export const rooms: Room[] = [
  room("bedroom", "Bedroom", rect(0, 0, 180, 170), [door("d1", 60, 170, 92, 170)], [obj("o1", "bed", 90, 70, 60, 80)]),
  room("bathroom", "Bathroom", rect(180, 0, 110, 170), [door("d2", 210, 170, 238, 170)], [
    obj("o2", "toilet", 270, 30, 18, 28),
    obj("o3", "bathtub", 235, 25, 60, 30),
  ]),
  room("hallway", "Hallway", rect(0, 170, 290, 34), [door("d3", 290, 172, 290, 202)], []),
  room("kitchen", "Kitchen", rect(0, 204, 170, 156), [door("d4", 80, 204, 112, 204)], [
    obj("o4", "stove", 30, 340, 30, 26),
    obj("o5", "table", 100, 290, 48, 36),
  ]),
  room("entry", "Front door", rect(170, 204, 120, 156), [door("d5", 200, 204, 236, 204), door("d6", 210, 360, 246, 360)], []),
  room("living", "Living room", rect(290, 0, 190, 360), [door("d7", 290, 240, 290, 276)], [
    obj("o6", "sofa", 440, 160, 34, 84),
    obj("o7", "table", 385, 160, 24, 44),
  ]),
];

export const receivers: Receiver[] = [
  { id: "r1", label: "ESP32 A", roomId: "bedroom", online: true },
  { id: "r2", label: "ESP32 B", roomId: "hallway", online: true },
  { id: "r3", label: "ESP32 C", roomId: "entry", online: true },
];

// Oldest first. The dashboard shows them newest first.
export const timeline: Activity[] = [
  { id: "t1", time: "03:06", kind: "move", text: "Bedroom → Hallway" },
  { id: "t2", time: "03:07", kind: "risk", text: "Heading to the front door during quiet hours. Hallway light on, the caregiver's voice played." },
  { id: "t3", time: "03:08", kind: "move", text: "Hallway → Bedroom" },
  { id: "t4", time: "03:08", kind: "info", text: "Back in bed after 48 s. No alert sent." },
  { id: "t5", time: "07:04", kind: "move", text: "Bedroom → Bathroom" },
  { id: "t6", time: "07:31", kind: "move", text: "Bathroom → Kitchen" },
  { id: "t7", time: "08:12", kind: "move", text: "Kitchen → Living room" },
  { id: "t8", time: "08:31", kind: "move", text: "Living room → Kitchen" },
  { id: "t9", time: "08:50", kind: "move", text: "Kitchen → Bedroom" },
];

export const riskEvents: RiskEvent[] = [
  { id: "k1", householdId: "h1", kind: "exit-approach", roomId: "entry", trigger: "detected", state: "resolved", source: "ble", startedAt: "03:07", resolvedAt: "03:08" },
];

export const auditItems: AuditItem[] = [
  {
    id: "a1", roomId: "bathroom", source: "ada-rule", code: "ADA 404.2.3", severity: "high", status: "open",
    title: "Bathroom door is too narrow", detail: "Clear width is below the minimum for a walker or wheelchair.",
    fix: "Install offset (swing-clear) hinges or widen the opening.", measuredIn: 28, requiredIn: 32, location: { x: 224, y: 170 },
  },
  {
    id: "a2", roomId: "bathroom", source: "vision", severity: "high", status: "open",
    title: "No grab bar beside the toilet", detail: "Nothing to hold when sitting down or standing up.",
    fix: "Add a wall-mounted grab bar 33 to 36 in above the floor.", location: { x: 270, y: 30 },
  },
  {
    id: "a3", roomId: "hallway", source: "vision", severity: "high", status: "open",
    title: "Loose runner rug in the hallway", detail: "The edge curls up on the path from the bedroom to the bathroom.",
    fix: "Remove the rug or secure it with non-slip backing.", location: { x: 200, y: 187 },
  },
  {
    id: "a4", roomId: "hallway", source: "ada-rule", code: "ADA 403.5.1", severity: "medium", status: "open",
    title: "Hallway is narrower than an accessible route", detail: "Tight for a walker, and there is no room to turn around.",
    fix: "Clear anything along the walls; consider a handrail on one side.", measuredIn: 34, requiredIn: 36, location: { x: 40, y: 187 },
  },
  {
    id: "a5", roomId: "bathroom", source: "ada-rule", code: "ADA 304.3", severity: "medium", status: "open",
    title: "Not enough turning space in the bathroom", detail: "A 60 in circle does not fit between the tub, toilet, and walls.",
    fix: "Remove the floor cabinet or switch to a pedestal sink.", measuredIn: 52, requiredIn: 60, location: { x: 235, y: 110 },
  },
  {
    id: "a6", roomId: "entry", source: "vision", severity: "medium", status: "open",
    title: "Keys and coat by the front door", detail: "Visible keys and outerwear are strong cues to leave the house.",
    fix: "Move keys and coats into a closed cabinet out of sight.", location: { x: 270, y: 330 },
  },
  {
    id: "a7", roomId: "entry", source: "vision", severity: "medium", status: "open",
    title: "Dark doormat inside the front door", detail: "People with dementia can read a dark mat as a hole and step around it.",
    fix: "Use a mat close to the floor color, or remove it.", location: { x: 228, y: 325 },
  },
  {
    id: "a8", roomId: "living", source: "vision", severity: "low", status: "open",
    title: "Cord across the walkway", detail: "A lamp cord runs between the sofa and the doorway.",
    fix: "Route the cord along the wall with a cover.", location: { x: 330, y: 258 },
  },
];

export const routineSteps: RoutineStep[] = [
  { id: "p1", routineId: "rt1", order: 1, time: "07:00", title: "Good morning. Time to get up.", roomId: "bedroom" },
  { id: "p2", routineId: "rt1", order: 2, time: "07:15", title: "Wash your face and brush your teeth.", roomId: "bathroom" },
  { id: "p3", routineId: "rt1", order: 3, time: "07:45", title: "Breakfast is in the kitchen.", roomId: "kitchen" },
  { id: "p4", routineId: "rt1", order: 4, time: "10:00", title: "Sit in the living room and listen to music.", roomId: "living" },
  { id: "p5", routineId: "rt1", order: 5, time: "12:30", title: "Lunch time.", roomId: "kitchen" },
  { id: "p6", routineId: "rt1", order: 6, time: "15:00", title: "Afternoon rest.", roomId: "bedroom" },
  { id: "p7", routineId: "rt1", order: 7, time: "21:00", title: "Get ready for bed.", roomId: "bathroom" },
  { id: "p8", routineId: "rt1", order: 8, time: "21:30", title: "Goodnight. Time to sleep.", roomId: "bedroom" },
];
