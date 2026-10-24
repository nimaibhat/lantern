// Night and day patterns from movement history (Part 6 step 9). Today the history is the synthetic
// fixtures/walks.json (six weeks, with 3 AM kitchen trips rising), labeled as demo data wherever it is shown;
// recorded nights use the same shape once they exist.

export interface WalkStep { room: string; hour: number; dwellS: number }
export interface Walk { id: string; day: number; kind: "night" | "day"; steps: WalkStep[] }

export type Destination = "kitchen" | "bathroom" | "other";
const PASSING = new Set(["bedroom", "hallway"]);

// Where a night trip was going: the room they spent longest in, other than the bedroom and the hallway.
export function destination(w: Walk): Destination {
  const stops = w.steps.filter((s) => !PASSING.has(s.room)).sort((a, b) => b.dwellS - a.dwellS);
  const room = stops[0]?.room;
  return room === "kitchen" || room === "bathroom" ? room : "other";
}

const nightsOf = (walks: Walk[]) => walks.filter((w) => w.kind === "night");
const lastDay = (walks: Walk[]) => Math.max(0, ...walks.map((w) => w.day));

export interface WeekRow { label: string; kitchen: number; bathroom: number; other: number; total: number }

// Night trips per week, oldest first. Week 1 is the earliest full week in the history.
export function tripsByWeek(walks: Walk[]): WeekRow[] {
  const last = lastDay(walks), weeks = Math.floor(last / 7) + 1;
  const rows: WeekRow[] = Array.from({ length: weeks }, (_, i) => ({ label: `Week ${i + 1}`, kitchen: 0, bathroom: 0, other: 0, total: 0 }));
  for (const w of nightsOf(walks)) {
    const row = rows[Math.floor(w.day / 7)];
    row[destination(w)]++;
    row.total++;
  }
  return rows;
}

// The insight a caregiver should not miss: kitchen trips in the small hours over the last two weeks, against the
// first two weeks of the history (how things were when tracking started).
export function kitchenAtNight(walks: Walk[], days = 14, fromHour = 0, toHour = 6) {
  const first = Math.min(...walks.map((w) => w.day)), last = lastDay(walks);
  const count = (from: number, to: number) =>
    nightsOf(walks).filter((w) => w.day >= from && w.day <= to && destination(w) === "kitchen" && w.steps[0].hour >= fromHour && w.steps[0].hour < toHour).length;
  const recent = count(last - days + 1, last), baseline = count(first, first + days - 1);
  return { recent, baseline, ratio: baseline ? recent / baseline : recent ? Infinity : 1, days };
}

// Minutes per day spent in each room at each hour of the day, averaged over the history.
export function roomByHour(walks: Walk[]): { rooms: string[]; minutes: number[][] } {
  const days = lastDay(walks) + 1;
  const rooms = [...new Set(walks.flatMap((w) => w.steps.map((s) => s.room)))];
  const minutes = rooms.map(() => new Array(24).fill(0));
  for (const w of walks) {
    for (const s of w.steps) {
      let t = s.hour * 3600, left = s.dwellS;
      while (left > 0) {
        const h = Math.floor(t / 3600) % 24, room = rooms.indexOf(s.room);
        const take = Math.min(left, 3600 - (t % 3600));
        minutes[room][h] += take / 60;
        t += take;
        left -= take;
      }
    }
  }
  return { rooms, minutes: minutes.map((row) => row.map((m) => m / days)) };
}

// The most recent night anyone got up, with where they went.
export function lastNight(walks: Walk[]) {
  const last = Math.max(-1, ...nightsOf(walks).map((w) => w.day));
  return nightsOf(walks)
    .filter((w) => w.day === last)
    .map((w) => ({ at: w.steps[0].hour, to: destination(w), minutes: Math.round(w.steps.reduce((s, x) => s + x.dwellS, 0) / 60) }));
}
