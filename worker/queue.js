// Build queue: one Durable Object holds the queue, so ordering and slot counts stay consistent.
import { DurableObject } from "cloudflare:workers";

export const MAX_RUNNING = 4;
const RUN_TTL = 45 * 60 * 1000;

export async function dispatch(env, hash) {
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

export class BuildQueue extends DurableObject {
  async _load() { return (await this.ctx.storage.get("s")) || { q: [], run: {} }; }
  _sorted(s) { return [...s.q].sort((a, b) => a.p - b.p || a.t - b.t); }
  _pos(s, h) {
    if (s.run[h]) return { state: "running", ahead: 0, total: s.q.length };
    const i = this._sorted(s).findIndex((x) => x.h === h);
    return i < 0 ? { state: "unknown", ahead: -1, total: s.q.length } : { state: "queued", ahead: i, total: s.q.length, priority: this._sorted(s)[i].p === 0 };
  }
  async _pump(s) {
    const now = Date.now();
    for (const [h, t] of Object.entries(s.run)) if (now - t > RUN_TTL) delete s.run[h];
    while (Object.keys(s.run).length < MAX_RUNNING && s.q.length) {
      const j = this._sorted(s)[0];
      s.q = s.q.filter((x) => x.h !== j.h);
      s.run[j.h] = now;
      try {
        await dispatch(this.env, j.h);
        const raw = await this.env.JOBS.get(`job:${j.h}`);
        const job = raw ? JSON.parse(raw) : {};
        if (job.status === "queued") {
          job.status = "dispatched"; job.created = Date.now();
          await this.env.JOBS.put(`job:${j.h}`, JSON.stringify(job), { expirationTtl: 30 * 86400 });
        }
      } catch (e) {
        delete s.run[j.h];
        await this.env.JOBS.put(`job:${j.h}`, JSON.stringify({ status: "failed", created: Date.now(), detail: "could not start build" }), { expirationTtl: 3600 });
      }
    }
    await this.ctx.storage.put("s", s);
    if (s.q.length || Object.keys(s.run).length) await this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
  }
  _locked(fn) { return this.ctx.blockConcurrencyWhile(fn); }

  enqueue(h, priority) {
    return this._locked(async () => {
      const s = await this._load();
      if (!s.run[h] && !s.q.find((x) => x.h === h)) s.q.push({ h, p: priority ? 0 : 1, t: Date.now() });
      await this._pump(s);
      return this._pos(s, h);
    });
  }
  position(h) {
    return this._locked(async () => { const s = await this._load(); await this._pump(s); return this._pos(s, h); });
  }
  promote(h) {
    return this._locked(async () => {
      const s = await this._load();
      const j = s.q.find((x) => x.h === h);
      if (j) j.p = 0;
      await this._pump(s);
      return this._pos(s, h);
    });
  }
  finish(h) {
    return this._locked(async () => {
      const s = await this._load();
      delete s.run[h];
      s.q = s.q.filter((x) => x.h !== h);
      await this._pump(s);
      return true;
    });
  }
  stats() {
    return this._locked(async () => { const s = await this._load(); return { queued: s.q.length, running: Object.keys(s.run).length, max: MAX_RUNNING }; });
  }
  async alarm() {
    await this._locked(async () => { const s = await this._load(); await this._pump(s); });
  }
}
