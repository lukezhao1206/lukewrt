import { EmailMessage } from "cloudflare:email";
// LukeWrt Worker: serves the firmware selector, an ASU-compatible build API,
// and built images from R2. Builds run on GitHub Actions.
import { BuildQueue, dispatch, MAX_RUNNING } from "./queue.js";
export { BuildQueue };
import { createOrder, orderStatus, handleNotify, checkCode, selfTest, PLANS } from "./pay.js";
const DL = "https://downloads.openwrt.org";
const JSONH = { "content-type": "application/json; charset=utf-8" };
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "*",
};
const QUEUE_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_BUILDS_PER_HOUR = 6;

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { ...JSONH, ...CORS, ...extra } });
}

async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function authed(req, env) {
  return req.headers.get("authorization") === `Bearer ${env.UPLOAD_SECRET}`;
}

const MIME = {
  html: "text/html; charset=utf-8", js: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json; charset=utf-8",
  svg: "image/svg+xml", ico: "image/x-icon", png: "image/png", txt: "text/plain; charset=utf-8", xml: "application/xml; charset=utf-8",
};

async function serveR2(env, key, req, opts = {}) {
  const obj = await env.BUCKET.get(key, { range: req.headers, onlyIf: req.headers });
  if (!obj) return null;
  const h = new Headers(CORS);
  obj.writeHttpMetadata(h);
  h.set("etag", obj.httpEtag);
  const ext = key.split(".").pop().toLowerCase();
  if (!h.get("content-type")) h.set("content-type", MIME[ext] || "application/octet-stream");
  if (opts.download) h.set("content-disposition", `attachment; filename="${key.split("/").pop()}"`);
  h.set("cache-control", opts.cache || "public, max-age=300");
  if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers: h });
  let status = 200;
  if (obj.range && req.headers.get("range")) {
    status = 206;
    const off = obj.range.offset ?? 0;
    const len = obj.range.length ?? obj.size - off;
    h.set("content-range", `bytes ${off}-${off + len - 1}/${obj.size}`);
  }
  return new Response(obj.body, { status, headers: h });
}

async function proxyDownloads(path, req, ctx) {
  const url = DL + path;
  const cache = caches.default;
  const ck = new Request(url);
  let res = await cache.match(ck);
  if (!res) {
    const up = await fetch(url, { cf: { cacheTtl: 600 } });
    res = new Response(up.body, up);
    res.headers.set("cache-control", path.endsWith(".json") ? "public, max-age=600" : "public, max-age=86400");
    if (up.ok) ctx.waitUntil(cache.put(ck, res.clone()));
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

function validate(b) {
  const re = /^[A-Za-z0-9._+\-\/,]+$/;
  if (!b || typeof b !== "object") return "invalid request";
  for (const k of ["version", "target", "profile"]) {
    if (typeof b[k] !== "string" || !b[k] || b[k].length > 100 || !re.test(b[k])) return `bad ${k}`;
  }
  if (!/^[a-z0-9]+\/[a-z0-9_\-]+$/.test(b.target)) return "bad target";
  if (!/^\d+\.\d+\.\d+(-rc\d+)?$/.test(b.version)) return "only stable releases are supported";
  const pk = b.packages || [];
  if (!Array.isArray(pk) || pk.length > 300) return "bad packages";
  for (const p of pk) if (typeof p !== "string" || !/^-?[A-Za-z0-9._+\-]+$/.test(p) || p.length > 100) return `bad package ${p}`;
  const k9 = b.k9 || [];
  if (!Array.isArray(k9) || k9.length > 100) return "bad k9";
  for (const p of k9) if (typeof p !== "string" || !/^[A-Za-z0-9._+\-]+$/.test(p) || p.length > 100) return `bad package ${p}`;
  if (b.defaults && (typeof b.defaults !== "string" || b.defaults.length > 20480)) return "uci-defaults too long";
  return null;
}

async function statusResponse(env, hash) {
  const raw = await env.JOBS.get(`job:${hash}`);
  if (!raw) return json({ detail: "not found" }, 404);
  const job = JSON.parse(raw);
  if (job.status === "done") {
    const res = await env.JOBS.get(`res:${hash}`);
    return new Response(res, { status: 200, headers: { ...JSONH, ...CORS } });
  }
  if (job.status === "failed") {
    return json({ detail: job.detail || "build failed", stdout: job.stdout || "", stderr: job.stderr || "", request_hash: hash }, 500);
  }
  if (job.status === "queued") {
    const pos = await queue(env).position(hash);
    if (pos.state === "queued") return json({ request_hash: hash, imagebuilder_status: "init", detail: "queued", queue_position: pos.ahead > 0 ? pos.ahead : undefined, priority: !!pos.priority }, 202);
  }
  if (Date.now() - job.created > QUEUE_TIMEOUT_MS) {
    try { await queue(env).finish(hash); } catch {}
    job.status = "failed"; job.detail = "build timed out";
    await env.JOBS.put(`job:${hash}`, JSON.stringify(job), { expirationTtl: 86400 });
    return json({ detail: job.detail, request_hash: hash }, 500);
  }
  return json({ request_hash: hash, imagebuilder_status: job.ib_status || "init", detail: job.status, queue_position: job.queue_position }, 202);
}

const queue = (env) => env.QUEUE.get(env.QUEUE.idFromName("main"));

async function upstreamJson(path) {
  const r = await fetch(DL + path, { cf: { cacheTtl: 600, cacheEverything: true } });
  if (!r.ok) throw new Error(`upstream ${r.status} ${path}`);
  return r.json();
}

// Router clients send board_name (e.g. "xiaomi,mi-router-4a-gigabit"); map to an ImageBuilder profile.
async function normalizeProfile(version, target, profile) {
  if (/^(x86|armsr|armvirt|loongarch)\//.test(target)) return "generic";
  if (!profile.includes(",")) return profile;
  const pj = await upstreamJson(`/releases/${version}/targets/${target}/profiles.json`);
  if (pj.profiles[profile]) return profile;
  const u = profile.replace(/,/g, "_");
  if (pj.profiles[u]) return u;
  for (const [id, p] of Object.entries(pj.profiles)) if ((p.supported_devices || []).includes(profile)) return id;
  return profile;
}

async function overview() {
  const v = await upstreamJson("/.versions.json");
  const list = (v.versions_list || []).filter((x) => /^\d+\.\d+\.\d+$/.test(x));
  const branches = {};
  for (const x of list) {
    const b = x.split(".").slice(0, 2).join(".");
    const cmp = (a, c) => a.split(".").map(Number).reduce((r, n, i) => r || n - c.split(".").map(Number)[i], 0);
    if (!branches[b] || cmp(x, branches[b].latest) > 0) branches[b] = { name: b, latest: x };
  }
  const out = {};
  for (const [b, o] of Object.entries(branches)) out[b] = { name: b, enabled: true, versions: list.filter((x) => x.startsWith(b + ".")), package_changes: [] };
  return { server: { name: "lukewrt" }, latest: Object.values(branches).map((o) => o.latest), branches: out };
}

async function build(req, env, viaCode = "") {
  let b;
  try { b = await req.json(); } catch { return json({ detail: "invalid json" }, 400); }
  const err = validate(b);
  if (err) return json({ detail: err }, 400);
  if (viaCode) {
    const c = await checkCode(env, viaCode, false);
    if (c.left !== -1) return json({ detail: "在线一键升级是永久版功能，请到 fw.luke.us.eu.org 升级永久版" }, 402);
    b.profile = await normalizeProfile(b.version, b.target, b.profile);
  }
  const clean = {
    version: b.version, target: b.target, profile: b.profile,
    packages: [...new Set(b.packages || [])].sort(),
    defaults: b.defaults || "", diff_packages: !!b.diff_packages,
  };
  // free proxy plugins that only exist in the plugin library: route them there without charging
  const FREE_K9 = ["luci-app-ssr-plus", "luci-app-homeproxy", "luci-app-fchomo", "luci-app-bypass"];
  if (parseInt(b.version, 10) < 25) {
    const mv = clean.packages.filter((p) => FREE_K9.includes(p));
    if (mv.length) { clean.packages = clean.packages.filter((p) => !mv.includes(p)); b.k9 = [...(b.k9 || []), ...mv]; }
  }
  const k9 = [...new Set(b.k9 || [])].sort();
  if (k9.length) clean.k9 = k9;
  if (viaCode) { clean.auto_k9 = true; if (b.rootfs_size_mb) clean.rootfs_size_mb = Math.min(4096, parseInt(b.rootfs_size_mb, 10) || 0) || undefined; }
  const hash = (await sha256(JSON.stringify(clean))).slice(0, 32);
  const existing = await env.JOBS.get(`job:${hash}`);
  if (existing) {
    const j = JSON.parse(existing);
    if (j.status !== "failed") return statusResponse(env, hash);
  }
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const code = viaCode || (req.headers.get("x-lukewrt-code") || "").trim().toUpperCase();
  const rk = `rate:${ip}:${Math.floor(Date.now() / 3600000)}`;
  const n = parseInt((await env.JOBS.get(rk)) || "0", 10);
  if (n >= MAX_BUILDS_PER_HOUR && !(code && (await checkCode(env, code, false)).left === -1))
    return json({ detail: "这个小时编译次数用完了（每小时 6 次），一小时后再试；永久版不限" }, 429);
  const premium = !!(clean.defaults && clean.defaults.trim()) || (clean.k9 || []).some((p) => !FREE_K9.includes(p)) || !!viaCode;
  let paid = false;
  if (premium && !(existing && JSON.parse(existing).paid)) {
    const c = await checkCode(env, code, true);
    if (!c.ok) return json({ detail: code ? "激活码无效或次数已用完，高级功能需购买" : "预置设置、首次启动脚本、插件大库是高级功能：单次 3 元或永久 88 元", need_pay: true }, 402);
    paid = true;
  }
  await env.JOBS.put(rk, String(n + 1), { expirationTtl: 3700 });
  await env.JOBS.put(`req:${hash}`, JSON.stringify(clean), { expirationTtl: 7 * 86400 });
  await env.JOBS.put(`job:${hash}`, JSON.stringify({ status: "queued", created: Date.now(), paid: paid || !!(existing && JSON.parse(existing).paid) }), { expirationTtl: 30 * 86400 });
  const forever = code ? (await checkCode(env, code, false)).left === -1 : false;
  const pos = await queue(env).enqueue(hash, paid || forever);
  return json({ request_hash: hash, imagebuilder_status: "init", detail: "queued", queue_position: pos.ahead > 0 ? pos.ahead : undefined, priority: !!pos.priority }, 202);
}

async function internal(req, env, path, url) {
  if (!authed(req, env)) return json({ detail: "unauthorized" }, 401);
  let m;
  if ((m = path.match(/^\/internal\/job\/([0-9a-f]{32})$/))) {
    const r = await env.JOBS.get(`req:${m[1]}`);
    return r ? new Response(r, { headers: JSONH }) : json({ detail: "not found" }, 404);
  }
  if ((m = path.match(/^\/internal\/status\/([0-9a-f]{32})$/)) && req.method === "POST") {
    const upd = await req.json();
    const job = JSON.parse((await env.JOBS.get(`job:${m[1]}`)) || '{"created":0}');
    Object.assign(job, upd);
    if (!job.created) job.created = Date.now();
    if (upd.status === "building") job.created = Date.now();
    await env.JOBS.put(`job:${m[1]}`, JSON.stringify(job), { expirationTtl: 30 * 86400 });
    if (upd.status === "failed") await queue(env).finish(m[1]);
    return json({ ok: true });
  }
  if ((m = path.match(/^\/internal\/done\/([0-9a-f]{32})$/)) && req.method === "POST") {
    const res = await req.text();
    await env.JOBS.put(`res:${m[1]}`, res, { expirationTtl: 30 * 86400 });
    await env.JOBS.put(`job:${m[1]}`, JSON.stringify({ status: "done", created: Date.now() }), { expirationTtl: 30 * 86400 });
    await queue(env).finish(m[1]);
    return json({ ok: true });
  }
  if (path === "/internal/setkey" && req.method === "POST") {
    const k = (req.headers.get("x-alipay-key") || "").trim();
    if (k.length < 500) return json({ detail: "no key" }, 400);
    await env.JOBS.put("cfg:alipay_priv", k);
    try { return json({ ok: await selfTest(env) }); } catch (e) { return json({ ok: false, error: String(e.message) }); }
  }
  const key = url.searchParams.get("key") || "";
  if (!/^(store|site|packages)\/[A-Za-z0-9._+~\-\/]+$/.test(key) || key.includes("..")) return json({ detail: "bad key" }, 400);
  if (path === "/internal/put" && req.method === "PUT") {
    await env.BUCKET.put(key, req.body, { httpMetadata: { contentType: req.headers.get("content-type") || undefined } });
    return json({ ok: true });
  }
  if (path === "/internal/mpu/create" && req.method === "POST") {
    const u = await env.BUCKET.createMultipartUpload(key);
    return json({ uploadId: u.uploadId });
  }
  if (path === "/internal/mpu/part" && req.method === "PUT") {
    const u = env.BUCKET.resumeMultipartUpload(key, url.searchParams.get("uploadId"));
    const p = await u.uploadPart(parseInt(url.searchParams.get("partNumber"), 10), req.body);
    return json(p);
  }
  if (path === "/internal/mpu/complete" && req.method === "POST") {
    const u = env.BUCKET.resumeMultipartUpload(key, url.searchParams.get("uploadId"));
    const parts = await req.json();
    await u.complete(parts);
    return json({ ok: true });
  }
  return json({ detail: "not found" }, 404);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    let viaCode = "";
    let m;
    if ((m = path.match(/^\/u\/(LW-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4})(\/.*)$/))) { viaCode = m[1].toUpperCase(); path = m[2]; }
    try {
      if (path.startsWith("/internal/")) return await internal(req, env, path, url);
      if (path === "/api/v1/build" && req.method === "POST") return await build(req, env, viaCode);
      if (path === "/api/v1/overview") return json(await overview(), 200, { "cache-control": "public, max-age=600" });
      if ((m = path.match(/^\/api\/v1\/revision\/([0-9.a-zA-Z\-]+)\/([a-z0-9]+\/[a-z0-9_\-]+)$/))) {
        const pj = await upstreamJson(`/releases/${m[1]}/targets/${m[2]}/profiles.json`);
        return json({ revision: pj.version_code });
      }
      if ((m = path.match(/^\/api\/v1\/build\/([0-9a-f]{32})$/))) return await statusResponse(env, m[1]);
      if (path === "/api/pay/plans") return json({ plans: Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, v.amount])) });
      if (path === "/api/pay/create" && req.method === "POST") {
        let b = {}; try { b = await req.json(); } catch {}
        const ip = req.headers.get("cf-connecting-ip") || "unknown";
        const ok = `ordrate:${ip}:${Math.floor(Date.now() / 3600000)}`;
        const on = parseInt((await env.JOBS.get(ok)) || "0", 10);
        if (on >= 20) return json({ detail: "too many orders" }, 429);
        await env.JOBS.put(ok, String(on + 1), { expirationTtl: 3700 });
        const r = await createOrder(env, b.plan);
        return json(r, r.error ? 502 : 200);
      }
      if ((m = path.match(/^\/api\/pay\/status\/(LW\d+[A-Z0-9]{4})$/))) return json(await orderStatus(env, m[1]));
      if ((m = path.match(/^\/api\/pay\/code\/([A-Za-z0-9\-]{1,40})$/))) return json(await checkCode(env, m[1].toUpperCase(), false));
      if (path === "/api/pay/notify" && req.method === "POST") {
        const params = Object.fromEntries(new URLSearchParams(await req.text()));
        const ok2 = await handleNotify(env, params);
        return new Response(ok2 ? "success" : "fail", { headers: { "content-type": "text/plain" } });
      }
      if ((m = path.match(/^\/api\/v1\/priority\/([0-9a-f]{32})$/)) && req.method === "POST") {
        const code = (req.headers.get("x-lukewrt-code") || "").trim().toUpperCase();
        const cur = await queue(env).position(m[1]);
        if (cur.state !== "queued") return json(cur);
        if (cur.priority) return json(cur);
        const c = await checkCode(env, code, true);
        if (!c.ok) return json({ detail: "需要激活码", need_pay: true }, 402);
        return json(await queue(env).promote(m[1]));
      }
      if (path === "/api/feedback" && req.method === "POST") return await feedbackPost(req, env);
      if (path === "/api/feedback/list") return await feedbackList(req, env, url);
      if (path === "/api/dlstats") return await dlStats(req, env);
      if (path === "/api/v1/queue") return json(await queue(env).stats());
      if (path === "/api/v1/stats") return json({ server: "lukewrt" });
      if (path.startsWith("/dl/")) return await proxyDownloads(path.slice(3), req, ctx);
      if ((m = path.match(/^\/k9\/(packages-\d+\.\d+\/[a-z0-9_]+\/kiddin9\/Packages)$/))) {
        const ck = new Request("https://dl.openwrt.ai/" + m[1]);
        let res = await caches.default.match(ck);
        if (!res) {
          const up = await fetch(ck.url, { cf: { cacheTtl: 3600 } });
          if (!up.ok) return json({ detail: "not found" }, 404);
          res = new Response(up.body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
          ctx.waitUntil(caches.default.put(ck, res.clone()));
        }
        const out = new Response(res.body, res);
        for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
        return out;
      }
      if (path.startsWith("/store/")) {
        if (path.includes("..")) return json({ detail: "bad path" }, 400);
        const r = await serveR2(env, path.slice(1), req, { download: !path.endsWith(".json"), cache: "public, max-age=86400" });
        if (r && req.method === "GET" && !path.endsWith(".json") && (r.status === 200 || r.status === 206)) {
          const rg = req.headers.get("range") || "";
          if (!rg || /^bytes=0-/.test(rg)) ctx.waitUntil(logDownload(env, req, path));
        }
        return r || json({ detail: "not found" }, 404);
      }
      if (path.startsWith("/packages/")) {
        if (path.includes("..")) return json({ detail: "bad path" }, 400);
        const r = await serveR2(env, path.slice(1), req, { download: true, cache: "public, max-age=3600" });
        return r || json({ detail: "not found" }, 404);
      }
      if (path === "/" || path === "") path = "/index.html";
      if (path.includes("..")) return new Response("bad path", { status: 400 });
      const r = await serveR2(env, "site" + path, req, { cache: "no-cache" });
      return r || new Response("Not found", { status: 404 });
    } catch (e) {
      return json({ detail: "server error", error: String(e && e.message) }, 500);
    }
  },
};

// ---- 意见反馈：存 KV fb:<倒序时间>，站长凭站长码在 /fb.html 查看 ----
async function feedbackPost(req, env) {
  let b = {}; try { b = await req.json(); } catch {}
  const content = String(b.content || "").trim().slice(0, 2000);
  if (content.length < 2) return json({ detail: "内容不能为空" }, 400);
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const rk = `fbrate:${ip}:${Math.floor(Date.now() / 3600000)}`;
  const n = parseInt((await env.JOBS.get(rk)) || "0", 10);
  if (n >= 5) return json({ detail: "提交太频繁，请一小时后再试" }, 429);
  await env.JOBS.put(rk, String(n + 1), { expirationTtl: 3700 });
  const now = Date.now();
  const id = `${String(9999999999999 - now).padStart(13, "0")}-${Math.random().toString(36).slice(2, 6)}`;
  const rec = { t: now, content, model: String(b.model || "").slice(0, 120), contact: String(b.contact || "").slice(0, 120),
    page: String(b.page || "").slice(0, 300), ip, country: req.headers.get("cf-ipcountry") || "", ua: (req.headers.get("user-agent") || "").slice(0, 200) };
  await env.JOBS.put(`fb:${id}`, JSON.stringify(rec), { expirationTtl: 365 * 86400 });
  let mail = "sent";
  try { await mailFeedback(env, rec); } catch (e) { mail = "fail"; console.log("mail fail", e && e.message); }
  return json({ ok: true, mail });
}

async function feedbackList(req, env, url) {
  const code = (req.headers.get("x-lukewrt-code") || "").trim().toUpperCase();
  const owner = ((await env.JOBS.get("cfg:owner_code")) || "").trim().toUpperCase();
  if (!owner || code !== owner) return json({ detail: "需要站长码" }, 403);
  const l = await env.JOBS.list({ prefix: "fb:", limit: 100 });
  const items = await Promise.all(l.keys.map(async (k) => ({ id: k.name.slice(3), ...JSON.parse((await env.JOBS.get(k.name)) || "{}") })));
  return json({ items });
}

function b64utf8(str) { const b = new TextEncoder().encode(str); let bin = ""; for (const x of b) bin += String.fromCharCode(x); return btoa(bin); }
async function mailFeedback(env, r) {
  if (!env.MAIL) return;
  const from = env.MAIL_FROM || "lukewrt@lukezhao.top", to = env.MAIL_TO || "zhaolu1206@gmail.com";
  const when = new Date(r.t).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const body = `${r.content}\n\n机型/版本：${r.model || "-"}\n联系方式：${r.contact || "-"}\n时间：${when}（北京）\n来源：${r.country} ${r.ip}\n\n全部反馈：${env.PUBLIC_ORIGIN || ""}/fb.html`;
  const subj = `LukeWrt 新反馈：${r.content.replace(/\s+/g, " ").slice(0, 30)}`;
  const raw = [`From: LukeWrt <${from}>`, `To: ${to}`, `Subject: =?UTF-8?B?${b64utf8(subj)}?=`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@lukezhao.top>`, `Date: ${new Date(r.t).toUTCString()}`,
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
    b64utf8(body).replace(/.{76}/g, "$&\r\n")].join("\r\n");
  await env.MAIL.send(new EmailMessage(from, to, raw));
}

async function logDownload(env, req, path) {
  try {
    const t = Date.now(), f = path.split("/").pop();
    const ip = req.headers.get("cf-connecting-ip") || "";
    const dk = `dldup:${ip}:${f}:${Math.floor(t / 600000)}`;
    if (await env.JOBS.get(dk)) return;
    await env.JOBS.put(dk, "1", { expirationTtl: 900 });
    const id = String(9e15 - t).padStart(16, "0") + Math.random().toString(36).slice(2, 6);
    await env.JOBS.put(`dlog:${id}`, "", { expirationTtl: 400 * 86400, metadata: { t, f: f.slice(0, 200), c: req.headers.get("cf-ipcountry") || "" } });
  } catch {}
}
async function dlStats(req, env) {
  const code = (req.headers.get("x-lukewrt-code") || "").trim().toUpperCase();
  const owner = ((await env.JOBS.get("cfg:owner_code")) || "").trim().toUpperCase();
  if (!owner || code !== owner) return json({ detail: "需要站长码" }, 403);
  const items = []; let cursor;
  do {
    const l = await env.JOBS.list({ prefix: "dlog:", limit: 1000, cursor });
    for (const k of l.keys) if (k.metadata) items.push(k.metadata);
    cursor = l.list_complete ? null : l.cursor;
  } while (cursor && items.length < 20000);
  return json({ items });
}
