// Gemini API from the browser (REST generateContent, CORS-enabled). Two paths:
//  · the visitor's own key, kept in this browser's localStorage and sent only to generativelanguage.googleapis.com;
//  · the site's key, shipped only encrypted (data/gemini_key.json, tools/encrypt_key.mjs) and opened by the browser itself
//    with SITE_PASS: it keeps the key out of plain text in the repository, not out of reach of someone reading this code;
//  · VoltEPIC's shared access: a Cloudflare Worker (worker/) that holds the project's key as a secret and accepts only the
//    analyzer's evidence file (not deployed).

const API = "https://generativelanguage.googleapis.com/v1beta";
const KEY = "voltepic.gemini.key";
const MODEL = "voltepic.gemini.model";
const SITE_PASS = "1234";                            // opens data/gemini_key.json; tools/encrypt_key.mjs takes the same one
const SHARED = "";                                   // deployed Worker URL, e.g. https://voltepic-gemini.<account>.workers.dev

/** Models offered. Gemini 3.8 Flash measured on the evidence-file report, 2026-10-21 (literature/xai_llm_rag/kimyager_raporu/
 *  kosu_gemini_2026-10-21): 7/7 texts passed the code check, 0 wrong claims read by hand. 2.5 Flash: not measured on it. */
export const MODELS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "7/7 texts passed the check, 0 wrong claims on 5 curves" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "not measured on the evidence-file report" },
];

const store = {
  get: (k) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* storage blocked: key lives for this page only */ } },
};
let memoryKey = "", siteKey = "";

/** The shared-access URL ("" = none); a local Worker can be tried with localStorage voltepic.gemini.shared. */
export const shared = () => store.get("voltepic.gemini.shared") || SHARED;

/** The key out of whatever was pasted: "AQ.… name", quotes, `GEMINI_API_KEY=…` — keys never contain spaces. */
export function cleanKey(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/(?:AIza[\w-]{30,}|AQ\.[\w.-]{20,})/);
  if (m) return m[0];
  return (s.split(/\s+/)[0] ?? "").replace(/^[A-Z_]+=/, "").replace(/^["'`]+|["'`]+$/g, "");
}

export const looksLikeKey = (raw) => /AIza[\w-]{30,}|AQ\.[\w.-]{20,}/.test(String(raw ?? ""));
export const ownKey = () => cleanKey(store.get(KEY)) || memoryKey;
export const getKey = () => ownKey() || siteKey;
export const usingSiteKey = () => !ownKey() && !!siteKey;
export function setKey(k) { memoryKey = cleanKey(k); store.set(KEY, memoryKey); }

/** Opens the site's key (PBKDF2-SHA256 → AES-GCM); a wrong password fails the GCM check. */
async function unlockSiteKey(password) {
  const f = await fetch(new URL("../../../data/gemini_key.json", import.meta.url)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!f) throw new Error("This site has no built-in key.");
  const bytes = (b) => Uint8Array.from(atob(b), (ch) => ch.charCodeAt(0));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const aes = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: bytes(f.salt), iterations: f.iterations }, base,
    { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  try {
    siteKey = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(f.iv) }, aes, bytes(f.ct)));
  } catch {
    throw new Error("The site's key could not be opened.");
  }
}

/** Opens the site's key once per page (no-op when the site has none). */
export async function restoreSiteKey() {
  if (siteKey) return;
  try { await unlockSiteKey(SITE_PASS); } catch { /* no built-in key: a visitor's own key is needed */ }
}
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

/** One call with the visitor's key: system instruction + conversation → { text, finishReason, modelVersion, usage, ms }. */
export function generate({ key, model, system, contents, signal }) {
  return post(`${API}/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": key },
    { systemInstruction: { parts: [{ text: system }] }, contents }, model, signal, "the Gemini API");
}

/** One call through the shared access: the Worker builds the same message from the evidence file ("rapor" or "soru"), the
 *  report given, the question and the earlier attempts' check findings. */
export function generateShared({ model, kind, kanit, rapor, soru, onceki, signal }) {
  return post(`${shared()}/generate`, {}, { model, kind, kanit, rapor, soru, onceki }, model, signal, "VoltEPIC's shared access");
}

async function post(url, headers, payload, model, signal, where) {
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(url, { method: "POST", signal, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error(`Could not reach ${where} (network or browser blocked the request).`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(explain(res.status, body.error?.message));
  const cand = body.candidates?.[0] ?? {};
  const text = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error(`Gemini returned no text (finish reason: ${cand.finishReason ?? body.promptFeedback?.blockReason ?? "unknown"}).`);
  return { text, finishReason: cand.finishReason, modelVersion: body.modelVersion ?? model, usage: body.usageMetadata ?? {}, ms: performance.now() - t0 };
}
