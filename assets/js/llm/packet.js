// Explanation packet → LLM message. Port of literature/xai_llm_rag/prototip/build_packet.py (v0.2) and
// assemble_prompt.py; tools/llm_parity.mjs checks the facts against Python for all 125 library curves.
// Facts are Turkish because the system prompt, the cards and the verifier are (the tested pipeline).

const NEAR = 0.30;          // |p − threshold| ≤ 0.30 → "eşiğe yakın" (assistant confidence rule)
const STRONG_LOGIT = 1.0;   // a window with ≥ 1 log-odds is "belirgin"
const TOP = 3;
const EDGE_POINTS = 10;     // rbio1.3 L6: 30 of 228 coefficients depend almost only on the first/last 10 points
const DROP = ["id", "block"]; // sample fields not sent: both come from the file name, which carries the true concentrations

const EPS = 1e-15;
const logit = (p) => { const q = Math.min(Math.max(p, EPS), 1 - EPS); return Math.log(q / (1 - q)); };
/** Python's format(x, f".{d}f") / round(x, d): like toFixed, but an exact binary tie rounds half to even. */
export function pyFixed(x, d) {
  const s = Math.abs(x).toFixed(Math.min(100, d + 30));
  const [ip, fp = ""] = s.split(".");
  if (!/^50*$/.test(fp.slice(d))) return x.toFixed(d);
  let digits = ip + fp.slice(0, d);
  if (+digits[digits.length - 1] % 2 === 1) digits = (BigInt(digits) + 1n).toString().padStart(digits.length, "0");
  const out = d ? `${digits.slice(0, -d) || "0"}.${digits.slice(-d)}` : digits;
  return (x < 0 && /[1-9]/.test(out) ? "-" : "") + out;
}
const round = (v, d) => Number(pyFixed(v, d));

/** Window i of `width` points → [lo, hi] V, as the analyzer's range(). */
function windowRange(grid, i, width) {
  const e0 = grid.start + grid.step * (i * width);
  const e1 = grid.start + grid.step * (i * width + width - 1);
  return [round(e0 - grid.step / 2, 3), round(e1 + grid.step / 2, 3)];
}

/**
 * Build the packet for the current analysis.
 * src: { kind: "shap" | "occlusion", rows: [window][analyte] contribution in log-odds (positive → VAR), base?: [analyte],
 *        fill?: "R1" | "R3" | "R0", unit: "20mV" | "40mV", width: points per window }
 */
export function buildPacket({ sample, probs, analytes, thresholds, grid, acquisition, xai, src }) {
  const facts = [];
  const fact = (text, values) => { const id = `F${String(facts.length + 1).padStart(2, "0")}`; facts.push({ id, text, values }); return id; };
  const polymer = sample.polymer ?? null;
  const peakWindows = polymer ? xai?.windows?.[polymer] ?? null : null;
  const library = sample.source === "library";

  // --- context and applicability ---
  if (acquisition) {
    const a = acquisition;
    fact(`Ölçüm kare dalga voltametrisi (SWV): ${pyFixed(a.init_E, 3)}–${pyFixed(a.final_E, 3)} V, ${pyFixed((a.incr_E * 1000), 0)} mV adım, `
      + `${pyFixed((a.amplitude * 1000), 0)} mV genlik, ${a.frequency} Hz.`,
      { E_start: a.init_E, E_end: a.final_E, step_mV: a.incr_E * 1000, amplitude_mV: a.amplitude * 1000, frequency_Hz: a.frequency });
  } else {
    fact(`Eğri kullanıcı tarafından yüklendi; model ızgarasına (${pyFixed(grid.start, 3)}–${pyFixed(grid.start + grid.step * (grid.n - 1), 3)} V, `
      + `${pyFixed((grid.step * 1000), 0)} mV adım, ${grid.n} nokta) yeniden örneklendi. Ölçüm parametreleri pakette yok.`,
      { E_start: grid.start, E_end: +(grid.start + grid.step * (grid.n - 1)).toFixed(3), step_mV: grid.step * 1000, points: grid.n });
  }
  if (library) {
    fact(`Elektrot kaplaması ${polymer}; çip ${sample.chip}. Model yalnız ACS-ML-Biomarker çiplerinde `
      + `(P4VP veya PVDF, CHI760F) eğitildi; bu eğri o dağılımdan gelen bir held-out örnektir.`,
      { polymer, chip: sample.chip, in_domain: true });
  } else {
    fact(`Eğrinin kaplaması ve çipi bilinmiyor. Model yalnız ACS-ML-Biomarker çiplerinde (P4VP veya PVDF, CHI760F) eğitildi; `
      + `bu eğrinin o koşullarda alınıp alınmadığı bilinmiyor ve başka koşullarda olasılıklar kalibre değildir.`,
      { polymer: null, in_domain: null });
  }

  // --- decision ---
  const detection = analytes.map((a, k) => {
    const p = probs[k], det = p >= thresholds[k], near = Math.abs(p - thresholds[k]) <= NEAR;
    const verdict = det ? "VAR olarak işaretlendi" : "YOK olarak işaretlendi";
    const band = near ? "eşiğe yakın, temkinli okunmalı" : "eşikten uzak";
    fact(`${a.name}: model ${verdict}; olasılık ${pyFixed(p, 3)}, eşik ${pyFixed(thresholds[k], 2)} (${band}).`,
      { analyte: a.id, probability: round(p, 3), threshold: round(thresholds[k], 2), detected: det, near_threshold: near });
    return { analyte: a.id, name: a.name, probability: p, threshold: thresholds[k], detected: det, logit: logit(p), near_threshold: near };
  });

  // --- local evidence ---
  const shap = src.kind === "shap";
  const unitLabel = src.unit.replace("mV", " mV");
  analytes.forEach((a, k) => {
    const contrib = src.rows.map((row, i) => [i, row[k]]);
    const sup = contrib.filter((c) => c[1] > 0).sort((x, y) => y[1] - x[1]).slice(0, TOP);
    const opp = contrib.filter((c) => c[1] < 0).sort((x, y) => x[1] - y[1]).slice(0, TOP);
    const pw = peakWindows?.[a.id] ?? null;
    const n = Math.floor(grid.n / src.rows.length);
    const win = (i, v) => {
      const [lo, hi] = windowRange(grid, i, src.width);
      const centre = (lo + hi) / 2;
      const inside = pw == null ? null : pw.lo <= centre && centre <= pw.hi;
      const edge = i * n < EDGE_POINTS || (i + 1) * n > grid.n - EDGE_POINTS;
      return { window: i, E_lo_V: lo, E_hi_V: hi, contribution_logit: round(v, 2), in_peak_window: inside, edge_window: edge };
    };
    const where = (w) => {
      const pos = w.in_peak_window ? "tepe penceresinin İÇİNDE"
        : w.in_peak_window === false ? "tepe penceresinin DIŞINDA"
          : polymer ? "bu kaplamada tepe penceresi tanımlı değil" : "kaplama bilinmediği için tepe penceresi tanımlı değil";
      if (w.edge_window) return `${pos}; eğrinin UCUNDA — sınamalarda bu modelin uç katsayılara kayma eğilimi ölçüldü, kimyasal bir tepe olarak okunmamalı`;
      return pos;
    };
    const how = (w, sign) => shap
      ? (sign > 0 ? `aynı çip/gün/elektrodun blank ölçümüne göre +${pyFixed(w.contribution_logit, 1)} log-odds` : `${pyFixed(w.contribution_logit, 1)} log-odds`)
      : (sign > 0 ? `örtme: dilim doldurulunca log-odds ${pyFixed(w.contribution_logit, 1)} düşüyor` : `örtme: dilim doldurulunca log-odds ${pyFixed(Math.abs(w.contribution_logit), 1)} artıyor`);
    const vals = (w) => ({ analyte: a.id, E_lo_V: w.E_lo_V, E_hi_V: w.E_hi_V, contribution_logit: w.contribution_logit,
      in_peak_window: w.in_peak_window, edge_window: w.edge_window });
    const d = detection[k];
    if (sup.length && sup[0][1] >= STRONG_LOGIT) {
      const w = win(...sup[0]);
      fact(`${a.name}: kararı en çok VAR yönüne iten bölge ${pyFixed(w.E_lo_V, 2)}–${pyFixed(w.E_hi_V, 2)} V (${how(w, 1)}; ${where(w)}).`, vals(w));
    } else if (d.detected) {
      fact(`${a.name} için tek bir ${unitLabel} bölge +${pyFixed(STRONG_LOGIT, 0)} log-odds'tan fazla katkı vermiyor; karar eğrinin geneline yayılmış.`,
        { analyte: a.id, strong_logit: STRONG_LOGIT });
    }
    if (opp.length && opp[0][1] <= -STRONG_LOGIT) {
      const w = win(...opp[0]);
      fact(`${a.name}: kararı en çok YOK yönüne iten bölge ${pyFixed(w.E_lo_V, 2)}–${pyFixed(w.E_hi_V, 2)} V (${how(w, -1)}; ${where(w)}).`, vals(w));
    }
  });

  // --- domain reference ---
  if (peakWindows) {
    const txt = analytes.map((a) => `${a.name} ${pyFixed(peakWindows[a.id].center, 3)} V`).join(", ");
    fact(`Bu veride ${polymer} üzerinde tek-analit tepe merkezleri: ${txt} (blank çıkarılmış ortalama tek-analit eğrilerinden ölçüldü).`,
      Object.fromEntries(analytes.map((a) => [`peak_${a.id}_V`, peakWindows[a.id].center])));
  } else if (polymer) {
    fact(`${polymer} kaplamasında dört analitin tepeleri 0.13–0.22 V aralığına sıkışıyor; tepe penceresi tanımlı değil, bölge–analit eşlemesi yapılamaz.`,
      { overlap_lo_V: 0.13, overlap_hi_V: 0.22 });
  } else {
    fact(`Kaplama bilinmediği için tepe penceresi tanımlı değil; bölge–analit eşlemesi yapılamaz. PVDF'te tek-analit tepeleri ayrık, `
      + `P4VP'de dördü 0.13–0.22 V aralığına sıkışıyor.`, { overlap_lo_V: 0.13, overlap_hi_V: 0.22 });
  }

  // --- method reliability (model level, not per curve) ---
  const t = shap ? xai.tests.shap_r2[src.unit] : xai.tests.occlusion[`${src.unit} ${src.fill}`];
  const hits = Object.values(t.e3.by_analyte).filter((v) => v >= 0.5).length;
  const suffix = { 0: "'ında", 1: "'inde", 2: "'sinde", 3: "'ünde", 4: "'ünde" }[hits];
  const method = shap ? "KernelSHAP, blank referans" : `örtme, ${src.fill} doldurma`;
  fact(`Yöntem güvenilirliği (model düzeyi): bu açıklama yöntemi (${method}) PVDF'te dört analitin ${hits}${suffix} en önemli bölgeyi `
    + `bilinen tepe penceresine koydu; ${unitLabel} pencerelerde sınandı. Bölge haritası kesin bir kimyasal atama değil, modelin nereye baktığının tahminidir.`,
    { method: shap ? "KernelSHAP_R2" : `occlusion_${src.fill}`, e3_hits: hits, e3_of: 4 });
  fact("Açıklama modelin davranışını tarif eder; analitin gerçekten var olduğunu kanıtlamaz. Bu model derişim vermez, yalnız var/yok kararı verir.",
    { scope: "detection_only" });

  const base = library ? { chip: sample.chip, date: sample.date, polymer, channel: sample.channel } : { polymer: null };
  const retrieve = ["swv_temelleri", ...(polymer ? ["analit_tepeleri_" + polymer.toLowerCase()] : []), "olasilik_ve_esik",
    ...(shap ? ["shap_kimyager_icin"] : []), "blank_referans", "xai_sinama_sonuclari", "model_karti", "sinirlar_ve_sorumluluk"];
  return {
    packet_version: "0.2",
    sample: { id: sample.id ?? null, ...base, block: sample.block ?? null, origin: library ? "library" : "upload", label_available: library },
    values: { detection },
    facts,
    retrieve,
    method: { kind: src.kind, fill: src.fill ?? null, unit: src.unit },
  };
}

const REPORT = "Bu ölçüm için kimyagere yönelik raporu yaz.";
const ANSWER = "Bu soruyu kural 1–6 ve 8'e uyarak, Türkçe ve 2–6 cümleyle cevapla; kural 7'deki rapor yapısı gerekmez. "
  + "Her cümlenin sonunda dayandığı olgu kimliği olsun. Paket bunu söylemiyorsa \"pakette bu bilgi yok\" de.";

/** Packet + cards → the user message (assemble_prompt.py; sample.id/block are not sent). */
export function assemblePrompt(packet, cards, instruction = REPORT) {
  const sample = Object.fromEntries(Object.entries(packet.sample).filter(([k]) => !DROP.includes(k)));
  const sent = { sample, facts: packet.facts, detection: packet.values.detection };
  const blocks = packet.retrieve.filter((k) => cards[k]).map((k) => `<kart anahtar="${k}">\n${cards[k]}\n</kart>`);
  return `<paket>\n${JSON.stringify(sent, null, 1)}\n</paket>\n<bilgi>\n${blocks.join("\n")}\n</bilgi>\n${instruction}`;
}

/** What one turn asks for: the report (question null) or an answer to the question. */
const ask = (question) => (question == null ? REPORT : `Soru: ${question}\n${ANSWER}`);

/**
 * The conversation sent to Gemini: the packet and cards go once, in the first user turn; `turns` are the finished
 * exchanges [{ q: null | string, a: string }] (q null = the report), `question` the new one (null = write the report).
 * With no earlier turns and no question this is exactly the tested single-turn report prompt.
 */
export function buildContents(packet, cards, turns, question) {
  const contents = [];
  turns.forEach((t, i) => {
    contents.push({ role: "user", parts: [{ text: i === 0 ? assemblePrompt(packet, cards, ask(t.q)) : ask(t.q) }] });
    contents.push({ role: "model", parts: [{ text: t.a }] });
  });
  contents.push({ role: "user", parts: [{ text: turns.length ? ask(question) : assemblePrompt(packet, cards, ask(question)) }] });
  return contents;
}
