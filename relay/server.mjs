// VoltEPIC's report server: runs on the project's lab PC and answers the site's chemist-report requests with the AI-LAB
// model, which is reachable only from the lab network. The site reaches it through an ngrok tunnel (relay/start.ps1).
// Like worker/ it is not a general relay: it accepts only the analyzer's evidence file (the chemist report: "rapor"; a
// follow-up question: "soru"), builds the message itself with the same code and prompts as the site
// (assets/js/llm/denetim.js + data/kimyager_istem.json), and answers only the site's origin, a few times a minute per IP.
// The lab call is streamed and its effort is xhigh, as measured in literature/xai_llm_rag/kimyager_raporu/
// yerel_llm_deney_sonuclari_2026-10-22.md (report 3.3–10.6 min; the lab proxy cuts unstreamed calls at ~300 s). The answer
// to the browser starts at once and carries a space every 15 s until the JSON, so no browser or tunnel waits on silence.
//   node relay/server.mjs            (key: LOCAL_LLM_CLIENT_KEY, else read from ~/.omp/agent/.env;
//                                     lab address: LAB_LLM_URL, else relay/.env, which stays on the PC: .gitignore)

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pyJson } from "../assets/js/llm/kanit.js";
import { mesajRapor, mesajSoru, duzeltme } from "../assets/js/llm/denetim.js";

const PORT = Number(process.env.PORT ?? 8788);
try { process.loadEnvFile(join(import.meta.dirname, ".env")); } catch {}
const LLM = process.env.LAB_LLM_URL;
if (!LLM) { console.error("No LAB_LLM_URL (environment or relay/.env)."); process.exit(1); }
const MODEL = "local-llm", EFFORT = process.env.LAB_LLM_EFFORT ?? "xhigh";
const ORIGINS = ["https://eng-peak-deconvolution-team2.github.io", "http://127.0.0.1:8765", "http://localhost:8765"];
const MAX_BODY = 80000, MAX_Q = 600, MAX_TEXT = 4000, MAX_ONCEKI = 2;
const RATE = 4, PERIOD = 60000;                     // 4 reports per minute per IP address
const TIMEOUT = 1800000, BEAT = 15000;              // whole stream, as rapor.py; keep-alive space

const istem = JSON.parse(readFileSync(new URL("../data/kimyager_istem.json", import.meta.url), "utf8"));
const envKey = () => {
  try {
    const line = readFileSync(join(homedir(), ".omp", "agent", ".env"), "utf8").split(/\r?\n/).find((l) => l.startsWith("LOCAL_LLM_CLIENT_KEY="));
    return line?.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") ?? "";
  } catch { return ""; }
};
const KEY = process.env.LOCAL_LLM_CLIENT_KEY || envKey();
if (!KEY) { console.error("No LOCAL_LLM_CLIENT_KEY (environment or ~/.omp/agent/.env)."); process.exit(1); }

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, ngrok-skip-browser-warning", "Access-Control-Max-Age": "86400", Vary: "Origin",
});
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

const calls = new Map();
function limited(ip) {
  const now = Date.now(), recent = (calls.get(ip) ?? []).filter((t) => now - t < PERIOD);
  calls.set(ip, recent);
  if (recent.length >= RATE) return true;
  recent.push(now);
  return false;
}

/** The lab model's answer, streamed (as rapor.py's _yerel): { text, finishReason, model, usage }. */
async function ask(system, mesaj, signal) {
  const res = await fetch(`${LLM}/chat/completions`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, reasoning_effort: EFFORT, stream: true, stream_options: { include_usage: true },
      messages: [{ role: "system", content: system }, { role: "user", content: mesaj }] }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(`The lab model returned HTTP ${res.status}${body.error?.message ? `: ${body.error.message}` : ""}.`), { status: 502 });
  }
  let text = "", finishReason, model = MODEL, usage = {}, buf = "";
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines.map((l) => l.trim())) {
      if (!line.startsWith("data:") || line.slice(5).trim() === "[DONE]") continue;
      const ev = JSON.parse(line.slice(5));
      model = ev.model ?? model;
      usage = ev.usage ?? usage;
      for (const ch of ev.choices ?? []) {
        text += ch.delta?.content ?? "";
        finishReason = ch.finish_reason ?? finishReason;
      }
    }
  }
  return { text: text.trim(), finishReason, model, usage };
}

createServer(async (req, res) => {
  const t0 = Date.now();
  const origin = req.headers.origin;
  const allowed = ORIGINS.includes(origin);
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown").split(",")[0].trim();
  const log = (status, payload) => console.log(`${new Date().toISOString()} ${ip} ${status} ${((Date.now() - t0) / 1000).toFixed(1)} s`
    + (payload.error ? ` ${payload.error.message}` : ` ${payload.usage?.completion_tokens ?? "?"} tokens`));
  const fail = (status, message) => {
    const payload = { error: { code: status, message } };
    res.writeHead(status, { "content-type": "application/json", ...(allowed ? cors(origin) : {}) });
    res.end(JSON.stringify(payload));
    if (req.method === "POST") log(status, payload);
  };
  if (req.method === "OPTIONS") { res.writeHead(allowed ? 204 : 403, allowed ? cors(origin) : {}); res.end(); return; }
  if (req.method !== "POST" || new URL(req.url, "http://x").pathname !== "/generate") return fail(404, "Not found");
  if (!allowed) return fail(403, "This origin may not use the report server.");
  if (limited(ip)) return fail(429, "Too many reports from this address; wait a minute.");
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) return fail(413, "Request too large.");
  }
  let body;
  try { body = JSON.parse(raw); } catch { return fail(400, "Request is not JSON."); }
  const why = invalid(body);
  if (why) return fail(400, `Not an analyzer request (${why}).`);
  const rapor = body.kind === "rapor";
  const kanit = pyJson(rapor ? { ...body.kanit, soru: null } : { ...body.kanit, soru: body.soru });
  let mesaj = rapor ? mesajRapor(kanit) : mesajSoru(kanit, body.rapor, body.soru);
  for (const o of body.onceki ?? []) mesaj += duzeltme(o.metin, o.bulgu, rapor ? 5 : 4);

  // From here the status is 200 and errors travel in the JSON body; a visitor who leaves stops the lab call.
  res.writeHead(200, { "content-type": "application/json", ...cors(origin) });
  const beat = setInterval(() => res.write(" "), BEAT);
  const left = new AbortController();
  res.on("close", () => { if (!res.writableEnded) left.abort(); });
  let payload;
  try {
    payload = await ask(rapor ? istem.rapor : istem.soru, mesaj, AbortSignal.any([left.signal, AbortSignal.timeout(TIMEOUT)]));
    if (!payload.text) payload = { error: { code: 502, message: `The lab model returned no text (finish reason: ${payload.finishReason ?? "unknown"}).` } };
  } catch (err) {
    const message = left.signal.aborted ? "The visitor left before the answer."
      : err.name === "TimeoutError" ? "The lab model did not answer in time." : err.status ? err.message : "The lab model could not be reached.";
    payload = { error: { code: err.status ?? 504, message } };
  }
  clearInterval(beat);
  res.end(JSON.stringify(payload));
  log(payload.error ? payload.error.code : 200, payload);
}).listen(PORT, () => console.log(`VoltEPIC report server on http://localhost:${PORT}/generate → ${LLM} (${MODEL}, ${EFFORT})`));
