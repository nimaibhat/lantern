import Link from "next/link";
import { listHomes, type HomeCard } from "@/lib/dashboard/homes";
import "./_homes/homes.css";
import { EmberField } from "./_homes/ember-field";
import { PlanThumb } from "./_homes/plan-thumb";

// /dashboard: every home this browser can open, over slow ember waves. The demo home comes first.
// Each home's own dashboard starts at /dashboard/h/<id> (which opens it and goes to its overview).

const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;

function HomeTile({ home }: { home: HomeCard }) {
  const rooms = home.model.rooms.filter((r) => !r.virtual).length;
  const status = home.scanned
    ? `${plural(rooms, "room")}, ${n(home.areaSqFt)} sq ft, ${plural(home.ruleIssues + home.photoHazards, "thing")} to fix`
    : home.scanStatus === "processing"
      ? "Scan arriving"
      : home.scanStatus === "failed"
        ? "The last scan could not be read. Scan again."
        : "Waiting for the first scan";
  return (
    <li>
      <a href={`/dashboard/h/${home.id}`} className="home-tile">
        <PlanThumb home={home.model} />
        <span className="home-tile-name">{home.name}</span>
        <span className="home-tile-status">{status}</span>
        {home.demo && <span className="home-tile-tag">{home.readOnly ? "Live demo, view only" : "Live demo"}</span>}
      </a>
    </li>
  );
}

export default async function HomesPage() {
  const homes = await listHomes();

  return (
    <div className="homes">
      <EmberField />
      <header className="homes-top">
        <Link href="/" className="homes-brand">
          Lantern
        </Link>
      </header>

      <section className="homes-list" aria-labelledby="homes-list-title">
        <h1 id="homes-list-title">Homes</h1>
        <ul className="homes-grid">
          {homes.map((h) => (
            <HomeTile key={h.id} home={h} />
          ))}
          <li>
            <Link href="/dashboard/new" className="home-tile add">
              <span className="home-add-mark" aria-hidden>
                +
              </span>
              <span className="home-tile-name">Add a home</span>
              <span className="home-tile-status">Scan any home with a LiDAR iPhone and get its safety audit in minutes.</span>
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
