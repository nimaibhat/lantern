"""Turn this Windows laptop into the Lantern tag.

The listeners never pair. They only read the advertisement (name LanternTag, or the
service UUID). This still publishes a connectable service so the laptop shows up
as a Bluetooth device.

One radio cannot advertise and scan at the same time. Run this on the tag laptop,
and listener.py on the laptops that sit in the rooms.

    python listener/advertise.py
"""
import asyncio
import sys
from uuid import UUID

from winrt.windows.devices.bluetooth.genericattributeprofile import (
    GattCharacteristicProperties,
    GattLocalCharacteristicParameters,
    GattServiceProvider,
    GattServiceProviderAdvertisementStatus,
    GattServiceProviderAdvertisingParameters,
)
from winrt.windows.storage.streams import DataWriter

SERVICE = UUID("4C414E54-4552-4E00-A000-000000000001")
CHAR = UUID("4C414E54-4552-4E00-A000-000000000002")
NAME = "LanternTag"


def _bytes(value: bytes):
    writer = DataWriter()
    writer.write_bytes(value)
    return writer.detach_buffer()


async def advertise_connectable() -> bool:
    result = await GattServiceProvider.create_async(SERVICE)
    provider = result.service_provider
    if provider is None:
        print(f"[tag] connectable service unavailable ({result.error})", flush=True)
        return False

    params = GattLocalCharacteristicParameters()
    params.characteristic_properties = GattCharacteristicProperties.READ
    params.user_description = "Lantern tag"
    params.static_value = _bytes(b"\x01")
    created = await provider.service.create_characteristic_async(CHAR, params)
    if created.characteristic is None:
        print(f"[tag] characteristic unavailable ({created.error})", flush=True)
        return False

    adv = GattServiceProviderAdvertisingParameters()
    adv.is_connectable = True
    adv.is_discoverable = True
    started = asyncio.Event()

    def on_status(sender, _args):
        if sender.advertisement_status == GattServiceProviderAdvertisementStatus.STARTED:
            started.set()

    provider.add_advertisement_status_changed(on_status)
    provider.start_advertising_with_parameters(adv)
    try:
        await asyncio.wait_for(started.wait(), timeout=5)
    except asyncio.TimeoutError:
        print(f"[tag] advertising did not start (status {provider.advertisement_status}). Turn Bluetooth on.", flush=True)
        provider.stop_advertising()
        return False

    print(f"[tag] advertising {NAME}. Other laptops can hear this. Ctrl+C to stop.", flush=True)
    try:
        await asyncio.Event().wait()
    finally:
        provider.stop_advertising()
    return True


async def main():
    if sys.platform != "win32":
        print("[tag] this advertiser is for Windows. On iPhone, use the LanternTag app.", flush=True)
        sys.exit(1)
    ok = await advertise_connectable()
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[tag] stopped")
