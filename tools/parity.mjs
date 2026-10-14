// Parity of the JS engine against the Python fixtures. Run from the site folder: node tools/parity.mjs
import { readFileSync } from "node:fs";
import { createModel } from "../assets/js/engine/model.js";
import { fillRun } from "../assets/js/engine/xai.js";

const load = (p) => JSON.parse(readFileSync(new URL("../" + p, import.meta.url), "utf8"));
const model = createModel(load("data/model.json"));
const lib = load("data/library.json").samples, fx = load("tools/fixtures/parity.json");

let dFeat = 0, dDen = 0, dMargin = 0, dProb = 0, dRel = 0, dRef = 0, disagree = 0;
lib.forEach((s, i) => {
  const r = model.score(Float64Array.from(s.I));
  for (let j = 0; j < 200; j++) dDen = Math.max(dDen, Math.abs(r.denoised[j] - fx.denoised[i][j]));
  for (let j = 0; j < 228; j++) {
    const a = fx.features[i][j];
    dFeat = Math.max(dFeat, Math.abs(r.features[j] - a));
    dRel = Math.max(dRel, Math.abs(r.features[j] - a) / Math.max(Math.abs(a), 1e-6));
  }
  for (let k = 0; k < 4; k++) {
    dMargin = Math.max(dMargin, Math.abs(r.margins[k] - fx.raw_margin[k][i]));
    dProb = Math.max(dProb, Math.abs(r.probs[k] - fx.scores[i][k]));
    dRef = Math.max(dRef, Math.abs(r.probs[k] - s.ref[k]));
    if ((r.probs[k] >= model.thresholds[k]) !== (fx.scores[i][k] >= model.thresholds[k])) disagree++;
  }
});

const fill = load("tools/fixtures/fill_r3.json");
let dFill = 0;
for (const c of fill.cases) {
  const o = fillRun(Float64Array.from(fill.x), c.i0, c.i1, "R3", null);
  for (let j = 0; j < 200; j++) dFill = Math.max(dFill, Math.abs(o[j] - c.out[j]));
}

console.log(`samples                    ${lib.length}`);
console.log(`max |denoised diff|        ${dDen.toExponential(3)}`);
console.log(`max |features diff|        ${dFeat.toExponential(3)}`);
console.log(`max rel features diff      ${dRel.toExponential(3)}  (denominator floored at 1e-6)`);
console.log(`max |raw margin diff|      ${dMargin.toExponential(3)}`);
console.log(`max |prob diff| (parity)   ${dProb.toExponential(3)}`);
console.log(`max |prob diff| (library)  ${dRef.toExponential(3)}`);
console.log(`decision disagreements     ${disagree}`);
console.log(`max |R3 fill diff|         ${dFill.toExponential(3)}`);
const ok = disagree === 0 && dProb <= 1e-9 && dRel <= 1e-9 && dFill <= 1e-9;
console.log(ok ? "PARITY OK" : "PARITY FAIL");
process.exit(ok ? 0 : 1);
