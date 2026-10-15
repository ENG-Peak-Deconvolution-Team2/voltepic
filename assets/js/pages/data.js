// Dataset: source, cohort, coatings figure, split diagram, held-out library statistics and gallery.

import "../site.js";
import { $, $$, esc, conc, segmented } from "../ui.js";
import { ANALYTES, GRID_E, getLibrary, getModel, getXai } from "../data.js";
import { lin, sparkline, tips, traceChart } from "../viz.js";

const [library, xai, { json: modelJson }] = await Promise.all([getLibrary(), getXai(), getModel()]);
const samples = library.samples;

/* ───────────── Analyte list ───────────── */
$("#anList").innerHTML = ANALYTES.map((a) => `<li style="--c:var(${a.color})"><i></i><span>${a.name}</span><span class="mono">${a.code}</span></li>`).join("");

/* ───────────── Two coatings ───────────── */
const scale01 = (v) => {
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  return Array.from(v, (x) => (x - lo) / (hi - lo || 1));
};
function drawCoatings() {
  const win = xai?.windows?.PVDF;
  const windows = win ? ANALYTES.map((a) => ({ ...win[a.id], color: a.color })) : [];
  traceChart($("#pvdfChart"), { E: GRID_E, series: [{ y: scale01(modelJson.r1.PVDF) }], height: 260, yLabel: "0–1", windows });
  traceChart($("#p4vpChart"), { E: GRID_E, series: [{ y: scale01(modelJson.r1.P4VP) }], height: 260, yLabel: "0–1", windows: [{ lo: 0.13, hi: 0.22, color: "--ink-2" }] });
}
$("#pvdfLegend").innerHTML = ANALYTES.map((a) => `<span style="--c:var(${a.color})"><i class="dash"></i>${a.code} ${(xai?.windows?.PVDF?.[a.id]?.center ?? 0).toFixed(3)} V</span>`).join("");
drawCoatings();

/* ───────────── Library statistics ───────────── */
const byPoly = (p) => samples.filter((s) => s.polymer === p).length;
const byN = (n) => samples.filter((s) => s.present.length === n).length;
const stat = (n, label) => `<div><div class="stat num">${n}</div><span>${label}</span></div>`;
const tile = (title, body, delay = 0) => `<div class="tile reveal"${delay ? ` data-delay="${delay}"` : ""}><h3>${title}</h3><div class="split-row">${body}</div></div>`;
$("#libCounts").innerHTML =
  tile("By coating", stat(byPoly("P4VP"), "P4VP") + stat(byPoly("PVDF"), "PVDF"))
  + tile("By number of analytes present", stat(byN(1), "single") + stat(byN(2), "binary") + stat(byN(3), "ternary") + stat(byN(4), "four"), 1);
$("#dotLegend").innerHTML = ANALYTES.map((a) => `<span style="--c:var(${a.color})"><i class="box"></i>${a.name}</span>`).join("");

function drawDots() {
  const svg = $("#dotChart");
  const rowH = 58;
  const m = { l: 62, r: 16, t: 12, b: 34 };
  const h = m.t + m.b + rowH * 4;
  const w = Math.max(280, Math.round(svg.getBoundingClientRect().width) || 600);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.style.height = `${h}px`;
  const all = samples.flatMap((s) => s.labels.filter((v) => v > 0));
  const lg = Math.log10;
  const e0 = Math.floor(lg(Math.min(...all)));
  const e1 = Math.ceil(lg(Math.max(...all)));
  const sx = lin(e0, e1, m.l, w - m.r);
  let out = "";
  for (let e = e0; e <= e1; e++) {
    out += `<line class="grid" x1="${sx(e)}" x2="${sx(e)}" y1="${m.t}" y2="${h - m.b}"/>${w < 500 && (e - e0) % 2 ? "" : `<text x="${sx(e)}" y="${h - 12}" text-anchor="${e === e1 ? "end" : "middle"}">${conc(10 ** e)}</text>`}`;
  }
  ANALYTES.forEach((a, k) => {
    const cy = m.t + rowH * k + rowH / 2;
    out += `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${cy + rowH / 2}" y2="${cy + rowH / 2}"/><text x="${m.l - 10}" y="${cy + 4}" text-anchor="end" class="lbl">${a.code}</text>`;
    samples.filter((s) => s.labels[k] > 0).forEach((s, i) => {
      const jit = (((i * 7919) % 23) / 22 - 0.5) * (rowH - 20);
      out += `<circle cx="${sx(lg(s.labels[k])).toFixed(1)}" cy="${(cy + jit).toFixed(1)}" r="4.5" style="fill:var(${a.color})" data-tip="<div class='tt-h'>${esc(a.name)} · ${conc(s.labels[k])}</div><div class='tt-r'><span>${esc(s.file)}</span></div>"/>`;
    });
  });
  svg.innerHTML = out;
  tips(svg);
}
drawDots();

/* ───────────── Gallery ───────────── */
const state = { poly: "all", count: "any" };
const dots = (s) => ANALYTES.map((a, k) => `<i style="--c:var(${a.color})" ${s.labels[k] > 0 ? "data-on" : ""}></i>`).join("");
const matchCount = (s) => state.count === "any" || (state.count === "3" ? s.present.length >= 3 : s.present.length === +state.count);

const gal = $("#gal");
gal.innerHTML = samples.map((s) => `<a class="gc" href="app.html#s=${s.index}" data-i="${s.index}" aria-label="${esc(s.title)}, ${esc(s.chip)}, ${esc(s.polymer)}">
  <svg class="viz" aria-hidden="true"></svg><span class="gc-t">${esc(s.title)}</span>
  <span class="gc-s"><span>${esc(s.chip)} · ${esc(s.polymer)}</span><span class="gc-d" title="Analytes present: ${esc(s.present.map((k) => ANALYTES[k].code).join(", "))}">${dots(s)}</span></span></a>`).join("");

function drawSparks() {
  for (const a of $$(".gc", gal)) {
    if (a.hidden) continue;
    sparkline($("svg", a), Array.from(samples[+a.dataset.i].I), { color: "--ink", height: 56, xs: Array.from(GRID_E), stroke: 1.5 });
  }
}
function applyFilter() {
  let n = 0;
  for (const a of $$(".gc", gal)) {
    const s = samples[+a.dataset.i];
    a.hidden = !((state.poly === "all" || s.polymer === state.poly) && matchCount(s));
    if (!a.hidden) n++;
  }
  $("#galN").textContent = `${n} of ${samples.length} curves`;
  drawSparks();
}
segmented($("#fPoly"), (v) => { state.poly = v; applyFilter(); });
segmented($("#fCount"), (v) => { state.count = v; applyFilter(); });
applyFilter();

/* ───────────── Resize ───────────── */
let rz;
addEventListener("resize", () => {
  clearTimeout(rz);
  rz = setTimeout(() => { drawCoatings(); drawDots(); drawSparks(); }, 160);
});
