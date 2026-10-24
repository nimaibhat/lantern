import { getContacts, getHousehold, getReceivers, getRooms } from "@/lib/dashboard/data";
import { roomName } from "@/lib/dashboard/rooms";
import { HouseholdForm } from "./household-form";
import { PairPhone } from "./pair-phone";
import { RedirectMedia } from "./redirect-media";

export default async function SettingsPage() {
  const [household, contacts, receivers, rooms] = await Promise.all([getHousehold(), getContacts(), getReceivers(), getRooms()]);

  return (
    <div className="settings">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Household</h2>
        </div>
        <HouseholdForm household={household} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Who to contact</h2>
        </div>
        <ul className="rows">
          {contacts.map((c) => (
            <li key={c.id}>
              <strong>{c.name}</strong>
              <span className="muted">{c.relation}</span>
              <span className="mono">{c.phone}</span>
              <span className="badge">{c.priority === 1 ? "primary" : "backup"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Familiar voice and photo</h2>
        </div>
        <RedirectMedia />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Scanning app</h2>
        </div>
        <PairPhone />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Receivers</h2>
        </div>
        <ul className="rows">
          {receivers.map((r) => (
            <li key={r.id}>
              <strong>{r.label}</strong>
              <span className="muted">{roomName(rooms, r.roomId)}</span>
              <span className={r.online ? "badge resolved" : "badge escalated"}>{r.online ? "online" : "offline"}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
