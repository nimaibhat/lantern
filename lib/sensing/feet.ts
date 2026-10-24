// Same rough estimate as the bedroom vs living room test board:
// 3 ft at -50 dBm, path loss 2.8. It is a signal guess, so the UI says "about".

const NEAR_FT = 3;
const NEAR_DBM = -50;
const PATH_N = 2.8;

export function roughFeet(rssi: number): number {
  const d = NEAR_FT * 10 ** ((NEAR_DBM - rssi) / (10 * PATH_N));
  return Math.min(45, Math.max(0.5, d));
}
