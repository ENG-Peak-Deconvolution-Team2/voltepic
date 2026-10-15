# VoltEPIC — Explainable Prediction of Individual Concentrations

An analysis site that reads a square-wave voltammogram and decides, for each of four biomarkers —
ascorbic acid (AA), serotonin (5-HT), estradiol (2E) and melatonin (Mela) — whether it is present,
and shows why. The detection model runs entirely in the browser; nothing is uploaded anywhere.

**Live:** https://eng-peak-deconvolution-team2.github.io/voltepic/

ENG Peak Deconvolution project · Team 2 (machine learning) · work package 6, web interface.

The model behind it today is a detector: it says whether each analyte is present, not how much.
Concentration estimates are the part of the name a regression model will fill in.

## Pages

| Page | What it is |
|---|---|
| `index.html` — Overview | Live readout cycling through held-out curves, key numbers, the pipeline computed on a real curve, where the model looks |
| `app.html` — Analyzer | A sticky instrument (chart + four verdict cards) beside a live report that drives the chart as you scroll: 01 Measurement · 02 Preprocess · 03 Detect · 04 Explain. Library sheet with thumbnails, drag-and-drop upload anywhere, slide-over assistant, deep links `#s=<index>`, `#s=random`, `#upload`, `#ask` |
| `method.html` — Method | Scroll-driven walk-through: raw scan → wavelet denoising → seven bands → 228 z-scores → 4 × 300 trees building the log-odds → threshold, recomputed for the chosen example curve |
| `explainability.html` — Explainability | The WP5 XAI results: four methods, five tests (verdict matrix), PFI of this model against the E3 peak windows, the edge-coefficient finding recomputed from the filters, and what the analyzer shows as a result |
| `data.html` — Dataset | Source, acquisition, the 1,239-curve cohort, the two coatings, the split, the held-out library and a gallery of all 125 curves |
| `model.html` — Model card | Recipe, held-out results and the browser ↔ Python reference check computed live, limits, reproduction |
| `about.html` — About | The ENG project, its work packages, Team 2 |

Everywhere: light and dark themes (follows the system, remembers a choice), a command palette
(`Ctrl/⌘ K` or `/`) over pages, actions and all 125 curves, responsive down to 390 px.

The **analysis assistant** is a placeholder: its answers are composed by rules from the current
analysis. `assets/js/assistant.js` → `respond()` is where a language-model call will go.

## Explanations in the analyzer

Chosen from the ENG WP5 XAI run by what landed on the peaks in its tests:

- **Graph shading (default):** grouped permutation importance (PFI) of this exact model — the most
  reliable method in the 2026-10-11 results (on the peak for 4/4 analytes on PVDF, stable 0.89, no
  edge bias) — drawn next to the analyte's E3 peak window.
- **This curve, library:** KernelSHAP with the blank of the same chip, day and electrode as
  reference (R2) — across all fills, the local method that lands on the peak most often.
- **This curve, uploads:** occlusion computed in the browser; default fill is the training mean (R1),
  the straight-line bridge (R3) is offered but was flagged for edge bias.

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
traversal in plain JavaScript; trees, filters, scaler and thresholds come from `data/model.json`.

```
node tools/parity.mjs
```

compares every stage against the Python outputs in `tools/fixtures/parity.json` for all 125 library
curves. Last run: max |Δ features| 2.7e-15, max |Δ probability| 8.7e-19, 0 of 500 decisions differ.
The analyzer and the model card repeat the decision check on every load.

## Layout

```
*.html                     one file per page; <pd-nav>/<pd-footer> come from assets/js/shell.js
assets/css/site.css        design system: tokens (light/dark), type, layout, components
assets/css/pages.css       home, method, explainability; page-*.css for dataset, model card, about
assets/css/analyzer.css    the analyzer
assets/js/shell.js         theme before first paint, nav and footer
assets/js/site.js          theme toggle, scroll reveals, command palette
assets/js/data.js          analyte identities, cached loaders, library records
assets/js/viz.js           SVG chart kit for the editorial pages
assets/js/chart.js         analyzer charts (voltammogram with crosshair, coefficients, strip, heat map)
assets/js/app/             analyzer: main.js (state, run, instrument), report.js (four sections)
assets/js/pages/           one module per page
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
Fonts: Geist, Geist Mono and Instrument Serif from Google Fonts.

## Data and licence

Curves: ML-Biomarker-Sensing — Duesselberg A. L. M., Weber I. C., Zosso Y., Salah P., Bao Z.,
*Machine Learning-Driven Multiplexed Biomarker Detection with Polymer-Enhanced Electrochemical
Sensors*, ACS Electrochemistry 2 (2026) 1444–1452, doi:10.1021/acselectrochem.6c00079.
Source repository github.com/esemsc-ald24/ML-Biomarker-Sensing, MIT licence.
