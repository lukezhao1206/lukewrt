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
EXTRA = WORK / "extra"


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

# ---- third-party feeds, enabled automatically by the packages requested ----
PW = "https://master.dl.sourceforge.net/project/openwrt-passwall-build"
PW_PKGS = {"luci-app-passwall", "luci-i18n-passwall-zh-cn", "luci-app-passwall2",
           "luci-i18n-passwall2-zh-cn", "luci-i18n-passwall2-zh-tw", "chinadns-ng",
           "dns2socks", "geoview", "hysteria", "ipt2socks", "microsocks", "naiveproxy",
           "shadow-tls", "tcping", "simple-obfs-client", "v2ray-plugin", "xray-plugin",
           "shadowsocksr-libev-ssr-local", "shadowsocksr-libev-ssr-redir",
           "shadowsocks-rust-sslocal"}
NIKKI_PKGS = {"nikki", "luci-app-nikki", "luci-i18n-nikki-zh-cn", "luci-i18n-nikki-zh-tw",
              "mihomo-meta", "mihomo-alpha"}
OWN_FEED_APPS = {"luci-app-ssr-plus", "luci-app-homeproxy", "luci-app-fchomo", "luci-app-bypass"}
NEED_DNSMASQ_FULL = {"luci-app-passwall", "luci-app-passwall2", "luci-app-openclash", "luci-app-ssr-plus", "luci-app-bypass"}
KEYS = {
    "passwall_ipk": "untrusted comment: OpenWRT usign key of dianlujitao\nRWQKvaZaSStIhx4t06ISyV42CIpK7niKfR+Yro/WHiKLa122SEh2j3Z4\n",
    "passwall_apk": "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEOmXHYLJGWFQCtbWqDqlxMvcAvkZZ\nOwy7UzzBIOxrGSAiu1blMeX96Q55Q9PH5GyjPwYiT4nrrwRgIttggGK62w==\n-----END PUBLIC KEY-----\n",
    "lukewrt_feed_apk": "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE3X2qKuTFvO1IZPRRs/1z+wc39xiM\nnqgwUb8EtxVZVjvpvVTj3K8/Mmlw+Xn/v85VwKWy4U+vMs51uNXX5GN69A==\n-----END PUBLIC KEY-----\n",
    "nikki_apk": "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAETOwt83tzTFqyvjwimjuuvslR40t6\nXnROMwxZsC0iQAr2hHjuXX8qyhf5WaD2Hd897+Gc1/+4W4DMqroNp5w2Dg==\n-----END PUBLIC KEY-----\n",
}


def target_arch(version, target):
    with urllib.request.urlopen(f"https://downloads.openwrt.org/releases/{version}/targets/{target}/profiles.json", timeout=60) as r:
        return json.loads(r.read())["arch_packages"]


def own_feed(version, target):
    """LukeWrt's own apk feed (built with the official SDK, see .github/workflows/feed.yml).
    Returns (url, set of package names) or (None, set()) when there is none for this arch."""
    branch = ".".join(version.split(".")[:2])
    url = f"{API}/packages/feed/{branch}/{target_arch(version, target)}"
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{url}/index.json", headers={"user-agent": "lukewrt-builder"}), timeout=60) as r:
            return url, set(json.loads(r.read()).get("packages", {}))
    except Exception as e:
        print("own feed unavailable", url, e)
        return None, set()


def _index(url):
    import gzip
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "Mozilla/5.0 lukewrt-builder"}), timeout=120) as r:
            data = r.read()
    except Exception as e:
        print("index fetch failed", url, e)
        return {}
    if url.endswith(".gz"):
        data = gzip.decompress(data)
    pk = {}
    for blk in data.decode("utf-8", "replace").split("\n\n"):
        m = {}
        for line in blk.splitlines():
            if line[:1] in (" ", "\t") or ":" not in line:
                continue
            k, v = line.split(":", 1)
            m[k] = v.strip()
        if "Package" in m:
            pk[m["Package"]] = m
    return pk


def _deps(m):
    out = []
    for d in (m.get("Depends") or "").split(","):
        d = d.strip()
        if not d:
            continue
        alts = [re.split(r"[\s(<>=]", a.strip())[0] for a in d.split("|")]
        out.append([a for a in alts if a])
    return out


_OFF = {}


def official_index(version, target):
    if (version, target) in _OFF:
        return _OFF[(version, target)]
    rel = f"https://downloads.openwrt.org/releases/{version}"
    with urllib.request.urlopen(f"{rel}/targets/{target}/profiles.json", timeout=60) as r:
        arch = json.loads(r.read())["arch_packages"]
    official = {}
    for feed in ("base", "luci", "packages", "routing", "telephony"):
        official.update(_index(f"{rel}/packages/{arch}/{feed}/Packages.gz"))
    official.update(_index(f"{rel}/targets/{target}/packages/Packages.gz"))
    provided = set(official)
    for m in official.values():
        for p in (m.get("Provides") or "").split(","):
            if p.strip():
                provided.add(re.split(r"[\s(<>=]", p.strip())[0])
    _OFF[(version, target)] = (arch, official, provided)
    return _OFF[(version, target)]


def fetch_k9(dest: Path, version: str, target: str, wanted):
    """Download kiddin9 packages the user picked, plus deps official feeds lack, into dest."""
    branch = ".".join(version.split(".")[:2])
    if int(version.split(".")[0]) >= 25:
        url, names = own_feed(version, target)
        missing = [n for n in wanted if n not in names]
        if missing:
            fail("插件大库在 25.12 暂时只有 SSR Plus、HomeProxy、FCHomo、Bypass（且仅部分架构），"
                 f"这些用不了：{' '.join(missing)}；请改用 24.10")
        return list(wanted)
    arch, official, provided = official_index(version, target)
    kbase = f"https://dl.openwrt.ai/packages-{branch}/{arch}/kiddin9"
    k9 = _index(f"{kbase}/Packages.gz")
    if not k9:
        fail("插件大库暂时连不上，请稍后再试")
    kprov = {}
    for n, m in k9.items():
        kprov.setdefault(n, n)
        for p in (m.get("Provides") or "").split(","):
            if p.strip():
                kprov.setdefault(re.split(r"[\s(<>=]", p.strip())[0], n)
    need, todo, seen = [], list(wanted), set()
    while todo:
        n = todo.pop()
        if n in seen:
            continue
        seen.add(n)
        if n in provided and n not in wanted:
            continue
        if n in wanted and n in official:
            continue
        src = kprov.get(n)
        if not src:
            if n in provided or n not in wanted:
                print("k9: leaving dependency to ImageBuilder:", n)
                continue
            fail(f"插件大库里找不到 {n}")
        if src.startswith("kmod-"):
            fail(f"{n} 需要第三方内核模块 {src}，和官方内核不兼容，换个插件吧")
        need.append(src)
        for alts in _deps(k9[src]):
            if any(a in provided for a in alts):
                continue
            todo.append(next((a for a in alts if a in kprov), alts[0]))
    for n in dict.fromkeys(need):
        fn = k9[n]["Filename"]
        print("k9:", fn)
        rq = urllib.request.Request(f"{kbase}/{urllib.request.quote(fn)}", headers={"user-agent": "Mozilla/5.0 lukewrt-builder"})
        with urllib.request.urlopen(rq, timeout=300) as r:
            (dest / fn.split("/")[-1]).write_bytes(r.read())
    return list(dict.fromkeys(need))


def feed_prelude(version, packages, force_unsigned=False, own_url=None):
    """Shell run inside the container before `make image`."""
    names = {p.lstrip("-") for p in packages if not p.startswith("-")}
    branch = ".".join(version.split(".")[:2])
    feeds = []
    if names & PW_PKGS:
        feeds += [(n, f"{PW}/releases/packages-{branch}/$ARCH/{n}") for n in
                  ("passwall_packages", "passwall_luci", "passwall2")]
    if names & NIKKI_PKGS:
        feeds.append(("nikki", f"https://nikkinikki.pages.dev/openwrt-{branch}/$ARCH/nikki"))
    if own_url:
        feeds.append(("lukewrt", own_url))
    lines = ['set -e', 'cd /builder',
             'if [ -f repositories ]; then FMT=apk; RF=repositories; else FMT=ipk; RF=repositories.conf; fi',
             'ARCH=$(grep -m1 -oE "packages/[^/]+/base" $RF | cut -d/ -f2)',
             'echo "lukewrt: arch=$ARCH fmt=$FMT"',
             'mkdir -p packages && cp /builder/asu-extra/* packages/ 2>/dev/null || true']
    for n, u in feeds:
        lines.append(f'if [ $FMT = apk ]; then echo "{u}/packages.adb" >> $RF; '
                     f'else echo "src/gz {n} {u}" >> $RF; fi')
    if feeds or force_unsigned:
        lines.append("sed -i 's/^option check_signature/# option check_signature/' repositories.conf 2>/dev/null || true")
        for k in ("passwall_apk", "nikki_apk", "lukewrt_feed_apk"):
            body = KEYS[k].replace("\n", "\\n")
            lines.append(f'if [ $FMT = apk ]; then mkdir -p keys; printf "%b" "{body}" > keys/{k}.pem; fi')
        lines.append('cat $RF')
    return " && ".join(lines[:2]) + "\n" + "\n".join(lines[2:]) + "\n"


def fetch_openclash(dest: Path, version: str):
    fmt = "apk" if int(version.split(".")[0]) >= 25 else "ipk"
    req = urllib.request.Request("https://api.github.com/repos/vernesong/OpenClash/releases?per_page=5",
                                 headers={"user-agent": "lukewrt-builder", "accept": "application/vnd.github+json",
                                          **({"authorization": f"Bearer {os.environ['GH_API_TOKEN']}"} if os.environ.get("GH_API_TOKEN") else {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        rels = json.loads(r.read())
    for rel in rels:
        for a in rel.get("assets", []):
            if a["name"].endswith("." + fmt) and a["name"].startswith("luci-app-openclash"):
                urllib.request.urlretrieve(a["browser_download_url"], dest / a["name"])
                print("openclash:", a["name"])
                return
    fail("OpenClash package not found for this version")



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
    EXTRA.mkdir(parents=True, exist_ok=True)
    want = set(req.get("packages") or [])
    if "luci-app-openclash" in want:
        fetch_openclash(EXTRA, version)
    k9 = []
    if req.get("auto_k9") and int(version.split(".")[0]) < 25:
        # router upgrade: installed packages missing from official feeds come from the plugin library
        _, _, provided = official_index(version, target)
        known = provided | PW_PKGS | NIKKI_PKGS | {"luci-app-openclash"}
        extra = [p for p in want if not p.startswith("-") and p not in known]
        if extra:
            print("auto k9:", extra)
            req["k9"] = sorted(set(req.get("k9") or []) | set(extra))
            req["packages"] = [p for p in req.get("packages") or [] if p not in extra]
            want = set(req["packages"])
    if req.get("k9"):
        status(status="building", ib_status="download_k9")
        k9 = fetch_k9(EXTRA, version, target, list(req["k9"]))
    if req.get("defaults"):
        d = FILES / "etc/uci-defaults"
        d.mkdir(parents=True, exist_ok=True)
        (d / "99-asu-defaults").write_text(req["defaults"])
    sh(["chmod", "-R", "a+rwX", str(WORK)])

    def run(cmd):
        return sh(["docker", "run", "--rm",
                   "-v", f"{BIN}:/builder/out",
                   "-v", f"{FILES}:/builder/asu-files:ro",
                   "-v", f"{EXTRA}:/builder/asu-extra:ro",
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

    packages = list(req.get("packages") or []) + [p for p in req.get("k9") or [] if p not in (req.get("packages") or [])]
    own_url = None
    if int(version.split(".")[0]) >= 25:
        url, names = own_feed(version, target)
        mine = [p for p in packages if p in names]
        if mine:
            own_url = url
            print("own feed:", url, mine)
        lost = [p for p in packages if p in OWN_FEED_APPS and p not in names]
        if lost:
            fail(f"{' '.join(lost)} 在 {version} 暂时只支持部分架构（这台设备的 CPU 架构还没有），请改用 24.10")
        if "luci-i18n-base-zh-cn" in packages:
            # Chinese UI requested: bring the matching translations from our feed too
            for a in [p for p in packages if p in OWN_FEED_APPS]:
                t = "luci-i18n-" + a[len("luci-app-"):] + "-zh-cn"
                if t in names and t not in packages:
                    packages.append(t)
        if "luci-app-ssr-plus" in packages:
            # our SDK build uses the nftables backend, whose kmods are config-selected, not package deps
            packages += [k for k in ("kmod-nft-tproxy", "kmod-nft-socket", "kmod-nft-nat") if k not in packages]
    if set(packages) & NEED_DNSMASQ_FULL and "dnsmasq-full" not in packages:
        packages = [p for p in packages if p != "dnsmasq"] + ["-dnsmasq", "dnsmasq-full"]
    if req.get("diff_packages"):
        remove = (default_packages | profile_packages) - set(packages) - {"dnsmasq"}
        packages = sorted({f"-{p}".replace("--", "-") for p in remove}) + packages

    status(status="building", ib_status="building_image")
    pk = " ".join(packages)
    files_arg = "FILES=/builder/asu-files" if req.get("defaults") else ""
    prelude = feed_prelude(version, packages, force_unsigned=bool(k9) or "luci-app-openclash" in want, own_url=own_url)
    rootfs = req.get("rootfs_size_mb")
    if not rootfs and target.split("/")[0] in ("x86", "armsr", "armvirt"):
        rootfs = 512  # default 104 MB fills up with proxy plugins
    if rootfs:
        files_arg += f" ROOTFS_PARTSIZE={int(rootfs)}"
    cmd = prelude + f'make image PROFILE="{profile}" PACKAGES="{pk}" BIN_DIR=/builder/out {files_arg}'
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
