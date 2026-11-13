// LukeWrt Worker: serves the firmware selector, an ASU-compatible build API,
// and built images from R2. Builds run on GitHub Actions.
const DL = "https://downloads.openwrt.org";
const JSONH = { "content-type": "application/json; charset=utf-8" };
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
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
  svg: "image/svg+xml", ico: "image/x-icon", png: "image/png", txt: "text/plain; charset=utf-8",
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
  if (Date.now() - job.created > QUEUE_TIMEOUT_MS) {
    job.status = "failed"; job.detail = "build timed out";
    await env.JOBS.put(`job:${hash}`, JSON.stringify(job), { expirationTtl: 86400 });
    return json({ detail: job.detail, request_hash: hash }, 500);
  }
  return json({ request_hash: hash, imagebuilder_status: job.ib_status || "init", detail: job.status, queue_position: job.queue_position }, 202);
}

async function dispatch(env, hash) {
  const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/build.yml/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GH_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "lukewrt-worker",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main", inputs: { hash } }),
  });
  if (!r.ok) throw new Error(`dispatch failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function build(req, env) {
  let b;
  try { b = await req.json(); } catch { return json({ detail: "invalid json" }, 400); }
  const err = validate(b);
  if (err) return json({ detail: err }, 400);
  const clean = {
    version: b.version, target: b.target, profile: b.profile,
    packages: [...new Set(b.packages || [])].sort(),
    defaults: b.defaults || "", diff_packages: !!b.diff_packages,
  };
  const hash = (await sha256(JSON.stringify(clean))).slice(0, 32);
  const existing = await env.JOBS.get(`job:${hash}`);
  if (existing) {
    const j = JSON.parse(existing);
    if (j.status !== "failed") return statusResponse(env, hash);
  }
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const rk = `rate:${ip}:${Math.floor(Date.now() / 3600000)}`;
  const n = parseInt((await env.JOBS.get(rk)) || "0", 10);
  if (n >= MAX_BUILDS_PER_HOUR) return json({ detail: "too many builds, try again in an hour" }, 429);
  await env.JOBS.put(rk, String(n + 1), { expirationTtl: 3700 });
  await env.JOBS.put(`req:${hash}`, JSON.stringify(clean), { expirationTtl: 7 * 86400 });
  await env.JOBS.put(`job:${hash}`, JSON.stringify({ status: "queued", created: Date.now() }), { expirationTtl: 30 * 86400 });
  try { await dispatch(env, hash); } catch (e) {
    await env.JOBS.put(`job:${hash}`, JSON.stringify({ status: "failed", created: Date.now(), detail: "could not start build" }), { expirationTtl: 3600 });
    return json({ detail: "could not start build", error: String(e.message) }, 500);
  }
  return json({ request_hash: hash, imagebuilder_status: "init", detail: "queued" }, 202);
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
    return json({ ok: true });
  }
  if ((m = path.match(/^\/internal\/done\/([0-9a-f]{32})$/)) && req.method === "POST") {
    const res = await req.text();
    await env.JOBS.put(`res:${m[1]}`, res, { expirationTtl: 30 * 86400 });
    await env.JOBS.put(`job:${m[1]}`, JSON.stringify({ status: "done", created: Date.now() }), { expirationTtl: 30 * 86400 });
    return json({ ok: true });
  }
  const key = url.searchParams.get("key") || "";
  if (!/^(store|site|packages)\/[A-Za-z0-9._+\-\/]+$/.test(key) || key.includes("..")) return json({ detail: "bad key" }, 400);
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
    try {
      if (path.startsWith("/internal/")) return await internal(req, env, path, url);
      if (path === "/api/v1/build" && req.method === "POST") return await build(req, env);
      let m;
      if ((m = path.match(/^\/api\/v1\/build\/([0-9a-f]{32})$/))) return await statusResponse(env, m[1]);
      if (path === "/api/v1/overview" || path === "/api/v1/stats") return json({ server: "lukewrt" });
      if (path.startsWith("/dl/")) return await proxyDownloads(path.slice(3), req, ctx);
      if (path.startsWith("/store/")) {
        if (path.includes("..")) return json({ detail: "bad path" }, 400);
        const r = await serveR2(env, path.slice(1), req, { download: !path.endsWith(".json"), cache: "public, max-age=86400" });
        return r || json({ detail: "not found" }, 404);
      }
      if (path.startsWith("/packages/")) {
        if (path.includes("..")) return json({ detail: "bad path" }, 400);
        const r = await serveR2(env, path.slice(1), req, { download: true, cache: "public, max-age=3600" });
        return r || json({ detail: "not found" }, 404);
      }
      if (path === "/" || path === "") path = "/index.html";
      if (path.includes("..")) return new Response("bad path", { status: 400 });
      const r = await serveR2(env, "site" + path, req, { cache: path === "/index.html" || path === "/config.js" ? "no-cache" : "public, max-age=3600" });
      return r || new Response("Not found", { status: 404 });
    } catch (e) {
      return json({ detail: "server error", error: String(e && e.message) }, 500);
    }
  },
};
