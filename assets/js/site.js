// Site behaviour shared by every page: theme, navigation, scroll reveals, the command palette.

import { $, $$, esc } from "./ui.js";
import { ANALYTES, getLibrary } from "./data.js";

const here = location.pathname.split("/").pop() || "index.html";

/* shared overlay hosts used by ui.js (tooltip, toasts) */
for (const [id, cls, extra] of [["tooltip", "tooltip", { role: "tooltip", hidden: true }], ["toasts", "toasts", { "aria-live": "polite" }]]) {
  if (!document.getElementById(id)) {
    const el = Object.assign(document.createElement("div"), { id, className: cls });
    for (const [k, v] of Object.entries(extra)) el.setAttribute(k, v === true ? "" : v);
    document.body.append(el);
  }
}

/* ───────────── Theme ───────────── */
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("pd-theme", next); } catch { /* storage blocked */ }
  dispatchEvent(new CustomEvent("themechange", { detail: next }));
}
for (const b of $$("[data-theme-toggle]")) b.addEventListener("click", toggleTheme);

/* ───────────── Navigation ───────────── */
const navEl = $(".site-nav");
const onScroll = () => navEl?.classList.toggle("scrolled", scrollY > 4);
addEventListener("scroll", onScroll, { passive: true });
onScroll();
const burger = $("[data-burger]");
burger?.addEventListener("click", () => {
  const open = $("#navLinks").classList.toggle("open");
  burger.setAttribute("aria-expanded", String(open));
});

/* ───────────── Reveal on scroll ───────────── */
const io = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 })
  : null;
export function observeReveal(root = document) {
  for (const el of root.querySelectorAll(".reveal:not(.in)")) io ? io.observe(el) : el.classList.add("in");
}
observeReveal();

/* ───────────── Command palette ───────────── */
const PAGE_ITEMS = [
  ["index.html", "Overview", "VoltEPIC in one page"],
  ["app.html", "Analyzer", "Load a curve and read the four decisions"],
  ["method.html", "Method", "From raw current to a decision, step by step"],
  ["explainability.html", "Explainability", "Where the model looks, and how we tested that"],
  ["data.html", "Dataset", "ACS-ML-Biomarker: chips, coatings, concentrations"],
  ["model.html", "Model card", "Held-out results, reference check, limits"],
  ["about.html", "About", "ENG Peak Deconvolution, Team 2"],
];
const ICONS = {
  page: '<svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z"/><path d="M14 3.5V8h4"/></svg>',
  action: '<svg viewBox="0 0 24 24"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/></svg>',
  curve: '<svg viewBox="0 0 24 24"><path d="M3 17c3 0 3.5-9 6-9s2.5 6 4.5 6 2-3.5 4-3.5S20 17 21 17"/></svg>',
};

let palette;
let items = [];
let active = 0;

function buildPalette() {
  palette = document.createElement("dialog");
  palette.className = "palette";
  palette.setAttribute("aria-label", "Search");
  palette.innerHTML = `
    <div class="pal-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
      <input type="text" placeholder="Search pages, actions, or curves — try “2E 100” or “PVDF”" aria-label="Search" autocomplete="off"></div>
    <ul class="pal-list" role="listbox"></ul>
    <div class="pal-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>`;
  document.body.append(palette);
  const input = $("input", palette);
  input.addEventListener("input", () => render(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); items[active]?.run(); }
  });
  palette.addEventListener("click", (e) => {
    if (e.target === palette) palette.close();
    const li = e.target.closest(".pal-item");
    if (li) items[+li.dataset.i]?.run();
  });
  palette.addEventListener("mousemove", (e) => {
    const li = e.target.closest(".pal-item");
    if (li && +li.dataset.i !== active) { active = +li.dataset.i; mark(); }
  });
}

let library = null;
function render(query = "") {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (text) => words.every((w) => text.toLowerCase().includes(w));
  const go = (href) => () => { palette.close(); location.href = href; };
  const groups = [];
  const pages = PAGE_ITEMS.filter(([, t, d]) => match(`${t} ${d}`)).map(([href, t, d]) => ({ icon: "page", title: t, sub: d, run: go(href) }));
  if (pages.length) groups.push(["Pages", pages]);
  const actions = [
    { icon: "action", title: "Analyze a random held-out curve", sub: "Analyzer", run: go("app.html#s=random") },
    { icon: "action", title: "Upload a measurement", sub: "CSV or CHI .txt", run: go("app.html#upload") },
    { icon: "action", title: "Switch light / dark theme", sub: "Theme", run: () => { palette.close(); toggleTheme(); } },
  ].filter((a) => match(`${a.title} ${a.sub}`));
  if (actions.length) groups.push(["Actions", actions]);
  if (library) {
    const curves = library.samples.filter((s) => match(`${s.title} ${s.chip} ${s.polymer} ${s.file}`)).slice(0, words.length ? 30 : 6)
      .map((s) => ({ icon: "curve", title: s.title, sub: `${s.chip} · ${s.polymer} · #${s.index + 1}`, dots: s.labels, run: go(`app.html#s=${s.index}`) }));
    if (curves.length) groups.push([`Held-out curves${words.length ? "" : " · type to search all 125"}`, curves]);
  }
  items = groups.flatMap(([, g]) => g);
  active = 0;
  let i = 0;
  $(".pal-list", palette).innerHTML = groups.map(([name, g]) => `<li class="pal-group">${esc(name)}</li>` + g.map((it) => `
    <li class="pal-item" role="option" data-i="${i++}"><span class="pi-icon">${ICONS[it.icon]}</span><span>${esc(it.title)}</span>
    ${it.dots ? `<span class="dots" aria-hidden="true">${ANALYTES.map((a, k) => `<i style="--c:var(${a.color})" ${it.dots[k] > 0 ? "data-on" : ""}></i>`).join("")}</span>` : ""}
    <span class="pi-sub">${esc(it.sub)}</span></li>`).join("")).join("") || `<li class="pal-group">No match</li>`;
  mark();
}
function mark() {
  for (const li of $$(".pal-item", palette)) li.setAttribute("aria-selected", String(+li.dataset.i === active));
  $(`.pal-item[data-i="${active}"]`, palette)?.scrollIntoView({ block: "nearest" });
}
function move(d) { if (items.length) { active = (active + d + items.length) % items.length; mark(); } }

export function openPalette(query = "") {
  if (!palette) buildPalette();
  const input = $("input", palette);
  input.value = query;
  render(query);
  palette.showModal();
  input.focus();
  if (!library) getLibrary().then((lib) => { library = lib; if (palette.open) render(input.value); }).catch(() => {});
}
for (const b of $$("[data-palette]")) b.addEventListener("click", () => openPalette());
addEventListener("keydown", (e) => {
  const typing = e.target.closest?.("input, textarea, select, [contenteditable]");
  if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); palette?.open ? palette.close() : openPalette(); }
  else if (e.key === "/" && !typing && !palette?.open) { e.preventDefault(); openPalette(); }
});

export { here };
