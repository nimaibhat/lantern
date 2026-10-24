import { getRooms } from "@/lib/dashboard/data";
import { PrintButton } from "./print-button";
import "./signs.css";

export const dynamic = "force-dynamic";

// Door signs from the scan (docs/cues.md): one per room, a real photo of the room and its name in large type, to tape
// on each door. Labels on doors are one of the simplest wayfinding aids for people living with dementia.
export default async function SignsPage() {
  const rooms = await getRooms();
  return (
    <main className="signs">
      <header className="signs-head">
        <div>
          <h1>Door signs</h1>
          <p>One sign per scanned room. Print, cut on the line, and tape each one at eye level on its door.</p>
        </div>
        <PrintButton />
      </header>
      {rooms.length === 0 && <p>No rooms yet. Scan the home first.</p>}
      <div className="sign-grid">
        {rooms.map((r) => (
          <section key={r.id} className={r.photoUrls?.[0] ? "sign" : "sign name-only"}>
            {r.photoUrls?.[0] && <img src={r.photoUrls[0]} alt="" />}
            <h2>{r.name}</h2>
          </section>
        ))}
      </div>
    </main>
  );
}
