"""Fixture for xai.fillRun. R3 logic copied verbatim from ENG/xai/parts.py::fill
(importing parts pulls in recipe and the campaign code, so it is not imported here)."""
import json
import numpy as np

N_POINTS = 200


def fill(X, mask):
    out = np.array(X, dtype=float, copy=True)
    masks = np.broadcast_to(mask, out.shape)
    grid = np.arange(N_POINTS)
    for i in range(len(out)):
        kept = ~masks[i]
        if not kept.any():
            out[i] = np.linspace(X[i, 0], X[i, -1], N_POINTS)
        elif not kept.all():
            out[i, ~kept] = np.interp(grid[~kept], grid[kept], out[i, kept])
    return out


lib = json.load(open("data/library.json"))
X = np.array([lib["samples"][0]["I"]])
cases = []
for i0, i1 in [(0, 5), (5, 10), (95, 100), (195, 200), (0, 200), (3, 40)]:
    m = np.zeros(N_POINTS, bool)
    m[i0:i1] = True
    cases.append(dict(i0=i0, i1=i1, out=fill(X, m)[0].tolist()))
json.dump(dict(x=X[0].tolist(), cases=cases), open("tools/fixtures/fill_r3.json", "w"))
