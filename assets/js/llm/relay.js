// VoltEPIC's report server: relay/server.mjs on the project's lab PC, reached through an ngrok tunnel. It builds the message
// from the evidence file with the same code and prompts as the site (denetim.js, data/kimyager_istem.json) and asks the
// AI-LAB model on the lab network. While the PC or the tunnel is off, the report is not available.

const SERVER = "";                                   // the tunnel's address; "" = the report server is off (ngrok dev domain was https://camper-envision-quill.ngrok-free.dev)

/** Measured on this report at xhigh (literature/xai_llm_rag/kimyager_raporu/yerel_llm_deney_sonuclari_2026-10-22.md):
 *  3.3–10.6 min a report, 3 of 7 reports with a wrong claim on the inputs where Gemini 3.8 Flash had 0. */
export const MODEL = { id: "local-llm", label: "Lab LLM" };

const OFFLINE = "VoltEPIC's report server is offline right now: it runs on the project's lab PC. Try again later.";

/** Cloudflare Turnstile sitekey (public); the report server checks each request's token with the secret in relay/.env. */
const HUMAN = "1x00000000000000000000AA";            // Cloudflare's always-pass test key, until the project's own widget
const HUMAN_FAIL = "The human check did not pass; reload the page and try again.";
let loading, human;

/** A fresh Turnstile token for one request (single use, valid 5 min); the widget shows only when it needs the visitor. */
async function humanToken() {
  loading ??= new Promise((ok, no) => {
    const s = Object.assign(document.createElement("script"), { src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async: true });
    s.onload = ok;
    s.onerror = () => { loading = null; no(new Error("The human check could not load; check the connection and try again.")); };
    document.head.append(s);
  });
  await loading;
  return new Promise((resolve, reject) => {
    if (!human) {
      const box = Object.assign(document.createElement("div"), { className: "human-check" });
      document.body.append(box);
      human = { pending: null };
      human.id = turnstile.render(box, { sitekey: HUMAN, execution: "execute", appearance: "interaction-only",
        callback: (token) => human.pending?.resolve(token), "error-callback": () => human.pending?.reject(new Error(HUMAN_FAIL)) });
    } else turnstile.reset(human.id);
    human.pending = { resolve, reject };
    turnstile.execute(human.id);
  });
}

/** The server's address ("" = none). A local copy of the site (127.0.0.1, localhost) can try a local relay with
 *  localStorage voltepic.relay; the published site ignores it, since any page on the same github.io origin could set it. */
const LOCAL = ["127.0.0.1", "localhost"].includes(location.hostname);
export const server = () => { try { return (LOCAL && localStorage.getItem("voltepic.relay")) || SERVER; } catch { return SERVER; } };

const explain = (code, message) => (code === 429 ? "Too many reports from this address; wait a minute."
  : message ? `${message}${code >= 500 ? " Try again in a few minutes." : ""}` : OFFLINE);

/** One call: the server builds the message from the evidence file ("rapor" or "soru"), the report given, the question and the
 *  earlier attempts' check findings → { text, finishReason, modelVersion, usage, ms }. Errors after the server has started
 *  answering come in the JSON body, since the status is sent before the model's text. */
export async function generate({ kind, kanit, rapor, soru, onceki, signal }) {
  if (!server()) throw new Error(OFFLINE);
  const t0 = performance.now();
  const insan = await humanToken();
  let res;
  try {
    res = await fetch(`${server()}/generate`, {
      method: "POST", signal, headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
      body: JSON.stringify({ kind, kanit, rapor, soru, onceki, insan }),
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
