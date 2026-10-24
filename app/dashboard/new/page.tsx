import { networkInterfaces } from "node:os";
import { headers } from "next/headers";
import Link from "next/link";
import "../_homes/homes.css";
import { AddHome } from "./add-home";

// /dashboard/new: add a home, pair the Lantern app, watch the scan arrive.

// The address the phone types in. A phone cannot reach "localhost", so in local dev use this Mac's network address.
async function siteAddress(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  if (!/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) return `${proto}://${host}`;
  const port = host.split(":")[1] ?? "3000";
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal);
  return lan ? `http://${lan.address}:${port}` : `http://${host}`;
}

export default async function NewHomePage() {
  return (
    <div className="new-home">
      <header className="homes-top">
        <Link href="/dashboard" className="homes-brand">
          Lantern
        </Link>
        <Link href="/dashboard" className="btn ghost">
          All homes
        </Link>
      </header>
      <AddHome address={await siteAddress()} />
    </div>
  );
}
