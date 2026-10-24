// Markov destination predictor. Trained by ml/train_markov.py, which writes ml/out/markov.json.

export interface MarkovModel {
  kind: "markov";
  bucketHours?: number; // 3 = 8 buckets a day
  minTotal?: number; // a context needs at least this much (decayed) count to be trusted
  counts: Record<string, Record<string, number>>; // "prev>cur|bucket", "cur|bucket", "cur" -> next room -> count
  synthetic?: boolean;
}

export function predictNext(m: MarkovModel, prev: string | undefined, cur: string, hour: number) {
  const bucket = Math.floor(hour / (m.bucketHours ?? 3)) % 8;
  const keys = [`${cur}|${bucket}`, cur];
  if (prev) keys.unshift(`${prev}>${cur}|${bucket}`);
  for (const key of keys) { // back off from the most specific context
    const c = m.counts[key];
    if (!c) continue;
    const total = Object.values(c).reduce((s, v) => s + v, 0);
    if (total < (m.minTotal ?? 5)) continue;
    const [room, n] = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    return { nextRoomId: room, probability: n / total, key };
  }
}
