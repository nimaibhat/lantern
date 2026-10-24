# BLE hub test (temporary)

Shows that several laptops can each hear the LightBlue / LanternTag beacon and that one hub can compare them
and name the room, even when the laptops cannot reach each other on the local network.

```
laptop A: hub_sender.py --id bedroom      --\
laptop B: hub_sender.py --id living-room  ----> public MQTT broker (broker.emqx.io, TLS) --> hub.html
```

No accounts or keys. Only the room name and signal strength are sent, on a random topic. The broker is public,
so never send anything private through it. Not part of the Lantern app; delete this folder once the real
listeners and calibration land.

## Each laptop

Run everything from this folder: `cd tools/ble-hub-test`

1. Install the two libraries:
   - Windows: `py -m pip install bleak paho-mqtt`
   - Mac: `pip3 install bleak paho-mqtt`
2. Start the sender with the room this laptop stands for:
   - Windows: `py hub_sender.py --id living-room` (or `--id bedroom` on the other laptop)
   - Mac: `python3 hub_sender.py --id bedroom`
   - If `py` is not found on Windows, use `python` instead.
3. Open `hub.html` in a browser (any laptop or phone with the file).

`--dry-run` prints readings without sending, to check Bluetooth on its own.
`--offset -3` evens out a laptop whose antenna reads louder than the others.

## Calibrate (about 7 seconds per device)

Laptops have different antennas, so one can read several dB louder than another at the same distance.

1. Hold the phone against one laptop and keep it still.
2. On the hub page, press that laptop's **Calibrate** button. It ignores the first 2 seconds, then records 5.
3. Repeat for each laptop.

After that, each laptop's reading is compared to its own "touching" level, so a stronger antenna no longer wins
unfairly. Calibration is shared through the broker, so every open hub page uses the same numbers.
The **Use calibration** toggle and the line under the room show what the decision would be the other way.

## Success looks like

- Both laptops show as online on the hub page.
- Holding the phone next to one laptop makes its bar the longest and names its room.
- Walking the phone to the other laptop flips the room once it is about 5 dB louder.
