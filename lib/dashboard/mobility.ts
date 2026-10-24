import type { Mobility } from "@/lib/types";

// The choices on the add-home form and in Settings.
export const MOBILITY_OPTIONS: { value: Mobility; label: string }[] = [
  { value: "none", label: "Walks on their own" },
  { value: "cane", label: "Uses a cane" },
  { value: "walker", label: "Uses a walker" },
  { value: "wheelchair", label: "Uses a wheelchair" },
];

export const isMobility = (v: unknown): v is Mobility => MOBILITY_OPTIONS.some((o) => o.value === v);
