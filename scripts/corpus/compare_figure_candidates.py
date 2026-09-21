# -*- coding: utf-8 -*-
"""Are the existing question ↔ figure associations among C2's geometric candidates?

    python scripts/corpus/compare_figure_candidates.py <associations.tsv>

The TSV is a read-only export of the questions that carry `content_images`:
    source_ref <TAB> chapter subject id <TAB> first image <TAB> image count

The 828 existing associations are not ground truth. They were made by
`attach-figures.ts`, which renders the WHOLE printed page a question's opening
words were found on — `/figures/<stem>-p<N>.png`. So what they assert is "this
question's figure is on page N". The question asked here is only whether that
is geometrically possible: does any secured crop on page N name the question's
container among its candidates? This scores nothing about ownership.

Nothing is written anywhere; the verdicts are printed.
"""
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2]


def main(tsv: str):
    exams = [e for e in json.loads((ROOT / "corpus" / "exams.json").read_text(encoding="utf-8")) if e.get("sha256")]
    rows = [l.rstrip("\n").split("\t") for l in open(tsv, encoding="utf-8") if l.strip()]
    subjects = sorted({r[1] for r in rows})

    # source_ref = sha256(subjectId:paperSha:exercise.index:order), order = position in the paper.
    ref_to = {}
    for e in exams:
        for order, ex in enumerate(e.get("exercises") or []):
            for sid in subjects:
                ref = hashlib.sha256(f"{sid}:{e['sha256']}:{ex.get('index')}:{order}".encode()).hexdigest()
                ref_to[ref] = (e["sha256"], order + 1, str(e["path"]).replace("\\", "/"))

    c2 = json.loads((ROOT / "corpus" / ".mapping" / "figure-candidates.json").read_text(encoding="utf-8"))
    by_page = defaultdict(list)
    for o in c2["occurrences"]:
        by_page[(o["pdfSha256"], o["page"])].append(o)
    c1 = {}
    for p in json.loads((ROOT / "corpus" / ".mapping" / "positioned-structure.json").read_text(encoding="utf-8")):
        c1.setdefault(p["sha256"], p)

    verdicts, detail = Counter(), defaultdict(list)
    for ref, sid, img, _n in rows:
        hit = ref_to.get(ref)
        m = re.search(r"-p(\d+)\.png$", img)
        if not hit or not m:
            verdicts["cannot evaluate: question not traceable to a paper"] += 1
            continue
        sha, ordinal, path = hit
        page = int(m.group(1))
        if sha not in c1:
            verdicts["cannot evaluate: no positioned source"] += 1
            continue
        cont = c1[sha]["containers"][ordinal - 1]
        status = cont["alignment"]["status"]
        crops = by_page.get((sha, page), [])
        if not crops:
            verdicts["cannot evaluate: no secured crop on that page"] += 1
            detail["nocrop"].append((path, ordinal, page, status))
            continue
        named = [o for o in crops if any(c["ordinal"] == ordinal for c in o.get("candidates") or [])]
        if named:
            unique = [o for o in named if o["geometricConfidence"] == "UNIQUE_GEOMETRIC"]
            key = "compatible: a crop on that page has it as its unique candidate" if unique else \
                  "compatible: among multiple / weak candidates"
            verdicts[key] += 1
            continue
        if status not in ("EXACT", "STRONG"):
            verdicts["ambiguous: container has no trusted position"] += 1
            detail["amb"].append((path, ordinal, page, status))
            continue
        verdicts["incompatible"] += 1
        detail["incompatible"].append((path, ordinal, page, status,
                                       [(o["occurrenceId"], o["geometricConfidence"], o["territory"],
                                         [c["ordinal"] for c in o.get("candidates") or []]) for o in crops]))

    total = sum(verdicts.values())
    print(f"existing associations: {total}")
    for k, v in sorted(verdicts.items()):
        print(f"  {v:>5}  {k}")
    print("\nincompatible:")
    for d in detail["incompatible"]:
        print("  ", d)


if __name__ == "__main__":
    main(sys.argv[1])
