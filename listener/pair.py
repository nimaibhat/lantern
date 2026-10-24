"""Easy setup for a new room laptop.

Run this on any laptop that should hear the phone:

    python listener/pair.py

First time: it asks for the room name and the hub laptop's IP address.
After that: it remembers the settings and starts scanning immediately.

Requirements (install once):
    pip install bleak websockets
"""
import json
import os
import re
import socket
import subprocess
import sys
import urllib.request
from pathlib import Path

CONFIG_PATH = Path(__file__).parent / ".lantern-device.json"
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")


# ── helpers ──────────────────────────────────────────────────────────────────

def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text("utf-8"))
        except Exception:
            pass
    return {}


def save_config(cfg: dict):
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2), "utf-8")


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower().strip()).strip("-")[:41]


def lan_ip() -> str:
    """Best-effort LAN IP of this machine (for display only)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "unknown"


def check_deps():
    """Make sure bleak and websockets are installed."""
    missing = []
    try:
        import bleak  # noqa: F401
    except ImportError:
        missing.append("bleak")
    try:
        import websockets  # noqa: F401
    except ImportError:
        missing.append("websockets")
    if missing:
        print(f"\n  Missing packages: {', '.join(missing)}")
        ans = input("  Install them now? [Y/n]: ").strip().lower()
        if ans in ("", "y", "yes"):
            subprocess.check_call([sys.executable, "-m", "pip", "install"] + missing)
            print()
        else:
            print("  Install manually:  pip install bleak websockets")
            sys.exit(1)


def test_hub(hub: str, port: int = 8787) -> dict | None:
    """Return the hub's /health response, or None if unreachable."""
    try:
        url = f"http://{hub}:{port}/health"
        with urllib.request.urlopen(url, timeout=4) as r:
            return json.loads(r.read())
    except Exception:
        return None


# ── interactive prompts ──────────────────────────────────────────────────────

def ask_room(saved: str | None) -> str:
    if saved:
        print(f"\n  Room: {saved}  (from last time)")
        if input("  Keep this name? [Y/n]: ").strip().lower() in ("", "y", "yes"):
            return saved

    print("\n  What room is this laptop in?")
    print("  Examples: bedroom, kitchen, hallway, living-room, tv-room")
    while True:
        raw = input("  Room name: ").strip()
        slug = slugify(raw)
        if slug and SLUG_RE.match(slug):
            return slug
        print("  Use a short name (letters, numbers, hyphens). Try again.")


def ask_hub(saved: str | None) -> str:
    if saved:
        print(f"\n  Hub: {saved}  (from last time)")
        if input("  Keep this address? [Y/n]: ").strip().lower() in ("", "y", "yes"):
            return saved

    print("\n  What is the hub laptop's IP address?")
    print("  (The laptop running the Lantern monitor & dashboard.)")
    print("  Find it on the hub: Settings > Network, or run 'ipconfig'.")
    while True:
        ip = input("  Hub IP address: ").strip()
        if ip:
            return ip
        print("  Please enter an IP address (e.g. 192.168.1.42).")


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    print()
    print("=" * 52)
    print("   Lantern  -  Add this laptop as a room listener")
    print("=" * 52)
    print(f"   This laptop: {lan_ip()}")

    check_deps()

    cfg = load_config()
    room = ask_room(cfg.get("room"))
    hub = ask_hub(cfg.get("hub"))
    token = cfg.get("token", "change-me")
    offset = cfg.get("offset", 0)

    # Test connection to the hub
    print(f"\n  Connecting to hub at {hub}:8787 ...")
    health = test_hub(hub)
    if health:
        listeners = health.get("listeners", {})
        online = [k for k, v in listeners.items() if v]
        print(f"  Hub is online!  (uptime {health.get('uptimeS', '?')}s, listeners: {online or 'none yet'})")
    else:
        print(f"  WARNING: Cannot reach the hub at {hub}:8787")
        print("  Make sure the monitor is running on the hub laptop:")
        print("    npm run monitor    (or however you start it)")
        ans = input("  Start scanning anyway? [y/N]: ").strip().lower()
        if ans not in ("y", "yes"):
            sys.exit(0)

    # Save config for next time
    cfg.update({"room": room, "hub": hub, "token": token, "offset": offset})
    save_config(cfg)
    print(f"\n  Settings saved to {CONFIG_PATH.name}")
    print(f"  Next time, just run:  python listener/pair.py\n")

    # Launch the listener
    ws_url = f"ws://{hub}:8787/ws/listener"
    print(f"  Room:  {room}")
    print(f"  Hub:   {ws_url}")
    print(f"  Token: {token}")
    if offset:
        print(f"  Offset: {offset} dB")
    print()
    print("  Scanning for the phone's Bluetooth signal...")
    print("  Keep LightBlue open on the phone with LanternTag advertising.")
    print("  Press Ctrl+C to stop.")
    print()

    listener_py = Path(__file__).parent / "listener.py"
    cmd = [
        sys.executable, "-u", str(listener_py),
        "--id", room,
        "--url", ws_url,
        "--token", token,
        "--offset", str(offset),
    ]
    try:
        subprocess.run(cmd)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n  Stopped. Run 'python listener/pair.py' to start again.")
