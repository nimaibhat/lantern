"use client";

import { useState, useTransition } from "react";
import { saveHousehold } from "@/lib/dashboard/actions";
import type { Household } from "@/lib/types";
import { MobilityPicker } from "./mobility-picker";

export function HouseholdForm({ household }: { household: Household }) {
  const [form, setForm] = useState({
    name: household.name,
    patientName: household.patientName,
    quietHoursStart: household.quietHoursStart,
    quietHoursEnd: household.quietHoursEnd,
  });
  const [saved, setSaved] = useState(form);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  const changed = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== saved[k]);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setNote("");
    start(async () => {
      try {
        await saveHousehold(form);
        setSaved(form);
        setNote("Saved.");
      } catch (err) {
        setNote((err as Error).message);
      }
    });
  }

  return (
    <form onSubmit={save}>
      <div className="form-grid">
        <label>
          Home name
          <input value={form.name} onChange={set("name")} maxLength={60} required />
        </label>
        <label>
          Patient
          <input value={form.patientName} onChange={set("patientName")} maxLength={40} required />
        </label>
        <label>
          Quiet hours start
          <input type="time" value={form.quietHoursStart} onChange={set("quietHoursStart")} required />
        </label>
        <label>
          Quiet hours end
          <input type="time" value={form.quietHoursEnd} onChange={set("quietHoursEnd")} required />
        </label>
        <MobilityPicker name={saved.patientName} initial={household.mobility} />
      </div>
      <div className="form-actions">
        <button className="btn" disabled={pending || !changed}>
          {pending ? "Saving" : "Save"}
        </button>
        {note && <span className="muted">{note}</span>}
      </div>
    </form>
  );
}
