// Checks assets/js/llm/evidence_en.js on every Turkish evidence file at hand: the 125 library curves of the parity fixture
// (tools/fixtures/kimyager_parity.json, local only) and the 2026-10-21 example runs, when the research folder is next to the site.
//   · every file translates (no key or text without a rule)
//   · no Turkish letter or word is left (the user's question excepted)
//   · the numbers are the same, in the same order (decimal commas → points)
//   node tools/evidence_en_check.mjs
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { toEnglish } from "../assets/js/llm/evidence_en.js";
import { pyJson } from "../assets/js/llm/kanit.js";

const here = (p) => new URL("../" + p, import.meta.url);
const docs = JSON.parse(readFileSync(here("tools/fixtures/kimyager_parity.json"), "utf8")).curves.map((c, i) => [`curve ${i}`, JSON.parse(c.kanit)]);
const runs = new URL("../../../literature/xai_llm_rag/kimyager_raporu/kosu_gemini_2026-10-21/", import.meta.url);
if (existsSync(runs)) for (const f of readdirSync(runs).filter((f) => /^ornek_.*\.json$/.test(f))) docs.push([f, JSON.parse(readFileSync(new URL(f, runs), "utf8")).kanit]);

const TURKISH = /[çğıöşüÇĞİÖŞÜ]|\b(ve|bir|için|yok|var|dilim|pencere|karar|eğri|ölçüm|yöntem)\b/;
const nums = (t) => (t.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => x.replace(",", "."));
let ok = 0;
const fails = [];
for (const [name, tr] of docs) {
  try {
    const en = pyJson(toEnglish(tr));
    const left = pyJson(toEnglish({ ...tr, soru: null })).match(TURKISH);
    const a = nums(pyJson(tr)).join(" "), b = nums(en).join(" ");
    if (left) fails.push(`${name}: Turkish left: "${left[0]}"`);
    else if (a !== b) fails.push(`${name}: numbers differ`);
    else ok++;
  } catch (err) { fails.push(`${name}: ${err.message}`); }
}
console.log(`evidence_en  ${ok}/${docs.length} files translated, no Turkish left, numbers identical${fails.length ? "\n  " + fails.slice(0, 8).join("\n  ") : ""}`);
process.exitCode = fails.length ? 1 : 0;
