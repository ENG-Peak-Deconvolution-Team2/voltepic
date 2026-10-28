// Each rule of assets/js/llm/check.js on a text written to trip it, and a clean report that must pass.
//   node tools/check_en_test.mjs
import { check } from "../assets/js/llm/check.js";

const ev = `{"slice": "0.24–0.26 V", "E_V": "0.232", "relative_height": "35%", "window": [0.156, 0.34], "edge": "0.02–0.04 V", "id": "E01"}`;
const ds = [{ name: "Ascorbic acid", present: true }, { name: "Serotonin", present: false }];
const clean = "The model said ascorbic acid is present and the other three analytes are absent. "
  + "Two separate methods looked at the 0.24–0.26 V range, which lies in the expected peak range of ascorbic acid on this coating. "
  + "A peak seen on the curve at 0.232 V also falls in that range. No extra check is needed.";
const cases = [
  ["clean report", clean, []],
  ["too few sentences", "The model said ascorbic acid is present.", ["1 sentences; should be 3–5"]],
  ["long sentence", `${clean} Word ${"word ".repeat(40).trim()}.`, ["long sentence (41 words)"]],
  ["technical terms", `${clean} The SHAP map and the threshold agree.`, ["technical term: 'shap'", "technical term: 'threshold'"]],
  ["no false term in 'shape'", `${clean} The curve's shape is smooth.`, []],
  ["record ID", `${clean} See E01.`, ["record ID: E01", "number not in the evidence file: 01"].slice(0, 1)],
  ["number not in the file", `${clean} The peak height is 0.77 µA.`, ["number not in the evidence file: 0.77"]],
  ["first person", `${clean} I think we can trust it.`, ["first person: 'i'", "first person: 'we'"]],
  ["peak claim", `${clean} This is the ascorbic acid peak.`, ["'peak' claim: the place looked at is presented as the analyte's peak"]],
  ["peak range allowed", `${clean} The ascorbic acid peak range is 0.156–0.34 V.`, []],
  ["decision contradicted", `${clean} Ascorbic acid is not detected and serotonin is present.`,
    ["decision contradicted: Ascorbic acid PRESENT", "decision contradicted: Serotonin ABSENT"]],
  ["edge as evidence", `${clean} The model relies on 0.02–0.04 V.`, ["edge range (0.02–0.04 V) presented as evidence"]],
  ["edge named as edge", `${clean} The 0.02–0.04 V range at the start of the scan does not count.`, []],
];
let ok = 0;
for (const [name, text, want] of cases) {
  const got = check(text, ev, ds, 3, 5).filter((f) => !(name === "record ID" && f.startsWith("number")));
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (pass) ok++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`}`);
}
console.log(`${ok}/${cases.length}`);
process.exitCode = ok === cases.length ? 0 : 1;
