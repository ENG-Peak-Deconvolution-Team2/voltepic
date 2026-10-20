// VoltEPIC shared Gemini access: a Cloudflare Worker that holds the project's Gemini key as a secret.
// It is not a general Gemini relay: it accepts only the analyzer's fact packet (plus, for follow-up questions, short
// questions and the earlier answers), builds the conversation itself with the same code and cards as the site
// (buildContents + data/llm.json), and answers only the site's origin, a few times a minute per IP.

import { buildContents } from "../../assets/js/llm/packet.js";
import llm from "../../data/llm.json";

const ORIGINS = ["https://eng-peak-deconvolution-team2.github.io", "http://127.0.0.1:8765", "http://localhost:8765"];
const MODELS = ["gemini-3.8-flash", "gemini-2.5-flash"];
const API = "https://generativelanguage.googleapis.com/v1beta";
const MAX_BODY = 80000;
const MAX_TURNS = 8, MAX_Q = 600, MAX_A = 12000;

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type", "Access-Control-Max-Age": "86400", Vary: "Origin",
});
const fail = (status, message, origin) => new Response(JSON.stringify({ error: { code: status, message } }), {
  status, headers: { "content-type": "application/json", ...(origin ? cors(origin) : {}) },
});

/** The packet must look like the analyzer's: 5–24 short numbered facts, four decisions, known card keys. */
function invalid(p) {
  if (!p || typeof p !== "object") return "no packet";
  if (!Array.isArray(p.facts) || p.facts.length < 5 || p.facts.length > 24) return "facts";
  if (p.facts.some((f) => !/^F\d{2}$/.test(f?.id) || typeof f.text !== "string" || f.text.length > 400)) return "fact shape";
  if (!Array.isArray(p.retrieve) || p.retrieve.length > 12 || p.retrieve.some((k) => !Object.hasOwn(llm.cards, k))) return "cards";
  if (!Array.isArray(p.values?.detection) || p.values.detection.length !== 4) return "detection";
  if (!p.sample || typeof p.sample !== "object") return "sample";
  return null;
}

/** Earlier turns [{ q: null | short string, a: string }] and the new question (null = the report). */
function invalidTurns(turns, question) {
  if (!Array.isArray(turns) || turns.length > MAX_TURNS) return "turns";
  const q = (x) => x === null || (typeof x === "string" && x.trim().length > 0 && x.length <= MAX_Q);
  if (turns.some((t) => !q(t?.q) || typeof t.a !== "string" || !t.a || t.a.length > MAX_A)) return "turn shape";
  if (!q(question ?? null)) return "question";
  return null;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin");
    const allowed = ORIGINS.includes(origin);
    if (req.method === "OPTIONS") return allowed ? new Response(null, { status: 204, headers: cors(origin) }) : new Response(null, { status: 403 });
    if (req.method !== "POST" || new URL(req.url).pathname !== "/generate") return fail(404, "Not found");
    if (!allowed) return fail(403, "This origin may not use the shared access.");
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: req.headers.get("CF-Connecting-IP") ?? "unknown" });
      if (!success) return fail(429, "Too many reports from this address; wait a minute.", origin);
    }
    const raw = await req.text();
    if (raw.length > MAX_BODY) return fail(413, "Request too large.", origin);
    let body;
    try { body = JSON.parse(raw); } catch { return fail(400, "Request is not JSON.", origin); }
    if (!MODELS.includes(body.model)) return fail(400, "Model not offered by the shared access.", origin);
    const why = invalid(body.packet) ?? invalidTurns(body.turns ?? [], body.question);
    if (why) return fail(400, `Not an analyzer request (${why}).`, origin);
    if (!env.GEMINI_API_KEY) return fail(500, "The shared access has no key configured.", origin);
    const res = await fetch(`${API}/models/${body.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: llm.system }] }, contents: buildContents(body.packet, llm.cards, body.turns ?? [], body.question ?? null) }),
    });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json", ...cors(origin) } });
  },
};
