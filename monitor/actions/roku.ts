// Roku External Control Protocol (Part 6 step 3). The TV shows /routine (cast or HDMI); ECP only wakes it.
// No ROKU_HOST: every call is logged instead of sent. Network errors are logged, never thrown at the responder.

type Log = (tag: string, ...args: unknown[]) => void;

export class RokuClient {
  constructor(private host: string | undefined, private log: Log) {}

  get configured() {
    return !!this.host;
  }

  private async ecp(path: string, method: "GET" | "POST" = "GET"): Promise<string | undefined> {
    if (!this.host) {
      this.log("roku", "dry run", method, path);
      return;
    }
    try {
      const res = await fetch(`http://${this.host}:8060${path}`, { method, signal: AbortSignal.timeout(3000) });
      return res.ok ? await res.text() : undefined;
    } catch (e) {
      this.log("roku", path, "failed:", (e as Error).message);
    }
  }

  info() {
    return this.ecp("/query/device-info");
  }

  // Roku TVs report their power mode; a streaming stick has no power to turn on, so this is a no-op there.
  async wake() {
    const info = await this.info();
    if (info && /<power-mode>(DisplayOff|Standby)/i.test(info)) await this.ecp("/keypress/PowerOn", "POST");
  }
}
