// The live report: four sections, each opening with one sentence that says what the numbers mean.

import { $, $$, esc, conc, pct, amp, fmtI, countUp, segmented } from "../ui.js";
import { ANALYTES, CODES, GRID_E as E } from "../data.js";
import { coefChart, residualChart, stripChart, heatChart } from "../chart.js";
import { profileChart } from "../viz.js";
import { pickAnalyte, reExplain, setView, useChannel, peakWindow, unitKey, shapAvailable, drawChart, addBlank, setCoating, blankRef } from "./main.js";

const pct0 = (v) => `${Math.round(v * 100)}%`;
const listNames = (ks) => {
  const n = ks.map((k) => ANALYTES[k].name.toLowerCase());
  return n.length < 2 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const range = (u) => `${(E[u.i0] - 0.002).toFixed(2)}–${(E[u.i1 - 1] + 0.002).toFixed(2)} V`;
const head = (n, title, sum) => `<header class="rs-head"><span class="rs-num">${n}</span><h2 class="rs-title">${title}</h2><p class="rs-sum">${sum}</p></header>`;

/* ───────────── Report header ───────────── */
export function header(S, stage) {
  const s = S.sample;
  $("#repEyebrow").textContent = s.source === "library" ? `Analysis report · held-out #${String(s.index + 1).padStart(3, "0")}` : `Analysis report · ${s.file}`;
  if (stage === "measuring" || !S.result?.probs) {
    $("#repTitle").textContent = "Analyzing…";
    $("#repSub").textContent = "";
    return;
  }
  const det = S.result.detected.map((d, k) => (d ? k : -1)).filter((k) => k >= 0);
  $("#repTitle").innerHTML = det.length ? `${det.length} of 4 analytes <em>detected</em>` : "No analyte <em>detected</em>";
  let sub = det.length ? `${cap(listNames(det))}.` : "All four probabilities stay below their thresholds.";
  if (s.labels) {
    const wrong = ANALYTES.map((_, k) => k).filter((k) => (s.labels[k] > 0) !== S.result.detected[k]);
    const comp = s.present.length ? s.present.map((k) => `${CODES[k]} ${conc(s.labels[k])}`).join(" + ") : "no analyte";
    sub += wrong.length ? ` The prepared mixture was ${comp}; the call on ${listNames(wrong)} disagrees with it.` : ` All four calls match the prepared mixture (${comp}).`;
  } else {
    sub += " Uploaded curve — there is no label to compare with.";
  }
  $("#repSub").textContent = sub;
}

export function render(S) {
  header(S);
  renderMeasure(S);
  renderPre(S);
  renderDetect(S);
  renderExplain(S);
}

/* ───────────── 01 · Measurement ───────────── */
function renderMeasure(S) {
  const s = S.sample;
  const q = S.qc;
  const el = $("#sec-measure");
  const peaks = q.peaks.length
    ? `${q.peaks.length} peak${q.peaks.length > 1 ? "s" : ""} on the denoised trace; the main one at <b>${q.mainE.toFixed(3)} V</b> stands ${fmtI(q.mainProm)} above its surroundings.`
    : "No clear interior peak — the curve is dominated by its background.";
  const quality = q.snr > 50 ? "clean enough to read" : "noisy, read with care";
  const acq = s.source === "library" ? S.acquisition : (s.params ?? {});
  const fromFile = s.source === "upload" && s.params?.instrument ? "<span class='src'>file header</span>" : "";
  const val = (v, unit) => (v == null || Number.isNaN(v) ? "<span class='src'>not in file</span>" : `${v} ${unit}${fromFile}`);
  const acqRows = s.source === "library" || s.params?.instrument ? [
    ["Technique", "square-wave voltammetry"],
    ["Instrument", esc(acq.instrument ?? "CHI760F")],
    ["Window", `${(acq.init_E ?? 0).toFixed(3)} → ${(acq.final_E ?? 0.8).toFixed(3)} V`],
    ["Step", val(acq.incr_E != null ? (acq.incr_E * 1000).toFixed(0) : null, "mV")],
    ["Amplitude", val(acq.amplitude != null ? (acq.amplitude * 1000).toFixed(0) : null, "mV")],
    ["Frequency", val(acq.frequency, "Hz")],
    ["Quiet time", val(acq.quiet_time, "s")],
  ] : [
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
    ["File", esc(s.file)], ["Electrode column", esc(s.channelName)], ["Coating", esc(s.polymer ?? "unknown")],
    ["Blank", s.blankFiles ? `${s.blankFiles.length} file${s.blankFiles.length > 1 ? "s" : ""} (mean)` : "none"],
    ["Resampled", s.resampled ? "yes, linear" : "no, on grid"],
    ...(s.params?.acquired ? [["Recorded", esc(s.params.acquired)]] : []),
  ];
  const kv = (rows) => `<dl class="kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  el.innerHTML = `
    ${head("01 · MEASUREMENT", "What was recorded", `${peaks} Noise σ ${fmtI(q.sigma)}: ${quality}.`)}
    <div class="mtiles">
      <div class="mtile"><div class="k">Main peak</div><div class="v">${q.mainE != null ? `${q.mainE.toFixed(3)}<small>V</small>` : "none"}</div><div class="s">${q.mainE != null ? `prominence ${fmtI(q.mainProm)}` : "no interior maximum"}</div></div>
      <div class="mtile"><div class="k">Peaks found</div><div class="v">${q.peaks.length}</div><div class="s">${q.peaks.map((p) => `${E[p.index].toFixed(3)} V`).join(" · ") || "—"}</div></div>
      <div class="mtile"><div class="k">Noise σ (wavelet MAD)</div><div class="v">${fmtI(q.sigma).replace(/ (\S+)$/, "<small>$1</small>")}</div><div class="s">finest detail band</div></div>
      <div class="mtile"><div class="k">Peak / noise</div><div class="v">${q.snr > 1e5 ? "&gt;10⁵" : Math.round(q.snr).toLocaleString()}<small>×</small></div><div class="s">${quality}</div></div>
    </div>
    ${s.channels?.length > 1 ? `<p class="rs-label">Working electrode</p><div class="seg sm" id="chanSeg" role="radiogroup" aria-label="Working electrode">${s.channels.map((c, i) => `<button role="radio" data-v="${i}" aria-checked="${i === s.channelIndex}">${esc(c.name)}</button>`).join("")}</div>` : ""}
    <div class="kv2"><div><p class="rs-label">Acquisition</p>${kv(acqRows)}</div><div><p class="rs-label">Sample</p>${kv(sampleRows)}</div></div>
    <p class="rs-label">${s.labels ? "Prepared composition (label)" : "Composition"}</p>
    ${s.labels ? `<div class="comp">${ANALYTES.map((a, k) => `<span class="chip" style="--c:var(${a.color})" ${s.labels[k] > 0 ? "" : "data-off"}><i></i>${a.name} <b class="mono">${conc(s.labels[k])}</b></span>`).join("")}</div>`
      : `<p class="small">Unknown: uploaded curves carry no label. The model has only seen ACS-ML-Biomarker chips (P4VP or PVDF, CHI760F, SWV 25 mV · 5 Hz); for other curves its probabilities are not calibrated.</p>`}
    ${s.warnings?.length ? `<p class="warn-line">${s.warnings.map(esc).join("<br>")}</p>` : ""}
    ${s.source === "upload" ? `<p class="rs-label">Blank and coating · for the chemist report</p>
      <div class="blank-row"><button type="button" class="btn btn-secondary btn-sm" id="blankBtn"${s.kimBusy ? " disabled" : ""}>${s.blankFiles ? "Replace blank…" : "Add blank…"}</button>
        <input type="file" id="blankInput" accept=".csv,.txt,.tsv,text/csv,text/plain" multiple hidden>
        <span class="small" id="blankStatus">${s.kimBusy ? "Explaining against the blank…" : s.blankFiles ? `Blank: ${s.blankFiles.map(esc).join(", ")}${s.blankFiles.length > 1 ? " (mean)" : ""}. Both explanations compare the curve with it.`
          : "The blank of the same electrode, one or more files (their mean is used). The chemist report needs it."}</span></div>
      <div class="seg sm" id="coatSeg" role="radiogroup" aria-label="Coating">${["PVDF", "P4VP"].map((p) => `<button role="radio" data-v="${p}" aria-checked="${p === s.polymer}">${p}</button>`).join("")}</div>
      <p class="small">${s.polymer ? `Coating ${esc(s.polymer)}${chipNote(s, S)}.` : "Choose the coating: the peak windows the report compares with depend on it."}</p>` : ""}`;
  const seg = $("#chanSeg", el);
  if (seg) segmented(seg, (v) => useChannel(+v));
  if ($("#blankBtn", el)) {
    $("#blankBtn", el).addEventListener("click", () => $("#blankInput", el).click());
    $("#blankInput", el).addEventListener("change", (e) => { addBlank(e.target.files); e.target.value = ""; });
    segmented($("#coatSeg", el), (v) => setCoating(v));
  }
}

const chipNote = (s, S) => { const c = s.file?.match(/MC\d+/)?.[0]; return c && S.kimLib?.chip_polymer[c] === s.polymer ? `, from chip ${esc(c)} in the file name` : ""; };

/* ───────────── 02 · Preprocess ───────────── */
function renderPre(S) {
  const el = $("#sec-pre");
  const r = S.result;
  const I = S.sample.I;
  const residual = Array.from(I, (v, k) => v - r.denoised[k]);
  const mu = I.reduce((a, b) => a + b, 0) / I.length;
  const energy = residual.reduce((a, v) => a + v * v, 0) / I.reduce((a, v) => a + (v - mu) ** 2, 0);
  const z = Array.from(r.features, (v, i) => (v - S.json.scaler.mean[i]) / S.json.scaler.scale[i]);
  const out3 = z.filter((v) => Math.abs(v) > 3).length;
  const t = S.timings ?? {};
  const gain = new Float64Array(228);
  for (const h of S.json.heads) h.gain.forEach((g, i) => { gain[i] += g; });
  const gsum = gain.reduce((a, b) => a + b, 0);
  el.innerHTML = `
    ${head("02 · PREPROCESS", "What the model reads", `Denoising removed ${energy < 1e-4 ? "less than 0.01%" : pct(energy, 2)} of the variance. Of the 228 wavelet coefficients, <b>${out3}</b> lie beyond ±3 SD of the training curves${out3 > 20 ? " — unusual for this model's training data" : ""}.`)}
    <ol class="flowv">
      <li><div><div class="ft">Raw current</div><div class="fd">200 points, 0.004–0.800 V; no blank subtraction.</div></div><div class="fm"><span>range</span>${amp(Math.min(...I) * S.unit.f)}–${fmtI(Math.max(...I))}</div></li>
      <li><div><div class="ft">Denoise</div><div class="fd">sym4, 3 levels, soft universal threshold λ = σ√(2 ln 200).</div></div><div class="fm"><span>λ</span>${fmtI(r.lambda)}</div></li>
      <li><div><div class="ft">Decompose</div><div class="fd">rbio1.3 DWT, 6 levels; all coefficients kept, cA6 → cD1.</div></div><div class="fm"><span>coefficients</span>228</div></li>
      <li><div><div class="ft">Standardise</div><div class="fd">z-score with the training means and spreads.</div></div><div class="fm"><span>max |z|</span>${Math.max(...z.map(Math.abs)).toFixed(1)}</div></li>
      <li><div><div class="ft">Classify</div><div class="fd">Four LightGBM models, 300 trees and 31 leaves each.</div></div><div class="fm"><span>time</span>${((t.pre ?? 0) + (t.detect ?? 0)).toFixed(2)} ms</div></li>
    </ol>
    <p class="rs-label">Standardised coefficients, by band</p>
    <svg class="mini-chart" id="coefChart" role="img" aria-label="Standardised wavelet coefficients by band"></svg>
    <p class="caption">This curve's 228 inputs, coarse (cA6) to fine (cD1). Darker bars carry more of the model's split gain; coarse bands describe peak shape and position.</p>
    <p class="rs-label">What the denoiser removed</p>
    <svg class="mini-chart" id="resChart" role="img" aria-label="Measured minus denoised current"></svg>
    <p class="caption">Measured − denoised, in ${S.unit.u}; the band is ±λ.</p>`;
  coefChart($("#coefChart"), z, S.model.bands, Array.from(gain, (g) => g / gsum));
  residualChart($("#resChart"), E, residual, r.lambda, S.unit);
}

/* ───────────── 03 · Detect ───────────── */
function renderDetect(S) {
  const el = $("#sec-detect");
  const r = S.result;
  const s = S.sample;
  const det = r.detected.map((d, k) => (d ? k : -1)).filter((k) => k >= 0);
  const close = r.probs.map((p, k) => [Math.abs(p - S.model.thresholds[k]), k]).sort((a, b) => a[0] - b[0])[0];
  const closeTxt = close[0] > 0.3
    ? `Every call is far from its threshold; the nearest, ${ANALYTES[close[1]].name.toLowerCase()}, sits ${close[0].toFixed(2)} away.`
    : `<b>${ANALYTES[close[1]].name} is a close call</b>: P is only ${close[0].toFixed(2)} from the threshold.`;
  el.innerHTML = `
    ${head("03 · DETECT", "Four independent decisions", `${det.length ? `${cap(listNames(det))} ${det.length > 1 ? "are" : "is"} detected.` : "Nothing is detected."} ${closeTxt}`)}
    <div class="det-rows">${ANALYTES.map((a, k) => {
      const p = r.probs[k];
      const truth = s.labels ? s.labels[k] > 0 : null;
      const ok = truth == null ? null : truth === r.detected[k];
      return `<div class="det-row" style="--c:var(${a.color})">
        <div class="dr-name"><i></i>${a.name} <span class="mono">${a.code}</span></div>
        <div class="dr-p"><span data-count="${p * 100}">0</span><small>%</small></div>
        <div class="dr-gauge"><i data-w="${(p * 100).toFixed(2)}"></i><b style="left:${(S.model.thresholds[k] * 100).toFixed(2)}%"></b></div>
        <div class="dr-facts"><span>${r.detected[k] ? "Detected" : "Not detected"}</span><span>log-odds <b>${r.margins[k] >= 0 ? "+" : ""}${r.margins[k].toFixed(2)}</b></span>
          ${truth == null ? "<span>no label</span>" : `<span>label <b>${conc(s.labels[k])}</b></span><span class="verdict" data-v="${ok ? "ok" : "bad"}">${ok ? '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>matches' : '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>disagrees'}</span>`}</div>
      </div>`;
    }).join("")}</div>
    <p class="rs-label">Among the 125 held-out curves</p>
    <svg class="strip" id="stripChart" role="img" aria-label="Held-out probabilities per analyte, with this curve"></svg>
    <p class="caption">Dots: held-out curves, coloured when the analyte is present. Ring: this curve. Dashed tick: the threshold (MaxSSS cut on the training rows).</p>`;
  for (const n of $$("[data-count]", el)) countUp(n, +n.dataset.count, { format: (v) => (v >= 99.5 || v < 0.5 ? v.toFixed(0) : v.toFixed(1)) });
  requestAnimationFrame(() => { for (const g of $$(".dr-gauge > i", el)) g.style.width = `${g.dataset.w}%`; });
  stripChart($("#stripChart"), S.model.analytes, S.libProbs, r.probs, S.model.thresholds, (i) => S.library[i].labels);
}

/* ───────────── 04 · Explain ───────────── */
export function renderExplain(S) {
  const el = $("#sec-explain");
  if (!S.occ) { el.innerHTML = ""; return; }
  const k = S.x.analyte;
  const a = ANALYTES[k];
  const shap = S.occ.method === "shap";
  const canR1 = !!S.model.r1[S.sample.polymer];
  const tests = S.xai?.tests;
  const test = !tests ? null : shap ? tests.shap_r2[unitKey()] : tests.occlusion[`${unitKey()} ${S.x.fill}`];
  const windows = Object.fromEntries(ANALYTES.map((_, i) => [i, peakWindow(i)]));
  const top = [...S.occ.units].sort((x, y) => y.dlogit[k] - x.dlogit[k])[0];
  const win = peakWindow(k);
  const c = (E[top.i0] + E[top.i1 - 1]) / 2;
  const summary = `${shap ? "SHAP (blank reference)" : `Occlusion (${S.x.fill})`} on ${a.name.toLowerCase()}: the strongest window is <b>${range(top)}</b>${win ? `, ${c >= win.lo && c <= win.hi ? "inside" : "outside"} its peak window (${win.lo.toFixed(2)}–${win.hi.toFixed(2)} V)` : ""}.`;
  const seg = (id, label, opts, value, extra = "") => `<label>${label}</label><div class="seg sm" id="${id}" role="radiogroup" aria-label="${label}"${extra}>${opts.map(([v, t, dis, title]) => `<button role="radio" data-v="${v}" aria-checked="${String(v) === String(value)}"${dis ? " disabled" : ""}${title ? ` title="${title}"` : ""}>${t}</button>`).join("")}</div>`;
  el.innerHTML = `
    ${head("04 · EXPLAIN", "Why the model decided", summary)}
    <div class="xai-controls">
      ${seg("xAnalyte", "Analyte", ANALYTES.map((x, i) => [i, x.code]), k)}
      ${S.xai ? seg("xShade", "Graph", [["pfi", "Model-wide", false, "Where the model looks across all held-out curves (PFI)"], ["local", "This curve", false, "This curve's own explanation"]], S.x.shade) : ""}
      ${seg("xMethod", "Method", [["shap", "SHAP · blank", !shapAvailable(), shapAvailable() ? "" : "Library curves, or an upload with its blank (20 mV)"], ["occlusion", "Occlusion"]], S.occ.method)}
      ${seg("xWidth", "Window", [[5, "20 mV"], [10, "40 mV"]], S.x.width)}
      ${shap ? "" : seg("xFill", "Fill", [["R2", "Blank", !blankRef(), blankRef() ? "The blank of the same electrode (as the chemist report)" : "Needs a blank"], ["R1", "Train mean", !canR1, canR1 ? "Training mean of the same coating" : "Needs the coating"], ["R0", "Zero"], ["R3", "Bridge"]], S.x.fill)}
      ${seg("xScale", "Scale", [["logit", "Log-odds"], ["dp", "P"]], S.x.scale)}
    </div>
    ${test ? `<p class="xai-test"><b>From the XAI tests</b> (${shap ? "SHAP · R2" : `occlusion · ${S.x.fill}`}, ${unitKey().replace("mV", " mV")}): on the PVDF peak test the map beats 95% of random placements in ${pct0(test.e3.hit)} of analyte × seed cases (mean percentile ${test.e3.percentile.toFixed(2)}); edge share P4VP ${pct0(test.edge.P4VP)} · PVDF ${pct0(test.edge.PVDF)} (an even spread would be 10%).</p>` : ""}
    <svg class="heat" id="heatChart" role="img" aria-label="Explanation map, four analytes by window"></svg>
    <div class="legend-ramp"><span>${shap ? "toward absent" : "masking raises the score"}</span><i></i><span>${shap ? "toward present" : "masking lowers it"}</span>${Object.values(windows).some(Boolean) ? `<span class="legend-win"><b></b>peak window (E3)</span>` : ""}<span style="margin-left:auto">${S.occ.units.length} windows${shap ? (S.occ.source === "kimyager" ? " · 20,000 coalitions against the blank" : " · from the XAI run") : ` · ${S.occMs.toFixed(1)} ms here`}</span></div>
    <p class="rs-label">Reading the map for ${esc(a.name.toLowerCase())}</p>
    <p class="xai-text">${narrative(S, k)}</p>
    ${S.xai ? `<p class="rs-label">Model-wide · permutation importance (${esc(S.x.polymer)})</p>
      <div class="seg sm" id="xPoly" role="radiogroup" aria-label="Coating">${["P4VP", "PVDF"].map((p) => `<button role="radio" data-v="${p}" aria-checked="${p === S.x.polymer}">${p}</button>`).join("")}</div>
      <svg class="viz profile" id="pfiChart" role="img" aria-label="Permutation importance per window"></svg>
      <p class="caption" id="pfiCap"></p>` : ""}
    <p class="rs-label">Wavelet bands ${esc(a.name.toLowerCase())} relies on</p>
    <div class="bands" id="bandBars"></div>
    <p class="caption">Share of this model's split gain per band, from training.</p>`;
  heatChart($("#heatChart"), S.model.analytes, S.occ, E, k, (row) => pickAnalyte(row), S.x.scale, windows);
  segmented($("#xAnalyte"), (v) => pickAnalyte(+v));
  segmented($("#xScale"), (v) => { S.x.scale = v; renderExplain(S); drawChart(false); });
  segmented($("#xMethod"), (v) => { S.x.method = v; S.x.userMethod = v; S.x.shade = "local"; reExplain(); setView("explain", { pin: true }); });
  segmented($("#xWidth"), (v) => { S.x.width = +v; reExplain(); });
  if ($("#xFill")) segmented($("#xFill"), (v) => { S.x.fill = v; reExplain(); });
  if ($("#xShade")) segmented($("#xShade"), (v) => { S.x.shade = v; drawChart(false); setView("explain", { pin: true }); });
  if ($("#xPoly")) segmented($("#xPoly"), (v) => { S.x.polymer = v; renderExplain(S); drawChart(false); });
  bands(S, k);
  pfi(S, k);
}

function narrative(S, k) {
  const occ = S.occ;
  const shap = occ.method === "shap";
  const p = occ.base[k];
  const a = ANALYTES[k].name;
  const det = S.result.detected[k];
  const r = (u) => `<span class="mono">${range(u)}</span>`;
  const pos = [...occ.units].sort((x, y) => y.dlogit[k] - x.dlogit[k]);
  const neg = [...occ.units].sort((x, y) => x.dlogit[k] - y.dlogit[k]);
  const positive = occ.units.reduce((acc, u) => acc + Math.max(0, u.dlogit[k]), 0) || 1;
  const out = [`<b>${esc(a)}</b> is ${det ? "detected" : "not detected"}: P = <span class="mono">${p.toFixed(3)}</span>, log-odds <span class="mono">${occ.baseLogit[k].toFixed(1)}</span>.`];
  const top = pos[0];
  if (shap) {
    out.push(`Against its blank (log-odds <span class="mono">${occ.refLogit[k].toFixed(1)}</span>) the windows add up to <span class="mono">${(occ.baseLogit[k] - occ.refLogit[k]).toFixed(1)}</span>.`);
    if (top.dlogit[k] > 0.5) out.push(`${r(top)} adds the most, <span class="mono">+${top.dlogit[k].toFixed(1)}</span>${pos[1].dlogit[k] > 0.5 ? `, then ${r(pos[1])} (<span class="mono">+${pos[1].dlogit[k].toFixed(1)}</span>)` : ""}.`);
    else out.push(`No window adds more than <span class="mono">0.5</span>: nothing here speaks clearly for ${esc(a.toLowerCase())}.`);
    if (neg[0].dlogit[k] < -0.5) out.push(`${r(neg[0])} pulls toward absent (<span class="mono">${neg[0].dlogit[k].toFixed(1)}</span>).`);
  } else if (top.dlogit[k] > 1) {
    const after = p - top.dp[k];
    out.push(`The decision leans most on ${r(top)}: masking it lowers the log-odds by <span class="mono">${top.dlogit[k].toFixed(1)}</span> (P → <span class="mono">${after.toFixed(3)}</span>)${det && after < S.model.thresholds[k] ? ", <b>enough to flip the call</b>" : ""}.`);
    if (neg[0].dlogit[k] < -1) out.push(`${r(neg[0])} pulls the other way (<span class="mono">+${(-neg[0].dlogit[k]).toFixed(1)}</span> when masked).`);
  } else {
    out.push(det ? "No window lowers the log-odds by more than 1: the evidence is spread across the curve." : `No window holds strong evidence for ${esc(a.toLowerCase())}.`);
  }
  const win = peakWindow(k);
  if (win && top.dlogit[k] > 0) {
    const inside = occ.units.filter((u) => { const c = (E[u.i0] + E[u.i1 - 1]) / 2; return c >= win.lo && c <= win.hi; });
    const share = inside.reduce((acc, u) => acc + Math.max(0, u.dlogit[k]), 0) / positive;
    out.push(`Windows inside the E3 peak window (<span class="mono">${win.lo.toFixed(3)}–${win.hi.toFixed(3)} V</span>) carry ${pct0(share)} of the positive evidence.`);
  } else if (S.sample.polymer === "P4VP") {
    out.push(`<span style="color:var(--muted)">On P4VP the E3 test found no peak window, so there is no reference position to compare with.</span>`);
  }
  out.push(`<br><span style="color:var(--muted)">This explains the model, not the chemistry: a window matters because the classifier uses it.</span>`);
  return out.join(" ");
}

function bands(S, k) {
  const gain = S.json.heads[k].gain;
  const total = gain.reduce((x, y) => x + y, 0) || 1;
  const rows = S.model.bands.map((b) => [b.name, gain.slice(b.start, b.start + b.length).reduce((x, y) => x + y, 0) / total]);
  const max = Math.max(...rows.map((r) => r[1]));
  $("#bandBars").innerHTML = rows.map(([n, v]) => `<div class="band-row"><span>${n}</span><div class="band-bar"><i style="--c:var(${ANALYTES[k].color})" data-w="${(v / max) * 100}"></i></div><span>${pct(v, 1)}</span></div>`).join("");
  requestAnimationFrame(() => { for (const i of $$("#bandBars i")) i.style.width = `${i.dataset.w}%`; });
}

function pfi(S, focus) {
  const svg = $("#pfiChart");
  if (!svg) return;
  const pol = S.x.polymer;
  const w = S.x.width;
  const data = S.xai.pfi[unitKey()][pol];
  const profiles = ANALYTES.map((a) => {
    const v = data[a.id].importance.map((x) => Math.max(0, x));
    const m = Math.max(...v) || 1;
    return v.map((x) => x / m);
  });
  const centers = profiles[0].map((_, j) => (E[j * w] + E[Math.min(199, j * w + w - 1)]) / 2);
  const windows = ANALYTES.map((_, i) => peakWindow(i, pol));
  profileChart(svg, { analytes: ANALYTES, profiles, centers, windows, height: 230, focus });
  const tops = ANALYTES.map((a, i) => {
    const c = centers[profiles[i].indexOf(1)];
    const wn = windows[i];
    return `${a.code} ${c.toFixed(3)} V${wn ? (c >= wn.lo && c <= wn.hi ? " ✓" : " ✗") : ""}`;
  });
  $("#pfiCap").innerHTML = `Each ${w * 4} mV window shuffled across the held-out ${esc(pol)} curves; rise in log-loss, each line scaled to its maximum. Most important window: ${tops.join(" · ")}${pol === "PVDF" ? " (✓ = inside the E3 peak window)" : " — the E3 test found no peak window on P4VP"}.`;
}
