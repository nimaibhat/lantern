import type { SensorFrame } from "../../lib/types/sensing";

export class RssiWindow {
  private buf = new Map<string, { rssi: number; ts: number }[]>();

  constructor(
    private order: string[],
    private spanMs = 3000,
    private minSamples = 2,
  ) {}

  push(r: { receiverId: string; rssi: number; ts: number }) {
    const a = this.buf.get(r.receiverId) ?? [];
    a.push({ rssi: r.rssi, ts: r.ts });
    this.buf.set(r.receiverId, a);
  }

  vector(now: number): number[] {
    return this.order.map((id) => {
      const a = (this.buf.get(id) ?? []).filter((x) => now - x.ts <= this.spanMs);
      this.buf.set(id, a);
      if (a.length < this.minSamples) return -100;
      const s = a.map((x) => x.rssi).sort((p, q) => p - q);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    });
  }

  frame(now: number, online: Record<string, boolean>): SensorFrame {
    return { ts: now, order: this.order, rssi: this.vector(now), online };
  }
}
