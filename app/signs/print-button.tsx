"use client";

export function PrintButton() {
  return (
    <button className="signs-print" onClick={() => window.print()}>
      Print
    </button>
  );
}
