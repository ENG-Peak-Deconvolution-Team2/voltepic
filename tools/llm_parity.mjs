// Parity of the analyzer's report pipeline (assets/js/llm/) against the Python prototype it ports.
// Fixture: python tools/export_llm.py --fixture. Run from the site folder: node tools/llm_parity.mjs
import { readFileSync } from "node:fs";
import { buildPacket, assemblePrompt } from "../assets/js/llm/packet.js";
import { verify } from "../assets/js/llm/verify.js";

const load = (p) => JSON.parse(readFileSync(new URL("../" + p, import.meta.url), "utf8"));
const model = load("data/model.json"), lib = load("data/library.json"), xai = load("data/xai.json"), llm = load("data/llm.json");
const fx = load("tools/fixtures/llm_parity.json");

/** Deep equality with a numeric tolerance; returns the first differing path or null. */
function diff(a, b, path = "") {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)) ? null : `${path}: ${a} ≠ ${b}`;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b ? null : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.join() !== kb.join()) return `${path}: keys ${ka} ≠ ${kb}`;
  for (const k of ka) { const d = diff(a[k], b[k], `${path}.${k}`); if (d) return d; }
  return null;
}

const packetFor = (i) => buildPacket({
  sample: { ...lib.samples[i], source: "library" }, probs: lib.samples[i].ref, analytes: model.analytes, thresholds: model.thresholds,
  grid: model.grid, acquisition: lib.acquisition, xai, src: { kind: "shap", rows: xai.shap["20mV"].logit[i], unit: "20mV", width: 5 },
});

// 1 · packets
let pOk = 0, factCount = 0;
const pBad = [];
for (const py of fx.packets) {
  const js = packetFor(py.index);
  factCount += py.facts.length;
  const d = diff(js.facts, py.facts, "facts") ?? diff(js.values.detection, py.detection, "detection")
    ?? diff(js.sample, py.sample, "sample") ?? diff(js.retrieve, py.retrieve, "retrieve");
  if (d) pBad.push(`curve ${py.index} ${d}`); else pOk++;
}

// 2 · prompts (the v0.2 run's istem_<curve>.txt)
let qOk = 0;
const qBad = [];
for (const [curve, py] of Object.entries(fx.prompts)) {
  const js = assemblePrompt(packetFor(+curve), llm.cards);
  const part = (s, re) => s.match(re)?.[1];
  const d = diff(JSON.parse(part(js, /<paket>\n([\s\S]*)\n<\/paket>/)), JSON.parse(part(py, /<paket>\n([\s\S]*)\n<\/paket>/)), "paket")
    ?? (part(js, /(<bilgi>[\s\S]*)$/) === part(py, /(<bilgi>[\s\S]*)$/) ? null : "bilgi/instruction text differs");
  if (d) qBad.push(`curve ${curve} ${d}`); else qOk++;
}

// 3 · verifier findings on every report of both runs
let vOk = 0, findings = 0;
const vBad = [];
for (const r of fx.reports) {
  const js = verify(r.packet, r.prompt, r.report).issues.map((x) => x.text);
  findings += r.issues.length;
  if (JSON.stringify(js) === JSON.stringify(r.issues)) vOk++;
  else vBad.push(`${r.run} curve ${r.curve} ${r.model}: js ${js.length} vs py ${r.issues.length}\n    js: ${JSON.stringify(js.filter((x) => !r.issues.includes(x)))}\n    py: ${JSON.stringify(r.issues.filter((x) => !js.includes(x)))}`);
}

console.log(`packets   ${pOk}/${fx.packets.length} identical (${factCount} facts: id, text, values; detection; sample; cards)`);
console.log(`prompts   ${qOk}/${Object.keys(fx.prompts).length} identical (packet JSON by value, card text and instruction by string)`);
console.log(`verifier  ${vOk}/${fx.reports.length} reports with identical findings (${findings} findings in Python)`);
for (const x of [...pBad, ...qBad, ...vBad].slice(0, 12)) console.log("  ✗ " + x);
process.exit(pBad.length + qBad.length + vBad.length ? 1 : 0);
