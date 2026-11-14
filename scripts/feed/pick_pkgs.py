#!/usr/bin/env python3
"""Pick the built packages the official OpenWrt feeds do not ship; skip kmods."""
import json, re, shutil, sys, urllib.request
allj, version, arch, src, dst, target = sys.argv[1:7]
pk = json.load(open(allj))
pk = pk["packages"] if isinstance(pk, dict) else pk
rel = f"https://downloads.openwrt.org/releases/{version}"
official = set()
for feed in ("base", "luci", "packages", "routing", "telephony"):
    with urllib.request.urlopen(f"{rel}/packages/{arch}/{feed}/index.json", timeout=120) as r:
        official |= set(json.load(r)["packages"])
# target-specific packages (libc, kernel, iptables, ...) live under targets/<target>/packages
with urllib.request.urlopen(f"{rel}/targets/{target}/packages/index.json", timeout=120) as r:
    official |= set(json.load(r)["packages"])
def strip_abi(p):
    n = p["name"]
    for t in p.get("tags", []):
        if t.startswith("openwrt:abiversion="):
            a = t.split("=", 1)[1]
            if a and n.endswith(a):
                n = n[: -len(a)]
    return n
chosen, skipped = [], []
for p in pk:
    n = strip_abi(p)
    if n.startswith("kmod-"):
        skipped.append((n, "kmod")); continue
    if n in official or p["name"] in official:
        continue
    chosen.append(p)
ours = {p["name"] for p in chosen} | {strip_abi(p) for p in chosen}
for p in chosen:
    for prov in p.get("provides", []) or []:
        ours.add(re.split(r"[<>=~]", prov)[0])
for p in chosen:
    import glob, os
    fn = f"{p['name']}-{p['version']}.apk"
    if not os.path.exists(f"{src}/{fn}"):
        c = glob.glob(f"{src}/{p['name']}-*.apk")
        if not c:
            print("MISSING FILE", fn); continue
        fn = os.path.basename(c[0])
    shutil.copy(f"{src}/{fn}", f"{dst}/{fn}")
    print("PUBLISH", fn)
print("SKIP", skipped)
# rough dependency check: everything should come from official feeds/target or from us
for p in chosen:
    for d in p.get("depends", []) or []:
        name = re.split(r"[<>=~]", d.lstrip("!"))[0]
        if d.startswith("!") or name in ours or name in official or name.startswith(("kmod-", "so:", "cmd:", "libc")):
            continue
        base = re.sub(r"[0-9._-]+$", "", name)
        if base and any(o.startswith(base) for o in official):
            continue
        print("UNRESOLVED", p["name"], "->", d)
