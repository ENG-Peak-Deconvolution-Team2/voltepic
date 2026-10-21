// KernelSHAP against one reference curve (the blank), players = 20 mV slices. Follows shap.KernelExplainer (0.53) as the
// chemist report calls it (ENG/xai/methods.kernel_shap, l1_reg=False): small subset sizes and their complements are
// enumerated, the rest sampled by the Shapley kernel, then the constrained weighted least squares. The sampler is a seeded
// PRNG, not numpy's, so values match Python closely but not bit for bit (tools/kimyager_parity.mjs measures the gap).

const EPS = 1e-12;
const logit = (p) => { const q = Math.min(Math.max(p, EPS), 1 - EPS); return Math.log(q) - Math.log1p(-q); };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };

function* combinations(n, k) {
  const c = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    yield c;
    let i = k - 1;
    while (i >= 0 && c[i] === n - k + i) i--;
    if (i < 0) return;
    c[i]++;
    for (let j = i + 1; j < k; j++) c[j] = c[j - 1] + 1;
  }
}

/** The coalitions and their kernel weights (shap's explain(): full subsets first, then paired random samples). */
function coalitions(M, nsamples, rand) {
  const masks = [], weights = [];
  const nSizes = Math.ceil((M - 1) / 2), nPaired = Math.floor((M - 1) / 2);
  const wv = Array.from({ length: nSizes }, (_, i) => (M - 1) / ((i + 1) * (M - i - 1)));
  for (let i = 0; i < nPaired; i++) wv[i] *= 2;
  const tot = wv.reduce((a, b) => a + b, 0);
  for (let i = 0; i < nSizes; i++) wv[i] /= tot;
  let full = 0, left = nsamples;
  const rem = [...wv];
  const add = (bits, w) => { masks.push(bits); weights.push(w); };
  for (let s = 1; s <= nSizes; s++) {
    const nsub = binom(M, s) * (s <= nPaired ? 2 : 1);
    if (!((left * rem[s - 1]) / nsub >= 1 - 1e-8)) break;
    full++;
    left -= nsub;
    if (rem[s - 1] < 1) { const r = 1 - rem[s - 1]; for (let i = 0; i < nSizes; i++) rem[i] /= r; }
    const w = wv[s - 1] / binom(M, s) / (s <= nPaired ? 2 : 1);
    for (const c of combinations(M, s)) {
      const m = new Uint8Array(M);
      for (const j of c) m[j] = 1;
      add(m, w);
      if (s <= nPaired) add(m.map((b) => 1 - b), w);
    }
  }
  const nFixed = masks.length;
  let samplesLeft = nsamples - nFixed;
  if (full !== nSizes) {
    const p = wv.map((x, i) => (i < nPaired ? x / 2 : x)).slice(full);
    const ps = p.reduce((a, b) => a + b, 0);
    const cdf = []; p.reduce((acc, x, i) => (cdf[i] = acc + x / ps), 0);
    const used = new Map();
    const perm = Array.from({ length: M }, (_, i) => i);
    for (let draws = 0; samplesLeft > 0 && draws < 4 * (nsamples - nFixed); draws++) {
      const r = rand();
      const idx = cdf.findIndex((c) => r < c);
      const s = (idx < 0 ? cdf.length - 1 : idx) + full + 1;
      for (let i = 0; i < s; i++) { const j = i + Math.floor(rand() * (M - i)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
      const m = new Uint8Array(M);
      for (let i = 0; i < s; i++) m[perm[i]] = 1;
      const key = m.join("");
      const fresh = !used.has(key);
      if (fresh) { used.set(key, masks.length); samplesLeft--; add(m, 1); } else weights[used.get(key)] += 1;
      if (samplesLeft > 0 && s <= nPaired) {
        if (fresh) { samplesLeft--; add(m.map((b) => 1 - b), 1); } else weights[used.get(key) + 1] += 1;
      }
    }
    const wLeft = wv.slice(full).reduce((a, b) => a + b, 0);
    const wSum = weights.slice(nFixed).reduce((a, b) => a + b, 0);
    for (let i = nFixed; i < weights.length; i++) weights[i] *= wLeft / wSum;
  }
  return { masks, weights };
}

/** Solve A w = b (Gaussian elimination, partial pivoting); A is n × n, row-major. */
function solve(A, b, n) {
  const a = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    [a[c], a[piv]] = [a[piv], a[c]];
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      if (f) for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  const w = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = a[r][n]; for (let k = r + 1; k < n; k++) s -= a[r][k] * w[k]; w[r] = s / a[r][r]; }
  return w;
}

// A yield through a message, not setTimeout: a background tab throttles timers after heavy work (measured: over 180 s
// instead of 4 s), not messages.
const tick = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); r(); }; ch.port2.postMessage(0); });

/**
 * SHAP values of `x` against `reference` (both 200 points), slices of `width` points: { logit, probability }, each
 * [slice][analyte]. Both come from the same coalitions, as in methods.kernel_shap (2k outputs).
 * `onProgress(done, total)` is called between chunks; the work yields to the browser so the page stays responsive.
 */
export async function kernelShap(model, x, reference, { width = 5, nsamples = 20000, seed = 0, onProgress } = {}) {
  const M = Math.floor(x.length / width);
  const { masks, weights } = coalitions(M, nsamples, mulberry32(seed));
  const out = (p) => [...p, ...p.map(logit)];
  const fx = out(model.score(x).probs), fnull = out(model.score(reference).probs);
  const D = fx.length, n = masks.length, ey = new Array(n);
  const curve = new Float64Array(x.length);
  for (let i = 0; i < n; i++) {
    const m = masks[i];
    for (let j = 0; j < M; j++) {
      const src = m[j] ? x : reference;
      for (let t = j * width; t < (j + 1) * width; t++) curve[t] = src[t];
    }
    ey[i] = out(model.score(curve).probs);
    if (i % 500 === 499) { onProgress?.(i + 1, n); await tick(); }
  }
  // constraint: the last player takes (fx − fnull) − Σ others; regress on etmp = mask[:, :-1] − mask[:, -1]
  const A = Array.from({ length: M - 1 }, () => new Array(M - 1).fill(0));
  const bs = Array.from({ length: D }, () => new Array(M - 1).fill(0));
  const e = new Float64Array(M - 1);
  for (let i = 0; i < n; i++) {
    const m = masks[i], w = weights[i], last = m[M - 1];
    for (let j = 0; j < M - 1; j++) e[j] = m[j] - last;
    for (let j = 0; j < M - 1; j++) {
      if (!e[j]) continue;
      const we = w * e[j];
      for (let k = 0; k < M - 1; k++) A[j][k] += we * e[k];
      for (let d = 0; d < D; d++) bs[d][j] += we * (ey[i][d] - fnull[d] - last * (fx[d] - fnull[d]));
    }
  }
  const phi = Array.from({ length: M }, () => new Array(D).fill(0));
  for (let d = 0; d < D; d++) {
    const w = solve(A, bs[d], M - 1);
    let sum = 0;
    for (let j = 0; j < M - 1; j++) { phi[j][d] = w[j]; sum += w[j]; }
    phi[M - 1][d] = fx[d] - fnull[d] - sum;
  }
  onProgress?.(n, n);
  const k = D / 2;
  return { probability: phi.map((r) => r.slice(0, k)), logit: phi.map((r) => r.slice(k)) };
}
