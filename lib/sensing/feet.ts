// Same rough estimate as the bedroom vs living room test board:
// 3 ft at -50 dBm, path loss 2.8. It is a signal guess, so the UI says "about".

const NEAR_FT = 3;
const NEAR_DBM = -50;
const PATH_N = 2.8;

export function roughFeet(rssi: number): number {
  const d = NEAR_FT * 10 ** ((NEAR_DBM - rssi) / (10 * PATH_N));
  return Math.min(45, Math.max(0.5, d));
}

// How many times farther the quieter sensor is than the louder one, by the same path loss and without the clamps
// (two faint sensors are not equally far just because both are past 45 ft).
export function feetRatio(louder: number, quieter: number): number {
  return 10 ** ((louder - quieter) / (10 * PATH_N));
}
