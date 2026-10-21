// Code check of an LLM text against its evidence file, and the messages sent to the LLM.
// Port of literature/xai_llm_rag/kimyager_raporu/rapor.py (denetle, cumleler, mesaj_rapor, mesaj_soru, the retry note).
// Python's \w, \b and \s are Unicode-aware; here \w is [\p{L}\p{N}_] and \b is written out as lookarounds.
// tools/kimyager_parity.mjs compares the findings with Python on every real and altered LLM text of the 2026-10-21 runs.

import { pyFixed } from "./kanit.js";

const W = "[\\p{L}\\p{N}_]";
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;           // \b
const YASAK = ["shap", "örtme", "olasılık", "eşik", "log-odds", "logit", "katsayı", "dalgacık", "pfi", "lightgbm",
  "permütasyon", "shapley", "referans", "özellik", "algoritma", "skor", "puan", "sage", "spearman", "dilim"];
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const v2 = (x) => pyFixed(x, 2).replace(".", ",");

/** rapor.cumleler: split after . ! ? before a capital, digit, quote or parenthesis. */
export const cumleler = (t) => t.trim().split(/(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ0-9"'(])/u).filter(Boolean);
const words = (s) => s.trim().split(/\s+/u).filter(Boolean);

/** rapor.denetle → findings (Turkish strings, same order and text as Python). kararlar: [{ ad, var }]. */
export function denetle(paragraf, kanit, kararlar, nMin = 3, nMax = 5) {
  const bulgu = [];
  const ss = cumleler(paragraf);
  if (!(nMin <= ss.length && ss.length <= nMax)) bulgu.push(`${ss.length} cümle; ${nMin}–${nMax} olmalı`);
  for (const s of ss) if (words(s).length > 40) bulgu.push(`uzun cümle (${words(s).length} kelime)`);
  const low = paragraf.toLowerCase();
  for (const w of YASAK) if (new RegExp(`${B}${escRe(w)}`, "u").test(low)) bulgu.push(`teknik terim: '${w}'`);
  for (const m of paragraf.matchAll(new RegExp(`${B}[DECGK]\\d\\d${B}`, "gu"))) bulgu.push(`kayıt kimliği: ${m[0]}`);
  const known = new Set(kanit.replaceAll(".", ",").match(/\d+(?:,\d+)?/g) ?? []);
  for (const x of paragraf.match(/\d+(?:[.,]\d+)?/g) ?? []) if (!known.has(x.replaceAll(".", ","))) bulgu.push(`kanıt dosyasında olmayan sayı: ${x}`);
  for (const m of low.matchAll(new RegExp(`${B}${W}+[ıiuü]yoru[mz]${B}`, "gu"))) bulgu.push(`birinci şahıs: '${m[0]}'`);
  if (/tepesi(?!\s+(aralı|bölge))/u.test(low)) bulgu.push("'tepesi' iddiası: bakılan yer maddenin tepesi diye sunulmuş");
  for (const d of kararlar) {
    const stem = d.ad.split(/\s+/)[0].toLowerCase();
    if (d.var && new RegExp(`${stem}${W}*\\s+(yok|bulunmuyor|bulunmadı|tespit edilmedi)`, "u").test(low)) bulgu.push(`karar çelişkisi: ${d.ad} VAR`);
    if (!d.var && new RegExp(`${stem}${W}*\\s+(var${B}|bulunuyor|tespit edildi)`, "u").test(low)) bulgu.push(`karar çelişkisi: ${d.ad} YOK`);
  }
  for (const s of ss) {
    for (const m of s.matchAll(/(\d,\d+)\s*–\s*(\d,\d+)/gu)) {
      const lo = parseFloat(m[1].replace(",", ".")), hi = parseFloat(m[2].replace(",", "."));
      if (hi - lo <= 0.1 && (lo < 0.039 || hi > 0.761) && !/kenar|uç|başı|sonu|kanıt sayıl/u.test(s.toLowerCase()))
        bulgu.push(`kenar aralığı (${v2(lo)}–${v2(hi)} V) kanıt gibi sunulmuş`);
    }
  }
  return bulgu;
}

/** rapor.mesaj_rapor / mesaj_soru: the user message (the system prompt is separate). */
export const mesajRapor = (kanit) => `KANIT DOSYASI\n\`\`\`json\n${kanit}\n\`\`\`\n\nBu kanıt dosyasından 3–5 cümlelik paragrafı yaz.`;
export const mesajSoru = (kanit, paragraf, soru) =>
  `KANIT DOSYASI\n\`\`\`json\n${kanit}\n\`\`\`\n\nKULLANICIYA VERİLEN RAPOR\n${paragraf}\n\nKULLANICININ SORUSU\n${soru}`;

/** rapor._llm: what is appended to the message for the next attempt after a check finding. */
export const duzeltme = (metin, bulgu, nMax) => `\n\nÖnceki yazımın:\n${metin}\n\nSorunlar: ${bulgu.join("; ")}`
  + (bulgu.join(" ").includes("cümle;") ? `\nEn çok ${nMax} cümle: iki cümleyi birleştir ya da en az önemli olanı çıkar.` : "")
  + "\nAynı kanıt dosyasından, bu sorunlar olmadan yeniden yaz.";

/** " ".join(text.split()) */
export const tekSatir = (t) => words(t).join(" ");
