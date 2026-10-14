# -*- coding: utf-8 -*-
"""Export the ENG WP5 XAI results the site shows, for the site's own model.

The site's model is recipe.fit(0, None) — the seed-0 outer model of the XAI run — and its library is
that model's outer test.  So the run's stored per-curve explanations (ENG/xai/run.py output) are
explanations of exactly these 125 curves under exactly this model; this script checks both claims
before exporting anything.

    <eng_xai python> ENG/analysis-dashboard/tools/export_xai.py [runs dir]

Writes data/xai.json:
  shap      per-curve KernelSHAP, R2 (blank) reference — the best local method on the E3 peak test
  pfi       grouped PFI ("everyone" permutation, log-loss) of this model, per polymer — the most
            reliable global method in the 2026-10-11 results
  windows   E3 peak windows (PVDF), from literature/xai_for_engireening/_uretim/sunum/sonuc_data.py
  tests     the E3 / E4 numbers quoted on the page, read from ENG/xai/out/e3_e4_pencereler.csv.gz
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
ROOT = SITE.parents[1]
XAI_OUT = ROOT / "ENG" / "xai" / "out"
RUNS = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ENG_XAI_RUNS", Path.home() / "eng_xai_runs")) / "seed0" / "outer"
sys.path.insert(0, str(ROOT / "literature" / "xai_for_engireening" / "_uretim" / "sunum"))
from sonuc_data import WIN  # noqa: E402  -- the E3 peak windows, one definition

ANALYTES = ["AA", "5HT", "2E", "Mela"]
UNITS = {"20mV": 40, "40mV": 20}


def rounded(a, k=4):
    return np.round(np.asarray(a, dtype=float), k).tolist()


def main() -> None:
    library = json.loads((SITE / "data" / "library.json").read_text(encoding="utf-8"))
    model = np.load(RUNS / "model.npz", allow_pickle=True)
    ids = [s["id"] for s in library["samples"]]
    if list(model["row_id"]) != ids:
        raise AssertionError("XAI run rows are not the site library, in the same order")
    ref = np.array([s["ref"] for s in library["samples"]])
    diff = np.abs(model["base"] - ref).max()
    if diff > 1e-9:
        raise AssertionError(f"XAI run model differs from the site model: max |Δp| {diff:.2e}")

    shap = {}
    for unit, n in UNITS.items():
        z = np.load(RUNS / f"shap_{unit}_R2.npz")
        assert z["logit"].shape == (len(ids), n, 4)
        shap[unit] = {"logit": rounded(z["logit"]), "probability": rounded(z["probability"], 5),
                      "base_logit": rounded(z["base_logit"]), "base_probability": rounded(z["base_probability"], 5)}

    g = pd.read_csv(XAI_OUT / "kuresel_onem.csv.gz")
    g = g[(g["yöntem"] == "PFI") & (g["tür"] == "herkesle") & (g["ölçü"] == "log_loss") & (g.tohum == 0)
          & (g.model == "outer") & (g.grup == "hepsi")]
    pfi = {}
    for unit, n in UNITS.items():
        pfi[unit] = {}
        for pol in ("P4VP", "PVDF"):
            pfi[unit][pol] = {}
            for an in ANALYTES:
                d = g[(g.birim == unit) & (g.polimer == pol) & (g.analit == an)].sort_values("birim_no")
                assert len(d) == n, (unit, pol, an, len(d))
                pfi[unit][pol][an] = {"importance": rounded(d["önem"], 6), "spread": rounded(d["yayılım"], 6),
                                      "blocks": int(d.blok.iloc[0])}

    w = pd.read_csv(XAI_OUT / "e3_e4_pencereler.csv.gz")
    w = w[~w.ayar.astype(str).str.contains("balanced")]
    w["set"] = w.ayar.astype(str).str.split(" · ").str[0]

    def e3(method, setting, unit, scale, group):
        d = w[(w["sınav"] == "E3") & (w.okuma == "kendi penceresi") & (w.polimer == "PVDF") & (w.pencere == "FWHM")
              & (w["yöntem"] == method) & (w.set == setting) & (w.birim == unit) & (w["ölçek"] == scale) & (w.grup == group)]
        hit = d["rastgeleye_göre_yüzdelik"] >= 0.95
        return {"hit": round(float(hit.mean()), 2), "percentile": round(float(d["rastgeleye_göre_yüzdelik"].mean()), 2),
                "by_analyte": {an: round(float(hit[d.analit == an].mean()), 2) for an in ANALYTES}, "n": int(len(d))}

    def edge(method, setting, unit, scale):
        d = w[(w.okuma == "kenar payı") & (w.grup == "hepsi") & (w["yöntem"] == method) & (w.set == setting)
              & (w.birim == unit) & (w["ölçek"] == scale)]
        return {p: round(float(d[d.polimer == p]["pay"].mean()), 2) for p in ("P4VP", "PVDF")}

    tests = {
        "shap_r2": {u: {"e3": e3("SHAP", "R2", u, "logit", "DP"), "edge": edge("SHAP", "R2", u, "logit")} for u in UNITS},
        "pfi": {u: {"e3": e3("PFI", "herkesle", u, "-", "hepsi"), "edge": edge("PFI", "herkesle", u, "-")} for u in UNITS},
        "occlusion": {f"{u} {R}": {"e3": e3("örtme", R, u, "logit", "DP"), "edge": edge("örtme", R, u, "logit")}
                      for u in UNITS for R in ("R0", "R1", "R3")},
    }

    out = {"schema": 1, "seed": 0, "model": "outer",
           "source": "ENG WP5 XAI run (ENG/xai/run.py, 2026-10-10/11): seed-0 outer model = the site model",
           "shap": shap, "pfi": pfi,
           "windows": {"PVDF": {an: {"center": WIN[an][0], "lo": WIN[an][1], "hi": WIN[an][2]} for an in ANALYTES}},
           "tests": tests}
    (SITE / "data" / "xai.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("model match: max |dp|", f"{diff:.1e}", "| rows", len(ids))
    print(json.dumps(tests)[:1500])


if __name__ == "__main__":
    main()
