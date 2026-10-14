// pywt-compatible DWT in mode "symmetric" (half-sample reflection). Float64Array throughout.

/** Index into x of length n with half-sample symmetric reflection (period 2n). */
function reflect(i, n) {
  const p = 2 * n;
  let k = ((i % p) + p) % p;
  return k < n ? k : p - 1 - k;
}

/** One analysis step: out[i] = sum_j filt[j] * x[2i+1-j]; length floor((N+F-1)/2). */
function analyse(x, filt) {
  const n = x.length, F = filt.length, m = Math.floor((n + F - 1) / 2);
  const out = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = 0; j < F; j++) s += filt[j] * x[reflect(2 * i + 1 - j, n)];
    out[i] = s;
  }
  return out;
}

/** Single-level DWT; returns [cA, cD]. `bank` = {dec_lo, dec_hi, ...}. */
export function dwt(x, bank) {
  return [analyse(x, bank.dec_lo), analyse(x, bank.dec_hi)];
}

/** One synthesis branch: upsample c, convolve with filt, keep the central 2N-F+2 samples. */
function synth(c, filt, out) {
  const N = c.length, F = filt.length, L = 2 * N - F + 2;
  for (let n = 0; n < L; n++) {
    let s = 0;
    // y[m] = sum_k c[k] * filt[m - 2k], m = n + F - 2
    const m = n + F - 2;
    const kLo = Math.max(0, Math.ceil((m - F + 1) / 2)), kHi = Math.min(N - 1, Math.floor(m / 2));
    for (let k = kLo; k <= kHi; k++) s += c[k] * filt[m - 2 * k];
    out[n] += s;
  }
}

/** Single-level inverse DWT; either input may be null (treated as zeros). */
export function idwt(cA, cD, bank) {
  const N = (cA || cD).length, F = bank.rec_lo.length;
  const out = new Float64Array(2 * N - F + 2);
  if (cA) synth(cA, bank.rec_lo, out);
  if (cD) synth(cD, bank.rec_hi, out);
  return out;
}

/** Multilevel decomposition; returns [cA_n, cD_n, ..., cD_1]. */
export function wavedec(x, bank, level) {
  const details = [];
  let a = x;
  for (let l = 0; l < level; l++) {
    const [lo, hi] = dwt(a, bank);
    details.push(hi);
    a = lo;
  }
  return [a, ...details.reverse()];
}

/** Multilevel reconstruction, with pywt's one-sample trim of the approximation. */
export function waverec(coeffs, bank) {
  let a = coeffs[0];
  for (let i = 1; i < coeffs.length; i++) {
    const d = coeffs[i];
    if (a.length === d.length + 1) a = a.subarray(0, a.length - 1);
    a = idwt(a, d, bank);
  }
  return a;
}
