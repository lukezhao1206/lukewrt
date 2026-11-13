#!/usr/bin/env python3
"""Build one firmware request on a GitHub Actions runner.

Fetches the request from the LukeWrt Worker, runs the official OpenWrt
ImageBuilder container, uploads the result to R2 through the Worker and
reports status back. Mirrors what the OpenWrt ASU server does.
"""
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

API = os.environ["API"].rstrip("/")
SECRET = os.environ["UPLOAD_SECRET"]
HASH = os.environ["HASH"]
if not re.fullmatch(r"[0-9a-f]{32}", HASH):
    sys.exit("bad hash")
CONTAINER = "ghcr.io/openwrt/imagebuilder"
PART = 50 * 1024 * 1024
WORK = Path("work").resolve()
BIN = WORK / "bin"
FILES = WORK / "files"


def call(method, path, data=None, ctype="application/json", raw=False):
    if data is not None and not isinstance(data, (bytes, bytearray)):
        data = json.dumps(data).encode()
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("authorization", f"Bearer {SECRET}")
    req.add_header("user-agent", "lukewrt-builder")
    if data is not None:
        req.add_header("content-type", ctype)
    with urllib.request.urlopen(req, timeout=300) as r:
        body = r.read()
    return body if raw else json.loads(body or b"{}")


def status(**kw):
    try:
        call("POST", f"/internal/status/{HASH}", kw)
    except Exception as e:  # status updates are best effort
        print("status update failed:", e)


def fail(detail, stdout="", stderr=""):
    status(status="failed", detail=detail, stdout=stdout[-20000:], stderr=stderr[-20000:])
    sys.exit(detail)


def sh(args, **kw):
    print("+", " ".join(args), flush=True)
    return subprocess.run(args, capture_output=True, text=True, **kw)


def upload(path: Path, key: str):
    size = path.stat().st_size
    ctype = "application/json" if key.endswith(".json") else "application/octet-stream"
    if size <= PART:
        call("PUT", f"/internal/put?key={key}", path.read_bytes(), ctype)
        return
    up = call("POST", f"/internal/mpu/create?key={key}", b"")
    parts = []
    with path.open("rb") as f:
        n = 1
        while chunk := f.read(PART):
            p = call("PUT", f"/internal/mpu/part?key={key}&uploadId={urllib.request.quote(up['uploadId'])}&partNumber={n}", chunk, "application/octet-stream")
            parts.append({"partNumber": n, "etag": p["etag"]})
            n += 1
    call("POST", f"/internal/mpu/complete?key={key}&uploadId={urllib.request.quote(up['uploadId'])}", parts)


def main():
    req = call("GET", f"/internal/job/{HASH}")
    print(json.dumps(req, indent=1))
    status(status="building", ib_status="container_setup")

    version, target, profile = req["version"], req["target"], req["profile"]
    image = f"{CONTAINER}:{target.replace('/', '-')}-v{version}"
    r = sh(["docker", "pull", "-q", image])
    if r.returncode:
        fail(f"Image not found: {image}", r.stdout, r.stderr)

    BIN.mkdir(parents=True, exist_ok=True)
    FILES.mkdir(parents=True, exist_ok=True)
    if req.get("defaults"):
        d = FILES / "etc/uci-defaults"
        d.mkdir(parents=True, exist_ok=True)
        (d / "99-asu-defaults").write_text(req["defaults"])
    sh(["chmod", "-R", "a+rwX", str(WORK)])

    def run(cmd):
        return sh(["docker", "run", "--rm",
                   "-v", f"{BIN}:/builder/out",
                   "-v", f"{FILES}:/builder/asu-files:ro",
                   image, "bash", "-c", cmd])

    status(status="building", ib_status="validate_revision")
    r = run("make info")
    if r.returncode:
        fail("make info failed", r.stdout, r.stderr)
    m = re.search(r'Current Revision: "(r.+)"', r.stdout)
    version_code = m.group(1) if m else ""
    default_packages = set(re.search(r"Default Packages: (.*)\n", r.stdout).group(1).split())
    pm = re.search(r"^{}:\n    .+\n    Packages: (.*?)\n".format(re.escape(profile)), r.stdout, re.MULTILINE)
    if not pm:
        fail(f"Profile {profile} not found")
    profile_packages = set(pm.group(1).split())

    packages = req.get("packages") or []
    if req.get("diff_packages"):
        remove = (default_packages | profile_packages) - set(packages)
        packages = sorted({f"-{p}".replace("--", "-") for p in remove}) + packages

    status(status="building", ib_status="building_image")
    pk = " ".join(packages)
    files_arg = "FILES=/builder/asu-files" if req.get("defaults") else ""
    cmd = f'make image PROFILE="{profile}" PACKAGES="{pk}" BIN_DIR=/builder/out {files_arg}'
    r = run(cmd)
    out, err = r.stdout, r.stderr
    if any(e in err for e in ["is too big", "out of space?"]):
        fail("Selected packages exceed device storage", out, err)
    if r.returncode:
        fail("Error while building firmware. See stdout/stderr", out, err)

    jf = BIN / "profiles.json"
    if not jf.is_file():
        fail("No JSON file found", out, err)
    js = json.loads(jf.read_text())
    if profile not in js.get("profiles", {}):
        fail("Profile not found in JSON file", out, err)

    manifest = {}
    for mf in BIN.glob("*.manifest"):
        for line in mf.read_text().splitlines():
            sep = " - " if " - " in line else " "
            if sep in line:
                k, v = line.split(sep, 1)
                manifest[k] = v
        break

    status(status="building", ib_status="uploading")
    for f in sorted(BIN.iterdir()):
        if f.is_file():
            upload(f, f"store/{HASH}/{f.name}")

    js.update(js["profiles"][profile])
    js.pop("profiles")
    js.update({
        "id": profile,
        "bin_dir": HASH,
        "request_hash": HASH,
        "manifest": manifest,
        "build_cmd_packages": packages,
        "build_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "stdout": out[-20000:],
        "stderr": err[-20000:],
    })
    js.setdefault("version_code", version_code)
    call("POST", f"/internal/done/{HASH}", js)
    print("done")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        fail(f"builder error: {e}")
