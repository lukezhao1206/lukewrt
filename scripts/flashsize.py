#!/usr/bin/env python3
"""Extract per-device IMAGE_SIZE (KB) from an OpenWrt source tree -> {target/subtarget?: {profile: kb}}.
usage: flashsize.py <openwrt-src> > sizes.json   (keeps devices <= 32 MB)"""
import re, sys, json, pathlib
src = pathlib.Path(sys.argv[1]) / "target/linux"
def kb(v):
    m = re.fullmatch(r"\s*(\d+)\s*([kKmM])?\s*", v)
    if not m: return None
    n = int(m.group(1)); u = (m.group(2) or "").lower()
    return n if u == "k" else n * 1024 if u == "m" else n // 1024
out = {}
for tdir in sorted(p for p in src.iterdir() if (p / "image").is_dir()):
    files = [f for f in (tdir / "image").iterdir() if f.is_file() and (f.suffix == ".mk" or f.name == "Makefile")]
    defs, vars_, devs = {}, {}, set()
    for f in files:
        txt = f.read_text(errors="ignore").replace("\\\n", " ")
        for m in re.finditer(r"^define Device/([\w.\-]+)\s*\n(.*?)^endef", txt, re.S | re.M):
            defs[m.group(1)] = m.group(2)
        for m in re.finditer(r"^([\w\-]+)\s*:?=\s*(\S+)\s*$", txt, re.M):
            vars_[m.group(1)] = m.group(2)
        for m in re.finditer(r"^TARGET_DEVICES\s*\+=\s*(.+)$", txt, re.M):
            devs.update(m.group(1).split())
    def resolve(name, depth=0):
        if depth > 12 or name not in defs: return None
        size = None
        for line in defs[name].splitlines():
            line = line.strip()
            m = re.match(r"\$\((?:call )?Device/([\w.\-]+)", line)
            if m:
                s = resolve(m.group(1), depth + 1)
                if s is not None: size = s
                continue
            m = re.match(r"IMAGE_SIZE\s*:?=\s*(.+)$", line)
            if m:
                v = m.group(1).strip()
                vm = re.fullmatch(r"\$\(([\w\-]+)\)", v)
                if vm: v = vars_.get(vm.group(1), "")
                s = kb(v)
                if s: size = s
        return size
    for d in devs:
        s = resolve(d)
        if s and s <= 32 * 1024:
            out.setdefault(tdir.name, {})[d] = s
json.dump(out, sys.stdout, separators=(",", ":"), sort_keys=True)
