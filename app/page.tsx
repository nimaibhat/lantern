import { EnterButton } from "./enter-button";
import { GlitchCanvas } from "./glitch-canvas";
import { LandingEffects } from "./landing-effects";

const problems = [
  {
    icon: "⌂",
    head: "The home is unaudited",
    body: "Most families don't know what's dangerous until something happens. Professional home assessments are expensive and hard to schedule.",
  },
  {
    icon: "◷",
    head: "The day has no structure they can read",
    body: "Confusion about what comes next drives anxiety and repeated questions. Generic schedule apps don't look like their own home.",
  },
  {
    icon: "◎",
    head: "Nobody can watch 24/7",
    body: "Exit-seeking, kitchen visits, sundowning and night wandering happen while caregivers are busy or asleep.",
  },
  {
    icon: "!",
    head: "Alarms fire too late",
    body: "Door alarms go off once the person is already leaving. By then, the caregiver is reacting instead of preventing.",
  },
];

const layers = [
  { label: "LiDAR", caption: "RoomPlan measures every room, door and object to the inch. The source of truth." },
  { label: "Gaussian splat", caption: "A photoreal capture of the real home, used for the dashboard and familiar images." },
  { label: "World model", caption: "Previews the fixes: a stove guard, a stair gate, a wider doorway." },
];

const features = [
  { head: "Hazard audit", body: "Claude vision flags stoves, stairs, rugs and unlocked doors, then ranks the fixes." },
  { head: "Accessibility check", body: "Door widths, hallways, turning space, grab bars and handrails against ADA guidelines." },
  { head: "Familiar routine", body: "Real photos of their own rooms show what comes next, from breakfast to bedtime." },
  { head: "Home monitor", body: "Zone rules by room and time of day. Bathroom trips are lit, risky zones get a redirect." },
  { head: "Room-level ML", body: "A classifier trained on RSSI fingerprints from three ESP32s, plus destination prediction." },
  { head: "Private by design", body: "Room-level location only. No cameras or audio after the one-time scan." },
];

const ladder = [
  { time: "15:42:10", event: "bedroom → hallway", detail: "predicted: front door 81%", status: "watch" },
  { time: "15:42:14", event: "hallway light on", detail: "smart bulb", status: "step 1" },
  { time: "15:42:15", event: "familiar voice plays", detail: "recorded by family", status: "step 2" },
  { time: "15:42:58", event: "hallway → bedroom", detail: "redirect worked", status: "resolved" },
  { time: "15:43:00", event: "caregiver not disturbed", detail: "logged to dashboard", status: "done" },
];

export default function Home() {
  return (
    <>
      <LandingEffects />

      <div className="hero-frame">
        <div className="video-bg">
          <video id="hero-video" autoPlay muted loop playsInline preload="auto" poster="/lantern-hero.jpg">
            <source src="/lantern-hero.mp4" type="video/mp4" />
          </video>
          <GlitchCanvas videoId="hero-video" />
        </div>
        <div className="hero-copy">
          <p className="hero-sub">Dementia home safety, built on one scan of the real home.</p>
          <EnterButton listenForEnter />
        </div>
      </div>

      <h1 className="title-floating">Lantern</h1>
      <header className="navbar" aria-hidden="true" />

      <main className="content">
        <section className="hero-spacer" aria-hidden="true" />

        <section className="cs-section reveal">
          <div className="cs-inner">
            <h2 className="cs-heading">
              Caregivers can&apos;t be everywhere.<br />
              <em>The home can help.</em>
            </h2>
            <div className="problem-grid">
              {problems.map((p, i) => (
                <div key={p.head} className="problem-card reveal-child" style={{ "--delay": `${i * 60}ms` } as React.CSSProperties}>
                  <span className="problem-icon">{p.icon}</span>
                  <div>
                    <p className="problem-head">{p.head}</p>
                    <p className="problem-body">{p.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="cs-section reveal">
          <div className="cs-inner">
            <h2 className="cs-heading">
              One scan, <em>three layers</em>
            </h2>
            <p className="cs-sub">LiDAR measures it. Gaussian splatting shows it. The world model previews the fix.</p>
            <div className="cs-three-col">
              {layers.map((l, i) => (
                <div key={l.label} className="cs-card reveal-child" style={{ "--delay": `${i * 80}ms` } as React.CSSProperties}>
                  <p className="cs-card-label">{l.label}</p>
                  <p className="cs-card-caption">{l.caption}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="cs-section reveal">
          <div className="cs-inner">
            <div className="bento">
              <div className="bento-cell bento-title">
                <h2>Everything runs on<br />the model of their home</h2>
              </div>
              {features.map((f) => (
                <div key={f.head} className="bento-cell">
                  <h3>{f.head}</h3>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="cs-section reveal">
          <div className="cs-inner">
            <h2 className="cs-heading">
              Respond first. <em>Alert only when it matters.</em>
            </h2>
            <p className="cs-sub">A gentle redirect in a familiar voice comes first. The caregiver is alerted, with full context, only if it doesn&apos;t work.</p>
            <div className="log reveal-child">
              <div className="log-chrome">
                <span className="log-dot" />
                <span className="log-dot" />
                <span className="log-dot" />
                <span className="log-title">lantern / live</span>
              </div>
              {ladder.map((row) => (
                <div key={row.time} className="log-row">
                  <span className="log-time">{row.time}</span>
                  <span className="log-event">{row.event}</span>
                  <span className="log-detail">{row.detail}</span>
                  <span className={row.status === "resolved" ? "log-status log-ok" : "log-status"}>{row.status}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="cs-section cs-cta reveal">
          <div className="cs-inner cs-cta-inner">
            <h2 className="cs-cta-head">
              A light on<br />
              <em>when it matters.</em>
            </h2>
            <p className="cs-cta-sub">Built at Hack Ohio 2026.</p>
            <EnterButton />
          </div>
        </section>

        <footer className="cs-footer">
          <span className="cs-footer-brand">Lantern</span>
          <span className="cs-footer-note">© 2026 Lantern · Hack Ohio</span>
        </footer>
      </main>

      <div id="burst" aria-hidden="true" />
    </>
  );
}
