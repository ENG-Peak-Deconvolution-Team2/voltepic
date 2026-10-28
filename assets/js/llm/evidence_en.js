// The English evidence file the Lab LLM reads: a rule-by-rule translation of kanit.js's Turkish evidence file. The numbers
// and decisions are computed once, in kanit.js (checked against rapor.py by tools/kimyager_parity.mjs); every Turkish text
// in that file comes from a fixed set of templates, translated here. A key or text that matches no rule throws, so nothing
// Turkish reaches the model unnoticed (tools/evidence_en_check.mjs runs every library curve and the 2026-10-21 examples).
// Decimal commas become points.

const NAME = { "Askorbik asit": "Ascorbic acid", Serotonin: "Serotonin", Estradiol: "Estradiol", Melatonin: "Melatonin" };
const LOWER = { "askorbik asit": "ascorbic acid", serotonin: "serotonin", estradiol: "estradiol", melatonin: "melatonin" };
export const BASIS = { güçlü: "strong", orta: "moderate", zayıf: "weak", şüpheli: "suspect", yerinde: "sound", gösterilemedi: "not shown" };
const DECISION = { VAR: "PRESENT", YOK: "ABSENT" };
const AGREE = { "ihmal edilebilir": "negligible", zayıf: "weak", orta: "moderate", güçlü: "strong", "çok güçlü": "very strong" };

const KEYS = {
  kanit_dosyasi_surumu: "evidence_file_version", olcum: "measurement", teknik: "technique", kaplama: "coating", cip: "chip",
  kaynak: "source", okuma_notu: "reading_note", kararlar: "decisions", id: "id", analit: "analyte", kod: "code", puan: "score",
  esik: "threshold", karar: "decision", esige_gore: "relative_to_threshold", blank_olcumunde_karar: "decision_on_blank",
  degerlendirme: "assessment", dayanak: "basis", neden: "reason", ayrinti: "detail", analitler: "analytes", bu_egri: "this_curve",
  "SHAP (referans: aynı çip/gün/elektrodun blank ölçümü)": "SHAP (reference: blank of the same chip, day and electrode)",
  "örtme (dolgu: aynı elektrodun blank ölçümü)": "occlusion (fill: blank of the same electrode)",
  kararla_ayni_yonde_VAR: "same_direction_as_decision_PRESENT", kararla_ayni_yonde_YOK: "same_direction_as_decision_ABSENT",
  karara_karsi_yonde: "against_decision", dilim: "slice", katki: "contribution", yer: "location",
  iki_yontem_karsilastirmasi: "two_methods_compared", olgu: "fact", model_geneli: "model_wide", PFI_en_onemli_3: "PFI_top_3",
  SAGE_en_onemli_3: "SAGE_top_3", bu_egri_model_geneline_gore: "this_curve_against_the_model", kimya: "chemistry",
  tepe_merkezleri_ve_pencereleri_V: "peak_centres_and_windows_V", merkez: "centre", pencere: "window",
  egride_gorulen_tepeler_blank_cikarilmis: "peaks_seen_on_the_curve_blank_subtracted", E_V: "E_V", goreli_yukseklik: "relative_height",
  yakin_pencere_siniri: "near_a_window_limit", yontem_guveni: "method_trust", matris: "matrix", testlerin_anlami: "what_the_tests_ask",
  Örtme: "Occlusion", KernelSHAP: "KernelSHAP", PFI: "PFI", SAGE: "SAGE", kapsam: "scope", "E1 sadakat": "E1 faithfulness",
  "E2 kararlılık": "E2 stability", "E3 tepe penceresi": "E3 peak window", "E4 uç yapaylığı": "E4 edge artefact",
  "E5 rastgele etiket": "E5 random label", kullanici_baglami: "user_context", kontrol_onerileri: "check_suggestions",
  genel_notlar: "general_notes", soru: "question", AA: "AA", "5-HT": "5-HT", "2E": "2E", Mela: "Mela",
};

const N = "[−-]?\\d+(?:\\.\\d+)?";                  // a number, after decimal commas became points
const R = `${N}–${N} V`;                            // a potential range
const names = (s, map) => s.split(", ").map((x) => map[x] ?? bad(x)).join(", ");
const bad = (s) => { throw new Error(`evidence_en: no English rule for "${s}"`); };
const place = (s) => {                              // a location tag (kanit.js konum / gozlenenTepeler)
  const [base, edge] = s.split(" · ");
  if (edge && edge !== "eğrinin UCU") bad(s);
  const out = { "kendi tepe penceresi": "its own peak window", "pencere tanımlı değil (P4VP)": "no window defined (P4VP)",
    "pencere tanımlı değil": "no window defined", "hiçbir analitin penceresinde değil": "in no analyte's window",
    "hiçbir pencerede değil": "in no window" }[base]
    ?? base.split(" / ").map((w) => `${NAME[w.replace(/ penceresi$/, "")] ?? bad(s)} window`).join(" / ");
  return out + (edge ? " · curve EDGE" : "");
};

/** [pattern, English] in order; the first match wins. Patterns see the text with decimal points. */
const RULES = [
  [new RegExp(`^(${R}|${N}|[DECGK]\\d+|MC\\d+|PVDF|P4VP|AA|5-HT|2E|Mela)$`), (m) => m[0]],
  [/^(Askorbik asit|Serotonin|Estradiol|Melatonin)$/, (m) => NAME[m[1]]],
  [/^(güçlü|orta|zayıf|şüpheli|yerinde|gösterilemedi)$/, (m) => BASIS[m[1]]],
  [new RegExp(`^(VAR|YOK)(?: \\((${N})\\))?$`), (m) => DECISION[m[1]] + (m[2] ? ` (${m[2]})` : "")],
  [/^eşikten uzak$/, () => "far from the threshold"],
  [/^eşiğe yakın$/, () => "near the threshold"],
  [/^bilinmiyor$/, () => "unknown"],
  [new RegExp(`^%(${N})$`), (m) => `${m[1]}%`],
  [/^(kendi tepe penceresi|pencere tanımlı değil|hiçbir|.+ penceresi( · |$| \/ ))/, (m) => place(m.input)],
  [new RegExp(`^(${NAMES()}) penceresinin (üst|alt) sınırına (${N}) V$`), (m) => `${m[3]} V from the ${m[2] === "üst" ? "upper" : "lower"} limit of the ${NAME[m[1]]} window`],
  [new RegExp(`^(tuttu|koşullu)(?: (${N}(?:–${N})?))?$`), (m) => (m[1] === "tuttu" ? "held" : "conditional") + (m[2] ? ` ${m[2]}` : "")],
  [new RegExp(`^zayıf, en iyi (${N})$`), (m) => `weak, best ${m[1]}`],
  [/^bu eğri$/, () => "this curve"],
  [/^model geneli$/, () => "model-wide"],
  [/^haritanın önemli dediği dilimler bozulunca modelin puanı gerçekten değişiyor mu$/,
    () => "does the model's output really change when the slices the map calls important are disturbed"],
  [/^aynı eğri yeniden açıklanınca \/ başka tohumla eğitilen modelde harita benziyor mu$/,
    () => "is the map alike when the same curve is explained again / for a model trained with another seed"],
  [/^en önemli dilim analitin bilinen tepe penceresine düşüyor mu \(PVDF\)$/,
    () => "does the most important slice fall in the analyte's known peak window (PVDF)"],
  [/^eğrinin ilk\/son (\d+) noktasına yığılan önem; dalgacık özelliklerinin yapay ürünü olabilir$/,
    (m) => `importance piled on the first/last ${m[1]} points of the curve; it may be an artefact of the wavelet features`],
  [/^etiketi karıştırılmış modelin haritası gerçeğinkinden farklı mı \(fark varsa harita öğrenilene bağlı\)$/,
    () => "does the map of a model trained on shuffled labels differ from the real one (if it does, the map depends on what was learned)"],
  [/^kimyager_raporu (\S+) \(şema: build_tasarim, taslak (\S+)\)$/, (m) => `chemist_report ${m[1]} (English; schema: build_tasarim, draft ${m[2]})`],
  [new RegExp(`^SWV (${R}), (\\d+) mV adım, (\\d+) mV genlik, (\\d+) Hz$`), (m) => `SWV ${m[1]}, ${m[2]} mV step, ${m[3]} mV amplitude, ${m[4]} Hz`],
  [/^(kütüphane eğrisi \(held-out\)|yüklenen eğri); blank: (\d+) dosya( ortalaması)?$/,
    (m) => `${m[1] === "yüklenen eğri" ? "uploaded curve" : "library curve (held-out)"}; blank: ${m[3] ? `mean of ${m[2]} files` : `${m[2]} file`}`],
  [/^Katkı işareti: \+ kararı VAR'a, − YOK'a iter\. SHAP ve örtme katkıları farklı ölçeklerde; iki yöntem arasında büyüklük değil sıra karşılaştırılır\. Dilimler (\d+) mV\.$/,
    (m) => `Contribution sign: + pushes the decision to PRESENT, − to ABSENT. SHAP and occlusion contributions are on different scales; `
      + `between the two methods ranks are compared, not sizes. Slices are ${m[1]} mV.`],
  [/^(\d+) yöntem × (\d+) test, (\d+) tohum × (\d+) model, (\d+) mV, PVDF \(model düzeyi; bu eğriye özel değil\)$/,
    (m) => `${m[1]} methods × ${m[2]} tests, ${m[3]} seeds × ${m[4]} models, ${m[5]} mV, PVDF (model level; not specific to this curve)`],
  [new RegExp(`^Ölçümün ilk ve son (${N}) V'u \\(yer etiketinde 'eğrinin UCU'\\) kanıt sayılmaz: testlerde model bu kenarlara kimyayla ilgisiz ağırlık verdi\\.$`),
    (m) => `The first and last ${m[1]} V of the measurement (location tag 'curve EDGE') do not count as evidence: in the tests the model gave these edges weight unrelated to chemistry.`],
  [new RegExp(`^Bu kaplamada dört maddenin tepeleri (${R}) arasına sıkışıyor; bakılan yerden madde ayırt edilemez\\.$`),
    (m) => `On this coating the four analytes' peaks crowd into ${m[1]}; the analyte cannot be told from where the model looks.`],
  [new RegExp(`^P4VP'de dört tepe (${N}–${N}) V'a sıkışık; pencere tanımlı değil$`), (m) => `On P4VP the four peaks crowd into ${m[1]} V; no windows defined`],
  [/^Ölçümün hangi çipten geldiği bilinmiyor\. Model yalnız (\d+) çipte eğitildi; o çiplerde ölçülen başarı başka bir elektrot için geçerli sayılamaz\.$/,
    (m) => `The chip of this measurement is unknown. The model was trained on only ${m[1]} chips; the performance measured on them cannot be taken to hold for another electrode.`],
  [/^Bu çip \((MC\d+)\) modelin eğitiminde yok; eğitimdeki (\d+) çipte ölçülen başarı bu çip için geçerli sayılamaz\.$/,
    (m) => `This chip (${m[1]}) was not in the model's training; the performance measured on the ${m[2]} training chips cannot be taken to hold for this chip.`],
  // reasons of the basis labels (kanit.js degerlendir)
  [/^bu karar için modelin baktığı yer gösterilemiyor$/, () => "where the model looks for this decision cannot be shown"],
  [/^eğri bu madde açısından boş ölçümden ayrılmıyor$/, () => "for this analyte the curve does not differ from the blank measurement"],
  [/^modelin baktığı yer yalnız ölçümün kenarı$/, () => "the model looks only at the edge of the measurement"],
  [/^iki yöntem aynı yeri gösteriyor, ama bu kaplamada tepeler üst üste$/, () => "the two methods point to the same place, but on this coating the peaks overlap"],
  [/^iki yöntem farklı yerleri gösteriyor; bu kaplamada tepeler üst üste$/, () => "the two methods point to different places; on this coating the peaks overlap"],
  [/^iki yöntem aynı yeri gösteriyor ve bu yer maddenin beklenen tepe aralığında$/,
    () => "the two methods point to the same place, and it lies in the analyte's expected peak range"],
  [/^modelin baktığı yer (.+) için beklenen aralıkta$/, (m) => `the model looks at the range expected for ${names(m[1], LOWER)}`],
  [/^iki yöntem aynı yeri gösteriyor; yer beklenen aralığın kıyısında$/, () => "the two methods point to the same place, at the edge of the expected range"],
  [/^maddenin beklenen aralığı gösteriliyor, ama iki yöntem aynı yerde birleşmiyor$/,
    () => "the analyte's expected range is shown, but the two methods do not meet at the same place"],
  [/^modelin baktığı yer bilinen bir tepe aralığında değil$/, () => "the model looks at a place in no known peak range"],
  [new RegExp(`^model aynı elektrodun boş ölçümüne de 'var' dedi \\((${N})\\), bu ölçüme '(var|yok)'; iki açıklama da bu ölçümü boş ölçümle karşılaştırdığı için gösterdikleri yer kararın nedeni değil, yalnız ölçümün boş ölçümden farkı\\. Model eğitimde analitsiz ölçüm görmedi\\.$`),
    (m) => `the model also said 'present' to the blank measurement of the same electrode (${m[1]}), and '${m[2] === "var" ? "present" : "absent"}' to this measurement; `
      + "since both explanations compare this measurement with the blank, the place they show is not the reason for the decision, only how the measurement "
      + "differs from the blank. The model saw no analyte-free measurement in training."],
  // check suggestions (kanit.js degerlendir)
  [new RegExp(`^(${NAMES()}): dayanak gösterilemediği için standart ekleme ile teyit edilebilir\\.$`),
    (m) => `${NAME[m[1]]}: the basis cannot be shown, so the decision can be confirmed by standard addition.`],
  [new RegExp(`^(${NAMES()}): ölçümü tekrarlayın; karar kenardaki akıma dayanıyor\\.$`),
    (m) => `${NAME[m[1]]}: repeat the measurement; the decision rests on the current at the edge.`],
  [new RegExp(`^(${NAMES()}): (.+) içermeyen bir numuneyle ya da standart ekleme ile doğrulayın; iki maddenin sinyali karışıyor olabilir\\.$`),
    (m) => `${NAME[m[1]]}: verify with a sample free of ${names(m[2], LOWER)} or by standard addition; the two analytes' signals may be mixing.`],
  [new RegExp(`^(${NAMES()}): karar sınırda; ölçümü tekrarlayın\\.$`), (m) => `${NAME[m[1]]}: the decision is borderline; repeat the measurement.`],
  [new RegExp(`^(${NAMES()}): standart ekleme ile doğrulayın\\.$`), (m) => `${NAME[m[1]]}: verify by standard addition.`],
  // facts comparing the two methods (kanit.js kanitDosyasi)
  [new RegExp(`^iki yöntemin kararla aynı yönde \\((VAR|YOK)\\) en güçlü dilimi (aynı|komşu|farklı)(?: \\(SHAP (${R}), örtme (${R})\\)| \\((${R})\\))$`),
    (m) => `the two methods' strongest slice in the decision's direction (${DECISION[m[1]]}) is ${{ aynı: "the same", komşu: "adjacent", farklı: "different" }[m[2]]}`
      + (m[3] ? ` (SHAP ${m[3]}, occlusion ${m[4]})` : ` (${m[5]})`)],
  [new RegExp(`^kararla aynı yönde ilk (\\d+)'te ortak dilim: (yok|${R}(?:, ${R})*)$`),
    (m) => `slices shared by both top-${m[1]} lists in the decision's direction: ${m[2] === "yok" ? "none" : m[2]}`],
  [new RegExp(`^karara karşı yönde ilk (\\d+)'de ortak dilim: (yok|${R}(?:, ${R})*)$`),
    (m) => `slices shared by both top-${m[1]} lists against the decision: ${m[2] === "yok" ? "none" : m[2]}`],
  [new RegExp(`^(\\d+) dilimlik iki haritanın sıra uyumu \\(Spearman\\) (${N}) \\((ihmal edilebilir|zayıf|orta|güçlü|çok güçlü)\\)$`),
    (m) => `rank agreement of the two ${m[1]}-slice maps (Spearman) ${m[2]} (${AGREE[m[3]]})`],
  [new RegExp(`^(SHAP'ın|örtmenin) kararla aynı yönde en güçlü dilimi \\((${R})\\) modelin bu analit için genelde en çok baktığı (\\d+) dilim arasında( DEĞİL)? \\(PFI: (evet|hayır), SAGE: (evet|hayır)\\)$`),
    (m) => `${m[1] === "SHAP'ın" ? "SHAP's" : "occlusion's"} strongest slice in the decision's direction (${m[2]}) is ${m[4] ? "NOT " : ""}among the ${m[3]} slices `
      + `the model looks at most for this analyte in general (PFI: ${m[5] === "evet" ? "yes" : "no"}, SAGE: ${m[6] === "evet" ? "yes" : "no"})`],
];
function NAMES() { return Object.keys(NAME).join("|"); }

/** One Turkish text → English (decimal commas → points); throws when no rule fits. */
export function enText(s) {
  const t = s.replace(/(\d),(\d)/g, "$1.$2");
  for (const [re, f] of RULES) { const m = t.match(re); if (m) return f(m); }
  return bad(s);
}

/** The Turkish evidence file (kanit.js kanitDosyasi, with or without `soru`) → the English one; the question is the user's own text. */
export function toEnglish(o, key = "") {
  if (Array.isArray(o)) return o.map((x) => toEnglish(x, key));
  if (o && typeof o === "object") {
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [KEYS[k] ?? bad(k), k === "soru" || k === "kullanici_baglami" ? v : toEnglish(v, k)]));
  }
  return typeof o === "string" ? enText(o) : o;
}
