#!/bin/bash
# Runs inside ghcr.io/openwrt/sdk:<target>-v<version>.
# Compiles the third-party proxy LuCI apps and publishes only the packages
# the official feeds do not ship, as a signed apk feed in /out/feed.
set -e
cd /builder
if [ ! -f Makefile ] && [ -x ./setup.sh ]; then ./setup.sh; fi
mkdir -p /out/logs /out/feed
ls /builder | tee /out/sdk-ls.txt
# signing key (never echoed)
if [ -n "$FEED_KEY" ]; then printf '%s\n' "$FEED_KEY" > private-key.pem; fi
set -x

cp feeds.conf.default feeds.conf
echo "src-git helloworld https://github.com/fw876/helloworld.git;master" >> feeds.conf
./scripts/feeds update -a > /out/logs/feeds-update.log 2>&1
# simple-obfs: git-generated tarball no longer matches the pinned hash
sed -i -E 's/^(PKG_MIRROR_HASH|PKG_HASH):=.*/\1:=skip/' feeds/helloworld/simple-obfs/Makefile

# sources that are a package (or a few) rather than a feed
git clone --depth 1 https://github.com/immortalwrt/homeproxy /tmp/homeproxy
cp -r /tmp/homeproxy package/luci-app-homeproxy
git clone --depth 1 --recurse-submodules --shallow-submodules https://github.com/fcshark-org/openwrt-fchomo /tmp/fchomo
cp -r /tmp/fchomo/luci-app-fchomo package/luci-app-fchomo
cp -r /tmp/fchomo/mihomo package/mihomo
git clone --depth 1 --filter=blob:none --sparse https://github.com/kiddin9/op-packages /tmp/op
(cd /tmp/op && git sparse-checkout set luci-app-bypass)
cp -r /tmp/op/luci-app-bypass package/luci-app-bypass
for d in homeproxy fchomo op; do echo "$d $(git -C /tmp/$d rev-parse HEAD)" >> /out/sources.txt; done
echo "helloworld $(git -C feeds/helloworld rev-parse HEAD)" >> /out/sources.txt

for f in packages luci routing telephony; do ./scripts/feeds install -a -p $f > /dev/null 2>&1 || true; done
./scripts/feeds install -p helloworld luci-app-ssr-plus chinadns-ng dns2socks dns2tcp lua-neturl \
  shadowsocks-libev shadowsocksr-libev simple-obfs tcping ipt2socks redsocks2 >> /out/logs/feeds-install.log 2>&1
./scripts/feeds install luci-app-bypass luci-app-homeproxy luci-app-fchomo >> /out/logs/feeds-install.log 2>&1 || true

cat >> .config <<'CFG'
CONFIG_SIGNED_PACKAGES=y
CONFIG_PACKAGE_luci-app-ssr-plus=m
# CONFIG_PACKAGE_luci-app-ssr-plus_Iptables_Transparent_Proxy is not set
CONFIG_PACKAGE_luci-app-ssr-plus_Nftables_Transparent_Proxy=y
# CONFIG_PACKAGE_luci-app-ssr-plus_INCLUDE_Shadowsocks_Rust_Client is not set
CONFIG_PACKAGE_luci-app-ssr-plus_INCLUDE_Shadowsocks_Libev_Client=y
# CONFIG_PACKAGE_luci-app-ssr-plus_INCLUDE_Shadowsocks_Libev_Server is not set
# CONFIG_PACKAGE_luci-app-ssr-plus_INCLUDE_Shadowsocks_Rust_Server is not set
CONFIG_PACKAGE_luci-app-ssr-plus_INCLUDE_Shadowsocks_NONE_Server=y
CONFIG_PACKAGE_luci-app-ssr-plus_INCLUDE_Xray=y
CONFIG_PACKAGE_luci-app-ssr-plus_INCLUDE_ShadowsocksR_Libev_Client=y
# CONFIG_PACKAGE_luci-app-ssr-plus_INCLUDE_ShadowsocksR_Libev_Server is not set
CONFIG_PACKAGE_luci-app-ssr-plus_INCLUDE_DNS2SOCKS=y
CONFIG_PACKAGE_luci-app-ssr-plus_INCLUDE_ChinaDNS_NG=y
# CONFIG_PACKAGE_luci-app-ssr-plus_INCLUDE_MosDNS is not set
# CONFIG_PACKAGE_luci-app-ssr-plus_INCLUDE_Trojan is not set
# CONFIG_PACKAGE_luci-app-ssr-plus_INCLUDE_NaiveProxy is not set
# CONFIG_PACKAGE_luci-app-ssr-plus_INCLUDE_Kcptun is not set
CONFIG_PACKAGE_luci-app-homeproxy=m
CONFIG_PACKAGE_luci-app-fchomo=m
CONFIG_PACKAGE_luci-app-bypass=m
CONFIG_PACKAGE_luci-app-bypass_INCLUDE_Shadowsocks_Libev_Client=y
# CONFIG_PACKAGE_luci-app-bypass_INCLUDE_Shadowsocks_Libev_Server is not set
CONFIG_PACKAGE_luci-app-bypass_INCLUDE_ShadowsocksR_Libev_Client=y
# CONFIG_PACKAGE_luci-app-bypass_INCLUDE_ShadowsocksR_Libev_Server is not set
CONFIG_PACKAGE_luci-app-bypass_INCLUDE_Xray=y
# CONFIG_PACKAGE_luci-app-bypass_INCLUDE_Trojan is not set
# CONFIG_PACKAGE_luci-app-bypass_INCLUDE_NaiveProxy is not set
CONFIG_PACKAGE_luci-app-bypass_INCLUDE_Socks_Server=y
CFG
make defconfig > /out/logs/defconfig.log 2>&1
ARCH=$(sed -n 's/^CONFIG_TARGET_ARCH_PACKAGES="\(.*\)"/\1/p' .config)
echo "arch=$ARCH" | tee /out/arch.txt
test -n "$ARCH"
grep -E 'luci-app-(ssr-plus|bypass)_|luci-app-(homeproxy|fchomo)=' .config > /out/config-used.txt || true

: > /out/failed.txt
for p in ${PKGS:-luci-app-ssr-plus luci-app-homeproxy luci-app-fchomo luci-app-bypass}; do
  if make package/$p/compile -j$(nproc) V=s > /out/logs/$p.log 2>&1 \
     || make package/$p/compile -j1 V=s > /out/logs/$p.retry.log 2>&1; then
    echo "OK $p"
  else
    echo "$p" >> /out/failed.txt; echo "FAIL $p"; tail -60 /out/logs/$p*.log | tail -60
  fi
done

APK=staging_dir/host/bin/apk
mkdir -p /tmp/all
find bin/packages -name '*.apk' -exec cp -f {} /tmp/all/ \; 2>/dev/null || true
ls /tmp/all | head -200
(cd /tmp/all && /builder/$APK mkndx --allow-untrusted --output packages.adb *.apk)
$APK adbdump --format json /tmp/all/packages.adb > /out/all.json
python3 /feed/pick_pkgs.py /out/all.json "$VERSION" "$ARCH" /tmp/all /out/feed "$TARGET" > /out/select.txt
cat /out/select.txt
cd /out/feed
/builder/$APK mkndx --root /builder --keys-dir /builder --allow-untrusted --sign /builder/private-key.pem --output packages.adb *.apk
/builder/$APK adbdump --format json packages.adb | /builder/scripts/make-index-json.py -f apk -a "$ARCH" - > index.json
cat index.json
