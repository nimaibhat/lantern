import type { MetricsReport } from "@/lib/types/inference";
import raw from "@/ml/out/metrics.json";
import { LivePanel } from "./live-panel";
import "./models.css";
import { pct, roomName as room } from "./names";

// Written by python ml/report.py. Every number shown here comes from that file; nothing is hidden or rounded up.
const m = raw as MetricsReport;

const MODEL_NAMES: Record<string, string> = {
  baseline: "Strongest receiver", knn3: "kNN, k = 3", knn5: "kNN, k = 5", knn7: "kNN, k = 7", rf: "Random forest",
};
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b), i = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2) : 0;
};

export default function ModelsPage() {
  const p = m.pipeline;
  const synthetic = m.dataset === "synthetic";
  const shipsBaseline = m.shipped === "baseline";

  return (
    <div className="models">
      <div className="page-head">
        <div>
          <h1>Models</h1>
          <p className="muted">How Lantern works out which room the person is in, and how often it gets it right.</p>
        </div>
        {synthetic && <span className="badge m-sim">Simulated data</span>}
      </div>

      {synthetic && (
        <p className="m-note">
          These numbers come from simulated Bluetooth readings over the demo floor plan, not a real home. They are
          replaced as soon as real calibration data is trained.
        </p>
      )}

      <section className="m-kpis">
        <div className="card">
          <p className="eyebrow">Room accuracy</p>
          <span className="stat">{pct(m.accuracy)}</span>
          <p className="muted">Strongest receiver alone: {pct(m.baselineAccuracy)}</p>
        </div>
        <div className="card">
          <p className="eyebrow">Room change noticed after</p>
          <span className="stat">{(m.latencyMs / 1000).toFixed(1)} s</span>
          <p className="muted">Median, from walking through a door</p>
        </div>
        <div className="card">
          <p className="eyebrow">Heads-up before arriving</p>
          <span className="stat">{Math.round(median(m.leadTimesS))} s</span>
          <p className="muted">{p ? `${p.predictionsCorrect} of ${p.predictions} predictions right` : "No replay yet"}</p>
        </div>
        <div className="card">
          <p className="eyebrow">False alarms</p>
          <span className="stat">{m.falseRedirectsPerNight.toFixed(2)}</span>
          <p className="muted">Per night: kitchen or front door shown while the person was elsewhere</p>
        </div>
      </section>

      <div className="m-grid">
        <LivePanel />

        <section className="card">
          <div className="card-head">
            <h2>Which classifier ships</h2>
            <span className="mono muted">cross-validated by session</span>
          </div>
          <Bars rows={Object.entries(m.models ?? {}).map(([id, v]) => ({ id, label: MODEL_NAMES[id] ?? id, value: v }))} highlight={m.shipped} />
          <p className="m-foot">
            {shipsBaseline
              ? "kNN did not beat the strongest receiver, so the simpler rule ships."
              : `${MODEL_NAMES[m.shipped ?? ""] ?? m.shipped} ships: ${Math.round((m.accuracy - m.baselineAccuracy) * 100)} points better than the strongest receiver. The random forest is for comparison; the monitor runs kNN.`}
          </p>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Where it gets confused</h2>
            <span className="mono muted">rows add to 100%</span>
          </div>
          <Confusion labels={m.labels} confusion={m.confusion} />
          <p className="m-foot">Rows are the room the person was really in; columns are what the classifier said.</p>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Accuracy by room</h2>
          </div>
          <div className="m-legend">
            <span><i className="m-swatch m-accent" /> Shipped model</span>
            <span><i className="m-swatch m-context" /> Strongest receiver</span>
          </div>
          <ul className="m-rooms">
            {m.labels.map((id) => {
              const model = m.perRoom[id] ?? 0, base = m.baselinePerRoom?.[id] ?? 0;
              return (
                <li key={id} title={`${room(id)}: model ${pct(model)}, strongest receiver ${pct(base)}`}>
                  <span>{room(id)}</span>
                  <span className="m-pair">
                    <span className="m-bar m-accent" style={{ width: `${model * 100}%` }} />
                    <span className="m-bar m-context" style={{ width: `${base * 100}%` }} />
                  </span>
                  <span className="mono">{pct(model)} <span className="muted">vs {pct(base)}</span></span>
                </li>
              );
            })}
          </ul>
          <p className="m-foot">Rooms with no listener of their own are the hardest to tell apart.</p>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>The floor plan as a filter</h2>
            <span className="mono muted">{p ? `${p.sessions} replayed night routes` : ""}</span>
          </div>
          {p ? (
            <>
              <table className="m-table">
                <thead>
                  <tr><th /><th>With door graph</th><th>Without</th></tr>
                </thead>
                <tbody>
                  <tr><td>Room right, second by second</td><td>{pct(p.roomAccuracy)}</td><td>{pct(p.roomAccuracyNoHmm)}</td></tr>
                  <tr><td>Impossible jumps (through a wall)</td><td>{p.impossibleJumps}</td><td>{p.impossibleJumpsNoHmm}</td></tr>
                  <tr><td>Room changes logged (really {p.trueRoomChanges})</td><td>{p.roomChanges}</td><td>{p.roomChangesNoHmm ?? "-"}</td></tr>
                  {p.positionErrorIn !== undefined && (
                    <tr>
                      <td>Avatar position error, median</td>
                      <td colSpan={2}>
                        {p.positionErrorIn} in ({(p.positionErrorIn / 39.37).toFixed(1)} m)
                        {p.positionErrorRoomCenterIn !== undefined && <span className="muted"> vs {p.positionErrorRoomCenterIn} in parked mid-room</span>}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="m-foot">
                The room is reliable; the spot inside it is a rough estimate.{" "}
                The scan&apos;s doors decide which moves are possible, so the person never appears to jump from the bedroom
                to the kitchen.{" "}
                {p.roomAccuracy < p.roomAccuracyNoHmm
                  ? `It waits for a little more evidence, which costs ${Math.round((p.roomAccuracyNoHmm - p.roomAccuracy) * 1000) / 10} points of second-by-second accuracy.`
                  : `It also adds ${Math.round((p.roomAccuracy - p.roomAccuracyNoHmm) * 1000) / 10} points of second-by-second accuracy.`}
              </p>
            </>
          ) : (
            <p className="muted">Run npx tsx tools/vineet-replay.ts, then python ml/report.py.</p>
          )}
        </section>

        {m.unplugged && (
          <section className="card">
            <div className="card-head">
              <h2>If one listener is unplugged</h2>
              <span className="mono muted">failure drill</span>
            </div>
            <table className="m-table">
              <thead>
                <tr><th>Unplugged</th><th>Room right</th><th>Before the fix</th><th>False alarms</th></tr>
              </thead>
              <tbody>
                {Object.entries(m.unplugged).map(([id, u]) => (
                  <tr key={id}>
                    <td>{room(id)}</td>
                    <td>{pct(u.accuracy)}</td>
                    <td className="muted">{pct(u.accuracyUnmasked)}</td>
                    <td>{u.falseRedirects} <span className="muted">(was {u.falseRedirectsUnmasked})</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="m-foot">
              A listener with no heartbeat is left out of the comparison instead of reading as &quot;the tag is far away&quot;.
              With everything plugged in: {p ? pct(p.roomAccuracy) : pct(m.accuracy)}.
            </p>
          </section>
        )}

        <section className="card m-wide">
          <div className="card-head">
            <h2>How early the next room is predicted</h2>
            <span className="mono muted">{m.leadTimesS.length} correct predictions</span>
          </div>
          <LeadTimes values={m.leadTimesS} />
          <p className="m-foot">
            Each dot is a correct prediction, placed by how many seconds before the person arrived it was made. The
            predictor learns from {synthetic ? "simulated" : "recorded"} weeks of movement and weighs recent nights more.
          </p>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Retrain</h2>
          <span className="mono muted">{m.generatedAt ? `report from ${m.generatedAt.slice(0, 16).replace("T", " ")} UTC` : ""}</span>
        </div>
        <pre className="m-code">{`python ml/train.py                # kNN vs the strongest receiver; uses fixtures/rssi-samples.csv once it exists
python ml/train_markov.py         # next-room predictor
npx tsx tools/vineet-replay.ts    # replays night routes through the monitor's own inference code
python ml/report.py               # rewrites this page's numbers
curl -X POST localhost:8787/model/reload`}</pre>
      </section>
    </div>
  );
}

function Bars({ rows, highlight }: { rows: { id: string; label: string; value: number }[]; highlight?: string }) {
  return (
    <ul className="m-bars">
      {rows.map((r) => (
        <li key={r.id} title={`${r.label}: ${pct(r.value)}`}>
          <span>{r.label}</span>
          <span className="m-track">
            <span className={r.id === highlight ? "m-bar m-accent" : "m-bar m-context"} style={{ width: `${r.value * 100}%` }} />
          </span>
          <span className="mono">{pct(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function Confusion({ labels, confusion }: { labels: string[]; confusion: number[][] }) {
  return (
    <div className="m-heat-wrap">
      <div className="m-heat" style={{ gridTemplateColumns: `auto repeat(${labels.length}, minmax(44px, 1fr))` }}>
        <span />
        {labels.map((l) => <span key={l} className="m-heat-col">{room(l)}</span>)}
        {confusion.map((row, i) => {
          const total = row.reduce((s, v) => s + v, 0) || 1;
          return [
            <span key={`r${i}`} className="m-heat-row">{room(labels[i])}</span>,
            ...row.map((v, j) => {
              const share = v / total;
              return (
                <span
                  key={`${i}-${j}`}
                  className={share > 0.55 ? "m-cell strong" : "m-cell"}
                  style={{ background: `color-mix(in srgb, var(--m-accent) ${Math.round(share * 100)}%, var(--d-bg))` }}
                  title={`Really ${room(labels[i])}, said ${room(labels[j])}: ${v} of ${total} windows`}
                >
                  {v ? (share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`) : ""}
                </span>
              );
            }),
          ];
        })}
      </div>
    </div>
  );
}

function LeadTimes({ values }: { values: number[] }) {
  if (!values.length) return <p className="muted">No correct predictions in the replay yet.</p>;
  const max = Math.max(30, Math.ceil(Math.max(...values) / 10) * 10);
  const at = (v: number) => `${(Math.max(v, 0) / max) * 100}%`;
  const med = median(values);
  // Dots that land on the same second stack upward so none hide another
  const seen = new Map<number, number>();
  const dots = [...values].sort((a, b) => a - b).map((v) => {
    const k = Math.round(v), n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return { v, n };
  });
  return (
    <div className="m-strip" role="img" aria-label={`Lead times in seconds: ${values.join(", ")}`}>
      <span className="m-median" style={{ left: at(med) }}><span className="mono muted">median {Math.round(med)} s</span></span>
      {dots.map((d, i) => (
        <span key={i} className="m-dot" style={{ left: at(d.v), bottom: 6 + d.n * 12 }} title={`Predicted ${d.v} s before arriving`} />
      ))}
      {Array.from({ length: max / 10 + 1 }, (_, i) => i * 10).map((t) => (
        <span key={t} className="m-tick mono muted" style={{ left: at(t) }}>{t} s</span>
      ))}
    </div>
  );
}
