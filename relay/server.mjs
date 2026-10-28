// VoltEPIC's report server: runs on the project's lab PC and answers the site's chemist-report requests with the AI-LAB
// model, which is reachable only from the lab network. It collects the requests from the site's mailbox (worker/, a
// Cloudflare Worker) over outbound HTTPS and leaves the answers there: nothing connects to this PC, no port is opened and
// no tunnel runs. The mailbox has already checked each request (origin, evidence-file shape, Turnstile, rate); this
// server builds the message itself with the same code and prompts as the site (assets/js/llm/check.js +
// data/chemist_prompts.json, English). The lab call is streamed and its effort is xhigh, as measured in
// literature/xai_llm_rag/kimyager_raporu/yerel_llm_deney_sonuclari_2026-10-22.md (report 3.3–10.6 min; the lab proxy cuts
// unstreamed calls at ~300 s). relay/switch.ps1 turns it on or off.
//   node relay/server.mjs            (key: LOCAL_LLM_CLIENT_KEY, else read from ~/.omp/agent/.env;
//                                     MAILBOX_URL, PC_SECRET, LAB_LLM_URL: environment, else relay/.env, which stays on
//                                     the PC: .gitignore)

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pyJson } from "../assets/js/llm/kanit.js";
import { reportMessage, questionMessage, retryNote } from "../assets/js/llm/check.js";

try { process.loadEnvFile(join(import.meta.dirname, ".env")); } catch {}
const need = (name) => process.env[name] || (console.error(`No ${name} (environment or relay/.env).`), process.exit(1));
const MAILBOX = need("MAILBOX_URL"), SECRET = need("PC_SECRET"), LLM = need("LAB_LLM_URL");
const MODEL = "local-llm", EFFORT = process.env.LAB_LLM_EFFORT ?? "xhigh";
const BUSY = 2;                                     // lab calls at once (the mailbox holds the same limit)
const POLL = 3000, BEAT = 15000, TIMEOUT = 1800000; // ask for work; report progress; whole stream, as rapor.py

const istem = JSON.parse(readFileSync(new URL("../data/chemist_prompts.json", import.meta.url), "utf8"));
const envKey = () => {
  try {
    const line = readFileSync(join(homedir(), ".omp", "agent", ".env"), "utf8").split(/\r?\n/).find((l) => l.startsWith("LOCAL_LLM_CLIENT_KEY="));
    return line?.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") ?? "";
  } catch { return ""; }
};
const KEY = process.env.LOCAL_LLM_CLIENT_KEY || envKey();
if (!KEY) { console.error("No LOCAL_LLM_CLIENT_KEY (environment or ~/.omp/agent/.env)."); process.exit(1); }

/** One call to the mailbox as the lab PC: the JSON answer, or null for "nothing to do". */
async function mailbox(path, body) {
  const res = await fetch(`${MAILBOX}${path}`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { "content-type": "application/json", Authorization: `Bearer ${SECRET}` }, body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`mailbox HTTP ${res.status}`);
  return res.json();
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
    console.error(`lab HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 500)}`);   // the lab's own text stays on the PC
    throw Object.assign(new Error(`The lab model returned HTTP ${res.status}. Try again in a few minutes.`), { status: 502 });
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

let running = 0;

/** One request: the message, the lab's answer, the answer back to the mailbox; a visitor who left stops the lab call. */
async function run(job) {
  running++;
  const t0 = Date.now(), rapor = job.kind === "rapor", left = new AbortController();
  const beat = setInterval(() => mailbox(`/pc/beat/${job.id}`).then((r) => r?.cancel && left.abort(), () => {}), BEAT);
  let payload;
  try {
    let mesaj;
    try {                                           // a crafted file (e.g. nested 20,000 deep) must not stop the server
      const kanit = pyJson(rapor ? { ...job.kanit, question: null } : { ...job.kanit, question: job.soru });
      mesaj = rapor ? reportMessage(kanit) : questionMessage(kanit, job.rapor, job.soru);
      for (const o of job.onceki ?? []) mesaj += retryNote(o.metin, o.bulgu, rapor ? 5 : 4);
    } catch { throw Object.assign(new Error("Not an analyzer request (evidence file)."), { status: 400 }); }
    payload = await ask(rapor ? istem.report : istem.question, mesaj, AbortSignal.any([left.signal, AbortSignal.timeout(TIMEOUT)]));
    if (!payload.text) payload = { error: { code: 502, message: `The lab model returned no text (finish reason: ${payload.finishReason ?? "unknown"}). Try again in a few minutes.` } };
  } catch (err) {
    const message = left.signal.aborted ? "The visitor left before the answer."
      : err.name === "TimeoutError" ? "The lab model did not answer in time. Try again in a few minutes."
      : err.status ? err.message : "The lab model could not be reached. Try again in a few minutes.";
    payload = { error: { code: err.status ?? 504, message } };
  }
  clearInterval(beat);
  for (let i = 0; i < 3; i++) {                     // the answer is worth a few tries
    try { await mailbox(`/pc/done/${job.id}`, payload); break; } catch { await sleep(5000); }
  }
  running--;
  console.log(`${new Date().toISOString()} ${job.id.slice(0, 8)} ${job.kind} ${payload.error ? payload.error.code : 200} `
    + `${((Date.now() - t0) / 1000).toFixed(1)} s ${payload.error ? payload.error.message : `${payload.usage?.completion_tokens ?? "?"} tokens`}`);
}

console.log(`VoltEPIC report server: mailbox ${MAILBOX} → ${LLM} (${MODEL}, ${EFFORT})`);
for (let down = 0; ;) {                             // ask for work every 3 s; while the mailbox is unreachable, back off to 30 s
  let job = null;
  if (running < BUSY) {
    try {
      job = await mailbox("/pc/next");
      if (down) console.log(`${new Date().toISOString()} mailbox reachable again`);
      down = 0;
    } catch (err) {
      if (!down) console.error(`${new Date().toISOString()} mailbox unreachable: ${err.message}`);
      down++;
    }
  }
  if (job) run(job);
  else await sleep(Math.min(POLL * 2 ** down, 30000));
}
