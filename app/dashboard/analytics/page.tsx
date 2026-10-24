import raw from "@/fixtures/walks.json";
import { kitchenAtNight, lastNight, roomByHour, tripsByWeek, type Walk } from "@/lib/analytics/history";
import { getHousehold } from "@/lib/dashboard/data";
import { getHomeModel } from "@/lib/world/store";
import "./analytics.css";
import { Tonight } from "./tonight";

// Night summaries and weekly trends (Part 6 step 9). The history is fixtures/walks.json: six synthetic weeks with
// 3 AM kitchen trips rising, labeled demo data. Tonight's outcomes come live from the monitor.
const walks = (raw as { walks: Walk[] }).walks;

// 4.75 -> "4:45 AM"
function clock(hour: number) {
  const h = Math.floor(hour) % 24, m = Math.round((hour % 1) * 60) % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;

function inQuietHours(hour: number, start: string, end: string) {
  const s = Number(start.slice(0, 2)), e = Number(end.slice(0, 2));
  return s > e ? hour >= s || hour < e : hour >= s && hour < e;
}

export default async function AnalyticsPage() {
  const [household, { model }] = await Promise.all([getHousehold(), getHomeModel()]);
  const names = Object.fromEntries(model.rooms.map((r) => [r.id, r.name]));
  const name = (id: string) => names[id] ?? id;

  const weeks = tripsByWeek(walks);
  const kitchen = kitchenAtNight(walks);
  const last = lastNight(walks);
  const lastWeek = weeks.at(-1);
  const byHour = roomByHour(walks);
  // Rooms in floor-plan order, then anything the history has that the plan does not.
  const order = [...model.rooms.map((r) => r.id).filter((id) => byHour.rooms.includes(id)), ...byHour.rooms.filter((id) => !names[id])];
  const maxWeek = Math.max(1, ...weeks.map((w) => w.total));
  const maxMinutes = Math.max(1, ...byHour.minutes.flat());
  const ratio = Number.isFinite(kitchen.ratio) ? `${kitchen.ratio.toFixed(1)}x` : "new";
  const p = household.patientName;

  return (
    <div className="analytics">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="muted">How nights have changed, when each room is used, and how tonight&apos;s responses ended.</p>
        </div>
        <span className="badge sim">Demo data</span>
      </div>

      <p className="a-note">
        The history on this page is six weeks of synthetic nights over the demo floor plan, so the charts have
        something to show before real nights are recorded. Tonight comes live from the monitor.
      </p>

      <section className="a-kpis">
        <div className="card a-insight">
          <p className="eyebrow">Kitchen trips at night</p>
          <span className="stat">{ratio}</span>
          <p className="muted">
            {kitchen.recent} in the last {kitchen.days} days, against {kitchen.baseline} in the first {kitchen.days}. Worth raising with
            {" "}{p}&apos;s care team.
          </p>
        </div>
        <div className="card">
          <p className="eyebrow">Last night</p>
          {last.length ? (
            <ul className="a-last">
              {last.map((t, i) => (
                <li key={i}>
                  <span className="stat">{clock(t.at)}</span>
                  <span className="muted">{t.to === "other" ? "Up and back" : name(t.to)}, {t.minutes} min</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Slept through.</p>
          )}
        </div>
        <div className="card">
          <p className="eyebrow">Night trips, latest week</p>
          <span className="stat">{lastWeek?.total ?? 0}</span>
          <p className="muted">{lastWeek ? `${lastWeek.kitchen} to the kitchen, ${lastWeek.bathroom} to the bathroom` : "No history yet"}</p>
        </div>
      </section>

      <Tonight roomNames={names} />

      <section className="card">
        <div className="card-head">
          <h2>Night trips by week</h2>
          <span className="mono muted">demo data</span>
        </div>
        <div className="a-legend">
          <span><i className="a-swatch a-accent" /> Kitchen</span>
          <span><i className="a-swatch a-context" /> Bathroom and other</span>
        </div>
        <ul className="a-weeks">
          {weeks.map((w) => (
            <li key={w.label} title={`${w.label}: ${w.kitchen} kitchen, ${w.bathroom} bathroom, ${w.other} other`}>
              <span>{w.label}</span>
              <span className="a-track">
                {w.kitchen > 0 && <span className="a-seg a-accent" style={{ width: `${(w.kitchen / maxWeek) * 100}%` }} />}
                {w.total - w.kitchen > 0 && <span className="a-seg a-context" style={{ width: `${((w.total - w.kitchen) / maxWeek) * 100}%` }} />}
              </span>
              <span className="mono">
                {w.kitchen} <span className="muted">of {w.total}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="a-foot">Bathroom trips at night are expected and only light the way. Kitchen trips are the ones Lantern redirects.</p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>When each room is used</h2>
          <span className="mono muted">average minutes per hour</span>
        </div>
        <div className="a-heat-wrap">
          <div className="a-heat" role="img" aria-label={`Average minutes per hour in each room. Busiest: ${name(order[0] ?? "")}.`}>
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className={inQuietHours(h, household.quietHoursStart, household.quietHoursEnd) ? "a-hour quiet" : "a-hour"}>
                {h % 3 === 0 ? hourLabel(h) : ""}
              </span>
            ))}
            {order.map((id) => {
              const row = byHour.minutes[byHour.rooms.indexOf(id)];
              return [
                <span key={id} className="a-room">{name(id)}</span>,
                ...row.map((m, h) => (
                  <span
                    key={`${id}-${h}`}
                    className="a-cell"
                    // Square root so a few minutes at 3 AM still shows next to an afternoon of TV.
                    style={{ background: m > 0.05 ? `color-mix(in srgb, var(--a-accent) ${Math.round(Math.sqrt(m / maxMinutes) * 100)}%, var(--d-bg))` : undefined }}
                    title={`${name(id)}, ${clock(h)}: ${m.toFixed(1)} min`}
                  />
                )),
              ];
            })}
          </div>
        </div>
        <p className="a-foot">
          Darker means more time. The scale is compressed so short night visits still show. Hours marked on top are quiet
          hours ({household.quietHoursStart} to {household.quietHoursEnd}).
        </p>
        <details className="a-table no-print">
          <summary>Show as a table</summary>
          <div className="a-heat-wrap">
            <table>
              <thead>
                <tr>
                  <th>Room</th>
                  {Array.from({ length: 24 }, (_, h) => <th key={h}>{hourLabel(h)}</th>)}
                </tr>
              </thead>
              <tbody>
                {order.map((id) => (
                  <tr key={id}>
                    <td>{name(id)}</td>
                    {byHour.minutes[byHour.rooms.indexOf(id)].map((m, h) => <td key={h}>{m < 0.05 ? "" : m.toFixed(1)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </div>
  );
}
