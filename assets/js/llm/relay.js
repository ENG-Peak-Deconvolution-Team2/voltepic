// VoltEPIC's report server: the site leaves each request in VoltEPIC's mailbox (worker/, a Cloudflare Worker); the project's
// lab PC (relay/server.mjs) collects it over outbound HTTPS, builds the message from the evidence file with the same code
// and prompts as the site (denetim.js, data/kimyager_istem.json), asks the AI-LAB model on the lab network and leaves the
// answer, which the site picks up. While the PC is off, the mailbox says so and the report is not available.

const SERVER = "https://voltepic-relay.voltepic.workers.dev";   // the mailbox's address; "" = off
const POLL = 3000;                                   // the site asks for its answer every 3 s; the mailbox drops a request unasked for 60 s

/** Measured on this report at xhigh (literature/xai_llm_rag/kimyager_raporu/yerel_llm_deney_sonuclari_2026-10-22.md):
 *  3.3–10.6 min a report, 3 of 7 Turkish outputs with a wrong claim on the inputs where Gemini 3.8 Flash had 0; in English
 *  (ingilizce_deney_sonuclari_2026-10-28.md, same inputs, one non-blind reader) 1 of 7, reports 2.5–5.5 min. */
export const MODEL = { id: "local-llm", label: "Lab LLM" };

const OFFLINE = "VoltEPIC's report server is offline right now: it runs on the project's lab PC. Try again later.";

/** Cloudflare Turnstile sitekey (public); the mailbox checks each request's token with its secret (TURNSTILE_SECRET). */
const LOCAL = ["127.0.0.1", "localhost"].includes(location.hostname);
const HUMAN = LOCAL ? "1x00000000000000000000AA"     // a local copy: Cloudflare's always-pass test key (the local mailbox's .dev.vars matches)
  : "0x4AAAAAAFpP1E7RG9x7e0iv";                       // widget "VoltEPIC", managed, eng-peak-deconvolution-team2.github.io
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
        callback: (token) => human.pending?.resolve(token), "error-callback": () => human.pending?.reject(new Error(HUMAN_FAIL)),
        "timeout-callback": () => human.pending?.reject(new Error("The human check was not completed; click Retry and tick the box.")) });
    } else turnstile.reset(human.id);
    human.pending = { resolve, reject };
    turnstile.execute(human.id);
  });
}

/** The mailbox's address ("" = none). A local copy of the site (127.0.0.1, localhost) can try a local mailbox with
 *  localStorage voltepic.relay; the published site ignores it, since any page on the same github.io origin could set it. */
export const server = () => { try { return (LOCAL && localStorage.getItem("voltepic.relay")) || SERVER; } catch { return SERVER; } };

const wait = (ms, signal) => new Promise((ok, no) => {
  const t = setTimeout(ok, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); no(signal.reason); }, { once: true });
});

/** One call to the mailbox → its JSON; its error message (complete, with what to do) or OFFLINE when it cannot be reached. */
async function call(path, init, signal) {
  let res;
  try { res = await fetch(`${server()}${path}`, { ...init, signal }); } catch (err) {
    if (err.name === "AbortError") throw err;
    throw Object.assign(new Error(OFFLINE), { net: true });
  }
  const body = await res.json().catch(() => ({}));
  if (body.error || !res.ok) throw new Error(body.error?.message || OFFLINE);
  return body;
}

/** The mailbox allows one chemist report an hour for the whole site; its session id lets this page add the rewrite and
 *  the follow-up questions within that hour. */
let session = null;

/** One call: the lab PC builds the message from the evidence file ("rapor" or "soru"), the report given, the question and
 *  the earlier attempts' check findings → { text, finishReason, modelVersion, usage, ms }. The request waits in the
 *  mailbox until the PC collects it; the site asks for the answer every 3 s, and leaving the page withdraws it. */
export async function generate({ kind, kanit, rapor, soru, onceki, signal }) {
  if (!server()) throw new Error(OFFLINE);
  const t0 = performance.now();
  const insan = await humanToken();
  const { id, session: s } = await call("/jobs", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, kanit, rapor, soru, onceki, insan, session }) }, signal);
  session = s ?? session;
  try {
    for (let misses = 0; ;) {
      await wait(POLL, signal);
      let j;
      try { j = await call(`/jobs/${id}`, {}, signal); misses = 0; } catch (err) {
        if (err.net && ++misses <= 5) continue;     // a dropped connection is retried for ~15 s
        throw err;
      }
      if (j.status === "done") return { text: j.text, finishReason: j.finishReason, modelVersion: j.model ?? MODEL.id, usage: j.usage ?? {}, ms: performance.now() - t0 };
      if (j.status === "error") throw new Error(j.error?.message || OFFLINE);
    }
  } catch (err) {
    if (err.name === "AbortError") fetch(`${server()}/jobs/${id}`, { method: "DELETE", keepalive: true }).catch(() => {});
    throw err;
  }
}
