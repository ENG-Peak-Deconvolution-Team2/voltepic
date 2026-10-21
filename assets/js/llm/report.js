// Chemist report: evidence file (code) → Gemini → code check; questions are answered from the same file.
// The pipeline of literature/xai_llm_rag/kimyager_raporu/rapor.py: code assigns each decision's basis label from the XAI
// tests and builds the evidence file; the LLM writes 3–5 plain Turkish sentences (or a 1–4 sentence answer); code checks
// the text with 8 rules and asks for one rewrite when it finds something.

import { degerlendir, kanitDosyasi, pyJson, chipOf, IDS } from "./kanit.js";
import { denetle, mesajRapor, mesajSoru, duzeltme, tekSatir } from "./denetim.js";
import { generate, generateShared, shared, getKey, getModel, MODELS } from "./gemini.js";
import { loadJson } from "../data.js";
import { esc } from "../ui.js";

const MAX_DENEME = 2;        // first text + one rewrite: the Gemini free tier allows 20 requests per model per day
const masked = (k) => `${k.slice(0, 4)}…${k.slice(-4)} · ${k.length} characters`;
const BASIS = { güçlü: "ok", yerinde: "ok", orta: "warn", zayıf: "err", şüpheli: "err", gösterilemedi: "" };

export const getKimyager = () => loadJson("kimyager");
const getIstem = () => loadJson("kimyager_istem");   // system prompts; a separate small file so the Worker can bundle it

/**
 * The evidence for the analysis on screen. Library curves: rapor.py's own explanation against the blank (data/kimyager.json).
 * Uploads: the browser's explanation against the uploaded blank (c.kim), which needs a blank and the coating.
 */
async function evidence(c) {
  const [K, istem] = await Promise.all([getKimyager(), getIstem()]);
  const s = c.sample;
  let ex, blank, nBlank, kaplama, chip, kaynak;
  if (s.source === "library") {
    const r = K.samples[s.index];
    ex = { p: c.result.probs, p_blank: r.p_blank, shap: r.shap, occ: r.occ };
    ({ blank } = r); nBlank = r.n_blank; kaplama = s.polymer; chip = s.chip; kaynak = K.library_source;
  } else {
    if (!c.kim) throw new Error("The chemist report compares the curve with its blank. Add the blank of the same electrode in 01 · Measurement first.");
    if (!s.polymer) throw new Error("Choose the electrode coating (PVDF or P4VP) in 01 · Measurement; the peak windows depend on it.");
    ex = { p: c.result.probs, p_blank: c.kim.p_blank, shap: c.kim.shap, occ: c.kim.occ };
    ({ blank, nBlank } = c.kim); kaplama = s.polymer; chip = chipOf(s.file); kaynak = "yüklenen eğri";
  }
  const kararlar = IDS.map((a) => degerlendir(a, ex, c.thresholds, kaplama, c.xai));
  const kanit = kanitDosyasi({ ex, x: Array.from(s.I), blank, kaplama, chip, nBlank, kararlar, thr: c.thresholds, xai: c.xai, K, kaynak });
  return { istem, kanit, kararlar, metin: pyJson(kanit) };
}

/** A conversation about one analysis; `turns` [{ q, a }] (q null = the report). A changed analysis starts a new one. */
export async function conversationFor(c, previous) {
  const ev = await evidence(c);
  const sig = ev.metin;
  return previous?.sig === sig ? previous : { ...ev, sig, turns: [], report: null };
}

/** One turn: the report (question null) or an answer, checked; one rewrite with the findings if the check finds something. */
export async function converse(conv, question, { model = getModel(), signal } = {}) {
  const key = getKey();
  if (!key && !shared()) throw new Error("No Gemini key saved.");
  const rapor = question == null;
  const kanitMetin = rapor ? conv.metin : pyJson({ ...conv.kanit, soru: question });
  const verilen = conv.report ?? "(henüz rapor yazılmadı)";
  let mesaj = rapor ? mesajRapor(kanitMetin) : mesajSoru(kanitMetin, verilen, question);
  const [nMin, nMax] = rapor ? [3, 5] : [1, 4];
  const ks = conv.kanit.kararlar.map((k) => ({ ad: k.analit, var: k.karar === "VAR" }));
  const onceki = [];
  let res, metin, bulgu, ms = 0, deneme = 0;
  for (deneme = 1; deneme <= MAX_DENEME; deneme++) {
    res = key
      ? await generate({ key, model, system: rapor ? conv.istem.rapor : conv.istem.soru, contents: [{ role: "user", parts: [{ text: mesaj }] }], signal })
      : await generateShared({ model, kind: rapor ? "rapor" : "soru", kanit: conv.kanit, rapor: verilen, soru: question, onceki, signal });
    ms += res.ms;
    metin = tekSatir(res.text);
    bulgu = denetle(metin, kanitMetin, ks, nMin, nMax);
    if (!bulgu.length || deneme === MAX_DENEME) break;
    onceki.push({ metin, bulgu });
    mesaj += duzeltme(metin, bulgu, nMax);
  }
  if (rapor) conv.report = metin;
  conv.turns.push({ q: question, a: metin });
  return { conv, question, text: metin, bulgu, deneme, mesaj, model, res: { ...res, text: metin, ms }, via: key ? "your key" : "VoltEPIC's shared access" };
}

export const label = (id) => MODELS.find((m) => m.id === id)?.label ?? id;

const meta = (out) => {
  const n = out.bulgu.length;
  return `<div class="llm-meta"><span class="badge">${esc(label(out.res.modelVersion))}</span><span class="mono">${(out.res.ms / 1000).toFixed(0)} s</span>`
    + `<span class="badge" data-tone="${n ? "warn" : "ok"}">${n ? `${n} check finding${n > 1 ? "s" : ""}` : "Check passed"}</span>`
    + (out.deneme > 1 ? `<span class="mono">${out.deneme} attempts</span>` : "") + `</div>`;
};
const findings = (out, open) => (out.bulgu.length
  ? `<details class="llm-check"${open ? " open" : ""}><summary>Code check: ${out.bulgu.length} finding${out.bulgu.length > 1 ? "s" : ""}</summary><ul lang="tr">`
    + out.bulgu.map((b) => `<li>${esc(b)}</li>`).join("") + `</ul><p>The check is code: sentence count and length, technical terms, record IDs, `
    + `numbers not in the evidence file, “peak is here” claims, contradicted decisions, scan-edge regions, first person. It does not judge meaning.</p></details>`
  : `<p class="llm-ok">Code check passed: sentence count, jargon, record IDs, numbers, “peak is here” claims, decisions, scan edges, first person.</p>`);

/** An answer bubble. */
export function answerHtml(out) {
  return `${meta(out)}<div class="llm-body" lang="tr"><p>${esc(out.text)}</p></div>${findings(out, false)}`;
}

/** The report bubble: text, basis labels, code check, the evidence file sent, actions. */
export function reportHtml(out) {
  const k = out.conv.kanit;
  const nRec = (out.conv.metin.match(/"id":/g) ?? []).length;
  const basis = `<div class="llm-basis">${k.kararlar.map((d) => `<span class="badge" data-tone="${BASIS[d.degerlendirme.dayanak]}" title="${esc(d.degerlendirme.neden)}">`
    + `${esc(d.kod)} ${d.karar === "VAR" ? "present" : "absent"} · ${esc(d.degerlendirme.dayanak)}</span>`).join("")}</div>`;
  const sent = `<details class="llm-facts"><summary>Evidence file sent to the model (${nRec} records)</summary><pre class="mono" lang="tr">${esc(out.conv.metin)}</pre></details>`;
  const actions = `<div class="llm-actions"><button type="button" class="btn btn-secondary btn-sm" data-act="copy">Copy</button>`
    + `<button type="button" class="btn btn-secondary btn-sm" data-act="download">Download .md</button>`
    + `<button type="button" class="btn btn-ghost btn-sm" data-act="settings">Gemini settings</button></div>`;
  return `${meta(out)}<div class="llm-body" lang="tr"><p>${esc(out.text)}</p></div>${basis}${findings(out, true)}${sent}${actions}`
    + `<p class="llm-foot">Written by ${esc(label(out.res.modelVersion))} via ${esc(out.via)} from the evidence file; the basis labels are set by code `
    + `from the XAI tests, not by the model. Research tool output — not for clinical or diagnostic decisions.</p>`;
}

/** Markdown file: report, basis labels, check, evidence file. */
export function reportMarkdown(out, title) {
  const k = out.conv.kanit;
  return [`# ${title}`, "", `Model: ${out.res.modelVersion} · ${out.deneme} attempt(s) · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, "",
    out.text, "", "## Basis labels (code)", "", ...k.kararlar.map((d) => `- ${d.analit}: ${d.karar} · ${d.degerlendirme.dayanak} — ${d.degerlendirme.neden}`), "",
    "## Code check", "", ...(out.bulgu.length ? out.bulgu.map((b) => `- ${b}`) : ["- no findings"]), "",
    "## Evidence file sent to the model", "", "```json", out.conv.metin, "```", ""].join("\n");
}

/** The key / model form. */
export function keyFormHtml(hasKey) {
  const sharedOn = !!shared();
  const opts = MODELS.map((m) => `<option value="${m.id}"${m.id === getModel() ? " selected" : ""}>${esc(m.label)}</option>`).join("");
  return `<form class="gem-form" autocomplete="off">
    <p><b>Chemist report, written by Gemini.</b> The analyzer builds an evidence file from this result: the four decisions, a basis
      label for each set by code from the XAI tests, the regions both explanations point to (against the blank), where the model
      generally looks, the expected peak windows and the peaks seen in the curve. Gemini writes 3–5 plain sentences in Turkish and
      answers follow-up questions from the same file; code checks every text and asks for one rewrite if it finds a problem.</p>
    ${sharedOn ? `<p class="gem-small">No key needed: without one, reports go through VoltEPIC's shared access (the project's key, a few reports a minute per visitor). With your own key they go straight from your browser to Google.</p>` : ""}
    <label>Gemini API key${sharedOn ? " (optional)" : ""}<input name="key" type="password" spellcheck="false" placeholder="${hasKey ? "saved — paste a new one to replace it" : sharedOn ? "leave empty to use the shared access" : "paste your key"}"${hasKey || sharedOn ? "" : " required"}></label>
    ${hasKey ? `<p class="gem-small">Saved in this browser: <span class="mono">${esc(masked(getKey()))}</span>. In AI Studio a key starts with AIza or AQ. and has about 39 or 53 characters.</p>` : ""}
    <label>Model<select name="model">${opts}</select></label>
    <p class="gem-small">Get a key at <a class="link" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.
      A key stays in this browser and is sent only to Google's Gemini API. The evidence file goes to Google either way (chip name
      included; never the raw curve, the blank curve or the file name). On the free tier Google may use what is sent to improve its
      models, and human reviewers may read it; it allows about 20 requests per model per day.</p>
    <div class="gem-row"><button class="btn btn-primary btn-sm" type="submit">${hasKey || sharedOn ? "Write the report" : "Save key and write the report"}</button>
      ${hasKey ? `<button class="btn btn-ghost btn-sm" type="button" data-act="forget">Forget key</button>` : ""}</div>
  </form>`;
}
