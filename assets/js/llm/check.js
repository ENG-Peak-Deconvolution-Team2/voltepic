// Code check of an English LLM text against its English evidence file (evidence_en.js), and the messages sent to the LLM.
// The same 8 rules as denetim.js (the port of rapor.py's Turkish check), written for English: sentence count and length,
// technical terms, record IDs, numbers not in the evidence file, first person, "peak is here" claims, contradicted
// decisions, scan-edge ranges presented as evidence. tools/check_en_test.mjs exercises each rule.

const TERMS = [["shap", /\bshap\b/], ["shapley", /\bshapley/], ["occlusion", /\bocclu/], ["probability", /\bprobabilit/],
  ["threshold", /\bthreshold/], ["log-odds", /\blog-odds/], ["logit", /\blogit/], ["coefficient", /\bcoefficient/],
  ["wavelet", /\bwavelet/], ["pfi", /\bpfi\b/], ["lightgbm", /\blightgbm/], ["permutation", /\bpermutation/],
  ["reference", /\breference/], ["feature", /\bfeature/], ["algorithm", /\balgorithm/], ["score", /\bscor(e|es|ed|ing)\b/],
  ["sage", /\bsage\b/], ["spearman", /\bspearman/], ["slice", /\bslice/]];
const FIRST = /\b(i|i'm|i've|i'd|i'll|me|my|mine|we|we're|we've|we'd|we'll|us|our|ours)\b/g;
const ANALYTES = "ascorbic acid|serotonin|estradiol|melatonin";

/** Sentences: split after . ! ? before a capital, digit, quote or parenthesis (a decimal point has no space after it). */
export const sentences = (t) => t.trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/u).filter(Boolean);
const words = (s) => s.trim().split(/\s+/u).filter(Boolean);

/** Findings for one text. decisions: [{ name, present }] from the evidence file. */
export function check(text, evidence, decisions, nMin = 3, nMax = 5) {
  const out = [];
  const ss = sentences(text);
  if (!(nMin <= ss.length && ss.length <= nMax)) out.push(`${ss.length} sentences; should be ${nMin}–${nMax}`);
  for (const s of ss) if (words(s).length > 40) out.push(`long sentence (${words(s).length} words)`);
  const low = text.toLowerCase();
  for (const [w, re] of TERMS) if (re.test(low)) out.push(`technical term: '${w}'`);
  for (const m of text.matchAll(/\b[DECGK]\d\d\b/g)) out.push(`record ID: ${m[0]}`);
  const known = new Set(evidence.match(/\d+(?:\.\d+)?/g) ?? []);
  for (const x of text.match(/\d+(?:[.,]\d+)?/g) ?? []) if (!known.has(x.replace(",", "."))) out.push(`number not in the evidence file: ${x}`);
  for (const m of low.matchAll(FIRST)) out.push(`first person: '${m[0]}'`);
  if (new RegExp(`\\b(?:(?:${ANALYTES}|its|their)(?:'s)?\\s+peak\\b(?!\\s+(?:range|region|window|area))|peak\\s+of\\s+(?:${ANALYTES})\\b)`).test(low)) {
    out.push("'peak' claim: the place looked at is presented as the analyte's peak");
  }
  for (const d of decisions) {
    const n = d.name.toLowerCase();
    if (d.present && new RegExp(`\\b${n}\\s+(?:is\\s+|was\\s+)?(?:absent|not\\s+(?:detected|present|found))`).test(low)) out.push(`decision contradicted: ${d.name} PRESENT`);
    if (!d.present && new RegExp(`\\b${n}\\s+(?:is\\s+|was\\s+)?(?:present|detected|found)\\b`).test(low)) out.push(`decision contradicted: ${d.name} ABSENT`);
  }
  for (const s of ss) {
    for (const m of s.matchAll(/(\d\.\d+)\s*[–-]\s*(\d\.\d+)/g)) {
      const lo = parseFloat(m[1]), hi = parseFloat(m[2]);
      if (hi - lo <= 0.1 && (lo < 0.039 || hi > 0.761) && !/edge|\bends?\b|start|beginning|not count/.test(s.toLowerCase())) {
        out.push(`edge range (${m[1]}–${m[2]} V) presented as evidence`);
      }
    }
  }
  return out;
}

/** The user messages (the system prompt is separate: data/chemist_prompts.json). */
export const reportMessage = (evidence) => `EVIDENCE FILE\n\`\`\`json\n${evidence}\n\`\`\`\n\nWrite the 3–5 sentence paragraph from this evidence file.`;
export const questionMessage = (evidence, report, question) =>
  `EVIDENCE FILE\n\`\`\`json\n${evidence}\n\`\`\`\n\nREPORT GIVEN TO THE USER\n${report}\n\nTHE USER'S QUESTION\n${question}`;

/** What is appended to the message for the next attempt after a check finding. */
export const retryNote = (text, findings, nMax) => `\n\nYour previous text:\n${text}\n\nProblems: ${findings.join("; ")}`
  + (findings.join(" ").includes("sentences;") ? `\nAt most ${nMax} sentences: merge two sentences or drop the least important one.` : "")
  + "\nRewrite from the same evidence file without these problems.";

/** " ".join(text.split()) */
export const oneLine = (t) => words(t).join(" ");
