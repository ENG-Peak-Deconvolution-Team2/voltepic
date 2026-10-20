// The LLM's Markdown → safe HTML for the assistant panel. Everything is escaped first; only headings, lists, tables,
// paragraphs, **bold**, *italic*, `code` and [Fxx] citations are turned into markup.

import { esc } from "../ui.js";

const CITE = /\[(F\d{2}(?:\s*[,–-]\s*F\d{2})*)\]/g;

function inline(s, facts) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>")
    .replace(/`([^`]+)`/g, '<code class="mono">$1</code>')
    .replace(CITE, (_, ids) => ids.split(/\s*[,–-]\s*/).map((id) => {
      const f = facts[id];
      return `<span class="fact-ref" tabindex="0" data-fact="${id}"${f ? ` title="${esc(`${id}: ${f.text}`)}"` : ' data-missing=""'}>${id}</span>`;
    }).join(""));
}

/** Markdown subset → HTML; `facts` (by id) give the citation chips their text. */
export function renderReport(md, facts) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "), facts)}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((x) => `<li>${inline(x, facts)}</li>`).join("")}</${list.tag}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^-{3,}$/.test(line)) { flushPara(); flushList(); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); flushList(); out.push(`<h${Math.min(6, h[1].length + 3)}>${inline(h[2], facts)}</h${Math.min(6, h[1].length + 3)}>`); continue; }
    if (line.startsWith("|")) {
      flushPara(); flushList();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++].trim());
      i--;
      const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const body = rows.filter((r) => !/^\|?(\s*:?-{3,}:?\s*\|)+\s*(:?-{3,}:?\s*)?\|?$/.test(r));
      const [head, ...rest] = body.map(cells);
      out.push(`<div class="llm-table"><table><thead><tr>${(head ?? []).map((c) => `<th>${inline(c, facts)}</th>`).join("")}</tr></thead>`
        + `<tbody>${rest.map((r) => `<tr>${r.map((c) => `<td>${inline(c, facts)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const b = line.match(/^([-*•])\s+(.*)$/), n = line.match(/^\d+[.)]\s+(.*)$/);
    if (b || n) {
      flushPara();
      const tag = b ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push((b ?? n)[b ? 2 : 1]);
      continue;
    }
    if (/^\*\*[^*]+\*\*:?$/.test(line)) { flushPara(); flushList(); out.push(`<h5>${inline(line.replace(/^\*\*|\*\*:?$/g, ""), facts)}</h5>`); continue; }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out.join("");
}
