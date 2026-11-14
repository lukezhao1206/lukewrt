// LukeWrt package picker: tick boxes instead of typing package names.
import { $, split } from "./utils.js";

const GROUPS = [
  {
    title: "科学上网（一般选一个就够，都带中文界面）",
    note: "第三方插件来自各项目公开软件源，构建时自动加入并换成 dnsmasq-full。小闪存机型会在这里提示哪些装得下。",
    items: [
      { name: "PassWall", desc: "国内用得最多，已带 Xray 内核", pkgs: ["luci-app-passwall", "luci-i18n-passwall-zh-cn", "xray-core", "geoview", "v2ray-geoip", "v2ray-geosite", "kmod-nft-socket", "kmod-nft-tproxy", "kmod-nft-nat"], min: 23 },
      { name: "PassWall 2", desc: "PassWall 新版，按节点分流，带 Xray 内核", pkgs: ["luci-app-passwall2", "luci-i18n-passwall2-zh-cn", "xray-core", "kmod-nft-socket", "kmod-nft-tproxy", "kmod-nft-nat"], min: 23 },
      { name: "OpenClash", desc: "Clash 订阅，内核装好后在界面里下载", pkgs: ["luci-app-openclash"], min: 23 },
      { name: "Nikki", desc: "带 mihomo 内核，比 OpenClash 轻", pkgs: ["luci-app-nikki", "luci-i18n-nikki-zh-cn", "mihomo-meta"], min: 24 },
      { name: "SSR Plus", desc: "老牌 SSR/SS/V2Ray/Trojan 都支持，体积大", pkgs: ["luci-app-ssr-plus"], min: 24, feed25: true },
      { name: "HomeProxy", desc: "sing-box 内核，界面简洁，ImmortalWrt 自带那款", pkgs: ["luci-app-homeproxy"], min: 24, feed25: true },
      { name: "FCHomo", desc: "mihomo 内核，支持订阅和分流", pkgs: ["luci-app-fchomo"], min: 24, feed25: true },
      { name: "Bypass", desc: "SSR Plus 的分支，带 SmartDNS，体积大（偏老）", pkgs: ["luci-app-bypass"], min: 24, feed25: true },
      { name: "v2rayA", desc: "官方源，网页管理", pkgs: ["luci-app-v2raya", "luci-i18n-v2raya-zh-cn"], min: 23 },
      { name: "仅 sing-box 内核", desc: "官方源，自己写配置", pkgs: ["sing-box"], min: 23 },
      { name: "仅 Xray 内核", desc: "官方源，自己写配置", pkgs: ["xray-core"], min: 23 },
    ],
  },
  {
    title: "中文与管理",
    items: [
      { name: "中文界面", desc: "LuCI 简体中文", pkgs: ["luci-i18n-base-zh-cn", "luci-i18n-firewall-zh-cn"], on: true },
      { name: "网页终端 ttyd", desc: "浏览器里开 SSH", pkgs: ["luci-app-ttyd", "luci-i18n-ttyd-zh-cn"] },
      { name: "断网自动重启", desc: "watchcat", pkgs: ["luci-app-watchcat", "luci-i18n-watchcat-zh-cn"] },
    ],
  },
  {
    title: "网络服务",
    items: [
      { name: "UPnP", desc: "游戏机、P2P 自动开端口", pkgs: ["luci-app-upnp", "luci-i18n-upnp-zh-cn"] },
      { name: "动态域名 DDNS", desc: "", pkgs: ["luci-app-ddns", "luci-i18n-ddns-zh-cn"] },
      { name: "WireGuard", desc: "回家组网", pkgs: ["luci-proto-wireguard"] },
      { name: "Tailscale", desc: "命令行，无界面", pkgs: ["tailscale"] },
      { name: "ZeroTier", desc: "命令行，无界面", pkgs: ["zerotier"] },
      { name: "frp 客户端", desc: "内网穿透", pkgs: ["luci-app-frpc", "luci-i18n-frpc-zh-cn"] },
      { name: "SmartDNS", desc: "测速选最快 DNS", pkgs: ["luci-app-smartdns", "luci-i18n-smartdns-zh-cn"] },
      { name: "AdGuard Home", desc: "去广告", pkgs: ["luci-app-adguardhome"], min: 25 },
      { name: "广告过滤 adblock", desc: "轻量", pkgs: ["luci-app-adblock", "luci-i18n-adblock-zh-cn"] },
      { name: "SQM 智能限速", desc: "打游戏不卡", pkgs: ["luci-app-sqm", "luci-i18n-sqm-zh-cn"] },
      { name: "多拨负载均衡 mwan3", desc: "", pkgs: ["luci-app-mwan3", "luci-i18n-mwan3-zh-cn"] },
      { name: "网络唤醒", desc: "", pkgs: ["luci-app-wol", "luci-i18n-wol-zh-cn"] },
      { name: "流量统计", desc: "nlbwmon", pkgs: ["luci-app-nlbwmon", "luci-i18n-nlbwmon-zh-cn"] },
      { name: "SSL 证书 acme", desc: "", pkgs: ["luci-app-acme", "luci-i18n-acme-zh-cn"] },
    ],
  },
  {
    title: "存储与下载（需要 USB 口或大闪存）",
    items: [
      { name: "U 盘挂载", desc: "USB 存储、ext4/exFAT", pkgs: ["block-mount", "kmod-usb-storage", "kmod-fs-ext4", "kmod-fs-exfat"] },
      { name: "Samba 共享", desc: "电脑访问 U 盘", pkgs: ["luci-app-samba4", "luci-i18n-samba4-zh-cn"] },
      { name: "Aria2 下载", desc: "", pkgs: ["luci-app-aria2", "luci-i18n-aria2-zh-cn"] },
      { name: "Transmission", desc: "BT 下载", pkgs: ["luci-app-transmission", "luci-i18n-transmission-zh-cn"] },
      { name: "文件管理", desc: "filebrowser", pkgs: ["luci-app-filebrowser", "luci-i18n-filebrowser-zh-cn"] },
      { name: "Docker", desc: "仅 x86 或大内存机型", pkgs: ["luci-app-dockerman", "luci-i18n-dockerman-zh-cn", "dockerd"] },
    ],
  },
];

// Small-flash warning: IMAGE_SIZE (KB) per profile from OpenWrt source (scripts/flashsize.py),
// plugin cost = measured sysupgrade growth on Xiaomi 4A Gigabit 24.10.8 (KB). BASE_KB = same build with no plugin.
const PLUGIN_KB = {"OpenClash": 12287, "Nikki": 17919, "PassWall": 15039, "PassWall 2": 14527, "FCHomo": 11903, "SSR Plus": 10815, "HomeProxy": 10559, "Bypass": 10367, "v2rayA": 15359, "仅 sing-box 内核": 10047, "仅 Xray 内核": 6720};
const BASE_KB = 7169;
const flash = { sizes: null, limit: 0 };
async function loadFlash(target, profile) {
  flash.limit = 0;
  try {
    if (!flash.sizes) flash.sizes = await (await fetch("/flash-sizes.json")).json();
    flash.limit = ((flash.sizes[(target || "").split("/")[0]] || {})[profile]) || 0;
  } catch {}
  showFlash();
  syncPicker(false);
}
window.addEventListener("lukewrt-device", (e) => loadFlash((e.detail || {}).target, (e.detail || {}).profile));
function mb(kb) { return (kb / 1024).toFixed(1).replace(/\.0$/, ""); }
function tooBig(it) {
  const k = PLUGIN_KB[it.name];
  return flash.limit && k != null && BASE_KB + k > flash.limit;
}
function showFlash() {
  const n = document.getElementById("lw-flash");
  if (!n) return;
  if (!flash.limit || flash.limit > 30 * 1024) { n.hidden = true; return; }
  const tier = flash.limit <= 8 * 1024 ? "8MB" : flash.limit <= 16 * 1024 ? "16MB" : "32MB";
  const fit = GROUPS[0].items.filter((it) => PLUGIN_KB[it.name] != null && !tooBig(it)).map((it) => it.name);
  n.hidden = false;
  n.textContent = `⚠ 这台是 ${tier} 闪存机型，固件最大约 ${mb(flash.limit)}MB。` +
    (fit.length ? `按实测体积估算，科学上网插件能装下的：${fit.join("、")}；标了「装不下」的别勾，勾了会编译失败。` : "按实测体积估算，科学上网插件都装不下，建议只编官方基础固件，或换大闪存机型。") +
    "插件之外每多勾一项也会占空间，一般只选一个科学插件。";
}

// 25.12+ (apk): these come from LukeWrt's own feed, which exists only for some CPU architectures
const own = { key: "", names: new Set() };
window.addEventListener("lukewrt-device", async (e) => {
  const { version, arch } = e.detail || {};
  const m = (version || "").match(/^(\d+)\.(\d+)/);
  if (!m || +m[1] < 25 || !arch) return;
  const key = `${m[1]}.${m[2]}/${arch}`;
  if (own.key === key) return;
  own.key = key; own.names = new Set();
  try {
    const r = await fetch(`/packages/feed/${key}/index.json`);
    if (r.ok) own.names = new Set(Object.keys((await r.json()).packages || {}));
  } catch {}
  showFlash();
  syncPicker(false);
});

function major() {
  const v = ($("#versions") || {}).value || "";
  const m = v.match(/^(\d+)\./);
  return m ? parseInt(m[1]) : 99;
}

function current() {
  return new Set(split($("#asu-packages").value));
}

function write(set) {
  $("#asu-packages").value = [...set].join(" ");
}

export function syncPicker(fresh) {
  const box = $("#lukewrt-picker");
  if (!box) return;
  const have = current();
  const mj = major();
  if (fresh) {
    // first load for a device: apply default-on items
    for (const g of GROUPS) for (const it of g.items) if (it.on) it.pkgs.forEach((p) => have.add(p));
    write(have);
  }
  box.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    const it = GROUPS[cb.dataset.g].items[cb.dataset.i];
    let ok = mj >= (it.min || 0) && mj <= (it.max || 99);
    if (ok && it.feed25 && mj >= 25) ok = it.pkgs.every((p) => own.names.has(p));
    cb.disabled = !ok;
    cb.closest("label").classList.toggle("lw-off", !ok);
    cb.checked = ok && it.pkgs.every((p) => have.has(p));
    const tag = cb.closest("label").querySelector(".lw-big");
    if (tag) tag.hidden = !(ok && tooBig(it));
  });
}

export function setupPicker() {
  const ta = $("#asu-packages");
  if (!ta || $("#lukewrt-picker")) return;
  const box = document.createElement("div");
  box.id = "lukewrt-picker";
  GROUPS.forEach((g, gi) => {
    const fs = document.createElement("fieldset");
    const lg = document.createElement("legend");
    lg.textContent = g.title;
    fs.appendChild(lg);
    if (g.note) {
      const n = document.createElement("p");
      n.className = "lw-note";
      n.textContent = g.note;
      fs.appendChild(n);
    }
    g.items.forEach((it, ii) => {
      const l = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.g = gi;
      cb.dataset.i = ii;
      cb.addEventListener("change", () => {
        const have = current();
        it.pkgs.forEach((p) => (cb.checked ? have.add(p) : have.delete(p)));
        write(have);
      });
      const t = document.createElement("span");
      t.innerHTML = "<b></b> <small></small>";
      t.querySelector("b").textContent = it.name;
      t.querySelector("small").textContent = (it.desc || "") + (it.feed25 ? "（25.12 暂只支持 x86_64 等部分架构，灰色就是这台不支持）" : it.min > 23 && !it.max ? `（需 ${it.min}.x 及以上）` : "");
      if (gi === 0) {
        const big = document.createElement("em");
        big.className = "lw-big";
        big.hidden = true;
        big.textContent = "本机装不下";
        t.appendChild(big);
      }
      l.append(cb, t);
      fs.appendChild(l);
    });
    box.appendChild(fs);
  });
  const warn = document.createElement("p");
  warn.id = "lw-flash";
  warn.hidden = true;
  box.insertBefore(warn, box.firstChild);
  const h = document.createElement("h4");
  h.textContent = "常用插件（勾选即加入下方软件包列表，也可手动编辑）";
  const label = $("#asu-packages-label");
  label.parentNode.insertBefore(h, label);
  label.parentNode.insertBefore(box, label);
  ta.addEventListener("input", () => syncPicker(false));
  const ver = $("#versions");
  if (ver) ver.addEventListener("change", () => setTimeout(() => syncPicker(false), 0));
  showFlash();
  syncPicker(false);
}
