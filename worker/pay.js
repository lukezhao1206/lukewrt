// Alipay 当面付 (alipay.trade.precreate) + activation codes, stored in KV.
// Env: ALIPAY_APPID, ALIPAY_PRIVATE_KEY (secret, PKCS8 or PKCS1 base64),
//      ALIPAY_PUBLIC_KEY (Alipay's public key, base64 SPKI), PUBLIC_ORIGIN.
const GATEWAY = "https://openapi.alipay.com/gateway.do";
export const PLANS = {
  single: { amount: "3.00", subject: "LukeWrt 固件定制服务 单次", credits: 1 },
  forever: { amount: "88.00", subject: "LukeWrt 固件定制服务 永久", credits: -1 },
};

const b64d = (s) => Uint8Array.from(atob(s.replace(/-----[^-]+-----|\s+/g, "")), (c) => c.charCodeAt(0));
const b64e = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

function derLen(n) {
  if (n < 128) return [n];
  const a = []; while (n) { a.unshift(n & 255); n >>= 8; }
  return [0x80 | a.length, ...a];
}
function pkcs1to8(p1) {
  const algo = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const oct = [0x04, ...derLen(p1.length), ...p1];
  const body = [0x02, 0x01, 0x00, ...algo, ...oct];
  return new Uint8Array([0x30, ...derLen(body.length), ...body]);
}

let _priv, _pub;
async function privKey(env) {
  if (_priv) return _priv;
  const raw = b64d(env.ALIPAY_PRIVATE_KEY || (await env.JOBS.get("cfg:alipay_priv")) || "");
  const alg = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  try { _priv = await crypto.subtle.importKey("pkcs8", raw, alg, false, ["sign"]); }
  catch { _priv = await crypto.subtle.importKey("pkcs8", pkcs1to8(raw), alg, false, ["sign"]); }
  return _priv;
}
async function pubKey(env) {
  if (_pub) return _pub;
  _pub = await crypto.subtle.importKey("spki", b64d(env.ALIPAY_PUBLIC_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  return _pub;
}

function cnTime() {
  const d = new Date(Date.now() + 8 * 3600e3).toISOString();
  return d.slice(0, 10) + " " + d.slice(11, 19);
}
const signStr = (p) => Object.keys(p).filter((k) => p[k] !== "" && p[k] != null && k !== "sign").sort().map((k) => `${k}=${p[k]}`).join("&");

async function call(env, method, biz, extra = {}) {
  const p = { app_id: env.ALIPAY_APPID, method, format: "JSON", charset: "utf-8", sign_type: "RSA2", timestamp: cnTime(), version: "1.0", biz_content: JSON.stringify(biz), ...extra };
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await privKey(env), new TextEncoder().encode(signStr(p)));
  p.sign = b64e(sig);
  const r = await fetch(GATEWAY, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" }, body: new URLSearchParams(p).toString() });
  const j = await r.json();
  return j[method.replace(/\./g, "_") + "_response"];
}

export async function verifyNotify(env, params) {
  const sign = params.sign;
  if (!sign) return false;
  const p = { ...params }; delete p.sign; delete p.sign_type;
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", await pubKey(env), b64d(sign), new TextEncoder().encode(signStr(p)));
}

function rid(n) {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint8Array(n))].map((x) => a[x % a.length]).join("");
}

export async function createOrder(env, plan) {
  const P = PLANS[plan];
  if (!P) return { error: "bad plan" };
  const out_trade_no = "LW" + Date.now() + rid(4);
  const res = await call(env, "alipay.trade.precreate", { out_trade_no, total_amount: P.amount, subject: P.subject, timeout_express: "15m" },
    { notify_url: `${env.PUBLIC_ORIGIN}/api/pay/notify` });
  if (!res || res.code !== "10000") return { error: (res && (res.sub_msg || res.msg)) || "alipay error" };
  await env.JOBS.put(`order:${out_trade_no}`, JSON.stringify({ plan, amount: P.amount, status: "WAIT", created: Date.now() }), { expirationTtl: 30 * 86400 });
  return { order: out_trade_no, qr: res.qr_code, amount: P.amount, plan };
}

async function fulfil(env, no, trade_no) {
  const raw = await env.JOBS.get(`order:${no}`);
  if (!raw) return null;
  const o = JSON.parse(raw);
  if (o.code) return o;
  o.status = "PAID"; o.trade_no = trade_no; o.code = "LW-" + rid(4) + "-" + rid(4) + "-" + rid(4);
  const credits = PLANS[o.plan].credits;
  await env.JOBS.put(`code:${o.code}`, JSON.stringify({ plan: o.plan, credits, order: no, created: Date.now() }));
  await env.JOBS.put(`order:${no}`, JSON.stringify(o), { expirationTtl: 365 * 86400 });
  return o;
}

export async function handleNotify(env, params) {
  if (!(await verifyNotify(env, params))) return false;
  if (params.app_id !== env.ALIPAY_APPID) return false;
  if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(params.trade_status)) return true;
  const raw = await env.JOBS.get(`order:${params.out_trade_no}`);
  if (!raw) return true;
  if (JSON.parse(raw).amount !== Number(params.total_amount).toFixed(2)) return false;
  await fulfil(env, params.out_trade_no, params.trade_no);
  return true;
}

export async function orderStatus(env, no) {
  const raw = await env.JOBS.get(`order:${no}`);
  if (!raw) return { error: "not found" };
  let o = JSON.parse(raw);
  if (!o.code && Date.now() - o.created < 20 * 60e3) {
    const q = await call(env, "alipay.trade.query", { out_trade_no: no });
    if (q && q.code === "10000" && ["TRADE_SUCCESS", "TRADE_FINISHED"].includes(q.trade_status) && Number(q.total_amount).toFixed(2) === o.amount) {
      o = (await fulfil(env, no, q.trade_no)) || o;
    }
  }
  return { status: o.code ? "PAID" : "WAIT", code: o.code || null, plan: o.plan };
}

// Returns {ok, plan, left} or {ok:false}. consume=true spends a single-use credit.
export async function checkCode(env, code, consume = false) {
  if (!code || !/^LW-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return { ok: false };
  const raw = await env.JOBS.get(`code:${code}`);
  if (!raw) return { ok: false };
  const c = JSON.parse(raw);
  if (c.credits === -1) return { ok: true, plan: c.plan, left: -1 };
  if (c.credits <= 0) return { ok: false, plan: c.plan, left: 0 };
  if (consume) { c.credits -= 1; await env.JOBS.put(`code:${code}`, JSON.stringify(c)); }
  return { ok: true, plan: c.plan, left: c.credits };
}

export async function selfTest(env) {
  _priv = undefined;
  await privKey(env);
  const r = await call(env, "alipay.trade.query", { out_trade_no: "LWSELFTEST" + Date.now() });
  return { code: r && r.code, sub_code: r && r.sub_code, msg: r && (r.sub_msg || r.msg) };
}

// Reserve one credit for build `hash` (charged only when the build succeeds).
export async function holdCode(env, code, hash) {
  const c = await checkCode(env, code, false);
  if (!c.ok) return c;
  if (c.left === -1) return c;
  if ((await env.JOBS.get(`hold:${hash}`)) === code) return { ...c, held: true };
  const l = await env.JOBS.list({ prefix: `holdc:${code}:` });
  const left = c.left - l.keys.length;
  if (left <= 0) return { ok: false, plan: c.plan, left: 0, pending: l.keys.length };
  await env.JOBS.put(`hold:${hash}`, code, { expirationTtl: 2 * 86400 });
  await env.JOBS.put(`holdc:${code}:${hash}`, "1", { expirationTtl: 2 * 86400 });
  return { ok: true, plan: c.plan, left: left - 1, held: true };
}
// success=true: spend the held credit once; false: release it.
export async function settleHold(env, hash, success) {
  const code = await env.JOBS.get(`hold:${hash}`);
  if (!code) return;
  await env.JOBS.delete(`hold:${hash}`);
  await env.JOBS.delete(`holdc:${code}:${hash}`);
  if (!success) return;
  if (await env.JOBS.get(`charged:${hash}:${code}`)) return;
  await env.JOBS.put(`charged:${hash}:${code}`, "1", { expirationTtl: 30 * 86400 });
  const raw = await env.JOBS.get(`code:${code}`);
  if (!raw) return;
  const c = JSON.parse(raw);
  if (c.credits > 0) { c.credits -= 1; await env.JOBS.put(`code:${code}`, JSON.stringify(c)); }
}
