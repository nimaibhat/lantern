// kNN room classifier on SensorFrame vectors. Trained by ml/train.py, which writes ml/out/knn.json.

export const MISSING = -100;

export interface KnnModel {
  kind: "knn";
  algo: "knn" | "baseline"; // train.py ships the baseline when kNN does not beat it
  k: number;
  order: string[]; // receiver ids, the column order of `vectors`
  rooms: string[];
  vectors: number[][];
  labels: string[];
  accuracy?: number;
  baselineAccuracy?: number;
  dataset?: "synthetic" | "real";
  createdAt?: string;
}

// Reorder a frame to the model's receiver order. A receiver the frame lacks counts as missing.
export function align(frame: { order: string[]; rssi: number[] }, order: string[]): number[] {
  const at = new Map(frame.order.map((id, i) => [id, frame.rssi[i]]));
  return order.map((id) => at.get(id) ?? MISSING);
}

export function flat(rooms: string[]): Record<string, number> {
  return Object.fromEntries(rooms.map((r) => [r, 1 / rooms.length]));
}

// Which receivers to compare. An online listener that hears nothing is evidence (the tag is far away); an
// unplugged one is not, so its column is left out instead of reading as -100.
export function usable(frame: { order: string[]; online: Record<string, boolean> }, order: string[]): boolean[] {
  return order.map((id) => frame.order.includes(id) && frame.online[id] !== false);
}

// Distance-weighted votes of the k nearest training vectors (sklearn weights="distance"), as a posterior over rooms.
export function knnPosterior(m: KnnModel, vec: number[], use?: boolean[]): Record<string, number> {
  if (vec.every((v, j) => v <= MISSING || use?.[j] === false)) return flat(m.rooms);

  const best: { d: number; label: string }[] = [];
  for (let i = 0; i < m.vectors.length; i++) {
    const v = m.vectors[i];
    let d = 0;
    for (let j = 0; j < v.length; j++) if (use?.[j] !== false) d += (v[j] - vec[j]) ** 2;
    if (best.length < m.k || d < best[best.length - 1].d) {
      best.push({ d, label: m.labels[i] });
      best.sort((a, b) => a.d - b.d);
      if (best.length > m.k) best.pop();
    }
  }

  const post: Record<string, number> = Object.fromEntries(m.rooms.map((r) => [r, 0]));
  const exact = best.filter((b) => b.d === 0);
  for (const b of exact.length ? exact : best) post[b.label] += exact.length ? 1 : 1 / Math.sqrt(b.d);
  const z = Object.values(post).reduce((s, v) => s + v, 0) || 1;
  for (const r in post) post[r] /= z;
  return post;
}
