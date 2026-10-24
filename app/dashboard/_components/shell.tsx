"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV } from "./nav.config";

// Sidebar, top bar, and the day/night switch. Night is remembered per browser.
export function Shell({ householdName, children }: { householdName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [night, setNight] = useState(false);

  useEffect(() => {
    try {
      setNight(localStorage.getItem("lantern-night") === "1");
    } catch {}
  }, []);

  function toggleNight() {
    setNight(!night);
    try {
      localStorage.setItem("lantern-night", night ? "0" : "1");
    } catch {}
  }

  return (
    <div className={night ? "dash night" : "dash"}>
      <aside className="sidebar">
        <Link href="/" className="brand">
          Lantern
        </Link>
        <nav>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href)) ? "active" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <Link href="/routine" className="patient-link">
          Patient view →
        </Link>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">{householdName}</p>
            <p className="status">
              <span className="status-dot" /> Monitoring
            </p>
          </div>
          <div className="top-actions">
            {pathname === "/dashboard" && (
              <Link href="/dashboard/tracking" className="btn">Tracking</Link>
            )}
            <button className="btn ghost" onClick={toggleNight} suppressHydrationWarning>
              {night ? "Day mode" : "Night mode"}
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
