// Method: a sticky figure that redraws for each step of the pipeline, on a real held-out curve.

import "../site.js";
import { $, $$, esc, fmtI, currentUnit, segmented, reducedMotion } from "../ui.js";
import { ANALYTES, GRID_E as E, getModel, getLibrary } from "../data.js";
import { wavedec, waverec } from "../engine/wavelet.js";
import { lin, path, extent, tips } from "../viz.js";

const EXAMPLES = [[38, "PVDF · three analytes"], [106, "P4VP · two analytes"], [60, "PVDF · ascorbic acid alone"]];
const TITLES = ["A square-wave scan", "Noise out, shape kept", "Seven views of one curve", "228 numbers", "Four forests, built tree by tree", "A threshold chosen on training data"];

const [{ json, model }, library] = await Promise.all([getModel(), getLibrary()]);
const svg = $("#scViz");
let step = 0;
let D = null;

/** Everything the six figures need, for one curve. */
function compute(index) {
  const s = library.samples[index];
  const r = model.score(s.I);
  const bank = json.wavelets["rbio1.3"];
  const coeffs = wavedec(r.denoised, bank, 6);
  const bandCurves = coeffs.map((_, b) => {
    const only = coeffs.map((c, j) => (j === b ? Float64Array.from(c) : new Float64Array(c.length)));
    return Array.from(waverec(only, bank)).slice(0, 200);
  });
  const z = Array.from(r.features, (v, i) => (v - json.scaler.mean[i]) / json.scaler.scale[i]);
  const cums = model.contributions(r.features).map((c) => { let a = 0; return [0, ...Array.from(c, (v) => (a += v))]; });
  const t0 = performance.now();
  for (let i = 0; i < 40; i++) model.score(s.I);
  const ms = (performance.now() - t0) / 40;
  const residual = Array.from(s.I, (v, i) => v - r.denoised[i]);
  const mu = s.I.reduce((a, b) => a + b, 0) / 200;
  const removed = residual.reduce((a, v) => a + v * v, 0) / s.I.reduce((a, v) => a + (v - mu) ** 2, 0);
  return { s, r, bandCurves, z, cums, ms, removed, unit: currentUnit(Math.max(...Array.from(s.I, Math.abs))) };
}

function frame(h) {
  const w = Math.max(300, Math.round(svg.getBoundingClientRect().width));
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.style.height = `${h}px`;
  return w;
}
const H = () => (innerWidth < 700 ? 300 : 400);

function axisX(sx, h, m) {
  return [0, 0.2, 0.4, 0.6, 0.8].map((v) => `<text x="${sx(v)}" y="${h - 8}" text-anchor="middle">${v.toFixed(1)} V</text>`).join("")
    + `<line class="grid" x1="${m.l}" x2="${sx(0.8)}" y1="${h - m.b}" y2="${h - m.b}"/>`;
}

const DRAW = [
  // 0 · raw scan
  () => {
    const h = H(); const w = frame(h); const m = { l: 46, r: 12, t: 18, b: 30 };
    const { s, unit } = D;
    const [lo, hi] = extent([s.I]);
    const sx = lin(0, 0.8, m.l, w - m.r); const sy = lin(lo - (hi - lo) * 0.08, hi + (hi - lo) * 0.08, h - m.b, m.t);
    let out = axisX(sx, h, m);
    for (const f of [0.25, 0.5, 0.75]) { const v = lo + (hi - lo) * f; out += `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${sy(v)}" y2="${sy(v)}"/><text x="${m.l - 8}" y="${sy(v) + 4}" text-anchor="end">${+(v * unit.f).toPrecision(3)}</text>`; }
    out += `<text x="${m.l - 8}" y="${m.t - 4}" text-anchor="end">I (${unit.u})</text>`;
    out += `<path class="trace draw-me" d="${path(E, s.I, sx, sy)}"/>`;
    for (let i = 0; i < 200; i += 9) out += `<circle cx="${sx(E[i])}" cy="${sy(s.I[i])}" r="1.8" style="fill:var(--ink);opacity:.35"/>`;
    svg.innerHTML = out;
    return `<b>${esc(s.title)}</b> · ${esc(s.polymer)} · chip ${esc(s.chip)}. Dots mark every ninth of the 200 recorded points.`;
  },
  // 1 · denoise
  () => {
    const h = H(); const w = frame(h); const m = { l: 46, r: 12, t: 18, b: 30 };
    const { s, r, unit, removed } = D;
    const [lo, hi] = extent([s.I]);
    const sx = lin(0, 0.8, m.l, w - m.r); const sy = lin(lo - (hi - lo) * 0.08, hi + (hi - lo) * 0.08, h - m.b - 70, m.t);
    const res = Array.from(s.I, (v, i) => v - r.denoised[i]);
    const lim = Math.max(...res.map(Math.abs), r.lambda) * 1.2;
    const sr = lin(-lim, lim, h - m.b - 4, h - m.b - 62);
    let out = axisX(sx, h, m);
    out += `<path d="${path(E, s.I, sx, sy)}" style="fill:none;stroke:var(--muted);stroke-width:1.2"/>`;
    out += `<path class="draw-me" d="${path(E, r.denoised, sx, sy)}" style="fill:none;stroke:var(--accent);stroke-width:2.2"/>`;
    out += `<rect x="${m.l}" y="${sr(r.lambda)}" width="${w - m.l - m.r}" height="${sr(-r.lambda) - sr(r.lambda)}" style="fill:var(--accent-soft)"/>`;
    out += `<path d="${path(E, res, sx, sr)}" style="fill:none;stroke:var(--ink-2);stroke-width:1"/>`;
    out += `<text x="${m.l}" y="${sr(lim) - 4}" style="fill:var(--ink-2)">removed noise ×1 · band ±λ</text>`;
    out += `<text x="${w - m.r}" y="${m.t}" text-anchor="end" style="fill:var(--accent)">denoised</text><text x="${w - m.r}" y="${m.t + 14}" text-anchor="end">measured</text>`;
    svg.innerHTML = out;
    return `σ = <b>${fmtI(r.sigma)}</b>, λ = <b>${fmtI(r.lambda)}</b>. The removed component is ${removed < 1e-4 ? "less than 0.01%" : `${(removed * 100).toFixed(2)}%`} of the curve's variance (lower panel, same unit as the curve).`;
  },
  // 2 · seven bands
  () => {
    const h = H() + 60; const w = frame(h); const m = { l: 46, r: 12, t: 8, b: 26 };
    const sx = lin(0, 0.8, m.l, w - m.r);
    const rowH = (h - m.t - m.b) / 7;
    let out = axisX(sx, h, m);
    D.bandCurves.forEach((c, b) => {
      const [lo, hi] = extent([c]);
      const y0 = m.t + b * rowH;
      const sy = lin(lo, hi, y0 + rowH - 6, y0 + 6);
      const name = model.bands[b].name;
      out += `<text x="${m.l - 8}" y="${y0 + rowH / 2 + 4}" text-anchor="end" style="fill:var(--ink-2)">${name}</text>`;
      out += `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${y0 + rowH}" y2="${y0 + rowH}"/>`;
      out += `<path d="${path(E, c, sx, sy)}" style="fill:none;stroke:var(--ink);stroke-width:${b < 2 ? 2 : 1.3};opacity:${1 - b * 0.09}" data-tip="<div class='tt-h'>${name} · ${model.bands[b].length} coefficients</div><div class='tt-r'><span>range</span><b>${fmtI(hi - lo)}</b></div>"/>`;
    });
    svg.innerHTML = out;
    tips(svg);
    return "Each row is one band rebuilt on its own and scaled to its own height; the seven rows add up to the denoised curve. Hover a row for its range.";
  },
  // 3 · z-scores
  () => {
    const h = H(); const w = frame(h); const m = { l: 34, r: 8, t: 14, b: 30 };
    const z = D.z;
    const lim = 4;
    const sy = lin(-lim, lim, h - m.b, m.t);
    const weight = model.bands.map((b) => Math.max(b.length, 14));
    const unitW = (w - m.l - m.r) / weight.reduce((a, b) => a + b, 0);
    let x = m.l;
    let out = "";
    for (const v of [-3, 0, 3]) out += `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${sy(v)}" y2="${sy(v)}" ${v ? 'stroke-dasharray="3 4"' : ""}/><text x="${m.l - 6}" y="${sy(v) + 4}" text-anchor="end">${v > 0 ? "+" : ""}${v}</text>`;
    model.bands.forEach((b, bi) => {
      const bw = (weight[bi] * unitW) / b.length;
      out += `<text x="${x + (weight[bi] * unitW) / 2}" y="${h - 10}" text-anchor="middle">${b.name}</text>`;
      for (let j = 0; j < b.length; j++) {
        const i = b.start + j;
        const v = Math.max(-lim, Math.min(lim, z[i]));
        const out3 = Math.abs(z[i]) > 3;
        out += `<rect x="${(x + j * bw + 0.4).toFixed(1)}" y="${Math.min(sy(0), sy(v)).toFixed(1)}" width="${Math.max(0.6, bw - 0.8).toFixed(1)}" height="${Math.max(0.6, Math.abs(sy(v) - sy(0))).toFixed(1)}" style="fill:var(${out3 ? "--accent" : "--ink"});opacity:${out3 ? 1 : 0.55}" data-tip="<div class='tt-h'>${b.name}[${j}] · feature ${i + 1}</div><div class='tt-r'><span>z</span><b>${z[i].toFixed(2)}</b></div>"/>`;
      }
      x += weight[bi] * unitW;
      if (bi < model.bands.length - 1) out += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${h - m.b + 4}" style="stroke:var(--line-strong)"/>`;
    });
    svg.innerHTML = out;
    tips(svg);
    const n3 = z.filter((v) => Math.abs(v) > 3).length;
    return `<b>${n3}</b> of 228 coefficients lie beyond ±3 (highlighted); the largest |z| is ${Math.max(...z.map(Math.abs)).toFixed(1)}. Bars are clipped at ±4.`;
  },
  // 4 · trees
  () => {
    const h = H(); const w = frame(h); const m = { l: 40, r: 110, t: 16, b: 30 };
    const { cums, r } = D;
    const [lo, hi] = extent(cums);
    const sx = lin(0, 300, m.l, w - m.r); const sy = lin(Math.min(lo, -1), Math.max(hi, 1), h - m.b, m.t);
    let out = `<line x1="${m.l}" x2="${w - m.r}" y1="${sy(0)}" y2="${sy(0)}" style="stroke:var(--axis)"/>`;
    for (const t of [0, 100, 200, 300]) out += `<text x="${sx(t)}" y="${h - 8}" text-anchor="middle">${t === 300 ? "300 trees" : t}</text>`;
    out += `<text x="${m.l - 8}" y="${sy(0) + 4}" text-anchor="end">0</text><text x="${m.l}" y="${m.t - 4}">log-odds</text>`;
    const ends = ANALYTES.map((a, k) => ({ k, y: sy(cums[k][300]) })).sort((p, q) => p.y - q.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
    ANALYTES.forEach((a, k) => {
      const xs = cums[k].map((_, i) => i);
      out += `<path class="draw-me" d="${path(xs, cums[k], sx, sy)}" style="fill:none;stroke:var(${a.color});stroke-width:2;opacity:${r.detected[k] ? 1 : 0.55}"/>`;
    });
    for (const e of ends) {
      const a = ANALYTES[e.k];
      out += `<circle cx="${sx(300)}" cy="${sy(cums[e.k][300])}" r="3.5" style="fill:var(${a.color})"/><text x="${sx(300) + 10}" y="${e.y + 4}" style="fill:var(--ink-2);font-family:var(--font);font-size:12px">${a.name} ${cums[e.k][300] >= 0 ? "+" : ""}${cums[e.k][300].toFixed(1)}</text>`;
    }
    svg.innerHTML = out;
    return "Running sum of the leaf values as the 300 trees of each model are added. The end value is the log-odds that becomes the probability.";
  },
  // 5 · decide
  () => {
    const h = H() - 60; const w = frame(h); const m = { l: 130, r: 70, t: 20, b: 34 };
    const { r } = D;
    const sx = lin(0, 1, m.l, w - m.r);
    const rowH = (h - m.t - m.b) / 4;
    let out = [0, 0.25, 0.5, 0.75, 1].map((v) => `<text x="${sx(v)}" y="${h - 10}" text-anchor="middle">${v}</text>`).join("");
    ANALYTES.forEach((a, k) => {
      const y = m.t + k * rowH + rowH / 2;
      const p = r.probs[k];
      out += `<text x="${m.l - 14}" y="${y + 4}" text-anchor="end" style="fill:var(--ink);font-family:var(--font);font-size:13px">${a.name}</text>`;
      out += `<rect x="${sx(0)}" y="${y - 7}" width="${sx(1) - sx(0)}" height="14" rx="7" style="fill:var(--surface-3)"/>`;
      out += `<rect class="grow" x="${sx(0)}" y="${y - 7}" width="${Math.max(3, sx(p) - sx(0))}" height="14" rx="7" style="fill:var(${a.color})"/>`;
      out += `<line x1="${sx(model.thresholds[k])}" x2="${sx(model.thresholds[k])}" y1="${y - 13}" y2="${y + 13}" style="stroke:var(--ink);stroke-width:1.6"/>`;
      out += `<text x="${sx(1) + 12}" y="${y + 4}" style="fill:var(--ink);font-family:var(--mono);font-size:12px">${r.detected[k] ? "✓" : "–"} ${(p * 100).toFixed(p > 0.995 || p < 0.005 ? 0 : 1)}%</text>`;
    });
    svg.innerHTML = out;
    const s = D.s;
    const ok = ANALYTES.every((_, k) => (s.labels[k] > 0) === r.detected[k]);
    return `Black ticks: the four thresholds. ${ok ? "All four calls match the prepared mixture" : "At least one call differs from the prepared mixture"} (${esc(s.title)}).`;
  },
];

function show(i, { force = false } = {}) {
  if (i === step && !force) return;
  step = i;
  $("#scStep").textContent = `${String(i + 1).padStart(2, "0")} / 06`;
  $("#scTitle").textContent = TITLES[i];
  const fig = $(".sc-card");
  fig.classList.remove("swap");
  void fig.offsetWidth;
  fig.classList.add("swap");
  $("#scCap").innerHTML = DRAW[i]();
  if (!reducedMotion()) {
    for (const p of $$(".draw-me", svg)) {
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len}`;
      p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 900, easing: "cubic-bezier(.16,1,.3,1)" });
    }
  }
  $$("#scProgress li").forEach((li, j) => li.toggleAttribute("data-on", j <= i));
  $$(".sc-text").forEach((t) => t.toggleAttribute("data-active", +t.dataset.step === i));
}

function setExample(index) {
  D = compute(index);
  $("#openInApp").href = `app.html#s=${index}`;
  $("#timeStat").innerHTML = `${D.ms.toFixed(2)}<small>ms</small>`;
  show(step, { force: true });
}

$("#exampleSeg").innerHTML = EXAMPLES.map(([i, label], j) => `<button role="radio" data-v="${i}" aria-checked="${j === 0}">${label}</button>`).join("");
segmented($("#exampleSeg"), (v) => setExample(+v));

const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) show(+e.target.dataset.step);
}, { rootMargin: "-45% 0px -45% 0px" });
for (const t of $$(".sc-text")) io.observe(t);

setExample(EXAMPLES[0][0]);
let rz;
addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => show(step, { force: true }), 150); });
