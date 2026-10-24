"""BLE listener that forwards RSSI to the monitor over WebSocket.

Run one per laptop / receiver position:
    python listener/listener.py --id bedroom --token change-me
    python listener/listener.py --id hallway --token change-me --offset -3
"""
import argparse
import asyncio
import json
import ssl
import time
import urllib.request

from bleak import BleakScanner
import websockets

SERVICE_UUID = "4c414e54-4552-4e00-a000-000000000001"


async def run(a):
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    last = 0.0

    def on_detect(device, adv):
        nonlocal last
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        # Windows often leaves device.name empty and puts the LightBlue name in the ad itself.
        name = " ".join(p for p in (device.name, getattr(adv, "local_name", None)) if p).lower()
        if SERVICE_UUID not in uuids and "lantern" not in name:
            return
        now = time.time()
        if now - last < a.min_interval:
            return
        last = now
        try:
            q.put_nowait({
                "type": "rssi",
                "receiverId": a.id,
                "tagId": a.tag,
                "rssi": adv.rssi + a.offset,
                "ts": int(now * 1000),
            })
        except asyncio.QueueFull:
            pass

    # Do not pass service_uuids here: iOS (LightBlue) often advertises the name
    # but leaves the 128-bit UUID out of the packet Windows can see.
    async with BleakScanner(on_detect):
        print(f"[listener] {a.id} scanning for LanternTag...", flush=True)
        if a.post:
            await post_rssi(a, q)
            return
        while True:
            try:
                url = f"{a.url}?token={a.token}"
                async with websockets.connect(url) as ws:
                    print(f"[listener] {a.id} connected to {a.url}")
                    await ws.send(json.dumps({
                        "type": "hello",
                        "receiverId": a.id,
                        "kind": "mac-bleak",
                    }))

                    async def heartbeat():
                        while True:
                            await asyncio.sleep(5)
                            await ws.send(json.dumps({
                                "type": "hb",
                                "receiverId": a.id,
                                "ts": int(time.time() * 1000),
                            }))

                    hb_task = asyncio.create_task(heartbeat())
                    try:
                        while True:
                            msg = await q.get()
                            await ws.send(json.dumps(msg))
                    finally:
                        hb_task.cancel()
            except Exception as e:
                print(f"[listener] {a.id} ws error, retrying in 2s: {e}")
                await asyncio.sleep(2)


async def post_rssi(a, q: asyncio.Queue):
    ctx = ssl._create_unverified_context()

    def send(rssi: int):
        body = json.dumps({"action": "hear", "deviceId": a.id, "rssi": rssi}).encode()
        req = urllib.request.Request(a.post, data=body, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, context=ctx, timeout=4).read()

    while True:
        msg = await q.get()
        try:
            await asyncio.to_thread(send, int(msg["rssi"]))
        except Exception as e:
            print(f"[listener] {a.id} post failed: {e}", flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Lantern BLE listener")
    p.add_argument("--id", required=True, help="receiver slug (bedroom, hallway, kitchen, tv-room)")
    p.add_argument("--tag", default="tag-1", help="tag identifier")
    p.add_argument("--url", default="ws://localhost:8787/ws/listener", help="monitor WS URL")
    p.add_argument("--post", default="", help="POST each reading to this tracking URL instead of the monitor")
    p.add_argument("--token", default="change-me", help="listener auth token")
    p.add_argument("--offset", type=int, default=0, help="RSSI calibration offset in dB")
    p.add_argument("--min-interval", type=float, default=0.2, help="minimum seconds between readings")
    asyncio.run(run(p.parse_args()))
