// SVG charts: the main voltammogram (crosshair, layers, key regions) and the small panel charts.

import { niceTicks, showTip, hideTip, hoverTips, amp, esc, reducedMotion, fmtI } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";
const X_DOMAIN = [0, 0.8];

const node = (tag, attrs = {}, parent) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.append(el);
  return el;
};

const pathOf = (xs, ys, sx, sy) => {
  let d = "";
  for (let k = 0; k < xs.length; k++) d += `${k ? "L" : "M"}${sx(xs[k]).toFixed(2)},${sy(ys[k]).toFixed(2)}`;
  return d;
};

/** Signed value in [-1, 1] → diverging fill (negative: --neg, positive: --pos, zero: --mid). */
export const diverging = (v) => {
  const p = Math.round(Math.min(1, Math.abs(v)) * 100);
  return `color-mix(in oklab, var(${v >= 0 ? "--pos" : "--neg"}) ${p}%, var(--mid))`;
};

/** The main voltammogram. */
export function createSignalChart(svg, wrap) {
  let state = null;
  let geom = null;

  svg.innerHTML = `
    <defs>
      <linearGradient id="denFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--denoised)" stop-opacity=".22"/>
        <stop offset="1" stop-color="var(--denoised)" stop-opacity="0"/>
      </linearGradient>
      <clipPath id="plotClip"><rect id="plotClipRect"/></clipPath>
    </defs>`;
  const gGrid = node("g", { class: "grid" }, svg);
  const gRegions = node("g", { class: "regions", "clip-path": "url(#plotClip)" }, svg);
  const gWindow = node("g", { class: "peakwin" }, svg);
  const gRegionLabel = node("g", {}, svg);
  const gAxes = node("g", { class: "axes" }, svg);
  const area = node("path", { class: "area-den", "clip-path": "url(#plotClip)" }, svg);
  const lineBlank = node("path", { class: "line line-blank" }, svg);
  const lineDen = node("path", { class: "line line-den" }, svg);
  const lineRaw = node("path", { class: "line line-raw" }, svg);
  const gPeak = node("g", { class: "peak-mark" }, svg);
  const note = node("text", { class: "note", "text-anchor": "end" }, svg);
  const xhair = node("g", { class: "xhair", visibility: "hidden" }, svg);
  const xLine = node("line", {}, xhair);
  const dots = ["raw", "den", "blank"].map((k) => node("circle", { r: 4, "data-k": k }, xhair));

  function scales() {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const m = { l: 54, r: 14, t: 36, b: 36 };
    const series = [];
    if (state.layers.raw) series.push(state.raw);
    if (state.layers.denoised && state.denoised) series.push(state.denoised);
    if (state.layers.blank && state.blank) series.push(state.blank);
    if (!series.length) series.push(state.raw);
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) for (const v of s) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const f = state.unit.f;
    const pad = (hi - lo) * 0.08 || 0.1 / f;
    const y = niceTicks((lo - pad) * f, (hi + pad) * f, h < 300 ? 4 : 6);
    y.lo /= f; y.hi /= f; y.ticks = y.ticks.map((t) => t / f);
    const sx = (v) => m.l + ((v - X_DOMAIN[0]) / (X_DOMAIN[1] - X_DOMAIN[0])) * (w - m.l - m.r);
    const sy = (v) => h - m.b - ((v - y.lo) / (y.hi - y.lo)) * (h - m.t - m.b);
    return { w, h, m, sx, sy, y };
  }

  function drawAxes(g) {
    const { w, h, m, sx, sy, y } = g;
    gGrid.replaceChildren();
    gAxes.replaceChildren();
    for (const t of y.ticks) {
      node("line", { x1: m.l, x2: w - m.r, y1: sy(t), y2: sy(t) }, gGrid);
      const tick = node("g", { class: "tick" }, gAxes);
      node("text", { x: m.l - 8, y: sy(t) + 4, "text-anchor": "end" }, tick).textContent = +(t * state.unit.f).toPrecision(6);
    }
    const ax = node("g", { class: "axis" }, gAxes);
    node("line", { x1: m.l, x2: w - m.r, y1: h - m.b, y2: h - m.b }, ax);
    for (let v = 0; v <= 0.8001; v += 0.1) {
      const tick = node("g", { class: "tick" }, gAxes);
      node("line", { x1: sx(v), x2: sx(v), y1: h - m.b, y2: h - m.b + 4, stroke: "var(--axis)" }, tick);
      node("text", { x: sx(v), y: h - m.b + 18, "text-anchor": "middle" }, tick).textContent = `${v.toFixed(1)}`;
    }
    node("text", { class: "axis-label", x: w - m.r, y: h - 4, "text-anchor": "end" }, gAxes).textContent = "Potential (V vs Ag/AgCl)";
    node("text", { class: "axis-label", x: m.l - 8, y: m.t - 14, "text-anchor": "end" }, gAxes).textContent = `I (${state.unit.u})`;
    const clip = svg.querySelector("#plotClipRect");
    clip.setAttribute("x", m.l); clip.setAttribute("y", m.t);
    clip.setAttribute("width", w - m.l - m.r); clip.setAttribute("height", h - m.t - m.b);
  }

  function drawRegions(g) {
    gRegions.replaceChildren();
    gRegionLabel.replaceChildren();
    const r = state.regions;
    if (!state.layers.xai || !r?.units?.length) return;
    const { m, h, sx } = g;
    const E = state.E;
    const max = Math.max(1e-9, ...r.units.map((u) => Math.abs(u.value)));
    const step = E[1] - E[0];
    // only the windows that matter: at least a fifth of the strongest effect, six at most
    const keep = new Set([...r.units].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .filter((u) => Math.abs(u.value) >= 0.2 * max).slice(0, 6));
    r.units.forEach((u, idx) => {
      const k = Math.abs(u.value) / max;
      if (!keep.has(u)) return;
      const x0 = sx(E[u.i0] - step / 2);
      const x1 = sx(E[u.i1 - 1] + step / 2);
      const rect = node("rect", { class: "region", x: x0, y: m.t, width: Math.max(1, x1 - x0), height: h - m.t - m.b }, gRegions);
      rect.style.fill = `var(${u.value >= 0 ? "--pos" : "--neg"})`;
      rect.style.opacity = (0.14 + 0.3 * k).toFixed(3);
      if (!reducedMotion()) rect.animate([{ opacity: 0 }, { opacity: rect.style.opacity }], { duration: 500, delay: idx * 8, easing: "ease-out", fill: "backwards" });
    });
    const top = r.units.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
    const cx = sx((E[top.i0] + E[top.i1 - 1]) / 2);
    const edge = cx < m.l + 60 ? "start" : cx > g.w - m.r - 60 ? "end" : "middle";
    const lx = edge === "start" ? cx - 4 : edge === "end" ? cx + 4 : cx;
    const label = node("text", { class: "region-label", x: lx, y: h - m.b - 8, "text-anchor": edge }, gRegionLabel);
    label.style.fill = `var(${top.value >= 0 ? "--pos" : "--neg"})`;
    const sign = r.method === "shap" ? (top.value >= 0 ? "+" : "−") : (top.value >= 0 ? "−" : "+");
    label.textContent = r.method === "pfi" ? "PFI · most important window" : `${r.scale === "logit" ? "log-odds" : "P"} ${sign}${Math.abs(top.value).toFixed(2)}`;
  }

  function drawWindow(g) {
    gWindow.replaceChildren();
    const w = state.peakWindow;
    if (!w) return;
    const { m, h, sx } = g;
    const x0 = sx(w.lo);
    const x1 = sx(w.hi);
    const rect = node("rect", { x: x0, y: m.t, width: Math.max(2, x1 - x0), height: h - m.t - m.b, rx: 4 }, gWindow);
    rect.style.stroke = `var(${w.color})`;
    const label = node("text", { x: (x0 + x1) / 2, y: m.t - 6, "text-anchor": "middle" }, gWindow);
    label.style.fill = `var(${w.color})`;
    label.textContent = w.label;
  }

  function drawPeak(g) {
    gPeak.replaceChildren();
    const s = state.layers.denoised && state.denoised ? state.denoised : state.raw;
    if (!state.peaks?.length || (!state.layers.raw && !state.layers.denoised)) return;
    const { sx, sy } = g;
    for (const p of state.peaks) {
      const x = sx(state.E[p.index]);
      const y = sy(s[p.index]);
      node("circle", { cx: x, cy: y, r: 4.5 }, gPeak);
      const right = x > g.w - 120;
      const t = node("text", { x: right ? x - 9 : x + 9, y: y - 10, "text-anchor": right ? "end" : "start" }, gPeak);
      t.textContent = `Ep ${state.E[p.index].toFixed(3)} V`;
    }
  }

  function animateLine(path) {
    if (reducedMotion()) return;
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len}`;
    path.style.setProperty("--len", `${len}`);
    path.classList.remove("draw");
    void path.getBoundingClientRect();
    path.classList.add("draw");
    path.addEventListener("animationend", () => { path.style.strokeDasharray = ""; path.classList.remove("draw"); }, { once: true });
  }

  function render(next, { animate = false } = {}) {
    state = next;
    if (!state || wrap.clientWidth < 120) return;
    geom = scales();
    svg.setAttribute("viewBox", `0 0 ${geom.w} ${geom.h}`);
    drawAxes(geom);
    drawRegions(geom);
    drawWindow(geom);
    const { sx, sy, h, m } = geom;
    const E = state.E;
    lineRaw.setAttribute("d", state.layers.raw ? pathOf(E, state.raw, sx, sy) : "");
    const den = state.layers.denoised && state.denoised;
    lineDen.setAttribute("d", den ? pathOf(E, state.denoised, sx, sy) : "");
    area.setAttribute("d", den ? `${pathOf(E, state.denoised, sx, sy)}L${sx(E[E.length - 1])},${h - m.b}L${sx(E[0])},${h - m.b}Z` : "");
    lineBlank.setAttribute("d", state.layers.blank && state.blank ? pathOf(E, state.blank, sx, sy) : "");
    drawPeak(geom);
    note.setAttribute("x", geom.w - m.r);
    note.setAttribute("y", 14);
    note.textContent = geom.w >= 560 ? state.note || "" : "";
    if (animate) {
      animateLine(lineRaw);
      if (den) animateLine(lineDen);
    }
  }

  svg.addEventListener("pointermove", (ev) => {
    if (!state || !geom) return;
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * geom.w;
    const E = state.E;
    const v = X_DOMAIN[0] + ((px - geom.m.l) / (geom.w - geom.m.l - geom.m.r)) * (X_DOMAIN[1] - X_DOMAIN[0]);
    const k = Math.max(0, Math.min(E.length - 1, Math.round((v - E[0]) / (E[1] - E[0]))));
    if (px < geom.m.l - 4 || px > geom.w - geom.m.r + 4) { xhair.setAttribute("visibility", "hidden"); hideTip(); return; }
    const x = geom.sx(E[k]);
    xLine.setAttribute("x1", x); xLine.setAttribute("x2", x);
    xLine.setAttribute("y1", geom.m.t); xLine.setAttribute("y2", geom.h - geom.m.b);
    const rows = [];
    const put = (dot, on, series, color, label) => {
      dot.setAttribute("visibility", on ? "visible" : "hidden");
      if (!on) return;
      dot.setAttribute("cx", x); dot.setAttribute("cy", geom.sy(series[k]));
      dot.style.fill = `var(${color})`;
      rows.push(`<div class="tt-r"><span><i style="--c:var(${color})"></i>${label}</span><b>${fmtI(series[k], 4)}</b></div>`);
    };
    put(dots[0], state.layers.raw, state.raw, "--signal", "Measured");
    put(dots[1], state.layers.denoised && !!state.denoised, state.denoised, "--denoised", "Denoised");
    put(dots[2], state.layers.blank && !!state.blank, state.blank, "--blank", "Blank");
    const unit = state.layers.xai && state.regions?.units?.find((u) => k >= u.i0 && k < u.i1);
    if (unit) {
      const shap = state.regions.method === "shap";
      const sign = shap ? (unit.value >= 0 ? "+" : "−") : (unit.value >= 0 ? "−" : "+");
      if (state.regions.method === "pfi") rows.push(`<div class="tt-r"><span><i style="--c:var(--pos)"></i>PFI · ${esc(state.regions.label)}</span><b>Δ log-loss ${unit.value.toFixed(4)}</b></div>`);
      else rows.push(`<div class="tt-r"><span><i style="--c:var(${unit.value >= 0 ? "--pos" : "--neg"})"></i>${shap ? "SHAP" : "Masking"} · ${esc(state.regions.label)}</span><b>${state.regions.scale === "logit" ? "log-odds" : "P"} ${sign}${Math.abs(unit.value).toFixed(2)}</b></div>`);
    }
    xhair.setAttribute("visibility", "visible");
    showTip(`<div class="tt-h">${E[k].toFixed(3)} V · point ${k + 1}/200</div>${rows.join("")}`, ev.clientX, ev.clientY);
  });
  svg.addEventListener("pointerleave", () => { xhair.setAttribute("visibility", "hidden"); hideTip(); });

  new ResizeObserver(() => state && render(state)).observe(wrap);
  return { render };
}

/* ───────────── Small charts (rendered as markup, hover via data-tip) ───────────── */

const tipFrom = (el) => el.getAttribute("data-tip");
const wireTips = (svg) => { if (!svg.dataset.tips) { hoverTips(svg, "[data-tip]", tipFrom); svg.dataset.tips = "1"; } };

/** Standardised DWT coefficients, grouped by band. */
export function coefChart(svg, z, bands, gainShare) {
  const w = svg.clientWidth || 600;
  const h = 170;
  const m = { l: 34, r: 6, t: 10, b: 26 };
  const lim = Math.max(3, Math.min(12, Math.ceil(Math.max(...z.map(Math.abs)))));
  // each band gets room for its label: width ∝ max(length, 14) coefficients
  const weight = bands.map((b) => Math.max(b.length, 14));
  const unitW = (w - m.l - m.r) / weight.reduce((a, b) => a + b, 0);
  let cursor = m.l;
  const sy = (v) => m.t + ((lim - Math.max(-lim, Math.min(lim, v))) / (2 * lim)) * (h - m.t - m.b);
  let out = `<line class="gridl" x1="${m.l}" x2="${w - m.r}" y1="${sy(lim / 2)}" y2="${sy(lim / 2)}"/><line class="gridl" x1="${m.l}" x2="${w - m.r}" y1="${sy(-lim / 2)}" y2="${sy(-lim / 2)}"/>`;
  out += `<text x="${m.l - 6}" y="${sy(lim / 2) + 3}" text-anchor="end">+${lim / 2}</text><text x="${m.l - 6}" y="${sy(0) + 3}" text-anchor="end">0</text><text x="${m.l - 6}" y="${sy(-lim / 2) + 3}" text-anchor="end">−${lim / 2}</text>`;
  bands.forEach((b, bi) => {
    const x0 = cursor;
    const bandW = weight[bi] * unitW;
    const bw = bandW / b.length;
    cursor += bandW;
    out += `<line class="band-sep" x1="${x0}" x2="${x0}" y1="${m.t}" y2="${h - m.b + 4}"/>`;
    out += `<text x="${x0 + bandW / 2}" y="${h - 6}" text-anchor="middle">${b.name}</text>`;
    for (let j = 0; j < b.length; j++) {
      const i = b.start + j;
      const y0 = sy(0);
      const y1 = sy(z[i]);
      const share = gainShare?.[i] ?? 0;
      out += `<rect class="bar" x="${(x0 + j * bw + 0.5).toFixed(2)}" y="${Math.min(y0, y1).toFixed(2)}" width="${Math.max(0.6, bw - 1).toFixed(2)}" height="${Math.max(0.8, Math.abs(y1 - y0)).toFixed(2)}" rx="${bw > 4 ? 1.5 : 0}" style="fill:var(--accent);opacity:${(0.35 + 0.65 * Math.min(1, share * 25)).toFixed(2)}" data-tip="<div class='tt-h'>${b.name}[${j}] · feature ${i + 1}/228</div><div class='tt-r'><span>z-score</span><b>${z[i].toFixed(2)}</b></div><div class='tt-r'><span>Share of model gain</span><b>${(share * 100).toFixed(2)}%</b></div>"/>`;
    }
  });
  out += `<line class="zero" x1="${m.l}" x2="${w - m.r}" y1="${sy(0)}" y2="${sy(0)}"/>`;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.innerHTML = out;
  wireTips(svg);
}

/** Removed component (measured − denoised) with the ±λ band. */
export function residualChart(svg, E, residual, lambdaBand, unit) {
  const w = svg.clientWidth || 300;
  const h = 170;
  const m = { l: 40, r: 6, t: 10, b: 26 };
  const lim = Math.max(1e-6, ...residual.map(Math.abs), lambdaBand) * 1.15;
  const sx = (v) => m.l + (v / 0.8) * (w - m.l - m.r);
  const sy = (v) => m.t + ((lim - v) / (2 * lim)) * (h - m.t - m.b);
  let d = "";
  residual.forEach((v, k) => { d += `${k ? "L" : "M"}${sx(E[k]).toFixed(1)},${sy(v).toFixed(1)}`; });
  let out = `<rect x="${m.l}" y="${sy(lambdaBand)}" width="${w - m.l - m.r}" height="${sy(-lambdaBand) - sy(lambdaBand)}" style="fill:var(--accent-soft)"/>`;
  out += `<line class="zero" x1="${m.l}" x2="${w - m.r}" y1="${sy(0)}" y2="${sy(0)}"/>`;
  out += `<path d="${d}" style="fill:none;stroke:var(--ink-2);stroke-width:1.3"/>`;
  out += `<text x="${m.l - 6}" y="${sy(lim / 1.15) + 4}" text-anchor="end">${amp((lim / 1.15) * unit.f, 2)}</text><text x="${m.l - 6}" y="${sy(0) + 3}" text-anchor="end">0</text>`;
  for (const v of [0, 0.2, 0.4, 0.6, 0.8]) out += `<text x="${sx(v)}" y="${h - 6}" text-anchor="middle">${v.toFixed(1)}</text>`;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.innerHTML = out;
}

/** Library probabilities per analyte (dots) with the current sample ringed. */
export function stripChart(svg, analytes, libProbs, current, thresholds, labelsOf) {
  const w = svg.clientWidth || 600;
  const rowH = 30;
  const h = analytes.length * rowH + 30;
  const m = { l: 92, r: 14, t: 6 };
  const sx = (p) => m.l + p * (w - m.l - m.r);
  let out = "";
  for (const t of [0, 0.25, 0.5, 0.75, 1]) out += `<text x="${sx(t)}" y="${h - 6}" text-anchor="middle">${t.toFixed(2)}</text>`;
  analytes.forEach((a, k) => {
    const cy = m.t + k * rowH + rowH / 2;
    out += `<text class="lbl" x="${m.l - 12}" y="${cy + 4}" text-anchor="end">${esc(a.name)}</text>`;
    out += `<line class="thr" x1="${sx(thresholds[k])}" x2="${sx(thresholds[k])}" y1="${cy - 11}" y2="${cy + 11}"/>`;
    libProbs.forEach((p, i) => {
      const jitter = (((i * 7919) % 97) / 97 - 0.5) * 14;
      const truth = labelsOf(i)[k] > 0;
      out += `<circle class="dot" cx="${sx(p[k]).toFixed(1)}" cy="${(cy + jitter).toFixed(1)}" r="3" style="fill:${truth ? `var(--a${k})` : "var(--muted)"}" data-tip="<div class='tt-h'>${esc(a.name)} · held-out #${i + 1}</div><div class='tt-r'><span>P(present)</span><b>${p[k].toFixed(3)}</b></div><div class='tt-r'><span>Label</span><b>${truth ? "present" : "absent"}</b></div>"/>`;
    });
    if (current) out += `<circle class="me" cx="${sx(current[k])}" cy="${cy}" r="7" style="fill:var(--a${k})" data-tip="<div class='tt-h'>This sample</div><div class='tt-r'><span>P(${esc(a.id)})</span><b>${current[k].toFixed(3)}</b></div>"/>`;
  });
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.style.height = `${h}px`;
  svg.innerHTML = out;
  wireTips(svg);
}

/** Occlusion heat strip: one row per analyte, one cell per window, diverging colour. */
export function heatChart(svg, analytes, occ, E, selected, onSelect, scale = "logit", windows = {}) {
  const w = svg.clientWidth || 600;
  const rowH = 26;
  const m = { l: 92, r: 8, t: 4, b: 24 };
  const h = m.t + analytes.length * rowH + m.b;
  const U = occ.units.length;
  const cw = (w - m.l - m.r) / U;
  const key = scale === "logit" ? "dlogit" : "dp";
  const max = Math.max(1e-9, ...occ.units.flatMap((u) => u[key].map(Math.abs)));
  let out = "";
  analytes.forEach((a, k) => {
    const y = m.t + k * rowH;
    if (k === selected) out += `<rect class="row-sel" x="0" y="${y}" width="${w}" height="${rowH}" rx="7"/>`;
    out += `<text class="row-lbl" x="${m.l - 12}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(a.name)}</text>`;
    occ.units.forEach((u, j) => {
      const v = u[key][k] / max;
      const e0 = E[u.i0] - 0.002;
      const e1 = E[u.i1 - 1] + 0.002;
      out += `<rect class="cell" x="${(m.l + j * cw + 0.5).toFixed(2)}" y="${y + 3}" width="${Math.max(1, cw - 1.5).toFixed(2)}" height="${rowH - 6}" rx="3" style="fill:${diverging(v)};animation-delay:${(j * 6 + k * 30)}ms" data-tip="<div class='tt-h'>${e0.toFixed(3)}–${e1.toFixed(3)} V · ${esc(a.name)}</div>${occ.method === "shap"
        ? `<div class='tt-r'><span>SHAP, log-odds</span><b>${u.dlogit[k] >= 0 ? "+" : "−"}${Math.abs(u.dlogit[k]).toFixed(2)}</b></div><div class='tt-r'><span>SHAP, P</span><b>${u.dp[k] >= 0 ? "+" : "−"}${Math.abs(u.dp[k]).toFixed(3)}</b></div>`
        : `<div class='tt-r'><span>P(present)</span><b>${occ.base[k].toFixed(3)} → ${(occ.base[k] - u.dp[k]).toFixed(3)}</b></div><div class='tt-r'><span>Log-odds change</span><b>${u.dlogit[k] >= 0 ? "−" : "+"}${Math.abs(u.dlogit[k]).toFixed(2)}</b></div>`}"/>`;
    });
    const win = windows[k];
    if (win) {
      const x0 = m.l + ((win.lo - (E[0] - 0.002)) / 0.8) * (w - m.l - m.r);
      const x1 = m.l + ((win.hi - (E[0] - 0.002)) / 0.8) * (w - m.l - m.r);
      out += `<rect class="win" x="${x0.toFixed(1)}" y="${y + 1.5}" width="${(x1 - x0).toFixed(1)}" height="${rowH - 3}" rx="5" style="stroke:var(--a${k})"/>`;
    }
    out += `<rect class="row-hit" data-row="${k}" x="0" y="${y}" width="${m.l - 4}" height="${rowH}"/>`;
  });
  for (const v of [0, 0.2, 0.4, 0.6, 0.8]) {
    const x = m.l + ((v - (E[0] - 0.002)) / 0.8) * (w - m.l - m.r);
    out += `<text x="${x.toFixed(1)}" y="${h - 6}" text-anchor="middle">${v.toFixed(1)} V</text>`;
  }
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.style.height = `${h}px`;
  svg.innerHTML = out;
  wireTips(svg);
  svg.onclick = (ev) => {
    const hit = ev.target.closest("[data-row]");
    if (hit) onSelect(+hit.dataset.row);
  };
}

/** Mean |Δp| per window across the library, one line per analyte, direct-labelled at the peak. */
export function profileChart(svg, analytes, profile, centers, windows = []) {
  const w = svg.clientWidth || 400;
  const hasWin = windows.some(Boolean);
  const h = hasWin ? 222 : 190;
  const m = { l: 40, r: 10, t: 14, b: hasWin ? 56 : 24 };
  const max = Math.max(1e-9, ...profile.flat());
  const y = niceTicks(0, max, 4);
  const sx = (v) => m.l + (v / 0.8) * (w - m.l - m.r);
  const sy = (v) => h - m.b - (v / y.hi) * (h - m.t - m.b);
  let out = "";
  for (const t of y.ticks) out += `<line x1="${m.l}" x2="${w - m.r}" y1="${sy(t)}" y2="${sy(t)}" style="stroke:var(--grid)"/><text x="${m.l - 6}" y="${sy(t) + 3}" text-anchor="end">${+t.toFixed(3)}</text>`;
  for (const v of [0, 0.2, 0.4, 0.6, 0.8]) out += `<text x="${sx(v)}" y="${h - m.b + 16}" text-anchor="middle">${v.toFixed(1)}</text>`;
  windows.forEach((win, k) => {
    if (!win) return;
    const y = h - m.b + 24 + k * 7;
    out += `<rect x="${sx(win.lo)}" y="${y}" width="${Math.max(2, sx(win.hi) - sx(win.lo))}" height="4" rx="2" style="fill:var(--a${k})" data-tip="<div class='tt-h'>${esc(analytes[k].name)} · E3 peak window</div><div class='tt-r'><span>${win.lo.toFixed(3)}–${win.hi.toFixed(3)} V</span><b>peak ${win.center.toFixed(3)} V</b></div>"/>`;
    out += `<line x1="${sx(win.center)}" x2="${sx(win.center)}" y1="${y - 2}" y2="${y + 6}" style="stroke:var(--ink);stroke-width:1.5"/>`;
  });
  analytes.forEach((a, k) => {
    const d = profile[k].map((v, j) => `${j ? "L" : "M"}${sx(centers[j]).toFixed(1)},${sy(v).toFixed(1)}`).join("");
    out += `<path class="line" d="${d}" style="stroke:var(--a${k})"/>`;
    const j = profile[k].indexOf(Math.max(...profile[k]));
    out += `<circle cx="${sx(centers[j])}" cy="${sy(profile[k][j])}" r="4" style="fill:var(--a${k});stroke:var(--surface-1);stroke-width:2" data-tip="<div class='tt-h'>${esc(a.name)} · peak window</div><div class='tt-r'><span>${centers[j].toFixed(3)} V</span><b>${profile[k][j].toFixed(3)}</b></div>"/>`;
  });
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.innerHTML = out;
  wireTips(svg);
}
