"use client";

import { useState, useTransition } from "react";
import { setMobility } from "@/lib/dashboard/actions";
import { MOBILITY_OPTIONS } from "@/lib/dashboard/mobility";
import type { Mobility } from "@/lib/types";

// Saves on change and re-runs the accessibility checks for the new choice.
export function MobilityPicker({ name, initial }: { name: string; initial: Mobility }) {
  const [value, setValue] = useState(initial);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  function change(next: Mobility) {
    const previous = value;
    setValue(next);
    setNote("");
    start(async () => {
      try {
        const count = await setMobility(next);
        setNote(`Accessibility checks updated: ${count} ${count === 1 ? "finding" : "findings"}.`);
      } catch (e) {
        setValue(previous);
        setNote((e as Error).message);
      }
    });
  }

  return (
    <label>
      How {name} gets around
      <select value={value} onChange={(e) => change(e.target.value as Mobility)} disabled={pending}>
        {MOBILITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="muted">{pending ? "Updating the accessibility checks" : note || "Doors and turning space are checked for a walker or a wheelchair."}</span>
    </label>
  );
}
