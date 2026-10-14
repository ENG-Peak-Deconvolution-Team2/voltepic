# Peak Deconvolution — Analysis Dashboard

A browser app that reads a square-wave voltammogram and decides, for each of four biomarkers —
ascorbic acid (AA), serotonin (5-HT), estradiol (2E) and melatonin (Mela) — whether it is present.
The detection model runs entirely in the page; nothing is uploaded anywhere.

**Live:** https://eng-peak-deconvolution-team2.github.io/analysis-dashboard/

ENG Peak Deconvolution project · Team 2 (machine learning) · work package 6, web interface.

## What the page does

| Step | What you see |
|---|---|
| 01 Measurement | Acquisition settings (read from the CHI760F header when you upload a raw file), sample metadata, peaks found on the denoised trace, wavelet noise estimate |
| 02 Preprocess | The training pipeline recomputed for this curve: sym4 wavelet denoising → rbio1.3 DWT (228 coefficients) → standardisation, with the removed noise and the coefficient profile |
| 03 Detect | Four independent present/absent decisions with probability, threshold and log-odds margin; where the curve sits among the 125 held-out curves |
| 04 Explain | Built from the ENG WP5 XAI run, choosing what landed on the peaks in its tests: the graph shades where the model looks (grouped PFI of this exact model, the most reliable method in the 2026-10-11 results) next to the E3 peak window; per-curve KernelSHAP with the blank reference (R2), the best local method on the E3 peak test; live occlusion (R1 / R0 / R3) for uploaded curves; wavelet-band gain |

The **analysis assistant** is a placeholder: its answers are composed by rules from the current
analysis. `assets/js/assistant.js` → `respond()` is where a language-model call will go.

## Inputs

- **Library:** 125 held-out curves of the ACS-ML-Biomarker data set (seed 0 outer test), with labels.
- **Upload:** a CSV/TSV with potential and current columns (units read from the header: V or mV;
  A, mA, µA or nA), a single column of 200 currents on the model grid, or a raw CHI760F `.txt`
  export (both working electrodes are offered when present). Curves are linearly resampled to the
  model grid: 200 points, 0.004–0.800 V, 4 mV steps.

The model has only seen ACS-ML-Biomarker chips (P4VP or PVDF coating, CHI760F, SWV 25 mV, 5 Hz).
For curves recorded under other conditions its probabilities are not calibrated, and it cannot tell.

## Model

LightGBM, one binary classifier per analyte (learning rate 0.10, 31 leaves, 300 trees), on the full
rbio1.3 level-6 DWT of the sym4-denoised raw curve, trained with augmentation `poly16_smix1_d5_x20`
on 1,114 curves (seed 0 outer-training partition). Thresholds: MaxSSS (Youden) cut on the real
training rows. It is the model explained in the project's XAI work package (`ENG/xai/recipe.py`).

## How the browser engine is checked

`assets/js/engine/` reimplements PyWavelets (`wavedec`/`waverec`, symmetric mode) and LightGBM tree
traversal in plain JavaScript; the trees, filters, scaler and thresholds come from `data/model.json`.

```
node tools/parity.mjs
```

compares every stage against the Python outputs in `tools/fixtures/parity.json` for all 125 library
curves. Last run: max |Δ features| 2.7e-15, max |Δ probability| 8.7e-19, 0 of 500 decisions differ.
The page repeats the decision check on every load (model card → reference check).

## Layout

```
index.html                 page shell
assets/css/app.css         theme tokens (dark/light), layout, motion
assets/js/main.js          state, staged analysis, step panels, model card
assets/js/chart.js         SVG charts (voltammogram with crosshair, heat map, profiles)
assets/js/io.js            CSV / CHI parsing and resampling
assets/js/assistant.js     demo assistant
assets/js/engine/          wavelet transform, model, occlusion
data/model.json            exported model
data/library.json          held-out curves, metadata, mean blanks, Python reference scores
data/xai.json              XAI run results for this model: per-curve SHAP (R2), PFI, E3 windows, test numbers
tools/export_model.py      regenerates model.json / library.json from the research workspace
tools/export_xai.py        regenerates xai.json; checks that the run's rows and model are the site's
tools/parity.mjs           JS ↔ Python parity test
```

No build step: any static server works (`python -m http.server`), and GitHub Pages serves `main`.

## Data and licence

Curves: ML-Biomarker-Sensing — Duesselberg A. L. M., Weber I. C., Zosso Y., Salah P., Bao Z.,
*Machine Learning-Driven Multiplexed Biomarker Detection with Polymer-Enhanced Electrochemical
Sensors*, ACS Electrochemistry 2 (2026) 1444–1452, doi:10.1021/acselectrochem.6c00079.
Source repository github.com/esemsc-ald24/ML-Biomarker-Sensing, MIT licence.
