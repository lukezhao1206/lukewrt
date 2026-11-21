// LukeWrt Telegram bot (@OpenWrtDIYBot): webhook inside the main Worker, reusing build/queue/pay/feedback.
import { GROUPS, PLUGIN_KB, BASE_KB, ALIASES } from "./tgdata.js";
import { checkCode, createOrder, orderStatus, PLANS } from "./pay.js";

const FREE_K9 = ["luci-app-ssr-plus", "luci-app-homeproxy", "luci-app-fchomo", "luci-app-bypass"];
const ASU_PKGS = ["luci-app-attendedsysupgrade", "luci-i18n-attendedsysupgrade-zh-cn"];
const CODE_RE = /LW-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/i;

// ---------- i18n ----------
const GT = {
  en: ["Proxy (pick one)", "Chinese UI & admin", "Network services", "Storage & downloads (USB or big flash)"],
  tw: ["科學上網（一般選一個就夠）", "中文與管理", "網路服務", "儲存與下載（需要 USB 或大快閃記憶體）"],
};
const IN_EN = { "仅 sing-box 内核": "sing-box core only", "仅 Xray 内核": "Xray core only", "中文界面": "Chinese LuCI", "网页终端 ttyd": "Web terminal ttyd",
  "断网自动重启": "Watchcat (auto reboot)", "动态域名 DDNS": "DDNS", "frp 客户端": "frp client", "广告过滤 adblock": "adblock", "SQM 智能限速": "SQM QoS",
  "多拨负载均衡 mwan3": "mwan3 load balance", "网络唤醒": "Wake on LAN", "流量统计": "Traffic stats nlbwmon", "SSL 证书 acme": "ACME certificates",
  "U 盘挂载": "USB storage", "Samba 共享": "Samba share", "Aria2 下载": "Aria2", "文件管理": "File browser" };
const S = {
  zh: {
    hello: "👋 LukeWrt 在线定制 OpenWrt 固件（官方源码、免费编译）。\n\n/build 定制固件\n/code 激活码查询/绑定\n/buy 购买高级功能（¥3 单次 / ¥88 永久）\n/status 我的构建\n/feedback 意见反馈\n/language 语言\n\n网页版：fw.luke.us.eu.org",
    b_build: "🔧 定制固件", b_code: "🔑 激活码", b_buy: "💳 购买", b_status: "📋 我的构建", b_fb: "💬 反馈", b_lang: "🌐 Language",
    ask_model: "发送机型名称，例如：小米4A千兆、AX3000T、红米AC2100、x86",
    no_model: "没找到「{0}」，换个写法试试（品牌+型号，如 xiaomi 4a、tp-link 3200）。",
    pick_model: "找到这些，点选你的机型：", more: "（只显示前 {0} 个，可输入更完整的名称）",
    pick_ver: "📦 {0}\n选择 OpenWrt 版本：", ver_note: "25.12 是新版（apk 包管理），24.10 插件最全。",
    menu: "📦 {0}\n🏷 版本 {1}\n🧩 插件：{2}\n⚙️ 预置设置：{3}\n📚 插件大库：{4}{5}\n\n点分类勾选插件，选好后点「开始编译」。",
    none: "无", on: "已设置", b_go: "🚀 开始编译", b_preset: "⚙️ 预置设置（高级）", b_k9: "📚 插件大库（高级）", b_back: "« 返回", b_done: "✅ 选好了",
    b_chmodel: "🔄 换机型", b_chver: "🔄 换版本",
    flash: "\n⚠️ {0} 闪存机型，固件最大约 {1}MB。能装下的科学插件：{2}。标 ⛔ 的装不下，勾了会编译失败。",
    flash_none: "都装不下，建议只编基础固件",
    too_big: "⛔ 这台闪存装不下 {0}", not_ver: "这个插件 {0} 版本没有", no_feed: "25.12 这个插件只有 x86_64 有，换 24.10 可用",
    k9_ask: "插件大库（第三方插件，高级功能）：发送要加的包名，空格分隔，如：luci-app-adguardhome luci-theme-argon\n发送「清空」可清除。", k9_25: "插件大库目前只支持 24.10，请先换到 24.10.x。",
    k9_set: "已设置插件大库：{0}",
    submitted: "✅ 已提交编译\n{0}\n排队位置：{1}\n编译约 3–10 分钟，完成后我会通知你。", running: "正在编译…", queued_n: "前面还有 {0} 个",
    b_refresh: "🔄 刷新", b_prio: "⚡ 优先排队",
    done: "🎉 编译完成：{0}\n点下方按钮下载（链接 30 天有效）。刷机前请确认机型完全一致。", failed: "❌ 编译失败：{0}\n{1}\n付费码不会扣次。可减少插件后重试，或 /feedback 告诉我们。",
    need_pay: "这次用到了高级功能（预置设置/插件大库/优先排队），需要激活码：单次 ¥3，永久 ¥88（不限次、优先排队、在线一键升级）。\n已有激活码直接发给我即可绑定。",
    b_p1: "¥3 单次", b_p2: "¥88 永久", buy_ask: "选择套餐：\n¥3 单次：一次高级编译（编译成功才扣次）\n¥88 永久：不限次 + 优先排队 + 在线一键升级",
    pay_msg: "请用支付宝扫码或点链接付款 ¥{0}（15 分钟内有效）\n订单 {1}\n付款后自动发码，也可以点「我已付款」。", b_paid: "我已付款", b_alipay: "打开支付宝付款",
    pay_wait: "还没收到付款，稍等几秒再点。", pay_ok: "✅ 付款成功！激活码：\n{0}\n已自动绑定到你的账号，请妥善保存。", pay_err: "下单失败：{0}",
    code_none: "还没绑定激活码。直接把激活码（LW-XXXX-XXXX-XXXX）发给我即可绑定，或 /buy 购买。",
    code_info: "当前激活码：{0}\n{1}", forever: "永久版，不限次", left: "剩余 {0} 次", code_bad: "激活码无效或已用完。", code_bound: "✅ 已绑定激活码 {0}\n{1}",
    b_unbind: "解除绑定", unbound: "已解除绑定。",
    no_jobs: "还没有构建记录，/build 开始。", jobs: "最近的构建：",
    st_done: "✅ 完成", st_failed: "❌ 失败", st_queued: "⏳ 排队", st_building: "🔨 编译中",
    fb_ask: "请直接发送你的问题或建议（可附联系方式）：", fb_ok: "✅ 已收到，谢谢！站长会尽快查看。", fb_err: "提交失败：{0}",
    lang_pick: "选择语言 / 選擇語言 / Choose language:", lang_ok: "已切换为简体中文。",
    prio_ok: "⚡ 已优先排队，前面还有 {0} 个。", prio_already: "已经在优先队列里了。", prio_gone: "这个任务已不在排队中。",
    rate: "{0}", err: "出错了：{0}",
    p_mode: "⚙️ 预置设置 1/6：工作模式？", b_main: "主路由", b_bypass: "旁路由",
    p_ip: "管理 IP（如 192.168.1.1）：", p_ip_by: "旁路由自己的管理 IP（和主路由同网段，如 192.168.1.2）：",
    p_wan: "上网方式？", b_dhcp: "自动获取 DHCP", b_pppoe: "PPPoE 拨号", p_user: "宽带账号：", p_pass: "宽带密码：",
    p_gw: "主路由（网关）IP：", p_dns: "DNS（不填则同网关）：", p_ssid: "WiFi 名称（不需要就跳过）：", p_wpass: "WiFi 密码（至少 8 位）：",
    p_root: "后台 root 密码（跳过则无密码）：", p_upg: "预装在线一键升级？（永久版专享，以后后台一键升新版并保留设置）", b_yes: "要", b_no: "不要",
    p_done: "✅ 预置设置已生成（刷机后首次开机自动执行，时区北京时间）。密码会写进固件，介意的话刷机后再改。", b_skip: "跳过", b_clear: "清除预置",
    p_badip: "IP 格式不对，请重新输入。", p_short: "WiFi 密码至少 8 位，请重新输入。", p_need: "这一项必填。", p_cleared: "已清除预置设置。",
    gone: "会话已过期，请重新 /build。",
  },
  tw: {},
  en: {
    hello: "👋 LukeWrt — build custom OpenWrt firmware online (official sources, free builds).\n\n/build build firmware\n/code check/bind activation code\n/buy premium (¥3 once / ¥88 lifetime)\n/status my builds\n/feedback feedback\n/language language\n\nWeb: fw.luke.us.eu.org",
    b_build: "🔧 Build", b_code: "🔑 Code", b_buy: "💳 Buy", b_status: "📋 My builds", b_fb: "💬 Feedback", b_lang: "🌐 语言",
    ask_model: "Send your device name, e.g. Xiaomi AX3000T, Archer C7, x86",
    no_model: "Nothing found for “{0}”. Try brand + model, e.g. xiaomi 4a, tp-link c7.",
    pick_model: "Tap your device:", more: "(showing first {0}; type a fuller name to narrow)",
    pick_ver: "📦 {0}\nChoose OpenWrt version:", ver_note: "25.12 is newest (apk); 24.10 has the most plugins.",
    menu: "📦 {0}\n🏷 Version {1}\n🧩 Packages: {2}\n⚙️ Presets: {3}\n📚 Plugin library: {4}{5}\n\nTap a category to tick packages, then “Build”.",
    none: "none", on: "set", b_go: "🚀 Build", b_preset: "⚙️ Presets (premium)", b_k9: "📚 Plugin library (premium)", b_back: "« Back", b_done: "✅ Done",
    b_chmodel: "🔄 Device", b_chver: "🔄 Version",
    flash: "\n⚠️ {0} flash device, max image ≈ {1}MB. Proxy plugins that fit: {2}. Items marked ⛔ won’t fit.",
    flash_none: "none fit; build a basic image",
    too_big: "⛔ {0} won’t fit this flash", not_ver: "Not available for {0}", no_feed: "On 25.12 this plugin exists for x86_64 only; use 24.10",
    k9_ask: "Plugin library (third-party, premium): send package names separated by spaces, e.g. luci-app-adguardhome luci-theme-argon\nSend “clear” to remove.", k9_25: "The plugin library supports 24.10 only. Switch to 24.10.x first.",
    k9_set: "Plugin library set: {0}",
    submitted: "✅ Build submitted\n{0}\nQueue: {1}\nTakes ~3–10 min; I’ll message you when done.", running: "building…", queued_n: "{0} ahead",
    b_refresh: "🔄 Refresh", b_prio: "⚡ Priority",
    done: "🎉 Build finished: {0}\nDownload below (links valid 30 days). Make sure the model matches exactly before flashing.", failed: "❌ Build failed: {0}\n{1}\nPaid codes are not charged. Try fewer packages, or tell us via /feedback.",
    need_pay: "This build uses premium features (presets / plugin library / priority) and needs a code: ¥3 single or ¥88 lifetime.\nAlready have a code? Just send it to me.",
    b_p1: "¥3 single", b_p2: "¥88 lifetime", buy_ask: "Choose a plan:\n¥3 single: one premium build (charged only if it succeeds)\n¥88 lifetime: unlimited + priority + one-click online upgrade",
    pay_msg: "Pay ¥{0} with Alipay: scan the QR or tap the link (valid 15 min)\nOrder {1}\nThe code is sent automatically after payment.", b_paid: "I’ve paid", b_alipay: "Open Alipay",
    pay_wait: "Payment not received yet; try again in a few seconds.", pay_ok: "✅ Paid! Your code:\n{0}\nIt’s bound to your account. Keep it safe.", pay_err: "Order failed: {0}",
    code_none: "No code bound. Send your code (LW-XXXX-XXXX-XXXX) to bind it, or /buy.",
    code_info: "Current code: {0}\n{1}", forever: "lifetime, unlimited", left: "{0} build(s) left", code_bad: "Invalid or used-up code.", code_bound: "✅ Code bound: {0}\n{1}",
    b_unbind: "Unbind", unbound: "Unbound.",
    no_jobs: "No builds yet. Start with /build.", jobs: "Recent builds:",
    st_done: "✅ done", st_failed: "❌ failed", st_queued: "⏳ queued", st_building: "🔨 building",
    fb_ask: "Send your question or suggestion (add contact info if you like):", fb_ok: "✅ Received, thank you!", fb_err: "Failed: {0}",
    lang_pick: "选择语言 / 選擇語言 / Choose language:", lang_ok: "Switched to English.",
    prio_ok: "⚡ Prioritised, {0} ahead.", prio_already: "Already prioritised.", prio_gone: "This job is no longer queued.",
    rate: "{0}", err: "Error: {0}",
    p_mode: "⚙️ Presets 1/6: mode?", b_main: "Main router", b_bypass: "Side router (bypass)",
    p_ip: "LAN IP (e.g. 192.168.1.1):", p_ip_by: "This router’s own LAN IP (same subnet as main router, e.g. 192.168.1.2):",
    p_wan: "WAN type?", b_dhcp: "DHCP", b_pppoe: "PPPoE", p_user: "PPPoE username:", p_pass: "PPPoE password:",
    p_gw: "Main router (gateway) IP:", p_dns: "DNS (skip = gateway):", p_ssid: "WiFi name (skip if none):", p_wpass: "WiFi password (8+ chars):",
    p_root: "root password (skip = none):", p_upg: "Pre-install one-click online upgrade? (lifetime only)", b_yes: "Yes", b_no: "No",
    p_done: "✅ Presets ready (applied on first boot). Passwords are baked into the image; change them after flashing if you prefer.", b_skip: "Skip", b_clear: "Clear presets",
    p_badip: "Invalid IP, please re-enter.", p_short: "WiFi password needs 8+ characters.", p_need: "Required.", p_cleared: "Presets cleared.",
    gone: "Session expired, please /build again.",
  },
};
// Traditional Chinese: convert from simplified with a small char map (good enough for UI strings)
const S2T = "这這个個们們为為么麼发發选選择擇编編译譯机機载載设設置置级級库庫插插件件闪閃存存装裝开開码碼购購买買单單次次绑綁定定询詢问問题題见見馈饋语語言言网網络絡务務储儲压壓号號过過还還没沒时時间間后後经經实實现現应應该該个個这這会會传傳输輸态態队隊列列刷刷认認证證请請稍稍击擊链鏈接接效效钮鈕页頁宽寬带帶账賬户戶密密码碼称稱无無线線动動获獲取取拨撥闲閒预預执執行行区區京京换換写寫试試组組软軟丰豐须須态態够夠钟鐘扫掃确確务務仅僅关關启啟别別双雙复複杂雜内內核核办辦录錄标標记記败敗减減少少诉訴们們谢謝尽盡则則数數错錯误誤话話与與边邊运運长長级級达達简簡体體换換齐齊样樣才才扣扣满滿约約从從于於";
const s2tMap = {}; for (let i = 0; i < S2T.length; i += 2) s2tMap[S2T[i]] = S2T[i + 1];
const toTW = (s) => s.replace(/[\u4e00-\u9fff]/g, (c) => s2tMap[c] || c);
for (const [k, v] of Object.entries(S.zh)) S.tw[k] = toTW(v);
S.tw.lang_ok = "已切換為繁體中文。"; S.tw.b_lang = "🌐 Language";
const t = (s, k, ...a) => String((S[s.lang] || S.zh)[k] ?? S.zh[k] ?? k).replace(/\{(\d)\}/g, (_, i) => a[i] ?? "");
const langOf = (c) => { c = (c || "").toLowerCase(); if (!c.startsWith("zh")) return "en"; return /hant|tw|hk|mo/.test(c) ? "tw" : "zh"; };
const gTitle = (s, gi) => s.lang === "zh" ? GROUPS[gi].title.replace(/（.*$/, "") : (GT[s.lang] || [])[gi] || GROUPS[gi].title;
const iName = (s, it) => s.lang === "en" ? IN_EN[it.name] || it.name : s.lang === "tw" ? toTW(it.name) : it.name;

// ---------- Telegram API ----------
async function tgToken(env) { if (env._tgtok === undefined) env._tgtok = (await env.JOBS.get("cfg:tg_token")) || ""; return env._tgtok; }
async function tg(env, method, body) {
  if (env._dry) { env._dry.push({ method, body }); return { ok: true, result: { message_id: 1 } }; }
  const tok = await tgToken(env);
  if (!tok) return { ok: false };
  const r = await fetch(`https://api.telegram.org/bot${tok}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false }));
}
const kb = (rows) => ({ inline_keyboard: rows });
const send = (env, chat, text, rows, extra = {}) => tg(env, "sendMessage", { chat_id: chat, text, disable_web_page_preview: true, ...(rows ? { reply_markup: kb(rows) } : {}), ...extra });
const edit = (env, chat, mid, text, rows) => tg(env, "editMessageText", { chat_id: chat, message_id: mid, text, disable_web_page_preview: true, ...(rows ? { reply_markup: kb(rows) } : {}) });

// ---------- session ----------
async function load(env, uid) { const r = await env.JOBS.get(`tgs:${uid}`); return r ? JSON.parse(r) : null; }
async function save(env, uid, s) { await env.JOBS.put(`tgs:${uid}`, JSON.stringify(s), { expirationTtl: 180 * 86400 }); }

// ---------- data helpers ----------
let OV = {}; // version -> profiles (isolate cache)
async function versions(api) { const o = await api.overview(); return o.latest.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).filter((v) => +v.split(".")[0] >= 23).slice(0, 3); }
async function profilesOf(api, v) { if (!OV[v]) OV[v] = (await api.upstreamJson(`/releases/${v}/.overview.json`)).profiles; return OV[v]; }
const titleOf = (p) => p.titles.map((x) => x.title || [x.vendor, x.model, x.variant].filter(Boolean).join(" ")).join(" / ");
function norm(q) {
  let p = String(q || "");
  for (const [zh, en] of ALIASES) p = p.split(zh).join(" " + en + " ");
  p = p.replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, "$1 $2").replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, "$1 $2");
  return p.toUpperCase().split(/\s+/).filter(Boolean);
}
const compact = (x) => x.toUpperCase().replace(/[^A-Z0-9]/g, "");
async function search(api, q) {
  const toks = norm(q).map(compact).filter(Boolean);
  if (!toks.length) return [];
  const vs = await versions(api), seen = new Map();
  for (const v of vs) {
    for (const p of await profilesOf(api, v)) {
      const key = p.target + "|" + p.id;
      if (seen.has(key)) { seen.get(key).vers.push(v); continue; }
      const title = titleOf(p), flat = compact(title + " " + p.id);
      if (toks.every((k) => flat.includes(k))) seen.set(key, { id: p.id, target: p.target, title, vers: [v] });
    }
  }
  return [...seen.values()].sort((a, b) => a.title.length - b.title.length);
}
async function flashLimit(env, target, profile) {
  if (!env._flash) { const o = await env.BUCKET.get("site/flash-sizes.json"); env._flash = o ? await o.json() : {}; }
  return ((env._flash[(target || "").split("/")[0]] || {})[profile]) || 0;
}
async function ownFeed(env, version, arch) {
  const m = version.match(/^(\d+)\.(\d+)/);
  const o = await env.BUCKET.get(`packages/feed/${m[1]}.${m[2]}/${arch}/index.json`);
  return o ? new Set(Object.keys((await o.json()).packages || {})) : new Set();
}

// ---------- screens ----------
function mainRows(s) {
  return [[{ text: t(s, "b_build"), callback_data: "build" }, { text: t(s, "b_code"), callback_data: "code" }],
    [{ text: t(s, "b_buy"), callback_data: "buy" }, { text: t(s, "b_status"), callback_data: "status" }],
    [{ text: t(s, "b_fb"), callback_data: "fb" }, { text: t(s, "b_lang"), callback_data: "lang" }]];
}
async function itemState(env, s, it) {
  const maj = +s.ver.split(".")[0];
  if (it.min && maj < it.min) return t(s, "not_ver", s.ver);
  if (it.feed25 && maj >= 25 && !(s.feed || []).includes(it.pkgs[0])) return t(s, "no_feed");
  if (s.flash && PLUGIN_KB[it.name] != null && BASE_KB + PLUGIN_KB[it.name] > s.flash) return t(s, "too_big", iName(s, it));
  return "";
}
function flashNote(s) {
  if (!s.flash || s.flash > 30 * 1024) return "";
  const tier = s.flash <= 8192 ? "8MB" : s.flash <= 16384 ? "16MB" : "32MB";
  const fit = GROUPS[0].items.filter((it) => PLUGIN_KB[it.name] != null && BASE_KB + PLUGIN_KB[it.name] <= s.flash).map((it) => it.name);
  return t(s, "flash", tier, (s.flash / 1024).toFixed(1), fit.length ? fit.join(s.lang === "en" ? ", " : "、") : t(s, "flash_none"));
}
function menuView(s) {
  const picks = [];
  GROUPS.forEach((g, gi) => g.items.forEach((it, ii) => { if ((s.picks || []).includes(`${gi}.${ii}`)) picks.push(iName(s, it)); }));
  const text = t(s, "menu", s.title, s.ver, picks.join(", ") || t(s, "none"), s.preset ? t(s, "on") : t(s, "none"), (s.k9 || []).join(" ") || t(s, "none"), flashNote(s));
  const rows = GROUPS.map((g, gi) => [{ text: `${gTitle(s, gi)}`, callback_data: `g:${gi}` }]);
  rows.push([{ text: t(s, "b_preset"), callback_data: "pre" }, { text: t(s, "b_k9"), callback_data: "k9" }]);
  rows.push([{ text: t(s, "b_chmodel"), callback_data: "build" }, { text: t(s, "b_chver"), callback_data: "vers" }]);
  rows.push([{ text: t(s, "b_go"), callback_data: "go" }]);
  return [text, rows];
}
async function groupView(env, s, gi) {
  const rows = [];
  for (const [ii, it] of GROUPS[gi].items.entries()) {
    const on = (s.picks || []).includes(`${gi}.${ii}`), bad = await itemState(env, s, it);
    rows.push([{ text: `${on ? "✅" : bad ? "⛔" : "▫️"} ${iName(s, it)}`, callback_data: `p:${gi}:${ii}` }]);
  }
  rows.push([{ text: t(s, "b_done"), callback_data: "menu" }]);
  const desc = s.lang === "en" ? "" : "\n\n" + GROUPS[gi].items.map((it) => it.desc ? `• ${iName(s, it)}：${s.lang === "tw" ? toTW(it.desc) : it.desc}` : "").filter(Boolean).join("\n");
  return [gTitle(s, gi) + flashNote(s) + desc, rows];
}
function verRows(s) { return s.vers.map((v) => [{ text: v, callback_data: `v:${v}` }]).concat([[{ text: t(s, "b_chmodel"), callback_data: "build" }]]); }

// ---------- preset Q&A ----------
const q = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'";
const ipOk = (x) => /^(\d{1,3}\.){3}\d{1,3}$/.test(x) && x.split(".").every((n) => +n <= 255);
function presetScript(v) {
  const L = ["#!/bin/sh", "# LukeWrt 预置设置，首次开机自动执行一次"];
  if (v.ip) L.push(`uci set network.lan.ipaddr=${q(v.ip)}`, `uci set network.lan.netmask='255.255.255.0'`);
  if (v.mode === "bypass" && v.gw) {
    L.push(`uci set network.lan.gateway=${q(v.gw)}`, "uci -q delete network.lan.dns", `uci add_list network.lan.dns=${q(v.dns || v.gw)}`,
      "uci set dhcp.lan.ignore='1'", "uci -q delete dhcp.lan.ra; uci -q delete dhcp.lan.dhcpv6");
  } else if (v.wan === "pppoe" && v.user) {
    L.push("uci set network.wan.proto='pppoe'", `uci set network.wan.username=${q(v.user)}`, `uci set network.wan.password=${q(v.pass)}`);
  }
  L.push("uci commit network", "uci commit dhcp");
  if (v.ssid) {
    L.push("for r in $(uci show wireless | sed -n 's/^wireless\\.\\([^.=]*\\)=wifi-device$/\\1/p'); do", "  uci set wireless.$r.disabled='0'; uci set wireless.$r.country='CN'", "done",
      "for i in $(uci show wireless | sed -n 's/^wireless\\.\\([^.=]*\\)=wifi-iface$/\\1/p'); do", `  uci set wireless.$i.ssid=${q(v.ssid)}`,
      v.wpass ? `  uci set wireless.$i.encryption='psk2'; uci set wireless.$i.key=${q(v.wpass)}` : "  uci set wireless.$i.encryption='none'",
      "  uci set wireless.$i.disabled='0'", "done", "uci commit wireless");
  }
  L.push("uci set system.@system[0].zonename='Asia/Shanghai'", "uci set system.@system[0].timezone='CST-8'", "uci commit system");
  if (v.upg) L.push(`uci set attendedsysupgrade.@server[0].url=${q(v.upg)}`, "uci commit attendedsysupgrade");
  if (v.root) L.push(`(echo ${q(v.root)}; sleep 1; echo ${q(v.root)}) | passwd root >/dev/null 2>&1`);
  L.push("exit 0");
  return L.join("\n") + "\n";
}
// next preset step given answers so far
function nextStep(p) {
  if (!p.mode) return "mode";
  if (p.ip === undefined) return "ip";
  if (p.mode === "main") { if (!p.wan) return "wan"; if (p.wan === "pppoe") { if (p.user === undefined) return "user"; if (p.pass === undefined) return "pass"; } }
  else { if (p.gw === undefined) return "gw"; if (p.dns === undefined) return "dns"; }
  if (p.ssid === undefined) return "ssid";
  if (p.ssid && p.wpass === undefined) return "wpass";
  if (p.root === undefined) return "root";
  if (p.upgAsk && p.upg === undefined) return "upg";
  return "";
}
async function askStep(env, chat, s) {
  const st = nextStep(s.pq);
  if (!st) return finishPreset(env, chat, s);
  s.await = "p:" + st;
  const skip = [[{ text: t(s, "b_skip"), callback_data: "ps" }]];
  if (st === "mode") return send(env, chat, t(s, "p_mode"), [[{ text: t(s, "b_main"), callback_data: "pm:main" }, { text: t(s, "b_bypass"), callback_data: "pm:bypass" }]]);
  if (st === "wan") return send(env, chat, t(s, "p_wan"), [[{ text: t(s, "b_dhcp"), callback_data: "pw:dhcp" }, { text: t(s, "b_pppoe"), callback_data: "pw:pppoe" }]]);
  if (st === "upg") return send(env, chat, t(s, "p_upg"), [[{ text: t(s, "b_yes"), callback_data: "pu:1" }, { text: t(s, "b_no"), callback_data: "pu:0" }]]);
  const key = st === "ip" && s.pq.mode === "bypass" ? "p_ip_by" : "p_" + st;
  const required = ["user", "pass", "gw", "wpass"].includes(st) || (st === "ip" && s.pq.mode === "bypass");
  return send(env, chat, t(s, key), required ? null : skip);
}
async function presetInput(env, chat, s, st, text, msgId) {
  const v = (text || "").trim();
  if (["pass", "wpass", "root"].includes(st) && msgId) await tg(env, "deleteMessage", { chat_id: chat, message_id: msgId });
  if (["ip", "gw", "dns"].includes(st) && v && !ipOk(v)) return send(env, chat, t(s, "p_badip"));
  if (st === "wpass" && v.length < 8) return send(env, chat, t(s, "p_short"));
  if (!v && (["user", "pass", "gw", "wpass"].includes(st) || (st === "ip" && s.pq.mode === "bypass"))) return send(env, chat, t(s, "p_need"));
  s.pq[st] = v.slice(0, 64);
  return askStep(env, chat, s);
}
async function finishPreset(env, chat, s) {
  const p = s.pq;
  if (p.upg === "1" && s.code) p.upgUrl = `${env.PUBLIC_ORIGIN}/u/${s.code}`;
  s.preset = presetScript({ ...p, upg: p.upgUrl });
  s.asu = !!p.upgUrl;
  s.await = ""; delete s.pq;
  await send(env, chat, t(s, "p_done"));
  const [tx, rows] = menuView(s); return send(env, chat, tx, rows);
}

// ---------- actions ----------
async function codeLine(env, s, code) {
  const c = await checkCode(env, code, false);
  return c.ok ? (c.left === -1 ? t(s, "forever") : t(s, "left", c.left)) : t(s, "code_bad");
}
async function bindCode(env, chat, s, code) {
  code = code.toUpperCase();
  const c = await checkCode(env, code, false);
  if (!c.ok) return send(env, chat, t(s, "code_bad"));
  s.code = code;
  return send(env, chat, t(s, "code_bound", code, await codeLine(env, s, code)));
}
async function doBuild(env, api, chat, uid, s) {
  const pj = await api.upstreamJson(`/releases/${s.ver}/targets/${s.target}/profiles.json`);
  const prof = pj.profiles[s.profile] || {};
  const pk = new Set([...(pj.default_packages || []), ...(prof.device_packages || []), "luci"]);
  for (const g of GROUPS) for (const it of g.items) if (it.on) it.pkgs.forEach((x) => pk.add(x));
  for (const id of s.picks || []) { const [gi, ii] = id.split(".").map(Number); const it = GROUPS[gi].items[ii]; if (it && !(await itemState(env, s, it))) it.pkgs.forEach((x) => pk.add(x)); }
  if (s.asu) ASU_PKGS.forEach((x) => pk.add(x));
  const body = { version: s.ver, target: s.target, profile: s.profile, packages: [...pk], diff_packages: true, defaults: s.preset || "", k9: s.k9 || [] };
  const req = new Request(`${env.PUBLIC_ORIGIN}/api/v1/build`, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", "cf-connecting-ip": `tg${uid}`, "x-lukewrt-code": s.code || "" } });
  const r = await api.build(req, env, "");
  const j = await r.json().catch(() => ({}));
  if (r.status === 402) return send(env, chat, t(s, "need_pay"), [[{ text: t(s, "b_p1"), callback_data: "pay:single" }, { text: t(s, "b_p2"), callback_data: "pay:forever" }]]);
  if (r.status === 429 || r.status === 400) return send(env, chat, t(s, "err", j.detail || r.status));
  const hash = j.request_hash;
  if (!hash) return send(env, chat, t(s, "err", j.detail || r.status));
  const wk = `tgw:${hash}`, w = JSON.parse((await env.JOBS.get(wk)) || "[]");
  if (!w.some((x) => x.c === chat)) w.push({ c: chat, l: s.lang, n: `${s.title} ${s.ver}` });
  await env.JOBS.put(wk, JSON.stringify(w), { expirationTtl: 3 * 86400 });
  s.jobs = [{ h: hash, n: `${s.title} ${s.ver}`, t: Date.now() }, ...(s.jobs || []).filter((x) => x.h !== hash)].slice(0, 10);
  if (r.status === 200) return notifyOne(env, chat, s.lang, hash, `${s.title} ${s.ver}`, true, j);
  return send(env, chat, t(s, "submitted", `${s.title} ${s.ver}`, j.detail === "queued" ? t(s, "queued_n", j.queue_position || 0) : t(s, "running")), jobRows(s, hash, j));
}
function jobRows(s, hash, j) {
  const r = [[{ text: t(s, "b_refresh"), callback_data: `st:${hash}` }]];
  if (j && j.detail === "queued" && !j.priority) r[0].push({ text: t(s, "b_prio"), callback_data: `pr:${hash}` });
  return r;
}
function dlRows(res) {
  const imgs = (res.images || []).slice().sort((a, b) => {
    const sc = (i) => (/sysupgrade/.test(i.type) ? 0 : /factory/.test(i.type) ? 1 : /combined-efi/.test(i.type) ? (i.filesystem === "squashfs" ? 2 : 3) : 5);
    return sc(a) - sc(b);
  }).slice(0, 4);
  return imgs.map((i) => [{ text: `⬇️ ${i.type}${i.filesystem ? " " + i.filesystem : ""}`, url: `${PUBLIC}/store/${res.bin_dir || res.request_hash}/${i.name}` }]);
}
let PUBLIC = "https://fw.luke.us.eu.org";
async function notifyOne(env, chat, lang, hash, name, ok, res, detail) {
  const s = { lang };
  if (ok) return send(env, chat, t(s, "done", name), dlRows(res));
  return send(env, chat, t(s, "failed", name, (detail || "").slice(0, 300)));
}
// called by index.js when a build finishes
export async function tgNotify(env, hash, ok, detail) {
  try {
    PUBLIC = env.PUBLIC_ORIGIN || PUBLIC;
    const w = JSON.parse((await env.JOBS.get(`tgw:${hash}`)) || "[]");
    if (!w.length) return;
    const res = ok ? JSON.parse((await env.JOBS.get(`res:${hash}`)) || "{}") : null;
    for (const x of w) await notifyOne(env, x.c, x.l, hash, x.n, ok, res, detail);
    await env.JOBS.delete(`tgw:${hash}`);
  } catch {}
}
// called by index.js after a successful Alipay notify
export async function tgPaid(env, no) {
  try {
    const raw = await env.JOBS.get(`tgo:${no}`);
    if (!raw) return;
    const o = JSON.parse(raw), st = await orderStatus(env, no);
    if (!st.code) return;
    await env.JOBS.delete(`tgo:${no}`);
    const s = (await load(env, o.u)) || { lang: o.l };
    s.code = st.code; await save(env, o.u, s);
    await send(env, o.c, t(s, "pay_ok", st.code));
  } catch {}
}
async function statusText(env, api, s, hash) {
  const r = await api.statusResponse(env, hash);
  const j = await r.json().catch(() => ({}));
  return [r.status, j];
}

// ---------- update handler ----------
export async function tgHook(req, env, ctx, pathTok, api) {
  PUBLIC = env.PUBLIC_ORIGIN || PUBLIC;
  const secret = await env.JOBS.get("cfg:tg_secret");
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) return new Response("forbidden", { status: 403 });
  env._cbText = ""; env._dry = null;
  if (req.headers.get("x-tg-dry") === "1") env._dry = [];
  else if (pathTok && /^\d+:[A-Za-z0-9_-]{30,}$/.test(pathTok) && pathTok !== (await tgToken(env))) {
    env._tgtok = pathTok;
    const me = await tg(env, "getMe", {});
    if (me.ok) await env.JOBS.put("cfg:tg_token", pathTok); else env._tgtok = "";
  }
  const u = await req.json().catch(() => ({}));
  try { await handle(env, api, u); } catch (e) {
    const chat = (u.message || u.callback_query?.message || {}).chat?.id;
    if (chat) await send(env, chat, "⚠️ " + String(e && e.message).slice(0, 200));
  }
  return env._dry ? new Response(JSON.stringify(env._dry), { headers: { "content-type": "application/json" } }) : new Response("ok");
}

async function handle(env, api, u) {
  const m = u.message, cq = u.callback_query;
  const from = (m || cq || {}).from;
  if (!from || from.is_bot) return;
  const chat = m ? m.chat.id : cq.message.chat.id;
  if (m && m.chat.type !== "private") return;
  const uid = from.id;
  let s = await load(env, uid);
  const fresh = !s;
  if (!s) s = { lang: langOf(from.language_code) };
  const dirty = JSON.stringify(s);
  if (m) await onMessage(env, api, chat, uid, s, m, fresh);
  else {
    await onCallback(env, api, chat, uid, s, cq.data || "", cq.message.message_id);
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, ...(env._cbText ? { text: env._cbText, show_alert: true } : {}) });
  }
  if (JSON.stringify(s) !== dirty || fresh) await save(env, uid, s);
}

async function onMessage(env, api, chat, uid, s, m, fresh) {
  const text = (m.text || "").trim();
  const cmd = text.startsWith("/") ? text.split(/[\s@]/)[0].slice(1).toLowerCase() : "";
  if (cmd) s.await = "";
  if (cmd === "start" || cmd === "help") {
    const arg = text.split(/\s+/)[1] || "";
    if (fresh && !arg) return send(env, chat, t(s, "hello"), mainRows(s));
    return send(env, chat, t(s, "hello"), mainRows(s));
  }
  if (cmd === "build") { s.await = "model"; return send(env, chat, t(s, "ask_model")); }
  if (cmd === "code") return codeScreen(env, chat, s);
  if (cmd === "buy") return buyScreen(env, chat, s);
  if (cmd === "status") return statusScreen(env, api, chat, s);
  if (cmd === "feedback") { s.await = "fb"; return send(env, chat, t(s, "fb_ask")); }
  if (cmd === "language") return langScreen(env, chat, s);
  if (cmd) return send(env, chat, t(s, "hello"), mainRows(s));
  if (!text) return;
  if (s.await && s.await.startsWith("p:")) return presetInput(env, chat, s, s.await.slice(2), text, m.message_id);
  if (s.await === "fb") {
    s.await = "";
    const req = new Request(`${env.PUBLIC_ORIGIN}/api/feedback`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `tg${uid}`, "user-agent": "telegram-bot" },
      body: JSON.stringify({ content: text, model: s.title ? `${s.title} ${s.ver || ""}` : "", contact: `Telegram ${m.from.username ? "@" + m.from.username : ""} id ${uid}`, page: "telegram" }) });
    const r = await api.feedbackPost(req, env); const j = await r.json().catch(() => ({}));
    return send(env, chat, r.ok ? t(s, "fb_ok") : t(s, "fb_err", j.detail || r.status));
  }
  if (s.await === "k9") {
    s.await = "";
    if (/^(清空|clear|清除)$/i.test(text)) s.k9 = [];
    else s.k9 = [...new Set(text.split(/[\s,，]+/).filter((x) => /^[A-Za-z0-9._+\-]{2,80}$/.test(x)))].slice(0, 30);
    await send(env, chat, t(s, "k9_set", s.k9.join(" ") || t(s, "none")));
    const [tx, rows] = menuView(s); return send(env, chat, tx, rows);
  }
  const cm = text.toUpperCase().match(CODE_RE);
  if (cm) return bindCode(env, chat, s, cm[0]);
  // anything else: treat as a device search
  s.await = "";
  const res = await search(api, text);
  if (!res.length) return send(env, chat, t(s, "no_model", text.slice(0, 40)));
  const N = 10;
  s.res = res.slice(0, N).map((x) => ({ i: x.id, g: x.target, n: x.title.slice(0, 60), v: x.vers }));
  const rows = s.res.map((x, i) => [{ text: `${x.n} (${x.g})`, callback_data: `m:${i}` }]);
  return send(env, chat, t(s, "pick_model") + (res.length > N ? "\n" + t(s, "more", N) : ""), rows);
}

async function codeScreen(env, chat, s) {
  if (!s.code) return send(env, chat, t(s, "code_none"), [[{ text: t(s, "b_p1"), callback_data: "pay:single" }, { text: t(s, "b_p2"), callback_data: "pay:forever" }]]);
  return send(env, chat, t(s, "code_info", s.code, await codeLine(env, s, s.code)), [[{ text: t(s, "b_unbind"), callback_data: "unbind" }]]);
}
const buyScreen = (env, chat, s) => send(env, chat, t(s, "buy_ask"), [[{ text: t(s, "b_p1"), callback_data: "pay:single" }, { text: t(s, "b_p2"), callback_data: "pay:forever" }]]);
const langScreen = (env, chat, s) => send(env, chat, t(s, "lang_pick"), [[{ text: "简体中文", callback_data: "l:zh" }, { text: "繁體中文", callback_data: "l:tw" }, { text: "English", callback_data: "l:en" }]]);
async function statusScreen(env, api, chat, s) {
  if (!(s.jobs || []).length) return send(env, chat, t(s, "no_jobs"));
  const lines = [t(s, "jobs")], rows = [];
  for (const j of s.jobs.slice(0, 5)) {
    const [code, r] = await statusText(env, api, s, j.h);
    const st = code === 200 ? "st_done" : code === 202 ? (r.detail === "queued" ? "st_queued" : "st_building") : "st_failed";
    lines.push(`${t(s, st)} ${j.n}${code === 202 && r.queue_position ? " · " + t(s, "queued_n", r.queue_position) : ""}`);
    if (code === 200) rows.push(...dlRows(r).slice(0, 1).map((x) => [{ ...x[0], text: `⬇️ ${j.n}`.slice(0, 60) }]));
  }
  return send(env, chat, lines.join("\n"), rows.length ? rows : null);
}

async function onCallback(env, api, chat, uid, s, d, mid) {
  const [a, b, c] = d.split(":");
  if (a === "build") { s.await = "model"; return send(env, chat, t(s, "ask_model")); }
  if (a === "code") return codeScreen(env, chat, s);
  if (a === "buy") return buyScreen(env, chat, s);
  if (a === "status") return statusScreen(env, api, chat, s);
  if (a === "fb") { s.await = "fb"; return send(env, chat, t(s, "fb_ask")); }
  if (a === "lang") return langScreen(env, chat, s);
  if (a === "l") { s.lang = ["zh", "tw", "en"].includes(b) ? b : "zh"; return edit(env, chat, mid, t(s, "lang_ok"), mainRows(s)); }
  if (a === "unbind") { delete s.code; return edit(env, chat, mid, t(s, "unbound")); }
  if (a === "m") {
    const x = (s.res || [])[+b];
    if (!x) return send(env, chat, t(s, "gone"));
    Object.assign(s, { profile: x.i, target: x.g, title: x.n, vers: x.v, picks: [], k9: [], preset: "", asu: false });
    s.flash = await flashLimit(env, x.g, x.i);
    return edit(env, chat, mid, t(s, "pick_ver", x.n) + "\n" + t(s, "ver_note"), verRows(s));
  }
  if (a === "vers") { if (!s.vers) return send(env, chat, t(s, "gone")); return send(env, chat, t(s, "pick_ver", s.title) + "\n" + t(s, "ver_note"), verRows(s)); }
  if (a === "v") {
    if (!s.profile) return send(env, chat, t(s, "gone"));
    s.ver = d.slice(2);
    s.feed = [];
    if (+s.ver.split(".")[0] >= 25) {
      try { const pj = await api.upstreamJson(`/releases/${s.ver}/targets/${s.target}/profiles.json`); s.feed = [...(await ownFeed(env, s.ver, pj.arch_packages))].filter((n) => FREE_K9.includes(n)); } catch {}
      s.k9 = [];
    }
    const [tx, rows] = menuView(s); return edit(env, chat, mid, tx, rows);
  }
  if (!s.ver && ["menu", "g", "p", "go", "pre", "k9"].includes(a)) return send(env, chat, t(s, "gone"));
  if (a === "menu") { const [tx, rows] = menuView(s); return edit(env, chat, mid, tx, rows); }
  if (a === "g") { const [tx, rows] = await groupView(env, s, +b); return edit(env, chat, mid, tx, rows); }
  if (a === "p") {
    const id = `${b}.${c}`, it = (GROUPS[+b] || {}).items?.[+c];
    if (!it) return;
    s.picks = s.picks || [];
    if (s.picks.includes(id)) s.picks = s.picks.filter((x) => x !== id);
    else {
      const bad = await itemState(env, s, it);
      if (bad) { env._cbText = bad; return; }
      s.picks.push(id);
    }
    const [tx, rows] = await groupView(env, s, +b); return edit(env, chat, mid, tx, rows);
  }
  if (a === "k9") {
    if (+s.ver.split(".")[0] >= 25) return send(env, chat, t(s, "k9_25"));
    s.await = "k9"; return send(env, chat, t(s, "k9_ask"));
  }
  if (a === "pre") {
    if (s.preset) return send(env, chat, t(s, "on"), [[{ text: t(s, "b_preset"), callback_data: "pre2" }, { text: t(s, "b_clear"), callback_data: "prc" }]]);
    s.pq = {}; return askStep(env, chat, s);
  }
  if (a === "pre2") { s.pq = {}; return askStep(env, chat, s); }
  if (a === "prc") { s.preset = ""; s.asu = false; await send(env, chat, t(s, "p_cleared")); const [tx, rows] = menuView(s); return send(env, chat, tx, rows); }
  if (["pm", "pw", "pu", "ps"].includes(a)) {
    if (!s.pq) return send(env, chat, t(s, "gone"));
    if (a === "pm") { s.pq.mode = b; s.pq.upgAsk = !!(s.code && (await checkCode(env, s.code, false)).left === -1); }
    if (a === "pw") s.pq.wan = b;
    if (a === "pu") s.pq.upg = b;
    if (a === "ps") { const st = nextStep(s.pq); if (["user", "pass", "gw", "wpass"].includes(st) || (st === "ip" && s.pq.mode === "bypass")) return; if (st) s.pq[st] = ""; }
    return askStep(env, chat, s);
  }
  if (a === "go") return doBuild(env, api, chat, uid, s);
  if (a === "st") {
    const [code, r] = await statusText(env, api, s, b);
    const j = (s.jobs || []).find((x) => x.h === b) || { n: "" };
    if (code === 200) return notifyOne(env, chat, s.lang, b, j.n, true, r);
    if (code !== 202) return notifyOne(env, chat, s.lang, b, j.n, false, null, r.detail);
    return edit(env, chat, mid, t(s, "submitted", j.n, r.detail === "queued" ? t(s, "queued_n", r.queue_position || 0) : t(s, "running")), jobRows(s, b, r));
  }
  if (a === "pr") {
    const r = await api.priority(b, s.code || "");
    if (r.need_pay) return send(env, chat, t(s, "need_pay"), [[{ text: t(s, "b_p1"), callback_data: "pay:single" }, { text: t(s, "b_p2"), callback_data: "pay:forever" }]]);
    if (r.state !== "queued") return send(env, chat, t(s, "prio_gone"));
    return send(env, chat, t(s, "prio_ok", r.ahead || 0));
  }
  if (a === "pay") {
    if (!PLANS[b]) return;
    const o = await createOrder(env, b);
    if (o.error) return send(env, chat, t(s, "pay_err", o.error));
    await env.JOBS.put(`tgo:${o.order}`, JSON.stringify({ c: chat, u: uid, l: s.lang }), { expirationTtl: 86400 });
    const rows = [[{ text: t(s, "b_alipay"), url: o.qr }], [{ text: t(s, "b_paid"), callback_data: `ck:${o.order}` }]];
    const cap = t(s, "pay_msg", o.amount, o.order);
    const ph = await tg(env, "sendPhoto", { chat_id: chat, photo: `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=12&data=${encodeURIComponent(o.qr)}`, caption: cap, reply_markup: kb(rows) });
    if (!ph.ok) return send(env, chat, cap, rows);
    return;
  }
  if (a === "ck") {
    const st = await orderStatus(env, b);
    if (!st.code) return send(env, chat, t(s, "pay_wait"));
    await env.JOBS.delete(`tgo:${b}`);
    s.code = st.code;
    return send(env, chat, t(s, "pay_ok", st.code));
  }
}

// Token delivery: the sandbox proxy injects the bot token as x-tg-token; accept only the real @OpenWrtDIYBot token.
const BOT_ID = 9046403397;
export async function tgSetToken(req, env) {
  const tok = (req.headers.get("x-tg-token") || "").trim();
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(tok) || !tok.startsWith(BOT_ID + ":")) return new Response(JSON.stringify({ ok: false }), { status: 401 });
  const r = await fetch(`https://api.telegram.org/bot${tok}/getMe`).then((x) => x.json()).catch(() => ({}));
  if (!r.ok || r.result.id !== BOT_ID) return new Response(JSON.stringify({ ok: false }), { status: 401 });
  if ((await env.JOBS.get("cfg:tg_token")) !== tok) await env.JOBS.put("cfg:tg_token", tok);
  return new Response(JSON.stringify({ ok: true, bot: r.result.username }), { headers: { "content-type": "application/json" } });
}
