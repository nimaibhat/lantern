"use client";

import { useEffect, useState } from "react";
import { BuildStage } from "./build-stage";
import { createHome, homeProgress, newPairCode, type HomeProgress, type NewHome } from "@/lib/dashboard/homes-actions";
import { MOBILITY_OPTIONS } from "@/lib/dashboard/mobility";
import type { Mobility } from "@/lib/types";

const POLL_MS = 3000;

export function AddHome({ address }: { address: string }) {
  const [name, setName] = useState("");
  const [patientName, setPatientName] = useState("");
  const [mobility, setMobility] = useState<Mobility>("none");
  const [home, setHome] = useState<NewHome & { name: string }>();
  const [progress, setProgress] = useState<HomeProgress>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const made = await createHome({ name, patientName, mobility, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      setHome({ ...made, name: name.trim() });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshCode() {
    if (!home) return;
    try {
      setHome({ ...home, ...(await newPairCode(home.id)) });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  // Watch for the phone's upload once the home exists. Stops when the scan is done or failed.
  useEffect(() => {
    if (!home || progress?.scan === "done" || progress?.scan === "failed") return;
    let stopped = false;
    const poll = async () => {
      try {
        const p = await homeProgress(home.id);
        if (!stopped) setProgress(p);
      } catch {}
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [home, progress?.scan]);

  const step = !home ? 1 : !progress || progress.scan === "waiting" ? 2 : 3;

  return (
    <div className="add-home">
      <h1>Add a home</h1>
      <p className="add-lede">
        One walk through the home with an iPhone gives you a measured floor plan, an accessibility check an occupational therapist can review, and the hazards Claude spots in the room photos.
      </p>

      <ol className="add-steps">
        <li className={step === 1 ? "now" : "done"}>
          <h2>Name the home</h2>
          {!home ? (
            <form onSubmit={create} className="add-form">
              <label>
                Home name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Demo home" maxLength={60} required />
              </label>
              <label>
                First name of the person who lives there
                <input value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="Patient" maxLength={40} required />
              </label>
              <label>
                How they get around
                <select value={mobility} onChange={(e) => setMobility(e.target.value as Mobility)}>
                  {MOBILITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn" disabled={busy}>
                {busy ? "Creating home" : "Create home"}
              </button>
              {error && <p className="add-error">{error}</p>}
            </form>
          ) : (
            <p className="muted">{home.name} is created. It is saved in this browser.</p>
          )}
        </li>

        <li className={step === 2 ? "now" : step > 2 ? "done" : undefined}>
          <h2>Pair the Lantern app</h2>
          {home && (
            <>
              <p>On an iPhone with LiDAR (iPhone 12 Pro or a newer Pro), open Lantern, go to the Scan tab, and enter:</p>
              <dl className="add-pair">
                <div>
                  <dt>Website address</dt>
                  <dd>
                    <span>{address}</span>
                    <button className="btn ghost small" onClick={copy}>
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Pairing code</dt>
                  <dd className="add-code">{home.code}</dd>
                </div>
              </dl>
              <p className="muted">
                The code works for 24 hours. The phone must be able to reach this address.{" "}
                <button className="linkish" onClick={refreshCode}>
                  Get a new code
                </button>
              </p>
              {error && <p className="add-error">{error}</p>}
            </>
          )}
        </li>

        <li className={step === 3 ? "now" : undefined}>
          <h2>Scan, then upload</h2>
          {home && (
            <>
              <p>Name each room, walk it slowly along the walls, and take 2 to 4 photos. Scan every room in one go, then tap Upload.</p>
            </>
          )}
        </li>
      </ol>

      {home && <BuildStage name={home.name} progress={progress} homeHref={`/dashboard/h/${home.id}`} />}
    </div>
  );
}
