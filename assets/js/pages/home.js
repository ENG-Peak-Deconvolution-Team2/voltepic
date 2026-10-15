// Home: live readout of held-out curves, numbers, the pipeline strip and the PFI finding.

import "../site.js";
import { $, $$, esc, conc, reducedMotion } from "../ui.js";
import { ANALYTES, GRID_E, getLibrary, getXai, getModel } from "../data.js";
import { lin, path, profileChart, sparkline, tips } from "../viz.js";

// The thresholds are 0.49995–0.50000 and no held-out probability lies within 0.05 of 0.5
// (checked when the page was built), so 0.5 reproduces the model's decisions without loading it.
const CUT = 0.5;
const SHOWCASE = [38, 60, 70, 17, 106, 90];
const DWELL = 5200;

const [library, xai] = await Promise.all([getLibrary(), getXai()]);
const samples = library.samples;

/* ───────────── Numbers ───────────── */
{
  const acc = ANALYTES.map((_, k) => samples.filter((s) => (s.ref[k] >= CUT) === (s.labels[k] > 0)).length / samples.length);
  const lo = Math.min(...acc) * 100;
  const hi = Math.max(...acc) * 100;
  $("#accStat").innerHTML = `${+lo.toFixed(1)}<small>–${+hi.toFixed(1)}%</small>`;
}

/* ───────────── Hero readout ───────────── */
const chart = $("#roChart");
let current = null;     // normalised curve on screen
let index = 0;
let timer = null;
let paused = false;

const normalise = (I) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of I) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return Array.from(I, (v) => (v - lo) / (hi - lo || 1));
};

/** Top PFI windows (model-wide) of each detected analyte for this coating. */
function lookWindows(s) {
  if (!xai) return [];
  const imp = xai.pfi["20mV"][s.polymer];
  return ANALYTES.flatMap((a, k) => {
    if (s.ref[k] < CUT) return [];
    const v = imp[a.id].importance;
    const top = v.map((x, j) => [x, j]).sort((p, q) => q[0] - p[0]).slice(0, 2);
    return top.map(([, j], rank) => ({ k, lo: GRID_E[j * 5] - 0.002, hi: GRID_E[j * 5 + 4] + 0.002, rank }));
  });
}

function drawReadout(curve, s, fadeShades) {
  const w = Math.max(280, Math.round(chart.getBoundingClientRect().width));
  const h = 230;
  chart.setAttribute("viewBox", `0 0 ${w} ${h}`);
  chart.style.height = `${h}px`;
  const sx = lin(0, 0.8, 8, w - 8);
  const sy = lin(-0.08, 1.12, h - 6, 22);
  let out = "";
  for (const v of [0.25, 0.5, 0.75]) out += `<line class="grid" x1="8" x2="${w - 8}" y1="${sy(v)}" y2="${sy(v)}"/>`;
  const wins = lookWindows(s);
  wins.forEach((win, i) => {
    const a = ANALYTES[win.k];
    out += `<rect class="shade" x="${sx(win.lo)}" y="18" width="${sx(win.hi) - sx(win.lo)}" height="${h - 24}" rx="4" style="fill:var(${a.color});opacity:${win.rank ? 0.12 : 0.22}${fadeShades ? `;animation:shade-in .7s ${0.25 + i * 0.06}s both` : ""}"/>`;
    if (!win.rank) out += `<text class="ro-tag" x="${(sx(win.lo) + sx(win.hi)) / 2}" y="12" text-anchor="middle" style="fill:var(${a.color})${fadeShades ? `;animation:shade-in .7s ${0.3 + i * 0.06}s both` : ""}">${a.code}</text>`;
  });
  out += `<path d="${path(GRID_E, curve, sx, sy)}L${sx(0.8)},${h}L${sx(0.004)},${h}Z" style="fill:var(--ink);opacity:.04"/>`;
  out += `<path class="trace" d="${path(GRID_E, curve, sx, sy)}"/>`;
  chart.innerHTML = `<style>@keyframes shade-in{from{opacity:0}}</style>` + out;
}

function morph(to, s) {
  const from = current ?? to.map(() => 0.5);
  current = to;
  if (reducedMotion()) { drawReadout(to, s, false); return; }
  const t0 = performance.now();
  let first = true;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 900);
    const e = 1 - (1 - k) ** 4;
    drawReadout(from.map((v, i) => v + (to[i] - v) * e), s, first);
    first = false;
    if (k < 1) requestAnimationFrame(step);
    else drawReadout(to, s, false);
  };
  requestAnimationFrame(step);
}

function showSample(i) {
  index = (i + SHOWCASE.length) % SHOWCASE.length;
  const s = samples[SHOWCASE[index]];
  $("#roId").textContent = `held-out #${String(s.index + 1).padStart(3, "0")} · ${s.polymer} · ${s.chip}`;
  morph(normalise(s.I), s);
  const match = ANALYTES.every((_, k) => (s.ref[k] >= CUT) === (s.labels[k] > 0));
  $("#roRows").innerHTML = ANALYTES.map((a, k) => {
    const p = s.ref[k];
    const on = p >= CUT;
    return `<li class="ro-row" style="--c:var(${a.color})"><span class="ro-name"><i></i>${a.name}</span>
      <span class="ro-bar"><i style="width:${(p * 100).toFixed(1)}%"></i><b></b></span><span class="ro-p">${Math.round(p * 100)}%</span>
      <span class="ro-call" ${on ? "data-on" : ""}>${on ? `✓ present · ${conc(s.labels[k])}` : "– absent"}</span></li>`;
  }).join("");
  $("#roNote").textContent = `${match ? "All four calls match the label" : "A call differs from the label"} · shading: where the model looks`;
  $("#roDots").innerHTML = SHOWCASE.map((_, j) => `<i ${j === index ? `data-on style="--dur:${DWELL}ms"` : j < index ? "data-done" : ""}></i>`).join("");
  schedule();
}
function schedule() {
  clearTimeout(timer);
  if (!paused && !reducedMotion()) timer = setTimeout(() => showSample(index + 1), DWELL);
}
const readout = $(".readout");
readout.addEventListener("pointerenter", () => { paused = true; clearTimeout(timer); readout.classList.add("paused"); });
readout.addEventListener("pointerleave", () => { paused = false; showSample(index); });
$("#roDots").addEventListener("click", (e) => {
  const dots = $$("#roDots i");
  const j = dots.indexOf(e.target.closest("i"));
  if (j >= 0) showSample(j);
});
document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(timer); else schedule(); });
showSample(0);

/* ───────────── PFI finding ───────────── */
function drawPfi() {
  if (!xai) return;
  const data = xai.pfi["20mV"].PVDF;
  const profiles = ANALYTES.map((a) => {
    const v = data[a.id].importance.map((x) => Math.max(0, x));
    const m = Math.max(...v) || 1;
    return v.map((x) => x / m);
  });
  const centers = profiles[0].map((_, j) => (GRID_E[j * 5] + GRID_E[j * 5 + 4]) / 2);
  const windows = ANALYTES.map((a) => xai.windows.PVDF[a.id]);
  profileChart($("#pfiChart"), { analytes: ANALYTES, profiles, centers, windows, height: 280 });
  $("#pfiLegend").innerHTML = ANALYTES.map((a) => `<span style="--c:var(${a.color})"><i></i>${a.name}</span>`).join("");
  $("#peakList").innerHTML = ANALYTES.map((a, k) => {
    const j = profiles[k].indexOf(1);
    const c = centers[j];
    const win = windows[k];
    const inside = c >= win.lo && c <= win.hi;
    return `<li style="--c:var(${a.color})"><i></i><span>${a.name} <span class="mono">top window ${c.toFixed(3)} V · peak window ${win.lo.toFixed(3)}–${win.hi.toFixed(3)} V</span></span><span class="${inside ? "ok" : "no"}">${inside ? "✓ inside" : "outside"}</span></li>`;
  }).join("");
}
drawPfi();

/* ───────────── Pipeline strip (computed when it comes into view) ───────────── */
async function drawPipeline() {
  const { model } = await getModel();
  const s = samples[SHOWCASE[0]];
  const r = model.score(s.I);
  sparkline($('[data-viz="raw"]'), Array.from(s.I), { color: "--ink", height: 86, xs: Array.from(GRID_E) });
  const residual = Array.from(s.I, (v, i) => v - r.denoised[i]);
  const lim = Math.max(...residual.map(Math.abs)) * 1.4;
  sparkline($('[data-viz="noise"]'), residual, { color: "--accent", height: 86, area: false, stroke: 1.2, min: -lim, max: lim });
  // what the model reads per band: mean |z| of the standardised coefficients
  const svgB = $('[data-viz="bands"]');
  const wB = Math.max(160, Math.round(svgB.getBoundingClientRect().width));
  svgB.setAttribute("viewBox", `0 0 ${wB} 86`);
  const { json } = await getModel();
  const z = Array.from(r.features, (v, i) => Math.abs((v - json.scaler.mean[i]) / json.scaler.scale[i]));
  const meanZ = model.bands.map((b) => z.slice(b.start, b.start + b.length).reduce((a, v) => a + v, 0) / b.length);
  const zMax = Math.max(...meanZ);
  const share = meanZ.map((v) => v / zMax);
  const bw = (wB - 16) / share.length;
  svgB.innerHTML = share.map((v, i) => {
    const h = 6 + v * 64;
    return `<rect x="${8 + i * bw + 3}" y="${78 - h}" width="${bw - 6}" height="${h}" rx="3" style="fill:var(--ink);opacity:${0.25 + 0.75 * v}" data-tip="<div class='tt-h'>${model.bands[i].name} · ${model.bands[i].length} coefficients</div><div class='tt-r'><span>mean |z|</span><b>${meanZ[i].toFixed(2)}</b></div>"/>`
      + `<text x="${8 + i * bw + bw / 2}" y="86" text-anchor="middle" style="font-size:8.5px">${model.bands[i].name}</text>`;
  }).join("");
  tips(svgB);
  // margin built up tree by tree, detected analytes
  const svgT = $('[data-viz="trees"]');
  const wT = Math.max(160, Math.round(svgT.getBoundingClientRect().width));
  svgT.setAttribute("viewBox", `0 0 ${wT} 86`);
  const contrib = model.contributions(r.features);
  const cums = contrib.map((c) => { let a = 0; return Array.from(c, (v) => (a += v)); });
  const all = cums.flat();
  const sx = lin(0, 299, 6, wT - 6);
  const sy = lin(Math.min(...all, 0), Math.max(...all, 0), 80, 6);
  svgT.innerHTML = `<line x1="6" x2="${wT - 6}" y1="${sy(0)}" y2="${sy(0)}" style="stroke:var(--axis)"/>`
    + cums.map((c, k) => `<path d="${path(c.map((_, i) => i), c, sx, sy)}" style="fill:none;stroke:var(${ANALYTES[k].color});stroke-width:1.8;opacity:${r.detected[k] ? 1 : 0.35}"/>`).join("");
  // decisions
  const svgD = $('[data-viz="decide"]');
  const wD = Math.max(160, Math.round(svgD.getBoundingClientRect().width));
  svgD.setAttribute("viewBox", `0 0 ${wD} 86`);
  svgD.innerHTML = ANALYTES.map((a, k) => {
    const y = 10 + k * 18;
    const x0 = 44;
    const ww = wD - x0 - 10;
    return `<text x="8" y="${y + 8}" style="font-size:9.5px;fill:var(--ink-2)">${a.code}</text><rect x="${x0}" y="${y}" width="${ww}" height="8" rx="4" style="fill:var(--surface-3)"/>`
      + `<rect x="${x0}" y="${y}" width="${Math.max(2, ww * r.probs[k])}" height="8" rx="4" style="fill:var(${a.color})"/><line x1="${x0 + ww * model.thresholds[k]}" x2="${x0 + ww * model.thresholds[k]}" y1="${y - 3}" y2="${y + 11}" style="stroke:var(--ink);stroke-width:1.4"/>`;
  }).join("");
}
let pipelineDrawn = false;
const pipeObs = new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting) && !pipelineDrawn) {
    pipelineDrawn = true;
    pipeObs.disconnect();
    drawPipeline().catch((err) => console.error(err));
  }
}, { rootMargin: "300px 0px" });
pipeObs.observe($("#steps"));

/* ───────────── Resize ───────────── */
let rz;
addEventListener("resize", () => {
  clearTimeout(rz);
  rz = setTimeout(() => {
    if (current) drawReadout(current, samples[SHOWCASE[index]], false);
    drawPfi();
    if (pipelineDrawn) drawPipeline();
  }, 160);
});
