// App state and wiring: load model + library, run the staged analysis, render the step panels.

import { createModel } from "./engine/model.js";
import { occlusion } from "./engine/xai.js";
import { createSignalChart, coefChart, residualChart, stripChart, heatChart, profileChart } from "./chart.js";
import { parseText, toGrid, toCsv, gridE } from "./io.js";
import { createAssistant } from "./assistant.js";
import { $, $$, esc, conc, pct, amp, fmtI, currentUnit, countUp, toast, sleep, nextFrame, segmented, download, reducedMotion } from "./ui.js";

const CODES = ["AA", "5-HT", "2E", "Mela"];
const STEPS = ["measure", "preprocess", "detect", "explain"];
const E = gridE();

const S = {
  model: null, modelJson: null, library: null,
  libResults: [], bench: null, parity: null,
  sample: null, qc: null, result: null, occ: null,
  xai: { width: 5, fill: "R3", scale: "logit", analyte: 0 },
  global: new Map(),
  step: "measure",
  done: new Set(),
  layers: { raw: true, denoised: true, blank: false, xai: true },
  filter: { poly: "all", mix: "all", q: "" },
  timings: null,
};

const chart = createSignalChart($("#chart"), $("#chartWrap"));
const assistant = createAssistant({
  log: $("#chatLog"), suggest: $("#chatSuggest"), form: $("#chatForm"), input: $("#chatText"),
  ctx: () => ({
    result: S.result, occ: S.occ, qc: S.qc, analytes: S.model?.analytes ?? [], thresholds: S.model?.thresholds ?? [],
    E, widthMv: S.xai.width * 4, labels: S.sample?.labels ?? null, bench: S.bench,
  }),
  actions: { explain: () => explain({ quiet: true }) },
});

/* ───────────── Loading ───────────── */

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function boot() {
  wireStatic();
  assistant.reset();
  try {
    const [modelJson, library] = await Promise.all([fetchJson("data/model.json"), fetchJson("data/library.json")]);
    S.modelJson = modelJson;
    S.model = createModel(modelJson);
    S.library = library.samples.map(toSample);
    S.acquisition = library.acquisition;
  } catch (err) {
    $("#modelPill").dataset.state = "error";
    $(".model-pill-text").textContent = "Model failed to load";
    $("#chartEmpty").innerHTML = `<span>Could not load the model: ${esc(err.message)}</span>`;
    return;
  }
  // Score the held-out library once: benchmark, reference check and the Detect strip all read it.
  const t0 = performance.now();
  S.libResults = S.library.map((s) => S.model.score(s.I).probs);
  const libMs = performance.now() - t0;
  S.bench = benchmark();
  S.parity = parityCheck();
  S.libMs = libMs;

  $("#modelPill").dataset.state = "ready";
  $(".model-pill-text").textContent = "Model ready";
  $("#resThr").textContent = `threshold ≈ ${S.model.thresholds[0].toFixed(2)}`;
  renderLibrary();
  const featured = S.library.find((s) => s.file === "20250623_MC325_SWV_Ch1_Ch2_1000nM2E_70nM5HT_1.txt") ?? S.library[0];
  await selectSample(featured, { silent: true });
  await analyze({ fast: false });
  await explain({ quiet: true });
}

function toSample(s, index) {
  const present = s.labels_nM.map((v, k) => (v > 0 ? k : -1)).filter((k) => k >= 0);
  const rep = s.file.match(/_(\d+)\.txt$/)?.[1];
  const electrode = s.file.match(/_(Ch\d+)/)?.[1] ?? `ch ${s.channel}`;
  return {
    source: "library", index, id: s.id, file: s.file, chip: s.chip, date: s.date, polymer: s.polymer,
    channel: s.channel, electrode, rep, block: s.block, blankCount: s.blank_count,
    labels: s.labels_nM, present, I: Float64Array.from(s.I), blank: s.blank ? Float64Array.from(s.blank) : null,
    ref: s.ref,
    title: present.length ? present.map((k) => `${CODES[k]} ${conc(s.labels_nM[k])}`).join(" + ") : "Blank (no analyte)",
  };
}

/* ───────────── Library ───────────── */

function renderLibrary() {
  const { poly, mix, q } = S.filter;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const items = S.library.filter((s) => {
    if (poly !== "all" && s.polymer !== poly) return false;
    const n = s.present.length;
    if (mix !== "all" && (mix === "3" ? n < 3 : n !== +mix)) return false;
    const hay = `${s.title} ${s.file} ${s.chip} ${s.polymer} ${s.date}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const list = $("#libList");
  list.replaceChildren(...items.map((s, i) => {
    const li = document.createElement("li");
    li.className = "lib-item";
    li.setAttribute("role", "option");
    li.tabIndex = 0;
    li.dataset.index = s.index;
    li.setAttribute("aria-selected", String(S.sample?.id === s.id));
    li.style.animationDelay = `${Math.min(i, 14) * 18}ms`;
    li.innerHTML = `<span class="li-title">${esc(s.title)}</span>
      <span class="li-dots" aria-hidden="true">${CODES.map((_, k) => `<i style="--c:var(--a${k})" ${s.labels[k] > 0 ? "data-on" : ""}></i>`).join("")}</span>
      <span class="li-sub">${esc(s.chip)} · ${esc(s.polymer)} · ${esc(s.electrode)}${s.rep ? ` · rep ${s.rep}` : ""}</span>`;
    return li;
  }));
  $("#libCount").textContent = `${items.length} of ${S.library.length} curves`;
}

function markLibrarySelection() {
  for (const li of $$(".lib-item")) li.setAttribute("aria-selected", String(S.sample?.source === "library" && +li.dataset.index === S.sample.index));
}

/* ───────────── Sample selection ───────────── */

async function selectSample(sample, { silent = false } = {}) {
  S.sample = sample;
  S.xaiPicked = false;
  S.result = null;
  S.occ = null;
  S.done = new Set(["measure"]);
  S.qc = measureQc(sample.I);
  S.unit = currentUnit(Math.max(...sample.I.map(Math.abs)));
  $("#chartEmpty").hidden = true;
  $("#fhName").textContent = sample.file;
  setBadge($("#fhStatus"), "idle", "Ready to analyze");
  $("#fhMeta").textContent = sample.source === "library"
    ? `${sample.polymer} · ${sample.chip} · held-out curve #${sample.index + 1}`
    : `${sample.sourceLabel} · ${sample.inputPoints} points read`;
  $("#fileChip").hidden = false;
  $(".fc-name").textContent = sample.file;
  $("#analyzeBtn").disabled = false;
  $("#analyzeBtn").classList.add("attn");
  $("#resetBtn").disabled = false;
  $("#explainBtn").disabled = true;
  $("#runTimer").textContent = "";
  $('[data-layer="blank"]').disabled = !sample.blank;
  if (!sample.blank) S.layers.blank = false;
  syncLayerButtons();
  markLibrarySelection();
  renderResults();
  setStep("measure");
  drawChart(true);
  assistant.renderSuggestions();
  if (!silent && sample.source === "upload") assistant.notify(`Loaded <b>${esc(sample.file)}</b> (${esc(sample.sourceLabel)}). Press <b>Analyze</b> when ready.`);
}

function measureQc(I) {
  const { signal, sigma } = S.model.denoise(I);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of signal) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const peaks = findPeaks(signal, 0.04 * (hi - lo));
  const main = peaks[0];
  return {
    peaks, sigma, span: hi - lo, drift: I[I.length - 1] - I[0],
    mainE: main ? E[main.index] : null, mainProm: main?.prominence ?? 0,
    snr: (main?.prominence ?? hi - lo) / Math.max(sigma, 1e-12),
  };
}

/** Interior local maxima ranked by topographic prominence (scipy.signal definition), at most 3.
 *  The first and last 20 mV are skipped: the scan's start-up transient is not a peak. */
function findPeaks(y, minProminence) {
  const out = [];
  for (let i = 5; i < y.length - 5; i++) {
    if (!(y[i] > y[i - 1] && y[i] >= y[i + 1])) continue;
    let leftMin = y[i];
    for (let j = i - 1; j >= 0 && y[j] <= y[i]; j--) leftMin = Math.min(leftMin, y[j]);
    let rightMin = y[i];
    for (let j = i + 1; j < y.length && y[j] <= y[i]; j++) rightMin = Math.min(rightMin, y[j]);
    const prominence = y[i] - Math.max(leftMin, rightMin);
    if (prominence >= minProminence) out.push({ index: i, prominence });
  }
  return out.sort((a, b) => b.prominence - a.prominence).slice(0, 3);
}

/* ───────────── Analysis ───────────── */

async function analyze({ fast = false } = {}) {
  if (!S.sample || !S.model) return;
  const btn = $("#analyzeBtn");
  btn.classList.remove("attn");
  btn.classList.add("busy");
  btn.disabled = true;
  $("#explainBtn").disabled = true;
  setBadge($("#fhStatus"), "run", "Analyzing…");
  setBadge($("#resBadge"), "run", "Running");
  S.result = null;
  S.occ = null;
  S.done = new Set();
  renderResults(true);
  const pause = fast ? 60 : 320;

  // 1 · measurement check
  setStepState("measure", "running");
  const I = S.sample.I;
  if (I.length !== 200 || !I.every(Number.isFinite)) {
    toast("The curve must hold 200 finite values on the model grid.", "error");
    finishBusy();
    return;
  }
  await sleep(pause);
  S.done.add("measure");
  setStepState("measure", "done");

  // 2 · preprocessing (timed for real)
  setStepState("preprocess", "running");
  const t = performance.now();
  const den = S.model.denoise(I);
  const t1 = performance.now();
  const feats = S.model.features(den.signal);
  const t2 = performance.now();
  await sleep(pause);
  S.done.add("preprocess");
  setStepState("preprocess", "done");
  S.result = { denoised: den.signal, sigma: den.sigma, lambda: den.lambda, features: feats };
  drawChart(true);

  // 3 · detection
  setStepState("detect", "running");
  const t3 = performance.now();
  const full = S.model.score(I);
  const t4 = performance.now();
  await sleep(pause);
  S.result = { ...full };
  S.timings = { denoise: t1 - t, features: t2 - t1, trees: t4 - t3 };
  S.done.add("detect");
  setStepState("detect", "done");

  finishBusy();
  $("#explainBtn").disabled = false;
  setBadge($("#fhStatus"), "done", "Analysis complete");
  const nDet = S.result.detected.filter(Boolean).length;
  setBadge($("#resBadge"), "done", `${nDet} of 4 detected`);
  $("#runTimer").textContent = `Pipeline ${(S.timings.denoise + S.timings.features + S.timings.trees).toFixed(2)} ms · computed in your browser`;
  renderResults();
  setStep("detect");
  assistant.renderSuggestions();
}

function finishBusy() {
  const btn = $("#analyzeBtn");
  btn.classList.remove("busy");
  btn.disabled = false;
}

async function explain({ quiet = false } = {}) {
  if (!S.result) return;
  const btn = $("#explainBtn");
  btn.classList.add("busy");
  setStepState("explain", "running");
  await nextFrame();
  const reference = S.xai.fill === "R1" ? S.model.r1[S.sample.polymer] : null;
  if (S.xai.fill === "R1" && !reference) { S.xai.fill = "R3"; toast("Training-mean fill needs the polymer; uploaded curves use the linear bridge.", "info"); }
  const t = performance.now();
  S.occ = occlusion(S.model, S.sample.I, { width: S.xai.width, fill: S.xai.fill, reference });
  S.occMs = performance.now() - t;
  if (!quiet || !S.xaiPicked) S.xai.analyte = defaultAnalyte();
  await sleep(quiet ? 120 : 380);
  btn.classList.remove("busy");
  S.done.add("explain");
  setStepState("explain", "done");
  S.layers.xai = true;
  syncLayerButtons();
  setStep("explain");
  drawChart(false);
}

function defaultAnalyte() {
  const p = S.result.probs;
  const det = p.map((v, k) => [v, k]).filter(([, k]) => S.result.detected[k]);
  // the detected analyte whose decision depends most on one window is the most instructive
  if (S.occ && det.length) return det.map(([, k]) => [Math.max(...S.occ.units.map((u) => u.dlogit[k])), k]).sort((a, b) => b[0] - a[0])[0][1];
  return p.indexOf(Math.max(...p));
}

function reset() {
  if (!S.sample) return;
  selectSample(S.sample, { silent: true });
}

/* ───────────── Chart ───────────── */

function drawChart(animate) {
  if (!S.sample) return;
  const k = S.xai.analyte;
  const name = S.model.analytes[k].name;
  const key = S.xai.scale === "logit" ? "dlogit" : "dp";
  const regions = S.occ ? { label: CODES[k], scale: S.xai.scale, units: S.occ.units.map((u) => ({ i0: u.i0, i1: u.i1, value: u[key][k] })) } : null;
  const parts = ["solid: measured"];
  if (S.result?.denoised && S.layers.denoised) parts.push("glow: denoised");
  if (regions && S.layers.xai) parts.push(`shaded: key regions for ${name}`);
  chart.render({
    E, raw: S.sample.I, denoised: S.result?.denoised ?? null, blank: S.sample.blank, regions,
    layers: S.layers, note: parts.join(" · "), unit: S.unit, peaks: S.qc.peaks,
  }, { animate });
  $("#chartCaption").textContent = S.result ? `σ ${fmtI(S.result.sigma)} · λ ${fmtI(S.result.lambda)}` : "";
}

function syncLayerButtons() {
  for (const b of $$("#layerToggles .layer")) {
    const key = b.dataset.layer;
    b.setAttribute("aria-pressed", String(!!S.layers[key]));
    if (key === "denoised") b.disabled = !S.result?.denoised;
    if (key === "xai") b.disabled = !S.occ;
  }
}

/* ───────────── Steps ───────────── */

function setStep(step) {
  S.step = step;
  for (const b of $$(".step")) {
    if (b.dataset.step === step) b.setAttribute("aria-current", "step");
    else b.removeAttribute("aria-current");
  }
  for (const p of $$(".step-panel")) p.hidden = p.dataset.panel !== step;
  renderPanel(step);
}

function setStepState(step, state) {
  const b = $(`.step[data-step="${step}"]`);
  if (state) b.dataset.state = state; else delete b.dataset.state;
  syncSteps();
}

function syncSteps() {
  STEPS.forEach((s, i) => {
    const b = $(`.step[data-step="${s}"]`);
    if (S.done.has(s)) b.dataset.state = "done";
    else if (b.dataset.state !== "running") delete b.dataset.state;
    const rail = $$(".step-rail")[i - 1];
    if (rail) rail.toggleAttribute("data-on", S.done.has(s));
  });
}

function renderPanel(step) {
  syncSteps();
  ({ measure: panelMeasure, preprocess: panelPreprocess, detect: panelDetect, explain: panelExplain })[step]();
}

const head = (n, title, sub, right = "") => `
  <div class="panel-head"><div><p class="eyebrow">Step ${n}</p><h2 class="panel-title">${title}</h2><p class="panel-sub">${sub}</p></div>${right}</div>`;

const emptyState = (icon, text, action) => `
  <div class="empty-state">${icon}<p>${text}</p>${action ?? ""}</div>`;
const ICON_WAVE = `<svg viewBox="0 0 48 48"><path d="M4 30c6 0 6-16 12-16s6 22 12 22 6-12 12-12 4 6 4 6"/></svg>`;

/* 01 · Measurement */
function panelMeasure() {
  const s = S.sample;
  const el = $("#panelMeasure");
  if (!s) { el.innerHTML = emptyState(ICON_WAVE, "Load a curve from the library or upload one."); return; }
  const acq = s.source === "library" ? S.acquisition : (s.params ?? {});
  const known = (v, unit, from) => v == null || Number.isNaN(v) ? `<span class="src">not in file</span>` : `${v} ${unit}${from ? `<span class="src">${from}</span>` : ""}`;
  const fromFile = s.source === "upload" && s.params?.instrument ? "file header" : "";
  const acqRows = s.source === "library" || s.params?.instrument ? [
    ["Technique", "Square-wave voltammetry"],
    ["Instrument", acq.instrument ?? "CHI760F"],
    ["Potential window", `${(acq.init_E ?? 0).toFixed(3)} → ${(acq.final_E ?? 0.8).toFixed(3)} V`],
    ["Step", known(acq.incr_E != null ? (acq.incr_E * 1000).toFixed(0) : null, "mV", fromFile)],
    ["Amplitude", known(acq.amplitude != null ? (acq.amplitude * 1000).toFixed(0) : null, "mV", fromFile)],
    ["Frequency", known(acq.frequency, "Hz", fromFile)],
    ["Quiet time", known(acq.quiet_time, "s", fromFile)],
  ] : [
    ["Technique", "Assumed square-wave voltammetry"],
    ["Source", esc(s.sourceLabel)],
    ["Points read", `${s.inputPoints}`],
    ["Range read", `${s.inputRange[0].toFixed(3)} → ${s.inputRange[1].toFixed(3)} V`],
    ["Units", esc(s.params?.note ?? "potential V, current µA")],
  ];
  const sampleRows = s.source === "library" ? [
    ["Chip", esc(s.chip)], ["Coating", esc(s.polymer)], ["Electrode", esc(s.electrode)],
    ["Recorded", `${s.date.slice(0, 4)}-${s.date.slice(4, 6)}-${s.date.slice(6, 8)}`],
    ["Replicate", s.rep ?? "—"], ["Blank traces", `${s.blankCount}`],
  ] : [
    ["File", esc(s.file)], ["Channel", esc(s.channelName)], ["Coating", "unknown"],
    ...(s.params?.acquired ? [["Recorded", esc(s.params.acquired)]] : []),
    ["Resampled", s.resampled ? "yes, linear onto the model grid" : "no, already on the grid"],
  ];
  const kv = (rows) => `<dl class="kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  const q = S.qc;
  const channelSeg = s.channels?.length > 1 ? `<div class="seg seg-sm" id="chanSeg" role="radiogroup" aria-label="Working electrode">${s.channels.map((c, i) => `<button role="radio" data-v="${i}" aria-checked="${i === s.channelIndex}">${esc(c.name)}</button>`).join("")}</div>` : "";
  el.innerHTML = `
    ${head("01", "Measurement", "What was recorded, and whether the curve is fit for the model. Peaks are read from the wavelet-denoised trace and ranked by prominence.", channelSeg)}
    <div class="tiles" style="margin-bottom:18px">
      <div class="tile"><div class="tile-k">Main peak</div><div class="tile-v">${q.mainE != null ? `<span data-count="${q.mainE}" data-dec="3">0</span><small>V</small>` : "none"}</div><div class="tile-s">${q.mainE != null ? `prominence ${fmtI(q.mainProm)}` : "no interior maximum above 4% of the span"}</div></div>
      <div class="tile" style="animation-delay:60ms"><div class="tile-k">Peaks found</div><div class="tile-v"><span data-count="${q.peaks.length}" data-dec="0">0</span></div><div class="tile-s">${q.peaks.length ? q.peaks.map((p) => `${E[p.index].toFixed(3)} V`).join(" · ") : "—"}</div></div>
      <div class="tile" style="animation-delay:120ms"><div class="tile-k">Noise σ (wavelet MAD)</div><div class="tile-v">${fmtI(q.sigma)}</div><div class="tile-s">from the finest detail band</div></div>
      <div class="tile" style="animation-delay:180ms"><div class="tile-k">Peak / noise</div><div class="tile-v">${q.snr > 1e5 ? "&gt;10⁵" : `<span data-count="${q.snr}" data-dec="0">0</span>`}<small>×</small></div><div class="tile-s">${q.snr > 50 ? "clean enough to read" : "noisy — read with care"}</div></div>
    </div>
    <div class="cols">
      <div><p class="section-label">Acquisition</p>${kv(acqRows)}</div>
      <div><p class="section-label">Sample</p>${kv(sampleRows)}</div>
    </div>
    <div style="margin-top:18px">
      <p class="section-label">${s.labels ? "Prepared composition (label)" : "Composition"}</p>
      ${s.labels ? `<div class="comp">${S.model.analytes.map((a, k) => `<span class="comp-chip" ${s.labels[k] > 0 ? "" : "data-off"} style="--c:var(--a${k})"><i></i>${esc(a.name)} <b>${conc(s.labels[k])}</b></span>`).join("")}</div>`
        : `<p class="hint">Unknown — uploaded curves carry no label, so the Detect step shows predictions only.</p>`}
      ${s.warnings?.length ? `<p class="hint" style="margin-top:10px;color:var(--warning)">${s.warnings.map(esc).join("<br>")}</p>` : ""}
    </div>`;
  for (const n of $$("[data-count]", el)) countUp(n, +n.dataset.count, { format: (v) => v.toFixed(+n.dataset.dec) });
  const seg = $("#chanSeg", el);
  if (seg) segmented(seg, (v) => useChannel(s, +v));
}

/* 02 · Preprocess */
function panelPreprocess() {
  const el = $("#panelPreprocess");
  const r = S.result;
  if (!r?.features) {
    el.innerHTML = head("02", "Preprocess", "Denoising and wavelet features, exactly as in training.") + emptyState(ICON_WAVE, "Run <b>Analyze</b> to compute the denoised curve and the 228 wavelet coefficients the model reads.");
    return;
  }
  const I = S.sample.I;
  const residual = Array.from(I, (v, k) => v - r.denoised[k]);
  const mu = mean(I);
  const energy = residual.reduce((a, v) => a + v * v, 0) / I.reduce((a, v) => a + (v - mu) ** 2, 0);
  const z = standardized(r.features);
  const gain = gainShare();
  const tm = S.timings ?? { denoise: 0, features: 0, trees: 0 };
  el.innerHTML = `
    ${head("02", "Preprocess", "The same chain the model was trained with, recomputed here for this curve.")}
    <div class="flow">
      <div class="flow-node"><div class="fn-k">Input</div><div class="fn-t">Raw current</div><div class="fn-d">200 points on 0.004–0.800 V; no blank subtraction (identity arm).</div><div class="fn-m"><span>range</span>${amp(Math.min(...I) * S.unit.f)}–${fmtI(Math.max(...I))}</div></div>
      <div class="flow-node" style="animation-delay:70ms"><div class="fn-k">Denoise</div><div class="fn-t">sym4 · 3 levels · soft</div><div class="fn-d">Universal threshold λ = σ√(2 ln 200), σ from the MAD of the finest band.</div><div class="fn-m"><span>λ</span>${fmtI(r.lambda)}</div></div>
      <div class="flow-node" style="animation-delay:140ms"><div class="fn-k">Features</div><div class="fn-t">DWT rbio1.3 · 6 levels</div><div class="fn-d">All coefficients kept, ordered cA6, cD6 … cD1.</div><div class="fn-m"><span>coefficients</span>228</div></div>
      <div class="flow-node" style="animation-delay:210ms"><div class="fn-k">Scale</div><div class="fn-t">Standardise</div><div class="fn-d">z-score with the training means and spreads.</div><div class="fn-m"><span>max |z|</span>${Math.max(...z.map(Math.abs)).toFixed(1)}</div></div>
      <div class="flow-node" style="animation-delay:280ms"><div class="fn-k">Classify</div><div class="fn-t">4 × LightGBM</div><div class="fn-d">One binary model per analyte, 300 trees, 31 leaves each.</div><div class="fn-m"><span>trees read</span>1,200</div></div>
    </div>
    <div class="mini-grid">
      <div>
        <p class="section-label">Standardised wavelet coefficients</p>
        <svg class="mini-chart" id="coefChart" role="img" aria-label="Standardised coefficients by wavelet band"></svg>
        <p class="caption">Bars are this curve's 228 inputs, grouped by band (cA6 coarse → cD1 fine). Opacity follows each coefficient's share of the model's total split gain; the coarse bands carry most of it.</p>
      </div>
      <div>
        <p class="section-label">What the denoiser removed</p>
        <svg class="mini-chart" id="resChart" role="img" aria-label="Measured minus denoised current"></svg>
        <p class="caption">Measured − denoised, in ${S.unit.u}; the band is ±λ. ${energy < 1e-4 ? "Less than 0.01%" : pct(energy, 2)} of the signal's variance was removed. Timed here: denoise ${tm.denoise.toFixed(2)} ms, features ${tm.features.toFixed(2)} ms, trees ${tm.trees.toFixed(2)} ms.</p>
      </div>
    </div>`;
  coefChart($("#coefChart"), z, S.model.bands, gain);
  residualChart($("#resChart"), E, residual, r.lambda, S.unit);
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const standardized = (f) => Array.from(f, (v, i) => (v - S.modelJson.scaler.mean[i]) / S.modelJson.scaler.scale[i]);
let gainCache = null;
function gainShare() {
  if (gainCache) return gainCache;
  const tot = new Float64Array(228);
  for (const h of S.modelJson.heads) h.gain.forEach((g, i) => { tot[i] += g; });
  const sum = tot.reduce((a, b) => a + b, 0);
  return (gainCache = Array.from(tot, (v) => v / sum));
}

/* 03 · Detect */
function panelDetect() {
  const el = $("#panelDetect");
  const r = S.result;
  if (!r?.probs) {
    el.innerHTML = head("03", "Detect", "Four independent present/absent decisions.") + emptyState(ICON_WAVE, "Run <b>Analyze</b> to score the curve.");
    return;
  }
  const s = S.sample;
  el.innerHTML = `
    ${head("03", "Detect", "Four independent present/absent decisions, one LightGBM model per analyte. A decision is “detected” when P(present) reaches the threshold.")}
    <div class="det-grid">${S.model.analytes.map((a, k) => {
      const p = r.probs[k];
      const truth = s.labels ? s.labels[k] > 0 : null;
      const ok = truth == null ? null : truth === r.detected[k];
      return `<article class="det-card" style="--c:var(--a${k});animation-delay:${k * 70}ms" ${r.detected[k] ? "data-on" : ""}>
        <div class="det-top"><span class="det-name"><i></i>${esc(a.name)}</span><span class="det-code">${CODES[k]}</span></div>
        <div class="det-p"><span data-count="${p * 100}">0</span><small>%</small></div>
        <div class="gauge" title="threshold ${S.model.thresholds[k].toFixed(3)}"><i data-w="${(p * 100).toFixed(2)}"></i><b style="left:${(S.model.thresholds[k] * 100).toFixed(2)}%"></b></div>
        <div class="gauge-scale"><span>0</span><span>threshold ${S.model.thresholds[k].toFixed(2)}</span><span>1</span></div>
        <div class="det-facts">
          <span>Decision <b>${r.detected[k] ? "detected" : "not detected"}</b></span>
          <span>Logit margin <b>${r.margins[k] >= 0 ? "+" : ""}${r.margins[k].toFixed(2)}</b></span>
          ${truth == null ? "<span>Label <b>—</b> (uploaded)</span>" : `<span>Label <b>${conc(s.labels[k])}</b> <span class="verdict" data-v="${ok ? "ok" : "bad"}">${ok ? `<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>matches` : `<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>disagrees`}</span></span>`}
        </div>
      </article>`;
    }).join("")}</div>
    ${s.source === "upload" ? `<p class="caption" style="color:var(--warning);margin-top:14px">This model learned from ACS-ML-Biomarker chips only (P4VP or PVDF coating, CHI760F, SWV 25 mV · 5 Hz). Curves from other electrodes, media or settings are outside what it has seen, and its probabilities will not show that.</p>` : ""}
    <div class="strip-wrap">
      <p class="section-label">Where this curve sits among the 125 held-out curves</p>
      <svg class="strip" id="stripChart" role="img" aria-label="Library probabilities per analyte"></svg>
      <p class="caption">Each dot is one held-out curve: coloured when the analyte is in it, grey when not. The ring is the current curve; the dashed tick is the threshold (${esc(S.modelJson.threshold_rule)}).</p>
    </div>`;
  for (const n of $$("[data-count]", el)) countUp(n, +n.dataset.count, { format: (v) => v.toFixed(1) });
  requestAnimationFrame(() => { for (const g of $$(".gauge > i", el)) g.style.width = `${g.dataset.w}%`; });
  stripChart($("#stripChart"), S.model.analytes, S.libResults, r.probs, S.model.thresholds, (i) => S.library[i].labels);
}

/* 04 · Explain */
function panelExplain() {
  const el = $("#panelExplain");
  if (!S.occ) {
    el.innerHTML = head("04", "Explain", "Which parts of the curve the decision depends on.") + emptyState(ICON_WAVE, S.result ? "Press <b>Explain prediction</b> to mask each window of the curve and measure how each decision moves." : "Run <b>Analyze</b> first, then explain.",
      S.result ? `<button class="btn btn-outline" id="explainInline">Explain prediction</button>` : "");
    $("#explainInline", el)?.addEventListener("click", () => explain());
    return;
  }
  const k = S.xai.analyte;
  const a = S.model.analytes[k];
  const canR1 = !!S.model.r1[S.sample.polymer];
  el.innerHTML = `
    ${head("04", "Explain", `Occlusion: each ${S.xai.width * 4} mV window is replaced in turn and the curve is re-scored. Red windows hold evidence for presence (masking them lowers the score); blue windows argue against it.`)}
    <div class="xai-controls">
      <div class="ctl"><div class="seg" id="xaiAnalyte" role="radiogroup" aria-label="Analyte">${S.model.analytes.map((x, i) => `<button role="radio" data-v="${i}" aria-checked="${i === k}">${CODES[i]}</button>`).join("")}</div></div>
      <div class="ctl"><label>Window</label><div class="seg" id="xaiWidth" role="radiogroup" aria-label="Window width"><button role="radio" data-v="5" aria-checked="${S.xai.width === 5}">20 mV</button><button role="radio" data-v="10" aria-checked="${S.xai.width === 10}">40 mV</button></div></div>
      <div class="ctl"><label>Fill</label><div class="seg" id="xaiFill" role="radiogroup" aria-label="Fill used for the masked window"><button role="radio" data-v="R3" aria-checked="${S.xai.fill === "R3"}" title="Straight line between the window's neighbours">Bridge</button><button role="radio" data-v="R1" aria-checked="${S.xai.fill === "R1"}" ${canR1 ? "title='Training mean curve of the same coating'" : "disabled title='Needs the coating; not known for uploads'"}>Train mean</button></div></div>
      <div class="ctl"><label>Scale</label><div class="seg" id="xaiScale" role="radiogroup" aria-label="Effect scale"><button role="radio" data-v="logit" aria-checked="${S.xai.scale === "logit"}">Log-odds</button><button role="radio" data-v="dp" aria-checked="${S.xai.scale === "dp"}">P</button></div></div>
    </div>
    <svg class="heat" id="heatChart" role="img" aria-label="Occlusion map for the four analytes"></svg>
    <div class="legend-ramp"><span>masking raises the score</span><i></i><span>masking lowers it</span><span style="margin-left:auto">${S.occ.units.length} windows × 4 analytes · ${S.occMs.toFixed(1)} ms</span></div>
    <div class="xai-grid">
      <div><p class="section-label">What influenced ${esc(a.name.toLowerCase())}</p><p class="xai-text">${narrative(k)}</p></div>
      <div><p class="section-label">Wavelet bands ${esc(a.name.toLowerCase())} relies on</p><div class="bands" id="bandBars"></div>
        <p class="caption">Share of this model's split gain per band, from training. Coarse bands (cA6, cD6) describe peak shape and position; fine bands (cD1, cD2) mostly noise.</p></div>
    </div>
    <div style="margin-top:22px">
      <div class="panel-head" style="margin-bottom:8px"><div><p class="section-label" style="margin:0">Across the 125 held-out curves</p></div><button class="chip-btn" id="globalBtn">${S.global.has(globalKey()) ? "Computed" : S.globalBusy === globalKey() ? "Computing…" : "Compute"}</button></div>
      <div class="legend">${S.model.analytes.map((x, i) => `<span style="--c:var(--a${i})"><i></i>${esc(x.name)}</span>`).join("")}</div>
      <div class="progress" id="globalProg" ${S.globalBusy === globalKey() ? "" : "hidden"}><i></i></div>
      <svg class="profile" id="profileChart" role="img" aria-label="Mean absolute occlusion effect per window across the library"></svg>
      <p class="caption">Mean |Δ ${S.xai.scale === "logit" ? "log-odds" : "P"}| per window across every held-out curve, same window and fill. Where a line peaks is where that model looks, independent of this one sample.</p>
    </div>`;
  heatChart($("#heatChart"), S.model.analytes, S.occ, E, k, (row) => pickAnalyte(row), S.xai.scale);
  segmented($("#xaiScale"), (v) => { S.xai.scale = v; renderPanel("explain"); drawChart(false); });
  segmented($("#xaiAnalyte"), (v) => pickAnalyte(+v));
  segmented($("#xaiWidth"), (v) => { S.xai.width = +v; explain({ quiet: true }); });
  segmented($("#xaiFill"), (v) => { S.xai.fill = v; explain({ quiet: true }); });
  renderBands(k);
  $("#globalBtn").addEventListener("click", computeGlobal);
  if (S.global.has(globalKey())) drawProfile();
  else computeGlobal();
}

function pickAnalyte(k) {
  S.xai.analyte = k;
  S.xaiPicked = true;
  renderPanel("explain");
  drawChart(false);
}

function renderBands(k) {
  const gain = S.modelJson.heads[k].gain;
  const total = gain.reduce((x, y) => x + y, 0) || 1;
  const rows = S.model.bands.map((b) => [b.name, gain.slice(b.start, b.start + b.length).reduce((x, y) => x + y, 0) / total]);
  const max = Math.max(...rows.map((r) => r[1]));
  $("#bandBars").innerHTML = rows.map(([n, v]) => `<div class="band-row"><span>${n}</span><div class="band-bar"><i style="--c:var(--a${k})" data-w="${(v / max) * 100}"></i></div><span>${pct(v, 1)}</span></div>`).join("");
  requestAnimationFrame(() => { for (const i of $$("#bandBars i")) i.style.width = `${i.dataset.w}%`; });
}

function narrative(k) {
  const occ = S.occ;
  const p = occ.base[k];
  const a = S.model.analytes[k].name;
  const thr = S.model.thresholds[k];
  const det = S.result.detected[k];
  const r = (u) => `<span class="mono">${(E[u.i0] - 0.002).toFixed(2)}–${(E[u.i1 - 1] + 0.002).toFixed(2)} V</span>`;
  const after = (u) => (p - u.dp[k]);
  const pos = [...occ.units].sort((x, y) => y.dlogit[k] - x.dlogit[k]);
  const neg = [...occ.units].sort((x, y) => x.dlogit[k] - y.dlogit[k]);
  const total = occ.units.reduce((acc, u) => acc + Math.abs(u.dlogit[k]), 0) || 1;
  const out = [`<b>${esc(a)}</b> is ${det ? "detected" : "not detected"}: P = <span class="mono">${p.toFixed(3)}</span>, log-odds <span class="mono">${occ.baseLogit[k].toFixed(1)}</span>.`];
  const top = pos[0];
  if (top.dlogit[k] > 1) {
    const flips = det && after(top) < thr;
    out.push(`The decision leans most on ${r(top)}: masking it lowers the log-odds by <span class="mono">${top.dlogit[k].toFixed(1)}</span> (P → <span class="mono">${after(top).toFixed(3)}</span>)${flips ? ", <b>enough to flip the call</b>" : ""}. That window carries ${pct(top.dlogit[k] / total)} of all masking effect for this analyte.`);
    if (pos[1].dlogit[k] > 1) out.push(`${r(pos[1])} is the next strongest (<span class="mono">−${pos[1].dlogit[k].toFixed(1)}</span>).`);
    if (det && !flips && p > 0.99) out.push(`P stays high under every single mask, so the evidence is redundant across windows.`);
  } else if (det) {
    out.push(`No window lowers the log-odds by more than 1: the evidence is spread across the curve.`);
  } else {
    out.push(`No window holds strong evidence for ${esc(a.toLowerCase())}.`);
  }
  if (neg[0].dlogit[k] < -1) out.push(`${r(neg[0])} pulls the other way — masking it raises the log-odds by <span class="mono">${(-neg[0].dlogit[k]).toFixed(1)}</span>.`);
  out.push(`<br><span style="color:var(--muted)">Occlusion explains the model, not the chemistry: a window matters because the classifier uses it, which need not be an oxidation peak of ${esc(a.toLowerCase())}.</span>`);
  return out.join(" ");
}

const globalKey = () => `${S.xai.width}|${S.xai.fill}`;
let globalRun = 0;

async function computeGlobal() {
  const key = globalKey();
  if (S.global.has(key)) { drawProfile(); return; }
  if (S.globalBusy === key) return;
  const run = ++globalRun;
  S.globalBusy = key;
  if ($("#globalProg")) $("#globalProg").hidden = false;
  if ($("#globalBtn")) $("#globalBtn").textContent = "Computing…";
  const U = Math.ceil(200 / S.xai.width);
  const acc = Array.from({ length: 4 }, () => new Float64Array(U));
  const accL = Array.from({ length: 4 }, () => new Float64Array(U));
  const opts = { width: S.xai.width, fill: S.xai.fill };
  for (let i = 0; i < S.library.length; i++) {
    const s = S.library[i];
    const o = occlusion(S.model, s.I, { ...opts, reference: opts.fill === "R1" ? S.model.r1[s.polymer] : null });
    o.units.forEach((u, j) => u.dp.forEach((d, k) => { acc[k][j] += Math.abs(d); accL[k][j] += Math.abs(u.dlogit[k]); }));
    if (i % 6 === 5) {
      const bar = $("#globalProg i");
      if (bar) bar.style.width = `${((i + 1) / S.library.length) * 100}%`;
      await nextFrame();
      if (globalKey() !== key) { if (run === globalRun) S.globalBusy = null; return; }
    }
  }
  const avg = (rows) => rows.map((a) => Array.from(a, (v) => v / S.library.length));
  S.global.set(key, { dp: avg(acc), logit: avg(accL) });
  if (run === globalRun) S.globalBusy = null;
  if (globalKey() === key && S.step === "explain") drawProfile();
}

function drawProfile() {
  const both = S.global.get(globalKey());
  const prof = both?.[S.xai.scale === "logit" ? "logit" : "dp"];
  const svg = $("#profileChart");
  if (!prof || !svg) return;
  if ($("#globalProg")) $("#globalProg").hidden = true;
  if ($("#globalBtn")) $("#globalBtn").textContent = "Computed";
  const w = S.xai.width;
  const centers = prof[0].map((_, j) => (E[j * w] + E[Math.min(199, j * w + w - 1)]) / 2);
  profileChart(svg, S.model.analytes, prof, centers);
}

/* ───────────── Results card ───────────── */

function renderResults(loading = false) {
  const box = $("#resRows");
  if (!S.model) return;
  const r = S.result?.probs ? S.result : null;
  const s = S.sample;
  box.innerHTML = S.model.analytes.map((a, k) => {
    const label = s?.labels ? conc(s.labels[k]) : "—";
    if (!r) {
      return `<div class="res-row" role="row" style="--c:var(--a${k});animation-delay:${k * 50}ms">
        <span class="res-name" role="cell"><i></i><span>${esc(a.name)}</span></span>
        <span class="res-status" role="cell">${loading ? '<span class="res-skel" style="display:block;width:70%"></span>' : "Pending"}</span>
        <span class="res-label" role="cell">${label}</span>
        <span class="res-p" role="cell"><span class="res-skel" style="flex:1"></span></span></div>`;
    }
    const on = r.detected[k];
    return `<div class="res-row" role="row" style="--c:var(--a${k});animation-delay:${k * 70}ms">
      <span class="res-name" role="cell"><i></i><span>${esc(a.name)}</span></span>
      <span class="res-status" role="cell" ${on ? "data-on" : ""}>${on ? "✓ Detected" : "– Not detected"}</span>
      <span class="res-label" role="cell" title="Prepared concentration (label)">${label}</span>
      <span class="res-p" role="cell"><span class="bar"><i data-w="${(r.probs[k] * 100).toFixed(2)}"></i><b style="left:${(S.model.thresholds[k] * 100).toFixed(2)}%"></b></span><span data-count="${r.probs[k] * 100}">0%</span></span></div>`;
  }).join("");
  if (!r) { if (!loading) setBadge($("#resBadge"), "idle", "Pending"); return; }
  requestAnimationFrame(() => { for (const i of $$(".res-p .bar i", box)) i.style.width = `${i.dataset.w}%`; });
  for (const n of $$("[data-count]", box)) countUp(n, +n.dataset.count, { format: (v) => `${v.toFixed(0)}%` });
}

function setBadge(el, tone, text) { el.dataset.tone = tone; el.textContent = text; }

/* ───────────── Model card ───────────── */

function benchmark() {
  return S.model.analytes.map((_, k) => {
    let tp = 0, tn = 0, fp = 0, fn = 0;
    S.library.forEach((s, i) => {
      const truth = s.labels[k] > 0;
      const det = S.libResults[i][k] >= S.model.thresholds[k];
      if (truth && det) tp++; else if (!truth && !det) tn++; else if (det) fp++; else fn++;
    });
    const sens = tp / Math.max(1, tp + fn);
    const spec = tn / Math.max(1, tn + fp);
    return { tp, tn, fp, fn, acc: (tp + tn) / S.library.length, sens, spec, ba: (sens + spec) / 2 };
  });
}

function parityCheck() {
  let maxDiff = 0;
  let flips = 0;
  S.library.forEach((s, i) => s.ref.forEach((p, k) => {
    maxDiff = Math.max(maxDiff, Math.abs(p - S.libResults[i][k]));
    if ((p >= S.model.thresholds[k]) !== (S.libResults[i][k] >= S.model.thresholds[k])) flips++;
  }));
  return { maxDiff, flips, n: S.library.length * 4 };
}

function openModelCard() {
  if (!S.model) return;
  const m = S.modelJson;
  const b = S.bench;
  const p = S.parity;
  $("#mcBody").innerHTML = `
    <p class="panel-sub" style="margin:0">One LightGBM classifier per analyte reads 228 wavelet coefficients of the denoised curve and answers present / absent. The model is the ENG XAI recipe, refitted once on the seed-0 outer-training partition and exported to run here unchanged.</p>
    <div class="cols">
      <div><p class="section-label">Recipe</p><dl class="kv">
        <div><dt>Task</dt><dd>4 independent binary heads</dd></div>
        <div><dt>Denoising</dt><dd>sym4 · L3 · soft universal</dd></div>
        <div><dt>Features</dt><dd>DWT rbio1.3 · L6 · 228</dd></div>
        <div><dt>Scaling</dt><dd>z-score (training)</dd></div>
        <div><dt>Classifier</dt><dd>LightGBM · lr 0.10 · 31 leaves · 300 trees</dd></div>
        <div><dt>Augmentation</dt><dd>${esc(m.recipe.augmentation.id)}</dd></div>
        <div><dt>Threshold</dt><dd>${esc(m.threshold_rule)}</dd></div>
      </dl></div>
      <div><p class="section-label">Provenance</p><dl class="kv">
        <div><dt>Training curves</dt><dd>${m.recipe.n_train_real.toLocaleString()} real (seed ${m.recipe.seed})</dd></div>
        <div><dt>Library</dt><dd>${S.library.length} held-out curves</dd></div>
        <div><dt>Exported</dt><dd>${esc(m.created)}</dd></div>
        <div><dt>LightGBM</dt><dd>${esc(m.versions.lightgbm)}</dd></div>
        <div><dt>PyWavelets</dt><dd>${esc(m.versions.pywavelets)}</dd></div>
        <div><dt>scikit-learn</dt><dd>${esc(m.versions["scikit-learn"])}</dd></div>
        <div><dt>Library scored in</dt><dd>${S.libMs.toFixed(0)} ms (this browser)</dd></div>
      </dl></div>
    </div>
    <div>
      <p class="section-label">Held-out check, computed in this browser</p>
      <table class="mc-table"><thead><tr><th>Analyte</th><th>Present</th><th>Absent</th><th>Accuracy</th><th>Balanced acc.</th><th>Sensitivity</th><th>Specificity</th></tr></thead>
      <tbody>${S.model.analytes.map((a, k) => `<tr><td>${esc(a.name)}</td><td>${b[k].tp + b[k].fn}</td><td>${b[k].tn + b[k].fp}</td><td>${pct(b[k].acc, 1)}</td><td>${pct(b[k].ba, 1)}</td><td>${pct(b[k].sens, 1)}</td><td>${pct(b[k].spec, 1)}</td></tr>`).join("")}</tbody></table>
      <p class="caption">One fitted model and one held-out partition (125 curves, 46 blocks). Replicates of a mixture share a block, so the curves are not independent; read these as a sanity check of the deployed model, not as a benchmark.</p>
    </div>
    <div>
      <p class="section-label">Reference check — browser vs Python</p>
      <div class="check-line" ${p.flips ? "data-bad" : ""}><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>
        <span><b>${p.flips} of ${p.n}</b> decisions differ from the Python reference; largest probability difference <span class="mono" style="font-family:var(--mono)">${p.maxDiff.toExponential(1)}</span>. The engine reimplements PyWavelets and LightGBM tree traversal in JavaScript; this check runs on every page load.</span></div>
    </div>`;
  $("#modelCard").showModal();
}

/* ───────────── Upload ───────────── */

async function handleFile(file) {
  if (!S.model) return;
  if (file.size > 5e6) { toast("That file is larger than 5 MB — is it a single voltammogram?", "error"); return; }
  try {
    const parsed = parseText(await file.text(), file.name);
    const sample = {
      source: "upload", file: file.name, sourceLabel: parsed.source, params: parsed.params,
      channels: parsed.channels, channelIndex: 0, E: parsed.E,
      inputPoints: parsed.E.length, inputRange: [Math.min(...parsed.E), Math.max(...parsed.E)],
      labels: null, blank: null, polymer: null,
    };
    applyChannel(sample, 0);
    if (parsed.channels.length > 1) toast(`Two working electrodes found (${parsed.channels.map((c) => c.name).join(", ")}); using ${parsed.channels[0].name}. Switch in the Measurement step.`, "info", 6000);
    for (const w of sample.warnings) toast(w, "info", 6000);
    await selectSample(sample);
  } catch (err) {
    toast(`Could not read ${file.name}: ${err.message}`, "error", 6000);
  }
}

function applyChannel(sample, i) {
  const ch = sample.channels[i];
  const g = toGrid(sample.E, ch.I);
  sample.channelIndex = i;
  sample.channelName = ch.name;
  sample.I = g.I;
  sample.resampled = g.resampled;
  sample.warnings = g.warnings;
}

function useChannel(sample, i) {
  applyChannel(sample, i);
  selectSample(sample, { silent: true });
}

/* ───────────── Static wiring ───────────── */

function wireStatic() {
  const dz = $("#dropzone");
  const input = $("#fileInput");
  $("#uploadBtn").addEventListener("click", () => input.click());
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { if (input.files[0]) handleFile(input.files[0]); input.value = ""; });
  for (const ev of ["dragenter", "dragover"]) dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); });
  for (const ev of ["dragleave", "drop"]) dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); });
  dz.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", (e) => { e.preventDefault(); if (!dz.contains(e.target) && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

  $("#libList").addEventListener("click", (e) => {
    const li = e.target.closest(".lib-item");
    if (li) selectSample(S.library[+li.dataset.index]);
  });
  $("#libList").addEventListener("keydown", (e) => {
    const li = e.target.closest(".lib-item");
    if (!li) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSample(S.library[+li.dataset.index]); }
    if (e.key === "ArrowDown") { e.preventDefault(); li.nextElementSibling?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); li.previousElementSibling?.focus(); }
  });
  $("#libSearch").addEventListener("input", (e) => { S.filter.q = e.target.value; renderLibrary(); });
  segmented($("#polyFilter"), (v) => { S.filter.poly = v; renderLibrary(); });
  segmented($("#mixFilter"), (v) => { S.filter.mix = v; renderLibrary(); });
  $("#randomBtn").addEventListener("click", async () => {
    if (!S.library) return;
    const pick = S.library[Math.floor(Math.random() * S.library.length)];
    await selectSample(pick);
    $(`.lib-item[data-index="${pick.index}"]`)?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  });

  $("#analyzeBtn").addEventListener("click", () => analyze());
  $("#resetBtn").addEventListener("click", reset);
  $("#explainBtn").addEventListener("click", () => explain());
  for (const b of $$(".step")) b.addEventListener("click", () => S.sample && setStep(b.dataset.step));
  $("#layerToggles").addEventListener("click", (e) => {
    const b = e.target.closest(".layer");
    if (!b || b.disabled) return;
    S.layers[b.dataset.layer] = !S.layers[b.dataset.layer];
    syncLayerButtons();
    drawChart(false);
  });

  $("#themeToggle").addEventListener("click", toggleTheme);
  $("#modelPill").addEventListener("click", openModelCard);
  $("#footerCard").addEventListener("click", openModelCard);
  $("#mcClose").addEventListener("click", () => $("#modelCard").close());
  $("#modelCard").addEventListener("click", (e) => { if (e.target === $("#modelCard")) $("#modelCard").close(); });

  $("#exampleCsv").addEventListener("click", () => {
    const s = S.sample?.source === "library" ? S.sample : S.library?.[0];
    if (!s) return;
    download(`example_${s.file.replace(/\.txt$/, "")}.csv`, toCsv({ current_uA: s.I }));
  });
  $("#exportCsv").addEventListener("click", () => {
    if (!S.sample) return;
    const cols = { measured_uA: S.sample.I };
    if (S.result?.denoised) cols.denoised_uA = S.result.denoised;
    if (S.sample.blank) cols.blank_uA = S.sample.blank;
    download(`${S.sample.file.replace(/\.(txt|csv|tsv)$/i, "")}_processed.csv`, toCsv(cols));
  });

  addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "a" && !$("#analyzeBtn").disabled) analyze();
    else if (key === "e" && !$("#explainBtn").disabled) explain();
    else if (key === "t") toggleTheme();
    else if (["1", "2", "3", "4"].includes(key) && S.sample) setStep(STEPS[+key - 1]);
  });

  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!S.sample) return;
      // redraw width-dependent charts without replaying the entrance animations
      document.documentElement.classList.add("still");
      renderPanel(S.step);
      setTimeout(() => document.documentElement.classList.remove("still"), 60);
    }, 150);
  });
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("pd-theme", next); } catch (e) { /* storage blocked */ }
  if (S.sample) {
    document.documentElement.classList.add("still");
    drawChart(false);
    renderPanel(S.step);
    setTimeout(() => document.documentElement.classList.remove("still"), 60);
  }
}

boot();
