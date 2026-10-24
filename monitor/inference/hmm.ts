// Door-graph HMM: the scan's doors decide which room changes are possible, so the person cannot jump
// from the bedroom to the kitchen without passing the hallway.

export function buildTransition(roomIds: string[], edges: [string, string][], stay = 0.9, eps = 1e-3): number[][] {
  const idx = new Map(roomIds.map((id, i) => [id, i]));
  const adj = roomIds.map(() => new Set<number>());
  for (const [a, b] of edges) {
    const i = idx.get(a), j = idx.get(b);
    if (i === undefined || j === undefined) continue; // door to a room the model no longer has
    adj[i].add(j);
    adj[j].add(i);
  }
  return roomIds.map((_, i) => {
    const row = roomIds.map((_, j) => (i === j ? stay : adj[i].has(j) ? (1 - stay) / Math.max(adj[i].size, 1) : eps));
    const z = row.reduce((s, v) => s + v, 0);
    return row.map((v) => v / z);
  });
}

// alpha_t(j) is proportional to emission_j * sum_i alpha_{t-1}(i) * T[i][j]
export function forward(alpha: number[], T: number[][], emission: number[]): number[] {
  const n = alpha.length, out = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += alpha[i] * T[i][j];
    out[j] = s * emission[j];
  }
  const z = out.reduce((a, b) => a + b, 0) || 1;
  return out.map((v) => v / z);
}

export class RoomHmm {
  private T: number[][];
  private alpha: number[];

  constructor(readonly rooms: string[], edges: [string, string][], stay = 0.9, eps = 1e-3) {
    this.T = buildTransition(rooms, edges, stay, eps);
    this.alpha = rooms.map(() => 1 / rooms.length);
  }

  // Emission = classifier posterior + 0.02, so one confident wrong frame cannot zero out the truth
  step(posterior: Record<string, number>): Record<string, number> {
    this.alpha = forward(this.alpha, this.T, this.rooms.map((r) => (posterior[r] ?? 0) + 0.02));
    return Object.fromEntries(this.rooms.map((r, i) => [r, this.alpha[i]]));
  }
}
