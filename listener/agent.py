"""Device account for a laptop that is not the hub.

Run this on every laptop that should hear the phone, then open the hub page
and press Listen for the tag. The browser talks to this program on this
computer, and the readings go to the hub.

    python listener/agent.py
"""
import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PORT = 8791
proc: subprocess.Popen | None = None
current_id: str | None = None


def stop():
    global proc, current_id
    if proc and proc.poll() is None and proc.pid:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        else:
            proc.kill()
    proc = None
    current_id = None


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, code: int, body: dict):
        raw = json.dumps(body).encode()
        self.send_response(code)
        self._cors()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] != "/status":
            self._json(404, {"error": "not found"})
            return
        running = proc is not None and proc.poll() is None
        self._json(200, {"ok": True, "id": current_id if running else None})

    def do_POST(self):
        global proc, current_id
        path = self.path.split("?")[0]
        length = int(self.headers.get("content-length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "bad request"})
            return
        if path == "/stop":
            stop()
            self._json(200, {"ok": True, "id": None})
            return
        if path != "/listen":
            self._json(404, {"error": "not found"})
            return
        device_id = str(body.get("id") or "").strip()
        url = str(body.get("url") or "ws://localhost:8787/ws/listener")
        post = str(body.get("post") or "").strip()
        token = str(body.get("token") or "change-me")
        if not device_id:
            self._json(400, {"error": "id required"})
            return
        stop()
        if post:
            args = [sys.executable, "-u", "listener/listener.py", "--id", device_id, "--post", post, "--min-interval", "0.8"]
        else:
            args = [sys.executable, "-u", "listener/listener.py", "--id", device_id, "--token", token, "--url", url]
        proc = subprocess.Popen(args, cwd=ROOT)
        current_id = device_id
        print(f"[agent] {device_id} listening, sending to {url}", flush=True)
        self._json(200, {"ok": True, "id": device_id})

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    print(f"[agent] this laptop can join the hub. Open the hub page and press Listen. (port {PORT})", flush=True)
    # Bind to all interfaces so the hub dashboard (running on another machine) can reach this agent.
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
