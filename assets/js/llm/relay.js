// VoltEPIC's report server: relay/server.mjs on the project's lab PC, reached through an ngrok tunnel. It builds the message
// from the evidence file with the same code and prompts as the site (denetim.js, data/kimyager_istem.json) and asks the
// AI-LAB model on the lab network. While the PC or the tunnel is off, the report is not available.

const SERVER = "https://camper-envision-quill.ngrok-free.dev";   // the tunnel's fixed address (ngrok dev domain)

/** Measured on this report at xhigh (literature/xai_llm_rag/kimyager_raporu/yerel_llm_deney_sonuclari_2026-10-22.md):
 *  3.3–10.6 min a report, 3 of 7 reports with a wrong claim on the inputs where Gemini 3.8 Flash had 0. */
export const MODEL = { id: "local-llm", label: "Lab LLM" };

const OFFLINE = "VoltEPIC's report server is offline right now: it runs on the project's lab PC. Try again later.";

/** The server's address ("" = none); a local relay can be tried with localStorage voltepic.relay. */
export const server = () => { try { return localStorage.getItem("voltepic.relay") || SERVER; } catch { return SERVER; } };

const explain = (code, message) => (code === 429 ? "Too many reports from this address; wait a minute."
  : message ? `${message}${code >= 500 ? " Try again in a few minutes." : ""}` : OFFLINE);

/** One call: the server builds the message from the evidence file ("rapor" or "soru"), the report given, the question and the
 *  earlier attempts' check findings → { text, finishReason, modelVersion, usage, ms }. Errors after the server has started
 *  answering come in the JSON body, since the status is sent before the model's text. */
export async function generate({ kind, kanit, rapor, soru, onceki, signal }) {
  if (!server()) throw new Error(OFFLINE);
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(`${server()}/generate`, {
      method: "POST", signal, headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
      body: JSON.stringify({ kind, kanit, rapor, soru, onceki }),
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error(OFFLINE);
  }
  const body = await res.json().catch(() => ({}));
  const error = body.error ?? (res.ok && body.text ? null : { code: res.status });
  if (error) throw new Error(explain(error.code, error.message));
  return { text: body.text, finishReason: body.finishReason, modelVersion: body.model ?? MODEL.id, usage: body.usage ?? {}, ms: performance.now() - t0 };
}
