"""Temporary BLE hub test: hear the LightBlue / LanternTag beacon and publish this laptop's reading.

Every laptop runs one copy with its own room name. Readings go to a public MQTT broker over the internet,
so the laptops never need to reach each other. hub.html subscribes to the same topic and names the room.

    py hub_sender.py --id living-room
    python3 hub_sender.py --id bedroom
    py hub_sender.py --id living-room --dry-run     # print readings only, send nothing

Only the room name and signal strength are sent. The broker is public, so never send anything private.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import ssl
import statistics
import time

import paho.mqtt.client as mqtt
from bleak import BleakScanner

SERVICE_UUID = "4c414e54-4552-4e00-a000-000000000001"  # same as Saran's LanternTag and listener
BROKER = "broker.emqx.io"
PORT = 8883  # MQTT over TLS
TOPIC = "lantern-ble-test/kc5mv2wkvs"  # random, shared by every laptop and hub.html
WINDOW_S = 2.0  # median over the last 2 s, so one noisy packet does not flip the room
SEND_EVERY_S = 0.5


def is_beacon(device, adv) -> bool:
    uuids = [u.lower() for u in (adv.service_uuids or [])]
    name = (device.name or adv.local_name or "").lower()
    # Windows often does not see the 128-bit UUID from iOS, so the name match matters.
    return SERVICE_UUID in uuids or "lanterntag" in name


def connect(device_id: str) -> mqtt.Client:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"hub-{device_id}-{int(time.time())}")
    client.tls_set(cert_reqs=ssl.CERT_REQUIRED)
    client.on_connect = lambda c, u, f, rc, p: print(f"[{device_id}] connected to {BROKER}" if rc == 0 else f"[{device_id}] broker refused: {rc}")
    client.on_disconnect = lambda c, u, f, rc, p: print(f"[{device_id}] disconnected ({rc}), reconnecting...")
    client.connect_async(BROKER, PORT, keepalive=30)
    client.loop_start()  # background thread; reconnects on its own
    return client


async def run(args) -> None:
    client = None if args.dry_run else connect(args.id)
    readings: list[tuple[float, int]] = []

    def on_adv(device, adv):
        if is_beacon(device, adv):
            readings.append((time.time(), adv.rssi + args.offset))

    async with BleakScanner(on_adv):
        print(f"[{args.id}] scanning for the beacon{' (dry run)' if args.dry_run else ''}. Ctrl+C to stop.")
        while True:
            await asyncio.sleep(SEND_EVERY_S)
            now = time.time()
            readings[:] = [r for r in readings if now - r[0] <= WINDOW_S]
            rssi = round(statistics.median(v for _, v in readings)) if readings else None
            print(f"[{args.id}] {'no signal' if rssi is None else f'{rssi} dBm'} ({len(readings)} packets in {WINDOW_S:.0f}s)")
            if client is not None and client.is_connected():
                payload = {"device": args.id, "rssi": rssi, "samples": len(readings), "ts": int(now * 1000)}
                client.publish(f"{TOPIC}/{args.id}", json.dumps(payload), qos=0)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="BLE hub test sender")
    p.add_argument("--id", required=True, help="the room this laptop stands for, e.g. bedroom or living-room")
    p.add_argument("--offset", type=int, default=0, help="dB added to every reading, to even out laptop antennas")
    p.add_argument("--dry-run", action="store_true", help="print readings only; send nothing")
    try:
        asyncio.run(run(p.parse_args()))
    except KeyboardInterrupt:
        pass
