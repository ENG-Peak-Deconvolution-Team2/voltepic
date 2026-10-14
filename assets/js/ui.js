// Small DOM and formatting helpers shared by the views.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Escape text for innerHTML templates. */
export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Concentration in nM → "200 nM" / "3 µM". */
export function conc(nM) {
  if (!nM) return "0";
  if (nM >= 1000) return `${+(nM / 1000).toFixed(2)} µM`;
  return `${+nM.toFixed(1)} nM`;
}

export const pct = (p, digits = 0) => `${(p * 100).toFixed(digits)}%`;
export const volt = (v) => `${v.toFixed(3)} V`;

/** Significant-figure formatter for currents (µA). */
export function amp(v, sig = 3) {
  if (!isFinite(v)) return "—";
  if (v === 0) return "0";
  const d = Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(v))));
  return v.toFixed(Math.min(d, 6));
}

/** Current in µA → { f, u }: the unit that suits its magnitude. */
export function currentUnit(maxAbs) {
  if (maxAbs >= 1) return { f: 1, u: "µA" };
  if (maxAbs >= 1e-3) return { f: 1e3, u: "nA" };
  return { f: 1e6, u: "pA" };
}

/** Current in µA → "164 nA" / "1.25 µA" / "3.1 pA" (3 significant figures). */
export function fmtI(v, sig = 3) {
  const { f, u } = currentUnit(Math.abs(v));
  if (v !== 0 && Math.abs(v * f) < 0.01) return `${(v * f).toExponential(1)} ${u}`;
  return `${amp(v * f, sig)} ${u}`;
}

/** "Nice" axis ticks covering [lo, hi]. */
export function niceTicks(lo, hi, count = 5) {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count + 0.5);
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let t = start; t <= hi + step * 1e-9; t += step) ticks.push(+t.toPrecision(12));
  return { ticks, step, lo: ticks[0], hi: Math.max(ticks[ticks.length - 1], hi) };
}

/** Animate a number inside an element. */
export function countUp(el, to, { from = 0, duration = 900, format = (v) => v.toFixed(0) } = {}) {
  if (reducedMotion() || document.documentElement.classList.contains("still")) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / duration);
    const e = 1 - (1 - k) ** 3;
    el.textContent = format(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const tipEl = () => document.getElementById("tooltip");

/** Show the shared tooltip near a client point. */
export function showTip(html, x, y) {
  const tip = tipEl();
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 16;
  let top = y + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 16;
  if (top + r.height > innerHeight - 8) top = y - r.height - 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}
export const hideTip = () => { tipEl().hidden = true; };

/** Attach a hover tooltip to every element matching `selector` inside `root`. */
export function hoverTips(root, selector, html) {
  root.addEventListener("pointermove", (ev) => {
    const target = ev.target.closest(selector);
    if (!target || !root.contains(target)) { hideTip(); return; }
    showTip(html(target), ev.clientX, ev.clientY);
  });
  root.addEventListener("pointerleave", hideTip);
}

export function toast(message, tone = "info", ms = 4200) {
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.dataset.tone = tone;
  el.textContent = message;
  box.append(el);
  setTimeout(() => { el.classList.add("out"); el.addEventListener("animationend", () => el.remove()); }, ms);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/** Wire a `.seg` radio group; calls onChange(value). */
export function segmented(root, onChange) {
  root.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-v]");
    if (!btn) return;
    for (const b of root.querySelectorAll("button")) b.setAttribute("aria-checked", String(b === btn));
    onChange(btn.dataset.v);
  });
}

export function download(name, text, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
