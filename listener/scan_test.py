"""Quick BLE scan to verify the tag is visible.

Usage:
    python listener/scan_test.py          # only LanternTag
    python listener/scan_test.py --all    # every advertisement
"""
import argparse
import asyncio
from bleak import BleakScanner

SERVICE_UUID = "4c414e54-4552-4e00-a000-000000000001"


async def run(show_all: bool):
    def on_detect(device, adv):
        if show_all:
            print(f"{device.name or '?':30s}  rssi={adv.rssi:4d}  {device.address}")
            return
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        if SERVICE_UUID in uuids or (device.name and "lanterntag" in device.name.lower()):
            print(f"LanternTag  rssi={adv.rssi}  addr={device.address}  uuids={adv.service_uuids}")

    async with BleakScanner(on_detect):
        print("Scanning... (Ctrl+C to stop)")
        await asyncio.Event().wait()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--all", action="store_true", help="show every advertisement")
    asyncio.run(run(p.parse_args().all))
