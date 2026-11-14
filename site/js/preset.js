// LukeWrt 预置设置（高级功能）：生成 uci-defaults 首次启动脚本
import { getCode } from "./pay.js";
const ASU_PKGS = ["luci-app-attendedsysupgrade", "luci-i18n-attendedsysupgrade-zh-cn"];
const q = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'";
const ipOk = (s) => /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split(".").every((n) => +n <= 255);

const css = `
#lw-preset{margin:.6em 0 1em;padding:.6em .8em;border:1px solid #ccc;border-radius:6px;font-size:.92em}
#lw-preset label{display:inline-block;margin:.25em 1em .25em 0}
#lw-preset input[type=text],#lw-preset input[type=password]{width:11em}
#lw-preset .row{margin:.3em 0}
#lw-preset .hint{color:#888;font-size:.85em}
`;

export function presetScript(v) {
  const L = ["#!/bin/sh", "# LukeWrt 预置设置，首次开机自动执行一次"];
  if (v.ip) {
    L.push(`uci set network.lan.ipaddr=${q(v.ip)}`, `uci set network.lan.netmask=${q(v.mask || "255.255.255.0")}`);
  }
  if (v.mode === "bypass" && v.gw) {
    L.push(
      `uci set network.lan.gateway=${q(v.gw)}`,
      "uci -q delete network.lan.dns",
      `uci add_list network.lan.dns=${q(v.dns || v.gw)}`,
      "uci set dhcp.lan.ignore='1'",
      "uci -q delete dhcp.lan.ra; uci -q delete dhcp.lan.dhcpv6"
    );
  } else if (v.wan === "pppoe" && v.user) {
    L.push("uci set network.wan.proto='pppoe'", `uci set network.wan.username=${q(v.user)}`, `uci set network.wan.password=${q(v.pass)}`);
  }
  L.push("uci commit network", "uci commit dhcp");
  if (v.ssid) {
    L.push(
      "for r in $(uci show wireless | sed -n 's/^wireless\\.\\([^.=]*\\)=wifi-device$/\\1/p'); do",
      "  uci set wireless.$r.disabled='0'; uci set wireless.$r.country='CN'",
      "done",
      "for i in $(uci show wireless | sed -n 's/^wireless\\.\\([^.=]*\\)=wifi-iface$/\\1/p'); do",
      `  uci set wireless.$i.ssid=${q(v.ssid)}`,
      v.wpass ? `  uci set wireless.$i.encryption='psk2'; uci set wireless.$i.key=${q(v.wpass)}` : "  uci set wireless.$i.encryption='none'",
      "  uci set wireless.$i.disabled='0'",
      "done",
      "uci commit wireless"
    );
  }
  if (v.tz) L.push("uci set system.@system[0].zonename='Asia/Shanghai'", "uci set system.@system[0].timezone='CST-8'", "uci commit system");
  if (v.upg) L.push(`uci set attendedsysupgrade.@server[0].url=${q(v.upg)}`, "uci commit attendedsysupgrade");
  if (v.root) L.push(`(echo ${q(v.root)}; sleep 1; echo ${q(v.root)}) | passwd root >/dev/null 2>&1`);
  L.push("exit 0");
  return L.join("\n") + "\n";
}

function val(id) { const e = document.getElementById(id); return e ? (e.type === "checkbox" ? e.checked : e.value.trim()) : ""; }

export function initPreset() {
  if (document.getElementById("lw-preset")) return;
  const label = document.getElementById("uci-defaults-label");
  if (!label) return;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const box = document.createElement("div");
  box.id = "lw-preset";
  box.innerHTML = `
  <h4 style="margin:.2em 0">预置设置 <span class="hint">（高级功能：刷完即用，需激活码）</span></h4>
  <div class="row"><label>工作模式 <select id="lwp-mode"><option value="main">主路由</option><option value="bypass">旁路由</option></select></label>
    <label>管理 IP <input type="text" id="lwp-ip" placeholder="192.168.1.1"></label>
    <label>子网掩码 <input type="text" id="lwp-mask" placeholder="255.255.255.0"></label></div>
  <div class="row" id="lwp-main"><label>上网方式 <select id="lwp-wan"><option value="dhcp">自动获取 (DHCP)</option><option value="pppoe">PPPoE 拨号</option></select></label>
    <span id="lwp-ppp" style="display:none"><label>宽带账号 <input type="text" id="lwp-user"></label><label>宽带密码 <input type="password" id="lwp-pass"></label></span></div>
  <div class="row" id="lwp-bypass" style="display:none"><label>主路由（网关）IP <input type="text" id="lwp-gw" placeholder="192.168.1.1"></label>
    <label>DNS <input type="text" id="lwp-dns" placeholder="同网关"></label><span class="hint">旁路由会自动关闭 DHCP</span></div>
  <div class="row"><label>WiFi 名称 <input type="text" id="lwp-ssid"></label><label>WiFi 密码 <input type="password" id="lwp-wpass" placeholder="至少 8 位"></label></div>
  <div class="row"><label>后台 root 密码 <input type="password" id="lwp-root" placeholder="留空则无密码"></label>
    <label><input type="checkbox" id="lwp-tz" checked> 时区设为北京时间</label></div>
  <div class="row"><label><input type="checkbox" id="lwp-upg"> 预装在线一键升级（永久版专享：以后在路由后台“系统→托管升级”一键升到新版，保留设置和插件）</label></div>
  <div class="row"><button id="lwp-gen">生成到下方脚本</button> <span id="lwp-msg" class="hint"></span></div>
  <div class="hint">密码会写进固件和本次编译记录（7 天后自动删除）；介意的话刷机后再改。</div>`;
  label.parentNode.insertBefore(box, label);
  const sync = () => {
    const by = val("lwp-mode") === "bypass";
    document.getElementById("lwp-main").style.display = by ? "none" : "";
    document.getElementById("lwp-bypass").style.display = by ? "" : "none";
    document.getElementById("lwp-ppp").style.display = val("lwp-wan") === "pppoe" ? "" : "none";
  };
  document.getElementById("lwp-mode").onchange = sync;
  document.getElementById("lwp-wan").onchange = sync;
  document.getElementById("lwp-gen").onclick = (e) => {
    e.preventDefault();
    const v = { mode: val("lwp-mode"), ip: val("lwp-ip"), mask: val("lwp-mask"), wan: val("lwp-wan"), user: val("lwp-user"), pass: val("lwp-pass"),
      gw: val("lwp-gw"), dns: val("lwp-dns"), ssid: val("lwp-ssid"), wpass: val("lwp-wpass"), root: val("lwp-root"), tz: val("lwp-tz") };
    if (val("lwp-upg")) {
      const code = getCode();
      if (!code) { document.getElementById("lwp-msg").textContent = "一键升级需要先输入或购买永久版激活码"; return; }
      v.upg = `${location.origin}/u/${code}`;
      const ta = document.getElementById("asu-packages");
      const have = new Set(ta.value.split(/\s+/).filter(Boolean));
      ASU_PKGS.forEach((p) => have.add(p));
      ta.value = [...have].join(" ");
      ta.dispatchEvent(new Event("input"));
    }
    const msg = document.getElementById("lwp-msg");
    for (const k of ["ip", "mask", "gw", "dns"]) if (v[k] && !ipOk(v[k])) { msg.textContent = `IP 格式不对：${v[k]}`; return; }
    if (v.mode === "bypass" && !v.gw) { msg.textContent = "旁路由要填主路由 IP"; return; }
    if (v.mode === "bypass" && !v.ip) { msg.textContent = "旁路由要填自己的管理 IP（和主路由同网段）"; return; }
    if (v.wpass && v.wpass.length < 8) { msg.textContent = "WiFi 密码至少 8 位"; return; }
    if (v.wan === "pppoe" && v.mode !== "bypass" && (!v.user || !v.pass)) { msg.textContent = "PPPoE 要填账号和密码"; return; }
    document.getElementById("uci-defaults-content").value = presetScript(v);
    msg.textContent = "已生成。点“请求构建”时需要激活码。";
  };
}
