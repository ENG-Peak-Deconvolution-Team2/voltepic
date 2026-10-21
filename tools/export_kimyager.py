# -*- coding: utf-8 -*-
"""Export the chemist report's inputs for the analyzer (literature/xai_llm_rag/kimyager_raporu/rapor.py).

For every library curve, rapor.py's own explanation against the curve's blank (R2: mean blank of the same chip, day and
electrode): KernelSHAP with 20,000 samples and occlusion, 20 mV slices, plus the model's score on that blank. The site
builds the evidence file (kanıt dosyası) from these arrays in assets/js/llm/kanit.js; uploads compute them in the browser.

    <eng_xai python> ENG/analysis-dashboard/tools/export_kimyager.py              # data/kimyager.json
    <eng_xai python> ENG/analysis-dashboard/tools/export_kimyager.py --fixture    # + tools/fixtures/kimyager_parity.json

data/kimyager_istem.json   the two system prompts (rapor, soru), from rapor.py; the Worker bundles this file
data/kimyager.json   training chips, chip → coating, SAGE (model level), the method-reliability
                     matrix, and per library curve: shap, occ (40 × 4 logit), shap_p (40 × 4 probability), p_blank (4),
                     blank (200 µA), n_blank
The fixture holds Python's evidence file and basis labels for all 125 curves (built from the exported, rounded arrays)
and rapor.denetle's findings on real and altered LLM texts, for tools/kimyager_parity.mjs.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
ROOT = SITE.parents[1]
KR = ROOT / "literature" / "xai_llm_rag" / "kimyager_raporu"
sys.path.insert(0, str(KR))
import rapor  # noqa: E402  -- also puts ENG/xai and rapor/build_tasarim on the path
import parts  # noqa: E402
from build_tasarim import GUVEN, TEST_ANLAM  # noqa: E402
from swv.acquisition.labels import DEFAULT_VOCABULARY  # noqa: E402

DIGITS = 6
LIBRARY_SOURCE = "kütüphane eğrisi (held-out)"


def run_texts() -> list[dict]:
    """Every LLM text the chemist report has produced, with its own evidence file."""
    out = []
    for f in sorted(KR.glob("ornekler/*.json")) + sorted(KR.glob("kosu_*_2026-10-21/*.json")):
        K = json.loads(f.read_text(encoding="utf-8"))
        kanit = json.dumps(K["kanit"], ensure_ascii=False, indent=1)
        out.append({"src": f"{f.parent.name}/{f.name}", "kanit": kanit, "kararlar": K["kanit"]["kararlar"], "text": K["rapor"], "n": [3, 5]})
        for s in K["soru_cevap"]:
            out.append({"src": f"{f.parent.name}/{f.name} soru", "kanit": json.dumps({**K["kanit"], "soru": s["soru"]}, ensure_ascii=False, indent=1),
                        "kararlar": K["kanit"]["kararlar"], "text": s["cevap"], "n": [1, 4]})
    return out


ALTER = [  # one failure per denetle rule, added to a real report
    lambda t: t + " SHAP bunu gösteriyor.",
    lambda t: t + " Bu E01 kaydına dayanıyor.",
    lambda t: t + " Tepe 0,999 V civarında.",
    lambda t: t + " Askorbik asidin tepesi 0,24 V'ta.",
    lambda t: t + " Bunu bilmiyorum.",
    lambda t: t + " Melatonin kararı 0,74–0,78 V'a dayanıyor.",
    lambda t: t + " Serotonin yok.",
    lambda t: t + " " + " ".join(["çok"] * 45) + ".",
    lambda t: re.split(r"(?<=[.!?])\s+", t)[0],
]


def main() -> int:
    lib = json.loads((SITE / "data" / "library.json").read_text(encoding="utf-8"))
    frame = parts.meta(0, "outer_test")
    assert list(frame["row_id"]) == [s["id"] for s in lib["samples"]], "library order differs from the split"
    R2 = parts.r2(frame)
    counts = {k: n for k, (_, n) in parts.blank_means().items()}
    m = rapor.model()
    samples, fixture = [], []
    for i, s in enumerate(lib["samples"]):
        x = np.asarray(s["I"], float)
        ex = rapor.acikla(m, x, R2[i], seed=0)
        r = {"shap": np.round(ex["shap"], DIGITS), "occ": np.round(ex["occ"], DIGITS), "p": ex["p"], "p_blank": ex["p_blank"]}
        n_blank = counts[(frame["chip"][i], frame["date"][i], int(frame["channel_slot"][i]))]
        samples.append({"shap": r["shap"].tolist(), "occ": r["occ"].tolist(), "shap_p": np.round(ex["shap_p"], DIGITS).tolist(),
                        "p_blank": np.round(ex["p_blank"], 12).tolist(),
                        "blank": np.round(R2[i], 9).tolist(), "n_blank": n_blank})
        if "--fixture" in sys.argv:
            kararlar = [rapor.degerlendir(a, r, m.thresholds, s["polymer"]) for a in rapor.ANALYTES]
            kanit = rapor.kanit_dosyasi(r, x, np.round(R2[i], 9), s["polymer"], Path(s["file"]), n_blank, kararlar, m.thresholds,
                                        kaynak=LIBRARY_SOURCE)
            fixture.append({"kanit": json.dumps(kanit, ensure_ascii=False, indent=1),
                            "kararlar": [{k: d[k] for k in ("id", "var", "net", "blank_var", "dayanak", "neden", "kontrol")}
                                         for d in kararlar]})
        print(f"\r{i + 1}/125", end="", flush=True)
    print()
    chips = sorted(p.name for p in (ROOT / "data" / "acs_biomarker" / "repo" / "raw_data").iterdir() if p.name.startswith("MC"))
    out = {
        "schema": 1, "date": date.today().isoformat(),
        "source": "literature/xai_llm_rag/kimyager_raporu/rapor.py: acikla() on the R2 blank, KernelSHAP "
                  f"{rapor.NSAMPLES} samples (seed 0) and occlusion, 20 mV; model = recipe.fit(0) = the site model",
        "library_source": LIBRARY_SOURCE,
        "training_chips": sorted(set(parts.meta(0, "outer_train")["chip"])),
        "chip_polymer": {c: DEFAULT_VOCABULARY.polymer(c) for c in chips if DEFAULT_VOCABULARY.polymer(c)},
        "sage": {p: {a: v.tolist() for a, v in d.items()} for p, d in rapor._sage().items()},
        "guven": GUVEN, "test_anlam": TEST_ANLAM,
        "samples": samples,
    }
    (SITE / "data" / "kimyager_istem.json").write_text(json.dumps({"rapor": rapor.ISTEM, "soru": rapor.ISTEM_SORU}, ensure_ascii=False, indent=1),
                                                     encoding="utf-8")
    (SITE / "data" / "kimyager.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote data/kimyager.json ({(SITE / 'data' / 'kimyager.json').stat().st_size / 1e6:.2f} MB)")
    if "--fixture" in sys.argv:
        cases = []
        for t in run_texts():
            ks = [{"ad": k["analit"], "var": k["karar"] == "VAR"} for k in t["kararlar"]]
            for j, text in enumerate([t["text"]] + [f(t["text"]) for f in ALTER]):
                cases.append({"src": t["src"], "alter": j, "text": text, "kanit": t["kanit"], "kararlar": ks, "n": t["n"],
                              "bulgu": rapor.denetle(text, t["kanit"], ks, *t["n"])})
        fx = {"curves": fixture, "denetle": cases,
              "mesaj": {"rapor": rapor.mesaj_rapor(fixture[12]["kanit"]),
                        "soru": rapor.mesaj_soru(fixture[12]["kanit"], "Rapor metni.", "Soru metni?")}}
        (HERE / "fixtures" / "kimyager_parity.json").write_text(json.dumps(fx, ensure_ascii=False), encoding="utf-8")
        print(f"wrote tools/fixtures/kimyager_parity.json ({len(fixture)} curves, {len(cases)} check cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
