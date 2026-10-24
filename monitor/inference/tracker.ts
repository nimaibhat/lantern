// Hysteresis on the room belief: change rooms only after `steps` agreeing frames at or above `threshold`.
// With `hop`, a jump to a room that is not next door moves one door at a time (bedroom > hallway > kitchen),
// so the log never shows a move the floor plan does not allow.

export interface RoomChange { room: string; prev?: string; confidence: number }

export class RoomTracker {
  room?: string;
  confidence = 0;
  candidate?: string;
  private streak = 0;

  // fast: a belief this high changes rooms on one frame (the HMM has already demanded consistent evidence)
  constructor(private threshold = 0.6, private steps = 2, private hop?: (from: string, to: string) => string, private fast = Infinity) {}

  step(belief: Record<string, number>): RoomChange | undefined {
    let top = "", p = -1;
    for (const [id, v] of Object.entries(belief)) if (v > p) { top = id; p = v; }

    if (top === this.room || p < this.threshold) {
      this.candidate = undefined;
      this.streak = 0;
      if (this.room) this.confidence = belief[this.room] ?? 0;
      return;
    }
    this.streak = top === this.candidate ? this.streak + 1 : 1;
    this.candidate = top;
    if (this.streak < this.steps && p < this.fast) {
      if (this.room) this.confidence = belief[this.room] ?? 0;
      return;
    }

    const prev = this.room;
    const room = prev && this.hop ? this.hop(prev, top) : top;
    this.room = room;
    this.confidence = belief[room] ?? 0;
    // Still heading for `top`: the next agreeing frame takes the next door
    this.candidate = room === top ? undefined : top;
    this.streak = room === top ? 0 : this.steps - 1;
    return { room, prev, confidence: this.confidence };
  }

  reset() {
    this.room = this.candidate = undefined;
    this.confidence = this.streak = 0;
  }
}
