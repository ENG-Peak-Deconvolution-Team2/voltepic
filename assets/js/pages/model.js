// Model card: live held-out results, confusion matrices, probability strips, reference check.

import "../site.js";
import { $, esc, pct } from "../ui.js";
import { ANALYTES, getLibrary, getModel } from "../data.js";
import { lin, tips } from "../viz.js";

const [{ json, model }, library] = await Promise.all([getModel(), getLibrary()]);
const samples = library.samples;
const thr = model.thresholds;
const K = ANALYTES.length;

/* ───────────── Static facts from model.json ───────────── */
$("#mAug").textContent = json.recipe.augmentation.id;
$("#mThr").innerHTML = ANALYTES.map((a, k) => `${a.code} ${thr[k].toFixed(4)}`).join("<br>");
$("#mCreated").textContent = `exported ${json.created}`;
$("#mVersions").innerHTML = Object.entries(json.versions).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");

/* ───────────── Score every held-out curve ───────────── */
const scored = samples.map((s) => ({ s, r: model.score(s.I) }));
const stats = ANALYTES.map((_, k) => {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const { s, r } of scored) {
    const pred = r.probs[k] >= thr[k];
    const truth = s.labels[k] > 0;
    if (pred && truth) tp++; else if (pred) fp++; else if (truth) fn++; else tn++;
  }
  const pos = tp + fn;
  const neg = tn + fp;
  return { tp, fp, tn, fn, pos, neg, acc: (tp + tn) / (pos + neg), sens: tp / pos, spec: tn / neg, bal: (tp / pos + tn / neg) / 2 };
});
const correct = stats.reduce((a, t) => a + t.tp + t.tn, 0);
$("#resBadge").textContent = `${correct} / ${samples.length * K} calls correct`;
$("#resBadge").dataset.tone = "ok";
$("#resTable tbody").innerHTML = ANALYTES.map((a, k) => {
  const t = stats[k];
  return `<tr><td><span class="swatch" style="--c:var(${a.color})"></span>${esc(a.name)}</td><td>${t.pos}</td><td>${t.neg}</td><td>${pct(t.acc, 1)}</td><td>${pct(t.bal, 1)}</td><td>${pct(t.sens, 1)}</td><td>${pct(t.spec, 1)}</td></tr>`;
}).join("");

/* ───────────── Confusion matrices ───────────── */
$("#cms").innerHTML = ANALYTES.map((a, k) => {
  const t = stats[k];
  const cell = (v, tot, off) => `<div class="cm-c${off ? " off" : ""}" style="--f:${(v / Math.max(1, tot)).toFixed(3)}">${v}</div>`;
  return `<div class="cm" style="--c:var(${a.color})"><div class="cm-name"><i></i>${esc(a.name)}</div>
    <div class="cm-grid" role="img" aria-label="${esc(a.name)} confusion matrix: true positive ${t.tp}, false negative ${t.fn}, false positive ${t.fp}, true negative ${t.tn}">
      <span></span><span class="cm-h">pred +</span><span class="cm-h">pred −</span>
      <span class="cm-v">actual +</span>${cell(t.tp, t.pos)}${cell(t.fn, t.pos, true)}
      <span class="cm-v">actual −</span>${cell(t.fp, t.neg, true)}${cell(t.tn, t.neg)}
    </div></div>`;
}).join("");

/* ───────────── Probability strips ───────────── */
$("#stripLegend").innerHTML = ANALYTES.map((a) => `<span style="--c:var(${a.color})"><i></i>${esc(a.name)}</span>`).join("")
  + `<span><i style="background:var(--muted)"></i>absent</span>`;
function drawStrips() {
  const root = $("#strips");
  root.innerHTML = ANALYTES.map((a, k) => `<div class="strip" style="--c:var(${a.color})"><span class="strip-name"><i></i>${esc(a.code)}</span><svg class="viz" data-k="${k}" role="img" aria-label="${esc(a.name)} probabilities"></svg></div>`).join("");
  root.querySelectorAll("svg").forEach((svg) => {
    const k = +svg.dataset.k;
    const w = Math.max(200, Math.round(svg.getBoundingClientRect().width));
    svg.setAttribute("viewBox", `0 0 ${w} 34`);
    const sx = lin(0, 1, 6, w - 6);
    const dots = scored.slice().sort((p, q) => (p.s.labels[k] > 0) - (q.s.labels[k] > 0)).map(({ s, r }, i) => {
      const present = s.labels[k] > 0;
      const jitter = ((i * 37) % 11 - 5) * 1.1;
      const tip = `<div class='tt-h'>${esc(s.file)}</div><div class='tt-r'><span>P</span><b>${r.probs[k].toFixed(4)}</b></div><div class='tt-r'><span>label</span><b>${present ? "present" : "absent"}</b></div>`;
      return `<circle cx="${sx(r.probs[k]).toFixed(1)}" cy="${(15 + jitter).toFixed(1)}" r="3.6" style="fill:${present ? `var(${ANALYTES[k].color})` : "var(--muted)"};opacity:${present ? 0.85 : 0.45}" data-tip="${esc(tip)}"/>`;
    }).join("");
    svg.innerHTML = `<line class="rail" x1="6" x2="${w - 6}" y1="15" y2="15"/>${dots}<line class="thr" x1="${sx(thr[k])}" x2="${sx(thr[k])}" y1="2" y2="28"/>`
      + `<text class="tick" x="6" y="33">0</text><text class="tick" x="${w - 6}" y="33" text-anchor="end">1</text>`;
    tips(svg);
  });
}
drawStrips();
let rz;
addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(drawStrips, 160); });

/* ───────────── Misclassified list ───────────── */
const misses = [];
scored.forEach(({ s, r }) => ANALYTES.forEach((a, k) => {
  if ((r.probs[k] >= thr[k]) !== (s.labels[k] > 0)) misses.push({ s, a, k, p: r.probs[k] });
}));
$("#missBadge").textContent = `${misses.length} of ${samples.length * K}`;
$("#missBadge").dataset.tone = misses.length ? "warn" : "ok";
$("#missTable tbody").innerHTML = misses.length
  ? misses.map(({ s, a, k, p }) => `<tr><td>${esc(s.file)}</td><td><span class="swatch" style="--c:var(${a.color})"></span>${esc(a.code)}</td><td>${p.toFixed(3)}</td><td>${s.labels[k] > 0 ? "present" : "absent"}</td><td><a href="app.html#s=${s.index}">open →</a></td></tr>`).join("")
  : `<tr><td colspan="5" class="empty">No misclassified curves.</td></tr>`;

/* ───────────── Reference check ───────────── */
{
  let diff = 0;
  let total = 0;
  let maxd = 0;
  for (const { s, r } of scored) {
    for (let k = 0; k < K; k++) {
      total++;
      if ((r.probs[k] >= thr[k]) !== (s.ref[k] >= thr[k])) diff++;
      maxd = Math.max(maxd, Math.abs(r.probs[k] - s.ref[k]));
    }
  }
  $("#parStat").innerHTML = `${diff}<small>/ ${total}</small>`;
  $("#parText").textContent = `Decisions where this page differs from the Python reference. ${diff === 0 ? "All agree." : "Disagreement found."}`;
  $("#parMax").textContent = maxd.toExponential(1);
  if (diff) $(".parity-live").dataset.bad = "";
}
