"use client";

import { useState } from "react";
import { pairPhone } from "@/lib/dashboard/actions";

// Shows a one-day code to type into the Lantern Scan app on the iPhone.
export function PairPhone() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  async function create() {
    try {
      setCode((await pairPhone()).code);
      setError("");
    } catch {
      setError("Could not create a code. Check the Supabase settings.");
    }
  }

  return (
    <div className="pair">
      {code ? <span className="pair-code">{code}</span> : <p className="muted">Pair an iPhone to scan the home. Codes last 24 hours.</p>}
      <button className="btn" onClick={create}>
        {code ? "New code" : "Pair a phone"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
