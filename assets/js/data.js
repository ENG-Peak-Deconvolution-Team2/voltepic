// Shared data: analyte identities, cached loaders for the exported JSON, library sample records.

import { createModel } from "./engine/model.js";
import { conc } from "./ui.js";

export const ANALYTES = [
  { id: "AA", code: "AA", name: "Ascorbic acid", color: "--a0" },
  { id: "5HT", code: "5-HT", name: "Serotonin", color: "--a1" },
  { id: "2E", code: "2E", name: "Estradiol", color: "--a2" },
  { id: "Mela", code: "Mela", name: "Melatonin", color: "--a3" },
];
export const CODES = ANALYTES.map((a) => a.code);

const cache = new Map();

/** data/<name>.json, fetched once per page. */
export function loadJson(name) {
  if (!cache.has(name)) {
    cache.set(name, fetch(`data/${name}.json`).then((r) => {
      if (!r.ok) throw new Error(`data/${name}.json: HTTP ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(name);
}

let modelPromise;
/** { json, model } — the exported model and its in-browser engine. */
export const getModel = () => (modelPromise ??= loadJson("model").then((json) => ({ json, model: createModel(json) })));

let libraryPromise;
/** The 125 held-out curves as sample records. */
export const getLibrary = () => (libraryPromise ??= loadJson("library").then((lib) => ({ ...lib, samples: lib.samples.map(toSample) })));

/** XAI run results; null when the file is absent. */
export const getXai = () => loadJson("xai").catch(() => null);

export function toSample(s, index) {
  const present = s.labels_nM.map((v, k) => (v > 0 ? k : -1)).filter((k) => k >= 0);
  return {
    source: "library", index, id: s.id, file: s.file, chip: s.chip, date: s.date, polymer: s.polymer,
    channel: s.channel, electrode: s.file.match(/_(Ch\d+)/)?.[1] ?? `ch ${s.channel}`,
    rep: s.file.match(/_(\d+)\.txt$/)?.[1], block: s.block, blankCount: s.blank_count,
    labels: s.labels_nM, present, I: Float64Array.from(s.I), blank: s.blank ? Float64Array.from(s.blank) : null,
    ref: s.ref,
    title: present.length ? present.map((k) => `${CODES[k]} ${conc(s.labels_nM[k])}`).join(" + ") : "Blank (no analyte)",
  };
}

/** Potential grid of the model, in volts. */
export const GRID_E = Float64Array.from({ length: 200 }, (_, k) => +(0.004 + 0.004 * k).toFixed(6));
