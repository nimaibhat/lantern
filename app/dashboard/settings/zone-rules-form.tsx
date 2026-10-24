"use client";

import { useState, useTransition } from "react";
import { saveZoneRules } from "@/lib/dashboard/actions";
import { ACTIONS, checkRules, hourLabel, ROOM_KINDS, type RuleInput } from "@/lib/dashboard/zone-rules";

// What Lantern does in each kind of room, and when. Saved to Supabase; the monitor reloads the rules right away.

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const anyTime = (r: RuleInput) => r.startHour === 0 && r.endHour === 24;

export function ZoneRulesForm({ rules: initial }: { rules: RuleInput[] }) {
  const [rules, setRules] = useState<RuleInput[]>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const problem = checkRules(rules);
  const changed = JSON.stringify(rules) !== saved;

  const update = (i: number, patch: Partial<RuleInput>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function save(e: React.FormEvent) {
    e.preventDefault();
    setNote("");
    start(async () => {
      try {
        await saveZoneRules(rules);
        setSaved(JSON.stringify(rules));
        setNote("Saved. Lantern uses the new rules from the next move.");
      } catch (err) {
        setNote((err as Error).message);
      }
    });
  }

  return (
    <form onSubmit={save}>
      <p className="muted">When the person walks into a room during these hours, this is what Lantern does. Hours are the home&apos;s local time.</p>
      <ul className="rule-list">
        {rules.map((r, i) => (
          <li key={i} className="rule-row">
            <label>
              Room
              <select value={r.roomKind} onChange={(e) => update(i, { roomKind: e.target.value as RuleInput["roomKind"] })}>
                {ROOM_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
            </label>
            <label>
              Lantern will
              <select value={r.action} onChange={(e) => update(i, { action: e.target.value as RuleInput["action"] })}>
                {ACTIONS.map((a) => <option key={a.action} value={a.action}>{a.label}</option>)}
              </select>
            </label>
            <label className="rule-check">
              <input type="checkbox" checked={anyTime(r)} onChange={(e) => update(i, e.target.checked ? { startHour: 0, endHour: 24 } : { startHour: 22, endHour: 6 })} />
              Any time
            </label>
            {!anyTime(r) && (
              <>
                <label>
                  From
                  <select value={r.startHour} onChange={(e) => update(i, { startHour: Number(e.target.value) })}>
                    {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                  </select>
                </label>
                <label>
                  Until
                  <select value={r.endHour % 24} onChange={(e) => update(i, { endHour: Number(e.target.value) })}>
                    {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                  </select>
                </label>
              </>
            )}
            <button type="button" className="btn small ghost" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label={`Remove rule ${i + 1}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="form-actions">
        <button type="button" className="btn small ghost" onClick={() => setRules([...rules, { roomKind: "kitchen", action: "redirect", startHour: 22, endHour: 6 }])}>
          Add a rule
        </button>
        <button className="btn" disabled={pending || !changed || !!problem}>
          {pending ? "Saving" : "Save rules"}
        </button>
        {changed && problem ? <span className="error">{problem}</span> : note && <span className="muted">{note}</span>}
      </div>
    </form>
  );
}
