// Small SVG chart kit for the editorial pages: scales, traces, PFI profiles, sparklines.

import { esc, hoverTips, niceTicks } from "./ui.js";

export const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
export const extent = (arrs) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrs) for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
};
export const path = (xs, ys, sx, sy) => {
  let d = "";
  for (let i = 0; i < ys.length; i++) d += `${i ? "L" : "M"}${sx(xs[i]).toFixed(1)},${sy(ys[i]).toFixed(1)}`;
  return d;
};
const size = (svg, h) => {
  const w = Math.max(240, Math.round(svg.getBoundingClientRect().width) || svg.parentElement?.clientWidth || 600);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.style.height = `${h}px`;
  return w;
};
const wired = new WeakSet();
export function tips(svg) {
  if (wired.has(svg)) return;
  wired.add(svg);
  hoverTips(svg, "[data-tip]", (el) => el.getAttribute("data-tip"));
}

/** A thin trace on a potential axis; options: E, ys (array of {y, cls, color}), height, axis, windows, shades. */
export function traceChart(svg, { E, series, height = 220, axis = true, yLabel = "", windows = [], shades = [], pad = 0.08 }) {
  const w = size(svg, height);
  const m = axis ? { l: 44, r: 10, t: 14, b: 28 } : { l: 2, r: 2, t: 6, b: 6 };
  const [lo, hi] = extent(series.map((s) => s.y));
  const span = hi - lo || 1;
  const sx = lin(0, 0.8, m.l, w - m.r);
  const sy = lin(lo - span * pad, hi + span * pad, height - m.b, m.t);
  let out = "";
  for (const s of shades) out += `<rect class="shade" x="${sx(s.lo)}" y="${m.t}" width="${Math.max(1, sx(s.hi) - sx(s.lo))}" height="${height - m.t - m.b}" rx="3" style="fill:var(${s.color});opacity:${s.opacity ?? 0.16}"${s.tip ? ` data-tip="${esc(s.tip)}"` : ""}/>`;
  if (axis) {
    const t = niceTicks(lo - span * pad, hi + span * pad, 4);
    for (const v of t.ticks) if (v >= lo - span * pad && v <= hi + span * pad) out += `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${sy(v)}" y2="${sy(v)}"/><text x="${m.l - 8}" y="${sy(v) + 4}" text-anchor="end">${+v.toPrecision(4)}</text>`;
    for (const v of [0, 0.2, 0.4, 0.6, 0.8]) out += `<text x="${sx(v)}" y="${height - 8}" text-anchor="middle">${v.toFixed(1)}</text>`;
    if (yLabel) out += `<text x="${m.l - 8}" y="${m.t - 2}" text-anchor="end">${esc(yLabel)}</text>`;
  }
  for (const win of windows) {
    out += `<rect class="win" x="${sx(win.lo)}" y="${m.t}" width="${sx(win.hi) - sx(win.lo)}" height="${height - m.t - m.b}" rx="4" style="stroke:var(${win.color})"/>`;
  }
  for (const s of series) out += `<path class="${s.cls ?? "trace"}" d="${path(E, s.y, sx, sy)}"${s.color ? ` style="stroke:var(${s.color})"` : ""}/>`;
  svg.innerHTML = out;
  tips(svg);
  return { sx, sy, w, m };
}

/** PFI (or any per-window importance) profiles, one line per analyte, with E3 windows under the axis. */
export function profileChart(svg, { analytes, profiles, centers, windows = [], height = 260, focus = null }) {
  const hasWin = windows.some(Boolean);
  const w = size(svg, height);
  const m = { l: 40, r: 12, t: 16, b: hasWin ? 66 : 30 };
  const sx = lin(0, 0.8, m.l, w - m.r);
  const sy = lin(0, 1.05, height - m.b, m.t);
  let out = "";
  for (const v of [0, 0.5, 1]) out += `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${sy(v)}" y2="${sy(v)}"/><text x="${m.l - 8}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`;
  for (const v of [0, 0.2, 0.4, 0.6, 0.8]) out += `<text x="${sx(v)}" y="${height - m.b + 18}" text-anchor="middle">${v.toFixed(1)} V</text>`;
  windows.forEach((win, k) => {
    if (!win) return;
    const y = height - m.b + 30 + k * 8;
    out += `<rect x="${sx(win.lo)}" y="${y}" width="${Math.max(2, sx(win.hi) - sx(win.lo))}" height="4" rx="2" style="fill:var(${analytes[k].color});opacity:${focus == null || focus === k ? 1 : 0.25}" data-tip="<div class='tt-h'>${esc(analytes[k].name)} · peak window (E3)</div><div class='tt-r'><span>${win.lo.toFixed(3)}–${win.hi.toFixed(3)} V</span><b>peak ${win.center.toFixed(3)} V</b></div>"/>`;
    out += `<line x1="${sx(win.center)}" x2="${sx(win.center)}" y1="${y - 2}" y2="${y + 6}" style="stroke:var(--ink);stroke-width:1.4;opacity:${focus == null || focus === k ? 1 : 0.25}"/>`;
  });
  profiles.forEach((p, k) => {
    const dim = focus != null && focus !== k;
    out += `<path d="${path(centers, p, sx, sy)}" style="fill:none;stroke:var(${analytes[k].color});stroke-width:${dim ? 1.4 : 2.2};opacity:${dim ? 0.22 : 1};stroke-linejoin:round"/>`;
    const j = p.indexOf(Math.max(...p));
    if (!dim) {
      out += `<circle cx="${sx(centers[j])}" cy="${sy(p[j])}" r="4.5" style="fill:var(${analytes[k].color});stroke:var(--surface);stroke-width:2" data-tip="<div class='tt-h'>${esc(analytes[k].name)} · most important window</div><div class='tt-r'><span>centre</span><b>${centers[j].toFixed(3)} V</b></div>"/>`;
    }
  });
  svg.innerHTML = out;
  tips(svg);
}

/** A tiny line with optional area, for cards. */
export function sparkline(svg, ys, { color = "--ink", height = 64, area = true, xs = null, stroke = 1.8, min = null, max = null } = {}) {
  const w = size(svg, height);
  const X = xs ?? ys.map((_, i) => i);
  const [lo, hi] = [min ?? Math.min(...ys), max ?? Math.max(...ys)];
  const sx = lin(X[0], X[X.length - 1], 2, w - 2);
  const sy = lin(lo, hi, height - 4, 4);
  const d = path(X, ys, sx, sy);
  svg.innerHTML = `${area ? `<path d="${d}L${sx(X[X.length - 1])},${height}L${sx(X[0])},${height}Z" style="fill:var(${color});opacity:.08"/>` : ""}<path d="${d}" style="fill:none;stroke:var(${color});stroke-width:${stroke};stroke-linejoin:round;stroke-linecap:round"/>`;
}
