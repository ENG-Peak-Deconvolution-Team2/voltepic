# VoltEPIC — Explainable Prediction of Individual Concentrations

An analysis site that reads a square-wave voltammogram and decides, for each of four biomarkers —
ascorbic acid (AA), serotonin (5-HT), estradiol (2E) and melatonin (Mela) — whether it is present,
and shows why. The detection model runs entirely in the browser; nothing is uploaded anywhere, unless you ask the
assistant for a Gemini report (below).

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

The **analysis assistant** answers quick questions by rules from the current analysis, and writes a **chemist report
with Gemini** on request (next section).

## Explanations in the analyzer

Chosen from the ENG WP5 XAI run by what landed on the peaks in its tests:

- **Graph shading (default):** grouped permutation importance (PFI) of this exact model — the most
  reliable method in the 2026-10-11 results (on the peak for 4/4 analytes on PVDF, stable 0.89, no
  edge bias) — drawn next to the analyte's E3 peak window.
- **This curve, library:** KernelSHAP with the blank of the same chip, day and electrode as
  reference (R2) — across all fills, the local method that lands on the peak most often. At 20 mV the values are
  the chemist report's own (`data/kimyager.json`, 20,000 coalitions); other widths come from the XAI run (`xai.json`).
- **This curve, uploads:** occlusion computed in the browser; default fill is the training mean (R1),
  the straight-line bridge (R3) is offered but was flagged for edge bias. Once a blank is added
  (01 · Measurement, one or more files, their mean is used), the browser also computes KernelSHAP against it
  (`assets/js/engine/shap.js`, 20 mV, 20,000 coalitions, about 4–6 s) and the blank fill R2 is offered.

## Chemist report (Gemini)

The assistant has two modes, switched in its header: **Quick** (answers composed by rules) and **Gemini**. In Gemini mode
*Kimyager raporu yaz* turns the current result into a 3–5 sentence report in plain Turkish: what the model said, whether
its basis is chemically sound, anything suspicious, what to check in the lab. Follow-up questions are answered (1–4
sentences) from the same evidence file, with the report as context. It is the pipeline of
`literature/xai_llm_rag/kimyager_raporu/rapor.py`, ported to the browser; the language model only writes, everything it
may say is computed first:

1. **Basis labels** (`assets/js/llm/kanit.js`, `degerlendir`) — code sets one label per decision from the XAI tests
   (`güçlü`, `orta`, `zayıf`, `şüpheli`, `yerinde`, `gösterilemedi`): do SHAP and occlusion against the blank point to the
   same 20 mV slice, does it fall in the analyte's peak window and among the model's PFI top 3, is it a scan edge, is the
   decision near the threshold, does the blank itself get the same decision. The model never sets a label.
2. **Evidence file** (`kanitDosyasi`) — about 93 records in six branches: the decisions with their labels and reasons, the
   regions both explanations point to toward and against each decision (top 3 and top 2 slices), where the model
   generally looks (PFI, SAGE), the expected peak windows, the peaks seen in the curve, check suggestions and general
   notes. Library curves use `data/kimyager.json` (rapor.py's explanations, exported by `tools/export_kimyager.py`);
   uploads need a blank and the coating (01 · Measurement; the coating is read from the chip name when it is a known
   training chip). The file name, the raw curve and the blank curve are not sent.
3. **Gemini** (`assets/js/llm/gemini.js`) — REST `generateContent` with the system prompt of `data/kimyager_istem.json`,
   either from the browser with the visitor's own API key (Google AI Studio; stored in this browser's localStorage and
   sent only to Google) or through the project's shared access, a Cloudflare Worker that holds the project key as a
   secret and accepts only this evidence file (`worker/`, see its README; not deployed, so the site uses a visitor's own
   key). No key ships with the site. On the free tier Google may use what is sent to improve its models and human
   reviewers may read it.
4. **Check** (`assets/js/llm/denetim.js`) — 8 rules on every text: sentence count and length, technical terms, record
   IDs, numbers not in the evidence file, "peak is here" claims, contradicted decisions, scan-edge regions, first person.
   With findings, Gemini gets one rewrite with them; what is left is listed under the text. The report bubble also shows
   the basis labels and the full evidence file sent.

```
node tools/kimyager_parity.mjs [--shap]
```

compares the evidence file, the labels, the check and the messages with rapor.py. Its fixture
(`tools/fixtures/kimyager_parity.json`, written by `export_kimyager.py --fixture`) holds unpublished LLM outputs and is
not part of this repository. Last run (2026-10-21): evidence file identical JSON text on 125/125 library curves, basis
labels 125/125, check findings identical on 170/170 texts (the runs' real reports and altered copies), report and question
messages identical. `--shap`: the browser's KernelSHAP (its own sampler) against Python's on 5 curves — 4.1–4.3 s each,
max |Δ| 0.17–0.27 against a largest |φ| of 3.3–5.4, the same basis labels on 5/5. In the browser (headless Edge,
2026-10-21): library curve 12 report and one question with Gemini 3.8 Flash, both passed the check; an MC333 upload with
three blanks (a chip the model was not trained on), blank SHAP in 4–6 s, also with the page in a background tab, and its
report passed the check on the first attempt, flagging the ascorbic acid decision (wrong by the file's composition) as
weak. Measured on the report task with rapor.py: Gemini 3.8 Flash 7/7 texts passed the
check and made no wrong claim (`literature/xai_llm_rag/kimyager_raporu/kosu_gemini_2026-10-21/`). The earlier packet
pipeline (v0.3) is archived in `literature/xai_llm_rag/prototip/site_paket_v03_2026-10-21/`.

## Inputs

- **Library:** 125 held-out curves of the ACS-ML-Biomarker data set (seed 0 outer test), with labels.
- **Upload:** a CSV/TSV with potential and current columns (units read from the header: V or mV;
  A, mA, µA or nA), a single column of 200 currents on the model grid, or a raw CHI760F `.txt`
  export (both working electrodes are offered when present). Curves are linearly resampled to the
  model grid: 200 points, 0.004–0.800 V, 4 mV steps.
- **Blank and coating (uploads, for the chemist report):** one or more blank files of the same electrode, in any of the
  formats above (their mean is the reference), and the coating, PVDF or P4VP.

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
assets/js/assistant.js     assistant: scripted answers + the Gemini report
assets/js/llm/             chemist report: kanit (labels, evidence file), denetim (check, messages), gemini, report
worker/                    Cloudflare Worker: shared Gemini access with the project key (secret)
assets/js/engine/          wavelet transform, model, occlusion, KernelSHAP (shap.js)
data/model.json            exported model
data/library.json          held-out curves, metadata, mean blanks, Python reference scores
data/xai.json              XAI run results for this model: per-curve SHAP (R2), PFI, E3 windows, test numbers
data/kimyager.json         chemist report: per library curve SHAP / occlusion against the blank, the blank, model-level notes
data/kimyager_istem.json   chemist report system prompts (report, question)
tools/export_model.py      regenerates model.json / library.json from the research workspace
tools/export_xai.py        regenerates xai.json; checks that the run's rows and model are the site's
tools/parity.mjs           JS ↔ Python parity test
tools/export_kimyager.py   regenerates kimyager.json / kimyager_istem.json (+ --fixture: tools/fixtures/kimyager_parity.json)
tools/kimyager_parity.mjs  chemist report ↔ rapor.py parity test
```

No build step: any static server works (`python -m http.server`), and GitHub Pages serves `main`.
Fonts: Geist, Geist Mono and Instrument Serif from Google Fonts.

## Data and licence

Curves: ML-Biomarker-Sensing — Duesselberg A. L. M., Weber I. C., Zosso Y., Salah P., Bao Z.,
*Machine Learning-Driven Multiplexed Biomarker Detection with Polymer-Enhanced Electrochemical
Sensors*, ACS Electrochemistry 2 (2026) 1444–1452, doi:10.1021/acselectrochem.6c00079.
Source repository github.com/esemsc-ald24/ML-Biomarker-Sensing, MIT licence.
