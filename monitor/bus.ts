// Typed in-process event bus. Every module talks through this.

import type { BusEvents } from "@/lib/types";
import { log } from "./log";

export type BusEvent = keyof BusEvents;
export const BUS_EVENTS: BusEvent[] = ["frame", "position", "location", "prediction", "risk", "patient"];

type Listener<K extends BusEvent> = (payload: BusEvents[K]) => void;
type Guard = <K extends BusEvent>(event: K, payload: BusEvents[K]) => boolean;

export class Bus {
  private listeners = new Map<BusEvent, Set<Listener<never>>>();
  private guards: Guard[] = [];

  on<K extends BusEvent>(event: K, fn: Listener<K>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(fn as Listener<never>);
    this.listeners.set(event, set);
    return () => set.delete(fn as Listener<never>);
  }

  // A guard that returns false drops the event. The sim lock uses this to silence BLE for a while.
  guard(fn: Guard) {
    this.guards.push(fn);
  }

  emit<K extends BusEvent>(event: K, payload: BusEvents[K]): boolean {
    if (!this.guards.every((g) => g(event, payload))) return false;
    for (const fn of this.listeners.get(event) ?? []) {
      // One module's bug must not stop the others from hearing the event.
      try {
        (fn as Listener<K>)(payload);
      } catch (e) {
        log("bus", `listener for ${event} threw`, e);
      }
    }
    return true;
  }
}
