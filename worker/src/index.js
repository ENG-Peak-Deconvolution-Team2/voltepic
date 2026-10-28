// VoltEPIC's mailbox for the chemist report: a Cloudflare Worker with one Durable Object (Kuyruk). The site leaves a
// request here; the project's lab PC (relay/server.mjs) collects it over outbound HTTPS, asks the AI-LAB model and leaves
// the answer; the site picks it up. Nothing ever connects to the PC: no port is opened on it and no tunnel runs.
// Visitors: only the site's origin, only the analyzer's evidence file (the chemist report: "rapor"; a follow-up question:
// "soru"), a Cloudflare Turnstile token, 4 requests a minute per IP, a short line. The PC: a bearer secret.
// Secrets (npx wrangler@4 secret put …; .dev.vars when local): TURNSTILE_SECRET, PC_SECRET.

import { DurableObject } from "cloudflare:workers";

const ORIGINS = ["https://eng-peak-deconvolution-team2.github.io", "http://127.0.0.1:8765", "http://localhost:8765"];
const MAX_BODY = 80000, MAX_Q = 600, MAX_TEXT = 4000, MAX_ONCEKI = 2;
const BUSY = 2, LINE = 6;                           // lab calls at once; requests waiting at most
const PC_GONE = 20000;                              // the PC asks every 3 s; silent this long = off
const VISITOR_GONE = 60000;                         // the site asks every 3 s; silent this long = left
const LAB_GONE = 90000;                             // the PC reports every 15 s while the lab writes
const KEEP = 900000, MAX_JOB = 2100000;             // answers kept 15 min; a request ends after 35 min
const OFFLINE = "VoltEPIC's report server is offline right now: it runs on the project's lab PC. Try again later.";

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type", "Access-Control-Max-Age": "86400", Vary: "Origin",
});
const json = (data, status, origin) => new Response(status === 204 ? null : JSON.stringify(data), {
  status, headers: { "content-type": "application/json", ...(origin ? cors(origin) : {}) },
});
const fail = (status, message, origin) => json({ error: { code: status, message } }, status, origin);
const str = (x, max) => typeof x === "string" && x.trim().length > 0 && x.length <= max;

/** The request must look like the analyzer's: a four-decision evidence file of the chemist report, short texts. */
function invalid(b) {
  const k = b?.kanit;
  if (!["rapor", "soru"].includes(b?.kind)) return "kind";
  if (!k || typeof k !== "object" || !String(k.kanit_dosyasi_surumu ?? "").startsWith("kimyager_raporu")) return "evidence file";
  if (!Array.isArray(k.kararlar) || k.kararlar.length !== 4 || Object.keys(k.analitler ?? {}).length !== 4) return "decisions";
  if (b.kind === "soru" && (!str(b.soru, MAX_Q) || !str(b.rapor, MAX_TEXT))) return "question";
  if (!Array.isArray(b.onceki ?? []) || (b.onceki ?? []).length > MAX_ONCEKI) return "attempts";
  if ((b.onceki ?? []).some((o) => !str(o?.metin, MAX_TEXT) || !Array.isArray(o.bulgu) || o.bulgu.some((x) => !str(x, 300)))) return "attempt shape";
  return null;
}

/** Cloudflare Turnstile: the browser's single-use token for this request, checked with the secret (fails closed). */
async function human(token, ip, env) {
  if (!str(token, 2048) || !env.TURNSTILE_SECRET) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    return (await r.json()).success === true;
  } catch { return false; }
}

/** The lab PC: "Authorization: Bearer <PC_SECRET>", compared in constant time. */
function isPc(req, env) {
  const enc = new TextEncoder(), got = enc.encode(req.headers.get("Authorization") ?? ""), want = enc.encode(`Bearer ${env.PC_SECRET ?? ""}`);
  return !!env.PC_SECRET && got.byteLength === want.byteLength && crypto.subtle.timingSafeEqual(got, want);
}

export default {
  async fetch(req, env) {
    const path = new URL(req.url).pathname;
    const box = env.KUYRUK.get(env.KUYRUK.idFromName("kuyruk"));
    const jobId = path.match(/^\/(?:jobs|pc\/beat|pc\/done)\/([0-9a-f-]{36})$/)?.[1];

    if (path.startsWith("/pc/")) {                  // the lab PC
      if (req.method !== "POST") return fail(404, "Not found");
      if (!isPc(req, env)) return fail(401, "Not the lab PC.");
      if (path === "/pc/next") { const job = await box.next(); return job ? json(job, 200) : json(null, 204); }
      if (jobId && path.startsWith("/pc/beat/")) return json(await box.beat(jobId), 200);
      if (jobId && path.startsWith("/pc/done/")) {
        let result;
        try { result = JSON.parse(await req.text()); } catch { return fail(400, "Not JSON."); }
        return json(await box.done(jobId, result), 200);
      }
      return fail(404, "Not found");
    }

    const origin = req.headers.get("Origin");      // the site
    const allowed = ORIGINS.includes(origin);
    if (req.method === "OPTIONS") return allowed ? new Response(null, { status: 204, headers: cors(origin) }) : new Response(null, { status: 403 });
    if (req.method === "GET" && path === "/status") return json(await box.status(), 200, allowed ? origin : null);
    if (!allowed) return fail(403, "This origin may not use the report server.");
    if (req.method === "POST" && path === "/jobs") {
      const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
      if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) return fail(429, "Too many reports from this address; wait a minute.", origin);
      const raw = await req.text();
      if (raw.length > MAX_BODY) return fail(413, "Request too large.", origin);
      let body;
      try { body = JSON.parse(raw); } catch { return fail(400, "Request is not JSON.", origin); }
      const why = invalid(body);
      if (why) return fail(400, `Not an analyzer request (${why}).`, origin);
      if (!(await human(body.insan, ip, env))) return fail(403, "The human check did not pass; reload the page and try again.", origin);
      const { kind, kanit, rapor, soru, onceki } = body;
      const out = await box.add({ kind, kanit, rapor, soru, onceki });
      return out.error ? json(out, out.error.code, origin) : json(out, 202, origin);
    }
    if (jobId && path.startsWith("/jobs/") && req.method === "GET") {
      const out = await box.look(jobId);
      return json(out, out.error?.code === 404 ? 404 : 200, origin);
    }
    if (jobId && path.startsWith("/jobs/") && req.method === "DELETE") { await box.drop(jobId); return json(null, 204, origin); }
    return fail(404, "Not found", origin);
  },
};

/** The line: every request and answer, kept in this object's storage (so nothing is lost when it sleeps between calls). */
export class Kuyruk extends DurableObject {
  async jobs() { return [...(await this.ctx.storage.list({ prefix: "job:" })).values()]; }
  save(job) { return this.ctx.storage.put(`job:${job.id}`, job); }

  /** Ends what nobody waits for any more; called at the start of every request, so no timer keeps the object awake. */
  async sweep(now) {
    const pc = (await this.ctx.storage.get("pc")) ?? 0;
    for (const j of await this.jobs()) {
      const end = (message, code = 503) => this.save({ ...j, status: "error", error: { code, message }, finished: now });
      if (j.status === "waiting" && now - j.seen > VISITOR_GONE) await this.ctx.storage.delete(`job:${j.id}`);
      else if (j.status === "waiting" && now - pc > PC_GONE) await end(OFFLINE);
      else if (j.status === "running" && now - j.beat > LAB_GONE) await end("The lab PC stopped answering. Try again in a few minutes.", 504);
      else if (j.status !== "done" && j.status !== "error" && now - j.created > MAX_JOB) await end("The report took too long. Try again in a few minutes.", 504);
      else if ((j.status === "done" || j.status === "error") && now - j.finished > KEEP) await this.ctx.storage.delete(`job:${j.id}`);
    }
    return pc;
  }

  async status() { const now = Date.now(); return { pc: now - (await this.sweep(now)) < PC_GONE }; }

  async add(body) {
    const now = Date.now();
    if (now - (await this.sweep(now)) >= PC_GONE) return { error: { code: 503, message: OFFLINE } };
    if ((await this.jobs()).filter((j) => j.status === "waiting").length >= LINE) {
      return { error: { code: 503, message: "The report server is busy with other reports. Try again in a few minutes." } };
    }
    const job = { id: crypto.randomUUID(), status: "waiting", body, created: now, seen: now };
    await this.save(job);
    return { id: job.id };
  }

  async look(id) {
    const now = Date.now();
    await this.sweep(now);
    const j = await this.ctx.storage.get(`job:${id}`);
    if (!j) return { error: { code: 404, message: "This report request has expired. Try again." } };
    await this.save({ ...j, seen: now });
    if (j.status === "waiting") return { status: "waiting", ahead: (await this.jobs()).filter((o) => o.status === "waiting" && o.created < j.created).length };
    if (j.status === "running") return { status: "running" };
    return j.status === "done" ? { status: "done", ...j.result } : { status: "error", error: j.error };
  }

  async drop(id) {
    const j = await this.ctx.storage.get(`job:${id}`);
    if (j?.status === "waiting") await this.ctx.storage.delete(`job:${id}`);
    else if (j?.status === "running") await this.save({ ...j, seen: 0 });   // the PC's next report sees the visitor gone
  }

  async next() {
    const now = Date.now();
    await this.ctx.storage.put("pc", now);
    await this.sweep(now);
    const all = await this.jobs();
    if (all.filter((j) => j.status === "running").length >= BUSY) return null;
    const j = all.filter((o) => o.status === "waiting").sort((a, b) => a.created - b.created)[0];
    if (!j) return null;
    await this.save({ ...j, status: "running", started: now, beat: now });
    return { id: j.id, ...j.body };
  }

  async beat(id) {
    const now = Date.now();
    await this.ctx.storage.put("pc", now);
    const j = await this.ctx.storage.get(`job:${id}`);
    if (j?.status !== "running") return { cancel: true };
    await this.save({ ...j, beat: now });
    return { cancel: now - j.seen > VISITOR_GONE };
  }

  async done(id, result) {
    const now = Date.now();
    await this.ctx.storage.put("pc", now);
    const j = await this.ctx.storage.get(`job:${id}`);
    if (j?.status !== "running") return { kept: false };
    const ok = typeof result?.text === "string" && result.text.length > 0 && result.text.length <= 20000;
    await this.save(ok ? { ...j, status: "done", result: { text: result.text, finishReason: result.finishReason, model: result.model, usage: result.usage }, finished: now }
      : { ...j, status: "error", error: { code: Number(result?.error?.code) || 502, message: String(result?.error?.message ?? "The lab model returned no text.").slice(0, 300) }, finished: now });
    return { kept: true };
  }
}
