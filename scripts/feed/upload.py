#!/usr/bin/env python3
"""Upload the built feed to R2 through the LukeWrt Worker."""
import os, sys, urllib.request
from pathlib import Path
API = os.environ["API"].rstrip("/"); SECRET = os.environ["UPLOAD_SECRET"]
out = Path(sys.argv[1]); prefix = sys.argv[2].strip("/")
files = sorted(out.iterdir(), key=lambda f: f.name in ("packages.adb", "index.json"))  # index last
for f in files:
    if not f.is_file():
        continue
    ct = "application/json" if f.suffix == ".json" else ("application/x-pem-file" if f.suffix == ".pem" else "application/octet-stream")
    req = urllib.request.Request(f"{API}/internal/put?key={prefix}/{f.name}", data=f.read_bytes(), method="PUT",
                                 headers={"authorization": f"Bearer {SECRET}", "content-type": ct, "user-agent": "lukewrt-feed"})
    with urllib.request.urlopen(req, timeout=300) as r:
        r.read()
    print("uploaded", f"{prefix}/{f.name}", f.stat().st_size)
