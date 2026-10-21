// Explainability: the XAI results (verdict matrix from the run summaries), PFI of this model,
// and the edge-coefficient finding recomputed from the wavelet filters.

import "../site.js";
import { observeReveal } from "../site.js";
import { $, $$, esc, segmented } from "../ui.js";
import { ANALYTES, GRID_E as E, getXai, loadJson } from "../data.js";
import { wavedec } from "../engine/wavelet.js";
import { profileChart, tips } from "../viz.js";

const [xai, modelJson] = await Promise.all([getXai(), loadJson("model")]);

/* ───────────── Verdict matrix ─────────────
   Source: ENG XAI run summaries (XAI_sonuc_ozeti_2026-10-11), 5 seeds × 6 models; 20 mV, R1 fill
   (PFI "everyone"), log-loss; maps and E3 on PVDF. */
const METHODS = ["Occlusion", "SHAP", "PFI", "SAGE"];
const TESTS = [
  { id: "maps", name: "Maps", q: "Where does it look?", plain: "Ask someone who says “there is a cat” where they are looking.",
    desc: "Which window carries the most weight for each analyte (PVDF).",
    cells: [["cond", "“absent” on the peak; “present” scattered"], ["cond", "“absent” on the peak; “present” at an edge for 3 of 4"], ["held", "on the peak for 4 of 4 analytes"], ["cond", "on the peak for 2 of 4"]] },
  { id: "e1", name: "E1 · Salt test", q: "Is the map faithful?", plain: "To believe that salt makes the taste, take the salt out and taste again.",
    desc: "Delete the windows the map ranks first: the model should get worse faster than when random windows go.",
    cells: [["held", "0.75–0.95 with its own fill"], ["held", "0.98–1.00 with its own fill"], ["cond", "0.61–0.96, depends on the fill used to test"], ["held", "0.98–1.00 with its own fill"]] },
  { id: "e2", name: "E2 · Five doctors", q: "Is it stable?", plain: "Show the same X-ray to five doctors: trust it if they point at the same place.",
    desc: "Rank similarity of the maps across five models, replicate curves and the method's own randomness.",
    cells: [["cond", "0.74 across 5 models"], ["cond", "0.68 across 5 models"], ["held", "0.89 across 5 models"], ["cond", "0.84 across models, 0.49 across folds"]] },
  { id: "e3", name: "E3 · Cat test", q: "Does it sit on the peak?", plain: "Ask a child where the cat is: is the finger on the cat?",
    desc: "Share of the map inside the analyte's own peak window, against random placement (PVDF; no window exists on P4VP).",
    cells: [["weak", "best 0.33"], ["cond", "best 0.42"], ["cond", "0.50"], ["cond", "best 0.50"]] },
  { id: "e4", name: "E4 · Smudge test", q: "Does it chase artefacts?", plain: "A student who finds the answer from a smudge on the paper has not learned.",
    desc: "Weight on the first and last 5% of the scan, and whether maps follow chip, date or run instead of chemistry.",
    cells: [["cond", "edge share 8–35%, flagged with R3"], ["cond", "P4VP edge share 39% (R1)"], ["held", "edge share 11% / 13%, no flag"], ["cond", "P4VP edge share 38% (R3)"]] },
  { id: "e5", name: "E5 · Student who didn't study", q: "Does it need learning?", plain: "If an unprepared student points at the same places, the pointing shows nothing.",
    desc: "Retrain on shuffled labels (accuracy 0.49–0.52); its maps must not resemble the real model's.",
    cells: [["held", "similarity 0.00"], ["held", "similarity 0.02"], ["held", "importance 11.5 → 1.4"], ["held", "importance 2.89 → −0.01"]] },
];
const TONE = { held: ["ok", "Held"], cond: ["warn", "Conditional"], weak: ["bad", "Weak"] };

$("#verdictTable").innerHTML = `<thead><tr><th>Test</th>${METHODS.map((m) => `<th>${m}</th>`).join("")}</tr></thead><tbody>${TESTS.map((t) =>
  `<tr><td><b>${esc(t.name)}</b><span class="vt-q">${esc(t.q)}</span></td>${t.cells.map(([tone, text]) =>
    `<td><span class="badge" data-tone="${TONE[tone][0]}"><span class="dot"></span>${TONE[tone][1]}</span><span class="vt-n">${esc(text)}</span></td>`).join("")}</tr>`).join("")}</tbody>`;
$("#testCards").innerHTML = TESTS.map((t, i) => `<article class="test-card reveal" data-delay="${i % 3}"><span class="mono">${esc(t.name)}</span><h3 class="h4">${esc(t.q)}</h3><p>${esc(t.desc)}</p><p class="m-plain">${esc(t.plain)}</p></article>`).join("");

/* ───────────── Where it looks (PFI of this model) ───────────── */
const look = { poly: "PVDF", focus: null, unit: "20mV" };
$("#lkFocus").innerHTML = `<button role="radio" data-v="all" aria-checked="true">All</button>` + ANALYTES.map((a, k) => `<button role="radio" data-v="${k}" aria-checked="false">${a.code}</button>`).join("");
$("#lkLegend").innerHTML = ANALYTES.map((a) => `<span style="--c:var(${a.color})"><i></i>${a.name}</span>`).join("");

function drawLook() {
  if (!xai) { $("#lkCap").textContent = "The XAI results (data/xai.json) are not loaded."; return; }
  const w = look.unit === "20mV" ? 5 : 10;
  const data = xai.pfi[look.unit][look.poly];
  const profiles = ANALYTES.map((a) => {
    const v = data[a.id].importance.map((x) => Math.max(0, x));
    const m = Math.max(...v) || 1;
    return v.map((x) => x / m);
  });
  const centers = profiles[0].map((_, j) => (E[j * w] + E[Math.min(199, j * w + w - 1)]) / 2);
  const windows = ANALYTES.map((a) => xai.windows[look.poly]?.[a.id] ?? null);
  profileChart($("#lkChart"), { analytes: ANALYTES, profiles, centers, windows, height: 300, focus: look.focus });
  $("#lkTitle").textContent = `Permutation importance per ${look.unit.replace("mV", " mV")} window · ${look.poly}`;
  $("#lkList").innerHTML = ANALYTES.map((a, k) => {
    const c = centers[profiles[k].indexOf(1)];
    const win = windows[k];
    const verdict = win ? (c >= win.lo && c <= win.hi ? `<span class="ok">✓ on the peak</span>` : `<span class="no">off the peak</span>`) : `<span class="no">no window</span>`;
    return `<li style="--c:var(${a.color})"><i></i><span>${a.name} <span class="mono">top ${c.toFixed(3)} V${win ? ` · window ${win.lo.toFixed(3)}–${win.hi.toFixed(3)} V` : ""}</span></span>${verdict}</li>`;
  }).join("");
  $("#lkCap").innerHTML = look.poly === "PVDF"
    ? "Each window is shuffled across the held-out PVDF curves; the line is the rise in log-loss, scaled to each analyte's maximum. Bars under the axis: E3 peak windows."
    : "On P4VP the four single-analyte peaks crowd into roughly 0.13–0.22 V and the E3 test could not define peak windows, so there is nothing to compare the maxima with.";
}
segmented($("#lkPoly"), (v) => { look.poly = v; drawLook(); });
segmented($("#lkFocus"), (v) => { look.focus = v === "all" ? null : +v; drawLook(); });
segmented($("#lkWidth"), (v) => { look.unit = v; drawLook(); });
drawLook();

/* ───────────── Edges: recomputed from the filters ───────────── */
function drawEdges() {
  const bank = modelJson.wavelets["rbio1.3"];
  const cols = [];
  for (let i = 0; i < 200; i++) {
    const e = new Float64Array(200);
    e[i] = 1;
    cols.push(wavedec(e, bank, 6).flatMap((c) => Array.from(c)));
  }
  const n = cols[0].length;
  // share of each coefficient's weight that comes from the first/last 10 points; five sit exactly
  // on 90%, so the count is a range (the XAI run's floating-point result counted 30)
  const ratio = Array.from({ length: n }, (_, c) => {
    let tot = 0;
    let edge = 0;
    for (let i = 0; i < 200; i++) { const v = Math.abs(cols[i][c]); tot += v; if (i < 10 || i >= 190) edge += v; }
    return edge / tot;
  });
  const edgeOnly = ratio.map((r) => r > 0.9 + 1e-9);
  const tie = ratio.map((r) => Math.abs(r - 0.9) <= 1e-9);
  const count = edgeOnly.filter(Boolean).length;
  const ties = tie.filter(Boolean).length;
  $("#edgeCount").textContent = ties ? `${count}–${count + ties} of ${n}` : `${count} of ${n}`;
  // map: one cell per coefficient, grouped by band
  const svg = $("#edgeMap");
  const w = Math.max(300, Math.round(svg.getBoundingClientRect().width));
  const h = 74;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.style.height = `${h}px`;
  const bands = [];
  let off = 0;
  for (const b of modelJson.features.bands) { bands.push({ ...b, start: off }); off += b.length; }
  const weight = bands.map((b) => Math.max(b.length, 12));
  const unitW = (w - 4) / weight.reduce((a, b) => a + b, 0);
  let x = 2;
  let out = "";
  bands.forEach((b, bi) => {
    const bw = (weight[bi] * unitW) / b.length;
    for (let j = 0; j < b.length; j++) {
      const c = b.start + j;
      out += `<rect x="${(x + j * bw).toFixed(1)}" y="8" width="${Math.max(0.8, bw - 0.6).toFixed(1)}" height="34" rx="1" style="fill:var(${edgeOnly[c] ? "--ink" : tie[c] ? "--muted" : "--surface-3"})" data-tip="<div class='tt-h'>${b.name}[${j}] · feature ${c + 1}</div><div class='tt-r'><span>${edgeOnly[c] ? "edge-only" : tie[c] ? "exactly on the 90% line" : "interior"}</span><b>${(ratio[c] * 100).toFixed(1)}% from the ends</b></div>"/>`;
    }
    out += `<text x="${x + (weight[bi] * unitW) / 2}" y="${h - 12}" text-anchor="middle">${b.name}</text>`;
    x += weight[bi] * unitW;
  });
  svg.innerHTML = out;
  tips(svg);
  // split gain on edge-only coefficients, per analyte
  const shares = modelJson.heads.map((hd) => {
    const tot = hd.gain.reduce((a, b) => a + b, 0) || 1;
    return hd.gain.reduce((a, g, i) => a + (edgeOnly[i] ? g : 0), 0) / tot;
  });
  const max = Math.max(...shares, 0.25);
  $("#edgeBars").innerHTML = `<p class="small" style="margin:14px 0 8px">Share of each model's split gain on the ${count} coefficients clearly beyond 90% (dark cells)</p>` + ANALYTES.map((a, k) =>
    `<div class="eb-row"><span><i style="background:var(${a.color})"></i>${a.name}</span><div class="eb-bar"><b style="width:${(shares[k] / max) * 100}%;background:var(${a.color})"></b></div><span class="mono">${(shares[k] * 100).toFixed(1)}%</span></div>`).join("");
}
drawEdges();

/* ───────────── In the analyzer ───────────── */
{
  const t = xai?.tests;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const rows = [
    ["The shading on the graph", "PFI of this model", "The most reliable method in the tests: on the peak for 4 of 4 analytes, stable across models (0.89), no edge bias. It describes the model, not one curve, so it is the default view.", t ? `edge share ${pct(t.pfi["20mV"].edge.P4VP)} / ${pct(t.pfi["20mV"].edge.PVDF)}` : ""],
    ["“This curve” on library curves", "SHAP with the blank as reference (R2)", "Across all fills, the local method that lands on the peak most often. At 20 mV the values come from the chemist report's export (20,000 coalitions per curve, steadier than the XAI run's default budget); at 40 mV from the XAI run.", t ? `peak test ${pct(t.shap_r2["20mV"].e3.hit)}, mean percentile ${t.shap_r2["20mV"].e3.percentile.toFixed(2)}` : ""],
    ["“This curve” on uploads", "SHAP and occlusion against your blank", "Add the blank of the same electrode and the analyzer computes both in your browser (SHAP with 20,000 coalitions, about 4 s), as for library curves; the chemist report needs it. Without a blank it falls back to occlusion with the training mean (R1); the straight-line bridge (R3) is offered but was flagged for edge bias.", t ? `R3 edge share ${pct(t.occlusion["20mV R3"].edge.P4VP)} / ${pct(t.occlusion["20mV R3"].edge.PVDF)}` : ""],
  ];
  $("#choices").innerHTML = rows.map(([where, what, why, num], i) => `<article class="choice reveal" data-delay="${i}"><span class="small">${esc(where)}</span><h3 class="h3">${esc(what)}</h3><p>${esc(why)}</p>${num ? `<span class="badge">${esc(num)}</span>` : ""}</article>`).join("");
}
observeReveal();

let rz;
addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { drawLook(); drawEdges(); }, 160); });
