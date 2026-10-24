import { spawn, type ChildProcess } from "node:child_process";

// This laptop has one Bluetooth radio. It can advertise as the tag, or scan as a listener, not both.
// The dashboard starts the python process locally. Nothing here is reachable as a useful action from another machine
// beyond what the already-running dev server can do.

const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/i;

export function deviceSlug(value: string) {
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 41);
  return SLUG.test(slug) ? slug : "";
}

type Radio = { tag: ChildProcess | null; listener: ChildProcess | null; listenerId: string | null };
const slot: Radio = ((globalThis as unknown as { lanternRadio?: Radio }).lanternRadio ??= {
  tag: null,
  listener: null,
  listenerId: null,
});

const alive = (p: ChildProcess | null) => !!p && p.exitCode === null && !p.killed;

function stop(p: ChildProcess | null) {
  if (!p?.pid || !alive(p)) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    p.kill();
  }
}

function start(args: string[]) {
  return spawn("py", ["-u", ...args], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: "ignore",
  });
}

export async function GET() {
  if (!alive(slot.tag)) slot.tag = null;
  if (!alive(slot.listener)) {
    slot.listener = null;
    slot.listenerId = null;
  }
  return Response.json({ tag: !!slot.tag, listenerId: slot.listenerId });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const action = body && typeof body === "object" ? (body as { action?: string }).action : undefined;

  if (action === "stop") {
    stop(slot.tag);
    stop(slot.listener);
    slot.tag = null;
    slot.listener = null;
    slot.listenerId = null;
    return Response.json({ tag: false, listenerId: null });
  }

  if (action === "tag") {
    stop(slot.listener);
    slot.listener = null;
    slot.listenerId = null;
    if (!alive(slot.tag)) slot.tag = start(["listener/advertise.py"]);
    return Response.json({ tag: true, listenerId: null });
  }

  if (action === "listen") {
    const id = deviceSlug(typeof body.id === "string" ? body.id : "");
    if (!id) return Response.json({ error: "Use a short name, like bedroom or living-room." }, { status: 400 });
    stop(slot.tag);
    slot.tag = null;
    stop(slot.listener);
    const token = process.env.LISTENER_TOKEN || "change-me";
    slot.listener = start(["listener/listener.py", "--id", id, "--token", token]);
    slot.listenerId = id;
    return Response.json({ tag: false, listenerId: id });
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
