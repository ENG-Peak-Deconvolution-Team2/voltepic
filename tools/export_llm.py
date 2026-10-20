# -*- coding: utf-8 -*-
"""Export the report-writer's fixed text (system prompt + knowledge cards) for the analyzer's Gemini report.

The report pipeline was built and tested in literature/xai_llm_rag/prototip/ (v0.2): build_packet.py turns one
curve's explanation into numbered facts, assemble_prompt.py adds the knowledge cards, an LLM writes the report and
verify_report.py / dogrula.py check it against the facts. The site re-implements the packet, the prompt and the check
in assets/js/llm/; the text the LLM reads is not re-typed but exported from the prototype by this script.

    python ENG/analysis-dashboard/tools/export_llm.py              # data/llm.json
    python ENG/analysis-dashboard/tools/export_llm.py --fixture    # + tools/fixtures/llm_parity.json

data/llm.json   system     the SİSTEM section of prototip/prompt_rapor.md
                cards      bilgi_tabani/*.md without front matter, by key
The fixture holds Python's packets for the 125 library curves, the prompts of the v0.2 run and the verifier's findings
on every report of both runs, for tools/llm_parity.mjs.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
ROOT = SITE.parents[1]
XLR = ROOT / "literature" / "xai_llm_rag"
PROTO = XLR / "prototip"
KB = XLR / "bilgi_tabani"
RUNS = [PROTO / "kosu_2026-10-19", PROTO / "kosu_2026-10-20_v02"]


def system_prompt() -> str:
    t = (PROTO / "prompt_rapor.md").read_text(encoding="utf-8")
    return t.split("## SİSTEM", 1)[1].split("## KULLANICI", 1)[0].strip()


def cards() -> dict[str, str]:
    out = {}
    for p in sorted(KB.glob("*.md")):
        out[p.stem] = re.sub(r"^---.*?---\s*", "", p.read_text(encoding="utf-8"), flags=re.S).strip()
    return out


def sha(paths) -> str:
    h = hashlib.sha256()
    for p in paths:
        h.update(p.read_bytes())
    return h.hexdigest()[:16]


def export():
    head = (PROTO / "prompt_rapor.md").read_text(encoding="utf-8").splitlines()[0]
    version = re.search(r"\(v([\d.]+)\)", head).group(1)
    srcs = [PROTO / "prompt_rapor.md", *sorted(KB.glob("*.md"))]
    out = {"schema": 1, "created": date.today().isoformat(), "prompt_version": version,
           "source": "literature/xai_llm_rag/prototip/prompt_rapor.md + bilgi_tabani/*.md", "source_sha256": sha(srcs),
           "system": system_prompt(), "cards": cards()}
    (SITE / "data" / "llm.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"data/llm.json · prompt v{version} · {len(out['cards'])} cards · sha {out['source_sha256']}")


def fixture():
    sys.path.insert(0, str(PROTO))
    sys.path.insert(0, str(RUNS[-1]))
    import build_packet  # noqa: E402
    import dogrula  # noqa: E402  -- the v0.2 run's checker (corrected pass, six fixes)

    lib = json.loads((SITE / "data" / "library.json").read_text(encoding="utf-8"))
    packets = []
    for i in range(len(lib["samples"])):
        p = build_packet.build(i)
        packets.append({"index": i, "sample": p["sample"], "detection": p["values"]["detection"],
                        "facts": p["facts"], "retrieve": p["retrieve"]})
    prompts = {}
    for f in sorted(RUNS[-1].glob("istem_*.txt")):
        prompts[f.stem.split("_")[1]] = f.read_text(encoding="utf-8").rstrip("\n")
    reports = []
    for run in RUNS:
        for rep in sorted(run.glob("rapor_*_*.md")):
            _, idx, model = rep.stem.split("_", 2)
            pkt = json.loads((run / f"paket_{idx}.json").read_text(encoding="utf-8"))
            prompt = (run / f"istem_{idx}.txt").read_text(encoding="utf-8")
            text = rep.read_text(encoding="utf-8")
            issues = dogrula.check2(pkt, prompt, text)[0]
            reports.append({"run": run.name, "curve": int(idx), "model": model,
                            "packet": {"facts": pkt["facts"], "detection": pkt["values"]["detection"]},
                            "prompt": prompt, "report": text, "issues": issues})
    fx = {"packets": packets, "prompts": prompts, "reports": reports}
    (HERE / "fixtures" / "llm_parity.json").write_text(json.dumps(fx, ensure_ascii=False), encoding="utf-8")
    print(f"tools/fixtures/llm_parity.json · {len(packets)} packets · {len(prompts)} prompts · {len(reports)} reports")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    export()
    if "--fixture" in sys.argv:
        fixture()
