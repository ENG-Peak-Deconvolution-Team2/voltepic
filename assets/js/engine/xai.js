// Occlusion explanations: fill one unit of the raw curve, re-score, report the drop.

const EPS = 1e-12;

/** logit with clip, as methods.logit. */
const logit = (p) => { const q = Math.min(Math.max(p, EPS), 1 - EPS); return Math.log(q) - Math.log1p(-q); };

/** Fill points [i0, i1) of x (copy) per parts.fill: R0 zeros, R1 reference, R3 linear interpolation. */
export function fillRun(x, i0, i1, kind, reference) {
  const out = Float64Array.from(x), n = x.length;
  if (kind === "R0") out.fill(0, i0, i1);
  else if (kind === "R1" || kind === "R2") for (let i = i0; i < i1; i++) out[i] = reference[i];
  else if (kind === "R3") {
    if (i0 <= 0 && i1 >= n) {
      for (let i = 0; i < n; i++) out[i] = x[0] + ((x[n - 1] - x[0]) * i) / (n - 1);
    } else if (i0 <= 0) out.fill(x[i1], 0, i1);
    else if (i1 >= n) out.fill(x[i0 - 1], i0, n);
    else {
      const xl = i0 - 1, xr = i1, slope = (x[xr] - x[xl]) / (xr - xl);
      for (let i = i0; i < i1; i++) out[i] = slope * (i - xl) + x[xl];
    }
  } else throw new Error("unknown fill " + kind);
  return out;
}

/** Occlusion over consecutive runs of `width` points. */
export function occlusion(model, raw, { width = 5, fill = "R3", reference = null } = {}) {
  const base = model.score(raw).probs, baseLogit = base.map(logit), units = [];
  for (let i0 = 0; i0 < raw.length; i0 += width) {
    const i1 = Math.min(i0 + width, raw.length);
    const p = model.score(fillRun(raw, i0, i1, fill, reference)).probs;
    units.push({ i0, i1, dp: base.map((b, k) => b - p[k]), dlogit: baseLogit.map((b, k) => b - logit(p[k])) });
  }
  return { base, baseLogit, units };
}

/** Per-analyte mean |dp| per unit across curves: array [unit][analyte]. */
export function globalProfile(model, raws, opts = {}) {
  let acc = null;
  for (const raw of raws) {
    const { units } = occlusion(model, raw, opts);
    if (!acc) acc = units.map(() => new Float64Array(units[0].dp.length));
    units.forEach((u, j) => u.dp.forEach((d, k) => { acc[j][k] += Math.abs(d); }));
  }
  return acc.map((a) => Array.from(a, (v) => v / raws.length));
}
