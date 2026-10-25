// Mac equivalent of ear-bat.ts. A .command file is a bash script that macOS
// Terminal opens on double-click. It installs bleak (pure-Python BLE library)
// and runs a small scanner that posts dBm to the hub, same as the Windows .bat.

import { originFor } from "./ear-bat";

export { originFor };

function pyScript(deviceId: string, postUrl: string): string {
  return `
import asyncio, json, ssl, sys, urllib.error, urllib.request, time

DEVICE_ID = "${deviceId}"
POST_URL  = "${postUrl}"
SERVICE   = "4c414e54-4552-4e00-a000-000000000001"

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

async def main():
    from bleak import BleakScanner

    last_rssi = -100
    last_post = 0.0
    paired = False

    def callback(device, ad_data):
        nonlocal last_rssi, paired
        name = (device.name or "").lower()
        uuids = [str(u).lower() for u in (ad_data.service_uuids or [])]
        if "lantern" not in name and SERVICE not in uuids:
            return
        last_rssi = ad_data.rssi
        if not paired:
            paired = True
            print("Paired with LanternTag.", flush=True)

    scanner = BleakScanner(detection_callback=callback)
    print("Listening for LanternTag. Leave this window open.", flush=True)
    await scanner.start()

    # Tell the hub the scanner is up
    try:
        body = json.dumps({"action":"view","hub":False,"hostLocal":False,"pairShown":True,"error":"scanner-up " + DEVICE_ID,"protocol":"https:"}).encode()
        req = urllib.request.Request(POST_URL, data=body, headers={"Content-Type":"application/json"})
        urllib.request.urlopen(req, context=ctx, timeout=2)
    except Exception:
        pass

    try:
        while True:
            await asyncio.sleep(0.4)
            if last_rssi <= -100:
                continue
            now = time.time()
            if now - last_post < 1.0:
                continue
            last_post = now
            body = json.dumps({"action":"hear","deviceId":DEVICE_ID,"rssi":last_rssi}).encode()
            req = urllib.request.Request(POST_URL, data=body, headers={"Content-Type":"application/json"})
            try:
                urllib.request.urlopen(req, context=ctx, timeout=2)
            except urllib.error.HTTPError as e:
                print("Lantern does not know this laptop anymore. Open Tracking and press Pair again." if e.code == 404 else "The hub could not take the signal.", flush=True)
            except Exception:
                print("Could not reach the hub.", flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        await scanner.stop()

asyncio.run(main())
`.trim();
}

/** The full .command script: checks python3, installs bleak, runs the scanner. */
export function earMacScript(deviceId: string, postUrl: string): string {
  if (!/^ear-[a-f0-9]{8}$/i.test(deviceId)) throw new Error("bad device");
  const post = postUrl.trim().replace(/\/$/, "");
  if (!/^https?:\/\/\S+\/api\/tracking$/.test(post)) throw new Error("bad url");

  const py = pyScript(deviceId, post);

  // The heredoc delimiter is single-quoted so bash does no expansion inside it.
  return `#!/bin/bash
# Lantern BLE listener
clear
echo "Lantern — setting up Bluetooth listener..."
echo ""

if ! command -v python3 &>/dev/null; then
    echo "Python 3 is required."
    echo "Install Xcode Command Line Tools by running:"
    echo "  xcode-select --install"
    echo ""
    echo "Then re-run this file."
    read -n1 -rsp "Press any key to close."
    exit 1
fi

python3 -c "import bleak" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "Installing Bluetooth library (bleak)..."
    python3 -m pip install --user --quiet bleak 2>/dev/null || python3 -m pip install --quiet bleak 2>/dev/null
    if [ $? -ne 0 ]; then
        echo "Could not install bleak. Try running:"
        echo "  pip3 install bleak"
        echo ""
        read -n1 -rsp "Press any key to close."
        exit 1
    fi
    echo "Done."
    echo ""
fi

python3 << 'LANTERN_SCRIPT'
${py}
LANTERN_SCRIPT

echo ""
read -n1 -rsp "Press any key to close."
`;
}

/**
 * A short .command launcher: downloads the full script from the hub and runs it.
 * Keeps the download small (the full script is ~2 KB).
 */
export function earMacLaunch(deviceId: string, postUrl: string, label: string): string {
  if (!/^ear-[a-f0-9]{8}$/i.test(deviceId)) throw new Error("bad device");
  const post = postUrl.trim().replace(/\/$/, "");
  if (!/^https?:\/\/\S+\/api\/tracking$/.test(post)) throw new Error("bad url");
  const title = (label.replace(/[^\w .'-]/g, "").trim() || "laptop").slice(0, 40);
  const earUrl = `${post}/ear-mac?id=${deviceId.toLowerCase()}`;

  return `#!/bin/bash
# Lantern ${title}
clear
echo "Lantern — downloading listener..."
TMP="$TMPDIR/lantern-ear.sh"
curl -sk "${earUrl}" -o "$TMP"
if [ ! -s "$TMP" ]; then
    echo "Could not download the listener from the hub."
    echo "Make sure this Mac is on the same Wi-Fi as the hub."
    read -n1 -rsp "Press any key to close."
    exit 1
fi
bash "$TMP"
`;
}

/** Terminal one-liner the user can copy-paste — no download needed. */
export function earMacOneLiner(deviceId: string, postUrl: string): string {
  if (!/^ear-[a-f0-9]{8}$/i.test(deviceId)) throw new Error("bad device");
  const post = postUrl.trim().replace(/\/$/, "");
  if (!/^https?:\/\/\S+\/api\/tracking$/.test(post)) throw new Error("bad url");
  const earUrl = `${post}/ear-mac?id=${deviceId.toLowerCase()}`;
  return `bash <(curl -sk '${earUrl}')`;
}
