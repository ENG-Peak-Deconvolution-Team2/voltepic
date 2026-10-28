// Analysis assistant, two modes. Quick: answers composed by rules from the current analysis. Lab LLM: the chemist report
// and follow-up questions, written by the lab's model from the evidence file of this analysis and checked by code
// (assets/js/llm/), through VoltEPIC's report server on the project's lab PC.

import { esc, pct, conc, sleep, reducedMotion, fmtI, download, toast, segmented } from "./ui.js";
import { MODEL } from "./llm/relay.js";
import { conversationFor, converse, reportHtml, answerHtml, reportMarkdown } from "./llm/report.js";

const SUGGESTIONS = [
  { id: "report", text: "Write a chemist report (Lab LLM)" },
  { id: "detected", text: "Which analytes were detected?" },
  { id: "regions", text: "Which regions influenced the prediction?" },
  { id: "why", text: "Why was this analyte detected?" },
  { id: "confidence", text: "How confident is the model?" },
  { id: "pipeline", text: "How was the signal processed?" },
];

const INTENTS = [
  { id: "report", re: /report|rapor|llm|chemist/ },
  { id: "regions", re: /region|where|window|potential|volt|influenc|shade|mask/ },
  { id: "why", re: /\bwhy\b|reason|explain|because/ },
  { id: "confidence", re: /confiden|sure|certain|probab|threshold|reliab|accura|trust/ },
  { id: "pipeline", re: /process|pipeline|preprocess|denois|wavelet|feature|dwt|model|lightgbm|how does/ },
  { id: "truth", re: /correct|right|wrong|label|truth|actual/ },
  { id: "measurement", re: /measure|instrument|chip|electrode|polymer|swv|square|frequency|amplitude|noise|snr|quality/ },
  { id: "detected", re: /detect|found|present|which|what.*(analyte|in)|contain|result/ },
  { id: "hello", re: /^(hi|hello|hey|merhaba|selam)\b/ },
];

const TR_NAME = { AA: "Askorbik asit", "5HT": "Serotonin", "2E": "Estradiol", Mela: "Melatonin" };
const REPORT_ASK = /^\s*(kimyager\s+)?rapor(u)?\s+yaz|^\s*write\s+(a\s+)?(chemist\s+)?report/i;
const MODE = "voltepic.assistant.mode";
const remember = { get: () => { try { return localStorage.getItem(MODE); } catch { return null; } }, set: (v) => { try { localStorage.setItem(MODE, v); } catch { /* per page */ } } };

/** Build the assistant. `ctx()` returns the live analysis; `actions.explain()` runs occlusion. */
export function createAssistant({ log, suggest, form, input, ctx, actions, modeSeg, badge }) {
  let busy = false;
  let mode = remember.get() === "llm" ? "llm" : "quick";
  let conv = null;

  function bubble(role, html) {
    const el = document.createElement("div");
    el.className = `msg msg-${role}`;
    el.innerHTML = html;
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  async function stream(el, html) {
    if (reducedMotion()) { el.innerHTML = html; return; }
    const parts = html.split(/(<[^>]+>|\s+)/).filter(Boolean);
    el.innerHTML = "";
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      acc += parts[i];
      if (i % 3 === 0 || i === parts.length - 1) {
        el.innerHTML = acc;
        log.scrollTop = log.scrollHeight;
        await sleep(14);
      }
    }
  }

  function setMode(m, { announce = true } = {}) {
    const changed = m !== mode;
    mode = m;
    remember.set(m);
    modeSeg?.querySelectorAll("button[data-v]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === m)));
    if (badge) { badge.textContent = m === "llm" ? MODEL.label : "Scripted"; badge.dataset.tone = m === "llm" ? "ok" : "warn"; }
    input.placeholder = m === "llm" ? "Lab LLM'e sor — cevap Türkçe, kanıt dosyasından" : "Ask about this analysis";
    if (changed && announce) bubble("bot", m === "llm" ? llmIntro() : `Quick mode: scripted answers from the numbers of this analysis.`);
    renderSuggestions();
  }

  const llmIntro = () => `Lab LLM mode: ask for the <b>chemist report</b>, then ask follow-up questions. Answers are in Turkish, built only from `
    + `this analysis's evidence file (decisions, basis labels, regions against the blank, peak windows), and code checks every text. `
    + `A report takes about 3–11 minutes. The evidence file (chip name included; never the raw curve, the blank curve or the file name) `
    + `waits in VoltEPIC's mailbox on Cloudflare until the report server on the project's lab PC collects it and asks the AI-LAB `
    + `model on the lab network; keep this page open until the answer arrives. `
    + `Before each request, Cloudflare Turnstile checks that a person is asking; it may show a box to click.`;

  async function ask(question, intent) {
    if (busy || !question.trim()) return;
    const id = intent || (mode === "quick" ? INTENTS.find((x) => x.re.test(question.toLowerCase()))?.id : REPORT_ASK.test(question) ? "report" : "llm");
    busy = true;
    bubble("user", esc(question));
    if (id === "report" || id === "llm") {
      if (mode !== "llm") setMode("llm", { announce: false });
      await llmTurn(id === "report" ? null : question.trim());
      busy = false;
      renderSuggestions();
      return;
    }
    const el = bubble("bot", `<span class="typing"><i></i><i></i><i></i></span>`);
    await sleep(420 + Math.random() * 300);
    const html = await respond(question, id);
    await stream(el, html);
    busy = false;
    renderSuggestions();
  }

  async function respond(question, intent) {
    const c = ctx();
    if (!c.result) {
      if (intent === "pipeline") return answers.pipeline(c);
      return `No analysis yet. Pick a sample from the library or upload a file, then press <b>Analyze</b> — I answer from the numbers the model produces.`;
    }
    if ((intent === "regions" || intent === "why") && !c.occ) await actions.explain();
    const fn = answers[intent];
    if (fn) return fn(ctx(), question);
    return `My quick answers are scripted, so they only cover the current result: detections, confidence, influential regions, preprocessing and the measurement. For a written explanation or a free question, switch to <b>Lab LLM</b> above. Try one of the suggestions below.`;
  }

  /** One Lab LLM turn — the report (question null) or an answer — in one bot bubble. */
  async function llmTurn(question) {
    const c = ctx();
    if (!c.result) { bubble("bot", `No analysis yet. Pick a sample from the library or upload a file first.`); return; }
    let next;
    try { next = await conversationFor(c, conv); } catch (err) { bubble("bot", esc(err.message)); return; }
    if (conv && next !== conv && conv.turns.length) bubble("bot", `The analysis changed, so the Lab LLM starts a new conversation from its evidence file.`);
    conv = next;
    const doing = question == null ? "is writing the report" : "is answering";
    const el = bubble("bot msg-report", `<span class="typing"><i></i><i></i><i></i></span> <span class="llm-status">${esc(MODEL.label)} ${doing}…</span>`);
    const t0 = performance.now();
    const tick = setInterval(() => { const s = el.querySelector(".llm-status"); if (s) s.textContent = `${MODEL.label} ${doing}… ${((performance.now() - t0) / 1000).toFixed(0)} s`; }, 1000);
    try {
      const out = await converse(conv, question);
      el.innerHTML = question == null ? reportHtml(out) : answerHtml(out);
      el.addEventListener("click", (ev) => {
        const act = ev.target.closest("button[data-act]")?.dataset.act;
        if (act === "copy") navigator.clipboard.writeText(out.res.text).then(() => toast("Report copied.", "info"), () => toast("Copy was blocked by the browser.", "error"));
        if (act === "download") download(`voltepic_report_${c.sample.source === "library" ? `s${c.sample.index}` : "upload"}.md`, reportMarkdown(out, `VoltEPIC report — ${c.sample.title ?? c.sample.file ?? "curve"}`), "text/markdown");
      });
    } catch (err) {
      el.innerHTML = `${esc(err.message)} <button type="button" class="btn btn-ghost btn-sm" data-act="retry">Retry</button>`;
      el.querySelector("[data-act=retry]").onclick = async (ev) => {
        if (busy) return;
        ev.target.disabled = true;
        busy = true;
        await llmTurn(question);
        busy = false;
        renderSuggestions();
      };
    } finally {
      clearInterval(tick);
      log.scrollTop = log.scrollHeight;
    }
  }

  /** Lab LLM-mode chips: the report first, then questions shaped by the current result (asked in Turkish). */
  function llmSuggestions(c) {
    const out = [{ id: "report", text: conv?.turns.some((t) => t.q == null) ? "Raporu yeniden yaz" : "Kimyager raporu yaz" }];
    if (!c.result) return out;
    const top = topAnalyte(c);
    const name = TR_NAME[c.analytes[top].id] ?? c.analytes[top].name;
    out.push({ id: "llm", text: `${name} ${c.result.detected[top] ? "VAR" : "YOK"} kararı neye dayanıyor?` });
    const near = c.result.probs.findIndex((p, k) => Math.abs(p - c.thresholds[k]) <= 0.3);
    if (near >= 0) out.push({ id: "llm", text: `${TR_NAME[c.analytes[near].id]} kararı eşiğe yakın; nasıl okumalıyım?` });
    out.push({ id: "llm", text: "Eğrinin ucundaki katkılar ne anlama geliyor?" });
    out.push({ id: "llm", text: "Bu açıklamaya ne kadar güvenebilirim?" });
    out.push({ id: "llm", text: "Bu sonucu laboratuvarda nasıl doğrularım?" });
    return out;
  }

  function renderSuggestions() {
    const c = ctx();
    const top = c.result ? topAnalyte(c) : null;
    const list = mode === "llm" ? llmSuggestions(c) : SUGGESTIONS;
    suggest.replaceChildren(...list.map((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = mode === "quick" && s.id === "why" && top != null ? `Why was ${c.analytes[top].name.toLowerCase()} ${c.result.detected[top] ? "detected" : "not detected"}?` : s.text;
      b.onclick = () => ask(b.textContent, s.id);
      return b;
    }));
  }

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const q = input.value;
    input.value = "";
    ask(q);
  });
  if (modeSeg) segmented(modeSeg, (v) => setMode(v));

  return {
    ask,
    renderSuggestions,
    reset() {
      log.replaceChildren();
      conv = null;
      bubble("bot", mode === "llm" ? llmIntro()
        : `Hi — I read the current analysis and answer from its numbers. These quick answers are scripted; switch to <b>Lab LLM</b> above for the chemist report and free questions.`);
      setMode(mode, { announce: false });
    },
    notify(html) { bubble("bot", html); },
  };
}

const code = (a) => (a.id === "5HT" ? "5-HT" : a.id);

const topAnalyte = (c) => {
  const det = c.result.probs.map((p, k) => [p, k]).filter(([, k]) => c.result.detected[k]);
  const pool = det.length ? det : c.result.probs.map((p, k) => [p, k]);
  return pool.sort((a, b) => b[0] - a[0])[0][1];
};

/** ", inside the E3 peak window" when the window centre lies in the analyte's PVDF peak window. */
const peakNote = (c, k, u) => {
  const win = c.peakWindow?.(k);
  if (!win) return "";
  const centre = (c.E[u.i0] + c.E[u.i1 - 1]) / 2;
  return centre >= win.lo && centre <= win.hi ? ", inside its E3 peak window" : `, outside its E3 peak window (${win.lo.toFixed(2)}–${win.hi.toFixed(2)} V)`;
};

const names = (c, ks) => ks.map((k) => `<b>${esc(c.analytes[k].name)}</b>`).join(ks.length > 2 ? ", " : " and ").replace(/, ([^,]*)$/, " and $1");
const range = (c, u) => `${(c.E[u.i0] - 0.002).toFixed(2)}–${(c.E[u.i1 - 1] + 0.002).toFixed(2)} V`;

const answers = {
  hello: () => `Hello! Ask me what was detected, how sure the model is, or which part of the curve drove the result.`,

  detected(c) {
    const { probs, detected } = c.result;
    const yes = probs.map((_, k) => k).filter((k) => detected[k]);
    const no = probs.map((_, k) => k).filter((k) => !detected[k]);
    if (!yes.length) return `No analyte crossed its threshold. The highest probability is ${esc(c.analytes[topAnalyte(c)].name)} at <span class="mono">${pct(Math.max(...probs), 1)}</span>.`;
    const weakest = yes.reduce((a, b) => (probs[a] < probs[b] ? a : b));
    let s = `${names(c, yes)} ${yes.length > 1 ? "were" : "was"} detected`;
    s += no.length ? `; ${names(c, no)} ${no.length > 1 ? "were" : "was"} not.` : ".";
    if (yes.length > 1) s += ` The least certain detection is ${esc(c.analytes[weakest].name)} at <span class="mono">${pct(probs[weakest], 1)}</span>.`;
    return s;
  },

  regions(c) {
    const lines = [];
    const shap = c.occ.method === "shap";
    const ks = c.result.detected.some(Boolean) ? c.result.detected.map((d, k) => (d ? k : -1)).filter((k) => k >= 0) : [topAnalyte(c)];
    for (const k of ks) {
      const best = [...c.occ.units].sort((a, b) => b.dlogit[k] - a.dlogit[k])[0];
      const effect = shap ? `adds <span class="mono">+${best.dlogit[k].toFixed(1)}</span> log-odds` : `masking it lowers the log-odds by <span class="mono">${best.dlogit[k].toFixed(1)}</span>`;
      lines.push(`${esc(c.analytes[k].name)}: <b>${range(c, best)}</b> (${effect}${peakNote(c, k, best)})`);
    }
    const how = shap ? `SHAP from the XAI run (blank reference), ${c.widthMv} mV windows` : `masking each ${c.widthMv} mV window in turn`;
    return `The most influential windows, by ${how}:<br>${lines.join("<br>")}<br>They are shaded on the graph; the Explain step shows the full map.`;
  },

  why(c, question) {
    const k = c.analytes.findIndex((a) => question.toLowerCase().includes(a.name.toLowerCase()) || question.toLowerCase().includes(a.id.toLowerCase()));
    const a = k >= 0 ? k : topAnalyte(c);
    const p = c.result.probs[a];
    const sorted = [...c.occ.units].sort((x, y) => y.dlogit[a] - x.dlogit[a]);
    const best = sorted[0];
    const strong = sorted.filter((u) => u.dlogit[a] > 1).length;
    const verb = c.result.detected[a] ? "detected" : "not detected";
    let s = `${esc(c.analytes[a].name)} was ${verb} with P = <span class="mono">${p.toFixed(3)}</span> (threshold <span class="mono">${c.thresholds[a].toFixed(2)}</span>). `;
    if (c.occ.method === "shap") {
      if (best.dlogit[a] > 0.5) s += `Compared with its blank, the evidence comes mainly from <b>${range(c, best)}</b>, which adds <span class="mono">+${best.dlogit[a].toFixed(1)}</span> log-odds${peakNote(c, a, best)}.`;
      else s += `No window adds more than 0.5 log-odds against the blank.`;
      return s;
    }
    if (best.dlogit[a] > 1) s += `The evidence sits mainly in <b>${range(c, best)}</b>: masking that window lowers the log-odds by <span class="mono">${best.dlogit[a].toFixed(1)}</span> (P → <span class="mono">${(p - best.dp[a]).toFixed(3)}</span>)${peakNote(c, a, best)}.`;
    else s += `No single window lowers the log-odds by more than 1, so the decision draws on the curve as a whole rather than one peak.`;
    if (strong > 1) s += ` ${strong} windows each lower the log-odds by more than 1.`;
    return s;
  },

  confidence(c) {
    const { probs, margins } = c.result;
    const close = probs.map((p, k) => [Math.abs(p - c.thresholds[k]), k]).sort((a, b) => a[0] - b[0])[0];
    let s = `Probabilities: ${probs.map((p, k) => `${esc(code(c.analytes[k]))} <span class="mono">${pct(p, 1)}</span>`).join(" · ")}. `;
    s += close[0] > 0.3
      ? `Every call is far from its threshold; the nearest, ${esc(c.analytes[close[1]].name)}, sits <span class="mono">${close[0].toFixed(2)}</span> away (log-odds <span class="mono">${margins[close[1]].toFixed(1)}</span>). `
      : `The closest call is ${esc(c.analytes[close[1]].name)}, only <span class="mono">${close[0].toFixed(2)}</span> from its threshold (log-odds <span class="mono">${margins[close[1]].toFixed(2)}</span>) — treat it with care. `;
    if (c.bench) s += `On the 125 held-out library curves this model scores ${c.bench.map((b, k) => `${esc(code(c.analytes[k]))} <span class="mono">${pct(b.acc, 1)}</span>`).join(", ")} accuracy.`;
    return s;
  },

  pipeline(c) {
    let s = `The raw curve (200 points, 0.004–0.800 V) is denoised with a 3-level <b>sym4</b> wavelet soft threshold, then decomposed with a 6-level <b>rbio1.3</b> DWT into 228 coefficients. These are standardised and read by four independent <b>LightGBM</b> classifiers (300 trees each), one per analyte.`;
    if (c.result) s += ` For this curve the noise estimate was σ = <span class="mono">${fmtI(c.result.sigma)}</span> and the threshold λ = <span class="mono">${fmtI(c.result.lambda)}</span>.`;
    return s;
  },

  truth(c) {
    if (!c.labels) return `This curve was uploaded, so there is no label to compare with.`;
    const wrong = c.labels.map((v, k) => (v > 0) !== c.result.detected[k] ? k : -1).filter((k) => k >= 0);
    const comp = c.labels.map((v, k) => (v > 0 ? `${esc(code(c.analytes[k]))} ${conc(v)}` : null)).filter(Boolean).join(", ");
    if (!wrong.length) return `All four calls match the label (${comp}).`;
    return `The label is ${comp}. The model disagrees on ${names(c, wrong)}.`;
  },

  measurement(c) {
    const q = c.qc;
    const peaks = q.peaks.length ? `Peaks on the denoised trace: ${q.peaks.map((p) => `<span class="mono">${c.E[p.index].toFixed(3)} V</span>`).join(", ")}; the main one stands <span class="mono">${fmtI(q.mainProm)}</span> above its surroundings.` : "No clear interior peak was found.";
    return `Square-wave voltammetry, 0.004–0.800 V in 4 mV steps. ${peaks} The wavelet noise estimate is <span class="mono">${fmtI(q.sigma)}</span>, so the main feature is about <span class="mono">${q.snr.toFixed(0)}×</span> the noise.`;
  },
};
