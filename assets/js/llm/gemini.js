// Gemini API from the browser (REST generateContent, CORS-enabled). The key is the visitor's own: it is kept in this
// browser's localStorage and sent only to generativelanguage.googleapis.com. Nothing here ships a key.

const API = "https://generativelanguage.googleapis.com/v1beta";
const KEY = "voltepic.gemini.key";
const MODEL = "voltepic.gemini.model";

/** Models offered. Measured on the v0.2 report task, 2026-10-20 (literature/xai_llm_rag/prototip/kosu_2026-10-20_v02). */
export const MODELS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "0 decision errors, 0 verifier findings of its own on 5 curves" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "0 decision errors; once described the score as a presence probability" },
];

const store = {
  get: (k) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* storage blocked: key lives for this page only */ } },
};
let memoryKey = "";

/** The key out of whatever was pasted: "AQ.… name", quotes, `GEMINI_API_KEY=…` — keys never contain spaces. */
export function cleanKey(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/(?:AIza[\w-]{30,}|AQ\.[\w.-]{20,})/);
  if (m) return m[0];
  return (s.split(/\s+/)[0] ?? "").replace(/^[A-Z_]+=/, "").replace(/^["'`]+|["'`]+$/g, "");
}

export const getKey = () => cleanKey(store.get(KEY)) || memoryKey;
export function setKey(k) { memoryKey = cleanKey(k); store.set(KEY, memoryKey); }
export const getModel = () => store.get(MODEL) || MODELS[0].id;
export const setModel = (m) => store.set(MODEL, m);

function explain(status, message = "") {
  if ((status === 400 || status === 401) && /api key/i.test(message))
    return `Google rejected the API key (${status}: ${message}) Paste only the key itself — it starts with AIza… or AQ.… — not its name; replace it in Gemini settings.`;
  if (status === 403) return "This key is not allowed to call the Gemini API (403).";
  if (status === 404) return "This model is not available for this key (404).";
  if (status === 429) return "Quota or rate limit reached (429). Free keys allow a few requests per minute; wait and retry.";
  if (status === 503) return "This model is busy right now (503, high demand on Google's side). Retry in a minute, or pick another model in Gemini settings.";
  if (status >= 500) return `Gemini is unavailable right now (${status}). Retry in a minute.`;
  return `Gemini returned HTTP ${status}${message ? `: ${message}` : ""}.`;
}

/** One call: system instruction + one user message → { text, finishReason, modelVersion, usage, ms }. */
export async function generate({ key, model, system, user, signal }) {
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }] }),
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Could not reach the Gemini API (network or browser blocked the request).");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(explain(res.status, body.error?.message));
  const cand = body.candidates?.[0] ?? {};
  const text = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error(`Gemini returned no text (finish reason: ${cand.finishReason ?? body.promptFeedback?.blockReason ?? "unknown"}).`);
  return { text, finishReason: cand.finishReason, modelVersion: body.modelVersion ?? model, usage: body.usageMetadata ?? {}, ms: performance.now() - t0 };
}
