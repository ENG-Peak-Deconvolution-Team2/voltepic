// Parity of the chemist report (assets/js/llm/kanit.js, denetim.js, engine/shap.js) with literature/xai_llm_rag/kimyager_raporu/
// rapor.py. Run from the site folder after `export_kimyager.py --fixture`:  node tools/kimyager_parity.mjs [--shap]
//   · evidence file: JSON text identical to Python for all 125 library curves; basis labels and checks identical
//   · code check: identical findings on every real and altered LLM text of the 2026-10-21 runs
//   · messages: identical report and question messages
//   · --shap: the browser's KernelSHAP against the blank vs Python's on five curves (sampler differs; values close)
import { readFileSync } from "node:fs";
import { createModel } from "../assets/js/engine/model.js";
import { kernelShap } from "../assets/js/engine/shap.js";
import { degerlendir, kanitDosyasi, pyJson, IDS } from "../assets/js/llm/kanit.js";
import { denetle, mesajRapor, mesajSoru } from "../assets/js/llm/denetim.js";

const load = (p) => JSON.parse(readFileSync(new URL("../" + p, import.meta.url), "utf8"));
const model = createModel(load("data/model.json"));
const lib = load("data/library.json").samples, xai = load("data/xai.json"), K = load("data/kimyager.json");
const fx = load("tools/fixtures/kimyager_parity.json");
const thr = model.thresholds;

function build(i, shap = K.samples[i].shap) {
  const s = lib[i], r = K.samples[i];
  const ex = { p: model.score(Float64Array.from(s.I)).probs, p_blank: r.p_blank, shap, occ: r.occ };
  const kararlar = IDS.map((a) => degerlendir(a, ex, thr, s.polymer, xai));
  const kanit = kanitDosyasi({ ex, x: s.I, blank: r.blank, kaplama: s.polymer, chip: s.chip, nBlank: r.n_blank, kararlar, thr, xai, K,
    kaynak: K.library_source });
  return { kararlar, text: pyJson(kanit) };
}

let same = 0, firstDiff = null, labels = 0;
lib.forEach((_, i) => {
  const { kararlar, text } = build(i);
  if (text === fx.curves[i].kanit) same++;
  else if (!firstDiff) {
    const a = text.split("\n"), b = fx.curves[i].kanit.split("\n");
    const j = a.findIndex((l, k) => l !== b[k]);
    firstDiff = `curve ${i}, line ${j + 1}:\n  JS     ${a[j]}\n  Python ${b[j]}`;
  }
  const py = fx.curves[i].kararlar;
  if (kararlar.every((d, k) => d.dayanak === py[k].dayanak && d.neden === py[k].neden && JSON.stringify(d.kontrol) === JSON.stringify(py[k].kontrol))) labels++;
});
console.log(`evidence file   ${same}/${lib.length} curves identical JSON text${firstDiff ? `\n  first difference: ${firstDiff}` : ""}`);
console.log(`basis labels    ${labels}/${lib.length} curves identical (dayanak, neden, kontrol)`);

let ok = 0;
const bad = [];
for (const c of fx.denetle) {
  const js = denetle(c.text, c.kanit, c.kararlar, ...c.n);
  if (JSON.stringify(js) === JSON.stringify(c.bulgu)) ok++;
  else bad.push(`${c.src} #${c.alter}: JS ${JSON.stringify(js)} · Python ${JSON.stringify(c.bulgu)}`);
}
const found = fx.denetle.filter((c) => c.bulgu.length).length;
console.log(`code check      ${ok}/${fx.denetle.length} texts identical findings (${found} texts with findings)${bad.length ? "\n  " + bad.slice(0, 5).join("\n  ") : ""}`);

const mr = mesajRapor(fx.curves[12].kanit) === fx.mesaj.rapor;
const ms = mesajSoru(fx.curves[12].kanit, "Rapor metni.", "Soru metni?") === fx.mesaj.soru;
console.log(`messages        report ${mr ? "identical" : "DIFFERENT"} · question ${ms ? "identical" : "DIFFERENT"}`);

if (process.argv.includes("--shap")) {
  for (const i of [4, 12, 20, 35, 37]) {
    const t0 = performance.now();
    const { logit } = await kernelShap(model, Float64Array.from(lib[i].I), Float64Array.from(K.samples[i].blank));
    const sec = (performance.now() - t0) / 1000;
    const py = K.samples[i].shap;
    let dmax = 0, scale = 0;
    for (let j = 0; j < 40; j++) for (let k = 0; k < 4; k++) { dmax = Math.max(dmax, Math.abs(logit[j][k] - py[j][k])); scale = Math.max(scale, Math.abs(py[j][k])); }
    const a = build(i).kararlar.map((d) => d.dayanak), b = build(i, logit).kararlar.map((d) => d.dayanak);
    console.log(`shap curve ${String(i).padStart(3)}  ${sec.toFixed(1)} s · max |Δ| ${dmax.toFixed(3)} (largest |φ| ${scale.toFixed(2)}) · basis labels `
      + `${a.every((x, k) => x === b[k]) ? "same" : `differ: Python ${a.join("/")} · JS ${b.join("/")}`}`);
  }
}
process.exitCode = same === lib.length && labels === lib.length && ok === fx.denetle.length && mr && ms ? 0 : 1;
