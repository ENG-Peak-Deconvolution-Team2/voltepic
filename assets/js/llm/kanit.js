// Chemist report: basis label (dayanak) per decision and the evidence file (kanıt dosyası) the LLM reads.
// Port of literature/xai_llm_rag/kimyager_raporu/rapor.py (degerlendir, kanit_dosyasi, cip_notu) and of the schema it
// uses, literature/xai_llm_rag/rapor/build_tasarim.py (kanit). tools/kimyager_parity.mjs checks the JSON text against
// Python for all 125 library curves. Texts are Turkish: the LLM prompts and the code check are.

const IDS = ["AA", "5HT", "2E", "Mela"];
const AD = { AA: "Askorbik asit", "5HT": "Serotonin", "2E": "Estradiol", Mela: "Melatonin" };
const KISA = { AA: "AA", "5HT": "5-HT", "2E": "2E", Mela: "Mela" };
const EDGE = new Set([0, 1, 38, 39]);   // first/last 10 points: E4 edge artefact
const NEAR = 0.30;                      // |score − threshold| ≤ 0.30 → borderline
const PFI_TOP = 3;
const P4VP_NOTE = "Bu kaplamada dört maddenin tepeleri 0,13–0,22 V arasına sıkışıyor; bakılan yerden madde ayırt edilemez.";
const EDGE_NOTE = "Ölçümün ilk ve son 0,04 V'u (yer etiketinde 'eğrinin UCU') kanıt sayılmaz: testlerde model bu kenarlara "
  + "kimyayla ilgisiz ağırlık verdi.";
export const VERSION = "kimyager_raporu 2026-10-21 (şema: build_tasarim, taslak 2026-10-20)";

/** Python's f"{x:.{d}f}": toFixed, but an exact binary tie rounds half to even. */
export function pyFixed(x, d) {
  const s = Math.abs(x).toFixed(Math.min(100, d + 30));
  const [ip, fp = ""] = s.split(".");
  if (!/^50*$/.test(fp.slice(d))) return x.toFixed(d);
  let digits = ip + fp.slice(0, d);
  if (+digits[digits.length - 1] % 2 === 1) digits = (BigInt(digits) + 1n).toString().padStart(digits.length, "0");
  const out = d ? `${digits.slice(0, -d) || "0"}.${digits.slice(-d)}` : digits;
  return (x < 0 && /[1-9]/.test(out) ? "-" : "") + out;
}
const pyRound = (x, d) => Number(pyFixed(x, d));
const v2 = (x) => pyFixed(x, 2).replace(".", ",");                                        // rapor.v
const vt = (x, d = 2) => pyFixed(x, d).replace(".", ",").replace("-", "−");                // build_tasarim.v
const dilim = (k) => `${v2(0.02 * k)}–${v2(0.02 * (k + 1))} V`;
const dilimT = (u) => `${vt(0.02 * u)}–${vt(0.02 * u + 0.02)} V`;

/** json.dumps(obj, ensure_ascii=False, indent=1): every number in the evidence file is a Python float. */
export function pyJson(o, ind = 1, lvl = 0) {
  const pad = (n) => " ".repeat(ind * n);
  if (o === null || o === undefined) return "null";
  if (typeof o === "number") return Object.is(o, -0) ? "-0.0" : Number.isInteger(o) ? `${o}.0` : String(o);
  if (typeof o === "boolean") return o ? "true" : "false";
  if (typeof o === "string") return JSON.stringify(o);
  if (Array.isArray(o)) {
    if (!o.length) return "[]";
    return `[\n${o.map((x) => pad(lvl + 1) + pyJson(x, ind, lvl + 1)).join(",\n")}\n${pad(lvl)}]`;
  }
  const keys = Object.keys(o);
  if (!keys.length) return "{}";
  return `{\n${keys.map((k) => `${pad(lvl + 1)}${JSON.stringify(k)}: ${pyJson(o[k], ind, lvl + 1)}`).join(",\n")}\n${pad(lvl)}}`;
}

const argsort = (a, dir) => a.map((x, i) => [x, i]).sort((p, q) => (dir > 0 ? q[0] - p[0] : p[0] - q[0]) || p[1] - q[1]).map((p) => p[1]);
const col = (rows, k) => rows.map((r) => r[k]);

/** Chip named in a file name, e.g. "…_MC325_…" → "MC325". */
export const chipOf = (name) => (String(name ?? "").match(/MC\d+/) ?? [null])[0];

/** rapor.cip_notu: a general note when the chip was not in training or is unknown. */
export function cipNotu(chip, trainingChips) {
  if (!chip) return `Ölçümün hangi çipten geldiği bilinmiyor. Model yalnız ${trainingChips.length} çipte eğitildi; o çiplerde ölçülen `
    + "başarı başka bir elektrot için geçerli sayılamaz.";
  if (!trainingChips.includes(chip)) return `Bu çip (${chip}) modelin eğitiminde yok; eğitimdeki ${trainingChips.length} çipte ölçülen `
    + "başarı bu çip için geçerli sayılamaz.";
  return null;
}

const pfiTop = (xai, kaplama, a) => argsort(xai.pfi["20mV"][kaplama][a].importance, 1).slice(0, PFI_TOP);
const pencereSahibi = (k, windows) => {
  const centre = 0.004 * (5 * k + 2);                // same point as the evidence file's location tag (build_tasarim.konum)
  return IDS.filter((b) => windows[b] && windows[b].lo <= centre && centre <= windows[b].hi);
};

/** rapor.degerlendir: decision and basis label of one analyte. ex = { p, p_blank, shap, occ } (shap/occ: 40 × 4 logit). */
export function degerlendir(a, ex, thr, kaplama, xai) {
  const i = IDS.indexOf(a);
  const p = ex.p[i], pb = ex.p_blank[i], t = thr[i];
  const isVar = p >= t, blankVar = pb >= t;
  const windows = xai.windows[kaplama] ?? {};
  const out = { id: a, ad: AD[a], var: isVar, net: Math.abs(p - t) > NEAR, blank_var: blankVar, bolgeler: [], dayanak: "", neden: "", kontrol: [] };
  if (blankVar) {
    Object.assign(out, { dayanak: "gösterilemedi", neden: "bu karar için modelin baktığı yer gösterilemiyor",
      ayrinti: `model aynı elektrodun boş ölçümüne de 'var' dedi (${v2(pb)}), bu ölçüme '${isVar ? "var" : "yok"}'; iki açıklama da bu ölçümü `
        + "boş ölçümle karşılaştırdığı için gösterdikleri yer kararın nedeni değil, yalnız ölçümün boş ölçümden farkı. Model eğitimde "
        + "analitsiz ölçüm görmedi." });
    if (isVar) out.kontrol.push(`${AD[a]}: dayanak gösterilemediği için standart ekleme ile teyit edilebilir.`);
    return out;
  }
  if (!isVar) { Object.assign(out, { dayanak: "yerinde", neden: "eğri bu madde açısından boş ölçümden ayrılmıyor" }); return out; }
  for (const [yontem, key] of [["yöntem 1", "shap"], ["yöntem 2", "occ"]]) {
    const c = col(ex[key], i);
    const k = argsort(c, 1)[0];
    if (c[k] <= 0) continue;
    const owners = pencereSahibi(k, windows);
    out.bolgeler.push({ yontem, k, aralik: dilim(k), kenar: EDGE.has(k), kendi: owners.includes(a), baska: owners.filter((b) => b !== a),
      genel: pfiTop(xai, kaplama, a).some((j) => Math.abs(k - j) <= 1) });
  }
  const kanit = out.bolgeler.filter((b) => !b.kenar);
  const ayni = out.bolgeler.length === 2 && Math.abs(out.bolgeler[0].k - out.bolgeler[1].k) <= 1;
  if (!kanit.length) {
    Object.assign(out, { dayanak: "zayıf", neden: "modelin baktığı yer yalnız ölçümün kenarı" });
    out.kontrol.push(`${AD[a]}: ölçümü tekrarlayın; karar kenardaki akıma dayanıyor.`);
  } else if (kaplama !== "PVDF") {
    const both = ayni && kanit.length === 2;
    Object.assign(out, { dayanak: both ? "orta" : "zayıf",
      neden: both ? "iki yöntem aynı yeri gösteriyor, ama bu kaplamada tepeler üst üste" : "iki yöntem farklı yerleri gösteriyor; bu kaplamada tepeler üst üste" });
  } else if (kanit.every((b) => b.kendi) && ayni && kanit.length === 2) {
    Object.assign(out, { dayanak: "güçlü", neden: "iki yöntem aynı yeri gösteriyor ve bu yer maddenin beklenen tepe aralığında" });
  } else if (kanit.some((b) => b.baska.length && !b.kendi)) {
    const diger = [...new Set(kanit.flatMap((b) => b.baska.map((o) => AD[o].toLowerCase())))].sort();
    Object.assign(out, { dayanak: "şüpheli", neden: `modelin baktığı yer ${diger.join(", ")} için beklenen aralıkta` });
    out.kontrol.push(`${AD[a]}: ${diger.join(", ")} içermeyen bir numuneyle ya da standart ekleme ile doğrulayın; iki maddenin sinyali karışıyor olabilir.`);
  } else if (kanit.some((b) => b.kendi)) {
    Object.assign(out, { dayanak: "orta", neden: ayni ? "iki yöntem aynı yeri gösteriyor; yer beklenen aralığın kıyısında"
      : "maddenin beklenen aralığı gösteriliyor, ama iki yöntem aynı yerde birleşmiyor" });
  } else {
    Object.assign(out, { dayanak: "zayıf", neden: "modelin baktığı yer bilinen bir tepe aralığında değil" });
    out.kontrol.push(`${AD[a]}: standart ekleme ile doğrulayın.`);
  }
  if (isVar && !out.net) out.kontrol.unshift(`${AD[a]}: karar sınırda; ölçümü tekrarlayın.`);
  return out;
}

// ── evidence file (build_tasarim.kanit) ─────────────────────────────────────────────────────────────────────────────

function konum(u, a, polymer, W) {
  let yer;
  if (polymer !== "PVDF") yer = "pencere tanımlı değil (P4VP)";
  else {
    const e = 0.004 * (5 * u + 2);
    const icinde = IDS.filter((b) => W[b].lo <= e && e <= W[b].hi);
    yer = icinde.includes(a) ? "kendi tepe penceresi" : icinde.length ? icinde.map((b) => `${AD[b]} penceresi`).join(" / ")
      : "hiçbir analitin penceresinde değil";
  }
  return yer + (EDGE.has(u) ? " · eğrinin UCU" : "");
}

const uyum = (r) => { const x = Math.abs(r); return x < 0.10 ? "ihmal edilebilir" : x < 0.40 ? "zayıf" : x < 0.70 ? "orta" : x < 0.90 ? "güçlü" : "çok güçlü"; };

/** scipy.stats.spearmanr: Pearson correlation of average ranks. */
function spearman(x, y) {
  const rank = (a) => {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(a.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(x), ry = rank(y), n = x.length;
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxy / Math.sqrt(sxx * syy);
}

/** scipy.signal.find_peaks(x, prominence=p): local maxima (plateau midpoints), topographic prominence, ascending index. */
export function findPeaks(x, minProm) {
  const peaks = [];
  for (let i = 1; i < x.length - 1;) {
    if (x[i - 1] < x[i]) {
      let ahead = i + 1;
      while (ahead < x.length - 1 && x[ahead] === x[i]) ahead++;
      if (x[ahead] < x[i]) { peaks.push((i + ahead - 1) >> 1); i = ahead + 1; continue; }   // scipy: i = i_ahead; i += 1
    }
    i++;
  }
  return peaks.filter((p) => {
    let lmin = x[p], rmin = x[p];
    for (let i = p; i >= 0 && x[i] <= x[p]; i--) lmin = Math.min(lmin, x[i]);
    for (let i = p; i < x.length && x[i] <= x[p]; i++) rmin = Math.min(rmin, x[i]);
    return x[p] - Math.max(lmin, rmin) >= minProm;
  });
}

function gozlenenTepeler(I, blank, polymer, W) {
  const d = I.map((v, i) => v - blank[i]);
  const lo = Math.min(...d), hi = Math.max(...d);
  const pk = findPeaks(d, 0.15 * (hi - lo));
  const top = Math.max(...pk.map((i) => d[i]));
  return pk.map((i) => {
    const e = 0.004 * i;
    const icinde = IDS.filter((b) => polymer === "PVDF" && W[b].lo <= e && e <= W[b].hi).map((b) => AD[b]);
    const t = { E_V: vt(e, 3), goreli_yukseklik: `%${pyRound(100 * d[i] / top, 0)}`,
      yer: icinde.map((b) => `${b} penceresi`).join(" / ") || (polymer !== "PVDF" ? "pencere tanımlı değil" : "hiçbir pencerede değil") };
    if (polymer === "PVDF") {
      const yakin = IDS.filter((b) => !icinde.includes(AD[b]) && Math.min(Math.abs(e - W[b].hi), Math.abs(e - W[b].lo)) <= 0.02)
        .map((b) => `${AD[b]} penceresinin ${Math.abs(e - W[b].hi) < Math.abs(e - W[b].lo) ? "üst" : "alt"} sınırına `
          + `${vt(Math.min(Math.abs(e - W[b].hi), Math.abs(e - W[b].lo)), 3)} V`);
      if (yakin.length) t.yakin_pencere_siniri = yakin;
    }
    return t;
  });
}

/**
 * rapor.kanit_dosyasi (= build_tasarim.kanit + additions). ex: { p, p_blank, shap, occ }; x, blank: 200 µA on the model grid.
 * K: data/kimyager.json; xai: data/xai.json; kararlar: degerlendir() for the four analytes.
 */
export function kanitDosyasi({ ex, x, blank, kaplama, chip, nBlank, kararlar, thr, xai, K, kaynak = "yüklenen eğri" }) {
  const W = xai.windows.PVDF;
  const n = {};
  const kid = (p) => { n[p] = (n[p] ?? 0) + 1; return `${p}${String(n[p]).padStart(2, "0")}`; };
  const karar = IDS.map((a, k) => {
    const p = ex.p[k];
    return { id: kid("D"), analit: AD[a], kod: KISA[a], puan: pyRound(p, 3), esik: 0.5, karar: p >= thr[k] ? "VAR" : "YOK",
      esige_gore: Math.abs(p - thr[k]) > 0.30 ? "eşikten uzak" : "eşiğe yakın",
      blank_olcumunde_karar: `${ex.p_blank[k] >= thr[k] ? "VAR" : "YOK"} (${vt(ex.p_blank[k], 3)})` };
  });
  const liste = (m, a, yon, cnt) => {
    const idx = argsort(m, yon).slice(0, cnt).filter((u) => Math.sign(m[u]) === yon);
    return [idx.map((u) => ({ id: kid("E"), dilim: dilimT(u), katki: pyRound(m[u], 2), yer: konum(u, a, kaplama, W) })), idx];
  };
  const analitler = {};
  IDS.forEach((a, k) => {
    const S = col(ex.shap, k), O = col(ex.occ, k);
    const yon = karar[k].karar === "VAR" ? 1 : -1, ky = yon > 0 ? "VAR" : "YOK";
    const [sAyni, su] = liste(S, a, yon, 3);
    const [sKarsi, sn] = liste(S, a, -yon, 2);
    const [oAyni, ou] = liste(O, a, yon, 3);
    const [oKarsi, on] = liste(O, a, -yon, 2);
    const gPfi = argsort(xai.pfi["20mV"][kaplama][a].importance, 1).slice(0, 3);
    const gSage = argsort(K.sage[kaplama][a], 1).slice(0, 3);
    const ortak = (p, q) => [...p].filter((u) => q.includes(u)).sort((x1, x2) => x1 - x2);
    const topS = su[0] ?? null, topO = ou[0] ?? null;
    const rho = spearman(S, O);
    const karsilastirma = [
      { id: kid("C"), olgu: `iki yöntemin kararla aynı yönde (${ky}) en güçlü dilimi `
        + (topS === topO ? "aynı" : topS !== null && topO !== null && Math.abs(topS - topO) === 1 ? "komşu" : "farklı")
        + (topS !== topO ? ` (SHAP ${dilimT(topS)}, örtme ${dilimT(topO)})` : ` (${dilimT(topS)})`) },
      { id: kid("C"), olgu: "kararla aynı yönde ilk 3'te ortak dilim: " + (ortak(new Set(su), ou).map(dilimT).join(", ") || "yok") },
      { id: kid("C"), olgu: "karara karşı yönde ilk 2'de ortak dilim: " + (ortak(new Set(sn), on).map(dilimT).join(", ") || "yok") },
      { id: kid("C"), olgu: `40 dilimlik iki haritanın sıra uyumu (Spearman) ${vt(rho)} (${uyum(rho)})` },
    ];
    const tipik = [];
    for (const [ad, u] of [["SHAP'ın", topS], ["örtmenin", topO]]) {
      if (u === null) continue;
      const inP = gPfi.includes(u), inS = gSage.includes(u);
      tipik.push({ id: kid("C"), olgu: `${ad} kararla aynı yönde en güçlü dilimi (${dilimT(u)}) modelin bu analit için genelde `
        + (inP || inS ? "en çok baktığı 3 dilim arasında" : "en çok baktığı 3 dilim arasında DEĞİL")
        + ` (PFI: ${inP ? "evet" : "hayır"}, SAGE: ${inS ? "evet" : "hayır"})` });
    }
    analitler[KISA[a]] = {
      karar: karar[k].id,
      bu_egri: {
        "SHAP (referans: aynı çip/gün/elektrodun blank ölçümü)": { [`kararla_ayni_yonde_${ky}`]: sAyni, karara_karsi_yonde: sKarsi },
        "örtme (dolgu: aynı elektrodun blank ölçümü)": { [`kararla_ayni_yonde_${ky}`]: oAyni, karara_karsi_yonde: oKarsi },
      },
      iki_yontem_karsilastirmasi: karsilastirma,
      model_geneli: {
        PFI_en_onemli_3: gPfi.map((u) => ({ id: kid("G"), dilim: dilimT(u), yer: konum(u, a, kaplama, W) })),
        SAGE_en_onemli_3: gSage.map((u) => ({ id: kid("G"), dilim: dilimT(u), yer: konum(u, a, kaplama, W) })),
        bu_egri_model_geneline_gore: tipik,
      },
    };
  });
  karar.forEach((k, i) => {
    const dk = kararlar[i];
    k.degerlendirme = { dayanak: dk.dayanak, neden: dk.neden, ...(dk.ayrinti ? { ayrinti: dk.ayrinti } : {}) };
  });
  const cip = cipNotu(chip, K.training_chips);
  return {
    kanit_dosyasi_surumu: VERSION,
    olcum: { teknik: "SWV 0,00–0,80 V, 4 mV adım, 25 mV genlik, 5 Hz", kaplama, cip: chip ?? "bilinmiyor",
      kaynak: `${kaynak}; blank: ${nBlank} dosya${nBlank > 1 ? " ortalaması" : ""}` },
    okuma_notu: "Katkı işareti: + kararı VAR'a, − YOK'a iter. SHAP ve örtme katkıları farklı ölçeklerde; "
      + "iki yöntem arasında büyüklük değil sıra karşılaştırılır. Dilimler 20 mV.",
    kararlar: karar,
    analitler,
    kimya: {
      tepe_merkezleri_ve_pencereleri_V: kaplama === "PVDF"
        ? Object.fromEntries(IDS.map((a) => [KISA[a], { merkez: W[a].center, pencere: [W[a].lo, W[a].hi] }]))
        : "P4VP'de dört tepe 0,13–0,22 V'a sıkışık; pencere tanımlı değil",
      egride_gorulen_tepeler_blank_cikarilmis: gozlenenTepeler(x, blank, kaplama, W).map((t) => ({ id: kid("K"), ...t })),
    },
    yontem_guveni: { matris: K.guven, testlerin_anlami: K.test_anlam,
      kaynak: "4 yöntem × 5 test, 5 tohum × 6 model, 20 mV, PVDF (model düzeyi; bu eğriye özel değil)" },
    kullanici_baglami: null,
    kontrol_onerileri: kararlar.flatMap((d) => d.kontrol),
    genel_notlar: [...(cip ? [cip] : []), ...(kaplama !== "PVDF" ? [P4VP_NOTE] : []), EDGE_NOTE],
    soru: null,
  };
}

export { IDS, AD };
