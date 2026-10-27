// Chemist report: evidence file (code) → Lab LLM (VoltEPIC's report server, relay.js) → code check; questions are answered
// from the same file.
// The pipeline of literature/xai_llm_rag/kimyager_raporu/rapor.py: code assigns each decision's basis label from the XAI
// tests and builds the evidence file; the LLM writes 3–5 plain Turkish sentences (or a 1–4 sentence answer); code checks
// the text with 8 rules and asks for one rewrite when it finds something.

import { degerlendir, kanitDosyasi, pyJson, chipOf, IDS } from "./kanit.js";
import { denetle, mesajRapor, mesajSoru, duzeltme, tekSatir } from "./denetim.js";
import { generate, MODEL } from "./relay.js";
import { loadJson } from "../data.js";
import { esc } from "../ui.js";

const MAX_DENEME = 2;        // first text + one rewrite, as in the measured runs (rapor.py --deneme 2)
const BASIS = { güçlü: "ok", yerinde: "ok", orta: "warn", zayıf: "err", şüpheli: "err", gösterilemedi: "" };

export const getKimyager = () => loadJson("kimyager");

/**
 * The evidence for the analysis on screen. Library curves: rapor.py's own explanation against the blank (data/kimyager.json).
 * Uploads: the browser's explanation against the uploaded blank (c.kim), which needs a blank and the coating.
 */
async function evidence(c) {
  const K = await getKimyager();
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
  return { kanit, kararlar, metin: pyJson(kanit) };
}

/** A conversation about one analysis; `turns` [{ q, a }] (q null = the report). A changed analysis starts a new one. */
export async function conversationFor(c, previous) {
  const ev = await evidence(c);
  const sig = ev.metin;
  return previous?.sig === sig ? previous : { ...ev, sig, turns: [], report: null };
}

/** One turn: the report (question null) or an answer, checked; one rewrite with the findings if the check finds something. */
export async function converse(conv, question, { signal } = {}) {
  const rapor = question == null;
  const kanitMetin = rapor ? conv.metin : pyJson({ ...conv.kanit, soru: question });
  const verilen = conv.report ?? "(henüz rapor yazılmadı)";
  let mesaj = rapor ? mesajRapor(kanitMetin) : mesajSoru(kanitMetin, verilen, question);
  const [nMin, nMax] = rapor ? [3, 5] : [1, 4];
  const ks = conv.kanit.kararlar.map((k) => ({ ad: k.analit, var: k.karar === "VAR" }));
  const onceki = [];
  let res, metin, bulgu, ms = 0, deneme = 0;
  for (deneme = 1; deneme <= MAX_DENEME; deneme++) {
    res = await generate({ kind: rapor ? "rapor" : "soru", kanit: conv.kanit, rapor: verilen, soru: question, onceki, signal });
    ms += res.ms;
    metin = tekSatir(res.text);
    bulgu = denetle(metin, kanitMetin, ks, nMin, nMax);
    if (!bulgu.length || deneme === MAX_DENEME) break;
    onceki.push({ metin, bulgu });
    mesaj += duzeltme(metin, bulgu, nMax);
  }
  if (rapor) conv.report = metin;
  conv.turns.push({ q: question, a: metin });
  return { conv, question, text: metin, bulgu, deneme, mesaj, res: { ...res, text: metin, ms } };
}

const meta = (out) => {
  const n = out.bulgu.length;
  return `<div class="llm-meta"><span class="badge">${esc(MODEL.label)}</span><span class="mono">${(out.res.ms / 1000).toFixed(0)} s</span>`
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
    + `<button type="button" class="btn btn-secondary btn-sm" data-act="download">Download .md</button></div>`;
  return `${meta(out)}<div class="llm-body" lang="tr"><p>${esc(out.text)}</p></div>${basis}${findings(out, true)}${sent}${actions}`
    + `<p class="llm-foot">Written by the Lab LLM (AI-LAB's model on the lab network, through VoltEPIC's report server) from the evidence file; the basis labels are set by code `
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
