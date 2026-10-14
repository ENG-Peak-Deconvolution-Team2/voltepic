// Inference engine: raw curve -> wavelet denoise -> rbio1.3 features -> 4 LightGBM heads.
import { wavedec, waverec } from "./wavelet.js";

const f64 = (a) => Float64Array.from(a);

/** Compile one flattened LightGBM tree into typed arrays. */
function compileTree(t) {
  const single = !t.f || t.f.length === 0;
  return {
    single,
    f: single ? null : Int32Array.from(t.f),
    t: single ? null : f64(t.t),
    l: single ? null : Int32Array.from(t.l),
    r: single ? null : Int32Array.from(t.r),
    d: t.d ? Uint8Array.from(t.d) : null,
    m: t.m ? Uint8Array.from(t.m) : null,
    v: f64(t.v),
  };
}

/** Leaf value of one tree for feature vector x (LightGBM NumericalDecision). */
function evalTree(tr, x) {
  if (tr.single) return tr.v[0];
  let node = 0;
  for (;;) {
    let v = x[tr.f[node]];
    const mt = tr.m ? tr.m[node] : 0;
    if (mt !== 2 && v !== v) v = 0;
    let left;
    if ((mt === 1 && Math.abs(v) <= 1e-35) || (mt === 2 && v !== v)) left = tr.d ? tr.d[node] === 1 : false;
    else left = v <= tr.t[node];
    const next = left ? tr.l[node] : tr.r[node];
    if (next < 0) return tr.v[~next];
    node = next;
  }
}

/** Median of a copy (numpy semantics: even length = mean of the two middle values). */
function median(a) {
  const s = Float64Array.from(a).sort();
  const n = s.length, h = n >> 1;
  return n % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/** Build the engine from the parsed model.json. */
export function createModel(json) {
  const sym = json.wavelets[json.denoise.wavelet], fb = json.wavelets[json.features.wavelet];
  const dLevel = json.denoise.level, fLevel = json.features.level;
  const n = json.grid.n;
  const means = f64(json.imputer.mean ?? json.imputer), sMean = f64(json.scaler.mean), sScale = f64(json.scaler.scale);
  const nFeat = sMean.length;
  const thresholds = json.thresholds.slice();
  const heads = json.heads.map((h) => ({ k: h.sigmoid, trees: h.trees.map(compileTree) }));
  let off = 0;
  const bands = json.features.bands.map((b) => { const o = { ...b, start: off }; off += b.length; return o; });
  const univ = Math.sqrt(2 * Math.log(n));
  const design = new Float64Array(nFeat);

  /** Denoise a raw curve: soft universal threshold on all details, MAD of cD1. */
  function denoise(raw) {
    const c = wavedec(raw, sym, dLevel);
    const sigma = median(c[c.length - 1].map(Math.abs)) / 0.6745;
    const lambda = sigma * univ;
    if (lambda !== 0) {
      for (let i = 1; i < c.length; i++) {
        const d = c[i];
        for (let j = 0; j < d.length; j++) {
          const mag = Math.abs(d[j]);
          d[j] = mag === 0 ? 0 : d[j] * Math.max(0, 1 - lambda / mag);
        }
      }
    }
    const signal = Float64Array.from(waverec(c, sym).subarray(0, n));
    return { signal, sigma, lambda };
  }

  /** 228 DWT coefficients of a denoised signal: [cA6, cD6, ..., cD1]. */
  function features(signal) {
    const out = new Float64Array(nFeat);
    let o = 0;
    for (const c of wavedec(signal, fb, fLevel)) { out.set(c, o); o += c.length; }
    return out;
  }

  /** Raw margins of the four heads for a feature vector (impute + standardise inside). */
  function margins(feat) {
    for (let i = 0; i < nFeat; i++) {
      const v = feat[i] !== feat[i] ? means[i] : feat[i];
      design[i] = (v - sMean[i]) / sScale[i];
    }
    return heads.map((h) => { let s = 0; for (const t of h.trees) s += evalTree(t, design); return s; });
  }

  /** Full pipeline for one raw curve. */
  function score(raw) {
    const { signal, sigma, lambda } = denoise(raw);
    const feats = features(signal);
    const m = margins(feats);
    const probs = m.map((v, k) => 1 / (1 + Math.exp(-heads[k].k * v)));
    return { denoised: signal, sigma, lambda, features: feats, margins: m, probs, detected: probs.map((p, k) => p >= thresholds[k]) };
  }

  return { denoise, features, score, scoreMany: (raws) => raws.map(score), bands, analytes: json.analytes, thresholds, grid: json.grid, r1: json.r1 };
}
