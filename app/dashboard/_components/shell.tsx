"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV } from "./nav.config";

// The Homes page (/dashboard) and Add a home (/dashboard/new) are full-screen, outside the sidebar.
const BARE = (path: string) => path === "/dashboard" || path.startsWith("/dashboard/new");

// Sidebar, top bar, and the day/night switch. Night is remembered per browser.
export function Shell({ householdName, readOnly, monitored = true, children }: { householdName: string; readOnly?: boolean; monitored?: boolean; children: React.ReactNode }) {
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

  if (BARE(pathname)) return <div className="dash bare">{children}</div>;


  return (
    <div className={night ? "dash night" : "dash"}>
      <aside className="sidebar">
        <Link href="/" className="brand">
          Lantern
        </Link>
        <Link href="/dashboard" className="homes-link">
          All homes
        </Link>
        <nav>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={pathname.startsWith(item.href) ? "active" : undefined}>
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
            <p className="eyebrow">{householdName}{readOnly && <span className="readonly-tag">Shared demo, view only</span>}</p>
            {monitored ? (
              <p className="status">
                <span className="status-dot" /> Monitoring
              </p>
            ) : (
              <p className="status muted">Scan and audits. Live monitoring needs the room listeners.</p>
            )}
          </div>
          <div className="top-actions">
            {pathname === "/dashboard/overview" && (
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
