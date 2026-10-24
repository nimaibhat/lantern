// Finds Roku TVs on this network so setup can say "Lantern found your TV" (Part 6 step 3).
// npx tsx tools/find-roku.ts    then put the address in .env.local as ROKU_HOST
//
// SSDP multicast: venue Wi-Fi often blocks it. If nothing answers, join the hotspot with the TV (docs/runbook.md).

import { createSocket } from "node:dgram";

const SSDP_HOST = "239.255.255.250";
const SSDP_PORT = 1900;
const WAIT_MS = 3000;
const SEARCH = ["M-SEARCH * HTTP/1.1", `HOST: ${SSDP_HOST}:${SSDP_PORT}`, 'MAN: "ssdp:discover"', "MX: 2", "ST: roku:ecp", "", ""].join("\r\n");

// The LOCATION header of an answer, e.g. "LOCATION: http://192.168.1.20:8060/" -> 192.168.1.20
const hostOf = (reply: string) => /^location:\s*http:\/\/([^:/\s]+)/im.exec(reply)?.[1];
const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];

function search(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const hosts = new Set<string>();
    const sock = createSocket({ type: "udp4", reuseAddr: true });
    sock.on("error", reject);
    sock.on("message", (msg) => {
      const host = hostOf(String(msg));
      if (host) hosts.add(host);
    });
    sock.bind(() => {
      // UDP can drop a packet; asking twice is cheap.
      sock.send(SEARCH, SSDP_PORT, SSDP_HOST);
      setTimeout(() => sock.send(SEARCH, SSDP_PORT, SSDP_HOST), 1000);
      setTimeout(() => {
        sock.close();
        resolve([...hosts]);
      }, WAIT_MS);
    });
  });
}

async function describe(host: string) {
  try {
    const xml = await (await fetch(`http://${host}:8060/query/device-info`, { signal: AbortSignal.timeout(2500) })).text();
    const name = tag(xml, "user-device-name") || tag(xml, "friendly-device-name") || tag(xml, "model-name") || "Roku";
    return `${name}${tag(xml, "power-mode") ? ` (${tag(xml, "power-mode")})` : ""}`;
  } catch {
    return "Roku (device info did not answer; turn on Settings > System > Advanced > Control by mobile apps)";
  }
}

async function main() {
  const hosts = await search();
  if (!hosts.length) {
    console.log("No Roku answered. Is this laptop on the same network as the TV? Venue Wi-Fi often blocks discovery; use the hotspot.");
    process.exitCode = 1;
    return;
  }
  for (const host of hosts) console.log(`Lantern found your TV: ${await describe(host)} at ${host}`);
  console.log(`\nPut it in .env.local: ROKU_HOST=${hosts[0]}`);
}

main();
