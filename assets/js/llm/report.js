// Chemist report: packet (code) → prompt (code + fixed cards) → Gemini → check against the packet (code).
// The LLM only writes prose from numbered facts; ordering, signs, peak windows and the curve-end flag are computed here.

import { buildPacket, assemblePrompt, buildContents } from "./packet.js";
import { verify } from "./verify.js";
import { generate, generateShared, shared, getKey, getModel, MODELS } from "./gemini.js";
import { renderReport } from "./render.js";
import { loadJson } from "../data.js";
import { esc } from "../ui.js";

/** "AQ.A…Xslg · 53 characters": enough to compare with AI Studio, not enough to use. */
const masked = (k) => `${k.slice(0, 4)}…${k.slice(-4)} · ${k.length} characters`;

export const getLlm = () => loadJson("llm");

const KIND = {
  uncited: "No fact cited",
  unknown: "Cites a fact that is not in the packet",
  number: "Number not found in the cited facts or cards",
  edge: "Curve-end region presented as a peak",
  decision: "Contradicts the model's decision",
};

/** The packet for the analysis on screen: SHAP (library, blank reference) or browser occlusion (uploads). */
export function packetFor(c) {
  if (!c.xai) throw new Error("The XAI results (data/xai.json) are not loaded, so the method-reliability fact cannot be stated.");
  return buildPacket({
    sample: c.sample, probs: c.result.probs, analytes: c.analytes, thresholds: c.thresholds, grid: c.grid,
    acquisition: c.sample.source === "library" ? c.acquisition : null, xai: c.xai,
    src: { kind: c.occ.method === "shap" ? "shap" : "occlusion", rows: c.occ.units.map((u) => u.dlogit), unit: `${c.widthMv}mV`, width: c.width, fill: c.fill },
  });
}

/** A Gemini conversation about one analysis: every turn reads the same packet. `sig` tells when the analysis changed. */
export function conversationFor(c, previous) {
  const packet = packetFor(c);
  const sig = JSON.stringify([packet.facts, packet.values.detection.map((d) => d.probability)]);
  return previous?.sig === sig ? previous : { packet, sig, turns: [] };
}

/** One turn: the report (question null) or an answer; checked against the packet, then kept as context. */
export async function converse(conv, question, { model = getModel(), signal } = {}) {
  const llm = await getLlm();
  const prompt = assemblePrompt(conv.packet, llm.cards);
  const key = getKey();
  if (!key && !shared()) throw new Error("No Gemini key saved.");
  const res = key
    ? await generate({ key, model, system: llm.system, contents: buildContents(conv.packet, llm.cards, conv.turns, question), signal })
    : await generateShared({ model, packet: conv.packet, turns: conv.turns, question, signal });
  const check = verify({ facts: conv.packet.facts, detection: conv.packet.values.detection }, prompt, res.text);
  conv.turns.push({ q: question, a: res.text });
  return { packet: conv.packet, prompt, res, check, model, question, promptVersion: llm.prompt_version, via: key ? "your key" : "VoltEPIC's shared access" };
}

/** An answer bubble: meta line, the answer, and the check (open only when it found something). */
export function answerHtml(out) {
  const facts = Object.fromEntries(out.packet.facts.map((f) => [f.id, f]));
  const n = out.check.issues.length;
  return `<div class="llm-meta"><span class="badge">${esc(label(out.res.modelVersion))}</span><span class="mono">${(out.res.ms / 1000).toFixed(0)} s</span>`
    + `<span class="badge" data-tone="${n ? "warn" : "ok"}">${n ? `${n} check finding${n > 1 ? "s" : ""}` : "Check passed"}</span></div>`
    + `<div class="llm-body" lang="tr">${renderReport(out.res.text, facts)}</div>`
    + (n ? `<details class="llm-check"><summary>${n} sentence${n > 1 ? "s" : ""} not backed by the facts</summary><ul>`
      + out.check.issues.map((x) => `<li><b>${esc(KIND[x.kind])}</b> <q lang="tr">${esc(x.sentence.length > 160 ? x.sentence.slice(0, 160) + "…" : x.sentence)}</q></li>`).join("")
      + `</ul></details>` : "");
}

export const label = (id) => MODELS.find((m) => m.id === id)?.label ?? id;

/** The report bubble. */
export function reportHtml(out) {
  const facts = Object.fromEntries(out.packet.facts.map((f) => [f.id, f]));
  const n = out.check.issues.length;
  const secs = (out.res.ms / 1000).toFixed(0);
  const meta = `<div class="llm-meta"><span class="badge">${esc(label(out.res.modelVersion))}</span><span class="mono">${secs} s</span>`
    + `<span class="badge" data-tone="${n ? "warn" : "ok"}">${n ? `${n} check finding${n > 1 ? "s" : ""}` : "Check passed"}</span></div>`;
  const issues = n ? `<details class="llm-check" open><summary>Checked against the packet: ${out.check.checked} sentences, ${n} finding${n > 1 ? "s" : ""}</summary><ul>`
    + out.check.issues.map((x) => `<li><b>${esc(KIND[x.kind])}</b> <q lang="tr">${esc(x.sentence.length > 160 ? x.sentence.slice(0, 160) + "…" : x.sentence)}</q></li>`).join("")
    + `</ul><p>The check is code, not a model: citations, numbers, decisions and the curve-end flag. It does not judge meaning.</p></details>`
    : `<p class="llm-ok">Checked against the packet: ${out.check.checked} sentences — citations, numbers, decisions and the curve-end flag all match.</p>`;
  const sent = `<details class="llm-facts"><summary>Facts sent to the model (${out.packet.facts.length})</summary><ol lang="tr">`
    + out.packet.facts.map((f) => `<li><span class="mono">${f.id}</span> ${esc(f.text)}</li>`).join("") + `</ol></details>`;
  const actions = `<div class="llm-actions"><button type="button" class="btn btn-secondary btn-sm" data-act="copy">Copy</button>`
    + `<button type="button" class="btn btn-secondary btn-sm" data-act="download">Download .md</button>`
    + `<button type="button" class="btn btn-ghost btn-sm" data-act="settings">Gemini settings</button></div>`;
  return `${meta}<div class="llm-body" lang="tr">${renderReport(out.res.text, facts)}</div>${issues}${sent}${actions}`
    + `<p class="llm-foot">Written by ${esc(label(out.res.modelVersion))} via ${esc(out.via)} from the numbered facts (prompt v${esc(out.promptVersion)}); `
    + `the model only rephrases them. Research tool output — not for clinical or diagnostic decisions.</p>`;
}

/** Markdown file: report + check + facts, for the download button. */
export function reportMarkdown(out, title) {
  const lines = [`# ${title}`, "", `Model: ${out.res.modelVersion} · prompt v${out.promptVersion} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, "",
    out.res.text, "", "## Check against the packet", "",
    out.check.issues.length ? out.check.issues.map((x) => `- ${KIND[x.kind]}: ${x.sentence}`).join("\n") : `- ${out.check.checked} sentences, no findings`, "",
    "## Facts sent to the model", "", ...out.packet.facts.map((f) => `- ${f.id} ${f.text}`), ""];
  return lines.join("\n");
}

/** The key / model form. */
export function keyFormHtml(hasKey) {
  const sharedOn = !!shared();
  const opts = MODELS.map((m) => `<option value="${m.id}"${m.id === getModel() ? " selected" : ""}>${esc(m.label)}</option>`).join("");
  return `<form class="gem-form" autocomplete="off">
    <p><b>Chemist report, written by Gemini.</b> The analyzer computes numbered facts from this result — decisions, thresholds,
      the most influential regions, peak windows and the method's test record — and Gemini turns them into a report in Turkish,
      citing a fact for every sentence. Each sentence is then checked against the facts in your browser.</p>
    ${sharedOn ? `<p class="gem-small">No key needed: without one, reports go through VoltEPIC's shared access (the project's key, a few reports a minute per visitor). With your own key they go straight from your browser to Google.</p>` : ""}
    <label>Gemini API key${sharedOn ? " (optional)" : ""}<input name="key" type="password" spellcheck="false" placeholder="${hasKey ? "saved — paste a new one to replace it" : sharedOn ? "leave empty to use the shared access" : "paste your key"}"${hasKey || sharedOn ? "" : " required"}></label>
    ${hasKey ? `<p class="gem-small">Saved in this browser: <span class="mono">${esc(masked(getKey()))}</span>. In AI Studio a key starts with AIza or AQ. and has about 39 or 53 characters.</p>` : ""}
    <label>Model<select name="model">${opts}</select></label>
    <p class="gem-small">Get a key at <a class="link" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.
      A key stays in this browser and is sent only to Google's Gemini API. The facts go to Google either way, directly or through
      the shared access (for library curves also chip, date and channel; never the raw curve or the file name). On the free tier
      Google may use what is sent to improve its models, and human reviewers may read it.</p>
    <div class="gem-row"><button class="btn btn-primary btn-sm" type="submit">${hasKey || sharedOn ? "Write the report" : "Save key and write the report"}</button>
      ${hasKey ? `<button class="btn btn-ghost btn-sm" type="button" data-act="forget">Forget key</button>` : ""}</div>
  </form>`;
}
