// VoltEPIC shared Gemini access: a Cloudflare Worker that holds the project's Gemini key as a secret.
// It is not a general Gemini relay: it accepts only the analyzer's evidence file (the chemist report: "rapor"; a follow-up
// question: "soru"), builds the message itself with the same code and prompts as the site (assets/js/llm/denetim.js +
// data/kimyager_istem.json), and answers only the site's origin, a few times a minute per IP.

import { pyJson } from "../../assets/js/llm/kanit.js";
import { mesajRapor, mesajSoru, duzeltme } from "../../assets/js/llm/denetim.js";
import istem from "../../data/kimyager_istem.json";

const ORIGINS = ["https://eng-peak-deconvolution-team2.github.io", "http://127.0.0.1:8765", "http://localhost:8765"];
const MODELS = ["gemini-3.8-flash", "gemini-2.5-flash"];
const API = "https://generativelanguage.googleapis.com/v1beta";
const MAX_BODY = 80000, MAX_Q = 600, MAX_TEXT = 4000, MAX_ONCEKI = 2;

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type", "Access-Control-Max-Age": "86400", Vary: "Origin",
});
const fail = (status, message, origin) => new Response(JSON.stringify({ error: { code: status, message } }), {
  status, headers: { "content-type": "application/json", ...(origin ? cors(origin) : {}) },
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
    const why = invalid(body);
    if (why) return fail(400, `Not an analyzer request (${why}).`, origin);
    if (!env.GEMINI_API_KEY) return fail(500, "The shared access has no key configured.", origin);
    const rapor = body.kind === "rapor";
    const kanit = pyJson(rapor ? { ...body.kanit, soru: null } : { ...body.kanit, soru: body.soru });
    let mesaj = rapor ? mesajRapor(kanit) : mesajSoru(kanit, body.rapor, body.soru);
    for (const o of body.onceki ?? []) mesaj += duzeltme(o.metin, o.bulgu, rapor ? 5 : 4);
    const res = await fetch(`${API}/models/${body.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: rapor ? istem.rapor : istem.soru }] }, contents: [{ role: "user", parts: [{ text: mesaj }] }] }),
    });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json", ...cors(origin) } });
  },
};
