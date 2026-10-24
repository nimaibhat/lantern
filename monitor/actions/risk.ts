// DEMO_HOUR (0 to 23) pins the hour, like the predictor in monitor/inference, so an afternoon demo plays the
// 3 AM story with quiet hours and night rules in force. The minutes still move, so events stay in order.
export function localMinutes(ts: number, timeZone: string, demoHour = process.env.DEMO_HOUR): number {
  const pinned = demoHour !== undefined && demoHour !== "" ? Number(demoHour) : NaN;
  const hour = Number.isInteger(pinned) && pinned >= 0 && pinned <= 23 ? pinned : get("hour");
  return hour * 60 + get("minute");
