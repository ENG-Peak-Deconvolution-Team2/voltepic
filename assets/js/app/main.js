// Analyzer: state, loading, routing, the run, the sticky instrument and its companions.

import "../site.js";
import { observeReveal } from "../site.js";
import { $, $$, esc, conc, fmtI, currentUnit, toast, sleep, nextFrame, segmented, download, reducedMotion } from "../ui.js";
import { ANALYTES, CODES, GRID_E as E, getModel, getLibrary, getXai } from "../data.js";
import { occlusion } from "../engine/xai.js";
import { createSignalChart } from "../chart.js";
import { parseText, toGrid, toCsv } from "../io.js";
import { createAssistant } from "../assistant.js";
import { sparkline } from "../viz.js";
import * as R from "./report.js";

const FEATURED = 38;

/** Everything the report and the assistant read. */
export const S = {
  model: null, json: null, library: null, xai: null,
  libProbs: [], bench: null, parity: null,
  sample: null, unit: { f: 1, u: "µA" }, qc: null, result: null, timings: null, occ: null, occMs: 0,
  x: { method: "shap", shade: "pfi", width: 5, fill: "R1", scale: "logit", analyte: 0, polymer: "PVDF", userMethod: null, picked: false },
  view: "signal", viewPinned: 0,
  layers: { raw: true, denoised: false, blank: false, xai: false },
};

const chart = createSignalChart($("#chart"), $("#chartWrap"));
const assistant = createAssistant({
  log: $("#chatLog"), suggest: $("#chatSuggest"), form: $("#chatForm"), input: $("#chatText"),
  modeSeg: $("#asMode"), badge: $("#asBadge"),
  ctx: () => ({
    result: S.result, occ: S.occ, qc: S.qc, analytes: S.model?.analytes ?? [], thresholds: S.model?.thresholds ?? [],
    E, widthMv: S.x.width * 4, labels: S.sample?.labels ?? null, bench: S.bench, peakWindow,
    sample: S.sample, xai: S.xai, grid: S.json?.grid, acquisition: S.acquisition, width: S.x.width, fill: S.x.fill,
  }),
  actions: { explain: async () => {} },
});

/* ───────────── Boot ───────────── */
async function boot() {
  wire();
  assistant.reset();
  renderVerdicts(true);
  try {
    const [{ json, model }, library, xai] = await Promise.all([getModel(), getLibrary(), getXai()]);
    Object.assign(S, { json, model, library: library.samples, acquisition: library.acquisition, xai });
  } catch (err) {
    $("#chartLoading").innerHTML = `<span>Could not load the model: ${esc(err.message)}</span>`;
    return;
  }
  const t0 = performance.now();
  S.libProbs = S.library.map((s) => S.model.score(s.I).probs);
  S.libMs = performance.now() - t0;
  S.bench = benchmark();
  S.parity = parityCheck();
  $("#chartLoading").hidden = true;
  if (S.parity.flips) toast(`Reference check: ${S.parity.flips} decisions differ from Python.`, "error", 8000);
  renderLibrary();
  await route();
  addEventListener("hashchange", route);
}

async function route() {
  const h = location.hash;
  const m = h.match(/^#s=(\d+|random)$/);
  if (m) {
    const i = m[1] === "random" ? Math.floor(Math.random() * S.library.length) : Math.min(S.library.length - 1, +m[1]);
    if (S.sample?.source === "library" && S.sample.index === i) return;
    await loadSample(S.library[i]);
    return;
  }
  if (!S.sample) await loadSample(S.library[FEATURED]);
  if (h === "#upload") { toast("Drop a file anywhere on the page, or press Upload.", "info", 5000); $("#uploadBtn").focus(); }
  if (h === "#ask") openAssistant();
}

/* ───────────── The run ───────────── */
const STEPS = [["measure", "Measure"], ["pre", "Preprocess"], ["detect", "Detect"], ["explain", "Explain"]];

function trace(state = {}) {
  $("#runTrace").innerHTML = STEPS.map(([k, label]) => {
    const t = state[k];
    const attr = t === "run" ? "data-run" : t != null ? "data-done" : "";
    const icon = t === "run" ? '<circle cx="12" cy="12" r="7" stroke-dasharray="30 14"/>' : '<path d="M5 12.5l4.5 4.5L19 7"/>';
    const title = typeof t === "number" ? ` title="${label}: ${t.toFixed(2)} ms, measured in this browser"` : "";
    return `<span class="rt-step" ${attr}${title}><svg viewBox="0 0 24 24">${icon}</svg>${label}</span>`;
  }).join("") + (STEPS.every(([k]) => typeof state[k] === "number")
    ? `<span class="rt-total" title="Total time of the four steps in this browser">${STEPS.reduce((a, [k]) => a + state[k], 0).toFixed(2)} ms</span>` : "");
}

export async function loadSample(sample, { quiet = false } = {}) {
  S.sample = sample;
  S.result = null;
  S.occ = null;
  S.x.picked = false;
  if (sample.polymer) S.x.polymer = sample.polymer;
  S.x.method = sample.source === "library" && S.xai ? (S.x.userMethod ?? "shap") : "occlusion";
  if (S.x.fill === "R1" && !S.model.r1[sample.polymer]) S.x.fill = "R3";
  S.unit = currentUnit(Math.max(...Array.from(sample.I, Math.abs)));
  if (sample.source === "library") history.replaceState(null, "", `#s=${sample.index}`);
  else history.replaceState(null, "", location.pathname);
  renderToolbar();
  renderVerdicts(true);
  markLibrary();
  const pause = reducedMotion() ? 0 : 110;
  const done = {};
  trace({ measure: "run" });

  // 1 · measurement
  let t = performance.now();
  S.qc = measureQc(sample.I);
  done.measure = performance.now() - t;
  R.header(S, "measuring");
  drawChart(true);
  await sleep(pause);

  // 2 · preprocessing
  trace({ ...done, pre: "run" });
  t = performance.now();
  const den = S.model.denoise(sample.I);
  const feats = S.model.features(den.signal);
  done.pre = performance.now() - t;
  S.result = { denoised: den.signal, sigma: den.sigma, lambda: den.lambda, features: feats };
  await sleep(pause);

  // 3 · detection
  trace({ ...done, detect: "run" });
  t = performance.now();
  S.result = { ...S.model.score(sample.I) };
  done.detect = performance.now() - t;
  await sleep(pause);

  // 4 · explanation
  trace({ ...done, explain: "run" });
  t = performance.now();
  computeExplanation();
  done.explain = performance.now() - t;
  S.timings = done;
  S.x.analyte = defaultAnalyte();
  trace(done);

  renderVerdicts(false);
  R.render(S);
  observeReveal($("#report"));
  drawChart(false);
  assistant.renderSuggestions();
  if (!quiet && sample.source === "upload") assistant.notify(`Loaded <b>${esc(sample.file)}</b> (${esc(sample.sourceLabel)}). Ask me about it.`);
}

/** Recompute only the explanation (method, window or fill changed). */
export function reExplain() {
  const t = performance.now();
  computeExplanation();
  S.timings.explain = performance.now() - t;
  if (!S.x.picked) S.x.analyte = defaultAnalyte();
  trace(S.timings);
  R.renderExplain(S);
  drawChart(false);
  assistant.renderSuggestions();
}

/* ───────────── Measurement checks ───────────── */
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

/** Interior maxima ranked by topographic prominence (scipy definition), at most 3; the first and
 *  last 20 mV are skipped because the scan's start-up transient is not a peak. */
function findPeaks(y, minProminence) {
  const out = [];
  for (let i = 5; i < y.length - 5; i++) {
    if (!(y[i] > y[i - 1] && y[i] >= y[i + 1])) continue;
    let left = y[i];
    for (let j = i - 1; j >= 0 && y[j] <= y[i]; j--) left = Math.min(left, y[j]);
    let right = y[i];
    for (let j = i + 1; j < y.length && y[j] <= y[i]; j++) right = Math.min(right, y[j]);
    const prominence = y[i] - Math.max(left, right);
    if (prominence >= minProminence) out.push({ index: i, prominence });
  }
  return out.sort((a, b) => b.prominence - a.prominence).slice(0, 3);
}

/* ───────────── Explanation ───────────── */
const logit = (p) => { const q = Math.min(Math.max(p, 1e-12), 1 - 1e-12); return Math.log(q) - Math.log1p(-q); };
export const unitKey = () => (S.x.width === 5 ? "20mV" : "40mV");
export const shapAvailable = () => !!S.xai && S.sample?.source === "library";

/** E3 peak window of analyte k (PVDF only — the test found none on P4VP). */
export function peakWindow(k, polymer = S.sample?.polymer) {
  return S.xai?.windows?.[polymer]?.[ANALYTES[k].id] ?? null;
}

function computeExplanation() {
  if (S.x.method === "shap" && !shapAvailable()) S.x.method = "occlusion";
  if (S.x.fill === "R1" && !S.model.r1[S.sample.polymer]) S.x.fill = "R3";
  const t = performance.now();
  if (S.x.method === "shap") {
    const d = S.xai.shap[unitKey()];
    const i = S.sample.index;
    const w = S.x.width;
    S.occ = {
      method: "shap",
      units: d.logit[i].map((row, j) => ({ i0: j * w, i1: (j + 1) * w, dlogit: row, dp: d.probability[i][j] })),
      base: S.result.probs, baseLogit: S.result.probs.map(logit), refLogit: d.base_logit[i], refP: d.base_probability[i],
    };
  } else {
    const reference = S.x.fill === "R1" ? S.model.r1[S.sample.polymer] : null;
    S.occ = { method: "occlusion", ...occlusion(S.model, S.sample.I, { width: S.x.width, fill: S.x.fill, reference }) };
  }
  S.occMs = performance.now() - t;
}

function defaultAnalyte() {
  const p = S.result.probs;
  const det = p.map((v, k) => [v, k]).filter(([, k]) => S.result.detected[k]);
  if (S.occ && det.length) return det.map(([, k]) => [Math.max(...S.occ.units.map((u) => u.dlogit[k])), k]).sort((a, b) => b[0] - a[0])[0][1];
  return p.indexOf(Math.max(...p));
}

export function pickAnalyte(k) {
  S.x.analyte = k;
  S.x.picked = true;
  renderVerdicts(false);
  R.renderExplain(S);
  drawChart(false);
}

/* ───────────── Instrument ───────────── */
const VIEW_LAYERS = {
  signal: { raw: true, denoised: false, xai: false },
  pre: { raw: true, denoised: true, xai: false },
  explain: { raw: true, denoised: false, xai: true },
};

export function setView(view, { pin = false } = {}) {
  if (pin) S.viewPinned = performance.now();
  if (view === S.view && !pin) return;
  S.view = view;
  Object.assign(S.layers, VIEW_LAYERS[view]);
  for (const b of $$("#viewSeg button")) b.setAttribute("aria-selected", String(b.dataset.view === view));
  drawChart(false);
}

export function drawChart(animate) {
  if (!S.sample) return;
  const k = S.x.analyte;
  const key = S.x.scale === "logit" ? "dlogit" : "dp";
  const pfi = S.x.shade === "pfi" && S.xai;
  const w = S.x.width;
  let regions = null;
  if (S.occ) {
    regions = pfi
      ? { label: CODES[k], scale: "pfi", method: "pfi", units: S.xai.pfi[unitKey()][S.x.polymer][ANALYTES[k].id].importance.map((v, j) => ({ i0: j * w, i1: (j + 1) * w, value: Math.max(0, v) })) }
      : { label: CODES[k], scale: S.x.scale, method: S.occ.method, units: S.occ.units.map((u) => ({ i0: u.i0, i1: u.i1, value: u[key][k] })) };
  }
  const win = S.occ && S.layers.xai ? peakWindow(k, pfi ? S.x.polymer : S.sample.polymer) : null;
  $("#chart").classList.toggle("pre", S.view === "pre");
  chart.render({
    E, raw: S.sample.I, denoised: S.result?.denoised ?? null, blank: S.sample.blank, regions,
    layers: { ...S.layers, denoised: S.layers.denoised && !!S.result?.denoised },
    note: "", unit: S.unit, peaks: S.view === "signal" ? S.qc?.peaks : [],
    peakWindow: win ? { ...win, color: ANALYTES[k].color, label: `${CODES[k]} peak window` } : null,
  }, { animate });
  renderLegend(regions, win, pfi);
  const cap = { signal: "measured current", pre: `σ ${fmtI(S.result?.sigma ?? 0)} · λ ${fmtI(S.result?.lambda ?? 0)}`, explain: pfi ? `PFI · ${S.x.polymer} · ${ANALYTES[k].name}` : `${S.occ?.method === "shap" ? "SHAP · R2" : `occlusion · ${S.x.fill}`} · ${ANALYTES[k].name}` };
  $("#instCap").textContent = cap[S.view] ?? "";
}

function renderLegend(regions, win, pfi) {
  const items = [["raw", "Measured", "--signal", "line"]];
  if (S.result?.denoised) items.push(["denoised", "Denoised", "--denoised", "line"]);
  if (S.sample.blank) items.push(["blank", "Blank", "--blank", "dash"]);
  if (regions) items.push(["xai", pfi ? "Where the model looks" : "Key windows", "--pos", "box"]);
  $("#chartLegend").innerHTML = items.map(([key, label, color, kind]) =>
    `<button data-layer="${key}" aria-pressed="${!!S.layers[key]}"><i class="${kind === "box" ? "box" : kind === "dash" ? "dash" : ""}" style="--c:var(${color})"></i>${label}</button>`).join("")
    + (win && S.layers.xai ? `<span><i class="dash" style="--c:var(${ANALYTES[S.x.analyte].color})"></i>${CODES[S.x.analyte]} peak window (E3)</span>` : "");
}

/* ───────────── Verdict strip ───────────── */
function renderVerdicts(skeleton) {
  const r = S.result?.probs ? S.result : null;
  $("#verdicts").innerHTML = ANALYTES.map((a, k) => {
    if (skeleton || !r) {
      return `<div class="vd skel" style="--c:var(${a.color})"><div class="vd-name"><i></i>${a.name}</div><div class="vd-p">00<small>%</small></div><div class="vd-bar"></div><div class="vd-call">—</div></div>`;
    }
    const p = r.probs[k];
    const on = r.detected[k];
    const truth = S.sample.labels ? S.sample.labels[k] > 0 : null;
    const ok = truth == null ? null : truth === on;
    return `<button class="vd" style="--c:var(${a.color})" ${on ? "data-on" : ""} aria-pressed="${S.x.analyte === k}" data-k="${k}" title="Explain ${esc(a.name.toLowerCase())}">
      <div class="vd-name"><i></i>${a.name}</div>
      <div class="vd-p">${p >= 0.995 || p < 0.005 ? Math.round(p * 100) : (p * 100).toFixed(1)}<small>%</small></div>
      <div class="vd-bar"><i style="width:${(p * 100).toFixed(1)}%"></i><b style="left:${(S.model.thresholds[k] * 100).toFixed(1)}%"></b></div>
      <div class="vd-call"><b>${on ? "Detected" : "Not detected"}</b>${ok == null ? "" : `<span class="${ok ? "ok" : "bad"}">${ok ? "✓ label" : "✗ label"}</span>`}</div></button>`;
  }).join("");
}

/* ───────────── Toolbar ───────────── */
function renderToolbar() {
  const s = S.sample;
  const labels = s.labels ?? [0, 0, 0, 0];
  $("#sbDots").innerHTML = ANALYTES.map((a, k) => `<i style="--c:var(${a.color})" ${labels[k] > 0 ? "data-on" : ""}></i>`).join("");
  $("#sbTitle").textContent = s.source === "library" ? s.title : s.file;
  $("#sbSub").textContent = s.source === "library"
    ? `held-out #${String(s.index + 1).padStart(3, "0")} · ${s.polymer} · ${s.chip} · ${s.electrode}${s.rep ? ` · rep ${s.rep}` : ""}`
    : `${s.sourceLabel} · ${s.inputPoints} points${s.channelName && s.channels.length > 1 ? ` · ${s.channelName}` : ""}`;
  document.title = `${s.source === "library" ? s.title : s.file} — VoltEPIC Analyzer`;
}

/* ───────────── Library sheet ───────────── */
const lib = { poly: "all", mix: "all", q: "" };
function renderLibrary() {
  const words = lib.q.toLowerCase().split(/\s+/).filter(Boolean);
  const items = S.library.filter((s) => {
    if (lib.poly !== "all" && s.polymer !== lib.poly) return false;
    const n = s.present.length;
    if (lib.mix !== "all" && (lib.mix === "3" ? n < 3 : n !== +lib.mix)) return false;
    const hay = `${s.title} ${s.file} ${s.chip} ${s.polymer}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const grid = $("#libGrid");
  grid.innerHTML = items.map((s) => `<button class="lib-card" role="option" data-i="${s.index}" aria-selected="${S.sample?.index === s.index && S.sample?.source === "library"}">
      <svg class="viz" aria-hidden="true"></svg><span class="lc-title">${esc(s.title)}</span>
      <span class="lc-sub"><span>${esc(s.chip)} · ${esc(s.polymer)} · #${s.index + 1}</span><span class="lc-dots">${ANALYTES.map((a, k) => `<i style="--c:var(${a.color})" ${s.labels[k] > 0 ? "data-on" : ""}></i>`).join("")}</span></span></button>`).join("");
  requestAnimationFrame(() => {
    for (const card of $$(".lib-card", grid)) sparkline($("svg", card), Array.from(S.library[+card.dataset.i].I), { color: "--ink", height: 46 });
  });
  $("#libCount").textContent = `${items.length} of ${S.library.length} curves · arrow keys and Enter work here too`;
}
function markLibrary() {
  for (const c of $$(".lib-card")) c.setAttribute("aria-selected", String(S.sample?.source === "library" && +c.dataset.i === S.sample.index));
}
function openLibrary() {
  const d = $("#librarySheet");
  if (!d.open) d.showModal();
  renderLibrary();
  $("#libSearch").focus();
}

/* ───────────── Upload ───────────── */
async function handleFile(file) {
  if (!S.model) return;
  if (file.size > 5e6) { toast("That file is larger than 5 MB — is it a single voltammogram?", "error"); return; }
  try {
    const parsed = parseText(await file.text(), file.name);
    const sample = {
      source: "upload", file: file.name, sourceLabel: parsed.source, params: parsed.params,
      channels: parsed.channels, channelIndex: 0, E: parsed.E, inputPoints: parsed.E.length,
      inputRange: [Math.min(...parsed.E), Math.max(...parsed.E)], labels: null, blank: null, polymer: null,
    };
    applyChannel(sample, 0);
    if (parsed.channels.length > 1) toast(`Two working electrodes found (${parsed.channels.map((c) => c.name).join(", ")}); using ${parsed.channels[0].name}. Switch in Measurement.`, "info", 6000);
    for (const w of sample.warnings) toast(w, "info", 6000);
    await loadSample(sample);
    scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
  } catch (err) {
    toast(`Could not read ${file.name}: ${err.message}`, "error", 6000);
  }
}
function applyChannel(sample, i) {
  const ch = sample.channels[i];
  const g = toGrid(sample.E, ch.I);
  Object.assign(sample, { channelIndex: i, channelName: ch.name, I: g.I, resampled: g.resampled, warnings: g.warnings });
}
export function useChannel(i) {
  applyChannel(S.sample, i);
  loadSample(S.sample, { quiet: true });
}

/* ───────────── Assistant ───────────── */
function openAssistant() {
  const a = $("#assistant");
  a.hidden = false;
  requestAnimationFrame(() => a.classList.add("open"));
  $("#askBtn").setAttribute("aria-expanded", "true");
  setTimeout(() => $("#chatText").focus(), 250);
}
function closeAssistant() {
  const a = $("#assistant");
  a.classList.remove("open");
  $("#askBtn").setAttribute("aria-expanded", "false");
  setTimeout(() => { if (!a.classList.contains("open")) a.hidden = true; }, 450);
}

/* ───────────── Checks ───────────── */
function benchmark() {
  return ANALYTES.map((_, k) => {
    let tp = 0, tn = 0, fp = 0, fn = 0;
    S.library.forEach((s, i) => {
      const truth = s.labels[k] > 0;
      const det = S.libProbs[i][k] >= S.model.thresholds[k];
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
    maxDiff = Math.max(maxDiff, Math.abs(p - S.libProbs[i][k]));
    if ((p >= S.model.thresholds[k]) !== (S.libProbs[i][k] >= S.model.thresholds[k])) flips++;
  }));
  return { maxDiff, flips, n: S.library.length * 4 };
}

/* ───────────── Wiring ───────────── */
function step(d) {
  if (!S.library) return;
  const i = S.sample?.source === "library" ? S.sample.index : FEATURED - d;
  loadSample(S.library[(i + d + S.library.length) % S.library.length]);
}

function wire() {
  $("#prevBtn").addEventListener("click", () => step(-1));
  $("#nextBtn").addEventListener("click", () => step(1));
  $("#sampleBtn").addEventListener("click", openLibrary);
  $("#libClose").addEventListener("click", () => $("#librarySheet").close());
  $("#librarySheet").addEventListener("click", (e) => {
    if (e.target.id === "librarySheet") e.target.close();
    const card = e.target.closest(".lib-card");
    if (card) { $("#librarySheet").close(); loadSample(S.library[+card.dataset.i]); }
  });
  $("#libGrid").addEventListener("keydown", (e) => {
    const cards = $$(".lib-card");
    const i = cards.indexOf(document.activeElement);
    if (i < 0) return;
    const cols = Math.max(1, Math.round($("#libGrid").clientWidth / (cards[0].offsetWidth + 10)));
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols }[e.key];
    if (to != null) { e.preventDefault(); cards[Math.max(0, Math.min(cards.length - 1, to))].focus(); }
  });
  $("#libSearch").addEventListener("input", (e) => { lib.q = e.target.value; renderLibrary(); });
  segmented($("#libPoly"), (v) => { lib.poly = v; renderLibrary(); });
  segmented($("#libMix"), (v) => { lib.mix = v; renderLibrary(); });

  const input = $("#fileInput");
  $("#uploadBtn").addEventListener("click", () => input.click());
  input.addEventListener("change", () => { if (input.files[0]) handleFile(input.files[0]); input.value = ""; });
  const overlay = $("#dropOverlay");
  let depth = 0;
  addEventListener("dragenter", (e) => { if ([...(e.dataTransfer?.types ?? [])].includes("Files")) { depth++; overlay.hidden = false; } });
  addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });

  $("#askBtn").addEventListener("click", () => ($("#assistant").classList.contains("open") ? closeAssistant() : openAssistant()));
  $("#askClose").addEventListener("click", closeAssistant);

  $("#viewSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (b) setView(b.dataset.view, { pin: true });
  });
  $("#chartLegend").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-layer]");
    if (!b) return;
    S.layers[b.dataset.layer] = !S.layers[b.dataset.layer];
    drawChart(false);
  });
  $("#verdicts").addEventListener("click", (e) => {
    const b = e.target.closest(".vd[data-k]");
    if (!b) return;
    pickAnalyte(+b.dataset.k);
    $("#sec-explain").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  });
  $("#exportBtn").addEventListener("click", () => {
    if (!S.sample) return;
    const cols = { measured_uA: S.sample.I };
    if (S.result?.denoised) cols.denoised_uA = S.result.denoised;
    if (S.sample.blank) cols.blank_uA = S.sample.blank;
    download(`${S.sample.file.replace(/\.(txt|csv|tsv)$/i, "")}_processed.csv`, toCsv(cols));
  });

  // report sections drive the chart view as they scroll past
  const secs = $$(".r-sec");
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) e.target.toggleAttribute("data-inview", e.isIntersecting);
    const active = secs.find((s) => s.hasAttribute("data-inview"));
    if (!active) return;
    for (const s of secs) s.toggleAttribute("data-active", s === active);
    for (const a of $$("#repToc a")) a.toggleAttribute("data-active", a.dataset.sec === active.dataset.sec);
    if (performance.now() - S.viewPinned > 1200) setView(active.dataset.view);
  }, { rootMargin: "-38% 0px -52% 0px" });
  for (const s of secs) io.observe(s);

  addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
    if ($("#librarySheet").open || document.querySelector(".palette[open]")) return;
    const k = e.key;
    if (k === "ArrowRight") step(1);
    else if (k === "ArrowLeft") step(-1);
    else if (k === "l" || k === "L") { e.preventDefault(); openLibrary(); }
    else if (k === "u" || k === "U") $("#fileInput").click();
    else if (k === "a" || k === "A") ($("#assistant").classList.contains("open") ? closeAssistant() : openAssistant());
    else if (k === "Escape" && $("#assistant").classList.contains("open")) closeAssistant();
    else if (["1", "2", "3", "4"].includes(k)) $$(".r-sec")[+k - 1]?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" });
  });

  let rz;
  addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (!S.result) return;
      document.documentElement.classList.add("still");
      R.render(S);
      setTimeout(() => document.documentElement.classList.remove("still"), 60);
    }, 160);
  });
  addEventListener("themechange", () => { if (S.result) { document.documentElement.classList.add("still"); R.render(S); drawChart(false); setTimeout(() => document.documentElement.classList.remove("still"), 60); } });
}

boot();
