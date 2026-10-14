// Reading measurements: CSV/TSV tables and raw CHI760F text exports, resampled onto the model grid.

export const GRID = { start: 0.004, step: 0.004, n: 200 };
export const gridE = () => Float64Array.from({ length: GRID.n }, (_, k) => +(GRID.start + GRID.step * k).toFixed(6));

const NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** Parse a file's text into { E, channels: [{ name, I (µA) }], params, source }. */
export function parseText(text, fileName = "") {
  const lines = text.replace(/\r/g, "").split("\n");
  const chiHeader = lines.findIndex((l) => /^\s*Potential\s*\/\s*V\s*,/i.test(l));
  if (chiHeader >= 0) return parseChi(lines, chiHeader);
  return parseTable(lines, fileName);
}

function parseChi(lines, headerRow) {
  const params = { technique: lines[1]?.trim() || "", acquired: lines[0]?.trim() || "" };
  for (const line of lines.slice(0, headerRow)) {
    const m = line.match(/^\s*([^=:]+?)\s*[=:]\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2];
    if (key.startsWith("instrument model")) params.instrument = val;
    else if (key.startsWith("init e")) params.init_E = +val;
    else if (key.startsWith("final e")) params.final_E = +val;
    else if (key.startsWith("incr e")) params.incr_E = +val;
    else if (key.startsWith("amplitude")) params.amplitude = +val;
    else if (key.startsWith("frequency")) params.frequency = +val;
    else if (key.startsWith("quiet time")) params.quiet_time = +val;
  }
  const names = lines[headerRow].split(",").map((s) => s.trim());
  const rows = [];
  for (const line of lines.slice(headerRow + 1)) {
    const cells = line.split(",").map((s) => s.trim());
    if (cells.length < 2 || !cells.every((c) => NUM.test(c))) continue;
    rows.push(cells.map(Number));
  }
  if (rows.length < 10) throw new Error("The CHI file has fewer than 10 data rows.");
  const E = rows.map((r) => r[0]);
  const channels = [];
  for (let c = 1; c < names.length; c++) {
    const I = rows.map((r) => r[c] * 1e6);           // A → µA
    if (I.some((v) => v !== 0)) channels.push({ name: names[c].replace(/\/A$/i, "").trim(), I });
  }
  if (!channels.length) throw new Error("Every current column in the CHI file is zero.");
  return { source: "CHI text export", E, channels, params };
}

function parseTable(lines, fileName) {
  const body = lines.filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (!body.length) throw new Error("The file is empty.");
  const delim = [";", "\t", ","].find((d) => body[0].includes(d)) ?? /\s+/;
  const split = (l) => l.trim().split(delim).map((s) => s.trim().replace(/^"|"$/g, ""));
  let header = null;
  const rows = [];
  for (const line of body) {
    const cells = split(line);
    if (cells.every((c) => NUM.test(c))) rows.push(cells.map(Number));
    else if (!rows.length) header = cells.join(" ").toLowerCase();
  }
  if (rows.length < 10) throw new Error("Need at least 10 numeric rows (potential, current).");
  const width = Math.min(...rows.map((r) => r.length));
  const params = {};
  let E;
  let I;
  if (width === 1) {
    if (rows.length !== GRID.n) throw new Error(`A single column must hold exactly ${GRID.n} currents on the model grid.`);
    E = Array.from(gridE());
    I = rows.map((r) => r[0]);
    params.note = "single current column, model grid assumed";
  } else {
    E = rows.map((r) => r[0]);
    I = rows.map((r) => r[1]);
  }
  // unit tokens from the header: "potential_mV;current_nA" → [potential, mv, current, na]
  const tokens = new Set((header || "").split(/[^a-zµμ]+/).filter(Boolean));
  if (tokens.has("mv") || Math.max(...E.map(Math.abs)) > 5) {
    E = E.map((v) => v / 1000);
    params.note = "potentials read as mV and converted to V";
  }
  const tiny = Math.max(...I.map(Math.abs)) < 1e-3;
  const unit = tokens.has("µa") || tokens.has("μa") || tokens.has("ua") ? "µA"
    : tokens.has("na") ? "nA" : tokens.has("ma") ? "mA"
      : tokens.has("a") || tokens.has("amp") || tokens.has("amps") || tiny ? "A" : "µA";
  const scale = { "µA": 1, nA: 1e-3, mA: 1e3, A: 1e6 }[unit];
  if (scale !== 1) {
    I = I.map((v) => v * scale);
    params.note = (params.note ? params.note + "; " : "") + `currents read as ${unit} and converted to µA`;
  }
  return { source: /\.tsv$/i.test(fileName) ? "TSV table" : "CSV table", E, channels: [{ name: "I", I }], params };
}

/** Linear interpolation of (E, I) onto the model grid. Returns { I, resampled, warnings }. */
export function toGrid(E, I) {
  const pairs = E.map((e, k) => [e, I[k]]).filter(([e, i]) => isFinite(e) && isFinite(i)).sort((a, b) => a[0] - b[0]);
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const grid = gridE();
  const warnings = [];
  const onGrid = xs.length === GRID.n && xs.every((x, k) => Math.abs(x - grid[k]) < 1e-6);
  if (onGrid) return { I: Float64Array.from(ys), resampled: false, warnings };
  const lo = xs[0];
  const hi = xs[xs.length - 1];
  if (lo > grid[0] + 1e-6 || hi < grid[GRID.n - 1] - 1e-6) {
    warnings.push(`The file covers ${lo.toFixed(3)}–${hi.toFixed(3)} V; the model reads 0.004–0.800 V, so the uncovered edge is held flat.`);
  }
  const out = new Float64Array(GRID.n);
  let j = 0;
  for (let k = 0; k < GRID.n; k++) {
    const x = grid[k];
    if (x <= lo) { out[k] = ys[0]; continue; }
    if (x >= hi) { out[k] = ys[ys.length - 1]; continue; }
    while (xs[j + 1] < x) j++;
    const t = (x - xs[j]) / (xs[j + 1] - xs[j] || 1);
    out[k] = ys[j] + t * (ys[j + 1] - ys[j]);
  }
  return { I: out, resampled: true, warnings };
}

/** CSV text of the grid curve(s). */
export function toCsv(columns) {
  const names = Object.keys(columns);
  const E = gridE();
  const rows = [["potential_V", ...names].join(",")];
  for (let k = 0; k < GRID.n; k++) rows.push([E[k].toFixed(3), ...names.map((n) => columns[n][k].toPrecision(7))].join(","));
  return rows.join("\n") + "\n";
}
