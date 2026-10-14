// Demo analysis assistant. Answers are composed by rules from the current analysis; the
// `respond` function is the seam where an LLM call will replace the rules later.

import { esc, pct, conc, sleep, reducedMotion, fmtI } from "./ui.js";

const SUGGESTIONS = [
  { id: "detected", text: "Which analytes were detected?" },
  { id: "regions", text: "Which regions influenced the prediction?" },
  { id: "why", text: "Why was this analyte detected?" },
  { id: "confidence", text: "How confident is the model?" },
  { id: "pipeline", text: "How was the signal processed?" },
];

const INTENTS = [
  { id: "regions", re: /region|where|window|potential|volt|influenc|shade|mask/ },
  { id: "why", re: /\bwhy\b|reason|explain|because/ },
  { id: "confidence", re: /confiden|sure|certain|probab|threshold|reliab|accura|trust/ },
  { id: "pipeline", re: /process|pipeline|preprocess|denois|wavelet|feature|dwt|model|lightgbm|how does/ },
  { id: "truth", re: /correct|right|wrong|label|truth|actual/ },
  { id: "measurement", re: /measure|instrument|chip|electrode|polymer|swv|square|frequency|amplitude|noise|snr|quality/ },
  { id: "detected", re: /detect|found|present|which|what.*(analyte|in)|contain|result/ },
  { id: "hello", re: /^(hi|hello|hey|merhaba|selam)\b/ },
];

/** Build the assistant. `ctx()` returns the live analysis; `actions.explain()` runs occlusion. */
export function createAssistant({ log, suggest, form, input, ctx, actions }) {
  let busy = false;

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

  async function ask(question, intent) {
    if (busy || !question.trim()) return;
    busy = true;
    bubble("user", esc(question));
    const el = bubble("bot", `<span class="typing"><i></i><i></i><i></i></span>`);
    await sleep(420 + Math.random() * 300);
    const html = await respond(question, intent);
    await stream(el, html);
    busy = false;
    renderSuggestions();
  }

  async function respond(question, intent) {
    const c = ctx();
    const id = intent || INTENTS.find((x) => x.re.test(question.toLowerCase()))?.id;
    if (!c.result) {
      if (id === "pipeline") return answers.pipeline(c);
      return `No analysis yet. Pick a sample from the library or upload a file, then press <b>Analyze</b> — I answer from the numbers the model produces.`;
    }
    if ((id === "regions" || id === "why") && !c.occ) await actions.explain();
    const fn = answers[id];
    if (fn) return fn(ctx(), question);
    return `I am a scripted demo, so I only cover the current result: detections, confidence, influential regions, preprocessing and the measurement. A language model will take over this panel later. Try one of the suggestions below.`;
  }

  function renderSuggestions() {
    const c = ctx();
    const top = c.result ? topAnalyte(c) : null;
    suggest.replaceChildren(...SUGGESTIONS.map((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = s.id === "why" && top != null ? `Why was ${c.analytes[top].name.toLowerCase()} ${c.result.detected[top] ? "detected" : "not detected"}?` : s.text;
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

  return {
    ask,
    renderSuggestions,
    reset() {
      log.replaceChildren();
      bubble("bot", `Hi — I read the current analysis and answer from its numbers. <span class="mono">Demo:</span> replies are scripted; an LLM will be connected here later.`);
      renderSuggestions();
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
    const ks = c.result.detected.some(Boolean) ? c.result.detected.map((d, k) => (d ? k : -1)).filter((k) => k >= 0) : [topAnalyte(c)];
    for (const k of ks) {
      const best = [...c.occ.units].sort((a, b) => b.dlogit[k] - a.dlogit[k])[0];
      lines.push(`${esc(c.analytes[k].name)}: <b>${range(c, best)}</b> (masking it lowers the log-odds by <span class="mono">${best.dlogit[k].toFixed(1)}</span>)`);
    }
    return `The most influential windows, found by masking each ${c.widthMv} mV window in turn:<br>${lines.join("<br>")}<br>They are shaded on the graph; the Explain step shows the full map.`;
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
    if (best.dlogit[a] > 1) s += `The evidence sits mainly in <b>${range(c, best)}</b>: replacing that window by a straight line lowers the log-odds by <span class="mono">${best.dlogit[a].toFixed(1)}</span> (P → <span class="mono">${(p - best.dp[a]).toFixed(3)}</span>).`;
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
