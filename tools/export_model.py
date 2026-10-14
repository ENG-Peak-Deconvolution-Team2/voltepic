# -*- coding: utf-8 -*-
"""Export the detection model and the held-out sample library for the browser.

Run from the research workspace with the ENG XAI environment (it needs the campaign code):

    <eng_xai python> ENG/analysis-dashboard/tools/export_model.py

The model is the ENG XAI recipe (ENG/xai/recipe.py): paper1's final detection candidate,
refitted through the campaign code on seed 0's outer-train partition.  The library is the
same seed's outer-test partition (125 curves the model never saw).

Writes
  data/model.json          trees, wavelet filters, imputer/scaler, thresholds, R1 references
  data/library.json        125 held-out curves + metadata + mean blank + reference scores
  tools/fixtures/parity.json   per-stage Python outputs for tools/parity.mjs
"""
from __future__ import annotations

import datetime as dt
import json
import platform
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
sys.path.insert(0, str(SITE.parent / "xai"))

import lightgbm  # noqa: E402
import pywt  # noqa: E402
import sklearn  # noqa: E402

import parts  # noqa: E402
import recipe  # noqa: E402

warnings.filterwarnings("ignore", message="Level value of 6 is too high")

SEED = 0
NAMES = {"AA": "Ascorbic acid", "5HT": "Serotonin", "2E": "Estradiol", "Mela": "Melatonin"}


def flat_tree(node: dict, out: dict) -> int:
    """Depth-first flattening; returns the node index (internal >= 0, leaf = ~leaf_index)."""
    if "leaf_value" in node:
        out["v"].append(float(node["leaf_value"]))
        return ~(len(out["v"]) - 1)
    k = len(out["f"])
    for key in "ftlrdm":
        out[key].append(None)
    if node["decision_type"] != "<=":
        raise ValueError(f"unsupported decision type {node['decision_type']}")
    out["f"][k] = int(node["split_feature"])
    out["t"][k] = float(node["threshold"])
    out["d"][k] = 1 if node["default_left"] else 0
    out["m"][k] = {"None": 0, "Zero": 1, "NaN": 2}[node["missing_type"]]
    out["l"][k] = flat_tree(node["left_child"], out)
    out["r"][k] = flat_tree(node["right_child"], out)
    return k


def export_head(sub) -> dict:
    dump = sub.booster_.dump_model()
    if dump["objective"].split()[0] != "binary":
        raise ValueError(dump["objective"])
    sigmoid = float(dump["objective"].split("sigmoid:")[1]) if "sigmoid:" in dump["objective"] else 1.0
    trees = []
    for info in dump["tree_info"]:
        out = {key: [] for key in "ftlrdmv"}
        root = flat_tree(info["tree_structure"], out)
        if root != 0 and out["f"]:
            raise ValueError("root is not node 0")
        if not out["f"]:                       # a single-leaf tree
            out = {"v": out["v"]}
        elif not any(out["m"]):                # every split is missing_type None: drop d/m
            out.pop("d"), out.pop("m")
        trees.append(out)
    return {"sigmoid": sigmoid, "trees": trees,
            "gain": [float(g) for g in sub.booster_.feature_importance(importance_type="gain")]}


def filters(name: str) -> dict:
    w = pywt.Wavelet(name)
    return {"dec_lo": list(w.dec_lo), "dec_hi": list(w.dec_hi), "rec_lo": list(w.rec_lo), "rec_hi": list(w.rec_hi)}


def main() -> None:
    fitted = recipe.fit(SEED, None)
    pipe = fitted.estimator
    imputer, scaler, model = pipe.named_steps["imputer"], pipe.named_steps["x_scaler"], pipe.named_steps["model"]
    assert [name for name, _ in pipe.steps] == ["imputer", "x_scaler", "model"], pipe.steps

    test = fitted.evaluation
    X = np.asarray(test["X"], dtype=float)
    denoised = recipe._denoise_batch(X)
    features = recipe.features_raw(X)
    scores = recipe.score_raw(fitted, X)
    if not np.allclose(scores, fitted.evaluation_scores, rtol=0, atol=1e-12):
        raise AssertionError("score_raw disagrees with the campaign's design path")

    # band layout of the 228 features, in the framework's order [cA6, cD6, ..., cD1]
    coeffs = pywt.wavedec(denoised[0], "rbio1.3", mode="symmetric", level=6)
    bands = [{"name": "cA6" if i == 0 else f"cD{7 - i}", "length": int(len(c))} for i, c in enumerate(coeffs)]
    assert sum(b["length"] for b in bands) == features.shape[1] == 228

    train = fitted.train
    train_meta = parts.meta(SEED, "outer_train")
    r1 = parts.r1(np.asarray(train["X"], dtype=float), train_meta)

    heads = [export_head(sub) for sub in model.estimators_]
    for sub in model.estimators_:
        assert list(sub.classes_) == [0, 1]

    model_json = {
        "schema": 1,
        "created": dt.date.today().isoformat(),
        "name": "LightGBM detection · DWT rbio1.3 L6",
        "recipe": {**recipe.CANDIDATE, "model": recipe.MODEL, "seed": SEED, "partition": "outer_train",
                   "target_mode": recipe.TARGET_MODE["id"], "n_train_real": int(len(train["X"]))},
        "analytes": [{"id": a, "name": NAMES[a]} for a in recipe.ANALYTES],
        "grid": {"start": 0.004, "step": 0.004, "n": 200, "unit_E": "V", "unit_I": "uA"},
        "wavelets": {"sym4": filters("sym4"), "rbio1.3": filters("rbio1.3")},
        "denoise": {"wavelet": "sym4", "level": 3, "mode": "symmetric", "rule": "soft, universal threshold, MAD of cD1"},
        "features": {"wavelet": "rbio1.3", "level": 6, "mode": "symmetric", "bands": bands},
        "imputer": [float(v) for v in imputer.statistics_],
        "scaler": {"mean": [float(v) for v in scaler.mean_], "scale": [float(v) for v in scaler.scale_]},
        "thresholds": [float(v) for v in fitted.thresholds],
        "threshold_rule": "MaxSSS (Youden) cut on the real training rows",
        "r1": {k: [float(v) for v in curve] for k, curve in r1.items()},
        "heads": heads,
        "versions": {"python": platform.python_version(), "lightgbm": lightgbm.__version__,
                     "pywavelets": pywt.__version__, "scikit-learn": sklearn.__version__},
    }

    meta = parts.meta(SEED, "outer_test")
    full = pd.read_csv(recipe.SPLIT / f"seed{SEED}" / "outer_test.csv", dtype={"row_id": str, "date": str, "chip": str})
    assert (full["row_id"].to_numpy() == np.asarray(test["row_id"])).all()
    assert (meta["row_id"].to_numpy() == full["row_id"].to_numpy()).all()
    blanks = pd.read_csv(recipe.SPLIT / "blank.csv").set_index("row_id")["blank"]

    samples = []
    for i, row in full.iterrows():
        raw_i = [float(v) for v in row["I_raw_uA"].split(";")]
        assert np.array_equal(np.asarray(raw_i), X[i]), row["row_id"]
        blank = blanks.get(row["row_id"])
        samples.append({
            "id": row["row_id"],
            "file": Path(row["row_id"]).name,
            "chip": row["chip"], "date": row["date"], "polymer": row["polymer"],
            "folder": row["subfolder"], "channel": int(row["channel_slot"]),
            "block": row["block_id"], "blank_count": int(row["blank_count_available"]),
            "labels_nM": [float(row[f"label_nM_{a}"]) for a in recipe.ANALYTES],
            "I": raw_i,
            "blank": None if not isinstance(blank, str) else [float(v) for v in blank.split(";")],
            "ref": [float(v) for v in scores[i]],
        })
    library_json = {"schema": 1, "seed": SEED, "partition": "outer_test",
                    "source": "ML-Biomarker-Sensing (ACS Electrochem. 2 (2026) 1444-1452), MIT licence",
                    "acquisition": {"technique": "Square-wave voltammetry", "instrument": "CHI760F",
                                    "init_E": 0.0, "final_E": 0.8, "incr_E": 0.004, "amplitude": 0.025,
                                    "frequency": 5, "quiet_time": 60},
                    "samples": samples}

    fixtures = {"denoised": denoised.tolist(), "features": features.tolist(), "scores": scores.tolist(),
                "raw_margin": [[float(v) for v in sub.booster_.predict(pipe[:-1].transform(features), raw_score=True)]
                               for sub in model.estimators_]}

    (SITE / "data").mkdir(exist_ok=True)
    (HERE / "fixtures").mkdir(exist_ok=True)
    (SITE / "data" / "model.json").write_text(json.dumps(model_json, separators=(",", ":")), encoding="utf-8")
    (SITE / "data" / "library.json").write_text(json.dumps(library_json, separators=(",", ":")), encoding="utf-8")
    (HERE / "fixtures" / "parity.json").write_text(json.dumps(fixtures, separators=(",", ":")), encoding="utf-8")
    hits = (scores >= fitted.thresholds).astype(int) == (np.asarray(test["y"]) > 0)
    print("thresholds", fitted.thresholds, "held-out accuracy per analyte", hits.mean(axis=0).round(4))
    print("trees per head", [len(h["trees"]) for h in heads], "samples", len(samples),
          "blank missing", sum(s["blank"] is None for s in samples))


if __name__ == "__main__":
    main()
