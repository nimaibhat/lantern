"""Insert a row into the Supabase models table with the service role key (stdlib only, keys from .env.local)."""

import json
import os
import urllib.request

from home import ROOT


def env():
    vals = {}
    p = ROOT / ".env.local"
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip()
    return {**vals, **os.environ}


def upload_model(kind, params, accuracy=None):
    e = env()
    url = e.get("SUPABASE_URL") or e.get("NEXT_PUBLIC_SUPABASE_URL")
    key, household = e.get("SUPABASE_SERVICE_ROLE_KEY"), e.get("HOUSEHOLD_ID") or e.get("DEMO_HOUSEHOLD_ID")
    if not (url and key and household):
        print("upload skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and HOUSEHOLD_ID in .env.local")
        return
    body = json.dumps({"household_id": household, "kind": kind, "params": params, "accuracy": accuracy}).encode()
    req = urllib.request.Request(f"{url}/rest/v1/models", data=body, method="POST", headers={
        "apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=minimal"})
    try:
        urllib.request.urlopen(req, timeout=20)
        print(f"uploaded {kind} model for household {household}")
    except urllib.error.HTTPError as err:
        print(f"upload failed ({err.code}): {err.read()[:200].decode(errors='replace')}")
