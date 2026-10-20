// Post-generation check of an LLM report against its packet — deterministic, no LLM.
// Port of literature/xai_llm_rag/prototip/verify_report.py + kosu_2026-10-20_v02/dogrula.py check2 (the corrected pass).
// Python's \w and \b are Unicode-aware; here they are written out as lookarounds over [\p{L}\p{N}_].
// tools/llm_parity.mjs compares the findings with Python on every report of the two runs.

const W = "[\\p{L}\\p{N}_]";
const word = (body, flags = "iu") => new RegExp(`(?<!${W})(?:${body})(?!${W})`, flags);

const NUM = new RegExp(`(?<![\\p{L}\\p{N}_.])[-+−]?\\d+(?:[.,]\\d+)?`, "gu");
const CITE = /\[(F\d{2})(?:\s*,\s*(F\d{2}))*\]/g;
const SENT = /(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ0-9*])/u;
const POS = word("VAR|tespit edildi|saptandı|bulundu|mevcut");
const NEG = word("YOK|tespit edilmedi|saptanmadı|bulunmadı");
const PEAK = /tepe|pik|peak/i;
const HEDGE = /okunma(malı|ması)|yorumlanma(malı|ması)|değil|anlamsız|artefakt/iu;
const ANALYTE_TOK = new RegExp(`5-?HT|(?<!${W})2E(?!${W})`, "giu");
const DIR_PHRASE = new RegExp(`(?<!${W})(VAR|YOK)\\s*(yönün${W}*|'a|'ya)`, "giu");
const CARD_CITE = /[[(]\s*kart:[^\])]*[\])]/iu;
const POST_CITE = /([.!?])\s*(\[F\d{2}(?:\s*,\s*F\d{2})*\])/g;
const WINDOW_WORD = new RegExp(`tepe\\s+pencere${W}*`, "giu");
const LINES = new RegExp("\r\n|[\n\v\f\r\x1c-\x1e\x85\u2028\u2029]");
const TR = { AA: "askorbik asit" };

const cut = (s) => [...s].slice(0, 90).join("");
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function numbers(text) {
  return [...text.matchAll(NUM)].map((m) => m[0].replaceAll(",", ".").replaceAll("−", "-").replace(/^\++/, ""));
}

function flatValues(v, out = []) {
  if (typeof v === "number") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => flatValues(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => flatValues(x, out));
  return out;
}

function matches(tok, pool) {
  const x = parseFloat(tok);
  const dec = tok.includes(".") ? tok.split(".")[1].length : 0;
  const tol = 0.5 * 10 ** -dec + 1e-9;
  return pool.some((v) => Math.abs(Math.abs(x) - Math.abs(v)) <= tol);
}

const citeIds = (s) => [...s.matchAll(CITE)].flatMap((m) => m[0].match(/F\d{2}/g));
const stripCites = (s) => s.replace(CITE, "");

function isLabel(s) {
  const w = s.match(new RegExp(`${W}+`, "gu")) ?? [];
  return w.length <= 4 && !/\d\.\d/.test(s);
}

/** Bullet lines are separate sentences; a citation after the full stop belongs to the sentence; an uncited sentence
 *  inherits the next citation on the same line. Returns [{ s, own, inherited }]. */
export function sentences(text) {
  const out = [];
  for (let line of text.split(LINES)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("**") && line.endsWith("**") && !line.includes("[F")) continue;
    line = line.replace(/^[-*]\s+/, "").replaceAll("**", "");
    line = line.replace(POST_CITE, " $2$1");
    const sents = line.split(SENT).map((s) => s.trim()).filter((s) => [...s].length >= 3);
    let inherit = null;
    const tagged = [];
    for (const s of [...sents].reverse()) {
      const own = citeIds(s);
      if (own.length || CARD_CITE.test(s)) inherit = own.length ? own : inherit;
      tagged.push({ s, own, inherited: own.length ? null : inherit });
    }
    out.push(...tagged.reverse().filter((t) => !isLabel(t.s)));
  }
  return out;
}

/**
 * Check `text` against the packet (facts + detection) and the prompt (card numbers count as supported).
 * Returns { issues: [{ kind, text, sentence }], checked, cardSentences, groupCited }; `text` matches Python's strings.
 */
export function verify({ facts, detection }, prompt, text) {
  const byId = Object.fromEntries(facts.map((f) => [f.id, f]));
  const det = new Map();
  detection.forEach((d) => det.set(d.name.toLowerCase(), d.detected));
  detection.forEach((d) => det.set(d.analyte.toLowerCase(), d.detected));
  detection.forEach((d) => { if (TR[d.analyte]) det.set(TR[d.analyte], d.detected); });
  const bilgi = prompt.match(/<bilgi>([\s\S]*)<\/bilgi>/);
  const cardPool = bilgi ? numbers(bilgi[1]).map(Number) : [];
  const issues = [];
  const add = (kind, label, s) => issues.push({ kind, text: `${label}: «${cut(s)}»`, sentence: s });
  let checked = 0, cardSentences = 0, groupCited = 0;
  for (const { s, own, inherited } of sentences(text)) {
    checked++;
    const ids = own.length ? own : inherited ?? [];
    if (!own.length && inherited) groupCited++;
    const hasCard = CARD_CITE.test(s) || /bilgi kart/i.test(s);
    if (!ids.length && !hasCard) { add("uncited", "ATIF YOK", s); continue; }
    if (!ids.length) cardSentences++;
    if (ids.some((i) => !byId[i])) { add("unknown", "BİLİNMEYEN OLGU", s); continue; }
    const pool = ids.flatMap((i) => [...flatValues(byId[i].values), ...numbers(byId[i].text).map(Number)]);
    const bare = stripCites(s).replace(new RegExp(CARD_CITE.source, "giu"), "").replace(ANALYTE_TOK, " ");
    for (const tok of numbers(bare)) {
      if (matches(tok, pool) || matches(tok, cardPool)) continue;
      add("number", `DAYANAKSIZ SAYI ${tok}`, s);
    }
    const noWindow = s.replace(WINDOW_WORD, " ");
    if (ids.some((i) => byId[i].values.edge_window) && PEAK.test(noWindow) && !HEDGE.test(s)) add("edge", "UÇ BÖLGE TEPE DİYE SUNULMUŞ", s);
    const dec = s.replace(DIR_PHRASE, " ");
    for (const [name, d] of det) {
      if (!word(escRe(name)).test(dec)) continue;
      const pos = POS.test(dec), neg = NEG.test(dec);
      if (pos && !neg && !d) add("decision", `KARAR ÇELİŞKİSİ (${name}: pakette YOK)`, s);
      if (neg && !pos && d) add("decision", `KARAR ÇELİŞKİSİ (${name}: pakette VAR)`, s);
    }
  }
  return { issues, checked, cardSentences, groupCited };
}
